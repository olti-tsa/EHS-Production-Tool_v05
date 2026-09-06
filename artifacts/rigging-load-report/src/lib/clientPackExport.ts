import {
  computeDistroLoad,
  computeDistroPlanTotals,
  computeUnpoweredFixtures,
  makeFixtureWattsLookup,
  type DistroLoad,
  type FixtureRef,
  type PowerPlan,
} from "./power";
import {
  computeCrewTotals,
  crewHours,
  type CrewMember,
} from "./crew";
import { computeSoundTotals, type SoundItem } from "./sound";
import {
  computeStage,
  computeStageTotals,
  type Stage,
  type StageCalc,
} from "./stage";
import {
  computeLedTotals,
  computeScreenMetrics,
  NOVASTAR_PROCESSOR_CATALOG,
  type LedPanel,
  type LedScreen,
  type LedSettings,
} from "./led";
import { findProcessor } from "./ledProcessors";

/** Minimal slice of `System` we need from the producer app. We accept a
 *  pre-computed metric bundle so the export module stays free of the
 *  rigging math (the producer app already memoizes those per system). */
export type ClientPackSystem = {
  id: string;
  name: string;
  pointCount: number;
  hoistName: string;
  /** Truss / row labels for the system, in display order. */
  truss: string[];
  metrics: {
    static: number;
    dynamic: number;
    peak: number;
    swl: number;
    headroom: number;
  };
};

export type ClientPackSchedulePhase = {
  key: "setup" | "rehearsal" | "show" | "downrig";
  label: string;
  segments: Array<{
    from: string;
    to: string;
    fromTime?: string;
    toTime?: string;
    timeTbd?: boolean;
  }>;
};

export type ClientPackProject = {
  eventName: string;
  client: string;
  venue: string;
  date: string;
  endDate?: string;
  preparedBy: string;
  summary: string;
};

export type ClientPackInput = {
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
  /** Optional pre-rendered pixel-map PNGs (data URLs) keyed by screen
   *  id. When present the LED section embeds each diagram below the
   *  summary table so the printed pack matches the on-screen Pixel Map
   *  view. Screens without an entry simply skip the figure. */
  ledPixelMaps?: Record<string, string>;
  /** Pre-loaded EHS logo (data URL). Same lookup the Stage Build Sheet
   *  + Power Plan exports use, so the cover page matches branding. */
  logoDataUrl: string | null;
  /** Pre-opened popup window from the click handler (sync open keeps
   *  the browser from classifying it as a programmatic pop-up). */
  targetWin: Window | null;
  /** Locale and copy are supplied by the UI; this library deliberately
   *  does not read React context or browser language preferences. */
  locale: string;
  copy: ClientPackExportCopy;
};

export type ClientPackExportCopy = {
  clientPack: string;
  downloadPdf: string;
  print: string;
  close: string;
  generatingPdf: string;
  pdfError: string;
  footerAdvisory: string;
  notSpecified: string;
  generated: string;
  riskSafe: string;
  riskWarning: string;
  riskOverload: string;
  noIssuesDetected: string;
  noIssuesDetail: string;
  riskAreaRigging: string; riskAreaPower: string; riskAreaCrew: string; riskAreaSchedule: string;
  riskPeakOverload: string; riskPeakWarning: string; riskFeederOverload: string;
  riskFeederWarning: string; riskPhaseImbalance: string; riskUnpoweredOne: string;
  riskUnpoweredMany: string; riskMissingCallOne: string; riskMissingCallMany: string;
  riskNoCrew: string; riskUndatedSegmentOne: string; riskUndatedSegmentMany: string;
  riskNoSchedule: string; unnamed: string; distroFallback: string; tbd: string;
  processorFallback: string; ledScreenFallback: string; pixelMap: string;
  filenameFallback: string;
  /** Every presentation string used by the generated document. */
  labels: {
    brand: string; client: string; venue: string; date: string; preparedBy: string;
    overviewSection: string; totalCrew: string; riggingSystems: string; lightingFixtures: string;
    distros: string; soundItems: string; stages: string; ledScreens: string;
    scheduleSection: string; phase: string; time: string;
    crewSection: string; name: string; role: string; call: string; off: string;
    hours: string; hotel: string; dayRate: string; hotelNeeded: string;
    roomsOne: string; roomsMany: string; nightsOne: string; nightsMany: string;
    crewTotalOne: string; crewTotalMany: string; totals: string;
    riggingSection: string; system: string; trusses: string; pts: string; motor: string;
    staticLoad: string; dynamicLoad: string; peakSwl: string; util: string; status: string;
    lightingSection: string; fixtures: string; totalLoad: string; unpowered: string; phaseCount: string;
    distro: string; feed: string; totalW: string; worstLeg: string; imbalance: string;
    soundSection: string; item: string; category: string; qty: string; weight: string;
    power: string; placementNotes: string; rowsOne: string; rowsMany: string;
    piecesOne: string; piecesMany: string;
    stageSection: string; stage: string; dimensions: string; legHeight: string; area: string;
    buildWeight: string; loadCapacity: string; stageOne: string; stageMany: string;
    ledSection: string; screens: string; cabinets: string; pixels: string; peakPower: string;
    screen: string; panelType: string; grid: string; resolution: string; processor: string;
    portsNeeded: string; processorLoad: string;
    riskSection: string; riskArea: string; detail: string;
    costSection: string; department: string; headcount: string; cost: string;
    totalCrewCost: string; costFootnote: string;
  };
};

// ─── Formatting helpers ───────────────────────────────────────────────

let NS = "";
let renderCopy: ClientPackExportCopy | null = null;
const activeCopy = (): ClientPackExportCopy => {
  if (!renderCopy) {
    throw new Error("CLIENT_PACK_COPY_NOT_INITIALIZED");
  }
  return renderCopy;
};
const copyTemplate = (template: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);

let renderLocale = "und";
const fmt = (n: number, d = 1): string =>
  n.toLocaleString(renderLocale, { maximumFractionDigits: d });

const fmtInt = (n: number): string =>
  Math.round(n).toLocaleString(renderLocale, { maximumFractionDigits: 0 });

const fmtCurrency = (n: number): string =>
  n.toLocaleString(renderLocale, {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  });

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Render a value or the active locale's missing-value label. */
const orNS = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return NS;
  if (typeof v === "string" && v.trim() === "") return NS;
  if (typeof v === "number" && !Number.isFinite(v)) return NS;
  return escapeHtml(String(v));
};

/** Format a YYYY-MM-DD date as "Fri 12 Sep 2025". Falls back to NS for
 *  empty strings — the producer might leave a phase undated. */
const fmtDate = (iso: string | undefined): string => {
  if (!iso) return NS;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  return d.toLocaleDateString(renderLocale, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const fmtTimeRange = (from?: string, to?: string): string => {
  if (!from && !to) return "";
  return `${from || "—"} → ${to || "—"}`;
};

// ─── Risk pill ────────────────────────────────────────────────────────

type RiskLevel = "safe" | "warn" | "danger";

const riskPill = (level: RiskLevel, label?: string): string => {
  const dot = level === "danger" ? "🔴" : level === "warn" ? "🟠" : "🟢";
  const text =
    label ??
    (level === "danger"
      ? activeCopy().riskOverload
      : level === "warn"
        ? activeCopy().riskWarning
        : activeCopy().riskSafe);
  return `<span class="risk-pill risk-${level}">${dot} ${escapeHtml(text)}</span>`;
};

// ─── Risk collection ──────────────────────────────────────────────────

type RiskItem = {
  level: RiskLevel;
  area: string;
  message: string;
};

function collectRisks(
  input: ClientPackInput,
  loads: DistroLoad[],
  unpoweredFixtureCount: number,
): RiskItem[] {
  const out: RiskItem[] = [];

  // Rigging SWL risks
  for (const sys of input.systems) {
    const m = sys.metrics;
    if (m.swl > 0 && m.peak > m.swl) {
      out.push({
        level: "danger",
        area: `${input.copy.riskAreaRigging} · ${sys.name}`,
        message: copyTemplate(input.copy.riskPeakOverload, { peak: fmtInt(m.peak), swl: fmtInt(m.swl), percent: fmt((m.peak / m.swl) * 100, 0) }),
      });
    } else if (m.swl > 0 && m.peak / m.swl > 0.85) {
      out.push({
        level: "warn",
        area: `${input.copy.riskAreaRigging} · ${sys.name}`,
        message: copyTemplate(input.copy.riskPeakWarning, { percent: fmt((m.peak / m.swl) * 100, 0) }),
      });
    }
  }

  // Power risks: per-distro overload + imbalance
  loads.forEach((d) => {
    const name = d.distro.name || input.copy.distroFallback;
    if (d.feederUtilization > 1) {
      out.push({
        level: "danger",
        area: `${input.copy.riskAreaPower} · ${name}`,
        message: copyTemplate(input.copy.riskFeederOverload, { percent: fmt(d.feederUtilization * 100, 0) }),
      });
    } else if (d.feederUtilization > 0.85) {
      out.push({
        level: "warn",
        area: `${input.copy.riskAreaPower} · ${name}`,
        message: copyTemplate(input.copy.riskFeederWarning, { percent: fmt(d.feederUtilization * 100, 0) }),
      });
    }
    if (d.distro.feedPhases === 3 && d.imbalance > 0.2) {
      out.push({
        level: "warn",
        area: `${input.copy.riskAreaPower} · ${name}`,
        message: copyTemplate(input.copy.riskPhaseImbalance, { percent: fmt(d.imbalance * 100, 0) }),
      });
    }
  });
  if (unpoweredFixtureCount > 0) {
    out.push({
      level: "warn",
      area: input.copy.riskAreaPower,
      message: copyTemplate(unpoweredFixtureCount === 1 ? input.copy.riskUnpoweredOne : input.copy.riskUnpoweredMany, { count: unpoweredFixtureCount }),
    });
  }

  // Crew: missing call time
  const missingCall = input.crew.filter((c) => !c.callTime);
  if (missingCall.length > 0) {
    out.push({
      level: "warn",
      area: input.copy.riskAreaCrew,
      message: copyTemplate(missingCall.length === 1 ? input.copy.riskMissingCallOne : input.copy.riskMissingCallMany, {
        count: missingCall.length,
        names: missingCall.map((c) => c.name || input.copy.unnamed).join(", "),
      }),
    });
  }
  if (input.crew.length === 0) {
    out.push({
      level: "warn",
      area: input.copy.riskAreaCrew,
      message: input.copy.riskNoCrew,
    });
  }

  // Schedule risks: missing dates on enabled phases
  for (const phase of input.schedule) {
    const blank = phase.segments.filter((s) => !s.from && !s.to);
    if (blank.length > 0) {
      out.push({
        level: "warn",
        area: `${input.copy.riskAreaSchedule} · ${phase.label}`,
        message: copyTemplate(blank.length === 1 ? input.copy.riskUndatedSegmentOne : input.copy.riskUndatedSegmentMany, { count: blank.length }),
      });
    }
  }
  if (input.schedule.length === 0) {
    out.push({
      level: "warn",
      area: input.copy.riskAreaSchedule,
      message: input.copy.riskNoSchedule,
    });
  }

  return out;
}

// ─── Section renderers ────────────────────────────────────────────────

function renderCover(p: ClientPackProject, logoDataUrl: string | null): string {
  const l = activeCopy().labels;
  const dateLabel =
    p.endDate && p.endDate !== p.date
      ? `${fmtDate(p.date)} → ${fmtDate(p.endDate)}`
      : fmtDate(p.date);
  return `
<section class="cover">
  ${logoDataUrl ? `<img src="${logoDataUrl}" alt="EHS" class="cover-logo" />` : ""}
  <div class="cover-brand">${escapeHtml(l.brand)}</div>
  <h1 class="cover-title">${orNS(p.eventName) === NS ? orNS(p.venue) : escapeHtml(p.eventName)}</h1>
  <div class="cover-meta">
    <div><span class="cover-meta-label">${escapeHtml(l.client)}</span><span class="cover-meta-value">${orNS(p.client)}</span></div>
    <div><span class="cover-meta-label">${escapeHtml(l.venue)}</span><span class="cover-meta-value">${orNS(p.venue)}</span></div>
    <div><span class="cover-meta-label">${escapeHtml(l.date)}</span><span class="cover-meta-value">${dateLabel}</span></div>
    <div><span class="cover-meta-label">${escapeHtml(l.preparedBy)}</span><span class="cover-meta-value">${orNS(p.preparedBy)}</span></div>
  </div>
  <div class="cover-footer">${escapeHtml(activeCopy().generated)} ${escapeHtml(new Date().toLocaleString(renderLocale))}</div>
</section>`;
}

function renderOverview(input: ClientPackInput): string {
  const l = input.copy.labels;
  const totalFixtures = input.fixtures.reduce(
    (sum, f) =>
      sum +
      (typeof (f as { qty?: number }).qty === "number"
        ? (f as { qty: number }).qty
        : 1),
    0,
  );
  const totalDistros = input.power.distros.length;
  const totalSound = input.sound.length;
  const totalStages = input.stages.length;
  const totalLed = input.ledScreens.length;
  const totalCrew = input.crew.length;
  const summary = input.project.summary?.trim()
    ? escapeHtml(input.project.summary)
    : NS;

  return `
<section class="section">
  <h2>${escapeHtml(l.overviewSection)}</h2>
  <p class="lead">${summary}</p>
  <div class="overview-grid">
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.totalCrew)}</div><div class="ov-value">${totalCrew}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.riggingSystems)}</div><div class="ov-value">${input.systems.length}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.lightingFixtures)}</div><div class="ov-value">${totalFixtures}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.distros)}</div><div class="ov-value">${totalDistros}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.soundItems)}</div><div class="ov-value">${totalSound}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.stages)}</div><div class="ov-value">${totalStages}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.ledScreens)}</div><div class="ov-value">${totalLed}</div></div>
  </div>
</section>`;
}

function renderSchedule(
  phases: ClientPackSchedulePhase[],
  copy: ClientPackExportCopy,
): string {
  const l = copy.labels;
  if (phases.length === 0) {
    return `<section class="section">
  <h2>${escapeHtml(l.scheduleSection)}</h2>
  <p class="muted">${NS}</p>
</section>`;
  }
  const rows = phases
    .flatMap((phase) =>
      phase.segments.length === 0
        ? [
            `<tr><td><strong>${escapeHtml(phase.label)}</strong></td><td colspan="2" class="muted">${NS}</td></tr>`,
          ]
        : phase.segments.map((seg) => {
            const dateRange =
              seg.from && seg.to && seg.from !== seg.to
                ? `${fmtDate(seg.from)} → ${fmtDate(seg.to)}`
                : fmtDate(seg.from || seg.to);
            const time = seg.timeTbd
              ? escapeHtml(copy.tbd)
              : fmtTimeRange(seg.fromTime, seg.toTime);
            return `<tr>
              <td><strong>${escapeHtml(phase.label)}</strong></td>
              <td>${dateRange}</td>
              <td>${time || `<span class="muted">—</span>`}</td>
            </tr>`;
          }),
    )
    .join("");
  return `
<section class="section">
  <h2>${escapeHtml(l.scheduleSection)}</h2>
  <table>
    <thead><tr><th>${escapeHtml(l.phase)}</th><th>${escapeHtml(l.date)}</th><th>${escapeHtml(l.time)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function renderCrew(crew: CrewMember[]): string {
  const l = activeCopy().labels;
  if (crew.length === 0) {
    return `<section class="section">
  <h2>${escapeHtml(l.crewSection)}</h2>
  <p class="muted">${NS}</p>
</section>`;
  }
  let totalRooms = 0;
  let totalNights = 0;
  const rows = crew
    .map((c) => {
      const hours = crewHours(c);
      const nights = c.hotelDates?.length ?? 0;
      if (nights > 0) {
        totalRooms += 1;
        totalNights += nights;
      }
      const hotelCell =
        nights > 0
          ? `🏨 ${escapeHtml(copyTemplate(nights === 1 ? l.nightsOne : l.nightsMany, { count: nights }))}`
          : c.needsHotel
            ? escapeHtml(l.hotelNeeded)
            : `<span class="muted">—</span>`;
      return `<tr>
        <td>${orNS(c.name)}</td>
        <td>${escapeHtml(c.role)}</td>
        <td>${orNS(c.callTime)}</td>
        <td>${orNS(c.offTime)}</td>
        <td class="num">${hours > 0 ? `${fmt(hours, 1)} h` : `<span class="muted">—</span>`}</td>
        <td>${hotelCell}</td>
        <td class="num">${c.dayRate > 0 ? escapeHtml(fmtCurrency(c.dayRate)) : `<span class="muted">—</span>`}</td>
      </tr>`;
    })
    .join("");
  const totals = computeCrewTotals(crew);
  const hotelTotal =
    totalRooms > 0
      ? `${copyTemplate(totalRooms === 1 ? l.roomsOne : l.roomsMany, { count: totalRooms })} · ${copyTemplate(totalNights === 1 ? l.nightsOne : l.nightsMany, { count: totalNights })}`
      : `<span class="muted">—</span>`;
  return `
<section class="section">
  <h2>${escapeHtml(l.crewSection)}</h2>
  <table>
    <thead>
      <tr><th>${escapeHtml(l.name)}</th><th>${escapeHtml(l.role)}</th><th>${escapeHtml(l.call)}</th><th>${escapeHtml(l.off)}</th><th class="num">${escapeHtml(l.hours)}</th><th>${escapeHtml(l.hotel)}</th><th class="num">${escapeHtml(l.dayRate)}</th></tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="row-total">
        <td colspan="4">${escapeHtml(l.totals)} · ${escapeHtml(copyTemplate(totals.count === 1 ? l.crewTotalOne : l.crewTotalMany, { count: totals.count }))} · ${fmt(totals.totalHours, 1)} h</td>
        <td class="num">${fmt(totals.totalHours, 1)} h</td>
        <td>${hotelTotal}</td>
        <td class="num">${escapeHtml(fmtCurrency(totals.totalCost))}</td>
      </tr>
    </tfoot>
  </table>
</section>`;
}

function rigSwlLevel(m: ClientPackSystem["metrics"]): RiskLevel {
  if (m.swl <= 0) return "safe";
  if (m.peak > m.swl) return "danger";
  if (m.peak / m.swl > 0.85) return "warn";
  return "safe";
}

function renderRigging(systems: ClientPackSystem[]): string {
  const l = activeCopy().labels;
  if (systems.length === 0) {
    return `<section class="section">
  <h2>${escapeHtml(l.riggingSection)}</h2>
  <p class="muted">${NS}</p>
</section>`;
  }
  const rows = systems
    .map((s) => {
      const m = s.metrics;
      const util = m.swl > 0 ? `${fmt((m.peak / m.swl) * 100, 0)} %` : "—";
      return `<tr>
        <td><strong>${orNS(s.name)}</strong></td>
        <td>${s.truss.length === 0 ? `<span class="muted">${NS}</span>` : escapeHtml(s.truss.join(", "))}</td>
        <td class="num">${s.pointCount}</td>
        <td>${orNS(s.hoistName)}</td>
        <td class="num">${fmtInt(m.static)} kg</td>
        <td class="num">${fmtInt(m.dynamic)} kg</td>
        <td class="num">${fmtInt(m.peak)} / ${m.swl > 0 ? fmtInt(m.swl) : "—"} kg</td>
        <td class="num">${util}</td>
        <td>${riskPill(rigSwlLevel(m))}</td>
      </tr>`;
    })
    .join("");
  return `
<section class="section">
  <h2>${escapeHtml(l.riggingSection)}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(l.system)}</th>
        <th>${escapeHtml(l.trusses)}</th>
        <th class="num">${escapeHtml(l.pts)}</th>
        <th>${escapeHtml(l.motor)}</th>
        <th class="num">${escapeHtml(l.staticLoad)}</th>
        <th class="num">${escapeHtml(l.dynamicLoad)}</th>
        <th class="num">${escapeHtml(l.peakSwl)}</th>
        <th class="num">${escapeHtml(l.util)}</th>
        <th>${escapeHtml(l.status)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function powerLevel(d: DistroLoad): RiskLevel {
  if (d.feederUtilization > 1) return "danger";
  if (d.feederUtilization > 0.85) return "warn";
  if (d.distro.feedPhases === 3 && d.imbalance > 0.2) return "warn";
  return "safe";
}

function renderLighting(input: ClientPackInput): {
  html: string;
  loads: DistroLoad[];
  unpoweredFixtureCount: number;
} {
  const l = input.copy.labels;
  const wattsLookup = makeFixtureWattsLookup(input.fixtures);
  const loads = input.power.distros.map((d) =>
    computeDistroLoad(d, wattsLookup),
  );
  const unpowered = computeUnpoweredFixtures(input.power.distros, input.fixtures);
  const totals = computeDistroPlanTotals(loads, unpowered);
  const unpoweredFixtureCount = totals.unpoweredFixtureCount;

  const fixtureCount = input.fixtures.reduce(
    (sum, f) =>
      sum +
      (typeof (f as { qty?: number }).qty === "number"
        ? (f as { qty: number }).qty
        : 1),
    0,
  );

  if (loads.length === 0 && fixtureCount === 0) {
    return {
      loads,
      unpoweredFixtureCount,
      html: `<section class="section">
  <h2>${escapeHtml(l.lightingSection)}</h2>
  <p class="muted">${NS}</p>
</section>`,
    };
  }

  const distroRows =
    loads.length === 0
      ? `<tr><td colspan="8" class="muted">${NS}</td></tr>`
      : loads
          .map((d) => {
            const phaseCells = (
              ["L1", "L2", "L3"] as const
            ).map((p) => {
              const ph = d.phases.find((x) => x.phase === p);
              return ph
                ? `<span class="phase-cell">${fmtInt(ph.watts)} W</span>`
                : `<span class="muted">—</span>`;
            });
            const dist = d.distro;
            return `<tr>
            <td><strong>${orNS(dist.name)}</strong></td>
            <td>${escapeHtml(`${dist.feedVoltage} V · ${dist.feedAmps} A · ${copyTemplate(l.phaseCount, { count: dist.feedPhases })}`)}</td>
            <td class="num">${fmtInt(d.totalWatts)} W</td>
            <td class="num">${fmt(d.feederWorstAmps, 1)} A</td>
            <td class="num">${fmt(d.feederUtilization * 100, 0)} %</td>
            <td class="num">${dist.feedPhases === 3 ? `${fmt(d.imbalance * 100, 0)} %` : "—"}</td>
            <td class="phase-row">${phaseCells.join(" ")}</td>
            <td>${riskPill(powerLevel(d))}</td>
          </tr>`;
          })
          .join("");

  return {
    loads,
    unpoweredFixtureCount,
    html: `
<section class="section">
  <h2>${escapeHtml(l.lightingSection)}</h2>
  <div class="overview-grid lighting-summary">
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.fixtures)}</div><div class="ov-value">${fixtureCount}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.distros)}</div><div class="ov-value">${loads.length}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.totalLoad)}</div><div class="ov-value">${fmtInt(totals.totalWatts)} <span class="ov-unit">W</span></div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.unpowered)}</div><div class="ov-value">${unpoweredFixtureCount}</div></div>
  </div>
  ${unpoweredFixtureCount > 0 ? `<div class="warn">⚠ ${escapeHtml(copyTemplate(unpoweredFixtureCount === 1 ? input.copy.riskUnpoweredOne : input.copy.riskUnpoweredMany, { count: unpoweredFixtureCount }))}</div>` : ""}
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(l.distro)}</th>
        <th>${escapeHtml(l.feed)}</th>
        <th class="num">${escapeHtml(l.totalW)}</th>
        <th class="num">${escapeHtml(l.worstLeg)}</th>
        <th class="num">${escapeHtml(l.util)}</th>
        <th class="num">${escapeHtml(l.imbalance)}</th>
        <th>L1 · L2 · L3</th>
        <th>${escapeHtml(l.status)}</th>
      </tr>
    </thead>
    <tbody>${distroRows}</tbody>
  </table>
</section>`,
  };
}

function renderSound(items: SoundItem[]): string {
  const l = activeCopy().labels;
  if (items.length === 0) {
    return `<section class="section">
  <h2>${escapeHtml(l.soundSection)}</h2>
  <p class="muted">${NS}</p>
</section>`;
  }
  const totals = computeSoundTotals(items);
  const rows = items
    .map(
      (it) => `<tr>
        <td>${orNS(it.name)}</td>
        <td>${escapeHtml(it.category)}</td>
        <td class="num">${it.qty}</td>
        <td class="num">${it.weightPerUnit > 0 ? `${fmt(it.qty * it.weightPerUnit, 1)} kg` : `<span class="muted">—</span>`}</td>
        <td class="num">${it.powerPerUnit > 0 ? `${fmtInt(it.qty * it.powerPerUnit)} W` : `<span class="muted">—</span>`}</td>
        <td>${it.notes ? escapeHtml(it.notes) : `<span class="muted">—</span>`}</td>
      </tr>`,
    )
    .join("");
  return `
<section class="section">
  <h2>${escapeHtml(l.soundSection)}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(l.item)}</th><th>${escapeHtml(l.category)}</th>
        <th class="num">${escapeHtml(l.qty)}</th><th class="num">${escapeHtml(l.weight)}</th>
        <th class="num">${escapeHtml(l.power)}</th><th>${escapeHtml(l.placementNotes)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="row-total">
        <td colspan="2">${escapeHtml(l.totals)} · ${escapeHtml(copyTemplate(totals.rowCount === 1 ? l.rowsOne : l.rowsMany, { count: totals.rowCount }))} · ${escapeHtml(copyTemplate(totals.totalQty === 1 ? l.piecesOne : l.piecesMany, { count: totals.totalQty }))}</td>
        <td class="num">${totals.totalQty}</td>
        <td class="num">${fmt(totals.totalWeight, 0)} kg</td>
        <td class="num">${fmtInt(totals.totalPower)} W</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</section>`;
}

function renderStage(stages: Stage[]): string {
  const l = activeCopy().labels;
  if (stages.length === 0) {
    return `<section class="section">
  <h2>${escapeHtml(l.stageSection)}</h2>
  <p class="muted">${NS}</p>
</section>`;
  }
  const calcs: StageCalc[] = stages.map((s) => computeStage(s));
  const totals = computeStageTotals(stages, calcs);
  const rows = stages
    .map((s, i) => {
      const c = calcs[i];
      return `<tr>
        <td><strong>${orNS(s.name)}</strong></td>
        <td>${fmt(s.width, 1)} × ${fmt(s.depth, 1)} m</td>
        <td class="num">${s.legHeightCm} cm</td>
        <td class="num">${fmt(c.areaM2, 1)} m²</td>
        <td class="num">${fmtInt(c.totalWeight)} kg</td>
        <td class="num">${fmtInt(c.loadCapacityKg)} kg <span class="muted">@ ${fmtInt(c.effectiveSwlPerM2)} kg/m²</span></td>
      </tr>`;
    })
    .join("");
  return `
<section class="section">
  <h2>${escapeHtml(l.stageSection)}</h2>
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(l.stage)}</th><th>${escapeHtml(l.dimensions)}</th><th class="num">${escapeHtml(l.legHeight)}</th>
        <th class="num">${escapeHtml(l.area)}</th><th class="num">${escapeHtml(l.buildWeight)}</th><th class="num">${escapeHtml(l.loadCapacity)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="row-total">
        <td colspan="3">${escapeHtml(l.totals)} · ${escapeHtml(copyTemplate(totals.stageCount === 1 ? l.stageOne : l.stageMany, { count: totals.stageCount }))}</td>
        <td class="num">${fmt(totals.totalArea, 1)} m²</td>
        <td class="num">${fmtInt(totals.totalWeight)} kg</td>
        <td class="num">${fmtInt(totals.totalLoadCapacityKg)} kg</td>
      </tr>
    </tfoot>
  </table>
</section>`;
}

function renderLed(input: ClientPackInput): string {
  const l = input.copy.labels;
  if (input.ledScreens.length === 0) {
    return `<section class="section">
  <h2>${escapeHtml(l.ledSection)}</h2>
  <p class="muted">${NS}</p>
</section>`;
  }
  const totals = computeLedTotals(
    input.ledScreens,
    input.ledSettings,
    input.ledPanels,
  );
  // Resolve processor labels for a single screen. Per-screen processors
  // (`screen.processors`) take precedence — that's what the producer
  // explicitly assigned in the LED tab. If none are attached we fall
  // back to the global `ledSettings.processorId` so older projects that
  // never adopted per-screen processors still surface a sensible value.
  const globalProcName =
    findProcessor(input.ledSettings.processorId)?.name ?? null;
  const procLabelsFor = (screen: LedScreen): string => {
    const list = screen.processors ?? [];
    if (list.length === 0) return globalProcName ?? NS;
    return list
      .map((p) => {
        const name =
          NOVASTAR_PROCESSOR_CATALOG[p.model]?.name ?? p.model ?? input.copy.processorFallback;
        return p.label ? `${name} (${p.label})` : name;
      })
      .join(", ");
  };

  const rows = input.ledScreens
    .map((s) => {
      const panel = input.ledPanels.find((p) => p.key === s.panelKey);
      const panelLabel = panel?.name ?? s.panelKey ?? NS;
      const grid = `${s.panelsWide} × ${s.panelsTall}`;
      const panelCount = s.panelsWide * s.panelsTall;
      const m = computeScreenMetrics(s, input.ledPanels);
      const px =
        panel && panel.pixelWidth && panel.pixelHeight
          ? `${m.pixelsX} × ${m.pixelsY} px`
          : NS;
      const procLabels = procLabelsFor(s);
      return `<tr>
        <td><strong>${orNS(s.name)}</strong></td>
        <td>${escapeHtml(panelLabel)}</td>
        <td class="num">${grid}</td>
        <td class="num">${panelCount}</td>
        <td class="num">${px}</td>
        <td>${escapeHtml(procLabels)}</td>
      </tr>`;
    })
    .join("");

  const portStatus =
    input.ledSettings.portLimit > 0 && totals.pixels > 0
      ? riskPill(
          totals.portsNeeded > 8 ? "warn" : "safe",
          copyTemplate(l.portsNeeded, { count: totals.portsNeeded }),
        )
      : "";

  const pixelMaps = input.ledPixelMaps ?? {};
  const figures = input.ledScreens
    .map((s) => {
      const dataUrl = pixelMaps[s.id];
      if (!dataUrl) return "";
      const procLabels = procLabelsFor(s);
      const caption = procLabels && procLabels !== NS
        ? `${escapeHtml(s.name || input.copy.ledScreenFallback)} — ${escapeHtml(input.copy.pixelMap)} · ${escapeHtml(input.copy.processorFallback)}: ${escapeHtml(procLabels)}`
        : `${escapeHtml(s.name || input.copy.ledScreenFallback)} — ${escapeHtml(input.copy.pixelMap)}`;
      return `<figure class="led-figure">
        <img src="${dataUrl}" alt="${escapeHtml(s.name || input.copy.ledScreenFallback)} ${escapeHtml(input.copy.pixelMap)}" />
        <figcaption>${caption}</figcaption>
      </figure>`;
    })
    .filter(Boolean)
    .join("");

  return `
<section class="section">
  <h2>${escapeHtml(l.ledSection)}</h2>
  <div class="overview-grid lighting-summary">
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.screens)}</div><div class="ov-value">${totals.screens}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.cabinets)}</div><div class="ov-value">${totals.panels}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.pixels)}</div><div class="ov-value">${fmtInt(totals.pixels)}</div></div>
    <div class="ov-card"><div class="ov-label">${escapeHtml(l.peakPower)}</div><div class="ov-value">${fmtInt(totals.powerW)} <span class="ov-unit">W</span></div></div>
  </div>
  ${portStatus ? `<p>${escapeHtml(l.processorLoad)}: ${portStatus}</p>` : ""}
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(l.screen)}</th><th>${escapeHtml(l.panelType)}</th>
        <th class="num">${escapeHtml(l.grid)}</th><th class="num">${escapeHtml(l.cabinets)}</th><th class="num">${escapeHtml(l.resolution)}</th>
        <th>${escapeHtml(l.processor)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${figures}
</section>`;
}

function renderRiskSummary(risks: RiskItem[]): string {
  const l = activeCopy().labels;
  if (risks.length === 0) {
    return `<section class="section">
  <h2>${escapeHtml(l.riskSection)}</h2>
  <div class="risk-empty">${riskPill("safe", activeCopy().noIssuesDetected)} — ${escapeHtml(activeCopy().noIssuesDetail)}</div>
</section>`;
  }
  // Sort danger first, then warn
  const sorted = [...risks].sort((a, b) => {
    const score = (l: RiskLevel) =>
      l === "danger" ? 0 : l === "warn" ? 1 : 2;
    return score(a.level) - score(b.level);
  });
  const rows = sorted
    .map(
      (r) => `<tr>
        <td>${riskPill(r.level)}</td>
        <td>${escapeHtml(r.area)}</td>
        <td>${escapeHtml(r.message)}</td>
      </tr>`,
    )
    .join("");
  return `
<section class="section">
  <h2>${escapeHtml(l.riskSection)}</h2>
  <table>
    <thead><tr><th>${escapeHtml(l.status)}</th><th>${escapeHtml(l.riskArea)}</th><th>${escapeHtml(l.detail)}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function renderCostSummary(crew: CrewMember[]): string {
  const l = activeCopy().labels;
  const totals = computeCrewTotals(crew);
  if (crew.length === 0 || totals.totalCost === 0) {
    return `<section class="section">
  <h2>${escapeHtml(l.costSection)}</h2>
  <p class="muted">${NS}</p>
</section>`;
  }
  const byRoleRows = (
    Object.keys(totals.costsByRole) as Array<keyof typeof totals.costsByRole>
  )
    .filter((r) => totals.costsByRole[r] > 0 || totals.countsByRole[r] > 0)
    .map(
      (r) => `<tr>
        <td>${escapeHtml(String(r))}</td>
        <td class="num">${totals.countsByRole[r]}</td>
        <td class="num">${escapeHtml(fmtCurrency(totals.costsByRole[r]))}</td>
      </tr>`,
    )
    .join("");
  return `
<section class="section">
  <h2>${escapeHtml(l.costSection)}</h2>
  <table>
    <thead><tr><th>${escapeHtml(l.department)}</th><th class="num">${escapeHtml(l.headcount)}</th><th class="num">${escapeHtml(l.cost)}</th></tr></thead>
    <tbody>${byRoleRows}</tbody>
    <tfoot>
      <tr class="row-total">
        <td>${escapeHtml(l.totalCrewCost)}</td>
        <td class="num">${totals.count}</td>
        <td class="num">${escapeHtml(fmtCurrency(totals.totalCost))}</td>
      </tr>
    </tfoot>
  </table>
  <p class="muted footnote">${escapeHtml(l.costFootnote)}</p>
</section>`;
}

// ─── Document assembly ────────────────────────────────────────────────

function renderHtml(input: ClientPackInput): string {
  renderLocale = input.locale;
  renderCopy = input.copy;
  NS = input.copy.notSpecified;
  const cover = renderCover(input.project, input.logoDataUrl);
  const overview = renderOverview(input);
  const schedule = renderSchedule(input.schedule, input.copy);
  const crew = renderCrew(input.crew);
  const rigging = renderRigging(input.systems);
  const lighting = renderLighting(input);
  const sound = renderSound(input.sound);
  const stage = renderStage(input.stages);
  const led = renderLed(input);
  const risks = collectRisks(input, lighting.loads, lighting.unpoweredFixtureCount);
  const riskSummary = renderRiskSummary(risks);
  const costSummary = renderCostSummary(input.crew);

  const projTitle =
    input.project.eventName.trim() || input.project.venue.trim() || input.copy.filenameFallback;
  const generatedAt = new Date().toLocaleString(input.locale);

  return `<!doctype html>
<html lang="${escapeHtml(input.locale)}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.copy.clientPack)} — ${escapeHtml(projTitle)}</title>
<meta name="ehs-pdf-name" content="${escapeHtml(projTitle)} — ${escapeHtml(input.copy.clientPack)}.pdf" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a; background: #fff;
    padding: 24px; font-size: 13px; line-height: 1.45;
  }
  h1 { font-size: 28px; margin: 0 0 4px; }
  h2 {
    font-size: 16px; margin: 28px 0 10px;
    padding: 6px 12px; background: #fff7ed; color: #9a3412;
    border-left: 4px solid #f88000; border-radius: 0 4px 4px 0;
  }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .row-total td { font-weight: 700; background: #f1f5f9; }
  .muted { color: #64748b; font-style: italic; }
  .lead { font-size: 14px; margin: 6px 0 14px; color: #334155; }
  .footnote { font-size: 11px; margin-top: 8px; }
  .warn {
    background: #fff7ed; border: 1px solid #fdba74; color: #9a3412;
    padding: 8px 12px; border-radius: 4px; margin: 8px 0; font-size: 12px;
  }
  .section { margin-bottom: 8px; page-break-inside: auto; }

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
  .cover-brand { font-size: 13px; color: #9a3412; letter-spacing: 0.2em;
    text-transform: uppercase; font-weight: 600; margin-bottom: 12px; }
  .cover-title {
    font-size: 36px; font-weight: 800; color: #0f172a;
    margin: 0 0 32px; max-width: 720px;
  }
  .cover-meta {
    display: grid; grid-template-columns: repeat(2, minmax(200px, 280px));
    gap: 16px 32px; margin-bottom: 32px;
  }
  .cover-meta > div {
    display: flex; flex-direction: column; gap: 2px;
    border-top: 2px solid #f88000; padding-top: 8px; text-align: left;
  }
  .cover-meta-label { font-size: 11px; color: #64748b;
    text-transform: uppercase; letter-spacing: 0.06em; }
  .cover-meta-value { font-size: 16px; font-weight: 600; color: #0f172a; }
  .cover-footer { font-size: 11px; color: #94a3b8; margin-top: 24px; }

  /* Overview cards */
  .overview-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 8px; margin: 12px 0 16px;
  }
  .ov-card {
    border: 1px solid #e2e8f0; border-radius: 6px;
    padding: 10px 12px; background: #fff;
  }
  .ov-label { font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.04em; color: #64748b; }
  .ov-value { font-size: 18px; font-weight: 700; color: #0f172a; }
  .ov-unit { font-size: 12px; font-weight: 500; color: #64748b; margin-left: 2px; }
  .lighting-summary { grid-template-columns: repeat(4, 1fr); }

  /* LED pixel-map figures */
  .led-figure {
    margin: 14px 0 0; padding: 8px;
    border: 1px solid #e2e8f0; border-radius: 6px;
    background: #fff; break-inside: avoid; page-break-inside: avoid;
    text-align: center;
  }
  .led-figure img {
    display: block; max-width: 100%; height: auto;
    margin: 0 auto; border-radius: 4px;
  }
  .led-figure figcaption {
    margin-top: 6px; font-size: 11px; color: #64748b;
    letter-spacing: 0.02em;
  }

  /* Risk pill */
  .risk-pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 600; white-space: nowrap;
  }
  .risk-safe { background: #dcfce7; color: #166534; }
  .risk-warn { background: #fef3c7; color: #92400e; }
  .risk-danger { background: #fee2e2; color: #991b1b; }
  .risk-empty { padding: 12px; background: #f0fdf4;
    border: 1px solid #bbf7d0; border-radius: 6px; }

  /* Phase row in lighting table */
  .phase-row { white-space: nowrap; }
  .phase-cell {
    display: inline-block; padding: 1px 6px; margin-right: 4px;
    background: #eef2ff; color: #3730a3; border-radius: 999px;
    font-size: 10px; font-weight: 600;
  }

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
    table { break-inside: avoid; }
    .section { break-inside: auto; }
    h2 { page-break-after: avoid; }
  }
  @page { size: A4 portrait; margin: 12mm; }

  /* "Download PDF" mode — applied by App.tsx while html2canvas
     rasterises the popup at true A4 width (794px). Tightens cover
     and section spacing so each PDF page is properly filled. */
  body.pdf-export {
    padding: 14px 18px 24px;
    font-size: 11px; line-height: 1.4;
  }
  body.pdf-export h1 { font-size: 22px; }
  body.pdf-export h2 { font-size: 14px; }
  body.pdf-export .cover {
    min-height: 0; padding: 28px 20px 32px;
    margin-bottom: 18px; page-break-after: always;
  }
  body.pdf-export .cover-logo { max-height: 56px; margin-bottom: 14px; }
  body.pdf-export .cover-title { font-size: 26px; margin-bottom: 14px; }
  body.pdf-export .section {
    margin-bottom: 14px; padding: 12px 14px;
    page-break-inside: auto; break-inside: auto;
  }
  body.pdf-export table { font-size: 10.5px; margin: 6px 0; }
  body.pdf-export th, body.pdf-export td { padding: 4px 6px; }
  body.pdf-export th { font-size: 9px; }
  body.pdf-export .ov-card { padding: 8px 10px; }
  body.pdf-export .ov-value { font-size: 16px; }
  body.pdf-export .ov-label { font-size: 9px; }
  body.pdf-export .led-figure {
    margin-top: 10px; padding: 6px;
    page-break-inside: avoid; break-inside: avoid;
  }
  body.pdf-export .led-figure figcaption { font-size: 10px; }
</style>
</head>
<body>
<div class="print-bar no-print">
   <button id="ehs-download-pdf" class="primary">${escapeHtml(input.copy.downloadPdf)}</button>
   <button onclick="window.print()">${escapeHtml(input.copy.print)}</button>
   <button onclick="window.close()">${escapeHtml(input.copy.close)}</button>
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
     btn.textContent = ${JSON.stringify(input.copy.generatingPdf)};
    Promise.resolve(fn(window, filename)).catch(function (err) {
      console.error(err);
       alert(${JSON.stringify(input.copy.pdfError)});
      window.print();
    }).then(function () {
      btn.disabled = false;
      btn.textContent = orig;
    });
  });
})();
</script>

${cover}
${overview}
${schedule}
${crew}
${rigging}
${lighting.html}
${sound}
${stage}
${led}
${riskSummary}
${costSummary}

<div class="muted footnote" style="margin-top:24px;text-align:center;border-top:1px solid #e2e8f0;padding-top:12px">
   ${escapeHtml(input.copy.footerAdvisory)} · ${escapeHtml(generatedAt)}
</div>

</body>
</html>`;
}

/** Open a printable Client Pack in a new browser window. The popup
 *  MUST be opened SYNCHRONOUSLY in the click handler (before any async
 *  work such as logo loading) and passed in as `targetWin`, otherwise
 *  pop-up blockers will swallow it. */
export function exportClientPack(input: ClientPackInput): { ok: boolean } {
  const html = renderHtml(input);
  const win = input.targetWin ?? window.open("", "_blank");
  if (!win) return { ok: false };
  win.document.open();
  win.document.write(html);
  win.document.close();
  return { ok: true };
}
