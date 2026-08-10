---
version: 1
slug: "miniprogram-pages-ai-design-ai-design-wxml"
primary_target: "miniprogram/pages/ai-design/ai-design.wxml"
related_targets: ["miniprogram/pages/ai-design/ai-design.js","miniprogram/pages/ai-design/ai-design.wxss"]
---

## Scope

`pages/ai-design/ai-design` is the native Mini Program's project-aware design navigation surface. Mode: Operate with an immersive spatial entry and a project-switching bottom sheet.

## Audience and Task

Enterprise staff find a specific accessible customer project, distinguish an active workflow from an executing generation, recover failed or stale work, start from an eligible completed formal survey, or return an ineligible record to the sole formal surveying flow. Once selected, they choose the complete plan or one closed room, continue one of four implemented AI tasks, and review recent results.

## Constraints

Preserve tenant, role, and current-operator boundaries; enterprise credits; provider availability; workflow-selection rules; the four implemented task modes; source clearing; the shared custom TabBar; and the iPhone 13 Pro `390x844` baseline. The custom navigation reserves the measured WeChat capsule lane. The sheet covers the custom TabBar and includes bottom safe-area padding. Formal-plan geometry comes only from the version-4 survey graph read model. Ineligible projects never create an AI task or credit hold and only navigate through `utils/surveyNavigation.js`.

## Direction

The compact emerald project stage uses `/images/ai-design-hero-v3.png` until an explicitly selected formal plan has a current successful whole-plan render. Native overlays show the server-derived project state, current customer, formal-survey identity, closed-space count, and persistent `Switch project` action. The bottom sheet uses a spatial project-folio metaphor with customer/community search and three server-derived groups: in progress, ready, and survey needs work. Cards use an accessible result image or formal navigator; they expose `generating`, `continue`, `retry`, `stale`, `ready`, or `needs_survey` without changing the persisted enums. Eligible selection defaults to the complete plan; the hero scope rail keeps room switching. Multiple active workflows still require explicit selection.

## Open Decisions

The current source response is bounded to the existing plan query limit and the client filters the loaded project index locally. A `390x844` capture from the user's existing WeChat DevTools window, including native capsule evidence where available, remains required before visual sign-off.
