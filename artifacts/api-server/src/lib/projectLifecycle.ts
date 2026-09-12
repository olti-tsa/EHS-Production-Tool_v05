import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  briefAssignmentsTable,
  briefDispatchesTable,
  db,
  freelancerProfilesTable,
} from "@workspace/db";
import type { ProjectAccessRole } from "./projectAccess";

export const PROJECT_STATUSES = [
  "draft",
  "planning",
  "active",
  "completed",
  "archived",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, ProjectStatus | null>> = {
  draft: "planning",
  planning: "active",
  active: "completed",
  completed: "archived",
  archived: null,
};

export type TransitionDecision = "idempotent" | "forward" | "backward" | "skipped";

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" &&
    (PROJECT_STATUSES as readonly string[]).includes(value);
}

export function deriveLegacyProjectStatus(project: {
  status?: string | null;
  venue?: string | null;
  client?: string | null;
  data?: unknown;
}): ProjectStatus {
  if (isProjectStatus(project.status)) return project.status;
  const data = project.data && typeof project.data === "object" && !Array.isArray(project.data)
    ? project.data as Record<string, unknown>
    : {};
  if (typeof data.activeBriefId === "string" && data.activeBriefId.trim()) return "active";
  if (project.venue?.trim() || project.client?.trim()) return "planning";
  return "draft";
}

export function classifyProjectTransition(
  from: ProjectStatus,
  to: ProjectStatus,
): TransitionDecision {
  if (from === to) return "idempotent";
  const fromIndex = PROJECT_STATUSES.indexOf(from);
  const toIndex = PROJECT_STATUSES.indexOf(to);
  if (toIndex < fromIndex) return "backward";
  return toIndex === fromIndex + 1 ? "forward" : "skipped";
}

export function canTransitionProject(role: ProjectAccessRole | null): boolean {
  return role === "owner" || role === "editor";
}

export function isActivationTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return from === "planning" && to === "active";
}

export function isTerminalProjectStatus(status: ProjectStatus): boolean {
  return status === "completed" || status === "archived";
}

/** Existing brief provenance is immutable. Omitting project_id preserves it;
 * supplying a different project id is rejected rather than reassigned. */
export function effectiveBriefProjectId(
  storedProjectId: string | null | undefined,
  suppliedProjectId: string | null | undefined,
): string | null | "conflict" {
  if (storedProjectId && suppliedProjectId && storedProjectId !== suppliedProjectId) {
    return "conflict";
  }
  return suppliedProjectId ?? storedProjectId ?? null;
}

export function isDispatchClaimable(
  state: "pending" | "dispatching" | "sent" | "failed",
  retryFailed = false,
): boolean {
  return state === "pending" ||
    (retryFailed && state === "failed");
}

export type BriefRecipient = { crewId: string; freelancerUserId: string };

export function recipientsFromBriefData(data: unknown): BriefRecipient[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const assignments = (data as Record<string, unknown>).assignments;
  if (!Array.isArray(assignments)) return [];
  const recipients = new Map<string, BriefRecipient>();
  for (const value of assignments) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (
      typeof row.freelancerUserId !== "string" ||
      !row.freelancerUserId.trim() ||
      row.freelancerUserId !== row.freelancerUserId.trim() ||
      row.freelancerUserId.length > 255
    ) continue;
    const crewId = typeof row.crewId === "string" ? row.crewId.slice(0, 255) : "";
    const key = `${row.freelancerUserId}\u0000${crewId}`;
    if (!recipients.has(key)) recipients.set(key, { freelancerUserId: row.freelancerUserId, crewId });
  }
  return [...recipients.values()];
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface DispatchGateSummary {
  newRecipientUserIds: string[];
  sent: number;
  alreadySent: number;
  skipped: number;
}

export function summarizeBriefDelivery(
  dispatch: Pick<DispatchGateSummary, "alreadySent" | "skipped">,
  delivery: { sent: number; skipped: number },
): { sent: number; skipped: number; alreadySent: number } {
  return {
    sent: delivery.sent,
    skipped: delivery.skipped + dispatch.skipped,
    alreadySent: dispatch.alreadySent,
  };
}

export async function synchronizeBriefAssignments(
  tx: Transaction,
  briefId: string,
  recipients: BriefRecipient[],
): Promise<{
  newRecipientUserIds: string[];
  newRecipientRecipients: BriefRecipient[];
  existingRecipientCount: number;
}> {
  const newRecipientUserIds: string[] = [];
  const newRecipientRecipients: BriefRecipient[] = [];
  let existingRecipientCount = 0;
  const currentKeys = new Set(
    recipients.map(
      (recipient) =>
        `${recipient.freelancerUserId}\u0000${recipient.crewId}`,
    ),
  );
  // A producer save is also a roster reconciliation. Preserve accepted and
  // declined rows as history, but revoke access for pending recipients that
  // are no longer in the current brief. They remain visible to the producer
  // as cancelled history and can only regain access if explicitly re-added.
  const existingAssignments = await tx
    .select({
      id: briefAssignmentsTable.id,
      freelancerUserId: briefAssignmentsTable.freelancerUserId,
      crewId: briefAssignmentsTable.crewId,
      decision: briefAssignmentsTable.decision,
    })
    .from(briefAssignmentsTable)
    .where(eq(briefAssignmentsTable.briefId, briefId));
  for (const existing of existingAssignments) {
    if (
      existing.decision === "pending" &&
      !currentKeys.has(
        `${existing.freelancerUserId}\u0000${existing.crewId}`,
      )
    ) {
      await tx
        .update(briefAssignmentsTable)
        .set({
          decision: "cancelled",
          shiftResponses: null,
          declineReason: null,
          updatedAt: sql`now()`,
        })
        .where(eq(briefAssignmentsTable.id, existing.id));
    }
  }
  for (const recipient of recipients) {
    const existing = existingAssignments.find(
      (assignment) =>
        assignment.freelancerUserId === recipient.freelancerUserId &&
        assignment.crewId === recipient.crewId,
    );
    if (existing?.decision === "cancelled") {
      await tx
        .update(briefAssignmentsTable)
        .set({
          decision: "pending",
          decidedAt: null,
          declineReason: null,
          shiftResponses: null,
          updatedAt: sql`now()`,
        })
        .where(eq(briefAssignmentsTable.id, existing.id));
      newRecipientUserIds.push(recipient.freelancerUserId);
      newRecipientRecipients.push(recipient);
      continue;
    }
    const inserted = await tx
      .insert(briefAssignmentsTable)
      .values({
        id: randomUUID(),
        briefId,
        freelancerUserId: recipient.freelancerUserId,
        crewId: recipient.crewId,
      })
      .onConflictDoNothing({
        target: [
          briefAssignmentsTable.briefId,
          briefAssignmentsTable.freelancerUserId,
          briefAssignmentsTable.crewId,
        ],
      })
      .returning({ id: briefAssignmentsTable.id });
    if (inserted.length > 0) {
      newRecipientUserIds.push(recipient.freelancerUserId);
      newRecipientRecipients.push(recipient);
    }
    else existingRecipientCount += 1;
    await tx
      .insert(briefDispatchesTable)
      .values({
        briefId,
        freelancerUserId: recipient.freelancerUserId,
        state: "pending",
      })
      .onConflictDoNothing({
        target: [
          briefDispatchesTable.briefId,
          briefDispatchesTable.freelancerUserId,
        ],
      });
  }
  return { newRecipientUserIds, newRecipientRecipients, existingRecipientCount };
}

/** Transactionally claims durable outbox rows. Assignment existence is not
 * interpreted as delivery state. Failed rows are claimable only through an
 * explicit retry. A dispatching row is deliberately never reclaimed, even
 * after its inspection lease expires: the original sender may still complete,
 * and Gmail provides no idempotency fence for a safe automatic resend. */
export async function claimBriefDispatches(
  tx: Transaction,
  briefId: string,
  recipients: BriefRecipient[],
  retryFailed = false,
): Promise<DispatchGateSummary> {
  if (recipients.length === 0) {
    return { newRecipientUserIds: [], sent: 0, alreadySent: 0, skipped: 0 };
  }
  const ids = recipients.map((recipient) => recipient.freelancerUserId);
  const profiles = await tx
    .select({ userId: freelancerProfilesTable.userId })
    .from(freelancerProfilesTable)
    .where(inArray(freelancerProfilesTable.userId, ids));
  const eligibleIds = new Set(profiles.map((profile) => profile.userId));
  let skipped = 0;
  let alreadySent = 0;
  const newRecipientUserIds: string[] = [];
  for (const recipient of recipients) {
    if (!eligibleIds.has(recipient.freelancerUserId)) {
      skipped += 1;
      continue;
    }
    const [dispatch] = await tx.select({
      state: briefDispatchesTable.state,
      leaseExpiresAt: briefDispatchesTable.leaseExpiresAt,
    })
      .from(briefDispatchesTable)
      .where(and(
        eq(briefDispatchesTable.briefId, briefId),
        eq(briefDispatchesTable.freelancerUserId, recipient.freelancerUserId),
      ))
      .limit(1)
      .for("update");
    if (!dispatch) {
      await tx.insert(briefDispatchesTable).values({
        briefId, freelancerUserId: recipient.freelancerUserId, state: "pending",
      });
    }
    const state = dispatch?.state ?? "pending";
    if (!isDispatchClaimable(
      state as "pending" | "dispatching" | "sent" | "failed",
      retryFailed,
    )) {
      alreadySent += 1;
      continue;
    }
    const claimed = await tx.update(briefDispatchesTable)
      .set({
        state: "dispatching",
        claimedAt: sql`now()`,
        leaseExpiresAt: sql`now() + interval '15 minutes'`,
        updatedAt: sql`now()`,
      })
      .where(and(
        eq(briefDispatchesTable.briefId, briefId),
        eq(briefDispatchesTable.freelancerUserId, recipient.freelancerUserId),
        eq(briefDispatchesTable.state, state),
      ))
      .returning({ id: briefDispatchesTable.id });
    if (claimed.length > 0) newRecipientUserIds.push(recipient.freelancerUserId);
    else alreadySent += 1;
  }
  return {
    newRecipientUserIds,
    sent: newRecipientUserIds.length,
    alreadySent,
    skipped,
  };
}

export async function completeBriefDispatches(
  briefId: string,
  outcomes: ReadonlyArray<{ freelancerUserId: string; sent: boolean }>,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const outcome of outcomes) {
      await tx.update(briefDispatchesTable)
        .set(outcome.sent
          ? { state: "sent", sentAt: sql`now()`, leaseExpiresAt: null, updatedAt: sql`now()` }
          : { state: "failed", failedAt: sql`now()`, leaseExpiresAt: null, updatedAt: sql`now()` })
        .where(and(
          eq(briefDispatchesTable.briefId, briefId),
          eq(briefDispatchesTable.freelancerUserId, outcome.freelancerUserId),
          eq(briefDispatchesTable.state, "dispatching"),
        ));
    }
  });
}

export function emptyDispatchSummary(): Omit<DispatchGateSummary, "newRecipientUserIds"> {
  return { sent: 0, alreadySent: 0, skipped: 0 };
}