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
- Use `http://localhost:3006` for visual checks. Authenticated checks use the
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
| `/lead-commissions` — merchant three-role commission workbench | Approved source `design-references/referrer-network-appointment-v1/phase-7-three-role-commission-admin-v1.png` (1487x1058 PNG, SHA-256 `DAA7ED1235C474F0C6A0D7FC625A5DD0BD9D97E54F580AB4CD530CE743AB2A1C`): header, separate referrer/designer/measurer rule cards, ledger filters including lead source (`referrer_network` / `staff_activity`), payable selection, confirmed batch paid action, and amount summaries | New route remains separate from `/acquisition-commissions`; route/API permission `lead-commissions` is limited to `super_admin`, `admin`, and `enterprise_admin`; tenant/RLS boundaries and the existing rule/report/paid APIs are unchanged | Focused PostgreSQL commission test, ESLint, and `npm run build` pass. Authenticated Chrome verification at `http://localhost:3006/lead-commissions` confirms the sidebar entry, all three active rule cards, filters, empty ledger state, disabled paid action, and totals | Reopen only for a changed approved source, an observed populated-ledger layout defect, or a workflow/permission-contract change |
| `/referrer-network-operations` — referral-network operations and acceptance workbench | Established Ant Design/Admin Pro direction: readiness counts, an actionable real-state acceptance checklist whose rows expose direct operating links, and a five-row join-code audit preview. Dual-code CRUD, the referrer roster, assignment-eligibility tables, and the full audit are no longer on this page. Promotion-code readiness displays the persisted active-code count separately from active memberships and links to `/referrers`. The Mini Program code-provider item reports availability only and links to selected-tenant delivery diagnostics; it does not present platform credentials as enterprise-configurable | Route and `referrer-network-operations` permission remain limited to `super_admin`, `admin`, and `enterprise_admin` in the selected tenant. Sibling pages `/join-codes`, `/referrers`, and `/appointment-settings` reuse that permission. The checklist treats appointment defaults as pending until an administrator saves them; it never creates test records or bypasses customer authorization | Focused PostgreSQL tests and attribution contract tests pass. Authenticated Admin visual QA of the split navigation remains to be added | Reopen only for an observed checklist workflow defect or a workflow/permission-contract change |
| `/join-codes` — enterprise staff and referrer onboarding codes | Established Ant Design/Admin Pro direction: two code cards with rotate/disable/view/download QR, plus the full join-code audit table. Tokens never appear in the Admin page or list DTO. QR display remains a 90-second private Blob | Reuses `GET /api/enterprise/join-codes` (codes + events) and existing rotate/disable/image endpoints under `referrer-network-operations`. Does not create referrer or staff records | Focused attribution contract tests pass. Authenticated Chrome QA pending | Reopen only for a dual-code contract change or a reproducible QR/audit defect |
| `/referrers` — enterprise referrer roster | Established Ant Design/Admin Pro ProTable: display name, phone, join time, promotion-code presence, membership status, name/phone search, and disable-scan. No Admin create form | Reuses `GET /api/enterprise/referrer-memberships` and `POST /api/enterprise/referrer-memberships/[id]/disable` under `referrer-network-operations`. Historical leads and commissions are unchanged by disable | Focused PostgreSQL roster tests pass. Authenticated Chrome QA pending | Reopen only for a membership-contract change or a reproducible roster defect |
| `/appointment-settings` — enterprise appointment policy | Established Ant Design/Admin Pro settings-sheet direction: confirmation banner, timezone, seven-day multi-window availability rows, and numeric booking boundaries with one primary save action | Reuses `GET/PUT /api/appointment-settings` and the `referrer-network-operations` permission for selected-tenant `super_admin`, `admin`, and `enterprise_admin`; the merchant sidebar now places this route under the referral-network category. Saving confirms the default policy without changing appointment-role APIs | Focused lint and `npm run build` pass. Authenticated Chrome on `http://localhost:3006` confirmed the confirmation state, loaded seven-day schedule, add-window interaction, booking boundaries, and enabled save action | Reopen only for a policy-contract change or a reproducible form defect |
| `/` — designer/measurer employee workbench | Existing Ant Design/Admin Pro home direction: role-specific metrics, assigned lead/survey-task lists including unscheduled staff-activity survey tasks with immediate-survey and book-appointment tags, appointment summary, and links into existing lead/floor-plan/AI surfaces; measurers see an explicit boundary that formal BLE surveying remains in the Mini Program | The home derives the role from the Admin Cookie session; `GET /api/workbench/staff` uses a tenant transaction and returns only the current designer/measurer scope. `/leads`, `/measurements`, `/floorplans`, AI routes, and the Mini Program's formal-survey permission boundaries are unchanged | API/component wiring and `git diff --check` complete. Repository-wide `lint`/`tsc` remain blocked by pre-existing errors; role-authenticated visual QA is pending | Reopen only for a role workflow, data-scope, or formal-survey-entry contract change; this phase does not migrate the H5/BLE editor |
| `/leads` and `/leads/[id]` — lead operations and appointment handoff | Existing Ant Design ProTable keeps filtering, pagination, loading, and batch selection while `tableViewRender` renders each lead as a responsive ProCard with grouped customer, assignment, referrer, appointment, and action sections. `/leads/[id]` is a route handoff to the shared drawer, preserving one detail surface; create/reschedule dialogs use the shared Mini Program pattern: segmented date selection plus server-backed available-slot selection, with Ant Design controls and shared tokens; the global Modal footer keeps a consistent content-to-action separation | Lead list/detail DTOs expose assigned measurer, latest confirmed appointment, and the resolved referrer for `referrer_network` leads; Admin Cookie designers and enterprise admins may read `/api/appointments/availability`, create, and internally reschedule appointments within their tenant, with designers restricted to their own leads through `/api/appointments` and `/api/appointments/[id]/internal-reschedule`; tenant and existing archive/conversion permissions remain unchanged | `git diff --check`, focused ESLint, and Impeccable detector pass. Earlier authenticated Chrome QA confirmed the populated card and responsive no-overflow layout; the post-selector visual recheck was blocked by a stale Chrome debug connection during Fast Refresh, and no appointment mutation was submitted; the shared Modal footer rule now covers text-area counts and action-button spacing | Reopen only for an observed populated card layout defect, responsive clipping, or an appointment/referrer permission or workflow contract change |

## Handoff

The `/leads` appointment handoff now exposes `Add/Edit service address` in the existing appointment detail area. It keeps the established Ant Design drawer, shared operation feedback, tenant boundary, and staff-role checks; designers and measurers use the same appointment address API for follow-up completion.

When a refactor changes visible behavior, update the route's single current
record and both language files. When it changes only implementation without a
route/API/permission or visual impact, state that in the handoff instead of
adding a new ledger entry.

Chinese mirror: [admin-ui-refactor.zh-CN.md](./admin-ui-refactor.zh-CN.md)
