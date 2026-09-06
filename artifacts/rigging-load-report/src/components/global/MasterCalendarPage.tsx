import React, { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, MapPin, Users, Briefcase } from "lucide-react";
import { format, addMonths, subMonths, addWeeks, subWeeks, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, parseISO, isWithinInterval, startOfDay } from "date-fns";
import { nb } from "date-fns/locale";
import * as HoverCard from "@radix-ui/react-hover-card";
import { useI18n, useT } from "../../lib/i18n/I18nContext";

export type CalendarProject = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  easyjob_number: string | null;
  crewCount: number | null;
  status: string | null;
  venue?: string | null;
};

interface Props {
  getToken: () => Promise<string | null>;
  onOpenProject: (id: string) => void;
}

export function MasterCalendarPage({ getToken, onOpenProject }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [projects, setProjects] = useState<CalendarProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<"month" | "week">("month");

  useEffect(() => {
    let mounted = true;
    const fetchProjects = async () => {
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
        const json = await res.json();
        if (mounted) {
          if (!json.ok) throw new Error(json.error || t("calendar.error.load"));
          setProjects(json.projects || []);
        }
      } catch (err: any) {
        if (mounted) setError(err.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchProjects();
    return () => {
      mounted = false;
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
      const parsed = p.startDate ? parseISO(p.startDate) : null;
      if (parsed && !Number.isNaN(parsed.getTime())) s.push(p);
      else u.push(p);
    }
    return { scheduled: s, unscheduled: u };
  }, [projects]);

  const days = useMemo(() => {
    if (view === "month") {
      const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
      const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
      return eachDayOfInterval({ start, end });
    } else {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfWeek(currentDate, { weekStartsOn: 1 });
      return eachDayOfInterval({ start, end });
    }
  }, [currentDate, view]);

  const projectsByDay = useMemo(() => {
    const map = new Map<string, CalendarProject[]>();
    for (const day of days) {
      const dayStart = startOfDay(day);
      const matching = scheduled.filter(p => {
        try {
          const pStart = startOfDay(parseISO(p.startDate!));
          const pEnd = p.endDate ? startOfDay(parseISO(p.endDate)) : pStart;
          return isWithinInterval(dayStart, { start: pStart, end: pEnd });
        } catch {
          return false;
        }
      });
      map.set(day.toISOString(), matching);
    }
    return map;
  }, [days, scheduled]);

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
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
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
            display: "grid", 
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))", 
            border: "1px solid var(--border-color)", 
            borderRadius: 12, 
            overflow: "hidden", 
            background: "var(--card-bg)",
            flex: 1
          }}>
            {/* Header Row */}
             {(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((d, i) => (
              <div key={i} style={{ padding: "10px 8px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", textAlign: "center", borderBottom: "1px solid var(--border-color)", borderRight: i < 6 ? "1px solid var(--border-color)" : "none", background: "var(--input-bg)" }}>
                 {t(`calendar.days.${d}`)}
              </div>
            ))}
            {/* Days Grid */}
            {days.map((day, i) => {
              const isToday = isSameDay(day, new Date());
              const isCurrentMonth = day.getMonth() === currentDate.getMonth();
              const dayProjects = projectsByDay.get(day.toISOString()) || [];
              
              return (
                <div key={day.toISOString()} style={{ 
                  minHeight: view === "month" ? 120 : 400,
                  padding: 8, 
                  borderRight: (i % 7) !== 6 ? "1px solid var(--border-color)" : "none",
                  borderBottom: i < days.length - 7 ? "1px solid var(--border-color)" : "none",
                  background: !isCurrentMonth ? "rgba(0,0,0,0.02)" : "transparent",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4
                }}>
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, overflowY: "auto" }}>
                    {dayProjects.map(p => (
                       <ProjectPopover key={p.id} project={p} onOpenProject={onOpenProject} t={t} />
                    ))}
                  </div>
                </div>
              );
            })}
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
    </div>
  );
}

function ProjectPopover({ project, onOpenProject, compact, t }: { project: CalendarProject, onOpenProject: (id: string) => void, compact?: boolean, t: ReturnType<typeof useT> }) {
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
      const days = Math.floor((finish.getTime() - start.getTime()) / 86_400_000) + 1;
      return Number.isFinite(days) && days > 0 ? days : 1;
    } catch {
      return null;
    }
  })();
  
  const bg = isConfirmed ? "rgba(16, 185, 129, 0.1)" : isArchived ? "rgba(148, 163, 184, 0.1)" : "var(--primary-soft)";
  const color = isConfirmed ? "var(--success)" : isArchived ? "var(--text-muted)" : "var(--primary)";
  const border = isConfirmed ? "1px solid rgba(16, 185, 129, 0.2)" : isArchived ? "1px solid rgba(148, 163, 184, 0.2)" : "1px solid rgba(248, 128, 0, 0.2)";

  return (
    <HoverCard.Root openDelay={200} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <button 
          type="button"
          onClick={() => onOpenProject(project.id)}
          style={{
            display: "block",
            width: compact ? "auto" : "100%",
            textAlign: "left",
            padding: "4px 8px",
            fontSize: 11,
            fontWeight: 700,
            borderRadius: 4,
            background: bg,
            color: color,
            border: border,
            cursor: "pointer",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "all 0.15s ease"
          }}
        >
           {project.name || t("calendar.project.unnamed")}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content 
          sideOffset={5} 
          style={{ 
            zIndex: 1050, 
            background: "var(--card-bg)", 
            border: "1px solid var(--border-color)", 
            borderRadius: 12, 
            padding: 16, 
            width: 320,
            boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
            color: "var(--text-main)",
            animation: "fadeIn 0.15s ease-out"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
             <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, paddingRight: 16 }}>{project.name || t("calendar.project.unnamed")}</h4>
            <span style={{ 
              fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, 
              padding: "4px 8px", borderRadius: 999, background: bg, color: color, border: border
            }}>
               {t(`calendar.status.${displayStatus as "draft" | "active" | "confirmed" | "completed" | "archived" | "canceled"}`)}
            </span>
          </div>
          
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            {project.startDate && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
                <CalendarIcon size={14} />
                 <span>{project.startDate}{project.endDate && project.endDate !== project.startDate ? ` ${t("calendar.project.to")} ${project.endDate}` : ""}{durationDays ? ` · ${durationDays} ${durationDays === 1 ? t("calendar.project.day") : t("calendar.project.days")}` : ""}</span>
              </div>
            )}
            {project.venue && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
                <MapPin size={14} />
                <span>{project.venue}</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
              <Briefcase size={14} />
               <span>{project.easyjob_number ? `${t("calendar.project.easyJob")}: ${project.easyjob_number}` : t("calendar.project.noEasyJob")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
              <Users size={14} />
               <span>{project.crewCount || 0} {t("calendar.project.crewMembers")}</span>
            </div>
          </div>
          
          <HoverCard.Arrow style={{ fill: "var(--card-bg)", stroke: "var(--border-color)", strokeWidth: 1 }} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
