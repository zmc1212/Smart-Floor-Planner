---
target: 选择户型后的 AI 设计首页状态
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-08-07T06-34-36Z
slug: miniprogram-pages-ai-design-ai-design-wxml
---
Method: dual-agent (A: ai_home_design_review · B: ai_home_detector_review)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2/4 | Selected-plan fallback image has no source or “not generated” state label |
| 2 | Match System / Real World | 2/4 | A generic living room visually impersonates the selected formal plan |
| 3 | User Control and Freedom | 2/4 | Source can be changed or cleared, but the chosen whole-plan/room scope is not visible enough |
| 4 | Consistency and Standards | 2/4 | The same image changes meaning between unselected and selected states |
| 5 | Error Prevention | 2/4 | A 0-point balance still presents the 10-point generation CTA as executable |
| 6 | Recognition Rather Than Recall | 2/4 | Users must remember which whole-plan/room target they just selected |
| 7 | Flexibility and Efficiency | 2/4 | Four task entries are direct, but the oversized hero delays operational content |
| 8 | Aesthetic and Minimalist Design | 2/4 | The most visually dominant element has little selected-plan business value |
| 9 | Error Recovery | 3/4 | Loading, refresh, provider, and workflow failures retain content and offer recovery |
| 10 | Help and Documentation | 2/4 | The next step is visible, but image provenance, selected scope, and fallback state are unexplained |
| **Total** |  | **21/40** | **Acceptable; significant improvement required** |

## Design Specificity Verdict

**LLM assessment:** Medium-low specificity, 2/4. Customer context, formal-plan scope, scheme stages, enterprise credits, and four real AI tasks are product-specific. However, the dominant selected-plan visual is a generic residential image that could belong to any interior-design product. It suppresses the strongest product evidence: the version-4 formal wall graph and the selected whole-plan/room target. Xiao K appears as decoration in a measurement pose rather than acting as the AI-space transformer defined by the brand system.

**Deterministic scan:** The Impeccable CLI detector returned `[]` with exit code 0. It found no rule violations in `miniprogram/pages/ai-design/ai-design.wxml`. This is not evidence that the state model is sound: the detector does not judge whether a generic image truthfully represents customer data. It also did not flag several no-plan interactive `view` nodes that lack the explicit ARIA pattern used by selected-plan controls.

**Visual evidence:** Browser overlays were not applicable because this is native WeChat WXML/WXSS rather than an HTTP DOM surface. The supplied 1080×2400 real-device screenshot is the fallback evidence. It confirms correct capsule separation, but also confirms that the selected-plan fallback image occupies most of the initial viewport and the selected scope rail is not visible.

## Overall Impression

Separating “no floor plan selected” and “floor plan selected” is correct. The selected state is not. The page currently changes the business meaning of the same hero from “spatial inspiration tour” to “this customer’s home” without a transition, provenance label, or real-plan evidence. That is why the switch feels strange.

## What’s Working

- The backend/source filtering protects tenant, customer, floor-plan, scope, owner, freshness, and render-contract boundaries.
- The selected state contains real scheme stages, four implemented AI tasks, credit cost, and one server-derived next action.
- Native safe-area handling is correct in the supplied device screenshot; the title, credit balance, and WeChat capsule do not overlap.

## Cognitive Load

High: approximately five of eight checks fail. The generic hero becomes the main focus instead of confirming the selected customer and scope; the user must process the stage rail, four tasks, primary CTA, and recent results together; and the chosen whole-plan/room target must be remembered from the sheet.

## Emotional Journey

The unselected spatial tour creates curiosity. Selecting a formal plan should create reassurance, but instead produces ambiguity: the polished living room may be read as customer data or an already-generated result. The next emotional beat is a paid action while the balance shows 0 points, which adds distrust rather than confidence.

## Priority Issues

### [P1] Generic fallback hero implies false customer data

**Why it matters:** Under a customer name, users naturally interpret the full-screen room as the selected home or an existing result. The adjacent “generate 3D floor-plan tour” action then contradicts the image.

**Fix:** Use a qualified AI result only when one exists. For missing, stale, or processing states, render the existing `selectedSource.navigatorView` formal 2D wall graph and label it “正式量房户型 · 尚未生成导览图”. Keep the generic living room only in the unselected inspiration state.

**Suggested command:** `$impeccable shape`

### [P1] The selected customer and scope are not continuously confirmed

**Why it matters:** After choosing plan → whole plan/room, users cannot easily verify the target before spending enterprise credits.

**Fix:** Add a stable context strip in normal flow: `高女士 · 云基地 / 正式量房 / 完整户型 / 全屋`. Move the whole-plan/room rail into the workbench or directly below the wall graph, and highlight the selected room in the graph.

**Suggested command:** `$impeccable clarify`

### [P1] Credit state conflicts with the primary action

**Why it matters:** The screenshot shows `0 点` while the 10-point CTA remains fully green and actionable; rejection happens only after navigation.

**Fix:** Derive homepage CTA readiness from `availableBalance >= credits`. Show `点数不足 · 联系企业管理员补充` as the disabled/recovery state instead of presenting generation as available.

**Suggested command:** `$impeccable harden`

### [P2] The selected-state visual is too tall for an operational page

**Why it matters:** Roughly 55%–60% of the initial viewport is spent on the fallback hero, pushing the next decision down.

**Fix:** Missing-result wall-graph state: about 360–440rpx high. Existing real-result carousel: about 480–560rpx. Put the server-derived primary action before the four alternate task entries.

**Suggested command:** `$impeccable layout`

### [P2] Xiao K has the wrong role and is repeated

**Why it matters:** The selected hero uses the measurement pose, the CTA uses an AI-create pose, and the TabBar shows the measurement role again.

**Fix:** Remove the hero measurement pose. Keep one content-level “space transformer” whose placement explains the wall-graph-to-result transition; the TabBar measurement Xiao K remains the global entry.

**Suggested command:** `$impeccable distill`

## Persona Red Flags

**Jordan (First-Timer):** Reads the room image as a completed result, then cannot explain why the page asks for another paid generation. “示意图 / 尚未生成 / 当前范围” is missing at the point of confusion.

**Casey (Distracted Mobile User):** Returns after interruption and cannot reconstruct whether full plan or a room was selected. The primary action is pushed below an oversized image and competes with four task choices.

**Enterprise surveyor/designer:** Needs to prevent writing a result to the wrong customer or room. A customer name without a recognizable formal graph and explicit scope is insufficient confirmation before spending shared credits.

## Minor Observations

- “探索这个家” is warm but vague for a selected operational state; `高女士的全屋设计` or `当前户型` would confirm the task more directly.
- The real-result carousel autoplays every 4200ms; an operational surface should favor user-controlled inspection and pause after touch.
- The recommended task is indicated only by a small green dot; add a native `推荐` label.
- No-plan waypoints and recent-result cards should adopt the same explicit ARIA role/label pattern as selected-plan controls.

## Questions to Consider

1. After selecting a formal plan, should the first five seconds confirm customer/scope or show an aspirational room?
2. If a formal wall graph already exists, what business reason justifies replacing it with an unrelated room image?
3. Is the top visual a navigation surface, business evidence, or inspiration? It cannot truthfully perform all three roles.
4. Should “generate 3D tour” be the single next action, with the other four tasks demoted to alternatives?
