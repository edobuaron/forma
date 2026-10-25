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
| `/workout` | Start a workout (from schedule, any template, or empty) or resume one in progress |
| `/workout/[id]` | **Active workout** — the core screen |
| `/workout/[id]/summary` | Post-workout summary |
| `/history` | Calendar + list of sessions |
| `/history/[id]` | Session detail, editable to correct mistakes |
| `/exercises` | Exercise library |
| `/exercises/[id]` | Exercise progress page: chart, bests, PRs, history, recommendation |
| `/programs` | Programs; `/programs/[id]` edit templates, schedule, exercises |
| `/analytics` | Charts across exercises, volume, muscle-group sets, consistency, body |
| `/body` | Body measurements |
| `/settings` | Theme, units, rest defaults, timer, progression prefs, export |

## 4. Design system

- **Type**: Geist Sans (UI, bundled locally) with tabular numerals for every number; tight tracking on headings. Scale 12/13/14/16/20/24/32/44.
- **Color**: neutral zinc scale. Light: `#FAFAF9` background, white cards, hairline borders. Dark: `#0A0A0B` background, `#141416` cards, low-contrast borders. **One accent**: a restrained blue-indigo (`oklch(0.58 0.17 262)`), used for primary actions, active state, and the primary chart series only. Positive/negative deltas use muted green/amber text, never filled blocks.
- **Shape & space**: 4px grid; card radius 16px, controls 12px; 44px minimum touch target, 56px for set-logging controls.
- **Motion**: 150–200ms ease-out for state changes; no bouncing; respects `prefers-reduced-motion`.
- **Charts**: single-series in the accent, secondary series in neutral gray, no gridline clutter, hover/tap tooltips.
- **Components**: shadcn/ui-style primitives in `src/components/ui` (Button, Card, Input, Dialog/Sheet, Tabs, Switch, Badge) customised to the above.

## 5. Database model (Postgres)

All ids are `uuid`. All rows carry `user_id` with RLS. Weights are stored in **kg** (numeric); display converts to lb if chosen.

- `profiles` — user prefs: unit, default rest, auto rest timer, theme, bodyweight.
- `exercises` — user-owned library: name, muscles (primary/secondary arrays), equipment, `category` (compound / isolation / bodyweight / weighted_bodyweight / skill), `load_type` (external / bodyweight / weighted_bodyweight / assisted), defaults, `increment_kg`, optional `available_loads_kg[]`, `progression` strategy, `e1rm_eligible`, notes, instructions, `archived_at`.
- `programs` — name, active flag, `version`.
- `program_versions` — JSON snapshot each time a program is changed (history & rollback).
- `workout_templates` — belongs to a program; `day_of_week` (0–6 or null), position, notes, warm-up notes.
- `template_exercises` — template × exercise with position, sets, rep range, rest, target RIR, optional flag, notes.
- `workout_sessions` — actual performed workout: status (in_progress / completed / discarded), started/ended, notes, bodyweight, links back to template/program (nullable, `on delete set null`).
- `session_exercises` — exercise performed, position, notes, `prescribed` JSON snapshot, `substituted_for` exercise.
- `set_logs` — position, kind (warmup / working), `weight_kg` (external load; for weighted pull-ups this is added weight), `assistance_kg`, `reps`, `rir`, `completed`, `completed_at`, notes.
- `body_measurements` — dated bodyweight and circumferences.
- `dismissed_recommendations` — rule key + evidence session; a dismissal lasts until new evidence arrives.

Seeding: a trigger on `auth.users` creates the profile and calls `seed_default_program(user_id)`, which loads Edoardo's 4-day program and exercise library with per-exercise increments. No performance data is preloaded (the +15 kg pull-up estimate is shown as a starting note only).

## 6. Domain logic (deterministic, unit-tested)

- **Comparison**: matches current set N to previous working set N of the same exercise. Reports `+reps at same load`, `+load at same reps`, `matched` or `below` only when one variable is held constant (or both move the same way). When load and reps move in opposite directions, an e1RM estimate (eligible lifts only, ±2% band) may report "stronger" or "similar strength"; otherwise the set is shown neutrally as a new baseline, never as a regression. Warm-ups are never compared.
- **Progression** (double progression default): all working sets at top of range with RIR ≥ 1 (or unrecorded) → suggest the next *available* load (respects increments and explicit load lists); otherwise hold load and target one more rep on the weakest set. Reps-first strategy for lateral raises etc. requires two consecutive sessions at the top before adding load. Bodyweight → add reps, then suggest adding load. Skill → never auto-progress; quality cues only. Below-recent-performance → hold.
- **e1RM**: Epley, labelled as an estimate; only for e1RM-eligible lifts and sets of ≤ 12 reps.
- **PRs**: heaviest load (eligible lifts), most reps at a given load (seen before), best e1RM; weighted pull-ups track external load; skill exercises record "first completed rep".
- **Insights** (first version shipped in the MVP): minimum 3 comparable sessions before any trend claim (4 for plateaus, 3 prior weeks for volume spikes); never diagnostic language; dismissable.

## 7. Phases

**MVP (this build)**: auth, themes, dashboard, preloaded program, exercise & template editing with versioning, active workout with autosave/resume, previous-session comparison, progression suggestions, session summary, history calendar + editing, exercise progress pages, analytics, a first set of recovery-aware insights, PRs, body measurements, JSON/CSV export, PWA install. Several Phase 2 items landed early because they fell out of the same data.

**Phase 2**: muscle-group volume trends over time with personal targets, richer recovery rules (bodyweight-adjusted pull-up trends, recovery time between similar sessions), rep-range-specific best charts, deeper summaries, JSON re-import.

**Phase 3**: offline-first with a sync queue + conflict resolution, web push rest notifications, muscle-up progression tracking, authenticated public API for the personal dashboard, native client if warranted.
