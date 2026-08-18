# Admin UI Current Contract

This file records the current Admin UI rules and the latest state of routes
that have an approved refactor direction. It is not a chronological migration
log. Git history contains earlier refactor attempts.

## Shared contract

- Next.js App Router pages use the established Ant Design 5 and Ant Design Pro
  system, including the shared `AdminAntdProvider` token configuration.
- Use `PageContainer`, `ProTable`, Ant Design form/feedback primitives, and
  established Admin business components where they fit the workflow. Do not
  introduce a parallel UI system for new Admin work.
- Business pages preserve route, API, tenant, role, and mutation boundaries.
- Shared Admin controls belong in `admin/src/components/admin/*` or the
  established business-component area.
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

## Current route records

| Route | Visual scope | Boundaries | Verification | Open issue |
| --- | --- | --- | --- | --- |
| `/lead-commissions` — merchant three-role commission workbench | Approved source `design-references/referrer-network-appointment-v1/phase-7-three-role-commission-admin-v1.png` (1487x1058 PNG, SHA-256 `DAA7ED1235C474F0C6A0D7FC625A5DD0BD9D97E54F580AB4CD530CE743AB2A1C`): header, separate referrer/designer/measurer rule cards, ledger filters, payable selection, confirmed batch paid action, and amount summaries | New route remains separate from `/acquisition-commissions`; route/API permission `lead-commissions` is limited to `super_admin`, `admin`, and `enterprise_admin`; tenant/RLS boundaries and the existing rule/report/paid APIs are unchanged | Focused PostgreSQL commission test, ESLint, and `npm run build` pass. Authenticated Chrome verification at `http://localhost:3005/lead-commissions` confirms the sidebar entry, all three active rule cards, filters, empty ledger state, disabled paid action, and totals | Reopen only for a changed approved source, an observed populated-ledger layout defect, or a workflow/permission-contract change |
| `/referrer-network-operations` — referral-network operations and acceptance workbench | Established Ant Design/Admin Pro direction: dual-code controls, assignment-eligibility table, and a real-state acceptance checklist whose rows expose direct operating links | Route and `referrer-network-operations` permission remain limited to `super_admin`, `admin`, and `enterprise_admin` in the selected tenant. The checklist treats appointment defaults as pending until an administrator saves them; it never creates test records or bypasses customer authorization | Focused lint passes. Authenticated Chrome on the live current dev build at `localhost:3006` confirmed all seven readiness rows, their actions, and the appointment-default pending state | Deploy the current build to the prescribed `localhost:3005` target, or reopen for an observed checklist/code workflow defect |
| `/appointment-settings` — enterprise appointment policy | Established Ant Design/Admin Pro settings-sheet direction: confirmation banner, timezone, seven-day multi-window availability rows, and numeric booking boundaries with one primary save action | Reuses `GET/PUT /api/appointment-settings` and the `referrer-network-operations` permission for selected-tenant `super_admin`, `admin`, and `enterprise_admin`; saving confirms the default policy without changing appointment-role APIs | Focused ESLint and production build pass. Authenticated Chrome on `localhost:3006` confirmed the default-pending alert, loaded seven-day schedule, add-window controls, booking boundaries, and enabled save action. The stale service on `localhost:3005` returned 404 for this new route | Deploy the current build to `localhost:3005`, or reopen for policy-contract changes or a reproducible form defect |

## Handoff

When a refactor changes visible behavior, update the route's single current
record and both language files. When it changes only implementation without a
route/API/permission or visual impact, state that in the handoff instead of
adding a new ledger entry.

Chinese mirror: [admin-ui-refactor.zh-CN.md](./admin-ui-refactor.zh-CN.md)
