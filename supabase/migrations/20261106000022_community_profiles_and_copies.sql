-- Community, stage 4: profiles, avatars, saving a shared workout's plan, upcoming training sessions.
--
-- Profiles
-- * profiles gains an optional short bio, up to five training interests from a fixed list, and an
--   avatar path. profiles stays readable only by its owner (RLS); other people see these fields only
--   through social_profile(), and only when profile_visible() says they already have a reason to see
--   the person: friends, a pending request, a conversation, an opted-in member of their own gym, or the
--   author of a post or comment they can see. Blocking hides everything both ways.
-- * The gym is shown on a profile only to members of that same gym, and only while the person lets
--   members find them (the existing "discoverable" switch). Nothing about attendance is stored or shown.
-- * Avatars live in a private Storage bucket "avatars" under <user id>/<uuid>.<ext>: 512 KB at most,
--   WebP/JPEG/PNG only. Owners write only their own folder. Anyone else can read a file only if it is
--   the owner's current avatar and profile_visible() allows it. The app serves avatars through its own
--   route, so storage URLs are never handed out.
--
-- Saving a shared workout
-- * Sharing can include the workout's plan, opt-in per post (include.plan, off unless chosen). The plan
--   is the prescription the author's workout started from (session_exercises.prescribed, in the
--   program's order, and the originally planned exercise when one was substituted), never what was
--   performed: no performed loads, reps, completion, RIR results, records or notes. A prescribed load
--   is included only when the author also shared loads, and is marked as prescribed.
-- * save_shared_workout() copies a visible, saveable post into the caller's own library as a new,
--   inactive program or as a new workout in one of their programs. One transaction, idempotent by the
--   client's request id, never activates or overwrites anything, and never references another user's
--   exercises (exercise ids must be the caller's; otherwise a catalog entry or a new exercise is used).
--   The author is not told and nothing is published.
--
-- Training sessions
-- * my_upcoming_sessions(): the caller's accepted (and awaiting-their-answer) invitations from the next
--   few weeks, with the conversation to return to.
-- * Removing a friend now cancels the open invitations between the two, like blocking does, so both
--   people see the same state.
--
-- Additive, apart from replacing workout_share_snapshot() (adds the opt-in plan) and remove_friend().

-- ---------- profile fields ----------
alter table public.profiles
  add column bio text check (bio is null or char_length(bio) between 1 and 160),
  add column training_interests text[] not null default '{}'
    check (cardinality(training_interests) <= 5 and training_interests <@ array[
      'strength', 'hypertrophy', 'powerlifting', 'olympic_lifting', 'calisthenics',
      'running', 'conditioning', 'mobility', 'bodybuilding', 'sport']::text[]),
  add column avatar_path text;

-- An avatar path must point into the owner's own folder.
create or replace function public.profiles_avatar_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.avatar_path is not null
     and new.avatar_path !~ ('^' || new.id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$') then
    raise exception 'invalid_avatar_path';
  end if;
  if new.bio is not null then new.bio := nullif(btrim(regexp_replace(new.bio, '[[:cntrl:]]', ' ', 'g')), ''); end if;
  return new;
end $$;
revoke execute on function public.profiles_avatar_guard() from public, anon, authenticated;
create trigger profiles_avatar_guard before insert or update of avatar_path, bio on public.profiles
  for each row execute function public.profiles_avatar_guard();

-- ---------- who may see whose profile ----------
create or replace function public.profile_visible(p_other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and p_other is not null and (
    p_other = auth.uid()
    or (not blocked_between(auth.uid(), p_other) and (
         are_friends(auth.uid(), p_other)
      or exists (select 1 from friend_requests where status = 'pending'
                  and ((from_id = auth.uid() and to_id = p_other) or (from_id = p_other and to_id = auth.uid())))
      or exists (select 1 from conversations where user_a = least(auth.uid(), p_other) and user_b = greatest(auth.uid(), p_other))
      or exists (select 1 from gym_memberships mine join gym_memberships them on them.gym_id = mine.gym_id
                  where mine.user_id = auth.uid() and them.user_id = p_other and them.discoverable)
      or exists (select 1 from posts p where p.author_id = p_other
                  and can_view_post(p.author_id, p.audience, p.gym_id) and not reported_by_me('post', p.id))
      or exists (select 1 from post_comments c join posts p on p.id = c.post_id
                  where c.author_id = p_other and can_view_post(p.author_id, p.audience, p.gym_id)
                    and not reported_by_me('post', p.id) and not reported_by_me('comment', c.id)))))
$$;
revoke execute on function public.profile_visible(uuid) from public, anon;
grant execute on function public.profile_visible(uuid) to authenticated;

-- The public-facing profile, relative to the caller. Null when the caller can't see this person.
create or replace function public.social_profile(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  p profiles;
  rel text;
  g gyms;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not profile_visible(p_user) then return null; end if;
  select * into p from profiles where id = p_user;
  if not found then return null; end if;
  rel := case when p_user = me then 'self' else social_relation(me, p_user) end;
  -- Gym: only to members of the same gym, only while the person is discoverable there.
  select gy.* into g from gym_memberships them join gyms gy on gy.id = them.gym_id
   where them.user_id = p_user and them.discoverable
     and exists (select 1 from gym_memberships mine where mine.user_id = me and mine.gym_id = them.gym_id);
  return jsonb_strip_nulls(jsonb_build_object(
    'id', p_user,
    'display_name', social_name(p_user),
    'bio', p.bio,
    'interests', to_jsonb(p.training_interests),
    'avatar', case when p.avatar_path is not null then left(md5(p.avatar_path), 10) end,
    'relation', rel,
    'incoming_request_id', (select id from friend_requests where from_id = p_user and to_id = me and status = 'pending'),
    'outgoing_request_id', (select id from friend_requests where from_id = me and to_id = p_user and status = 'pending'),
    'can_request', rel = 'none' and not is_restricted(me) and exists (
      select 1 from gym_memberships mine join gym_memberships them on them.gym_id = mine.gym_id
       where mine.user_id = me and them.user_id = p_user and them.discoverable),
    'can_message', p_user <> me and can_message(me, p_user) = 'ok',
    'gym', case when g.id is not null then jsonb_build_object('id', g.id, 'name', g.name, 'city', g.city, 'verified', g.verified) end));
end $$;
revoke execute on function public.social_profile(uuid) from public, anon;
grant execute on function public.social_profile(uuid) to authenticated;

-- The storage path of someone's current avatar, if the caller may see it.
create or replace function public.avatar_path_for(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select p.avatar_path from profiles p where p.id = p_user and profile_visible(p_user)
$$;
revoke execute on function public.avatar_path_for(uuid) from public, anon;
grant execute on function public.avatar_path_for(uuid) to authenticated;

-- Storage RLS helper: the object is someone's current avatar and the caller may see that person.
create or replace function public.avatar_object_visible(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    exists (select 1 from profiles p where p.id = split_part(p_name, '/', 1)::uuid and p.avatar_path = p_name)
    and profile_visible(split_part(p_name, '/', 1)::uuid)
  else false end
$$;
revoke execute on function public.avatar_object_visible(text) from public, anon;
grant execute on function public.avatar_object_visible(text) to authenticated;

-- Avatar bucket and policies (Supabase Storage). Skipped where Storage doesn't exist.
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', false, 524288, array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute $p$create policy "avatars: read visible" on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.avatar_object_visible(name)))$p$;
    execute $p$create policy "avatars: owner inserts" on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$')$p$;
    execute $p$create policy "avatars: owner updates" on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$create policy "avatars: owner deletes" on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;

-- ---------- a person's posts, as the caller may see them ----------
create or replace function public.profile_posts(p_author uuid, p_limit integer default 30, p_before timestamptz default null)
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
   where p.author_id = p_author
     and can_view_post(p.author_id, p.audience, p.gym_id) and not reported_by_me('post', p.id)
     and (p.audience = 'friends' or p.gym_id = my_gym_id() or p.author_id = auth.uid())
     and (p_before is null or p.created_at < p_before)
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;
revoke execute on function public.profile_posts(uuid, integer, timestamptz) from public, anon;
grant execute on function public.profile_posts(uuid, integer, timestamptz) to authenticated;

-- ---------- workout snapshot, with the opt-in plan ----------
-- p_include: {"loads", "reps", "duration", "runs"} default to true; "plan" defaults to false.
create or replace function public.workout_share_snapshot(p_session uuid, p_include jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s workout_sessions;
  inc_loads boolean := coalesce((p_include->>'loads')::boolean, true);
  inc_reps boolean := coalesce((p_include->>'reps')::boolean, true);
  inc_dur boolean := coalesce((p_include->>'duration')::boolean, true);
  inc_runs boolean := coalesce((p_include->>'runs')::boolean, true);
  inc_plan boolean := coalesce((p_include->>'plan')::boolean, false);
  ex jsonb;
  rn jsonb;
  pl jsonb;
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
  -- The plan: what the workout prescribed when it started, in the program's order. Exercises added
  -- during the workout have no prescription and say so (planned = false). Notes are never included.
  if inc_plan then
    select coalesce(jsonb_agg(pe order by p_pos, se_pos), '[]'::jsonb) into pl from (
      select coalesce(te.position, 100000 + se.position) as p_pos, se.position as se_pos, jsonb_strip_nulls(jsonb_build_object(
        'name', x.name,
        'catalog_slug', x.catalog_slug,
        'equipment', x.equipment,
        'load_type', x.load_type,
        'muscles', to_jsonb(x.primary_muscles),
        'planned', se.prescribed ? 'sets',
        'sets', se.prescribed->'sets', 'rep_min', se.prescribed->'rep_min', 'rep_max', se.prescribed->'rep_max',
        'rest_s', se.prescribed->'rest_s', 'target_rir', se.prescribed->'target_rir', 'target_rpe', se.prescribed->'target_rpe',
        'tempo', se.prescribed->'tempo', 'per_side', se.prescribed->'per_side', 'warmup_sets', se.prescribed->'warmup_sets',
        'drop_segments', se.prescribed->'drop_segments', 'drop_scope', se.prescribed->'drop_scope',
        'superset_group', se.prescribed->'superset_group', 'optional', se.prescribed->'optional',
        'target_weight_kg', case when inc_loads then se.prescribed->'target_weight_kg' end,
        'convention', case when inc_loads and jsonb_typeof(se.prescribed->'target_weight_kg') = 'number' then x.weight_convention end)) as pe
      from session_exercises se
      join exercises x on x.id = coalesce(se.substituted_for, se.exercise_id)
      left join template_exercises te on te.id = se.template_exercise_id
      where se.session_id = s.id
    ) q;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'name', s.name,
    'started_at', s.started_at,
    'duration_min', case when inc_dur and s.ended_at is not null then round(extract(epoch from (s.ended_at - s.started_at)) / 60) end,
    'exercises', ex,
    'runs', rn,
    'plan', case when inc_plan then pl end,
    'include', jsonb_build_object('loads', inc_loads, 'reps', inc_reps, 'duration', inc_dur, 'runs', inc_runs, 'plan', inc_plan)));
end $$;
revoke execute on function public.workout_share_snapshot(uuid, jsonb) from public, anon, authenticated;

-- ---------- saving a shared workout ----------
create table public.workout_copies (
  id uuid primary key,                         -- the client's request id: retries return the same copy
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  program_id uuid references public.programs(id) on delete set null,
  template_id uuid references public.workout_templates(id) on delete set null,
  created_new_program boolean not null default false,
  created_at timestamptz not null default now()
);
create index workout_copies_user_post_idx on public.workout_copies (user_id, post_id);
alter table public.workout_copies enable row level security;
-- Private to the person who saved; authors can't see who copied their posts.
create policy "copies: own read" on public.workout_copies for select to authenticated using (user_id = (select auth.uid()));

-- p_payload: { destination: {kind: "new", name} | {kind: "existing", program_id}, workout_name,
--   exercises: [{ exercise_id | catalog_slug | new: {name, equipment?, load_type?, muscles?},
--                 sets, rep_min, rep_max, rest_s, target_rir?, target_rpe?, tempo?, target_weight_kg?,
--                 per_side?, warmup_sets?, drop_segments?, drop_scope?, superset_group?, optional? }] }
-- Returns {status: saved | already_saved, program_id, template_id} or {status: <error>, at?}.
create or replace function public.save_shared_workout(p_id uuid, p_post uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  c workout_copies;
  p posts;
  dest jsonb := p_payload->'destination';
  pid uuid;
  tid uuid;
  wname text := nullif(btrim(coalesce(p_payload->>'workout_name', '')), '');
  pname text;
  x jsonb;
  x_pos bigint;
  eid uuid;
  cat jsonb;
  nx jsonb;
  nname text;
  eq text;
  lt text;
  made_new boolean := false;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_id is null then return jsonb_build_object('status', 'invalid'); end if;

  -- Claim the request id first: a concurrent retry waits here, then finds the finished copy.
  insert into workout_copies (id, user_id, post_id) values (p_id, me, p_post) on conflict (id) do nothing;
  select * into c from workout_copies where id = p_id;
  if c.user_id <> me then return jsonb_build_object('status', 'invalid'); end if;
  if c.template_id is not null or c.program_id is not null then
    return jsonb_build_object('status', 'already_saved', 'program_id', c.program_id, 'template_id', c.template_id);
  end if;

  select * into p from posts where id = p_post;
  if not found or not post_visible(p_post) then raise exception 'not_found'; end if;
  if p.kind <> 'workout' or jsonb_typeof(p.snapshot->'plan') is distinct from 'array'
     or not coalesce((p.snapshot->'include'->>'plan')::boolean, false) then
    raise exception 'not_saveable';
  end if;
  if (select count(*) from workout_copies where user_id = me and created_at > now() - interval '24 hours' and template_id is not null) >= 30 then
    raise exception 'rate_limited';
  end if;

  if wname is null or char_length(wname) > 120 then raise exception 'invalid_workout_name'; end if;
  if jsonb_typeof(p_payload->'exercises') is distinct from 'array'
     or jsonb_array_length(p_payload->'exercises') not between 1 and 40 then raise exception 'invalid_exercises'; end if;

  if dest->>'kind' = 'new' then
    pname := nullif(btrim(coalesce(dest->>'name', '')), '');
    if pname is null or char_length(pname) > 120 then raise exception 'invalid_program_name'; end if;
    insert into programs (user_id, name, is_active) values (me, pname, false) returning id into pid;
    made_new := true;
  elsif dest->>'kind' = 'existing' then
    select id into pid from programs where id = (dest->>'program_id')::uuid and user_id = me and archived_at is null for update;
    if pid is null then raise exception 'invalid_destination'; end if;
  else
    raise exception 'invalid_destination';
  end if;

  insert into workout_templates (user_id, program_id, name, position)
  values (me, pid, wname, coalesce((select max(position) + 1 from workout_templates where program_id = pid), 0))
  returning id into tid;

  for x, x_pos in select * from jsonb_array_elements(p_payload->'exercises') with ordinality loop
    eid := null;
    if jsonb_typeof(x->'exercise_id') = 'string' then
      -- Only the caller's own exercises; never anyone else's records.
      select id into eid from exercises where id = (x->>'exercise_id')::uuid and user_id = me;
    elsif jsonb_typeof(x->'catalog_slug') = 'string' then
      cat := public.add_catalog_exercises(array[x->>'catalog_slug']);
      eid := coalesce((cat->'added'->0->>'id')::uuid, (cat->'skipped'->0->>'existing_id')::uuid);
    elsif jsonb_typeof(x->'new') = 'object' then
      nx := x->'new';
      nname := nullif(btrim(regexp_replace(coalesce(nx->>'name', ''), '[[:cntrl:]]', ' ', 'g')), '');
      if nname is null or char_length(nname) > 120 then raise exception 'invalid_exercise_name' using detail = x_pos::text; end if;
      eq := coalesce(nullif(nx->>'equipment', ''), 'other');
      if eq not in ('barbell', 'dumbbell', 'cable', 'machine', 'smith', 'bodyweight', 'other') then eq := 'other'; end if;
      lt := coalesce(nullif(nx->>'load_type', ''), 'external');
      if lt not in ('external', 'bodyweight', 'weighted_bodyweight', 'assisted') then lt := 'external'; end if;
      insert into exercises (user_id, slug, name, primary_muscles, equipment, category, load_type, progression, weight_convention)
      values (me, 'custom-' || left(social_norm(nname), 40) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8), nname,
              coalesce((select array_agg(left(m, 40)) from (select jsonb_array_elements_text(case when jsonb_typeof(nx->'muscles') = 'array' then nx->'muscles' else '[]' end) m limit 6) mm), '{}'),
              eq::equipment_type,
              (case when lt = 'bodyweight' then 'bodyweight' when lt in ('weighted_bodyweight', 'assisted') then 'weighted_bodyweight' else 'isolation' end)::exercise_category,
              lt::load_type,
              (case when lt in ('bodyweight', 'assisted') then 'bodyweight_reps' else 'double_progression' end)::progression_strategy,
              case when lt = 'weighted_bodyweight' then 'added' when lt = 'assisted' then 'assistance' else 'total' end)
      returning id into eid;
    end if;
    if eid is null then raise exception 'unknown_exercise' using detail = x_pos::text; end if;

    begin
      insert into template_exercises (user_id, template_id, exercise_id, position, sets, rep_min, rep_max, rest_s,
        target_rir, target_rpe, tempo, target_weight_kg, per_side, warmup_sets, drop_segments, drop_scope,
        superset_group, optional)
      values (me, tid, eid, x_pos, (x->>'sets')::smallint, (x->>'rep_min')::smallint, (x->>'rep_max')::smallint,
        (x->>'rest_s')::integer, (x->>'target_rir')::numeric, (x->>'target_rpe')::numeric,
        nullif(btrim(coalesce(x->>'tempo', '')), ''), (x->>'target_weight_kg')::numeric,
        coalesce((x->>'per_side')::boolean, false), coalesce((x->>'warmup_sets')::smallint, 0),
        coalesce((x->>'drop_segments')::smallint, 0), x->>'drop_scope', x->>'superset_group',
        coalesce((x->>'optional')::boolean, false));
    exception
      when not_null_violation or check_violation or invalid_text_representation or numeric_value_out_of_range then
        raise exception 'invalid_prescription' using detail = x_pos::text;
    end;
  end loop;

  perform public.snapshot_program(pid, case when made_new then 'Saved from Community' else 'Added a workout saved from Community' end);
  update workout_copies set program_id = pid, template_id = tid, created_new_program = made_new where id = p_id;
  return jsonb_build_object('status', 'saved', 'program_id', pid, 'template_id', tid);
end $$;
revoke execute on function public.save_shared_workout(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_shared_workout(uuid, uuid, jsonb) to authenticated;

-- ---------- upcoming training sessions ----------
create or replace function public.my_upcoming_sessions()
returns table (id uuid, conversation_id uuid, other_id uuid, display_name text, gym_name text, starts_at timestamptz,
               time_zone text, workout_name text, status text, awaiting_me boolean, version integer)
language sql stable security definer set search_path = public as $$
  select i.id, i.conversation_id, o.other, social_name(o.other), i.gym_name, i.starts_at, i.time_zone, i.workout_name,
         i.status, i.awaiting_id = auth.uid(), i.version
    from training_invites i
    cross join lateral (select case when i.from_id = auth.uid() then i.to_id else i.from_id end as other) o
   where auth.uid() in (i.from_id, i.to_id)
     and (i.status = 'accepted' or (i.status = 'pending' and i.awaiting_id = auth.uid()))
     and i.starts_at > now() - interval '1 hour'
     and i.starts_at < now() + interval '60 days'
     and not blocked_between(i.from_id, i.to_id)
   order by i.starts_at
   limit 6
$$;
revoke execute on function public.my_upcoming_sessions() from public, anon;
grant execute on function public.my_upcoming_sessions() to authenticated;

-- ---------- removing a friend cancels open invitations, for both people ----------
create or replace function public.remove_friend(p_other uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); i training_invites; removed boolean;
begin
  if me is null then raise exception 'not authenticated'; end if;
  delete from friendships where user_a = least(me, p_other) and user_b = greatest(me, p_other);
  removed := found;
  for i in update training_invites set status = 'cancelled', awaiting_id = null, version = version + 1, updated_at = now()
            where status in ('pending', 'accepted')
              and ((from_id = me and to_id = p_other) or (from_id = p_other and to_id = me))
            returning * loop
    perform invite_event(i, me, 'cancelled');
  end loop;
  return case when removed then 'removed' else 'not_friends' end;
end $$;
revoke execute on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;
