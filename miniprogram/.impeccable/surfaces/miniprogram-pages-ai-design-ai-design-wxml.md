---
version: 1
slug: "miniprogram-pages-ai-design-ai-design-wxml"
primary_target: "miniprogram/pages/ai-design/ai-design.wxml"
related_targets: ["miniprogram/pages/ai-design/ai-design.js","miniprogram/pages/ai-design/ai-design.wxss"]
---

## Scope

`pages/ai-design/ai-design` is the native Mini Program's project-aware design navigation surface. Mode: Operate with an immersive spatial entry.

## Audience and Task

Enterprise staff select an accessible customer floor plan or room, understand the current design-scheme stage, choose one of the four implemented AI tasks, continue the server-derived next action, and review recent generated results.

## Constraints

Preserve tenant and role-scoped sources, enterprise credits, provider availability, workflow-selection rules, the four implemented task modes, source clearing, the shared custom TabBar, and the iPhone 13 Pro `390x844` baseline. The custom navigation must reserve the measured WeChat capsule lane even though the approved comp does not show that capsule. Formal-plan geometry must come from the version-4 survey graph read model; never substitute a static sample plan, imply room coordinates that the graph does not provide, hide a paid action's point cost, or make a paid preview task implicitly.

## Direction

The approved selected-plan direction is `design-references/all-pages-ip-v3/04-ai-design-home-v3.png`. The real 3D navigation cover or deterministic formal wall graph dominates the first viewport, while a compact horizontal whole-plan/room scope rail crosses its upper edge without claiming unmeasured three-dimensional coordinates and a character-only Xiao K acts once as the spatial transformation guide. A single raised white workbench joins the four-stage rail, four implemented task entries, and one full-width green contextual next action with its live operation label and point cost visible. Recent results remain below that first-viewport workbench. The no-plan state retains the warm four-waypoint spatial tour from `design-references/ai-design/ai-design-immersive-a-space-tour-v1.png`.

## Open Decisions

Before a current `cutaway-v1` result exists, the page deliberately shows the deterministic two-dimensional formal wall graph and requires an explicit credit-charging action to create the 3D cover. Workflow stages without a Mini Program continuation remain read-only and direct the user to the current result or history instead of inventing a next action. The DevTools automation capture verifies the `390x844` page composition but omits native WeChat chrome, so a capsule-visible native or device capture remains outstanding.
