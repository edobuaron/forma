-- First-use tutorial: remembered per account, so it shows once on the first device and never again
-- after it was finished or skipped, on any device or sign-in.
--
-- * tutorial_done_at / tutorial_outcome are null until the account finishes ('completed') or skips
--   ('skipped') the tutorial. Both are set together or not at all.
-- * Accounts that finished setup before this migration are marked 'existing', so current users are not
--   interrupted; they can still open the tutorial from Settings. Accounts that haven't finished setup
--   yet get it like a new account.
-- * Replaying from Settings never changes these columns once set (the app only writes while null).
-- * Only the account's own row is writable, through the existing "own profile: update" policy.

alter table public.profiles
  add column tutorial_done_at timestamptz,
  add column tutorial_outcome text check (tutorial_outcome in ('completed', 'skipped', 'existing')),
  add constraint profiles_tutorial_both_or_neither check ((tutorial_done_at is null) = (tutorial_outcome is null));

update public.profiles
   set tutorial_done_at = now(), tutorial_outcome = 'existing'
 where onboarded_at is not null and tutorial_done_at is null;
