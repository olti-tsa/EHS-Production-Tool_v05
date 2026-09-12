import {
  normalizeBrief,
  type BriefAssignment,
  type BriefSchedule,
  type ProjectBrief,
} from "../../lib/projectBrief";

export type GigStatus =
  | "invited"
  | "confirmed"
  | "done"
  | "invoiced"
  | "paid";

/** Optional show-day check-in trail. The freelancer taps "On the way"
 *  when leaving and "Arrived" when on site, and the timestamps stick
 *  on the gig so production has a lightweight ETA + arrival audit. */
export type GigCheckIn = {
  onTheWayAt?: number;
  arrivedAt?: number;
};

export type Gig = {
  id: string;
  projectName: string;
  client: string;
  venue: string;
  role: string;
  startDate: string;
  endDate: string;
  hours: number;
  rate: number;
  flatFee: number;
  notes: string;
  status: GigStatus;
  createdAt: number;
  /** When this Gig was created from a shared Project Brief, the brief's
   *  id is recorded here so the logbook entry links back to the briefing. */
  briefId?: string;
  /** Optional show-day check-in timestamps. Undefined for the legacy
   *  gigs that pre-date the feature; the UI treats undefined as "not
   *  checked in". */
  checkIn?: GigCheckIn;
  /** Working days the freelancer has been booked for — sorted unique
   *  YYYY-MM-DD strings. The server auto-populates this on accept by
   *  intersecting the brief's `project.schedule` with the freelancer's
   *  role (see `lib/roleSchedule.ts`); the producer can override the
   *  list later via PATCH. Empty `[]` means "no per-day breakdown" —
   *  the UI falls back to the `startDate..endDate` range in that case
   *  so legacy gigs (and manually-logged gigs that pre-date the
   *  feature) still render the date row sensibly. */
  assignedDates: string[];
  /** Wall-clock timestamp of the most recent local mutation (save,
   *  status change, check-in toggle). The 60-second poll loop in
   *  `Portal.tsx` uses it as a freshness window — within ~60s of a
   *  local edit the server snapshot is *not* allowed to overwrite the
   *  local fields, so a slow PATCH/POST or a transient 5xx never
   *  visibly reverts a fresh edit. After the window the server is the
   *  source of truth again, so multi-device convergence still wins. */
  lastEditedAt?: number;
};

/** A Project Brief that was shared by a producer and imported into the
 *  freelancer's portal. The original brief is kept verbatim (so the
 *  freelancer can re-read every detail) and the freelancer's response
 *  is layered on top. */
/** Server-recognised states for a brief assignment. `too_late` is set
 *  by the server when a sibling candidate accepts first on a
 *  first-to-accept-wins brief — the freelancer never picks it
 *  themselves, but the portal still has to render it. */
export type BriefDecision =
  | "pending"
  | "accepted"
  | "declined"
  | "too_late";

export type ShiftDecision = "accepted" | "declined";
export type ShiftResponseMap = Record<string, ShiftDecision>;

/** Frozen "I've read this version" snapshot taken when the freelancer
 *  taps Accept (or Acknowledge changes). The portal compares the live
 *  brief against this to detect silent producer-side edits and surface
 *  a yellow "Schedule changed" banner — the single most expensive
 *  category of error in live production. */
export type AcceptedSnapshot = {
  generatedAt: number;
  project: ProjectBrief["project"];
  myAssignment?: BriefAssignment;
};

export type SharedBrief = {
  briefId: string;
  /** Server assignment identity. Undefined is a legacy shared-link entry. */
  assignmentId?: string;
  receivedAt: number;
  decision: BriefDecision;
  /** Optional reason for declining this exact assignment/role slot. */
  declineReason: string | null;
  /** Per-window response keyed by YYYY-MM-DD::phase::windowIndex.
   *  Missing on legacy whole-project responses. */
  shiftResponses?: ShiftResponseMap;
  /** Set when `decision === "accepted"` — the id of the Gig that was
   *  created from this brief, so the UI can link to the logbook entry
   *  and the user can spot duplicates without re-importing. */
  acceptedGigId?: string;
  /** Snapshot of the brief at the moment of accept/acknowledge. Drives
   *  the "what changed since you accepted" diff banner. Undefined on
   *  legacy briefs that pre-date the feature — the banner simply does
   *  not render in that case. */
  acceptedSnapshot?: AcceptedSnapshot;
  /** Wall-clock timestamp of the most recent local accept/decline. Set
   *  by the portal when the freelancer taps the buttons, *before* the
   *  server ack lands. The 60-second poll loop in `Portal.tsx` uses it
   *  as a freshness window — within ~60s of a local decision the
   *  server snapshot is not allowed to overwrite the local
   *  `decision` / `acceptedGigId` / `acceptedSnapshot` fields, so a
   *  slow sync or a transient 5xx never visibly downgrades a fresh
   *  accept back to "pending". */
  decidedLocallyAt?: number;
  brief: ProjectBrief;
};

/** Pull the snapshot fields off a brief, scoped to the recipient's
 *  own assignment when one exists. Used at accept time and again when
 *  the freelancer taps "Acknowledge changes". */
export function buildAcceptedSnapshot(brief: ProjectBrief): AcceptedSnapshot {
  const myAssignment =
    brief.assignments.find((a) => a.crewId === brief.recipientCrewId) ??
    undefined;
  return {
    generatedAt: brief.generatedAt,
    project: brief.project,
    myAssignment,
  };
}

// Re-export the schedule type so consumers can import it from here
// alongside the other portal types they already use.
export type { BriefSchedule };

export type Profile = {
  photoObjectPath: string;
  fullName: string;
  phone: string;
  /** Contact email — distinct from the Clerk identity email so the
   *  freelancer can route booking enquiries to a different inbox. */
  email: string;
  primaryRole: string;
  /** Home city or region shown to producers in the crew directory. */
  city: string;
  insurance: string;
  languages: string[];
  /** Dietary requirements (vegetarian, halal, gluten-free…). Surfaces
   *  on the producer's catering Order List view. */
  dietary: string;
  /** Specific allergens (peanuts, shellfish…). Kept separate from
   *  `dietary` because catering treats them very differently
   *  — allergens drive cross-contamination warnings, not meal counts. */
  allergies: string;
  skills: string[];
  bankAccount: string;
  orgNumber: string;
  /** Hotel pairing inputs (Phase B Feature 3). Stored on the
   *  freelancer's profile so the producer's hotel suggester has them
   *  on hand without needing to ask per-brief. `roomShare='either'`
   *  is the safe default — won't push anyone into a single they
   *  didn't ask for. `gender=''` means "didn't say" and is treated
   *  as a wildcard by the pairing algo. */
  roomShare: "twin" | "single" | "either";
  gender: "" | "female" | "male" | "other";
};

export type AvailabilityState = "available" | "busy";

export type PortalData = {
  profile: Profile;
  availability: Record<string, AvailabilityState>;
  gigs: Gig[];
  briefs: SharedBrief[];
  /** Tombstones for gigs the freelancer just deleted on this device.
   *  Keyed by gig id with the deletion epoch-ms as the value. The
   *  60-second poll loop in `Portal.tsx` skips re-adding a server
   *  gig whose id is in here within the freshness window — closes
   *  the race where DELETE is in flight when a poll lands and the
   *  gig would otherwise resurrect itself. Expired entries are
   *  swept on every merge so the map cannot grow unboundedly. */
  recentlyDeletedGigIds?: Record<string, number>;
};

export const EMPTY_PROFILE: Profile = {
  photoObjectPath: "",
  fullName: "",
  phone: "",
  email: "",
  primaryRole: "",
  city: "",
  insurance: "",
  languages: [],
  dietary: "",
  allergies: "",
  skills: [],
  bankAccount: "",
  orgNumber: "",
  roomShare: "either",
  gender: "",
};

export const EMPTY_PORTAL_DATA: PortalData = {
  profile: EMPTY_PROFILE,
  availability: {},
  gigs: [],
  briefs: [],
};

const STORAGE_PREFIX = "ehs-portal:";

function keyFor(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${STORAGE_PREFIX}${userId}`;
}

function isProfile(value: unknown): value is Profile {
  return (
    typeof value === "object" &&
    value !== null &&
    "fullName" in value &&
    "phone" in value
  );
}

function normalizeProfile(input: unknown): Profile {
  if (!isProfile(input)) return { ...EMPTY_PROFILE };
  const p = input as Partial<Profile>;
  return {
    photoObjectPath:
      typeof p.photoObjectPath === "string" ? p.photoObjectPath : "",
    fullName: typeof p.fullName === "string" ? p.fullName : "",
    phone: typeof p.phone === "string" ? p.phone : "",
    email: typeof p.email === "string" ? p.email : "",
    primaryRole: typeof p.primaryRole === "string" ? p.primaryRole : "",
    city: typeof p.city === "string" ? p.city : "",
    insurance: typeof p.insurance === "string" ? p.insurance : "",
    languages: Array.isArray(p.languages)
      ? p.languages.filter((x): x is string => typeof x === "string")
      : [],
    dietary: typeof p.dietary === "string" ? p.dietary : "",
    allergies: typeof p.allergies === "string" ? p.allergies : "",
    skills: Array.isArray(p.skills)
      ? p.skills.filter((x): x is string => typeof x === "string")
      : [],
    bankAccount: typeof p.bankAccount === "string" ? p.bankAccount : "",
    orgNumber: typeof p.orgNumber === "string" ? p.orgNumber : "",
    roomShare:
      p.roomShare === "twin" || p.roomShare === "single"
        ? p.roomShare
        : "either",
    gender:
      p.gender === "female" || p.gender === "male" || p.gender === "other"
        ? p.gender
        : "",
  };
}

const VALID_STATUSES: GigStatus[] = [
  "invited",
  "confirmed",
  "done",
  "invoiced",
  "paid",
];

function normalizeCheckIn(raw: unknown): GigCheckIn | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Partial<GigCheckIn>;
  const onTheWayAt =
    typeof r.onTheWayAt === "number" && isFinite(r.onTheWayAt)
      ? r.onTheWayAt
      : undefined;
  const arrivedAt =
    typeof r.arrivedAt === "number" && isFinite(r.arrivedAt)
      ? r.arrivedAt
      : undefined;
  if (onTheWayAt === undefined && arrivedAt === undefined) return undefined;
  return { onTheWayAt, arrivedAt };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Coerce raw `assignedDates` to a sorted, deduplicated YYYY-MM-DD
 *  array. Defensive against the server returning either an array of
 *  strings (the JSON path) or — once the row is round-tripped through
 *  Drizzle's `date().array()` — strings that already match the shape
 *  but might include duplicates after a producer override race. */
function normalizeAssignedDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry === "string" && ISO_DATE_RE.test(entry)) {
      seen.add(entry);
    }
    if (seen.size >= 366) break;
  }
  return Array.from(seen).sort();
}

function normalizeGig(raw: unknown): Gig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const g = raw as Partial<Gig>;
  if (!g.id || !g.projectName) return null;
  const status: GigStatus = VALID_STATUSES.includes(g.status as GigStatus)
    ? (g.status as GigStatus)
    : "confirmed";
  return {
    id: String(g.id),
    projectName: String(g.projectName),
    client: typeof g.client === "string" ? g.client : "",
    venue: typeof g.venue === "string" ? g.venue : "",
    role: typeof g.role === "string" ? g.role : "",
    startDate: typeof g.startDate === "string" ? g.startDate : "",
    endDate: typeof g.endDate === "string" ? g.endDate : "",
    hours: typeof g.hours === "number" && isFinite(g.hours) ? g.hours : 0,
    rate: typeof g.rate === "number" && isFinite(g.rate) ? g.rate : 0,
    flatFee:
      typeof g.flatFee === "number" && isFinite(g.flatFee) ? g.flatFee : 0,
    notes: typeof g.notes === "string" ? g.notes : "",
    status,
    createdAt:
      typeof g.createdAt === "number" && isFinite(g.createdAt)
        ? g.createdAt
        : Date.now(),
    briefId: typeof g.briefId === "string" && g.briefId ? g.briefId : undefined,
    checkIn: normalizeCheckIn(g.checkIn),
    assignedDates: normalizeAssignedDates(g.assignedDates),
    // Preserve the freshness-window timestamp across reloads. Without
    // this, a hard refresh would reopen the window for nothing
    // (everything looks server-fresh again) — but more importantly,
    // a refresh shortly after a local edit would let the next poll
    // overwrite the still-in-flight POST/PATCH.
    lastEditedAt:
      typeof g.lastEditedAt === "number" && isFinite(g.lastEditedAt)
        ? g.lastEditedAt
        : undefined,
  };
}

/** Normalize the `recentlyDeletedGigIds` map: only keep entries with
 *  a string key and a finite numeric timestamp. Sweeping expired
 *  entries is mergeServerGigs's responsibility, not the loader's
 *  (it doesn't have the wall-clock context). */
function normalizeRecentlyDeleted(
  raw: unknown,
): Record<string, number> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k) continue;
    if (typeof v === "number" && isFinite(v)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

const VALID_DECISIONS: BriefDecision[] = [
  "pending",
  "accepted",
  "declined",
  "too_late",
];

function normalizeShiftResponses(raw: unknown): ShiftResponseMap | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const out: ShiftResponseMap = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      /^\d{4}-\d{2}-\d{2}::(?:setup|rehearsal|show|downrig|day)::\d+$/.test(
        key,
      ) &&
      (value === "accepted" || value === "declined")
    ) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeAcceptedSnapshot(
  raw: unknown,
): AcceptedSnapshot | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Partial<AcceptedSnapshot>;
  if (typeof r.generatedAt !== "number" || !isFinite(r.generatedAt))
    return undefined;
  if (typeof r.project !== "object" || r.project === null) return undefined;
  // Trust the snapshot shape — it was written by the producer-aware
  // normalizers in projectBrief.ts when the brief was first decoded.
  // We do not deeply re-validate here because doing so would require
  // duplicating the entire BriefProject schema; defensive UI code in
  // the diff renderer copes with missing fields.
  return {
    generatedAt: r.generatedAt,
    project: r.project as AcceptedSnapshot["project"],
    myAssignment:
      typeof r.myAssignment === "object" && r.myAssignment !== null
        ? (r.myAssignment as BriefAssignment)
        : undefined,
  };
}

function normalizeSharedBrief(raw: unknown): SharedBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const b = raw as Partial<SharedBrief>;
  if (typeof b.briefId !== "string" || !b.briefId) return null;
  const brief = normalizeBrief(b.brief);
  if (!brief) return null;
  const decision: BriefDecision = VALID_DECISIONS.includes(
    b.decision as BriefDecision,
  )
    ? (b.decision as BriefDecision)
    : "pending";
  return {
    briefId: b.briefId,
    assignmentId:
      typeof b.assignmentId === "string" && b.assignmentId
        ? b.assignmentId
        : undefined,
    receivedAt:
      typeof b.receivedAt === "number" && isFinite(b.receivedAt)
        ? b.receivedAt
        : Date.now(),
    decision,
    declineReason:
      typeof b.declineReason === "string" && b.declineReason.trim()
        ? b.declineReason.trim().slice(0, 1000)
        : null,
    shiftResponses: normalizeShiftResponses(b.shiftResponses),
    acceptedGigId:
      typeof b.acceptedGigId === "string" && b.acceptedGigId
        ? b.acceptedGigId
        : undefined,
    acceptedSnapshot: normalizeAcceptedSnapshot(b.acceptedSnapshot),
    decidedLocallyAt:
      typeof b.decidedLocallyAt === "number" && isFinite(b.decidedLocallyAt)
        ? b.decidedLocallyAt
        : undefined,
    brief,
  };
}

function normalizeAvailability(
  input: unknown,
): Record<string, AvailabilityState> {
  if (typeof input !== "object" || input === null) return {};
  const out: Record<string, AvailabilityState> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === "available" || v === "busy") out[k] = v;
  }
  return out;
}

export function loadPortalData(
  userId: string | null | undefined,
): PortalData {
  const k = keyFor(userId);
  if (!k) return { ...EMPTY_PORTAL_DATA };
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return { ...EMPTY_PORTAL_DATA };
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { ...EMPTY_PORTAL_DATA };
    }
    const obj = parsed as Partial<PortalData>;
    const recentlyDeletedGigIds = normalizeRecentlyDeleted(
      obj.recentlyDeletedGigIds,
    );
    const out: PortalData = {
      profile: normalizeProfile(obj.profile),
      availability: normalizeAvailability(obj.availability),
      gigs: Array.isArray(obj.gigs)
        ? obj.gigs
            .map(normalizeGig)
            .filter((g): g is Gig => g !== null)
        : [],
      briefs: Array.isArray(obj.briefs)
        ? obj.briefs
            .map(normalizeSharedBrief)
            .filter((b): b is SharedBrief => b !== null)
        : [],
    };
    if (recentlyDeletedGigIds) {
      out.recentlyDeletedGigIds = recentlyDeletedGigIds;
    }
    return out;
  } catch {
    return { ...EMPTY_PORTAL_DATA };
  }
}

export function savePortalData(
  userId: string | null | undefined,
  data: PortalData,
): void {
  const k = keyFor(userId);
  if (!k) return;
  try {
    localStorage.setItem(k, JSON.stringify(data));
  } catch {
    /* localStorage may be full or unavailable */
  }
}

export function newGigId(): string {
  return `gig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function gigEarnings(g: Gig): number {
  if (g.flatFee > 0) return g.flatFee;
  return Math.max(0, g.hours) * Math.max(0, g.rate);
}

export function statusLabel(s: GigStatus): string {
  switch (s) {
    case "invited":
      return "Invited";
    case "confirmed":
      return "Confirmed";
    case "done":
      return "Done";
    case "invoiced":
      return "Invoiced";
    case "paid":
      return "Paid";
  }
}

/** Localized status label. Pass a `t` from `useT()` to get the
 *  current-locale rendering. The `statusLabel` above is kept for the
 *  CSV exporter (which writes raw, locale-independent values for
 *  bookkeeping spreadsheets). */
export function statusLabelT(
  s: GigStatus,
  t: (key:
    | "portal.status.invited"
    | "portal.status.confirmed"
    | "portal.status.done"
    | "portal.status.invoiced"
    | "portal.status.paid") => string,
): string {
  switch (s) {
    case "invited":
      return t("portal.status.invited");
    case "confirmed":
      return t("portal.status.confirmed");
    case "done":
      return t("portal.status.done");
    case "invoiced":
      return t("portal.status.invoiced");
    case "paid":
      return t("portal.status.paid");
  }
}

export function statusColor(s: GigStatus): { bg: string; fg: string } {
  switch (s) {
    case "invited":
      return { bg: "rgba(99,102,241,0.15)", fg: "#6366f1" };
    case "confirmed":
      return { bg: "rgba(248,128,0,0.18)", fg: "#f88000" };
    case "done":
      return { bg: "rgba(14,165,233,0.18)", fg: "#0ea5e9" };
    case "invoiced":
      return { bg: "rgba(168,85,247,0.18)", fg: "#a855f7" };
    case "paid":
      return { bg: "rgba(22,163,74,0.18)", fg: "#16a34a" };
  }
}

/* --------------------------------- Briefs --------------------------------- */

/** Add or refresh a brief in the freelancer's portal. If a brief with the
 *  same `briefId` already exists, the original `decision` and
 *  `acceptedGigId` are preserved (so re-opening the share link doesn't
 *  silently undo an Accept) but the brief payload is refreshed in case
 *  the producer regenerated the link. Returns the merged SharedBrief. */
export function upsertBrief(
  data: PortalData,
  brief: ProjectBrief,
): { data: PortalData; entry: SharedBrief } {
  const existingIdx = data.briefs.findIndex(
    (b) => b.briefId === brief.briefId,
  );
  if (existingIdx >= 0) {
    const existing = data.briefs[existingIdx];
    const merged: SharedBrief = {
      ...existing,
      brief,
    };
    const briefs = data.briefs.slice();
    briefs[existingIdx] = merged;
    return { data: { ...data, briefs }, entry: merged };
  }
  const entry: SharedBrief = {
    briefId: brief.briefId,
    receivedAt: Date.now(),
    decision: "pending",
    declineReason: null,
    brief,
  };
  return { data: { ...data, briefs: [entry, ...data.briefs] }, entry };
}

/** Update a single brief by id (preserves identity for everything else). */
export function updateBrief(
  data: PortalData,
  briefId: string,
  patch: Partial<Omit<SharedBrief, "briefId" | "brief">>,
  assignmentId?: string,
): PortalData {
  return {
    ...data,
    briefs: data.briefs.map((b) =>
      b.briefId === briefId && (!assignmentId || b.assignmentId === assignmentId)
        ? { ...b, ...patch }
        : b,
    ),
  };
}

export function findBrief(
  data: PortalData,
  briefId: string,
): SharedBrief | undefined {
  return data.briefs.find((b) => b.briefId === briefId);
}

/** Build a Gig from a SharedBrief, picking the recipient's assignment if
 *  one is present (otherwise the first assignment, or generic blanks). */
export function gigFromBrief(brief: ProjectBrief): Gig {
  const target =
    brief.assignments.find((a) => a.crewId === brief.recipientCrewId) ??
    brief.assignments[0];
  const projectName =
    brief.project.projectName || brief.project.venue || "Untitled show";
  const venue = brief.project.venue || "";
  // Prefer the explicit Client field. Fall back to preparedBy only for
  // legacy briefs that don't have a client set yet — keeps older
  // accepted Gigs from suddenly losing their "client" line.
  const client = brief.project.client || brief.project.preparedBy || "";
  return {
    id: newGigId(),
    projectName,
    client,
    venue,
    role: target?.role ?? "",
    startDate: brief.project.date,
    endDate: brief.project.endDate || brief.project.date,
    hours: target ? target.hours : 0,
    rate: target ? target.dayRate : 0,
    flatFee: 0,
    notes: target?.notes ?? "",
    status: "confirmed",
    createdAt: Date.now(),
    briefId: brief.briefId,
    // Left blank intentionally on the optimistic local Gig — the
    // server's POST /portal/briefs/:id/respond handler computes the
    // canonical `assignedDates` from the brief's schedule × the
    // freelancer's role and returns the materialised gig in the
    // response. The next poll (or the response merge in Portal.tsx)
    // then replaces this empty array with the server-authoritative
    // list. The fallback display in Gigs.tsx renders the
    // `startDate..endDate` range while the array is still empty.
    assignedDates: [],
  };
}
