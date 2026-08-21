# Surveying Cursor Reticle Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Green Fig.1 reticle on canvas + matching dock icons for reset and wall-drop.

**Architecture:** Shared canvas glyph drawer; static PNG for cover-view dock; no state-machine changes.

**Tech Stack:** Mini Program canvas 2d, WXML cover-image, Pillow for PNG, Node test suite.

---

### Task 1: Shared glyph drawer

- [x] Add `drawCursorGlyph(ctx, point, scale?)` in `surveyCanvasRenderer.js`
- [x] Use it from `drawCursor` and `drawDraggingCursor` (`showCursor` path)
- [x] Keep green `#22c55e` / fill `rgba(34, 197, 94, 0.16)` / gray `#c8ccd0`

### Task 2: Dock PNG + WXML

- [x] Generate `miniprogram/packages/surveying/assets/icons/cursor-reticle.png` (transparent, ≤300KB, PNG)
- [x] Point reset + drag dock `cover-image` at it
- [x] Leave `editor-rail/align.png` for the straight tool

### Task 3: Tests + docs

- [x] Update renderer / closure / packaging assertions as needed
- [x] Update EN/ZH restoration ledger + system-modules cursor note
- [x] Run focused `miniprogram` tests
