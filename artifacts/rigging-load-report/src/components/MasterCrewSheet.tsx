import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  buildDayChips,
  mergeRoster,
  type RosterResponse,
  type RosterRow,
  type DietaryTag,
} from "../lib/crewRoster";
import {
  CREW_ROLES,
  type CrewMember,
  type CrewRole,
  type CrewRequestStatus,
} from "../lib/crew";
import { NumberField } from "./NumberField";
import { openMasterSheet, type MasterSheetRow } from "../lib/masterSheetExport";
import { exportDailyCallSheet } from "../lib/dailyCallSheetExport";
import {
  crewWorkAlertsForSources,
  formatWorkHours,
  type CrewWorkAlert,
} from "../lib/crewRestAlerts";
import {
  assignedDatesFromShiftPhases,
  crewShiftAssignmentKey,
  filterShiftSelectionsToSchedule,
  firstShiftTimesFromWindows,
  scheduledShiftKeys,
  shiftWindowsForSelections,
  shiftWindowsWithLegacyFallback,
  shiftTimesForSelections,
  summarizeShiftTimes,
  summarizeShiftWindows,
  type CrewShiftPhaseKey,
  type CrewShiftTimeMap,
  type CrewShiftWindowMap,
} from "../lib/crewShiftAssignments";
import { useI18n, useT } from "../lib/i18n/I18nContext";
import { AssignShiftsModal } from "./AssignShiftsModal";
import { Copy } from "lucide-react";
import { toast } from "sonner";

export type FreelancerCandidate = {
  userId: string;
  fullName: string;
  primaryRole: string | null;
  city: string | null;
  phone?: string;
  dietaryTags?: string[];
  allergens?: string[];
};

const SHIFT_PHASES = [
  { key: "setup" },
  { key: "rehearsal" },
  { key: "show" },
  { key: "downrig" },
] as const;

function shiftMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60
    ? hours * 60 + minutes
    : null;
}

const TIMELINE_COLORS = [
  "#f97316",
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#dc2626",
  "#0891b2",
];

function roleColor(role: string): string {
  const index = [...role].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  return TIMELINE_COLORS[index % TIMELINE_COLORS.length]!;
}

/** Crew & Logistics master sheet — Phase C consolidation.
 *
 *  This component is the SINGLE source of truth for the producer's
 *  Crew & Logistics tab. It replaces the previous split between
 *  `RosterTable` (portal/gig data) and the inline call-sheet table
 *  in `CrewReportView` (local CrewMember edit grid). One wide table,
 *  one row per person, every column a producer needs.
 *
 *  Why one component:
 *    - Producers kept asking "where's the hotel/food/phone — I have
 *      to click around four tabs". Folding portal data + local edit
 *      grid into one table fixes that.
 *    - The merge logic in `lib/crewRoster.ts` already deduplicates
 *      gig-vs-local rows (by `freelancerUserId`, falling back to a
 *      name match). We just had two tables rendering the same merged
 *      data with different column subsets, which was confusing.
 *
 *  Editing model:
 *    - Gig-backed rows: hotel checkbox + day chips PATCH the server
 *      (`/hotel/:gigId` and `/roster/:gigId/dates`). Optimistic +
 *      refetch on settle, mirroring the previous RosterTable.
 *    - Local-only rows: name / role / notes / dayRate / call / off
 *      are managed via the producer's local CrewMember[] (callbacks
 *      bubble up to App.tsx the same way the old inline call sheet
 *      did). No server round-trip — these rows live in localStorage.
 *    - Gig-backed rows that ALSO have a matching local CrewMember
 *      (matched by freelancerUserId or name) inherit that local
 *      row's notes/dayRate via the merge — those fields are still
 *      editable through the local-update callback because the merge
 *      surfaces the local row's id via `row.id` when source==='local'
 *      OR the gig-row's matched local id when source==='gig'.
 *      Currently we keep edit affordances on the local-source rows
 *      only; making gig rows editable would require lazily creating
 *      a paired local CrewMember on first edit, which is out of
 *      scope for this consolidation pass.
 *
 *  Visible columns (always):
 *    Name · Role · Status · Days · Hotel · Food · Phone
 *    · Notes · Actions (local and linked booking rows)
 *
 *  "Show production details" toggle adds:
 *    Call · Off · Day rate
 *
 *  These are folded behind a toggle because casual producers
 *  planning a quick gig don't need them, but a touring PM doing a
 *  full call sheet does. Default OFF keeps the table from feeling
 *  spreadsheet-heavy on first open. */
export function MasterCrewSheet({
  briefId,
  getToken,
  localCrew,
  brief,
  onAdd,
  onUpdate,
  onSaveShifts,
  onRemove,
  onDuplicate,
  onSendLinkedRequests,
  sendingLinkedRequests = false,
  onReplaceRole,
  onRemoveBooking,
  onMergedRolesChange,
  onCountsChange,
  getTimesForDates,
  phaseDays,
  phaseShiftTimes,
  compactHeader = false,
  onOpenProfile,
  readOnly = false,
}: {
  /** Active brief id from App.tsx. When null/empty the sheet renders
   *  ONLY local crew (no portal data) and shows a friendly empty
   *  state nudging the user to pick a brief. */
  briefId: string | null;
  getToken: () => Promise<string | null>;
  localCrew: CrewMember[];
  /** Optional brief context for the print export header — name +
   *  venue. We pull these from the roster response when present, and
   *  fall back to whatever the parent threads in (so the print
   *  button is useful even before the brief is fetched once). */
  brief?: {
    projectName: string;
    venue: string;
    /** Optional call-sheet contacts. Existing name/venue-only callers remain valid. */
    clientContact?: { name?: string; phone?: string };
    productionContact?: { name?: string; phone?: string };
    venueContact?: { name?: string; phone?: string };
  };
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<CrewMember>) => void;
  onSaveShifts?: (id: string, patch: Partial<CrewMember>) => Promise<void>;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onSendLinkedRequests?: (members: CrewMember[]) => void | Promise<void>;
  sendingLinkedRequests?: boolean;
  /** Remove one exact freelancer account from one exact producer role
   *  slot. The parent serializes this with project autosave so a stale
   *  local payload cannot recreate the booking after the server DELETE. */
  onRemoveBooking?: (
    crewId: string,
    freelancerUserId: string,
  ) => void | Promise<void>;
  /** Invite a directory freelancer into a new row for one exact declined
   *  role. The declined row is never mutated or reused. */
  onReplaceRole?: (
    member: CrewMember,
    candidate: FreelancerCandidate,
  ) => void | Promise<void>;
  /** Optional callback fired whenever the merged roster changes.
   *  CrewReportView uses this to feed the AdequacyPanel with the
   *  full roster (gig + local) instead of just localCrew[], so the
   *  "you have 5 riggers, suggested 6–8" warning matches what the
   *  producer sees on screen. Without this callback the panel would
   *  count only local rows — fine before the consolidation, but
   *  confusing now that the master sheet is the visible roster. */
  onMergedRolesChange?: (roles: ReadonlyArray<string>) => void;
  /** Optional callback fired whenever the merged roster changes, with
   *  pre-computed totals the parent can render as a stat-card row.
   *  We compute these here (not in CrewReportView) because the merge
   *  + status classification already happens in this component — it
   *  would be wasteful to either re-merge upstream or expose the
   *  whole RosterRow[] just so the parent could re-derive what we
   *  already know. `hotelRooms` is `ceil(hotelCount / 2)` — the
   *  industry rule-of-thumb the producer reference UI uses, so the
   *  number on the card matches what they'd manually book. */
  onCountsChange?: (counts: {
    total: number;
    accepted: number;
    pending: number;
    /** Number of people who need at least one hotel night. We surface
     *  this as "rooms" on the stat card because the producer thinks
     *  in heads-needing-a-bed first; the rooming sheet still pairs
     *  twins separately. */
    hotelRooms: number;
    /** Sum of `hotelDates.length` across the roster — total bookable
     *  room-nights for the run. */
    hotelNights: number;
  }) => void;
  /** Returns the earliest call → latest off times for the given
   *  assigned days, derived from the project schedule (Setup /
   *  Rehearsal / Show / Load Out). When provided, day-chip toggles
   *  on local rows refresh callTime/offTime alongside assignedDates
   *  so the row's shift always matches the days that are ticked on.
   *  Optional — when undefined day toggles only patch assignedDates,
   *  preserving the previous behaviour. */
  getTimesForDates?: (
    dates: ReadonlyArray<string>,
    defaults: { callTime: string; offTime: string },
  ) => { callTime: string; offTime: string };
  /** Days covered by each schedule phase ("setup" / "rehearsal" /
   *  "show" / "downrig" → ISO date arrays). When provided, each
   *  local crew row gets one-click quick-pick buttons that fill the
   *  row's `assignedDates` from the chosen phase. Empty / missing
   *  phases simply hide their button so the row only shows phases
   *  the producer has actually scheduled. */
  phaseDays?: Partial<
    Record<CrewShiftPhaseKey, ReadonlyArray<string>>
  >;
  /** Exact project schedule times keyed by date+phase. */
  phaseShiftTimes?: CrewShiftTimeMap;
  /** When true, hide the duplicated `<h3>Crew & Logistics</h3>` +
   *  subtitle inside the master sheet's own header — the parent
   *  (CrewReportView) is rendering its own redesigned title row and
   *  doesn't need the duplicate. The right-side controls (toggle,
   *  Print, Add) are still rendered. */
  compactHeader?: boolean;
  onOpenProfile?: (userId: string) => void;
  /** Terminal projects remain visible for records, but crew changes and
   * request dispatch are intentionally unavailable. */
  readOnly?: boolean;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingByKey, setSavingByKey] = useState<Record<string, boolean>>({});
  const [showProductionDetails, setShowProductionDetails] = useState(false);
  const [portalCandidates, setPortalCandidates] = useState<
    ReadonlyArray<FreelancerCandidate>
  >([]);

  const baseUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    "/";

  const fetchRoster = useCallback(async (): Promise<RosterResponse | null> => {
    if (!briefId) return null;
    const token = await getToken();
    const res = await fetch(
      `${baseUrl}api/portal/briefs/${briefId}/roster`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) {
      const msg =
        res.status === 403
          ? t("crew.roster.error.notOwner")
          : res.status === 404
            ? t("crew.roster.error.notFound")
            : t("crew.roster.error.load");
      throw new Error(msg);
    }
    const json = (await res.json()) as
      | RosterResponse
      | { ok: false; error?: string };
    if (!json.ok) throw new Error(json.error ?? t("crew.roster.error.load"));
    return json;
  }, [briefId, getToken, baseUrl, t]);

  const cancelPendingRequest = useCallback(
    async (member: CrewMember) => {
      if (!briefId || !member.freelancerUserId) return;
      if (
        !window.confirm(
          t("crew.cancel.confirm", {
            name: member.name || t("crew.cancel.unnamed"),
          }),
        )
      ) {
        return;
      }
      const key = `cancel:${member.id}`;
      setSavingByKey((current) => ({ ...current, [key]: true }));
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}api/portal/briefs/${encodeURIComponent(briefId)}/assignments/${encodeURIComponent(member.id)}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              freelancerUserId: member.freelancerUserId,
            }),
          },
        );
        const result = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
        } | null;
        if (!response.ok || !result?.ok) {
          throw new Error(
            result?.error ?? t("crew.cancel.errorStatus", { status: response.status }),
          );
        }
        onRemove(member.id);
        toast.success(t("crew.cancel.success"));
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("crew.cancel.error"),
        );
      } finally {
        setSavingByKey((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    },
    [baseUrl, briefId, getToken, onRemove, t],
  );

  /** Remove a linked row from the active booking while leaving the server's
   *  assignment history intact. Pending request cancellation deliberately
   *  stays on the existing `cancelPendingRequest` path above. */
  const removeActiveBooking = useCallback(
    async (row: RosterRow, local: CrewMember | null) => {
      if (!onRemoveBooking) return;
      const crewId =
        row.crewId ??
        (row.source === "local" && local ? local.id : null);
      const freelancerUserId =
        row.freelancerUserId ?? local?.freelancerUserId ?? null;
      if (!crewId || !freelancerUserId) {
        const message = t("crew.remove.missingIdentity");
        setError(message);
        toast.error(message);
        return;
      }

      const accepted =
        row.status === "accepted" ||
        row.status === "confirmed" ||
        row.status === "done" ||
        row.status === "invoiced" ||
        row.status === "paid";
      if (
        accepted &&
        !window.confirm(
          t("crew.remove.confirm", {
            name: row.name || t("crew.cancel.unnamed"),
          }),
        )
      ) {
        return;
      }

      const key = `remove:${crewId}`;
      setSavingByKey((current) => ({ ...current, [key]: true }));
      try {
        await onRemoveBooking(crewId, freelancerUserId);
        if (local) onRemove(local.id);
        // Optimistically hide the exact role slot while the roster refetch
        // settles. Both identity fields are required so removing one role
        // never hides another role held by the same account.
        setData((previous) =>
          previous
            ? {
                ...previous,
                crew: previous.crew.filter(
                  (gig) =>
                    !(
                      gig.crewId === crewId &&
                      gig.freelancerUserId === freelancerUserId
                    ),
                ),
              }
            : previous,
        );
        const fresh = await fetchRoster().catch(() => null);
        if (fresh) {
          setData({
            ...fresh,
            crew: fresh.crew.filter(
              (gig) =>
                !(
                  gig.crewId === crewId &&
                  gig.freelancerUserId === freelancerUserId
                ),
            ),
          });
        }
        setError(null);
        toast.success(
          t("crew.remove.success", {
            name: row.name || t("crew.cancel.unnamed"),
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("crew.remove.error");
        setError(message);
        toast.error(message);
      } finally {
        setSavingByKey((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    },
    [fetchRoster, onRemove, onRemoveBooking, t],
  );

  // Fetch the structured directory once so selecting a suggestion can
  // link the row to an exact Clerk user id. Free text remains available
  // when the directory is unavailable or no candidate is selected.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${baseUrl}api/portal/freelancers`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          ok?: boolean;
          freelancers?: ReadonlyArray<FreelancerCandidate>;
        };
        if (cancelled || !body.ok || !Array.isArray(body.freelancers)) return;
        const candidates = body.freelancers
          .filter(
            (candidate) =>
              typeof candidate.userId === "string" &&
              candidate.userId.length > 0 &&
              typeof candidate.fullName === "string" &&
              candidate.fullName.trim().length > 0,
          )
          .map((candidate) => ({
            ...candidate,
            fullName: candidate.fullName.trim(),
          }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName));
        setPortalCandidates(candidates);
      } catch {
        // Silent — autocomplete is optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken, baseUrl]);

  // Polled fetch loop — same 60s cadence as Hotel/Catering. Skipped
  // entirely when no brief is active so the master sheet stays
  // useful as a pure local-crew editor before any portal brief is
  // pushed.
  useEffect(() => {
    if (!briefId) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const json = await fetchRoster();
        if (cancelled || !json) return;
        setData(json);
        setError(null);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t("crew.roster.error.load"));
        setLoading(false);
      }
    };
    void fetchOnce();
    const timer = window.setInterval(fetchOnce, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [briefId, fetchRoster, t]);

  const rows = useMemo(
    () => mergeRoster(localCrew, data),
    [localCrew, data],
  );
  const timelineDates = useMemo(
    () =>
      [
        ...new Set(
          Object.values(phaseDays ?? {}).flatMap((dates) => dates ?? []),
        ),
      ].sort(),
    [phaseDays],
  );
  const [timelineDate, setTimelineDate] = useState("");
  useEffect(() => {
    if (timelineDates.length === 0) {
      setTimelineDate("");
    } else if (!timelineDates.includes(timelineDate)) {
      setTimelineDate(timelineDates[0]!);
    }
  }, [timelineDate, timelineDates]);
  const timelineRows = useMemo(
    () =>
      rows.flatMap((row) => {
        const shiftWindows = shiftWindowsWithLegacyFallback(
          row.assignedShiftWindows,
          row.assignedShiftTimes,
        );
        const datedWindowEntries = Object.entries(shiftWindows)
          .filter(([key]) => key.startsWith(`${timelineDate}::`))
        const windows = datedWindowEntries
          .flatMap(([key, timings]) =>
            timings.flatMap((timing, windowIndex) => {
              if (
                row.shiftResponses[`${key}::${windowIndex}`] === "declined"
              ) {
                return [];
              }
              const start = shiftMinutes(timing.startTime);
              const end = shiftMinutes(timing.endTime);
              return start == null || end == null
                ? []
                : [{ ...timing, start, end }];
            }),
          );
        if (
          datedWindowEntries.length === 0 &&
          row.assignedDates.includes(timelineDate) &&
          row.shiftResponses[`${timelineDate}::day::0`] !== "declined"
        ) {
          const start = shiftMinutes(row.callTime);
          const end = shiftMinutes(row.offTime);
          if (start != null && end != null) {
            windows.push({
              startTime: row.callTime,
              endTime: row.offTime,
              start,
              end,
            });
          }
        }
        return windows.length > 0 ? [{ row, windows }] : [];
      }),
    [rows, timelineDate],
  );
  const workAlertIdentity = useCallback(
    (row: RosterRow) =>
      row.freelancerUserId
        ? `user:${row.freelancerUserId}`
        : `row:${row.source}:${row.id}`,
    [],
  );
  const workAlertsByPerson = useMemo(() => {
    const rowsByPerson = new Map<string, RosterRow[]>();
    for (const row of rows) {
      const key = workAlertIdentity(row);
      const personRows = rowsByPerson.get(key) ?? [];
      personRows.push(row);
      rowsByPerson.set(key, personRows);
    }
    const alerts = new Map<string, CrewWorkAlert[]>();
    for (const [key, personRows] of rowsByPerson) {
      const applicable = crewWorkAlertsForSources(personRows).filter(
        (alert) => alert.date === timelineDate,
      );
      if (applicable.length) alerts.set(key, applicable);
    }
    return alerts;
  }, [rows, timelineDate, workAlertIdentity]);
  const timelineWarningCount = useMemo(
    () => [...workAlertsByPerson.values()].reduce((total, alerts) => total + alerts.length, 0),
    [workAlertsByPerson],
  );

  // Bubble the merged roles up to CrewReportView so the AdequacyPanel
  // counts the SAME headcount the producer sees in the table. Without
  // this the panel was counting only local crew[] rows — fine in the
  // pre-consolidation UI where the call sheet was the producer's
  // source-of-truth, but visibly inconsistent now that the master
  // sheet shows merged gig+local rows. We snapshot just the role
  // strings (not the whole RosterRow array) to keep the dep narrow.
  const rolesKey = useMemo(
    () => rows.map((r) => r.role).join("\u0000"),
    [rows],
  );
  useEffect(() => {
    if (!onMergedRolesChange) return;
    onMergedRolesChange(rows.map((r) => r.role));
    // We intentionally key the effect on the joined-string snapshot
    // rather than `rows`, so a re-render that produces an
    // identical-shaped roster array doesn't fire the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey, onMergedRolesChange]);

  // Stat-card counts for the parent's redesigned header. Same key
  // strategy as roles above: snapshot to a string so we don't fire
  // the callback on identical re-renders. Status buckets mirror
  // statusTone(): "ok" tones count as accepted (confirmed/done/paid
  // also accepted-equivalent for the "we have a person" sense),
  // "warn" tones count as pending. `hotelRooms` uses the
  // industry-standard ceil(hotelCount / 2) rule so two crew sharing
  // a roommate count as one room — matches the producer reference.
  const countsKey = useMemo(() => {
    let total = 0;
    let accepted = 0;
    let pending = 0;
    let hotelRooms = 0;
    let hotelNights = 0;
    for (const r of rows) {
      total += 1;
      const tone = statusTone(r.status);
      if (tone === "ok") accepted += 1;
      else if (tone === "warn") pending += 1;
      // "Rooms" = people with at least one hotel night picked. The
      // producer wants heads, not paired-room counts — the rooming
      // sheet handles pairing separately. "Nights" = sum across all
      // people, which is what the hotel actually invoices.
      const nights = r.hotelDates.length;
      if (nights > 0) hotelRooms += 1;
      hotelNights += nights;
    }
    return `${total}|${accepted}|${pending}|${hotelRooms}|${hotelNights}`;
  }, [rows]);
  useEffect(() => {
    if (!onCountsChange) return;
    const [t, a, p, h, n] = countsKey.split("|").map((x) => Number(x));
    onCountsChange({
      total: t ?? 0,
      accepted: a ?? 0,
      pending: p ?? 0,
      hotelRooms: h ?? 0,
      hotelNights: n ?? 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countsKey, onCountsChange]);

  // Index local crew by id so a gig-backed row can resolve its
  // matched local row's id for the editable notes/dayRate cells.
  // The merge stores the matched local's `dayRate` and `notes` on
  // the gig row, but not the local row's id — so we re-derive it
  // here. O(localCrew) once, then O(1) lookups in the render.
  const localByMatch = useMemo(() => {
    const byId = new Map<string, CrewMember>();
    const byName = new Map<string, CrewMember>();
    for (const m of localCrew) {
      if (m.freelancerUserId) byId.set(m.freelancerUserId, m);
      if (m.name) {
        const k = m.name.trim().replace(/\s+/g, " ").toLowerCase();
        if (k && !byName.has(k)) byName.set(k, m);
      }
    }
    return { byId, byName };
  }, [localCrew]);

  const resolveLocalIdFor = useCallback(
    (row: RosterRow): string | null => {
      if (row.source === "local") return row.id;
      if (row.freelancerUserId) {
        const m = localByMatch.byId.get(row.freelancerUserId);
        if (m) return m.id;
      }
      if (row.name) {
        const k = row.name.trim().replace(/\s+/g, " ").toLowerCase();
        const m = localByMatch.byName.get(k);
        if (m) return m.id;
      }
      return null;
    },
    [localByMatch],
  );

  const patchGig = useCallback(async function patchGig(
    gigId: string,
    field: "hotel" | "dates",
    optimistic: Partial<{
      hotelRequired: boolean;
      hotelDates: string[];
      assignedDates: string[];
    }>,
    requestPath: string,
    body: object,
  ) {
    const key = `${gigId}:${field}`;
    setSavingByKey((m) => ({ ...m, [key]: true }));
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        crew: prev.crew.map((g) =>
          g.gigId === gigId ? { ...g, ...optimistic } : g,
        ),
      };
    });
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}${requestPath}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = t("crew.sheet.saveError");
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) detail = j.error;
        } catch {
          /* ignore JSON parse */
        }
        setError(detail);
      } else {
        setError(null);
      }
      const fresh = await fetchRoster().catch(() => null);
      if (fresh) setData(fresh);
    } catch {
      setError(t("crew.sheet.saveConnectionError"));
      const fresh = await fetchRoster().catch(() => null);
      if (fresh) setData(fresh);
    } finally {
      setSavingByKey((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
    }
  }, [getToken, baseUrl, fetchRoster, t]);

  const handleHotelToggle = useCallback(
    (gigId: string, hotelRequired: boolean) => {
      void patchGig(
        gigId,
        "hotel",
        { hotelRequired },
        `api/portal/briefs/${briefId}/hotel/${gigId}`,
        { hotelRequired },
      );
    },
    [briefId, patchGig],
  );

  /** Replace a gig row's `hotelDates` wholesale (used by the per-phase
   *  hotel quick-pick on the Crew tab). Server keeps `hotelRequired`
   *  in lockstep with `hotelDates.length > 0`, but we mirror that
   *  here too so the optimistic state matches what the refetch will
   *  return. */
  const handleHotelDatesSet = useCallback(
    (gigId: string, nextDates: ReadonlyArray<string>) => {
      const sorted = [...nextDates].sort();
      const hotelRequired = sorted.length > 0;
      void patchGig(
        gigId,
        "hotel",
        { hotelDates: sorted, hotelRequired },
        `api/portal/briefs/${briefId}/hotel/${gigId}`,
        { hotelDates: sorted },
      );
    },
    [briefId, patchGig],
  );

  const handleDayToggle = useCallback(
    (gigId: string, currentDates: string[], date: string) => {
      const set = new Set(currentDates);
      if (set.has(date)) set.delete(date);
      else set.add(date);
      const next = [...set].sort();
      void patchGig(
        gigId,
        "dates",
        { assignedDates: next },
        `api/portal/briefs/${briefId}/roster/${gigId}/dates`,
        { assignedDates: next },
      );
    },
    [briefId, patchGig],
  );

  const briefName = data?.brief.projectName ?? brief?.projectName ?? "";
  const venue = data?.brief.venue ?? brief?.venue ?? "";

  const handlePrint = useCallback(() => {
    // Build print-time rows: enrich each row with the matched local
    // CrewMember's call/off times when present, so the printed sheet
    // matches what the producer sees on screen with "Production
    // details" toggled on. Accepted-gig timing is used when there is
    // no matching local row.
    const printRows: MasterSheetRow[] = rows.map((row) => {
      const localId = resolveLocalIdFor(row);
      const local =
        localId !== null ? localCrew.find((m) => m.id === localId) : null;
      return {
        ...row,
        callTime: local?.callTime ?? row.callTime,
        offTime: local?.offTime ?? row.offTime,
      };
    });
    openMasterSheet({
      briefName,
      venue,
      rows: printRows,
      projectDays: data?.projectDays ?? [],
      showProductionDetails,
      locale,
      copy: {
        title: t("export.masterSheet.title"),
        documentTitle: t("export.masterSheet.documentTitle"),
        untitledBrief: t("export.masterSheet.untitledBrief"),
        generated: t("export.masterSheet.generated"),
        rosterCount: (count) => t("export.masterSheet.rosterCount", { count: count.toLocaleString(locale === "no" ? "nb-NO" : "en-US") }),
        hotelSummary: (rooms, nights) => `${rooms.toLocaleString(locale === "no" ? "nb-NO" : "en-US")} ${t(rooms === 1 ? "export.masterSheet.room" : "export.masterSheet.rooms")} · ${nights.toLocaleString(locale === "no" ? "nb-NO" : "en-US")} ${t(nights === 1 ? "export.masterSheet.night" : "export.masterSheet.nights")}`,
        empty: t("export.masterSheet.empty"),
        table: {
          name: t("export.masterSheet.table.name"), role: t("export.masterSheet.table.role"),
          status: t("export.masterSheet.table.status"), days: t("export.masterSheet.table.days"),
          hotel: t("export.masterSheet.table.hotel"), food: t("export.masterSheet.table.food"),
          phone: t("export.masterSheet.table.phone"), notes: t("export.masterSheet.table.notes"),
          call: t("export.masterSheet.table.call"), off: t("export.masterSheet.table.off"),
          dayRate: t("export.masterSheet.table.dayRate"),
        },
        footer: t("export.masterSheet.footer"),
        print: t("export.masterSheet.print"),
        dayKey: t("export.masterSheet.dayKey"),
        numberedByDate: t("export.masterSheet.numberedByDate"),
        status: {
          invited: t("export.masterSheet.status.invited"), confirmed: t("export.masterSheet.status.confirmed"),
          done: t("export.masterSheet.status.done"), invoiced: t("export.masterSheet.status.invoiced"),
          paid: t("export.masterSheet.status.paid"), requested: t("export.masterSheet.status.requested"),
          accepted: t("export.masterSheet.status.accepted"), partially_accepted: t("export.masterSheet.status.partiallyAccepted"), declined: t("export.masterSheet.status.declined"),
          "no-reply": t("export.masterSheet.status.noReply"), too_late: t("export.masterSheet.status.tooLate"),
          manual: t("export.masterSheet.status.manual"),
        },
        food: {
          profileMissing: t("export.masterSheet.food.profileMissing"), none: t("export.masterSheet.food.none"),
          vegetarian: t("export.masterSheet.food.vegetarian"), vegan: t("export.masterSheet.food.vegan"),
          halal: t("export.masterSheet.food.halal"), glutenFree: t("export.masterSheet.food.glutenFree"),
          lactoseFree: t("export.masterSheet.food.lactoseFree"),
          allergens: (count) => t(count === 1 ? "export.masterSheet.food.allergen" : "export.masterSheet.food.allergens", { count: count.toLocaleString(locale === "no" ? "nb-NO" : "en-US") }),
        },
        hotel: {
          nights: (count) => t(count === 1 ? "export.masterSheet.hotel.night" : "export.masterSheet.hotel.nights", { count: count.toLocaleString(locale === "no" ? "nb-NO" : "en-US") }),
          required: t("export.masterSheet.hotel.required"), notRequired: t("export.masterSheet.hotel.notRequired"),
        },
      },
    });
  }, [
    briefName,
    venue,
    rows,
    data,
    showProductionDetails,
    localCrew,
    resolveLocalIdFor,
    locale,
    t,
  ]);
  const handleExportDailyCallSheet = useCallback(() => {
    if (!timelineDate) return;
    const contacts = [
      { label: "Client", ...brief?.clientContact },
      { label: "Production", ...brief?.productionContact },
      { label: "Venue", ...brief?.venueContact },
    ].filter((contact) => contact.name || contact.phone);
    void exportDailyCallSheet({
      date: timelineDate,
      projectName: briefName,
      venue,
      contacts,
      rows,
      locale,
      copy: {
        notProvided: t("export.dailyCallSheet.notProvided"), noKeyContacts: t("export.dailyCallSheet.noKeyContacts"), noTasks: t("export.dailyCallSheet.noTasks"),
        hotelRequired: t("export.dailyCallSheet.hotelRequired"), hotelRequiredDates: (dates) => t("export.dailyCallSheet.hotelRequiredDates", { dates }), hotelNotRequired: t("export.dailyCallSheet.hotelNotRequired"),
        noneProvided: t("export.dailyCallSheet.noneProvided"), empty: t("export.dailyCallSheet.empty"), logoAlt: t("export.dailyCallSheet.logoAlt"), title: t("export.dailyCallSheet.title"),
        crewRole: t("export.dailyCallSheet.table.crewRole"), windows: t("export.dailyCallSheet.table.windows"), timeline: t("export.dailyCallSheet.table.timeline"), tasks: t("export.dailyCallSheet.table.tasks"), hotel: t("export.dailyCallSheet.table.hotel"),
        cateringDietaryAllergens: t("export.dailyCallSheet.table.cateringDietaryAllergens"), phone: t("export.dailyCallSheet.table.phone"), keyContacts: t("export.dailyCallSheet.keyContacts"), filename: t("export.dailyCallSheet.filename"),
      },
    }).catch((error) => {
      console.error("[daily call sheet] PDF export failed:", error);
      toast.error(t("export.dailyCallSheet.error"));
    });
  }, [brief, briefName, rows, timelineDate, venue, locale, t]);

  const totalCount = rows.length;
  const linkedOwnerByUserId = useMemo(() => {
    const owners = new Map<string, string>();
    for (const member of localCrew) {
      if (
        member.freelancerUserId &&
        !owners.has(member.freelancerUserId)
      ) {
        owners.set(member.freelancerUserId, member.id);
      }
    }
    return owners;
  }, [localCrew]);
  const linkedUnsentMembers = useMemo(() => {
    const requestedUserIds = new Set(
      localCrew
        .filter(
          (member) => !!member.freelancerUserId && !!member.requestStatus,
        )
        .map((member) => member.freelancerUserId!),
    );
    const seen = new Set<string>();
    return localCrew.filter((member) => {
      const userId = member.freelancerUserId;
      if (
        !userId ||
        member.requestStatus ||
        requestedUserIds.has(userId) ||
        seen.has(userId)
      ) {
        return false;
      }
      seen.add(userId);
      return true;
    });
  },
    [localCrew],
  );
  const confirmAndSendLinkedRequests = useCallback(() => {
    if (readOnly || !onSendLinkedRequests || linkedUnsentMembers.length === 0) return;
    const confirmed = window.confirm(
      t("crew.requests.confirm", { count: linkedUnsentMembers.length }),
    );
    if (confirmed) void onSendLinkedRequests(linkedUnsentMembers);
  }, [linkedUnsentMembers, onSendLinkedRequests, readOnly, t]);
  const copyPortalLink = useCallback(async (row: RosterRow) => {
    if (!briefId || !row.freelancerUserId) return;
    const url = new URL("https://app.ehs.no/");
    url.searchParams.set("view", "portal");
    url.searchParams.set("brief", briefId);
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success(
        t("crew.sheet.portalLinkCopied", {
          name: row.name || t("crew.sheet.freelancer"),
        }),
      );
    } catch {
      toast.error(t("crew.sheet.portalLinkCopyError"));
    }
  }, [briefId, t]);

  return (
    <section className="led-card roster-card master-sheet-card">
      {compactHeader ? (
        // Dedicated head for compact mode. We deliberately avoid
        // `.led-card-head` / `.led-controls` and `.btn` here so we are
        // not affected by older flex / wrap / hover rules that kept
        // pushing the pill and Print A4 into each other. Everything is
        // pinned with inline styles for a bulletproof layout.
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            flexWrap: "wrap",
            columnGap: 12,
            rowGap: 8,
            marginBottom: 12,
          }}
        >
          <label
            style={{
              display: "inline-flex",
              flex: "0 0 auto",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 14px",
              borderRadius: 999,
              background: "var(--card-bg, #ffffff)",
              border: "1px solid var(--border, #e5e7eb)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-main, #0f172a)",
              cursor: "pointer",
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              checked={showProductionDetails}
              onChange={(e) => setShowProductionDetails(e.target.checked)}
              style={{
                margin: 0,
                padding: 0,
                flex: "0 0 auto",
                width: 16,
                height: 16,
                display: "block",
                accentColor: "var(--primary, #f88000)",
                cursor: "pointer",
                verticalAlign: "middle",
              }}
            />
            <span
              style={{
                whiteSpace: "nowrap",
                fontSize: 13,
                lineHeight: "16px",
                display: "inline-block",
                verticalAlign: "middle",
              }}
            >
              Production details
            </span>
          </label>
          <button
            type="button"
            onClick={handlePrint}
            disabled={rows.length === 0}
            style={{
              display: "inline-flex",
              flex: "0 0 auto",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 14px",
              borderRadius: 8,
              background: "#0f172a",
              color: "#ffffff",
              border: "1px solid #0f172a",
              fontSize: 13,
              fontWeight: 600,
              cursor: rows.length === 0 ? "not-allowed" : "pointer",
              opacity: rows.length === 0 ? 0.5 : 1,
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>{t("crew.sheet.printA4")}</span>
          </button>
          <button
            type="button"
            onClick={confirmAndSendLinkedRequests}
            disabled={readOnly || (
              linkedUnsentMembers.length === 0 ||
              sendingLinkedRequests ||
              !onSendLinkedRequests
            )}
            className="crew-send-linked-button"
          >
            {sendingLinkedRequests
              ? t("crew.sheet.sending")
              : t("crew.sheet.sendRequests", { count: linkedUnsentMembers.length })}
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={readOnly}
            style={{
              display: "inline-flex",
              flex: "0 0 auto",
              alignItems: "center",
              gap: 6,
              height: 36,
              padding: "0 14px",
              borderRadius: 8,
              background: "var(--primary, #f88000)",
              color: "#ffffff",
              border: "1px solid var(--primary, #f88000)",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            {t("crew.sheet.addCrew")}
          </button>
        </div>
      ) : (
        <div className="led-card-head">
          <div>
            <h3>{t("crew.sheet.title")}</h3>
            <p className="led-report-sub">
              {briefId
                ? <>{t("crew.sheet.everyoneOn", { name: briefName || t("crew.sheet.thisBrief") })}</>
                : <>{t("crew.sheet.localOnly")}</>}
            </p>
          </div>
          <div className="led-controls">
            <span className="badge">
              <strong>{totalCount}</strong> on roster
            </span>
            {data?.projectDays.length ? (
              <span className="badge">
                <strong>{data.projectDays.length}</strong> project days
              </span>
            ) : null}
            <label
              className="roster-toggle"
              title={t("crew.sheet.productionDetailsHint")}
            >
              <input
                type="checkbox"
                checked={showProductionDetails}
                onChange={(e) => setShowProductionDetails(e.target.checked)}
              />
              <span>{t("crew.sheet.productionDetails")}</span>
            </label>
            <button
              type="button"
              className="btn btn-soft"
              onClick={handlePrint}
              disabled={rows.length === 0}
              title={t("crew.sheet.printHint")}
            >
              🖨 {t("common.print")}
            </button>
            <button
              type="button"
              className="btn btn-soft"
               onClick={confirmAndSendLinkedRequests}
              disabled={readOnly || (
                linkedUnsentMembers.length === 0 ||
                sendingLinkedRequests ||
                !onSendLinkedRequests
              )}
              title={t("crew.sheet.sendHint")}
            >
              {sendingLinkedRequests
                ? t("crew.sheet.sending")
                : t("crew.sheet.sendRequests", { count: linkedUnsentMembers.length })}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onAdd}
              disabled={readOnly}
              title={t("crew.sheet.addHint")}
            >
              {t("crew.sheet.addCrew")}
            </button>
          </div>
        </div>
      )}

      {error ? <div className="led-error">{error}</div> : null}

      {timelineDates.length > 0 ? (
        <section className="crew-daily-timeline">
          <div className="crew-daily-timeline-head">
            <div>
              <strong>{t("crew.sheet.timeline")}</strong>
              <small>{t("crew.sheet.timelineHint")}</small>
            </div>
            {timelineWarningCount > 0 ? (
              <span
                className="crew-daily-warning-summary"
                title={t("crew.sheet.warningHint")}
              >
                ⚠ {t("crew.sheet.warningCount", { count: timelineWarningCount })}
              </span>
            ) : (
              <span className="crew-daily-warning-summary crew-daily-warning-clear">
                {t("crew.sheet.noWarnings")}
              </span>
            )}
            <button
              type="button"
              className="btn btn-soft"
              onClick={handleExportDailyCallSheet}
              disabled={!timelineDate}
              title={t("crew.sheet.exportHint")}
            >
              {t("crew.sheet.exportDaily")}
            </button>
            <select
              value={timelineDate}
              onChange={(event) => setTimelineDate(event.target.value)}
            >
              {timelineDates.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </div>
          <div className="crew-daily-scale">
            <div className="crew-daily-scale-spacer" />
            <div className="crew-daily-scale-labels">
              <span>00</span>
              <span>06</span>
              <span>12</span>
              <span>18</span>
              <span>24</span>
            </div>
          </div>
          <div className="crew-daily-rows">
            {timelineRows.length > 0 ? (
              timelineRows.map(({ row, windows }) => {
                const alerts = workAlertsByPerson.get(workAlertIdentity(row)) ?? [];
                return (
                <div
                  className="crew-daily-row"
                  key={`${row.source}:${row.id}`}
                >
                  <span>
                    <strong>
                      {row.name}
                      {alerts.map((alert, index) => {
                        const text =
                          alert.kind === "turnaround"
                            ? t("crew.alert.restDetail", {
                                rest: formatWorkHours(alert.restMinutes),
                                time: alert.previousEnd.endTime,
                              })
                            : t("crew.alert.dailyDetail", {
                                worked: formatWorkHours(alert.workedMinutes),
                              });
                        return (
                          <em
                            className="crew-daily-warning-badge"
                            key={`${alert.kind}-${index}`}
                            title={text}
                            aria-label={text}
                          >
                            ⚠{" "}
                            {alert.kind === "turnaround"
                              ? t("crew.alert.rest")
                              : t("crew.alert.daily")}
                          </em>
                        );
                      })}
                    </strong>
                    <small>{row.role}</small>
                  </span>
                  <div className="crew-daily-track">
                    {windows.flatMap((window, index) => {
                      const length =
                        (window.end - window.start + 1440) % 1440 || 1440;
                      const blocks = [
                        {
                          left: window.start,
                          width: Math.min(length, 1440 - window.start),
                        },
                      ];
                      if (length > 1440 - window.start) {
                        blocks.push({
                          left: 0,
                          width: length - (1440 - window.start),
                        });
                      }
                      return blocks.map((block, blockIndex) => (
                        <i
                          key={`${index}-${blockIndex}`}
                          title={`${row.name}: ${window.startTime}–${window.endTime}`}
                          style={{
                            left: `${block.left / 14.4}%`,
                            width: `${block.width / 14.4}%`,
                            background: roleColor(row.role),
                          }}
                        />
                      ));
                    })}
                  </div>
                </div>
                );
              })
            ) : (
              <p>{t("crew.sheet.noShifts")}</p>
            )}
          </div>
        </section>
      ) : null}

      {loading && !data && briefId ? (
        <div className="led-empty">{t("crew.sheet.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="led-empty">
          {briefId
            ? t("crew.sheet.emptyBrief")
            : t("crew.sheet.emptyLocal")}
        </div>
      ) : (
        <div className="led-table-wrap">
          <table className="led-table master-sheet-table">
            <thead>
              <tr>
                <th>{t("crew.sheet.name")}</th>
                <th>{t("crew.sheet.role")}</th>
                <th>{t("crew.sheet.status")}</th>
                <th>{t("crew.sheet.days")}</th>
                <th>{t("crew.sheet.hotel")}</th>
                <th>{t("crew.sheet.food")}</th>
                <th>{t("crew.sheet.phone")}</th>
                <th>{t("crew.sheet.notes")}</th>
                {showProductionDetails ? (
                  <>
                    <th>{t("crew.sheet.call")}</th>
                    <th>{t("crew.sheet.off")}</th>
                    <th className="led-num">{t("crew.sheet.dayRate")}</th>
                  </>
                ) : null}
                <th aria-label={t("crew.sheet.actions")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const localId = resolveLocalIdFor(row);
                const local =
                  localId !== null
                    ? localCrew.find((m) => m.id === localId) ?? null
                    : null;
                return (
                  <MasterRow
                    key={`${row.source}:${row.id}`}
                    row={row}
                    projectDays={data?.projectDays ?? null}
                    hotelSaving={
                      !!(row.gigId && savingByKey[`${row.gigId}:hotel`])
                    }
                    datesSaving={
                      !!(row.gigId && savingByKey[`${row.gigId}:dates`])
                    }
                    onHotelToggle={
                      row.gigId
                        ? (next) => handleHotelToggle(row.gigId!, next)
                        : undefined
                    }
                    onHotelDatesSet={
                      row.gigId
                        ? (dates) => handleHotelDatesSet(row.gigId!, dates)
                        : undefined
                    }
                    onDayToggle={
                      row.gigId
                        ? (date) =>
                            handleDayToggle(
                              row.gigId!,
                              row.assignedDates,
                              date,
                            )
                        : undefined
                    }
                    local={local}
                    showProductionDetails={showProductionDetails}
                    portalCandidates={portalCandidates.filter((candidate) => {
                      const ownerId = linkedOwnerByUserId.get(candidate.userId);
                      return !ownerId || ownerId === local?.id;
                    })}
                    onReplaceRole={
                      !readOnly &&
                      briefId &&
                      local?.freelancerUserId &&
                      local.requestStatus === "declined" &&
                      onReplaceRole
                        ? (candidate) => onReplaceRole(local, candidate)
                        : undefined
                    }
                    onLocalUpdate={
                      local
                        ? (patch) => onUpdate(local.id, patch)
                        : undefined
                    }
                    onLocalDayToggle={
                      local
                        ? (date) => {
                            const available = new Set(
                              scheduledShiftKeys(phaseDays ?? {}),
                            );
                            const legacyKeys = scheduledShiftKeys(
                              phaseDays ?? {},
                            ).filter((key) =>
                              (local.assignedDates ?? []).some((assignedDate) =>
                                key.startsWith(`${assignedDate}::`),
                              ),
                            );
                            const shiftKeys =
                              filterShiftSelectionsToSchedule(
                                local.assignedShiftPhases ?? legacyKeys,
                                available,
                              );
                            const datePhases = SHIFT_PHASES.filter((phase) =>
                              phaseDays?.[phase.key]?.includes(date),
                            );
                            const wasAssigned = datePhases.some((phase) =>
                              shiftKeys.has(
                                crewShiftAssignmentKey(date, phase.key),
                              ),
                            );
                            for (const phase of datePhases) {
                              const key = crewShiftAssignmentKey(date, phase.key);
                              if (wasAssigned) shiftKeys.delete(key);
                              else shiftKeys.add(key);
                            }
                            const nextDates =
                              assignedDatesFromShiftPhases(shiftKeys);
                            const assignedShiftWindows =
                              shiftWindowsForSelections(
                                shiftKeys,
                                phaseShiftTimes ?? {},
                                local.assignedShiftWindows ?? {},
                                local.assignedShiftTimes ?? {},
                              );
                            const assignedShiftTimes =
                              firstShiftTimesFromWindows(
                                shiftKeys,
                                assignedShiftWindows,
                              );
                            const assignedShiftTasks = Object.fromEntries(
                              [...shiftKeys].flatMap((key) => {
                                const tasks = local.assignedShiftTasks?.[key];
                                return tasks?.length ? [[key, [...tasks]]] : [];
                              }),
                            );
                            const summary = summarizeShiftWindows(
                              shiftKeys,
                              assignedShiftWindows,
                              {
                                startTime: local.callTime,
                                endTime: local.offTime,
                              },
                            );
                            const patch: Partial<CrewMember> = {
                              assignedDates: nextDates,
                              assignedShiftPhases: [...shiftKeys].sort(),
                              assignedShiftTimes,
                              assignedShiftWindows,
                              assignedShiftTasks,
                              callTime: summary.startTime,
                              offTime: summary.endTime,
                            };
                            onUpdate(local.id, patch);
                          }
                        : undefined
                    }
                    onLocalRemove={
                      local &&
                      row.source === "local" &&
                      !(
                        local.freelancerUserId &&
                        (local.requestStatus || local.briefAssignmentId)
                      )
                        ? () => onRemove(local.id)
                        : undefined
                    }
                    onCancelRequest={
                      local &&
                      row.source === "local" &&
                      local.freelancerUserId &&
                      (local.requestStatus === "requested" ||
                        local.requestStatus === "no-reply") &&
                      briefId
                        ? () => void cancelPendingRequest(local)
                        : undefined
                    }
                     onRemoveBooking={
                       !readOnly &&
                       onRemoveBooking &&
                       row.freelancerUserId &&
                       (
                         (row.source === "gig" && row.crewId) ||
                         (row.source === "local" &&
                           local &&
                           (local.briefAssignmentId ||
                             (local.requestStatus &&
                               local.requestStatus !== "requested" &&
                               local.requestStatus !== "no-reply")))
                       ) &&
                       // Pending requests retain their dedicated cancel
                       // action above; every other linked row uses the
                       // active-booking removal endpoint.
                       !(
                         row.source === "local" &&
                         (row.status === "requested" ||
                           row.status === "no-reply")
                       )
                         ? () => void removeActiveBooking(row, local)
                         : undefined
                     }
                     removeBookingSaving={
                       Boolean(
                         (row.crewId ||
                           (row.source === "local" && local?.id)) &&
                           savingByKey[
                             `remove:${
                               row.crewId ??
                               (row.source === "local" ? local?.id : "")
                             }`
                           ],
                       )
                     }
                    cancelSaving={
                      local
                        ? Boolean(savingByKey[`cancel:${local.id}`])
                        : false
                    }
                    onLocalDuplicate={
                      local
                        ? () => onDuplicate(local.id)
                        : undefined
                    }
                    phaseDays={phaseDays}
                    phaseShiftTimes={phaseShiftTimes}
                    onOpenProfile={onOpenProfile}
                    onCopyPortalLink={
                      briefId && row.freelancerUserId
                        ? () => void copyPortalLink(row)
                        : undefined
                    }
                    onLocalSetDays={
                      local
                        ? async (
                            _nextDates,
                            nextShiftPhases,
                            customShiftTimes,
                             customShiftWindows,
                            shiftTasks,
                          ) => {
                            const available = new Set(
                              scheduledShiftKeys(phaseDays ?? {}),
                            );
                            const shiftKeys =
                              filterShiftSelectionsToSchedule(
                                nextShiftPhases ?? [],
                                available,
                              );
                            const sorted =
                              assignedDatesFromShiftPhases(shiftKeys);
                            const assignedShiftTimes =
                              customShiftTimes ??
                              shiftTimesForSelections(shiftKeys, phaseShiftTimes ?? {});
                             const assignedShiftWindows =
                               customShiftWindows ??
                               shiftWindowsForSelections(
                                 shiftKeys,
                                 phaseShiftTimes ?? {},
                                 {},
                                 assignedShiftTimes,
                               );
                             const summary = summarizeShiftWindows(
                              shiftKeys,
                               assignedShiftWindows,
                              {
                                startTime: local.callTime,
                                endTime: local.offTime,
                              },
                            );
                            const patch: Partial<CrewMember> = {
                              assignedDates: sorted,
                              assignedShiftPhases: [...shiftKeys].sort(),
                              assignedShiftTimes,
                               assignedShiftWindows,
                              assignedShiftTasks: shiftTasks,
                              callTime: summary.startTime,
                              offTime: summary.endTime,
                            };
                             if (onSaveShifts) {
                               await onSaveShifts(local.id, patch);
                             } else {
                               onUpdate(local.id, patch);
                             }
                          }
                        : undefined
                    }
                    rolePeers={localCrew.filter((member) => member.role === local?.role)}
                    onApplyScheduleToRole={
                      local
                        ? (shiftPhases, shiftTimes, shiftWindows, shiftTasks) => {
                            const shiftKeys = filterShiftSelectionsToSchedule(
                              shiftPhases,
                              new Set(scheduledShiftKeys(phaseDays ?? {})),
                            );
                            const assignedDates = assignedDatesFromShiftPhases(shiftKeys);
                            const summary = summarizeShiftWindows(
                              shiftKeys,
                              shiftWindows,
                              { startTime: local.callTime, endTime: local.offTime },
                            );
                            for (const peer of localCrew) {
                              if (peer.role !== local.role || peer.id === local.id) continue;
                              onUpdate(peer.id, {
                                assignedDates,
                                assignedShiftPhases: [...shiftKeys].sort(),
                                assignedShiftTimes: shiftTimesForSelections(shiftKeys, shiftTimes),
                                assignedShiftWindows: shiftWindowsForSelections(
                                  shiftKeys,
                                  shiftTimes,
                                  shiftWindows,
                                ),
                                assignedShiftTasks: shiftTasks,
                                callTime: summary.startTime,
                                offTime: summary.endTime,
                              });
                            }
                          }
                        : undefined
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CrewNameCombobox({
  member,
  candidates,
  onUpdate,
}: {
  member: CrewMember;
  candidates: ReadonlyArray<FreelancerCandidate>;
  onUpdate: (patch: Partial<CrewMember>) => void;
}) {
  const t = useT();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = member.name.trim().toLocaleLowerCase("nb-NO");
  const matches = useMemo(() => {
    if (!query) return candidates.slice(0, 8);
    return candidates
      .filter((candidate) =>
        [candidate.fullName, candidate.primaryRole ?? "", candidate.city ?? ""]
          .join(" ")
          .toLocaleLowerCase("nb-NO")
          .includes(query),
      )
      .slice(0, 8);
  }, [candidates, query]);
  const linkedCandidate = member.freelancerUserId
    ? candidates.find(
        (candidate) => candidate.userId === member.freelancerUserId,
      ) ?? null
    : null;

  const selectCandidate = (candidate: FreelancerCandidate) => {
    onUpdate({
      name: candidate.fullName,
      freelancerUserId: candidate.userId,
      phone: candidate.phone ?? "",
      dietaryTags: [...(candidate.dietaryTags ?? [])],
      allergens: [...(candidate.allergens ?? [])],
    });
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <div
      className="crew-name-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <input
        className="led-input"
        type="text"
        value={member.name}
        onFocus={() => {
          if (member.requestStatus) return;
          setOpen(true);
          setActiveIndex(0);
        }}
        onChange={(event) => {
          const nextName = event.target.value;
          const patch: Partial<CrewMember> = { name: nextName };
          if (member.freelancerUserId) {
            patch.freelancerUserId = undefined;
            patch.requestStatus = undefined;
            patch.briefAssignmentId = undefined;
            patch.phone = undefined;
            patch.dietaryTags = undefined;
            patch.allergens = undefined;
          }
          onUpdate(patch);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (matches.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => (current + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(
              (current) => (current - 1 + matches.length) % matches.length,
            );
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            selectCandidate(matches[activeIndex] ?? matches[0]!);
          }
        }}
        placeholder={t("crew.sheet.fullName")}
        autoComplete="off"
        readOnly={!!member.freelancerUserId && !!member.requestStatus}
        title={
          member.requestStatus
            ? t("crew.sheet.nameLocked")
            : undefined
        }
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={
          open && matches[activeIndex]
            ? `${listboxId}-${matches[activeIndex]!.userId}`
            : undefined
        }
      />
      {member.freelancerUserId ? (
        <span
          className="crew-name-linked"
          title={
            linkedCandidate
              ? t("crew.sheet.linkedAccountName", { name: linkedCandidate.fullName })
              : t("crew.sheet.linkedAccount")
          }
        >
          {t("crew.sheet.portalLinked")}
        </span>
      ) : null}
      {open && matches.length > 0 ? (
        <div
          className="crew-name-options"
          id={listboxId}
          role="listbox"
          aria-label={t("crew.sheet.registeredFreelancers")}
        >
          {matches.map((candidate, index) => (
            <button
              key={candidate.userId}
              id={`${listboxId}-${candidate.userId}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={
                index === activeIndex
                  ? "crew-name-option is-active"
                  : "crew-name-option"
              }
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectCandidate(candidate)}
            >
              <span className="crew-name-option-name">
                {candidate.fullName}
              </span>
              <span className="crew-name-option-meta">
                {[candidate.primaryRole, candidate.city]
                  .filter(Boolean)
                  .join(" · ") || t("crew.sheet.registeredFreelancer")}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Compact replacement action for one declined role slot. Candidates are
 * exact directory identities (user ids), never free-typed names. Selecting
 * one delegates to App's normal request dispatcher, which creates a new
 * local row while leaving the declined row and any accepted roles intact. */
function ReplacementPicker({
  role,
  candidates,
  onSelect,
}: {
  role: string;
  candidates: ReadonlyArray<FreelancerCandidate>;
  onSelect: (candidate: FreelancerCandidate) => void | Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (candidates.length === 0) {
    return (
      <span
        className="crew-replacement-empty"
        title={t("crew.sheet.replacementNoCandidates")}
      >
        {t("crew.sheet.replacementNoCandidates")}
      </span>
    );
  }
  return (
    <div className="crew-replacement-picker">
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {t("crew.sheet.needsReplacement")}
      </button>
      {open ? (
        <div className="crew-replacement-options" role="listbox">
          <div className="crew-replacement-heading">
            {t("crew.sheet.replaceRole", { role })}
          </div>
          {candidates.slice(0, 8).map((candidate) => (
            <button
              key={candidate.userId}
              type="button"
              role="option"
              className="crew-replacement-option"
              onClick={() => {
                setOpen(false);
                void onSelect(candidate);
              }}
            >
              <strong>{candidate.fullName}</strong>
              <span>
                {[candidate.primaryRole, candidate.city]
                  .filter(Boolean)
                  .join(" · ") || t("crew.sheet.registeredFreelancer")}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One row in the master sheet. Editing affordances depend on row
 *  source + presence of a matched local CrewMember (see MasterCrewSheet
 *  doc). */
function MasterRow({
  row,
  projectDays,
  hotelSaving,
  datesSaving,
  onHotelToggle,
  onHotelDatesSet,
  onDayToggle,
  local,
  showProductionDetails,
  portalCandidates,
  onLocalUpdate,
  onLocalDayToggle,
  onLocalRemove,
  onCancelRequest,
  cancelSaving,
  onRemoveBooking,
  removeBookingSaving,
  onLocalDuplicate,
  phaseDays,
  phaseShiftTimes,
  onLocalSetDays,
  rolePeers,
  onApplyScheduleToRole,
  onOpenProfile,
  onCopyPortalLink,
  onReplaceRole,
}: {
  row: RosterRow;
  projectDays: ReadonlyArray<string> | null;
  hotelSaving: boolean;
  datesSaving: boolean;
  onHotelToggle?: (next: boolean) => void;
  /** Replace this gig row's hotelDates wholesale. Used by the
   *  per-phase hotel quick-pick. Only wired for gig-backed rows;
   *  local rows mutate `CrewMember.hotelDates` via onLocalUpdate. */
  onHotelDatesSet?: (dates: ReadonlyArray<string>) => void;
  onDayToggle?: (date: string) => void;
  local: CrewMember | null;
  showProductionDetails: boolean;
  portalCandidates: ReadonlyArray<FreelancerCandidate>;
  onLocalUpdate?: (patch: Partial<CrewMember>) => void;
  /** Toggle a single date on / off the local CrewMember's
   *  `assignedDates`. Only provided when the row is backed by a
   *  local CrewMember, so the chips stay read-only for unmatched
   *  gig rows (those use `onDayToggle` against the gig endpoint). */
  onLocalDayToggle?: (date: string) => void;
  onLocalRemove?: () => void;
  onCancelRequest?: () => void;
  cancelSaving?: boolean;
  /** Remove one exact linked assignment from the active booking. The
   *  server keeps the assignment history (including payroll history)
   *  separate; this callback only frees the current role slot. */
  onRemoveBooking?: () => void | Promise<void>;
  removeBookingSaving?: boolean;
  onLocalDuplicate?: () => void;
  /** Days covered by each schedule phase. Drives the per-phase
   *  quick-pick buttons rendered next to the day chips on local
   *  rows. */
  phaseDays?: Partial<
    Record<CrewShiftPhaseKey, ReadonlyArray<string>>
  >;
  phaseShiftTimes?: CrewShiftTimeMap;
  /** Replace the local row's working days wholesale (used by the
   *  quick-pick buttons). Recomputes call/off from the schedule. */
  onLocalSetDays?: (
    dates: ReadonlyArray<string>,
    shiftPhases?: ReadonlyArray<string>,
    shiftTimes?: CrewShiftTimeMap,
    shiftWindows?: CrewShiftWindowMap,
    shiftTasks?: Record<string, string[]>,
  ) => void | Promise<void>;
  rolePeers?: ReadonlyArray<CrewMember>;
  onApplyScheduleToRole?: (
    shiftPhases: ReadonlyArray<string>,
    shiftTimes: CrewShiftTimeMap,
    shiftWindows: CrewShiftWindowMap,
    shiftTasks: Record<string, string[]>,
  ) => void;
  onOpenProfile?: (userId: string) => void;
  onCopyPortalLink?: () => void;
  onReplaceRole?: (candidate: FreelancerCandidate) => void | Promise<void>;
}) {
  const t = useT();
  const chips = useMemo(
    () => buildDayChips(row.assignedDates, projectDays),
    [row.assignedDates, projectDays],
  );
  const assignedCount = row.assignedDates.length;
  const tone = statusTone(row.status);
  const label = statusLabel(row.status, t);
  const editableLocal = row.source === "local" && !!onLocalUpdate;
  const statusAriaLabel = t("crew.sheet.personStatus", {
    name: row.name || t("crew.sheet.freelancer"),
    status: label,
  });

  return (
    <tr>
      <td>
        {editableLocal && !local?.requestStatus ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <CrewNameCombobox
                member={local!}
                candidates={portalCandidates}
                onUpdate={(patch) => onLocalUpdate?.(patch)}
              />
            </div>
            {row.freelancerUserId && onOpenProfile ? (
              <button
                type="button"
                className="ehs-ghost-btn"
                onClick={() => onOpenProfile(row.freelancerUserId!)}
                title={t("crew.sheet.openProfile", { name: row.name || t("crew.sheet.freelancer") })}
                aria-label={t("crew.sheet.openProfile", { name: row.name || t("crew.sheet.freelancer") })}
                style={{ flexShrink: 0, padding: "4px 7px", height: "auto" }}
              >
                Profile
              </button>
            ) : null}
            {onCopyPortalLink ? (
              <button
                type="button"
                className="ehs-ghost-btn"
                onClick={onCopyPortalLink}
                title={t("crew.sheet.copyPortalLink", { name: row.name || t("crew.sheet.freelancer") })}
                aria-label={t("crew.sheet.copyPortalLink", { name: row.name || t("crew.sheet.freelancer") })}
                style={{ flexShrink: 0, padding: "4px 7px", height: "auto" }}
              >
                <Copy size={14} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="roster-name">
            {row.freelancerUserId && onOpenProfile ? (
              <button 
                type="button"
                className="ehs-ghost-btn"
                style={{ padding: 0, fontWeight: 800, color: "inherit", height: "auto" }}
                onClick={() => onOpenProfile(row.freelancerUserId!)}
              >
                {row.name || "—"}
              </button>
            ) : (
              <strong>{row.name || "—"}</strong>
            )}
            {row.profileless ? (
              <span
                className="roster-hint"
                title={t("crew.sheet.profilelessHint")}
              >
                {t("crew.sheet.noProfile")}
              </span>
            ) : null}
            {onCopyPortalLink ? (
              <button
                type="button"
                className="ehs-ghost-btn"
                onClick={onCopyPortalLink}
                title={t("crew.sheet.copyPortalLink", { name: row.name || t("crew.sheet.freelancer") })}
                aria-label={t("crew.sheet.copyPortalLink", { name: row.name || t("crew.sheet.freelancer") })}
                style={{ padding: "3px 6px", height: "auto" }}
              >
                <Copy size={14} aria-hidden />
              </button>
            ) : null}
          </div>
        )}
      </td>
      <td>
        <div className="crew-role-cell">
          {editableLocal ? (
            <select
              className="led-input"
              value={local?.role ?? CREW_ROLES[0]!}
              onChange={(e) =>
                onLocalUpdate?.({ role: e.target.value as CrewRole })
              }
            >
              {CREW_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          ) : (
            row.role || "—"
          )}
          {Object.values(row.assignedShiftTasks).flat().length > 0 ? (
            <div className="crew-row-tasks">
              {[
                ...new Set(Object.values(row.assignedShiftTasks).flat()),
              ].map((task) => (
                <span key={task}>{task}</span>
              ))}
            </div>
          ) : null}
          {onLocalDuplicate ? (
            <button
              type="button"
              className="roster-day-quickpick-btn crew-add-role-inline"
              onClick={onLocalDuplicate}
              title={t("crew.sheet.addRoleHint")}
            >
              {t("crew.sheet.addRole")}
            </button>
          ) : null}
        </div>
      </td>
      <td>
        {editableLocal && !local?.requestStatus ? (
          // Editable status for local rows. Covers two real scenarios:
          //   • Producer phoned a "requested" freelancer who confirmed
          //     verbally — flip them to Accepted without waiting on
          //     the portal click.
          //   • Producer wants to mark a hand-typed crew member as
          //     "manual" (no pill) vs an outgoing request flow.
          <select
            className="led-input"
            value={local?.requestStatus ?? "manual"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "manual") {
                if (local?.freelancerUserId && local.requestStatus) return;
                onLocalUpdate?.({ requestStatus: undefined });
              } else {
                onLocalUpdate?.({
                  requestStatus: v as CrewRequestStatus,
                });
              }
            }}
            title={t("crew.sheet.statusHint")}
          >
            <option
              value="manual"
              disabled={!!local?.freelancerUserId && !!local.requestStatus}
            >
              {t("crew.status.inHouse")}
            </option>
            <option value="requested">{t("crew.status.requested")}</option>
            <option value="accepted">{t("crew.status.accepted")}</option>
            <option value="declined">{t("crew.status.declined")}</option>
            <option value="no-reply">{t("crew.status.noReply")}</option>
            <option value="too_late">{t("crew.status.tooLate")}</option>
          </select>
        ) : (
          <div>
            <span
              className={`crew-pill crew-pill-${tone}`}
              title={`${row.name || t("crew.sheet.freelancer")}: ${label}`}
              aria-label={statusAriaLabel}
            >
              {statusIcon(row.status)} {label}
            </span>
            {row.status === "declined" && row.declineReason ? (
              <div className="crew-decline-reason" title={row.declineReason}>
                {row.declineReason}
              </div>
            ) : null}
            {row.status === "declined" && onReplaceRole ? (
              <ReplacementPicker
                role={row.role}
                candidates={portalCandidates.filter(
                  (candidate) => candidate.userId !== row.freelancerUserId,
                )}
                onSelect={onReplaceRole}
              />
            ) : null}
          </div>
        )}
      </td>
      <td>
        {chips.length === 0 ? (
          <span className="crew-pill-empty">—</span>
        ) : (
          <div
            className={`roster-chips${datesSaving ? " is-saving" : ""}`}
            aria-busy={datesSaving || undefined}
          >
            {chips.map((c) => {
              // Interactive when EITHER:
              //  • The row is a gig row with a working onDayToggle
              //    (PATCHes the gig endpoint), OR
              //  • The row is a local row with onLocalDayToggle
              //    (mutates the CrewMember.assignedDates locally).
              const handler = onDayToggle ?? onLocalDayToggle;
              const interactive = !!handler;
              const responseStatus = dayResponseStatus(row, c.date);
              const className = `roster-chip ${
                c.on ? "roster-chip-on" : "roster-chip-off"
              }${interactive ? " roster-chip-interactive" : ""}${
                responseStatus
                  ? ` roster-chip-response-${responseStatus}`
                  : ""
              }`;
              const responseLabel =
                responseStatus === "accepted"
                  ? "confirmed"
                  : responseStatus === "declined"
                    ? "declined"
                    : responseStatus === "partial"
                      ? "partially accepted"
                      : responseStatus === "pending"
                        ? "pending"
                        : "";
              return interactive ? (
                <button
                  key={c.date}
                  type="button"
                  className={className}
                  title={`${c.date}${responseLabel ? ` — ${responseLabel}` : ""} — click to ${c.on ? "remove" : "add"}`}
                  disabled={datesSaving}
                  onClick={() => handler!(c.date)}
                >
                  {c.label}
                </button>
              ) : (
                <span
                  key={c.date}
                  className={className}
                  title={`${c.date}${responseLabel ? ` — ${responseLabel}` : ""}`}
                >
                  {c.label}
                </span>
              );
            })}
            <span className="roster-chip-count" title={t("crew.sheet.workingDays")}>
              {assignedCount}d
            </span>
          </div>
        )}
        {/* Date × phase state is intentionally stored independently from
            assignedDates. Several phases may share one date, so deriving
            phase state from the flat date array makes removing Load-out
            also clear Show. The matrix keeps the exact selections while
            still deriving the legacy assignedDates API payload. */}
        {editableLocal && onLocalSetDays && phaseDays
          ? (
              <AssignShiftsModal
                crew={local!}
                phaseDays={phaseDays}
                phaseShiftTimes={phaseShiftTimes}
                rolePeers={rolePeers ?? [local!]}
                 onSave={(dates, phases, times, windows, tasks) =>
                   Promise.resolve(onLocalSetDays(dates, phases, times, windows, tasks))
                 }
                onApplyToRole={(phases, times, windows, tasks) =>
                  onApplyScheduleToRole?.(phases, times, windows, tasks)
                }
              />
            )
          : null}
      </td>
      <td>
        <HotelQuickPick
          row={row}
          phaseDays={phaseDays}
          saving={hotelSaving}
          onSet={
            row.source === "gig" && onHotelDatesSet
              ? onHotelDatesSet
              : editableLocal && onLocalUpdate
                ? (dates) => {
                    const sorted = [...dates].sort();
                    onLocalUpdate({
                      hotelDates: sorted,
                      needsHotel: sorted.length > 0,
                    });
                  }
                : undefined
          }
          onLegacyToggle={
            row.source === "gig" && onHotelToggle && row.hotelDates.length === 0
              ? onHotelToggle
              : undefined
          }
        />
      </td>
      <td>
        {row.source === "gig" ? (
          <FoodCell
            tags={row.dietaryTags}
            allergens={row.allergens}
            profileless={row.profileless}
          />
        ) : (
          <span className="crew-pill-empty">—</span>
        )}
      </td>
      <td>
        {row.phone ? (
          <a
            className="roster-phone"
            href={`tel:${row.phone.replace(/\s+/g, "")}`}
            title={t("crew.sheet.callPerson")}
          >
            {row.phone}
          </a>
        ) : (
          <span className="crew-pill-empty">—</span>
        )}
      </td>
      <td>
        {onLocalUpdate ? (
          <input
            className="led-input"
            type="text"
            value={local?.notes ?? row.notes ?? ""}
            onChange={(e) => onLocalUpdate?.({ notes: e.target.value })}
            placeholder={t("crew.sheet.notesPlaceholder")}
          />
        ) : row.notes ? (
          <span className="roster-notes">{row.notes}</span>
        ) : (
          <span className="crew-pill-empty">—</span>
        )}
      </td>
      {showProductionDetails ? (
        <>
          <td>
            {onLocalUpdate ? (
              <input
                className="led-input led-input-num"
                type="time"
                value={local?.callTime ?? ""}
                onChange={(e) =>
                  onLocalUpdate?.({ callTime: e.target.value })
                }
              />
            ) : row.callTime ? (
              <span>{row.callTime}</span>
            ) : (
              <span className="crew-pill-empty">—</span>
            )}
          </td>
          <td>
            {onLocalUpdate ? (
              <input
                className="led-input led-input-num"
                type="time"
                value={local?.offTime ?? ""}
                onChange={(e) =>
                  onLocalUpdate?.({ offTime: e.target.value })
                }
              />
            ) : row.offTime ? (
              <span>{row.offTime}</span>
            ) : (
              <span className="crew-pill-empty">—</span>
            )}
          </td>
          <td className="led-num">
            {onLocalUpdate ? (
              <NumberField
                className="led-input led-input-num"
                min={0}
                step={10}
                value={local?.dayRate ?? row.dayRate ?? 0}
                transform={(n) => Math.max(0, n || 0)}
                emptyValue={0}
                onCommit={(dayRate) => onLocalUpdate?.({ dayRate })}
              />
            ) : row.dayRate ? (
              <span>{row.dayRate.toLocaleString("en-US")}</span>
            ) : (
              <span className="crew-pill-empty">—</span>
            )}
          </td>
        </>
      ) : null}
      <td className="led-actions">
        {onCancelRequest ? (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onCancelRequest}
            disabled={cancelSaving}
            title={t("crew.cancel.title")}
          >
            {cancelSaving ? t("crew.cancel.cancelling") : t("crew.cancel.action")}
          </button>
        ) : onRemoveBooking ? (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onRemoveBooking}
            disabled={removeBookingSaving}
            title={t("crew.remove.title")}
          >
            {removeBookingSaving
              ? t("crew.remove.removing")
              : t("crew.remove.action")}
          </button>
        ) : onLocalRemove ? (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={onLocalRemove}
            title={t("crew.sheet.removeHint")}
          >
            {t("common.remove")}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

/** Per-day hotel quick-pick. Mirrors the working-days quick-pick on
 *  the days cell, but constrained to `row.assignedDates` — the
 *  producer can never book a hotel night for a day the person isn't
 *  on call. Each phase button toggles its overlap with assignedDates
 *  in/out of `hotelDates`; "All" fills every assigned day, "None"
 *  clears. Active state = every overlap day is currently in
 *  hotelDates. Hides phases with zero overlap so the row only shows
 *  what's actually pickable. */
function HotelQuickPick({
  row,
  phaseDays,
  saving,
  onSet,
  onLegacyToggle,
}: {
  row: RosterRow;
  phaseDays?: Partial<Record<string, ReadonlyArray<string>>>;
  saving: boolean;
  onSet?: (dates: ReadonlyArray<string>) => void;
  /** Legacy boolean toggle — only used for gig rows that have no
   *  hotelDates yet AND no assignedDates (e.g. a freshly-confirmed
   *  gig before the producer picked working days). Lets the producer
   *  flag the person for a hotel before the day picker becomes
   *  meaningful. */
  onLegacyToggle?: (next: boolean) => void;
}) {
  const t = useT();
  const assigned = row.assignedDates;
  const hotel = row.hotelDates;
  const hotelSet = useMemo(() => new Set(hotel), [hotel]);
  // Collapsed by default so the table stays visually quiet — the
  // producer only sees a compact summary chip per row, and the phase
  // picker expands inline when they tap it. Keeping the state local
  // (one boolean per row) means we don't need to persist anything;
  // the picker auto-collapses on remount, which is what you want
  // after a poll-driven refetch.
  const [expanded, setExpanded] = useState(false);
  if (!onSet) {
    // Read-only fallback (e.g. a gig row whose handler the parent
    // didn't wire). Show the count if any nights are picked, else
    // a quiet em-dash.
    return hotel.length > 0 ? (
      <span className="roster-hotel-label" title={hotel.join(", ")}>
        {t("crew.sheet.hotelNightsCount", { count: hotel.length })}
      </span>
    ) : (
      <span className="crew-pill-empty">—</span>
    );
  }
  if (assigned.length === 0) {
    // No working days yet — fall back to the legacy boolean toggle so
    // the producer can still flag "this person needs a hotel" before
    // picking dates. Once dates exist the picker takes over and the
    // boolean is derived from hotelDates.length > 0.
    if (!onLegacyToggle) {
      return (
        <span className="crew-pill-empty" title={t("crew.sheet.pickDaysFirst")}>
          —
        </span>
      );
    }
    return (
      <label className="roster-hotel" title={t("crew.sheet.hotelRequiredHint")}>
        <input
          type="checkbox"
          checked={row.hotelRequired}
          disabled={saving}
          onChange={(e) => onLegacyToggle(e.target.checked)}
        />
        <span className="roster-hotel-label">
          {row.hotelRequired ? t("crew.sheet.hotel") : t("common.no")}
        </span>
      </label>
    );
  }
  // Collapsed state: a single compact summary button. Tapping it
  // expands the phase picker. Two visual variants:
  //   • No nights yet → "+ Hotel" (neutral chip, invites a click)
  //   • Some nights   → "🏨 N nights" using the active-orange style
  //                     so it's instantly readable in the table.
  if (!expanded) {
    const hasNights = hotel.length > 0;
    return (
      <button
        type="button"
        className={
          "roster-day-quickpick-btn" +
          (hasNights ? " roster-day-quickpick-btn-active" : "")
        }
        disabled={saving}
        title={
          hasNights
            ? t("crew.sheet.editHotelNights", { count: hotel.length })
            : t("crew.sheet.addHotelNights")
        }
        onClick={() => setExpanded(true)}
      >
        {hasNights
          ? `🏨 ${t("crew.sheet.hotelNightsCount", { count: hotel.length })}`
          : t("crew.sheet.addHotel")}
      </button>
    );
  }
  const phaseEntries = (
    ["setup", "rehearsal", "show", "downrig"] as const
  )
    .map((k) => ({
      key: k,
      // Constrain each phase to the row's working days so the producer
      // can't accidentally pick a Show-day hotel night for someone
      // who's only on call during Setup.
      days: (phaseDays?.[k] ?? []).filter((d) => assigned.includes(d)),
    }))
    .filter((p) => p.days.length > 0);
  const phaseLabel: Record<string, string> = {
    setup: t("portal.brief.phase.setup"),
    rehearsal: t("portal.brief.phase.rehearsal"),
    show: t("portal.brief.phase.show"),
    downrig: t("portal.brief.phase.loadOut"),
  };
  const isPhaseActive = (days: ReadonlyArray<string>) =>
    days.length > 0 && days.every((d) => hotelSet.has(d));
  return (
    <div
      className={`roster-day-quickpick${saving ? " is-saving" : ""}`}
      role="group"
      aria-label={t("crew.sheet.quickFillHotel")}
      aria-busy={saving || undefined}
    >
      <span className="roster-day-quickpick-label">
        {t("crew.sheet.hotel")}{hotel.length > 0 ? ` (${hotel.length})` : ""}:
      </span>
      {phaseEntries.map((p) => {
        const active = isPhaseActive(p.days);
        return (
          <button
            key={p.key}
            type="button"
            className={
              "roster-day-quickpick-btn" +
              (active ? " roster-day-quickpick-btn-active" : "")
            }
            aria-pressed={active}
            disabled={saving}
            title={
              active
                ? `Remove ${phaseLabel[p.key]} hotel nights (${p.days.length})`
                : `Add ${phaseLabel[p.key]} hotel nights (${p.days.length})`
            }
            onClick={() => {
              const next = new Set(hotel);
              if (active) {
                for (const d of p.days) next.delete(d);
              } else {
                for (const d of p.days) next.add(d);
              }
              onSet([...next]);
            }}
          >
            {phaseLabel[p.key]}
          </button>
        );
      })}
      <button
        type="button"
        className={
          "roster-day-quickpick-btn" +
          (assigned.every((d) => hotelSet.has(d)) && hotel.length > 0
            ? " roster-day-quickpick-btn-active"
            : "")
        }
        disabled={saving}
        title={t("crew.sheet.hotelAllHint")}
        onClick={() => onSet([...assigned])}
      >
        {t("project.status.all")}
      </button>
      <button
        type="button"
        className="roster-day-quickpick-btn roster-day-quickpick-btn-clear"
        disabled={saving || hotel.length === 0}
        title={t("crew.sheet.clearHotelHint")}
        onClick={() => onSet([])}
      >
        {t("common.no")}
      </button>
      {/* Tiny ✕ collapses the picker back to the summary chip. We
       *  leave this manual rather than auto-collapsing on save so the
       *  producer can pick e.g. Setup then Show in two taps without
       *  the picker disappearing between clicks. */}
      <button
        type="button"
        className="roster-day-quickpick-btn roster-day-quickpick-btn-clear"
        title={t("crew.sheet.hideHotel")}
        aria-label={t("crew.sheet.hideHotel")}
        onClick={() => setExpanded(false)}
      >
        ✕
      </button>
    </div>
  );
}

function FoodCell({
  tags,
  allergens,
  profileless,
}: {
  tags: DietaryTag[];
  allergens: string[];
  profileless: boolean;
}) {
  const t = useT();
  if (profileless) {
    return (
      <span className="crew-pill-empty" title={t("crew.sheet.noProfileUnknown")}>
        ?
      </span>
    );
  }
  if (tags.length === 0 && allergens.length === 0) {
    return <span className="crew-pill-empty">{t("common.no")}</span>;
  }
  return (
    <div className="roster-food">
      {tags.map((t) => (
        <span key={t} className="crew-pill crew-pill-warn" title={t}>
          {DIETARY_LABELS[t]}
        </span>
      ))}
      {allergens.length > 0 ? (
        <span
          className="crew-pill crew-pill-bad"
          title={`Allergens: ${allergens.join(", ")}`}
        >
          ⚠ {allergens.length} allergen{allergens.length === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

const DIETARY_LABELS: Record<DietaryTag, string> = {
  vegetarian: "veg",
  vegan: "vegan",
  halal: "halal",
  "gluten-free": "GF",
  "lactose-free": "LF",
};

function statusIcon(status: RosterRow["status"]): string {
  switch (status) {
    case "accepted":
    case "confirmed":
    case "done":
    case "invoiced":
    case "paid":
      return "✓";
    case "declined":
      return "×";
    case "requested":
    case "invited":
    case "partially_accepted":
      return "●";
    default:
      return "";
  }
}

function statusTone(s: RosterRow["status"]): "ok" | "warn" | "bad" | "muted" {
  switch (s) {
    case "confirmed":
    case "done":
    case "invoiced":
    case "paid":
    case "accepted":
      return "ok";
    case "invited":
    case "requested":
    case "partially_accepted":
      return "warn";
    case "no-reply":
    case "too_late":
      return "bad";
    case "declined":
      // Producer-facing: a declined crew member should read as "this
      // slot lost a candidate" — light red, not muted grey, so it
      // doesn't visually blend with hand-typed in-house crew.
      return "bad";
    case "manual":
      return "muted";
    default:
      return "muted";
  }
}

function statusLabel(s: RosterRow["status"], t: ReturnType<typeof useT>): string {
  switch (s) {
    case "invited":
      return t("crew.status.invited");
    case "confirmed":
      return t("crew.status.confirmed");
    case "done":
      return t("crew.status.done");
    case "invoiced":
      return t("crew.status.invoiced");
    case "paid":
      return t("crew.status.paid");
    case "requested":
      return t("crew.status.requested");
    case "accepted":
      return t("crew.status.accepted");
    case "partially_accepted":
      return t("crew.status.partiallyAccepted");
    case "declined":
      return t("crew.status.declined");
    case "no-reply":
      return t("crew.status.noReply");
    case "too_late":
      return t("crew.status.tooLate");
    case "manual":
      return t("crew.status.inHouse");
    default:
      return s;
  }
}

function dayResponseStatus(
  row: RosterRow,
  date: string,
): "accepted" | "declined" | "partial" | "pending" | null {
  const decisions = Object.entries(row.shiftResponses)
    .filter(([key]) => key.startsWith(`${date}::`))
    .map(([, value]) => value);
  if (decisions.length > 0) {
    const accepted = decisions.includes("accepted");
    const declined = decisions.includes("declined");
    if (accepted && declined) return "partial";
    return accepted ? "accepted" : "declined";
  }
  if (
    row.status === "requested" ||
    row.status === "invited" ||
    row.status === "no-reply"
  ) {
    return "pending";
  }
  if (row.status === "declined") return "declined";
  if (
    row.assignedDates.includes(date) &&
    (row.source === "gig" ||
      row.status === "accepted" ||
      row.status === "confirmed")
  ) {
    return "accepted";
  }
  return null;
}
