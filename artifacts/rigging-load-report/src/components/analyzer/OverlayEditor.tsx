import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtractedItems } from "../../lib/drawingAnalysis";
import { useT, type Translator } from "../../lib/i18n/I18nContext";
import type { TranslationKey } from "../../lib/i18n/types";
import { OverlayBox } from "./OverlayBox";
import {
  fromOverlayItems,
  newOverlayItem,
  relabelOverlayItem,
  toOverlayItems,
  type OverlayItem,
  type OverlayItemKind,
} from "./overlayItem";

type Props = {
  /** A renderable image data URL or object URL. For PDFs the host
   *  passes the rasterised first page — see `fileToFloorPlan`. */
  imageUrl: string;
  /** The extracted items returned by the analyser. The editor takes
   *  a deep snapshot of these on open and only commits back via
   *  `onSave`, so cancelling discards in-progress edits. */
  extracted: ExtractedItems;
  onClose: () => void;
  /** Commit the corrected `ExtractedItems` back to the parent. The
   *  parent decides what happens next — usually showing the
   *  "apply to reports" panel with the corrected items. */
  onSave: (corrected: ExtractedItems) => void;
};

const KIND_LABEL_KEYS = {
  truss: "overlayEditor.kind.truss",
  lighting: "overlayEditor.kind.lighting",
  led: "overlayEditor.kind.led",
  stage: "overlayEditor.kind.stage",
  sound: "overlayEditor.kind.sound",
} satisfies Record<OverlayItemKind, TranslationKey>;

const NEW_LABEL_KEYS = {
  truss: "overlayEditor.new.truss",
  lighting: "overlayEditor.new.lighting",
  led: "overlayEditor.new.led",
  stage: "overlayEditor.new.stage",
  sound: "overlayEditor.new.sound",
} satisfies Record<OverlayItemKind, TranslationKey>;

const KINDS: OverlayItemKind[] = ["truss", "lighting", "led", "stage", "sound"];

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(n);
}

function parseNumOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Modal overlay editor — renders the uploaded drawing with one box
 *  per detected item, plus a side panel that edits the selected
 *  item. Designed to be a self-contained dialog: it owns its own
 *  draft state, blocks the host page behind a backdrop, and only
 *  reaches outside via `onClose` / `onSave`. */
export function OverlayEditor({
  imageUrl,
  extracted,
  onClose,
  onSave,
}: Props) {
  const t = useT();
  const initialItems = useMemo(() => toOverlayItems(extracted), [extracted]);
  const [items, setItems] = useState<OverlayItem[]>(initialItems);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItems[0]?.id ?? null,
  );
  // Stash the *image* element (not the wrapper) so OverlayBox can
  // read its bounding rect for normalisation. We update on load so
  // the rect is correct after the image fills its slot.
  const [imageEl, setImageEl] = useState<HTMLImageElement | null>(null);
  const escListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null);

  // Close on Escape, mirroring native dialog conventions. The
  // listener is removed on unmount to avoid leaking after the user
  // closes the editor by other means.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    escListenerRef.current = onKey;
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      escListenerRef.current = null;
    };
  }, [onClose]);

  const selected = items.find((i) => i.id === selectedId) ?? null;

  function updateItem(id: string, mut: (item: OverlayItem) => OverlayItem) {
    setItems((curr) => curr.map((it) => (it.id === id ? mut(it) : it)));
  }

  function addItem(kind: OverlayItemKind) {
    const fresh = newOverlayItem(kind, t(NEW_LABEL_KEYS[kind]));
    setItems((curr) => [...curr, fresh]);
    setSelectedId(fresh.id);
  }

  function deleteItem(id: string) {
    setItems((curr) => curr.filter((it) => it.id !== id));
    setSelectedId((curr) => (curr === id ? null : curr));
  }

  function commit() {
    onSave(fromOverlayItems(extracted, items));
  }

  return (
    <div
      className="overlay-editor-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("overlayEditor.dialogAria")}
      onClick={(e) => {
        // Only close when the click started on the backdrop itself,
        // never when it bubbled up from the dialog body or a box —
        // otherwise dragging a box can accidentally close the editor.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="overlay-editor-shell">
        <header className="overlay-editor-head">
          <div>
            <strong>{t("overlayEditor.title")}</strong>
            <span className="led-sub" style={{ marginLeft: 8 }}>
              {t(items.length === 1 ? "overlayEditor.summary.one" : "overlayEditor.summary.many", { count: items.length })}
            </span>
          </div>
          <div className="overlay-editor-head-actions">
            <button type="button" className="btn btn-soft" onClick={onClose}>
              {t("overlayEditor.cancel")}
            </button>
            <button type="button" className="btn btn-primary" onClick={commit}>
              {t("overlayEditor.save")}
            </button>
          </div>
        </header>

        <div className="overlay-editor-toolbar">
          <span className="led-sub">{t("overlayEditor.addNew")}</span>
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`btn btn-soft btn-xs overlay-add-${kind}`}
              onClick={() => addItem(kind)}
            >
              + {t(KIND_LABEL_KEYS[kind])}
            </button>
          ))}
        </div>

        <div className="overlay-editor-body">
          <div
            className="overlay-editor-canvas"
            // Click on the backdrop image (i.e. NOT a box) deselects
            // so the side panel collapses and the user can see the
            // whole drawing without overlays competing for attention.
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
          >
            <div className="overlay-editor-image-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={setImageEl}
                src={imageUrl}
                alt={t("overlayEditor.imageAlt")}
                draggable={false}
                onClick={() => setSelectedId(null)}
              />
              {items.map((item) => (
                <OverlayBox
                  key={item.id}
                  bbox={item.bbox}
                  type={item.kind}
                  label={item.label}
                  confidence={item.confidence}
                  isSelected={item.id === selectedId}
                  imageEl={imageEl}
                  onSelect={() => setSelectedId(item.id)}
                  onChange={(bbox) =>
                    updateItem(item.id, (it) => ({ ...it, bbox }))
                  }
                />
              ))}
            </div>
          </div>

          <aside className="overlay-editor-side">
            {!selected && (
              <div className="overlay-editor-empty">
                <strong>{t("overlayEditor.empty.title")}</strong>
                <p className="led-sub">
                  {t("overlayEditor.empty.body")}
                </p>
              </div>
            )}
            {selected && (
              <SidePanel
                item={selected}
                onChange={(next) =>
                  updateItem(selected.id, () => relabelOverlayItem(next))
                }
                onDelete={() => deleteItem(selected.id)}
                t={t}
              />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function SidePanel({
  item,
  onChange,
  onDelete,
  t,
}: {
  item: OverlayItem;
  onChange: (next: OverlayItem) => void;
  onDelete: () => void;
  t: Translator;
}) {
  // Helper so each field can mutate the payload without rewriting the
  // discriminated union plumbing five times.
  function patchPayload(patch: Record<string, unknown>) {
    onChange({ ...item, payload: { ...item.payload, ...patch } } as OverlayItem);
  }

  const conf = item.confidence;

  return (
    <div className="overlay-side-panel">
      <header className="overlay-side-head">
        <span className={`overlay-pill overlay-pill-${item.kind}`}>
          {t(KIND_LABEL_KEYS[item.kind])}
        </span>
        {conf != null && (
          <span className={`overlay-conf-pill ${confClass(conf)}`}>
            {t("overlayEditor.confidence", { percent: (conf * 100).toFixed(0) })}
          </span>
        )}
      </header>

      <label className="overlay-field">
        <span>{t("overlayEditor.field.name")}</span>
        <input
          type="text"
          value={item.payload.name}
          onChange={(e) =>
            onChange({
              ...item,
              payload: { ...item.payload, name: e.target.value },
            } as OverlayItem)
          }
        />
      </label>

      {item.kind === "truss" && (
        <>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.lengthM")}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fmtNum(item.payload.lengthM)}
              onChange={(e) =>
                patchPayload({ lengthM: parseNumOrNull(e.target.value) ?? 0 })
              }
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.hoistPoints")}</span>
            <input
              type="number"
              step="1"
              min="1"
              max="8"
              value={fmtNum(item.payload.pointCount)}
              onChange={(e) => {
                const v = parseNumOrNull(e.target.value) ?? 1;
                patchPayload({
                  pointCount: Math.max(1, Math.min(8, Math.round(v))),
                });
              }}
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.hoistKg")}</span>
            <input
              type="number"
              step="100"
              min="0"
              value={fmtNum(item.payload.hoistKg)}
              onChange={(e) =>
                patchPayload({ hoistKg: parseNumOrNull(e.target.value) })
              }
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.trimM")}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fmtNum(item.payload.trimM)}
              onChange={(e) =>
                patchPayload({ trimM: parseNumOrNull(e.target.value) })
              }
            />
          </label>
        </>
      )}

      {item.kind === "lighting" && (
        <>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.quantity")}</span>
            <input
              type="number"
              step="1"
              min="1"
              value={fmtNum(item.payload.qty)}
              onChange={(e) => {
                const v = parseNumOrNull(e.target.value) ?? 1;
                patchPayload({ qty: Math.max(1, Math.round(v)) });
              }}
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.onTruss")}</span>
            <input
              type="text"
              value={item.payload.trussName}
              placeholder={t("overlayEditor.placeholder.truss")}
              onChange={(e) => patchPayload({ trussName: e.target.value })}
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.weightKgEach")}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fmtNum(item.payload.weightKg)}
              onChange={(e) =>
                patchPayload({ weightKg: parseNumOrNull(e.target.value) })
              }
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.wattsEach")}</span>
            <input
              type="number"
              step="1"
              min="0"
              value={fmtNum(item.payload.watts)}
              onChange={(e) =>
                patchPayload({ watts: parseNumOrNull(e.target.value) })
              }
            />
          </label>
        </>
      )}

      {item.kind === "led" && (
        <>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.widthM")}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fmtNum(item.payload.widthM)}
              onChange={(e) =>
                patchPayload({ widthM: parseNumOrNull(e.target.value) })
              }
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.heightM")}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fmtNum(item.payload.heightM)}
              onChange={(e) =>
                patchPayload({ heightM: parseNumOrNull(e.target.value) })
              }
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.panelsWide")}</span>
            <input
              type="number"
              step="1"
              min="0"
              value={fmtNum(item.payload.panelsWide)}
              onChange={(e) =>
                patchPayload({ panelsWide: parseNumOrNull(e.target.value) })
              }
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.panelsTall")}</span>
            <input
              type="number"
              step="1"
              min="0"
              value={fmtNum(item.payload.panelsTall)}
              onChange={(e) =>
                patchPayload({ panelsTall: parseNumOrNull(e.target.value) })
              }
            />
          </label>
        </>
      )}

      {item.kind === "stage" && (
        <>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.widthM")}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fmtNum(item.payload.widthM)}
              onChange={(e) =>
                patchPayload({ widthM: parseNumOrNull(e.target.value) ?? 0 })
              }
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.depthM")}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fmtNum(item.payload.depthM)}
              onChange={(e) =>
                patchPayload({ depthM: parseNumOrNull(e.target.value) ?? 0 })
              }
            />
          </label>
        </>
      )}

      {item.kind === "sound" && (
        <>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.quantity")}</span>
            <input
              type="number"
              step="1"
              min="1"
              value={fmtNum(item.payload.qty)}
              onChange={(e) => {
                const v = parseNumOrNull(e.target.value) ?? 1;
                patchPayload({ qty: Math.max(1, Math.round(v)) });
              }}
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.weightKgEach")}</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fmtNum(item.payload.weightKg)}
              onChange={(e) =>
                patchPayload({ weightKg: parseNumOrNull(e.target.value) })
              }
            />
          </label>
          <label className="overlay-field">
            <span>{t("overlayEditor.field.wattsEach")}</span>
            <input
              type="number"
              step="1"
              min="0"
              value={fmtNum(item.payload.watts)}
              onChange={(e) =>
                patchPayload({ watts: parseNumOrNull(e.target.value) })
              }
            />
          </label>
        </>
      )}

      <label className="overlay-field">
        <span>{t("overlayEditor.field.notes")}</span>
        <textarea
          rows={2}
          value={item.payload.notes}
          onChange={(e) => patchPayload({ notes: e.target.value })}
        />
      </label>

      <button
        type="button"
        className="btn btn-soft overlay-delete-btn"
        onClick={onDelete}
      >
        {t("overlayEditor.delete")}
      </button>
    </div>
  );
}

function confClass(c: number): string {
  if (c >= 0.75) return "is-high";
  if (c >= 0.5) return "is-mid";
  return "is-low";
}
