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
| `template_exercises` | Planned exercise in a template | sets, rep_min, rep_max, rest_s, target_rir, optional, notes |
| `workout_sessions` | A performed workout | `status` in_progress / completed / discarded (max one in progress), started/ended, notes, bodyweight snapshot |
| `session_exercises` | Exercise performed in a session | `prescribed` snapshot, `substituted_for`, notes |
| `set_logs` | One set | `kind` warmup / working, `weight_kg` (**added** weight for bodyweight movements), `assistance_kg` (assisted movements), reps, rir, completed, completed_at |
| `body_measurements` | Dated body metrics | one row per user per day |
| `personal_records` | Derived PRs | recomputed from history after a workout or an edit; can always be rebuilt |
| `dismissed_recommendations` | Dismissed suggestions/insights | keyed by rule + evidence session, so a dismissal expires when new evidence appears |
| `attachments` | Cable attachments (migration 011) | private per user; starter list seeded once (`profiles.attachments_seeded_at`); `archived_at` when history uses one that was removed |

## Read model and RPCs

- `set_history` (view, `security_invoker`): flat join of sets with their session and exercise. Used for analytics and export.
- `recent_exercise_history(exercise_ids, sessions, exclude_session)`: last N completed sessions per exercise. Powers previous-session comparison and recommendations. When a session is excluded, only sessions that started before it count, so a backdated workout compares against what came before it.
- `start_workout_on(template_id, name, started_at)`: atomically creates a session, its exercises (with prescription snapshot) and empty sets. `started_at` defaults to now; a past date logs a workout for that day (future dates are rejected). `start_workout(template_id, name)` is kept as a wrapper that starts now.
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
- A drop set is a working set followed by drop segments: rows with `kind = 'drop'` and `drop_parent_id` pointing at the working set (same exercise in the same workout; deleting the parent deletes its segments). Each segment has its own load, reps, RIR, completion and, under a left/right parent, its own sides. Loads are entered by the user; nothing is suggested or derived from a percentage.
- The sequence counts as one planned set. Completed drop work is drop volume: summaries show "total volume = working + drops", and charts of working volume never include it.
- `finish_workout` refuses a completed drop under a set that isn't completed; `save_session_edit` takes `drop_parent_id` per set and requires each drop to follow a working set of its exercise. Rules: `src/lib/domain/drops.ts`.

## Weighted bodyweight movements

For weighted pull-ups and dips, `set_logs.weight_kg` is the **external added load**. Bodyweight is recorded on the session (`workout_sessions.bodyweight_kg`, copied from the profile at start). Records and charts for these movements use external load and say so. Total system load (bodyweight + added) can be derived from both fields but is never mixed into external-load records.

## Interoperability

- Full JSON export (`/api/export?format=json`) contains every table above, keyed by stable IDs, with `format: "forma-export", version: 1`.
- CSV export flattens sets with workout and exercise names for spreadsheets.
- A future personal dashboard can read the same database with its own RLS-aware client, or through an authenticated API built on `src/lib/data`, which takes any Supabase client and contains no UI code.
