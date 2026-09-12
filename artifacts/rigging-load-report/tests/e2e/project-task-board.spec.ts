import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AUTH_TEST_STATE_PATH, type AuthTestState } from "./auth-test-state";

type Fixture = {
  projectId?: string;
  taskIds: Set<string>;
};

let users: AuthTestState;

test.beforeAll(async () => {
  users = JSON.parse(
    await readFile(AUTH_TEST_STATE_PATH, "utf8"),
  ) as AuthTestState;
});

async function api<T>(
  page: Page,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  await clerk.loaded({ page });
  return page.evaluate(
    async ({ apiPath, method, body }) => {
      const token = await window.Clerk.session?.getToken();
      const response = await fetch(apiPath, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(json.error || `${method ?? "GET"} ${apiPath} failed (${response.status})`);
      }
      return json;
    },
    { apiPath: path, method: init.method, body: init.body },
  ) as Promise<T>;
}

async function openFixture(page: Page, fixture: Fixture, title: string) {
  const created = await api<{ project: { id: string } }>(page, "/api/projects", {
    method: "POST",
    body: { name: title, venue: "", client: "", data: {} },
  });
  fixture.projectId = created.project.id;
  await page.evaluate(() => {
    localStorage.setItem("ehs:locale", "en");
  });
  await page.goto(`/project/${fixture.projectId}`);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.locator(".task-add-input")).toBeEnabled();
}

async function cleanFixture(page: Page, fixture: Fixture) {
  for (const taskId of fixture.taskIds) {
    await api(page, `/api/projects/tasks/${taskId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  }
  if (fixture.projectId) {
    await api(page, `/api/projects/${fixture.projectId}/archive`, {
      method: "POST",
    }).catch(() => undefined);
  }
}

test("rolls back failed detail edits and locks details while a save is pending", async ({
  page,
  context,
}) => {
  const fixture: Fixture = { taskIds: new Set() };
  const suffix = `${Date.now()}-${process.pid}`;
  const originalTitle = `Task board e2e ${suffix}`;
  const failedTitle = `Rejected title ${suffix}`;
  const failedDescription = `Rejected description ${suffix}`;
  const delayedTitle = `Delayed title ${suffix}`;
  const dueDate = "2031-06-17";
  let releasePatch: (() => void) | undefined;

  await setupClerkTestingToken({ context });
  await page.addInitScript(() => {
    sessionStorage.setItem("ehs-skip-dev-auto-signin", "1");
  });
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: users.employee.email });
  await page.goto("/");

  try {
    await openFixture(page, fixture, `Task board project ${suffix}`);

    await page.locator(".task-add-input").fill(originalTitle);
    const createResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/api\/projects\/[^/]+\/tasks$/.test(new URL(response.url()).pathname),
    );
    await page.locator(".task-add-form").getByRole("button", { name: "Add" }).click();
    const created = (await (await createResponse).json()) as {
      task: { id: string };
    };
    fixture.taskIds.add(created.task.id);

    const row = page.locator(".task-row", { hasText: originalTitle });
    await expect(row).toBeVisible();
    await row.locator(".task-cell-title").click();
    const title = page.locator(".task-sidebar-textarea.title-textarea");
    const description = page.locator(".task-form-group-flex textarea");

    const patchBodies: Record<string, unknown>[] = [];
    await page.route("**/api/projects/tasks/*", async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      patchBodies.push(body);
      if (body.title === failedTitle || body.description === failedDescription) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Controlled browser-test failure." }),
        });
        return;
      }
      await route.continue();
    });

    await title.fill(failedTitle);
    await description.click();
    await expect(page.getByText("Failed to update task.")).toBeVisible();
    await expect(title).toHaveValue(originalTitle);

    await description.fill(failedDescription);
    await title.click();
    await expect(description).toHaveValue("");

    await page.reload();
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.locator(".task-row", { hasText: originalTitle })).toBeVisible();
    await expect(page.getByText(failedTitle)).toHaveCount(0);
    await expect(page.getByText(failedDescription)).toHaveCount(0);
    await page
      .locator(".task-row", { hasText: originalTitle })
      .locator(".task-cell-title")
      .click();
    await expect(page.locator(".task-sidebar-textarea.title-textarea")).toHaveValue(
      originalTitle,
    );
    await expect(page.locator(".task-form-group-flex textarea")).toHaveValue("");

    const dueDateInput = page.locator('.task-board-sidebar input[type="date"]');
    const dueResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/projects/tasks/${created.task.id}`),
    );
    await dueDateInput.fill(dueDate);
    await dueResponse;
    expect(patchBodies.at(-1)).toEqual({ dueDate });

    const patchGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    await page.unroute("**/api/projects/tasks/*");
    await page.route("**/api/projects/tasks/*", async (route) => {
      if (route.request().method() === "PATCH") {
        await patchGate;
      }
      await route.continue();
    });

    const delayedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/api/projects/tasks/${created.task.id}`),
    );
    const delayedTitleInput = page.locator(".task-sidebar-textarea.title-textarea");
    await delayedTitleInput.fill(delayedTitle);
    await page.locator(".task-form-group-flex textarea").click();

    await expect(page.locator(".task-saving-indicator")).toHaveText("Saving...");
    await expect(delayedTitleInput).toBeDisabled();
    const detailSelects = page.locator(".task-board-sidebar select");
    await expect(detailSelects).toHaveCount(4);
    for (const detailSelect of await detailSelects.all()) {
      await expect(detailSelect).toBeDisabled();
    }
    await expect(dueDateInput).toBeDisabled();
    await expect(page.locator(".task-form-group-flex textarea")).toBeDisabled();

    releasePatch?.();
    await delayedResponse;
    await expect(page.locator(".task-saving-indicator")).toHaveCount(0);
    await expect(delayedTitleInput).toBeEnabled();
    await expect(delayedTitleInput).toHaveValue(delayedTitle);

    page.once("dialog", (dialog) => dialog.accept());
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith(`/api/projects/tasks/${created.task.id}`),
    );
    await page.locator(".task-row", { hasText: delayedTitle }).locator(".task-delete-btn").click();
    await deleteResponse;
    fixture.taskIds.delete(created.task.id);
    await expect(page.locator(".task-row", { hasText: delayedTitle })).toHaveCount(0);
  } finally {
    releasePatch?.();
    if (!page.isClosed()) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await cleanFixture(page, fixture);
    }
  }
});