/** Unit tests for the producer roster merge. Run with:
 *
 *    node --experimental-strip-types --test \
 *      artifacts/rigging-load-report/src/lib/crewRoster.test.ts
 *
 *  Excluded from tsconfig via the **\/*.test.ts pattern. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeRoster,
  buildDayChips,
  type RosterResponse,
  type RosterGig,
} from "./crewRoster.ts";
import {
  CREW_REQUEST_STATUS_META,
  type CrewMember,
} from "./crew.ts";

function makeLocal(overrides: Partial<CrewMember>): CrewMember {
  return {
    id: overrides.id ?? "crew-local-1",
    name: overrides.name ?? "Local Crew",
    role: overrides.role ?? "Rigging",
    callTime: overrides.callTime ?? "08:00",
    offTime: overrides.offTime ?? "18:00",
    dayRate: overrides.dayRate ?? 0,
    notes: overrides.notes ?? "",
    freelancerUserId: overrides.freelancerUserId,
    requestStatus: overrides.requestStatus,
    briefAssignmentId: overrides.briefAssignmentId,
  };
}

function makeGig(overrides: Partial<RosterGig> & { gigId: string }): RosterGig {
  return {
    gigId: overrides.gigId,
    briefAssignmentId: overrides.briefAssignmentId,
    crewId: overrides.crewId,
    freelancerUserId: overrides.freelancerUserId ?? `user-${overrides.gigId}`,
    name: overrides.name ?? "Anders Andersen",
    role: overrides.role ?? "Rigging",
    status: overrides.status ?? "confirmed",
    assignedDates: overrides.assignedDates ?? [],
    callTime: overrides.callTime ?? "",
    offTime: overrides.offTime ?? "",
    assignedShiftPhases: overrides.assignedShiftPhases ?? [],
    assignedShiftTimes: overrides.assignedShiftTimes ?? {},
    hotelRequired: overrides.hotelRequired ?? false,
    hotelDates: overrides.hotelDates ?? [],
    dietaryTags: overrides.dietaryTags ?? [],
    allergens: overrides.allergens ?? [],
    profileless: overrides.profileless ?? false,
    phone: overrides.phone ?? "",
    roomKey: overrides.roomKey ?? null,
    roommateName: overrides.roommateName ?? null,
  };
}

function makeResponse(
  crew: RosterGig[],
  projectDays: string[] = [],
): RosterResponse {
  return {
    ok: true,
    brief: {
      id: "brief-1",
      projectName: "Test brief",
      venue: "Stage 4",
      startDate: projectDays[0] ?? null,
      endDate: projectDays[projectDays.length - 1] ?? null,
    },
    crew,
    projectDays,
    categories: ["vegetarian", "vegan", "halal", "gluten-free", "lactose-free"],
  };
}

test("mergeRoster returns empty list when both sources are empty", () => {
  assert.deepEqual(mergeRoster([], null), []);
  assert.deepEqual(mergeRoster([], makeResponse([])), []);
});

test("mergeRoster surfaces a pending request from local crew when no gig exists yet", () => {
  const local = [
    makeLocal({
      id: "c1",
      name: "Bea Berg",
      freelancerUserId: "user-bea",
      requestStatus: "requested",
    }),
  ];
  const out = mergeRoster(local, makeResponse([]));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.source, "local");
  assert.equal(out[0]?.status, "requested");
  assert.equal(out[0]?.gigId, null);
  assert.equal(out[0]?.freelancerUserId, "user-bea");
});

test("mergeRoster prefers gig data and folds local row's dayRate/notes in", () => {
  const local = [
    makeLocal({
      id: "c1",
      name: "Bea Berg",
      freelancerUserId: "user-bea",
      requestStatus: "accepted",
      dayRate: 5500,
      notes: "Bring harness",
    }),
  ];
  const gigs = [
    makeGig({
      gigId: "g-1",
      freelancerUserId: "user-bea",
      name: "Bea Berg",
      status: "confirmed",
      assignedDates: ["2026-05-10", "2026-05-11"],
      hotelRequired: true,
      dietaryTags: ["vegan"],
      allergens: ["nuts"],
    }),
  ];
  const out = mergeRoster(local, makeResponse(gigs));
  assert.equal(out.length, 1, "local row was folded into gig row, not duplicated");
  const row = out[0]!;
  assert.equal(row.source, "gig");
  assert.equal(row.gigId, "g-1");
  assert.equal(row.status, "confirmed");
  assert.deepEqual(row.assignedDates, ["2026-05-10", "2026-05-11"]);
  assert.equal(row.hotelRequired, true);
  assert.deepEqual(row.dietaryTags, ["vegan"]);
  assert.deepEqual(row.allergens, ["nuts"]);
  assert.equal(row.dayRate, 5500, "local dayRate carried through");
  assert.equal(row.notes, "Bring harness", "local notes carried through");
});

test("mergeRoster uses producer's typed role over the gig's seeded role", () => {
  const local = [
    makeLocal({
      id: "c1",
      name: "Bea Berg",
      freelancerUserId: "user-bea",
      role: "Stage Hand",
    }),
  ];
  const gigs = [
    makeGig({
      gigId: "g-1",
      freelancerUserId: "user-bea",
      name: "Bea Berg",
      role: "Stage",
    }),
  ];
  const out = mergeRoster(local, makeResponse(gigs));
  assert.equal(out[0]?.role, "Stage Hand");
});

test("mergeRoster name-fallback matches a legacy local row that has no freelancerUserId", () => {
  const local = [
    makeLocal({
      id: "c1",
      name: "  Bea   Berg ", // sloppy whitespace + casing
      // no freelancerUserId — pre-portal era row
      dayRate: 4200,
    }),
  ];
  const gigs = [
    makeGig({
      gigId: "g-1",
      freelancerUserId: "user-bea",
      name: "BEA BERG",
    }),
  ];
  const out = mergeRoster(local, makeResponse(gigs));
  assert.equal(out.length, 1, "name match folded the legacy row in");
  assert.equal(out[0]?.dayRate, 4200);
});

test("mergeRoster keeps a manual in-house row separate from gig rows", () => {
  const local = [
    makeLocal({
      id: "c-manual",
      name: "Site PM",
      role: "Project Manager",
      // No freelancerUserId, no requestStatus → pure manual.
    }),
  ];
  const gigs = [makeGig({ gigId: "g-1", name: "Anders Andersen" })];
  const out = mergeRoster(local, makeResponse(gigs));
  assert.equal(out.length, 2);
  const manual = out.find((r) => r.id === "c-manual");
  assert.ok(manual, "manual row preserved");
  assert.equal(manual?.source, "local");
  assert.equal(manual?.status, "manual");
});

test("mergeRoster sorts gig rows first, then pending, then manual; alphabetical inside", () => {
  const local = [
    makeLocal({ id: "m-1", name: "Zed Manual" }),
    makeLocal({
      id: "m-2",
      name: "Anna Pending",
      freelancerUserId: "user-anna",
      requestStatus: "requested",
    }),
  ];
  const gigs = [
    makeGig({ gigId: "g-2", name: "Bjørn Booked", freelancerUserId: "user-b" }),
    makeGig({ gigId: "g-1", name: "Astrid Booked", freelancerUserId: "user-a" }),
  ];
  const out = mergeRoster(local, makeResponse(gigs));
  assert.deepEqual(
    out.map((r) => r.name),
    ["Astrid Booked", "Bjørn Booked", "Anna Pending", "Zed Manual"],
  );
});

test("mergeRoster surfaces a gig that has no matching local row", () => {
  // Producer never went through the sidebar (e.g. brief was imported).
  const out = mergeRoster([], makeResponse([makeGig({ gigId: "g-1" })]));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.source, "gig");
  assert.equal(out[0]?.dayRate, 0);
  assert.equal(out[0]?.notes, "");
});

test("mergeRoster keeps a too_late local row visible (no gig will ever exist)", () => {
  const local = [
    makeLocal({
      id: "c1",
      name: "Erik Too-Late",
      freelancerUserId: "user-erik",
      requestStatus: "too_late",
    }),
  ];
  const out = mergeRoster(local, makeResponse([]));
  assert.equal(out.length, 1);
  assert.equal(out[0]?.status, "too_late");
});

test("mergeRoster carries through profileless flag from gig", () => {
  const gigs = [
    makeGig({
      gigId: "g-1",
      profileless: true,
      dietaryTags: [],
      allergens: [],
    }),
  ];
  const out = mergeRoster([], makeResponse(gigs));
  assert.equal(out[0]?.profileless, true);
});

test("buildDayChips returns the full project window with on/off flags when projectDays given", () => {
  const chips = buildDayChips(
    ["2026-05-11"],
    ["2026-05-10", "2026-05-11", "2026-05-12"],
  );
  assert.equal(chips.length, 3);
  assert.equal(chips[0]?.on, false);
  assert.equal(chips[1]?.on, true);
  assert.equal(chips[2]?.on, false);
});

test("buildDayChips uses Norwegian two-letter weekdays in UTC", () => {
  // 2026-05-11 is a Monday → "ma".
  const chips = buildDayChips(["2026-05-11"], ["2026-05-11"]);
  assert.equal(chips[0]?.label, "ma");
});

test("buildDayChips falls back to assigned-only when no project window", () => {
  const chips = buildDayChips(["2026-05-12", "2026-05-10"], null);
  assert.deepEqual(
    chips.map((c) => c.date),
    ["2026-05-10", "2026-05-12"],
  );
  assert.ok(chips.every((c) => c.on));
});

test("mergeRoster preserves two role gigs for the same freelancer", () => {
  // Each gig is an independently bookable role slot with its own
  // schedule, hotel state and lifecycle status.
  const out = mergeRoster(
    [],
    makeResponse([
      makeGig({
        gigId: "g1",
        freelancerUserId: "user-multi",
        name: "Multi Person",
        role: "Stagehand",
        status: "confirmed",
        assignedDates: ["2026-05-10", "2026-05-11"],
        hotelRequired: false,
      }),
      makeGig({
        gigId: "g2",
        freelancerUserId: "user-multi",
        name: "Multi Person",
        role: "Lighting tech",
        status: "paid",
        assignedDates: ["2026-05-11", "2026-05-12"],
        hotelRequired: true,
      }),
    ]),
  );
  assert.equal(out.length, 2);
  const stagehand = out.find((row) => row.role === "Stagehand");
  const lighting = out.find((row) => row.role === "Lighting tech");
  assert.deepEqual(stagehand?.assignedDates, ["2026-05-10", "2026-05-11"]);
  assert.equal(stagehand?.hotelRequired, false);
  assert.equal(stagehand?.status, "confirmed");
  assert.deepEqual(lighting?.assignedDates, ["2026-05-11", "2026-05-12"]);
  assert.equal(lighting?.hotelRequired, true);
  assert.equal(lighting?.status, "paid");
});

test("mergeRoster preserves exact role-slot and account identity for removal", () => {
  const out = mergeRoster(
    [],
    makeResponse([
      makeGig({
        gigId: "gig-a",
        briefAssignmentId: "assignment-a",
        crewId: "crew-a",
        freelancerUserId: "user-shared",
        name: "Shared Account",
      }),
      makeGig({
        gigId: "gig-b",
        briefAssignmentId: "assignment-b",
        crewId: "crew-b",
        freelancerUserId: "user-shared",
        name: "Shared Account",
      }),
    ]),
  );
  assert.equal(out.length, 2);
  const first = out.find((row) => row.crewId === "crew-a");
  const second = out.find((row) => row.crewId === "crew-b");
  assert.equal(first?.briefAssignmentId, "assignment-a");
  assert.equal(first?.freelancerUserId, "user-shared");
  assert.equal(second?.briefAssignmentId, "assignment-b");
  assert.equal(second?.freelancerUserId, "user-shared");
});

test("request status metadata keeps producer status tones explicit", () => {
  assert.equal(CREW_REQUEST_STATUS_META.accepted.tone, "ok");
  assert.equal(CREW_REQUEST_STATUS_META.requested.tone, "warn");
  assert.equal(CREW_REQUEST_STATUS_META.declined.tone, "bad");
});

test("mergeRoster keeps two gigs separate when freelancerUserIds differ", () => {
  // Sanity check that the dedupe key is freelancerUserId, not
  // something looser like name.
  const out = mergeRoster(
    [],
    makeResponse([
      makeGig({
        gigId: "g1",
        freelancerUserId: "user-a",
        name: "Same Name",
      }),
      makeGig({
        gigId: "g2",
        freelancerUserId: "user-b",
        name: "Same Name",
      }),
    ]),
  );
  assert.equal(out.length, 2);
});

test("mergeRoster keeps profile state independent across role gigs", () => {
  const out = mergeRoster(
    [],
    makeResponse([
      makeGig({
        gigId: "g1",
        freelancerUserId: "user-x",
        profileless: false,
      }),
      makeGig({
        gigId: "g2",
        freelancerUserId: "user-x",
        profileless: true,
      }),
    ]),
  );
  assert.equal(out.length, 2);
  assert.equal(out.find((row) => row.gigId === "g1")?.profileless, false);
  assert.equal(out.find((row) => row.gigId === "g2")?.profileless, true);
});

test("mergeRoster passes phone, roomKey and roommateName through to the gig row", () => {
  const gig = makeGig({
    gigId: "g1",
    name: "Cara Carlsen",
    phone: "+47 900 12 345",
    roomKey: "room-1",
    roommateName: "Dag Dahl",
  });
  const out = mergeRoster([], makeResponse([gig]));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.phone, "+47 900 12 345");
  assert.equal(out[0]!.roomKey, "room-1");
  assert.equal(out[0]!.roommateName, "Dag Dahl");
});

test("mergeRoster gives local-only rows empty phone + null room fields", () => {
  // The master sheet renders these as a muted dash; the test pins
  // the sentinel values so the UI doesn't accidentally show
  // "undefined" or "null" if the merge ever drifts.
  const local = [
    makeLocal({ id: "c1", name: "Eva Eriksen" }),
  ];
  const out = mergeRoster(local, null);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.phone, "");
  assert.equal(out[0]!.roomKey, null);
  assert.equal(out[0]!.roommateName, null);
});
