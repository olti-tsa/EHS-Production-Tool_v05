import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { PALETTE, type ThemeMode } from "../lib/portalTheme";
import { ItinerarySection } from "./ItinerarySection";
import { useI18n, useT } from "../../lib/i18n/I18nContext";
import type { Translator } from "../../lib/i18n/I18nContext";
import type { TranslationKey } from "../../lib/i18n/types";
import {
  buildAcceptedSnapshot,
  gigFromBrief,
  updateBrief,
  type BriefDecision,
  type PortalData,
  type ShiftResponseMap,
} from "../lib/portalStorage";
import type {
  BriefAssignment,
  BriefAttachment,
  BriefRiggPlan,
  BriefSchedule,
  BriefSchedulePhaseKey,
  ProjectBrief,
} from "../../lib/projectBrief";
import { attachmentDownloadUrl } from "../../lib/briefAttachmentUpload";
import {
  diffBriefAgainstSnapshot,
  type DiffEntry,
} from "../../lib/briefDiff";
import {
  downloadBriefIcs,
  downloadBriefAndItineraryIcs,
  type ItineraryHotelDay,
} from "../../lib/icalExport";
import { openCallSheet } from "../../lib/callSheetExport";
import {
  findScheduleConflicts,
  type ScheduleConflict,
} from "../../lib/scheduleConflicts";

const PHASE_LABEL_KEYS: Record<BriefSchedulePhaseKey, TranslationKey> = {
  setup: "portal.brief.phase.setup",
  rehearsal: "portal.brief.phase.rehearsal",
  show: "portal.brief.phase.show",
  // Internal key stays "downrig" (legacy from older briefs); user-facing
  // label is "Load Out" everywhere in the UI.
  downrig: "portal.brief.phase.loadOut",
};
const PHASE_ORDER: BriefSchedulePhaseKey[] = [
  "setup",
  "rehearsal",
  "show",
  "downrig",
];

/** Expand an inclusive YYYY-MM-DD range into the list of day strings.
 *  Bounded at 60 days defensively. Mirrors expandProjectDays in
 *  lib/crew.ts but kept local to the portal so this screen has no
 *  cross-package import. */
function expandRangeDays(from: string, to: string): string[] {
  if (!from) return [];
  const end = to || from;
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end);
  if (!m1 || !m2) return [];
  const s = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  const e = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  if (e < s) return [];
  const out: string[] = [];
  const cur = new Date(s);
  for (let i = 0; i < 60 && cur <= e; i += 1) {
    const y = cur.getFullYear();
    const mo = String(cur.getMonth() + 1).padStart(2, "0");
    const da = String(cur.getDate()).padStart(2, "0");
    out.push(`${y}-${mo}-${da}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Short calendar label, e.g. "Mon 5 May". Used for compact day chips. */
function formatDayShort(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Bucket the assignment's working days into phase groups using the
 *  brief's schedule, plus any "extras" that don't fall inside a phase
 *  the producer scheduled. Used by the freelancer's AssignmentCard so
 *  they immediately see "I'm here for Setup + Load Out, not the Show". */
type AssignedPhaseBucket = {
  key: BriefSchedulePhaseKey | "extra";
  label: string;
  days: string[];
};
function groupAssignedDaysByPhase(
  assignedDates: ReadonlyArray<string>,
  schedule: BriefSchedule | undefined,
  t: Translator,
): AssignedPhaseBucket[] {
  const dates = [...assignedDates].sort();
  if (dates.length === 0) return [];
  const remaining = new Set(dates);
  const buckets: AssignedPhaseBucket[] = [];
  if (schedule) {
    for (const key of PHASE_ORDER) {
      const segs = schedule[key] ?? [];
      const phaseDays: string[] = [];
      for (const seg of segs) {
        for (const d of expandRangeDays(seg.from, seg.to)) {
          if (remaining.has(d) && !phaseDays.includes(d)) phaseDays.push(d);
        }
      }
      if (phaseDays.length > 0) {
        for (const d of phaseDays) remaining.delete(d);
        buckets.push({
          key,
          label: t(PHASE_LABEL_KEYS[key]),
          days: phaseDays.sort(),
        });
      }
    }
  }
  if (remaining.size > 0) {
    buckets.push({
      key: "extra",
      label: t("portal.brief.extraDays"),
      days: [...remaining].sort(),
    });
  }
  return buckets;
}

function formatRange(from: string, to: string): string {
  if (from && to && from !== to) {
    return `${formatDate(from)} → ${formatDate(to)}`;
  }
  return formatDate(from || to);
}

function formatTimeRange(fromTime?: string, toTime?: string): string {
  if (!fromTime && !toTime) return "";
  if (fromTime && toTime) return `${fromTime} → ${toTime}`;
  return fromTime || toTime || "";
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  // Parse YYYY-MM-DD as a *local* calendar date, not UTC, so we never
  // shift by a day in negative-offset timezones. Falls back to the
  // native parser only if the string isn't a plain calendar date.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatNok(n: number): string {
  if (!isFinite(n)) return "kr 0";
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function formatNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(n);
}

function watts(w: number): string {
  if (w >= 1000) return `${(w / 1000).toFixed(w >= 10000 ? 0 : 1)} kW`;
  return `${Math.round(w)} W`;
}

export function BriefDetail({
  theme,
  briefId,
  data,
  setData,
}: {
  theme: ThemeMode;
  briefId: string;
  data: PortalData;
  setData: React.Dispatch<React.SetStateAction<PortalData>>;
}) {
  const c = PALETTE[theme];
  const { t, locale } = useI18n();
  const { getToken } = useAuth();
  const [, setLocation] = useLocation();
  // One project URL can contain several independently-bookable role slots.
  // The assignment id is the active mutation identity; legacy imported
  // entries have no id and naturally remain a one-entry view.
  const entries = useMemo(
    () => data.briefs.filter((candidate) => candidate.briefId === briefId),
    [data.briefs, briefId],
  );
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | undefined>();
  const entry =
    entries.find((candidate) => candidate.assignmentId === activeAssignmentId) ??
    entries[0];
  useEffect(() => {
    if (!entries.some((candidate) => candidate.assignmentId === activeAssignmentId)) {
      setActiveAssignmentId(entries[0]?.assignmentId);
    }
  }, [entries, activeAssignmentId]);

  /** Inline banner shown below the project hero when the most recent
   *  accept/decline POST failed (network blip, 5xx, etc.). The local
   *  optimistic change is reverted in the same path so the buttons
   *  reflect the still-pending reality and the freelancer is invited
   *  to retry. Cleared on the next successful sync. */
  const [syncError, setSyncError] = useState<string | null>(null);

  /** POST `/api/portal/briefs/:id/respond` and report the outcome to
   *  the caller. Returns:
   *    - `{ ok: true,  tooLate: false, serverGigId? }` on a clean
   *      accept/decline. `serverGigId` is the row id the server
   *      materialised — the server now ignores any client-supplied
   *      `acceptedGigId` (to defeat IDOR) and always returns its own
   *      authoritative id, which the caller swaps the optimistic
   *      local gig over to.
   *    - `{ ok: true,  tooLate: true  }` when the server tells us a
   *      sibling candidate beat this freelancer to the slot. The
   *      caller is responsible for stripping the local accept and
   *      surfacing the "Position filled" UI.
   *    - `{ ok: false, … }` on any HTTP error other than the 404 we
   *      get for legacy share-link briefs that simply don't exist on
   *      the server (those are treated as a soft success so the
   *      offline-only flow keeps working). */
  type SyncResult =
    | { ok: true; tooLate: boolean; serverGigId?: string | null }
    | { ok: false; status?: number; error: string };
  const syncDecisionToServer = async (
    decision: "accepted" | "declined" | "pending",
    extras?: {
      acceptedSnapshot?: unknown;
      acceptedGigId?: string | null;
      shiftResponses?: ShiftResponseMap;
      declineReason?: string | null;
    },
  ): Promise<SyncResult> => {
    try {
      const token = await getToken();
      const baseUrl =
        (typeof import.meta !== "undefined" &&
          (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
        "/";
      const res = await fetch(
        `${baseUrl}api/portal/briefs/${briefId}/respond`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            ...(entry?.assignmentId ? { assignmentId: entry.assignmentId } : {}),
            decision,
            acceptedSnapshot: extras?.acceptedSnapshot ?? null,
            acceptedGigId: extras?.acceptedGigId ?? null,
            ...(extras?.shiftResponses
              ? { shiftResponses: extras.shiftResponses }
              : {}),
            ...(extras && "declineReason" in extras
              ? { declineReason: extras.declineReason }
              : {}),
          }),
        },
      );
      if (!res.ok) {
        // 404 = "no assignment for this user" — true for legacy
        // share-link briefs that were imported via QR/link and don't
        // have a server row. Treat as soft-success so the local
        // optimistic state is preserved.
        if (res.status === 404) return { ok: true, tooLate: false };
        return {
          ok: false,
          status: res.status,
          error: t("portal.brief.error.serverStatus", { status: res.status }),
        };
      }
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        tooLate?: boolean;
        error?: string;
        gig?: { id?: string | null } | null;
      };
      if (!json.ok) {
        return {
          ok: false,
          status: res.status,
          error: json.error || t("portal.brief.error.rejected"),
        };
      }
      const serverGigId =
        json.gig && typeof json.gig.id === "string" ? json.gig.id : null;
      return {
        ok: true,
        tooLate: Boolean(json.tooLate),
        serverGigId,
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : t("portal.brief.error.network"),
      };
    }
  };

  // Hooks must be called unconditionally — compute the assignment from a
  // possibly-null entry and short-circuit in the JSX below.
  const myAssignment = useMemo(() => {
    if (!entry) return null;
    return (
      entry.brief.assignments.find(
        (a) => a.crewId === entry.brief.recipientCrewId,
      ) ?? null
    );
  }, [entry]);

  if (!entry) {
    return (
      <section
        style={{
          background: c.cardBg,
          border: `1px solid ${c.border}`,
          borderRadius: 14,
          padding: 24,
          boxShadow: c.shadowSoft,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          {t("portal.brief.notFound")}
        </div>
        <div style={{ fontSize: 14, color: c.muted, marginBottom: 16 }}>
          {t("portal.brief.notFoundBody")}
        </div>
        <Link
          href="/portal/briefs"
          style={{
            display: "inline-block",
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 700,
            background: c.accent,
            color: "#0b0b0b",
            borderRadius: 8,
            textDecoration: "none",
          }}
        >
          {t("portal.brief.backToBriefs")}
        </Link>
      </section>
    );
  }

  const brief = entry.brief;

  // Conflict + diff state — recomputed whenever the brief or surrounding
  // portal data changes. Both are cheap pure functions.
  const conflicts = useMemo<ScheduleConflict[]>(
    () => findScheduleConflicts(brief, data, entry.acceptedGigId),
    [brief, data, entry.acceptedGigId],
  );
  const diffs = useMemo<DiffEntry[]>(() => {
    if (!entry.acceptedSnapshot) return [];
    if (entry.acceptedSnapshot.generatedAt >= brief.generatedAt) return [];
    return diffBriefAgainstSnapshot(entry.acceptedSnapshot, brief, {
      locale,
      tbdLabel: t("portal.brief.diff.value.tbd"),
    });
  }, [entry.acceptedSnapshot, brief, locale, t]);

  // Capture the pre-action snapshot once per click. We can't read this
  // off the React `data` prop inside the awaited callback because the
  // setData call may already have re-rendered by the time the sync
  // resolves — so we lift the values into local consts up-front.
  // The `if (!entry) return` re-guards in each function are belt-and-
  // braces: TypeScript's control-flow analysis doesn't propagate the
  // outer `if (!entry) return …` narrowing into nested function
  // declarations, so without these the new `entry.foo` reads would be
  // typed as possibly-undefined.
  async function accept(
    shiftResponses?: ShiftResponseMap,
    declineReason?: string | null,
  ) {
    if (!entry) return;
    const snapshot = buildAcceptedSnapshot(brief);
    const prevDecision = entry.decision;
    const prevAcceptedSnapshot = entry.acceptedSnapshot;
    const prevAcceptedGigId = entry.acceptedGigId;
    const prevShiftResponses = entry.shiftResponses;
    const prevDeclineReason = entry.declineReason;
    const nextDeclineReason =
      typeof declineReason === "string"
        ? declineReason.trim().slice(0, 1000) || null
        : declineReason ?? null;
    // Decide what gig id to send to the server *outside* the setData
    // updater. setData callbacks must be pure (React strict mode
    // double-invokes them in dev), so any side effect that mutates
    // outer-scope variables risks getting double-applied or being
    // unobservable on a stale closure read after the await. By
    // computing both `gigIdForServer` and `createdGig` from the
    // closure-captured `entry` here, the updater callback only has
    // to apply the precomputed values.
    const reusingExistingGig = Boolean(prevAcceptedGigId);
    const createdGig = reusingExistingGig ? null : gigFromBrief(brief);
    const gigIdForServer = reusingExistingGig
      ? prevAcceptedGigId ?? null
      : createdGig!.id;
    const createdGigId = createdGig?.id ?? null;
    setData((prev) => {
      const next = updateBrief(prev, briefId, {
        decision: "accepted",
        acceptedGigId: gigIdForServer ?? undefined,
        acceptedSnapshot: snapshot,
        shiftResponses,
        declineReason: nextDeclineReason,
        decidedLocallyAt: Date.now(),
      }, entry.assignmentId);
      return createdGig
        ? { ...next, gigs: [createdGig, ...next.gigs] }
        : next;
    });
    setSyncError(null);
    const result = await syncDecisionToServer("accepted", {
      acceptedSnapshot: snapshot,
      acceptedGigId: gigIdForServer,
      shiftResponses,
      declineReason: nextDeclineReason,
    });
    if (result.ok && result.tooLate) {
      // Race lost — strip the local accept and the gig we just made.
      setData((prev) => {
        const next = updateBrief(prev, briefId, {
          decision: "too_late",
          acceptedGigId: undefined,
          acceptedSnapshot: undefined,
          shiftResponses: undefined,
          declineReason: null,
          decidedLocallyAt: Date.now(),
        }, entry.assignmentId);
        return createdGigId
          ? { ...next, gigs: next.gigs.filter((g) => g.id !== createdGigId) }
          : next;
      });
      return;
    }
    if (!result.ok) {
      // Revert to the pre-click state and let the freelancer retry.
      setData((prev) => {
        const next = updateBrief(prev, briefId, {
          decision: prevDecision,
          acceptedGigId: prevAcceptedGigId,
          acceptedSnapshot: prevAcceptedSnapshot,
          shiftResponses: prevShiftResponses,
          declineReason: prevDeclineReason,
          decidedLocallyAt: undefined,
        }, entry.assignmentId);
        return createdGigId
          ? { ...next, gigs: next.gigs.filter((g) => g.id !== createdGigId) }
          : next;
      });
      setSyncError(
        t("portal.brief.error.saveResponse"),
      );
      return;
    }
    // Server accepted us. The server now authoritatively picks the gig
    // id (it ignores any client-supplied `acceptedGigId` to defeat
    // IDOR), so if it returned a different id than our optimistic
    // local gig we swap them: drop the local one, link the brief to
    // the server id. The polling effect in Portal.tsx will hydrate
    // the actual server gig fields on the next tick.
    if (
      result.serverGigId &&
      result.serverGigId !== gigIdForServer
    ) {
      const serverId = result.serverGigId;
      setData((prev) => {
        const next = updateBrief(prev, briefId, {
          acceptedGigId: serverId,
        }, entry.assignmentId);
        const filtered = createdGigId
          ? next.gigs.filter((g) => g.id !== createdGigId)
          : next.gigs;
        return { ...next, gigs: filtered };
      });
    }
  }

  async function acknowledgeChanges() {
    if (!entry) return;
    const snapshot = buildAcceptedSnapshot(brief);
    const prevSnapshot = entry.acceptedSnapshot;
    setData((prev) =>
      updateBrief(prev, briefId, {
        acceptedSnapshot: snapshot,
        decidedLocallyAt: Date.now(),
      }, entry.assignmentId),
    );
    setSyncError(null);
    // Acknowledging a change is still an "accepted" decision on the
    // server — the snapshot diff is producer-irrelevant; what they
    // care about is "they're still in". A too-late response is
    // theoretically possible if a sibling hijacked the slot in between
    // the original accept and this re-confirm.
    const result = await syncDecisionToServer("accepted", {
      acceptedSnapshot: snapshot,
    });
    if (result.ok && result.tooLate) {
      setData((prev) =>
        updateBrief(prev, briefId, {
          decision: "too_late",
          acceptedGigId: undefined,
          acceptedSnapshot: undefined,
          decidedLocallyAt: Date.now(),
        }, entry.assignmentId),
      );
      return;
    }
    if (!result.ok) {
      setData((prev) =>
        updateBrief(prev, briefId, {
          acceptedSnapshot: prevSnapshot,
          decidedLocallyAt: undefined,
        }, entry.assignmentId),
      );
      setSyncError(
        t("portal.brief.error.acknowledge"),
      );
    }
  }

  async function decline(
    shiftResponses?: ShiftResponseMap,
    declineReason?: string | null,
  ) {
    if (!entry) return;
    const prevDecision = entry.decision;
    const prevAcceptedGigId = entry.acceptedGigId;
    const prevAcceptedSnapshot = entry.acceptedSnapshot;
    const prevShiftResponses = entry.shiftResponses;
    const prevDeclineReason = entry.declineReason;
    const nextDeclineReason =
      typeof declineReason === "string"
        ? declineReason.trim().slice(0, 1000) || null
        : declineReason ?? null;
    // If the freelancer is reversing a prior accept, capture the gig
    // they made then so we can restore it on a sync failure.
    const wasAccepted = prevDecision === "accepted";
    const removedGig = wasAccepted && prevAcceptedGigId
      ? data.gigs.find((g) => g.id === prevAcceptedGigId) ?? null
      : null;
    setData((prev) => {
      const next = updateBrief(prev, briefId, {
        decision: "declined",
        // Tearing down the booking on the freelancer's side: clear the
        // brief's link to the gig and drop the gig itself, otherwise
        // the Gigs / Calendar screens keep showing a confirmed booking
        // for a brief that's now declined. The server is doing the
        // same teardown in the same /respond transaction, so the
        // multi-device poll will agree.
        acceptedGigId: undefined,
        acceptedSnapshot: undefined,
        shiftResponses,
        declineReason: nextDeclineReason,
        decidedLocallyAt: Date.now(),
      }, entry.assignmentId);
      return prevAcceptedGigId
        ? { ...next, gigs: next.gigs.filter((g) => g.id !== prevAcceptedGigId) }
        : next;
    });
    setSyncError(null);
    const result = await syncDecisionToServer("declined", {
      shiftResponses,
      declineReason: nextDeclineReason,
    });
    if (!result.ok) {
      setData((prev) => {
        const next = updateBrief(prev, briefId, {
          decision: prevDecision,
          acceptedGigId: prevAcceptedGigId,
          acceptedSnapshot: prevAcceptedSnapshot,
          shiftResponses: prevShiftResponses,
          declineReason: prevDeclineReason,
          decidedLocallyAt: undefined,
        }, entry.assignmentId);
        return removedGig
          ? { ...next, gigs: [removedGig, ...next.gigs] }
          : next;
      });
      setSyncError(
        t("portal.brief.error.saveDecline"),
      );
    }
  }

  async function resetDecision() {
    if (!entry) return;
    const prevDecision = entry.decision;
    const prevAcceptedGigId = entry.acceptedGigId;
    const prevAcceptedSnapshot = entry.acceptedSnapshot;
    const prevShiftResponses = entry.shiftResponses;
    const prevDeclineReason = entry.declineReason;
    // Same gig-teardown logic as decline(): undoing an accept must
    // pull the materialised gig back out of the freelancer's local
    // calendar so they don't see a stale "confirmed" booking for a
    // brief they're no longer committed to.
    const wasAccepted = prevDecision === "accepted";
    const removedGig = wasAccepted && prevAcceptedGigId
      ? data.gigs.find((g) => g.id === prevAcceptedGigId) ?? null
      : null;
    setData((prev) => {
      const next = updateBrief(prev, briefId, {
        decision: "pending",
        acceptedGigId: undefined,
        acceptedSnapshot: undefined,
        shiftResponses: undefined,
        declineReason: null,
        decidedLocallyAt: Date.now(),
      }, entry.assignmentId);
      return prevAcceptedGigId
        ? { ...next, gigs: next.gigs.filter((g) => g.id !== prevAcceptedGigId) }
        : next;
    });
    setSyncError(null);
    const result = await syncDecisionToServer("pending");
    if (!result.ok) {
      setData((prev) => {
        const next = updateBrief(prev, briefId, {
          decision: prevDecision,
          acceptedGigId: prevAcceptedGigId,
          acceptedSnapshot: prevAcceptedSnapshot,
          shiftResponses: prevShiftResponses,
          declineReason: prevDeclineReason,
          decidedLocallyAt: undefined,
        }, entry.assignmentId);
        return removedGig
          ? { ...next, gigs: [removedGig, ...next.gigs] }
          : next;
      });
      setSyncError(
        t("portal.brief.error.undo"),
      );
    }
  }

  /** Build the freelancer's .ics. We try to enrich with itinerary
   *  hotel events first; if that fetch fails for ANY reason (not yet
   *  accepted → 403, network blip, server hiccup) we silently fall
   *  back to the brief-only export so the calendar button is always
   *  responsive. The user gets *something* even when the server is
   *  having a bad day. */
  async function downloadCalendar() {
    let itineraryDays: ItineraryHotelDay[] | null = null;
    try {
      const token = await getToken();
      const baseUrl =
        (typeof import.meta !== "undefined" &&
          (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
        "/";
      const res = await fetch(
        `${baseUrl}api/portal/briefs/${briefId}/itinerary`,
        {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          days?: ItineraryHotelDay[];
        } | null;
        if (json && json.ok && Array.isArray(json.days)) {
          itineraryDays = json.days;
        }
      }
    } catch {
      // ignore — fall through to brief-only export below.
    }
    if (itineraryDays && itineraryDays.length > 0) {
      downloadBriefAndItineraryIcs(brief, itineraryDays);
    } else {
      downloadBriefIcs(brief);
    }
  }

  function openCallSheetWindow() {
    const result = openCallSheet(brief, {
      locale,
      copy: {
        phases: { setup: t("export.callSheet.phase.setup"), rehearsal: t("export.callSheet.phase.rehearsal"), show: t("export.callSheet.phase.show"), downrig: t("export.callSheet.phase.downrig") },
        productionSchedule: t("export.callSheet.productionSchedule"), yourCall: t("export.callSheet.yourCall"), noAssignment: t("export.callSheet.noAssignment"), role: t("export.callSheet.role"), callTime: t("export.callSheet.callTime"), offTime: t("export.callSheet.offTime"), hours: t("export.callSheet.hours"), dayRate: t("export.callSheet.dayRate"), notes: t("export.callSheet.notes"), tbd: t("export.callSheet.tbd"), day: (day) => t("export.callSheet.day", { day }),
        untitledShow: t("export.callSheet.untitledShow"), generated: (date) => t("export.callSheet.generated", { date }), documentTitle: (venue) => t("export.callSheet.documentTitle", { venue }), personalCallSheet: t("export.callSheet.personalCallSheet"), showDate: t("export.callSheet.showDate"), projectManager: t("export.callSheet.projectManager"), for: t("export.callSheet.for"), crew: t("export.callSheet.crew"), footer: (briefId) => t("export.callSheet.footer", { briefId }), print: t("export.callSheet.print"),
      },
    });
    if (!result.ok) {
      alert(
        t("portal.brief.error.callSheet"),
      );
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ fontSize: 13 }}>
        <Link
          href="/portal/briefs"
          style={{ color: c.muted, textDecoration: "none", fontWeight: 600 }}
        >
          ← {t("portal.brief.allBriefs")}
        </Link>
      </div>

      {/* Exact plain-text block from Project Overview. Keep it at the top of
          the freelancer brief and preserve the producer's whitespace. */}
      {brief.project.description ? (
        <section
          style={{
            background: c.cardBg,
            border: `1px solid ${c.border}`,
            borderLeft: "4px solid #f88000",
            borderRadius: 12,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              color: c.muted,
              marginBottom: 6,
            }}
          >
            {t("portal.brief.projectNotes")}
          </div>
          <div
            data-testid="text-complete-project-brief"
            style={{
              color: c.text,
              fontSize: 14,
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              overflow: "visible",
              maxHeight: "none",
            }}
          >
            {brief.project.description}
          </div>
        </section>
      ) : null}

      {/* Project hero */}
      <section
        style={{
          background: c.cardBg,
          border: `1px solid ${c.border}`,
          borderRadius: 14,
          padding: "20px 20px 16px",
          boxShadow: c.shadowSoft,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: c.accent,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {t("portal.brief.projectBriefing")}
        </div>
        <h1
          style={{
            margin: "4px 0 6px",
            fontSize: 26,
            fontWeight: 800,
            lineHeight: 1.15,
          }}
        >
          {brief.project.projectName ||
            brief.project.venue ||
            t("portal.briefs.untitledShow")}
        </h1>
        {brief.project.client ? (
          <div
            style={{
              color: c.text,
              fontSize: 14,
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            {t("portal.brief.for", { client: "" })}
            <span style={{ color: c.text, fontWeight: 800 }}>
              {brief.project.client}
            </span>
          </div>
        ) : null}
        <div style={{ color: c.muted, fontSize: 14 }}>
          {brief.project.endDate &&
          brief.project.endDate !== brief.project.date
            ? `${formatDate(brief.project.date)} → ${formatDate(brief.project.endDate)}`
            : formatDate(brief.project.date)}
          {brief.project.preparedBy ? (
            <>
              {" · "}
              {t("portal.brief.preparedBy", { name: "" })}
              <span style={{ color: c.text, fontWeight: 600 }}>
                {brief.project.preparedBy}
              </span>
            </>
          ) : null}
        </div>
        {brief.project.venueTechnicalSnapshot ? (
          <div
            data-testid="text-venue-details"
            style={{
              display: "grid",
              gap: 3,
              marginTop: 10,
              color: c.text,
              fontSize: 13,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {brief.project.venueTechnicalSnapshot.name ? (
              <strong>{String(brief.project.venueTechnicalSnapshot.name)}</strong>
            ) : null}
            {brief.project.venueTechnicalSnapshot.address ? (
              <span>{String(brief.project.venueTechnicalSnapshot.address)}</span>
            ) : null}
            {brief.project.venueTechnicalSnapshot.website ? (
              <a
                data-testid="link-venue-website"
                href={String(brief.project.venueTechnicalSnapshot.website)}
                target="_blank"
                rel="noreferrer"
                style={{ color: c.accent, overflowWrap: "anywhere" }}
              >
                {String(brief.project.venueTechnicalSnapshot.website)}
              </a>
            ) : null}
          </div>
        ) : null}
      </section>

      {entries.length > 1 ? (
        <section
          style={{
            background: c.cardBg,
            border: `1px solid ${c.border}`,
            borderRadius: 12,
            padding: 14,
            boxShadow: c.shadowSoft,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: c.muted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>
            Your role bookings
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {entries.map((roleEntry, index) => {
              const assignment = roleEntry.brief.assignments.find(
                (candidate) => candidate.crewId === roleEntry.brief.recipientCrewId,
              );
              const label = assignment?.role || `Booking ${index + 1}`;
              const state = roleEntry.decision === "accepted" &&
                Object.values(roleEntry.shiftResponses ?? {}).includes("declined")
                ? "Partially accepted"
                : roleEntry.decision === "too_late"
                  ? "Position filled"
                  : roleEntry.decision[0].toUpperCase() + roleEntry.decision.slice(1);
              const active = roleEntry.assignmentId === entry.assignmentId;
              return (
                <button
                  key={roleEntry.assignmentId ?? `legacy-${index}`}
                  type="button"
                  onClick={() => {
                    setActiveAssignmentId(roleEntry.assignmentId);
                    setSyncError(null);
                  }}
                  style={{
                    textAlign: "left", cursor: "pointer", padding: "8px 10px",
                    borderRadius: 9, border: `1px solid ${active ? c.accent : c.border}`,
                    background: active ? "rgba(248,128,0,0.12)" : c.cardBgSubtle,
                    color: c.text,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 800 }}>{label}</div>
                  <div style={{ fontSize: 11, color: active ? c.accent : c.muted, marginTop: 2 }}>{state}</div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Venue Technical Specs (server-appended snapshot) */}
      {brief.project.venueTechnicalSnapshot && Object.keys(brief.project.venueTechnicalSnapshot).length > 0 ? (
        <section
          style={{
            background: c.cardBg,
            border: `1px solid ${c.border}`,
            borderRadius: 12,
            padding: "16px",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: c.text,
              marginBottom: 12,
            }}
          >
            {t("portal.brief.venueTechSpecs")}
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            {Object.entries(brief.project.venueTechnicalSnapshot).map(([category, fields]) => {
              if (!fields || typeof fields !== "object" || !Object.values(fields).some(Boolean)) return null;
              if (!["riggingSpecs", "powerInfrastructure", "logisticsAccess", "siteFacilities"].includes(category)) return null;

              const title = category === "riggingSpecs" ? t("portal.brief.riggingAndStage")
                : category === "powerInfrastructure" ? t("portal.brief.powerInfrastructure")
                : category === "logisticsAccess" ? t("portal.brief.logisticsAccess")
                : t("portal.brief.siteFacilities");

              return (
                <div key={category}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: c.muted, marginBottom: 4 }}>{title}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                    {Object.entries(fields as Record<string, string>).filter(([_, val]) => val).map(([k, val]) => (
                      <div key={k} style={{ background: c.inputBg, padding: 8, borderRadius: 6 }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", color: c.muted, marginBottom: 2 }}>{k.replace(/([A-Z])/g, ' $1')}</div>
                        <div style={{ fontSize: 13, color: c.text }}>{String(val)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* "What changed since you accepted" banner — only when there is a
          newer producer revision than the snapshot we kept locally. */}
      {diffs.length > 0 ? (
        <UpdateBanner
          theme={theme}
          diffs={diffs}
          onAcknowledge={acknowledgeChanges}
        />
      ) : null}

      {/* First-to-accept-wins: server tells us a sibling candidate
          accepted before this freelancer. Take precedence over the
          accept/decline UI so the freelancer can immediately see why
          their accept buttons disappeared. */}
      {entry.decision === "too_late" ? (
        <TooLateBanner theme={theme} />
      ) : null}

      {/* Sync failure surface. Shown when the most recent /respond
          POST returned non-2xx (and was reverted) so the freelancer
          knows their decision didn't actually save and can retry. */}
      {syncError ? (
        <SyncErrorBanner
          theme={theme}
          message={syncError}
          onDismiss={() => setSyncError(null)}
        />
      ) : null}

      {/* One-tap calendar + call-sheet exports. Always available — even
          before the freelancer accepts — because reviewing dates and
          printing the call sheet is part of the decision process. */}
      <BriefActionRow
        theme={theme}
        onAddToCalendar={downloadCalendar}
        onOpenCallSheet={openCallSheetWindow}
      />

      {/* Per-day itinerary — server only returns content for an
          accepted assignee, so the section self-hides for owners /
          pending / declined freelancers. */}
      <ItinerarySection
        briefId={briefId}
        theme={theme}
        getToken={getToken}
      />

      {/* Your assignment */}
      {myAssignment ? (
        <AssignmentCard
          theme={theme}
          assignment={myAssignment}
          schedule={brief.project.schedule}
          decision={entry.decision}
          declineReason={entry.declineReason}
          shiftResponses={entry.shiftResponses}
          acceptedGigId={entry.acceptedGigId}
          conflicts={conflicts}
          onSubmitShiftResponses={(responses, declineReason) => {
            if (Object.values(responses).includes("accepted")) {
              void accept(responses, declineReason);
            } else {
              void decline(responses, declineReason);
            }
          }}
          onLegacyAccept={() => void accept(undefined, null)}
          onLegacyDecline={(reason) => void decline(undefined, reason)}
          onLegacyReset={() => void resetDecision()}
          onOpenGig={() => setLocation("/portal/gigs")}
        />
      ) : (
        <GenericNoticeCard
          theme={theme}
          decision={entry.decision}
          declineReason={entry.declineReason}
          acceptedGigId={entry.acceptedGigId}
          conflicts={conflicts}
          onAccept={accept}
           onDecline={(reason) => void decline(undefined, reason)}
          onReset={resetDecision}
          onOpenGig={() => setLocation("/portal/gigs")}
        />
      )}

      {/* Production schedule (only shown when at least one phase is set) */}
      {brief.project.schedule ? (
        <SectionCard theme={theme} title={t("portal.brief.prodSchedule")}>
          <ScheduleList theme={theme} schedule={brief.project.schedule} />
        </SectionCard>
      ) : null}

      {/* Project context */}
      <SectionCard theme={theme} title={t("portal.brief.crewCallSheet")}>
        <CrewTable
          theme={theme}
          assignments={brief.assignments}
          myCrewId={brief.recipientCrewId}
        />
      </SectionCard>

      <SectionCard theme={theme} title={t("portal.brief.rigging")}>
        <KvGrid
          theme={theme}
          items={[
            { k: "Systems", v: `${brief.rigging.systemCount}` },
            { k: "Hoist points", v: `${brief.rigging.hoistCount}` },
            {
              k: t("portal.brief.metric.totalMotorPower"),
              v:
                brief.rigging.totalMotorW > 0
                  ? watts(brief.rigging.totalMotorW)
                  : "—",
            },
          ]}
        />
        {brief.rigging.systems.length > 0 ? (
          <ul
            style={{
              margin: "12px 0 0",
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {brief.rigging.systems.map((s) => (
              <li
                key={s.id}
                style={{
                  padding: "10px 12px",
                  background: c.cardBgSubtle,
                  borderRadius: 10,
                  border: `1px solid ${c.border}`,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  fontSize: 13,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{s.name}</div>
                  <div style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                    {s.hoist} · DF {s.dynamicFactor}
                  </div>
                </div>
                <div style={{ color: c.muted, fontSize: 12, textAlign: "right" }}>
                  <div>{s.pointCount} pts · {s.riggingRowCount} rig</div>
                  <div>
                    {s.fixtureRowCount} fx · {s.ledRowCount} LED
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>

      <SectionCard theme={theme} title={t("portal.brief.lighting")}>
        <KvGrid
          theme={theme}
          items={[
            { k: "Fixtures", v: `${brief.lighting.fixtureCount}` },
            {
              k: t("portal.brief.metric.totalFixturePower"),
              v: brief.lighting.totalFixtureWatts > 0
                ? watts(brief.lighting.totalFixtureWatts)
                : "—",
            },
            {
              k: "DMX universes",
              v: brief.lighting.universes.length
                ? brief.lighting.universes.join(", ")
                : "—",
            },
            { k: "Power distros", v: `${brief.lighting.distroCount}` },
            {
              k: t("portal.brief.metric.totalDistroLoad"),
              v: brief.lighting.totalDistroW > 0
                ? watts(brief.lighting.totalDistroW)
                : "—",
            },
            {
              k: t("portal.brief.power.worstFeeder"),
              v: brief.lighting.worstDistroFeederPct > 0
                ? `${Math.round(brief.lighting.worstDistroFeederPct * 100)}%`
                : "—",
            },
            ...(brief.lighting.circuitCount > 0
              ? [
                  {
                    k: "Legacy circuits",
                    v: `${brief.lighting.circuitCount}`,
                  },
                  {
                    k: "Worst legacy phase",
                    v: brief.lighting.worstCircuitPct > 0
                      ? `${Math.round(brief.lighting.worstCircuitPct * 100)}%`
                      : "—",
                  },
                ]
              : []),
          ]}
        />
        {brief.lighting.distros.length > 0 ? (
          <ul
            style={{
              margin: "12px 0 0",
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {brief.lighting.distros.map((d) => {
              const flagged = d.feederOverload || d.channelOverload;
              const warn = !flagged && (d.imbalanceWarn || d.feederUtilization > 0.8);
              const accent = flagged
                ? "#dc2626"
                : warn
                  ? "#f59e0b"
                  : c.border;
              return (
                <li
                  key={d.id}
                  style={{
                    padding: "10px 12px",
                    background: c.cardBgSubtle,
                    borderRadius: 10,
                    border: `1px solid ${accent}`,
                    fontSize: 13,
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                    <div style={{ fontWeight: 600 }}>
                      {d.name}
                      {d.source ? (
                        <span style={{ color: c.muted, fontWeight: 400 }}>
                          {" — "}
                          {d.source}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ color: c.muted, fontSize: 12 }}>
                      {d.presetLabel}
                    </div>
                    {d.feedsTrusses.length > 0 ? (
                      <div style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                        Feeds: {d.feedsTrusses.join(", ")}
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <div>
                      {watts(d.totalWatts)} ·{" "}
                      {d.worstLegAmps.toLocaleString("en-US", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      A / {d.feedAmps} A
                    </div>
                    <div style={{ color: c.muted, fontSize: 12 }}>
                      Feeder {Math.round(d.feederUtilization * 100)}%
                      {d.feedPhases === 3
                        ? ` · imbalance ${Math.round(d.imbalance * 100)}%`
                        : ""}
                    </div>
                    {flagged ? (
                      <div style={{ color: "#dc2626", fontSize: 12, fontWeight: 600 }}>
                        {d.feederOverload
                          ? t("portal.brief.power.feederOver")
                          : t("portal.brief.power.channelOver")}
                      </div>
                    ) : warn ? (
                      <div style={{ color: "#b45309", fontSize: 12, fontWeight: 600 }}>
                        {d.imbalanceWarn && d.feederUtilization <= 0.8
                          ? "Phase imbalance > 20%"
                          : "Above 80% derate"}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </SectionCard>

      <SectionCard theme={theme} title={t("portal.brief.ledScreens")}>
        {brief.led.screens.length === 0 ? (
          <Empty theme={theme} text={t("portal.brief.noLed")} />
        ) : (
          <>
            <KvGrid
              theme={theme}
              items={[
                { k: "Screens", v: `${brief.led.screenCount}` },
                {
                  k: t("portal.brief.metric.totalPanels"),
                  v: `${brief.led.totalPanels}`,
                },
                {
                  k: "Processor",
                  v: brief.led.processor || "—",
                },
              ]}
            />
            <ul
              style={{
                margin: "12px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {brief.led.screens.map((s) => (
                <li
                  key={s.id}
                  style={{
                    padding: "10px 12px",
                    background: c.cardBgSubtle,
                    borderRadius: 10,
                    border: `1px solid ${c.border}`,
                    fontSize: 13,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{s.name}</div>
                    <div style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                      {s.panelType || "Panel"} · {s.cols} × {s.rows} ({s.totalPanels} panels)
                      {s.shape ? ` · ${s.shape}` : ""}
                      {s.disabledPanels && s.disabledPanels > 0
                        ? ` · −${s.disabledPanels} off`
                        : ""}
                    </div>
                    {(s.signalCables ?? 0) > 0 ||
                    (s.powerCables ?? 0) > 0 ? (
                      <div style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                        Cables:{" "}
                        {(s.signalCables ?? 0)}× signal (
                        {formatNumber(s.signalLengthM ?? 0, 2)} m){" · "}
                        {(s.powerCables ?? 0)}× TrueOne (
                        {formatNumber(s.powerLengthM ?? 0, 2)} m)
                      </div>
                    ) : null}
                    {s.brackets && s.brackets.length > 0 ? (
                      <div style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                        Brackets:{" "}
                        {s.brackets
                          .map((b) => `${b.name} × ${b.count}`)
                          .join(", ")}
                      </div>
                    ) : null}
                    {s.processors && s.processors.length > 0 ? (
                      <div style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                        Processors: {s.processors.join(" + ")}
                        {s.processorOutputs ? (
                          <>
                            {" — "}
                            {s.processorOutputs} outputs ·{" "}
                            {formatNumber(s.processorMaxPixels ?? 0)} px cap
                            {s.processorPixels ? (
                              <> vs {formatNumber(s.processorPixels)} px needed</>
                            ) : null}
                            {/* Producer-precomputed flag — combines the
                                pixel-cap test AND the per-output cap
                                test (see App.tsx). Falls back to the
                                pixels-only test for older briefs that
                                don't carry the flag yet. */}
                            {(s.processorUnderCapacity ??
                              (!!s.processorPixels &&
                                !!s.processorMaxPixels &&
                                s.processorPixels > s.processorMaxPixels)) ? (
                              <span
                                style={{
                                  marginLeft: 6,
                                  color: "#dc2626",
                                  fontWeight: 700,
                                }}
                              >
                                Under capacity
                              </span>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {s.estimatedWatts > 0 ? (
                    <div
                      style={{
                        color: c.muted,
                        fontSize: 12,
                        textAlign: "right",
                      }}
                    >
                      ~{watts(s.estimatedWatts)}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      <SectionCard theme={theme} title={t("portal.brief.stage")}>
        {brief.stage.stages.length === 0 ? (
          <Empty theme={theme} text={t("portal.brief.noStage")} />
        ) : (
          <>
            <KvGrid
              theme={theme}
              items={[
                { k: "Stages", v: `${brief.stage.stageCount}` },
                {
                  k: t("portal.brief.metric.totalArea"),
                  v: `${formatNumber(brief.stage.totalArea, 1)} m²`,
                },
                {
                  k: t("portal.brief.metric.totalLoadCapacity"),
                  v: `${formatNumber(brief.stage.totalLoadCapacityKg)} kg`,
                },
              ]}
            />
            <ul
              style={{
                margin: "12px 0 0",
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {brief.stage.stages.map((s) => (
                <li
                  key={s.id}
                  style={{
                    padding: "10px 12px",
                    background: c.cardBgSubtle,
                    borderRadius: 10,
                    border: `1px solid ${c.border}`,
                    fontSize: 13,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>
                        {s.width} × {s.depth} m at {s.legHeightCm} cm legs
                      </div>
                    </div>
                    <div style={{ color: c.muted, fontSize: 12, textAlign: "right" }}>
                      {formatNumber(s.area, 1)} m² · {formatNumber(s.loadCapacityKg)} kg
                    </div>
                  </div>
                  {s.bracingNotes.length > 0 ? (
                    <ul
                      style={{
                        margin: "8px 0 0 18px",
                        padding: 0,
                        color: c.danger,
                        fontSize: 12,
                      }}
                    >
                      {s.bracingNotes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionCard>

      <SectionCard theme={theme} title={t("portal.brief.sound")}>
        {brief.sound.rowCount === 0 ? (
          <Empty theme={theme} text={t("portal.brief.noSound")} />
        ) : (
          <>
            <KvGrid
              theme={theme}
              items={[
                { k: "Inventory rows", v: `${brief.sound.rowCount}` },
                {
                  k: t("portal.brief.metric.totalPieces"),
                  v: `${brief.sound.totalQty}`,
                },
                {
                  k: t("portal.brief.metric.totalWeight"),
                  v: `${formatNumber(brief.sound.totalWeight, 1)} kg`,
                },
                {
                  k: t("portal.brief.metric.totalPower"),
                  v: brief.sound.totalPower > 0 ? watts(brief.sound.totalPower) : "—",
                },
              ]}
            />
            {brief.sound.byCategory.length > 0 ? (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  marginTop: 12,
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ color: c.muted, textAlign: "left" }}>
                    <th style={{ padding: "6px 4px", fontWeight: 600 }}>{t("portal.brief.table.category")}</th>
                    <th style={{ padding: "6px 4px", fontWeight: 600, textAlign: "right" }}>{t("portal.brief.table.rows")}</th>
                    <th style={{ padding: "6px 4px", fontWeight: 600, textAlign: "right" }}>{t("portal.brief.table.weight")}</th>
                    <th style={{ padding: "6px 4px", fontWeight: 600, textAlign: "right" }}>{t("portal.brief.table.power")}</th>
                  </tr>
                </thead>
                <tbody>
                  {brief.sound.byCategory.map((cat) => (
                    <tr key={cat.category} style={{ borderTop: `1px solid ${c.border}` }}>
                      <td style={{ padding: "8px 4px" }}>{cat.category}</td>
                      <td style={{ padding: "8px 4px", textAlign: "right" }}>{cat.count}</td>
                      <td style={{ padding: "8px 4px", textAlign: "right" }}>
                        {formatNumber(cat.totalWeight, 1)} kg
                      </td>
                      <td style={{ padding: "8px 4px", textAlign: "right" }}>
                        {cat.totalPower > 0 ? watts(cat.totalPower) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        )}
      </SectionCard>

      {(() => {
        // Producer's uploaded drawing wins over the auto-generated
        // top-down map. We pick the first attachment that looks like a
        // venue drawing — any image or PDF whose filename is NOT one of
        // our auto-generated LED diagrams (those end in `_<W>x<H>.png`,
        // see lib/ledExport.ts). Falls back to the generated SVG when
        // no such attachment was uploaded.
        const drawing = brief.attachments.find((a) => {
          const ct = (a.contentType || "").toLowerCase();
          const isImage = ct.startsWith("image/");
          const isPdf = ct === "application/pdf" || /\.pdf$/i.test(a.name);
          if (!isImage && !isPdf) return false;
          if (/_\d+x\d+\.png$/i.test(a.name)) return false;
          return true;
        });
        if (drawing) {
          const url = attachmentDownloadUrl(drawing);
          const isPdf =
            (drawing.contentType || "").toLowerCase() === "application/pdf" ||
            /\.pdf$/i.test(drawing.name);
          return (
            <SectionCard theme={theme} title={t("portal.brief.riggPlan")}>
              {isPdf ? (
                <iframe
                  src={url}
                  title={drawing.name}
                  style={{
                    width: "100%",
                    height: "70vh",
                    minHeight: 480,
                    border: `1px solid ${c.border}`,
                    borderRadius: 8,
                    background: "#fff",
                  }}
                />
              ) : (
                <img
                  src={url}
                  alt={drawing.name}
                  style={{
                    display: "block",
                    width: "100%",
                    height: "auto",
                    borderRadius: 8,
                    border: `1px solid ${c.border}`,
                    background: "#fff",
                  }}
                />
              )}
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: c.muted,
                }}
              >
                Drawing from the producer ·{" "}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  download={drawing.name}
                  style={{ color: c.text, fontWeight: 600 }}
                >
                  Open original
                </a>
              </div>
            </SectionCard>
          );
        }
        return brief.riggPlan ? (
          <SectionCard theme={theme} title={t("portal.brief.riggPlan")}>
            <RiggPlanMap theme={theme} plan={brief.riggPlan} />
          </SectionCard>
        ) : null;
      })()}

      {brief.attachments.length > 0 ? (
        <SectionCard theme={theme} title={t("portal.brief.drawingsAttachments")}>
          <AttachmentsList theme={theme} attachments={brief.attachments} />
        </SectionCard>
      ) : null}
    </div>
  );
}

/** Render the per-brief attachment list. Each row is a download anchor
 *  pointing at the api-server's `/api/storage/objects/...` route, which
 *  streams the bytes back from object storage. The anchor uses the
 *  `download` attribute so the browser saves the file with the original
 *  filename instead of opening it inline. */
function AttachmentsList({
  theme,
  attachments,
}: {
  theme: ThemeMode;
  attachments: BriefAttachment[];
}) {
  const t = useT();
  const c = PALETTE[theme];
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {attachments.map((a) => (
        <li
          key={a.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "10px 12px",
            background: c.cardBg,
            border: `1px solid ${c.border}`,
            borderRadius: 10,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: c.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {a.name}
            </div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
              {describeAttachment(a)}
            </div>
          </div>
          <a
            href={attachmentDownloadUrl(a)}
            target="_blank"
            rel="noreferrer"
            download={a.name}
            style={{
              fontSize: 12,
              fontWeight: 700,
              padding: "8px 14px",
              border: "1px solid #f88000",
              borderRadius: 8,
              background: "#f88000",
              color: "#0b0b0b",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            Download
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Build the secondary line for an attachment row, e.g. "PDF · 1.4 MB". */
function describeAttachment(a: BriefAttachment): string {
  const parts: string[] = [];
  const subtype = a.contentType.split("/")[1] || a.contentType;
  parts.push(subtype.toUpperCase());
  if (a.sizeBytes > 0) parts.push(formatBytes(a.sizeBytes));
  return parts.join(" · ");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------------------------------------------------------------- pieces */

function AssignmentCard({
  theme,
  assignment,
  schedule,
  decision,
  declineReason,
  shiftResponses,
  acceptedGigId,
  conflicts,
  onSubmitShiftResponses,
  onLegacyAccept,
  onLegacyDecline,
  onLegacyReset,
  onOpenGig,
}: {
  theme: ThemeMode;
  assignment: BriefAssignment;
  schedule: BriefSchedule | undefined;
  decision: BriefDecision;
  declineReason: string | null;
  shiftResponses?: ShiftResponseMap;
  acceptedGigId?: string;
  conflicts: ScheduleConflict[];
  onSubmitShiftResponses: (
    responses: ShiftResponseMap,
    declineReason: string | null,
  ) => void;
  onLegacyAccept: () => void;
  onLegacyDecline: (declineReason: string | null) => void;
  onLegacyReset: () => void;
  onOpenGig: () => void;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const fee = assignment.dayRate;
  const dayBreakdown = useMemo(
    () => groupAssignedDaysByPhase(assignment.assignedDates, schedule, t),
    [assignment.assignedDates, schedule, t],
  );
  const shiftSlots = useMemo(() => {
    const phaseLabels: Record<string, string> = {
      setup: t("portal.brief.phase.setup"),
      rehearsal: t("portal.brief.phase.rehearsal"),
      show: t("portal.brief.phase.show"),
      downrig: t("portal.brief.phase.loadOut"),
    };
    const phaseKeys = Array.from(
      new Set([
        ...(assignment.assignedShiftPhases ?? []),
        ...Object.keys(assignment.assignedShiftWindows ?? {}),
        ...Object.keys(assignment.assignedShiftTimes ?? {}),
      ]),
    )
      .filter((key) =>
        /^\d{4}-\d{2}-\d{2}::(?:setup|rehearsal|show|downrig)$/.test(key),
      )
      .sort();
    const exact = phaseKeys.flatMap((key) => {
      const [dateKey, phaseKey] = key.split("::");
      const timings =
        assignment.assignedShiftWindows?.[key]?.length
          ? assignment.assignedShiftWindows[key]
          : assignment.assignedShiftTimes?.[key]
            ? [assignment.assignedShiftTimes[key]]
            : [];
      if (!dateKey || !phaseKey) return [];
      const effectiveTimings =
        timings.length > 0
          ? timings
          : [{ startTime: "", endTime: "" }];
      return effectiveTimings.map((timing, windowIndex) => ({
          key: `${key}::${windowIndex}`,
          dateKey,
          phaseLabel: phaseLabels[phaseKey] ?? phaseKey,
          callLabel:
            timings.length > 1
              ? t("portal.brief.assignment.callNumber", {
                  number: windowIndex + 1,
                })
              : t("portal.brief.assignment.shift"),
          timing:
            timing.startTime && timing.endTime
              ? `${timing.startTime}–${timing.endTime}`
              : t("portal.brief.assignment.timesToBeConfirmed"),
          tasks: assignment.assignedShiftTasks?.[key] ?? [],
        }));
    });
    if (exact.length > 0) return exact;
    return (assignment.assignedDates ?? []).map((dateKey) => ({
      key: `${dateKey}::day::0`,
      dateKey,
      phaseLabel: t("portal.brief.assignment.workingDay"),
      callLabel: t("portal.brief.assignment.shift"),
      timing:
        assignment.callTime && assignment.offTime
          ? `${assignment.callTime}–${assignment.offTime}`
          : t("portal.brief.assignment.timesToBeConfirmed"),
      tasks: [] as string[],
    }));
  }, [
    assignment.assignedDates,
    assignment.assignedShiftPhases,
    assignment.assignedShiftTasks,
    assignment.assignedShiftTimes,
    assignment.assignedShiftWindows,
    assignment.callTime,
    assignment.offTime,
    t,
  ]);
  const [draftResponses, setDraftResponses] = useState<ShiftResponseMap>({});
  const [draftDeclineReason, setDraftDeclineReason] = useState(
    declineReason ?? "",
  );
  useEffect(() => {
    const next: ShiftResponseMap = {};
    for (const slot of shiftSlots) {
      const saved = shiftResponses?.[slot.key];
      if (saved) next[slot.key] = saved;
      else if (decision === "accepted") next[slot.key] = "accepted";
      else if (decision === "declined") next[slot.key] = "declined";
    }
    setDraftResponses(next);
  }, [decision, shiftResponses, shiftSlots]);
  useEffect(() => {
    setDraftDeclineReason(declineReason ?? "");
  }, [declineReason]);
  const responseCount = Object.keys(draftResponses).length;
  const acceptedCount = Object.values(draftResponses).filter(
    (value) => value === "accepted",
  ).length;
  const declinedCount = Object.values(draftResponses).filter(
    (value) => value === "declined",
  ).length;
  const responseComplete =
    shiftSlots.length > 0 && responseCount === shiftSlots.length;
  const hasDeclinedShift = declinedCount > 0;
  return (
    <section
      style={{
        background: c.cardBg,
        border: `2px solid ${c.accent}`,
        borderRadius: 14,
        padding: 18,
        boxShadow: c.shadowSoft,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: c.accent,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        Your assignment
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 16,
          marginTop: 12,
        }}
      >
        <Field
          theme={theme}
          label={t("portal.brief.assignment.role")}
          value={assignment.role}
          strong
        />
        <Field
          theme={theme}
          label="Call time"
          value={assignment.callTime || "—"}
        />
        <Field
          theme={theme}
          label="Off time"
          value={assignment.offTime || "—"}
        />
        <Field
          theme={theme}
          label={t("portal.brief.assignment.hours")}
          value={assignment.hours > 0 ? `${formatNumber(assignment.hours, 1)} h` : "—"}
        />
        <Field
          theme={theme}
          label="Day rate"
          value={fee > 0 ? formatNok(fee) : "—"}
          strong
        />
        {(assignment.hotelDates?.length ?? 0) > 0 ? (
          <Field
            theme={theme}
            label="Hotel"
            value={`🏨 ${assignment.hotelDates.length} night${assignment.hotelDates.length === 1 ? "" : "s"}`}
            strong
          />
        ) : null}
      </div>
      {shiftSlots.length > 0 ? (
        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: `1px solid ${c.border}`,
          }}
        >
          <div
            style={{
              color: c.muted,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.7,
              textTransform: "uppercase",
            }}
          >
            Confirm each shift
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 8,
              marginTop: 8,
            }}
          >
            {shiftSlots.map((shift) => {
              const slotDecision = draftResponses[shift.key];
              const statusColor =
                slotDecision === "accepted"
                  ? c.success
                  : slotDecision === "declined"
                    ? "#dc2626"
                    : c.border;
              return (
              <div
                key={shift.key}
                style={{
                  border: `1px solid ${statusColor}`,
                  borderRadius: 9,
                  padding: "9px 10px",
                  background: c.cardBgSubtle,
                  fontSize: 12,
                  color: c.text,
                }}
              >
                <strong>{shift.dateKey}</strong>
                <div style={{ marginTop: 2, color: c.muted }}>
                  {shift.phaseLabel} · {shift.callLabel} · {shift.timing}
                </div>
                {shift.tasks.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
                    {shift.tasks.map((task) => (
                      <span
                        key={task}
                        style={{
                          borderRadius: 999,
                          padding: "3px 7px",
                          background: c.cardBg,
                          border: `1px solid ${c.border}`,
                          color: c.text,
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {task}
                      </span>
                    ))}
                  </div>
                ) : null}
                {decision !== "too_late" ? (
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      marginTop: 9,
                    }}
                  >
                    <button
                      type="button"
                      aria-pressed={slotDecision === "accepted"}
                      onClick={() =>
                        setDraftResponses((current) => ({
                          ...current,
                          [shift.key]: "accepted",
                        }))
                      }
                      style={{
                        flex: 1,
                        padding: "7px 9px",
                        borderRadius: 7,
                        border: `1px solid ${
                          slotDecision === "accepted" ? c.success : c.border
                        }`,
                        background:
                          slotDecision === "accepted"
                            ? c.success
                            : "transparent",
                        color:
                          slotDecision === "accepted" ? "#ffffff" : c.text,
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      aria-pressed={slotDecision === "declined"}
                      onClick={() =>
                        setDraftResponses((current) => ({
                          ...current,
                          [shift.key]: "declined",
                        }))
                      }
                      style={{
                        flex: 1,
                        padding: "7px 9px",
                        borderRadius: 7,
                        border: `1px solid ${
                          slotDecision === "declined" ? "#dc2626" : c.border
                        }`,
                        background:
                          slotDecision === "declined"
                            ? "#dc2626"
                            : "transparent",
                        color:
                          slotDecision === "declined" ? "#ffffff" : c.text,
                        fontSize: 12,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Decline
                    </button>
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {dayBreakdown.length > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: c.muted,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 8,
            }}
          >
            {t("portal.brief.assignment.workingDays")}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {dayBreakdown.map((bucket) => (
              <div
                key={bucket.key}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "8px 10px",
                  background: c.cardBgSubtle,
                  borderRadius: 10,
                  borderLeft: `3px solid ${
                    bucket.key === "extra" ? c.muted : c.accent
                  }`,
                }}
              >
                <div
                  style={{
                    minWidth: 110,
                    fontSize: 12,
                    fontWeight: 700,
                    color: bucket.key === "extra" ? c.muted : c.accent,
                  }}
                >
                  {bucket.label} ({bucket.days.length}{" "}
                  {bucket.days.length === 1 ? "day" : "days"})
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: c.text,
                    lineHeight: 1.5,
                  }}
                >
                  {bucket.days.map((d) => formatDayShort(d)).join(", ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {assignment.notes ? (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            background: c.cardBgSubtle,
            borderRadius: 10,
            fontSize: 13,
            color: c.text,
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: c.muted,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              marginBottom: 4,
            }}
          >
            Notes from production
          </div>
          {assignment.notes}
        </div>
      ) : null}

      {decision === "pending" && conflicts.length > 0 ? (
        <ConflictWarning theme={theme} conflicts={conflicts} />
      ) : null}

      <div
        style={{
          marginTop: 16,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {shiftSlots.length === 0 ? (
          decision === "pending" ? (
            <>
              <DeclineReasonField
                theme={theme}
                value={draftDeclineReason}
                onChange={setDraftDeclineReason}
              />
              <button
                type="button"
                onClick={onLegacyAccept}
                style={{
                  padding: "10px 18px",
                  fontSize: 14,
                  fontWeight: 800,
                  background: c.accent,
                  color: "#0b0b0b",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                {conflicts.length > 0
                  ? t("portal.brief.actions.acceptAnyway")
                  : t("portal.brief.actions.acceptGig")}
              </button>
              <button
                type="button"
                onClick={() => onLegacyDecline(draftDeclineReason.trim() || null)}
                style={{
                  padding: "10px 16px",
                  fontSize: 14,
                  fontWeight: 700,
                  background: "transparent",
                  color: c.text,
                  border: `1px solid ${c.border}`,
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Decline
              </button>
            </>
          ) : decision === "too_late" ? (
            <span style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>
              {t("portal.brief.actions.tooLate")}
            </span>
          ) : (
            <>
              <span style={{ fontSize: 13, fontWeight: 700, color: c.muted }}>
                {decision === "accepted"
                  ? t("portal.brief.decision.accepted")
                  : t("portal.brief.decision.declined")}
              </span>
              {decision === "accepted" && acceptedGigId ? (
                <button
                  type="button"
                  onClick={onOpenGig}
                  style={{
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    background: c.accent,
                    color: "#0b0b0b",
                    border: "none",
                    borderRadius: 8,
                    cursor: "pointer",
                  }}
                >
                  Open in logbook
                </button>
              ) : null}
              <button
                type="button"
                onClick={onLegacyReset}
                style={{
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  background: "transparent",
                  color: c.muted,
                  border: `1px solid ${c.border}`,
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Undo
              </button>
              {decision === "declined" && declineReason ? (
                <DeclineReasonNote theme={theme} reason={declineReason} />
              ) : null}
            </>
          )
        ) : decision === "too_late" ? (
          <span style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>
            {t("portal.brief.actions.tooLate")}
          </span>
        ) : (
          <>
            {responseComplete && (hasDeclinedShift || decision === "pending") ? (
              <DeclineReasonField
                theme={theme}
                value={draftDeclineReason}
                onChange={setDraftDeclineReason}
              />
            ) : null}
            <span style={{ fontSize: 13, fontWeight: 700, color: c.muted }}>
              {responseComplete
                ? `${acceptedCount} accepted · ${declinedCount} declined`
                : `Choose Accept or Decline for all ${shiftSlots.length} shifts`}
            </span>
            <button
              type="button"
              disabled={!responseComplete}
              onClick={() =>
                onSubmitShiftResponses(
                  draftResponses,
                  hasDeclinedShift ? draftDeclineReason.trim() || null : null,
                )
              }
              style={{
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 800,
                background: responseComplete ? c.accent : c.border,
                color: responseComplete ? "#0b0b0b" : c.muted,
                border: "none",
                borderRadius: 8,
                cursor: responseComplete ? "pointer" : "not-allowed",
              }}
            >
              Submit response
            </button>
            {decision === "accepted" && acceptedGigId ? (
              <button
                type="button"
                onClick={onOpenGig}
                style={{
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  background: "transparent",
                  color: c.text,
                  border: `1px solid ${c.border}`,
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Open in logbook
              </button>
            ) : null}
            {decision === "declined" && declineReason ? (
              <DeclineReasonNote theme={theme} reason={declineReason} />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function DeclineReasonField({
  theme,
  value,
  onChange,
}: {
  theme: ThemeMode;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const c = PALETTE[theme];
  return (
    <label
      style={{
        display: "grid",
        gap: 4,
        flex: "1 1 100%",
        color: c.muted,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {t("portal.brief.declineReasonLabel")}
      <textarea
        value={value}
        maxLength={1000}
        rows={2}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("portal.brief.declineReasonPlaceholder")}
        style={{
          width: "100%",
          boxSizing: "border-box",
          resize: "vertical",
          padding: "8px 10px",
          borderRadius: 8,
          border: `1px solid ${c.border}`,
          background: c.cardBgSubtle,
          color: c.text,
          font: "inherit",
          fontSize: 13,
          fontWeight: 400,
        }}
      />
    </label>
  );
}

function DeclineReasonNote({
  theme,
  reason,
}: {
  theme: ThemeMode;
  reason: string;
}) {
  const t = useT();
  return (
    <div
      style={{
        flex: "1 1 100%",
        color: theme === "dark" ? "#fecaca" : "#991b1b",
        background: theme === "dark" ? "rgba(220,38,38,.14)" : "#fef2f2",
        border: "1px solid rgba(220,38,38,.35)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <strong>{t("portal.brief.declineReasonLabel")}:</strong> {reason}
    </div>
  );
}

function GenericNoticeCard({
  theme,
  decision,
  declineReason,
  acceptedGigId,
  conflicts,
  onAccept,
  onDecline,
  onReset,
  onOpenGig,
}: {
  theme: ThemeMode;
  decision: BriefDecision;
  declineReason: string | null;
  acceptedGigId?: string;
  conflicts: ScheduleConflict[];
  onAccept: () => void;
  onDecline: (declineReason: string | null) => void;
  onReset: () => void;
  onOpenGig: () => void;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const [draftDeclineReason, setDraftDeclineReason] = useState(
    declineReason ?? "",
  );
  useEffect(() => {
    setDraftDeclineReason(declineReason ?? "");
  }, [declineReason]);
  return (
    <section
      style={{
        background: c.cardBgSubtle,
        border: `1px dashed ${c.border}`,
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 14, color: c.muted, lineHeight: 1.5 }}>
        This is a generic briefing — your producer didn't pre-fill an
        assignment for you. You can still accept it as a gig (it'll use the
        first crew row as a placeholder), or scroll down for the full project
        context.
      </div>
      {decision === "pending" && conflicts.length > 0 ? (
        <ConflictWarning theme={theme} conflicts={conflicts} />
      ) : null}
      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        {decision === "pending" ? (
          <>
            <DeclineReasonField
              theme={theme}
              value={draftDeclineReason}
              onChange={setDraftDeclineReason}
            />
            <button
              type="button"
              onClick={onAccept}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 700,
                background: c.accent,
                color: "#0b0b0b",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {conflicts.length > 0
                ? t("portal.brief.actions.addAnyway")
                : t("portal.brief.actions.addToLogbook")}
            </button>
            <button
              type="button"
              onClick={() => onDecline(draftDeclineReason.trim() || null)}
              style={{
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 600,
                background: "transparent",
                color: c.text,
                border: `1px solid ${c.border}`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </>
        ) : decision === "accepted" ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 700, color: c.success }}>
              ✓ Added to logbook
            </span>
            {acceptedGigId ? (
              <button
                type="button"
                onClick={onOpenGig}
                style={{
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 700,
                  background: c.accent,
                  color: "#0b0b0b",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Open in logbook
              </button>
            ) : null}
            <button
              type="button"
              onClick={onReset}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: "transparent",
                color: c.muted,
                border: `1px solid ${c.border}`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Undo
            </button>
          </>
        ) : decision === "declined" ? (
          <>
            <span style={{ fontSize: 13, fontWeight: 700, color: c.muted }}>
              Dismissed
            </span>
            <button
              type="button"
              onClick={onReset}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: "transparent",
                color: c.muted,
                border: `1px solid ${c.border}`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Undo
            </button>
            {declineReason ? (
              <DeclineReasonNote theme={theme} reason={declineReason} />
            ) : null}
          </>
        ) : (
          // too_late — see AssignmentCard for the matching message.
          <span style={{ fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>{t("portal.brief.actions.tooLate")}</span>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- top-of-page banners */

/** Surfaced when the server reports `tooLate: true` on an accept, or
 *  when a polled refresh shows the assignment has been swept to
 *  `too_late` because a sibling candidate accepted first. Big, red
 *  and explicit so the freelancer immediately understands why their
 *  Accept buttons disappeared. */
function TooLateBanner({ theme }: { theme: ThemeMode }) {
  const c = PALETTE[theme];
  return (
    <section
      role="status"
      aria-live="polite"
      style={{
        background:
          theme === "dark" ? "rgba(220, 38, 38, 0.18)" : "rgba(254, 226, 226, 0.7)",
        border: "1px solid rgba(220, 38, 38, 0.55)",
        borderRadius: 12,
        padding: "14px 16px",
        color: theme === "dark" ? "#fecaca" : "#7f1d1d",
        boxShadow: c.shadowSoft,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>
        This position has already been filled
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.45 }}>
        Another freelancer accepted before your tap reached the server.
        Thanks for stepping up — your producer can see you were first
        to respond after the winner.
      </div>
    </section>
  );
}

/** Inline failure surface for the /respond POST. Matches the visual
 *  vocabulary of the conflict warnings (amber border + small dismiss
 *  button) so the freelancer learns at a glance: "your tap didn't
 *  save, but the app still works — try again." */
function SyncErrorBanner({
  theme,
  message,
  onDismiss,
}: {
  theme: ThemeMode;
  message: string;
  onDismiss: () => void;
}) {
  const c = PALETTE[theme];
  return (
    <section
      role="alert"
      style={{
        background:
          theme === "dark" ? "rgba(180, 83, 9, 0.18)" : "rgba(254, 243, 199, 0.7)",
        border: "1px solid rgba(217, 119, 6, 0.55)",
        borderRadius: 12,
        padding: "12px 14px",
        color: theme === "dark" ? "#fde68a" : "#7c2d12",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "space-between",
      }}
    >
      <div style={{ fontSize: 13, lineHeight: 1.4 }}>{message}</div>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 700,
          background: "transparent",
          color: theme === "dark" ? "#fde68a" : "#7c2d12",
          border: `1px solid ${c.border}`,
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        Dismiss
      </button>
    </section>
  );
}

function CrewTable({
  theme,
  assignments,
  myCrewId,
}: {
  theme: ThemeMode;
  assignments: BriefAssignment[];
  myCrewId: string | null;
}) {
  const c = PALETTE[theme];
  const t = useT();
  if (assignments.length === 0) {
    return <Empty theme={theme} text={t("portal.brief.crew.empty")} />;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ color: c.muted, textAlign: "left" }}>
          <th style={{ padding: "6px 4px", fontWeight: 600 }}>{t("portal.brief.crew.name")}</th>
          <th style={{ padding: "6px 4px", fontWeight: 600 }}>{t("portal.brief.crew.role")}</th>
          <th
            style={{
              padding: "6px 4px",
              fontWeight: 600,
              textAlign: "right",
            }}
          >
            {t("portal.brief.crew.callToOff")}
          </th>
        </tr>
      </thead>
      <tbody>
        {assignments.map((a) => {
          const me = a.crewId === myCrewId;
          return (
            <tr
              key={a.crewId}
              style={{
                borderTop: `1px solid ${c.border}`,
                background: me ? "rgba(248,128,0,0.08)" : "transparent",
              }}
            >
              <td style={{ padding: "8px 4px", fontWeight: me ? 800 : 600 }}>
                {a.name || "(unnamed)"}
                {me ? (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: 10,
                      fontWeight: 800,
                      color: c.accent,
                    }}
                  >
                    YOU
                  </span>
                ) : null}
              </td>
              <td style={{ padding: "8px 4px" }}>{a.role}</td>
              <td style={{ padding: "8px 4px", textAlign: "right", color: c.muted }}>
                {a.callTime || "—"} → {a.offTime || "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RiggPlanMap({
  theme,
  plan,
}: {
  theme: ThemeMode;
  plan: BriefRiggPlan;
}) {
  const c = PALETTE[theme];
  const t = useT();
  // SVG viewport sized to keep ~1m = up to 24px, capped at 720px wide.
  const padding = 0.5;
  const venueW = plan.venue.widthM;
  const venueD = plan.venue.depthM;
  const maxPx = 720;
  const scale = Math.min(maxPx / Math.max(venueW + padding * 2, 0.5), 24);
  const svgW = (venueW + padding * 2) * scale;
  const svgH = (venueD + padding * 2) * scale;
  return (
    <div>
      <KvGrid
        theme={theme}
        items={[
          { k: "Venue", v: `${venueW} × ${venueD} m` },
          { k: "Ceiling", v: `${plan.venue.ceilingM} m` },
          { k: "Trusses", v: `${plan.trusses.length}` },
        ]}
      />
      <div
        style={{
          marginTop: 12,
          padding: 8,
          background: c.cardBgSubtle,
          borderRadius: 10,
          border: `1px solid ${c.border}`,
          overflowX: "auto",
        }}
      >
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          role="img"
          aria-label={t("portal.brief.riggPlanAria")}
          style={{ display: "block", maxWidth: "100%", height: "auto" }}
        >
          {/* venue rectangle */}
          <rect
            x={padding * scale}
            y={padding * scale}
            width={venueW * scale}
            height={venueD * scale}
            fill={theme === "dark" ? "#0b1424" : "#ffffff"}
            stroke={c.border}
            strokeWidth={1}
          />
          {/* downstage label */}
          <text
            x={(padding + venueW / 2) * scale}
            y={padding * scale - 4}
            textAnchor="middle"
            fontSize={10}
            fill={c.muted}
          >
            audience ↓
          </text>
          {/* trusses */}
          {plan.trusses.map((t) => {
            const x1 = (padding + t.x1) * scale;
            const y1 = (padding + t.y1) * scale;
            const x2 = (padding + t.x2) * scale;
            const y2 = (padding + t.y2) * scale;
            const cx = (padding + t.x) * scale;
            const cy = (padding + t.y) * scale;
            return (
              <g key={t.systemId}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={c.accent}
                  strokeWidth={4}
                  strokeLinecap="round"
                />
                <circle cx={cx} cy={cy} r={3} fill={c.accent} />
                <text
                  x={cx + 6}
                  y={cy - 6}
                  fontSize={10}
                  fill={c.text}
                  fontWeight={700}
                >
                  {t.systemName}
                </text>
                <text x={cx + 6} y={cy + 6} fontSize={9} fill={c.muted}>
                  z {t.z} m · {t.lengthM} m
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function ScheduleList({
  theme,
  schedule,
}: {
  theme: ThemeMode;
  schedule: BriefSchedule;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const blocks = PHASE_ORDER.flatMap((key) => {
    const segs = schedule[key];
    if (!segs || segs.length === 0) return [];
    return [{ key, label: t(PHASE_LABEL_KEYS[key]), segments: segs }];
  });
  if (blocks.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {blocks.map((block) => {
        const multi = block.segments.length > 1;
        return (
          <div
            key={block.key}
            style={{
              display: "grid",
              gridTemplateColumns: "100px 1fr",
              alignItems: "start",
              gap: 12,
              padding: "8px 10px",
              border: `1px solid ${c.border}`,
              borderRadius: 8,
            }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                color: c.muted,
                paddingTop: 2,
              }}
            >
              {block.label}
            </span>
            <div style={{ display: "grid", gap: 4 }}>
              {block.segments.map((seg, idx) => {
                const timeRange = seg.timeTbd
                  ? "TBD"
                  : formatTimeRange(seg.fromTime, seg.toTime);
                const dateRange =
                  seg.from || seg.to ? formatRange(seg.from, seg.to) : "";
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {multi ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                          color: c.muted,
                          opacity: 0.85,
                          minWidth: 44,
                        }}
                      >
                        Day {idx + 1}
                      </span>
                    ) : null}
                    <span
                      style={{ color: c.text, fontSize: 14, fontWeight: 600 }}
                    >
                      {dateRange || "—"}
                      {timeRange ? (
                        <span
                          style={{
                            marginLeft: 10,
                            fontSize: 13,
                            fontWeight: 600,
                            color: c.muted,
                          }}
                        >
                          {timeRange}
                        </span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UpdateBanner({
  theme,
  diffs,
  onAcknowledge,
}: {
  theme: ThemeMode;
  diffs: DiffEntry[];
  onAcknowledge: () => void;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const renderDiffValue = (value: DiffEntry["before"]) =>
    value.kind === "message" ? t(value.key, value.params) : value.text;
  const renderDiffLabel = (diff: DiffEntry) => {
    const params = diff.labelParams;
    const phase =
      params && typeof params.phaseKey === "string"
        ? t(params.phaseKey as Parameters<typeof t>[0])
        : "";
    return t(diff.labelKey, { ...params, phase });
  };
  const visible = diffs.slice(0, 6);
  const extra = diffs.length - visible.length;
  return (
    <section
      role="alert"
      style={{
        background: "rgba(248,128,0,0.08)",
        border: `1px solid ${c.accent}`,
        borderLeft: `4px solid ${c.accent}`,
        borderRadius: 12,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 14, color: c.text }}>
          {t("portal.brief.diff.updatedTitle")}
        </strong>
        <span style={{ fontSize: 12, color: c.muted }}>
          {t("portal.brief.diff.updatedSubtitle")}
        </span>
      </div>
      <ul
        style={{
          margin: "10px 0 0",
          padding: 0,
          listStyle: "none",
          display: "grid",
          gap: 6,
        }}
      >
        {visible.map((d) => (
          <li
            key={d.key}
            style={{
              fontSize: 13,
              lineHeight: 1.45,
              color: c.text,
            }}
          >
            <strong style={{ color: c.text }}>{renderDiffLabel(d)}:</strong>{" "}
            <span style={{ color: c.muted, textDecoration: "line-through" }}>
              {renderDiffValue(d.before)}
            </span>{" "}
            <span style={{ color: c.text, fontWeight: 700 }}>
              → {renderDiffValue(d.after)}
            </span>
          </li>
        ))}
        {extra > 0 ? (
          <li style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
            {t(
              extra === 1
                ? "portal.brief.diff.moreChangeOne"
                : "portal.brief.diff.moreChangeMany",
              { count: extra },
            )}
          </li>
        ) : null}
      </ul>
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={onAcknowledge}
          style={{
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 700,
            background: c.accent,
            color: "#0b0b0b",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          {t("portal.brief.actions.diffAcknowledge")}
        </button>
      </div>
    </section>
  );
}

function BriefActionRow({
  theme,
  onAddToCalendar,
  onOpenCallSheet,
}: {
  theme: ThemeMode;
  onAddToCalendar: () => void;
  onOpenCallSheet: () => void;
}) {
  const c = PALETTE[theme];
  const btnStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 160,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 700,
    background: c.cardBg,
    color: c.text,
    border: `1px solid ${c.border}`,
    borderRadius: 10,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" onClick={onAddToCalendar} style={btnStyle}>
        <span aria-hidden>📅</span> Add to calendar
      </button>
      <button type="button" onClick={onOpenCallSheet} style={btnStyle}>
        <span aria-hidden>📄</span> Call sheet PDF
      </button>
    </div>
  );
}

function ConflictWarning({
  theme,
  conflicts,
}: {
  theme: ThemeMode;
  conflicts: ScheduleConflict[];
}) {
  const c = PALETTE[theme];
  // Group by date so the freelancer sees one row per conflicting day,
  // even if multiple sources clash on the same date.
  const grouped = new Map<string, ScheduleConflict[]>();
  for (const conflict of conflicts) {
    const list = grouped.get(conflict.date) ?? [];
    list.push(conflict);
    grouped.set(conflict.date, list);
  }
  const rows = Array.from(grouped.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <div
      role="alert"
      style={{
        marginTop: 14,
        background: "rgba(220,38,38,0.08)",
        border: `1px solid ${c.danger}`,
        borderLeft: `4px solid ${c.danger}`,
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 800,
          color: c.danger,
          marginBottom: 6,
        }}
      >
        ⚠ Schedule conflict on {rows.length} day{rows.length === 1 ? "" : "s"}
      </div>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "grid",
          gap: 5,
        }}
      >
        {rows.map(([date, items]) => (
          <li
            key={date}
            style={{ fontSize: 12.5, color: c.text, lineHeight: 1.45 }}
          >
            <strong>{formatDate(date)}</strong>
            {" — "}
            <span style={{ color: c.muted }}>
              {items[0].phaseLabel}
              {": "}
            </span>
            {items.map((it) => it.detail).join("; ")}
          </li>
        ))}
      </ul>
      <div
        style={{
          marginTop: 8,
          fontSize: 11.5,
          color: c.muted,
          fontStyle: "italic",
        }}
      >
        You can still accept — but double-check before you commit.
      </div>
    </div>
  );
}

function SectionCard({
  theme,
  title,
  children,
}: {
  theme: ThemeMode;
  title: string;
  children: React.ReactNode;
}) {
  const c = PALETTE[theme];
  return (
    <section
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: 14,
        padding: 16,
        boxShadow: c.shadowSoft,
      }}
    >
      <h2
        style={{
          margin: 0,
          marginBottom: 12,
          fontSize: 14,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: c.muted,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function KvGrid({
  theme,
  items,
}: {
  theme: ThemeMode;
  items: { k: string; v: string }[];
}) {
  const c = PALETTE[theme];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((it) => (
        <div key={it.k}>
          <div style={{ fontSize: 11, color: c.muted, fontWeight: 600 }}>
            {it.k}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>
            {it.v}
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({
  theme,
  label,
  value,
  strong,
}: {
  theme: ThemeMode;
  label: string;
  value: string;
  strong?: boolean;
}) {
  const c = PALETTE[theme];
  return (
    <div>
      <div style={{ fontSize: 11, color: c.muted, fontWeight: 600 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: strong ? 18 : 15,
          fontWeight: strong ? 800 : 600,
          lineHeight: 1.2,
          color: strong ? c.accent : c.text,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Empty({ theme, text }: { theme: ThemeMode; text: string }) {
  const c = PALETTE[theme];
  return (
    <div style={{ fontSize: 13, color: c.muted, padding: "4px 0" }}>{text}</div>
  );
}
