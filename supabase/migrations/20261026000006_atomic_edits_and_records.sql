-- Atomic history edits and personal-record replacement.
-- Both functions are security invoker: RLS decides which rows the caller can see and write.

-- Save an edited past workout in one transaction. Any failure rolls back the whole edit,
-- leaving the original workout untouched.
--   p_session:   {name, notes, started_at, ended_at}
--   p_exercises: [{id, exercise_id, prescribed, notes, sets: [{id, kind, weight_kg, assistance_kg, reps, rir, completed_at, notes}]}]
-- Array order is the saved position. Exercises and sets missing from the payload are deleted.
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
     set name = v_name, notes = nullif(p_session->>'notes', ''), started_at = v_start, ended_at = v_end
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

-- Fingerprint of the history personal records are derived from: every completed set of a
-- completed session for these exercises. Used to reject records computed from stale data.
create or replace function public.personal_record_basis(p_exercise_ids uuid[])
returns text
language sql stable security invoker set search_path = public as $$
  select md5(coalesce(string_agg(
    row(l.id, se.exercise_id, l.session_id, extract(epoch from s.started_at), l.kind, l.weight_kg, l.assistance_kg, l.reps)::text,
    ',' order by l.id), ''))
  from set_logs l
  join session_exercises se on se.id = l.session_exercise_id
  join workout_sessions s on s.id = l.session_id
  where se.exercise_id = any(p_exercise_ids) and s.status = 'completed' and l.completed;
$$;

-- Replace the caller's personal records for these exercises in one transaction.
-- Rebuilds for the same user are serialised, and records computed from history that has
-- changed since p_basis was read are rejected with 'stale_history' (the caller recomputes).
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
    select 1 from jsonb_to_recordset(p_records) r(exercise_id uuid, session_id uuid)
    where r.exercise_id is null or not (r.exercise_id = any(p_exercise_ids))
       or not exists (select 1 from workout_sessions w where w.id = r.session_id)
  ) then
    raise exception 'invalid_payload';
  end if;
  delete from personal_records where exercise_id = any(p_exercise_ids);
  insert into personal_records (exercise_id, session_id, type, value, load_kg, reps, previous, achieved_at)
  select r.exercise_id, r.session_id, r.type, r.value, r.load_kg, r.reps, r.previous, r.achieved_at
  from jsonb_to_recordset(p_records)
    as r(exercise_id uuid, session_id uuid, type text, value numeric, load_kg numeric, reps smallint, previous numeric, achieved_at timestamptz);
end $$;

grant execute on function public.save_session_edit(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.personal_record_basis(uuid[]) to authenticated;
grant execute on function public.replace_personal_records(uuid[], text, jsonb) to authenticated;
