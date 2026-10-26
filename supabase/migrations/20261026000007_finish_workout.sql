-- Final validation and completion are one transaction, including removal of unfinished sets.
create or replace function public.finish_workout(p_session_id uuid, p_notes text, p_ended_at timestamptz)
returns void language plpgsql security invoker set search_path = public as $$
declare s workout_sessions%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from workout_sessions where id = p_session_id for update;
  if not found then raise exception 'Workout not found.'; end if;
  if s.status = 'completed' then return; end if; -- safe retry after a lost response
  if s.status <> 'in_progress' then raise exception 'This workout cannot be completed.'; end if;
  if p_ended_at is null or p_ended_at < s.started_at then raise exception 'Invalid workout end time.'; end if;
  perform id from session_exercises where session_id = p_session_id for update;
  perform id from set_logs where session_id = p_session_id for update;
  if not exists (select 1 from set_logs where session_id = p_session_id and completed) then
    raise exception 'Complete at least one set first.';
  end if;
  if exists (
    select 1 from set_logs l join session_exercises se on se.id = l.session_exercise_id
    join exercises e on e.id = se.exercise_id
    where l.session_id = p_session_id and l.completed
      and (l.reps is null or l.reps < 1
        or (e.load_type = 'assisted' and l.assistance_kg is null)
        or (e.load_type = 'external' and l.weight_kg is null))
  ) then raise exception 'A completed set is missing reps or load. Correct it before finishing.'; end if;
  delete from set_logs where session_id = p_session_id and not completed;
  update workout_sessions set status = 'completed', ended_at = p_ended_at, notes = p_notes where id = p_session_id;
end $$;
revoke execute on function public.finish_workout(uuid, text, timestamptz) from public, anon;
grant execute on function public.finish_workout(uuid, text, timestamptz) to authenticated;
