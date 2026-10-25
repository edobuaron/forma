-- Read model for set history, personal records, and atomic workout start.

-- Flat set history (RLS of the underlying tables applies: security_invoker)
create view public.set_history with (security_invoker = true) as
select
  l.id,
  l.user_id,
  l.session_id,
  l.session_exercise_id,
  se.exercise_id,
  s.started_at,
  s.status,
  s.name as session_name,
  s.bodyweight_kg,
  se.prescribed,
  se.position as se_position,
  l.position,
  l.kind,
  l.weight_kg,
  l.assistance_kg,
  l.reps,
  l.rir,
  l.completed,
  l.completed_at
from public.set_logs l
join public.session_exercises se on se.id = l.session_exercise_id
join public.workout_sessions s on s.id = l.session_id;

-- Last N completed sessions (with at least one completed working set) per exercise
create or replace function public.recent_exercise_history(
  p_exercise_ids uuid[], p_sessions integer default 6, p_exclude_session uuid default null
) returns setof public.set_history
language sql stable security invoker set search_path = public as $$
  with ranked as (
    select se.exercise_id, se.session_id,
           dense_rank() over (partition by se.exercise_id order by s.started_at desc, s.id) as rk
    from session_exercises se
    join workout_sessions s on s.id = se.session_id
    where se.exercise_id = any(p_exercise_ids)
      and s.status = 'completed'
      and (p_exclude_session is null or s.id <> p_exclude_session)
      and exists (select 1 from set_logs l where l.session_exercise_id = se.id and l.completed and l.kind = 'working')
  )
  select h.* from set_history h
  join (select distinct exercise_id, session_id from ranked where rk <= p_sessions) r
    on r.exercise_id = h.exercise_id and r.session_id = h.session_id
  where h.completed
  order by h.started_at desc, h.se_position, h.position;
$$;

-- Personal records (derived; recomputed from history, so they can always be rebuilt)
create table public.personal_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  session_id uuid not null references public.workout_sessions(id) on delete cascade,
  type text not null check (type in ('heaviest_load','reps_at_load','best_e1rm','most_reps','first_skill','least_assistance')),
  value numeric(8,2) not null,
  load_kg numeric(6,2),
  reps smallint,
  previous numeric(8,2),
  achieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (session_id, exercise_id, type)
);
create index personal_records_user_idx on public.personal_records(user_id, achieved_at desc);
alter table public.personal_records enable row level security;
create policy "own rows: select" on public.personal_records for select using (user_id = auth.uid());
create policy "own rows: insert" on public.personal_records for insert with check (user_id = auth.uid());
create policy "own rows: update" on public.personal_records for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows: delete" on public.personal_records for delete using (user_id = auth.uid());

-- Start a workout atomically from a template (or empty). Snapshots the prescription.
create or replace function public.start_workout(p_template_id uuid default null, p_name text default null)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  sid uuid;
  t workout_templates%rowtype;
  te record;
  seid uuid;
  bw numeric;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select id into sid from workout_sessions where user_id = auth.uid() and status = 'in_progress';
  if sid is not null then
    raise exception 'workout_in_progress' using detail = sid::text;
  end if;
  select bodyweight_kg into bw from profiles where id = auth.uid();

  if p_template_id is null then
    insert into workout_sessions (name, bodyweight_kg)
    values (coalesce(nullif(trim(p_name), ''), 'Workout'), bw) returning id into sid;
    return sid;
  end if;

  select * into t from workout_templates where id = p_template_id;
  if not found then raise exception 'template not found'; end if;

  insert into workout_sessions (template_id, program_id, name, bodyweight_kg)
  values (t.id, t.program_id, coalesce(nullif(trim(p_name), ''), t.name), bw) returning id into sid;

  for te in select * from template_exercises where template_id = t.id order by position loop
    insert into session_exercises (session_id, exercise_id, template_exercise_id, position, prescribed)
    values (sid, te.exercise_id, te.id, te.position,
            jsonb_build_object('sets', te.sets, 'rep_min', te.rep_min, 'rep_max', te.rep_max,
                               'rest_s', te.rest_s, 'target_rir', te.target_rir,
                               'optional', te.optional, 'notes', te.notes))
    returning id into seid;
    insert into set_logs (session_id, session_exercise_id, position, kind)
    select sid, seid, g - 1, 'working' from generate_series(1, te.sets) g;
  end loop;
  return sid;
end $$;

grant select on public.set_history to authenticated;
grant execute on function public.recent_exercise_history(uuid[], integer, uuid) to authenticated;
grant execute on function public.start_workout(uuid, text) to authenticated;
