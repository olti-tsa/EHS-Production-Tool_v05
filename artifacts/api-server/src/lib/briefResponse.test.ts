import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeclineReason } from "./briefResponse";

describe("decline reason contract", () => {
  it("trims a valid optional reason and preserves explicit null", () => {
    assert.deepEqual(parseDeclineReason("  Not available  "), {
      ok: true,
      value: "Not available",
    });
    assert.deepEqual(parseDeclineReason("   "), { ok: true, value: null });
    assert.deepEqual(parseDeclineReason(null), { ok: true, value: null });
    assert.deepEqual(parseDeclineReason(undefined), {
      ok: true,
      value: undefined,
    });
  });

  it("rejects non-strings and reasons longer than 1000 characters", () => {
    assert.deepEqual(parseDeclineReason(42), { ok: false });
    assert.deepEqual(parseDeclineReason("x".repeat(1001)), { ok: false });
  });
});
