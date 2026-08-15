# Mini Program Interface Restoration Standard

This document defines how to implement and verify the native WeChat Mini
Program UI. Route-specific design sources and live business truth are recorded
in the module inventory and the current restoration ledger.

## Source precedence

1. Current code, API responses, schemas, permissions, and tests.
2. The approved route design source in
   `docs/miniprogram-design-restoration-ledger.md`.
3. Shared values in `miniprogram/design-tokens.json` and `miniprogram/app.wxss`.
4. Brand-IP rules in `docs/design/jiakelai-brand-ip-guidelines.md`.

A screenshot never authorizes invented data, functionality, or a second layout
contract. Before editing a visible route, identify its current design source,
real state matrix, role visibility, and safe-area assumptions.

## Current restoration workflow

- Design requests remain design-only until the user explicitly authorizes
  implementation.
- Once authorized, implement native WXML/WXSS/JS and packaged assets directly
  against the approved source. HTML prototypes, heatmaps, overlays, and
  similarity scores are optional investigation evidence, never approval gates.
- Verify the route at iPhone 13 Pro `390x844`, including the native WeChat
  capsule and bottom safe area. Check narrow (`<=360px`) and tall devices when
  the layout contains fixed content.
- Update the route's single current row in both restoration ledgers. Replace the
  row when the source or production state changes; do not append history.

## Layout and readability

- Use normal flow, flex/grid, and scroll containers for variable content.
  Absolute positioning is reserved for documented overlays, Canvas labels, or
  artwork anchored to a stable parent.
- Reserve the native capsule lane before placing titles or actions. Never center
  text through the capsule or let controls overlap it.
- Primary labels, actions, body copy, and business values are at least `24rpx`;
  metadata and helper text are at least `20rpx`. Required text is native text,
  not image-embedded copy.
- Keep touch targets reachable, visibly pressed, and at least `44px` logical
  height where the platform permits. Do not use `transform: scale(...)` to hide
  a responsive or readability defect.
- Use one coherent, locally stored, license-documented icon set. Emoji and
  mixed Unicode symbols are not product icons.
- Hairline separators use a short `1px` line with half-axis scaling rather than
  a visually heavy full border.

## Native and Canvas rules

- Prefer ordinary views when they provide the required layering. Keep
  `cover-view`/`cover-image` subtrees small and use documented selector forms.
- Canvas-heavy routes must verify touch ownership, layer order, and state-specific
  redraws. A screenshot that omits the native Canvas layer is not visual proof.
- Contextual Canvas guides, cursor previews, wall geometry, and dimensions stay
  in the same coordinate system as the formal scene. Remove obsolete alternate
  WXML overlays instead of keeping hidden fallback cards.

## Formal surveying

The only measurement editor is
`packages/surveying/editor/surveying-editor`. It uses the version-4 wall graph;
the contract is [`docs/surveying-module/formal-surveying.md`](../docs/surveying-module/formal-surveying.md).
Do not restore `pages/editor/editor`, `restoreFloorPlan`, or legacy geometry
utilities.

## Delivery record

The current route row records the design source, current production-restoration
state, concise QA evidence, and any unresolved issue. Keep detailed screenshots,
metrics, and test logs in local evidence directories. Do not copy a chronological
change log into product documentation.
