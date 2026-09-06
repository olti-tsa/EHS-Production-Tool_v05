import type { CalendarEntry } from "./types";

export function isoDateOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localDateTime(day: string, time: string): Date | null {
  const dateMatch = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  
  const y = Number(dateMatch[1]);
  const m = Number(dateMatch[2]) - 1;
  const d = Number(dateMatch[3]);
  const h = Number(timeMatch[1]);
  const min = Number(timeMatch[2]);
  
  const value = new Date(y, m, d, h, min);
  if (Number.isNaN(value.getTime())) return null;
  
  // Reject spring-forward non-existent times
  if (value.getFullYear() !== y || value.getMonth() !== m || value.getDate() !== d || value.getHours() !== h || value.getMinutes() !== min) {
    if (h === 0 && min === 0) {
      // Keep all-day midnight working: if midnight is skipped by DST, accept the shifted time (e.g., 01:00)
    } else {
      return null;
    }
  }
  
  // Detect ambiguous fall-back local times
  const tBefore = new Date(value.getTime() - 3600000);
  const tAfter = new Date(value.getTime() + 3600000);
  const offsetDiff = tBefore.getTimezoneOffset() - tAfter.getTimezoneOffset();
  
  if (offsetDiff !== 0 && !(h === 0 && min === 0)) {
    const shiftMs = Math.abs(offsetDiff) * 60000;
    const test1 = new Date(value.getTime() - shiftMs);
    const test2 = new Date(value.getTime() + shiftMs);
    if (
      (test1.getFullYear() === y && test1.getMonth() === m && test1.getDate() === d && test1.getHours() === h && test1.getMinutes() === min) ||
      (test2.getFullYear() === y && test2.getMonth() === m && test2.getDate() === d && test2.getHours() === h && test2.getMinutes() === min)
    ) {
      return null;
    }
  }
  
  return value;
}

export function overlapsLocalDay(
  startsAt: string,
  endsAt: string,
  day: string,
): boolean {
  const dayStart = localDateTime(day, "00:00");
  if (!dayStart) return false;
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const starts = new Date(startsAt);
  const ends = new Date(endsAt);
  return starts < dayEnd && ends > dayStart;
}

function isLocalMidnight(value: string): boolean {
  const date = new Date(value);
  return (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  );
}

export function entryCoversLocalDay(
  entry: Pick<CalendarEntry, "startAt" | "endAt">,
  day: string,
): boolean {
  const dayStart = localDateTime(day, "00:00");
  if (!dayStart) return false;
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return (
    new Date(entry.startAt) <= dayStart && new Date(entry.endAt) >= dayEnd
  );
}

/** Immutably replace one half-open range while preserving every portion of
 * existing availability outside it. Used for optimistic portal state so a
 * day or multi-day override cannot discard a month-wide entry. */
export function replaceAvailabilityEntriesInRange(
  entries: readonly CalendarEntry[],
  rangeStart: string,
  rangeEnd: string,
  replacements: readonly CalendarEntry[],
): CalendarEntry[] {
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  const preserved = entries.flatMap((entry) => {
    const entryStart = new Date(entry.startAt);
    const entryEnd = new Date(entry.endAt);
    if (entryStart >= end || entryEnd <= start) return [{ ...entry }];

    const fragments: CalendarEntry[] = [];
    if (entryStart < start) {
      fragments.push({
        ...entry,
        id: `${entry.id}:before:${rangeStart}`,
        endAt: rangeStart,
        allDay: entry.allDay && isLocalMidnight(rangeStart),
      });
    }
    if (entryEnd > end) {
      fragments.push({
        ...entry,
        id: `${entry.id}:after:${rangeEnd}`,
        startAt: rangeEnd,
        allDay: entry.allDay && isLocalMidnight(rangeEnd),
      });
    }
    return fragments;
  });

  return [...preserved, ...replacements.map((entry) => ({ ...entry }))].sort(
    (left, right) =>
      new Date(left.startAt).getTime() - new Date(right.startAt).getTime(),
  );
}

/** Project all availability for one local day, then overlay a full-day or
 * hourly replacement. The returned entries are non-overlapping and can be
 * sent as one authoritative bulk replacement for that day. */
export function buildDayAvailabilityReplacement(
  entries: readonly CalendarEntry[],
  dayStart: string,
  dayEnd: string,
  replacement: CalendarEntry,
  removeEntryId?: string,
): CalendarEntry[] {
  const start = new Date(dayStart);
  const end = new Date(dayEnd);
  const dayEntries = entries.flatMap((entry) => {
    if (entry.id === removeEntryId) return [];
    const entryStart = new Date(entry.startAt);
    const entryEnd = new Date(entry.endAt);
    if (entryStart >= end || entryEnd <= start) return [];
    const clippedStart =
      entryStart < start ? dayStart : entry.startAt;
    const clippedEnd = entryEnd > end ? dayEnd : entry.endAt;
    return [
      {
        ...entry,
        id: `${entry.id}:day:${dayStart}`,
        startAt: clippedStart,
        endAt: clippedEnd,
        allDay:
          entry.allDay &&
          clippedStart === dayStart &&
          clippedEnd === dayEnd,
      },
    ];
  }).sort((left, right) => {
    if (left.virtual !== right.virtual) return left.virtual ? -1 : 1;
    return (
      new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
    );
  });

  let normalized: CalendarEntry[] =
    replacement.status === "unavailable" && !replacement.allDay
      ? [
          {
            id: `available-remainder:${dayStart}`,
            status: "available",
            startAt: dayStart,
            endAt: dayEnd,
            allDay: true,
          },
        ]
      : [];
  for (const entry of dayEntries) {
    normalized = replaceAvailabilityEntriesInRange(
      normalized,
      entry.startAt,
      entry.endAt,
      [entry],
    );
  }

  return replaceAvailabilityEntriesInRange(
    normalized,
    replacement.startAt,
    replacement.endAt,
    [replacement],
  );
}

export function localTimeOnly(value: string): string {
  const instant = new Date(value);
  return `${String(instant.getHours()).padStart(2, "0")}:${String(
    instant.getMinutes(),
  ).padStart(2, "0")}`;
}

export async function responseError(
  res: Response,
  translatedFallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error || translatedFallback;
  } catch {
    return translatedFallback;
  }
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

export function buildMonthCells(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startWeekday = (first.getDay() + 6) % 7; // Mon=0
  const cells: { iso: string | null; day: number | null; date?: Date }[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ iso: null, day: null });
  const days = daysInMonth(year, month);
  for (let d = 1; d <= days; d++) {
    const dt = new Date(year, month, d);
    cells.push({ iso: isoDateOnly(dt), day: d, date: dt });
  }
  while (cells.length % 7 !== 0) cells.push({ iso: null, day: null });
  return cells;
}

export function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
