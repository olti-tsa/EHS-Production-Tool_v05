import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canCancelBriefAssignment,
  removeCancelledAssignmentFromBriefData,
} from "./briefAssignmentCancellation";
import {
  markCrewAssignmentRemovedFromProjectData,
  normalizeProjectCrewData,
  removeCrewAssignmentFromBriefData,
  removeCrewFromBriefData,
  removeCrewFromProjectData,
} from "./projectCrewRemoval";

describe("pending brief assignment cancellation", () => {
  it("removes only the exact freelancer role slot", () => {
    const original = {
      project: { name: "Konsert" },
      recipientCrewId: "crew-a",
      assignments: [
        {
          crewId: "crew-a",
          freelancerUserId: "freelancer-1",
          role: "Lyd",
        },
        {
          crewId: "crew-b",
          freelancerUserId: "freelancer-1",
          role: "Lys",
        },
        {
          crewId: "crew-a",
          freelancerUserId: "freelancer-2",
          role: "Lyd",
        },
      ],
    };

    const result = removeCancelledAssignmentFromBriefData(
      original,
      "crew-a",
      "freelancer-1",
    );

    assert.equal(result.removed, true);
    assert.equal(result.data.recipientCrewId, null);
    assert.deepEqual(result.data.assignments, [
      {
        crewId: "crew-b",
        freelancerUserId: "freelancer-1",
        role: "Lys",
      },
      {
        crewId: "crew-a",
        freelancerUserId: "freelancer-2",
        role: "Lyd",
      },
    ]);
    assert.equal(original.assignments.length, 3);
  });

  it("permits only unanswered assignments without an accepted gig", () => {
    assert.equal(
      canCancelBriefAssignment({ decision: "pending", acceptedGigId: null }),
      true,
    );
    assert.equal(
      canCancelBriefAssignment({ decision: "accepted", acceptedGigId: "gig-1" }),
      false,
    );
    assert.equal(
      canCancelBriefAssignment({ decision: "declined", acceptedGigId: null }),
      false,
    );
  });

  it("removes an active role without deleting accepted assignment history", () => {
    const result = removeCrewFromBriefData(
      {
        assignments: [
          { crewId: "crew-a", freelancerUserId: "freelancer-1" },
          { crewId: "crew-b", freelancerUserId: "freelancer-2" },
        ],
        recipientCrewId: "crew-a",
      },
      "crew-a",
    );
    assert.equal(result.removed, true);
    assert.deepEqual(result.data.assignments, [
      { crewId: "crew-b", freelancerUserId: "freelancer-2" },
    ]);
    assert.equal(result.data.recipientCrewId, null);
  });

  it("persists removal tombstones so stale project autosaves cannot resurrect a role", () => {
    const removed = removeCrewFromProjectData(
      {
        crew: [
          { id: "crew-a", freelancerUserId: "freelancer-1" },
          { id: "crew-b", freelancerUserId: "freelancer-2" },
        ],
      },
      "crew-a",
    );
    assert.deepEqual(removed.crew, [
      { id: "crew-b", freelancerUserId: "freelancer-2" },
    ]);
    assert.deepEqual(removed.removedCrewIds, ["crew-a"]);

    const staleSave = normalizeProjectCrewData(
      {
        crew: [
          { id: "crew-a", freelancerUserId: "freelancer-1" },
          { id: "crew-b", freelancerUserId: "freelancer-2" },
        ],
      },
      removed,
    );
    assert.deepEqual(staleSave.crew, [
      { id: "crew-b", freelancerUserId: "freelancer-2" },
    ]);
    assert.deepEqual(staleSave.removedCrewIds, ["crew-a"]);
  });

  it("can remove a role without persisting a tombstone when the role stays available", () => {
    const result = removeCrewFromBriefData(
      {
        assignments: [{ crewId: "crew-a", freelancerUserId: "candidate-a" }],
      },
      "crew-a",
      { persistTombstone: false },
    );
    assert.deepEqual(result.data.assignments, []);
    assert.equal("removedCrewIds" in result.data, false);
  });

  it("tombstones one cancelled candidate while preserving a sibling candidate", () => {
    const result = removeCrewAssignmentFromBriefData(
      {
        assignments: [
          { crewId: "crew-a", freelancerUserId: "candidate-a" },
          { crewId: "crew-a", freelancerUserId: "candidate-b" },
        ],
      },
      "crew-a",
      "candidate-a",
    );
    assert.equal(result.removed, true);
    assert.deepEqual(result.data.assignments, [
      { crewId: "crew-a", freelancerUserId: "candidate-b" },
    ]);
    assert.deepEqual(result.data.removedCrewAssignments, [
      "crew-a\u0000candidate-a",
    ]);
  });

  it("clears a tombstoned project account without deleting its role slot", () => {
    const removed = markCrewAssignmentRemovedFromProjectData(
      {
        crew: [
          { id: "crew-a", freelancerUserId: "candidate-a" },
          { id: "crew-b", freelancerUserId: "candidate-b" },
        ],
      },
      "crew-a",
      "candidate-a",
    );
    const normalized = normalizeProjectCrewData(
      {
        crew: [
          { id: "crew-a", freelancerUserId: "candidate-a" },
          { id: "crew-b", freelancerUserId: "candidate-b" },
        ],
      },
      removed,
    );
    assert.deepEqual(normalized.crew, [
      { id: "crew-a", freelancerUserId: null },
      { id: "crew-b", freelancerUserId: "candidate-b" },
    ]);
  });
});
