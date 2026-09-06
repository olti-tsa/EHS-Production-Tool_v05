import { useMemo } from "react";
import { NumberField } from "./NumberField";
import { useI18n, useT } from "../lib/i18n/I18nContext";
import {
  SOUND_CATEGORIES,
  computeSoundTotals,
  itemPower,
  itemWeight,
  type SoundCategory,
  type SoundItem,
} from "../lib/sound";

type Props = {
  items: SoundItem[];
  onAdd: () => void;
  onAddFromLibrary?: () => void;
  onUpdate: (id: string, patch: Partial<SoundItem>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
};

export function SoundReportView({
  items,
  onAdd,
  onAddFromLibrary,
  onUpdate,
  onRemove,
  onDuplicate,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const totals = useMemo(() => computeSoundTotals(items), [items]);
  const numberLocale = locale === "no" ? "nb-NO" : "en-US";
  const fmtNum = (n: number, d = 1) =>
    n.toLocaleString(numberLocale, { maximumFractionDigits: d });
  const fmtInt = (n: number) =>
    n.toLocaleString(numberLocale, { maximumFractionDigits: 0 });
  const categoryLabels = useMemo<Record<SoundCategory, string>>(
    () => ({
      "PA Mains": t("sound.category.paMains"),
      Subs: t("sound.category.subs"),
      Monitors: t("sound.category.monitors"),
      IEMs: t("sound.category.iems"),
      Console: t("sound.category.console"),
      "Mic Wired": t("sound.category.micWired"),
      "Mic Wireless": t("sound.category.micWireless"),
      DI: t("sound.category.di"),
      Stand: t("sound.category.stand"),
      Cable: t("sound.category.cable"),
      Other: t("sound.category.other"),
    }),
    [t],
  );

  return (
    <div className="led-report">
      <header className="led-report-header">
        <div>
          <h2>{t("sound.title")}</h2>
          <p className="led-report-sub">
            {t("sound.subtitle")}
          </p>
        </div>
        <div className="led-report-meta">
          <span className="badge">
            <strong>{totals.rowCount}</strong> {t("sound.rows")}
          </span>
          <span className="badge">
            <strong>{fmtInt(totals.totalQty)}</strong> {t("sound.pieces")}
          </span>
          <span className="badge">
            <strong>{fmtNum(totals.totalWeight, 1)}</strong> kg
          </span>
          <span className="badge">
            <strong>{fmtInt(totals.totalPower)}</strong> W
          </span>
        </div>
      </header>

      {/* Per-category breakdown dashboard */}
      <div className="led-dashboard">
        {SOUND_CATEGORIES.map((cat) => (
          <div className="led-stat" key={cat}>
            <div className="led-stat-label">{categoryLabels[cat]}</div>
            <div className="led-stat-value">
              {totals.countsByCategory[cat]}
            </div>
            <div className="led-stat-sub">
              {totals.weightsByCategory[cat] > 0
                ? `${fmtNum(totals.weightsByCategory[cat], 1)} kg`
                : "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Inventory list */}
      <section className="led-card">
        <div className="led-card-head">
          <h3>{t("sound.inventory")}</h3>
          <div className="led-controls">
            {onAddFromLibrary && (
              <button className="btn btn-soft" onClick={onAddFromLibrary}>
                {t("sound.fromLibrary")}
              </button>
            )}
            <button className="btn btn-primary" onClick={onAdd}>
              {t("sound.addItem")}
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="led-empty">
            {t("sound.empty")}
          </div>
        ) : (
          <div className="led-table-wrap">
            <table className="led-table">
              <thead>
                <tr>
                  <th>{t("sound.table.name")}</th>
                  <th>{t("sound.table.category")}</th>
                  <th className="led-num">{t("sound.table.qty")}</th>
                  <th className="led-num">{t("sound.table.weightUnit")}</th>
                  <th className="led-num">{t("sound.table.powerUnit")}</th>
                  <th className="led-num">{t("sound.table.subtotalWeight")}</th>
                  <th className="led-num">{t("sound.table.subtotalPower")}</th>
                  <th>{t("sound.table.notes")}</th>
                  <th aria-label={t("sound.table.actions")}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <SoundRow
                    key={it.id}
                    item={it}
                    onUpdate={(patch) => onUpdate(it.id, patch)}
                    onRemove={() => onRemove(it.id)}
                    onDuplicate={() => onDuplicate(it.id)}
                    categoryLabels={categoryLabels}
                    numberLocale={numberLocale}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SoundRow({
  item,
  onUpdate,
  onRemove,
  onDuplicate,
  categoryLabels,
  numberLocale,
}: {
  item: SoundItem;
  onUpdate: (patch: Partial<SoundItem>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  categoryLabels: Record<SoundCategory, string>;
  numberLocale: string;
}) {
  const t = useT();
  const w = itemWeight(item);
  const p = itemPower(item);
  const fmtNum = (n: number, d = 1) =>
    n.toLocaleString(numberLocale, { maximumFractionDigits: d });
  const fmtInt = (n: number) =>
    n.toLocaleString(numberLocale, { maximumFractionDigits: 0 });

  return (
    <tr>
      <td>
        <input
          className="led-input"
          type="text"
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder={t("sound.placeholder.name")}
          aria-label={t("sound.table.name")}
        />
      </td>
      <td>
        <select
          className="led-input"
          value={item.category}
          aria-label={t("sound.table.category")}
          onChange={(e) =>
            onUpdate({ category: e.target.value as SoundCategory })
          }
        >
          {SOUND_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabels[c]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <NumberField
          className="led-input led-input-num"
          aria-label={t("sound.table.qty")}
          min={1}
          step={1}
          value={item.qty}
          transform={(n) => Math.max(1, Math.round(n || 1))}
          emptyValue={1}
          onCommit={(qty) => onUpdate({ qty })}
        />
      </td>
      <td>
        <NumberField
          className="led-input led-input-num"
          aria-label={t("sound.table.weightUnit")}
          min={0}
          step={0.5}
          value={item.weightPerUnit}
          transform={(n) => Math.max(0, n || 0)}
          emptyValue={0}
          onCommit={(weightPerUnit) => onUpdate({ weightPerUnit })}
        />
      </td>
      <td>
        <NumberField
          className="led-input led-input-num"
          aria-label={t("sound.table.powerUnit")}
          min={0}
          step={50}
          value={item.powerPerUnit}
          transform={(n) => Math.max(0, n || 0)}
          emptyValue={0}
          onCommit={(powerPerUnit) => onUpdate({ powerPerUnit })}
        />
      </td>
      <td className="led-num">{fmtNum(w, 1)}</td>
      <td className="led-num">{fmtInt(p)}</td>
      <td>
        <input
          className="led-input"
          type="text"
          value={item.notes}
          onChange={(e) => onUpdate({ notes: e.target.value })}
          placeholder={t("sound.placeholder.notes")}
          aria-label={t("sound.table.notes")}
        />
      </td>
      <td className="led-actions">
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={onDuplicate}
          title={t("sound.duplicate")}
        >
          {t("sound.copy")}
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={onRemove}
          title={t("sound.remove")}
        >
          {t("sound.delete")}
        </button>
      </td>
    </tr>
  );
}
