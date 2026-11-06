-- Community, stage 3: shared workouts and gym-buddy invitations, with reactions and comments.
--
-- * Every post has an explicit audience chosen when posting: 'friends' or 'gym' (the author's gym at
--   that moment, stored on the post). Joining a gym never shares anything and never widens existing
--   posts; leaving the gym hides your gym posts there; changing gym doesn't move them.
-- * Workout posts are snapshots built here from a completed workout the caller owns, using only what
--   the author chose (loads, reps, duration, runs). Notes, body measurements, bodyweight, energy rating
--   and shortfall reasons are never included. Editing the workout doesn't change the post; deleting
--   the workout deletes its posts. preview_workout_share() returns exactly what would be stored.
-- * Viewers read only posts, reactions and comments (RLS), never the underlying workout tables.
--   Visibility is checked on every read: friendship / gym membership now, no block either way,
--   and nothing the viewer reported.
-- * Comments: friends-of-the-post only (same visibility), 30 an hour; authors delete their own,
--   post authors moderate comments on their posts. Reactions: one per person per post from a fixed set.
-- * Restricted accounts (3+ open reports) can't post, comment or react.
-- Additive only, apart from replacing report_content() so posts and comments can be reported.

create table public.posts (
  id uuid primary key,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('workout', 'buddy')),
  audience text not null check (audience in ('friends', 'gym')),
  gym_id uuid references public.gyms(id) on delete cascade,
  source_session_id uuid references public.workout_sessions(id) on delete cascade,
  caption text check (caption is null or char_length(caption) <= 500),
  snapshot jsonb,
  -- gym-buddy invitation
  starts_at timestamptz,
  time_zone text,
  workout_name text check (workout_name is null or char_length(workout_name) <= 80),
  created_at timestamptz not null default now(),
  check ((audience = 'gym') = (gym_id is not null)),
  check (kind <> 'workout' or (source_session_id is not null and snapshot is not null)),
  check (kind <> 'buddy' or (starts_at is not null and time_zone is not null and source_session_id is null))
);
create unique index posts_one_per_session_audience on public.posts (source_session_id, audience) where source_session_id is not null;
create index posts_author_idx on public.posts (author_id, created_at desc);
create index posts_gym_idx on public.posts (gym_id, created_at desc) where gym_id is not null;

create table public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('❤️', '💪', '🔥', '👏', '🏋️', '😮')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_comments (
  id uuid primary key,
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index post_comments_post_idx on public.post_comments (post_id, created_at);
create index post_comments_author_idx on public.post_comments (author_id, created_at);

-- Can the caller see a post with this author/audience/gym right now?
create or replace function public.can_view_post(p_author uuid, p_audience text, p_gym uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    p_author = auth.uid()
    or (not blocked_between(auth.uid(), p_author) and (
         (p_audience = 'friends' and are_friends(auth.uid(), p_author))
      or (p_audience = 'gym'
          and exists (select 1 from gym_memberships where user_id = auth.uid() and gym_id = p_gym)
          and exists (select 1 from gym_memberships where user_id = p_author and gym_id = p_gym)))))
$$;
revoke execute on function public.can_view_post(uuid, text, uuid) from public, anon;
grant execute on function public.can_view_post(uuid, text, uuid) to authenticated;

create or replace function public.reported_by_me(p_type text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from reports where reporter_id = auth.uid() and target_type = p_type and target_id = p_id)
$$;
revoke execute on function public.reported_by_me(text, uuid) from public, anon;
grant execute on function public.reported_by_me(text, uuid) to authenticated;

create or replace function public.post_visible(p_post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from posts p where p.id = p_post and can_view_post(p.author_id, p.audience, p.gym_id) and not reported_by_me('post', p.id))
$$;
revoke execute on function public.post_visible(uuid) from public, anon;
grant execute on function public.post_visible(uuid) to authenticated;

-- Caller-relative block check for RLS policies. (Hiding content from blocked accounts is itself
-- observable, so this reveals nothing the screens don't.)
create or replace function public.blocked_with(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select blocked_between(auth.uid(), p_other)
$$;
revoke execute on function public.blocked_with(uuid) from public, anon;
grant execute on function public.blocked_with(uuid) to authenticated;

alter table public.posts enable row level security;
create policy "posts: visible" on public.posts for select to authenticated
  using (public.can_view_post(author_id, audience, gym_id) and not public.reported_by_me('post', id));
create policy "posts: author deletes" on public.posts for delete to authenticated using (author_id = (select auth.uid()));

alter table public.post_reactions enable row level security;
create policy "reactions: visible" on public.post_reactions for select to authenticated
  using (public.post_visible(post_id) and (user_id = (select auth.uid()) or not public.blocked_with(user_id)));

alter table public.post_comments enable row level security;
create policy "comments: visible" on public.post_comments for select to authenticated
  using (public.post_visible(post_id)
         and (author_id = (select auth.uid()) or not public.blocked_with(author_id))
         and not public.reported_by_me('comment', id));
-- Post authors moderate comments on their posts; commenters delete their own.
create policy "comments: delete own or on own post" on public.post_comments for delete to authenticated
  using (author_id = (select auth.uid()) or exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())));

-- ---------- workout snapshot ----------
-- p_include: {"loads": bool, "reps": bool, "duration": bool, "runs": bool}. Missing keys = true.
create or replace function public.workout_share_snapshot(p_session uuid, p_include jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s workout_sessions;
  inc_loads boolean := coalesce((p_include->>'loads')::boolean, true);
  inc_reps boolean := coalesce((p_include->>'reps')::boolean, true);
  inc_dur boolean := coalesce((p_include->>'duration')::boolean, true);
  inc_runs boolean := coalesce((p_include->>'runs')::boolean, true);
  ex jsonb;
  rn jsonb;
begin
  select * into s from workout_sessions where id = p_session and user_id = auth.uid() and status = 'completed';
  if not found then return null; end if;
  select coalesce(jsonb_agg(e order by e_pos), '[]'::jsonb) into ex from (
    select se.position as e_pos, jsonb_strip_nulls(jsonb_build_object(
      'name', x.name,
      'convention', case when inc_loads then x.weight_convention end,
      'sets', (select coalesce(jsonb_agg(jsonb_strip_nulls(case when l.sided then jsonb_build_object(
                  'left', case when l.left_completed then jsonb_strip_nulls(jsonb_build_object(
                     'kg', case when inc_loads then l.left_weight_kg end, 'assist_kg', case when inc_loads then l.left_assistance_kg end,
                     'reps', case when inc_reps then l.left_reps end)) end,
                  'right', case when l.right_completed then jsonb_strip_nulls(jsonb_build_object(
                     'kg', case when inc_loads then l.right_weight_kg end, 'assist_kg', case when inc_loads then l.right_assistance_kg end,
                     'reps', case when inc_reps then l.right_reps end)) end)
                else jsonb_build_object('kg', case when inc_loads then l.weight_kg end, 'assist_kg', case when inc_loads then l.assistance_kg end,
                     'reps', case when inc_reps then l.reps end) end) order by l.position), '[]'::jsonb)
               from set_logs l where l.session_exercise_id = se.id and l.kind = 'working' and l.completed)
    )) as e
    from session_exercises se join exercises x on x.id = se.exercise_id
    where se.session_id = s.id
      and exists (select 1 from set_logs l where l.session_exercise_id = se.id and l.kind = 'working' and l.completed)
  ) q;
  if inc_runs then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', r.name, 'duration_s', r.duration_s, 'distance_m', r.distance_m)) order by r.position), '[]'::jsonb)
      into rn from session_runs r where r.session_id = s.id and r.completed;
  else rn := '[]'::jsonb; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'name', s.name,
    'started_at', s.started_at,
    'duration_min', case when inc_dur and s.ended_at is not null then round(extract(epoch from (s.ended_at - s.started_at)) / 60) end,
    'exercises', ex,
    'runs', rn,
    'include', jsonb_build_object('loads', inc_loads, 'reps', inc_reps, 'duration', inc_dur, 'runs', inc_runs)));
end $$;
revoke execute on function public.workout_share_snapshot(uuid, jsonb) from public, anon, authenticated;

create or replace function public.preview_workout_share(p_session uuid, p_include jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select workout_share_snapshot(p_session, p_include)
$$;
revoke execute on function public.preview_workout_share(uuid, jsonb) from public, anon;
grant execute on function public.preview_workout_share(uuid, jsonb) to authenticated;

create or replace function public.post_rate_ok(me uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from posts where author_id = me and created_at > now() - interval '24 hours') < 20
$$;
revoke execute on function public.post_rate_ok(uuid) from public, anon, authenticated;

create or replace function public.my_gym_id() returns uuid
language sql stable security definer set search_path = public as $$
  select gym_id from gym_memberships where user_id = auth.uid()
$$;
revoke execute on function public.my_gym_id() from public, anon, authenticated;

create or replace function public.share_workout(p_id uuid, p_session uuid, p_audience text, p_include jsonb, p_caption text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); snap jsonb; g uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from posts where id = p_id) then
    return case when exists (select 1 from posts where id = p_id and author_id = me) then 'shared' else 'invalid' end;
  end if;
  if p_audience not in ('friends', 'gym') then return 'invalid'; end if;
  if is_restricted(me) then return 'restricted'; end if;
  if not post_rate_ok(me) then return 'rate_limited'; end if;
  snap := workout_share_snapshot(p_session, p_include);
  if snap is null then return 'not_found'; end if;
  if p_audience = 'gym' then g := my_gym_id(); if g is null then return 'no_gym'; end if; end if;
  if exists (select 1 from posts where source_session_id = p_session and audience = p_audience) then return 'already_shared'; end if;
  insert into posts (id, author_id, kind, audience, gym_id, source_session_id, caption, snapshot)
  values (p_id, me, 'workout', p_audience, g, p_session, nullif(left(btrim(coalesce(p_caption, '')), 500), ''), snap);
  return 'shared';
end $$;
revoke execute on function public.share_workout(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.share_workout(uuid, uuid, text, jsonb, text) to authenticated;

create or replace function public.post_buddy_invite(p_id uuid, p_audience text, p_starts_at timestamptz, p_time_zone text, p_workout_name text, p_caption text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from posts where id = p_id) then
    return case when exists (select 1 from posts where id = p_id and author_id = me) then 'shared' else 'invalid' end;
  end if;
  if p_audience not in ('friends', 'gym') then return 'invalid'; end if;
  if is_restricted(me) then return 'restricted'; end if;
  if not post_rate_ok(me) then return 'rate_limited'; end if;
  if not valid_time_zone(coalesce(p_time_zone, '')) then return 'invalid_time_zone'; end if;
  if p_starts_at is null or p_starts_at < now() - interval '5 minutes' or p_starts_at > now() + interval '60 days' then return 'invalid_time'; end if;
  if p_audience = 'gym' then g := my_gym_id(); if g is null then return 'no_gym'; end if; end if;
  insert into posts (id, author_id, kind, audience, gym_id, caption, starts_at, time_zone, workout_name)
  values (p_id, me, 'buddy', p_audience, g, nullif(left(btrim(coalesce(p_caption, '')), 500), ''), p_starts_at, p_time_zone,
          nullif(left(btrim(coalesce(p_workout_name, '')), 80), ''));
  return 'shared';
end $$;
revoke execute on function public.post_buddy_invite(uuid, text, timestamptz, text, text, text) from public, anon;
grant execute on function public.post_buddy_invite(uuid, text, timestamptz, text, text, text) to authenticated;

-- ---------- reactions and comments ----------
create or replace function public.react_to_post(p_post uuid, p_emoji text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not post_visible(p_post) then return 'not_found'; end if;
  if p_emoji is null then delete from post_reactions where post_id = p_post and user_id = me; return 'removed'; end if;
  if is_restricted(me) then return 'restricted'; end if;
  insert into post_reactions (post_id, user_id, emoji) values (p_post, me, p_emoji)
  on conflict (post_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  return 'reacted';
end $$;
revoke execute on function public.react_to_post(uuid, text) from public, anon;
grant execute on function public.react_to_post(uuid, text) to authenticated;

create or replace function public.add_comment(p_id uuid, p_post uuid, p_body text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); b text := btrim(regexp_replace(coalesce(p_body, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
begin
  if me is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from post_comments where id = p_id) then
    return case when exists (select 1 from post_comments where id = p_id and author_id = me) then 'added' else 'invalid' end;
  end if;
  if not post_visible(p_post) then return 'not_found'; end if;
  if char_length(b) = 0 or char_length(b) > 500 then return 'invalid'; end if;
  if is_restricted(me) then return 'restricted'; end if;
  if (select count(*) from post_comments where author_id = me and created_at > now() - interval '1 hour') >= 30 then return 'rate_limited'; end if;
  insert into post_comments (id, post_id, author_id, body) values (p_id, p_post, me, b);
  return 'added';
end $$;
revoke execute on function public.add_comment(uuid, uuid, text) from public, anon;
grant execute on function public.add_comment(uuid, uuid, text) to authenticated;

-- Feed rows with names and counts (names are only returned for posts the caller can see).
create or replace function public.community_feed(p_scope text, p_limit integer default 30, p_before timestamptz default null)
returns table (id uuid, author_id uuid, author_name text, kind text, audience text, gym_id uuid, caption text, snapshot jsonb,
               starts_at timestamptz, time_zone text, workout_name text, created_at timestamptz,
               reactions jsonb, my_reaction text, comment_count integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.author_id, social_name(p.author_id), p.kind, p.audience, p.gym_id, p.caption, p.snapshot,
         p.starts_at, p.time_zone, p.workout_name, p.created_at,
         coalesce((select jsonb_object_agg(emoji, n) from (select r.emoji, count(*) n from post_reactions r
                    where r.post_id = p.id and (r.user_id = auth.uid() or not blocked_between(auth.uid(), r.user_id)) group by r.emoji) z), '{}'::jsonb),
         (select r.emoji from post_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
         (select count(*)::int from post_comments c where c.post_id = p.id
            and (c.author_id = auth.uid() or not blocked_between(auth.uid(), c.author_id)) and not reported_by_me('comment', c.id))
    from posts p
   where can_view_post(p.author_id, p.audience, p.gym_id) and not reported_by_me('post', p.id)
     and (p_before is null or p.created_at < p_before)
     and case p_scope
           when 'friends' then p.audience = 'friends'
           when 'gym' then p.audience = 'gym' and p.gym_id = my_gym_id()
           when 'buddy' then p.kind = 'buddy' and p.audience = 'gym' and p.gym_id = my_gym_id() and p.starts_at > now() - interval '2 hours'
           when 'mine' then p.author_id = auth.uid()
           else false end
   order by case when p_scope = 'buddy' then p.starts_at end asc, p.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function public.community_feed(text, integer, timestamptz) from public, anon;
grant execute on function public.community_feed(text, integer, timestamptz) to authenticated;

create or replace function public.post_comments_with_names(p_post uuid)
returns table (id uuid, author_id uuid, author_name text, body text, created_at timestamptz, can_delete boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.author_id, social_name(c.author_id), c.body, c.created_at,
         c.author_id = auth.uid() or p.author_id = auth.uid()
    from post_comments c join posts p on p.id = c.post_id
   where c.post_id = p_post and post_visible(p_post)
     and (c.author_id = auth.uid() or not blocked_between(auth.uid(), c.author_id))
     and not reported_by_me('comment', c.id)
   order by c.created_at
$$;
revoke execute on function public.post_comments_with_names(uuid) from public, anon;
grant execute on function public.post_comments_with_names(uuid) to authenticated;

-- Real activity counts for the gym screen: posts visible to the caller in the last 7 days.
create or replace function public.gym_activity(p_gym uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'posts_7d', count(*) filter (where p.kind = 'workout'),
    'buddy_upcoming', (select count(*) from posts b where b.gym_id = p_gym and b.kind = 'buddy' and b.starts_at > now()
                         and can_view_post(b.author_id, b.audience, b.gym_id) and not reported_by_me('post', b.id)))
  from posts p
  where p.gym_id = p_gym and p.created_at > now() - interval '7 days'
    and can_view_post(p.author_id, p.audience, p.gym_id) and not reported_by_me('post', p.id)
$$;
revoke execute on function public.gym_activity(uuid) from public, anon;
grant execute on function public.gym_activity(uuid) to authenticated;

-- ---------- reports for posts and comments ----------
create or replace function public.report_content(p_target_type text, p_target_id uuid, p_reported_user uuid, p_reason text, p_details text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_reported_user is null or p_reported_user = me then return 'invalid'; end if;
  if p_target_type = 'user' and p_target_id <> p_reported_user then return 'invalid'; end if;
  if p_target_type = 'gym' then
    if not exists (select 1 from gyms where id = p_target_id and created_by = p_reported_user) then return 'invalid'; end if;
  elsif p_target_type = 'post' then
    if not exists (select 1 from posts where id = p_target_id and author_id = p_reported_user) or not post_visible(p_target_id) then return 'invalid'; end if;
  elsif p_target_type = 'comment' then
    if not exists (select 1 from post_comments c where c.id = p_target_id and c.author_id = p_reported_user and post_visible(c.post_id)) then return 'invalid'; end if;
  elsif p_target_type = 'message' then
    if not exists (select 1 from messages m join conversations c on c.id = m.conversation_id
                    where m.id = p_target_id and m.sender_id = p_reported_user and me in (c.user_a, c.user_b)) then return 'invalid'; end if;
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
