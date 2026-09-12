import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { after, before, mock, test } from "node:test";
import express from "express";

const clientFetch = globalThis.fetch;
const prefix = `project-tasks-test-${process.pid}-${Date.now()}-${randomUUID()}`;
const owner = `${prefix}-owner`;
const otherEmployee = `${prefix}-other`;
const projectId = randomUUID();

let server: Server;
let baseUrl = "";
let dbModule: typeof import("@workspace/db");
let eq: typeof import("drizzle-orm").eq;

async function request(
  path: string,
  userId: string,
  init: RequestInit = {},
): Promise<Response> {
  return clientFetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-test-user": userId,
      ...init.headers,
    },
  });
}

async function cleanup(): Promise<void> {
  await dbModule.db
    .delete(dbModule.projectsTable)
    .where(eq(dbModule.projectsTable.id, projectId));
}

before(async () => {
  // Exercise the real route and database with deterministic employee auth,
  // without creating Clerk accounts or calling an external identity service.
  mock.module("../middleware/userType", {
    namedExports: {
      hasVerifiedPrimaryEhsEmail: () => false,
      getUserType: async () => "employee",
      tagAsFreelancer: async () => undefined,
      requireEmployee: async (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        const userId = req.auth?.()?.userId ?? null;
        if (!userId) {
          res.status(401).json({ ok: false, error: "Sign in required." });
          return;
        }
        (req as typeof req & { _userId: string })._userId = userId;
        next();
      },
    },
  });

  dbModule = await import("@workspace/db");
  ({ eq } = await import("drizzle-orm"));
  const [{ default: projectTasksRouter }, { requireEmployee }] =
    await Promise.all([
      import("./projectTasks"),
      import("../middleware/userType"),
    ]);

  await cleanup();
  await dbModule.db.insert(dbModule.projectsTable).values({
    id: projectId,
    userId: owner,
    name: `${prefix}-project`,
    status: "draft",
    data: {},
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.header("x-test-user");
    (req as typeof req & { auth: () => { userId: string | null } }).auth = () => ({
      userId: userId ?? null,
    });
    next();
  });
  app.use("/api/projects", requireEmployee);
  app.use("/api", projectTasksRouter);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await cleanup();
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  await dbModule.pool.end();
});

test("owner CRUD works and unrelated employees cannot access tasks", async () => {
  const created = await request(`/api/projects/${projectId}/tasks`, owner, {
    method: "POST",
    body: JSON.stringify({ title: "  Integration task  " }),
  });
  assert.equal(created.status, 201);
  const createdBody = (await created.json()) as {
    task: { id: string; title: string };
  };
  assert.equal(createdBody.task.title, "Integration task");
  const taskId = createdBody.task.id;

  const listed = await request(`/api/projects/${projectId}/tasks`, owner);
  assert.equal(listed.status, 200);
  const listedBody = (await listed.json()) as {
    tasks: Array<{ id: string }>;
  };
  assert.deepEqual(listedBody.tasks.map((task) => task.id), [taskId]);

  const foreignList = await request(
    `/api/projects/${projectId}/tasks`,
    otherEmployee,
  );
  assert.equal(foreignList.status, 404);
  const foreignPatch = await request(`/api/projects/tasks/${taskId}`, otherEmployee, {
    method: "PATCH",
    body: JSON.stringify({ title: "Stolen edit" }),
  });
  assert.equal(foreignPatch.status, 404);
  const foreignDelete = await request(
    `/api/projects/tasks/${taskId}`,
    otherEmployee,
    { method: "DELETE" },
  );
  assert.equal(foreignDelete.status, 404);

  const updated = await request(`/api/projects/tasks/${taskId}`, owner, {
    method: "PATCH",
    body: JSON.stringify({
      title: "Updated task",
      status: "Working on it",
      priority: "High",
      department: "Rigging",
      description: "Covered by integration test",
    }),
  });
  assert.equal(updated.status, 200);
  const updatedBody = (await updated.json()) as {
    task: { title: string; status: string };
  };
  assert.equal(updatedBody.task.title, "Updated task");
  assert.equal(updatedBody.task.status, "Working on it");

  const deleted = await request(`/api/projects/tasks/${taskId}`, owner, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  const afterDelete = await request(`/api/projects/${projectId}/tasks`, owner);
  const afterDeleteBody = (await afterDelete.json()) as { tasks: unknown[] };
  assert.equal(afterDelete.status, 200);
  assert.deepEqual(afterDeleteBody.tasks, []);
});

test("dueDate accepts calendar dates and null but rejects datetime and invalid dates", async () => {
  const created = await request(`/api/projects/${projectId}/tasks`, owner, {
    method: "POST",
    body: JSON.stringify({ title: "Date contract task" }),
  });
  assert.equal(created.status, 201);
  const { task } = (await created.json()) as { task: { id: string } };

  const dated = await request(`/api/projects/tasks/${task.id}`, owner, {
    method: "PATCH",
    body: JSON.stringify({ dueDate: "2032-02-29" }),
  });
  assert.equal(dated.status, 200);
  assert.equal(((await dated.json()) as { task: { dueDate: string } }).task.dueDate, "2032-02-29");

  for (const dueDate of [
    "2032-02-29T00:00:00.000Z",
    "not-a-date",
    "2031-02-29",
    "2030-13-01",
  ]) {
    const rejected = await request(`/api/projects/tasks/${task.id}`, owner, {
      method: "PATCH",
      body: JSON.stringify({ dueDate }),
    });
    assert.equal(rejected.status, 400, dueDate);
  }

  const cleared = await request(`/api/projects/tasks/${task.id}`, owner, {
    method: "PATCH",
    body: JSON.stringify({ dueDate: null }),
  });
  assert.equal(cleared.status, 200);
  assert.equal(((await cleared.json()) as { task: { dueDate: null } }).task.dueDate, null);
});

test("deleting a project cascades its tasks", async () => {
  const created = await request(`/api/projects/${projectId}/tasks`, owner, {
    method: "POST",
    body: JSON.stringify({ title: "Cascade task" }),
  });
  assert.equal(created.status, 201);
  const { task } = (await created.json()) as { task: { id: string } };

  await dbModule.db
    .delete(dbModule.projectsTable)
    .where(eq(dbModule.projectsTable.id, projectId));
  const rows = await dbModule.db
    .select({ id: dbModule.projectTasksTable.id })
    .from(dbModule.projectTasksTable)
    .where(eq(dbModule.projectTasksTable.id, task.id));
  assert.deepEqual(rows, []);
});