# Mini Program Interface Restoration Standard

## 1. Purpose and Boundary

This document defines a general engineering standard for restoring approved
designs in the native WeChat Mini Program. It answers **how to implement and
verify an interface**, not **what a particular page should look like**.

It deliberately does not define brand-IP anatomy, visual metaphors, page
storytelling, route-specific screenshots, business copy, or product capability.
Keep those decisions in their owning documents:

- Brand IP, mascot, and visual-metaphor decisions:
  `docs/design/jiakelai-brand-ip-guidelines.md`.
- Route-specific visual references, live routes, data, permissions, and known
  limitations: `docs/miniprogram-system-modules.md` and
  `docs/miniprogram-system-modules.zh-CN.md`.
- Formal surveying workflow and wall-graph contract:
  `docs/surveying-module/README.md` and
  `docs/surveying-module/formal-surveying.md`.
- Reusable values and runtime primitives: `miniprogram/design-tokens.json` and
  `miniprogram/app.wxss`.

When sources conflict, current code and its real data/permission contract take
precedence. This standard governs implementation method and visual acceptance;
the route brief/reference governs the intended composition; tokens govern shared
values. A screenshot never authorizes invented functionality.

## 2. Required Inputs Before Implementation

Before editing a page, capture a short restoration brief:

| Input | Record |
| --- | --- |
| Target | Route, entry path, source files, and page type (tab, list, form, detail, editor, result, or sheet). |
| Authority | Approved reference/version, route brief, existing component/token source, and applicable specialist documents. |
| Product truth | Live data fields, role visibility, navigation, mutations, and unsupported states that must remain unchanged. |
| Viewport | Reference width/height, device, safe-area assumptions, and required narrow/tall-device checks. |
| State matrix | Loading, content, empty, error, disabled, selected, and destructive/confirmation states relevant to the page. |
| Measurements | Outer inset, columns, anchor positions, heights, gaps, typography, radii, and visible artwork bounds. |

If an item is unknown, mark it as an open decision. Do not fill a design gap
with a fake card, number, action, or AI-generated text.

### 2.1 Mandatory HTML-First Approval Gate

Every Mini Program high-fidelity restoration begins as a design-only HTML gate.
Before editing any Mini Program production file:

1. Create an independent HTML comparison prototype only under
   `design-references/html-prototypes/<surface>/`. Do not modify
   `miniprogram/`, Admin/API code, tests, production assets, or runtime module
   documentation during this gate.
2. Map every visible region to its approved design authority. When multiple
   references jointly own the screen, record which source owns each region and
   define any dynamic-data or native-host masks before scoring.
3. Apply the `impeccable` quality constraints and use the in-app Browser at the
   approved viewport, including the `390x844` Mini Program baseline, to iterate
   through screenshots and identical-scale overlays.
4. Produce an element ledger containing target and actual bounds, size,
   alignment, adjacent spacing, and a reproducible score. Keep the HTML, final
   browser capture, overlay, source map, masks/exclusions, scoring weights, and
   ledger together in the prototype directory.
5. Reach a documented composite visual similarity of at least `90%`. Do not
   substitute a flattened full-page design screenshot for real HTML structure,
   and do not raise the score by counting masked or mutually conflicting source
   regions.
6. Present the evidence and request a new, explicit approval to implement the
   Mini Program. Passing the threshold never authorizes WXML/WXSS/JS or asset
   changes by itself.

This gate is the default for future restorations even when the initial request
says “还原设计图” or otherwise sounds implementation-oriented. Only an explicit
instruction to skip the HTML gate and implement directly may bypass it. After
approval, the HTML is a measured reference—not production code—and the normal
Mini Program implementation, tests, documentation, and native DevTools/device
verification requirements still apply.

## 3. Design-to-Layout Translation

### 3.1 Measure Before Styling

- For the standard `390px` reference, use `750rpx` as the width baseline:
  `rpx = reference px × 750 / 390`.
- Scale horizontal geometry from width. Do not make vertical spacing expand or
  contract simply because a device is taller or shorter.
- Create an anchor sheet before implementation: safe-area edge, header bounds,
  title baseline, hero/card edge, first section, primary action, and fixed
  bottom boundary. Align these anchors before polishing detail.
- Measure type size, weight, line-height, baseline, wrap point, radius, and
  icon optical size separately. A screenshot is not a license to replace these
  with generic defaults.
- Measure visible artwork, not the exported transparent canvas. Fix excessive
  internal whitespace in the derivative rather than compensating with arbitrary
  CSS dimensions.

### 3.2 Choose Stable Layout Primitives

Use content-driven `flex`, fixed grid tracks, normal flow, and `scroll-view`
for live UI. Use absolute positioning only for a documented visual overlap,
fixed overlay, Canvas label, or decoration anchored to a stable parent.

Do not place business content by screenshot coordinates. A component that holds
variable-length data must keep its semantic order and adapt through wrapping,
min/max sizing, or scrolling—not overlap, clipping, or hidden text.

Use explicit `line-height` for reference-critical text. Preserve a manual line
break only when it remains meaningful for real Chinese and localized content.

### 3.3 Build in the Correct Order

1. Implement real content and the complete state matrix.
2. Establish page stack, scrolling, safe areas, fixed bars, and touch targets.
3. Match first-screen anchors and component geometry.
4. Apply token-driven type, color, elevation, icons, and approved artwork.
5. Compare with the reference, correct deviations, then extract a primitive
   only if it is truly reused.

Never reduce readable text, tap targets, or truthful content just to fit a
single screenshot. Remove redundant decoration or recover unused whitespace
first.

## 4. WeChat Native and Responsive Rules

### Safe Areas and Fixed Regions

- Visual QA baseline: iPhone 13 Pro `390x844`, with native WeChat top-right
  capsule and bottom safe area visible.
- Custom navigation must query/reserve the capsule before positioning title or
  actions. A title may be optically centered in its available lane, never
  through the capsule or an interactive action.
- Only the four top-level routes declared by `app.json.tabBar` may mount the
  shared custom TabBar. Secondary pages remain in the native page stack.
- Tab pages use the shared custom-TabBar height variables. Fixed bottom actions
  include safe-area padding and equivalent scroll-content clearance; do not use
  guessed `100vh` offsets.

### Adaptation

- Check `<=360px` width, the `390x844` baseline, and a tall device. Narrow
  layouts may tighten outer inset/gaps but must retain hierarchy, readable
  labels, and reachable actions.
- Fixed-content result/action pages should show heading, essential content, and
  final CTA in one baseline screen whenever their real content permits. Lists,
  dynamic content, and accessibility text may scroll.
- Use native overflow and wrapping behavior deliberately. Do not conceal a
  missing responsive design with `transform: scale(...)`, a screenshot image,
  or arbitrary overflow clipping.

### Readability and Touch

- Primary labels, actions, body copy, and business values are at least `24rpx`;
  metadata and helper text are at least `20rpx`. Smaller text is decorative
  only.
- Give touch controls at least `44px` logical height where the platform permits,
  a visible pressed state, and sufficient separation from adjacent controls.
- Required UI copy, controls, and values must remain native text/components;
  never bake them into an image.
- For every single-line button, segmented option, status cell, or compact action
  built with native `cover-view`, do not rely on a bare text node plus the
  parent's Flex alignment. Wrap the label in its own `cover-view`, give that
  label the full available width and an explicit height/line-height, and apply
  `text-align: center`; define equal-width tracks on the parent when options are
  peers. Verify the optical centre with real Chinese labels in WeChat DevTools
  and on a device, because native `cover-view` text layout can diverge from
  ordinary Flex layout.
- When a critical native `cover-view` control has its own unique class, put its
  final surface, spacing, color, and label/icon geometry on that simple class
  and its directly named child classes. Do not depend on a later ancestor,
  compound, or child-combinator selector to reverse an earlier base style;
  native rendering can retain the base surface even when ordinary WXSS cascade
  inspection suggests the override should win. If a real contextual variant is
  required, attach an explicit modifier class in WXML and verify it on device.

### Native `cover-view` Compatibility Checklist

This checklist is a mandatory implementation and review gate whenever a Mini
Program surface adds or changes `cover-view` / `cover-image`. It is based on the
official WeChat [`cover-view`](https://developers.weixin.qq.com/miniprogram/dev/component/cover-view.html),
[native-component](https://developers.weixin.qq.com/miniprogram/dev/component/native-component.html),
and [WXSS](https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxss.html)
documentation, last reviewed on 2026-08-07.

- Prefer ordinary `view` under supported same-layer rendering when it can meet
  the real layering and touch contract. Keep `cover-view` for overlays that must
  reliably sit above Canvas/native components, and keep that native subtree as
  small and stable as possible.
- Use only documented WXSS selector primitives for critical native surfaces:
  `.class`, `#id`, element, comma-separated element groups, `::before`, and
  `::after`. Do not depend on descendant, child (`>`), compound, attribute, or
  pseudo-class selectors for a button's final background, border, spacing,
  visibility, icon, or text. Put the final style on one simple class; express a
  real variant by attaching an explicit modifier class in WXML.
- Wrap every visible text run in its own `cover-view`. Explicitly set the
  required `display`, `white-space`, `height`, `line-height`, width/flex role,
  and `text-align` because the native defaults include `display: block`,
  `white-space: nowrap`, and `line-height: 1.2`. Never rely on a bare text node
  or parent Flex alone for optical centring.
- Restrict styling to basic positioning, layout, and text properties. Do not
  rely on single-side borders, `background-image`, shadows, or
  `overflow: visible` on `cover-view`; use a full border, a local `cover-image`,
  or supported wrapper geometry instead. Keep children inside the parent bounds.
- Treat scrolling, fixed positioning, and animation as versioned capabilities,
  not general CSS. `overflow: scroll` cannot be updated dynamically; fixed
  positioning applies only to the outermost supported `cover-view`; transitions
  are limited to the documented transform/opacity subset. Provide a static
  usable state when an effect is unsupported.
- Keep the native node tree stable. Avoid conditionally hiding a custom
  component slot or its parent around nested `cover-view`; official docs record
  a case where this makes the cover node disappear. Prefer conditionals on a
  stable native node or explicit visible-state classes where practical.
- Native-component events do not bubble into the underlying native component.
  Bind the action on the actual `cover-view`, preserve the existing Canvas touch
  owner, and give actionable cover nodes `aria-role="button"` plus an accurate
  `aria-label`. Add a visible pressed state where the platform supports it.
- Do not trust DevTools-only rendering. The official native-component guidance
  states that DevTools uses Web-component simulation and may not reproduce
  device behavior. Every changed native overlay must be checked on the existing
  WeChat DevTools project and on a real device at the `390x844` baseline; verify
  background, border, icon, text, spacing, z-order, touch ownership, and the
  state after `wx:if` changes. Screenshot evidence overrides browser-like cascade
  assumptions.

Completion requirement: a `cover-view` UI change is not finished until its
targeted test asserts the simple-class contract, the layout detector has no
unexplained findings, and device evidence shows the intended visible state.

## 5. Design-System Implementation

### Tokens and Reuse

- `app.wxss` is the runtime source for global variables;
  `design-tokens.json` is its portable reference.
- Use matching semantic `var(--...)` values for color, text, surface, border,
  status, spacing, radius, shadow, and custom-TabBar geometry before adding a
  value.
- A new token requires a repeated semantic need, a role-based name, and matching
  updates to both token sources. Do not name tokens after a route or a hex code.
- Reuse a shared component when its layout and state contract actually match.
  Do not force a generic component to absorb unrelated visual variants.

### Typography and Color

- Apply the configured font stack and type roles. Keep type hierarchy explicit:
  page title, section title, body, helper/metadata, and numeric/status roles.
- Use no more visible type sizes or weights than the information hierarchy
  requires. Do not use an oversized title to create hierarchy that layout should
  provide.
- Verify foreground/background contrast in the rendered state, including images,
  gradients, disabled states, and translucent overlays. Target at least `4.5:1`
  for normal text and `3:1` for large text.
- Never rely on color alone for status or selection. Pair it with a label, icon,
  pattern, or position that remains understandable in grayscale.

### Components

| Component | Standard |
| --- | --- |
| Header | Safe-area-aware, stable navigation affordance, and route-appropriate utility actions. |
| Search/filter/tabs | Live controls with a readable inactive state and an unambiguous selected state. Do not use them as decoration. |
| Card | One measured surface, predictable inset, restrained elevation, and stable geometry across data states. Avoid card-inside-card nesting without an information-grouping reason. |
| Button | One clear primary action per local decision. Secondary actions are visually subordinate; unfamiliar actions need text labels. |
| Icon | One locally stored, license-documented family with consistent optical weight and padding. Emoji, mixed Unicode symbols, and complex CSS-drawn product icons are prohibited. |
| Status | Semantic token plus text/icon; loading, success, warning, failure, and disabled states must be distinguishable. |
| Sheet/dialog | Clear close/cancel path, stable action baseline, safe-area handling, and no hidden controls beneath its touch layer. |

### Contextual Guide Bubble

- A contextual guide is a real speech bubble, not a rounded rectangle: its
  pale-green outlined tail must be visibly attached to the card and point
  toward the live Canvas/control target. Flip the tail only when the target is
  above the card.
- Give a guide label a fixed measured container and centre its native text both
  horizontally and vertically. Do not assume a bare text node will honour flex
  alignment inside `cover-view`.
- A mascot connector must leave from the hand facing the target, follow a green
  dashed curve, and end in an arrow at the real target. Select the mascot pose
  from target direction before calculating the connector; never draw a line
  across the mascot or make it appear to point backwards.
- Do not add ordinal phases, progress fractions, tutorial paging, or implied
  steps unless they map to an implemented, user-navigable product flow.

Use separators only to clarify grouping. For a visual hairline, render `1px` and
scale its thickness axis (`scaleX(0.5)` for vertical, `scaleY(0.5)` for
horizontal); do not use a heavy full-length border as decoration.

## 6. Assets and Rendering Performance

- Keep customer data, counts, form controls, navigation, statuses, and formal
  floor-plan geometry in WXML/WXSS/Canvas. Images contain only approved visual
  artwork.
- Action icons must be locally stored, license-documented, encoded with the
  correct filename extension, and normally no larger than `2x` their displayed
  size. Small UI raster icons should normally remain `<=10KB`.
- Generated or supplied artwork must be inspected for crop, alpha halo,
  transparency, compression, and painted bounds on the running page. Store
  source boards, prompts, and unused variants only under the repository-root
  `design-references/`; export only required derivatives to the Mini Program.
- Use an asset board with fixed cells and transparent gutters when generating a
  set of related decorative assets. Cut approved output deterministically; do
  not approximate-crop a flattened screen reference.
- Avoid unnecessary large images, shadow stacks, and re-layout during scrolling.
  Respect the repository's package-size budget and use real content lengths to
  catch overflow before release.

## 7. State and Interaction Fidelity

For each interactive component, explicitly define geometry and semantics for
the states it can enter. At minimum consider `loading`, `content`, `empty`,
`error`, `disabled`, and `selected/active`; add `submitting`, `success`,
`offline`, or `permission denied` where the real workflow requires them.

State may change truthful copy, data, and semantic emphasis. It must not silently
change touch target, type role, radius, alignment, or component placement. A
genuinely different treatment is a named variant, not an incidental state
override.

Feedback must be truthful and actionable: explain failure, preserve recoverable
input, offer retry when possible, prevent duplicate submission, and make the
next action clear. Do not make brand animation, a progress bar, or an empty
illustration imply unavailable work has completed.

Motion is functional and brief: press feedback, content transition, or sheet
entrance may preserve spatial context; elastic, repeated scaling, and decorative
looping must not delay a task or obscure state.

## 8. Visual Acceptance and Regression Review

### Three Review Lenses

Review every restored screen from three perspectives:

1. **Task clarity:** Is the current task, primary action, and next result clear?
   Are secondary choices progressively disclosed instead of competing with it?
2. **Craft fidelity:** Does the running page use the measured layout, approved
   tokens/assets, correct type metrics, real content, and stable reflow?
3. **Trustworthiness:** Are loading, error, permission, and AI/device states
   honest, understandable, and recoverable?

### Required QA Procedure

1. Capture the running state at `390x844` in the current WeChat DevTools window
   or on a real device, including native chrome.
2. Compare at identical scale beside the approved reference; use an overlay for
   anchor comparison when practical.
3. Review in order: safe/fixed regions, macro layout, text metrics/wrap, painted
   asset crop, contrast, and interaction state.
4. Recheck narrow width, tall device, long real content, loading, empty, error,
   disabled, and at least one role/data-specific case before sign-off.

At the baseline, structural anchors (header, card bounds, section starts,
primary CTA, TabBar) must be within `±4rpx` of the measured specification;
text and icon baselines must be within `±2rpx`, subject only to native font
rasterization differences. No required text, touch region, safe-area space, or
business control may be clipped, covered, or represented solely by an image.

Native Canvas can cover `view`/`cover-view` overlays in WeChat DevTools. For
Canvas-heavy routes, validate layering with state-specific WXML/WXSS, tests,
and device evidence where available; do not treat a known-misleading screenshot
as visual proof.

### Contextual Canvas Guide

When a contextual guide must remain visible while the user drags, pans, or
pinches a Canvas editor, draw the complete non-interactive presentation in that
same Canvas: bubble body and tail, label, mascot artwork, target halo, dashed
curve, and arrow. Do not place a `cover-view` guide card over the editor and
assume `pointer-events` will preserve native Canvas gestures. Keep the guide's
geometry in the editor's coordinate system, redraw it with the scene, and make
its real on/off control available outside the Canvas. Verify both the painted
guide and Canvas `touchstart`/`touchmove` ownership at the reference state.
Measure Canvas guide body lines with the active Canvas font and the actual
inner card width; character-count wrapping alone may clip Chinese text. Remove
obsolete alternate WXML bubbles instead of leaving a false `wx:else` fallback
that can paint an empty floating card.
For a speech-bubble tail, paint one continuous outline: overlap the filled tail
into the card edge and stroke only its two exposed sides. Size its half-width
and height from the same viewport scale as the card. Select mascot pose from
the target's real geometry in every guide state, not from a state name or a
previous pose. Compute card height from the first text baseline, all line
heights, and an explicit bottom padding so longer body copy never touches the
bottom border.

## 9. Delivery Record

Every interface-restoration handoff records: target route, approved reference,
measured baseline, reusable primitives/tokens, state coverage, actual data and
permission boundaries, QA evidence, intentional deviations, and the next
permitted reopen trigger.

Update the English/Chinese module-inventory pair only if the implementation
changes a route, API, permission boundary, data contract, or real user flow.
Purely visual work still requires this QA record, but does not change feature
status.
