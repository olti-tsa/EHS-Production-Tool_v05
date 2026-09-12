import { Router, type IRouter, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  briefDispatchesTable,
  projectBriefsTable,
  briefAssignmentsTable,
  briefRoomAssignmentsTable,
  gigsTable,
  freelancerProfilesTable,
  projectsTable,
  PROJECT_BRIEF_PROVENANCE_LOCK,
  venuesTable,
  type ProjectBriefRow,
  type ProjectRow,
} from "@workspace/db";
import { getUserType, requireEmployee } from "../middleware/userType";
import { logger } from "../lib/logger";
import {
  assignRooms,
  type PairingPerson,
  type PairingGender,
  type RoomShare,
} from "../lib/roomPairing";
import { dispatchBriefRequestEmails } from "../lib/briefEmail";
import {
  canCancelBriefAssignment,
  removeCancelledAssignmentFromBriefData,
} from "../lib/briefAssignmentCancellation";
import { parseDeclineReason } from "../lib/briefResponse";
import { getBriefShiftSlots } from "../lib/briefShiftSlots";
import {
  readBriefRecipients,
  selectBriefDispatchRecipients,
} from "../lib/briefRecipients";
import {
  notifyCrewResponse,
  subscribeCrewResponses,
} from "../lib/briefResponseEvents";
import { autoAssignedDatesFor } from "../lib/roleSchedule";
import { rollupItinerary } from "../lib/itineraryRollup";
import {
  getEmployeeProjectAccess,
  getProjectAccess,
  isProjectArchived,
  UUID_PATTERN,
} from "../lib/projectAccess";
import {
  claimBriefDispatches,
  completeBriefDispatches,
  deriveLegacyProjectStatus,
  effectiveBriefProjectId,
  recipientsFromBriefData,
  summarizeBriefDelivery,
  synchronizeBriefAssignments,
} from "../lib/projectLifecycle";
import {
  classifyDietary,
  splitAllergens,
  DIETARY_TAGS,
  type DietaryTag,
} from "../lib/dietaryTags";
import {
  removeCrewFromBriefData,
  removeCrewAssignmentFromBriefData,
  removeCrewFromProjectData,
  markCrewAssignmentRemovedFromProjectData,
  projectCrewFreelancerForRole,
  removedCrewAssignmentKeys,
  removedCrewIdsFromProjectData,
} from "../lib/projectCrewRemoval";

const router: IRouter = Router();

function isCurrentBriefRecipient(
  briefData: unknown,
  crewId: string,
  freelancerUserId: string,
): boolean {
  return recipientsFromBriefData(briefData).some(
    (recipient) =>
      recipient.crewId === crewId &&
      recipient.freelancerUserId === freelancerUserId,
  );
}

const requireUnarchivedBriefProject: RequestHandler = async (req, res, next) => {
  const briefId = String(req.params.id ?? "");
  try {
    const [row] = await db
      .select({
        projectId: projectBriefsTable.projectId,
        archivedAt: projectsTable.archivedAt,
        status: projectsTable.status,
      })
      .from(projectBriefsTable)
      .leftJoin(projectsTable, eq(projectsTable.id, projectBriefsTable.projectId))
      .where(eq(projectBriefsTable.id, briefId))
      .limit(1);
    if (row?.projectId && isProjectArchived(row)) {
      res.status(409).json({
        ok: false,
        error: "Archived projects must be restored before producer changes.",
      });
      return;
    }
    next();
  } catch (error) {
    req.log.error(error, "Failed to verify brief project archive state");
    res.status(500).json({ ok: false, error: "Could not verify project state." });
  }
};

const requireSignedIn: RequestHandler = (req, res, next) => {
  const auth =
    typeof (req as unknown as { auth?: unknown }).auth === "function"
      ? ((req as unknown as { auth: () => { userId?: string | null } }).auth())
      : ((req as unknown as { auth?: { userId?: string | null } }).auth ?? {});
  if (!auth || !auth.userId) {
    res.status(401).json({ ok: false, error: "Sign in required." });
    return;
  }
  (req as unknown as { _userId: string })._userId = auth.userId;
  next();
};

/** Brief jsonb caps out at 256 KB — generous for a brief but a hard
 *  ceiling so a malformed payload can't park a multi-MB blob in the
 *  table. Matches the global JSON parser limit in `app.ts`. */
const MAX_BRIEF_BYTES = 256 * 1024;

const RESTRICTED_BRIEF_KEYS = new Set([
  "venueTechnicalSnapshot",
  "venueTechnical",
  "venueProfile",
  "clientProfile",
  "clientDetails",
  "billingAddress",
  "primaryContacts",
  "clientContact",
  "clientContacts",
  "organizationNumber",
  "defaultPaymentTermsDays",
  "paymentTerms",
  "billing_address",
  "primary_contacts",
  "organization_number",
  "default_payment_terms_days",
  "client_contact",
  "client_contacts",
  "clientDirectory",
  "removedCrewIds",
  "removedCrewAssignments",
  "technicalContactName",
  "technicalContactPhone",
  "technicalContactEmail",
]);

function isClientContactField(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return (
    /^(?:client|customer)(?:contact|contacts|email|phone|mobile|telephone|address|street|postal|zip|details|profile)$/.test(
      normalized,
    ) ||
    normalized === "clientcontactname" ||
    normalized === "clientcontactphone" ||
    normalized === "clientcontactemail"
  );
}

/** Remove fields that are never appropriate in a freelancer DTO. This is
 * recursive because old briefs may have nested client-directory payloads. */
function withoutUntrustedProfiles(raw: Record<string, unknown>): Record<string, unknown> {
  const cleanse = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(cleanse);
    if (!value || typeof value !== "object") return value;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        RESTRICTED_BRIEF_KEYS.has(key) ||
        isClientContactField(key) ||
        /^(?:client[_-]?)?(?:billing|contact|contacts|organization|payment)/i.test(key)
      ) continue;
      // Legacy briefs sometimes represented the client as a directory object.
      // Keep only its company identity; a nested name/phone/email/contact
      // object must never cross the freelancer DTO boundary.
      if (
        (key === "client" || key === "customer") &&
        child &&
        typeof child === "object" &&
        !Array.isArray(child)
      ) {
        const cleanClient = cleanse(child);
        if (cleanClient && typeof cleanClient === "object" && !Array.isArray(cleanClient)) {
          const company: Record<string, unknown> = {};
          for (const companyKey of ["company", "companyName", "name"]) {
            if (typeof (cleanClient as Record<string, unknown>)[companyKey] === "string") {
              company[companyKey] = (cleanClient as Record<string, unknown>)[companyKey];
            }
          }
          if (Object.keys(company).length > 0) result[key] = company;
        }
        continue;
      }
      result[key] = cleanse(child);
    }
    return result;
  };
  const cleansed = cleanse(raw);
  const clean = cleansed && typeof cleansed === "object" && !Array.isArray(cleansed)
    ? cleansed as Record<string, unknown>
    : {};
  if ("venue" in clean && typeof clean.venue !== "string") delete clean.venue;
  if (clean.project && typeof clean.project === "object" && !Array.isArray(clean.project)) {
    const project = { ...(clean.project as Record<string, unknown>) };
    for (const key of RESTRICTED_BRIEF_KEYS) delete project[key];
    if ("projectName" in project && typeof project.projectName !== "string") delete project.projectName;
    if ("venue" in project && typeof project.venue !== "string") delete project.venue;
    clean.project = project;
  }
  return clean;
}

/** Only the server-owned venue projection is added to a freelancer brief.
 * The database row could only have been created by `safeVenueSnapshot`, but
 * we still select its allowed keys explicitly as a defence-in-depth DTO. */
function trustedVenueSnapshot(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const key of [
    "name",
    "address",
    "website",
    "riggingSpecs",
    "powerInfrastructure",
    "logisticsAccess",
    "siteFacilities",
  ]) {
    if (key in source) snapshot[key] = source[key];
  }
  return snapshot;
}

function freelancerBriefData(
  raw: unknown,
  storedSnapshot: unknown,
): Record<string, unknown> {
  const clean = raw && typeof raw === "object" && !Array.isArray(raw)
    ? withoutUntrustedProfiles(raw as Record<string, unknown>)
    : {};
  const project = clean.project && typeof clean.project === "object" && !Array.isArray(clean.project)
    ? { ...(clean.project as Record<string, unknown>) }
    : {};
  // The client body cannot carry a venue snapshot. The only one emitted is
  // this narrowed DB projection, under the stable project DTO location.
  delete project.venueTechnicalSnapshot;
  const snapshot = trustedVenueSnapshot(storedSnapshot);
  if (snapshot) project.venueTechnicalSnapshot = snapshot;
  clean.project = project;
  return clean;
}

async function safeVenueSnapshot(
  userId: string,
  projectId: string | null,
  directVenueId: string | null,
): Promise<{ snapshot: Record<string, unknown> | null; error?: string }> {
  let venueId = directVenueId;
  if (projectId) {
    const access = await getEmployeeProjectAccess(projectId, userId);
    if (!access) return { snapshot: null, error: "Project not found." };
    const [project] = await db.select({ venueId: projectsTable.venueId })
      .from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
    venueId = project?.venueId ?? null;
  }
  if (!venueId) return { snapshot: null };
  const [venue] = await db.select({
    name: venuesTable.name,
    address: venuesTable.address,
    website: venuesTable.website,
    riggingSpecs: venuesTable.riggingSpecs,
    powerInfrastructure: venuesTable.powerInfrastructure,
    logisticsAccess: venuesTable.logisticsAccess,
    siteFacilities: venuesTable.siteFacilities,
  }).from(venuesTable).where(eq(venuesTable.id, venueId)).limit(1);
  if (!venue) return { snapshot: null, error: "Venue not found." };
  return { snapshot: venue };
}

/** Decisions a freelancer is allowed to send themselves. `too_late` is
 *  a *server-only* status — it's set when another freelancer beats this
 *  one to the accept on a first-to-accept-wins brief, and is never a
 *  valid input on the /respond endpoint. */
const VALID_DECISIONS: ReadonlySet<string> = new Set([
  "pending",
  "accepted",
  "declined",
]);

/** Pull a YYYY-MM-DD string off the brief jsonb if present. Defensive
 *  — the brief structure is loose so we don't crash on missing fields. */
function pickDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Accept ISO date or ISO datetime; we only need the date portion.
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Drill into the brief jsonb to extract the columns we want indexable
 *  copies of. We never trust the client to pass these separately.
 *
 *  Field mapping matches the canonical `ProjectBrief.project` shape in
 *  `artifacts/rigging-load-report/src/lib/projectBrief.ts`:
 *    - `project.projectName` → `projectName` (falls back to venue for
 *                                           backwards-compatible briefs)
 *    - `project.venue`       → `venue`
 *    - `project.client`  → `client`
 *    - `project.date`    → `startDate` (ISO YYYY-MM-DD; the brief
 *                                       schema uses `date` for the
 *                                       start of a single- or
 *                                       multi-day show)
 *    - `project.endDate` → `endDate`   (optional; only set on
 *                                       multi-day shows) */
function extractIndexed(data: Record<string, unknown>): {
  projectName: string;
  client: string;
  venue: string;
  startDate: string | null;
  endDate: string | null;
} {
  const project =
    (data.project && typeof data.project === "object"
      ? (data.project as Record<string, unknown>)
      : {}) as Record<string, unknown>;
  const venue =
    typeof project.venue === "string" ? project.venue.slice(0, 280) : "";
  const projectName =
    typeof project.projectName === "string"
      ? project.projectName.slice(0, 280)
      : venue;
  return {
    projectName,
    client:
      typeof project.client === "string" ? project.client.slice(0, 280) : "",
    venue,
    startDate: pickDate(project.date),
    endDate: pickDate(project.endDate),
  };
}

/** Create the immutable acceptance snapshot from the producer-authored brief.
 * Client snapshots are deliberately ignored: booking history and change
 * detection must never trust freelancer-supplied role, rate, or date values. */
function buildServerAcceptedSnapshot(
  briefData: unknown,
  crewId: string,
): Record<string, unknown> {
  const data =
    briefData && typeof briefData === "object" && !Array.isArray(briefData)
      ? (briefData as Record<string, unknown>)
      : {};
  const assignments = Array.isArray(data.assignments)
    ? data.assignments.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : [];
  const myAssignment = assignments.find((row) => row.crewId === crewId);
  return {
    _source: "server",
    generatedAt:
      typeof data.generatedAt === "number" && Number.isFinite(data.generatedAt)
        ? data.generatedAt
        : Date.now(),
    project:
      data.project && typeof data.project === "object" && !Array.isArray(data.project)
        ? data.project
        : {},
    ...(myAssignment ? { myAssignment } : {}),
  };
}

/** Gig statuses past `confirmed` that the freelancer themselves drives
 *  (done → invoiced → paid). When a re-accept or acknowledge fires
 *  against an existing gig in one of these states, we must keep the
 *  status as-is rather than silently downgrading the booking back to
 *  `confirmed`. `invited` is allowed to be promoted to `confirmed`
 *  because the freelancer hasn't acted on the gig yet. */
const TERMINAL_GIG_STATUSES: ReadonlySet<string> = new Set([
  "done",
  "invoiced",
  "paid",
]);

/** Build the gigs-table fields for a freelancer who just won a brief.
 *  Pulls project-name / venue / dates from the denormalised columns
 *  (which the brief POST handler computed via `extractIndexed`) and
 *  drills into the `data` jsonb to find the per-crew role / hours /
 *  rate for the slot the caller was addressed for. We use `crewId`
 *  to pick the exact line out of `data.assignments[]`; unresolved rows
 *  stay empty rather than borrowing another crew member's details. */
function gigFieldsFromBrief(
  brief: {
    projectName: string | null;
    client: string | null;
    venue: string | null;
    startDate: string | null;
    endDate: string | null;
    data: unknown;
  },
  crewId: string,
): {
  projectName: string;
  client: string;
  venue: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  hours: string;
  rate: string;
  notes: string;
  /** Working days for this freelancer — auto-assigned from the brief's
   *  schedule × the role's default phase mapping. Falls back to every
   *  day in `startDate..endDate` when the brief has no schedule. The
   *  producer can override later via PATCH /api/portal/gigs/:id. */
  assignedDates: string[];
} {
  const data =
    brief.data && typeof brief.data === "object"
      ? (brief.data as Record<string, unknown>)
      : {};
  const assignments = Array.isArray(data.assignments)
    ? (data.assignments as Record<string, unknown>[])
    : [];
  const target = crewId
    ? assignments.find((a) => typeof a.crewId === "string" && a.crewId === crewId)
    : undefined;
  const role =
    target && typeof target.role === "string" ? target.role.slice(0, 280) : "";
  const notes =
    target && typeof target.notes === "string"
      ? target.notes.slice(0, 4000)
      : "";
  // numeric() columns expect strings; coerce defensively.
  const toNumeric = (raw: unknown): string => {
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? Number(raw)
          : 0;
    if (!Number.isFinite(n) || n < 0) return "0";
    return Math.min(n, 1_000_000_000).toFixed(2);
  };
  const startDate = brief.startDate;
  const project =
    data.project && typeof data.project === "object"
      ? (data.project as Record<string, unknown>)
      : {};
  const assignedDates = autoAssignedDatesFor({
    role,
    schedule: project.schedule,
    startDate,
    endDate: brief.endDate ?? startDate,
  });
  return {
    projectName: brief.projectName ?? brief.venue ?? "",
    client: brief.client ?? "",
    venue: brief.venue ?? "",
    role,
    startDate,
    endDate: brief.endDate ?? startDate,
    hours: toNumeric(target?.hours),
    rate: toNumeric(target?.dayRate),
    notes,
    assignedDates,
  };
}

type ShiftResponse = "accepted" | "declined";
type ShiftResponses = Record<string, ShiftResponse>;

/** Build the current, producer-authored response slots for one assignment.
 * Explicit split windows take precedence over a phase's single timing entry;
 * old briefs with neither retain one day slot for each normal assigned date. */
function responseSlotsForAssignment(
  brief: Parameters<typeof gigFieldsFromBrief>[0],
  crewId: string,
): string[] {
  return getBriefShiftSlots(brief, crewId);
}

/** Read the recipient list for a brief. Sources, in priority order:
 *
 *  1. The top-level `recipients` array on the POST body — the
 *     authoritative shape used by the new producer UI to address a
 *     brief to specific freelancers picked from the shared directory.
 *  2. `data.assignments[].freelancerUserId` — set by the producer's
 *     Crew Report when the assigned crew member was picked from the
 *     directory. Provides forward compatibility once the brief itself
 *     starts carrying the id alongside the name.
 *
 *  Both sources are merged and de-duplicated by the immutable role slot
 *  `(freelancerUserId, crewId)`. A freelancer may legitimately hold more
 *  than one role on the same brief. */
/** GET /api/portal/briefs/mine
 *  Returns every brief addressed to the signed-in freelancer, joined
 *  with the assignment row that carries the decision + accepted snapshot. */
router.get("/portal/briefs/mine", requireSignedIn, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  try {
    const rows = await db
      .select({
        assignmentId: briefAssignmentsTable.id,
        briefId: briefAssignmentsTable.briefId,
        crewId: briefAssignmentsTable.crewId,
        decision: briefAssignmentsTable.decision,
        shiftResponses: briefAssignmentsTable.shiftResponses,
        declineReason: briefAssignmentsTable.declineReason,
        decidedAt: briefAssignmentsTable.decidedAt,
        acceptedSnapshot: briefAssignmentsTable.acceptedSnapshot,
        acceptedGigId: briefAssignmentsTable.acceptedGigId,
        receivedAt: briefAssignmentsTable.createdAt,
        brief: projectBriefsTable.data,
        ownerUserId: projectBriefsTable.ownerUserId,
        projectName: projectBriefsTable.projectName,
        venue: projectBriefsTable.venue,
        venueTechnicalSnapshot: projectBriefsTable.venueTechnicalSnapshot,
        startDate: projectBriefsTable.startDate,
        endDate: projectBriefsTable.endDate,
      })
      .from(briefAssignmentsTable)
      .innerJoin(
        projectBriefsTable,
        eq(briefAssignmentsTable.briefId, projectBriefsTable.id),
      )
      .where(
        and(
          eq(briefAssignmentsTable.freelancerUserId, userId),
          sql`${briefAssignmentsTable.decision} <> 'cancelled'`,
        ),
      )
      .orderBy(desc(briefAssignmentsTable.createdAt));
    res.json({
      ok: true,
      briefs: rows
        .filter(
          (row) =>
            row.decision !== "cancelled" &&
            isCurrentBriefRecipient(row.brief, row.crewId, userId),
        )
        .map((row) => ({
        ...(() => {
          const { venueTechnicalSnapshot: _trustedSnapshot, ...withoutSnapshot } = row;
          return withoutSnapshot;
        })(),
        brief: freelancerBriefData(row.brief, row.venueTechnicalSnapshot),
        acceptedSnapshot:
          row.acceptedSnapshot &&
          typeof row.acceptedSnapshot === "object" &&
          !Array.isArray(row.acceptedSnapshot)
            ? freelancerBriefData(row.acceptedSnapshot, null)
            : row.acceptedSnapshot,
        })),
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal briefs/mine GET failed",
    );
    res.status(500).json({ ok: false, error: "Could not load briefs." });
  }
});

/** GET /api/portal/briefs
 *  Producer-facing list: every brief the signed-in user owns. */
router.get("/portal/briefs", requireEmployee, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  try {
    const rows = await db
      .select()
      .from(projectBriefsTable)
      .where(eq(projectBriefsTable.ownerUserId, userId))
      .orderBy(desc(projectBriefsTable.updatedAt))
      .limit(200);
    res.json({ ok: true, briefs: rows });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal briefs GET failed",
    );
    res.status(500).json({ ok: false, error: "Could not load briefs." });
  }
});

/** GET /api/portal/briefs/events/stream
 *  Producer-only account-scoped stream. The event contains only the brief id;
 *  the producer refetches the already-authorized assignments DTO. */
router.get(
  "/portal/briefs/events/stream",
  requireEmployee,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const STREAM_MAX_LIFETIME_MS = 15 * 60 * 1000;
    const HEARTBEAT_MS = 25 * 1000;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let lifetime: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let cleanedUp = false;
    const cleanup = () => {
      // `subscribeCrewResponses` can still be awaiting its LISTEN client
      // while the request closes. In that case the close handler runs first;
      // consume a late unsubscribe here instead of letting it leak.
      if (unsubscribe) {
        const stop = unsubscribe;
        unsubscribe = null;
        stop();
      }
      if (cleanedUp) return;
      cleanedUp = true;
      if (heartbeat) clearInterval(heartbeat);
      if (lifetime) clearTimeout(lifetime);
    };
    const close = () => {
      closed = true;
      cleanup();
    };
    req.once("close", close);
    res.once("close", close);
    try {
      res.status(200);
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      if (closed) {
        cleanup();
        return;
      }
      unsubscribe = await subscribeCrewResponses(userId, res);
      // The client may have disconnected while LISTEN was being acquired.
      // Remove the subscription without writing an event to a closed socket.
      if (closed) {
        cleanup();
        return;
      }
      if (!res.write("event: ready\ndata: {}\n\n")) {
        cleanup();
        return;
      }
      heartbeat = setInterval(() => {
        if (closed || !res.write(": heartbeat\n\n")) cleanup();
      }, HEARTBEAT_MS);
      lifetime = setTimeout(() => {
        cleanup();
        if (!res.writableEnded) res.end();
      }, STREAM_MAX_LIFETIME_MS);
    } catch (err) {
      req.log.error(err, "portal brief events stream failed");
      cleanup();
      if (!res.headersSent) {
        res.status(503).json({
          ok: false,
          error: "Crew response updates are temporarily unavailable.",
        });
      } else {
        res.end();
      }
    }
  },
);

/** GET /api/portal/briefs/:id
 *  Fetch a specific brief. The owner and explicitly assigned freelancers can
 *  read it. Employees may additionally read a brief linked to a project they
 *  can view; this router is not employee-gated, so that path verifies the
 *  caller's employee type before using employee project read access. */
router.get("/portal/briefs/:id", requireSignedIn, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  const id = String(req.params.id ?? "");
  try {
    const briefRows = await db
      .select()
      .from(projectBriefsTable)
      .where(eq(projectBriefsTable.id, id))
      .limit(1);
    const brief = briefRows[0];
    if (!brief) {
      res.status(404).json({ ok: false, error: "Brief not found." });
      return;
    }
    let freelancerView = false;
    if (brief.ownerUserId !== userId) {
      const assigned = await db
        .select({
          id: briefAssignmentsTable.id,
          decision: briefAssignmentsTable.decision,
          crewId: briefAssignmentsTable.crewId,
        })
        .from(briefAssignmentsTable)
        .where(
          and(
            eq(briefAssignmentsTable.briefId, id),
            eq(briefAssignmentsTable.freelancerUserId, userId),
          ),
        );
      const currentAssignments = assigned.filter(
        (assignment) =>
          assignment.decision !== "cancelled" &&
          isCurrentBriefRecipient(brief.data, assignment.crewId, userId),
      );
      if (currentAssignments.length > 0) {
        freelancerView = true;
      } else {
        const [priorDispatch] = await db
          .select({ id: briefDispatchesTable.id })
          .from(briefDispatchesTable)
          .where(
            and(
              eq(briefDispatchesTable.briefId, id),
              eq(briefDispatchesTable.freelancerUserId, userId),
            ),
          )
          .limit(1);
        if (priorDispatch) {
          res.status(410).json({
            ok: false,
            code: "request_cancelled",
            error: "Denne forespørselen er ikke lenger gyldig.",
          });
          return;
        }
        if (!brief.projectId) {
          res.status(403).json({ ok: false, error: "Not your brief." });
          return;
        }
        let userType;
        try {
          userType = await getUserType(userId);
        } catch (err) {
          logger.warn(
            {
              userId,
              briefId: brief.id,
              err: err instanceof Error ? err.message : String(err),
            },
            "could not verify employee access to linked brief",
          );
          res.status(503).json({
            ok: false,
            error: "Employee authorization is temporarily unavailable.",
          });
          return;
        }
        if (
          userType !== "employee" ||
          !(await getEmployeeProjectAccess(brief.projectId, userId))
        ) {
          res.status(403).json({ ok: false, error: "Not your brief." });
          return;
        }
      }
    }
    res.json({
      ok: true,
      brief: freelancerView
        ? (() => {
            const { venueTechnicalSnapshot: _trustedSnapshot, ...withoutSnapshot } = brief;
            return {
              ...withoutSnapshot,
              data: freelancerBriefData(brief.data, brief.venueTechnicalSnapshot),
            };
          })()
        : brief,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal briefs/:id GET failed",
    );
    res.status(500).json({ ok: false, error: "Could not load brief." });
  }
});

/** POST /api/portal/briefs
 *  body: { id?: string, data: <ProjectBrief>, recipients?: { freelancerUserId, crewId? }[] }
 *
 *  Producer-only. Creates or replaces a brief the signed-in user owns
 *  and re-syncs `brief_assignments` from the merged recipient list (top-level
 *  `recipients` array + any `freelancerUserId` carried inside the brief's
 *  own `assignments[]`).
 *
 *  Brief write + assignment sync run inside a single transaction so a
 *  partial failure can't leave the indexed columns out of sync with the
 *  jsonb body, or leave orphan assignment rows referencing a half-saved
 *  brief. The unique index on (brief_id, freelancer_user_id) makes the
 *  upsert + crewId refresh truly idempotent — no DELETE-USING dedup
 *  pass needed. */
router.post("/portal/briefs", requireEmployee, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  const body = (req.body ?? {}) as {
    id?: unknown;
    data?: unknown;
    recipients?: unknown;
    project_id?: unknown;
    venue_id?: unknown;
    send_email?: unknown;
    notification_type?: unknown;
  };
  const submittedData = body.data;
  if (!submittedData || typeof submittedData !== "object" || Array.isArray(submittedData)) {
    res.status(400).json({ ok: false, error: "data must be a JSON object." });
    return;
  }
  // Keep the producer's own call-sheet client contact in the stored brief.
  // It is removed again by freelancerBriefData() at every freelancer
  // projection boundary, including accepted snapshots.
  const submittedProject =
    (submittedData as Record<string, unknown>).project &&
    typeof (submittedData as Record<string, unknown>).project === "object" &&
    !Array.isArray((submittedData as Record<string, unknown>).project)
      ? ((submittedData as Record<string, unknown>).project as Record<string, unknown>)
      : null;
  const submittedClientContact =
    typeof submittedProject?.clientContact === "string"
      ? submittedProject.clientContact.trim()
      : "";
  const data = withoutUntrustedProfiles(submittedData as Record<string, unknown>);
  if (submittedClientContact) {
    const project =
      data.project && typeof data.project === "object" && !Array.isArray(data.project)
        ? { ...(data.project as Record<string, unknown>) }
        : {};
    project.clientContact = submittedClientContact;
    data.project = project;
  }
  const serialised = JSON.stringify(data);
  if (Buffer.byteLength(serialised, "utf8") > MAX_BRIEF_BYTES) {
    res.status(413).json({ ok: false, error: "Brief too large." });
    return;
  }
  const id =
    typeof body.id === "string" && body.id.trim()
      ? body.id.trim().slice(0, 64)
      : randomUUID();
  const explicitEmailDispatch = body.send_email === true;
  // `recipients` reconciles the entire current brief. An explicit send,
  // however, targets only the top-level recipient list supplied for this
  // delivery action; never reset/reclaim every assignment merely because the
  // saved brief still contains their historical recipient ids.
  const notificationType =
    body.notification_type === "share_brief"
      ? ("share_brief" as const)
      : ("send_request" as const);
  try {
    const nestedProject =
      data.project && typeof data.project === "object" && !Array.isArray(data.project)
        ? (data.project as Record<string, unknown>)
        : {};
    const rawProjectId = body.project_id ?? nestedProject.project_id ?? nestedProject.projectId;
    const rawVenueId = body.venue_id ?? nestedProject.venue_id ?? nestedProject.venueId;
    if (
      (rawProjectId != null && (typeof rawProjectId !== "string" || !UUID_PATTERN.test(rawProjectId))) ||
      (rawVenueId != null && (typeof rawVenueId !== "string" || !UUID_PATTERN.test(rawVenueId)))
    ) {
      res.status(400).json({ ok: false, error: "project_id and venue_id must be valid UUIDs." });
      return;
    }
    const venueProjection = await safeVenueSnapshot(
      userId,
      typeof rawProjectId === "string" ? rawProjectId : null,
      typeof rawVenueId === "string" ? rawVenueId : null,
    );
    if (venueProjection.error) {
      res.status(400).json({ ok: false, error: venueProjection.error });
      return;
    }
    const result = await db.transaction(async (tx) => {
      await tx.execute(PROJECT_BRIEF_PROVENANCE_LOCK);
      // If the brief already exists, only the original owner may update it.
      const existing = await tx
        .select({
          ownerUserId: projectBriefsTable.ownerUserId,
          projectId: projectBriefsTable.projectId,
          data: projectBriefsTable.data,
        })
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, id))
        .limit(1)
        .for("update");
      if (existing[0] && existing[0].ownerUserId !== userId) {
        return { forbidden: true as const };
      }
      // An existing brief retains its project when project_id is omitted.
      // Never permit a supplied id to silently reassign its provenance.
      const effectiveProjectId = effectiveBriefProjectId(
        existing[0]?.projectId,
        typeof rawProjectId === "string" ? rawProjectId : null,
      );
      if (effectiveProjectId === "conflict") {
        return { terminalProject: true as const };
      }
      let effectiveProjectStatus = null;
      let effectiveProjectData: unknown = null;
      if (effectiveProjectId) {
        const [effectiveProject] = await tx.select()
          .from(projectsTable)
          .where(eq(projectsTable.id, effectiveProjectId))
          .limit(1)
          .for("update");
        if (
          !effectiveProject ||
          effectiveProject.userId !== userId ||
          isProjectArchived(effectiveProject) ||
          ["completed", "archived"].includes(deriveLegacyProjectStatus(effectiveProject))
        ) return { terminalProject: true as const };
        effectiveProjectStatus = deriveLegacyProjectStatus(effectiveProject);
        effectiveProjectData = effectiveProject.data;
      }
      // The project remove endpoint persists role tombstones in the existing
      // jsonb payload. Reconcile them here as well: a delayed brief autosave
      // may still contain the removed assignment and must not recreate active
      // access after the atomic remove has committed.
      let effectiveData = data;
      const removedCrewIds = [
        ...new Set([
          ...removedCrewIdsFromProjectData(existing[0]?.data),
          ...removedCrewIdsFromProjectData(effectiveProjectData),
        ]),
      ];
      for (const removedCrewId of removedCrewIds) {
        effectiveData = removeCrewFromBriefData(effectiveData, removedCrewId).data;
      }
      const removedCrewAssignmentTombstones = new Set([
        ...removedCrewAssignmentKeys(existing[0]?.data),
        ...removedCrewAssignmentKeys(effectiveProjectData),
      ]);
      for (const tombstone of removedCrewAssignmentTombstones) {
        const [removedCrewId, removedFreelancerUserId] =
          tombstone.split("\u0000");
        effectiveData = removeCrewAssignmentFromBriefData(
          effectiveData,
          removedCrewId,
          removedFreelancerUserId,
        ).data;
      }
      const indexed = extractIndexed(effectiveData as Record<string, unknown>);
      const recipients = readBriefRecipients(effectiveData, body.recipients).filter(
        (recipient) =>
          !removedCrewIds.includes(recipient.crewId) &&
          !removedCrewAssignmentTombstones.has(
            `${recipient.crewId}\u0000${recipient.freelancerUserId}`,
          ),
      );
      const explicitDeliveryRecipients = explicitEmailDispatch
        ? readBriefRecipients({}, body.recipients).filter(
            (recipient) =>
              !removedCrewIds.includes(recipient.crewId) &&
              !removedCrewAssignmentTombstones.has(
                `${recipient.crewId}\u0000${recipient.freelancerUserId}`,
              ),
          )
        : [];
      const inserted = await tx
        .insert(projectBriefsTable)
        .values({
          id,
          ownerUserId: userId,
          projectId: effectiveProjectId,
          ...indexed,
          data: effectiveData as Record<string, unknown>,
          venueTechnicalSnapshot: venueProjection.snapshot,
        })
        .onConflictDoUpdate({
          target: projectBriefsTable.id,
          set: {
            ...indexed,
            ...(typeof rawProjectId === "string"
              ? { projectId: rawProjectId }
              : {}),
            data: effectiveData as Record<string, unknown>,
            venueTechnicalSnapshot: venueProjection.snapshot,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      // Re-sync assignment rows. The unique index on (brief_id,
      // freelancer_user_id) means onConflictDoNothing() is safe — a
      // concurrent re-save cannot create duplicates. Removed
      // recipients are intentionally NOT deleted: keeping the row
      // preserves a recipient's accept history through a producer
      // reorganisation. The client can flag "removed" using the
      // brief's current `recipients` list as the source of truth.
      const assignmentSync = await synchronizeBriefAssignments(tx, id, recipients);
      if (explicitEmailDispatch && explicitDeliveryRecipients.length > 0) {
        // Share Brief is the deliberate producer resend action. Keep its
        // historical explicit semantics (terminal sent/failed deliveries are
        // reset), while send_request remains idempotent for already-sent
        // requests and only retries a selected failed delivery.
        if (notificationType === "share_brief") {
          const recipientIds = [
            ...new Set(
              explicitDeliveryRecipients.map(
                (recipient) => recipient.freelancerUserId,
              ),
            ),
          ];
          await tx
            .update(briefDispatchesTable)
            .set({
              state: "pending",
              claimedAt: null,
              leaseExpiresAt: null,
              failedAt: null,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(briefDispatchesTable.briefId, id),
                inArray(briefDispatchesTable.freelancerUserId, recipientIds),
                inArray(briefDispatchesTable.state, ["sent", "failed"]),
              ),
            );
        }
      }
      let dispatchRecipients = selectBriefDispatchRecipients({
        newlyAdded: assignmentSync.newRecipientRecipients,
        explicit: explicitEmailDispatch ? explicitDeliveryRecipients : null,
        action: notificationType,
      });
      if (explicitEmailDispatch && notificationType === "send_request") {
        // An accepted role is historical booking state, not a new request.
        // A stale producer UI may still include it in recipients[], so do
        // not emit a second request merely because the explicit action was
        // selected again.
        const accepted = await tx
          .select({
            freelancerUserId: briefAssignmentsTable.freelancerUserId,
            crewId: briefAssignmentsTable.crewId,
            decision: briefAssignmentsTable.decision,
          })
          .from(briefAssignmentsTable)
          .where(
            and(
              eq(briefAssignmentsTable.briefId, id),
              inArray(
                briefAssignmentsTable.freelancerUserId,
                [...new Set(explicitDeliveryRecipients.map((r) => r.freelancerUserId))],
              ),
            ),
          );
        const acceptedKeys = new Set(
          accepted
            .filter((row) => row.decision === "accepted")
            .map((row) => `${row.freelancerUserId}\u0000${row.crewId}`),
        );
        dispatchRecipients = selectBriefDispatchRecipients({
          newlyAdded: assignmentSync.newRecipientRecipients,
          explicit: explicitDeliveryRecipients,
          action: notificationType,
          acceptedKeys,
        });
      }
      const dispatch = explicitEmailDispatch || effectiveProjectStatus === "active"
        ? await claimBriefDispatches(
            tx,
            id,
            dispatchRecipients,
            explicitEmailDispatch,
          )
        : null;
      return {
        brief: inserted[0] ?? null,
        newRecipientUserIds: assignmentSync.newRecipientUserIds,
        dispatch,
      };
    });
    if ("forbidden" in result) {
      res.status(403).json({ ok: false, error: "Not your brief." });
      return;
    }
    if ("terminalProject" in result) {
      res.status(409).json({ ok: false, error: "Completed and archived projects are read-only." });
      return;
    }
    // Planning/draft saves only populate the durable outbox. An active
    // project claims newly pending deliveries post-commit.
    if (
      explicitEmailDispatch &&
      result.dispatch
    ) {
      const delivery = result.dispatch.newRecipientUserIds.length
        ? await dispatchBriefRequestEmails({
            briefId: id,
            ownerUserId: userId,
            newRecipientUserIds: result.dispatch.newRecipientUserIds,
            notificationType,
          })
        : { sent: 0, skipped: 0, outcomes: [] };
      if (delivery.outcomes.length > 0) {
        await completeBriefDispatches(id, delivery.outcomes);
      }
      res.json({
        ok: true,
        brief: result.brief,
        delivery: summarizeBriefDelivery(result.dispatch, delivery),
      });
      return;
    }
    if (result.dispatch?.newRecipientUserIds.length) {
      void (async () => {
        const delivery = await dispatchBriefRequestEmails({
          briefId: id, ownerUserId: userId,
          newRecipientUserIds: result.dispatch!.newRecipientUserIds,
          notificationType,
        });
        await completeBriefDispatches(id, delivery.outcomes);
      })().catch((err: unknown) => logger.error(
        { err: err instanceof Error ? err.message : String(err), briefId: id },
        "portal brief dispatch completion failed",
      ));
    }
    res.json({ ok: true, brief: result.brief });
  } catch (err) {
    const cause =
      err instanceof Error && "cause" in err
        ? (err as Error & { cause?: unknown }).cause
        : undefined;
    logger.error(
      {
        err,
        cause,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
      "portal briefs POST failed",
    );
    res.status(500).json({ ok: false, error: "Could not save brief." });
  }
});

/** GET /api/portal/briefs/:id/assignments
 *  Producer-only. Returns every brief_assignments row for the brief so
 *  the Crew Report can render Requested / Accepted / Declined pills next
 *  to each freelancer the producer requested. The polled rows include
 *  `decision`, `decidedAt` and `createdAt` so the client can derive a
 *  "no reply" status for assignments that have been pending for more
 *  than 24 hours without forcing a server-side timer. */
router.get(
  "/portal/briefs/:id/assignments",
  requireEmployee,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const id = String(req.params.id ?? "");
    try {
      const briefRows = await db
        .select({
          ownerUserId: projectBriefsTable.ownerUserId,
          data: projectBriefsTable.data,
        })
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, id))
        .limit(1);
      if (briefRows.length === 0) {
        res.status(404).json({ ok: false, error: "Brief not found." });
        return;
      }
      if (briefRows[0].ownerUserId !== userId) {
        res.status(403).json({ ok: false, error: "Not your brief." });
        return;
      }
      const assignments = await db
        .select({
          id: briefAssignmentsTable.id,
          freelancerUserId: briefAssignmentsTable.freelancerUserId,
          crewId: briefAssignmentsTable.crewId,
          decision: briefAssignmentsTable.decision,
          shiftResponses: briefAssignmentsTable.shiftResponses,
          declineReason: briefAssignmentsTable.declineReason,
          decidedAt: briefAssignmentsTable.decidedAt,
          acceptedGigId: briefAssignmentsTable.acceptedGigId,
          createdAt: briefAssignmentsTable.createdAt,
          updatedAt: briefAssignmentsTable.updatedAt,
        })
        .from(briefAssignmentsTable)
        .where(eq(briefAssignmentsTable.briefId, id))
        .orderBy(briefAssignmentsTable.createdAt);
      res.json({
        ok: true,
        assignments: assignments.map((assignment) => ({
          ...assignment,
          isCurrent: isCurrentBriefRecipient(
            briefRows[0].data,
            assignment.crewId,
            assignment.freelancerUserId,
          ),
        })),
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "portal briefs/:id/assignments GET failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not load assignments." });
    }
  },
);

/** DELETE /api/portal/briefs/:id/assignments/:crewId
 * Producer-only cancellation of one exact unanswered freelancer role slot.
 * The brief row lock serializes this with freelancer responses, so a request
 * cannot be accepted while it is being cancelled. `mode: "remove"` is the
 * explicit role-slot removal action. It unlinks the active project/brief role
 * while retaining accepted assignment, gig, and work-history rows. */
router.delete(
  "/portal/briefs/:id/assignments/:crewId",
  requireEmployee,
  requireUnarchivedBriefProject,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const briefId = String(req.params.id ?? "");
    const crewId = String(req.params.crewId ?? "");
    const body = (req.body ?? {}) as {
      freelancerUserId?: unknown;
      mode?: unknown;
    };
    const mode = body.mode === undefined ? "cancel" : body.mode;
    const freelancerUserId =
      typeof body.freelancerUserId === "string"
        ? body.freelancerUserId.trim()
        : "";
    if (
      !crewId ||
      crewId.length > 255 ||
      !freelancerUserId ||
      freelancerUserId.length > 255 ||
      (mode !== "cancel" && mode !== "remove")
    ) {
      res.status(400).json({
        ok: false,
        error:
          mode !== "cancel" && mode !== "remove"
            ? 'mode must be "cancel" or "remove".'
            : "Invalid assignment identity.",
      });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(PROJECT_BRIEF_PROVENANCE_LOCK);
        // Lock project first and brief second after reading the immutable
        // relation. Autosaves use the same lock order, preventing a stale
        // project payload from racing this removal.
        const [briefLink] = await tx
          .select({
            projectId: projectBriefsTable.projectId,
            ownerUserId: projectBriefsTable.ownerUserId,
          })
          .from(projectBriefsTable)
          .where(eq(projectBriefsTable.id, briefId))
          .limit(1);
        if (!briefLink) return { kind: "no_brief" as const };
        let project: ProjectRow | null = null;
        if (briefLink.projectId) {
          const [lockedProject] = await tx
            .select()
            .from(projectsTable)
            .where(eq(projectsTable.id, briefLink.projectId))
            .for("update")
            .limit(1);
          if (!lockedProject) return { kind: "no_project" as const };
          project = lockedProject;
          if (
            isProjectArchived(lockedProject) ||
            ["completed", "archived"].includes(
              deriveLegacyProjectStatus(lockedProject),
            )
          ) {
            return { kind: "terminal" as const };
          }
        }
        const [brief] = await tx
          .select({
            ownerUserId: projectBriefsTable.ownerUserId,
            data: projectBriefsTable.data,
          })
          .from(projectBriefsTable)
          .where(eq(projectBriefsTable.id, briefId))
          .for("update")
          .limit(1);
        if (!brief) return { kind: "no_brief" as const };
        if (brief.ownerUserId !== userId) return { kind: "forbidden" as const };
        const [assignment] = await tx
          .select({
            id: briefAssignmentsTable.id,
            decision: briefAssignmentsTable.decision,
            acceptedGigId: briefAssignmentsTable.acceptedGigId,
            crewId: briefAssignmentsTable.crewId,
            freelancerUserId: briefAssignmentsTable.freelancerUserId,
          })
          .from(briefAssignmentsTable)
          .where(
            and(
              eq(briefAssignmentsTable.briefId, briefId),
              eq(briefAssignmentsTable.crewId, crewId),
              eq(
                briefAssignmentsTable.freelancerUserId,
                freelancerUserId,
              ),
            ),
          )
          .limit(1);
        if (!assignment) return { kind: "no_assignment" as const };
        if (mode === "remove") {
          // The assignment identity must still be the active brief recipient
          // while the brief row is locked. A stale producer action must not
          // remove a role after a replacement has taken over the brief slot.
          if (!isCurrentBriefRecipient(brief.data, crewId, freelancerUserId)) {
            return { kind: "stale_assignment" as const };
          }
          // A crew id is the immutable role-slot identity. Do not let a stale
          // UI remove a replacement that now occupies the same slot.
          if (project) {
            const currentFreelancer = projectCrewFreelancerForRole(
              project.data,
              crewId,
            );
            if (currentFreelancer && currentFreelancer !== freelancerUserId) {
              return { kind: "stale_assignment" as const };
            }
          }
          const nextBrief = removeCrewFromBriefData(brief.data, crewId);
          await tx
            .update(projectBriefsTable)
            .set({ data: nextBrief.data, updatedAt: sql`now()` })
            .where(eq(projectBriefsTable.id, briefId));
          if (project) {
            await tx
              .update(projectsTable)
              .set({
                data: removeCrewFromProjectData(project.data, crewId),
                updatedAt: sql`now()`,
              })
              .where(eq(projectsTable.id, project.id));
          }
          return { kind: "removed" as const };
        }
        if (!canCancelBriefAssignment(assignment)) {
          return { kind: "not_pending" as const };
        }
        const slotAssignments = await tx
          .select({
            freelancerUserId: briefAssignmentsTable.freelancerUserId,
            decision: briefAssignmentsTable.decision,
          })
          .from(briefAssignmentsTable)
          .where(
            and(
              eq(briefAssignmentsTable.briefId, briefId),
              eq(briefAssignmentsTable.crewId, crewId),
            ),
          );
        const hasOtherPendingCandidate = slotAssignments.some(
          (candidate) =>
            candidate.freelancerUserId !== freelancerUserId &&
            candidate.decision === "pending",
        );
        const hasOtherCurrentCandidate = recipientsFromBriefData(brief.data).some(
          (recipient) =>
            recipient.crewId === crewId &&
            recipient.freelancerUserId !== freelancerUserId,
        );
        const briefRoleMatches =
          isCurrentBriefRecipient(brief.data, crewId, freelancerUserId) &&
          !hasOtherCurrentCandidate;
        const projectFreelancer = project
          ? projectCrewFreelancerForRole(project.data, crewId)
          : null;
        // A pending cancellation only removes the whole role when this
        // account is still the active project assignment. If another
        // candidate occupies the same brief slot, or the project role is
        // unassigned/different, remove only this exact pending candidate so
        // the role remains available for replacement.
        const removeActiveRole =
          briefRoleMatches &&
          !hasOtherPendingCandidate &&
          (!project || projectFreelancer === freelancerUserId);
        const nextBrief = removeCancelledAssignmentFromBriefData(
          brief.data,
          crewId,
          freelancerUserId,
        );
        const exactCandidateBrief = removeCrewAssignmentFromBriefData(
          nextBrief.data,
          crewId,
          freelancerUserId,
        ).data;
        await tx
          .delete(briefAssignmentsTable)
          .where(eq(briefAssignmentsTable.id, assignment.id));
        await tx
          .update(projectBriefsTable)
          .set({
            data: removeActiveRole
              ? removeCrewFromBriefData(brief.data, crewId).data
              : exactCandidateBrief,
            updatedAt: sql`now()`,
          })
          .where(eq(projectBriefsTable.id, briefId));
        if (project) {
          await tx
            .update(projectsTable)
            .set({
              data: removeActiveRole
                ? removeCrewFromProjectData(project.data, crewId)
                : markCrewAssignmentRemovedFromProjectData(
                    project.data,
                    crewId,
                    freelancerUserId,
                  ),
              updatedAt: sql`now()`,
            })
            .where(eq(projectsTable.id, project.id));
        }
        return { kind: "cancelled", roleRemoved: removeActiveRole } as const;
      });
      if (result.kind === "no_brief" || result.kind === "no_assignment") {
        res.status(404).json({ ok: false, error: "Assignment not found." });
        return;
      }
      if (result.kind === "forbidden") {
        res.status(403).json({ ok: false, error: "Not your brief." });
        return;
      }
      if (result.kind === "no_project") {
        res.status(404).json({ ok: false, error: "Project not found." });
        return;
      }
      if (result.kind === "terminal") {
        res.status(409).json({
          ok: false,
          error: "Completed and archived projects are read-only.",
        });
        return;
      }
      if (result.kind === "stale_assignment") {
        res.status(409).json({
          ok: false,
          error: "The role has already been assigned to another freelancer.",
        });
        return;
      }
      if (result.kind === "not_pending") {
        res.status(409).json({
          ok: false,
          error: "Only pending requests can be cancelled.",
        });
        return;
      }
      if (result.kind === "removed") {
        try {
          await notifyCrewResponse(briefId);
        } catch (err) {
          logger.error(
            {
              briefId,
              err: err instanceof Error ? err.message : String(err),
            },
            "portal crew removal notification failed",
          );
        }
        res.json({
          ok: true,
          removed: true,
          briefId,
          crewId,
          mode: "remove",
        });
        return;
      }
      if (result.roleRemoved) {
        try {
          await notifyCrewResponse(briefId);
        } catch (err) {
          logger.error(
            {
              briefId,
              err: err instanceof Error ? err.message : String(err),
            },
            "portal crew cancellation notification failed",
          );
        }
      }
      res.json({
        ok: true,
        cancelled: true,
        roleRemoved: result.roleRemoved,
        briefId,
        crewId,
      });
    } catch (err) {
      logger.error(
        {
          briefId,
          crewId,
          freelancerUserId,
          err: err instanceof Error ? err.message : String(err),
        },
        "portal assignment cancellation failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not cancel assignment." });
    }
  },
);

/** POST /api/portal/briefs/:id/respond  body: { decision?, shiftResponses? }
 *  Freelancer-only. Records accept/decline. On acceptance, the server
 *  creates the frozen snapshot and canonical gig from the locked brief.
 *
 *  First-to-accept-wins: each brief is treated as a single slot shared
 *  by all of its candidates. The whole respond flow runs inside a
 *  transaction with the brief row locked (`SELECT … FOR UPDATE`) so
 *  two concurrent accepts can't both win. On accept we look at the
 *  sibling assignments:
 *
 *    - If any sibling already holds `decision = 'accepted'`, this caller
 *      lost the race. Their row is set to `'too_late'` and the response
 *      includes `tooLate: true` so the freelancer UI can show a
 *      "position filled" banner instead of a confirmation.
 *    - Otherwise this caller wins. Their row is set to `'accepted'` and
 *      every other sibling whose decision is still `'pending'` is
 *      atomically downgraded to `'too_late'` so the producer's poll
 *      and the other freelancers' next sync both see a single winner.
 *
 *  Decline keeps its old behaviour — it only mutates the caller's row
 *  and never touches siblings. `'too_late'` itself is *not* a valid
 *  client-supplied decision; only the server may write it. */
router.post(
  "/portal/briefs/:id/respond",
  requireSignedIn,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const briefId = String(req.params.id ?? "");
    const body = (req.body ?? {}) as {
      decision?: unknown;
      shiftResponses?: unknown;
      assignmentId?: unknown;
      declineReason?: unknown;
    };
    const requestedDecision =
      typeof body.decision === "string" ? body.decision : "";
    const hasShiftResponses = body.shiftResponses !== undefined;
    const submittedShiftResponses = body.shiftResponses;
    const declineReason = parseDeclineReason(body.declineReason);
    if (!declineReason.ok) {
      res.status(400).json({
        ok: false,
        error: "declineReason must be a string of at most 1000 characters or null.",
      });
      return;
    }
    if (
      hasShiftResponses &&
      (!submittedShiftResponses ||
        typeof submittedShiftResponses !== "object" ||
        Array.isArray(submittedShiftResponses) ||
        Object.values(submittedShiftResponses as Record<string, unknown>).some(
          (value) => value !== "accepted" && value !== "declined",
        ))
    ) {
      res.status(400).json({ ok: false, error: "Invalid shift responses." });
      return;
    }
    if (!hasShiftResponses && !VALID_DECISIONS.has(requestedDecision)) {
      res.status(400).json({ ok: false, error: "Invalid decision." });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        // Lock the brief row for the lifetime of the transaction so
        // sibling-checking and sibling-updates can't race. The lock
        // is on `project_briefs`, not on `brief_assignments`, because
        // there is exactly one brief per slot — locking it serialises
        // every accept attempt for that slot regardless of which
        // freelancer they belong to.
        const briefRows = await tx
          .select({
            id: projectBriefsTable.id,
            projectName: projectBriefsTable.projectName,
            client: projectBriefsTable.client,
            venue: projectBriefsTable.venue,
            startDate: projectBriefsTable.startDate,
            endDate: projectBriefsTable.endDate,
            data: projectBriefsTable.data,
          })
          .from(projectBriefsTable)
          .where(eq(projectBriefsTable.id, briefId))
          .for("update")
          .limit(1);
        if (briefRows.length === 0) {
          return { kind: "no_brief" as const };
        }
        const briefRow = briefRows[0];
        // Always pull the full sibling set up-front so we can enforce
        // the state-transition rules below regardless of which branch
        // we end up in. The cost is one extra SELECT per request,
        // which is cheap relative to the FOR UPDATE lock we already
        // hold on the brief row.
        const siblings = await tx
          .select({
            id: briefAssignmentsTable.id,
            freelancerUserId: briefAssignmentsTable.freelancerUserId,
            decision: briefAssignmentsTable.decision,
            crewId: briefAssignmentsTable.crewId,
            acceptedGigId: briefAssignmentsTable.acceptedGigId,
            acceptedSnapshotTrusted:
              briefAssignmentsTable.acceptedSnapshotTrusted,
          })
          .from(briefAssignmentsTable)
          .where(eq(briefAssignmentsTable.briefId, briefId));
        const ownRows = siblings.filter((s) => s.freelancerUserId === userId);
        const requestedAssignmentId =
          typeof body.assignmentId === "string" && body.assignmentId
            ? body.assignmentId
            : null;
        // Old single-role links do not carry assignmentId. Do not silently
        // select one when this account now holds multiple role slots.
        const myRow = requestedAssignmentId
          ? ownRows.find((s) => s.id === requestedAssignmentId)
          : ownRows.length === 1 ? ownRows[0] : undefined;
        if (!myRow) return { kind: "no_assignment" as const };
        if (myRow.decision === "cancelled") {
          return { kind: "cancelled" as const };
        }
        if (
          !isCurrentBriefRecipient(briefRow.data, myRow.crewId, userId)
        ) {
          return { kind: "replaced" as const };
        }
        // Accepted assignments removed from the active roster remain in this
        // table for history. They must not retain brief access or block a
        // replacement freelancer from winning the role slot.
        const slotSiblings = siblings.filter(
          (s) =>
            s.crewId === myRow.crewId &&
            isCurrentBriefRecipient(briefRow.data, s.crewId, s.freelancerUserId),
        );
        // Older server-created assignments can have a trusted snapshot and
        // acceptedGigId but no exact gig link. Adopt only that exact,
        // same-user, same-brief unlinked row. Never scan broadly by
        // (brief,user): manually linked gigs must not be overwritten/deleted.
        if (
          myRow.acceptedSnapshotTrusted &&
          myRow.acceptedGigId
        ) {
          await tx
            .update(gigsTable)
            .set({
              briefAssignmentId: myRow.id,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(gigsTable.id, myRow.acceptedGigId),
                eq(gigsTable.briefId, briefId),
                eq(gigsTable.freelancerUserId, userId),
                isNull(gigsTable.briefAssignmentId),
              ),
            );
        }
        const ownedGigCondition = eq(
          gigsTable.briefAssignmentId,
          myRow.id,
        );
        const shiftResponses = hasShiftResponses
          ? submittedShiftResponses as ShiftResponses
          : null;
        const responseSlots = responseSlotsForAssignment(briefRow, myRow.crewId);
        if (shiftResponses) {
          const expected = new Set(responseSlots);
          const actual = Object.keys(shiftResponses);
          if (actual.length !== expected.size || actual.some((slot) => !expected.has(slot))) {
            return { kind: "invalid_shift_responses" as const };
          }
        }
        const decision = shiftResponses
          ? Object.values(shiftResponses).some((value) => value === "accepted")
            ? "accepted"
            : "declined"
          : requestedDecision;
        // `too_late` is terminal from the freelancer's perspective —
        // the producer (or a future "reopen slot" feature) is the only
        // legitimate way out of it. Reject any client-driven attempt
        // to leave that state, including a re-accept retry from a
        // stale tab. We surface a friendly tooLate response so the
        // existing client UI keeps showing the "Position filled"
        // banner instead of flickering.
        if (myRow.decision === "too_late") {
          const updated = await tx
            .update(briefAssignmentsTable)
            .set({
              shiftResponses: null,
              declineReason: null,
              updatedAt: sql`now()`,
            })
            .where(eq(briefAssignmentsTable.id, myRow.id))
            .returning();
          return {
            kind: "ok" as const,
            assignment: updated[0] ?? myRow,
            tooLate: true,
          };
        }
        if (decision !== "accepted") {
          // Decline / pending — no sibling effects, *except* when the
          // caller is the current winner undoing their accept. In that
          // case we reopen every sibling we previously swept to
          // `too_late` so they have a fair chance again. Already-
          // declined siblings are left declined (they made an explicit
          // choice to opt out and shouldn't be silently re-prompted).
          const wasWinnerUndoing =
            myRow.decision === "accepted" && decision === "pending";
          if (wasWinnerUndoing) {
            await tx
              .update(briefAssignmentsTable)
              .set({
                decision: "pending",
                decidedAt: sql`now()`,
                shiftResponses: null,
                declineReason: null,
                updatedAt: sql`now()`,
              })
              .where(
                and(
                  eq(briefAssignmentsTable.briefId, briefId),
                  eq(briefAssignmentsTable.decision, "too_late"),
                  inArray(
                    briefAssignmentsTable.id,
                    slotSiblings.map((s) => s.id),
                  ),
                ),
              );
          }
          const updated = await tx
            .update(briefAssignmentsTable)
            .set({
              decision,
              decidedAt: sql`now()`,
              acceptedSnapshot: null,
              acceptedSnapshotTrusted: false,
              acceptedGigId: null,
              ...(shiftResponses
                ? { shiftResponses }
                : decision === "pending" ? { shiftResponses: null } : {}),
              declineReason:
                decision === "declined" ? declineReason.value ?? null : null,
              updatedAt: sql`now()`,
            })
            .where(eq(briefAssignmentsTable.id, myRow.id))
            .returning();
          if (updated.length === 0) return { kind: "no_assignment" as const };
          // If the freelancer is undoing a win (was accepted, now
          // declining or going back to pending), tear down the gig
          // we previously materialised for them. Scoped to (brief,
          // freelancer) so a manually-created gig with the same brief
          // link from a different flow stays untouched.
          if (myRow.decision === "accepted") {
            await tx
              .delete(gigsTable)
              .where(ownedGigCondition);
          }
          return {
            kind: "ok" as const,
            assignment: updated[0],
            tooLate: false,
            gig: null,
          };
        }
        // Accept path — check whether anyone else has already won. We
        // explicitly exclude the caller's own row from the "anyone
        // already accepted" check so a no-op double-accept by the same
        // freelancer (e.g. a stale tab or a retried request) is treated
        // as success, not as a too-late race against themselves.
        const winner = slotSiblings.find(
          (s) =>
            s.decision === "accepted" && s.freelancerUserId !== userId,
        );
        if (winner) {
          // Lost the race — record `too_late` for this caller.
          const updated = await tx
            .update(briefAssignmentsTable)
            .set({
              decision: "too_late",
              decidedAt: sql`now()`,
              acceptedSnapshot: null,
              acceptedSnapshotTrusted: false,
              acceptedGigId: null,
              shiftResponses: null,
              declineReason: null,
              updatedAt: sql`now()`,
            })
            .where(eq(briefAssignmentsTable.id, myRow.id))
            .returning();
          return {
            kind: "ok" as const,
            assignment: updated[0],
            tooLate: true,
          };
        }
        // Sweep every other still-pending sibling to `too_late`.
        // Already-declined siblings are left alone — a freelancer who
        // said no shouldn't have their decision rewritten just because
        // another candidate happened to accept later. We do this
        // *before* materialising the gig so the assignment row update
        // below carries the resolved gig id in a single write.
        await tx
          .update(briefAssignmentsTable)
          .set({
            decision: "too_late",
            decidedAt: sql`now()`,
            shiftResponses: null,
            declineReason: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(briefAssignmentsTable.briefId, briefId),
              eq(briefAssignmentsTable.decision, "pending"),
                inArray(
                  briefAssignmentsTable.id,
                  slotSiblings.map((s) => s.id),
                ),
            ),
          );
        // Materialise the booking. The gig row is the source of truth
        // for the freelancer's calendar, the producer's booked roster
        // (via the brief link), and the directory's `booked` status
        // pill. Idempotency is keyed on the exact brief assignment
        // — *not* on the client-supplied `acceptedGigId` — so a
        // retried accept (or an "acknowledge changes" re-confirm) can
        // never produce duplicate rows or overwrite somebody else's
        // gig via a guessed id (IDOR). The FOR UPDATE lock on the
        // brief row earlier in this transaction serialises every
        // accept attempt for the same role slot, so
        // the SELECT-then-INSERT/UPDATE pattern below cannot race.
        const baseGigFields = gigFieldsFromBrief(briefRow, myRow.crewId);
        const acceptedDates = Array.from(
          new Set(
            Object.entries(shiftResponses ?? {})
              .filter(([, value]) => value === "accepted")
              .map(([slot]) => slot.slice(0, 10)),
          ),
        ).sort();
        const gigFields = {
          ...baseGigFields,
          ...(shiftResponses ? { assignedDates: acceptedDates } : {}),
        };
        const existingGig = await tx
          .select({ id: gigsTable.id, status: gigsTable.status })
          .from(gigsTable)
          .where(ownedGigCondition)
          .limit(1);
        let gigRow;
        if (existingGig.length > 0) {
          // Preserve any status the freelancer has progressed the gig
          // into via PATCH /portal/gigs/:id (`done` / `invoiced` /
          // `paid`). A re-accept or acknowledge must never silently
          // downgrade a paid gig back to `confirmed`.
          const preserveStatus = TERMINAL_GIG_STATUSES.has(
            existingGig[0].status,
          );
          const setClause: Record<string, unknown> = {
            ...gigFields,
            briefAssignmentId: myRow.id,
            updatedAt: sql`now()`,
          };
          if (!preserveStatus) setClause.status = "confirmed";
          const updatedGig = await tx
            .update(gigsTable)
            .set(setClause)
            .where(eq(gigsTable.id, existingGig[0].id))
            .returning();
          gigRow = updatedGig[0] ?? null;
        } else {
          // Always server-generate the id. The client's
          // `acceptedGigId` is treated as advisory at most — we never
          // trust it as a target row id because doing so would let
          // any signed-in caller overwrite arbitrary rows by guessing
          // an id (IDOR). The new id is returned to the client which
          // swaps its optimistic local gig over.
          const newId = `gig_${randomUUID()}`;
          const insertedGig = await tx
            .insert(gigsTable)
            .values({
              id: newId,
              freelancerUserId: userId,
              briefId,
              briefAssignmentId: myRow.id,
              ...gigFields,
              status: "confirmed",
            })
            .returning();
          gigRow = insertedGig[0] ?? null;
        }
        // Mark this row accepted. We carry the *resolved* server gig
        // id (from the insert/update above) so the assignments table
        // and the gigs table never disagree on which gig represents
        // this booking — even when the client's optimistic id was
        // ignored. We refuse to fall back to the client-supplied
        // `acceptedGigId` here: doing so would re-introduce a path
        // where the assignment row points at a row id the client
        // chose, blunting the IDOR fix above. If gig materialisation
        // somehow returned null we abort the whole transaction.
        if (!gigRow) {
          throw new Error(
            "gig materialisation returned no row; aborting accept",
          );
        }
        const updated = await tx
          .update(briefAssignmentsTable)
          .set({
            decision: "accepted",
            decidedAt: sql`now()`,
            acceptedSnapshot: buildServerAcceptedSnapshot(
              briefRow.data,
              myRow.crewId,
            ),
            acceptedSnapshotTrusted: true,
            acceptedGigId: gigRow.id,
            ...(shiftResponses ? { shiftResponses } : {}),
            declineReason:
              shiftResponses &&
              Object.values(shiftResponses).includes("declined")
                ? declineReason.value ?? null
                : null,
            updatedAt: sql`now()`,
          })
          .where(eq(briefAssignmentsTable.id, myRow.id))
          .returning();
        return {
          kind: "ok" as const,
          assignment: updated[0],
          tooLate: false,
          gig: gigRow,
        };
      });
      if (result.kind === "no_brief") {
        res.status(404).json({ ok: false, error: "Brief not found." });
        return;
      }
      if (result.kind === "no_assignment") {
        res
          .status(404)
          .json({ ok: false, error: "No assignment for this user." });
        return;
      }
      if (result.kind === "cancelled") {
        res.status(410).json({
          ok: false,
          code: "request_cancelled",
          error: "Denne forespørselen er ikke lenger gyldig.",
        });
        return;
      }
      if (result.kind === "replaced") {
        res.status(410).json({
          ok: false,
          code: "request_replaced",
          error: "Denne forespørselen er ikke lenger aktuell.",
        });
        return;
      }
      if (result.kind === "invalid_shift_responses") {
        res.status(400).json({
          ok: false,
          error: "Shift responses must cover every current assignment slot.",
        });
        return;
      }
      // The transaction has committed before this notification is published.
      // Failure to refresh an optional producer stream must not turn a
      // durable freelancer response into a 500.
      try {
        await notifyCrewResponse(briefId);
      } catch (err) {
        logger.error(
          {
            briefId,
            err: err instanceof Error ? err.message : String(err),
          },
          "portal crew response notification failed",
        );
      }
      res.json({
        ok: true,
        assignment: result.assignment,
        tooLate: result.tooLate,
        // Hand back the gig the transaction materialised (or null on
        // a decline / pending / too-late branch). The freelancer
        // client uses `gig.id` to swap its optimistic local gig over
        // to the server's authoritative id, since the server now
        // ignores the client's suggested `acceptedGigId` to defeat
        // the IDOR-overwrite vector.
        gig: result.gig ?? null,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "portal briefs/:id/respond POST failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not record your response." });
    }
  },
);

/** GET /api/portal/briefs/:id/catering
 *  Producer-side catering aggregation. Joins this brief's confirmed
 *  freelancer gigs against their portal profiles, classifies free-text
 *  dietary needs into the canonical category set, and returns a
 *  per-day breakdown the producer's Catering tab can render directly.
 *
 *  Auth model matches the rest of the producer-only endpoints:
 *  signed-in user must own the brief. The freelancer-side
 *  `/portal/briefs/:id` GET is owner-OR-assigned, but catering is a
 *  back-of-house planning view that no individual freelancer should
 *  see (it would leak other crew members' allergens), so we restrict
 *  to the owner.
 *
 *  We pull only the `confirmed` / `done` / `invoiced` / `paid`
 *  statuses — `invited` gigs are speculative pre-acceptance shells
 *  that shouldn't be counted as confirmed mouths to feed. */
const COUNTABLE_GIG_STATUSES: ReadonlySet<string> = new Set([
  "confirmed",
  "done",
  "invoiced",
  "paid",
]);

router.get(
  "/portal/briefs/:id/catering",
  requireEmployee,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const id = String(req.params.id ?? "");
    try {
      // Owner check first — cheaper than the join, fails fast on
      // bad ids and prevents the second query from running for an
      // unauthorised reader.
      const briefRows = await db
        .select({
          id: projectBriefsTable.id,
          ownerUserId: projectBriefsTable.ownerUserId,
          venue: projectBriefsTable.venue,
          projectName: projectBriefsTable.projectName,
        })
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, id))
        .limit(1);
      const brief = briefRows[0];
      if (!brief) {
        res.status(404).json({ ok: false, error: "Brief not found." });
        return;
      }
      if (brief.ownerUserId !== userId) {
        res.status(403).json({ ok: false, error: "Not your brief." });
        return;
      }

      // One join: every countable gig on this brief, plus the
      // freelancer's profile fields we actually need. Profile may
      // be missing (`leftJoin`) — a freelancer can accept a brief
      // before filling out their portal profile, in which case we
      // surface them in `missing.profileless` so the producer can
      // nudge them.
      const rows = await db
        .select({
          gigId: gigsTable.id,
          gigRole: gigsTable.role,
          assignedDates: gigsTable.assignedDates,
          status: gigsTable.status,
          freelancerUserId: gigsTable.freelancerUserId,
          // Profile-side (nullable on left join):
          profileFullName: freelancerProfilesTable.fullName,
          profileDietary: freelancerProfilesTable.dietary,
          profileAllergies: freelancerProfilesTable.allergies,
        })
        .from(gigsTable)
        .leftJoin(
          freelancerProfilesTable,
          eq(gigsTable.freelancerUserId, freelancerProfilesTable.userId),
        )
        .where(eq(gigsTable.briefId, id));

      type Person = {
        userId: string;
        name: string;
        role: string;
        tags: DietaryTag[];
        allergens: string[];
      };
      // Day → freelancerUserId → person. The nested map dedupes by
      // person-per-day so a freelancer with two gigs on the same brief
      // on the same date (e.g. a recurring show with split roles)
      // still counts as ONE meal — chefs plate once per mouth, not
      // per booking row. Without this, `total`, `byCategory`, and
      // the allergen roster would all be over-inflated, and the
      // duplicate row would also break React keys downstream.
      const dayMap = new Map<string, Map<string, Person>>();
      const profileless: Array<{ name: string; userId: string }> = [];

      for (const r of rows) {
        if (!COUNTABLE_GIG_STATUSES.has(r.status)) continue;
        const dates = Array.isArray(r.assignedDates) ? r.assignedDates : [];
        if (dates.length === 0) continue;
        const hasProfile = typeof r.profileFullName === "string";
        const name =
          (hasProfile ? r.profileFullName : null) ||
          // Fall back to a short id stub so the chef sees *something*
          // attached to the count rather than a blank row. Producer
          // can chase the freelancer to fill their profile.
          `Crew member ${r.freelancerUserId.slice(-4)}`;
        if (!hasProfile) {
          profileless.push({ name, userId: r.freelancerUserId });
        }
        const person: Person = {
          userId: r.freelancerUserId,
          name,
          role: r.gigRole ?? "",
          tags: classifyDietary(r.profileDietary),
          allergens: splitAllergens(r.profileAllergies),
        };
        for (const d of dates) {
          // Normalise date column → ISO YYYY-MM-DD string. Drizzle's
          // `date` type returns a string already, but defensively
          // coerce anything weird.
          const iso =
            typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
          let perDay = dayMap.get(iso);
          if (!perDay) {
            perDay = new Map<string, Person>();
            dayMap.set(iso, perDay);
          }
          // Set is idempotent on the same userId — second gig for
          // the same person on the same day is a no-op for counting.
          // We DO overwrite the role with the most recent gig's role
          // so the chef sees *some* role label rather than nothing,
          // but no row is duplicated.
          perDay.set(r.freelancerUserId, person);
        }
      }

      const days = Array.from(dayMap.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([iso, peopleMap]) => {
          const people = Array.from(peopleMap.values());
          const byCategory: Record<DietaryTag, number> = {
            vegetarian: 0,
            vegan: 0,
            halal: 0,
            "gluten-free": 0,
            "lactose-free": 0,
          };
          // People with at least one allergen — surfaced as a
          // separate row per person so the chef can scan them.
          const allergenRoster: Array<{
            userId: string;
            name: string;
            role: string;
            allergens: string[];
          }> = [];
          for (const p of people) {
            for (const t of p.tags) byCategory[t] += 1;
            if (p.allergens.length > 0) {
              allergenRoster.push({
                userId: p.userId,
                name: p.name,
                role: p.role,
                allergens: p.allergens,
              });
            }
          }
          return {
            date: iso,
            total: people.length,
            byCategory,
            allergenRoster: allergenRoster.sort((a, b) =>
              a.name.localeCompare(b.name),
            ),
          };
        });

      // Dedupe profileless by userId — a single crew member with
      // multiple gigs (rare but possible across recurring shows in
      // the same brief) should only show up once in the nudge list.
      const seen = new Set<string>();
      const profilelessUnique = profileless.filter((p) => {
        if (seen.has(p.userId)) return false;
        seen.add(p.userId);
        return true;
      });

      res.json({
        ok: true,
        brief: {
          id: brief.id,
          projectName: brief.projectName,
          venue: brief.venue,
        },
        days,
        categories: DIETARY_TAGS,
        missing: {
          profileless: profilelessUnique,
        },
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), briefId: id },
        "portal briefs/:id/catering GET failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not load catering data." });
    }
  },
);

/** GET /api/portal/briefs/:id/hotel — owner-only.
 *  Returns the hotel-logistics view for the brief's confirmed crew:
 *  for each gig (countable status only), the freelancer's name, role,
 *  hotel-needed flag, derived-or-explicit check-in/out dates, and the
 *  pairing inputs the producer needs (room-share preference, gender).
 *
 *  Owner-only because exposing other crew members' room-share or
 *  gender preferences to peers would be a privacy leak — the hotel
 *  view is an internal back-of-house tool, not a roster page. The
 *  pairing engine itself ships in Slice B; for now this endpoint
 *  returns the raw inputs only so Slice A can render the list.
 *
 *  Date derivation rule: if `gig.checkInDate` is null we use
 *  `min(assignedDates)`; if `gig.checkOutDate` is null we use
 *  `max(assignedDates) + 1 day` (hotel-style "the night after the
 *  last show"). Producer overrides via PATCH always win. */
router.get(
  "/portal/briefs/:id/hotel",
  requireEmployee,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const id = String(req.params.id ?? "");
    try {
      const briefRows = await db
        .select({
          id: projectBriefsTable.id,
          ownerUserId: projectBriefsTable.ownerUserId,
          venue: projectBriefsTable.venue,
          projectName: projectBriefsTable.projectName,
        })
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, id))
        .limit(1);
      const brief = briefRows[0];
      if (!brief) {
        res.status(404).json({ ok: false, error: "Brief not found." });
        return;
      }
      if (brief.ownerUserId !== userId) {
        res.status(403).json({ ok: false, error: "Not your brief." });
        return;
      }

      const rows = await db
        .select({
          gigId: gigsTable.id,
          gigRole: gigsTable.role,
          assignedDates: gigsTable.assignedDates,
          status: gigsTable.status,
          hotelRequired: gigsTable.hotelRequired,
          checkInDate: gigsTable.checkInDate,
          checkOutDate: gigsTable.checkOutDate,
          freelancerUserId: gigsTable.freelancerUserId,
          // Profile-side (nullable on left join) — same access pattern
          // as the catering endpoint: profileless freelancers still
          // get listed so the producer can chase their preferences.
          profileFullName: freelancerProfilesTable.fullName,
          profilePhone: freelancerProfilesTable.phone,
          profileRoomShare: freelancerProfilesTable.roomShare,
          profileGender: freelancerProfilesTable.gender,
        })
        .from(gigsTable)
        .leftJoin(
          freelancerProfilesTable,
          eq(gigsTable.freelancerUserId, freelancerProfilesTable.userId),
        )
        .where(eq(gigsTable.briefId, id));

      // Pull this brief's locked room assignments alongside the
      // pairing inputs. Locks pin specific freelancers into specific
      // rooms; the engine fills the rest deterministically. We
      // accept locks that reference a freelancer no longer on the
      // brief (gig dropped after a lock was set) and silently ignore
      // them — `assignRooms` only honours locks for ids that appear
      // in the people list.
      const lockRows = await db
        .select({
          freelancerUserId: briefRoomAssignmentsTable.freelancerUserId,
          roomKey: briefRoomAssignmentsTable.roomKey,
        })
        .from(briefRoomAssignmentsTable)
        .where(eq(briefRoomAssignmentsTable.briefId, id));

      // Per-gig rows → per-PERSON aggregation. A single freelancer can
      // hold multiple gigs on the same brief (e.g. "Sound Engineer"
      // Mon–Wed plus "Backline Tech" Thu–Fri) and the hotel front
      // desk only cares about the human, not how many roles they're
      // booked for. Aggregating here keeps:
      //   - the rooming list, pairing engine, and lock/swap payloads
      //     all unique-by-`freelancerUserId` (the lock endpoint
      //     rejects duplicates with a 400, which would otherwise
      //     surface as a confusing producer-side failure);
      //   - the producer's "needs hotel" toggle visually consistent
      //     across re-renders (one row per person, not one per role).
      // The matching cascade in the PATCH below ensures that toggling
      // the consolidated row writes through to ALL of the freelancer's
      // gigs on this brief.
      type AggRow = {
        gigId: string;
        freelancerUserId: string;
        name: string;
        roles: string[];
        hotelRequired: boolean;
        checkInDate: string | null;
        checkOutDate: string | null;
        checkInExplicit: boolean;
        checkOutExplicit: boolean;
        roomShare: "twin" | "single" | "either";
        gender: "" | "female" | "male" | "other";
        phone: string;
        profileless: boolean;
      };
      const aggByUser = new Map<string, AggRow>();
      for (const r of rows) {
        if (!COUNTABLE_GIG_STATUSES.has(r.status)) continue;
        const dates: string[] = (Array.isArray(r.assignedDates)
          ? r.assignedDates
          : []
        )
          .map((d) =>
            typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10),
          )
          .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso))
          .sort();
        const minIso = dates[0] ?? null;
        const maxIso = dates[dates.length - 1] ?? null;
        // "Check-out is the morning after the last working day" —
        // standard touring convention. Compute via UTC to avoid
        // timezone day-shift on the producer's browser later.
        let derivedCheckOut: string | null = null;
        if (maxIso) {
          const d = new Date(`${maxIso}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 1);
          derivedCheckOut = d.toISOString().slice(0, 10);
        }
        const hasProfile = typeof r.profileFullName === "string";
        const name =
          (hasProfile ? r.profileFullName : null) ||
          `Crew member ${r.freelancerUserId.slice(-4)}`;
        // Drizzle's `date` column returns a string in "YYYY-MM-DD"
        // form, but be defensive — coerce anything else to null.
        const ci =
          typeof r.checkInDate === "string"
            ? r.checkInDate.slice(0, 10)
            : null;
        const co =
          typeof r.checkOutDate === "string"
            ? r.checkOutDate.slice(0, 10)
            : null;
        const resolvedCheckIn = ci ?? minIso;
        const resolvedCheckOut = co ?? derivedCheckOut;

        const existing = aggByUser.get(r.freelancerUserId);
        if (!existing) {
          aggByUser.set(r.freelancerUserId, {
            // Representative gigId for PATCH targeting. Stable choice:
            // smallest gigId lexicographically (computed via Math.min
            // on the second pass below). Initialised here to the first
            // gig we see, then narrowed.
            gigId: r.gigId,
            freelancerUserId: r.freelancerUserId,
            name,
            roles: r.gigRole ? [r.gigRole] : [],
            hotelRequired: !!r.hotelRequired,
            checkInDate: resolvedCheckIn,
            checkOutDate: resolvedCheckOut,
            checkInExplicit: ci !== null,
            checkOutExplicit: co !== null,
            roomShare:
              r.profileRoomShare === "twin" ||
              r.profileRoomShare === "single"
                ? r.profileRoomShare
                : "either",
            gender:
              r.profileGender === "female" ||
              r.profileGender === "male" ||
              r.profileGender === "other"
                ? r.profileGender
                : "",
            phone: typeof r.profilePhone === "string" ? r.profilePhone : "",
            profileless: !hasProfile,
          });
        } else {
          // Pick the lexicographically smallest gigId so PATCH
          // targeting is deterministic across reloads.
          if (r.gigId < existing.gigId) existing.gigId = r.gigId;
          // Merge roles, dedup, preserve insertion order.
          if (r.gigRole && !existing.roles.includes(r.gigRole)) {
            existing.roles.push(r.gigRole);
          }
          // hotelRequired is OR — if the producer flagged ANY of the
          // person's gigs as needing a hotel, the person needs one.
          existing.hotelRequired = existing.hotelRequired || !!r.hotelRequired;
          // Earliest check-in / latest check-out across the union of
          // gigs. An explicit override on either gig wins over an
          // auto-derived value via simple min/max — overrides only
          // tighten the window, they don't expand it past where the
          // person is actually working.
          if (
            resolvedCheckIn &&
            (!existing.checkInDate || resolvedCheckIn < existing.checkInDate)
          ) {
            existing.checkInDate = resolvedCheckIn;
          }
          if (
            resolvedCheckOut &&
            (!existing.checkOutDate || resolvedCheckOut > existing.checkOutDate)
          ) {
            existing.checkOutDate = resolvedCheckOut;
          }
          // "Explicit" sticks if ANY gig had an override — UI uses
          // this to show the "auto" hint, and we want to suppress
          // that hint if the producer has touched the value at all.
          existing.checkInExplicit = existing.checkInExplicit || ci !== null;
          existing.checkOutExplicit = existing.checkOutExplicit || co !== null;
        }
      }
      const crew = Array.from(aggByUser.values())
        .map(({ roles, ...rest }) => ({
          ...rest,
          // Join multi-role labels with " / " — readable on one line
          // in the table and consistent with how producers describe
          // double-booked crew in conversation ("Sound / Backline").
          role: roles.join(" / "),
        }))
        // Stable sort: by name (alphabetical) so re-renders don't
        // shuffle rows under the producer's cursor mid-edit.
        .sort((a, b) => a.name.localeCompare(b.name));

      // Run the pairing engine over the crew that ACTUALLY needs a
      // hotel — skipping room assignments for hotelRequired=false
      // people keeps the engine output focused and avoids burning
      // room numbers on local crew. The result is keyed by
      // freelancerUserId so we can merge it back onto the per-row
      // shape the UI consumes.
      const pairingPeople: PairingPerson[] = crew
        .filter((c) => c.hotelRequired)
        .map((c) => ({
          freelancerUserId: c.freelancerUserId,
          name: c.name,
          checkInDate: c.checkInDate,
          checkOutDate: c.checkOutDate,
          roomShare: c.roomShare as RoomShare,
          gender: c.gender as PairingGender,
        }));
      const assignments = assignRooms(pairingPeople, lockRows);
      const assignmentByUser = new Map(
        assignments.map((a) => [a.freelancerUserId, a]),
      );
      const crewWithRooms = crew.map((c) => {
        const a = assignmentByUser.get(c.freelancerUserId);
        return {
          ...c,
          // roomKey is null for crew not in the pairing set (i.e.
          // hotelRequired=false). UI keys off this to know whether
          // to render a room badge or not.
          roomKey: a?.roomKey ?? null,
          roomLocked: a?.locked ?? false,
        };
      });

      res.json({
        ok: true,
        brief: {
          id: brief.id,
          projectName: brief.projectName,
          venue: brief.venue,
        },
        crew: crewWithRooms,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), briefId: id },
        "portal briefs/:id/hotel GET failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not load hotel data." });
    }
  },
);

/** PATCH /api/portal/briefs/:id/hotel/:gigId — owner-only.
 *  Producer-side update of the hotel flags on a single gig under
 *  their own brief. Body fields (all optional, partial update):
 *  - hotelRequired: boolean    — flips the per-crew "needs a hotel".
 *  - checkInDate:   string|null — explicit ISO override (null reverts
 *                                 to the auto-derived value).
 *  - checkOutDate:  string|null — same, for check-out.
 *
 *  We re-verify ownership AND that the gig genuinely belongs to this
 *  brief (`brief_id = :id`) — not just the gig id — so a producer
 *  can't update a gig from somebody else's brief by guessing its id
 *  (closes IDOR vector). The freelancer's own
 *  `PATCH /portal/gigs/:id` route deliberately does NOT accept these
 *  fields because hotel logistics are producer-controlled. */
router.patch(
  "/portal/briefs/:id/hotel/:gigId",
  requireEmployee,
  requireUnarchivedBriefProject,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const briefId = String(req.params.id ?? "");
    const gigId = String(req.params.gigId ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;

    // ISO date validator — strict shape AND calendar-real check.
    // The regex catches "2025-02-31"-style format-valid-but-impossible
    // dates by round-tripping through Date (which silently rolls them
    // forward into the next month). Without the round-trip we'd push
    // a bad value to Postgres and bubble back as a 500.
    const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
    function parseDateField(raw: unknown):
      | { ok: true; value: string | null }
      | { ok: false } {
      if (raw === null) return { ok: true, value: null };
      if (typeof raw !== "string") return { ok: false };
      const trimmed = raw.trim();
      if (trimmed === "") return { ok: true, value: null };
      if (!ISO_RE.test(trimmed)) return { ok: false };
      // Calendar-real check: parse as UTC, then re-format and compare.
      // Date silently overflows invalid combos (Feb 31 → Mar 3) so
      // a mismatch means the input wasn't a real calendar date.
      const d = new Date(`${trimmed}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return { ok: false };
      if (d.toISOString().slice(0, 10) !== trimmed) return { ok: false };
      return { ok: true, value: trimmed };
    }

    const patch: Record<string, unknown> = { updatedAt: sql`now()` };
    if (body.hotelRequired !== undefined) {
      // Strict boolean — string "false" or numeric 0 in JSON should
      // be rejected, not silently coerced. Producers PATCH this from
      // the UI as a real boolean; anything else is a client bug.
      if (typeof body.hotelRequired !== "boolean") {
        res
          .status(400)
          .json({ ok: false, error: "hotelRequired must be a boolean." });
        return;
      }
      patch.hotelRequired = body.hotelRequired;
      // Toggling the legacy boolean off should also clear hotelDates,
      // otherwise the per-day picker on the next refresh would
      // re-light all the saved nights and contradict the boolean.
      if (body.hotelRequired === false && body.hotelDates === undefined) {
        patch.hotelDates = [];
      }
    }
    if (body.hotelDates !== undefined) {
      // Per-day hotel selection from the Crew tab's phase quick-pick.
      // Strict array-of-ISO-date validation; empty array clears the
      // person's hotel and also flips hotelRequired false so the
      // pairing engine drops them from the rooming list.
      if (!Array.isArray(body.hotelDates)) {
        res
          .status(400)
          .json({ ok: false, error: "hotelDates must be an array." });
        return;
      }
      const cleaned: string[] = [];
      for (const raw of body.hotelDates) {
        const parsed = parseDateField(raw);
        if (!parsed.ok || parsed.value === null) {
          res
            .status(400)
            .json({ ok: false, error: "hotelDates contains invalid date." });
          return;
        }
        if (!cleaned.includes(parsed.value)) cleaned.push(parsed.value);
      }
      cleaned.sort();
      // Defence-in-depth: hotelDates must be a subset of the gig's
      // assignedDates. The UI enforces this with phase-overlap
      // filtering, but a buggy / malicious client could still POST
      // a hotel night for a day the person isn't on call. Reject
      // those instead of silently storing them, otherwise the
      // pairing engine and the catering totals would disagree on
      // who's actually on site.
      if (cleaned.length > 0) {
        const guardRows = await db
          .select({ assignedDates: gigsTable.assignedDates })
          .from(gigsTable)
          .where(eq(gigsTable.id, gigId))
          .limit(1);
        const assigned = new Set(
          (guardRows[0]?.assignedDates ?? []).map((d) =>
            typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10),
          ),
        );
        const stray = cleaned.filter((d) => !assigned.has(d));
        if (stray.length > 0) {
          res.status(400).json({
            ok: false,
            error:
              "hotelDates must be a subset of the gig's working days.",
          });
          return;
        }
      }
      patch.hotelDates = cleaned;
      // Keep hotelRequired in lockstep with hotelDates: any night
      // → true; zero nights → false. The producer never edits the
      // boolean independently anymore (the UI only shows the picker)
      // so this guarantees the two columns can't drift.
      if (body.hotelRequired === undefined) {
        patch.hotelRequired = cleaned.length > 0;
      }
    }
    if (body.checkInDate !== undefined) {
      const parsed = parseDateField(body.checkInDate);
      if (!parsed.ok) {
        res
          .status(400)
          .json({ ok: false, error: "Invalid checkInDate." });
        return;
      }
      patch.checkInDate = parsed.value;
    }
    if (body.checkOutDate !== undefined) {
      const parsed = parseDateField(body.checkOutDate);
      if (!parsed.ok) {
        res
          .status(400)
          .json({ ok: false, error: "Invalid checkOutDate." });
        return;
      }
      patch.checkOutDate = parsed.value;
    }
    // Cross-field check: when BOTH dates are supplied in the same
    // request, reject impossible ranges (check-out before check-in).
    // We don't fetch existing values for the single-field case —
    // producers may legitimately edit one date at a time and fix the
    // pair on the next save.
    if (
      typeof patch.checkInDate === "string" &&
      typeof patch.checkOutDate === "string" &&
      (patch.checkOutDate as string) <= (patch.checkInDate as string)
    ) {
      res.status(400).json({
        ok: false,
        error: "checkOutDate must be after checkInDate.",
      });
      return;
    }
    // No accepted fields → noop (don't bump updatedAt for an empty
    // request — saves a write and avoids polluting the audit trail).
    if (Object.keys(patch).length === 1) {
      res.status(400).json({ ok: false, error: "No updatable fields." });
      return;
    }

    try {
      // Owner check + brief membership in one query — do this BEFORE
      // touching the gig so unauthorised callers get a clean 403/404
      // and never trigger a DB write.
      const briefRows = await db
        .select({ ownerUserId: projectBriefsTable.ownerUserId })
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, briefId))
        .limit(1);
      const brief = briefRows[0];
      if (!brief) {
        res.status(404).json({ ok: false, error: "Brief not found." });
        return;
      }
      if (brief.ownerUserId !== userId) {
        res.status(403).json({ ok: false, error: "Not your brief." });
        return;
      }
      const updated = await db
        .update(gigsTable)
        .set(patch)
        .where(and(eq(gigsTable.id, gigId), eq(gigsTable.briefId, briefId)))
        .returning({
          id: gigsTable.id,
          hotelRequired: gigsTable.hotelRequired,
          hotelDates: gigsTable.hotelDates,
          checkInDate: gigsTable.checkInDate,
          checkOutDate: gigsTable.checkOutDate,
        });
      if (updated.length === 0) {
        res
          .status(404)
          .json({ ok: false, error: "Gig not found on this brief." });
        return;
      }
      res.json({ ok: true, gig: updated[0] });
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          briefId,
          gigId,
        },
        "portal briefs/:id/hotel/:gigId PATCH failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not update hotel data." });
    }
  },
);

/** PATCH /api/portal/briefs/:id/roster/:gigId/dates — owner-only.
 *  Producer-side update of the working-day list on a single gig
 *  under their own brief. Body: `{ assignedDates: string[] }` — a
 *  full replacement (not a partial / merge). The producer's UI
 *  already knows the full intended set, and a replace semantic
 *  avoids the "did the empty array mean clear or no-op?" ambiguity
 *  a partial would have.
 *
 *  Validation: each date must be a real ISO YYYY-MM-DD AND fall
 *  within the brief's window with ±7 days of slack on each side.
 *  The slack covers travel days (load-in the day before, breakdown
 *  the day after) and the occasional "I picked up keys yesterday"
 *  case without letting a stray YYYY-MM-DD typo land Postgres a
 *  date in 2099. Briefs without a startDate/endDate skip the
 *  window check (we can't validate against a missing window).
 *
 *  Role slots are independent: only the targeted gig is updated. */
router.patch(
  "/portal/briefs/:id/roster/:gigId/dates",
  requireEmployee,
  requireUnarchivedBriefProject,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const briefId = String(req.params.id ?? "");
    const gigId = String(req.params.gigId ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

    // Body shape check first — array of strings, ≤ 366 entries (same
    // hard cap as the brief-window expansion above so a malicious
    // client can't post a 100k-element array and OOM the server).
    const raw = body.assignedDates;
    if (!Array.isArray(raw)) {
      res.status(400).json({
        ok: false,
        error: "assignedDates must be an array of YYYY-MM-DD strings.",
      });
      return;
    }
    if (raw.length > 366) {
      res.status(400).json({
        ok: false,
        error: "assignedDates is capped at 366 entries.",
      });
      return;
    }
    // Per-element parse + dedupe + sort. Bad entries reject the whole
    // request rather than silently dropping — the producer should
    // know if a typo made it through their UI.
    const parsed: string[] = [];
    const seen = new Set<string>();
    for (const v of raw) {
      if (typeof v !== "string" || !ISO_RE.test(v)) {
        res.status(400).json({
          ok: false,
          error: "Each date must be a YYYY-MM-DD string.",
        });
        return;
      }
      const d = new Date(`${v}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
        res
          .status(400)
          .json({ ok: false, error: `Invalid calendar date: ${v}.` });
        return;
      }
      if (seen.has(v)) continue;
      seen.add(v);
      parsed.push(v);
    }
    parsed.sort();

    try {
      const briefRows = await db
        .select({
          ownerUserId: projectBriefsTable.ownerUserId,
          startDate: projectBriefsTable.startDate,
          endDate: projectBriefsTable.endDate,
        })
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, briefId))
        .limit(1);
      const brief = briefRows[0];
      if (!brief) {
        res.status(404).json({ ok: false, error: "Brief not found." });
        return;
      }
      if (brief.ownerUserId !== userId) {
        res.status(403).json({ ok: false, error: "Not your brief." });
        return;
      }
      // Window check: only enforce when both endpoints are set, so
      // briefs that haven't been fully scoped yet still accept date
      // edits (the producer commonly assigns days before locking the
      // window). ±7d slack for travel/breakdown days.
      if (brief.startDate && brief.endDate) {
        const startMs = new Date(`${brief.startDate}T00:00:00Z`).getTime();
        const endMs = new Date(`${brief.endDate}T00:00:00Z`).getTime();
        const slack = 7 * 24 * 60 * 60 * 1000;
        const minMs = startMs - slack;
        const maxMs = endMs + slack;
        for (const d of parsed) {
          const t = new Date(`${d}T00:00:00Z`).getTime();
          if (t < minMs || t > maxMs) {
            res.status(400).json({
              ok: false,
              error: `Date ${d} is outside the brief's window (±7 days).`,
            });
            return;
          }
        }
      }

      const updated = await db
        .update(gigsTable)
        .set({ assignedDates: parsed, updatedAt: sql`now()` })
        .where(and(eq(gigsTable.id, gigId), eq(gigsTable.briefId, briefId)))
        .returning({
          id: gigsTable.id,
          assignedDates: gigsTable.assignedDates,
        });
      if (updated.length === 0) {
        res
          .status(404)
          .json({ ok: false, error: "Gig not found on this brief." });
        return;
      }
      res.json({ ok: true, gig: updated[0] });
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          briefId,
          gigId,
        },
        "portal briefs/:id/roster/:gigId/dates PATCH failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not update working days." });
    }
  },
);

/** Shared owner-check + countable-crew loader for the lock/unlock/swap
 *  family. Returns the brief's owner-verified set of hotel-eligible
 *  crew (gigs in a countable status with `hotelRequired=true`), or
 *  null+sets the response if anything's off. Centralised because all
 *  three mutation endpoints need the exact same gate. */
async function loadHotelCrewForOwner(
  briefId: string,
  userId: string,
  res: import("express").Response,
): Promise<Set<string> | null> {
  const briefRows = await db
    .select({ ownerUserId: projectBriefsTable.ownerUserId })
    .from(projectBriefsTable)
    .where(eq(projectBriefsTable.id, briefId))
    .limit(1);
  const brief = briefRows[0];
  if (!brief) {
    res.status(404).json({ ok: false, error: "Brief not found." });
    return null;
  }
  if (brief.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: "Not your brief." });
    return null;
  }
  // Lock targets must (a) be on this brief and (b) actually need a
  // hotel. We don't allow locking local crew into a room — that
  // would just confuse the rooming sheet.
  const eligibleRows = await db
    .select({
      freelancerUserId: gigsTable.freelancerUserId,
      status: gigsTable.status,
      hotelRequired: gigsTable.hotelRequired,
    })
    .from(gigsTable)
    .where(eq(gigsTable.briefId, briefId));
  const eligible = new Set<string>();
  for (const r of eligibleRows) {
    if (!COUNTABLE_GIG_STATUSES.has(r.status)) continue;
    if (!r.hotelRequired) continue;
    eligible.add(r.freelancerUserId);
  }
  return eligible;
}

/** GET /api/portal/briefs/:id/roster — owner-only.
 *  Producer-side unified roster for the Crew Report tab. Returns one
 *  row per (gig, freelancer) for every gig on this brief that is
 *  either still being negotiated (`invited`) or already booked
 *  (`confirmed` / `done` / `invoiced` / `paid`). Used by the Crew
 *  Report's roster panel to give project leaders a single overview
 *  of "who do we have, what days are they working, do they need a
 *  hotel, do they have allergies".
 *
 *  Composition: this is essentially `/hotel` + `/catering` glued
 *  together, but we deliberately keep it as a third endpoint rather
 *  than fattening either one — the roster has different audience
 *  (every PM, not just the back-office hotel/catering workflows) and
 *  different status filter (includes `invited`, which the other two
 *  exclude). Owner-only for the same privacy reason as the hotel
 *  endpoint: it surfaces other crew members' allergens and hotel
 *  preferences, which would leak between freelancers.
 *
 *  Also returns `projectDays` — the canonical list of every day in
 *  the brief's window (inclusive) — so the Crew tab's day-chip
 *  pills can render even for people who have no assigned days yet.
 *  Without this the client would have to expand the brief's start/
 *  end dates itself, which it can already do but having one
 *  authoritative source per brief avoids drift between Crew /
 *  Hotel / Catering tabs. */
const ROSTER_GIG_STATUSES: ReadonlySet<string> = new Set([
  "invited",
  "confirmed",
  "done",
  "invoiced",
  "paid",
]);

/** Expand an inclusive date range into the list of YYYY-MM-DD strings
 *  it covers. Returns `[]` when either endpoint is missing or the
 *  range is reversed (we don't try to be clever — the brief author
 *  is expected to set the dates correctly). UTC arithmetic only,
 *  matching the rest of this file's date handling. */
function expandDateRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
): string[] {
  if (!startIso || !endIso) return [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  if (end.getTime() < start.getTime()) return [];
  const out: string[] = [];
  const cursor = new Date(start.getTime());
  // Hard cap at 366 days so a typo in the brief (start 2025, end 2035)
  // can't blow up the response. Real productions max out at a few weeks.
  for (let i = 0; i < 366; i++) {
    out.push(cursor.toISOString().slice(0, 10));
    if (cursor.getTime() === end.getTime()) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const ROSTER_SHIFT_PHASE_KEY =
  /^\d{4}-\d{2}-\d{2}::(setup|rehearsal|show|downrig)$/;
const ROSTER_HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Read the producer-owned timing fields from a brief assignment without
 * trusting JSONB contents. Older briefs did not persist these fields, so
 * their empty values are deliberately retained in the roster wire shape. */
function rosterAssignmentTiming(value: unknown): {
  callTime: string;
  offTime: string;
  assignedShiftPhases: string[];
  assignedShiftTimes: Record<string, { startTime: string; endTime: string }>;
  assignedShiftWindows: Record<
    string,
    Array<{ startTime: string; endTime: string }>
  >;
  assignedShiftTasks: Record<string, string[]>;
} {
  const assignment =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const assignedShiftPhases = Array.isArray(assignment.assignedShiftPhases)
    ? assignment.assignedShiftPhases
        .filter(
          (phase): phase is string =>
            typeof phase === "string" && ROSTER_SHIFT_PHASE_KEY.test(phase),
        )
        .sort()
    : [];
  const assignedShiftTimes: Record<
    string,
    { startTime: string; endTime: string }
  > = {};
  const assignedShiftWindows: Record<
    string,
    Array<{ startTime: string; endTime: string }>
  > = {};
  const assignedShiftTasks: Record<string, string[]> = {};
  if (
    assignment.assignedShiftTimes &&
    typeof assignment.assignedShiftTimes === "object" &&
    !Array.isArray(assignment.assignedShiftTimes)
  ) {
    for (const [key, timing] of Object.entries(
      assignment.assignedShiftTimes as Record<string, unknown>,
    )) {
      if (
        !ROSTER_SHIFT_PHASE_KEY.test(key) ||
        !timing ||
        typeof timing !== "object" ||
        Array.isArray(timing)
      ) {
        continue;
      }
      const candidate = timing as Record<string, unknown>;
      if (
        typeof candidate.startTime === "string" &&
        ROSTER_HHMM.test(candidate.startTime) &&
        typeof candidate.endTime === "string" &&
        ROSTER_HHMM.test(candidate.endTime)
      ) {
        assignedShiftTimes[key] = {
          startTime: candidate.startTime,
          endTime: candidate.endTime,
        };
      }
    }
  }
  if (
    assignment.assignedShiftWindows &&
    typeof assignment.assignedShiftWindows === "object" &&
    !Array.isArray(assignment.assignedShiftWindows)
  ) {
    for (const [key, rawWindows] of Object.entries(
      assignment.assignedShiftWindows as Record<string, unknown>,
    )) {
      if (!ROSTER_SHIFT_PHASE_KEY.test(key) || !Array.isArray(rawWindows)) {
        continue;
      }
      const windows = rawWindows.flatMap((rawWindow) => {
        if (
          !rawWindow ||
          typeof rawWindow !== "object" ||
          Array.isArray(rawWindow)
        ) {
          return [];
        }
        const candidate = rawWindow as Record<string, unknown>;
        return typeof candidate.startTime === "string" &&
          ROSTER_HHMM.test(candidate.startTime) &&
          typeof candidate.endTime === "string" &&
          ROSTER_HHMM.test(candidate.endTime)
          ? [{
              startTime: candidate.startTime,
              endTime: candidate.endTime,
            }]
          : [];
      }).slice(0, 12);
      if (windows.length) assignedShiftWindows[key] = windows;
    }
  }
  if (
    assignment.assignedShiftTasks &&
    typeof assignment.assignedShiftTasks === "object" &&
    !Array.isArray(assignment.assignedShiftTasks)
  ) {
    for (const [key, rawTasks] of Object.entries(
      assignment.assignedShiftTasks as Record<string, unknown>,
    )) {
      if (!ROSTER_SHIFT_PHASE_KEY.test(key) || !Array.isArray(rawTasks)) continue;
      const tasks = rawTasks
        .filter((task): task is string => typeof task === "string")
        .map((task) => task.trim())
        .filter(Boolean)
        .slice(0, 20);
      if (tasks.length) assignedShiftTasks[key] = tasks;
    }
  }
  return {
    callTime:
      typeof assignment.callTime === "string" &&
      ROSTER_HHMM.test(assignment.callTime)
        ? assignment.callTime
        : "",
    offTime:
      typeof assignment.offTime === "string" && ROSTER_HHMM.test(assignment.offTime)
        ? assignment.offTime
        : "",
    assignedShiftPhases,
    assignedShiftTimes,
    assignedShiftWindows,
    assignedShiftTasks,
  };
}

router.get(
  "/portal/briefs/:id/roster",
  requireEmployee,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const id = String(req.params.id ?? "");
    try {
      const briefRows = await db
        .select({
          id: projectBriefsTable.id,
          ownerUserId: projectBriefsTable.ownerUserId,
          venue: projectBriefsTable.venue,
          projectName: projectBriefsTable.projectName,
          startDate: projectBriefsTable.startDate,
          endDate: projectBriefsTable.endDate,
          data: projectBriefsTable.data,
        })
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, id))
        .limit(1);
      const brief = briefRows[0];
      if (!brief) {
        res.status(404).json({ ok: false, error: "Brief not found." });
        return;
      }
      if (brief.ownerUserId !== userId) {
        res.status(403).json({ ok: false, error: "Not your brief." });
        return;
      }
      const assignmentTimingByCrewId = new Map<
        string,
        ReturnType<typeof rosterAssignmentTiming>
      >();
      const briefData =
        brief.data && typeof brief.data === "object" && !Array.isArray(brief.data)
          ? (brief.data as Record<string, unknown>)
          : {};
      if (Array.isArray(briefData.assignments)) {
        for (const assignment of briefData.assignments) {
          if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) {
            continue;
          }
          const rawAssignment = assignment as Record<string, unknown>;
          if (typeof rawAssignment.crewId === "string" && rawAssignment.crewId) {
            assignmentTimingByCrewId.set(
              rawAssignment.crewId,
              rosterAssignmentTiming(rawAssignment),
            );
          }
        }
      }

      // Pull every gig on this brief plus the freelancer profile bits
      // we need for dietary / allergen classification. `leftJoin` so
      // a freelancer who accepted before completing their profile
      // still appears (with `profileless: true`).
      //
      // The Crew & Logistics master sheet uses this endpoint as its
      // single data source, so we also pull the phone + room-pairing
      // profile fields (phone / roomShare / gender / checkIn / checkOut)
      // — same fields the `/hotel` endpoint pulls, just consolidated
      // here so the producer doesn't need to round-trip a second
      // request to render "Phone" and "Roommate" columns.
      const rows = await db
        .select({
          gigId: gigsTable.id,
          briefAssignmentId: gigsTable.briefAssignmentId,
          gigRole: gigsTable.role,
          assignedDates: gigsTable.assignedDates,
          status: gigsTable.status,
          hotelRequired: gigsTable.hotelRequired,
          hotelDates: gigsTable.hotelDates,
          checkInDate: gigsTable.checkInDate,
          checkOutDate: gigsTable.checkOutDate,
          freelancerUserId: gigsTable.freelancerUserId,
          crewId: briefAssignmentsTable.crewId,
          shiftResponses: briefAssignmentsTable.shiftResponses,
          declineReason: briefAssignmentsTable.declineReason,
          profileFullName: freelancerProfilesTable.fullName,
          profileDietary: freelancerProfilesTable.dietary,
          profileAllergies: freelancerProfilesTable.allergies,
          profilePhone: freelancerProfilesTable.phone,
          profileRoomShare: freelancerProfilesTable.roomShare,
          profileGender: freelancerProfilesTable.gender,
        })
        .from(gigsTable)
        .leftJoin(
          freelancerProfilesTable,
          eq(gigsTable.freelancerUserId, freelancerProfilesTable.userId),
        )
        .leftJoin(
          briefAssignmentsTable,
          and(
            eq(briefAssignmentsTable.id, gigsTable.briefAssignmentId),
          ),
        )
        .where(eq(gigsTable.briefId, id));

      // Pull room locks so the master-sheet roommate column reflects
      // any pin the producer set on the Hotel page. Same query as
      // the hotel endpoint above — silently ignored locks for
      // dropped freelancers.
      const lockRows = await db
        .select({
          freelancerUserId: briefRoomAssignmentsTable.freelancerUserId,
          roomKey: briefRoomAssignmentsTable.roomKey,
        })
        .from(briefRoomAssignmentsTable)
        .where(eq(briefRoomAssignmentsTable.briefId, id));

      const crew = rows
        .filter(
          (r) =>
            ROSTER_GIG_STATUSES.has(r.status) &&
            // The roster is an active-role DTO. A confirmed gig remains
            // available in history/payroll, but an accepted assignment whose
            // exact role/account pair is no longer in the brief must not
            // appear in the current producer roster.
            (!r.crewId ||
              isCurrentBriefRecipient(
                brief.data,
                r.crewId,
                r.freelancerUserId,
              )),
        )
        .map((r) => {
          const hasProfile = typeof r.profileFullName === "string";
          const name =
            (hasProfile ? r.profileFullName : null) ||
            // Same fallback as the catering endpoint so a profileless
            // freelancer still shows up readably in the table.
            `Crew member ${r.freelancerUserId.slice(-4)}`;
          const dates: string[] = (
            Array.isArray(r.assignedDates) ? r.assignedDates : []
          )
            .map((d: unknown) =>
              typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10),
            )
            .filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d))
            .sort();
          // Hotel dates — same coercion as assignedDates. Constrained
          // to the assignedDates set defensively (a stale value from
          // before the producer trimmed working days could otherwise
          // include a day the person isn't actually on call).
          const dateSet = new Set(dates);
          const hotelDates: string[] = (
            Array.isArray(r.hotelDates) ? r.hotelDates : []
          )
            .map((d: unknown) =>
              typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10),
            )
            .filter((d: string) =>
              /^\d{4}-\d{2}-\d{2}$/.test(d) && dateSet.has(d),
            )
            .sort();
          // Mirror the hotel endpoint's check-in/-out resolution so
          // the pairing engine sees the same window the rooming list
          // would. Without this, two endpoints could disagree on
          // who's actually overlapping at the hotel.
          const minIso = dates[0] ?? null;
          const maxIso = dates[dates.length - 1] ?? null;
          let derivedCheckOut: string | null = null;
          if (maxIso) {
            const d = new Date(`${maxIso}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + 1);
            derivedCheckOut = d.toISOString().slice(0, 10);
          }
          const ci =
            typeof r.checkInDate === "string"
              ? r.checkInDate.slice(0, 10)
              : null;
          const co =
            typeof r.checkOutDate === "string"
              ? r.checkOutDate.slice(0, 10)
              : null;
          const timing =
            (r.crewId ? assignmentTimingByCrewId.get(r.crewId) : undefined) ??
            rosterAssignmentTiming(null);
          return {
            gigId: r.gigId,
            briefAssignmentId: r.briefAssignmentId,
            crewId: r.crewId,
            freelancerUserId: r.freelancerUserId,
            name,
            role: r.gigRole ?? "",
            status: r.status,
            assignedDates: dates,
            shiftResponses: r.shiftResponses,
            declineReason: r.declineReason,
            hotelRequired: !!r.hotelRequired,
            hotelDates,
            callTime: timing.callTime,
            offTime: timing.offTime,
            assignedShiftPhases: timing.assignedShiftPhases,
            assignedShiftTimes: timing.assignedShiftTimes,
            assignedShiftWindows: timing.assignedShiftWindows,
            assignedShiftTasks: timing.assignedShiftTasks,
            dietaryTags: classifyDietary(r.profileDietary),
            allergens: splitAllergens(r.profileAllergies),
            phone: typeof r.profilePhone === "string" ? r.profilePhone : "",
            profileless: !hasProfile,
            // Internal pairing inputs — stripped from the response
            // below, only used to feed `assignRooms` here. Tucked
            // onto the row so we can group multi-gig people first
            // and then run pairing once on the deduped list.
            _checkInDate: ci ?? minIso,
            _checkOutDate: co ?? derivedCheckOut,
            _roomShare: (r.profileRoomShare === "twin" ||
              r.profileRoomShare === "single"
              ? r.profileRoomShare
              : "either") as RoomShare,
            _gender: (r.profileGender === "female" ||
              r.profileGender === "male" ||
              r.profileGender === "other"
              ? r.profileGender
              : "") as PairingGender,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      // Dedupe to one entry per freelancer for the pairing engine —
      // the engine rejects duplicate ids, and a freelancer with two
      // gigs on the same brief is still one human at the hotel. We
      // OR `hotelRequired` and pick the widest stay window.
      const aggForPairing = new Map<
        string,
        {
          freelancerUserId: string;
          name: string;
          checkInDate: string | null;
          checkOutDate: string | null;
          roomShare: RoomShare;
          gender: PairingGender;
          hotelRequired: boolean;
        }
      >();
      for (const c of crew) {
        const existing = aggForPairing.get(c.freelancerUserId);
        if (!existing) {
          aggForPairing.set(c.freelancerUserId, {
            freelancerUserId: c.freelancerUserId,
            name: c.name,
            checkInDate: c._checkInDate,
            checkOutDate: c._checkOutDate,
            roomShare: c._roomShare,
            gender: c._gender,
            hotelRequired: c.hotelRequired,
          });
        } else {
          existing.hotelRequired = existing.hotelRequired || c.hotelRequired;
          if (
            c._checkInDate &&
            (!existing.checkInDate || c._checkInDate < existing.checkInDate)
          ) {
            existing.checkInDate = c._checkInDate;
          }
          if (
            c._checkOutDate &&
            (!existing.checkOutDate || c._checkOutDate > existing.checkOutDate)
          ) {
            existing.checkOutDate = c._checkOutDate;
          }
        }
      }
      const pairingPeople: PairingPerson[] = Array.from(
        aggForPairing.values(),
      )
        .filter((p) => p.hotelRequired)
        .map((p) => ({
          freelancerUserId: p.freelancerUserId,
          name: p.name,
          checkInDate: p.checkInDate,
          checkOutDate: p.checkOutDate,
          roomShare: p.roomShare,
          gender: p.gender,
        }));
      const assignments = assignRooms(pairingPeople, lockRows);
      // Group people by roomKey so we can compute "roommateName"
      // per row in O(crew). A solo room (roomKey set, only one
      // occupant) yields roommateName=null — UI can still show
      // the room key as "(solo)" if it cares.
      const usersByRoom = new Map<string, string[]>();
      const nameByUser = new Map<string, string>();
      const roomByUser = new Map<string, string>();
      for (const a of assignments) {
        if (!a.roomKey) continue;
        roomByUser.set(a.freelancerUserId, a.roomKey);
        const list = usersByRoom.get(a.roomKey) ?? [];
        list.push(a.freelancerUserId);
        usersByRoom.set(a.roomKey, list);
      }
      for (const c of crew) nameByUser.set(c.freelancerUserId, c.name);

      // Strip the underscore-prefixed pairing inputs and graft on
      // the public `roomKey` + `roommateName` fields the master
      // sheet renders. Keeping these out of the response shape
      // prevents the wire format from leaking the pairing engine's
      // intermediate state.
      const crewOut = crew.map((c) => {
        const {
          _checkInDate: _i,
          _checkOutDate: _o,
          _roomShare: _s,
          _gender: _g,
          ...publicFields
        } = c;
        const roomKey = roomByUser.get(c.freelancerUserId) ?? null;
        let roommateName: string | null = null;
        if (roomKey) {
          const roommates = (usersByRoom.get(roomKey) ?? []).filter(
            (uid) => uid !== c.freelancerUserId,
          );
          // Multi-roommate rooms (3-4 share) join with " / " — keeps
          // the column scannable on one line.
          if (roommates.length > 0) {
            roommateName = roommates
              .map((uid) => nameByUser.get(uid) ?? "?")
              .join(" / ");
          }
        }
        return { ...publicFields, roomKey, roommateName };
      });

      res.json({
        ok: true,
        brief: {
          id: brief.id,
          projectName: brief.projectName,
          venue: brief.venue,
          startDate: brief.startDate ?? null,
          endDate: brief.endDate ?? null,
        },
        crew: crewOut,
        projectDays: expandDateRange(brief.startDate, brief.endDate),
        categories: DIETARY_TAGS,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), briefId: id },
        "portal briefs/:id/roster GET failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not load crew roster." });
    }
  },
);

/** POST /api/portal/briefs/:id/hotel/lock — owner-only.
 *  Locks a set of freelancers (1–4 people) into a single fresh room
 *  on this brief. Use cases:
 *  - Single id: pin a person who must have a private room beyond
 *    what the engine would otherwise suggest.
 *  - Two ids: confirm a producer-picked twin pair (the most common
 *    case — usually the producer is approving an engine suggestion).
 *  - Three or four ids: family/trio rooms (rare but real on small
 *    international tours where two crew share with a partner).
 *
 *  Side-effect: any pre-existing locks involving these freelancers
 *  OR the rooms they currently occupied are cleared first, so the
 *  former roommate of a swapped-in person doesn't end up frozen
 *  alone. The single transaction makes that all-or-nothing. */
router.post(
  "/portal/briefs/:id/hotel/lock",
  requireEmployee,
  requireUnarchivedBriefProject,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const briefId = String(req.params.id ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ids = body.freelancerUserIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 4 ||
      !ids.every((x) => typeof x === "string" && x.length > 0)
    ) {
      res.status(400).json({
        ok: false,
        error: "freelancerUserIds must be 1–4 non-empty strings.",
      });
      return;
    }
    // Dedupe — locking ["A","A"] would create a single-occupant room
    // that *says* "two people" in the audit. Reject as a client bug.
    const unique = Array.from(new Set(ids as string[]));
    if (unique.length !== ids.length) {
      res
        .status(400)
        .json({ ok: false, error: "Duplicate freelancer ids." });
      return;
    }

    try {
      const eligible = await loadHotelCrewForOwner(briefId, userId, res);
      if (!eligible) return;
      for (const id of unique) {
        if (!eligible.has(id)) {
          res.status(400).json({
            ok: false,
            error: "All freelancers must be on this brief and need a hotel.",
          });
          return;
        }
      }

      // Lock the brief row FOR UPDATE inside a transaction, then
      // allocate roomKey + clear stale rows + insert all in the same
      // serialised window. Without this guard two concurrent lock
      // requests on the same brief could each pick `room-N` from a
      // pre-transaction snapshot and merge unrelated groups under
      // the same key. Producers normally edit sequentially, but a
      // double-clicked button or two browser tabs could both fire.
      const newRoomKey = await db.transaction(async (tx) => {
        // Postgres row lock — serialises all hotel mutations for this
        // brief. Released on tx commit/rollback. Cheap because each
        // brief has a single owner.
        await tx.execute(
          sql`SELECT 1 FROM ${projectBriefsTable} WHERE ${projectBriefsTable.id} = ${briefId} FOR UPDATE`,
        );

        // Compute INSIDE the txn so the snapshot is consistent with
        // the writes we're about to do.
        const existingKeys = new Set(
          (
            await tx
              .select({ roomKey: briefRoomAssignmentsTable.roomKey })
              .from(briefRoomAssignmentsTable)
              .where(eq(briefRoomAssignmentsTable.briefId, briefId))
          ).map((r) => r.roomKey),
        );
        let n = 1;
        while (existingKeys.has(`room-${n}`)) n++;
        const allocated = `room-${n}`;

        // Clear any previous locks for these people so re-locking
        // overwrites cleanly. We also clear locks for ANY person who
        // was previously locked into the *same* old rooms as one of
        // the new ids — otherwise their orphan partner stays frozen
        // alone in a now-half-empty locked room.
        const previousRoomsToClear = (
          await tx
            .select({ roomKey: briefRoomAssignmentsTable.roomKey })
            .from(briefRoomAssignmentsTable)
            .where(
              and(
                eq(briefRoomAssignmentsTable.briefId, briefId),
                inArray(briefRoomAssignmentsTable.freelancerUserId, unique),
              ),
            )
        ).map((r) => r.roomKey);

        await tx
          .delete(briefRoomAssignmentsTable)
          .where(
            and(
              eq(briefRoomAssignmentsTable.briefId, briefId),
              inArray(briefRoomAssignmentsTable.freelancerUserId, unique),
            ),
          );
        if (previousRoomsToClear.length > 0) {
          await tx
            .delete(briefRoomAssignmentsTable)
            .where(
              and(
                eq(briefRoomAssignmentsTable.briefId, briefId),
                inArray(
                  briefRoomAssignmentsTable.roomKey,
                  previousRoomsToClear,
                ),
              ),
            );
        }
        await tx.insert(briefRoomAssignmentsTable).values(
          unique.map((freelancerUserId) => ({
            briefId,
            freelancerUserId,
            roomKey: allocated,
            locked: true,
          })),
        );
        return allocated;
      });

      res.json({ ok: true, roomKey: newRoomKey });
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          briefId,
        },
        "portal briefs/:id/hotel/lock failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not lock room." });
    }
  },
);

/** POST /api/portal/briefs/:id/hotel/unlock — owner-only.
 *  Removes the lock for a set of freelancers, returning them to the
 *  pairing engine's pool. The freelancers themselves stay on the
 *  brief — only their lock rows are removed. */
router.post(
  "/portal/briefs/:id/hotel/unlock",
  requireEmployee,
  requireUnarchivedBriefProject,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const briefId = String(req.params.id ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ids = body.freelancerUserIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      !ids.every((x) => typeof x === "string" && x.length > 0)
    ) {
      res.status(400).json({
        ok: false,
        error: "freelancerUserIds must be a non-empty string array.",
      });
      return;
    }
    const unique = Array.from(new Set(ids as string[]));
    try {
      const eligible = await loadHotelCrewForOwner(briefId, userId, res);
      if (!eligible) return;
      // Don't fail the whole call if some ids aren't on the brief —
      // unlocking a stale lock is harmless and matches what the GET
      // endpoint already silently does. We DO still require the
      // caller to own the brief, which the helper above verifies.
      await db
        .delete(briefRoomAssignmentsTable)
        .where(
          and(
            eq(briefRoomAssignmentsTable.briefId, briefId),
            inArray(briefRoomAssignmentsTable.freelancerUserId, unique),
          ),
        );
      res.json({ ok: true });
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          briefId,
        },
        "portal briefs/:id/hotel/unlock failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not unlock room." });
    }
  },
);

/** POST /api/portal/briefs/:id/hotel/swap — owner-only.
 *  Swap two freelancers between their currently-assigned rooms. The
 *  swap also LOCKS every occupant of both affected rooms — without
 *  that, the pairing engine would happily re-pair the unlocked
 *  former roommates on the next read and visually "undo" the swap.
 *  Locking the full room is the right semantics: the producer just
 *  expressed intent over both rooms, so freezing them as a unit
 *  matches what they'd expect.
 *
 *  Both freelancers must be on the brief, both must need a hotel,
 *  and they must currently be in DIFFERENT rooms — same-room swap is
 *  a no-op the UI shouldn't have offered. */
router.post(
  "/portal/briefs/:id/hotel/swap",
  requireEmployee,
  requireUnarchivedBriefProject,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const briefId = String(req.params.id ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const a = body.freelancerUserIdA;
    const b = body.freelancerUserIdB;
    if (
      typeof a !== "string" ||
      typeof b !== "string" ||
      a.length === 0 ||
      b.length === 0 ||
      a === b
    ) {
      res.status(400).json({
        ok: false,
        error: "freelancerUserIdA and freelancerUserIdB must be distinct ids.",
      });
      return;
    }
    try {
      const eligible = await loadHotelCrewForOwner(briefId, userId, res);
      if (!eligible) return;
      if (!eligible.has(a) || !eligible.has(b)) {
        res.status(400).json({
          ok: false,
          error: "Both freelancers must be on this brief and need a hotel.",
        });
        return;
      }

      // Recompute current room assignments by replaying the full GET
      // pipeline (without sending it). This guarantees the swap
      // operates on exactly the same state the producer is looking
      // at — no drift between the displayed rooms and the swap
      // semantics. The cost is one extra round-trip but this is a
      // human-paced action, not a hot path.
      const rows = await db
        .select({
          freelancerUserId: gigsTable.freelancerUserId,
          status: gigsTable.status,
          hotelRequired: gigsTable.hotelRequired,
          assignedDates: gigsTable.assignedDates,
          checkInDate: gigsTable.checkInDate,
          checkOutDate: gigsTable.checkOutDate,
          profileFullName: freelancerProfilesTable.fullName,
          profileRoomShare: freelancerProfilesTable.roomShare,
          profileGender: freelancerProfilesTable.gender,
        })
        .from(gigsTable)
        .leftJoin(
          freelancerProfilesTable,
          eq(gigsTable.freelancerUserId, freelancerProfilesTable.userId),
        )
        .where(eq(gigsTable.briefId, briefId));
      const lockRows = await db
        .select({
          freelancerUserId: briefRoomAssignmentsTable.freelancerUserId,
          roomKey: briefRoomAssignmentsTable.roomKey,
        })
        .from(briefRoomAssignmentsTable)
        .where(eq(briefRoomAssignmentsTable.briefId, briefId));

      const pairingPeople: PairingPerson[] = rows
        .filter(
          (r) =>
            COUNTABLE_GIG_STATUSES.has(r.status) && r.hotelRequired,
        )
        .map((r) => {
          const dates: string[] = (Array.isArray(r.assignedDates)
            ? r.assignedDates
            : []
          )
            .map((d) =>
              typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10),
            )
            .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso))
            .sort();
          const minIso = dates[0] ?? null;
          const maxIso = dates[dates.length - 1] ?? null;
          let derivedCheckOut: string | null = null;
          if (maxIso) {
            const d = new Date(`${maxIso}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() + 1);
            derivedCheckOut = d.toISOString().slice(0, 10);
          }
          const ci =
            typeof r.checkInDate === "string"
              ? r.checkInDate.slice(0, 10)
              : null;
          const co =
            typeof r.checkOutDate === "string"
              ? r.checkOutDate.slice(0, 10)
              : null;
          return {
            freelancerUserId: r.freelancerUserId,
            name:
              (typeof r.profileFullName === "string" && r.profileFullName) ||
              `Crew member ${r.freelancerUserId.slice(-4)}`,
            checkInDate: ci ?? minIso,
            checkOutDate: co ?? derivedCheckOut,
            roomShare:
              (r.profileRoomShare === "twin" ||
              r.profileRoomShare === "single"
                ? r.profileRoomShare
                : "either") as RoomShare,
            gender: ((r.profileGender === "female" ||
            r.profileGender === "male" ||
            r.profileGender === "other"
              ? r.profileGender
              : "") as PairingGender),
          };
        });
      const assignments = assignRooms(pairingPeople, lockRows);
      const roomByUser = new Map(
        assignments.map((x) => [x.freelancerUserId, x.roomKey]),
      );
      const roomA = roomByUser.get(a);
      const roomB = roomByUser.get(b);
      if (!roomA || !roomB) {
        res
          .status(400)
          .json({ ok: false, error: "One or both freelancers have no room." });
        return;
      }
      if (roomA === roomB) {
        res
          .status(400)
          .json({ ok: false, error: "Already in the same room." });
        return;
      }
      // Build the post-swap occupant list per room. Anyone currently
      // in roomA except A stays put; A moves to roomB. Symmetrically
      // for B. Then every occupant of both rooms gets locked into
      // their new placement.
      const occRoomA = assignments
        .filter((x) => x.roomKey === roomA)
        .map((x) => x.freelancerUserId);
      const occRoomB = assignments
        .filter((x) => x.roomKey === roomB)
        .map((x) => x.freelancerUserId);
      const newOccA = occRoomA
        .filter((id) => id !== a)
        .concat(b);
      const newOccB = occRoomB
        .filter((id) => id !== b)
        .concat(a);

      // Apply atomically: clear all current locks for both old rooms
      // AND for every involved freelancer, then insert the post-swap
      // assignments. The double clear is belt-and-braces — it catches
      // edge cases where one of the involved freelancers had a stale
      // lock pointing somewhere else entirely.
      //
      // The transaction starts with a `FOR UPDATE` row lock on the
      // brief — this serialises swap writes against any concurrent
      // lock/unlock/swap on the same brief. The READS above are not
      // inside the txn (re-doing them would double the round-trips
      // for what is already a human-paced action), so a "last write
      // wins" anomaly is theoretically possible if two operators
      // mutate the same brief at the exact same instant — but the
      // single-producer-per-brief workflow makes this vanishingly
      // unlikely, and the producer can fix any bad state with one
      // more click.
      const allInvolvedIds = Array.from(
        new Set([...occRoomA, ...occRoomB, a, b]),
      );
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT 1 FROM ${projectBriefsTable} WHERE ${projectBriefsTable.id} = ${briefId} FOR UPDATE`,
        );
        await tx
          .delete(briefRoomAssignmentsTable)
          .where(
            and(
              eq(briefRoomAssignmentsTable.briefId, briefId),
              inArray(
                briefRoomAssignmentsTable.freelancerUserId,
                allInvolvedIds,
              ),
            ),
          );
        await tx
          .delete(briefRoomAssignmentsTable)
          .where(
            and(
              eq(briefRoomAssignmentsTable.briefId, briefId),
              inArray(briefRoomAssignmentsTable.roomKey, [roomA, roomB]),
            ),
          );
        const inserts = [
          ...newOccA.map((freelancerUserId) => ({
            briefId,
            freelancerUserId,
            roomKey: roomA,
            locked: true,
          })),
          ...newOccB.map((freelancerUserId) => ({
            briefId,
            freelancerUserId,
            roomKey: roomB,
            locked: true,
          })),
        ];
        if (inserts.length > 0) {
          await tx.insert(briefRoomAssignmentsTable).values(inserts);
        }
      });

      res.json({ ok: true });
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          briefId,
        },
        "portal briefs/:id/hotel/swap failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not swap rooms." });
    }
  },
);

/** GET /api/portal/briefs/:id/itinerary
 *  Freelancer-only. Returns the per-day itinerary for the SIGNED-IN
 *  user on this brief: their working days + call/off times, the
 *  brief's schedule phases active that day, and their hotel state
 *  (check-in/out + roomKey + roommate name when locked).
 *
 *  Auth: caller must have a `brief_assignments` row with
 *  decision='accepted' for this brief. Owners are intentionally NOT
 *  allowed — itinerary is a personal view scoped to one freelancer's
 *  working dates and hotel block; the producer already has the
 *  hotel/catering/crew tabs to see the same data at brief level. An
 *  owner who happens to also be an accepted freelancer on their own
 *  brief (rare crossover case) IS allowed because they have a row.
 *
 *  Roommate disclosure: only the OTHER occupant of the caller's
 *  locked room is resolved (display name only, no contact details).
 *  Suggested-but-not-locked pairings show roomKey=null + no roommate
 *  — the freelancer sees "Room TBD" until the producer commits the
 *  pairing in the Hotel tab. */
router.get(
  "/portal/briefs/:id/itinerary",
  requireSignedIn,
  async (req, res) => {
    const userId = (req as unknown as { _userId: string })._userId;
    const id = String(req.params.id ?? "");
    try {
      // Auth + crewId resolution in one shot. We need both the
      // decision (gate) AND the crewId (to find the caller's row in
      // the brief jsonb's assignments[]).
      const assignmentRows = await db
        .select({
          crewId: briefAssignmentsTable.crewId,
          decision: briefAssignmentsTable.decision,
          briefData: projectBriefsTable.data,
        })
        .from(briefAssignmentsTable)
        .innerJoin(
          projectBriefsTable,
          eq(briefAssignmentsTable.briefId, projectBriefsTable.id),
        )
        .where(
          and(
            eq(briefAssignmentsTable.briefId, id),
            eq(briefAssignmentsTable.freelancerUserId, userId),
          ),
        );
      const assignment = assignmentRows.find(
        (candidate) =>
          candidate.decision === "accepted" &&
          isCurrentBriefRecipient(candidate.briefData, candidate.crewId, userId),
      );
      if (
        !assignment ||
        assignment.decision !== "accepted"
      ) {
        // 403, not 404 — the brief exists, the caller just isn't
        // entitled. Same status the rest of the portal uses.
        res.status(403).json({
          ok: false,
          error: "Itinerary is only available after you accept this brief.",
        });
        return;
      }
      const callerCrewId = assignment.crewId;

      // Brief itself for venue + jsonb (schedule + assignments). One
      // round-trip, fail fast if the brief id doesn't resolve.
      const briefRows = await db
        .select()
        .from(projectBriefsTable)
        .where(eq(projectBriefsTable.id, id))
        .limit(1);
      const briefRow = briefRows[0];
      if (!briefRow) {
        res.status(404).json({ ok: false, error: "Brief not found." });
        return;
      }
      const briefData = (briefRow.data ?? {}) as {
        project?: {
          venue?: string;
          date?: string;
          endDate?: string;
          schedule?: Record<string, unknown>;
        };
        assignments?: Array<{
          crewId?: string;
          callTime?: string;
          offTime?: string;
          assignedShiftPhases?: unknown;
          assignedShiftTimes?: unknown;
        }>;
      };

      // Caller's call/off times from data.assignments[]. Match by
      // crewId — the same field the producer uses to address the
      // freelancer in the brief, and the same field BriefDetail.tsx
      // matches against `recipientCrewId` to find "myAssignment".
      let callerAssignment: {
        callTime?: string;
        offTime?: string;
        assignedShiftPhases?: string[];
        assignedShiftTimes?: Record<
          string,
          { startTime?: string; endTime?: string }
        >;
      } | null = null;
      if (callerCrewId && Array.isArray(briefData.assignments)) {
        const a = briefData.assignments.find(
          (x) => x && x.crewId === callerCrewId,
        );
        if (a) {
          callerAssignment = {};
          if (typeof a.callTime === "string" && a.callTime) {
            callerAssignment.callTime = a.callTime;
          }
          if (typeof a.offTime === "string" && a.offTime) {
            callerAssignment.offTime = a.offTime;
          }
          if (Array.isArray(a.assignedShiftPhases)) {
            callerAssignment.assignedShiftPhases =
              a.assignedShiftPhases.filter(
                (key): key is string =>
                  typeof key === "string" &&
                  /^\d{4}-\d{2}-\d{2}::(setup|rehearsal|show|downrig)$/.test(
                    key,
                  ),
              );
          }
          if (
            a.assignedShiftTimes &&
            typeof a.assignedShiftTimes === "object" &&
            !Array.isArray(a.assignedShiftTimes)
          ) {
            callerAssignment.assignedShiftTimes = Object.fromEntries(
              Object.entries(
                a.assignedShiftTimes as Record<string, unknown>,
              ).flatMap(([key, rawTiming]) => {
                if (
                  !/^\d{4}-\d{2}-\d{2}::(setup|rehearsal|show|downrig)$/.test(
                    key,
                  ) ||
                  !rawTiming ||
                  typeof rawTiming !== "object"
                ) {
                  return [];
                }
                const timing = rawTiming as Record<string, unknown>;
                return typeof timing.startTime === "string" &&
                  typeof timing.endTime === "string"
                  ? [
                      [
                        key,
                        {
                          startTime: timing.startTime,
                          endTime: timing.endTime,
                        },
                      ],
                    ]
                  : [];
              }),
            );
          }
        }
      }

      // Caller's countable gigs on this brief. A freelancer can hold
      // multiple gigs (split roles, recurring shows) — aggregate
      // working dates across all of them and OR-merge hotelRequired,
      // mirroring the producer hotel endpoint's per-person view.
      const gigRows = await db
        .select({
          assignedDates: gigsTable.assignedDates,
          hotelRequired: gigsTable.hotelRequired,
          checkInDate: gigsTable.checkInDate,
          checkOutDate: gigsTable.checkOutDate,
        })
        .from(gigsTable)
        .where(
          and(
            eq(gigsTable.briefId, id),
            eq(gigsTable.freelancerUserId, userId),
            inArray(
              gigsTable.status,
              Array.from(COUNTABLE_GIG_STATUSES),
            ),
          ),
        );

      const workingDateSet = new Set<string>();
      let hotelRequired = false;
      const checkInDates: string[] = [];
      const checkOutDates: string[] = [];
      const isoRe = /^\d{4}-\d{2}-\d{2}$/;
      for (const g of gigRows) {
        const dates: string[] = (
          Array.isArray(g.assignedDates) ? g.assignedDates : []
        )
          .map((d: unknown) =>
            typeof d === "string" ? d.slice(0, 10) : String(d).slice(0, 10),
          )
          .filter((iso: string) => isoRe.test(iso));
        for (const d of dates) workingDateSet.add(d);
        if (g.hotelRequired) hotelRequired = true;
        if (typeof g.checkInDate === "string" && isoRe.test(g.checkInDate)) {
          checkInDates.push(g.checkInDate);
        }
        if (typeof g.checkOutDate === "string" && isoRe.test(g.checkOutDate)) {
          checkOutDates.push(g.checkOutDate);
        }
      }

      // Hotel composite: only emit if hotelRequired AND we have both
      // ends of the stay. ISO date strings sort lexically so plain
      // .sort() finds the min/max. min(checkIn) + max(checkOut)
      // mirrors the producer endpoint's per-person aggregation —
      // covers a freelancer with two staggered gigs as one continuous
      // hotel block.
      let callerHotel: {
        checkInDate: string;
        checkOutDate: string;
        roomKey: string | null;
        roomLocked: boolean;
        roommateName: string | null;
      } | null = null;
      if (hotelRequired) {
        const sortedIn = checkInDates.slice().sort();
        const sortedOut = checkOutDates.slice().sort();
        const ci = sortedIn[0] ?? null;
        const co = sortedOut[sortedOut.length - 1] ?? null;
        if (ci && co) {
          // Locked room lookup. brief_room_assignments only stores
          // committed pairings; suggested-but-unlocked rooms aren't
          // here. That's intentional — the freelancer should see a
          // confirmed room or "TBD", never a fluid suggestion that
          // could re-shuffle.
          const myRoomRows = await db
            .select({
              roomKey: briefRoomAssignmentsTable.roomKey,
              locked: briefRoomAssignmentsTable.locked,
            })
            .from(briefRoomAssignmentsTable)
            .where(
              and(
                eq(briefRoomAssignmentsTable.briefId, id),
                eq(briefRoomAssignmentsTable.freelancerUserId, userId),
              ),
            )
            .limit(1);
          let roomKey: string | null = null;
          let roomLocked = false;
          let roommateName: string | null = null;
          const myRoom = myRoomRows[0];
          if (myRoom) {
            roomKey = myRoom.roomKey;
            roomLocked = !!myRoom.locked;
            // Find the OTHER occupant of the same room. Twin = up
            // to one other; we just take the first (sort by user
            // id for determinism in the unlikely 3-person case).
            //
            // SECURITY: inner-join brief_assignments and require the
            // other occupant has decision='accepted' on this same
            // brief. Without this gate, any stale or unaccepted
            // pairing in brief_room_assignments could surface a
            // freelancer's display name to someone they aren't
            // confirmed to be rooming with — defensive even though
            // Feature 3's lock workflow only commits accepted pairs
            // today, future code changes shouldn't be able to
            // re-open the leak window.
            const sameRoomRows = await db
              .select({
                freelancerUserId:
                  briefRoomAssignmentsTable.freelancerUserId,
              })
              .from(briefRoomAssignmentsTable)
              .innerJoin(
                briefAssignmentsTable,
                and(
                  eq(
                    briefAssignmentsTable.briefId,
                    briefRoomAssignmentsTable.briefId,
                  ),
                  eq(
                    briefAssignmentsTable.freelancerUserId,
                    briefRoomAssignmentsTable.freelancerUserId,
                  ),
                ),
              )
              .where(
                and(
                  eq(briefRoomAssignmentsTable.briefId, id),
                  eq(briefRoomAssignmentsTable.roomKey, roomKey),
                  eq(briefAssignmentsTable.decision, "accepted"),
                ),
              );
            const otherIds = sameRoomRows
              .map((r) => r.freelancerUserId)
              .filter((u) => u !== userId)
              .sort();
            const firstOther = otherIds[0];
            if (firstOther) {
              const otherProfile = await db
                .select({ fullName: freelancerProfilesTable.fullName })
                .from(freelancerProfilesTable)
                .where(eq(freelancerProfilesTable.userId, firstOther))
                .limit(1);
              roommateName = otherProfile[0]?.fullName ?? null;
            }
          }
          callerHotel = {
            checkInDate: ci,
            checkOutDate: co,
            roomKey,
            roomLocked,
            roommateName,
          };
        }
      }

      // Build the final payload via the pure rollup. Prefer the
      // top-level indexed columns over the jsonb mirror — producers
      // can edit venue/dates without re-saving the embedded snapshot.
      const days = rollupItinerary({
        brief: {
          project: {
            venue: briefRow.venue || briefData.project?.venue || "",
            date:
              (typeof briefRow.startDate === "string"
                ? briefRow.startDate
                : null) ||
              briefData.project?.date ||
              "",
            endDate:
              (typeof briefRow.endDate === "string"
                ? briefRow.endDate
                : null) ||
              briefData.project?.endDate ||
              null,
            schedule: briefData.project?.schedule as never,
          },
        },
        callerAssignment,
        callerWorkingDates: Array.from(workingDateSet),
        callerHotel,
      });

      res.json({
        ok: true,
        brief: {
          id: briefRow.id,
          projectName: briefRow.projectName,
          venue: briefRow.venue,
        },
        days,
      });
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          briefId: id,
        },
        "portal briefs/:id/itinerary GET failed",
      );
      res
        .status(500)
        .json({ ok: false, error: "Could not load itinerary." });
    }
  },
);

// Silence unused-warning on the row type re-exported only for callers.
export type { ProjectBriefRow };

export default router;
