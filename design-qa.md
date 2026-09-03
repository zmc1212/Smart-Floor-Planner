# Scheme Studio composer V4 visual QA

## Current V4 result

**Findings**

- [P0] Resolved. The former one-time round setup was consolidated into a reopenable three-state Composer configuration sheet.
  Location: `packages/ai-workflow/scheme-studio/scheme-studio`, `ai-scheme-composer`.
  Evidence: `tmp/ai-composer-v4-qa/01-collapsed-final.png`, `02-expanded-final.png`, and `03-config-final.png`, all captured from the exact scheme-studio route at `390×844` after a fresh DevTools compile.
- [P1] No remaining visual blocker for the approved Composer states. The live capture confirms the system mint-green arc, white inset surface, safe-area treatment, three high-frequency entries (**设计目标 / 提示词模板 / 参考图**), and the locked whole-house **参考图1** followed by user references.

**Open Questions**

- DevTools automation was explicitly authorized for this task and was used only after verifying the exact workspace path `G:\workspace\向总\Smart-Floor-Planner\miniprogram`.

**Implementation Checklist**

1. Keep the three-state source and the three runtime captures together when changing the Composer.
2. Recheck collapsed, expanded, and configuration states at `390×844` after any visible change.
3. Preserve the route/API/tenant/permission contracts when changing presentation.

**Required fidelity surfaces**

- Fonts/typography: section title, card labels, helper text, and CTA remain above the Mini Program typography floors and are visually readable in all three captures.
- Spacing/layout rhythm: the configuration sheet uses an arc-led bounded surface with intrinsic grouped content; the collapsed and expanded panels preserve the bottom safe area.
- Colors/tokens: mint-green system gradient, white inset surfaces, brand-green selection/CTA, neutral borders, and muted helper text match the approved direction.
- Image quality: existing packaged transparent PNG icons are used; no composite reference image is shipped.
- Copy/content: all mode, input, recipe, and confirmation controls retain their existing behavior; runtime wrapping pending.

Source visual truth: `design-references/ai-design/unified-entry-v2/21-studio-composer-v4-three-states.png` (`633×470` composite of the three approved `390×844` states).

Implementation screenshots: `tmp/ai-composer-v4-qa/01-collapsed-final.png`, `02-expanded-final.png`, and `03-config-final.png`; required viewport `390×844` with native WeChat capsule and bottom safe area.

final result: passed

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
