import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { PALETTE, type ThemeMode } from "../lib/portalTheme";
import type { Gig, PortalData } from "../lib/portalStorage";
import { useI18n, useT } from "../../lib/i18n/I18nContext";

type T = ReturnType<typeof useT>;

type TimeEntryStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "flagged"
  | "locked";

type TimeEntryRow = {
  id: string;
  gigId: string;
  workDate: string;
  startMinute: number | null;
  endMinute: number | null;
  breakMinutes: number;
  workedMinutes: number;
  payableMinutes: number;
  overtimeMinutes: number;
  status: TimeEntryStatus;
  notes: string;
  rejectionReason: string | null;
  flagReason: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  lockedAt: string | null;
};

type Draft = {
  start: string; // "HH:MM" or ""
  end: string;
  breakMinutes: string; // numeric string
  notes: string;
};

const BASE_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
  "/";

function minToHHMM(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return "";
  const mm = Math.max(0, Math.min(24 * 60 - 1, m));
  const h = Math.floor(mm / 60);
  const min = mm % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function hhmmToMin(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function computeHours(d: Draft): number {
  const s = hhmmToMin(d.start);
  const e = hhmmToMin(d.end);
  if (s == null || e == null) return 0;
  // Allow end < start to mean midnight crossover.
  const span = e >= s ? e - s : 24 * 60 - s + e;
  const br = Math.max(0, Math.min(span, Number(d.breakMinutes) || 0));
  const net = Math.max(0, span - br);
  return Math.round((net / 60) * 100) / 100;
}

function fmtDate(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function statusPill(
  status: TimeEntryStatus,
  c: (typeof PALETTE)[ThemeMode],
  t: T,
): { bg: string; fg: string; label: string } {
  switch (status) {
    case "submitted":
      return { bg: "rgba(34,108,255,0.18)", fg: "#3a86ff", label: t("portal.hours.statusPill.submitted") };
    case "approved":
      return { bg: "rgba(46,160,67,0.18)", fg: "#2ea043", label: t("portal.hours.statusPill.approved") };
    case "rejected":
      return { bg: "rgba(239,68,68,0.18)", fg: "#ef4444", label: t("portal.hours.statusPill.rejected") };
    case "flagged":
      return { bg: "rgba(239,68,68,0.18)", fg: "#ef4444", label: t("producerHours.status.flagged") };
    case "locked":
      return { bg: "rgba(120,120,120,0.22)", fg: c.muted, label: t("portal.hours.statusPill.locked") };
    default:
      return { bg: c.cardBgSubtle, fg: c.muted, label: t("portal.hours.statusPill.draft") };
  }
}

export function Hours({
  theme,
  data,
}: {
  theme: ThemeMode;
  data: PortalData;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const { locale } = useI18n();
  const { getToken } = useAuth();

  // Only working gigs surface here. Invoiced/paid history isn't editable.
  const eligibleGigs = useMemo(
    () =>
      data.gigs
        .filter(
          (g) =>
            (g.status === "confirmed" || g.status === "done") &&
            g.assignedDates.length > 0,
        )
        .sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [data.gigs],
  );

  // entries[gigId][workDate] = row
  const [entriesByGig, setEntriesByGig] = useState<
    Record<string, Record<string, TimeEntryRow>>
  >({});
  // drafts[gigId][workDate] = local edit state
  const [drafts, setDrafts] = useState<
    Record<string, Record<string, Draft>>
  >({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchEntries = useCallback(
    async (gigId: string) => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${BASE_URL}api/portal/gigs/${encodeURIComponent(gigId)}/time-entries`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          ok?: boolean;
          entries?: TimeEntryRow[];
        };
        if (!json.ok || !Array.isArray(json.entries)) return;
        const byDate: Record<string, TimeEntryRow> = {};
        for (const e of json.entries) byDate[e.workDate] = e;
        setEntriesByGig((prev) => ({ ...prev, [gigId]: byDate }));
      } catch {
        /* keep silent — retry on next mount */
      }
    },
    [getToken],
  );

  useEffect(() => {
    for (const g of eligibleGigs) void fetchEntries(g.id);
  }, [eligibleGigs, fetchEntries]);

  function draftFor(gigId: string, workDate: string): Draft {
    const local = drafts[gigId]?.[workDate];
    if (local) return local;
    const row = entriesByGig[gigId]?.[workDate];
    return {
      start: minToHHMM(row?.startMinute ?? null),
      end: minToHHMM(row?.endMinute ?? null),
      breakMinutes: row ? String(row.breakMinutes ?? 0) : "30",
      notes: row?.notes ?? "",
    };
  }

  function patchDraft(gigId: string, workDate: string, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const gigDrafts = { ...(prev[gigId] ?? {}) };
      gigDrafts[workDate] = { ...draftFor(gigId, workDate), ...patch };
      return { ...prev, [gigId]: gigDrafts };
    });
  }

  async function saveDraft(gigId: string, workDate: string): Promise<boolean> {
    const d = draftFor(gigId, workDate);
    const key = `${gigId}|${workDate}|save`;
    setSavingKey(key);
    setErrorMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BASE_URL}api/portal/gigs/${encodeURIComponent(gigId)}/time-entries/${workDate}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            startMinute: hhmmToMin(d.start),
            endMinute: hhmmToMin(d.end),
            breakMinutes: Number(d.breakMinutes) || 0,
            notes: d.notes,
          }),
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        entry?: TimeEntryRow;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.entry) {
        setErrorMsg(json.error ?? t("portal.hours.saveFailed"));
        return false;
      }
      setEntriesByGig((prev) => ({
        ...prev,
        [gigId]: { ...(prev[gigId] ?? {}), [workDate]: json.entry! },
      }));
      // Clear local override so the row reflects the saved server copy.
      setDrafts((prev) => {
        const gigDrafts = { ...(prev[gigId] ?? {}) };
        delete gigDrafts[workDate];
        return { ...prev, [gigId]: gigDrafts };
      });
      return true;
    } catch {
      setErrorMsg(t("portal.hours.netSave"));
      return false;
    } finally {
      setSavingKey(null);
    }
  }

  async function submitDay(gigId: string, workDate: string) {
    // Persist current draft first; bail out if it failed so we don't
    // mask the save error by also firing /submit on a stale row.
    const saved = await saveDraft(gigId, workDate);
    if (!saved) return;
    const key = `${gigId}|${workDate}|submit`;
    setSavingKey(key);
    setErrorMsg(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${BASE_URL}api/portal/gigs/${encodeURIComponent(gigId)}/time-entries/${workDate}/submit`,
        {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        entry?: TimeEntryRow;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.entry) {
        setErrorMsg(json.error ?? t("portal.hours.submitFailed"));
        return;
      }
      setEntriesByGig((prev) => ({
        ...prev,
        [gigId]: { ...(prev[gigId] ?? {}), [workDate]: json.entry! },
      }));
    } catch {
      setErrorMsg(t("portal.hours.netSubmit"));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>
          {t("portal.hours.title")}
        </h1>
        <span style={{ color: c.muted, fontSize: 13, lineHeight: 1.4, whiteSpace: "normal", wordWrap: "break-word" }}>
          {t("portal.hours.intro")}
        </span>
      </header>

      {errorMsg ? (
        <div
          style={{
            background: "rgba(239,68,68,0.10)",
            border: "1px solid rgba(239,68,68,0.40)",
            color: "#ef4444",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {errorMsg}
        </div>
      ) : null}

      {eligibleGigs.length === 0 ? (
        <div
          style={{
            padding: "16px",
            color: c.muted,
            fontSize: 14,
            background: c.cardBg,
            border: `1px solid ${c.border}`,
            borderRadius: 12,
          }}
        >
          {t("portal.hours.empty")}
        </div>
      ) : (
        eligibleGigs.map((g) => (
          <GigBlock
            key={g.id}
            theme={theme}
            gig={g}
            entries={entriesByGig[g.id] ?? {}}
            draftFor={(date) => draftFor(g.id, date)}
            patchDraft={(date, patch) => patchDraft(g.id, date, patch)}
            saveDraft={(date) => saveDraft(g.id, date)}
            submitDay={(date) => submitDay(g.id, date)}
            savingKey={savingKey}
            t={t}
            locale={locale}
          />
        ))
      )}
    </div>
  );
}

function GigBlock({
  theme,
  gig,
  entries,
  draftFor,
  patchDraft,
  saveDraft,
  submitDay,
  savingKey,
  t,
  locale,
}: {
  theme: ThemeMode;
  gig: Gig;
  entries: Record<string, TimeEntryRow>;
  draftFor: (workDate: string) => Draft;
  patchDraft: (workDate: string, patch: Partial<Draft>) => void;
  saveDraft: (workDate: string) => Promise<boolean>;
  submitDay: (workDate: string) => void;
  savingKey: string | null;
  t: T;
  locale: string;
}) {
  const c = PALETTE[theme];
  const rawProjectName = gig.projectName?.trim();
  const projectName =
    !rawProjectName ||
    rawProjectName.toLocaleLowerCase() === "untitled project" ||
    rawProjectName.toLocaleLowerCase() === "untitled" ||
    rawProjectName.toLocaleLowerCase() === "uten tittel"
      ? t("portal.hours.generalShift")
      : rawProjectName;

  const totalSubmitted = useMemo(() => {
    let sum = 0;
    for (const date of gig.assignedDates) {
      const row = entries[date];
      if (!row || row.status === "rejected" || row.status === "flagged") continue;
      sum += row.payableMinutes / 60;
    }
    return Math.round(sum * 100) / 100;
  }, [entries, gig.assignedDates]);

  return (
    <section
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: 14,
        padding: 14,
        boxShadow: c.shadowSoft,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, flex: 1 }}>
          {projectName}
        </h2>
        <span style={{ fontSize: 12, color: c.muted }}>
          {gig.role}
          {gig.venue ? ` · ${gig.venue}` : ""}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: c.text,
            background: c.cardBgSubtle,
            border: `1px solid ${c.border}`,
            padding: "3px 8px",
            borderRadius: 999,
          }}
        >
          {t("portal.hours.totalLogged").replace("{n}", String(totalSubmitted))}
        </span>
      </header>

      <div style={{ display: "grid", gap: 8 }}>
        {gig.assignedDates.map((date) => {
          const row = entries[date];
          const status: TimeEntryStatus = row?.status ?? "draft";
          const editable =
            status === "draft" || status === "rejected" || status === "flagged";
          const pill = statusPill(status, c, t);
          const d = draftFor(date);
          const computedH = computeHours(d);
          const isSaving = savingKey?.startsWith(`${gig.id}|${date}|`);
          return (
            <div
              key={date}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: "12px",
                background: c.cardBgSubtle,
                border: `1px solid ${c.border}`,
                borderRadius: 10,
              }}
            >
              {/* Top Row: Date, Hours, Status */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {fmtDate(date, locale)}
                  </div>
                  <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                    {date}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      textAlign: "right",
                    }}
                  >
                    {editable || !row
                      ? `${computedH}h`
                      : `${Math.round((row.payableMinutes / 60) * 100) / 100}h`}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: pill.bg,
                      color: pill.fg,
                      textAlign: "center",
                    }}
                  >
                    {pill.label}
                  </span>
                </div>
              </div>

              {/* Middle Row: Inputs */}
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <TimeField
                  theme={theme}
                  value={d.start}
                  disabled={!editable}
                  onChange={(v) => patchDraft(date, { start: v })}
                  label={t("portal.hours.start")}
                />
                <TimeField
                  theme={theme}
                  value={d.end}
                  disabled={!editable}
                  onChange={(v) => patchDraft(date, { end: v })}
                  label={t("portal.hours.end")}
                />
                <NumField
                  theme={theme}
                  value={d.breakMinutes}
                  disabled={!editable}
                  onChange={(v) => patchDraft(date, { breakMinutes: v })}
                  label={t("portal.hours.minBreak")}
                />
              </div>

              {/* Bottom Row: Actions & Status Message */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                {editable ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => saveDraft(date)}
                      disabled={isSaving}
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        fontWeight: 700,
                        background: c.cardBg,
                        color: c.text,
                        border: `1px solid ${c.border}`,
                        borderRadius: 8,
                        cursor: isSaving ? "not-allowed" : "pointer",
                      }}
                    >
                      {t("portal.hours.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => submitDay(date)}
                      disabled={
                        isSaving ||
                        hhmmToMin(d.start) == null ||
                        hhmmToMin(d.end) == null
                      }
                      style={{
                        padding: "8px 12px",
                        fontSize: 13,
                        fontWeight: 700,
                        background: c.accent,
                        color: "#0b0b0b",
                        border: "none",
                        borderRadius: 8,
                        cursor:
                          isSaving ||
                          hhmmToMin(d.start) == null ||
                          hhmmToMin(d.end) == null
                            ? "not-allowed"
                            : "pointer",
                        opacity:
                          isSaving ||
                          hhmmToMin(d.start) == null ||
                          hhmmToMin(d.end) == null
                            ? 0.5
                            : 1,
                      }}
                    >
                      {t("portal.hours.submit")}
                    </button>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: c.muted, fontWeight: 500 }}>
                    {status === "approved"
                      ? t("portal.hours.approvedBy")
                      : status === "locked"
                        ? t("portal.hours.lockedPayroll")
                        : t("portal.hours.awaiting")}
                  </span>
                )}
              </div>

              {(row?.rejectionReason || row?.flagReason) ? (
                <div
                  style={{
                    color: "#ef4444",
                    fontSize: 12,
                    fontWeight: 500,
                    marginTop: 4,
                    padding: "8px 10px",
                    background: "rgba(239,68,68,0.1)",
                    borderRadius: 6,
                  }}
                >
                  {row.flagReason
                    ? `Flag: ${row.flagReason}`
                    : `Reason: ${row.rejectionReason}`}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TimeField({
  theme,
  value,
  disabled,
  onChange,
  label,
}: {
  theme: ThemeMode;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  label: string;
}) {
  const c = PALETTE[theme];
  return (
    <label
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: c.muted,
      }}
    >
      {label}
      <input
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 96,
          padding: "7px 10px",
          background: c.cardBg,
          color: c.text,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          fontSize: 14,
          fontFamily: "inherit",
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </label>
  );
}

function NumField({
  theme,
  value,
  disabled,
  onChange,
  label,
}: {
  theme: ThemeMode;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  label: string;
}) {
  const c = PALETTE[theme];
  return (
    <label
      style={{
        display: "inline-flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        color: c.muted,
      }}
    >
      {label}
      <input
        type="number"
        min={0}
        max={480}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 80,
          padding: "7px 10px",
          background: c.cardBg,
          color: c.text,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          fontSize: 14,
          fontFamily: "inherit",
          opacity: disabled ? 0.6 : 1,
        }}
      />
    </label>
  );
}
