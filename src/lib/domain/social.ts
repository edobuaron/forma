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

/* ---------- profiles ---------- */

/** Fixed list, so interests can't carry free text. Same values as the database check. */
export const INTERESTS = [
  { value: "strength", label: "Strength" },
  { value: "hypertrophy", label: "Muscle building" },
  { value: "powerlifting", label: "Powerlifting" },
  { value: "olympic_lifting", label: "Olympic lifting" },
  { value: "calisthenics", label: "Calisthenics" },
  { value: "bodybuilding", label: "Bodybuilding" },
  { value: "running", label: "Running" },
  { value: "conditioning", label: "Conditioning" },
  { value: "mobility", label: "Mobility" },
  { value: "sport", label: "Sport" },
] as const;
export type Interest = (typeof INTERESTS)[number]["value"];
export const MAX_INTERESTS = 5;
export const MAX_BIO = 160;

export function interestLabel(v: string): string {
  return INTERESTS.find((i) => i.value === v)?.label ?? v;
}

export function validateProfile(p: { displayName: string; bio: string; interests: string[] }): string | null {
  const name = p.displayName.trim();
  if (name.length < 1 || name.length > 60) return "Enter a display name (up to 60 characters).";
  if (p.bio.trim().length > MAX_BIO) return `Keep the bio under ${MAX_BIO} characters.`;
  if (p.interests.length > MAX_INTERESTS) return `Pick up to ${MAX_INTERESTS} interests.`;
  if (p.interests.some((i) => !INTERESTS.some((x) => x.value === i))) return "Pick interests from the list.";
  return null;
}

/** Avatar uploads: photos only, re-encoded in the browser to a small square before upload. */
export const AVATAR_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const AVATAR_MAX_INPUT_BYTES = 10 * 1024 * 1024;
/** Same as the storage bucket's limit. */
export const AVATAR_MAX_UPLOAD_BYTES = 512 * 1024;
export const AVATAR_SIZE_PX = 384;

export function avatarFileProblem(type: string, size: number): string | null {
  if (!AVATAR_INPUT_TYPES.includes(type.toLowerCase())) return "Choose a JPEG, PNG, WebP or HEIC photo.";
  if (size > AVATAR_MAX_INPUT_BYTES) return "That photo is over 10 MB. Choose a smaller one.";
  if (size === 0) return "That file is empty.";
  return null;
}

/** Square centre crop of a w×h image: the source rectangle to draw. */
export function centreSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

export type SocialProfile = {
  id: string; display_name: string; bio?: string; interests: string[]; avatar?: string;
  relation: Relation | "self"; incoming_request_id?: string; outgoing_request_id?: string;
  can_request: boolean; can_message: boolean;
  gym?: { id: string; name: string; city: string; verified: boolean };
};
