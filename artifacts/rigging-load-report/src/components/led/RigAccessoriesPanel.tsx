/** Per-screen rigging accessory list — beams, fly bars, ground
 *  support items pulled from the "LED Screen" inventory category.
 *
 *  Two modes:
 *   • Auto-fit (default): beams are derived from the screen's physical
 *     width via `suggestAutoBeams`. Producer can still add manual
 *     extras (corner pieces, fly bars) underneath the auto block.
 *   • Manual: only the producer's manual `rigAccessories` are used.
 *
 *  Weight (auto + manual) is included in the project-level LED weight
 *  total — see `computeScreenMetrics`/`computeLedTotals` which now
 *  accept the same beam catalog passed in here.
 */

import { useMemo, useState } from "react";
import type { LedPanel, LedRigAccessory, LedScreen } from "../../lib/led";
import { newRigAccessoryId, suggestAutoBeams } from "../../lib/led";
import { useT } from "../../lib/i18n/I18nContext";

export type LedRigAccessoryCatalogItem = {
  name: string;
  weight: number;
};

export function RigAccessoriesPanel({
  screen,
  panels,
  catalog,
  onChange,
  onToggleAutoFit,
}: {
  screen: LedScreen;
  /** Panel library — needed to compute the screen's physical width
   *  for the auto-fit suggestion. */
  panels: LedPanel[];
  /** Inventory items (name + weight) — the parent passes the "LED
   *  Screen" rows that have no pixel metadata (i.e. the beams). */
  catalog: LedRigAccessoryCatalogItem[];
  onChange: (next: LedRigAccessory[]) => void;
  onToggleAutoFit: (autoFit: boolean) => void;
}) {
  const t = useT();
  const items = screen.rigAccessories ?? [];
  const autoFit = !!screen.autoFitBeams;
  const [picker, setPicker] = useState<string>(catalog[0]?.name ?? "");
  const [qty, setQty] = useState<number>(1);

  /** Width-based auto suggestion (only used when autoFit is on). */
  const auto = useMemo<LedRigAccessory[]>(
    () => (autoFit ? suggestAutoBeams(screen, panels, catalog) : []),
    [autoFit, screen, panels, catalog],
  );

  /** All accessories whose weight contributes to the screen total. */
  const effective = useMemo<LedRigAccessory[]>(
    () => [...auto, ...items],
    [auto, items],
  );

  const totalWeight = useMemo(() => {
    let w = 0;
    for (const a of effective) {
      const cat = catalog.find((c) => c.name === a.inventoryName);
      if (cat) w += cat.weight * a.qty;
    }
    return w;
  }, [effective, catalog]);

  function add() {
    if (!picker || qty <= 0) return;
    const next: LedRigAccessory[] = [
      ...items,
      {
        id: newRigAccessoryId(),
        inventoryName: picker,
        qty: Math.max(1, Math.round(qty)),
      },
    ];
    onChange(next);
    setQty(1);
  }

  function update(id: string, patch: Partial<LedRigAccessory>) {
    onChange(items.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function remove(id: string) {
    onChange(items.filter((a) => a.id !== id));
  }

  if (catalog.length === 0) {
    return (
      <div className="led-rig-accessories led-rig-accessories-empty">
        {t("led.rigAccessories.emptyCatalog")}
      </div>
    );
  }

  return (
    <div className="led-rig-accessories">
      <div className="led-rig-accessories-head">
        <strong>{t("led.rigAccessories.title")}</strong>
        <label
          className="led-rig-accessories-autofit"
          title={t("led.rigAccessories.autoFitTooltip")}
        >
          <input
            type="checkbox"
            checked={autoFit}
            onChange={(e) => onToggleAutoFit(e.target.checked)}
          />
          <span>{t("led.rigAccessories.autoFit")}</span>
        </label>
        <span className="led-rig-accessories-total">
          {t(
            effective.length === 1
              ? "led.rigAccessories.itemCountOne"
              : "led.rigAccessories.itemCountMany",
            { count: effective.length },
          )} ·{" "}
          {totalWeight.toFixed(1)} kg
        </span>
      </div>

      {/* Auto-fitted block — read-only summary */}
      {autoFit && auto.length > 0 && (
        <ul className="led-rig-accessories-list">
          {auto.map((a) => {
            const cat = catalog.find((c) => c.name === a.inventoryName);
            const w = cat ? cat.weight * a.qty : 0;
            return (
              <li
                key={a.id}
                className="led-rig-accessories-row"
                style={{ opacity: 0.85 }}
              >
                <span
                  className="led-input"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "0 8px",
                    background: "transparent",
                    border: "1px dashed var(--border)",
                  }}
                >
                  {a.inventoryName}
                </span>
                <span className="led-rig-accessories-qty">× {a.qty}</span>
                <span className="led-rig-accessories-weight">
                  {w.toFixed(1)} kg
                </span>
                <span
                  style={{
                    fontSize: 11,
                    opacity: 0.7,
                    fontStyle: "italic",
                  }}
                >
                  {t("led.rigAccessories.autoFitLabel")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {autoFit && auto.length === 0 && (
        <div
          className="led-rig-accessories-empty"
          style={{ fontSize: 12, opacity: 0.7, padding: "4px 0" }}
        >
          {t("led.rigAccessories.noMatchingBeams")}
        </div>
      )}

      {/* Manual extras — always available */}
      {items.length > 0 && (
        <ul className="led-rig-accessories-list">
          {items.map((a) => {
            const cat = catalog.find((c) => c.name === a.inventoryName);
            const w = cat ? cat.weight * a.qty : 0;
            return (
              <li key={a.id} className="led-rig-accessories-row">
                <select
                  className="led-input"
                  value={a.inventoryName}
                  onChange={(e) =>
                    update(a.id, { inventoryName: e.target.value })
                  }
                >
                  {catalog.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <label className="led-rig-accessories-qty">
                  <span>×</span>
                  <input
                    className="led-input"
                    type="number"
                    min={1}
                    step={1}
                    value={a.qty}
                    onChange={(e) =>
                      update(a.id, {
                        qty: Math.max(1, Math.round(Number(e.target.value) || 1)),
                      })
                    }
                  />
                </label>
                <span className="led-rig-accessories-weight">
                  {w.toFixed(1)} kg
                </span>
                <input
                  className="led-input led-rig-accessories-note"
                  type="text"
                  placeholder={t("led.rigAccessories.notePlaceholder")}
                  value={a.note ?? ""}
                  onChange={(e) =>
                    update(a.id, { note: e.target.value || undefined })
                  }
                />
                <button
                  type="button"
                  className="btn btn-soft btn-sm"
                  onClick={() => remove(a.id)}
                  title={t("led.rigAccessories.removeTooltip")}
                  aria-label={t("led.rigAccessories.removeTooltip")}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="led-rig-accessories-add">
        <select
          className="led-input"
          value={picker}
          onChange={(e) => setPicker(e.target.value)}
        >
          {catalog.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.weight} kg)
            </option>
          ))}
        </select>
        <input
          className="led-input"
          type="number"
          min={1}
          step={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value) || 1)))}
          style={{ width: 70 }}
        />
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={add}
          title={
            autoFit
              ? t("led.rigAccessories.addManualTooltip")
              : t("led.rigAccessories.addTooltip")
          }
        >
          {autoFit
            ? t("led.rigAccessories.addManual")
            : t("led.rigAccessories.add")}
        </button>
      </div>
    </div>
  );
}
