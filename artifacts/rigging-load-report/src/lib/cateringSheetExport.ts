/**
 * Builds a print-friendly HTML sheet of the per-day catering aggregation
 * and opens it in a new tab with a "Print / Save as PDF" button. This is
 * the producer's one-click handoff to the venue chef — the chef gets a
 * single self-contained page they can print on the wall or save as PDF
 * and email back to the kitchen team.
 *
 * Same pattern as `callSheetExport.ts` / `clientPackExport.ts` so the
 * project keeps a single mental model for "export → print" flows: build
 * an escaped HTML string with embedded CSS (including @page A4 and
 * @media print rules), wrap it in a Blob, and open via a hidden anchor.
 * No PDF libraries — the browser's native Print dialog produces the PDF.
 */

type DietaryTag =
  | "vegetarian"
  | "vegan"
  | "halal"
  | "gluten-free"
  | "lactose-free";

// Stable category order on the sheet — chefs scan top-down for the
// usual suspects, so we lock the order here rather than relying on
// `Object.keys` iteration order from the server response.
const CATEGORY_ORDER: ReadonlyArray<DietaryTag> = [
  "vegetarian",
  "vegan",
  "halal",
  "gluten-free",
  "lactose-free",
];

export type CateringSheetInput = {
  brief: { id: string; projectName: string; venue: string };
  days: Array<{
    date: string;
    total: number;
    byCategory: Record<DietaryTag, number>;
    allergenRoster: Array<{
      userId: string;
      name: string;
      role: string;
      allergens: string[];
    }>;
  }>;
  profilelessCount: number;
  locale: "en" | "no";
  /** Resolved in the React caller so this pure exporter never calls hooks. */
  copy: CateringSheetCopy;
};

export type CateringSheetCopy = {
  categoryLabel: Record<DietaryTag, string>;
  days: string;
  totalMeals: string;
  noSpecialDietary: string;
  noAllergens: string;
  name: string;
  role: string;
  allergens: string;
  meals: string;
  cateringBrief: string;
  generated: string;
  profilelessNote: string;
  untitledProject: string;
  venueTba: string;
  print: string;
  footer: string;
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** UTC-stable date formatter — keeps `YYYY-MM-DD` server strings on
 *  the same calendar day they belong to regardless of the producer's
 *  browser timezone. Same logic as `CateringView.fmtDate` but expanded
 *  to a long form (chefs prefer "Monday 18 May" over "Mon 18"). */
function fmtDateLong(iso: string, locale: CateringSheetInput["locale"]): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtGeneratedNow(locale: CateringSheetInput["locale"]): string {
  return new Date().toLocaleString(locale === "no" ? "nb-NO" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Renders the run-wide summary band: total days, total meals, and
 *  per-category meal totals (sum of daily counts — what the kitchen
 *  actually plates over the run, not unique headcount). */
function summaryBlock(input: CateringSheetInput): string {
  const dayCount = input.days.length;
  let mealsTotal = 0;
  const catTotals: Record<DietaryTag, number> = {
    vegetarian: 0,
    vegan: 0,
    halal: 0,
    "gluten-free": 0,
    "lactose-free": 0,
  };
  for (const d of input.days) {
    mealsTotal += d.total;
    for (const k of CATEGORY_ORDER) {
      catTotals[k] += d.byCategory[k] ?? 0;
    }
  }
  const catCells = CATEGORY_ORDER.map((k) => {
    const count = catTotals[k];
    return `
      <div class="cs-meta-cell">
        <div class="cs-meta-key">${escHtml(input.copy.categoryLabel[k])}</div>
        <div class="cs-meta-val">${count}</div>
      </div>`;
  }).join("");
  return `
    <div class="cs-meta">
      <div class="cs-meta-cell">
        <div class="cs-meta-key">${escHtml(input.copy.days)}</div>
        <div class="cs-meta-val">${dayCount}</div>
      </div>
      <div class="cs-meta-cell">
        <div class="cs-meta-key">${escHtml(input.copy.totalMeals)}</div>
        <div class="cs-meta-val">${mealsTotal}</div>
      </div>
      ${catCells}
    </div>`;
}

/** One per-day section. `cs-day` has `page-break-inside: avoid` so a
 *  day's roster doesn't get split across pages where possible — chefs
 *  hate having to flip back and forth. Long days will still split
 *  naturally at row boundaries (CSS can't promise atomicity for
 *  arbitrarily tall blocks). */
function dayBlock(day: CateringSheetInput["days"][number], input: CateringSheetInput): string {
  const dietaryRow = CATEGORY_ORDER.filter((k) => (day.byCategory[k] ?? 0) > 0)
    .map(
      (k) =>
        `<span class="cs-pill">${escHtml(input.copy.categoryLabel[k])} · ${day.byCategory[k]}</span>`,
    )
    .join("");
  const dietaryHtml = dietaryRow
    ? `<div class="cs-pills">${dietaryRow}</div>`
    : `<div class="cs-empty-line">${escHtml(input.copy.noSpecialDietary)}</div>`;

  const rosterHtml =
    day.allergenRoster.length === 0
      ? `<div class="cs-empty-line">${escHtml(input.copy.noAllergens)}</div>`
      : `
        <table class="cs-table">
          <thead>
            <tr>
              <th style="width: 28%">${escHtml(input.copy.name)}</th>
              <th style="width: 22%">${escHtml(input.copy.role)}</th>
              <th>${escHtml(input.copy.allergens)}</th>
            </tr>
          </thead>
          <tbody>
            ${day.allergenRoster
              .map(
                (p) => `
              <tr>
                <td><strong>${escHtml(p.name)}</strong></td>
                <td>${escHtml(p.role || "—")}</td>
                <td>${escHtml(p.allergens.join(", "))}</td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>`;

  return `
    <section class="cs-day">
      <div class="cs-day-head">
        <h2>${escHtml(fmtDateLong(day.date, input.locale))}</h2>
        <div class="cs-day-meta">
          <span class="cs-day-iso">${escHtml(day.date)}</span>
          <span class="cs-day-total"><strong>${day.total}</strong> ${escHtml(input.copy.meals)}</span>
        </div>
      </div>
      ${dietaryHtml}
      <div class="cs-day-section-head">${escHtml(input.copy.allergens)}</div>
      ${rosterHtml}
    </section>`;
}

export function openCateringSheet(input: CateringSheetInput):
  | { ok: true }
  | { ok: false; reason: string } {
  if (!input.days || input.days.length === 0) {
    return { ok: false, reason: "no-days" };
  }
  const generated = fmtGeneratedNow(input.locale);
  const projectName = input.brief.projectName || input.copy.untitledProject;
  const venue = input.brief.venue || input.copy.venueTba;

  const profilelessNote =
    input.profilelessCount > 0
      ? `<div class="cs-note">
           ${escHtml(input.copy.profilelessNote)}
         </div>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="${input.locale === "no" ? "nb-NO" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${escHtml(`${input.copy.cateringBrief} — ${projectName} · ${venue}`)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        Oxygen, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
      color: #111;
      background: #f4f4f4;
      margin: 0;
      padding: 24px;
      font-size: 12px;
      line-height: 1.4;
    }
    .cs-page {
      background: #fff;
      max-width: 794px;
      margin: 0 auto;
      padding: 24px 28px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    }
    .cs-band {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #111;
      margin-bottom: 14px;
    }
    .cs-band-sub {
      font-size: 11px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #555;
      margin-bottom: 2px;
    }
    .cs-band h1 {
      font-size: 22px;
      margin: 0;
      line-height: 1.15;
    }
    .cs-band-venue {
      font-size: 13px;
      color: #333;
      margin-top: 2px;
    }
    .cs-band-right {
      font-size: 11px;
      color: #555;
      text-align: right;
      white-space: nowrap;
    }
    .cs-meta {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 1px;
      background: #ddd;
      border: 1px solid #ddd;
      margin-bottom: 16px;
    }
    .cs-meta-cell {
      background: #fff;
      padding: 8px 10px;
    }
    .cs-meta-key {
      font-size: 10px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #666;
    }
    .cs-meta-val {
      font-size: 16px;
      font-weight: 700;
      color: #111;
      margin-top: 2px;
    }
    .cs-day {
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 10px;
      page-break-inside: avoid;
    }
    .cs-day-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #eee;
    }
    .cs-day-head h2 {
      font-size: 14px;
      margin: 0;
    }
    .cs-day-meta {
      display: flex;
      gap: 12px;
      align-items: baseline;
      font-size: 11px;
      color: #555;
    }
    .cs-day-total strong {
      font-size: 14px;
      color: #111;
    }
    .cs-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 6px 0;
    }
    .cs-pill {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #999;
      color: #111;
      font-weight: 600;
      background: #fff;
    }
    .cs-day-section-head {
      font-size: 10px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #666;
      margin: 8px 0 4px 0;
      font-weight: 700;
    }
    .cs-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .cs-table th,
    .cs-table td {
      text-align: left;
      vertical-align: top;
      padding: 4px 6px;
      border-bottom: 1px solid #eee;
    }
    .cs-table th {
      font-size: 10px;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: #555;
      font-weight: 700;
      background: #fafafa;
    }
    .cs-empty-line {
      font-size: 11px;
      color: #777;
      font-style: italic;
      padding: 4px 0;
    }
    .cs-note {
      margin-top: 16px;
      padding: 8px 10px;
      border: 1px solid #d4a017;
      background: #fff8e1;
      font-size: 11px;
      color: #6b4f00;
      border-radius: 3px;
    }
    .cs-foot {
      font-size: 10px;
      color: #777;
      text-align: right;
      padding-top: 10px;
      border-top: 1px solid #eee;
      margin-top: 14px;
    }
    @page { size: A4; margin: 12mm; }
    @media print {
      body { background: #fff; padding: 0; }
      .cs-page { margin: 0; box-shadow: none; max-width: none; padding: 0; }
      .cs-noprint { display: none !important; }
    }
    .cs-noprint {
      position: fixed;
      bottom: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
    }
    .cs-noprint button {
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
  <div class="cs-page">
    <div class="cs-band">
      <div>
        <div class="cs-band-sub">${escHtml(input.copy.cateringBrief)}</div>
        <h1>${escHtml(projectName)}</h1>
        <div class="cs-band-venue">${escHtml(venue)}</div>
      </div>
      <div class="cs-band-right">${escHtml(input.copy.generated)} ${escHtml(generated)}</div>
    </div>
    ${summaryBlock(input)}
    ${input.days.map((day) => dayBlock(day, input)).join("")}
    ${profilelessNote}
    <div class="cs-foot">${escHtml(input.copy.footer)}</div>
  </div>
  <div class="cs-noprint">
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
  // Match callSheetExport's lifetime — the new tab needs the URL alive
  // long enough to fetch and render before we revoke it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { ok: true };
}
