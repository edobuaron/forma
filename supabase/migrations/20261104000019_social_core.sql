-- Community, stage 1: gyms, opt-in discovery, friend requests, friends, blocks, reports, rate limits.
--
-- Privacy rules enforced here (not only in the app):
-- * Nothing private becomes readable by other users. Other people's names are only returned by the
--   security-definer functions below, and only for people the caller already has a reason to see
--   (friends, requests between the two, opted-in members of the caller's own gym branch).
-- * A gym is a specific branch. Gyms are a shared, unofficial directory unless verified = true
--   (only settable by an admin in the dashboard). New gyms go through add_gym(), which returns the
--   existing branch instead of creating a duplicate.
-- * "My gym" (gym_memberships) and "let people at this gym discover me" (discoverable) are separate.
--   discoverable is off by default and switches off again whenever the gym changes.
-- * Friend requests: one pending request per pair; after a decline the sender waits 30 days, and
--   after two declines can't ask again (the other person still can). Requests to strangers only work
--   for opted-in members of the sender's own gym; invite links are the other way to connect.
-- * Blocking removes the friendship, cancels pending requests, and blocks requests both ways.
-- * Reports are stored for review. A reported account with open reports from 3 different people is
--   restricted: no friend requests, invites or (later stages) messages and posts until reviewed.
-- * Rate limits: 20 friend requests, 10 invite links, 5 new gyms, 10 reports per rolling 24 hours.
-- Additive only: no existing table or data is changed.

-- ---------- helpers ----------
create or replace function public.social_norm(t text) returns text
language sql immutable as $$
  select regexp_replace(lower(coalesce(t, '')), '[^[:alnum:]]+', '', 'g')
$$;

create or replace function public.social_name(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(display_name), ''), 'Forma member') from profiles where id = uid
$$;
revoke execute on function public.social_name(uuid) from public, anon, authenticated;

-- ---------- gyms ----------
create table public.gyms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  chain text check (chain is null or char_length(btrim(chain)) between 1 and 60),
  address text not null check (char_length(btrim(address)) between 3 and 160),
  city text not null check (char_length(btrim(city)) between 1 and 80),
  country text not null check (country ~ '^[A-Z]{2}$'),
  dedupe_key text not null unique,
  verified boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index gyms_city_idx on public.gyms (lower(city));
alter table public.gyms enable row level security;
create policy "gyms: read" on public.gyms for select to authenticated using (true);
-- No insert/update/delete policies: new gyms only through add_gym().

create table public.gym_memberships (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  gym_id uuid not null references public.gyms(id) on delete cascade,
  discoverable boolean not null default false,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gym_memberships_gym_idx on public.gym_memberships (gym_id) where discoverable;
alter table public.gym_memberships enable row level security;
create policy "own membership: select" on public.gym_memberships for select to authenticated using (user_id = (select auth.uid()));
create policy "own membership: insert" on public.gym_memberships for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own membership: update" on public.gym_memberships for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own membership: delete" on public.gym_memberships for delete to authenticated using (user_id = (select auth.uid()));

-- Changing gym switches discovery off: opting in is per branch. Joining starts undiscoverable unless the
-- same statement explicitly asks for it (the app never does on join).
create or replace function public.gym_membership_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id then raise exception 'membership owner cannot change'; end if;
    if new.gym_id <> old.gym_id then
      new.discoverable := false;
      new.joined_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger gym_membership_guard before insert or update on public.gym_memberships
  for each row execute function public.gym_membership_guard();

-- ---------- friends ----------
create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  source text not null default 'gym' check (source in ('gym', 'invite')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_id <> to_id)
);
create unique index friend_requests_one_pending on public.friend_requests
  (least(from_id, to_id), greatest(from_id, to_id)) where status = 'pending';
create index friend_requests_to_idx on public.friend_requests (to_id, status);
create index friend_requests_from_idx on public.friend_requests (from_id, created_at);
alter table public.friend_requests enable row level security;
create policy "requests: participants read" on public.friend_requests for select to authenticated
  using ((select auth.uid()) in (from_id, to_id));

create table public.friendships (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_b_idx on public.friendships (user_b);
alter table public.friendships enable row level security;
create policy "friendships: participants read" on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

create table public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);
alter table public.blocks enable row level security;
-- Only the blocker sees a block; the blocked person is never told.
create policy "blocks: blocker reads" on public.blocks for select to authenticated using (blocker_id = (select auth.uid()));

create table public.friend_invites (
  code text primary key default replace(gen_random_uuid()::text, '-', ''),
  inviter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz
);
create index friend_invites_inviter_idx on public.friend_invites (inviter_id, created_at);
alter table public.friend_invites enable row level security;
create policy "invites: inviter reads" on public.friend_invites for select to authenticated using (inviter_id = (select auth.uid()));

-- ---------- reports ----------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'gym', 'message', 'post', 'comment')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'impersonation', 'other')),
  details text check (details is null or char_length(details) <= 500),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (reporter_id, target_type, target_id),
  check (reporter_id <> reported_user_id)
);
create index reports_reported_idx on public.reports (reported_user_id) where status = 'open';
alter table public.reports enable row level security;
-- Reporters see their own reports (used to hide what they reported). Nobody else reads them in the app.
create policy "reports: reporter reads" on public.reports for select to authenticated using (reporter_id = (select auth.uid()));

-- ---------- relationship helpers (always relative to the caller) ----------
create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where user_a = least(a, b) and user_b = greatest(a, b))
$$;
revoke execute on function public.are_friends(uuid, uuid) from public, anon, authenticated;

create or replace function public.blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;
revoke execute on function public.blocked_between(uuid, uuid) from public, anon, authenticated;

create or replace function public.is_restricted(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(distinct reporter_id) from reports where reported_user_id = uid and status = 'open') >= 3
$$;
revoke execute on function public.is_restricted(uuid) from public, anon, authenticated;

-- Caller-relative versions for the app and for RLS in later stages.
create or replace function public.is_friend(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.are_friends(auth.uid(), other) and not public.blocked_between(auth.uid(), other)
$$;
revoke execute on function public.is_friend(uuid) from public, anon;
grant execute on function public.is_friend(uuid) to authenticated;

create or replace function public.my_social_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('restricted', public.is_restricted(auth.uid()))
$$;
revoke execute on function public.my_social_status() from public, anon;
grant execute on function public.my_social_status() to authenticated;

-- ---------- gyms: add and list people ----------
create or replace function public.add_gym(p_name text, p_chain text, p_address text, p_city text, p_country text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  k text;
  existing uuid;
  new_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  p_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  p_chain := nullif(btrim(regexp_replace(coalesce(p_chain, ''), '[[:cntrl:]]', '', 'g')), '');
  p_address := btrim(regexp_replace(coalesce(p_address, ''), '[[:cntrl:]]', '', 'g'));
  p_city := btrim(regexp_replace(coalesce(p_city, ''), '[[:cntrl:]]', '', 'g'));
  p_country := upper(btrim(coalesce(p_country, '')));
  k := social_norm(p_name) || '|' || social_norm(p_address) || '|' || social_norm(p_city) || '|' || p_country;
  select id into existing from gyms where dedupe_key = k;
  if existing is not null then return jsonb_build_object('id', existing, 'created', false); end if;
  if is_restricted(me) then return jsonb_build_object('error', 'restricted'); end if;
  if (select count(*) from gyms where created_by = me and created_at > now() - interval '24 hours') >= 5 then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  insert into gyms (name, chain, address, city, country, dedupe_key, created_by)
  values (p_name, p_chain, p_address, p_city, p_country, k, me)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'created', true);
end $$;
revoke execute on function public.add_gym(text, text, text, text, text) from public, anon;
grant execute on function public.add_gym(text, text, text, text, text) to authenticated;

-- Relationship label between the caller and another user.
create or replace function public.social_relation(me uuid, other uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when are_friends(me, other) then 'friends'
    when exists (select 1 from friend_requests where from_id = me and to_id = other and status = 'pending') then 'request_sent'
    when exists (select 1 from friend_requests where from_id = other and to_id = me and status = 'pending') then 'request_received'
    else 'none' end
$$;
revoke execute on function public.social_relation(uuid, uuid) from public, anon, authenticated;

-- Opted-in members of the caller's own gym. Nothing for other gyms, nothing if the caller left.
create or replace function public.gym_people(p_gym_id uuid)
returns table (user_id uuid, display_name text, relation text)
language sql stable security definer set search_path = public as $$
  select m.user_id, social_name(m.user_id), social_relation(auth.uid(), m.user_id)
    from gym_memberships m
   where m.gym_id = p_gym_id
     and m.discoverable
     and m.user_id <> auth.uid()
     and exists (select 1 from gym_memberships mine where mine.user_id = auth.uid() and mine.gym_id = p_gym_id)
     and not blocked_between(auth.uid(), m.user_id)
   order by social_name(m.user_id), m.user_id
   limit 200
$$;
revoke execute on function public.gym_people(uuid) from public, anon;
grant execute on function public.gym_people(uuid) to authenticated;

-- Real counts the caller is allowed to see: opted-in members (excluding blocked) and the caller's
-- friends who chose to be discoverable at this branch.
create or replace function public.gym_counts(p_gym_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'visible_members', count(*) filter (where m.discoverable and m.user_id <> auth.uid() and not blocked_between(auth.uid(), m.user_id)),
    'friends_here', count(*) filter (where m.discoverable and m.user_id <> auth.uid() and are_friends(auth.uid(), m.user_id) and not blocked_between(auth.uid(), m.user_id)))
  from gym_memberships m
  where m.gym_id = p_gym_id
    and exists (select 1 from gym_memberships mine where mine.user_id = auth.uid() and mine.gym_id = p_gym_id)
$$;
revoke execute on function public.gym_counts(uuid) from public, anon;
grant execute on function public.gym_counts(uuid) to authenticated;

-- ---------- friend requests ----------
create or replace function public.make_friends(a uuid, b uuid) returns void
language sql security definer set search_path = public as $$
  insert into friendships (user_a, user_b) values (least(a, b), greatest(a, b)) on conflict do nothing;
$$;
revoke execute on function public.make_friends(uuid, uuid) from public, anon, authenticated;

create or replace function public.send_friend_request(p_to uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  incoming uuid;
  declines int;
  last_decline timestamptz;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_to is null or p_to = me then return 'unavailable'; end if;
  if is_restricted(me) then return 'restricted'; end if;
  -- Strangers can only be reached when they opted in at the caller's own gym.
  if not exists (select 1 from gym_memberships mine join gym_memberships them on them.gym_id = mine.gym_id
                  where mine.user_id = me and them.user_id = p_to and them.discoverable)
     and not exists (select 1 from friend_requests where from_id = p_to and to_id = me and status = 'pending') then
    return 'unavailable';
  end if;
  if blocked_between(me, p_to) then return 'unavailable'; end if;
  if are_friends(me, p_to) then return 'already_friends'; end if;
  perform pg_advisory_xact_lock(hashtextextended(least(me, p_to)::text || greatest(me, p_to)::text, 0));
  if exists (select 1 from friend_requests where from_id = me and to_id = p_to and status = 'pending') then return 'already_sent'; end if;
  -- They already asked: sending back accepts.
  select id into incoming from friend_requests where from_id = p_to and to_id = me and status = 'pending';
  if incoming is not null then
    update friend_requests set status = 'accepted', responded_at = now() where id = incoming;
    perform make_friends(me, p_to);
    return 'accepted';
  end if;
  select count(*), max(responded_at) into declines, last_decline
    from friend_requests where from_id = me and to_id = p_to and status = 'declined';
  if declines >= 2 then return 'unavailable'; end if;
  if last_decline > now() - interval '30 days' then return 'too_soon'; end if;
  if (select count(*) from friend_requests where from_id = me and created_at > now() - interval '24 hours') >= 20 then
    return 'rate_limited';
  end if;
  insert into friend_requests (from_id, to_id, source) values (me, p_to, 'gym');
  return 'sent';
end $$;
revoke execute on function public.send_friend_request(uuid) from public, anon;
grant execute on function public.send_friend_request(uuid) to authenticated;

create or replace function public.respond_friend_request(p_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); r friend_requests;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into r from friend_requests where id = p_id and to_id = me for update;
  if not found or r.status <> 'pending' then return 'not_pending'; end if;
  if p_accept and blocked_between(me, r.from_id) then return 'unavailable'; end if;
  update friend_requests set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = p_id;
  if p_accept then perform make_friends(me, r.from_id); return 'accepted'; end if;
  return 'declined';
end $$;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

create or replace function public.cancel_friend_request(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  update friend_requests set status = 'cancelled', responded_at = now()
   where id = p_id and from_id = auth.uid() and status = 'pending';
  return case when found then 'cancelled' else 'not_pending' end;
end $$;
revoke execute on function public.cancel_friend_request(uuid) from public, anon;
grant execute on function public.cancel_friend_request(uuid) to authenticated;

create or replace function public.remove_friend(p_other uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  delete from friendships where user_a = least(me, p_other) and user_b = greatest(me, p_other);
  return case when found then 'removed' else 'not_friends' end;
end $$;
revoke execute on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;

-- Lists with names, for the caller only.
create or replace function public.my_friends()
returns table (user_id uuid, display_name text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select case when f.user_a = auth.uid() then f.user_b else f.user_a end,
         social_name(case when f.user_a = auth.uid() then f.user_b else f.user_a end),
         f.created_at
    from friendships f
   where auth.uid() in (f.user_a, f.user_b)
     and not blocked_between(f.user_a, f.user_b)
   order by 2, 1
$$;
revoke execute on function public.my_friends() from public, anon;
grant execute on function public.my_friends() to authenticated;

create or replace function public.my_friend_requests()
returns table (id uuid, direction text, other_id uuid, display_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id,
         case when r.to_id = auth.uid() then 'incoming' else 'outgoing' end,
         case when r.to_id = auth.uid() then r.from_id else r.to_id end,
         social_name(case when r.to_id = auth.uid() then r.from_id else r.to_id end),
         r.created_at
    from friend_requests r
   where r.status = 'pending' and auth.uid() in (r.from_id, r.to_id)
     and not blocked_between(r.from_id, r.to_id)
   order by r.created_at desc
$$;
revoke execute on function public.my_friend_requests() from public, anon;
grant execute on function public.my_friend_requests() to authenticated;

create or replace function public.my_blocked()
returns table (user_id uuid, display_name text, blocked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.blocked_id, social_name(b.blocked_id), b.created_at from blocks b where b.blocker_id = auth.uid() order by b.created_at desc
$$;
revoke execute on function public.my_blocked() from public, anon;
grant execute on function public.my_blocked() to authenticated;

-- ---------- invite links ----------
create or replace function public.create_friend_invite() returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if is_restricted(me) then raise exception 'restricted'; end if;
  if (select count(*) from friend_invites where inviter_id = me and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into friend_invites (inviter_id) values (me) returning code into c;
  return c;
end $$;
revoke execute on function public.create_friend_invite() from public, anon;
grant execute on function public.create_friend_invite() to authenticated;

create or replace function public.friend_invite_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare i friend_invites; me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into i from friend_invites where code = p_code;
  if not found or i.accepted_at is not null or i.expires_at < now() or blocked_between(me, i.inviter_id) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if i.inviter_id = me then return jsonb_build_object('status', 'own'); end if;
  return jsonb_build_object('status', case when are_friends(me, i.inviter_id) then 'already_friends' else 'valid' end,
                            'display_name', social_name(i.inviter_id));
end $$;
revoke execute on function public.friend_invite_preview(text) from public, anon;
grant execute on function public.friend_invite_preview(text) to authenticated;

create or replace function public.accept_friend_invite(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare i friend_invites; me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into i from friend_invites where code = p_code for update;
  if not found or i.accepted_at is not null or i.expires_at < now() or i.inviter_id = me or blocked_between(me, i.inviter_id) then
    return 'invalid';
  end if;
  if is_restricted(me) then return 'restricted'; end if;
  update friend_invites set accepted_by = me, accepted_at = now() where code = p_code;
  update friend_requests set status = 'accepted', responded_at = now()
   where status = 'pending' and ((from_id = me and to_id = i.inviter_id) or (from_id = i.inviter_id and to_id = me));
  perform make_friends(me, i.inviter_id);
  return 'accepted';
end $$;
revoke execute on function public.accept_friend_invite(text) from public, anon;
grant execute on function public.accept_friend_invite(text) to authenticated;

-- ---------- blocking ----------
-- Cleanup runs in a trigger so later stages (messages, invitations, posts) can extend it in one place.
create or replace function public.on_block() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from friendships where user_a = least(new.blocker_id, new.blocked_id) and user_b = greatest(new.blocker_id, new.blocked_id);
  update friend_requests set status = 'cancelled', responded_at = now()
   where status = 'pending' and ((from_id = new.blocker_id and to_id = new.blocked_id) or (from_id = new.blocked_id and to_id = new.blocker_id));
  -- Invite links are not addressed to a person; accept_friend_invite refuses them while a block exists.
  return new;
end $$;
revoke execute on function public.on_block() from public, anon, authenticated;
create trigger on_block after insert on public.blocks for each row execute function public.on_block();

create or replace function public.block_user(p_other uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_other is null or p_other = me then return 'invalid'; end if;
  if not exists (select 1 from auth.users where id = p_other) then return 'invalid'; end if;
  insert into blocks (blocker_id, blocked_id) values (me, p_other) on conflict do nothing;
  return 'blocked';
end $$;
revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.unblock_user(p_other uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from blocks where blocker_id = auth.uid() and blocked_id = p_other;
  return case when found then 'unblocked' else 'not_blocked' end;
end $$;
revoke execute on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------- reports ----------
-- Who the caller may report: someone they have a visible connection with. Later stages extend this
-- (message senders, post and comment authors) by replacing the function.
create or replace function public.can_report_user(me uuid, other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select are_friends(me, other)
      or exists (select 1 from friend_requests where (from_id = me and to_id = other) or (from_id = other and to_id = me))
      or exists (select 1 from blocks where blocker_id = me and blocked_id = other)
      or exists (select 1 from gym_memberships mine join gym_memberships them on them.gym_id = mine.gym_id
                  where mine.user_id = me and them.user_id = other and them.discoverable)
$$;
revoke execute on function public.can_report_user(uuid, uuid) from public, anon, authenticated;

create or replace function public.report_content(p_target_type text, p_target_id uuid, p_reported_user uuid, p_reason text, p_details text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_reported_user is null or p_reported_user = me then return 'invalid'; end if;
  if p_target_type = 'user' and p_target_id <> p_reported_user then return 'invalid'; end if;
  if p_target_type = 'gym' then
    if not exists (select 1 from gyms where id = p_target_id and created_by = p_reported_user) then return 'invalid'; end if;
  elsif not can_report_user(me, p_reported_user) then
    return 'invalid';
  end if;
  if exists (select 1 from reports where reporter_id = me and target_type = p_target_type and target_id = p_target_id) then
    return 'already_reported';
  end if;
  if (select count(*) from reports where reporter_id = me and created_at > now() - interval '24 hours') >= 10 then
    return 'rate_limited';
  end if;
  insert into reports (reporter_id, reported_user_id, target_type, target_id, reason, details)
  values (me, p_reported_user, p_target_type, p_target_id, p_reason,
          nullif(btrim(regexp_replace(coalesce(p_details, ''), '[[:cntrl:]]', ' ', 'g')), ''));
  return 'reported';
end $$;
revoke execute on function public.report_content(text, uuid, uuid, text, text) from public, anon;
grant execute on function public.report_content(text, uuid, uuid, text, text) to authenticated;

revoke execute on function public.gym_membership_guard() from public, anon, authenticated;
