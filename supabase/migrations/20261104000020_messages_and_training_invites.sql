-- Community, stage 2: private one-to-one messages between friends, and "Invite to train" invitations.
--
-- * Conversations exist only between two accounts. Sending requires an accepted friendship, no block
--   in either direction and an unrestricted account. A shared gym alone never allows messaging.
-- * Unfriending keeps the history readable for both people but stops new messages and invitations
--   until they are friends again. Blocking does the same immediately and cancels open invitations.
-- * Messages and invitations are readable only by the two participants (RLS, which also limits
--   Realtime). A message the caller reported is hidden from the caller.
-- * send_message() takes an id made by the client, so retrying after a network failure never creates
--   a duplicate. Rate limits: 30 messages a minute and 1000 a day; 20 new invitations a day.
-- * Invitations store the start time in UTC plus the IANA time zone it was planned in. A proposal of a
--   different time must be accepted by the other person before it counts as confirmed. Every change is
--   versioned, so a stale screen can't overwrite a newer answer. Nothing here creates a workout.
-- * These are private conversations, not end-to-end encrypted.
-- Additive only, apart from replacing on_block() and can_report_user() with extended versions.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);
create index conversations_b_idx on public.conversations (user_b);
alter table public.conversations enable row level security;
create policy "conversations: participants read" on public.conversations for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

create table public.conversation_state (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default 'epoch',
  muted boolean not null default false,
  primary key (conversation_id, user_id)
);
alter table public.conversation_state enable row level security;
create policy "conversation state: own read" on public.conversation_state for select to authenticated using (user_id = (select auth.uid()));

create table public.training_invites (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  from_id uuid not null references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  gym_id uuid references public.gyms(id) on delete set null,
  gym_name text not null check (char_length(btrim(gym_name)) between 1 and 120),
  starts_at timestamptz not null,
  time_zone text not null,
  workout_name text check (workout_name is null or char_length(workout_name) <= 80),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  proposed_by uuid not null references auth.users(id) on delete cascade,
  awaiting_id uuid references auth.users(id) on delete cascade,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_id <> to_id),
  check ((status = 'pending') = (awaiting_id is not null))
);
create index training_invites_conv_idx on public.training_invites (conversation_id);
create index training_invites_from_idx on public.training_invites (from_id, created_at);
alter table public.training_invites enable row level security;
create policy "training invites: participants read" on public.training_invites for select to authenticated
  using ((select auth.uid()) in (from_id, to_id));

create table public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'invite', 'invite_event')),
  body text check (body is null or char_length(body) between 1 and 2000),
  invite_id uuid references public.training_invites(id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((kind = 'text') = (body is not null and invite_id is null)),
  check (kind = 'text' or invite_id is not null)
);
create index messages_conv_idx on public.messages (conversation_id, created_at);
create index messages_sender_idx on public.messages (sender_id, created_at);
alter table public.messages enable row level security;
create policy "messages: participants read" on public.messages for select to authenticated
  using (
    exists (select 1 from public.conversations c where c.id = conversation_id and (select auth.uid()) in (c.user_a, c.user_b))
    and not exists (select 1 from public.reports r where r.reporter_id = (select auth.uid()) and r.target_type = 'message' and r.target_id = messages.id)
  );
-- No insert/update/delete policies: writes only through the functions below.

-- Realtime (Supabase): deliver new rows to subscribed participants; RLS decides who receives them.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages, public.training_invites;
  end if;
end $$;

-- ---------- helpers ----------
create or replace function public.can_message(me uuid, other uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when me is null or other is null or me = other then 'unavailable'
    when blocked_between(me, other) then 'unavailable'
    when not are_friends(me, other) then 'not_friends'
    when is_restricted(me) then 'restricted'
    else 'ok' end
$$;
revoke execute on function public.can_message(uuid, uuid) from public, anon, authenticated;

create or replace function public.conversation_with(me uuid, other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  insert into conversations (user_a, user_b) values (least(me, other), greatest(me, other))
  on conflict (user_a, user_b) do nothing;
  select id into cid from conversations where user_a = least(me, other) and user_b = greatest(me, other);
  insert into conversation_state (conversation_id, user_id) values (cid, me), (cid, other) on conflict do nothing;
  return cid;
end $$;
revoke execute on function public.conversation_with(uuid, uuid) from public, anon, authenticated;

create or replace function public.conversation_other(cid uuid, me uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when user_a = me then user_b when user_b = me then user_a end from conversations where id = cid
$$;
revoke execute on function public.conversation_other(uuid, uuid) from public, anon, authenticated;

-- ---------- messages ----------
create or replace function public.send_message(p_id uuid, p_to uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  m messages;
  cid uuid;
  ok text;
  b text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_id is null then return jsonb_build_object('status', 'invalid'); end if;
  -- Retry of a message that already arrived: return it unchanged.
  select * into m from messages where id = p_id;
  if found then
    if m.sender_id <> me then return jsonb_build_object('status', 'invalid'); end if;
    return jsonb_build_object('status', 'sent', 'id', m.id, 'conversation_id', m.conversation_id, 'created_at', m.created_at);
  end if;
  if char_length(b) = 0 or char_length(b) > 2000 then return jsonb_build_object('status', 'invalid'); end if;
  ok := can_message(me, p_to);
  if ok <> 'ok' then return jsonb_build_object('status', ok); end if;
  if (select count(*) from messages where sender_id = me and created_at > now() - interval '1 minute') >= 30
     or (select count(*) from messages where sender_id = me and created_at > now() - interval '24 hours') >= 1000 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  cid := conversation_with(me, p_to);
  insert into messages (id, conversation_id, sender_id, kind, body) values (p_id, cid, me, 'text', b)
  on conflict (id) do nothing
  returning * into m;
  if m.id is null then select * into m from messages where id = p_id and sender_id = me; end if;
  update conversations set last_message_at = m.created_at where id = cid;
  update conversation_state set last_read_at = greatest(last_read_at, m.created_at) where conversation_id = cid and user_id = me;
  return jsonb_build_object('status', 'sent', 'id', m.id, 'conversation_id', cid, 'created_at', m.created_at);
end $$;
revoke execute on function public.send_message(uuid, uuid, text) from public, anon;
grant execute on function public.send_message(uuid, uuid, text) to authenticated;

-- Conversation list for the caller, with unread counts and whether sending is possible now.
-- The preview is shown only inside the app; nothing here sends notifications.
create or replace function public.my_conversations()
returns table (conversation_id uuid, other_id uuid, display_name text, last_message_at timestamptz,
               last_kind text, last_body text, last_from_me boolean, unread integer, muted boolean, can_send text)
language sql stable security definer set search_path = public as $$
  select c.id, o.other, social_name(o.other), c.last_message_at,
         lm.kind, left(lm.body, 140), lm.sender_id = auth.uid(),
         (select count(*)::int from messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.created_at > coalesce(s.last_read_at, 'epoch')
             and not exists (select 1 from reports r where r.reporter_id = auth.uid() and r.target_type = 'message' and r.target_id = m.id)),
         coalesce(s.muted, false),
         can_message(auth.uid(), o.other)
    from conversations c
    cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as other) o
    left join conversation_state s on s.conversation_id = c.id and s.user_id = auth.uid()
    left join lateral (select m.kind, m.body, m.sender_id from messages m
                        where m.conversation_id = c.id
                          and not exists (select 1 from reports r where r.reporter_id = auth.uid() and r.target_type = 'message' and r.target_id = m.id)
                        order by m.created_at desc limit 1) lm on true
   where auth.uid() in (c.user_a, c.user_b)
     and exists (select 1 from messages m where m.conversation_id = c.id)
   order by c.last_message_at desc
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- Total unread from unmuted conversations, for a discreet badge (a number only, no content).
create or replace function public.unread_message_total() returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(unread) filter (where not muted), 0)::int from public.my_conversations()
$$;
revoke execute on function public.unread_message_total() from public, anon;
grant execute on function public.unread_message_total() to authenticated;

-- Open (or prepare) the conversation with a friend; returns its id. Needs friendship to create one.
create or replace function public.open_conversation(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select id into cid from conversations where user_a = least(me, p_other) and user_b = greatest(me, p_other);
  if cid is not null then return cid; end if;
  if can_message(me, p_other) <> 'ok' then raise exception 'cannot_message'; end if;
  return conversation_with(me, p_other);
end $$;
revoke execute on function public.open_conversation(uuid) from public, anon;
grant execute on function public.open_conversation(uuid) to authenticated;

create or replace function public.conversation_info(p_conversation uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when o is null then null else jsonb_build_object(
    'other_id', o, 'display_name', social_name(o), 'can_send', can_message(auth.uid(), o),
    'muted', coalesce((select muted from conversation_state where conversation_id = p_conversation and user_id = auth.uid()), false)) end
  from (select conversation_other(p_conversation, auth.uid()) as o) x
$$;
revoke execute on function public.conversation_info(uuid) from public, anon;
grant execute on function public.conversation_info(uuid) to authenticated;

create or replace function public.mark_conversation_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if conversation_other(p_conversation, auth.uid()) is null then return; end if;
  insert into conversation_state (conversation_id, user_id, last_read_at) values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = greatest(conversation_state.last_read_at, now());
end $$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace function public.set_conversation_muted(p_conversation uuid, p_muted boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if conversation_other(p_conversation, auth.uid()) is null then raise exception 'not_found'; end if;
  insert into conversation_state (conversation_id, user_id, muted) values (p_conversation, auth.uid(), p_muted)
  on conflict (conversation_id, user_id) do update set muted = excluded.muted;
end $$;
revoke execute on function public.set_conversation_muted(uuid, boolean) from public, anon;
grant execute on function public.set_conversation_muted(uuid, boolean) to authenticated;

-- ---------- training invitations ----------
create or replace function public.valid_time_zone(tz text) returns boolean
language sql stable as $$ select exists (select 1 from pg_timezone_names where name = tz) $$;

create or replace function public.invite_event(i training_invites, actor uuid, what text) returns void
language sql security definer set search_path = public as $$
  insert into messages (id, conversation_id, sender_id, kind, body, invite_id)
  values (gen_random_uuid(), i.conversation_id, actor, 'invite_event', what, i.id);
  update conversations set last_message_at = now() where id = i.conversation_id;
$$;
revoke execute on function public.invite_event(training_invites, uuid, text) from public, anon, authenticated;

create or replace function public.create_training_invite(
  p_id uuid, p_to uuid, p_gym_id uuid, p_gym_name text, p_starts_at timestamptz, p_time_zone text,
  p_workout_name text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ok text; cid uuid; i training_invites; gname text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into i from training_invites where id = p_id;
  if found then
    if i.from_id <> me then return jsonb_build_object('status', 'invalid'); end if;
    return jsonb_build_object('status', 'sent', 'id', i.id, 'conversation_id', i.conversation_id);
  end if;
  ok := can_message(me, p_to);
  if ok <> 'ok' then return jsonb_build_object('status', ok); end if;
  if not valid_time_zone(p_time_zone) then return jsonb_build_object('status', 'invalid_time_zone'); end if;
  if p_starts_at is null or p_starts_at < now() - interval '5 minutes' or p_starts_at > now() + interval '180 days' then
    return jsonb_build_object('status', 'invalid_time');
  end if;
  gname := coalesce((select name from gyms where id = p_gym_id), nullif(btrim(p_gym_name), ''));
  if gname is null then return jsonb_build_object('status', 'invalid_gym'); end if;
  if (select count(*) from training_invites where from_id = me and created_at > now() - interval '24 hours') >= 20 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  cid := conversation_with(me, p_to);
  insert into training_invites (id, conversation_id, from_id, to_id, gym_id, gym_name, starts_at, time_zone,
                                workout_name, note, proposed_by, awaiting_id)
  values (p_id, cid, me, p_to, p_gym_id, left(gname, 120), p_starts_at, p_time_zone,
          nullif(left(btrim(coalesce(p_workout_name, '')), 80), ''), nullif(left(btrim(coalesce(p_note, '')), 300), ''), me, p_to)
  returning * into i;
  insert into messages (id, conversation_id, sender_id, kind, invite_id) values (gen_random_uuid(), cid, me, 'invite', i.id);
  update conversations set last_message_at = now() where id = cid;
  return jsonb_build_object('status', 'sent', 'id', i.id, 'conversation_id', cid);
end $$;
revoke execute on function public.create_training_invite(uuid, uuid, uuid, text, timestamptz, text, text, text) from public, anon;
grant execute on function public.create_training_invite(uuid, uuid, uuid, text, timestamptz, text, text, text) to authenticated;

-- accept / decline: only the person the invitation is waiting on, only while pending.
-- propose: the person it's waiting on, or either person once accepted (reschedule). The other person
--          must then accept the new time.
-- cancel: either person, while pending or accepted.
create or replace function public.respond_training_invite(
  p_id uuid, p_action text, p_version integer, p_starts_at timestamptz default null, p_time_zone text default null)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); i training_invites; other uuid; ok text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into i from training_invites where id = p_id and me in (from_id, to_id) for update;
  if not found then return 'not_found'; end if;
  if i.version <> p_version then return 'stale'; end if;
  other := case when i.from_id = me then i.to_id else i.from_id end;

  if p_action = 'cancel' then
    if i.status not in ('pending', 'accepted') then return 'closed'; end if;
    update training_invites set status = 'cancelled', awaiting_id = null, version = version + 1, updated_at = now() where id = p_id returning * into i;
    perform invite_event(i, me, 'cancelled');
    return 'cancelled';
  end if;

  ok := can_message(me, other);
  if ok <> 'ok' then return ok; end if;

  if p_action in ('accept', 'decline') then
    if i.status <> 'pending' or i.awaiting_id <> me then return 'not_your_turn'; end if;
    update training_invites set status = case when p_action = 'accept' then 'accepted' else 'declined' end,
           awaiting_id = null, version = version + 1, updated_at = now() where id = p_id returning * into i;
    perform invite_event(i, me, case when p_action = 'accept' then 'accepted' else 'declined' end);
    return i.status;
  elsif p_action = 'propose' then
    if not ((i.status = 'pending' and i.awaiting_id = me) or i.status = 'accepted') then return 'not_your_turn'; end if;
    if not valid_time_zone(coalesce(p_time_zone, '')) then return 'invalid_time_zone'; end if;
    if p_starts_at is null or p_starts_at < now() - interval '5 minutes' or p_starts_at > now() + interval '180 days' then return 'invalid_time'; end if;
    update training_invites set starts_at = p_starts_at, time_zone = p_time_zone, status = 'pending', proposed_by = me,
           awaiting_id = other, version = version + 1, updated_at = now() where id = p_id returning * into i;
    perform invite_event(i, me, 'proposed');
    return 'proposed';
  end if;
  return 'invalid';
end $$;
revoke execute on function public.respond_training_invite(uuid, text, integer, timestamptz, text) from public, anon;
grant execute on function public.respond_training_invite(uuid, text, integer, timestamptz, text) to authenticated;

-- ---------- blocking and reporting, extended ----------
create or replace function public.on_block() returns trigger
language plpgsql security definer set search_path = public as $$
declare i training_invites;
begin
  delete from friendships where user_a = least(new.blocker_id, new.blocked_id) and user_b = greatest(new.blocker_id, new.blocked_id);
  update friend_requests set status = 'cancelled', responded_at = now()
   where status = 'pending' and ((from_id = new.blocker_id and to_id = new.blocked_id) or (from_id = new.blocked_id and to_id = new.blocker_id));
  for i in update training_invites set status = 'cancelled', awaiting_id = null, version = version + 1, updated_at = now()
            where status in ('pending', 'accepted')
              and ((from_id = new.blocker_id and to_id = new.blocked_id) or (from_id = new.blocked_id and to_id = new.blocker_id))
            returning * loop
    perform invite_event(i, new.blocker_id, 'cancelled');
  end loop;
  return new;
end $$;
revoke execute on function public.on_block() from public, anon, authenticated;

create or replace function public.can_report_user(me uuid, other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select are_friends(me, other)
      or exists (select 1 from friend_requests where (from_id = me and to_id = other) or (from_id = other and to_id = me))
      or exists (select 1 from blocks where blocker_id = me and blocked_id = other)
      or exists (select 1 from conversations where user_a = least(me, other) and user_b = greatest(me, other))
      or exists (select 1 from gym_memberships mine join gym_memberships them on them.gym_id = mine.gym_id
                  where mine.user_id = me and them.user_id = other and them.discoverable)
$$;
revoke execute on function public.can_report_user(uuid, uuid) from public, anon, authenticated;

-- A message report must name the message's real sender in a conversation the reporter is part of.
create or replace function public.check_message_report() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.target_type = 'message' and not exists (
    select 1 from messages m join conversations c on c.id = m.conversation_id
     where m.id = new.target_id and m.sender_id = new.reported_user_id and new.reporter_id in (c.user_a, c.user_b)) then
    raise exception 'invalid_report_target';
  end if;
  return new;
end $$;
revoke execute on function public.check_message_report() from public, anon, authenticated;
create trigger check_message_report before insert on public.reports for each row execute function public.check_message_report();
