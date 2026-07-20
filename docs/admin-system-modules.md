# Admin System: Current Module Inventory

This is the current implementation inventory for `admin/`. Verify code first;
update this file and `admin-system-modules.zh-CN.md` when a route, API, model,
permission, or workflow changes.

## Status And Scope

- `Implemented`: a real page/API/data path exists.
- `Limited`: the path works only for a defined role, provider, source shape, or
  operational condition.
- `Placeholder`: the UI is present but uses a mock, a planned action, or no real
  persistence/integration.
- Runtime: Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui + Radix,
  Mongoose, MongoDB, Three.js, and SWR-style client fetching.
- Route groups: `(platform)` contains platform/B2B operations; `(merchant)`
  contains enterprise workbench assets; shared pages live directly under
  `(admin)`.

## Shared Architecture

- Shell and navigation: `src/app/(admin)/layout.tsx`, `Sidebar.tsx`,
  `FetchInterceptor.tsx`, and `useCurrentUser`.
- Auth and tenant context: `src/lib/auth.ts`, `session.ts`, `proxy.ts`,
  `tenant-context.ts`, `tenant-route.ts`, and `miniprogram-auth.ts`.
- Tenant isolation: `withTenantRoute`, `withTenantContext`, tenant resolvers,
  and `multiTenantPlugin`. Platform admins can switch the global view through
  the `global_tenant_id` cookie.
- Roles: `super_admin`, `admin`, `enterprise_admin`, `designer`, `salesperson`,
  `measurer`, and `viewer`. Menu keys and defaults are defined in
  `models/AdminUser.ts`; custom roles are in `models/SystemRole.ts`.
- Shared feedback: visible mutations use `components/ui/operation-feedback`;
  normal operations do not use raw `alert()`.

## Functional Modules

### 1. Authentication, Registration, And Session

- Pages: `/login`, `/register`.
- APIs: `/api/auth/login`, `/logout`, `/me`, `/miniprogram`,
  `/register-company`, `/register-enterprise`.
- Models/helpers: `AdminUser`, `User`, `Enterprise`, session/auth helpers, and
  `miniprogram-jwt`.
- Status: `Implemented`. Supports admin sessions, enterprise registration,
  Mini Program identity binding, JWT/cookie handling, and unauthorized redirects.
- User audit pages: `/users` and `/users/[openid]`, backed by `/api/users`,
  `/users/[openid]`, and `/users/me`, provide Mini Program user lookup and the
  user's associated floor-plan export library (`Implemented`).

### 2. Navigation, Roles, And Access Control

- Page: `/roles`, plus route guards and the shared Sidebar.
- APIs: `/api/roles`, admin-user APIs, staff APIs, and department APIs.
- Status: `Implemented`. Menu visibility, effective permissions, role defaults,
  custom role menu keys, account status, department membership, and route-level
  role checks are active.

### 3. Platform Dashboard And Enterprise Tenants

- Pages: `/`, `/enterprises`, `/enterprises/[id]`, and enterprise AI,
  automation, and WeCom subpages.
- APIs: `/api/admin/enterprises`, `/activate`, `[id]`, `[id]/ai-key`,
  `[id]/ai-sync`, `[id]/ai-usage`, and `/api/branding/[id]`.
- Models/helpers: `Enterprise`, `EnterpriseAiUsageSnapshot`, `AdminUser`,
  `enterprise-ai`, and `enterprise-wecom`.
- Status: `Implemented`. Covers enterprise onboarding/activation, tenant profile,
  branding, automation settings, WeCom configuration, AI provider/key runtime
  settings, usage snapshots, and platform-level overview metrics.

### 4. Staff, Departments, And System Accounts

- Pages: `/staff`, `/admins`.
- APIs: `/api/staff`, `/staff/[id]`, `/departments`, `/departments/[id]`,
  `/admin-users`, and `/admin-users/[id]`.
- Models: `AdminUser`, `Department`, and `SystemRole`.
- Status: `Implemented`. Enterprise staff, platform admins, role assignment,
  department trees, status changes, and promoter/designer/measurer relationships
  are supported.

### 5. B2B Promotion And Collaboration Workflow

- Pages: `/promotion-records`, `/workflow-logs`.
- APIs: promotion records, `/promotion-records/pool`, `/conflicts`, platform
  promotion config, workbench summary/todos, notification logs, and reminder run.
- Models/helpers: `PromotionEnterpriseRecord`, `WorkflowNotificationLog`,
  `promotion-workflow`, `promotion-timeline`, `workflow-automation`, WeChat,
  and WeCom notification helpers.
- Status: `Implemented`. Includes reporting, duplicate/conflict handling, public
  pool, claim/approval, assignment, business stages, follow-up timelines, SLA
  reminders, notification deduplication, and audit logs.

### 6. Packages, Orders, And Commissions

- Pages: `/packages`, `/enterprise-orders`, `/commissions`.
- APIs: `/api/admin/packages`, `/enterprise-orders`, `/commissions`, settlement,
  and commission-record endpoints.
- Models: `Package`, `EnterpriseOrder`, `CommissionRecord`.
- Status: `Implemented`. Supports package catalog, enterprise order lifecycle,
  paid-order commission creation, commission listing, settlement, and voiding.

### 7. Leads And Conversion Assets

- Page: `/leads`.
- APIs: `/api/leads`, `/leads/[id]`, `/leads/[id]/share`, and related floor-plan
  and staff endpoints.
- Models/helpers: `Lead`, `FloorPlan`, `AdminUser`, WeChat, and WeCom helpers.
- Status: `Implemented`. Covers lead intake/status, follow-ups, assignment,
  formal floor-plan association, share links, and conversion context.

### 8. Formal Floor Plans, Search, And Viewing

- Pages: `/floorplans`, `/floorplans/[id]`, `/floorplans/kujiale`, `/measurements`.
- APIs: `/api/floorplans`, `/floorplans/[id]`, `/floorplans/[id]/export/dxf`,
  `/measurements`, `/kujiale/cities`, `/kujiale/floorplans/search`, and lead
  Kuaile floor-plan association.
- Components/helpers: `FloorPlanViewer`, `FloorPlanViewerWrapper`, `survey-graph`,
  and `dxf`.
- Status: `Implemented` for formal v4 wall-graph parsing, admin 2D/3D viewing,
  exterior-boundary-only dimensions for completed plans (no annotations on
  shared interior walls), measurement filtering, and DXF download. Kujiale
  search is `Limited` by the upstream search/provider response and city/query
  availability.
- Boundary: the backend derives room/opening render data from `surveyGraph`; it
  does not persist legacy `rooms` or other old layout fields.

### 9. Measurement Audit And BLE Device Assets

- Page: `/devices` and the measurement record view under `/measurements`.
- APIs: `/api/devices`, `/devices/[id]`, `/devices/verify`,
  `/devices/verify-binding`, and `/api/measurements`.
- Models: `Device`, `Measurement`, and `User`.
- Status: `Implemented`. Supports device pool, enterprise/user binding,
  verification, status management, and formal length/height/area/angle/opening
  audit records with BLE, manual, or system source markers.

### 10. AI Studio And Design Generation

- Pages: `/ai-studio/scenarios` is the single AI execution workbench with
  customer workflows, quick tools, and the AI assistant. Legacy
  `/ai-studio/designer`, `/ai-studio/floor-plan`, `/ai-studio/furnishing`,
  `/ai-studio/soft-furnishing`, and scenario-detail URLs preserve relevant
  query parameters and redirect into that workbench. `/inspirations`, `/ai-presets`,
  `/ai-providers`, `/ai-credit-prices`, and AI-credit management on the enterprise AI page.
- APIs: AI agent/chat, generation/render/advice, status/history, quota/usage,
  presets, workflow search/pagination and stages, design capabilities/action
  catalog, workflow source images/leads, media assets,
  generation images, image proxy, soft-furnishing render, provider CRUD/key
  rotation/connectivity/model sync/upstream balance query, protected task reconciliation, platform
  action pricing, enterprise grants/adjustments/ledger/tasks, and failed Mini
  Program task retries. Legacy enterprise `ai-key`/`ai-sync` reads remain
  compatibility-only while writes return `410`.
- Models/helpers: `AiGeneration`, `AiWorkflow`, `AiChatSession`, `AiStylePreset`,
  `AiProviderConfig`, `AiProviderAttempt`, `MediaAsset`, `AiCreditAccount`,
  `AiCreditLedger`, `AiCreditPrice`, `Inspiration`, and `src/lib/ai/*`.
- Status: `Implemented`. The workbench starts customer designs with a
  customer/material/goal wizard, shows the selected result and candidates in a
  two-column workspace, and keeps one recommended next action prominent. The
  shared action catalog supplies names, inputs, billing keys, supported clients,
  output boundaries, and next actions. Legacy AI execution permission keys are
  compatibility aliases for `ai-scenarios`; role configuration exposes one
  permission without expanding the B2B channel `salesperson` boundary.
  User-facing AI credits and `AiWorkflow` records are
  shared across Admin and Mini Program. Customer/formal-plan Mini Program tasks
  for reference recreation, whole-space styling, floor-plan concepts, and soft
  furnishing map into the existing baseline, perspective-upgrade, and
  soft-furnishing stages. The first successful base/soft-furnishing generation
  is selected and advances automatically; later successes at the same stage stay
  as candidates until explicitly adopted. Active duplicate stage runs are
  rejected before another hold or upstream task is created. Successful baselines
  can continue into proposal and lighting. Floor-plan-only workflow generation adds read-only dimensions,
  ceiling height, and opening summaries from the formal v4 graph to the prompt,
  does not require a fabricated source image, and never mutates
  `FloorPlan.layoutData`. Credit operations use
  hold-on-create, consume-on-success, and release-on-failure semantics. Only
  platform `super_admin`/`admin` roles may configure providers, rotate credentials,
  test/sync models, query GRS API-key credit balance, run reconciliation, grant/adjust credits, and edit action
  prices; enterprise staff consume them. GRS connectivity testing validates both
  host and key through its credit-balance endpoint; model sync returns configured
  mappings when that node does not implement `/v1/models`. Business routes use logical model keys
  and `AiExecutionService`; GRS submits documented asynchronous image requests to
  `POST /v1/api/generate` with `replyType: "async"` and polls
  `GET /v1/api/result?id=...`; `violation` and `failed` are refunded failures. The provider
  capability and logical/remote model fields drive routing, while currency and
  estimated cost are optional internal-only accounting metadata. Temporary images
  are persisted to `MediaAsset` before settlement. Fallback is
  allowed only for connection/unaccepted/refunded-safe failures; accepted,
  timed-out, or unknown attempts retain the hold and never create a second
  upstream task. Provider cost uses currency micro-units and does not change
  business prices. Provider balance and enterprise AI credits are separate
  ledgers: enterprises buy platform credits while operators replenish the shared
  provider pool against balance thresholds, not once per enterprise purchase.
  Enterprise AI policy controls enabled action keys and the
  `standard` logical-model tier before credits are held. `Limited`:
  balance/model discovery for other adapters depends on upstream support,
  there is no WeChat/self-service recharge or automated low-balance alert, and production media requires durable
  shared storage.
- Migration/operations: run `npm run migrate:ai-platform` before enabling the
  new routes on an existing database. It preserves existing AI-credit balances,
  creates zero-balance accounts when absent, does not convert Pollen, maps legacy
  generations/presets, and seeds environment-backed provider configs. Credit-price
  initialization removes the obsolete unique `mode_1` index so platform actions
  without a mode cannot collide on repeated `null`; `actionKey_1` remains the
  unique business index. Configure
  `AI_RECONCILIATION_SECRET` for scheduled `/api/ai/reconcile` calls.

### 11. Mini Program Support And Cross-Client APIs

- APIs: `/api/auth/miniprogram`, `/api/miniprogram/home`, `/mine`, Mini Program
  AI capabilities/sources/workflows/media/tasks/history endpoints, plus shared leads,
  floor-plans, measurements, commissions, orders, and promotion APIs.
- Status: `Implemented`. These endpoints resolve Mini Program identity,
  professional context, workbench data, shared business assets, and enterprise-
  staff AI design. AI endpoints enforce bearer JWT plus enterprise/operator
  ownership; `/api/miniprogram/ai/sources` exposes only role-accessible formal
  plans and closed rooms. The workflow endpoint returns only context-visible
  active schemes and executable Mini Program actions. An explicit workflow is
  continued; a unique customer/formal-plan match is reused automatically; when
  multiple schemes match, the client must choose instead of silently merging.

### 12. Notifications, Automation, And Diagnostics

- APIs: `/api/automation/reminders/run`, workflow notification list/poll,
  `/api/health`, `/api/debug`, `/api/debug/tenant-context`, and
  `/api/internal/seed`.
- Status: `Implemented` for scheduled reminder execution, browser polling,
  notification logs, health/debug checks, seed support, and Docker/release
  tooling. These endpoints require their documented role or operational context.

## Core Models

- Identity: `AdminUser`, `SystemRole`, `User`, `Department`.
- Tenant/commercial: `Enterprise`, `Package`, `EnterpriseOrder`,
  `CommissionRecord`, `PromotionEnterpriseRecord`.
- Customer assets: `Lead`, `FloorPlan`, `Measurement`, `Device`, `Inspiration`.
- AI/media: `AiGeneration`, `AiWorkflow`, `AiChatSession`, `AiStylePreset`,
  `AiProviderConfig`, `AiProviderAttempt`, `MediaAsset`, `AiCreditAccount`,
  `AiCreditLedger`, and `AiCreditPrice`; `EnterpriseAiUsageSnapshot` is
  legacy Pollinations history only.
- Notifications/config: `WorkflowNotificationLog`, `PlatformConfig`.

## Maintenance Checklist

Before changing an admin page, API, model, workflow, or shared component, read
the root and directory-level instructions plus both admin inventories. When the
change is complete, update both inventories in the same diff with the route/API,
data behavior, permission boundary, status, and limitations. Check Sidebar menu
keys, `proxy.ts`, role defaults, tenant resolution, model indexes, and operation
feedback. Do not document a roadmap item as implemented until a real route,
handler, and persistence/provider path exists. A change with no functional impact
must say so explicitly in its handoff.
