import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useSignIn,
  useAuth,
  useUser,
} from "@clerk/react";
import { dark } from "@clerk/themes";
import { Redirect, Route, Router, Switch, useLocation } from "wouter";
import App from "./App";
import AdminUsersPage from "./AdminUsersPage";
import AdminFeedbackPage from "./AdminFeedbackPage";
import { Portal } from "./portal/Portal";
import { I18nProvider, useT } from "./lib/i18n/I18nContext";
import { FartButton } from "./components/fart/FartButton";
import { LanguageSelector } from "./components/LanguageSelector";
import "./index.css";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as
  | string
  | undefined;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const STORAGE_KEY_V2 = "ehs-rigging-report-v2";
/** What we actually apply to `document.documentElement[data-theme]` and pass
 *  to Clerk. Always concrete (no "system"). */
type ThemeMode = "light" | "dark";
/** What the user picks; "system" follows the OS `prefers-color-scheme`. */
type ThemePreference = "light" | "dark" | "system";

function loadInitialThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (
        parsed?.theme === "dark" ||
        parsed?.theme === "light" ||
        parsed?.theme === "system"
      ) {
        return parsed.theme;
      }
    }
  } catch {}
  return "system";
}

function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveTheme(pref: ThemePreference): ThemeMode {
  return pref === "system" ? getSystemTheme() : pref;
}

function saveThemePreference(pref: ThemePreference) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed.theme = pref;
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(parsed));
  } catch {}
}

// EHS brand accent — orange (#F88000)
// to match the Tactical Command Center redesign that ships across the app.
// Constant name kept as `EHS_ORANGE` to avoid a sweeping rename across
// dozens of inline-styled call sites; treat it as "EHS brand accent".
const EHS_ORANGE = "#F88000";

const PALETTE = {
  light: {
    pageBg: "#f7f7fb",
    cardBg: "#ffffff",
    border: "#e6e6ee",
    text: "#0f172a",
    muted: "#64748b",
    inputBg: "#ffffff",
    inviteBg: "#ffffff",
    shadow: "0 20px 60px rgba(15,23,42,0.10)",
  },
  dark: {
    pageBg: "#1C1C24",
    cardBg: "#25252F",
    border: "rgba(255,255,255,0.08)",
    text: "#E5E5EC",
    muted: "#9999A6",
    inputBg: "#1C1C24",
    inviteBg: "rgba(28,28,36,0.6)",
    shadow: "0 20px 60px rgba(0,0,0,0.55)",
  },
} as const;

function buildAppearance(theme: ThemeMode) {
  const c = PALETTE[theme];
  return {
    baseTheme: theme === "dark" ? dark : undefined,
    variables: {
      colorPrimary: EHS_ORANGE,
      colorBackground: c.cardBg,
      colorForeground: c.text,
      colorMutedForeground: c.muted,
      colorInput: c.inputBg,
      colorInputForeground: c.text,
      colorNeutral: c.border,
      colorDanger: "#dc2626",
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      borderRadius: "10px",
    },
    elements: {
      rootBox: { width: "100%", display: "flex", justifyContent: "center" },
      cardBox: {
        backgroundColor: "transparent",
        border: "none",
        borderRadius: 0,
        width: "100%",
        maxWidth: "100%",
        overflow: "visible",
        boxShadow: "none",
      },
      card: {
        backgroundColor: "transparent",
        boxShadow: "none",
        border: "none",
        borderRadius: 0,
        padding: 0,
      },
      footer: {
        backgroundColor: "transparent",
        boxShadow: "none",
        border: "none",
        borderRadius: 0,
      },
      header: { display: "none" },
      headerTitle: { color: c.text },
      headerSubtitle: { color: c.muted },
      formFieldLabel: { color: c.text },
      formFieldInput: {
        backgroundColor: c.inputBg,
        color: c.text,
        border: `1px solid ${c.border}`,
      },
      formButtonPrimary: {
        backgroundColor: EHS_ORANGE,
        color: "#0b0b0b",
        fontWeight: 600,
      },
      footerActionText: { color: c.muted },
      footerActionLink: { color: EHS_ORANGE, fontWeight: 600 },
      footerAction: { display: "none" },
      dividerText: { color: c.muted },
      dividerLine: { backgroundColor: c.border },
      socialButtonsBlockButton: {
        backgroundColor: c.cardBg,
        color: c.text,
        border: `1px solid ${c.border}`,
        fontWeight: 600,
      },
      socialButtonsBlockButtonText: { color: c.text, fontWeight: 600 },
      socialButtonsIconButton: {
        backgroundColor: c.cardBg,
        border: `1px solid ${c.border}`,
      },
      identityPreviewEditButton: { color: EHS_ORANGE },
      formFieldSuccessText: { color: "#16a34a" },
      alertText: { color: c.text },
    },
  };
}

type AuthMode = "signIn" | "signUp";
type LoginIntent = "employee" | "freelancer";

const AUTH_MODE_KEY = "ehs-auth-mode";
const LOGIN_INTENT_KEY = "ehs-login-intent";
const USER_ROLE_KEY = "ehs-user-role";

function loadUserRole(): LoginIntent | null {
  try {
    const raw = localStorage.getItem(USER_ROLE_KEY);
    if (raw === "employee" || raw === "freelancer") return raw;
  } catch {
    /* localStorage may be unavailable */
  }
  return null;
}

function saveUserRole(role: LoginIntent | null) {
  try {
    if (role) {
      localStorage.setItem(USER_ROLE_KEY, role);
    } else {
      localStorage.removeItem(USER_ROLE_KEY);
    }
  } catch {
    /* localStorage may be unavailable */
  }
}

export function clearUserRole() {
  saveUserRole(null);
}

function loadInitialAuthMode(): AuthMode {
  try {
    const raw = sessionStorage.getItem(AUTH_MODE_KEY);
    if (raw === "signUp" || raw === "signIn") return raw;
  } catch {
    /* sessionStorage may be unavailable */
  }
  return "signIn";
}

function loadInitialLoginIntent(): LoginIntent | null {
  try {
    const raw = sessionStorage.getItem(LOGIN_INTENT_KEY);
    if (raw === "employee" || raw === "freelancer") return raw;
  } catch {
    /* sessionStorage may be unavailable */
  }
  return null;
}

function saveLoginIntent(intent: LoginIntent | null) {
  try {
    if (intent) {
      sessionStorage.setItem(LOGIN_INTENT_KEY, intent);
    } else {
      sessionStorage.removeItem(LOGIN_INTENT_KEY);
    }
  } catch {
    /* sessionStorage may be unavailable */
  }
}

/**
 * Three-way theme picker for the sign-in screen and any other surface
 * that needs an inline-styled segmented control matching the
 * Production Tool's `ThemeSegmentedControl`. Inline-styled so it works
 * outside of `index.css` scope (sign-in is rendered before the
 * dashboard mounts; Portal lives in its own visual shell).
 *
 * Implements the ARIA radiogroup keyboard pattern: only the selected
 * radio is in the tab order; ArrowLeft/Right (and Home/End) move focus
 * AND change the selection.
 */
function InlineThemeSegmentedControl({
  pref,
  onChange,
  theme,
  size = "md",
}: {
  pref: ThemePreference;
  onChange: (next: ThemePreference) => void;
  theme: ThemeMode;
  size?: "sm" | "md";
}) {
  const c = PALETTE[theme];
  const t = useT();
  const options: ReadonlyArray<{
    value: ThemePreference;
    labelKey:
      | "theme.light"
      | "theme.dark"
      | "theme.system";
    ariaKey:
      | "theme.lightAria"
      | "theme.darkAria"
      | "theme.systemAria";
    icon: string;
  }> = [
    {
      value: "light",
      labelKey: "theme.light",
      ariaKey: "theme.lightAria",
      icon: "☀",
    },
    {
      value: "dark",
      labelKey: "theme.dark",
      ariaKey: "theme.darkAria",
      icon: "☾",
    },
    {
      value: "system",
      labelKey: "theme.system",
      ariaKey: "theme.systemAria",
      icon: "⌬",
    },
  ];
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === pref),
  );
  const move = (next: number) => {
    const i = ((next % options.length) + options.length) % options.length;
    onChange(options[i].value);
    btnRefs.current[i]?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(selectedIndex + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(selectedIndex - 1);
        break;
      case "Home":
        e.preventDefault();
        move(0);
        break;
      case "End":
        e.preventDefault();
        move(options.length - 1);
        break;
      default:
        break;
    }
  };
  const padX = size === "sm" ? 8 : 10;
  const padY = size === "sm" ? 5 : 7;
  const fontSize = size === "sm" ? 12 : 13;
  return (
    <div
      role="radiogroup"
      aria-label={t("theme.label")}
      title={t("theme.title")}
      onKeyDown={onKeyDown}
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        background: c.pageBg,
        border: `1px solid ${c.border}`,
        borderRadius: 10,
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {options.map((o, i) => {
        const selected = pref === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={t(o.ariaKey)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: `${padY}px ${padX}px`,
              fontSize,
              fontWeight: 600,
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              background: selected ? EHS_ORANGE : "transparent",
              color: selected ? "#0b0b0b" : c.text,
              transition: "background 120ms ease, color 120ms ease",
              fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
            }}
          >
            <span aria-hidden>{o.icon}</span>
            <span>{t(o.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Compact icon-only theme picker. Shows just the current preference's
 * glyph (☀ / ☾ / ⌬) in a 40×32 pill that matches the LanguageSelector
 * trigger. Tapping opens a popover with the three labelled options;
 * picking one applies it immediately and dismisses the menu. Click-
 * outside and Escape both close. Used on the sign-in screen where
 * vertical space is tight on phones.
 */
function ThemeFab({
  pref,
  onChange,
  theme,
}: {
  pref: ThemePreference;
  onChange: (next: ThemePreference) => void;
  theme: ThemeMode;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const options: ReadonlyArray<{
    value: ThemePreference;
    labelKey: "theme.light" | "theme.dark" | "theme.system";
    ariaKey: "theme.lightAria" | "theme.darkAria" | "theme.systemAria";
    icon: string;
  }> = [
    { value: "light", labelKey: "theme.light", ariaKey: "theme.lightAria", icon: "☀" },
    { value: "dark", labelKey: "theme.dark", ariaKey: "theme.darkAria", icon: "☾" },
    { value: "system", labelKey: "theme.system", ariaKey: "theme.systemAria", icon: "⌬" },
  ];
  const current = options.find((o) => o.value === pref) ?? options[2];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("theme.label")}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("theme.title")}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 40,
          height: 32,
          padding: 0,
          fontSize: 16,
          lineHeight: 1,
          borderRadius: 8,
          border: `1px solid ${c.border}`,
          background: c.cardBg,
          color: c.text,
          cursor: "pointer",
          boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        <span aria-hidden>{current.icon}</span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={t("theme.label")}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            minWidth: 160,
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: c.cardBg,
            border: `1px solid ${c.border}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            zIndex: 80,
            fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          }}
        >
          {options.map((o) => {
            const selected = o.value === pref;
            return (
              <li key={o.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={t(o.ariaKey)}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    requestAnimationFrame(() => triggerRef.current?.focus());
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    fontSize: 13,
                    fontWeight: 600,
                    background: selected ? EHS_ORANGE : "transparent",
                    color: selected ? "#0b0b0b" : c.text,
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span aria-hidden style={{ fontSize: 15, width: 18, textAlign: "center" }}>
                    {o.icon}
                  </span>
                  <span style={{ flex: 1 }}>{t(o.labelKey)}</span>
                  {selected && (
                    <span aria-hidden style={{ fontSize: 12 }}>
                      ✓
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SignInScreen({
  theme,
  pref,
  setPref,
}: {
  theme: ThemeMode;
  pref: ThemePreference;
  setPref: (next: ThemePreference) => void;
}) {
  const c = PALETTE[theme];
  const t = useT();
  const [mode, setModeState] = useState<AuthMode>(() => loadInitialAuthMode());
  const [intent, setIntentState] = useState<LoginIntent>(
    () => loadInitialLoginIntent() ?? "employee",
  );
  const setMode = (next: AuthMode) => {
    try {
      sessionStorage.setItem(AUTH_MODE_KEY, next);
    } catch {
      /* sessionStorage may be unavailable */
    }
    setModeState(next);
  };
  const setIntent = (next: LoginIntent) => {
    // Only persist the session-scoped intent here. The persistent
    // `ehs-user-role` key is promoted from intent by `PostLoginRedirect`
    // *after* a successful sign-in. Writing it on tab toggle would mean
    // a user who merely clicks "Freelancer" once (without signing in)
    // would be auto-routed to the Portal forever on subsequent sessions
    // whenever Clerk restored their cookie.
    saveLoginIntent(next);
    setIntentState(next);
  };

  const roles: ReadonlyArray<{
    id: LoginIntent;
    labelKey: "signin.role.employee" | "signin.role.freelancer";
    subKey: "signin.role.employee.sub" | "signin.role.freelancer.sub";
  }> = [
    {
      id: "employee",
      labelKey: "signin.role.employee",
      subKey: "signin.role.employee.sub",
    },
    {
      id: "freelancer",
      labelKey: "signin.role.freelancer",
      subKey: "signin.role.freelancer.sub",
    },
  ];

  const productLabel =
    intent === "freelancer"
      ? t("signin.product.portal")
      : t("signin.product.tool");

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        background: c.pageBg,
        color: c.text,
        boxSizing: "border-box",
        gap: "20px",
        position: "relative",
      }}
    >
      {/* Three-way theme picker (Light / Dark / System). Rendered as
          a compact icon trigger that opens a popover with the three
          options — mirrors the language pill's footprint so the two
          sit side-by-side as a paired top-right toolbar. The wider
          segmented control is still used elsewhere (Portal header). */}
      <div className="signin-theme-fab">
        <ThemeFab pref={pref} onChange={setPref} theme={theme} />
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: c.cardBg,
          border: `1px solid ${c.border}`,
          borderRadius: 16,
          boxShadow: c.shadow,
          padding: "32px 28px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
          boxSizing: "border-box",
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        <img
          src={`${basePath}/logo.png`}
          alt="EHS"
          style={{ height: "48px", width: "auto" }}
        />

        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 0.2,
              color: c.text,
            }}
          >
            {t("signin.title")}
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: c.muted,
              fontWeight: 500,
            }}
          >
            {productLabel}
          </div>
        </div>

        <div
          role="radiogroup"
          aria-label={t("signin.role.aria")}
          style={{
            display: "flex",
            width: "100%",
            padding: 4,
            borderRadius: 12,
            background: c.pageBg,
            border: `1px solid ${c.border}`,
            gap: 4,
          }}
        >
          {roles.map((role) => {
            const active = intent === role.id;
            return (
              <button
                key={role.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setIntent(role.id)}
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  padding: "10px 12px",
                  fontSize: 14,
                  fontWeight: 700,
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background: active ? EHS_ORANGE : "transparent",
                  color: active ? "#0b0b0b" : c.text,
                  transition:
                    "background 120ms ease, color 120ms ease",
                  fontFamily:
                    "'Inter', system-ui, -apple-system, sans-serif",
                }}
              >
                <span>{t(role.labelKey)}</span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    opacity: 0.85,
                    color: active ? "#0b0b0b" : c.muted,
                  }}
                >
                  {t(role.subKey)}
                </span>
              </button>
            );
          })}
        </div>

        <div
          role="tablist"
          aria-label={t("signin.tab.aria")}
          style={{
            display: "flex",
            alignSelf: "stretch",
            justifyContent: "center",
            gap: 28,
            borderBottom: `1px solid ${c.border}`,
          }}
        >
          {((): ReadonlyArray<{
            id: AuthMode;
            labelKey: "signin.tab.signIn" | "signin.tab.signUp";
          }> => {
            // Sign-up tab is open on both sides of the role toggle.
            const tabs: Array<{
              id: AuthMode;
              labelKey: "signin.tab.signIn" | "signin.tab.signUp";
            }> = [
              { id: "signIn", labelKey: "signin.tab.signIn" },
              { id: "signUp", labelKey: "signin.tab.signUp" },
            ];
            return tabs;
          })().map((opt) => {
            const active = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMode(opt.id)}
                style={{
                  padding: "8px 4px 10px",
                  fontSize: 14,
                  fontWeight: 600,
                  background: "transparent",
                  border: "none",
                  borderBottom: active
                    ? `2px solid ${EHS_ORANGE}`
                    : "2px solid transparent",
                  marginBottom: -1,
                  color: active ? c.text : c.muted,
                  cursor: "pointer",
                  fontFamily:
                    "'Inter', system-ui, -apple-system, sans-serif",
                  transition:
                    "color 120ms ease, border-color 120ms ease",
                }}
              >
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>

        <div style={{ width: "100%" }}>
          {mode === "signIn" ? (
            <SignIn routing="hash" />
          ) : (
            <SignUp routing="hash" />
          )}
        </div>
      </div>

      <div
        style={{
          maxWidth: "480px",
          width: "100%",
          textAlign: "center",
          color: c.muted,
          fontSize: "13px",
          lineHeight: 1.55,
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        {t("signin.contact", { email: "" })}{" "}
        <a
          href="mailto:utleie@ehs.no"
          style={{ color: EHS_ORANGE, fontWeight: 600 }}
        >
          utleie@ehs.no
        </a>
      </div>
    </div>
  );
}

export { InlineThemeSegmentedControl };
export type { ThemePreference };


/**
 * Resolve the signed-in user's route from their verified primary Clerk
 * email. Only a verified primary @ehs.no address is employee-eligible;
 * every other account is routed as a freelancer. The server enforces the
 * same rule independently for API authorization.
 */
function useClerkUserType(): "employee" | "freelancer" | null {
  const { isLoaded, user } = useUser();
  if (!isLoaded) return null;
  const primary = user?.primaryEmailAddress;
  const email = primary?.emailAddress?.trim().toLowerCase();
  return primary?.verification?.status === "verified" &&
    email?.endsWith("@ehs.no")
    ? "employee"
    : "freelancer";
}

function PostLoginRedirect() {
  const [location, setLocation] = useLocation();
  const serverRole = useClerkUserType();
  const { getToken } = useAuth();
  // Capture the sign-in vs sign-up mode synchronously at render time.
  // The sibling `ClearAuthMode` component also runs in a useEffect on
  // signed-in mount and removes this key — without capturing it
  // up-front, the bootstrap-tag call below would race with that
  // cleanup and miss the signal that the user just *signed up* (as
  // opposed to merely signed in).
  const authModeAtMount = useRef<AuthMode>(loadInitialAuthMode());
  useEffect(() => {
    let cancelled = false;
    const intent = loadInitialLoginIntent();
    // The verified primary email classification always wins over the tab
    // selected before authentication.
    const effective: LoginIntent | null = serverRole;

    // Bootstrap-tag a brand-new freelancer in Clerk publicMetadata so
    // the Production Tool refuses to load for them even before they
    // save their first profile row. We only fire when (a) the user
    // came from the Frilanser tab AND (b) they actually completed
    // *sign-up* (not just sign-in), so an existing employee who
    // accidentally toggled the Frilanser tab to sign in is left
    // untouched. The server endpoint additionally refuses to
    // downgrade an already-tagged employee, but this client-side
    // gate keeps the call from happening in the first place.
    if (
      intent === "freelancer" &&
      authModeAtMount.current === "signUp" &&
      serverRole === "freelancer"
    ) {
      (async () => {
        try {
          const token = await getToken();
          const baseUrl =
            (typeof import.meta !== "undefined" &&
              (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
            "/";
          await fetch(`${baseUrl}api/portal/me/tag-as-freelancer`, {
            method: "POST",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
        } catch {
          // Best-effort metadata synchronization only. Frontend routing and
          // backend authorization already classify this account by its
          // verified primary email.
        }
      })();
    }

    void (async () => {
      if (!effective || cancelled) return;
      saveUserRole(effective);
      const inPortal =
        location === "/portal" || location.startsWith("/portal/");
      if (effective === "freelancer" && !inPortal) {
        setLocation("/portal");
      }
      saveLoginIntent(null);
    })();
    // We only want this to run once after mount (post sign-in landing),
    // re-running if `serverRole` flips from null → resolved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      cancelled = true;
    };
  }, [serverRole]);
  return null;
}

/**
 * Continuous guard that locks freelancers to the /portal/* surface while
 * allowing employees to use both the Production Tool and Freelancer Portal.
 * Runs on every location change. Once Clerk is loaded, the verified primary
 * email classification wins; local storage is only a loading-time fallback.
 */
function FreelancerGuard() {
  const [location, setLocation] = useLocation();
  const localRole = loadUserRole();
  const serverRole = useClerkUserType();
  // Once Clerk resolves, ignore any stale local role flag and use the
  // verified primary email classification. localRole only prevents a flash
  // of the wrong surface while Clerk is still loading.
  useEffect(() => {
    if (serverRole === "employee" && localRole === "freelancer") {
      saveUserRole(null);
    }
  }, [serverRole, localRole]);
  const isFreelancer =
    serverRole === "freelancer" ||
    (serverRole === null && localRole === "freelancer");
  useEffect(() => {
    const inPortal = location === "/portal" || location.startsWith("/portal/");
    if (isFreelancer && !inPortal) {
      setLocation("/portal");
    }
  }, [isFreelancer, serverRole, location, setLocation]);
  return null;
}

function Root() {
  return (
    <I18nProvider>
      <LocalizedRoot />
    </I18nProvider>
  );
}

function LocalizedRoot() {
  const t = useT();
  const [pref, setPref] = useState<ThemePreference>(() =>
    loadInitialThemePreference(),
  );
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() =>
    getSystemTheme(),
  );

  // Track OS preference changes so "system" stays in sync.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) =>
      setSystemTheme(e.matches ? "dark" : "light");
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  // Concrete theme that's actually applied to data-theme + Clerk.
  const theme: ThemeMode = pref === "system" ? systemTheme : pref;

  // Apply data-theme on every change.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  // Persist the *preference* (not the resolved theme), so "system" round-trips
  // correctly across reloads. Skip the very first mount: writing on mount
  // would race with App.tsx's PersistedV2 writeback over the same storage key,
  // and during a V1→V2 migration could overwrite a freshly migrated legacy
  // preference. We only persist on real user changes.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    saveThemePreference(pref);
  }, [pref]);

  return (
    <ClerkProvider
        publishableKey={clerkPubKey!}
        proxyUrl={clerkProxyUrl}
        appearance={buildAppearance(theme)}
        localization={{
          signIn: {
            start: {
              title: t("signin.clerk.signInTitle"),
              subtitle: t("signin.clerk.product"),
            },
          },
          signUp: {
            start: {
              title: t("signin.clerk.signUpTitle"),
              subtitle: t("signin.clerk.product"),
            },
          },
        }}
      >
        <AuthGate theme={theme} pref={pref} setPref={setPref} />
    </ClerkProvider>
  );
}

function AuthGate({
  theme,
  pref,
  setPref,
}: {
  theme: ThemeMode;
  pref: ThemePreference;
  setPref: (next: ThemePreference) => void;
}) {
  const { signIn } = useSignIn();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const attemptedRef = useRef(false);
  const [devStatus, setDevStatus] = useState<"pending" | "done">(() => {
    if (!import.meta.env.DEV) return "done";
    try {
      if (sessionStorage.getItem("ehs-skip-dev-auto-signin") === "1") {
        sessionStorage.removeItem("ehs-skip-dev-auto-signin");
        return "done";
      }
    } catch {
      /* sessionStorage may be unavailable */
    }
    return "pending";
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (devStatus === "done") return;
    if (!authLoaded) return;
    if (isSignedIn) {
      setDevStatus("done");
      return;
    }
    if (attemptedRef.current) return;
    if (!signIn) return;
    attemptedRef.current = true;
    (async () => {
      try {
        const tokenRes = await fetch("/api/dev/auto-signin-token", {
          method: "POST",
        });
        if (!tokenRes.ok) {
          console.warn(
            "[dev auto-sign-in] token endpoint failed:",
            tokenRes.status,
          );
          return;
        }
        const { ticket } = (await tokenRes.json()) as { ticket?: string };
        if (!ticket) {
          console.warn("[dev auto-sign-in] no ticket returned");
          return;
        }
        const tRes = await signIn.create({ strategy: "ticket", ticket });
        if (tRes.error) {
          console.warn("[dev auto-sign-in] ticket failed:", tRes.error);
          return;
        }
        if (signIn.status === "complete") {
          const finRes = await signIn.finalize();
          if (finRes.error) {
            console.warn("[dev auto-sign-in] finalize failed:", finRes.error);
          }
        } else {
          console.warn(
            "[dev auto-sign-in] unexpected status:",
            signIn.status,
          );
        }
      } catch (err) {
        console.warn("[dev auto-sign-in] failed:", err);
      } finally {
        setDevStatus("done");
      }
    })();
  }, [signIn, authLoaded, isSignedIn, devStatus]);

  return (
    <>
      <Show when="signed-in">
        <ClearAuthMode />
        {/* Note: I18nProvider is mounted at <Root> above ClerkProvider so
            both signed-in (Portal/App) and signed-out (SignInScreen) share
            a single locale state. Don't re-wrap here — that would create
            an inner provider with its own state and the language selector
            on the sign-in screen would be invisible. */}
        <Router base={basePath}>
          <PostLoginRedirect />
          <FreelancerGuard />
          <Switch>
            <Route path="/portal">
              <Portal theme={theme} pref={pref} setPref={setPref} />
            </Route>
            {/* Use the wildcard `*` rather than `:rest*` because regexparam
                v3 (the matcher wouter v3 ships with) parses `:rest*` as a
                single-segment optional, so multi-segment URLs like
                `/portal/brief/import` would otherwise fall through to the
                catchall and render the producer App. */}
            <Route path="/portal/*">
              <Portal theme={theme} pref={pref} setPref={setPref} />
            </Route>
            <Route path="/admin/users">
              <AdminUsersPage />
            </Route>
            <Route path="/admin/feedback">
              <AdminFeedbackPage />
            </Route>
            <Route>
              <ProductionToolGate />
            </Route>
          </Switch>
        </Router>
      </Show>
      <Show when="signed-out">
        <ClearUserRoleOnSignedOut />
        {devStatus === "pending" ? (
          <DevSigningInScreen theme={theme} />
        ) : (
          <>
            <SignInScreen theme={theme} pref={pref} setPref={setPref} />
            {/* Language selector also available before sign-in so users
                can switch the UI language while reading the role tabs and
                product label. */}
            <div className="lang-fab-anchor">
              <LanguageSelector />
            </div>
          </>
        )}
      </Show>
    </>
  );
}

/**
 * Catchall-route gate for the Production Tool. Renders <App /> only
 * for confirmed employees. Freelancers (by Clerk metadata OR by
 * persisted local role OR by the sign-in tab they just picked) get
 * redirected to the portal. While Clerk is still loading the user
 * object we render nothing — better a half-second of blank than
 * flashing the Production Tool to a freelancer for one frame.
 */
function ProductionToolGate() {
  const serverRole = useClerkUserType();
  const localRole = loadUserRole();
  const intent = loadInitialLoginIntent();
  if (serverRole === null) {
    // Clerk hasn't resolved yet; defer rendering until we know the
    // authoritative type.
    return null;
  }
  // Server (Clerk publicMetadata) wins. If Clerk says "employee",
  // ignore any stale localStorage/intent flag from a prior portal
  // visit — otherwise an employee who once clicked the Frilanser tab
  // is permanently locked out of the Production Tool.
  if (serverRole === "freelancer") {
    return <Redirect to="/portal" />;
  }
  if (serverRole === "employee") {
    // fall through to render <App />
  } else if (localRole === "freelancer" || intent === "freelancer") {
    return <Redirect to="/portal" />;
  }
  return (
    <>
      <App />
      {/* Floating Fart Button — Production Tool only. Intentionally
          NOT rendered on the Freelance Portal so freelancers don't
          see it. Lives inside the catchall route so it unmounts on
          navigation to /portal. Self-contained: no Production-Tool
          state, no autosave coupling, no keyboard-shortcut
          interference. */}
      <FartButton />
    </>
  );
}

function ClearAuthMode() {
  useEffect(() => {
    try {
      sessionStorage.removeItem(AUTH_MODE_KEY);
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, []);
  return null;
}

/**
 * When the app reaches the signed-out state (sign-out via any path,
 * session expiry, etc.), clear the persisted role so the next user
 * starts from a clean slate and the FreelancerGuard does not act on
 * stale data.
 */
function ClearUserRoleOnSignedOut() {
  useEffect(() => {
    saveUserRole(null);
    saveLoginIntent(null);
    try {
      sessionStorage.removeItem(AUTH_MODE_KEY);
    } catch {
      /* sessionStorage may be unavailable */
    }
  }, []);
  return null;
}

function DevSigningInScreen({ theme }: { theme: ThemeMode }) {
  const c = PALETTE[theme];
  const t = useT();
  return (
    <div
      style={{
        minHeight: "100vh",
        background: c.pageBg,
        color: c.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "16px",
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <img
        src="/logo.png"
        alt="EHS"
        style={{ height: "60px", opacity: 0.85 }}
      />
      <div style={{ fontSize: "14px", color: c.muted }}>
        {t("signin.adminPreview")}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
