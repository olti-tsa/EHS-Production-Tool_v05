/** Producer-side roster merge — Phase C "Crew Report" tab.
 *
 *  Two sources feed the roster:
 *
 *    1. The server's `GET /api/portal/briefs/:id/roster` — every gig
 *       on the brief that has been accepted by the freelancer
 *       (status `invited` / `confirmed` / `done` / `invoiced` /
 *       `paid`). This is the authoritative source for assigned days,
 *       hotel state, dietary tags and allergens.
 *
 *    2. The producer's local `CrewMember[]` — the call-sheet rows
 *       they've added either manually (in-house crew) or via "Send
 *       requests" on the Available Crew sidebar. This is the only
 *       source that knows about people who have been *requested* but
 *       have not yet accepted (no gig exists for them yet) and the
 *       only source for purely-manual rows that don't correspond to
 *       any portal freelancer at all.
 *
 *  The producer Crew Report needs both — they want one table with
 *  every person who is either booked, requested or just penciled
 *  in by hand. This module is the pure function that glues the two
 *  sources together. Keeping the merge logic here (instead of inline
 *  in the component) means we can unit-test the dedupe rules without
 *  spinning up React.
 *
 *  Dedup strategy:
 *
 *    - First pass: every gig from the server response becomes one
 *      `RosterRow`. The gig is the source of truth — if a person
 *      has accepted, their portal data wins over whatever the
 *      producer's local row says.
 *
 *    - Second pass: every local `CrewMember` is checked against the
 *      gigs. If a gig already covers them (matched by
 *      `freelancerUserId`, falling back to a case-insensitive
 *      whitespace-collapsed name match for legacy rows that pre-date
 *      the freelancerUserId field), the local row is *folded into*
 *      the existing gig row — we still want the local `dayRate` and
 *      `notes` (the producer typed those) but the status, dates,
 *      hotel and dietary all come from the gig.
 *
 *    - Anything left over (local rows with no gig match) becomes its
 *      own `RosterRow` with `source: 'local'`. Their status is
 *      whatever `requestStatus` the local row has, or `'manual'` for
 *      a hand-added in-house entry with no requestStatus. */

import type { CrewMember, CrewRequestStatus } from "./crew.ts";

/** Mirrors `DietaryTag` on the server. Duplicated here so the client
 *  doesn't have to import from `@workspace/api-server` (which would
 *  pull in Express types). Keep the union in sync — there are only
 *  five values and they don't churn. */
export type DietaryTag =
  | "vegetarian"
  | "vegan"
  | "halal"
  | "gluten-free"
  | "lactose-free";

/** Gig-level statuses surfaced by `/api/portal/briefs/:id/roster`.
 *  Matches the schema-comment on `gigsTable.status`. */
export type RosterGigStatus =
  | "invited"
  | "confirmed"
  | "done"
  | "invoiced"
  | "paid";

export type ShiftResponseMap = Record<string, "accepted" | "declined">;

/** A canonical roster row. `source` records where the data came from
 *  so the component can render slightly different affordances:
 *  gig-backed rows can be inline-edited (Slice 2), purely-local rows
 *  can't because there's nothing on the server to PATCH. */
export type RosterRow = {
  source: "gig" | "local";
  /** Stable id for React keys. Gig rows use the gig id; local rows
   *  use the local CrewMember id. */
  id: string;
  /** Server gig id, when this row is gig-backed. Required by the
   *  inline-edit endpoints in Slice 2. */
  gigId: string | null;
  /** Exact server assignment / producer role slot when available. */
  briefAssignmentId?: string | null;
  crewId?: string | null;
  /** Optional explanation supplied when this exact role was declined. */
  declineReason: string | null;
  /** Clerk user id of the freelancer. Null for purely-manual rows. */
  freelancerUserId: string | null;
  name: string;
  role: string;
  /** Combined status. For gig-backed rows: the gig's status. For
   *  local rows: the requestStatus pill state, or `'manual'` when
   *  the producer typed the row in by hand. */
  status:
    | RosterGigStatus
    | CrewRequestStatus
    | "partially_accepted"
    | "manual";
  /** YYYY-MM-DD strings, sorted. Empty when the producer has not yet
   *  picked working days (which is the default for a fresh accept). */
  assignedDates: string[];
  /** Exact assignment timing from the brief, with local legacy values only
   * used when the server has no timing for this accepted gig. */
  callTime: string;
  offTime: string;
  assignedShiftPhases: string[];
  assignedShiftTimes: Record<string, { startTime: string; endTime: string }>;
  assignedShiftWindows: Record<
    string,
    Array<{ startTime: string; endTime: string }>
  >;
  assignedShiftTasks: Record<string, string[]>;
  shiftResponses: ShiftResponseMap;
  /** True when the producer has flagged this person as needing a
   *  hotel for the run. Derived from `hotelDates.length > 0` for
   *  both gig and local rows. */
  hotelRequired: boolean;
  /** Per-day hotel nights, sorted ISO YYYY-MM-DD strings. Always a
   *  subset of `assignedDates`. Empty when the producer hasn't
   *  picked any nights for this person. */
  hotelDates: string[];
  dietaryTags: DietaryTag[];
  /** Free-text allergens the freelancer typed in their profile,
   *  pre-split by the server. Empty for local rows. */
  allergens: string[];
  /** True when the freelancer accepted the gig but hasn't filled
   *  out a profile yet. The component shows a "no profile" hint so
   *  the PM knows the dietary/allergen blanks aren't a real "no
   *  allergies" answer. */
  profileless: boolean;
  /** Phone number from the freelancer's profile. Empty string when
   *  not filled out (or on local rows where the producer hasn't
   *  collected it). The master sheet renders it as a `tel:` link
   *  when non-empty so the PM can call from a mobile browser. */
  phone: string;
  /** Stable internal room id from the pairing engine. Two crew with
   *  the same `roomKey` share a room. `null` when this person isn't
   *  in the pairing set (hotelRequired=false) or no pairing has
   *  been computed yet. The master sheet doesn't show this directly
   *  — it uses `roommateName` instead — but it's exposed for the
   *  print export which prints "Room 1, 2, …" labels. */
  roomKey: string | null;
  /** Display name(s) of the people sharing this person's room.
   *  Joined with " / " for 3+ share rooms. `null` when this person
   *  is solo or has no room assigned. Computed server-side from
   *  the pairing engine + room locks so the master sheet stays
   *  consistent with the Hotel page. */
  roommateName: string | null;
  /** Per-day rate the producer typed locally in NOK. Carried through
   *  even for gig-backed rows so the call sheet still shows a
   *  number. 0 when unknown. */
  dayRate: number;
  /** Free-text notes from the producer's local row. Carried through
   *  for gig-backed rows the same way `dayRate` is. */
  notes: string;
};

/** Single gig row as returned by the server endpoint. Mirrors the
 *  shape produced in `portalBriefs.ts` — keep in sync. */
export type RosterGig = {
  gigId: string;
  briefAssignmentId?: string | null;
  crewId?: string | null;
  freelancerUserId: string;
  name: string;
  role: string;
  status: RosterGigStatus;
  assignedDates: string[];
  callTime: string;
  offTime: string;
  assignedShiftPhases: string[];
  assignedShiftTimes: Record<string, { startTime: string; endTime: string }>;
  assignedShiftWindows: Record<
    string,
    Array<{ startTime: string; endTime: string }>
  >;
  assignedShiftTasks: Record<string, string[]>;
  shiftResponses?: ShiftResponseMap | null;
  declineReason: string | null;
  hotelRequired: boolean;
  hotelDates: string[];
  dietaryTags: DietaryTag[];
  allergens: string[];
  profileless: boolean;
  phone: string;
  roomKey: string | null;
  roommateName: string | null;
};

export type RosterResponse = {
  ok: true;
  brief: {
    id: string;
    projectName: string;
    venue: string;
    startDate: string | null;
    endDate: string | null;
  };
  crew: RosterGig[];
  projectDays: string[];
  categories: ReadonlyArray<DietaryTag>;
};

/** Normalise a name so two slightly-different spellings (extra space,
 *  different case) match for legacy-row fallback. */
function normName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Merge the server roster with the producer's local CrewMember[]
 *  into one canonical list. See module doc for the dedupe rules. */
export function mergeRoster(
  localCrew: ReadonlyArray<CrewMember>,
  rosterResponse: RosterResponse | null,
): RosterRow[] {
  const gigs = rosterResponse?.crew ?? [];

  // Index local rows two ways so the gig pass can find them in O(1).
  const localById = new Map<string, CrewMember>();
  const localByName = new Map<string, CrewMember>();
  // Track which local rows have been folded into a gig row so the
  // second pass knows which ones still need their own RosterRow.
  const consumedLocalIds = new Set<string>();
  for (const m of localCrew) {
    if (m.freelancerUserId) localById.set(m.freelancerUserId, m);
    if (m.name) {
      const key = normName(m.name);
      // First write wins — if two local rows share a name we'd
      // rather keep the one the producer typed first.
      if (key && !localByName.has(key)) localByName.set(key, m);
    }
  }

  const out: RosterRow[] = [];

  for (const g of gigs) {
    const matchedLocal = localCrew.find((m) =>
      (g.briefAssignmentId && m.briefAssignmentId === g.briefAssignmentId) ||
      (g.crewId && m.id === g.crewId),
    ) ?? localById.get(g.freelancerUserId) ??
      (g.name ? localByName.get(normName(g.name)) : undefined);
    if (matchedLocal) consumedLocalIds.add(matchedLocal.id);

    const row: RosterRow = {
      source: "gig",
      id: g.gigId,
      gigId: g.gigId,
      briefAssignmentId: g.briefAssignmentId ?? null,
      crewId: g.crewId ?? null,
      declineReason: g.declineReason ?? matchedLocal?.declineReason ?? null,
      freelancerUserId: g.freelancerUserId,
      name: g.name,
      // Producer's typed role wins when present — they may have
      // filed this person under "Stage Hand" even though the
      // freelancer's profile says "Stage". Fall back to the gig role
      // (which is what the server seeded the gig with at accept time)
      // so a freelancer the producer never re-categorised still has
      // a sensible label.
      role: matchedLocal?.role ?? g.role,
      status:
        Object.values(g.shiftResponses ?? {}).includes("accepted") &&
        Object.values(g.shiftResponses ?? {}).includes("declined")
          ? "partially_accepted"
          : g.status,
      assignedDates: [...(g.assignedDates ?? [])],
      callTime: g.callTime || matchedLocal?.callTime || "",
      offTime: g.offTime || matchedLocal?.offTime || "",
      assignedShiftPhases:
        (g.assignedShiftPhases ?? []).length > 0
          ? [...(g.assignedShiftPhases ?? [])]
          : [...(matchedLocal?.assignedShiftPhases ?? [])],
      assignedShiftTimes:
        Object.keys(g.assignedShiftTimes ?? {}).length > 0
          ? { ...(g.assignedShiftTimes ?? {}) }
          : { ...(matchedLocal?.assignedShiftTimes ?? {}) },
      assignedShiftWindows:
        Object.keys(g.assignedShiftWindows ?? {}).length > 0
          ? Object.fromEntries(
              Object.entries(g.assignedShiftWindows ?? {}).map(([key, windows]) => [
                key,
                windows.map((window) => ({ ...window })),
              ]),
            )
          : Object.fromEntries(
              Object.entries(matchedLocal?.assignedShiftWindows ?? {}).map(
                ([key, windows]) => [
                  key,
                  windows.map((window) => ({ ...window })),
                ],
              ),
            ),
      assignedShiftTasks:
        Object.keys(g.assignedShiftTasks ?? {}).length > 0
          ? Object.fromEntries(
              Object.entries(g.assignedShiftTasks ?? {}).map(([key, tasks]) => [
                key,
                [...tasks],
              ]),
            )
          : Object.fromEntries(
              Object.entries(matchedLocal?.assignedShiftTasks ?? {}).map(
                ([key, tasks]) => [key, [...tasks]],
              ),
            ),
      shiftResponses: { ...(g.shiftResponses ?? {}) },
      hotelRequired: g.hotelRequired ?? false,
      hotelDates: [...(g.hotelDates ?? [])],
      dietaryTags: [...(g.dietaryTags ?? [])],
      allergens: [...(g.allergens ?? [])],
      profileless: g.profileless ?? false,
      phone: g.phone ?? "",
      roomKey: g.roomKey ?? null,
      roommateName: g.roommateName ?? null,
      dayRate: matchedLocal?.dayRate ?? 0,
      notes: matchedLocal?.notes ?? "",
    };
    out.push(row);
  }

  for (const m of localCrew) {
    if (consumedLocalIds.has(m.id)) continue;
    out.push({
      source: "local",
      id: m.id,
      gigId: null,
      freelancerUserId: m.freelancerUserId ?? null,
      declineReason: m.declineReason ?? null,
      name: m.name,
      role: m.role,
      // A local row with no gig match either:
      //   - has a requestStatus → it's a pending invite (requested,
      //     declined, no-reply, too_late). Surface that state.
      //   - has no requestStatus → it's an in-house manual row.
      status: m.requestStatus ?? "manual",
      // Local rows carry their own `assignedDates` (defaulted to the
      // full project schedule on add, editable per row via day-chip
      // toggles). Falls back to [] for legacy rows persisted before
      // this field existed.
      assignedDates: m.assignedDates ? [...m.assignedDates] : [],
      callTime: m.callTime,
      offTime: m.offTime,
      assignedShiftPhases: [...(m.assignedShiftPhases ?? [])],
      assignedShiftTimes: { ...(m.assignedShiftTimes ?? {}) },
      assignedShiftWindows: Object.fromEntries(
        Object.entries(m.assignedShiftWindows ?? {}).map(([key, windows]) => [
          key,
          windows.map((window) => ({ ...window })),
        ]),
      ),
      assignedShiftTasks: Object.fromEntries(
        Object.entries(m.assignedShiftTasks ?? {}).map(([key, tasks]) => [
          key,
          [...tasks],
        ]),
      ),
      shiftResponses: { ...(m.shiftResponses ?? {}) },
      // Local rows now carry a producer-set `needsHotel` flag so
      // in-house / manual people can be ticked for hotel without
      // having to go through the portal accept flow first. Now
      // derived from `hotelDates.length > 0` so the picker and the
      // boolean stay in lockstep.
      hotelRequired: (m.hotelDates ?? []).length > 0 || !!m.needsHotel,
      hotelDates: m.hotelDates ? [...m.hotelDates] : [],
      // Portal-sourced rows (added via the Available Crew sidebar)
      // carry phone / dietary / allergens copied from the freelancer's
      // profile, so the producer sees their contact info immediately
      // — no waiting for accept. Manual rows have these unset and
      // render as a muted dash.
      dietaryTags: (m.dietaryTags ?? []) as DietaryTag[],
      allergens: m.allergens ?? [],
      profileless: false,
      phone: m.phone ?? "",
      roomKey: null,
      roommateName: null,
      dayRate: m.dayRate,
      notes: m.notes,
    });
  }

  // Stable sort: gig-backed rows (people we've actually committed
  // to) come first, then pending requests, then manual rows. Within
  // each bucket, alphabetical by name so the table is scannable.
  const bucketRank = (r: RosterRow): number => {
    if (r.source === "gig") return 0;
    if (r.status === "manual") return 2;
    return 1; // pending invites
  };
  out.sort((a, b) => {
    const ra = bucketRank(a);
    const rb = bucketRank(b);
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });

  return out;
}

/** Render a list of YYYY-MM-DD dates as compact day-chips for the
 *  roster table. Each chip is the two-letter weekday in the brief's
 *  locale (Norwegian Bokmål). When the brief's full project window
 *  is provided the result includes muted "off" days too so the eye
 *  can spot gaps; otherwise only the assigned days are returned. */
export type DayChip = {
  /** YYYY-MM-DD. */
  date: string;
  /** Two-letter weekday label, e.g. "ma", "ti", "on", "to", "fr",
   *  "lø", "sø". Locale-fixed so the table looks the same across
   *  every PM's machine. */
  label: string;
  /** True when this date is in `assignedDates`. */
  on: boolean;
};

const NB_WEEKDAY_2 = ["sø", "ma", "ti", "on", "to", "fr", "lø"];

/** UTC day-of-week so we don't shift by the PM's local timezone. */
function utcWeekdayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "??";
  return NB_WEEKDAY_2[d.getUTCDay()] ?? "??";
}

export function buildDayChips(
  assignedDates: ReadonlyArray<string>,
  projectDays: ReadonlyArray<string> | null,
): DayChip[] {
  const assignedSet = new Set(assignedDates);
  if (projectDays && projectDays.length > 0) {
    return projectDays.map((d) => ({
      date: d,
      label: utcWeekdayShort(d),
      on: assignedSet.has(d),
    }));
  }
  // No project window → just render the assigned days. Sort defensively;
  // the server already sorts but a hand-typed test fixture might not.
  const sorted = [...assignedDates].sort();
  return sorted.map((d) => ({
    date: d,
    label: utcWeekdayShort(d),
    on: true,
  }));
}
