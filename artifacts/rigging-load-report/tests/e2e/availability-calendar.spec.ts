import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { AUTH_TEST_STATE_PATH, type AuthTestState } from "./auth-test-state";

let users: AuthTestState;

test.use({ timezoneId: "UTC" });

test.beforeAll(async () => {
  users = JSON.parse(
    await readFile(AUTH_TEST_STATE_PATH, "utf8"),
  ) as AuthTestState;
});

async function signIn(
  page: Parameters<typeof clerk.signIn>[0]["page"],
  email: string,
) {
  await page.addInitScript(() => {
    sessionStorage.setItem("ehs-skip-dev-auto-signin", "1");
  });
  await page.goto("/");
  await clerk.loaded({ page });
  await clerk.signIn({ page, emailAddress: email });
  await page.goto("/");
}

function nextDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function availabilityFixture(
  day: string,
  replacementStatus: "available" | "unavailable",
) {
  const followingDay = nextDay(day);
  const dayAfterFollowing = nextDay(followingDay);
  return {
    // A bulk replacement response contains one authoritative full-day row
    // for this date. The cell must expose that manual state once.
    availability: [
      {
        id: "full-day-replacement",
        status: replacementStatus,
        startsAt: `${day}T00:00:00.000Z`,
        endsAt: `${followingDay}T00:00:00.000Z`,
        allDay: true,
        virtual: false,
      },
      // This is a legitimate split day and must remain three visible,
      // non-overlapping manual blocks with mixed statuses.
      {
        id: "morning-available",
        status: "available",
        startsAt: `${followingDay}T00:00:00.000Z`,
        endsAt: `${followingDay}T08:00:00.000Z`,
        allDay: false,
      },
      {
        id: "midday-busy",
        status: "unavailable",
        startsAt: `${followingDay}T08:00:00.000Z`,
        endsAt: `${followingDay}T12:00:00.000Z`,
        allDay: false,
      },
      {
        id: "afternoon-available",
        status: "available",
        startsAt: `${followingDay}T12:00:00.000Z`,
        endsAt: `${dayAfterFollowing}T00:00:00.000Z`,
        allDay: false,
      },
    ],
    externalBusy: [],
    holds: [],
  };
}

async function openAvailabilityCalendar(page: Page) {
  await page.goto("/portal/availability");
  await expect(page.getByRole("heading", { name: "Availability" })).toBeVisible();
}

async function mockAvailabilityApi(page: Page) {
  let persistedEntries: ReturnType<typeof availabilityFixture>["availability"] | undefined;

  await page.route("**/api/portal/calendar?*", async (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get("from");
    if (!from) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...availabilityFixture(from, "unavailable"),
        ...(persistedEntries ? { availability: persistedEntries } : {}),
      }),
    });
  });
  await page.route("**/api/portal/calendar/bulk", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as {
      entries: ReturnType<typeof availabilityFixture>["availability"];
    };
    persistedEntries = body.entries.map((entry, index) => ({
      ...entry, id: `saved-${index}`,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, availability: persistedEntries }),
    });
  });
}

test("renders one full-day replacement state while preserving mixed timed blocks", async ({
  page,
  context,
}) => {
  await setupClerkTestingToken({ context });
  await signIn(page, users.freelancer.email);
  await mockAvailabilityApi(page);
  const calendarRequestPromise = page.waitForRequest(
    (request) =>
      request.url().includes("/api/portal/calendar?") &&
      new URL(request.url()).searchParams.has("from"),
  );
  await openAvailabilityCalendar(page);

  // The first calendar cell can be a leading blank from the prior month, so
  // derive the requested range start from the calendar request instead.
  const calendarRequest = await calendarRequestPromise;
  const rangeStart = new URL(calendarRequest.url()).searchParams.get("from");
  expect(rangeStart).toBeTruthy();

  const replacementDay = page.locator(
    `.availability-cell[aria-label^="${rangeStart}:"]`,
  );
  await expect(replacementDay).toBeVisible();
  const replacementBadges = replacementDay.locator(
    "button.availability-time-badge",
  );
  await expect(replacementBadges).toHaveCount(1);
  await expect(
    replacementDay.locator("button.availability-time-badge--unavailable"),
  ).toHaveCount(1);
  await expect(
    replacementDay.locator("button.availability-time-badge--available"),
  ).toHaveCount(0);

  const splitDay = nextDay(rangeStart!);
  const splitDayCell = page.locator(
    `.availability-cell[aria-label^="${splitDay}:"]`,
  );
  const splitDayBadges = splitDayCell.locator(
    "button.availability-time-badge",
  );
  await expect(splitDayBadges).toHaveCount(3);
  await expect(
    splitDayCell.locator("button.availability-time-badge--available"),
  ).toHaveCount(2);
  await expect(
    splitDayCell.locator("button.availability-time-badge--unavailable"),
  ).toHaveCount(1);

  const available = page.getByRole("button", {
    name: "Set Month Available",
    exact: true,
  });
  const busy = page.getByRole("button", {
    name: "Set Month Busy",
    exact: true,
  });

  // Exercise both optimistic replacement directions. Each response is
  // persisted by the mocked API, so reload verifies the rendered state comes
  // from the authoritative response rather than only local optimistic state.
  await available.click();
  await expect(available).toHaveAttribute("aria-pressed", "true");
  await expect(
    replacementDay.locator("button.availability-time-badge"),
  ).toHaveCount(1);
  await expect(
    replacementDay.locator("button.availability-time-badge--available"),
  ).toHaveCount(1);

  await busy.click();
  await expect(busy).toHaveAttribute("aria-pressed", "true");
  await expect(
    replacementDay.locator("button.availability-time-badge"),
  ).toHaveCount(1);
  await expect(
    replacementDay.locator("button.availability-time-badge--unavailable"),
  ).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Availability" })).toBeVisible();
  const reloadedReplacementDay = page.locator(
    `.availability-cell[aria-label^="${rangeStart}:"]`,
  );
  await expect(
    reloadedReplacementDay.locator("button.availability-time-badge"),
  ).toHaveCount(1);
  await expect(
    reloadedReplacementDay.locator(
      "button.availability-time-badge--unavailable",
    ),
  ).toHaveCount(1);

  const reloadedSplitDayCell = page.locator(
    `.availability-cell[aria-label^="${splitDay}:"]`,
  );
  await expect(
    reloadedSplitDayCell.locator("button.availability-time-badge"),
  ).toHaveCount(1);
  await expect(
    reloadedSplitDayCell.locator(
      "button.availability-time-badge--available",
    ),
  ).toHaveCount(0);
  await expect(
    reloadedSplitDayCell.locator(
      "button.availability-time-badge--unavailable",
    ),
  ).toHaveCount(1);
});

test("keeps Available and Busy bulk toggle aria-pressed states exclusive", async ({
  page,
  context,
}) => {
  await setupClerkTestingToken({ context });
  await signIn(page, users.freelancer.email);
  await mockAvailabilityApi(page);
  await openAvailabilityCalendar(page);

  const available = page.getByRole("button", {
    name: "Set Month Available",
    exact: true,
  });
  const busy = page.getByRole("button", {
    name: "Set Month Busy",
    exact: true,
  });
  await expect(available).toHaveAttribute("aria-pressed", "false");
  await expect(busy).toHaveAttribute("aria-pressed", "false");

  await available.click();
  await expect(available).toHaveAttribute("aria-pressed", "true");
  await expect(busy).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.locator(
      '[aria-label="Set availability for current view"] button[aria-pressed="true"]',
    ),
  ).toHaveCount(1);

  await busy.click();
  await expect(available).toHaveAttribute("aria-pressed", "false");
  await expect(busy).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator(
      '[aria-label="Set availability for current view"] button[aria-pressed="true"]',
    ),
  ).toHaveCount(1);
});