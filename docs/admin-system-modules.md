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
  PostgreSQL 17 through `drizzle-orm` + `pg` for the migrated Phase 3 domains,
  Mongoose/MongoDB for the remaining domains, Three.js, and SWR-style client
  fetching. Identity/enterprise core, leads, formal floor plans, measurements,
  BLE devices, prompt-library reads, system roles, global promotion configuration,
  media-storage configuration, package catalog, and promotion/workflow-notification
  runtime paths now use PostgreSQL.
- Local development: `npm run dev` runs the combined Next.js UI/API on port
  `3005`; Docker publishes MongoDB on host port `27018` (container
  `mongo:27017`) and PostgreSQL on host port `5432` (container
  `postgres:5432`). The host port avoids a pre-existing Windows MongoDB
  service; container-to-container connections continue to use service names.
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
- Migrated management pages use ProComponents `PageContainer` for the common
  title, description, back navigation, and page-level action area. `ProTable`,
  `ProForm`, and `ProDescriptions` remain the corresponding list, form, and
  detail primitives.
- `PageContainer` does not provide business-block spacing; migrated pages use
  the shared shell's `24px` content top inset below the header divider, then
  Ant Design `Flex`/`Space` or documented `ProCard` layouts for block gaps and
  `ProForm.submitter.render` for the separated bottom action row. The first
  block must not add a second top margin.

## Functional Modules

### 1. Authentication, Registration, And Session

- Pages: `/login`, `/register`.
- APIs: `/api/auth/login`, `/logout`, `/me`, `/miniprogram`,
  `/register-company`, `/register-enterprise`.
- Models/helpers: PostgreSQL `AdminUserRepository`, `UserRepository`,
  `EnterpriseRepository`, session/auth helpers, and `miniprogram-jwt`.
- Status: `Implemented` for PostgreSQL-backed admin login/session validation,
  enterprise self-registration, Mini Program staff login/identity binding,
  JWT/cookie handling, account-status revalidation, and unauthorized redirects.
- Legacy platform-admin recovery: `npm run migrate:legacy-admin-users` imports
  MongoDB platform accounts into PostgreSQL idempotently, preserving their
  bcrypt password hashes, roles, account status, and menu permissions so users
  keep their existing passwords. It deliberately skips tenant-scoped legacy
  accounts because MongoDB ObjectId tenant references need an explicit mapping
  to PostgreSQL bigint enterprise IDs.
- User audit pages: `/users` and `/users/[openid]`, backed by `/api/users`,
  `/users/[openid]`, and `/users/me`, provide PostgreSQL Mini Program identity
  lookup/profile updates and PostgreSQL floor-plan counts/export lists.
  `Limited`: AI generation/media and order/commission workflows that still use
  MongoDB cannot consume PostgreSQL bigint identities until their later Phase 3
  slices.

### 2. Navigation, Roles, And Access Control

- Page: `/roles`, plus route guards and the shared Sidebar.
- APIs: `/api/roles`, admin-user APIs, staff APIs, and department APIs.
- Status: `Implemented`. Menu visibility, effective permissions, role defaults,
  custom role menu keys, account status, department membership, and route-level
  role checks are active. `/api/roles`, login/Mini Program permission resolution,
  admin/staff CRUD, department membership, promoter junctions, and admin-list
  effective permissions now use PostgreSQL `SystemRoleRepository`,
  `AdminUserRepository`, and `DepartmentRepository`. Tenant staff/departments run
  inside RLS-scoped transactions; the role route enforces platform
  `super_admin`/`admin` access in the handler, and default-role initialization
  uses an idempotent insert that preserves configured menu keys.

### 3. Platform Dashboard And Enterprise Tenants

- Pages: `/`, `/enterprises`, `/enterprises/[id]`, and enterprise AI and
  automation subpages.
- APIs: `/api/admin/enterprises`, `/activate`, `[id]`, `[id]/ai-key`,
  `[id]/ai-sync`, `[id]/ai-usage`, and `/api/branding/[id]`.
- Models/helpers: PostgreSQL `EnterpriseRepository`, `AdminUserRepository`,
  `PromotionRecordRepository`, and `CommercialRepository`, plus the
  not-yet-switched `EnterpriseAiUsageSnapshot` and `enterprise-ai` paths.
- Status: `Implemented`. Covers enterprise onboarding/activation, tenant profile,
  branding, automation settings, AI provider/key runtime settings, usage
  snapshots, and platform-level overview metrics.
- PostgreSQL boundary: enterprise list/detail/create/update/delete, both
  self-registration routes, and `/api/admin/enterprises/activate` use
  PostgreSQL. Activation runs in one platform transaction: it creates the
  enterprise and enterprise-admin account, validates the requested order belongs
  to the unactivated promotion record, then binds the selected order or all
  unbound orders to the new enterprise and advances the record to `paid`.
  `Limited`: `ai-key`, `ai-sync`, `ai-usage`, `ai-credits`, branding, and
  usage-snapshot consumers remain assigned to later Phase 3 domains. Core
  list/detail responses therefore expose `aiUsageSnapshot: null` until the AI
  switch.

### 4. Staff, Departments, And System Accounts

- Pages: `/staff`, `/admins`.
- APIs: `/api/staff`, `/staff/[id]`, `/departments`, `/departments/[id]`,
  `/admin-users`, and `/admin-users/[id]`.
- Models/repositories: PostgreSQL `AdminUserRepository`,
  `DepartmentRepository`, `SystemRoleRepository`, and the
  `admin_user_promoters` junction.
- Status: `Implemented`. Enterprise staff, platform admins, role assignment,
  department trees, status changes, and promoter/designer/measurer relationships
  are supported. Existing `_id` response fields remain decimal strings for
  frontend compatibility; RLS and route role checks enforce tenant boundaries.

### 5. B2B Promotion And Collaboration Workflow

- Pages: `/promotion-records`, `/workflow-logs`.
- APIs: promotion records, `/promotion-records/pool`, `/conflicts`, platform
  promotion config, workbench summary/todos, notification logs, and reminder run.
- Models/helpers: PostgreSQL `PlatformConfigRepository`,
  `PromotionRecordRepository`, `WorkflowNotificationRepository`,
  `postgres-promotion-workflow`, `postgres-workflow-automation`, and WeChat
  notification helpers. The legacy `PromotionEnterpriseRecord`/
  `WorkflowNotificationLog` models remain only for legacy helper compatibility
  paths.
- Status: `Implemented`. Includes reporting, duplicate/conflict handling, public
  pool, claim/approval, assignment, business stages, follow-up timelines, SLA
  reminders, notification deduplication, and audit logs. Platform administrators
  read and update the global promotion protection/approval configuration through
  PostgreSQL. The PostgreSQL promotion/notification foundation now has explicit
  bigint foreign keys for claim review, measurement/design assignment, and
  conflict review; indexed role visibility; atomic conditional state updates;
  relation DTOs; and channel-scoped notification deduplication. Promotion routes,
  pool/conflict operations, workbench summary/todos,
  notification logs/polling, and reminder automation now use typed PostgreSQL
  repositories inside tenant/platform RLS transactions. Mutations use short
  conditional updates; notification dispatch occurs after commit, and the
  existing DTOs, role boundaries, and Mini Program API paths remain unchanged.
  Platform-owned `salesperson` accounts may have no enterprise because they
  acquire prospective customers for the platform. Promotion record/detail,
  pool-claim, workbench, and notification polling routes use an explicit
  platform B2B scope for that case, while repository actor filters and mutation
  role checks restrict access to the salesperson's own records or claimable
  pool records. Such accounts cannot assign a new report to an arbitrary
  enterprise.
  `Limited`: AI/media consumers that still reference legacy MongoDB ObjectIds
  remain on MongoDB until their dependent slices are migrated.

### 6. Packages, Orders, And Commissions

- Pages: `/packages`, `/enterprise-orders`, `/commissions`.
- APIs: `/api/admin/packages`, `/enterprise-orders`, `/commissions`, settlement,
  and commission-record endpoints.
- Models: PostgreSQL `PackageRepository` and `CommercialRepository`; legacy
  `EnterpriseOrder` and `CommissionRecord` models are no longer runtime sources.
- Status: `Implemented`. Supports package catalog, enterprise order lifecycle,
  paid-order commission creation, commission listing, settlement, and voiding.
  Package list/create/update/delete now runs in platform-scoped PostgreSQL
  transactions, returns decimal-string bigint IDs through the existing `_id`
  field, and keeps money values as exact `numeric(14,2)` data. Orders,
  commissions, settlement, voiding, and workbench commission totals now use
  PostgreSQL bigint relations in short tenant/platform RLS transactions. Paid
  orders atomically update the promotion record and upsert the fixed commission;
  cancelled orders void the existing commission. Enterprise activation uses the
  same PostgreSQL promotion/order relations and does not introduce a dual write.

### 7. Leads And Conversion Assets

- Page: `/leads`.
- APIs: `/api/leads`, `/leads/[id]`, and related floor-plan and staff endpoints.
- Models/helpers: PostgreSQL `LeadRepository`, `FloorPlanRepository`,
  `AdminUserRepository`, and WeChat helpers.
- Status: `Implemented`. Covers lead intake/status, follow-ups, assignment,
  formal floor-plan association, and conversion context. List,
  detail, create, update, and delete paths run in RLS-scoped PostgreSQL
  transactions and retain decimal-string `_id` DTOs. Lead-floor-plan junction,
  primary-plan selection, tenant validation, and deletion cleanup are atomic.
  Ordinary WeChat notification calls execute after the database transaction.
  WeCom configuration, group sharing, and employee WeCom identifiers are
  deprecated and intentionally removed from runtime APIs and UI. Historical
  MongoDB fields and the PostgreSQL `admin_users.wecom_user_id` column are
  retained without migration or deletion.

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
- PostgreSQL boundary: formal floor-plan CRUD, detail rendering, lead linking,
  measurement association, and DXF export use `FloorPlanRepository` and
  `MeasurementRepository` under RLS. External Kujiale requests run outside the
  database transaction; an imported plan is persisted atomically as a
  millimetre-based formal version-4 `surveyGraph`. Imported room outlines become
  closed node/wall/space chains. Kujiale openings are currently omitted because
  the provider response does not expose a reliable opening-to-wall mapping.
- Boundary: the backend derives room/opening render data from `surveyGraph`; it
  does not persist legacy `rooms` or other old layout fields.

### 9. Measurement Audit And BLE Device Assets

- Page: `/devices` and the measurement record view under `/measurements`.
- APIs: `/api/devices`, `/devices/[id]`, `/devices/verify`,
  `/devices/verify-binding`, and `/api/measurements`.
- Models/repositories: PostgreSQL `DeviceRepository`, `MeasurementRepository`,
  `AdminUserRepository`, `UserRepository`, and `FloorPlanRepository`.
- Status: `Implemented`. Supports device pool, enterprise/user binding,
  verification, status management, and formal length/height/area/angle/opening
  audit records with BLE, manual, or system source markers. Device assignment is
  an `admin_users` foreign key; platform/enterprise admins mutate devices, while
  staff can read their own assignment. Measurement writes validate operator,
  enterprise, formal plan, value/type/source/date, and assigned device in one
  RLS-scoped PostgreSQL flow.

### 10. AI Studio And Design Generation

- Pages: `/ai-studio/scenarios` is the customer-workflow AI execution workbench with
  customer workflows, quick tools, and the AI assistant. Legacy
  `/ai-studio/designer`, `/ai-studio/floor-plan`, `/ai-studio/furnishing`,
  `/ai-studio/soft-furnishing`, and scenario-detail URLs preserve relevant
  query parameters and redirect into that workbench. `/ai-studio/create` is a
  separate full-screen free-creation workspace opened from the sidebar in a new
  tab. `/inspirations`, `/ai-presets`,
  `/ai-providers`, `/ai-models`, `/ai-credit-prices`, and AI-credit management on the enterprise AI page.
- AI provider administration routes: `/ai-providers` is the provider list;
  `/ai-providers/new` creates a provider; `/ai-providers/[id]` is the provider
  detail/edit page; `/ai-models` is the separate platform image-model catalog.
  The routes use the shared Ant Design ProComponents-based admin shell
  (`ProTable`, `ProForm`, and `ProDescriptions`) and the existing `ai-providers`
  platform permission for `super_admin` and `admin` (`Implemented`).
- Provider integration contract: `AiProviderConfig` retains its legacy encrypted
  API-key fields and now also persists masked/encrypted credential maps plus a
  validated non-secret `adapterConfig`. The common editor and server validation
  both read `src/lib/ai/provider-adapter-manifest.ts`; current GRS,
  Pollinations, and OpenAI-compatible adapters use the shared endpoint/API-key
  configuration. `Limited`: the platform image-model catalog currently has a
  GRS source contract, so a new provider requires an adapter implementation and
  catalog-profile support, not merely an additional UI option.
- APIs: AI agent/chat, generation/render/advice, status/history, quota/usage,
  presets, workflow search/pagination and stages, design capabilities/action
  catalog, workflow source images/leads, media assets,
  generation images, image proxy, soft-furnishing render, provider CRUD/key
  rotation/connectivity/model sync/upstream balance query, protected task reconciliation, platform
  action pricing, `GET/PATCH /api/admin/ai-image-models`,
  `GET/PATCH /api/admin/ai-image-model-prices`, enterprise
  grants/adjustments/ledger/tasks, and failed Mini
  Program task retries. Legacy enterprise `ai-key`/`ai-sync` reads remain
  compatibility-only while writes return `410`.
- Free-creation APIs: `GET /api/ai/creation/bootstrap`, prompt categories,
  prompt template list/detail/preview, `POST /api/ai/creation/assets`,
  `GET/POST /api/ai/creation/tasks`, `DELETE /api/ai/creation/tasks/[id]`,
  `POST /api/ai/creation/tasks/[id]/batches`, prompt assistance, and generation
  attachment to an existing customer workflow. The proxy maps the entire page
  and API prefix to the unified `ai-scenarios` permission, while writable routes
  also require an enterprise through `withTenantRoute`.
- Models/helpers: `AiGeneration`, `AiWorkflow`, `AiChatSession`, `AiStylePreset`,
  `AiProviderConfig`, `AiProviderAttempt`, `MediaAsset`, `AiCreditAccount`,
  `AiCreditLedger`, `AiCreditPrice`, `AiModelCreditPrice`, `Inspiration`,
  `src/lib/ai/*`, and
  `src/lib/media-storage/*`.
- Free-creation and prompt-library models: `AiCreationTask`, `AiCreationBatch`,
  `AiCreationModelProfile`, `AiPromptLibraryRevision`, `AiPromptCategory`,
  `AiPromptTemplate`, `AiPromptParameterTemplate`, `AiPromptSourceModel`,
  `AiPromptTemplateAsset`, and `AiPromptImportRun`.
- Prompt-library operations: `npm run import:roomi-prompts` is dry-run by default;
  add `-- --execute` to publish an atomically validated revision, or
  `-- --source-file=<export.json> --execute` to resume from an export. Run
  `npm run verify:roomi-prompts` for source counts, references, preview checksums,
  and sampling. Import credentials and snapshots stay under the Git-ignored
  `admin/.roomi-import/`; imported preview files stay under Git-ignored local
  storage and are never uploaded to Qiniu.
- Phase 4 retained-data migration: `npm run migrate:phase4-retained-data`
  validates the frozen RoomiAI snapshot before idempotently importing the active
  revision, its complete reference graph, and local preview files into PostgreSQL.
  It also imports the active Qiniu configuration and provider pointer, runs a
  full Qiniu probe, and records a migration checkpoint. It reads legacy MongoDB
  only and never deletes MongoDB rows, import snapshots, or Qiniu objects.
- PostgreSQL runtime migration: the read-only prompt-library APIs
  (`GET /api/ai/creation/prompt-categories`,
  `GET /api/ai/creation/prompt-templates`, template detail, and preview) now
  use the typed PostgreSQL Repository and platform-scoped transactions. Their
  DTOs and `ai-scenarios` permission boundary are unchanged. The Phase 4
  retained-data importer writes the active prompt library directly to PostgreSQL;
  generation task persistence/model-profile synchronization still use MongoDB
  until their Phase 3 slices are migrated. New generation batches resolve
  a selected prompt template and parameter definition through PostgreSQL.
  `Limited`: MongoDB AI workflow/media/generation routes that reference leads or
  floor plans are not bigint-compatible yet and remain outside this slice.
- Status: `Implemented`. The workbench starts customer designs with a
  customer/material/goal wizard, shows the selected result and candidates in a
  two-column workspace, and keeps one recommended next action prominent. The
  shared action catalog supplies names, inputs, billing keys, supported clients,
  output boundaries, and next actions. Legacy AI execution permission keys are
  compatibility aliases for `ai-scenarios`; role configuration exposes one
  permission without expanding the B2B channel `salesperson` boundary.
  The free-creation workspace provides local template search and three-level
  categories, template fill, reference images, prompt assistance, mapped local
  executable model profiles, 1-4 outputs, model/ratio/resolution controls, credit estimates,
  history, reuse, retry, delete, download, and attachment to an existing customer
  workflow. Completed result tiles reproduce the verified Roomi interaction surface:
  hover actions, annotatable reference reuse, full preview controls, and exported
  A/B comparison without introducing a Roomi runtime dependency. Template results load incrementally across the complete active revision,
  and mobile users retain access to the same three-level category filter. The
  full-screen surface follows the approved Roomi-style dark creation layout with a
  68px brand bar, a 1440px minimum desktop canvas, compact creation rail, fixed-size
  floating task panel, and a 1080px prompt/parameter composer. The title arc and
  composer frame are bundled local static assets, Smart Floor AI branding replaces
  the source branding, and the page continues to use only local data APIs. After a
  task is submitted, the workspace switches to the Roomi-style execution layout:
  task summary and parameter chips at the top, compact progress/result tiles with
  edit/retry/delete actions, a right-side history rail, and the composer anchored to
  the bottom edge. Hovering a completed result exposes download, reference reuse,
  A/B comparison, image annotation editing, workflow attachment, and deletion.
  Result preview supports zoom, rotation, fullscreen, and download; comparison
  supports swap, A/B-only, a draggable split divider, synchronized, horizontal/vertical, reset, and a
  borderless immersive fullscreen canvas that keeps the toolbar above the viewport-filling image stage,
  and export. The annotation editor provides rectangle, circle, arrow, pen, and marker
  tools, six colors, undo/redo, local download, and saves the accepted PNG through the
  existing free-creation asset upload API as a reference image; it adds no route, model,
  or permission boundary. The server
  intersects template parameters with the selected local
  model profile before submission and snapshots the accepted values. Generation
  uses the existing provider execution, polling, and hold/consume/release billing
  path under the `image.free_create` action. The versioned GRSAI catalog currently
  defines `gpt-image-2`, `gpt-image-2-vip`, and eleven Nano Banana variants from
  the 2026-06-29 protocol. Platform administrators enable models, choose one
  default, and cap reference images at 0-10 on `/ai-providers`; synchronized
  models without a catalog capability definition remain read-only and cannot
  execute. The bootstrap exposes only enabled models with at least one enabled
  model-resolution price. GPT Image 2 has no quality control, VIP uses the
  documented pixel preset matrix or validated `CUSTOM` dimensions, and Nano
  requests use `aspectRatio + imageSize`. Free-creation uploads and any result
  that must be persisted are forced to the local media provider even when Qiniu
  is the platform default. The first UI release attempts the imported audited
  `sourceUrl` for a template preview and falls back to its imported local preview;
  it never calls a Roomi API at runtime.
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
  as candidates until explicitly adopted. Admin keeps its workflow-stage
  semantics; Mini Program duplicate checks additionally include formal plan,
  target scope, and room, and reject the same target before another hold or
  upstream task is created. Successful baselines
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
  test/sync models, query GRS API-key credit balance, run reconciliation, grant/adjust credits,
  manage the image-model catalog, and edit action/model-resolution prices;
  enterprise staff consume them. GRS connectivity testing validates both
  host and key through its credit-balance endpoint; model sync merges discovery
  with the complete built-in catalog and falls back to that catalog when the node
  does not implement `/v1/models`. Business routes use logical model keys
  and `AiExecutionService`; GRS submits documented asynchronous image requests to
  `POST /v1/api/generate` with `replyType: "async"` and polls
  `GET /v1/api/result?id=...`; GRS requests never send undocumented
  `quality`/`output_format` placeholders. Standard `gpt-image-2` accepts its
  documented ratios or 1K pixel values, VIP presets resolve to documented pixels
  and validate custom dimensions, and Nano models send their documented ratio
  plus `imageSize`.
  `violation` and `failed` are refunded failures.
  Mini Program task-detail and history reads force this upstream status query
  for visible processing jobs and return a terminal database state even when a
  refunded failure exhausts configured fallback providers. The provider
  capability and logical/remote model fields drive routing. A free-creation
  model override is restricted to GRS runtimes and retains the exact selected
  remote model across fallback attempts; it never silently changes models.
  Provider cost rules may additionally match remote model and resolution, while
  currency and estimated cost remain internal-only accounting metadata. GRS `http(s)`
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
  the current action/model-resolution price and remain compatible with legacy
  tasks that have no stored snapshot. Free-creation estimates and holds use
  `AiModelCreditPrice` keyed by `image.free_create + modelProfileKey +
  resolutionTier`; VIP custom dimensions always use `CUSTOM`. Provider cost
  uses currency micro-units and does not change
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
- Mini Program target continuation: `/api/miniprogram/ai/workflows` validates
  `floorPlanId + targetScope + roomId` and derives target-local state from exact
  generations instead of the workflow's global stage. Legacy generations with
  missing scope metadata remain visible in history but cannot auto-match a room;
  plan updates make older results stale. `POST /api/miniprogram/ai/tasks` accepts
  a mutually exclusive `sourceResultTaskId`, revalidates success, workflow,
  target, access, and freshness, materializes both internal and external result
  images as a new `ai_generation_input`, and records `parentGenerationId` before
  holding credits. Coworkers see only a busy flag for another operator's active
  target task, while the owner may open progress. No room-level `AiWorkflow` or
  change to Admin's global adopted-result semantics is introduced.
- Migration/operations: run `npm run migrate:ai-platform` before enabling the
  new routes on an existing database. It preserves existing AI-credit balances,
  creates zero-balance accounts when absent, does not convert Pollen, maps legacy
  generations/presets, and seeds environment-backed provider configs. Credit-price
  initialization removes the obsolete unique `mode_1` index so platform actions
  without a mode cannot collide on repeated `null`; `actionKey_1` remains the
  unique business index. The migration idempotently writes the complete GRSAI
  catalog and its model-resolution prices; only `gpt-image-2/1K` is initially
  enabled and inherits the existing `image.free_create` price. Historical
  `roomi-*` profiles and generation snapshots remain readable but are not
  executable choices. `npm run cleanup:media-assets` is dry-run by default
  and physically purges soft-deleted media only after the configured grace period;
  `npm run migrate:media-assets -- --from=<provider-key> --to=<provider-key>` previews a
  checksum-verified provider migration and requires `--execute` to write. A
  migration commits the target location before deleting the source object.
  Configure `AI_RECONCILIATION_SECRET` for scheduled `/api/ai/reconcile` calls.

- Legacy free-creation snapshots may still display a historical `quality` value
  when reading old batches; new GRSAI requests expose model, ratio, and
  resolution only and never send `quality` or `output_format`.
- Free-creation responsive behavior: viewports below `1440px` remove the fixed
  desktop minimum width, hide the left tool rail, and wrap model, output,
  ratio, resolution, template, and submit controls so every command remains
  reachable. The original fixed Roomi-style canvas remains unchanged at
  `1440px` and above.

### 11. Platform Media Storage Management

- Page/permission: `/media-storage` with the `media-storage` menu permission;
  only platform `super_admin` and `admin` roles may access it.
- APIs: `GET/POST/PATCH /api/admin/media-storage`, `PATCH/DELETE
  /api/admin/media-storage/[id]`, `POST /api/admin/media-storage/[id]/test`, and
  `POST /api/admin/media-storage/[id]/activate`.
- Models/helpers: `MediaStorageConfig`, `PlatformConfig.mediaStorage`,
  PostgreSQL `MediaStorageConfigRepository`, `MediaAsset`, and
  `src/lib/media-storage/*`.
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
  Media-storage configuration CRUD, encrypted credential reads, connectivity-test
  results, archival, default-provider selection, and the GRS transfer pointer are
  persisted in PostgreSQL. Qiniu network probes run outside database transactions;
  their results use an `updatedAt` optimistic condition so a concurrent config edit
  cannot be overwritten. Asset counts/bytes still aggregate MongoDB `MediaAsset`
  records until that later Phase 3 domain is migrated. MongoDB administrator IDs
  cannot populate PostgreSQL bigint audit foreign keys, so those fields remain
  `NULL` until the identity domain moves.
- Phase 4 retained-data migration imported the active `zly-images` Qiniu
  configuration and provider pointer with no legacy administrator audit ID; its
  complete upload/stat/private-signed-download/content/delete probe passed. The
  deployment environment must still supply a dedicated
  `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` before production cutover.
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
  active schemes and executable Mini Program actions. With a formal target it
  also returns `sourceFloorPlanId` and a target-local context matched by plan,
  scope, and room; another operator's active task is represented only as busy.
  An explicit workflow is
  continued; a unique customer/formal-plan match is reused automatically; when
  multiple schemes match, the client must choose instead of silently merging.
- PostgreSQL workbench boundary: `/api/miniprogram/home` and `/mine` now derive
  live lead, formal-plan, measurement, device, promotion, and todo data through
  typed RLS repositories; `/api/users` also returns PostgreSQL plan counts. Home
  reports `aiGeneratedCases: 0` until the AI generation domain moves. Orders and
  commissions remain MongoDB-backed and are not queried with PostgreSQL bigint
  IDs.

### 13. Notifications, Automation, And Diagnostics

- APIs: `/api/automation/reminders/run`, workflow notification list/poll,
  `/api/health`, `/api/debug`, `/api/debug/tenant-context`, and
  `/api/internal/seed`.
- Status: `Implemented` for scheduled reminder execution, browser polling,
  notification logs, health/debug checks, seed support, and Docker/release
  tooling. The internal-secret-protected seed route now bootstraps the initial
  PostgreSQL platform admin idempotently and requires an explicitly configured
  32-plus-character `INTERNAL_SECRET` plus a 12-plus-character
  `INITIAL_ADMIN_PASSWORD`; no source-code credential fallback remains. These
  endpoints require their documented role or operational context.
- Operational recovery: after PostgreSQL migrations are current,
  `npm run migrate:legacy-admin-users` is the idempotent operator command for
  importing legacy MongoDB platform-admin identities. It never overwrites a
  PostgreSQL account and reports skipped existing, invalid, or tenant-scoped
  records.
- PostgreSQL migration foundation: `Implemented` for the PostgreSQL 17
  Docker service, isolated `sfp_migrator`/`sfp_app`/`sfp_auditor` roles,
  bounded `pg.Pool`, reviewable Drizzle migrations, backup/restore-drill
  scripts, Docker health ordering, 44 typed target tables, foreign keys and
  indexes, forced RLS on tenant data, transaction-local tenant/platform
  context, and typed repositories for enterprise, department, admin-user,
  Mini Program user, lead, floor-plan, measurement, device, platform-config,
  prompt-library, system-role, media-storage configuration, promotion records,
   workflow notifications, reminder automation, orders, and commissions. The
  restore drill verifies table/RLS/policy counts.
  `/api/health` continues to require MongoDB and reports PostgreSQL separately;
  PostgreSQL becomes a health gate only when
  `POSTGRES_HEALTHCHECK_REQUIRED=true`. `Limited`: the PostgreSQL tables are
  still migration targets for domains not yet switched. Identity/enterprise
  core, leads, formal floor plans, measurements, devices, prompt-library reads,
  system-role configuration, global promotion configuration, media-storage
   configuration, promotion records, workflow notifications, reminder automation,
   orders, commissions, and enterprise activation are PostgreSQL-backed. AI
   generation/media remain on MongoDB while Phase 3 proceeds incrementally.
  Docker
  migrations run explicitly
  through `npm run docker:migrate`; the long-running admin service is not given
  `DATABASE_MIGRATION_URL`. Docker build context excludes runtime `.env*`, local
  RoomiAI/import assets, uploads, and local database backups; those assets must
  be injected or mounted at runtime.

## Core Models

- Identity: `AdminUser`, `SystemRole`, `User`, `Department`.
- Tenant/commercial: `Enterprise`, `Package`, `EnterpriseOrder`,
  `CommissionRecord`, `PromotionEnterpriseRecord`.
- Customer assets: `Lead`, `FloorPlan`, `Measurement`, `Device`, `Inspiration`.
- AI/media: `AiGeneration`, `AiWorkflow`, `AiChatSession`, `AiStylePreset`,
  `AiProviderConfig`, `AiProviderAttempt`, `MediaStorageConfig`, `MediaAsset`, `AiCreditAccount`,
  `AiCreditLedger`, `AiCreditPrice`, and `AiModelCreditPrice`;
  `EnterpriseAiUsageSnapshot` is
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
