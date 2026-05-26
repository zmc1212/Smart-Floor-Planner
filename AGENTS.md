# Codex Project Instructions

## Git Commit Messages

When Codex is asked to create a git commit in this repository, it must use a Conventional Commit style subject.

Required workflow:

1. Use one of these prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, or `test:`.
2. Write a concise English subject after the prefix.
3. Use imperative or action-oriented phrasing.
4. Make the subject describe only the changes included in the commit. Do not mention unrelated dirty worktree changes.
5. If the staged changes span multiple unrelated purposes, pause and ask whether to split the commit instead of inventing a broad message.

## Backend Operation Feedback

All user-visible backend operations triggered by an admin action must show a unified success or failure notification through the shared operation feedback UI.

- Do not add raw `alert()` calls as the normal feedback mechanism.
- Dangerous operations may keep a native confirmation prompt, but the confirmed result must still show a success or failure notification.
- Detail dialogs and flows that close after confirmation must still show the result notification after the action completes.
- Silent polling and automatic background sync tasks do not need toast-style notifications unless they were explicitly triggered by the user.

## Admin UI Component Library

The `admin` frontend must use the shared shadcn/ui component system.

- Use Radix as the shared primitive layer; do not introduce Base UI for admin UI primitives.
- Put reusable controls in `admin/src/components/ui/*` before using them across business pages.
- Business pages should prefer shared `Button`, `Input`, `Textarea`, `Select`, `Table`, `Dialog`, `Sheet`, `AlertDialog`, `Badge`, `Card`, `Tabs`, `DropdownMenu`, `Separator`, and `Skeleton` components.
- Do not use raw `alert()` as normal admin feedback; user-visible admin operation results must continue to use `operation-feedback`.
- Avoid broad hard-coded colors and arbitrary radii in business pages. Prefer Tailwind/shadcn semantic tokens such as `background`, `card`, `muted`, `border`, `primary`, and `destructive`.
- If a special visual pattern is needed, first decide whether it should become a shared component or variant.

## Chinese Documentation Sync

Maintain `AGENTS.zh-CN.md` as the Chinese companion to this file. Whenever project instructions, backend feedback rules, or the Mini Program Editor measurement inventory are changed, update `AGENTS.zh-CN.md` in the same task and keep section names, numbering, file paths, and behavioral notes aligned.

Maintain paired project documents the same way. In particular, when `docs/admin-system-modules.md` changes, update `docs/admin-system-modules.zh-CN.md` in the same task.

## Mini Program Editor Measurement Feature Inventory

When changing the measurement experience under `miniprogram/pages/editor/editor.*`, first identify which completed modules below are affected and tell the user explicitly. Keep this inventory up to date whenever a measurement feature is added, removed, or behaviorally changed.

New surveying prototype note:

- The new surveying workspace starts in `miniprogram/pages/surveying-editor/` and is documented under `docs/surveying-module/`. It is a parallel prototype shell, not a replacement for `miniprogram/pages/editor/`.
- Business entry points that expose the prototype must keep an explicit dual choice: `旧版测量` continues to enter `miniprogram/pages/editor/editor`, while `新版测绘体验` enters `miniprogram/pages/surveying-editor/surveying-editor`.
- During the prototype phases, `surveying-editor` must not write formal floor plan data, overwrite legacy drafts, submit measurement audit logs, or bypass the existing downstream compatibility flow.
- Adding or changing the prototype entry does not by itself change the completed legacy measurement modules below. If shared BLE, formal saving, export/report, 3D, measurement logs, or `editor.*` are touched, identify and update the affected completed modules.

Primary files:

- Page coordinator: `miniprogram/pages/editor/editor.js`, `editor.wxml`, `editor.json`, `editor.wxss`.
- Measurement UI components: `miniprogram/components/measure-modal`, `angle-measure`, `opening-measure`, `guided-banner`, `ble-connector`, `bottom-bar`.
- Canvas/property components: `miniprogram/components/canvas`, `miniprogram/components/properties`.
- Geometry and device helpers: `miniprogram/utils/openingGeometry.js`, `wholeHomeGeometry.js`, `bluetooth.js`, `util.js`, `exportService.js`.
- Measurement log backend: `admin/src/app/api/measurements/route.ts`, `admin/src/models/Measurement.ts`.

Completed measurement modules:

1. Guided measurement restore/startup: `editor.onShow` restores legacy room layouts and v2 whole-home layouts, including `measurementMode`, `homeOutline`, `partitions`, `guidedMode`, `currentGuidedRoomId`, `measurePoints`, `guidedEdgeIndex`, `pendingDirection`, and opens either the measurement prompt or BLE connector depending on device state.
2. BLE connection flow: `ble-connector` supports remembered-device auto connect and new-device search; `editor._bindBluetoothCallbacks` restores measurement/connect/disconnect callbacks; `bottom-bar` exposes reconnect while connected.
3. Laser command lifecycle: measurement uses `ATK001#` to open/trigger the device and falls back to `ATD001#` after timeout; `bluetooth.clearBuffer()` is used before live reads; duplicate short-interval readings are filtered in `editor.onBluetoothMeasure`.
4. Layer-height measurement: in guided mode, `guidedEdgeIndex === -1` means the first reading is height. Room mode saves it to `room.height3D`; whole-home mode saves it as the full-home height and `homeOutline.height3D`; both report measurement type `height` before wall measurement begins.
5. Straight wall measurement: `measure-modal` auto-recommends the next direction from `pendingDirection` or the previous direction, keeps manual direction choices (`E`, `S`, `W`, `N`) collapsed behind an override, and can still expose angled measurement after enough edges. `editor.onBluetoothMeasure` converts meters to internal geometry units with `meters * 10`, appends to `measurePoints`, updates either the room polygon or `homeOutline` preview, sets `canFinishPolygon`, reports type `length`, and refits the canvas.
6. Irregular/angled wall measurement: after enough edges, `measure-modal` can start `angle-measure`. The angle flow temporarily owns the BLE callback, measures wall A/B/diagonal, calculates the angle with `util.calculateAngle`, appends the computed edge to the active room or whole-home outline, and reports type `angle`.
7. Polygon finish and remeasure: `guided-banner` shows the recommended next measurement step and can finish the measured outline when `canFinishPolygon` is true. Room mode closes the room polygon. Whole-home mode requires the final point to close within `0.20m`, snaps the outline closed, saves `homeOutline`, generates initial `rooms`, and switches to partition/editing. `onStartRemeasure` resets only the active room or the whole-home skeleton depending on `measurementMode`.
8. Canvas measurement visualization: `floor-canvas` renders measured polygons, whole-home outlines, interior partition lines, the active/latest measured edge, blinking measurement state, dashed close-back preview, next-direction arrows, dimension labels, area labels, pan/zoom, room drag, edge hit-testing, and fit-to-view.
9. Manual room, shape, and partition support: the toolbar can insert preset shapes, manually drawn rooms, and whole-home interior partition lines; room width/height edits in `properties` use the same internal unit convention (`meters * 10`).
10. Door/window wall selection: in `DOOR` or `WINDOW` mode, the canvas finds the nearest wall through `openingGeometry.findNearestWall`, restricted to the current guided room when present. In whole-home mode, door/window placement targets generated rooms after the outline is closed. The canvas emits `openingwallselect` with wall, point, offset, and reference direction.
11. Door/window manual placement fallback: if BLE is not connected, `editor.addManualOpening` places a default-width opening at the tapped wall point with `source: 'manual'`, so the user can add it first and measure later.
12. Door/window precise BLE measurement: `opening-measure` temporarily owns the BLE callback, measures offset from the selected wall start/end plus opening width, validates offset + width against wall length, shows a wall preview, and returns values to `editor.onOpeningMeasureConfirm`.
13. Door/window geometry persistence: `openingGeometry.buildOpeningFromMeasurement` stores opening id, type, local x/y, wall snapshot, reference side, measured offset, center offset, width, default height, source, angle/rotation, and timestamp. It supports both rectangular and polygon walls.
14. Door/window management: `properties` lists openings, supports hover/touch highlight, width/height edits, delete, and "remeasure" which reopens the BLE opening measurement flow for the existing opening id.
15. Measurement audit logging: `editor.reportMeasurement` posts BLE readings to `/measurements` with floor plan, room, device, value, unit, type, direction, source, metadata, and timestamp. Whole-home readings add metadata such as `measurementMode`, `stage`, `homeOutlineId`, or `partitionId`. The backend stores tenant-scoped `length`, `height`, `angle`, `opening_offset`, and `opening_width` records.
16. Draft/cloud persistence: `onSaveDraft` and `saveToCloudInternal('draft')` persist legacy room drafts and v2 whole-home drafts with `version`, `measurementMode`, `rooms`, `homeOutline`, `partitions`, and draft state (`stage`, `measurePoints`, `guidedEdgeIndex`, `currentGuidedRoomId`, `pendingDirection`, `lastMeasuredDirection`, `activePartitionId`). Completed saves sync the full measured layout.
17. Export/report integration: `exportService.generateDXF` accepts legacy room arrays and v2 layout objects, exporting whole-home outer walls, interior partitions, room walls, and openings on CAD layers. Technical/report flows consume measured rooms, polygons, openings, `homeOutline`, and `partitions`.
18. 3D preview integration: `editor` can switch to a Three.js preview using measured room dimensions, polygons/openings, and `height3D`; whole-home mode falls back to generated rooms from `homeOutline` and `partitions`.
19. Whole-home skeleton measurement entry: `lead-detail` prioritizes "start/continue whole-home measurement", creates or upgrades floor plans to v2 `measurementMode: 'whole_home'`, and treats room cards as generated/editable results rather than the primary measurement entry.

Maintenance notes:

- Internal geometry convention is `1 meter = 10 units`; UI inputs/readings in meters are multiplied by 10 before saving to room/opening geometry, and labels divide by 10.
- Whole-home layouts must preserve `layoutData.rooms` for downstream compatibility and store full-home data in `layoutData.homeOutline` and `layoutData.partitions`.
- `angle-measure` and `opening-measure` must restore the normal BLE measurement callback when they close or detach.
- Do not let door/window placement bypass `openingGeometry`; it centralizes wall projection, validation, serialization, and angle handling.
- `editor.js` currently contains duplicate object-literal method names for `onBluetoothDisconnect` and `onEdgeSelect`; JavaScript keeps the later definition. If editing either flow, reconcile the duplicate definitions instead of assuming both execute.
- After changing measurement behavior, update this inventory and mention the affected completed modules in the response to the user.
