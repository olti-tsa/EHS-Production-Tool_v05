import { createClerkClient } from "@clerk/backend";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AUTH_TEST_STATE_PATH, type AuthTestState } from "./auth-test-state";

let users: AuthTestState;

test.beforeAll(async () => {
  users = JSON.parse(
    await readFile(AUTH_TEST_STATE_PATH, "utf8"),
  ) as AuthTestState;
});

async function signIn(page: Parameters<typeof clerk.signIn>[0]["page"], email: string) {
  await page.addInitScript(() => {
    sessionStorage.setItem("ehs-skip-dev-auto-signin", "1");
  });
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/");
}

async function getApiStatus(
  page: Parameters<typeof clerk.signIn>[0]["page"],
  path: string,
): Promise<number> {
  await clerk.loaded({ page });
  return page.evaluate(async (apiPath) => {
    const token = await window.Clerk.session?.getToken();
    const response = await fetch(apiPath, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.status;
  }, path);
}

async function expectRole(
  page: Parameters<typeof clerk.signIn>[0]["page"],
  role: "employee" | "freelancer",
) {
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("ehs-user-role")))
    .toBe(role);
}

test("keeps employee and freelancer roles authoritative across one browser session", async ({
  page,
  context,
}) => {
  await setupClerkTestingToken({ context });

  await signIn(page, users.employee.email);
  await expect(page).not.toHaveURL(/\/portal(?:\/|$)/);
  await expectRole(page, "employee");
  await page.reload();
  await expectRole(page, "employee");
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/portal(?:\/|$)/);
  await clerk.signOut({ page });

  await signIn(page, users.freelancer.email);
  await expect(page).toHaveURL(/\/portal(?:\/|$)/);
  await expectRole(page, "freelancer");
  await page.reload();
  await expectRole(page, "freelancer");
  await page.goto("/");
  await expect(page).toHaveURL(/\/portal(?:\/|$)/);
  expect(await getApiStatus(page, "/api/projects")).toBe(403);
  await clerk.signOut({ page });

  await signIn(page, users.employee.email);
  await expect(page).not.toHaveURL(/\/portal(?:\/|$)/);
  await expectRole(page, "employee");
});

test("denies an unclassified external account even when its role-tag request fails", async ({
  page,
  context,
}) => {
  await setupClerkTestingToken({ context });
  await page.route("**/api/portal/me/tag-as-freelancer", (route) => route.abort());
  await page.addInitScript(() => {
    sessionStorage.setItem("ehs-login-intent", "freelancer");
    sessionStorage.setItem("ehs-auth-mode", "signUp");
  });
  await signIn(page, users.unclassifiedExternal.email);
  await expect(page).toHaveURL(/\/portal(?:\/|$)/);
  expect(await getApiStatus(page, "/api/projects")).toBe(403);
});

test("repairs a stale freelancer tag for a verified EHS employee", async ({
  page,
  context,
}) => {
  await setupClerkTestingToken({ context });
  await signIn(page, users.staleEmployee.email);
  await expect(page).not.toHaveURL(/\/portal(?:\/|$)/);
  expect(await getApiStatus(page, "/api/projects")).toBe(200);

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is required");
  const repaired = await createClerkClient({ secretKey }).users.getUser(
    users.staleEmployee.id,
  );
  expect(repaired.publicMetadata.userType).toBe("employee");
});