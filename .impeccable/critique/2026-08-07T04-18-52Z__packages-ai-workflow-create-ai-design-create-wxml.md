---
target: 14-ai-design-create-v3.png 与两张 390x844 实测截图差距分析
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-07T04-18-52Z
slug: packages-ai-workflow-create-ai-design-create-wxml
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Loading, upload, scope, credits, and submission states are visible; some recovery still depends on transient feedback |
| 2 | Match System / Real World | 3 | Floor-plan, space-image, and reference-image language matches renovation work |
| 3 | User Control and Freedom | 2 | Back and replace-image paths exist; insufficient credits create a dead end |
| 4 | Consistency and Standards | 3 | Native WeChat and card patterns are coherent; read-only scope still looks selectable |
| 5 | Error Prevention | 2 | Capability and credit checks exist, but required images are not part of the live CTA-ready state |
| 6 | Recognition Rather Than Recall | 2 | Context and cost are visible, but the current AI mode title is not rendered |
| 7 | Flexibility and Efficiency | 2 | Inherited context and camera/album paths help; no visible resume or rapid reuse path |
| 8 | Aesthetic and Minimalist Design | 3 | Truthful and focused, but omitted mode sections leave the lower composition unresolved |
| 9 | Error Recovery | 3 | Loading and upload failures can retry without losing previews; credit shortage has no visible recovery path |
| 10 | Help and Documentation | 2 | Privacy and scope notes exist; image-quality and mode-requirement help are thin |
| **Total** | | **25/40** | **Acceptable — significant restoration and recovery work remains** |

## Design Specificity Verdict

The surface has medium-high product specificity. Xiao K, the material board, formal floor-plan context, and the distinction between a space image and a reference image clearly belong to this renovation AI workflow. The specificity is concentrated in the hero, however; the task stack below it falls back to a generic white-card form language.

The deterministic detector returned zero findings for `miniprogram/packages/ai-workflow/create/ai-design-create.wxml`. This is a clean regex/markup signal, not a visual sign-off: it cannot detect native WeChat button width, state-dependent vertical rhythm, `aspectFill` cropping, or a read-only block that looks interactive.

No reliable browser overlay was available because the target is a native WeChat Mini Program WXML route rather than an injectable localhost DOM page. The fallback evidence was the two retained `390x844` WeChat DevTools captures, the approved reference, the detector, and WXML/WXSS geometry.

## Overall Impression

The shared horizontal skeleton is close, but the compared runtime state is not the state shown by the approved comp. The comp resembles a style-transform/soft-furnishing task with an existing space image, visible styles, sufficient credits, and an active CTA. Both runtime captures are reference-recreation empty states with zero credits. After the style section disappears, the implementation does not rebalance the lower page, leaving a half-width-looking CTA and over 100 px of dead space.

## What's Working

- The page preserves product truth instead of showing a sample room as customer content.
- Formal-plan recreation correctly requires only a reference image; standalone recreation correctly requires both source images.
- Native capsule clearance, horizontal margins, card widths, and context/cost visibility are solid.

## Priority Issues

### P1 — The validation screenshots use the wrong mode/state as the visual comparison authority

The reference contains an uploaded room image, a style selector, sufficient credits, and an active CTA. The two captures contain no uploaded image, no style section, zero credits, and a blocked CTA.

**Fix:** validate the visual target first with the closest truthful branch: `style_transform` or `soft_furnishing`, a real uploaded/continued space image, server styles, and sufficient test credits. Then separately validate the two `reference_recreate` branches as state variants instead of claiming that their missing mode-specific sections match the comp.

### P1 — The runtime CTA loses the approved full-width bottom anchor

Both captures show a centered blocked pill around half the content width and 115–145 px of empty space below it. The source declares `width: 100%`, so the runtime result indicates a native-button/cascade, stale-compile, or capture-state problem.

**Fix:** isolate the native button rendering in the existing DevTools window, make the visible CTA span the content column, and use state-aware vertical layout so the final action remains near the bottom safe area when the style section is absent.

### P1 — Insufficient credits are truthful but terminate without a recovery path

The user sees zero credits and a disabled button but no actionable next step.

**Fix:** add a truthful recovery explanation such as contacting the enterprise administrator. Add an action only if a real route/permission exists.

### P2 — The inherited scope looks like an interactive radio group

Whole-plan and local-design cards use radio markers and selected/unselected borders, but the page intentionally has no scope-changing interaction.

**Fix:** replace the radio affordance with a passive scope summary and a concise “inherited from AI Design home” label.

### P2 — The hero crop and lower visual language lose reference character

The `760x270` hero asset is placed in a roughly `3.44:1` `aspectFill` container while the asset is about `2.81:1`, necessarily cropping Xiao K’s feet and material-board detail. Below the hero, warmth and materiality give way to generic white cards.

**Fix:** use an aspect ratio that preserves the approved composition, and carry a restrained material-board organization into context/upload/scope grouping without repeating Xiao K as decoration.

### P2 — Task identity and blocked-state legibility are weaker than the reference

`modeTitle` exists in data but is not rendered. Helper text and the blocked CTA use low-contrast gray combinations, and the user must infer the mode from which inputs appear.

**Fix:** show a compact read-only mode label, add required-input wording, and darken blocked/helper text to meet readable contrast.

## Persona Red Flags

**Jordan (First-Timer):** cannot confirm whether the task is reference recreation or style transform; may tap the read-only scope cards; reaches zero-credit state without knowing what to do.

**Sam (Accessibility-Dependent):** blocked/helper text contrast is weak; read-only state is carried mainly by color and radio-like visuals; native state announcements are not proven by screenshots.

**Casey (Distracted Mobile User):** CTA is in the lower half but not anchored to the natural thumb/end position; the large empty tail weakens completion; the blocked state has no one-line recovery instruction.

## Minor Observations

- The capsule-induced top offset is a required improvement over the capsule-less comp, not a regression.
- Real `10`-point/zero-balance data should not be changed to the comp’s `20`-point sufficient state.
- The retained QA images were enlarged from a smaller DevTools simulator presentation, so some softness belongs to the capture pipeline rather than the actual WXML.
- A complete ready-to-submit screenshot is still missing.

## Questions to Consider

- Should the next pass first reproduce the comp’s closest truthful `style_transform` ready state, or first refine the two `reference_recreate` branches?
- Should the scope remain a passive inherited summary, or should product behavior change later to add a real picker?
- In a zero-credit state, is the successful endpoint “generate now” or “know exactly who can restore credits while preserving prepared inputs”?
