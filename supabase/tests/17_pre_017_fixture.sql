-- Accounts as they exist before migration 017: one set up, one that signed up but hasn't finished setup.
insert into auth.users (id, email) values
  ('dddddddd-1717-4717-8717-171717171717', 'existing@example.com'),
  ('eeeeeeee-1717-4717-8717-171717171717', 'midsetup@example.com');
update public.profiles set onboarded_at = now() - interval '3 days', setup_choice = 'starter'
 where id = 'dddddddd-1717-4717-8717-171717171717';
