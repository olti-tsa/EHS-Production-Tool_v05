import {
  CONNECTOR_SIDES,
  STAGE_DECKS,
  STAGE_LEGS,
  computeStage,
  effectiveConnectorSide,
  nivtecBracingNote,
  type ConnectorSide,
  type Stage,
  type StageDeckKey,
} from "./stage";

export type StageExportCopy = {
  untitled: string; productionTool: string; buildSheet: string; generated: string;
  print: string; close: string; venueProject: string; date: string; projectManager: string;
  layoutMode: string; manualPlacement: string; autoTiled: string; buildDirection: string;
  rightToLeft: string; leftToRight: string; maleSideFaces: string; overrides: (count: number) => string;
  layout: string; noDecksManual: string; handrail: string; leg: string;
  maleEdges: string; maleEdgesDetail: string; connectorGuidance: string;
  width: string; depth: string; area: string; totalWeight: string; cannotTile: string;
  decks: string; size: string; quantity: string; unit: string; total: string; noDecks: string;
  subtotal: string; legs: string; perDeck: string; sharedCorners: string; pieces: string;
  unitWeight: string; bracingRequired: string; buildSequence: string; deck: string;
  maleSide: string; legsToInstall: string; sequenceHelp: string; loadCapacity: string;
  distributedLoad: string; placedAreaOnly: string; ratedSwl: string; capacityHelp: string;
  handrails: string; side: string; length: string; weight: string; noHandrails: string;
  notes: string; grandTotal: string; footer: string; popupError: string;
  connectorLabel: Record<ConnectorSide, string>; connectorShort: Record<ConnectorSide, string>;
  railSide: Record<"front" | "back" | "left" | "right", string>;
  legsAdded: (count: number) => string; deckCount: (count: number) => string;
  legCount: (count: number) => string;
};

/** EHS orange — male connector edge stripe. Matches StageReportView. */
const MALE_EDGE_COLOR = "#f88000";

type StageCalc = ReturnType<typeof computeStage>;

const DECK_FILL: Record<StageDeckKey, string> = {
  "2x1": "#1f3b8a",
  "1x1": "#5a8edc",
  "0.5x2": "#10b981",
  "0.5x1": "#f59e0b",
};

const DECK_LABEL: Record<StageDeckKey, string> = {
  "2x1": "2 × 1",
  "1x1": "1 × 1",
  "0.5x2": "0.5 × 2",
  "0.5x1": "0.5 × 1",
};

const fmt = (n: number, locale: string, d = 1) =>
  n.toLocaleString(locale, { maximumFractionDigits: d });

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Build a static, top-down SVG of the stage layout — same colours and
 *  geometry as StageSvg but with no interactivity, hover preview, or
 *  click-catcher cells. Includes deck colour fills, deck labels, leg
 *  dots (shared or per-deck), rails, and dimension labels along the
 *  edges. The SVG is sized to roughly fit on an A4 portrait page. */
function buildStageSvg(stage: Stage, calc: StageCalc, locale: string, copy: StageExportCopy): string {
  const PAD = 32;
  const MAX = 720;
  const HALF_M = 0.5;
  const LABEL = 22;

  // For the visual the canvas matches the effective stage rectangle:
  //  - auto mode → the entered W × D (the tiler may leave 0.5 m gaps in
  //    the corners; we still draw the full requested rectangle).
  //  - manual mode → the bounding box of placed decks. Falls back to
  //    the entered W × D if nothing has been placed yet so the page
  //    still renders something readable.
  let canvasW = stage.width;
  let canvasD = stage.depth;
  if (stage.editMode === "manual" && calc.decks.length > 0) {
    let maxX = 0;
    let maxY = 0;
    for (const p of calc.decks) {
      if (p.x + p.w > maxX) maxX = p.x + p.w;
      if (p.y + p.d > maxY) maxY = p.y + p.d;
    }
    canvasW = maxX;
    canvasD = maxY;
  }
  canvasW = Math.max(canvasW, 0.5);
  canvasD = Math.max(canvasD, 0.5);

  const scale = Math.min(MAX / canvasW, MAX / canvasD);
  const W = canvasW * scale + PAD * 2 + LABEL;
  const H = canvasD * scale + PAD * 2 + LABEL;

  const parts: string[] = [];

  // Background canvas (the stage outline).
  parts.push(
    `<rect x="${PAD + LABEL}" y="${PAD}" width="${canvasW * scale}" height="${
      canvasD * scale
    }" fill="#0f172a" fill-opacity="0.04" stroke="#0f172a" stroke-opacity="0.25" stroke-width="1.5" />`,
  );

  // Half-metre grid lines.
  const cellsW = Math.round(canvasW / HALF_M);
  const cellsD = Math.round(canvasD / HALF_M);
  for (let cx = 1; cx < cellsW; cx++) {
    const x = PAD + LABEL + cx * HALF_M * scale;
    parts.push(
      `<line x1="${x}" y1="${PAD}" x2="${x}" y2="${
        PAD + canvasD * scale
      }" stroke="#0f172a" stroke-opacity="${cx % 2 === 0 ? 0.18 : 0.08}" stroke-width="${cx % 2 === 0 ? 1 : 0.5}" />`,
    );
  }
  for (let cy = 1; cy < cellsD; cy++) {
    const y = PAD + cy * HALF_M * scale;
    parts.push(
      `<line x1="${PAD + LABEL}" y1="${y}" x2="${
        PAD + LABEL + canvasW * scale
      }" y2="${y}" stroke="#0f172a" stroke-opacity="${cy % 2 === 0 ? 0.18 : 0.08}" stroke-width="${cy % 2 === 0 ? 1 : 0.5}" />`,
    );
  }

  // Deck rectangles + size labels + assembly badges. Layout matches
  // the on-screen StageSvg view: a white-circle badge with the build
  // sequence number sits ABOVE the size label, and a "+N legs"
  // caption sits below — all centred horizontally on the deck.
  for (let i = 0; i < calc.decks.length; i++) {
    const p = calc.decks[i];
    const asm = calc.assembly[i];
    const dx = PAD + LABEL + p.x * scale;
    const dy = PAD + p.y * scale;
    const dw = p.w * scale;
    const dh = p.d * scale;
    const cxDeck = dx + dw / 2;
    const cyDeck = dy + dh / 2;
    parts.push(
      `<rect x="${dx}" y="${dy}" width="${dw}" height="${dh}" fill="${DECK_FILL[p.key]}" fill-opacity="0.7" stroke="#0f172a" stroke-opacity="0.7" stroke-width="1" />`,
    );
    const sizeFont = Math.min(dw, dh) * 0.22;
    const showSize = dw >= 32 && dh >= 22;
    if (showSize) {
      parts.push(
        `<text x="${cxDeck}" y="${cyDeck}" text-anchor="middle" dominant-baseline="central" font-size="${sizeFont}" font-family="system-ui, sans-serif" fill="#fff" font-weight="600">${DECK_LABEL[p.key]}</text>`,
      );
    }
    if (asm) {
      const badgeRadius = Math.max(8, Math.min(13, Math.min(dw, dh) * 0.16));
      const badgeCy = showSize
        ? cyDeck - sizeFont * 0.55 - badgeRadius - 2
        : cyDeck;
      const captionFont = Math.max(9, badgeRadius * 0.95);
      const captionY = cyDeck + sizeFont * 0.55 + captionFont * 0.9 + 2;
      const stackHeight =
        badgeRadius * 2 + (showSize ? sizeFont : 0) + captionFont + 12;
      const showCaption = showSize && dh >= stackHeight && dw >= 56;
      parts.push(
        `<circle cx="${cxDeck}" cy="${badgeCy}" r="${badgeRadius}" fill="#fff" stroke="#0f172a" stroke-width="1.25" />`,
        `<text x="${cxDeck}" y="${badgeCy}" text-anchor="middle" dominant-baseline="central" font-size="${badgeRadius * 1.15}" font-family="system-ui, sans-serif" fill="#0f172a" font-weight="700">${asm.sequence}</text>`,
      );
      if (showCaption) {
        parts.push(
          `<text x="${cxDeck}" y="${captionY}" text-anchor="middle" dominant-baseline="central" font-size="${captionFont}" font-family="system-ui, sans-serif" fill="#fff" font-weight="600">+${asm.legsAdded} ${copy.legsAdded(asm.legsAdded)}</text>`,
        );
      }
    }
  }

  // Male-connector edge stripes — one thin orange band along the side
  // of each deck where the male pins face. Matches the on-screen view.
  const STRIPE_PX = 5;
  for (let i = 0; i < calc.decks.length; i++) {
    const p = calc.decks[i];
    // Only the deck(s) landed with 4 fresh legs need an orange marker
    // — every other deck is force-oriented by hooking into a
    // previously placed deck. See StageReportView for the full
    // rationale.
    const legsAdded = calc.assembly[i]?.legsAdded ?? 0;
    if (legsAdded !== 4) continue;
    const primary = effectiveConnectorSide(stage, p);
    // Per Nivtec's "tongue rear AND right" rule each deck has TWO male
    // edges 90° apart, clockwise from the primary.
    const adjacent =
      CONNECTOR_SIDES[
        (CONNECTOR_SIDES.indexOf(primary) + 1) % CONNECTOR_SIDES.length
      ];
    const dx = PAD + LABEL + p.x * scale;
    const dy = PAD + p.y * scale;
    const dw = p.w * scale;
    const dh = p.d * scale;
    for (const side of [primary, adjacent]) {
      let rx = dx;
      let ry = dy;
      let rw = dw;
      let rh = dh;
      if (side === "N") {
        rh = STRIPE_PX;
      } else if (side === "S") {
        ry = dy + dh - STRIPE_PX;
        rh = STRIPE_PX;
      } else if (side === "E") {
        rx = dx + dw - STRIPE_PX;
        rw = STRIPE_PX;
      } else {
        rw = STRIPE_PX;
      }
      parts.push(
        `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${MALE_EDGE_COLOR}" fill-opacity="0.9" />`,
      );
    }
  }

  // Leg dots.
  if (stage.legMode === "perDeck") {
    for (const p of calc.decks) {
      const inset = Math.min(p.w, p.d) * 0.12 * scale;
      const x1 = PAD + LABEL + p.x * scale + inset;
      const y1 = PAD + p.y * scale + inset;
      const x2 = PAD + LABEL + (p.x + p.w) * scale - inset;
      const y2 = PAD + (p.y + p.d) * scale - inset;
      parts.push(
        `<circle cx="${x1}" cy="${y1}" r="3" fill="#0f172a" />`,
        `<circle cx="${x2}" cy="${y1}" r="3" fill="#0f172a" />`,
        `<circle cx="${x1}" cy="${y2}" r="3" fill="#0f172a" />`,
        `<circle cx="${x2}" cy="${y2}" r="3" fill="#0f172a" />`,
      );
    }
  } else {
    for (const lp of calc.legPositions) {
      // Find any deck that owns this corner so we can offset the dot
      // slightly inward (matches the on-screen rendering).
      const owner = calc.decks.find(
        (p) =>
          (Math.abs(lp.x - p.x) < 1e-6 || Math.abs(lp.x - (p.x + p.w)) < 1e-6) &&
          (Math.abs(lp.y - p.y) < 1e-6 || Math.abs(lp.y - (p.y + p.d)) < 1e-6),
      );
      if (!owner) continue;
      const inset = Math.min(owner.w, owner.d) * 0.12;
      const cxIn = Math.abs(lp.x - owner.x) < 1e-6 ? lp.x + inset : lp.x - inset;
      const cyIn = Math.abs(lp.y - owner.y) < 1e-6 ? lp.y + inset : lp.y - inset;
      parts.push(
        `<circle cx="${PAD + LABEL + cxIn * scale}" cy="${PAD + cyIn * scale}" r="3" fill="#0f172a" />`,
      );
    }
  }

  // Rails: drawn as thick red lines along whichever sides are enabled.
  // The rail length per side is the full effective stage extent on that
  // axis, so we draw across the bounding box.
  if (stage.rails.front || stage.rails.back || stage.rails.left || stage.rails.right) {
    const left = PAD + LABEL;
    const right = PAD + LABEL + canvasW * scale;
    const top = PAD;
    const bot = PAD + canvasD * scale;
    // Rails follow the same convention as the on-screen StageSvg:
    //   front → bottom edge,  back → top edge.
    if (stage.rails.front) {
      parts.push(
        `<line x1="${left}" y1="${bot}" x2="${right}" y2="${bot}" stroke="#dc2626" stroke-width="4" />`,
      );
    }
    if (stage.rails.back) {
      parts.push(
        `<line x1="${left}" y1="${top}" x2="${right}" y2="${top}" stroke="#dc2626" stroke-width="4" />`,
      );
    }
    if (stage.rails.left) {
      parts.push(
        `<line x1="${left}" y1="${top}" x2="${left}" y2="${bot}" stroke="#dc2626" stroke-width="4" />`,
      );
    }
    if (stage.rails.right) {
      parts.push(
        `<line x1="${right}" y1="${top}" x2="${right}" y2="${bot}" stroke="#dc2626" stroke-width="4" />`,
      );
    }
  }

  // Dimension labels: width across the top, depth along the left side.
  parts.push(
    `<text x="${PAD + LABEL + (canvasW * scale) / 2}" y="${PAD - 8}" text-anchor="middle" font-size="13" font-family="system-ui, sans-serif" fill="#0f172a" font-weight="600">${fmt(canvasW, locale, 2)} m</text>`,
  );
  parts.push(
    `<text x="${PAD + LABEL - 8}" y="${PAD + (canvasD * scale) / 2}" text-anchor="middle" font-size="13" font-family="system-ui, sans-serif" fill="#0f172a" font-weight="600" transform="rotate(-90 ${PAD + LABEL - 8} ${PAD + (canvasD * scale) / 2})">${fmt(canvasD, locale, 2)} m</text>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px;height:auto;display:block">${parts.join(
    "",
  )}</svg>`;
}

/** Project metadata that appears in the header of the export. */
export type StageExportProject = {
  venue: string;
  date: string;
  /** Optional ISO end date (YYYY-MM-DD) for multi-day shows. When set,
   *  the export header shows the date as a "from → to" range. */
  endDate?: string;
  preparedBy: string;
};

/** Build the standalone HTML document for a Stage Build Sheet. Returned
 *  as a string so callers can either (a) render it into a popup window
 *  for printing, or (b) hand it to `downloadHtmlAsPdf` for a direct
 *  PDF download with no print dialog.
 *
 *  Includes everything the build crew needs: project meta, top-down
 *  stage visual, deck list, leg list, rails, load capacity, bracing
 *  requirements, and notes. */
export function buildStageReportHtml(input: {
  stage: Stage;
  calc: StageCalc;
  project: StageExportProject;
  logoDataUrl: string | null;
  locale: string;
  copy: StageExportCopy;
}): string {
  const { stage, calc, project, logoDataUrl, locale, copy } = input;
  const usedDecks = STAGE_DECKS.filter((d) => calc.deckCounts[d.key] > 0);
  const legSpec = STAGE_LEGS.find((l) => l.heightCm === stage.legHeightCm);
  const bracing = nivtecBracingNote(stage.legHeightCm);
  const stageName = stage.name.trim() || copy.untitled;
  const generatedAt = new Date().toLocaleString(locale);
  const svg = buildStageSvg(stage, calc, locale, copy);

  // Effective stage size: in auto mode it's the entered W × D; in manual
  // mode it's the bounding box of the placed decks.
  let effectiveW = stage.width;
  let effectiveD = stage.depth;
  if (stage.editMode === "manual") {
    effectiveW = 0;
    effectiveD = 0;
    for (const p of calc.decks) {
      if (p.x + p.w > effectiveW) effectiveW = p.x + p.w;
      if (p.y + p.d > effectiveD) effectiveD = p.y + p.d;
    }
  }

  const railsRows =
    calc.railBreakdown.length === 0
      ? `<tr><td colspan="4" class="muted">— ${copy.noHandrails} —</td></tr>`
      : calc.railBreakdown
          .map(
            (r) =>
              `<tr><td>${copy.railSide[r.side]}</td><td>${fmt(r.lengthM, locale, 1)} m</td><td>${r.count2m}</td><td>${r.count1m}</td></tr>`,
          )
          .join("") +
        `<tr class="row-total"><td>${copy.subtotal}</td><td>${fmt(calc.railLengthTotal, locale, 1)} m</td><td>${calc.rails2mTotal}</td><td>${calc.rails1mTotal}</td></tr>` +
        `<tr><td colspan="3">${copy.weight}</td><td>${fmt(calc.railWeight, locale, 1)} kg</td></tr>`;

  const decksRows =
    usedDecks.length === 0
      ? `<tr><td colspan="4" class="muted">— ${copy.noDecks} —</td></tr>`
      : usedDecks
          .map(
            (d) =>
              `<tr><td>${d.label}</td><td>${calc.deckCounts[d.key]}</td><td>${fmt(d.weight, locale, 1)} kg</td><td>${fmt(d.weight * calc.deckCounts[d.key], locale, 1)} kg</td></tr>`,
          )
          .join("") +
        `<tr class="row-total"><td>${copy.subtotal}</td><td></td><td></td><td>${fmt(calc.deckWeight, locale, 1)} kg</td></tr>`;

  // Build sequence: numbered, in the order the crew should assemble.
  // Mirrors the on-screen badges (1, 2, 3…) and shows how many legs
  // are added per deck so the build crew can pre-stage hardware.
  const assemblyRows =
    calc.assembly.length === 0
      ? `<tr><td colspan="4" class="muted">— ${copy.noDecks} —</td></tr>`
      : calc.assembly
          .map((a) => {
            const deck = calc.decks[a.sequence - 1];
            const sizeLabel = deck ? DECK_LABEL[deck.key] : "—";
            const side = deck ? effectiveConnectorSide(stage, deck) : null;
            const isOverride = deck
              ? stage.connectorOverrides[
                  `${deck.x.toFixed(2)},${deck.y.toFixed(2)}`
                ] !== undefined
              : false;
            const sideCell = side
              ? `${copy.connectorShort[side]}${isOverride ? ' <span style="color:#b45309;font-weight:600">●</span>' : ""}`
              : "—";
            return `<tr><td><strong>${a.sequence}</strong></td><td>${sizeLabel}</td><td>${sideCell}</td><td>+${a.legsAdded} ${copy.legsAdded(a.legsAdded)}</td></tr>`;
          })
          .join("") +
        `<tr class="row-total"><td>${copy.total}</td><td>${calc.decks.length} ${copy.deckCount(calc.decks.length)}</td><td></td><td>${calc.legCount} ${copy.legCount(calc.legCount)}</td></tr>`;

  const railsEnabled = (
    ["front", "back", "left", "right"] as const
  ).filter((side) => stage.rails[side]);

  const html = `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8" />
<title>${copy.buildSheet} — ${escapeHtml(stageName)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  /* The Stage Build Sheet HTML is rendered into a hidden iframe pinned
     at A4-portrait width (~794px) by htmlToPdf.ts, so all spacing here
     is sized for a real A4 page — tight margins, compact tables, and
     section blocks that are page-break-aware. */
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
    background: #fff;
    padding: 16px 18px 24px;
    font-size: 11px;
    line-height: 1.4;
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 {
    font-size: 14px; margin: 14px 0 6px;
    padding-bottom: 3px; border-bottom: 1px solid #e2e8f0;
    page-break-after: avoid; break-after: avoid;
  }
  h3 { font-size: 11px; margin: 10px 0 4px; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
  .header {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 12px; padding-bottom: 10px; border-bottom: 2px solid #f88000;
    margin-bottom: 12px;
  }
  .header-left { display: flex; gap: 10px; align-items: center; }
  .logo { height: 38px; width: auto; }
  .brand { font-size: 11px; color: #64748b; }
  .brand strong { color: #0f172a; font-size: 13px; display: block; }
  .header-right { text-align: right; font-size: 10px; color: #64748b; }
  .meta-grid {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 8px 18px; margin-bottom: 12px;
  }
  .meta-item .label { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
  .meta-item .value { font-weight: 600; font-size: 12px; word-break: break-word; }
  .stage-visual {
    border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;
    background: #f8fafc; margin-bottom: 12px;
    page-break-inside: avoid; break-inside: avoid;
  }
  .stage-visual svg { max-width: 100%; height: auto; }
  .legend {
    display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px;
    font-size: 10px; color: #475569;
  }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend i {
    width: 10px; height: 10px; display: inline-block; border-radius: 2px;
    border: 1px solid rgba(15, 23, 42, 0.4);
  }
  .legend i.leg { border-radius: 50%; background: #0f172a; border: none; width: 8px; height: 8px; }
  .specs-grid {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 6px; margin-bottom: 12px;
  }
  .spec-card {
    border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px;
    background: #fff;
  }
  .spec-card .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
  .spec-card .value { font-size: 16px; font-weight: 700; color: #0f172a; }
  .spec-card .unit { font-size: 11px; font-weight: 500; color: #64748b; margin-left: 3px; }
  table {
    width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10.5px;
    page-break-inside: avoid; break-inside: avoid;
  }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .row-total td { font-weight: 700; background: #f1f5f9; }
  .muted { color: #64748b; font-style: italic; }
  .warn {
    background: #fff7ed; border: 1px solid #fdba74; color: #9a3412;
    padding: 6px 10px; border-radius: 4px; margin: 6px 0; font-size: 11px;
  }
  .notes-box {
    border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px;
    background: #f8fafc; white-space: pre-wrap; font-size: 11px;
  }
  .grand-total {
    margin-top: 12px; padding: 10px 14px; background: #0f172a; color: #fff;
    border-radius: 6px; display: flex; justify-content: space-between;
    align-items: center; font-size: 12px;
    page-break-inside: avoid; break-inside: avoid;
  }
  .grand-total strong { font-size: 16px; }
  .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; text-align: center; }
  .two-col {
    display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
    page-break-inside: avoid; break-inside: avoid;
  }
  @media print {
    body { padding: 12mm; font-size: 11px; }
    .stage-visual { break-inside: avoid; }
    table { break-inside: avoid; }
    .grand-total { break-inside: avoid; }
    .no-print { display: none !important; }
  }
  @page { size: A4 portrait; margin: 12mm; }
  .print-bar {
    position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; z-index: 10;
  }
  .print-bar button {
    padding: 8px 14px; font-size: 13px; font-weight: 600;
    border: 1px solid #cbd5e1; border-radius: 4px; background: #fff;
    cursor: pointer;
  }
  .print-bar .primary { background: #f88000; color: #fff; border-color: #f88000; }
</style>
</head>
<body>
<div class="print-bar no-print">
   <button onclick="window.print()" class="primary">${copy.print}</button>
   <button onclick="window.close()">${copy.close}</button>
</div>

<div class="header">
  <div class="header-left">
    ${logoDataUrl ? `<img src="${logoDataUrl}" alt="EHS" class="logo" />` : ""}
    <div class="brand">
       <strong>${copy.productionTool}</strong>
       ${copy.buildSheet}
    </div>
  </div>
  <div class="header-right">
     ${copy.generated} ${escapeHtml(generatedAt)}
  </div>
</div>

<h1>${escapeHtml(stageName)}</h1>

<div class="meta-grid">
  <div class="meta-item">
     <div class="label">${copy.venueProject}</div>
    <div class="value">${escapeHtml(project.venue || "—")}</div>
  </div>
  <div class="meta-item">
     <div class="label">${copy.date}</div>
    <div class="value">${
      project.endDate && project.endDate !== project.date
        ? `${escapeHtml(project.date || "—")} → ${escapeHtml(project.endDate)}`
        : escapeHtml(project.date || "—")
    }</div>
  </div>
  <div class="meta-item">
     <div class="label">${copy.projectManager}</div>
    <div class="value">${escapeHtml(project.preparedBy || "—")}</div>
  </div>
  <div class="meta-item">
     <div class="label">${copy.layoutMode}</div>
     <div class="value">${stage.editMode === "manual" ? copy.manualPlacement : copy.autoTiled}</div>
  </div>
  <div class="meta-item">
     <div class="label">${copy.buildDirection}</div>
     <div class="value">${stage.buildOrder === "rightToLeft" ? copy.rightToLeft : copy.leftToRight}</div>
  </div>
  <div class="meta-item">
     <div class="label">${copy.maleSideFaces}</div>
     <div class="value">${copy.connectorLabel[stage.connectorSide]}${
      Object.keys(stage.connectorOverrides).length > 0
        ? ` <span style="color:#b45309;font-weight:600">(${copy.overrides(Object.keys(stage.connectorOverrides).length)})</span>`
        : ""
    }</div>
  </div>
</div>

<h2>${copy.layout}</h2>
<div class="stage-visual">
  ${
    stage.editMode === "manual" && calc.decks.length === 0
      ? `<div style="padding:32px;text-align:center;color:#64748b;font-style:italic">${copy.noDecksManual}</div>`
      : svg
  }
  <div class="legend">
    <span><i style="background:${DECK_FILL["2x1"]}"></i> 2 × 1</span>
    <span><i style="background:${DECK_FILL["1x1"]}"></i> 1 × 1</span>
    <span><i style="background:${DECK_FILL["0.5x2"]}"></i> 0.5 × 2</span>
    <span><i style="background:${DECK_FILL["0.5x1"]}"></i> 0.5 × 1</span>
     <span><i style="background:#dc2626"></i> ${copy.handrail}</span>
     <span><i class="leg"></i> ${copy.leg}</span>
     <span><i style="background:${MALE_EDGE_COLOR}"></i> ${copy.maleEdges} (${copy.connectorShort[stage.connectorSide]} + ${copy.maleEdgesDetail})</span>
  </div>
  <p class="muted" style="font-size:11px;margin:6px 0 0;line-height:1.4">
     ${copy.connectorGuidance}
  </p>
</div>

<div class="specs-grid">
  <div class="spec-card">
     <div class="label">${copy.width}</div>
     <div class="value">${fmt(effectiveW, locale, 2)}<span class="unit">m</span></div>
  </div>
  <div class="spec-card">
     <div class="label">${copy.depth}</div>
     <div class="value">${fmt(effectiveD, locale, 2)}<span class="unit">m</span></div>
  </div>
  <div class="spec-card">
     <div class="label">${copy.area}</div>
     <div class="value">${fmt(calc.areaM2, locale, 2)}<span class="unit">m²</span></div>
  </div>
  <div class="spec-card">
     <div class="label">${copy.totalWeight}</div>
     <div class="value">${fmt(calc.totalWeight, locale, 0)}<span class="unit">kg</span></div>
  </div>
</div>

${
  !calc.fits
    ? `<div class="warn">⚠ ${copy.cannotTile}</div>`
    : ""
}

<div class="two-col">
  <div>
     <h2>${copy.decks}</h2>
    <table>
       <thead><tr><th>${copy.size}</th><th>${copy.quantity}</th><th>${copy.unit}</th><th>${copy.total}</th></tr></thead>
      <tbody>${decksRows}</tbody>
    </table>
  </div>
  <div>
     <h2>${copy.legs} (${stage.legHeightCm} cm · ${stage.legMode === "perDeck" ? copy.perDeck : copy.sharedCorners})</h2>
    <table>
      <tbody>
         <tr><td>${copy.quantity}</td><td>${calc.legCount} ${copy.pieces}</td></tr>
         <tr><td>${copy.unitWeight}</td><td>${fmt(legSpec?.weight ?? 0, locale, 2)} kg</td></tr>
         <tr class="row-total"><td>${copy.subtotal}</td><td>${fmt(calc.legWeight, locale, 1)} kg</td></tr>
      </tbody>
    </table>
    ${
      bracing.length > 0
        ? `<div class="warn"><strong>${copy.bracingRequired}:</strong><br />${bracing.map((b) => escapeHtml(b)).join("<br />")}</div>`
        : ""
    }
  </div>
</div>

<h2>${copy.buildSequence} (${stage.buildOrder === "rightToLeft" ? copy.rightToLeft : copy.leftToRight})</h2>
<table>
  <thead><tr><th>#</th><th>${copy.deck}</th><th>${copy.maleSide}</th><th>${copy.legsToInstall}</th></tr></thead>
  <tbody>${assemblyRows}</tbody>
</table>
<p class="muted" style="font-size:11px;margin:0 0 12px">
  ${copy.sequenceHelp}
</p>

<h2>${copy.loadCapacity}</h2>
<table>
  <tbody>
    <tr><td>${copy.distributedLoad}</td><td><strong>${fmt(calc.loadCapacityKg, locale, 0)} kg</strong>${!calc.fits ? ` (${copy.placedAreaOnly})` : ""}</td></tr>
    <tr><td>${copy.ratedSwl}</td><td>${fmt(calc.effectiveSwlPerM2, locale, 0)} kg/m² @ ${stage.legHeightCm} cm</td></tr>
  </tbody>
</table>
<p class="muted" style="font-size:11px;margin:0 0 12px">
  ${copy.capacityHelp}
</p>

<h2>${copy.handrails} ${railsEnabled.length > 0 ? `(${railsEnabled.map((side) => copy.railSide[side]).join(", ")})` : ""}</h2>
<table>
  <thead><tr><th>${copy.side}</th><th>${copy.length}</th><th>2 m</th><th>1 m</th></tr></thead>
  <tbody>${railsRows}</tbody>
</table>

${
  stage.notes && stage.notes.trim().length > 0
    ? `<h2>${copy.notes}</h2><div class="notes-box">${escapeHtml(stage.notes)}</div>`
    : ""
}

<div class="grand-total">
  <span>${copy.grandTotal}</span>
  <strong>${fmt(calc.totalWeight, locale, 1)} kg</strong>
</div>

<div class="footer">
  ${copy.footer}
</div>
</body>
</html>`;

  return html;
}

/** Open a printable Stage Build Sheet in a new browser window. The user
 *  can save it as PDF (Print → Save as PDF) or send it straight to a
 *  printer. Kept for the legacy popup-print flow — most callers should
 *  prefer `buildStageReportHtml` + `downloadHtmlAsPdf` for a direct
 *  download with no print dialog.
 *
 *  Caller must open the target window SYNCHRONOUSLY inside the user's
 *  click handler and pass it in as `targetWin` — otherwise pop-up
 *  blockers will silently swallow the new tab. */
export function exportStageReport(input: {
  stage: Stage;
  calc: StageCalc;
  project: StageExportProject;
  logoDataUrl: string | null;
  locale: string;
  copy: StageExportCopy;
  /** Pre-opened popup window from the click handler. */
  targetWin: Window | null;
}): void {
  const { targetWin } = input;
  const html = buildStageReportHtml(input);

  if (!targetWin) {
    // Caller's synchronous window.open() was blocked. Try a last-ditch
    // open here (will likely also be blocked, but we leave the door
    // open for browsers configured permissively).
    const fallback = window.open("", "_blank");
    if (!fallback) {
      alert(
        input.copy.popupError,
      );
      return;
    }
    fallback.document.open();
    fallback.document.write(html);
    fallback.document.close();
    return;
  }
  targetWin.document.open();
  targetWin.document.write(html);
  targetWin.document.close();
}
