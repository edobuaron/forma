-- Per-account training focus: muscles the user is keeping at maintenance volume.
--
-- * Empty by default, so every account (existing and new) behaves the same, with no group treated
--   specially. Users opt in from Settings.
-- * Only changes how the app talks about volume for those muscles: the weekly-sets chart marks them
--   and a volume increase is described relative to maintenance. Load progression is unaffected.
-- * Keys match MUSCLE_LABELS in src/lib/domain/analytics.ts (the list exercises can use).
-- * Schema only. No account's data is changed here.

alter table public.profiles
  add column maintenance_muscles text[] not null default '{}'
    check (maintenance_muscles <@ array[
      'chest','upper_chest','front_delts','side_delts','rear_delts','lats','upper_back','traps',
      'biceps','triceps','forearms','abs','spinal_erectors','glutes','quads','hamstrings','adductors','calves'
    ]::text[]);
