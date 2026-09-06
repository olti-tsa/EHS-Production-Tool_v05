/** Basic / Advanced mode segmented control for the LED tab.
 *
 *  Lives in LED Settings. Drives `settings.uiMode` — readers of
 *  this flag are the AdvancedScreenInspector, PortMappingPanel,
 *  RigAccessoriesPanel, ValidationDrawer, and the per-screen
 *  CSV export buttons (Patch sheet / Cabinet IDs) on the touring
 *  strip. The System Designer palette renders all node kinds in
 *  both modes — that toggle is intentionally not wired so a basic
 *  user can still drop a media-server / UPS into the canvas if
 *  needed.
 *
 *  No data is lost when toggling back to Basic: advanced fields stay
 *  on the screen object, the UI just stops surfacing them.
 */

import type { LedSettings } from "../../lib/led";
import { useT } from "../../lib/i18n/I18nContext";

export function LedModeToggle({
  mode,
  onChange,
}: {
  mode: LedSettings["uiMode"];
  onChange: (next: NonNullable<LedSettings["uiMode"]>) => void;
}) {
  const t = useT();
  const current = mode === "advanced" ? "advanced" : "basic";
  return (
    <div
      className="led-mode-toggle"
      role="radiogroup"
      aria-label={t("led.mode.ariaLabel")}
    >
      <button
        type="button"
        role="radio"
        aria-checked={current === "basic"}
        className={`led-mode-btn ${current === "basic" ? "is-active" : ""}`}
        onClick={() => onChange("basic")}
        title={t("led.mode.basicTooltip")}
      >
        {t("led.mode.basic")}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={current === "advanced"}
        className={`led-mode-btn ${current === "advanced" ? "is-active" : ""}`}
        onClick={() => onChange("advanced")}
        title={t("led.mode.advancedTooltip")}
      >
        {t("led.mode.advanced")}
      </button>
    </div>
  );
}
