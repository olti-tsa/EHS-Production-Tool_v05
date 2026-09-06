import React, { useCallback, useEffect, useMemo, useState } from "react";
import { PALETTE, type ThemeMode } from "../../lib/portalTheme";
import { type PortalData } from "../../lib/portalStorage";
import { useAuth } from "@clerk/react";
import { toast } from "sonner";
import { useI18n } from "../../../lib/i18n/I18nContext";

import type { CalendarEntry, ExternalBusy, CalendarConnection, CalendarFeed, CalendarHold } from "./types";
import {
  isoDateOnly,
  buildMonthCells,
  overlapsLocalDay,
  replaceAvailabilityEntriesInRange,
  responseError,
} from "./utils";

import { CalendarGrid } from "./CalendarGrid";
import { EditorDialog } from "./EditorDialog";
import { IntegrationsTab } from "./IntegrationsTab";

function tabBtn(active: boolean, theme: ThemeMode): React.CSSProperties {
  const c = PALETTE[theme];
  return {
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    background: active ? c.cardBg : "transparent",
    color: active ? c.text : c.muted,
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
  };
}

function navBtnStyle(theme: ThemeMode): React.CSSProperties {
  const c = PALETTE[theme];
  return {
    padding: "6px 14px",
    fontSize: 18,
    fontWeight: 700,
    background: c.cardBgSubtle,
    color: c.text,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    cursor: "pointer",
  };
}

export function Availability({ theme, data, setData }: { theme: ThemeMode; data: PortalData; setData: React.Dispatch<React.SetStateAction<PortalData>> }) {
  const c = PALETTE[theme];
  const { locale, t } = useI18n();
  const { getToken } = useAuth();
  const [tab, setTab] = useState<"calendar" | "integrations">("calendar");

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  
  const [viewWeekStart, setViewWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  });

  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [externalBusy, setExternalBusy] = useState<ExternalBusy[]>([]);
  const [holds, setHolds] = useState<CalendarHold[]>([]);

  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [copied, setCopied] = useState(false);
  const [icsUrl, setIcsUrl] = useState("");

  const [loading, setLoading] = useState(false);
  const [activeBulkStatus, setActiveBulkStatus] = useState<"available" | "unavailable" | null>(null);

  const baseUrl = (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) || "/";

  const loadCalendar = useCallback(async () => {
    try {
      const token = await getToken();
      let first, last;
      if (viewMode === "month") {
        first = new Date(viewYear, viewMonth, 1);
        last = new Date(viewYear, viewMonth + 1, 0);
      } else {
        first = new Date(viewWeekStart);
        last = new Date(viewWeekStart);
        last.setDate(last.getDate() + 6);
      }
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`${baseUrl}api/portal/calendar?from=${isoDateOnly(first)}&to=${isoDateOnly(last)}&timezone=${encodeURIComponent(timezone)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const json = await res.json();
        setEntries((json.availability || []).map((e: any) => ({
          id: e.id,
          ruleId: e.ruleId,
          status: e.status,
          startAt: e.startsAt || e.startAt,
          endAt: e.endsAt || e.endAt,
          allDay: e.allDay,
          note: e.privateNote || e.note,
          createdAt: e.createdAt,
          updatedAt: e.updatedAt,
          virtual: Boolean(e.virtual),
        })));
        setExternalBusy((json.externalBusy || []).map((entry: any) => ({
          id: entry.id,
          startAt: entry.startsAt || entry.startAt,
          endAt: entry.endsAt || entry.endAt,
          provider: entry.provider,
        })));
        setHolds((json.holds || []).map((h: any) => ({
          id: h.id,
          status: h.status,
          startAt: h.startsAt || h.startAt,
          endAt: h.endsAt || h.endAt,
          expiresAt: h.expiresAt,
        })));
      }
    } catch (e) {
      console.error(e);
    }
  }, [getToken, viewYear, viewMonth, viewWeekStart, viewMode, baseUrl]);

  const loadIntegrations = useCallback(async () => {
    try {
      const token = await getToken();
      const [connRes, subRes] = await Promise.all([
        fetch(`${baseUrl}api/portal/calendar/connections`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
        fetch(`${baseUrl}api/portal/calendar/subscription`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      ]);
      if (connRes.ok) {
        const json = await connRes.json();
        setConnections(json.connections || []);
      }
      if (subRes.ok) {
        const json = await subRes.json();
        let feedUrl = typeof json.url === 'string' ? json.url : json.feed?.url;
        if (feedUrl && feedUrl.startsWith('/')) {
           feedUrl = window.location.origin + feedUrl;
        }
        setFeed({ enabled: !!feedUrl, url: feedUrl || '' });
      }
    } catch (e) {
      console.error(e);
    }
  }, [getToken, baseUrl]);

  useEffect(() => {
    if (tab === "calendar") loadCalendar();
    else loadIntegrations();
  }, [tab, loadCalendar, loadIntegrations]);

  const [editorDate, setEditorDate] = useState<string | null>(null);
  const [editorEntryId, setEditorEntryId] = useState<string | null>(null);

  const openEditor = (date: string, entry?: CalendarEntry) => {
    setEditorEntryId(entry ? entry.id : null);
    setEditorDate(date);
  };

  const handleAddIcs = async () => {
    if (!icsUrl) return;
    const token = await getToken();
    const res = await fetch(`${baseUrl}api/portal/calendar/connections/ics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: icsUrl })
    });
    if (!res.ok) {
      toast.error(t("portal.availability.toast.icsAddFailed"));
      return;
    }
    toast.success(t("portal.availability.toast.icsAdded"));
    setIcsUrl("");
    loadIntegrations();
  };

  const handleStartConnection = async (provider: string) => {
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}api/portal/calendar/connections/${provider}/start`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) {
        toast.error(t("portal.availability.toast.connectionStartFailed"));
        return;
      }
      const data = await res.json();
      if (data.configured === false) {
        const providerName =
          provider === "google"
            ? t("portal.availability.provider.google")
            : provider === "microsoft"
              ? t("portal.availability.provider.microsoft")
              : provider;
        toast.error(t("portal.availability.toast.adminConfigurationRequired", { provider: providerName }));
      } else if (data.url) {
        window.location.href = data.url;
      }
    } catch(e) {
      toast.error(t("portal.availability.toast.connectionStartFailed"));
    }
  };

  const handleSync = async (id: string) => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}api/portal/calendar/connections/${id}/sync`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (res.ok) {
      toast.success(t("portal.availability.toast.syncQueued"));
      setTimeout(() => loadIntegrations(), 2000);
    } else {
      toast.error(t("portal.availability.toast.syncFailed"));
    }
  };

  const handleCopy = async () => {
    if (!feed?.url) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      toast.success(t("portal.availability.toast.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      toast.error(t("portal.availability.toast.copyFailed"));
    }
  };

  const getWebcalUrl = () => {
    if (!feed?.url) return "";
    return feed.url.replace(/^https?:\/\//, "webcal://");
  };

  const handleDownload = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${baseUrl}api/portal/calendar/download.ics`, {
         headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(t("portal.availability.toast.downloadFailed"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "calendar.ics";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("portal.availability.toast.downloadFailed"));
    }
  };

  const [rotateConfirm, setRotateConfirm] = useState(false);
  const confirmRotate = async () => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}api/portal/calendar/subscription/rotate`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) {
      toast.error(t("portal.availability.toast.rotateFailed"));
      return;
    }
    toast.success(t("portal.availability.toast.subscriptionRotated"));
    setRotateConfirm(false);
    loadIntegrations();
  };

  const handleDeleteConnection = async (id: string) => {
    const token = await getToken();
    const res = await fetch(`${baseUrl}api/portal/calendar/connections/${id}`, {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) {
      toast.error(t("portal.availability.toast.connectionRemoveFailed"));
      return;
    }
    toast.success(t("portal.availability.toast.connectionRemoved"));
    loadIntegrations();
  };

  const shiftDate = (delta: number) => {
    if (viewMode === "month") {
      const d = new Date(viewYear, viewMonth + delta, 1);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    } else {
      const d = new Date(viewWeekStart);
      d.setDate(d.getDate() + delta * 7);
      setViewWeekStart(d);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  };

  const cells = useMemo(() => {
    if (viewMode === "month") {
      return buildMonthCells(viewYear, viewMonth);
    } else {
      const arr = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(viewWeekStart);
        d.setDate(d.getDate() + i);
        arr.push({ iso: isoDateOnly(d), day: d.getDate(), date: d });
      }
      return arr;
    }
  }, [viewYear, viewMonth, viewMode, viewWeekStart]);
  const dateLocale = locale === "no" ? "nb-NO" : "en-GB";
  const monthName = new Date(viewYear, viewMonth, 1).toLocaleString(dateLocale, { month: "long", year: "numeric" });

  const gigsOverlap = useCallback((iso: string) => {
    return data.gigs.some((g) => g.assignedDates?.includes(iso) || (g.startDate <= iso && g.endDate >= iso && (g.status === "confirmed" || g.status === "done" || g.status === "invoiced" || g.status === "paid")));
  }, [data.gigs]);

  useEffect(() => {
    setActiveBulkStatus(null);
  }, [viewMode, viewYear, viewMonth, viewWeekStart]);

  const replaceRange = async (
    startIso: string,
    endIso: string,
    status: "available" | "unavailable" | "clear",
    wholeView = false,
  ) => {
    setLoading(true);
    try {
      const token = await getToken();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      const startLocal = `${startIso}T00:00:00`;
      
      const endLocalObj = new Date(endIso);
      endLocalObj.setDate(endLocalObj.getDate() + 1); // Add one day to include the end day completely up to 00:00 next day
      const endLocal = `${isoDateOnly(endLocalObj)}T00:00:00`;
      
      const rangeStart = new Date(startLocal).toISOString();
      const rangeEnd = new Date(endLocal).toISOString();

      const replacementEntries = status === "clear" ? [] : [{
        status,
        startsAt: rangeStart,
        endsAt: rangeEnd,
        timezone: tz,
        allDay: true,
      }];

      const res = await fetch(`${baseUrl}api/portal/calendar/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rangeStart,
          rangeEnd,
          entries: replacementEntries,
        }),
      });
      if (!res.ok) {
        toast.error(
          await responseError(
            res,
            t("portal.availability.toast.updateFailed"),
          ),
        );
        return;
      }
      const optimisticEntries: CalendarEntry[] =
        status === "clear"
          ? []
          : [
              {
                id: `optimistic-${status}-${rangeStart}`,
                status,
                startAt: rangeStart,
                endAt: rangeEnd,
                allDay: true,
                updatedAt: new Date().toISOString(),
              },
            ];
      setEntries((current) =>
        replaceAvailabilityEntriesInRange(
          current,
          rangeStart,
          rangeEnd,
          optimisticEntries,
        ),
      );
      if (status !== "clear") {
        setActiveBulkStatus(wholeView ? status : null);
        toast.success(status === "available" ? t("portal.availability.toast.markedAvailable") : t("portal.availability.toast.markedBusy"));
      } else {
        setActiveBulkStatus(null);
        toast.success(t("portal.availability.toast.cleared"));
      }
      await loadCalendar();
    } finally {
      setLoading(false);
    }
  };

  const handleBulk = async (status: "available" | "unavailable" | "clear") => {
    let startIso: string;
    let endIso: string;
    if (viewMode === "month") {
      const lastDay = new Date(viewYear, viewMonth + 1, 0);
      startIso = isoDateOnly(new Date(viewYear, viewMonth, 1));
      endIso = isoDateOnly(lastDay);
    } else {
      const weekEnd = new Date(viewWeekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      startIso = isoDateOnly(viewWeekStart);
      endIso = isoDateOnly(weekEnd);
    }
    await replaceRange(startIso, endIso, status, true);
  };

  const handleCycleDay = async (iso: string) => {
    // Determine current status of the day
    const dayEntries = entries.filter(e => overlapsLocalDay(e.startAt, e.endAt, iso));
    
    // Check if there is an unavailable external busy or gig which might block? No, just replace local day.
    const effectiveEntry = [...dayEntries].sort((a, b) => {
      if (a.virtual !== b.virtual) return a.virtual ? 1 : -1;
      const aTime = new Date(a.updatedAt || a.createdAt || a.startAt).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || b.startAt).getTime();
      return bTime - aTime;
    })[0];

    const currentStatus = effectiveEntry ? effectiveEntry.status : "neutral";
    let nextStatus: "available" | "unavailable" | "clear" = "available";
    if (currentStatus === "neutral") nextStatus = "available";
    else if (currentStatus === "available") nextStatus = "unavailable";
    else nextStatus = "clear";

    // Optimistically update UI could be added here, but API is fast.
    await replaceRange(iso, iso, nextStatus);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "space-between", flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{t("portal.availability.title")}</h1>
        <div style={{ display: "flex", gap: 8, background: c.cardBgSubtle, padding: 4, borderRadius: 8, border: `1px solid ${c.border}` }}>
          <button onClick={() => setTab("calendar")} style={tabBtn(tab === "calendar", theme)}>{t("portal.availability.tab.calendar")}</button>
          <button onClick={() => setTab("integrations")} style={tabBtn(tab === "integrations", theme)}>{t("portal.availability.tab.integrations")}</button>
        </div>
      </header>

      {tab === "calendar" && (
        <div style={{ 
          background: c.cardBg, 
          border: `1px solid ${c.border}`, 
          borderRadius: 14, 
          padding: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "visible"
        }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 8, flexShrink: 0 }}>
            <button onClick={() => shiftDate(-1)} style={navBtnStyle(theme)} aria-label={t("portal.availability.prev")}>‹</button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 18, fontWeight: 800 }}>
              {viewMode === "month"
                ? monthName
                : t("portal.availability.view.weekOf", {
                    date: viewWeekStart.toLocaleDateString(dateLocale, { month: "short", day: "numeric" }),
                  })}
            </div>
            <button onClick={() => shiftDate(+1)} style={navBtnStyle(theme)} aria-label={t("portal.availability.next")}>›</button>
            <div style={{ display: "flex", gap: 4, background: c.cardBgSubtle, padding: 4, borderRadius: 8, border: `1px solid ${c.border}` }}>
              <button onClick={() => setViewMode("month")} style={tabBtn(viewMode === "month", theme)}>{t("portal.availability.view.month")}</button>
              <button onClick={() => setViewMode("week")} style={tabBtn(viewMode === "week", theme)}>{t("portal.availability.view.week")}</button>
            </div>
          </div>

          <div style={{ overflowY: "visible", minHeight: 0 }}>
            <CalendarGrid
              theme={theme}
              cells={cells}
              today={today}
              entries={entries}
              externalBusy={externalBusy}
              holds={holds}
              data={data}
              gigsOverlap={gigsOverlap}
              openEditor={openEditor}
              onBulkAction={replaceRange}
              viewMode={viewMode}
            />
            
            <div style={{ marginTop: 10, marginBottom: 8, display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", fontSize: 12, color: c.muted }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: "#16a34a" }} />
                <span>{t("portal.availability.legend.available")}</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: "#dc2626" }} />
                <span>{t("portal.availability.legend.unavailable")}</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 6, background: "#f59e0b" }} />
                <span>{t("portal.availability.legend.gig")}</span>
              </span>
            </div>
          </div>

          <div className="availability-toggle-bar" style={{ flexShrink: 0 }}>
            <span className="availability-toggle-bar__label">
              {viewMode === "month" ? monthName : t("portal.availability.view.week")}
            </span>
            <div className="availability-toggle-bar__buttons" role="group" aria-label={t("portal.availability.bulk.currentViewAria")}>
              <button
                type="button"
                aria-pressed={activeBulkStatus === "available"}
                disabled={loading}
                onClick={() => handleBulk("available")}
                className={`availability-toggle availability-toggle--available${activeBulkStatus === "available" ? " is-active" : ""}`}
              >
                <span className="availability-toggle__dot" style={{ color: "#16a34a" }} />
                {viewMode === "month" ? t("portal.availability.bulk.monthAvailable") : t("portal.availability.bulk.weekAvailable")}
              </button>
              <button
                type="button"
                aria-pressed={activeBulkStatus === "unavailable"}
                disabled={loading}
                onClick={() => handleBulk("unavailable")}
                className={`availability-toggle availability-toggle--busy${activeBulkStatus === "unavailable" ? " is-active" : ""}`}
              >
                <span className="availability-toggle__dot" style={{ color: "#dc2626" }} />
                {viewMode === "month" ? t("portal.availability.bulk.monthBusy") : t("portal.availability.bulk.weekBusy")}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleBulk("clear")}
                className="availability-toggle"
                style={{ background: "transparent", border: `1px solid ${c.border}` }}
              >
                {viewMode === "month" ? t("portal.availability.bulk.clearMonth") : t("portal.availability.bulk.clearWeek")}
              </button>
            </div>
          </div>

        </div>
      )}

      {tab === "integrations" && (
        <IntegrationsTab
          theme={theme}
          connections={connections}
          feed={feed}
          icsUrl={icsUrl}
          setIcsUrl={setIcsUrl}
          handleAddIcs={handleAddIcs}
          handleStartConnection={handleStartConnection}
          handleSync={handleSync}
          handleDeleteConnection={handleDeleteConnection}
          handleCopy={handleCopy}
          handleRotateFeed={() => setRotateConfirm(true)}
          handleDownload={handleDownload}
          getWebcalUrl={getWebcalUrl}
          copied={copied}
        />
      )}

      {rotateConfirm && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.5)", padding: 20 }}>
          <div style={{ background: c.cardBg, color: c.text, padding: 24, borderRadius: 12, width: "100%", maxWidth: 400, minWidth: "min(100vw - 32px, 320px)", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
            <h2 style={{ margin: "0 0 12px" }}>{t("portal.availability.rotateDialog.title")}</h2>
            <p style={{ margin: "0 0 24px", color: c.muted, fontSize: 14 }}>{t("portal.availability.rotateDialog.body")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 12 }}>
              <button onClick={() => setRotateConfirm(false)} style={{ padding: "8px 16px", background: "transparent", border: "none", color: c.muted, cursor: "pointer" }}>{t("portal.availability.rotateDialog.cancel")}</button>
              <button onClick={confirmRotate} style={{ padding: "8px 16px", background: c.danger, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: "bold" }}>{t("portal.availability.rotateDialog.confirm")}</button>
            </div>
          </div>
        </div>
      )}

      {editorDate && (
        <EditorDialog
          date={editorDate}
          onClose={() => {
            setEditorDate(null);
            setEditorEntryId(null);
          }}
          onSave={loadCalendar}
          theme={theme}
          getToken={getToken}
          baseUrl={baseUrl}
          existingEntry={
            editorEntryId
              ? entries.find((entry) => entry.id === editorEntryId)
              : undefined
          }
          dayEntries={entries.filter((entry) =>
            overlapsLocalDay(entry.startAt, entry.endAt, editorDate)
          )}
        />
      )}
      
      <style>{`
        .availability-cell-badges {
          position: absolute;
          top: 27px;
          left: 3px;
          right: 3px;
          z-index: 1;
          display: grid;
          gap: 3px;
          max-height: calc(100% - 31px);
          overflow-y: auto;
          pointer-events: auto;
          scrollbar-width: thin;
        }
        .availability-time-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          padding: 2px 5px;
          border-radius: 999px;
          font-size: 9px;
          line-height: 1.25;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
        }
        .availability-time-badge--available {
          color: #065f46;
          background: rgba(16,185,129,.15);
          border: 1px solid rgba(16,185,129,.3);
        }
        .availability-time-badge--unavailable {
          color: #9f1239;
          background: rgba(244,63,94,.15);
          border: 1px solid rgba(244,63,94,.3);
        }
        .availability-time-badge--tentative {
          color: #854d0e;
          background: rgba(245,158,11,.15);
          border: 1px solid rgba(245,158,11,.3);
        }
        .availability-time-badge--gig {
          color: #000;
          background: rgba(248,128,0,.15);
          border: 1px solid rgba(248,128,0,.4);
        }
        [data-theme="dark"] .availability-time-badge--available { color: #34d399; }
        [data-theme="dark"] .availability-time-badge--unavailable { color: #fb7185; }
        [data-theme="dark"] .availability-time-badge--tentative { color: #fbbf24; }
        [data-theme="dark"] .availability-time-badge--gig { color: #F88000; }
        .availability-time-badge__dot {
          width: 5px;
          height: 5px;
          flex: 0 0 5px;
          border-radius: 50%;
          background: currentColor;
        }
        .availability-time-badge__label {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (max-width: 520px) {
          .availability-cell-badges {
            top: 44px;
            left: 2px;
            right: 2px;
            max-height: calc(100% - 47px);
          }
          .availability-time-badge {
            justify-content: center;
            min-height: 14px;
            padding: 1px 2px;
            font-size: 8px;
          }
          .availability-time-badge__label { display: none; }
        }
        .availability-time-input:focus {
          outline: none;
          border-color: #f97316 !important;
          box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.45);
        }
        .availability-toggle-bar {
          margin-top: 8px;
          padding: 8px 12px;
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          border: 1px solid ${c.border};
          border-radius: 12px;
          background: ${c.cardBgSubtle};
        }
        .availability-toggle-bar__label {
          color: ${c.muted};
          font-size: 12px;
          font-weight: 700;
        }
        .availability-toggle-bar__buttons { display: flex; gap: 8px; flex-wrap: wrap; }
        @media (max-width: 600px) {
          .availability-toggle-bar { flex-direction: column; align-items: stretch; }
          .availability-toggle-bar__label { text-align: center; }
          .availability-toggle-bar__buttons { display: grid; grid-template-columns: 1fr 1fr; width: 100%; }
          .availability-toggle-bar__buttons > button:last-child { grid-column: 1 / -1; }
        }
        .availability-toggle {
          min-width: 116px;
          min-height: 44px;
          padding: 8px 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid ${c.border};
          border-radius: 999px;
          background: ${c.cardBg};
          color: ${c.text};
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, color .15s ease;
        }
        .availability-toggle:hover:not(:disabled) {
          background: ${c.cardBgSubtle};
          border-color: ${c.text};
        }
        .availability-toggle:disabled { cursor: wait; opacity: .65; }
        .availability-toggle__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: currentColor;
        }
        .availability-toggle:focus-visible {
          outline: 2px solid ${c.accent};
          outline-offset: 2px;
        }
        .availability-toggle.is-active {
          box-shadow: 0 0 0 2px ${c.cardBg} inset, 0 0 0 4px ${c.accent};
        }
      `}</style>
    </div>
  );
}
