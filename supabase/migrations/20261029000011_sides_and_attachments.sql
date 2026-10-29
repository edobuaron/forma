-- Optional left/right tracking, cable attachments, and set records that keep each side apart.
--
-- * Left/right: a planned set stays ONE set_logs row. When `sided` is true its own load/reps/RIR are
--   null and each side carries its own load, reps, RIR and completion in left_* / right_* columns.
--   The row's `completed` means "at least one side was performed", so a half-done set survives
--   finishing; a missing side stays null (unknown / not performed), never zero. Existing rows are
--   untouched: they keep sided = false and every side column empty, so old "per side" or
--   "per dumbbell" weights are never reinterpreted as independently recorded sides.
-- * session_exercises.track_sides is the mode new sets in that workout start in. Sets that already
--   hold data keep their own mode, so switching never discards logged values.
-- * Attachments: a private per-user list (starter list seeded once per account, never re-seeded).
--   A workout records attachment_state: NULL = not recorded, 'none' = no attachment,
--   'attachment' = attachment_id + a name snapshot taken by the server when the attachment is
--   chosen. Renaming or archiving an attachment later never rewrites past workouts.
-- * Personal records gain a side, so a left-arm record is never compared with a right-arm one.

-- ---------- attachments ----------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- set only for starter-list rows; stays the same when the row is renamed
  starter_key text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index attachments_user_name_active on public.attachments(user_id, lower(btrim(name))) where archived_at is null;
create unique index attachments_user_starter on public.attachments(user_id, starter_key) where starter_key is not null;
create trigger attachments_touch before update on public.attachments
  for each row execute function public.touch_updated_at();
alter table public.attachments enable row level security;
create policy "own rows: select" on public.attachments for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.attachments for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own rows: update" on public.attachments for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows: delete" on public.attachments for delete to authenticated using (user_id = (select auth.uid()));

alter table public.profiles add column attachments_seeded_at timestamptz;

-- ---------- exercises: logging defaults ----------
alter table public.exercises
  add column track_sides boolean not null default false,
  add column default_attachment_state text check (default_attachment_state in ('none','attachment')),
  add column default_attachment_id uuid references public.attachments(id) on delete set null,
  add constraint exercises_default_attachment_shape check (
    (default_attachment_state is distinct from 'attachment' and default_attachment_id is null)
    or (default_attachment_state = 'attachment' and default_attachment_id is not null));
create index exercises_default_attachment_idx on public.exercises(default_attachment_id);

-- ---------- session exercises: mode and attachment snapshot ----------
alter table public.session_exercises
  add column track_sides boolean not null default false,
  add column attachment_state text check (attachment_state in ('none','attachment')),
  add column attachment_id uuid references public.attachments(id) on delete restrict,
  add column attachment_name text,
  add constraint session_exercises_attachment_shape check (
    (attachment_state is distinct from 'attachment' and attachment_id is null and attachment_name is null)
    or (attachment_state = 'attachment' and attachment_id is not null and char_length(attachment_name) between 1 and 60));
create index session_exercises_attachment_idx on public.session_exercises(attachment_id);

-- ---------- set logs: independent sides ----------
alter table public.set_logs
  add column sided boolean not null default false,
  add column left_weight_kg numeric(6,2) check (left_weight_kg is null or left_weight_kg between 0 and 1000),
  add column left_assistance_kg numeric(6,2) check (left_assistance_kg is null or left_assistance_kg between 0 and 300),
  add column left_reps smallint check (left_reps is null or left_reps between 0 and 200),
  add column left_rir numeric(3,1) check (left_rir is null or left_rir between 0 and 10),
  add column left_completed boolean not null default false,
  add column left_completed_at timestamptz,
  add column right_weight_kg numeric(6,2) check (right_weight_kg is null or right_weight_kg between 0 and 1000),
  add column right_assistance_kg numeric(6,2) check (right_assistance_kg is null or right_assistance_kg between 0 and 300),
  add column right_reps smallint check (right_reps is null or right_reps between 0 and 200),
  add column right_rir numeric(3,1) check (right_rir is null or right_rir between 0 and 10),
  add column right_completed boolean not null default false,
  add column right_completed_at timestamptz,
  add constraint set_logs_sides_shape check (
    (not sided
      and left_weight_kg is null and left_assistance_kg is null and left_reps is null and left_rir is null
      and not left_completed and left_completed_at is null
      and right_weight_kg is null and right_assistance_kg is null and right_reps is null and right_rir is null
      and not right_completed and right_completed_at is null)
    or (sided
      and weight_kg is null and assistance_kg is null and reps is null and rir is null
      and completed = (left_completed or right_completed)));

-- ---------- ownership + server-side name snapshot ----------
-- A workout's attachment name is copied from the catalog only when the attachment is chosen or
-- changed. Later renames never touch it. Archived attachments can't be newly chosen.
create or replace function public.check_attachment_ref() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a attachments%rowtype;
  kept text;
begin
  if tg_table_name = 'exercises' then
    if new.default_attachment_id is not null then
      select * into a from attachments where id = new.default_attachment_id;
      if a.user_id is distinct from new.user_id then raise exception 'attachment owner mismatch'; end if;
    end if;
    return new;
  end if;
  if new.attachment_id is null then
    new.attachment_name := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.attachment_id is not distinct from old.attachment_id then
    new.attachment_name := old.attachment_name;
    return new;
  end if;
  -- An upsert (insert … on conflict) of an existing row fires the insert trigger first.
  if tg_op = 'INSERT' then
    select x.attachment_name into kept from session_exercises x
     where x.id = new.id and x.attachment_id = new.attachment_id and x.user_id = new.user_id;
    if found then
      new.attachment_name := kept;
      return new;
    end if;
  end if;
  select * into a from attachments where id = new.attachment_id;
  if a.user_id is distinct from new.user_id then raise exception 'attachment owner mismatch'; end if;
  if a.archived_at is not null then raise exception 'attachment_archived'; end if;
  new.attachment_name := a.name;
  return new;
end $$;
revoke execute on function public.check_attachment_ref() from public, anon, authenticated;
create trigger session_exercises_attachment before insert or update on public.session_exercises
  for each row execute function public.check_attachment_ref();
create trigger exercises_attachment before insert or update on public.exercises
  for each row execute function public.check_attachment_ref();

-- ---------- attachment RPCs ----------
-- Seed the starter list once per account. Safe to call on every page load; a name the user already
-- has is skipped, and attachments the user removed are not brought back.
create or replace function public.ensure_starter_attachments() returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform 1 from profiles where id = auth.uid() and attachments_seeded_at is null for update;
  if not found then return; end if;
  insert into attachments (user_id, name, starter_key)
  select auth.uid(), v.name, v.key
  from (values ('d_handle', 'Single D-handle'), ('rope', 'Rope'), ('straight_bar', 'Straight bar'),
               ('ez_bar', 'Angled / EZ bar'), ('v_handle', 'V-handle'), ('wide_lat_bar', 'Wide lat bar'),
               ('ankle_strap', 'Ankle strap'), ('cuff', 'Wrist / forearm cuff')) as v(key, name)
  where not exists (select 1 from attachments x where x.user_id = auth.uid()
                    and (x.starter_key = v.key or (x.archived_at is null and lower(btrim(x.name)) = lower(v.name))));
  update profiles set attachments_seeded_at = now() where id = auth.uid();
end $$;

-- Remove an attachment: deleted when no workout used it, archived (kept for history) when one did.
-- Exercise defaults pointing at it are cleared either way.
create or replace function public.remove_attachment(p_id uuid) returns text
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform 1 from attachments where id = p_id for update;
  if not found then raise exception 'attachment_not_found'; end if;
  update exercises set default_attachment_state = null, default_attachment_id = null where default_attachment_id = p_id;
  if exists (select 1 from session_exercises where attachment_id = p_id) then
    update attachments set archived_at = coalesce(archived_at, now()) where id = p_id;
    return 'archived';
  end if;
  delete from attachments where id = p_id;
  return 'deleted';
end $$;

-- ---------- history read model ----------
-- New columns appended; existing columns unchanged.
create or replace view public.set_history with (security_invoker = true) as
select
  l.id,
  l.user_id,
  l.session_id,
  l.session_exercise_id,
  se.exercise_id,
  s.started_at,
  s.status,
  s.name as session_name,
  s.bodyweight_kg,
  se.prescribed,
  se.position as se_position,
  l.position,
  l.kind,
  l.weight_kg,
  l.assistance_kg,
  l.reps,
  l.rir,
  l.completed,
  l.completed_at,
  s.shortfall_reason,
  l.sided,
  l.left_weight_kg, l.left_assistance_kg, l.left_reps, l.left_rir, l.left_completed,
  l.right_weight_kg, l.right_assistance_kg, l.right_reps, l.right_rir, l.right_completed,
  se.attachment_state,
  se.attachment_id,
  se.attachment_name
from public.set_logs l
join public.session_exercises se on se.id = l.session_exercise_id
join public.workout_sessions s on s.id = l.session_id;

-- ---------- starting a workout copies the exercise's logging defaults ----------
-- Same as migration 005, plus: track_sides and the default attachment are copied to the workout,
-- and new sets start in that mode. An archived default attachment is not copied.
create or replace function public.start_workout_on(
  p_template_id uuid default null, p_name text default null, p_started_at timestamptz default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  sid uuid;
  t workout_templates%rowtype;
  te record;
  seid uuid;
  bw numeric;
  v_at timestamptz := coalesce(p_started_at, now());
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'future_date'; end if;
  select id into sid from workout_sessions where user_id = auth.uid() and status = 'in_progress';
  if sid is not null then
    raise exception 'workout_in_progress' using detail = sid::text;
  end if;
  select bodyweight_kg into bw from profiles where id = auth.uid();

  if p_template_id is null then
    insert into workout_sessions (name, bodyweight_kg, started_at)
    values (coalesce(nullif(trim(p_name), ''), 'Workout'), bw, v_at) returning id into sid;
    return sid;
  end if;

  select * into t from workout_templates where id = p_template_id;
  if not found then raise exception 'template not found'; end if;

  insert into workout_sessions (template_id, program_id, name, bodyweight_kg, started_at)
  values (t.id, t.program_id, coalesce(nullif(trim(p_name), ''), t.name), bw, v_at) returning id into sid;

  for te in
    select x.*, e.track_sides,
           case when e.default_attachment_state = 'attachment' and a.archived_at is not null then null else e.default_attachment_state end as att_state,
           case when a.archived_at is null then e.default_attachment_id end as att_id
    from template_exercises x
    join exercises e on e.id = x.exercise_id
    left join attachments a on a.id = e.default_attachment_id
    where x.template_id = t.id order by x.position
  loop
    insert into session_exercises (session_id, exercise_id, template_exercise_id, position, prescribed,
                                   track_sides, attachment_state, attachment_id)
    values (sid, te.exercise_id, te.id, te.position,
            jsonb_build_object('sets', te.sets, 'rep_min', te.rep_min, 'rep_max', te.rep_max,
                               'rest_s', te.rest_s, 'target_rir', te.target_rir,
                               'optional', te.optional, 'notes', te.notes),
            te.track_sides, te.att_state, te.att_id)
    returning id into seid;
    insert into set_logs (session_id, session_exercise_id, position, kind, sided)
    select sid, seid, g - 1, 'working', te.track_sides from generate_series(1, te.sets) g;
  end loop;
  return sid;
end $$;

-- ---------- finishing ----------
-- Same as migration 008, plus side rules: every performed side needs reps and its load; a side that
-- was not performed is cleared (it stays unknown, never zero); a set with no performed side is removed.
create or replace function public.finish_workout(p_session_id uuid, p_notes text, p_ended_at timestamptz, p_shortfall_reason text default null)
returns void language plpgsql security invoker set search_path = public as $$
declare s workout_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from workout_sessions where id = p_session_id for update;
  if not found then raise exception 'Workout not found.'; end if;
  if s.status = 'completed' then return; end if; -- safe retry after a lost response
  if s.status <> 'in_progress' then raise exception 'This workout cannot be completed.'; end if;
  if p_ended_at is null or p_ended_at < s.started_at then raise exception 'Invalid workout end time.'; end if;
  perform id from session_exercises where session_id = p_session_id for update;
  perform id from set_logs where session_id = p_session_id for update;
  if not exists (select 1 from set_logs where session_id = p_session_id and completed) then
    raise exception 'Complete at least one set first.';
  end if;
  if exists (
    select 1 from set_logs l join session_exercises se on se.id = l.session_exercise_id
    join exercises e on e.id = se.exercise_id
    where l.session_id = p_session_id and l.completed and (
      (not l.sided and (l.reps is null or l.reps < 1
        or (e.load_type = 'assisted' and l.assistance_kg is null)
        or (e.load_type = 'external' and l.weight_kg is null)))
      or (l.sided and l.left_completed and (l.left_reps is null or l.left_reps < 1
        or (e.load_type = 'assisted' and l.left_assistance_kg is null)
        or (e.load_type = 'external' and l.left_weight_kg is null)))
      or (l.sided and l.right_completed and (l.right_reps is null or l.right_reps < 1
        or (e.load_type = 'assisted' and l.right_assistance_kg is null)
        or (e.load_type = 'external' and l.right_weight_kg is null))))
  ) then raise exception 'A completed set is missing reps or load. Correct it before finishing.'; end if;
  delete from set_logs where session_id = p_session_id and not completed;
  update set_logs set left_weight_kg = null, left_assistance_kg = null, left_reps = null, left_rir = null, left_completed_at = null
   where session_id = p_session_id and sided and not left_completed;
  update set_logs set right_weight_kg = null, right_assistance_kg = null, right_reps = null, right_rir = null, right_completed_at = null
   where session_id = p_session_id and sided and not right_completed;
  update workout_sessions set status = 'completed', ended_at = p_ended_at, notes = p_notes, shortfall_reason = p_shortfall_reason
   where id = p_session_id;
end $$;

-- ---------- editing a past workout ----------
-- Same as migration 008, plus: per exercise `track_sides`, `attachment_state` and `attachment_id`
-- (each written only when the payload carries the key, so an older client can't clear them), and per
-- set `sided` with left/right values. A sided set needs at least one performed side; a side that is
-- present needs reps and load. A side that is absent is stored as not performed, never as zero.
create or replace function public.save_session_edit(p_session_id uuid, p_session jsonb, p_exercises jsonb)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  s workout_sessions%rowtype;
  v_name text := nullif(btrim(p_session->>'name'), '');
  v_start timestamptz := (p_session->>'started_at')::timestamptz;
  v_end timestamptz := (p_session->>'ended_at')::timestamptz;
  e jsonb;
  e_pos bigint;
  st jsonb;
  st_pos bigint;
  v_load public.load_type;
  v_ex_name text;
  v_reps integer;
  v_sided boolean;
  v_side text;
  v_l boolean;
  v_r boolean;
  ex_ids uuid[] := '{}';
  set_ids uuid[] := '{}';
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from workout_sessions where id = p_session_id for update;
  if not found then raise exception 'session_not_found'; end if;
  if s.status <> 'completed' then raise exception 'session_not_editable'; end if;
  if v_name is null or v_start is null or v_end is null
     or v_end < v_start + interval '1 minute' or v_end > v_start + interval '600 minutes' then
    raise exception 'invalid_session';
  end if;
  if jsonb_typeof(p_exercises) is distinct from 'array' then raise exception 'invalid_payload'; end if;

  -- Validate everything before writing anything.
  for e in select value from jsonb_array_elements(p_exercises) loop
    if jsonb_typeof(e->'sets') is distinct from 'array' then raise exception 'invalid_payload'; end if;
    select x.load_type, x.name into v_load, v_ex_name from exercises x where x.id = (e->>'exercise_id')::uuid;
    if not found then raise exception 'exercise_not_found'; end if;
    ex_ids := ex_ids || (e->>'id')::uuid;
    for st in select value from jsonb_array_elements(e->'sets') loop
      set_ids := set_ids || (st->>'id')::uuid;
      v_sided := coalesce((st->>'sided')::boolean, false);
      if not v_sided then
        v_reps := (st->>'reps')::integer;
        if v_reps is null or v_reps < 1 then raise exception 'missing_reps' using detail = v_ex_name; end if;
        if v_load = 'assisted' and st->>'assistance_kg' is null then raise exception 'missing_assistance' using detail = v_ex_name; end if;
        if v_load = 'external' and st->>'weight_kg' is null then raise exception 'missing_weight' using detail = v_ex_name; end if;
      else
        v_l := coalesce((st->>'left_completed')::boolean, false);
        v_r := coalesce((st->>'right_completed')::boolean, false);
        if not (v_l or v_r) then raise exception 'missing_side' using detail = v_ex_name; end if;
        foreach v_side in array array['left', 'right'] loop
          if (v_side = 'left' and not v_l) or (v_side = 'right' and not v_r) then continue; end if;
          v_reps := (st->>(v_side || '_reps'))::integer;
          if v_reps is null or v_reps < 1 then raise exception 'missing_reps' using detail = v_ex_name; end if;
          if v_load = 'assisted' and st->>(v_side || '_assistance_kg') is null then raise exception 'missing_assistance' using detail = v_ex_name; end if;
          if v_load = 'external' and st->>(v_side || '_weight_kg') is null then raise exception 'missing_weight' using detail = v_ex_name; end if;
        end loop;
      end if;
    end loop;
  end loop;
  if array_position(ex_ids, null) is not null or array_position(set_ids, null) is not null
     or cardinality(ex_ids) <> (select count(distinct x) from unnest(ex_ids) x)
     or cardinality(set_ids) <> (select count(distinct x) from unnest(set_ids) x) then
    raise exception 'invalid_payload';
  end if;
  -- Ids must be new or already belong to this session. Rows of other users are invisible here
  -- and are rejected by the primary key / RLS on write.
  if exists (select 1 from session_exercises where id = any(ex_ids) and session_id <> p_session_id)
     or exists (select 1 from set_logs where id = any(set_ids) and session_id <> p_session_id) then
    raise exception 'row_not_in_session';
  end if;

  delete from set_logs where session_id = p_session_id and id <> all(set_ids);
  delete from session_exercises where session_id = p_session_id and id <> all(ex_ids);
  update workout_sessions
     set name = v_name, notes = nullif(p_session->>'notes', ''), started_at = v_start, ended_at = v_end,
         shortfall_reason = case when p_session ? 'shortfall_reason' then nullif(p_session->>'shortfall_reason', '') else shortfall_reason end
   where id = p_session_id;

  for e, e_pos in select value, ordinality - 1 from jsonb_array_elements(p_exercises) with ordinality loop
    insert into session_exercises (id, session_id, exercise_id, position, prescribed, notes, track_sides, attachment_state, attachment_id)
    values ((e->>'id')::uuid, p_session_id, (e->>'exercise_id')::uuid, e_pos,
            coalesce(e->'prescribed', '{}'::jsonb), nullif(e->>'notes', ''),
            coalesce((e->>'track_sides')::boolean, false), e->>'attachment_state', (e->>'attachment_id')::uuid)
    on conflict (id) do update
      set exercise_id = excluded.exercise_id, position = excluded.position,
          prescribed = excluded.prescribed, notes = excluded.notes,
          track_sides = case when e ? 'track_sides' then excluded.track_sides else session_exercises.track_sides end,
          attachment_state = case when e ? 'attachment_state' then excluded.attachment_state else session_exercises.attachment_state end,
          attachment_id = case when e ? 'attachment_state' then excluded.attachment_id else session_exercises.attachment_id end;
    for st, st_pos in select value, ordinality - 1 from jsonb_array_elements(e->'sets') with ordinality loop
      v_sided := coalesce((st->>'sided')::boolean, false);
      v_l := v_sided and coalesce((st->>'left_completed')::boolean, false);
      v_r := v_sided and coalesce((st->>'right_completed')::boolean, false);
      insert into set_logs (id, session_id, session_exercise_id, position, kind, weight_kg, assistance_kg, reps, rir,
                            completed, completed_at, notes, sided,
                            left_weight_kg, left_assistance_kg, left_reps, left_rir, left_completed, left_completed_at,
                            right_weight_kg, right_assistance_kg, right_reps, right_rir, right_completed, right_completed_at)
      values ((st->>'id')::uuid, p_session_id, (e->>'id')::uuid, st_pos,
              coalesce(st->>'kind', 'working')::public.set_kind,
              case when v_sided then null else (st->>'weight_kg')::numeric end,
              case when v_sided then null else (st->>'assistance_kg')::numeric end,
              case when v_sided then null else (st->>'reps')::smallint end,
              case when v_sided then null else (st->>'rir')::numeric end,
              true, coalesce((st->>'completed_at')::timestamptz, v_start), nullif(st->>'notes', ''), v_sided,
              case when v_l then (st->>'left_weight_kg')::numeric end, case when v_l then (st->>'left_assistance_kg')::numeric end,
              case when v_l then (st->>'left_reps')::smallint end, case when v_l then (st->>'left_rir')::numeric end,
              v_l, case when v_l then coalesce((st->>'left_completed_at')::timestamptz, (st->>'completed_at')::timestamptz, v_start) end,
              case when v_r then (st->>'right_weight_kg')::numeric end, case when v_r then (st->>'right_assistance_kg')::numeric end,
              case when v_r then (st->>'right_reps')::smallint end, case when v_r then (st->>'right_rir')::numeric end,
              v_r, case when v_r then coalesce((st->>'right_completed_at')::timestamptz, (st->>'completed_at')::timestamptz, v_start) end)
      on conflict (id) do update
        set session_exercise_id = excluded.session_exercise_id, position = excluded.position, kind = excluded.kind,
            weight_kg = excluded.weight_kg, assistance_kg = excluded.assistance_kg, reps = excluded.reps,
            rir = excluded.rir, completed = true, completed_at = excluded.completed_at, notes = excluded.notes,
            sided = excluded.sided,
            left_weight_kg = excluded.left_weight_kg, left_assistance_kg = excluded.left_assistance_kg,
            left_reps = excluded.left_reps, left_rir = excluded.left_rir,
            left_completed = excluded.left_completed, left_completed_at = excluded.left_completed_at,
            right_weight_kg = excluded.right_weight_kg, right_assistance_kg = excluded.right_assistance_kg,
            right_reps = excluded.right_reps, right_rir = excluded.right_rir,
            right_completed = excluded.right_completed, right_completed_at = excluded.right_completed_at;
    end loop;
  end loop;
end $$;

-- ---------- personal records per side ----------
alter table public.personal_records add column side text check (side in ('left','right'));
alter table public.personal_records drop constraint if exists personal_records_session_id_exercise_id_type_key;
create unique index personal_records_session_exercise_type_side
  on public.personal_records(session_id, exercise_id, type, coalesce(side, ''));

-- Same as migration 006, with the side values in the fingerprint.
create or replace function public.personal_record_basis(p_exercise_ids uuid[])
returns text
language sql stable security invoker set search_path = public as $$
  select md5(coalesce(string_agg(
    row(l.id, se.exercise_id, l.session_id, extract(epoch from s.started_at), l.kind, l.weight_kg, l.assistance_kg, l.reps,
        l.sided, l.left_completed, l.left_weight_kg, l.left_assistance_kg, l.left_reps,
        l.right_completed, l.right_weight_kg, l.right_assistance_kg, l.right_reps)::text,
    ',' order by l.id), ''))
  from set_logs l
  join session_exercises se on se.id = l.session_exercise_id
  join workout_sessions s on s.id = l.session_id
  where se.exercise_id = any(p_exercise_ids) and s.status = 'completed' and l.completed;
$$;

-- Same as migration 006, plus the record's side (null for sets logged together).
create or replace function public.replace_personal_records(p_exercise_ids uuid[], p_basis text, p_records jsonb)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' then raise exception 'invalid_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended('forma:personal_records:' || auth.uid()::text, 0));
  if p_basis is distinct from public.personal_record_basis(p_exercise_ids) then
    raise exception 'stale_history';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_records) r(exercise_id uuid, session_id uuid, side text)
    where r.exercise_id is null or not (r.exercise_id = any(p_exercise_ids))
       or not exists (select 1 from workout_sessions w where w.id = r.session_id)
       or (r.side is not null and r.side not in ('left', 'right'))
  ) then
    raise exception 'invalid_payload';
  end if;
  delete from personal_records where exercise_id = any(p_exercise_ids);
  insert into personal_records (exercise_id, session_id, type, value, load_kg, reps, previous, achieved_at, side)
  select r.exercise_id, r.session_id, r.type, r.value, r.load_kg, r.reps, r.previous, r.achieved_at, r.side
  from jsonb_to_recordset(p_records)
    as r(exercise_id uuid, session_id uuid, type text, value numeric, load_kg numeric, reps smallint, previous numeric, achieved_at timestamptz, side text);
end $$;

revoke execute on function public.ensure_starter_attachments() from public, anon;
revoke execute on function public.remove_attachment(uuid) from public, anon;
grant execute on function public.ensure_starter_attachments() to authenticated;
grant execute on function public.remove_attachment(uuid) to authenticated;
