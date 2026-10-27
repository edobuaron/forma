import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { TEMPLATE_CSV } from "../import";

const FILE = path.resolve(__dirname, "../../../../public/exercise-import-template.csv");

it("the downloadable template matches TEMPLATE_CSV", () => {
  if (process.env.UPDATE_CATALOG_SQL) writeFileSync(FILE, TEMPLATE_CSV);
  expect(readFileSync(FILE, "utf8")).toBe(TEMPLATE_CSV);
});
