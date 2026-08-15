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

## Geometry invariants

- A physical wall is stored once. Shared-wall faces and room boundaries are
  derived from wall direction, thickness, and each space's ordered `wallIds`.
- Closed-space fill and net area use derived inner wall faces, not topology-node
  polygon area or a bounding rectangle.
- Dimensions are read models. They must not be written into `surveyGraph` or
  alter the graph's topology.
- Consumers must preserve wall openings, shared-wall thickness, closure rules,
  deletion/rejoin behavior, and the v4 schema.

## Verification

Use focused wall-graph, renderer, dimension, persistence, and BLE tests for
changes to this contract. Real-device or WeChat DevTools evidence is required
when the change involves native Canvas, BLE, or host UI behavior.

Chinese module overview: [README.md](./README.md)
