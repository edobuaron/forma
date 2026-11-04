# Data model

Postgres (Supabase). Migrations in `supabase/migrations/` are the source of truth. This document explains intent.

## Conventions

- **IDs**: every row has a stable `uuid`. Clients may generate IDs (the active workout does), which makes writes idempotent.
- **Ownership**: every table has `user_id` (default `auth.uid()`) and RLS policies allowing a user to touch only their own rows. Triggers additionally check that child rows belong to the same user as their parents (e.g. you can't attach a set to someone else's session even with a valid `user_id`).
- **Units**: weights are stored in **kilograms** (`numeric`), lengths in centimetres. Display conversion to lb happens in the UI.
- **Timestamps**: `timestamptz`, UTC. `created_at`/`updated_at` maintained by triggers.
- **Validation**: CHECK constraints bound every number (reps 0–200, weight 0–1000 kg, RIR 0–10, rep_min ≤ rep_max, …). The UI validates the same ranges before saving.

## Plan vs. record

```
programs ─┬─ workout_templates ── template_exercises ──► exercises        (the plan)
          └─ program_versions (JSON snapshot per saved change)

workout_sessions ── session_exercises ── set_logs                          (what happened)
                         │  prescribed (JSON snapshot of the plan at start time)
                         └► exercises
```

Sessions reference templates with `on delete set null`; they never depend on the current plan. A session is self-describing through `session_exercises.prescribed`.

## Tables

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | Per-user settings | unit, default rest, auto rest timer, rest sound, bodyweight, conservative progression, `onboarded_at` / `setup_choice`, `starter_seeded_at` / `starter_version` (the one automatic starter copy; never reset), `maintenance_muscles` (migration 012; empty by default) |
| `exercises` | User's exercise library | `category` (compound / isolation / bodyweight / weighted_bodyweight / skill), `load_type` (external / bodyweight / weighted_bodyweight / assisted), `progression` (double_progression / reps_first / bodyweight_reps / skill / none), `increment_kg`, optional `available_loads_kg[]`, `weight_convention` (total / per_dumbbell / per_side / stack / added / assistance), `e1rm_eligible`, `archived_at`, `catalog_slug` + `catalog_version` (copied from the catalog; never updated by it), `aliases[]`, `source` (custom / catalog / import), `increment_is_generic` |
| `exercise_catalog` | Built-in, read-only exercise list | generated from `src/lib/catalog/catalog.ts`; readable by every signed-in user, writable by nobody |
| `programs` | Training programs | one `is_active` per user; `version` increments on each save; `starter_version` set on starter copies |
| `program_versions` | History of program changes | full JSON snapshot + note |
| `workout_templates` | A planned workout (e.g. "Push") | `day_of_week` is legacy (always null after editing); workouts are not tied to weekdays |
| `template_exercises` | Planned exercise in a template | sets, rep_min, rep_max, rest_s, target_rir, optional, notes; since migration 014 also `warmup_sets`, `drop_segments` + `drop_scope` (last_set / all_sets), `target_rpe` (separate from RIR, never converted), `tempo`, `target_weight_kg` (a prescription only), `per_side` (reps per side; set count unchanged), `superset_group` (A–Z) |
| `plan_imports` | Plan-import drafts (migration 014) | private per user; `draft` jsonb autosaved during review; cleared when the program is created (`status = created`, `created_program_id` kept for retries); expires 30 days after the last change |
| `workout_sessions` | A performed workout | `status` in_progress / completed / discarded (max one in progress), started/ended, notes, bodyweight snapshot, `energy_rating` (migration 015, see below) |
| `session_exercises` | Exercise performed in a session | `prescribed` snapshot, `substituted_for`, notes |
| `set_logs` | One set | `kind` warmup / working, `weight_kg` (**added** weight for bodyweight movements), `assistance_kg` (assisted movements), reps, rir, completed, completed_at |
| `body_measurements` | Dated body metrics | one row per user per day |
| `personal_records` | Derived PRs | recomputed from history after a workout or an edit; can always be rebuilt |
| `dismissed_recommendations` | Dismissed suggestions/insights | keyed by rule + evidence session, so a dismissal expires when new evidence appears |
| `template_runs` / `session_runs` | Planned runs and logged runs (migration 016) | see Running below |
| `attachments` | Cable attachments (migration 011) | private per user; starter list seeded once (`profiles.attachments_seeded_at`); `archived_at` when history uses one that was removed |

## Read model and RPCs

- `set_history` (view, `security_invoker`): flat join of sets with their session and exercise. Used for analytics and export.
- `recent_exercise_history(exercise_ids, sessions, exclude_session)`: last N completed sessions per exercise. Powers previous-session comparison and recommendations. When a session is excluded, only sessions that started before it count, so a backdated workout compares against what came before it.
- `start_workout_on(template_id, name, started_at)`: atomically creates a session, its exercises (with prescription snapshot) and empty sets. `started_at` defaults to now; a past date logs a workout for that day (future dates are rejected). `start_workout(template_id, name)` is kept as a wrapper that starts now.
- `create_program_from_import(import_id, program, make_active)`: creates a new program from a reviewed plan in one transaction, validating every value; retrying with the same import id returns the same program. Never touches existing programs or history and creates no sessions. `purge_expired_plan_imports()` removes expired drafts. See [PLAN_IMPORT.md](PLAN_IMPORT.md).
- `start_workout_on` (since 014) also copies the new prescription fields into `session_exercises.prescribed` and creates the prescribed warm-up sets (kind `warmup`, before the working sets). Drop segments are never pre-created and no load is pre-filled.
- `snapshot_program(program_id, note)`: bumps the program version and stores a snapshot.
- `ensure_seeded()`: creates the profile if missing and seeds the starter program once for an account that has never been seeded and has no programs. Never recreates an archived or deleted starter.
- `add_starter_program()`: explicit, fresh copy of the starter template. Existing programs are untouched.
- `complete_onboarding(choice, display_name, unit)`: first-run setup; records name and units only (`choice` is ignored since migration 010). Safe to retry.
- `add_catalog_exercises(slugs)`: copies catalog entries into the library; skips entries already linked or whose name/alias matches an existing exercise (archived included). Never touches programs.
- `import_exercises(rows)`: inserts previewed CSV rows in one transaction; rows matching an existing name are skipped, never overwritten.
- `exercise_name_key(name)`: duplicate-detection key (case, punctuation and simple plurals ignored), mirrored by `nameKey()` in `src/lib/catalog/names.ts`.

## Left/right and attachments (migration 011)

- A planned set is always **one** `set_logs` row. With `sided = true` the row's own `weight_kg`/`reps`/`rir` are null and `left_*`/`right_*` hold each side's load, reps, RIR and completion. `completed` means at least one side was performed (a check constraint enforces it). Finishing clears a side that wasn't performed; it is stored as unknown, never as zero.
- Old rows stay `sided = false`. "Per side" and "per dumbbell" weights logged with one value are never reinterpreted as independent sides.
- `exercises.track_sides` and `default_attachment_*` are copied into each new workout (`session_exercises.track_sides`, `attachment_*`). Sets that already hold data keep their mode when the workout's mode is switched.
- `session_exercises.attachment_state`: NULL = not recorded, `none` = no attachment, `attachment` = `attachment_id` plus `attachment_name`, a snapshot the server takes when the attachment is chosen. Renames never rewrite past workouts.
- `personal_records.side` keeps left and right records apart.
- Counting, volume, comparison and progression rules: `src/lib/domain/sides.ts`. In short: a pair is one set (½ when one side is done), volume is each side's own load × reps added up, each side is compared with the same side, and a shared load increase needs both sides to earn it. Only a session with the same attachment, or one where neither session recorded an attachment, is comparison and progression evidence; "not recorded" against a recorded attachment is unknown and never matches.
- RPCs: `ensure_starter_attachments()`, `remove_attachment(id)` (deletes when unused, archives when history uses it).

## Warm-ups and drop sets (migration 013)

- `set_logs.kind` is `warmup`, `working` or `drop`. Only `working` rows are planned sets: completion, comparisons, progression, records and working-set volume read them and nothing else. Warm-up work is shown on its own ("not counted").
- `set_logs.working_no` (migration 018): a working set's 1-based number within its exercise and stream (together / sides), assigned by `finish_workout` before unfinished sets are removed, so a skipped set leaves a gap. Null for older rows and live sets, which are numbered by order. `save_session_edit` leaves it unchanged.
- A drop set is a working set followed by drop segments: rows with `kind = 'drop'` and `drop_parent_id` pointing at the working set (same exercise in the same workout; deleting the parent deletes its segments). Each segment has its own load, reps, RIR, completion and, under a left/right parent, its own sides. Loads are entered by the user; nothing is suggested or derived from a percentage.
- The sequence counts as one planned set. Completed drop work is drop volume: summaries show "total volume = working + drops", and charts of working volume never include it.
- `finish_workout` refuses a completed drop under a set that isn't completed; `save_session_edit` takes `drop_parent_id` per set and requires each drop to follow a working set of its exercise. Rules: `src/lib/domain/drops.ts`.

## Starting energy (migration 015)

- `workout_sessions.energy_rating` is an optional, self-reported 1–10 rating of how energetic the user felt when the workout started (1 = exhausted, 10 = full of energy). It is not RIR, effort or workout difficulty.
- NULL means not answered: skipped, a workout logged for a past day without a rating, or any workout from before 015. There is no default.
- Asked before a workout starts today (Skip starts without one); editable from the workout options and in History. It is written with a plain owner update, so `finish_workout` and `save_session_edit` leave it alone.
- Nothing reads it to change progression, recommendations or records. Labels: `src/lib/domain/energy.ts`.

## Running (migration 016)

- Runs live in their own tables and never in `set_logs`, so they can't reach lifting volume, working-set counts, comparisons, progression or records (all of which read `set_logs` / `set_history`).
- `template_runs` is the plan: `target_kind` open / time / distance / intervals, with exactly that kind's fields (`target_duration_s`, `target_distance_m`, or `interval_count` + `interval_work_s` **or** `interval_work_m` + optional `interval_recovery_s`), optional `setting` (outdoor / treadmill), `optional`, `notes`. Runs share the template's position space with its exercises.
- `session_runs` is what happened: `prescribed` (the plan copied at start, `{}` for an unplanned run) and the results `duration_s` (required to complete), `distance_m` (optional; missing stays null), `effort` 1–10, `intervals_done`, `setting` (null = not recorded), `notes`, `completed`. Client-generated ids, autosaved like sets. A completed run faster than 11 m/s is refused as an entry error.
- Pace is derived, never stored, and only when both distance and duration exist. No calories, GPS or heart rate. Distances are metres; `profiles.distance_unit` (km / mi) is display only. Rules: `src/lib/domain/running.ts`.
- RPCs: `start_run_on(started_at)` starts a standalone run; `start_workout_on` copies a template's runs; `finish_workout` accepts a workout with only runs done and removes runs not marked done; `save_session_edit(…, p_runs)` edits runs in History (NULL leaves them untouched; exercises may carry `position` so the shared order survives); `create_program_from_import` accepts `{"kind": "run", …}` items.

## Community (migrations 019–021)

Everything social is opt-in and lives under More → Community. Other people never get a policy on any private table above; they read only what the functions and RLS below allow.

- `gyms`: one row per **branch** (name, chain, address, city, country). Shared directory, readable by signed-in users, written only by `add_gym()`, which normalises name + address + city and returns the existing branch instead of a duplicate. `verified` is false unless set by an admin; the app labels unverified gyms "Unofficial community".
- `gym_memberships`: at most one gym per user (owner-only). `discoverable` is separate, off by default, and reset to off whenever `gym_id` changes. `gym_people(gym)` returns only opted-in members of the caller's own branch (display name and relationship, nothing else), minus blocks. `gym_counts(gym)` returns counts the caller may see.
- `friend_requests` (pending / accepted / declined / cancelled), `friendships` (`user_a < user_b`), `blocks` (visible to the blocker only), `friend_invites` (single-use links, 7 days). Requests to strangers only work for opted-in members of the caller's gym; one pending per pair; 30-day wait after a decline; no third request after two declines; sending back accepts. Blocking removes the friendship, cancels requests and open training invitations (trigger `on_block`).
- `reports` (user / gym / message / post / comment, reason, details). Readable by the reporter only (to hide what they reported); review happens in the Supabase dashboard (`status` → `actioned` / `dismissed`). An account with open reports from 3 different people is restricted: no requests, invites, messages, posts, comments or reactions until reviewed.
- `conversations` + `conversation_state` (last read, muted) + `messages`: one-to-one, friends only. `send_message(id, to, body)` uses a client id so retries never duplicate. Unfriending keeps history but stops sending; blocking stops sending immediately. Realtime is enabled on `messages` and `training_invites` and limited by the same RLS. Not end-to-end encrypted.
- `training_invites`: gym (id + name snapshot), `starts_at` (UTC) + `time_zone` (IANA), optional workout name and note, status pending / accepted / declined / cancelled, `awaiting_id` (who must answer), `version` (stale answers are refused). Proposing a new time flips who must answer and needs acceptance. Nothing creates a workout.
- `posts` (`workout` snapshot or `buddy` invitation) with an explicit `audience`: `friends`, or `gym` (the author's gym at posting time). Visibility is re-checked on every read (friendship or both currently members of that gym, no block, not reported by the viewer). Snapshots are built by `workout_share_snapshot()` from completed working sets and the author's toggles (loads, reps, duration, runs); notes, bodyweight, measurements, energy and shortfall reasons are never included. Deleting the source workout deletes its posts; editing it doesn't change them. `post_reactions` (one per person, fixed emoji set) and `post_comments` (post authors can remove any comment on their post).
- Rate limits (rolling 24 h unless noted): 20 friend requests, 10 invite links, 5 new gyms, 10 reports, 30 messages a minute / 1000 a day, 20 training invitations, 20 posts, 30 comments an hour.

## Weighted bodyweight movements

For weighted pull-ups and dips, `set_logs.weight_kg` is the **external added load**. Bodyweight is recorded on the session (`workout_sessions.bodyweight_kg`, copied from the profile at start). Records and charts for these movements use external load and say so. Total system load (bodyweight + added) can be derived from both fields but is never mixed into external-load records.

## Interoperability

- Full JSON export (`/api/export?format=json`) contains every table above, keyed by stable IDs, with `format: "forma-export", version: 1`.
- CSV export flattens sets with workout and exercise names for spreadsheets.
- A future personal dashboard can read the same database with its own RLS-aware client, or through an authenticated API built on `src/lib/data`, which takes any Supabase client and contains no UI code.
