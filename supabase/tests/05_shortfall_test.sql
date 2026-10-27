-- Shortened workouts: optional reason on finish, editable in History, never altering logged sets.
\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
begin;
delete from public.workout_sessions where status = 'in_progress';
insert into public.workout_sessions (id, name, status, started_at)
values ('eeeeeeee-0000-0000-0000-000000000001', 'Short day', 'in_progress', now() - interval '1 hour');
insert into public.session_exercises (id, session_id, exercise_id, position, prescribed)
select 'eeeeeeee-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000001', id, 0, '{"sets": 3, "rep_min": 6, "rep_max": 10}'
from public.exercises where slug = 'incline-smith-press';
insert into public.set_logs (id, session_id, session_exercise_id, position, weight_kg, reps, completed) values
('eeeeeeee-0000-0000-0000-000000000021', 'eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000011', 0, 60, 9, true),
('eeeeeeee-0000-0000-0000-000000000022', 'eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000011', 1, 60, null, false),
('eeeeeeee-0000-0000-0000-000000000023', 'eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000011', 2, 60, null, false);
do $$
declare sid uuid := 'eeeeeeee-0000-0000-0000-000000000001';
begin
  -- Unknown reason is rejected; nothing is written.
  begin
    perform public.finish_workout(sid, null, now(), 'tired');
    raise exception 'TEST: invalid reason accepted';
  exception when check_violation then null;
  end;
  assert (select status = 'in_progress' from public.workout_sessions where id = sid), 'invalid reason must not complete';

  perform public.finish_workout(sid, null, now(), 'time');
  assert (select status = 'completed' and shortfall_reason = 'time' from public.workout_sessions where id = sid), 'reason stored on finish';
  -- Omitted sets are removed, never stored as zero reps; the completed set is unchanged.
  assert (select count(*) = 1 from public.set_logs where session_id = sid), 'only completed sets remain';
  assert (select weight_kg = 60 and reps = 9 and completed from public.set_logs where id = 'eeeeeeee-0000-0000-0000-000000000021'), 'completed set intact';
  assert not exists (select 1 from public.set_logs where session_id = sid and (reps is null or reps = 0)), 'no zero-rep rows';
  assert (select bool_and(shortfall_reason = 'time') from public.set_history where session_id = sid), 'reason visible to history read model';

  -- Correct it in History.
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Short day', 'started_at', now() - interval '1 hour', 'ended_at', now(), 'shortfall_reason', 'equipment'),
    jsonb_build_array(jsonb_build_object('id', 'eeeeeeee-0000-0000-0000-000000000011',
      'exercise_id', (select id from public.exercises where slug = 'incline-smith-press'),
      'prescribed', '{"sets": 3, "rep_min": 6, "rep_max": 10}'::jsonb,
      'sets', jsonb_build_array(jsonb_build_object('id', 'eeeeeeee-0000-0000-0000-000000000021', 'kind', 'working', 'weight_kg', 60, 'reps', 9)))));
  assert (select shortfall_reason = 'equipment' from public.workout_sessions where id = sid), 'reason editable';

  -- A payload without the key (older client) leaves it alone; an explicit null clears it.
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Short day', 'started_at', now() - interval '1 hour', 'ended_at', now()),
    jsonb_build_array(jsonb_build_object('id', 'eeeeeeee-0000-0000-0000-000000000011',
      'exercise_id', (select id from public.exercises where slug = 'incline-smith-press'),
      'sets', jsonb_build_array(jsonb_build_object('id', 'eeeeeeee-0000-0000-0000-000000000021', 'kind', 'working', 'weight_kg', 60, 'reps', 9)))));
  assert (select shortfall_reason = 'equipment' from public.workout_sessions where id = sid), 'missing key keeps reason';
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Short day', 'started_at', now() - interval '1 hour', 'ended_at', now(), 'shortfall_reason', null),
    jsonb_build_array(jsonb_build_object('id', 'eeeeeeee-0000-0000-0000-000000000011',
      'exercise_id', (select id from public.exercises where slug = 'incline-smith-press'),
      'sets', jsonb_build_array(jsonb_build_object('id', 'eeeeeeee-0000-0000-0000-000000000021', 'kind', 'working', 'weight_kg', 60, 'reps', 9)))));
  assert (select shortfall_reason is null from public.workout_sessions where id = sid), 'null clears reason';
end $$;
-- The three-argument call used before this migration still works and records no reason.
insert into public.workout_sessions (id, name, status, started_at)
values ('eeeeeeee-0000-0000-0000-000000000002', 'No reason', 'in_progress', now() - interval '1 hour');
insert into public.session_exercises (id, session_id, exercise_id, position)
select 'eeeeeeee-0000-0000-0000-000000000012', 'eeeeeeee-0000-0000-0000-000000000002', id, 0 from public.exercises where slug = 'incline-smith-press';
insert into public.set_logs (id, session_id, session_exercise_id, position, weight_kg, reps, completed) values
('eeeeeeee-0000-0000-0000-000000000024', 'eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000012', 0, 60, 8, true);
do $$ begin
  perform public.finish_workout('eeeeeeee-0000-0000-0000-000000000002', null, now());
  assert (select status = 'completed' and shortfall_reason is null from public.workout_sessions where id = 'eeeeeeee-0000-0000-0000-000000000002'), 'no reason by default';
  assert (select count(*) > 0 from public.recent_exercise_history(array[(select id from public.exercises where slug = 'incline-smith-press')])), 'recent history still works after view change';
end $$;
rollback;
\echo SHORTFALL TESTS PASSED
