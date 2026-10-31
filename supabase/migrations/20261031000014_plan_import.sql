-- Importing a trainer's workout plan.
--
-- * Plan prescriptions. template_exercises gains what a written plan can prescribe beyond sets, reps,
--   rest and RIR: warm-up sets, drop sets, RPE (kept apart from RIR; never converted), tempo, a
--   prescribed load, "each side" and supersets. All optional; existing rows get the neutral default,
--   so every existing program behaves exactly as before. These are prescriptions only: nothing here
--   creates history, completed sets or records.
-- * Starting a workout copies the new fields into session_exercises.prescribed and creates the
--   prescribed warm-up sets (kind 'warmup', before the working sets). Drop segments are never
--   pre-created; the lifter adds them while logging (migration 013's model) and the prescription is
--   only a hint. A prescribed load is never written into a set.
-- * plan_imports holds a user's import draft so it survives a failed extraction, a validation error
--   or a closed tab. Private per user (RLS). A draft expires 30 days after its last change; once a
--   program is created the draft (which quotes the source document) is cleared and only the link to
--   the created program is kept, so a retried request returns the same program. Source files
--   themselves are never stored.
-- * create_program_from_import() is the only write path: one transaction, validated here, safe to
--   retry with the same import id. It creates a new, inactive program unless the user explicitly
--   asks to make it active, and never touches existing programs or history.
--
-- Apply after 013. Schema and functions only; no existing row is changed.

-- ---------- prescriptions ----------
alter table public.template_exercises
  add column warmup_sets smallint not null default 0 check (warmup_sets between 0 and 10),
  add column drop_segments smallint not null default 0 check (drop_segments between 0 and 5),
  add column drop_scope text check (drop_scope in ('last_set', 'all_sets')),
  add column target_rpe numeric(3,1) check (target_rpe is null or target_rpe between 1 and 10),
  add column tempo text check (tempo is null or char_length(tempo) between 1 and 20),
  add column target_weight_kg numeric(6,2) check (target_weight_kg is null or target_weight_kg between 0 and 1000),
  add column per_side boolean not null default false,
  add column superset_group text check (superset_group is null or superset_group ~ '^[A-Z]$'),
  add constraint template_exercises_drop_scope check ((drop_segments = 0) = (drop_scope is null)),
  add constraint template_exercises_notes_len check (notes is null or char_length(notes) <= 1000);

-- ---------- starting a workout ----------
-- Same as migration 011, plus the new prescription keys and the prescribed warm-up sets.
create or replace function public.start_workout_on(
  p_template_id uuid default null, p_name text default null, p_started_at timestamptz default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  sid uuid;
  t workout_templates%rowtype;
  te record;
  seid uuid;
  bw numeric;
  v_at timestamptz := coalesce(p_started_at, now());
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'future_date'; end if;
  select id into sid from workout_sessions where user_id = auth.uid() and status = 'in_progress';
  if sid is not null then
    raise exception 'workout_in_progress' using detail = sid::text;
  end if;
  select bodyweight_kg into bw from profiles where id = auth.uid();

  if p_template_id is null then
    insert into workout_sessions (name, bodyweight_kg, started_at)
    values (coalesce(nullif(trim(p_name), ''), 'Workout'), bw, v_at) returning id into sid;
    return sid;
  end if;

  select * into t from workout_templates where id = p_template_id;
  if not found then raise exception 'template not found'; end if;

  insert into workout_sessions (template_id, program_id, name, bodyweight_kg, started_at)
  values (t.id, t.program_id, coalesce(nullif(trim(p_name), ''), t.name), bw, v_at) returning id into sid;

  for te in
    select x.*, e.track_sides,
           case when e.default_attachment_state = 'attachment' and a.archived_at is not null then null else e.default_attachment_state end as att_state,
           case when a.archived_at is null then e.default_attachment_id end as att_id
    from template_exercises x
    join exercises e on e.id = x.exercise_id
    left join attachments a on a.id = e.default_attachment_id
    where x.template_id = t.id order by x.position
  loop
    insert into session_exercises (session_id, exercise_id, template_exercise_id, position, prescribed,
                                   track_sides, attachment_state, attachment_id)
    values (sid, te.exercise_id, te.id, te.position,
            jsonb_build_object('sets', te.sets, 'rep_min', te.rep_min, 'rep_max', te.rep_max,
                               'rest_s', te.rest_s, 'target_rir', te.target_rir,
                               'optional', te.optional, 'notes', te.notes,
                               'warmup_sets', te.warmup_sets, 'drop_segments', te.drop_segments,
                               'drop_scope', te.drop_scope, 'target_rpe', te.target_rpe, 'tempo', te.tempo,
                               'target_weight_kg', te.target_weight_kg, 'per_side', te.per_side,
                               'superset_group', te.superset_group),
            te.track_sides, te.att_state, te.att_id)
    returning id into seid;
    insert into set_logs (session_id, session_exercise_id, position, kind, sided)
    select sid, seid, g - 1, 'warmup', te.track_sides from generate_series(1, te.warmup_sets) g;
    insert into set_logs (session_id, session_exercise_id, position, kind, sided)
    select sid, seid, te.warmup_sets + g - 1, 'working', te.track_sides from generate_series(1, te.sets) g;
  end loop;
  return sid;
end $$;

-- ---------- import drafts ----------
create table public.plan_imports (
  id uuid primary key,                       -- generated by the client; doubles as the idempotency key
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'created')),
  source_kind text not null default 'paste' check (source_kind in ('paste', 'csv', 'xlsx', 'pdf', 'image', 'manual')),
  source_name text check (source_name is null or char_length(source_name) <= 200),
  draft jsonb check (draft is null or (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 1048576)),
  created_program_id uuid references public.programs(id) on delete set null,
  expires_at timestamptz not null default now() + interval '30 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_imports_created check ((status = 'created') = (draft is null))
);
create index plan_imports_user_idx on public.plan_imports(user_id, updated_at desc);
create index plan_imports_expires_idx on public.plan_imports(expires_at);
create index plan_imports_program_idx on public.plan_imports(created_program_id);

create or replace function public.plan_imports_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.expires_at := now() + interval '30 days';
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  return new;
end $$;
create trigger plan_imports_touch before update on public.plan_imports
  for each row execute function public.plan_imports_touch();

alter table public.plan_imports enable row level security;
create policy "own rows: select" on public.plan_imports for select to authenticated using (user_id = (select auth.uid()));
create policy "own rows: insert" on public.plan_imports for insert to authenticated with check (user_id = (select auth.uid()) and status = 'draft');
-- A created import is final: the client can't edit it back into a draft or point it at another program.
create policy "own rows: update" on public.plan_imports for update to authenticated
  using (user_id = (select auth.uid()) and status = 'draft') with check (user_id = (select auth.uid()) and status = 'draft' and created_program_id is null);
create policy "own rows: delete" on public.plan_imports for delete to authenticated using (user_id = (select auth.uid()));

-- Deletes every expired draft (any account): retention doesn't depend on its owner coming back.
-- Called when the import page opens. Returns how many of the caller's own drafts were removed.
create or replace function public.purge_expired_plan_imports() returns integer
language plpgsql security definer set search_path = public as $$
declare mine integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select count(*) into mine from plan_imports where user_id = auth.uid() and expires_at < now();
  delete from plan_imports where expires_at < now();
  return mine;
end $$;

-- ---------- creating the program ----------
-- p_program: { name, description?, source_name?, workouts: [{ name, exercises: [{ exercise_id | catalog_slug,
--   sets, rep_min, rep_max, rest_s, target_rir?, target_rpe?, tempo?, target_weight_kg?, per_side?,
--   warmup_sets?, drop_segments?, drop_scope?, superset_group?, optional?, notes? }] }] }
-- Errors are short codes; details name the workout/exercise position (1-based) when relevant.
create or replace function public.create_program_from_import(p_import_id uuid, p_program jsonb, p_make_active boolean default false)
returns jsonb
-- Definer so it alone can mark an import as created (the client can't). Every read and write below is
-- scoped to auth.uid() explicitly, and the ownership triggers still check every row.
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  imp plan_imports%rowtype;
  pid uuid;
  tid uuid;
  w jsonb;
  w_pos bigint;
  x jsonb;
  x_pos bigint;
  eid uuid;
  v_slug text;
  cat jsonb;
  slug_ids jsonb := '{}'::jsonb;
  v_name text := nullif(btrim(p_program->>'name'), '');
  v_source text := nullif(btrim(p_program->>'source_name'), '');
  v_where text;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_import_id is null then raise exception 'invalid_import'; end if;

  -- Serialise retries and double taps on the same import id.
  insert into plan_imports (id, user_id, status, source_kind, draft) values (p_import_id, uid, 'draft', 'manual', '{}'::jsonb)
  on conflict (id) do nothing;
  select * into imp from plan_imports where id = p_import_id and user_id = uid for update;
  if not found then raise exception 'invalid_import'; end if;
  if imp.status = 'created' then
    if imp.created_program_id is null then raise exception 'program_deleted'; end if;
    return jsonb_build_object('program_id', imp.created_program_id, 'status', 'already_created');
  end if;

  if jsonb_typeof(p_program) is distinct from 'object' then raise exception 'invalid_program'; end if;
  if v_name is null or char_length(v_name) > 120 then raise exception 'invalid_program_name'; end if;
  if jsonb_typeof(p_program->'workouts') is distinct from 'array'
     or jsonb_array_length(p_program->'workouts') not between 1 and 30 then raise exception 'invalid_workouts'; end if;

  insert into programs (user_id, name, description, is_active)
  values (uid, v_name, nullif(left(btrim(coalesce(p_program->>'description', '')), 2000), ''), false)
  returning id into pid;

  for w, w_pos in select * from jsonb_array_elements(p_program->'workouts') with ordinality loop
    v_where := w_pos::text;
    if nullif(btrim(w->>'name'), '') is null or char_length(btrim(w->>'name')) > 120 then
      raise exception 'invalid_workout_name' using detail = v_where;
    end if;
    if jsonb_typeof(w->'exercises') is distinct from 'array' or jsonb_array_length(w->'exercises') not between 1 and 40 then
      raise exception 'invalid_exercises' using detail = v_where;
    end if;
    insert into workout_templates (user_id, program_id, name, position, warmup_notes)
    values (uid, pid, btrim(w->>'name'), w_pos, nullif(left(btrim(coalesce(w->>'warmup_notes', '')), 1000), ''))
    returning id into tid;

    for x, x_pos in select * from jsonb_array_elements(w->'exercises') with ordinality loop
      v_where := w_pos || '.' || x_pos;
      eid := null;
      if x ? 'exercise_id' and jsonb_typeof(x->'exercise_id') = 'string' then
        select id into eid from exercises where id = (x->>'exercise_id')::uuid and user_id = uid;
      elsif x ? 'catalog_slug' and jsonb_typeof(x->'catalog_slug') = 'string' then
        v_slug := x->>'catalog_slug';
        if slug_ids ? v_slug then
          eid := (slug_ids->>v_slug)::uuid;
        else
          -- Copies the catalog entry, or returns the library exercise that already has it.
          cat := public.add_catalog_exercises(array[v_slug]);
          eid := coalesce((cat->'added'->0->>'id')::uuid, (cat->'skipped'->0->>'existing_id')::uuid);
          if eid is not null then slug_ids := slug_ids || jsonb_build_object(v_slug, eid); end if;
        end if;
      end if;
      if eid is null then raise exception 'unknown_exercise' using detail = v_where; end if;

      begin
        insert into template_exercises (user_id, template_id, exercise_id, position, sets, rep_min, rep_max, rest_s,
          target_rir, target_rpe, tempo, target_weight_kg, per_side, warmup_sets, drop_segments, drop_scope,
          superset_group, optional, notes)
        values (uid, tid, eid, x_pos, (x->>'sets')::smallint, (x->>'rep_min')::smallint, (x->>'rep_max')::smallint,
          (x->>'rest_s')::integer, (x->>'target_rir')::numeric, (x->>'target_rpe')::numeric,
          nullif(btrim(coalesce(x->>'tempo', '')), ''), (x->>'target_weight_kg')::numeric,
          coalesce((x->>'per_side')::boolean, false), coalesce((x->>'warmup_sets')::smallint, 0),
          coalesce((x->>'drop_segments')::smallint, 0), x->>'drop_scope', x->>'superset_group',
          coalesce((x->>'optional')::boolean, false), nullif(btrim(coalesce(x->>'notes', '')), ''));
      exception
        when not_null_violation or check_violation or invalid_text_representation or numeric_value_out_of_range then
          raise exception 'invalid_prescription' using detail = v_where;
      end;
    end loop;
  end loop;

  if p_make_active then
    update programs set is_active = false where user_id = uid and is_active and id <> pid;
    update programs set is_active = true where id = pid;
  end if;

  perform public.snapshot_program(pid, left(coalesce('Imported from ' || v_source, 'Imported plan'), 200));
  update plan_imports set status = 'created', draft = null, created_program_id = pid where id = p_import_id;
  return jsonb_build_object('program_id', pid, 'status', 'created');
end $$;

revoke execute on function public.purge_expired_plan_imports() from public, anon;
revoke execute on function public.create_program_from_import(uuid, jsonb, boolean) from public, anon;
revoke execute on function public.plan_imports_touch() from public, anon, authenticated;
grant execute on function public.purge_expired_plan_imports() to authenticated;
grant execute on function public.create_program_from_import(uuid, jsonb, boolean) to authenticated;
