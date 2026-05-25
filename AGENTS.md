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

## Chinese Documentation Sync

Maintain `AGENTS.zh-CN.md` as the Chinese companion to this file. Whenever project instructions, backend feedback rules, or the Mini Program Editor measurement inventory are changed, update `AGENTS.zh-CN.md` in the same task and keep section names, numbering, file paths, and behavioral notes aligned.

Maintain paired project documents the same way. In particular, when `docs/admin-system-modules.md` changes, update `docs/admin-system-modules.zh-CN.md` in the same task.

## Mini Program Editor Measurement Feature Inventory

When changing the measurement experience under `miniprogram/pages/editor/editor.*`, first identify which completed modules below are affected and tell the user explicitly. Keep this inventory up to date whenever a measurement feature is added, removed, or behaviorally changed.

Primary files:

- Page coordinator: `miniprogram/pages/editor/editor.js`, `editor.wxml`, `editor.json`, `editor.wxss`.
- Measurement UI components: `miniprogram/components/measure-modal`, `angle-measure`, `opening-measure`, `guided-banner`, `ble-connector`, `bottom-bar`.
- Canvas/property components: `miniprogram/components/canvas`, `miniprogram/components/properties`.
- Geometry and device helpers: `miniprogram/utils/openingGeometry.js`, `bluetooth.js`, `util.js`, `exportService.js`.
- Measurement log backend: `admin/src/app/api/measurements/route.ts`, `admin/src/models/Measurement.ts`.

Completed measurement modules:

1. Guided room measurement restore/startup: `editor.onShow` restores floor plan layout data and draft state, tracks `guidedMode`, `currentGuidedRoomId`, `measurePoints`, `guidedEdgeIndex`, `pendingDirection`, and opens either the measurement prompt or BLE connector depending on device state.
2. BLE connection flow: `ble-connector` supports remembered-device auto connect and new-device search; `editor._bindBluetoothCallbacks` restores measurement/connect/disconnect callbacks; `bottom-bar` exposes reconnect while connected.
3. Laser command lifecycle: measurement uses `ATK001#` to open/trigger the device and falls back to `ATD001#` after timeout; `bluetooth.clearBuffer()` is used before live reads; duplicate short-interval readings are filtered in `editor.onBluetoothMeasure`.
4. Layer-height measurement: in guided mode, `guidedEdgeIndex === -1` means the first reading is room height. The result is saved to `room.height3D`, reported as measurement type `height`, then the flow advances to the first wall direction.
5. Straight wall measurement: `measure-modal` offers direction choices (`E`, `S`, `W`, `N`) based on the previous direction. `editor.onBluetoothMeasure` converts meters to internal geometry units with `meters * 10`, appends to `measurePoints`, updates the room polygon bounding box, sets `canFinishPolygon`, reports type `length`, and refits the canvas.
6. Irregular/angled wall measurement: after enough edges, `measure-modal` can start `angle-measure`. The angle flow temporarily owns the BLE callback, measures wall A/B/diagonal, calculates the angle with `util.calculateAngle`, appends the computed edge, and reports type `angle`.
7. Polygon finish and remeasure: `guided-banner` can finish the measured outline when `canFinishPolygon` is true. `editor.onFinishPolygon` normalizes points, closes the polygon, marks the room `measured: true`, exits guided mode, and keeps the measured room selected. `onStartRemeasure` resets the current guided room without wiping other rooms.
8. Canvas measurement visualization: `floor-canvas` renders measured polygons, the active/latest measured edge, blinking measurement state, dashed close-back preview, next-direction arrows, dimension labels, area labels, pan/zoom, room drag, edge hit-testing, and fit-to-view.
9. Manual room and shape support: the toolbar can insert preset shapes and manually drawn rooms; room width/height edits in `properties` use the same internal unit convention (`meters * 10`).
10. Door/window wall selection: in `DOOR` or `WINDOW` mode, the canvas finds the nearest wall through `openingGeometry.findNearestWall`, restricted to the current guided room when present, and emits `openingwallselect` with wall, point, offset, and reference direction.
11. Door/window manual placement fallback: if BLE is not connected, `editor.addManualOpening` places a default-width opening at the tapped wall point with `source: 'manual'`, so the user can add it first and measure later.
12. Door/window precise BLE measurement: `opening-measure` temporarily owns the BLE callback, measures offset from the selected wall start/end plus opening width, validates offset + width against wall length, shows a wall preview, and returns values to `editor.onOpeningMeasureConfirm`.
13. Door/window geometry persistence: `openingGeometry.buildOpeningFromMeasurement` stores opening id, type, local x/y, wall snapshot, reference side, measured offset, center offset, width, default height, source, angle/rotation, and timestamp. It supports both rectangular and polygon walls.
14. Door/window management: `properties` lists openings, supports hover/touch highlight, width/height edits, delete, and "remeasure" which reopens the BLE opening measurement flow for the existing opening id.
15. Measurement audit logging: `editor.reportMeasurement` posts BLE readings to `/measurements` with floor plan, room, device, value, unit, type, direction, source, metadata, and timestamp. The backend stores tenant-scoped `length`, `height`, `angle`, `opening_offset`, and `opening_width` records.
16. Draft/cloud persistence: `onSaveDraft` and `saveToCloudInternal('draft')` persist rooms plus draft state (`measurePoints`, `guidedEdgeIndex`, `currentGuidedRoomId`, `pendingDirection`, `lastMeasuredDirection`); completed saves sync the full measured layout.
17. Export/report integration: `exportService.generateDXF` exports walls and openings on separate layers, and technical/report flows consume measured rooms, polygons, and openings.
18. 3D preview integration: `editor` can switch to a Three.js preview using measured room dimensions, polygons/openings, and `height3D`.

Maintenance notes:

- Internal geometry convention is `1 meter = 10 units`; UI inputs/readings in meters are multiplied by 10 before saving to room/opening geometry, and labels divide by 10.
- `angle-measure` and `opening-measure` must restore the normal BLE measurement callback when they close or detach.
- Do not let door/window placement bypass `openingGeometry`; it centralizes wall projection, validation, serialization, and angle handling.
- `editor.js` currently contains duplicate object-literal method names for `onBluetoothDisconnect` and `onEdgeSelect`; JavaScript keeps the later definition. If editing either flow, reconcile the duplicate definitions instead of assuming both execute.
- After changing measurement behavior, update this inventory and mention the affected completed modules in the response to the user.
