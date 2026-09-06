/** AvailableCrewSidebar — the "who can I book?" panel that lives next
 *  to the Crew Report table in the Production Tool.
 *
 *  Why it exists
 *  -------------
 *  When the producer is putting a call sheet together they need to
 *  answer three questions, all at once, without leaving the Crew tab:
 *
 *   1. "Who in our roster does Lyd FOH on a DiGiCo SD with a forklift
 *      cert?" — multi-layered AND filter across the four skill groups.
 *   2. "Who is actually free on the show day?" — date-aware status
 *      pulled from gigs (Booked) and brief assignments (Pending Brief).
 *   3. "Send a brief to a batch of freelancers and watch them
 *      accept / decline." — multi-select tickboxes + a sticky "Send
 *      requests" button at the bottom of the panel. Each ticked
 *      freelancer is added to the producer's Crew Report with a
 *      Requested pill, and the brief flows into their portal under
 *      "Awaiting your decision".
 *
 *  Implementation notes
 *  --------------------
 *  - We hit `GET /api/portal/freelancers` directly with `useEffect` +
 *    `fetch` — no react-query in this artifact yet. A debounced
 *    request fires on every filter change so results feel real-time
 *    without hammering the server while the producer is mid-toggle.
 *  - The chip lists come from `@workspace/skills` (canonical labels
 *    only — no free text), grouped Work Type / Console / Cert. Console
 *    is flattened across its sound/lighting/AV subgroups for now to
 *    keep the chip strip readable; subgroup filters can come later.
 *  - "Status" is computed server-side (privacy-safe — no project
 *    names leak across producers) and surfaced as a coloured dot:
 *    green = available, amber = pending brief, red = booked. Booked
 *    rows are visible but not selectable (the checkbox is disabled
 *    with a tooltip) so producers can see them without accidentally
 *    double-booking.
 *  - Phone number is intentionally NOT shown in the directory list;
 *    contact info travels through the brief / gig flow once the
 *    freelancer accepts. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/react";
import { toast } from "sonner";
import {
  SKILL_LIBRARY,
  type SkillSuggestion,
} from "@workspace/skills";
import { FreelancerProfileModal } from "./global/FreelancerProfileModal";
import { useI18n, useT } from "../lib/i18n/I18nContext";
import type { TranslationKey } from "../lib/i18n/types";

type Status = "available" | "pending" | "booked" | "unknown" | "partial" | "unavailable" | "tentative";

type DirectoryRow = {
  userId: string;
  fullName: string;
  primaryRole: string | null;
  city: string | null;
  bio?: string;
  photoObjectPath?: string;
  skills: string[];
  languages: string[];
  /** Phone copied from the freelancer's profile so the producer can
   *  reach them as soon as the row lands in the call sheet. */
  phone?: string;
  /** Server-classified dietary tags (vegan / halal / etc). */
  dietaryTags?: string[];
  /** Server-split free-text allergens. */
  allergens?: string[];
  status: Status;
  availabilityStatus?: "full" | "partial" | "tentative" | "unavailable" | "unknown";
  availabilityReason?: string;
  availabilityUpdatedAt?: string;
  conflicts?: string[];
  holdId?: string;
  holdExpiresAt?: string;
  effectiveStatus?: Status;
};

export type SendRequestsRow = {
  userId: string;
  fullName: string;
  primaryRole: string | null;
  phone?: string;
  dietaryTags?: string[];
  allergens?: string[];
};

type Props = {
  briefId?: string;
  /** Project window. When both are blank the status column degrades
   *  gracefully — every freelancer reads "available" since there is
   *  nothing to compare against. */
  projectStartDate: string;
  projectEndDate: string;
  /** Send brief requests to a batch of freelancers. Implemented by the
   *  parent (App.tsx) so the sidebar stays unaware of the brief-build
   *  / POST plumbing. The parent is expected to add a Requested crew
   *  row for each freelancer, persist the brief, and surface any
   *  network failure back via `sendError` below. */
  onSendRequests: (rows: SendRequestsRow[]) => void | Promise<void>;
  /** Set of Clerk user ids that the producer has already requested for
   *  the current project. Drives the "Already requested" badge on the
   *  card (replaces the checkbox so the producer can't double-request
   *  the same person). */
  requestedUserIds: ReadonlySet<string>;
  /** True while the parent is waiting on the POST /api/portal/briefs
   *  round-trip. Disables the Send button and dims the bar so the
   *  producer can't fire a duplicate request. */
  sending?: boolean;
  /** Last error from a Send requests round-trip, surfaced in the
   *  sticky bottom bar. Cleared when the parent clears the prop. */
  sendError?: string | null;
  /** Compact mode — renders a tight "Available crew" list with just
   *  Name · Role and a quick "+ Add" link per row, no search / chip
   *  filters / status summary. Used inside the Crew & Logistics page
   *  where the producer wants a clean call-sheet feel and reaches for
   *  the full filter UI somewhere else. */
  compact?: boolean;
};

/** Build the chip groups once at module load. The library is static so
 *  there is no point re-deriving on every render. We flatten the
 *  Console & Software subgroups (Sound / Lighting / AV) into a single
 *  scrollable strip — the producer can usually find what they want
 *  without an extra dropdown level. */
const CHIP_GROUPS: Array<{ labelKey: TranslationKey; items: SkillSuggestion[] }> = (() => {
  const work: SkillSuggestion[] = [];
  const consoles: SkillSuggestion[] = [];
  const cert: SkillSuggestion[] = [];
  for (const s of SKILL_LIBRARY) {
    if (s.group === "Work Type") work.push(s);
    else if (s.group === "Console & Software") consoles.push(s);
    else if (s.group === "Certification") cert.push(s);
  }
  return [
    { labelKey: "crew.sidebar.workType", items: work },
    { labelKey: "crew.sidebar.consoleSoftware", items: consoles },
    { labelKey: "crew.sidebar.certification", items: cert },
  ];
})();

/** Status presentation. Keeping it colocated with the component (and
 *  not in CSS-modules) since these labels and colours are intrinsic
 *  to the sidebar's contract with the producer. */
/** Abbreviate a freelancer's full name to "F. Last" for the compact
 *  list — matches the producer reference where the right rail keeps
 *  rows scannable at ~280px wide. Names with no surname fall through
 *  unchanged so we don't accidentally strip a single-token name down
 *  to an initial. */
function shortName(full: string | null | undefined, unnamed: string): string {
  const raw = (full || "").trim();
  if (!raw) return unnamed;
  const parts = raw.split(/\s+/);
  if (parts.length < 2) return raw;
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first.charAt(0).toUpperCase()}. ${last}`;
}

const STATUS_META: Record<Status, { labelKey: TranslationKey; dot: string; tone: string }> = {
  available: { labelKey: "crew.sidebar.status.available", dot: "#16a34a", tone: "ok" },
  partial: { labelKey: "crew.sidebar.status.partial", dot: "#eab308", tone: "warn" },
  tentative: { labelKey: "crew.sidebar.status.tentative", dot: "#eab308", tone: "warn" },
  unknown: { labelKey: "crew.sidebar.status.unknown", dot: "#94a3b8", tone: "neutral" },
  pending: { labelKey: "crew.sidebar.status.pending", dot: "#d97706", tone: "warn" },
  booked: { labelKey: "crew.sidebar.status.booked", dot: "#dc2626", tone: "bad" },
  unavailable: { labelKey: "crew.sidebar.status.unavailable", dot: "#dc2626", tone: "bad" },
};

export function AvailableCrewSidebar({
  briefId,
  projectStartDate,
  projectEndDate,
  onSendRequests,
  requestedUserIds,
  sending = false,
  sendError = null,
  compact = false,
}: Props) {
  const t = useT();
  const { getToken, isSignedIn } = useAuth();

  // Filter state. `selectedSkills` is a Set of canonical skill labels
  // — one entry per active chip. We model it as a Set rather than three
  // per-group arrays so the request builder stays simple (one array of
  // `?skill=` params, AND-ed server-side).
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(
    new Set(),
  );
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "free" | "free-unknown">("all");
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  // Multi-select: the userIds the producer has currently ticked. A
  // booked freelancer can't be ticked (the checkbox is disabled), and
  // an already-requested freelancer doesn't show a checkbox at all
  // (replaced by the "Requested" mark) — so we don't have to worry
  // about validating the ticks at send time.
  const [picks, setPicks] = useState<Set<string>>(new Set());


  async function toggleHold(userId: string, isHold: boolean, holdId?: string) {
    if (!projectStartDate || !briefId) return;
    try {
      const token = await getToken();
      const baseUrl = (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) || "/";
      if (isHold) {
        // Use true local day boundaries in ISO
        const startIso = new Date(`${projectStartDate}T00:00:00`).toISOString();
        const endDay = new Date(`${projectEndDate || projectStartDate}T00:00:00`);
        endDay.setDate(endDay.getDate() + 1);
        const endIso = endDay.toISOString();
        const startMs = new Date(startIso).getTime();

        let expMs = Date.now() + 48 * 3600 * 1000;
        if (expMs > startMs) expMs = startMs;
        const expiresAt = new Date(expMs).toISOString();

        const res = await fetch(`${baseUrl}api/portal/calendar/holds`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            freelancerUserId: userId,
            briefId,
            startsAt: startIso,
            endsAt: endIso,
            expiresAt,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
          })
        });
        if (!res.ok) {
           const text = await res.text();
           throw new Error(text);
        }
        toast.success(t("crew.sidebar.holdPlaced"));
      } else {
        if (!holdId) throw new Error(t("crew.sidebar.missingHoldId"));
        const res = await fetch(`${baseUrl}api/portal/calendar/holds/${holdId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
           const text = await res.text();
           throw new Error(text);
        }
        toast.success(t("crew.sidebar.holdReleased"));
      }
      // re-fetch
      const controller = new AbortController();
      await load(controller.signal);
    } catch (e: any) {
      console.error(e);
      toast.error(e instanceof Error && e.message ? e.message : t("crew.sidebar.holdError"));
    }
  }


  // Re-fetch on filter / date / search change, debounced so a quick
  // chip-toggle storm collapses to a single round-trip. The cleanup
  // both clears the timer AND aborts any in-flight request — we never
  // want a stale response to overwrite a fresher one.
  useEffect(() => {
    if (!isSignedIn) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void load(controller.signal);
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isSignedIn,
    query,
    projectStartDate,
    projectEndDate,
    availabilityFilter,
    // Sets are reference-stable across renders even when contents
    // change, so we serialise the selection to drive the effect.
    Array.from(selectedSkills).sort().join("\u0001"),
  ]);

  // Track the latest request so an aborted-but-already-resolved
  // response can't flash old data into the panel.
  const reqIdRef = useRef(0);

  async function load(signal: AbortSignal) {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (signal.aborted) return;
      const baseUrl =
        (typeof import.meta !== "undefined" &&
          (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
        "/";
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (projectStartDate) params.set("startDate", projectStartDate);
      if (projectEndDate) params.set("endDate", projectEndDate);
      if (briefId) params.set("briefId", briefId);
      params.set("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (availabilityFilter !== "all") params.set("availability", availabilityFilter);
      for (const s of selectedSkills) params.append("skill", s);
      const res = await fetch(
        `${baseUrl}api/portal/freelancers?${params.toString()}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal,
        },
      );
      if (signal.aborted || myReq !== reqIdRef.current) return;
      if (!res.ok) {
        throw new Error(t("crew.sidebar.serverError", { status: res.status }));
      }
      const body = (await res.json()) as {
        ok?: boolean;
        freelancers?: DirectoryRow[];
        error?: string;
      };
      if (signal.aborted || myReq !== reqIdRef.current) return;
      if (!body.ok || !Array.isArray(body.freelancers)) {
        throw new Error(body.error || t("crew.sidebar.badResponse"));
      }
      // Rank logic: available > partial > unknown > pending > booked > unavailable
      const rank: Record<string, number> = { available: 0, partial: 1, tentative: 2, unknown: 3, pending: 4, booked: 5, unavailable: 6 };
      const sorted = body.freelancers.map(r => {
        // synthesize effective status
        let eff: Status = r.status;
        if (r.availabilityStatus === "full" && eff === "available") eff = "available";
        else if (r.availabilityStatus === "partial" && eff === "available") eff = "partial";
        else if (r.availabilityStatus === "tentative" && eff === "available") eff = "tentative";
        else if (r.availabilityStatus === "unknown" && eff === "available") eff = "unknown";
        else if (r.availabilityStatus === "unavailable") eff = "unavailable";
        return { ...r, effectiveStatus: eff };
      }).sort((a, b) => rank[a.effectiveStatus || a.status] - rank[b.effectiveStatus || b.status]);
      setRows(sorted);
    } catch (e) {
      if (signal.aborted) return;
      if (myReq !== reqIdRef.current) return;
      // Silence the AbortError that comes from the strict-mode double
      // mount — it's not a real failure.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : t("crew.sidebar.loadError"));
      setRows([]);
    } finally {
      if (myReq === reqIdRef.current) setLoading(false);
    }
  }

  function toggleSkill(label: string) {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function clearAll() {
    setSelectedSkills(new Set());
    setQuery("");
    setAvailabilityFilter("all");
  }

  function togglePick(userId: string) {
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSend() {
    if (picks.size === 0 || sending) return;
    const selected = rows
      .filter((r) => picks.has(r.userId))
      .map((r) => ({
        userId: r.userId,
        fullName: r.fullName,
        primaryRole: r.primaryRole,
        phone: r.phone,
        dietaryTags: r.dietaryTags,
        allergens: r.allergens,
      }));
    if (selected.length === 0) return;
    // Optimistically clear the picks now — the parent owns the network
    // round-trip and will surface any error in `sendError`. If a send
    // fails the producer can re-tick and try again; we don't keep
    // stale checkmarks around on a failure because that would imply
    // the request "is still selected and ready to send" which
    // misrepresents the actual state.
    setPicks(new Set());
    await onSendRequests(selected);
  }

  // Bucket counts so the producer sees how the filter narrows the pool.
  const counts = useMemo(() => {
    const c: Record<string, number> = { available: 0, pending: 0, booked: 0, unknown: 0, partial: 0, unavailable: 0 };
    for (const r of rows) c[(r as any).effectiveStatus || r.status]++;
    return c;
  }, [rows]);

  if (!isSignedIn) {
    return (
      <aside className={`acs${compact ? " acs-compact" : ""}`}>
        <header className="acs-head">
          <h3>{t("crew.sidebar.title")}</h3>
        </header>
        <div className="acs-empty">
          {t("crew.sidebar.signIn")}
        </div>
      </aside>
    );
  }

  if (compact) {
    // Compact mode shows ONLY the freelancers who are truly addable
    // right now: status === "available" (no booked/pending noise) AND
    // not already part of an outgoing request for this project. The
    // list is capped at five rows so the right rail stays scannable.
    // Producers reaching for the full filter UI are expected to open
    // the dedicated directory view.
    const available = rows
      .filter(
        (r) => r.status === "available" && !requestedUserIds.has(r.userId),
      )
      .slice(0, 5);
    return (
      <aside className="acs acs-compact">
        <header className="acs-compact-head">
          <h3>{t("crew.sidebar.title")}</h3>
          <span className="acs-compact-count">{available.length}</span>
        </header>
        {loading && rows.length === 0 ? (
          <div className="acs-compact-empty">{t("common.loading")}</div>
        ) : error ? (
          <div className="acs-compact-empty">{error}</div>
        ) : available.length === 0 ? (
          <div className="acs-compact-empty">
            {t("crew.sidebar.noFree")}
          </div>
        ) : (
          <ul className="acs-compact-list">
            {available.map((r) => {
              const already = requestedUserIds.has(r.userId);
               const short = shortName(r.fullName, t("crew.sidebar.unnamed"));
              return (
                <li key={r.userId} className="acs-compact-row">
                  <button
                    type="button"
                    className="acs-compact-row-main"
                    onClick={() => setProfileUserId(r.userId)}
                     title={t("crew.sidebar.viewProfile", { name: r.fullName || t("crew.sidebar.freelancer") })}
                    style={{
                      border: 0,
                      padding: 0,
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <FreelancerAvatar row={r} size={30} />
                    <span className="acs-compact-name">{short}</span>
                    {r.primaryRole ? (
                      <span className="acs-compact-role">
                        {" "}
                        — {r.primaryRole}
                      </span>
                    ) : null}
                  </button>
                  {already ? (
                    <span className="acs-compact-tag">{t("crew.status.requested")}</span>
                  ) : (
                    <button
                      type="button"
                      className="acs-compact-add"
                      disabled={sending}
                      onClick={() =>
                        void onSendRequests([
                          {
                            userId: r.userId,
                            fullName: r.fullName,
                            primaryRole: r.primaryRole,
                            phone: r.phone,
                            dietaryTags: r.dietaryTags,
                            allergens: r.allergens,
                          },
                        ])
                      }
                       title={t("crew.sidebar.sendBriefTo", { name: r.fullName || t("crew.sidebar.thisFreelancer") })}
                    >
                      {t("common.add")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {sendError ? (
          <div className="acs-compact-error">{sendError}</div>
        ) : null}
        {profileUserId ? (
          <FreelancerProfileModal
            userId={profileUserId}
            getToken={getToken}
            onClose={() => setProfileUserId(null)}
          />
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="acs">
      <header className="acs-head">
        <h3>{t("crew.sidebar.title")}</h3>
        <p className="acs-sub">
          {projectStartDate ? (
            <>
               {t("crew.sidebar.statusFor")}{" "}
              <strong>
                {projectStartDate}
                {projectEndDate && projectEndDate !== projectStartDate
                  ? ` → ${projectEndDate}`
                  : ""}
              </strong>
            </>
          ) : (
            <>{t("crew.sidebar.setDate")}</>
          )}
        </p>
      </header>


      <div style={{ padding: "0 14px", marginBottom: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
        <label style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)" }}>{t("crew.sidebar.availability")}:</label>
        <select
          value={availabilityFilter}
          onChange={e => setAvailabilityFilter(e.target.value as any)}
          style={{ flex: 1, padding: "6px", fontSize: "13px", borderRadius: "6px", border: "1px solid var(--border-color)", background: "var(--input-bg)", color: "var(--text-main)" }}
        >
          <option value="all">{t("crew.sidebar.anyStatus")}</option>
          <option value="free">{t("crew.sidebar.availableOnly")}</option>
          <option value="free-unknown">{t("crew.sidebar.availableUnknown")}</option>
        </select>
      </div>

      <div className="acs-search">
        <input
          className="led-input"
          type="search"
          value={query}
          placeholder={t("crew.sidebar.search")}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {CHIP_GROUPS.map((group) => (
        <div key={group.labelKey} className="acs-group">
          <div className="acs-group-label">{t(group.labelKey)}</div>
          <div className="acs-chips">
            {group.items.map((s) => {
              const active = selectedSkills.has(s.label);
              return (
                <button
                  key={s.label}
                  type="button"
                  className={`acs-chip${active ? " is-on" : ""}`}
                  onClick={() => toggleSkill(s.label)}
                  title={s.label}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {selectedSkills.size > 0 || query ? (
        <button
          type="button"
          className="btn btn-soft btn-sm acs-clear"
          onClick={clearAll}
        >
          {t("crew.sidebar.clearFilters")}
        </button>
      ) : null}

      <div className="acs-summary" style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
        <span className="acs-tag acs-tag-ok"><strong>{counts.available}</strong> {t("crew.sidebar.summary.full")}</span>
        <span className="acs-tag acs-tag-warn" style={{ background: "rgba(234,179,8,0.15)", color: "#ca8a04" }}><strong>{counts.partial}</strong> {t("crew.sidebar.summary.partial")}</span>
        <span className="acs-tag" style={{ background: "rgba(148,163,184,0.15)", color: "#64748b" }}><strong>{counts.unknown}</strong> {t("crew.sidebar.summary.unknown")}</span>
        <span className="acs-tag acs-tag-bad"><strong>{counts.booked + counts.unavailable}</strong> {t("crew.sidebar.summary.busy")}</span>
      </div>

      <div className="acs-results">
        {loading && rows.length === 0 ? (
          <div className="acs-empty">{t("common.loading")}</div>
        ) : error ? (
          <div className="acs-error">{error}</div>
        ) : rows.length === 0 ? (
          <div className="acs-empty">
            {t("crew.sidebar.noMatches")}
          </div>
        ) : (
          rows.map((r) => (
            <FreelancerCard
              key={r.userId}
              row={r}
              isSelected={picks.has(r.userId)}
              isAlreadyRequested={requestedUserIds.has(r.userId)}
              onToggle={() => togglePick(r.userId)}
              onOpenProfile={() => setProfileUserId(r.userId)}
              onToggleHold={(isHold) => toggleHold(r.userId, isHold, r.holdId)}
              briefId={briefId}
              projectStartDate={projectStartDate}
            />
          ))
        )}
      </div>

      {picks.size > 0 ? (
        <div className="acs-send-bar">
          <span className="acs-send-bar-count">
             {t("crew.sidebar.selected", { count: picks.size })}
            {sendError ? (
              <span className="acs-send-bar-error">· {sendError}</span>
            ) : null}
          </span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSend}
            disabled={sending}
            title={t("crew.sidebar.sendSelectedHint")}
          >
             {sending ? t("crew.sidebar.sending") : t("crew.sidebar.sendRequests", { count: picks.size })}
          </button>
        </div>
      ) : null}
      {profileUserId ? (
        <FreelancerProfileModal
          userId={profileUserId}
          getToken={getToken}
          onClose={() => setProfileUserId(null)}
        />
      ) : null}
    </aside>
  );
}

function FreelancerCard({
  row,
  isSelected,
  isAlreadyRequested,
  onToggle,
  onOpenProfile,
  onToggleHold,
  briefId,
  projectStartDate,
}: {
  row: DirectoryRow;
  isSelected: boolean;
  isAlreadyRequested: boolean;
  onToggle: () => void;
  onOpenProfile: () => void;
  onToggleHold: (isHold: boolean, holdId?: string) => void;
  briefId?: string;
  projectStartDate?: string;
}) {
  const { t, locale } = useI18n();
  // Pull up to three certifications (in the order the freelancer
  // entered them) so the producer can scan rigging-relevant tickets at
  // a glance: "Forklift G4 (NO)", "IPAF 3a/3b", etc.
  const certs = useMemo(() => {
    const certSet = new Set(
      SKILL_LIBRARY.filter((s) => s.group === "Certification").map(
        (s) => s.label,
      ),
    );
    return row.skills.filter((s) => certSet.has(s)).slice(0, 3);
  }, [row.skills]);
  const effStatus = row.effectiveStatus || row.status;
  const meta = STATUS_META[effStatus] || STATUS_META.unknown;
  const isBooked = effStatus === "booked" || effStatus === "unavailable";
  // Do not block producer selection on unknown; warn instead.
  const isUnknown = effStatus === "unknown";

  // Disabled means "can't be ticked right now".
  const isDisabled = isBooked || isAlreadyRequested;

  const isStale = row.availabilityUpdatedAt && (Date.now() - new Date(row.availabilityUpdatedAt).getTime() > 14 * 24 * 60 * 60 * 1000);

  // Click on the card body toggles the pick — easier on tablet than
  // pinpointing the 18px checkbox. We swallow the inner-input click so
  // the toggle doesn't fire twice.
  const handleCardClick = () => {
    if (isDisabled) return;
    onToggle();
  };

  return (
    <article
      className={[
        "acs-card",
        `acs-card-${meta.tone}`,
        isSelected ? "is-selected" : "",
        isAlreadyRequested ? "is-requested" : "",
        isBooked ? "is-disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={handleCardClick}
      title={
        isAlreadyRequested
          ? t("crew.sidebar.alreadyRequested")
          : isBooked
             ? t("crew.sidebar.bookedHint")
            : isSelected
               ? t("crew.sidebar.deselectHint")
               : t("crew.sidebar.addHint")
      }
    >
      {isAlreadyRequested ? (
        <span className="acs-card-mark">{t("crew.status.requested")}</span>
      ) : (
        <input
          type="checkbox"
          className="acs-card-check"
          checked={isSelected}
          disabled={isBooked}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggle}
          aria-label={t("crew.sidebar.select", { name: row.fullName || t("crew.cancel.unnamed") })}
        />
      )}
      <div className="acs-card-head">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenProfile();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: 0,
            border: 0,
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
            textAlign: "left",
          }}
          title={t("crew.sidebar.viewProfile", { name: row.fullName || t("crew.cancel.unnamed") })}
        >
          <FreelancerAvatar row={row} size={38} />
          <div className="acs-card-name">{row.fullName || t("crew.sidebar.unnamed")}</div>
        </button>
        <span
          className={`acs-status acs-status-${meta.tone}`}
          style={isUnknown ? { border: "1px dashed #94a3b8", background: "transparent" } : undefined}
           title={t(meta.labelKey)}
        >
          <span
            className="acs-status-dot"
            style={{ background: meta.dot }}
            aria-hidden
          />
           {t(meta.labelKey)}
        </span>
      </div>
      <div className="acs-card-meta">
        {row.primaryRole ? <span>{row.primaryRole}</span> : null}
        {row.city ? <span>· {row.city}</span> : null}
        {isStale ? <span style={{ color: "#d97706", fontWeight: 700 }}>· {t("crew.sidebar.stale")}</span> : null}
        {row.conflicts && row.conflicts.length > 0 ? (
          <span style={{ color: "#dc2626", fontWeight: 700 }} title={row.conflicts.join(", ")}>
            · {t("crew.sidebar.conflicts", { count: row.conflicts.length })}
          </span>
        ) : null}
      </div>

      {briefId && (
        row.holdId && row.holdExpiresAt ? (
          <div style={{ marginTop: "8px", fontSize: "12px", background: "rgba(234,179,8,0.15)", color: "#ca8a04", padding: "4px 8px", borderRadius: "4px", display: "flex", justifyContent: "space-between" }}>
            <span>{t("crew.sidebar.holdUntil", { time: new Date(row.holdExpiresAt).toLocaleTimeString(locale === "no" ? "nb-NO" : "en-US", {hour: '2-digit', minute:'2-digit'}) })}</span>
            <button type="button" onClick={(e) => { e.stopPropagation(); onToggleHold(false); }} style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontWeight: "bold" }}>{t("crew.sidebar.release")}</button>
          </div>
        ) : row.effectiveStatus === "tentative" ? (
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#ca8a04", textAlign: "right" }}>
            {t("crew.sidebar.tentativelyHeld")}
          </div>
        ) : (() => {
          const startMs = projectStartDate ? new Date(`${projectStartDate}T00:00:00`).getTime() : 0;
          const hasStarted = startMs > 0 && Date.now() >= startMs;

          if (hasStarted) {
            return (
              <div style={{ marginTop: "4px", textAlign: "right" }}>
                <span style={{ fontSize: "11px", color: "var(--text-muted)", border: "1px dashed var(--border-color)", borderRadius: "4px", padding: "2px 6px", cursor: "not-allowed" }} title={t("crew.sidebar.cannotHoldHint")}>
                  {t("crew.sidebar.cannotHold")}
                </span>
              </div>
            );
          }

          return (
            <div style={{ marginTop: "4px", textAlign: "right" }}>
              <button type="button" onClick={(e) => { e.stopPropagation(); onToggleHold(true); }} style={{ fontSize: "11px", background: "transparent", border: "1px solid #cbd5e1", borderRadius: "4px", padding: "2px 6px", cursor: "pointer", color: "#64748b" }}>
                {t("crew.sidebar.tentativeHold")}
              </button>
            </div>
          );
        })()
      )}
      {certs.length > 0 ? (
        <div className="acs-card-certs">
          {certs.map((c) => (
            <span key={c} className="acs-cert">
              {c}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function photoUrl(userId: string): string {
  const baseUrl =
    (typeof import.meta !== "undefined" &&
      (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
    "/";
  return `${baseUrl}api/portal/freelancers/${encodeURIComponent(userId)}/photo`;
}

function FreelancerAvatar({ row, size }: { row: DirectoryRow; size: number }) {
  const initials =
    row.fullName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  return row.photoObjectPath ? (
    <img
      src={photoUrl(row.userId)}
      alt=""
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
    />
  ) : (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "inline-grid",
        placeItems: "center",
        flex: "0 0 auto",
        background: "rgba(248,128,0,.18)",
        color: "#f88000",
        fontSize: Math.max(11, size * 0.34),
        fontWeight: 800,
      }}
    >
      {initials}
    </span>
  );
}

