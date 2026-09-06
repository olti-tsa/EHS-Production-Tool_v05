import { useEffect, useMemo, useState } from "react";
import { openRoomingList } from "../lib/roomingListExport";
import { useI18n, useT } from "../lib/i18n/I18nContext";

/** Server response shape for `GET /api/portal/briefs/:id/hotel`.
 *  Mirrors what `portalBriefs.ts` returns. Kept inline (not in `lib/`)
 *  so this view is self-contained — it's the only consumer. Slice A
 *  ships the per-crew list and producer toggles; pairing engine and
 *  rooming-list export ship in Slices B & C. */
type HotelResponse = {
  ok?: boolean;
  brief?: { id: string; projectName: string; venue: string };
  crew?: HotelCrewRow[];
  error?: string;
};

type RoomShare = "twin" | "single" | "either";
type Gender = "" | "female" | "male" | "other";

type HotelCrewRow = {
  gigId: string;
  freelancerUserId: string;
  name: string;
  role: string;
  hotelRequired: boolean;
  /** Server-resolved value: explicit override if the producer set one,
   *  else min(assignedDates) for check-in / max(assignedDates)+1 for
   *  check-out. May be null when the gig has no assigned dates yet. */
  checkInDate: string | null;
  checkOutDate: string | null;
  /** Whether the resolved value above is an explicit producer override
   *  (vs the default derived from assigned days). UI uses this to show
   *  a quiet "auto" hint when the value is derived. */
  checkInExplicit: boolean;
  checkOutExplicit: boolean;
  roomShare: RoomShare;
  gender: Gender;
  phone: string;
  profileless: boolean;
  /** Slice B: server-suggested or producer-locked room assignment.
   *  Null for crew not in the pairing set (hotelRequired=false). The
   *  same key on two rows means they share a room. */
  roomKey: string | null;
  /** Slice B: whether this row was locked by the producer (via lock/
   *  swap). UI shows a lock icon and the suggester won't move them. */
  roomLocked: boolean;
};

/** Same UTC-stable date formatter as CateringView — render YYYY-MM-DD
 *  strings without timezone day-shift. */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/** Producer's per-brief hotel logistics view. Slice A scope: per-crew
 *  list with hotel-needed toggle, derived/overridable check-in/out
 *  dates, and the room-share preference + (optional) gender that the
 *  pairing engine will consume in Slice B. Polls every 60 s like the
 *  catering view so freelancer profile edits surface without a
 *  refresh. Owner-only on the server side; we surface a friendly
 *  banner if a non-owner somehow lands here. */
export function HotelView({
  briefId,
  getToken,
}: {
  briefId: string;
  /** Async token resolver from Clerk's `useAuth`. Threaded in from
   *  App.tsx so this component stays decoupled from the auth lib. */
  getToken: () => Promise<string | null>;
}) {
  const { t, locale } = useI18n();
  const roomShareLabel: Record<RoomShare, string> = {
    twin: t("hotel.roomShare.twin"),
    single: t("hotel.roomShare.single"),
    either: t("hotel.roomShare.either"),
  };
  const genderLabel: Record<Exclude<Gender, "">, string> = {
    female: t("hotel.gender.female"),
    male: t("hotel.gender.male"),
    other: t("hotel.gender.other"),
  };
  const [data, setData] = useState<HotelResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Per-row in-flight markers so toggling one crew member doesn't
  // disable every other row. Keyed by gigId.
  const [savingByGigId, setSavingByGigId] = useState<Record<string, boolean>>(
    {},
  );
  // Slice B: producer's swap-selection. Holds 0–2 freelancerUserIds
  // picked from DIFFERENT rooms. When length reaches 2 the "Swap" CTA
  // becomes active. Clearing happens after a successful swap or by
  // re-clicking the same row.
  const [swapSelection, setSwapSelection] = useState<string[]>([]);
  // Single in-flight flag for room-level actions (lock / unlock /
  // swap). Coarser than savingByGigId on purpose — a room mutation
  // affects multiple rows at once and we want the whole Rooms section
  // to feel "frozen" until the round-trip lands.
  const [roomActionInFlight, setRoomActionInFlight] = useState(false);

  const baseUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    "/";

  useEffect(() => {
    if (!briefId) return;
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        const res = await fetch(
          `${baseUrl}api/portal/briefs/${briefId}/hotel`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        if (cancelled) return;
        if (!res.ok) {
          const msg =
            res.status === 403
              ? t("hotel.error.notOwner")
              : res.status === 404
                ? t("hotel.error.notFound")
                : t("hotel.error.load");
          setError(msg);
          setLoading(false);
          return;
        }
        const json = (await res.json()) as HotelResponse;
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? t("hotel.error.load"));
          setLoading(false);
          return;
        }
        setData(json);
        setError(null);
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError(t("hotel.error.connection"));
        setLoading(false);
      }
    };
    void fetchOnce();
    const pollTimer = window.setInterval(fetchOnce, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
    };
  }, [briefId, getToken, baseUrl, t]);

  /** Optimistically apply a partial update to a row, then PATCH the
   *  server. On failure we surface the error and revert by re-fetching
   *  on the next poll cycle (or immediately via setError). Concurrent
   *  edits to the same row are gated by `savingByGigId` so the UI
   *  can't race against itself. */
  async function patchRow(
    gigId: string,
    body: {
      hotelRequired?: boolean;
      checkInDate?: string | null;
      checkOutDate?: string | null;
    },
  ) {
    if (!data?.crew) return;
    setSavingByGigId((m) => ({ ...m, [gigId]: true }));
    // Optimistic local update — keep the user's edit visible while
    // the round-trip is in flight. We DO NOT mutate `checkInExplicit`
    // / `checkOutExplicit` locally; the server is the source of truth
    // for whether a value is explicit (it'll come back on the next
    // poll). This avoids a flicker where the "auto" hint disappears
    // for a moment then re-appears.
    setData((prev) => {
      if (!prev?.crew) return prev;
      return {
        ...prev,
        crew: prev.crew.map((row) => {
          if (row.gigId !== gigId) return row;
          return {
            ...row,
            ...(body.hotelRequired !== undefined
              ? { hotelRequired: body.hotelRequired }
              : {}),
            ...(body.checkInDate !== undefined
              ? { checkInDate: body.checkInDate }
              : {}),
            ...(body.checkOutDate !== undefined
              ? { checkOutDate: body.checkOutDate }
              : {}),
          };
        }),
      };
    });
    try {
      const token = await getToken();
      const res = await fetch(
        `${baseUrl}api/portal/briefs/${briefId}/hotel/${gigId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        // Force a re-fetch on the next tick so the user sees the
        // canonical server state instead of their failed optimistic
        // edit. The poll loop will overwrite within 60s but that's
        // too slow for a wrong checkbox state.
        setError(t("hotel.error.saveRefreshing"));
        // Trigger an immediate re-fetch by clearing the data; the
        // useEffect will not re-fire (briefId hasn't changed), so
        // do an inline refetch here.
        const token2 = await getToken();
        const r2 = await fetch(
          `${baseUrl}api/portal/briefs/${briefId}/hotel`,
          { headers: token2 ? { Authorization: `Bearer ${token2}` } : {} },
        );
        if (r2.ok) {
          const j = (await r2.json()) as HotelResponse;
          if (j.ok) setData(j);
        }
      } else {
        setError(null);
        // On success, immediately refetch so derived↔explicit flag
        // transitions (and derived-default values when an override
        // was cleared to null) update without waiting up to 60s for
        // the poll loop. Cheap query — same shape as the initial
        // load, runs in the background and the user perceives the
        // override badge / "auto" hint flipping in real time.
        const token2 = await getToken();
        const r2 = await fetch(
          `${baseUrl}api/portal/briefs/${briefId}/hotel`,
          { headers: token2 ? { Authorization: `Bearer ${token2}` } : {} },
        );
        if (r2.ok) {
          const j = (await r2.json()) as HotelResponse;
          if (j.ok) setData(j);
        }
      }
    } catch {
      setError(t("hotel.error.changeConnection"));
    } finally {
      setSavingByGigId((m) => {
        const { [gigId]: _drop, ...rest } = m;
        return rest;
      });
    }
  }

  /** Shared post-mutation refetch — same shape as the initial load.
   *  Pulled out of patchRow because the room handlers need the same
   *  invalidation pattern. Best-effort: if the refetch fails, the
   *  60s poll will eventually correct, so we just swallow the error.
   *
   *  Side-effect: prunes any swap selection whose target IDs ended up
   *  in the same room (or vanished from the eligible set) after the
   *  refetch. Without this, a producer who clicks Lock then queues a
   *  Swap could end up trying to swap two people who are now in the
   *  same room — server returns 400 "already in same room" which is
   *  technically correct but confusing UX. */
  async function refetch(): Promise<void> {
    try {
      const token = await getToken();
      const r = await fetch(
        `${baseUrl}api/portal/briefs/${briefId}/hotel`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (r.ok) {
        const j = (await r.json()) as HotelResponse;
        if (j.ok) {
          setData(j);
          setSwapSelection((prev) => {
            if (prev.length === 0) return prev;
            const byUser = new Map(
              (j.crew ?? []).map((c) => [
                c.freelancerUserId,
                c.roomKey,
              ]),
            );
            // Drop any selection whose person is no longer in the
            // eligible set, and any pair that's now in the same room.
            const stillValid = prev.filter((id) => byUser.has(id));
            if (stillValid.length === 2) {
              const [k1, k2] = stillValid.map((id) => byUser.get(id));
              if (k1 && k1 === k2) return [];
            }
            return stillValid.length === prev.length ? prev : stillValid;
          });
        }
      }
    } catch {
      /* silent — poll will catch up */
    }
  }

  /** Lock the given crew members into a single room together. The
   *  server allocates the roomKey; we just refetch to see the new
   *  layout. Used both for "lock current room" (occupants of an
   *  existing roomKey) and future-friendly "create custom room". */
  async function lockRoom(freelancerUserIds: string[]): Promise<void> {
    if (freelancerUserIds.length < 1 || roomActionInFlight) return;
    setRoomActionInFlight(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${baseUrl}api/portal/briefs/${briefId}/hotel/lock`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ freelancerUserIds }),
        },
      );
      if (!res.ok) {
        setError(t("hotel.error.lockRefreshing"));
      } else {
        setError(null);
      }
      await refetch();
    } catch {
      setError(t("hotel.error.changeConnection"));
    } finally {
      setRoomActionInFlight(false);
    }
  }

  /** Remove the lock for a set of freelancers, returning them to the
   *  engine's pool. Server tolerates ids that aren't currently locked
   *  (no-op), so the UI doesn't need to filter. */
  async function unlockRoom(freelancerUserIds: string[]): Promise<void> {
    if (freelancerUserIds.length < 1 || roomActionInFlight) return;
    setRoomActionInFlight(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${baseUrl}api/portal/briefs/${briefId}/hotel/unlock`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ freelancerUserIds }),
        },
      );
      if (!res.ok) {
        setError(t("hotel.error.unlockRefreshing"));
      } else {
        setError(null);
      }
      await refetch();
    } catch {
      setError(t("hotel.error.changeConnection"));
    } finally {
      setRoomActionInFlight(false);
    }
  }

  /** Swap two freelancers between their rooms. Server-side this also
   *  locks every occupant of both affected rooms — without that, the
   *  pairing engine would happily re-pair the unlocked former
   *  roommates on the next read and visually undo the swap. We clear
   *  the swap selection on success regardless of whether the network
   *  call won, so the UI returns to a clean state. */
  async function swapPair(idA: string, idB: string): Promise<void> {
    if (idA === idB || roomActionInFlight) return;
    setRoomActionInFlight(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `${baseUrl}api/portal/briefs/${briefId}/hotel/swap`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            freelancerUserIdA: idA,
            freelancerUserIdB: idB,
          }),
        },
      );
      if (!res.ok) {
        setError(t("hotel.error.swapRefreshing"));
      } else {
        setError(null);
      }
      setSwapSelection([]);
      await refetch();
    } catch {
      setError(t("hotel.error.swapConnection"));
      setSwapSelection([]);
    } finally {
      setRoomActionInFlight(false);
    }
  }

  /** Toggle a freelancer in/out of the swap selection.
   *  - Re-clicking the same person removes them.
   *  - Clicking a 2nd person from the SAME room is a no-op (swapping
   *    within a room makes no sense — surfaced via disabled checkbox
   *    in the UI, but defended here too).
   *  - At length 2, additional clicks replace the older selection so
   *    the producer doesn't get stuck with a stale choice. */
  function toggleSwapSelection(
    freelancerUserId: string,
    roomKey: string | null,
  ): void {
    if (!roomKey) return;
    setSwapSelection((prev) => {
      if (prev.includes(freelancerUserId)) {
        return prev.filter((x) => x !== freelancerUserId);
      }
      if (prev.length === 0) return [freelancerUserId];
      if (prev.length === 1) {
        // Block same-room selection — see comment above.
        const otherRoom = data?.crew?.find(
          (c) => c.freelancerUserId === prev[0],
        )?.roomKey;
        if (otherRoom && otherRoom === roomKey) return prev;
        return [prev[0], freelancerUserId];
      }
      // Length 2 — replace the OLDER pick (prev[0]) with the new
      // click. Keeps prev[1] anchored as the user's "active" choice.
      return [prev[1], freelancerUserId];
    });
  }

  // Split crew into "needs hotel" (the bulk of the view) and "local"
  // (collapsed, easy to flip back on). Memoised so the split doesn't
  // recompute on every keystroke in the date inputs.
  const split = useMemo(() => {
    const all = data?.crew ?? [];
    return {
      needsHotel: all.filter((c) => c.hotelRequired),
      local: all.filter((c) => !c.hotelRequired),
    };
  }, [data?.crew]);

  // Run-wide stats — total room-nights across crew with hotelRequired,
  // plus a single-vs-twin breakdown of preferences (NOT actual rooms;
  // pairing engine hasn't shipped yet). Useful for a quick gut-check
  // before sending the brief to the hotel.
  const stats = useMemo(() => {
    if (!data?.crew) return null;
    let nights = 0;
    let single = 0;
    let twin = 0;
    let either = 0;
    for (const c of split.needsHotel) {
      if (c.checkInDate && c.checkOutDate) {
        const ci = new Date(`${c.checkInDate}T00:00:00Z`).getTime();
        const co = new Date(`${c.checkOutDate}T00:00:00Z`).getTime();
        if (Number.isFinite(ci) && Number.isFinite(co) && co > ci) {
          nights += Math.round((co - ci) / 86_400_000);
        }
      }
      if (c.roomShare === "single") single++;
      else if (c.roomShare === "twin") twin++;
      else either++;
    }
    return {
      heads: split.needsHotel.length,
      nights,
      single,
      twin,
      either,
    };
  }, [data?.crew, split.needsHotel]);

  /** Group crew with hotelRequired by their server-assigned roomKey.
   *  We rely on the server to have already run the pairing engine —
   *  the UI never re-pairs on its own (would diverge from what the
   *  rooming-list export produces). Sorted by the trailing room
   *  number so "Room 1, Room 2, Room 3…" appears in natural order
   *  even though the keys are strings. */
  const roomGroups = useMemo(() => {
    const byKey = new Map<string, HotelCrewRow[]>();
    for (const c of split.needsHotel) {
      if (!c.roomKey) continue;
      const list = byKey.get(c.roomKey) ?? [];
      list.push(c);
      byKey.set(c.roomKey, list);
    }
    const groups = Array.from(byKey.entries()).map(([roomKey, occupants]) => {
      const m = /^room-(\d+)$/.exec(roomKey);
      const roomNumber = m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
      return {
        roomKey,
        roomNumber,
        occupants: [...occupants].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      };
    });
    groups.sort((a, b) => {
      if (a.roomNumber !== b.roomNumber) return a.roomNumber - b.roomNumber;
      return a.roomKey.localeCompare(b.roomKey);
    });
    return groups;
  }, [split.needsHotel]);

  /** Build the rooming-list export input from the same data the UI is
   *  currently displaying, then open the print sheet in a new tab.
   *  Pulls from `roomGroups` (already lock-aware and sort-stable) and
   *  `split.local` so the printed handoff matches what the producer
   *  sees on screen. We deliberately don't refetch first — the page
   *  has been polling every 60 s and any pending optimistic updates
   *  are already reflected; refetching here would only ever delay the
   *  click for no real safety win. */
  function handlePrintRoomingList(): void {
    if (!data?.brief) return;
    const rooms = roomGroups.map((g) => ({
      roomKey: g.roomKey,
      // A room is "locked" if any occupant is locked — the lock/swap
      // flow always pins ALL occupants of an affected room, so this
      // is equivalent to "the producer pinned this pairing".
      locked: g.occupants.some((o) => o.roomLocked),
      guests: g.occupants.map((o) => ({
        freelancerUserId: o.freelancerUserId,
        name: o.name,
        role: o.role,
        checkInDate: o.checkInDate,
        checkOutDate: o.checkOutDate,
        roomShare: o.roomShare,
        phone: o.phone,
      })),
    }));
    const noHotelGuests = split.local.map((c) => ({
      name: c.name,
      role: c.role,
    }));
    openRoomingList({
      brief: data.brief,
      rooms,
      noHotelGuests,
      locale,
      copy: {
        untitledProject: t("export.roomingList.untitledProject"), venueTba: t("export.roomingList.venueTba"), documentTitle: (project, venue) => t("export.roomingList.documentTitle", { project, venue }),
        rooms: t("export.roomingList.rooms"), twin: t("export.roomingList.twin"), single: t("export.roomingList.single"), roomNights: t("export.roomingList.roomNights"), dateRange: t("export.roomingList.dateRange"),
        room: (number) => t("export.roomingList.room", { number }), twinRoom: t("export.roomingList.twinRoom"), singleRoom: t("export.roomingList.singleRoom"), singleSoloRoom: t("export.roomingList.singleSoloRoom"),
        locked: t("export.roomingList.locked"), night: (count) => t(count === 1 ? "export.roomingList.night" : "export.roomingList.nights", { count: count.toLocaleString(locale === "no" ? "nb-NO" : "en-US") }), guest: t("export.roomingList.table.guest"), role: t("export.roomingList.table.role"), phone: t("export.roomingList.table.phone"),
        checkIn: t("export.roomingList.table.checkIn"), checkOut: t("export.roomingList.table.checkOut"), notStaying: t("export.roomingList.notStaying"), notStayingDetail: t("export.roomingList.notStayingDetail"),
        title: t("export.roomingList.title"), generated: (date) => t("export.roomingList.generated", { date }), footer: (briefId) => t("export.roomingList.footer", { briefId }), print: t("export.roomingList.print"),
      },
    });
  }

  if (loading && !data) {
    return (
      <div className="led-report">
        <header className="led-report-header">
          <h2>{t("hotel.title")}</h2>
        </header>
        <div className="led-empty">{t("common.loading")}</div>
      </div>
    );
  }

  return (
    <div className="led-report">
      <header className="led-report-header">
        <div>
          <h2>{t("hotel.title")}</h2>
          <p className="led-report-sub">
            {t("hotel.subtitle")}
          </p>
        </div>
        {stats && (
          <div
            className="led-report-meta"
            style={{ display: "flex", alignItems: "center", gap: 8 }}
          >
            <span className="badge">
              {t("hotel.needHotelCount", { count: stats.heads })}
            </span>
            <span className="badge">
              {t("hotel.roomNightsCount", { count: stats.nights })}
            </span>
            <button
              type="button"
              onClick={handlePrintRoomingList}
              disabled={roomGroups.length === 0}
              title={
                roomGroups.length === 0
                  ? t("hotel.printDisabledTitle")
                  : t("hotel.printTitle")
              }
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontWeight: 700,
                border: "none",
                borderRadius: 6,
                cursor: roomGroups.length === 0 ? "not-allowed" : "pointer",
                background: roomGroups.length === 0 ? "#555" : "#f88000",
                color: "#fff",
                opacity: roomGroups.length === 0 ? 0.6 : 1,
              }}
            >
              {t("hotel.print")}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div
          style={{
            margin: "0 0 12px 0",
            padding: "8px 12px",
            border: "1px solid #d97706",
            background: "#78350f22",
            color: "#fbbf24",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {stats && stats.heads > 0 && (
        <div className="led-dashboard">
          <Stat label={t("hotel.stats.twin")} value={stats.twin} t={t} />
          <Stat label={t("hotel.stats.single")} value={stats.single} t={t} />
          <Stat label={t("hotel.stats.either")} value={stats.either} t={t} />
          <Stat label={t("hotel.stats.roomsSuggested")} value={roomGroups.length} t={t} />
        </div>
      )}

      {roomGroups.length > 0 && (
        <section className="led-card" style={{ marginBottom: 12 }}>
          <div className="led-card-head">
            <h3>{t("hotel.rooms")}</h3>
            <span className="badge">
              <strong>{roomGroups.length}</strong>
            </span>
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--muted, #94a3b8)",
              margin: "0 0 10px 0",
            }}
          >
            {t("hotel.roomsHint")}
          </p>
          {swapSelection.length === 2 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
                padding: "8px 12px",
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 6,
              }}
            >
              <span style={{ fontSize: 13, flex: 1 }}>
                {t("hotel.swap")}{" "}
                <strong>{nameOf(data?.crew, swapSelection[0])}</strong>{" "}
                ↔{" "}
                <strong>{nameOf(data?.crew, swapSelection[1])}</strong>?
              </span>
              <button
                type="button"
                onClick={() => setSwapSelection([])}
                disabled={roomActionInFlight}
                style={btnStyle(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() =>
                  void swapPair(swapSelection[0], swapSelection[1])
                }
                disabled={roomActionInFlight}
                style={btnStyle(true)}
              >
                {roomActionInFlight ? t("hotel.swapping") : t("hotel.swap")}
              </button>
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill, minmax(240px, 1fr))",
              gap: 10,
            }}
          >
            {roomGroups.map((group) => {
              // Defensive `new Set` — the server's GET /hotel handler
              // already dedupes per-person, but if a future refactor
              // ever lets a duplicate through, the lock endpoint
              // would 400 with "Duplicate freelancer ids." and the
              // producer would see a confusing failure. Belt-and-
              // braces is essentially free here.
              const occupantIds = Array.from(
                new Set(group.occupants.map((o) => o.freelancerUserId)),
              );
              const anyLocked = group.occupants.some((o) => o.roomLocked);
              return (
                <div
                  key={group.roomKey}
                  style={{
                    border: anyLocked
                      ? "1px solid #fbbf24"
                      : "1px solid #334155",
                    borderRadius: 8,
                    padding: 10,
                    background: anyLocked ? "#78350f15" : "transparent",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      {t("hotel.room", { number: group.roomNumber })}
                      {anyLocked && (
                        <span
                          title={t("hotel.lockedByProducer")}
                          style={{ marginLeft: 6, color: "#fbbf24" }}
                          aria-label={t("hotel.locked")}
                        >
                          🔒
                        </span>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--muted, #94a3b8)",
                      }}
                    >
                      {group.occupants.length === 1
                        ? t("hotel.bedUsed")
                        : t("hotel.sharingCount", { count: group.occupants.length })}
                    </span>
                  </div>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: "0 0 8px 0",
                    }}
                  >
                    {group.occupants.map((o) => {
                      const selected = swapSelection.includes(
                        o.freelancerUserId,
                      );
                      const sameRoomBlocks =
                        swapSelection.length === 1 &&
                        !selected &&
                        data?.crew?.find(
                          (c) =>
                            c.freelancerUserId === swapSelection[0],
                        )?.roomKey === group.roomKey;
                      return (
                        <li
                          key={o.freelancerUserId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 0",
                            fontSize: 13,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            aria-label={t("hotel.selectForSwap", { name: o.name })}
                            disabled={
                              roomActionInFlight || sameRoomBlocks
                            }
                            title={
                              sameRoomBlocks
                                ? t("hotel.pickDifferentRoom")
                                : t("hotel.tickToSwap")
                            }
                            onChange={() =>
                              toggleSwapSelection(
                                o.freelancerUserId,
                                o.roomKey,
                              )
                            }
                          />
                          <span style={{ flex: 1 }}>
                            <span style={{ fontWeight: 600 }}>
                              {o.name}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--muted, #94a3b8)",
                                marginLeft: 6,
                              }}
                            >
                              {roomShareLabel[o.roomShare]}
                              {o.gender ? ` · ${genderLabel[o.gender]}` : ""}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div style={{ display: "flex", gap: 6 }}>
                    {anyLocked ? (
                      <button
                        type="button"
                        disabled={roomActionInFlight}
                        onClick={() => void unlockRoom(occupantIds)}
                        style={btnStyle(false)}
                      >
                        {t("hotel.unlock")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={roomActionInFlight}
                        onClick={() => void lockRoom(occupantIds)}
                        style={btnStyle(false)}
                      >
                        {t("hotel.lock")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {split.needsHotel.length === 0 ? (
        <div className="led-empty">
          {t("hotel.emptyNeedsHotel")}
        </div>
      ) : (
        <section className="led-card" style={{ marginBottom: 12 }}>
          <div className="led-card-head">
            <h3>{t("hotel.needsHotel")}</h3>
            <span className="badge">
              <strong>{split.needsHotel.length}</strong>
            </span>
          </div>
          <CrewTable
            rows={split.needsHotel}
            savingByGigId={savingByGigId}
            patchRow={patchRow}
            t={t}
            roomShareLabel={roomShareLabel}
            genderLabel={genderLabel}
          />
        </section>
      )}

      {split.local.length > 0 && (
        <section className="led-card">
          <div className="led-card-head">
            <h3>{t("hotel.localCrew")}</h3>
            <span className="badge">
              <strong>{split.local.length}</strong>
            </span>
          </div>
          <p
            style={{
              fontSize: 12,
              color: "var(--muted, #94a3b8)",
              margin: "0 0 8px 0",
            }}
          >
            {t("hotel.localCrewHint")}
          </p>
          <CrewTable
            rows={split.local}
            savingByGigId={savingByGigId}
            patchRow={patchRow}
            t={t}
            roomShareLabel={roomShareLabel}
            genderLabel={genderLabel}
          />
        </section>
      )}

      {(!data?.crew || data.crew.length === 0) && (
        <div className="led-empty">
          {t("hotel.empty")}
        </div>
      )}
    </div>
  );
}

/** Look up a crew member's display name by freelancerUserId. Used by
 *  the swap confirmation banner so the producer sees real names instead
 *  of opaque ids. Returns "?" if the row was deleted between selection
 *  and render — shouldn't happen in practice but guards a crash. */
function nameOf(
  crew: HotelCrewRow[] | undefined,
  freelancerUserId: string,
): string {
  return (
    crew?.find((c) => c.freelancerUserId === freelancerUserId)?.name ?? "?"
  );
}

/** Compact button style shared between the Rooms grid actions
 *  (Lock/Unlock/Cancel/Swap). Primary variant is the gold accent
 *  used elsewhere in the app for "main" producer actions. */
function btnStyle(primary: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 12,
    border: primary ? "1px solid #fbbf24" : "1px solid #334155",
    background: primary ? "#fbbf24" : "transparent",
    color: primary ? "#0f172a" : "inherit",
    borderRadius: 4,
    cursor: "pointer",
    fontWeight: primary ? 700 : 500,
  };
}

function Stat({
  label,
  value,
  t,
}: {
  label: string;
  value: number;
  t: ReturnType<typeof useT>;
}) {
  return (
    <div className="led-stat">
      <div className="led-stat-label">{label}</div>
      <div className="led-stat-value">{value}</div>
      <div className="led-stat-sub">{t("hotel.crew")}</div>
    </div>
  );
}

function CrewTable({
  rows,
  savingByGigId,
  patchRow,
  t,
  roomShareLabel,
  genderLabel,
}: {
  rows: HotelCrewRow[];
  savingByGigId: Record<string, boolean>;
  patchRow: (
    gigId: string,
    body: {
      hotelRequired?: boolean;
      checkInDate?: string | null;
      checkOutDate?: string | null;
    },
  ) => Promise<void>;
  t: ReturnType<typeof useT>;
  roomShareLabel: Record<RoomShare, string>;
  genderLabel: Record<Exclude<Gender, "">, string>;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 13,
        }}
      >
        <thead>
          <tr>
            <Th>{t("hotel.table.hotel")}</Th>
            <Th>{t("hotel.table.name")}</Th>
            <Th>{t("hotel.table.role")}</Th>
            <Th>{t("hotel.table.room")}</Th>
            <Th>{t("hotel.table.checkIn")}</Th>
            <Th>{t("hotel.table.checkOut")}</Th>
            <Th>{t("hotel.table.roomShare")}</Th>
            <Th>{t("hotel.table.gender")}</Th>
            <Th>{t("hotel.table.phone")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.gigId} style={{ borderTop: "1px solid #1f293744" }}>
              <Td>
                <input
                  type="checkbox"
                  checked={row.hotelRequired}
                  aria-label={t("hotel.toggleHotel", { name: row.name })}
                  disabled={!!savingByGigId[row.gigId]}
                  onChange={(e) =>
                    patchRow(row.gigId, { hotelRequired: e.target.checked })
                  }
                />
              </Td>
              <Td>
                <div style={{ fontWeight: 600 }}>{row.name}</div>
                {row.profileless && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#fbbf24",
                      marginTop: 2,
                    }}
                  >
                    {t("hotel.noPortalProfile")}
                  </div>
                )}
              </Td>
              <Td>{row.role || t("hotel.notAvailable")}</Td>
              <Td>
                {row.roomKey ? (
                  <span
                    style={{
                      fontSize: 12,
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: row.roomLocked
                        ? "1px solid #fbbf24"
                        : "1px solid var(--border, #334155)",
                      color: row.roomLocked
                        ? "#fbbf24"
                        : "var(--text, inherit)",
                      whiteSpace: "nowrap",
                    }}
                    title={
                      row.roomLocked
                        ? t("hotel.lockedByProducer")
                        : t("hotel.autoSuggested")
                    }
                  >
                    {row.roomLocked ? "🔒 " : ""}
                    {(() => {
                      const m = /^room-(\d+)$/.exec(row.roomKey);
                      return m ? t("hotel.room", { number: m[1] }) : row.roomKey;
                    })()}
                  </span>
                ) : (
                  <span style={{ color: "var(--muted, #94a3b8)" }}>{t("hotel.notAvailable")}</span>
                )}
              </Td>
              <Td>
                <DateCell
                  iso={row.checkInDate}
                  explicit={row.checkInExplicit}
                  disabled={!!savingByGigId[row.gigId] || !row.hotelRequired}
                  onChange={(next) =>
                    patchRow(row.gigId, { checkInDate: next })
                  }
                  t={t}
                  ariaLabel={t("hotel.checkInFor", { name: row.name })}
                />
              </Td>
              <Td>
                <DateCell
                  iso={row.checkOutDate}
                  explicit={row.checkOutExplicit}
                  disabled={!!savingByGigId[row.gigId] || !row.hotelRequired}
                  onChange={(next) =>
                    patchRow(row.gigId, { checkOutDate: next })
                  }
                  t={t}
                  ariaLabel={t("hotel.checkOutFor", { name: row.name })}
                />
              </Td>
              <Td>
                <span
                  style={{
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--border, #334155)",
                    color: "var(--text, inherit)",
                  }}
                >
                  {roomShareLabel[row.roomShare]}
                </span>
              </Td>
              <Td>
                <span
                  style={{
                    fontSize: 12,
                    color: row.gender
                      ? "var(--text, inherit)"
                      : "var(--muted, #94a3b8)",
                  }}
                >
                  {row.gender
                    ? genderLabel[row.gender]
                    : t("hotel.notAvailable")}
                </span>
              </Td>
              <Td>
                {row.phone ? (
                  <a
                    href={`tel:${row.phone}`}
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    {row.phone}
                  </a>
                ) : (
                  <span style={{ color: "var(--muted, #94a3b8)" }}>—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        color: "var(--muted, #94a3b8)",
        padding: "6px 8px",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: "8px", verticalAlign: "middle" }}>{children}</td>
  );
}

function DateCell({
  iso,
  explicit,
  disabled,
  onChange,
  t,
  ariaLabel,
}: {
  iso: string | null;
  explicit: boolean;
  disabled: boolean;
  onChange: (next: string | null) => void;
  t: ReturnType<typeof useT>;
  ariaLabel: string;
}) {
  // The native date input takes "YYYY-MM-DD" exactly — same shape we
  // store + emit, no formatting needed. An empty string means the
  // user cleared the field, which we send as null to revert to the
  // server-derived default.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <input
        type="date"
        value={iso ?? ""}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : v);
        }}
        style={{
          padding: "4px 6px",
          fontSize: 13,
          background: "transparent",
          color: "inherit",
          border: "1px solid var(--border, #334155)",
          borderRadius: 4,
        }}
      />
      {iso && !explicit && (
        <span
          style={{
            fontSize: 10,
            color: "var(--muted, #94a3b8)",
            fontStyle: "italic",
          }}
        >
          {t("hotel.autoFromWorkingDays")}
        </span>
      )}
      {iso && explicit && (
        <span style={{ fontSize: 10, color: "var(--accent, #fbbf24)" }}>
          {t("hotel.override")}
        </span>
      )}
    </div>
  );
}
