# Forma — Architecture, UX, Data Model & Plan

## 1. Platform decision

**PWA on Next.js is the right call.** One codebase serves iPhone (installed to home screen, full-screen, standalone) and desktop. The things a native app would add — background rest-timer notifications, Live Activities, HealthKit — are nice-to-haves, not blockers for logging sets. iOS 16.4+ supports web push for installed PWAs, so even rest notifications are reachable later.

The one real trade-off: iOS can evict a PWA's storage and suspends timers in the background. We handle this by (a) making Supabase the source of truth, (b) computing the rest timer and elapsed time from wall-clock timestamps rather than counters, so they're correct when you come back to the app.

If a native app is ever warranted, the domain logic (`src/lib/domain`) is pure TypeScript and the data layer talks to Postgres through Supabase, so a React Native/Expo client can reuse both unchanged.

## 2. System architecture

```
Browser / installed PWA
  ├─ React Server Components (pages read data server-side via Supabase SSR client)
  ├─ Client components (active workout, editors) write via supabase-js + RLS
  └─ Service worker: caches static assets only (no offline claims)

src/lib/domain/     pure, tested business logic — no I/O
  units, e1rm, comparison, progression, prs, insights, analytics
src/lib/data/       data access layer — every DB query lives here
src/lib/supabase/   client factories (browser, server, middleware)
src/app/            routes / UI
supabase/migrations SQL schema, RLS, seed function
```

- **Auth**: Supabase Auth (email + password, magic link). Middleware refreshes the session cookie and guards every route except `/login` and `/auth/*`.
- **Security**: every table carries `user_id` and has RLS `user_id = auth.uid()` for all operations. The anon key is safe to ship; there is no service-role key in the app.
- **Autosave**: the active workout keeps state in React, mirrors it to `localStorage` as a crash buffer, and writes each change to Postgres through a debounced, retrying write queue. All rows use client-generated UUIDs and **upserts**, so retries and double-taps can never create duplicate sets.
- **History preservation**: a session copies the prescription (sets, rep range, rest, RIR) from its template at start time into `session_exercises.prescribed`. Editing or deleting a template never changes past sessions. Exercises are soft-archived, never hard-deleted while history references them.
- **Interoperability**: stable UUIDs everywhere, plain relational tables, JSON + CSV export of everything, and a documented schema. A future personal dashboard can read the same Postgres (with its own RLS policies) or call an authenticated API built over `src/lib/data`.

## 3. Information architecture

Mobile: bottom tab bar (Today · Workout · History · Progress · More). Desktop: left sidebar, wider multi-column layouts.

| Route | Purpose |
|---|---|
| `/` | Dashboard: next workout, week strip, quick start, weekly completion & volume, recent PRs, trends, recommendations |
| `/workout` | Start any workout (any template, or empty) or resume one in progress. Workouts aren't tied to weekdays; the dashboard week strip and the History calendar open a day sheet for logging on a past day. |
| `/workout/[id]` | **Active workout** — the core screen |
| `/workout/[id]/summary` | Post-workout summary |
| `/history` | Calendar + list of sessions |
| `/history/[id]` | Session detail, editable to correct mistakes |
| `/exercises` | Exercise library |
| `/exercises/[id]` | Exercise progress page: chart, bests, PRs, history, recommendation |
| `/programs` | Programs; `/programs/[id]` edit templates and exercises |
| `/analytics` | Charts across exercises, volume, muscle-group sets, consistency, body |
| `/body` | Body measurements |
| `/settings` | Theme, units, rest defaults, timer, progression prefs, export |

## 4. Design system

- **Direction**: a confident athletic training app. Dark-first: deep navy page, blue-tinted panels that separate from the page by value; light mode is a cool blue-white with white panels. Tokens live in `src/app/globals.css`.
- **Colour has one job each**: vivid blue (`primary` fill, `accent` text/lines) for actions, selection, focus and load/volume charts; teal (`positive`, aliased as `done`) for completed sets, gains and consistency; amber (`negative`, aliased as `pending`) for attention and "below last time", never failure; violet (`record`) for personal records and body charts; red (`destructive`) for delete only. Contrast of every text colour on panels is ≥ 4.5:1 in both themes.
- **Training categories** (push, pull, legs, core, mixed) get a small marker colour (`cat-*`) from `src/lib/category.ts`: workouts by name, exercises by primary muscles. Markers are bars, dots or icon tiles, never fills, and are always paired with a name or label so meaning never depends on colour alone.
- **Type**: Geist Sans with tabular numerals; headings bold with tight tracking (page titles 30/36, panel titles 15 semibold); key figures use the `num` utility (tabular, 650 weight, tight).
- **Shape & space**: 4px grid; panels 18px radius, hero 24px, controls 12px; 44px minimum touch target, 56px for the primary start action.
- **Focus & motion**: one global `:focus-visible` outline in the ring blue; 150–260ms ease-out feedback (press scale, check pop); everything collapses under `prefers-reduced-motion`.
- **Charts**: one series colour chosen by what is measured, earlier weeks in neutral blue-gray, units stated in each panel subtitle.
- **Components**: shadcn-style primitives in `src/components/ui` (Button, Card, Badge, Segmented, Sheet, Switch, EmptyState, PageHeader, category markers).

## 5. Database model (Postgres)

All ids are `uuid`. All rows carry `user_id` with RLS. Weights are stored in **kg** (numeric); display converts to lb if chosen.

- `profiles` — user prefs: unit, default rest, auto rest timer, theme, bodyweight.
- `exercises` — user-owned library: name, muscles (primary/secondary arrays), equipment, `category` (compound / isolation / bodyweight / weighted_bodyweight / skill), `load_type` (external / bodyweight / weighted_bodyweight / assisted), defaults, `increment_kg`, optional `available_loads_kg[]`, `progression` strategy, `e1rm_eligible`, notes, instructions, `archived_at`.
- `programs` — name, active flag, `version`.
- `program_versions` — JSON snapshot each time a program is changed (history & rollback).
- `workout_templates` — belongs to a program; position, notes, warm-up notes. `day_of_week` is legacy and no longer used: any workout can be done on any day.
- `template_exercises` — template × exercise with position, sets, rep range, rest, target RIR, optional flag, notes.
- `workout_sessions` — actual performed workout: status (in_progress / completed / discarded), started/ended, notes, bodyweight, links back to template/program (nullable, `on delete set null`).
- `session_exercises` — exercise performed, position, notes, `prescribed` JSON snapshot, `substituted_for` exercise.
- `set_logs` — position, kind (warmup / working), `weight_kg` (external load; for weighted pull-ups this is added weight), `assistance_kg`, `reps`, `rir`, `completed`, `completed_at`, notes.
- `body_measurements` — dated bodyweight and circumferences.
- `dismissed_recommendations` — rule key + evidence session; a dismissal lasts until new evidence arrives.

Seeding: a trigger on `auth.users` creates the profile and seeds a sanitized, versioned starter program once (`seed_starter_program`, migration 010): structure only, copied from the catalog. No performance data, loads or estimates are preloaded.

## 6. Domain logic (deterministic, unit-tested)

- **Comparison**: matches current set N to previous working set N of the same exercise. Reports `+reps at same load`, `+load at same reps`, `matched` or `below` only when one variable is held constant (or both move the same way). When load and reps move in opposite directions, an e1RM estimate (eligible lifts only, ±2% band) may report "stronger" or "similar strength"; otherwise the set is shown neutrally as a new baseline, never as a regression. Warm-ups are never compared.
- **Progression** (double progression default): all working sets at top of range with RIR ≥ 1 (or unrecorded) → suggest the next *available* load (respects increments and explicit load lists); otherwise hold load and target one more rep on the weakest set. Reps-first strategy for lateral raises etc. requires two consecutive sessions at the top before adding load. Bodyweight → add reps, then suggest adding load. Skill → never auto-progress; quality cues only. Below-recent-performance → hold.
- **e1RM**: Epley, labelled as an estimate; only for e1RM-eligible lifts and sets of ≤ 12 reps.
- **PRs**: heaviest load (eligible lifts), most reps at a given load (seen before), best e1RM; weighted pull-ups track external load; skill exercises record "first completed rep".
- **Insights** (first version shipped in the MVP): minimum 3 comparable sessions before any trend claim (4 for plateaus, 3 prior weeks for volume spikes); never diagnostic language; dismissable.
- **Training focus**: no muscle group is special by default. A user can mark muscles as maintenance (`profiles.maintenance_muscles`, migration 012); Progress marks them and their volume-spike insight is worded against that choice. Load progression ignores it.

## 7. Phases

**MVP (this build)**: auth, themes, dashboard, preloaded program, exercise & template editing with versioning, active workout with autosave/resume, previous-session comparison, progression suggestions, session summary, history calendar + editing, exercise progress pages, analytics, a first set of recovery-aware insights, PRs, body measurements, JSON/CSV export, PWA install. Several Phase 2 items landed early because they fell out of the same data.

**Phase 2**: muscle-group volume trends over time with personal targets, richer recovery rules (bodyweight-adjusted trends for bodyweight movements, recovery time between similar sessions), rep-range-specific best charts, deeper summaries, JSON re-import.

**Phase 3**: offline-first with a sync queue + conflict resolution, web push rest notifications, skill progression tracking, authenticated public API for the personal dashboard, native client if warranted.
