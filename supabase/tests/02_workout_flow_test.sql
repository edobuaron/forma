\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- finish the session left open by 01
update public.workout_sessions set status = 'completed', ended_at = now() where status = 'in_progress';

do $$
declare sid uuid; tid uuid; n int;
begin
  select id into tid from public.workout_templates where name = 'Pull';
  sid := public.start_workout(tid);
  assert (select count(*) from public.session_exercises where session_id = sid) = 7, 'pull exercises';
  assert (select count(*) from public.set_logs where session_id = sid) = 16, 'pull sets (3+3+2+2+2+2+2)';
  assert (select prescribed->>'rep_max' from public.session_exercises se join public.exercises e on e.id = se.exercise_id
          where se.session_id = sid and e.slug = 'weighted-pull-up') = '6', 'prescription snapshot';
  begin
    perform public.start_workout(tid);
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm <> 'workout_in_progress' then raise; end if;
  end;
  update public.set_logs set weight_kg = 15, reps = 5, completed = true, completed_at = now()
    where session_id = sid;
  update public.workout_sessions set status = 'completed', ended_at = now() where id = sid;
  select count(*) into n from public.recent_exercise_history(
    array(select id from public.exercises where slug in ('weighted-pull-up','barbell-row')), 6, null);
  assert n = 6, 'history rows for two exercises: ' || n;
  assert (select count(*) from public.set_history) >= 16, 'view visible';
end $$;

set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$ begin
  assert (select count(*) from public.set_history) = 0, 'view respects RLS';
  assert (select count(*) from public.recent_exercise_history(array(select id from public.exercises), 6, null)) = 0, 'rpc respects RLS';
  begin
    perform public.start_workout((select id from public.workout_templates limit 1 offset 0));
  exception when others then raise; end;
end $$;
reset role;
\echo 'WORKOUT FLOW TESTS PASSED'
