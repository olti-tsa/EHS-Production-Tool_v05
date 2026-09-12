import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBriefRecipients } from "./briefRecipients";

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
});
