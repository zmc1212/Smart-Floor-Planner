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
The graph is the only persisted editable geometry. Do not write `rooms`,
`homeOutline`, `partitions`, `surveyDraft`, `prototypeOnly`, or a legacy layout
copy back to `layoutData`.

## Entry and consumers

- The only formal measurement page is
  `miniprogram/packages/surveying/editor/surveying-editor.*`.
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
- Graph and renderer sources are `miniprogram/utils/surveyWallGraph.js`,
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`,
  `surveyDimensionPlan.js`, and `surveyWallSolidPlan.js`.

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
  not written.
- The Mini Program keeps its CAD control disabled until the cloud plan is
  completed. A download is saved to the Mini Program file domain and offered to
  the system document handler; devices without a DXF handler are told to send
  the file to a CAD-capable device.

## Measurement and audit rules

- Manual and BLE readings are recorded as measurement audits with value, unit,
  source, operator, and timestamp.
- Readings captured before the first cloud save remain queued until a formal
  `floorPlanId` exists.
- Temporary BLE callback owners restore the normal callback when they close.
- Failed cloud saves restore the last readable graph and undo/redo state; failed
  intermediate drafts are not persisted as a new layout contract.
- The editor's right-rail canvas-clear/restart action requires confirmation,
  replaces the in-memory and local draft with a fresh v4 graph, and clears
  undo/redo plus queued, unsaved measurement audits.

## Geometry invariants

- A physical wall is stored once. An inferred orthogonal close absorbs a
  collinear continuation into the last measured wall instead of storing a
  butt joint. Two new walls started from a closed-room corner close against
  the existing boundary when the second wall lands on an adjacent wall and
  completes a face with the start edge; axis-aligning to a distant corner
  without hitting an existing wall still does not infer extra closing walls.
  Loading a saved draft also folds remaining collinear degree-2
  splices into one wall. Deleting a wall that opens a single closed room
  restores the remaining loop as the active chain and offers the missing-edge
  close when the dangling ends still determine it. Confirming a closed room
  automatically enters the same reset-cursor / wall-drop state as tapping
  重置光标. Resetting the cursor onto
  either dangling vertex resumes that same open chain instead of starting a
  new room from the existing wall. Dragging back along that
  restored last wall shortens it instead of reporting overlap with the
  measured wall. Shared-wall faces and room boundaries are
  derived from wall direction, thickness, and each space's ordered `wallIds`.
  `confirmClosure`, `deleteWall`, and closed-wall splits write those `wallIds`
  by syncing closed spaces from half-edge faces (`extractFaces` /
  `syncClosedSpacesFromFaces`). The transaction then requires the saved spaces
  to equal the extracted faces; a mismatch rejects the operation. Graph nodes
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
- A T-branch started on a closed exterior wall middle keeps one topology node
  and physical wall. Inner/outer start selects the near/far point on the source
  wall boundary and the corresponding first-wall start inset; it does not
  select opposite local measurement faces for the new branch. The first branch
  wall and every continuation use the graph-side working face and inherit the
  physical-body side fixed by that first wall. Neither turn direction nor the
  source-space centroid may re-evaluate that side.   Orthogonal gesture input is
  stored on the internal graph, while the preview outline, orange/red path,
  live-dimension endpoints, and green cursor remain coincident on one continuous
  path. Straight-mode vertex or closure snaps may change at most one axis; they
  must not copy an off-axis vertex onto the orange preview. The wall-drag lens
  reports the actual snap type. Adjacent working faces meet at their line intersection, so the previous
  red endpoint equals the following red start and a turn cannot shift either by
  one wall thickness. This display projection does not alter graph centreline
  or closure topology.
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
  straight mode likewise keeps the last wall axis-aligned; `confirmClosure`
  adds a short orthogonal `closure-bridge` instead of yanking that wall onto an
  off-axis topology corner (which would leave a diagonal seam in the shared
  wall body).
  Vertex continuations and shared internal-wall partitions retain their
  boundary closure rules.

## Verification

Use focused wall-graph, renderer, dimension, persistence, and BLE tests for
changes to this contract. Topology writes through `confirmClosure`,
`deleteWall`, and closed-wall `commitPreviewLength` must keep closed `spaces`
aligned with extracted half-edge faces;
`test/survey-topology-face-shadow-matrix.test.js` and
`test/survey-kernel-invariants.test.js` are the catalog and invariant gates.
Real-device or WeChat DevTools evidence is required
when the change involves native Canvas, BLE, or host UI behavior.
The user-supplied exterior-T measurement screenshots are the behavior reference
for inner/outer chains. The H5 outer-start right-preview, right-continuation,
and left-continuation replays verify body side, red-line face, corner continuity,
and cursor placement; automated regressions also require adjacent red-line
endpoints to be identical.

Chinese module overview: [README.md](./README.md)
