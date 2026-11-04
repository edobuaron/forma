import { describe, expect, it } from "vitest";
import { formatInZone, inviteStatusLabel, inviteTimeLines, wallParts, zonedToUtc } from "../schedule";

describe("training invite times", () => {
  it("converts a wall time in a zone to the right UTC instant", () => {
    expect(zonedToUtc("2026-11-05", "18:30", "Europe/Rome")?.toISOString()).toBe("2026-11-05T17:30:00.000Z"); // CET
    expect(zonedToUtc("2026-07-05", "18:30", "Europe/Rome")?.toISOString()).toBe("2026-07-05T16:30:00.000Z"); // CEST
    expect(zonedToUtc("2026-11-05", "07:00", "America/New_York")?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    expect(zonedToUtc("2026-11-05", "07:00", "UTC")?.toISOString()).toBe("2026-11-05T07:00:00.000Z");
  });

  it("rejects invalid input and wall times skipped by daylight saving", () => {
    expect(zonedToUtc("2026-03-29", "02:30", "Europe/Rome")).toBeNull();
    expect(zonedToUtc("2026-02-30", "10:00", "Europe/Rome")).toBeNull();
    expect(zonedToUtc("2026-11-05", "25:00", "Europe/Rome")).toBeNull();
    expect(zonedToUtc("2026-11-05", "10:00", "Not/AZone")).toBeNull();
  });

  it("round-trips through wall parts", () => {
    const t = zonedToUtc("2026-12-31", "23:15", "Asia/Tokyo")!;
    expect(wallParts(t, "Asia/Tokyo")).toEqual({ date: "2026-12-31", time: "23:15" });
  });

  it("always names the zone, and adds the viewer's time only when it differs", () => {
    const t = new Date("2026-11-05T17:30:00Z");
    expect(formatInZone(t, "Europe/Rome", "en-GB")).toMatch(/18:30.*\(Europe\/Rome\)/);
    expect(inviteTimeLines(t, "Europe/Rome", "Europe/Rome", "en-GB")).toHaveLength(1);
    expect(inviteTimeLines(t, "Europe/Rome", "Europe/Paris", "en-GB")).toHaveLength(1); // same clock time
    const two = inviteTimeLines(t, "Europe/Rome", "Europe/London", "en-GB");
    expect(two).toHaveLength(2);
    expect(two[1]).toMatch(/Your time: .*17:30.*London/);
  });

  it("status labels account for time passing", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(inviteStatusLabel("pending", new Date("2026-11-06T12:00:00Z"), now)).toBe("Pending");
    expect(inviteStatusLabel("pending", new Date("2026-11-04T12:00:00Z"), now)).toBe("Expired");
    expect(inviteStatusLabel("accepted", new Date("2026-11-04T12:00:00Z"), now)).toBe("Past");
    expect(inviteStatusLabel("cancelled", new Date("2026-11-06T12:00:00Z"), now)).toBe("Cancelled");
  });
});
