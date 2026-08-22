# Surveying Cursor Reticle (Green Fig.1) Design

**Date:** 2026-08-21  
**Route:** `packages/surveying/editor/surveying-editor`  
**Status:** Approved for implementation (`开始开发`)

## Goal

Replace the surveying editor’s default canvas cursor and bottom-dock cursor icons with a green reticle matching the approved Fig.1 crop: gray outer crosshair arms, green inner arms, hollow center square, four L-corner brackets, and a light green fill inside the brackets. When the dock shows「重置光标」or「光标拖动到墙体」, its icon must be the same glyph so dragging feels like lifting the cursor from the dock.

## Non-goals

- No interaction / state-machine changes (`placed` / `awaitingWallDrop` / `dragging` stay as today).
- No change to right-rail「直线」`align.png` / `align-active.png` tool icons.
- No bubble/tip copy changes on the canvas cursor.
- The drag magnifier is not the Fig.1 reticle: it keeps the prior small green `+` at the lens centre.

## Visual contract

| Element | Spec |
| --- | --- |
| Outer arms | Light gray (`#c8ccd0`), full cross extent |
| Inner arms | Product green (`#22c55e`), shorter segment through center |
| Center core | Hollow square stroke in `#22c55e` (no solid fill) |
| Corners | Four L brackets in `#22c55e` |
| Fill | `rgba(34, 197, 94, 0.16)` inside the bracket box |
| Dock | Same glyph as canvas; used for both reset and wall-drop states |
| Magnifier | Small green `+` (12px arms) at the lens centre only; never the Fig.1 reticle |

## Approach

1. Shared procedural `drawCursorGlyph` in `surveyCanvasRenderer.js` for formal canvas cursor and drag overlay cursor.
2. Packaged transparent PNG dock asset generated from the same geometry for cover-view (`cursor-reticle.png`).
3. Wire both dock `cover-image` nodes to that asset; keep ghost/origin drag behavior.

## Verification

- Focused renderer + editor chrome tests.
- Docs: surveying ledger row + system-modules cursor note (EN/ZH).
