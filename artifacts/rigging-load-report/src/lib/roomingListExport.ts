/**
 * Builds a print-friendly HTML rooming list and opens it in a new tab
 * with a "Print / Save as PDF" button. This is the producer's one-click
 * handoff to the hotel front desk — the hotel gets a single self-
 * contained page they can use to pre-assign rooms and check guests in.
 *
 * Same pattern as `cateringSheetExport.ts` / `callSheetExport.ts`: build
 * an escaped HTML string with embedded CSS (including `@page A4` and
 * `@media print` rules), wrap it in a Blob, and open via a hidden
 * anchor. No PDF libraries — the browser's native Print dialog produces
 * the PDF.
 *
 * Sheet structure:
 *  1. Header band: project + venue + generated timestamp.
 *  2. Summary band: total rooms, twin/single split, total room-nights,
 *     date range covered.
 *  3. Per-room cards (sorted by check-in date then room number):
 *      occupants, room type, check-in / check-out, contact phone if any,
 *      a "Locked" hint when the producer pinned the pairing.
 *  4. Footer with brief id for cross-reference if the hotel emails the
 *     producer back about room changes.
 */
import type { Locale } from "./i18n/types";

type RoomShare = "twin" | "single" | "either";

export type RoomingListGuest = {
  freelancerUserId: string;
  name: string;
  role: string;
  checkInDate: string | null;
  checkOutDate: string | null;
  roomShare: RoomShare;
  phone: string;
};

export type RoomingListInput = {
  brief: { id: string; projectName: string; venue: string };
  /** Already grouped by roomKey. The export is presentational only —
   *  the caller (HotelView) computes the grouping from the same crew
   *  array it shows on screen so the printed sheet matches the UI. */
  rooms: Array<{
    roomKey: string;
    locked: boolean;
    guests: RoomingListGuest[];
  }>;
  /** Producer-facing note for crew without an assigned room (typically
   *  hotelRequired=false members). Surfaced below the room list as a
   *  small "not staying at the hotel" footnote so the front desk knows
   *  who isn't on the manifest. */
  noHotelGuests: Array<{ name: string; role: string }>;
  locale: Locale;
  copy: RoomingListCopy;
};

export type RoomingListCopy = {
  untitledProject: string; venueTba: string; documentTitle: (project: string, venue: string) => string;
  rooms: string; twin: string; single: string; roomNights: string; dateRange: string;
  room: (number: number) => string; twinRoom: string; singleRoom: string; singleSoloRoom: string;
  locked: string; night: (count: number) => string; guest: string; role: string; phone: string;
  checkIn: string; checkOut: string; notStaying: string; notStayingDetail: string;
  title: string; generated: (date: string) => string; footer: (briefId: string) => string; print: string;
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** UTC-stable date formatter — matches the catering sheet so producers
 *  see consistent date formatting across all printable handoffs. */
function fmtDateLong(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-US", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtDateShort(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale === "no" ? "nb-NO" : "en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

function fmtGeneratedNow(locale: Locale): string {
  return new Date().toLocaleString(locale === "no" ? "nb-NO" : "en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Inclusive nights count between two ISO dates. Returns 0 if either
 *  is null or the range is non-positive. Matches hotel convention:
 *  check-in 18 May, check-out 20 May = 2 nights (the 18th and 19th). */
function nights(checkIn: string | null, checkOut: string | null): number {
  if (!checkIn || !checkOut) return 0;
  const ci = new Date(`${checkIn}T00:00:00Z`).getTime();
  const co = new Date(`${checkOut}T00:00:00Z`).getTime();
  if (Number.isNaN(ci) || Number.isNaN(co)) return 0;
  const diff = Math.round((co - ci) / (24 * 60 * 60 * 1000));
  return diff > 0 ? diff : 0;
}

/** "Room type" is inferred from occupancy + the strongest preference of
 *  any occupant — a single-pref person gets a "Single" room even when
 *  alone; a 2-occupant room is "Twin". This matches how Norwegian
 *  hotels actually code rooms (DBL/TWN/SGL) and saves the front desk
 *  having to think. */
function roomType(guests: RoomingListGuest[], copy: RoomingListCopy): string {
  if (guests.length >= 2) return copy.twinRoom;
  const g = guests[0];
  if (g && g.roomShare === "single") return copy.singleRoom;
  return copy.singleSoloRoom;
}

/** Earliest check-in across occupants — used both to sort the room
 *  list and to print the room's effective check-in date. We use the
 *  earliest because the room is reserved from that date even if a
 *  later guest joins partway. The hotel is unlikely to give a single
 *  room to two different guests on different dates. */
function earliestIso(guests: RoomingListGuest[]): string | null {
  const dates = guests
    .map((g) => g.checkInDate)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  return dates[0] ?? null;
}

/** Latest check-out across occupants — same logic as earliestIso but
 *  for the room's effective release date. */
function latestIso(guests: RoomingListGuest[]): string | null {
  const dates = guests
    .map((g) => g.checkOutDate)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort();
  return dates[dates.length - 1] ?? null;
}

function summaryBlock(input: RoomingListInput): string {
  const { copy, locale } = input;
  const totalRooms = input.rooms.length;
  let twinRooms = 0;
  let singleRooms = 0;
  let totalRoomNights = 0;
  let earliestCheckIn: string | null = null;
  let latestCheckOut: string | null = null;
  for (const r of input.rooms) {
    if (r.guests.length >= 2) twinRooms += 1;
    else singleRooms += 1;
    const ci = earliestIso(r.guests);
    const co = latestIso(r.guests);
    totalRoomNights += nights(ci, co);
    if (ci && (!earliestCheckIn || ci < earliestCheckIn)) earliestCheckIn = ci;
    if (co && (!latestCheckOut || co > latestCheckOut)) latestCheckOut = co;
  }
  const dateRange =
    earliestCheckIn && latestCheckOut
      ? `${fmtDateShort(earliestCheckIn, locale)} → ${fmtDateShort(latestCheckOut, locale)}`
      : "—";
  return `
    <div class="rl-meta">
      <div class="rl-meta-cell">
        <div class="rl-meta-key">${escHtml(copy.rooms)}</div>
        <div class="rl-meta-val">${totalRooms}</div>
      </div>
      <div class="rl-meta-cell">
        <div class="rl-meta-key">${escHtml(copy.twin)}</div>
        <div class="rl-meta-val">${twinRooms}</div>
      </div>
      <div class="rl-meta-cell">
        <div class="rl-meta-key">${escHtml(copy.single)}</div>
        <div class="rl-meta-val">${singleRooms}</div>
      </div>
      <div class="rl-meta-cell">
        <div class="rl-meta-key">${escHtml(copy.roomNights)}</div>
        <div class="rl-meta-val">${totalRoomNights}</div>
      </div>
      <div class="rl-meta-cell rl-meta-cell-wide">
        <div class="rl-meta-key">${escHtml(copy.dateRange)}</div>
        <div class="rl-meta-val rl-meta-val-text">${escHtml(dateRange)}</div>
      </div>
    </div>`;
}

function roomBlock(
  room: RoomingListInput["rooms"][number],
  index: number,
  locale: Locale,
  copy: RoomingListCopy,
): string {
  const ci = earliestIso(room.guests);
  const co = latestIso(room.guests);
  const n = nights(ci, co);
  const guestRows = room.guests
    .map(
      (g) => `
        <tr>
          <td><strong>${escHtml(g.name)}</strong></td>
          <td>${escHtml(g.role || "—")}</td>
          <td>${escHtml(g.phone || "—")}</td>
          <td>${escHtml(fmtDateShort(g.checkInDate, locale))}</td>
          <td>${escHtml(fmtDateShort(g.checkOutDate, locale))}</td>
        </tr>`,
    )
    .join("");
  // Room number is a 1-based index for the front desk to write their
  // actual hotel room number alongside. We deliberately don't expose
  // the internal roomKey hash — it's noise to the hotel.
  return `
    <section class="rl-room">
      <div class="rl-room-head">
        <div class="rl-room-head-left">
          <h2>${escHtml(copy.room(index + 1))}</h2>
          <span class="rl-room-type">${escHtml(roomType(room.guests, copy))}</span>
          ${room.locked ? `<span class="rl-room-locked">${escHtml(copy.locked)}</span>` : ""}
        </div>
        <div class="rl-room-head-right">
          <span class="rl-room-dates">
            ${escHtml(fmtDateShort(ci, locale))} → ${escHtml(fmtDateShort(co, locale))}
          </span>
          <span class="rl-room-nights">
            ${escHtml(copy.night(n))}
          </span>
        </div>
      </div>
      <table class="rl-table">
        <thead>
          <tr>
            <th style="width: 28%">${escHtml(copy.guest)}</th>
            <th style="width: 22%">${escHtml(copy.role)}</th>
            <th style="width: 18%">${escHtml(copy.phone)}</th>
            <th style="width: 16%">${escHtml(copy.checkIn)}</th>
            <th style="width: 16%">${escHtml(copy.checkOut)}</th>
          </tr>
        </thead>
        <tbody>${guestRows}</tbody>
      </table>
    </section>`;
}

export function openRoomingList(
  input: RoomingListInput,
):
  | { ok: true }
  | { ok: false; reason: string } {
  if (!input.rooms || input.rooms.length === 0) {
    return { ok: false, reason: "no-rooms" };
  }
  // Sort rooms by earliest check-in, then by roomKey for stable order
  // when two rooms start the same day. The front desk reads the sheet
  // top-down on the day of the first arrivals.
  const sortedRooms = [...input.rooms].sort((a, b) => {
    const ai = earliestIso(a.guests) ?? "9999-99-99";
    const bi = earliestIso(b.guests) ?? "9999-99-99";
    if (ai !== bi) return ai < bi ? -1 : 1;
    return a.roomKey < b.roomKey ? -1 : a.roomKey > b.roomKey ? 1 : 0;
  });
  const { copy, locale } = input;
  const generated = fmtGeneratedNow(locale);
  const projectName = input.brief.projectName || copy.untitledProject;
  const venue = input.brief.venue || copy.venueTba;

  const noHotelNote =
    input.noHotelGuests.length > 0
      ? `<div class="rl-note">
            <strong>${escHtml(copy.notStaying)}</strong> — ${escHtml(copy.notStayingDetail)}
           ${input.noHotelGuests
             .map(
               (g) =>
                 `<span class="rl-pill">${escHtml(g.name)}${
                   g.role ? ` · ${escHtml(g.role)}` : ""
                 }</span>`,
             )
             .join(" ")}
         </div>`
      : "";

  const html = `<!DOCTYPE html>
<html lang="${locale === "no" ? "nb" : "en"}">
<head>
  <meta charset="utf-8" />
  <title>${escHtml(copy.documentTitle(projectName, venue))}</title>
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
    .rl-page {
      background: #fff;
      max-width: 794px;
      margin: 0 auto;
      padding: 24px 28px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    }
    .rl-band {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 12px;
      border-bottom: 2px solid #111;
      margin-bottom: 14px;
    }
    .rl-band-sub {
      font-size: 11px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #555;
      margin-bottom: 2px;
    }
    .rl-band h1 {
      font-size: 22px;
      margin: 0;
      line-height: 1.15;
    }
    .rl-band-venue {
      font-size: 13px;
      color: #333;
      margin-top: 2px;
    }
    .rl-band-right {
      font-size: 11px;
      color: #555;
      text-align: right;
      white-space: nowrap;
    }
    .rl-meta {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1px;
      background: #ddd;
      border: 1px solid #ddd;
      margin-bottom: 16px;
    }
    .rl-meta-cell {
      background: #fff;
      padding: 8px 10px;
    }
    .rl-meta-cell-wide {
      grid-column: span 2;
    }
    .rl-meta-key {
      font-size: 10px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #666;
    }
    .rl-meta-val {
      font-size: 16px;
      font-weight: 700;
      color: #111;
      margin-top: 2px;
    }
    .rl-meta-val-text {
      font-size: 13px;
      font-weight: 600;
    }
    .rl-room {
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 10px 12px;
      margin-bottom: 10px;
      page-break-inside: avoid;
    }
    .rl-room-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #eee;
    }
    .rl-room-head-left {
      display: flex;
      gap: 10px;
      align-items: baseline;
    }
    .rl-room-head-left h2 {
      font-size: 14px;
      margin: 0;
    }
    .rl-room-type {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #999;
      color: #111;
      font-weight: 600;
      background: #fff;
    }
    .rl-room-locked {
      font-size: 10px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #6b4f00;
      background: #fff8e1;
      border: 1px solid #d4a017;
      padding: 1px 6px;
      border-radius: 3px;
      font-weight: 700;
    }
    .rl-room-head-right {
      display: flex;
      gap: 12px;
      align-items: baseline;
      font-size: 11px;
      color: #555;
    }
    .rl-room-dates {
      font-weight: 600;
      color: #111;
    }
    .rl-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .rl-table th,
    .rl-table td {
      text-align: left;
      vertical-align: top;
      padding: 4px 6px;
      border-bottom: 1px solid #eee;
    }
    .rl-table th {
      font-size: 10px;
      letter-spacing: 0.4px;
      text-transform: uppercase;
      color: #555;
      font-weight: 700;
      background: #fafafa;
    }
    .rl-note {
      margin-top: 16px;
      padding: 8px 10px;
      border: 1px solid #d4a017;
      background: #fff8e1;
      font-size: 11px;
      color: #6b4f00;
      border-radius: 3px;
      line-height: 1.6;
    }
    .rl-note strong {
      display: block;
      margin-bottom: 4px;
    }
    .rl-pill {
      display: inline-block;
      font-size: 11px;
      padding: 1px 8px;
      border-radius: 999px;
      border: 1px solid #d4a017;
      color: #6b4f00;
      background: #fff;
      margin: 2px 2px 0 0;
    }
    .rl-foot {
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
      .rl-page { margin: 0; box-shadow: none; max-width: none; padding: 0; }
      .rl-noprint { display: none !important; }
    }
    .rl-noprint {
      position: fixed;
      bottom: 16px;
      right: 16px;
      display: flex;
      gap: 8px;
    }
    .rl-noprint button {
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
  <div class="rl-page">
    <div class="rl-band">
      <div>
        <div class="rl-band-sub">${escHtml(copy.title)}</div>
        <h1>${escHtml(projectName)}</h1>
        <div class="rl-band-venue">${escHtml(venue)}</div>
      </div>
      <div class="rl-band-right">${escHtml(copy.generated(generated))}</div>
    </div>
    ${summaryBlock({ ...input, rooms: sortedRooms })}
    ${sortedRooms.map((r, i) => roomBlock(r, i, locale, copy)).join("")}
    ${noHotelNote}
    <div class="rl-foot">${escHtml(copy.footer(input.brief.id))}</div>
  </div>
  <div class="rl-noprint">
    <button onclick="window.print()">${escHtml(copy.print)}</button>
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
  // Match cateringSheetExport's lifetime — the new tab needs the URL
  // alive long enough to fetch and render before we revoke it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { ok: true };
}
