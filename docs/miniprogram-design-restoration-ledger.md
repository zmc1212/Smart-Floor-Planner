# Mini Program Design Restoration Ledger

This file is the canonical cross-session lookup for Mini Program visual
restorations. Read it before changing visible Mini Program UI.

## Recording rules

- Use the normalized runtime route from `miniprogram/app.json` as the unique
  key and keep exactly one current row per route.
- `Latest design source` contains exactly one current approved design file. A
  newer approved source replaces the older entry instead of creating history.
- Record the design-source mapping and route-level visual-QA status. HTML
  prototypes and similarity scores are optional historical evidence only while
  the HTML-first gate is suspended.
- Set `Mini Program restored` to `Yes` only after the production WXML/WXSS/JS
  or packaged assets have actually been updated.
- Update this ledger and its Chinese mirror when a visual restoration changes.

## Current ledger

| Runtime route | Latest design source | Visual-QA status | Mini Program restored | Updated |
| --- | --- | --- | :---: | --- |
| `pages/index/index` | `design-references/all-pages-ip-v1/01-home-v2.png` | Existing restoration; route-level evidence to be refreshed on the next visual change | Yes | 2026-08-06 |
| `packages/business/settings/settings` | `design-references/account/settings-v1.png` | The approved single-row notification layout, spacing, icon, and hierarchy are unchanged. Its existing trailing status now represents all four V2 templates as fully allowed, partially allowed, rejected, disabled, unset, or temporarily unavailable; static settings and aggregate-authorization tests pass. A fresh compile, exact top-route check, and native-capsule `390x844` capture in the existing WeChat DevTools window remain pending. | Yes | 2026-08-12 |
| `pages/ai-design/ai-design` | `design-references/ai-design/ai-design-customer-project-switcher-v3/ai-design-customer-workbench-home-v2.png` | Customer-project drawer retains its approved composition while non-result cards use the labeled PNG project-folio guide instead of raw wall geometry; `needs_survey` alone keeps the simplified live plan. Hero fallback restores the approved `generated-hero-bleed-v2.png`; real full-plan results remain the first-priority carousel. Static source/layout assertions pass; native-capsule DevTools capture remains pending because the existing window exposes no automation endpoint. | Yes | 2026-08-12 |
| `packages/ai-workflow/create/ai-design-create` | `design-references/all-pages-ip-v3/14-ai-design-create-v3.png` | Existing restoration; HTML evidence is optional historical evidence | Yes | 2026-08-11 |
| `packages/ai-workflow/result/ai-design-result` | `design-references/all-pages-ip-v3/15-ai-design-result-v3.png` | Existing restoration; HTML evidence is optional historical evidence | Yes | 2026-08-11 |
| `packages/ai-workflow/history/ai-design-history` | `design-references/all-pages-ip-v3/16-ai-design-history-v3.png` | Existing restoration; HTML evidence is optional historical evidence | Yes | 2026-08-11 |
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/cursor-guide-state-reference-20260812.jpg` | The latest six-state reference board defines guide semantics: no blue dashed guide appears in the initial state or before the first wall commit; while another wall is dragged, the active marker and preview follow the pointer but the blue crosshair stays at the previous committed point and advances only after commit. Free dragging produces no orange guide. Wall, vertex, axis-alignment, and closure states render only their constrained axis/path as an orange dashed guide, and transient guides clear on release, cancellation, reset, undo/redo, or state change. The approved three-state bottom cursor dock and separate helper copy remain unchanged; panning, pinch zooming, and opening movement still do not show the lens. The upper-left lens is now a single Canvas panel, without a second native background container. When dragging the current cursor inside the Canvas, the formal Canvas remains the sole cursor/guide renderer and the transient layer supplies only that lens; it survives each formal redraw, suppresses the competing upper-left live-measurement bubble, and uses the final formal preview/display point—not the raw finger coordinate—for its centred target and X/Y label. A released outside-edge or outside-vertex snap keeps the stationary cursor on that visible target while graph topology remains centerline-based. Shared-wall deletion and inner-/outer-face adjacent-room rendering retain their previously approved behavior. Layout, cursor marker, walls, dimensions, tools, navigation, APIs, roles, the version-4 graph, and measurement audits are unchanged; focused guide and existing formal-rendering regressions pass. The existing DevTools window is confirmed to have this repository's `miniprogram` open; its log records the changed renderer/editor files, an app-service restart, and `webview page ready`. The window was not started with `autoPort`, so the top page stack and native iPhone 13 Pro `390x844` state captures remain pending; no duplicate window was opened. | Yes | 2026-08-12 |
