import { autoAssignedDatesFor } from "./roleSchedule";

const SHIFT_SLOT_KEY = /^(\d{4}-\d{2}-\d{2})::(setup|rehearsal|show|downrig)$/;
const SHIFT_SLOT_DATE = /^\d{4}-\d{2}-\d{2}$/;

type JsonRecord = Record<string, unknown>;

function record(raw: unknown): JsonRecord {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as JsonRecord)
    : {};
}

function briefDate(raw: unknown): string | null {
  return typeof raw === "string" && SHIFT_SLOT_DATE.test(raw) ? raw : null;
}

/** Canonical producer-authored response slots. This is shared by response
 * validation and project confirmation counts so legacy schedule fallbacks
 * cannot drift between those paths. */
export function getBriefShiftSlots(
  brief: {
    data: unknown;
    startDate?: string | null;
    endDate?: string | null;
  },
  crewId: string,
): string[] {
  const data = record(brief.data);
  const assignments = data.assignments;
  const assignment =
    Array.isArray(assignments)
      ? (assignments.find(
          (value) =>
            value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            (value as JsonRecord).crewId === crewId,
        ) as JsonRecord | undefined)
      : undefined;
  const slots: string[] = [];
  const explicitKeys = new Set<string>();
  const windows = assignment?.assignedShiftWindows;
  if (windows && typeof windows === "object" && !Array.isArray(windows)) {
    for (const [key, raw] of Object.entries(windows as JsonRecord)) {
      if (!SHIFT_SLOT_KEY.test(key) || !Array.isArray(raw)) continue;
      const validCount = raw.filter(
        (window) =>
          window && typeof window === "object" && !Array.isArray(window),
      ).length;
      if (!validCount) continue;
      explicitKeys.add(key);
      for (let index = 0; index < validCount; index += 1) {
        slots.push(`${key}::${index}`);
      }
    }
  }
  const times = assignment?.assignedShiftTimes;
  if (times && typeof times === "object" && !Array.isArray(times)) {
    for (const [key, raw] of Object.entries(times as JsonRecord)) {
      if (
        !explicitKeys.has(key) &&
        SHIFT_SLOT_KEY.test(key) &&
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw)
      ) {
        explicitKeys.add(key);
        slots.push(`${key}::0`);
      }
    }
  }
  const phases = assignment?.assignedShiftPhases;
  if (Array.isArray(phases)) {
    for (const key of phases) {
      if (
        typeof key === "string" &&
        SHIFT_SLOT_KEY.test(key) &&
        !explicitKeys.has(key)
      ) {
        explicitKeys.add(key);
        slots.push(`${key}::0`);
      }
    }
  }
  if (slots.length) return slots.sort();

  const project = record(data.project);
  const role =
    typeof assignment?.role === "string" ? assignment.role.slice(0, 280) : "";
  const startDate =
    briefDate(brief.startDate) ?? briefDate(project.date);
  const endDate =
    briefDate(brief.endDate) ?? briefDate(project.endDate) ?? startDate;
  const assignedDates = autoAssignedDatesFor({
    role,
    schedule: project.schedule,
    startDate,
    endDate,
  });
  return assignedDates
    .filter((date) => SHIFT_SLOT_DATE.test(date))
    .map((date) => `${date}::day::0`)
    .sort();
}
