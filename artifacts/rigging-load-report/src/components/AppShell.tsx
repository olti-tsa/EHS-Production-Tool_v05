import React, { type ReactNode } from "react";
import { Link } from "wouter";
import {
  Activity,
  AlignLeft,
  Bed,
  Bell,
  Briefcase,
  ChevronDown,
  ClipboardCheck,
  CheckSquare,
  Coffee,
  Command,
  Download,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  MonitorPlay,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  Speaker,
  Users,
  Zap,
  HelpCircle,
  Home,
  LayoutGrid,
  RotateCcw,
  Moon,
  Sun,
} from "lucide-react";
import type { ThemePreference } from "../main";
import { useT, type Translator } from "../lib/i18n/I18nContext";
import { CommandPalette } from "./CommandPalette";
import { FeedbackDialog } from "./FeedbackDialog";
import { LanguageSelector } from "./LanguageSelector";
import { Toaster } from "./ui/sonner";
import {
  PROJECT_STATUS_META,
  type ProjectStatus,
} from "../lib/projectStatus";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/**
 * Linear v2 — Tactical Command Center shell.
 *
 * Wraps every authenticated dashboard view in a sidebar + topbar chrome
 * matching the approved mockup at
 * `artifacts/mockup-sandbox/src/components/mockups/ehs-redesign/Linear.tsx`.
 *
 * Visual fidelity:
 *  - Sidebar background `#1C1C24`, surfaces `#25252F`, borders white/8
 *  - Active nav row: bg `rgba(248,128,0,0.12)`, text `#F88000`
 *  - Topbar: 64px, sticky, breadcrumb + status pill + actions
 *
 * The component intentionally uses inline styles to match the rest of
 * the app (no Tailwind in main app) and to be self-contained.
 */

export type ShellView =
  | "oversikt"
  | "rigging"
  | "lighting"
  | "led"
  | "stage"
  | "sound"
  | "crew"
  | "hotel"
  | "catering"
  | "riggPlan"
  | "inspection"
  | "tasks"
  | "chat";

type NavItem = {
  id: ShellView;
  label: string;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number }>;
  badge?: number | null;
  hidden?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export type ShellAction = {
  id: string;
  label: string;
  icon?: React.ComponentType<{ size?: number | string }>;
  onClick: () => void;
  variant?: "primary" | "secondary" | "ghost";
  title?: string;
};

interface AppShellProps {
  view: ShellView;
  onChangeView: (next: ShellView) => void;
  workspaceLabel: string;
  workspaceSublabel?: string;
  workspaceLogoSrc?: string;
  projectTitle: string;
  projectStatus?: ProjectStatus;
  onProjectStatusClick?: () => void;
  badges: Partial<Record<ShellView, number>>;
  showCatering: boolean;
  showHotel: boolean;
  savedAt: string;
  primaryActions?: ShellAction[];
  secondaryActions?: ShellAction[];
  overflowActions?: ShellAction[];
  themePref: ThemePreference;
  onChangeTheme: (next: ThemePreference) => void;
  userInitial: string;
  userName: string;
  userRole: string;
  userEmail?: string;
  onSignOut: () => void;
  onHelp?: () => void;
  onOpenProjects?: () => void;
  onHome?: () => void;
  cloudSavedAt?: string;
  /** Optional compact reset-project handler. When provided the topbar
   *  renders a small ghost pill next to the cloud-saved indicator so
   *  producers can wipe the working project without diving into the
   *  overflow menu. */
  onResetProject?: () => void;
  deleteProjectTrigger?: ReactNode;
  readOnly?: boolean;
  readOnlyLabel?: string;
  children: ReactNode;
}

function buildNavGroups(t: Translator): NavGroup[] {
  return [
    {
      label: t("shell.nav.project"),
      items: [
        { id: "oversikt", label: t("shell.nav.overview"), icon: Activity },
        { id: "rigging", label: t("shell.nav.rigging"), icon: Briefcase },
        { id: "lighting", label: t("shell.nav.lighting"), icon: Zap },
        { id: "led", label: t("shell.nav.led"), icon: MonitorPlay },
        { id: "sound", label: t("shell.nav.sound"), icon: Speaker },
        { id: "stage", label: t("shell.nav.stage"), icon: AlignLeft },
        { id: "riggPlan", label: t("shell.nav.riggPlan"), icon: LayoutGrid },
        { id: "inspection", label: t("shell.nav.inspection"), icon: ClipboardCheck },
        { id: "tasks", label: t("shell.nav.tasks"), icon: CheckSquare },
        { id: "chat", label: t("shell.nav.chat"), icon: MessageSquare },
      ],
    },
    {
      label: t("shell.nav.logistics"),
      items: [
        { id: "crew", label: t("shell.nav.crew"), icon: Users },
        { id: "hotel", label: t("shell.nav.hotel"), icon: Bed },
        { id: "catering", label: t("shell.nav.catering"), icon: Coffee },
      ],
    },
  ];
}

function statusToneStyle(tone: "success" | "warning" | "danger" | "neutral"): React.CSSProperties {
  switch (tone) {
    case "success":
      return {
        background: "rgba(16,185,129,0.12)",
        color: "#34d399",
        border: "1px solid rgba(16,185,129,0.25)",
      };
    case "warning":
      return {
        background: "rgba(245,158,11,0.12)",
        color: "#fbbf24",
        border: "1px solid rgba(245,158,11,0.25)",
      };
    case "danger":
      return {
        background: "rgba(244,63,94,0.12)",
        color: "#fb7185",
        border: "1px solid rgba(244,63,94,0.25)",
      };
    default:
      return {
        background: "rgba(255,255,255,0.05)",
        color: "var(--text-muted)",
        border: "1px solid var(--border-color)",
      };
  }
}

function actionVariantStyle(variant: ShellAction["variant"]): React.CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: "var(--primary)",
        color: "#fff",
        border: "1px solid var(--primary)",
        boxShadow: "0 0 14px rgba(248,128,0,0.28)",
      };
    case "secondary":
      return {
        background: "rgba(255,255,255,0.04)",
        color: "var(--text-main)",
        border: "1px solid var(--border-color)",
      };
    default:
      return {
        background: "transparent",
        color: "var(--text-muted)",
        border: "1px solid transparent",
      };
  }
}

export function AppShell({
  view,
  onChangeView,
  workspaceLabel,
  workspaceLogoSrc,
  workspaceSublabel,
  projectTitle,
  projectStatus,
  onProjectStatusClick,
  badges,
  showCatering,
  showHotel,
  savedAt,
  primaryActions = [],
  secondaryActions = [],
  overflowActions = [],
  themePref,
  onChangeTheme,
  userInitial,
  userName,
  userRole,
  userEmail,
  onSignOut,
  onHelp,
  onOpenProjects,
  onHome,
  cloudSavedAt,
  onResetProject,
  deleteProjectTrigger,
  readOnly = false,
  readOnlyLabel,
  children,
}: AppShellProps) {
  const t = useT();
  const [overflowOpen, setOverflowOpen] = React.useState(false);
  const [themeOpen, setThemeOpen] = React.useState(false);
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const overflowRef = React.useRef<HTMLDivElement | null>(null);
  const mobileMenuBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const wasMobileMenuOpenRef = React.useRef(false);

  // Auto-close the mobile drawer when the user picks a nav item.
  const handleChangeView = React.useCallback(
    (next: ShellView) => {
      setMobileMenuOpen(false);
      onChangeView(next);
    },
    [onChangeView],
  );

  // Close the drawer on Escape so keyboard users aren't trapped.
  React.useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);

  // When the drawer closes, return focus to the hamburger button so
  // keyboard users land back on the trigger they came from instead of
  // somewhere off-screen.
  React.useEffect(() => {
    if (wasMobileMenuOpenRef.current && !mobileMenuOpen) {
      mobileMenuBtnRef.current?.focus();
    }
    wasMobileMenuOpenRef.current = mobileMenuOpen;
  }, [mobileMenuOpen]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const allActions: ShellAction[] = [
    ...primaryActions,
    ...secondaryActions,
    ...overflowActions,
  ];

  // Accessibility: close any open menu on Escape, and close it when the
  // user clicks outside the trigger/menu container. Producers don't
  // expect a menu to stay docked when they navigate elsewhere.
  React.useEffect(() => {
    if (!overflowOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOverflowOpen(false);
      }
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (overflowOpen && overflowRef.current && t && !overflowRef.current.contains(t)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [overflowOpen]);

  const groups = buildNavGroups(t).map((g) => ({
    ...g,
    items: g.items
      .map((it) => ({
        ...it,
        hidden: false,
        badge: badges[it.id] ?? null,
      }))
      .filter((it) => !it.hidden),
  }));

  return (
    <div className="ehs-shell">
      {/* Mobile drawer backdrop — only renders when the drawer is open
          AND the viewport is narrow (the .ehs-shell-backdrop class is
          display:none above 900px so this is harmless on desktop). */}
      {mobileMenuOpen ? (
        <div
          className="ehs-shell-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden
        />
      ) : null}
      {/* SIDEBAR */}
      <aside className={`ehs-shell-aside${mobileMenuOpen ? " is-open" : ""}`}>
        <div
          className={`ehs-shell-workspace${workspaceLogoSrc ? " ehs-shell-workspace--stacked" : ""}`}
        >
          <div className="ehs-shell-workspace-mark">
            {workspaceLogoSrc ? (
              <img
                src={workspaceLogoSrc}
                alt={workspaceLabel}
                className="ehs-shell-workspace-logo"
              />
            ) : (
              workspaceLabel.charAt(0).toUpperCase()
            )}
          </div>
          <div className="ehs-shell-workspace-text">
            <div className="ehs-shell-workspace-name">{workspaceLabel}</div>
            {workspaceSublabel ? (
              <div className="ehs-shell-workspace-sub">{workspaceSublabel}</div>
            ) : null}
          </div>
          <ChevronDown
            size={14}
            className="ehs-shell-workspace-chevron"
          />
        </div>

        <div style={{ padding: "10px 12px" }}>
          <button
            type="button"
            className="ehs-shell-side-action"
            title={t("shell.searchTitle")}
            onClick={() => setCmdOpen(true)}
          >
            <Search size={14} />
            <span>{t("shell.search")}</span>
            <span className="ehs-shell-kbd-row">
              <kbd className="ehs-shell-kbd">
                <Command size={10} />
              </kbd>
              <kbd className="ehs-shell-kbd">K</kbd>
            </span>
          </button>
          <button
            type="button"
            className="ehs-shell-side-action"
            onClick={() => handleChangeView("rigging")}
            title={t("shell.newSystemTitle")}
            style={{ marginTop: 4 }}
          >
            <Plus size={14} />
            <span>{t("shell.newSystem")}</span>
            <span className="ehs-shell-kbd-row">
              <kbd className="ehs-shell-kbd">N</kbd>
            </span>
          </button>
        </div>

        <nav className="ehs-shell-nav">
          {groups.map((group) => (
            <div key={group.label} style={{ marginTop: 18 }}>
              <div className="ehs-shell-nav-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.id === view;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleChangeView(item.id)}
                    className={`ehs-shell-nav-item${active ? " is-active" : ""}`}
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    <span style={{ flex: 1, textAlign: "left" }}>{item.label}</span>
                    {item.badge != null && item.badge > 0 ? (
                      <span className="ehs-shell-nav-badge">{item.badge}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div style={{ padding: "0 12px", marginTop: "auto", marginBottom: 4 }}>
          <button
            type="button"
            className="ehs-shell-nav-item"
            style={{ background: "none", border: "none", cursor: "pointer", width: "100%", textDecoration: "none" }}
            onClick={onHelp}
          >
            <HelpCircle size={15} strokeWidth={1.75} />
            <span style={{ flex: 1, textAlign: "left" }}>{t("shell.help")}</span>
          </button>
        </div>

        <div className="ehs-shell-user">
          <div className="ehs-shell-user-avatar">{userInitial.toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ehs-shell-user-name">{userName}</div>
            <div className="ehs-shell-user-role">{userRole}</div>
          </div>
          <DropdownMenu open={themeOpen} onOpenChange={setThemeOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ehs-shell-icon-btn"
                title={t("shell.settings")}
                aria-label={t("shell.settings")}
              >
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="ehs-shell-menu"
              side="top"
              align="end"
              sideOffset={6}
            >
                <div className="ehs-shell-menu-label">{t("theme.label")}</div>
                {(["light", "dark", "system"] as const).map((opt) => (
                  <DropdownMenuItem
                    key={opt}
                    aria-checked={themePref === opt}
                    className={`ehs-shell-menu-item${themePref === opt ? " is-active" : ""}`}
                    onSelect={() => {
                      onChangeTheme(opt);
                    }}
                  >
                    {opt === "light" ? t("theme.light") : opt === "dark" ? t("theme.dark") : t("theme.system")}
                  </DropdownMenuItem>
                ))}
                <div className="ehs-shell-menu-sep" />
                <Link
                  href="/portal"
                  className="ehs-shell-menu-item"
                  onClick={() => setThemeOpen(false)}
                >
                  {t("shell.portalLink")}
                </Link>
                {userEmail ? (
                  <div className="ehs-shell-menu-meta" title={userEmail}>
                    {userEmail}
                  </div>
                ) : null}
                <DropdownMenuItem
                  className="ehs-shell-menu-item"
                  onClick={() => setFeedbackOpen(!feedbackOpen)}
                >
                  <MessageSquare size={12} /> {t("feedback.menuLabel")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="ehs-shell-menu-item is-danger"
                  onSelect={() => {
                    onSignOut();
                  }}
                >
                  <LogOut size={12} /> {t("shell.signOut")}
                </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* MAIN */}
      <main className="ehs-shell-main">
        <header className="ehs-shell-topbar">
          {workspaceLogoSrc ? (
            <img
              src={workspaceLogoSrc}
              alt={workspaceLabel}
              className="ehs-shell-mobile-brand h-7 w-auto object-contain"
            />
          ) : null}
          <button
            ref={mobileMenuBtnRef}
            type="button"
            className="ehs-shell-mobile-menu-btn"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label={t("shell.nav.project")}
            aria-expanded={mobileMenuOpen}
          >
            <Menu size={18} />
          </button>
          {onHome ? (
            <button
              type="button"
              className="ehs-shell-home-button"
              onClick={onHome}
              title={t("shell.homeTitle")}
            >
              <Home size={14} />
              <span>{t("shell.home")}</span>
            </button>
          ) : null}
          <div className="ehs-shell-crumbs">
            <button
              type="button"
              className="ehs-shell-crumb-link"
              onClick={() => onOpenProjects ? onOpenProjects() : onChangeView("oversikt")}
            >
              {t("shell.breadcrumb.projects")}
            </button>
            <span className="ehs-shell-crumb-sep">/</span>
            <span className="ehs-shell-crumb-current" title={projectTitle}>
              {projectTitle || t("shell.breadcrumb.untitled")}
            </span>
            {projectStatus ? (
              <button
                type="button"
                className="ehs-shell-status"
                style={{
                  ...statusToneStyle(PROJECT_STATUS_META[projectStatus].tone),
                  cursor: onProjectStatusClick ? "pointer" : "default",
                }}
                onClick={onProjectStatusClick}
                disabled={!onProjectStatusClick}
                title={onProjectStatusClick ? t("project.status.change") : undefined}
              >
                ● {t(`project.status.${projectStatus}` as Parameters<typeof t>[0])}
                {onProjectStatusClick ? <ChevronDown size={11} aria-hidden /> : null}
              </button>
            ) : null}
            {cloudSavedAt ? (
              <span className="ehs-shell-saved ehs-shell-saved--cloud" title={t("shell.savedCloud", { time: cloudSavedAt })}>
                <span className="ehs-shell-saved-dot ehs-shell-saved-dot--cloud" /> {t("shell.savedCloud", { time: cloudSavedAt })}
              </span>
            ) : savedAt ? (
              <span className="ehs-shell-saved" title={t("shell.savedTitle")}>
                <span className="ehs-shell-saved-dot" /> {t("shell.saved", { time: savedAt })}
              </span>
            ) : null}
            {onResetProject ? (
              <button
                type="button"
                onClick={onResetProject}
                title={t("shell.action.resetProject")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  height: 22,
                  padding: "0 8px",
                  marginLeft: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: "var(--text-muted)",
                  background: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: 999,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <RotateCcw size={11} />
                <span>{t("shell.action.resetProject")}</span>
              </button>
            ) : null}
            {deleteProjectTrigger}
          </div>

          <div className="ehs-shell-topbar-actions ehs-producer-topbar-actions">
            {onHelp ? (
              <button
                type="button"
                className="ehs-shell-action ehs-shell-help-action ehs-mobile-utility h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200"
                onClick={onHelp}
                title={t("header.helpTitle")}
                aria-label={t("header.help")}
              >
                <HelpCircle size={14} />
                <span>{t("header.help")}</span>
              </button>
            ) : null}
            <div className="ehs-mobile-utility">
              <LanguageSelector triggerClassName="h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200" />
            </div>
            <button
              type="button"
              className="ehs-mobile-utility ehs-mobile-only-utility ehs-shell-icon-btn h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200"
              onClick={() => onChangeTheme(themePref === "dark" ? "light" : "dark")}
              aria-label={themePref === "dark" ? t("theme.light") : t("theme.dark")}
              title={themePref === "dark" ? t("theme.light") : t("theme.dark")}
            >
              {themePref === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="ehs-mobile-utility ehs-mobile-only-utility ehs-shell-icon-btn h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200"
                  aria-label={t("shell.notifications")}
                  title={t("shell.notifications")}
                >
                  <Bell size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[60] bg-white dark:bg-slate-900">
                <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                  {t("shell.notifications.empty")}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              className="ehs-mobile-utility ehs-mobile-only-utility ehs-shell-icon-btn h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200"
              onClick={onSignOut}
              aria-label={t("shell.signOut")}
              title={t("shell.signOut")}
            >
              <LogOut size={14} />
            </button>
            {secondaryActions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  className="ehs-shell-action"
                  style={actionVariantStyle(a.variant ?? "secondary")}
                  onClick={a.onClick}
                  title={a.title ?? a.label}
                >
                  {Icon ? <Icon size={13} /> : null}
                  <span>{a.label}</span>
                </button>
              );
            })}
            {primaryActions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.id}
                  type="button"
                  className="ehs-shell-action"
                  style={actionVariantStyle(a.variant ?? "primary")}
                  onClick={a.onClick}
                  title={a.title ?? a.label}
                >
                  {Icon ? <Icon size={13} /> : null}
                  <span>{a.label}</span>
                </button>
              );
            })}
            {overflowActions.length > 0 ? (
              <div style={{ position: "relative" }} ref={overflowRef}>
                <button
                  type="button"
                  className="ehs-shell-icon-btn"
                  onClick={() => setOverflowOpen((v) => !v)}
                  aria-label={t("shell.moreActions")}
                  aria-haspopup="menu"
                  aria-expanded={overflowOpen}
                  title={t("shell.moreActions")}
                >
                  <MoreHorizontal size={14} />
                </button>
                {overflowOpen ? (
                  <div
                    className="ehs-shell-menu"
                    role="menu"
                    style={{ right: 0, left: "auto" }}
                  >
                    {overflowActions.map((a) => {
                      const Icon = a.icon;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          role="menuitem"
                          className="ehs-shell-menu-item"
                          onClick={() => {
                            setOverflowOpen(false);
                            a.onClick();
                          }}
                          title={a.title ?? a.label}
                        >
                          {Icon ? <Icon size={12} /> : null}
                          <span>{a.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <div className="ehs-shell-glow" aria-hidden />
        <div className="ehs-shell-content">
          {readOnly ? (
            <div className="ehs-shell-readonly-banner" role="status">
              {readOnlyLabel ?? t("shell.readOnly")}
            </div>
          ) : null}
          <div
            className={readOnly ? "ehs-shell-readonly-content" : undefined}
            aria-disabled={readOnly || undefined}
            inert={readOnly || undefined}
          >
            {children}
          </div>
        </div>
      </main>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={(v) => handleChangeView(v)}
        actions={allActions}
        showHotel={showHotel}
        showCatering={showCatering}
      />
      {/* Direct fixed panel: deliberately outside the dropdown and free of
          Radix Dialog/Portal rendering. */}
      <FeedbackDialog
        isOpen={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
      <Toaster theme={themePref === "system" ? "dark" : themePref} />
    </div>
  );
}

export { Bell, Download, MapPin, Share2 };
