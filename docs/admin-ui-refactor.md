# Admin UI Refactor

## Goal

Keep the existing Next.js App Router and server-side business APIs while
introducing a consistent admin application layer based on Ant Design and
Ant Design ProComponents.

The first milestone is the AI provider management surface. It is the reference
implementation for future page migrations and must be accepted before the
remaining admin pages are migrated.

## Target Stack

- Next.js App Router remains the routing and deployment runtime.
- `antd` supplies the base controls and visual tokens.
- `@ant-design/pro-components` supplies `ProTable`, `ProForm`,
  `ProDescriptions`, `PageContainer`, and `ProLayout`-compatible patterns.
- `@ant-design/nextjs-registry` prevents CSS-in-JS style flashes in App Router.
- Existing API routes, JWT/cookie authentication, tenant helpers, SWR hooks,
  Mongoose models, and operation feedback remain authoritative.

## Routing Contract

The first migrated module uses real URL boundaries:

- `/ai-providers`: provider list, provider creation entry, and operational actions.
- `/ai-providers/new`: create a provider.
- `/ai-providers/[id]`: view and edit one provider.
- `/ai-models`: platform image-model catalog, default-model selection, enablement,
  and reference-image limits. It reuses the `ai-providers` platform permission.

List actions that change configuration must navigate to a route. Operational
actions such as connectivity testing, balance lookup, model sync, disabling,
and deletion remain in a row action menu and use the shared operation feedback
UI. Deletion requires confirmation and is available only when the backend finds
no provider-attempt audit reference; otherwise it returns `409` and the provider
must remain disabled. This is the standard bulk-destructive pattern for future
admin list pages: row selection, an explicit selected-count action, confirmation,
one bounded batch request, shared success/failure feedback, and a result that
keeps protected or missing records visible to the operator.

## Shared UI Contract

- One light admin shell with a stable sidebar and a full-width workspace region.
  Management pages fill the area beside the sidebar and retain only the shared
  responsive horizontal gutters (`20px` on compact screens and `28px` from
  `sm`); do not introduce a centered maximum-width page frame.
- Route metadata lives in `admin/src/config/admin-routes.ts` and is reused by
  navigation, breadcrumbs, and page headers.
- Migrated management pages use ProComponents `PageContainer` for the page-level
  title area. Its `title`, `content`, `onBack`, and `extra` props are the
  standard for page title, description, return navigation, and page actions;
  do not create a page-specific header component or hand-assemble this pattern.
- `PageContainer` provides the page header and content boundary, but it does not
  space business blocks. The shared admin shell gives the children container a
  `24px` top inset below the header divider; pages must not add a second manual
  top margin for the first block. Pages with multiple blocks wrap them in `Flex
  vertical gap={24}` (or a documented ProComponents `ProCard`/Ant Design
  `Space` layout).
- New management lists use `ProTable` or the shared table wrapper, with a single
  filter row, consistent pagination, status tags, and a final action column.
- New forms use `ProForm` controls and a single primary submit action.
- Provider forms are driven by `src/lib/ai/provider-adapter-manifest.ts`. The
  shared page renders common endpoint, credential, capability, routing, and
  cost controls first; an adapter may declare narrowly scoped config fields
  only where its protocol requires them. The backend validates the same
  declaration before saving `adapterConfig`.
- Provider credentials retain the legacy encrypted `apiKey` fields for current
  runtime compatibility and also write masked/encrypted credential maps. A new
  adapter must declare and consume any additional credential fields in its
  server adapter; adding a frontend label alone is not an integration.
- Details use `ProDescriptions` for read-only metadata and grouped sections for
  editable configuration.
- `ProForm` submit actions use its `submitter.render` hook with the shared
  `Flex` action row and a `24px` top gap from the final content block.
- Use Ant Design `Flex` or `Space` with explicit gaps for sibling layout: `24px`
  between page sections and `16px` inside a configuration section unless the
  content relationship requires another documented value. Do not create spacing
  by stacking child margins.
- Use `Select` or `ProFormSelect` for option sets. Where a known option set also
  permits a new value, use `Select mode="tags"`; do not recreate a select with
  `Input` plus `datalist` or another raw HTML control.
- All visible mutations continue to call `components/ui/operation-feedback`.
- No raw native `select`, checkbox, radio, `datalist`, or `alert()` is introduced
  in the migrated surface.

## Migration Sequence

1. AI providers: list, create, detail/edit, and the separate platform model catalog.
2. AI presets and AI credit prices.
3. Media storage and platform configuration pages.
4. Enterprise, staff, orders, and promotion management pages.
5. Merchant workbench pages and AI creation surfaces after their interaction
   contracts are audited separately.

Each step must preserve route permissions, tenant boundaries, APIs, models, and
documented limitations. A page is considered migrated only after lint, build,
desktop/mobile visual checks, and browser verification pass.

## Migration Progress

- The AI provider, image-model catalog, AI preset, and AI credit-price surfaces
  use the shared Ant Design ProComponents page patterns.
- `/roles` now uses `PageContainer`, Ant Design configuration panels, and a
  controlled `Checkbox.Group` for default-role menu maintenance. It preserves
  the existing `/api/roles` default seeding and PATCH behavior, platform
  `admin`/`super_admin` boundary, role menu-key contract, and existing-account
  permission semantics.
- `/media-storage` now uses `PageContainer`, Ant Design configuration panels,
  `ProTable`, and `ModalForm`. The existing storage APIs, `media-storage`
  permission boundary, encrypted credentials, test-before-activation rule, and
  archive behavior are unchanged.
- `/enterprises` now uses `PageContainer` and `ProTable` for enterprise search,
  pagination, status review, and operational actions. Its existing APIs and
  `super_admin`/`admin` platform boundary remain intact.
- `/enterprises/[id]` and the shared enterprise editor now use `PageContainer`,
  Ant Design cards, `ProDescriptions`, and `ModalForm`/`ProForm` for the tenant
  overview, enterprise profile, AI/automation navigation, and manual/edit form.
  Existing enterprise APIs, Base64 logo size limit, operation feedback, and the
  platform `super_admin`/`admin` boundary remain unchanged. The enterprise AI
  and automation subpages now use the same `PageContainer` tab pattern. Their
  existing AI credit API and enterprise PATCH payloads are unchanged; policy,
  adjustment, ledger/task review, notification, and SLA controls now use Ant
  Design `Checkbox.Group`, `Select`, `ProForm`, and `ProTable` controls.
- `/promotion-records` now uses `PageContainer`, `ProTable`, `ProForm`, and
  `ProDescriptions` for the report list, platform protection-rule configuration,
  report detail, follow-up, assignment, pool, and claim-review interactions.
  Its existing PostgreSQL-backed APIs, `salesperson` self-claim boundary, and
  `admin`/`super_admin` configuration and pool-management boundary are unchanged.
- `/workflow-logs` now uses `PageContainer`, Ant Design summary cards, and
  `ProTable` for server-paginated notification-log review and status filtering.
  Its existing PostgreSQL notification-log API, enterprise-admin read scope,
  and `admin`/`super_admin` reminder-scan boundary are unchanged; table-load and
  scan failures use the shared operation feedback UI.
- `/staff` now uses `PageContainer`, `ProTable`, `ModalForm`, and Ant Design
  `Tree` for server-paginated staff search, department filtering, and staff or
  department maintenance. The existing tenant-scoped staff/department APIs and
  `enterprise_admin`/`admin`/`super_admin` mutation boundary are unchanged.
- `/admins` now uses `PageContainer`, `ProTable`, and `ModalForm` for account
  search, scope and role filtering, creation, editing, password resets, status
  changes, and deletion. The existing PostgreSQL-backed `admin-users` APIs,
  `admins` menu-permission route guard, decimal-string `_id` DTO contract, and
  rule that salesperson accounts have no enterprise binding are unchanged; the
  form exposes only the five roles accepted by those APIs.
- `/users` and `/users/[openid]` now use `PageContainer`, `ProTable`, and
  `ProDescriptions` for paginated Mini Program user audit, identity metadata,
  and formal floor-plan review. `/api/users` accepts optional `page` and
  `limit` query parameters for this server pagination while retaining its
  existing `data` and `count` response fields. The PostgreSQL user/floor-plan
  data source, `users` menu-permission route guard, and read-only admin flow
  remain unchanged.
- `/floorplans` now uses `PageContainer` and `ProTable` for server-paginated
  formal-plan search, status filtering, and viewer navigation. Its geometry
  summary reads only closed spaces, walls, and openings from the formal v4
  `surveyGraph`; it does not read or write legacy layout fields. `GET
  /api/floorplans` now accepts optional `status` filtering, while its existing
  tenant scope, `floorplans` permission, viewer, and DXF behavior remain
  unchanged.
- `/enterprise-orders` now uses `PageContainer`, `ProTable`, and `ModalForm`
  for order search, status review, status transitions, enterprise activation,
  and order creation. Its existing PostgreSQL-backed order, package, promotion,
  commission, and activation APIs, plus the `enterprise_admin`/`admin`/
  `super_admin` order-mutation and `admin`/`super_admin` activation boundaries,
  are unchanged.
- `/packages` now uses `PageContainer`, `ProTable`, and `ModalForm` for
  package search, status review, creation, editing, and deletion. Its existing
  PostgreSQL-backed package API and `admin`/`super_admin` platform boundary are
  unchanged. Per-row deletion is guarded while the request is in flight,
  table-load failures use the shared operation feedback UI, and the filter row
  stacks on narrow screens.
- `/commissions` now uses `PageContainer`, Ant Design summary cards, and
  `ProTable` for status review, search, and settlement actions. Its existing
  PostgreSQL-backed commission APIs, salesperson read scope, and
  `admin`/`super_admin` settlement boundary are unchanged. Table-load failures
  use the shared operation feedback UI; settlement remains guarded per record,
  and the filter row stacks on narrow screens.
- The shared `/` dashboard now uses `PageContainer` and Ant Design summary/list
  components. Its workbench contract has been audited: platform users only see
  implemented user, formal-floor-plan, and enterprise totals; all non-platform
  roles see their existing PostgreSQL/RLS-scoped workbench cards and todos; and
  only `enterprise_admin` additionally sees tenant-scoped asset totals. Mock
  operational-health claims and the unsupported AI-generation entry were
  removed. Existing routes, APIs, and permissions are unchanged.
- Other platform configuration pages remain in the third migration step and
  require their interaction contracts to be audited before implementation.

## Refactor Selection And Route Ledger

This section is the operational record for recurring Admin UI work. It is not a
historical roadmap. Before choosing a route for a generic “continue refactoring”
request, read the latest row here and its Chinese mirror.

- `Hold` means the current route is excluded from generic refactor selection.
  It may be reopened only for the recorded trigger.
- `Queued` means an unambiguous next candidate after its workflow and current UI
  have been audited.
- `Unrecorded` routes may be considered only after comparing them with this
  ledger and the Admin module inventory.
- Each completed UI change replaces the route's latest row with its new date,
  scope, unchanged boundaries, verification, remaining QA, and reopen trigger;
  do not append duplicate history rows for the same route.

| Route or surface | Latest UI scope | State | Verification / remaining QA | Reopen only when |
| --- | --- | --- | --- | --- |
| `/leads` | 2026-08-10: the detail drawer now displays the designer captured at lead creation as read-only, replacing the generic responsible-staff selector. `PUT /api/leads/[id]` rejects `assignedTo`, so a lead cannot be reassigned outside Staff; changing a measurer's designer binding in `/staff` continues to affect future leads only. Customer workflow, acquisition facts, tenant scope, role permissions, paging, and floor-plan/follow-up actions are unchanged. | Hold | Targeted ESLint, production build, and `git diff --check` passed. Authenticated visual QA at `http://localhost:3006/leads` confirmed the updated Binding Designer table header; detail-state QA remains pending because the current environment has no lead records. | A change to creation-time designer ownership, acquisition permission, or customer workflow, or a reproducible authenticated visual defect. |
| `/staff` | 2026-08-10: migrated the designer QR-code field to the shared `ImageUploadField`, which renders Chinese-first format/size guidance exactly once and provides a picture-card thumbnail, full-size preview, replacement, and removal while keeping the existing multipart upload request. The department-tree overview, route, existing API contract, enterprise media ownership, and staff-management permission boundary are unchanged. | Hold | Targeted ESLint for the shared component and affected staff/enterprise/inspiration files passed. Authenticated desktop/mobile screenshot QA, including a real image upload and preview, is still required. | A reproducible authenticated upload or visual defect, the user names `/staff`, or its workflow contract changes. |
| `/devices` | 2026-08-05: shared filtered-status overview strip above the existing device list and dialogs. | Hold | Targeted ESLint passed. Authenticated desktop/mobile screenshot QA is still required. | The outstanding screenshot QA finds a defect, the user names `/devices`, or its device workflow contract changes. |
| `/measurements` | 2026-08-05: shared filtered audit overview strip for BLE/manual/floor-plan counts above the existing 100-record list. | Hold | Targeted ESLint passed. Authenticated desktop/mobile screenshot QA is still required. | The outstanding screenshot QA finds a defect, the user names `/measurements`, or its audit workflow contract changes. |
| `/ai-providers`, `/ai-models`, `/ai-presets`, `/ai-credit-prices` | 2026-08-07: added confirmed single and selected-row bulk deletion to the AI-provider menu/table. Bulk deletion is bounded to 1-100 IDs and reports deleted, audit-protected, and missing items; disabling retains its PATCH state change. Routes, platform `super_admin`/`admin` permission, provider model, and unrelated catalog workflows remain unchanged. | Hold | Targeted ESLint and `git diff --check` passed; the prior production build passed before this incremental bulk-delete addition. Unauthenticated browser navigation correctly redirects to `/login`; authenticated visual/interaction QA remains pending. | A provider/catalog workflow, permission, accepted design change, or a reproducible authenticated visual defect. |
| `/floorplans` | 2026-08-10: the list and read-only viewer now use the shared customer-facing display identity: linked community as the title and `customer · 第 N 次量房` as the secondary text, rather than the persisted dated formal-survey name. `GET /api/floorplans` now returns that read-only display object, derived from the stable `lead_floor_plans.measurement_sequence`; persisted names, v4 geometry, filters, DXF, tenant scope, and `floorplans` permission remain unchanged. | Hold | Targeted ESLint, display-helper tests, Mini Program label tests, and `git diff --check` passed. Authenticated desktop list/detail visual QA is still required after applying migration `0018_floor_plan_display_sequence`. | A reproducible display-identity defect, a floor-plan/link data-contract change, or explicit user request for `/floorplans`. |
| `/media-storage`, `/enterprises`, `/promotion-records`, `/workflow-logs`, `/enterprise-orders`, `/packages`, `/commissions`, `/roles`, `/users`, `/admins`, `/` | 2026-08-10: the enterprise editor's Logo field now uses the shared single-image `ImageUploadField`, with local validation, thumbnail, full-size preview, replacement, and removal. Existing Base64 persistence, routes, API, and platform permissions are unchanged. Other listed presentation migrations remain as documented above. | Hold | Targeted ESLint for the shared component and enterprise editor passed; authenticated enterprise-editor upload/preview QA is still required. | The user names the route, a reproducible visual defect exists, or its workflow contract changes. |
| `/acquisition-commissions`, `/acquisition-commissions/settings` | 2026-08-10: moved fixed acquisition-commission configuration out of Staff and into the acquisition-commission domain. The record page now separates settlement records from the rule page; only the enterprise administrator can read or update its own enterprise's fixed amount through the dedicated settings API. Existing commission settlement, tenant boundaries, and confirmation-time amount snapshots remain unchanged. | Hold | Targeted lint and authenticated enterprise-admin visual/interaction QA are pending. | The user names either route, a reproducible visual defect exists, or the commission rule/settlement contract changes. |
| `/inspirations` | 2026-08-10: replaced the form-local cover/rendering image upload control with the shared `ImageUploadField`, preserving its 500KB Base64 form values while adding picture-card thumbnail, full-size preview, replacement, and removal. The existing list overview, routes, API, tenant scope, and permissions are unchanged. | Hold | Targeted ESLint for the shared component and inspirations page passed; authenticated form upload/preview QA is still required. | The outstanding QA finds a defect, the user names `/inspirations`, or its workflow contract changes. |
| `/ai-studio/scenarios` and embedded quick tools | 2026-08-05: audited customer-workflow, quick-tool, and assistant entry contracts; aligned their shared workspace to full-width responsive gutters and made the view switch a semantic pressed segmented control. | Hold | Targeted ESLint and authenticated desktop/mobile screenshot QA are pending. | The outstanding QA finds a defect, the user names `/ai-studio/scenarios`, or its workflow contract changes. |
| `/ai-studio/create` | 2026-08-07: fixed the generated-task execution layout by using the shared `lg` breakpoint for the `1024px` desktop arrangement; the centred summary/result strip and bottom prompt/parameter panel no longer inherit the mobile `sm` height/top rules. The task-list row is now a non-button interactive container so its menu button does not create invalid nested buttons. Free-creation renders every persisted batch as an in-task conversation, preserves per-round prompt/reference context, appends a batch for an existing task, and scrolls to the newest round after opening or submitting. The desktop conversation viewport now expands between the summary and prompt panel, hides native vertical/horizontal scrollbars while retaining wheel/trackpad scrolling, and keeps round actions below the scrollable content. Completed result DTOs still use the persisted asset URL directly. Routes, `ai-scenarios` permission, task data, and generation behavior are unchanged. | Hold | Targeted ESLint and authenticated Chrome desktop QA passed at `1920x919`: two existing batches rendered as separate round cards, latest-round auto-positioning remained intact, and the task-list DOM contains no nested buttons. Follow-up layout QA verified the viewport grows above the bottom panel, scrollbar chrome is hidden, and wheel scrolling remains available; mobile QA remains pending. | A reproducible visual defect, the user names `/ai-studio/create`, or its workflow contract changes. |
| Remaining Admin routes not represented above | No current ledger record. | Unrecorded | Audit their live workflow, current page, module inventory, permissions, and mobile/desktop state before proposing work. | The audit establishes it as the next candidate. |

## Current Queue

No route is implicitly queued merely because it has a simple table layout. The
next generic Admin UI refactor must first audit the unrecorded routes and present
a short, evidence-backed candidate list. It must not revisit the four 2026-08-05
merchant list routes just to make another visual pass.

## Acceptance Criteria For Milestone One

- `/ai-providers/new`, `/ai-providers/[id]`, and `/ai-models` are directly reachable and
  browser back/forward navigation works.
- Provider create/edit, API key rotation, cost rules, connectivity test,
  balance lookup, model sync, disable, single/bulk deletion, and model catalog persistence
  keep their documented API behavior.
- Table, form, select, status, pagination, and row-action styles use the new
  shared visual language.
- The page title, description, return navigation, and page-level primary action
  use `PageContainer`, including on both the list and detail routes.
- Existing shadcn pages continue to compile; no API or permission boundary is
  changed.
- Both admin module inventories describe the new routes and status.

## Explicit Non-Goals

- No migration of the Mini Program.
- No rewrite of unrelated API handlers or Mongoose models.
- No one-shot replacement of every admin page before the first milestone is
  reviewed.
