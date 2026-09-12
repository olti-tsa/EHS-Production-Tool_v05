---
name: Clerk browser regression harness
description: Non-obvious lifecycle rules for reliable Clerk role tests in this workspace.
---

Disable the development auto-login shortcut before the browser's first navigation, and delete shared Clerk fixtures in one global teardown rather than a worker-local teardown.

**Why:** The dev shortcut can win the race against programmatic Clerk sign-in. Playwright may replace a failed worker, so worker-local cleanup can remove fixtures that later tests still need.

**How to apply:** Any multi-account Clerk browser suite should set the skip flag with an init script before loading the app, keep fixture state outside workers, and make final cleanup fail loudly if any user deletion fails.

Calendar browser fixtures must model authoritative bulk replacement, not append stale states or retain timed blocks inside a replaced month.

**Why:** Invented overlapping recurrence fixtures tested behavior the read API does not promise, and retaining old split blocks after a month replacement falsely suggested those blocks should survive.

**How to apply:** Keep API/database integrity checks separate from rendering checks. Persist the submitted replacement entries in browser mocks for reload assertions; check legitimate mixed blocks before replacing their range.