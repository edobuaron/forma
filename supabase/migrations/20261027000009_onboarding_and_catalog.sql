-- New-account setup and the built-in exercise catalog.
--
-- * New accounts are no longer seeded with a program. On first sign-in they choose an empty program
--   or the optional example template (complete_onboarding). ensure_seeded() and the sign-up trigger
--   only create the profile, so nothing can silently recreate the old default.
-- * public.exercise_catalog is a read-only, versioned list generated from src/lib/catalog/catalog.ts.
--   Adding catalog exercises copies them into the user's own library; programs never change.
-- * import_exercises() adds exercises from a CSV preview, skipping names that already exist.
--
-- Existing accounts: profiles are marked as already set up, the 22 originally seeded exercises are
-- linked to their catalog entries (catalog_slug), and assisted exercises get the explicit
-- 'assistance' weight convention. Names, notes, programs and history are not touched.

-- ---------- profiles: onboarding state ----------
alter table public.profiles
  add column onboarded_at timestamptz,
  add column setup_choice text check (setup_choice in ('empty','starter','legacy'));

update public.profiles set onboarded_at = created_at, setup_choice = 'legacy' where onboarded_at is null;

-- ---------- exercises: catalog link, aliases, explicit weight conventions ----------
alter table public.exercises
  add column catalog_slug text,
  add column catalog_version integer,
  add column aliases text[] not null default '{}',
  add column source text not null default 'custom' check (source in ('custom','catalog','import')),
  -- true while increment_kg is a generic default rather than a value the user confirmed for their gym
  add column increment_is_generic boolean not null default false;

alter table public.exercises drop constraint exercises_weight_convention_check;
alter table public.exercises add constraint exercises_weight_convention_check
  check (weight_convention in ('total','per_side','per_dumbbell','stack','added','assistance'));

create unique index exercises_user_catalog_slug on public.exercises(user_id, catalog_slug) where catalog_slug is not null;

-- Assisted exercises record assistance, not added weight. Only the label changes; logged values do not.
update public.exercises set weight_convention = 'assistance' where load_type = 'assisted' and weight_convention <> 'assistance';

-- ---------- name keys for duplicate detection ----------
-- "Pull-Ups", "pull up" and "Pullup" share one key. Mirrors nameKey() in src/lib/catalog/names.ts.
create or replace function public.exercise_name_key(n text) returns text
language sql immutable set search_path = public as $$
  select coalesce(string_agg(
    case when length(w) >= 3 and right(w, 1) = 's' and right(w, 2) <> 'ss' then left(w, -1) else w end,
    '' order by ord), '')
  from regexp_split_to_table(lower(coalesce(n, '')), '[^[:alnum:]]+') with ordinality as t(w, ord)
  where w <> '';
$$;

-- ---------- catalog ----------
create table public.exercise_catalog (
  slug text primary key,
  catalog_version integer not null,
  name text not null unique,
  aliases text[] not null default '{}',
  muscle_group text not null,
  primary_muscles text[] not null,
  secondary_muscles text[] not null default '{}',
  equipment public.equipment_type not null,
  category public.exercise_category not null,
  load_type public.load_type not null,
  weight_convention text not null
    check (weight_convention in ('total','per_side','per_dumbbell','stack','added','assistance')),
  progression public.progression_strategy not null,
  e1rm_eligible boolean not null,
  default_sets smallint not null check (default_sets between 1 and 20),
  default_rep_min smallint not null check (default_rep_min between 1 and 100),
  default_rep_max smallint not null check (default_rep_max between 1 and 100),
  default_rest_s integer not null check (default_rest_s between 0 and 1800),
  increment_kg numeric(6,3) not null check (increment_kg > 0 and increment_kg <= 50),
  instructions text,
  notes text,
  check (default_rep_min <= default_rep_max)
);
alter table public.exercise_catalog enable row level security;
create policy "catalog: read" on public.exercise_catalog for select to authenticated using (true);
revoke insert, update, delete, truncate on public.exercise_catalog from public, anon, authenticated;

-- BEGIN GENERATED CATALOG v1 (src/lib/catalog/catalog.ts; do not edit by hand)
insert into public.exercise_catalog (slug, catalog_version, name, aliases, muscle_group, primary_muscles, secondary_muscles,
  equipment, category, load_type, weight_convention, progression, e1rm_eligible, default_sets, default_rep_min, default_rep_max,
  default_rest_s, increment_kg, instructions, notes)
select slug, catalog_version, name, aliases, muscle_group, primary_muscles, secondary_muscles, equipment::public.equipment_type,
  category::public.exercise_category, load_type::public.load_type, weight_convention, progression::public.progression_strategy,
  e1rm_eligible, default_sets, default_rep_min, default_rep_max, default_rest_s, increment_kg, instructions, notes
from (values
  ('barbell-bench-press', 1, 'Barbell Bench Press', array['bench press','flat bench','bench'], 'chest', array['chest'], array['front_delts','triceps'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 5, 8, 180, 2.5, 'Shoulder blades pinched, feet planted. Lower to mid-chest, press back over the shoulders.', 'Log the total weight, bar included.'),
  ('incline-barbell-bench-press', 1, 'Incline Barbell Bench Press', array['incline bench','incline press'], 'chest', array['upper_chest'], array['front_delts','triceps'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 6, 10, 150, 2.5, 'Bench at 30–45°. Lower to the upper chest with control.', 'Log the total weight, bar included.'),
  ('decline-barbell-bench-press', 1, 'Decline Barbell Bench Press', array['decline bench'], 'chest', array['chest'], array['triceps'], 'barbell', 'compound', 'external', 'total', 'double_progression', false, 3, 6, 10, 150, 2.5, null, 'Log the total weight, bar included.'),
  ('close-grip-bench-press', 1, 'Close-Grip Bench Press', array['cgbp','close grip bench'], 'chest', array['triceps','chest'], array['front_delts'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 6, 10, 150, 2.5, 'Hands about shoulder-width, elbows tucked.', 'Log the total weight, bar included.'),
  ('dumbbell-bench-press', 1, 'Dumbbell Bench Press', array['db bench','flat dumbbell press'], 'chest', array['chest'], array['front_delts','triceps'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell.'),
  ('incline-db-press', 1, 'Incline Dumbbell Press', array['incline db press','incline dumbbell bench'], 'chest', array['upper_chest'], array['front_delts','triceps'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell.'),
  ('dumbbell-fly', 1, 'Dumbbell Fly', array['db fly','flat fly','dumbbell flye'], 'chest', array['chest'], array['front_delts'], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 10, 15, 75, 2, 'Slight bend in the elbows; open to a comfortable stretch.', 'Log the weight of one dumbbell.'),
  ('incline-dumbbell-fly', 1, 'Incline Dumbbell Fly', array['incline db fly','incline flye'], 'chest', array['upper_chest'], array['front_delts'], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 10, 15, 75, 2, null, 'Log the weight of one dumbbell.'),
  ('machine-chest-press', 1, 'Machine Chest Press', array['chest press','seated chest press'], 'chest', array['chest'], array['front_delts','triceps'], 'machine', 'compound', 'external', 'stack', 'double_progression', false, 3, 8, 12, 120, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('incline-machine-chest-press', 1, 'Incline Machine Chest Press', array['incline chest press machine'], 'chest', array['upper_chest'], array['front_delts','triceps'], 'machine', 'compound', 'external', 'stack', 'double_progression', false, 3, 8, 12, 120, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('pec-deck', 1, 'Chest Pec Deck', array['pec deck','machine fly','butterfly'], 'chest', array['chest'], array['front_delts'], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 2, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('incline-smith-press', 1, 'Incline Smith Machine Press', array['incline smith','smith incline bench'], 'chest', array['upper_chest'], array['front_delts','triceps'], 'smith', 'compound', 'external', 'total', 'double_progression', true, 3, 6, 10, 120, 2.5, 'Bench at 30°. Lower to upper chest under control, press without locking out hard.', 'Log the total weight, bar included. Smith bars vary in weight; count the bar the same way every time.'),
  ('smith-bench-press', 1, 'Smith Machine Bench Press', array['smith bench','flat smith press'], 'chest', array['chest'], array['front_delts','triceps'], 'smith', 'compound', 'external', 'total', 'double_progression', false, 3, 6, 10, 120, 2.5, null, 'Log the total weight, bar included. Smith bars vary in weight; count the bar the same way every time.'),
  ('cable-fly', 1, 'Cable Fly', array['cable crossover','standing cable fly','cable flye'], 'chest', array['chest'], array['front_delts'], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, 'Pulleys at shoulder height; bring the hands together in front of the chest.', 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('low-to-high-cable-fly', 1, 'Low-to-High Cable Fly', array['incline cable fly','low cable fly'], 'chest', array['upper_chest'], array['front_delts'], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 12, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('push-up', 1, 'Push-Up', array['pushup','press-up','press up'], 'chest', array['chest'], array['front_delts','triceps','abs'], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 8, 20, 75, 1.25, 'Body in a straight line; chest to just above the floor.', 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('weighted-push-up', 1, 'Weighted Push-Up', array['weighted pushup','plate push-up'], 'chest', array['chest'], array['front_delts','triceps'], 'bodyweight', 'weighted_bodyweight', 'weighted_bodyweight', 'added', 'double_progression', false, 3, 6, 12, 90, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('straight-bar-dip', 1, 'Straight-Bar Dip', array['straight bar dip','bar dip'], 'chest', array['chest','triceps'], array['front_delts'], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 2, 5, 8, 90, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('parallel-bar-dip', 1, 'Parallel-Bar Dip', array['dip','dips','chest dip','triceps dip'], 'chest', array['chest','triceps'], array['front_delts'], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 6, 12, 90, 1.25, 'Lower until the shoulders are just below the elbows, as range allows.', 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('weighted-dip', 1, 'Weighted Dip', array['weighted dips','weighted parallel bar dip'], 'chest', array['chest','triceps'], array['front_delts'], 'bodyweight', 'weighted_bodyweight', 'weighted_bodyweight', 'added', 'double_progression', false, 3, 5, 8, 150, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('assisted-dip-machine', 1, 'Assisted Dip (Machine)', array['assisted dip','gravitron dip'], 'chest', array['chest','triceps'], array['front_delts'], 'machine', 'bodyweight', 'assisted', 'assistance', 'double_progression', false, 3, 6, 12, 90, 5, null, 'Log the assistance (counterweight or band). Less assistance means harder.'),
  ('overhead-press', 1, 'Barbell Overhead Press', array['ohp','military press','standing press','shoulder press barbell'], 'shoulders', array['front_delts'], array['side_delts','triceps','upper_chest'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 5, 8, 150, 2.5, 'Glutes and abs braced; press in a straight line, head through at the top.', 'Log the total weight, bar included.'),
  ('seated-shoulder-press', 1, 'Seated Shoulder Press', array['seated dumbbell shoulder press','db shoulder press','seated db press'], 'shoulders', array['front_delts','side_delts'], array['triceps'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 2, 8, 12, 120, 2, null, 'Log the weight of one dumbbell.'),
  ('standing-dumbbell-shoulder-press', 1, 'Standing Dumbbell Shoulder Press', array['standing db press'], 'shoulders', array['front_delts','side_delts'], array['triceps','abs'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell.'),
  ('arnold-press', 1, 'Arnold Press', array['arnold dumbbell press'], 'shoulders', array['front_delts','side_delts'], array['triceps'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell.'),
  ('machine-shoulder-press', 1, 'Machine Shoulder Press', array['shoulder press machine','seated machine press'], 'shoulders', array['front_delts','side_delts'], array['triceps'], 'machine', 'compound', 'external', 'stack', 'double_progression', false, 3, 8, 12, 120, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('smith-shoulder-press', 1, 'Smith Machine Shoulder Press', array['smith ohp','smith overhead press'], 'shoulders', array['front_delts','side_delts'], array['triceps'], 'smith', 'compound', 'external', 'total', 'double_progression', false, 3, 6, 10, 120, 2.5, null, 'Log the total weight, bar included. Smith bars vary in weight; count the bar the same way every time.'),
  ('dumbbell-lateral-raise', 1, 'Dumbbell Lateral Raise', array['lateral raise','side raise','db lateral'], 'shoulders', array['side_delts'], array[]::text[], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'reps_first', false, 3, 12, 20, 60, 1, 'Raise to about shoulder height, leading with the elbows.', 'Log the weight of one dumbbell.'),
  ('cable-lateral-raise', 1, 'Cable Lateral Raise', array['single-arm cable lateral','cable side raise'], 'shoulders', array['side_delts'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'reps_first', false, 4, 12, 20, 75, 1.25, 'Lead with the elbow, raise to shoulder height, slow eccentric.', 'Log the number on the stack. Machines differ, so compare only on the same machine. Add load only after reps are consistently at the top of the range.'),
  ('machine-lateral-raise', 1, 'Machine Lateral Raise', array['lateral raise machine'], 'shoulders', array['side_delts'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'reps_first', false, 3, 12, 20, 60, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('dumbbell-front-raise', 1, 'Dumbbell Front Raise', array['front raise','db front raise'], 'shoulders', array['front_delts'], array[]::text[], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 10, 15, 60, 1, null, 'Log the weight of one dumbbell.'),
  ('dumbbell-rear-delt-fly', 1, 'Dumbbell Rear-Delt Fly', array['reverse fly','bent-over reverse fly','rear delt raise'], 'shoulders', array['rear_delts'], array['upper_back'], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'reps_first', false, 3, 12, 20, 60, 1, null, 'Log the weight of one dumbbell.'),
  ('cable-rear-delt-fly', 1, 'Cable Rear-Delt Fly', array['cable reverse fly','rear delt cable fly'], 'shoulders', array['rear_delts'], array['upper_back'], 'cable', 'isolation', 'external', 'stack', 'reps_first', false, 2, 12, 20, 60, 1.25, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('reverse-pec-deck', 1, 'Reverse Pec Deck', array['rear delt machine','reverse machine fly'], 'shoulders', array['rear_delts'], array['upper_back'], 'machine', 'isolation', 'external', 'stack', 'reps_first', false, 3, 12, 20, 60, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('face-pull', 1, 'Cable Face Pull', array['face pull','rope face pull'], 'shoulders', array['rear_delts','upper_back'], array['traps'], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 12, 20, 60, 2.5, 'Rope at face height; pull toward the eyes, elbows high.', 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('cable-upright-row', 1, 'Cable Upright Row', array['upright row'], 'shoulders', array['side_delts','traps'], array['biceps'], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('pull-up', 1, 'Pull-Up', array['pullup','pull up','bodyweight pull-up'], 'back', array['lats','upper_back'], array['biceps','rear_delts'], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 5, 10, 120, 1.25, 'Start from a dead hang; chin over the bar without kipping.', 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('weighted-pull-up', 1, 'Weighted Pull-Up', array['weighted pullup'], 'back', array['lats','upper_back'], array['biceps','rear_delts'], 'bodyweight', 'weighted_bodyweight', 'weighted_bodyweight', 'added', 'double_progression', false, 3, 4, 6, 180, 1.25, 'Dead hang start, chin over bar, no kipping.', 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('chin-up', 1, 'Chin-Up', array['chinup','chin up','underhand pull-up'], 'back', array['lats','biceps'], array['upper_back'], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 5, 10, 120, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('weighted-chin-up', 1, 'Weighted Chin-Up', array['weighted chinup'], 'back', array['lats','biceps'], array['upper_back'], 'bodyweight', 'weighted_bodyweight', 'weighted_bodyweight', 'added', 'double_progression', false, 3, 4, 8, 180, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('assisted-pull-up-machine', 1, 'Assisted Pull-Up (Machine)', array['assisted pull-up','gravitron','assisted pullup machine'], 'back', array['lats','upper_back'], array['biceps'], 'machine', 'bodyweight', 'assisted', 'assistance', 'double_progression', false, 3, 6, 12, 90, 5, null, 'Log the assistance (counterweight or band). Less assistance means harder.'),
  ('band-assisted-pull-up', 1, 'Band-Assisted Pull-Up', array['banded pull-up','band pull-up'], 'back', array['lats','upper_back'], array['biceps'], 'bodyweight', 'bodyweight', 'assisted', 'assistance', 'double_progression', false, 3, 5, 10, 90, 5, null, 'Log the assistance (counterweight or band). Less assistance means harder. Band ratings are approximate; use the same band labels each time.'),
  ('lat-pulldown', 1, 'Cable Lat Pulldown', array['lat pulldown','pulldown','wide-grip pulldown','lat pull down'], 'back', array['lats'], array['biceps','upper_back'], 'cable', 'compound', 'external', 'stack', 'double_progression', false, 2, 10, 12, 90, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('close-grip-lat-pulldown', 1, 'Close-Grip Lat Pulldown', array['neutral-grip pulldown','v-bar pulldown','close grip pulldown'], 'back', array['lats'], array['biceps','upper_back'], 'cable', 'compound', 'external', 'stack', 'double_progression', false, 3, 8, 12, 90, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('single-arm-cable-pulldown', 1, 'Single-Arm Cable Pulldown', array['one-arm pulldown','unilateral pulldown'], 'back', array['lats'], array['biceps'], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('straight-arm-pulldown', 1, 'Straight-Arm Pulldown', array['straight arm pushdown','lat prayer','cable pullover'], 'back', array['lats'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('machine-pulldown', 1, 'Machine Pulldown', array['plate-loaded pulldown','pulldown machine'], 'back', array['lats'], array['biceps','upper_back'], 'machine', 'compound', 'external', 'stack', 'double_progression', false, 3, 8, 12, 120, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('barbell-row', 1, 'Barbell Row', array['bent-over row','bb row','bent over barbell row'], 'back', array['upper_back','lats'], array['rear_delts','biceps','spinal_erectors'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 6, 10, 120, 2.5, 'Hinge to ~45°, pull to lower ribs, keep the spine neutral.', 'Log the total weight, bar included.'),
  ('pendlay-row', 1, 'Pendlay Row', array['dead-stop row'], 'back', array['upper_back','lats'], array['rear_delts','spinal_erectors'], 'barbell', 'compound', 'external', 'total', 'double_progression', false, 3, 5, 8, 150, 2.5, 'Each rep starts from the floor with a flat back.', 'Log the total weight, bar included.'),
  ('one-arm-dumbbell-row', 1, 'One-Arm Dumbbell Row', array['dumbbell row','db row','single-arm row'], 'back', array['lats','upper_back'], array['rear_delts','biceps'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell.'),
  ('chest-supported-dumbbell-row', 1, 'Chest-Supported Dumbbell Row', array['incline dumbbell row','seal row dumbbell'], 'back', array['upper_back'], array['lats','rear_delts','biceps'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell.'),
  ('t-bar-row', 1, 'T-Bar Row', array['landmine row','tbar row'], 'back', array['upper_back','lats'], array['rear_delts','biceps'], 'barbell', 'compound', 'external', 'total', 'double_progression', false, 3, 8, 12, 120, 2.5, null, 'Log the total weight, bar included. Count plates only (not the bar) if that is how your gym labels it, and stay consistent.'),
  ('seated-cable-row', 1, 'Seated Cable Row', array['cable row','low row','seated row'], 'back', array['upper_back','lats'], array['biceps','rear_delts'], 'cable', 'compound', 'external', 'stack', 'double_progression', false, 2, 8, 12, 90, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('machine-row', 1, 'Chest-Supported Machine Row', array['machine row','seated machine row'], 'back', array['upper_back','lats'], array['rear_delts','biceps'], 'machine', 'compound', 'external', 'stack', 'double_progression', false, 3, 8, 12, 120, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('inverted-row', 1, 'Inverted Row', array['bodyweight row','australian pull-up','ring row'], 'back', array['upper_back'], array['lats','biceps','rear_delts'], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 8, 15, 90, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('barbell-shrug', 1, 'Barbell Shrug', array['shrug','bb shrug'], 'back', array['traps'], array[]::text[], 'barbell', 'isolation', 'external', 'total', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the total weight, bar included.'),
  ('dumbbell-shrug', 1, 'Dumbbell Shrug', array['db shrug'], 'back', array['traps'], array[]::text[], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 10, 15, 75, 2, null, 'Log the weight of one dumbbell.'),
  ('barbell-curl', 1, 'Barbell Curl', array['bb curl','standing barbell curl','straight bar curl'], 'arms', array['biceps'], array['forearms'], 'barbell', 'isolation', 'external', 'total', 'double_progression', false, 3, 8, 12, 75, 2.5, null, 'Log the total weight, bar included.'),
  ('ez-bar-curl', 1, 'EZ-Bar Curl', array['ez curl','ez bar curl'], 'arms', array['biceps'], array['forearms'], 'barbell', 'isolation', 'external', 'total', 'double_progression', false, 3, 8, 12, 75, 2.5, null, 'Log the total weight, bar included.'),
  ('dumbbell-curl', 1, 'Dumbbell Curl', array['db curl','bicep curl','alternating curl'], 'arms', array['biceps'], array['forearms'], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 75, 1, null, 'Log the weight of one dumbbell.'),
  ('hammer-curl', 1, 'Hammer Curl', array['neutral-grip curl','dumbbell hammer curl'], 'arms', array['biceps','forearms'], array[]::text[], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 75, 1, null, 'Log the weight of one dumbbell.'),
  ('incline-dumbbell-curl', 1, 'Incline Dumbbell Curl', array['incline curl'], 'arms', array['biceps'], array[]::text[], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 75, 1, null, 'Log the weight of one dumbbell.'),
  ('preacher-curl', 1, 'Preacher Curl', array['ez preacher curl','barbell preacher curl'], 'arms', array['biceps'], array['forearms'], 'barbell', 'isolation', 'external', 'total', 'double_progression', false, 2, 8, 12, 75, 1, null, 'Log the total weight, bar included. Set the increment to your smallest available jump.'),
  ('machine-preacher-curl', 1, 'Machine Preacher Curl', array['preacher curl machine','machine curl'], 'arms', array['biceps'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 3, 8, 12, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('cable-curl', 1, 'Cable Curl', array['cable bicep curl','straight-bar cable curl'], 'arms', array['biceps'], array['forearms'], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('bayesian-cable-curl', 1, 'Bayesian Cable Curl', array['bayesian curl','behind-the-body cable curl'], 'arms', array['biceps'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 2, 10, 15, 75, 1.25, 'Face away from the stack, arm behind the torso for a long-length curl.', 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('rope-triceps-pushdown', 1, 'Rope Triceps Pushdown', array['rope pushdown','triceps pushdown','tricep pushdown rope'], 'arms', array['triceps'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('bar-triceps-pushdown', 1, 'Bar Triceps Pushdown', array['straight-bar pushdown','v-bar pushdown'], 'arms', array['triceps'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('overhead-cable-triceps-extension', 1, 'Overhead Cable Triceps Extension', array['overhead cable extension','cable overhead tricep extension'], 'arms', array['triceps'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, 'Keep elbows in; get a deep stretch at the bottom.', 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('ez-bar-skull-crusher', 1, 'EZ-Bar Skull Crusher', array['skull crusher','lying triceps extension','skullcrusher'], 'arms', array['triceps'], array[]::text[], 'barbell', 'isolation', 'external', 'total', 'double_progression', false, 3, 8, 12, 75, 2.5, null, 'Log the total weight, bar included.'),
  ('dumbbell-overhead-triceps-extension', 1, 'Dumbbell Overhead Triceps Extension', array['db overhead extension','french press'], 'arms', array['triceps'], array[]::text[], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 10, 15, 75, 2, null, 'Log the weight of one dumbbell. If you hold one dumbbell with both hands, log that dumbbell''s weight.'),
  ('dumbbell-wrist-curl', 1, 'Dumbbell Wrist Curl', array['wrist curl'], 'arms', array['forearms'], array[]::text[], 'dumbbell', 'isolation', 'external', 'per_dumbbell', 'double_progression', false, 3, 12, 20, 60, 1, null, 'Log the weight of one dumbbell.'),
  ('reverse-ez-bar-curl', 1, 'Reverse-Grip EZ-Bar Curl', array['reverse curl','overhand curl'], 'arms', array['forearms','biceps'], array[]::text[], 'barbell', 'isolation', 'external', 'total', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the total weight, bar included.'),
  ('barbell-back-squat', 1, 'Barbell Back Squat', array['back squat','squat','high-bar squat','low-bar squat'], 'legs', array['quads','glutes'], array['hamstrings','spinal_erectors'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 5, 8, 180, 2.5, 'Brace before each rep; knees track over the toes; depth you can control.', 'Log the total weight, bar included.'),
  ('barbell-front-squat', 1, 'Barbell Front Squat', array['front squat'], 'legs', array['quads'], array['glutes','spinal_erectors'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 5, 8, 180, 2.5, null, 'Log the total weight, bar included.'),
  ('goblet-squat', 1, 'Goblet Squat', array['dumbbell goblet squat'], 'legs', array['quads','glutes'], array[]::text[], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 15, 120, 2, null, 'Log the weight of one dumbbell. You hold one dumbbell, so its weight is the total.'),
  ('hack-squat', 1, 'Hack Squat (Machine)', array['hack squat','machine hack squat'], 'legs', array['quads'], array['glutes'], 'machine', 'compound', 'external', 'total', 'double_progression', false, 3, 6, 12, 150, 5, null, 'Log the total weight, bar included. Count plates only, not the sled, and stay consistent.'),
  ('smith-squat', 1, 'Smith Machine Squat', array['smith squat'], 'legs', array['quads','glutes'], array['hamstrings'], 'smith', 'compound', 'external', 'total', 'double_progression', false, 3, 6, 10, 150, 2.5, null, 'Log the total weight, bar included. Smith bars vary in weight; count the bar the same way every time.'),
  ('leg-press', 1, 'Leg Press', array['45-degree leg press','seated leg press'], 'legs', array['quads','glutes'], array['hamstrings'], 'machine', 'compound', 'external', 'stack', 'double_progression', false, 2, 6, 10, 120, 5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine. On a plate-loaded press, count plates only, not the sled.'),
  ('belt-squat', 1, 'Belt Squat', array['belt squat machine'], 'legs', array['quads','glutes'], array[]::text[], 'machine', 'compound', 'external', 'stack', 'double_progression', false, 3, 8, 12, 120, 5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('bulgarian-split-squat', 1, 'Bulgarian Split Squat', array['rear-foot-elevated split squat','bss','rfess'], 'legs', array['quads','glutes'], array['hamstrings'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, 'Rear foot on a bench; front shin roughly vertical at the bottom. Reps are per leg.', 'Log the weight of one dumbbell.'),
  ('dumbbell-walking-lunge', 1, 'Dumbbell Walking Lunge', array['walking lunge','lunges'], 'legs', array['quads','glutes'], array['hamstrings'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell. Count reps per leg.'),
  ('dumbbell-reverse-lunge', 1, 'Dumbbell Reverse Lunge', array['reverse lunge'], 'legs', array['quads','glutes'], array[]::text[], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell. Count reps per leg.'),
  ('dumbbell-step-up', 1, 'Dumbbell Step-Up', array['step up','box step-up'], 'legs', array['quads','glutes'], array[]::text[], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell. Count reps per leg.'),
  ('leg-extension', 1, 'Leg Extension', array['quad extension','knee extension'], 'legs', array['quads'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 2, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('seated-leg-curl', 1, 'Seated Leg Curl', array['seated hamstring curl'], 'legs', array['hamstrings'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 2, 8, 12, 90, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('lying-leg-curl', 1, 'Lying Leg Curl', array['prone leg curl','lying hamstring curl'], 'legs', array['hamstrings'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 3, 8, 12, 90, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('standing-calf-raise', 1, 'Standing Calf Raise', array['calf raise','standing calf machine'], 'legs', array['calves'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 2, 10, 15, 75, 5, 'Full stretch at the bottom, pause at the top.', 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('seated-calf-raise', 1, 'Seated Calf Raise', array['seated calf machine'], 'legs', array['calves'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('leg-press-calf-raise', 1, 'Leg-Press Calf Raise', array['calf press'], 'legs', array['calves'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('hip-adduction-machine', 1, 'Hip Adduction (Machine)', array['adductor machine','inner thigh machine','hip adduction'], 'legs', array['adductors'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('hip-abduction-machine', 1, 'Hip Abduction (Machine)', array['abductor machine','outer thigh machine','hip abduction'], 'legs', array['glutes'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 20, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('barbell-deadlift', 1, 'Barbell Deadlift', array['deadlift','conventional deadlift'], 'glutes_hinge', array['hamstrings','glutes','spinal_erectors'], array['upper_back','forearms','quads'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 3, 6, 180, 2.5, 'Bar over mid-foot, brace, push the floor away; keep the bar close.', 'Log the total weight, bar included.'),
  ('sumo-deadlift', 1, 'Sumo Deadlift', array['sumo'], 'glutes_hinge', array['glutes','quads','adductors'], array['hamstrings','spinal_erectors'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 3, 6, 180, 2.5, null, 'Log the total weight, bar included.'),
  ('trap-bar-deadlift', 1, 'Trap-Bar Deadlift', array['hex bar deadlift','trap bar deadlift'], 'glutes_hinge', array['quads','glutes','hamstrings'], array['spinal_erectors','traps'], 'barbell', 'compound', 'external', 'total', 'double_progression', true, 3, 4, 8, 180, 2.5, null, 'Log the total weight, bar included. Trap bars vary in weight; count the bar the same way every time.'),
  ('romanian-deadlift', 1, 'Romanian Deadlift', array['rdl','barbell rdl','stiff-leg deadlift'], 'glutes_hinge', array['hamstrings','glutes'], array['spinal_erectors'], 'barbell', 'compound', 'external', 'total', 'double_progression', false, 3, 6, 10, 150, 2.5, 'Soft knees, push the hips back until the hamstrings limit range.', 'Log the total weight, bar included.'),
  ('dumbbell-romanian-deadlift', 1, 'Dumbbell Romanian Deadlift', array['db rdl','dumbbell rdl'], 'glutes_hinge', array['hamstrings','glutes'], array['spinal_erectors'], 'dumbbell', 'compound', 'external', 'per_dumbbell', 'double_progression', false, 3, 8, 12, 120, 2, null, 'Log the weight of one dumbbell.'),
  ('good-morning', 1, 'Barbell Good Morning', array['good morning'], 'glutes_hinge', array['hamstrings','spinal_erectors'], array['glutes'], 'barbell', 'compound', 'external', 'total', 'double_progression', false, 3, 8, 12, 120, 2.5, null, 'Log the total weight, bar included.'),
  ('barbell-hip-thrust', 1, 'Barbell Hip Thrust', array['hip thrust','glute bridge barbell'], 'glutes_hinge', array['glutes'], array['hamstrings'], 'barbell', 'compound', 'external', 'total', 'double_progression', false, 3, 8, 12, 120, 2.5, 'Upper back on a bench; finish with ribs down and glutes squeezed.', 'Log the total weight, bar included.'),
  ('machine-hip-thrust', 1, 'Machine Hip Thrust', array['hip thrust machine','glute drive'], 'glutes_hinge', array['glutes'], array['hamstrings'], 'machine', 'compound', 'external', 'stack', 'double_progression', false, 3, 8, 12, 120, 5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('cable-pull-through', 1, 'Cable Pull-Through', array['pull through','cable hip hinge'], 'glutes_hinge', array['glutes','hamstrings'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('cable-glute-kickback', 1, 'Cable Glute Kickback', array['glute kickback','cable kickback'], 'glutes_hinge', array['glutes'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 60, 1.25, null, 'Log the number on the stack. Machines differ, so compare only on the same machine. Count reps per leg.'),
  ('back-extension', 1, '45° Back Extension', array['hyperextension','back extension','roman chair extension'], 'glutes_hinge', array['spinal_erectors','glutes'], array['hamstrings'], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 10, 15, 75, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only. If you hold a plate, switch to the weighted version so loads compare correctly.'),
  ('weighted-back-extension', 1, 'Weighted 45° Back Extension', array['weighted hyperextension'], 'glutes_hinge', array['spinal_erectors','glutes'], array['hamstrings'], 'bodyweight', 'weighted_bodyweight', 'weighted_bodyweight', 'added', 'double_progression', false, 3, 8, 15, 90, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('lumbar-extension', 1, 'Lumbar Extension Machine', array['back extension machine','lower back machine'], 'glutes_hinge', array['spinal_erectors'], array['glutes'], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 90, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('cable-crunch', 1, 'Cable Crunch', array['kneeling cable crunch','rope crunch'], 'core', array['abs'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('machine-crunch', 1, 'Machine Crunch', array['ab crunch machine'], 'core', array['abs'], array[]::text[], 'machine', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 75, 2.5, null, 'Log the number on the stack. Machines differ, so compare only on the same machine.'),
  ('hanging-leg-raise', 1, 'Hanging Leg Raise', array['leg raise','hanging straight leg raise'], 'core', array['abs'], array[]::text[], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 8, 15, 75, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('hanging-knee-raise', 1, 'Hanging Knee Raise', array['knee raise','captain''s chair knee raise'], 'core', array['abs'], array[]::text[], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 10, 15, 75, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('ab-wheel-rollout', 1, 'Ab Wheel Rollout', array['ab roller','rollout'], 'core', array['abs'], array[]::text[], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 6, 12, 75, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('decline-sit-up', 1, 'Decline Sit-Up', array['decline situp','decline crunch'], 'core', array['abs'], array[]::text[], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 10, 20, 60, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('weighted-decline-sit-up', 1, 'Weighted Decline Sit-Up', array['weighted situp'], 'core', array['abs'], array[]::text[], 'bodyweight', 'weighted_bodyweight', 'weighted_bodyweight', 'added', 'double_progression', false, 3, 8, 15, 75, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('pallof-press', 1, 'Cable Pallof Press', array['pallof press','anti-rotation press'], 'core', array['abs'], array[]::text[], 'cable', 'isolation', 'external', 'stack', 'double_progression', false, 3, 10, 15, 60, 1.25, null, 'Log the number on the stack. Machines differ, so compare only on the same machine. Count reps per side.'),
  ('explosive-high-pull-up', 1, 'Explosive High Pull-Up', array['high pull-up','chest-to-bar pull-up'], 'skill', array['lats','upper_back'], array['biceps'], 'bodyweight', 'skill', 'bodyweight', 'added', 'skill', false, 3, 2, 3, 120, 1.25, 'Pull explosively toward the lower chest / belly button, slight hollow-to-arch swing.', 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only. Skill work: quality, speed and pulling height matter more than reps. Stop before reps slow down.'),
  ('assisted-muscle-up-transition', 1, 'Assisted Muscle-Up Transition', array['muscle-up transition','banded muscle-up transition'], 'skill', array['lats','chest'], array['triceps'], 'bodyweight', 'skill', 'assisted', 'assistance', 'skill', false, 2, 2, 3, 90, 1.25, 'Fast turnover of the wrists, lean the chest over the bar.', 'Log the assistance (counterweight or band). Less assistance means harder. Progress by reducing assistance once transitions are smooth.'),
  ('bar-muscle-up', 1, 'Bar Muscle-Up', array['muscle-up','muscle up'], 'skill', array['lats','chest'], array['triceps','upper_back'], 'bodyweight', 'skill', 'bodyweight', 'added', 'skill', false, 3, 1, 5, 150, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('negative-pull-up', 1, 'Negative Pull-Up', array['eccentric pull-up','pull-up negative'], 'skill', array['lats','upper_back'], array['biceps'], 'bodyweight', 'skill', 'bodyweight', 'added', 'skill', false, 3, 3, 6, 120, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only. Count controlled lowerings as reps.'),
  ('scapular-pull-up', 1, 'Scapular Pull-Up', array['scap pull-up','scap pulls'], 'skill', array['upper_back','lats'], array[]::text[], 'bodyweight', 'skill', 'bodyweight', 'added', 'skill', false, 3, 6, 12, 60, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.'),
  ('pike-push-up', 1, 'Pike Push-Up', array['pike pushup'], 'skill', array['front_delts'], array['triceps','upper_chest'], 'bodyweight', 'bodyweight', 'bodyweight', 'added', 'bodyweight_reps', false, 3, 6, 15, 90, 1.25, null, 'Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.')
) as v(slug, catalog_version, name, aliases, muscle_group, primary_muscles, secondary_muscles, equipment, category, load_type,
  weight_convention, progression, e1rm_eligible, default_sets, default_rep_min, default_rep_max, default_rest_s, increment_kg,
  instructions, notes)
on conflict (slug) do update set
  catalog_version = excluded.catalog_version, name = excluded.name, aliases = excluded.aliases,
  muscle_group = excluded.muscle_group, primary_muscles = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles, equipment = excluded.equipment, category = excluded.category,
  load_type = excluded.load_type, weight_convention = excluded.weight_convention, progression = excluded.progression,
  e1rm_eligible = excluded.e1rm_eligible, default_sets = excluded.default_sets,
  default_rep_min = excluded.default_rep_min, default_rep_max = excluded.default_rep_max,
  default_rest_s = excluded.default_rest_s, increment_kg = excluded.increment_kg,
  instructions = excluded.instructions, notes = excluded.notes;
-- END GENERATED CATALOG

-- Link the originally seeded exercises to their catalog entries (same slugs). Only the link is set.
update public.exercises e set catalog_slug = c.slug, catalog_version = c.catalog_version
from public.exercise_catalog c
where e.slug = c.slug and e.catalog_slug is null;

-- ---------- copying catalog entries into a library ----------
-- Inserts one catalog entry for uid and returns the new id, or returns the existing exercise linked
-- to that entry. Never modifies an existing exercise.
create or replace function public.copy_catalog_exercise(uid uuid, p_slug text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c exercise_catalog%rowtype;
  eid uuid;
  s text;
begin
  select id into eid from exercises where user_id = uid and catalog_slug = p_slug;
  if eid is not null then return eid; end if;
  select * into c from exercise_catalog where slug = p_slug;
  if not found then raise exception 'unknown_catalog_slug' using detail = p_slug; end if;
  s := c.slug;
  if exists (select 1 from exercises where user_id = uid and slug = s) then
    s := c.slug || '-' || substr(md5(random()::text), 1, 4);
  end if;
  insert into exercises (user_id, slug, name, aliases, primary_muscles, secondary_muscles, equipment, category, load_type,
                         default_sets, default_rep_min, default_rep_max, default_rest_s, increment_kg, weight_convention,
                         progression, e1rm_eligible, notes, instructions, catalog_slug, catalog_version, source, increment_is_generic)
  values (uid, s, c.name, c.aliases, c.primary_muscles, c.secondary_muscles, c.equipment, c.category, c.load_type,
          c.default_sets, c.default_rep_min, c.default_rep_max, c.default_rest_s, c.increment_kg, c.weight_convention,
          c.progression, c.e1rm_eligible, c.notes, c.instructions, c.slug, c.catalog_version, 'catalog', true)
  returning id into eid;
  return eid;
end $$;

-- Add catalog entries to the caller's library. Skips entries already linked, and entries whose name or
-- alias matches an exercise the user already has (including archived ones), reporting why.
-- Programs and templates are never touched.
create or replace function public.add_catalog_exercises(p_slugs text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c exercise_catalog%rowtype;
  existing exercises%rowtype;
  added jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if coalesce(array_length(p_slugs, 1), 0) > 200 then raise exception 'too_many'; end if;
  for c in select * from exercise_catalog where slug = any(p_slugs) order by name loop
    select * into existing from exercises where user_id = uid and catalog_slug = c.slug;
    if not found then
      select * into existing from exercises e where e.user_id = uid and exercise_name_key(e.name) in (
        select exercise_name_key(x) from unnest(array[c.name] || c.aliases) x)
      order by e.archived_at nulls first limit 1;
    end if;
    if found then
      skipped := skipped || jsonb_build_object('slug', c.slug, 'name', c.name, 'existing_id', existing.id,
        'existing_name', existing.name, 'archived', existing.archived_at is not null);
    else
      added := added || jsonb_build_object('slug', c.slug, 'name', c.name, 'id', public.copy_catalog_exercise(uid, c.slug));
    end if;
  end loop;
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

-- ---------- importing exercises ----------
-- Rows are validated in the client preview; constraints validate them again here. A row whose name
-- matches an existing exercise (or an earlier row) is skipped, never merged or overwritten.
create or replace function public.import_exercises(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb;
  k text;
  dup exercises%rowtype;
  eid uuid;
  added jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid_rows'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'too_many'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    k := exercise_name_key(r->>'name');
    if k = '' then raise exception 'invalid_name'; end if;
    select * into dup from exercises where user_id = uid and exercise_name_key(name) = k limit 1;
    if found then
      skipped := skipped || jsonb_build_object('name', r->>'name', 'existing_id', dup.id, 'existing_name', dup.name);
      continue;
    end if;
    insert into exercises (user_id, slug, name, aliases, primary_muscles, secondary_muscles, equipment, category, load_type,
                           default_sets, default_rep_min, default_rep_max, default_rest_s, increment_kg, weight_convention,
                           progression, e1rm_eligible, notes, instructions, source, increment_is_generic)
    values (uid,
      'import-' || left(k, 50) || '-' || substr(md5(random()::text), 1, 6),
      btrim(r->>'name'),
      coalesce(array(select jsonb_array_elements_text(r->'aliases')), '{}'),
      coalesce(array(select jsonb_array_elements_text(r->'primary_muscles')), '{}'),
      coalesce(array(select jsonb_array_elements_text(r->'secondary_muscles')), '{}'),
      (r->>'equipment')::equipment_type,
      (r->>'category')::exercise_category,
      (r->>'load_type')::load_type,
      (r->>'default_sets')::smallint, (r->>'default_rep_min')::smallint, (r->>'default_rep_max')::smallint,
      (r->>'default_rest_s')::integer, (r->>'increment_kg')::numeric,
      r->>'weight_convention',
      (r->>'progression')::progression_strategy,
      coalesce((r->>'e1rm_eligible')::boolean, false)
        and r->>'load_type' = 'external' and r->>'category' = 'compound',
      nullif(left(r->>'notes', 1000), ''),
      nullif(left(r->>'instructions', 1000), ''),
      'import',
      coalesce((r->>'increment_is_generic')::boolean, true))
    returning id into eid;
    added := added || jsonb_build_object('name', r->>'name', 'id', eid);
  end loop;
  return jsonb_build_object('added', added, 'skipped', skipped);
end $$;

-- ---------- optional example template ----------
-- A generic 4-day split, offered as an optional starting point at setup. Not personalised advice.
-- Exercises come from the catalog (neutral notes). Never runs on its own; only complete_onboarding calls it.
create or replace function public.seed_starter_program(uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  prog uuid;
  tpl uuid;
  d record;
begin
  insert into programs (user_id, name, description, is_active)
  values (uid, 'Example 4-day template',
          'An optional, generic upper/lower-style split to start from. It is not personalised advice: change the exercises, sets and rep ranges to suit you. Loads are never preset.',
          not exists (select 1 from programs where user_id = uid and is_active and archived_at is null))
  returning id into prog;

  for d in select * from (values
    (1, 'Push', 'A few lighter warm-up sets of the first press.'),
    (2, 'Pull', 'A few easy pull-ups or light rows.'),
    (3, 'Lower', 'A few lighter sets on the leg press.'),
    (4, 'Upper + Skill', 'Scapular pulls and easy pull-ups before the skill work.')
  ) as t(pos, name, warm)
  loop
    insert into workout_templates (user_id, program_id, name, position, warmup_notes)
    values (uid, prog, d.name, d.pos, d.warm) returning id into tpl;

    insert into template_exercises (user_id, template_id, exercise_id, position, sets, rep_min, rep_max, rest_s, optional, notes)
    select uid, tpl, public.copy_catalog_exercise(uid, x.slug), x.ord, x.sets, x.rmin, x.rmax, x.rest, x.opt, x.note
    from (values
      ('Push',1,'incline-smith-press',3,6,10,120,false,null),
      ('Push',2,'seated-shoulder-press',2,8,12,120,false,null),
      ('Push',3,'cable-lateral-raise',4,12,20,75,false,null),
      ('Push',4,'pec-deck',2,10,15,75,false,null),
      ('Push',5,'overhead-cable-triceps-extension',3,10,15,75,false,null),
      ('Pull',1,'weighted-pull-up',3,4,6,180,false,null),
      ('Pull',2,'barbell-row',3,6,10,120,false,null),
      ('Pull',3,'lat-pulldown',2,10,12,90,false,null),
      ('Pull',4,'cable-rear-delt-fly',2,12,20,60,false,null),
      ('Pull',5,'preacher-curl',2,8,12,75,false,null),
      ('Pull',6,'bayesian-cable-curl',2,10,15,75,false,null),
      ('Pull',7,'cable-lateral-raise',2,12,20,60,false,null),
      ('Lower',1,'leg-press',2,6,10,120,false,null),
      ('Lower',2,'seated-leg-curl',2,8,12,90,false,null),
      ('Lower',3,'leg-extension',1,10,15,75,false,null),
      ('Lower',4,'lumbar-extension',3,10,15,90,false,null),
      ('Lower',5,'standing-calf-raise',2,10,15,75,true,'Optional.'),
      ('Lower',6,'cable-crunch',3,10,15,75,false,null),
      ('Upper + Skill',1,'explosive-high-pull-up',3,2,3,120,false,null),
      ('Upper + Skill',2,'assisted-muscle-up-transition',2,2,3,90,false,null),
      ('Upper + Skill',3,'straight-bar-dip',2,5,8,90,false,null),
      ('Upper + Skill',4,'incline-db-press',3,8,12,120,false,null),
      ('Upper + Skill',5,'seated-cable-row',2,8,12,90,false,null),
      ('Upper + Skill',6,'lat-pulldown',2,10,12,90,false,null),
      ('Upper + Skill',7,'cable-lateral-raise',4,12,20,60,false,null),
      ('Upper + Skill',8,'cable-rear-delt-fly',2,12,20,60,false,null),
      ('Upper + Skill',9,'bayesian-cable-curl',1,10,15,60,false,null)
    ) as x(tname, ord, slug, sets, rmin, rmax, rest, opt, note)
    where x.tname = d.name;
  end loop;

  insert into program_versions (user_id, program_id, version, snapshot, note)
  values (uid, prog, 1, public.program_snapshot(prog), 'Example template');
  return prog;
end $$;

-- ---------- setup ----------
-- First-run setup. Idempotent: the profile row is locked, and once setup is recorded every later call
-- (a retry, a second tab, a double tap) returns without creating anything.
create or replace function public.complete_onboarding(p_choice text, p_display_name text default null, p_unit text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof profiles%rowtype;
  prog uuid;
  nm text := nullif(btrim(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', '', 'g')), '');
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_choice is null or p_choice not in ('empty','starter') then raise exception 'invalid_choice'; end if;
  if p_unit is not null and p_unit not in ('kg','lb') then raise exception 'invalid_unit'; end if;
  if char_length(nm) > 60 then raise exception 'name_too_long'; end if;

  insert into profiles (id) values (uid) on conflict do nothing;
  select * into prof from profiles where id = uid for update;
  if prof.onboarded_at is not null then
    return jsonb_build_object('status', 'already_set_up', 'choice', prof.setup_choice);
  end if;

  -- Never add a second program for someone who already has one.
  if not exists (select 1 from programs where user_id = uid) then
    if p_choice = 'starter' then
      prog := public.seed_starter_program(uid);
    else
      insert into programs (user_id, name, is_active) values (uid, 'My program', true) returning id into prog;
      insert into program_versions (user_id, program_id, version, snapshot, note)
      values (uid, prog, 1, public.program_snapshot(prog), 'Empty program');
    end if;
  end if;

  update profiles set
    display_name = coalesce(nm, display_name),
    unit = coalesce(p_unit::weight_unit, unit),
    onboarded_at = now(),
    setup_choice = p_choice
  where id = uid;
  return jsonb_build_object('status', 'set_up', 'choice', p_choice, 'program_id', prog);
end $$;

-- Only ever creates the profile now. Accounts that already have programs are marked as set up, so the
-- setup screen never offers to seed them. No program is ever created here.
create or replace function public.ensure_seeded() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into profiles (id) values (auth.uid()) on conflict do nothing;
  update profiles set onboarded_at = now(), setup_choice = 'legacy'
  where id = auth.uid() and onboarded_at is null
    and exists (select 1 from programs where user_id = auth.uid());
end $$;

-- Sign-up creates the profile only; the program is chosen at setup.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, left(nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name',
    initcap(split_part(split_part(new.email, '@', 1), '.', 1)))), ''), 60))
  on conflict do nothing;
  return new;
end $$;

-- The old default seeder is no longer reachable from any path.
drop function public.seed_default_program(uuid);

revoke execute on function public.copy_catalog_exercise(uuid, text) from public, anon, authenticated;
revoke execute on function public.seed_starter_program(uuid) from public, anon, authenticated;
revoke execute on function public.add_catalog_exercises(text[]) from public, anon;
revoke execute on function public.import_exercises(jsonb) from public, anon;
revoke execute on function public.complete_onboarding(text, text, text) from public, anon;
grant execute on function public.add_catalog_exercises(text[]) to authenticated;
grant execute on function public.import_exercises(jsonb) to authenticated;
grant execute on function public.complete_onboarding(text, text, text) to authenticated;
grant execute on function public.exercise_name_key(text) to authenticated;
