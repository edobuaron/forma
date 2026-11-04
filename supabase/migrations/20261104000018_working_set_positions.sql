-- Set comparisons by working-set position (first set with first set, second with second).
--
-- * set_logs.working_no: the set's 1-based number among the exercise's working sets of the same stream
--   (sets logged together, or sets with left/right), counted over every planned working set,
--   including ones left unfinished. Warm-ups and drop segments have none.
-- * finish_workout assigns it just before unfinished sets are removed, so a skipped middle set leaves
--   a gap ("set 3" stays set 3) instead of shifting later sets onto earlier positions. Everything else
--   in finish_workout is unchanged from migration 016.
-- * Rows that existed before this migration keep working_no null; the app then numbers them by order,
--   as before. A set removed during the workout is gone, so the sets after it are renumbered, matching
--   what the workout screen showed. Editing a past workout keeps stored numbers (save_session_edit does
--   not touch the column); new sets added in an edit get none and follow by order.
-- * set_history gains working_no as its last column; existing columns are unchanged.
-- Additive only: no data is changed or removed.

alter table public.set_logs
  add column if not exists working_no smallint check (working_no is null or working_no > 0);

create or replace view public.set_history with (security_invoker = true) as
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
  l.completed_at,
  s.shortfall_reason,
  l.sided,
  l.left_weight_kg, l.left_assistance_kg, l.left_reps, l.left_rir, l.left_completed,
  l.right_weight_kg, l.right_assistance_kg, l.right_reps, l.right_rir, l.right_completed,
  se.attachment_state,
  se.attachment_id,
  se.attachment_name,
  l.drop_parent_id,
  l.working_no
from public.set_logs l
join public.session_exercises se on se.id = l.session_exercise_id
join public.workout_sessions s on s.id = l.session_id;

-- ---------- finishing ----------
create or replace function public.finish_workout(p_session_id uuid, p_notes text, p_ended_at timestamptz, p_shortfall_reason text default null)
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
  perform id from session_runs where session_id = p_session_id for update;
  if not exists (select 1 from set_logs where session_id = p_session_id and completed)
     and not exists (select 1 from session_runs where session_id = p_session_id and completed) then
    raise exception 'Complete at least one set or run first.';
  end if;
  if exists (
    select 1 from set_logs l join session_exercises se on se.id = l.session_exercise_id
    join exercises e on e.id = se.exercise_id
    where l.session_id = p_session_id and l.completed and (
      (not l.sided and (l.reps is null or l.reps < 1
        or (e.load_type = 'assisted' and l.assistance_kg is null)
        or (e.load_type = 'external' and l.weight_kg is null)))
      or (l.sided and l.left_completed and (l.left_reps is null or l.left_reps < 1
        or (e.load_type = 'assisted' and l.left_assistance_kg is null)
        or (e.load_type = 'external' and l.left_weight_kg is null)))
      or (l.sided and l.right_completed and (l.right_reps is null or l.right_reps < 1
        or (e.load_type = 'assisted' and l.right_assistance_kg is null)
        or (e.load_type = 'external' and l.right_weight_kg is null))))
  ) then raise exception 'A completed set is missing reps or load. Correct it before finishing.'; end if;
  if exists (
    select 1 from set_logs d join set_logs p on p.id = d.drop_parent_id
    where d.session_id = p_session_id and d.completed and not p.completed
  ) then raise exception 'A drop is logged under a set that is not completed. Complete or remove it before finishing.'; end if;
  -- Number working sets by position within each exercise and stream (together / sides) before
  -- unfinished ones are removed, so a skipped set leaves its number unused (new in 018).
  update set_logs l set working_no = n.no
    from (select id, row_number() over (partition by session_exercise_id, sided order by position, id) as no
            from set_logs where session_id = p_session_id and kind = 'working') n
   where l.id = n.id and l.working_no is distinct from n.no;
  update set_logs set working_no = null where session_id = p_session_id and kind <> 'working' and working_no is not null;
  delete from set_logs where session_id = p_session_id and not completed;
  delete from session_runs where session_id = p_session_id and not completed;
  update set_logs set left_weight_kg = null, left_assistance_kg = null, left_reps = null, left_rir = null, left_completed_at = null
   where session_id = p_session_id and sided and not left_completed;
  update set_logs set right_weight_kg = null, right_assistance_kg = null, right_reps = null, right_rir = null, right_completed_at = null
   where session_id = p_session_id and sided and not right_completed;
  update workout_sessions set status = 'completed', ended_at = p_ended_at, notes = p_notes, shortfall_reason = p_shortfall_reason
   where id = p_session_id;
end $$;
