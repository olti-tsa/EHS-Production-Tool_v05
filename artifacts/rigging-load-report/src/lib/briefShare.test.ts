import assert from "node:assert/strict";
import test from "node:test";
import { encodeBrief, decodeBrief } from "./briefShare";
import { normalizeBrief } from "./projectBrief";

test("freelancer share links exclude client contacts without mutating producer data", async () => {
  const brief = normalizeBrief({
    briefId: "contact-test",
    version: 1,
    project: { projectName: "Test show", client: "Client Company", clientContact: "Private contact" },
    assignments: [],
  });
  assert.ok(brief);
  const shared = await decodeBrief(await encodeBrief(brief));
  assert.equal(shared.project.clientContact, undefined);
  assert.equal(shared.project.client, "Client Company");
  assert.equal(brief.project.clientContact, "Private contact");
});

test("legacy share links discard client contacts when opened", async () => {
  const encoded = "u." + Buffer.from(JSON.stringify({
    briefId: "legacy-contact-test",
    version: 1,
    project: { client: "Client Company", clientContact: "Private contact" },
    assignments: [],
  })).toString("base64url");
  assert.equal((await decodeBrief(encoded)).project.clientContact, undefined);
});