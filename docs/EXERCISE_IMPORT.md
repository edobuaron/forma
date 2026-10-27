# Exercise CSV import

Exercises → Import accepts a CSV file (or pasted text) and shows a preview before anything is saved. Download the template from the import page or use [`public/exercise-import-template.csv`](../public/exercise-import-template.csv).

## Format

- UTF-8, comma-separated, first row is the header. Quote cells that contain commas, quotes or line breaks (`"like, this"`; a quote inside is `""`).
- At most 500 rows and 256 KB per file.
- Only `name` is required. Empty cells use the defaults below. Unknown columns are ignored and listed in the preview.
- Lists (`aliases`, muscles) are separated by `;` (or `|`).

| Column | Values | Default when empty |
|---|---|---|
| `name` | Up to 120 characters. Can't start with `=`, `+`, `-` or `@`. | required |
| `aliases` | Other names, for search | none |
| `equipment` | barbell, dumbbell, cable, machine, smith, bodyweight, other | other |
| `load_type` | external, bodyweight, weighted (bodyweight + added), assisted | bodyweight if equipment is bodyweight, else external |
| `weight_entry` | What the logged number means: `total` (bar included), `per_dumbbell`, `per_side`, `stack`, `added` (0 = bodyweight only), `assistance` (less = harder) | from equipment and load type (dumbbell → per dumbbell, cable/machine → stack, bodyweight → added, assisted → assistance, else total) |
| `primary_muscles` | chest, upper_chest, front_delts, side_delts, rear_delts, lats, upper_back, traps, biceps, triceps, forearms, abs, spinal_erectors, glutes, quads, hamstrings, adductors, calves (labels like "Upper chest" also work) | none (a warning: the exercise won't count toward weekly sets per muscle) |
| `secondary_muscles` | same | none |
| `category` | compound, isolation, bodyweight, weighted bodyweight, skill | from load type |
| `sets`, `rep_min`, `rep_max`, `rest_seconds` | whole numbers (1–20, 1–100, 1–100, 0–1800) | 3, 8, 12, 90 (120 for compound) |
| `increment_kg` | smallest load jump in kg (0 < x ≤ 50) | a generic default, labelled "generic" until you change it |
| `e1rm` | yes / no. Only compound exercises with external load. | no |
| `instructions`, `notes` | plain text, up to 1000 characters | none |

Progression is set conservatively from the category: skill work is never auto-progressed, bodyweight work progresses by reps, everything else uses double progression. Change it per exercise afterwards.

## Validation and duplicates

- Contradictions are row errors, e.g. `assisted` with any weight entry other than `assistance`, `per_dumbbell` without dumbbells, or `e1rm=yes` on an isolation exercise.
- A row whose name matches an exercise you already have (archived included) is a duplicate. Case, punctuation, spacing and simple plurals are ignored, so "Lat Pulldowns" matches "Lat Pulldown". Duplicates are skipped and the existing exercise is never changed. Rename the row in the preview to import it as a separate exercise.
- A row that matches a catalog exercise is flagged; adding it from the catalog keeps the catalog's settings.
- Rows with errors are skipped. You can also skip valid rows. Importing is all-or-nothing on the server, and re-importing the same file adds nothing.
- Text is cleaned of control characters and only ever shown as text.
