-- Integration test: seeding, RLS isolation, ownership integrity, history preservation.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com');

do $$ begin
  assert (select count(*) from public.exercises where user_id = '11111111-1111-1111-1111-111111111111') = 22, 'exercises seeded';
  assert (select count(*) from public.workout_templates t join public.programs p on p.id = t.program_id
          where p.user_id = '11111111-1111-1111-1111-111111111111') = 4, 'templates seeded';
  assert (select count(*) from public.template_exercises where user_id = '11111111-1111-1111-1111-111111111111') = 27, 'template exercises seeded';
  assert (select count(*) from public.set_logs) = 0, 'no performance data preloaded';
  assert (select count(*) from public.program_versions where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'initial version';
end $$;

set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$ begin
  assert (select count(*) from public.exercises) = 22, 'user A sees only own exercises';
  assert (select count(*) from public.programs) = 1, 'user A sees only own program';
end $$;

-- insert with explicit user id works
-- user_id defaults to auth.uid()
insert into public.workout_sessions (id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Push');
do $$ begin
  assert (select user_id from public.workout_sessions) = '11111111-1111-1111-1111-111111111111', 'user_id default';
end $$;
insert into public.session_exercises (id, user_id, session_id, exercise_id, position, prescribed)
select 'aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
       'aaaaaaaa-0000-0000-0000-000000000001', id, 0, '{"sets":3,"rep_min":6,"rep_max":10}'
from public.exercises where slug = 'incline-smith-press';
-- idempotent upsert of the same set twice = one row
insert into public.set_logs (id, user_id, session_id, session_exercise_id, position, weight_kg, reps, completed)
values ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 0, 60, 10, true)
on conflict (id) do update set reps = excluded.reps;
insert into public.set_logs (id, user_id, session_id, session_exercise_id, position, weight_kg, reps, completed)
values ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 0, 60, 11, true)
on conflict (id) do update set reps = excluded.reps;
do $$ begin
  assert (select count(*) from public.set_logs) = 1, 'upsert is idempotent';
  assert (select reps from public.set_logs) = 11, 'upsert updated';
end $$;

-- validation: negative reps rejected
do $$ begin
  begin
    update public.set_logs set reps = -1;
    raise exception 'should have failed';
  exception when check_violation then null; end;
end $$;

-- only one in-progress session
do $$ begin
  begin
    insert into public.workout_sessions (user_id, name) values ('11111111-1111-1111-1111-111111111111', 'Second');
    raise exception 'should have failed';
  exception when unique_violation then null; end;
end $$;

-- user A cannot write rows for user B
do $$ begin
  begin
    insert into public.workout_sessions (user_id, name, status) values ('22222222-2222-2222-2222-222222222222', 'Spoof', 'completed');
    raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
end $$;

-- switch to user B
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$
declare bex uuid;
begin
  assert (select count(*) from public.set_logs) = 0, 'B cannot see A sets';
  assert (select count(*) from public.workout_sessions) = 0, 'B cannot see A sessions';
  update public.set_logs set reps = 1; -- silently affects 0 rows
  -- B cannot attach a set to A's session even with own user_id
  begin
    insert into public.set_logs (user_id, session_id, session_exercise_id, weight_kg, reps)
    values ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000002', 1, 1);
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm = 'should have failed' then raise; end if;
  end;
  -- B cannot use A's exercise in their own template
  begin
    insert into public.template_exercises (user_id, template_id, exercise_id, sets, rep_min, rep_max)
    select '22222222-2222-2222-2222-222222222222', t.id, 'aaaaaaaa-0000-0000-0000-000000000099', 3, 8, 12
    from public.workout_templates t limit 1;
    raise exception 'should have failed';
  exception when raise_exception then
    if sqlerrm = 'should have failed' then raise; end if;
  end;
end $$;

-- back to A: history survives template deletion
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.snapshot_program((select id from public.programs limit 1), 'test');
delete from public.workout_templates where name = 'Push';
do $$ begin
  assert (select count(*) from public.set_logs) = 1, 'sets survive template deletion';
  assert (select prescribed->>'rep_max' from public.session_exercises) = '10', 'prescription snapshot preserved';
  assert (select max(version) from public.program_versions) = 2, 'version bumped';
end $$;
select public.ensure_seeded();
do $$ begin
  assert (select count(*) from public.programs) = 1, 'ensure_seeded does not duplicate';
end $$;

reset role;
\echo 'ALL DATABASE TESTS PASSED'
