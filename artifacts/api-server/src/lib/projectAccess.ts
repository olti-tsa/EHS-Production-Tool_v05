import { and, eq } from "drizzle-orm";
import { db, projectMembersTable, projectsTable } from "@workspace/db";

export type ProjectAccessRole = "owner" | "editor" | "viewer";
type ProjectAccessOptions = { includeArchived?: boolean };

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isProjectWriter(role: ProjectAccessRole | null): boolean {
  return role === "owner" || role === "editor";
}

export function isProjectArchived(project: {
  archivedAt?: Date | null;
  status?: string | null;
}): boolean {
  return project.archivedAt != null || project.status === "archived";
}

/** Returns null both for missing projects and inaccessible projects. */
export async function getProjectAccess(
  projectId: string,
  userId: string,
  options: ProjectAccessOptions = {},
): Promise<ProjectAccessRole | null> {
  const [project] = await db
    .select({
      ownerId: projectsTable.userId,
      archivedAt: projectsTable.archivedAt,
      status: projectsTable.status,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return null;
  if (!options.includeArchived && isProjectArchived(project)) return null;
  if (project.ownerId === userId) return "owner";
  const [membership] = await db
    .select({ role: projectMembersTable.role })
    .from(projectMembersTable)
    .where(
      and(
        eq(projectMembersTable.projectId, projectId),
        eq(projectMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return membership?.role === "editor" || membership?.role === "viewer"
    ? membership.role
    : null;
}

/**
 * Returns collaborative access for an existing project, granting employees
 * who are not explicit members the default editor role. This is only safe
 * after requireEmployee (or an equivalent positive employee classification).
 */
export async function getEmployeeProjectAccess(
  projectId: string,
  userId: string,
  options: ProjectAccessOptions = {},
): Promise<ProjectAccessRole | null> {
  const [project] = await db
    .select({
      ownerId: projectsTable.userId,
      archivedAt: projectsTable.archivedAt,
      status: projectsTable.status,
    })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);
  if (!project) return null;
  if (!options.includeArchived && isProjectArchived(project)) return null;
  if (project.ownerId === userId) return "owner";
  const [membership] = await db
    .select({ role: projectMembersTable.role })
    .from(projectMembersTable)
    .where(
      and(
        eq(projectMembersTable.projectId, projectId),
        eq(projectMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return membership?.role === "editor" || membership?.role === "viewer"
    ? membership.role
    : "editor";
}