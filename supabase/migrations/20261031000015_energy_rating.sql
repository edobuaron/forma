-- Starting energy: an optional, self-reported 1–10 rating of how energetic the user felt at the
-- start of a workout (sleep, stress, tiredness). It is not effort, RIR or workout difficulty.
--
-- * NULL means "not answered" (skipped, or a workout from before this migration). There is no
--   default and nothing ever writes a rating the user did not pick.
-- * Nothing reads it to change progression, recommendations or records.
-- * Written by a plain owner update (RLS "own rows: update"), so finish_workout and
--   save_session_edit are unchanged and leave it as it is.
-- * Existing rows are untouched: the column starts NULL for every past workout.

alter table public.workout_sessions add column energy_rating smallint
  check (energy_rating between 1 and 10);

comment on column public.workout_sessions.energy_rating is
  'Self-reported starting energy, 1 (exhausted) to 10 (full of energy). NULL = not answered.';
