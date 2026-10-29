import { Cable, Cog, Dumbbell, PersonStanding, Weight } from "lucide-react";
import { CATEGORY_LABEL, type Category } from "@/lib/category";
import { cn } from "@/lib/utils";

const BG: Record<Category, string> = { push: "bg-cat-push", pull: "bg-cat-pull", legs: "bg-cat-legs", core: "bg-cat-core", mixed: "bg-cat-mixed" };
const TEXT: Record<Category, string> = { push: "text-cat-push", pull: "text-cat-pull", legs: "text-cat-legs", core: "text-cat-core", mixed: "text-cat-mixed" };

/** A short vertical bar in the category colour. Decorative: pair it with a name or a CategoryTag. */
export function CategoryBar({ category, className }: { category: Category; className?: string }) {
  return <span aria-hidden className={cn("block w-1 shrink-0 self-stretch rounded-full", BG[category], className)} />;
}

/** Dot + label, so the category never depends on colour alone. */
export function CategoryTag({ category, className }: { category: Category; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-semibold", TEXT[category], className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", BG[category])} />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

const TILE: Record<Category, string> = {
  push: "bg-cat-push/14 text-cat-push", pull: "bg-cat-pull/14 text-cat-pull", legs: "bg-cat-legs/14 text-cat-legs",
  core: "bg-cat-core/14 text-cat-core", mixed: "bg-cat-mixed/14 text-cat-mixed",
};
const EQUIPMENT_ICON: Record<string, typeof Dumbbell> = {
  barbell: Weight, dumbbell: Dumbbell, cable: Cable, machine: Cog, smith: Weight, bodyweight: PersonStanding,
};

/** Exercise identity: equipment icon on a category-tinted tile. Decorative; the name carries the meaning. */
export function ExerciseIcon({ category, equipment, className }: { category: Category; equipment?: string | null; className?: string }) {
  const Icon = (equipment && EQUIPMENT_ICON[equipment]) || Dumbbell;
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-md", TILE[category], className)}>
      <Icon className="size-[18px]" strokeWidth={2} />
    </span>
  );
}
