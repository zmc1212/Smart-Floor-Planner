---
version: 1
slug: "miniprogram-pages-ai-design-ai-design-wxml"
primary_target: "miniprogram/pages/ai-design/ai-design.wxml"
related_targets:
  - "miniprogram/pages/ai-design/ai-design.js"
  - "miniprogram/pages/ai-design/ai-design.wxss"
---

## Scope

`pages/ai-design/ai-design` is the native Mini Program's project-aware design navigation surface. Mode: Operate with an immersive spatial entry.

## Audience and Task

Enterprise staff use the page to select an accessible customer floor plan or room, understand the current design-scheme stage, continue the recommended next action, and review recent generated results.

## Constraints

Preserve tenant and role-scoped sources, enterprise credits, provider availability, workflow-selection rules, the four implemented task modes, the shared custom TabBar, and the iPhone 13 Pro `390x844` baseline. The page must use a safe-area-aware custom navigation composition; the default centered WeChat navigation title is not part of the approved A/B/C designs. Formal plan geometry must come from the version-4 survey graph read model; never substitute a static sample plan.

## Direction

The approved direction uses the formal floor plan as a dominant, first-viewport navigable spatial map, with room tabs and task waypoints around the real wall graph. A compact scheme-stage rail and one server-derived next action sit below it. Without a selected plan, a warm home scene becomes a four-waypoint discovery navigator; selecting a waypoint smoothly refocuses the scene and updates the confirmed next action instead of immediately behaving like a static shortcut.

Approved references: `design-references/ai-design-immersive-c-floor-map-v1.png`, `design-references/ai-design-immersive-b-workflow-v1.png`, and `design-references/ai-design-immersive-a-space-tour-v1.png`.

## Open Decisions

Before a current `cutaway-v1` result exists, the page deliberately shows the deterministic two-dimensional formal wall graph and requires an explicit credit-charging action to create the 3D cover. Workflow stages without a Mini Program continuation remain read-only and direct the user to the current result or history instead of inventing a next action.
