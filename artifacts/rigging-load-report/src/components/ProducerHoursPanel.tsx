import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n, type Translator } from "../lib/i18n/I18nContext";

type TimeEntryStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "flagged"
  | "locked";

type ProducerTimeEntry = {
  id: string;
  gigId: string;
  briefId: string | null;
  freelancerUserId: string;
  workDate: string;
  startMinute: number | null;
  endMinute: number | null;
  breakMinutes: number;
  workedMinutes: number;
  producerBreakMinutes: number | null;
  producerAdjustmentMinutes: number;
  overtimeMinutes: number;
  payableMinutes: number;
  adjustmentReason: string;
  adjustedByUserId: string | null;
  adjustedAt: string | null;
  flagReason: string;
  notes: string;
  status: TimeEntryStatus;
  decidedByUserId: string | null;
  decidedAt: string | null;
  rejectionReason: string;
  createdAt: string;
  updatedAt: string;
  gigRole: string;
  gigProjectName: string;
};

const BASE_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
  "/";

function minToHHMM(m: number | null): string {
  if (m == null) return "—";
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function fmtHours(min: number, t: Translator): string {
  return t("producerHours.hours", { hours: Math.round((min / 60) * 100) / 100 });
}

function fmtDate(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(locale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function statusInfo(s: TimeEntryStatus, t: Translator): { label: string; cls: string } {
  switch (s) {
    case "submitted":
      return { label: t("producerHours.status.submitted"), cls: "acs-status-warn" };
    case "approved":
      return { label: t("producerHours.status.approved"), cls: "acs-status-ok" };
    case "rejected":
      return { label: t("producerHours.status.rejected"), cls: "acs-status-bad" };
    case "flagged":
      return { label: t("producerHours.status.flagged"), cls: "acs-status-bad" };
    case "locked":
      return { label: t("producerHours.status.locked"), cls: "acs-status-ok" };
    default:
      return { label: t("producerHours.status.draft"), cls: "acs-status-warn" };
  }
}

function csvEscape(v: string): string {
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildPayrollCsv(entries: ProducerTimeEntry[], t: Translator): string {
  const header = [
    t("producerHours.csv.date"),
    t("producerHours.csv.project"),
    t("producerHours.csv.role"),
    t("producerHours.csv.freelancerId"),
    t("producerHours.csv.start"),
    t("producerHours.csv.end"),
    t("producerHours.csv.breakMinutes"),
    t("producerHours.csv.observedHours"),
    t("producerHours.csv.payableBreakMinutes"),
    t("producerHours.csv.adjustmentMinutes"),
    t("producerHours.csv.overtimeMinutes"),
    t("producerHours.csv.payableHours"),
    t("producerHours.csv.status"),
    t("producerHours.csv.decidedAt"),
    t("producerHours.csv.notes"),
  ].join(",");
  const rows = entries.map((e) =>
    [
      e.workDate,
      e.gigProjectName,
      e.gigRole,
      e.freelancerUserId,
      minToHHMM(e.startMinute),
      minToHHMM(e.endMinute),
      String(e.breakMinutes),
      String(Math.round((e.workedMinutes / 60) * 100) / 100),
      String(e.producerBreakMinutes ?? e.breakMinutes),
      String(e.producerAdjustmentMinutes),
      String(e.overtimeMinutes),
      String(Math.round((e.payableMinutes / 60) * 100) / 100),
      statusInfo(e.status, t).label,
      e.decidedAt ?? "",
      e.notes,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props = {
  briefId: string | null;
  getToken: () => Promise<string | null>;
  /** Optional resolver: map freelancerUserId → display name (e.g. from
   *  MasterCrewSheet's merged roster). Falls back to a shortened id. */
  resolveName?: (freelancerUserId: string) => string | null;
};

export function ProducerHoursPanel({ briefId, getToken, resolveName }: Props) {
  const { locale, t } = useI18n();
  const [entries, setEntries] = useState<ProducerTimeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Race guard — every async op increments `reqRef`. State writes
  // only commit if the captured token still matches; older fetches
  // (e.g. brief A response arriving after we switched to brief B)
  // are dropped on the floor. We also track the briefId we kicked
  // the request off with so a switch invalidates everything in
  // flight even if reload() is called twice for the same brief.
  const reqRef = useRef(0);
  const briefRef = useRef<string | null>(briefId);
  briefRef.current = briefId;

  const reload = useCallback(async () => {
    const myReq = ++reqRef.current;
    const targetBrief = briefId;
    if (!targetBrief) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const commit = () =>
      reqRef.current === myReq && briefRef.current === targetBrief;
    try {
      const token = await getToken();
      if (!commit()) return;
      const res = await fetch(
        `${BASE_URL}api/portal/briefs/${encodeURIComponent(targetBrief)}/time-entries`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!commit()) return;
      if (!res.ok) {
        setError(t("producerHours.error.load"));
        return;
      }
      const json = (await res.json()) as {
        ok?: boolean;
        entries?: ProducerTimeEntry[];
      };
      if (!commit()) return;
      if (!json.ok || !Array.isArray(json.entries)) {
        setError(t("producerHours.error.load"));
        return;
      }
      setEntries(json.entries);
    } catch {
      if (commit()) setError(t("producerHours.error.network"));
    } finally {
      if (commit()) setLoading(false);
    }
  }, [briefId, getToken, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const totals = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let locked = 0;
    let pendingMin = 0;
    let approvedMin = 0;
    let lockedMin = 0;
    for (const e of entries) {
      if (e.status === "submitted") {
        pending += 1;
        pendingMin += e.payableMinutes;
      } else if (e.status === "approved") {
        approved += 1;
        approvedMin += e.payableMinutes;
      } else if (e.status === "locked") {
        locked += 1;
        lockedMin += e.payableMinutes;
      }
    }
    return { pending, approved, locked, pendingMin, approvedMin, lockedMin };
  }, [entries]);

  async function act(
    id: string,
    action: "approve" | "reject" | "flag" | "adjust" | "lock",
    reason?: string,
    adjustment?: {
      adjustmentMinutes: number;
      breakMinutes: number;
      overtimeMinutes: number;
    },
  ) {
    // Snapshot the brief context this action was fired in. If the
    // producer switches briefs mid-request the patch / reload must
    // not run against the new brief's state.
    const startedBrief = briefRef.current;
    const startedReq = reqRef.current;
    const stillCurrent = () =>
      briefRef.current === startedBrief && reqRef.current === startedReq;
    setBusyId(id);
    setError(null);
    try {
      const token = await getToken();
      if (!stillCurrent()) return;
      const url =
        action === "lock"
          ? `${BASE_URL}api/portal/time-entries/${encodeURIComponent(id)}/lock`
          : action === "adjust"
            ? `${BASE_URL}api/portal/time-entries/${encodeURIComponent(id)}/adjust`
          : `${BASE_URL}api/portal/time-entries/${encodeURIComponent(id)}/decide`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body:
          action === "lock"
            ? undefined
            : action === "adjust"
              ? JSON.stringify({ ...adjustment, reason: reason ?? "" })
              : JSON.stringify({
                  decision: action,
                  reason: reason ?? "",
                }),
      });
      if (!stillCurrent()) return;
      const json = (await res.json()) as {
        ok?: boolean;
        entry?: ProducerTimeEntry;
        error?: string;
      };
      if (!stillCurrent()) return;
      if (!res.ok || !json.ok || !json.entry) {
        setError(json.error ?? t("producerHours.error.action"));
        // 409 / row drift — pull fresh server truth. reload() has
        // its own race guard so a brief switch in the meantime is
        // handled there too.
        await reload();
        return;
      }
      // Patch in-place; the action endpoints don't carry gigRole /
      // gigProjectName, so preserve them from our prior row. If the
      // row vanished (context drifted), trigger a guarded reload
      // instead of silently no-op'ing.
      let patched = false;
      setEntries((prev) => {
        const next = prev.map((e) => {
          if (e.id !== id) return e;
          patched = true;
          return {
            ...e,
            ...json.entry!,
            gigRole: e.gigRole,
            gigProjectName: e.gigProjectName,
          };
        });
        return next;
      });
      if (!patched) await reload();
    } catch {
      if (stillCurrent()) setError(t("producerHours.error.network"));
    } finally {
      if (stillCurrent()) setBusyId(null);
    }
  }

  function onReject(id: string) {
    const reason = window.prompt(
      t("producerHours.prompt.reject"),
      "",
    );
    if (reason == null) return;
    void act(id, "reject", reason.trim());
  }

  function onFlag(id: string) {
    const reason = window.prompt(
      t("producerHours.prompt.flag"),
      "",
    );
    if (!reason?.trim()) return;
    void act(id, "flag", reason.trim());
  }

  function onAdjust(entry: ProducerTimeEntry) {
    const breakRaw = window.prompt(
      t("producerHours.prompt.breakMinutes"),
      String(entry.producerBreakMinutes ?? entry.breakMinutes),
    );
    if (breakRaw == null) return;
    const adjustmentRaw = window.prompt(
      t("producerHours.prompt.adjustmentMinutes"),
      String(entry.producerAdjustmentMinutes),
    );
    if (adjustmentRaw == null) return;
    const overtimeRaw = window.prompt(
      t("producerHours.prompt.overtimeMinutes"),
      String(entry.overtimeMinutes),
    );
    if (overtimeRaw == null) return;
    const reason = window.prompt(t("producerHours.prompt.adjustmentReason"), entry.adjustmentReason);
    if (!reason?.trim()) return;
    const breakMinutes = Number(breakRaw);
    const adjustmentMinutes = Number(adjustmentRaw);
    const overtimeMinutes = Number(overtimeRaw);
    if (
      !Number.isInteger(breakMinutes) ||
      !Number.isInteger(adjustmentMinutes) ||
      !Number.isInteger(overtimeMinutes)
    ) {
      setError(t("producerHours.error.wholeMinutes"));
      return;
    }
    void act(entry.id, "adjust", reason.trim(), {
      breakMinutes,
      adjustmentMinutes,
      overtimeMinutes,
    });
  }

  function exportPayrollCsv() {
    const exportable = entries.filter(
      (e) => e.status === "approved" || e.status === "locked",
    );
    if (exportable.length === 0) return;
    downloadCsv(
      `ehs-payroll-hours-${new Date().toISOString().slice(0, 10)}.csv`,
      buildPayrollCsv(exportable, t),
    );
  }

  if (!briefId) {
    return (
      <section className="acs-card" style={{ marginTop: 16 }}>
        <header className="acs-card-header">
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
            {t("producerHours.title")}
          </h3>
        </header>
        <p style={{ margin: "10px 0 0", color: "var(--ink-soft)", fontSize: 13 }}>
          {t("producerHours.noBrief")}
        </p>
      </section>
    );
  }

  return (
    <section
      className="acs-card"
      style={{
        marginTop: 16,
        padding: 14,
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 12,
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, flex: 1 }}>
          {t("producerHours.title")}
        </h3>
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
          {t("producerHours.totals", {
            pending: totals.pending,
            approved: totals.approved,
            approvedHours: fmtHours(totals.approvedMin, t),
            locked: totals.locked,
            lockedHours: fmtHours(totals.lockedMin, t),
          })}
        </span>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 700,
            background: "var(--surface)",
            color: "var(--ink)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? t("producerHours.loadingShort") : t("producerHours.refresh")}
        </button>
        <button
          type="button"
          onClick={exportPayrollCsv}
          disabled={totals.approved + totals.locked === 0}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 700,
            background: "#f88000",
            color: "#0b0b0b",
            border: "none",
            borderRadius: 8,
            cursor:
              totals.approved + totals.locked === 0 ? "not-allowed" : "pointer",
            opacity: totals.approved + totals.locked === 0 ? 0.5 : 1,
          }}
        >
          {t("producerHours.export")}
        </button>
      </header>

      {error ? (
        <div className="acs-error" style={{ marginBottom: 8, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <p
          style={{
            margin: "8px 0 0",
            color: "var(--ink-soft)",
            fontSize: 13,
          }}
        >
          {loading
            ? t("producerHours.loading")
            : t("producerHours.empty")}
        </p>
      ) : (
        <div
          style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: "var(--surface-soft)" }}>
                <Th>{t("producerHours.table.date")}</Th>
                <Th>{t("producerHours.table.roleProject")}</Th>
                <Th>{t("producerHours.table.freelancer")}</Th>
                <Th>{t("producerHours.table.start")}</Th>
                <Th>{t("producerHours.table.end")}</Th>
                <Th>{t("producerHours.table.observed")}</Th>
                <Th>{t("producerHours.table.payable")}</Th>
                <Th>{t("producerHours.table.status")}</Th>
                <Th>{t("producerHours.table.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const s = statusInfo(e.status, t);
                const name = resolveName?.(e.freelancerUserId) ?? null;
                return (
                  <tr key={e.id} style={{ borderTop: "1px solid var(--border)" }}>
                     <Td>{fmtDate(e.workDate, locale === "no" ? "nb-NO" : "en-GB")}</Td>
                    <Td>
                      <div style={{ fontWeight: 700 }}>{e.gigRole || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                        {e.gigProjectName}
                      </div>
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 600 }}>
                        {name ?? e.freelancerUserId.slice(0, 8) + "…"}
                      </div>
                      {e.notes ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--ink-soft)",
                            maxWidth: 220,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={e.notes}
                        >
                          {e.notes}
                        </div>
                      ) : null}
                      {e.status === "rejected" && e.rejectionReason ? (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#ef4444",
                            marginTop: 2,
                          }}
                        >
                           {t("producerHours.reason", { reason: e.rejectionReason })}
                        </div>
                      ) : null}
                    </Td>
                    <Td mono>{minToHHMM(e.startMinute)}</Td>
                    <Td mono>{minToHHMM(e.endMinute)}</Td>
                    <Td mono>
                       {t("producerHours.observed", { minutes: e.breakMinutes, hours: fmtHours(e.workedMinutes, t) })}
                    </Td>
                    <Td mono>
                       {t("producerHours.payable", { minutes: e.producerBreakMinutes ?? e.breakMinutes, hours: fmtHours(e.payableMinutes, t) })}
                       {e.overtimeMinutes > 0 ? ` ${t("producerHours.overtime", { minutes: e.overtimeMinutes })}` : ""}
                      {e.producerAdjustmentMinutes !== 0 ? (
                        <div
                          style={{ fontSize: 11, color: "var(--ink-soft)" }}
                          title={e.adjustmentReason}
                        >
                          {e.producerAdjustmentMinutes > 0 ? "+" : ""}
                           {t("producerHours.adjustment", { minutes: e.producerAdjustmentMinutes })}
                        </div>
                      ) : null}
                    </Td>
                    <Td>
                      <span className={s.cls} style={{ whiteSpace: "nowrap" }}>
                        {s.label}
                      </span>
                    </Td>
                    <Td>
                      <RowActions
                        status={e.status}
                        busy={busyId === e.id}
                        onApprove={() => void act(e.id, "approve")}
                        onReject={() => onReject(e.id)}
                        onFlag={() => onFlag(e.id)}
                        onAdjust={() => onAdjust(e)}
                        onLock={() => void act(e.id, "lock")}
                        t={t}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "8px 10px",
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "var(--ink-soft)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      style={{
        padding: "8px 10px",
        verticalAlign: "top",
        fontFamily: mono
          ? "ui-monospace, SFMono-Regular, Menlo, monospace"
          : undefined,
      }}
    >
      {children}
    </td>
  );
}

function RowActions({
  status,
  busy,
  onApprove,
  onReject,
  onFlag,
  onAdjust,
  onLock,
  t,
}: {
  status: TimeEntryStatus;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onFlag: () => void;
  onAdjust: () => void;
  onLock: () => void;
  t: Translator;
}) {
  const btn = (
    label: string,
    onClick: () => void,
    accent?: boolean,
    danger?: boolean,
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: "4px 8px",
        fontSize: 11,
        fontWeight: 700,
        background: accent ? "#f88000" : danger ? "transparent" : "var(--surface)",
        color: accent ? "#0b0b0b" : danger ? "#ef4444" : "var(--ink)",
        border: danger
          ? "1px solid rgba(239,68,68,0.4)"
          : accent
            ? "none"
            : "1px solid var(--border)",
        borderRadius: 6,
        cursor: busy ? "not-allowed" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
  if (status === "submitted") {
    return (
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {btn(t("producerHours.action.approve"), onApprove, true)}
        {btn(t("producerHours.action.adjust"), onAdjust)}
        {btn(t("producerHours.action.flag"), onFlag, false, true)}
        {btn(t("producerHours.action.reject"), onReject, false, true)}
      </div>
    );
  }
  if (status === "approved") {
    return <div style={{ display: "flex", gap: 4 }}>{btn(t("producerHours.action.lock"), onLock)}</div>;
  }
  return (
    <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>
      {status === "locked"
          ? "—"
        : status === "rejected" || status === "flagged"
          ? t("producerHours.awaitingFreelancer")
          : t("producerHours.notSubmitted")}
    </span>
  );
}
