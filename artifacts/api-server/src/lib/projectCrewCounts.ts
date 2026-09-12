import { getBriefShiftSlots } from "./briefShiftSlots";

type JsonRecord = Record<string, unknown>;

function record(raw: unknown): JsonRecord {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as JsonRecord)
    : {};
}

/** The immutable roster role-slot ids on the producer's project, rather than
 * people or candidate assignment rows. Duplicate/corrupt ids are counted
 * once and rows without an id cannot be a stable role slot. */
export type RosterRoleSlot = {
  id: string;
  freelancerUserId: string | null;
};

export function rosterRoleSlots(projectData: unknown): RosterRoleSlot[] {
  const crew = record(projectData).crew;
  if (!Array.isArray(crew)) return [];
  const slots = new Map<string, RosterRoleSlot>();
  for (const value of crew) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as JsonRecord;
    const id = row.id;
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || slots.has(trimmed)) continue;
    const freelancerUserId =
      typeof row.freelancerUserId === "string" && row.freelancerUserId.trim()
        ? row.freelancerUserId.trim()
        : null;
    slots.set(trimmed, { id: trimmed, freelancerUserId });
  }
  return [...slots.values()];
}

export function rosterRoleSlotIds(projectData: unknown): string[] {
  return rosterRoleSlots(projectData).map((slot) => slot.id);
}

/** Derive exactly the response slots that were planned for a role. Explicit
 * split windows win over single timings, then phase-only entries, then the
 * legacy one-slot-per-day representation. */
export function plannedResponseSlots(
  briefData: unknown,
  crewId: string,
): string[] {
  return getBriefShiftSlots({ data: briefData }, crewId);
}

export type CrewCountAssignment = {
  crewId: string | null;
  freelancerUserId?: string | null;
  decision: string;
  shiftResponses: Record<string, "accepted" | "declined"> | null;
};

/** A role is confirmed only when its own candidate accepted and every
 * explicitly planned response window is accepted. A null response map is the
 * legacy whole-role decision; a present map is authoritative and must cover
 * every current slot. */
export function fullyAcceptedRole(
  briefData: unknown,
  assignment: CrewCountAssignment,
): boolean {
  if (assignment.decision !== "accepted" || !assignment.crewId) return false;
  const responses = assignment.shiftResponses;
  if (!responses) return true;
  const expected = plannedResponseSlots(briefData, assignment.crewId);
  const actual = Object.keys(responses);
  return (
    actual.length === expected.length &&
    expected.every((slot) => responses[slot] === "accepted")
  );
}

export function deriveProjectCrewCounts(
  projectData: unknown,
  briefData: unknown,
  assignments: readonly CrewCountAssignment[],
): { crewCount: number; confirmedCrewCount: number } {
  const roleSlots = rosterRoleSlots(projectData);
  const roleSlotById = new Map(roleSlots.map((slot) => [slot.id, slot]));
  const confirmed = new Set<string>();
  for (const assignment of assignments) {
    if (
      assignment.crewId &&
      roleSlotById.has(assignment.crewId) &&
      (!roleSlotById.get(assignment.crewId)?.freelancerUserId ||
        assignment.freelancerUserId ===
          roleSlotById.get(assignment.crewId)?.freelancerUserId) &&
      fullyAcceptedRole(briefData, assignment)
    ) {
      confirmed.add(assignment.crewId);
    }
  }
  return { crewCount: roleSlots.length, confirmedCrewCount: confirmed.size };
}
