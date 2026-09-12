# API tests

Run the calendar authorization and producer-permission integration tests from
the workspace root:

```sh
pnpm --filter @workspace/api-server run test:api
```

The command uses the configured development `DATABASE_URL`, starts an
in-process Express server, and removes every test record it creates. It does
not call Clerk or an external calendar provider.

Run just the calendar range-replacement regressions (including month/week
Available → Busy replacement and preservation of both outside fragments):

```sh
pnpm --filter @workspace/api-server run test:calendar
```

This includes database-backed HTTP tests and the interval/rule unit tests.
Fixtures use unique owner IDs and are removed when the suite finishes.