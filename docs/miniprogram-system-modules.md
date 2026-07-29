# Mini Program: Current Module Inventory

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
  `utils/api.js`, `threejs-miniprogram` for 3D previews, and optional BLE laser
  distance meter integration.
- Main tabs: Home (`index`), Leads (`leads-management`), AI Design
  (`ai-design`), and Mine (`mine`), plus the custom center measurement action.
  Login, detail, workflow, inspiration, recommendation, and formal surveying
  pages are secondary routes.

## Shared Identity And Context

- `/pages/login/login`: WeChat phone quick login and username/password login via
  `/api/auth/miniprogram`; restores a JWT/user session in app storage.
- Access is staff-only: password login requires an active backend `AdminUser`,
  while WeChat code/phone login must match an active `AdminUser` by bound OpenID
  or backend phone number. Unmatched external users receive `403` and cannot
  establish an authenticated Mini Program business session.
- `app.js`: restores sessions, reads QR/referral `enterpriseId`/`staffId`, syncs
  staff professional context, loads enterprise branding, and attempts silent BLE
  reconnection for a remembered device.
- `utils/api.js`: sends the bearer token through the explicitly selected
  `ACTIVE_API_ENVIRONMENT` (`local` or `production`), clears expired sessions,
  and redirects to login after a 401. Requests never fall back across
  environments, and persisted `apiBaseUrl` values are not consulted.
- Status: login and context restoration are `Implemented`; a valid WeChat
  authorization, account, API base, and enterprise/provider configuration are
  required for the corresponding path.

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
- Limited: the write/notify characteristic pairing is hardware-specific. BLE
  diagnostics log the discovered channel properties, each command write, and
  each raw notification with full service/characteristic UUIDs; receive buffers
  are isolated per notification channel. Private binary payloads remain raw
  diagnostics until their protocol mapping is confirmed.
- Visual baseline: `design-references/miniprogram-home-vibrant-green-v5.png`
  at iPhone 13 Pro `390x844`. The shipped composition uses project-local
  derived scene assets while city, counts, device state, enterprise branding,
  recent plans, empty state, and all navigation remain live and role-aware.
- Placeholder: the help center still shows an “upcoming” message.

### Leads And Customer Records

- Pages: `pages/lead-form/lead-form`, `pages/leads-management/leads-management`,
  `pages/lead-detail/lead-detail`.
- APIs: `/api/leads`, `/api/leads/[id]`, `/api/floorplans/[id]` DELETE.
- Implemented: customer name/phone/community/area/style capture, recent leads,
  list/detail views, formal-plan association, primary-plan name/status/closed
  space count in lead detail, continue measurement, start a new independent
  measurement, delete active formal plans with local pointer cleanup,
  client-side search across loaded records, and status filtering through both
  the stage strip and native action sheet.
- Visual baseline: `design-references/leads-management-v4.png` at `390x844`.
  The shipped page preserves the reference's scene-led header, three-stat summary,
  compact search/actions, six-stage strip, color-coded floor-plan thumbnails rendered
  from each lead's formal wall graph or real external preview URL, status-aligned
  top-left stacked accents, status rails,
  and shared five-item custom tab bar while rendering live customer data.
- Limited: lead creation and plan operations require a valid Mini Program session;
  phone and community validation are client-side plus server-side checks. Search
  covers the records currently loaded by pagination; choosing a status performs
  a server-filtered reload.

### Enterprise Promotion And Staff Tasks

- Pages: `pages/promotion-records/promotion-records` and
  `pages/promotion-record-detail/promotion-record-detail`.
- APIs: `/api/promotion-records`, `/promotion-records/[id]`, `/promotion-records/pool`,
  `/staff?roles=...`, workbench summary/todos, and related update endpoints.
- Implemented: create enterprise reports, list role-specific views (`my`,
  `measure`, `design`, `admin`, `overdue`, `pool`), search/filter, public-pool
  claim or approval request, conflict ownership resolution, follow-up notes and
  due dates, measurer/designer/promoter assignment, and business-stage actions.
- Limited: available actions and list views depend on the logged-in staff role
  and the server-side promotion workflow state.

### Commission Records

- Page: `pages/commission-records/commission-records`.
- API: `/api/commission-records`.
- Implemented: summary cards and lists for pending, paid, and voided commission
  records, with order/settlement explanation.
- Limited: records are generated and settled by the enterprise order workflow;
  the Mini Program is a read view, not the settlement authority.

### Inspiration Library

- Page: `pages/inspiration/inspiration`.
- API: `/api/inspirations?page=...&style=...&roomType=...`.
- Implemented: paginated loading, pull-to-refresh, style and room filters,
  image preview, share-poster shell, and free-design lead entry.
- Navigation: retained as a secondary route and no longer occupies a primary
  tab.
- Limited: result availability depends on published backend inspiration content.

### AI Design And Enterprise Credits

- Pages: `pages/ai-design/ai-design`, `pages/ai-design-create/ai-design-create`,
  `pages/ai-design-result/ai-design-result`, and
  `pages/ai-design-history/ai-design-history`; legacy `pages/ai-gen/ai-gen` is a
  compatibility redirect only.
- Navigation: `pages/ai-design/ai-design` is the primary `AI Design` tab; it
  uses the shared fixed custom-tab layout and scroll/refresher contract.
  Contextual entries transfer floor-plan, room, lead, scope, and workflow state
  through `utils/aiDesignNavigation.js` before calling `switchTab`, because
  WeChat tab pages cannot receive those entries through `navigateTo` queries.
- APIs: Mini Program AI capabilities, role-scoped formal-plan/room sources,
  context-visible active workflows, media upload/signed reads,
  task create/run/status/retry, and history
  list/delete endpoints through `utils/aiDesignService.js` with bearer JWT
  authentication.
- Implemented: enterprise-shared AI-credit and action-price display; a four-task
  home surface for reference recreation, whole-space style transformation,
  formal-floor-plan concept rendering, and soft-furnishing refinement; dual-image
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
  for processing jobs. The home page keeps processing jobs ahead of other recent
  results, shows their numeric stage progress in green, preserves recency within
  each group, and refreshes every five
  seconds until visible processing jobs reach a terminal state; history reads
  reconcile up to four visible processing jobs before serialization. The home
  page provides a two-step shared selector:
  first choose a customer formal plan, then choose the complete plan or one closed
  room. Its `leadId`, `floorPlanId`, `targetScope`, and optional `roomId` are
  inherited by all four tasks, while only formal-plan rendering makes that
  context mandatory. Complete-plan rendering produces one furnished top-down
  concept; single-room rendering produces one eye-level room concept. A compact current-scheme card auto-selects one active match,
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
  Ad-hoc tasks without customer context
  remain supported as quick standalone generations.
- Visuals: locally rendered Lucide icons, hairline separators, output-ratio-aware
  result/compare stages that use the reference image for recreation comparisons,
  and the iPhone 13 Pro `390x844` baseline. References are
  `design-references/ai-design-home-v2.png` and
  `design-references/ai-design-result-v2.png`; the generated home hero
  is `miniprogram/images/ai-design-hero-v2.jpg`.
- Formal-plan boundary: entries pass `floorPlanId`, explicit
  `targetScope: whole_floor_plan | single_room`, and `roomId` only for a single
  room. The backend derives dimensions, ceiling height, and opening summaries
  through the formal survey-graph read adapter and never mutates
  `FloorPlan.layoutData`. For complete-plan rendering it rasterizes a derived
  1024px wall/opening control image into a separate `MediaAsset` and uses image
  editing; a standalone single-room render uses measured prompt context and
  image generation. Reference recreation with a selected formal target also
  rasterizes a control image, limited to that closed room when `roomId` is
  present, and sends it before the visual reference.
  The source selector returns only formal plans and closed rooms visible to the current
  enterprise role (assigned leads for designers, assigned plans for measurers,
  and enterprise-scoped plans for enterprise administrators).
  Floor-plan-only output is a concept visualization, not construction-grade or
  pixel-exact reconstruction.
- Limited: enterprise staff only; requires available platform-managed provider
  routing and enterprise AI credits. The server may route GRS, Pollinations, or
  another configured compatible provider without changing Mini Program APIs.
  Plan-backed reference recreation sends the measured control and visual
  reference together, but a 2D wall graph has no measured camera pose and the
  provider still cannot guarantee pixel-perfect reference duplication. The
  structural control takes precedence when constraints conflict. Floor-plan-only
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
- Visual: the Mine surface follows `design-references/miniprogram-mine-v6.png`
  at the iPhone 13 Pro `390x844` baseline. Its left-weighted translucent profile
  card preserves the visible home scene, while the white rounded summary tray,
  three baseline metric illustrations, fixed four-column workbench rhythm,
  compact two-item todo list, and AI design banner use production crops derived from
  `design-references/miniprogram-mine-v6.png` and
  `design-references/miniprogram-mine-v6-icon.png`. The established circular
  floating Measure action remains the center TabBar treatment. Live profile data,
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
- Limited: workbench cards and task actions vary by professional role; some
  account/notification cards are informational rather than configuration APIs.

### Recommendations Share Page

- Page: `pages/recommendations/index`.
- Limited: the registered page displays local styles/progress and defines a
  WeChat `onShareAppMessage` payload.
- Placeholder: recommendations are hard-coded mock data; “PDF download” is a
  timed success toast and does not generate or download a real PDF; the custom
  share ActionSheet has no follow-up operation; interaction tracking is local
  logging only.

## Formal Surveying

- Page: `pages/surveying-editor/surveying-editor`; all entries use
  `utils/surveyNavigation.js` with `leadId` and/or `floorPlanId`.
- Data contract: `FloorPlan.layoutData` is only `{ version: 4,
  measurementMode: 'surveying', surveyGraph }`; graph units are millimetres.
- Implemented editor behavior: startup restore, local draft and cloud draft
  persistence, straight and diagonal wall preview/commit, live BLE/manual length,
  remeasure, shared-wall closure, advisory close candidate, and direct closure
  from a pending diagonal preview (the close action commits its current preview
  length before closing), openings, opening
  dimensions and side, cursor placement for new wall chains on existing
  vertices, inner edges, outer edges, or free canvas positions, and an inner/outer
  wall-tracking, boundary-constrained measurement-edge prompt on the first
  committed wall of every new chain; closed room wall shells and outer joins are
  derived from the closed boundary rather than the selected measurement edge.
  undo/reset, completed submission, and measurement audit queue/flush.
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
  separate line approximation. Its status distinguishes vertex, inner-edge,
  outer-edge, and free placement; a closer outer edge is not overridden by the
  nearby inner vertex.
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
  drag layer, and bottom drop control, plus a canvas-anchored closure callout
  that selects a clear position away from walls and fixed controls. All
  action-guidance callouts use the same green surface; opening component specifications, BLE component measurement,
  flip/model panels, and a Three.js preview for the selected door/window.
  Canvas pan and pinch gestures use an animation-frame-coalesced transient
  render layer: walls, room fills, outlines, and openings remain visible while
  dimensions, room labels, guides, and callouts return after one final formal
  scene rebuild when the gesture ends. Gesture frames do not update page data
  or recompute wall solids and dimension plans.
- `miniprogram/utils/surveyDimensionPlan.js` and
  `miniprogram/utils/surveyWallSolidPlan.js` are the dependency-free sources for
  both renderers; admin development and production builds synchronize local
  mirrors instead of expanding the Turbopack watch root across the repository.
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
- Graph/rendering: `surveyWallGraph.js`, `surveyCanvasRenderer.js`, and
  `surveyLayout.js`; AI design uses `aiDesignService.js` and
  `aiDesignValidation.js`.
- UI: nav bar, custom tab bar, lead list/modal, share poster, room library, and
  survey compass components.

## Maintenance Rules

Before changing any Mini Program page, component, utility, API flow, or data
contract, read the root instructions, this inventory, and the applicable design
or formal-surveying document. In the same change, update this inventory and its
Chinese mirror with the real entry route, API, role/condition, data contract,
status, and limitations. Keep formal surveying rules aligned with the v4 graph
contract; do not document a mock or planned control as a live feature. If a change
has no functional documentation impact, state that explicitly in the handoff.
