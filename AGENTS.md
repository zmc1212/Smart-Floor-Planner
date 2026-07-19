# Codex Project Instructions

## Git Commit Messages

Use a Conventional Commit English subject when creating a commit: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, or `test:`. Keep it concise and action-oriented, and describe only related staged changes. Ask to split unrelated staged changes.

## Backend Operation Feedback

Every admin-triggered visible backend operation must use the shared operation feedback UI for success or failure. Do not use raw `alert()` as normal feedback. A dangerous-action confirmation may remain native, but its result still needs a notification.

## Admin UI Component Library

The `admin` frontend uses shadcn/ui with Radix primitives. Put reusable controls in `admin/src/components/ui/*`; business pages should prefer shared shadcn components and semantic Tailwind tokens. Do not introduce Base UI or broad hard-coded visual styling.

## Chinese Documentation Sync

Keep `AGENTS.zh-CN.md` synchronized with this file. When `docs/admin-system-modules.md` changes, update `docs/admin-system-modules.zh-CN.md` in the same task.

## Mini Program Formal Surveying Feature Inventory

The only formal measurement page is `miniprogram/pages/surveying-editor/surveying-editor.*`. When its behavior changes, identify the affected modules below to the user and update this inventory.

- Every measurement entry navigates to `pages/surveying-editor/surveying-editor` with `leadId` and/or `floorPlanId`; never restore `pages/editor/editor`, `restoreFloorPlan`, or a dual entry.
- Lead detail can continue its active formal plan, create a separate formal measurement that bypasses prior draft restoration, or delete the active plan; deletion must also remove its lead references and local resume pointer.
- Formal `FloorPlan.layoutData` only uses `version: 4`, `measurementMode: 'surveying'`, and `surveyGraph`. Never persist `rooms`, `homeOutline`, `partitions`, `surveyDraft`, `prototypeOnly`, or `surveying_prototype`.
- `surveying-editor` owns startup restore, BLE connection and laser lifecycle, straight/angled/remeasure walls, shared-wall closure, openings, draft/completed saves, measurement audit logging, CAD, reports, and full-plan 3D.
- A diagonal drag remains a preview until its length is confirmed or the user continues dragging from its endpoint; continuation commits that preview at its live length and starts the next wall from that endpoint. A new diagonal within 8 degrees of the preceding diagonal's forward direction snaps to that direction while retaining its dragged length; otherwise it remains free-angle. Its top `∠` value and the in-canvas label at the active corner open the existing number-pad shell for angle entry; only the latest diagonal and its preceding wall retain an in-canvas angle label. A confirmed latest diagonal may be reopened from that label only while it is unclosed and has no opening; closing the panel restores the original wall. Phone motion supplies an operator-confirmed relative angle, while the `勾股定理测量角度` entry takes three BLE side readings, validates the triangle with the cosine rule, and logs each valid reading. Confirming the angle preserves the drag side and preview length, then returns to the normal length workflow; closing the panel changes no wall geometry and stops device-motion listening.
- The 2D surveying canvas must render doors and windows as restrained CAD plan symbols across their full measured opening width: door leaves and swing arcs meet the opposite jamb, and windows use slim framed triple rails rather than a coloured centre line.
- While a space is unfinished, its current wall chain shows only inner-edge dimensions and keeps that inner edge highlighted red; preview walls use the live top reading rather than a dimension label. The inside/outside measurement edge is selectable only immediately after the first wall is committed, then remains locked for later walls. Once the space is explicitly closed, derive each dimension's outside direction from the closed-space geometry (never its stored wall side), render both inner and outer whole-wall dimensions outside the wall boundary with thin extension lines and inward-facing arrowheads. A door wall replaces its inner whole-wall value with one nearest-wall chain dimension (wall segment, door width, wall segment), while a window wall keeps whole-wall dimensions only. The room centre shows only its name, ceiling height, and area, scaled with the canvas.
- While an unfinished wall chain is edited, a selected door or window must expose an explicit action to resume measuring from that chain's last endpoint. Its details, continuation action, and opening-side value must form one responsive card wide enough to show measured `mm` values without clipping. “New room starting point” creates a separate wall chain and is not the continuation control.
- After a space closes or the cursor is reset, the bottom cursor control may be dragged to an existing vertex, any wall position, or a free canvas position to start a separate wall chain. The persistent page gesture path owns drag movement/release; while dragging, its empty circular status container stays fixed at the bottom and one dedicated lightweight canvas exclusively renders both the moving square crosshair and dashed guides without redrawing the formal survey scene or creating a duplicate overlay.
- While a wall or opening is selected, the toolbar’s collapse action, an exit from the opening component editor, and a tap on an otherwise empty canvas all clear the selection and return to the appropriate measuring state. The wall-thickness action is currently hidden from the selected-wall toolbar, whose width is driven by its visible actions, gaps, and padding.
- Tapping a door or window must select that opening before its parent wall. A native canvas `tap` emitted after the opening's `touchend` must not clear the newly selected opening or hide its toolbar.
- In the opening component editor, the `spec` panel must clear the fixed undo/reset controls so its Bluetooth measurement action remains reachable; flip and model panels keep their normal position.
- A close candidate is advisory: users may continue dragging from its endpoint, and only the explicit `合` action confirms a closure.
- Wall-graph values are millimeters. The graph adapter may derive spaces, openings, area, and heights for CAD, reports, 3D, admin, and AI consumers, but it must not persist a legacy layout copy.
- Any flow that temporarily owns the BLE callback must restore the normal callback when it closes and must log valid formal measurements. Readings captured before the first cloud save are queued and flushed only after a formal `floorPlanId` exists.
- Legacy modules 1-19 are removed historical coverage. Do not reintroduce `editor.*`, its dedicated components, or old layout utilities.
