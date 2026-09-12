const REMOVED_CREW_IDS_KEY = "removedCrewIds";
const REMOVED_CREW_ASSIGNMENTS_KEY = "removedCrewAssignments";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function cleanCrewId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id && id.length <= 255 ? id : null;
}

function assignmentTombstoneKey(
  crewId: unknown,
  freelancerUserId: unknown,
): string | null {
  const cleanCrew = cleanCrewId(crewId);
  const cleanFreelancer =
    typeof freelancerUserId === "string" ? freelancerUserId.trim() : "";
  if (!cleanCrew || !cleanFreelancer || cleanFreelancer.length > 255) return null;
  return `${cleanCrew}\u0000${cleanFreelancer}`;
}

export function removedCrewIdsFromProjectData(data: unknown): string[] {
  const raw = record(data)[REMOVED_CREW_IDS_KEY];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(cleanCrewId).filter((id): id is string => id !== null))];
}

export function removedCrewAssignmentKeys(data: unknown): string[] {
  const raw = record(data)[REMOVED_CREW_ASSIGNMENTS_KEY];
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((value) => {
          if (typeof value !== "string") return null;
          const [crewId, freelancerUserId] = value.split("\u0000");
          return assignmentTombstoneKey(crewId, freelancerUserId);
        })
        .filter((key): key is string => key !== null),
    ),
  ];
}

/**
 * Merge a producer's project payload with server-owned crew-removal
 * tombstones. Autosaves can be older than a remove request, so accepting the
 * incoming crew array verbatim would resurrect a role the producer removed.
 * The marker intentionally lives in the existing project jsonb; no schema
 * column is needed.
 */
export function normalizeProjectCrewData(
  incoming: unknown,
  persisted: unknown = null,
): Record<string, unknown> {
  const data = { ...record(incoming) };
  const removed = new Set([
    ...removedCrewIdsFromProjectData(persisted),
    ...removedCrewIdsFromProjectData(incoming),
  ]);
  const removedAssignments = new Set([
    ...removedCrewAssignmentKeys(persisted),
    ...removedCrewAssignmentKeys(incoming),
  ]);
  if (removed.size > 0) {
    data[REMOVED_CREW_IDS_KEY] = [...removed];
    if (Array.isArray(data.crew)) {
      data.crew = data.crew.filter((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return true;
        const crewId = cleanCrewId((value as JsonRecord).id);
        return !crewId || !removed.has(crewId);
      });
    }
  }
  if (removedAssignments.size > 0) {
    data[REMOVED_CREW_ASSIGNMENTS_KEY] = [...removedAssignments];
    if (Array.isArray(data.crew)) {
      data.crew = data.crew.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return value;
        }
        const role = value as JsonRecord;
        const key = assignmentTombstoneKey(role.id, role.freelancerUserId);
        return key && removedAssignments.has(key)
          ? { ...role, freelancerUserId: null }
          : value;
      });
    }
  }
  return data;
}

/** Remove one role-slot from the active project roster and persist its
 * tombstone. The caller must hold the project row lock. */
export function removeCrewFromProjectData(
  current: unknown,
  crewId: string,
): Record<string, unknown> {
  const id = cleanCrewId(crewId);
  const data = normalizeProjectCrewData(current);
  if (!id) return data;
  const removed = new Set(removedCrewIdsFromProjectData(data));
  removed.add(id);
  data[REMOVED_CREW_IDS_KEY] = [...removed];
  if (Array.isArray(data.crew)) {
    data.crew = data.crew.filter((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return true;
      const rowId = cleanCrewId((value as JsonRecord).id);
      return rowId !== id;
    });
  }
  return data;
}

/** Persist an exact candidate tombstone while retaining the project role
 * slot. A stale autosave may still carry the candidate, so normalization
 * clears only that account from the role and leaves the slot available. */
export function markCrewAssignmentRemovedFromProjectData(
  current: unknown,
  crewId: string,
  freelancerUserId: string,
): Record<string, unknown> {
  const data = normalizeProjectCrewData(current);
  const key = assignmentTombstoneKey(crewId, freelancerUserId);
  if (!key) return data;
  const tombstones = new Set(removedCrewAssignmentKeys(data));
  tombstones.add(key);
  data[REMOVED_CREW_ASSIGNMENTS_KEY] = [...tombstones];
  return normalizeProjectCrewData(data);
}

/** Return the account currently attached to one project role, if any. */
export function projectCrewFreelancerForRole(
  current: unknown,
  crewId: string,
): string | null {
  const crew = record(current).crew;
  if (!Array.isArray(crew)) return null;
  const role = crew.find(
    (value) =>
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as JsonRecord).id === crewId,
  );
  const freelancerUserId =
    role &&
    typeof role === "object" &&
    !Array.isArray(role) &&
    (role as JsonRecord).freelancerUserId;
  return typeof freelancerUserId === "string" && freelancerUserId.trim()
    ? freelancerUserId.trim()
    : null;
}

/** Remove all active brief rows for one immutable role slot. Historical
 * assignment rows remain in brief_assignments and retain their snapshots. */
export function removeCrewFromBriefData(
  current: unknown,
  crewId: string,
  options: { persistTombstone?: boolean } = {},
): { data: Record<string, unknown>; removed: boolean } {
  const source = { ...record(current) };
  const removedCrewIds = new Set(removedCrewIdsFromProjectData(source));
  const id = cleanCrewId(crewId);
  if (id && options.persistTombstone !== false) removedCrewIds.add(id);
  const assignments = Array.isArray(source.assignments)
    ? source.assignments.filter((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return true;
        return (value as JsonRecord).crewId !== crewId;
      })
    : null;
  const removed =
    assignments !== null && assignments.length !== (source.assignments as unknown[]).length;
  return {
    data: {
      ...source,
      ...(assignments ? { assignments } : {}),
      ...(source.recipientCrewId === crewId ? { recipientCrewId: null } : {}),
      ...(removedCrewIds.size > 0 && options.persistTombstone !== false
        ? { [REMOVED_CREW_IDS_KEY]: [...removedCrewIds] }
        : {}),
    },
    removed,
  };
}

/** Remove one exact candidate while retaining the role slot for another
 * candidate, and persist the pair tombstone against stale autosaves. */
export function removeCrewAssignmentFromBriefData(
  current: unknown,
  crewId: string,
  freelancerUserId: string,
): { data: Record<string, unknown>; removed: boolean } {
  const source = { ...record(current) };
  const key = assignmentTombstoneKey(crewId, freelancerUserId);
  let removed = false;
  const assignments = Array.isArray(source.assignments)
    ? source.assignments.filter((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return true;
        }
        const row = value as JsonRecord;
        const matches =
          row.crewId === crewId && row.freelancerUserId === freelancerUserId;
        if (matches) removed = true;
        return !matches;
      })
    : null;
  const tombstones = new Set(removedCrewAssignmentKeys(source));
  if (key) tombstones.add(key);
  return {
    data: {
      ...source,
      ...(assignments ? { assignments } : {}),
      ...(source.recipientCrewId === crewId ? { recipientCrewId: null } : {}),
      ...(tombstones.size > 0
        ? { [REMOVED_CREW_ASSIGNMENTS_KEY]: [...tombstones] }
        : {}),
    },
    removed,
  };
}

export {
  REMOVED_CREW_ASSIGNMENTS_KEY,
  REMOVED_CREW_IDS_KEY,
};