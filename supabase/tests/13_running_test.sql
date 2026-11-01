-- Running (migration 016): planned runs in templates and imports, runs in workouts, finishing a
-- run-only workout, History edits, plausibility, isolation, and runs never reaching lifting data.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('eeeeeeee-1111-4111-8111-111111111111', 'runner-a@example.com'),
  ('ffffffff-2222-4222-8222-222222222222', 'runner-b@example.com');

set role authenticated;
set request.jwt.claims = '{"sub":"eeeeeeee-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  pid uuid;
  tid uuid;
  ex uuid;
  sid uuid;
  run_id uuid;
  r jsonb;
  imported uuid;
begin
  perform public.ensure_seeded();
  assert (select distance_unit from profiles) = 'km', 'km by default';

  -- A mixed template: exercise, run by time, intervals.
  insert into programs (name) values ('Hybrid') returning id into pid;
  insert into workout_templates (program_id, name, position) values (pid, 'Run + pull', 1) returning id into tid;
  select id into ex from exercises order by name limit 1;
  insert into template_exercises (template_id, exercise_id, position, sets, rep_min, rep_max, rest_s) values (tid, ex, 2, 3, 8, 12, 90);
  insert into template_runs (template_id, position, name, target_kind, target_duration_s, setting) values (tid, 1, 'Warm-up jog', 'time', 600, 'treadmill');
  insert into template_runs (template_id, position, name, target_kind, interval_count, interval_work_m, interval_recovery_s)
    values (tid, 3, 'Intervals', 'intervals', 6, 400, 90);

  -- A target must match its kind.
  begin
    insert into template_runs (template_id, name, target_kind, target_duration_s, target_distance_m) values (tid, 'Bad', 'time', 600, 5000);
    raise exception 'TEST: time run with a distance accepted';
  exception when check_violation then null;
  end;
  begin
    insert into template_runs (template_id, name, target_kind, interval_count, interval_work_s, interval_work_m) values (tid, 'Bad', 'intervals', 4, 60, 400);
    raise exception 'TEST: interval with both work time and distance accepted';
  exception when check_violation then null;
  end;

  perform public.snapshot_program(pid, 'test');
  assert (select jsonb_array_length(snapshot->'templates'->0->'runs') from program_versions where program_id = pid order by version desc limit 1) = 2, 'snapshot includes runs';

  -- Starting copies the plan into the workout; no result is pre-filled.
  sid := public.start_workout_on(tid);
  assert (select count(*) from session_runs where session_id = sid) = 2, 'two runs copied';
  assert (select prescribed->>'target_kind' = 'time' and (prescribed->>'target_duration_s')::int = 600 and setting = 'treadmill'
            and duration_s is null and distance_m is null and not completed
          from session_runs where session_id = sid and name = 'Warm-up jog'), 'plan copied, results empty';
  assert (select (prescribed->>'interval_count')::int = 6 and (prescribed->>'interval_work_m')::numeric = 400 and not prescribed ? 'target_duration_s'
          from session_runs where session_id = sid and name = 'Intervals'), 'intervals copied without other targets';
  assert (select array_agg(position order by position) from (
            select position from session_runs where session_id = sid union all select position from session_exercises where session_id = sid) x) = '{1,2,3}',
         'one shared order';

  -- A completed run needs a duration and a possible speed.
  select id into run_id from session_runs where session_id = sid and name = 'Warm-up jog';
  begin
    update session_runs set completed = true where id = run_id;
    raise exception 'TEST: run completed without a duration';
  exception when check_violation then null;
  end;
  begin
    update session_runs set completed = true, duration_s = 600, distance_m = 10000 where id = run_id;
    raise exception 'TEST: 10 km in 10 min accepted';
  exception when check_violation then null;
  end;
  -- Typing in any order while not done is allowed (autosave mid-entry).
  update session_runs set distance_m = 10000 where id = run_id;
  update session_runs set duration_s = 610, distance_m = 1800, completed = true, completed_at = now() where id = run_id;

  -- Finishing with only a run done: works; the run that wasn't done is removed; sets stay out of it.
  perform public.finish_workout(sid, null, now());
  assert (select status from workout_sessions where id = sid) = 'completed', 'run-only completion accepted';
  assert (select count(*) from session_runs where session_id = sid) = 1, 'undone run removed';
  assert (select count(*) from set_history where session_id = sid) = 0, 'runs never appear in set history';

  -- History edit: change the run, keep its position, older 3-argument calls leave runs alone.
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Run + pull', 'started_at', now() - interval '1 hour', 'ended_at', now()),
    '[]'::jsonb);
  assert (select count(*) from session_runs where session_id = sid) = 1, 'call without runs keeps them';
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Run + pull', 'started_at', now() - interval '1 hour', 'ended_at', now()),
    '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('id', run_id, 'name', 'Warm-up jog', 'position', 0, 'duration_s', 720, 'distance_m', null,
      'effort', 4, 'setting', 'outdoor', 'prescribed', jsonb_build_object('target_kind', 'time', 'target_duration_s', 600))));
  assert (select duration_s = 720 and distance_m is null and effort = 4 and setting = 'outdoor' and completed
          from session_runs where id = run_id), 'run edited; missing distance stays missing';
  begin
    perform public.save_session_edit(sid,
      jsonb_build_object('name', 'Run + pull', 'started_at', now() - interval '1 hour', 'ended_at', now()), '[]'::jsonb,
      jsonb_build_array(jsonb_build_object('id', run_id, 'name', 'Warm-up jog', 'duration_s', null)));
    raise exception 'TEST: saved a run without a duration';
  exception when others then
    assert sqlerrm = 'missing_run_duration', 'duration required: ' || sqlerrm;
  end;
  assert (select duration_s from session_runs where id = run_id) = 720, 'failed edit changed nothing';
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Run + pull', 'started_at', now() - interval '1 hour', 'ended_at', now()), '[]'::jsonb, '[]'::jsonb);
  assert (select count(*) from session_runs where session_id = sid) = 0, 'run removed in History';

  -- A standalone run.
  sid := public.start_run_on();
  assert (select name from workout_sessions where id = sid) = 'Run', 'standalone run workout';
  assert (select count(*) from session_runs where session_id = sid) = 1 and (select count(*) from session_exercises where session_id = sid) = 0, 'one run, no exercises';
  begin
    perform public.finish_workout(sid, null, now());
    raise exception 'TEST: finished with nothing done';
  exception when others then
    assert sqlerrm like 'Complete at least one set or run%', 'nothing done refused: ' || sqlerrm;
  end;
  update session_runs set duration_s = 1800, distance_m = 5000, completed = true where session_id = sid;
  perform public.finish_workout(sid, null, now());
  assert (select count(*) from personal_records) = 0, 'runs create no records';

  -- Import: run items become template runs in order; an invalid run is refused and leaves nothing.
  begin
    perform public.create_program_from_import('22222222-0000-4000-8000-000000000001', jsonb_build_object('name', 'Bad', 'workouts', jsonb_build_array(
      jsonb_build_object('name', 'D1', 'exercises', jsonb_build_array(jsonb_build_object('kind', 'run', 'target_kind', 'time'))))));
    raise exception 'TEST: run without its target accepted';
  exception when others then
    assert sqlerrm = 'invalid_run_prescription', 'invalid run refused: ' || sqlerrm;
  end;
  assert not exists (select 1 from programs where name = 'Bad'), 'nothing left behind';
  r := public.create_program_from_import('22222222-0000-4000-8000-000000000002', jsonb_build_object('name', 'Coach hybrid', 'workouts', jsonb_build_array(
    jsonb_build_object('name', 'D1', 'exercises', jsonb_build_array(
      jsonb_build_object('kind', 'run', 'name', 'Easy run', 'target_kind', 'distance', 'target_distance_m', 5000, 'notes', 'As written: Run 5 km @ 5:30/km'),
      jsonb_build_object('exercise_id', ex, 'sets', 3, 'rep_min', 8, 'rep_max', 12, 'rest_s', 90),
      jsonb_build_object('kind', 'run', 'name', 'Strides', 'target_kind', 'intervals', 'interval_count', 6, 'interval_work_s', 20, 'interval_recovery_s', 60))))));
  imported := (r->>'program_id')::uuid;
  assert (select array_agg(tr.name order by tr.position) from template_runs tr join workout_templates t on t.id = tr.template_id where t.program_id = imported) = '{Easy run,Strides}', 'runs imported';
  assert (select te.position from template_exercises te join workout_templates t on t.id = te.template_id where t.program_id = imported) = 2, 'exercise between runs';
  assert (select target_distance_m = 5000 and target_duration_s is null and notes like '%5:30/km%' from template_runs where name = 'Easy run'), 'target and notes kept';
end $$;

-- Another account sees none of it and can't attach runs to it.
set request.jwt.claims = '{"sub":"ffffffff-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare foreign_session uuid;
begin
  perform public.ensure_seeded();
  assert (select count(*) from session_runs) = 0, 'runs private';
  assert (select count(*) from template_runs) = 0, 'planned runs private';
  reset role;
  select id into foreign_session from workout_sessions where user_id = 'eeeeeeee-1111-4111-8111-111111111111' limit 1;
  set role authenticated;
  begin
    insert into session_runs (id, session_id, name) values (gen_random_uuid(), foreign_session, 'Sneaky');
    raise exception 'TEST: run attached to another account''s workout';
  exception when others then
    assert sqlerrm in ('session owner mismatch', 'new row violates row-level security policy for table "session_runs"'), 'refused: ' || sqlerrm;
  end;
end $$;
reset role;
select 'RUNNING TESTS PASSED';
