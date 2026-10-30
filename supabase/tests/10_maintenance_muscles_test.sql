-- Maintenance muscles (migration 012): neutral by default, validated, and private to each account.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'focus-e@example.com'),
  ('88888888-8888-8888-8888-888888888888', 'focus-f@example.com');

set role authenticated;
set request.jwt.claims = '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';
do $$
begin
  perform public.ensure_seeded();
  assert (select maintenance_muscles = '{}' from public.profiles where id = auth.uid()), 'new accounts have no maintenance focus';
  update public.profiles set maintenance_muscles = array['quads','hamstrings'] where id = auth.uid();
  assert (select maintenance_muscles = array['quads','hamstrings'] from public.profiles where id = auth.uid()), 'own setting saved';
  begin
    update public.profiles set maintenance_muscles = array['legs'] where id = auth.uid();
    raise exception 'TEST: unknown muscle accepted';
  exception when check_violation then null;
  end;
  -- Another account's row is invisible and cannot be changed.
  update public.profiles set maintenance_muscles = array['calves'] where id = '88888888-8888-8888-8888-888888888888';
end $$;

reset role;
do $$
begin
  assert (select maintenance_muscles = '{}' from public.profiles where id = '88888888-8888-8888-8888-888888888888'), 'other account untouched';
end $$;
