-- Workouts are no longer tied to weekdays: any template can be logged on any day,
-- including a past day. History lookups compare against sessions before the one being logged.

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

-- Kept for older clients: same as starting now.
create or replace function public.start_workout(p_template_id uuid default null, p_name text default null)
returns uuid
language sql security invoker set search_path = public as $$
  select public.start_workout_on(p_template_id, p_name, null);
$$;

-- When a session is excluded (the one being logged or viewed), only sessions that started
-- before it count as history, so a backdated workout compares against what came before it.
create or replace function public.recent_exercise_history(
  p_exercise_ids uuid[], p_sessions integer default 6, p_exclude_session uuid default null
) returns setof public.set_history
language sql stable security invoker set search_path = public as $$
  with cutoff as (
    select coalesce((select started_at from workout_sessions where id = p_exclude_session), 'infinity'::timestamptz) as cutoff_at
  ), ranked as (
    select se.exercise_id, se.session_id,
           dense_rank() over (partition by se.exercise_id order by s.started_at desc, s.id) as rk
    from session_exercises se
    join workout_sessions s on s.id = se.session_id
    where se.exercise_id = any(p_exercise_ids)
      and s.status = 'completed'
      and (p_exclude_session is null or s.id <> p_exclude_session)
      and s.started_at < (select cutoff_at from cutoff)
      and exists (select 1 from set_logs l where l.session_exercise_id = se.id and l.completed and l.kind = 'working')
  )
  select h.* from set_history h
  join (select distinct exercise_id, session_id from ranked where rk <= p_sessions) r
    on r.exercise_id = h.exercise_id and r.session_id = h.session_id
  where h.completed
  order by h.started_at desc, h.se_position, h.position;
$$;

grant execute on function public.start_workout_on(uuid, text, timestamptz) to authenticated;
