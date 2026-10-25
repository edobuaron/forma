-- Hardening from the Supabase advisors: pinned search_path, no anonymous RPCs,
-- RLS policies that evaluate auth.uid() once per query, and indexes on foreign keys.

alter function public.touch_updated_at() set search_path = public;

-- Trigger-only function: triggers fire without EXECUTE, so nobody needs to call it directly.
revoke execute on function public.assert_same_owner() from public, anon, authenticated;
-- These check auth.uid() themselves; only signed-in users should reach them.
revoke execute on function public.ensure_seeded() from public, anon;
revoke execute on function public.snapshot_program(uuid, text) from public, anon;
revoke execute on function public.recent_exercise_history(uuid[], integer, uuid) from public, anon;
revoke execute on function public.start_workout(uuid, text) from public, anon;

do $$
declare t text;
begin
  foreach t in array array['exercises','programs','program_versions','workout_templates',
    'template_exercises','workout_sessions','session_exercises','set_logs',
    'body_measurements','dismissed_recommendations','personal_records']
  loop
    execute format('drop policy "own rows: select" on public.%I', t);
    execute format('drop policy "own rows: insert" on public.%I', t);
    execute format('drop policy "own rows: update" on public.%I', t);
    execute format('drop policy "own rows: delete" on public.%I', t);
    execute format('create policy "own rows: select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "own rows: insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "own rows: update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "own rows: delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

drop policy "own profile: select" on public.profiles;
drop policy "own profile: update" on public.profiles;
drop policy "own profile: insert" on public.profiles;
create policy "own profile: select" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "own profile: insert" on public.profiles for insert to authenticated with check (id = (select auth.uid()));

create index if not exists personal_records_exercise_idx on public.personal_records(exercise_id);
create index if not exists program_versions_user_idx on public.program_versions(user_id);
create index if not exists session_exercises_exercise_fk_idx on public.session_exercises(exercise_id);
create index if not exists session_exercises_substituted_for_idx on public.session_exercises(substituted_for);
create index if not exists session_exercises_template_exercise_idx on public.session_exercises(template_exercise_id);
create index if not exists set_logs_session_idx on public.set_logs(session_id);
create index if not exists template_exercises_exercise_idx on public.template_exercises(exercise_id);
create index if not exists template_exercises_user_idx on public.template_exercises(user_id);
create index if not exists workout_sessions_program_idx on public.workout_sessions(program_id);
create index if not exists workout_sessions_template_idx on public.workout_sessions(template_id);
create index if not exists workout_templates_user_idx on public.workout_templates(user_id);
