import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ehsLogo from "../assets/ehs-logo.png";
import { useT } from "../lib/i18n/I18nContext";
import type { TranslationKey } from "../lib/i18n/types";
import { NumberField } from "./NumberField";
import { LedSystemDesigner } from "./LedSystemDesigner";
import type { LedSystem } from "../lib/ledSystem";
import {
  CUSTOM_PANEL_KEY,
  LED_PANEL_COLOR_PRESETS,
  LED_SCREEN_COLORS,
  NAME_SCALE_DEFAULT,
  NAME_SCALE_MAX,
  NAME_SCALE_MIN,
  PILL_CHAR_W_RATIO,
  PILL_PAD_X_RATIO,
  PILL_PAD_Y_RATIO,
  clampNameScale,
  type LedPanel,
  type LedPanelKey,
  type LedPanelPattern,
  type LedScreen,
  type LedScreenMarker,
  type LedSettings,
  type LedTotals,
  type LedCustomPanel,
  colLabel,
  computeScreenMetrics,
  panelCellColor,
  cellArrowDirection,
  type CellArrowDir,
  resolveScreenPanel,
  outputsForScreen,
  newMarkerId,
  nextMarkerIndex,
  // Shape / cable / processor — new in this build
  cellIndex,
  disabledCellSet,
  lastRowHeightFraction,
  resolveFinishingPanel,
  hasFinishingRow,
  enabledLastRowCount,
  isCellDisabled,
  enabledPanelCount,
  computeShapeTemplate,
  computeScreenCableBOM,
  computeScreenProcessorCapacity,
  newPanelMarkerId,
  nextPanelMarkerIndex,
  LED_SHAPE_TEMPLATE_OPTIONS,
  NOVASTAR_PROCESSOR_CATALOG,
  NOVASTAR_PROCESSOR_OPTIONS,
  newProcessorId,
  SIGNAL_CABLE_LENGTH_M,
  POWER_TRUE1_CABLE_LENGTH_M,
  type LedShapeTemplate,
  type LedPanelMarker,
  type LedScreenProcessor,
  type ScreenProcessorCapacity,
  type NovastarProcessorModel,
  type LedPortChain,
  type LedPortMap,
  rowLabel,
} from "../lib/led";
import {
  LED_PROCESSORS,
  findProcessor,
  validateAgainstProcessor,
  type ProcessorCheckResult,
} from "../lib/ledProcessors";
import { runValidation } from "../lib/led/validation/runValidation";
import {
  AVERAGE_POWER_FRACTION,
  type PowerEstimate,
} from "../lib/led/engine/power";
import {
  buildPatchSheetCsv,
  buildCabinetIdCsv,
  downloadCsv,
} from "../lib/led/export/patchSheet";
import { LedModeToggle } from "./led/ModeToggle";
import {
  RigAccessoriesPanel,
  type LedRigAccessoryCatalogItem,
} from "./led/RigAccessoriesPanel";
import { AdvancedScreenInspector } from "./led/AdvancedScreenInspector";
import { ValidationDrawer } from "./led/ValidationDrawer";
import {
  PaintToolbar,
  newPortId,
  nextLabel,
  nextColor,
  type PaintMode,
} from "./led/PaintToolbar";

type Props = {
  screens: LedScreen[];
  panels: LedPanel[];
  settings: LedSettings;
  totals: LedTotals;
  linkedCount: number;
  standaloneCount: number;
  /** Currently-selected screen id, or null for "no selection". Drives
   *  the highlight ring on the canvas and the row highlight in the
   *  table; also lets the producer click a screen on the visual to jump
   *  to its row. */
  selectedScreenId: string | null;
  onSelectScreen: (id: string | null) => void;
  onAddScreen: () => void;
  onUpdateScreen: (id: string, patch: Partial<LedScreen>) => void;
  onUpdateCustomPanel: (id: string, patch: Partial<LedCustomPanel>) => void;
  onRemoveScreen: (id: string) => void;
  onDuplicateScreen: (id: string) => void;
  onUpdateSettings: (patch: Partial<LedSettings>) => void;
  onExportScreen: (id: string) => void | Promise<void>;
  /** Clear every per-screen `posX`/`posY` so the canvas reverts to the
   *  default left-to-right auto-flow layout. */
  onResetScreenPositions: () => void;
  onJumpToRigging: () => void;
  /** LED System Designer — node-based architecture editor rendered
   *  below the existing LED report sections. Lifted into App.tsx so
   *  it persists alongside the rest of PersistedV2. */
  ledSystem: LedSystem;
  onLedSystemChange: (next: LedSystem) => void;
  /** Inventory items in the "LED Screen" category that have NO pixel
   *  metadata — i.e. rigging beams. Passed in from App.tsx so this
   *  view stays decoupled from the inventory shape. Empty / undefined
   *  hides the Rig Accessories panel even in advanced mode. */
  beamsCatalog?: LedRigAccessoryCatalogItem[];
};

const PIXEL_FMT = new Intl.NumberFormat("en-US");

/** Reduce a pixel WxH to a human-readable aspect ratio.
 *  - Exact small ratios (16:9, 4:3, 21:9, 1:1, 9:16…) come out as "16:9".
 *  - Anything that doesn't reduce to single/double digits falls back to
 *    decimal form ("1.78:1") so producers still see a sensible number
 *    on irregular L-shapes / ribbons. */
function formatAspectRatio(w: number, h: number): string {
  if (!w || !h || w <= 0 || h <= 0) return "—";
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(w, h);
  const rw = w / g;
  const rh = h / g;
  if (rw <= 99 && rh <= 99) return `${rw}:${rh}`;
  return `${(w / h).toFixed(2)}:1`;
}
const fmt = (n: number, d = 1) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d });

/** Which screen the user is currently in cell-edit mode on, and what
 *  the click action should be. `null` = passive (clicks select).
 *  Hoisted to the report root so arming a mode on row 1 cancels a
 *  stale mode on row 3, and so the canvas can read it to switch its
 *  cursor.
 *
 *  - `power` / `signal` → click on a CELL drops an anchored
 *    `LedPanelMarker` on that (col, row).
 *  - `shape`            → click on a CELL toggles its index in
 *    `disabledCells` (freeform shape edit).
 *
 *  The legacy free-coord `LedScreenMarker` rendering still works
 *  (drag/delete remain functional) but new clicks now produce the
 *  cell-anchored markers the user actually wants. */
export type PlaceModeKind = "power" | "signal" | "shape";
export type PlaceMode = {
  screenId: string;
  kind: PlaceModeKind;
} | null;

export function LedScreenReportView(props: Props) {
  const t = useT();
  const {
    screens,
    panels,
    settings,
    totals,
    linkedCount,
    standaloneCount,
    selectedScreenId,
    onSelectScreen,
    onAddScreen,
    onUpdateScreen,
    onUpdateCustomPanel,
    onRemoveScreen,
    onDuplicateScreen,
    onUpdateSettings,
    onExportScreen,
    onResetScreenPositions,
    onJumpToRigging,
    ledSystem,
    onLedSystemChange,
    beamsCatalog = [],
  } = props;

  // ── Touring-grade validation (Phase 0-3) ─────────────────────────
  // Runs every render. The engine is pure + memoised internally over
  // its inputs; the cost is O(screens + cables) so we recompute
  // unconditionally rather than cache here.
  const validation = useMemo(
    () => runValidation(screens, panels, settings),
    [screens, panels, settings],
  );
  const advancedMode = settings.uiMode === "advanced";
  const [validationOpen, setValidationOpen] = useState(false);
  const exportPatchSheet = useCallback(() => {
    if (screens.length === 0) return;
    downloadCsv("led-patch-sheet.csv", buildPatchSheetCsv(screens));
  }, [screens]);
  const exportCabinetIds = useCallback(() => {
    if (screens.length === 0) return;
    downloadCsv("led-cabinet-ids.csv", buildCabinetIdCsv(screens));
  }, [screens]);

  /** Pixel-resolved lookup so the System Designer can show real pixel
   *  totals for screen-kind nodes that link to a `LedScreen` by id.
   *  Recomputed when screens or panels change so adjusting a panel
   *  count flows through to the system metrics live. */
  const screenPixelsById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of screens) {
      const metrics = computeScreenMetrics(s, panels);
      m.set(s.id, metrics.pixels);
    }
    return m;
  }, [screens, panels]);

  /** Whether any standalone screen has been manually positioned — drives
   *  the "Reset positions" button's enabled state above the canvas. */
  const anyPositioned = useMemo(
    () => screens.some((s) => s.posX !== undefined || s.posY !== undefined),
    [screens],
  );

  const [placeMode, setPlaceMode] = useState<PlaceMode>(null);

  // ── Paint mode (Power / Signal map painter on the pixel-map canvas) ──
  //
  // Lives at the report-view level so the toolbar (rendered inside the
  // pixel-map canvas) and the per-screen ScreenSvg overlay agree on a
  // single mode + active port. Painting is bound to `selectedScreenId`:
  // the overlay shows for every screen, but clicks only paint the
  // currently selected one (mirrors how the rest of the LED tab acts
  // on the selection).
  const [paintMode, setPaintMode] = useState<PaintMode>("off");
  const [activePortId, setActivePortId] = useState<string | null>(null);
  const paintScreen = useMemo(
    () => screens.find((s) => s.id === selectedScreenId) ?? null,
    [screens, selectedScreenId],
  );
  const paintMap: LedPortMap | undefined =
    paintScreen && paintMode !== "off"
      ? paintMode === "power"
        ? paintScreen.powerMap
        : paintScreen.signalMap
      : undefined;
  const setPaintMap = useCallback(
    (next: LedPortMap | undefined) => {
      if (!paintScreen || paintMode === "off") return;
      if (paintMode === "power") {
        onUpdateScreen(paintScreen.id, { powerMap: next });
      } else {
        onUpdateScreen(paintScreen.id, { signalMap: next });
      }
    },
    [paintScreen, paintMode, onUpdateScreen],
  );
  /** Click a panel cell in paint mode: toggle off if already in the
   *  active port; otherwise append to the active port (and remove from
   *  any other port that owned it — a cell belongs to at most one port
   *  per map). No-op if no port is active or this isn't the painted
   *  screen. */
  const onPaintCell = useCallback(
    (screenId: string, col: number, row: number) => {
      if (!paintScreen || paintScreen.id !== screenId || paintMode === "off") {
        return;
      }
      // Don't allow painting onto void cabinets — a chain referencing
      // a disabled cell would inflate the cable count and render a
      // visually broken overlay on shaped (non-rectangular) screens.
      if (
        isCellDisabled(
          disabledCellSet(paintScreen),
          col,
          row,
          paintScreen.panelsWide,
        )
      ) {
        return;
      }
      const map =
        paintMode === "power" ? paintScreen.powerMap : paintScreen.signalMap;
      const ports = map?.ports ?? [];
      const cellIdx = row * paintScreen.panelsWide + col;
      const active = activePortId
        ? ports.find((p) => p.id === activePortId)
        : undefined;
      // No active port yet → seed a fresh chain with this cell so the
      // producer can just click the first panel without first pressing
      // "+ Add" in the toolbar.
      if (!active) {
        const port: LedPortChain = {
          id: newPortId(),
          label: nextLabel(ports),
          color: nextColor(paintMode, ports),
          cells: [cellIdx],
        };
        const seeded = ports.map((p) =>
          p.cells.includes(cellIdx)
            ? { ...p, cells: p.cells.filter((c) => c !== cellIdx) }
            : p,
        );
        setActivePortId(port.id);
        setPaintMap({ ports: [...seeded, port] });
        return;
      }
      let nextPorts: LedPortChain[];
      if (active.cells.includes(cellIdx)) {
        nextPorts = ports.map((p) =>
          p.id === active.id
            ? { ...p, cells: p.cells.filter((c) => c !== cellIdx) }
            : p,
        );
      } else {
        nextPorts = ports.map((p) => {
          if (p.id === active.id) {
            return { ...p, cells: [...p.cells, cellIdx] };
          }
          if (p.cells.includes(cellIdx)) {
            return { ...p, cells: p.cells.filter((c) => c !== cellIdx) };
          }
          return p;
        });
      }
      setPaintMap(nextPorts.length === 0 ? undefined : { ports: nextPorts });
    },
    [paintScreen, paintMode, activePortId, setPaintMap, setActivePortId],
  );

  // ── Drag-to-draw ─────────────────────────────────────────────────
  // Press a panel and drag to auto-link a whole chain that follows the
  // cursor. Each drag starts a NEW chain at the press point and appends
  // every cell the cursor passes over, capped at the per-mode max
  // (power 9, signal 18 — overridable per screen via
  // maxCabinetsPerPowerChain / maxCabinetsPerDataChain).
  //
  // `paintDragRef` is the single source of truth for the in-progress
  // chain: it snapshots the *other* ports at drag start (`basePorts`)
  // plus the growing `cells` list. Each move recomposes the full port
  // set deterministically from those two — never from React state —
  // so back-to-back start+move writes in the same tick can't clobber
  // each other (the stale-snapshot bug that would otherwise drop the
  // freshly created chain on the first move).
  const paintDragRef = useRef<{
    port: { id: string; label: string; color: string };
    cells: number[];
    basePorts: LedPortChain[];
  } | null>(null);
  const onPaintDrag = useCallback(
    (
      screenId: string,
      col: number,
      row: number,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "end") {
        paintDragRef.current = null;
        return;
      }
      if (!paintScreen || paintScreen.id !== screenId || paintMode === "off") {
        return;
      }
      if (
        isCellDisabled(
          disabledCellSet(paintScreen),
          col,
          row,
          paintScreen.panelsWide,
        )
      ) {
        return;
      }
      const cellIdx = row * paintScreen.panelsWide + col;
      const cap =
        paintMode === "power"
          ? paintScreen.maxCabinetsPerPowerChain &&
            paintScreen.maxCabinetsPerPowerChain > 0
            ? paintScreen.maxCabinetsPerPowerChain
            : 9
          : paintScreen.maxCabinetsPerDataChain &&
              paintScreen.maxCabinetsPerDataChain > 0
            ? paintScreen.maxCabinetsPerDataChain
            : 18;
      // Rebuild the whole port set from the drag snapshot: strip the
      // chain's cells from every other port (a cell belongs to at most
      // one port per map), then append the drag port itself.
      const compose = (drag: NonNullable<typeof paintDragRef.current>) => {
        const owned = new Set(drag.cells);
        const stripped = drag.basePorts.map((p) => ({
          ...p,
          cells: p.cells.filter((c) => !owned.has(c)),
        }));
        return [
          ...stripped,
          {
            id: drag.port.id,
            label: drag.port.label,
            color: drag.port.color,
            cells: drag.cells,
          },
        ];
      };
      if (phase === "start") {
        const map =
          paintMode === "power" ? paintScreen.powerMap : paintScreen.signalMap;
        const ports = map?.ports ?? [];
        const drag = {
          port: {
            id: newPortId(),
            label: nextLabel(ports),
            color: nextColor(paintMode, ports),
          },
          cells: [cellIdx],
          basePorts: ports,
        };
        paintDragRef.current = drag;
        setActivePortId(drag.port.id);
        setPaintMap({ ports: compose(drag) });
        return;
      }
      // phase === "move" — extend the in-progress chain.
      const drag = paintDragRef.current;
      if (!drag) return;
      if (drag.cells[drag.cells.length - 1] === cellIdx) return;
      if (drag.cells.includes(cellIdx)) return;
      if (drag.cells.length >= cap) return;
      drag.cells = [...drag.cells, cellIdx];
      setPaintMap({ ports: compose(drag) });
    },
    [paintScreen, paintMode, setPaintMap, setActivePortId],
  );
  // When the selected screen changes (or paint mode flips off), reset
  // the active port — the new screen has its own port set.
  useEffect(() => {
    setActivePortId(null);
  }, [selectedScreenId, paintMode]);

  /** Toggle the click-mode for a screen: `+P`, `+S`, or "Shape" arm
   *  cell-edit mode; clicking the same button twice (or arming a
   *  different button) cancels / replaces. Also called automatically
   *  whenever the user clicks the screen body so there's no orphaned
   *  armed state left after dropping a marker. */
  const togglePlaceMode = useCallback(
    (screenId: string, kind: PlaceModeKind) => {
      setPlaceMode((prev) =>
        prev && prev.screenId === screenId && prev.kind === kind
          ? null
          : { screenId, kind },
      );
    },
    [],
  );

  /** Drop a new cell-anchored marker on the (col, row) the producer
   *  clicked. Replaces any existing marker on the same cell+kind so
   *  re-clicking a cell re-uses the index instead of stacking. We do
   *  NOT auto-clear placeMode — the producer can rapid-fire several
   *  cells in a row without re-arming. */
  const addPanelMarker = useCallback(
    (
      screenId: string,
      kind: LedPanelMarker["kind"],
      col: number,
      row: number,
    ) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      const list = screen.panelMarkers ?? [];
      // Replace if there's already a same-kind marker on this cell
      // (toggle-style; second click on same cell = remove).
      const existing = list.find(
        (mk) => mk.kind === kind && mk.col === col && mk.row === row,
      );
      if (existing) {
        onUpdateScreen(screenId, {
          panelMarkers: list.filter((mk) => mk.id !== existing.id),
        });
        return;
      }
      const next: LedPanelMarker = {
        id: newPanelMarkerId(),
        kind,
        index: nextPanelMarkerIndex(list, kind),
        col,
        row,
      };
      onUpdateScreen(screenId, { panelMarkers: [...list, next] });
    },
    [screens, onUpdateScreen],
  );

  const removePanelMarker = useCallback(
    (screenId: string, markerId: string) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      const next = (screen.panelMarkers ?? []).filter(
        (m) => m.id !== markerId,
      );
      onUpdateScreen(screenId, { panelMarkers: next });
    },
    [screens, onUpdateScreen],
  );

  /** Toggle a single cell's ON/OFF state (freeform shape edit). When
   *  Shape mode is armed and the producer clicks a cell, we flip its
   *  index in `disabledCells`. */
  const toggleCell = useCallback(
    (screenId: string, col: number, row: number) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      const idx = cellIndex(col, row, screen.panelsWide);
      const current = screen.disabledCells ?? [];
      const set = new Set(current);
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      onUpdateScreen(screenId, {
        disabledCells: Array.from(set).sort((a, b) => a - b),
        // Hand-toggling a cell diverges from any preset template, so
        // we clear the saved template name; the brief falls back to
        // the generic "Custom shape" label as expected.
        shapeTemplate: undefined,
      });
    },
    [screens, onUpdateScreen],
  );

  /** Apply a preset shape template (L, U, T, +, stairs, ribbon,
   *  columns, rectangle). Overwrites any current `disabledCells` so
   *  the producer gets a clean shape every time. */
  const applyShapeTemplate = useCallback(
    (screenId: string, template: LedShapeTemplate) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      onUpdateScreen(screenId, {
        disabledCells: computeShapeTemplate(
          template,
          screen.panelsWide,
          screen.panelsTall,
        ),
        // Remember the producer's template choice so the brief can
        // label it (e.g. "L-shape" instead of generic "Custom shape").
        // Direct cell toggles below clear this back to undefined.
        shapeTemplate: template === "rectangle" ? undefined : template,
      });
    },
    [screens, onUpdateScreen],
  );

  /** Build by physical dimensions: round target W/H to whole panels.
   *  Optionally clears `disabledCells` at the same time so a re-build
   *  doesn't leave a stale L-shape lying around at the wrong size. */
  const applyBuildBySize = useCallback(
    (
      screenId: string,
      targetWidthM: number,
      targetHeightM: number,
      clearShape: boolean,
    ) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      const panel = resolveScreenPanel(screen, panels);
      if (panel.physicalWidth <= 0 || panel.physicalHeight <= 0) return;
      const panelsWide = Math.max(
        1,
        Math.round(targetWidthM / panel.physicalWidth),
      );
      // Fit the height with whole MAIN rows, then finish any leftover gap
      // with a real, smaller inventory panel (same physical width so its
      // columns line up with the body) whose height closely matches the
      // remainder. E.g. 4.5 m from 1.0 m cabinets = 4 full rows + one
      // 0.5 m finishing row of a 0.5 m panel. When no inventory panel
      // matches the leftover closely, fall back to rounding to a whole
      // main panel so the height is at least sensible.
      const mainH = panel.physicalHeight;
      const fullRows = Math.max(0, Math.floor(targetHeightM / mainH + 1e-6));
      const remainder = targetHeightM - fullRows * mainH;
      const EPS = 0.02;
      let finishingPanelKey: LedPanelKey | undefined;
      let panelsTall: number;
      if (remainder > EPS) {
        let best: LedPanel | null = null;
        let bestErr = Infinity;
        for (const p of panels) {
          if (p.key === CUSTOM_PANEL_KEY) continue;
          if (Math.abs(p.physicalWidth - panel.physicalWidth) > EPS) continue;
          if (!(p.physicalHeight > 0) || p.physicalHeight >= mainH - EPS) continue;
          const err = Math.abs(p.physicalHeight - remainder);
          if (err < bestErr) {
            best = p;
            bestErr = err;
          }
        }
        if (best && bestErr <= 0.05) {
          finishingPanelKey = best.key;
          panelsTall = fullRows + 1;
        } else {
          panelsTall = Math.max(1, Math.round(targetHeightM / mainH));
        }
      } else {
        panelsTall = Math.max(1, fullRows);
      }
      onUpdateScreen(screenId, {
        panelsWide,
        panelsTall,
        finishingPanelKey,
        // Clear the legacy half-row flag — superseded by finishingPanelKey.
        lastRowHalf: false,
        ...(clearShape ? { disabledCells: [] } : {}),
      });
    },
    [screens, panels, onUpdateScreen],
  );

  const addProcessor = useCallback(
    (screenId: string, model: NovastarProcessorModel) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      const list = screen.processors ?? [];
      const next: LedScreenProcessor = { id: newProcessorId(), model };
      onUpdateScreen(screenId, { processors: [...list, next] });
    },
    [screens, onUpdateScreen],
  );

  const removeProcessor = useCallback(
    (screenId: string, processorId: string) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      onUpdateScreen(screenId, {
        processors: (screen.processors ?? []).filter(
          (p) => p.id !== processorId,
        ),
      });
    },
    [screens, onUpdateScreen],
  );

  /** Drag-move the LEGACY free-coord markers (LedScreenMarker). Panel
   *  markers are anchored to a cell so they aren't draggable. */
  const moveMarker = useCallback(
    (screenId: string, markerId: string, x: number, y: number) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      const next = (screen.markers ?? []).map((m) =>
        m.id === markerId
          ? { ...m, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }
          : m,
      );
      onUpdateScreen(screenId, { markers: next });
    },
    [screens, onUpdateScreen],
  );

  /** Remove a LEGACY free-coord marker (alt-click / right-click). */
  const removeMarker = useCallback(
    (screenId: string, markerId: string) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      const next = (screen.markers ?? []).filter((m) => m.id !== markerId);
      onUpdateScreen(screenId, { markers: next });
    },
    [screens, onUpdateScreen],
  );

  /** Wipe both legacy free-coord markers AND new cell-anchored panel
   *  markers in one go. The Clear button counts both kinds so the
   *  producer can't be left wondering "why is there still a P1?" after
   *  a clean. */
  const clearMarkers = useCallback(
    (screenId: string) => {
      const screen = screens.find((s) => s.id === screenId);
      if (!screen) return;
      const total =
        (screen.markers ?? []).length + (screen.panelMarkers ?? []).length;
      if (total === 0) return;
      if (
        !window.confirm(
          t("led.report.confirm.clearMarkers", {
            name: screen.name || t("led.report.unnamed"),
          }),
        )
      ) {
        return;
      }
      onUpdateScreen(screenId, { markers: [], panelMarkers: [] });
    },
    [screens, onUpdateScreen, t],
  );

  return (
    <div className="led-report">
      <header className="led-report-header">
        <div>
          <h2>{t("led.report.title")}</h2>
          <p className="led-report-sub">
            {t("led.report.subtitle")}
          </p>
        </div>
        <div className="led-report-meta">
          <span className="badge">
            {t("led.report.linkSummary", {
              linked: linkedCount,
              manual: standaloneCount,
            })}
          </span>
          <button className="btn btn-soft" onClick={onJumpToRigging}>
            ↗ {t("led.report.riggingReport")}
          </button>
        </div>
      </header>

      <LedDashboard totals={totals} settings={settings} />

      {/* Touring-grade controls strip — Basic/Advanced toggle plus
          a validation button that surfaces the count of open issues
          across every screen + the System Designer. */}
      <div className="led-touring-strip">
        <div className="led-touring-strip-left">
          <span className="led-touring-strip-label">{t("led.report.mode")}</span>
          <LedModeToggle
            mode={settings.uiMode}
            onChange={(next) => {
              onUpdateSettings({ uiMode: next });
              // When switching INTO advanced mode, also flip the
              // canvas into the Power paint toolbar so producers
              // see the cabling controls without an extra click.
              // Going back to basic disarms paint mode so the
              // canvas returns to the plain pixel-map view.
              if (next === "advanced") {
                if (paintMode === "off") setPaintMode("power");
              } else {
                setPaintMode("off");
              }
            }}
          />
        </div>
        <div className="led-touring-strip-right">
          <button
            type="button"
            className={`btn btn-sm ${
              validation.errors > 0
                ? "btn-danger"
                : validation.warnings > 0
                  ? "btn-soft"
                  : "btn-soft"
            }`}
            onClick={() => setValidationOpen((v) => !v)}
            title={t("led.report.validation.open")}
          >
            ⚠ {t("led.report.validation.label")}
            {validation.errors > 0 && (
              <span className="led-touring-pill led-touring-pill-error">
                {validation.errors}
              </span>
            )}
            {validation.warnings > 0 && (
              <span className="led-touring-pill led-touring-pill-warn">
                {validation.warnings}
              </span>
            )}
            {validation.errors === 0 && validation.warnings === 0 && (
              <span className="led-touring-pill led-touring-pill-ok">
                {t("led.report.status.ok")}
              </span>
            )}
          </button>
          {advancedMode && (
            <>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={exportPatchSheet}
                disabled={screens.length === 0}
                title={t("led.report.export.patchSheetTitle")}
              >
                ↓ {t("led.report.export.patchSheet")}
              </button>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={exportCabinetIds}
                disabled={screens.length === 0}
                title={t("led.report.export.cabinetIdsTitle")}
              >
                ↓ {t("led.report.export.cabinetIds")}
              </button>
            </>
          )}
        </div>
      </div>

      <ProcessorBanner
        totals={totals}
        settings={settings}
        screens={screens}
        panels={panels}
      />

      <ExportOptions
        settings={settings}
        onUpdateSettings={onUpdateSettings}
      />

      <section className="led-card">
        <div className="led-card-head">
          <h3>{t("led.report.screens")}</h3>
          <div className="led-controls">
            <button className="btn btn-primary" onClick={onAddScreen}>
              + {t("led.report.addScreen")}
            </button>
          </div>
        </div>

        {screens.length === 0 ? (
          <div className="led-empty">
            {t("led.report.emptyScreens")}
          </div>
        ) : (
          <div className="led-table-wrap">
            <table className="led-table">
              <thead>
                <tr>
                  <th>{t("led.report.table.source")}</th>
                  <th>{t("led.report.table.name")}</th>
                  <th>{t("led.report.table.panel")}</th>
                  <th>{t("led.report.table.wide")}</th>
                  <th>{t("led.report.table.tall")}</th>
                  <th>{t("led.report.table.shape")}</th>
                  <th>{t("led.report.table.resolution")}</th>
                  <th>{t("led.report.table.size")}</th>
                  <th>{t("led.report.table.output")}</th>
                  <th>{t("led.report.table.color")}</th>
                  <th>{t("led.report.table.notes")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {screens.map((s) => (
                  <ScreenRow
                    key={s.id}
                    screen={s}
                    panels={panels}
                    placeMode={placeMode}
                    isSelected={selectedScreenId === s.id}
                    onSelect={() => onSelectScreen(s.id)}
                    onUpdate={(patch) => onUpdateScreen(s.id, patch)}
                    onUpdateCustomPanel={(patch) =>
                      onUpdateCustomPanel(s.id, patch)
                    }
                    onRemove={() => onRemoveScreen(s.id)}
                    onDuplicate={() => onDuplicateScreen(s.id)}
                    onExport={() => onExportScreen(s.id)}
                    onTogglePlaceMode={(kind) => togglePlaceMode(s.id, kind)}
                    onClearMarkers={() => clearMarkers(s.id)}
                    onApplyShapeTemplate={(t) => applyShapeTemplate(s.id, t)}
                    onApplyBuildBySize={(w, h, clear) =>
                      applyBuildBySize(s.id, w, h, clear)
                    }
                    onAddProcessor={(model) => addProcessor(s.id, model)}
                    onRemoveProcessor={(pid) => removeProcessor(s.id, pid)}
                    advancedMode={advancedMode}
                    beamsCatalog={beamsCatalog}
                    power={validation.powerByScreen.get(s.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {screens.length > 0 && (
        <section className="led-card">
          <div className="led-card-head">
            <h3>{t("led.report.pixelMap")}</h3>
            <span className="led-hint">
              {t("led.report.pixelMapHint")}
            </span>
            <div className="led-controls">
              {/* "Reset positions" returns the canvas to the default
                  left-to-right auto-flow. Disabled when nothing has been
                  dragged so the button doesn't feel like a noop. */}
              <button
                className="btn btn-soft btn-sm"
                type="button"
                onClick={onResetScreenPositions}
                disabled={!anyPositioned}
                title={
                  anyPositioned
                    ? t("led.report.resetPositionsTitle")
                    : t("led.report.resetPositionsDisabled")
                }
              >
                {t("led.report.resetPositions")}
              </button>
            </div>
          </div>
          <PixelMapCanvas
            advancedMode={advancedMode}
            screens={screens}
            panels={panels}
            settings={settings}
            placeMode={placeMode}
            selectedScreenId={selectedScreenId}
            onSelectScreen={onSelectScreen}
            onUpdateScreen={onUpdateScreen}
            onMoveMarker={moveMarker}
            onRemoveMarker={removeMarker}
            onAddPanelMarker={addPanelMarker}
            onRemovePanelMarker={removePanelMarker}
            onToggleCell={toggleCell}
            paintMode={paintMode}
            onPaintModeChange={setPaintMode}
            paintScreen={paintScreen}
            paintMap={paintMap}
            onPaintMapChange={setPaintMap}
            activePortId={activePortId}
            onActivePortChange={setActivePortId}
            onPaintCell={onPaintCell}
            onPaintDrag={onPaintDrag}
            onUpdateSettings={onUpdateSettings}
          />
        </section>
      )}

      {screens.length > 0 && (
        <CableBracketBomCard
          screens={screens}
          panels={panels}
          beamCatalog={beamsCatalog}
        />
      )}

      {screens.length > 0 && (
        <PowerBalancerCard
          screens={screens}
          panels={panels}
          mainsVoltage={settings.mainsVoltage}
          onMainsVoltageChange={(v) => onUpdateSettings({ mainsVoltage: v })}
        />
      )}

      {/* System Designer — node-based architecture editor. Gated behind
          Advanced mode so the Basic view stays focused on the per-screen
          table + canvas; producers who need cable / processor / fiber
          planning enable Advanced to reveal it. */}
      {advancedMode && (
        <section className="led-card">
          <div className="led-card-head">
            <h3>{t("led.report.system")}</h3>
            <span className="led-hint">
              {t("led.report.systemHint")}
            </span>
          </div>
          <LedSystemDesigner
            system={ledSystem}
            onChange={onLedSystemChange}
            screens={screens}
            screenPixelsById={screenPixelsById}
          />
        </section>
      )}

      <ValidationDrawer
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        violations={validation.violations}
        onJumpToScreen={(id) => {
          onSelectScreen(id);
          setValidationOpen(false);
          // Scroll the table row into view if present.
          const el = document.querySelector(
            `[data-led-screen-row="${id}"]`,
          );
          if (el && "scrollIntoView" in el) {
            (el as HTMLElement).scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }
        }}
      />
    </div>
  );
}

function ProcessorBanner({
  totals,
  settings,
  screens,
  panels,
}: {
  totals: LedTotals;
  settings: LedSettings;
  screens: LedScreen[];
  panels: LedPanel[];
}) {
  const t = useT();
  const processorBlurbKeys: Record<string, TranslationKey> = {
    "novastar-mx30": "led.report.processor.blurb.mx30",
    "novastar-mx40": "led.report.processor.blurb.mx40",
  };
  const proc = findProcessor(settings.processorId);
  if (!proc) return null;
  if (totals.screens === 0) return null;

  // Recompute outputs at the PROCESSOR's per-port limit (e.g. 650 000
  // pixels for the Novastar MX series), so the comparison stays honest
  // even when the user's `portLimit` field is set to something else.
  const outputsAtProcLimit = screens.reduce(
    (sum, s) =>
      sum + outputsForScreen(s, settings, panels, proc.maxPixelsPerOutput),
    0,
  );

  const result: ProcessorCheckResult = validateAgainstProcessor(proc, {
    totalPixels: totals.pixels,
    outputsNeeded: outputsAtProcLimit,
    largestWidthPx: totals.largestWidthPx,
    largestHeightPx: totals.largestHeightPx,
    largestScreenPixels: totals.largestScreenPixels,
  });

  const utilizationPct = Math.min(999, Math.round(result.utilization * 100));
  const outputsPct = Math.min(999, Math.round(result.outputsUtilization * 100));
  const localizedIssues: string[] = [];
  if (totals.pixels > proc.totalPixels) {
    localizedIssues.push(t("led.report.processor.issue.totalPixels", {
      used: PIXEL_FMT.format(totals.pixels),
      name: proc.name,
      capacity: PIXEL_FMT.format(proc.totalPixels),
    }));
  } else if (result.utilization > 0.9) {
    localizedIssues.push(t("led.report.processor.issue.pixelHeadroom", {
      percent: Math.round(result.utilization * 100),
      name: proc.name,
    }));
  }
  if (outputsAtProcLimit > proc.outputs) {
    localizedIssues.push(t("led.report.processor.issue.outputs", {
      needed: outputsAtProcLimit,
      name: proc.name,
      available: proc.outputs,
    }));
  } else if (result.outputsUtilization > 0.9) {
    localizedIssues.push(t("led.report.processor.issue.outputHeadroom", {
      used: outputsAtProcLimit,
      available: proc.outputs,
      name: proc.name,
      percent: Math.round(result.outputsUtilization * 100),
    }));
  }
  if (totals.largestScreenPixels > proc.maxPixelsPerOutput) {
    localizedIssues.push(t("led.report.processor.issue.perOutput", {
      pixels: PIXEL_FMT.format(totals.largestScreenPixels),
      name: proc.name,
      limit: PIXEL_FMT.format(proc.maxPixelsPerOutput),
    }));
  }
  if (totals.largestWidthPx > proc.maxWidthPx) {
    localizedIssues.push(t("led.report.processor.issue.width", {
      pixels: PIXEL_FMT.format(totals.largestWidthPx),
      name: proc.name,
      limit: PIXEL_FMT.format(proc.maxWidthPx),
    }));
  }
  if (totals.largestHeightPx > proc.maxHeightPx) {
    localizedIssues.push(t("led.report.processor.issue.height", {
      pixels: PIXEL_FMT.format(totals.largestHeightPx),
      name: proc.name,
      limit: PIXEL_FMT.format(proc.maxHeightPx),
    }));
  }

  return (
    <section
      className={`led-proc-banner is-${result.level}`}
      aria-live="polite"
    >
      <div className="led-proc-head">
        <div className="led-proc-title">
          <span className="led-proc-dot" aria-hidden />
          <span>
            <strong>{proc.name}</strong>
            <span className="led-proc-blurb">
              {" "}— {processorBlurbKeys[proc.id] ? t(processorBlurbKeys[proc.id]) : proc.blurb}
            </span>
          </span>
        </div>
        <div className="led-proc-status">
          {t(`led.report.processor.status.${result.level}` as TranslationKey)}
        </div>
      </div>
      <div className="led-proc-meters">
        <Meter
          label={t("led.report.processor.pixels")}
          used={result.totalPixels}
          cap={proc.totalPixels}
          pct={utilizationPct}
          fmt={(n) => PIXEL_FMT.format(n)}
        />
        <Meter
          label={t("led.report.processor.outputs")}
          used={result.outputsNeeded}
          cap={proc.outputs}
          pct={outputsPct}
          fmt={(n) => `${n}`}
        />
        <div className="led-proc-bound">
          <div className="led-proc-bound-label">
            {t("led.report.processor.largestScreen")}
          </div>
          <div className="led-proc-bound-value">
            {totals.largestWidthPx.toLocaleString()} ×{" "}
            {totals.largestHeightPx.toLocaleString()} px
          </div>
          <div className="led-proc-bound-sub">
            {t("led.report.processor.maxCanvas")}: {proc.maxWidthPx.toLocaleString()} ×{" "}
            {proc.maxHeightPx.toLocaleString()} px
          </div>
        </div>
      </div>
      {localizedIssues.length > 0 && (
        <ul className="led-proc-issues">
          {localizedIssues.map((message, i) => (
            <li key={i} className={`led-proc-issue is-${result.issues[i]?.level ?? "warn"}`}>
              {message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Meter({
  label,
  used,
  cap,
  pct,
  fmt,
}: {
  label: string;
  used: number;
  cap: number;
  pct: number;
  fmt: (n: number) => string;
}) {
  const overcap = used > cap;
  return (
    <div className="led-proc-meter">
      <div className="led-proc-meter-row">
        <span className="led-proc-meter-label">{label}</span>
        <span className="led-proc-meter-value">
          {fmt(used)} / {fmt(cap)} ({pct}%)
        </span>
      </div>
      <div className="led-proc-meter-track">
        <div
          className={`led-proc-meter-fill ${overcap ? "is-over" : pct > 90 ? "is-warn" : "is-ok"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function LedDashboard({
  totals,
  settings,
}: {
  totals: LedTotals;
  settings: LedSettings;
}) {
  const t = useT();
  return (
    <div className="led-dashboard">
      <Stat label={t("led.report.screens")} value={fmt(totals.screens, 0)} />
      <Stat label={t("led.report.panels")} value={fmt(totals.panels, 0)} />
      <Stat label={t("led.report.totalPixels")} value={PIXEL_FMT.format(totals.pixels)} />
      <Stat label={t("led.report.area")} value={`${fmt(totals.areaM2, 1)} m²`} />
      <Stat label={t("led.report.weight")} value={`${fmt(totals.weightKg, 1)} kg`} />
      <Stat label={t("led.report.maxOutput")} value={`${fmt(totals.powerW / 1000, 2)} kW`} />
      <Stat
        label={t("led.report.avgOutput")}
        value={`${fmt((totals.powerW * AVERAGE_POWER_FRACTION) / 1000, 2)} kW`}
      />
      <Stat
        label={t("led.report.outputsNeeded")}
        value={fmt(totals.portsNeeded, 0)}
        sub={t("led.report.pixelsPerOutputSummary", {
          pixels: PIXEL_FMT.format(settings.portLimit),
        })}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="led-stat">
      <div className="led-stat-label">{label}</div>
      <div className="led-stat-value">{value}</div>
      {sub && <div className="led-stat-sub">{sub}</div>}
    </div>
  );
}

function ScreenRow({
  screen,
  panels,
  placeMode,
  isSelected,
  onSelect,
  onUpdate,
  onUpdateCustomPanel,
  onRemove,
  onDuplicate,
  onExport,
  onTogglePlaceMode,
  onClearMarkers,
  onApplyShapeTemplate,
  onApplyBuildBySize,
  onAddProcessor,
  onRemoveProcessor,
  advancedMode,
  beamsCatalog,
  power,
}: {
  screen: LedScreen;
  panels: LedPanel[];
  placeMode: PlaceMode;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<LedScreen>) => void;
  onUpdateCustomPanel: (patch: Partial<LedCustomPanel>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onExport: () => void | Promise<void>;
  onTogglePlaceMode: (kind: PlaceModeKind) => void;
  onClearMarkers: () => void;
  onApplyShapeTemplate: (template: LedShapeTemplate) => void;
  onApplyBuildBySize: (
    targetWidthM: number,
    targetHeightM: number,
    clearShape: boolean,
  ) => void;
  onAddProcessor: (model: NovastarProcessorModel) => void;
  onRemoveProcessor: (processorId: string) => void;
  advancedMode: boolean;
  beamsCatalog: LedRigAccessoryCatalogItem[];
  power: PowerEstimate | undefined;
}) {
  const t = useT();
  const panelPresetLabelKeys: Record<string, TranslationKey> = {
    Blue: "led.report.color.blue",
    Red: "led.report.color.red",
    "Red + Blue": "led.report.color.redBlue",
    Green: "led.report.color.green",
    Purple: "led.report.color.purple",
    Orange: "led.report.color.orange",
    Teal: "led.report.color.teal",
    Mono: "led.report.color.mono",
  };
  const panel = resolveScreenPanel(screen, panels);
  // Pass the beam catalog so the weight readout in the screen card
  // reflects auto-fitted + manual rig accessories — matching the
  // project-level ledTotals roll-up in App.tsx.
  const m = computeScreenMetrics(screen, panels, beamsCatalog);
  const isCustom = screen.panelKey === CUSTOM_PANEL_KEY;
  const nameScale = clampNameScale(screen.nameScale);
  const markers = screen.markers ?? [];
  const panelMarkers = screen.panelMarkers ?? [];
  // Counts for the row's +P/+S badges include BOTH legacy free-coord
  // markers and the new cell-anchored ones, so the producer always
  // sees an accurate total no matter which kind exists.
  const powerCount =
    markers.filter((mk) => mk.kind === "power").length +
    panelMarkers.filter((mk) => mk.kind === "power").length;
  const signalCount =
    markers.filter((mk) => mk.kind === "signal").length +
    panelMarkers.filter((mk) => mk.kind === "signal").length;
  const totalMarkerCount = markers.length + panelMarkers.length;
  const armed: PlaceModeKind | null =
    placeMode && placeMode.screenId === screen.id ? placeMode.kind : null;
  const [shapeOpen, setShapeOpen] = useState(false);
  // Single dropdown for the Color column — collapses the badge swatches
  // and the dual-color presets (incl. "Auto") behind one trigger so the
  // row stays compact. Click-outside / Escape closes the popover.
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!colorMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!colorMenuRef.current) return;
      if (!colorMenuRef.current.contains(e.target as Node)) {
        setColorMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColorMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [colorMenuOpen]);
  const activePreset = useMemo(() => {
    if (
      screen.panelColorDark === undefined &&
      screen.panelColorLight === undefined
    ) {
      return null;
    }
    const dark = (screen.panelColorDark ?? "").toLowerCase();
    const light = (screen.panelColorLight ?? "").toLowerCase();
    return (
      LED_PANEL_COLOR_PRESETS.find(
        (p) =>
          p.dark.toLowerCase() === dark && p.light.toLowerCase() === light,
      ) ?? null
    );
  }, [screen.panelColorDark, screen.panelColorLight]);
  const triggerLabel = activePreset
    ? t(panelPresetLabelKeys[activePreset.label])
    : t("led.report.auto");
  // Build-by-size form state. Pre-fill with the screen's current
  // physical width/height so the producer can tweak rather than
  // re-type from scratch on every open.
  const currentWidthM = screen.panelsWide * panel.physicalWidth;
  const currentHeightM =
    (screen.panelsTall - 1) * panel.physicalHeight +
    panel.physicalHeight * lastRowHeightFraction(screen, panels);
  const [targetW, setTargetW] = useState<string>(currentWidthM.toFixed(2));
  const [targetH, setTargetH] = useState<string>(currentHeightM.toFixed(2));
  const [clearShapeOnApply, setClearShapeOnApply] = useState(true);
  // Sync the target inputs whenever the parent screen's panel choice
  // or panel count changes outside the popover (e.g. user typed in
  // Wide/Tall directly).
  useEffect(() => {
    if (!shapeOpen) {
      setTargetW(currentWidthM.toFixed(2));
      setTargetH(currentHeightM.toFixed(2));
    }
  }, [shapeOpen, currentWidthM, currentHeightM]);
  const disabledCount = (screen.disabledCells ?? []).length;
  const processors = screen.processors ?? [];
  const cap = computeScreenProcessorCapacity(processors);
  // Required outputs at the conservative per-output pixel cap from the
  // attached processors (e.g. 650 000 px/output for Novastar MX series).
  // We check this in addition to the pixel-cap so a screen that fits in
  // total pixels but needs more than the available daisy-chain outputs
  // (e.g. 1× MX30 = 4 outputs but the wall needs 8) still triggers the
  // warning.
  const requiredOutputs =
    processors.length > 0 && cap.worstPixelsPerOutput > 0
      ? Math.ceil(m.pixels / cap.worstPixelsPerOutput)
      : 0;
  const processorUnder =
    processors.length > 0 &&
    ((cap.maxPixels > 0 && m.pixels > cap.maxPixels) ||
      (cap.outputs > 0 && requiredOutputs > cap.outputs));

  /** Compose the row class so we can layer "linked" and "selected"
   *  styling without repeating the conditional. */
  const rowClass = [
    screen.linked ? "led-row-linked" : "",
    isSelected ? "led-row-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <tr
        className={rowClass}
        data-led-screen-row={screen.id}
        onClick={onSelect}
        title={
          isSelected
            ? t("led.report.row.selected")
            : t("led.report.row.select")
        }
      >
        <td>
          {screen.linked ? (
            <span className="badge badge-linked" title={t("led.report.row.fromRigging")}>
              {t("led.report.linked")}
            </span>
          ) : (
            <span className="badge badge-manual">{t("led.report.manual")}</span>
          )}
        </td>
        <td>
          <input
            className="led-input led-input-name"
            type="text"
            value={screen.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder={t("led.report.row.namePlaceholder")}
            title={t("led.report.row.nameTitle")}
          />
          {/* Pill-size slider — sits directly under the name input so the
              relationship is obvious. The number on the right doubles as
              a "reset to 1×" button when the user wants the default. */}
          <div className="led-pill-scale" title={t("led.report.row.pillSizeTitle")}>
            <span className="led-pill-scale-label">{t("led.report.row.pillSize")}</span>
            <input
              className="led-pill-scale-range"
              type="range"
              min={NAME_SCALE_MIN}
              max={NAME_SCALE_MAX}
              step={0.1}
              value={nameScale}
              onChange={(e) =>
                onUpdate({ nameScale: Number(e.target.value) })
              }
              aria-label={t("led.report.row.pillSizeAria", {
                name: screen.name || t("led.report.screen"),
              })}
            />
            <button
              type="button"
              className="led-pill-scale-value"
              onClick={() => onUpdate({ nameScale: NAME_SCALE_DEFAULT })}
              title={t("led.report.row.resetScale")}
            >
              {nameScale.toFixed(1)}×
            </button>
          </div>
        </td>
        <td>
          <select
            className="led-input"
            value={screen.panelKey}
            onChange={(e) =>
              onUpdate({ panelKey: e.target.value as LedPanelKey })
            }
          >
            {/* If the stored key isn't in the current library (e.g. an
                inventory item was renamed), surface it as a placeholder
                so the user can see it before re-picking. */}
            {!panels.some((p) => p.key === screen.panelKey) && (
              <option value={screen.panelKey}>
                {screen.panelKey} {t("led.report.missing")}
              </option>
            )}
            {panels.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
          {/* Finishing (bottom) row panel — shown only when the screen
              carries a finishing row (auto-picked by build-by-size, or a
              legacy half-row). Lets the producer swap to a different real
              inventory panel, or clear it back to a full-height row. */}
          {hasFinishingRow(screen, panels) && (
            <select
              className="led-input"
              style={{ marginTop: 4 }}
              value={resolveFinishingPanel(screen, panels)?.key ?? ""}
              title={t("led.report.row.finishingPanelTitle")}
              onChange={(e) =>
                onUpdate({
                  finishingPanelKey: e.target.value
                    ? (e.target.value as LedPanelKey)
                    : undefined,
                  lastRowHalf: false,
                })
              }
            >
              <option value="">↳ {t("led.report.row.noFinishingRow")}</option>
              {panels
                .filter(
                  (p) =>
                    p.key !== CUSTOM_PANEL_KEY &&
                    p.physicalHeight > 0 &&
                    p.physicalHeight < panel.physicalHeight - 0.02 &&
                    // Same column width as the body — a mismatched width
                    // would break the grid geometry + per-cabinet metrics.
                    Math.abs(p.physicalWidth - panel.physicalWidth) <= 0.02,
                )
                .map((p) => (
                  <option key={p.key} value={p.key}>
                    ↳ {p.name}
                  </option>
                ))}
            </select>
          )}
        </td>
        <td>
          <NumberField
            className="led-input led-input-num"
            min={1}
            value={screen.panelsWide}
            transform={(n) => Math.max(1, Math.round(n || 1))}
            emptyValue={1}
            onCommit={(panelsWide) => onUpdate({ panelsWide })}
          />
        </td>
        <td>
          <NumberField
            className="led-input led-input-num"
            min={1}
            value={screen.panelsTall}
            transform={(n) => Math.max(1, Math.round(n || 1))}
            emptyValue={1}
            onCommit={(panelsTall) => onUpdate({ panelsTall })}
          />
        </td>
        {/* Shape cell — opens a popover with build-by-size + template
            chips, and arms a "Shape" cell-toggle mode for freeform
            on/off cabinets. The "Shape…" button is rendered next to
            the small "Edit" toggle so the producer can do template
            work and free-toggle from one place. */}
        <td className="led-shape-cell">
          <div className="led-shape-row">
            <button
              type="button"
              className={`btn btn-sm ${shapeOpen ? "btn-primary" : "btn-soft"}`}
              onClick={(e) => {
                e.stopPropagation();
                setShapeOpen((v) => !v);
              }}
              title={t("led.report.shape.openTitle")}
            >
              {t("led.report.table.shape")}…
            </button>
            <button
              type="button"
              className={`btn btn-sm ${armed === "shape" ? "is-armed btn-primary" : "btn-soft"}`}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePlaceMode("shape");
              }}
              title={
                armed === "shape"
                  ? t("led.report.shape.cancelEdit")
                  : t("led.report.shape.editTitle")
              }
            >
              {armed === "shape"
                ? t("led.report.shape.clickCells")
                : t("common.edit")}
            </button>
          </div>
          {disabledCount > 0 && (
            <div className="led-sub" title={t("led.report.shape.offTitle")}>
              {t("led.report.shape.offCount", { count: disabledCount })}
            </div>
          )}
          {shapeOpen && (
            <ShapePopover
              currentWidthM={currentWidthM}
              currentHeightM={currentHeightM}
              targetW={targetW}
              targetH={targetH}
              setTargetW={setTargetW}
              setTargetH={setTargetH}
              clearShapeOnApply={clearShapeOnApply}
              setClearShapeOnApply={setClearShapeOnApply}
              onApplyBuildBySize={() => {
                const w = Number(targetW);
                const h = Number(targetH);
                if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                  onApplyBuildBySize(w, h, clearShapeOnApply);
                }
              }}
              onApplyTemplate={(t) => onApplyShapeTemplate(t)}
              onClose={() => setShapeOpen(false)}
            />
          )}
        </td>
        <td className="led-num">
          {PIXEL_FMT.format(m.pixelsX)} × {PIXEL_FMT.format(m.pixelsY)}
          <div className="led-sub">
            {t("led.report.row.pixelPanelSummary", {
              pixels: PIXEL_FMT.format(m.pixels),
              panels: m.panels,
            })}
          </div>
          {resolveFinishingPanel(screen, panels) && (
            <div
              className="led-sub"
              title={t("led.report.row.finishingRowTitle")}
            >
              {t("led.report.row.finishingRow", {
                count: enabledLastRowCount(screen),
                name: resolveFinishingPanel(screen, panels)!.name,
              })}
            </div>
          )}
        </td>
        <td className="led-num">
          {fmt(m.widthM, 2)} × {fmt(m.heightM, 2)}
          <div className="led-sub">{fmt(m.areaM2, 2)} m²</div>
        </td>
        <td>
          <input
            className="led-input led-input-num"
            type="number"
            min={1}
            placeholder="—"
            value={screen.outputIndex ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onUpdate({
                outputIndex:
                  v === "" ? null : Math.max(1, Number(v) || 1),
              });
            }}
          />
        </td>
        <td>
          {/* Single dropdown that hosts BOTH the badge swatches and the
              dual-color panel-grid presets. Trigger label is the active
              preset name, or "Auto" when the screen falls back to the
              global Export panel colours. */}
          <div
            className="led-color-menu"
            ref={colorMenuRef}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={`led-color-menu-trigger ${colorMenuOpen ? "is-open" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setColorMenuOpen((v) => !v);
              }}
              aria-haspopup="true"
              aria-expanded={colorMenuOpen}
              title={
                activePreset
                  ? t("led.report.color.presetTitle", {
                      name: t(panelPresetLabelKeys[activePreset.label]),
                    })
                  : t("led.report.color.globalTitle")
              }
            >
              <span
                className="led-color-menu-swatch"
                style={
                  activePreset
                    ? {
                        background: `linear-gradient(135deg, ${activePreset.dark} 0%, ${activePreset.dark} 50%, ${activePreset.light} 50%, ${activePreset.light} 100%)`,
                      }
                    : { background: screen.color }
                }
                aria-hidden="true"
              />
              <span className="led-color-menu-label">{triggerLabel}</span>
              <span className="led-color-menu-chev" aria-hidden="true">
                ▾
              </span>
            </button>
            {colorMenuOpen && (
              <div
                className="led-color-menu-popover"
                role="dialog"
                aria-label={t("led.report.color.screenAria")}
              >
                <div className="led-color-menu-section">
                  <div className="led-color-menu-heading">{t("led.report.color.panelPreset")}</div>
                  <div
                    className="led-preset-picker"
                    aria-label={t("led.report.color.panelGridAria")}
                  >
                    <button
                      type="button"
                      className={`led-preset-chip is-auto ${
                        screen.panelColorDark === undefined &&
                        screen.panelColorLight === undefined
                          ? "is-active"
                          : ""
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdate({
                          panelColorDark: undefined,
                          panelColorLight: undefined,
                        });
                      }}
                      title={t("led.report.color.useGlobal")}
                    >
                      {t("led.report.auto")}
                    </button>
                    {LED_PANEL_COLOR_PRESETS.map((p) => {
                      const active =
                        (screen.panelColorDark ?? "").toLowerCase() ===
                          p.dark.toLowerCase() &&
                        (screen.panelColorLight ?? "").toLowerCase() ===
                          p.light.toLowerCase();
                      return (
                        <button
                          key={p.label}
                          type="button"
                          className={`led-preset-chip ${active ? "is-active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdate({
                              panelColorDark: p.dark,
                              panelColorLight: p.light,
                              // Mirror the badge color to the preset's
                              // light value too — keeps the table
                              // swatches and the canvas in sync.
                              color: p.light,
                            });
                          }}
                          title={t("led.report.color.presetTitle", {
                            name: t(panelPresetLabelKeys[p.label]),
                          })}
                          style={{
                            background: `linear-gradient(135deg, ${p.dark} 0%, ${p.dark} 50%, ${p.light} 50%, ${p.light} 100%)`,
                          }}
                          aria-label={t("led.report.color.presetTitle", {
                            name: t(panelPresetLabelKeys[p.label]),
                          })}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="led-color-menu-section">
                  <div className="led-color-menu-heading">{t("led.report.color.badge")}</div>
                  <div className="led-color-picker">
                    {LED_SCREEN_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`led-color-swatch ${screen.color === c ? "is-active" : ""}`}
                        style={{ background: c }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdate({ color: c });
                        }}
                        aria-label={t("led.report.color.colorAria", { color: c })}
                      />
                    ))}
                  </div>
                </div>
                <div className="led-color-menu-section">
                  <div className="led-color-menu-heading">{t("led.report.color.label")}</div>
                  <div
                    className="led-color-picker"
                    style={{ alignItems: "center", gap: 8 }}
                  >
                    <button
                      type="button"
                      className={`led-preset-chip is-auto ${
                        screen.labelColor === undefined ? "is-active" : ""
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdate({ labelColor: undefined });
                      }}
                      title={t("led.report.color.useDefaultLabel")}
                    >
                      {t("led.report.auto")}
                    </button>
                    {[...LED_SCREEN_COLORS, "#ffffff"].map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`led-color-swatch ${(screen.labelColor ?? "").toLowerCase() === c.toLowerCase() ? "is-active" : ""}`}
                        style={{
                          background: c,
                          // Give the white swatch a visible outline so it
                          // doesn't disappear into the popover background.
                          border:
                            c.toLowerCase() === "#ffffff"
                              ? "1px solid var(--border)"
                              : undefined,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdate({ labelColor: c });
                        }}
                        aria-label={t("led.report.color.labelAria", { color: c })}
                      />
                    ))}
                    <input
                      type="color"
                      value={screen.labelColor ?? "#0f172a"}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onUpdate({ labelColor: e.target.value })}
                      title={t("led.report.color.customLabel")}
                      style={{
                        width: 28,
                        height: 24,
                        padding: 0,
                        border: "1px solid var(--border)",
                        borderRadius: 4,
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </td>
        <td>
          <input
            className="led-input"
            type="text"
            value={screen.notes}
            onChange={(e) => onUpdate({ notes: e.target.value })}
            placeholder={t("led.report.row.notesPlaceholder")}
          />
          {/* Rotation input — degrees clockwise. Empty / 0 = no
              rotation (legacy default). Compact so it fits the row
              without pushing the notes column. */}
          <div className="led-rotation-row" style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <label className="led-sub" style={{ whiteSpace: "nowrap" }}>
              {t("led.report.row.rotate")}
            </label>
            <input
              className="led-input led-input-num"
              type="number"
              step={1}
              value={screen.rotationDeg ?? ""}
              placeholder="0°"
              style={{ width: 64 }}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  onUpdate({ rotationDeg: undefined });
                  return;
                }
                const n = Number(v);
                if (Number.isFinite(n)) {
                  // Clamp to [-180, 180] so the input can't produce
                  // visually meaningless extreme values, but allow
                  // negative for counter-clockwise tilt.
                  onUpdate({ rotationDeg: Math.max(-180, Math.min(180, n)) });
                }
              }}
              title={t("led.report.row.rotateTitle")}
            />
            <span className="led-sub">°</span>
          </div>
        </td>
        <td className="led-actions">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onExport()}
            title={t("led.report.row.exportTitle")}
          >
            PNG
          </button>
          <button
            className="btn btn-soft btn-sm"
            onClick={onDuplicate}
            title={t("led.report.row.duplicateTitle")}
          >
              {t("led.report.row.copy")}
          </button>
          {!screen.linked && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                if (
                  window.confirm(
                    t("led.report.confirm.deleteScreen", {
                      name: screen.name || t("led.report.unnamed"),
                    }),
                  )
                ) {
                  onRemove();
                }
              }}
              title={t("led.report.row.deleteTitle")}
            >
              {t("common.delete")}
            </button>
          )}
        </td>
      </tr>
      {/* Per-screen processors strip — sits directly under the main
          row so the producer can attach 1× MX40 + 1× MX30 to one
          screen without leaving the table. Capacity is computed live
          and a red badge appears if the screen exceeds the attached
          processors' combined pixel cap. */}
      <tr className="led-row-procs">
        <td colSpan={12}>
          <ProcessorsStrip
            processors={processors}
            requiredPixels={m.pixels}
            cap={cap}
            isUnder={processorUnder}
            onAdd={onAddProcessor}
            onRemove={onRemoveProcessor}
          />
        </td>
      </tr>
      {advancedMode && (
        <tr className="led-row-advanced">
          <td colSpan={12}>
            <AdvancedScreenInspector
              screen={screen}
              power={power}
              onUpdate={onUpdate}
            />
          </td>
        </tr>
      )}
      {beamsCatalog.length > 0 && (
        <tr className="led-row-rig">
          <td colSpan={12}>
            <RigAccessoriesPanel
              screen={screen}
              panels={panels}
              catalog={beamsCatalog}
              onChange={(rigAccessories) => onUpdate({ rigAccessories })}
              onToggleAutoFit={(autoFitBeams) => onUpdate({ autoFitBeams })}
            />
          </td>
        </tr>
      )}
      {isCustom && (
        <tr className="led-row-custom">
          <td colSpan={12}>
            <div className="led-custom-panel">
              <strong>{t("led.report.customPanel")}:</strong>
              <label>
                {t("led.report.custom.pixelsW")}
                <NumberField
                  min={1}
                  value={panel.pixelWidth}
                  transform={(n) => Math.max(1, Math.round(n || 1))}
                  emptyValue={1}
                  onCommit={(pixelWidth) =>
                    onUpdateCustomPanel({ pixelWidth })
                  }
                />
              </label>
              <label>
                {t("led.report.custom.pixelsH")}
                <NumberField
                  min={1}
                  value={panel.pixelHeight}
                  transform={(n) => Math.max(1, Math.round(n || 1))}
                  emptyValue={1}
                  onCommit={(pixelHeight) =>
                    onUpdateCustomPanel({ pixelHeight })
                  }
                />
              </label>
              <label>
                {t("led.report.custom.width")}
                <NumberField
                  min={0.01}
                  step={0.01}
                  value={panel.physicalWidth}
                  transform={(n) => Math.max(0.01, n || 0.5)}
                  emptyValue={0.5}
                  onCommit={(physicalWidth) =>
                    onUpdateCustomPanel({ physicalWidth })
                  }
                />
              </label>
              <label>
                {t("led.report.custom.height")}
                <NumberField
                  min={0.01}
                  step={0.01}
                  value={panel.physicalHeight}
                  transform={(n) => Math.max(0.01, n || 0.5)}
                  emptyValue={0.5}
                  onCommit={(physicalHeight) =>
                    onUpdateCustomPanel({ physicalHeight })
                  }
                />
              </label>
              <label>
                {t("led.report.custom.weight")}
                <NumberField
                  min={0}
                  step={0.1}
                  value={panel.weight}
                  transform={(n) => Math.max(0, n || 0)}
                  emptyValue={0}
                  onCommit={(weight) =>
                    onUpdateCustomPanel({ weight })
                  }
                />
              </label>
              <label>
                {t("led.report.custom.power")}
                <NumberField
                  min={0}
                  step={1}
                  value={panel.power}
                  transform={(n) => Math.max(0, n || 0)}
                  emptyValue={0}
                  onCommit={(power) =>
                    onUpdateCustomPanel({ power })
                  }
                />
              </label>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function PixelMapCanvas({
  advancedMode,
  screens,
  panels,
  settings,
  placeMode,
  selectedScreenId,
  onSelectScreen,
  onUpdateScreen,
  onMoveMarker,
  onRemoveMarker,
  onAddPanelMarker,
  onRemovePanelMarker,
  onToggleCell,
  paintMode,
  onPaintModeChange,
  paintScreen,
  paintMap,
  onPaintMapChange,
  activePortId,
  onActivePortChange,
  onPaintCell,
  onPaintDrag,
  onUpdateSettings,
}: {
  screens: LedScreen[];
  panels: LedPanel[];
  settings: LedSettings;
  onUpdateSettings: (patch: Partial<LedSettings>) => void;
  placeMode: PlaceMode;
  selectedScreenId: string | null;
  onSelectScreen: (id: string | null) => void;
  onUpdateScreen: (id: string, patch: Partial<LedScreen>) => void;
  onMoveMarker: (screenId: string, markerId: string, x: number, y: number) => void;
  onRemoveMarker: (screenId: string, markerId: string) => void;
  onAddPanelMarker: (
    screenId: string,
    kind: LedPanelMarker["kind"],
    col: number,
    row: number,
  ) => void;
  onRemovePanelMarker: (screenId: string, markerId: string) => void;
  onToggleCell: (screenId: string, col: number, row: number) => void;
  advancedMode: boolean;
  paintMode: PaintMode;
  onPaintModeChange: (m: PaintMode) => void;
  paintScreen: LedScreen | null;
  paintMap: LedPortMap | undefined;
  onPaintMapChange: (m: LedPortMap | undefined) => void;
  activePortId: string | null;
  onActivePortChange: (id: string | null) => void;
  onPaintCell: (screenId: string, col: number, row: number) => void;
  onPaintDrag: (
    screenId: string,
    col: number,
    row: number,
    phase: "start" | "move" | "end",
  ) => void;
}) {
  const t = useT();
  /** Outer SVG ref — used by the drag handler to translate client-pixel
   *  pointer movement into the SVG's user-space units (which is what
   *  `posX`/`posY` are stored in). */
  const svgRef = useRef<SVGSVGElement | null>(null);

  const layout = useMemo(() => {
    const SCALE = 70; // px per meter
    const GAP = 30; // px gap between screens
    const TOP = 60; // px reserved for output badge above each screen
    const PAD = 20;

    let cursorX = PAD;
    let maxBottom = 0;
    let minLeft = PAD;
    let minTop = TOP + PAD;

    // First pass — auto-flow positions every screen left-to-right, but
    // skips the flow advance for screens that carry an explicit
    // posX/posY override. Those screens are placed at their stored
    // coordinates and contribute to the canvas bounds rather than the
    // cursor, so dragging one out of the row doesn't leave a gap in
    // the auto-flow row.
    const items = screens.map((s) => {
      const panel = resolveScreenPanel(s, panels);
      const screenWidthPx = s.panelsWide * panel.physicalWidth * SCALE;
      const screenHeightPx =
        ((s.panelsTall - 1) * panel.physicalHeight +
          panel.physicalHeight * lastRowHeightFraction(s, panels)) *
        SCALE;
      const cellW = panel.physicalWidth * SCALE;
      const cellH = panel.physicalHeight * SCALE;

      let x: number;
      let y: number;
      const positioned = s.posX !== undefined || s.posY !== undefined;
      if (positioned) {
        x = s.posX ?? cursorX;
        y = s.posY ?? TOP + PAD;
      } else {
        x = cursorX;
        y = TOP + PAD;
        cursorX += screenWidthPx + GAP;
      }

      maxBottom = Math.max(maxBottom, y + screenHeightPx);
      minLeft = Math.min(minLeft, x);
      minTop = Math.min(minTop, y);

      return {
        screen: s,
        panel,
        x,
        y,
        width: screenWidthPx,
        height: screenHeightPx,
        cellW,
        cellH,
        positioned,
      } as SvgItem;
    });

    const rightEdge = Math.max(
      cursorX - GAP + PAD,
      ...items.map((it) => it.x + it.width + PAD),
      400,
    );
    // Allow negative posX/posY to grow the viewBox to the left/top so
    // the user can drag a screen anywhere without it disappearing
    // off-canvas.
    const minX = Math.min(0, minLeft - PAD);
    // Reserve TOP above the topmost element so the output badge / drag
    // handle for that screen still has room.
    const minY = Math.min(0, minTop - TOP);
    const totalWidth = Math.max(rightEdge - minX, 400);
    const totalHeight = Math.max(maxBottom + PAD - minY, 200);

    return { items, totalWidth, totalHeight, minX, minY };
  }, [screens, panels]);

  /** Drag state lives in a ref to avoid re-installing the window
   *  pointermove listener on every move (which would otherwise cause
   *  the listener to drop the rapid stream of move events generated
   *  during a fast drag). The `dragId` state below is only used for
   *  the visual "is dragging" halo and updates exactly twice per drag
   *  (start + end), keeping React renders cheap. */
  const dragRef = useRef<{
    screenId: string;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  // Latest layout is also captured in a ref so the window pointermove
  // listener (installed once) can map client coords to SVG user-space
  // using the freshest viewBox values without needing to re-attach.
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // onUpdateScreen also goes through a ref so the install-once
  // listener always calls the freshest patcher, even after parent
  // re-renders.
  const onUpdateScreenRef = useRef(onUpdateScreen);
  useEffect(() => {
    onUpdateScreenRef.current = onUpdateScreen;
  }, [onUpdateScreen]);

  /** Map a client-pixel pointer position to the SVG's user-space
   *  coordinate system using the latest layout. */
  const clientToSvg = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const lay = layoutRef.current;
      const userX =
        ((clientX - rect.left) / rect.width) * lay.totalWidth + lay.minX;
      const userY =
        ((clientY - rect.top) / rect.height) * lay.totalHeight + lay.minY;
      return { x: userX, y: userY };
    },
    [],
  );

  /** Install pointermove / pointerup listeners exactly once for the
   *  lifetime of this canvas. They no-op when there is no active drag,
   *  so they're effectively free when idle. */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const pt = clientToSvg(e.clientX, e.clientY);
      if (!pt) return;
      onUpdateScreenRef.current(d.screenId, {
        posX: pt.x - d.offsetX,
        posY: pt.y - d.offsetY,
      });
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setDragId(null);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [clientToSvg]);

  const handleHandlePointerDown = useCallback(
    (
      screenId: string,
      itemX: number,
      itemY: number,
      e: React.PointerEvent,
    ) => {
      // Defense-in-depth — ScreenSvg already hides the handle for
      // linked screens, but a guard here ensures the drag never
      // starts even if the handle is somehow still reachable
      // (browser quirks, future regressions, etc.). Linked screens
      // don't store posX/posY on the LED tab, so dragging would be
      // a no-op with confusing visual feedback.
      if (screenId.startsWith("led-linked-")) return;
      e.stopPropagation();
      e.preventDefault();
      const pt = clientToSvg(e.clientX, e.clientY);
      if (!pt) return;
      onSelectScreen(screenId);
      dragRef.current = {
        screenId,
        pointerId: e.pointerId,
        offsetX: pt.x - itemX,
        offsetY: pt.y - itemY,
      };
      setDragId(screenId);
    },
    [clientToSvg, onSelectScreen],
  );

  return (
    <div className="led-canvas-wrap">
      {/* Paint Power / Paint Signal toolbar — visible in BOTH Basic
          and Advanced modes so producers can plan power/signal cabling
          without having to switch views. */}
      <PaintToolbar
        mode={paintMode}
        onModeChange={onPaintModeChange}
        selectedScreen={paintScreen}
        map={paintMap}
        onMapChange={onPaintMapChange}
        activePortId={activePortId}
        onActivePortChange={onActivePortChange}
        canvasSvgRef={svgRef}
      />
      <svg
        ref={svgRef}
        className="led-canvas"
        viewBox={`${layout.minX} ${layout.minY} ${layout.totalWidth} ${layout.totalHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={t("led.report.canvasAria")}
        onClick={(e) => {
          // Click on empty canvas = clear selection. Children stop
          // propagation when the user clicks a screen, so this only
          // fires on the SVG background itself.
          if (e.target === e.currentTarget) onSelectScreen(null);
        }}
      >
        {layout.items.map((item) => (
          <ScreenSvg
            key={item.screen.id}
            item={item}
            panels={panels}
            settings={settings}
            placeMode={placeMode}
            isSelected={selectedScreenId === item.screen.id}
            isDragging={dragId === item.screen.id}
            onSelect={() => onSelectScreen(item.screen.id)}
            onHandlePointerDown={(e) =>
              handleHandlePointerDown(item.screen.id, item.x, item.y, e)
            }
            onMoveMarker={onMoveMarker}
            onRemoveMarker={onRemoveMarker}
            onAddPanelMarker={onAddPanelMarker}
            onRemovePanelMarker={onRemovePanelMarker}
            onToggleCell={onToggleCell}
            paintMode={paintMode}
            isPaintTarget={
              paintMode !== "off" && selectedScreenId === item.screen.id
            }
            onPaintCell={onPaintCell}
            onPaintDrag={onPaintDrag}
            onUpdateSettings={onUpdateSettings}
          />
        ))}
      </svg>
    </div>
  );
}

type SvgItem = {
  screen: LedScreen;
  panel: LedPanel;
  x: number;
  y: number;
  width: number;
  height: number;
  cellW: number;
  cellH: number;
  /** True when the screen has an explicit posX/posY override and is
   *  rendered outside the auto-flow row. Currently informational —
   *  reserved for future styling decisions (e.g. a "manually placed"
   *  hint badge). */
  positioned: boolean;
};

/** Choose a near-black or near-white ink for text/strokes layered on
 *  top of `bg`, using the standard luminance formula. Falls back to
 *  black for malformed colours. */
function pickContrastInk(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return "#111";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  // Per WCAG: relative luminance approximation (sRGB gamma simplified).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#111" : "#fff";
}

function ScreenSvg({
  item,
  panels,
  settings,
  placeMode,
  isSelected,
  isDragging,
  onSelect,
  onHandlePointerDown,
  onMoveMarker,
  onRemoveMarker,
  onAddPanelMarker,
  onRemovePanelMarker,
  onToggleCell,
  paintMode,
  isPaintTarget,
  onPaintCell,
  onPaintDrag,
  onUpdateSettings,
}: {
  item: SvgItem;
  panels: LedPanel[];
  settings: LedSettings;
  placeMode: PlaceMode;
  isSelected: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onHandlePointerDown: (e: React.PointerEvent) => void;
  onMoveMarker: (screenId: string, markerId: string, x: number, y: number) => void;
  onRemoveMarker: (screenId: string, markerId: string) => void;
  onAddPanelMarker: (
    screenId: string,
    kind: LedPanelMarker["kind"],
    col: number,
    row: number,
  ) => void;
  onRemovePanelMarker: (screenId: string, markerId: string) => void;
  onToggleCell: (screenId: string, col: number, row: number) => void;
  paintMode: PaintMode;
  /** True when this screen is the active paint target — i.e. paint
   *  mode is on AND this is the selected screen. Other screens still
   *  *render* their port overlay in paint mode so producers can see
   *  every map at a glance, but clicks only paint the selected one. */
  isPaintTarget: boolean;
  onPaintCell: (screenId: string, col: number, row: number) => void;
  onPaintDrag: (
    screenId: string,
    col: number,
    row: number,
    phase: "start" | "move" | "end",
  ) => void;
  /** Patch global LedSettings — used by the draggable logo overlay
   *  to persist `logoX/Y` after the user repositions it. */
  onUpdateSettings: (patch: Partial<LedSettings>) => void;
}) {
  const t = useT();
  const { screen, x, y, width, height, cellW, cellH } = item;
  /** Per-screen panel colours override the global ledSettings ones when
   *  present (set via the per-row preset picker, the PDF importer, or
   *  the Add-Screen action). Falls back per field so a screen can
   *  override only one of the two and inherit the other. */
  const screenColorDark = screen.panelColorDark ?? settings.panelColorDark;
  const screenColorLight = screen.panelColorLight ?? settings.panelColorLight;
  const armed: PlaceModeKind | null =
    placeMode && placeMode.screenId === screen.id ? placeMode.kind : null;
  /** The transparent overlay rect's client bounding box is the source
   *  of truth for "where on the screen did the user click?" — using it
   *  also handles the SVG's `preserveAspectRatio` scaling correctly,
   *  whereas a viewBox-based math conversion would need extra work. */
  const overlayRectRef = useRef<SVGRectElement | null>(null);
  /** In-flight paint gesture on the overlay rect. We can't tell a tap
   *  from a drag until the pointer either moves (→ drag a chain) or
   *  lifts without moving (→ tap-toggle a single cell), so we stash the
   *  press point and a `moved` flag here. */
  const paintGestureRef = useRef<{
    pointerId: number;
    moved: boolean;
    startCol: number;
    startRow: number;
  } | null>(null);
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(
    null,
  );
  /** Logo drag state. `dragOffset` stores the click-point's offset from
   *  the logo's top-left (in normalised 0..1 coords) so the cursor
   *  stays glued to the same spot inside the logo while dragging.
   *  `logoDragPos` holds the live drag position locally so we don't
   *  thrash `onUpdateSettings` (and the autosave path, which
   *  re-serialises the full PersistedV2 blob including the multi-MB
   *  custom-logo data URL) on every pointer move — we only commit
   *  the final position on pointerup. */
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const logoDragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  /** Max normalised top-left coords (= 1 - logoSize/screenSize) at the
   *  moment the drag started, shared between the element-side commit
   *  and the window-fallback commit so both clamp identically. */
  const logoDragMaxRef = useRef<{ maxX: number; maxY: number }>({ maxX: 1, maxY: 1 });
  const [logoDragPos, setLogoDragPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  const screenId = screen.id;
  const markers = screen.markers ?? [];
  const panelMarkers = screen.panelMarkers ?? [];

  /** Convert a pointer event into normalised coords inside the screen
   *  rect. Returns null if the overlay isn't mounted yet (e.g. during
   *  the initial render between effects).
   *
   *  Uses `getScreenCTM()` (not `getBoundingClientRect`) so the mapping
   *  is correct even when the parent `<g>` carries an SVG rotation
   *  transform — `getBoundingClientRect` returns the rotated AABB,
   *  which would misplace clicks on tilted screens. The CTM inverse
   *  maps client coords into the rect's LOCAL coordinate system, so
   *  we can then normalise against the rect's local `x/y/width/height`
   *  attrs. Falls back to the legacy `getBoundingClientRect` path when
   *  CTM isn't available (e.g. detached DOM during HMR). */
  const eventToNorm = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
      const el = overlayRectRef.current;
      if (!el) return null;
      const svg = el.ownerSVGElement;
      const ctm = el.getScreenCTM();
      if (svg && ctm) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const local = pt.matrixTransform(ctm.inverse());
        const bx = el.x.baseVal.value;
        const by = el.y.baseVal.value;
        const bw = el.width.baseVal.value;
        const bh = el.height.baseVal.value;
        if (bw <= 0 || bh <= 0) return null;
        return { x: (local.x - bx) / bw, y: (local.y - by) / bh };
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      };
    },
    [],
  );

  /** Translate a pointer event into the (col, row) of the cell it hit.
   *  Returns null when the overlay isn't mounted or the click missed
   *  the screen. Clamps so an off-by-one pixel near the edge still
   *  registers on the boundary cell instead of returning out-of-range. */
  const eventToCell = useCallback(
    (e: { clientX: number; clientY: number }): { col: number; row: number } | null => {
      const norm = eventToNorm(e);
      if (!norm) return null;
      const col = Math.min(
        screen.panelsWide - 1,
        Math.max(0, Math.floor(norm.x * screen.panelsWide)),
      );
      // The overlay rect is sized to the actual (possibly half-row)
      // height, so norm.y spans `panelsTall - 0.5` full-cell units when
      // the bottom row is half height. Scaling by that keeps every full
      // row exactly one unit tall and the half row the trailing 0.5.
      const tallUnits =
        screen.panelsTall - 1 + lastRowHeightFraction(screen, panels);
      const row = Math.min(
        screen.panelsTall - 1,
        Math.max(0, Math.floor(norm.y * tallUnits)),
      );
      return { col, row };
    },
    [eventToNorm, screen, panels],
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      // When this screen is the active paint target, painting is driven
      // by the pointer down/move/up handlers below (tap = toggle a cell,
      // drag = auto-link a whole chain that follows the cursor), so the
      // click event is a no-op here.
      if (isPaintTarget) return;
      if (!armed) return;
      const cell = eventToCell(e);
      if (!cell) return;
      if (armed === "shape") {
        onToggleCell(screenId, cell.col, cell.row);
      } else {
        // power / signal — drop a cell-anchored marker. The parent
        // handler swaps "second click on same cell" for a remove, so
        // the producer can both place and clear without disarming.
        onAddPanelMarker(screenId, armed, cell.col, cell.row);
      }
    },
    [
      armed,
      eventToCell,
      isPaintTarget,
      onAddPanelMarker,
      onToggleCell,
      screenId,
    ],
  );

  // ── Paint pointer gesture (tap vs drag) ──────────────────────────
  const handleOverlayPointerDown = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      if (!isPaintTarget || e.button !== 0) return;
      const cell = eventToCell(e);
      if (!cell) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture is best-effort */
      }
      paintGestureRef.current = {
        pointerId: e.pointerId,
        moved: false,
        startCol: cell.col,
        startRow: cell.row,
      };
    },
    [isPaintTarget, eventToCell],
  );

  const handleOverlayPointerMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const g = paintGestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const cell = eventToCell(e);
      if (!cell) return;
      if (!g.moved) {
        // Ignore micro-jitter inside the press cell — only promote to a
        // drag once the cursor actually crosses into another panel.
        if (cell.col === g.startCol && cell.row === g.startRow) return;
        g.moved = true;
        onPaintDrag(screenId, g.startCol, g.startRow, "start");
      }
      onPaintDrag(screenId, cell.col, cell.row, "move");
    },
    [eventToCell, onPaintDrag, screenId],
  );

  const handleOverlayPointerUp = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const g = paintGestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (g.moved) {
        onPaintDrag(screenId, g.startCol, g.startRow, "end");
      } else {
        // A plain tap toggles the cell on the active chain (or seeds a
        // brand-new chain when none is active).
        onPaintCell(screenId, g.startCol, g.startRow);
      }
      paintGestureRef.current = null;
    },
    [onPaintDrag, onPaintCell, screenId],
  );

  const handleOverlayPointerCancel = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const g = paintGestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      if (g.moved) onPaintDrag(screenId, g.startCol, g.startRow, "end");
      paintGestureRef.current = null;
    },
    [onPaintDrag, screenId],
  );

  /** Marker pointer-down: alt or right-button = delete, otherwise begin
   *  drag with pointer capture so the move keeps tracking even if the
   *  cursor leaves the SVG (matches iPad-friendly drag conventions). */
  const handleMarkerPointerDown = useCallback(
    (markerId: string) =>
      (e: React.PointerEvent<SVGGElement>) => {
        e.stopPropagation();
        if (e.altKey || e.button === 2) {
          e.preventDefault();
          onRemoveMarker(screenId, markerId);
          return;
        }
        setDraggingMarkerId(markerId);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Some browsers throw on capture for non-primary pointers; the
          // drag still works via window-fallback movements, so swallow.
        }
      },
    [onRemoveMarker, screenId],
  );

  const handleMarkerPointerMove = useCallback(
    (markerId: string) =>
      (e: React.PointerEvent<SVGGElement>) => {
        if (draggingMarkerId !== markerId) return;
        const norm = eventToNorm(e);
        if (!norm) return;
        onMoveMarker(screenId, markerId, norm.x, norm.y);
      },
    [draggingMarkerId, eventToNorm, onMoveMarker, screenId],
  );

  const handleMarkerPointerUp = useCallback(
    () => setDraggingMarkerId(null),
    [],
  );

  /** Window-level fallback: if `setPointerCapture` was rejected (rare on
   *  some pointer types) or capture is silently lost, the per-marker
   *  pointermove won't fire once the cursor leaves the marker dot. We
   *  therefore mirror move/up at the window while a drag is active so
   *  the marker keeps tracking and always releases. */
  useEffect(() => {
    if (!draggingMarkerId) return;
    const onMove = (e: PointerEvent) => {
      const norm = eventToNorm(e);
      if (!norm) return;
      onMoveMarker(screenId, draggingMarkerId, norm.x, norm.y);
    };
    const onUp = () => setDraggingMarkerId(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [draggingMarkerId, eventToNorm, onMoveMarker, screenId]);

  /** Same window-level fallback for the logo drag — if the cursor
   *  leaves the logo element while dragging (e.g. capture rejected),
   *  keep tracking until the pointer is released. Writes to local
   *  `logoDragPos` only; the final position is committed to settings
   *  on pointerup so autosave doesn't re-serialise the (potentially
   *  multi-MB) custom-logo data URL on every pointermove. */
  useEffect(() => {
    if (!isDraggingLogo) return;
    const onMove = (e: PointerEvent) => {
      const norm = eventToNorm(e);
      if (!norm) return;
      const { dx, dy } = logoDragOffsetRef.current;
      setLogoDragPos({ x: norm.x - dx, y: norm.y - dy });
    };
    const onUp = () => {
      setIsDraggingLogo(false);
      setLogoDragPos((pos) => {
        if (pos) {
          const { maxX, maxY } = logoDragMaxRef.current;
          onUpdateSettings({
            logoX: Math.min(maxX, Math.max(0, pos.x)),
            logoY: Math.min(maxY, Math.max(0, pos.y)),
          });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isDraggingLogo, eventToNorm, onUpdateSettings]);

  const handleMarkerContextMenu = useCallback(
    (markerId: string) => (e: React.MouseEvent) => {
      // Right-click = delete, never the browser context menu.
      e.preventDefault();
      e.stopPropagation();
      onRemoveMarker(screenId, markerId);
    },
    [onRemoveMarker, screenId],
  );

  const cells: React.ReactNode[] = [];
  const minDim = Math.min(cellW, cellH);
  const labelFont = Math.max(7, Math.min(14, minDim * 0.32));
  const showLabelsHere = settings.showLabels && minDim >= 14;
  // Arrows need a bit of room — skip on tiny cells where they'd be a
  // smudge. Labels (top-left) and arrows (bottom-right or center) sit
  // in different parts of the cell, so they don't collide visually.
  // The per-cell data-flow arrows are suppressed whenever the canvas
  // is in a paint mode — the port-chain arrows from the paint overlay
  // take over so the user only sees one set of arrows at a time.
  const showArrowsHere =
    settings.showArrows && minDim >= 12 && paintMode === "off";
  const arrowSize = Math.max(6, minDim * 0.32);
  const arrowStroke = Math.max(1.2, arrowSize * 0.16);
  // Cabinet-ID badge font matches the label font so the two pieces of
  // text read at the same size at the same zoom. Suppressed on tiny
  // cells like the panel labels — the badge sits in the bottom-right
  // corner so it never collides with the A1/B1 label (top-left) or
  // the centred data-flow arrow.
  const showCabinetIdsHere = settings.showCabinetIds && minDim >= 16;
  const idFont = Math.max(7, Math.min(14, minDim * 0.30));

  // Build the disabled-cells lookup ONCE per render (cheap — Set of
  // ints) and reuse for the cell, label, arrow, and panel-marker
  // passes so they all agree on which cabinets are actually present.
  const offCells = disabledCellSet(screen);

  // Walk all enabled cabinets in the same order the data flows
  // through the screen — i.e. in `settings.wirePath` order. This
  // single ordered sequence drives both:
  //   1) the sequential cabinet-ID badge numbering (so the IDs match
  //      the commissioning chain, not just left-to-right reading), and
  //   2) the data-flow polyline overlay (so it visibly snakes through
  //      the screen in the same direction the cells' arrows already
  //      indicate, like the Pixel Perfect Pro reference).
  const wireOrder: { col: number; row: number }[] = [];
  if (settings.wirePath === "column-serpentine") {
    for (let col = 0; col < screen.panelsWide; col++) {
      const reversed = col % 2 === 1;
      for (let i = 0; i < screen.panelsTall; i++) {
        const row = reversed ? screen.panelsTall - 1 - i : i;
        if (!isCellDisabled(offCells, col, row, screen.panelsWide)) {
          wireOrder.push({ col, row });
        }
      }
    }
  } else if (settings.wirePath === "serpentine") {
    for (let row = 0; row < screen.panelsTall; row++) {
      const reversed = row % 2 === 1;
      for (let i = 0; i < screen.panelsWide; i++) {
        const col = reversed ? screen.panelsWide - 1 - i : i;
        if (!isCellDisabled(offCells, col, row, screen.panelsWide)) {
          wireOrder.push({ col, row });
        }
      }
    }
  } else {
    // linear — every row left-to-right; jumps diagonally at row wraps
    // (handled by the polyline orthogonal-routing pass below).
    for (let row = 0; row < screen.panelsTall; row++) {
      for (let col = 0; col < screen.panelsWide; col++) {
        if (!isCellDisabled(offCells, col, row, screen.panelsWide)) {
          wireOrder.push({ col, row });
        }
      }
    }
  }
  // Map each cell's flat index → its 1-based cabinet ID. Lookup in
  // the cell render loop below is O(1), and disabled cells are simply
  // absent from the map so they never get a badge.
  const cabinetIdByCell = new Map<number, number>();
  wireOrder.forEach(({ col, row }, i) => {
    cabinetIdByCell.set(row * screen.panelsWide + col, i + 1);
  });
  // The bottom row renders at half the cabinet height when this screen
  // uses a half-height finishing row. Only the last row shrinks, so the
  // `cy = y + row * cellH` top-edge of every row above it stays exact.
  const rowH = (r: number) =>
    r === screen.panelsTall - 1
      ? cellH * lastRowHeightFraction(screen, panels)
      : cellH;
  for (let row = 0; row < screen.panelsTall; row++) {
    const thisRowH = rowH(row);
    for (let col = 0; col < screen.panelsWide; col++) {
      const cx = x + col * cellW;
      const cy = y + row * cellH;
      const isOff = isCellDisabled(offCells, col, row, screen.panelsWide);
      if (isOff) {
        // Render the void as a hatched / muted cell so the producer
        // (and the crew) can still see "no cabinet here" but won't
        // mistake it for a panel they need to rig. The fill is the
        // canvas backdrop; a dashed outline + diagonal hint marks it.
        cells.push(
          <g key={`${col}-${row}`}>
            <rect
              x={cx}
              y={cy}
              width={cellW}
              height={thisRowH}
              fill="#e5e7eb"
              fillOpacity={0.35}
              stroke="#94a3b8"
              strokeOpacity={0.7}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <line
              x1={cx}
              y1={cy}
              x2={cx + cellW}
              y2={cy + thisRowH}
              stroke="#94a3b8"
              strokeOpacity={0.5}
              strokeWidth={1}
            />
          </g>,
        );
        continue;
      }
      const cellFill = panelCellColor(
        col,
        row,
        settings.panelPattern,
        screenColorDark,
        screenColorLight,
      );
      let arrowDir: CellArrowDir = null;
      if (showArrowsHere) {
        arrowDir = cellArrowDirection(
          col,
          row,
          screen.panelsWide,
          screen.panelsTall,
          settings.wirePath,
        );
        // Suppress arrows that would point INTO a disabled neighbour;
        // otherwise the data-flow visual reads as "wire into a void".
        if (arrowDir) {
          const nx =
            arrowDir === "right"
              ? col + 1
              : arrowDir === "left"
                ? col - 1
                : col;
          const ny =
            arrowDir === "down"
              ? row + 1
              : arrowDir === "up"
                ? row - 1
                : row;
          if (
            nx < 0 ||
            nx >= screen.panelsWide ||
            ny < 0 ||
            ny >= screen.panelsTall ||
            isCellDisabled(offCells, nx, ny, screen.panelsWide)
          ) {
            arrowDir = null;
          }
        }
      }
      const cabinetId = cabinetIdByCell.get(row * screen.panelsWide + col) ?? 0;
      cells.push(
        <g key={`${col}-${row}`}>
          <rect
            x={cx}
            y={cy}
            width={cellW}
            height={thisRowH}
            fill={cellFill}
            stroke="#0f172a"
            strokeOpacity={0.5}
            strokeWidth={1}
          />
          {showLabelsHere && (
            // Top-left corner so labels never overlap the centred
            // data-flow arrows. Mirrors the PNG export.
            <text
              x={cx + Math.max(2, cellW * 0.06)}
              y={cy + Math.max(2, thisRowH * 0.06) + labelFont * 0.85}
              fontSize={labelFont}
              fill={screen.labelColor || "#0f172a"}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight={600}
            >
              {col + 1}.{rowLabel(row)}
            </text>
          )}
          {showCabinetIdsHere && (
            // Bottom-right cabinet-ID badge. White pill so the number
            // stays legible against any panel-pattern colour, with a
            // dark numeric so it prints clearly.
            <g>
              <rect
                x={cx + cellW - idFont * 1.7 - 2}
                y={cy + thisRowH - idFont * 1.3 - 2}
                width={idFont * 1.7}
                height={idFont * 1.3}
                rx={Math.max(2, idFont * 0.25)}
                ry={Math.max(2, idFont * 0.25)}
                fill="#ffffff"
                fillOpacity={0.88}
                stroke="#0f172a"
                strokeOpacity={0.3}
                strokeWidth={0.75}
              />
              <text
                x={cx + cellW - idFont * 0.85 - 2}
                y={cy + thisRowH - idFont * 0.5 - 2}
                fontSize={idFont}
                fill="#0f172a"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {cabinetId}
              </text>
            </g>
          )}
          {arrowDir && (
            <CellArrow
              cx={cx + cellW / 2}
              cy={cy + thisRowH / 2}
              size={arrowSize}
              stroke={arrowStroke}
              dir={arrowDir}
            />
          )}
        </g>,
      );
    }
  }

  // Data-flow polyline overlay — connects every enabled cabinet
  // centre IN WIRE-PATH ORDER, with right-angle (Manhattan) routing
  // at non-orthogonal transitions. This matches the look of the
  // Pixel Perfect Pro reference: serpentine modes naturally produce
  // h/v steps between neighbours, while `linear` wraps from end-of-
  // row to start-of-next-row are routed through the inter-row gap
  // (down → across → up) instead of a long diagonal jumping across
  // the whole screen. Skipped when there are fewer than two
  // cabinets — nothing to chain.
  const dataFlowPath: React.ReactNode = (() => {
    if (!settings.showDataFlowPath || wireOrder.length < 2) return null;
    const centerOf = (c: { col: number; row: number }) => ({
      x: x + c.col * cellW + cellW / 2,
      y: y + c.row * cellH + rowH(c.row) / 2,
    });
    const points: { x: number; y: number }[] = [];
    points.push(centerOf(wireOrder[0]));
    for (let i = 1; i < wireOrder.length; i++) {
      const a = wireOrder[i - 1];
      const b = wireOrder[i];
      const pa = centerOf(a);
      const pb = centerOf(b);
      // Neighbour step (same row or same col) — already orthogonal.
      if (a.row === b.row || a.col === b.col) {
        points.push(pb);
        continue;
      }
      // Diagonal jump (typically `linear` end-of-row → start-of-next-
      // row). Route via the midline of the inter-cell gap so the path
      // stays inside the screen and never cuts diagonally across
      // multiple cells. midY = boundary between row `a.row` and the
      // next row in the direction of travel.
      const midY =
        a.row < b.row
          ? y + a.row * cellH + rowH(a.row)
          : y + a.row * cellH;
      points.push({ x: pa.x, y: midY });
      points.push({ x: pb.x, y: midY });
      points.push(pb);
    }
    return (
      <polyline
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="#f88000"
        strokeWidth={Math.max(1.5, minDim * 0.08)}
        strokeOpacity={0.9}
        strokeLinejoin="round"
        strokeLinecap="round"
        pointerEvents="none"
      />
    );
  })();

  // Numbered output badges centered above each pair of columns — only
  // shown in column-serpentine mode (which is the typical way large
  // processors slice a wall: one output per 2 columns).
  const colPairBadges: React.ReactNode[] = [];
  if (settings.wirePath === "column-serpentine") {
    const pairs = Math.ceil(screen.panelsWide / 2);
    const startIndex = screen.outputIndex ?? 1;
    const badgeR = Math.max(10, Math.min(20, cellW * 0.35));
    for (let p = 0; p < pairs; p++) {
      const col0 = p * 2;
      const col1 = Math.min(col0 + 1, screen.panelsWide - 1);
      const cxBadge =
        x + ((col0 + col1 + 1) * cellW) / 2;
      const cyBadge = y - badgeR - 6;
      colPairBadges.push(
        <g key={`pair-${p}`}>
          <circle
            cx={cxBadge}
            cy={cyBadge}
            r={badgeR}
            fill="#ffffff"
            stroke="#0f172a"
            strokeWidth={2}
          />
          <text
            x={cxBadge}
            y={cyBadge}
            fontSize={Math.max(11, badgeR * 0.95)}
            fontWeight={700}
            fill="#0f172a"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {startIndex + p}
          </text>
        </g>,
      );
    }
  }

  const m = computeScreenMetrics(screen, panels);
  const titleY = y - 36;
  const subY = y - 18;

  // Optional rotation transform — rotates the whole screen group
  // (cells, outline, badges, markers, selection halo) around its
  // centre. 0 / undefined = no transform so the SVG is byte-identical
  // to the pre-rotation output for legacy screens.
  const rotationDeg =
    typeof screen.rotationDeg === "number" && Number.isFinite(screen.rotationDeg)
      ? screen.rotationDeg
      : 0;
  const screenCenterX = x + width / 2;
  const screenCenterY = y + height / 2;
  const rotationTransform =
    rotationDeg !== 0
      ? `rotate(${rotationDeg} ${screenCenterX} ${screenCenterY})`
      : undefined;

  return (
    <g transform={rotationTransform}>
      {/* Per-column-pair output badges (column-serpentine wiring only) */}
      {colPairBadges}
      {/* Single per-screen output badge — hidden when the column-pair
          badges are taking over the strip above the screen. */}
      {screen.outputIndex != null &&
        settings.wirePath !== "column-serpentine" && (
          <g>
            <circle
              cx={x + width / 2}
              cy={y - 26}
              r={18}
              fill={screen.color}
              stroke="#0f172a"
              strokeWidth={2}
            />
            <text
              x={x + width / 2}
              y={y - 26}
              fontSize={16}
              fontWeight={700}
              fill="#fff"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {screen.outputIndex}
            </text>
          </g>
        )}
      {/* Drag handle ⠿ — sits to the left of the title. Pointer-down
          on this group starts a screen drag (not a marker placement)
          and the cursor signals affordance.

          Hidden for linked screens: their position is derived from the
          rigging report (not stored on the LED tab), so dragging would
          have no effect and only confuse the user. The corresponding
          row in the table also stays inert for movement. */}
      {!screen.linked && (() => {
        const handleY = (screen.outputIndex != null ? titleY : y - 18) - 11;
        const handleX = x;
        return (
          <g
            transform={`translate(${handleX}, ${handleY})`}
            onPointerDown={onHandlePointerDown}
            style={{
              cursor: isDragging ? "grabbing" : "grab",
              touchAction: "none",
            }}
          >
            <rect
              x={-2}
              y={-2}
              width={18}
              height={18}
              rx={4}
              ry={4}
              fill="#ffffff"
              stroke="#0f172a"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
            <text
              x={7}
              y={11}
              fontSize={14}
              fontWeight={700}
              fill="#0f172a"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
              pointerEvents="none"
            >
              ⠿
            </text>
            <title>{t("led.report.canvas.dragScreen")}</title>
          </g>
        );
      })()}
      {/* Screen title — clickable to select on the canvas */}
      <text
        x={x + 22}
        y={screen.outputIndex != null ? titleY : y - 18}
        fontSize={13}
        fontWeight={600}
        fill="currentColor"
        style={{ cursor: "pointer" }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        {screen.name}
      </text>
      {screen.outputIndex != null && (
        <text
          x={x}
          y={subY}
          fontSize={11}
          fill="currentColor"
          opacity={0.7}
        >
          {screen.panelsWide}×{screen.panelsTall} · {m.pixelsX}×{m.pixelsY}px ·{" "}
          {formatAspectRatio(m.pixelsX, m.pixelsY)}
        </text>
      )}
      {screen.outputIndex == null && (
        <text x={x} y={y - 4} fontSize={11} fill="currentColor" opacity={0.7}>
          {screen.panelsWide}×{screen.panelsTall} · {m.pixelsX}×{m.pixelsY}px ·{" "}
          {formatAspectRatio(m.pixelsX, m.pixelsY)}
        </text>
      )}
      {/* Panel cells */}
      {cells}
      {/* Data-flow polyline overlay — drawn after the cells so it
          sits on top of the cell fills + labels, but before the
          outline / markers / selection halo below so it never hides
          interactive UI. */}
      {dataFlowPath}
      {/* Outline — also acts as the click-to-select target. We let the
          click bubble to the SVG only when we explicitly stop it from
          here on a real selection click; the empty-canvas SVG handler
          uses `e.target === e.currentTarget` to decide what to do. */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        // `transparent` (vs. `none`) keeps the outline visually empty
        // but makes the whole interior hit-testable, so the producer
        // can click anywhere on the screen — not just the 2px stroke —
        // to select it. The armed-mode marker overlay is drawn after
        // this rect, so it still wins clicks during marker placement.
        fill="transparent"
        stroke="#0f172a"
        strokeWidth={2}
        style={{ cursor: armed ? "crosshair" : "pointer" }}
        onClick={(e) => {
          // Marker-arm mode is handled by the dedicated overlay rect
          // above; this outline only triggers selection when no marker
          // placement is in flight.
          if (armed) return;
          e.stopPropagation();
          onSelect();
        }}
      />
      {/* Selection / drag halo — drawn last so it sits on top of cells
          and the outline. The pointerEvents=none keeps it from eating
          clicks meant for the outline / overlay underneath. */}
      {(isSelected || isDragging) && (
        <rect
          x={x - 4}
          y={y - 4}
          width={width + 8}
          height={height + 8}
          fill="none"
          stroke={isDragging ? "#f59e0b" : "#2563eb"}
          strokeWidth={3}
          strokeDasharray={isDragging ? "6 4" : undefined}
          pointerEvents="none"
        />
      )}
      {/* Click-target overlay for marker placement. Sits above cells but
          below the markers themselves so a click on an existing marker
          is captured by the marker (drag/delete) and a click anywhere
          else lands on this overlay. `pointerEvents` is toggled so the
          overlay is invisible to clicks unless the row is currently
          armed (+P or +S pressed) — keeps the visual passive by default. */}
      <rect
        ref={overlayRectRef}
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        pointerEvents={armed || isPaintTarget ? "all" : "none"}
        style={
          armed || isPaintTarget ? { cursor: "crosshair" } : undefined
        }
        onClick={handleOverlayClick}
        onPointerDown={handleOverlayPointerDown}
        onPointerMove={handleOverlayPointerMove}
        onPointerUp={handleOverlayPointerUp}
        onPointerCancel={handleOverlayPointerCancel}
      />
      {/* ── Power / Signal port-chain overlays ─────────────────────
          BOTH overlays are rendered for every screen and tagged with
          `data-paint-overlay="power|signal"`. Visibility is toggled
          by the current `paintMode` for the interactive canvas, but
          the always-present DOM nodes also let the Project PDF
          export clone the SVG and selectively show one overlay or
          the other without having to switch React state.
          Click-painting is restricted to the selected screen via
          `isPaintTarget` (see handleOverlayClick). */}
      {(() => {
        const minDim = Math.min(cellW, cellH);
        const arrowStrokeW = Math.max(0.8, minDim * 0.035);
        const circleR = minDim * 0.28;
        const labelFont = circleR * 1.15;
        const offCells = disabledCellSet(screen);
        const inBounds = (idx: number) => {
          if (idx < 0) return false;
          const c = idx % screen.panelsWide;
          const r = Math.floor(idx / screen.panelsWide);
          if (r >= screen.panelsTall) return false;
          return !isCellDisabled(offCells, c, r, screen.panelsWide);
        };
        const renderMap = (
          kind: "power" | "signal",
          map: LedPortMap | undefined,
        ) => {
          if (!map || map.ports.length === 0) return null;
          const nodes: React.ReactNode[] = [];
          for (const p of map.ports) {
          const validCells = p.cells.filter(inBounds);
          // Arrows between consecutive painted cells (chain order).
          // The arrows themselves are drawn in the port's selected
          // colour — the cabinet fill is left untouched so the panel
          // pattern underneath stays visible.
          for (let i = 0; i < validCells.length - 1; i++) {
            const ai = validCells[i];
            const bi = validCells[i + 1];
            const aCol = ai % screen.panelsWide;
            const aRow = Math.floor(ai / screen.panelsWide);
            const bCol = bi % screen.panelsWide;
            const bRow = Math.floor(bi / screen.panelsWide);
            const ax = x + (aCol + 0.5) * cellW;
            const ay = y + aRow * cellH + rowH(aRow) / 2;
            const bx = x + (bCol + 0.5) * cellW;
            const by = y + bRow * cellH + rowH(bRow) / 2;
            // Curved hop arc between consecutive cabinets — matches the
            // colourspace/Vectorworks cable-drawing style so a row of
            // hops reads as a row of little rainbows. The bow is
            // perpendicular to the segment, flipped so it always arcs
            // toward the top of the wall (negative-y side). Drawn in the
            // port's own colour so multiple chains stay distinct.
            const dx = bx - ax;
            const dy = by - ay;
            const segLen = Math.hypot(dx, dy) || 1;
            let nx = -dy / segLen;
            let ny = dx / segLen;
            if (ny > 0) {
              nx = -nx;
              ny = -ny;
            }
            const bow = Math.min(minDim * 0.5, segLen * 0.45);
            const ctrlX = (ax + bx) / 2 + nx * bow;
            const ctrlY = (ay + by) / 2 + ny * bow;
            nodes.push(
              <path
                key={`${p.id}-arc-${i}`}
                d={`M ${ax} ${ay} Q ${ctrlX} ${ctrlY} ${bx} ${by}`}
                fill="none"
                stroke={p.color}
                strokeWidth={arrowStrokeW}
                strokeLinecap="round"
                pointerEvents="none"
              />,
            );
            // Manual arrowhead at the destination, aligned to the arc's
            // tangent there (control point → end) so it sits flush with
            // the curve. Per-line fill lets each port keep its colour.
            const tx = bx - ctrlX;
            const ty = by - ctrlY;
            const len = Math.hypot(tx, ty) || 1;
            const ux = tx / len;
            const uy = ty / len;
            const tipX = bx;
            const tipY = by;
            const headLen = Math.max(3, minDim * 0.14);
            const headW = headLen * 0.7;
            const baseX = tipX - ux * headLen;
            const baseY = tipY - uy * headLen;
            const px = -uy;
            const py = ux;
            const p1x = baseX + px * (headW / 2);
            const p1y = baseY + py * (headW / 2);
            const p2x = baseX - px * (headW / 2);
            const p2y = baseY - py * (headW / 2);
            nodes.push(
              <polygon
                key={`${p.id}-head-${i}`}
                points={`${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`}
                fill={p.color}
                pointerEvents="none"
              />,
            );
          }
          // Numbered circle on the chain start so producers can
          // read "Port 1 starts here". Filled in the port colour with
          // a contrast-picked label for readability over any hue.
          if (validCells.length > 0) {
            const sIdx = validCells[0];
            const sCol = sIdx % screen.panelsWide;
            const sRow = Math.floor(sIdx / screen.panelsWide);
            const cx = x + (sCol + 0.5) * cellW;
            const cy = y + sRow * cellH + rowH(sRow) / 2;
            const labelInk = pickContrastInk(p.color);
            nodes.push(
              <g key={`${p.id}-circle`} pointerEvents="none">
                <circle
                  cx={cx}
                  cy={cy}
                  r={circleR}
                  fill={p.color}
                  stroke={labelInk}
                  strokeWidth={Math.max(1.2, circleR * 0.14)}
                />
                <text
                  x={cx}
                  y={cy}
                  fontSize={labelFont}
                  fontWeight={700}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={labelInk}
                  fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
                >
                  {p.label}
                </text>
              </g>,
            );
          }
          }
          return (
            <g
              key={kind}
              data-paint-overlay={kind}
              style={{ display: paintMode === kind ? "block" : "none" }}
            >
              {nodes}
            </g>
          );
        };
        return (
          <>
            {renderMap("power", screen.powerMap)}
            {renderMap("signal", screen.signalMap)}
          </>
        );
      })()}
      {/* Alignment test pattern — large inscribed circle + dashed
          corner X. Mirrors the PNG export so the producer sees live
          what will be on the exported image. */}
      {settings.showTestPattern && (() => {
        const r = Math.min(width, height) / 2 - Math.min(width, height) * 0.04;
        const stroke = Math.max(1, Math.min(width, height) * 0.004);
        const dash = stroke * 6;
        return (
          <g pointerEvents="none">
            <circle
              cx={x + width / 2}
              cy={y + height / 2}
              r={r}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.7}
              strokeWidth={stroke}
            />
            <line
              x1={x}
              y1={y}
              x2={x + width}
              y2={y + height}
              stroke="#ffffff"
              strokeOpacity={0.5}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${dash}`}
            />
            <line
              x1={x + width}
              y1={y}
              x2={x}
              y2={y + height}
              stroke="#ffffff"
              strokeOpacity={0.5}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${dash}`}
            />
          </g>
        );
      })()}
      {/* Logo overlay — uses the user's uploaded custom logo when set,
          otherwise the built-in EHS mark. Drag the logo to reposition
          it; `settings.logoX/Y` persist the new normalised position so
          the live canvas and PNG/PDF export stay in sync. */}
      {settings.showLogo && (() => {
        const aspect =
          settings.customLogoUrl && settings.customLogoAspect
            ? settings.customLogoAspect
            : 2.6;
        const scale = settings.logoScale ?? 1;
        const minDim = Math.min(width, height);
        const logoH = Math.max(16, minDim * 0.08) * scale;
        const logoW = logoH * aspect;
        const margin = Math.max(6, minDim * 0.018);
        // Effective normalised top-left: live drag pos while dragging,
        // else persisted settings, else default top-right anchor.
        const maxX = Math.max(0, 1 - logoW / width);
        const maxY = Math.max(0, 1 - logoH / height);
        const clamp = (v: number, hi: number) =>
          Math.min(hi, Math.max(0, v));
        const effX =
          logoDragPos !== null
            ? clamp(logoDragPos.x, maxX)
            : typeof settings.logoX === "number"
              ? clamp(settings.logoX, maxX)
              : (width - logoW - margin) / width;
        const effY =
          logoDragPos !== null
            ? clamp(logoDragPos.y, maxY)
            : typeof settings.logoY === "number"
              ? clamp(settings.logoY, maxY)
              : margin / height;
        const lx = x + effX * width;
        const ly = y + effY * height;
        const href = settings.customLogoUrl ?? ehsLogo;
        const commit = (pos: { x: number; y: number } | null) => {
          if (pos) {
            onUpdateSettings({
              logoX: clamp(pos.x, maxX),
              logoY: clamp(pos.y, maxY),
            });
          }
          setLogoDragPos(null);
          setIsDraggingLogo(false);
        };
        return (
          <g
            style={{ cursor: isDraggingLogo ? "grabbing" : "grab" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              const norm = eventToNorm(e);
              if (!norm) return;
              logoDragOffsetRef.current = {
                dx: norm.x - effX,
                dy: norm.y - effY,
              };
              logoDragMaxRef.current = { maxX, maxY };
              setLogoDragPos({ x: effX, y: effY });
              setIsDraggingLogo(true);
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Window-level fallback effect handles capture failures.
              }
            }}
            onPointerMove={(e) => {
              if (!isDraggingLogo) return;
              const norm = eventToNorm(e);
              if (!norm) return;
              const { dx, dy } = logoDragOffsetRef.current;
              setLogoDragPos({ x: norm.x - dx, y: norm.y - dy });
            }}
            onPointerUp={() => commit(logoDragPos)}
            onPointerCancel={() => commit(null)}
          >
            {/* Transparent hit rect slightly larger than the logo so
                producers don't have to click a transparent PNG pixel
                to start the drag. */}
            <rect
              x={lx - 4}
              y={ly - 4}
              width={logoW + 8}
              height={logoH + 8}
              fill="transparent"
            />
            <image
              href={href}
              x={lx}
              y={ly}
              width={logoW}
              height={logoH}
              preserveAspectRatio="xMidYMid meet"
              pointerEvents="none"
            />
          </g>
        );
      })()}
      {/* Bottom info bar — panels / resolution / aspect. Mirrors PNG. */}
      {settings.showInfoBar && (() => {
        const m = computeScreenMetrics(screen, panels);
        const gcd = (a: number, b: number): number =>
          b === 0 ? a : gcd(b, a % b);
        const g = gcd(m.pixelsX, m.pixelsY) || 1;
        const text = t("led.report.canvas.infoBar", {
          wide: screen.panelsWide,
          tall: screen.panelsTall,
          panels: m.panels,
          pixelsX: m.pixelsX,
          pixelsY: m.pixelsY,
          aspectX: m.pixelsX / g,
          aspectY: m.pixelsY / g,
        });
        const minDim = Math.min(width, height);
        const infoFont = Math.max(8, Math.min(20, minDim * 0.028));
        const padX = infoFont * 1.2;
        const padY = infoFont * 0.45;
        const approxTextW = text.length * infoFont * 0.5;
        const barW = Math.min(width * 0.96, approxTextW + padX * 2);
        const barH = infoFont + padY * 2;
        const bx = x + (width - barW) / 2;
        const by = y + height - barH - Math.max(4, minDim * 0.02);
        const radius = barH * 0.22;
        return (
          <g pointerEvents="none">
            <rect
              x={bx}
              y={by}
              width={barW}
              height={barH}
              rx={radius}
              ry={radius}
              fill="#1c1f24"
              fillOpacity={0.92}
            />
            <text
              x={x + width / 2}
              y={by + barH / 2}
              fontSize={infoFont}
              fill="#f5f6f7"
              fontWeight={500}
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
            >
              {text}
            </text>
          </g>
        );
      })()}
      {/* Centered "Main"/"IMAG" name pill — matches the PNG export so the
          user can preview what they'll get. Hidden if the user disabled
          the pill in Export options, or if there is no name. */}
      {settings.showScreenName && screen.name.trim().length > 0 && (() => {
        const name = screen.name;
        // Same shape as ledExport.ts: a built-in clamp times the
        // user-tunable per-screen scale. The clamp ceiling rises with
        // scale so 2× actually looks 2× bigger instead of capping at 36.
        const baseFont = Math.max(
          14,
          Math.min(36, Math.min(width, height) * 0.08),
        );
        const scale = clampNameScale(screen.nameScale);
        const pillFont = baseFont * scale;
        // Pill geometry uses the shared PILL_*_RATIO constants so the
        // live preview and the exported PNG always agree on the shape
        // (the base font is different by design — see led.ts).
        const padX = pillFont * PILL_PAD_X_RATIO;
        const padY = pillFont * PILL_PAD_Y_RATIO;
        const textW = name.length * pillFont * PILL_CHAR_W_RATIO;
        const pillW = textW + padX * 2;
        const pillH = pillFont + padY * 2;
        const cx = x + width / 2;
        const cy = y + height / 2;
        return (
          <g pointerEvents="none">
            <rect
              x={cx - pillW / 2}
              y={cy - pillH / 2}
              width={pillW}
              height={pillH}
              rx={pillH / 2}
              ry={pillH / 2}
              fill="#ffffff"
              stroke="#0f172a"
              strokeWidth={2}
              opacity={0.95}
            />
            <text
              x={cx}
              y={cy}
              fontSize={pillFont}
              fontWeight={700}
              fill="#0f172a"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
            >
              {name}
            </text>
          </g>
        );
      })()}
      {/* Producer-drawn power / signal markers. Rendered last so they
          sit on top of the cells, outline, click overlay, and pill —
          matches the PNG export's z-order. */}
      {markers.length > 0 && (() => {
        const markerR = Math.max(8, Math.min(width, height) * 0.04);
        return markers.map((mk) => {
          const cx = x + Math.min(1, Math.max(0, mk.x)) * width;
          const cy = y + Math.min(1, Math.max(0, mk.y)) * height;
          const fill = mk.kind === "power" ? "#dc2626" : "#2563eb";
          const isDragging = draggingMarkerId === mk.id;
          const fontSize = markerR * 1.05;
          const label = `${mk.kind === "power" ? "P" : "S"}${mk.index}`;
          return (
            <g
              key={mk.id}
              data-marker-kind={mk.kind}
              onPointerDown={handleMarkerPointerDown(mk.id)}
              onPointerMove={handleMarkerPointerMove(mk.id)}
              onPointerUp={handleMarkerPointerUp}
              onPointerCancel={handleMarkerPointerUp}
              onContextMenu={handleMarkerContextMenu(mk.id)}
              style={{
                cursor: isDragging ? "grabbing" : "grab",
                touchAction: "none",
              }}
            >
              {/* Drop-shadow disc — keeps the marker visible on bright
                  cabinets and white test patterns. */}
              <circle
                cx={cx + markerR * 0.06}
                cy={cy + markerR * 0.06}
                r={markerR}
                fill="#000"
                fillOpacity={0.35}
                pointerEvents="none"
              />
              <circle
                cx={cx}
                cy={cy}
                r={markerR}
                fill={fill}
                stroke="#ffffff"
                strokeWidth={Math.max(1.5, markerR * 0.14)}
              />
              <text
                x={cx}
                y={cy}
                fontSize={fontSize}
                fontWeight={700}
                fill="#ffffff"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
                pointerEvents="none"
              >
                {label}
              </text>
              {/* Hover/touch hint — reveals what the marker means and
                  how to remove it without cluttering the always-on
                  visual. */}
              <title>
                {t("led.report.canvas.markerTitle", {
                  kind: t(mk.kind === "power"
                    ? "led.report.power"
                    : "led.report.signal"),
                  index: mk.index,
                })}
              </title>
            </g>
          );
        });
      })()}
      {/* Cell-anchored panel markers (T004). Drawn as a rounded badge
          tucked into the top-left corner of the chosen cell so the
          producer can tell at a glance "this panel takes a power feed"
          or "data lands at this panel". Click to remove. */}
      {panelMarkers.length > 0 && (() => {
        const badgeSide = Math.max(10, Math.min(cellW, cellH) * 0.42);
        return panelMarkers.map((mk) => {
          if (
            mk.col < 0 ||
            mk.col >= screen.panelsWide ||
            mk.row < 0 ||
            mk.row >= screen.panelsTall
          ) {
            return null;
          }
          const cellX = x + mk.col * cellW;
          const cellY = y + mk.row * cellH;
          // Inset 6% from the top-left so the badge doesn't fight the
          // cell's stroke. Clamp the inset to a sane minimum for tiny
          // cells.
          const inset = Math.max(2, Math.min(cellW, cellH) * 0.06);
          const bx = cellX + inset;
          const by = cellY + inset;
          const fill = mk.kind === "power" ? "#dc2626" : "#2563eb";
          const fontSize = badgeSide * 0.55;
          const label = `${mk.kind === "power" ? "P" : "S"}${mk.index}`;
          return (
            <g
              key={mk.id}
              data-marker-kind={mk.kind}
              style={{ cursor: "pointer" }}
              onClick={(e) => {
                e.stopPropagation();
                onRemovePanelMarker(screenId, mk.id);
              }}
            >
              <rect
                x={bx + badgeSide * 0.06}
                y={by + badgeSide * 0.06}
                width={badgeSide}
                height={badgeSide}
                rx={badgeSide * 0.18}
                ry={badgeSide * 0.18}
                fill="#000"
                fillOpacity={0.35}
                pointerEvents="none"
              />
              <rect
                x={bx}
                y={by}
                width={badgeSide}
                height={badgeSide}
                rx={badgeSide * 0.18}
                ry={badgeSide * 0.18}
                fill={fill}
                stroke="#ffffff"
                strokeWidth={Math.max(1.5, badgeSide * 0.1)}
              />
              <text
                x={bx + badgeSide / 2}
                y={by + badgeSide / 2}
                fontSize={fontSize}
                fontWeight={700}
                fill="#ffffff"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
                pointerEvents="none"
              >
                {label}
              </text>
              <title>
                {t("led.report.canvas.feedTitle", {
                  kind: t(mk.kind === "power"
                    ? "led.report.power"
                    : "led.report.signal"),
                  row: mk.row + 1,
                  col: mk.col + 1,
                })}
              </title>
            </g>
          );
        });
      })()}
      {/* "Painted" badges — passive indicators showing whether this
          screen already has a power map and/or signal map with at
          least one port carrying cells. Rendered for every screen in
          both Basic and Advanced modes so producers can see at a
          glance which screens are cabled without opening the paint
          toolbar. Sits in the top-right corner inside the screen so
          it doesn't fight the title / output badge above. */}
      {(() => {
        const powerPorts = (screen.powerMap?.ports ?? []).filter(
          (p) => p.cells.length > 0,
        );
        const signalPorts = (screen.signalMap?.ports ?? []).filter(
          (p) => p.cells.length > 0,
        );
        const hasPower = powerPorts.length > 0;
        const hasSignal = signalPorts.length > 0;
        if (!hasPower && !hasSignal) return null;
        const badgeR = Math.max(8, Math.min(16, Math.min(cellW, cellH) * 0.22));
        const pad = badgeR * 0.5;
        const gap = badgeR * 0.5;
        type Item = {
          key: "power" | "signal";
          icon: string;
          color: string;
          title: string;
        };
        const items: Item[] = [];
        if (hasPower) {
          const cables = powerPorts.reduce((n, p) => n + p.cells.length, 0);
          items.push({
            key: "power",
            icon: "⚡",
            color: "#f59e0b",
            title: t("led.report.canvas.mapSummary", {
              kind: t("led.report.power"),
              ports: powerPorts.length,
              cables,
            }),
          });
        }
        if (hasSignal) {
          const cables = signalPorts.reduce((n, p) => n + p.cells.length, 0);
          items.push({
            key: "signal",
            icon: "⇄",
            color: "#2563eb",
            title: t("led.report.canvas.mapSummary", {
              kind: t("led.report.signal"),
              ports: signalPorts.length,
              cables,
            }),
          });
        }
        const count = items.length;
        const totalW = count * (badgeR * 2) + (count - 1) * gap;
        const startCx = x + width - pad - totalW + badgeR;
        const cy = y + pad + badgeR;
        return (
          <g>
            {items.map((it, i) => {
              const cx = startCx + i * (badgeR * 2 + gap);
              return (
                <g key={it.key} data-painted-badge={it.key}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={badgeR}
                    fill="#ffffff"
                    stroke={it.color}
                    strokeWidth={1.5}
                    opacity={0.95}
                  />
                  <text
                    x={cx}
                    y={cy}
                    fontSize={badgeR * 1.25}
                    fontWeight={700}
                    fill={it.color}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontFamily="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
                    pointerEvents="none"
                  >
                    {it.icon}
                  </text>
                  <title>{it.title}</title>
                </g>
              );
            })}
          </g>
        );
      })()}
    </g>
  );
}

/** Small popover anchored to the row's "Shape…" button. Producer types
 *  the target physical width/height (m) and presses Apply to resize the
 *  panel grid by panel pitch, OR clicks a template chip (L/U/T/+/...)
 *  to fill the screen's `disabledCells` for that shape. The "Reset
 *  panel ON/OFF" checkbox controls whether the build-by-size action
 *  also wipes the current cell pattern (so producers don't accidentally
 *  blow away a hand-edited shape when they re-target the size). */
function ShapePopover({
  currentWidthM,
  currentHeightM,
  targetW,
  targetH,
  setTargetW,
  setTargetH,
  clearShapeOnApply,
  setClearShapeOnApply,
  onApplyBuildBySize,
  onApplyTemplate,
  onClose,
}: {
  currentWidthM: number;
  currentHeightM: number;
  targetW: string;
  targetH: string;
  setTargetW: (v: string) => void;
  setTargetH: (v: string) => void;
  clearShapeOnApply: boolean;
  setClearShapeOnApply: (v: boolean) => void;
  onApplyBuildBySize: () => void;
  onApplyTemplate: (template: LedShapeTemplate) => void;
  onClose: () => void;
}) {
  const t = useT();
  const shapeKeys: Record<LedShapeTemplate, {
    label: TranslationKey;
    description: TranslationKey;
  }> = {
    rectangle: {
      label: "led.report.shape.rectangle",
      description: "led.report.shape.rectangleDescription",
    },
    "l-shape": {
      label: "led.report.shape.lShape",
      description: "led.report.shape.lShapeDescription",
    },
    "u-shape": {
      label: "led.report.shape.uShape",
      description: "led.report.shape.uShapeDescription",
    },
    "t-shape": {
      label: "led.report.shape.tShape",
      description: "led.report.shape.tShapeDescription",
    },
    plus: {
      label: "led.report.shape.plus",
      description: "led.report.shape.plusDescription",
    },
    stairs: {
      label: "led.report.shape.stairs",
      description: "led.report.shape.stairsDescription",
    },
    ribbon: {
      label: "led.report.shape.ribbon",
      description: "led.report.shape.ribbonDescription",
    },
    columns: {
      label: "led.report.shape.columns",
      description: "led.report.shape.columnsDescription",
    },
  };
  return (
    <div
      className="led-shape-popover"
      role="dialog"
      aria-label={t("led.report.shape.dialogAria")}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="led-shape-popover-head">
        <strong>{t("led.report.shape.buildBySize")}</strong>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={onClose}
          title={t("common.close")}
        >
          ×
        </button>
      </div>
      <div className="led-shape-popover-body">
        <div className="led-shape-current">
          {t("led.report.shape.current", {
            width: currentWidthM.toFixed(2),
            height: currentHeightM.toFixed(2),
          })}
        </div>
        <div className="led-shape-build-grid">
          <label>
            {t("led.report.shape.targetWidth")}
            <input
              className="led-input led-input-num"
              type="number"
              min={0.1}
              step={0.1}
              value={targetW}
              onChange={(e) => setTargetW(e.target.value)}
            />
          </label>
          <label>
            {t("led.report.shape.targetHeight")}
            <input
              className="led-input led-input-num"
              type="number"
              min={0.1}
              step={0.1}
              value={targetH}
              onChange={(e) => setTargetH(e.target.value)}
            />
          </label>
        </div>
        <label className="led-shape-checkbox">
          <input
            type="checkbox"
            checked={clearShapeOnApply}
            onChange={(e) => setClearShapeOnApply(e.target.checked)}
          />
          {t("led.report.shape.resetOnApply")}
        </label>
        <div className="led-shape-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              onApplyBuildBySize();
              onClose();
            }}
          >
            {t("led.report.shape.applySize")}
          </button>
        </div>
      </div>
      <div className="led-shape-popover-divider" />
      <div className="led-shape-popover-body">
        <strong>{t("led.report.shape.templates")}</strong>
        <div className="led-shape-chips">
          {LED_SHAPE_TEMPLATE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="btn btn-ghost btn-xs led-shape-chip"
              title={t(shapeKeys[opt.value].description)}
              onClick={() => {
                onApplyTemplate(opt.value);
              }}
            >
              {t(shapeKeys[opt.value].label)}
            </button>
          ))}
        </div>
        <div className="led-shape-hint">
          {t("led.report.shape.hintBefore")}{" "}
          <em>{t("common.edit")}</em> {t("led.report.shape.hintAfter")}
        </div>
      </div>
    </div>
  );
}

/** Per-screen processors strip. Renders an "Add processor" picker plus
 *  a chip per attached processor (with × to remove), and a small
 *  capacity readout — outputs / max pixels combined, vs the screen's
 *  required pixel count. Producer sees a red "Under capacity" pill if
 *  the screen exceeds the attached processors' combined cap. */
function ProcessorsStrip({
  processors,
  requiredPixels,
  cap,
  isUnder,
  onAdd,
  onRemove,
}: {
  processors: LedScreenProcessor[];
  requiredPixels: number;
  cap: ScreenProcessorCapacity;
  isUnder: boolean;
  onAdd: (model: NovastarProcessorModel) => void;
  onRemove: (processorId: string) => void;
}) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const hasAny = processors.length > 0;
  return (
    <div className="led-procs-strip">
      <div className="led-procs-strip-label">{t("led.report.processors")}:</div>
      <div className="led-procs-strip-chips">
        {processors.map((p) => {
          const spec = NOVASTAR_PROCESSOR_CATALOG[p.model];
          return (
            <span key={p.id} className="led-procs-chip" title={spec?.name}>
              <strong>{spec?.name ?? p.model}</strong>
              <button
                type="button"
                className="led-procs-chip-x"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(p.id);
                }}
                aria-label={t("led.report.processor.removeNamed", {
                  name: spec?.name ?? p.model,
                })}
                title={t("common.remove")}
              >
                ×
              </button>
            </span>
          );
        })}
        <div className="led-procs-add">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen((v) => !v);
            }}
            title={t("led.report.processor.attachTitle")}
          >
            + {t("common.add")}
          </button>
          {pickerOpen && (
            <div
              className="led-procs-picker"
              onClick={(e) => e.stopPropagation()}
            >
              {NOVASTAR_PROCESSOR_OPTIONS.map((opt) => (
                <button
                  key={opt.model}
                  type="button"
                  className="led-procs-picker-item"
                  onClick={() => {
                    onAdd(opt.model);
                    setPickerOpen(false);
                  }}
                  title={NOVASTAR_PROCESSOR_CATALOG[opt.model].name}
                >
                  {opt.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {hasAny && (
        <div
          className={`led-procs-cap ${isUnder ? "is-under" : ""}`}
          title={t("led.report.processor.capacityTitle")}
        >
          {t("led.report.processor.capacity", {
            outputs: cap.outputs,
            capacity: PIXEL_FMT.format(cap.maxPixels),
            needed: PIXEL_FMT.format(requiredPixels),
          })}
          {isUnder && (
            <span className="led-procs-under-pill">
              {t("led.report.processor.underCapacity")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Cable & bracket bill-of-materials card. Lists per-screen the signal
 *  and TrueOne power jumper count + total length, plus the bracket name
 *  × cabinet count. A totals row at the bottom sums every screen so the
 *  producer can pull-list cables and brackets in one glance. */
function CableBracketBomCard({
  screens,
  panels,
  beamCatalog,
}: {
  screens: LedScreen[];
  panels: LedPanel[];
  beamCatalog: LedRigAccessoryCatalogItem[];
}) {
  const t = useT();
  const rows = screens.map((s) => {
    const bom = computeScreenCableBOM(s, panels, beamCatalog);
    return { screen: s, bom };
  });
  const totalSignalCables = rows.reduce(
    (sum, r) => sum + r.bom.signalCables,
    0,
  );
  const totalSignalLengthM = rows.reduce(
    (sum, r) => sum + r.bom.signalLengthM,
    0,
  );
  const totalPowerCables = rows.reduce(
    (sum, r) => sum + r.bom.powerCables,
    0,
  );
  const totalPowerLengthM = rows.reduce(
    (sum, r) => sum + r.bom.powerLengthM,
    0,
  );
  // Aggregate brackets by name across all screens so the producer sees
  // "ProBracket × 18" once instead of one entry per screen.
  const bracketTotals = new Map<string, number>();
  for (const r of rows) {
    for (const b of r.bom.brackets) {
      bracketTotals.set(b.name, (bracketTotals.get(b.name) ?? 0) + b.count);
    }
  }
  const totalBrackets = Array.from(bracketTotals.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="led-bom-card">
      <header className="led-bom-head">
        <h3>{t("led.report.bom.title")}</h3>
        <span className="led-bom-sub">
          {t("led.report.bom.subtitle", {
            signalLength: SIGNAL_CABLE_LENGTH_M.toFixed(2),
            powerLength: POWER_TRUE1_CABLE_LENGTH_M.toFixed(2),
          })}
        </span>
      </header>
      <div className="led-bom-table-wrap">
        <table className="led-table led-bom-table">
          <thead>
            <tr>
              <th>{t("led.report.screen")}</th>
              <th className="led-num">{t("led.report.signal")}</th>
              <th className="led-num">{t("led.report.bom.powerTrueOne")}</th>
              <th>{t("led.report.bom.brackets")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ screen, bom }) => (
              <tr key={screen.id}>
                <td>{screen.name || t("led.report.unnamed")}</td>
                <td className="led-num">
                  {bom.signalCables} ×{" "}
                  <span className="led-sub">
                    {bom.signalLengthM.toFixed(2)} m
                  </span>
                </td>
                <td className="led-num">
                  {bom.powerCables} ×{" "}
                  <span className="led-sub">
                    {bom.powerLengthM.toFixed(2)} m
                  </span>
                </td>
                <td>
                  {bom.brackets.length === 0 ? (
                    <span className="led-sub">—</span>
                  ) : (
                    bom.brackets.map((b) => (
                      <span
                        key={b.name}
                        className={`led-bom-bracket ${
                          bom.bracketsUnset ? "is-unset" : ""
                        }`}
                      >
                        {b.name} × {b.count}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>{t("led.report.totals")}</strong>
              </td>
              <td className="led-num">
                <strong>{totalSignalCables}</strong>{" "}
                <span className="led-sub">
                  ({totalSignalLengthM.toFixed(2)} m)
                </span>
              </td>
              <td className="led-num">
                <strong>{totalPowerCables}</strong>{" "}
                <span className="led-sub">
                  ({totalPowerLengthM.toFixed(2)} m)
                </span>
              </td>
              <td>
                {totalBrackets.length === 0 ? (
                  <span className="led-sub">—</span>
                ) : (
                  totalBrackets.map((b) => (
                    <span key={b.name} className="led-bom-bracket">
                      <strong>{b.name}</strong> × {b.count}
                    </span>
                  ))
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** Inline 3-phase power balancer.
 *
 *  Splits each screen's total wattage evenly across L1 / L2 / L3 and
 *  shows the resulting amps per phase at the user-configured mains
 *  voltage. It's a planning-grade tool — it doesn't model per-cabinet
 *  power-feed wiring (which is captured by the cabinet "P" markers
 *  already), but it does give the producer a quick "do I need a 32 A
 *  3-phase or a 16 A 3-phase feed?" answer per screen.
 *
 *  Aggregated totals (sum across all screens, balanced split) sit in
 *  the footer so a multi-screen build still answers the same question
 *  at the rig level.
 *
 *  Empty / no-cabinet screens are skipped to keep the table readable.
 */
function PowerBalancerCard({
  screens,
  panels,
  mainsVoltage,
  onMainsVoltageChange,
}: {
  screens: LedScreen[];
  panels: LedPanel[];
  mainsVoltage: number;
  onMainsVoltageChange: (v: number) => void;
}) {
  const t = useT();
  // Defensive — settings can be momentarily 0 if a user is mid-edit.
  // Falling back to 230 keeps the table sane until they finish typing.
  const voltage = mainsVoltage > 0 ? mainsVoltage : 230;
  const rows = screens.map((screen) => {
    const m = computeScreenMetrics(screen, panels);
    const perPhaseW = m.powerW / 3;
    const perPhaseA = perPhaseW / voltage;
    return {
      id: screen.id,
      name: screen.name || "—",
      powerW: m.powerW,
      perPhaseW,
      perPhaseA,
    };
  });
  const totalW = rows.reduce((acc, r) => acc + r.powerW, 0);
  const totalPerPhaseW = totalW / 3;
  const totalPerPhaseA = totalPerPhaseW / voltage;
  return (
    <section className="led-card">
      <div className="led-card-head">
        <h3>{t("led.report.powerBalancer.title")}</h3>
        <span className="led-hint">
          {t("led.report.powerBalancer.subtitle")}
        </span>
      </div>
      <div className="led-card-body">
        <div
          className="led-rotation-row"
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}
        >
          <label className="led-sub" style={{ whiteSpace: "nowrap" }}>
            {t("led.report.powerBalancer.mainsVoltage")}
          </label>
          <input
            className="led-input led-input-num"
            type="number"
            min={50}
            max={500}
            step={1}
            style={{ width: 80 }}
            value={mainsVoltage}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= 50 && n <= 500) {
                onMainsVoltageChange(n);
              }
            }}
            title={t("led.report.powerBalancer.voltageTitle")}
          />
          <span className="led-sub">V</span>
        </div>
        <table className="led-table led-table-compact">
          <thead>
            <tr>
              <th>{t("led.report.screen")}</th>
              <th className="led-num">{t("led.report.powerBalancer.totalPower")}</th>
              <th className="led-num">L1</th>
              <th className="led-num">L2</th>
              <th className="led-num">L3</th>
              <th className="led-num">{t("led.report.powerBalancer.ampsPerPhase")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="led-sub">
                  {t("led.report.powerBalancer.empty")}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="led-num">{fmt(r.powerW, 0)} W</td>
                  <td className="led-num">{fmt(r.perPhaseW, 0)} W</td>
                  <td className="led-num">{fmt(r.perPhaseW, 0)} W</td>
                  <td className="led-num">{fmt(r.perPhaseW, 0)} W</td>
                  <td className="led-num">
                    <strong>{fmt(r.perPhaseA, 1)} A</strong>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td>
                <strong>{t("led.report.totals")}</strong>
              </td>
              <td className="led-num">
                <strong>{fmt(totalW, 0)} W</strong>
              </td>
              <td className="led-num">{fmt(totalPerPhaseW, 0)} W</td>
              <td className="led-num">{fmt(totalPerPhaseW, 0)} W</td>
              <td className="led-num">{fmt(totalPerPhaseW, 0)} W</td>
              <td className="led-num">
                <strong>{fmt(totalPerPhaseA, 1)} A</strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/** Single arrow centered at (cx, cy), drawn as a stroke + filled arrowhead.
 *  Direction-agnostic so the same component handles up / down / left /
 *  right for the per-cell data-flow indicators. */
function CellArrow({
  cx,
  cy,
  size,
  stroke,
  dir,
}: {
  cx: number;
  cy: number;
  size: number;
  stroke: number;
  dir: Exclude<CellArrowDir, null>;
}) {
  // Compute the line endpoints and the polygon for the arrowhead.
  const half = size / 2;
  const head = size * 0.55;
  let x1 = cx;
  let y1 = cy;
  let x2 = cx;
  let y2 = cy;
  let p1x = 0;
  let p1y = 0;
  let p2x = 0;
  let p2y = 0;
  if (dir === "right") {
    x1 = cx - half;
    x2 = cx + half;
    y1 = y2 = cy;
    p1x = x2 - head;
    p1y = cy - head * 0.6;
    p2x = x2 - head;
    p2y = cy + head * 0.6;
  } else if (dir === "left") {
    x1 = cx + half;
    x2 = cx - half;
    y1 = y2 = cy;
    p1x = x2 + head;
    p1y = cy - head * 0.6;
    p2x = x2 + head;
    p2y = cy + head * 0.6;
  } else if (dir === "down") {
    y1 = cy - half;
    y2 = cy + half;
    x1 = x2 = cx;
    p1x = cx - head * 0.6;
    p1y = y2 - head;
    p2x = cx + head * 0.6;
    p2y = y2 - head;
  } else {
    // up
    y1 = cy + half;
    y2 = cy - half;
    x1 = x2 = cx;
    p1x = cx - head * 0.6;
    p1y = y2 + head;
    p2x = cx + head * 0.6;
    p2y = y2 + head;
  }
  return (
    <g pointerEvents="none">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="#0a0a0a"
        strokeOpacity={0.9}
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <polygon
        points={`${x2},${y2} ${p1x},${p1y} ${p2x},${p2y}`}
        fill="#0a0a0a"
        fillOpacity={0.9}
      />
    </g>
  );
}

function ExportOptions({
  settings,
  onUpdateSettings,
}: {
  settings: LedSettings;
  onUpdateSettings: (patch: Partial<LedSettings>) => void;
}) {
  const t = useT();
  const overlayLabelKeys: Record<
    | "showLabels"
    | "showArrows"
    | "showCabinetIds"
    | "showDataFlowPath"
    | "showTestPattern"
    | "showScreenName"
    | "showInfoBar",
    TranslationKey
  > = {
    showLabels: "led.report.export.panelLabels",
    showArrows: "led.report.export.dataFlowArrows",
    showCabinetIds: "led.report.export.cabinetBadges",
    showDataFlowPath: "led.report.export.dataFlowPath",
    showTestPattern: "led.report.export.testPattern",
    showScreenName: "led.report.export.screenNamePill",
    showInfoBar: "led.report.export.infoBar",
  };
  const panelPresetLabelKeys: Record<string, TranslationKey> = {
    Blue: "led.report.color.blue",
    Red: "led.report.color.red",
    "Red + Blue": "led.report.color.redBlue",
    Green: "led.report.color.green",
    Purple: "led.report.color.purple",
    Orange: "led.report.color.orange",
    Teal: "led.report.color.teal",
    Mono: "led.report.color.mono",
  };
  const [open, setOpen] = useState(false);
  return (
    <section className={`led-card led-export-card ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="led-export-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="led-export-header-main">
          <span className="led-export-header-icon" aria-hidden="true">
            ⚙
          </span>
          <span className="led-export-header-text">
            <span className="led-export-header-title">
              {t("led.report.export.title")}
            </span>
            <span className="led-export-header-sub">
              {t("led.report.export.subtitle")}
            </span>
          </span>
        </span>
        <span className="led-export-header-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="led-export-body">
          {/* ── Group 1: Output & wiring ───────────────────────────── */}
          <div className="led-export-group">
            <div className="led-export-group-head">
              <span className="led-export-group-title">{t("led.report.export.outputWiring")}</span>
              <span className="led-export-group-hint">
                {t("led.report.export.outputWiringHint")}
              </span>
            </div>
            <div className="led-export-fields">
              <label className="led-field">
                <span className="led-field-label">{t("led.report.export.outputMode")}</span>
                <select
                  className="led-input"
                  value={settings.outputMode}
                  onChange={(e) =>
                    onUpdateSettings({
                      outputMode: e.target.value as LedSettings["outputMode"],
                    })
                  }
                >
                  <option value="per-screen">{t("led.report.export.onePerScreen")}</option>
                  <option value="per-row">{t("led.report.export.onePerRow")}</option>
                </select>
              </label>

              <label className="led-field">
                <span className="led-field-label">{t("led.report.export.pixelsPerOutput")}</span>
                <NumberField
                  className="led-input"
                  min={1000}
                  step={1000}
                  disabled={settings.outputMode !== "per-screen"}
                  value={settings.portLimit}
                  transform={(n) => Math.max(1000, n || 1000)}
                  emptyValue={1000}
                  onCommit={(portLimit) =>
                    onUpdateSettings({ portLimit })
                  }
                />
              </label>

              <label className="led-field">
                <span className="led-field-label">{t("led.report.export.wirePath")}</span>
                <select
                  className="led-input"
                  value={settings.wirePath}
                  onChange={(e) =>
                    onUpdateSettings({
                      wirePath: e.target.value as LedSettings["wirePath"],
                    })
                  }
                >
                  <option value="linear">{t("led.report.export.linear")}</option>
                  <option value="serpentine">
                    {t("led.report.export.serpentine")}
                  </option>
                  <option value="column-serpentine">
                    {t("led.report.export.columnSnake")}
                  </option>
                </select>
              </label>

              <label className="led-field">
                <span className="led-field-label">{t("led.report.processor.label")}</span>
                <select
                  className="led-input"
                  value={settings.processorId ?? ""}
                  onChange={(e) =>
                    onUpdateSettings({
                      processorId:
                        e.target.value === "" ? null : e.target.value,
                    })
                  }
                >
                  <option value="">— {t("led.report.export.noProcessor")} —</option>
                  {LED_PROCESSORS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* ── Group 2: Visual overlays ───────────────────────────── */}
          <div className="led-export-group">
            <div className="led-export-group-head">
              <span className="led-export-group-title">{t("led.report.export.visualOverlays")}</span>
              <span className="led-export-group-hint">
                {t("led.report.export.visualOverlaysHint")}
              </span>
            </div>
            <div className="led-export-toggles">
              {(
                [
                  ["showLabels", t(overlayLabelKeys.showLabels)],
                  ["showArrows", t(overlayLabelKeys.showArrows)],
                  ["showCabinetIds", t(overlayLabelKeys.showCabinetIds)],
                  ["showDataFlowPath", t(overlayLabelKeys.showDataFlowPath)],
                  ["showTestPattern", t(overlayLabelKeys.showTestPattern)],
                  ["showScreenName", t(overlayLabelKeys.showScreenName)],
                  ["showInfoBar", t(overlayLabelKeys.showInfoBar)],
                  ["showLogo", settings.customLogoUrl
                    ? t("led.report.export.customLogo")
                    : t("led.report.export.ehsLogo")],
                ] as const
              ).map(([key, label]) => {
                const checked = Boolean(settings[key]);
                return (
                  <label
                    key={key}
                    className={`led-toggle-card ${checked ? "is-on" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        onUpdateSettings({
                          [key]: e.target.checked,
                        } as Partial<LedSettings>)
                      }
                    />
                    <span className="led-toggle-card-text">{label}</span>
                    <span
                      className="led-toggle-card-pill"
                      aria-hidden="true"
                    >
                      {t(checked ? "led.report.on" : "led.report.off")}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ── Group 2.5: Custom logo ───────────────────────────── */}
          <div className="led-export-group">
            <div className="led-export-group-head">
              <span className="led-export-group-title">{t("led.report.export.logo")}</span>
              <span className="led-export-group-hint">
                {t("led.report.export.logoHint")}
              </span>
            </div>
            <div
              className="led-export-look"
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 12,
              }}
            >
              <label className="led-btn led-btn-secondary" style={{ cursor: "pointer" }}>
                {t(settings.customLogoUrl
                  ? "led.report.export.replaceLogo"
                  : "led.report.export.uploadLogo")}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Reset the input so re-selecting the same file
                    // still fires onChange.
                    e.target.value = "";
                    if (!file) return;
                    if (file.size > 4 * 1024 * 1024) {
                      window.alert(
                        t("led.report.export.logoTooLarge"),
                      );
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = String(reader.result ?? "");
                      if (!dataUrl.startsWith("data:image/")) return;
                      // Decode to capture aspect ratio so the canvas
                      // and export keep the logo's true proportions.
                      const img = new Image();
                      img.onload = () => {
                        const aspect =
                          img.naturalWidth > 0 && img.naturalHeight > 0
                            ? img.naturalWidth / img.naturalHeight
                            : 2.6;
                        onUpdateSettings({
                          customLogoUrl: dataUrl,
                          customLogoAspect: aspect,
                          showLogo: true,
                        });
                      };
                      img.onerror = () => {
                        onUpdateSettings({
                          customLogoUrl: dataUrl,
                          customLogoAspect: 2.6,
                          showLogo: true,
                        });
                      };
                      img.src = dataUrl;
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {settings.customLogoUrl && (
                <button
                  type="button"
                  className="led-btn led-btn-secondary"
                  onClick={() =>
                    onUpdateSettings({
                      customLogoUrl: null,
                      customLogoAspect: undefined,
                    })
                  }
                  title={t("led.report.export.useEhsTitle")}
                >
                  {t("led.report.export.useEhs")}
                </button>
              )}
              <button
                type="button"
                className="led-btn led-btn-secondary"
                onClick={() =>
                  onUpdateSettings({
                    logoX: undefined,
                    logoY: undefined,
                    logoScale: undefined,
                  })
                }
                title={t("led.report.export.resetLogoTitle")}
                disabled={
                  settings.logoX === undefined &&
                  settings.logoY === undefined &&
                  settings.logoScale === undefined
                }
              >
                {t("led.report.export.resetLogo")}
              </button>
              <label
                className="led-field"
                style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 220 }}
              >
                <span className="led-field-label" style={{ whiteSpace: "nowrap" }}>
                  {t("led.report.export.logoSize", {
                    percent: Math.round((settings.logoScale ?? 1) * 100),
                  })}
                </span>
                <input
                  type="range"
                  min={0.3}
                  max={3}
                  step={0.05}
                  value={settings.logoScale ?? 1}
                  onChange={(e) =>
                    onUpdateSettings({ logoScale: Number(e.target.value) })
                  }
                  style={{ flex: 1 }}
                />
              </label>
              {settings.customLogoUrl && (
                <img
                  src={settings.customLogoUrl}
                  alt={t("led.report.export.logoPreview")}
                  style={{
                    height: 36,
                    maxWidth: 120,
                    objectFit: "contain",
                    background: "var(--surface-soft, #f5f6f7)",
                    border: "1px solid var(--border, #d0d4d9)",
                    borderRadius: 4,
                    padding: 4,
                  }}
                />
              )}
            </div>
          </div>

          {/* ── Group 3: Look &amp; feel ───────────────────────────── */}
          <div className="led-export-group">
            <div className="led-export-group-head">
              <span className="led-export-group-title">{t("led.report.export.lookFeel")}</span>
              <span className="led-export-group-hint">
                {t("led.report.export.lookFeelHint")}
              </span>
            </div>

            <div className="led-export-look">
              <label className="led-field">
                <span className="led-field-label">{t("led.report.export.panelPattern")}</span>
                <select
                  className="led-input"
                  value={settings.panelPattern}
                  onChange={(e) =>
                    onUpdateSettings({
                      panelPattern: e.target.value as LedPanelPattern,
                    })
                  }
                >
                  <option value="checker">
                    {t("led.report.export.checkerboard")}
                  </option>
                  <option value="columns">{t("led.report.export.verticalStripes")}</option>
                </select>
              </label>

              <div className="led-field">
                <span className="led-field-label">{t("led.report.export.panelColors")}</span>
                <div className="led-color-pair-row">
                  <label className="led-color-input">
                    <input
                      type="color"
                      value={settings.panelColorDark}
                      onChange={(e) =>
                        onUpdateSettings({ panelColorDark: e.target.value })
                      }
                      aria-label={t("led.report.export.darkColorAria")}
                    />
                    <span>{t("led.report.export.dark")}</span>
                  </label>
                  <label className="led-color-input">
                    <input
                      type="color"
                      value={settings.panelColorLight}
                      onChange={(e) =>
                        onUpdateSettings({ panelColorLight: e.target.value })
                      }
                      aria-label={t("led.report.export.lightColorAria")}
                    />
                    <span>{t("led.report.export.light")}</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="led-export-presets">
              <span className="led-export-presets-label">{t("led.report.export.presets")}</span>
              <div className="led-color-presets">
                {LED_PANEL_COLOR_PRESETS.map((p) => {
                  const isActive =
                    settings.panelColorDark.toLowerCase() ===
                      p.dark.toLowerCase() &&
                    settings.panelColorLight.toLowerCase() ===
                      p.light.toLowerCase();
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className={`led-color-preset ${isActive ? "is-active" : ""}`}
                      title={t("led.report.export.usePreset", {
                        name: t(panelPresetLabelKeys[p.label]),
                      })}
                      onClick={() =>
                        onUpdateSettings({
                          panelColorDark: p.dark,
                          panelColorLight: p.light,
                        })
                      }
                    >
                      <span
                        className="led-color-preset-half"
                        style={{ background: p.dark }}
                      />
                      <span
                        className="led-color-preset-half"
                        style={{ background: p.light }}
                      />
                      <span className="led-color-preset-label">
                        {t(panelPresetLabelKeys[p.label])}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
