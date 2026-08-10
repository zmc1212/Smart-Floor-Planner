# Legacy ZHouse APK Reference and Surveying Algorithm Topics

> This is the English mirror of [legacy-zhouse-apk-reference.zh-CN.md](./legacy-zhouse-apk-reference.zh-CN.md). It preserves evidence from the legacy APK and algorithm-topic decisions for future comparison. It is not legacy source code and does not alter the formal surveying contract.

## Reference package and analysis boundary

- Reference file: `com.zbj.zhouse_26.7.16.apk` at the repository root. It is local-analysis material and is Git-ignored.
- Package: `com.zbj.zhouse`; version `26.7.16`; `versionCode` `440`.
- SHA-256: `F3FAB584E8849A071B2C1D7D57A8AAAC7E5891D53F56933FF0E5434292C29AB1`.
- Completed analysis is static only: manifest, assets, Unity metadata, and readable strings were inspected; the APK was not installed or executed.
- Embedded endpoints, credentials, and third-party configuration must not be adopted as current production configuration. Audit and rotate any still-controlled credentials separately.

The app is a Unity IL2CPP build with an additionally protected Android shell. Original C# source, comments, project settings, and server code cannot be restored one-to-one. Assembly/type/member names, configuration, resources, events, call relationships, and many native-method pseudocode paths remain recoverable. The legacy APK is therefore a **behavioural and algorithmic reference**, not a data-model migration source.

## Identified surveying capability

Visible business assemblies include `ZhiBenJia.ZHouse.Unity`, `Model`, `Model.Draw`, `Model.House3D`, `Model.Block`, `Algorithm`, `Data`, `Data.HouseJson`, and `Mobile`. Relevant names include `House2DAlgorithm`, `HouseWall2D`, `HouseWallLine`, `OutLinePoints`, `Rooms`, `DrawingCursor`, `DrawHouseLines`, `DimensionLines`, `AddWall`, `EditLine`, `AlignPoint`, `CreatePoly`, `CornerWindowToPoly`, `AddWindow`, undo, and redo events.

The package also retains 96 two-dimensional component definitions in `assets/Template/Config.json` and Leica BLE/Wi-Fi rangefinder command definitions in `assets/leica_commands.json`.

## Current Mini Program boundary

Use the legacy app only to validate behaviour in the formal version-4 implementation:

- `miniprogram/utils/surveyWallGraph.js`
- `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`
- `miniprogram/packages/surveying/utils/surveyDimensionPlan.js`
- `miniprogram/packages/surveying/utils/surveyWallSolidPlan.js`
- `miniprogram/utils/bluetooth.js`

Formal `FloorPlan.layoutData` remains version 4 surveying data only. Do not reintroduce legacy layout copies such as `rooms`, `homeOutline`, or `partitions`. Coordinates, wall lengths/thicknesses, openings, and heights remain millimetres.

## Topic index

| ID | Topic | Status | Evidence |
| --- | --- | --- | --- |
| ALG-001 | Shared-wall closure, wall faces, and net area | Implemented; device visual QA pending | Current Mini Program screenshots 1/2; legacy APK screenshot 3; wall-graph/renderer regressions |

Create later topics as `ALG-002`, `ALG-003`, and so on. Each must retain reproduction steps, input wall graph, legacy baseline, current result, confirmed/inferred cause, scoped fix, regression tests, and verification.

## ALG-001: Shared-wall closure, wall faces, and net area

### Observed comparison

The current Mini Program sequence closes Room 1, then closes Room 2 from Room 1's lower boundary. The Room 2 physical contour extends rightward by roughly one wall thickness, and the displayed current area is consistent with `2233 × 3182 ≈ 7.1 m²`.

The legacy APK baseline uses one `200 mm` shared wall between vertically adjacent rooms. The exterior envelope remains aligned; it presents distinct outer (about `2230 mm`) and inner clear (about `1830 mm`) widths. Each room's net area is based on its own inner wall faces. The screenshots use different measured values, so comparison is geometric rather than value-for-value.

### Confirmed current facts

1. `snapCursorToWall()` describes the graph as centerline topology and projects outer-edge hits back to the source-wall topology line.
2. `findClosedSpaceForWall()` returns only the first closed space that references a wall. `buildBaseWallSegment()` uses that single space's centroid to choose the physical expansion side.
3. `calculateSpaceAreaMm2()` applies the shoelace formula directly to topology nodes from `buildSpaceBoundaryPoints()`; it does not build the space's inner-face polygon.

These facts explain the single-side shared-wall risk and the net-area risk. The exact branch producing the shown rightward step still requires the saved `surveyGraph` JSON; screenshots alone cannot prove a unique execution path.

### Target model

```text
Wall (one physical object)
  - topology centerline for connectivity, splitting, and closure
  - left and right physical faces
  - `measurementStartInsetMm` / `measurementEndInsetMm` for actual readings

Space (oriented wall chain)
  - derives which side of each wall is interior
  - derives inner-face boundary, clear dimensions, and net area
```

Render or union each physical wall once. Do not create one outward wall body per closed space. Calculate space area from the inward face boundary, not raw topology points.

### Scope and acceptance

The fix is limited to version-4 graph geometry and render read models; API, permissions, BLE audit, and persisted top-level shape remain unchanged. Regression coverage must include vertically adjacent 200 mm-wall rectangles, one shared physical wall, an aligned exterior envelope, independent net areas, separate inner/outer dimension bands, correct measurement insets, and stability after delete, re-snap, remeasure, split, and re-close.

### Implementation and verification (2026-08-10)

- `surveyWallGraph.js` now derives wall faces from each closed space's oriented wall chain. One physical `wall` remains authoritative; each adjacent space selects the face toward its own interior, and adjacent face lines are intersected to form the inner-surface polygon. A topology bridge fully consumed by measurement insets is excluded from the clear boundary.
- `calculateSpaceAreaMm2(draft, spaceId)`, room fills, and labels use that polygon. `buildSpaceDimensionPlan()` exposes read-only inner/outer boundaries, envelope dimensions, net area, and wall-thickness segments without writing them to `surveyGraph`.
- The aligned `2230 × 3182 mm` adjacent-room regression references the shared wall from both spaces but emits it once. Both net areas are `7,095,860 mm²`; the second room's raw topology-envelope area of `7,541,860 mm²` is not used as net area, and both exterior side faces remain collinear without a `200 mm` step.
- Measurement insets, topology nodes, BLE/manual readings, deletion, re-snap, remeasure, split, and re-close behavior are unchanged. The focused renderer, cursor, dimension, and wall-solid suites pass `79/79`; WeChat DevTools/device visual QA remains pending.

### Evidence to attach next time

Provide the reproduction steps; complete before/after `surveyGraph` JSON; wall thickness, measurement side, readings and order; current and legacy screenshots; and the expected exterior, inner dimensions, and area. With explicit user approval, later isolated dynamic analysis may map legacy `House2DAlgorithm` methods for shared-wall, closure, boundary, and area behaviour. Do not sign into real accounts or reuse production credentials.

## Template for later topics

```md
## ALG-XXX: <topic>

### Symptom
### Reproduction input and steps
### Legacy APK baseline
### Current wall graph / rendering
### Cause (confirmed / inferred)
### Scoped fix
### Regression tests
### Verification result
```
