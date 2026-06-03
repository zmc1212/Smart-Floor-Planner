# Implementation Plan - Advanced Surveying Editor Features

This plan outlines the technical approach to implement outer ruler alignments, wall selection styling, vertical floating capsule menus, and lock node constraints for dimension editing in the surveying editor.

## Proposed Changes

### 1. Outer Ruler Mode (内/外双标尺对其)

#### [MODIFY] [surveyCanvasRenderer.js](file:///f:/project/floor-plan/Smart-Floor-Planner/miniprogram/utils/surveyCanvasRenderer.js)

- Update `buildWallScene` to compute the outer wall length in MM using `surveyGraph.distanceMm(geometry.outerStart, geometry.outerEnd)` and attach `outerLengthMm` and the projection offsets `outerStartAlongPx` and `outerEndPx` to the returned wall scene object.
- Modify `createDimensionOptions` to generate distinct candidates:
  - **Inner Options**: Index 0 & 2. Label = net inner length (`wall.lengthMm`), offsets = inner side, coordinates from `0` to `widthPx`.
  - **Outer Options**: Index 1 & 3. Label = outer length (`wall.outerLengthMm`), offsets = outer side, coordinates aligned to the outer wall projections (`outerStartAlongPx` to `outerEndPx` at y-offset `outerSign * thicknessPx`).
- Update `resolveDimensions` to separate candidates into `innerCandidates` and `outerCandidates` and resolve them independently, allowing both the inner and outer dimensions to be rendered simultaneously without collision.
- Refactor `drawDimension` to support custom start/end coordinates (`startX`, `endX`, `startY`, `endY`) for the extension lines, overshoot the dimension lines slightly past the extensions, and render architectural diagonal slash ticks instead of arrowheads.

---

### 2. Selected Wall Selection Styles (选中墙体样式与垂直胶囊菜单)

#### [MODIFY] [surveyCanvasRenderer.js](file:///f:/project/floor-plan/Smart-Floor-Planner/miniprogram/utils/surveyCanvasRenderer.js)

- Update `drawWallBodies` to fill selected walls with a soft red/coral fill (`rgba(239, 68, 68, 0.25)`) instead of green.
- Update `drawSelectedWallHighlight` to remove the thick green border, replacing it with a clean coral-orange centerline or a thin red boundary outline.

#### [MODIFY] [surveying-editor.wxml](file:///f:/project/floor-plan/Smart-Floor-Planner/miniprogram/pages/surveying-editor/surveying-editor.wxml)

- Re-structure the floating `wall-object-toolbar` to render vertically and map directly to the capsule design. It will contain six items:
  1. **Edit** (`edit` - pencil icon): Triggers length input and locks.
  2. **Arc** (`arc` - arc icon): Triggers curve conversion (prototype placeholder).
  3. **Split** (`split` - break icon): Triggers wall split (prototype placeholder).
  4. **Add** (`add` - plus icon): Opens quick opening addition menu.
  5. **Height** (`height` - H icon): Triggers height editing.
  6. **Delete** (`delete` - trash icon): Deletes the selected wall.

#### [MODIFY] [surveying-editor.wxss](file:///f:/project/floor-plan/Smart-Floor-Planner/miniprogram/pages/surveying-editor/surveying-editor.wxss)

- Style the `.wall-object-toolbar` as a vertical capsule: `flex-direction: column; width: 48px; height: auto; border-radius: 24px; background: #4C4C4C; padding: 8px 6px;`.
- Set up responsive layouts for the inner icons matching the custom capsule design.

---

### 3. Lock Node Constraint & Size Editing (尺寸编辑与锁边逻辑)

#### [MODIFY] [surveyWallGraph.js](file:///f:/project/floor-plan/Smart-Floor-Planner/miniprogram/utils/surveyWallGraph.js)

- Initialize `session.fixedNodeId` when entering remeasurement mode (`startRemeasure`). Default to the single shared endpoint if present; otherwise, default to the start node of the wall.
- Add and export a helper `setFixedNode(draft, nodeId)` to update `session.fixedNodeId` dynamically.
- Update `remeasureSelectedWall` to respect the `session.fixedNodeId` constraint, setting the moving end accordingly.

#### [MODIFY] [surveying-editor.js](file:///f:/project/floor-plan/Smart-Floor-Planner/miniprogram/pages/surveying-editor/surveying-editor.js)

- Intercept touch events in `onCanvasTouchStart`: if in `remeasureAwaitingInput` state, perform a hit test on the endpoints of the selected wall. If tapped within 30px, toggle the locked node by setting `session.fixedNodeId` and calling `syncFromDraft()`.

#### [MODIFY] [surveyCanvasRenderer.js](file:///f:/project/floor-plan/Smart-Floor-Planner/miniprogram/utils/surveyCanvasRenderer.js)

- Implement `drawLockHandles(ctx, scene)` to render the red locked handle (filled red circle with a closed lock icon) and the gray unlocked handle (filled gray circle with an open lock icon) on the canvas during size input.
- Call `drawLockHandles` inside the main `drawSurveyScene` method.

## Verification Plan

### Automated/Manual Verification
- Open WeChat DevTools and load the `surveying-editor` page.
- Draw a closed room outline.
- Verify that both the inner and outer dimensions are displayed at the same time, aligned to inner/outer wall faces respectively, with architectural slash marks instead of arrows.
- Select a wall and verify the soft red fill and the vertical capsule menu containing the six actions.
- Tap "Edit" (pencil icon) on the selected wall. Verify that:
  - The size input pad opens.
  - Red/gray lock icons are drawn at the endpoints on the canvas.
  - Tapping either lock handle toggles which node is fixed.
  - Modifying the size changes the length of the wall while keeping the locked node exactly fixed.
