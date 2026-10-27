-- An account as it existed before migration 009: auto-seeded program, an edited note, a custom
-- exercise and a logged workout. Applied by run.sh between migrations 008 and 009.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('55555555-5555-5555-5555-555555555555', 'existing@example.com');
update public.exercises set notes = 'My own note, keep it.' where user_id = '55555555-5555-5555-5555-555555555555' and slug = 'weighted-pull-up';
insert into public.exercises (user_id, slug, name, equipment) values ('55555555-5555-5555-5555-555555555555', 'my-curl-ab12', 'My Curl', 'dumbbell');
insert into public.workout_sessions (id, user_id, name, status, ended_at)
values ('55555555-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'Pull', 'completed', now());
insert into public.session_exercises (id, user_id, session_id, exercise_id)
select '55555555-0000-0000-0000-000000000002', user_id, '55555555-0000-0000-0000-000000000001', id
from public.exercises where user_id = '55555555-5555-5555-5555-555555555555' and slug = 'assisted-muscle-up-transition';
insert into public.set_logs (user_id, session_id, session_exercise_id, assistance_kg, reps, completed)
values ('55555555-5555-5555-5555-555555555555', '55555555-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000002', 20, 3, true);
