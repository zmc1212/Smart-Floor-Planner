# Visual Restoration Execution Checklist

## Current policy

HTML-first comparison prototypes, pixel-difference heatmaps, and similarity
scores are temporarily suspended as mandatory gates. They are optional tools
only when the user explicitly requests them or when they materially help
diagnose a concrete visual mismatch. They do not block production UI work or
create a second implementation-authorization step.

This checklist still applies to design-to-code restoration and substantial
visual corrections. Behavior-only changes that preserve the UI do not require
this checklist.

## Required restoration checks

- [ ] Identify one approved design source, target route/surface, viewport, and
  relevant host chrome before editing.
- [ ] Inspect the current restored UI, available visual-QA evidence, and the
  relevant module/design documentation.
- [ ] If the source is absent, ambiguous, or conflicts with another approved
  source, pause and ask the user to choose the authority.
- [ ] Map each key artwork, illustration, icon, and texture to a supplied
  standalone source asset or approved production asset.
- [ ] Do not slice, tile, repaint, or otherwise reuse pixels from a reference
  screenshot, composite design frame, or browser capture as product artwork.
- [ ] Preserve existing markup, styles, assets, and visual hierarchy for
  behavior/API work unless the user authorizes a visual change.
- [ ] Verify the rendered production route at the applicable viewport after
  implementation. For Mini Program pages, follow the existing WeChat DevTools
  route and host-window capture discipline; use a real device when native
  Canvas cannot be captured.
- [ ] Update the English and Chinese design-restoration ledgers with the latest
  design source, visual-QA evidence/status, and production-restoration status.

## Optional visual investigation

When requested, an independent HTML prototype, browser capture, overlay,
heatmap, regional score, and evidence ledger may be created under
`design-references/html-prototypes/<surface>/`. Keep only the current useful
evidence set when that work concludes; delete superseded captures, failed
candidates, duplicate downloads, temporary crops, and interpreter caches.

Optional comparison evidence may inform implementation but never replaces the
approved design source, route-level visual verification, or explicit user
authorization to implement a design.
