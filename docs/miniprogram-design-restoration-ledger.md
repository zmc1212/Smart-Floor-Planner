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
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/bottom-dock-v1/sub2api-20260812-073043-1.png` | Bottom cursor-dock redesign uses the approved three-state board: placed cursor retains `重置光标`; reset state keeps a crosshair as the drag origin and moves `光标拖动到墙体` into a separate helper line; dragging leaves a subdued origin marker while the existing Canvas crosshair follows the finger. The same approved upper-left lens remains visible for both bottom-control cursor placement and Canvas cursor-to-wall dragging; panning, pinch zooming, and opening movement do not show it. A released outer-edge or outer-vertex snap keeps its stationary cursor on that visible outer target while graph topology remains centerline-based. Deleting the sole wall shared by exactly two closed spaces switches the existing approved Canvas data state to one merged fill, label, permanent dimension plan, and net area. Outer-face adjacent-room merging now also clears only the obsolete wall-thickness insets at the deleted shared wall's endpoint nodes, keeping every unselected perimeter wall and its openings in place while restoring one continuous wall solid with no top/bottom gaps. For inner-face adjacent closure, the closed-wall union retains the shared wall body and redraws the selected clear boundary so its upper/lower endpoints stay visibly on the chosen room-1 inner vertices; the user-supplied `2205 x 2901mm` plus `2834 x 2901mm` state is covered, including stable lower-wall rendering after deleting the upper wall. No layout, styling, icon, or navigation treatment changed; focused rendering, shared-wall merge, outer-face gap, exterior-wall deletion, and cursor-lens state regressions pass. Existing DevTools automation endpoint is unavailable, so compile, route check, and iPhone 13 Pro `390x844` device evidence remain required. | Yes | 2026-08-12 |
