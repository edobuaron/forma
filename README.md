# Forma

A personal workout tracker built for fast set logging at the gym, live comparison with your last session, rules-based progressive overload, and strength analytics you can trust.

Next.js 15 · React 19 · TypeScript · Tailwind CSS v4 · shadcn-style components · Supabase (Postgres, Auth, Row Level Security) · Recharts · installable PWA.

- Architecture, design system and phase plan: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Database tables and conventions: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)

## What's in this release

| Area | What works |
|---|---|
| Auth | Email + password, magic link, protected routes, sign-out |
| Program | Your 4-day program (Push / Pull / Lower / Upper + Muscle-Up) and 22 exercises, seeded automatically on sign-up. No performance numbers are preloaded. |
| Active workout | Elapsed time, prescribed sets/reps/rest, suggested load, previous session per set, editable weight/reps/RIR, one-tap set completion, warm-up sets, add/remove sets, add/remove/replace/reorder exercises, exercise and workout notes, auto rest timer (+/−15 s, skip), autosave with resume, finish and discard |
| Live comparison | Each completed set is compared with the same set last time: "+1 rep", "+2.5 kg", "Matched", "−2 reps", or "Heavier · new baseline" when load and reps move in opposite directions. The previous session opens from the exercise card. |
| Progression | Deterministic, exercise-aware rules (double progression, reps-first for lateral raises and rear delts, bodyweight reps, no load progression for skill work). Suggestions explain themselves and can be dismissed. |
| Summary | Duration, sets, volume, genuine PRs, comparison with last session, next-time suggestion per exercise |
| History | Month calendar (completed / scheduled / skipped / rest), session list, full editing of past workouts (records are recomputed) |
| Exercise library | Create, edit and archive exercises: muscles, equipment, category, load type, defaults, increment, exact available loads, weight convention, progression strategy, e1RM eligibility, technique notes |
| Exercise pages | Progress chart (e1RM, top set, reps at top load, volume, total reps; 4W to All), bests, best reps at each load, heaviest load for N reps, last vs previous session, PRs, history, recommendation |
| Programs | Edit templates, schedule days, sets/reps/rest/RIR, optional exercises, reorder, substitute, duplicate workouts and programs, version history with change notes |
| Analytics | Exercise progress, weekly volume, workouts per week and adherence, weekly sets per muscle group, exercise frequency, pull-up / dip / muscle-up progression, monthly and yearly totals, bodyweight |
| Insights | Conservative, minimum-data rules: declining performance across 3 comparable sessions, plateaus, frequent RIR 0, weekly volume spikes, missed sessions. Never diagnostic. Dismissable. |
| Body | Bodyweight and circumferences, trends, history table |
| Settings | Theme (light/dark/system), kg/lb, default rest, auto rest timer, rest sound, conservative progression |
| Export | Full JSON backup, CSV set log, CSV body measurements |
| PWA | Installable on iPhone and desktop, app icons, offline notice page |

## Run it locally

You need Node.js 20+ and a Supabase project (the free tier is fine).

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. **Apply the migrations**, in order. Choose one way:
   - *SQL editor:* paste and run each file in `supabase/migrations/` in filename order.
   - *CLI:* `npx supabase init` (keep the existing `supabase/` folder), `npx supabase link --project-ref <your-ref>`, then `npx supabase db push`.
3. **Configure auth** in Supabase under Authentication → URL Configuration:
   - Site URL: `http://localhost:3000` (change it to your Vercel URL later)
   - Redirect URLs: `http://localhost:3000/auth/callback` and `https://<your-app>.vercel.app/auth/callback`
4. **Set environment variables:**
   ```bash
   cp .env.example .env.local
   # fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (Project Settings → API)
   # set APP_TIMEZONE, e.g. Europe/Rome, so "today" and weeks match your clock
   ```
5. **Install and start:**
   ```bash
   npm install
   npm run dev
   ```
6. Open http://localhost:3000, choose **Create account**, and your program is ready.

Once your account exists, consider turning off public sign-ups (Authentication → Providers → Email → *Allow new users to sign up*). It's a personal app.

## Deploy to Vercel

1. Push this repository to GitHub and import it in Vercel. The framework preset is detected automatically.
2. Add the environment variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL` (your Vercel URL) and `APP_TIMEZONE`.
3. Deploy, then add the Vercel URL to Supabase's Site URL and Redirect URLs (step 3 above).
4. On iPhone, open the site in Safari, then Share → **Add to Home Screen**.

## Tests

```bash
npm test          # 39 unit tests: comparison, progression, loads, PRs, analytics, insights
npm run typecheck
npm run test:db   # migrations + RLS + workout flow on a throwaway local Postgres
```

`npm run test:db` needs `psql` and a local Postgres it can create databases on, e.g. `PGHOST=localhost PGUSER=postgres npm run test:db`. It installs a minimal stand-in for Supabase's `auth` schema, applies every migration, then checks: seeding, per-user isolation under RLS, ownership checks across tables, idempotent set upserts, validation constraints, one-workout-in-progress, history surviving template deletion, and program versioning.

## How the important parts work

**Autosave and recovery.** Every edit in the active workout becomes an idempotent upsert keyed by a client-generated UUID, so a double tap or a retry can't create a duplicate set. Writes are batched every ~400 ms, retried with backoff, and the pending queue is mirrored to `localStorage`. If you close the tab or lose signal mid-workout, the queue replays the next time the workout opens. The database is the source of truth, and `localStorage` is only a buffer.

**History is never rewritten by program edits.** Starting a workout snapshots the prescription (sets, rep range, rest, RIR) into the session. Editing or deleting templates afterwards doesn't touch past workouts, and exercises are archived rather than deleted.

**Comparisons are conservative.** Sets are paired by working-set number, and warm-ups are ignored. Same load means reps decide. Same reps means load decides. When load goes up and reps go down, a lift that suits an e1RM estimate (Epley, at most 12 reps) can be called "stronger" or "similar strength". Anything else is shown neutrally as a new baseline, never as "below".

**Progression rules** (`src/lib/domain/progression.ts`):
- No history: no load is invented. The app asks you to find a weight with about 2 reps in reserve.
- Incomplete last session: repeat the load.
- At least 2 total reps below the previous session at the same load: hold. One session isn't a trend.
- Below the rep range two sessions running: *suggest* a lighter available load. Nothing changes automatically.
- Not all sets at the top of the range: keep the load and add a rep to each set that isn't there yet (10/9/8 → aim 10/10/9).
- All sets at the top but at RIR 0, with conservative mode on: repeat once more before adding load.
- Reps-first exercises (lateral raises, rear delts): the top of the range must be hit in two consecutive sessions.
- Increases use the next load that actually exists, from your exact available-load list if set, otherwise the increment grid. If nothing heavier exists, the app says so.
- Bodyweight movements: add reps, or the smallest added load. Skill work: never auto-progressed.

## Honest limitations

- **Not offline-first.** The app tolerates brief signal loss during a workout (edits queue on the device and sync later), but pages need a connection to load. Full offline mode with conflict handling is planned for Phase 3.
- The rest timer runs while the app is open. iOS pauses web pages in the background, so the time stays correct when you return (it's wall-clock based), but there's no lock-screen alert yet. Web push is planned for Phase 3.
- Machine and cable weights are compared only against the same exercise. If your gym has two different cable stacks, create two exercises.
- Days and weeks are bucketed in `APP_TIMEZONE`. If you travel, dates follow that setting, not your phone.

## Project layout

```
src/lib/domain/      pure business logic + tests (no I/O, reusable by a native app or API)
src/lib/data/        data access layer: queries, mutations, autosave queue, dashboard composition
src/lib/supabase/    Supabase clients (browser, server, middleware)
src/components/      UI: ui/ primitives, workout/, charts/, exercises/, programs/, history/, …
src/app/             routes (App Router); /api/export for backups
supabase/migrations  schema, RLS, seed, history view, RPCs
supabase/tests       database tests
```
