import React, { useState, useEffect } from "react";
import { PALETTE, type ThemeMode } from "../../lib/portalTheme";
import { useT } from "../../../lib/i18n/I18nContext";
import { toast } from "sonner";
import {
  buildDayAvailabilityReplacement,
  localTimeOnly,
  localDateTime,
  responseError,
} from "./utils";
import type { CalendarEntry } from "./types";

function inputStyle(theme: ThemeMode): React.CSSProperties {
  const c = PALETTE[theme];
  return {
    padding: "8px 12px",
    borderRadius: 8,
    border: `1px solid ${c.border}`,
    background: c.inputBg,
    color: c.text,
    fontSize: 14
  };
}

function timeInputStyle(theme: ThemeMode): React.CSSProperties {
  const dark = theme === "dark";
  return {
    padding: "8px 12px",
    borderRadius: 8,
    border: `1px solid ${dark ? "#334155" : "#cbd5e1"}`,
    background: dark ? "#1e293b" : "#ffffff",
    color: dark ? "#f1f5f9" : "#0f172a",
    colorScheme: dark ? "dark" : "light",
    opacity: 1,
    pointerEvents: "auto",
    fontSize: 14,
  };
}

export function EditorDialog({
  date,
  onClose,
  onSave,
  theme,
  getToken,
  baseUrl,
  existingEntry,
  dayEntries,
}: {
  date: string;
  onClose: () => void;
  onSave: () => void;
  theme: ThemeMode;
  getToken: () => Promise<string | null>;
  baseUrl: string;
  existingEntry?: CalendarEntry;
  dayEntries: CalendarEntry[];
}) {
  const c = PALETTE[theme];
  const t = useT();
  const [status, setStatus] = useState<"available" | "unavailable" | "tentative">(existingEntry?.status || "available");
  const [allDay, setAllDay] = useState(existingEntry ? existingEntry.allDay : true);
  const existingStartTime = existingEntry && !existingEntry.allDay ? localTimeOnly(existingEntry.startAt) : "08:00";
  const existingEndTime = existingEntry && !existingEntry.allDay ? localTimeOnly(existingEntry.endAt) : "17:00";
  const [startAt, setStartAt] = useState(existingStartTime);
  const [endAt, setEndAt] = useState(existingEndTime);
  const [note, setNote] = useState(existingEntry?.note || "");
  const [recurrence, setRecurrence] = useState("none");
  const [until, setUntil] = useState("");
  
  const locale = document.documentElement.lang === "en" ? "en-GB" : "nb-NO";
  const formattedDate = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(localDateTime(date, "12:00") ?? new Date(date));

  const handleClear = async () => {
    if (!existingEntry) {
      onClose();
      return;
    }
    if (!window.confirm(t("portal.availability.editor.deleteConfirm"))) return;
    
    if (existingEntry.virtual) {
      const token = await getToken();
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const startLocal = `${date}T00:00:00`;
      const endLocalObj = new Date(date);
      endLocalObj.setDate(endLocalObj.getDate() + 1);
      const endLocal = `${endLocalObj.getFullYear()}-${String(endLocalObj.getMonth() + 1).padStart(2, '0')}-${String(endLocalObj.getDate()).padStart(2, '0')}T00:00:00`;
      const rangeStart = new Date(startLocal).toISOString();
      const rangeEnd = new Date(endLocal).toISOString();
      
      const res = await fetch(`${baseUrl}api/portal/calendar/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rangeStart, rangeEnd, entries: [] })
      });
      if (!res.ok) {
        toast.error(
          await responseError(res, t("portal.availability.toast.clearFailed")),
        );
        return;
      }
      toast.success(t("portal.availability.toast.cleared"));
      onSave();
      onClose();
      return;
    }
    const token = await getToken();
    const res = await fetch(`${baseUrl}api/portal/calendar/availability/${existingEntry.ruleId || existingEntry.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      toast.error(
        await responseError(res, t("portal.availability.toast.clearFailed")),
      );
      return;
    }
    toast.success(t("portal.availability.toast.cleared"));
    onSave();
    onClose();
  };

  const handleSave = async () => {
    const token = await getToken();
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const startLocal = localDateTime(date, allDay ? "00:00" : startAt);
    let endLocal: Date | null;
    if (allDay) {
      endLocal = localDateTime(date, "00:00");
      endLocal?.setDate(endLocal.getDate() + 1);
    } else {
      endLocal = localDateTime(date, endAt);
    }
    if (!startLocal || !endLocal) {
      toast.error(t("portal.availability.editor.invalidTime"));
      return;
    }
    if (endLocal <= startLocal) {
      toast.error(t("portal.availability.editor.endBeforeStart"));
      return;
    }
    const startsAt = startLocal.toISOString();
    const endsAt = endLocal.toISOString();

    const body: any = {
      status,
      startsAt,
      endsAt,
      timezone: tz,
      allDay,
      privateNote: note
    };

    if (recurrence === "weekly" && until) {
      const [y, m, d] = date.split("-").map(Number);
      const localDate = new Date(y, m - 1, d);
      const weekday = localDate.getDay();
      const untilLocal = localDateTime(until, "23:59");
      if (!untilLocal) {
        toast.error(t("portal.availability.editor.invalidRecurrenceEnd"));
        return;
      }
      const untilIso = untilLocal.toISOString();

      body.recurrence = { type: "weekly", days: [weekday], until: untilIso };
      body.weekday = weekday;
      body.startMinute = allDay
        ? 0
        : parseInt(startAt.split(":")[0] || "0") * 60 + parseInt(startAt.split(":")[1] || "0");
      body.endMinute = allDay
        ? 1440
        : parseInt(endAt.split(":")[0] || "0") * 60 + parseInt(endAt.split(":")[1] || "0");
      body.until = untilIso;
    }

    let res: Response;
    if (recurrence === "weekly" && until) {
      res = await fetch(`${baseUrl}api/portal/calendar/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } else {
      const dayStartLocal = localDateTime(date, "00:00");
      if (!dayStartLocal) {
        toast.error(t("portal.availability.editor.invalidTime"));
        return;
      }
      const dayEndLocal = new Date(dayStartLocal);
      dayEndLocal.setDate(dayEndLocal.getDate() + 1);
      const dayStart = dayStartLocal.toISOString();
      const dayEnd = dayEndLocal.toISOString();
      const replacementEntry: CalendarEntry = {
        id: `replacement-${startsAt}-${endsAt}`,
        status,
        startAt: startsAt,
        endAt: endsAt,
        allDay,
        note,
      };
      const replacementEntries = buildDayAvailabilityReplacement(
        dayEntries,
        dayStart,
        dayEnd,
        replacementEntry,
        existingEntry && !existingEntry.allDay ? existingEntry.id : undefined,
      );
      res = await fetch(`${baseUrl}api/portal/calendar/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          rangeStart: dayStart,
          rangeEnd: dayEnd,
          entries: replacementEntries.map((entry) => ({
            status: entry.status,
            startsAt: entry.startAt,
            endsAt: entry.endAt,
            timezone: tz,
            allDay: entry.allDay,
            privateNote: entry.note || "",
          })),
        }),
      });
    }

    if (!res.ok) {
      toast.error(
        await responseError(res, t("portal.availability.toast.updateFailed")),
      );
      return;
    }

    toast.success(t("portal.availability.toast.updated"));
    onSave();
    onClose();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.5)", padding: 20 }}>
      <div style={{ background: c.cardBg, color: c.text, padding: 24, borderRadius: 12, width: "100%", maxWidth: 400, minWidth: "min(100vw - 32px, 320px)", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}>
        <h2 style={{ margin: "0 0 6px" }}>{t("portal.availability.editor.title")}</h2>
        <div style={{ marginBottom: 20, color: c.muted, fontSize: 14 }}>
          {formattedDate}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {(["available", "unavailable", "tentative"] as const).map(s => (
            <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} style={{ flex: 1, padding: "8px", textTransform: "capitalize", borderRadius: 8, border: `1px solid ${status === s ? c.accent : c.border}`, background: status === s ? c.cardBgSubtle : "transparent", color: c.text, cursor: "pointer", fontWeight: status === s ? "bold" : "normal" }}>
              {s === "available" ? t("portal.availability.legend.available") : s === "unavailable" ? t("portal.availability.legend.unavailable") : t("portal.availability.legend.tentative")}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gap: 12, margin: "8px 0 16px" }}>
          <div role="group" aria-label={t("portal.availability.editor.timeMode")} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" onClick={() => setAllDay(true)} aria-pressed={allDay} style={{ ...inputStyle(theme), cursor: "pointer", fontWeight: allDay ? 700 : 400, borderColor: allDay ? c.accent : c.border }}>
              {t("portal.availability.editor.allDay")}
            </button>
            <button type="button" onClick={() => setAllDay(false)} aria-pressed={!allDay} style={{ ...inputStyle(theme), cursor: "pointer", fontWeight: !allDay ? 700 : 400, borderColor: !allDay ? c.accent : c.border }}>
              {t("portal.availability.editor.specificTime")}
            </button>
          </div>

          {!allDay && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <label style={{ minWidth: 0, fontSize: 12, color: c.muted }}>
                {t("portal.availability.editor.startTime")}
                <input className="availability-time-input" type="time" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={{ ...timeInputStyle(theme), width: "100%", marginTop: 4 }} />
              </label>
              <label style={{ minWidth: 0, fontSize: 12, color: c.muted }}>
                {t("portal.availability.editor.endTime")}
                <input className="availability-time-input" type="time" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={{ ...timeInputStyle(theme), width: "100%", marginTop: 4 }} />
              </label>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: c.muted }}>{t("portal.availability.editor.note")}</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...inputStyle(theme), width: "100%" }} placeholder={t("portal.availability.editor.notePlaceholder")} />
        </div>

        {!existingEntry && (
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 12, marginBottom: 4, color: c.muted }}>{t("portal.availability.editor.repeat")}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} style={inputStyle(theme)}>
                <option value="none">{t("portal.availability.editor.repeatNone")}</option>
                <option value="weekly">{t("portal.availability.editor.repeatWeekly")}</option>
              </select>
              {recurrence === "weekly" && (
                <label style={{ fontSize: 12, color: c.muted }}>
                  {t("portal.availability.editor.until")}
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={{ ...inputStyle(theme), display: "block", marginTop: 4 }} />
                </label>
              )}
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <button onClick={handleClear} style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${c.danger}`, color: c.danger, borderRadius: 8, cursor: "pointer", visibility: existingEntry ? "visible" : "hidden" }}>{t("portal.availability.editor.clear")}</button>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", background: "transparent", border: "none", color: c.muted, cursor: "pointer" }}>{t("portal.availability.editor.close")}</button>
            <button onClick={handleSave} style={{ padding: "8px 16px", background: c.accent, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: "bold" }}>{t("portal.availability.editor.save")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
