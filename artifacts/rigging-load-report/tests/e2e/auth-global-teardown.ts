import { createClerkClient } from "@clerk/backend";
import { readFile, rm } from "node:fs/promises";
import { AUTH_TEST_STATE_PATH, type AuthTestState } from "./auth-test-state";

export default async function globalTeardown(): Promise<void> {
  const users = JSON.parse(
    await readFile(AUTH_TEST_STATE_PATH, "utf8"),
  ) as AuthTestState;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required to clean up auth E2E users.");
  }
  const clerk = createClerkClient({ secretKey });
  const results = await Promise.allSettled(
    Object.values(users).map((user) => clerk.users.deleteUser(user.id)),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new Error(`Failed to delete ${failures.length} auth E2E user(s).`);
  }
  await rm(AUTH_TEST_STATE_PATH, { force: true });
}