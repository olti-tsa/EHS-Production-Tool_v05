import React, { useEffect, useState } from "react";
import { PALETTE, type ThemeMode } from "../lib/portalTheme";
import {
  formatHumanDate,
  formatPhaseTime,
  hotelLineForDay,
} from "../lib/itineraryFormat";
import { useT } from "../../lib/i18n/I18nContext";

/** Per-day itinerary card shape — mirrors the server's response.
 *  Defined locally (not imported from the server lib) because the
 *  freelancer-portal artifact is built independently of api-server. */
type ItineraryDay = {
  date: string;
  dayOfWeek: string;
  working: boolean;
  callTime?: string;
  offTime?: string;
  phases: Array<{
    phaseKey: "setup" | "rehearsal" | "show" | "downrig";
    phaseLabel: string;
    fromTime?: string;
    toTime?: string;
    timeTbd?: boolean;
  }>;
  hotel?: {
    stayingTonight: boolean;
    isCheckIn: boolean;
    isCheckOut: boolean;
    roomKey?: string;
    roommateName?: string | null;
    locked?: boolean;
  };
  venue: string;
};

type ItineraryResponse = {
  ok: boolean;
  brief?: { id: string; projectName: string; venue: string };
  days?: ItineraryDay[];
  error?: string;
};

/** Section that renders the freelancer's per-day itinerary for one
 *  brief. Owns its own data fetch so the parent screen doesn't have
 *  to thread anything through besides the brief id + the auth token
 *  fetcher (matches the rest of the portal's request pattern in
 *  BriefDetail).
 *
 *  Renders nothing visible while loading the first time so the page
 *  doesn't flash an empty card. On 403 (caller hasn't accepted yet)
 *  the section also renders nothing — the assignment card above will
 *  prompt them to accept first. Other errors render a small
 *  retryable banner so the freelancer isn't left wondering. */
export function ItinerarySection({
  briefId,
  theme,
  getToken,
}: {
  briefId: string;
  theme: ThemeMode;
  getToken: () => Promise<string | null>;
}) {
  const c = PALETTE[theme];
  const [days, setDays] = useState<ItineraryDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const baseUrl =
          (typeof import.meta !== "undefined" &&
            (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) ||
          "/";
        const res = await fetch(
          `${baseUrl}api/portal/briefs/${briefId}/itinerary`,
          {
            method: "GET",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
        );
        if (cancelled) return;
        if (res.status === 403) {
          // Caller hasn't accepted yet — hide the whole section
          // silently. The accept/decline UI above is the right
          // surface for that state.
          setHidden(true);
          return;
        }
        if (res.status === 404) {
          setHidden(true);
          return;
        }
        const json = (await res.json().catch(() => ({}))) as ItineraryResponse;
        if (!res.ok || !json.ok) {
          setError(json.error || `Server returned ${res.status}`);
          return;
        }
        setError(null);
        setHidden(false);
        setDays(json.days ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [briefId, getToken, reloadKey]);

  if (hidden) return null;
  // First-load: render nothing rather than a "Loading…" placeholder
  // — the surrounding page already has its own structure and we'd
  // rather appear instantly with content than flash a skeleton.
  if (days === null && !error) return null;

  return (
    <section
      style={{
        background: c.cardBg,
        border: `1px solid ${c.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <strong style={{ fontSize: 15, color: c.text }}>
            Your itinerary
          </strong>
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              color: c.muted,
            }}
          >
            Day-by-day for this trip
          </span>
        </div>
        {error ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setReloadKey((n) => n + 1);
            }}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              background: "transparent",
              color: c.text,
              border: `1px solid ${c.border}`,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          style={{
            fontSize: 13,
            color: c.text,
            background: "rgba(248,128,0,0.08)",
            border: `1px solid ${c.accent}`,
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          Could not load your itinerary — {error}
        </div>
      ) : null}

      {!error && days && days.length === 0 ? (
        <div style={{ fontSize: 13, color: c.muted }}>
          No itinerary days yet. Once the producer fills in the schedule
          you'll see your plan here.
        </div>
      ) : null}

      {!error && days && days.length > 0 ? (
        <div style={{ display: "grid", gap: 10 }}>
          {days.map((d) => (
            <ItineraryDayCard key={d.date} day={d} theme={theme} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ItineraryDayCard({
  day,
  theme,
}: {
  day: ItineraryDay;
  theme: ThemeMode;
}) {
  const c = PALETTE[theme];
  const t = useT();
  // formatHumanDate now embeds the weekday via Intl, so we don't render
  // `day.dayOfWeek` separately — that field is server-emitted English
  // and would visually clash with a localised date for non-English
  // browsers (e.g. "Mon 1. mai 2026").
  const formatted = formatHumanDate(day.date);
  return (
    <div
      style={{
        background: c.cardBgSubtle,
        border: `1px solid ${c.border}`,
        borderRadius: 10,
        padding: "10px 12px",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ fontSize: 14, color: c.text }}>{formatted}</strong>
        {day.working ? <Chip theme={theme} kind="working" label={t("portal.itinerary.working")} /> : null}
        {day.hotel?.isCheckIn ? (
          <Chip theme={theme} kind="hotel" label={t("portal.itinerary.hotelCheckIn")} />
        ) : null}
        {day.hotel?.isCheckOut ? (
          <Chip theme={theme} kind="hotel" label={t("portal.itinerary.hotelCheckOut")} />
        ) : null}
      </div>

      {day.callTime || day.offTime ? (
        <div style={{ fontSize: 13, color: c.text }}>
          {day.callTime ? (
            <>
              <strong style={{ color: c.muted, fontWeight: 600 }}>{t("portal.itinerary.call")}:</strong>{" "}
              {day.callTime}
            </>
          ) : null}
          {day.callTime && day.offTime ? (
            <span style={{ color: c.muted }}> · </span>
          ) : null}
          {day.offTime ? (
            <>
              <strong style={{ color: c.muted, fontWeight: 600 }}>{t("portal.itinerary.off")}:</strong>{" "}
              {day.offTime}
            </>
          ) : null}
        </div>
      ) : null}

      {day.phases.length > 0 ? (
        <div style={{ fontSize: 13, color: c.text }}>
          <strong style={{ color: c.muted, fontWeight: 600 }}>
            {t("portal.itinerary.production")}:
          </strong>{" "}
          {day.phases.map((p, i) => {
            const time = p.timeTbd
              ? "TBD"
              : formatPhaseTime(p.fromTime, p.toTime);
            return (
              <span key={`${p.phaseKey}-${i}`}>
                {i > 0 ? <span style={{ color: c.muted }}> · </span> : null}
                {p.phaseLabel}
                {time ? (
                  <span style={{ color: c.muted }}> ({time})</span>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}

      {day.hotel ? (
        <div style={{ fontSize: 13, color: c.text }}>
          <strong style={{ color: c.muted, fontWeight: 600 }}>{t("portal.itinerary.hotel")}:</strong>{" "}
          {hotelLineForDay(day.hotel)}
        </div>
      ) : null}

      {day.venue ? (
        <div style={{ fontSize: 12, color: c.muted }}>📍 {day.venue}</div>
      ) : null}
    </div>
  );
}

function Chip({
  theme,
  kind,
  label,
}: {
  theme: ThemeMode;
  kind: "working" | "hotel";
  label: string;
}) {
  const c = PALETTE[theme];
  const bg =
    kind === "working" ? "rgba(67,160,71,0.15)" : "rgba(33,150,243,0.15)";
  const fg = kind === "working" ? "#43a047" : "#2196f3";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color: fg,
        border: `1px solid ${c.border}`,
        borderRadius: 999,
      }}
    >
      {label}
    </span>
  );
}

// Formatting helpers (formatHumanDate / formatPhaseTime / hotelLineForDay)
// live in `../lib/itineraryFormat` so they can be unit-tested without
// pulling in JSX.
