import { useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { PALETTE, type ThemeMode } from "../lib/portalTheme";
import {
  findBrief,
  gigEarnings,
  newGigId,
  statusColor,
  statusLabelT,
  type Gig,
  type GigCheckIn,
  type GigStatus,
  type PortalData,
} from "../lib/portalStorage";
import { useI18n, useT } from "../../lib/i18n/I18nContext";
import { downloadBriefIcs } from "../../lib/icalExport";
import { buildGoogleCalendarUrl } from "../../lib/googleCalendar";
import type { ProjectBrief } from "../../lib/projectBrief";

type T = ReturnType<typeof useT>;

/** Synthesize a tiny ProjectBrief from a manually-logged Gig so the
 *  shared iCal exporter can emit a single all-day VEVENT. Used when
 *  the gig has no `briefId` link to a producer-shared brief. */
function synthesizeBriefFromGig(gig: Gig): ProjectBrief {
  return {
    version: 1,
    generatedAt: gig.createdAt,
    briefId: gig.id,
    recipientCrewId: null,
    project: {
      venue: gig.venue || gig.projectName,
      client: gig.client,
      date: gig.startDate,
      endDate: gig.endDate || gig.startDate,
      // Manual Gigs (not created from a producer brief) don't track a
      // separate project manager — leave it blank rather than copying
      // the client name into both fields.
      preparedBy: "",
    },
    assignments: [],
    rigging: { systemCount: 0, hoistCount: 0, totalMotorW: 0, systems: [] },
    lighting: {
      fixtureCount: 0,
      totalFixtureWatts: 0,
      universes: [],
      circuitCount: 0,
      totalCircuitW: 0,
      worstCircuitPct: 0,
      distros: [],
      distroCount: 0,
      totalDistroW: 0,
      worstDistroFeederPct: 0,
    },
    led: { screenCount: 0, totalPanels: 0, processor: "", screens: [] },
    stage: {
      stageCount: 0,
      totalArea: 0,
      totalLoadCapacityKg: 0,
      stages: [],
    },
    sound: {
      rowCount: 0,
      totalQty: 0,
      totalWeight: 0,
      totalPower: 0,
      byCategory: [],
    },
    riggPlan: null,
    attachments: [],
  };
}

function localDateTime(date: string, time = "00:00"): Date {
  return new Date(`${date}T${time}:00`);
}

function addLocalDay(date: string): Date {
  const value = localDateTime(date);
  value.setDate(value.getDate() + 1);
  return value;
}

function googleCalendarWindow(gig: Gig, brief?: ProjectBrief): {
  start: Date;
  end: Date;
} {
  const segments = brief?.project.schedule
    ? Object.values(brief.project.schedule).flatMap((phase) => phase ?? [])
    : [];
  const validSegments = segments.filter((segment) => segment.from || segment.to);

  if (validSegments.length === 0) {
    return {
      start: localDateTime(gig.startDate),
      end: addLocalDay(gig.endDate || gig.startDate),
    };
  }

  const starts = validSegments.map((segment) =>
    localDateTime(segment.from || segment.to, segment.fromTime || "00:00"),
  );
  const ends = validSegments.map((segment) =>
    segment.toTime || segment.fromTime
      ? localDateTime(
          segment.to || segment.from,
          segment.toTime || segment.fromTime || "00:00",
        )
      : addLocalDay(segment.to || segment.from),
  );
  const start = new Date(Math.min(...starts.map((value) => value.getTime())));
  let end = new Date(Math.max(...ends.map((value) => value.getTime())));
  if (end <= start) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  return { start, end };
}

const STATUS_ORDER: GigStatus[] = [
  "invited",
  "confirmed",
  "done",
  "invoiced",
  "paid",
];

function emptyGig(): Gig {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: newGigId(),
    projectName: "",
    client: "",
    venue: "",
    role: "",
    startDate: today,
    endDate: today,
    hours: 0,
    rate: 0,
    flatFee: 0,
    notes: "",
    status: "confirmed",
    createdAt: Date.now(),
    // Manually-logged gigs default to no per-day breakdown — the date
    // row falls back to start..end. Producer-shared briefs always have
    // a server-computed list (see `gigFieldsFromBrief`).
    assignedDates: [],
  };
}

function formatDayShort(iso: string, locale?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

/** Add one day to a YYYY-MM-DD using UTC (timezone-stable). Used by
 *  `summariseAssignedDates` to detect contiguous runs. */
function addIsoDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Render a sorted YYYY-MM-DD list as a compact human-readable run.
 *  e.g. ["2025-03-10","2025-03-12","2025-03-14","2025-03-15","2025-03-16"]
 *       → "Mar 10, 12, 14–16"
 *  Spans crossing months render as "Mar 30 – Apr 2". Years are dropped
 *  inside the run because the gig card already shows the date row;
 *  this string is the *secondary* breakdown next to it. */
function summariseAssignedDates(dates: string[], locale?: string): string {
  if (dates.length === 0) return "";
  // Group into contiguous runs.
  type Run = { from: string; to: string };
  const runs: Run[] = [];
  for (const iso of dates) {
    const last = runs[runs.length - 1];
    if (last && addIsoDay(last.to) === iso) {
      last.to = iso;
    } else {
      runs.push({ from: iso, to: iso });
    }
  }
  // Render. We collapse same-month runs as "Mar 14–16" but spell out
  // both months when a run spans two ("Mar 30 – Apr 2"). Single days
  // render as "Mar 10". Within a same-month sequence of runs we drop
  // the leading month after the first ("Mar 10, 12, 14–16").
  const dateLocale = locale === "no" ? "nb-NO" : "en-GB";
  const monthShort = (iso: string): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString(dateLocale, { month: "short", timeZone: "UTC" });
  };
  const day = (iso: string): string => iso.slice(8, 10).replace(/^0/, "");
  const parts: string[] = [];
  let lastMonth = "";
  for (const run of runs) {
    const fromMonth = monthShort(run.from);
    const toMonth = monthShort(run.to);
    if (run.from === run.to) {
      const piece =
        fromMonth === lastMonth ? day(run.from) : `${fromMonth} ${day(run.from)}`;
      parts.push(piece);
      lastMonth = fromMonth;
    } else if (fromMonth === toMonth) {
      const piece =
        fromMonth === lastMonth
          ? `${day(run.from)}–${day(run.to)}`
          : `${fromMonth} ${day(run.from)}–${day(run.to)}`;
      parts.push(piece);
      lastMonth = fromMonth;
    } else {
      parts.push(
        `${fromMonth} ${day(run.from)} – ${toMonth} ${day(run.to)}`,
      );
      lastMonth = toMonth;
    }
  }
  return parts.join(", ");
}

function formatNok(n: number): string {
  return new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

export function Gigs({
  theme,
  data,
  setData,
}: {
  theme: ThemeMode;
  data: PortalData;
  setData: React.Dispatch<React.SetStateAction<PortalData>>;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const { locale } = useI18n();
  const { isSignedIn, getToken } = useAuth();
  const [editing, setEditing] = useState<Gig | null>(null);
  const [filter, setFilter] = useState<GigStatus | "all">("all");
  // Surfaces a banner when a server sync fails. Cleared on the next
  // successful sync. We deliberately leave the *local* edit applied
  // even after rollback wouldn't be possible — the freelancer can
  // always retry by re-doing the edit, and we don't want to lose
  // their typing. (Status / check-in / delete *do* roll back, since
  // those are single-shot toggles where the previous value is
  // unambiguous.)
  const [syncError, setSyncError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const items =
      filter === "all"
        ? data.gigs
        : data.gigs.filter((g) => g.status === filter);
    return [...items].sort((a, b) =>
      b.startDate.localeCompare(a.startDate),
    );
  }, [data.gigs, filter]);

  /** Resolve the API base path — same shape as Portal.tsx and
   *  BriefDetail.tsx use. Pulled out so each sync helper doesn't
   *  duplicate the conditional. */
  const apiBaseUrl = (): string =>
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    "/";

  type SyncResult =
    | { ok: true }
    | { ok: false; status?: number; error: string };

  /** POST `/api/portal/gigs` — full upsert for create / edit-modal
   *  saves. Server already enforces ownership when the client
   *  supplies an id, so we don't need to gate by `isSignedIn`
   *  beyond the Authorization header. Soft-success on 404: not
   *  expected for a POST, but we treat any non-network failure as
   *  retryable. */
  async function syncSaveGig(gig: Gig): Promise<SyncResult> {
    if (!isSignedIn) return { ok: true };
    try {
      const token = await getToken();
      const res = await fetch(`${apiBaseUrl()}api/portal/gigs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id: gig.id,
          projectName: gig.projectName,
          client: gig.client,
          venue: gig.venue,
          role: gig.role,
          startDate: gig.startDate,
          endDate: gig.endDate,
          hours: gig.hours,
          rate: gig.rate,
          flatFee: gig.flatFee,
          notes: gig.notes,
          status: gig.status,
          briefId: gig.briefId ?? null,
          checkIn: gig.checkIn ?? null,
          assignedDates: gig.assignedDates,
        }),
      });
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: `Server returned ${res.status}`,
        };
      }
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : t("portal.gigs.err.network"),
      };
    }
  }

  /** PATCH `/api/portal/gigs/:id` — partial update for the show-day
   *  check-in toggle and the status-advance button. */
  async function syncPatchGig(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<SyncResult> {
    if (!isSignedIn) return { ok: true };
    try {
      const token = await getToken();
      const res = await fetch(`${apiBaseUrl()}api/portal/gigs/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(patch),
      });
      // 404 means this gig has no server row (legacy local-only gig
      // from a pre-sync session). That's fine — local-only is still
      // a valid state; the next time the freelancer saves the gig
      // via the edit modal it'll be POSTed and acquire a server row.
      if (res.status === 404) return { ok: true };
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: `Server returned ${res.status}`,
        };
      }
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : t("portal.gigs.err.network"),
      };
    }
  }

  /** DELETE `/api/portal/gigs/:id`. Same 404-as-soft-success logic
   *  as the PATCH path above, for the same reason. */
  async function syncDeleteGig(id: string): Promise<SyncResult> {
    if (!isSignedIn) return { ok: true };
    try {
      const token = await getToken();
      const res = await fetch(`${apiBaseUrl()}api/portal/gigs/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 404) return { ok: true };
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: `Server returned ${res.status}`,
        };
      }
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : t("portal.gigs.err.network"),
      };
    }
  }

  async function saveGig(g: Gig) {
    // Optimistic apply: the edit modal closes immediately and the
    // freelancer sees their changes reflected in the list. We don't
    // attempt a rollback on sync failure for full edits — the user
    // would lose their typing — but we surface the error banner so
    // they can retry by editing again. `lastEditedAt` opens the
    // freshness window so the next poll won't clobber the edit
    // before the POST lands.
    const stamped: Gig = { ...g, lastEditedAt: Date.now() };
    setData((prev) => {
      const exists = prev.gigs.some((x) => x.id === stamped.id);
      const gigs = exists
        ? prev.gigs.map((x) => (x.id === stamped.id ? stamped : x))
        : [...prev.gigs, stamped];
      return { ...prev, gigs };
    });
    setEditing(null);
    setSyncError(null);
    const result = await syncSaveGig(stamped);
    if (!result.ok) {
      setSyncError(t("portal.gigs.err.save"));
    }
  }

  async function deleteGig(id: string) {
    // Capture the row up-front so we can restore on sync failure.
    const removed = data.gigs.find((x) => x.id === id) ?? null;
    if (!removed) return;
    // Brief-linked gigs are owned by an accepted assignment row on
    // the server. Plain DELETE on the gig leaves the assignment
    // pointing at a missing row (`accepted_gig_id` dangles) and the
    // producer-side progress view breaks. The product-correct path
    // is to decline the brief from BriefDetail, which the server
    // handles transactionally. Block the action here and explain.
    if (removed.briefId) {
      setSyncError(
        t("portal.gigs.err.briefLinkedDelete"),
      );
      return;
    }
    const deletedAt = Date.now();
    setData((prev) => ({
      ...prev,
      gigs: prev.gigs.filter((g) => g.id !== id),
      recentlyDeletedGigIds: {
        ...(prev.recentlyDeletedGigIds ?? {}),
        [id]: deletedAt,
      },
    }));
    setEditing(null);
    setSyncError(null);
    const result = await syncDeleteGig(id);
    if (!result.ok) {
      // Restore the row and clear the tombstone so a poll doesn't
      // also suppress the resurrected copy.
      setData((prev) => {
        const tombstones = { ...(prev.recentlyDeletedGigIds ?? {}) };
        delete tombstones[id];
        const next: PortalData = {
          ...prev,
          gigs: [removed, ...prev.gigs],
        };
        if (Object.keys(tombstones).length === 0) {
          delete next.recentlyDeletedGigIds;
        } else {
          next.recentlyDeletedGigIds = tombstones;
        }
        return next;
      });
      setSyncError(
        t("portal.gigs.err.delete"),
      );
    }
  }

  async function advanceStatus(g: Gig) {
    const i = STATUS_ORDER.indexOf(g.status);
    const next = STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
    const prevStatus = g.status;
    setData((prev) => ({
      ...prev,
      gigs: prev.gigs.map((x) =>
        x.id === g.id
          ? { ...x, status: next, lastEditedAt: Date.now() }
          : x,
      ),
    }));
    setSyncError(null);
    const result = await syncPatchGig(g.id, { status: next });
    if (!result.ok) {
      // Only roll back if the user (or another sync) hasn't already
      // moved off the optimistic value — otherwise we'd be reverting
      // a status they explicitly changed again, which would feel
      // ghostly. Captured by inspecting the latest state via the
      // setData updater.
      setData((prev) => {
        const current = prev.gigs.find((x) => x.id === g.id);
        if (!current || current.status !== next) return prev;
        return {
          ...prev,
          gigs: prev.gigs.map((x) =>
            x.id === g.id ? { ...x, status: prevStatus } : x,
          ),
        };
      });
      setSyncError(
        t("portal.gigs.err.status"),
      );
    }
  }

  async function setCheckIn(
    g: Gig,
    field: "onTheWayAt" | "arrivedAt",
    value: number | undefined,
  ) {
    const prevCheckIn = g.checkIn;
    // Compute the next checkIn deterministically *before* setData so
    // the PATCH call below isn't reading a value mutated by a setter
    // that may run twice in StrictMode.
    const nextCheckInRaw = { ...(prevCheckIn ?? {}), [field]: value };
    const nextCheckIn: GigCheckIn | undefined =
      nextCheckInRaw.onTheWayAt === undefined &&
      nextCheckInRaw.arrivedAt === undefined
        ? undefined
        : nextCheckInRaw;
    setData((prev) => ({
      ...prev,
      gigs: prev.gigs.map((x) =>
        x.id === g.id
          ? { ...x, checkIn: nextCheckIn, lastEditedAt: Date.now() }
          : x,
      ),
    }));
    setSyncError(null);
    const result = await syncPatchGig(g.id, {
      checkIn: nextCheckIn ?? null,
    });
    if (!result.ok) {
      setData((prev) => {
        const current = prev.gigs.find((x) => x.id === g.id);
        // Same guard as advanceStatus: only roll back if the
        // optimistic value is still in place.
        if (
          !current ||
          current.checkIn?.onTheWayAt !== nextCheckIn?.onTheWayAt ||
          current.checkIn?.arrivedAt !== nextCheckIn?.arrivedAt
        ) {
          return prev;
        }
        return {
          ...prev,
          gigs: prev.gigs.map((x) =>
            x.id === g.id ? { ...x, checkIn: prevCheckIn } : x,
          ),
        };
      });
      setSyncError(
        t("portal.gigs.err.checkin"),
      );
    }
  }

  function exportGigToCalendar(g: Gig) {
    // Prefer the rich, schedule-aware brief if the gig was created from
    // one — that gives per-phase events. Otherwise fall back to a small
    // synthesized brief that emits a single all-day event.
    const linkedBrief = g.briefId
      ? findBrief(data, g.briefId)?.brief
      : undefined;
    downloadBriefIcs(linkedBrief ?? synthesizeBriefFromGig(g));
  }

  function googleCalendarUrl(g: Gig): string {
    const linkedBrief = g.briefId
      ? findBrief(data, g.briefId)?.brief
      : undefined;
    const { start, end } = googleCalendarWindow(g, linkedBrief);
    const assignmentNotes = linkedBrief?.assignments.find(
      (assignment) => assignment.crewId === linkedBrief.recipientCrewId,
    )?.notes;
    const details = [
      g.client ? `${t("portal.gigs.googleClient")}: ${g.client}` : "",
      g.role ? `${t("portal.gigs.googleRole")}: ${g.role}` : "",
      g.notes || assignmentNotes
        ? `${t("portal.gigs.googleNotes")}: ${g.notes || assignmentNotes}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return buildGoogleCalendarUrl(
      {
        title: g.projectName || g.venue || t("portal.gigs.fallbackTitle"),
        start,
        end,
        details,
        location: g.venue,
      },
      t("portal.gigs.googleCalendarInvalidDates"),
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, flex: 1 }}>
          {t("portal.gigs.title")}
        </h1>
        <button
          type="button"
          onClick={() => setEditing(emptyGig())}
          style={{
            padding: "10px 16px",
            fontSize: 14,
            fontWeight: 700,
            background: c.accent,
            color: "#0b0b0b",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
          }}
        >
          {t("portal.gigs.logGig")}
        </button>
      </header>

      {syncError && (
        <div
          role="alert"
          style={{
            background: "#fef3c7",
            color: "#78350f",
            border: "1px solid #f59e0b",
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          <span style={{ flex: 1 }}>{syncError}</span>
          <button
            type="button"
            onClick={() => setSyncError(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "#78350f",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 700,
              padding: 0,
              lineHeight: 1,
            }}
            aria-label={t("portal.common.dismiss")}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["all", ...STATUS_ORDER] as const).map((s) => {
          const active = filter === s;
          const count =
            s === "all"
              ? data.gigs.length
              : data.gigs.filter((g) => g.status === s).length;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                borderRadius: 999,
                cursor: "pointer",
                background: active ? c.accent : c.cardBg,
                color: active ? "#0b0b0b" : c.text,
                border: `1px solid ${active ? c.accent : c.border}`,
              }}
            >
              {s === "all" ? t("portal.status.all") : statusLabelT(s, t)} · {count}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div
          style={{
            background: c.cardBg,
            border: `1px dashed ${c.border}`,
            borderRadius: 14,
            padding: "32px 16px",
            textAlign: "center",
            color: c.muted,
            fontSize: 14,
          }}
        >
          {data.gigs.length === 0 ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, color: c.text, marginBottom: 6 }}>
                {t("portal.gigs.empty.title")}
              </div>
              {t("portal.gigs.empty.tapLine")}
              <br />
              {t("portal.gigs.empty.flowLine")}
            </>
          ) : (
            t("portal.gigs.noMatch")
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visible.map((g) => {
            const sc = statusColor(g.status);
            const showCheckIn = g.status === "confirmed" || g.status === "done";
            return (
              <div
                key={g.id}
                style={{
                  background: c.cardBg,
                  border: `1px solid ${c.border}`,
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <strong style={{ fontSize: 15 }}>{g.projectName}</strong>
                      {g.client ? (
                        <span style={{ fontSize: 12, color: c.muted }}>
                          · {g.client}
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{ fontSize: 13, color: c.muted, marginBottom: 6 }}
                    >
                      {g.role || "—"} · {formatDayShort(g.startDate, locale)}
                      {g.endDate && g.endDate !== g.startDate
                        ? ` → ${formatDayShort(g.endDate, locale)}`
                        : ""}
                      {g.venue ? ` · ${g.venue}` : ""}
                    </div>
                    {g.assignedDates.length > 0 ? (
                      <div
                        title={g.assignedDates.join(", ")}
                        style={{
                          fontSize: 12,
                          color: c.muted,
                          marginBottom: 6,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "rgba(248,128,0,0.10)",
                            color: c.text,
                            fontWeight: 600,
                          }}
                        >
                          {g.assignedDates.length}{" "}
                          {g.assignedDates.length === 1
                            ? t("portal.gigs.workingDay")
                            : t("portal.gigs.workingDays")}
                        </span>
                        <span>{summariseAssignedDates(g.assignedDates, locale)}</span>
                      </div>
                    ) : null}
                    <div style={{ fontSize: 13, color: c.text }}>
                      <strong>{formatNok(gigEarnings(g))}</strong>
                      <span style={{ color: c.muted }}>
                        {g.flatFee > 0
                          ? ` · ${t("portal.gigs.flatFee")}`
                          : ` · ${g.hours}h × ${formatNok(g.rate)}`}
                      </span>
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      alignItems: "flex-end",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => advanceStatus(g)}
                      title={t("portal.gigs.advanceTitle")}
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "5px 10px",
                        borderRadius: 999,
                        background: sc.bg,
                        color: sc.fg,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {statusLabelT(g.status, t)} →
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(g)}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "5px 10px",
                        background: "transparent",
                        color: c.muted,
                        border: `1px solid ${c.border}`,
                        borderRadius: 6,
                        cursor: "pointer",
                      }}
                    >
                      {t("portal.gigs.edit")}
                    </button>
                  </div>
                </div>

                {/* Footer: check-in (confirmed/done only) + calendar export */}
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    flexWrap: "wrap",
                    alignItems: "center",
                    paddingTop: 8,
                    borderTop: `1px dashed ${c.border}`,
                  }}
                >
                  {showCheckIn ? (
                    <CheckInControls
                      theme={theme}
                      gig={g}
                      onSet={(field, value) => setCheckIn(g, field, value)}
                      t={t}
                      locale={locale}
                    />
                  ) : null}
                  <div style={{ flex: 1 }} />
                  <button
                    type="button"
                    onClick={() => exportGigToCalendar(g)}
                    title={t("portal.gigs.calendarTitle")}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "6px 12px",
                      background: "transparent",
                      color: c.text,
                      border: `1px solid ${c.border}`,
                      borderRadius: 999,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span aria-hidden>📅</span> {t("portal.gigs.downloadIcs")}
                  </button>
                  <a
                    href={googleCalendarUrl(g)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t("portal.gigs.googleCalendarTitle")}
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      padding: "6px 12px",
                      background: theme === "dark" ? "#ffffff" : "#1a73e8",
                      color: theme === "dark" ? "#202124" : "#ffffff",
                      border: `1px solid ${
                        theme === "dark" ? "#ffffff" : "#1a73e8"
                      }`,
                      borderRadius: 999,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      textDecoration: "none",
                    }}
                  >
                    <span aria-hidden>G</span>{" "}
                    {t("portal.gigs.addToGoogleCalendar")}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing ? (
        <GigEditor
          theme={theme}
          gig={editing}
          onSave={saveGig}
          onCancel={() => setEditing(null)}
          onDelete={() => deleteGig(editing.id)}
          isNew={!data.gigs.some((g) => g.id === editing.id)}
          t={t}
        />
      ) : null}
    </div>
  );
}

function GigEditor({
  theme,
  gig,
  onSave,
  onCancel,
  onDelete,
  isNew,
  t,
}: {
  theme: ThemeMode;
  gig: Gig;
  onSave: (g: Gig) => void;
  onCancel: () => void;
  onDelete: () => void;
  isNew: boolean;
  t: T;
}) {
  const c = PALETTE[theme];
  const [draft, setDraft] = useState<Gig>(gig);

  function patch<K extends keyof Gig>(key: K, value: Gig[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function num(v: string): number {
    const n = parseFloat(v.replace(",", "."));
    return isFinite(n) ? n : 0;
  }

  const valid = draft.projectName.trim().length > 0 && draft.startDate;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 100,
        padding: 0,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: c.cardBg,
          color: c.text,
          width: "100%",
          maxWidth: 560,
          maxHeight: "92dvh",
          overflowY: "auto",
          borderRadius: "16px 16px 0 0",
          padding: 20,
          boxShadow: c.shadow,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, flex: 1 }}>
            {isNew ? t("portal.gigs.editor.titleNew") : t("portal.gigs.editor.titleEdit")}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("portal.gigs.editor.close")}
            style={{
              background: "transparent",
              border: `1px solid ${c.border}`,
              color: c.text,
              borderRadius: 8,
              padding: "5px 10px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <Field theme={theme} label={t("portal.gigs.editor.projectName")}>
            <input
              type="text"
              value={draft.projectName}
              onChange={(e) => patch("projectName", e.target.value)}
              placeholder=""
              style={inputStyle(theme)}
              autoFocus
            />
          </Field>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <Field theme={theme} label={t("portal.gigs.editor.client")}>
              <input
                type="text"
                value={draft.client}
                onChange={(e) => patch("client", e.target.value)}
                placeholder=""
                style={inputStyle(theme)}
              />
            </Field>
            <Field theme={theme} label={t("portal.gigs.editor.role")}>
              <input
                type="text"
                value={draft.role}
                onChange={(e) => patch("role", e.target.value)}
                placeholder=""
                style={inputStyle(theme)}
              />
            </Field>
          </div>

          <Field theme={theme} label={t("portal.gigs.editor.venue")}>
            <input
              type="text"
              value={draft.venue}
              onChange={(e) => patch("venue", e.target.value)}
              placeholder=""
              style={inputStyle(theme)}
            />
          </Field>

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <Field theme={theme} label={t("portal.gigs.editor.startDate")}>
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => patch("startDate", e.target.value)}
                style={inputStyle(theme)}
              />
            </Field>
            <Field theme={theme} label={t("portal.gigs.editor.endDate")}>
              <input
                type="date"
                value={draft.endDate}
                min={draft.startDate}
                onChange={(e) => patch("endDate", e.target.value)}
                style={inputStyle(theme)}
              />
            </Field>
          </div>

          <WorkingDaysEditor
            theme={theme}
            startDate={draft.startDate}
            endDate={draft.endDate}
            assignedDates={draft.assignedDates}
            onChange={(next) => patch("assignedDates", next)}
            t={t}
          />

          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))" }}>
            <Field theme={theme} label={t("portal.gigs.editor.hours")}>
              <input
                type="number"
                inputMode="decimal"
                step="0.25"
                min="0"
                value={draft.hours || ""}
                onChange={(e) => patch("hours", num(e.target.value))}
                style={inputStyle(theme)}
              />
            </Field>
            <Field theme={theme} label={t("portal.gigs.editor.rate")}>
              <input
                type="number"
                inputMode="decimal"
                step="50"
                min="0"
                value={draft.rate || ""}
                onChange={(e) => patch("rate", num(e.target.value))}
                style={inputStyle(theme)}
              />
            </Field>
            <Field theme={theme} label={t("portal.gigs.editor.flatFee")}>
              <input
                type="number"
                inputMode="decimal"
                step="100"
                min="0"
                value={draft.flatFee || ""}
                onChange={(e) => patch("flatFee", num(e.target.value))}
                placeholder={t("portal.gigs.editor.flatFeePh")}
                style={inputStyle(theme)}
              />
            </Field>
          </div>

          <Field theme={theme} label={t("portal.gigs.editor.status")}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STATUS_ORDER.map((s) => {
                const sc = statusColor(s);
                const active = draft.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => patch("status", s)}
                    style={{
                      padding: "6px 12px",
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 999,
                      cursor: "pointer",
                      background: active ? sc.bg : "transparent",
                      color: active ? sc.fg : c.muted,
                      border: `1px solid ${active ? sc.fg : c.border}`,
                    }}
                  >
                    {statusLabelT(s, t)}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field theme={theme} label={t("portal.gigs.editor.notes")}>
            <textarea
              value={draft.notes}
              onChange={(e) => patch("notes", e.target.value)}
              rows={3}
              placeholder={t("portal.gigs.editor.notesPh")}
              style={{
                ...inputStyle(theme),
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </Field>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 4,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => onSave(draft)}
              disabled={!valid}
              style={{
                flex: 1,
                minWidth: 140,
                padding: "12px 18px",
                fontSize: 14,
                fontWeight: 700,
                background: valid ? c.accent : c.border,
                color: "#0b0b0b",
                border: "none",
                borderRadius: 10,
                cursor: valid ? "pointer" : "not-allowed",
                opacity: valid ? 1 : 0.7,
              }}
            >
              {t("portal.gigs.editor.save")}
            </button>
            {!isNew ? (
              <button
                type="button"
                onClick={onDelete}
                style={{
                  padding: "12px 16px",
                  fontSize: 13,
                  fontWeight: 700,
                  background: "transparent",
                  color: c.danger,
                  border: `1px solid ${c.danger}`,
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                {t("portal.gigs.editor.delete")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCheckInTime(ms: number, locale?: string): string {
  const d = new Date(ms);
  return d.toLocaleString(locale === "no" ? "nb-NO" : "en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CheckInControls({
  theme,
  gig,
  onSet,
  t,
  locale,
}: {
  theme: ThemeMode;
  gig: Gig;
  onSet: (
    field: "onTheWayAt" | "arrivedAt",
    value: number | undefined,
  ) => void;
  t: T;
  locale: string;
}) {
  const c = PALETTE[theme];
  const onTheWay = gig.checkIn?.onTheWayAt;
  const arrived = gig.checkIn?.arrivedAt;
  const baseBtn: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 700,
    padding: "5px 10px",
    borderRadius: 999,
    cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {onTheWay ? (
        <button
          type="button"
          onClick={() => onSet("onTheWayAt", undefined)}
          title={`${t("portal.gigs.checkin.clearHint")} · ${new Date(onTheWay).toLocaleString()}`}
          style={{
            ...baseBtn,
            background: "rgba(99,102,241,0.18)",
            color: "#6366f1",
            border: "1px solid #6366f1",
          }}
        >
          ✓ {t("portal.gigs.checkin.onTheWay")} · {formatCheckInTime(onTheWay, locale)}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onSet("onTheWayAt", Date.now())}
          style={{
            ...baseBtn,
            background: "transparent",
            color: c.text,
            border: `1px solid ${c.border}`,
          }}
        >
          {t("portal.gigs.checkin.onTheWay")}
        </button>
      )}
      {arrived ? (
        <button
          type="button"
          onClick={() => onSet("arrivedAt", undefined)}
          title={`${t("portal.gigs.checkin.clearHint")} · ${new Date(arrived).toLocaleString()}`}
          style={{
            ...baseBtn,
            background: "rgba(22,163,74,0.18)",
            color: c.success,
            border: `1px solid ${c.success}`,
          }}
        >
          ✓ {t("portal.gigs.checkin.arrived")} · {formatCheckInTime(arrived, locale)}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onSet("arrivedAt", Date.now())}
          style={{
            ...baseBtn,
            background: "transparent",
            color: c.text,
            border: `1px solid ${c.border}`,
          }}
        >
          {t("portal.gigs.checkin.arrived")}
        </button>
      )}
    </div>
  );
}

/** Day-by-day toggle grid for `gig.assignedDates`, shown inside the
 *  GigEditor modal. The freelancer can override the server-computed
 *  defaults — e.g. a Rigging member who needs to be on-site for
 *  rehearsal too can tick that day, or a Sound member who's only on
 *  show days can untick the build days.
 *
 *  The visible days are the union of (startDate..endDate range) ∪
 *  (currently-assigned dates outside that range), so editing the
 *  start/end never silently drops a checked day. The range is hard-
 *  capped at 90 days (longer gigs are rare and would blow up the modal)
 *  — anything past that is hidden from the grid but preserved in the
 *  array so a long brief still keeps its full schedule on save. */
function WorkingDaysEditor({
  theme,
  startDate,
  endDate,
  assignedDates,
  onChange,
  t,
}: {
  theme: ThemeMode;
  startDate: string;
  endDate: string;
  assignedDates: string[];
  onChange: (next: string[]) => void;
  t: T;
}) {
  const { locale } = useI18n();
  const c = PALETTE[theme];
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  // Strict ISO check — shape *and* round-trip via the Date parser to
  // reject month/day overflow like 2026-02-30. Mirrors the server-side
  // `isValidIsoDate` helper so editor-side validation can't be looser
  // than what the server will accept on save.
  const isValidIso = (s: string): boolean => {
    if (!ISO.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    return d.toISOString().slice(0, 10) === s;
  };
  // Hard upper bound on visible buttons regardless of where they came
  // from — the start..end range *and* any out-of-range checked dates
  // both feed into this list, so the cap has to be applied to the
  // final union (not just the range loop). Anything beyond 90 visible
  // entries gets surfaced as a "+N preserved" notice instead of
  // rendering hundreds of buttons in the modal.
  const VISIBLE_CAP = 90;
  // Compute the visible day list. UTC arithmetic keeps the result
  // timezone-stable — same approach as the server-side helper.
  const visibleSet = new Set<string>();
  if (isValidIso(startDate)) {
    const end =
      isValidIso(endDate) && endDate >= startDate ? endDate : startDate;
    let cursor = startDate;
    let guard = 0;
    while (cursor <= end && guard < VISIBLE_CAP) {
      visibleSet.add(cursor);
      if (cursor === end) break;
      const d = new Date(`${cursor}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      cursor = d.toISOString().slice(0, 10);
      guard += 1;
    }
  }
  // Fold in any checked-but-out-of-range dates so toggling endDate
  // doesn't strand them invisibly — but only up to the cap, with the
  // remainder reported separately so the producer-set monster brief
  // doesn't render 366 buttons.
  let hiddenCount = 0;
  for (const a of assignedDates) {
    if (!isValidIso(a)) {
      // Malformed entry from corrupt/legacy data — count as hidden so
      // the user knows there's "something else preserved" but we
      // refuse to materialise an invalid date as a toggleable button.
      hiddenCount += 1;
      continue;
    }
    if (visibleSet.has(a)) continue;
    if (visibleSet.size < VISIBLE_CAP) visibleSet.add(a);
    else hiddenCount += 1;
  }
  const days: string[] = Array.from(visibleSet).sort();
  const checked = new Set(assignedDates);
  const total = days.length;
  const selectedVisible = days.filter((d) => checked.has(d)).length;
  const allOn = total > 0 && selectedVisible === total;

  function toggle(iso: string) {
    const next = new Set(checked);
    if (next.has(iso)) next.delete(iso);
    else next.add(iso);
    onChange(Array.from(next).sort());
  }
  function setAll(on: boolean) {
    if (on) {
      // Union with whatever was already checked outside the visible
      // range (shouldn't happen normally, but be safe).
      const next = new Set(checked);
      for (const d of days) next.add(d);
      onChange(Array.from(next).sort());
    } else {
      // Drop everything in the visible range; keep out-of-range
      // entries to avoid silent data loss on a misconfigured range.
      const visible = new Set(days);
      const next = Array.from(checked)
        .filter((d) => !visible.has(d))
        .sort();
      onChange(next);
    }
  }

  if (total === 0) {
    return null;
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: c.muted,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          {t("portal.gigs.workingDays.title")}
        </span>
        <span style={{ fontSize: 12, color: c.muted }}>
          {t("portal.gigs.workingDays.summary")
            .replace("{sel}", String(selectedVisible))
            .replace("{total}", String(total))}
          {hiddenCount > 0
            ? ` · ${t("portal.gigs.workingDays.preserved").replace("{n}", String(hiddenCount))}`
            : ""}
        </span>
        <button
          type="button"
          onClick={() => setAll(!allOn)}
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: `1px solid ${c.border}`,
            color: c.text,
            borderRadius: 6,
            padding: "3px 10px",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {allOn ? t("portal.gigs.workingDays.clearAll") : t("portal.gigs.workingDays.selectAll")}
        </button>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: 10,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          background: c.inputBg,
        }}
      >
        {days.map((iso) => {
          const isOn = checked.has(iso);
          const d = new Date(`${iso}T00:00:00Z`);
          const dateLocale = locale === "no" ? "nb-NO" : "en-GB";
          const dow = d.toLocaleDateString(dateLocale, {
            weekday: "short",
            timeZone: "UTC",
          });
          const dm = d.toLocaleDateString(dateLocale, {
            day: "2-digit",
            month: "short",
            timeZone: "UTC",
          });
          return (
            <button
              key={iso}
              type="button"
              onClick={() => toggle(iso)}
              aria-pressed={isOn}
              title={iso}
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
                minWidth: 56,
                padding: "6px 10px",
                fontSize: 12,
                lineHeight: 1.15,
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${isOn ? c.accent : c.border}`,
                background: isOn ? c.accent : "transparent",
                color: isOn ? "#0b0b0b" : c.text,
                borderRadius: 8,
              }}
            >
              <span style={{ opacity: 0.75, fontWeight: 700 }}>{dow}</span>
              <span>{dm}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Field({
  theme,
  label,
  children,
}: {
  theme: ThemeMode;
  label: string;
  children: React.ReactNode;
}) {
  const c = PALETTE[theme];
  return (
    <label style={{ display: "block" }}>
      <span
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 700,
          color: c.muted,
          marginBottom: 5,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function inputStyle(theme: ThemeMode): React.CSSProperties {
  const c = PALETTE[theme];
  return {
    width: "100%",
    padding: "10px 12px",
    fontSize: 14,
    background: c.inputBg,
    color: c.text,
    border: `1px solid ${c.inputBorder}`,
    borderRadius: 8,
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
}
