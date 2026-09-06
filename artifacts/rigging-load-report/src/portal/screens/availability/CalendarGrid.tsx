import React, { useCallback, useState, useRef, useMemo } from "react";
import { PALETTE, type ThemeMode } from "../../lib/portalTheme";
import { useT } from "../../../lib/i18n/I18nContext";
import type { CalendarEntry, ExternalBusy, CalendarHold } from "./types";
import {
  entryCoversLocalDay,
  overlapsLocalDay,
  localTimeOnly,
  isoDateOnly,
  getIsoWeekNumber,
} from "./utils";
import { Clock } from "lucide-react";

export function CalendarGrid({
  theme,
  cells,
  today,
  entries,
  externalBusy,
  holds,
  data,
  gigsOverlap,
  openEditor,
  onBulkAction,
  viewMode
}: {
  theme: ThemeMode;
  cells: { iso: string | null; day: number | null; date?: Date }[];
  today: Date;
  entries: CalendarEntry[];
  externalBusy: ExternalBusy[];
  holds: CalendarHold[];
  data: any;
  gigsOverlap: (iso: string) => boolean;
  openEditor: (iso: string, entry?: CalendarEntry) => void;
  onBulkAction: (startIso: string, endIso: string, status: "available" | "unavailable" | "clear") => void;
  viewMode: "month" | "week";
}) {
  const c = PALETTE[theme];
  const t = useT();

  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragCurrent, setDragCurrent] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ start: string; end: string } | null>(null);
  
  const handlePointerDown = (iso: string) => {
    setDragStart(iso);
    setDragCurrent(iso);
    setSelection(null);
  };

  const handlePointerEnter = (iso: string) => {
    if (dragStart) {
      setDragCurrent(iso);
    }
  };

  React.useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (dragStart && dragCurrent) {
        if (dragStart !== dragCurrent) {
          const d1 = new Date(dragStart);
          const d2 = new Date(dragCurrent);
          setSelection({
            start: d1 <= d2 ? dragStart : dragCurrent,
            end: d1 <= d2 ? dragCurrent : dragStart
          });
        }
        setDragStart(null);
        setDragCurrent(null);
      }
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, [dragStart, dragCurrent]);

  const handlePointerUp = (iso: string) => {
    if (dragStart) {
      if (dragStart === iso) {
        // A click opens the full-day / specific-time editor.
        openEditor(iso);
        setSelection(null);
      } else {
        // It's a drag
        const d1 = new Date(dragStart);
        const d2 = new Date(iso);
        if (d1 <= d2) {
          setSelection({ start: dragStart, end: iso });
        } else {
          setSelection({ start: iso, end: dragStart });
        }
      }
      setDragStart(null);
      setDragCurrent(null);
    }
  };

  const cancelSelection = () => {
    setSelection(null);
    setDragStart(null);
    setDragCurrent(null);
  };

  const applyBulk = (status: "available" | "unavailable" | "clear") => {
    if (selection) {
      onBulkAction(selection.start, selection.end, status);
      setSelection(null);
    }
  };

  const isSelected = (iso: string) => {
    if (selection) {
      const d = new Date(iso);
      return d >= new Date(selection.start) && d <= new Date(selection.end);
    }
    if (dragStart && dragCurrent) {
      const d1 = new Date(dragStart);
      const d2 = new Date(dragCurrent);
      const d = new Date(iso);
      const start = d1 <= d2 ? d1 : d2;
      const end = d1 <= d2 ? d2 : d1;
      return d >= start && d <= end;
    }
    return false;
  };

  const isSelectionStart = (iso: string) => {
    if (selection) return iso === selection.start;
    if (dragStart && dragCurrent) {
      const d1 = new Date(dragStart);
      const d2 = new Date(dragCurrent);
      return iso === isoDateOnly(d1 <= d2 ? d1 : d2);
    }
    return false;
  };

  const isSelectionEnd = (iso: string) => {
    if (selection) return iso === selection.end;
    if (dragStart && dragCurrent) {
      const d1 = new Date(dragStart);
      const d2 = new Date(dragCurrent);
      return iso === isoDateOnly(d1 <= d2 ? d2 : d1);
    }
    return false;
  };

  function entryTimeLabel(entry: CalendarEntry): string {
    return entry.allDay
      ? t("portal.availability.editor.allDay")
      : `${localTimeOnly(entry.startAt)}–${localTimeOnly(entry.endAt)}`;
  }

  const selectionCount = useMemo(() => {
    if (!selection) return 0;
    const start = new Date(selection.start);
    const end = new Date(selection.end);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }, [selection]);

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onPointerLeave={cancelSelection} onPointerCancel={cancelSelection}>
      <div style={{ display: "grid", gridTemplateColumns: "40px repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: c.muted, textAlign: "center", padding: "4px 0", textTransform: "uppercase" }} aria-hidden="true">
          {t("portal.availability.weekNumber" as any)}
        </div>
        {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((wk) => (
          <div key={wk} style={{ fontSize: 11, fontWeight: 700, color: c.muted, textAlign: "center", padding: "4px 0", textTransform: "uppercase" }}>
            {t(`portal.availability.weekday.${wk}` as any)}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "40px repeat(7, 1fr)", gridTemplateRows: viewMode === "month" ? `repeat(${Math.ceil(cells.length / 7)}, minmax(104px, auto))` : "minmax(120px, auto)", gap: 4, minHeight: 0 }}>
        {cells.map((cell, i) => {
          const isFirstOfWeek = i % 7 === 0;
          let weekNumberNode = null;
          if (isFirstOfWeek) {
            let refDate = cell.date;
            if (!refDate) {
               for (let j = i; j < i + 7; j++) {
                 if (cells[j]?.date) { refDate = cells[j].date; break; }
               }
            }
            const weekNumber = refDate ? getIsoWeekNumber(refDate) : "";
            weekNumberNode = (
              <div
                key={`week-${i}`}
                style={{ display: "flex", alignItems: "center", justifyContent: "center", color: c.muted, fontSize: 11, fontWeight: 700 }}
                aria-label={(t("portal.availability.weekNumberAria" as any) || "").replace("{week}", String(weekNumber))}
              >
                W{weekNumber}
              </div>
            );
          }

          if (!cell.iso) {
            return (
              <React.Fragment key={i}>
                {weekNumberNode}
                <div />
              </React.Fragment>
            );
          }

          const isToday = cell.iso === isoDateOnly(today);
          const dayEntries = entries.filter(e => overlapsLocalDay(e.startAt, e.endAt, cell.iso!));
          const dayBusy = externalBusy.filter(e => overlapsLocalDay(e.startAt, e.endAt, cell.iso!));
          const dayHolds = holds.filter(e => overlapsLocalDay(e.startAt, e.endAt, cell.iso!));

          const orderedDayEntries = [...dayEntries].sort((a, b) => {
            if (a.virtual !== b.virtual) return a.virtual ? 1 : -1;
            return (
              new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
            );
          });
          const availableEntries = orderedDayEntries.filter(
            (entry) => entry.status === "available",
          );
          const unavailableEntries = orderedDayEntries.filter(
            (entry) => entry.status === "unavailable",
          );
          const fullDayBusy = unavailableEntries.some((entry) =>
            entryCoversLocalDay(entry, cell.iso!),
          );
          const partialBusy =
            dayBusy.length === 0 &&
            unavailableEntries.length > 0 &&
            availableEntries.length > 0 &&
            !fullDayBusy;
          const visibleDayEntries = orderedDayEntries;

          let isAvailable =
            dayBusy.length === 0 &&
            !fullDayBusy &&
            availableEntries.length > 0;
          let isUnavailable = dayBusy.length > 0 || fullDayBusy;

          if (dayEntries.length === 0 && dayBusy.length === 0) {
            const localState = data.availability[cell.iso!];
            if (localState === "available") isAvailable = true;
            if (localState === "busy") isUnavailable = true;
          }

          const hasGig = gigsOverlap(cell.iso);

          let bg: string = c.cardBgSubtle;
          let color: string = c.text;
          if (isAvailable) {
            bg = "rgba(22, 163, 74, 0.15)";
          }
          if (isUnavailable) {
            bg = "rgba(220, 38, 38, 0.15)";
          }
          if (partialBusy) {
            bg =
              "linear-gradient(135deg, rgba(220, 38, 38, 0.16) 0 42%, rgba(22, 163, 74, 0.15) 42% 100%)";
          }
          if (dayHolds.length > 0) {
            bg = "rgba(245, 158, 11, 0.15)";
          }
          if (hasGig) {
            bg = "rgba(245, 158, 11, 0.15)";
          }

          const selected = isSelected(cell.iso);
          const selStart = isSelectionStart(cell.iso);
          const selEnd = isSelectionEnd(cell.iso);

          return (
            <React.Fragment key={i}>
              {weekNumberNode}
            <div
              role="button"
              tabIndex={0}
              aria-label={`${cell.iso}: ${isAvailable ? t("portal.availability.legend.available") : isUnavailable ? t("portal.availability.legend.unavailable") : t("portal.availability.legend.neutral")}`}
              aria-pressed={selected}
              aria-selected={selected}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                handlePointerDown(cell.iso!);
              }}
              onPointerEnter={() => handlePointerEnter(cell.iso!)}
              onPointerUp={() => handlePointerUp(cell.iso!)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openEditor(cell.iso!);
                }
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-start",
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 8,
                cursor: "pointer",
                background: bg,
                color: selected ? c.text : color,
                border: selected 
                  ? `2px solid ${c.accent}` 
                  : isToday ? `2px solid ${c.accent}` : `1px solid ${c.border}`,
                boxShadow: selected ? `0 0 0 2px ${c.cardBg} inset` : "none",
                position: "relative",
                userSelect: "none",
                transition: "background 100ms ease, border-color 100ms ease"
              }}
              className="availability-cell"
            >
              {/* Day Number */}
              <div className="availability-day-number">
                {cell.day}
              </div>

              {/* Explicit Edit Affordance */}
              <button
                className="availability-edit-btn"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  openEditor(cell.iso!);
                }}
                title={t("portal.availability.addTimeBlock") as string}
                aria-label={t("portal.availability.addTimeBlock") as string}
              >
                <Clock size={12} />
              </button>

              <div
                className="availability-cell-badges"
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                {visibleDayEntries.map((entry) => {
                  const key = entry.ruleId ? `${entry.ruleId}-${entry.startAt}` : entry.id;
                  const title = `${entryTimeLabel(entry)}${entry.note ? ` · ${entry.note}` : ""}`;
                  const statusLabel =
                    entry.status === "available"
                      ? t("portal.availability.legend.available")
                      : entry.status === "unavailable"
                        ? t("portal.availability.legend.unavailable")
                        : t("portal.availability.legend.tentative");
                  const ariaLabel = `${statusLabel}, ${entryTimeLabel(entry)}`;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`availability-time-badge availability-time-badge--${entry.status}`}
                      title={title}
                      aria-label={ariaLabel}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditor(cell.iso!, entry);
                      }}
                      style={{ cursor: "pointer", fontFamily: "inherit", textAlign: "left", margin: 0, appearance: "none" }}
                    >
                      <span className="availability-time-badge__dot" />
                      <span className="availability-time-badge__label">
                        {entry.allDay
                          ? statusLabel
                          : `${statusLabel} ${entryTimeLabel(entry)}`}
                      </span>
                    </button>
                  );
                })}
                {dayHolds.map((hold) => (
                  <span
                    key={hold.id}
                    className="availability-time-badge availability-time-badge--tentative"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title={`${t("portal.availability.legend.hold")} ${localTimeOnly(hold.startAt)}–${localTimeOnly(hold.endAt)}`}
                  >
                    <span className="availability-time-badge__dot" />
                    <span className="availability-time-badge__label">
                      {t("portal.availability.legend.hold")} {localTimeOnly(hold.startAt)}–{localTimeOnly(hold.endAt)}
                    </span>
                  </span>
                ))}
                {dayBusy.map((busy) => (
                  <span
                    key={busy.id}
                    className="availability-time-badge availability-time-badge--unavailable"
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title={`${localTimeOnly(busy.startAt)}–${localTimeOnly(busy.endAt)}`}
                  >
                    <span className="availability-time-badge__dot" />
                    <span className="availability-time-badge__label">
                      {localTimeOnly(busy.startAt)}–{localTimeOnly(busy.endAt)}
                    </span>
                  </span>
                ))}
                {hasGig ? (
                  <span className="availability-time-badge availability-time-badge--gig" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                    <span className="availability-time-badge__dot" />
                    <span className="availability-time-badge__label">
                      {t("portal.availability.legend.gig")}
                    </span>
                  </span>
                ) : null}
              </div>
            </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Sticky Range Action Bar */}
      {selection && (
        <div style={{
          position: "sticky",
          bottom: 20,
          zIndex: 50,
          display: "flex",
          justifyContent: "center",
          pointerEvents: "none",
          width: "100%",
          marginTop: 16
        }}>
          <div style={{
            display: "inline-flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "10px 16px",
            background: c.cardBg,
            border: `1px solid ${c.border}`,
            borderRadius: 999,
            boxShadow: "0 12px 32px rgba(0,0,0,0.2)",
            pointerEvents: "auto",
            maxWidth: "calc(100vw - 32px)"
          }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: c.text }}>
            {t("portal.availability.selection.title").replace("{count}", selectionCount.toString())}
          </span>
          <div style={{ width: 1, height: 24, background: c.border }}></div>
          <button
            onClick={() => applyBulk("available")}
            className="availability-toggle availability-toggle--available"
          >
            <span className="availability-toggle__dot" style={{ color: "#16a34a" }} />
            {t("portal.availability.selection.available")}
          </button>
          <button
            onClick={() => applyBulk("unavailable")}
            className="availability-toggle availability-toggle--busy"
          >
            <span className="availability-toggle__dot" style={{ color: "#dc2626" }} />
            {t("portal.availability.selection.busy")}
          </button>
          <button
            onClick={() => applyBulk("clear")}
            className="availability-toggle"
            style={{ background: "transparent", border: `1px solid ${c.border}` }}
          >
            {t("portal.availability.selection.clear")}
          </button>
          <button
            onClick={cancelSelection}
            style={{ marginLeft: 8, padding: "8px", background: "transparent", border: "none", color: c.muted, cursor: "pointer", fontSize: 13, fontWeight: 700 }}
          >
            {t("portal.availability.selection.cancel")}
          </button>
          </div>
        </div>
      )}

      <style>{`
        .availability-cell:focus-visible {
          outline: 2px solid ${c.accent};
          outline-offset: 2px;
        }
        .availability-cell {
          padding: 8px 3px 3px;
        }
        .availability-day-number {
          position: absolute;
          top: 7px;
          left: 7px;
          z-index: 3;
          min-width: 16px;
          font-size: 13px;
          line-height: 18px;
          font-weight: 800;
          text-align: left;
          pointer-events: none;
        }
        .availability-edit-btn {
          position: absolute;
          top: 4px;
          right: 4px;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          background: ${c.cardBgSubtle};
          border: 1px solid ${c.border};
          color: ${c.text};
          cursor: pointer;
          opacity: 1;
          transition: background 150ms ease, color 150ms ease;
          z-index: 10;
        }
        .availability-edit-btn:hover {
          background: ${c.border};
          color: ${c.text};
        }
        @media (max-width: 520px) {
          .availability-cell {
            padding: 5px 2px 2px;
          }
          .availability-day-number {
            top: 4px;
            left: 4px;
            min-width: 13px;
            font-size: 11px;
            line-height: 18px;
          }
          .availability-edit-btn {
            top: 23px;
            right: 3px;
            width: 18px;
            height: 18px;
            border-radius: 5px;
          }
        }
        
      `}</style>
    </div>
  );
}
