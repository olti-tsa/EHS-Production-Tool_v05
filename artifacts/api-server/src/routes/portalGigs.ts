import { Router, type IRouter, type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  db,
  gigsTable,
  projectBriefsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { normaliseAssignedDates } from "../lib/roleSchedule";

const router: IRouter = Router();

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

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "invited",
  "confirmed",
  "done",
  "invoiced",
  "paid",
]);

const MAX_TEXT = 280;
const MAX_NOTES = 4000;

function clampStr(raw: unknown, cap = MAX_TEXT): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, cap);
}

/** Coerce a numeric input into a string the `numeric` column accepts.
 *  Drizzle's numeric type returns strings; we accept either number or
 *  string from the client and normalise. */
function clampNum(raw: unknown): string {
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw)
        : 0;
  if (!Number.isFinite(n) || n < 0) return "0";
  // Cap at 1 billion — anything bigger is clearly garbage.
  return Math.min(n, 1_000_000_000).toFixed(2);
}

function pickDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function normaliseCheckIn(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  if (typeof r.onTheWayAt === "number" && Number.isFinite(r.onTheWayAt)) {
    out.onTheWayAt = r.onTheWayAt;
  }
  if (typeof r.arrivedAt === "number" && Number.isFinite(r.arrivedAt)) {
    out.arrivedAt = r.arrivedAt;
  }
  return Object.keys(out).length === 0 ? null : out;
}

function normaliseGig(body: Record<string, unknown>): {
  projectName: string;
  client: string;
  venue: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  hours: string;
  rate: string;
  flatFee: string;
  notes: string;
  status: string;
  briefId: string | null;
  checkIn: Record<string, number> | null;
  assignedDates: string[];
} {
  const status = clampStr(body.status);
  return {
    projectName: clampStr(body.projectName),
    client: clampStr(body.client),
    venue: clampStr(body.venue),
    role: clampStr(body.role),
    startDate: pickDate(body.startDate),
    endDate: pickDate(body.endDate),
    hours: clampNum(body.hours),
    rate: clampNum(body.rate),
    flatFee: clampNum(body.flatFee),
    notes: clampStr(body.notes, MAX_NOTES),
    status: VALID_STATUSES.has(status) ? status : "confirmed",
    briefId:
      typeof body.briefId === "string" && body.briefId.trim()
        ? body.briefId.trim().slice(0, 64)
        : null,
    checkIn: normaliseCheckIn(body.checkIn),
    assignedDates: normaliseAssignedDates(body.assignedDates),
  };
}

/** GET /api/portal/gigs
 *  Returns gigs the signed-in user can see. Freelancers see their own
 *  gigs; producers also see gigs whose `briefId` belongs to a brief
 *  they own (so a confirmed Portal gig is visible to the producer
 *  who assigned it). */
router.get("/portal/gigs", requireSignedIn, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  try {
    const rows = await db
      .select({
        gig: gigsTable,
        ownerUserId: projectBriefsTable.ownerUserId,
      })
      .from(gigsTable)
      .leftJoin(
        projectBriefsTable,
        eq(gigsTable.briefId, projectBriefsTable.id),
      )
      .where(
        or(
          eq(gigsTable.freelancerUserId, userId),
          eq(projectBriefsTable.ownerUserId, userId),
        ),
      )
      .orderBy(desc(gigsTable.startDate), desc(gigsTable.createdAt))
      .limit(500);
    res.json({
      ok: true,
      gigs: rows.map((r) => ({
        ...r.gig,
        // Caller can use this to badge "via my brief" in the producer
        // view. Null when the gig is the freelancer's own log entry.
        briefOwnerUserId: r.ownerUserId,
      })),
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal gigs GET failed",
    );
    res.status(500).json({ ok: false, error: "Could not load gigs." });
  }
});

/** POST /api/portal/gigs  body: { id?, ...gig fields }
 *  Create or update a gig owned by the signed-in freelancer.
 *
 *  When the client supplies an `id`, we first check that the existing
 *  row (if any) belongs to the signed-in user and reject the call with
 *  403 otherwise. This closes the IDOR hole where a caller who
 *  guessed/knew another freelancer's gig id could rewrite every field
 *  on that row via the PK-keyed `onConflictDoUpdate`. (The
 *  `freelancerUserId` itself was already safe — we don't set it in
 *  the update clause — but everything else was exposed.) */
router.post("/portal/gigs", requireSignedIn, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const clientId =
    typeof body.id === "string" && body.id.trim()
      ? body.id.trim().slice(0, 64)
      : "";
  const id = clientId || randomUUID();
  const fields = normaliseGig(body);
  try {
    if (clientId) {
      const existing = await db
        .select({
          freelancerUserId: gigsTable.freelancerUserId,
          briefId: gigsTable.briefId,
          briefAssignmentId: gigsTable.briefAssignmentId,
        })
        .from(gigsTable)
        .where(eq(gigsTable.id, clientId))
        .limit(1);
      if (existing[0] && existing[0].freelancerUserId !== userId) {
        res.status(403).json({ ok: false, error: "Not your gig." });
        return;
      }
      if (existing[0]?.briefId || existing[0]?.briefAssignmentId) {
        res.status(403).json({
          ok: false,
          error: "Producer-assigned gigs cannot be overwritten from the portal.",
        });
        return;
      }
    } else if (fields.briefId) {
      res.status(400).json({
        ok: false,
        error: "Project assignments must be created by a producer.",
      });
      return;
    }
    const inserted = await db
      .insert(gigsTable)
      .values({ id, freelancerUserId: userId, ...fields })
      .onConflictDoUpdate({
        target: gigsTable.id,
        set: { ...fields, updatedAt: sql`now()` },
      })
      .returning();
    res.json({ ok: true, gig: inserted[0] ?? null });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal gigs POST failed",
    );
    res.status(500).json({ ok: false, error: "Could not save gig." });
  }
});

/** PATCH /api/portal/gigs/:id  body: <subset of gig fields>
 *  Partial update used by the show-day check-in flow ("On the way" /
 *  "Arrived") and by the status transitions (confirmed → done →
 *  invoiced → paid). */
router.patch("/portal/gigs/:id", requireSignedIn, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  const id = String(req.params.id ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: sql`now()` };
  const existing = await db
    .select({
      briefId: gigsTable.briefId,
      briefAssignmentId: gigsTable.briefAssignmentId,
    })
    .from(gigsTable)
    .where(and(eq(gigsTable.id, id), eq(gigsTable.freelancerUserId, userId)))
    .limit(1);
  if (!existing[0]) {
    res.status(404).json({ ok: false, error: "Gig not found." });
    return;
  }
  if (
    (existing[0].briefId || existing[0].briefAssignmentId) &&
    Object.keys(body).some(
      (key) => !["status", "checkIn", "notes"].includes(key),
    )
  ) {
    res.status(403).json({
      ok: false,
      error: "Producer-owned assignment terms cannot be changed from the portal.",
    });
    return;
  }
  if (body.status !== undefined) {
    const s = clampStr(body.status);
    if (!VALID_STATUSES.has(s)) {
      res.status(400).json({ ok: false, error: "Invalid status." });
      return;
    }
    patch.status = s;
  }
  if (body.checkIn !== undefined) {
    patch.checkIn = normaliseCheckIn(body.checkIn);
  }
  if (body.notes !== undefined) patch.notes = clampStr(body.notes, MAX_NOTES);
  if (body.hours !== undefined) patch.hours = clampNum(body.hours);
  if (body.rate !== undefined) patch.rate = clampNum(body.rate);
  if (body.flatFee !== undefined) patch.flatFee = clampNum(body.flatFee);
  if (body.assignedDates !== undefined) {
    patch.assignedDates = normaliseAssignedDates(body.assignedDates);
  }
  try {
    const updated = await db
      .update(gigsTable)
      .set(patch)
      .where(
        and(eq(gigsTable.id, id), eq(gigsTable.freelancerUserId, userId)),
      )
      .returning();
    if (updated.length === 0) {
      res.status(404).json({ ok: false, error: "Gig not found." });
      return;
    }
    res.json({ ok: true, gig: updated[0] });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal gigs PATCH failed",
    );
    res.status(500).json({ ok: false, error: "Could not update gig." });
  }
});

/** DELETE /api/portal/gigs/:id
 *  Freelancer can remove a gig from their own logbook. Brief-linked
 *  gigs delete the gig but leave the brief intact. */
router.delete("/portal/gigs/:id", requireSignedIn, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  const id = String(req.params.id ?? "");
  try {
    const [existing] = await db
      .select({
        briefId: gigsTable.briefId,
        briefAssignmentId: gigsTable.briefAssignmentId,
      })
      .from(gigsTable)
      .where(and(eq(gigsTable.id, id), eq(gigsTable.freelancerUserId, userId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ ok: false, error: "Gig not found." });
      return;
    }
    if (existing.briefId || existing.briefAssignmentId) {
      res.status(403).json({
        ok: false,
        error: "Producer-assigned gigs cannot be deleted from the portal.",
      });
      return;
    }
    const removed = await db
      .delete(gigsTable)
      .where(
        and(eq(gigsTable.id, id), eq(gigsTable.freelancerUserId, userId)),
      )
      .returning({ id: gigsTable.id });
    if (removed.length === 0) {
      res.status(404).json({ ok: false, error: "Gig not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal gigs DELETE failed",
    );
    res.status(500).json({ ok: false, error: "Could not delete gig." });
  }
});

export default router;
