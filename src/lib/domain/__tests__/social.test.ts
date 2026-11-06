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

import { avatarFileProblem, centreSquare, validateProfile } from "../social";

describe("profiles", () => {
  it("validates name, bio and interests", () => {
    expect(validateProfile({ displayName: "Ada", bio: "", interests: ["strength"] })).toBeNull();
    expect(validateProfile({ displayName: " ", bio: "", interests: [] })).toMatch(/display name/);
    expect(validateProfile({ displayName: "Ada", bio: "x".repeat(161), interests: [] })).toMatch(/bio/);
    expect(validateProfile({ displayName: "Ada", bio: "", interests: ["napping"] })).toMatch(/list/);
    expect(validateProfile({ displayName: "Ada", bio: "", interests: ["strength", "running", "mobility", "sport", "calisthenics", "powerlifting"] })).toMatch(/up to 5/);
  });
  it("accepts photos only, up to 10 MB", () => {
    expect(avatarFileProblem("image/jpeg", 2_000_000)).toBeNull();
    expect(avatarFileProblem("image/svg+xml", 2000)).toMatch(/JPEG/);
    expect(avatarFileProblem("image/png", 11 * 1024 * 1024)).toMatch(/10 MB/);
    expect(avatarFileProblem("image/png", 0)).toMatch(/empty/);
  });
  it("crops the centre square", () => {
    expect(centreSquare(400, 300)).toEqual({ sx: 50, sy: 0, side: 300 });
    expect(centreSquare(300, 500)).toEqual({ sx: 0, sy: 100, side: 300 });
  });
});
