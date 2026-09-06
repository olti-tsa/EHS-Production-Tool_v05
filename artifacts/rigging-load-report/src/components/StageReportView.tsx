import { useEffect, useMemo, useRef, useState } from "react";
import { NumberField } from "./NumberField";
import { useT } from "../lib/i18n/I18nContext";
import {
  CONNECTOR_SIDES,
  STAGE_DECKS,
  STAGE_LEG_HEIGHTS_CM,
  STAGE_LEGS,
  computeStage,
  computeStageTotals,
  connectorOverrideKey,
  effectiveConnectorSide,
  nivtecBracingNote,
  placementCollides,
  placementsBounds,
  snapHalfMetre,
  type ConnectorSide,
  type CustomRail,
  type DeckPlacement,
  type Stage,
  type StageDeckKey,
  type StageEditMode,
  type StageBuildOrder,
  type StageLegMode,
} from "../lib/stage";

const CONNECTOR_SIDE_LABEL_KEYS: Record<ConnectorSide, "stage.side.upstage" | "stage.side.right" | "stage.side.downstage" | "stage.side.left"> = {
  N: "stage.side.upstage", E: "stage.side.right", S: "stage.side.downstage", W: "stage.side.left",
};

const CONNECTOR_SIDE_SHORT_KEYS: Record<ConnectorSide, "stage.short.N" | "stage.short.E" | "stage.short.S" | "stage.short.W"> = {
  N: "stage.short.N", E: "stage.short.E", S: "stage.short.S", W: "stage.short.W",
};

/** EHS orange — used for the male-connector edge stripe. */
const MALE_EDGE_COLOR = "#f88000";

/** Custom-rail edit mode set by the toolbar. */
type RailMode = "off" | "add1" | "add2" | "delete";

/** Half-metre cell helper. */
const HALF_M = 0.5;

/** Catalog dimensions per deck key (in metres). Used by the palette and
 *  the manual placer to know each deck's size. Non-square decks can be
 *  rotated 90° for placement. */
const DECK_DIMS: Record<StageDeckKey, { w: number; d: number }> = {
  "2x1": { w: 2, d: 1 },
  "1x1": { w: 1, d: 1 },
  "0.5x2": { w: 0.5, d: 2 },
  "0.5x1": { w: 0.5, d: 1 },
};

/** Resolve the placed dimensions of a deck, applying the current rotate
 *  flag. 1×1 ignores rotation. */
function placedDims(
  key: StageDeckKey,
  rotated: boolean,
): { w: number; d: number } {
  const base = DECK_DIMS[key];
  if (key === "1x1" || !rotated) return base;
  return { w: base.d, d: base.w };
}

type Props = {
  stages: Stage[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Stage>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  /** Open a printable build sheet for a single stage in a new window. */
  onExport: (id: string) => void | Promise<void>;
};

const fmt = (n: number, d = 1) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d });

const DECK_FILL: Record<StageDeckKey, string> = {
  "2x1": "#1f3b8a",
  "1x1": "#5a8edc",
  "0.5x2": "#10b981",
  "0.5x1": "#f59e0b",
};

export function StageReportView(props: Props) {
  const { stages, onAdd, onUpdate, onRemove, onDuplicate, onExport } = props;
  const t = useT();

  const calcs = useMemo(() => stages.map((s) => computeStage(s)), [stages]);
  const totals = useMemo(
    () => computeStageTotals(stages, calcs),
    [stages, calcs],
  );

  return (
    <div className="led-report">
      <header className="led-report-header">
        <div>
          <h2>{t("stage.title")}</h2>
          <p className="led-report-sub">{t("stage.subtitle")}</p>
        </div>
        <div className="led-report-meta">
          <span>
            <strong>{totals.stageCount}</strong> {t("stage.stages")}
          </span>
          <span>
            <strong>{fmt(totals.totalArea, 1)}</strong> {t("stage.unit.areaTotal")}
          </span>
          <span>
            <strong>{fmt(totals.totalWeight, 0)}</strong> {t("stage.unit.weightTotal")}
          </span>
        </div>
      </header>

      {/* Project totals dashboard */}
      <div className="dashboard">
        <div className="dash-item">
          <span>{t("stage.dashboard.deck2x1")}</span>
          <strong>{totals.deckCountsByKey["2x1"]}</strong>
          <small>{t("stage.unit.pieces")}</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.deck1x1")}</span>
          <strong>{totals.deckCountsByKey["1x1"]}</strong>
          <small>{t("stage.unit.pieces")}</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.deck05x2")}</span>
          <strong>{totals.deckCountsByKey["0.5x2"]}</strong>
          <small>{t("stage.unit.pieces")}</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.deck05x1")}</span>
          <strong>{totals.deckCountsByKey["0.5x1"]}</strong>
          <small>{t("stage.unit.pieces")}</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.legs")}</span>
          <strong>{totals.totalLegCount}</strong>
          <small>{t("stage.unit.pieces")}</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.rail2")}</span>
          <strong>{totals.rails2mTotal}</strong>
          <small>{t("stage.unit.pieces")}</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.rail1")}</span>
          <strong>{totals.rails1mTotal}</strong>
          <small>{t("stage.unit.pieces")}</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.area")}</span>
          <strong>{fmt(totals.totalArea, 1)}</strong>
          <small>m²</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.weight")}</span>
          <strong>{fmt(totals.totalWeight, 0)}</strong>
          <small>kg</small>
        </div>
        <div className="dash-item">
          <span>{t("stage.dashboard.load")}</span>
          <strong>{fmt(totals.totalLoadCapacityKg, 0)}</strong>
          <small>{t("stage.unit.weightTotal")}</small>
        </div>
      </div>

      <div className="led-actions" style={{ marginTop: "1rem" }}>
        <button className="btn btn-add" onClick={onAdd}>
          {t("stage.action.add")}
        </button>
      </div>

      {stages.length === 0 ? (
        <div
          className="led-empty"
          style={{
            padding: "2rem",
            textAlign: "center",
            color: "var(--muted, #64748b)",
          }}
        >
          {t("stage.empty")}
        </div>
      ) : (
        <div className="stage-list">
          {stages.map((stage, i) => (
            <StageCard
              key={stage.id}
              stage={stage}
              calc={calcs[i]}
              onUpdate={(patch) => onUpdate(stage.id, patch)}
              onRemove={() => {
                if (
                  window.confirm(
                    t("stage.confirm.delete", { name: stage.name || t("stage.untitled") }),
                  )
                ) {
                  onRemove(stage.id);
                }
              }}
              onDuplicate={() => onDuplicate(stage.id)}
              onExport={() => onExport(stage.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type StageCardProps = {
  stage: Stage;
  calc: ReturnType<typeof computeStage>;
  onUpdate: (patch: Partial<Stage>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onExport: () => void | Promise<void>;
};

function StageCard({
  stage,
  calc,
  onUpdate,
  onRemove,
  onDuplicate,
  onExport,
}: StageCardProps) {
  const t = useT();
  const isManual = stage.editMode === "manual";
  // Local UI state for the manual deck editor.
  const [selectedDeckKey, setSelectedDeckKey] = useState<StageDeckKey>("1x1");
  const [rotated, setRotated] = useState(false);
  // Local UI state for the custom-rail editor.
  const [railMode, setRailMode] = useState<RailMode>("off");

  /** Append a new custom rail. The caller has already snapped the
   *  endpoints to the half-metre grid and validated they sit inside the
   *  drawing canvas. */
  const addCustomRail = (rail: Omit<CustomRail, "id">) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `rail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    onUpdate({ customRails: [...stage.customRails, { id, ...rail }] });
  };

  /** Remove a single custom rail by id. */
  const removeCustomRail = (id: string) => {
    const next = stage.customRails.filter((c) => c.id !== id);
    if (next.length !== stage.customRails.length) {
      onUpdate({ customRails: next });
    }
  };

  // Add a deck at the given half-metre cell (cellX, cellY). Silently
  // refuses if the placement collides with an existing deck. Adjacent
  // edges that just touch are allowed (no collision).
  const addDeckAtCell = (cellX: number, cellY: number) => {
    const dims = placedDims(selectedDeckKey, rotated);
    const candidate: DeckPlacement = {
      key: selectedDeckKey,
      x: cellX * HALF_M,
      y: cellY * HALF_M,
      w: dims.w,
      d: dims.d,
    };
    if (placementCollides(candidate, stage.manualPlacements)) return;
    onUpdate({
      manualPlacements: [...stage.manualPlacements, candidate],
    });
  };

  // Remove whichever deck (if any) covers the given half-metre cell.
  const removeDeckAtCell = (cellX: number, cellY: number) => {
    const px = cellX * HALF_M;
    const py = cellY * HALF_M;
    const next = stage.manualPlacements.filter(
      (p) => !(px >= p.x && px < p.x + p.w && py >= p.y && py < p.y + p.d),
    );
    if (next.length !== stage.manualPlacements.length) {
      onUpdate({ manualPlacements: next });
    }
  };

  /** Rotate the placed (non-square) deck under the given cell in place.
   *  The deck's top-left corner stays where it is; w/d swap. Square
   *  decks (1×1) are ignored. If the rotated rectangle would collide
   *  with another placed deck, the rotation is silently refused — so
   *  the user just sees nothing happen, same UX as a colliding click. */
  /** Cycle the male-connector side override for the deck under the
   *  given placement. The cycle is keyed off the EXPLICIT override
   *  (not the effective side), so a 5-step loop is reachable by
   *  repeated clicking regardless of the current stage default:
   *    inherit → N → E → S → W → inherit → …
   *  Critically this means changing the stage-wide default never
   *  silently drops a per-deck override the user explicitly picked. */
  const cycleConnectorAtPlacement = (p: DeckPlacement) => {
    const k = connectorOverrideKey(p);
    const currentOverride = stage.connectorOverrides[k];
    const overrides = { ...stage.connectorOverrides };
    if (currentOverride === undefined) {
      overrides[k] = "N";
    } else if (currentOverride === "W") {
      // End of the explicit cycle — drop back to "inherit stage default".
      delete overrides[k];
    } else {
      const idx = CONNECTOR_SIDES.indexOf(currentOverride);
      overrides[k] = CONNECTOR_SIDES[idx + 1];
    }
    onUpdate({ connectorOverrides: overrides });
  };

  const rotateDeckAtCell = (cellX: number, cellY: number) => {
    const px = cellX * HALF_M;
    const py = cellY * HALF_M;
    const idx = stage.manualPlacements.findIndex(
      (p) => px >= p.x && px < p.x + p.w && py >= p.y && py < p.y + p.d,
    );
    if (idx === -1) return;
    const target = stage.manualPlacements[idx];
    if (target.key === "1x1") return; // square — rotation is a no-op
    const rotatedTarget: DeckPlacement = {
      ...target,
      w: target.d,
      d: target.w,
    };
    const others = stage.manualPlacements.filter((_, i) => i !== idx);
    if (placementCollides(rotatedTarget, others)) return;
    const next = stage.manualPlacements.slice();
    next[idx] = rotatedTarget;
    onUpdate({ manualPlacements: next });
  };

  return (
    <div className="stage-card">
      <div className="stage-card-header">
        <input
          type="text"
          className="stage-name-input"
          value={stage.name}
          placeholder={t("stage.namePlaceholder")}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
        <div className="stage-card-actions">
          <button
            className="btn btn-tab-action"
            onClick={() => {
              void onExport();
            }}
            title={t("stage.action.downloadTitle")}
          >
            {t("stage.action.download")}
          </button>
          <button className="btn btn-tab-action" onClick={onDuplicate}>
            {t("stage.action.copy")}
          </button>
          <button className="btn btn-del" onClick={onRemove}>
            {t("common.delete")}
          </button>
        </div>
      </div>

      <div className="stage-card-body">
        <div className="stage-controls">
          <label className="stage-field">
            <span>{t("stage.field.layout")}</span>
            <select
              value={stage.editMode}
              onChange={(e) =>
                onUpdate({ editMode: e.target.value as StageEditMode })
              }
            >
              <option value="auto">{t("stage.layout.auto")}</option>
              <option value="manual">{t("stage.layout.manual")}</option>
            </select>
          </label>

          {!isManual && (
            <label className="stage-field stage-field--narrow">
              <span>{t("stage.field.width")}</span>
              <NumberField
                min={0.5}
                step={0.5}
                value={stage.width}
                transform={(n) => Math.max(0.5, snapHalfMetre(n))}
                onCommit={(n) => onUpdate({ width: n })}
              />
            </label>
          )}

          {!isManual && (
            <label className="stage-field stage-field--narrow">
              <span>{t("stage.field.depth")}</span>
              <NumberField
                min={0.5}
                step={0.5}
                value={stage.depth}
                transform={(n) => Math.max(0.5, snapHalfMetre(n))}
                onCommit={(n) => onUpdate({ depth: n })}
              />
            </label>
          )}

          <label className="stage-field">
            <span>{t("stage.field.legHeight")}</span>
            <select
              value={stage.legHeightCm}
              onChange={(e) =>
                onUpdate({ legHeightCm: Number(e.target.value) })
              }
            >
              {STAGE_LEG_HEIGHTS_CM.map((h) => (
                <option key={h} value={h}>
                  {h} cm
                </option>
              ))}
            </select>
            {nivtecBracingNote(stage.legHeightCm).map((n, i) => (
              <small
                key={i}
                style={{
                  color: "#b45309",
                  fontSize: 11,
                  marginTop: 4,
                  lineHeight: 1.3,
                  display: "block",
                }}
              >
                {t("stage.note")}: {n}
              </small>
            ))}
          </label>

          <label className="stage-field">
            <span>{t("stage.field.legConfig")}</span>
            <select
              value={stage.legMode}
              onChange={(e) =>
                onUpdate({ legMode: e.target.value as StageLegMode })
              }
            >
              <option value="shared">
                {t("stage.legs.shared")}
              </option>
              <option value="perDeck">{t("stage.legs.perDeck")}</option>
            </select>
          </label>

          <label className="stage-field stage-field--auto">
            <span>{t("stage.field.buildFrom")}</span>
            <select
              value={stage.buildOrder}
              onChange={(e) =>
                onUpdate({ buildOrder: e.target.value as StageBuildOrder })
              }
              title={t("stage.buildFromHint")}
            >
              <option value="leftToRight">{t("stage.direction.leftToRight")}</option>
              <option value="rightToLeft">{t("stage.direction.rightToLeft")}</option>
            </select>
          </label>

          <label className="stage-field">
            <span>{t("stage.field.maleSide")}</span>
            <select
              value={stage.connectorSide}
              onChange={(e) =>
                onUpdate({ connectorSide: e.target.value as ConnectorSide })
              }
              title={t("stage.maleSideHint")}
            >
              {CONNECTOR_SIDES.map((s) => (
                <option key={s} value={s}>
                  {t(CONNECTOR_SIDE_LABEL_KEYS[s])}
                </option>
              ))}
            </select>
            <small
              style={{
                color: "#64748b",
                fontSize: 11,
                marginTop: 4,
                lineHeight: 1.35,
                display: "block",
              }}
            >
              {t("stage.connectorGuidance")}
            </small>
            {Object.keys(stage.connectorOverrides).length > 0 && (
              <small
                style={{
                  color: "#b45309",
                  fontSize: 11,
                  marginTop: 4,
                  lineHeight: 1.3,
                  display: "block",
                }}
              >
                {t("stage.overrides", { count: Object.keys(stage.connectorOverrides).length })}{" "}
                <button
                  type="button"
                  className="btn-link"
                  style={{
                    background: "none",
                    border: "none",
                    color: "#b45309",
                    textDecoration: "underline",
                    cursor: "pointer",
                    padding: 0,
                    font: "inherit",
                  }}
                  onClick={() => onUpdate({ connectorOverrides: {} })}
                >
                  {t("stage.action.resetAll")}
                </button>
              </small>
            )}
          </label>

          <fieldset className="stage-rails">
            <legend>{t("stage.handrails")}</legend>
            <label>
              <input
                type="checkbox"
                checked={stage.rails.front}
                onChange={(e) =>
                  onUpdate({
                    rails: { ...stage.rails, front: e.target.checked },
                  })
                }
              />
              {t("stage.rail.front")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={stage.rails.back}
                onChange={(e) =>
                  onUpdate({
                    rails: { ...stage.rails, back: e.target.checked },
                  })
                }
              />
              {t("stage.rail.back")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={stage.rails.left}
                onChange={(e) =>
                  onUpdate({
                    rails: { ...stage.rails, left: e.target.checked },
                  })
                }
              />
              {t("stage.rail.left")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={stage.rails.right}
                onChange={(e) =>
                  onUpdate({
                    rails: { ...stage.rails, right: e.target.checked },
                  })
                }
              />
              {t("stage.rail.right")}
            </label>
          </fieldset>

          <label className="stage-field stage-notes-field">
            <span>{t("stage.notes")}</span>
            <input
              type="text"
              value={stage.notes}
              placeholder={t("stage.notesPlaceholder")}
              onChange={(e) => onUpdate({ notes: e.target.value })}
            />
          </label>
        </div>

        {isManual && (
          <DeckPalette
            selectedKey={selectedDeckKey}
            rotated={rotated}
            placedCount={stage.manualPlacements.length}
            onSelect={setSelectedDeckKey}
            onRotate={() => setRotated((r) => !r)}
            onClear={() => {
              if (stage.manualPlacements.length === 0) return;
              if (
                window.confirm(
                    t("stage.confirm.clearDecks"),
                )
              ) {
                onUpdate({ manualPlacements: [] });
              }
            }}
          />
        )}

        <div className="stage-summary-row">
          <div>
            <RailToolbar
              mode={railMode}
              onChange={setRailMode}
              customRailCount={stage.customRails.length}
              onClearAll={() => {
                if (stage.customRails.length === 0) return;
                if (
                  window.confirm(
                    t("stage.confirm.clearRails"),
                  )
                ) {
                  onUpdate({ customRails: [] });
                }
              }}
            />
            <StageSvg
              stage={stage}
              calc={calc}
              interactive={isManual}
              selectedDeckKey={selectedDeckKey}
              rotated={rotated}
              onAddAtCell={addDeckAtCell}
              onRemoveAtCell={removeDeckAtCell}
              onRotateAtCell={rotateDeckAtCell}
              onCycleConnector={cycleConnectorAtPlacement}
              railMode={railMode}
              onAddCustomRail={addCustomRail}
              onRemoveCustomRail={removeCustomRail}
            />
          </div>
          <StageBreakdown stage={stage} calc={calc} />
        </div>
      </div>
    </div>
  );
}

/** Palette of deck types for manual placement. The selected deck +
 *  rotation get placed when the user clicks an empty cell on the stage
 *  visual. 1×1 ignores rotation (it's square). */
function DeckPalette({
  selectedKey,
  rotated,
  placedCount,
  onSelect,
  onRotate,
  onClear,
}: {
  selectedKey: StageDeckKey;
  rotated: boolean;
  placedCount: number;
  onSelect: (k: StageDeckKey) => void;
  onRotate: () => void;
  onClear: () => void;
}) {
  const t = useT();
  const items: { key: StageDeckKey; label: string }[] = [
    { key: "2x1", label: "2 × 1" },
    { key: "1x1", label: "1 × 1" },
    { key: "0.5x2", label: "0.5 × 2" },
    { key: "0.5x1", label: "0.5 × 1" },
  ];
  return (
    <div className="deck-palette">
      <div className="deck-palette-row">
        <span className="deck-palette-label">{t("stage.palette.place")}</span>
        {items.map((it) => {
          const isActive = selectedKey === it.key;
          const dims = placedDims(it.key, rotated);
          // Mini preview rectangle proportional to dims (max 28px on longest side).
          const previewMax = 28;
          const longest = Math.max(dims.w, dims.d);
          const sw = (dims.w / longest) * previewMax;
          const sd = (dims.d / longest) * previewMax;
          return (
            <button
              key={it.key}
              type="button"
              className={`deck-palette-btn${isActive ? " is-active" : ""}`}
              onClick={() => onSelect(it.key)}
              title={t("stage.palette.placeTitle", { size: it.label })}
            >
              <span
                className="deck-palette-swatch"
                style={{
                  width: sw,
                  height: sd,
                  background: DECK_FILL[it.key],
                }}
              />
              <span>{it.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="deck-palette-btn deck-palette-rotate"
          onClick={onRotate}
          disabled={selectedKey === "1x1"}
          title={t("stage.palette.rotateTitle")}
        >
          {rotated ? t("stage.palette.rotated") : t("stage.palette.rotate")}
        </button>
        <button
          type="button"
          className="deck-palette-btn deck-palette-clear"
          onClick={onClear}
          disabled={placedCount === 0}
          title={t("stage.palette.clearTitle")}
        >
          {t("stage.action.clearAll")}
        </button>
      </div>
      <div className="deck-palette-help">
        {t("stage.palette.help")}
      </div>
    </div>
  );
}

/** Compact toolbar for drawing custom rails on the stage SVG.
 *  Modes: Off, Add 2 m, Add 1 m, Delete. The selected mode determines
 *  what clicks on the stage drawing do. */
function RailToolbar({
  mode,
  onChange,
  customRailCount,
  onClearAll,
}: {
  mode: RailMode;
  onChange: (m: RailMode) => void;
  customRailCount: number;
  onClearAll: () => void;
}) {
  const t = useT();
  const items: { mode: RailMode; label: string; isDelete?: boolean }[] = [
    { mode: "off", label: t("stage.railTool.off") },
    { mode: "add2", label: t("stage.railTool.add2") },
    { mode: "add1", label: t("stage.railTool.add1") },
    { mode: "delete", label: t("stage.railTool.delete"), isDelete: true },
  ];
  const helpText = (() => {
    if (mode === "add2" || mode === "add1") {
      return t("stage.railTool.drawHelp", { length: mode === "add2" ? "2 m" : "1 m" });
    }
    if (mode === "delete") {
      return t("stage.railTool.deleteHelp");
    }
    return t("stage.railTool.offHelp");
  })();
  return (
    <div className="stage-rail-tools">
      <span className="stage-rail-tools-label">{t("stage.customRails")}</span>
      {items.map((it) => (
        <button
          key={it.mode}
          type="button"
          className={`stage-rail-tool-btn${
            mode === it.mode ? " is-active" : ""
          }${it.isDelete ? " is-delete" : ""}`}
          onClick={() => onChange(mode === it.mode ? "off" : it.mode)}
          title={it.label}
        >
          {it.label}
        </button>
      ))}
      <button
        type="button"
        className="stage-rail-tool-btn"
        onClick={onClearAll}
        disabled={customRailCount === 0}
        title={t("stage.railTool.clearTitle")}
      >
        {t("stage.action.clearAll")} ({customRailCount})
      </button>
      <div className="stage-rail-tool-help">{helpText}</div>
    </div>
  );
}

/** Top-down preview of the stage with each deck drawn as a coloured rectangle. */
function StageSvg({
  stage,
  calc,
  interactive = false,
  selectedDeckKey = "1x1",
  rotated = false,
  onAddAtCell,
  onRemoveAtCell,
  onRotateAtCell,
  onCycleConnector,
  railMode = "off",
  onAddCustomRail,
  onRemoveCustomRail,
}: {
  stage: Stage;
  calc: ReturnType<typeof computeStage>;
  /** Manual editor mode: render half-metre grid + click handlers. */
  interactive?: boolean;
  /** Currently-selected deck type from the palette (manual mode). */
  selectedDeckKey?: StageDeckKey;
  /** 90° rotation flag from the palette (manual mode). */
  rotated?: boolean;
  /** Click on an empty cell when interactive: add the selected deck. */
  onAddAtCell?: (cellX: number, cellY: number) => void;
  /** Click on a deck when interactive: remove that deck. */
  onRemoveAtCell?: (cellX: number, cellY: number) => void;
  /** Right-click (or Shift+click) on a placed deck: rotate it 90° in
   *  place (top-left corner stays anchored). No-op on 1×1 decks. */
  onRotateAtCell?: (cellX: number, cellY: number) => void;
  /** Click on the orange male-edge stripe of a placed deck: cycle
   *  that deck's connector orientation (N → E → S → W → inherit). */
  onCycleConnector?: (p: DeckPlacement) => void;
  /** Currently-selected custom-rail tool (set by the toolbar). */
  railMode?: RailMode;
  /** Commit a fully-snapped, validated custom rail (no id yet). */
  onAddCustomRail?: (rail: Omit<CustomRail, "id">) => void;
  /** Remove a custom rail by id (delete-mode click). */
  onRemoveCustomRail?: (id: string) => void;
}) {
  const t = useT();
  const PAD = 12;
  // Internal maximum render size (in SVG pixels) for the stage
  // drawing. The actual on-screen width is capped by the column
  // width via CSS (.stage-preview svg uses width:100%), so a higher
  // value here lets large stages render closer to their natural
  // proportions before the SVG gets letterboxed.
  const MAX = 760;

  // Canvas size (clickable area):
  //  - auto mode: stage.width × stage.depth (the entered size)
  //  - manual mode: bounding box of placements + 1m padding on each
  //    side, with a minimum of 6×4 m so an empty stage still shows a
  //    workable grid. The canvas grows as decks are placed near the edge.
  const bbox = placementsBounds(stage.manualPlacements);
  const canvasW = interactive
    ? Math.max(bbox.width + 1, 6)
    : Math.max(stage.width, 0.5);
  const canvasD = interactive
    ? Math.max(bbox.depth + 1, 4)
    : Math.max(stage.depth, 0.5);

  // Effective stage rectangle used for rails & background border.
  // In manual mode this is the placements bounding box; in auto mode
  // it is the canvas (the entire stage).
  const stageW =
    stage.editMode === "manual" ? bbox.width : Math.max(stage.width, 0.5);
  const stageD =
    stage.editMode === "manual" ? bbox.depth : Math.max(stage.depth, 0.5);

  const scale = Math.min(MAX / canvasW, MAX / canvasD);
  const W = canvasW * scale + PAD * 2;
  const H = canvasD * scale + PAD * 2;

  // Hover preview state (manual mode only): which half-metre cell the
  // pointer is currently over.
  const [hover, setHover] = useState<{ cx: number; cy: number } | null>(null);

  // ─── Custom-rail editor state ──────────────────────────────────────
  //  • railAnchor: the first click of an in-progress 2-click draw,
  //    snapped to the half-metre grid (in stage metres).
  //  • railHover: the live pointer position, snapped to the half-metre
  //    grid, used to render the dashed preview from anchor → pointer.
  //  • svgRef gives us access to getScreenCTM() so we can convert
  //    screen pixels back into our SVG/metre coordinates.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [railAnchor, setRailAnchor] = useState<
    { x: number; y: number } | null
  >(null);
  const [railHover, setRailHover] = useState<{ x: number; y: number } | null>(
    null,
  );
  const isAddMode = railMode === "add1" || railMode === "add2";
  const previewType: 1 | 2 = railMode === "add2" ? 2 : 1;

  // Reset any in-progress draw when the toolbar tool changes (e.g.
  // user switches from Add 2 m → Delete or → Off mid-draw). Otherwise
  // the next click in a new mode would commit a stale rail.
  useEffect(() => {
    setRailAnchor(null);
    setRailHover(null);
  }, [railMode]);

  // Esc cancels an in-progress draw without leaving the tool.
  useEffect(() => {
    if (!isAddMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailAnchor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAddMode]);

  // Convert a pointer event's screen coords into the canvas-local
  // metre coordinate system used everywhere else in this component.
  const pointerToMetres = (e: React.MouseEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: (local.x - PAD) / scale, y: (local.y - PAD) / scale };
  };
  const snap = (n: number) => Math.round(n * 2) / 2;

  // Helper: pixel coords of a custom-rail segment (ax,ay is the
  // lower endpoint; the rail extends +type metres along `orient`).
  const railPx = (rail: {
    ax: number;
    ay: number;
    orient: "h" | "v";
    type: 1 | 2;
  }) => {
    const x1 = PAD + rail.ax * scale;
    const y1 = PAD + rail.ay * scale;
    const x2 =
      rail.orient === "h" ? PAD + (rail.ax + rail.type) * scale : x1;
    const y2 =
      rail.orient === "v" ? PAD + (rail.ay + rail.type) * scale : y1;
    return { x1, y1, x2, y2 };
  };

  // Compute the in-progress preview rail given anchor + hover. The
  // dominant axis (|dx| vs |dy|) decides orientation; the sign of
  // that delta decides direction. Endpoints are snapped to the half-
  // metre grid and validated to lie inside the canvas.
  const preview = (() => {
    if (!isAddMode || !railAnchor || !railHover) return null;
    const dx = railHover.x - railAnchor.x;
    const dy = railHover.y - railAnchor.y;
    // Require a minimum movement of one snap step (0.5 m) before
    // we'll show a preview / commit a rail. Without this, a stray
    // double-click on the anchor would silently drop a rail in an
    // arbitrary direction (orient=h, sign=+1 fallbacks).
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
    const orient: "h" | "v" = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
    const sign =
      orient === "h"
        ? Math.sign(dx) || 1
        : Math.sign(dy) || 1;
    const ax =
      orient === "h"
        ? sign > 0
          ? railAnchor.x
          : railAnchor.x - previewType
        : railAnchor.x;
    const ay =
      orient === "v"
        ? sign > 0
          ? railAnchor.y
          : railAnchor.y - previewType
        : railAnchor.y;
    const sax = snap(ax);
    const say = snap(ay);
    const ex = orient === "h" ? sax + previewType : sax;
    const ey = orient === "v" ? say + previewType : say;
    const valid =
      sax >= 0 && say >= 0 && ex <= canvasW && ey <= canvasD;
    return { ax: sax, ay: say, orient, type: previewType, valid };
  })();

  const handleRailMove = (e: React.MouseEvent<SVGElement>) => {
    if (!isAddMode) return;
    const m = pointerToMetres(e);
    setRailHover({ x: snap(m.x), y: snap(m.y) });
  };
  const handleRailClick = (e: React.MouseEvent<SVGElement>) => {
    if (!isAddMode) return;
    const m = pointerToMetres(e);
    const sx = snap(m.x);
    const sy = snap(m.y);
    if (!railAnchor) {
      // First click: drop the anchor. The user now drags toward
      // either axis to choose direction; the second click commits.
      setRailAnchor({ x: sx, y: sy });
      setRailHover({ x: sx, y: sy });
      return;
    }
    if (preview && preview.valid) {
      onAddCustomRail?.({
        ax: preview.ax,
        ay: preview.ay,
        orient: preview.orient,
        type: preview.type,
      });
      setRailAnchor(null);
      setRailHover(null);
    }
  };

  // Compute hover preview rectangle and whether placement would be valid.
  const hoverPreview = (() => {
    if (!interactive || !hover) return null;
    const dims = placedDims(selectedDeckKey, rotated);
    const hx = hover.cx * HALF_M;
    const hy = hover.cy * HALF_M;
    // Is the hovered cell already covered by a placed deck? Then the
    // click would REMOVE that deck — show its outline as the preview.
    const covering = stage.manualPlacements.find(
      (p) =>
        hx >= p.x && hx < p.x + p.w && hy >= p.y && hy < p.y + p.d,
    );
    if (covering) {
      return { mode: "remove" as const, p: covering };
    }
    // Otherwise we're going to ADD — preview the candidate. The only
    // real constraint in manual mode is that decks must not overlap an
    // existing placement; the working canvas auto-grows to fit, so
    // there is no fixed boundary to overflow.
    const candidate: DeckPlacement = {
      key: selectedDeckKey,
      x: hx,
      y: hy,
      w: dims.w,
      d: dims.d,
    };
    const collides = placementCollides(candidate, stage.manualPlacements);
    return {
      mode: "add" as const,
      p: candidate,
      valid: !collides,
    };
  })();

  // Cell counts (half-metre cells) for the grid + click overlay.
  const cellsW = Math.round(canvasW / HALF_M);
  const cellsD = Math.round(canvasD / HALF_M);

  return (
    <div className="stage-preview">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{
          maxWidth: W,
          height: "auto",
          display: "block",
          touchAction: "manipulation",
        }}
        onMouseLeave={() => {
          setHover(null);
          setRailHover(null);
        }}
      >
        {/* Canvas background (clickable area). In manual mode this is the
            larger working area; the actual stage outline is drawn below. */}
        <rect
          x={PAD}
          y={PAD}
          width={canvasW * scale}
          height={canvasD * scale}
          fill="#0f172a"
          fillOpacity={interactive ? 0.03 : 0.05}
          stroke="#0f172a"
          strokeOpacity={interactive ? 0.15 : 0.4}
          strokeWidth={1}
        />

        {/* Half-metre grid (manual mode only) */}
        {interactive && (
          <g pointerEvents="none">
            {Array.from({ length: cellsW + 1 }).map((_, i) => (
              <line
                key={`vx-${i}`}
                x1={PAD + i * HALF_M * scale}
                y1={PAD}
                x2={PAD + i * HALF_M * scale}
                y2={PAD + canvasD * scale}
                stroke="#94a3b8"
                strokeOpacity={i % 2 === 0 ? 0.35 : 0.18}
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: cellsD + 1 }).map((_, i) => (
              <line
                key={`hz-${i}`}
                x1={PAD}
                y1={PAD + i * HALF_M * scale}
                x2={PAD + canvasW * scale}
                y2={PAD + i * HALF_M * scale}
                stroke="#94a3b8"
                strokeOpacity={i % 2 === 0 ? 0.35 : 0.18}
                strokeWidth={1}
              />
            ))}
          </g>
        )}

        {/* Stage outline (manual mode only — auto mode's outline is the
            canvas itself, drawn above). Dashed rectangle at the bounding
            box of placed decks so the user can see the actual stage shape
            inside the larger working canvas. */}
        {interactive && stageW > 0 && stageD > 0 && (
          <rect
            x={PAD}
            y={PAD}
            width={stageW * scale}
            height={stageD * scale}
            fill="none"
            stroke="#0f172a"
            strokeOpacity={0.55}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
        {/* Decks. In interactive mode the click-catcher cells (drawn
            last, on top) intercept clicks and either add or remove a
            deck depending on whether the clicked cell is occupied — so
            the deck rects themselves don't need their own click
            handlers. */}
        {calc.decks.map((p, i) => {
          const asm = calc.assembly[i];
          const dw = p.w * scale;
          const dh = p.d * scale;
          const cxDeck = PAD + (p.x + p.w / 2) * scale;
          const cyDeck = PAD + (p.y + p.d / 2) * scale;
          // Vertically stacked, horizontally centred layout per deck:
          //
          //     ( 1 )      ← assembly badge (white circle + number)
          //     2 × 1      ← deck size label
          //    +2 legs     ← marginal-leg caption
          //
          // The badge sits ABOVE the size name and the caption sits
          // BELOW it, all on the deck's vertical centre line — so
          // nothing overlaps the size label or the leg dots in the
          // four corners. Build direction no longer affects badge
          // position (the sequence numbers themselves convey the
          // build order); it only affects which deck is #1.
          const sizeFont = Math.min(dw, dh) * 0.22;
          const showSize = dw >= 32 && dh >= 22;
          const badgeRadius = Math.max(
            8,
            Math.min(13, Math.min(dw, dh) * 0.16),
          );
          // Vertical positions. When the size label IS shown we anchor
          // off it so the three rows nest tightly; when it's hidden
          // (very small decks) we just centre the badge.
          const sizeY = cyDeck;
          const badgeCy = showSize
            ? sizeY - sizeFont * 0.55 - badgeRadius - 2
            : cyDeck;
          const captionFont = Math.max(9, badgeRadius * 0.95);
          const captionY = sizeY + sizeFont * 0.55 + captionFont * 0.9 + 2;
          // Only draw the caption when there's enough vertical room
          // for badge + size label + caption without crowding the
          // deck edge or the leg dots in the corners.
          const stackHeight =
            badgeRadius * 2 +
            (showSize ? sizeFont : 0) +
            captionFont +
            12;
          const showCaption = showSize && dh >= stackHeight && dw >= 56;
          return (
            <g key={i}>
              <rect
                x={PAD + p.x * scale}
                y={PAD + p.y * scale}
                width={dw}
                height={dh}
                fill={DECK_FILL[p.key]}
                fillOpacity={0.7}
                stroke="#0f172a"
                strokeWidth={1}
                strokeOpacity={0.7}
              />
              {showSize && (
                <text
                  x={cxDeck}
                  y={sizeY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={sizeFont}
                  fontFamily="system-ui, sans-serif"
                  fill="#fff"
                  fontWeight={600}
                >
                  {p.key === "2x1"
                    ? "2×1"
                    : p.key === "1x1"
                      ? "1×1"
                      : p.key === "0.5x2"
                        ? "0.5×2"
                        : "0.5×1"}
                </text>
              )}
              {asm && (
                <g pointerEvents="none">
                  <circle
                    cx={cxDeck}
                    cy={badgeCy}
                    r={badgeRadius}
                    fill="#fff"
                    stroke="#0f172a"
                    strokeWidth={1.25}
                  />
                  <text
                    x={cxDeck}
                    y={badgeCy}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={badgeRadius * 1.15}
                    fontFamily="system-ui, sans-serif"
                    fill="#0f172a"
                    fontWeight={700}
                  >
                    {asm.sequence}
                  </text>
                  {showCaption && (
                    <text
                      x={cxDeck}
                      y={captionY}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={captionFont}
                      fontFamily="system-ui, sans-serif"
                      fill="#fff"
                      fontWeight={600}
                    >
                      {t("stage.svg.legsAdded", { count: asm.legsAdded })}
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}
        {/* Leg dots. In both modes the dots are drawn slightly INSIDE
            the deck (inset from the corner) so they're visually
            separated from the deck outline.
            - "perDeck": every deck draws its own 4 inset dots, so
              shared corners show one dot per deck (overlapping
              clusters).
            - "shared" (Nivtec 4-2-2-1): we draw exactly one inset dot
              per unique shared corner — the dot is inset toward the
              centre of one of the decks that actually owns this
              corner. */}
        {stage.legMode === "perDeck"
          ? calc.decks.flatMap((p, i) => {
              const inset = Math.min(p.w, p.d) * 0.12 * scale;
              const x1 = PAD + p.x * scale + inset;
              const y1 = PAD + p.y * scale + inset;
              const x2 = PAD + (p.x + p.w) * scale - inset;
              const y2 = PAD + (p.y + p.d) * scale - inset;
              return [
                <circle key={`${i}-tl`} cx={x1} cy={y1} r={3} fill="#0f172a" />,
                <circle key={`${i}-tr`} cx={x2} cy={y1} r={3} fill="#0f172a" />,
                <circle key={`${i}-bl`} cx={x1} cy={y2} r={3} fill="#0f172a" />,
                <circle key={`${i}-br`} cx={x2} cy={y2} r={3} fill="#0f172a" />,
              ];
            })
          : calc.legPositions.map((pos, i) => {
              const owner = calc.decks.find(
                (d) =>
                  (d.x === pos.x || d.x + d.w === pos.x) &&
                  (d.y === pos.y || d.y + d.d === pos.y),
              );
              if (!owner) {
                return (
                  <circle
                    key={i}
                    cx={PAD + pos.x * scale}
                    cy={PAD + pos.y * scale}
                    r={3}
                    fill="#0f172a"
                  />
                );
              }
              const insetM = Math.min(owner.w, owner.d) * 0.12;
              const dx = owner.x + owner.w / 2 > pos.x ? insetM : -insetM;
              const dy = owner.y + owner.d / 2 > pos.y ? insetM : -insetM;
              return (
                <circle
                  key={i}
                  cx={PAD + (pos.x + dx) * scale}
                  cy={PAD + (pos.y + dy) * scale}
                  r={3}
                  fill="#0f172a"
                />
              );
            })}
        {/* Rail strokes — front bottom, back top, left/right sides.
            In manual mode rails follow the actual stage (bounding box of
            placements); in auto mode they follow the entered W × D. */}
        {stage.rails.front && stageW > 0 && (
          <line
            x1={PAD}
            y1={PAD + stageD * scale}
            x2={PAD + stageW * scale}
            y2={PAD + stageD * scale}
            stroke="#dc2626"
            strokeWidth={4}
          />
        )}
        {stage.rails.back && stageW > 0 && (
          <line
            x1={PAD}
            y1={PAD}
            x2={PAD + stageW * scale}
            y2={PAD}
            stroke="#dc2626"
            strokeWidth={4}
          />
        )}
        {stage.rails.left && stageD > 0 && (
          <line
            x1={PAD}
            y1={PAD}
            x2={PAD}
            y2={PAD + stageD * scale}
            stroke="#dc2626"
            strokeWidth={4}
          />
        )}
        {stage.rails.right && stageD > 0 && (
          <line
            x1={PAD + stageW * scale}
            y1={PAD}
            x2={PAD + stageW * scale}
            y2={PAD + stageD * scale}
            stroke="#dc2626"
            strokeWidth={4}
          />
        )}

        {/* Hover preview rectangle (manual mode). Drawn before the
            click-catcher cells so it doesn't intercept pointer events. */}
        {hoverPreview && hoverPreview.mode === "add" && (
          <rect
            x={PAD + hoverPreview.p.x * scale}
            y={PAD + hoverPreview.p.y * scale}
            width={hoverPreview.p.w * scale}
            height={hoverPreview.p.d * scale}
            fill={
              hoverPreview.valid
                ? DECK_FILL[hoverPreview.p.key]
                : "#dc2626"
            }
            fillOpacity={hoverPreview.valid ? 0.35 : 0.25}
            stroke={hoverPreview.valid ? DECK_FILL[hoverPreview.p.key] : "#dc2626"}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            pointerEvents="none"
          />
        )}
        {hoverPreview && hoverPreview.mode === "remove" && (
          <rect
            x={PAD + hoverPreview.p.x * scale}
            y={PAD + hoverPreview.p.y * scale}
            width={hoverPreview.p.w * scale}
            height={hoverPreview.p.d * scale}
            fill="#dc2626"
            fillOpacity={0.15}
            stroke="#dc2626"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        )}

        {/* Custom (drawn) rails. Always rendered. In delete mode each
            one also gets a thick transparent hit-line so users can
            click anywhere along its length to remove it. */}
        {stage.customRails.map((rail) => {
          const { x1, y1, x2, y2 } = railPx(rail);
          return (
            <g key={rail.id}>
              {railMode === "delete" && (
                <line
                  className="stage-rail-hit is-deletable"
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  onClick={() => onRemoveCustomRail?.(rail.id)}
                />
              )}
              <line
                className="stage-rail-segment"
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
              />
            </g>
          );
        })}

        {/* In-progress rail preview (after the first click). Dashed
            red when valid, slate when it would fall outside the
            canvas. Click 2 commits via the overlay below. */}
        {preview && (
          <line
            className={`stage-rail-preview ${
              preview.valid ? "is-valid" : "is-invalid"
            }`}
            x1={PAD + preview.ax * scale}
            y1={PAD + preview.ay * scale}
            x2={
              PAD +
              (preview.orient === "h"
                ? preview.ax + preview.type
                : preview.ax) *
                scale
            }
            y2={
              PAD +
              (preview.orient === "v"
                ? preview.ay + preview.type
                : preview.ay) *
                scale
            }
          />
        )}

        {/* Anchor dot for the first click of a 2-click draw. */}
        {isAddMode && railAnchor && (
          <circle
            className="stage-rail-anchor"
            cx={PAD + railAnchor.x * scale}
            cy={PAD + railAnchor.y * scale}
            r={4}
          />
        )}

        {/* Click-catcher grid (manual mode only). One transparent rect
            per half-metre cell — clicking adds the selected deck (the
            click handler walks down to the cell coords) and hovering
            updates the preview. Decks above this layer take precedence
            because they intercept clicks first via their own onClick.
            Suppressed while a rail tool is active, so deck edits don't
            steal clicks meant for the rail editor. */}
        {interactive &&
          railMode === "off" &&
          Array.from({ length: cellsD }).map((_, cy) =>
            Array.from({ length: cellsW }).map((_, cx) => (
              <rect
                key={`cell-${cx}-${cy}`}
                x={PAD + cx * HALF_M * scale}
                y={PAD + cy * HALF_M * scale}
                width={HALF_M * scale}
                height={HALF_M * scale}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover({ cx, cy })}
                onContextMenu={(e) => {
                  // Right-click on a placed deck = rotate it in place.
                  // Always preventDefault so the browser menu stays
                  // out of the way during stage editing.
                  e.preventDefault();
                  const px = cx * HALF_M;
                  const py = cy * HALF_M;
                  const covering = stage.manualPlacements.some(
                    (p) =>
                      px >= p.x &&
                      px < p.x + p.w &&
                      py >= p.y &&
                      py < p.y + p.d,
                  );
                  if (covering) onRotateAtCell?.(cx, cy);
                }}
                onClick={(e) => {
                  const px = cx * HALF_M;
                  const py = cy * HALF_M;
                  const covering = stage.manualPlacements.some(
                    (p) =>
                      px >= p.x &&
                      px < p.x + p.w &&
                      py >= p.y &&
                      py < p.y + p.d,
                  );
                  // Shift+click on a placed deck = rotate it in place
                  // (alternative to right-click, friendlier on touchpads).
                  if (covering && e.shiftKey) {
                    onRotateAtCell?.(cx, cy);
                    return;
                  }
                  // Otherwise: covered = remove, empty = add.
                  if (covering) {
                    onRemoveAtCell?.(cx, cy);
                  } else {
                    onAddAtCell?.(cx, cy);
                  }
                }}
              />
            )),
          )}

        {/* Male-connector edge stripes — drawn AFTER the click-catcher
            cells so they sit on top in interactive mode and absorb the
            click for the per-deck connector cycle. In non-interactive
            mode (auto-mode preview, exports, etc.) they're purely
            informational. */}
        {calc.decks.flatMap((p, i) => {
          // Per Nivtec, only the *starting* deck dictates the
          // tongue/groove orientation of the whole stage — every
          // following deck is forced into position by hooking into the
          // previous one. So the orange male-edge marker only matters
          // on the deck(s) the crew lands fresh with 4 legs (in shared
          // mode that's the single 4-leg starter; in per-deck-leg mode
          // every deck stands alone with 4 legs).
          const legsAdded = calc.assembly[i]?.legsAdded ?? 0;
          if (legsAdded !== 4) return [];
          const primary = effectiveConnectorSide(stage, p);
          // Per Nivtec: tongues face "rear AND right" — i.e. the male
          // edges are on TWO adjacent sides 90° apart, clockwise from
          // the primary. CONNECTOR_SIDES is ordered N,E,S,W so +1 mod 4
          // is always the clockwise neighbour.
          const adjIdx =
            (CONNECTOR_SIDES.indexOf(primary) + 1) % CONNECTOR_SIDES.length;
          const adjacent = CONNECTOR_SIDES[adjIdx];
          const stripe = 5;
          const x0 = PAD + p.x * scale;
          const y0 = PAD + p.y * scale;
          const dw = p.w * scale;
          const dh = p.d * scale;
          const isOverride =
            stage.connectorOverrides[connectorOverrideKey(p)] !== undefined;
          const clickable =
            interactive && railMode === "off" && !!onCycleConnector;
          const stripeRect = (side: ConnectorSide) => {
            let rx = x0;
            let ry = y0;
            let rw = dw;
            let rh = dh;
            if (side === "N") {
              rh = stripe;
            } else if (side === "S") {
              ry = y0 + dh - stripe;
              rh = stripe;
            } else if (side === "E") {
              rx = x0 + dw - stripe;
              rw = stripe;
            } else {
              rw = stripe;
            }
            return { rx, ry, rw, rh };
          };
          return [primary, adjacent].map((side, j) => {
            const { rx, ry, rw, rh } = stripeRect(side);
            // Only the primary stripe absorbs clicks for cycling; the
            // adjacent stripe is informational so it can't shift the
            // hit-area expectations.
            const isPrimary = j === 0;
            const interactiveStripe = clickable && isPrimary;
            return (
              <rect
                key={`male-${i}-${side}`}
                x={rx}
                y={ry}
                width={rw}
                height={rh}
                fill={MALE_EDGE_COLOR}
                fillOpacity={isOverride ? 1 : 0.85}
                stroke={isOverride ? "#7c2d12" : "none"}
                strokeWidth={isOverride ? 1 : 0}
                style={interactiveStripe ? { cursor: "pointer" } : undefined}
                pointerEvents={interactiveStripe ? "all" : "none"}
                onClick={
                  interactiveStripe
                    ? (e) => {
                        e.stopPropagation();
                        onCycleConnector?.(p);
                      }
                    : undefined
                }
              >
                {interactiveStripe && (
                  <title>
                    {t("stage.svg.maleSides", {
                      primary: t(CONNECTOR_SIDE_LABEL_KEYS[primary]),
                      adjacent: t(CONNECTOR_SIDE_LABEL_KEYS[adjacent]),
                      state: t(isOverride ? "stage.svg.override" : "stage.svg.default"),
                    })}
                  </title>
                )}
              </rect>
            );
          });
        })}

        {/* Rail-add click overlay — drawn last so it sits above
            everything and captures the two clicks needed to drop a
            custom rail. Only rendered while the user has Add 1 m or
            Add 2 m selected. In Delete mode we don't need an overlay
            because each rail provides its own click target. */}
        {isAddMode && (
          <rect
            x={PAD}
            y={PAD}
            width={canvasW * scale}
            height={canvasD * scale}
            fill="transparent"
            style={{ cursor: "crosshair" }}
            onMouseMove={handleRailMove}
            onClick={handleRailClick}
          />
        )}
      </svg>
      <div className="stage-preview-legend">
        <span>
          <i style={{ background: DECK_FILL["2x1"] }} /> 2×1
        </span>
        <span>
          <i style={{ background: DECK_FILL["1x1"] }} /> 1×1
        </span>
        <span>
          <i style={{ background: DECK_FILL["0.5x2"] }} /> 0.5×2
        </span>
        <span>
          <i style={{ background: DECK_FILL["0.5x1"] }} /> 0.5×1
        </span>
        <span>
          <i style={{ background: "#dc2626" }} /> {t("stage.legend.rail")}
        </span>
        <span>
          <i style={{ background: "#0f172a", borderRadius: "50%" }} /> {t("stage.legend.leg")}
        </span>
        <span title={t("stage.legend.maleTitle")}>
          <i style={{ background: MALE_EDGE_COLOR }} /> {t("stage.legend.maleEdges")} (
          {t(CONNECTOR_SIDE_SHORT_KEYS[stage.connectorSide])} + {t("stage.legend.adjacentShortSide")})
        </span>
      </div>
    </div>
  );
}

function StageBreakdown({
  stage,
  calc,
}: {
  stage: Stage;
  calc: ReturnType<typeof computeStage>;
}) {
  const t = useT();
  const usedDecks = STAGE_DECKS.filter((d) => calc.deckCounts[d.key] > 0);
  const legSpec = STAGE_LEGS.find((l) => l.heightCm === stage.legHeightCm);

  return (
    <div className="stage-breakdown">
      {!calc.fits && (
        <div className="stage-warning" data-testid="stage-warning">
          ⚠ {t("stage.warning.unfillable")}
        </div>
      )}

      <h4>{t("stage.decks")}</h4>
      <table className="stage-table">
        <thead>
          <tr>
            <th>{t("stage.table.size")}</th><th>{t("stage.table.quantity")}</th><th>{t("stage.table.unitWeight")}</th><th>{t("stage.table.total")}</th>
          </tr>
        </thead>
        <tbody>
          {usedDecks.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ color: "var(--muted, #64748b)" }}>
                {t("stage.none")}
              </td>
            </tr>
          ) : (
            usedDecks.map((d) => (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td>{calc.deckCounts[d.key]}</td>
                <td>{fmt(d.weight, 1)} kg</td>
                <td>{fmt(d.weight * calc.deckCounts[d.key], 1)} kg</td>
              </tr>
            ))
          )}
          <tr className="stage-row-total">
            <td>{t("stage.table.subtotal")}</td>
            <td />
            <td />
            <td>{fmt(calc.deckWeight, 1)} kg</td>
          </tr>
        </tbody>
      </table>

      <h4>
        Legs ({stage.legHeightCm} cm
        {stage.legMode === "perDeck"
          ? ` · ${t("stage.legs.perDeck")}`
          : ` · ${t("stage.legs.sharedCorners")}`}
        )
      </h4>
      <table className="stage-table">
        <tbody>
          <tr>
            <td>{t("stage.table.quantity")}</td>
            <td>{calc.legCount} {t("stage.unit.pieces")}</td>
          </tr>
          <tr>
            <td>{t("stage.table.unitWeight")}</td>
            <td>{fmt(legSpec?.weight ?? 0, 2)} kg</td>
          </tr>
          <tr className="stage-row-total">
            <td>{t("stage.table.subtotal")}</td>
            <td>{fmt(calc.legWeight, 1)} kg</td>
          </tr>
        </tbody>
      </table>

      <h4>{t("stage.loadCapacity")}</h4>
      <table className="stage-table">
        <tbody>
          <tr>
            <td>{t("stage.table.distributedLoad")}</td>
            <td>
              <strong>{fmt(calc.loadCapacityKg, 0)} kg</strong>
              {!calc.fits && ` (${t("stage.placedAreaOnly")})`}
            </td>
          </tr>
          <tr>
            <td>{t("stage.table.ratedSwl")}</td>
            <td>
              {fmt(calc.effectiveSwlPerM2, 0)} kg/m² @ {stage.legHeightCm} cm
            </td>
          </tr>
        </tbody>
      </table>
      <div className="stage-capacity-note">
        {t("stage.capacityNote")}
      </div>

      {(calc.railBreakdown.length > 0 || calc.customRailsCount > 0) && (
        <>
          <h4>{t("stage.handrails")}</h4>
          <table className="stage-table">
            <thead>
              <tr>
                <th>{t("stage.table.side")}</th>
                <th>{t("stage.table.length")}</th>
                <th>2 m</th>
                <th>1 m</th>
              </tr>
            </thead>
            <tbody>
              {calc.railBreakdown.map((r) => (
                <tr key={r.side}>
                  <td style={{ textTransform: "capitalize" }}>{t(`stage.rail.${r.side}` as "stage.rail.front")}</td>
                  <td>{fmt(r.lengthM, 1)} m</td>
                  <td>{r.count2m}</td>
                  <td>{r.count1m}</td>
                </tr>
              ))}
              {calc.customRailsCount > 0 && (
                <tr>
                  <td>{t("stage.customDrawn")}</td>
                  <td>{fmt(calc.customRailsLength, 1)} m</td>
                  <td>
                    {stage.customRails.filter((c) => c.type === 2).length}
                  </td>
                  <td>
                    {stage.customRails.filter((c) => c.type === 1).length}
                  </td>
                </tr>
              )}
              <tr className="stage-row-total">
                <td>{t("stage.table.subtotal")}</td>
                <td>{fmt(calc.railLengthTotal, 1)} m</td>
                <td>{calc.rails2mTotal}</td>
                <td>{calc.rails1mTotal}</td>
              </tr>
              <tr>
                <td colSpan={3}>{t("stage.weight")}</td>
                <td>{fmt(calc.railWeight, 1)} kg</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {(() => {
        const manualBounds =
          stage.editMode === "manual"
            ? placementsBounds(stage.manualPlacements)
            : null;
        const subWidth = manualBounds ? manualBounds.width : stage.width;
        const subDepth = manualBounds ? manualBounds.depth : stage.depth;
        const hasDims = subWidth > 0 && subDepth > 0;
        return (
          <div className="stage-grand-total">
            <div className="stage-grand-stat">
              <span className="stage-grand-label">{t("stage.area")}</span>
              <strong className="stage-grand-value">
                {fmt(calc.areaM2, 2)}{" "}
                <span className="stage-grand-unit">m²</span>
              </strong>
              <span className="stage-grand-sub">
                {hasDims
                  ? `${fmt(subWidth, 1)} × ${fmt(subDepth, 1)} m`
                  : t("stage.noDecksPlaced")}
              </span>
            </div>
            <div className="stage-grand-stat">
              <span className="stage-grand-label">{t("stage.totalWeight")}</span>
              <strong className="stage-grand-value">
                {fmt(calc.totalWeight, 1)}{" "}
                <span className="stage-grand-unit">kg</span>
              </strong>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
