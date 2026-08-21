# Mini Program Subscription Notification Template Baseline

Status: `Limited` (eight-template configuration and runtime mappings are implemented for workflow, assignment, new-lead, design-published, enterprise-join-result, referrer signing commission, and enterprise lead-converted; a real on-site measurement appointment trigger remains limited).

Date: 2026-08-21

This document is the current implementation contract for WeChat Mini Program public templates selected from the `房屋装修` category. Every ID and keyword key has been read back from `订阅消息 -> 我的模板` (and re-verified via `wxaapi/newtmpl/gettemplate` for AppID `wxa7728432f59779d1` on 2026-08-21; prior `l`/`I` and case typos that caused WeChat `40037 invalid template_id` are retired). Server payloads must use the selected template's strict field allowlist and must not reuse the retired generic field set.

## Confirmed Templates

| Priority | Type | Template | Business scenario | Template ID | Keyword contract |
| --- | --- | --- | --- | --- | --- |
| 1 | `workflow_todo` | `装修待办提醒` | Follow-up, measurement, design, closure, and acquisition-commission tasks | `48Jvq7OjOKwRhsnh8fyvtsjxAamLOakaNtiKcO11rOc` | `thing4` project name; `thing11` owner; `phrase12` current status; `thing2` todo; `thing5` note |
| 2 | `lead_assignment` | `客户指派成功通知` | A lead is assigned to a measurer or designer | `wItuS0LdggzpMWdSOIr6FBSKeRbOKUzqXVCqJDmLpmA` | `thing1` customer name; `phrase2` customer status; `thing3` note; `time4` time |
| 3 | `new_lead` | `新增客户成功通知` | A new lead is created and reported to enterprise administrators | `EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjg4xest9GRc` | `name1` customer name; `date2` added time; `name3` owner; `phone_number4` phone; `time5` selected time |
| 4 | `measurement_appointment` | `上门量房提醒` | A confirmed, explicit on-site measurement appointment | `CtcuQ_NWF4GOpHvstgviDPmYRISjyqTjnFAoeQR9-vI` | `thing1` name; `phone_number2` phone; `thing3` community; `time6` measurement time; `thing7` reminder |
| 5 | `design_published` | `设计案例发布提醒` | A design scheme becomes visible to the customer | `XEQFWwyaIQVotG3R6FKZxWLFExf9pS7_g85r-j3Vjag` | `thing1` content; `time2` published time; `thing3` note |
| 6 | `enterprise_join_result` | `入驻申请结果通知` | Platform approve or reject of an enterprise self-service application | `wJ5K4XXpOOPnsHFcEOl5MJq7J0iG8bpxsyVLzd_G3Kk` | `time1` notification time; `phrase2` result; `thing3` store contact; `time4` application time; `thing5` store name |
| 7 | `signing_commission` | `推广奖励到账提醒` | Referrer signing success / payable commission credit | `aY-4Rk78otCQuM-PQ6yKUt46XFWP60zP8m7QqrrX8xU` | `thing1` reward type; `thing2` note; `amount4` reward amount |
| 8 | `lead_converted` | `客户已成交提醒` | Enterprise owner signing-success reminder | `WFQg70AyoRkLpHaNNK4oywE2gMS60nHuKelkLjkK3zo` | `time1` notification time; `thing2` warm tip |

## Runtime Mapping

| Notification type | Template | Status |
| --- | --- | --- |
| Enterprise-administrator notification after new lead creation | `new_lead` | `Implemented` |
| Designer/measurer notification after successful assignment | `lead_assignment` | `Implemented` |
| Enterprise-administrator nudge while assignment is pending | `workflow_todo` | `Implemented` |
| Confirmed on-site measurement appointment (create/reschedule/cancel/expire) | `measurement_appointment` | `Limited`: appointment event paths exist; keep field contract strict. |
| Designer nudge after formal survey completion | `workflow_todo` | `Implemented` |
| Design scheme visible to the customer | `design_published` | `Implemented` |
| Enterprise status `approve` / `reject` after `POST /api/admin/enterprises/[id]/status` | `enterprise_join_result` | `Implemented`: recipient is the enterprise `contactPerson.phone` resolved through `users` → `wechat_identities.openid`. Missing openid/template or WeChat rejection never rolls back the status transition. Web `/register` applicants without Mini Program subscribe authorization may be skipped. |
| Referrer payable commission after `POST /api/leads/[id]/convert` when a `role=referrer` snapshot row exists | `signing_commission` | `Implemented`: WeChat-only best-effort to the commission beneficiary openid; designers/measurers are not recipients of this template. |
| Enterprise-administrator signing success after the same convert commit | `lead_converted` | `Implemented`: uses `staff_notifications` plus WeChat; designers/measurers/customers are not recipients. |
| Legacy promotion `follow_up_*` / `measure_*` / `design_*` / `conflict_pending` / `record_closed` | — | `Retired`: create/update promotion routes and the reminder cron no longer send these; historical `workflow_notification_logs` remain readable only. |

Until a real appointment feature exists, `new_lead.time5` uses the approved transitional rule: `assignedAt` first, then `createdAt`. It must not pretend to be a future appointment.

## Click Deep Links

Subscription `page` targets after WeChat tap:

| Template / notify path | Recipient | Deep link |
| --- | --- | --- |
| `lead_assignment` | Designer / measurer | `/packages/business/lead-detail/lead-detail?id={leadId}` |
| `new_lead` | Enterprise admin | same lead detail |
| `workflow_todo` (assignment pending / survey completed) | Enterprise admin / designer | same lead detail |
| `measurement_appointment` (staff) | Designer / measurer | same lead detail |
| `measurement_appointment` (customer) | Customer | `/packages/business/customer-project/customer-project?leadId={leadId}` |
| `design_published` | Customer | same customer project archive |
| `signing_commission` | Referrer | `/packages/business/referrer-earnings/referrer-earnings` |
| `lead_converted` | Enterprise admin | `/packages/business/enterprise-commissions/enterprise-commissions` |
| `enterprise_join_result` | Applicant contact | `/pages/mine/mine` |

Staff lead notifications must not open the bare `leads-management` list without a lead id.

## Implemented Contract

- `platform_configs.notification_config` stores a `version: 2` eight-template map with IDs, keyword contracts, and optional `legacyTemplateId`. Reading and PATCHing the former single `miniprogramTemplateId` remains compatible for one release.
- `GET/PATCH /api/platform/notification-config` lets platform `admin`/`super_admin` users maintain eight non-empty, valid, distinct IDs. `/workflow-logs` uses its existing configuration card and shared operation feedback.
- `GET /api/miniprogram/notification-template` returns an ordered eight-template list plus the deprecated single-value alias to authenticated Mini Program users. The client caches only a complete V2 configuration and has no bundled template-ID fallback.
- Login, Mine, and Settings request role-scoped templates in one `wx.requestSubscribeMessage` call (at most three): customer 2, designer/measurer 3, enterprise owner 3 (`new_lead` + `workflow_todo` + `lead_converted`), referrer 1 (`signing_commission`). Enterprise open-account (`enterprise-register`) requests only `enterprise_join_result` quietly before submit; refusal does not block the application.
- Server builders emit only approved keys and normalize empty values, character limits, and China-time `YYYY-MM-DD HH:mm:ss` values. `phrase2` for join results is `审核通过` or `审核不通过`. Signing commission `amount4` uses `¥xx.xx`.
- Workflow dispatch for **legacy promotion reports is retired**. Lead/appointment/signing notifications write `staff_notifications` `in_app` first (where applicable), then attempt WeChat and record `sent`, `failed`, or `skipped`. Enterprise join-result and referrer signing-commission delivery remain WeChat-only best-effort after commit. Missing openids/templates and WeChat failures never roll back business data.
- `/api/automation/reminders/run` only runs appointment expiry for the current matrix; it no longer scans promotion follow-up / `measureDueAt` / `designDueAt` / protection-pool nudges.
- Duplicate-phone lead intake reuses the existing lead and emits no new enterprise-administrator or designer notification.

## Handoff Checklist

- [x] All eight templates appear in `我的模板`.
- [x] All eight IDs and exact keyword keys are recorded.
- [x] Admin configuration stores eight typed IDs.
- [x] The Mini Program authorizes role-scoped templates and separately authorizes join-result on open-account submit.
- [x] Server payloads contain only keys accepted by the selected template.
- [x] In-app delivery, channel-scoped deduplication, and WeChat failure logs are preserved where applicable.
- [x] Bilingual Admin/Mini Program inventories and this baseline pair are synchronized.
- [ ] Keep validating `measurement_appointment` delivery against every appointment event path in production.
