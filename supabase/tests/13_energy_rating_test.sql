-- Starting energy: optional, 1–10, null when not answered, kept through finishing and History edits.
\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
begin;
delete from public.workout_sessions where status = 'in_progress';
do $$
declare
  sid uuid;
begin
  -- Skipped: a new workout has no rating.
  sid := public.start_workout_on(null, 'Energy test', null);
  assert (select energy_rating is null from public.workout_sessions where id = sid), 'unanswered stays null';

  -- Out of range is rejected and nothing changes.
  begin
    update public.workout_sessions set energy_rating = 0 where id = sid;
    raise exception 'TEST: 0 accepted';
  exception when check_violation then null;
  end;
  begin
    update public.workout_sessions set energy_rating = 11 where id = sid;
    raise exception 'TEST: 11 accepted';
  exception when check_violation then null;
  end;
  assert (select energy_rating is null from public.workout_sessions where id = sid), 'invalid rating not stored';

  -- Rated, then finished: the rating survives finish_workout.
  update public.workout_sessions set energy_rating = 7 where id = sid;
  insert into public.session_exercises (id, session_id, exercise_id, position, prescribed)
  values ('eeeeeeee-1500-0000-0000-000000000011', sid, (select id from public.exercises where slug = 'incline-smith-press'), 0, '{"sets": 1}');
  insert into public.set_logs (id, session_id, session_exercise_id, position, weight_kg, reps, completed)
  values ('eeeeeeee-1500-0000-0000-000000000021', sid, 'eeeeeeee-1500-0000-0000-000000000011', 0, 60, 8, true);
  perform public.finish_workout(sid, null, now() + interval '30 minutes');
  assert (select status = 'completed' and energy_rating = 7 from public.workout_sessions where id = sid), 'rating kept on finish';

  -- A History edit leaves it alone; a direct update corrects or clears it.
  perform public.save_session_edit(sid,
    jsonb_build_object('name', 'Energy test edited', 'started_at', now(), 'ended_at', now() + interval '30 minutes'),
    jsonb_build_array(jsonb_build_object('id', 'eeeeeeee-1500-0000-0000-000000000011',
      'exercise_id', (select id from public.exercises where slug = 'incline-smith-press'), 'prescribed', '{"sets": 1}'::jsonb,
      'sets', jsonb_build_array(jsonb_build_object('id', 'eeeeeeee-1500-0000-0000-000000000021', 'weight_kg', 60, 'reps', 8)))));
  assert (select name = 'Energy test edited' and energy_rating = 7 from public.workout_sessions where id = sid), 'rating kept on edit';
  update public.workout_sessions set energy_rating = 4 where id = sid;
  assert (select energy_rating = 4 from public.workout_sessions where id = sid), 'rating editable';
  update public.workout_sessions set energy_rating = null where id = sid;
  assert (select energy_rating is null from public.workout_sessions where id = sid), 'rating can be cleared';
end $$;

-- Another account can neither read nor change it.
update public.workout_sessions set energy_rating = 9 where name = 'Energy test edited';
set request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
do $$
begin
  update public.workout_sessions set energy_rating = 1 where name = 'Energy test edited';
  assert not exists (select 1 from public.workout_sessions where name = 'Energy test edited'), 'other account cannot see it';
end $$;
set request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
begin
  assert (select energy_rating = 9 from public.workout_sessions where name = 'Energy test edited'), 'other account cannot change it';
end $$;
select 'ENERGY RATING TESTS PASSED';
rollback;
