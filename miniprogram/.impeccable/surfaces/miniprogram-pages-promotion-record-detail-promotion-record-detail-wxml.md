---
version: 1
slug: "miniprogram-pages-promotion-record-detail-promotion-record-detail-wxml"
primary_target: "miniprogram/pages/promotion-record-detail/promotion-record-detail.wxml"
related_targets: []
---

## Scope

`pages/promotion-record-detail/promotion-record-detail` is the enterprise report follow-up and staff-assignment detail surface in the native WeChat Mini Program. Mode: Operate.

## Audience and Task

Sales staff review the report and record the next customer contact. Enterprise administrators additionally assign measuring and design staff. Other permitted roles see only the actions allowed by the server workflow.

## Constraints

Keep the current promotion-record, staff-list, public-pool, role, and mutation contracts. The four-stage rail, activity trail, assignees, dates, and contact identity must stay server-driven. Preserve phone masking, the native navigation bar, scrolling for long histories, and the iPhone 13 Pro `390x844` baseline.

## Direction

The approved direction is the compact report service sheet from `design-references/all-pages-ip-v1/10-promotion-record-detail.png`: Xiao K is the report-stamp clerk, the service rail behaves like a stamped workflow, and the form, timeline, and assignment panel remain quiet white paper modules. The memorable moment is seeing the customer, current completed milestone, and next task in one glance.

## Open Decisions

The server controls available actions, claim/conflict states, stage progression, activity length, assignees, and staff visibility. The hero stamp must render live status text; the reference image never becomes the business-data source.
