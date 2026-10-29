-- Every new account gets its own editable copy of the starter program, exactly once.
--
-- * The starter is a sanitized, versioned template (seed_starter_program, STARTER v1): workout names,
--   exercises, order, sets, rep ranges, rest and neutral catalog notes. It never reads another
--   account: no loads, reps, RIR, history, records, measurements or personal notes are copied.
-- * Sign-up seeds it once and records profiles.starter_seeded_at. ensure_seeded() seeds only an
--   account that has never been seeded and has no programs, so archiving or deleting the starter
--   is permanent. add_starter_program() is the explicit way to get a fresh copy again.
-- * Setup (complete_onboarding) now only records name and units; it never creates programs.
-- * Existing accounts are marked as already seeded and are not changed.

alter table public.profiles
  add column starter_seeded_at timestamptz,
  add column starter_version integer;

-- Which starter template version a program was copied from; null for programs users made.
alter table public.programs add column starter_version integer;

-- Existing accounts already have what they chose (or the original seed). Never add to them.
-- Only an account that hasn't finished setup and has no programs yet will still get the starter.
update public.profiles p set starter_seeded_at = coalesce(p.onboarded_at, p.created_at)
where p.starter_seeded_at is null
  and (p.onboarded_at is not null or exists (select 1 from public.programs g where g.user_id = p.id));
update public.programs set starter_version = 1
where name = 'Example 4-day template' and starter_version is null;

-- Starter template v1. Structure only; each call creates an independent copy owned by uid.
create or replace function public.seed_starter_program(uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  starter_v constant integer := 1;
  prog uuid;
  tpl uuid;
  d record;
begin
  insert into programs (user_id, name, description, is_active, starter_version)
  values (uid, 'Starter program (4-day)',
          'Your own copy of a generic 4-day starter split. Edit it, add programs, or archive it. It is not personalised advice and has no preset weights: pick loads you can do with good form on your first session.',
          not exists (select 1 from programs where user_id = uid and is_active and archived_at is null),
          starter_v)
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
  values (uid, prog, 1, public.program_snapshot(prog), 'Starter template v' || starter_v);

  update profiles set starter_seeded_at = coalesce(starter_seeded_at, now()), starter_version = starter_v where id = uid;
  return prog;
end $$;

-- Seed the starter for an account exactly once. The profile row is locked so concurrent calls
-- (sign-up trigger, first page load, a second tab) cannot both seed.
create or replace function public.seed_starter_once(uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare prof profiles%rowtype;
begin
  insert into profiles (id) values (uid) on conflict do nothing;
  select * into prof from profiles where id = uid for update;
  if prof.starter_seeded_at is not null then return null; end if;
  if exists (select 1 from programs where user_id = uid) then
    -- An account that already has programs keeps them as they are.
    update profiles set starter_seeded_at = now() where id = uid;
    return null;
  end if;
  return public.seed_starter_program(uid);
end $$;

-- Explicit "Add starter program again": a fresh, independent copy. Existing programs are untouched.
create or replace function public.add_starter_program() returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform 1 from profiles where id = auth.uid() for update;
  return public.seed_starter_program(auth.uid());
end $$;

-- Profile + one-time starter. Never re-creates a starter that was archived or deleted.
create or replace function public.ensure_seeded() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform public.seed_starter_once(auth.uid());
end $$;

-- Setup records name and units only. p_choice is kept for compatibility and ignored; programs are
-- never created here.
create or replace function public.complete_onboarding(p_choice text default null, p_display_name text default null, p_unit text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  prof profiles%rowtype;
  nm text := nullif(btrim(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', '', 'g')), '');
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_unit is not null and p_unit not in ('kg','lb') then raise exception 'invalid_unit'; end if;
  if char_length(nm) > 60 then raise exception 'name_too_long'; end if;
  perform public.seed_starter_once(uid);
  select * into prof from profiles where id = uid for update;
  if prof.onboarded_at is not null then
    return jsonb_build_object('status', 'already_set_up');
  end if;
  update profiles set
    display_name = coalesce(nm, display_name),
    unit = coalesce(p_unit::weight_unit, unit),
    onboarded_at = now(),
    setup_choice = 'starter'
  where id = uid;
  return jsonb_build_object('status', 'set_up');
end $$;

-- Sign-up: profile, then the starter, once.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, left(nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name',
    initcap(split_part(split_part(new.email, '@', 1), '.', 1)))), ''), 60))
  on conflict do nothing;
  perform public.seed_starter_once(new.id);
  return new;
end $$;

revoke execute on function public.seed_starter_once(uuid) from public, anon, authenticated;
revoke execute on function public.seed_starter_program(uuid) from public, anon, authenticated;
revoke execute on function public.add_starter_program() from public, anon;
grant execute on function public.add_starter_program() to authenticated;
