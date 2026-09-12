import { Router, type IRouter, type RequestHandler } from "express";
import { and, asc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { Readable } from "stream";
import {
  db,
  freelancerProfilesTable,
  briefAssignmentsTable,
  projectBriefsTable,
  gigsTable,
  timeEntriesTable,
  calendarAvailabilityRulesTable,
  profilePhotoUploadsTable,
  type FreelancerProfileRow,
} from "@workspace/db";
import { sanitizeSkills, isValidSkill, groupSkills } from "@workspace/skills";
import { logger } from "../lib/logger";
import { classifyDietary, splitAllergens } from "../lib/dietaryTags";
import { requireEmployee, tagAsFreelancer } from "../middleware/userType";
import { syncMissingClerkFreelancerProfiles } from "../lib/clerkFreelancerSync";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  localDateRangeToInstants,
  weeklyRuleMatchesDateRange,
} from "../lib/calendarTime";

/** Pull a YYYY-MM-DD string off a query param, or null. */
function pickDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] : null;
}

/** Coerce `req.query.skill` (which Express models as string | string[] |
 *  ParsedQs | ParsedQs[] depending on how it was passed) into a clean
 *  string[] of canonical skill labels. Drops empty/invalid entries and
 *  caps at 8 to keep query plans bounded. */
function pickSkills(raw: unknown): string[] {
  const arr: unknown[] = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of arr) {
    if (typeof r !== "string") continue;
    const s = r.trim();
    if (!s || !isValidSkill(s)) continue;
    const lc = s.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * A removed accepted role keeps its confirmed gig for history/payroll, but
 * that gig no longer occupies the freelancer's active directory availability.
 * Assignment rows remain immutable history, so use the brief's current
 * role/freelancer pair as the active signal instead of changing gig status.
 * The aliases passed here are fixed internal SQL aliases (g/cg).
 */
function activeGigAvailabilityPredicate(alias: "g" | "cg") {
  const gigAssignmentId = sql.raw(`${alias}.brief_assignment_id`);
  return sql`(
    ${gigAssignmentId} IS NULL
    OR EXISTS (
      SELECT 1
      FROM brief_assignments active_ba
      JOIN project_briefs active_b
        ON active_b.id = active_ba.brief_id
      WHERE active_ba.id = ${gigAssignmentId}
        AND active_ba.decision = 'accepted'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(active_b.data->'assignments') = 'array'
              THEN active_b.data->'assignments'
              ELSE '[]'::jsonb
            END
          ) AS active_role
          WHERE active_role->>'crewId' = active_ba.crew_id
            AND active_role->>'freelancerUserId' = active_ba.freelancer_user_id
        )
    )
  )`;
}
const PROFILE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROFILE_PHOTO_MAX_BYTES = 5_000_000;
const PROFILE_OBJECT_PATH = /^\/objects\/uploads\/[A-Za-z0-9_-]{8,128}$/;

/** Same Clerk gate the venue memory route uses — every read and write
 *  on the portal/profile namespace requires a signed-in user. */
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

/** Bound the simple text fields so a malformed payload can't blow out
 *  the row. Generous but finite — the longest legitimate field (bio)
 *  is the user's own elevator pitch, not a CV. */
const MAX_TEXT = 280;
const MAX_BIO = 2000;

/** Trim a string field with a per-field cap. Defaults to "" so the
 *  output is always safe to assign to a NOT NULL DEFAULT '' column. */
function clampStr(raw: unknown, cap: number = MAX_TEXT): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, cap);
}

/** Normalise a raw client payload into the shape the DB expects. We
 *  validate skills/languages against the strict skill library so the
 *  Production Tool can trust that every value it reads back is a known
 *  label. Unknown labels are silently dropped (the client should never
 *  send them — the picker is locked — but this is the last line of
 *  defence). */
function normaliseProfile(
  body: Record<string, unknown>,
  existingDefaultDayRate = 0,
): Omit<
  FreelancerProfileRow,
  "userId" | "createdAt" | "updatedAt" | "photoObjectPath"
> {
  // Primary role is free-text. The Profile UI ships a text input
  // (placeholder "Lystekniker") and freelancers legitimately type
  // localised role labels that don't appear in the strict skill
  // library. Previously we silently dropped anything off-list, which
  // surfaced to users as "info was not saved on the profile" — the
  // field would reappear blank after every save. Accept any clamped
  // string; the `skills` array remains library-validated so the
  // producer's directory chips stay clean.
  const primaryRole = clampStr(body.primaryRole);
  // Accept either the new `dietaryRequirements` field name (matches the
  // canonical schema language and the Profile UI label) or the legacy
  // `dietary` key for back-compat with older clients.
  const dietary = clampStr(body.dietaryRequirements ?? body.dietary);
  const skills = sanitizeSkills(
    Array.isArray(body.skills)
      ? body.skills.filter((x): x is string => typeof x === "string")
      : [],
  );
  // Derive the three split arrays so producers can query each group
  // independently without re-grouping in app code. `groupSkills` runs
  // through the same canonical lookup `sanitizeSkills` does, so the
  // sums always tally with `skills`.
  const grouped = groupSkills(skills);
  return {
    fullName: clampStr(body.fullName),
    phone: clampStr(body.phone),
    email: clampStr(body.email),
    defaultDayRate:
      typeof body.defaultDayRate === "number" &&
      Number.isFinite(body.defaultDayRate)
        ? Math.max(0, Math.min(1_000_000, Math.round(body.defaultDayRate)))
        : existingDefaultDayRate,
    primaryRole,
    city: clampStr(body.city),
    bio: clampStr(body.bio, MAX_BIO),
    insurance: clampStr(body.insurance),
    dietary,
    allergies: clampStr(body.allergies),
    bankAccount: clampStr(body.bankAccount),
    orgNumber: clampStr(body.orgNumber),
    // Hotel pairing inputs (Phase B Feature 3). Both are clamped to a
    // strict allowlist server-side so freelancers can't poison the
    // pairing engine with stray values; anything off-list collapses to
    // the safe default ('either' for room share, '' for gender).
    roomShare: ((): "twin" | "single" | "either" => {
      const raw = clampStr(body.roomShare).toLowerCase();
      return raw === "twin" || raw === "single" ? raw : "either";
    })(),
    gender: ((): string => {
      const raw = clampStr(body.gender).toLowerCase();
      return raw === "female" || raw === "male" || raw === "other" ? raw : "";
    })(),
    languages: sanitizeSkills(
      Array.isArray(body.languages)
        ? body.languages.filter((x): x is string => typeof x === "string")
        : [],
    ),
    skills,
    workTypes: grouped.workTypes,
    consoles: grouped.consoles,
    certs: grouped.certs,
  };
}

/** Project a stored profile row into the API shape, exposing the
 *  catering field under both its canonical (`dietaryRequirements`) and
 *  legacy (`dietary`) names so clients can migrate at their own pace. */
function projectProfile(
  row: FreelancerProfileRow,
): FreelancerProfileRow & { dietaryRequirements: string } {
  return { ...row, dietaryRequirements: row.dietary };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function safeRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function safeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const date = raw.slice(0, 10);
  if (!ISO_DATE.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? date
    : null;
}

function firstSafeNumber(...values: unknown[]): number {
  for (const raw of values) {
    const value = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function snapshotParts(raw: unknown, trusted: boolean): {
  project: Record<string, unknown>;
  assignment: Record<string, unknown>;
} {
  const snapshot = safeRecord(raw);
  if (!trusted || snapshot._source !== "server") {
    return { project: {}, assignment: {} };
  }
  return {
    project: safeRecord(snapshot.project),
    assignment: safeRecord(snapshot.myAssignment),
  };
}

function currentAssignment(
  data: unknown,
  crewId: string,
): Record<string, unknown> {
  const assignments = safeRecord(data).assignments;
  if (!Array.isArray(assignments)) return {};
  const rows = assignments.map(safeRecord);
  return rows.find((row) => row.crewId === crewId) ?? {};
}

function netWorkedMinutes(entry: {
  startMinute: number | null;
  endMinute: number | null;
  breakMinutes: number;
}): number {
  if (entry.startMinute == null || entry.endMinute == null) return 0;
  if (
    entry.startMinute < 0 ||
    entry.startMinute > 1439 ||
    entry.endMinute < 0 ||
    entry.endMinute > 1439
  ) {
    return 0;
  }
  let span = entry.endMinute - entry.startMinute;
  if (span < 0) span += 24 * 60;
  return Math.max(0, span - Math.max(0, entry.breakMinutes || 0));
}

function inclusiveDayCount(startDate: string | null, endDate: string | null): number {
  if (!startDate) return 0;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate ?? startDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.min(366, Math.floor((end - start) / 86_400_000) + 1);
}

/** POST /api/portal/me/tag-as-freelancer
 *  Bootstrap endpoint called by the frontend immediately after a new
 *  freelancer completes Clerk sign-up. Tags the signed-in user as
 *  `userType=freelancer` in Clerk publicMetadata so the Production
 *  Tool refuses to load for them even before they save their first
 *  profile row. Idempotent and safe to call repeatedly — the
 *  underlying `tagAsFreelancer` helper skips users already tagged as
 *  employee (defence against an admin/employee accidentally hitting
 *  this endpoint). Returns 200 in all cases (best-effort). */
router.post("/portal/me/tag-as-freelancer", requireSignedIn, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  try {
    await tagAsFreelancer(userId);
  } catch (err) {
    // tagAsFreelancer already swallows internally, but belt-and-
    // braces in case its surface ever changes.
    logger.warn(
      {
        scope: "userType",
        userId,
        err: err instanceof Error ? err.message : String(err),
      },
      "tag-as-freelancer endpoint encountered an error",
    );
  }
  res.json({ ok: true });
});

/** GET /api/portal/profile/me
 *  Returns the signed-in user's profile, or `null` if they haven't
 *  saved one yet. */
router.get("/portal/profile/me", requireSignedIn, async (req, res) => {
  const userId = (req as unknown as { _userId: string })._userId;
  try {
    const rows = await db
      .select()
      .from(freelancerProfilesTable)
      .where(eq(freelancerProfilesTable.userId, userId))
      .limit(1);
    res.json({
      ok: true,
      profile: rows[0] ? projectProfile(rows[0]) : null,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal profile GET failed",
    );
    res.status(500).json({ ok: false, error: "Could not load profile." });
  }
});

/** PUT /api/portal/profile/me  body: <profile fields>
 *  Upsert the signed-in user's profile. Returns the saved row. */
router.put("/portal/profile/me", requireSignedIn, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const userId = (req as unknown as { _userId: string })._userId;
  try {
    const [existing] = await db
      .select({ defaultDayRate: freelancerProfilesTable.defaultDayRate })
      .from(freelancerProfilesTable)
      .where(eq(freelancerProfilesTable.userId, userId))
      .limit(1);
    const fields = normaliseProfile(body, existing?.defaultDayRate ?? 0);
    const inserted = await db
      .insert(freelancerProfilesTable)
      .values({ userId, ...fields })
      .onConflictDoUpdate({
        target: freelancerProfilesTable.userId,
        set: { ...fields, updatedAt: sql`now()` },
      })
      .returning();
    // Anyone who saves a profile via the portal is, by definition, a
    // freelancer. Tag their Clerk user with `userType=freelancer` so
    // the Production Tool refuses to load for them no matter which
    // role tab they pick at sign-in. Fire-and-forget — the metadata
    // write goes to Clerk's API and we don't want a transient Clerk
    // hiccup to fail the profile save. The lazy inference in
    // `getUserType` will catch any user that slipped through this
    // path on their next request.
    void tagAsFreelancer(userId);
    res.json({
      ok: true,
      profile: inserted[0] ? projectProfile(inserted[0]) : null,
    });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal profile PUT failed",
    );
    res.status(500).json({ ok: false, error: "Could not save profile." });
  }
});

/** PATCH /api/portal/freelancers/:userId
 *  Employee-only correction endpoint for the global Crew Directory.
 *  Only operational profile fields are writable; banking, organisation,
 *  insurance, travel preferences and profile-photo ownership stay outside
 *  the admin surface. */
router.patch(
  "/portal/freelancers/:userId",
  requireEmployee,
  async (req, res): Promise<void> => {
    const userId = String(req.params.userId ?? "").trim();
    if (!userId || userId.length > 200) {
      res.status(400).json({ ok: false, error: "Invalid freelancer ID." });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Partial<FreelancerProfileRow> = {};
    if ("fullName" in body) updates.fullName = clampStr(body.fullName);
    if ("email" in body) updates.email = clampStr(body.email);
    if ("phone" in body) updates.phone = clampStr(body.phone);
    if ("primaryRole" in body) updates.primaryRole = clampStr(body.primaryRole);
    if ("city" in body) updates.city = clampStr(body.city);
    if ("bio" in body) updates.bio = clampStr(body.bio, MAX_BIO);
    if ("languages" in body) {
      updates.languages = sanitizeSkills(
        Array.isArray(body.languages)
          ? body.languages.filter((x): x is string => typeof x === "string")
          : [],
      );
    }
    if ("skills" in body) {
      const skills = sanitizeSkills(
        Array.isArray(body.skills)
          ? body.skills.filter((x): x is string => typeof x === "string")
          : [],
      );
      const grouped = groupSkills(skills);
      updates.skills = skills;
      updates.workTypes = grouped.workTypes;
      updates.consoles = grouped.consoles;
      updates.certs = grouped.certs;
    }
    if ("defaultDayRate" in body) {
      const rate =
        typeof body.defaultDayRate === "number"
          ? body.defaultDayRate
          : Number(body.defaultDayRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 1_000_000) {
        res.status(400).json({ ok: false, error: "Invalid default day rate." });
        return;
      }
      updates.defaultDayRate = Math.round(rate);
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ ok: false, error: "No editable fields supplied." });
      return;
    }
    try {
      const [saved] = await db
        .update(freelancerProfilesTable)
        .set({ ...updates, updatedAt: sql`now()` })
        .where(eq(freelancerProfilesTable.userId, userId))
        .returning();
      if (!saved) {
        res.status(404).json({ ok: false, error: "Freelancer not found." });
        return;
      }
      res.json({
        ok: true,
        freelancer: {
          userId: saved.userId,
          fullName: saved.fullName,
          email: saved.email,
          phone: saved.phone,
          defaultDayRate: saved.defaultDayRate,
          primaryRole: saved.primaryRole,
          city: saved.city,
          bio: saved.bio,
          skills: saved.skills,
          languages: saved.languages,
        },
      });
    } catch (err) {
      req.log.error({ err, userId }, "admin freelancer profile PATCH failed");
      res.status(500).json({ ok: false, error: "Could not update freelancer." });
    }
  },
);

/** GET /api/portal/freelancers/:userId/profile-history
 *  Employee-only directory detail. The profile projection intentionally
 *  excludes financial identity, insurance, and accommodation preferences.
 *  Booking history is limited to assignments the freelancer accepted. */
router.get(
  "/portal/freelancers/:userId/profile-history",
  requireEmployee,
  async (req, res): Promise<void> => {
    const userId = String(req.params.userId ?? "").trim();
    if (!userId || userId.length > 200) {
      res.status(400).json({ ok: false, error: "Invalid freelancer ID." });
      return;
    }

    try {
      const [profile] = await db
        .select({
          userId: freelancerProfilesTable.userId,
          fullName: freelancerProfilesTable.fullName,
          email: freelancerProfilesTable.email,
          phone: freelancerProfilesTable.phone,
          primaryRole: freelancerProfilesTable.primaryRole,
          city: freelancerProfilesTable.city,
          bio: freelancerProfilesTable.bio,
          languages: freelancerProfilesTable.languages,
          skills: freelancerProfilesTable.skills,
          photoObjectPath: freelancerProfilesTable.photoObjectPath,
          defaultDayRate: freelancerProfilesTable.defaultDayRate,
          dietary: freelancerProfilesTable.dietary,
          allergies: freelancerProfilesTable.allergies,
        })
        .from(freelancerProfilesTable)
        .where(eq(freelancerProfilesTable.userId, userId))
        .limit(1);
      if (!profile) {
        res.status(404).json({ ok: false, error: "Freelancer not found." });
        return;
      }

      const assignments = await db
        .select({
          assignmentId: briefAssignmentsTable.id,
          briefId: briefAssignmentsTable.briefId,
          crewId: briefAssignmentsTable.crewId,
          acceptedGigId: briefAssignmentsTable.acceptedGigId,
          acceptedSnapshot: briefAssignmentsTable.acceptedSnapshot,
          acceptedSnapshotTrusted:
            briefAssignmentsTable.acceptedSnapshotTrusted,
          decidedAt: briefAssignmentsTable.decidedAt,
          brief: projectBriefsTable,
        })
        .from(briefAssignmentsTable)
        .innerJoin(
          projectBriefsTable,
          eq(briefAssignmentsTable.briefId, projectBriefsTable.id),
        )
        .where(
          and(
            eq(briefAssignmentsTable.freelancerUserId, userId),
            eq(briefAssignmentsTable.decision, "accepted"),
          ),
        )
        .orderBy(asc(projectBriefsTable.startDate));

      const acceptedGigIds = new Set(
        assignments
          .map((row) => row.acceptedGigId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      );
      const acceptedGigs =
        acceptedGigIds.size === 0
          ? []
          : await db
              .select()
              .from(gigsTable)
              .where(
                and(
                  eq(gigsTable.freelancerUserId, userId),
                  inArray(gigsTable.id, Array.from(acceptedGigIds)),
                ),
              );
      const gigIds = acceptedGigs.map((gig) => gig.id);
      const entries =
        gigIds.length === 0
          ? []
          : await db
              .select({
                gigId: timeEntriesTable.gigId,
                startMinute: timeEntriesTable.startMinute,
                endMinute: timeEntriesTable.endMinute,
                breakMinutes: timeEntriesTable.breakMinutes,
              })
              .from(timeEntriesTable)
              .where(
                and(
                  eq(timeEntriesTable.freelancerUserId, userId),
                  inArray(timeEntriesTable.gigId, gigIds),
                ),
              );

      const minutesByGig = new Map<string, number>();
      for (const entry of entries) {
        minutesByGig.set(
          entry.gigId,
          (minutesByGig.get(entry.gigId) ?? 0) + netWorkedMinutes(entry),
        );
      }
      const gigsById = new Map(acceptedGigs.map((gig) => [gig.id, gig]));

      const history = assignments.flatMap((row) => {
        const candidate = row.acceptedGigId
          ? gigsById.get(row.acceptedGigId)
          : undefined;
        const matched =
          candidate?.briefId === row.briefId ? candidate : undefined;
        const gigRows = matched ? [matched] : [null];
        return gigRows.map((gig) => {
          const snapshot = snapshotParts(
            row.acceptedSnapshot,
            row.acceptedSnapshotTrusted,
          );
          const briefData = safeRecord(row.brief.data);
          const briefProject = safeRecord(briefData.project);
          const assignment = {
            ...currentAssignment(row.brief.data, row.crewId),
            ...snapshot.assignment,
          };
          const project = { ...briefProject, ...snapshot.project };
          const rawAssignedDates =
            Array.isArray(assignment.assignedDates) &&
            assignment.assignedDates.length > 0
              ? assignment.assignedDates
              : gig?.assignedDates;
          const assignedDates = Array.isArray(rawAssignedDates)
            ? Array.from(
                new Set(
                  rawAssignedDates
                    .map(safeDate)
                    .filter((date): date is string => date !== null),
                ),
              ).sort()
            : [];
          const startDate =
            safeDate(project.date) ??
            safeDate(gig?.startDate) ??
            safeDate(row.brief.startDate);
          const endDate =
            safeDate(project.endDate) ??
            safeDate(gig?.endDate) ??
            safeDate(row.brief.endDate) ??
            assignedDates.at(-1) ??
            startDate;
          const dayRate = firstSafeNumber(assignment.dayRate);
          const bookedDays =
            assignedDates.length || inclusiveDayCount(startDate, endDate) || 1;
          const projectIdRaw =
            project.projectId ?? project.id ?? briefData.projectId;
          return {
            id: gig?.id ?? row.assignmentId,
            projectId:
              typeof projectIdRaw === "string" && projectIdRaw.trim()
                ? projectIdRaw.trim()
                : null,
            briefId: row.briefId,
            projectName:
              gig?.projectName ||
              (typeof project.name === "string" ? project.name : "") ||
              row.brief.projectName,
            venue:
              gig?.venue ||
              (typeof project.venue === "string" ? project.venue : "") ||
              row.brief.venue,
            role:
              (typeof assignment.role === "string" ? assignment.role : "") ||
              gig?.role ||
              "",
            startDate,
            endDate,
            assignedDates,
            callTime:
              typeof assignment.callTime === "string" ? assignment.callTime : "",
            offTime:
              typeof assignment.offTime === "string" ? assignment.offTime : "",
            dayRate,
            workedMinutes: gig ? minutesByGig.get(gig.id) ?? 0 : 0,
            earnings: dayRate * bookedDays,
            status: gig?.status ?? "accepted",
          };
        });
      });

      const today = new Date().toISOString().slice(0, 10);
      const upcomingGigs = history
        .filter((gig) => !gig.endDate || gig.endDate >= today)
        .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
      const pastGigs = history
        .filter((gig) => Boolean(gig.endDate && gig.endDate < today))
        .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));

      res.json({
        ok: true,
        freelancer: {
          userId: profile.userId,
          fullName: profile.fullName,
          email: profile.email,
          phone: profile.phone,
          primaryRole: profile.primaryRole,
          city: profile.city,
          bio: profile.bio,
          languages: profile.languages,
          skills: profile.skills,
          hasPhoto: Boolean(profile.photoObjectPath),
          photoUrl: profile.photoObjectPath
            ? `/api/portal/freelancers/${encodeURIComponent(profile.userId)}/photo`
            : null,
          defaultDayRate: profile.defaultDayRate,
          dietary: profile.dietary,
          dietaryTags: classifyDietary(profile.dietary),
          allergies: profile.allergies,
          allergenTags: splitAllergens(profile.allergies),
        },
        upcomingGigs,
        pastGigs,
        stats: {
          pastGigCount: pastGigs.length,
          totalWorkedMinutes: pastGigs.reduce(
            (sum, gig) => sum + gig.workedMinutes,
            0,
          ),
          totalEarnings: pastGigs.reduce((sum, gig) => sum + gig.earnings, 0),
        },
      });
    } catch (err) {
      req.log.error({ err, userId }, "freelancer profile history GET failed");
      res.status(500).json({ ok: false, error: "Could not load freelancer history." });
    }
  },
);

/** POST /api/portal/profile/photo/upload-url
 *  Gives any signed-in user a tightly-scoped image upload URL. The browser
 *  uploads directly to App Storage, then saves the returned objectPath on its
 *  own profile through PUT /portal/profile/me. */
router.post(
  "/portal/profile/photo/upload-url",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const size = typeof body.size === "number" ? body.size : NaN;
    const contentType =
      typeof body.contentType === "string" ? body.contentType.toLowerCase() : "";
    if (
      !name ||
      name.length > 200 ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > PROFILE_PHOTO_MAX_BYTES ||
      !PROFILE_PHOTO_TYPES.has(contentType)
    ) {
      res.status(400).json({
        ok: false,
        error: "Choose a JPEG, PNG or WebP image smaller than 5 MB.",
      });
      return;
    }
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      await db.insert(profilePhotoUploadsTable).values({
        objectPath,
        userId: (req as unknown as { _userId: string })._userId,
        contentType,
      });
      res.json({
        ok: true,
        uploadURL,
        objectPath,
      });
    } catch (err) {
      req.log.error({ err }, "profile photo upload URL failed");
      res.status(500).json({ ok: false, error: "Could not start photo upload." });
    }
  },
);

/** PATCH /api/portal/profile/photo
 *  Updates only the signed-in user's photo reference. Keeping this separate
 *  from the full profile PUT avoids overwriting text edits that may still be
 *  in progress in another tab or device. */
router.patch(
  "/portal/profile/photo",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const userId = (req as unknown as { _userId: string })._userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const photoObjectPath =
      body.photoObjectPath === ""
        ? ""
        : typeof body.photoObjectPath === "string" &&
            PROFILE_OBJECT_PATH.test(body.photoObjectPath)
          ? body.photoObjectPath
          : null;
    if (photoObjectPath === null) {
      res.status(400).json({ ok: false, error: "Invalid photo reference." });
      return;
    }
    try {
      if (photoObjectPath) {
        const [permit] = await db
          .select({ objectPath: profilePhotoUploadsTable.objectPath })
          .from(profilePhotoUploadsTable)
          .where(
            and(
              eq(profilePhotoUploadsTable.objectPath, photoObjectPath),
              eq(profilePhotoUploadsTable.userId, userId),
            ),
          )
          .limit(1);
        if (!permit) {
          res.status(403).json({
            ok: false,
            error: "This photo upload does not belong to your account.",
          });
          return;
        }
      }
      const [saved] = await db
        .insert(freelancerProfilesTable)
        .values({ userId, photoObjectPath })
        .onConflictDoUpdate({
          target: freelancerProfilesTable.userId,
          set: { photoObjectPath, updatedAt: sql`now()` },
        })
        .returning();
      res.json({ ok: true, profile: saved ? projectProfile(saved) : null });
    } catch (err) {
      req.log.error({ err }, "profile photo reference update failed");
      res.status(500).json({ ok: false, error: "Could not save profile photo." });
    }
  },
);

/** GET /api/portal/freelancers/:userId/photo
 *  Authenticated inline image route. Only object paths currently attached to
 *  the requested freelancer profile can be read through this endpoint. */
router.get(
  "/portal/freelancers/:userId/photo",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const rawUserId = req.params.userId;
    const requestedUserId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
    const userId =
      requestedUserId === "me"
        ? (req as unknown as { _userId: string })._userId
        : requestedUserId;
    if (!userId) {
      res.status(404).end();
      return;
    }
    try {
      const [profile] = await db
        .select({ photoObjectPath: freelancerProfilesTable.photoObjectPath })
        .from(freelancerProfilesTable)
        .where(eq(freelancerProfilesTable.userId, userId))
        .limit(1);
      if (!profile?.photoObjectPath || !PROFILE_OBJECT_PATH.test(profile.photoObjectPath)) {
        res.status(404).end();
        return;
      }
      const file = await objectStorageService.getObjectEntityFile(
        profile.photoObjectPath,
      );
      const response = await objectStorageService.downloadObject(file, 300);
      const contentType = (response.headers.get("content-type") || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (!PROFILE_PHOTO_TYPES.has(contentType)) {
        res.status(415).end();
        return;
      }
      res.status(response.status);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, max-age=300");
      if (response.body) {
        Readable.fromWeb(
          response.body as unknown as import("stream/web").ReadableStream<Uint8Array>,
        ).pipe(res);
      } else {
        res.end();
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(404).end();
        return;
      }
      req.log.error({ err, userId }, "profile photo read failed");
      res.status(500).end();
    }
  },
);

/** GET /api/portal/freelancers?q=&skill=&startDate=&endDate=
 *  Producer-facing directory used by the Production Tool's Crew
 *  Report. Supports multi-layered filtering for high-pressure booking:
 *
 *  - `q`         — fuzzy match on name / city (case-insensitive).
 *  - `skill`     — repeatable; ALL of the requested labels must appear
 *                  in the freelancer's `skills` OR equal their
 *                  `primaryRole`. Use one filter per Work Type /
 *                  Console / Cert chip in the sidebar so the producer
 *                  can drill down to "Lyd FOH AND DiGiCo SD AND
 *                  Forklift G4" in a single request.
 *  - `startDate`/`endDate` — optional ISO YYYY-MM-DD range. When
 *                  supplied, each row is annotated with a `status`
 *                  field (see below) so the producer can see who is
 *                  free for the project window at a glance and avoid
 *                  double-booking.
 *
 *  Per-row `status` field:
 *
 *  - `"booked"`  — has at least one confirmed/done/invoiced/paid gig
 *                  that overlaps the requested window. Privacy-safe:
 *                  we only reveal the date is taken, never which
 *                  client/producer the freelancer is working for.
 *  - `"pending"` — the calling producer has a `pending` brief
 *                  assignment to this freelancer that overlaps the
 *                  window. Producer-scoped — other producers' pending
 *                  briefs do not bleed across.
 *  - `"available"` — neither of the above.
 *
 *  Without dates, status defaults to `"available"`.
 *
 *  Contact details are included because the endpoint is employee-only.
 *  Financial and private operational fields remain excluded. */
router.get("/portal/freelancers", requireEmployee, async (req, res) => {
  const callerUserId = (req as unknown as { _userId: string })._userId;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const availabilityFilter =
    req.query.availability === "free" ||
    req.query.availability === "free-unknown"
      ? req.query.availability
      : null;
  const briefId =
    typeof req.query.briefId === "string" && req.query.briefId.length <= 200
      ? req.query.briefId
      : null;
  const skills = pickSkills(req.query.skill);
  const startDate = pickDate(req.query.startDate);
  const endDate = pickDate(req.query.endDate) ?? startDate;
  const timezone =
    typeof req.query.timezone === "string" && req.query.timezone.length < 80
      ? req.query.timezone
      : "UTC";
  if (
    startDate &&
    endDate &&
    (endDate < startDate ||
      new Date(`${endDate}T00:00:00Z`).getTime() -
        new Date(`${startDate}T00:00:00Z`).getTime() >
        62 * 86_400_000)
  ) {
    res.status(400).json({
      ok: false,
      error: "Availability range must be between 0 and 62 days.",
    });
    return;
  }
  let requestedBounds: { from: Date; to: Date } | null = null;
  if (startDate && endDate) {
    try {
      requestedBounds = localDateRangeToInstants(
        startDate,
        endDate,
        timezone,
      );
    } catch {
      res.status(400).json({ ok: false, error: "Invalid calendar timezone." });
      return;
    }
  }
  try {
    try {
      const inserted = await syncMissingClerkFreelancerProfiles();
      if (inserted > 0) {
        req.log.info(
          { inserted },
          "backfilled missing Clerk freelancer profiles",
        );
      }
    } catch (err) {
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Clerk freelancer sync failed; serving existing directory profiles",
      );
    }

    const conditions = [];
    if (q) {
      const like = `%${q}%`;
      conditions.push(
        or(
          ilike(freelancerProfilesTable.fullName, like),
          ilike(freelancerProfilesTable.city, like),
        ),
      );
    }
    // Multi-skill drill-down: AND every requested label so that a
    // freelancer must satisfy ALL chips the producer toggled. A label
    // matches when it appears in the profile's `skills` text[] OR
    // equals the `primaryRole` column.
    for (const skill of skills) {
      conditions.push(
        or(
          sql`${freelancerProfilesTable.skills} @> ARRAY[${skill}]::text[]`,
          eq(freelancerProfilesTable.primaryRole, skill),
        ),
      );
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    // Qualify the outer column in raw correlated subqueries. An unqualified
    // "user_id" can resolve to the inner table and become a self-comparison.
    const directoryUserId = sql.raw(`"freelancer_profiles"."user_id"`);

    // Status annotation. When dates are supplied we run two correlated
    // EXISTS subqueries per row — one for booked gigs (global, any
    // owner), one for pending briefs (scoped to this caller). Without
    // dates, status falls through to 'available' so callers that don't
    // care about the project window get a cheap query plan.
    const statusExpr = startDate
      ? sql<string>`
          CASE
            WHEN EXISTS (
              SELECT 1 FROM gigs g
               WHERE g.freelancer_user_id = ${directoryUserId}
                 AND g.status IN ('confirmed','done','invoiced','paid')
                 AND ${activeGigAvailabilityPredicate("g")}
                 AND g.start_date IS NOT NULL
                 AND g.start_date <= ${endDate}::date
                 AND COALESCE(g.end_date, g.start_date) >= ${startDate}::date
            ) THEN 'booked'
            WHEN EXISTS (
              SELECT 1
                FROM brief_assignments ba
                JOIN project_briefs b ON ba.brief_id = b.id
               WHERE ba.freelancer_user_id = ${directoryUserId}
                 AND ba.decision = 'pending'
                 AND b.owner_user_id = ${callerUserId}
                 AND b.start_date IS NOT NULL
                 AND b.start_date <= ${endDate}::date
                 AND COALESCE(b.end_date, b.start_date) >= ${startDate}::date
            ) THEN 'pending'
            ELSE 'available'
          END
        `
      : sql<string>`'available'`;

    const rows = await db
      .select({
        userId: freelancerProfilesTable.userId,
        fullName: freelancerProfilesTable.fullName,
        primaryRole: freelancerProfilesTable.primaryRole,
        city: freelancerProfilesTable.city,
        bio: freelancerProfilesTable.bio,
        photoObjectPath: freelancerProfilesTable.photoObjectPath,
        skills: freelancerProfilesTable.skills,
        languages: freelancerProfilesTable.languages,
        phone: freelancerProfilesTable.phone,
        email: freelancerProfilesTable.email,
        defaultDayRate: freelancerProfilesTable.defaultDayRate,
        dietary: freelancerProfilesTable.dietary,
        allergies: freelancerProfilesTable.allergies,
        status: statusExpr.as("status"),
        // Privacy-safe booking signal for producers. Notes and external
        // calendar metadata never leave the calendar tables.
        availabilityStatus: startDate
          ? sql<string>`CASE
              WHEN EXISTS (SELECT 1 FROM gigs cg WHERE cg.freelancer_user_id = ${directoryUserId} AND cg.status IN ('confirmed','done','invoiced','paid') AND ${activeGigAvailabilityPredicate("cg")} AND cg.start_date <= ${endDate}::date AND COALESCE(cg.end_date,cg.start_date) >= ${startDate}::date) THEN 'unavailable'
              WHEN EXISTS (SELECT 1 FROM calendar_busy_intervals cbi JOIN calendar_connections cc ON cc.id=cbi.connection_id WHERE cc.user_id=${directoryUserId} AND cbi.starts_at < ${requestedBounds!.to} AND cbi.ends_at > ${requestedBounds!.from}) THEN 'unavailable'
              WHEN EXISTS (SELECT 1 FROM calendar_holds ch WHERE ch.freelancer_user_id=${directoryUserId} AND ch.expires_at > now() AND ch.starts_at < ${requestedBounds!.to} AND ch.ends_at > ${requestedBounds!.from}) THEN 'tentative'
              WHEN EXISTS (SELECT 1 FROM calendar_availability ca WHERE ca.user_id=${directoryUserId} AND ca.status='unavailable' AND ca.starts_at < ${requestedBounds!.to} AND ca.ends_at > ${requestedBounds!.from}) THEN 'unavailable'
              WHEN EXISTS (SELECT 1 FROM calendar_availability ca WHERE ca.user_id=${directoryUserId} AND ca.status='tentative' AND ca.starts_at < ${requestedBounds!.to} AND ca.ends_at > ${requestedBounds!.from}) THEN 'tentative'
              WHEN EXISTS (SELECT 1 FROM calendar_availability ca WHERE ca.user_id=${directoryUserId} AND ca.status='available' AND ca.starts_at <= ${requestedBounds!.from} AND ca.ends_at >= ${requestedBounds!.to}) THEN 'full'
              WHEN EXISTS (SELECT 1 FROM calendar_availability ca WHERE ca.user_id=${directoryUserId} AND ca.status='available' AND ca.starts_at < ${requestedBounds!.to} AND ca.ends_at > ${requestedBounds!.from}) THEN 'partial'
              ELSE 'unknown' END`.as("availability_status")
          : sql<string>`'unknown'`.as("availability_status"),
         availabilityReason: startDate ? sql<string>`CASE WHEN EXISTS (SELECT 1 FROM gigs cg WHERE cg.freelancer_user_id=${directoryUserId} AND cg.status IN ('confirmed','done','invoiced','paid') AND ${activeGigAvailabilityPredicate("cg")} AND cg.start_date <= ${endDate}::date AND COALESCE(cg.end_date,cg.start_date)>=${startDate}::date) THEN 'gig' WHEN EXISTS (SELECT 1 FROM calendar_busy_intervals cbi JOIN calendar_connections cc ON cc.id=cbi.connection_id WHERE cc.user_id=${directoryUserId} AND cbi.starts_at < ${requestedBounds!.to} AND cbi.ends_at > ${requestedBounds!.from}) THEN 'external_busy' WHEN EXISTS (SELECT 1 FROM calendar_holds ch WHERE ch.freelancer_user_id=${directoryUserId} AND ch.expires_at>now() AND ch.starts_at < ${requestedBounds!.to} AND ch.ends_at > ${requestedBounds!.from}) THEN 'hold' ELSE NULL END`.as("availability_reason") : sql<string | null>`NULL`.as("availability_reason"),
        availabilityUpdatedAt: sql<Date | null>`(SELECT max(x.updated_at) FROM calendar_availability x WHERE x.user_id=${directoryUserId})`.as("availability_updated_at"),
        conflicts: startDate ? sql<number>`(SELECT count(*)::int FROM calendar_busy_intervals cbi JOIN calendar_connections cc ON cc.id=cbi.connection_id WHERE cc.user_id=${directoryUserId} AND cbi.starts_at < ${requestedBounds!.to} AND cbi.ends_at > ${requestedBounds!.from})`.as("conflicts") : sql<number>`0`.as("conflicts"),
        holdId: startDate && briefId ? sql<string | null>`(SELECT ch.id FROM calendar_holds ch WHERE ch.freelancer_user_id=${directoryUserId} AND ch.owner_user_id=${callerUserId} AND ch.brief_id=${briefId} AND ch.expires_at>now() AND ch.starts_at < ${requestedBounds!.to} AND ch.ends_at > ${requestedBounds!.from} ORDER BY ch.expires_at LIMIT 1)`.as("hold_id") : sql<string | null>`NULL`.as("hold_id"),
        holdExpiresAt: startDate && briefId ? sql<Date | null>`(SELECT ch.expires_at FROM calendar_holds ch WHERE ch.freelancer_user_id=${directoryUserId} AND ch.owner_user_id=${callerUserId} AND ch.brief_id=${briefId} AND ch.expires_at>now() AND ch.starts_at < ${requestedBounds!.to} AND ch.ends_at > ${requestedBounds!.from} ORDER BY ch.expires_at LIMIT 1)`.as("hold_expires_at") : sql<Date | null>`NULL`.as("hold_expires_at"),
      })
      .from(freelancerProfilesTable)
      .where(where)
      .orderBy(freelancerProfilesTable.fullName);
    // Resolve recurring availability in one bounded query for the complete
    // directory page; never query once per freelancer or return rule notes.
    const recurringRules = startDate
      ? await db
          .select({
            userId: calendarAvailabilityRulesTable.userId,
            status: calendarAvailabilityRulesTable.status,
            weekday: calendarAvailabilityRulesTable.weekday,
            startMinute: calendarAvailabilityRulesTable.startMinute,
            endMinute: calendarAvailabilityRulesTable.endMinute,
            timezone: calendarAvailabilityRulesTable.timezone,
            startsOn: calendarAvailabilityRulesTable.startsOn,
            until: calendarAvailabilityRulesTable.until,
          })
          .from(calendarAvailabilityRulesTable)
          .where(
            and(
              lte(calendarAvailabilityRulesTable.startsOn, new Date(`${endDate}T23:59:59.999Z`)),
              gte(calendarAvailabilityRulesTable.until, new Date(`${startDate}T00:00:00.000Z`)),
            ),
          )
      : [];
    const rulesByUser = new Map<string, typeof recurringRules>();
    for (const rule of recurringRules) {
      const current = rulesByUser.get(rule.userId) ?? [];
      current.push(rule);
      rulesByUser.set(rule.userId, current);
    }
    const appliesRule = (
      rule: (typeof recurringRules)[number],
    ): { matches: boolean; fullDay: boolean } => {
      if (!startDate || !endDate) return { matches: false, fullDay: false };
      try {
        return weeklyRuleMatchesDateRange(rule, startDate, endDate);
      } catch {
        return { matches: false, fullDay: false };
      }
    };
    // Pre-classify dietary / allergens server-side so the Production
    // Tool can drop the raw fields straight onto a CrewMember without
    // re-implementing the keyword classifier on the client.
    const enriched = rows.map((r) => {
      const matching = (rulesByUser.get(r.userId) ?? []).map(appliesRule).filter((x) => x.matches);
      let availabilityStatus = r.availabilityStatus;
      // Hard conflicts have already won in SQL. Rules only resolve an
      // otherwise unknown/manual-available window.
      if ((availabilityStatus === "unknown" || availabilityStatus === "full" || availabilityStatus === "partial") && matching.length) {
        const userRules = rulesByUser.get(r.userId) ?? [];
        if (userRules.some((rule) => appliesRule(rule).fullDay && rule.status === "unavailable")) availabilityStatus = "unavailable";
        else if (userRules.some((rule) => appliesRule(rule).matches && rule.status === "unavailable")) availabilityStatus = "partial";
        else if (userRules.some((rule) => appliesRule(rule).matches && rule.status === "tentative")) availabilityStatus = "tentative";
        else if (userRules.some((rule) => appliesRule(rule).fullDay && rule.status === "available")) availabilityStatus = "full";
        else if (userRules.some((rule) => appliesRule(rule).matches && rule.status === "available")) availabilityStatus = "partial";
      }
      return ({
      ...r,
        availabilityStatus,
      phone: typeof r.phone === "string" ? r.phone : "",
      dietaryTags: classifyDietary(r.dietary),
      allergens: splitAllergens(r.allergies),
      });
    });
    const filtered =
      availabilityFilter === "free"
        ? enriched.filter((row) => row.availabilityStatus === "full")
        : availabilityFilter === "free-unknown"
          ? enriched.filter((row) =>
              ["full", "partial", "unknown"].includes(row.availabilityStatus),
            )
          : enriched;
    res.json({ ok: true, freelancers: filtered });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "portal freelancers GET failed",
    );
    res.status(500).json({ ok: false, error: "Could not load directory." });
  }
});

export default router;
