-- Migration 009 on an existing account: nothing is lost or reseeded.
\set ON_ERROR_STOP on
\set uid '55555555-5555-5555-5555-555555555555'
do $$ declare uid uuid := '55555555-5555-5555-5555-555555555555'; begin
  assert (select onboarded_at is not null and setup_choice = 'legacy' from public.profiles where id = uid), 'existing account skips setup';
  assert (select count(*) from public.exercises where user_id = uid) = 23, 'all exercises kept';
  assert (select notes from public.exercises where user_id = uid and slug = 'weighted-pull-up') = 'My own note, keep it.', 'edited note kept';
  assert (select notes from public.exercises where user_id = uid and slug = 'lumbar-extension') = 'Priority: spinal-erector strength.', 'existing notes not rewritten';
  assert (select count(*) from public.exercises where user_id = uid and catalog_slug is not null) = 22, 'seeded exercises linked to catalog';
  assert (select catalog_slug is null and source = 'custom' from public.exercises where user_id = uid and name = 'My Curl'), 'custom stays custom';
  assert (select weight_convention from public.exercises where user_id = uid and slug = 'assisted-muscle-up-transition') = 'assistance', 'assisted relabelled';
  assert (select count(*) from public.programs where user_id = uid) = 1, 'program kept';
  assert (select count(*) from public.template_exercises where user_id = uid) = 27, 'templates kept';
  assert (select assistance_kg from public.set_logs where user_id = uid) = 20, 'history kept';
  assert not exists (select 1 from public.exercises where increment_is_generic), 'existing increments not relabelled';
  assert (select starter_seeded_at is not null from public.profiles where id = uid), 'existing account counts as seeded';
end $$;

set role authenticated;
set request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
do $$ declare r jsonb; begin
  perform public.ensure_seeded();
  r := public.complete_onboarding('starter');
  assert r->>'status' = 'already_set_up', 'setup not offered again';
  assert (select count(*) from public.programs) = 1, 'nothing reseeded';
  delete from public.workout_sessions; -- even with no history and the program archived, nothing is added
  update public.programs set archived_at = now(), is_active = false;
  perform public.ensure_seeded();
  assert (select count(*) from public.programs) = 1, 'existing account never gets an automatic starter';
  update public.programs set archived_at = null, is_active = true;
  -- Opting into catalog additions.
  r := public.add_catalog_exercises(array['lat-pulldown','barbell-bench-press']);
  assert jsonb_array_length(r->'added') = 1 and r->'added'->0->>'slug' = 'barbell-bench-press', 'new catalog exercise added';
  assert r->'skipped'->0->>'slug' = 'lat-pulldown', 'already-owned exercise skipped';
  assert (select count(*) from public.template_exercises) = 27, 'programs unchanged';
end $$;
reset role;
\echo 'UPGRADE TESTS PASSED'
