# Current topology P0 implementation and verification

Status: **Implemented** for the four P0 defects; intersection precision and holes remain **Limited**. This implements P0 from the [optimization plan](./topology-algorithm-optimization-plan.zh-CN.md), not all of phases 1–3 or P1/P2.

## Data and commit contract

- Ordinary commits classify exact intersections, share nodes, split walls in batches, migrate openings and measurement audits, synchronize Faces/Spaces and run full validation inside one isolated transaction. Inputs and undo snapshots remain unchanged; failures never publish partial results. Exact loops form rooms automatically and new dividing faces split rooms.
- T/X classification uses strict geometry, not the 350mm interaction snap tolerance. Coincident endpoints share one node. A quantized intersection is accepted only if it still lies on both original segments; otherwise UNSUPPORTED_INTERSECTION_PRECISION rejects it without bending the walls. Positive collinear overlap returns OVERLAPPING_WALLS.
- Splits retain existing opening-clearance protection, measurement-origin adjustments, wall-body sides and audit allocation, preserving opening world positions and aggregate raw readings. Confirming retraction of a noded outer-face overrun tail transfers its reading to the preceding segment instead of creating a zero-length wall.
- Space.wallIds must be unique, ordered, continuous and closed without repeated interior vertices. Reversal and cyclic rotation are valid; arbitrary reordering returns BROKEN_SPACE_CYCLE. Validation and Canvas/area/DXF/3D/AI share the boundary parser.
- A separate loop inside another loop returns UNSUPPORTED_NESTED_SPACE: a 6m × 6m outer loop plus a 1m × 1m inner loop no longer reports 37 square metres. Shared-wall and disjoint rooms remain supported. Hole and nested-space semantics are not implemented.

## Near closure, persistence and restoration

A near closure requiring movement or adjustment retains the previous valid wall graph and stores the reading in optional session.pendingMeasuredClosure = { lengthMm, inputSource }. It retains the wallPreview/awaitingLength preview and existing closure action. Confirmation replays the reading and closes within one transaction; failure retains the original preview. Cancel, new preview, object selection, wall snapping and deletion clear the intent. The autosave fingerprint includes it, JSON restoration keeps it confirmable, and completion rejects it with PENDING_MEASURED_CLOSURE.

Local persistence, cloud draft/completed writes and restoration run full validation; quick remains interaction feedback only. Restoration validates before repair, retains rejected original storage and writes diagnostics to a recovery record (original key plus _recovery). An empty fallback cannot overwrite that original; valid user-created replacement content can still be saved. POST /api/floorplans and PUT /api/floorplans/[id] validate before database writes and preview generation without repairing submissions. Invalid graphs retain the 422 validation.mode/errors/stats response; invalid envelopes remain 400. Routes, permissions and tenant boundaries are unchanged. FloorPlan.layoutData still contains only version: 4, measurementMode: surveying and surveyGraph.

## Verification and limitations

New survey-topology-p0.test.js and surveying-editor-topology-p0.test.js cover rotated, mirrored and translated T/X/diagonal crossings, unique junctions, audit conservation, idempotence, opening migration/conflicts, an independent area oracle, invalid rings, atomic rejection, persistence/restoration and near-closure confirmation. Server tests reject unsplit T/X, overlap, unordered and nested boundaries for both draft and completed writes. Existing closure matrices, read models and frozen operation-body comparisons remain active. Frozen commits explicitly compose the new P0 noding postcondition; overrun-tail comparisons allow only the verified audit-preserving retraction difference.

The Admin runtime mirror contains 81 files. Behavior and dependency snapshots reflect the intentional closure changes; architecture still requires acyclic dependencies and read-only models. The 512-wall/240-space benchmark passes (local full validation approximately 27ms median, 31ms p95); this is not a low-end device performance guarantee.

The visual source is the existing surveying-editor row in both restoration ledgers. Preview and closure conditions reuse the approved UI; WXML, styles and assets are unchanged. Automated state tests pass; manual 390x844 and tall-device runtime screenshots remain pending from the user. WeChat DevTools was not automated.

P1/P2 remain pending: centerOffsetMm fingerprint coverage, general malformed-element protection, concave-room wall sides, remeasurement budgets, opening occupancy, complete-plan policy, stable room inheritance, revision conflicts and device budgets.

## Delivery checks

| Check | Result |
| --- | --- |
| New P0 geometry and editor behavior | 35/35 pass |
| Existing surveying regression run | 1180/1180 pass (including the added case in the final full-suite run) |
| H5 tests / build | 55/55 pass / pass |
| Admin formal writes / read-model consumers | 10/10 pass / 39/39 pass |
| ESLint for changed Admin files | Pass |
| Behavior snapshot / dependency audit / runtime mirror | Pass (81 files) |
| Performance thresholds / git diff --check | Pass / pass |

Final full-suite run: 1,696 tests, 1,683 passed and 13 failed. Existing failures outside this surveying change include: account pages, API environment selection, conversion controls, calendar dates, typography floors, device workbench, main/business package size and route ownership, referral service, identity guides and V3 asset checks. Their files are unchanged here; the full suite is not reported as passing.
