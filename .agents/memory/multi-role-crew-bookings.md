---
name: Multi-role crew bookings
description: Identity boundary between separate roster role slots and one freelancer portal recipient.
---

Use the producer crew row's stable crewId as the immutable role-slot identity. One freelancer account may hold multiple independently actionable assignments and exact-linked gigs under the same project brief; the account receives one project entry that exposes each role.

**Why:** Account-level identity collapses same-person roles and can overwrite decisions, schedules, hotel data, or gig state. Exact assignment identity keeps role responses independent while still allowing one notification and one project URL.

**How to apply:** Scope response state, first-to-accept competition, gig lifecycle, roster edits, and producer reconciliation to crewId/brief-assignment identity. Aggregate only presentation-level person warnings; never fan persisted role data out by freelancer account.

Removing someone from an active booking must release their active assignment without deleting accepted work or payroll history.

**Why:** Producers need to free a booking slot even after acceptance, but removal is not permission to erase historical compensation or recorded work. Historical gigs must not reappear as active roster members on refresh.

**How to apply:** Validate the current role/account pair before removal, keep historical records, filter active views by current assignment membership, and reject stale saves that would recreate removed assignments.