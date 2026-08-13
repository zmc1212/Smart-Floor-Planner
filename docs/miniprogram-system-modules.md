# Mini Program: Current Module Inventory

### PostgreSQL-only AI APIs (2026-08-05)

Mini Program AI asset, task, workflow, and capability endpoints accept
PostgreSQL bigint identifiers only. The client does not depend on MongoDB or
ObjectId compatibility; prompt-library and Qiniu-backed media data are served
from PostgreSQL-backed repositories and storage adapters.

> 2026-08-04 PostgreSQL migration update: Mini Program AI upload, task and
> source routes now operate on tenant-scoped bigint PostgreSQL assets and
> generations. Historical ObjectId asset URLs remain readable only for legacy
> records through the compatibility delivery branch.

This inventory describes the native WeChat Mini Program under `miniprogram/`.
The implementation baseline is the current `app.json`, page handlers, shared
utilities, and the admin APIs they call.

### Subscription notification template handoff

The first four `房屋装修` public templates, fixed keyword choices, template-ID
readback requirements, and notification-type mapping are recorded in
[`docs/miniprogram-subscription-notification-template-baseline.md`](miniprogram-subscription-notification-template-baseline.md).
The authenticated endpoint now returns a complete ordered V2 list and the Mini
Program authorizes all four differently titled templates in one request while
reporting partial acceptance. Todo, lead-assignment, and new-lead delivery are
`Implemented`; the on-site measurement template is configured and authorized
but its real appointment trigger remains `Limited`.

The canonical route-to-design, HTML similarity, and production-restoration
lookup is `docs/miniprogram-design-restoration-ledger.md`, mirrored by
`docs/miniprogram-design-restoration-ledger.zh-CN.md`. Visual restoration work
must update that ledger pair in the same change.

## Status Legend And Runtime

- `Implemented`: the page and its real data/action path work.
- `Limited`: the path depends on login, an enterprise role, BLE hardware, a
  provider, or a particular formal wall-graph shape.
- `Placeholder`: the page or control is visible, but uses mock/local behavior,
  a planned toast, or no real server operation.
- Runtime: native WeChat Mini Program, JWT bearer requests through
  `utils/api.js`, a local `threejs-miniprogram` vendor adapter in the surveying
  package for opening 3D previews, and optional BLE laser distance meter
  integration.
- Package layout: the main package contains only the four Tab pages and their
  shared runtime. The Leads Tab and its Home-reused `components/lead-list` remain
  in the main package because TabBar routes cannot be subpackaged. `packages/surveying`
  owns the formal editor, its renderer, guide assets, and the 3D adapter;
  `packages/ai-workflow` owns AI create/result/history, their approved page-role
  artwork, and the legacy redirect; `packages/business` owns login and secondary
  business workflows with their page-exclusive assets (including lead form/detail,
  inspiration, and recommendations). These are ordinary subpackages that may
  depend on the main package but never on one another. No subpackage is preloaded
  at startup.
- Source-package guard: `project.config.json` excludes test fixtures, local
  development logs, and design-tool metadata from preview/upload packages.
  Production assets are local and image-compressed; the release budget is
  `<= 1.5 MB` for the main package and `< 2 MB` for every subpackage, verified
  with WeChat DevTools code dependency analysis.
- Main tabs: Home (`index`), Leads (`leads-management`), Design
  (`ai-design`), and Mine (`mine`), plus the custom center measurement action.
  Only those four `app.json.tabBar` routes mount the shared custom TabBar;
  Login, detail, workflow, inspiration, recommendation, formal surveying, and
  every other secondary or tertiary route must not render a local or duplicated
  TabBar. Its shared `128rpx` content lane keeps the centered `Measure` label
  entirely above the bottom inset; `constant(safe-area-inset-bottom)` remains
  as an iOS WebView fallback before the modern `env()` declaration.
- Shared TabBar V3 restoration (2026-08-07): the approved center action now
  renders the complete transparent Xiao K character holding a laser distance
  meter with no circular background, border, or circular shadow. Enterprise
  staff use the five-item layout with the `128rpx` Xiao K raised by `30rpx`;
  standalone promoters without AI Design use four equal live items and a compact
  `112rpx` Xiao K raised by `24rpx`, with no empty or disabled `Design` slot.
  The separate native `Measure` label remains at the existing `96rpx` safe
  baseline. Routes, the latest-plan lookup, formal-surveying entry, APIs,
  authentication, and permission boundaries are unchanged. Targeted TabBar,
  asset-budget, access-visibility, and offline-debug tests passed, and the full
  Mini Program suite passed `181/181`; the user's
  existing WeChat DevTools window verified the four-item promoter Home state at
  `390x844` in
  `design-references/qa/v3-tabbar-promoter-four-item-home-390x844.png`;
  the prior five-item Home, Leads, and Mine evidence remains in
  `design-references/qa/v3-tabbar-no-circle-390x844-contact-sheet.png`.

## Shared Identity And Context

- `/packages/business/login/login`: WeChat phone quick login and username/password login via
  `/api/auth/miniprogram`; restores a JWT/user session in app storage.
- Session changes: every primary Tab page asks the shared custom TabBar to
  recompute its selected item and enterprise-only visibility on show; Mine also
  repeats that refresh after its workbench response completes the current user
  context. Switching from a standalone promoter to an enterprise designer
  therefore reveals the `Design` tab without restarting the Mini Program;
  logout immediately reapplies the same visibility rule. When `Design` is not
  available, the TabBar renders four equal real actions (`Home`, `Leads`,
  `Measure`, and `Mine`) and applies the compact Measure treatment instead of
  leaving an empty slot or exposing a disabled AI entry. This is client-side
  presentation only and does not change authentication, routes, APIs, or the
  `enterpriseId` permission boundary.
- Login visuals: `Implemented` against
  `design-references/all-pages-ip-v1/06-login.png` at the iPhone 13 Pro
  `390x844` baseline. The page uses the derived local Xiao K/F3 entry scene,
  its approved brand/welcome lockup, an overlapping two-mode login panel,
  locally rendered licensed icons, a compact capability summary, and a same-screen
  return action. Authentication behavior, loading/error feedback, notification
  opt-in, and route return semantics are unchanged.
- Access is staff-only: password login requires an active backend `AdminUser`,
  while WeChat code/phone login must match an active `AdminUser` by bound OpenID
  or backend phone number. Unmatched external users receive `403` and cannot
  establish an authenticated Mini Program business session. Account, bound
  identity, enterprise, and permission resolution now use PostgreSQL and
  revalidate active status on refresh and request-context resolution.
- `app.js`: restores sessions, reads QR/referral `enterpriseId`/`staffId`, syncs
  staff professional context, loads enterprise branding from PostgreSQL through
  `/api/branding/[id]`, and attempts silent BLE
  reconnection for a remembered device.
- `utils/api.js`: sends the bearer token through the explicitly selected
  `ACTIVE_API_ENVIRONMENT` (`local` or `production`), clears expired sessions,
  and redirects to login after a 401. Requests never fall back across
  environments, and persisted `apiBaseUrl` values are not consulted.
- Mini Program AI asset delivery: `/api/miniprogram/ai/assets/[id]/image`
  reads new decimal PostgreSQL asset IDs in tenant RLS scope. Legacy MongoDB
  ObjectId URLs remain readable only as retained historical AI records.
- Status: PostgreSQL-backed login and context restoration are `Implemented`; a
  valid WeChat authorization, account, API base, and enterprise/provider
  configuration are required for the corresponding path. `Limited` during
  Phase 3: AI generation/media and order/commission workflow domains still
  backed by MongoDB are not bigint-identity compatible until their scheduled
  PostgreSQL switch. Leads, formal plans, measurements, and device bindings now use
  PostgreSQL.

## Page Inventory

### Home And Measurement Entry

- Page: `pages/index/index`.
- APIs: `/api/miniprogram/home`, `/api/floorplans`, `/api/floorplans` POST/PUT,
  `/api/leads/[id]`, `/api/location/reverse`, `/api/users/me`.
- Implemented: dashboard summaries, location/city, role-scoped recent cloud
  plans (which remain visible while a local draft exists and open the formal
  editor directly), lead capture, BLE connection state, remembered-device
  auto-connect, new/continue formal surveying, floor-plan room entry, AI
  handoff for a room, a persistent AI Design shortcut for enterprise staff,
  and direct Home shortcuts to Leads and BLE pairing.
- Limited/debug-only: the custom center Measure action first requests the
  latest `/api/floorplans` record before opening the formal editor. When
  `miniprogram/utils/debugConfig.js` sets
  `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` to `true`, a failed request opens a new
  local surveying session with `startNewSurvey: true` so the editor UI and
  interactions can be debugged without a reachable API. The switch defaults to
  `false`; saving still requires the normal authenticated API path.
- Data boundary: lead, formal-plan, measurement, and assigned-device counts plus
  recent formal plans come from PostgreSQL RLS repositories. The AI-generation
  domain is not migrated yet, so `aiGeneratedCases` is explicitly `0`. Each
  recent-plan item also exposes the linked lead's optional `customerName` and
  `communityName`; the Home reminder, active-measurement card, and project-progress
  card consume the shared formal-plan `display` read model: the community is the
  primary project title and `customer · 第 N 次量房` is the secondary identity.
  The persisted formal-plan name is only a compatibility fallback, while status,
  closed-space count, and timestamps remain metadata. The role-filtered AI-source
  endpoint returns the same display model.
- Permission boundary: a direct Home entry to a recent plan uses the same
  staff-owner scope as the recent-plan list. Enterprise administrators retain the
  enterprise boundary; standalone promoter accounts with no enterprise use their
  own staff ID, and neither path broadens a regular staff member's access.
- Limited: the write/notify characteristic pairing is hardware-specific. BLE
  diagnostics log the discovered channel properties, each command write, and
  each raw notification with full service/characteristic UUIDs; receive buffers
  are isolated per notification channel. Private binary payloads remain raw
  diagnostics until their protocol mapping is confirmed.
- Device authorization: `/api/devices/verify-binding` uses a platform-scoped
  lookup, then requires the discovered device to be `assigned` and to match the
  current staff member or enterprise. Assigning a holder in `/devices`
  automatically changes an idle device to `assigned`; `maintenance` and `lost`
  devices remain unavailable.
- Visual baseline: `design-references/all-pages-ip-v1/01-home-v2.png` at iPhone
  13 Pro `390x844`. The shipped F1/F3 spatial-guide hero, overlapping formal
  surveying card, quick-service cards, and project-progress card use the
  project-local derived `images/home-ip-v1/hero-scene-wechat-safe-overscan.png`
  scene asset, which reserves the native WeChat capsule safe area. The live city
  control sits beside the brand lockup and the headline is a three-line
  composition. The Hero remains at its single `516rpx` anchor: it has no
  top-right reminder bubble or capsule-dependent reminder positioning. When a
  live recent plan exists, its measurement card alone presents the current-plan
  reminder as a green rounded bell badge immediately before the Xiao K completion
  or in-progress label. City, counts, device state, recent plans, empty state,
  and all navigation remain live and role-aware.
- Placeholder: the help center still shows an “upcoming” message.

### Leads And Customer Records

- Pages: `packages/business/lead-form/lead-form`,
  `pages/leads-management/leads-management`,
  `packages/business/lead-detail/lead-detail`, and
  `packages/business/acquisition-center/acquisition-center`; designer contact
  details reuse `components/designer-contact-sheet`.
- APIs: `/api/leads`, `/api/leads/[id]`, `/api/acquisition-tasks`, and
  `/api/floorplans/[id]` GET/DELETE.
- Implemented: customer name/phone/community/area/style capture, recent leads,
  list/detail views, formal-plan association, primary-plan name/status/closed
  space count in lead detail, continue measurement, start a new independent
  measurement, delete active formal plans with local pointer cleanup,
  client-side search across loaded records, and canonical status filtering
  through both the stage strip and native action sheet. Deletion is allowed only
  while the linked lead is in `new` or `measuring`; `/api/floorplans/[id]`
  returns `409 FLOOR_PLAN_REQUIRED_FOR_LEAD_STAGE` from `designing`,
  `converted`, or `closed` so a design-stage lead cannot lose its formal-plan
  basis and fall back to the start-measurement state. The customer workflow is
  `New lead -> Measuring -> Design proposal -> Signed`; `closed` remains a
  terminal filter, while historical `acquired` values render as `New lead` for
  compatibility. Acquisition confirmation is an independent collaboration fact,
  not a customer workflow stage.
- Persistence: lead and formal-plan list/detail/create/update/delete operations
  use PostgreSQL RLS transactions and decimal-string IDs; lead-plan linking and
  primary-plan cleanup are atomic.
- Archive lifecycle (2026-08-10): all Mini Program lead/acquisition/AI customer
  queries default to active leads. Archived leads disappear from daily lists,
  acquisition tasks, and AI project selectors; direct writes, floor-plan links,
  acquisition confirmation, and new/retried AI tasks return
  `409 LEAD_ARCHIVED`. Duplicate phone intake returns
  `409 ARCHIVED_LEAD_EXISTS` and requires an authorized Admin restore. Existing
  floor plans, AI results, commissions, and financial settlement history remain
  available in their asset/history modules with an archived-customer marker.
- Visual baseline: `design-references/all-pages-ip-v1/02-leads-management.png`
  at `390x844`. The shipped page follows its Xiao K client-concierge scene,
  green dossier summary, search/filter/create action order, four main
  dossier-index
  stage tabs, stacked customer-record cards, and right-aligned color-coded
  floor-plan thumbnails. A capsule-safe lightweight `My Designer` entry opens
  the shared bottom contact sheet; signed QR and WeChat details are no longer
  repeated on list cards. The list workspace and its `list-scroller` form one
  continuous flex-height chain, so the scroller fills the viewport space left
  after the page header and its own search and stage controls. Thumbnail geometry still renders from each lead's
  formal wall graph or a real external preview URL, and live data, pagination,
  errors, empty states, navigation, and the shared five-item custom tab bar remain
  authoritative. The packaged scene derivative is
  `images/leads-ip-v1/client-concierge-scene.png`; it contains no customer counts
  or interactive controls. The shared raised Measure entry uses the transparent
  full-body `images/mine-icons/tab-measure-k.png` Xiao K character holding a
  laser distance meter, with no circular background, border, or circular shadow;
  its live `Measure` label remains a separate native text node. Both assets were
  exported from generated sources rather than cropped directly from a flattened
  page reference. The summary's new-today,
  active-follow-up, and converted
  counts are tenant/staff-scoped server aggregates rather than values inferred from
  the currently loaded page.
- Limited: lead creation and plan operations require a valid Mini Program session;
  phone and community validation are client-side plus server-side checks. Search
  covers the records currently loaded by pagination; choosing a status performs
  a server-filtered reload.

### Enterprise Promotion And Staff Tasks

- Pages: `packages/business/promotion-records/promotion-records` and
  `packages/business/promotion-record-detail/promotion-record-detail`.
- APIs: `/api/promotion-records`, `/promotion-records/[id]`, `/promotion-records/pool`,
  `/staff?roles=...`, workbench summary/todos, and related update endpoints.
- Implemented: create enterprise reports, list role-specific views (`my`,
  `measure`, `design`, `admin`, `overdue`, `pool`), search/filter, public-pool
  claim or approval request, conflict ownership resolution, follow-up notes and
  due dates, measurer/designer/promoter assignment, and business-stage actions.
  Create mode includes native industry and region selection, WeChat location
  capture, required-field validation, duplicate-submit protection, and the
  existing success redirect into the newly created report detail.
- Visual baseline: the list page follows
  `design-references/all-pages-ip-v1/09-promotion-records.png` at `390x844`. It
  uses the derived local `packages/business/assets/promotion-records/hero-scene.jpg` asset for Xiao
  K's enterprise-filing role, keeps the five `my`/`measure`/`design`/`overdue`/`pool`
  views directly accessible, searches the loaded view by enterprise, contact,
  phone, or location, and renders live workflow status, follow-up, timestamp,
  claim, loading, and empty-state data. This is a tertiary workflow route and
  deliberately has no standalone TabBar or duplicated top-level navigation.
- Create visual baseline: `mode=create` follows
  `design-references/all-pages-ip-v1/11-promotion-record-create.png` at
  `390x844`. The page uses the derived local
  `packages/business/assets/promotion-create/hero-scene.jpg` asset for Xiao K's enterprise-intake
  role, separates enterprise and contact information into work-order sections,
  uses one licensed local Lucide icon family, and keeps all labels and controls
  as live WXML rather than image text. The real required fields remain company,
  contact, and phone; city, industry, address, notes, location, submission
  feedback, API payload, and redirect behavior remain authoritative.
- Visual baseline: `design-references/all-pages-ip-v1/10-promotion-record-detail.png`
  at `390x844`. The detail page now uses its compact Xiao K report-stamp scene,
  server-driven four-stage rail, follow-up form, activity timeline, and
  administrator assignment panel. Contact phone numbers are masked in this
  detail view; the underlying record, stages, timestamps, staff options, role
  checks, and mutations remain live.
- PostgreSQL boundary: report creation, list/detail mutations, pool/conflict
  actions, workbench todos, notification polling, and reminder state now use
  the typed PostgreSQL repositories with tenant RLS. Existing response DTOs,
  staff-role checks, and `leadId`/record navigation remain unchanged. Orders
  and commissions remain MongoDB-backed and are exposed as a separate `Limited`
  read/settlement domain.
- Limited: available actions and list views depend on the logged-in staff role
  and the server-side promotion workflow state; order/commission data still
  depends on the legacy MongoDB commercial workflow.

### Commission Records

- Page: `packages/business/commission-records/commission-records`.
- API: `/api/commission-records`.
- Implemented: a high-fidelity income-center summary, interactive filters, and
  truthful order, amount, date, and status presentation for pending, paid, and
  voided commission records. Loading, empty, failure/retry, and settlement
  explanation states are included.
- Limited: records are generated and settled by the enterprise order workflow;
  the Mini Program is a read view, not the settlement authority.

### Inspiration Library

- Page: `packages/business/inspiration/inspiration`.
- API: `/api/inspirations?page=...&style=...&roomType=...`.
- Implemented: paginated loading, pull-to-refresh, style and room filters,
  image preview, share-poster shell, and free-design lead entry.
- Navigation: retained as a secondary route and no longer occupies a primary
  tab.
- Limited: result availability depends on published backend inspiration content.

### AI Design And Enterprise Credits

- Pages: `pages/ai-design/ai-design`,
  `packages/ai-workflow/create/ai-design-create`,
  `packages/ai-workflow/result/ai-design-result`, and
  `packages/ai-workflow/history/ai-design-history`; legacy
  `packages/ai-workflow/legacy/ai-gen` is a compatibility redirect only.
- Navigation: `pages/ai-design/ai-design` is the primary `Design` tab; it
  uses `navigationStyle: custom`, measures the native capsule/safe area, and
  integrates its title and credit balance into the spatial header instead of
  rendering the centered default WeChat title bar. It also uses the shared
  fixed custom-tab layout and scroll/refresher contract.
  Contextual entries transfer floor-plan, room, lead, scope, and workflow state
  through `utils/aiDesignNavigation.js` before calling `switchTab`, because
  WeChat tab pages cannot receive those entries through `navigateTo` queries.
  The tab and all AI entry points are hidden for staff sessions without an
  `enterpriseId`; the shared navigation and page guard return any legacy/direct
  route to Home before an AI API is requested.
- APIs: Mini Program AI capabilities, role-scoped formal-plan/room sources,
  normalized formal wall/room navigation read models, the current whole-plan
  navigation-preview state, context-visible active workflows, media upload/signed reads,
  task create/run/status/retry, and history
  list/delete endpoints through `utils/aiDesignService.js` with bearer JWT
  authentication.
- Project index (2026-08-10): the role-scoped source response is now also the
  AI-workbench project read model. It keeps persisted `FloorPlan`, active
  `AiWorkflow`, and Mini Program `AiGeneration` states unchanged, then derives
  `generating | continue | retry | stale | ready | needs_survey`. The UI groups
  those states as `In progress` (an exact active workflow exists for the current
  operator and floor plan), `Ready` (the formal plan passes the shared workflow
  eligibility check and has no active workflow), or `Survey needs work`
  (eligibility failed). Eligibility exposes stable reasons for an incomplete
  survey, invalid formal graph, missing closed space, or missing usable wall.
  The source response now retains those ineligible version-4 survey records for
  recovery instead of dropping every plan without a closed room; the legacy
  flat room list remains eligible-only. Workflow lookup additionally honors the
  requested `floorPlanId`, while the project index supplies the latest accessible
  task and current stage without changing tenant/operator boundaries. A direct
  visit now selects the first eligible server-ordered project (`In progress`
  before `Ready`); if no project is eligible, it opens the grouped project picker.
  It never queries cross-project workflows or opens the legacy scheme picker on
  arrival. Multiple schemes remain an explicit choice only when the user starts
  an action that cannot otherwise be resolved.
- Target context: workflow reads for a selected plan filter the current
  operator's active workflows by `leadId` and exact `floorPlanId`; generation
  requests carry `floorPlanId + targetScope + roomId` (with `roomId` omitted only
  for `whole_floor_plan`). A single-room result matches only
  the same formal plan and room; whole-plan and legacy tasks with missing scope
  metadata never fill a room automatically. The exact globally adopted result
  wins when it belongs to the target, otherwise the newest exact successful
  result is used. Results older than `FloorPlan.updatedAt` remain in history but
  are not continued automatically. The PostgreSQL workflow response preserves
  this contract: `workflowId` is an exact server-side filter, and each matching
  workflow is enriched from its tenant-scoped generation records with
  `selectedTask`, `latestTask`, and the exact `targetContext`. The create page
  also resolves the requested workflow by ID rather than list position and
  surfaces stale-baseline errors instead of relabeling them as capability-load
  failures.
- Archived lead handling: the Mini Program source index excludes formal plans
  whose linked lead has `archivedAt`. Opening AI Design with an archived lead
  therefore switches to the restored `ai-design-customer-workbench-empty-v2`
  empty state and does not issue a workflow query. Restoring the lead makes the same
  formal plan selectable again; workflow, credit, and permission boundaries are
  unchanged.
- Implemented: enterprise-shared AI-credit and action-price display; an
  immersive spatial home surface that retains the four real tasks for reference
  recreation, whole-space style transformation, formal-floor-plan concept
  rendering, and soft-furnishing refinement. With a formal plan selected, the
  home surface derives its navigable rooms and walls from the version-4 survey
  graph, supports whole-plan/room targets, shows the ordered `Space baseline`,
  `Style scheme`, `Soft furnishing`, and `Proposal refinement` scheme journey,
  and presents one context-aware next action. A current successful whole-plan
  result is reused as the 3D navigation cover; an in-progress result exposes
  live progress; and a missing or stale result falls back to the deterministic
  2D formal graph with an explicit credit-charging generate/regenerate action.
  Only tasks stamped with the current `cutaway-v1` navigation-render contract
  qualify as covers. The page never creates a paid preview automatically, and a result is stale
  when its task predates the formal plan's latest update. The old unscoped
  interior-scene home and its four tool waypoints are no longer a fallback for
  this customer-project workbench. With no selectable project, the route shows a
  project-specific empty state and recovery action instead. Existing generation capabilities include dual-image
  reference input, source-image plus preset styles, camera/album upload with
  byte-signature validation, stable local previews and in-place upload retry,
  server-derived output proportions that map the composition source to a
  provider-supported specification. Plan-backed reference recreation submits an
  isolated selected-room (or complete-plan) control image first as the
  authoritative wall/door/window structure and the reference image second for
  camera, framing, composition, and style; its output ratio still follows the
  reference and it does not require another room photo. Standalone recreation
  retains reference-first/room-image-second input,
  asynchronous provider states, task failure retry and credit release, draggable
  before/after comparison, single-image floor-plan results, preview/share, and
  real result-image saving that waits for the album write and guides denied users
  to WeChat photo-album settings,
  history reuse, and deletion. Task-detail reads force an upstream status query
  for processing jobs. The home `Recent designs` section keeps all non-terminal
  `created`, `pending`, and `processing` jobs ahead of other recent results, shows their real numeric
  stage progress in green without inventing a minimum, preserves recency within
  each group, and refreshes every five seconds until visible jobs reach a
  terminal state; history reads reconcile up to four visible processing jobs
  before serialization. Initial loading, recoverable refresh failure, missing
  result imagery, provider unavailability, and customer-workflow loading failure
  have explicit states; a workflow lookup failure blocks generation so an
  outcome cannot silently attach to the wrong scheme. The home
  page provides a project-switching bottom sheet with customer/community search,
  server-derived state groups, real task progress and failure/stale recovery.
  Eligible project selection defaults to the complete plan; the existing
  horizontal scope rail then switches to a closed room without opening a second
  selector step. Ineligible records expose the exact reason and reuse
  `utils/surveyNavigation.js` to continue the sole formal surveying flow. Its
  `leadId`, `floorPlanId`, `targetScope`, and optional `roomId` are
  inherited by all four tasks, while only formal-plan rendering makes that
  context mandatory. Complete-plan rendering produces one furnished, elevated
  isometric cutaway concept for the navigation cover; single-room rendering
  produces one eye-level room concept. A compact current-scheme card auto-selects one active match,
  asks the user to choose when multiple schemes exist, and retains an explicit
  create-alternative option. Create/results/history show scheme ownership and
  synchronization state.
- Workflow integration: with a valid `leadId`, or a `floorPlanId` that resolves to
  a lead, Mini Program generations explicitly continue the chosen shared
  `AiWorkflow`, reuse a unique customer/formal-plan match, or create a new one and
  map to `base_render`, `perspective_upgrade`, or `soft_furnishing`. Once its
  result image is persisted, a successful Mini Program run participates in the
  same workflow synchronization as an Admin scenario: the first base/soft-
  furnishing result becomes the workflow baseline and advances the stage;
  later results at that stage stay candidates. A pending, failed, or image-less
  task cannot advance the workflow. The Mini Program can continue style/soft-
  furnishing steps directly, while proposal and lighting hand off to Admin.
  Active-generation deduplication is scoped to workflow, stage, formal plan,
  target scope, and room, so different rooms may run concurrently without
  allowing duplicate credit holds for the same room. A coworker's active task
  returns only a busy state; only the creating operator receives its task link.
  Automatic continuation sends `sourceResultTaskId`; the server revalidates the
  exact current target, copies internal outputs or downloads external provider
  URLs into a new `ai_generation_input`, and records `parentGenerationId` before
  any credit hold. Manual space uploads are mutually exclusive with this source.
  Historical redesign reuses the original input, while legacy tasks without an
  exact target remain explicit history only. Ad-hoc tasks without customer
  context remain supported as quick standalone generations.
- Visuals: locally rendered Lucide icons, hairline separators, output-ratio-aware
  result/compare stages that use the reference image for recreation comparisons,
  and the iPhone 13 Pro `390x844` baseline. The selected-plan home now uses
  `design-references/ai-design/ai-design-customer-project-switcher-v3/ai-design-customer-workbench-home-v2.png`
  as its restoration target, paired with the switcher-v3 sheet reference. The project-switching restoration uses
  `/images/generated-hero-bleed-v2.png` as the selected project's fallback
  whenever it has no current successful whole-plan render. This is the approved
  standalone Hero source from `design-references/html-prototypes/ai-design-customer-workbench/`, rendered with `aspectFill` to cover the full stage.
  The local artwork restores the approved emerald floor-plan-to-interior composition and
  contains no business copy or controls; all project identity, state, progress,
  and actions remain native. That hero may be
  replaced by up to five tappable carousel slides: the
  current operator's successful `floor_plan_render` outputs whose exact
  `floorPlanId` and `targetScope: whole_floor_plan` match the selected plan.
  The Mini Program requests these slides through a dedicated, server-filtered
  history query (operator + exact `floorPlanId` + successful whole-plan render,
  capped at five), rather than filtering a paginated recent-history response;
  therefore an older result for a busy surveyor's selected customer is not
  dropped. Room renders, style edits, stale outputs, and results from another lead never
  enter the carousel. The emerald hero itself now carries the live progress,
  four-stage rail, and single truthful next action. It is followed by native
  customer/project search, a horizontal `Space schemes` strip backed by the
  real role-scoped project index, and a truthful design-preparation entry for
  incomplete surveys. The old room-chip rail and raised project-state card are
  removed; the four implemented task entries remain available below the first
  viewport in a visually secondary tool dock. The selected hero keeps a persistent
  `Switch project` action plus a tappable customer/project identity; source
  clearing remains available inside that picker, multiple active
  schemes still require explicit selection, and recent live results remain below
  the first-viewport workbench. The custom navigation reserves the measured WeChat
  capsule lane even where the supplied reference does not show that capsule. The
  obsolete no-plan spatial-tour branch has been removed from this route; the
  no-project state remains inside the same project-workbench information
  architecture. The automatic-arrival workbench and grouped project picker were
  inspected in the user's existing WeChat DevTools window at the `390x844`
  baseline; the current restoration captures are
  `design-references/ai-design/ai-design-customer-project-switcher-v3/qa-restored-ai-design-entry-v5.png`
  and `qa-restored-project-picker-v5.png`. The open picker restores the in-hero
  live progress and four-stage rail, uses a reference-measured half-screen sheet,
  and combines the formal-plan preview with the latest accessible result when
  both exist. Failed remote thumbnails fall back to the formal navigator/local
  plan mark rather than leaving a misleading empty image. The picker explicitly hides the shared
  custom TabBar while open and restores it on close or page exit. The DevTools
  automation endpoint remains unavailable, but it is no longer a blocker for
  this visual evidence. Intentional deviations from the
  comp are truthful missing-result placeholders, visible cost metadata, the capsule
  safety lane, the shared custom TabBar, and existing coherent task iconography
  instead of static sample-plan imagery. The 2026-08-10 re-restoration changes visual
  composition and adds the narrowly scoped carousel-history query. The default
  image and generated carousel share the same compact rounded emerald project
  stage below the capsule-safe header. Native project identity, state, formal
  survey metadata, and switching controls stay above the artwork; the bottom
  sheet covers the custom TabBar and includes bottom-safe-area padding.
  routes,
  permissions, point charging, workflow selection, and formal wall-graph
  contracts are unchanged. The create page now follows
  `design-references/all-pages-ip-v3/14-ai-design-create-v3.png`: its native step
  rail, Xiao K material-board scene, formal-plan/workflow context, truthful image
  upload states, server-provided style presets, inherited read-only design scope,
  real enterprise credit balance, and primary generation action remain visible in
  one compact flow. It does not make the reference's range cards editable when the
  current workflow has no room picker on this page, and it never shows a sample
  room image as if the user had uploaded it. Capability-loading failure now has an
  in-page retry state. The current mode title now leads the context card, upload
  guidance explains the actual input contract for that mode, and the inherited
  scope is rendered as a passive summary instead of a radio-like control.
  Submission readiness is derived from provider availability, required source
  images, the selected server style, and the enterprise balance. The fixed-width
  action area stays visible at the bottom of the `390x844` composition; its label
  exposes the first blocking requirement, and an insufficient balance opens the
  truthful recovery path to contact the enterprise administrator. Style selection
  is locked while an upload or submission is active. Only verified local
  derivatives are mapped to known server style keys, while an unknown style
  receives a native descriptive placeholder instead of an unrelated sample image.
  The design derivatives contain artwork and style thumbnails only; business copy,
  controls, selection state, credits, and uploads stay native. The user's existing
  WeChat DevTools window verified the standalone insufficient-credit state, the
  style-transform insufficient-credit state, and the formal-plan whole-scope state
  with native status/capsule chrome at `390x844`; retained captures are
  `output/ai-design-create-v3-qa-390x844.png`,
  `output/ai-design-create-v3-style-transform-qa-390x844.png`, and
  `output/ai-design-create-v3-formal-plan-qa-390x844.png`. The Mini Program suite
  passed `185/185` and `git diff --check` passed.
  Routes, APIs, permissions, credit charging, task validation, workflow ownership,
  and formal wall-graph contracts are unchanged. The result page now follows
  `design-references/all-pages-ip-v3/15-ai-design-result-v3.png`: the native
  `设计成果` bar, one Xiao K delivery cue, and a status bubble lead into the
  ratio-aware before/after stage; its five visible controls map only to live
  preview, album save, WeChat share, continue optimization, and history paths.
  The customer-scheme, target, mode, and credit rows remain server-derived, and
  the bottom primary/secondary pair reuses the existing continuation and history
  handlers. This is a visual-only restoration: routes, APIs, permissions, credit
  charging, task/workflow selection, and the formal wall-graph contract remain
  unchanged.
- Result comparison is now shown only when the task has a real uploaded/source
  image. `floor_plan_render` tasks are generated from formal floor-plan data and
  therefore render a single result image without a draggable comparison handle;
  the result route, task data, permissions, and charging contract are unchanged.
- Result-page visual alignment refinement (2026-08-07): the `15-ai-design-result-v3.png`
  restoration now uses the reference's compact page inset, taller near-square result
  stage, bottom-anchored source/result labels, tighter icon-to-label spacing, and a
  clipped Xiao K delivery character that excludes the source artwork's decorative
  frame. Actions, data, routes, permissions, and charging remain unchanged; native
  WeChat capsule/device capture is still the outstanding visual-QA evidence.
- Result-image delivery correction (2026-08-12): task DTOs now return expiring,
  tenant-signed same-origin URLs for every protected input/control/result
  `MediaAsset`. When the platform intentionally keeps a GRS `http(s)` result instead
  of transferring it, the Mini Program receives a signed task-result image route
  that validates tenant/task ownership and streams the verified JPG/PNG bytes from
  the server; it never asks the WeChat `<image>`, preview, album-save, or share paths
  to load the unapproved provider host directly. Existing succeeded tasks such as
  task `1071` recover after a detail reload and do not require regeneration or
  another credit charge. Placeholder or invalid `MINIPROGRAM_API_PUBLIC_ORIGIN`
  values fall back to the actual/forwarded request host, so a local `3005` build
  cannot rewrite a valid signed image URL to `api.example.com`. The approved visual authority remains
  `design-references/all-pages-ip-v3/15-ai-design-result-v3.png`; WXML/WXSS geometry,
  actions, route, role/tenant access, workflow selection, charging, and the version-4
  wall-graph contract are unchanged. Focused serializer/signature regression tests
  verify protected assets, direct-provider results, and public-origin fallback. For
  task `1071`, the previously returned unsigned asset request reproduced `401`, while
  the same `1,496,827`-byte PNG returned `200 image/png` through signed delivery. A new native `390x844`
  capture remains pending because the existing WeChat DevTools window exposes no
  compatible automation endpoint.
- Result-page fidelity review (2026-08-11):
  `design-references/all-pages-ip-v3/15-ai-design-result-v3.png` remains the sole
  visual authority. At the `390x844` baseline the delivery cue is compressed, the
  complete Xiao K result-delivery role is restored on the right, and the five-action
  strip, four equal summary rows, and normal-flow primary/secondary footer recover
  the approved first-screen rhythm. The result stage is constrained to a
  `720–760rpx` near-square delivery window: near-square outputs use `aspectFill`,
  while clearly wide or tall outputs use `aspectFit` so their full composition is
  preserved without letting an arbitrary provider ratio stretch the page. Share now
  uses the same local green Lucide outline language as the other actions. Candidate
  or selected-baseline status no longer competes with the summary; workflow
  ownership, current space, generation mode, and real credits remain task-derived.
  Routes, APIs, role/tenant permissions, charging, task/workflow selection, and the
  version-4 formal wall-graph contract are unchanged. A new native-capsule
  `390x844` capture remains a release check until the current WeChat DevTools window
  exposes a compatible automation endpoint.
- AI workflow subpage restoration gate (2026-08-11): the independent HTML
  prototype under `design-references/html-prototypes/ai-workflow/` maps the
  create, result, and history routes to
  `design-references/all-pages-ip-v3/14-ai-design-create-v3.png`,
  `15-ai-design-result-v3.png`, and `16-ai-design-history-v3.png`. At the
  iPhone 13 Pro `390x844` baseline, the final documented composite similarities are
  `98.59%`, `98.70%`, and `99.30%`; all three pass the upgraded `96%`
  composite and `96%` asset-source/bounds/crop gates. The final browser captures, same-scale
  overlays, element ledger, measurements, scoring weights, and exclusions are
  retained beside the prototype. No application-content region was masked and
  no flattened design screenshot was used as implementation. Twelve exact
  source regions are packed into one local comparison artboard, then exported
  through its coordinate manifest. Production maps the exact create scene and
  three style cuts to `/packages/ai-workflow/assets/page-ip-v3/ai-create.jpg` and
  `ai-create-style-{modern,cream,chinese}.jpg`, the result-delivery cut to
  `ai-result.jpg`, and the history archive cut to `ai-history.jpg`; the three
  prior approximate PNGs were removed after reference migration. Production now
  aligns the create page's full-bleed material-board scene and compact context
  card, the result page's delivery header, four-row summary, and first-screen
  action footer, and the history page's compact task cards with native time,
  target, status, progress, and navigation affordances. History metadata is
  derived from the existing task response; missing thumbnails remain truthful
  native placeholders. The legacy `packages/ai-workflow/legacy/ai-gen` route
  remains redirect-only. Routes, APIs, role/tenant permissions, enterprise
  credits, workflow/task selection, media behavior, and the version-4 formal
  wall-graph contract are unchanged. The targeted AI-workflow suite passed
  `13/13`. The current WeChat DevTools project window was reused, but none of
  its listening endpoints exposed the compatible automation protocol required
  for a fresh compile, route-stack assertion, and native-capsule screenshot;
  that native `390x844` evidence remains the release check and no duplicate
  DevTools window was opened.
- Formal-plan boundary: entries pass `floorPlanId`, explicit
  `targetScope: whole_floor_plan | single_room`, and `roomId` only for a single
  room. The backend derives dimensions, ceiling height, and opening summaries
  through the formal survey-graph read adapter and never mutates
  `FloorPlan.layoutData`. For complete-plan rendering it rasterizes a derived
  1024px wall/opening control image into a separate `MediaAsset` and uses image
  editing to request an elevated, roofless 3D cutaway while preserving measured
  structure; a standalone single-room render uses measured prompt context and
  image generation. Successful navigation covers remain `AiGeneration`/
  `MediaAsset` output and are never written back into the formal layout. The
  source response adds only a derived navigator read model and authorized signed
  preview data. Reference recreation with a selected formal target also
  rasterizes a control image, limited to that closed room when `roomId` is
  present, and sends it before the visual reference.
  The source selector returns only formal plans and closed rooms visible to the current
  enterprise role (assigned leads for designers, assigned plans for measurers,
  and enterprise-scoped plans for enterprise administrators).
  Floor-plan-only output is a concept visualization, not construction-grade or
  pixel-exact reconstruction.
- Limited: only enterprise staff with an `enterpriseId` can use AI design.
  Standalone channel promoters have no enterprise by design, so the client
  hides all AI entry points and does not request AI APIs for their sessions.
  Enterprise AI design requires an available platform-managed provider
  routing and enterprise AI credits. The server may route GRS, Pollinations, or
  another configured compatible provider without changing Mini Program APIs.
  Mini Program scenarios always use the platform's configured logical-model
  default; the client does not expose the free-creation model selector or
  model-resolution pricing controls.
  Plan-backed reference recreation sends the measured control and visual
  reference together, but a 2D wall graph has no measured camera pose and the
  provider still cannot guarantee pixel-perfect reference duplication. The
  structural control takes precedence when constraints conflict. The generated
  3D cover may vary in furniture and unmeasured finishes, is not used once stale,
  and remains a concept rather than a measurement source. Floor-plan-only
  generation cannot infer an exact camera or unmeasured finishes. There is no
  WeChat recharge, mask-based replacement, or homeowner account. Media URLs stay
  on the authenticated Mini Program asset endpoint: the local provider streams
  bytes, while the Qiniu private-bucket provider redirects to a short-lived
  signed URL without changing the page contract. A server-side Qiniu object
  prefix affects only new persisted object keys and is transparent to Mini
  Program pages and URLs. Qiniu upload failures do not fall back to local
  storage, historical assets stay readable through their own stable provider
  config, and the HTTPS download domain must be allowlisted in
  WeChat. By default, GRS `http(s)` result URLs are returned directly and their
  host must also be an allowed Mini Program download domain in production. When
  the platform enables GRS output transfer with a Qiniu default provider, only
  subsequent results use the Qiniu signed-read path. Production local storage requires shared `AI_ASSET_STORAGE_DIR`;
  signed Mini Program media also requires an HTTPS `MINIPROGRAM_API_PUBLIC_ORIGIN`.

### Mine And Workbench

- Pages: `pages/mine/mine`, plus
  `packages/business/profile-edit/profile-edit`,
  `packages/business/settings/settings`, and
  `packages/business/account-security/account-security`.
- APIs: `/api/miniprogram/mine`, `/api/miniprogram/profile`,
  `/api/miniprogram/profile/avatar`, the signed profile-avatar read route,
  `/api/miniprogram/account/password`, `/api/floorplans`, and navigation to
  leads, promotion records, commissions, surveying, and the AI design home.
- Implemented: profile/role display, workbench summary, todos, floor-plan list,
  notification/account actions, persistent nickname/avatar editing, WeChat
  subscription and permission settings, authenticated staff password changes,
  logout, new measurement, an enterprise-staff
  AI Design home entry, contextual AI entry from a plan card, and a role-shaped
  Acquisition Collaboration action with a live pending badge for designers and
  measurers.
- Visual: the Mine surface follows `design-references/mine/miniprogram-mine-v6.png`
  at the iPhone 13 Pro `390x844` baseline. Its left-weighted translucent profile
  card preserves the visible home scene, while the white rounded summary tray,
  three baseline metric illustrations, fixed four-column workbench rhythm,
  compact two-item todo list, and AI design banner use production crops derived from
  `design-references/mine/miniprogram-mine-v6.png` and
  `design-references/mine/miniprogram-mine-v6-icon.png`. The raised Measure action
  uses the shared generated transparent full-body Xiao K asset holding a laser
  distance meter, with no circular background, border, or circular shadow; its
  live label remains a separate native text node. The expanded
  shared content lane keeps that native `Measure` label visible above the iOS
  Home Indicator safe area. Live profile data,
  server-provided actions and metrics, role boundaries, and existing navigation
  remain authoritative; the redesign does not add backend capabilities. Summary
  cards remain horizontally reachable when a role returns more than the three
  visible baseline cards. Role action sets with fewer than four entries keep
  the same four-column sizing without inventing a fake business action,
  including on real-device viewports at or below `360px`, where only gaps and
  horizontal padding tighten. The todo surface displays the first two of the
  API's current maximum of three records with the existing all-todos entry. At
  the `390x844` baseline, Mine
  primary labels/actions use at least `24rpx`, and secondary metadata/helper
  text uses at least `20rpx`.
- Account surfaces (2026-08-10): the three formerly shared account entry points
  now have separate real routes. Profile editing stores a normalized `512x512`
  WebP through the configured local/Qiniu media provider and keeps a versioned
  managed reference in `users.avatar`; signed reads hide storage details while
  historical external avatar URLs remain readable. Staff display-name edits
  update both `admin_users.displayName` and the linked user profile. Settings
  exposes only real WeChat subscription/permission actions. Before requesting
  a subscription, the client reads the ordered four-template V2 list through
  authenticated `GET /api/miniprogram/notification-template` and requests all
  four in one call. It caches only a complete V2 response, uses the last good
  cache offline, and has no bundled template-ID fallback. The approved single
  Settings row reports full, partial (`N/4`), rejected, disabled, unset, and
  unavailable states without changing its visual hierarchy. Password changes
  require the current password, update only the authenticated staff record,
  and clear the local Mini Program session for re-login.
- Account visual restoration (2026-08-10): `profile-edit`, `settings`, and
  `account-security` follow the iPhone 13 Pro `390x844` references in
  `design-references/account/`. Each route has a green diagonal service-scene
  header and native white content cards; the local, text-free Xiao K scene
  derivatives in `packages/business/assets/account-v1/` provide only decoration. Profile,
  permission status, account facts, validation, loading/error/retry states,
  password mutation, logout, routes, APIs, and role boundaries remain driven by
  their existing live contracts.
- Data and failure states: ordinary-user floor-plan counts are derived from
  closed spaces across the formal version-4 survey graph floors. Mine and
  floor-plan requests have separate loading/error/retry states, so network
  failure is not rendered as an ordinary-user dashboard or an empty floor-plan
  list.
- PostgreSQL boundary: profile, live lead/formal-plan/measurement summaries,
  floor-plan lists, promotion records, and workbench todos use typed RLS
  repositories. Home still reports `aiGeneratedCases: 0` until AI generation
  moves; orders and commissions remain MongoDB-backed and are not queried with
  PostgreSQL bigint identities.
- Limited: workbench cards and task actions vary by professional role. Phone
  changes are intentionally unavailable because phone identity also affects
  staff matching and ordinary-user floor-plan ownership; ordinary WeChat users
  do not have a password-change action.

### Recommendations Share Page

- Page: `packages/business/recommendations/index`.
- Limited: the registered page displays local styles/progress, lets the user
  select one style, reveals the native WeChat share control, and defines its
  `onShareAppMessage` payload.
- Placeholder: recommendations are hard-coded mock data. The page deliberately
  exposes no PDF download, poster-save ActionSheet, local interaction-log
  placeholder, or other operation without a real backend path.

## Formal Surveying

- Isolated APK reconstruction research (2026-08-10):
  `research/legacy-zhouse-2d/` now exists outside the Mini Program package with
  a method-RVA/evidence ledger, independent millimetre geometry primitives,
  platform-neutral render commands, and isolation tests. The initial methods
  remain `located` and are not claimed as restored APK algorithms. Production
  `miniprogram/` and `admin/` code must not import the module. It registers no
  second surveying page, connects to no BLE/API/database, and cannot write
  `FloorPlan.layoutData`; the formal page, routes, roles, version-4 graph, and
  measurement audits are unchanged.
- BLE connection UX: each live BLE ranging entry in the editor offers to search
  for an authorized distance meter in the current editor when no device is
  connected. This changes no API, role boundary, wall-graph contract, or audit
  queue behavior.
- Page: `packages/surveying/editor/surveying-editor`; all entries use
  `utils/surveyNavigation.js` with `leadId` and/or `floorPlanId`. The entry
  context carries the lead community when available; `GET /api/floorplans/[id]`
  also returns its linked lead summary for direct plan entry.
- HTML-first exception (approved 2026-08-12): this formal surveying route may
  implement Canvas-native geometry, measurement, snapping, annotation, and
  state-rendering changes directly after explicit development authorization,
  without an HTML comparison prototype or similarity score. Design-source
  mapping, focused tests, this bilingual module inventory, the restoration
  ledger, and existing-window WeChat DevTools/real-device Canvas verification
  remain mandatory. Other Mini Program routes are unchanged.
- Cursor-lens rendering resilience (2026-08-12): while the bottom cursor is
  being dragged, its approved upper-left lens is drawn as one Canvas panel,
  including the centred green target and metadata footer. It has no overlapping
  native `cover-view` container. The first drag frame keeps refreshing until
  the lens state is applied, preventing rapid movement or delayed `setData`
  from suppressing the lens. Its Canvas scene, geometry, snap labels, route,
  APIs, roles, v4 graph, and measurement audit are unchanged.
- Canvas cursor-drag lens coverage (2026-08-12): the same upper-left lens is
  also active while an operator grabs the current cursor in the Canvas and
  drags out a wall preview. In this path the formal Canvas remains the only
  owner of the green cursor and guides; the lightweight layer draws the lens
  only, preventing a second bottom-dock drag cursor from appearing. The active
  lens is retained across formal-canvas redraws, and it temporarily owns the
  upper-left lane so the ordinary live-measurement bubble cannot overlap it.
  Its lens centre and displayed X/Y always use the final formal preview/display
  point after directional snapping, never the raw finger coordinate.
  Canvas panning, pinch zooming, and opening moves do not impersonate cursor
  drag and therefore do not show the lens. This changes no geometry, route,
  API, role, v4 graph, or measurement audit.
- Cursor release snap consistency (2026-08-12): the editor retains the last
  visible snapped cursor candidate through `touchend`. A visible outer-edge or
  outer-vertex snap therefore commits that same target instead of reclassifying
  the raw release coordinate as the nearby inner edge. Free placement still
  resolves from the release coordinate when no snap was visible. This changes
  no route, API, role boundary, version-4 wall graph, or measurement audit.
- Outer-snap cursor placement (2026-08-12): after an outer-edge or outer-vertex
  drop, the stationary cursor is rendered back on that visible outer target.
  The linked graph node remains on the source-wall centerline for topology,
  shared-wall closure, and persistence, while the cursor only uses the stored
  outer-wall projection until the new chain begins. This changes no route, API,
  role boundary, version-4 wall graph, or measurement audit.
- Explicit inner-vertex closure target (2026-08-12): when the editor supplies
  an explicit inner vertex target, `snapCursorToWall()` now preserves its
  `nodeId` and inner snap side instead of reclassifying the release coordinate
  against the nearby outer wall face. Closing or continuing from room 1
  therefore keeps the cursor on the selected inner vertex; routes, APIs, roles,
  the version-4 graph contract, and measurement audits are unchanged.
- Canvas inner-vertex snap parity (2026-08-12): the in-canvas reset-cursor tap
  now resolves and forwards the same vertex/wall placement candidate as the
  bottom cursor drag. A room-1 inner corner is therefore no longer passed as a
  raw coordinate and reclassified as an outer wall face before an adjacent
  room closes. Routes, APIs, roles, the version-4 graph contract, and
  measurement audits are unchanged.
- Inner/outer corner touch protection and delete stability (2026-08-12): when
  a closed-room inner corner and its mitered outer corner both fall inside the
  `350mm` touch tolerance, the inner corner keeps priority throughout the
  maximum thickness of its incident closed walls, and an outer-wall projection
  cannot steal the hit inside that protected radius. A deliberate touch in the
  visible outer corner's terminal band can still select the outer vertex. In
  the supplied `e5bd088fa67a37c4d843980ef5087141.jpg` case,
  `2092mm + 1862mm + 3 * 200mm = 4554mm` identifies the erroneous outer-corner
  path; the corrected inner-corner path produces a `4354mm` building outside
  width, a `2092 x 3331mm` clear room 2, and zero start/end insets on all three
  new walls. The regression also asserts that deleting room 2's upper wall does
  not change its lower wall's topology, measured endpoints, or outer geometry,
  covering the state difference exposed by
  `1036a5b23be2cb4ea7b1089c3278f5e1.jpg`. The earlier
  `2044/2444 x 3799/4199` and `1896mm` adjacent-room video flow remains covered.
  Markup, styles, routes, APIs, roles, the version-4 graph contract, and
  measurement audits are unchanged; focused tests pass `121/121`.
- Inner-face adjacent-room closure geometry (2026-08-12): when a straight
  adjacent room starts and closes on a closed room's inner vertices, the first
  and final measured walls now use those selected topology points directly;
  they no longer receive automatic wall-thickness start/end insets. The new
  closed space records `wallFaceOverrides` for the actual borrowed shared-wall
  segments so its fill, clear dimensions, area, and later wall splitting keep
  using the selected topology face instead of reselecting the outer face from
  the space centroid. Outer-face starts and true wall-thickness step closures
  retain their existing inset behavior. The supplied
  `f2c7c9823b1f8f532fb91a2dc7f68a20.mp4` flow now derives room 1 as
  `2044 x 3799mm`, room 2 as `1896 x 3799mm`, and the building outside width
  as `4340mm` rather than `4540mm`. The top-level version-4 layout, routes,
  APIs, roles, and measurement audits are unchanged.
- Visible inner-face closure endpoints (2026-08-12): the closed-wall boolean
  union still preserves the physical shared-wall thickness, but an adjacent
  space with `wallFaceOverrides` now redraws its selected clear boundary. This
  prevents the union from swallowing the final wall-thickness portion of the
  new upper and lower walls as an internal seam. The exact regression for
  `78f2af19ba0bf323d3a89489a1232408.jpg` and
  `ab939769e85d6758f3aaa485c2037aeb.jpg` uses room 1 at
  `2205 x 2901mm`, room 2 at `2834 x 2901mm`, and a `5439 x 3301mm`
  building outside. Both adjoining walls remain visibly connected to room 1's
  selected inner vertices after closure, and the lower visible endpoint is
  unchanged after deleting room 2's upper wall. This only completes the formal
  Canvas outline; walls, spaces, areas, dimensions, markup, styles, routes,
  APIs, roles, version-4 persistence, and measurement audits are unchanged.
- Cursor dock state clarity (2026-08-12): a cursor that is already placed on
  the Canvas, including after a closed space is restored, keeps the `重置光标`
  action. Selecting it enters `wallSnapPending`, where the same dock control
  becomes a crosshair drag origin and an independent helper line reads
  `光标拖动到墙体` until a new wall target is placed. While dragging, the origin
  becomes a subdued ghost and the existing Canvas crosshair follows the finger,
  making the handoff spatially explicit without clipping the instruction. This
  presentation state change affects no route, API, role boundary, version-4
  wall graph, or measurement audit.
- Data contract: `FloorPlan.layoutData` is only `{ version: 4,
  measurementMode: 'surveying', surveyGraph }`; graph units are millimetres.
- Canvas drawing refinement (2026-08-06; guide-state layering updated
  2026-08-12): formal wall outlines, active red measurement edges, cursor
  crosshairs, and closure/alignment guides use thinner drafting strokes. The
  blue `[8, 6]` crosshair represents only the last committed point: it is absent
  before the first wall is committed, stays at the previous point while the
  preview cursor moves, and advances only after commit. Free dragging no longer
  paints a following blue crosshair. Wall, vertex, and axis snaps use orange
  `[8, 6]` guides, while closure paths use orange `[12, 10]`; both cover only the
  constrained axis/path and are cleared on release, cancellation, reset,
  undo/redo, or state change. The Xiao K connector retains its independent green
  `[5, 4]` rhythm and 1.75px stroke. Live
  dimensions for the current unfinished wall chain use blue 14px values on
  neutral-grey backing plates and sit 32px beyond the active measured face.
  Closed-space `opening-segment`, `room-clear`, and `building-overall`
  dimensions are permanent drafting annotations: thin muted-grey lines with
  compact 12px dark labels on a quiet white backing, arranged outside the
  closed outline with a 60px base gap. Extension lines are fixed at 18px from
  the dimension-line side and retain a 12px break before the wall when space
  allows. Equal 4px, 60-degree endpoint slashes cross each dimension-line intersection
  at their centres; permanent annotations have no arrows. The active red
  measurement edge is redrawn after guides and the cursor, so it remains the
  topmost wall indication at an intersection. The latest state authority is
  `design-references/surveying/cursor-guide-state-reference-20260812.jpg`.
  This is presentation-only: the page route, APIs, roles, v4 wall-graph
  contract, BLE audit, and editor interactions are unchanged.
- Top measurement card contrast correction (2026-08-07): the compact white
  measurement card now explicitly renders live lengths in dark navy, uses a
  matching low-contrast divider, and uses a darker orange for actionable
  angles. Its existing visibility gate still requires a real length and the
  placed-cursor state, so the correction does not introduce an empty shell.
  This is presentation-only and does not change routes, APIs, permissions, or
  the version-4 surveying graph contract.
- CAD hinged-door geometry correction (2026-08-07): the open door leaf and the
  closed-position strip between the two short casing rectangles now each use a
  complete narrow outlined rectangle instead of a single construction line.
  The between-casing strip sits on the wall face opposite the swing area, so
  inside/outside doors retain the same CAD relationship after horizontal or
  vertical rotation. The 90-degree swing arc, opening cut, hit target,
  millimetre fields, persistence, routes, APIs, and roles are unchanged. The
  renderer regression test asserts both four-sided paths and both wall
  orientations. The existing WeChat DevTools project loaded the route at the
  `390x844` baseline, but its automation screenshot omitted the native Canvas
  layer; real-device visual QA therefore remains required.
- Opening state-control alignment correction (2026-08-07): the inside/outside
  door options now use equal-width tracks with an explicit centred label line;
  the window state omits the non-actionable position/fixed row entirely. The
  continue-surveying action is separated from the inspector by a 28rpx gap and
  uses a licensed local green continue-wall icon inside its full-width outlined
  secondary surface, following
  `design-references/surveying-editor-v5/surveying-window-inspector-continue-wall-v1.png`.
  Its final surface and icon/label geometry live on the simple native
  `opening-resume-*` classes rather than a late ancestor/child override, so the
  real-device `cover-view` cannot fall back to the former solid-green surface.
  This is presentation-only and does not change opening
  behavior, routes, APIs, roles, persistence, or the version-4 graph contract.
- Opening dimension editor V1 (2026-08-07): the approved
  `design-references/surveying-editor-v6/surveying-opening-editor-v1-dimensions-only.png`
  direction reduces the full-screen editor to real door/window dimensions,
  current values, the numeric keypad, and the measured preview. Doors expose
  width, height, wall depth, left offset, and right offset; windows additionally
  expose sill height. Wall-thickness synchronization appears only while wall
  depth is selected. The duplicate in-panel BLE action, entry-door auxiliary
  action, `翻转 / 模型` tabs, and model library are no longer rendered. The
  persistent bottom dock is the only ranging action and writes its reading to
  the selected opening parameter. Existing direction/model fields and the
  Three.js measured preview remain in the formal graph and internal
  implementation, but V1 exposes no flip or model-selection entry. While the
  editor is open, the parent surveying header, right rail, and opening inspector
  are suppressed so native overlays cannot compete with the dimension workflow. Routes,
  APIs, roles, millimetre fields, version-4 persistence, and measurement-audit
  boundaries are unchanged.
- Door/window unified inspector refinement (2026-08-06): when an opening is
  selected, the editor follows
  `design-references/surveying-editor-v4/surveying-opening-inspector-delete-only-v1.png`
  at the iPhone 13 Pro `390x844` baseline. Width, height, the explicit
  inside/outside door control when the selected opening is a door, the green
  edit action, and one subordinate red `删除门窗` action now share one opaque pale
  grey-green inspector, with a short hairline separating the destructive
  action. Split, add, and arrange are no longer rendered in the selected-opening
  inspector; opening creation remains available from the existing wall context,
  while planned tools keep their existing limitations elsewhere. An unfinished
  wall chain still exposes its existing continue-surveying action below the
  inspector. This is a presentation and selected-opening control-surface
  refinement only: the route, API, role boundary, v4 graph, measurement audit,
  opening fields, component editor, and persistence behavior are unchanged.
- Wall-selection rail simplification (2026-08-10): selecting a wall no longer
  replaces the ordinary right rail with the contextual `编辑 / 拆分 / 添加 /
  布置 / 删除` panel. The normal four-item rail remains visible; the existing
  on-canvas wall toolbar remains the available wall-specific control surface.
  This presentation-only removal does not change routes, APIs, roles, the v4
  wall graph, persistence, or measurement audits.
- Visual baseline: `design-references/all-pages-ip-v1/03-surveying-editor-idle.png`,
  `18-surveying-editor-active.png`, `19-surveying-state-board.png`,
  `design-references/all-pages-ip-v1/ChatGPT Image 2026年8月5日 15_44_17.png`, and
  `design-references/surveying-editor-v2/sub2api-20260804-095739-1.png` at the
  iPhone 13 Pro `390x844` baseline. The delivered editor uses the reference's
  full-width workspace, four-item right tool rail, and one bottom dock for
  undo/redo, cursor placement, and BLE ranging. Its custom header reserves the
  native WeChat top-right capsule: the linked community name and truthful save
  state occupy the left information block, while save/complete actions sit on a
  separate row beneath the capsule. `未填写小区` remains the missing-data fallback.
  A state-following guide is enabled by default per local client. The persistent
  `引导` header action uses a green local assistant icon when enabled and toggles the
  local preference; enabling it again resolves the current real survey state
  rather than replaying a paged tour. Every actionable guide state uses the
  Xiao K measuring-companion presentation: a compact white `Xiao K hint`
  speech bubble with one action sentence, a local left/right/down transparent
  pointing pose (`packages/surveying/assets/surveying-guide-k-left-v3.png`,
  `-right-v3.png`, `-down-v3.png`) cut from the single generated artboard at
  `design-references/surveying-editor-v3/sub2api-20260805-075309-1.png`,
  and a complete title row: the green `小K提示` chip, the local green sparkle
  mark (`images/mine-icons/tab-ai-active.png`), and a tappable close
  icon. The card wraps the action copy into readable lines, uses a small tail
  toward the target side, and keeps the character beside the card rather than
  over the target.
  The character also connects with a green dashed path and pulse halo that end
  at the real canvas or control
  target. A compound layout solver places the card and the complete Xiao K pose
  together, rejects card/character overlap, and scores all current wall bodies,
  openings, dimension labels and lines, room labels, the top measurement card,
  object toolbar, target controls, header safe area, right rail, and dock. The
  connector first selects a collision-free dashed Bezier candidate; when every
  curve crosses a protected label, a rounded grid route detours around it; if no
  collision-free route exists, the connector is omitted for that frame. The
  previous valid layout receives a stability preference so small viewport changes
  do not make the guide jump. Bottom-dock guide targets use the dock's actual
  `575rpx × 108rpx` geometry and `64rpx` bottom offset; because the dock is a native
  `cover-view` above Canvas, the card is raised, Xiao K is preferred below the card,
  and a dedicated straight dashed connector ends immediately above the real button
  instead of taking the general obstacle-routing detour. The connector hands off
  at the real button while that
  existing interactive control contains a bordered native marker above its
  background. The marker remains inside the button's event tree, so no independent
  overlay intercepts cursor dragging or ranging taps. The card close action disables only the persistent local
  guide preference. The guide condition is rendered as a non-native `block`; only the visible
  speech bubble and its close control participate in touch hit testing, so the
  canvas and other editor controls remain interactive while guidance is shown.
  The states cover first-wall direction, pending length, a
  free-standing chain's measurement side, the next wall, closure, post-closure
  continuation, cursor snap placement, selected-object editing, and completion.
  Walls, measurement edges, close paths, directions, and snap feedback remain
  dynamic canvas or control rendering. Disabling the guide hides only its
  teaching presentation and highlight: close, measurement-side, snap, BLE,
  error, and completion feedback stay operational. It does not write to the wall
  graph, draft, or measurement audit. Guide card geometry now scales all
  pixel-based placement from the `390px` reference width, reserves the Xiao K
  pose and connector between the card and its real spatial target, without
  inventing numbered phases or a paged tutorial. The card has a visible
  pale-green outlined speech tail aimed at the target; Xiao K faces the target,
  and a green dashed curved arrow runs from that facing hand to the target. The workspace grid uses a low-contrast 250mm minor step with a
  restrained 1250mm guide line, preserving the wall graph's millimetre units
  without making the empty canvas visually heavier than the reference. The title,
  truthful saved/draft notice, and its green status dot are separate header
  elements so they remain centred and never overlap; `guide`, `save`, and
  `finish` use an explicit 20rpx sibling gap that does not depend on native
  `cover-view` flex-gap support. The rail uses local green active PNG variants because native
  `cover-image` filtering is not consistent across devices. When a wall
  body is selected, the cursor is snapped to one, the current wall is committed,
  a closure candidate is present, or a wall preview is awaiting a length, the
  dock's ranging action directly requests a live device reading and applies it to
  the relevant wall as a BLE measurement; without a wall target it retains the
  existing length-input flow. Its connected treatment
  reflects the actual BLE callback. This change
  adds only the linked lead summary to the existing plan-detail read response;
  it does not change role boundaries, graph contract, audit queue, or export scope.
- Implemented editor behavior: startup restore, local draft and cloud draft
  persistence, straight and diagonal wall preview/commit, live BLE/manual length,
  repeated forward drags on the same collinear unfinished chain extend the last
  compatible wall instead of persisting artificial wall segments, while a real
  direction, drawing-mode, thickness, measurement-side, chain, or closure boundary still
  creates a separate wall,
  deleting the sole wall shared by exactly two valid closed spaces rebuilds
  their remaining perimeter as one directed closed space, so the Canvas derives
  one merged fill, room label, permanent dimension plan, and net area; deleting
  an exterior or single-space boundary still invalidates the affected room. If
  an adjacent room started from the shared wall's outer face, a perimeter wall
  can retain a wall-thickness start/end measurement inset at that junction;
  successful merging clears only those obsolete insets at the deleted wall's
  two endpoint nodes and refreshes the affected lengths, restoring one
  continuous wall solid without deleting or combining unselected perimeter
  walls or wall IDs; openings compensate for any removed start inset so their
  absolute position along the wall does not move,
  remeasure, shared-wall closure including reset-cursor connections to existing
  boundaries and their inferred missing closing edge, advisory close candidate
  with the compact green circular `合` action and geometry-anchored Xiao K guide, and direct closure.
  A free-standing stepped chain in straight-wall mode previews and persists a
  two-edge orthogonal route back to its start, preferring continuation of the
  last wall direction; both inferred edges must pass the existing intersection
  and overlap checks, so closure never inserts a diagonal shortcut across the room.
  Shared-boundary splits apply only to nodes that lie on that boundary, preserving
  every existing edge needed for the merged room shell. When a shared wall is
  split for a new adjacent room, each existing closed space receives the split
  pieces in the direction required by its own directed `wallIds` chain; a
  reverse-oriented room boundary therefore remains closed instead of losing its
  fill, label, dimensions, or area after the neighbouring room closes.
  from a pending diagonal preview (the close action commits its current preview
  length before closing), openings, opening
  dimensions and side, cursor placement for new wall chains on existing
  vertices, inner edges, outer edges, or free canvas positions, and an inner/outer
  wall-tracking, boundary-constrained measurement-edge prompt on the first
  committed wall of a free-standing chain. A chain snapped to an open wall or
  vertex inherits that connected boundary and does not show the prompt. When a
  chain starts from an inner or outer corner of a closed room, its first
  outgoing wall instead infers the measurement side from the collinear closed
  boundary's physical wall-body normal: the lower-left inner-corner/downward and
  corresponding outer-corner/downward cases both resolve to `right`, while the
  inner/outer snap still controls the physical measurement origin. The compact current-
  measurement-position control remains available during that first preview and
  after its first commit, and switching it updates the red edge, preview shell,
  committed wall, and following chain consistently. An outer-edge hit retains
  its measurement-side intent while its persisted
  shared-boundary node is projected to the source wall centerline, so rectangle
  alignment, closure candidates, and closed-room wall chains use one coordinate;
  after resetting and snapping the cursor to an existing boundary, the first
  straight wall of the restarted chain regains rectangle-completion snapping
  when its inferred closing edge is near a right angle;
  closed room wall shells and outer joins are
  derived from the closed boundary rather than the selected measurement edge.
  undo/reset, completed submission, and measurement audit queue/flush.
- Two-wall rectangular closure cue (2026-08-07): in an independent straight-wall
  chain, once two perpendicular walls are confirmed the editor immediately
  derives and renders the two orthogonal missing edges and exposes the compact
  close action. The inferred edges remain advisory and are persisted only
  after explicit confirmation; diagonal chains and shared-boundary rules keep
  their existing thresholds. Routes, APIs, permissions, the version-4 graph
  contract, and measurement-audit behavior are unchanged.
- Direct closure-target snap (2026-08-11): in straight mode, releasing a wall
  whose final preview endpoint exactly matches the current valid closure target
  commits the preview and closes the space immediately. This visible snapped
  state takes precedence over an on-device touch coordinate that may lag by one
  move; a raw pointer within target tolerance remains a fallback. This covers
  both an independent chain returning to its start vertex and an adjacent room's
  third or later new wall reaching a shared-wall closure point. A candidate
  created only by orthogonal projection, without the final preview actually
  landing on the target, remains advisory and still requires the `合` action;
  diagonal walls retain their angle/length confirmation flow. The user-supplied
  `a91d3f532111f4270a1ba1a13469f806.jpg` records the adjacent-room defect state
  where the preview is visibly coincident but the room remains open. Routes,
  APIs, roles, version-4 persistence, and BLE/manual measurement audits are
  unchanged. Focused graph/editor interaction tests pass `48/48`.
- Corner restart alignment and closure correction (2026-08-07): when a new
  straight-wall chain starts from a vertex of an already closed room, the
  adjacent room may use the existing boundary path between the two corner
  nodes even though both nodes have two boundary connections. The first or
  second measured wall now keeps the rectangle-completion reference, and
  manual/BLE length confirmation reapplies that orthogonal snap before
  rebuilding the endpoint. The editor therefore exposes the real `merge`
  closure candidate instead of leaving a near-axis endpoint unaligned. This
  changes no route, API, role boundary, millimetre/v4 graph contract, or
  measurement-audit behavior.
- Closed-corner measurement-side correction (2026-08-08): a restart from a
  closed-room vertex selects the incident boundary wall aligned with the first
  outgoing segment before resolving measurement side. Inner and outer corners
  retain their distinct measurement origins but select the side whose wall body
  follows that incident boundary's outward normal instead of falling back to an
  axis default. The existing Canvas measurement-
  position action is now available for this first shared-boundary segment and
  changes preview and persisted geometry together. Open-wall snaps remain
  locked. Routes, APIs, roles, v4 persistence, and audit behavior are unchanged.
- Closed-room continuation measurement origin and closure correction (2026-08-08):
  the first wall restarted from a closed-room corner now measures from the
  incident closed wall's real outside face, using its `thicknessMm`; topology
  nodes remain on the shared boundary while manual/BLE readings, `lengthMm`,
  red measurement line, preview endpoint, and committed wall all use that
  outside-face origin. Walls may persist optional
  `measurementStartInsetMm`/`measurementEndInsetMm` fields (legacy walls default
  them to zero), and wall splitting, remeasure, extension/shortening, and
  opening offsets preserve the same measured-length semantics. The first new
  wall never creates a `merge` candidate or closure guide. The
  current-measurement-position control uses a canvas vector arrow rotated to the
  wall normal (vertical left/right, horizontal up/down, diagonal by normal) and
  switching sides does not alter the measurement origin or reading.
- Closed-room second-wall snap correction (2026-08-10): the second orthogonal
  wall restarted from a closed-room corner is alignment-only and never creates
  a `merge` candidate, closure guide, or close action. Its cursor independently
  snaps to either the opposite inner topology corner or the mitered outside-wall
  corner according to pointer proximity. Closure becomes eligible only from the
  third new wall onward. Persisted nodes, wall lengths, APIs,
  roles, version-4 data, and BLE audit payloads are unchanged.
- Outer-edge zoom alignment correction (2026-08-10): formal Canvas wall
  thickness now stays proportional to `thicknessMm` at every supported viewport
  scale. The visible outside wall face, orange outer-snap state guide, alignment guide,
  and preview endpoint therefore keep the same Canvas coordinate before and
  after pinch zoom instead of separating when the wall shell reaches a fixed
  pixel-width clamp. Snap-state guides are orange while the committed cursor
  crosshair remains blue. This changes rendering and editor hit/overlay geometry
  only; wall-graph coordinates, persisted thickness, routes, APIs, roles, and
  measurement audits are unchanged.
- Outer-vertex drop stability correction (2026-08-11): when the drag lens has
  selected a mitered outside-wall vertex, releasing the bottom cursor keeps the
  stationary green cursor and blue full-canvas axes on that exact visible outer
  vertex instead of redrawing them at the inner topology corner. The graph anchor
  still uses the source wall's centerline node, and the recorded outer snap side,
  wall geometry, routes, APIs, roles, version-4 persistence, and measurement
  audits are unchanged. The user-supplied before/after device captures
  `cc5e4de4589b3280c15d230fa3367692.jpg` and
  `d955597eeb981aea1c1fac6ea8fc4353.jpg` are the defect/design-state authority;
  focused graph/editor rendering tests pass `89/89`. A fresh `390x844` device
  capture remains pending because the existing WeChat DevTools window does not
  expose a compatible Mini Program Automator endpoint.
- Explicit outer-corner candidate correction (2026-08-11, updated 2026-08-12):
  when inner and outer candidates coexist at one closed-room corner, a drop
  inside one wall thickness of the topology corner remains on the inner vertex.
  The outer vertex wins only when the drop deliberately enters the visible
  mitered corner's terminal band, or leaves the inner protection radius and is
  nearer the outer corner. This prevents slight finger or lens-marker drift
  into the wall body from changing an adjacent-room start to outer-face
  semantics while retaining an explicitly selectable outside corner.
  The user-provided device captures
  `codex-clipboard-3c0e6474-c194-48f3-b8cb-65ab5e43b2db.jpg` and
  `d2a3272efb1adc354dd7ee9479850896.jpg` are the defect/state authority. Markup,
  styles, routes, APIs, roles, version-4 persistence, and measurement audits are
  unchanged. The existing WeChat DevTools window exposes no compatible Mini
  Program Automator endpoint, so a fresh `390x844` route-confirmed interaction
  capture remains pending; no duplicate DevTools window was opened.
- Distant vertex-axis snapping (2026-08-12): bottom-cursor placement and
  straight-wall previews now treat the horizontal or vertical extension of a
  valid closed-room inner or visible outer vertex as an alignment candidate
  when the corresponding axis is within `350mm`, even when the pointer is many
  metres away on the other axis. Exact two-dimensional vertex and wall hits,
  rectangle completion, shared-boundary closure, and direct closure retain
  higher priority. An axis-aligned free start creates its own topology node
  rather than incorrectly joining the distant source corner; manual and BLE
  confirmation reapply the same alignment so the persisted endpoint cannot
  jump off the preview guide. The user-supplied device capture
  `b3868f487984b1db1c1875b8934e3cc1.jpg` is the interaction-state authority.
  Markup, styles, routes, APIs, roles, version-4 persistence, and measurement
  audit payloads are unchanged. Focused cursor, Canvas, and closure tests pass
  `91/91`. The existing WeChat DevTools window has no compatible Mini Program
  Automator listening port, so no duplicate window was opened and a fresh
  route-confirmed `390x844` interaction capture remains pending.
- Closed-corner wall-face alignment correction (2026-08-11): the first wall
  pulled from a closed-room outer vertex now inherits the incident boundary's
  physical wall-body normal. In the user-supplied
  `fb00dd97d15453c27336410cb7313410.jpg` state, a wall pulled left from the
  upper-left outside vertex therefore selects `right` automatically and keeps
  its outer face collinear with the existing top wall; the operator no longer
  needs to press the current-measurement-position switch. The switch remains
  available as an explicit override. Focused graph/render tests pass `77/77`;
  routes, APIs, roles, version-4 persistence, millimetre geometry, and
  measurement audits are unchanged. A fresh `390x844` capture is pending until
  the existing WeChat DevTools window exposes a compatible automation endpoint.
- Shared-wall inset cursor correction (2026-08-10; guide ownership updated
  2026-08-12): the blue full-canvas crosshair is owned only by the last committed
  display point. A preview whose effective measured endpoint is inset from a
  shared wall no longer draws a second crosshair at the red measurement endpoint,
  so the two indicators cannot separate as zoom increases. The
  effective length, red measurement edge, closure topology, routes, APIs,
  roles, version-4 data, and measurement audits are unchanged.
- Collinear closure preview and wall normalization (2026-08-10): a closure
  guide returning to a closed-room boundary now starts on the current measured
  wall axis and ends at the same outside-face position used by confirmation;
  it is no longer translated sideways to the shared wall's outer miter. When
  the first inferred closing leg continues the current terminal wall forward
  with compatible mode, thickness, and measurement side, confirmation extends
  that wall to the topology target, preserves its wall ID, and applies the
  outside-face end inset instead of persisting another collinear wall. A real
  turn still creates its own wall. Routes, APIs, roles, version-4 data, and BLE
  audit payloads are unchanged.
- Offset adjacent-room closure correction (2026-08-10): when a wall chain
  starts from a closed room and its new room is wider or narrower by one wall
  thickness, merge closure now prefers the opposite endpoint of the source
  shared wall instead of whichever old-room node was inserted first. The
  inferred orthogonal route follows the actual incoming terminal-wall
  direction, permits the terminal wall-thickness bridge, and applies the
  shared-wall end inset to the exterior boundary wall. The new space therefore
  contains only its measured chain plus the direct shared edge, preserving the
  intended step without swallowing the first room or inflating its dimensions
  and area. Routes, APIs, roles, version-4 data, and BLE audits are unchanged.
- ALG-001 shared-wall face and net-area correction (2026-08-10): closed-space
  fills, clear dimensions, and areas now derive the physical inner faces from
  each space's oriented `wallIds` chain. A shared wall still emits one physical
  solid while adjacent spaces select their respective faces, and a
  wall-thickness topology bridge is excluded from the clear boundary. The
  read-only space plan distinguishes inner/outer boundaries and per-wall
  thickness segments; room labels no longer replace irregular net area with
  the longest horizontal wall multiplied by the longest vertical wall. The
  aligned `2230 × 3182 mm` adjacent-room regression confirms one shared solid,
  collinear exterior side faces, and independent net areas rather than the
  second room's raw topology-envelope area. Routes, APIs, roles, BLE audits,
  and version-4 persistence are unchanged; focused geometry/render tests pass
  `79/79`, with device visual QA still pending.
- ALG-002 closed-room dimension-chain correction (2026-08-11): the Mini
  Program Canvas and the read-only Admin `FloorPlanViewer` now consume the same
  `createClosedDimensionPlan()`. Orthogonal plans place door positioning
  (`opening-segment`), exterior-facing room-clear spans (`room-clear`), and the
  physical building total (`building-overall`) in fixed near-to-far lanes; the
  clear span occupies the first lane when that side has no door. Clear spans
  derive from each space's directed inner-face chain and only survive when they
  map to the building outline, so shared and wholly internal walls do not emit
  exterior annotations. Building totals come directly from the outermost
  positive wall-solid ring, and extension origins are real corners belonging to
  the corresponding exterior direction; dimension lines may not cross a room
  or wall. Single rectangles, adjacent and offset rooms, and orthogonal L/U/step
  outlines use the new semantics. Any diagonal exterior boundary falls back to
  the existing diagonal planner for the entire dimension set. The canonical
  algorithms live under `miniprogram/packages/surveying/utils/`, and Admin
  `predev`/`prebuild` now synchronizes from that actual source directory. The
  focused dimension/Canvas suite passes `48/48`, and the Admin production build
  passes. The current WeChat DevTools window exposes internal debugging sockets
  but no compatible Mini Program Automator control endpoint, so a safe fresh
  compile, route-stack assertion, and native `390x844` single/adjacent-room
  capture could not be completed; no duplicate window was opened. WXML, WXSS,
  routes, APIs, roles, areas, BLE/manual audits, and version-4 persistence are
  unchanged.
- Live/permanent dimension and outer-face continuation correction (2026-08-12):
  live dimensions and closed-space dimensions now carry independent visual
  roles instead of sharing the blue live label treatment. When a new adjacent
  wall chain starts from a closed room's visible outer vertex, the snap retains
  the neighbouring wall-body alignment but the cursor, live measurement path,
  and dimensions use the operator's centreline working anchor. This prevents
  an outer-face visual duplicate beside the actual black wall line while the
  graph anchor remains on the source topology node.
  Manual/BLE millimetre values, measurement insets, route, roles, APIs,
  version-4 persistence, and measurement audits are unchanged. The approved
  interaction reference is
  `design-references/surveying/runtime-live-dimension-reference-20260812.jpg`;
  targeted surveying renderer, cursor, closure, dimension-planning, and editor
  source-contract tests pass `113/113`, including the two-edge L chain and the
  permanent/live style split. The already-open WeChat DevTools window is the
  current project, but it was not started with `autoPort`; its listening ports
  expose internal debugging protocols rather than a compatible Mini Program
  Automator endpoint. This run did not open a duplicate window, so recompilation,
  route-stack confirmation, and native-Canvas screenshots remain pending until
  automation is enabled in that window or the behavior is checked on a real device.
- Closed-room dimension endpoint and continuation clearance correction (2026-08-12):
  permanent closed-space dimension lines keep a 60px clearance from each wall face;
  their extension lines run a fixed 18px from the dimension-line side, retain a
  12px wall-side break when space allows, and meet the centre of equal 4px
  parallel 60-degree end slashes at the same
  dimension-line crossings instead of using arrowheads. Live dimensions
  retain their blue arrow treatment.
  Active and preview wall bodies are included in the matching directional support
  so permanent dimensions move beyond a wall pulled out from a closed room. The
  v4 graph, values, route, shell, APIs, roles, persistence, and audits are
  unchanged. Unit and Canvas regression coverage is added; native 390x844 QA
  remains pending because the current DevTools window has no automation endpoint.
- Closed-room continuation working-line correction (2026-08-12): an outer-edge
  hit remains valid snap metadata and still controls the neighbouring wall-body
  alignment, but the Canvas cursor, preview/red measurement path, and live
  dimensions now use the same centreline working anchor that the operator
  dragged. This removes the parallel outer-face cursor/line beside the black
  wall line seen during closed-room continuations. Version-4 graph coordinates,
  manual/BLE millimetre values, APIs, roles, persistence, and measurement
  audits are unchanged.
- Closed-wall deletion recovery (2026-08-07): deleting a wall from a closed
  adjacent room now clears stale cursor-snap metadata, so `resetCursor` cannot
  restore a node/wall that was deleted or belongs to the previous room. After
  snapping the cursor to the remaining endpoint, the missing wall again gets
  the orthogonal guide and a non-empty shared-boundary closure candidate.
- A reverse drag on that unfinished chain may shorten only its terminal wall,
  preserving the wall and endpoint IDs. This convenience edit is unavailable
  for closed-space, shared-endpoint, branching, or door/window walls; it does
  not change routes, APIs, roles, the v4 wall-graph contract, or audit behavior.
- Rectangle-completion alignment remains active while that third terminal wall
  is extended or shortened, so its endpoint continues to snap to the first
  wall's orthogonal axis after an intermediate partial drag.
- Deleting that unfinished terminal third wall preserves the remaining chain's
  start and its rectangle-alignment reference; deleting closed-space or other
  non-terminal walls keeps the existing reset behavior.
- Visual interaction treatment: at the `390x844` baseline the custom header
  preserves the native WeChat capsule safe area. The white Xiao K speech bubble
  is the only explanatory callout for first-wall, measurement-side, and closure
  states; the old solid-green text callouts are removed while their measurement-side
  and `合` actions remain operational. These presentation changes
  do not alter entry context, role boundary, wall-graph contract, or audit flow.
- Implemented angle behavior: diagonal direction snap within the documented
  threshold, number-pad angle entry, operator-confirmed phone motion angle, and
  three BLE triangle readings validated with the cosine rule. Closing the angle
  panel does not mutate wall geometry or leave motion listening active. Phone
  motion and Pythagorean measurement share one fixed-shell angle sheet: phone
  mode presents the level dial, one-decimal live value, baseline, and manual
  fallback, while Pythagorean mode presents numbered A/B/D millimetre readings, measuring and
  completed feedback, validation, retry, and a one-decimal calculated result.
  The angle sheet temporarily hides the native canvas undo/redraw, cursor-drop,
  and drag-lens controls, restoring them without changing their state on close.
- Implemented rendering/editor behavior: CAD-like full-width door/window symbols,
  inner-edge unfinished redline, room fills that accept only a fully connected
  closed wall chain in either first-wall direction, and a compound wall-solid
  union built from one-sided wall bodies plus connected-node fills. Filling and
  outlining the union once removes internal caps, diagonal seams, and boxed ends
  at connected nodes, L/T joins, and overlapping segments; opening cuts cover
  the complete wall thickness. The cursor-drag magnifier rebuilds its local view
  through the same formal Canvas scene renderer, so wall solids, joins, selected
  states, and door/window symbols match the main canvas instead of using a
  separate line approximation. Its conditional display uses a non-native `block`,
  leaving the bottom cursor control as the touch-move owner. Its status distinguishes vertex, inner-edge,
  outer-edge, and free placement; a closer outer edge is not overridden by the
  nearby inner vertex.
- Cursor drag input uses the live bounding rectangle of the bottom cursor
  control to convert native `cover-view` local touch coordinates when a device
  reports missing or zeroed `pageX`/`clientX`; a meaningful start-to-end movement also
  completes a drop when a device omits intermediate `touchmove` events.
  Closed plans use the ALG-002 dimension chain: orthogonal outlines show door
  positioning, exterior-facing room-clear spans, and the physical building
  total, while diagonal outlines retain the previous fallback. Existing CAD
  styling remains unchanged: thin extension lines, compact arrows, masked
  dimension text, and windows without a duplicate positioning chain. Thin,
  consistent crosshair/square cursor treatment remains in the canvas,
  drag layer, and bottom drop control. Closure, measurement-side, and other
  operation instructions use the single white Xiao K guide with compound
  obstacle-aware placement; their real native actions remain available without
  an additional solid-green explanatory callout. Opening component
  specifications, BLE parameter measurement through the single persistent
  bottom-dock action, and a Three.js measured preview remain available; flip
  and model selection are intentionally absent from the V1 editor UI.
  Canvas pan and pinch gestures use an animation-frame-coalesced transient
  render layer: walls, room fills, outlines, and openings remain visible while
  dimensions, room labels, guides, and callouts return after one final formal
  scene rebuild when the gesture ends. The transient layer projects the
  already-built structural paths directly into the target viewport so closed
  room fills and compound wall solids do not diverge on native Canvas. Gesture
  frames do not update page data
  or recompute wall solids and dimension plans.
- Infinite drafting viewport correction (2026-08-10): pan no longer constrains
  the structural shell to the visible workspace, so an operator can move a
  closed room fully aside and use the exposed blank canvas to start an adjacent
  room on any side. Pinch zoom uses a broad numeric safety range of
  `0.002–4 px/mm` instead of the former `0.05–0.36 px/mm` editing range; the
  gesture remains focal-point anchored and can be repeated continuously. This
  changes viewport interaction only; routes, APIs, roles, version-4 graph data,
  millimetre geometry, persistence, and BLE/manual measurement audits are
  unchanged.
  Gesture frames render directly on the primary canvas, rather than the cursor
  overlay, so native Canvas does not composite a shared-wall room with an older
  formal frame after wall snapping. A cursor-drop handoff also clears its
  transient frame again after the formal redraw.
- `miniprogram/packages/surveying/utils/surveyDimensionPlan.js` and
  `miniprogram/packages/surveying/utils/surveyWallSolidPlan.js` are the
  dependency-free sources for both editor renderers; admin development and
  production builds synchronize local mirrors instead of expanding the
  Turbopack watch root across the repository.
- Limited: BLE actions require a compatible connected device; some reserved
  bottom tools intentionally display a planned/unavailable message.
- Boundary: the Mini Program editor does not expose a current report exporter or
  full-plan CAD/3D export. Admin `FloorPlanViewer` owns full-plan 2D/3D viewing
  and DXF download through backend adapters. No legacy layout mirror may be saved.
- Operational details and cleanup procedure: `docs/surveying-module/README.md`
  and `formal-surveying.md`.

## Shared Components And Utilities

- BLE: `components/ble-connector`, `components/ble-gate`, and `utils/bluetooth.js`. While diagnosing device-asset identifiers, an already authorized connection logs the BLE advertisement payload and issues the vendor read-only `ATC001#` command once; the raw validated `ID` frame, 96-bit ID in hex, and printable ASCII rendering remain console-only evidence. This does not yet equate that machine ID with the physical-label SN or change authorization, APIs, persistence, or role boundaries.
- Navigation: `utils/surveyNavigation.js` owns formal editor entry and local
  resume-pointer cleanup.
- Graph/rendering: main-package `surveyWallGraph.js` and `surveyLayout.js`, plus
  the surveying-package `surveyCanvasRenderer.js`; AI design uses
  `aiDesignService.js` and `aiDesignValidation.js`.
- UI: nav bar, custom tab bar, lead list/modal, share poster, room library, and
  survey compass components.

## Survey-guide Canvas implementation note (2026-08-05)

The formal surveying guide is an `Implemented` local presentation only. Its
white speech bubble, pale-green tail, centred `小K提示` label, Xiao K image,
target halo, green dashed Bezier curve, and arrow are rendered by the main
`survey-canvas`, not by WXML `cover-view` nodes. This prevents the guide from
intercepting Canvas drag/pan/pinch gestures. The persistent header `引导` toggle
remains the guide's control; this visual layer does not change any API, role,
v4 wall-graph data, draft, or measurement-audit contract.
Guide body copy is wrapped using `CanvasRenderingContext2D.measureText()` and
the actual card inner width, so Chinese copy cannot be painted past the bubble
edge. The obsolete alternate WXML measurement bubble has no fallback branch;
an empty white card must never appear when no top metric is available. Cursor
placement states also clear and suppress that native measurement shell so closing
a room and dragging the cursor cannot leave an empty rectangle at the upper left.
After the next wall-chain cursor is placed, the active measurement segment is
resolved only from walls created at or after `activeSpaceStartWallIndex`; the
last wall of the closed room cannot emit a second blue crosshair or restore its
top measurement card before the next wall is drawn.
The bubble tail is a continuous Canvas outline (filled into the card edge and
stroked only on its two exposed sides), scaled with the card rather than a
stitched triangle. Xiao K left/right pose is resolved from the target's real
horizontal geometry for every guide state, including measurement-side states.
Card height reserves an explicit bottom padding after the final measured body
line.
The guide treats its card, Xiao K pose, and connector as one layout problem.
Dimension and room text plus fixed controls are protected obstacles; walls,
openings, measurement lines, and the active red edge are weighted obstacles.
Candidate card and character pairs must remain separated and inside the safe
workspace. Dashed Bezier candidates are sampled against those obstacles, with a
rounded A* grid route as the fallback when a protected annotation blocks every
curve; the connector is omitted if no safe route exists. The last valid layout is preferred to prevent jitter after small viewport
moves. Solid-green explanatory callouts are no longer painted; the white Xiao K
bubble is the single teaching voice, while measurement-side and closure actions
remain available.
For bottom-dock targets, the guide derives the exact button centre and size from
the current dock geometry, raises the card, prefers Xiao K below it, and uses a
dedicated straight connector that ends just above the highlighted button. The
Canvas connector remains below the native dock and the real `cover-view` button
contains the visible top-layer marker. Its events
bubble through the original button tree, preserving tap or drag ownership.

## Measurer–Designer Acquisition Flow (Implemented)

The focused business and data contract is [`docs/measurer-designer-acquisition.md`](measurer-designer-acquisition.md) and its Chinese mirror.

- `packages/business/acquisition-center/acquisition-center` is the sole designer confirmation entry. `/api/acquisition-tasks` supplies role-shaped pending/completed tasks, summaries, pagination, failure retry, idempotent confirmation, and exact notification `leadId` targeting. A measurer response returns the current binding once as page-level `designerProfile`; one `My Designer / View WeChat` utility follows the summary and task cards do not repeat designer contact data. Confirmation writes `acquiredAt/acquiredBy` and creates the acquisition commission without changing customer workflow status. The task list supports native `scroll-view` pull-to-refresh and refreshes the current status page every 30 seconds while visible; polling stops on hide/unload and never overlaps an active request.
- `pages/leads-management/leads-management` and `components/lead-list` use the four-stage customer workflow and no longer expose an Acquired filter. Measurers open the shared `designer-contact-sheet` from the capsule-safe `My Designer` entry instead of receiving repeated WeChat and QR blocks on every card.
- `packages/business/lead-detail/lead-detail` accepts `id` or notification `leadId`, renders the four-stage rail, next action, and an ordinary acquisition fact group, but no acquisition-confirmation hero action. Its formal-surveying card shows only real graph status, closed-space count, and update time, and the shared bottom sheet remains the designer-contact entry.
- `packages/business/commission-records/commission-records` consumes `/api/commission-records`; measurers receive the independent lead-acquisition records with pending/paid summaries while salesperson order commissions remain unchanged.
- The Mine page receives the role-shaped Acquisition Collaboration action and real pending badge from `/api/miniprogram/mine`. Selected in-app notifications are marked through `/api/miniprogram/notifications/read` and prefer `metadata.page` to deep-link the exact workbench record. Notification delivery failures remain visible through the in-app fallback.

### AI Design workbench fidelity correction (2026-08-11)

- The latest visual baseline remains the paired
  `design-references/ai-design/ai-design-customer-project-switcher-v3/ai-design-customer-workbench-home-v2.png`
  and `ai-design-customer-project-switcher-v3.png`; it supersedes the earlier
  first-viewport description of a raised project-state card and home room-chip
  scope rail. The emerald project hero now uses the recomposed artwork-only
  `/images/generated-hero-bleed-v2.png`; its floor-plan and interior subjects
  leave measured native-text lanes at the upper left and lower stage. The
  legacy carousel result title/helper caption and duplicate navigation-preview
  progress are removed, so live project progress, the brighter local selected-stage
  glow, the four-stage rail, and the one truthful next action remain the only
  lower-stage status layer. The points pill is lifted away from the project
  switch action, whose double-arrow mark now uses the approved local derivative.
  Native customer/community search,
  a horizontal `Space schemes` strip backed by the real role-scoped project
  index, and a truthful incomplete-survey preparation entry follow it. The four
  real design tasks remain below the first viewport. The design-preparation entry
  uses the approved drafting-scroll artwork. The project picker keeps the reference
  half-screen height, search, and three derived state groups; its wide thumbnail
  uses live formal navigator geometry on the left and the latest accessible result
  on the right, and the local plan mark appears only when formal geometry is absent.
  `qa-restored-ai-design-entry-v5.png` and `qa-restored-project-picker-v5.png` are
  retained as pre-correction evidence only. The earlier automation-endpoint
  limitation recorded for this pass has since been superseded by the verified
  existing-window workflow in the no-selected-project record below. Routes,
  APIs, permissions, credit charging, workflow selection, surveying navigation,
  and the version-4 graph contract are unchanged.
- The no-selected-project branch is restored from
  `design-references/ai-design/ai-design-customer-project-switcher-v3/ai-design-customer-workbench-empty-v2.png`.
  The production artwork `/images/ai-design-empty-v2/stage-art.jpg` and the
  `step-customer.png`, `step-survey.png`, and `step-ai.png` process marks are
  direct derivatives of that approved design source. Their editable source cuts
  remain beside the design reference; no approximate generated scene or unrelated
  icon is used. The title, guidance, three-step path, `Select customer survey`
  action, search/filter controls, `Ready to design` sources, and preparation
  summary remain native UI. Source cards are rendered only from the role-scoped
  source response; when no active formal survey exists, the page states that
  truth instead of showing the design comp's sample projects. Project-independent
  recent-result placeholders are hidden in this branch, so an archived deep link
  cannot resemble a failed workflow.

  Whole-page visual QA uses the approved `853x1844` source scaled to the iPhone
  12/13 Pro `390x844` baseline and records actual runtime bounds rather than a
  no-overlap-only check. The emerald stage is `left 8 / top 127 / width 374 /
  height 314`; its message starts at `left 22 / top 143`. The primary survey CTA
  is `left 22.5 / top 390 / width 345 / height 37`, matching the design-derived
  approximately `344x38px` target. The three source-cut process marks are each
  `28x28px`; the search control is `294x31px`, the filter is `60x31px`, the
  `Ready to design` heading starts at `left 12 / top 497`, and the truthful empty
  source and preparation rows are both `366px` wide. The native menu capsule is
  `left 296 / top 51 / right 383 / bottom 83`; the credit pill is `top 91..119`
  and the emerald stage starts at `top 127`, preserving both `8px` adjacent gaps.
  Evidence and the element ledger are retained as
  `visual-qa-empty-390x844-2026-08-11-final-v2.png`,
  `visual-qa-empty-390x844-2026-08-11-final-v2.metrics.json`, and
  `visual-qa-empty-native-capsule-2026-08-11-final-v2.png` beside the source.
  The existing WeChat DevTools window was reused; after automation attachment it
  was explicitly recompiled, switched to `pages/ai-design/ai-design`, and queried
  through the exposed automation endpoint. Targeted Mini Program tests cover the
  artwork budget, approved copy, and archived no-query flow. Routes, APIs,
  permissions, credit charging, project selection, and the version-4 graph
  contract are unchanged.
- A follow-up selected-project fidelity pass uses the user-provided narrow-device
  capture as evidence without copying its sample state or data. The header now
  reserves a native layout lane below the points pill, and the `<=360px` variant
  keeps the same inset `568rpx` emerald project card as the `390x844` baseline
  instead of expanding it edge to edge. The artwork-only fallback uses
  `aspectFill` without an additional scene shade and fills the full hero container, so the formal drawing, interior
  board, and Xiao K keep the authored reference brightness. The selected-project
  hero is governed jointly by the home composition reference and
  `ai-design-customer-project-switcher-v3.png`: it therefore preserves the
  `Current customer` eyebrow, real project title, and the live
  formal-survey/subtitle/closed-space metadata line shown by the switcher design.
  Runtime evidence from the `341x728` narrow-device capture showed that normal
  flow placed this identity block too low and let the drafting board enter its
  metadata lane. The identity block is therefore raised by `26rpx`. A follow-up
  compiled capture showed the status chip still touching the eyebrow and the
  arrow still entering the metadata baseline, so the chip now uses compact
  `4rpx` vertical padding. The default artwork now starts at the stage top and
  fills its parent at `width: 100%; height: 100%`. This preserves its authored
  brightness without changing the generated-result carousel.
  The selected journey station combines the approved local
  `96rpx` glow derivative with an explicit emerald fill, `3rpx` white ring,
  stronger outer highlight, and emphasized label instead of making the node body
  transparent.
  The progress row names the
  current four-stage journey station instead of repeating the server-derived
  project status. Home scheme cards use a real accessible result/navigation
  preview or the formal navigator geometry and no longer duplicate the generic
  hero for the selected project. The center surveying label inherits the shared
  inactive TabBar color whenever `Design` is selected, removing the former dual
  active-state signal. Targeted `ai-design-home` and `ai-design-tab` tests cover
  these contracts, including preservation of the switcher-owned hero identity
  copy and absence of the fallback shade.
  The existing DevTools window rendered the current no-project
  branch at its iPhone 12/13 baseline; the retained evidence is
  `design-references/ai-design/ai-design-customer-project-switcher-v3/qa-fidelity-pass-empty-state-390x844-devtools.png`.
  That live session supplied no selectable project and no compatible automation
  endpoint, so selected-project `390x844` and narrow `360x800` captures remain
  pending. This is a presentation-only correction: routes, APIs,
  role/tenant permissions, project/workflow selection, credits, surveying
  navigation, and the version-4 graph contract are unchanged.

#### HTML workbench layout alignment (2026-08-12)

- The selected-project branch now maps its first viewport directly to
  `design-references/html-prototypes/ai-design-customer-workbench/index.html`
  at `390x844`: the capsule-safe header and credit pill lead into the
  `left 9px / top 114px / right 381px / bottom 410px` Hero (`372px x 296px`);
  native state, customer identity,
  progress rail, and truthful next action retain that Hero's measured lanes.
  The live search row, `166px x 197px` scheme cards, and `58px`
  preparation entry follow the prototype rhythm. The Hero continues to use
  the packaged `/images/generated-hero-bleed-v2.png` with `aspectFill`; real
  sources, results, empty state, permissions, APIs, and all navigation remain
  unchanged. Static source/layout assertions pass; the existing WeChat DevTools
  window does not expose an automation endpoint for the required native-capsule
  screenshot, so that capture remains a release check.

#### Customer-project drawer alignment (2026-08-12)

- `pages/ai-design/ai-design` now restores its customer-project drawer directly
  from `design-references/ai-design/ai-design-customer-project-switcher-v3/ai-design-customer-project-switcher-v3.png`.
  The native half-screen sheet retains the live role-scoped project index, search,
  and derived `In progress` / `Ready` / `Needs survey` groups. Its card treatment
  now maps the approved composition to live data: an accessible result stays in
  the thumbnail when present; otherwise eligible projects use the generic
  project-folio guide, while only `needs_survey` retains simplified wall
  geometry. The selected project shows its real progress with a current-project
  chip and check, and other projects retain their truthful next action. Source cards use the reference's relaxed media-row
  density (`170rpx` card height, `270rpx × 150rpx` thumbnail and a separately
  spaced action column), rather than compacting project identity and actions into
  a settings-list row. The route, APIs, tenant/role boundary, credits,
  surveying entry, and version-4 wall-graph contract are unchanged. Static
  source/layout assertions pass; the native-capsule DevTools capture remains
  pending because the existing window exposes no automation endpoint.

#### Stage guides and project folios (2026-08-12)

- `pages/ai-design/ai-design` no longer presents raw formal-navigator geometry
  as a general-purpose project cover. In `Space schemes` and the customer-project
  drawer, a real accessible result remains first priority; otherwise eligible
  projects use the explicitly non-result project-folio guide
  `/images/ai-design-project-folio-cover-v1.png`. Only the
  `needs_survey` group retains the simplified live plan because its task is to
  identify incomplete measurement, not a design outcome. With no full-plan
  result, the Hero restores the approved
  `/images/generated-hero-bleed-v2.png` PNG at its authored composition;
  native project identity, status, stage, and progress remain the source of
  truth. Full-plan results still supersede the fallback in the carousel. The
  route, source APIs, tenant/role
  boundary, selection behavior, credits, and version-4 wall-graph contract are
  unchanged. The project-folio asset was generated through Sub2API `gpt-image-2`,
  packaged as PNG, and its editable source is retained in
  `design-references/ai-design/ai-design-stage-fallbacks-v1/`.

### Mini Program asset budget cleanup (2026-08-12)

- Source-package asset audit removed 33 files with no runtime references, including superseded non-`-v3` surveying guide artwork and unused historical page/toolbar artwork. Runtime paths and page contracts were not changed.
- Retained large artwork was recompressed in place where the encoded output was materially smaller: `images/generated-hero-bleed-v2.png` (1,605.3KB -> 1,503.8KB), `images/home-ip-v1/hero-scene-wechat-safe-overscan.png` (765.4KB -> 290.8KiB; 1,022x934 -> 900x823), `packages/business/assets/login-v1/hero-scene.jpg` (115.1KB -> 81.0KB), `packages/business/assets/promotion-create/hero-scene.jpg` (28.9KB -> 22.8KB), `packages/business/assets/commission-records/hero-scene.jpg` (19.3KB -> 14.2KB), and `images/ai-design-empty-v2/stage-art.jpg` (52.7KB -> 49.9KB). Formats, alpha channels, asset paths, and visual composition were preserved; the homepage Hero alone was downsampled to meet the 300KB asset cap.
- Transparent PNGs whose optimized output was not materially smaller were left byte-for-byte unchanged. `miniprogram/node_modules` remains development-only and is excluded by `nodeModules: false`; it is not part of the reported Mini Program package budget.

## Maintenance Rules

Before changing any Mini Program page, component, utility, API flow, or data
contract, read the root instructions, this inventory, and the applicable design
or formal-surveying document. In the same change, update this inventory and its
Chinese mirror with the real entry route, API, role/condition, data contract,
status, and limitations. Keep formal surveying rules aligned with the v4 graph
contract; do not document a mock or planned control as a live feature. If a change
has no functional documentation impact, state that explicitly in the handoff.
