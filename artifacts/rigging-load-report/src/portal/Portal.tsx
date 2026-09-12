import { useEffect, useMemo, useRef, useState } from "react";
import { Route, Switch, useLocation } from "wouter";
import { useAuth, useUser } from "@clerk/react";
import { PortalLayout, type PortalNavKey, type PortalThemePref } from "./PortalLayout";
import { Hub } from "./screens/Hub";
import { Gigs } from "./screens/Gigs";
import { Availability } from "./screens/Availability";
import { Earnings } from "./screens/Earnings";
import { Hours } from "./screens/Hours";
import { Profile } from "./screens/Profile";
import { Briefs } from "./screens/Briefs";
import { BriefDetail } from "./screens/BriefDetail";
import { Guidelines } from "./screens/Guidelines";
import { BriefImport } from "./screens/BriefImport";
import { Help } from "./screens/Help";
import { MyRuns } from "./screens/MyRuns";
import { MyTasks } from "./screens/MyTasks";
import {
  loadPortalData,
  savePortalData,
  type PortalData,
  type SharedBrief,
  type BriefDecision,
  type Gig,
  type GigStatus,
  EMPTY_PORTAL_DATA,
} from "./lib/portalStorage";
import type { ProjectBrief } from "../lib/projectBrief";
import type { ThemeMode } from "./lib/portalTheme";

export type PortalProps = {
  theme: ThemeMode;
  pref: PortalThemePref;
  setPref: (next: PortalThemePref) => void;
};

export function Portal({ theme, pref, setPref }: PortalProps) {
  const { user } = useUser();
  const { getToken, isSignedIn } = useAuth();
  const userId = user?.id ?? null;

  const [data, setData] = useState<PortalData>(() =>
    loadPortalData(userId),
  );
  // Track which userId the in-memory `data` was loaded for. Persistence is
  // gated on this matching the current userId so that an account switch
  // cannot accidentally overwrite the new user's bucket with the previous
  // user's still-in-memory data before the load effect runs.
  const loadedUserIdRef = useRef<string | null>(userId);

  useEffect(() => {
    setData(loadPortalData(userId));
    loadedUserIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (loadedUserIdRef.current !== userId) return;
    savePortalData(userId, data);
  }, [userId, data]);

  // Pull server-side briefs (those addressed to this freelancer via the
  // producer's Crew Report → Send requests flow) and merge them into
  // the local PortalData. Server is the source of truth for `decision`
  // — if the producer or another device has already recorded a
  // response on a given brief, the server row wins. Legacy
  // share-link briefs that only exist in localStorage are preserved
  // untouched. Re-runs every 60s while the producer might still be
  // pushing new requests; the result is treated as additive so a
  // failed request never wipes the local list.
  useEffect(() => {
    if (!isSignedIn || !userId) return;
    let cancelled = false;
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    const fetchAndMerge = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        const res = await fetch(`${baseUrl}api/portal/briefs/mine`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          briefs?: ServerBriefRow[];
        };
        if (cancelled || !json.ok || !Array.isArray(json.briefs)) return;
        const serverShared = json.briefs
          .map(serverRowToSharedBrief)
          .filter((b): b is SharedBrief => b !== null);
        setData((prev) => mergeServerBriefs(prev, serverShared));
      } catch {
        /* swallow — local state is still usable, will retry */
      }
    };
    void fetchAndMerge();
    const t = window.setInterval(fetchAndMerge, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [isSignedIn, userId, getToken]);

  // Pull server-side gigs (created when the freelancer accepts a brief
  // and any future server-authored bookings) into the local store.
  // Server gigs are merged additively so a fresh device picks up the
  // freelancer's bookings, but local edits in flight (status changes,
  // show-day check-in timestamps) are preserved by keeping the local
  // copy whenever a row already exists under the same id. Same 60-second
  // poll cadence as briefs.
  useEffect(() => {
    if (!isSignedIn || !userId) return;
    let cancelled = false;
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    const fetchAndMerge = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        const res = await fetch(`${baseUrl}api/portal/gigs`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          gigs?: ServerGigRow[];
        };
        if (cancelled || !json.ok || !Array.isArray(json.gigs)) return;
        const serverGigs = json.gigs
          .filter((g) => g.freelancerUserId === userId)
          .map(serverRowToGig)
          .filter((g): g is Gig => g !== null);
        setData((prev) => mergeServerGigs(prev, serverGigs, prev.briefs));
      } catch {
        /* swallow — local state is still usable, will retry */
      }
    };
    void fetchAndMerge();
    const t = window.setInterval(fetchAndMerge, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [isSignedIn, userId, getToken]);

  const [location] = useLocation();
  const active: PortalNavKey = useMemo(() => {
    const path = location.replace(/\/+$/, "");
    if (path.includes("/guidelines")) return "guidelines";
    if (path.endsWith("/gigs")) return "gigs";
    if (path.endsWith("/my-runs")) return "runs";
    if (path.endsWith("/my-tasks")) return "tasks";
    if (path.endsWith("/availability")) return "availability";
    if (path.endsWith("/hours")) return "hours";
    if (path.endsWith("/earnings")) return "earnings";
    if (path.endsWith("/profile")) return "profile";
    if (path.endsWith("/help")) return "help";
    if (path.includes("/brief")) return "briefs";
    return "hub";
  }, [location]);

  const pendingBriefCount = useMemo(
    () => data.briefs.filter((b) => b.decision === "pending").length,
    [data.briefs],
  );

  // Pre-fill profile name from Clerk on first load if empty.
  useEffect(() => {
    if (!user) return;
    setData((prev) => {
      if (prev.profile.fullName) return prev;
      const fromClerk =
        user.fullName ??
        [user.firstName, user.lastName].filter(Boolean).join(" ") ??
        "";
      if (!fromClerk) return prev;
      return { ...prev, profile: { ...prev.profile, fullName: fromClerk } };
    });
  }, [user]);

  // Hydrate the freelancer's profile from the server on sign-in. The
  // server row is the source of truth across devices — without this
  // fetch, a returning user on a fresh browser sees their previous
  // saves disappear (only localStorage had them). To avoid clobbering
  // an in-flight local edit (a slow hydration arriving after the user
  // typed/saved), we snapshot the local profile before the request and
  // only merge if the local profile is still equal to that snapshot
  // when the response lands.
  useEffect(() => {
    if (!isSignedIn || !userId) return;
    let cancelled = false;
    const baseUrl =
      (typeof import.meta !== "undefined" &&
        (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
      "/";
    // Capture the local profile at the moment the fetch starts so we
    // can detect "user edited or saved during the request" later.
    const localSnapshot = JSON.stringify(data.profile);
    const fetchProfile = async () => {
      try {
        const token = await getToken();
        if (cancelled) return;
        const res = await fetch(`${baseUrl}api/portal/profile/me`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (cancelled || !res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          profile?: ServerProfileRow | null;
        };
        if (cancelled || !json.ok || !json.profile) return;
        const sp = json.profile;
        setData((prev) => {
          // If the user changed the profile while the GET was in
          // flight, the local edits win — never overwrite fresher
          // local state with a stale server snapshot.
          if (JSON.stringify(prev.profile) !== localSnapshot) return prev;
          return {
          ...prev,
          profile: {
            photoObjectPath:
              typeof sp.photoObjectPath === "string"
                ? sp.photoObjectPath
                : prev.profile.photoObjectPath,
            fullName: typeof sp.fullName === "string" ? sp.fullName : prev.profile.fullName,
            phone: typeof sp.phone === "string" ? sp.phone : prev.profile.phone,
            email: typeof sp.email === "string" ? sp.email : prev.profile.email,
            primaryRole:
              typeof sp.primaryRole === "string" ? sp.primaryRole : prev.profile.primaryRole,
            city: typeof sp.city === "string" ? sp.city : prev.profile.city,
            insurance:
              typeof sp.insurance === "string" ? sp.insurance : prev.profile.insurance,
            languages: Array.isArray(sp.languages)
              ? sp.languages.filter((x): x is string => typeof x === "string")
              : prev.profile.languages,
            dietary:
              typeof sp.dietaryRequirements === "string"
                ? sp.dietaryRequirements
                : typeof sp.dietary === "string"
                ? sp.dietary
                : prev.profile.dietary,
            allergies:
              typeof sp.allergies === "string" ? sp.allergies : prev.profile.allergies,
            skills: Array.isArray(sp.skills)
              ? sp.skills.filter((x): x is string => typeof x === "string")
              : prev.profile.skills,
            bankAccount:
              typeof sp.bankAccount === "string" ? sp.bankAccount : prev.profile.bankAccount,
            orgNumber:
              typeof sp.orgNumber === "string" ? sp.orgNumber : prev.profile.orgNumber,
            roomShare:
              sp.roomShare === "twin" || sp.roomShare === "single" || sp.roomShare === "either"
                ? sp.roomShare
                : prev.profile.roomShare,
            gender:
              sp.gender === "female" || sp.gender === "male" || sp.gender === "other"
                ? sp.gender
                : "",
          },
          };
        });
      } catch {
        /* swallow — local state remains usable; user can retry by saving */
      }
    };
    void fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, userId, getToken]);

  return (
    <PortalLayout
      theme={theme}
      pref={pref}
      setPref={setPref}
      active={active}
      pendingBriefCount={pendingBriefCount}
      portalData={data}
      userLabel={
        user?.primaryEmailAddress?.emailAddress ??
        user?.username ??
        user?.firstName ??
        "Account"
      }
    >
      <Switch>
        <Route path="/portal/gigs">
          <Gigs theme={theme} data={data} setData={setData} />
        </Route>
        <Route path="/portal/my-runs">
          <MyRuns theme={theme} />
        </Route>
        <Route path="/portal/my-tasks">
          <MyTasks theme={theme} />
        </Route>
        <Route path="/portal/availability">
          <Availability theme={theme} data={data} setData={setData} />
        </Route>
        <Route path="/portal/hours">
          <Hours theme={theme} data={data} />
        </Route>
        <Route path="/portal/earnings">
          <Earnings theme={theme} data={data} />
        </Route>
        <Route path="/portal/profile">
          <Profile theme={theme} data={data} setData={setData} />
        </Route>
        <Route path="/portal/help">
          <Help theme={theme} />
        </Route>
        <Route path="/portal/brief/import">
          <BriefImport theme={theme} setData={setData} />
        </Route>
        <Route path="/portal/briefs">
          <Briefs theme={theme} data={data} />
        </Route>
        <Route path="/portal/guidelines">
          <Guidelines />
        </Route>
        <Route path="/portal/briefs/:id">
          {(params) => (
            <BriefDetail
              theme={theme}
              briefId={params.id}
              data={data}
              setData={setData}
            />
          )}
        </Route>
        <Route>
          <Hub theme={theme} data={data} />
        </Route>
      </Switch>
    </PortalLayout>
  );
}

export const __portal_default_data = EMPTY_PORTAL_DATA;

/** Shape of a row returned by `GET /api/portal/briefs/mine`. The brief
 *  jsonb field is loosely typed because the producer is the source of
 *  truth for it — we only assert the fields the portal reads. */
type ServerBriefRow = {
  assignmentId: string;
  briefId: string;
  crewId: string | null;
  decision: BriefDecision;
  declineReason: string | null;
  shiftResponses: unknown;
  decidedAt: string | null;
  acceptedSnapshot: unknown;
  acceptedGigId: string | null;
  receivedAt: string;
  brief: unknown;
};

/** Convert a server row into the SharedBrief shape the portal already
 *  uses everywhere. We rewrite `briefId` and `recipientCrewId` on the
 *  inner brief so the rest of the portal (BriefDetail "my assignment"
 *  lookup, /respond POST, gigFromBrief) doesn't have to be aware that
 *  the brief came from the server vs. a legacy share-link. */
function serverRowToSharedBrief(row: ServerBriefRow): SharedBrief | null {
  if (!row || typeof row !== "object") return null;
  if (typeof row.briefId !== "string" || !row.briefId) return null;
  if (!row.brief || typeof row.brief !== "object") return null;
  const innerBrief = row.brief as Partial<ProjectBrief> & Record<string, unknown>;
  const recipientCrewId =
    typeof row.crewId === "string" && row.crewId
      ? row.crewId
      : ((innerBrief.recipientCrewId as string | null | undefined) ?? null);
  const merged: ProjectBrief = {
    ...(innerBrief as ProjectBrief),
    briefId: row.briefId,
    recipientCrewId,
  };
  const receivedAt = (() => {
    const t = Date.parse(row.receivedAt);
    return Number.isFinite(t) ? t : Date.now();
  })();
  return {
    briefId: row.briefId,
    assignmentId: row.assignmentId,
    receivedAt,
    decision: row.decision,
    declineReason:
      typeof row.declineReason === "string" ? row.declineReason : null,
    shiftResponses:
      row.shiftResponses &&
      typeof row.shiftResponses === "object" &&
      !Array.isArray(row.shiftResponses)
        ? (Object.fromEntries(
            Object.entries(row.shiftResponses as Record<string, unknown>).filter(
              ([key, value]) =>
                /^\d{4}-\d{2}-\d{2}::(?:setup|rehearsal|show|downrig|day)::\d+$/.test(
                  key,
                ) &&
                (value === "accepted" || value === "declined"),
            ),
          ) as SharedBrief["shiftResponses"])
        : undefined,
    acceptedGigId: row.acceptedGigId ?? undefined,
    acceptedSnapshot:
      row.acceptedSnapshot && typeof row.acceptedSnapshot === "object"
        ? (row.acceptedSnapshot as SharedBrief["acceptedSnapshot"])
        : undefined,
    brief: merged,
  };
}

/** How long after a local accept/decline the portal protects the
 *  freelancer's choice from being overwritten by the server snapshot.
 *  Sized comfortably wider than the 15-second sync window plus one
 *  60-second poll cycle, so a slow ack or a transient 5xx never
 *  visibly downgrades a fresh decision back to "pending" while the
 *  retry loop is still in flight. */
const FRESH_DECISION_WINDOW_MS = 60_000;

/** Predicate guarding all freshness-window comparisons in this file.
 *  Returns true only when the timestamp is in the past *and* younger
 *  than the window. The `age >= 0` guard matters because clock skew,
 *  a manually-set system clock, or a tampered/persisted-from-another-
 *  device localStorage payload can produce future timestamps — and
 *  without the guard `now - future` is negative, which trivially
 *  satisfies `< window` and would lock a row in local-authoritative
 *  mode forever (or suppress server re-add via tombstone forever),
 *  defeating multi-device convergence. */
function isFresh(ts: number | undefined): boolean {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return false;
  const age = Date.now() - ts;
  return age >= 0 && age < FRESH_DECISION_WINDOW_MS;
}

/** Merge server-originated briefs into the local PortalData. Server
 *  rows win on conflict — *except* for the freelancer's own decision
 *  fields when the local copy was set within the freshness window
 *  (see `FRESH_DECISION_WINDOW_MS`). That carve-out lets a freelancer
 *  hit Accept and trust the UI to stay on Accepted even if the
 *  /respond POST is still in flight (or briefly failed and is being
 *  retried). Once the window expires the server is the source of
 *  truth again — so a stale "accepted" that never actually synced
 *  will eventually revert back to "pending" rather than getting
 *  silently stuck. Local-only briefs (legacy share-links) are
 *  preserved untouched. The merged list is sorted by receivedAt desc
 *  so the Briefs screen ordering stays sensible. */
/** Shape of a row returned by `GET /api/portal/gigs`. The endpoint
 *  returns gigs the caller can see in either role (their own gigs or
 *  gigs from briefs they own). The portal only consumes its own. */
/** Shape of a row returned by `GET /api/portal/profile/me`. Mirrors the
 *  server's `projectProfile` output. All string fields default to "" on
 *  the server side; this client treats them as optional anyway because
 *  legacy rows or schema drift shouldn't break hydration. */
type ServerProfileRow = {
  photoObjectPath?: unknown;
  fullName?: unknown;
  phone?: unknown;
  email?: unknown;
  primaryRole?: unknown;
  city?: unknown;
  insurance?: unknown;
  languages?: unknown;
  dietary?: unknown;
  dietaryRequirements?: unknown;
  allergies?: unknown;
  skills?: unknown;
  bankAccount?: unknown;
  orgNumber?: unknown;
  roomShare?: unknown;
  gender?: unknown;
};

type ServerGigRow = {
  id: string;
  freelancerUserId: string;
  briefId: string | null;
  projectName: string;
  client: string;
  venue: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  hours: string | number;
  rate: string | number;
  flatFee: string | number;
  notes: string;
  status: string;
  checkIn: { onTheWayAt?: number; arrivedAt?: number } | null;
  createdAt: string;
};

const VALID_GIG_STATUSES: ReadonlySet<string> = new Set([
  "invited",
  "confirmed",
  "done",
  "invoiced",
  "paid",
]);

/** Convert a server gig row into the local Gig shape. Coerces the
 *  numeric() string columns into numbers, normalises the status, and
 *  parses the ISO timestamp into the epoch-ms `createdAt` the local
 *  store uses. Returns null for rows that fail validation so a single
 *  bad row never poisons the merge. */
function serverRowToGig(row: ServerGigRow): Gig | null {
  if (!row || typeof row !== "object") return null;
  if (typeof row.id !== "string" || !row.id) return null;
  const toNum = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const status: GigStatus = VALID_GIG_STATUSES.has(row.status)
    ? (row.status as GigStatus)
    : "confirmed";
  const createdAt = (() => {
    const t = Date.parse(row.createdAt ?? "");
    return Number.isFinite(t) ? t : Date.now();
  })();
  const checkIn =
    row.checkIn &&
    typeof row.checkIn === "object" &&
    (typeof row.checkIn.onTheWayAt === "number" ||
      typeof row.checkIn.arrivedAt === "number")
      ? row.checkIn
      : undefined;
  // The server returns `assigned_dates` as a string[] of YYYY-MM-DD
  // values (Drizzle's `date().array()`), or omits the field entirely
  // for older rows. Defensive against both shapes — bad entries are
  // dropped rather than failing the whole gig coercion.
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  const rawAssigned = (row as { assignedDates?: unknown }).assignedDates;
  const assignedDates: string[] = Array.isArray(rawAssigned)
    ? Array.from(
        new Set(
          rawAssigned.filter(
            (x): x is string => typeof x === "string" && isoDate.test(x),
          ),
        ),
      ).sort()
    : [];
  return {
    id: row.id,
    projectName: row.projectName ?? "",
    client: row.client ?? "",
    venue: row.venue ?? "",
    role: row.role ?? "",
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? row.startDate ?? "",
    hours: toNum(row.hours),
    rate: toNum(row.rate),
    flatFee: toNum(row.flatFee),
    notes: row.notes ?? "",
    status,
    createdAt,
    briefId: row.briefId ?? undefined,
    checkIn,
    assignedDates,
  };
}

/** Merge server-originated gigs into the local PortalData.
 *
 *  Slice 4 (this version) makes the merge converge across devices:
 *  the local copy is no longer kept *unconditionally* — it only wins
 *  inside a freshness window keyed on the gig's `lastEditedAt`. After
 *  the window, the server snapshot takes over field-by-field, so a
 *  status change on device A actually shows up on device B.
 *
 *  Cases:
 *
 *  1. **Server gig that already exists locally**
 *     - If the local row was edited within `FRESH_DECISION_WINDOW_MS`,
 *       the local copy wins on every field. This protects an
 *       in-flight POST/PATCH from getting clobbered by a poll that
 *       races it to the merge.
 *     - Otherwise the server snapshot is taken.
 *  2. **Server-only gig** — added in place, *unless* its id appears in
 *     `recentlyDeletedGigIds` within the freshness window. That
 *     tombstone closes the race where a freelancer deletes a gig and
 *     a poll lands before DELETE reaches the server.
 *  3. **Brief-linked local gig that's missing from the server** — the
 *     server has authoritatively removed the booking; we drop the
 *     orphan locally too. Exception: if the owning brief was decided
 *     locally within the freshness window the /respond POST is
 *     probably still landing, so we keep it until the next poll.
 *
 *  Local-only gigs (no `briefId` — manual logbook entries) are never
 *  removed by this merge regardless. */
function mergeServerGigs(
  prev: PortalData,
  server: Gig[],
  briefs: SharedBrief[] | undefined,
): PortalData {
  const now = Date.now();
  const serverById = new Map<string, Gig>();
  for (const s of server) serverById.set(s.id, s);
  const freshBriefIds = new Set<string>();
  // Older persisted PortalData payloads (pre-Slice-2) may have no
  // `briefs` array at all — this hook still has to be safe to call
  // before the migration runs, otherwise the freelancer sees a blank
  // crash on first load.
  const briefsList = Array.isArray(briefs) ? briefs : [];
  for (const b of briefsList) {
    if (isFresh(b.decidedLocallyAt)) {
      freshBriefIds.add(b.briefId);
    }
  }
  // Sweep expired tombstones up-front so the map stays bounded.
  const rawTombstones = prev.recentlyDeletedGigIds ?? {};
  const liveTombstones: Record<string, number> = {};
  for (const [id, deletedAt] of Object.entries(rawTombstones)) {
    if (typeof deletedAt === "number" && isFresh(deletedAt)) {
      liveTombstones[id] = deletedAt;
    }
  }
  const tombstoneIds = new Set(Object.keys(liveTombstones));
  const tombstonesChanged =
    Object.keys(rawTombstones).length !== Object.keys(liveTombstones).length;

  const kept: Gig[] = [];
  let changed = tombstonesChanged;
  for (const g of prev.gigs) {
    const serverRow = serverById.get(g.id);
    const fresh = isFresh(g.lastEditedAt);
    if (serverRow) {
      if (fresh) {
        // Local edit is in flight — keep our copy verbatim.
        kept.push(g);
      } else {
        // Server is authoritative: take its fields, but preserve the
        // local-only `lastEditedAt` so a re-render doesn't re-key the
        // freshness window incorrectly.
        const merged: Gig = { ...serverRow, lastEditedAt: g.lastEditedAt };
        // Detect any field-level diff so the parent only re-renders
        // on real changes.
        // `assignedDates` is compared as a sorted joined string — both
        // sides come out of `normalizeGig`/`serverRowToGig` already
        // sorted+deduped, so a cheap equality check is sufficient.
        const sameAssignedDates =
          merged.assignedDates.length === g.assignedDates.length &&
          merged.assignedDates.every((d, i) => d === g.assignedDates[i]);
        const diff =
          merged.status !== g.status ||
          merged.checkIn?.onTheWayAt !== g.checkIn?.onTheWayAt ||
          merged.checkIn?.arrivedAt !== g.checkIn?.arrivedAt ||
          merged.projectName !== g.projectName ||
          merged.client !== g.client ||
          merged.venue !== g.venue ||
          merged.role !== g.role ||
          merged.startDate !== g.startDate ||
          merged.endDate !== g.endDate ||
          merged.hours !== g.hours ||
          merged.rate !== g.rate ||
          merged.flatFee !== g.flatFee ||
          merged.notes !== g.notes ||
          merged.briefId !== g.briefId ||
          !sameAssignedDates;
        kept.push(merged);
        if (diff) changed = true;
      }
      continue;
    }
    // No matching server row.
    if (!g.briefId) {
      // Local-only manual gig: keep unconditionally.
      kept.push(g);
      continue;
    }
    if (freshBriefIds.has(g.briefId)) {
      // /respond is still landing — keep until next poll proves otherwise.
      kept.push(g);
      continue;
    }
    // Brief-linked orphan: server cleared it, drop locally too.
    changed = true;
  }
  // Add server-only gigs, except tombstoned ones (the local DELETE
  // hasn't reached the server yet, but we know it will).
  const localIds = new Set<string>();
  for (const g of kept) localIds.add(g.id);
  for (const s of server) {
    if (localIds.has(s.id)) continue;
    if (tombstoneIds.has(s.id)) continue;
    kept.push(s);
    changed = true;
  }
  if (!changed) return prev;
  kept.sort((a, b) => b.createdAt - a.createdAt);
  const next: PortalData = { ...prev, gigs: kept };
  if (tombstonesChanged) {
    if (Object.keys(liveTombstones).length === 0) {
      delete next.recentlyDeletedGigIds;
    } else {
      next.recentlyDeletedGigIds = liveTombstones;
    }
  }
  return next;
}

function mergeServerBriefs(
  prev: PortalData,
  server: SharedBrief[],
): PortalData {
  const keyOf = (b: SharedBrief) => b.assignmentId ?? `legacy:${b.briefId}`;
  const liveServerAssignmentIds = new Set(
    server.flatMap((brief) =>
      brief.assignmentId ? [brief.assignmentId] : [],
    ),
  );
  const byId = new Map<string, SharedBrief>();
  for (const b of prev.briefs) {
    if (!b.assignmentId || liveServerAssignmentIds.has(b.assignmentId)) {
      byId.set(keyOf(b), b);
    }
  }
  for (const s of server) {
    const local = byId.get(keyOf(s));
    if (!local) {
      byId.set(keyOf(s), s);
      continue;
    }
    // Default: server wins on every field, but `decidedLocallyAt`
    // (a transient client-only marker the server doesn't know about)
    // is preserved.
    let merged: SharedBrief = {
      ...local,
      ...s,
      decidedLocallyAt: local.decidedLocallyAt,
    };
    const fresh = isFresh(local.decidedLocallyAt);
    if (fresh) {
      merged.shiftResponses = local.shiftResponses;
      merged.declineReason = local.declineReason;
    }
    if (fresh && local.decision !== s.decision) {
      // Within the freshness window the local decision wins. We also
      // keep the locally-staged acceptedGigId / acceptedSnapshot so
      // the BriefDetail buttons don't flicker back to "pending" while
      // the /respond POST is in flight or being retried.
      merged = {
        ...merged,
        decision: local.decision,
        declineReason: local.declineReason,
        acceptedGigId: local.acceptedGigId,
        acceptedSnapshot: local.acceptedSnapshot,
      };
    }
    byId.set(keyOf(s), merged);
  }
  const merged = Array.from(byId.values()).sort(
    (a, b) => b.receivedAt - a.receivedAt,
  );
  return { ...prev, briefs: merged };
}
