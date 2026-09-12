import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readBriefRecipients,
  selectBriefDispatchRecipients,
} from "./briefRecipients";

describe("brief recipient reconciliation and delivery targets", () => {
  it("merges the full brief only for reconciliation", () => {
    const data = {
      assignments: [
        { crewId: "role-a", freelancerUserId: "old-person" },
        { crewId: "role-b", freelancerUserId: "existing-person" },
      ],
    };
    assert.deepEqual(
      readBriefRecipients(data, [
        { crewId: "role-a", freelancerUserId: "new-person" },
      ]),
      [
        { crewId: "role-a", freelancerUserId: "new-person" },
        { crewId: "role-a", freelancerUserId: "old-person" },
        { crewId: "role-b", freelancerUserId: "existing-person" },
      ],
    );
  });

  it("isolates an explicit delivery target from the saved roster", () => {
    assert.deepEqual(
      readBriefRecipients({}, [
        { crewId: "role-a", freelancerUserId: "replacement-person" },
      ]),
      [{ crewId: "role-a", freelancerUserId: "replacement-person" }],
    );
  });

  it("targets only newly inserted role keys during lifecycle saves", () => {
    assert.deepEqual(
      selectBriefDispatchRecipients({
        newlyAdded: [
          { crewId: "new-role", freelancerUserId: "new-person" },
        ],
        explicit: null,
        action: "send_request",
      }),
      [{ crewId: "new-role", freelancerUserId: "new-person" }],
    );
  });

  it("does not send_request to accepted selections but allows failed retries", () => {
    assert.deepEqual(
      selectBriefDispatchRecipients({
        newlyAdded: [],
        explicit: [
          { crewId: "accepted-role", freelancerUserId: "accepted-person" },
          { crewId: "retry-role", freelancerUserId: "retry-person" },
        ],
        action: "send_request",
        acceptedKeys: new Set(["accepted-person\u0000accepted-role"]),
      }),
      [{ crewId: "retry-role", freelancerUserId: "retry-person" }],
    );
  });

  it("keeps explicit share_brief resend semantics", () => {
    assert.deepEqual(
      selectBriefDispatchRecipients({
        newlyAdded: [],
        explicit: [
          { crewId: "accepted-role", freelancerUserId: "accepted-person" },
        ],
        action: "share_brief",
        acceptedKeys: new Set(["accepted-person\u0000accepted-role"]),
      }),
      [{ crewId: "accepted-role", freelancerUserId: "accepted-person" }],
    );
  });
});
