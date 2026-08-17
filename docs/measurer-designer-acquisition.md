# Measurer–Designer Acquisition Collaboration and Commission Contract

This is the focused business and data contract for the measurer–designer lead-acquisition loop. When this feature is refined, read this document together with the current code, PostgreSQL schema, migrations, and the English/Chinese module inventories. If implementation and this contract diverge, update the contract and record the compatibility decision first.

## Planned replacement

The referrer-network and appointment loop has an approved design direction but is not implemented yet. The breaking redesign starts from the [Referrer Network and Measurement Appointment Development Plan](./referrer-network-appointment-development-plan.md). Until the replacement is complete, this document describes the currently implemented legacy flow and is not evidence for the new workflow.

## 1. Scope and outcome

The feature covers:

1. Binding every measurer to one designer within the same enterprise.
2. Requiring a designer WeChat ID and personal WeChat QR asset.
3. Creating a lead from the Mini Program and automatically assigning the bound designer.
4. Letting the assigned designer confirm the WeChat handoff without changing lead progress.
5. Generating one pending-settlement measurer acquisition commission per confirmed lead.
6. Keeping an in-app notification as the reliable channel and using WeChat subscription messages as a best-effort enhancement.

This feature is separate from order commissions. Acquisition confirmation is independent from the lead lifecycle and never gates surveying, design, or conversion.

## 2. Implementation status

| Capability | Status | Contract |
| --- | --- | --- |
| Measurer–designer binding | `Implemented` | One current binding per measurer; one designer may serve many measurers. |
| Designer WeChat profile | `Implemented` | WeChat ID and QR asset are required for designer accounts; QR data is stored through `media_assets`. |
| Measurer lead creation | `Implemented` | The server derives promoter, assigned designer, and `new` status; client ownership/status fields are ignored. |
| Designer acquisition confirmation | `Implemented` | The assigned designer can confirm during supported open lifecycle stages; the conditional update writes audit facts only. |
| Role-aware Acquisition Collaboration workbench | `Implemented` | Designers process pending handoffs; measurers use one page-level current-designer entry and review waiting states, receipts, and commission summaries inside task cards. |
| Acquisition commission | `Implemented` | Independent table, fixed enterprise amount snapshotted at confirmation, initially `pending_settlement`. |
| Notifications | `Implemented` | In-app notification is persisted first; lead handoffs use `lead_assignment`, acquisition-commission reminders use `workflow_todo`, and WeChat `sent`/`failed`/`skipped` outcomes never roll back business data. |
| Automatic payout | `Limited` | Settlement is manual; no payment-provider or bank disbursement integration exists. |

## 3. Business rules

### 3.1 Staff relationship

- A measurer must bind to an active designer in the same enterprise.
- A measurer has one current binding; a designer can have many measurers.
- Rebinding affects only future leads. Historical leads retain their original `assigned_to` designer.
- A designer with active measurer bindings cannot be deleted or deactivated until those bindings are changed.
- Designer accounts require `wechat_id` and a personal QR asset. QR access is signed and enterprise-scoped; QR Base64 is not stored in the account row.

### 3.2 Lead creation and status

- `POST /api/leads` derives `promoter_id` from the authenticated measurer.
- The server resolves `assigned_to` through `measurer_designer_bindings`; the client cannot override owner or status.
- `PUT /api/leads/[id]` rejects `assignedTo`; creation-time designer ownership is read-only on the lead and a binding change in Staff affects only future leads.
- New leads are created with `status = 'new'`.
- Existing phone de-duplication remains in force. A duplicate lead does not create a second notification or commission.
- A measurer without a binding cannot create a new lead and receives an explicit binding error.

The product-facing lead workflow uses one canonical current status:
`new` (New lead) -> `measuring` (Measuring) ->
`designing` (Design proposal) -> `converted` (Signed). `closed` is a terminal
exception and is not part of the main four-step rail. Historical values
`contacted`, `measured`, `assigned`, and `quoting` remain readable and map to
New lead or Design proposal; new writes and floor-plan-driven transitions use
the canonical values.

Linking a draft floor plan moves a `new` lead to `measuring`.
Linking a completed formal floor plan moves an open `new` or
`measuring` lead to `designing`. The existing `acquired_at` and `acquired_by`
fields remain the audit record after the current status advances.

### 3.3 Designer confirmation

- `POST /api/leads/[id]/acquire` is restricted to the designer role.
- The designer must be the lead's current `assigned_to` user.
- `new`, `measuring`, `designing`, and `converted` plus compatible historical values can be confirmed once; an unconfirmed `closed` lead rejects ordinary designer correction.
- The update writes only `acquired_at`, `acquired_by`, and `updated_at`; lifecycle `status` is unchanged.
- Lead update and unique commission creation happen in one transaction; concurrent retries can succeed only once.

### 3.4 Commission

- Enterprise setting: `enterprises.measurer_acquisition_fixed_commission`, default `0.00`.
- Only the enterprise administrator can read or change the setting through the acquisition-commission rule endpoint; it belongs to the enterprise, not to an employee profile.
- The amount is snapshotted when the designer confirms the lead; later setting changes do not alter history.
- `lead_id` is unique, so one lead can produce at most one acquisition commission.
- States are `pending_settlement`, `paid`, and `voided`. The implemented settlement transition is `pending_settlement -> paid`.
- A paid record stores `settled_at` and `settled_by`.

### 3.5 Lead conversion

- Conversion is a lead-lifecycle fact independent of WeChat acquisition confirmation and acquisition commission. Marking or reverting conversion creates no order, charge, acquisition commission, settlement, or reversal.
- An in-tenant `enterprise_admin` may convert any active, non-closed lead. A `designer` may convert only a lead whose `assigned_to` is that designer. Measurers and ordinary staff have no conversion permission.
- `new`, `measuring`, `designing`, and compatible historical states can enter `converted`. A direct early-stage conversion is warned about in the confirmation UI but remains valid; `closed` leads must be reopened and archived leads restored first.
- The signing date is required, checked in the China time zone, and cannot be later than today. Contract amount and note are optional; the amount is only a lead snapshot, not an order or financial ledger.
- The transaction writes `converted_on`, `converted_at`, `converted_by`, `converted_from_status`, `contract_amount`, and `conversion_note`, then appends a `converted` lifecycle event.
- Only an in-tenant `enterprise_admin` can revert conversion, with a required reason. Reversion restores the pre-conversion status, clears the current conversion summary, and appends a `conversion_reverted` event retaining the audit reason.
- Generic `POST /api/leads` cannot create `converted`, and neither `PUT /api/leads/[id]` nor floor-plan import/linking can enter or leave `converted`. The repository rechecks under the row lock so a concurrent ordinary update cannot overwrite a conversion fact. Clients must use the dedicated endpoints so permission, validation, and audit rules cannot be bypassed.
- Dedicated actions require an enterprise context. Across detail and create/dedup responses, ordinary WeChat customers may read only the converted status and signing date; internal amount, note, operator, and exact operation time are omitted.

## 4. Data model

### `admin_users`

- `wechat_id`: designer WeChat ID.
- `wechat_qr_asset_id`: `media_assets` reference for the personal QR code.
- Staff DTOs expose `boundDesignerId` for measurers and signed designer QR data only within the permitted enterprise context.

### `measurer_designer_bindings`

- `measurer_id` is the primary key and enforces one current binding per measurer.
- `designer_id` identifies the bound designer.
- `enterprise_id` is the tenant boundary and same-enterprise validation key.
- `created_at` and `updated_at` provide relationship timestamps.

### `leads`

- `promoter_id`: measurer who entered the lead.
- `assigned_to`: designer captured at lead creation; historical ownership is not rewritten after rebinding.
- `status`: canonical current status `new`, `measuring`,
  `designing`, `converted`, or `closed`; historical values remain readable and
  are normalized in API filters and client labels.
- `converted_on`, `converted_at`, `converted_by`, `converted_from_status`, `contract_amount`, and `conversion_note`: current signing date, operator audit, reversion restore point, and optional contract summary. The amount does not enter the order, charge, or commission ledgers.
- `acquired_at` and `acquired_by`: confirmation audit fields.
- DTOs derive `acquisitionStatus` from `acquired_at` and expose an independent `acquisitionCommissionStatus`; no persisted acquisition-status column is added.
- `archived_at`, `archived_by`, `archive_reason`, and `archive_note` are an independent visibility lifecycle. Archived leads retain floor plans, formal surveys, AI workflows/generations, acquisition facts, commissions, notifications, and follow-ups for history and can be restored without changing ownership or settlement facts. Archived leads are hidden from acquisition tasks and all lead write paths return `409 LEAD_ARCHIVED`.

### `lead_acquisition_commissions`

- Unique `lead_id`.
- Enterprise, measurer, and designer ownership snapshots.
- `commission_amount` as `numeric(14,2)` snapshot.
- `status`, `generated_at`, `settled_at`, and `settled_by` for settlement audit.

### `staff_notifications`

- Stores recipient, enterprise, lead, notification type, in-app status, WeChat status, error, dedupe key, and navigation parameters.
- Delivery always creates the in-app channel before attempting WeChat. A missing
  OpenID, missing template, missing authorization, transport failure, or WeChat
  error code is recorded as `skipped` or `failed` without changing the business
  response.
- New-lead designer handoffs use the version-2 `lead_assignment` template;
  measurer acquisition-commission reminders use `workflow_todo`. Enterprise
  owners receiving a genuinely new lead use `new_lead`. Reused duplicate-phone
  leads do not create either channel again.
- `(dedupe_key, channel)` is a partial unique index when a dedupe key exists;
  notification inserts use the same `dedupe_key IS NOT NULL` predicate in
  their conflict target so PostgreSQL can apply this de-duplication rule.
- Lead notifications navigate to `/packages/business/acquisition-center/acquisition-center?leadId=<leadId>`.

## 5. API contract

| API | Permission | Behavior |
| --- | --- | --- |
| `POST /api/staff`, `PUT /api/staff/[id]` | Enterprise admin, `admin`, `super_admin` | Validate designer profile and same-enterprise active designer binding. |
| `POST /api/staff/wechat-qr` | Staff-management permission | Multipart image upload to `media_assets` using the active default media-storage provider; returns asset ID and short-lived URL. Historical assets continue to use their recorded provider. |
| `POST /api/leads` | Authenticated lead creator; measurer flow is server-derived | Writes measurer, bound designer, and `new`; preserves phone de-duplication. |
| `POST /api/leads/[id]/acquire` | Assigned designer | Atomically records the handoff without changing lifecycle status, creates the unique pending commission, and notifies the measurer. |
| `POST /api/leads/[id]/convert` | In-tenant enterprise admin or assigned designer | Atomically marks an active open lead as `converted`, validates a non-future signing date, and records the optional amount/note plus lifecycle audit. |
| `POST /api/leads/[id]/revert-conversion` | In-tenant enterprise admin | Requires a reason, restores the pre-conversion status, and records the reversion audit without changing orders, charges, or acquisition commission. |
| `GET /api/leads?archiveState=archived` | `leads.archive_manage` | Reads the archived-only area; normal list queries default to active leads. |
| `POST /api/leads/archive-preview`, `POST /api/leads/archive` | `leads.archive_manage` plus row access | Preview and archive up to 100 leads, retaining all business assets; in-flight AI jobs block only the affected rows. |
| `POST /api/leads/[id]/restore` | `leads.archive_manage` plus row access | Restores visibility and original business state/relations. |
| `GET /api/leads/[id]/purge-preview`, `DELETE /api/leads/[id]` | Enterprise/platform manager only | Preview and permanently delete only an archived empty lead after exact-name confirmation; protected relationships return `409` and no force cascade exists. |
| `GET /api/acquisition-tasks` | Current Mini Program designer or measurer | Role-isolated pending/completed tasks, pagination, time filters, and truthful summaries. Measurer responses add one page-level current-binding `designerProfile`; task rows do not repeat WeChat or QR fields. |
| `GET /api/acquisition-commissions` | Measurer sees own records; enterprise/platform admins can filter by tenant | Lists records and summaries by enterprise, measurer, and status. |
| `POST /api/acquisition-commissions/[id]/settle` | Enterprise admin, `admin`, `super_admin` | Allows only `pending_settlement -> paid`. |
| `GET/PATCH /api/acquisition-commissions/settings` | Enterprise admin in its own enterprise | Reads or updates the fixed amount for future acquisition confirmations. |
| `GET /api/miniprogram/notifications` | Authenticated Mini Program staff | Lists the employee's notifications and unread count. |
| `POST /api/miniprogram/notifications/read` | Authenticated Mini Program staff | Marks only the employee's notifications as read. |

Tenant endpoints must continue to use shared tenant helpers, RLS transactions, and the authenticated staff context. Do not hand-roll cross-enterprise filters.

## 6. Client entry points

### Admin

- `/staff`: designer WeChat profile and measurer-to-designer binding only.
- `/acquisition-commissions`: settlement-record filters, summaries, and manual settlement; `/acquisition-commissions/settings` is the enterprise-admin-only fixed commission rule page.
- `/leads`: lead list, canonical four-step business labels, an independent acquisition-confirmation filter, and the terminal `closed` filter. Its detail drawer exposes single-lead conversion and manager-only reversion from server-provided permissions; bulk conversion is not provided.

### Mini Program

- `pages/leads-management/leads-management`: four-step business filters and a lightweight measurer-only `我的设计师` entry below the capsule safe lane.
- `packages/business/acquisition-center/acquisition-center`: designer confirmation plus one page-level measurer designer-contact entry and task-level waiting/receipt/commission-summary views. Its task list supports native `scroll-view` pull-to-refresh and refreshes the active status every 30 seconds only while the page is visible; polling is cleared on hide/unload and shares the active-request guard.
- `packages/business/lead-detail`: a separate conversion progress area below the four-step rail and safe-area bottom confirmation sheets, with server-authorized manager/assigned-designer conversion and manager-only reversion. Acquisition confirmation remains outside this page.
- `components/designer-contact-sheet/designer-contact-sheet`: the shared read/copy-only bottom sheet used by Leads, lead detail, and the workbench. It retrieves the protected QR with `wx.request` as image bytes, writes an app-local temporary image, then gives that local path to `<image>`; this keeps the existing signed, enterprise-scoped authorization while avoiding the separate remote-image download-domain/cache path. Retry unmounts the failed image, shows a bounded refresh state, and refreshes the role-scoped parent profile; each request includes a client-only cache key outside the signed payload.
- `packages/business/commission-records`: measurer acquisition commission summary and detail.
- `pages/mine`: unread notification entry.

Only measurers see the designer QR and acquisition commission entry. Designers do not see the measurer commission entry. Mini Program additions must preserve the native capsule safe area and project typography floors.

## 7. Transaction, idempotency, and security

1. Notifications are delivered after the lead transaction commits: persist the in-app channel, then attempt WeChat, then record `sent`/`failed`/`skipped`. WeChat failure never rolls back the lead or commission.
2. Conditional `assigned_to + acquired_at IS NULL + supported lifecycle` update plus the unique `lead_id` index prevents duplicate confirmation and commission generation.
3. Designers can confirm only their assigned leads. Measurers can read only their own leads, one page-level current bound-designer profile, and commissions. Task rows keep historical assignee identity facts but do not repeat WeChat IDs or QR data.
4. QR delivery verifies enterprise ownership and uses a signed URL; storage keys and unrestricted public URLs must not be exposed.
5. Rebinding never rewrites historical leads or generated commissions.
6. Archive and purge transactions lock the lead row and recheck relationships before commit; a lead with any current or historical conversion fact cannot be permanently deleted as an empty lead. Lifecycle events keep actor/time/lead/action/reason and aggregate impact without customer PII, including after purge. Duplicate phone intake returns `409 ARCHIVED_LEAD_EXISTS` for an archived match and never creates a replacement commission.

## 8. Refinement backlog

- Define the `voided` entry point, reason, audit event, and correction policy.
- Confirm amount precision, bounds, and bulk configuration/import rules.
- Add operator guidance and monitoring for exhausted one-time subscription grants, authorization expiry, and re-authorization.
- Define staff deactivation, enterprise transfer, designer departure, and outstanding settlement behavior.
- Add binding-change audit history: who bound which measurer to which designer and when.
- Expand PostgreSQL integration coverage for de-duplication, concurrent confirmation, tenant isolation, and notification de-duplication.

## 9. Implementation references

- Migrations: `admin/drizzle/0016_measurer_designer_acquisition.sql`, `admin/drizzle/0017_acquisition_workbench.sql`, `admin/drizzle/0019_lead_archive_lifecycle.sql`, `admin/drizzle/0020_lead_lifecycle_actor_indexes.sql`, `admin/drizzle/0023_lead_conversion.sql`
- Schema: `admin/src/db/schema.ts`
- Staff APIs: `admin/src/app/api/staff/`, `admin/src/app/api/staff/wechat-qr/`
- Lead APIs: `admin/src/app/api/leads/`, `admin/src/app/api/leads/[id]/acquire/`, `admin/src/app/api/leads/[id]/convert/`, `admin/src/app/api/leads/[id]/revert-conversion/`
- Task/commission APIs: `admin/src/app/api/acquisition-tasks/`, `admin/src/app/api/acquisition-commissions/`
- Notification APIs: `admin/src/app/api/miniprogram/notifications/`
- Admin pages: `admin/src/app/(admin)/(merchant)/staff/`, `admin/src/app/(admin)/(merchant)/acquisition-commissions/`
- Mini Program pages: `miniprogram/pages/leads-management/`, `miniprogram/pages/mine/`, `miniprogram/packages/business/acquisition-center/`, `miniprogram/packages/business/lead-detail/`, `miniprogram/packages/business/commission-records/`
