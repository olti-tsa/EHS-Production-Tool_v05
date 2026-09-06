import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/react";
import { useT } from "../../lib/i18n/I18nContext";
import {
  playFart,
  randomIntensity,
  type FartIntensity,
} from "./fartSounds";
import "./fart.css";

/** How long the post-submit overlay stays mounted, per intensity. */
const OVERLAY_DURATION_MS: Record<FartIntensity, number> = {
  small: 1500,
  medium: 2200,
  nuclear: 3000,
};

/** Cloud count per intensity. */
const CLOUD_COUNT: Record<FartIntensity, number> = {
  small: 8,
  medium: 14,
  nuclear: 22,
};

/**
 * Per-cloud randomised animation parameters. Generated once per overlay
 * mount via `useMemo` so React doesn't re-shuffle them on every paint.
 */
interface CloudConfig {
  id: number;
  topPct: number;
  leftPct: number;
  delayMs: number;
  durationMs: number;
  /** Translate-x at end of animation, px. */
  dx: number;
  /** Translate-y at end of animation, px (negative = float upward). */
  dy: number;
  /** Final rotation, deg. */
  rot: number;
  /** Emoji to display — rotates through a small visual pool. */
  emoji: string;
}

const CLOUD_EMOJIS = ["💨", "💨", "💨", "🟢", "💚"];

function buildClouds(intensity: FartIntensity): CloudConfig[] {
  const count = CLOUD_COUNT[intensity];
  const clouds: CloudConfig[] = [];
  for (let i = 0; i < count; i++) {
    clouds.push({
      id: i,
      topPct: 20 + Math.random() * 60,
      leftPct: 5 + Math.random() * 90,
      delayMs: Math.random() * 400,
      durationMs: 1200 + Math.random() * 1400,
      dx: (Math.random() - 0.5) * 240,
      dy: -80 - Math.random() * 220,
      rot: (Math.random() - 0.5) * 60,
      emoji: CLOUD_EMOJIS[i % CLOUD_EMOJIS.length],
    });
  }
  return clouds;
}

/**
 * Localised text variants for the headline. We pick one at random on
 * each fart so repeat presses stay entertaining — and since they're
 * looked up via the translator, they participate in NO/EN switching.
 *
 * Returning the keys (rather than translated strings) lets the caller
 * decide which translator + params to apply.
 */
const HEADLINE_KEYS = [
  "fart.title.default",
  "fart.title.destroyed",
  "fart.title.nuclear",
] as const;

/**
 * <FartPopup> manages two phases:
 *   1. Input modal  — user enters a name, hits "Fart 💨".
 *   2. Effect overlay — fullscreen burst with text + clouds + shake +
 *      green tint flash + sound.
 *
 * Phase 2 auto-dismisses after `OVERLAY_DURATION_MS[intensity]`, but
 * also closes immediately on click or Escape. Both phases render via
 * `createPortal` straight to `document.body` so they sit above all
 * existing UI without needing CSS stacking-context surgery.
 */
export function FartPopup({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { getToken } = useAuth();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [phase, setPhase] = useState<"input" | "overlay">("input");
  const [intensity, setIntensity] = useState<FartIntensity>("medium");
  const [headlineKey, setHeadlineKey] = useState<(typeof HEADLINE_KEYS)[number]>(
    "fart.title.default",
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Tracked separately so early dismissal (Escape, click, backdrop) can
  // cancel BOTH async callbacks — leaving them dangling would fire a
  // late onClose() after the next reopen and could leave the html
  // shake class stuck on the document.
  const overlayTimerRef = useRef<number | null>(null);
  const shakeTimerRef = useRef<number | null>(null);

  /**
   * Tear down any in-flight async work and clear the html shake class.
   * Called from every close path AND from the unmount cleanup, so the
   * popup always lands in a clean state regardless of how it ends.
   */
  const teardownEffects = useCallback(() => {
    if (overlayTimerRef.current != null) {
      window.clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
    if (shakeTimerRef.current != null) {
      window.clearTimeout(shakeTimerRef.current);
      shakeTimerRef.current = null;
    }
    document.documentElement.classList.remove(
      "fart-shake",
      "fart-shake-nuclear",
    );
  }, []);

  /**
   * Single close path used by every dismissal trigger (Escape, backdrop,
   * overlay click, Cancel button, and the auto-close timer). Centralising
   * this guarantees identical cleanup semantics — the architect-flagged
   * "early-dismiss leaves a pending timer" bug originated from having
   * multiple close paths that bypassed teardown.
   */
  const handleClose = useCallback(() => {
    teardownEffects();
    onClose();
  }, [teardownEffects, onClose]);

  // Reset internal state every time the popup opens; auto-focus the
  // input for keyboard ergonomics. When `open` flips to false we also
  // tear down so a quick close-then-reopen cycle starts from a clean slate.
  useEffect(() => {
    if (!open) {
      teardownEffects();
      return;
    }
    setPhase("input");
    setName("");
    setMessage("");
    setSending(false);
    setSendError("");
    // Defer to allow the input to mount before focusing.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, teardownEffects]);

  // Final safety net: tear down on unmount in case the parent removes
  // <FartPopup> from the tree without first toggling `open`.
  useEffect(() => {
    return () => {
      teardownEffects();
    };
  }, [teardownEffects]);

  // Global Escape handler, scoped to whichever phase is currently open.
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, handleClose]);

  const trimmedName = name.trim();
  const trimmedMessage = message.trim();

  const submit = useCallback(async () => {
    if (!trimmedName || !trimmedMessage || sending) return;
    const chosen = randomIntensity();
    setSending(true);
    setSendError("");
    try {
      const token = await getToken();
      const response = await fetch("/api/fart-alerts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          senderName: trimmedName,
          message: trimmedMessage,
          intensity: chosen,
        }),
      });
      if (!response.ok) throw new Error("broadcast failed");
    } catch {
      setSending(false);
      setSendError(t("fart.broadcastError"));
      return;
    }
    setIntensity(chosen);
    setHeadlineKey(
      HEADLINE_KEYS[Math.floor(Math.random() * HEADLINE_KEYS.length)],
    );
    setPhase("overlay");
    // Trigger sound + screen shake. Sound is best-effort; missing
    // AudioContext support degrades silently.
    playFart(chosen);
    const shakeClass =
      chosen === "nuclear" ? "fart-shake-nuclear" : "fart-shake";
    document.documentElement.classList.add(shakeClass);
    // Cancel any leftover timers from a previous burst so we never
    // double-schedule cleanup callbacks.
    if (shakeTimerRef.current != null) {
      window.clearTimeout(shakeTimerRef.current);
    }
    if (overlayTimerRef.current != null) {
      window.clearTimeout(overlayTimerRef.current);
    }
    shakeTimerRef.current = window.setTimeout(() => {
      document.documentElement.classList.remove(shakeClass);
      shakeTimerRef.current = null;
    }, chosen === "nuclear" ? 1900 : 650);
    overlayTimerRef.current = window.setTimeout(() => {
      overlayTimerRef.current = null;
      handleClose();
    }, OVERLAY_DURATION_MS[chosen]);
  }, [
    getToken,
    trimmedMessage,
    trimmedName,
    sending,
    handleClose,
    t,
  ]);

  // Memoise cloud configs so they don't re-randomise on every render
  // while the overlay is mounted.
  const clouds = useMemo(
    () => (phase === "overlay" ? buildClouds(intensity) : []),
    [phase, intensity],
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  if (phase === "input") {
    return createPortal(
      <div
        className="fart-popup-backdrop"
        onClick={(e) => {
          // Close only when the user clicks the backdrop itself, not
          // when the click bubbles up from inside the card.
          if (e.target === e.currentTarget) handleClose();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t("fart.tooltip")}
      >
        <div className="fart-popup-card">
          <h2 className="fart-popup-title">{t("fart.tooltip")}</h2>
          <input
            ref={inputRef}
            className="fart-popup-input"
            type="text"
            value={name}
            placeholder={t("fart.input.placeholder")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            maxLength={40}
          />
          <textarea
            className="fart-popup-input fart-popup-message"
            value={message}
            placeholder={t("fart.message.placeholder")}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={160}
            rows={3}
          />
          {sendError ? (
            <div className="fart-popup-error" role="alert">
              {sendError}
            </div>
          ) : null}
          <div className="fart-popup-row">
            <button
              type="button"
              className="fart-popup-button secondary"
              onClick={handleClose}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="fart-popup-button primary"
              onClick={() => void submit()}
              disabled={!trimmedName || !trimmedMessage || sending}
            >
              {sending ? t("fart.sending") : t("fart.submit")}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ----- Effect overlay -----
  return createPortal(
    <div
      className="fart-overlay"
      // Click anywhere on the overlay to dismiss early.
      onClick={handleClose}
      role="alert"
      aria-live="assertive"
    >
      <div className="fart-overlay-flash" />
      {clouds.map((c) => (
        <span
          key={c.id}
          className="fart-cloud"
          aria-hidden
          style={{
            top: `${c.topPct}%`,
            left: `${c.leftPct}%`,
            animationDelay: `${c.delayMs}ms`,
            animationDuration: `${c.durationMs}ms`,
            // Custom properties read by the keyframe to drive end pos.
            ["--fart-dx" as string]: `${c.dx}px`,
            ["--fart-dy" as string]: `${c.dy}px`,
            ["--fart-rot" as string]: `${c.rot}deg`,
          }}
        >
          {c.emoji}
        </span>
      ))}
      <div className="fart-overlay-content">
        <div className="fart-overlay-text">
          {trimmedMessage || t(headlineKey, { name: trimmedName || t("fart.someone") })}
        </div>
        <div className="fart-overlay-sender">— {trimmedName}</div>
      </div>
    </div>,
    document.body,
  );
}
