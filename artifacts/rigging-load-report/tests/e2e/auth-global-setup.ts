import { createClerkClient } from "@clerk/backend";
import { clerkSetup } from "@clerk/testing/playwright";
import { writeFile } from "node:fs/promises";
import { AUTH_TEST_STATE_PATH, type AuthTestState } from "./auth-test-state";

export default async function globalSetup(): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey =
    process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) {
    throw new Error(
      "Auth E2E requires CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY.",
    );
  }

  await clerkSetup({ publishableKey });
  const clerk = createClerkClient({ secretKey });
  const suffix = `${Date.now()}-${process.pid}`;
  const createdIds: string[] = [];

  const createUser = async (
    email: string,
    userType?: "employee" | "freelancer",
  ) => {
    const user = await clerk.users.createUser({
      emailAddress: [email],
      firstName: "Auth",
      lastName: "Regression",
      publicMetadata: userType ? { userType } : {},
      skipPasswordChecks: true,
      skipPasswordRequirement: true,
    });
    createdIds.push(user.id);
    return { id: user.id, email };
  };

  try {
    const state: AuthTestState = {
      employee: await createUser(`auth-e2e-${suffix}@ehs.no`, "employee"),
      freelancer: await createUser(
        `auth-e2e-${suffix}+freelancer@example.com`,
        "freelancer",
      ),
      unclassifiedExternal: await createUser(
        `auth-e2e-${suffix}+untagged@example.com`,
      ),
      staleEmployee: await createUser(
        `auth-e2e-${suffix}+stale@ehs.no`,
        "freelancer",
      ),
    };
    await writeFile(AUTH_TEST_STATE_PATH, JSON.stringify(state), "utf8");
  } catch (error) {
    await Promise.allSettled(createdIds.map((id) => clerk.users.deleteUser(id)));
    throw error;
  }
}