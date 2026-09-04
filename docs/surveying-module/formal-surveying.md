# Formal Surveying Data Contract

This file records the current version-4 surveying contract. Historical geometry
experiments and rollback narratives belong in Git history, not the live contract.

## Authoritative data

`FloorPlan.layoutData` must contain exactly:

```json
{
  "version": 4,
  "measurementMode": "surveying",
  "surveyGraph": {}
}
```

Coordinates, lengths, wall thickness, openings, and heights use millimetres.
Door and window `widthMm` may occupy the full host wall; `normalizeOpeningToWall`
clamps width to that wall's current `lengthMm` (minimum 100 mm) and does not
apply a fixed 60% wall-ratio cap.
The graph is the only persisted editable geometry. Do not write `rooms`,
`homeOutline`, `partitions`, `surveyDraft`, `prototypeOnly`, or a legacy layout
copy back to `layoutData`.

## Entry and consumers

- The only formal measurement page is
  `miniprogram/packages/surveying/editor/surveying-editor.*`.
- In the Mini Program, an assigned measurer enters from their own task, an
  assigned designer can continue the linked plan from their lead detail, and
  an enterprise owner may start, continue, add, or delete formal surveys from
  any lead detail inside the signed enterprise. Client route capabilities and
  the server tenant boundary both enforce this access; PUT completion uses the
  same linked-lead responsibility check when the other field role originally
  saved the plan.
- Every entry carries `leadId` and/or `floorPlanId`. A lead-only entry
  without `floorPlanId` resolves that lead's primary cloud plan instead of
  opening a blank canvas.
- Admin `/floorplans/[id]` draws the 2D plan with the Mini Program
  `surveyCanvasRenderer` (read-only pan/zoom, no graph writes). Completed
  formal v4 saves export that same canvas as a PNG snapshot stored on
  `floor_plans.preview_asset_id` (`media_assets.ownerType: floor_plan_preview`);
  the URL is not written into `layoutData`. DXF, 3D, AI,
  and Mini Program read models derive from the v4 graph through adapters; they
  do not maintain a second editable geometry.
- Graph and renderer sources are `miniprogram/packages/surveying/utils/surveyWallGraph.js`,
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`,
  `surveyDimensionPlan.js`, and `surveyWallSolidPlan.js`. The main package keeps
  only kernel-free `utils/surveyLayout.js` for formal-layout read helpers.
- Phase 2 foundation authority lives in `survey/core/{draft,session}.js`,
  `survey/geometry/{vector2,segment,polygon}.js`,
  `survey/domain/{wall,opening,errors,validation}.js`, and
  `survey/compat/legacy-error-messages.js`. `legacy-kernel.js` consumes those
  modules and no longer retains their duplicate function bodies. Foundation
  modules do not depend on the kernel, editor, BLE, or `wx`; domain failures use
  stable codes and structured details internally, while the 64 legacy public
  exports retain their historical messages and enumerable conflict fields.
  The Admin runtime passes the 35-pair mirror audit (34 exact copies plus the
  approved renderer require-path rewrite). This internal refactor
  changes no route, API, permission, UI, snap/closure rule, or version-4 graph.
  The follow-up also centralizes perpendicular line distance, measurement-side
  normals, preview measured lengths and endpoint reconstruction, checked exactly
  against frozen Phase 1 formulas. Preview adjustments still round before
  arithmetic while stored-wall readings preserve fractions. Legacy active-floor
  access still returns `undefined` for an empty list and throws for a missing
  list; guarded core access remains nullable.
- Phase 3 read models are Implemented in `survey/read-model/{wall-geometry,
  wall-faces,space-boundary,space-dimensions}.js`. They consume
  `core/graph-query.js`, `topology/closed-boundary.js`, and pure geometry/domain
  foundations without depending on the kernel or write operations. Wall solids,
  snap geometry, faces, inner/render boundaries, dimensions, and area retain
  their existing output. Closed chains retain ordered traversal and reverse-first
  fallback; render joins retain rounded-millimetre point comparison. All 69
  facade exports have explicit owners, including the former 17 overlapping
  providers. The 64 legacy exports remain, with eight read models aliasing the
  authoritative functions; 32 moved function bodies no longer live in the kernel.
  Eleven frozen graph shapes, 48 deterministic geometry variants, and degenerate
  inputs verify per-function immutability, repeatability, and Mini/Admin parity.
  Canvas, preview, DXF, room/3D data, and AI consumer checks prohibit derived
  layout writes. The 35 mirrors comprise 34 exact copies and the approved
  renderer path rewrite. This internal refactor changes no visible UI and
  requires no design-source change or WeChat DevTools operation. Opening writes
  are covered by Phase 4A below; remaining writes and interaction policy stay in
  later governance phases. Evidence and limits:
  [`legacy-kernel-phase3-read-models.md`](./legacy-kernel-phase3-read-models.md).
- Phase 4A opening transactions are Implemented in
  `survey/operations/opening-operations.js`. `addOpeningToWall`, `updateOpening`,
  and `deleteOpening` now create read-only mutation plans, apply them to an
  immutable transaction draft, and pass the existing invariant validator without
  kernel injection. Phase 2 opening normalization and numeric validation remain
  authoritative for host-wall width/offset bounds, door direction, and legacy
  error adaptation. Defaults, model/material fields, single-entry-door behavior,
  selection state, delete no-op semantics, timestamps, undo/redo snapshots, and
  failure atomicity retain the frozen Phase 3 behavior. Opening edits change no
  node, wall, or Space topology, so no topology/space synchronization is added.
  The kernel's opening exports retain three compatibility proxies: their mutation bodies are
  removed, reducing it at that phase to 6,064 lines / 173 top-level functions. The 69 facade
  and 64 legacy exports remain unchanged; that phase's 35 Mini Program/Admin mirrors pass the
  32-module / 91-edge dependency audit. This internal refactor changes no route,
  API, role, permission, UI, error copy, snap/closure policy, or version-4 data.
  Evidence and limits:
  [`legacy-kernel-phase4a-opening-operations.md`](./legacy-kernel-phase4a-opening-operations.md).
- Phase 4B wall-structure transactions are Implemented in
  `operations/wall-split.js` and `operations/wall-deletion.js`, with independent
  read-only plans and apply steps for splitting walls, deleting walls and deleting
  closed spaces. Deletion facade entries no longer invoke kernel implementations.
  Splits remain composable steps inside commit/closure transactions; face sync and
  full validation occur after all cuts are applied. Standalone splits reuse the
  same transaction framework without adding a public facade export. Opening
  remapping/conflict rejection, audit allocation, shared-wall body side, session
  reference cleanup, collinear shared-run punch-through, shared-only-room geometry
  and undo/redo retain their frozen behavior. Chain recovery's existing read-only
  closure queries now live in `topology/closure-queries.js`; closure writes were
  outside Phase 4B and are now owned by Phase 4D.
  The Phase 4B kernel snapshot was 4,595 lines / 116 top-level functions, with
  39 modules / 141 edges and 42 verified mirrors. The 697 surveying, 55 H5 and
  39 Admin tests plus large-graph performance gates pass. The full Mini Program
  suite passes 1,184 of 1,198 tests; all 14 failures match the Phase 0 list.
  No UI, route, API, permission or v4 contract changes. Evidence:
  [`legacy-kernel-phase4b-wall-operations.md`](./legacy-kernel-phase4b-wall-operations.md).
- Phase 4C measurement writes are Implemented in
  `survey/operations/measurement.js`. `remeasureSelectedWall` now builds a
  read-only plan and applies it through the existing immutable `full`
  transaction. Open-wall remeasurement and isolated closed orthogonal cycles
  validate fixed endpoints, opening spans, axis-only balancing, and the
  complete measurement audit before moving any node. The raw instrument value,
  effective stored wall length, and derived closure correction remain linked by
  `lengthMm = rawMeasuredLengthMm + closureAdjustmentMm`. Existing-wall
  extension/shortening and new-wall commits in `commitPreviewLength` use the
  same measurement-write helpers. Mini Program and Admin keep one mirrored
  implementation; the legacy kernel retains only its compatibility proxy.
  Closure confirmation, snap policy, UI, routes, APIs, permissions, and the
  version-4 data envelope are unchanged. Evidence:
  [`legacy-kernel-phase4c-measurement-operations.md`](./legacy-kernel-phase4c-measurement-operations.md).
- Phase 4D closure and merge operations are Implemented: read-only
  `topology/closure-candidates.js` and `closure-plans.js` feed `operations/closure.js`.
  Preview commits, shared-wall cuts, opening remapping, merging and Face/Space sync compose
  inside one full-validation transaction. Plans read no clock, allocate no runtime IDs and
  retain no graph references; failure preserves input and history. Its frozen 4,096-case
  matrix remains active. See the [Phase 4D completion record](./legacy-kernel-phase4d-closure-operations.md).

- Phase 5 interaction and session separation is Implemented. `session/state-machine.js`
  defines 11 canonical states and 19 event types with explicit legal transitions and atomic
  `INVALID_SESSION_TRANSITION` results; the old `openingSelected` input alias is accepted
  without being emitted. `session/field-groups.js` groups the existing 42 flat fields into
  preview (10), selection (3), closure (18), measurement (10) and viewport (1); optional
  absence and the persisted schema stay unchanged. `interaction/` produces isolated session
  or value/ID intentions for preview, direction, angle, wall snap, confirmation and viewport.
  `snap/snap-engine.js` owns the explicit preview/confirmation order; graph queries and the
  Canvas cache share `snap/candidate-policy.js`. Operations alone apply graph changes.
  `startPreview` orchestrates the preview service and optional cursor-creation intention;
  `commitPreviewLength` separates input confirmation from the existing quick/full transaction.
  Closure composes the standalone commit operation directly, with no kernel callback or nested
  transaction. Editor device/gesture/Toast/BLE responsibilities and all snap thresholds stay unchanged.
  Phase 6 reduces the kernel to a 97-line compatibility entry with no top-level domain functions; 76 modules / 400 dependency edges and 79 generated mirror pairs are audited. All 64 legacy and 69 facade exports remain available
  with explicit ownership. The 368 new tests include individual transition checks, both-client
  frozen command comparisons over every state, per-step preview/commit/snap comparisons in
  the complete 4,096-case matrix, clock-free plans, repeat/undo/redo, rejection atomicity and
  frozen Canvas-index comparisons. All 1,089 surveying/editor tests, 55 H5 tests, 39 Admin
  consumer tests and existing performance gates pass. Full-suite results are recorded in the
  [Phase 5 completion record](./legacy-kernel-phase5-interaction-state-machine.md).
  No UI, artwork, route, API, role, tenant permission, BLE protocol, measurement-audit queue or
  formal v4 data contract changes. Admin remains read-only. No new design source or DevTools
  automation is required. Phase 6 compatibility/runtime-source consolidation is complete; see [the Phase 6 completion record](./legacy-kernel-phase6-compatibility.md).
- Phase 7 governance is Implemented. `geometry/` remains graph-free and may depend only on
  geometry; `read-model/` dependency closures cannot reach operations, interaction, snap,
  compat, the facade, legacy kernel, editor, BLE, `wx`, or browser globals. The complete
  surveyed module graph must remain acyclic. The facade and legacy compatibility entry each
  use one explicit export object with unique, runtime-complete bindings. The Mini Program is
  the sole source authority and the 79-file Admin manifest/mirror rejects missing, stale,
  extra or divergent files. Graph writes enter through `operations/`, apply to an isolated
  transaction draft, synchronize topology/Spaces, and pass quick/full validation before the
  exact version-4 envelope reaches an authorized API write. Geometry, domain, topology,
  session state, graph invariants, mutation atomicity/audits and server persistence own their
  respective invariants; read models never write. Placement and test rules for new behavior,
  plus retained compatibility limits, are recorded in the
  [Phase 7 governance closure](./legacy-kernel-phase7-governance.md).
- Surveying pan and pinch gestures use the primary Canvas `requestAnimationFrame`
  frame queue. If the primary Canvas is temporarily unavailable, draft syncing is
  coalesced to one callback per animation frame and flushed once at gesture end;
  the lightweight gesture frame keeps the current green reticle visible, moves
  its position through the same viewport transform as the plan, and preserves
  its screen-space glyph size as a zoom reference. This is a rendering-performance
  path only and does not change graph data or viewport persistence. The canvas projector accepts an optional view-only
  `rotationRad` (`screen = center + offset + R(θ)·(mm·scale)`). θ=0 matches the
  unrotated mapping. The editor merges page-level `viewRotationDeg` in
  `getViewport()` and never writes `rotationRad` into `floor.viewport` or
  `FloorPlan.layoutData`. Manual clockwise/counterclockwise rotation recenters
  the rotated bounds of the current survey nodes and active preview point; an
  empty draft keeps the existing screen-centre world-point compensation. The
  Admin 2D viewer does not pass rotation.
- View rotation is editor-page transient state only. The top action row keeps a
  visible `132×88rpx` **导航测量** action in an independent far-left slot (the
  technical component remains `survey-canvas-compass`), while Guide / Save / CAD /
  Finish remain a compact, fixed-gap group aligned to the far right. Its native
  `28rpx` label and `28rpx` live bearing readout are paired with the independently generated transparent
  `packages/surveying/assets/icons/navigation-measure.png` (128×128, 7,858 bytes);
  the UI no longer renders `N`. Tapping it opens an entry-door calibration dialog.
  The operator must keep the phone level and still while its top edge faces the
  entry door, and the BLE distance meter must be connected before confirmation.
  Nine circular heading samples with at most `6°` spread establish the reading.
  The captured value remains its absolute compass azimuth (for example `231°`)
  and is shown on the active action; it is not rewritten as a displayed `0°`.
  Internally, current azimuth minus the entry-door azimuth becomes the room-relative
  cardinal bearing used only for canvas rotation; direction arrows remain manual
  choices. A later tap reopens the
  dialog for relocation or allows navigation measurement to be disabled.
  Relative room bearings are hysteresis-snapped to the four orthogonal axes
  (`0°/90°/180°/270°`); only a `20°` trigger delta changes the selected axis, so
  the raw compass value can never become a diagonal canvas rotation. Axis changes
  rotate along the shortest arc over `420ms` with an ease-out curve and an
  inverse visual sign so the plan counter-rotates against phone movement,
  instead of snapping to the target. Navigation-triggered frames fit the closed
  plan, active wall chain, preview/closure points, and current cursor as one
  centred spatial context inside the usable canvas. They retain the current
  scale when that complete context fits and only zoom out when necessary.
  Manual rotation and disabling navigation retain their existing whole-content
  centering. Disabling navigation eases back to
  `viewRotationDeg = 0`.
  Compass is the primary heading source and device
  motion is its fallback through `surveyDeviceOrientation.sharedHeadingSensorHub`;
  `sharedDeviceMotionHub` validates phone level when available. Subscriptions stop
  on `onHide`/`onUnload` and resume on `onShow` for an active logical mode. The
  calibration and view rotation remain editor-session state and are not added to
  version-4 `surveyGraph`, local/cloud layout serialization, route APIs, or
  permission contracts. Dimension labels, room cards, grid projection, geometry,
  ortho snap, and BLE `ATD` distance semantics remain unchanged.
- Straight-mode BLE quick input exposes blue dashed cardinal guides and three
  or four compact, single-layer translucent-green candidate pointers at the current anchor,
  excluding the active chain's immediate backtrack. The `closing` and
  `mergeClosing` states keep those candidates visible alongside the `合` close
  action, so closure guidance does not remove direction selection. After a
  direction locks, every other candidate disappears and the selected bearing
  keeps only a small blue arrow on its guide. If a direction pointer's `28px`
  touch radius overlaps an opening or wall, the object hit takes priority so
  the operator can still select that wall and enter **复尺**. A short tap near
  the reticle likewise selects an opening or wall under it; only a moved gesture
  starts the normal wall drag. Tapping otherwise empty canvas
  space clears that transient lock and restores the candidate pointers without
  moving the cursor or changing any wall. Outside navigation measurement, an
  automatic lock returns to manual direction picking so the sensor cannot
  immediately relock it. During navigation measurement, clearing an arrow keeps
  the shared heading subscription alive, so the live azimuth and canvas rotation
  continue while all manual candidate pointers return. Manual selection calls `lockPreviewBearing` without
  moving the cursor or writing a wall; a valid ATD distance materializes and
  commits the preview through the existing `startPreviewFromBearing` /
  `commitPreviewLength` path. Tapping the
  compass while BLE input is active switches manual/automatic direction pick.
  Automatic pick maps Compass north/east/south/west to canvas north/east/south/
  west, removes the current view-only rotation, applies circular median filtering
  plus activation/switch hysteresis, and rearms after every committed wall so a
  same-heading next wall can lock again. Privacy authorization completes before
  either heading subscription starts. `bleLockedBearingDeg` is live editor state
  only and is stripped from local and cloud graph serialization.
- Autosave, manual draft save, and completed submission share one serialized
  cloud-save queue. Only one save is in flight; a queued `completed` request
  upgrades and takes priority over queued `draft` work. New floor-plan POSTs
  carry a persisted `Idempotency-Key`, backed by the unique
  `floor_plans.create_idempotency_key` column, so a lost response can be safely
  retried without creating a second floor plan. Once a `floorPlanId` exists,
  the client sends exactly one PUT; every PUT error (including 404, auth,
  validation, server, and network errors) is propagated and must never fall
  back to POST or clear the existing ID. POST is used only when no ID exists.

## CAD/DXF export

- `GET /api/floorplans/[id]/export/dxf` is the Admin-cookie download endpoint;
  `GET /api/miniprogram/floorplans/[id]/export/dxf` is the Bearer-JWT endpoint.
  Both use their existing tenant/assigned-staff access boundary.
- Export is read-only and accepts only a `completed` formal v4 graph with at
  least one closed space. It never writes or stores a second `layoutData` copy.
- `admin/src/lib/dxf.ts` is a thin adapter over `@tarikjabiri/dxf@2.8.9` (MIT).
  It writes AutoCAD 2007+ DXF in millimetres, with Chinese CAD layers (`墙`,
  `门`, `窗`, `尺寸标注`, `空间名称`, `指北针`), millimetre DIMSTYLE
  (`标注线` / `标注线-内墙`), `_ARCHTICK`, `黑体`, and `ACAD_ISO03W100`
  door-swing dashes. Floors are placed side by side; survey Y is negated so CAD matches the
  canvas/viewer orientation, then fitted into a fixed
  landscape sheet (30640×21660 model units, matching the reference CAD
  template). Floor content (walls + dimension padding) scales up or down
  uniformly to fill ~90% of the left draw zone; the title-block plot scale is
  sheet-based (~1:85), matching the reference template. Closed rooms write four-line MTEXT
  (name, inner-face area m², ceiling height m, inner-face perimeter m) at
  the room centroid with `\P` line breaks on layer `空间名称` (ACI 7). A cyan
  model-space double frame with rounded outer corners, a full-height right title
  panel with stacked Chinese / English / value text (no mid-cell vertical split), and a yellow filled north-arrow block wrap the
  drawing with the sheet name `原始户型平面图`, a computed plot scale, the plan completion
  date, the project title and download filename as customer name + community + area (filename also appends export time; fallback plan name),
  the linked lead's enterprise as 公司名称 at the top of the panel, and
  the lead's assigned designer as 设计师; customer phone and address are not
  exported. Both export endpoints resolve that sheet metadata in the same
  tenant transaction as the floor plan. Walls are opening-gapped rectangles unioned by
  `surveyWallSolidPlan` and written as inner/outer `LINE` faces plus jambs,
  not per-wall thickness rectangles. Hinged doors are a unit `DOOR` block
  (green open 90° thick leaf + gray dashed CCW arc) inserted on the opening face with
  50mm jamb rectangles; sliding doors remain double rails and windows use four
  inset in-opening lines away from the wall faces. `_ARCHTICK` is the diagonal
  architectural tick. Dimensions reuse `createClosedDimensionPlan`: inner
  segments including wall-thickness ticks become rotated `AcDbRotatedDimension`
  entities styled `标注线-内墙`, overall outer lengths use `标注线`, with
  integer-millimetre text in magenta (DIMCLRT 193), `DIMTAD` 2 / `DIMGAP` 10,
  wider exterior standoff (first lane ≈ 14% of plan span), DIMEXO clearance so extension lines do not cover walls, and axis angles 0 or 90. The DXF writer places each
  dimension on the planned `dimensionStart`/`dimensionEnd` line rather than on
  the wall face. Recessed L-notch spans stay on their local face. Aligned dimensions are
  not written. The Mini Program / Admin canvas passes `includeRoomClear: false`
  for the shared closed plan so on-canvas closed plans keep building-overall
  (and door/thickness) bands by default; when `session.selectedSpaceId` is set,
  the editor overlays that room's internal clear dimensions only.
- The Mini Program keeps its CAD control disabled until the cloud plan is
  completed. A download is saved to the Mini Program file domain and offered to
  the system document handler; devices without a DXF handler are told to send
  the file to a CAD-capable device.

## Measurement and audit rules

- Manual and BLE readings are recorded as measurement audits with value, unit,
  source, operator, and timestamp.
- `POST /api/measurements` accepts the canonical top-level `auditId` and, during
  compatibility, also reads `metadata.auditId`. Formal surveying audits require
  a non-empty value of at most 200 characters; other measurement sources may
  omit it. The DTO returns `auditId` while retaining `metadata.auditId`.
- For staff sessions, audit creation accepts the formal plan's owning staff
  member, the linked lead's current assigned designer or measurer in the same
  enterprise, and the signed enterprise administrator. This remains fail-closed
  for unassigned staff and cross-enterprise links. Non-staff access remains
  restricted to the plan creator.
- PostgreSQL stores nullable `measurements.audit_id` and enforces a partial
  unique index on `(floor_plan_id, audit_id)` when `audit_id IS NOT NULL`.
  Idempotent creation returns 201 with `deduplicated: false` for the first row
  and the same row with 200 and `deduplicated: true` for a duplicate. Existing
  null rows are neither backfilled nor merged.
- Every accepted manual or BLE edit is persisted to a local write-ahead queue
  before its upload starts. Before the first cloud save the queue is scoped to
  the stable local draft; when a formal `floorPlanId` is obtained, compatible
  records are atomically moved and bound to that plan. Loading or saving the
  plan retries the queue. More than 500 pending records emits a warning but
  never truncates the queue, and a record bound to another plan is not sent.
- Temporary BLE callback owners replace and restore the complete measure,
  connect, and disconnect callback set when they close.
- Hardware-triggered ATD frames (the meter's measure key, without an app
  `ATD001#` query) use the same pending-wall / selected-wall write path as the
  dock 测距 action. Audits set `metadata.bleOrigin` to `device` for those frames
  and `app` for software-initiated queries. A valid ATD with no pending or
  selected wall toasts「请先拉出一条墙」.
- The dock's native label makes its connection state explicit: `测距 · 已连接`
  when connected and `测距 · 未连接` when disconnected. This presentation-only
  state does not change the BLE command, wall-write, route, or permission flow.
- ATD parsing accepts only the vendor-defined complete 17-byte frame with the
  `ATD` header, `#` tail, and valid CRC. Distance is an unsigned big-endian
  32-bit value divided by 10,000; X/Y angles are signed big-endian 32-bit values
  divided by 10. The audit retains the raw frame, notification channel, and
  receive time. Only identical complete frames delivered by different channels
  within 350 ms are deduplicated; repeated same-channel readings remain distinct.
  A short guard after an app request completes or times out prevents its late
  response from being classified as a hardware-key reading.
- A sequence of embedded-component keyboard edits is collapsed into one manual
  audit containing the final accepted value. A BLE reading applied to a pending
  wall records the actual wall ID created by the commit, not the preview ID.
- Failed cloud saves restore the last readable graph and undo/redo state; failed
  intermediate drafts are not persisted as a new layout contract.
- Successful top-bar Save (`onSaveDraft`) persists the formal draft locally and
  to the cloud, then navigates back to the previous page (same fallback as Back:
  `navigateBack`, else `switchTab` home). Cloud failure keeps the operator on the
  editor so they can retry.
- Accidental backgrounding or leaving the editor (`onHide` / `onUnload`) immediately
  flushes the local formal draft and best-effort silent-saves the same v4 graph to
  the cloud without navigating or toasting. Reopening keeps a newer local draft
  instead of a stale cloud copy, then writes that local graph back to the cloud.
- The editor's right-rail canvas-clear/restart action requires confirmation,
  replaces the in-memory and local draft with a fresh v4 graph, and clears
  undo/redo plus queued, unsaved measurement audits.
- Tap hit order is opening → wall → closed-space interior. Selecting a closed
  space sets `session.selectedSpaceId` (clears wall/opening selection), paints
  a blue fill + inner stroke, and shows that room's internal clear dimensions
  only while selected. Selected-state `room-clear` spans merge collinear,
  end-to-end `innerSegments` into one continuous clear label per side so a
  neighboring T-junction that splits one physical edge into multiple graph
  walls does not fragment the selected room's clear dims; `building-overall`
  and `space.wallIds` topology stay unchanged. The right rail switches to a
  room context with **命名** (`renameClosedSpace`, preset chips + custom input)
  and **删除** (`deleteClosedSpace`). Delete removes walls referenced by only
  that closed space; shared walls with adjacent closed rooms stay, then spaces
  re-sync from faces. Ceiling height remains floor-level (`ceilingHeightMm`),
  not per room.
- Wall selection is an object-edit overlay, not a cursor reset. When the cursor
  is already placed, opening the wall toolbar preserves its `anchorNodeId` and
  renders the reticle at the same plan coordinate. Selection does not move,
  dock, or recreate the cursor.

## Write validation and stability boundary

- `POST /api/floorplans` and `PUT /api/floorplans/[id]` reject a non-formal v4
  envelope with 400 as before. A `draft` runs `quick` validation; a `completed`
  plan runs `full` validation and must contain at least one closed Space.
  Validation runs before database writes and preview generation and never
  repairs or rewrites the submitted graph.
- An invalid formal graph returns 422 with `success: false`, the first error
  message and code, plus `validation: { mode, errors, stats }`. Full validation
  classifies proper crossings as `UNSPLIT_WALL_INTERSECTION`, an endpoint on
  another wall interior as `UNSPLIT_WALL_T_JUNCTION`, coincident endpoints with
  different node IDs as `UNMERGED_WALL_ENDPOINT`, and positive-length collinear
  overlap as `OVERLAPPING_WALLS`. These checks use integer-millimetre centerlines
  and the existing geometry epsilon; the 350 mm snap tolerance is not a
  topology-validity tolerance.
- Full validation also requires every straight/diagonal wall to store an integer
  millimetre `lengthMm` and the mode-required `angleDeg`. Measurement inset and
  extension fields must be non-negative integer millimetres and may not consume
  the effective measured length, except for synthesized zero-reading
  `closure-merge` / `closure-bridge` connectors that have no raw instrument
  reading. `rawMeasuredLengthMm` and `closureAdjustmentMm` must appear as a
  finite integer pair satisfying
  `lengthMm = rawMeasuredLengthMm + closureAdjustmentMm`.
- Manual and BLE wall remeasurement execute the same immutable transaction with
  `full` validation. An invalid crossing, unsplit T touch, or overlap rejects
  the transaction and leaves graph, spaces, openings, history, and draft
  unchanged; it does not auto-split or auto-node walls.
- Remeasuring an isolated closed orthogonal cycle balances residual only on the
  selected wall's axis; the other axis keeps its current coordinate lengths and
  audit metadata, so consecutive horizontal and vertical remeasurements do not
  undo one another. Open-chain and closed-cycle remeasurement both preflight all
  hosted opening spans before moving nodes. A wall that can no longer contain
  its opening rejects atomically with `OPENING_REMEASURE_CONFLICT`; it never
  silently moves or normalizes that opening.
- This hardening freezes the current correct valid-survey result as the
  compatibility baseline. Apart from the bounded near-close adjustment and
  remeasurement corrections above, it does not change snap/closure tolerances,
  multi-room shared-wall behavior, face extraction, wall bodies,
  Canvas/WXML/Less, or the operator workflow. Apart from the targeted internal-L
  face-inheritance correction, continued-divider boundary clamp, and shared-wall
  split body-side and opening-conflict corrections below, previously correct valid operations remain
  unchanged. The face-inheritance correction leaves `nodes`, `walls`, `openings`,
  and `session` unchanged; the clamp affects only the invalid overshoot path; the
  body-side correction freezes the already-rendered physical side onto the source
  shared wall and its replacement segments without changing centerlines,
  measurement faces, openings, Space topology, or the operator flow. The opening
  correction rejects a conflicting divider before a host-wall split and reuses
  the editor's existing non-layout error Toast; the rejected immutable transaction
  leaves walls, nodes, Spaces, openings, history, and persistence unchanged.
  Shared-node joins, endpoint-only
  collinear adjacency, correctly split T/cross junctions, shared walls, and
  `closure-bridge` remain valid.

## Geometry invariants

- When an isolated, opening-free, unshared, unbranched orthogonal chain returns
  toward its start, preview and confirmation use one constrained
  closure-adjustment plan. The ordinary 350 mm snap tolerance is unchanged; a
  long multi-corner chain may consume additional accumulated residual only when
  every wall stays inside its correction budget (2% of coordinate length,
  clamped to 25–150 mm) and the total residual stays at or below 1,000 mm. A
  short loop may therefore be rejected even inside 350 mm instead of distorting
  one wall pair or falling back to a micro bridge. The plan distributes the X/Y residual over same-axis walls by measured-length
  weight, preserves direction and minimum wall length, and projects the whole
  result before offering closure. Any adjusted non-adjacent self-intersection,
  overlap, or contact with an external wall rejects the plan. Confirmation
  retains every raw instrument value in `rawMeasuredLengthMm` and the derived
  correction in `closureAdjustmentMm`; endpoint inset, collinear merge, and
  host-wall split operations preserve that traceable pair.
- A physical wall is stored once. An inferred orthogonal close absorbs a
  collinear continuation into the last measured wall instead of storing a
  butt joint. Two new walls started from a closed-room corner close against
  the existing boundary when the second wall lands on an adjacent wall and
  completes a face with the start edge; axis-aligning to a distant corner
  without hitting an existing wall still does not infer extra closing walls.
  When a drag extends the current collinear terminal wall and its visible
  preview already offers a `mergeClosing` action, committing that same preview
  retains the action instead of dropping it when the two lengths coalesce into
  one stored wall.
  Loading a saved draft also folds remaining collinear degree-2
  splices into one wall.   Deleting a wall that opens a single closed room
  restores the remaining loop as the active chain and offers the missing-edge
  close when the dangling ends still determine it. `deleteWall` also clears
  remasure `session.fixedNodeId` (and the same field is cleared when remasure
  completes or pending selection is cancelled) so an orphaned free-tip pin
  cannot fail the post-transaction session validator as `MISSING_SESSION_NODE`.
  A successful direct, inferred-merge, shared-boundary, or partition close also
  clears `session.lastWallSnap*`; if collinear degree-2 folding removes the prior
  cursor-drop joint, stale snap memory cannot roll back the otherwise valid
  closure as `MISSING_SESSION_NODE`.
  When adjacent collinear segments select different physical faces at a
  shared-wall/exterior-wall transition, the space render boundary and net
  dimension plan insert an explicit wall-thickness orthogonal step. They must
  not connect the two offset face endpoints with a diagonal.
  Closed-wall outlines are stroked once from the classified geometric union
  rings. `wallFaceOverrides` may guide room fills and net dimensions, but its
  full working-face boundary is not replayed as seams through fused wall
  material. Renderer revision `wall-union-outline-v20` invalidates older Admin
  preview snapshots on their next refresh.
  When a new wall is dragged or measured towards an existing closed room,
  ray intersection (`findRayWallIntersection`) clamps preview and committed
  endpoints to the first contacted wall boundary, preventing new walls from
  penetrating closed room interiors; internal divider drags
  (`isPotentialPartitionDrag`) remain governed by the dedicated partition
  closure solver. When the closing wall of an adjacent room overshoots the
  contact boundary, the endpoint is clamped to the ray hit and synthesizes a
  shared-wall closure candidate, entering `closing` / `shared-wall` and
  auto-confirming closure without creating an unsplit T-junction node or throwing
  `UNSPLIT_WALL_T_JUNCTION`.
  Confirming a closed room
  automatically enters the same reset-cursor / wall-drop state as tapping
  重置光标. Restoring a saved closed room normalizes a residual `spaceClosed`
  session to that same wall-drop state, so reopening the editor immediately
  shows 光标拖动到墙体 rather than requiring an extra reset. In guide mode that state immediately shows the Xiao K
  place-next-start tip even when closed-room dimension labels would otherwise
  leave no hard-avoiding layout. During that wall-drop wait
  (`wallSnapPending`), the canvas still pans and pinch-zooms; direct taps on a
  wall or vertex do not place the cursor; a wall tap may select the wall for
  opening placement.   The cursor is placed only by dragging the dock control
  onto the canvas, so a drag does not lock the viewport.
  That dock drag aims 24×40 CSS px upper-left of the finger
  and clamps the aim point to the canvas. Cover-view touchmove uses a 16 ms
  leading/trailing queue that consumes the latest point instead of dropping the
  last coordinate inside a throttle window. One cursor-placement index is built
  per stable render scene and reuses projected vertices, inner/outer wall faces,
  and closed-space alignment axes while dragging. Unlocked free-follow frames
  skip the full snap search and dirty-clear only the reticle. The 16 px acquire /
  26 px release hysteresis stays unchanged: a retained wall or alignment lock
  slides continuously along that target instead of staying pinned to its first
  acquired coordinate; a higher-priority vertex or wall can still take over
  inside the acquire radius, while a vertex remains a fixed lock. Magnifier crops keep their lower update cadence,
  and a retained snap frame no longer clears the full overlay. Canvas wall-endpoint
  drags keep the grab delta from touchstart with a south-east-biased
  hit and must not apply the dock offset, so the first preview frame
  cannot invent a wall segment.
  A short tap on a closed-room fill selects that space (`selectSpace`) instead;
  the wall/vertex toast appears only when neither snap nor fill hits.
  Resetting the cursor onto
  either dangling vertex resumes that same open chain instead of starting a
  new room from the existing wall. Dragging back along that
  restored last wall shortens it instead of reporting overlap with the
  measured wall. That strict terminal-wall edit takes precedence over a nearby
  start/shared-wall closure candidate: while the reverse endpoint remains on
  the editable wall and leaves at least the minimum wall length, the operation
  moves the existing endpoint and never appends a reverse duplicate wall.
  Returning exactly to the preceding corner retracts that terminal wall and
  resumes the chain from the corner instead of attempting to store a zero-length
  or fully reversed duplicate.
  Closed, shared, branched, opening-host, non-terminal, and past-start edits
  remain outside this gesture and retain their existing validation paths.
  Shared-wall faces and room boundaries are
  derived from wall direction, thickness, and each space's ordered `wallIds`.
  `confirmClosure`, `deleteWall`, and closed-wall splits write those `wallIds`
  by syncing closed spaces from half-edge faces (`extractFaces` /
  `syncClosedSpacesFromFaces`). The transaction then requires the saved spaces
  to equal the extracted faces; a mismatch rejects the operation. Full-mode
  self-intersection checks use proper edge crossings only after collapsing
  zero-length ring points, so shared-wall splits and thickness bridges on a
  valid adjacent-room close must not reject with `SELF_INTERSECTING_SPACE`.
  Graph nodes
  store centerline millimetres only. Working (red/orange) faces and one-sided
  bodies are read models from centerline + thickness + `measurementSide` /
  `bodyNormalSide`; display hits pair an outer point with its centerline node
  and must not write outer coordinates as `node.xMm`. Adjacent working-line
  endpoints meet at their line intersection, and confirmed readings use
  `topology length - start inset + start extension - end inset`. The H5 catalog
  plus shared-wall deletion remains the gesture-regression matrix; invariant
  tests in `test/survey-kernel-invariants.test.js` lock the face-write,
  working-line, and reading rules.
- Closed-space fill and net area use derived inner wall faces, not topology-node
  polygon area or a bounding rectangle.
- Dimensions are read models. They must not be written into `surveyGraph` or
  alter the graph's topology. Closed-room Canvas lanes sit outside every
  unclosed wall currently on the canvas plus a stationary length preview; an
  in-flight `wallPreview` drag does not move those lanes.
- Consumers must preserve wall openings, shared-wall thickness, closure rules,
  deletion/rejoin behavior, and the v4 schema. Deleting a wall shared by two
  closed rooms punches through that interface and merges them into one closed
  room. If the shared interface is split into collinear segments, deleting any
  one segment removes the whole collinear shared run rather than leaving a
  dangling stub. After that punch-through, collapsed collinear inner corners
  must still produce a defined inner dimension plan whose every segment has
  millimetre start and end points, so Canvas can render the merged room. An
  L-shaped concave corner created by that punch-through keeps overlapping
  rectangular wall solids; it must not convex-miter the remaining outer wall
  into the room. Node joins use local convex/concave predicates: convex outer
  corners keep an outer miter, concave inner corners keep overlapping
  rectangles, and collinear opposite-thickness walls fill only the outer step
  so inner faces stay aligned at the shared node. Admin
  `admin/src/lib/surveyWallSolidPlan.js` uses the same join generator as the
  Mini Program planner. Inner-face closures keep each remaining wall's original body
  side, so the merged inner L extends into the room and collinear walls with
  opposite thickness stay a stepped facade. The two remaining walls at that
  inner L keep overlapping rectangular solids; they must not convex-miter a
  trapezoid that cuts a triangular hole out of the join. Collinear remaining
  walls with opposite thickness keep a stepped outer facade and fill the outer
  step corner so inner faces stay aligned at the shared node.
- When an operator starts at the middle of the wall shared by two closed rooms
  and drags a divider to the opposite boundary on either side, the original
  shared wall must freeze its current physical body side before it is split.
  Every replacement with the same `topologySourceWallId` inherits the same
  `bodyNormalSide`; segment bodies must not be re-inferred independently from
  whichever Space happens to reference each segment first after face sync.
  Leftward and rightward partitions are mirror-equivalent, and the untouched
  original room keeps its render boundary, net area, and clear dimensions.
- Before splitting an opening host wall, every interior cut is checked against
  the opening's physical span expanded on both sides by one current/incident
  divider-wall thickness. Contact with that protected span throws
  `OPENING_SPLIT_CONFLICT` with `分隔线压到门窗，请先调整门窗位置`. Direct
  release, the 「合」 action, manual length entry, and BLE length entry surface
  the same error through their existing Toast paths. The immutable transaction
  must not return partial wall, node, Space, opening, or history mutation. Safe
  openings beyond the clearance remap to one replacement host segment without
  changing world position. Cross-segment openings remain unsupported; the
  operator must move or remove the opening before retrying the divider.
- A T-branch started on a closed exterior wall middle keeps one topology node
  and physical wall. Inner/outer start selects the near/far point on the source
  wall boundary and the corresponding first-wall start inset; it does not
  select opposite local measurement faces for the new branch. The first branch
  wall and every continuation use the graph-side working face and inherit the
  physical-body side fixed by that first wall. Neither turn direction nor the
  source-space centroid may re-evaluate that side.   Orthogonal gesture input is
  stored on the internal graph, while the preview outline, orange/red path,
  live-dimension endpoints, and green cursor remain coincident on one continuous
  path. Straight-mode vertex, closure, or outer-face snaps may change at most
  one axis; they must not copy an off-axis vertex or wall-thickness offset onto
  the orange preview. The physical outer face remains the contact/closure
  target, while any off-axis gap is handled by the short orthogonal bridge on
  confirmation. A drag leaving an existing T/cross vertex along a room edge
  keeps that start axis even while its first frame remains inside a neighbouring
  miter/outer-face capture band; it must not jump by one wall thickness. The wall-drag lens
  reports the actual snap type and shows a small green crosshair rather than the
  canvas Fig.1 reticle. Wall-endpoint dragging follows the sticky grab aim point,
  not a dock-style upper-left finger offset. Adjacent working faces meet at their line intersection, so the previous
  red endpoint equals the following red start and a turn cannot shift either by
  one wall thickness. This display projection does not alter graph centreline
  or closure topology. Canvas opening masks cut only the host wall and refill
  overlapping adjacent wall bodies, so a door against a T or L junction does
  not punch through the neighbouring closed solid.
- `measurementStartInsetMm`, `measurementStartExtensionMm`, and
  `measurementEndInsetMm` record real boundary or closure adjustments only. An
  ordinary T turn starts at the current graph working-face endpoint and must not
  synthesize a one-thickness inset or extension merely because the chain began
  on the source wall's outer boundary. Preview, manual/BLE confirmation, Canvas,
  and dimension consumers all use `topology length - start inset + start
  extension - end inset`; the red path, displayed dimension, and confirmed
  reading cannot differ by one wall thickness.
- From the second branch wall onward, a turn may join the rendered wall solids
  but must not rewrite measurement insets on preceding walls or shorten any
  confirmed reading.
  Every shared-boundary closure chain
  preserves its pre-close body side, including an exterior-facing measurement
  whose final orange line snaps to a source room's inner face. Closing cannot
  move that aligned red/orange edge to the opposite side by one wall thickness.
  A new wall aligned to a neighbouring closed room's visible outer keeps that
  outer as its working face on close and must not extrude another thickness.
  When the final cursor hits a source wall's visible outer face, the close must
  retain that physical outer coordinate and bridge to the topology corner rather
  than silently projecting it to the centre line. A one-thickness overshoot in
  straight mode likewise keeps the last wall axis-aligned; the orange 「合」
  guide and `confirmClosure` use a strict 1 mm axis check (not the 350 mm
  rectangle-snap tolerance) and add a short orthogonal `closure-bridge`
  instead of yanking that wall onto an off-axis inner topology corner (which
  would leave a diagonal seam in the shared wall body).
  Vertex continuations and shared internal-wall partitions retain their
  boundary closure rules.
- An internal divider remains bounded by its source closed room for the whole
  active chain. If the operator confirms a short first segment and then
  continues toward the opposite wall, the preview stops at the first source-
  room boundary hit and closes there; it cannot cross the wall or persist an
  endpoint outside the room. Outward adjacent-room chains keep their existing
  two-wall ray-intersection threshold.
- When a chain starts from the middle of a closed room boundary, enters that
  room, turns one or more times, and lands on another boundary of the same
  room, the new Face must keep the source room side of every reused exterior
  wall. An `inner` start must not blanket those walls with
  `wallFaceOverrides: offset`, which would count exterior wall bodies inside
  the child room. The sum of the resulting clear-room areas is the original
  clear area minus the union of the new divider solids. A probe along the first
  new wall distinguishes this internal split from an outward adjacent-room
  chain; existing adjacent-room face inheritance remains unchanged.

## Verification

Use focused wall-graph, renderer, dimension, persistence, and BLE tests for
changes to this contract. Topology writes through `confirmClosure`,
`deleteWall`, and closed-wall `commitPreviewLength` must keep closed `spaces`
aligned with extracted half-edge faces;
`test/survey-topology-face-shadow-matrix.test.js` and
`test/survey-kernel-invariants.test.js` are the catalog and invariant gates.
`test/survey-closure-scenario-matrix.test.js` is the 4,096-case deterministic
formal-closure catalog. It covers orthogonal rectangles, concave L/U and stepped
outlines, diagonal triangles and quadrilaterals, release points inside/outside
the effective closure tolerance, same-wall adjacent rooms, sequential
four-room cross partitions, short manual/BLE divider continuations, two-cut
opening hosts with safe positions immediately beside the split points and atomic
conflict rejection, nearest-boundary partitions inside concave rooms, every
100/200/400 mm source/divider thickness pair, formal save/restore, and
immutable rejection of self-crossing closures. The catalog varies quarter-turn rotation, mirrored winding,
100/200/400 mm thickness, both measurement sides, inner/outer face snaps, and
direct versus committed closure. Every successful case must pass full
validation and Face shadow agreement, keep each wall owned by one or two
closed Spaces, retain valid area and clear dimensions, preserve untouched
rooms, clamp divider nodes to the first boundary, keep split shared-wall body
sides equal to the pre-split rendered side, preserve safe opening positions,
and reject conflicting openings with the specified error while leaving the input
draft byte-for-byte unchanged. Safe placements beside a split keep the opening
span outside the junction's one-wall-thickness clearance. A touching or
overlapping divider cut is blocked; the catalog does not model a cross-segment
opening.
Before and after migrating any `legacy-kernel.js` function family, run
`cd miniprogram && npm run test:survey-kernel-phase4b`. That command retains the
test-only Phase 1 harness, which runs legacy and candidate implementations twice
from isolated copies of the same input, compares graph/session/error plus
quick/full validation, checks references and input immutability, and
differentially executes the Mini Program and Admin runtime mirrors. It also runs
the Phase 2 foundation boundary, degenerate-input, legacy-message, and dependency
direction tests. Persisted graph values are exact; only derived read-model
floating-point values have an explicit `1e-6` tolerance. The harness's sole
legacy-core adapter omission is the transaction-only
`session.fullValidationAfterClosedSplit` handoff flag. Phase 3 additionally
compares frozen pre-migration read formulas exactly against standalone modules
and facades in both runtimes. Write-intercepting proxies check every read-model
input; architecture guards reject reverse/cyclic dependencies and implicit or
duplicate exports. Phase 4A additionally compares 15 frozen opening-mutation
inputs against both the extracted legacy proxies and transactional facade, and
checks read-only plans, structured results, host bounds, atomic rejection,
undo/redo, dependency closure, and removal of the three kernel bodies. Phase 4B
also compares a frozen pre-migration function closure across 27 split and 59
deletion inputs in both runtimes, verifying replayable read-only plans,
composable/full transactions, Space sync, reference cleanup, atomic rejection
and re-execution on operation output. Run
`cd admin && npm run test:survey-read-models` for 2D scenes,
PNG, DXF, room/3D and AI consumer checks, and run the complete Mini Program suite
before handoff. This guard changes no
runtime route, API, permission, UI, or version-4 persistence contract.
Real-device or WeChat DevTools evidence is required
when the change involves native Canvas, BLE, or host UI behavior.
Deploy the nullable audit migration and Admin API before the Mini Program. An
application rollback retains the nullable column and partial unique index; it
must not run a reverse drop. Existing invalid floor plans and duplicate audit
history are not cleaned up by this contract and require a separate dry-run and
approved operation.
The user-supplied exterior-T measurement screenshots are the behavior reference
for inner/outer chains. The H5 outer-start right-preview, right-continuation,
and left-continuation replays verify body side, red-line face, corner continuity,
and cursor placement; automated regressions also require adjacent red-line
endpoints to be identical.

Chinese module overview: [README.md](./README.md)
