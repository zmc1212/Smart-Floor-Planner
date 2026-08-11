---
version: 1
slug: "miniprogram-pages-ai-design-ai-design-wxml"
primary_target: "miniprogram/pages/ai-design/ai-design.wxml"
related_targets: ["miniprogram/pages/ai-design/ai-design.js","miniprogram/pages/ai-design/ai-design.wxss"]
---

## Scope

`pages/ai-design/ai-design` is the native Mini Program's project-aware design navigation surface. Mode: Operate with a customer-project status workbench and a project-switching bottom sheet.

## Audience and Task

Enterprise staff find a specific accessible customer project, distinguish an active workflow from an executing generation, recover failed or stale work, start from an eligible completed formal survey, or return an ineligible record to the sole formal surveying flow. Once selected, they choose the complete plan or one closed room, continue one of four implemented AI tasks, and review recent results.

## Constraints

Preserve tenant, role, and current-operator boundaries; enterprise credits; provider availability; workflow-selection rules; the four implemented task modes; source clearing; the shared custom TabBar; and the iPhone 13 Pro `390x844` baseline. The custom navigation reserves the measured WeChat capsule lane. The sheet covers the custom TabBar and includes bottom safe-area padding. Formal-plan geometry comes only from the version-4 survey graph read model. Ineligible projects never create an AI task or credit hold and only navigate through `utils/surveyNavigation.js`.

## Direction

The selected-project surface uses two approved references together: `ai-design-customer-workbench-home-v2.png` owns the home-page macro composition, while `ai-design-customer-project-switcher-v3.png` owns the project hero identity layer and picker treatment. Direct entry selects the first eligible server-ordered project, preferring in-progress work before ready work; if none is eligible, it opens the grouped project picker. The compact emerald project stage uses `/images/ai-design-project-hero-v5.jpg` until the selected formal plan has a current successful whole-plan render. The artwork contains only the floor-plan-to-interior scene and one Xiao K; native overlays preserve the switcher reference's server-derived project state, `Current customer` eyebrow, project title, formal-survey/subtitle/closed-space metadata, progress, stage rail, and persistent `Switch project` action. The identity block is pulled `26rpx` above the switch action's normal-flow baseline; the status chip uses compact `4rpx` vertical padding; and the default artwork begins `70rpx` below the stage top with its height reduced by the same amount. Together these measured offsets preserve separation between chip, identity, and artwork without stretching or darkening the scene. The fallback artwork is shown at its authored brightness without an additional scene shade. Generated whole-plan carousel slides remain artwork-only: the legacy result title/helper caption and duplicate navigation-preview progress are intentionally omitted so the project progress rail is the only lower-stage status layer. The selected stage combines a `96rpx` local glow derivative with an explicit emerald node fill, white ring, and high-contrast outer highlight, while the project switch and design-preparation controls use their approved local artwork derivatives. The bottom sheet uses a spatial project-folio metaphor with customer/community search and three server-derived groups: in progress, ready, and survey needs work. Cards combine live formal navigator geometry on the left with the latest accessible result on the right and fall back to the local plan mark only when the formal navigator is unavailable; they expose `generating`, `continue`, `retry`, `stale`, `ready`, or `needs_survey` without changing the persisted enums. Eligible selection defaults to the complete plan; the hero scope rail keeps room switching. The old unscoped spatial-tour home is not a fallback on this route. With no selectable project, show a project-specific empty/recovery state. Multiple active workflows require explicit selection only when the user starts an action that cannot be resolved from the project index.

## Open Decisions

The current source response is bounded to the existing plan query limit and the client filters the loaded project index locally. `qa-restored-ai-design-entry-v5.png` and `qa-restored-project-picker-v5.png` remain pre-fidelity-correction evidence under the approved design-reference directory. The existing DevTools window does not expose a compatible automation endpoint, so a fresh `390x844` capture and real-device confirmation remain separate release checks.
