// Renders the catalog as the SQL upsert embedded in the catalog migration.
// The catalog test compares this output with the migration, so the two cannot drift apart.
import { CATALOG, CATALOG_VERSION, type CatalogExercise } from "./catalog";

export const SQL_BEGIN = `-- BEGIN GENERATED CATALOG v${CATALOG_VERSION} (src/lib/catalog/catalog.ts; do not edit by hand)`;
export const SQL_END = "-- END GENERATED CATALOG";

const lit = (s: string | null) => (s == null ? "null" : `'${s.replace(/'/g, "''")}'`);
const arr = (a: string[]) => (a.length ? `array[${a.map(lit).join(",")}]` : "array[]::text[]");

function row(e: CatalogExercise) {
  return `  (${[
    lit(e.slug), CATALOG_VERSION, lit(e.name), arr(e.aliases), lit(e.group), arr(e.primary), arr(e.secondary),
    lit(e.equipment), lit(e.category), lit(e.loadType), lit(e.weightEntry), lit(e.progression), e.e1rm,
    e.sets, e.repMin, e.repMax, e.restS, e.incrementKg, lit(e.instructions), lit(e.notes),
  ].join(", ")})`;
}

export function catalogSql(): string {
  return [
    SQL_BEGIN,
    "insert into public.exercise_catalog (slug, catalog_version, name, aliases, muscle_group, primary_muscles, secondary_muscles,",
    "  equipment, category, load_type, weight_convention, progression, e1rm_eligible, default_sets, default_rep_min, default_rep_max,",
    "  default_rest_s, increment_kg, instructions, notes)",
    "select slug, catalog_version, name, aliases, muscle_group, primary_muscles, secondary_muscles, equipment::public.equipment_type,",
    "  category::public.exercise_category, load_type::public.load_type, weight_convention, progression::public.progression_strategy,",
    "  e1rm_eligible, default_sets, default_rep_min, default_rep_max, default_rest_s, increment_kg, instructions, notes",
    "from (values",
    CATALOG.map(row).join(",\n"),
    ") as v(slug, catalog_version, name, aliases, muscle_group, primary_muscles, secondary_muscles, equipment, category, load_type,",
    "  weight_convention, progression, e1rm_eligible, default_sets, default_rep_min, default_rep_max, default_rest_s, increment_kg,",
    "  instructions, notes)",
    "on conflict (slug) do update set",
    "  catalog_version = excluded.catalog_version, name = excluded.name, aliases = excluded.aliases,",
    "  muscle_group = excluded.muscle_group, primary_muscles = excluded.primary_muscles,",
    "  secondary_muscles = excluded.secondary_muscles, equipment = excluded.equipment, category = excluded.category,",
    "  load_type = excluded.load_type, weight_convention = excluded.weight_convention, progression = excluded.progression,",
    "  e1rm_eligible = excluded.e1rm_eligible, default_sets = excluded.default_sets,",
    "  default_rep_min = excluded.default_rep_min, default_rep_max = excluded.default_rep_max,",
    "  default_rest_s = excluded.default_rest_s, increment_kg = excluded.increment_kg,",
    "  instructions = excluded.instructions, notes = excluded.notes;",
    SQL_END,
  ].join("\n");
}
