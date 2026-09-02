# Scheme Studio round setup V2 visual QA

## Current V2 result

**Findings**

- [P1] Runtime visual comparison is blocked.
  Location: `packages/ai-workflow/scheme-studio/scheme-studio`, `ai-scheme-composer` mode picker.
  Evidence: the approved source is `design-references/ai-design/unified-entry-v2/04-round-setup-v2.png` (`512×1024`), but no updated `390×844` Mini Program capture of the open **准备新一轮** sheet exists.
  Impact: panel height, vertical rhythm, optical type scale, selected-state glyphs, and bottom-safe-area spacing cannot be accepted from code alone.
  Fix: manually capture the open sheet on the existing route with a formal floor plan and selected recipe, including native WeChat chrome, then compare it against the source at a normalized viewport.

**Open Questions**

- DevTools automation was not requested and is not used for this Mini Program task; the implementation capture must be user-provided manual runtime evidence.

**Implementation Checklist**

1. Capture the open sheet at `390×844` with whole-plan selected and a selected recipe.
2. Compare source and runtime capture together for title, cards, input/recipe rows, notice, CTA, and safe bottom spacing.
3. Fix any P1/P2 drift and append the post-fix comparison evidence.

**Required fidelity surfaces**

- Fonts/typography: implemented targets are 44rpx title, 30rpx section/card titles, 22rpx helper/status text, and 28rpx CTA; visual confirmation pending.
- Spacing/layout rhythm: 70vh bounded native sheet with content-intrinsic groups and equal mode cards; visual confirmation pending.
- Colors/tokens: white sheet, brand-green selection/CTA, neutral borders, and muted helper text; visual confirmation pending.
- Image quality: existing packaged transparent PNG icons are used; no composite reference image is shipped.
- Copy/content: all mode, input, recipe, and confirmation controls retain their existing behavior; runtime wrapping pending.

Source visual truth: `design-references/ai-design/unified-entry-v2/04-round-setup-v2.png` (`512×1024`).

Implementation screenshot: unavailable; required viewport `390×844` with native WeChat capsule and bottom safe area.

final result: blocked

## Recipe project V2 visual QA

**Findings**

- [P1] Runtime comparison is blocked pending manual Mini Program captures.
  Location: `packages/ai-workflow/recipe-project/recipe-project`, picker and
  binding states. The approved sources are
  `design-references/ai-design/unified-entry-v2/02-project-picker-v2.png` and
  `03-recipe-bind-v2.png`; the repository has no fresh `390×844` capture with
  the native WeChat capsule for either state.
  Impact: optical type scale, sheet/card rhythm, image crop, and bottom safe-area
  spacing cannot be accepted from source/code inspection alone.
  Fix: manually capture both states and compare at the normalized viewport.

**Source and implementation**

- Source visual truth: the two V2 PNGs above (`512×1107` each).
- Implementation: native WXML/Less in
  `miniprogram/packages/ai-workflow/recipe-project/recipe-project`.
- Implementation screenshot: unavailable; required viewport `390×844`, native
  WeChat capsule and bottom safe area.
- State: picker with no focused customer, picker with focused customer, and
  binding page with selected scheme.
- Focused comparison: unavailable until owner captures the runtime; no source
  composite is packaged.

final result: blocked

## Historical V3 timeline evidence

## Source and implementation

- Approved source: `design-references/ai-design/unified-entry-v2/05-unified-studio-timeline-v3.png` (`852×1846`), normalized for inspection at `390×844` in `output/playwright/scheme-studio-reference-390x844.png`.
- Implemented route: `packages/ai-workflow/scheme-studio/scheme-studio`.
- Live implementation capture: `output/playwright/scheme-studio-timeline-v3-current.png` (`390×844`, iPhone 12/13 Pro simulator, WeChat DevTools).
- Focused comparison: `output/playwright/scheme-studio-comparison-v2.png`.
- Verified live state: one failed batch and one completed batch, with the fixed composer visible.

## Element ledger

| Region | Approved target | Current implementation check |
| --- | --- | --- |
| Navigation | Capsule-safe back, brand, project label and scheme switcher | Native page layer aligns to the 390px baseline; real PNG back/chevron assets are used. |
| Process header | Timeline title, round count, completed/processing counters | Real `workflow.batches` counts remain bound; all icon glyphs use the same packaged icon family. |
| Timeline cards | Card rail, status node, input/result media and contextual actions | Cards bind only real batch input, generation media and status. The available runtime has failed + complete rather than the source's complete + processing state. |
| Composer | Prompt, control-image summary, four tools, primary generation CTA and credit row | Layout, spacing, safe-bottom offset and tool glyph sizes were recalibrated at 390×844; controls remain backed by the existing sheets/actions. |

## Comparison history

1. Initial capture `output/playwright/scheme-studio-timeline-v3.png`: P1 icon-family mismatch, undersized glyphs, and bottom composer density/offset mismatch.
2. Revised capture `output/playwright/scheme-studio-timeline-v3-current.png`: resolved the icon mismatch with 21 transparent PNG assets under `miniprogram/images/ai-studio-icons-v3/`; enlarged visual glyph bounds and recalibrated the composer bottom offset, toolbar, credit row, and CTA.
3. Remaining blocker: the active test workflow has no truthful batch pair matching the approved source's **completed + processing** composition. A temporary automation-only data injection is overwritten by the page's live workflow refresh, so it is not valid visual-QA evidence and is not used to mark the screen passed.

## Required follow-up to pass

Open the route with one completed batch and one processing batch, then capture the same `390×844` viewport. Compare the complete and processing card heights, reference image, progress rail, active CTA, and native WeChat capsule against the approved source before changing this result to `passed`.
# AI Design entry V2 visual QA (2026-09-02)

**Findings**

- [P1] The pre-fix app-layer capture had a materially compressed Hero action layout and undersized project identity block. The approved source uses a wider primary action, a larger customer avatar, and a taller optical identity row; the capture used equal-width actions and a `70rpx` avatar.
  Location: `miniprogram/pages/ai-design/ai-design.less`, `.project-hero-actions`, `.project-avatar`, `.project-identity-copy`.
  Fix applied: calibrated the Hero to `480rpx`, changed the action grid to `1.32fr/1fr`, enlarged the avatar to `88rpx`, raised the project title to `34rpx`, and reduced the image shade opacity.
- [P1] Post-fix native-capsule verification is blocked by the repository's Mini Program manual-screenshot policy. The existing implementation capture is app-layer only and predates the calibration.
  Location: `pages/ai-design/ai-design`.
  Evidence: source and pre-fix implementation were normalized and compared in `tmp/ai-design-qa/ai-design-v2-side-by-side.png`; no fresh user-provided native-capsule capture exists.
  Follow-up: provide a fresh `390x844` runtime screenshot with the native WeChat capsule after recompiling manually.

**Source and implementation**

- Source visual truth: `design-references/ai-design/unified-entry-v2/01-design-tab-v2.png` (`512x1107`), normalized to `390x844`.
- Implementation screenshot: `output/playwright/ai-design-v2-fresh.png` (`390x844`, app-layer, pre-fix).
- Comparison input: `tmp/ai-design-qa/ai-design-v2-side-by-side.png` (`780x844`, source normalized left / implementation right).
- State: authenticated designer Design tab with one current customer project, recipe filters, featured recipe row, recipe waterfall, and persistent six-item role navigation.

**Required fidelity surfaces**

- Fonts/typography: page title and helper floors remain compliant; project identity title and avatar were source-calibrated. Native optical confirmation remains pending.
- Spacing/layout rhythm: Hero/action proportions were corrected; native bottom-safe-area and six-item navigation remain a product constraint to verify in runtime.
- Colors/tokens: existing V2 green, warm-white, and dark-green palette retained; Hero photo shade was reduced to preserve the source's right-side room visibility.
- Image quality: existing real project/recipe images and packaged PNG icons remain in use; no composite screenshot is added as a runtime asset.
- Copy/content: current real project, recipe, and action copy remain bound to existing APIs and handlers.

final result: blocked
