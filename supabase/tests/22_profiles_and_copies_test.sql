-- Community stage 4: profiles and avatars, saving a shared workout's plan, upcoming sessions.
-- A (author) friends with B and E. A, B, C at gym G (A and C discoverable). D at another gym. F brand new.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values
  ('a3000000-0000-0000-0000-00000000000a', 'qa@example.com', '{"display_name":"Ada"}'),
  ('b3000000-0000-0000-0000-00000000000b', 'qb@example.com', '{"display_name":"Bo"}'),
  ('c3000000-0000-0000-0000-00000000000c', 'qc@example.com', '{"display_name":"Cy"}'),
  ('d3000000-0000-0000-0000-00000000000d', 'qd@example.com', '{"display_name":"Di"}'),
  ('e3000000-0000-0000-0000-00000000000e', 'qe@example.com', '{"display_name":"Ed"}'),
  ('f3000000-0000-0000-0000-00000000000f', 'qf@example.com', '{"display_name":"Fay"}');
insert into public.gyms (id, name, address, city, country, dedupe_key) values
  ('9c000000-0000-0000-0000-000000000001', 'Forge', 'Via Po 1', 'Torino', 'IT', 'forgetest22'),
  ('9c000000-0000-0000-0000-000000000002', 'Elsewhere', 'Via Po 2', 'Torino', 'IT', 'elsewheretest22');
insert into public.gym_memberships (user_id, gym_id, discoverable) values
  ('a3000000-0000-0000-0000-00000000000a', '9c000000-0000-0000-0000-000000000001', true),
  ('b3000000-0000-0000-0000-00000000000b', '9c000000-0000-0000-0000-000000000001', false),
  ('c3000000-0000-0000-0000-00000000000c', '9c000000-0000-0000-0000-000000000001', true),
  ('d3000000-0000-0000-0000-00000000000d', '9c000000-0000-0000-0000-000000000002', true);
-- (the guard turns discoverable off on insert only when the gym changes, so these stay as set)
update public.gym_memberships set discoverable = true where user_id in ('a3000000-0000-0000-0000-00000000000a', 'c3000000-0000-0000-0000-00000000000c', 'd3000000-0000-0000-0000-00000000000d');
insert into public.friendships (user_a, user_b) values
  ('a3000000-0000-0000-0000-00000000000a', 'b3000000-0000-0000-0000-00000000000b'),
  ('a3000000-0000-0000-0000-00000000000a', 'e3000000-0000-0000-0000-00000000000e');

-- A's program: bench (catalog), a custom machine, pec deck in a superset; the workout reordered,
-- substituted pec deck with cable fly, added curls ad hoc, and performed different loads.
insert into public.exercises (id, user_id, slug, name, catalog_slug, equipment, weight_convention) values
  ('e3e00000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-00000000000a', 'q-bench', 'Barbell Bench Press', 'barbell-bench-press', 'barbell', 'total'),
  ('e3e00000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-00000000000a', 'q-secret', 'Hammer Chest Thing', null, 'machine', 'total'),
  ('e3e00000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-00000000000a', 'q-pec', 'Pec Deck', null, 'machine', 'stack'),
  ('e3e00000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-00000000000a', 'q-fly', 'Cable Fly', null, 'cable', 'total'),
  ('e3e00000-0000-0000-0000-000000000005', 'a3000000-0000-0000-0000-00000000000a', 'q-curl', 'Curl', null, 'dumbbell', 'per_dumbbell'),
  ('e3e00000-0000-0000-0000-0000000000b1', 'b3000000-0000-0000-0000-00000000000b', 'q-b-pec', 'Pec Deck', null, 'machine', 'stack');
insert into public.programs (id, user_id, name, is_active) values ('7a000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-00000000000a', 'Ada plan', false);
insert into public.workout_templates (id, user_id, program_id, name, position) values
  ('7b000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-00000000000a', '7a000000-0000-0000-0000-000000000001', 'Chest', 0);
insert into public.template_exercises (id, user_id, template_id, exercise_id, position, sets, rep_min, rep_max, rest_s) values
  ('7c000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-000000000001', 'e3e00000-0000-0000-0000-000000000001', 0, 3, 6, 8, 180),
  ('7c000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-000000000001', 'e3e00000-0000-0000-0000-000000000002', 1, 2, 10, 12, 60),
  ('7c000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-00000000000a', '7b000000-0000-0000-0000-000000000001', 'e3e00000-0000-0000-0000-000000000003', 2, 3, 12, 15, 60);
insert into public.workout_sessions (id, user_id, name, status, started_at, ended_at, notes, bodyweight_kg, energy_rating, template_id, program_id)
values ('5f550000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-00000000000a', 'Chest', 'completed', now() - interval '3 hours', now() - interval '2 hours',
        'PRIVATE SESSION NOTE', 77.7, 2, '7b000000-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001');
insert into public.session_exercises (id, user_id, session_id, exercise_id, template_exercise_id, substituted_for, position, prescribed, notes) values
  ('5f000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', 'e3e00000-0000-0000-0000-000000000002', '7c000000-0000-0000-0000-000000000002', null, 0,
   '{"sets":2,"rep_min":10,"rep_max":12,"rest_s":60,"drop_segments":1,"drop_scope":"last_set","superset_group":null,"notes":"PRIVATE PLAN NOTE"}', 'PRIVATE EX NOTE'),
  ('5f000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', 'e3e00000-0000-0000-0000-000000000001', '7c000000-0000-0000-0000-000000000001', null, 1,
   '{"sets":3,"rep_min":6,"rep_max":8,"rest_s":180,"target_rir":2,"warmup_sets":2,"target_weight_kg":70,"tempo":"3010","optional":false}', null),
  ('5f000000-0000-0000-0000-000000000003', 'a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', 'e3e00000-0000-0000-0000-000000000004', '7c000000-0000-0000-0000-000000000003', 'e3e00000-0000-0000-0000-000000000003', 2,
   '{"sets":3,"rep_min":12,"rep_max":15,"rest_s":60,"superset_group":"A"}', null),
  ('5f000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', 'e3e00000-0000-0000-0000-000000000005', null, null, 3, '{}', null);
insert into public.set_logs (user_id, session_id, session_exercise_id, position, kind, weight_kg, reps, rir, completed) values
  ('a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000001', 0, 'working', 82.5, 8, 1, true),
  ('a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000001', 1, 'working', 82.5, 7, 0, true),
  ('a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000001', 2, 'working', 82.5, null, null, false),
  ('a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000002', 0, 'working', 55, 11, null, true),
  ('a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000003', 0, 'working', 17.5, 14, null, true),
  ('a3000000-0000-0000-0000-00000000000a', '5f550000-0000-0000-0000-000000000001', '5f000000-0000-0000-0000-000000000004', 0, 'working', 14, 12, null, true);

create or replace function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
$$;
set role authenticated;

-- ---------- the plan is opt-in and holds only the prescription ----------
select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
do $$ declare p jsonb; pl jsonb; t text; begin
  p := public.preview_workout_share('5f550000-0000-0000-0000-000000000001', '{}');
  assert p->'plan' is null and (p->'include'->>'plan')::boolean = false, 'plan is off unless chosen';
  p := public.preview_workout_share('5f550000-0000-0000-0000-000000000001', '{"plan":true}');
  pl := p->'plan';
  t := pl::text;
  assert jsonb_array_length(pl) = 4, 'every planned exercise plus the added one';
  assert pl->0->>'name' = 'Barbell Bench Press' and pl->1->>'name' = 'Hammer Chest Thing', 'program order, not the reordered workout';
  assert pl->2->>'name' = 'Pec Deck', 'the originally planned exercise, not the substitute';
  assert (pl->3->>'planned')::boolean = false and pl->3->'sets' is null, 'ad hoc exercise has no prescription';
  assert (pl->0->>'sets')::int = 3, 'planned sets, not the two completed';
  assert (pl->0->>'rep_min')::int = 6 and (pl->0->>'rep_max')::int = 8 and (pl->0->>'warmup_sets')::int = 2 and pl->0->>'tempo' = '3010', 'prescription kept';
  assert (pl->0->>'target_weight_kg')::numeric = 70 and pl->0->>'convention' = 'total', 'prescribed load marked with its convention';
  assert pl->0->>'catalog_slug' = 'barbell-bench-press', 'catalog link for matching';
  assert (pl->1->>'drop_segments')::int = 1 and pl->2->>'superset_group' = 'A', 'drops and supersets';
  assert t not like '%82.5%' and t not like '%PRIVATE%' and t not like '%"rir"%' and t not like '%completed%', 'no performance or notes in the plan';
  assert p::text not like '%PRIVATE%' and p::text not like '%77.7%', 'no private details anywhere';
  p := public.preview_workout_share('5f550000-0000-0000-0000-000000000001', '{"plan":true,"loads":false}');
  assert p->'plan'->0->'target_weight_kg' is null and p->'plan'->0->'convention' is null, 'loads hidden: no prescribed load either';
  assert public.share_workout('71000000-0000-0000-0000-000000000001', '5f550000-0000-0000-0000-000000000001', 'friends', '{"plan":true}', 'Try it') = 'shared', 'friends post with plan';
  assert public.share_workout('71000000-0000-0000-0000-000000000002', '5f550000-0000-0000-0000-000000000001', 'gym', '{}', null) = 'shared', 'gym post without plan';
end $$;

-- ---------- saving: eligibility, ownership of exercises, atomicity, retries ----------
select pg_temp.as_user('b3000000-0000-0000-0000-00000000000b');
do $$ declare r jsonb; r2 jsonb; n_prog int; n_active int; payload jsonb; begin
  select count(*), count(*) filter (where is_active) into n_prog, n_active from public.programs;
  payload := jsonb_build_object('destination', jsonb_build_object('kind', 'new', 'name', 'From Ada'), 'workout_name', 'Chest (Ada)',
    'exercises', jsonb_build_array(
      jsonb_build_object('catalog_slug', 'barbell-bench-press', 'sets', 3, 'rep_min', 6, 'rep_max', 8, 'rest_s', 180, 'target_rir', 2, 'warmup_sets', 2),
      jsonb_build_object('new', jsonb_build_object('name', 'Hammer Chest Thing', 'equipment', 'machine', 'muscles', '["chest"]'), 'sets', 2, 'rep_min', 10, 'rep_max', 12, 'rest_s', 60, 'drop_segments', 1, 'drop_scope', 'last_set'),
      jsonb_build_object('exercise_id', 'e3e00000-0000-0000-0000-000000000003', 'sets', 3, 'rep_min', 12, 'rep_max', 15, 'rest_s', 60, 'superset_group', 'A')));
  -- Another user's exercise id is refused, and nothing is left behind.
  begin perform public.save_shared_workout('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', payload); raise exception 'should have failed';
  exception when raise_exception then assert sqlerrm = 'unknown_exercise', sqlerrm; end;
  assert (select count(*) from public.programs) = n_prog and (select count(*) from public.workout_copies) = 0, 'atomic: nothing created';
  -- A post shared without its plan can't be saved.
  begin perform public.save_shared_workout(gen_random_uuid(), '71000000-0000-0000-0000-000000000002', payload); raise exception 'should have failed';
  exception when raise_exception then assert sqlerrm = 'not_saveable', sqlerrm; end;

  payload := jsonb_set(payload, '{exercises,2}', jsonb_build_object('exercise_id', 'e3e00000-0000-0000-0000-0000000000b1', 'sets', 3, 'rep_min', 12, 'rep_max', 15, 'rest_s', 60, 'superset_group', 'A'));
  r := public.save_shared_workout('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', payload);
  assert r->>'status' = 'saved', r::text;
  r2 := public.save_shared_workout('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', payload);
  assert r2->>'status' = 'already_saved' and r2->>'template_id' = r->>'template_id', 'retry returns the same copy';
  assert (select count(*) from public.programs) = n_prog + 1, 'one new program, not two';
  assert (select count(*) filter (where is_active) from public.programs) = n_active, 'nothing activated';
  assert not (select is_active from public.programs where id = (r->>'program_id')::uuid), 'copy is inactive';
  assert (select count(*) from public.template_exercises where template_id = (r->>'template_id')::uuid) = 3, 'three exercises';
  assert (select count(*) from public.template_exercises te join public.exercises e on e.id = te.exercise_id
           where te.template_id = (r->>'template_id')::uuid and e.user_id <> 'b3000000-0000-0000-0000-00000000000b') = 0, 'only own exercises referenced';
  assert (select target_weight_kg from public.template_exercises where template_id = (r->>'template_id')::uuid and position = 1) is null, 'no load unless kept';
  assert (select count(*) from public.exercises where name = 'Hammer Chest Thing') = 1, 'missing exercise created in own library';
  assert (select count(*) from public.workout_sessions) = 0 and (select count(*) from public.set_logs) = 0 and (select count(*) from public.personal_records) = 0, 'no history or records';

  -- Add to an existing program instead: a second workout at the end, no new program.
  r2 := public.save_shared_workout('72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001',
          jsonb_set(payload, '{destination}', jsonb_build_object('kind', 'existing', 'program_id', r->>'program_id')));
  assert r2->>'status' = 'saved' and r2->>'program_id' = r->>'program_id', r2::text;
  assert (select position from public.workout_templates where id = (r2->>'template_id')::uuid) = 1, 'appended';
  assert (select count(*) from public.programs) = n_prog + 1, 'no extra program';
  begin perform public.save_shared_workout(gen_random_uuid(), '71000000-0000-0000-0000-000000000001',
          jsonb_set(payload, '{destination}', jsonb_build_object('kind', 'existing', 'program_id', '7a000000-0000-0000-0000-000000000001'))); raise exception 'should have failed';
  exception when raise_exception then assert sqlerrm = 'invalid_destination', sqlerrm; end;
  begin perform public.save_shared_workout(gen_random_uuid(), '71000000-0000-0000-0000-000000000001',
          jsonb_set(payload, '{exercises,0,rep_min}', '20')); raise exception 'should have failed';
  exception when raise_exception then assert sqlerrm = 'invalid_prescription', sqlerrm; end;
end $$;

-- The author can't see who saved, and the source is untouched.
select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select count(*) from public.workout_copies) = 0, 'copies are private to the saver';
  assert (select count(*) from public.template_exercises where template_id = '7b000000-0000-0000-0000-000000000001') = 3, 'source program unchanged';
end $$;
-- Viewers without access to the post can't save it, or reuse someone else's request id.
select pg_temp.as_user('c3000000-0000-0000-0000-00000000000c');
do $$ begin
  begin perform public.save_shared_workout(gen_random_uuid(), '71000000-0000-0000-0000-000000000001', '{}'); raise exception 'should have failed';
  exception when raise_exception then assert sqlerrm = 'not_found', sqlerrm; end;
  assert public.save_shared_workout('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '{}')->>'status' = 'invalid', 'foreign request id';
end $$;
select pg_temp.as_user('d3000000-0000-0000-0000-00000000000d');
do $$ begin
  begin perform public.save_shared_workout(gen_random_uuid(), '71000000-0000-0000-0000-000000000001', '{}'); raise exception 'should have failed';
  exception when raise_exception then assert sqlerrm = 'not_found', sqlerrm; end;
end $$;

-- ---------- profiles ----------
select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
do $$ begin
  update public.profiles set bio = '  Morning lifter. ', training_interests = '{strength,running}',
    avatar_path = 'a3000000-0000-0000-0000-00000000000a/11111111-1111-4111-8111-111111111111.webp' where id = auth.uid();
  assert (select bio from public.profiles where id = auth.uid()) = 'Morning lifter.', 'bio trimmed';
  begin update public.profiles set training_interests = '{strength,napping}' where id = auth.uid(); raise exception 'should have failed';
  exception when check_violation then null; end;
  begin update public.profiles set avatar_path = 'b3000000-0000-0000-0000-00000000000b/11111111-1111-4111-8111-111111111111.webp' where id = auth.uid(); raise exception 'should have failed';
  exception when raise_exception then null; end;
  begin update public.profiles set bio = repeat('x', 161) where id = auth.uid(); raise exception 'should have failed';
  exception when check_violation then null; end;
  assert (public.social_profile(auth.uid())->>'relation') = 'self', 'own profile';
  assert (public.social_profile(auth.uid())->'gym'->>'name') = 'Forge', 'own gym shown while discoverable';
end $$;
reset role;
insert into storage.buckets (id, name) values ('avatars', 'avatars') on conflict do nothing;
insert into storage.objects (bucket_id, name, owner) values
  ('avatars', 'a3000000-0000-0000-0000-00000000000a/11111111-1111-4111-8111-111111111111.webp', 'a3000000-0000-0000-0000-00000000000a'),
  ('avatars', 'a3000000-0000-0000-0000-00000000000a/22222222-2222-4222-8222-222222222222.webp', 'a3000000-0000-0000-0000-00000000000a');
set role authenticated;

select pg_temp.as_user('b3000000-0000-0000-0000-00000000000b');
do $$ declare p jsonb; begin
  p := public.social_profile('a3000000-0000-0000-0000-00000000000a');
  assert p->>'bio' = 'Morning lifter.' and p->'interests' = '["strength","running"]', 'friend sees bio and interests';
  assert p->>'relation' = 'friends' and (p->>'can_message')::boolean, 'friend can message';
  assert p->'gym'->>'name' = 'Forge', 'same-gym friend sees the gym';
  assert p->>'avatar' is not null, 'avatar version';
  assert p::text not like '%77.7%' and p->'bodyweight_kg' is null and p->'energy' is null, 'nothing private';
  assert public.avatar_path_for('a3000000-0000-0000-0000-00000000000a') like 'a3000000-%', 'avatar path for friend';
  assert (select count(*) from storage.objects where bucket_id = 'avatars') = 1, 'only the current avatar is readable';
  assert (select count(*) from public.profile_posts('a3000000-0000-0000-0000-00000000000a')) = 2, 'friend + same gym: both posts';
  begin insert into storage.objects (bucket_id, name) values ('avatars', 'a3000000-0000-0000-0000-00000000000a/33333333-3333-4333-8333-333333333333.webp'); raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
  insert into storage.objects (bucket_id, name) values ('avatars', 'b3000000-0000-0000-0000-00000000000b/33333333-3333-4333-8333-333333333333.webp');
end $$;
select pg_temp.as_user('e3000000-0000-0000-0000-00000000000e');
do $$ declare p jsonb; begin
  p := public.social_profile('a3000000-0000-0000-0000-00000000000a');
  assert p->>'relation' = 'friends' and p->'gym' is null, 'friend outside the gym does not see the gym';
  assert (select count(*) from public.profile_posts('a3000000-0000-0000-0000-00000000000a')) = 1, 'friend without gym: friends post only';
end $$;
select pg_temp.as_user('c3000000-0000-0000-0000-00000000000c');
do $$ declare p jsonb; begin
  p := public.social_profile('a3000000-0000-0000-0000-00000000000a');
  assert p->>'relation' = 'none' and (p->>'can_request')::boolean and not (p->>'can_message')::boolean, 'gym member: add friend, no message';
  assert p->'gym'->>'name' = 'Forge', 'gym member sees the shared gym';
  assert (select count(*) from public.profile_posts('a3000000-0000-0000-0000-00000000000a')) = 1, 'gym post only';
end $$;
select pg_temp.as_user('d3000000-0000-0000-0000-00000000000d');
do $$ begin
  assert public.social_profile('a3000000-0000-0000-0000-00000000000a') is null, 'stranger: no profile';
  assert public.avatar_path_for('a3000000-0000-0000-0000-00000000000a') is null, 'stranger: no avatar';
  assert (select count(*) from storage.objects) = 0, 'stranger reads no avatar files';
  assert (select count(*) from public.profile_posts('a3000000-0000-0000-0000-00000000000a')) = 0, 'stranger: no posts';
end $$;
select pg_temp.as_user('f3000000-0000-0000-0000-00000000000f');
do $$ begin
  assert public.social_profile('a3000000-0000-0000-0000-00000000000a') is null, 'new account: no profile';
  assert (public.social_profile(auth.uid())->>'relation') = 'self' and public.social_profile(auth.uid())->'gym' is null, 'new account sees own empty profile';
  assert (select count(*) from public.my_upcoming_sessions()) = 0, 'no sessions';
  assert (select count(*) from public.community_feed('friends')) = 0, 'empty feed';
end $$;

-- ---------- upcoming sessions, and unfriending cancels for both ----------
select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
do $$ begin
  assert public.create_training_invite('73000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-00000000000e', null, 'Forge',
           now() + interval '2 days', 'Europe/Rome', 'Chest', null)->>'status' = 'sent', 'invite E';
  assert public.create_training_invite('73000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-00000000000b', null, 'Forge',
           now() + interval '3 days', 'Europe/Rome', null, null)->>'status' = 'sent', 'invite B';
  assert (select count(*) from public.my_upcoming_sessions()) = 0, 'sent, not yet accepted: not upcoming for the sender';
end $$;
select pg_temp.as_user('b3000000-0000-0000-0000-00000000000b');
do $$ begin
  assert (select awaiting_me from public.my_upcoming_sessions()) = true, 'waiting for B';
end $$;
select pg_temp.as_user('e3000000-0000-0000-0000-00000000000e');
do $$ begin
  assert public.respond_training_invite('73000000-0000-0000-0000-000000000001', 'accept', 1) = 'accepted', 'E accepts';
  assert (select status from public.my_upcoming_sessions()) = 'accepted', 'upcoming for E';
end $$;
select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
do $$ begin
  assert (select display_name from public.my_upcoming_sessions()) = 'Ed', 'upcoming for A with name';
  assert public.remove_friend('e3000000-0000-0000-0000-00000000000e') = 'removed', 'unfriend';
  assert (select count(*) from public.my_upcoming_sessions()) = 0, 'cancelled on unfriend';
  assert (select status from public.training_invites where id = '73000000-0000-0000-0000-000000000001') = 'cancelled', 'cancelled';
end $$;
select pg_temp.as_user('e3000000-0000-0000-0000-00000000000e');
do $$ begin
  assert (select count(*) from public.my_upcoming_sessions()) = 0, 'gone for E too';
  assert (select count(*) from public.messages where kind = 'invite_event' and body = 'cancelled') = 1, 'E sees the cancellation';
  assert public.social_profile('a3000000-0000-0000-0000-00000000000a')->>'relation' = 'none', 'still visible through the conversation, no longer friends';
  assert not (public.social_profile('a3000000-0000-0000-0000-00000000000a')->>'can_message')::boolean, 'cannot message after unfriending';
end $$;

-- ---------- blocking hides profile, avatar and saving ----------
select pg_temp.as_user('a3000000-0000-0000-0000-00000000000a');
do $$ begin assert public.block_user('b3000000-0000-0000-0000-00000000000b') = 'blocked', 'A blocks B'; end $$;
select pg_temp.as_user('b3000000-0000-0000-0000-00000000000b');
do $$ begin
  assert public.social_profile('a3000000-0000-0000-0000-00000000000a') is null, 'blocked: no profile';
  assert (select count(*) from storage.objects where name like 'a3000000-%') = 0, 'blocked: no avatar';
  assert (select count(*) from public.my_upcoming_sessions()) = 0, 'blocked: invitation gone';
  begin perform public.save_shared_workout(gen_random_uuid(), '71000000-0000-0000-0000-000000000001', '{}'); raise exception 'should have failed';
  exception when raise_exception then assert sqlerrm = 'not_found', sqlerrm; end;
  assert (select count(*) from public.workout_copies) = 2, 'copies already saved stay with B';
end $$;
reset role;
