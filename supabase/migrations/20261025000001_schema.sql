-- Forma core schema. All weights are stored in kilograms.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type public.equipment_type as enum
  ('barbell','dumbbell','cable','machine','smith','bodyweight','other');
create type public.exercise_category as enum
  ('compound','isolation','bodyweight','weighted_bodyweight','skill');
create type public.load_type as enum
  ('external','bodyweight','weighted_bodyweight','assisted');
create type public.progression_strategy as enum
  ('double_progression','reps_first','bodyweight_reps','skill','none');
create type public.session_status as enum ('in_progress','completed','discarded');
create type public.set_kind as enum ('warmup','working');
create type public.weight_unit as enum ('kg','lb');

-- ---------- helpers ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  unit public.weight_unit not null default 'kg',
  default_rest_s integer not null default 90 check (default_rest_s between 0 and 1800),
  auto_rest_timer boolean not null default true,
  rest_sound boolean not null default false,
  bodyweight_kg numeric(5,2) check (bodyweight_kg is null or bodyweight_kg between 20 and 400),
  progression_conservative boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- exercises ----------
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  name text not null check (char_length(name) between 1 and 120),
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  equipment public.equipment_type not null default 'other',
  category public.exercise_category not null default 'isolation',
  load_type public.load_type not null default 'external',
  default_sets smallint not null default 3 check (default_sets between 1 and 20),
  default_rep_min smallint not null default 8 check (default_rep_min between 1 and 100),
  default_rep_max smallint not null default 12 check (default_rep_max between 1 and 100),
  default_rest_s integer not null default 90 check (default_rest_s between 0 and 1800),
  increment_kg numeric(6,3) not null default 2.5 check (increment_kg > 0 and increment_kg <= 50),
  min_load_kg numeric(6,2) not null default 0 check (min_load_kg >= 0),
  available_loads_kg numeric(6,2)[],
  weight_convention text not null default 'total'
    check (weight_convention in ('total','per_side','per_dumbbell','stack','added')),
  progression public.progression_strategy not null default 'double_progression',
  e1rm_eligible boolean not null default false,
  notes text,
  instructions text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exercises_rep_range check (default_rep_min <= default_rep_max),
  unique (user_id, slug)
);
create index exercises_user_idx on public.exercises(user_id) where archived_at is null;
create trigger exercises_touch before update on public.exercises
  for each row execute function public.touch_updated_at();

-- ---------- programs & templates ----------
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text,
  is_active boolean not null default false,
  version integer not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index programs_one_active on public.programs(user_id) where is_active and archived_at is null;
create trigger programs_touch before update on public.programs
  for each row execute function public.touch_updated_at();

create table public.program_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  note text,
  created_at timestamptz not null default now(),
  unique (program_id, version)
);

create table public.workout_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  program_id uuid not null references public.programs(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  day_of_week smallint check (day_of_week between 0 and 6), -- 0 = Sunday
  position integer not null default 0,
  notes text,
  warmup_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workout_templates_program_idx on public.workout_templates(program_id, position);
create trigger workout_templates_touch before update on public.workout_templates
  for each row execute function public.touch_updated_at();

create table public.template_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid not null references public.workout_templates(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  position integer not null default 0,
  sets smallint not null check (sets between 1 and 20),
  rep_min smallint not null check (rep_min between 1 and 100),
  rep_max smallint not null check (rep_max between 1 and 100),
  rest_s integer not null default 90 check (rest_s between 0 and 1800),
  target_rir numeric(3,1) check (target_rir is null or target_rir between 0 and 10),
  optional boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_exercises_rep_range check (rep_min <= rep_max)
);
create index template_exercises_template_idx on public.template_exercises(template_id, position);
create trigger template_exercises_touch before update on public.template_exercises
  for each row execute function public.touch_updated_at();

-- ---------- sessions (actual performed workouts) ----------
create table public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  template_id uuid references public.workout_templates(id) on delete set null,
  program_id uuid references public.programs(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120),
  status public.session_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  bodyweight_kg numeric(5,2) check (bodyweight_kg is null or bodyweight_kg between 20 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_end_after_start check (ended_at is null or ended_at >= started_at)
);
create index workout_sessions_user_started_idx on public.workout_sessions(user_id, started_at desc);
create unique index workout_sessions_one_in_progress
  on public.workout_sessions(user_id) where status = 'in_progress';
create trigger workout_sessions_touch before update on public.workout_sessions
  for each row execute function public.touch_updated_at();

create table public.session_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  template_exercise_id uuid references public.template_exercises(id) on delete set null,
  substituted_for uuid references public.exercises(id) on delete set null,
  position integer not null default 0,
  -- snapshot of the prescription at the time of the workout: {sets, rep_min, rep_max, rest_s, target_rir}
  prescribed jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index session_exercises_session_idx on public.session_exercises(session_id, position);
create index session_exercises_exercise_idx on public.session_exercises(user_id, exercise_id);
create trigger session_exercises_touch before update on public.session_exercises
  for each row execute function public.touch_updated_at();

create table public.set_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  session_exercise_id uuid not null references public.session_exercises(id) on delete cascade,
  position integer not null default 0,
  kind public.set_kind not null default 'working',
  -- external load. For weighted pull-ups/dips this is the ADDED weight; bodyweight is on the session.
  weight_kg numeric(6,2) check (weight_kg is null or weight_kg between 0 and 1000),
  assistance_kg numeric(6,2) check (assistance_kg is null or assistance_kg between 0 and 300),
  reps smallint check (reps is null or reps between 0 and 200),
  rir numeric(3,1) check (rir is null or rir between 0 and 10),
  completed boolean not null default false,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index set_logs_session_exercise_idx on public.set_logs(session_exercise_id, position);
create index set_logs_user_idx on public.set_logs(user_id, completed_at desc);
create trigger set_logs_touch before update on public.set_logs
  for each row execute function public.touch_updated_at();

-- ---------- body measurements ----------
create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  measured_on date not null default current_date,
  bodyweight_kg numeric(5,2) check (bodyweight_kg is null or bodyweight_kg between 20 and 400),
  waist_cm numeric(5,1) check (waist_cm is null or waist_cm between 20 and 300),
  chest_cm numeric(5,1) check (chest_cm is null or chest_cm between 20 and 300),
  shoulders_cm numeric(5,1) check (shoulders_cm is null or shoulders_cm between 20 and 300),
  arms_cm numeric(5,1) check (arms_cm is null or arms_cm between 10 and 150),
  thighs_cm numeric(5,1) check (thighs_cm is null or thighs_cm between 10 and 200),
  hips_cm numeric(5,1) check (hips_cm is null or hips_cm between 20 and 300),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, measured_on)
);
create trigger body_measurements_touch before update on public.body_measurements
  for each row execute function public.touch_updated_at();

-- ---------- dismissed recommendations ----------
create table public.dismissed_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rule_key text not null,           -- e.g. "progression:<exercise_id>"
  evidence_session_id uuid,         -- dismissal is valid until newer evidence exists
  created_at timestamptz not null default now(),
  unique (user_id, rule_key, evidence_session_id)
);

-- ---------- ownership integrity: children must belong to the same user as parents ----------
create or replace function public.assert_same_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if tg_table_name = 'template_exercises' then
    select user_id into owner from workout_templates where id = new.template_id;
    if owner is distinct from new.user_id then raise exception 'template owner mismatch'; end if;
    select user_id into owner from exercises where id = new.exercise_id;
    if owner is distinct from new.user_id then raise exception 'exercise owner mismatch'; end if;
  elsif tg_table_name = 'workout_templates' then
    select user_id into owner from programs where id = new.program_id;
    if owner is distinct from new.user_id then raise exception 'program owner mismatch'; end if;
  elsif tg_table_name = 'session_exercises' then
    select user_id into owner from workout_sessions where id = new.session_id;
    if owner is distinct from new.user_id then raise exception 'session owner mismatch'; end if;
    select user_id into owner from exercises where id = new.exercise_id;
    if owner is distinct from new.user_id then raise exception 'exercise owner mismatch'; end if;
  elsif tg_table_name = 'set_logs' then
    select user_id into owner from session_exercises
      where id = new.session_exercise_id and session_id = new.session_id;
    if owner is distinct from new.user_id then raise exception 'session exercise owner mismatch'; end if;
  end if;
  return new;
end $$;

create trigger workout_templates_owner before insert or update on public.workout_templates
  for each row execute function public.assert_same_owner();
create trigger template_exercises_owner before insert or update on public.template_exercises
  for each row execute function public.assert_same_owner();
create trigger session_exercises_owner before insert or update on public.session_exercises
  for each row execute function public.assert_same_owner();
create trigger set_logs_owner before insert or update on public.set_logs
  for each row execute function public.assert_same_owner();

-- ---------- row level security ----------
do $$
declare t text;
begin
  foreach t in array array['exercises','programs','program_versions','workout_templates',
    'template_exercises','workout_sessions','session_exercises','set_logs',
    'body_measurements','dismissed_recommendations']
  loop
    execute format('alter table public.%I alter column user_id set default auth.uid()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows: select" on public.%I for select using (user_id = auth.uid())', t);
    execute format('create policy "own rows: insert" on public.%I for insert with check (user_id = auth.uid())', t);
    execute format('create policy "own rows: update" on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "own rows: delete" on public.%I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;

alter table public.profiles enable row level security;
create policy "own profile: select" on public.profiles for select using (id = auth.uid());
create policy "own profile: update" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "own profile: insert" on public.profiles for insert with check (id = auth.uid());
