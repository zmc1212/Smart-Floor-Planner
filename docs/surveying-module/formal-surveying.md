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
- Every entry carries `leadId` and/or `floorPlanId`.
- Admin viewers, DXF, 3D, AI, and Mini Program read models derive from the v4
  graph through adapters; they do not maintain a second editable geometry.
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
  It writes AutoCAD 2007+ DXF in millimetres, with wall, opening, dimension,
  space, and floor-title layers. Floors are placed side by side while retaining
  each floor's internal coordinates; no customer data or project title block is
  exported.
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
  butt joint. Loading a saved draft also folds remaining collinear degree-2
  splices into one wall. Deleting a wall that opens a single closed room
  restores the remaining loop as the active chain and offers the missing-edge
  close when the dangling ends still determine it. Resetting the cursor onto
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
  When the final cursor hits a source wall's visible outer face, the close must
  retain that physical outer coordinate and bridge to the topology corner rather
  than silently projecting it to the centre line.
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
