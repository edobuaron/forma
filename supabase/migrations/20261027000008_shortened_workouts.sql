-- Why planned sets were left out of a workout (shortened sessions).
-- User-declared and optional. NULL means "not recorded" and is never read as fatigue.
-- Omitted sets are not stored at all: completed sets stay as logged, nothing becomes zero reps.
-- Existing rows are untouched (the new column starts NULL for every past workout).

alter table public.workout_sessions add column shortfall_reason text
  check (shortfall_reason in ('time', 'equipment', 'fatigue', 'other'));

-- Expose it to progression via the history read model (new column appended; existing columns unchanged).
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
  s.shortfall_reason
from public.set_logs l
join public.session_exercises se on se.id = l.session_exercise_id
join public.workout_sessions s on s.id = l.session_id;

-- finish_workout gains an optional reason. Same body as migration 007 otherwise.
drop function if exists public.finish_workout(uuid, text, timestamptz);
-- Final validation and completion are one transaction, including removal of unfinished sets.
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
    where l.session_id = p_session_id and l.completed
      and (l.reps is null or l.reps < 1
        or (e.load_type = 'assisted' and l.assistance_kg is null)
        or (e.load_type = 'external' and l.weight_kg is null))
  ) then raise exception 'A completed set is missing reps or load. Correct it before finishing.'; end if;
  delete from set_logs where session_id = p_session_id and not completed;
  update workout_sessions set status = 'completed', ended_at = p_ended_at, notes = p_notes, shortfall_reason = p_shortfall_reason
   where id = p_session_id;
end $$;
revoke execute on function public.finish_workout(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.finish_workout(uuid, text, timestamptz, text) to authenticated;

-- save_session_edit: the reason is editable in History. Same body as migration 006, except it also
-- writes shortfall_reason — only when the payload carries the key, so an older client can't clear it.
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
      v_reps := (st->>'reps')::integer;
      if v_reps is null or v_reps < 1 then raise exception 'missing_reps' using detail = v_ex_name; end if;
      if v_load = 'assisted' and st->>'assistance_kg' is null then raise exception 'missing_assistance' using detail = v_ex_name; end if;
      if v_load = 'external' and st->>'weight_kg' is null then raise exception 'missing_weight' using detail = v_ex_name; end if;
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
    insert into session_exercises (id, session_id, exercise_id, position, prescribed, notes)
    values ((e->>'id')::uuid, p_session_id, (e->>'exercise_id')::uuid, e_pos,
            coalesce(e->'prescribed', '{}'::jsonb), nullif(e->>'notes', ''))
    on conflict (id) do update
      set exercise_id = excluded.exercise_id, position = excluded.position,
          prescribed = excluded.prescribed, notes = excluded.notes;
    for st, st_pos in select value, ordinality - 1 from jsonb_array_elements(e->'sets') with ordinality loop
      insert into set_logs (id, session_id, session_exercise_id, position, kind, weight_kg, assistance_kg, reps, rir,
                            completed, completed_at, notes)
      values ((st->>'id')::uuid, p_session_id, (e->>'id')::uuid, st_pos,
              coalesce(st->>'kind', 'working')::public.set_kind,
              (st->>'weight_kg')::numeric, (st->>'assistance_kg')::numeric, (st->>'reps')::smallint, (st->>'rir')::numeric,
              true, coalesce((st->>'completed_at')::timestamptz, v_start), nullif(st->>'notes', ''))
      on conflict (id) do update
        set session_exercise_id = excluded.session_exercise_id, position = excluded.position, kind = excluded.kind,
            weight_kg = excluded.weight_kg, assistance_kg = excluded.assistance_kg, reps = excluded.reps,
            rir = excluded.rir, completed = true, completed_at = excluded.completed_at, notes = excluded.notes;
    end loop;
  end loop;
end $$;
