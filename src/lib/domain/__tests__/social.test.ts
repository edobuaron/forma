import { describe, expect, it } from "vitest";
import { gymBadge, initials, likelyDuplicates, normKey, requestMessage, requestSucceeded, validateGym, type Gym } from "../social";

const gym = (p: Partial<Gym>): Gym => ({ id: "1", name: "FitLab Navigli", chain: "FitLab", address: "Via Vigevano 12", city: "Milano", country: "IT", verified: false, ...p });

describe("social helpers", () => {
  it("initials from the display name only", () => {
    expect(initials("Anna Maria Rossi")).toBe("AR");
    expect(initials("ben")).toBe("B");
    expect(initials("  ")).toBe("?");
    expect(initials(null)).toBe("?");
    expect(initials("Élodie")).toBe("É");
  });

  it("communities are unofficial unless verified", () => {
    expect(gymBadge({ verified: false })).toBe("Unofficial community");
    expect(gymBadge({ verified: true })).toBe("Verified gym");
  });

  it("normalises like the database", () => {
    expect(normKey("Via Vigevano, 12")).toBe(normKey("via  vigevano 12"));
    expect(normKey("Città")).toBe("citta");
  });

  it("flags duplicates in the same city, not other branches elsewhere", () => {
    const list = [gym({ id: "a" }), gym({ id: "b", name: "FitLab Isola", address: "Via Borsieri 3" }), gym({ id: "c", city: "Roma" })];
    const d = likelyDuplicates({ name: "fitlab navigli", chain: "", address: "x", city: "milano", country: "IT" }, list);
    expect(d.map((g) => g.id)).toEqual(["a"]);
    const byAddress = likelyDuplicates({ name: "Other name", chain: "", address: "Via Borsieri, 3", city: "Milano", country: "IT" }, list);
    expect(byAddress.map((g) => g.id)).toEqual(["b"]);
  });

  it("validates a new gym", () => {
    expect(validateGym({ name: "FitLab", chain: "", address: "Via Roma 1", city: "Milano", country: "it" })).toBeNull();
    expect(validateGym({ name: "F", chain: "", address: "Via Roma 1", city: "Milano", country: "IT" })).toMatch(/name/);
    expect(validateGym({ name: "FitLab", chain: "", address: "", city: "Milano", country: "IT" })).toMatch(/address/);
    expect(validateGym({ name: "FitLab", chain: "", address: "Via Roma 1", city: "Milano", country: "Italy" })).toMatch(/country/);
  });

  it("request outcomes have honest copy", () => {
    expect(requestMessage("too_soon")).toMatch(/later/);
    expect(requestMessage("weird")).toMatch(/went wrong/);
    expect(requestSucceeded("sent")).toBe(true);
    expect(requestSucceeded("unavailable")).toBe(false);
  });
});
