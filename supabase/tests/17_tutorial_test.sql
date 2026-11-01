-- First-use tutorial state (migration 017): null for new accounts, first outcome kept, private per account.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('bbbbbbbb-1717-4717-8717-171717171717', 'tour-a@example.com'),
  ('cccccccc-1717-4717-8717-171717171717', 'tour-b@example.com');

set role authenticated;
set request.jwt.claims = '{"sub":"bbbbbbbb-1717-4717-8717-171717171717","role":"authenticated"}';
do $$
begin
  perform public.ensure_seeded();
  perform public.complete_onboarding(null, null, null);
  assert (select tutorial_done_at is null and tutorial_outcome is null from public.profiles where id = auth.uid()),
    'new account has not seen the tutorial';
  -- What the app sends: only while still null.
  update public.profiles set tutorial_done_at = now(), tutorial_outcome = 'skipped' where id = auth.uid() and tutorial_done_at is null;
  update public.profiles set tutorial_done_at = now(), tutorial_outcome = 'completed' where id = auth.uid() and tutorial_done_at is null;
  assert (select tutorial_outcome = 'skipped' from public.profiles where id = auth.uid()), 'first outcome kept';
  -- Signing in again / ensure_seeded must not reset it.
  perform public.ensure_seeded();
  assert (select tutorial_outcome = 'skipped' from public.profiles where id = auth.uid()), 'survives ensure_seeded';
  begin
    update public.profiles set tutorial_outcome = 'bogus' where id = auth.uid();
    raise exception 'TEST: unknown outcome accepted';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set tutorial_done_at = null where id = auth.uid();
    raise exception 'TEST: half-cleared state accepted';
  exception when check_violation then null;
  end;
  -- Another account's row is invisible and cannot be changed.
  update public.profiles set tutorial_done_at = now(), tutorial_outcome = 'completed' where id = 'cccccccc-1717-4717-8717-171717171717';
end $$;

set request.jwt.claims = '{"sub":"cccccccc-1717-4717-8717-171717171717","role":"authenticated"}';
do $$
begin
  perform public.ensure_seeded();
  assert (select tutorial_done_at is null from public.profiles where id = auth.uid()), 'other account untouched';
end $$;
reset role;
