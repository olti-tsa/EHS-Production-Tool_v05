import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import express from "express";
import type { Server } from "node:http";

const clientFetch = globalThis.fetch;
const prefix = `security-test-${process.pid}-${Date.now()}`;
const employee = `${prefix}-employee`;
const otherProducer = `${prefix}-other-producer`;
const freelancer = `${prefix}-freelancer`;
const profileIds = {
  full: `${prefix}-full`,
  partial: `${prefix}-partial`,
  unknown: `${prefix}-unknown`,
  unavailable: `${prefix}-unavailable`,
  tentative: `${prefix}-tentative`,
};
const allProfileIds = [freelancer, ...Object.values(profileIds)];
const briefId = `${prefix}-brief`;

let server: Server;
let baseUrl = "";
let dbModule: typeof import("@workspace/db");
let sql: typeof import("drizzle-orm").sql;
let tokenHash: typeof import("../lib/calendarCrypto").tokenHash;
let seal: typeof import("../lib/calendarCrypto").seal;

async function request(
  path: string,
  userId: string,
  init: RequestInit = {},
): Promise<Response> {
  return clientFetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user": userId,
      ...init.headers,
    },
  });
}

async function cleanup(): Promise<void> {
  const likePrefix = `${prefix}%`;
  await dbModule.db.execute(sql`
    DELETE FROM calendar_sync_jobs
     WHERE connection_id IN (
       SELECT id FROM calendar_connections WHERE user_id LIKE ${likePrefix}
     )
  `);
  await dbModule.db.execute(
    sql`DELETE FROM calendar_connections WHERE user_id LIKE ${likePrefix}`,
  );
  await dbModule.db.execute(
    sql`DELETE FROM calendar_oauth_states WHERE user_id LIKE ${likePrefix}`,
  );
  await dbModule.db.execute(sql`
    DELETE FROM calendar_holds
     WHERE owner_user_id LIKE ${likePrefix}
        OR freelancer_user_id LIKE ${likePrefix}
  `);
  await dbModule.db.execute(
    sql`DELETE FROM calendar_availability WHERE user_id LIKE ${likePrefix}`,
  );
  await dbModule.db.execute(
    sql`DELETE FROM freelancer_profiles WHERE user_id LIKE ${likePrefix}`,
  );
  await dbModule.db.execute(
    sql`DELETE FROM project_briefs WHERE id = ${briefId}`,
  );
}

before(async () => {
  // Route authorization is exercised with deterministic user types rather
  // than creating Clerk accounts or depending on an external identity API.
  mock.module("../middleware/userType", {
    namedExports: {
      getUserType: async (userId: string) =>
        userId === freelancer ? "freelancer" : "employee",
      tagAsFreelancer: async () => undefined,
      requireEmployee: async (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        const userId = req.auth?.()?.userId ?? null;
        if (!userId) {
          res.status(401).json({ ok: false, error: "Sign in required." });
          return;
        }
        if (userId === freelancer) {
          res.status(403).json({
            ok: false,
            error: "This area is restricted to EHS employees.",
            userType: "freelancer",
          });
          return;
        }
        (req as typeof req & { _userId: string })._userId = userId;
        next();
      },
    },
  });
  process.env.GOOGLE_CLIENT_ID = "calendar-security-test-client";
  process.env.GOOGLE_CLIENT_SECRET = "calendar-security-test-secret";
  process.env.GOOGLE_REDIRECT_URI =
    "https://example.test/api/portal/calendar/connections/google/callback";

  dbModule = await import("@workspace/db");
  ({ sql } = await import("drizzle-orm"));
  ({ tokenHash, seal } = await import("../lib/calendarCrypto"));
  const [{ default: calendarRouter }, { default: profileRouter }] =
    await Promise.all([import("./portalCalendar"), import("./portalProfile")]);

  await cleanup();
  await dbModule.db.insert(dbModule.freelancerProfilesTable).values(
    allProfileIds.map((userId) => ({
      userId,
      fullName: userId.slice(prefix.length + 1),
    })),
  );
  await dbModule.db.insert(dbModule.projectBriefsTable).values({
    id: briefId,
    ownerUserId: employee,
    projectName: "Security test brief",
    startDate: "2030-06-10",
    endDate: "2030-06-11",
    data: {},
  });
  await dbModule.db.insert(dbModule.calendarAvailabilityTable).values([
    {
      id: `${prefix}-availability-full`,
      userId: profileIds.full,
      status: "available",
      startsAt: new Date("2030-06-10T00:00:00Z"),
      endsAt: new Date("2030-06-12T00:00:00Z"),
    },
    {
      id: `${prefix}-availability-partial`,
      userId: profileIds.partial,
      status: "available",
      startsAt: new Date("2030-06-10T12:00:00Z"),
      endsAt: new Date("2030-06-11T12:00:00Z"),
    },
    {
      id: `${prefix}-availability-unavailable`,
      userId: profileIds.unavailable,
      status: "unavailable",
      startsAt: new Date("2030-06-10T00:00:00Z"),
      endsAt: new Date("2030-06-12T00:00:00Z"),
    },
    {
      id: `${prefix}-availability-tentative`,
      userId: profileIds.tentative,
      status: "tentative",
      startsAt: new Date("2030-06-10T00:00:00Z"),
      endsAt: new Date("2030-06-12T00:00:00Z"),
    },
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    (req as typeof req & { auth: () => { userId: string | null } }).auth = () => ({
      userId: userId ?? null,
    });
    next();
  });
  app.use("/api", profileRouter, calendarRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await cleanup();
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await dbModule.pool.end();
});

test("OAuth state cannot be linked by another user or replayed", async () => {
  const state = `${prefix}-oauth-state`;
  await dbModule.db.insert(dbModule.calendarOAuthStatesTable).values({
    stateHash: tokenHash(state),
    userId: employee,
    provider: "google",
    encryptedVerifier: seal("test-pkce-verifier"),
    expiresAt: new Date(Date.now() + 60_000),
  });

  const mismatch = await request(
    `/api/portal/calendar/connections/google/callback?state=${encodeURIComponent(state)}&code=test-code`,
    otherProducer,
  );
  assert.equal(mismatch.status, 400);

  const ownerAfterMismatch = await request(
    `/api/portal/calendar/connections/google/callback?state=${encodeURIComponent(state)}&code=test-code`,
    employee,
  );
  assert.equal(ownerAfterMismatch.status, 400, "mismatch must consume the state");

  const replayState = `${prefix}-replay-state`;
  await dbModule.db.insert(dbModule.calendarOAuthStatesTable).values({
    stateHash: tokenHash(replayState),
    userId: employee,
    provider: "google",
    encryptedVerifier: seal("test-pkce-verifier"),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  try {
    const first = await request(
      `/api/portal/calendar/connections/google/callback?state=${encodeURIComponent(replayState)}&code=test-code`,
      employee,
      { redirect: "manual" },
    );
    assert.equal(first.status, 303);

    const replay = await request(
      `/api/portal/calendar/connections/google/callback?state=${encodeURIComponent(replayState)}&code=test-code`,
      employee,
    );
    assert.equal(replay.status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("freelancer directory is employee-only", async () => {
  const denied = await request("/api/portal/freelancers", freelancer);
  assert.equal(denied.status, 403);

  const allowed = await request("/api/portal/freelancers", employee);
  assert.equal(allowed.status, 200);
});

test("free and free-unknown directory filters return the correct rows", async () => {
  const query =
    "startDate=2030-06-10&endDate=2030-06-11&timezone=UTC";
  const all = await request(`/api/portal/freelancers?${query}`, employee);
  const allBody = (await all.json()) as {
    freelancers: Array<{ userId: string; availabilityStatus: string }>;
  };
  const classifications = allBody.freelancers.filter((row) =>
    row.userId.startsWith(prefix),
  );
  const free = await request(
    `/api/portal/freelancers?${query}&availability=free`,
    employee,
  );
  assert.equal(free.status, 200);
  const freeBody = (await free.json()) as {
    freelancers: Array<{ userId: string }>;
  };
  assert.deepEqual(
    freeBody.freelancers
      .map((row) => row.userId)
      .filter((id) => id.startsWith(prefix)),
    [profileIds.full],
    JSON.stringify(classifications),
  );

  const freeUnknown = await request(
    `/api/portal/freelancers?${query}&availability=free-unknown`,
    employee,
  );
  assert.equal(freeUnknown.status, 200);
  const freeUnknownBody = (await freeUnknown.json()) as {
    freelancers: Array<{ userId: string }>;
  };
  assert.deepEqual(
    freeUnknownBody.freelancers
      .map((row) => row.userId)
      .filter((id) => id.startsWith(prefix))
      .sort(),
    [freelancer, profileIds.full, profileIds.partial, profileIds.unknown].sort(),
  );
});

test("holds enforce employee, brief ownership, date window and expiry limits", async () => {
  const valid = {
    freelancerUserId: freelancer,
    briefId,
    startsAt: "2030-06-10T00:00:00.000Z",
    endsAt: "2030-06-12T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    timezone: "UTC",
  };

  const freelancerAttempt = await request("/api/portal/calendar/holds", freelancer, {
    method: "POST",
    body: JSON.stringify(valid),
  });
  assert.equal(freelancerAttempt.status, 403);

  const foreignBrief = await request(
    "/api/portal/calendar/holds",
    otherProducer,
    { method: "POST", body: JSON.stringify(valid) },
  );
  assert.equal(foreignBrief.status, 403);

  for (const body of [
    { ...valid, startsAt: "2030-06-09T00:00:00.000Z" },
    {
      ...valid,
      expiresAt: new Date(Date.now() + 49 * 60 * 60_000).toISOString(),
    },
    { ...valid, expiresAt: "2030-06-10T01:00:00.000Z" },
  ]) {
    const response = await request("/api/portal/calendar/holds", employee, {
      method: "POST",
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }

  const created = await request("/api/portal/calendar/holds", employee, {
    method: "POST",
    body: JSON.stringify(valid),
  });
  assert.equal(created.status, 200);
  const createdBody = (await created.json()) as { hold: { id: string } };

  const foreignRelease = await request(
    `/api/portal/calendar/holds/${createdBody.hold.id}`,
    otherProducer,
    { method: "DELETE" },
  );
  assert.equal(foreignRelease.status, 404);

  const ownerRelease = await request(
    `/api/portal/calendar/holds/${createdBody.hold.id}`,
    employee,
    { method: "DELETE" },
  );
  assert.equal(ownerRelease.status, 200);
});