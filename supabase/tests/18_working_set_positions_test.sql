\set ON_ERROR_STOP on
-- Migration 018: working-set numbers survive skipped sets; warm-ups, drops and streams don't shift them.
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
begin;
delete from public.workout_sessions where status = 'in_progress';
insert into public.workout_sessions (id, name, status, started_at)
values ('18181818-0000-0000-0000-000000000001', 'Positions', 'in_progress', now() - interval '1 hour');
insert into public.session_exercises (id, session_id, exercise_id, position)
select '18181818-0000-0000-0000-000000000011', '18181818-0000-0000-0000-000000000001', id, 0 from public.exercises where slug = 'assisted-muscle-up-transition';
-- warm-up, set 1, set 1 drop, set 2 (skipped), set 3, sided set 1, sided set 2 (skipped)
insert into public.set_logs (id, session_id, session_exercise_id, position, kind, assistance_kg, reps, completed, drop_parent_id) values
('18181818-0000-0000-0000-000000000020', '18181818-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000011', 0, 'warmup', 20, 5, true, null),
('18181818-0000-0000-0000-000000000021', '18181818-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000011', 1, 'working', 10, 8, true, null),
('18181818-0000-0000-0000-000000000022', '18181818-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000011', 2, 'drop', 15, 4, true, '18181818-0000-0000-0000-000000000021'),
('18181818-0000-0000-0000-000000000023', '18181818-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000011', 3, 'working', null, null, false, null),
('18181818-0000-0000-0000-000000000024', '18181818-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000011', 4, 'working', 10, 7, true, null);
insert into public.set_logs (id, session_id, session_exercise_id, position, kind, sided, completed, left_assistance_kg, left_reps, left_completed) values
('18181818-0000-0000-0000-000000000025', '18181818-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000011', 5, 'working', true, true, 10, 6, true),
('18181818-0000-0000-0000-000000000026', '18181818-0000-0000-0000-000000000001', '18181818-0000-0000-0000-000000000011', 6, 'working', true, false, null, null, false);
do $$
begin
  assert (select count(*) = 0 from public.set_logs where session_id = '18181818-0000-0000-0000-000000000001' and working_no is not null),
    'nothing is numbered before finishing';
  perform public.finish_workout('18181818-0000-0000-0000-000000000001', null, now());
  assert not exists (select 1 from public.set_logs where id in ('18181818-0000-0000-0000-000000000023', '18181818-0000-0000-0000-000000000026')),
    'unfinished sets are still removed';
  assert (select working_no = 1 from public.set_logs where id = '18181818-0000-0000-0000-000000000021'), 'first working set is 1 (warm-up does not count)';
  assert (select working_no = 3 from public.set_logs where id = '18181818-0000-0000-0000-000000000024'), 'set after a skipped set keeps number 3 (drop does not count)';
  assert (select working_no is null from public.set_logs where id = '18181818-0000-0000-0000-000000000020'), 'warm-ups have no number';
  assert (select working_no is null from public.set_logs where id = '18181818-0000-0000-0000-000000000022'), 'drops have no number';
  assert (select working_no = 1 from public.set_logs where id = '18181818-0000-0000-0000-000000000025'), 'sets with sides are numbered on their own';
  assert (select array_agg(working_no order by position) = array[null, 1, null, 3, 1]::smallint[]
            from public.recent_exercise_history(array(select id from public.exercises where slug = 'assisted-muscle-up-transition'), 6, null)
           where session_id = '18181818-0000-0000-0000-000000000001'),
    'history exposes the numbers in logged order';
end $$;
rollback;
\echo WORKING SET POSITION TESTS PASSED
