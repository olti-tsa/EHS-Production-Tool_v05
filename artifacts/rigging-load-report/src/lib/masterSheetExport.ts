/**
 * Builds a print-friendly HTML version of the Crew & Logistics master
 * sheet and opens it in a new tab with a "Print / Save as PDF"
 * button. Same approach as `roomingListExport.ts` /
 * `cateringSheetExport.ts`: build an escaped HTML string with embedded
 * CSS (including `@page A4 landscape` and `@media print` rules), wrap
 * it in a Blob, and open via a hidden anchor. No PDF libraries — the
 * browser's native Print dialog produces the PDF.
 *
 * Sheet structure:
 *   1. Header band: project name + venue + generated timestamp.
 *   2. Single wide table mirroring the on-screen master sheet:
 *      Name · Role · Status · Days · Hotel · Food · Phone
 *      · Notes (and Call/Off/Day-rate when "Show production details"
 *      is on, so the printed handoff matches what the producer sees).
 *   3. Footer with brief reference + a small legend explaining the
 *      day chips (so the recipient — runner, hotel, catering — can
 *      decode the "1 2 3" working-day strip without guessing).
 *
 * Page is forced to A4 landscape because the master sheet is wide
 * (10–13 columns). Portrait clips off Notes / Day-rate which defeats
 * the purpose of a one-page handoff.
 */

import type { RosterRow } from "./crewRoster";
import type { Locale } from "./i18n/types";

export type MasterSheetExportCopy = {
  title: string;
  documentTitle: string;
  untitledBrief: string;
  generated: string;
  rosterCount: (count: number) => string;
  hotelSummary: (rooms: number, nights: number) => string;
  empty: string;
  table: { name: string; role: string; status: string; days: string; hotel: string; food: string; phone: string; notes: string; call: string; off: string; dayRate: string };
  footer: string;
  print: string;
  dayKey: string;
  numberedByDate: string;
  status: Record<RosterRow["status"], string>;
  food: { profileMissing: string; none: string; vegetarian: string; vegan: string; halal: string; glutenFree: string; lactoseFree: string; allergens: (count: number) => string };
  hotel: { nights: (count: number) => string; required: string; notRequired: string };
};

/** Row payload for the print export. We deliberately re-type instead
 *  of reusing RosterRow directly because call/off times don't live on
 *  the merged roster (they're only on the producer's local CrewMember
 *  rows). The caller is responsible for resolving the local twin per
 *  row and threading those two extra fields in — this keeps the export
 *  module decoupled from the local-vs-portal lookup logic in the
 *  component. */
export type MasterSheetRow = RosterRow & {
  callTime?: string;
  offTime?: string;
};

export type MasterSheetInput = {
  briefName: string;
  venue: string;
  rows: ReadonlyArray<MasterSheetRow>;
  /** ISO date strings for every day in the brief's window. Used as
   *  the legend underneath the table — without it the "1 2 3" chip
   *  numbering is meaningless to anyone but the producer. */
  projectDays: ReadonlyArray<string>;
  /** Mirrors the on-screen toggle. When true, Call / Off / Day-rate
   *  columns are added. We always print Notes — it's a fundamental
   *  call-sheet column, just hidden on small screens. */
  showProductionDetails: boolean;
  locale: Locale;
  copy: MasterSheetExportCopy;
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function localeId(locale: Locale): string {
  return locale === "no" ? "nb-NO" : "en-US";
}

function fmtDateShort(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(localeId(locale), {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function fmtGeneratedNow(locale: Locale): string {
  return new Date().toLocaleString(localeId(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact "1 2 3 / 4" chip strip — same idea as the on-screen
 *  buildDayChips, but we render WORKING days only as bold and any
 *  remaining project days as muted dots (so a runner can still see
 *  "this person is OFF on day 4"). Falls back to a per-date list when
 *  there are no project days at all (purely-local rows). */
function dayChipsHtml(
  assigned: ReadonlyArray<string>,
  projectDays: ReadonlyArray<string>,
  locale: Locale,
): string {
  if (projectDays.length === 0) {
    if (assigned.length === 0) return '<span class="ms-empty">—</span>';
    return assigned.map((d) => `<span class="ms-chip ms-chip-on">${escHtml(fmtDateShort(d, locale))}</span>`).join(" ");
  }
  const set = new Set(assigned);
  return projectDays
    .map((d, i) => {
      const on = set.has(d);
      const cls = on ? "ms-chip ms-chip-on" : "ms-chip ms-chip-off";
      return `<span class="${cls}" title="${escHtml(d)}">${i + 1}</span>`;
    })
    .join(" ");
}

function foodHtml(row: RosterRow, copy: MasterSheetExportCopy): string {
  if (row.source !== "gig") return '<span class="ms-empty">—</span>';
  if (row.profileless) return `<span class="ms-empty" title="${escHtml(copy.food.profileMissing)}">?</span>`;
  if (row.dietaryTags.length === 0 && row.allergens.length === 0) {
    return `<span class="ms-muted">${escHtml(copy.food.none)}</span>`;
  }
  const dietaryLabels: Record<string, string> = {
    vegetarian: copy.food.vegetarian, vegan: copy.food.vegan, halal: copy.food.halal,
    "gluten-free": copy.food.glutenFree, "lactose-free": copy.food.lactoseFree,
  };
  const tagHtml = row.dietaryTags
    .map(
      (t) =>
        `<span class="ms-pill ms-pill-warn">${escHtml(dietaryLabels[t] ?? t)}</span>`,
    )
    .join(" ");
  const allergenHtml =
    row.allergens.length > 0
      ? `<span class="ms-pill ms-pill-bad" title="${escHtml(row.allergens.join(", "))}">⚠ ${escHtml(copy.food.allergens(row.allergens.length))}</span>`
      : "";
  return `${tagHtml}${tagHtml && allergenHtml ? " " : ""}${allergenHtml}`;
}

function rowsHtml(input: MasterSheetInput): string {
  return input.rows
    .map((row) => {
      const status = input.copy.status[row.status];
      const nights = row.hotelDates?.length ?? 0;
      const hotel =
        nights > 0
          ? `<span class="ms-pill ms-pill-ok" title="${escHtml(row.hotelDates.join(", "))}">🏨 ${escHtml(input.copy.hotel.nights(nights))}</span>`
          : row.hotelRequired
            ? `<span class="ms-pill ms-pill-ok">${escHtml(input.copy.hotel.required)}</span>`
            : `<span class="ms-muted">${escHtml(input.copy.hotel.notRequired)}</span>`;
      const phone = row.phone
        ? `<span class="ms-phone">${escHtml(row.phone)}</span>`
        : '<span class="ms-empty">—</span>';
      const notes = row.notes
        ? escHtml(row.notes)
        : '<span class="ms-empty">—</span>';
      const callTime = row.callTime ?? "";
      const offTime = row.offTime ?? "";
      const productionCells = input.showProductionDetails
        ? `
        <td class="ms-cell-num">${callTime ? escHtml(callTime) : '<span class="ms-empty">—</span>'}</td>
        <td class="ms-cell-num">${offTime ? escHtml(offTime) : '<span class="ms-empty">—</span>'}</td>
        <td class="ms-cell-num">${row.dayRate ? escHtml(row.dayRate.toLocaleString(localeId(input.locale))) : '<span class="ms-empty">—</span>'}</td>`
        : "";
      return `
      <tr>
        <td class="ms-cell-name"><strong>${escHtml(row.name || "—")}</strong></td>
        <td>${escHtml(row.role || "—")}</td>
        <td>${escHtml(status)}</td>
        <td class="ms-cell-days">${dayChipsHtml(row.assignedDates, input.projectDays, input.locale)}</td>
        <td>${hotel}</td>
        <td>${foodHtml(row, input.copy)}</td>
        <td>${phone}</td>
        <td class="ms-cell-notes">${notes}</td>${productionCells}
      </tr>`;
    })
    .join("");
}

function legendHtml(projectDays: ReadonlyArray<string>, locale: Locale, copy: MasterSheetExportCopy): string {
  if (projectDays.length === 0) return "";
  // We list at most ~12 days inline; beyond that the legend would
  // wrap awkwardly so we collapse to a "Day 1 = <date> · Day N =
  // <date>" range form.
  if (projectDays.length <= 12) {
    return `
      <div class="ms-legend">
        <strong>${escHtml(copy.dayKey)}:</strong>
        ${projectDays
          .map(
            (d, i) =>
              `<span class="ms-legend-item">${i + 1} = ${escHtml(fmtDateShort(d, locale))}</span>`,
          )
          .join("")}
      </div>`;
  }
  const first = projectDays[0]!;
  const last = projectDays[projectDays.length - 1]!;
  return `
    <div class="ms-legend">
      <strong>${escHtml(copy.dayKey)}:</strong>
      <span class="ms-legend-item">1 = ${escHtml(fmtDateShort(first, locale))}</span>
      <span class="ms-legend-item">${projectDays.length} = ${escHtml(fmtDateShort(last, locale))}</span>
      <span class="ms-legend-item ms-legend-hint">(${escHtml(copy.numberedByDate)})</span>
    </div>`;
}

export function openMasterSheet(input: MasterSheetInput): { ok: boolean } {
  const generated = fmtGeneratedNow(input.locale);
  const projectName = input.briefName || input.copy.untitledBrief;
  const venue = input.venue || "—";
  const productionHeaders = input.showProductionDetails
    ? `
        <th class="ms-num">${escHtml(input.copy.table.call)}</th>
        <th class="ms-num">${escHtml(input.copy.table.off)}</th>
        <th class="ms-num">${escHtml(input.copy.table.dayRate)}</th>`
    : "";

  const html = `<!doctype html>
<html lang="${input.locale === "no" ? "nb-NO" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${escHtml(projectName)} — ${escHtml(input.copy.documentTitle)}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, sans-serif;
      color: #111;
      background: #f5f5f5;
      padding: 16px;
    }
    .ms-page {
      background: #fff;
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px 28px 28px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
    }
    .ms-band {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 20px;
      padding-bottom: 12px;
      margin-bottom: 14px;
      border-bottom: 2px solid #111;
    }
    .ms-band h1 {
      margin: 0;
      font-size: 22px;
      letter-spacing: -0.3px;
    }
    .ms-band-sub {
      font-size: 11px;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 4px;
    }
    .ms-band-venue {
      font-size: 13px;
      color: #444;
      margin-top: 2px;
    }
    .ms-band-right {
      font-size: 11px;
      color: #555;
      text-align: right;
      white-space: nowrap;
    }
    .ms-band-count {
      font-size: 18px;
      font-weight: 700;
      color: #111;
      display: block;
      margin-top: 2px;
    }
    .ms-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .ms-table th,
    .ms-table td {
      text-align: left;
      vertical-align: top;
      padding: 6px 7px;
      border-bottom: 1px solid #eee;
    }
    .ms-table th {
      font-size: 10px;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: #555;
      font-weight: 700;
      background: #fafafa;
      border-bottom: 1.5px solid #ccc;
    }
    .ms-table tbody tr:nth-child(even) td {
      background: #fbfbfb;
    }
    .ms-cell-name { min-width: 120px; }
    .ms-cell-days { white-space: nowrap; }
    .ms-cell-notes { max-width: 200px; }
    .ms-num { text-align: right; }
    .ms-cell-num { text-align: right; white-space: nowrap; }
    .ms-empty { color: #aaa; }
    .ms-muted { color: #666; }
    .ms-roommate { color: #111; font-weight: 500; }
    .ms-phone { font-variant-numeric: tabular-nums; }
    .ms-chip {
      display: inline-block;
      min-width: 16px;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-align: center;
      margin-right: 2px;
    }
    .ms-chip-on {
      background: #111;
      color: #fff;
    }
    .ms-chip-off {
      background: #f0f0f0;
      color: #aaa;
    }
    .ms-pill {
      display: inline-block;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 999px;
      border: 1px solid #ccc;
      margin: 1px 1px 0 0;
      background: #fff;
    }
    .ms-pill-ok {
      background: #e7f5ec;
      border-color: #2f9b5b;
      color: #15683a;
      font-weight: 600;
    }
    .ms-pill-warn {
      background: #fff8e1;
      border-color: #d4a017;
      color: #6b4f00;
      font-weight: 600;
    }
    .ms-pill-bad {
      background: #fdecea;
      border-color: #c0392b;
      color: #8a1f12;
      font-weight: 600;
    }
    .ms-legend {
      margin-top: 14px;
      padding: 8px 10px;
      background: #fafafa;
      border: 1px solid #eee;
      border-radius: 4px;
      font-size: 10px;
      color: #555;
      line-height: 1.8;
    }
    .ms-legend strong {
      color: #111;
      margin-right: 6px;
    }
    .ms-legend-item {
      display: inline-block;
      margin-right: 10px;
      font-variant-numeric: tabular-nums;
    }
    .ms-legend-hint { color: #888; font-style: italic; }
    .ms-foot {
      font-size: 10px;
      color: #777;
      text-align: right;
      padding-top: 10px;
      border-top: 1px solid #eee;
      margin-top: 14px;
    }
    .ms-empty-state {
      padding: 30px;
      text-align: center;
      color: #888;
      font-style: italic;
      border: 1px dashed #ddd;
      border-radius: 6px;
    }
    @page { size: A4 landscape; margin: 10mm; }
    @media print {
      body { background: #fff; padding: 0; }
      .ms-page { margin: 0; box-shadow: none; max-width: none; padding: 0; }
      .ms-noprint { display: none !important; }
      .ms-table tbody tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
    }
    .ms-noprint {
      position: fixed;
      bottom: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
    }
    .ms-noprint button {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 700;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      background: #f88000;
      color: #fff;
    }
  </style>
</head>
<body>
  <div class="ms-page">
    <div class="ms-band">
      <div>
        <div class="ms-band-sub">${escHtml(input.copy.title)}</div>
        <h1>${escHtml(projectName)}</h1>
        <div class="ms-band-venue">${escHtml(venue)}</div>
      </div>
      <div class="ms-band-right">
        ${escHtml(input.copy.generated)} ${escHtml(generated)}
        <span class="ms-band-count">${escHtml(input.copy.rosterCount(input.rows.length))}</span>
        ${(() => {
          let rooms = 0;
          let nights = 0;
          for (const r of input.rows) {
            const n = r.hotelDates?.length ?? 0;
            if (n > 0) {
              rooms += 1;
              nights += n;
            }
          }
          return rooms > 0
            ? `<div style="font-size:11px;color:#15683a;font-weight:600;margin-top:2px;">🏨 ${escHtml(input.copy.hotelSummary(rooms, nights))}</div>`
            : "";
        })()}
      </div>
    </div>
    ${
      input.rows.length === 0
        ? `<div class="ms-empty-state">${escHtml(input.copy.empty)}</div>`
        : `<table class="ms-table">
      <thead>
        <tr>
          <th>${escHtml(input.copy.table.name)}</th>
          <th>${escHtml(input.copy.table.role)}</th>
          <th>${escHtml(input.copy.table.status)}</th>
          <th>${escHtml(input.copy.table.days)}</th>
          <th>${escHtml(input.copy.table.hotel)}</th>
          <th>${escHtml(input.copy.table.food)}</th>
          <th>${escHtml(input.copy.table.phone)}</th>
          <th>${escHtml(input.copy.table.notes)}</th>${productionHeaders}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml(input)}
      </tbody>
    </table>
    ${legendHtml(input.projectDays, input.locale, input.copy)}`
    }
    <div class="ms-foot">${escHtml(input.copy.footer)}</div>
  </div>
  <div class="ms-noprint">
    <button onclick="window.print()">${escHtml(input.copy.print)}</button>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { ok: true };
}
