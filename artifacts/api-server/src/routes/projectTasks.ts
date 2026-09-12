import { Router, type IRouter } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { db, freelancerProfilesTable, projectTasksTable } from "@workspace/db";
import {
  getProjectAccess,
  isProjectWriter,
  UUID_PATTERN,
} from "../lib/projectAccess";

const router: IRouter = Router();

const TASK_STATUSES = [
  "Not Started",
  "Working on it",
  "Stuck",
  "Done",
] as const;
const TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const TASK_DEPARTMENTS = [
  "Rigging",
  "Lights",
  "LED",
  "Sound",
  "Stage",
  "Inspection",
  "Logistics",
] as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function userIdFor(req: unknown): string {
  return (req as { _userId: string })._userId;
}

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

router.get("/projects/:projectId/tasks", async (req, res): Promise<void> => {
  const projectId = param(req.params.projectId);
  const userId = userIdFor(req);
  if (!UUID_PATTERN.test(projectId)) {
    res.status(404).json({ ok: false, error: "Project not found." });
    return;
  }
  try {
    if (!(await getProjectAccess(projectId, userId))) {
      res.status(404).json({ ok: false, error: "Project not found." });
      return;
    }
    const tasks = await db
      .select()
      .from(projectTasksTable)
      .where(eq(projectTasksTable.projectId, projectId))
      .orderBy(asc(projectTasksTable.createdAt));
    res.json({ ok: true, tasks });
  } catch (error) {
    req.log.error(error, "Failed to list project tasks");
    res.status(500).json({ ok: false, error: "Failed to list project tasks." });
  }
});

router.post("/projects/:projectId/tasks", async (req, res): Promise<void> => {
  const projectId = param(req.params.projectId);
  const userId = userIdFor(req);
  if (!UUID_PATTERN.test(projectId)) {
    res.status(404).json({ ok: false, error: "Project not found." });
    return;
  }
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ ok: false, error: "Task title is required." });
    return;
  }
  try {
    const accessRole = await getProjectAccess(projectId, userId);
    if (!accessRole) {
      res.status(404).json({ ok: false, error: "Project not found." });
      return;
    }
    if (!isProjectWriter(accessRole)) {
      res.status(403).json({ ok: false, error: "Project is read-only." });
      return;
    }
    const [task] = await db
      .insert(projectTasksTable)
      .values({ projectId, title: title.slice(0, 300) })
      .returning();
    res.status(201).json({ ok: true, task });
  } catch (error) {
    req.log.error(error, "Failed to create project task");
    res.status(500).json({ ok: false, error: "Failed to create project task." });
  }
});

router.patch("/projects/tasks/:id", async (req, res): Promise<void> => {
  const id = param(req.params.id);
  const userId = userIdFor(req);
  if (!UUID_PATTERN.test(id)) {
    res.status(404).json({ ok: false, error: "Task not found." });
    return;
  }
  const [ownedTask] = await db
    .select({ id: projectTasksTable.id })
    .from(projectTasksTable)
    .where(eq(projectTasksTable.id, id))
    .limit(1);
  if (!ownedTask) {
    res.status(404).json({ ok: false, error: "Task not found." });
    return;
  }
  const [taskForAccess] = await db
    .select({ projectId: projectTasksTable.projectId })
    .from(projectTasksTable)
    .where(eq(projectTasksTable.id, id))
    .limit(1);
  const accessRole = taskForAccess
    ? await getProjectAccess(taskForAccess.projectId, userId)
    : null;
  if (!accessRole) {
    res.status(404).json({ ok: false, error: "Task not found." });
    return;
  }
  if (!isProjectWriter(accessRole)) {
    res.status(403).json({ ok: false, error: "Project is read-only." });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: sql`now()` };
  if (req.body?.title !== undefined) {
    const title =
      typeof req.body.title === "string" ? req.body.title.trim() : "";
    if (!title) {
      res.status(400).json({ ok: false, error: "Task title is required." });
      return;
    }
    updates.title = title.slice(0, 300);
  }
  if (req.body?.status !== undefined) {
    if (!TASK_STATUSES.includes(req.body.status)) {
      res.status(400).json({ ok: false, error: "Invalid task status." });
      return;
    }
    updates.status = req.body.status;
  }
  if (req.body?.priority !== undefined) {
    if (!TASK_PRIORITIES.includes(req.body.priority)) {
      res.status(400).json({ ok: false, error: "Invalid task priority." });
      return;
    }
    updates.priority = req.body.priority;
  }
  if (req.body?.department !== undefined) {
    if (!TASK_DEPARTMENTS.includes(req.body.department)) {
      res.status(400).json({ ok: false, error: "Invalid task department." });
      return;
    }
    updates.department = req.body.department;
  }
  if (req.body?.dueDate !== undefined) {
    if (
      req.body.dueDate !== null &&
      !isCalendarDate(req.body.dueDate)
    ) {
      res.status(400).json({ ok: false, error: "Invalid due date." });
      return;
    }
    updates.dueDate = req.body.dueDate;
  }
  if (req.body?.assignedTo !== undefined) {
    if (typeof req.body.assignedTo !== "string") {
      res.status(400).json({ ok: false, error: "Invalid assignee." });
      return;
    }
    updates.assignedTo = req.body.assignedTo.trim().slice(0, 200);
  }
  if (req.body?.assignedUserId !== undefined) {
    if (
      req.body.assignedUserId !== null &&
      (typeof req.body.assignedUserId !== "string" ||
        req.body.assignedUserId.length > 200)
    ) {
      res.status(400).json({ ok: false, error: "Invalid assignee." });
      return;
    }
    if (req.body.assignedUserId) {
      const [crewMember] = await db
        .select({ userId: freelancerProfilesTable.userId, fullName: freelancerProfilesTable.fullName })
        .from(freelancerProfilesTable)
        .where(eq(freelancerProfilesTable.userId, req.body.assignedUserId))
        .limit(1);
      if (!crewMember) {
        res.status(400).json({ ok: false, error: "Assignee is not in the Global Crew Directory." });
        return;
      }
      updates.assignedUserId = crewMember.userId;
      updates.assignedTo = crewMember.fullName;
    } else {
      updates.assignedUserId = null;
      updates.assignedTo = "";
    }
  }
  if (req.body?.description !== undefined) {
    if (typeof req.body.description !== "string") {
      res.status(400).json({ ok: false, error: "Invalid description." });
      return;
    }
    updates.description = req.body.description.slice(0, 10_000);
  }

  try {
    const [task] = await db
      .update(projectTasksTable)
      .set(updates)
      .where(eq(projectTasksTable.id, id))
      .returning();
    res.json({ ok: true, task });
  } catch (error) {
    req.log.error(error, "Failed to update project task");
    res.status(500).json({ ok: false, error: "Failed to update project task." });
  }
});

router.delete("/projects/tasks/:id", async (req, res): Promise<void> => {
  const id = param(req.params.id);
  const userId = userIdFor(req);
  if (!UUID_PATTERN.test(id)) {
    res.status(404).json({ ok: false, error: "Task not found." });
    return;
  }
  try {
    const [ownedTask] = await db
      .select({ id: projectTasksTable.id, projectId: projectTasksTable.projectId })
      .from(projectTasksTable)
      .where(eq(projectTasksTable.id, id))
      .limit(1);
    if (!ownedTask) {
      res.status(404).json({ ok: false, error: "Task not found." });
      return;
    }
    const accessRole = await getProjectAccess(ownedTask.projectId, userId);
    if (!accessRole) {
      res.status(404).json({ ok: false, error: "Task not found." });
      return;
    }
    if (!isProjectWriter(accessRole)) {
      res.status(403).json({ ok: false, error: "Project is read-only." });
      return;
    }
    await db.delete(projectTasksTable).where(eq(projectTasksTable.id, id));
    res.json({ ok: true });
  } catch (error) {
    req.log.error(error, "Failed to delete project task");
    res.status(500).json({ ok: false, error: "Failed to delete project task." });
  }
});

export default router;