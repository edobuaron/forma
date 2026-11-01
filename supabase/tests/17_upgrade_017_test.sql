\set ON_ERROR_STOP on
do $$
begin
  assert (select tutorial_outcome = 'existing' and tutorial_done_at is not null from public.profiles
          where id = 'dddddddd-1717-4717-8717-171717171717'), 'existing users are not interrupted';
  assert (select tutorial_done_at is null from public.profiles
          where id = 'eeeeeeee-1717-4717-8717-171717171717'), 'an account still in setup gets the tutorial';
end $$;
