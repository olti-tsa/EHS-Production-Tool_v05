import { defineConfig } from "@playwright/test";

const externalBaseURL = process.env.AUTH_E2E_BASE_URL;
const baseURL = externalBaseURL ?? "http://127.0.0.1:4180";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "auth-roles.spec.ts",
    "project-task-board.spec.ts",
    "availability-calendar.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  globalSetup: "./tests/e2e/auth-global-setup.ts",
  globalTeardown: "./tests/e2e/auth-global-teardown.ts",
  webServer: externalBaseURL
    ? undefined
    : {
        command: "pnpm exec tsx tests/e2e/auth-web-server.ts",
        url: baseURL,
        timeout: 120_000,
        reuseExistingServer: false,
      },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
});