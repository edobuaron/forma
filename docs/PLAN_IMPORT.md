# Importing a trainer's plan

Programs → **Import plan** (`/programs/import`) turns a written plan into a new program:
upload or paste → review the extracted draft → resolve what's missing or ambiguous → summary → create.

## Sources

| Source | How it's read | Leaves the device? |
|---|---|---|
| Pasted text or table | In the browser. Tabs (spreadsheet copy), Markdown pipes, semicolons and commas are detected; anything else is read one exercise per line, with headings ("Day 1", "Upper", lines ending in `:`) starting a workout. | No |
| `.csv`, `.tsv`, `.txt` (≤ 256 KB) | Same as pasted text. | No |
| `.xlsx` (≤ 2 MB) | In the browser (`readXlsx`): shared/inline strings, numbers, vertically merged cells filled down, hidden sheets skipped, formulas use their cached value. Several sheets with a header row are read as one workout per sheet. | No |
| PDF (≤ 10 MB), JPEG/PNG/WebP (≤ 5 MB) | Needs an external AI/OCR provider. **Off by decision (2026-10-31): CSV and Excel first.** The file picker offers only CSV, Excel and text, and a PDF or photo chosen anyway gets a message pointing to Paste, CSV/Excel or manual entry. | Only with a provider, and only after the user confirms a disclosure |

The column mapping (and sheet and header row) can be changed on the review screen; the table is then read again.

## Interpretation rules (`src/lib/plan-import/notation.ts`)

- RPE and RIR are separate fields and never converted. An unlabelled effort number ("8", "@8") is a question with both answers offered.
- Minutes and seconds: units in the cell (`90s`, `90"`, `2'`, `1'30"`, `1:30`, `2 min`, `minuti`) or the header (`Rest (min)`) are used. A bare number is a question, unless only one reading is a valid rest (0–30 min): "90" can only be seconds, and that is stated.
- "3×10 each side" = 3 planned sets, reps per side (`per_side`), never 6 sets.
- Different reps per set ("3×12/10/8", "12-10-8") is a question, never averaged. A rep, rest, effort or load range asks which end to use.
- Decimal commas are read ("62,5 kg"); pounds are converted to kg (the original stays visible). Percentages of 1RM are never converted.
- Warm-up sets ("2 warm-up sets", "+2 WU"), drop sets (count and which sets), supersets (`A1`/`A2` labels shared by two or more exercises), tempo and "optional" are recognised. A drop set without a count or scope is a question; no weights are ever suggested.
- Anything Forma can't represent (rest-pause, myo-reps, clusters, timed sets, AMRAP, EMOM, …) stays in the exercise's notes and is flagged. Timed sets and AMRAP need reps entered before import.
- Unknown text in a sets/reps cell is kept in notes ("As written: …") and flagged.

## Exercise matching (`match.ts`)

Against the user's own library first, then the built-in catalog. Only an exact name or alias is used without asking.
Abbreviations and common non-English names (DB, BB, RDL, OHP, *panca piana*, *rematore*, …) or the same words in another order are **proposed** and need confirmation. Anything merely similar is offered as a candidate and never chosen. Archived exercises are never auto-picked. "Choose" opens the library; "Create custom exercise" opens the normal exercise form prefilled with the name. A catalog choice is copied into the library when the program is created.

## Review, validation and creation

- Each value is marked as read from the plan, interpreted (dashed) or missing/needs an answer (red). The original cells and their location (`Sheet!B4`, `Line 12`, `Page 1, row 4`) are shown per exercise.
- Required before import: a confirmed exercise, sets (1–20), reps (1–100, min ≤ max), and every blocking question answered. Optional fields can stay empty; a missing rest uses the user's default rest and the summary says so. Rows can be left out.
- The draft autosaves to `plan_imports` (private, RLS) and to this device as a fallback, so it survives a failed read, a validation error or a closed tab.
- `create_program_from_import(import_id, program, make_active)` validates everything again, creates the program in one transaction, and returns the same program when retried with the same import id (double taps, lost responses). The client also ignores a second tap while the first is in flight.
- The new program is inactive unless the user ticks "Make this my active program" (pre-ticked only when they have no active program). Existing programs and history are never changed. No workouts, sets or personal records are created: a plan's numbers are prescriptions.

## Retention

- Source files are never stored. CSV/XLSX/text are read in the browser; a PDF or photo (once a provider exists) is held in memory for one request.
- A draft (which quotes the source) is deleted 30 days after its last change (`purge_expired_plan_imports()`, run whenever anyone opens the import page) or when the user deletes it. When the program is created the draft is cleared at once; only the import id and the program it created are kept, for 30 days, so a retry can't create a duplicate.

## PDFs and photos (not enabled)

`/api/plan-import/extract` exists but returns `503 not_configured`: `IMPLEMENTED_PROVIDERS` is empty, so no setting can turn it on. When a provider is approved:

- The adapter goes in `src/lib/plan-import/` and the provider's name is added to `IMPLEMENTED_PROVIDERS`. Credentials are server-side only (Vercel environment variables, e.g. `PLAN_IMPORT_AI_PROVIDER` and the provider's key), never `NEXT_PUBLIC_*`.
- The provider only transcribes, into `TranscriptionSchema` (strict zod; any mismatch rejects the whole reply). `TRANSCRIPTION_PROMPT` says the document is untrusted data. The reply goes through the same notation rules and review as a pasted table, and the server validates the program again. The model never writes to the database.
- The upload is checked for type, size and magic bytes before anything is sent.
