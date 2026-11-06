// Time-zone-safe helpers for training invitations. Times are stored as a UTC instant plus the IANA
// zone they were planned in, and always shown with that zone so both people read the same moment.

/** Offset (minutes east of UTC) of `zone` at the given instant. */
export function zoneOffsetMinutes(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * The UTC instant for a wall-clock date ("2026-11-05") and time ("18:30") in `zone`.
 * Returns null for invalid input or a wall time skipped by a daylight-saving change.
 */
export function zonedToUtc(date: string, time: string, zone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t || !isValidZone(zone)) return null;
  const [y, mo, da, h, mi] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (mo < 1 || mo > 12 || da < 1 || da > 31 || h > 23 || mi > 59) return null;
  const naive = Date.UTC(y, mo - 1, da, h, mi);
  // Two passes handle offsets that change around the target time.
  let guess = naive - zoneOffsetMinutes(new Date(naive), zone) * 60000;
  guess = naive - zoneOffsetMinutes(new Date(guess), zone) * 60000;
  const back = wallParts(new Date(guess), zone);
  if (back.date !== date || back.time !== time) return null;
  return new Date(guess);
}

export function wallParts(instant: Date, zone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(instant);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}

export function isValidZone(zone: string): boolean {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return true; } catch { return false; }
}

export function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** "Thu 5 Nov, 18:30 (Europe/Rome)" — always with the zone, never ambiguous. */
export function formatInZone(instant: Date, zone: string, locale?: string): string {
  const s = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
  return `${s} (${zone.replace(/_/g, " ")})`;
}

/** The planned time, plus the viewer's own local time when their zone shows a different clock time. */
export function inviteTimeLines(instant: Date, zone: string, viewerZone: string, locale?: string): string[] {
  const lines = [formatInZone(instant, zone, locale)];
  if (viewerZone !== zone && zoneOffsetMinutes(instant, viewerZone) !== zoneOffsetMinutes(instant, zone)) {
    lines.push(`Your time: ${formatInZone(instant, viewerZone, locale)}`);
  }
  return lines;
}

export type InviteStatus = "pending" | "accepted" | "declined" | "cancelled";

export function inviteStatusLabel(status: InviteStatus, startsAt: Date, now = new Date()): string {
  if (status === "cancelled") return "Cancelled";
  if (status === "declined") return "Declined";
  if (startsAt.getTime() < now.getTime()) return status === "accepted" ? "Past" : "Expired";
  return status === "accepted" ? "Accepted" : "Pending";
}

const INVITE_ERRORS: Record<string, string> = {
  not_friends: "You can only invite friends.",
  unavailable: "You can't invite this person.",
  restricted: "Your account can't send invitations while reports about it are reviewed.",
  rate_limited: "You've sent many invitations today. Try again tomorrow.",
  invalid_time_zone: "Pick a valid time zone.",
  invalid_time: "Pick a time in the next 6 months.",
  invalid_gym: "Add where you'll train.",
  stale: "This invitation changed in the meantime. It's been refreshed.",
  not_your_turn: "It's the other person's turn to answer.",
  closed: "This invitation is already closed.",
  not_found: "This invitation isn't available.",
};
export function inviteError(status: string): string {
  return INVITE_ERRORS[status] ?? "Something went wrong. Please try again.";
}

const MESSAGE_ERRORS: Record<string, string> = {
  not_friends: "You can message only friends. Reconnect to send new messages.",
  unavailable: "You can't message this person.",
  restricted: "Your account can't send messages while reports about it are reviewed.",
  rate_limited: "You're sending messages too quickly. Wait a moment.",
  invalid: "This message can't be sent.",
};
export function messageError(status: string): string {
  return MESSAGE_ERRORS[status] ?? "Not sent. Check your connection and retry.";
}
