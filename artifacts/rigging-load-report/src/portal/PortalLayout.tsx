import React, { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "wouter";
import { useClerk } from "@clerk/react";
import {
  Activity,
  Calendar,
  ChevronDown,
  Clock,
  Command,
  HelpCircle,
  Inbox,
  BookOpen,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Search,
  TrendingUp,
  Truck,
  ListChecks,
  Moon,
  Sun,
  User,
  Wallet,
  X,
} from "lucide-react";
import ehsLogo from "../assets/ehs-logo.png";
import { PALETTE, PORTAL_FONT, type ThemeMode } from "./lib/portalTheme";
import { useT } from "../lib/i18n/I18nContext";
import type { TranslationKey } from "../lib/i18n/types";
import { LanguageSelector } from "../components/LanguageSelector";
import { FeedbackDialog } from "../components/FeedbackDialog";
import { Toaster } from "../components/ui/sonner";
import { ActivityPopover } from "./components/ActivityPopover";
import type { PortalData } from "./lib/portalStorage";
import "./portal-responsive.css";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

export type PortalNavKey =
  | "hub"
  | "briefs"
  | "guidelines"
  | "gigs"
  | "runs"
  | "tasks"
  | "availability"
  | "hours"
  | "earnings"
  | "profile"
  | "help";

/** Three-way theme preference. Mirrors the type used in main.tsx; kept
 *  local so this file has no dependency cycle back into the entry. */
export type PortalThemePref = "light" | "dark" | "system";

type NavItem = {
  key: PortalNavKey;
  labelKey: TranslationKey;
  href: string;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number }>;
};

const NAV_WORK: NavItem[] = [
  { key: "hub", labelKey: "portal.nav.hub", href: "/portal", icon: Activity },
  { key: "briefs", labelKey: "portal.nav.briefs", href: "/portal/briefs", icon: Inbox },
  { key: "guidelines", labelKey: "portal.nav.guidelines", href: "/portal/guidelines", icon: BookOpen },
  { key: "gigs", labelKey: "portal.nav.gigs", href: "/portal/gigs", icon: Calendar },
  { key: "runs", labelKey: "portal.nav.runs", href: "/portal/my-runs", icon: Truck },
  { key: "tasks", labelKey: "portal.nav.tasks", href: "/portal/my-tasks", icon: ListChecks },
  {
    key: "availability",
    labelKey: "portal.nav.availability",
    href: "/portal/availability",
    icon: Clock,
  },
  {
    key: "hours",
    labelKey: "portal.nav.hours",
    href: "/portal/hours",
    icon: TrendingUp,
  },
];

const NAV_ACCOUNT: NavItem[] = [
  { key: "earnings", labelKey: "portal.nav.earnings", href: "/portal/earnings", icon: Wallet },
  { key: "profile", labelKey: "portal.nav.profile", href: "/portal/profile", icon: User },
  { key: "help", labelKey: "portal.nav.help", href: "/portal/help", icon: HelpCircle },
];

const NAV_GROUPS: ReadonlyArray<{ labelKey: TranslationKey; items: NavItem[] }> = [
  { labelKey: "portal.nav.hub", items: NAV_WORK }, // group label rendered separately below
  { labelKey: "portal.nav.profile", items: NAV_ACCOUNT },
];

const GROUP_LABELS: Record<"work" | "account", TranslationKey> = {
  work: "portal.layout.group.work",
  account: "portal.layout.group.account",
};

export function PortalLayout({
  theme,
  pref,
  setPref,
  active,
  userLabel,
  pendingBriefCount,
  portalData,
  children,
}: {
  theme: ThemeMode;
  pref: PortalThemePref;
  setPref: (next: PortalThemePref) => void;
  active: PortalNavKey;
  userLabel: string;
  /** Number of briefs in `pending` state — surfaced as a badge on the
   *  Briefs nav item so the freelancer doesn't miss new project briefings. */
  pendingBriefCount: number;
  portalData: PortalData;
  children: ReactNode;
}) {
  // `theme` is intentionally referenced (consumers still pass it) but the
  // chrome now reads CSS variables from `[data-theme]` on <html>, so we
  // don't fork styles by mode here.
  void theme;
  const c = PALETTE.dark; // unused after refactor; kept import for type stability
  void c;

  const { signOut } = useClerk();
  const t = useT();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  const [isMoreOpen, setIsMoreOpen] = React.useState(false);

  const allItems = [...NAV_WORK, ...NAV_ACCOUNT];
  const activeItem = allItems.find((i) => i.key === active);
  const activeLabel = activeItem ? t(activeItem.labelKey) : "";
  const userInitial = (userLabel || "?").trim().charAt(0).toUpperCase();

  return (
    <div
      className="ehs-shell ehs-portal-layout"
      style={{ fontFamily: PORTAL_FONT, minHeight: "100dvh" }}
    >
      {/* SIDEBAR — same chrome as production tool */}
      <aside className="ehs-shell-aside ehs-portal-aside">
        <div className="ehs-shell-workspace ehs-shell-workspace--stacked">
          <Link
            href="/portal"
            className="ehs-shell-workspace-mark"
            style={{ textDecoration: "none" }}
            aria-label={t("portal.header.title")}
          >
            <img
              src={ehsLogo}
              alt="EHS"
              className="ehs-shell-workspace-logo"
            />
          </Link>
          <div className="ehs-shell-workspace-text">
            <div className="ehs-shell-workspace-name">
              {t("portal.header.title")}
            </div>
          </div>
          <ChevronDown size={14} className="ehs-shell-workspace-chevron" />
        </div>

        <div style={{ padding: "10px 12px" }}>
          <button
            type="button"
            className="ehs-shell-side-action"
            disabled
            title={t("portal.nav.gigs")}
          >
            <Search size={14} />
            <span>{t("portal.nav.gigs")}</span>
            <span className="ehs-shell-kbd-row">
              <kbd className="ehs-shell-kbd">
                <Command size={10} />
              </kbd>
              <kbd className="ehs-shell-kbd">K</kbd>
            </span>
          </button>
        </div>

        <nav className="ehs-shell-nav">
          {(["work", "account"] as const).map((groupKey, groupIdx) => {
            const items = groupIdx === 0 ? NAV_WORK : NAV_ACCOUNT;
            return (
              <div key={groupKey} style={{ marginTop: 18 }}>
                <div className="ehs-shell-nav-label">
                   {t(GROUP_LABELS[groupKey])}
                </div>
                {items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.key === active;
                  const showBadge =
                    item.key === "briefs" && pendingBriefCount > 0;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className={`ehs-shell-nav-item${isActive ? " is-active" : ""}`}
                    >
                      <Icon size={15} strokeWidth={1.75} />
                      <span className="ehs-portal-nav-label" style={{ flex: 1, textAlign: "left" }}>
                        {t(item.labelKey)}
                      </span>
                      {showBadge ? (
                        <span
                          className="ehs-shell-nav-badge"
                          aria-label={t("portal.header.briefsBadgeAria", {
                            count: pendingBriefCount,
                          })}
                        >
                          {pendingBriefCount}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="ehs-shell-user">
          <div className="ehs-shell-user-avatar">{userInitial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ehs-shell-user-name">{userLabel}</div>
            <div className="ehs-shell-user-role">{t("portal.layout.role.freelancer")}</div>
          </div>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ehs-shell-icon-btn"
                aria-label={t("portal.header.signOut")}
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
                <div className="ehs-shell-menu-label">
                   {t("theme.label")}
                </div>
                {(["light", "dark", "system"] as const).map((opt) => (
                  <DropdownMenuItem
                    key={opt}
                    aria-checked={pref === opt}
                    className={`ehs-shell-menu-item${pref === opt ? " is-active" : ""}`}
                    onSelect={() => {
                      setPref(opt);
                    }}
                  >
                     {t(`theme.${opt}`)}
                  </DropdownMenuItem>
                ))}
                <div className="ehs-shell-menu-sep" />
                <DropdownMenuItem
                  className="ehs-shell-menu-item"
                  onClick={() => setFeedbackOpen(!feedbackOpen)}
                >
                  <MessageSquare size={12} /> {t("portal.layout.feedback")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="ehs-shell-menu-item is-danger"
                  onSelect={() => {
                    try {
                      sessionStorage.setItem("ehs-skip-dev-auto-signin", "1");
                      sessionStorage.removeItem("ehs-login-intent");
                      sessionStorage.removeItem("ehs-auth-mode");
                    } catch {
                      /* sessionStorage may be unavailable */
                    }
                    try {
                      localStorage.removeItem("ehs-user-role");
                    } catch {
                      /* localStorage may be unavailable */
                    }
                    void signOut();
                  }}
                >
                  <LogOut size={12} /> {t("portal.header.signOut")}
                </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* MAIN */}
      <main className="ehs-shell-main">
        <header
          className="ehs-shell-topbar ehs-portal-topbar ehs-portal-mobile-header flex justify-between items-center px-3 py-2.5 w-full max-w-full"
          style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box" }}
        >
          <Link
            href="/portal"
            className="ehs-portal-only-mobile"
            aria-label={t("portal.header.title")}
            style={{ flexShrink: 0, lineHeight: 0 }}
          >
            <img
              src={ehsLogo}
              alt="EHS"
              className="h-7 w-auto object-contain"
              style={{ display: "block", width: "auto", height: 28, objectFit: "contain" }}
            />
          </Link>
          <div className="ehs-shell-crumbs">
            <Link href="/portal" className="ehs-shell-crumb-link">
              {t("portal.header.title")}
            </Link>
            <span className="ehs-shell-crumb-sep">/</span>
            <span className="ehs-shell-crumb-current">{activeLabel}</span>
          </div>

          <div
            className="ehs-shell-topbar-actions ehs-portal-topbar-actions ehs-portal-mobile-utilities flex items-center gap-1.5 ml-auto pr-1"
            style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", paddingRight: 4 }}
          >
            <Link
              href="/portal/help"
              className="ehs-shell-action ehs-shell-help-action ehs-portal-mobile-utility h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200"
              aria-label={t("portal.header.helpAria")}
              title={t("portal.header.helpTitle")}
            >
              <HelpCircle size={14} />
              <span>{t("portal.nav.help")}</span>
            </Link>
            <div className="ehs-portal-mobile-language" style={{ display: "flex" }}>
              <LanguageSelector triggerClassName="h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200" />
            </div>
            <button
              type="button"
              className="ehs-shell-icon-btn ehs-portal-only-mobile ehs-portal-mobile-utility h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200"
              onClick={() => setPref(theme === "dark" ? "light" : "dark")}
              aria-label={t(theme === "dark" ? "portal.layout.useLightTheme" : "portal.layout.useDarkTheme")}
              title={t(theme === "dark" ? "portal.layout.useLightTheme" : "portal.layout.useDarkTheme")}
            >
              {theme === "dark" ? (
                <Sun size={14} strokeWidth={1.75} />
              ) : (
                <Moon size={14} strokeWidth={1.75} />
              )}
            </button>
            <ActivityPopover theme={theme} data={portalData} />
            <button
              type="button"
              className="ehs-shell-signout-btn ehs-portal-mobile-utility h-8 min-w-[32px] px-2 rounded-md border flex items-center justify-center text-xs font-semibold transition-colors bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-800 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:border-slate-700/60 dark:text-slate-200"
              onClick={() => {
                try {
                  sessionStorage.setItem("ehs-skip-dev-auto-signin", "1");
                  sessionStorage.removeItem("ehs-login-intent");
                  sessionStorage.removeItem("ehs-auth-mode");
                } catch {
                  /* sessionStorage may be unavailable */
                }
                try {
                  localStorage.removeItem("ehs-user-role");
                } catch {
                  /* localStorage may be unavailable */
                }
                void signOut();
              }}
              aria-label={t("portal.header.signOut")}
              title={t("portal.header.signOut")}
            >
              <LogOut size={14} />
              <span className="ehs-shell-signout-label">
                {t("portal.header.signOut")}
              </span>
            </button>
          </div>
        </header>

        <nav className="ehs-portal-brief-tabs" aria-label={t("portal.header.sectionsAria")}>
          {NAV_WORK.filter((item) => item.key === "briefs" || item.key === "guidelines").map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active === item.key ? "page" : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
        <div className="ehs-shell-glow" aria-hidden />
        <div
          className="ehs-shell-content ehs-portal-content"
          style={{
            padding: "20px 16px 96px",
            maxWidth: 1100,
            width: "100%",
            margin: "0 auto",
            boxSizing: "border-box",
          }}
        >
          {children}
        </div>
      </main>

      {/* MOBILE BOTTOM NAV — kept for phones since the sidebar collapses */}
      <nav
        className="ehs-portal-bottomnav"
        aria-label={t("portal.header.sectionsAria")}
      >
        {["hub", "gigs", "hours", "profile"].map((key) => {
          const item = allItems.find((i) => i.key === key);
          if (!item) return null;
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={item.href}
              className="ehs-portal-bottomnav-item"
              data-active={isActive}
              style={{ color: isActive ? "var(--primary, #f88000)" : theme === "dark" ? "#94a3b8" : "#52525b" }}
            >
              <span style={{ position: "relative", display: "inline-flex" }}>
                <Icon size={22} strokeWidth={isActive ? 2.25 : 1.75} />
              </span>
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}

        <button
          type="button"
          className="ehs-portal-bottomnav-item pointer-events-auto cursor-pointer"
          data-active={!["hub", "gigs", "hours", "profile"].includes(active)}
          aria-expanded={isMoreOpen}
          aria-controls="portal-more-drawer"
          onClick={() => setIsMoreOpen((open) => !open)}
          style={{
            background: "transparent",
            border: 0,
            font: "inherit",
            pointerEvents: "auto",
            cursor: "pointer",
            color: !["hub", "gigs", "hours", "profile"].includes(active)
              ? "var(--primary, #f88000)"
              : theme === "dark"
                ? "#94a3b8"
                : "#52525b",
          }}
        >
          <span style={{ position: "relative", display: "inline-flex" }}>
            <MoreHorizontal size={22} strokeWidth={1.75} />
            {pendingBriefCount > 0 ? (
              <span className="ehs-portal-bottomnav-badge">
                {pendingBriefCount}
              </span>
            ) : null}
          </span>
          <span>{t("portal.nav.more")}</span>
        </button>
      </nav>

      {isMoreOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
              role="presentation"
              onClick={() => setIsMoreOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 50,
                background: "rgba(0, 0, 0, 0.6)",
                backdropFilter: "blur(4px)",
                pointerEvents: "auto",
              }}
            >
              <section
                id="portal-more-drawer"
                role="dialog"
                aria-modal="true"
                aria-label={t("portal.nav.more")}
                className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800"
                onClick={(event) => event.stopPropagation()}
                style={{
                  position: "fixed",
                  right: 0,
                  bottom: 0,
                  left: 0,
                  zIndex: 51,
                  borderRadius: "16px 16px 0 0",
                  padding: "24px 16px 32px",
                  background: theme === "dark" ? "#111827" : "#ffffff",
                  color: theme === "dark" ? "#ffffff" : "#0f172a",
                  borderTop: `1px solid ${theme === "dark" ? "#1e293b" : "#e2e8f0"}`,
                  boxShadow: "0 -12px 36px rgba(0, 0, 0, 0.24)",
                   maxHeight: "calc(100dvh - env(safe-area-inset-top) - 16px)",
                   overflowY: "auto",
                   overscrollBehavior: "contain",
                }}
              >
                <div
                  className="w-10 h-1 bg-slate-300 dark:bg-slate-700/60 rounded-full mx-auto mb-4"
                  aria-hidden="true"
                  style={{
                    width: 40,
                    height: 4,
                    margin: "0 auto 16px",
                    borderRadius: 999,
                    background: theme === "dark" ? "rgba(51, 65, 85, 0.6)" : "#cbd5e1",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <h2
                    className="text-slate-900 dark:text-white"
                    style={{ margin: 0, fontSize: 18, color: theme === "dark" ? "#ffffff" : "#0f172a" }}
                  >
                    {t("portal.nav.more")}
                  </h2>
                  <button
                    type="button"
                    className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                    aria-label={t("common.close")}
                    onClick={() => setIsMoreOpen(false)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 36,
                      height: 36,
                      padding: 0,
                      border: 0,
                      borderRadius: 999,
                      background: theme === "dark" ? "#1e293b" : "#f1f5f9",
                      color: theme === "dark" ? "#cbd5e1" : "#334155",
                      cursor: "pointer",
                    }}
                  >
                    <X size={18} strokeWidth={1.75} />
                  </button>
                </div>
                <div style={{ display: "grid", gap: 12 }}>
                  {(["briefs", "availability", "earnings", "runs", "tasks"] as const)
                    .map((key) => allItems.find((item) => item.key === key))
                    .filter((item): item is NavItem => Boolean(item))
                    .map((item) => {
                      const Icon = item.icon;
                      const isActive = active === item.key;
                      const showBadge = item.key === "briefs" && pendingBriefCount > 0;
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          className={
                            isActive
                              ? "flex items-center gap-3 px-4 py-3 rounded-xl bg-orange-500/10 text-orange-400 font-semibold border border-orange-500/20 no-underline hover:no-underline"
                              : "flex items-center gap-3 px-4 py-3 rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors no-underline hover:no-underline font-medium"
                          }
                          onClick={() => setIsMoreOpen(false)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "12px 16px",
                            borderRadius: 12,
                            color: isActive ? "#fb923c" : theme === "dark" ? "#cbd5e1" : "#334155",
                            background: isActive ? "rgba(249, 115, 22, 0.1)" : "transparent",
                            border: isActive
                              ? "1px solid rgba(249, 115, 22, 0.2)"
                              : "1px solid transparent",
                            fontWeight: isActive ? 600 : 500,
                            textDecoration: "none",
                          }}
                        >
                          <Icon size={18} strokeWidth={1.75} />
                          <span style={{ flex: 1, textAlign: "left", fontSize: 16 }}>
                            {t(item.labelKey)}
                          </span>
                          {showBadge ? (
                            <span className="ehs-shell-nav-badge">
                              {pendingBriefCount}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}

      <style>{`
        .ehs-portal-brief-tabs { display: none; }
        @media (max-width: 899px) {
          .ehs-portal-brief-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding: 12px 16px 0;
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
          }
          .ehs-portal-brief-tabs a {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            min-height: 44px;
            padding: 8px 14px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--card-bg);
            color: var(--text-main);
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
          }
          .ehs-portal-brief-tabs a[aria-current="page"] {
            border-color: var(--primary, #f88000);
            background: color-mix(in srgb, var(--primary, #f88000) 12%, var(--card-bg));
          }
          .ehs-portal-brief-tabs a:focus-visible {
            outline: 2px solid var(--primary, #f88000);
            outline-offset: 2px;
          }
          .ehs-portal-aside { display: none !important; }
          .ehs-portal-only-desktop { display: none !important; }
          .ehs-shell-crumbs { display: none !important; }
          .ehs-portal-mobile-header {
            padding-left: 8px !important;
            padding-right: 8px !important;
          }
          .ehs-portal-mobile-utilities {
            margin-left: auto !important;
            padding-right: 4px !important;
            gap: 6px !important;
          }
          .ehs-portal-mobile-utility,
          .ehs-portal-mobile-language .lang-fab-trigger {
            box-sizing: border-box !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            height: 32px !important;
            min-width: 32px !important;
            padding: 0 8px !important;
            border: 1px solid #cbd5e1 !important;
            border-radius: 6px !important;
            background: #f1f5f9 !important;
            color: #1e293b !important;
            font-size: 12px !important;
            font-weight: 600 !important;
            line-height: 1 !important;
            text-decoration: none !important;
            transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease !important;
          }
          .ehs-portal-mobile-utility:hover,
          .ehs-portal-mobile-language .lang-fab-trigger:hover {
            background: #e2e8f0 !important;
          }
          [data-theme="dark"] .ehs-portal-mobile-utility,
          [data-theme="dark"] .ehs-portal-mobile-language .lang-fab-trigger {
            border-color: rgba(51, 65, 85, 0.6) !important;
            background: rgba(30, 41, 59, 0.8) !important;
            color: #e2e8f0 !important;
          }
          [data-theme="dark"] .ehs-portal-mobile-utility:hover,
          [data-theme="dark"] .ehs-portal-mobile-language .lang-fab-trigger:hover {
            background: #334155 !important;
          }
        }
        @media (min-width: 900px) {
          .ehs-portal-only-mobile { display: none !important; }
          .ehs-portal-bottomnav { display: none !important; }
        }
      `}</style>

      {/* Direct fixed panel: deliberately outside the dropdown and free of
          Radix Dialog/Portal rendering. */}
      <FeedbackDialog
        isOpen={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
      <Toaster theme={pref === "system" ? "dark" : pref} />
    </div>
  );
}
