import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadEquipmentLibrary,
  searchLibrary,
  tabsFor,
  type LibraryItem,
  type LibraryTab,
} from "../lib/equipmentLibrary";
import { useI18n } from "../lib/i18n/I18nContext";

type Props = {
  open: boolean;
  /** Restrict the picker to items that map to this tab. Pass `undefined`
   *  to show everything. */
  tab?: LibraryTab;
  /** Title shown in the modal header. */
  title?: string;
  onClose: () => void;
  onPick: (item: LibraryItem) => void;
};

const fmt = (n: number, locale: string, d = 1) =>
  Number.isFinite(n)
    ? n.toLocaleString(locale, { maximumFractionDigits: d })
    : "—";

export function EquipmentPicker({
  open,
  tab,
  title,
  onClose,
  onPick,
}: Props) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [subFilter, setSubFilter] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { t, locale } = useI18n();

  // Lazy-load the library the first time the picker opens.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    loadEquipmentLibrary().then((list) => {
      if (!cancelled) {
        setItems(list);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  // Focus the search input when the modal opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // Reset filters every time the picker opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSubFilter("");
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredByTab = useMemo(() => {
    if (!tab) return items;
    return items.filter((it) => tabsFor(it).includes(tab));
  }, [items, tab]);

  const subOptions = useMemo(() => {
    const set = new Set<string>();
    for (const it of filteredByTab) {
      const k = `${it.category} / ${it.subCategory}`;
      if (it.subCategory) set.add(k);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [filteredByTab]);

  const filtered = useMemo(() => {
    let out = filteredByTab;
    if (subFilter) {
      out = out.filter(
        (it) => `${it.category} / ${it.subCategory}` === subFilter,
      );
    }
    return searchLibrary(out, query).slice(0, 200);
  }, [filteredByTab, subFilter, query]);

  if (!open) return null;

  const heading =
    title ??
    (tab
      ? t("equipmentPicker.titleForTab", {
          tab: t(`equipmentPicker.tab.${tab}` as Parameters<typeof t>[0]),
        })
      : t("equipmentPicker.title"));
  const numberLocale = locale === "no" ? "nb-NO" : "en-US";

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      <div
        className="modal-content equip-picker"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="equip-picker-head">
          <h3>{heading}</h3>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            {t("common.close")}
          </button>
        </div>

        <div className="equip-picker-filters">
          <input
            ref={inputRef}
            className="led-input"
            type="search"
            placeholder={t("equipmentPicker.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("equipmentPicker.searchAria")}
          />
          <select
            className="led-input"
            value={subFilter}
            onChange={(e) => setSubFilter(e.target.value)}
            aria-label={t("equipmentPicker.filterAria")}
          >
            <option value="">{t("equipmentPicker.allSubcategories")}</option>
            {subOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <span className="equip-picker-count">
            {loaded
              ? t("equipmentPicker.count", {
                  shown: filtered.length.toLocaleString(locale === "no" ? "nb-NO" : "en-US"),
                  total: filteredByTab.length.toLocaleString(locale === "no" ? "nb-NO" : "en-US"),
                })
              : t("common.loading")}
          </span>
        </div>

        <div className="equip-picker-list" role="listbox">
          {!loaded ? (
            <div className="equip-empty">{t("equipmentPicker.loading")}</div>
          ) : filtered.length === 0 ? (
            <div className="equip-empty">
              {t("equipmentPicker.empty")}
            </div>
          ) : (
            <table className="equip-picker-table">
              <thead>
                <tr>
                  <th>{t("equipmentPicker.table.item")}</th>
                  <th>{t("equipmentPicker.table.category")}</th>
                  <th className="led-num">{t("equipmentPicker.table.weight")}</th>
                  <th className="led-num">{t("equipmentPicker.table.watts")}</th>
                  <th className="led-num">{t("equipmentPicker.table.stock")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <div className="equip-name">{it.name}</div>
                      {it.notes && (
                        <div className="equip-notes">{it.notes}</div>
                      )}
                    </td>
                    <td>
                      <div>{it.category}</div>
                      <div className="equip-sub">{it.subCategory}</div>
                    </td>
                    <td className="led-num">
                      {it.weight ? `${fmt(it.weight, numberLocale, 1)} kg` : "—"}
                    </td>
                    <td className="led-num">
                      {it.watts ? `${fmt(it.watts, numberLocale, 0)} W` : "—"}
                    </td>
                    <td className="led-num">{fmt(it.stock, numberLocale, 0)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onPick(it)}
                      >
                        {t("common.add")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
