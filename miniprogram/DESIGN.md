# Mini Program Interface Restoration Standard

This document defines how to implement and verify the native WeChat Mini
Program UI. Route-specific design sources and live business truth are recorded
in the module inventory and the current restoration ledger.

## Source precedence

1. Current code, API responses, schemas, permissions, and tests.
2. The approved route design source in
   `docs/miniprogram-design-restoration-ledger.md`.
3. Shared values in `miniprogram/design-tokens.json` and `miniprogram/app.less`.
4. Brand-IP rules in `docs/design/jiakelai-brand-ip-guidelines.md`.

A screenshot never authorizes invented data, functionality, or a second layout
contract. Before editing a visible route, identify its current design source,
real state matrix, role visibility, and safe-area assumptions.

## Current restoration workflow

- Design requests remain design-only until the user explicitly authorizes
  implementation.
- Once authorized, implement native WXML/Less/JS and packaged assets directly
  against the approved source. HTML prototypes, heatmaps, overlays, and
  similarity scores are optional investigation evidence, never approval gates.
- Reuse the global Less utilities from `styles/utilities.less` for layout
  primitives such as `flex-row`, `flex-1`, `justify-between`, and `gap-8`.
  Keep route-specific composition and visual rules in the route's own `.less`
  file; do not copy utility definitions into pages or components.
- Verify the route at iPhone 13 Pro `390x844`, including the native WeChat
  capsule and bottom safe area. Check narrow (`<=360px`) and tall devices when
  the layout contains fixed content.
- Update the route's single current row in both restoration ledgers. Replace the
  row when the source or production state changes; do not append history.

## Layout and readability

- Use normal flow, flex/grid, and scroll containers for variable content.
  Absolute positioning is reserved for documented overlays, Canvas labels, or
  artwork anchored to a stable parent.
- Fixed-content restoration groups must size from their content. Do not use
  nested `flex: 1`, `flex-grow`, `height: 100%`, or viewport-derived
  `min-height` merely to fill the screen or push later content downward. Only a
  region whose meaning genuinely expands (for example a scrollable list,
  Canvas, or documented flexible artwork stage) may absorb remaining height.
  On tall devices, extra height belongs outside a tightly related reading group;
  it must never open a viewport-dependent hole between a Hero/artwork and the
  rows, facts, or actions it introduces.
- For every fixed-content restoration, compare the approved source with both
  the `390x844` baseline and a tall-device runtime screenshot. Record an
  element-by-element vertical ledger for the panel top, headline block,
  artwork bottom, first following row, repeated-row heights, privacy/helper
  strip, primary CTA, and bottom safe area. A gap that grows only because the
  viewport is taller is a failed restoration even when nothing overlaps and
  the CTA remains visible. Keep runtime QA pending until the user's manual
  screenshot confirms this reading rhythm.
- Reserve the native capsule lane before placing titles or actions. Never center
  text through the capsule or let controls overlap it.
- Required text is native text, not image-embedded copy. Authoritative type
  floors (rpx at the `390x844` baseline):

  | Role | Minimum | Typical use |
  | --- | --- | --- |
  | Page / nav title | `32rpx` | `nav-title`, page H1 |
  | Section title | `28rpx` | Card title, round title |
  | Primary copy / action / business value / tappable chip | `24rpx` (key CTA may use `26–28rpx`) | Send, switch, scheme chip, Composer submit |
  | Secondary helper / time / meta | `22rpx` | Subtitle, prompt summary, points copy |
  | Tertiary badge | `20rpx` | On-image corner marks only (e.g. “已确认”) |
  | Forbidden | `<20rpx` | Any status, action, business value, or required explanation; no `transform: scale` to shrink readable text |

  Prefer raising helpers to `22rpx+` rather than landing on exactly `20rpx`.
  Primary actions and primary copy must not use `20rpx`.
- These typography values are accessibility floors, not restoration targets.
  High-fidelity work must measure the approved source's visible glyph height,
  hierarchy ratio, and line wrapping at the normalized viewport, then map that
  optical size to `rpx`; merely clearing the minimum is not evidence of a match.
  Do the same for icons using the visible alpha/stroke bounds rather than the
  `<image>` canvas: transparent padding, thin source strokes, or an oversized
  circle container must not make the actual glyph look one step smaller than
  the approved design. Record title, label, helper, CTA, icon-container, and
  visible-glyph sizes in the route's element ledger before handoff.
- **Known recurring failure: under-scaling typography and icons.** Treat this as
  a mandatory restoration preflight, not a page-specific exception. Before the
  first style edit, normalize the approved source to the `390x844` baseline and
  record the source-calibrated `rpx` targets for every primary text role and icon
  bound listed above. A page that merely fits, passes tests, or clears the
  accessibility floors is still unverified. Close runtime visual QA only after
  the user's manual screenshot confirms that the optical scale matches.
- Keep touch targets reachable, visibly pressed, and at least `44px` logical
  height where the platform permits. Do not use `transform: scale(...)` to hide
  a responsive or readability defect.
- Use one coherent, locally stored, license-documented icon set. Emoji and
  mixed Unicode symbols are not product icons.
- Hairline separators use a short `1px` line with half-axis scaling rather than
  a visually heavy full border.
- Native primary `button[disabled]` keeps `--action-disabled-bg` (`#A9D9B8`) and
  `--action-disabled-text` so the pill stays distinct from `--bg-page` / `#f8faf9`.
  Do not use opacity-only disabled styles: WeChat's default disabled fill is
  `#f7f7f7` and blends into the page. Override with `[disabled]` plus `!important`.

## Panel and sheet motion

- Do not introduce third-party Mini Program UI libraries (Vant, TDesign, etc.)
  for overlays or sheets. Use existing Less plus enter/exit classes.
- Bottom operation panels and picker/template sheets share one native pattern:
  - Mask: opacity `0 → 1` (~`240ms`).
  - Panel: `translateY(100%) → 0` (~`240ms`, `ease-out`).
  - Close: reverse the same transitions; finish the animation (~`260ms`) before
    clearing the `visible` flag so the panel does not snap shut.
- Centered contact/confirm dialogs (for example the shared designer WeChat
  contact card) must not use the bottom-sheet slide. Keep the same mask fade,
  but center a rounded card with opacity plus a short `translateY(24rpx) → 0`
  (~`240ms`, `ease-out`) so TabBar pages do not clip the last row.
- Drive open state with an `open` class bound to the existing `*Visible` flags;
  put `transition` on the same mask/panel nodes WeChat animates.

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
