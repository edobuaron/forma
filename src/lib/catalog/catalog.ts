// Forma exercise catalog — the versioned source of truth for built-in exercises.
//
// Written for Forma (no external catalog was imported), so there is no third-party licence or
// attribution to carry. Names are generic exercise names; instructions are short, original cues.
// No images or videos.
//
// The database copy (public.exercise_catalog) is generated from this file:
//   node scripts/generate-catalog-sql.ts > /tmp/catalog.sql
// and src/lib/catalog/__tests__/catalog.test.ts fails if the migration drifts from it.
// To change the catalog: edit this file, bump CATALOG_VERSION, and ship the regenerated SQL in a
// NEW migration. Existing users' exercises are never changed by a catalog update.
//
// This file must not import anything (it is run directly by Node for the generator).

export const CATALOG_VERSION = 1;

export type CatalogEquipment = "barbell" | "dumbbell" | "cable" | "machine" | "smith" | "bodyweight" | "other";
export type CatalogCategory = "compound" | "isolation" | "bodyweight" | "weighted_bodyweight" | "skill";
export type CatalogLoadType = "external" | "bodyweight" | "weighted_bodyweight" | "assisted";
export type CatalogProgression = "double_progression" | "reps_first" | "bodyweight_reps" | "skill" | "none";
/**
 * What the number in the weight field means.
 *  total        — everything on the bar or machine, bar included
 *  per_dumbbell — one dumbbell (a pair of 20 kg dumbbells is logged as 20)
 *  per_side     — plates on one side
 *  stack        — the number on the selectorised stack / pin
 *  added        — weight added to your bodyweight (belt, vest); 0 = bodyweight only
 *  assistance   — counterweight or band help; less assistance = harder
 */
export type WeightEntry = "total" | "per_dumbbell" | "per_side" | "stack" | "added" | "assistance";

export interface CatalogExercise {
  slug: string;
  name: string;
  aliases: string[];
  group: CatalogGroup;
  primary: string[];
  secondary: string[];
  equipment: CatalogEquipment;
  category: CatalogCategory;
  loadType: CatalogLoadType;
  weightEntry: WeightEntry;
  progression: CatalogProgression;
  /** Estimated 1RM is shown only for heavy external-load compound lifts. */
  e1rm: boolean;
  sets: number;
  repMin: number;
  repMax: number;
  restS: number;
  /** GENERIC default step, not your gym's. Users are prompted to set their real increment. */
  incrementKg: number;
  instructions: string | null;
  /** Neutral weight-entry note. Never performance estimates or personal priorities. */
  notes: string;
}

export type CatalogGroup = "chest" | "shoulders" | "back" | "arms" | "legs" | "glutes_hinge" | "core" | "skill";

export const GROUP_LABELS: Record<CatalogGroup, string> = {
  chest: "Chest",
  shoulders: "Shoulders",
  back: "Back",
  arms: "Arms",
  legs: "Legs",
  glutes_hinge: "Hinge & glutes",
  core: "Core",
  skill: "Skill & assisted",
};

/** Generic increments per weight-entry convention. Clearly a default; every gym differs. */
export const GENERIC_INCREMENT_KG: Record<WeightEntry, number> = {
  total: 2.5,
  per_dumbbell: 2,
  per_side: 1.25,
  stack: 2.5,
  added: 1.25,
  assistance: 5,
};

export const WEIGHT_ENTRY_NOTE: Record<WeightEntry, string> = {
  total: "Log the total weight, bar included.",
  per_dumbbell: "Log the weight of one dumbbell.",
  per_side: "Log the plates on one side.",
  stack: "Log the number on the stack. Machines differ, so compare only on the same machine.",
  added: "Log only the weight you add (belt, vest or dumbbell). Enter 0 for bodyweight only.",
  assistance: "Log the assistance (counterweight or band). Less assistance means harder.",
};

type Spec = Partial<Omit<CatalogExercise, "slug" | "name" | "group">> & {
  primary: string[];
  equipment: CatalogEquipment;
  reps: [number, number];
  extraNote?: string;
};

/** The weight-entry convention implied by equipment and load type, used whenever none is given. */
export function defaultWeightEntry(equipment: CatalogEquipment, loadType: CatalogLoadType): WeightEntry {
  if (loadType === "assisted") return "assistance";
  if (loadType === "bodyweight" || loadType === "weighted_bodyweight") return "added";
  if (equipment === "dumbbell") return "per_dumbbell";
  if (equipment === "cable" || equipment === "machine") return "stack";
  return "total";
}

/** Conservative progression default: skill work never auto-progresses; bodyweight work adds reps. */
export function defaultProgression(category: CatalogCategory, loadType: CatalogLoadType): CatalogProgression {
  if (category === "skill") return "skill";
  if (loadType === "bodyweight") return "bodyweight_reps";
  return "double_progression";
}

let currentGroup: CatalogGroup = "chest";
const list: CatalogExercise[] = [];

function ex(slug: string, name: string, s: Spec) {
  const category = s.category ?? "isolation";
  const loadType = s.loadType ?? "external";
  const weightEntry = s.weightEntry ?? defaultWeightEntry(s.equipment, loadType);
  const note = [WEIGHT_ENTRY_NOTE[weightEntry], s.extraNote].filter(Boolean).join(" ");
  list.push({
    slug, name,
    aliases: s.aliases ?? [],
    group: currentGroup,
    primary: s.primary,
    secondary: s.secondary ?? [],
    equipment: s.equipment,
    category,
    loadType,
    weightEntry,
    progression: s.progression ?? defaultProgression(category, loadType),
    e1rm: s.e1rm ?? false,
    sets: s.sets ?? 3,
    repMin: s.reps[0],
    repMax: s.reps[1],
    restS: s.restS ?? (category === "compound" ? 120 : 90),
    incrementKg: s.incrementKg ?? GENERIC_INCREMENT_KG[weightEntry],
    instructions: s.instructions ?? null,
    notes: note,
  });
}
function group(g: CatalogGroup) { currentGroup = g; }

const C = "compound" as const;
const BW = { loadType: "bodyweight" as const, category: "bodyweight" as const, equipment: "bodyweight" as const };
const WBW = { loadType: "weighted_bodyweight" as const, category: "weighted_bodyweight" as const, equipment: "bodyweight" as const };
const ASSIST = { loadType: "assisted" as const, category: "bodyweight" as const };

// ---------------------------------------------------------------- chest
group("chest");
ex("barbell-bench-press", "Barbell Bench Press", { aliases: ["bench press", "flat bench", "bench"], primary: ["chest"], secondary: ["front_delts", "triceps"], equipment: "barbell", category: C, e1rm: true, reps: [5, 8], restS: 180, instructions: "Shoulder blades pinched, feet planted. Lower to mid-chest, press back over the shoulders." });
ex("incline-barbell-bench-press", "Incline Barbell Bench Press", { aliases: ["incline bench", "incline press"], primary: ["upper_chest"], secondary: ["front_delts", "triceps"], equipment: "barbell", category: C, e1rm: true, reps: [6, 10], restS: 150, instructions: "Bench at 30–45°. Lower to the upper chest with control." });
ex("decline-barbell-bench-press", "Decline Barbell Bench Press", { aliases: ["decline bench"], primary: ["chest"], secondary: ["triceps"], equipment: "barbell", category: C, reps: [6, 10], restS: 150 });
ex("close-grip-bench-press", "Close-Grip Bench Press", { aliases: ["cgbp", "close grip bench"], primary: ["triceps", "chest"], secondary: ["front_delts"], equipment: "barbell", category: C, e1rm: true, reps: [6, 10], restS: 150, instructions: "Hands about shoulder-width, elbows tucked." });
ex("dumbbell-bench-press", "Dumbbell Bench Press", { aliases: ["db bench", "flat dumbbell press"], primary: ["chest"], secondary: ["front_delts", "triceps"], equipment: "dumbbell", category: C, reps: [8, 12] });
ex("incline-db-press", "Incline Dumbbell Press", { aliases: ["incline db press", "incline dumbbell bench"], primary: ["upper_chest"], secondary: ["front_delts", "triceps"], equipment: "dumbbell", category: C, reps: [8, 12] });
ex("dumbbell-fly", "Dumbbell Fly", { aliases: ["db fly", "flat fly", "dumbbell flye"], primary: ["chest"], secondary: ["front_delts"], equipment: "dumbbell", reps: [10, 15], restS: 75, instructions: "Slight bend in the elbows; open to a comfortable stretch." });
ex("incline-dumbbell-fly", "Incline Dumbbell Fly", { aliases: ["incline db fly", "incline flye"], primary: ["upper_chest"], secondary: ["front_delts"], equipment: "dumbbell", reps: [10, 15], restS: 75 });
ex("machine-chest-press", "Machine Chest Press", { aliases: ["chest press", "seated chest press"], primary: ["chest"], secondary: ["front_delts", "triceps"], equipment: "machine", category: C, reps: [8, 12] });
ex("incline-machine-chest-press", "Incline Machine Chest Press", { aliases: ["incline chest press machine"], primary: ["upper_chest"], secondary: ["front_delts", "triceps"], equipment: "machine", category: C, reps: [8, 12] });
ex("pec-deck", "Chest Pec Deck", { aliases: ["pec deck", "machine fly", "butterfly"], primary: ["chest"], secondary: ["front_delts"], equipment: "machine", reps: [10, 15], sets: 2, restS: 75 });
ex("incline-smith-press", "Incline Smith Machine Press", { aliases: ["incline smith", "smith incline bench"], primary: ["upper_chest"], secondary: ["front_delts", "triceps"], equipment: "smith", category: C, e1rm: true, reps: [6, 10], restS: 120, extraNote: "Smith bars vary in weight; count the bar the same way every time.", instructions: "Bench at 30°. Lower to upper chest under control, press without locking out hard." });
ex("smith-bench-press", "Smith Machine Bench Press", { aliases: ["smith bench", "flat smith press"], primary: ["chest"], secondary: ["front_delts", "triceps"], equipment: "smith", category: C, reps: [6, 10], extraNote: "Smith bars vary in weight; count the bar the same way every time." });
ex("cable-fly", "Cable Fly", { aliases: ["cable crossover", "standing cable fly", "cable flye"], primary: ["chest"], secondary: ["front_delts"], equipment: "cable", reps: [10, 15], restS: 75, instructions: "Pulleys at shoulder height; bring the hands together in front of the chest." });
ex("low-to-high-cable-fly", "Low-to-High Cable Fly", { aliases: ["incline cable fly", "low cable fly"], primary: ["upper_chest"], secondary: ["front_delts"], equipment: "cable", reps: [12, 15], restS: 75 });
ex("push-up", "Push-Up", { aliases: ["pushup", "press-up", "press up"], primary: ["chest"], secondary: ["front_delts", "triceps", "abs"], ...BW, reps: [8, 20], restS: 75, instructions: "Body in a straight line; chest to just above the floor." });
ex("weighted-push-up", "Weighted Push-Up", { aliases: ["weighted pushup", "plate push-up"], primary: ["chest"], secondary: ["front_delts", "triceps"], ...WBW, reps: [6, 12] });
ex("straight-bar-dip", "Straight-Bar Dip", { aliases: ["straight bar dip", "bar dip"], primary: ["chest", "triceps"], secondary: ["front_delts"], ...BW, reps: [5, 8], sets: 2, restS: 90 });
ex("parallel-bar-dip", "Parallel-Bar Dip", { aliases: ["dip", "dips", "chest dip", "triceps dip"], primary: ["chest", "triceps"], secondary: ["front_delts"], ...BW, reps: [6, 12], instructions: "Lower until the shoulders are just below the elbows, as range allows." });
ex("weighted-dip", "Weighted Dip", { aliases: ["weighted dips", "weighted parallel bar dip"], primary: ["chest", "triceps"], secondary: ["front_delts"], ...WBW, reps: [5, 8], restS: 150 });
ex("assisted-dip-machine", "Assisted Dip (Machine)", { aliases: ["assisted dip", "gravitron dip"], primary: ["chest", "triceps"], secondary: ["front_delts"], ...ASSIST, equipment: "machine", reps: [6, 12] });

// ---------------------------------------------------------------- shoulders
group("shoulders");
ex("overhead-press", "Barbell Overhead Press", { aliases: ["ohp", "military press", "standing press", "shoulder press barbell"], primary: ["front_delts"], secondary: ["side_delts", "triceps", "upper_chest"], equipment: "barbell", category: C, e1rm: true, reps: [5, 8], restS: 150, instructions: "Glutes and abs braced; press in a straight line, head through at the top." });
ex("seated-shoulder-press", "Seated Shoulder Press", { aliases: ["seated dumbbell shoulder press", "db shoulder press", "seated db press"], primary: ["front_delts", "side_delts"], secondary: ["triceps"], equipment: "dumbbell", category: C, reps: [8, 12], sets: 2, restS: 120 });
ex("standing-dumbbell-shoulder-press", "Standing Dumbbell Shoulder Press", { aliases: ["standing db press"], primary: ["front_delts", "side_delts"], secondary: ["triceps", "abs"], equipment: "dumbbell", category: C, reps: [8, 12] });
ex("arnold-press", "Arnold Press", { aliases: ["arnold dumbbell press"], primary: ["front_delts", "side_delts"], secondary: ["triceps"], equipment: "dumbbell", category: C, reps: [8, 12] });
ex("machine-shoulder-press", "Machine Shoulder Press", { aliases: ["shoulder press machine", "seated machine press"], primary: ["front_delts", "side_delts"], secondary: ["triceps"], equipment: "machine", category: C, reps: [8, 12] });
ex("smith-shoulder-press", "Smith Machine Shoulder Press", { aliases: ["smith ohp", "smith overhead press"], primary: ["front_delts", "side_delts"], secondary: ["triceps"], equipment: "smith", category: C, reps: [6, 10], extraNote: "Smith bars vary in weight; count the bar the same way every time." });
ex("dumbbell-lateral-raise", "Dumbbell Lateral Raise", { aliases: ["lateral raise", "side raise", "db lateral"], primary: ["side_delts"], equipment: "dumbbell", progression: "reps_first", reps: [12, 20], restS: 60, incrementKg: 1, instructions: "Raise to about shoulder height, leading with the elbows." });
ex("cable-lateral-raise", "Cable Lateral Raise", { aliases: ["single-arm cable lateral", "cable side raise"], primary: ["side_delts"], equipment: "cable", progression: "reps_first", reps: [12, 20], sets: 4, restS: 75, incrementKg: 1.25, extraNote: "Add load only after reps are consistently at the top of the range.", instructions: "Lead with the elbow, raise to shoulder height, slow eccentric." });
ex("machine-lateral-raise", "Machine Lateral Raise", { aliases: ["lateral raise machine"], primary: ["side_delts"], equipment: "machine", progression: "reps_first", reps: [12, 20], restS: 60 });
ex("dumbbell-front-raise", "Dumbbell Front Raise", { aliases: ["front raise", "db front raise"], primary: ["front_delts"], equipment: "dumbbell", reps: [10, 15], restS: 60, incrementKg: 1 });
ex("dumbbell-rear-delt-fly", "Dumbbell Rear-Delt Fly", { aliases: ["reverse fly", "bent-over reverse fly", "rear delt raise"], primary: ["rear_delts"], secondary: ["upper_back"], equipment: "dumbbell", progression: "reps_first", reps: [12, 20], restS: 60, incrementKg: 1 });
ex("cable-rear-delt-fly", "Cable Rear-Delt Fly", { aliases: ["cable reverse fly", "rear delt cable fly"], primary: ["rear_delts"], secondary: ["upper_back"], equipment: "cable", progression: "reps_first", reps: [12, 20], sets: 2, restS: 60, incrementKg: 1.25 });
ex("reverse-pec-deck", "Reverse Pec Deck", { aliases: ["rear delt machine", "reverse machine fly"], primary: ["rear_delts"], secondary: ["upper_back"], equipment: "machine", progression: "reps_first", reps: [12, 20], restS: 60 });
ex("face-pull", "Cable Face Pull", { aliases: ["face pull", "rope face pull"], primary: ["rear_delts", "upper_back"], secondary: ["traps"], equipment: "cable", reps: [12, 20], restS: 60, instructions: "Rope at face height; pull toward the eyes, elbows high." });
ex("cable-upright-row", "Cable Upright Row", { aliases: ["upright row"], primary: ["side_delts", "traps"], secondary: ["biceps"], equipment: "cable", reps: [10, 15], restS: 75 });

// ---------------------------------------------------------------- back
group("back");
ex("pull-up", "Pull-Up", { aliases: ["pullup", "pull up", "bodyweight pull-up"], primary: ["lats", "upper_back"], secondary: ["biceps", "rear_delts"], ...BW, reps: [5, 10], restS: 120, instructions: "Start from a dead hang; chin over the bar without kipping." });
ex("weighted-pull-up", "Weighted Pull-Up", { aliases: ["weighted pullup"], primary: ["lats", "upper_back"], secondary: ["biceps", "rear_delts"], ...WBW, reps: [4, 6], restS: 180, instructions: "Dead hang start, chin over bar, no kipping." });
ex("chin-up", "Chin-Up", { aliases: ["chinup", "chin up", "underhand pull-up"], primary: ["lats", "biceps"], secondary: ["upper_back"], ...BW, reps: [5, 10], restS: 120 });
ex("weighted-chin-up", "Weighted Chin-Up", { aliases: ["weighted chinup"], primary: ["lats", "biceps"], secondary: ["upper_back"], ...WBW, reps: [4, 8], restS: 180 });
ex("assisted-pull-up-machine", "Assisted Pull-Up (Machine)", { aliases: ["assisted pull-up", "gravitron", "assisted pullup machine"], primary: ["lats", "upper_back"], secondary: ["biceps"], ...ASSIST, equipment: "machine", reps: [6, 12] });
ex("band-assisted-pull-up", "Band-Assisted Pull-Up", { aliases: ["banded pull-up", "band pull-up"], primary: ["lats", "upper_back"], secondary: ["biceps"], ...ASSIST, equipment: "bodyweight", reps: [5, 10], incrementKg: 5, extraNote: "Band ratings are approximate; use the same band labels each time." });
ex("lat-pulldown", "Cable Lat Pulldown", { aliases: ["lat pulldown", "pulldown", "wide-grip pulldown", "lat pull down"], primary: ["lats"], secondary: ["biceps", "upper_back"], equipment: "cable", category: C, reps: [10, 12], sets: 2, restS: 90 });
ex("close-grip-lat-pulldown", "Close-Grip Lat Pulldown", { aliases: ["neutral-grip pulldown", "v-bar pulldown", "close grip pulldown"], primary: ["lats"], secondary: ["biceps", "upper_back"], equipment: "cable", category: C, reps: [8, 12], restS: 90 });
ex("single-arm-cable-pulldown", "Single-Arm Cable Pulldown", { aliases: ["one-arm pulldown", "unilateral pulldown"], primary: ["lats"], secondary: ["biceps"], equipment: "cable", reps: [10, 15], restS: 75 });
ex("straight-arm-pulldown", "Straight-Arm Pulldown", { aliases: ["straight arm pushdown", "lat prayer", "cable pullover"], primary: ["lats"], equipment: "cable", reps: [10, 15], restS: 75 });
ex("machine-pulldown", "Machine Pulldown", { aliases: ["plate-loaded pulldown", "pulldown machine"], primary: ["lats"], secondary: ["biceps", "upper_back"], equipment: "machine", category: C, reps: [8, 12] });
ex("barbell-row", "Barbell Row", { aliases: ["bent-over row", "bb row", "bent over barbell row"], primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps", "spinal_erectors"], equipment: "barbell", category: C, e1rm: true, reps: [6, 10], instructions: "Hinge to ~45°, pull to lower ribs, keep the spine neutral." });
ex("pendlay-row", "Pendlay Row", { aliases: ["dead-stop row"], primary: ["upper_back", "lats"], secondary: ["rear_delts", "spinal_erectors"], equipment: "barbell", category: C, reps: [5, 8], restS: 150, instructions: "Each rep starts from the floor with a flat back." });
ex("one-arm-dumbbell-row", "One-Arm Dumbbell Row", { aliases: ["dumbbell row", "db row", "single-arm row"], primary: ["lats", "upper_back"], secondary: ["rear_delts", "biceps"], equipment: "dumbbell", category: C, reps: [8, 12] });
ex("chest-supported-dumbbell-row", "Chest-Supported Dumbbell Row", { aliases: ["incline dumbbell row", "seal row dumbbell"], primary: ["upper_back"], secondary: ["lats", "rear_delts", "biceps"], equipment: "dumbbell", category: C, reps: [8, 12] });
ex("t-bar-row", "T-Bar Row", { aliases: ["landmine row", "tbar row"], primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps"], equipment: "barbell", category: C, reps: [8, 12], extraNote: "Count plates only (not the bar) if that is how your gym labels it, and stay consistent." });
ex("seated-cable-row", "Seated Cable Row", { aliases: ["cable row", "low row", "seated row"], primary: ["upper_back", "lats"], secondary: ["biceps", "rear_delts"], equipment: "cable", category: C, reps: [8, 12], sets: 2, restS: 90 });
ex("machine-row", "Chest-Supported Machine Row", { aliases: ["machine row", "seated machine row"], primary: ["upper_back", "lats"], secondary: ["rear_delts", "biceps"], equipment: "machine", category: C, reps: [8, 12] });
ex("inverted-row", "Inverted Row", { aliases: ["bodyweight row", "australian pull-up", "ring row"], primary: ["upper_back"], secondary: ["lats", "biceps", "rear_delts"], ...BW, reps: [8, 15], restS: 90 });
ex("barbell-shrug", "Barbell Shrug", { aliases: ["shrug", "bb shrug"], primary: ["traps"], equipment: "barbell", reps: [10, 15], restS: 75 });
ex("dumbbell-shrug", "Dumbbell Shrug", { aliases: ["db shrug"], primary: ["traps"], equipment: "dumbbell", reps: [10, 15], restS: 75 });

// ---------------------------------------------------------------- arms
group("arms");
ex("barbell-curl", "Barbell Curl", { aliases: ["bb curl", "standing barbell curl", "straight bar curl"], primary: ["biceps"], secondary: ["forearms"], equipment: "barbell", reps: [8, 12], restS: 75 });
ex("ez-bar-curl", "EZ-Bar Curl", { aliases: ["ez curl", "ez bar curl"], primary: ["biceps"], secondary: ["forearms"], equipment: "barbell", reps: [8, 12], restS: 75 });
ex("dumbbell-curl", "Dumbbell Curl", { aliases: ["db curl", "bicep curl", "alternating curl"], primary: ["biceps"], secondary: ["forearms"], equipment: "dumbbell", reps: [8, 12], restS: 75, incrementKg: 1 });
ex("hammer-curl", "Hammer Curl", { aliases: ["neutral-grip curl", "dumbbell hammer curl"], primary: ["biceps", "forearms"], equipment: "dumbbell", reps: [8, 12], restS: 75, incrementKg: 1 });
ex("incline-dumbbell-curl", "Incline Dumbbell Curl", { aliases: ["incline curl"], primary: ["biceps"], equipment: "dumbbell", reps: [8, 12], restS: 75, incrementKg: 1 });
ex("preacher-curl", "Preacher Curl", { aliases: ["ez preacher curl", "barbell preacher curl"], primary: ["biceps"], secondary: ["forearms"], equipment: "barbell", reps: [8, 12], sets: 2, restS: 75, incrementKg: 1, extraNote: "Set the increment to your smallest available jump." });
ex("machine-preacher-curl", "Machine Preacher Curl", { aliases: ["preacher curl machine", "machine curl"], primary: ["biceps"], equipment: "machine", reps: [8, 12], restS: 75 });
ex("cable-curl", "Cable Curl", { aliases: ["cable bicep curl", "straight-bar cable curl"], primary: ["biceps"], secondary: ["forearms"], equipment: "cable", reps: [10, 15], restS: 75 });
ex("bayesian-cable-curl", "Bayesian Cable Curl", { aliases: ["bayesian curl", "behind-the-body cable curl"], primary: ["biceps"], equipment: "cable", reps: [10, 15], sets: 2, restS: 75, incrementKg: 1.25, instructions: "Face away from the stack, arm behind the torso for a long-length curl." });
ex("rope-triceps-pushdown", "Rope Triceps Pushdown", { aliases: ["rope pushdown", "triceps pushdown", "tricep pushdown rope"], primary: ["triceps"], equipment: "cable", reps: [10, 15], restS: 75 });
ex("bar-triceps-pushdown", "Bar Triceps Pushdown", { aliases: ["straight-bar pushdown", "v-bar pushdown"], primary: ["triceps"], equipment: "cable", reps: [10, 15], restS: 75 });
ex("overhead-cable-triceps-extension", "Overhead Cable Triceps Extension", { aliases: ["overhead cable extension", "cable overhead tricep extension"], primary: ["triceps"], equipment: "cable", reps: [10, 15], restS: 75, instructions: "Keep elbows in; get a deep stretch at the bottom." });
ex("ez-bar-skull-crusher", "EZ-Bar Skull Crusher", { aliases: ["skull crusher", "lying triceps extension", "skullcrusher"], primary: ["triceps"], equipment: "barbell", reps: [8, 12], restS: 75 });
ex("dumbbell-overhead-triceps-extension", "Dumbbell Overhead Triceps Extension", { aliases: ["db overhead extension", "french press"], primary: ["triceps"], equipment: "dumbbell", reps: [10, 15], restS: 75, extraNote: "If you hold one dumbbell with both hands, log that dumbbell's weight." });
ex("dumbbell-wrist-curl", "Dumbbell Wrist Curl", { aliases: ["wrist curl"], primary: ["forearms"], equipment: "dumbbell", reps: [12, 20], restS: 60, incrementKg: 1 });
ex("reverse-ez-bar-curl", "Reverse-Grip EZ-Bar Curl", { aliases: ["reverse curl", "overhand curl"], primary: ["forearms", "biceps"], equipment: "barbell", reps: [10, 15], restS: 75 });

// ---------------------------------------------------------------- legs
group("legs");
ex("barbell-back-squat", "Barbell Back Squat", { aliases: ["back squat", "squat", "high-bar squat", "low-bar squat"], primary: ["quads", "glutes"], secondary: ["hamstrings", "spinal_erectors"], equipment: "barbell", category: C, e1rm: true, reps: [5, 8], restS: 180, instructions: "Brace before each rep; knees track over the toes; depth you can control." });
ex("barbell-front-squat", "Barbell Front Squat", { aliases: ["front squat"], primary: ["quads"], secondary: ["glutes", "spinal_erectors"], equipment: "barbell", category: C, e1rm: true, reps: [5, 8], restS: 180 });
ex("goblet-squat", "Goblet Squat", { aliases: ["dumbbell goblet squat"], primary: ["quads", "glutes"], equipment: "dumbbell", category: C, reps: [8, 15], extraNote: "You hold one dumbbell, so its weight is the total." });
ex("hack-squat", "Hack Squat (Machine)", { aliases: ["hack squat", "machine hack squat"], primary: ["quads"], secondary: ["glutes"], equipment: "machine", category: C, reps: [6, 12], restS: 150, weightEntry: "total", incrementKg: 5, extraNote: "Count plates only, not the sled, and stay consistent." });
ex("smith-squat", "Smith Machine Squat", { aliases: ["smith squat"], primary: ["quads", "glutes"], secondary: ["hamstrings"], equipment: "smith", category: C, reps: [6, 10], restS: 150, extraNote: "Smith bars vary in weight; count the bar the same way every time." });
ex("leg-press", "Leg Press", { aliases: ["45-degree leg press", "seated leg press"], primary: ["quads", "glutes"], secondary: ["hamstrings"], equipment: "machine", category: C, reps: [6, 10], sets: 2, restS: 120, incrementKg: 5, extraNote: "On a plate-loaded press, count plates only, not the sled." });
ex("belt-squat", "Belt Squat", { aliases: ["belt squat machine"], primary: ["quads", "glutes"], equipment: "machine", category: C, reps: [8, 12], incrementKg: 5 });
ex("bulgarian-split-squat", "Bulgarian Split Squat", { aliases: ["rear-foot-elevated split squat", "bss", "rfess"], primary: ["quads", "glutes"], secondary: ["hamstrings"], equipment: "dumbbell", category: C, reps: [8, 12], instructions: "Rear foot on a bench; front shin roughly vertical at the bottom. Reps are per leg." });
ex("dumbbell-walking-lunge", "Dumbbell Walking Lunge", { aliases: ["walking lunge", "lunges"], primary: ["quads", "glutes"], secondary: ["hamstrings"], equipment: "dumbbell", category: C, reps: [8, 12], extraNote: "Count reps per leg." });
ex("dumbbell-reverse-lunge", "Dumbbell Reverse Lunge", { aliases: ["reverse lunge"], primary: ["quads", "glutes"], equipment: "dumbbell", category: C, reps: [8, 12], extraNote: "Count reps per leg." });
ex("dumbbell-step-up", "Dumbbell Step-Up", { aliases: ["step up", "box step-up"], primary: ["quads", "glutes"], equipment: "dumbbell", category: C, reps: [8, 12], extraNote: "Count reps per leg." });
ex("leg-extension", "Leg Extension", { aliases: ["quad extension", "knee extension"], primary: ["quads"], equipment: "machine", reps: [10, 15], sets: 2, restS: 75 });
ex("seated-leg-curl", "Seated Leg Curl", { aliases: ["seated hamstring curl"], primary: ["hamstrings"], equipment: "machine", reps: [8, 12], sets: 2, restS: 90 });
ex("lying-leg-curl", "Lying Leg Curl", { aliases: ["prone leg curl", "lying hamstring curl"], primary: ["hamstrings"], equipment: "machine", reps: [8, 12], restS: 90 });
ex("standing-calf-raise", "Standing Calf Raise", { aliases: ["calf raise", "standing calf machine"], primary: ["calves"], equipment: "machine", reps: [10, 15], sets: 2, restS: 75, incrementKg: 5, instructions: "Full stretch at the bottom, pause at the top." });
ex("seated-calf-raise", "Seated Calf Raise", { aliases: ["seated calf machine"], primary: ["calves"], equipment: "machine", reps: [10, 15], restS: 75, incrementKg: 5 });
ex("leg-press-calf-raise", "Leg-Press Calf Raise", { aliases: ["calf press"], primary: ["calves"], equipment: "machine", reps: [10, 15], restS: 75, incrementKg: 5 });
ex("hip-adduction-machine", "Hip Adduction (Machine)", { aliases: ["adductor machine", "inner thigh machine", "hip adduction"], primary: ["adductors"], equipment: "machine", reps: [10, 15], restS: 75 });
ex("hip-abduction-machine", "Hip Abduction (Machine)", { aliases: ["abductor machine", "outer thigh machine", "hip abduction"], primary: ["glutes"], equipment: "machine", reps: [10, 20], restS: 75 });

// ---------------------------------------------------------------- hinge & glutes
group("glutes_hinge");
ex("barbell-deadlift", "Barbell Deadlift", { aliases: ["deadlift", "conventional deadlift"], primary: ["hamstrings", "glutes", "spinal_erectors"], secondary: ["upper_back", "forearms", "quads"], equipment: "barbell", category: C, e1rm: true, reps: [3, 6], restS: 180, instructions: "Bar over mid-foot, brace, push the floor away; keep the bar close." });
ex("sumo-deadlift", "Sumo Deadlift", { aliases: ["sumo"], primary: ["glutes", "quads", "adductors"], secondary: ["hamstrings", "spinal_erectors"], equipment: "barbell", category: C, e1rm: true, reps: [3, 6], restS: 180 });
ex("trap-bar-deadlift", "Trap-Bar Deadlift", { aliases: ["hex bar deadlift", "trap bar deadlift"], primary: ["quads", "glutes", "hamstrings"], secondary: ["spinal_erectors", "traps"], equipment: "barbell", category: C, e1rm: true, reps: [4, 8], restS: 180, extraNote: "Trap bars vary in weight; count the bar the same way every time." });
ex("romanian-deadlift", "Romanian Deadlift", { aliases: ["rdl", "barbell rdl", "stiff-leg deadlift"], primary: ["hamstrings", "glutes"], secondary: ["spinal_erectors"], equipment: "barbell", category: C, reps: [6, 10], restS: 150, instructions: "Soft knees, push the hips back until the hamstrings limit range." });
ex("dumbbell-romanian-deadlift", "Dumbbell Romanian Deadlift", { aliases: ["db rdl", "dumbbell rdl"], primary: ["hamstrings", "glutes"], secondary: ["spinal_erectors"], equipment: "dumbbell", category: C, reps: [8, 12] });
ex("good-morning", "Barbell Good Morning", { aliases: ["good morning"], primary: ["hamstrings", "spinal_erectors"], secondary: ["glutes"], equipment: "barbell", category: C, reps: [8, 12] });
ex("barbell-hip-thrust", "Barbell Hip Thrust", { aliases: ["hip thrust", "glute bridge barbell"], primary: ["glutes"], secondary: ["hamstrings"], equipment: "barbell", category: C, reps: [8, 12], instructions: "Upper back on a bench; finish with ribs down and glutes squeezed." });
ex("machine-hip-thrust", "Machine Hip Thrust", { aliases: ["hip thrust machine", "glute drive"], primary: ["glutes"], secondary: ["hamstrings"], equipment: "machine", category: C, reps: [8, 12], incrementKg: 5 });
ex("cable-pull-through", "Cable Pull-Through", { aliases: ["pull through", "cable hip hinge"], primary: ["glutes", "hamstrings"], equipment: "cable", reps: [10, 15], restS: 75 });
ex("cable-glute-kickback", "Cable Glute Kickback", { aliases: ["glute kickback", "cable kickback"], primary: ["glutes"], equipment: "cable", reps: [10, 15], restS: 60, incrementKg: 1.25, extraNote: "Count reps per leg." });
ex("back-extension", "45° Back Extension", { aliases: ["hyperextension", "back extension", "roman chair extension"], primary: ["spinal_erectors", "glutes"], secondary: ["hamstrings"], ...BW, reps: [10, 15], restS: 75, extraNote: "If you hold a plate, switch to the weighted version so loads compare correctly." });
ex("weighted-back-extension", "Weighted 45° Back Extension", { aliases: ["weighted hyperextension"], primary: ["spinal_erectors", "glutes"], secondary: ["hamstrings"], ...WBW, reps: [8, 15], restS: 90 });
ex("lumbar-extension", "Lumbar Extension Machine", { aliases: ["back extension machine", "lower back machine"], primary: ["spinal_erectors"], secondary: ["glutes"], equipment: "machine", reps: [10, 15], restS: 90 });

// ---------------------------------------------------------------- core
group("core");
ex("cable-crunch", "Cable Crunch", { aliases: ["kneeling cable crunch", "rope crunch"], primary: ["abs"], equipment: "cable", reps: [10, 15], restS: 75 });
ex("machine-crunch", "Machine Crunch", { aliases: ["ab crunch machine"], primary: ["abs"], equipment: "machine", reps: [10, 15], restS: 75 });
ex("hanging-leg-raise", "Hanging Leg Raise", { aliases: ["leg raise", "hanging straight leg raise"], primary: ["abs"], ...BW, reps: [8, 15], restS: 75 });
ex("hanging-knee-raise", "Hanging Knee Raise", { aliases: ["knee raise", "captain's chair knee raise"], primary: ["abs"], ...BW, reps: [10, 15], restS: 75 });
ex("ab-wheel-rollout", "Ab Wheel Rollout", { aliases: ["ab roller", "rollout"], primary: ["abs"], ...BW, reps: [6, 12], restS: 75 });
ex("decline-sit-up", "Decline Sit-Up", { aliases: ["decline situp", "decline crunch"], primary: ["abs"], ...BW, reps: [10, 20], restS: 60 });
ex("weighted-decline-sit-up", "Weighted Decline Sit-Up", { aliases: ["weighted situp"], primary: ["abs"], ...WBW, reps: [8, 15], restS: 75 });
ex("pallof-press", "Cable Pallof Press", { aliases: ["pallof press", "anti-rotation press"], primary: ["abs"], equipment: "cable", reps: [10, 15], restS: 60, incrementKg: 1.25, extraNote: "Count reps per side." });

// ---------------------------------------------------------------- skill & assisted
group("skill");
ex("explosive-high-pull-up", "Explosive High Pull-Up", { aliases: ["high pull-up", "chest-to-bar pull-up"], primary: ["lats", "upper_back"], secondary: ["biceps"], ...BW, category: "skill", progression: "skill", reps: [2, 3], restS: 120, extraNote: "Skill work: quality, speed and pulling height matter more than reps. Stop before reps slow down.", instructions: "Pull explosively toward the lower chest / belly button, slight hollow-to-arch swing." });
ex("assisted-muscle-up-transition", "Assisted Muscle-Up Transition", { aliases: ["muscle-up transition", "banded muscle-up transition"], primary: ["lats", "chest"], secondary: ["triceps"], ...ASSIST, equipment: "bodyweight", category: "skill", progression: "skill", reps: [2, 3], sets: 2, restS: 90, incrementKg: 1.25, extraNote: "Progress by reducing assistance once transitions are smooth.", instructions: "Fast turnover of the wrists, lean the chest over the bar." });
ex("bar-muscle-up", "Bar Muscle-Up", { aliases: ["muscle-up", "muscle up"], primary: ["lats", "chest"], secondary: ["triceps", "upper_back"], ...BW, category: "skill", progression: "skill", reps: [1, 5], restS: 150 });
ex("negative-pull-up", "Negative Pull-Up", { aliases: ["eccentric pull-up", "pull-up negative"], primary: ["lats", "upper_back"], secondary: ["biceps"], ...BW, category: "skill", progression: "skill", reps: [3, 6], restS: 120, extraNote: "Count controlled lowerings as reps." });
ex("scapular-pull-up", "Scapular Pull-Up", { aliases: ["scap pull-up", "scap pulls"], primary: ["upper_back", "lats"], ...BW, category: "skill", progression: "skill", reps: [6, 12], restS: 60 });
ex("pike-push-up", "Pike Push-Up", { aliases: ["pike pushup"], primary: ["front_delts"], secondary: ["triceps", "upper_chest"], ...BW, reps: [6, 15], restS: 90 });

export const CATALOG: readonly CatalogExercise[] = list;
