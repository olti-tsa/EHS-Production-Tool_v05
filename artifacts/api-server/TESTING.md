# API tests

Run the calendar authorization and producer-permission integration tests from
the workspace root:

```sh
pnpm --filter @workspace/api-server run test:api
```

The command uses the configured development `DATABASE_URL`, starts an
in-process Express server, and removes every test record it creates. It does
not call Clerk or an external calendar provider.