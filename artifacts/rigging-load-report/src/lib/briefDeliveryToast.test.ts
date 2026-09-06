import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { briefDeliveryToast } from "./briefDeliveryToast";

describe("Share brief delivery toast", () => {
  it("reports the exact successful API delivery count", () => {
    assert.deepEqual(
      briefDeliveryToast({ sent: 3, skipped: 4, alreadySent: 8 }),
      {
        kind: "success",
        messageKey: "crew.dispatch.deliverySuccessMany",
        params: { count: 3 },
      },
    );
  });

  it("uses singular wording for one successful delivery", () => {
    assert.deepEqual(briefDeliveryToast({ sent: 1 }), {
      kind: "success",
      messageKey: "crew.dispatch.deliverySuccessOne",
      params: { count: 1 },
    });
  });

  it("reports missing email profiles when every delivery is skipped", () => {
    assert.deepEqual(briefDeliveryToast({ sent: 0, skipped: 2 }), {
      kind: "error",
      messageKey: "crew.dispatch.deliverySkipped",
    });
  });

  it("reports an active dispatch when nothing is sent or skipped", () => {
    assert.deepEqual(
      briefDeliveryToast({ sent: 0, skipped: 0, alreadySent: 2 }),
      {
        kind: "error",
        messageKey: "crew.dispatch.deliveryInProgress",
      },
    );
  });
});