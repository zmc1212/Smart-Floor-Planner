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
  shared runtime. `packages/surveying` owns the formal editor, its renderer,
  guide assets, and the 3D adapter; `packages/ai-workflow` owns AI create/result/
  history plus the legacy redirect; `packages/business` owns login and secondary
  business workflows. These are ordinary subpackages that may depend on the main
  package but never on one another. No subpackage is preloaded at startup.
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
  card present `customer · community` as the preferred project identity, fall back
  to the formal-plan name only when that identity is absent, and present timestamps
  only as update metadata.
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
  `pages/leads-management/leads-management`, and
  `packages/business/lead-detail/lead-detail`.
- APIs: `/api/leads`, `/api/leads/[id]`, `/api/floorplans/[id]` GET/DELETE.
- Implemented: customer name/phone/community/area/style capture, recent leads,
  list/detail views, formal-plan association, primary-plan name/status/closed
  space count in lead detail, continue measurement, start a new independent
  measurement, delete active formal plans with local pointer cleanup,
  client-side search across loaded records, and status filtering through both
  the stage strip and native action sheet.
- Persistence: lead and formal-plan list/detail/create/update/delete operations
  use PostgreSQL RLS transactions and decimal-string IDs; lead-plan linking and
  primary-plan cleanup are atomic.
- Visual baseline: `design-references/all-pages-ip-v1/02-leads-management.png`
  at `390x844`. The shipped page follows its Xiao K client-concierge scene,
  green dossier summary, search/filter/create action order, six dossier-index
  stage tabs, stacked customer-record cards, and right-aligned color-coded
  floor-plan thumbnails. Thumbnail geometry still renders from each lead's
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
- Target context: workflow reads for a selected plan require
  `floorPlanId + targetScope + roomId` (with `roomId` omitted only for
  `whole_floor_plan`) and return `targetContext` with `missing`, `processing`,
  `ready`, `stale`, or `admin_handoff` state. A single-room result matches only
  the same formal plan and room; whole-plan and legacy tasks with missing scope
  metadata never fill a room automatically. The exact globally adopted result
  wins when it belongs to the target, otherwise the newest exact successful
  result is used. Results older than `FloorPlan.updatedAt` remain in history but
  are not continued automatically.
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
  when its task predates the formal plan's latest update. Without a selected
  formal plan, the default entry remains an interior-scene tour. Its four
  non-ordinal waypoints use the existing AI icon family and are labeled
  `Reference recreation`, `Photo restyle`, `Floor-plan generation`, and `Soft
  furnishing`; they represent independently available capabilities rather than
  a mandatory 1-to-4 sequence. The waypoints maintain an active navigation
  state, smoothly pan/zoom the scene, and update the confirmed next action with
  an explicit input action before entering a task. The separate scheme rail is
  the only ordered progression, while server context still selects the
  recommended next action. Existing generation capabilities include dual-image
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
  page provides a two-step shared selector:
  first choose a customer formal plan, then choose the complete plan or one closed
  room. Its `leadId`, `floorPlanId`, `targetScope`, and optional `roomId` are
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
  map to `base_render`, `perspective_upgrade`, or `soft_furnishing`. Successful
  first base/soft-furnishing results become the workflow baseline; later results
  at that stage stay candidates. The Mini Program can continue style/soft-
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
  and the iPhone 13 Pro `390x844` baseline. The selected-plan home uses
  `design-references/all-pages-ip-v3/04-ai-design-home-v3.png` as its restoration
  target: the live 3D navigation cover or deterministic formal wall graph owns
  the first viewport, a horizontal whole-plan/room scope rail changes the real
  target without claiming unmeasured spatial coordinates, and the character-only
  Xiao K asset acts once as the spatial guide. A single raised white workbench
  joins the four-stage server-derived rail, the four implemented task entries,
  and one full-width green contextual next action that visibly discloses its live
  operation label and point cost. The customer/project subtitle still opens the source
  picker, source clearing remains available inside that picker, multiple active
  schemes still require explicit selection, and recent live results remain below
  the first-viewport workbench. The custom navigation reserves the measured WeChat
  capsule lane even where the supplied reference does not show that capsule. The
  no-plan spatial-tour state remains backed by
  `design-references/ai-design/ai-design-immersive-a-space-tour-v1.png` and
  `miniprogram/images/ai-design-hero-v3.png`; at widths up to `360px`, its
  recommendation stays compact and keeps safe spacing between the fourth waypoint
  and formal-plan selector. The selected-plan, real-wall-graph fixture was
  inspected in the user's existing WeChat DevTools at `390x844`; the retained QA
  capture is `output/ai-design-v3-qa-390x844.png`. The automation capture does not
  include the native WeChat capsule, so it verifies the page composition while
  the measured `navigationRight` clearance remains code/test evidence; a native-
  chrome or device capture is still outstanding. Intentional deviations from the
  comp are the truthful horizontal scope rail, visible cost metadata, the capsule
  safety lane, the shared custom TabBar, and existing coherent task iconography
  instead of static sample-plan imagery. The 2026-08-07 restoration changes visual
  composition only; routes, APIs, permissions, point charging, workflow selection,
  and formal wall-graph contracts are unchanged. The create page now follows
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

- Page: `pages/mine/mine`.
- APIs: `/api/miniprogram/mine`, `/api/floorplans`, and navigation to leads,
  promotion records, commissions, surveying, and the new AI design home.
- Implemented: profile/role display, workbench summary, todos, floor-plan list,
  notification/account actions, logout, new measurement, an enterprise-staff
  AI Design home entry, and contextual AI entry from a plan card.
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
- Limited: workbench cards and task actions vary by professional role; some
  account/notification cards are informational rather than configuration APIs.

### Recommendations Share Page

- Page: `packages/business/recommendations/index`.
- Limited: the registered page displays local styles/progress, lets the user
  select one style, reveals the native WeChat share control, and defines its
  `onShareAppMessage` payload.
- Placeholder: recommendations are hard-coded mock data. The page deliberately
  exposes no PDF download, poster-save ActionSheet, local interaction-log
  placeholder, or other operation without a real backend path.

## Formal Surveying

- BLE connection UX: each live BLE ranging entry in the editor offers to search
  for an authorized distance meter in the current editor when no device is
  connected. This changes no API, role boundary, wall-graph contract, or audit
  queue behavior.
- Page: `packages/surveying/editor/surveying-editor`; all entries use
  `utils/surveyNavigation.js` with `leadId` and/or `floorPlanId`. The entry
  context carries the lead community when available; `GET /api/floorplans/[id]`
  also returns its linked lead summary for direct plan entry.
- Data contract: `FloorPlan.layoutData` is only `{ version: 4,
  measurementMode: 'surveying', surveyGraph }`; graph units are millimetres.
- Canvas drawing refinement (2026-08-06): formal wall outlines, active red
  measurement edges, cursor crosshairs, and closure/alignment guides use thinner
  drafting strokes. Blue coordinate, cursor, and alignment guides use the denser
  `[8, 6]` dash rhythm; the green closure cue retains `[12, 10]`. The Xiao K
  connector retains its independent `[5, 4]` rhythm and 1.75px stroke. Wall dimensions use
  blue values on neutral-grey backing plates; their dimension lines sit 32px from
  an unfinished measured edge and at least 28px from a closed exterior wall.
  Short 8px endpoint ticks cross the floating dimension line but deliberately do
  not connect back to a wall; the endpoint arrows face outward, with their tips
  aligned to rather than beyond the dimension-line endpoints. The active red
  measurement edge is redrawn after guides and the cursor, so it remains the
  topmost wall indication at an intersection. This is presentation-only: the page
  route, APIs, roles, v4 wall-graph contract, BLE audit, and editor interactions
  are unchanged.
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
  remeasure, shared-wall closure including reset-cursor connections to existing
  boundaries and their inferred missing closing edge, advisory close candidate
  with a compact `可闭合` action and geometry-anchored Xiao K guide, and direct closure.
  A free-standing stepped chain in straight-wall mode previews and persists a
  two-edge orthogonal route back to its start, preferring continuation of the
  last wall direction; both inferred edges must pass the existing intersection
  and overlap checks, so closure never inserts a diagonal shortcut across the room.
  Shared-boundary splits apply only to nodes that lie on that boundary, preserving
  every existing edge needed for the merged room shell.
  from a pending diagonal preview (the close action commits its current preview
  length before closing), openings, opening
  dimensions and side, cursor placement for new wall chains on existing
  vertices, inner edges, outer edges, or free canvas positions, and an inner/outer
  wall-tracking, boundary-constrained measurement-edge prompt on the first
  committed wall of a free-standing chain only; a chain snapped to an existing
  wall or vertex inherits that connected boundary and does not show the prompt;
  an outer-edge hit retains its measurement-side intent while its persisted
  shared-boundary node is projected to the source wall centerline, so rectangle
  alignment, closure candidates, and closed-room wall chains use one coordinate;
  after resetting and snapping the cursor to an existing boundary, the first
  straight wall of the restarted chain regains rectangle-completion snapping
  when its inferred closing edge is near a right angle;
  closed room wall shells and outer joins are
  derived from the closed boundary rather than the selected measurement edge.
  undo/reset, completed submission, and measurement audit queue/flush.
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
  and `可闭合` actions remain operational. These presentation changes
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
  An engineering-style exterior DimensionPlan is used for
  closed plans: a single exterior wall has one total dimension, while a
  continuous multi-wall run or door wall has an inner positioning chain. Each
  exterior direction receives one outer global total across the complete plan
  bounds, rather than repeated local totals. Windows keep CAD symbols without
  a duplicate detail chain.
  Its extension origins and dimension-line
  endpoints follow the rendered exterior wall face, including mitered exterior
  corners, then route to global exterior dimension lanes beyond the whole
  closed-plan outline. Closed-space edges are geometrically
  split and merged before annotation, excluding differently identified/split
  shared walls and enclosed inner holes. CAD-style thin extension lines start at
  the exterior wall face; compact arrows and masked dimension text replace
  duplicate whole-wall pairs; thin,
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
  bottom/object tools intentionally display a planned/unavailable message.
- Boundary: the Mini Program editor does not expose a current report exporter or
  full-plan CAD/3D export. Admin `FloorPlanViewer` owns full-plan 2D/3D viewing
  and DXF download through backend adapters. No legacy layout mirror may be saved.
- Operational details and cleanup procedure: `docs/surveying-module/README.md`
  and `formal-surveying.md`.

## Shared Components And Utilities

- BLE: `components/ble-connector`, `components/ble-gate`, and `utils/bluetooth.js`.
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

## Maintenance Rules

Before changing any Mini Program page, component, utility, API flow, or data
contract, read the root instructions, this inventory, and the applicable design
or formal-surveying document. In the same change, update this inventory and its
Chinese mirror with the real entry route, API, role/condition, data contract,
status, and limitations. Keep formal surveying rules aligned with the v4 graph
contract; do not document a mock or planned control as a live feature. If a change
has no functional documentation impact, state that explicitly in the handoff.
