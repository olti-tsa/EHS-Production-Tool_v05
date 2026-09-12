export type BriefRecipient = {
  crewId: string;
  freelancerUserId: string;
};

export type BriefDispatchAction = "send_request" | "share_brief";

/** Merge all current brief assignments for reconciliation. Callers that are
 * deliberately sending one explicit request should pass an empty data object
 * and the target top-level recipient list instead. */
export function readBriefRecipients(
  data: Record<string, unknown>,
  topLevelRecipients: unknown,
): BriefRecipient[] {
  const seen = new Map<string, BriefRecipient>();
  const push = (rawCrew: unknown, rawUid: unknown): void => {
    const crewId = typeof rawCrew === "string" ? rawCrew : "";
    const freelancerUserId = typeof rawUid === "string" ? rawUid : "";
    if (!freelancerUserId) return;
    const key = `${freelancerUserId}\u0000${crewId}`;
    if (!seen.has(key)) seen.set(key, { freelancerUserId, crewId });
  };
  if (Array.isArray(topLevelRecipients)) {
    for (const value of topLevelRecipients) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      push(row.crewId, row.freelancerUserId);
    }
  }
  const assignments = data.assignments;
  if (Array.isArray(assignments)) {
    for (const value of assignments) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const row = value as Record<string, unknown>;
      push(row.crewId, row.freelancerUserId);
    }
  }
  return [...seen.values()];
}

/**
 * Assignment reconciliation and notification selection are deliberately
 * separate. Lifecycle saves use only newly inserted/reactivated role keys;
 * explicit actions use only their selected recipients. The outbox itself is
 * user-scoped (one email can describe multiple roles), so collapse duplicate
 * user ids after role-level filtering.
 */
export function selectBriefDispatchRecipients(args: {
  newlyAdded: BriefRecipient[];
  explicit: BriefRecipient[] | null;
  action: BriefDispatchAction;
  acceptedKeys?: ReadonlySet<string>;
}): BriefRecipient[] {
  const candidates = args.explicit ?? args.newlyAdded;
  const acceptedKeys = args.acceptedKeys ?? new Set<string>();
  const selected =
    args.action === "send_request"
      ? candidates.filter(
          (recipient) =>
            !acceptedKeys.has(
              `${recipient.freelancerUserId}\u0000${recipient.crewId}`,
            ),
        )
      : candidates;
  const seen = new Set<string>();
  return selected.filter((recipient) => {
    if (seen.has(recipient.freelancerUserId)) return false;
    seen.add(recipient.freelancerUserId);
    return true;
  });
}
