/** Distro-centric Power Plan view — see lib/power.ts for the data model.
 *
 *  Layout:
 *    PlanSummaryStrip
 *    DistroList → one DistroCard per HOT
 *      header (name / source / preset / feeds-trusses)
 *      feeder summary (per-phase amps + imbalance + feeder utilisation)
 *      warnings + advisory suggestions
 *      ChannelGrid (one row per channel)
 *        breaker badge · drop list · inline AddDrop form · channel bar
 *    UnpoweredFixturesPanel (only if there are leftovers)
 *    LegacyCircuitsPanel (only if legacy v1 circuits exist) */

import { useEffect, useMemo, useState } from "react";
import { NumberField } from "./NumberField";
import { useT } from "../lib/i18n/I18nContext";
import type { TranslationKey } from "../lib/i18n/types";
import {
  applyPresetToDistro,
  computeCircuitLoad,
  computeDistroLoad,
  computeDistroPlanTotals,
  computeDistroSuggestions,
  computeDistroTrussSplit,
  computeTrussPowerSummary,
  computeUnpoweredFixtures,
  DEFAULT_CHANNEL_MAPPING,
  DISTRO_PRESET_ORDER,
  DROP_CABLE_KINDS,
  makeFixtureWattsLookup,
  POWER_DERATE_FACTOR,
  POWER_PHASES,
  severityForRatio,
  SINGLE_PHASE_MAPPING,
  suggestPowerLayout,
  type Channel,
  type ChannelLoad,
  type ChannelMapping,
  type Distro,
  type DistroLoad,
  type DistroPresetId,
  type DistroSuggestion,
  type DistroTrussShare,
  type Drop,
  type DropCableKind,
  type FixtureRef,
  type LoadSeverity,
  type PowerCircuit,
  type PowerItem,
  type PowerPhase,
  type PowerPlan,
  type SuggestedDistro,
  type TrussPowerRow,
} from "../lib/power";

type SystemLite = { id: string; name: string };

const PRESET_LABEL_KEYS = {
  "schuko-16-1ph": "powerPlan.preset.schuko16",
  "cee-32-1ph": "powerPlan.preset.cee32Single",
  "cee-16-3ph-6x10": "powerPlan.preset.cee16Three",
  "cee-32-3ph-6x16": "powerPlan.preset.cee32Three",
  "cee-63-3ph-6x32": "powerPlan.preset.cee63Three",
  "cee-125-3ph-6x63": "powerPlan.preset.cee125Three",
  custom: "powerPlan.preset.custom",
} as const satisfies Record<DistroPresetId, TranslationKey>;

const SUGGESTION_MESSAGE_KEYS = {
  rebalance: "powerPlan.suggestion.rebalance",
} as const satisfies Record<DistroSuggestion["type"], TranslationKey>;

type Props = {
  plan: PowerPlan;
  fixtures: FixtureRef[];
  systems: SystemLite[];

  // Distro v2 handlers
  onAddDistro: (presetId?: DistroPresetId) => void;
  onUpdateDistro: (
    id: string,
    patch: Partial<Omit<Distro, "channels" | "channelMapping" | "id">>,
  ) => void;
  onRemoveDistro: (id: string) => void;
  onResetDistro: (id: string) => void;
  onExportPowerPlan: () => void;
  powerExportToast: string | null;
  onDismissPowerExportToast: () => void;
  onApplyDistroPreset: (id: string, presetId: DistroPresetId) => void;
  onUpdateDistroChannelMapping: (id: string, mapping: ChannelMapping) => void;
  onUpdateDistroChannel: (
    distroId: string,
    channelIndex: number,
    patch: Partial<Omit<Channel, "drops" | "id" | "index">>,
  ) => void;
  onAddDrop: (
    distroId: string,
    channelIndex: number,
    drop: { trussId: string; fixtureRef: string; qty: number; cable?: DropCableKind },
  ) => void;
  onUpdateDrop: (
    distroId: string,
    channelIndex: number,
    dropId: string,
    patch: Partial<Omit<Drop, "id">>,
  ) => void;
  onRemoveDrop: (distroId: string, channelIndex: number, dropId: string) => void;
  onApplyDistroSuggestion: (distroId: string, suggestion: DistroSuggestion) => void;
  onApplyPowerLayoutSuggestion: (suggested: SuggestedDistro[]) => void;

  // Legacy v1 handlers (kept for the read-only Legacy panel)
  onAddCircuit: () => void;
  onUpdateCircuit: (id: string, patch: Partial<Omit<PowerCircuit, "items">>) => void;
  onRemoveCircuit: (id: string) => void;
  onAddItem: (circuitId: string, phase?: PowerPhase) => void;
  onAddItemFromLibrary?: (circuitId: string, phase: PowerPhase) => void;
  onUpdateItem: (
    circuitId: string,
    itemId: string,
    patch: Partial<PowerItem>,
  ) => void;
  onRemoveItem: (circuitId: string, itemId: string) => void;
  onDuplicateItem: (circuitId: string, itemId: string) => void;
};

const fmtNum = (n: number, d = 1) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d });
const fmtInt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtPct = (ratio: number) =>
  `${(ratio * 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}%`;

function severityClass(sev: LoadSeverity, base: string): string {
  if (sev === "over") return `${base} ${base}--over`;
  if (sev === "warn") return `${base} ${base}--warn`;
  return base;
}

export function PowerPlanView(props: Props) {
  const { plan, fixtures, systems } = props;
  const t = useT();

  const wattsLookup = useMemo(
    () => makeFixtureWattsLookup(fixtures),
    [fixtures],
  );
  const distroLoads = useMemo(
    () => plan.distros.map((d) => computeDistroLoad(d, wattsLookup)),
    [plan.distros, wattsLookup],
  );
  const unpowered = useMemo(
    () => computeUnpoweredFixtures(plan.distros, fixtures),
    [plan.distros, fixtures],
  );
  const totals = useMemo(
    () => computeDistroPlanTotals(distroLoads, unpowered),
    [distroLoads, unpowered],
  );
  const trussRows = useMemo(
    () => computeTrussPowerSummary(plan.distros, systems, fixtures, wattsLookup),
    [plan.distros, systems, fixtures, wattsLookup],
  );
  const suggestedLayout = useMemo(
    () => suggestPowerLayout(unpowered, systems),
    [unpowered, systems],
  );

  const [autoSuggestOpen, setAutoSuggestOpen] = useState(false);

  return (
    <section className="power-plan">
      <div className="power-plan-head">
        <div>
          <h2>{t("powerPlan.title")}</h2>
          <p className="power-plan-sub">
            {t("powerPlan.subtitle")}
          </p>
        </div>
        <div className="power-plan-meta">
          <span className="badge">
            <strong>{totals.distroCount}</strong>{" "}
            {t(totals.distroCount === 1 ? "powerPlan.distro.one" : "powerPlan.distro.many")}
          </span>
          <span className="badge">
            <strong>{fmtInt(totals.totalWatts)}</strong> {t("powerPlan.planned")}
          </span>
          {totals.distroCount > 0 && (
            <>
              <span className="badge">
                {t("powerPlan.worstFeeder")} <strong>{fmtPct(totals.worstFeederUtilization)}</strong>{" "}
                <span className="badge-sub">{totals.worstFeederLabel}</span>
              </span>
              <span className="badge">
                {t("powerPlan.worstChannel")} <strong>{fmtPct(totals.worstChannelUtilization)}</strong>{" "}
                <span className="badge-sub">{totals.worstChannelLabel}</span>
              </span>
            </>
          )}
          {totals.overloadedDistros > 0 && (
            <span className="badge badge-danger">
              <strong>{totals.overloadedDistros}</strong> {t("powerPlan.overCapacity")}
            </span>
          )}
          {totals.warningDistros > 0 && (
            <span className="badge badge-warn">
              <strong>{totals.warningDistros}</strong> {t("powerPlan.nearLimit")}
            </span>
          )}
          {totals.imbalancedDistros > 0 && (
            <span className="badge badge-warn">
              <strong>{totals.imbalancedDistros}</strong> {t("powerPlan.imbalanced")}
            </span>
          )}
          {totals.unpoweredFixtureCount > 0 && (
            <span className="badge badge-warn">
              <strong>{totals.unpoweredFixtureCount}</strong> {t("powerPlan.fixturesNotPowered")}
            </span>
          )}
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => setAutoSuggestOpen(true)}
            disabled={unpowered.length === 0}
            title={
              unpowered.length === 0
                ? t("powerPlan.autoSuggest.disabledTitle")
                : t("powerPlan.autoSuggest.title")
            }
          >
            ⚡ {t("powerPlan.autoSuggest.action")}
          </button>
          {/* Mirrors the "Export" button on Stage Report cards. Opens a
              new tab with a printable / JSON crew manifest. */}
          <button
            type="button"
            className="btn btn-tab-action"
            onClick={props.onExportPowerPlan}
            disabled={plan.distros.length === 0}
            title={
              plan.distros.length === 0
                ? t("powerPlan.export.disabledTitle")
                : t("powerPlan.export.title")
            }
          >
            {t("powerPlan.export.action")}
          </button>
        </div>
      </div>

      {/* Transient toast — auto-dismisses after 4 s. The state lives on
          the App level so the export handler can fire it without
          re-rendering a separate provider. */}
      <PowerExportToast
        message={props.powerExportToast}
        onDismiss={props.onDismissPowerExportToast}
      />
      

      {/* Truss-first workflow layer: producers think trusses → fixtures →
          power. This panel surfaces that mental model above the distro
          editor so the rig drives the power, not the other way around. */}
      {trussRows.length > 0 && (
        <TrussPowerPanel
          rows={trussRows}
          unpowered={unpowered}
          onAutoAssignTruss={(trussId) => {
            const trussUnpowered = unpowered.filter((u) => u.trussId === trussId);
            if (trussUnpowered.length === 0) return;
            const proposals = suggestPowerLayout(trussUnpowered, systems);
            if (proposals.length > 0) {
              props.onApplyPowerLayoutSuggestion(proposals);
            }
          }}
        />
      )}

      {plan.distros.length === 0 ? (
        <div className="led-empty">
          {t("powerPlan.empty")}
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={() => props.onAddDistro()}
            >
              + {t("powerPlan.addDistro")}
            </button>
          </div>
        </div>
      ) : (
        <>
          {plan.distros.map((d) => {
            const load = distroLoads.find((l) => l.distro.id === d.id);
            if (!load) return null;
            return (
              <DistroCard
                key={d.id}
                load={load}
                systems={systems}
                fixtures={fixtures}
                wattsLookup={wattsLookup}
                onUpdate={(patch) => props.onUpdateDistro(d.id, patch)}
                onRemove={() => props.onRemoveDistro(d.id)}
                onReset={() => props.onResetDistro(d.id)}
                onApplyPreset={(presetId) =>
                  props.onApplyDistroPreset(d.id, presetId)
                }
                onUpdateMapping={(m) =>
                  props.onUpdateDistroChannelMapping(d.id, m)
                }
                onUpdateChannel={(idx, patch) =>
                  props.onUpdateDistroChannel(d.id, idx, patch)
                }
                onAddDrop={(idx, drop) => props.onAddDrop(d.id, idx, drop)}
                onUpdateDrop={(idx, dropId, patch) =>
                  props.onUpdateDrop(d.id, idx, dropId, patch)
                }
                onRemoveDrop={(idx, dropId) =>
                  props.onRemoveDrop(d.id, idx, dropId)
                }
                onApplySuggestion={(s) =>
                  props.onApplyDistroSuggestion(d.id, s)
                }
              />
            );
          })}

          <div className="power-add-distro-row">
            <button
              className="btn btn-primary"
              onClick={() => props.onAddDistro()}
            >
              + {t("powerPlan.addDistro")}
            </button>
            <PresetQuickAdd onPick={(id) => props.onAddDistro(id)} />
          </div>
        </>
      )}

      {unpowered.length > 0 && (
        <UnpoweredFixturesPanel unpowered={unpowered} systems={systems} />
      )}

      {plan.circuits.length > 0 && (
        <LegacyCircuitsPanel
          circuits={plan.circuits}
          onRemoveCircuit={props.onRemoveCircuit}
        />
      )}

      {autoSuggestOpen && (
        <AutoSuggestModal
          suggested={suggestedLayout}
          onApply={(picks) => {
            props.onApplyPowerLayoutSuggestion(picks);
            setAutoSuggestOpen(false);
          }}
          onClose={() => setAutoSuggestOpen(false)}
        />
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Quick-add preset menu
// ──────────────────────────────────────────────────────────────────────

function PresetQuickAdd({
  onPick,
}: {
  onPick: (id: DistroPresetId) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="power-preset-menu">
      <button
        type="button"
        className="btn btn-soft"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        + {t("powerPlan.add")}… ▾
      </button>
      {open && (
        <div className="power-preset-menu-list" role="menu">
          {DISTRO_PRESET_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className="power-preset-menu-item"
              onClick={() => {
                onPick(id);
                setOpen(false);
              }}
              role="menuitem"
            >
              {t(PRESET_LABEL_KEYS[id])}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Distro card
// ──────────────────────────────────────────────────────────────────────

type DistroCardProps = {
  load: DistroLoad;
  systems: SystemLite[];
  fixtures: FixtureRef[];
  wattsLookup: ReturnType<typeof makeFixtureWattsLookup>;
  onUpdate: (
    patch: Partial<Omit<Distro, "channels" | "channelMapping" | "id">>,
  ) => void;
  onRemove: () => void;
  onReset: () => void;
  onApplyPreset: (presetId: DistroPresetId) => void;
  onUpdateMapping: (mapping: ChannelMapping) => void;
  onUpdateChannel: (
    channelIndex: number,
    patch: Partial<Omit<Channel, "drops" | "id" | "index">>,
  ) => void;
  onAddDrop: (
    channelIndex: number,
    drop: { trussId: string; fixtureRef: string; qty: number; cable?: DropCableKind },
  ) => void;
  onUpdateDrop: (
    channelIndex: number,
    dropId: string,
    patch: Partial<Omit<Drop, "id">>,
  ) => void;
  onRemoveDrop: (channelIndex: number, dropId: string) => void;
  onApplySuggestion: (suggestion: DistroSuggestion) => void;
};

function DistroCard(props: DistroCardProps) {
  const t = useT();
  const { load, systems } = props;
  const distro = load.distro;
  const sevForCard = load.feederStatus === "over"
    ? "over"
    : (load.hasChannelOverload ? "over" : (load.feederStatus === "warn" || load.hasChannelWarning ? "warn" : "ok"));

  const systemNameById = new Map(systems.map((s) => [s.id, s.name]));
  const suggestions = useMemo(() => computeDistroSuggestions(load), [load]);
  const trussSplit = useMemo(
    () => computeDistroTrussSplit(load),
    [load],
  );
  const topSuggestion = suggestions[0];
  const restSuggestions = suggestions.slice(1);
  const [mappingOpen, setMappingOpen] = useState(false);

  // Accordion-style collapse for the whole distro card. Default state
  // depends on whether the distro is carrying any load — empty distros
  // (0 W) auto-collapse to reduce visual noise on a fresh project.
  // Once the user toggles, we honour their choice and don't re-derive
  // from load (which would feel "fighting back" if they expand a 0 W
  // distro to add fixtures).
  const [collapsed, setCollapsed] = useState<boolean>(load.totalWatts === 0);
  const cardClass = severityClass(
    sevForCard,
    `led-card power-distro${collapsed ? " power-distro--collapsed" : ""}`,
  );

  return (
    <section className={cardClass}>
      {/* Header — always visible. The chevron toggles the body. */}
      <div className="power-distro-head">
        <button
          type="button"
          className="power-distro-chevron"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t("powerPlan.expandNamed", { name: distro.name || t("powerPlan.distro.one") })
              : t("powerPlan.collapseNamed", { name: distro.name || t("powerPlan.distro.one") })
          }
          title={collapsed ? t("powerPlan.expandDistro") : t("powerPlan.collapseDistro")}
        >
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        </button>
        <div className="power-distro-id">
          <input
            className="led-input power-distro-name"
            type="text"
            value={distro.name}
            onChange={(e) => props.onUpdate({ name: e.target.value })}
            placeholder={t("powerPlan.distroNamePlaceholder")}
            aria-label={t("powerPlan.distroName")}
          />
          <input
            className="led-input"
            type="text"
            value={distro.source}
            onChange={(e) => props.onUpdate({ source: e.target.value })}
            placeholder={t("powerPlan.sourcePlaceholder")}
            aria-label={t("powerPlan.sourceFor", { name: distro.name || t("powerPlan.distro.one") })}
          />
        </div>
        <div className="power-distro-rating">
          {/* Collapsed-state summary chip — keeps the row scannable
              when many distros are folded. */}
          {collapsed && (
            <span
              className="power-distro-summary-chip"
              title={t("powerPlan.collapsedSummary", {
                watts: fmtInt(load.totalWatts),
                amps: distro.feedAmps,
                phases: distro.feedPhases,
              })}
            >
              {fmtInt(load.totalWatts)} W
            </span>
          )}
          <label className="power-preset-label">
            <span>{t("powerPlan.preset")}</span>
            <select
              className="led-input"
              value={distro.preset}
              onChange={(e) =>
                props.onApplyPreset(e.target.value as DistroPresetId)
              }
              aria-label={t("powerPlan.presetFor", { name: distro.name })}
            >
              {DISTRO_PRESET_ORDER.map((id) => (
                <option key={id} value={id}>
                  {t(PRESET_LABEL_KEYS[id])}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={() => {
              if (load.totalWatts === 0) {
                props.onReset();
                return;
              }
              const ok = window.confirm(
                t("powerPlan.resetConfirm", { name: distro.name || t("powerPlan.thisDistro") }),
              );
              if (ok) props.onReset();
            }}
            title={t("powerPlan.resetTitle")}
            disabled={load.totalWatts === 0}
          >
            {t("powerPlan.reset")}
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={props.onRemove}
            title={t("powerPlan.removeDistro")}
          >
            {t("common.remove")}
          </button>
        </div>
      </div>

      {/* Everything below the header is hidden when collapsed. */}
      {!collapsed && (
      <>
      

      {/* Feed badge + truss chips */}
      <div className="power-distro-feed">
        <span className="power-feed-badge">
          {distro.feedVoltage} V · {distro.feedAmps} A · {distro.feedPhases}ph
        </span>
        <span className="power-feed-derate">
          {t("powerPlan.derate")} {fmtNum(load.feederDerateAmps, 1)} A
        </span>
        <span className="power-feed-divider" aria-hidden="true">
          •
        </span>
        <span className="power-feeds-label">{t("powerPlan.feeds")}:</span>
        <FeedsTrussesEditor
          systems={systems}
          selected={distro.feedsTrusses}
          onChange={(next) => props.onUpdate({ feedsTrusses: next })}
        />
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={() => setMappingOpen((v) => !v)}
          aria-expanded={mappingOpen}
          title={t("powerPlan.mappingTitle")}
        >
          {t("powerPlan.mapping")}
        </button>
      </div>

      {/* === v2.1 LIGHTING WORKFLOW LAYER ====================================
          Producers want to see at-a-glance:  phase stress  →  what feeds
          where  →  what to do next.  We render those THREE things first,
          before any electrician-style channel/mapping editor. */}

      {/* 1. Per-phase + feeder summary (big bars) */}
      <FeederSummary load={load} />

      {/* 2. "HOT1 → LX1 60% · LX2 40%" feed graph */}
      {trussSplit.length > 0 && (
        <FeedGraph
          distroName={distro.name || t("powerPlan.distro.one")}
          split={trussSplit}
          systems={systems}
        />
      )}

      {/* 3. Top suggestion banner with one-click Apply */}
      {topSuggestion && (
        <SuggestionBanner
          suggestion={topSuggestion}
          load={load}
          systems={systems}
          onApply={() => props.onApplySuggestion(topSuggestion)}
        />
      )}

      {/* === Editor layer (mapping + remaining warnings) ================ */}

      {mappingOpen && (
        <ChannelMappingEditor
          mapping={distro.channelMapping}
          channelCount={distro.channels.length}
          feedPhases={distro.feedPhases}
          onChange={props.onUpdateMapping}
          onResetDefault={() =>
            props.onUpdateMapping(
              distro.feedPhases === 3
                ? { ...DEFAULT_CHANNEL_MAPPING }
                : { ...SINGLE_PHASE_MAPPING },
            )
          }
        />
      )}

      {/* Remaining warnings (overloads, etc) — top suggestion already
          shown in the banner above. */}
      <WarningsPanel load={load} suggestions={restSuggestions} />

      {/* Channel grid — each channel renders as a collapsible group so
          the user sees the channel load FIRST and can dropdown to see
          the specific fixtures (drops) on that line. */}
      <div className="power-channel-grid">
        {load.channels.map((cl) => (
          <ChannelRow
            key={cl.channel.id}
            distro={distro}
            channelLoad={cl}
            systems={systems}
            systemNameById={systemNameById}
            fixtures={props.fixtures}
            onUpdateChannel={(patch) =>
              props.onUpdateChannel(cl.channel.index, patch)
            }
            onAddDrop={(drop) => props.onAddDrop(cl.channel.index, drop)}
            onUpdateDrop={(dropId, patch) =>
              props.onUpdateDrop(cl.channel.index, dropId, patch)
            }
            onRemoveDrop={(dropId) =>
              props.onRemoveDrop(cl.channel.index, dropId)
            }
          />
        ))}
      </div>
      </>
      )}
    </section>
  );
}

/** Self-dismissing toast that lives inline in the Power Plan header.
 *  Auto-clears after 4 s; also exposes a manual close (×). Renders
 *  nothing when message is null so it doesn't reserve layout space. */
function PowerExportToast({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss: () => void;
}) {
  const t = useT();
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);
  if (!message) return null;
  return (
    <div
      className="power-export-toast"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true">✓</span>
      <span>{message}</span>
      <button
        type="button"
        className="power-export-toast-close"
        onClick={onDismiss}
        aria-label={t("powerPlan.dismissNotification")}
      >
        ×
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Truss multi-select chips
// ──────────────────────────────────────────────────────────────────────

function FeedsTrussesEditor({
  systems,
  selected,
  onChange,
}: {
  systems: SystemLite[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(selected);
  const toggle = (id: string) => {
    if (selectedSet.has(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };
  const labels = selected
    .map((id) => systems.find((s) => s.id === id)?.name ?? "—")
    .filter((n) => n !== "—");

  return (
    <div className="power-feeds-editor">
      {labels.length === 0 ? (
        <span className="power-feeds-empty">{t("powerPlan.none")}</span>
      ) : (
        labels.map((name, i) => (
          <span key={`${name}-${i}`} className="power-truss-chip">
            {name}
          </span>
        ))
      )}
      <button
        type="button"
        className="btn btn-soft btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {selected.length === 0 ? t("powerPlan.pickTruss") : t("common.edit")}
      </button>
      {open && (
        <div className="power-feeds-menu" role="menu">
          {systems.length === 0 ? (
            <div className="power-feeds-empty-row">
              {t("powerPlan.noSystems")}
            </div>
          ) : (
            systems.map((s) => (
              <label key={s.id} className="power-feeds-menu-item">
                <input
                  type="checkbox"
                  checked={selectedSet.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <span>{s.name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Channel mapping editor
// ──────────────────────────────────────────────────────────────────────

function ChannelMappingEditor({
  mapping,
  channelCount,
  feedPhases,
  onChange,
  onResetDefault,
}: {
  mapping: ChannelMapping;
  channelCount: number;
  feedPhases: 1 | 3;
  onChange: (m: ChannelMapping) => void;
  onResetDefault: () => void;
}) {
  const t = useT();
  const phaseFor = (idx: number): PowerPhase | "" => {
    if (mapping.L1.includes(idx)) return "L1";
    if (mapping.L2.includes(idx)) return "L2";
    if (mapping.L3.includes(idx)) return "L3";
    return "";
  };
  const setPhase = (idx: number, phase: PowerPhase | "") => {
    const next: ChannelMapping = {
      L1: mapping.L1.filter((n) => n !== idx),
      L2: mapping.L2.filter((n) => n !== idx),
      L3: mapping.L3.filter((n) => n !== idx),
    };
    if (phase) next[phase] = [...next[phase], idx].sort((a, b) => a - b);
    onChange(next);
  };
  return (
    <div className="power-mapping-editor">
      <div className="power-mapping-grid">
        {Array.from({ length: channelCount }, (_, i) => i + 1).map((idx) => (
          <label key={idx} className="power-mapping-row">
            <span>Ch{idx}</span>
            <select
              className="led-input"
              value={phaseFor(idx)}
              onChange={(e) => setPhase(idx, e.target.value as PowerPhase | "")}
              disabled={feedPhases !== 3}
            >
              <option value="L1">L1</option>
              {feedPhases === 3 && <option value="L2">L2</option>}
              {feedPhases === 3 && <option value="L3">L3</option>}
              <option value="">—</option>
            </select>
          </label>
        ))}
      </div>
      <div className="power-mapping-actions">
        <button type="button" className="btn btn-soft btn-sm" onClick={onResetDefault}>
          {t("powerPlan.resetDefault")}
        </button>
        <span className="power-mapping-help">
          {feedPhases === 3
            ? t("powerPlan.mappingDefaultHelp")
            : t("powerPlan.mappingSingleHelp")}
        </span>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Feeder summary (per-phase amps + feeder utilisation + imbalance)
// ──────────────────────────────────────────────────────────────────────

function FeederSummary({ load }: { load: DistroLoad }) {
  const t = useT();
  return (
    <div className="power-feeder-summary">
      {load.distro.feedPhases === 3 ? (
        <div className="power-phase-grid">
          {load.phases.map((p) => {
            const ratio = load.distro.feedAmps > 0 ? p.amps / load.distro.feedAmps : 0;
            const sev = severityForRatio(ratio);
            return (
              <div key={p.phase} className={severityClass(sev, "power-phase")}>
                <div className="power-phase-head">
                  <strong>{p.phase}</strong>
                  <span>{fmtPct(ratio)}</span>
                </div>
                <div className="power-phase-bar">
                  <div
                    className="power-phase-bar-fill"
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                  <div
                    className="power-phase-bar-derate"
                    style={{ left: `${POWER_DERATE_FACTOR * 100}%` }}
                    aria-hidden="true"
                  />
                </div>
                <div className="power-phase-stats">
                  <span>{fmtInt(p.watts)} W</span>
                  <span>{fmtNum(p.amps, 1)} A</span>
                  <span className="power-phase-cap">
                    / {load.distro.feedAmps} A
                  </span>
                </div>
                <div className="power-phase-channels">
                  {p.channelIndexes.length === 0
                    ? "—"
                    : `Ch${p.channelIndexes.join(" + Ch")}`}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="power-phase-grid power-phase-grid--single">
          {(() => {
            const p = load.phases[0];
            const ratio = load.distro.feedAmps > 0 ? p.amps / load.distro.feedAmps : 0;
            const sev = severityForRatio(ratio);
            return (
              <div className={severityClass(sev, "power-phase")}>
                <div className="power-phase-head">
                  <strong>1ph</strong>
                  <span>{fmtPct(ratio)}</span>
                </div>
                <div className="power-phase-bar">
                  <div
                    className="power-phase-bar-fill"
                    style={{ width: `${Math.min(100, ratio * 100)}%` }}
                  />
                  <div
                    className="power-phase-bar-derate"
                    style={{ left: `${POWER_DERATE_FACTOR * 100}%` }}
                    aria-hidden="true"
                  />
                </div>
                <div className="power-phase-stats">
                  <span>{fmtInt(p.watts)} W</span>
                  <span>{fmtNum(p.amps, 1)} A</span>
                  <span className="power-phase-cap">
                    / {load.distro.feedAmps} A
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="power-feeder-totals">
        <span>
          {t("powerPlan.total")} <strong>{fmtInt(load.totalWatts)}</strong> W
        </span>
        <span>
          {t("powerPlan.worstLeg")} <strong>{fmtNum(load.feederWorstAmps, 1)}</strong> A /{" "}
          {load.distro.feedAmps} A ({fmtPct(load.feederUtilization)})
        </span>
        {load.distro.feedPhases === 3 && (
          <span>
            {t("powerPlan.imbalance")} <strong>{fmtPct(load.imbalance)}</strong>
          </span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Warnings + advisory suggestions
// ──────────────────────────────────────────────────────────────────────

function WarningsPanel({
  load,
  suggestions,
}: {
  load: DistroLoad;
  suggestions: ReturnType<typeof computeDistroSuggestions>;
}) {
  const t = useT();
  const messages: { kind: "danger" | "warn" | "info"; text: string }[] = [];

  if (load.feederStatus === "over") {
    messages.push({
      kind: "danger",
      text: t("powerPlan.warning.feederOver", {
        amps: fmtNum(load.feederWorstAmps, 1),
        limit: load.distro.feedAmps,
      }),
    });
  } else if (load.feederStatus === "warn") {
    messages.push({
      kind: "warn",
      text: t("powerPlan.warning.feederDerate", {
        amps: fmtNum(load.feederWorstAmps, 1),
        limit: load.distro.feedAmps,
      }),
    });
  }

  for (const ch of load.channels) {
    if (ch.status === "over") {
      messages.push({
        kind: "danger",
        text: t("powerPlan.warning.channelOver", {
          channel: ch.channel.index,
          amps: fmtNum(ch.amps, 1),
          limit: ch.channel.breakerAmps,
        }),
      });
    } else if (ch.status === "warn") {
      messages.push({
        kind: "warn",
        text: t("powerPlan.warning.channelDerate", {
          channel: ch.channel.index,
          amps: fmtNum(ch.amps, 1),
          limit: ch.channel.breakerAmps,
        }),
      });
    }
  }

  if (load.imbalanceWarn) {
    messages.push({
      kind: "warn",
      text: t("powerPlan.warning.imbalance", { percent: fmtPct(load.imbalance) }),
    });
  }

  if (messages.length === 0 && suggestions.length === 0) return null;

  return (
    <div className="power-warnings">
      {messages.map((m, i) => (
        <div
          key={i}
          className={
            m.kind === "danger"
              ? "power-warning power-warning--danger"
              : m.kind === "warn"
                ? "power-warning power-warning--warn"
                : "power-warning"
          }
        >
          {m.text}
        </div>
      ))}
      {suggestions.map((s, i) => (
        <div key={`s${i}`} className="power-warning power-warning--info">
          <strong>{t("powerPlan.suggestion")}:</strong>{" "}
          {t(SUGGESTION_MESSAGE_KEYS[s.type], {
            qty: s.qty,
            fixture: s.fixtureRef,
            from: s.fromChannelIndex,
            to: s.toChannelIndex,
          })}{" "}
          <span className="power-warning-hint">
            ({t("powerPlan.suggestion.advisory")})
          </span>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Feed graph — "HOT1 → LX1 60% · LX2 40%"
// ──────────────────────────────────────────────────────────────────────

function FeedGraph({
  distroName,
  split,
  systems,
}: {
  distroName: string;
  split: DistroTrussShare[];
  systems: SystemLite[];
}) {
  const t = useT();
  const trussNameById = new Map(systems.map((s) => [s.id, s.name]));
  return (
    <div className="power-feed-graph" aria-label={t("powerPlan.feedGraphAria")}>
      <div className="power-feed-graph-head">
        <span className="power-feed-graph-from">{distroName}</span>
        <span className="power-feed-graph-arrow" aria-hidden="true">→</span>
        <span className="power-feed-graph-summary">
          {split
            .map(
              (s) =>
                `${trussNameById.get(s.trussId) ?? s.trussId} ${Math.round(s.ratio * 100)}%`,
            )
            .join(" · ")}
        </span>
      </div>
      <div className="power-feed-graph-bar" role="img" aria-label={t("powerPlan.feedShareBarAria")}>
        {split.map((s, i) => (
          <div
            key={s.trussId}
            className={`power-feed-graph-seg power-feed-graph-seg--${i % 4}`}
            style={{ width: `${Math.max(2, s.ratio * 100)}%` }}
            title={`${trussNameById.get(s.trussId) ?? s.trussId}: ${fmtInt(s.watts)} W (${Math.round(s.ratio * 100)}%)`}
          >
            <span className="power-feed-graph-seg-label">
              {trussNameById.get(s.trussId) ?? s.trussId}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Suggestion banner — top-of-card, one-click "Apply"
// ──────────────────────────────────────────────────────────────────────

function SuggestionBanner({
  suggestion,
  load,
  systems,
  onApply,
}: {
  suggestion: DistroSuggestion;
  load: DistroLoad;
  systems: SystemLite[];
  onApply: () => void;
}) {
  const t = useT();
  const trussName =
    systems.find((s) => s.id === suggestion.trussId)?.name ?? suggestion.trussId;
  // Severity colour follows the distro's worst state so the banner
  // matches the urgency of the card.
  const sev =
    load.feederStatus === "over" || load.hasChannelOverload
      ? "over"
      : load.feederStatus === "warn" ||
          load.hasChannelWarning ||
          load.imbalanceWarn
        ? "warn"
        : "ok";
  return (
    <div className={severityClass(sev, "power-suggestion-banner")}>
      <div className="power-suggestion-banner-icon" aria-hidden="true">💡</div>
      <div className="power-suggestion-banner-text">
        <strong>{t("powerPlan.suggestedFix")}:</strong>{" "}
        {t(SUGGESTION_MESSAGE_KEYS[suggestion.type], {
          qty: suggestion.qty,
          fixture: suggestion.fixtureRef,
          from: suggestion.fromChannelIndex,
          to: suggestion.toChannelIndex,
        })}{" "}
        <span className="power-suggestion-banner-truss">
          {t("powerPlan.onTruss", { truss: trussName })}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={onApply}
        title={t("powerPlan.applyRebalanceTitle")}
      >
        {t("powerPlan.apply")}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Truss-first panel — fixtures → power, above the distro list
// ──────────────────────────────────────────────────────────────────────

function TrussPowerPanel({
  rows,
  unpowered,
  onAutoAssignTruss,
}: {
  rows: TrussPowerRow[];
  unpowered: ReturnType<typeof computeUnpoweredFixtures>;
  onAutoAssignTruss: (trussId: string) => void;
}) {
  const t = useT();
  const unpoweredByTruss = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of unpowered) {
      m.set(u.trussId, (m.get(u.trussId) ?? 0) + u.remainingQty);
    }
    return m;
  }, [unpowered]);

  return (
    <section className="power-truss-panel led-card">
      <header className="power-truss-panel-head">
        <h3>{t("powerPlan.trusses")}</h3>
        <span className="power-truss-panel-hint">
          {t("powerPlan.trussesHint")}
        </span>
      </header>
      <div className="power-truss-panel-rows">
        {rows.map((row) => {
          const unpoweredOnRow = unpoweredByTruss.get(row.trussId) ?? 0;
          const ratioFed =
            row.totalWatts > 0 ? row.assignedWatts / row.totalWatts : 0;
          const sev: LoadSeverity =
            unpoweredOnRow > 0 ? "warn" : row.totalQty === 0 ? "ok" : "ok";
          return (
            <div
              key={row.trussId}
              className={severityClass(sev, "power-truss-row")}
            >
              <div className="power-truss-row-head">
                <strong className="power-truss-row-name">{row.trussName}</strong>
                <span className="power-truss-row-totals">
                  {fmtInt(row.totalWatts)} W
                  <span className="power-truss-row-cap">
                    {" "}
                    · {fmtInt(row.assignedWatts)} W {t("powerPlan.fed")} ({fmtPct(ratioFed)})
                  </span>
                </span>
                {unpoweredOnRow > 0 ? (
                  <button
                    type="button"
                    className="btn btn-soft btn-sm"
                    onClick={() => onAutoAssignTruss(row.trussId)}
                    title={t("powerPlan.autoAssignTitle", {
                      count: unpoweredOnRow,
                      truss: row.trussName,
                    })}
                  >
                    ⚡ {t("powerPlan.autoAssign")}
                  </button>
                ) : (
                  <span className="power-truss-row-ok-badge" title={t("powerPlan.allPoweredTitle")}>
                    ✓ {t("powerPlan.powered")}
                  </span>
                )}
              </div>
              {row.fixtures.length > 0 ? (
                <ul className="power-truss-row-fixtures">
                  {row.fixtures.map((f) => (
                    <li key={f.name} className="power-truss-row-fixture">
                      <span className="power-truss-row-fixture-qty">
                        {f.qty}×
                      </span>{" "}
                      <span className="power-truss-row-fixture-name">
                        {f.name}
                      </span>{" "}
                      <span className="power-truss-row-fixture-w">
                        ({fmtInt(f.watts)} W)
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="power-truss-row-empty">{t("powerPlan.noFixturesOnTruss")}</div>
              )}
              {row.feedingDistros.length > 0 ? (
                <div className="power-truss-row-feeders">
                  <span className="power-truss-row-feeders-label">{t("powerPlan.fedBy")}:</span>
                  {row.feedingDistros.map((fd) => (
                    <span key={fd.distroId} className="power-truss-feeder-chip">
                      {fd.distroName}
                      {fd.watts > 0 && (
                        <span className="power-truss-feeder-share">
                          {" "}
                          {Math.round(fd.ratio * 100)}%
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : row.totalQty > 0 ? (
                <div className="power-truss-row-feeders power-truss-row-feeders--empty">
                  <span className="power-truss-row-feeders-label">{t("powerPlan.fedBy")}:</span>
                  <span className="power-truss-feeder-chip power-truss-feeder-chip--missing">
                    {t("powerPlan.nothingYet")}
                  </span>
                </div>
              ) : null}
              {unpoweredOnRow > 0 && (
                <div className="power-truss-row-unpowered">
                  {t(
                    unpoweredOnRow === 1
                      ? "powerPlan.fixtureNotPowered.one"
                      : "powerPlan.fixtureNotPowered.many",
                    { count: unpoweredOnRow },
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Auto-suggest modal — confirms the proposed power layout before append
// ──────────────────────────────────────────────────────────────────────

function AutoSuggestModal({
  suggested,
  onApply,
  onClose,
}: {
  suggested: SuggestedDistro[];
  onApply: (picks: SuggestedDistro[]) => void;
  onClose: () => void;
}) {
  const t = useT();
  const totalWatts = suggested.reduce((s, x) => s + x.totalWatts, 0);
  const totalUnits = suggested.reduce((s, x) => s + x.fixtureUnits, 0);
  return (
    <div
      className="power-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="power-modal power-auto-suggest-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="power-modal-head">
          <h3>{t("powerPlan.autoSuggest.modalTitle")}</h3>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </header>
        {suggested.length === 0 ? (
          <p className="power-modal-intro">
            {t("powerPlan.autoSuggest.empty")}
          </p>
        ) : (
          <p className="power-modal-intro">
            {t("powerPlan.autoSuggest.proposed", {
              distros: suggested.length,
              fixtures: totalUnits,
              watts: fmtInt(totalWatts),
            })}
          </p>
        )}
        <ul className="power-auto-suggest-list">
          {suggested.map((s) => (
            <li key={s.key} className="power-auto-suggest-item">
              <div className="power-auto-suggest-item-head">
                <strong>{s.trussName}</strong>{" "}
                <span className="power-auto-suggest-item-preset">
                  → {t(PRESET_LABEL_KEYS[s.presetId])}
                </span>
              </div>
              <div className="power-auto-suggest-item-stats">
                 {fmtInt(s.totalWatts)} W ·{" "}
                 {t(s.fixtureUnits === 1 ? "powerPlan.fixtureCount.one" : "powerPlan.fixtureCount.many", { count: s.fixtureUnits })} ·{" "}
                 {t(s.drops.length === 1 ? "powerPlan.dropCount.one" : "powerPlan.dropCount.many", { count: s.drops.length })}
              </div>
              <ul className="power-auto-suggest-item-drops">
                {s.drops.map((d, i) => (
                  <li key={i}>
                    Ch{d.channelIndex}: {d.qty} × {d.fixtureRef}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <footer className="power-modal-foot">
          <button type="button" className="btn btn-soft" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onApply(suggested)}
            disabled={suggested.length === 0}
          >
            {t("powerPlan.applyAll", { count: suggested.length })}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Channel row
// ──────────────────────────────────────────────────────────────────────

type ChannelRowProps = {
  distro: Distro;
  channelLoad: ChannelLoad;
  systems: SystemLite[];
  systemNameById: Map<string, string>;
  fixtures: FixtureRef[];
  onUpdateChannel: (
    patch: Partial<Omit<Channel, "drops" | "id" | "index">>,
  ) => void;
  onAddDrop: (
    drop: { trussId: string; fixtureRef: string; qty: number; cable?: DropCableKind },
  ) => void;
  onUpdateDrop: (
    dropId: string,
    patch: Partial<Omit<Drop, "id">>,
  ) => void;
  onRemoveDrop: (dropId: string) => void;
};

function ChannelRow(props: ChannelRowProps) {
  const t = useT();
  const { channelLoad: cl, distro, systems, systemNameById, fixtures } = props;
  const channel = cl.channel;
  const sev = cl.status;
  const phaseLabel = cl.phase ?? "—";
  const dropCount = cl.drops.length;
  const fixtureCount = cl.drops.reduce((s, d) => s + d.drop.qty, 0);

  // Channel-level accordion: header (Ch1 · phase · breaker · summary
  // load) is always shown; drop list + add-drop form collapse. Empty
  // channels default to collapsed so the user sees the channel grid
  // as a scannable strip first; channels with drops default open.
  const [open, setOpen] = useState<boolean>(dropCount > 0);

  return (
    <div
      className={severityClass(
        sev,
        `power-channel${open ? "" : " power-channel--collapsed"}`,
      )}
    >
      {/* Channel header is a single click-target so the whole row is
          easy to expand/collapse. We use a button so keyboard users
          can toggle with Enter / Space. */}
      <button
        type="button"
        className="power-channel-head power-channel-head--toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={
          open
            ? t("powerPlan.collapseChannel", { channel: channel.index })
            : t("powerPlan.expandChannel", { channel: channel.index })
        }
      >
        <span className="power-channel-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span className="power-channel-id">
          <strong>Ch{channel.index}</strong>
          <span className="power-channel-phase">{phaseLabel}</span>
          <span className="power-channel-breaker">
            {channel.breakerAmps} A
          </span>
        </span>
        <span className="power-channel-stats">
          <span>{fmtInt(cl.watts)} W</span>
          <span>{fmtNum(cl.amps, 1)} A</span>
          <span>{fmtPct(cl.utilization)}</span>
          <span className="power-channel-fixtures">
            {fixtureCount === 0
              ? t("powerPlan.noFixtures")
              : t(
                  fixtureCount === 1
                    ? "powerPlan.fixtureCount.one"
                    : "powerPlan.fixtureCount.many",
                  { count: fixtureCount },
                )}
          </span>
        </span>
      </button>

      <div className="power-channel-bar">
        <div
          className="power-channel-bar-fill"
          style={{ width: `${Math.min(100, cl.utilization * 100)}%` }}
        />
        <div
          className="power-channel-bar-derate"
          style={{ left: `${POWER_DERATE_FACTOR * 100}%` }}
          aria-hidden="true"
        />
      </div>

      {open && (
        <>
          <div className="power-drops">
            {cl.drops.length === 0 ? (
              <div className="power-drops-empty">{t("powerPlan.noDrops")}</div>
            ) : (
              cl.drops.map((dl) => (
                <DropChip
                  key={dl.drop.id}
                  drop={dl.drop}
                  watts={dl.watts}
                  amps={dl.amps}
                  trussName={systemNameById.get(dl.drop.trussId) ?? "—"}
                  onChangeQty={(qty) => props.onUpdateDrop(dl.drop.id, { qty })}
                  onChangeCable={(cable) =>
                    props.onUpdateDrop(dl.drop.id, { cable })
                  }
                  onRemove={() => props.onRemoveDrop(dl.drop.id)}
                />
              ))
            )}
          </div>

          <AddDropForm
            distro={distro}
            systems={systems}
            fixtures={fixtures}
            onAdd={(drop) => props.onAddDrop(drop)}
          />
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Drop chip
// ──────────────────────────────────────────────────────────────────────

function DropChip({
  drop,
  watts,
  amps,
  trussName,
  onChangeQty,
  onChangeCable,
  onRemove,
}: {
  drop: Drop;
  watts: number;
  amps: number;
  trussName: string;
  onChangeQty: (qty: number) => void;
  onChangeCable: (cable: DropCableKind | undefined) => void;
  onRemove: () => void;
}) {
  const t = useT();
  // Condensed by default — show only Fixture name, Qty, Total Load.
  // Click reveals secondary metadata (source truss, per-unit amps,
  // cable type) and editor controls. The remove (×) button always
  // sits on the right so destructive action stays predictable.
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`power-drop-chip${expanded ? " power-drop-chip--expanded" : ""}`}
    >
      <button
        type="button"
        className="power-drop-chip-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={
          expanded
            ? t("powerPlan.collapseDrop")
            : t("powerPlan.editDropTitle")
        }
      >
        <span className="power-drop-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        <span className="power-drop-fx" title={drop.fixtureRef}>
          {drop.fixtureRef || "—"}
        </span>
        <span className="power-drop-qty-pill">×{drop.qty}</span>
        <span className="power-drop-load">{fmtInt(watts)} W</span>
      </button>

      {expanded && (
        <div className="power-drop-chip-detail">
          <label className="power-drop-detail-field">
            <span>{t("powerPlan.truss")}</span>
            <span className="power-drop-truss">{trussName}</span>
          </label>
          <label className="power-drop-detail-field">
            <span>{t("powerPlan.qty")}</span>
            <NumberField
              className="led-input led-input-num power-drop-qty"
              min={1}
              step={1}
              value={drop.qty}
              transform={(n) => Math.max(1, Math.round(n || 1))}
              emptyValue={1}
              onCommit={(qty) => onChangeQty(qty)}
              aria-label={t("powerPlan.dropQuantity")}
            />
          </label>
          <label className="power-drop-detail-field">
            <span>{t("powerPlan.cable")}</span>
            <select
              className="led-input power-drop-cable"
              value={drop.cable ?? ""}
              onChange={(e) =>
                onChangeCable(
                  e.target.value
                    ? (e.target.value as DropCableKind)
                    : undefined,
                )
              }
              aria-label={t("powerPlan.cableType")}
            >
              <option value="">{t("powerPlan.cable")}…</option>
              {DROP_CABLE_KINDS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <span className="power-drop-detail-stats">
            {fmtNum(amps, 1)} A {t("powerPlan.draw")}
          </span>
        </div>
      )}

      <button
        type="button"
        className="btn btn-danger btn-sm power-drop-remove"
        onClick={onRemove}
        title={t("powerPlan.removeDrop")}
      >
        ×
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Add drop inline form
// ──────────────────────────────────────────────────────────────────────

function AddDropForm({
  distro,
  systems,
  fixtures,
  onAdd,
}: {
  distro: Distro;
  systems: SystemLite[];
  fixtures: FixtureRef[];
  onAdd: (drop: { trussId: string; fixtureRef: string; qty: number; cable?: DropCableKind }) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  // Truss options — restricted to distro.feedsTrusses (or all if none picked).
  const trussOptions = useMemo(() => {
    const allowed =
      distro.feedsTrusses.length > 0
        ? new Set(distro.feedsTrusses)
        : new Set(systems.map((s) => s.id));
    return systems.filter((s) => allowed.has(s.id));
  }, [systems, distro.feedsTrusses]);

  const [trussId, setTrussId] = useState<string>("");
  const [fixtureRef, setFixtureRef] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [cable, setCable] = useState<DropCableKind | "">("");

  // Reset form when opening.
  const reset = () => {
    setTrussId(trussOptions[0]?.id ?? "");
    setFixtureRef("");
    setQty(1);
    setCable("");
  };

  // Fixture options for the chosen truss.
  const fixtureOptions = useMemo(() => {
    if (!trussId) return [] as FixtureRef[];
    return fixtures.filter(
      (f) => f.systemId === trussId && f.name.trim().length > 0,
    );
  }, [fixtures, trussId]);

  if (!open) {
    return (
      <div className="power-add-drop-row">
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={() => {
            setOpen(true);
            reset();
          }}
          disabled={trussOptions.length === 0}
          title={
            trussOptions.length === 0
              ? t("powerPlan.pickTrussFirst")
              : undefined
          }
        >
          + {t("powerPlan.addFixtures")}
        </button>
        {trussOptions.length === 0 && (
          <span className="power-add-drop-hint">
            {t("powerPlan.pickTrussHint")}
          </span>
        )}
      </div>
    );
  }

  const canSubmit =
    trussId.length > 0 && fixtureRef.length > 0 && qty > 0;

  return (
    <div className="power-add-drop-form">
      <select
        className="led-input"
        value={trussId}
        onChange={(e) => {
          setTrussId(e.target.value);
          setFixtureRef("");
        }}
        aria-label={t("powerPlan.truss")}
      >
        {trussOptions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        className="led-input"
        value={fixtureRef}
        onChange={(e) => setFixtureRef(e.target.value)}
        aria-label={t("powerPlan.fixture")}
      >
        <option value="">{t("powerPlan.fixture")}…</option>
        {fixtureOptions.length === 0 ? (
          <option value="" disabled>
            ({t("powerPlan.noFixturesOnTruss")})
          </option>
        ) : (
          fixtureOptions.map((f, i) => (
            <option key={`${f.name}-${i}`} value={f.name}>
            {f.name} · {f.qty} {t("powerPlan.pcs")} · {fmtInt(f.watts)} W
            </option>
          ))
        )}
      </select>
      <NumberField
        className="led-input led-input-num"
        min={1}
        step={1}
        value={qty}
        transform={(n) => Math.max(1, Math.round(n || 1))}
        emptyValue={1}
        onCommit={(n) => setQty(n)}
        aria-label={t("powerPlan.quantity")}
      />
      <select
        className="led-input"
        value={cable}
        onChange={(e) => setCable(e.target.value as DropCableKind | "")}
        aria-label={t("powerPlan.cable")}
      >
        <option value="">{t("powerPlan.cable")}…</option>
        {DROP_CABLE_KINDS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!canSubmit}
        onClick={() => {
          onAdd({
            trussId,
            fixtureRef,
            qty,
            cable: cable || undefined,
          });
          reset();
          setOpen(false);
        }}
      >
        {t("common.add")}
      </button>
      <button
        type="button"
        className="btn btn-soft btn-sm"
        onClick={() => setOpen(false)}
      >
        {t("common.cancel")}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Unpowered fixtures panel
// ──────────────────────────────────────────────────────────────────────

function UnpoweredFixturesPanel({
  unpowered,
  systems,
}: {
  unpowered: ReturnType<typeof computeUnpoweredFixtures>;
  systems: SystemLite[];
}) {
  const t = useT();
  const systemNameById = new Map(systems.map((s) => [s.id, s.name]));
  const total = unpowered.reduce((n, u) => n + u.remainingQty, 0);
  return (
    <section className="led-card power-unpowered">
      <div className="power-unpowered-head">
        <h3>{t("powerPlan.unpowered.title")}</h3>
        <span className="badge badge-warn">{t("powerPlan.remainingCount", { count: total })}</span>
      </div>
      <table className="led-table">
        <thead>
          <tr>
            <th>{t("powerPlan.fixture")}</th>
            <th>{t("powerPlan.truss")}</th>
            <th className="led-num">{t("powerPlan.total")}</th>
            <th className="led-num">{t("powerPlan.powered")}</th>
            <th className="led-num">{t("powerPlan.remaining")}</th>
            <th className="led-num">{t("powerPlan.wPerUnit")}</th>
          </tr>
        </thead>
        <tbody>
          {unpowered.map((u, i) => (
            <tr key={`${u.fixtureRef}-${u.trussId}-${i}`}>
              <td>{u.fixtureRef}</td>
              <td>{systemNameById.get(u.trussId) ?? u.trussId}</td>
              <td className="led-num">{u.totalQty}</td>
              <td className="led-num">{u.assignedQty}</td>
              <td className="led-num">
                <strong>{u.remainingQty}</strong>
              </td>
              <td className="led-num">{fmtInt(u.wattsPerUnit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Legacy circuits read-only panel
// ──────────────────────────────────────────────────────────────────────

function LegacyCircuitsPanel({
  circuits,
  onRemoveCircuit,
}: {
  circuits: PowerCircuit[];
  onRemoveCircuit: (id: string) => void;
}) {
  const t = useT();
  return (
    <section className="led-card power-legacy">
      <div className="power-legacy-head">
        <h3>{t("powerPlan.legacy.title")}</h3>
        <span className="badge">{t("powerPlan.legacy.readOnly")}</span>
      </div>
      <p className="power-legacy-help">
        {t("powerPlan.legacy.help")}
      </p>
      {circuits.map((c) => {
        const load = computeCircuitLoad(c);
        return (
          <div key={c.id} className="power-legacy-circuit">
            <div className="power-legacy-circuit-head">
              <strong>{c.name}</strong>
              <span>{c.source}</span>
              <span>
                {c.voltage} V × {c.ampsPerPhase} A · {fmtInt(load.totalWatts)} W
                · {t("powerPlan.worst")} {fmtPct(load.worstRatio)}
              </span>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => onRemoveCircuit(c.id)}
              >
                {t("common.remove")}
              </button>
            </div>
            {c.items.length > 0 && (
              <table className="led-table">
                <thead>
                  <tr>
                    <th>{t("powerPlan.item")}</th>
                    <th>{t("powerPlan.phase")}</th>
                    <th className="led-num">{t("powerPlan.qty")}</th>
                    <th className="led-num">{t("powerPlan.wPerUnitCompact")}</th>
                    <th className="led-num">{t("powerPlan.subtotalW")}</th>
                    <th>{t("powerPlan.notes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.name}</td>
                      <td>{it.phase}</td>
                      <td className="led-num">{it.qty}</td>
                      <td className="led-num">{fmtInt(it.wattsPerUnit)}</td>
                      <td className="led-num">
                        {fmtInt(it.qty * it.wattsPerUnit)}
                      </td>
                      <td>{it.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}

// Re-export so legacy callers that imported applyPresetToDistro from this
// module path still resolve (none currently, but keeps the surface stable).
export { applyPresetToDistro, POWER_PHASES };
