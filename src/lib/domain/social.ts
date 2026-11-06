// Community rules shared by the screens. The database enforces access; this file only turns
// server outcomes into honest copy and validates input before it is sent.

export type Relation = "none" | "request_sent" | "request_received" | "friends";

export type Gym = {
  id: string;
  name: string;
  chain: string | null;
  address: string;
  city: string;
  country: string;
  verified: boolean;
};

/** Two-letter initials for the avatar; never derived from anything but the chosen display name. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? "" : "";
  return (first + last).toUpperCase();
}

export function gymLocation(g: Pick<Gym, "address" | "city" | "country">): string {
  return [g.address, g.city, g.country].filter(Boolean).join(", ");
}

/** "Unofficial community" unless the branch was actually verified. */
export function gymBadge(g: Pick<Gym, "verified">): string {
  return g.verified ? "Verified gym" : "Unofficial community";
}

/** Same normalisation as the database's social_norm(), used to flag likely duplicates before adding. */
export function normKey(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}

export type GymDraft = { name: string; chain: string; address: string; city: string; country: string };

export function validateGym(d: GymDraft): string | null {
  const name = d.name.trim();
  if (name.length < 2 || name.length > 80) return "Enter the gym's name (2–80 characters).";
  if (d.chain.trim().length > 60) return "Chain name is too long.";
  const address = d.address.trim();
  if (address.length < 3 || address.length > 160) return "Enter the street address of this branch.";
  if (!d.city.trim() || d.city.trim().length > 80) return "Enter the city.";
  if (!/^[A-Za-z]{2}$/.test(d.country.trim())) return "Use the two-letter country code, e.g. IT.";
  return null;
}

/** Existing gyms that look like the one being added (same name in the same city, or same address). */
export function likelyDuplicates<T extends Gym>(draft: GymDraft, gyms: T[]): T[] {
  const n = normKey(draft.name), a = normKey(draft.address), c = normKey(draft.city);
  return gyms.filter((g) => {
    const sameCity = normKey(g.city) === c;
    if (!sameCity) return false;
    const gn = normKey(g.name), ga = normKey(g.address);
    return (n && (gn.includes(n) || n.includes(gn))) || (a && ga === a);
  });
}

const REQUEST_COPY: Record<string, string> = {
  sent: "Friend request sent.",
  accepted: "You're now friends.",
  already_sent: "You already sent a request.",
  already_friends: "You're already friends.",
  too_soon: "They declined recently. You can ask again later.",
  rate_limited: "You've sent a lot of requests today. Try again tomorrow.",
  restricted: "Your account can't send requests while reports about it are reviewed.",
  unavailable: "This person can't be added right now.",
  declined: "Request declined.",
  cancelled: "Request cancelled.",
  not_pending: "This request was already answered.",
};

export function requestMessage(status: string): string {
  return REQUEST_COPY[status] ?? "Something went wrong. Please try again.";
}

export function requestSucceeded(status: string): boolean {
  return ["sent", "accepted", "declined", "cancelled"].includes(status);
}

export const REPORT_REASONS = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

const REPORT_COPY: Record<string, string> = {
  reported: "Thanks. The report was sent for review.",
  already_reported: "You already reported this.",
  rate_limited: "You've sent many reports today. Try again tomorrow.",
  invalid: "This can't be reported.",
};
export function reportMessage(status: string): string {
  return REPORT_COPY[status] ?? "Something went wrong. Please try again.";
}
