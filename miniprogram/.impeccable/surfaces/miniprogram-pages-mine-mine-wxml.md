---
version: 1
slug: "miniprogram-pages-mine-mine-wxml"
primary_target: "miniprogram/pages/mine/mine.wxml"
related_targets: []
---

## Scope

`pages/mine/mine` is the role-aware Mine/workbench surface in the native WeChat Mini Program. Mode: Operate.

## Audience and Task

Enterprise staff (sales, surveyors, designers, and administrators) use the page to identify and act on their next business task, scan role-specific metrics, enter frequent tools, and manage account/notification actions. Ordinary users use the same route to continue with saved floor plans, measurement, and AI design.

## Constraints

Keep the existing `/api/miniprogram/mine` and `/api/floorplans` contracts, role and tenant boundaries, current route handlers, formal surveying entry, custom tab bar, and iPhone 13 Pro `390x844` baseline. Keep green-led home-design language and avoid inventing actions not returned by the API.

## Direction

The approved direction is the v6 scene-led workbench: an indoor profile header, three-card summary viewport, role-aware tool grid, compact two-item todo list, and AI design banner. The memorable moment is the user's real work context becoming immediately scannable without hiding role-specific actions or the existing account flows.

Approved visual reference: `design-references/miniprogram-mine-v6.png`; production crops are derived from `design-references/miniprogram-mine-v6-icon.png`.

## Open Decisions

The server controls action count, labels, statuses, and role-specific metrics. Empty, loading, ordinary-user, and logged-out states remain part of the same visual system. No new API or configuration surface is implied by this brief.
