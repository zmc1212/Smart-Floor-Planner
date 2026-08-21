# Mini Program Subscription Notification Template Baseline

Status: `Limited` (six-template configuration and runtime mappings are implemented for workflow, assignment, new-lead, design-published, and enterprise-join-result; a real on-site measurement appointment trigger remains limited).

Date: 2026-08-21

This document is the current implementation contract for WeChat Mini Program public templates selected from the `房屋装修` category. Every ID and keyword key has been read back from `订阅消息 -> 我的模板`. Server payloads must use the selected template's strict field allowlist and must not reuse the retired generic field set.

## Confirmed Templates

| Priority | Type | Template | Business scenario | Template ID | Keyword contract |
| --- | --- | --- | --- | --- | --- |
| 1 | `workflow_todo` | `装修待办提醒` | Follow-up, measurement, design, closure, and acquisition-commission tasks | `48Jvq7OjOKwRhshn8fyvtsjxAamLOakaNtiKcO11rOc` | `thing4` project name; `thing11` owner; `phrase12` current status; `thing2` todo; `thing5` note |
| 2 | `lead_assignment` | `客户指派成功通知` | A lead is assigned to a measurer or designer | `wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA` | `thing1` customer name; `phrase2` customer status; `thing3` note; `time4` time |
| 3 | `new_lead` | `新增客户成功通知` | A new lead is created and reported to enterprise administrators | `EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc` | `name1` customer name; `date2` added time; `name3` owner; `phone_number4` phone; `time5` selected time |
| 4 | `measurement_appointment` | `上门量房提醒` | A confirmed, explicit on-site measurement appointment | `CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl` | `thing1` name; `phone_number2` phone; `thing3` community; `time6` measurement time; `thing7` reminder |
| 5 | `design_published` | `设计案例发布提醒` | A design scheme becomes visible to the customer | `XEQFWwyalQVotG3R6FKZxWLFExf9pS7_g85r-j3Vjag` | `thing1` content; `time2` published time; `thing3` note |
| 6 | `enterprise_join_result` | `入驻申请结果通知` | Platform approve or reject of an enterprise self-service application | `wJ5K4XXpOOPnsHFcEOI5MJq7J0iG8bpxsyVLzd_G3Kk` | `time1` notification time; `phrase2` result; `thing3` store contact; `time4` application time; `thing5` store name |

## Runtime Mapping

| Notification type | Template | Status |
| --- | --- | --- |
| `follow_up_created`, `follow_up_overdue`, `conflict_pending`, `measure_overdue`, `measure_submitted`, `design_overdue`, `design_completed`, `record_closed`, `lead_acquired_commission_pending`, and other generic workflow reminders | `workflow_todo` | `Implemented` |
| `measure_assigned`, `design_assigned`, `lead_assigned`, and `lead_pending_acquisition` | `lead_assignment` | `Implemented` |
| Enterprise-administrator notification after new lead creation | `new_lead` | `Implemented` |
| Confirmed on-site measurement appointment | `measurement_appointment` | `Limited`: appointment events exist for create/reschedule/cancel/expire paths; keep field contract strict. |
| Design scheme visible to the customer | `design_published` | `Implemented` |
| Enterprise status `approve` / `reject` after `POST /api/admin/enterprises/[id]/status` | `enterprise_join_result` | `Implemented`: recipient is the enterprise `contactPerson.phone` resolved through `users` → `wechat_identities.openid`. Missing openid/template or WeChat rejection never rolls back the status transition. Web `/register` applicants without Mini Program subscribe authorization may be skipped. |

Until a real appointment feature exists, `new_lead.time5` uses the approved transitional rule: `assignedAt` first, then `createdAt`. It must not pretend to be a future appointment.

## Implemented Contract

- `platform_configs.notification_config` stores a `version: 2` six-template map with IDs, keyword contracts, and optional `legacyTemplateId`. Reading and PATCHing the former single `miniprogramTemplateId` remains compatible for one release.
- `GET/PATCH /api/platform/notification-config` lets platform `admin`/`super_admin` users maintain six non-empty, valid, distinct IDs. `/workflow-logs` uses its existing configuration card and shared operation feedback.
- `GET /api/miniprogram/notification-template` returns an ordered six-template list plus the deprecated single-value alias to authenticated Mini Program users. The client caches only a complete V2 configuration and has no bundled template-ID fallback.
- Login, Mine, and Settings request role-scoped templates in one `wx.requestSubscribeMessage` call (at most three). Enterprise open-account (`enterprise-register`) requests only `enterprise_join_result` quietly before submit; refusal does not block the application.
- Server builders emit only approved keys and normalize empty values, character limits, and China-time `YYYY-MM-DD HH:mm:ss` values. `phrase2` for join results is `审核通过` or `审核不通过`.
- Workflow dispatch writes its station log first. Lead dispatch writes `staff_notifications` `in_app` first, then attempts WeChat and records `sent`, `failed`, or `skipped`. Enterprise join-result delivery is WeChat-only and best-effort after the status commit. Missing openids/templates and WeChat failures never roll back business data.
- Duplicate-phone lead intake reuses the existing lead and emits no new enterprise-administrator or designer notification.

## Handoff Checklist

- [x] All six templates appear in `我的模板`.
- [x] All six IDs and exact keyword keys are recorded.
- [x] Admin configuration stores six typed IDs.
- [x] The Mini Program authorizes role-scoped templates and separately authorizes join-result on open-account submit.
- [x] Server payloads contain only keys accepted by the selected template.
- [x] In-app delivery, channel-scoped deduplication, and WeChat failure logs are preserved where applicable.
- [x] Bilingual Admin/Mini Program inventories and this baseline pair are synchronized.
- [ ] Keep validating `measurement_appointment` delivery against every appointment event path in production.
