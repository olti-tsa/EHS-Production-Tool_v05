import React, { useState, useMemo, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, MapPin, Users, Briefcase, X } from "lucide-react";
import { format, addMonths, subMonths, addWeeks, subWeeks, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO, startOfDay, differenceInCalendarDays, endOfDay } from "date-fns";
import { nb } from "date-fns/locale";
import * as HoverCard from "@radix-ui/react-hover-card";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { useI18n, useT } from "../../lib/i18n/I18nContext";
import { subscribeCrewResponses } from "../../lib/crewResponseEvents";

export type CalendarProject = {
  id: string;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  easyjob_number: string | null;
  crewCount: number | null;
  confirmedCrewCount?: number | null;
  status: string | null;
  venue?: string | null;
  client?: string | null;
  category?: string | null;
  type?: string | null;
  projectType?: string | null;
  data?: {
    eventCategory?: string;
  } | null;
};

interface Props {
  getToken: () => Promise<string | null>;
  onOpenProject: (id: string) => void;
}

export type CalendarTranslationKey =
  | "calendar.project.genericCategory"
  | "calendar.quickAdd.error"
  | "calendar.quickAdd.validation.details"
  | "calendar.quickAdd.validation.dates"
  | "calendar.quickAdd.validation.endBeforeStart";
export type CalendarTranslation = (key: CalendarTranslationKey) => string;

type CalendarProjectInput = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normaliseDate(value: unknown): string | null {
  return isValidCalendarDate(value) ? value : null;
}

export function normalizeCalendarProject(value: unknown): CalendarProject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as CalendarProjectInput;
  const id = nonEmptyString(raw.id);
  if (!id) return null;
  const rawData = raw.data;
  const data = rawData && typeof rawData === "object" && !Array.isArray(rawData)
    ? rawData as Record<string, unknown>
    : null;
  return {
    id, name: nonEmptyString(raw.name),
    startDate: normaliseDate(raw.startDate) ?? normaliseDate(data?.reportDate),
    endDate: normaliseDate(raw.endDate) ?? normaliseDate(data?.reportEndDate),
    easyjob_number: nonEmptyString(raw.easyjob_number),
    crewCount: typeof raw.crewCount === "number" && Number.isFinite(raw.crewCount) ? raw.crewCount : null,
    confirmedCrewCount: typeof raw.confirmedCrewCount === "number" && Number.isFinite(raw.confirmedCrewCount)
      ? Math.max(0, Math.floor(raw.confirmedCrewCount)) : null,
    status: nonEmptyString(raw.status), venue: nonEmptyString(raw.venue), client: nonEmptyString(raw.client),
    category: nonEmptyString(raw.category) ?? nonEmptyString(data?.eventCategory),
    type: nonEmptyString(raw.type) ?? nonEmptyString(raw.projectType) ?? nonEmptyString(data?.projectType) ?? nonEmptyString(data?.type),
  };
}

export function getProjectTitle(p: CalendarProject, t: CalendarTranslation) {
  const name = nonEmptyString(p.name);
  if (name) return name;
  const category = nonEmptyString(p.category) ?? nonEmptyString(p.type) ??
    nonEmptyString(p.projectType) ?? nonEmptyString(p.data?.eventCategory) ??
    t("calendar.project.genericCategory");
  const location = nonEmptyString(p.venue) ?? nonEmptyString(p.client);
  return location ? `${category} // ${location}` : category;
}

function calendarDate(value: string | null): Date | null {
  if (!isValidCalendarDate(value)) return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

export function getLanesForWeek(weekDays: Date[], projects: CalendarProject[]) {
  if (weekDays.length !== 7) return [];
  const weekStart = startOfDay(weekDays[0]);
  const weekEnd = endOfDay(weekDays[6]);

  const overlapping = projects.filter(p => {
    const pStart = calendarDate(p.startDate);
    if (!pStart) return false;
    const end = calendarDate(p.endDate);
    const pEnd = end && end >= pStart ? end : pStart;
    return pStart <= weekEnd && pEnd >= weekStart;
  });

  overlapping.sort((a, b) => {
    const aStart = Math.max(calendarDate(a.startDate)?.getTime() ?? weekStart.getTime(), weekStart.getTime());
    const bStart = Math.max(calendarDate(b.startDate)?.getTime() ?? weekStart.getTime(), weekStart.getTime());
    if (aStart !== bStart) return aStart - bStart;

    const aEnd = Math.min((calendarDate(a.endDate) ?? calendarDate(a.startDate) ?? weekStart).getTime(), weekEnd.getTime());
    const bEnd = Math.min((calendarDate(b.endDate) ?? calendarDate(b.startDate) ?? weekStart).getTime(), weekEnd.getTime());
    return (bEnd - bStart) - (aEnd - aStart);
  });

  const lanes: boolean[][] = [];
  const result = [];

  for (const p of overlapping) {
    const pStart = calendarDate(p.startDate);
    if (!pStart) continue;
    const rawEnd = calendarDate(p.endDate);
    const pEnd = rawEnd && rawEnd >= pStart ? rawEnd : pStart;

    const startIdx = Math.max(0, differenceInCalendarDays(pStart, weekStart));
    const endIdx = Math.min(6, differenceInCalendarDays(pEnd, weekStart));

    const isClippedLeft = pStart < weekStart;
    const isClippedRight = pEnd > weekEnd;
    const span = endIdx - startIdx + 1;

    let lane = 0;
    while (true) {
      if (!lanes[lane]) lanes[lane] = [false, false, false, false, false, false, false];
      let free = true;
      for (let i = startIdx; i <= endIdx; i++) {
        if (lanes[lane][i]) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let i = startIdx; i <= endIdx; i++) {
          lanes[lane][i] = true;
        }
        break;
      }
      lane++;
    }

    result.push({
      project: p,
      lane,
      startIdx,
      span,
      isClippedLeft,
      isClippedRight
    });
  }

  return result;
}

export function MasterCalendarPage({ getToken, onOpenProject }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [projects, setProjects] = useState<CalendarProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week">("month");

  // Quick Add Drawer State
  const [quickAddDate, setQuickAddDate] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);
  const venueRef = useRef<HTMLInputElement>(null);
  const clientRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let mounted = true;
    let fetching = false;
    let refreshQueued = false;
    const fetchProjects = async () => {
      if (fetching) { refreshQueued = true; return; }
      fetching = true;
      try {
        const token = await getToken();
        const baseUrl =
          (typeof import.meta !== "undefined" &&
            (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
          "/";
        const res = await fetch(`${baseUrl}api/projects`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(t("calendar.error.load"));
        const json: unknown = await res.json();
        if (mounted) {
          if (!isRecord(json) || json.ok !== true) {
            throw new Error(isRecord(json) && typeof json.error === "string" ? json.error : t("calendar.error.load"));
          }
          const received = Array.isArray(json.projects) ? json.projects : [];
          setProjects(received.map(normalizeCalendarProject).filter((project): project is CalendarProject => project !== null));
          setError(null);
        }
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : t("calendar.error.load"));
      } finally {
        fetching = false;
        if (mounted) setLoading(false);
        if (mounted && refreshQueued) {
          refreshQueued = false;
          void fetchProjects();
        }
      }
    };
    void fetchProjects();
    const unsubscribe = subscribeCrewResponses(getToken, () => { void fetchProjects(); });
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void fetchProjects();
    }, 15_000);
    return () => {
      mounted = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [getToken, t]);

  const handlePrevious = () => {
    setCurrentDate(prev => view === "month" ? subMonths(prev, 1) : subWeeks(prev, 1));
  };
  const handleNext = () => {
    setCurrentDate(prev => view === "month" ? addMonths(prev, 1) : addWeeks(prev, 1));
  };
  const handleToday = () => setCurrentDate(new Date());

  const { scheduled, unscheduled } = useMemo(() => {
    const s: CalendarProject[] = [];
    const u: CalendarProject[] = [];
    for (const p of projects) {
      if (isValidCalendarDate(p.startDate)) s.push(p);
      else u.push(p);
    }
    return { scheduled: s, unscheduled: u };
  }, [projects]);

  const weeks = useMemo(() => {
    if (view === "month") {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const start = startOfWeek(monthStart, { weekStartsOn: 1 });
      const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
      const allDays = eachDayOfInterval({ start, end });
      const weekList = [];
      for (let i = 0; i < allDays.length; i += 7) {
        weekList.push(allDays.slice(i, i + 7));
      }
      return weekList;
    } else {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfWeek(currentDate, { weekStartsOn: 1 });
      return [eachDayOfInterval({ start, end })];
    }
  }, [currentDate, view]);

  const openQuickAdd = (date: Date) => {
    setQuickAddDate(date);
  };

  const handleQuickAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddDate) return;
    setSaving(true);
    try {
      const token = await getToken();
      const baseUrl =
        (typeof import.meta !== "undefined" &&
          (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
        "/";
      const name = titleRef.current?.value.trim() ?? "";
      const category = categoryRef.current?.value.trim() ?? "";
      const venue = venueRef.current?.value.trim() ?? "";
      const client = clientRef.current?.value.trim() ?? "";
      const startDate = startRef.current?.value ?? "";
      const endDate = endRef.current?.value ?? "";
      if (!category || (!venue && !client)) {
        throw new Error(t("calendar.quickAdd.validation.details"));
      }
      if (!isValidCalendarDate(startDate) || !isValidCalendarDate(endDate)) {
        throw new Error(t("calendar.quickAdd.validation.dates"));
      }
      if (endDate < startDate) {
        throw new Error(t("calendar.quickAdd.validation.endBeforeStart"));
      }
      const payload = {
        name,
        venue,
        client,
        data: {
          eventCategory: category,
          reportDate: startDate,
          reportEndDate: endDate
        }
      };

      const res = await fetch(`${baseUrl}api/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(t("calendar.quickAdd.error"));
      const json: unknown = await res.json();
      if (!isRecord(json) || json.ok !== true) {
        throw new Error(isRecord(json) && typeof json.error === "string" ? json.error : t("calendar.quickAdd.error"));
      }
      const created = normalizeCalendarProject(json.project);
      if (!created) throw new Error(t("calendar.quickAdd.error"));
      setProjects(prev => [...prev, created]);
      setQuickAddDate(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : t("calendar.quickAdd.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "0 16px 40px", maxWidth: 1400, margin: "0 auto", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
        <div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 300, margin: "0 0 8px 0", color: "var(--text-main)" }}>
            {t("calendar.title")}
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
            {t("calendar.subtitle")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="theme-seg">
            <button aria-label={t("calendar.action.month")} className={`theme-seg-btn ${view === "month" ? "is-selected" : ""}`} style={{ maxWidth: 140, opacity: 1, padding: "6px 12px" }} onClick={() => setView("month")}>{t("calendar.action.month")}</button>
            <button aria-label={t("calendar.action.week")} className={`theme-seg-btn ${view === "week" ? "is-selected" : ""}`} style={{ maxWidth: 140, opacity: 1, padding: "6px 12px" }} onClick={() => setView("week")}>{t("calendar.action.week")}</button>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button aria-label={t("calendar.action.previous")} type="button" className="ehs-shell-icon-btn" onClick={handlePrevious}><ChevronLeft size={16} /></button>
            <button type="button" className="btn-pill" style={{ background: "var(--input-bg)", color: "var(--text-main)", border: "1px solid var(--border-color)", padding: "0 12px" }} onClick={handleToday}>{t("calendar.action.today")}</button>
            <button aria-label={t("calendar.action.next")} type="button" className="ehs-shell-icon-btn" onClick={handleNext}><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      <h3 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 16px", color: "var(--text-main)" }}>
         {view === "week" ? `${t("calendar.weekOf")} ${format(currentDate, "MMMM d, yyyy", { locale: locale === "no" ? nb : undefined })}` : format(currentDate, "MMMM yyyy", { locale: locale === "no" ? nb : undefined })}
      </h3>

      {loading ? (
         <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>{t("calendar.loading")}</div>
      ) : error ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--danger)", fontSize: 14 }}>{error}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1, minHeight: 0 }}>
          <div style={{ 
            display: "flex",
            flexDirection: "column",
            border: "1px solid var(--border-color)", 
            borderRadius: 12, 
            overflow: "hidden", 
            background: "var(--card-bg)",
            flex: 1
          }}>
            {/* Header Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", background: "var(--input-bg)", borderBottom: "1px solid var(--border-color)" }}>
               {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d, i) => (
                <div key={i} style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", textAlign: "center", borderRight: i < 6 ? "1px solid var(--border-color)" : "none" }}>
                   {t(`calendar.days.${d}`)}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              {weeks.map((weekDays, wIdx) => {
                const weekLanes = getLanesForWeek(weekDays, scheduled);

                const moreProjectsPerDay: CalendarProject[][] = [[], [], [], [], [], [], []];
                const allProjectsPerDay: CalendarProject[][] = [[], [], [], [], [], [], []];

                for (const r of weekLanes) {
                  for (let i = r.startIdx; i < r.startIdx + r.span; i++) {
                    allProjectsPerDay[i].push(r.project);
                    if (r.lane >= 3) {
                      moreProjectsPerDay[i].push(r.project);
                    }
                  }
                }

                return (
                  <div key={wIdx} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', flex: view === "month" ? 1 : "auto", minHeight: view === "month" ? 120 : 400, position: 'relative', borderBottom: wIdx < weeks.length - 1 ? "1px solid var(--border-color)" : "none" }}>
                    {/* Day cells */}
                    {weekDays.map((day, dIdx) => {
                      const isToday = isSameDay(day, new Date());
                      const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                      return (
                        <div
                           key={day.toISOString()}
                           onClick={() => openQuickAdd(day)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openQuickAdd(day);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={t("calendar.quickAdd.openForDate", { date: format(day, "yyyy-MM-dd") })}
                           style={{
                             borderRight: dIdx < 6 ? "1px solid var(--border-color)" : "none",
                             background: !isCurrentMonth ? "rgba(0,0,0,0.02)" : "transparent",
                             padding: 8,
                             cursor: "pointer",
                             display: 'flex', flexDirection: 'column'
                           }}
                        >
                           <div style={{
                             fontSize: 13,
                             fontWeight: isToday ? 800 : 500,
                             color: isToday ? "var(--primary)" : isCurrentMonth ? "var(--text-main)" : "var(--text-muted)",
                             marginBottom: 4,
                             display: "flex",
                             justifyContent: "center",
                             alignItems: "center",
                             width: 24,
                             height: 24,
                             borderRadius: "50%",
                             background: isToday ? "var(--primary-soft)" : "transparent",
                             margin: "0 auto 4px"
                           }}>
                             {format(day, "d")}
                           </div>
                           <div style={{ height: 3 * 22 + 4 }} />
                           {moreProjectsPerDay[dIdx].length > 0 && (
                              <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ marginTop: 'auto' }}>
                                <Popover.Root>
                                  <Popover.Trigger asChild>
                                    <button style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'center', padding: '2px 4px', borderRadius: 4, width: '100%' }}>
                                       {t("calendar.project.moreEvents", { count: moreProjectsPerDay[dIdx].length })}
                                    </button>
                                  </Popover.Trigger>
                                  <Popover.Portal>
                                     <Popover.Content onClick={(e) => e.stopPropagation()} side="bottom" align="center" sideOffset={5} style={{ zIndex: 1050, width: 240, background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', animation: 'fadeIn 0.15s ease-out' }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                                          {format(day, "d. MMMM", { locale: locale === "no" ? nb : undefined })}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                          {allProjectsPerDay[dIdx].map(p => (
                                             <ProjectPopover key={p.id} project={p} onOpenProject={onOpenProject} compact t={t} />
                                          ))}
                                        </div>
                                     </Popover.Content>
                                  </Popover.Portal>
                                </Popover.Root>
                              </div>
                           )}
                        </div>
                      );
                    })}

                    {/* Spanning project bars */}
                    <div style={{ position: 'absolute', top: 36, left: 0, right: 0, height: 3 * 22, pointerEvents: 'none' }}>
                      {weekLanes.filter(r => r.lane < 3).map(r => {
                         const leftPct = (r.startIdx / 7) * 100;
                         const widthPct = (r.span / 7) * 100;
                         const topPx = r.lane * 22;
                         return (
                           <div key={r.project.id} style={{
                              position: 'absolute',
                              top: topPx,
                              left: r.isClippedLeft ? `${leftPct}%` : `calc(${leftPct}% + 4px)`,
                              width: `calc(${widthPct}% - ${(r.isClippedLeft ? 0 : 4) + (r.isClippedRight ? 0 : 4)}px)`,
                              height: 18,
                              pointerEvents: 'auto'
                           }}>
                              <ProjectPopover project={r.project} onOpenProject={onOpenProject} t={t} isClippedLeft={r.isClippedLeft} isClippedRight={r.isClippedRight} />
                           </div>
                         );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {unscheduled.length > 0 && (
            <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 12, padding: 16 }}>
               <h4 style={{ margin: "0 0 12px", fontSize: 14, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{t("calendar.unscheduledProjects")}</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {unscheduled.map(p => (
                   <ProjectPopover key={p.id} project={p} onOpenProject={onOpenProject} compact t={t} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Add Drawer */}
      <Dialog.Root open={!!quickAddDate} onOpenChange={(open) => !open && setQuickAddDate(null)}>
        <Dialog.Portal>
          <Dialog.Overlay style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, animation: "fadeIn 0.15s ease-out" }} />
          <Dialog.Content className="calendar-drawer" onClick={(e) => e.stopPropagation()} style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "100%", maxWidth: 400, background: "var(--card-bg)", zIndex: 1001, padding: "32px 24px", boxShadow: "-8px 0 32px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column", overflowY: "auto", borderLeft: "1px solid var(--border-color)", animation: "slideInRight 0.2s ease-out" }}>
            <div className="calendar-drawer-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <Dialog.Title style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text-main)" }}>
                {t("calendar.quickAdd.title")}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="ehs-shell-icon-btn" aria-label={t("calendar.quickAdd.close")}>
                  <X size={18} />
                </button>
              </Dialog.Close>
            </div>
            {quickAddDate && (
              <Dialog.Description style={{ margin: "-12px 0 20px", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
                {t("calendar.quickAdd.description", {
                  date: format(quickAddDate, "PPP", { locale: locale === "no" ? nb : undefined }),
                })}
              </Dialog.Description>
            )}

            {quickAddDate && (
              <form className="calendar-quick-add-form" onSubmit={handleQuickAddSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="meta-field" style={{ background: "var(--input-bg)" }}>
                  <label>{t("calendar.quickAdd.projectName")}</label>
                  <input type="text" ref={titleRef} placeholder={t("calendar.quickAdd.projectNamePlaceholder")} />
                </div>
                <div className="meta-field" style={{ background: "var(--input-bg)" }}>
                  <label>{t("calendar.quickAdd.category")}</label>
                  <input type="text" ref={categoryRef} placeholder={t("calendar.quickAdd.categoryPlaceholder")} required />
                </div>
                <div className="meta-field" style={{ background: "var(--input-bg)" }}>
                  <label>{t("calendar.quickAdd.venue")}</label>
                  <input type="text" ref={venueRef} placeholder={t("calendar.quickAdd.venuePlaceholder")} />
                </div>
                <div className="meta-field" style={{ background: "var(--input-bg)" }}>
                  <label>{t("calendar.quickAdd.client")}</label>
                  <input type="text" ref={clientRef} placeholder={t("calendar.quickAdd.clientPlaceholder")} />
                </div>
                <div className="calendar-quick-add-dates" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div className="meta-field" style={{ background: "var(--input-bg)" }}>
                    <label>{t("calendar.quickAdd.start")}</label>
                    <input type="date" ref={startRef} defaultValue={format(quickAddDate, "yyyy-MM-dd")} required />
                  </div>
                  <div className="meta-field" style={{ background: "var(--input-bg)" }}>
                    <label>{t("calendar.quickAdd.end")}</label>
                    <input type="date" ref={endRef} defaultValue={format(quickAddDate, "yyyy-MM-dd")} required />
                  </div>
                </div>
                <div style={{ marginTop: 24, display: "flex", gap: 12, justifyContent: "flex-end" }}>
                  <Dialog.Close asChild>
                    <button type="button" className="btn-pill" style={{ color: "var(--text-main)", background: "transparent", border: "1px solid var(--border-color)" }}>
                      {t("calendar.quickAdd.cancel")}
                    </button>
                  </Dialog.Close>
                  <button type="submit" disabled={saving} className="btn-pill" style={{ background: "var(--primary)", color: "#000", border: "1px solid var(--primary)" }}>
                    {saving ? t("calendar.quickAdd.creating") : t("calendar.quickAdd.save")}
                  </button>
                </div>
              </form>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

    </div>
  );
}

function ProjectPopover({ project, onOpenProject, compact, isClippedLeft, isClippedRight, t }: { project: CalendarProject, onOpenProject: (id: string) => void, compact?: boolean, isClippedLeft?: boolean, isClippedRight?: boolean, t: ReturnType<typeof useT> }) {
  const end = project.endDate || project.startDate;
  const completed = Boolean(end && end < format(new Date(), "yyyy-MM-dd"));
  const displayStatus = completed ? "completed" : project.status || "draft";
  const isConfirmed = displayStatus === "active" || displayStatus === "confirmed";
  const isArchived = displayStatus === "archived" || displayStatus === "completed";
  const durationDays = (() => {
    if (!project.startDate) return null;
    try {
      const start = startOfDay(parseISO(project.startDate));
      const finish = startOfDay(parseISO(project.endDate || project.startDate));
      const days = differenceInCalendarDays(finish, start) + 1;
      return Number.isFinite(days) && days > 0 ? days : 1;
    } catch {
      return null;
    }
  })();
  
  const bg = isConfirmed ? "rgba(16, 185, 129, 0.1)" : isArchived ? "rgba(148, 163, 184, 0.1)" : "var(--primary-soft)";
  const color = isConfirmed ? "var(--success)" : isArchived ? "var(--text-muted)" : "var(--primary)";
  const border = isConfirmed ? "1px solid rgba(16, 185, 129, 0.2)" : isArchived ? "1px solid rgba(148, 163, 184, 0.2)" : "1px solid rgba(248, 128, 0, 0.2)";

  const borderRadius = compact ? 4 : `${isClippedLeft ? 0 : 4}px ${isClippedRight ? 0 : 4}px ${isClippedRight ? 0 : 4}px ${isClippedLeft ? 0 : 4}px`;
  const title = getProjectTitle(project, t);
  const statusLabels = {
    active: "calendar.status.active",
    confirmed: "calendar.status.confirmed",
    archived: "calendar.status.archived",
    completed: "calendar.status.completed",
    canceled: "calendar.status.canceled",
    draft: "calendar.status.draft",
  } as const;

  return (
    <HoverCard.Root openDelay={200} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <button 
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenProject(project.id);
          }}
          style={{
            display: "block",
            width: compact ? "auto" : "100%",
            height: compact ? "auto" : "100%",
            textAlign: "left",
            padding: compact ? "4px 8px" : "0 6px",
            fontSize: 10.5,
            fontWeight: 700,
            borderRadius: borderRadius,
            background: bg,
            color: color,
            border: border,
            borderLeft: (!compact && isClippedLeft) ? "none" : border,
            borderRight: (!compact && isClippedRight) ? "none" : border,
            cursor: "pointer",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "all 0.15s ease",
            lineHeight: compact ? "1.2" : "16px"
          }}
        >
           {title}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content 
          sideOffset={5} 
          style={{ 
            zIndex: 1060,
            background: "var(--card-bg)", 
            border: "1px solid var(--border-color)", 
            borderRadius: 12, 
            padding: 16, 
            width: 320,
            boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
            color: "var(--text-main)",
            animation: "fadeIn 0.15s ease-out",
            pointerEvents: "none"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
             <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, paddingRight: 16 }}>{title}</h4>
            <span style={{ 
              fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, 
              padding: "4px 8px", borderRadius: 999, background: bg, color: color, border: border,
              flexShrink: 0
            }}>
               {t(statusLabels[displayStatus as keyof typeof statusLabels] ?? statusLabels.draft)}
            </span>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            {project.startDate && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
                <CalendarIcon size={14} />
                 <span>{project.startDate}{project.endDate && project.endDate !== project.startDate ? ` ${t("calendar.project.to")} ${project.endDate}` : ""}{durationDays ? ` · ${durationDays} ${durationDays === 1 ? t("calendar.project.day") : t("calendar.project.days")}` : ""}</span>
              </div>
            )}
            {(project.venue || project.client) && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
                <MapPin size={14} />
                <span>{[project.venue, project.client].filter(Boolean).join(" / ")}</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
              <Briefcase size={14} />
               <span>{project.easyjob_number ? `${t("calendar.project.easyJob")}: ${project.easyjob_number}` : t("calendar.project.noEasyJob")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
              <Users size={14} />
                <span>{project.confirmedCrewCount == null
                  ? `${project.crewCount || 0} ${t("calendar.project.crewMembers")}`
                  : t("calendar.project.crewConfirmed", {
                    confirmed: project.confirmedCrewCount,
                    total: project.crewCount || 0,
                  })}</span>
            </div>
          </div>
          
          <HoverCard.Arrow style={{ fill: "var(--card-bg)", stroke: "var(--border-color)", strokeWidth: 1 }} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
