-- Drop sets: a working set followed by ordered drop segments.
--
-- * A drop segment is its own set_logs row with kind = 'drop' and drop_parent_id pointing at the
--   working set it continues. It has its own load, reps, RIR and completion (and its own left/right
--   columns when its parent is tracked by side). Segments follow their parent in position order.
-- * The sequence is ONE planned set: only the parent is a working set. Segments never count toward
--   planned-set completion, comparisons, progression or records (all of which read kind = 'working').
--   Their volume is reported separately as drop volume.
-- * Deleting the parent deletes its segments. A parent with segments must stay a working set.
-- * Existing rows are untouched: no row is 'drop' before this migration and drop_parent_id starts null.
--
-- The new enum value is only compared as text below, so this file can run in one transaction
-- (Supabase SQL Editor) right after the value is added.

alter type public.set_kind add value if not exists 'drop';

alter table public.set_logs
  add column drop_parent_id uuid references public.set_logs(id) on delete cascade deferrable initially deferred,
  add constraint set_logs_drop_shape check ((kind::text = 'drop') = (drop_parent_id is not null)),
  add constraint set_logs_drop_not_self check (drop_parent_id is distinct from id);
create index set_logs_drop_parent_idx on public.set_logs(drop_parent_id) where drop_parent_id is not null;

-- Checked at commit, so a parent and its segments can arrive in any order within one write.
create or replace function public.check_drop_segment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cur set_logs%rowtype;
  par set_logs%rowtype;
begin
  select * into cur from set_logs where id = new.id;
  if not found then return null; end if; -- deleted later in the same transaction
  if cur.kind::text = 'drop' then
    select * into par from set_logs where id = cur.drop_parent_id;
    if not found then raise exception 'drop_parent_missing'; end if;
    if par.user_id is distinct from cur.user_id then raise exception 'drop parent owner mismatch'; end if;
    if par.session_exercise_id is distinct from cur.session_exercise_id then raise exception 'drop_parent_other_exercise'; end if;
    if par.kind::text <> 'working' then raise exception 'drop_parent_not_working'; end if;
  elsif cur.kind::text <> 'working'
        and exists (select 1 from set_logs c where c.drop_parent_id = cur.id) then
    raise exception 'drop_parent_not_working';
  end if;
  return null;
end $$;
revoke execute on function public.check_drop_segment() from public, anon, authenticated;
create constraint trigger set_logs_drop_segment after insert or update on public.set_logs
  deferrable initially deferred
  for each row execute function public.check_drop_segment();

-- ---------- history read model ----------
-- New column appended; existing columns unchanged.
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
  se.attachment_name,
  l.drop_parent_id
from public.set_logs l
join public.session_exercises se on se.id = l.session_exercise_id
join public.workout_sessions s on s.id = l.session_id;

-- ---------- finishing ----------
-- Same as migration 011, plus: a completed drop segment needs its parent set completed, so finishing
-- never silently deletes logged drop work. Unfinished segments are removed like any unfinished set.
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
  if exists (
    select 1 from set_logs d join set_logs p on p.id = d.drop_parent_id
    where d.session_id = p_session_id and d.completed and not p.completed
  ) then raise exception 'A drop is logged under a set that is not completed. Complete or remove it before finishing.'; end if;
  delete from set_logs where session_id = p_session_id and not completed;
  update set_logs set left_weight_kg = null, left_assistance_kg = null, left_reps = null, left_rir = null, left_completed_at = null
   where session_id = p_session_id and sided and not left_completed;
  update set_logs set right_weight_kg = null, right_assistance_kg = null, right_reps = null, right_rir = null, right_completed_at = null
   where session_id = p_session_id and sided and not right_completed;
  update workout_sessions set status = 'completed', ended_at = p_ended_at, notes = p_notes, shortfall_reason = p_shortfall_reason
   where id = p_session_id;
end $$;

-- ---------- editing a past workout ----------
-- Same as migration 011, plus per set `drop_parent_id`: a drop segment must name a working set that
-- comes before it in the same exercise of the payload. A set without the key is not a drop.
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
  v_kind text;
  v_parent uuid;
  working_ids uuid[];
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
    working_ids := '{}';
    for st in select value from jsonb_array_elements(e->'sets') loop
      set_ids := set_ids || (st->>'id')::uuid;
      v_kind := coalesce(st->>'kind', 'working');
      v_parent := (st->>'drop_parent_id')::uuid;
      if v_kind not in ('warmup', 'working', 'drop') then raise exception 'invalid_payload'; end if;
      if (v_kind = 'drop') <> (v_parent is not null) then raise exception 'invalid_drop' using detail = v_ex_name; end if;
      if v_kind = 'drop' and not (v_parent = any(working_ids)) then raise exception 'invalid_drop' using detail = v_ex_name; end if;
      if v_kind = 'working' then working_ids := working_ids || (st->>'id')::uuid; end if;
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
                            right_weight_kg, right_assistance_kg, right_reps, right_rir, right_completed, right_completed_at,
                            drop_parent_id)
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
              v_r, case when v_r then coalesce((st->>'right_completed_at')::timestamptz, (st->>'completed_at')::timestamptz, v_start) end,
              (st->>'drop_parent_id')::uuid)
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
            right_completed = excluded.right_completed, right_completed_at = excluded.right_completed_at,
            drop_parent_id = excluded.drop_parent_id;
    end loop;
  end loop;
end $$;
