\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
-- Keep fixtures inside a rollback even in the throwaway database.
begin;
delete from public.workout_sessions where status = 'in_progress';
insert into public.workout_sessions (id, name, status, started_at)
values ('dddddddd-0000-0000-0000-000000000001', 'Finish validation', 'in_progress', now() - interval '1 hour');
insert into public.session_exercises (id, session_id, exercise_id, position)
select 'dddddddd-0000-0000-0000-000000000011', 'dddddddd-0000-0000-0000-000000000001', id, 0 from public.exercises where slug = 'assisted-muscle-up-transition';
insert into public.set_logs (id, session_id, session_exercise_id, position, assistance_kg, reps, completed) values
('dddddddd-0000-0000-0000-000000000021', 'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000011', 0, null, 8, true),
('dddddddd-0000-0000-0000-000000000022', 'dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000011', 1, null, null, false);
do $$
begin
  begin
    perform public.finish_workout('dddddddd-0000-0000-0000-000000000001', null, now());
    raise exception 'TEST: invalid set accepted';
  exception when others then
    if sqlerrm not like 'A completed set is missing%' then raise; end if;
  end;
  assert (select status = 'in_progress' from public.workout_sessions where id = 'dddddddd-0000-0000-0000-000000000001'), 'failed finish must not complete workout';
  assert exists (select 1 from public.set_logs where id = 'dddddddd-0000-0000-0000-000000000022'), 'failed finish must not delete unfinished sets';
  update public.set_logs set assistance_kg = 0 where id = 'dddddddd-0000-0000-0000-000000000021';
  perform public.finish_workout('dddddddd-0000-0000-0000-000000000001', 'done', now());
  perform public.finish_workout('dddddddd-0000-0000-0000-000000000001', 'retry', now());
  assert (select status = 'completed' and notes = 'done' from public.workout_sessions where id = 'dddddddd-0000-0000-0000-000000000001'), 'zero assistance and retries are valid';
  assert not exists (select 1 from public.set_logs where id = 'dddddddd-0000-0000-0000-000000000022'), 'successful finish removes unfinished sets';
end $$;
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$ begin
  begin
    perform public.finish_workout('dddddddd-0000-0000-0000-000000000001', null, now());
    raise exception 'TEST: other user could finish workout';
  exception when others then
    if sqlerrm <> 'Workout not found.' then raise; end if;
  end;
end $$;
rollback;
\echo FINISH VALIDATION TESTS PASSED
