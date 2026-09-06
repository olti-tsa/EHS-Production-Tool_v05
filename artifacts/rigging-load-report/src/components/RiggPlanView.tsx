import { useEffect, useMemo, useRef, useState } from "react";
import { NumberField } from "./NumberField";
import {
  clampTrussToVenue,
  makeDefaultTruss,
  snapHalfMetre,
  trussEndpoints,
  type RiggPlan,
  type RiggPlanTruss,
  type RiggPlanVenue,
  type TrussRotation,
} from "../lib/riggPlan";
import { DrawingImporter } from "./DrawingImporter";
import type {
  ApplySelection,
  ApplySummary,
  ExtractedItems,
} from "../lib/drawingAnalysis";
import type { FloorPlan } from "../lib/floorPlan";
import { useI18n, useT } from "../lib/i18n/I18nContext";
import type { TranslationKey } from "../lib/i18n/types";

/** Round numeric truss fields to one decimal so JSON storage stays
 *  small and the editor table never displays floating-point fuzz. */
function roundTruss(t: RiggPlanTruss): RiggPlanTruss {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { ...t, x: r1(t.x), y: r1(t.y), z: r1(t.z), lengthM: r1(t.lengthM) };
}

/** Round, then clamp — rounding first so the result is canonical
 *  on-disk, clamping last so we can never persist an out-of-bounds
 *  truss even if rounding nudged us past the venue edge. */
function settleTruss(t: RiggPlanTruss, venue: RiggPlanVenue): RiggPlanTruss {
  return clampTrussToVenue(roundTruss(t), venue);
}

/** Per-system summary the Rigg Plan needs from the rest of the app. */
export type RiggPlanSystemInfo = {
  id: string;
  name: string;
  /** Number of hoist points on this system (for the truss label). */
  pointCount: number;
  /** Static load in kg (sum of payload + hoists). */
  staticKg: number;
  /** Max dynamic point load in kg (peak), used for the colour status. */
  peakKg: number;
  /** Hoist SWL in kg, used for the colour status. */
  swlKg: number;
};

type Props = {
  plan: RiggPlan;
  systems: RiggPlanSystemInfo[];
  onUpdateVenue: (patch: Partial<RiggPlanVenue>) => void;
  /** Create a fresh venue with default dimensions. Called from the
   *  "Add venue" CTA when the Rigg Plan is empty. */
  onAddVenue: () => void;
  /** Drop the venue and every truss placed on it. Called from the
   *  "Delete venue" button on the Venue card. */
  onDeleteVenue: () => void;
  onUpdateTruss: (systemId: string, patch: Partial<RiggPlanTruss>) => void;
  /** Jump to the Rigging Report so the user can rename / add systems. */
  onJumpToRigging: () => void;
  /** Apply items extracted from an uploaded drawing to the report tabs.
   *  Returns a summary so the importer can show how many items were
   *  added vs. skipped because they already existed (cross-PDF dedup). */
  onApplyExtractedItems: (
    extracted: ExtractedItems,
    selection: ApplySelection,
  ) => ApplySummary;
  /** Project / venue name used as extra context for the analyser. */
  projectName?: string;
  /** Delete a rigging system entirely (called from the truss table's
   *  Delete column). The host enforces "must keep ≥ 1 system". */
  onDeleteSystem: (systemId: string) => void;
  /** All floor plans the producer has uploaded for this project.
   *  When more than one is present, the canvas exposes a switcher
   *  so the producer can flip between them (e.g. "rigging plan",
   *  "lighting plan", "stage layout") without losing any of them. */
  floorPlans: FloorPlan[];
  /** Which plan to render in the canvas. Null when none selected
   *  (typically because none uploaded yet). */
  activeFloorPlanId: string | null;
  /** Append a freshly-uploaded plan to the library and select it. */
  onAddFloorPlan: (plan: FloorPlan) => void;
  /** Remove one plan from the library. The host re-points the active
   *  selection if the deleted plan was the active one. */
  onRemoveFloorPlan: (id: string) => void;
  /** Switch which uploaded plan is shown in the canvas. */
  onSelectFloorPlan: (id: string) => void;
};

/** Default dimensions used as analyser context when the producer
 *  hasn't created a venue yet. The analyser still benefits from a
 *  ballpark venue size to reconcile drawing dimensions against. */
const DRAWING_IMPORTER_FALLBACK_VENUE = {
  widthM: 20,
  depthM: 12,
  ceilingM: 8,
};

const fmt = (n: number, locale: "en" | "no", d = 1) =>
  n.toLocaleString(locale === "no" ? "nb-NO" : "en-US", {
    maximumFractionDigits: d,
  });

const trussRotationKey: Record<TrussRotation, TranslationKey> = {
  0: "riggPlan.truss.rotation.width",
  90: "riggPlan.truss.rotation.depth",
};

/** Pixels per metre at the default zoom. The SVG scales to fit the
 *  available width but we keep this constant to compute reasonable
 *  font / stroke sizes. */
const PX_PER_M = 30;
const GRID_M = 1;

export function RiggPlanView({
  plan,
  systems,
  onUpdateVenue,
  onAddVenue,
  onDeleteVenue,
  onUpdateTruss,
  onJumpToRigging,
  onApplyExtractedItems,
  projectName,
  onDeleteSystem,
  floorPlans,
  activeFloorPlanId,
  onAddFloorPlan,
  onRemoveFloorPlan,
  onSelectFloorPlan,
}: Props) {
  const t = useT();
  const { locale } = useI18n();
  const { venue, trussById } = plan;
  // The active plan is whatever the producer last selected; if the
  // active id no longer matches anything in the library (e.g. after a
  // delete), fall back to the first plan so the canvas still renders
  // something instead of going blank between renders.
  const activeFloorPlan: FloorPlan | null =
    floorPlans.find((p) => p.id === activeFloorPlanId) ??
    floorPlans[0] ??
    null;

  // Auto-seed any newly-created system with a default truss layout so
  // the user never has to "place" them manually — the truss just
  // appears the first time they open the tab. Skipped entirely when
  // there's no venue: trusses live in the venue's coordinate frame, so
  // seeding without one would create unplaceable rows.
  useEffect(() => {
    if (!venue) return;
    const missing = systems.filter((s) => !trussById[s.id]);
    if (missing.length === 0) return;
    const total = systems.length;
    missing.forEach((sys, i) => {
      const idx = systems.findIndex((s) => s.id === sys.id);
      // Clamp the default into the current venue — without this, very
      // small venues would seed an out-of-bounds truss on first open.
      const seed = settleTruss(
        makeDefaultTruss(idx >= 0 ? idx : i, total, venue),
        venue,
      );
      onUpdateTruss(sys.id, seed);
    });
    // We deliberately depend only on the systems list / which ids are
    // present so this effect doesn't fire on every drag. Also include
    // venue presence so we re-seed when the producer adds the venue
    // back after a delete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systems.map((s) => s.id).join("|"), venue != null]);

  const placedSystems = useMemo(
    () => systems.filter((s) => trussById[s.id]),
    [systems, trussById],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="led-report">
      <header className="led-report-header">
        <div>
          <h2>{t("view.riggPlan")}</h2>
          <p className="led-report-sub">
            {t("riggPlan.subtitle")}
          </p>
        </div>
        <div className="led-report-meta">
          {venue ? (
            <>
              <span className="badge">
                <strong>{venue.widthM} × {venue.depthM} m</strong>{" "}
                {t("riggPlan.meta.venue")}
              </span>
              <span className="badge">
                <strong>{venue.ceilingM} m</strong> {t("riggPlan.meta.ceiling")}
              </span>
              <span className="badge">
                <strong>{placedSystems.length}</strong> {t("riggPlan.meta.trusses")}
              </span>
            </>
          ) : (
            <span className="badge">{t("riggPlan.meta.noVenue")}</span>
          )}
        </div>
      </header>

      {/* Drawing importer — reads a user-uploaded venue plan and lets
          them apply the extracted items back to the report tabs. Stays
          visible even with no venue so a producer who only has a
          drawing can let it populate the venue dimensions. */}
      <DrawingImporter
        currentVenue={venue ?? DRAWING_IMPORTER_FALLBACK_VENUE}
        projectName={projectName}
        onApply={onApplyExtractedItems}
        onUseAsFloorPlan={onAddFloorPlan}
        hasFloorPlan={floorPlans.length > 0}
      />

      {/* Floor-plan library — visible whenever the producer has at
          least one uploaded plan. Lets them pick which plan the canvas
          renders and remove ones they no longer want. Hidden when the
          library is empty so the empty Rigg Plan stays uncluttered. */}
      {floorPlans.length > 0 && (
        <section className="led-card">
          <div className="led-card-head">
            <h3>{t("riggPlan.floorPlans.title", { count: floorPlans.length })}</h3>
            <span className="led-hint">
              {t("riggPlan.floorPlans.hint")}
            </span>
          </div>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {floorPlans.map((p) => {
              const isActive = activeFloorPlan?.id === p.id;
              return (
                <li
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 8px",
                    border: "1px solid var(--border, #cbd5e1)",
                    borderRadius: 6,
                    background: isActive
                      ? "rgba(99,102,241,0.08)"
                      : "transparent",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <input
                      type="radio"
                      name="active-floor-plan"
                      checked={isActive}
                      onChange={() => onSelectFloorPlan(p.id)}
                    />
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={p.fileName}
                    >
                      <strong>{p.fileName}</strong>
                    </span>
                    {isActive && (
                      <span className="led-sub" style={{ marginLeft: 4 }}>
                        {t("riggPlan.floorPlans.showing")}
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    className="btn btn-soft btn-xs"
                    onClick={() => {
                      if (
                        window.confirm(
                          t("riggPlan.floorPlans.deleteConfirm", {
                            name: p.fileName,
                          }),
                        )
                      ) {
                        onRemoveFloorPlan(p.id);
                      }
                    }}
                    title={t("riggPlan.floorPlans.removeTitle")}
                  >
                    {t("common.delete")}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {venue == null ? (
        /* Empty state — no venue. The producer either deleted the
           venue or hit Reset. Show a single CTA to add one back. */
        <section className="led-card">
          <div className="led-card-head">
            <h3>{t("riggPlan.venue.title")}</h3>
            <span className="led-hint">
              {t("riggPlan.venue.emptyHint")}
            </span>
          </div>
          <div className="led-empty">
            {t("riggPlan.venue.empty", {
              width: DRAWING_IMPORTER_FALLBACK_VENUE.widthM,
              depth: DRAWING_IMPORTER_FALLBACK_VENUE.depthM,
            })}
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onAddVenue}
              >
                {t("riggPlan.venue.add")}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Venue editor */}
          <section className="led-card">
            <div className="led-card-head">
              <h3>{t("riggPlan.venue.title")}</h3>
              <div className="led-controls">
                <span className="led-hint">
                  {t("riggPlan.venue.dimensionsHint")}
                </span>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={onDeleteVenue}
                  title={t("riggPlan.venue.deleteTitle")}
                >
                  {t("riggPlan.venue.delete")}
                </button>
              </div>
            </div>
            <div className="rigg-venue-grid">
              <label className="led-field">
                <span className="led-field-label">{t("riggPlan.venue.width")}</span>
                <NumberField
                  className="led-input led-input-num"
                  min={1}
                  step={0.5}
                  value={venue.widthM}
                  transform={(n) => Math.max(1, snapHalfMetre(n || 0))}
                  emptyValue={1}
                  onCommit={(widthM) => onUpdateVenue({ widthM })}
                />
              </label>
              <label className="led-field">
                <span className="led-field-label">{t("riggPlan.venue.depth")}</span>
                <NumberField
                  className="led-input led-input-num"
                  min={1}
                  step={0.5}
                  value={venue.depthM}
                  transform={(n) => Math.max(1, snapHalfMetre(n || 0))}
                  emptyValue={1}
                  onCommit={(depthM) => onUpdateVenue({ depthM })}
                />
              </label>
              <label className="led-field">
                <span className="led-field-label">{t("riggPlan.venue.ceiling")}</span>
                <NumberField
                  className="led-input led-input-num"
                  min={1}
                  step={0.5}
                  value={venue.ceilingM}
                  transform={(n) => Math.max(1, snapHalfMetre(n || 0))}
                  emptyValue={1}
                  onCommit={(ceilingM) => onUpdateVenue({ ceilingM })}
                />
              </label>
            </div>
          </section>

          {/* Plan canvas */}
          <section className="led-card">
            <div className="led-card-head">
              <h3>{t("riggPlan.canvas.title")}</h3>
            </div>

            {systems.length === 0 ? (
              <div className="led-empty">
                {t("riggPlan.canvas.emptyPrefix")}{" "}
                <button
                  type="button"
                  className="btn btn-soft btn-sm"
                  onClick={onJumpToRigging}
                >
                  {t("view.rigging")}
                </button>{" "}
                {t("riggPlan.canvas.emptySuffix")}
              </div>
            ) : (
              <PlanCanvas
                venue={venue}
                systems={placedSystems}
                trussById={trussById}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onUpdateTruss={onUpdateTruss}
                floorPlan={activeFloorPlan}
              />
            )}
          </section>
        </>
      )}

      {/* Per-truss editor */}
      {venue && placedSystems.length > 0 && (
        <section className="led-card">
          <div className="led-card-head">
            <h3>{t("riggPlan.truss.title")}</h3>
            <span className="led-hint">
              {t("riggPlan.truss.hint")}
            </span>
          </div>
          <div className="led-table-wrap">
            <table className="led-table">
              <thead>
                <tr>
                  <th>{t("riggPlan.truss.table.name")}</th>
                  <th className="led-num">{t("riggPlan.truss.table.x")}</th>
                  <th className="led-num">{t("riggPlan.truss.table.y")}</th>
                  <th className="led-num">{t("riggPlan.truss.table.zTrim")}</th>
                  <th className="led-num">{t("riggPlan.truss.table.length")}</th>
                  <th>{t("riggPlan.truss.table.orientation")}</th>
                  <th className="led-num">{t("riggPlan.truss.table.staticLoad")}</th>
                  <th className="led-num">{t("riggPlan.truss.table.peakSwl")}</th>
                  <th aria-label={t("riggPlan.truss.table.deleteAria")} />
                </tr>
              </thead>
              <tbody>
                {placedSystems.map((sys) => {
                  const truss = trussById[sys.id];
                  if (!truss) return null;
                  const status =
                    sys.peakKg > sys.swlKg
                      ? "is-fail"
                      : sys.peakKg > sys.swlKg * 0.9
                        ? "is-warn"
                        : "is-ok";
                  return (
                    <tr
                      key={sys.id}
                      className={selectedId === sys.id ? "led-row-linked" : ""}
                      onClick={() => setSelectedId(sys.id)}
                    >
                      <td>
                        <strong>{sys.name}</strong>
                        <div className="led-sub">
                          {t("riggPlan.truss.points", { count: sys.pointCount })}
                        </div>
                      </td>
                      <td>
                        <NumberField
                          className="led-input led-input-num"
                          step={0.5}
                          value={truss.x}
                          transform={(n) => snapHalfMetre(n || 0)}
                          emptyValue={0}
                          onCommit={(x) =>
                            onUpdateTruss(sys.id, {
                              ...clampTrussToVenue(
                                {
                                  ...truss,
                                  x,
                                },
                                venue,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <NumberField
                          className="led-input led-input-num"
                          step={0.5}
                          value={truss.y}
                          transform={(n) => snapHalfMetre(n || 0)}
                          emptyValue={0}
                          onCommit={(y) =>
                            onUpdateTruss(sys.id, {
                              ...clampTrussToVenue(
                                {
                                  ...truss,
                                  y,
                                },
                                venue,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <NumberField
                          className="led-input led-input-num"
                          step={0.5}
                          min={0}
                          max={venue.ceilingM}
                          value={truss.z}
                          transform={(n) =>
                            Math.min(
                              venue.ceilingM,
                              Math.max(0, snapHalfMetre(n || 0)),
                            )
                          }
                          emptyValue={0}
                          onCommit={(z) => onUpdateTruss(sys.id, { z })}
                        />
                      </td>
                      <td>
                        <NumberField
                          className="led-input led-input-num"
                          step={0.5}
                          min={0.5}
                          value={truss.lengthM}
                          transform={(n) =>
                            Math.max(0.5, snapHalfMetre(n || 0))
                          }
                          emptyValue={0.5}
                          onCommit={(lengthM) =>
                            onUpdateTruss(sys.id, {
                              ...clampTrussToVenue(
                                { ...truss, lengthM },
                                venue,
                              ),
                            })
                          }
                        />
                      </td>
                      <td>
                        <select
                          className="led-input"
                          value={truss.rotation}
                          onChange={(e) =>
                            onUpdateTruss(sys.id, {
                              ...clampTrussToVenue(
                                {
                                  ...truss,
                                  rotation: Number(e.target.value) as TrussRotation,
                                },
                                venue,
                              ),
                            })
                          }
                        >
                          <option value={0}>{t(trussRotationKey[0])}</option>
                          <option value={90}>{t(trussRotationKey[90])}</option>
                        </select>
                      </td>
                      <td className="led-num">{fmt(sys.staticKg, locale, 0)}</td>
                      <td className={`led-num rigg-status ${status}`}>
                        {fmt(sys.peakKg, locale, 0)} / {fmt(sys.swlKg, locale, 0)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          // Stop the row's onClick (which selects the
                          // truss) from firing — clicking Delete should
                          // not also flash a selection state on the way
                          // out. The host's `removeSystem` already
                          // shows its own confirm() prompt, so we do
                          // NOT add a second one here (would double-
                          // prompt the user).
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSystem(sys.id);
                          }}
                          title={t("riggPlan.truss.deleteTitle")}
                        >
                          {t("common.delete")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PlanCanvas({
  venue,
  systems,
  trussById,
  selectedId,
  onSelect,
  onUpdateTruss,
  floorPlan,
}: {
  venue: RiggPlanVenue;
  systems: RiggPlanSystemInfo[];
  trussById: Record<string, RiggPlanTruss>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdateTruss: (id: string, patch: Partial<RiggPlanTruss>) => void;
  floorPlan: FloorPlan | null;
}) {
  const t = useT();
  // SVG uses world-units (metres). We let CSS scale it to fit the card.
  const padM = 1; // padding in metres around the venue rect
  const viewW = venue.widthM + padM * 2;
  const viewH = venue.depthM + padM * 2;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    offsetX: number; // truss-centre offset from pointer in world units
    offsetY: number;
  } | null>(null);

  /** Map a pointer event into venue coordinates (metres from origin). */
  function pointerToWorld(e: React.PointerEvent | PointerEvent): {
    x: number;
    y: number;
  } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x - padM, y: local.y - padM };
  }

  function handlePointerDown(sysId: string, e: React.PointerEvent) {
    const t = trussById[sysId];
    if (!t) return;
    e.stopPropagation();
    onSelect(sysId);
    const w = pointerToWorld(e);
    dragRef.current = {
      id: sysId,
      pointerId: e.pointerId,
      offsetX: t.x - w.x,
      offsetY: t.y - w.y,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const t = trussById[drag.id];
    if (!t) return;
    const w = pointerToWorld(e);
    const next = clampTrussToVenue(
      {
        ...t,
        x: snapHalfMetre(w.x + drag.offsetX),
        y: snapHalfMetre(w.y + drag.offsetY),
      },
      venue,
    );
    if (next.x !== t.x || next.y !== t.y) {
      onUpdateTruss(drag.id, { x: next.x, y: next.y });
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (dragRef.current && dragRef.current.pointerId === e.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <div className="rigg-canvas-wrap" style={{ position: "relative" }}>
      {/* The clear / replace controls used to live on this overlay,
          but plans are now managed in the "Floor plans" library card
          above the canvas. We keep a small read-only label so the
          producer can confirm at a glance which plan is showing. */}
      {floorPlan && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 2,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid var(--border, #cbd5e1)",
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 12,
            color: "#0f172a",
            maxWidth: "60%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={floorPlan.fileName}
        >
          {t("riggPlan.canvas.activeFloorPlan")}:{" "}
          <strong>{floorPlan.fileName}</strong>
        </div>
      )}
      <svg
        ref={svgRef}
        className="rigg-canvas"
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={() => onSelect(null)}
      >
        {/* Background grid */}
        <defs>
          <pattern
            id="rigg-grid"
            x={padM}
            y={padM}
            width={GRID_M}
            height={GRID_M}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${GRID_M} 0 L 0 0 0 ${GRID_M}`}
              fill="none"
              stroke="rgba(99,102,241,0.18)"
              strokeWidth={0.02}
            />
          </pattern>
        </defs>

        {/* Floor-plan backdrop (the user's uploaded drawing). The
            synthetic grid / venue rect outline / downstage marker were
            removed — the only backdrop is the user's upload, if any.
            Trusses still draw on top either way. */}
        {floorPlan && (
          <image
            href={floorPlan.imageDataUrl}
            x={padM}
            y={padM}
            width={venue.widthM}
            height={venue.depthM}
            preserveAspectRatio="xMidYMid meet"
          />
        )}

        {/* Trusses removed at user request — only the uploaded floor
            plan is rendered on this canvas now. The systems table
            below the canvas still lets the user manage truss data. */}
      </svg>
    </div>
  );
}
