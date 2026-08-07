---
version: 1
slug: "packages-ai-workflow-create-ai-design-create-wxml"
primary_target: "miniprogram/packages/ai-workflow/create/ai-design-create.wxml"
related_targets: ["miniprogram/packages/ai-workflow/create/ai-design-create.js","miniprogram/packages/ai-workflow/create/ai-design-create.wxss"]
---

## Scope

`packages/ai-workflow/create/ai-design-create` is the native Mini Program's AI task preparation page. Mode: Operate.

## Audience and Task

Enterprise staff confirm the inherited customer, formal plan, room scope, or standalone context; provide the image inputs required by the selected task; choose a server-provided style when applicable; verify the real enterprise credit cost; and create one AI task.

## Constraints

Preserve enterprise-only access, the four implemented modes, workflow ownership, source-result continuation, upload validation and retry, provider target support, task validation, credit charging, and the formal version-4 survey-graph boundary. The design scope is inherited from the AI home and remains read-only here because this route has no formal-plan/room picker. Never show a static sample image as an uploaded customer image. Keep primary labels and business values at least `24rpx`, helper text at least `20rpx`, and validate at the iPhone 13 Pro `390x844` baseline with native WeChat chrome.

## Direction

The approved direction is `design-references/all-pages-ip-v3/14-ai-design-create-v3.png`. A native two-step rail leads into one Xiao K material-board scene, a compact real-context card, the truthful upload composition for the active mode, server-derived style thumbnails, inherited scope, enterprise credit status, and one full-width generation action. Decorative derivatives contain no business text, upload state, selection state, credit value, or control.

## Open Decisions

Changing the formal plan or room remains owned by the AI home source picker. A future editable range control on this page requires an approved workflow change and a real picker, not a visual-only toggle.
