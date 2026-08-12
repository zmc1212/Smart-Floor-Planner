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
| `pages/ai-design/ai-design` | `design-references/ai-design/ai-design-customer-project-switcher-v3/ai-design-customer-workbench-home-v2.png` | Customer-project drawer retains its approved composition while non-result cards use the labeled PNG project-folio guide instead of raw wall geometry; `needs_survey` alone keeps the simplified live plan. Hero fallback restores the approved `generated-hero-bleed-v2.png`; real full-plan results remain the first-priority carousel. Static source/layout assertions pass; native-capsule DevTools capture remains pending because the existing window exposes no automation endpoint. | Yes | 2026-08-12 |
| `packages/ai-workflow/create/ai-design-create` | `design-references/all-pages-ip-v3/14-ai-design-create-v3.png` | Existing restoration; HTML evidence is optional historical evidence | Yes | 2026-08-11 |
| `packages/ai-workflow/result/ai-design-result` | `design-references/all-pages-ip-v3/15-ai-design-result-v3.png` | Existing restoration; HTML evidence is optional historical evidence | Yes | 2026-08-11 |
| `packages/ai-workflow/history/ai-design-history` | `design-references/all-pages-ip-v3/16-ai-design-history-v3.png` | Existing restoration; HTML evidence is optional historical evidence | Yes | 2026-08-11 |
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/runtime-live-dimension-reference-20260812.jpg` | Existing Canvas restoration; closed-room outer-edge snaps retain wall-body alignment while cursor, preview, and crosshair use the dragged black working line, preventing parallel-line separation. Focused source/state assertions pass; verify in WeChat DevTools and on device where required. | Yes | 2026-08-12 |
