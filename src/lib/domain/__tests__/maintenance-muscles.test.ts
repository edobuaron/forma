import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MUSCLE_LABELS } from "../analytics";

describe("maintenance muscles", () => {
  it("the database accepts exactly the muscles exercises can use", () => {
    const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261030000012_maintenance_muscles.sql"), "utf8");
    const list = sql.match(/<@ array\[([\s\S]*?)\]/)![1];
    const keys = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(Object.keys(MUSCLE_LABELS).sort());
  });
});
