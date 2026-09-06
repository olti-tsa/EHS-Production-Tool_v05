import React from "react";
import { Activity, Briefcase, Calendar, CheckSquare, DollarSign, Truck, Users } from "lucide-react";
import type { GlobalView } from "./GlobalShell";
import { useT } from "../../lib/i18n/I18nContext";
import type { TranslationKey } from "../../lib/i18n/types";

export interface DashboardStats {
  activeProjects: number;
  planningProjects: number;
  totalFreelancers: number;
  unassignedTasks: number;
}

interface Props {
  stats: DashboardStats;
  onNavigate: (view: GlobalView) => void;
}

type QuickNavItem = {
  view: GlobalView;
  nameKey: TranslationKey;
  subtitleKey: TranslationKey;
  Icon: React.ComponentType<{ size?: number }>;
  iconStyle: React.CSSProperties;
};

const QUICK_NAV_ITEMS: QuickNavItem[] = [
  { view: "projects", nameKey: "home.nav.projects.title", subtitleKey: "home.nav.projects.sub", Icon: Briefcase, iconStyle: { background: "var(--primary-soft)", color: "var(--primary)" } },
  { view: "crew", nameKey: "home.nav.crew.title", subtitleKey: "home.nav.crew.sub", Icon: Users, iconStyle: { background: "rgba(16, 185, 129, 0.12)", color: "#10b981" } },
  { view: "calendar", nameKey: "home.nav.calendar.title", subtitleKey: "home.nav.calendar.sub", Icon: Calendar, iconStyle: { background: "rgba(59, 130, 246, 0.12)", color: "#3b82f6" } },
  { view: "transport", nameKey: "home.nav.transport.title", subtitleKey: "home.nav.transport.sub", Icon: Truck, iconStyle: { background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" } },
  { view: "tasks", nameKey: "home.nav.tasks.title", subtitleKey: "home.nav.tasks.sub", Icon: CheckSquare, iconStyle: { background: "rgba(236, 72, 153, 0.12)", color: "#ec4899" } },
  { view: "economy", nameKey: "home.nav.economy.title", subtitleKey: "home.nav.economy.sub", Icon: DollarSign, iconStyle: { background: "rgba(139, 92, 246, 0.12)", color: "#8b5cf6" } },
];

export function HomeDashboard({ stats, onNavigate }: Props) {
  const t = useT();
  return (
    <div style={{ padding: "0 16px 40px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 300, margin: "0 0 8px 0", color: "var(--text-main)" }}>
          {t("home.title")}
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
          {t("home.subtitle")}
        </p>
      </div>

      <div className="dashboard" style={{ marginBottom: 32 }}>
        <div className="dash-item">
          <span>{t("home.activeProjects")}</span>
          <strong>{stats.activeProjects}</strong>
        </div>
        <div className="dash-item">
          <span>{t("home.inPlanning")}</span>
          <strong>{stats.planningProjects}</strong>
        </div>
        <div className="dash-item">
          <span>{t("home.crewProfiles")}</span>
          <strong>{stats.totalFreelancers}</strong>
        </div>
        <div className="dash-item">
          <span>{t("home.globalTasks")}</span>
          <strong style={{ fontSize: "0.85rem" }}>{t("home.phase2")}</strong>
        </div>
      </div>

      <h3 style={{ fontSize: "0.8rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-muted)", marginBottom: 16 }}>
        {t("home.quickNav")}
      </h3>

      <div className="system-mini-grid">
        {QUICK_NAV_ITEMS.map(({ view, nameKey, subtitleKey, Icon, iconStyle }) => (
        <button key={view} className="system-mini" onClick={() => onNavigate(view)} aria-label={t(nameKey)} title={t(nameKey)}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, ...iconStyle }}>
              <Icon size={16} />
            </div>
            <div>
              <div className="mini-name">{t(nameKey)}</div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 2 }}>{t(subtitleKey)}</div>
            </div>
          </div>
        </button>
        ))}
      </div>
    </div>
  );
}
