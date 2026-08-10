---
version: 1
slug: "miniprogram-pages-ai-design-ai-design-wxml"
primary_target: "miniprogram/pages/ai-design/ai-design.wxml"
related_targets: ["miniprogram/pages/ai-design/ai-design.js","miniprogram/pages/ai-design/ai-design.wxss"]
---

## Scope

`pages/ai-design/ai-design` is the native Mini Program's project-aware design navigation surface. Mode: Operate with an immersive spatial entry.

## Audience and Task

Enterprise staff choose a specific accessible customer floor plan or room, understand the current design-scheme stage, choose one of four implemented AI tasks, continue the server-derived next action, and review recent generated results.

## Constraints

Preserve tenant and role-scoped sources, enterprise credits, provider availability, workflow-selection rules, the four implemented task modes, source clearing, the shared custom TabBar, and the iPhone 13 Pro `390x844` baseline. The custom navigation must reserve the measured WeChat capsule lane. Formal-plan geometry must come from the version-4 survey graph read model; never substitute a static sample plan, imply unavailable coordinates, hide a paid action's point cost, or make a paid preview task implicitly. A staff member with multiple leads must never see one lead's AI floor-plan image while another plan is selected.

## Direction

`/images/ai-design-hero-v3.png` remains the warm default hero for the unselected state and for any selected plan without an eligible result. Only an explicitly selected formal plan may replace it with a tappable carousel of at most five successful `floor_plan_render` outputs created by the current operator, with exact matching `floorPlanId` and `targetScope: whole_floor_plan`. The page fetches this bounded set from the server instead of filtering its paginated recent history, so a surveyor's older result for the chosen customer remains discoverable. Room renders, other modes, stale results, and other leads are excluded. Default and generated selected-plan visuals both extend behind the custom header with an equal flow-height compensation, so the hero reaches the top without displacing the workbench. The carousel shows the actual AI output, labels it natively, and opens that exact result. The selected-plan workbench retains the four-stage rail, four implemented tasks, one cost-disclosing next action, and a truthful horizontal scope rail. The no-plan state retains the warm four-waypoint spatial tour.

## Open Decisions

Before a current `cutaway-v1` result exists, the page shows the default spatial hero and requires an explicit credit-charging action to create a full-plan render. Workflow stages without a Mini Program continuation remain read-only and direct the user to the current result or history. The DevTools automation capture verifies the `390x844` page composition but omits native WeChat chrome, so a capsule-visible native or device capture remains outstanding.
