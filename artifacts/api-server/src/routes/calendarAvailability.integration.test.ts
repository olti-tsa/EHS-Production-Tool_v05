import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { db, pool, calendarAvailabilityTable } from "@workspace/db";

const prefix = `availability-test-${process.pid}-${Date.now()}`;
const owners = [ `${prefix}-month`, `${prefix}-week`, `${prefix}-split`, `${prefix}-other` ];
let server: Server | undefined;
let baseUrl: string;

before(async () => {
  // Exercise the real router and database without contacting Clerk.
  mock.module("../middleware/userType", {
    namedExports: { getUserType: async () => "freelancer" },
  });
  const { default: router } = await import("./portalCalendar");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { auth: () => { userId: string | null } }).auth =
      () => ({ userId: req.header("x-test-user") ?? null });
    next();
  });
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server!.once("listening", resolve);
    server!.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}/api/portal/calendar`;
});

after(async () => {
  try {
    for (const owner of owners) {
      await db.delete(calendarAvailabilityTable).where(eq(calendarAvailabilityTable.userId, owner));
    }
  } finally {
    if (server) await new Promise<void>((resolve, reject) =>
      server!.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});

async function replace(owner: string, rangeStart: string, rangeEnd: string, status: string) {
  const response = await fetch(`${baseUrl}/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": owner },
    body: JSON.stringify({
      rangeStart, rangeEnd,
      entries: [{ startsAt: rangeStart, endsAt: rangeEnd, status, timezone: "UTC", allDay: true }],
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.availability.length, 1);
}

async function stored(owner: string) {
  return db.select().from(calendarAvailabilityTable)
    .where(eq(calendarAvailabilityTable.userId, owner))
    .orderBy(calendarAvailabilityTable.startsAt);
}

for (const [index, label, start, end] of [
  [0, "month", "2030-06-01T00:00:00.000Z", "2030-07-01T00:00:00.000Z"],
  [1, "week", "2030-06-10T00:00:00.000Z", "2030-06-17T00:00:00.000Z"],
] as const) {
  test(`${label}: Available then Busy replaces rather than layers manual state`, async () => {
    const owner = owners[index];
    await replace(owner, start, end, "available");
    assert.equal((await stored(owner))[0].status, "available");
    await replace(owner, start, end, "unavailable");
    // Repeating a selection must not accumulate duplicate rows either.
    await replace(owner, start, end, "unavailable");
    const rows = await stored(owner);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "unavailable");
    assert.equal(rows[0].startsAt.toISOString(), start);
    assert.equal(rows[0].endsAt.toISOString(), end);

    // Verify the read API, not just the write response or stored rows.
    const query = new URLSearchParams({
      from: start.slice(0, 10), to: end.slice(0, 10), timezone: "UTC",
    });
    const response = await fetch(`${baseUrl}?${query}`, { headers: { "x-test-user": owner } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.availability.length, 1);
    assert.equal(body.availability[0].status, "unavailable");
  });
}

test("replacement splits a spanning interval, preserves both tails and leaves other owners unchanged", async () => {
  const owner = owners[2];
  const other = owners[3];
  const start = "2030-06-10T00:00:00.000Z";
  const end = "2030-06-17T00:00:00.000Z";
  const outerStart = "2030-06-01T00:00:00.000Z";
  const outerEnd = "2030-07-01T00:00:00.000Z";
  await db.insert(calendarAvailabilityTable).values([owner, other].map((userId) => ({
    id: `${userId}-spanning`, userId, status: "available",
    startsAt: new Date(outerStart), endsAt: new Date(outerEnd),
    timezone: "Europe/Oslo", allDay: true, privateNote: "Preserve outside range",
  })));
  const otherBefore = await stored(other);
  await replace(owner, start, end, "unavailable");
  const rows = await stored(owner);
  assert.deepEqual(rows.map((row) => [
    row.status, row.startsAt.toISOString(), row.endsAt.toISOString(),
  ]), [
    ["available", outerStart, start],
    ["unavailable", start, end],
    ["available", end, outerEnd],
  ]);
  for (const fragment of [rows[0], rows[2]]) {
    assert.equal(fragment.userId, owner);
    assert.equal(fragment.timezone, "Europe/Oslo");
    assert.equal(fragment.allDay, true);
    assert.equal(fragment.privateNote, "Preserve outside range");
  }
  assert.deepEqual(await stored(other), otherBefore);
});