-- Representative data as it exists before migration 011 (applied by run.sh between 010 and 011):
-- two accounts with starter programs, user-edited and custom exercises, completed, shortened and
-- in-progress workouts (warm-ups, assisted, bodyweight, per-dumbbell), records and measurements.
-- A copy of every row is kept in schema pre011 so the upgrade test can prove nothing changed.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'upgrade-a@example.com'),
  ('88888888-8888-8888-8888-888888888888', 'upgrade-b@example.com');

-- A user-edited starter exercise and custom exercises.
update public.exercises set name = 'Seated cable row (my gym)', notes = 'Seat 4, chest pad 2', increment_kg = 1.25,
       available_loads_kg = '{40,42.5,45,47.5,50}', weight_convention = 'stack'
 where user_id = '77777777-7777-7777-7777-777777777777' and slug = 'seated-cable-row';
update public.exercises set notes = 'Pair of dumbbells, logged per dumbbell'
 where user_id = '77777777-7777-7777-7777-777777777777' and slug = 'incline-db-press';
insert into public.exercises (id, user_id, slug, name, equipment, load_type, weight_convention) values
  ('77777777-0000-0000-0000-0000000000e1', '77777777-7777-7777-7777-777777777777', 'single-arm-row-x1', 'Single-arm dumbbell row', 'dumbbell', 'external', 'per_dumbbell');

-- Completed, shortened (time) workout 10 days ago.
insert into public.workout_sessions (id, user_id, name, status, started_at, ended_at, shortfall_reason, notes) values
  ('77777777-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'Pull', 'completed', now() - interval '10 days', now() - interval '10 days' + interval '50 minutes', 'time', 'Short on time');
insert into public.session_exercises (id, user_id, session_id, exercise_id, position, prescribed) values
  ('77777777-0000-0000-0000-000000000011', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000001',
   (select id from public.exercises where user_id = '77777777-7777-7777-7777-777777777777' and slug = 'seated-cable-row'), 0, '{"sets":3,"rep_min":8,"rep_max":12,"rest_s":120}'),
  ('77777777-0000-0000-0000-000000000012', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000001',
   (select id from public.exercises where user_id = '77777777-7777-7777-7777-777777777777' and slug = 'assisted-muscle-up-transition'), 1, '{"sets":2,"rep_min":3,"rep_max":5}'),
  ('77777777-0000-0000-0000-000000000013', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000001',
   '77777777-0000-0000-0000-0000000000e1', 2, '{"sets":3,"rep_min":8,"rep_max":12}');
insert into public.set_logs (id, user_id, session_id, session_exercise_id, position, kind, weight_kg, assistance_kg, reps, rir, completed, completed_at) values
  ('77777777-0000-0000-0000-000000000101', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000011', 0, 'warmup', 30, null, 10, null, true, now() - interval '10 days'),
  ('77777777-0000-0000-0000-000000000102', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000011', 1, 'working', 45, null, 12, 1, true, now() - interval '10 days'),
  ('77777777-0000-0000-0000-000000000103', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000011', 2, 'working', 45, null, 11, 1.5, true, now() - interval '10 days'),
  ('77777777-0000-0000-0000-000000000104', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000012', 0, 'working', null, 0, 4, null, true, now() - interval '10 days'),
  ('77777777-0000-0000-0000-000000000105', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000013', 0, 'working', 22.5, null, 10, null, true, now() - interval '10 days');

-- Completed workout 3 days ago, and an in-progress one with a set done and two to go.
insert into public.workout_sessions (id, user_id, name, status, started_at, ended_at) values
  ('77777777-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', 'Pull', 'completed', now() - interval '3 days', now() - interval '3 days' + interval '1 hour'),
  ('77777777-0000-0000-0000-000000000003', '77777777-7777-7777-7777-777777777777', 'Pull', 'in_progress', now() - interval '20 minutes', null);
insert into public.session_exercises (id, user_id, session_id, exercise_id, position, prescribed) values
  ('77777777-0000-0000-0000-000000000021', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000002',
   (select id from public.exercises where user_id = '77777777-7777-7777-7777-777777777777' and slug = 'seated-cable-row'), 0, '{"sets":3,"rep_min":8,"rep_max":12}'),
  ('77777777-0000-0000-0000-000000000031', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000003',
   '77777777-0000-0000-0000-0000000000e1', 0, '{"sets":3,"rep_min":8,"rep_max":12}');
insert into public.set_logs (id, user_id, session_id, session_exercise_id, position, weight_kg, reps, completed, completed_at) values
  ('77777777-0000-0000-0000-000000000201', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000021', 0, 47.5, 12, true, now() - interval '3 days'),
  ('77777777-0000-0000-0000-000000000202', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000021', 1, 47.5, 12, true, now() - interval '3 days'),
  ('77777777-0000-0000-0000-000000000203', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000002', '77777777-0000-0000-0000-000000000021', 2, 47.5, 12, true, now() - interval '3 days'),
  ('77777777-0000-0000-0000-000000000301', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000031', 0, 22.5, 11, true, now() - interval '10 minutes'),
  ('77777777-0000-0000-0000-000000000302', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000031', 1, 22.5, null, false, null),
  ('77777777-0000-0000-0000-000000000303', '77777777-7777-7777-7777-777777777777', '77777777-0000-0000-0000-000000000003', '77777777-0000-0000-0000-000000000031', 2, null, null, false, null);

insert into public.personal_records (user_id, exercise_id, session_id, type, value, load_kg, reps, previous, achieved_at)
select '77777777-7777-7777-7777-777777777777', se.exercise_id, se.session_id, 'heaviest_load', 47.5, 47.5, 12, 45, now() - interval '3 days'
from public.session_exercises se where se.id = '77777777-0000-0000-0000-000000000021';
insert into public.body_measurements (user_id, measured_on, bodyweight_kg) values ('77777777-7777-7777-7777-777777777777', current_date - 2, 81.4);

-- Account B: its own completed workout.
insert into public.workout_sessions (id, user_id, name, status, started_at, ended_at) values
  ('88888888-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888', 'Push', 'completed', now() - interval '2 days', now() - interval '2 days' + interval '45 minutes');
insert into public.session_exercises (id, user_id, session_id, exercise_id, position, prescribed)
select '88888888-0000-0000-0000-000000000011', user_id, '88888888-0000-0000-0000-000000000001', id, 0, '{"sets":3,"rep_min":6,"rep_max":10}'
from public.exercises where user_id = '88888888-8888-8888-8888-888888888888' and slug = 'incline-db-press';
insert into public.set_logs (id, user_id, session_id, session_exercise_id, position, weight_kg, reps, completed, completed_at) values
  ('88888888-0000-0000-0000-000000000101', '88888888-8888-8888-8888-888888888888', '88888888-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000011', 0, 26, 9, true, now() - interval '2 days');

-- Snapshot of every row, for the upgrade test.
create schema pre011;
do $$
declare t text;
begin
  foreach t in array array['profiles','exercises','programs','program_versions','workout_templates','template_exercises',
    'workout_sessions','session_exercises','set_logs','personal_records','body_measurements','dismissed_recommendations','set_history']
  loop
    execute format('create table pre011.%I as select * from public.%I', t, t);
  end loop;
end $$;
-- Test-only: lets the authenticated role read the snapshot for comparisons.
grant usage on schema pre011 to authenticated;
grant select on all tables in schema pre011 to authenticated;
