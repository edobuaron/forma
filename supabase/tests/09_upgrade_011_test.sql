-- Upgrade to migration 011 with representative existing data (fixture 09_pre_011_fixture.sql).
\set ON_ERROR_STOP on

-- 1. Nothing that existed changed: every pre-upgrade row is still there with identical values,
--    including user-edited exercises, history views and records. New columns take neutral defaults.
do $$
declare t text; cols text; n bigint;
begin
  foreach t in array array['profiles','exercises','programs','program_versions','workout_templates','template_exercises',
    'workout_sessions','session_exercises','set_logs','personal_records','body_measurements','dismissed_recommendations','set_history']
  loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns where table_schema = 'pre011' and table_name = t;
    execute format('select count(*) from ((select %1$s from public.%2$I except all select %1$s from pre011.%2$I)
                    union all (select %1$s from pre011.%2$I except all select %1$s from public.%2$I)) d', cols, t) into n;
    assert n = 0, format('%s changed in the upgrade (%s differing rows)', t, n);
  end loop;
  assert not exists (select 1 from public.set_logs where sided or left_completed or right_completed or left_reps is not null), 'old sets stay logged together';
  assert not exists (select 1 from public.session_exercises where track_sides or attachment_state is not null), 'old workouts: attachment not recorded';
  assert not exists (select 1 from public.exercises where track_sides or default_attachment_state is not null), 'exercise defaults unchanged';
  assert not exists (select 1 from public.personal_records where side is not null), 'old records have no side';
  assert (select count(*) from public.attachments) = 0, 'no attachments until first use';
end $$;

set role authenticated;
set request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';
do $$
declare
  ip uuid := '77777777-0000-0000-0000-000000000003';
  se uuid := '77777777-0000-0000-0000-000000000031';
  sid uuid;
  rope uuid;
  row_ex uuid := (select id from public.exercises where slug = 'seated-cable-row');
begin
  -- 2. Resume the in-progress workout started before the upgrade: finish its ordinary sets the way the
  --    new client does, switch the exercise to sides, add a left/right set with only the left done.
  update public.set_logs set reps = 10, completed = true, completed_at = now() where id = '77777777-0000-0000-0000-000000000302';
  update public.session_exercises set track_sides = true where id = se;
  update public.set_logs set sided = true where id = '77777777-0000-0000-0000-000000000303';
  update public.set_logs set left_weight_kg = 24, left_reps = 9, left_completed = true, left_completed_at = now(), completed = true
   where id = '77777777-0000-0000-0000-000000000303';
  perform public.finish_workout(ip, null, now(), 'fatigue');
  assert (select status = 'completed' and shortfall_reason = 'fatigue' from public.workout_sessions where id = ip), 'resumed workout finishes';
  assert (select count(*) from public.set_logs where session_id = ip) = 3, 'all three sets kept';
  assert (select weight_kg = 22.5 and reps = 11 from public.set_logs where id = '77777777-0000-0000-0000-000000000301'), 'set done before the upgrade intact';
  assert (select left_reps = 9 and not right_completed and right_reps is null from public.set_logs where id = '77777777-0000-0000-0000-000000000303'), 'missing side stays unknown';

  -- 3. A new workout from a pre-upgrade template, with an attachment.
  perform public.ensure_starter_attachments();
  rope := (select id from public.attachments where starter_key = 'rope');
  update public.exercises set default_attachment_state = 'attachment', default_attachment_id = rope where id = row_ex;
  sid := public.start_workout_on((select template_id from public.template_exercises where exercise_id = row_ex limit 1), null, null);
  assert (select attachment_name = 'Rope' and not track_sides from public.session_exercises where session_id = sid and exercise_id = row_ex), 'default attachment copied';
  assert not exists (select 1 from public.set_logs where session_id = sid and sided), 'exercises not set to sides start logged together';
  update public.set_logs set weight_kg = 47.5, reps = 12, completed = true, completed_at = now()
   where session_exercise_id = (select id from public.session_exercises where session_id = sid and exercise_id = row_ex);
  perform public.finish_workout(sid, null, now());
  assert (select count(*) from public.set_history where session_id = sid and attachment_name = 'Rope') >= 1, 'history read model has the attachment';

  -- 4. Edit a pre-upgrade workout with an older-shaped payload (no new keys): nothing is lost.
  perform public.save_session_edit('77777777-0000-0000-0000-000000000001',
    jsonb_build_object('name', 'Pull (edited)', 'started_at', now() - interval '10 days', 'ended_at', now() - interval '10 days' + interval '50 minutes'),
    (select jsonb_agg(jsonb_build_object('id', x.id, 'exercise_id', x.exercise_id, 'prescribed', x.prescribed,
       'sets', (select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'weight_kg', l.weight_kg, 'assistance_kg', l.assistance_kg,
                 'reps', l.reps, 'rir', l.rir, 'completed_at', l.completed_at) order by l.position)
                from public.set_logs l where l.session_exercise_id = x.id)) order by x.position)
     from public.session_exercises x where x.session_id = '77777777-0000-0000-0000-000000000001'));
  assert (select name = 'Pull (edited)' and shortfall_reason = 'time' from public.workout_sessions where id = '77777777-0000-0000-0000-000000000001'), 'edit keeps the shortfall reason';
  assert not exists (
    select l.id, l.kind, l.weight_kg, l.assistance_kg, l.reps, l.rir, l.completed from public.set_logs l where l.session_id = '77777777-0000-0000-0000-000000000001'
    except select p.id, p.kind, p.weight_kg, p.assistance_kg, p.reps, p.rir, p.completed from pre011.set_logs p where p.session_id = '77777777-0000-0000-0000-000000000001'
  ), 'edited workout keeps every set value';

  -- 5. Records rebuild over mixed history: shared records plus per-side records.
  perform public.replace_personal_records(array['77777777-0000-0000-0000-0000000000e1'::uuid],
    public.personal_record_basis(array['77777777-0000-0000-0000-0000000000e1'::uuid]),
    jsonb_build_array(
      jsonb_build_object('exercise_id', '77777777-0000-0000-0000-0000000000e1', 'session_id', '77777777-0000-0000-0000-000000000001', 'type', 'heaviest_load', 'value', 22.5, 'achieved_at', now()),
      jsonb_build_object('exercise_id', '77777777-0000-0000-0000-0000000000e1', 'session_id', ip, 'type', 'heaviest_load', 'value', 24, 'side', 'left', 'achieved_at', now())));
  assert (select count(*) from public.personal_records where exercise_id = '77777777-0000-0000-0000-0000000000e1') = 2, 'shared and side records coexist';
end $$;

-- 6. Isolation: account B sees none of A's workouts, sides or attachments, and its own data is intact.
set request.jwt.claims = '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';
do $$
begin
  assert (select count(*) from public.workout_sessions) = 1, 'B sees only its own workout';
  assert (select count(*) from public.attachments) = 0, 'B sees none of A''s attachments';
  assert not exists (select 1 from public.set_history where sided), 'B sees no side data';
  perform public.ensure_starter_attachments();
  assert (select count(*) from public.attachments) = 8, 'B gets its own list';
  assert (select weight_kg = 26 and reps = 9 from public.set_logs where id = '88888888-0000-0000-0000-000000000101'), 'B''s set intact';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.attachments where user_id = '77777777-7777-7777-7777-777777777777') = 8, 'A''s list unchanged by B';
end $$;
select 'UPGRADE 011 TESTS PASSED';
