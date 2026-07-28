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
  `surveyDimensionPlan`, `surveyWallSolidPlan`, and `dxf`. The dependency-free
  dimension and wall-solid planners are authored under `miniprogram/utils` and
  synchronized into `admin/src/lib` before admin development and production
  builds.
- Status: `Implemented` for formal v4 wall-graph parsing, admin 2D/3D viewing,
  room fills that accept only a fully connected closed wall chain in either
  first-wall direction, and a compound wall-solid union derived from one-sided
  wall bodies plus connected-node fills. The union is filled and outlined once,
  so connected nodes, L/T joins, and overlapping segments have no internal caps,
  diagonal seams, or boxed wall ends. Door/window cuts cover the complete wall
  thickness. Completed layouts use engineering-style exterior dimension plans:
  a continuous multi-wall run or door wall has a positioning chain. Each
  exterior direction has one global total across the complete plan bounds,
  replacing repeated local totals. Windows retain CAD symbols without duplicate
  detail chains. Closed-space edges are geometrically split and
  merged, so differently identified/split shared walls and enclosed inner holes
  never receive annotations; extension lines start at mitered exterior wall
  corners and route to global exterior dimension lanes beyond the whole plan;
  the viewer expands its SVG bounds for all dimension lines, extension lines,
  and labels.
  Measurement filtering and DXF download are implemented. Kujiale search is
  `Limited` by the upstream search/provider response and city/query availability.
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
  `AiCreditLedger`, `AiCreditPrice`, `Inspiration`, `src/lib/ai/*`, and
  `src/lib/media-storage/*`.
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
  soft-furnishing stages. Media assets persist image width and height; legacy
  assets backfill them from the stored file when first reused. All media writes,
  reads, deletes, and optional signed-read redirects go through the registered
  `MediaStorageProvider`. Each `MediaAsset` retains its provider, portable object
  key, optional bucket, and SHA-256 checksum, so local and Qiniu/object-storage
  assets can coexist without changing Admin or Mini Program asset URLs. The
  bundled `local` provider confines paths to `AI_ASSET_STORAGE_DIR`; production
  Docker mounts that directory as a persistent volume. Mini Program
  output ratios map those dimensions to provider-supported specifications:
  reference recreation follows the reference image ratio; when a formal-plan
  target is selected, the server submits an isolated room/plan control image
  first as the authoritative wall/door/window structure and the reference image
  second as the camera, framing, composition, and style source. Without a formal
  plan, reference recreation retains the reference-first/room-image-second path.
  Style/soft-furnishing edits follow the room image, whole-plan concepts stay
  square, and single-room concepts default to landscape. The first successful base/soft-furnishing generation
  is selected and advances automatically; later successes at the same stage stay
  as candidates until explicitly adopted. Active duplicate stage runs are
  rejected before another hold or upstream task is created. Successful baselines
  can continue into proposal and lighting. The Admin workflow wizard exposes
  only completed formal v4 plans with closed rooms and rejects stale, draft, or
  legacy plan IDs again on creation and execution. Floor-plan-backed direction,
  baseline, and perspective stages derive a 1024px control-image `MediaAsset`;
  direction generation always uses `image.edit.standard` and sends that control
  image (or the uploaded source image) in the provider `images` input. The prompt
  also includes read-only room, wall-topology, dimension, ceiling-height, door,
  and window constraints from the formal graph. This derivation never mutates
  `FloorPlan.layoutData`. Credit operations use
  hold-on-create, consume-on-success, and release-on-failure semantics. Only
  platform `super_admin`/`admin` roles may configure providers, rotate credentials,
  test/sync models, query GRS API-key credit balance, run reconciliation, grant/adjust credits, and edit action
  prices; enterprise staff consume them. GRS connectivity testing validates both
  host and key through its credit-balance endpoint; model sync returns configured
  mappings when that node does not implement `/v1/models`. Business routes use logical model keys
  and `AiExecutionService`; GRS submits documented asynchronous image requests to
  `POST /v1/api/generate` with `replyType: "async"` and polls
  `GET /v1/api/result?id=...`; standard `gpt-image-2` requests use its documented
  aspect ratios while VIP requests retain compatible source pixel dimensions
  and otherwise use a documented valid fallback size.
  `violation` and `failed` are refunded failures.
  Mini Program task-detail and history reads force this upstream status query
  for visible processing jobs and return a terminal database state even when a
  refunded failure exhausts configured fallback providers. The provider
  capability and logical/remote model fields drive routing, while currency and
  estimated cost are optional internal-only accounting metadata. GRS `http(s)`
  output URLs remain the default result reference and are not copied to platform
  storage. Platform operators can enable the Media Storage page's GRS
  output-transfer policy only when an active Qiniu configuration is the default
  provider; then subsequent GRS outputs are persisted to that Qiniu configuration
  before settlement. Data-URI outputs, user uploads, and generated control images
  continue to use `MediaAsset` regardless of the policy. Fallback is
  allowed only for connection/unaccepted/refunded-safe failures. Accepted or
  unknown attempts with a remote task ID retain the hold and never create a
  second upstream task. An untrackable submission response without a remote
  task ID terminates as failed without automatic fallback, releases the hold,
  and may be retried manually after operator verification instead of remaining
  in `processing` indefinitely. Retries rebuild the billing price snapshot from
  the current action price and remain compatible with legacy tasks that have no
  stored snapshot. Provider cost uses currency micro-units and does not change
  business prices. Provider balance and enterprise AI credits are separate
  ledgers: enterprises buy platform credits while operators replenish the shared
  provider pool against balance thresholds, not once per enterprise purchase.
  Enterprise AI policy controls enabled action keys and the
  `standard` logical-model tier before credits are held. `Limited`:
  balance/model discovery for other adapters depends on upstream support,
  there is no WeChat/self-service recharge or automated low-balance alert, and
  production local media requires durable shared storage. The bundled Qiniu Kodo
  driver requires a private bucket, HTTPS download domain, server-only encrypted
  credentials, and a successful full read/write/delete probe before activation.
  Qiniu upload failures are returned directly and never fall back to local storage.
- Migration/operations: run `npm run migrate:ai-platform` before enabling the
  new routes on an existing database. It preserves existing AI-credit balances,
  creates zero-balance accounts when absent, does not convert Pollen, maps legacy
  generations/presets, and seeds environment-backed provider configs. Credit-price
  initialization removes the obsolete unique `mode_1` index so platform actions
  without a mode cannot collide on repeated `null`; `actionKey_1` remains the
  unique business index. `npm run cleanup:media-assets` is dry-run by default
  and physically purges soft-deleted media only after the configured grace period;
  `npm run migrate:media-assets -- --from=<provider-key> --to=<provider-key>` previews a
  checksum-verified provider migration and requires `--execute` to write. A
  migration commits the target location before deleting the source object.
  Configure `AI_RECONCILIATION_SECRET` for scheduled `/api/ai/reconcile` calls.

### 11. Platform Media Storage Management

- Page/permission: `/media-storage` with the `media-storage` menu permission;
  only platform `super_admin` and `admin` roles may access it.
- APIs: `GET/POST/PATCH /api/admin/media-storage`, `PATCH/DELETE
  /api/admin/media-storage/[id]`, `POST /api/admin/media-storage/[id]/test`, and
  `POST /api/admin/media-storage/[id]/activate`.
- Models/helpers: `MediaStorageConfig`, `PlatformConfig.mediaStorage`,
  `MediaAsset`, and `src/lib/media-storage/*`.
- Status: `Implemented`. The page shows the current default, credential/config
  state, active/pending/total asset counts and bytes, and the last connectivity
  result. It manages the built-in local provider plus multiple Qiniu Kodo
  configurations, masks credentials in every response, encrypts them server-side,
  and accepts an optional relative object prefix for each Qiniu configuration.
  Prefixes isolate projects within a shared bucket, accept only slash-separated
  alphanumeric, `.`, `_`, and `-` segments, and reject traversal. A prefix is
  normalized with one trailing slash and applies only to subsequent uploads and
  health probes. The persisted `MediaAsset.storageKey` always includes that
  prefix, so changing a configuration never breaks existing assets. Bucket,
  region, domain, prefix, or credential changes invalidate the previous test
  result and require a new full upload/stat/private-signed-download/content/delete probe.
  Only a non-archived Qiniu config with a successful probe can be activated. Stable
  config keys are immutable and are stored in `MediaAsset.storageProvider`.
  Archived configs cannot write, test, or reactivate, but remain resolvable for
  historical asset reads/deletes; the current default cannot be archived.
  Switching defaults affects new uploads only and does not migrate old assets.
  The GRS output policy defaults to keeping the upstream image URL; its explicit
  transfer option requires the current default to be a usable Qiniu configuration,
  persists only subsequent remote GRS outputs, and prevents switching the default
  back to local until transfer is disabled.
  `local` remains the compatibility default until a platform choice is persisted.
- Limitations/operations: production cloud credentials require the dedicated
  `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`; Qiniu buckets are treated as private, download
  domains must be HTTPS and must be allowlisted in the WeChat Mini Program. The
  page does not launch migration or purge jobs; operators continue to use the
  dry-run-first media CLI commands.

### 12. Mini Program Support And Cross-Client APIs

- APIs: `/api/auth/miniprogram`, `/api/miniprogram/home`, `/mine`, Mini Program
  AI capabilities/sources/workflows/media/tasks/history endpoints, plus shared leads,
  floor-plans, measurements, commissions, orders, and promotion APIs.
- Status: `Implemented`. These endpoints resolve Mini Program identity,
  professional context, workbench data, shared business assets, and enterprise-
  staff AI design. AI endpoints enforce bearer JWT plus enterprise/operator
  ownership. Media uploads identify supported JPG/PNG content and dimensions
  from file bytes so WeChat multipart uploads do not depend on a client-provided
  MIME type;
  `/api/miniprogram/ai/sources` exposes only role-accessible formal
  plans and closed rooms, preserves the legacy flat room array, and also returns
  grouped plans for the complete-plan/single-room selector. Mini Program tasks
  validate the same role boundary and persist an explicit
  `whole_floor_plan`/`single_room` target. Complete-plan rendering tasks derive a
  separate 1024px control-image `MediaAsset` and use image editing; standalone
  single-room rendering tasks use measured prompt context and image generation.
  Plan-backed reference recreation also derives a control image, isolating the
  selected room when `roomId` is present, and submits it before the visual
  reference without requiring a separate room photo. The workflow endpoint returns only context-visible
  active schemes and executable Mini Program actions. An explicit workflow is
  continued; a unique customer/formal-plan match is reused automatically; when
  multiple schemes match, the client must choose instead of silently merging.

### 13. Notifications, Automation, And Diagnostics

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
  `AiProviderConfig`, `AiProviderAttempt`, `MediaStorageConfig`, `MediaAsset`, `AiCreditAccount`,
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
