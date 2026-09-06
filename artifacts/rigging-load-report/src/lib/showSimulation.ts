import {
  computeDistroLoad,
  computeDistroPlanTotals,
  computeUnpoweredFixtures,
  makeFixtureWattsLookup,
  type DistroLoad,
  type FixtureRef,
  type PowerPlan,
} from "./power";
import { type CrewMember } from "./crew";
import { computeSoundTotals, type SoundItem } from "./sound";
import {
  computeStage,
  computeStageTotals,
  type Stage,
  type StageCalc,
} from "./stage";
import {
  computeLedTotals,
  type LedPanel,
  type LedScreen,
  type LedSettings,
} from "./led";
import type {
  ClientPackSystem,
  ClientPackSchedulePhase,
  ClientPackProject,
} from "./clientPackExport";
import type { Locale, TranslationKey } from "./i18n/types";

type SimulationCopyKey = Extract<TranslationKey, `export.simulation.${string}`>;
export type ShowSimulationCopy = (
  key: SimulationCopyKey,
  params?: Record<string, string | number>,
) => string;

type SimulationI18n = {
  locale: Locale;
  copy: ShowSimulationCopy;
};

export type ShowSimulationInput = {
  locale: Locale;
  copy: ShowSimulationCopy;
  project: ClientPackProject;
  schedule: ClientPackSchedulePhase[];
  systems: ClientPackSystem[];
  power: PowerPlan;
  fixtures: FixtureRef[];
  crew: CrewMember[];
  sound: SoundItem[];
  stages: Stage[];
  ledScreens: LedScreen[];
  ledSettings: LedSettings;
  ledPanels: LedPanel[];
  /** Currently-active floor-plan PNG/JPEG/WebP data URL (PDFs are
   *  pre-rasterised to PNG by the floor-plan helper). Embedded as the
   *  final page of the simulation so the producer hands the venue
   *  drawing along with the readiness verdict. `null` / undefined
   *  hides the section entirely. */
  floorPlanDataUrl?: string | null;
  /** Original file name for the caption (e.g. "Hall A — rigg.pdf"). */
  floorPlanFileName?: string | null;
  logoDataUrl: string | null;
  targetWin: Window | null;
};

// ─── Formatting helpers ───────────────────────────────────────────────

const fmt = (n: number, i18n: SimulationI18n, d = 1): string =>
  Number.isFinite(n)
    ? n.toLocaleString(i18n.locale === "no" ? "nb-NO" : "en-US", {
        maximumFractionDigits: d,
      })
    : i18n.copy("export.simulation.notSpecified");

const fmtInt = (n: number, i18n: SimulationI18n): string =>
  Number.isFinite(n)
    ? Math.round(n).toLocaleString(i18n.locale === "no" ? "nb-NO" : "en-US", {
        maximumFractionDigits: 0,
      })
    : i18n.copy("export.simulation.notSpecified");

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const orNS = (
  v: string | number | null | undefined,
  i18n: SimulationI18n,
): string => {
  const ns = i18n.copy("export.simulation.notSpecified");
  if (v === null || v === undefined) return escapeHtml(ns);
  if (typeof v === "string" && v.trim() === "") return escapeHtml(ns);
  if (typeof v === "number" && !Number.isFinite(v)) return escapeHtml(ns);
  return escapeHtml(String(v));
};

// ─── Risk model ───────────────────────────────────────────────────────

type RiskLevel = "safe" | "warn" | "danger";

type RiskItem = {
  level: RiskLevel;
  area: string;
  message: string;
};

const riskPill = (
  level: RiskLevel,
  i18n: SimulationI18n,
  label?: string,
): string => {
  const dot = level === "danger" ? "🔴" : level === "warn" ? "🟠" : "🟢";
  const text =
    label ??
    (level === "danger"
      ? i18n.copy("export.simulation.status.atRisk")
      : level === "warn"
        ? i18n.copy("export.simulation.status.warning")
        : i18n.copy("export.simulation.status.ready"));
  return `<span class="risk-pill risk-${level}">${dot} ${escapeHtml(text)}</span>`;
};

const worstLevel = (risks: RiskItem[]): RiskLevel => {
  if (risks.some((r) => r.level === "danger")) return "danger";
  if (risks.some((r) => r.level === "warn")) return "warn";
  return "safe";
};

// Per-discipline risk collectors

function riggingRisks(systems: ClientPackSystem[], i18n: SimulationI18n): RiskItem[] {
  const out: RiskItem[] = [];
  for (const sys of systems) {
    const m = sys.metrics;
    if (m.swl > 0 && m.peak > m.swl) {
      out.push({
        level: "danger",
        area: i18n.copy("export.simulation.area.named", { area: i18n.copy("export.simulation.area.rigging"), name: sys.name }),
        message: i18n.copy("export.simulation.risk.riggingOver", { peak: fmtInt(m.peak, i18n), swl: fmtInt(m.swl, i18n), percent: fmt((m.peak / m.swl) * 100, i18n, 0) }),
      });
    } else if (m.swl > 0 && m.peak / m.swl > 0.85) {
      out.push({
        level: "warn",
        area: i18n.copy("export.simulation.area.named", { area: i18n.copy("export.simulation.area.rigging"), name: sys.name }),
        message: i18n.copy("export.simulation.risk.riggingNear", { percent: fmt((m.peak / m.swl) * 100, i18n, 0) }),
      });
    }
  }
  if (systems.length === 0) {
    out.push({
      level: "warn",
      area: i18n.copy("export.simulation.area.rigging"),
      message: i18n.copy("export.simulation.risk.noRigging"),
    });
  }
  return out;
}

function lightingRisks(
  loads: DistroLoad[],
  unpoweredFixtureCount: number,
  i18n: SimulationI18n,
): RiskItem[] {
  const out: RiskItem[] = [];
  loads.forEach((d) => {
    const name = d.distro.name || i18n.copy("export.simulation.distro");
    if (d.feederUtilization > 1) {
      out.push({
        level: "danger",
        area: i18n.copy("export.simulation.area.named", { area: i18n.copy("export.simulation.area.power"), name }),
        message: i18n.copy("export.simulation.risk.feederOver", { percent: fmt(d.feederUtilization * 100, i18n, 0) }),
      });
    } else if (d.feederUtilization > 0.85) {
      out.push({
        level: "warn",
        area: i18n.copy("export.simulation.area.named", { area: i18n.copy("export.simulation.area.power"), name }),
        message: i18n.copy("export.simulation.risk.feederNear", { percent: fmt(d.feederUtilization * 100, i18n, 0) }),
      });
    }
    if (d.distro.feedPhases === 3 && d.imbalance > 0.2) {
      out.push({
        level: "warn",
        area: i18n.copy("export.simulation.area.named", { area: i18n.copy("export.simulation.area.power"), name }),
        message: i18n.copy("export.simulation.risk.phaseImbalance", { percent: fmt(d.imbalance * 100, i18n, 0) }),
      });
    }
  });
  if (unpoweredFixtureCount > 0) {
    out.push({
      level: "warn",
      area: i18n.copy("export.simulation.area.power"),
      message: i18n.copy(unpoweredFixtureCount === 1 ? "export.simulation.risk.unpowered.one" : "export.simulation.risk.unpowered.many", { count: unpoweredFixtureCount }),
    });
  }
  return out;
}

/** Capacity-aware LED risk:
 *  - if no processor is selected AND there are screens needing ports →
 *    warn (we cannot validate capacity);
 *  - if any single screen exceeds the configured pixels-per-output cap →
 *    critical. We deliberately don't duplicate the in-app processor
 *    capacity banner here — that's the source of truth for the chosen
 *    processor's published output count. */
function ledRisks(
  ledScreens: LedScreen[],
  ledSettings: LedSettings,
  ledPanels: LedPanel[],
  i18n: SimulationI18n,
): RiskItem[] {
  const out: RiskItem[] = [];
  if (ledScreens.length === 0) return out;
  const totals = computeLedTotals(ledScreens, ledSettings, ledPanels);
  if (ledSettings.portLimit > 0 && totals.largestScreenPixels > ledSettings.portLimit) {
    out.push({
      level: "danger",
      area: i18n.copy("export.simulation.area.led"),
      message: i18n.copy("export.simulation.risk.ledOver", { pixels: fmtInt(totals.largestScreenPixels, i18n), limit: fmtInt(ledSettings.portLimit, i18n) }),
    });
  }
  if (!ledSettings.processorId && totals.portsNeeded > 0) {
    out.push({
      level: "warn",
      area: i18n.copy("export.simulation.area.led"),
      message: i18n.copy(totals.portsNeeded === 1 ? "export.simulation.risk.processorMissing.one" : "export.simulation.risk.processorMissing.many", { count: totals.portsNeeded }),
    });
  }
  return out;
}

function stageRisks(stages: Stage[], stageCalcs: StageCalc[], i18n: SimulationI18n): RiskItem[] {
  const out: RiskItem[] = [];
  stageCalcs.forEach((s, i) => {
    const name = stages[i]?.name || i18n.copy("export.simulation.area.stage");
    if (
      s.loadCapacityKg > 0 &&
      s.totalWeight > 0 &&
      s.totalWeight > s.loadCapacityKg
    ) {
      out.push({
        level: "danger",
        area: i18n.copy("export.simulation.area.named", { area: i18n.copy("export.simulation.area.stage"), name }),
        message: i18n.copy("export.simulation.risk.stageOver", { weight: fmtInt(s.totalWeight, i18n), capacity: fmtInt(s.loadCapacityKg, i18n) }),
      });
    } else if (
      s.loadCapacityKg > 0 &&
      s.totalWeight / s.loadCapacityKg > 0.85
    ) {
      out.push({
        level: "warn",
        area: i18n.copy("export.simulation.area.named", { area: i18n.copy("export.simulation.area.stage"), name }),
        message: i18n.copy("export.simulation.risk.stageNear", { percent: fmt((s.totalWeight / s.loadCapacityKg) * 100, i18n, 0) }),
      });
    }
  });
  return out;
}

function crewRisks(crew: CrewMember[], i18n: SimulationI18n): RiskItem[] {
  const out: RiskItem[] = [];
  if (crew.length === 0) {
    out.push({
      level: "warn",
      area: i18n.copy("export.simulation.area.crew"),
      message: i18n.copy("export.simulation.risk.noCrew"),
    });
    return out;
  }
  const missingCall = crew.filter((c) => !c.callTime);
  const missingName = crew.filter((c) => !c.name?.trim());
  if (missingCall.length > 0) {
    out.push({
      level: "warn",
      area: i18n.copy("export.simulation.area.crew"),
      message: i18n.copy(missingCall.length === 1 ? "export.simulation.risk.missingCall.one" : "export.simulation.risk.missingCall.many", { count: missingCall.length }),
    });
  }
  if (missingName.length > 0) {
    out.push({
      level: "warn",
      area: i18n.copy("export.simulation.area.crew"),
      message: i18n.copy(missingName.length === 1 ? "export.simulation.risk.missingName.one" : "export.simulation.risk.missingName.many", { count: missingName.length }),
    });
  }
  return out;
}

function scheduleRisks(schedule: ClientPackSchedulePhase[], i18n: SimulationI18n): RiskItem[] {
  const out: RiskItem[] = [];
  if (schedule.length === 0) {
    out.push({
      level: "warn",
      area: i18n.copy("export.simulation.area.schedule"),
      message: i18n.copy("export.simulation.risk.noSchedule"),
    });
    return out;
  }
  for (const phase of schedule) {
    const blank = phase.segments.filter((s) => !s.from && !s.to);
    if (blank.length > 0) {
      out.push({
        level: "warn",
        area: i18n.copy("export.simulation.area.named", { area: i18n.copy("export.simulation.area.schedule"), name: phase.label }),
        message: i18n.copy(blank.length === 1 ? "export.simulation.risk.undated.one" : "export.simulation.risk.undated.many", { count: blank.length }),
      });
    }
  }
  return out;
}

// ─── Discipline status blocks ─────────────────────────────────────────

function riggingBlock(systems: ClientPackSystem[], i18n: SimulationI18n): string {
  const ns = escapeHtml(i18n.copy("export.simulation.notSpecified"));
  if (systems.length === 0) {
    return `<div class="disc-block">
      <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.rigging"))} ${riskPill("warn", i18n, i18n.copy("export.simulation.status.noSystems"))}</div>
      <p class="muted">${ns}</p>
    </div>`;
  }
  const rows = systems
    .map((sys) => {
      const m = sys.metrics;
      const util = m.swl > 0 ? (m.peak / m.swl) * 100 : 0;
      const lvl: RiskLevel =
        m.swl > 0 && m.peak > m.swl
          ? "danger"
          : m.swl > 0 && m.peak / m.swl > 0.85
            ? "warn"
            : "safe";
      return `<tr>
        <td><strong>${escapeHtml(sys.name)}</strong></td>
        <td>${escapeHtml(sys.hoistName || i18n.copy("export.simulation.notSpecified"))}</td>
        <td class="num">${fmtInt(m.peak, i18n)} kg</td>
        <td class="num">${m.swl > 0 ? fmtInt(m.swl, i18n) + " kg" : ns}</td>
        <td class="num">${m.swl > 0 ? fmt(util, i18n, 0) + " %" : ns}</td>
        <td>${riskPill(lvl, i18n, i18n.copy(lvl === "danger" ? "export.simulation.status.overSwl" : lvl === "warn" ? "export.simulation.status.watch" : "export.simulation.status.safe"))}</td>
      </tr>`;
    })
    .join("");
  const overall = worstLevel(riggingRisks(systems, i18n));
  return `<div class="disc-block">
    <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.riggingLoad"))} ${riskPill(overall, i18n)}</div>
    <table>
      <thead><tr>${["system","motor","peak","swl","util","status"].map((k, i) => `<th${i >= 2 && i <= 4 ? ' class="num"' : ""}>${escapeHtml(i18n.copy(`export.simulation.table.${k}` as SimulationCopyKey))}</th>`).join("")}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function lightingBlock(
  loads: DistroLoad[],
  unpowered: number,
  totals: { totalWatts: number; worstLegA: number; loaded: number },
  i18n: SimulationI18n,
): string {
  const ns = escapeHtml(i18n.copy("export.simulation.notSpecified"));
  if (loads.length === 0) {
    return `<div class="disc-block">
      <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.lighting"))} ${riskPill("warn", i18n, i18n.copy("export.simulation.status.noDistros"))}</div>
      <p class="muted">${ns}</p>
    </div>`;
  }
  const rows = loads
    .map((d) => {
      const name = d.distro.name || i18n.copy("export.simulation.distro");
      const lvl: RiskLevel =
        d.feederUtilization > 1
          ? "danger"
          : d.feederUtilization > 0.85
            ? "warn"
            : d.distro.feedPhases === 3 && d.imbalance > 0.2
              ? "warn"
              : "safe";
      const phaseCells =
        d.distro.feedPhases === 3
          ? `L1 ${fmtInt(d.phases[0]?.amps ?? 0, i18n)} A · L2 ${fmtInt(d.phases[1]?.amps ?? 0, i18n)} A · L3 ${fmtInt(d.phases[2]?.amps ?? 0, i18n)} A · Δ ${fmt(d.imbalance * 100, i18n, 0)} %`
          : `${fmtInt(d.phases[0]?.amps ?? 0, i18n)} A`;
      return `<tr>
        <td><strong>${escapeHtml(name)}</strong></td>
        <td class="num">${fmtInt(d.totalWatts, i18n)} W</td>
        <td class="num">${fmtInt(d.feederWorstAmps, i18n)} A</td>
        <td class="num">${fmt(d.feederUtilization * 100, i18n, 0)} %</td>
        <td class="phases">${phaseCells}</td>
        <td>${riskPill(lvl, i18n, i18n.copy(lvl === "danger" ? "export.simulation.status.overload" : lvl === "warn" ? "export.simulation.status.watch" : "export.simulation.status.ok"))}</td>
      </tr>`;
    })
    .join("");
  const overall = worstLevel(lightingRisks(loads, unpowered, i18n));
  const unpoweredNote =
    unpowered > 0
      ? `<p class="warn-note">${escapeHtml(i18n.copy(unpowered === 1 ? "export.simulation.unpoweredNote.one" : "export.simulation.unpoweredNote.many", { count: unpowered }))}</p>`
      : "";
  return `<div class="disc-block">
    <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.lighting"))} ${riskPill(overall, i18n)}</div>
    <p class="muted">${escapeHtml(i18n.copy(loads.length === 1 ? "export.simulation.lightingSummary.one" : "export.simulation.lightingSummary.many", { watts: fmtInt(totals.totalWatts, i18n), amps: fmtInt(totals.worstLegA, i18n), count: loads.length }))}</p>
    <table>
      <thead><tr><th>${escapeHtml(i18n.copy("export.simulation.table.distro"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.totalW"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.worstLeg"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.util"))}</th><th>${escapeHtml(i18n.copy("export.simulation.table.phaseBalance"))}</th><th>${escapeHtml(i18n.copy("export.simulation.table.status"))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${unpoweredNote}
  </div>`;
}

function ledBlock(
  ledScreens: LedScreen[],
  ledSettings: LedSettings,
  ledPanels: LedPanel[],
  i18n: SimulationI18n,
): string {
  const ns = escapeHtml(i18n.copy("export.simulation.notSpecified"));
  if (ledScreens.length === 0) {
    return `<div class="disc-block">
      <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.led"))} ${riskPill("safe", i18n, i18n.copy("export.simulation.status.nonePlanned"))}</div>
      <p class="muted">${ns}</p>
    </div>`;
  }
  const totals = computeLedTotals(ledScreens, ledSettings, ledPanels);
  // Status pill must agree with the per-phase risk panel + final
  // verdict — derive it from `ledRisks(...)` rather than a separate
  // hardcoded threshold.
  const ledRiskList = ledRisks(ledScreens, ledSettings, ledPanels, i18n);
  const lvl: RiskLevel = worstLevel(ledRiskList);
  const pillLabel =
    lvl === "danger"
      ? i18n.copy("export.simulation.status.overCap")
      : lvl === "warn"
        ? i18n.copy("export.simulation.status.verifyProcessor")
        : i18n.copy("export.simulation.status.ok");
  const rows = ledScreens
    .map((s) => {
      const panel = ledPanels.find((p) => p.key === s.panelKey);
      const panelLabel = panel?.name ?? s.panelKey ?? i18n.copy("export.simulation.notSpecified");
      const cabinets = s.panelsWide * s.panelsTall;
      return `<tr>
        <td><strong>${orNS(s.name, i18n)}</strong></td>
        <td>${escapeHtml(panelLabel)}</td>
        <td class="num">${fmtInt(s.panelsWide, i18n)} × ${fmtInt(s.panelsTall, i18n)}</td>
        <td class="num">${fmtInt(cabinets, i18n)}</td>
      </tr>`;
    })
    .join("");
  return `<div class="disc-block">
    <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.led"))} ${riskPill(lvl, i18n, pillLabel)}</div>
    <p class="muted">${escapeHtml(i18n.copy("export.simulation.ledSummary", { screens: i18n.copy(totals.screens === 1 ? "export.simulation.screens.one" : "export.simulation.screens.many", { count: fmtInt(totals.screens, i18n) }), panels: i18n.copy(totals.panels === 1 ? "export.simulation.cabinets.one" : "export.simulation.cabinets.many", { count: fmtInt(totals.panels, i18n) }), pixels: fmtInt(totals.pixels, i18n), ports: i18n.copy(totals.portsNeeded === 1 ? "export.simulation.ports.one" : "export.simulation.ports.many", { count: fmtInt(totals.portsNeeded, i18n) }) }))}</p>
    <table>
      <thead><tr><th>${escapeHtml(i18n.copy("export.simulation.table.screen"))}</th><th>${escapeHtml(i18n.copy("export.simulation.table.panel"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.grid"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.cabinets"))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function soundBlock(soundItems: SoundItem[], i18n: SimulationI18n): string {
  if (soundItems.length === 0) {
    return `<div class="disc-block">
      <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.sound"))} ${riskPill("safe", i18n, i18n.copy("export.simulation.status.nonePlanned"))}</div>
      <p class="muted">${escapeHtml(i18n.copy("export.simulation.notSpecified"))}</p>
    </div>`;
  }
  const totals = computeSoundTotals(soundItems);
  return `<div class="disc-block">
    <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.sound"))} ${riskPill("safe", i18n, i18n.copy("export.simulation.status.ready"))}</div>
    <p class="muted">${escapeHtml(i18n.copy("export.simulation.soundSummary", { items: i18n.copy(soundItems.length === 1 ? "export.simulation.lineItems.one" : "export.simulation.lineItems.many", { count: soundItems.length }), units: i18n.copy(totals.totalQty === 1 ? "export.simulation.units.one" : "export.simulation.units.many", { count: totals.totalQty }), weight: fmtInt(totals.totalWeight, i18n), power: fmtInt(totals.totalPower, i18n) }))}</p>
  </div>`;
}

function stageBlock(stages: Stage[], stageCalcs: StageCalc[], i18n: SimulationI18n): string {
  if (stages.length === 0) {
    return `<div class="disc-block">
      <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.stage"))} ${riskPill("safe", i18n, i18n.copy("export.simulation.status.nonePlanned"))}</div>
      <p class="muted">${escapeHtml(i18n.copy("export.simulation.notSpecified"))}</p>
    </div>`;
  }
  const totals = computeStageTotals(stages, stageCalcs);
  const overall = worstLevel(stageRisks(stages, stageCalcs, i18n));
  const rows = stageCalcs
    .map((s, i) => {
      const name = stages[i]?.name || "";
      const util =
        s.loadCapacityKg > 0 ? (s.totalWeight / s.loadCapacityKg) * 100 : 0;
      const lvl: RiskLevel =
        s.loadCapacityKg > 0 && s.totalWeight > s.loadCapacityKg
          ? "danger"
          : s.loadCapacityKg > 0 && s.totalWeight / s.loadCapacityKg > 0.85
            ? "warn"
            : "safe";
      return `<tr>
        <td><strong>${orNS(name, i18n)}</strong></td>
        <td class="num">${fmt(s.areaM2, i18n, 1)} m²</td>
        <td class="num">${fmtInt(s.totalWeight, i18n)} kg</td>
        <td class="num">${s.loadCapacityKg > 0 ? fmtInt(s.loadCapacityKg, i18n) + " kg" : escapeHtml(i18n.copy("export.simulation.notSpecified"))}</td>
        <td class="num">${s.loadCapacityKg > 0 ? fmt(util, i18n, 0) + " %" : escapeHtml(i18n.copy("export.simulation.notSpecified"))}</td>
        <td>${riskPill(lvl, i18n, i18n.copy(lvl === "danger" ? "export.simulation.status.over" : lvl === "warn" ? "export.simulation.status.watch" : "export.simulation.status.ok"))}</td>
      </tr>`;
    })
    .join("");
  return `<div class="disc-block">
    <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.stage"))} ${riskPill(overall, i18n)}</div>
    <p class="muted">${escapeHtml(i18n.copy(totals.stageCount === 1 ? "export.simulation.stageSummary.one" : "export.simulation.stageSummary.many", { count: totals.stageCount, area: fmt(totals.totalArea, i18n, 1), weight: fmtInt(totals.totalWeight, i18n) }))}</p>
    <table>
      <thead><tr><th>${escapeHtml(i18n.copy("export.simulation.table.stage"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.area"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.weight"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.capacity"))}</th><th class="num">${escapeHtml(i18n.copy("export.simulation.table.util"))}</th><th>${escapeHtml(i18n.copy("export.simulation.table.status"))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function crewBlock(crew: CrewMember[], i18n: SimulationI18n): string {
  if (crew.length === 0) {
    return `<div class="disc-block">
      <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.crew"))} ${riskPill("warn", i18n, i18n.copy("export.simulation.status.unassigned"))}</div>
      <p class="muted">${escapeHtml(i18n.copy("export.simulation.notSpecified"))}</p>
    </div>`;
  }
  const present = crew.filter((c) => c.callTime && c.name?.trim());
  const missing = crew.filter((c) => !c.callTime || !c.name?.trim());
  const lvl: RiskLevel = missing.length > 0 ? "warn" : "safe";
  let hotelRooms = 0;
  let hotelNights = 0;
  const hotelLines: string[] = [];
  for (const c of crew) {
    const n = c.hotelDates?.length ?? 0;
    if (n > 0) {
      hotelRooms += 1;
      hotelNights += n;
      hotelLines.push(
        `<li>${escapeHtml(c.name?.trim() || i18n.copy("export.simulation.unnamed"))} · ${escapeHtml(c.role || i18n.copy("export.simulation.notSpecified"))} · 🏨 ${escapeHtml(i18n.copy(n === 1 ? "export.simulation.nights.one" : "export.simulation.nights.many", { count: n }))}</li>`,
      );
    }
  }
  const hotelBlock =
    hotelRooms > 0
      ? `<div style="margin-top:10px;padding:8px 10px;background:#e7f5ec;border-left:3px solid #2f9b5b;border-radius:4px;font-size:13px;">
           <strong>🏨 ${escapeHtml(i18n.copy("export.simulation.hotel"))}:</strong> ${escapeHtml(i18n.copy(hotelRooms === 1 ? "export.simulation.rooms.one" : "export.simulation.rooms.many", { count: hotelRooms }))} · ${escapeHtml(i18n.copy(hotelNights === 1 ? "export.simulation.nights.one" : "export.simulation.nights.many", { count: hotelNights }))}
           <ul class="crew-list" style="margin-top:6px;">${hotelLines.join("")}</ul>
         </div>`
      : "";
  const presentList = present
    .map(
      (c) =>
        `<li><strong>${escapeHtml(c.name)}</strong> · ${escapeHtml(c.role || i18n.copy("export.simulation.notSpecified"))} · ${escapeHtml(i18n.copy("export.simulation.call"))} ${escapeHtml(c.callTime || i18n.copy("export.simulation.notSpecified"))}</li>`,
    )
    .join("");
  const missingList = missing
    .map(
      (c) =>
        `<li>${escapeHtml(c.name?.trim() || i18n.copy("export.simulation.unnamed"))} · ${escapeHtml(c.role || i18n.copy("export.simulation.notSpecified"))} — ${
          escapeHtml(i18n.copy(!c.name?.trim() ? "export.simulation.missingName" : "export.simulation.noCallTime"))
        }</li>`,
    )
    .join("");
  return `<div class="disc-block">
    <div class="disc-head">${escapeHtml(i18n.copy("export.simulation.block.crew"))} ${riskPill(lvl, i18n, missing.length > 0 ? i18n.copy("export.simulation.status.missing", { count: missing.length }) : i18n.copy("export.simulation.status.allPresent"))}</div>
    <div class="crew-grid">
      <div>
        <div class="crew-sub">${escapeHtml(i18n.copy("export.simulation.present", { count: present.length }))}</div>
        ${present.length > 0 ? `<ul class="crew-list">${presentList}</ul>` : `<p class="muted">${escapeHtml(i18n.copy("export.simulation.notSpecified"))}</p>`}
      </div>
      <div>
        <div class="crew-sub">${escapeHtml(i18n.copy("export.simulation.missingIncomplete", { count: missing.length }))}</div>
        ${missing.length > 0 ? `<ul class="crew-list missing">${missingList}</ul>` : `<p class="muted">${escapeHtml(i18n.copy("export.simulation.none"))}</p>`}
      </div>
    </div>
    ${hotelBlock}
  </div>`;
}

// ─── Phase definitions ────────────────────────────────────────────────

type PhaseDef = {
  key: string;
  num: number;
  /** The discipline most under load during this phase. Used to call out
   *  the "primary focus" in the phase header — but every phase still
   *  renders all 6 discipline blocks and all 5 risk categories per the
   *  Show Simulation Engine spec. */
  focus: "rigging" | "lighting" | "led" | "sound" | "stage" | "crew" | "all";
};

const PHASES: PhaseDef[] = [
  { key: "loadin", num: 1, focus: "crew" },
  { key: "rigging", num: 2, focus: "rigging" },
  { key: "lighting", num: 3, focus: "lighting" },
  { key: "led", num: 4, focus: "led" },
  { key: "sound", num: 5, focus: "sound" },
  { key: "stage", num: 6, focus: "stage" },
  { key: "testing", num: 7, focus: "all" },
  { key: "rehearsal", num: 8, focus: "all" },
  { key: "show", num: 9, focus: "all" },
  { key: "loadout", num: 10, focus: "crew" },
];

// ─── Phase rendering ──────────────────────────────────────────────────

type PhaseContext = {
  i18n: SimulationI18n;
  systems: ClientPackSystem[];
  loads: DistroLoad[];
  unpowered: number;
  lightingTotals: { totalWatts: number; worstLegA: number; loaded: number };
  ledScreens: LedScreen[];
  ledSettings: LedSettings;
  ledPanels: LedPanel[];
  sound: SoundItem[];
  stages: Stage[];
  stageCalcs: StageCalc[];
  crew: CrewMember[];
  schedule: ClientPackSchedulePhase[];
};

/** Per-spec: every phase must surface ALL 5 risk categories
 *  (SWL, power overload, phase imbalance >20%, missing crew, delays) so
 *  a critical issue surfaces in every phase context, not just the one
 *  most-related to it. */
function phaseRisks(ctx: PhaseContext): RiskItem[] {
  return [
    ...riggingRisks(ctx.systems, ctx.i18n),
    ...lightingRisks(ctx.loads, ctx.unpowered, ctx.i18n),
    ...ledRisks(ctx.ledScreens, ctx.ledSettings, ctx.ledPanels, ctx.i18n),
    ...stageRisks(ctx.stages, ctx.stageCalcs, ctx.i18n),
    ...crewRisks(ctx.crew, ctx.i18n),
    ...scheduleRisks(ctx.schedule, ctx.i18n),
  ];
}

function renderPhase(ctx: PhaseContext, phase: PhaseDef): string {
  const { i18n } = ctx;
  const risks = phaseRisks(ctx);
  const overall = worstLevel(risks);
  const verdict =
    overall === "danger"
      ? i18n.copy("export.simulation.status.blocked")
      : overall === "warn"
        ? i18n.copy("export.simulation.status.atRisk")
        : i18n.copy("export.simulation.status.ready");

  // Per-spec: render every discipline at every phase (Rigging,
  // Lighting v2.2, LED, Sound, Stage, Crew). The phase blurb + focus
  // pill tell the reader what's most under load right now.
  const blocks: string[] = [
    riggingBlock(ctx.systems, i18n),
    lightingBlock(ctx.loads, ctx.unpowered, ctx.lightingTotals, i18n),
    ledBlock(ctx.ledScreens, ctx.ledSettings, ctx.ledPanels, i18n),
    soundBlock(ctx.sound, i18n),
    stageBlock(ctx.stages, ctx.stageCalcs, i18n),
    crewBlock(ctx.crew, i18n),
  ];

  const riskList =
    risks.length === 0
      ? `<div class="risk-empty">${riskPill("safe", i18n, i18n.copy("export.simulation.noIssues"))} — ${escapeHtml(i18n.copy("export.simulation.withinLimits"))}</div>`
      : `<ul class="risk-list">${[...risks]
          .sort((a, b) => {
            const score = (l: RiskLevel) =>
              l === "danger" ? 0 : l === "warn" ? 1 : 2;
            return score(a.level) - score(b.level);
          })
          .map(
            (r) =>
              `<li>${riskPill(r.level, i18n)} <strong>${escapeHtml(r.area)}</strong> — ${escapeHtml(r.message)}</li>`,
          )
          .join("")}</ul>`;

  return `<section class="phase">
    <div class="phase-head">
      <div class="phase-num">${escapeHtml(i18n.copy("export.simulation.phaseNumber", { number: phase.num }))}</div>
      <h2>${escapeHtml(i18n.copy(`export.simulation.phase.${phase.key}.label` as SimulationCopyKey))} ${riskPill(overall, i18n, verdict)}</h2>
      <p class="phase-blurb">
        <span class="phase-focus">${escapeHtml(i18n.copy("export.simulation.focus", { focus: i18n.copy(`export.simulation.focus.${phase.focus}` as SimulationCopyKey) }))}</span>
        ${escapeHtml(i18n.copy(`export.simulation.phase.${phase.key}.blurb` as SimulationCopyKey))}
      </p>
    </div>
    ${blocks.join("\n")}
    <div class="phase-risks">
      <div class="risk-head">⚠️ ${escapeHtml(i18n.copy("export.simulation.risksAtPhase"))}</div>
      ${riskList}
    </div>
  </section>`;
}

// ─── Final verdict ────────────────────────────────────────────────────

type Verdict = {
  readiness: number;
  label: "ready" | "risk" | "fails";
  level: RiskLevel;
  biggest: RiskItem | null;
  dangerCount: number;
  warnCount: number;
};

/** All-discipline + schedule risk fold used to compute the final
 *  verdict. Identical to `phaseRisks` (the per-phase view), so a
 *  critical risk surfaced in any phase is the same one rolled up into
 *  the verdict — there is no hidden risk surface. */
function buildAllRisks(ctx: PhaseContext): RiskItem[] {
  return phaseRisks(ctx);
}

function computeVerdict(allRisks: RiskItem[]): Verdict {
  const dangerCount = allRisks.filter((r) => r.level === "danger").length;
  const warnCount = allRisks.filter((r) => r.level === "warn").length;
  const readiness = Math.max(0, 100 - 25 * dangerCount - 8 * warnCount);
  const label: Verdict["label"] =
    readiness >= 85
      ? "ready"
      : readiness >= 50
        ? "risk"
        : "fails";
  const level: RiskLevel =
    readiness >= 85 ? "safe" : readiness >= 50 ? "warn" : "danger";
  const sorted = [...allRisks].sort((a, b) => {
    const score = (l: RiskLevel) =>
      l === "danger" ? 0 : l === "warn" ? 1 : 2;
    return score(a.level) - score(b.level);
  });
  return {
    readiness,
    label,
    level,
    biggest: sorted[0] ?? null,
    dangerCount,
    warnCount,
  };
}

function renderVerdict(verdict: Verdict, i18n: SimulationI18n): string {
  const verdictClass =
    verdict.level === "danger"
      ? "verdict-fail"
      : verdict.level === "warn"
        ? "verdict-risk"
        : "verdict-ready";
  const biggest = verdict.biggest
    ? `<div class="verdict-biggest">
         <span class="verdict-biggest-label">${escapeHtml(i18n.copy("export.simulation.biggestRisk"))}:</span>
         ${riskPill(verdict.biggest.level, i18n)}
         <strong>${escapeHtml(verdict.biggest.area)}</strong> — ${escapeHtml(verdict.biggest.message)}
       </div>`
    : `<div class="verdict-biggest">
         <span class="verdict-biggest-label">${escapeHtml(i18n.copy("export.simulation.biggestRisk"))}:</span>
         ${riskPill("safe", i18n, i18n.copy("export.simulation.none").toUpperCase())} — ${escapeHtml(i18n.copy("export.simulation.noIssuesDetected"))}
       </div>`;
  return `<section class="verdict ${verdictClass}">
    <div class="verdict-row">
      <div class="verdict-score">
        <div class="verdict-score-label">${escapeHtml(i18n.copy("export.simulation.showReadiness"))}</div>
        <div class="verdict-score-value">${verdict.readiness}<span class="verdict-score-pct">%</span></div>
      </div>
      <div class="verdict-tally">
        <div><span class="tally-num">${verdict.dangerCount}</span><span class="tally-label">🔴 ${escapeHtml(i18n.copy(verdict.dangerCount === 1 ? "export.simulation.critical.one" : "export.simulation.critical.many"))}</span></div>
        <div><span class="tally-num">${verdict.warnCount}</span><span class="tally-label">🟠 ${escapeHtml(i18n.copy(verdict.warnCount === 1 ? "export.simulation.warnings.one" : "export.simulation.warnings.many"))}</span></div>
      </div>
      <div class="verdict-final">
        <div class="verdict-final-label">${escapeHtml(i18n.copy("export.simulation.finalVerdict"))}</div>
        <div class="verdict-final-value">${escapeHtml(i18n.copy(`export.simulation.verdict.${verdict.label}` as SimulationCopyKey))}</div>
      </div>
    </div>
    ${biggest}
  </section>`;
}

// ─── Cover ────────────────────────────────────────────────────────────

function renderCover(
  project: ClientPackProject,
  logoDataUrl: string | null,
  verdict: Verdict,
  i18n: SimulationI18n,
): string {
  const title =
    project.eventName.trim() || project.venue.trim() || i18n.copy("export.simulation.title");
  const formatDate = (value: string): string => {
    if (!value) return i18n.copy("export.simulation.notSpecified");
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(i18n.locale === "no" ? "nb-NO" : "en-US").format(date);
  };
  const dateRange =
    project.endDate && project.endDate !== project.date
      ? `${formatDate(project.date)} → ${formatDate(project.endDate)}`
      : formatDate(project.date);
  const logoImg = logoDataUrl
    ? `<img src="${logoDataUrl}" class="cover-logo" alt="${escapeHtml(i18n.copy("export.simulation.logoAlt"))}" />`
    : "";
  return `<section class="cover">
    ${logoImg}
    <div class="cover-brand">${escapeHtml(i18n.copy("export.simulation.brand"))}</div>
    <h1 class="cover-title">${escapeHtml(title)}</h1>
    <div class="cover-verdict ${verdict.level === "danger" ? "verdict-fail" : verdict.level === "warn" ? "verdict-risk" : "verdict-ready"}">
      <div class="cover-verdict-score">${fmtInt(verdict.readiness, i18n)}<span class="cover-verdict-pct">%</span></div>
      <div class="cover-verdict-label">${escapeHtml(i18n.copy(`export.simulation.verdict.${verdict.label}` as SimulationCopyKey))}</div>
    </div>
    <div class="cover-meta">
      <div><span class="cover-meta-label">${escapeHtml(i18n.copy("export.simulation.meta.client"))}</span><span class="cover-meta-value">${orNS(project.client, i18n)}</span></div>
      <div><span class="cover-meta-label">${escapeHtml(i18n.copy("export.simulation.meta.venue"))}</span><span class="cover-meta-value">${orNS(project.venue, i18n)}</span></div>
      <div><span class="cover-meta-label">${escapeHtml(i18n.copy("export.simulation.meta.date"))}</span><span class="cover-meta-value">${orNS(dateRange, i18n)}</span></div>
      <div><span class="cover-meta-label">${escapeHtml(i18n.copy("export.simulation.meta.preparedBy"))}</span><span class="cover-meta-value">${orNS(project.preparedBy, i18n)}</span></div>
    </div>
    <div class="cover-footer">${escapeHtml(i18n.copy("export.simulation.generated", { date: new Intl.DateTimeFormat(i18n.locale === "no" ? "nb-NO" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date()) }))}</div>
  </section>`;
}

// ─── Document assembly ────────────────────────────────────────────────

function renderHtml(input: ShowSimulationInput): string {
  const i18n: SimulationI18n = { locale: input.locale, copy: input.copy };
  const wattsLookup = makeFixtureWattsLookup(input.fixtures);
  const loads: DistroLoad[] = input.power.distros.map((d) =>
    computeDistroLoad(d, wattsLookup),
  );
  const unpoweredArr = computeUnpoweredFixtures(
    input.power.distros,
    input.fixtures,
  );
  const unpowered = unpoweredArr.length;
  const lightingTotals = computeDistroPlanTotals(loads, unpoweredArr);
  const worstLegA = loads.length
    ? Math.max(...loads.map((l) => l.feederWorstAmps))
    : 0;
  const stageCalcs = input.stages.map((s) => computeStage(s));

  const ctx: PhaseContext = {
    i18n,
    systems: input.systems,
    loads,
    unpowered,
    lightingTotals: {
      totalWatts: lightingTotals.totalWatts,
      worstLegA,
      loaded: loads.length,
    },
    ledScreens: input.ledScreens,
    ledSettings: input.ledSettings,
    ledPanels: input.ledPanels,
    sound: input.sound,
    stages: input.stages,
    stageCalcs,
    crew: input.crew,
    schedule: input.schedule,
  };

  const allRisks = buildAllRisks(ctx);
  const verdict = computeVerdict(allRisks);

  const cover = renderCover(input.project, input.logoDataUrl, verdict, i18n);
  const phasesHtml = PHASES.map((p) => renderPhase(ctx, p)).join("\n");
  const verdictHtml = renderVerdict(verdict, i18n);

  const projTitle =
    input.project.eventName.trim() ||
    input.project.venue.trim() ||
    i18n.copy("export.simulation.title");

  return `<!doctype html>
<html lang="${input.locale === "no" ? "nb-NO" : "en"}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(i18n.copy("export.simulation.documentTitle", { project: projTitle }))}</title>
<meta name="ehs-pdf-name" content="${escapeHtml(projTitle)} — ${escapeHtml(i18n.copy("export.simulation.filenameLabel"))}.pdf" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a; background: #fff;
    padding: 24px 24px 48px; font-size: 13px; line-height: 1.45;
  }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 {
    font-size: 16px; margin: 0;
    padding: 0; background: transparent; border: 0; color: #0f172a;
  }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #64748b; }
  .warn-note { color: #9a3412; font-size: 12px; margin: 6px 0 0; }

  /* Cover */
  .cover {
    min-height: 80vh; padding: 60px 20px;
    border: 4px solid #f88000; border-radius: 8px;
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; text-align: center;
    background: linear-gradient(180deg, #fff7ed 0%, #fff 60%);
    margin-bottom: 32px; page-break-after: always;
  }
  .cover-logo { max-height: 80px; margin-bottom: 24px; }
  .cover-brand {
    font-size: 13px; color: #9a3412; letter-spacing: 0.2em;
    text-transform: uppercase; font-weight: 600; margin-bottom: 12px;
  }
  .cover-title {
    font-size: 36px; font-weight: 800; color: #0f172a;
    margin: 0 0 24px; max-width: 720px;
  }
  .cover-verdict {
    display: flex; flex-direction: column; align-items: center;
    padding: 20px 40px; border-radius: 12px; margin-bottom: 32px;
    border: 3px solid; min-width: 280px;
  }
  .cover-verdict.verdict-ready { background: #f0fdf4; border-color: #22c55e; color: #166534; }
  .cover-verdict.verdict-risk { background: #fff7ed; border-color: #f97316; color: #9a3412; }
  .cover-verdict.verdict-fail { background: #fef2f2; border-color: #ef4444; color: #991b1b; }
  .cover-verdict-score { font-size: 56px; font-weight: 800; line-height: 1; }
  .cover-verdict-pct { font-size: 24px; font-weight: 600; margin-left: 4px; }
  .cover-verdict-label { font-size: 16px; font-weight: 700; letter-spacing: 0.1em; margin-top: 6px; }
  .cover-meta {
    display: grid; grid-template-columns: repeat(2, minmax(200px, 280px));
    gap: 16px 32px; margin-bottom: 32px;
  }
  .cover-meta > div {
    display: flex; flex-direction: column; gap: 2px;
    border-top: 2px solid #f88000; padding-top: 8px; text-align: left;
  }
  .cover-meta-label {
    font-size: 11px; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .cover-meta-value { font-size: 16px; font-weight: 600; color: #0f172a; }
  .cover-footer { font-size: 11px; color: #94a3b8; margin-top: 16px; }

  /* Phase block */
  .phase {
    border: 1px solid #e2e8f0; border-radius: 8px;
    margin-bottom: 18px; padding: 16px 18px;
    page-break-inside: avoid;
  }
  .phase-head { border-bottom: 2px solid #f88000; padding-bottom: 10px; margin-bottom: 12px; }
  .phase-num {
    font-size: 11px; color: #9a3412; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 2px;
  }
  .phase-head h2 {
    display: flex; align-items: center; gap: 12px;
    font-size: 22px; font-weight: 800;
  }
  .phase-blurb {
    font-size: 12px; color: #475569; margin: 6px 0 0; font-style: italic;
  }
  .phase-focus {
    display: inline-block;
    font-style: normal;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #9a3412;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 999px;
    padding: 2px 8px;
    margin-right: 8px;
    vertical-align: middle;
  }
  .disc-block { margin-top: 14px; }
  .disc-head {
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: #334155;
    display: flex; align-items: center; gap: 10px;
    border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 6px;
  }
  .phases { font-size: 11px; color: #475569; }
  .crew-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .crew-sub {
    font-size: 11px; font-weight: 600; color: #475569;
    text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px;
  }
  .crew-list { margin: 0; padding-left: 18px; font-size: 12px; }
  .crew-list.missing li { color: #9a3412; }

  /* Risk pill */
  .risk-pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 700; white-space: nowrap;
  }
  .risk-safe { background: #dcfce7; color: #166534; }
  .risk-warn { background: #fef3c7; color: #92400e; }
  .risk-danger { background: #fee2e2; color: #991b1b; }
  .risk-empty {
    padding: 10px 12px; background: #f0fdf4; border: 1px solid #bbf7d0;
    border-radius: 6px; font-size: 12px;
  }

  .phase-risks { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #cbd5e1; }
  .risk-head {
    font-size: 12px; font-weight: 700; color: #9a3412;
    margin-bottom: 6px; letter-spacing: 0.04em; text-transform: uppercase;
  }
  .risk-list { margin: 0; padding-left: 0; list-style: none; }
  .risk-list li {
    padding: 4px 0; font-size: 12px;
    border-bottom: 1px dotted #e2e8f0;
  }
  .risk-list li:last-child { border-bottom: 0; }

  /* Final verdict band */
  .verdict {
    margin-top: 24px; padding: 20px 24px; border-radius: 8px;
    border: 3px solid; page-break-inside: avoid;
  }
  .verdict.verdict-ready { background: #f0fdf4; border-color: #22c55e; color: #166534; }
  .verdict.verdict-risk { background: #fff7ed; border-color: #f97316; color: #9a3412; }
  .verdict.verdict-fail { background: #fef2f2; border-color: #ef4444; color: #991b1b; }
  .verdict-row {
    display: grid; grid-template-columns: 1fr 1fr 1fr;
    gap: 24px; align-items: center; margin-bottom: 16px;
  }
  .verdict-score-label, .verdict-final-label {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    font-weight: 700; opacity: 0.75;
  }
  .verdict-score-value { font-size: 48px; font-weight: 800; line-height: 1; }
  .verdict-score-pct { font-size: 22px; font-weight: 600; margin-left: 4px; }
  .verdict-tally { display: flex; gap: 24px; justify-content: center; }
  .verdict-tally > div { display: flex; flex-direction: column; align-items: center; }
  .tally-num { font-size: 32px; font-weight: 800; line-height: 1; }
  .tally-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
  .verdict-final-value { font-size: 28px; font-weight: 800; line-height: 1.1; letter-spacing: 0.04em; }
  .verdict-biggest {
    font-size: 13px; padding-top: 12px;
    border-top: 1px solid currentColor; opacity: 0.95;
  }
  .verdict-biggest-label { font-weight: 700; margin-right: 6px; }

  /* Print bar */
  .print-bar {
    position: fixed; top: 12px; right: 12px;
    display: flex; gap: 8px; z-index: 10;
  }
  .print-bar button {
    padding: 8px 14px; font-size: 13px; font-weight: 600;
    border: 1px solid #cbd5e1; border-radius: 4px;
    background: #fff; cursor: pointer;
  }
  .print-bar .primary { background: #f88000; color: #fff; border-color: #f88000; }

  @media print {
    body { padding: 12mm; font-size: 11px; }
    .no-print { display: none !important; }
    .cover { min-height: 240mm; }
    .phase { break-inside: avoid; }
    .verdict { break-inside: avoid; }
  }
  @page { size: A4 portrait; margin: 12mm; }

  /* "Download PDF" mode — applied by App.tsx while html2canvas
     rasterises the popup. Body is pinned to A4 width (794px) so we
     compact spacing here to match a real A4 page. */
  body.pdf-export {
    padding: 14px 18px 24px;
    font-size: 11px; line-height: 1.4;
  }
  body.pdf-export h1 { font-size: 22px; }
  body.pdf-export .cover {
    min-height: 0; padding: 28px 20px 32px;
    margin-bottom: 18px;
    page-break-after: always;
  }
  body.pdf-export .cover-logo { max-height: 56px; margin-bottom: 14px; }
  body.pdf-export .cover-title { font-size: 26px; margin-bottom: 16px; }
  body.pdf-export .cover-verdict {
    padding: 14px 28px; margin-bottom: 22px; min-width: 220px;
  }
  body.pdf-export .cover-verdict-score { font-size: 40px; }
  body.pdf-export .cover-verdict-pct { font-size: 18px; }
  body.pdf-export .cover-verdict-label { font-size: 13px; margin-top: 4px; }
  body.pdf-export .cover-meta {
    grid-template-columns: repeat(2, minmax(180px, 240px));
    gap: 10px 24px; margin-bottom: 18px;
  }
  body.pdf-export .cover-meta-value { font-size: 13px; }
  body.pdf-export .phase {
    margin-bottom: 12px; padding: 12px 14px;
    page-break-inside: avoid; break-inside: avoid;
  }
  body.pdf-export .phase-head {
    padding-bottom: 6px; margin-bottom: 8px;
  }
  body.pdf-export .phase-head h2 { font-size: 17px; gap: 8px; }
  body.pdf-export .phase-num { font-size: 10px; }
  body.pdf-export .phase-blurb { font-size: 11px; margin-top: 4px; }
  body.pdf-export .disc-block { margin-top: 10px; }
  body.pdf-export .disc-head { font-size: 10px; }
  body.pdf-export table { font-size: 10.5px; margin: 6px 0; }
  body.pdf-export th, body.pdf-export td { padding: 4px 6px; }
  body.pdf-export th { font-size: 9px; }
  body.pdf-export .crew-grid { gap: 12px; }
  body.pdf-export .crew-list { font-size: 10.5px; padding-left: 16px; }
  body.pdf-export .phase-risks { margin-top: 10px; padding-top: 8px; }
  body.pdf-export .risk-list li { padding: 3px 0; font-size: 10.5px; }
  body.pdf-export .verdict {
    margin-top: 18px; padding: 16px 18px;
    page-break-inside: avoid; break-inside: avoid;
  }
  body.pdf-export .verdict-row {
    grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 12px;
  }
  body.pdf-export .verdict-score-value { font-size: 36px; }
  body.pdf-export .verdict-score-pct { font-size: 18px; }
  body.pdf-export .verdict-tally { gap: 16px; }
  body.pdf-export .tally-num { font-size: 24px; }
  body.pdf-export .verdict-final-value { font-size: 22px; }
  body.pdf-export .verdict-biggest { font-size: 11px; padding-top: 8px; }

  /* Final-page floor plan */
  .floor-plan {
    margin-top: 28px; padding: 16px;
    border: 1px solid #e2e8f0; border-radius: 8px;
    background: #fff;
    page-break-before: always; break-before: page;
    page-break-inside: avoid; break-inside: avoid;
  }
  .floor-plan-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; margin-bottom: 12px;
    padding-bottom: 8px; border-bottom: 2px solid #f88000;
  }
  .floor-plan-head h2 { font-size: 18px; }
  .floor-plan-file {
    font-size: 11px; color: #64748b; font-style: italic;
    word-break: break-word; max-width: 60%; text-align: right;
  }
  /* Pure pixel sizing — html2canvas (used by the parent-window PDF
     capture) handles width/height predictably but mis-measures
     mm units and object-fit on replaced elements, which made the
     floor plan render as a blank gap. Letting the browser compute
     height from the intrinsic aspect ratio keeps the drawing
     crisp and lets the page-slicer wrap it cleanly. */
  .floor-plan-img {
    display: block; width: 100%; height: auto;
    border-radius: 4px; background: #f8fafc;
  }
  body.pdf-export .floor-plan {
    margin-top: 18px; padding: 12px;
  }
  body.pdf-export .floor-plan-head h2 { font-size: 15px; }
  body.pdf-export .floor-plan-file { font-size: 10px; }
</style>
</head>
<body>
<div class="print-bar no-print">
  <button id="ehs-download-pdf" class="primary">${escapeHtml(i18n.copy("export.simulation.downloadPdf"))}</button>
  <button onclick="window.print()">${escapeHtml(i18n.copy("export.simulation.print"))}</button>
  <button onclick="window.close()">${escapeHtml(i18n.copy("export.simulation.close"))}</button>
</div>
<script>
(function () {
  var btn = document.getElementById('ehs-download-pdf');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var opener = window.opener;
    var fn = opener && opener.__ehsDownloadPopupPdf;
    if (typeof fn !== 'function') {
      window.print();
      return;
    }
    var meta = document.querySelector('meta[name="ehs-pdf-name"]');
    var filename = (meta && meta.getAttribute('content')) || (document.title + '.pdf');
    var orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = ${JSON.stringify(i18n.copy("export.simulation.generatingPdf"))};
    Promise.resolve(fn(window, filename)).catch(function (err) {
      console.error(err);
      alert(${JSON.stringify(i18n.copy("export.simulation.pdfFallbackAlert"))});
      window.print();
    }).then(function () {
      btn.disabled = false;
      btn.textContent = orig;
    });
  });
})();
</script>

${cover}
${phasesHtml}
${verdictHtml}
${
  input.floorPlanDataUrl
    ? `<section class="floor-plan">
  <div class="floor-plan-head">
    <h2>${escapeHtml(i18n.copy("export.simulation.floorPlan"))}</h2>
    ${
      input.floorPlanFileName
        ? `<div class="floor-plan-file">${escapeHtml(input.floorPlanFileName)}</div>`
        : ""
    }
  </div>
  <img class="floor-plan-img" src="${input.floorPlanDataUrl}" alt="${escapeHtml(i18n.copy("export.simulation.floorPlanAlt"))}" />
</section>`
    : ""
}

<div class="muted" style="margin-top:24px;text-align:center;font-size:11px;border-top:1px solid #e2e8f0;padding-top:12px">
  ${escapeHtml(i18n.copy("export.simulation.footer"))}
</div>

</body>
</html>`;
}

/** Open a printable Show Simulation report in a new browser window.
 *  The popup MUST be opened SYNCHRONOUSLY in the click handler (before
 *  any async work such as logo loading) and passed in as `targetWin`,
 *  otherwise pop-up blockers will swallow it. */
export function exportShowSimulation(
  input: ShowSimulationInput,
): { ok: boolean } {
  const html = renderHtml(input);
  const win = input.targetWin ?? window.open("", "_blank");
  if (!win) return { ok: false };
  win.document.open();
  win.document.write(html);
  win.document.close();
  return { ok: true };
}
