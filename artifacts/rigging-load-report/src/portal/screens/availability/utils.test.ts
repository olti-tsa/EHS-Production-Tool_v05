import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CalendarEntry } from "./types";
import {
  buildDayAvailabilityReplacement,
  getIsoWeekNumber,
  overlapsLocalDay,
  replaceAvailabilityEntriesInRange,
  responseError,
} from "./utils";

describe("ISO week numbers", () => {
  const cases: [string, number][] = [
    ["2026-06-15", 25],
    ["2026-06-21", 25],
    ["2026-06-22", 26],
    ["2024-02-29", 9],
    ["2026-12-27", 52],
    ["2026-12-28", 53],
    ["2026-12-29", 53],
    ["2026-12-30", 53],
    ["2026-12-31", 53],
    ["2027-01-01", 53],
    ["2027-01-02", 53],
    ["2027-01-03", 53],
    ["2027-01-04", 1],
    ["2027-01-10", 1],
    ["2027-01-11", 2],
    ["2024-12-29", 52],
    ["2024-12-30", 1],
    ["2024-12-31", 1],
    ["2025-01-01", 1],
    ["2022-01-01", 52],
  ];

  for (const [isoDate, expectedWeek] of cases) {
    it(`${isoDate} is ISO week ${expectedWeek}`, () => {
      const [year, month, day] = isoDate.split("-").map(Number);
      // Match the calendar's local-date construction, not UTC string parsing.
      const date = new Date(year, month - 1, day);
      assert.equal(getIsoWeekNumber(date), expectedWeek);
    });
  }

  it("uses the local calendar day regardless of time and leaves the input unchanged", () => {
    for (const hour of [0, 12, 23]) {
      const date = new Date(2027, 0, 3, hour, 59, 59);
      const originalTime = date.getTime();
      assert.equal(getIsoWeekNumber(date), 53);
      assert.equal(date.getTime(), originalTime);
    }
  });
});

describe("availability state range replacement", () => {
  it("preserves the rest of an available month when one day becomes busy", () => {
    const month: CalendarEntry = {
      id: "month-available",
      status: "available",
      startAt: "2026-09-01T00:00:00.000Z",
      endAt: "2026-10-01T00:00:00.000Z",
      allDay: true,
    };
    const busyDay: CalendarEntry = {
      id: "day-busy",
      status: "unavailable",
      startAt: "2026-09-15T00:00:00.000Z",
      endAt: "2026-09-16T00:00:00.000Z",
      allDay: true,
    };

    const result = replaceAvailabilityEntriesInRange(
      [month],
      busyDay.startAt,
      busyDay.endAt,
      [busyDay],
    );

    assert.deepEqual(
      result.map(({ status, startAt, endAt }) => ({
        status,
        startAt,
        endAt,
      })),
      [
        {
          status: "available",
          startAt: "2026-09-01T00:00:00.000Z",
          endAt: "2026-09-15T00:00:00.000Z",
        },
        {
          status: "unavailable",
          startAt: "2026-09-15T00:00:00.000Z",
          endAt: "2026-09-16T00:00:00.000Z",
        },
        {
          status: "available",
          startAt: "2026-09-16T00:00:00.000Z",
          endAt: "2026-10-01T00:00:00.000Z",
        },
      ],
    );
    assert.equal(month.endAt, "2026-10-01T00:00:00.000Z");
  });

  it("clears only the selected day without emptying surrounding availability", () => {
    const result = replaceAvailabilityEntriesInRange(
      [
        {
          id: "month-available",
          status: "available",
          startAt: "2026-09-01T00:00:00.000Z",
          endAt: "2026-10-01T00:00:00.000Z",
          allDay: true,
        },
      ],
      "2026-09-15T00:00:00.000Z",
      "2026-09-16T00:00:00.000Z",
      [],
    );

    assert.equal(result.length, 2);
    assert.ok(result.every((entry) => entry.status === "available"));
  });

  it("keeps available prefix and suffix around a mid-month busy range", () => {
    const busyRange: CalendarEntry = {
      id: "busy-15-through-17",
      status: "unavailable",
      startAt: "2026-09-15T00:00:00.000Z",
      endAt: "2026-09-18T00:00:00.000Z",
      allDay: true,
    };
    const result = replaceAvailabilityEntriesInRange(
      [
        {
          id: "september-available",
          status: "available",
          startAt: "2026-09-01T00:00:00.000Z",
          endAt: "2026-10-01T00:00:00.000Z",
          allDay: true,
        },
      ],
      busyRange.startAt,
      busyRange.endAt,
      [busyRange],
    );

    assert.deepEqual(
      result.map(({ status, startAt, endAt }) => [
        status,
        startAt,
        endAt,
      ]),
      [
        [
          "available",
          "2026-09-01T00:00:00.000Z",
          "2026-09-15T00:00:00.000Z",
        ],
        [
          "unavailable",
          "2026-09-15T00:00:00.000Z",
          "2026-09-18T00:00:00.000Z",
        ],
        [
          "available",
          "2026-09-18T00:00:00.000Z",
          "2026-10-01T00:00:00.000Z",
        ],
      ],
    );

    const statusForDay = (day: string) =>
      result.find((entry) =>
        overlapsLocalDay(entry.startAt, entry.endAt, day),
      )?.status;
    assert.equal(statusForDay("2026-09-14"), "available");
    assert.equal(statusForDay("2026-09-15"), "unavailable");
    assert.equal(statusForDay("2026-09-17"), "unavailable");
    assert.equal(statusForDay("2026-09-18"), "available");
    assert.equal(statusForDay("2026-09-30"), "available");
  });

  it("keeps the rest of a day available around a four-hour busy window", () => {
    const result = buildDayAvailabilityReplacement(
      [
        {
          id: "full-day-available",
          status: "available",
          startAt: "2026-09-15T00:00:00.000Z",
          endAt: "2026-09-16T00:00:00.000Z",
          allDay: true,
        },
      ],
      "2026-09-15T00:00:00.000Z",
      "2026-09-16T00:00:00.000Z",
      {
        id: "morning-busy",
        status: "unavailable",
        startAt: "2026-09-15T08:00:00.000Z",
        endAt: "2026-09-15T12:00:00.000Z",
        allDay: false,
      },
    );

    assert.deepEqual(
      result.map(({ status, startAt, endAt, allDay }) => ({
        status,
        startAt,
        endAt,
        allDay,
      })),
      [
        {
          status: "available",
          startAt: "2026-09-15T00:00:00.000Z",
          endAt: "2026-09-15T08:00:00.000Z",
          allDay: false,
        },
        {
          status: "unavailable",
          startAt: "2026-09-15T08:00:00.000Z",
          endAt: "2026-09-15T12:00:00.000Z",
          allDay: false,
        },
        {
          status: "available",
          startAt: "2026-09-15T12:00:00.000Z",
          endAt: "2026-09-16T00:00:00.000Z",
          allDay: false,
        },
      ],
    );

    const withoutExistingAvailability = buildDayAvailabilityReplacement(
      [],
      "2026-09-15T00:00:00.000Z",
      "2026-09-16T00:00:00.000Z",
      {
        id: "morning-busy",
        status: "unavailable",
        startAt: "2026-09-15T08:00:00.000Z",
        endAt: "2026-09-15T12:00:00.000Z",
        allDay: false,
      },
    );
    assert.deepEqual(
      withoutExistingAvailability.map((entry) => entry.status),
      ["available", "unavailable", "available"],
    );
  });
});

describe("availability response errors", () => {
  it("uses the caller-translated fallback when the response has no error", async () => {
    const response = new Response(JSON.stringify({}), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(await responseError(response, "Kunne ikke lagre."), "Kunne ikke lagre.");
  });

  it("preserves an explicit server error", async () => {
    const response = new Response(JSON.stringify({ error: "Conflict" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(await responseError(response, "Fallback"), "Conflict");
  });
});