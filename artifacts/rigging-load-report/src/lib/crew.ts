/** Crew Report — data model, defaults and totals.
 *
 *  A "crew member" is a single person on the call sheet. The Crew tab is
 *  intentionally simple: a flat list with name, department/role, call &
 *  off times, day rate (NOK) and free-form notes. Totals are derived
 *  (count, person-hours, cost) and shown on the tab dashboard.
 *
 *  All money values are in NOK (Norwegian kroner). The Production Tool is
 *  Norway-based; the Freelance Portal continues to display freelancer
 *  earnings in NOK as well, so the two stay consistent. */

export const CREW_ROLES = [
  "Rigging",
  "Lighting",
  "Lighting FOH",
  "Video / LED",
  "AV FOH",
  "Sound",
  "System Tech",
  "Stage",
  "Stage Hand",
  "Driver",
  "Project Manager",
  "Other",
] as const;

export type CrewRole = (typeof CREW_ROLES)[number];

/** State of the request/accept loop for a crew member that originated
 *  from "Send requests" on the Available Crew sidebar. Manually-added
 *  in-house rows leave this `undefined` and never show a pill. */
export const CREW_REQUEST_STATUSES = [
  "requested",
  "accepted",
  "partially_accepted",
  "declined",
  "no-reply",
  // First-to-accept-wins: when a sibling candidate accepts the same
  // brief first, every still-pending row flips to `too_late` so the
  // producer can see at a glance which freelancers were beaten to it.
  "too_late",
] as const;
export type CrewRequestStatus = (typeof CREW_REQUEST_STATUSES)[number];

/** Presentation metadata for the Crew tab status pill. Co-located with
 *  the type so producers can't drift between "what statuses exist" and
 *  "how do we render them". */
export const CREW_REQUEST_STATUS_META: Record<
  CrewRequestStatus,
  {
    labelKey:
      | "crew.status.requested"
      | "crew.status.accepted"
      | "crew.status.partiallyAccepted"
      | "crew.status.declined"
      | "crew.status.noReply"
      | "crew.status.tooLate";
    tone: "warn" | "ok" | "muted" | "bad";
  }
> = {
  requested: { labelKey: "crew.status.requested", tone: "warn" },
  accepted: { labelKey: "crew.status.accepted", tone: "ok" },
  partially_accepted: {
    labelKey: "crew.status.partiallyAccepted",
    tone: "warn",
  },
  declined: { labelKey: "crew.status.declined", tone: "muted" },
  "no-reply": { labelKey: "crew.status.noReply", tone: "bad" },
  too_late: { labelKey: "crew.status.tooLate", tone: "bad" },
};

export type CrewMember = {
  id: string;
  /** Crew member's full name (free text). */
  name: string;
  /** Department. Drives the per-department breakdown on the dashboard. */
  role: CrewRole;
  /** Call time as "HH:MM" 24-h, or empty string when not yet scheduled. */
  callTime: string;
  /** Off time as "HH:MM" 24-h. If earlier than callTime, the shift is
   *  treated as crossing midnight (call 22:00 → off 02:00 = 4 h). */
  offTime: string;
  /** Day rate in NOK (Norwegian kroner). 0 for unpaid / in-house crew. */
  dayRate: number;
  /** Free-form notes (e.g. "Has IPAF licence", "Half-day"). */
  notes: string;
  /** Clerk user id of the freelancer this row was created for. Set when
   *  the row was added via "Send requests" on the Available Crew
   *  sidebar; manual in-house rows leave it undefined. */
  freelancerUserId?: string;
  /** Pill state on the Crew Report. Undefined for manual rows so the
   *  status column simply reads "—" for in-house people. */
  requestStatus?: CrewRequestStatus;
  /** Server id of the brief_assignments row backing this crew member.
   *  Used by the producer's poll loop to correlate accept/decline
   *  responses with the right local row. */
  briefAssignmentId?: string;
  /** YYYY-MM-DD strings the producer has assigned this person to work.
   *  Defaulted on creation to the project's full schedule (load-in →
   *  load-out) so a freshly added crew member is "on for the whole
   *  run" by default. The producer can untick individual day-chips on
   *  the Crew tab to drop a person off specific days. */
  assignedDates?: string[];
  /** UI-level shift selections keyed as `YYYY-MM-DD::phase`.
   *  This keeps overlapping phases on the same calendar day independent
   *  while `assignedDates` remains the backwards-compatible API payload. */
  assignedShiftPhases?: string[];
  /** Exact project-schedule times keyed by `YYYY-MM-DD::phase`.
   *  Additive to the legacy row-level call/off summary. */
  assignedShiftTimes?: Record<
    string,
    { startTime: string; endTime: string }
  >;
  /** One or more call windows keyed by `YYYY-MM-DD::phase`.
   *  When absent, assignedShiftTimes is treated as a single window. */
  assignedShiftWindows?: Record<
    string,
    Array<{ startTime: string; endTime: string }>
  >;
  /** Producer-assigned task/focus labels keyed by `YYYY-MM-DD::phase`. */
  assignedShiftTasks?: Record<string, string[]>;
  /** Freelancer responses for each date/phase/window slot. */
  shiftResponses?: Record<string, "accepted" | "declined">;
  /** Contact phone copied from the freelancer's portal profile when
   *  the row was added via the Available Crew sidebar. Empty string
   *  for manual in-house rows. */
  phone?: string;
  /** Dietary tags pre-classified by the server from the freelancer's
   *  free-text dietary string (e.g. ["vegan"], ["halal"]). Surfaces
   *  in the master sheet Food column. */
  dietaryTags?: string[];
  /** Pre-split allergens copied from the freelancer's portal profile
   *  (e.g. ["Nøtter"], ["Skalldyr"]). Surfaces alongside dietaryTags. */
  allergens?: string[];
  /** Producer-set flag: this crew member needs a hotel for the run.
   *  Tracked locally so manual / in-house rows (which never go
   *  through the gig accept flow) can still be ticked for hotel.
   *  Gig-backed rows continue to use the server-side
   *  `gigs.hotelRequired` column instead — see `mergeRoster`. */
  needsHotel?: boolean;
  /** Per-day hotel nights for this crew member. Always a subset of
   *  `assignedDates` — the Crew tab's hotel quick-pick enforces this.
   *  Empty array means no hotel. `needsHotel` is treated as derived
   *  (`hotelDates.length > 0`) but the boolean is kept around for
   *  back-compat with the older toggle. */
  hotelDates?: string[];
};

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Build a fresh crew member with sensible defaults. */
export function makeCrewMember(name = ""): CrewMember {
  return {
    id: newId("crew"),
    name,
    role: "Rigging",
    callTime: "08:00",
    offTime: "18:00",
    dayRate: 0,
    notes: "",
  };
}

/** Coerce an unknown value (from localStorage / hand-edited JSON) into a
 *  valid CrewMember. Bad fields fall back to the makeCrewMember default
 *  rather than throwing. */
export function normalizeCrewMember(raw: unknown): CrewMember {
  const base = makeCrewMember();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const role =
    typeof r.role === "string" && (CREW_ROLES as readonly string[]).includes(r.role)
      ? (r.role as CrewRole)
      : base.role;
  const dayRate =
    typeof r.dayRate === "number" && Number.isFinite(r.dayRate) && r.dayRate >= 0
      ? r.dayRate
      : base.dayRate;
  const requestStatus =
    typeof r.requestStatus === "string" &&
    (CREW_REQUEST_STATUSES as readonly string[]).includes(r.requestStatus)
      ? (r.requestStatus as CrewRequestStatus)
      : undefined;
  return {
    id: typeof r.id === "string" && r.id ? r.id : base.id,
    name: typeof r.name === "string" ? r.name : base.name,
    role,
    // Preserve a deliberately-cleared blank time across reloads. Only fall
    // back to the default time when the stored value is missing entirely
    // or unrecognised (so crewHours() keeps returning 0 after a refresh).
    callTime: normalizeTimeField(r.callTime, base.callTime),
    offTime: normalizeTimeField(r.offTime, base.offTime),
    dayRate,
    notes: typeof r.notes === "string" ? r.notes : base.notes,
    freelancerUserId:
      typeof r.freelancerUserId === "string" && r.freelancerUserId
        ? r.freelancerUserId
        : undefined,
    requestStatus,
    briefAssignmentId:
      typeof r.briefAssignmentId === "string" && r.briefAssignmentId
        ? r.briefAssignmentId
        : undefined,
    shiftResponses:
      r.shiftResponses &&
      typeof r.shiftResponses === "object" &&
      !Array.isArray(r.shiftResponses)
        ? (Object.fromEntries(
            Object.entries(r.shiftResponses as Record<string, unknown>).filter(
              ([key, value]) =>
                /^\d{4}-\d{2}-\d{2}::(?:setup|rehearsal|show|downrig|day)::\d+$/.test(
                  key,
                ) &&
                (value === "accepted" || value === "declined"),
            ),
          ) as Record<string, "accepted" | "declined">)
        : undefined,
    hotelDates: Array.isArray(r.hotelDates)
      ? (r.hotelDates as unknown[])
          .filter(
            (d): d is string =>
              typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
          )
      : undefined,
    needsHotel:
      typeof r.needsHotel === "boolean"
        ? r.needsHotel
        : Array.isArray(r.hotelDates) && r.hotelDates.length > 0,
    assignedDates: Array.isArray(r.assignedDates)
      ? (r.assignedDates as unknown[])
          .filter(
            (d): d is string =>
              typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d),
          )
          .sort()
      : undefined,
    assignedShiftPhases: Array.isArray(r.assignedShiftPhases)
      ? (r.assignedShiftPhases as unknown[])
          .filter(
            (value): value is string =>
              typeof value === "string" &&
              /^\d{4}-\d{2}-\d{2}::(setup|rehearsal|show|downrig)$/.test(value),
          )
          .sort()
      : undefined,
    assignedShiftTimes:
      r.assignedShiftTimes &&
      typeof r.assignedShiftTimes === "object" &&
      !Array.isArray(r.assignedShiftTimes)
        ? Object.fromEntries(
            Object.entries(
              r.assignedShiftTimes as Record<string, unknown>,
            ).flatMap(([key, value]) => {
              if (
                !/^\d{4}-\d{2}-\d{2}::(setup|rehearsal|show|downrig)$/.test(
                  key,
                ) ||
                !value ||
                typeof value !== "object"
              ) {
                return [];
              }
              const timing = value as Record<string, unknown>;
              return typeof timing.startTime === "string" &&
                isValidHHMM(timing.startTime) &&
                typeof timing.endTime === "string" &&
                isValidHHMM(timing.endTime)
                ? [
                    [
                      key,
                      {
                        startTime: timing.startTime,
                        endTime: timing.endTime,
                      },
                    ],
                  ]
                : [];
            }),
          )
        : undefined,
    assignedShiftWindows:
      r.assignedShiftWindows &&
      typeof r.assignedShiftWindows === "object" &&
      !Array.isArray(r.assignedShiftWindows)
        ? Object.fromEntries(
            Object.entries(
              r.assignedShiftWindows as Record<string, unknown>,
            ).flatMap(([key, value]) => {
              if (
                !/^\d{4}-\d{2}-\d{2}::(setup|rehearsal|show|downrig)$/.test(
                  key,
                ) ||
                !Array.isArray(value)
              ) {
                return [];
              }
              const windows = value.flatMap((rawWindow) => {
                if (
                  !rawWindow ||
                  typeof rawWindow !== "object" ||
                  Array.isArray(rawWindow)
                ) {
                  return [];
                }
                const window = rawWindow as Record<string, unknown>;
                return typeof window.startTime === "string" &&
                  isValidHHMM(window.startTime) &&
                  typeof window.endTime === "string" &&
                  isValidHHMM(window.endTime)
                  ? [{
                      startTime: window.startTime,
                      endTime: window.endTime,
                    }]
                  : [];
              }).slice(0, 12);
              return windows.length ? [[key, windows]] : [];
            }),
          )
        : undefined,
    assignedShiftTasks:
      r.assignedShiftTasks &&
      typeof r.assignedShiftTasks === "object" &&
      !Array.isArray(r.assignedShiftTasks)
        ? Object.fromEntries(
            Object.entries(
              r.assignedShiftTasks as Record<string, unknown>,
            ).flatMap(([key, value]) =>
              /^\d{4}-\d{2}-\d{2}::(setup|rehearsal|show|downrig)$/.test(key) &&
              Array.isArray(value)
                ? [[
                    key,
                    value
                      .filter((task): task is string => typeof task === "string")
                      .map((task) => task.trim())
                      .filter(Boolean)
                      .slice(0, 20),
                  ]]
                : [],
            ),
          )
        : undefined,
    phone: typeof r.phone === "string" ? r.phone : undefined,
    dietaryTags: Array.isArray(r.dietaryTags)
      ? (r.dietaryTags as unknown[]).filter(
          (t): t is string => typeof t === "string",
        )
      : undefined,
    allergens: Array.isArray(r.allergens)
      ? (r.allergens as unknown[]).filter(
          (t): t is string => typeof t === "string",
        )
      : undefined,
  };
}

/** Expand a [start, end] inclusive YYYY-MM-DD range into the full list
 *  of day strings between them. Returns [] when either bound is empty
 *  or the range is invalid. Used to seed `assignedDates` on freshly
 *  added crew so the new row is "on for the whole project" by default. */
export function expandProjectDays(
  startDate: string,
  endDate: string,
): string[] {
  if (!startDate) return [];
  const endIso = endDate || startDate;
  const s = new Date(`${startDate}T00:00:00Z`);
  const e = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return [];
  if (e < s) return [];
  const out: string[] = [];
  const cur = new Date(s);
  // Hard cap at 60 days defensively — no real production schedule is
  // longer, and an accidental year-long range shouldn't blow up the
  // assigned-dates array.
  for (let i = 0; i < 60 && cur <= e; i += 1) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Minimal shape of a project-schedule segment, mirrored from
 *  ScheduleSegment in App.tsx. Duplicated here so this lib doesn't
 *  pull in the App.tsx graph. Each segment covers a date range
 *  (inclusive) plus an optional time-of-day window. */
export type ScheduleTimeSegment = {
  from: string;
  to: string;
  fromTime?: string;
  toTime?: string;
};

/** Project-wide schedule keyed by phase ("setup" / "rehearsal" /
 *  "show" / "downrig"), each phase carrying one or more segments. */
export type ScheduleTimeMap = Partial<
  Record<string, ReadonlyArray<ScheduleTimeSegment>>
>;

/** Pick the earliest call-time and the latest off-time across the
 *  project-schedule segments that cover any of the given assigned
 *  dates. Used to auto-fill a crew member's `callTime`/`offTime`
 *  whenever the producer changes which days that person is working,
 *  so the row's hours always match the schedule of the days that are
 *  ticked on. Falls back to the supplied defaults (typically the
 *  CrewMember's existing call/off) when no segment covers any of the
 *  dates or no times are set on the matching segments.
 *
 *  Notes:
 *  - Date matching is plain ISO YYYY-MM-DD lex compare against the
 *    segment's [from..to] range, so timezone-free.
 *  - "Earliest call" / "latest off" handles a multi-phase day (e.g. a
 *    show day where Setup runs 08:00 and Show runs through 23:00) by
 *    spanning both phases — the resulting shift covers the full
 *    on-site window without the producer having to compute it. */
export function pickScheduleTimesForDates(
  dates: ReadonlyArray<string>,
  schedule: ScheduleTimeMap,
  defaults: { callTime: string; offTime: string },
): { callTime: string; offTime: string } {
  if (!dates || dates.length === 0) return defaults;
  let earliestCallMin = Number.POSITIVE_INFINITY;
  let latestOffMin = Number.NEGATIVE_INFINITY;
  let earliestCall = "";
  let latestOff = "";
  for (const phase of Object.values(schedule)) {
    if (!phase) continue;
    for (const seg of phase) {
      const from = seg.from || "";
      const to = seg.to || from;
      if (!from) continue;
      // Does any assigned day fall inside this segment's date range?
      const covered = dates.some((d) => d >= from && d <= to);
      if (!covered) continue;
      if (seg.fromTime && isValidHHMM(seg.fromTime)) {
        const m = hhmmToMin(seg.fromTime);
        if (m < earliestCallMin) {
          earliestCallMin = m;
          earliestCall = seg.fromTime;
        }
      }
      if (seg.toTime && isValidHHMM(seg.toTime)) {
        const m = hhmmToMin(seg.toTime);
        if (m > latestOffMin) {
          latestOffMin = m;
          latestOff = seg.toTime;
        }
      }
    }
  }
  return {
    callTime: earliestCall || defaults.callTime,
    offTime: latestOff || defaults.offTime,
  };
}

function normalizeTimeField(raw: unknown, fallback: string): string {
  if (raw === "" || isValidHHMM(raw)) return raw as string;
  return fallback;
}

function isValidHHMM(v: unknown): boolean {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Convert a "HH:MM" time string into minutes from midnight. Returns
 *  NaN for blanks/invalid strings. */
function hhmmToMin(t: string): number {
  if (!isValidHHMM(t)) return NaN;
  const [h, m] = t.split(":").map((s) => Number(s));
  return h * 60 + m;
}

/** Length of a single crew shift in hours. Off-time earlier than call-time
 *  is interpreted as crossing midnight (e.g. call 22:00 → off 02:00 → 4 h).
 *  Returns 0 when either endpoint is missing/invalid. */
export function crewHours(m: CrewMember): number {
  const a = hhmmToMin(m.callTime);
  const b = hhmmToMin(m.offTime);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  let diff = b - a;
  if (diff < 0) diff += 24 * 60; // wrap past midnight
  return diff / 60;
}

export type CrewTotals = {
  /** Total number of crew members on the list. */
  count: number;
  /** Sum of every crew member's shift length, in hours. */
  totalHours: number;
  /** Sum of every crew member's day rate, in NOK. */
  totalCost: number;
  /** Headcount per department. Always contains every CrewRole key. */
  countsByRole: Record<CrewRole, number>;
  /** Cost per department, in NOK. Always contains every CrewRole key. */
  costsByRole: Record<CrewRole, number>;
};

/** Build the empty totals object with every role pre-seeded to 0. */
function emptyTotals(): CrewTotals {
  const countsByRole = {} as Record<CrewRole, number>;
  const costsByRole = {} as Record<CrewRole, number>;
  for (const r of CREW_ROLES) {
    countsByRole[r] = 0;
    costsByRole[r] = 0;
  }
  return { count: 0, totalHours: 0, totalCost: 0, countsByRole, costsByRole };
}

/** Shared NOK day-rate formatter used everywhere a crew member's rate
 *  is shown to the user (Crew Report dashboard + table, brief share
 *  modal sublabels, portal "My assignment" pill, portal brief detail).
 *  Uses the Norwegian Bokmål locale so the output reads as "kr 5 000". */
export function formatCrewDayRate(n: number): string {
  if (!Number.isFinite(n)) return "kr 0";
  return Math.round(n).toLocaleString("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  });
}

export function computeCrewTotals(crew: CrewMember[]): CrewTotals {
  const t = emptyTotals();
  for (const m of crew) {
    t.count += 1;
    t.totalHours += crewHours(m);
    t.totalCost += m.dayRate;
    t.countsByRole[m.role] += 1;
    t.costsByRole[m.role] += m.dayRate;
  }
  return t;
}
