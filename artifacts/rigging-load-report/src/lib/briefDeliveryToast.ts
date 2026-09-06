export type BriefDeliveryCounts = {
  sent?: number;
  skipped?: number;
  alreadySent?: number;
};

export type BriefDeliveryToast = {
  kind: "success" | "error";
} & (
  | {
      messageKey:
        | "crew.dispatch.deliverySuccessOne"
        | "crew.dispatch.deliverySuccessMany";
      params: { count: number };
    }
  | {
      messageKey:
        | "crew.dispatch.deliverySkipped"
        | "crew.dispatch.deliveryInProgress";
      params?: never;
    }
);

export function briefDeliveryToast(
  delivery: BriefDeliveryCounts | null | undefined,
): BriefDeliveryToast {
  const sent = delivery?.sent ?? 0;
  const skipped = delivery?.skipped ?? 0;
  if (sent > 0) {
    return {
      kind: "success",
      messageKey:
        sent === 1
          ? "crew.dispatch.deliverySuccessOne"
          : "crew.dispatch.deliverySuccessMany",
      params: { count: sent },
    };
  }
  return {
    kind: "error",
    messageKey:
      skipped > 0
        ? "crew.dispatch.deliverySkipped"
        : "crew.dispatch.deliveryInProgress",
  };
}