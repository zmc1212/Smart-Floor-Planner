# Mini Program Subscription Notification Template Baseline

Status: `Limited` (four-template configuration, aggregate authorization, and the first three runtime mappings are implemented; a real on-site measurement appointment trigger is not implemented).

Date: 2026-08-12

This document is the current implementation contract for the first four WeChat Mini Program public templates selected from the `房屋装修` category. Every ID and keyword key has been read back from `订阅消息 -> 我的模板`. Server payloads must use the selected template's strict field allowlist and must not reuse the retired generic field set.

## Confirmed Templates

| Priority | Type | Template | Business scenario | Template ID | Keyword contract |
| --- | --- | --- | --- | --- | --- |
| 1 | `workflow_todo` | `装修待办提醒` | Follow-up, measurement, design, closure, and acquisition-commission tasks | `48Jvq7OjOKwRhshn8fyvtsjxAamLOakaNtiKcO11rOc` | `thing4` project name; `thing11` owner; `phrase12` current status; `thing2` todo; `thing5` note |
| 2 | `lead_assignment` | `客户指派成功通知` | A lead is assigned to a measurer or designer | `wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA` | `thing1` customer name; `phrase2` customer status; `thing3` note; `time4` time |
| 3 | `new_lead` | `新增客户成功通知` | A new lead is created and reported to enterprise administrators | `EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc` | `name1` customer name; `date2` added time; `name3` owner; `phone_number4` phone; `time5` selected time |
| 4 | `measurement_appointment` | `上门量房提醒` | A confirmed, explicit on-site measurement appointment | `CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl` | `thing1` name; `phone_number2` phone; `thing3` community; `time6` measurement time; `thing7` reminder |

## Runtime Mapping

| Notification type | Template | Status |
| --- | --- | --- |
| `follow_up_created`, `follow_up_overdue`, `conflict_pending`, `measure_overdue`, `measure_submitted`, `design_overdue`, `design_completed`, `record_closed`, `lead_acquired_commission_pending`, and other generic workflow reminders | `workflow_todo` | `Implemented` |
| `measure_assigned`, `design_assigned`, `lead_assigned`, and `lead_pending_acquisition` | `lead_assignment` | `Implemented` |
| Enterprise-administrator notification after new lead creation | `new_lead` | `Implemented` |
| Confirmed on-site measurement appointment | `measurement_appointment` | `Limited`: there is no appointment time/confirmation model or real event. `measureDueAt` is an SLA deadline and must not be reused. |

Until a real appointment feature exists, `new_lead.time5` uses the approved transitional rule: `assignedAt` first, then `createdAt`. It must not pretend to be a future appointment.

## Implemented Contract

- `platform_configs.notification_config` stores a `version: 2` four-template map with IDs, keyword contracts, and optional `legacyTemplateId`. Reading and PATCHing the former single `miniprogramTemplateId` remains compatible for one release.
- `GET/PATCH /api/platform/notification-config` lets platform `admin`/`super_admin` users maintain four non-empty, valid, distinct IDs. `/workflow-logs` uses its existing configuration card and shared operation feedback.
- `GET /api/miniprogram/notification-template` returns an ordered four-template list plus the deprecated single-value alias to authenticated staff. The client caches only a complete V2 configuration and has no bundled template-ID fallback.
- Login, Mine, and Settings request all four differently titled templates in one `wx.requestSubscribeMessage` call. Settings keeps the approved single-row layout and distinguishes full, partial, rejected, disabled, unset, and unavailable states.
- Server builders emit only approved keys and normalize empty values, character limits, and China-time `YYYY-MM-DD HH:mm:ss` values.
- Workflow dispatch writes its station log first. Lead dispatch writes `staff_notifications` `in_app` first, then attempts WeChat and records `sent`, `failed`, or `skipped`. Missing openids/templates and WeChat failures never roll back business data.
- Duplicate-phone lead intake reuses the existing lead and emits no new enterprise-administrator or designer notification.

## Handoff Checklist

- [x] All four templates appear in `我的模板`.
- [x] All four IDs and exact keyword keys are recorded.
- [x] Admin configuration stores four typed IDs.
- [x] The Mini Program authorizes four templates together and reports partial acceptance.
- [x] Server payloads contain only keys accepted by the selected template.
- [x] In-app delivery, channel-scoped deduplication, and WeChat failure logs are preserved.
- [x] Bilingual Admin/Mini Program inventories, acquisition contracts, and UI/visual ledgers are synchronized.
- [ ] Enable `measurement_appointment` delivery only after a real appointment model/API/confirmation event exists.
