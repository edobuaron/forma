-- Default exercise library + Edoardo's 4-day program, seeded for each new user.

create or replace function public.seed_default_program(uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  prog uuid;
  tpl uuid;
  d record;
  pos int;
begin
  -- Exercise library ------------------------------------------------------
  insert into exercises (user_id, slug, name, primary_muscles, secondary_muscles, equipment, category,
                         load_type, default_sets, default_rep_min, default_rep_max, default_rest_s,
                         increment_kg, weight_convention, progression, e1rm_eligible, notes, instructions)
  select uid, v.* from (values
    ('incline-smith-press','Incline Smith Machine Press', array['upper_chest'], array['front_delts','triceps'],
      'smith'::equipment_type,'compound'::exercise_category,'external'::load_type,3,6,10,120,2.5,'total',
      'double_progression'::progression_strategy,true,null,'Bench at 30°. Lower to upper chest under control, press without locking out hard.'),
    ('seated-shoulder-press','Seated Shoulder Press', array['front_delts','side_delts'], array['triceps'],
      'dumbbell','compound','external',2,8,12,120,2,'per_dumbbell','double_progression',false,null,null),
    ('cable-lateral-raise','Cable Lateral Raise', array['side_delts'], array[]::text[],
      'cable','isolation','external',4,12,20,75,1.25,'stack','reps_first',false,
      'Prioritise reps and clean form; add load only after reps are consistently at the top of the range.',
      'Lead with the elbow, raise to shoulder height, slow eccentric.'),
    ('pec-deck','Chest Pec Deck', array['chest'], array['front_delts'],
      'machine','isolation','external',2,10,15,75,2.5,'stack','double_progression',false,null,null),
    ('overhead-cable-triceps-extension','Overhead Cable Triceps Extension', array['triceps'], array[]::text[],
      'cable','isolation','external',3,10,15,75,2.5,'stack','double_progression',false,null,'Keep elbows in; get a deep stretch at the bottom.'),
    ('weighted-pull-up','Weighted Pull-Up', array['lats','upper_back'], array['biceps','rear_delts'],
      'bodyweight','weighted_bodyweight','weighted_bodyweight',3,4,6,180,1.25,'added','double_progression',false,
      'Log ADDED weight only. Baseline ~8–12 strict bodyweight reps. Untested estimate: about +15 kg for 5–6 reps — confirm before trusting it.',
      'Dead hang start, chin over bar, no kipping.'),
    ('barbell-row','Barbell Row', array['upper_back','lats'], array['rear_delts','biceps','spinal_erectors'],
      'barbell','compound','external',3,6,10,120,2.5,'total','double_progression',true,null,'Hinge to ~45°, pull to lower ribs, keep the spine neutral.'),
    ('lat-pulldown','Cable Lat Pulldown', array['lats'], array['biceps','upper_back'],
      'cable','compound','external',2,10,12,90,2.5,'stack','double_progression',false,null,null),
    ('cable-rear-delt-fly','Cable Rear-Delt Fly', array['rear_delts'], array['upper_back'],
      'cable','isolation','external',2,12,20,60,1.25,'stack','reps_first',false,null,null),
    ('preacher-curl','Preacher Curl', array['biceps'], array['forearms'],
      'barbell','isolation','external',2,8,12,75,1,'total','double_progression',false,'Set the increment to your smallest available jump (often 0.5–2 kg).',null),
    ('bayesian-cable-curl','Bayesian Cable Curl', array['biceps'], array[]::text[],
      'cable','isolation','external',2,10,15,75,1.25,'stack','double_progression',false,null,'Face away from the stack, arm behind the torso for a long-length curl.'),
    ('leg-press','Leg Press', array['quads','glutes'], array['hamstrings'],
      'machine','compound','external',2,6,10,120,5,'stack','double_progression',false,'Maintenance volume — do not add sets.',null),
    ('seated-leg-curl','Seated Leg Curl', array['hamstrings'], array[]::text[],
      'machine','isolation','external',2,8,12,90,2.5,'stack','double_progression',false,'Maintenance volume.',null),
    ('leg-extension','Leg Extension', array['quads'], array[]::text[],
      'machine','isolation','external',1,10,15,75,2.5,'stack','double_progression',false,'Maintenance volume.',null),
    ('lumbar-extension','Lumbar Extension Machine', array['spinal_erectors'], array['glutes'],
      'machine','isolation','external',3,10,15,90,2.5,'stack','double_progression',false,'Priority: spinal-erector strength.',null),
    ('standing-calf-raise','Standing Calf Raise', array['calves'], array[]::text[],
      'machine','isolation','external',2,10,15,75,5,'stack','double_progression',false,null,'Full stretch at the bottom, pause at the top.'),
    ('cable-crunch','Cable Crunch', array['abs'], array[]::text[],
      'cable','isolation','external',3,10,15,75,2.5,'stack','double_progression',false,null,null),
    ('explosive-high-pull-up','Explosive High Pull-Up', array['lats','upper_back'], array['biceps'],
      'bodyweight','skill','bodyweight',3,2,3,120,1.25,'added','skill',false,
      'Skill work: quality, speed and pulling height matter more than reps. Stop before reps slow down.',
      'Pull explosively toward the lower chest / belly button, slight hollow-to-arch swing.'),
    ('assisted-muscle-up-transition','Assisted Muscle-Up Transition', array['lats','chest'], array['triceps'],
      'bodyweight','skill','assisted',2,2,3,90,1.25,'added','skill',false,
      'Log band/machine assistance. Progress by reducing assistance once transitions are smooth.',
      'Fast turnover of the wrists, lean the chest over the bar.'),
    ('straight-bar-dip','Straight-Bar Dip', array['chest','triceps'], array['front_delts'],
      'bodyweight','bodyweight','bodyweight',2,5,8,90,1.25,'added','bodyweight_reps',false,'Muscle-up support strength.',null),
    ('incline-db-press','Incline Dumbbell Press', array['upper_chest'], array['front_delts','triceps'],
      'dumbbell','compound','external',3,8,12,120,2,'per_dumbbell','double_progression',false,'Log weight per dumbbell.',null),
    ('seated-cable-row','Seated Cable Row', array['upper_back','lats'], array['biceps','rear_delts'],
      'cable','compound','external',2,8,12,90,2.5,'stack','double_progression',false,null,null)
  ) as v(slug,name,pm,sm,eq,cat,lt,s,rmin,rmax,rest,inc,conv,prog,e1rm,notes,instr)
  on conflict (user_id, slug) do nothing;

  -- Program -----------------------------------------------------------------
  insert into programs (user_id, name, description, is_active)
  values (uid, 'Upper Aesthetics — 4 Day',
          'Upper-body focus (shoulders, upper chest, back, arms) with weighted pull-up and muscle-up work. Legs on maintenance; spinal erectors prioritised. ~60 min sessions.',
          not exists (select 1 from programs where user_id = uid and is_active and archived_at is null))
  returning id into prog;

  for d in select * from (values
    (1, 'Push', 1, 'Easy pull-ups, then progressive pressing warm-up sets.'),
    (2, 'Pull', 2, 'A few easy bodyweight pull-ups and light rows.'),
    (3, 'Lower', 4, 'Light leg press and a set of back extensions.'),
    (4, 'Upper + Muscle-Up', 6, 'Scap pulls, easy pull-ups, band transitions.')
  ) as t(pos, name, dow, warm)
  loop
    insert into workout_templates (user_id, program_id, name, day_of_week, position, warmup_notes)
    values (uid, prog, d.name, d.dow, d.pos, d.warm) returning id into tpl;

    pos := 0;
    insert into template_exercises (user_id, template_id, exercise_id, position, sets, rep_min, rep_max, rest_s, optional, notes)
    select uid, tpl, e.id, x.ord, x.sets, x.rmin, x.rmax, x.rest, x.opt, x.note
    from (values
      ('Push',1,'incline-smith-press',3,6,10,120,false,null),
      ('Push',2,'seated-shoulder-press',2,8,12,120,false,null),
      ('Push',3,'cable-lateral-raise',4,12,20,75,false,'Rest 60–90 s.'),
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
      ('Upper + Muscle-Up',1,'explosive-high-pull-up',3,2,3,120,false,null),
      ('Upper + Muscle-Up',2,'assisted-muscle-up-transition',2,2,3,90,false,null),
      ('Upper + Muscle-Up',3,'straight-bar-dip',2,5,8,90,false,null),
      ('Upper + Muscle-Up',4,'incline-db-press',3,8,12,120,false,null),
      ('Upper + Muscle-Up',5,'seated-cable-row',2,8,12,90,false,null),
      ('Upper + Muscle-Up',6,'lat-pulldown',2,10,12,90,false,null),
      ('Upper + Muscle-Up',7,'cable-lateral-raise',4,12,20,60,false,null),
      ('Upper + Muscle-Up',8,'cable-rear-delt-fly',2,12,20,60,false,null),
      ('Upper + Muscle-Up',9,'bayesian-cable-curl',1,10,15,60,false,null)
    ) as x(tname, ord, slug, sets, rmin, rmax, rest, opt, note)
    join exercises e on e.user_id = uid and e.slug = x.slug
    where x.tname = d.name;
  end loop;

  insert into program_versions (user_id, program_id, version, snapshot, note)
  values (uid, prog, 1, public.program_snapshot(prog), 'Initial program');

  return prog;
end $$;

-- JSON snapshot of a program (used for versioning and export)
create or replace function public.program_snapshot(pid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'program', to_jsonb(p) - 'user_id',
    'templates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'template', to_jsonb(t) - 'user_id',
        'exercises', coalesce((
          select jsonb_agg((to_jsonb(te) - 'user_id') || jsonb_build_object('exercise_name', e.name) order by te.position)
          from template_exercises te join exercises e on e.id = te.exercise_id
          where te.template_id = t.id), '[]'::jsonb)
      ) order by t.position)
      from workout_templates t where t.program_id = p.id), '[]'::jsonb)
  )
  from programs p where p.id = pid;
$$;

-- Save a new program version (callable by the owner)
create or replace function public.snapshot_program(pid uuid, note text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not exists (select 1 from programs where id = pid and user_id = auth.uid()) then
    raise exception 'not found';
  end if;
  update programs set version = version + 1 where id = pid returning version into v;
  insert into program_versions (user_id, program_id, version, snapshot, note)
  values (auth.uid(), pid, v, public.program_snapshot(pid), note);
  return v;
end $$;

-- Seed for the current user if they have nothing yet (covers users created before this migration)
create or replace function public.ensure_seeded() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into profiles (id) values (auth.uid()) on conflict do nothing;
  if not exists (select 1 from programs where user_id = auth.uid()) then
    perform public.seed_default_program(auth.uid());
  end if;
end $$;

-- New-user hook
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', initcap(split_part(split_part(new.email, '@', 1), '.', 1))))
  on conflict do nothing;
  perform public.seed_default_program(new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.seed_default_program(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.program_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.ensure_seeded() to authenticated;
grant execute on function public.snapshot_program(uuid, text) to authenticated;
