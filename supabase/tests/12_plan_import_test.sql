-- Plan import (migration 014): atomic, retry-safe program creation from a reviewed draft, private drafts,
-- prescriptions that create no history, and warm-up sets created when a workout starts.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('aaaaaaaa-1111-4111-8111-111111111111', 'import-a@example.com'),
  ('bbbbbbbb-2222-4222-8222-222222222222', 'import-b@example.com');

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare
  starter uuid;
  ex uuid;
  v_slug text;
  r jsonb;
  r2 jsonb;
  pid uuid;
  programs_before int;
  prog jsonb;
begin
  perform public.ensure_seeded();
  select id into starter from programs where is_active;
  assert starter is not null, 'starter is active';
  insert into exercises (slug, name, equipment, category, load_type) values ('import-test-row', 'Seated cable row', 'cable', 'compound', 'external')
    returning id into ex;
  select c.slug into v_slug from exercise_catalog c
   where not exists (select 1 from exercises e where e.catalog_slug = c.slug) order by c.slug limit 1;
  select count(*) into programs_before from programs;

  prog := jsonb_build_object('name', 'Coach plan', 'source_name', 'plan.xlsx', 'workouts', jsonb_build_array(
    jsonb_build_object('name', 'Day 1', 'exercises', jsonb_build_array(
      jsonb_build_object('exercise_id', ex, 'sets', 3, 'rep_min', 10, 'rep_max', 12, 'rest_s', 90,
        'target_rpe', 8, 'tempo', '3-1-1-0', 'per_side', true, 'warmup_sets', 2, 'drop_segments', 2,
        'drop_scope', 'last_set', 'superset_group', 'A', 'notes', 'Pause at the chest'),
      jsonb_build_object('catalog_slug', v_slug, 'sets', 4, 'rep_min', 6, 'rep_max', 8, 'rest_s', 150, 'target_rir', 2,
        'target_weight_kg', 60.5, 'superset_group', 'A')))));

  -- Invalid prescriptions are refused and leave nothing behind.
  begin
    perform public.create_program_from_import('11111111-0000-4000-8000-000000000001',
      jsonb_set(prog, '{workouts,0,exercises,0,rep_min}', '20'));
    raise exception 'TEST: rep_min > rep_max accepted';
  exception when others then
    assert sqlerrm = 'invalid_prescription', 'rep range refused: ' || sqlerrm;
  end;
  begin
    perform public.create_program_from_import('11111111-0000-4000-8000-000000000001',
      jsonb_set(prog, '{workouts,0,exercises,0,target_rpe}', '11'));
    raise exception 'TEST: RPE 11 accepted';
  exception when others then
    assert sqlerrm = 'invalid_prescription', 'RPE range refused: ' || sqlerrm;
  end;
  begin
    perform public.create_program_from_import('11111111-0000-4000-8000-000000000001',
      jsonb_set(prog, '{workouts,0,exercises,0,drop_scope}', 'null'));
    raise exception 'TEST: drop segments without scope accepted';
  exception when others then
    assert sqlerrm = 'invalid_prescription', 'drop scope required: ' || sqlerrm;
  end;
  begin
    perform public.create_program_from_import('11111111-0000-4000-8000-000000000001',
      jsonb_set(prog, '{workouts,0,exercises,0,exercise_id}', to_jsonb(gen_random_uuid()::text)));
    raise exception 'TEST: unknown exercise accepted';
  exception when others then
    assert sqlerrm = 'unknown_exercise', 'unknown exercise refused: ' || sqlerrm;
  end;
  assert (select count(*) from programs) = programs_before, 'failed imports created no program';

  r := public.create_program_from_import('11111111-0000-4000-8000-000000000001', prog);
  pid := (r->>'program_id')::uuid;
  assert r->>'status' = 'created', 'created';
  assert (select count(*) from programs) = programs_before + 1, 'one program added';
  assert not (select is_active from programs where id = pid), 'imported program is not made active by default';
  assert (select is_active from programs where id = starter), 'active program unchanged';
  assert (select count(*) from template_exercises te join workout_templates t on t.id = te.template_id where t.program_id = pid) = 2, 'two exercises';
  assert (select warmup_sets = 2 and drop_segments = 2 and drop_scope = 'last_set' and target_rpe = 8 and target_rir is null
            and tempo = '3-1-1-0' and per_side and sets = 3 and superset_group = 'A'
          from template_exercises where exercise_id = ex), 'prescription stored as given; RPE not turned into RIR';
  assert (select target_weight_kg = 60.5 and target_rir = 2 and target_rpe is null from template_exercises te
          join exercises e on e.id = te.exercise_id where e.catalog_slug = v_slug), 'catalog exercise copied and used';
  assert (select count(*) from program_versions where program_id = pid) = 1, 'one version snapshot';

  -- Retrying (double tap, lost response) returns the same program and adds nothing.
  r2 := public.create_program_from_import('11111111-0000-4000-8000-000000000001', prog);
  assert r2->>'status' = 'already_created' and (r2->>'program_id')::uuid = pid, 'retry is idempotent';
  assert (select count(*) from programs) = programs_before + 1, 'retry added no program';
  assert (select count(*) from exercises where catalog_slug = v_slug) = 1, 'catalog exercise copied once';

  -- Prescriptions are not performance: no workout, set or record exists.
  assert (select count(*) from workout_sessions) = 0, 'no sessions';
  assert (select count(*) from set_logs) = 0, 'no sets';
  assert (select count(*) from personal_records) = 0, 'no records';

  -- The created import keeps no copy of the draft and can't be reopened by the client.
  assert (select status = 'created' and draft is null and created_program_id = pid from plan_imports
          where id = '11111111-0000-4000-8000-000000000001'), 'draft cleared after creation';
  update plan_imports set status = 'draft', draft = '{}' where id = '11111111-0000-4000-8000-000000000001';
  assert (select status from plan_imports where id = '11111111-0000-4000-8000-000000000001') = 'created', 'client cannot reopen';

  -- Explicit choice to make it active switches the active program.
  r := public.create_program_from_import('11111111-0000-4000-8000-000000000002', prog, true);
  assert (select is_active from programs where id = (r->>'program_id')::uuid), 'made active on request';
  assert not (select is_active from programs where id = starter), 'previous active program switched off';

  -- Drafts are saved by the client and kept private.
  insert into plan_imports (id, source_kind, source_name, draft) values ('11111111-0000-4000-8000-000000000003', 'csv', 'a.csv', '{"workouts":[]}');
  update plan_imports set draft = '{"workouts":[1]}' where id = '11111111-0000-4000-8000-000000000003';
  assert (select draft = '{"workouts":[1]}' from plan_imports where id = '11111111-0000-4000-8000-000000000003'), 'draft autosave';
  begin
    insert into plan_imports (id, status, draft) values ('11111111-0000-4000-8000-000000000004', 'created', null);
    raise exception 'TEST: client created a finished import';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Starting an imported workout: prescription is snapshotted, warm-ups precede working sets,
  -- no drop segments are pre-created and no load is pre-filled.
  perform public.start_workout_on((select id from workout_templates where program_id = pid));
  assert (select count(*) from set_logs l join session_exercises se on se.id = l.session_exercise_id where se.exercise_id = ex and l.kind = 'warmup') = 2, 'two warm-ups';
  assert (select max(l.position) from set_logs l join session_exercises se on se.id = l.session_exercise_id where se.exercise_id = ex and l.kind = 'warmup')
       < (select min(l.position) from set_logs l join session_exercises se on se.id = l.session_exercise_id where se.exercise_id = ex and l.kind = 'working'), 'warm-ups first';
  assert (select count(*) from set_logs l join session_exercises se on se.id = l.session_exercise_id where se.exercise_id = ex and l.kind = 'working') = 3, 'three working sets';
  assert (select count(*) from set_logs where kind::text not in ('warmup', 'working')) = 0, 'no drop segments pre-created';
  assert (select count(*) from set_logs where weight_kg is not null or completed) = 0, 'nothing pre-filled or completed';
  assert (select prescribed->>'target_rpe' = '8.0' and prescribed->>'tempo' = '3-1-1-0' and (prescribed->>'per_side')::boolean
            and prescribed->>'drop_scope' = 'last_set'
          from session_exercises where exercise_id = ex), 'prescription snapshot carries the new fields';
end $$;

-- Another account sees nothing and can't reuse the import id or the exercises.
set request.jwt.claims = '{"sub":"bbbbbbbb-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare other_ex uuid;
begin
  perform public.ensure_seeded();
  assert (select count(*) from plan_imports) = 0, 'other drafts invisible';
  begin
    perform public.create_program_from_import('11111111-0000-4000-8000-000000000001', '{"name":"x","workouts":[]}');
    raise exception 'TEST: reused another account''s import id';
  exception when others then
    assert sqlerrm = 'invalid_import', 'foreign import id refused: ' || sqlerrm;
  end;
  select id into other_ex from exercises where user_id = 'aaaaaaaa-1111-4111-8111-111111111111' limit 1;
  assert other_ex is null, 'other library invisible';
  begin
    perform public.create_program_from_import('11111111-0000-4000-8000-000000000009', jsonb_build_object('name', 'x', 'workouts', jsonb_build_array(
      jsonb_build_object('name', 'D', 'exercises', jsonb_build_array(jsonb_build_object(
        'exercise_id', 'aaaaaaaa-1111-4111-8111-111111111111', 'sets', 3, 'rep_min', 8, 'rep_max', 10, 'rest_s', 60))))));
    raise exception 'TEST: used a foreign exercise id';
  exception when others then
    assert sqlerrm = 'unknown_exercise', 'foreign exercise refused: ' || sqlerrm;
  end;
  delete from plan_imports where id = '11111111-0000-4000-8000-000000000003';
end $$;

reset role;
do $$
begin
  assert (select count(*) from public.plan_imports where id = '11111111-0000-4000-8000-000000000003') = 1, 'other account could not delete';
  assert (select count(*) from public.programs where user_id = 'bbbbbbbb-2222-4222-8222-222222222222' and name = 'x') = 0, 'nothing created for B';
  update public.plan_imports set draft = draft where id = '11111111-0000-4000-8000-000000000003';
  assert (select expires_at > now() + interval '29 days' from public.plan_imports where id = '11111111-0000-4000-8000-000000000003'), 'expiry renews on change';
  alter table public.plan_imports disable trigger plan_imports_touch;
  update public.plan_imports set expires_at = now() - interval '1 minute' where id = '11111111-0000-4000-8000-000000000003';
  alter table public.plan_imports enable trigger plan_imports_touch;
end $$;

set role authenticated;
set request.jwt.claims = '{"sub":"bbbbbbbb-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
begin
  assert public.purge_expired_plan_imports() = 0, 'none of B''s drafts expired';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.plan_imports where id = '11111111-0000-4000-8000-000000000003') = 0, 'expired drafts are purged for every account';
  assert (select count(*) from public.plan_imports where status = 'created') = 2, 'created markers kept';
end $$;
select 'PLAN IMPORT TESTS PASSED';
