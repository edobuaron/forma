-- Atomic history edits and personal-record replacement (throwaway test database only).
\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- A completed past workout with one external and one assisted exercise.
insert into public.workout_sessions (id, name, status, started_at, ended_at)
values ('cccccccc-0000-0000-0000-000000000001', 'Edit me', 'completed', now() - interval '10 days', now() - interval '10 days' + interval '1 hour');
insert into public.session_exercises (id, session_id, exercise_id, position)
select 'cccccccc-0000-0000-0000-000000000011', 'cccccccc-0000-0000-0000-000000000001', id, 0 from public.exercises where slug = 'incline-smith-press';
insert into public.session_exercises (id, session_id, exercise_id, position)
select 'cccccccc-0000-0000-0000-000000000012', 'cccccccc-0000-0000-0000-000000000001', id, 1 from public.exercises where slug = 'assisted-muscle-up-transition';
insert into public.set_logs (id, session_id, session_exercise_id, position, weight_kg, assistance_kg, reps, completed, completed_at) values
  ('cccccccc-0000-0000-0000-000000000021', 'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000011', 0, 60, null, 8, true, now() - interval '10 days'),
  ('cccccccc-0000-0000-0000-000000000022', 'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000011', 1, 60, null, 7, true, now() - interval '10 days'),
  ('cccccccc-0000-0000-0000-000000000023', 'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000012', 0, null, 20, 3, true, now() - interval '10 days');

-- Fingerprint of the whole workout, to prove a failed edit leaves it untouched.
create function pg_temp.workout_state() returns text language sql as $$
  select md5(concat(
    (select row(name, notes, started_at, ended_at)::text from public.workout_sessions where id = 'cccccccc-0000-0000-0000-000000000001'),
    (select string_agg(row(id, exercise_id, position, notes)::text, ',' order by id) from public.session_exercises where session_id = 'cccccccc-0000-0000-0000-000000000001'),
    (select string_agg(row(id, session_exercise_id, position, kind, weight_kg, assistance_kg, reps, rir, completed)::text, ',' order by id) from public.set_logs where session_id = 'cccccccc-0000-0000-0000-000000000001')))
$$;

-- Payload helper: the workout as the editor would send it, with overrides applied by each test.
create function pg_temp.payload_exercises(assist jsonb, extra_set jsonb default null) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000011',
      'exercise_id', (select id from public.exercises where slug = 'incline-smith-press'),
      'sets', jsonb_build_array(
        jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000021', 'kind', 'working', 'weight_kg', 62.5, 'reps', 8)
      ) || case when extra_set is null then '[]'::jsonb else jsonb_build_array(extra_set) end),
    jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000012',
      'exercise_id', (select id from public.exercises where slug = 'assisted-muscle-up-transition'),
      'sets', jsonb_build_array(
        jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000023', 'kind', 'working', 'assistance_kg', assist, 'reps', 3))))
$$;

create function pg_temp.session_json(name text default 'Edited') returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'notes', 'n',
    'started_at', now() - interval '9 days', 'ended_at', now() - interval '9 days' + interval '50 minutes')
$$;

do $$
declare before text := pg_temp.workout_state();
begin
  -- missing assistance is rejected and nothing changes (set 22 would have been deleted, weight changed)
  begin
    perform public.save_session_edit('cccccccc-0000-0000-0000-000000000001', pg_temp.session_json(), pg_temp.payload_exercises('null'::jsonb));
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm <> 'missing_assistance' then raise; end if;
  end;
  assert pg_temp.workout_state() = before, 'missing assistance: workout unchanged';

  -- a failure part-way through writing (bad value hits a table check after deletes/updates) rolls back everything
  begin
    perform public.save_session_edit('cccccccc-0000-0000-0000-000000000001', pg_temp.session_json(), pg_temp.payload_exercises('0'::jsonb,
      jsonb_build_object('id', 'cccccccc-0000-0000-0000-000000000029', 'kind', 'working', 'weight_kg', 5000, 'reps', 5)));
    raise exception 'should have failed';
  exception when check_violation then null;
  end;
  assert pg_temp.workout_state() = before, 'mid-write failure: workout unchanged';

  -- a set id that belongs to another of the user's sessions is rejected
  begin
    perform public.save_session_edit('cccccccc-0000-0000-0000-000000000001', pg_temp.session_json(), pg_temp.payload_exercises('0'::jsonb,
      jsonb_build_object('id', 'aaaaaaaa-0000-0000-0000-000000000003', 'kind', 'working', 'weight_kg', 60, 'reps', 5)));
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm <> 'row_not_in_session' then raise; end if;
  end;
  assert pg_temp.workout_state() = before, 'foreign set: workout unchanged';

  -- explicit zero assistance is valid; the edit applies in full
  perform public.save_session_edit('cccccccc-0000-0000-0000-000000000001', pg_temp.session_json(), pg_temp.payload_exercises('0'::jsonb));
  assert (select name from public.workout_sessions where id = 'cccccccc-0000-0000-0000-000000000001') = 'Edited', 'name saved';
  assert (select ended_at - started_at from public.workout_sessions where id = 'cccccccc-0000-0000-0000-000000000001') = interval '50 minutes', 'duration saved';
  assert not exists (select 1 from public.set_logs where id = 'cccccccc-0000-0000-0000-000000000022'), 'removed set deleted';
  assert (select weight_kg from public.set_logs where id = 'cccccccc-0000-0000-0000-000000000021') = 62.5, 'weight saved';
  assert (select assistance_kg from public.set_logs where id = 'cccccccc-0000-0000-0000-000000000023') = 0, 'explicit zero assistance saved';
end $$;

-- Another user can neither edit this workout nor touch its rows.
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$ begin
  begin
    perform public.save_session_edit('cccccccc-0000-0000-0000-000000000001', pg_temp.session_json('Hijacked'), '[]'::jsonb);
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm <> 'session_not_found' then raise; end if;
  end;
end $$;
-- ...nor pull its exercise rows into their own workout
do $$
declare sid uuid;
begin
  insert into public.workout_sessions (name, status, started_at, ended_at)
  values ('B past', 'completed', now() - interval '5 days', now() - interval '5 days' + interval '1 hour') returning id into sid;
  begin
    perform public.save_session_edit(sid, pg_temp.session_json('B'), jsonb_build_array(jsonb_build_object(
      'id', 'cccccccc-0000-0000-0000-000000000011', 'exercise_id', (select id from public.exercises where slug = 'incline-smith-press'),
      'sets', '[]'::jsonb)));
    raise exception 'should have failed';
  exception when unique_violation or insufficient_privilege then null;
  end;
  delete from public.workout_sessions where id = sid;
end $$;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$ begin
  assert (select name from public.workout_sessions where id = 'cccccccc-0000-0000-0000-000000000001') = 'Edited', 'other user changed nothing';
  assert (select session_id from public.session_exercises where id = 'cccccccc-0000-0000-0000-000000000011') = 'cccccccc-0000-0000-0000-000000000001', 'row not moved';
end $$;

-- Personal records: atomic replacement guarded by a history fingerprint.
do $$
declare
  ex uuid[] := array(select id from public.exercises where slug = 'incline-smith-press');
  basis text;
  rec jsonb;
begin
  basis := public.personal_record_basis(ex);
  rec := jsonb_build_array(jsonb_build_object('exercise_id', ex[1], 'session_id', 'cccccccc-0000-0000-0000-000000000001',
    'type', 'heaviest_load', 'value', 62.5, 'load_kg', 62.5, 'reps', 8, 'previous', 60, 'achieved_at', now() - interval '9 days'));
  perform public.replace_personal_records(ex, basis, rec);
  assert (select count(*) from public.personal_records where exercise_id = ex[1]) = 1, 'records written';

  -- a failing insert (duplicate record) keeps the existing records
  begin
    perform public.replace_personal_records(ex, basis, rec || rec);
    raise exception 'should have failed';
  exception when unique_violation then null;
  end;
  assert (select count(*) from public.personal_records where exercise_id = ex[1]) = 1, 'failed replace kept old records';

  -- records for an exercise outside the rebuild are rejected
  begin
    perform public.replace_personal_records(ex, basis, jsonb_build_array(rec->0 || jsonb_build_object('exercise_id', (select id from public.exercises where slug = 'assisted-muscle-up-transition'))));
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm <> 'invalid_payload' then raise; end if;
  end;

  -- history changed after the records were computed: rejected, old records kept
  update public.set_logs set reps = 9 where id = 'cccccccc-0000-0000-0000-000000000021';
  begin
    perform public.replace_personal_records(ex, basis, '[]'::jsonb);
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm <> 'stale_history' then raise; end if;
  end;
  assert (select count(*) from public.personal_records where exercise_id = ex[1]) = 1, 'stale replace kept old records';

  -- with a fresh fingerprint the replacement goes through
  perform public.replace_personal_records(ex, public.personal_record_basis(ex), '[]'::jsonb);
  assert (select count(*) from public.personal_records where exercise_id = ex[1]) = 0, 'records replaced';

  -- in-progress workouts don't change the fingerprint (autosave must not invalidate a rebuild)
  basis := public.personal_record_basis(ex);
  insert into public.workout_sessions (id, name) values ('cccccccc-0000-0000-0000-000000000002', 'Live');
  insert into public.session_exercises (id, session_id, exercise_id) values ('cccccccc-0000-0000-0000-000000000013', 'cccccccc-0000-0000-0000-000000000002', ex[1]);
  insert into public.set_logs (session_id, session_exercise_id, weight_kg, reps, completed)
  values ('cccccccc-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000013', 100, 5, true);
  assert public.personal_record_basis(ex) = basis, 'fingerprint ignores in-progress sets';
  update public.workout_sessions set status = 'completed', ended_at = now() where id = 'cccccccc-0000-0000-0000-000000000002';
  assert public.personal_record_basis(ex) <> basis, 'finishing a workout changes the fingerprint';
  delete from public.workout_sessions where id = 'cccccccc-0000-0000-0000-000000000002';
end $$;

-- Another user's rebuild cannot delete or write this user's records.
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$
declare ex uuid[] := array(select id from public.exercises where slug = 'incline-smith-press');
begin
  perform public.replace_personal_records(array(select id from public.exercises), public.personal_record_basis(array(select id from public.exercises)), '[]'::jsonb);
  begin
    perform public.replace_personal_records(ex, public.personal_record_basis(ex), jsonb_build_array(jsonb_build_object(
      'exercise_id', ex[1], 'session_id', 'cccccccc-0000-0000-0000-000000000001', 'type', 'heaviest_load', 'value', 1,
      'achieved_at', now())));
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm <> 'invalid_payload' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.personal_records where session_id = 'cccccccc-0000-0000-0000-000000000001') = 0, 'no foreign records written';
end $$;
\echo 'EDIT AND RECORD TESTS PASSED'
