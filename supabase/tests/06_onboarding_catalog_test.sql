-- New-account starter program, setup, the exercise catalog, CSV import and per-user isolation
-- (migrations 009 and 010).
\set ON_ERROR_STOP on
-- Two disposable accounts. Neither is a real user.
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'friend.one@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'friend.two@example.com');

do $$ declare c uuid := '33333333-3333-3333-3333-333333333333'; d uuid := '44444444-4444-4444-4444-444444444444'; begin
  assert (select onboarded_at is null and starter_seeded_at is not null and starter_version = 1 from public.profiles where id = c), 'profile created, starter seeded, setup pending';
  assert (select display_name from public.profiles where id = c) = 'Friend', 'display name prefilled from email';
  -- Each account has its own independent copy.
  assert (select count(*) from public.programs where user_id = c) = 1 and (select count(*) from public.programs where user_id = d) = 1, 'one starter each';
  assert (select count(distinct id) from public.programs where user_id in (c, d)) = 2, 'separate rows, not shared';
  assert (select count(*) from public.workout_templates where user_id = c) = 4, 'four workouts';
  assert (select count(*) from public.template_exercises where user_id = c) = 27, 'template exercises';
  assert (select count(*) from public.exercises where user_id = c) = 22, 'only the exercises the starter uses';
  assert not exists (select 1 from public.template_exercises te join public.exercises e on e.id = te.exercise_id where te.user_id <> e.user_id), 'templates reference own exercises only';
  assert (select starter_version from public.programs where user_id = c) = 1, 'starter version recorded';
  assert (select name from public.programs where user_id = c) = 'Starter program (4-day)', 'labelled starter';
  assert (select description from public.programs where user_id = c) ilike '%not personalised advice%', 'not presented as advice';
  -- Structure only: no performance, no personal text.
  assert (select count(*) from public.set_logs where user_id in (c, d)) = 0, 'no logged sets';
  assert (select count(*) from public.workout_sessions where user_id in (c, d)) = 0, 'no workout history';
  assert (select count(*) from public.personal_records where user_id in (c, d)) = 0, 'no records';
  assert (select count(*) from public.body_measurements where user_id in (c, d)) = 0, 'no measurements';
  assert (select count(*) from public.dismissed_recommendations where user_id in (c, d)) = 0, 'no recommendation state';
  assert (select bodyweight_kg from public.profiles where id = c) is null, 'no bodyweight';
  assert not exists (select 1 from public.exercises where user_id in (c, d)
    and (notes ~* 'baseline|estimate|priority|maintenance|untested|\+\s?\d+\s?kg' or instructions ~* 'estimate|baseline')), 'no personal estimates in notes';
  assert not exists (select 1 from public.template_exercises where user_id in (c, d) and notes ~* 'estimate|baseline|priority|\d+\s?kg'), 'no estimates in template notes';
  assert not exists (select 1 from public.workout_templates where user_id in (c, d) and (coalesce(notes,'') || warmup_notes) ~* 'estimate|baseline|\d+\s?kg'), 'no estimates in workout notes';
  assert not exists (select 1 from public.exercises where user_id in (c, d) and available_loads_kg is not null), 'no preset loads';
  assert (select notes from public.exercises where user_id = c and slug = 'weighted-pull-up') = 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.', 'weighted pull-up note is the neutral weight-entry instruction only';
  assert (select notes from public.exercises where user_id = c and slug = 'incline-db-press') ilike '%one dumbbell%', 'per-dumbbell instruction kept';
  assert (select weight_convention from public.exercises where user_id = c and slug = 'assisted-muscle-up-transition') = 'assistance', 'assistance convention';
  assert (select progression from public.exercises where user_id = c and slug = 'assisted-muscle-up-transition') = 'skill', 'skill stays skill';
  assert (select count(*) from public.exercise_catalog) between 100 and 150, 'catalog loaded';
  assert not exists (select 1 from pg_proc where proname = 'seed_default_program'), 'old default seeder removed';
end $$;

set role authenticated;

-- ===== user C =====
set request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
do $$ begin
  begin perform public.complete_onboarding(null, repeat('x', 61)); raise exception 'should have failed';
  exception when raise_exception then if sqlerrm <> 'name_too_long' then raise; end if; end;
  begin perform public.complete_onboarding(null, null, 'stone'); raise exception 'should have failed';
  exception when raise_exception then if sqlerrm <> 'invalid_unit' then raise; end if; end;
  assert (select onboarded_at from public.profiles) is null, 'failed setup records nothing';
end $$;

do $$ declare r jsonb; begin
  r := public.complete_onboarding(null, E'  Sam\u0007 ', 'lb');
  assert r->>'status' = 'set_up', 'setup ran';
  assert (select display_name from public.profiles) = 'Sam', 'display name cleaned';
  assert (select unit from public.profiles) = 'lb', 'unit saved';
  r := public.complete_onboarding('starter'); -- retry / second tab / old client
  assert r->>'status' = 'already_set_up', 'retry is a no-op';
  perform public.ensure_seeded();
  assert (select count(*) from public.programs) = 1, 'setup and ensure_seeded never add programs';
end $$;

-- C edits its copy; D's copy must not change.
update public.template_exercises set sets = 5, notes = 'C edit'
where template_id = (select id from public.workout_templates where name = 'Push');
update public.programs set name = 'Sam''s plan';

-- C deletes the starter entirely. Sign-ins, refreshes and setup must not bring it back.
delete from public.programs;
do $$ begin
  perform public.ensure_seeded();
  perform public.ensure_seeded();
  perform public.complete_onboarding('starter');
  assert (select count(*) from public.programs) = 0, 'deleted starter is not recreated';
  assert (select count(*) from public.workout_templates) = 0, 'no templates recreated';
end $$;

-- Explicit re-add gives a fresh copy, reusing C's own exercises.
do $$ declare p uuid; begin
  p := public.add_starter_program();
  assert (select count(*) from public.programs) = 1 and (select is_active from public.programs where id = p), 'starter added again, active';
  assert (select count(*) from public.exercises) = 22, 'exercises reused, not duplicated';
  assert (select sets from public.template_exercises te join public.workout_templates t on t.id = te.template_id
          where t.name = 'Push' and te.position = 1) = 3, 'fresh copy, not the old edits';
  -- Archiving it is also permanent.
  update public.programs set archived_at = now(), is_active = false;
  perform public.ensure_seeded();
  assert (select count(*) from public.programs where archived_at is null) = 0, 'archived starter not recreated';
  -- A second explicit add while one exists is allowed and leaves the first alone.
  perform public.add_starter_program();
  assert (select count(*) from public.programs) = 2, 'second copy added, first kept';
end $$;

-- Catalog: browse is read-only, adding copies into the library only.
do $$ declare r jsonb; te int := (select count(*) from public.template_exercises); begin
  begin insert into public.exercise_catalog (slug) values ('x'); raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
  begin perform public.copy_catalog_exercise('44444444-4444-4444-4444-444444444444', 'pull-up'); raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
  begin perform public.seed_starter_program('44444444-4444-4444-4444-444444444444'); raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
  begin perform public.seed_starter_once('44444444-4444-4444-4444-444444444444'); raise exception 'should have failed';
  exception when insufficient_privilege then null; end;

  insert into public.exercises (slug, name, equipment) values ('bench-x1', 'Bench Press', 'barbell'); -- custom, same name as a catalog alias
  insert into public.exercises (slug, name, equipment, archived_at) values ('hammer-x1', 'Hammer Curls', 'dumbbell', now());
  r := public.add_catalog_exercises(array['pull-up','assisted-pull-up-machine','barbell-bench-press','hammer-curl','lat-pulldown','not-a-slug']);
  assert jsonb_array_length(r->'added') = 2, 'two added';
  assert jsonb_array_length(r->'skipped') = 3, 'three skipped (two by name, one already linked)';
  assert (select bool_and((s->>'archived')::boolean) from jsonb_array_elements(r->'skipped') s where s->>'slug' = 'hammer-curl'), 'archived match reported';
  assert (select weight_convention from public.exercises where catalog_slug = 'assisted-pull-up-machine') = 'assistance', 'assisted keeps assistance';
  assert (select increment_is_generic and source = 'catalog' from public.exercises where catalog_slug = 'pull-up'), 'generic increment flagged';
  assert (select progression from public.exercises where catalog_slug = 'pull-up') = 'bodyweight_reps', 'bodyweight progression';
  r := public.add_catalog_exercises(array['pull-up']);
  assert jsonb_array_length(r->'added') = 0, 'repeat add is a no-op';
  assert (select count(*) from public.exercises where catalog_slug = 'pull-up') = 1, 'no duplicate catalog copy';
  assert (select count(*) from public.template_exercises) = te, 'adding to library never changes programs';
end $$;

-- Import: valid rows inserted, duplicates skipped, nothing overwritten.
do $$ declare r jsonb; rows jsonb := '[
  {"name":"Landmine Press","aliases":["landmine shoulder press"],"primary_muscles":["front_delts"],"secondary_muscles":[],
   "equipment":"barbell","category":"compound","load_type":"external","weight_convention":"total","progression":"double_progression",
   "e1rm_eligible":true,"default_sets":3,"default_rep_min":8,"default_rep_max":12,"default_rest_s":120,"increment_kg":2.5,
   "increment_is_generic":false,"instructions":"<b>not html</b>","notes":null},
  {"name":"Cable Y Raise","aliases":[],"primary_muscles":["side_delts"],"secondary_muscles":[],
   "equipment":"cable","category":"isolation","load_type":"external","weight_convention":"stack","progression":"double_progression",
   "e1rm_eligible":true,"default_sets":3,"default_rep_min":12,"default_rep_max":20,"default_rest_s":60,"increment_kg":2.5,
   "increment_is_generic":true,"instructions":null,"notes":null},
  {"name":"bench-press","aliases":[],"primary_muscles":["chest"],"secondary_muscles":[],
   "equipment":"barbell","category":"compound","load_type":"external","weight_convention":"total","progression":"double_progression",
   "e1rm_eligible":false,"default_sets":3,"default_rep_min":5,"default_rep_max":8,"default_rest_s":180,"increment_kg":5,
   "increment_is_generic":false,"instructions":null,"notes":"overwrite attempt"}
]'; begin
  r := public.import_exercises(rows);
  assert jsonb_array_length(r->'added') = 2 and jsonb_array_length(r->'skipped') = 1, 'two imported, one duplicate';
  assert (select notes from public.exercises where name = 'Bench Press') is null, 'existing exercise not overwritten';
  assert (select increment_kg from public.exercises where name = 'Bench Press') = 2.5, 'existing settings untouched';
  assert (select e1rm_eligible from public.exercises where name = 'Landmine Press'), 'compound external keeps e1RM';
  assert not (select e1rm_eligible from public.exercises where name = 'Cable Y Raise'), 'isolation e1RM refused server-side';
  assert (select source from public.exercises where name = 'Cable Y Raise') = 'import', 'source recorded';
  r := public.import_exercises(rows);
  assert jsonb_array_length(r->'added') = 0 and jsonb_array_length(r->'skipped') = 3, 'repeat import adds nothing';
  begin
    perform public.import_exercises('[{"name":"Good Row","equipment":"cable","category":"isolation","load_type":"external","weight_convention":"stack","progression":"double_progression","default_sets":3,"default_rep_min":8,"default_rep_max":12,"default_rest_s":90,"increment_kg":2.5},
                                      {"name":"Bad Row","equipment":"cable","category":"isolation","load_type":"external","weight_convention":"stack","progression":"double_progression","default_sets":3,"default_rep_min":12,"default_rep_max":8,"default_rest_s":90,"increment_kg":2.5}]');
    raise exception 'should have failed';
  exception when check_violation then null; end;
  assert not exists (select 1 from public.exercises where name = 'Good Row'), 'import is all-or-nothing';
end $$;

-- C logs a workout and a body measurement.
insert into public.programs (id, name, is_active) values ('cccc3333-0000-0000-0000-000000000001', 'C plan', false);
insert into public.workout_templates (id, program_id, name) values ('cccc3333-0000-0000-0000-000000000002', 'cccc3333-0000-0000-0000-000000000001', 'Day A');
insert into public.template_exercises (template_id, exercise_id, sets, rep_min, rep_max)
select 'cccc3333-0000-0000-0000-000000000002', id, 3, 8, 12 from public.exercises where name = 'Landmine Press';
insert into public.workout_sessions (id, name, status, ended_at) values ('cccc3333-0000-0000-0000-000000000003', 'Day A', 'completed', now());
insert into public.session_exercises (id, session_id, exercise_id)
select 'cccc3333-0000-0000-0000-000000000004', 'cccc3333-0000-0000-0000-000000000003', id from public.exercises where name = 'Landmine Press';
insert into public.set_logs (session_id, session_exercise_id, weight_kg, reps, completed)
values ('cccc3333-0000-0000-0000-000000000003', 'cccc3333-0000-0000-0000-000000000004', 30, 10, true);
insert into public.body_measurements (bodyweight_kg) values (70);

-- ===== user D =====
set request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
do $$ begin
  -- What the export route reads: every table, through RLS as D.
  assert (select count(*) from public.exercises) = 22, 'D sees only its own 22 starter exercises (none of C''s custom, catalog or imported)';
  assert (select count(*) from public.programs) = 1, 'D sees only its own program';
  assert (select count(*) from public.program_versions) = 1, 'D sees only its own versions';
  assert (select count(*) from public.workout_sessions) = 0 and (select count(*) from public.set_logs) = 0, 'D sees none of C''s workouts';
  assert (select count(*) from public.set_history) = 0, 'export view is isolated';
  assert (select count(*) from public.body_measurements) = 0, 'D sees none of C''s measurements';
  assert (select count(*) from public.personal_records) = 0, 'D sees no records';
  assert (select count(*) from public.profiles) = 1, 'D sees only own profile';
  assert (select count(*) from public.exercise_catalog) > 100, 'catalog is readable by every user';
  -- C's edits and deletes never reached D's copy.
  assert (select name from public.programs) = 'Starter program (4-day)', 'D program name unchanged';
  assert not exists (select 1 from public.template_exercises where notes = 'C edit' or sets = 5), 'C edits did not touch D';
  assert (select count(*) from public.template_exercises) = 27, 'D still has the full starter';
  perform public.complete_onboarding(null, null, 'kg');
  perform public.complete_onboarding(null);
  assert (select count(*) from public.programs) = 1, 'setup retries add nothing';
end $$;

-- D cannot write into C's rows.
do $$ declare n int; begin
  update public.exercises set notes = 'hijack' where user_id = '33333333-3333-3333-3333-333333333333';
  get diagnostics n = row_count; assert n = 0, 'cannot update another user''s exercises';
  update public.template_exercises set sets = 1 where user_id = '33333333-3333-3333-3333-333333333333';
  get diagnostics n = row_count; assert n = 0, 'cannot update another user''s programs';
  begin
    insert into public.exercises (user_id, slug, name) values ('33333333-3333-3333-3333-333333333333', 'planted', 'Planted');
    raise exception 'should have failed';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
do $$ begin
  assert (select count(*) from public.exercises where user_id = '33333333-3333-3333-3333-333333333333' and notes = 'hijack') = 0, 'C untouched';
  assert (select count(*) from public.set_logs where user_id = '33333333-3333-3333-3333-333333333333') = 1, 'C history intact';
  assert (select count(*) from public.exercises where user_id = '44444444-4444-4444-4444-444444444444' and source = 'import') = 0, 'imports stay with the importer';
end $$;

-- Name keys match the TypeScript version (src/lib/catalog/names.ts).
do $$ begin
  assert public.exercise_name_key('Pull-Ups') = public.exercise_name_key('pull up'), 'plural and punctuation';
  assert public.exercise_name_key('Leg Press') = 'legpress', 'double s kept';
  assert public.exercise_name_key('Dips') = 'dip', 'dips';
end $$;
\echo 'ONBOARDING AND CATALOG TESTS PASSED'
