/** Slide-out validation drawer.
 *
 *  Renders the result of `runValidation()` grouped by severity.
 *  Producer can click a violation to scroll the offending screen
 *  into view (handled by parent via `onJumpToScreen`).
 */

import { useEffect, useRef } from "react";
import type { LedViolation } from "../../lib/led/validation/rules";
import { useT } from "../../lib/i18n/I18nContext";

export function ValidationDrawer({
  open,
  onClose,
  violations,
  onJumpToScreen,
}: {
  open: boolean;
  onClose: () => void;
  violations: LedViolation[];
  onJumpToScreen?: (screenId: string) => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const errors = violations.filter((v) => v.level === "error");
  const warnings = violations.filter((v) => v.level === "warn");
  const infos = violations.filter((v) => v.level === "info");
  const translatedParams = (v: LedViolation, hint = false) => {
    const params = hint ? v.hintParams : v.messageParams;
    return {
      ...params,
      ...(params && "screen" in params && !params.screen
        ? { screen: t("led.validation.screenFallback") }
        : {}),
    };
  };

  return (
    <div
      className="led-validation-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={t("led.validation.ariaLabel")}
      tabIndex={-1}
      ref={ref}
    >
      <div className="led-validation-head">
        <strong>{t("led.validation.title")}</strong>
        <span className="led-validation-counts">
          {errors.length > 0 && (
            <span className="led-validation-pill led-validation-pill-error">
              {t(
                errors.length === 1
                  ? "led.validation.errorCountOne"
                  : "led.validation.errorCountMany",
                { count: errors.length },
              )}
            </span>
          )}
          {warnings.length > 0 && (
            <span className="led-validation-pill led-validation-pill-warn">
              {t(
                warnings.length === 1
                  ? "led.validation.warningCountOne"
                  : "led.validation.warningCountMany",
                { count: warnings.length },
              )}
            </span>
          )}
          {infos.length > 0 && (
            <span className="led-validation-pill led-validation-pill-info">
              {t("led.validation.infoCount", { count: infos.length })}
            </span>
          )}
        </span>
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={onClose}
          aria-label={t("led.validation.close")}
        >
          ✕
        </button>
      </div>

      <div className="led-validation-body">
        {violations.length === 0 ? (
          <p className="led-validation-empty">
            {t("led.validation.empty")}
          </p>
        ) : (
          <ul className="led-validation-list">
            {[...errors, ...warnings, ...infos].map((v, i) => (
              <li
                key={`${v.ruleId}-${v.entityId ?? "x"}-${i}`}
                className={`led-validation-item led-validation-item-${v.level}`}
              >
                <button
                  type="button"
                  className="led-validation-jump"
                  disabled={!v.entityId || !onJumpToScreen}
                  onClick={() => {
                    if (v.entityId && onJumpToScreen) {
                      onJumpToScreen(v.entityId);
                    }
                  }}
                  title={v.entityId ? t("led.validation.jumpToScreen") : ""}
                >
                  <span className={`led-validation-dot led-validation-dot-${v.level}`} />
                  <span className="led-validation-msg">
                    <strong>{t(v.messageKey, translatedParams(v))}</strong>
                    {v.hintKey && (
                      <em className="led-validation-hint">
                        {t(v.hintKey, translatedParams(v, true))}
                      </em>
                    )}
                  </span>
                  <code className="led-validation-rule">{v.ruleId}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
