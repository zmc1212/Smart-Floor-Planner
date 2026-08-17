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

- A physical wall is stored once. Shared-wall faces and room boundaries are
  derived from wall direction, thickness, and each space's ordered `wallIds`.
- Closed-space fill and net area use derived inner wall faces, not topology-node
  polygon area or a bounding rectangle.
- Dimensions are read models. They must not be written into `surveyGraph` or
  alter the graph's topology.
- Consumers must preserve wall openings, shared-wall thickness, closure rules,
  deletion/rejoin behavior, and the v4 schema.
- A T-branch started on a closed exterior wall middle keeps one topology node
  and physical wall. The first inner-start working line uses the inner graph
  face, while the first outer-start working line uses the derived physical
  outer face; those first readings are one wall thickness apart. A turn must
  not mechanically keep the next wall's local outer face because its rotated
  normal would move the cursor by one wall thickness. Each following segment
  instead selects the face passing through the current green cursor, forming
  one continuous working path. Orthogonal gesture input is stored on the
  internal graph, while the preview outline, orange/red path, live-dimension
  endpoints, and green cursor remain coincident on that path. Confirming the
  first branch wall separately
  fixes the wall-local side used by the physical body, and every later
  left/right preview and committed turn inherits that body side so the
  confirmed first wall cannot reflect. Adjacent working faces meet at
  their line intersection, keeping the red corner continuous. This display
  projection does not alter graph centreline or closure topology.
  From the second branch wall onward, a turn may join the rendered wall solids
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
changes to this contract. Real-device or WeChat DevTools evidence is required
when the change involves native Canvas, BLE, or host UI behavior.
The user-supplied exterior-T measurement screenshots are the behavior reference
for inner/outer chains. The H5 outer-start right-preview, right-continuation,
and left-continuation replays verify body side, red-line face, corner continuity,
and cursor placement; automated regressions also require adjacent red-line
endpoints to be identical.

Chinese module overview: [README.md](./README.md)
