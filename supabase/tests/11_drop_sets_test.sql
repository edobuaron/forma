-- Drop sets (migration 013), with two disposable accounts.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('99999999-9999-9999-9999-999999999999', 'drops-g@example.com'),
  ('aaaaaaaa-9999-9999-9999-999999999999', 'drops-h@example.com');

set role authenticated;
set request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
insert into public.exercises (id, slug, name, equipment, load_type, weight_convention) values
  ('dddd0000-0000-0000-0000-000000000001', 'drop-test-raise', 'Drop test raise', 'cable', 'external', 'stack');
insert into public.workout_sessions (id, name, status, started_at)
  values ('dddd0000-0000-0000-0000-000000000010', 'Drops', 'in_progress', now() - interval '1 hour');
insert into public.session_exercises (id, session_id, exercise_id, position, prescribed) values
  ('dddd0000-0000-0000-0000-000000000011', 'dddd0000-0000-0000-0000-000000000010', 'dddd0000-0000-0000-0000-000000000001', 0, '{"sets":2}');

do $$
declare
  sid uuid := 'dddd0000-0000-0000-0000-000000000010';
  se uuid := 'dddd0000-0000-0000-0000-000000000011';
  p1 uuid := 'dddd0000-0000-0000-0000-000000000021';
  p2 uuid := 'dddd0000-0000-0000-0000-000000000022';
  d1 uuid := 'dddd0000-0000-0000-0000-000000000031';
  d2 uuid := 'dddd0000-0000-0000-0000-000000000032';
  d3 uuid := 'dddd0000-0000-0000-0000-000000000033';
begin
  -- A segment may be written before its parent within one write (checks run at commit).
  insert into public.set_logs (id, session_id, session_exercise_id, position, kind, drop_parent_id, weight_kg, reps, completed) values
    (d1, sid, se, 1, 'drop', p1, 15, 8, true),
    (p1, sid, se, 0, 'working', null, 20, 10, true),
    (d2, sid, se, 2, 'drop', p1, 10, 6, false),
    (p2, sid, se, 3, 'working', null, 20, 9, true);
  set constraints all immediate;
  set constraints all deferred;

  -- Shape: 'drop' iff a parent is named.
  begin
    insert into public.set_logs (session_id, session_exercise_id, position, kind, weight_kg, reps) values (sid, se, 9, 'drop', 5, 5);
    raise exception 'TEST: drop without parent accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.set_logs (session_id, session_exercise_id, position, kind, drop_parent_id) values (sid, se, 9, 'working', p1);
    raise exception 'TEST: working set with parent accepted';
  exception when check_violation then null;
  end;
  -- A segment's parent must be a working set: not another segment, not a warm-up.
  begin
    insert into public.set_logs (id, session_id, session_exercise_id, position, kind, drop_parent_id) values (d3, sid, se, 9, 'drop', d1);
    set constraints all immediate;
    raise exception 'TEST: drop of a drop accepted';
  exception when others then
    if sqlerrm <> 'drop_parent_not_working' then raise; end if;
  end;
  set constraints all deferred;
  begin
    update public.set_logs set kind = 'warmup' where id = p1;
    set constraints all immediate;
    raise exception 'TEST: parent with segments turned into a warm-up';
  exception when others then
    if sqlerrm <> 'drop_parent_not_working' then raise; end if;
  end;
  set constraints all deferred;

  -- Finishing: a completed drop under an unfinished parent is refused, never silently deleted.
  update public.set_logs set completed = false where id = p1;
  begin
    perform public.finish_workout(sid, null, now());
    raise exception 'TEST: orphaned drop accepted';
  exception when others then
    if sqlerrm not like 'A drop is logged under%' then raise; end if;
  end;
  update public.set_logs set completed = true where id = p1;
  perform public.finish_workout(sid, null, now());
  assert (select count(*) from public.set_logs where session_id = sid) = 3, 'unfinished segment removed, the rest kept';
  assert (select kind::text = 'drop' and drop_parent_id = p1 and weight_kg = 15 from public.set_logs where id = d1), 'segment kept as logged';
  -- The history read model exposes the parent and keeps drop rows out of 'working'.
  assert (select count(*) from public.set_history where session_id = sid and kind::text = 'working') = 2, 'two planned sets';
  assert (select drop_parent_id = p1 from public.set_history where id = d1), 'set_history carries the parent';
  -- Recent history still finds the session; drop rows come with it, marked as drops.
  assert (select count(*) from public.recent_exercise_history(array['dddd0000-0000-0000-0000-000000000001'::uuid], 6, null) where kind::text = 'drop') = 1,
    'recent history includes the drop row';

  -- Editing in History: drops round-trip, and must follow a working set of the same exercise.
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Drops', 'started_at', now() - interval '1 hour', 'ended_at', now()),
    jsonb_build_array(jsonb_build_object('id', se, 'exercise_id', 'dddd0000-0000-0000-0000-000000000001', 'sets', jsonb_build_array(
      jsonb_build_object('id', p1, 'kind', 'working', 'weight_kg', 20, 'reps', 10),
      jsonb_build_object('id', d1, 'kind', 'drop', 'drop_parent_id', p1, 'weight_kg', 12.5, 'reps', 8),
      jsonb_build_object('id', d3, 'kind', 'drop', 'drop_parent_id', p1, 'weight_kg', 7.5, 'reps', 6),
      jsonb_build_object('id', p2, 'kind', 'working', 'weight_kg', 20, 'reps', 9)))));
  assert (select array_agg(id order by position) = array[p1, d1, d3, p2] from public.set_logs where session_id = sid), 'order saved';
  assert (select weight_kg = 12.5 from public.set_logs where id = d1), 'edited drop weight saved';
  begin
    perform public.save_session_edit(sid,
      jsonb_build_object('name', 'Drops', 'started_at', now() - interval '1 hour', 'ended_at', now()),
      jsonb_build_array(jsonb_build_object('id', se, 'exercise_id', 'dddd0000-0000-0000-0000-000000000001', 'sets', jsonb_build_array(
        jsonb_build_object('id', d1, 'kind', 'drop', 'drop_parent_id', p1, 'weight_kg', 12.5, 'reps', 8),
        jsonb_build_object('id', p1, 'kind', 'working', 'weight_kg', 20, 'reps', 10)))));
    raise exception 'TEST: drop before its parent accepted';
  exception when others then
    if sqlerrm <> 'invalid_drop' then raise; end if;
  end;
  -- Removing the parent in an edit removes its drops.
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Drops', 'started_at', now() - interval '1 hour', 'ended_at', now()),
    jsonb_build_array(jsonb_build_object('id', se, 'exercise_id', 'dddd0000-0000-0000-0000-000000000001', 'sets', jsonb_build_array(
      jsonb_build_object('id', p2, 'kind', 'working', 'weight_kg', 20, 'reps', 9)))));
  set constraints all immediate;
  assert (select count(*) from public.set_logs where session_id = sid) = 1, 'parent removal removes its drops';
end $$;

-- Another account can't see the rows or attach a drop to them.
set request.jwt.claims = '{"sub":"aaaaaaaa-9999-9999-9999-999999999999","role":"authenticated"}';
do $$
begin
  assert (select count(*) from public.set_logs where session_id = 'dddd0000-0000-0000-0000-000000000010') = 0, 'rows are private';
  insert into public.exercises (id, slug, name, equipment, load_type) values ('dddd0000-0000-0000-0000-000000000002', 'drop-test-curl', 'Drop test curl', 'dumbbell', 'external');
  insert into public.workout_sessions (id, name, status) values ('dddd0000-0000-0000-0000-000000000040', 'Other', 'in_progress');
  insert into public.session_exercises (id, session_id, exercise_id, position) values
    ('dddd0000-0000-0000-0000-000000000041', 'dddd0000-0000-0000-0000-000000000040', 'dddd0000-0000-0000-0000-000000000002', 0);
  begin
    insert into public.set_logs (session_id, session_exercise_id, position, kind, drop_parent_id)
      values ('dddd0000-0000-0000-0000-000000000040', 'dddd0000-0000-0000-0000-000000000041', 0, 'drop', 'dddd0000-0000-0000-0000-000000000022');
    set constraints all immediate;
    raise exception 'TEST: drop attached to another account''s set';
  exception when others then
    if sqlerrm not in ('drop parent owner mismatch', 'drop_parent_other_exercise') and sqlstate <> '23503' then raise; end if;
  end;
end $$;
reset role;
\echo DROP SET TESTS PASSED
