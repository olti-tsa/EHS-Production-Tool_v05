import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deriveProjectCrewCounts,
  fullyAcceptedRole,
  plannedResponseSlots,
  rosterRoleSlotIds,
} from "./projectCrewCounts";

describe("server-derived project crew counts", () => {
  const projectData = {
    crew: [
      { id: "role-a", freelancerUserId: "person-1" },
      { id: "role-a", freelancerUserId: "person-1" },
      { id: "role-b", freelancerUserId: "person-1" },
    ],
  };
  const briefData = {
    assignments: [
      {
        crewId: "role-a",
        assignedDates: ["2030-01-01"],
        assignedShiftWindows: {
          "2030-01-01::show": [
            { startTime: "10:00", endTime: "12:00" },
            { startTime: "13:00", endTime: "15:00" },
          ],
        },
      },
      {
        crewId: "role-b",
        assignedShiftPhases: ["2030-01-01::show"],
      },
    ],
  };

  it("counts immutable role slots once, not people or candidate rows", () => {
    assert.deepEqual(rosterRoleSlotIds(projectData), ["role-a", "role-b"]);
    assert.deepEqual(
      deriveProjectCrewCounts(projectData, briefData, [
        {
          crewId: "role-a",
          freelancerUserId: "person-1",
          decision: "accepted",
          shiftResponses: {
            "2030-01-01::show::0": "accepted",
            "2030-01-01::show::1": "declined",
          },
        },
        {
          crewId: "role-a",
          freelancerUserId: "person-1",
          decision: "pending",
          shiftResponses: null,
        },
        {
          crewId: "role-b",
          freelancerUserId: "person-1",
          decision: "accepted",
          shiftResponses: null,
        },
        {
          crewId: "candidate-only",
          freelancerUserId: "candidate-1",
          decision: "accepted",
          shiftResponses: null,
        },
      ]),
      { crewCount: 2, confirmedCrewCount: 1 },
    );
  });

  it("does not let a retained replacement candidate confirm the current role", () => {
    assert.deepEqual(
      deriveProjectCrewCounts(projectData, briefData, [
        {
          crewId: "role-a",
          freelancerUserId: "former-person",
          decision: "accepted",
          shiftResponses: null,
        },
        {
          crewId: "role-a",
          freelancerUserId: "person-1",
          decision: "pending",
          shiftResponses: null,
        },
      ]),
      { crewCount: 2, confirmedCrewCount: 0 },
    );
  });

  it("requires every planned window to be accepted", () => {
    const slots = plannedResponseSlots(briefData, "role-a");
    assert.deepEqual(slots, [
      "2030-01-01::show::0",
      "2030-01-01::show::1",
    ]);
    assert.equal(
      fullyAcceptedRole(briefData, {
        crewId: "role-a",
        decision: "accepted",
        shiftResponses: {
          "2030-01-01::show::0": "accepted",
          "2030-01-01::show::1": "accepted",
        },
      }),
      true,
    );
    assert.equal(
      fullyAcceptedRole(briefData, {
        crewId: "role-a",
        decision: "accepted",
        shiftResponses: {
          "2030-01-01::show::0": "accepted",
        },
      }),
      false,
    );
  });
});
