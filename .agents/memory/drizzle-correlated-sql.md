---
name: Drizzle correlated SQL
description: Prevents raw correlated subqueries from silently losing their outer-row relationship.
---

Qualify outer-table columns explicitly when embedding them in raw SQL
correlated subqueries. An unqualified interpolated column can be resolved by
PostgreSQL against the inner query instead, turning the intended correlation
into a self-comparison.

**Why:** This can make one matching inner row affect every outer row while the
query still succeeds and returns plausible-looking data.

**How to apply:** For raw `EXISTS` or scalar subqueries, inspect the rendered
SQL and cover at least two outer rows with different expected outcomes.