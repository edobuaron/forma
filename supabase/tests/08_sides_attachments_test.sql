-- Left/right tracking and cable attachments (migration 011), with two disposable accounts.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'sides-c@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'sides-d@example.com');

set role authenticated;
set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
insert into public.exercises (id, slug, name, equipment, load_type, weight_convention, track_sides) values
  ('cccccccc-0000-0000-0000-000000000001', 'single-arm-cable-row', 'Single-arm cable row', 'cable', 'external', 'stack', true),
  ('cccccccc-0000-0000-0000-000000000002', 'cable-curl', 'Cable curl', 'cable', 'external', 'stack', false);

do $$
declare rope uuid; vh uuid; n int; r text; sid uuid;
begin
  -- Starter list: seeded once, idempotent, and not re-created after removal.
  perform public.ensure_starter_attachments();
  perform public.ensure_starter_attachments();
  assert (select count(*) from public.attachments) = 8, 'starter list seeded once';
  select id into rope from public.attachments where starter_key = 'rope';
  select id into vh from public.attachments where starter_key = 'v_handle';
  insert into public.attachments (name) values ('Short straight bar');
  begin
    insert into public.attachments (name) values (' rope ');
    raise exception 'TEST: duplicate name accepted';
  exception when unique_violation then null;
  end;

  -- Exercise default + workout snapshot copied on start.
  update public.exercises set default_attachment_state = 'attachment', default_attachment_id = rope where id = 'cccccccc-0000-0000-0000-000000000001';
  insert into public.programs (id, name) values ('cccccccc-0000-0000-0000-000000000010', 'Sides');
  insert into public.workout_templates (id, program_id, name) values ('cccccccc-0000-0000-0000-000000000011', 'cccccccc-0000-0000-0000-000000000010', 'Pull');
  insert into public.template_exercises (template_id, exercise_id, position, sets, rep_min, rep_max) values
    ('cccccccc-0000-0000-0000-000000000011', 'cccccccc-0000-0000-0000-000000000001', 0, 2, 8, 12),
    ('cccccccc-0000-0000-0000-000000000011', 'cccccccc-0000-0000-0000-000000000002', 1, 2, 8, 12);
  sid := public.start_workout_on('cccccccc-0000-0000-0000-000000000011', null, now() - interval '1 hour');
  assert (select track_sides and attachment_state = 'attachment' and attachment_name = 'Rope'
          from public.session_exercises where session_id = sid and position = 0), 'defaults copied to the workout';
  assert (select bool_and(sided) from public.set_logs l join public.session_exercises se on se.id = l.session_exercise_id
          where se.session_id = sid and se.position = 0), 'sets start sided';
  assert (select not track_sides and attachment_state is null from public.session_exercises where session_id = sid and position = 1),
    'no default = not recorded, logged together';
  assert (select count(*) from public.set_logs where session_id = sid) = 4, 'one row per planned set, never doubled';

  -- Renaming the catalog entry does not rewrite the workout's snapshot.
  update public.attachments set name = 'Rope (long)' where id = rope;
  update public.session_exercises set notes = 'grip' where session_id = sid and position = 0;
  assert (select attachment_name = 'Rope' from public.session_exercises where session_id = sid and position = 0), 'snapshot survives rename';
  -- A client can't write a fake name: the server takes it from the attachment on change.
  update public.session_exercises set attachment_id = vh, attachment_name = 'Fake' where session_id = sid and position = 0;
  assert (select attachment_name = 'V-handle' from public.session_exercises where session_id = sid and position = 0), 'server snapshot on change';
  -- Choosing it again snapshots its current name.
  update public.session_exercises set attachment_id = rope where session_id = sid and position = 0;

  -- Shape: a sided set can't also carry shared values, and completion follows the sides.
  begin
    update public.set_logs set weight_kg = 20 where session_id = sid and position = 0 and sided;
    raise exception 'TEST: shared value on sided set accepted';
  exception when check_violation then null;
  end;
  begin
    update public.set_logs set left_completed = true where session_id = sid and position = 0 and sided;
    raise exception 'TEST: side completion without parent accepted';
  exception when check_violation then null;
  end;

  -- Unequal sides on set 1; only the left side on set 2 (right not performed, values typed but not done).
  update public.set_logs set left_weight_kg = 25, left_reps = 10, left_completed = true, left_completed_at = now(),
         right_weight_kg = 22.5, right_reps = 8, right_rir = 1, right_completed = true, right_completed_at = now(), completed = true
   where session_id = sid and position = 0 and sided;
  update public.set_logs set left_weight_kg = 25, left_reps = 9, left_completed = true, left_completed_at = now(),
         right_weight_kg = 25, right_reps = 7, completed = true
   where session_id = sid and position = 1 and sided;
  update public.set_logs set weight_kg = 15, reps = 10, completed = true, completed_at = now()
   where session_id = sid and position = 0 and not sided;

  -- A performed side missing its load is rejected; nothing is written.
  update public.set_logs set left_weight_kg = null where session_id = sid and position = 0 and sided;
  begin
    perform public.finish_workout(sid, null, now());
    raise exception 'TEST: side without load accepted';
  exception when others then
    if sqlerrm not like 'A completed set is missing%' then raise; end if;
  end;
  update public.set_logs set left_weight_kg = 25 where session_id = sid and position = 0 and sided;

  perform public.finish_workout(sid, null, now(), 'time');
  assert (select count(*) from public.set_logs where session_id = sid) = 3, 'unperformed shared set removed, half-done sided set kept';
  assert (select right_reps is null and right_weight_kg is null and not right_completed and left_reps = 9
          from public.set_logs where session_id = sid and position = 1 and sided), 'unperformed side cleared, never zero';
  assert (select left_weight_kg = 25 and right_weight_kg = 22.5 and right_rir = 1
          from public.set_logs where session_id = sid and position = 0 and sided), 'unequal sides kept as logged';
  assert (select count(*) from public.set_history where session_id = sid and sided and attachment_name = 'Rope (long)') = 2, 'history read model carries sides and attachment';

  -- Removing an attachment: used → archived (history keeps it); unused → deleted.
  r := public.remove_attachment(rope);
  assert r = 'archived', 'used attachment archived';
  assert (select archived_at is not null from public.attachments where id = rope), 'archived';
  assert (select default_attachment_id is null and default_attachment_state is null from public.exercises where id = 'cccccccc-0000-0000-0000-000000000001'), 'exercise default cleared';
  assert (select attachment_name = 'Rope (long)' from public.session_exercises where session_id = sid and position = 0), 'history unchanged by archive';
  r := public.remove_attachment((select id from public.attachments where name = 'Short straight bar'));
  assert r = 'deleted', 'unused attachment deleted';
  perform public.ensure_starter_attachments();
  assert (select count(*) from public.attachments) = 8, 'removed attachments are not re-seeded';
  begin
    update public.session_exercises set attachment_id = rope where session_id = sid and position = 1;
    raise exception 'TEST: archived attachment newly chosen';
  exception when others then
    if sqlerrm not like '%attachment%' then raise; end if;
  end;

  -- History edit: sides stay apart; a side left out is not performed; a set with no side is refused.
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Pull', 'started_at', now() - interval '1 hour', 'ended_at', now()),
    (select jsonb_agg(jsonb_build_object('id', se.id, 'exercise_id', se.exercise_id, 'prescribed', se.prescribed,
       'sets', (select jsonb_agg(case when l.sided then jsonb_build_object('id', l.id, 'kind', 'working', 'sided', true,
                  'left_completed', true, 'left_weight_kg', 27.5, 'left_reps', 8,
                  'right_completed', l.right_completed, 'right_weight_kg', l.right_weight_kg, 'right_reps', l.right_reps)
                else jsonb_build_object('id', l.id, 'kind', 'working', 'weight_kg', l.weight_kg, 'reps', l.reps) end order by l.position)
                from public.set_logs l where l.session_exercise_id = se.id)) order by se.position)
     from public.session_exercises se where se.session_id = sid));
  assert (select left_weight_kg = 27.5 and right_reps = 8 from public.set_logs where session_id = sid and position = 0 and sided), 'edit keeps sides apart';
  assert (select not right_completed and right_reps is null from public.set_logs where session_id = sid and position = 1 and sided), 'missing side stays missing after edit';
  assert (select attachment_name = 'Rope (long)' and track_sides from public.session_exercises where session_id = sid and position = 0), 'edit without keys keeps mode and attachment';
  begin
    perform public.save_session_edit(sid,
      jsonb_build_object('name', 'Pull', 'started_at', now() - interval '1 hour', 'ended_at', now()),
      (select jsonb_agg(jsonb_build_object('id', se.id, 'exercise_id', se.exercise_id,
         'sets', (select jsonb_agg(jsonb_build_object('id', l.id, 'kind', 'working', 'sided', true) order by l.position)
                  from public.set_logs l where l.session_exercise_id = se.id)) order by se.position)
       from public.session_exercises se where se.session_id = sid and se.position = 0));
    raise exception 'TEST: empty sided set accepted';
  exception when others then
    if sqlerrm <> 'missing_side' then raise; end if;
  end;
  -- Explicit "no attachment" is distinct from not recorded.
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Pull', 'started_at', now() - interval '1 hour', 'ended_at', now()),
    (select jsonb_agg(jsonb_build_object('id', se.id, 'exercise_id', se.exercise_id, 'prescribed', se.prescribed,
       'attachment_state', case when se.position = 1 then 'none' else se.attachment_state end,
       'attachment_id', case when se.position = 1 then null else se.attachment_id end,
       'sets', (select jsonb_agg(to_jsonb(l) order by l.position) from public.set_logs l where l.session_exercise_id = se.id)) order by se.position)
     from public.session_exercises se where se.session_id = sid));
  assert (select attachment_state = 'none' and attachment_id is null from public.session_exercises where session_id = sid and position = 1), 'no attachment recorded';
  assert (select attachment_name = 'Rope (long)' from public.session_exercises where session_id = sid and position = 0), 'unchanged archived attachment kept on edit';

  -- Side records don't collide with shared records of the same type.
  perform public.replace_personal_records(array['cccccccc-0000-0000-0000-000000000001'::uuid],
    public.personal_record_basis(array['cccccccc-0000-0000-0000-000000000001'::uuid]),
    jsonb_build_array(
      jsonb_build_object('exercise_id', 'cccccccc-0000-0000-0000-000000000001', 'session_id', sid, 'type', 'heaviest_load', 'value', 27.5, 'side', 'left', 'achieved_at', now()),
      jsonb_build_object('exercise_id', 'cccccccc-0000-0000-0000-000000000001', 'session_id', sid, 'type', 'heaviest_load', 'value', 25, 'side', 'right', 'achieved_at', now())));
  assert (select count(*) from public.personal_records where session_id = sid) = 2, 'one record per side';
end $$;

-- ---------- isolation: account D sees and touches nothing of C's ----------
set request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
do $$
declare c_att uuid := (select id from public.attachments limit 1);
begin
  assert c_att is null, 'D sees no attachments of C';
  perform public.ensure_starter_attachments();
  assert (select count(*) from public.attachments) = 8, 'D gets its own starter list';
  assert not exists (select 1 from public.set_history where sided), 'D sees none of C''s sides';
end $$;
reset role;
do $$
declare c_rope uuid := (select id from public.attachments where user_id = '55555555-5555-5555-5555-555555555555' and starter_key = 'rope');
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
  -- D can't rename, archive or remove C's attachment (RLS hides it)...
  update public.attachments set name = 'mine' where id = c_rope;
  begin
    perform public.remove_attachment(c_rope);
    raise exception 'TEST: foreign attachment removed';
  exception when others then
    if sqlerrm <> 'attachment_not_found' then raise; end if;
  end;
  -- ...nor point an own exercise or workout at it.
  insert into public.exercises (id, slug, name) values ('dddddddd-4444-0000-0000-000000000001', 'd-curl', 'D curl');
  begin
    update public.exercises set default_attachment_state = 'attachment', default_attachment_id = c_rope where id = 'dddddddd-4444-0000-0000-000000000001';
    raise exception 'TEST: foreign attachment as default';
  exception when others then
    if sqlerrm not like '%attachment owner mismatch%' then raise; end if;
  end;
  insert into public.workout_sessions (id, name) values ('dddddddd-4444-0000-0000-000000000002', 'D');
  begin
    insert into public.session_exercises (session_id, exercise_id, attachment_state, attachment_id)
    values ('dddddddd-4444-0000-0000-000000000002', 'dddddddd-4444-0000-0000-000000000001', 'attachment', c_rope);
    raise exception 'TEST: foreign attachment on workout';
  exception when others then
    if sqlerrm not like '%attachment owner mismatch%' then raise; end if;
  end;
  reset role;
  assert (select name = 'Rope (long)' from public.attachments where id = c_rope), 'C''s attachment untouched';
end $$;
reset role;
select 'SIDES AND ATTACHMENTS TESTS PASSED';
