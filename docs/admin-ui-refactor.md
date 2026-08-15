# Admin UI Current Contract

This file records the current Admin UI rules and the latest state of routes
that have an approved refactor direction. It is not a chronological migration
log. Git history contains earlier refactor attempts.

## Shared contract

- Next.js App Router pages use the existing shadcn/ui and Radix primitives.
- Business pages preserve route, API, tenant, role, and mutation boundaries.
- Shared controls belong in `admin/src/components/ui/*`.
- Visible mutations use the shared success/failure operation feedback UI.
- Use `http://localhost:3005` for visual checks. Authenticated checks use the
  user's existing Chrome session.

## Route record format

Keep at most one current record per route. A record contains:

| Field | Required value |
| --- | --- |
| Route | Current pathname and page owner |
| Visual scope | The current surface changed or restored |
| Boundaries | Unchanged API, permission, tenant, and navigation contracts |
| Verification | Latest focused test/build or visual evidence |
| Open issue | Only unresolved current risk or next reopen trigger |

Replace the previous record when a route changes. Do not append dated progress
notes, superseded design sources, or repeated test transcripts.

## Current queue

Choose an unrecorded or explicitly queued route for a generic refactor request.
Do not reopen a route marked `Hold` unless the user names it, a reproducible
defect identifies it, its workflow contract changes, or a new design direction
is explicitly approved.

## Handoff

When a refactor changes visible behavior, update the route's single current
record and both language files. When it changes only implementation without a
route/API/permission or visual impact, state that in the handoff instead of
adding a new ledger entry.

Chinese mirror: [admin-ui-refactor.zh-CN.md](./admin-ui-refactor.zh-CN.md)
