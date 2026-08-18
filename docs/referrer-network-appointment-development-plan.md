# Referrer Network and Measurement Appointment Development Plan

Status: `Approved design / Phase 7 completed`

This document is the durable implementation entry point for the breaking redesign covering multi-enterprise referrers, phone-authorized lead creation, automatic assignment, measurement appointments, published AI designs, conversion, and three-role commissions. Current code, PostgreSQL schema, migrations, and module inventories remain the authority for implemented behavior. Every table, API, and route in this plan remains `Planned` until code and tests prove otherwise.

The current legacy contract is [measurer-designer-acquisition.md](./measurer-designer-acquisition.md). The new workflow replaces measurer-created leads, measurer-designer binding, acquisition confirmation, and the legacy acquisition commission. It does not provide compatibility or migrate legacy business data.

Chinese mirror: [referrer-network-appointment-development-plan.zh-CN.md](./referrer-network-appointment-development-plan.zh-CN.md)

## 1. Approved design source

### 1.1 Canonical asset

- Selected design: `design-references/referrer-network-appointment-v1/selected-option-a.png`
- Canvas: `1024x1536` PNG; production baseline is iPhone 13 Pro at `390x844`.
- SHA-256: `06f20a90207e1c9deea7f3552fd22d568c19f3b05ae8fd9024710e5289f3ae55`
- Composition: Option A is the base; the middle “Confirm claim” screen uses Option B's information architecture.
- Production method: after the built-in image tool was unavailable, Sub2API `gpt-image-2` produced the edit and a deterministic mask composite restricted the replacement to the middle phone.

`design-references/` is Git-ignored and the design board must never enter the Mini Program package. If the file is missing or its hash differs, ask the product owner before substituting or inventing a design.

The phase-5 internal referrer workbench uses `design-references/referrer-network-appointment-v1/phase-5-referrer-workbench-v1.png`, a `1024x1536` PNG composed for the `390x844` baseline. It applies only to an authenticated referrer choosing an enterprise and entering its service code, never to the anonymous customer claim path. Antigravity's built-in image engine regenerated this source, but did not expose a verifiable concrete Google image model name, so this document does not mislabel it as `Gemini 3 Pro Image`.

The approved Phase-7 Admin commission workbench source is `design-references/referrer-network-appointment-v1/phase-7-three-role-commission-admin-v1.png`, a `1487x1058` PNG (SHA-256 `DAA7ED1235C474F0C6A0D7FC625A5DD0BD9D97E54F580AB4CD530CE743AB2A1C`) generated with Codex built-in image generation and approved for implementation. It applies only to `/lead-commissions`: the three role-rule cards, ledger filters, batch paid control, and amount summaries. It is a desktop Admin reference, must not be sliced or shipped as runtime UI artwork, and does not alter the legacy acquisition-commission page.

### 1.2 Screen mapping

| Screen | User and moment | Production meaning |
| --- | --- | --- |
| Left, “Free design service” | A referrer shows the promotion code to a customer | Public service code emphasizing free on-site measurement and free designer service. The QR contains only an unguessable short token. |
| Middle, “Confirm claim” | Customer after scan and before phone authorization | Service contents, claim steps, privacy copy, and the WeChat phone authorization action. |
| Right, “Service claimed” | After the user, lead, attribution, and assignment transaction commits | Assigned designer name, personal WeChat ID, personal QR, and service-profile confirmation. |

The board-level note about automatic lead insertion and assignment is an implementation annotation, not customer UI.

### 1.3 Immutable UI and privacy rules

1. The promotion code, scan landing page, phone authorization page, and authorization success page must not show a renovation-company name, company logo, enterprise selector, joined-enterprise count, or copy that identifies the receiving enterprise.
2. A referrer selects the target enterprise inside the authenticated workbench. The enterprise relationship is resolved server-side from the short token and is neither plaintext QR data nor customer-visible content.
3. A scan records only a pending referral source. It does not create a business identity or lead before phone authorization.
4. Successful authorization atomically links or creates the customer, locks first valid attribution, creates the lead, and assigns a designer and provisional measurer.
5. The success page shows only personal designer WeChat data, not the employer. Names, WeChat IDs, and QR images in the board are placeholders.
6. An authenticated customer project or appointment card may show the service enterprise, designer, measurer, address, and appointment after lead creation. The anonymous boundary applies only to the public promotion and claim flow.
7. Production must use native WXML/WXSS, semantic controls, and project icon assets. Never slice or paint the design board into product UI.
8. Add a route to the English and Chinese restoration ledgers only after that runtime route exists; each route retains one current design source row.

### 1.4 Generated asset and production-path mapping

Antigravity 2.8.1 used its built-in `generate_image` capability with the selected board, F1/F3 brand reference, and role-scene reference in a fixed order to create `design-references/referrer-network-appointment-v1/generated-assets-v1/referral-service-assets-board-v1.png`. That board remains a design reference only. The Mini Program package contains only the six optimized transparent PNGs extracted from independent asset cells plus the service-code-guide Xiao K PNG from a standalone referrer-workbench asset task, with no page layout, controls, or embedded page copy.

| Design element | Production path |
| --- | --- |
| Thumbs-up Xiao K | `miniprogram/packages/business/assets/referral-service-v1/thumbs-up-xiao-k.png` |
| On-site measurement service | `miniprogram/packages/business/assets/referral-service-v1/onsite-measurement.png` |
| Designer service | `miniprogram/packages/business/assets/referral-service-v1/designer-service.png` |
| Phone authorization | `miniprogram/packages/business/assets/referral-service-v1/phone-authorization.png` |
| Designer matching | `miniprogram/packages/business/assets/referral-service-v1/designer-matching.png` |
| Privacy lock | `miniprogram/packages/business/assets/referral-service-v1/privacy-lock.png` |
| Referrer service-code-guide Xiao K | `miniprogram/packages/business/assets/referrer-workbench-v1/service-code-guide.png` |

## 2. Target workflow

```text
Enterprise dual-code onboarding
  -> referrer joins enterprises and selects one for a dedicated promotion token
  -> customer scans; server records only a pending source
  -> customer authorizes phone number
  -> atomic user, attribution lock, lead, and audit creation
  -> automatic designer assignment and provisional measurer assignment
  -> designer confirms the first appointment
  -> customer reschedules to a genuinely available slot before the cutoff
  -> measurer submits a formal v4 floor plan
  -> designer generates and explicitly publishes an AI design
  -> designer or enterprise administrator confirms conversion
  -> snapshot three commission rules and create three payables
```

The canonical lead lifecycle remains:

```text
new -> measuring -> designing -> converted
closed is terminal
```

Appointment status, publication status, conversion facts, and commission states remain separate from lead lifecycle status.

## 3. Current baseline and replacement boundary

The runtime uses PostgreSQL 17, Drizzle repositories, and RLS. These implemented legacy capabilities are removed by this plan:

- `measurer_designer_bindings`.
- Measurer-created leads and designer `POST /api/leads/[id]/acquire` confirmation.
- `lead_acquisition_commissions`.
- `packages/business/acquisition-center/acquisition-center`.
- Merchant `acquisition-commissions` pages and their settings/settlement APIs.

Replacement rules:

- No compatibility wrapper for old write endpoints.
- No conversion of old bindings or acquisition commissions.
- New and old schema may coexist during development and testing; production cutover occurs only after approved business-data cleanup.
- Do not remove legacy code, tables, or menu entries until the replacement workflow passes end-to-end verification and both language inventories/contracts are updated.

## 4. Target identity model

### 4.1 Identity structure

- A WeChat user is the base identity. OpenID/UnionID live only in `wechat_identities`; business tables reference `user_id`.
- One user may be a customer, have at most one staff enterprise identity, and have multiple referrer-enterprise memberships.
- Staff belong to one enterprise. Moving enterprise requires an administrator and must not be achieved by rescanning.
- The platform-configured referrer membership limit defaults to `3`. Leaving permits a new membership without rewriting historical leads or commissions.
- Staff and referrer modes are independent and switchable.

### 4.2 JWT context

Mini Program JWT claims include:

- `sub`: base user ID.
- `mode`: `customer | staff | referrer`.
- `enterpriseId`: active enterprise context, nullable.
- `staffId`: active staff identity, nullable.
- `referrerMembershipId`: active referrer membership, nullable.
- `contextVersion`: invalidates old tokens after identity or membership changes.

The full context list is read from the database. Context switching revalidates active membership and issues a new token.

## 5. Target data model

Phase 1 persists the target tables below in `admin/src/db/schema.ts` and migration `0024_same_shockwave.sql`. Later phases must implement business writes on these constraints and repository conventions instead of creating a parallel data model.

| Entity/table | Core contract |
| --- | --- |
| `wechat_identities` | `user_id`, unique `openid`, optional `unionid`; business tables do not duplicate OpenID. |
| `enterprise_join_codes` | Enterprise, `staff/referrer` type, token hash, state, version, expiry, creator/disabler; one active token per type. |
| `enterprise_join_code_events` | Rotation, disablement, resolution, and onboarding audits. |
| `referrer_profiles` | One profile per base referrer user. |
| `referrer_enterprise_memberships` | Referrer, enterprise, state, joined/left timestamps; active relationship unique and historical rows retained. |
| `referrer_promotion_codes` | Membership, random short-token hash, state, version; one current code per active membership. |
| `promotion_scan_audits` | Token, WeChat session, result, IP/device summary, and time; no OpenID copied to leads. |
| `customer_attribution_locks` | Customer user, active lead, membership, enterprise, locked/released times; partial unique index permits one active lock per customer. |
| Extended `leads` | Customer user, referrer membership, measurer, attribution time, assignment state/error; `assigned_to` remains designer. |
| `lead_assignment_events` | Automatic designer/measurer assignments, retries, replacements, and failure reasons. |
| `enterprise_appointment_settings` | Weekly hours, default duration, step, horizon, and customer cutoff. |
| `staff_unavailability_periods` | Measurer leave/unavailable `tstzrange`, reason, and actor. |
| `measurement_appointments` | Lead, designer, measurer, address, time range, state, version, and current actor. |
| `measurement_appointment_events` | Create, reschedule, replace, cancel, complete with before/after times, before/after measurer, actor, and reason. |
| `enterprise_commission_rules` | Unique enterprise + `referrer/designer/measurer` role; `fixed/percentage`, value, state, version. |
| `lead_commissions` | Unique lead + role; beneficiary, rule snapshot, contract amount, payable amount, `payable/paid/voided`, finance audit. |
| `ai_generation_publications` | Project/lead, AI generation, publisher/unpublisher, timestamps; customers read only active publications. |

Every enterprise business table enables and forces RLS and uses existing tenant repository helpers. API DTOs explicitly serialize `bigint`.

## 6. Dual codes and referrer network

Phase 2 implements this section's server contract. Enterprise administrators can list, rotate, and disable distinct staff/referrer join codes, with rotation and resolution outcomes audited. A Mini Program user with an authorized phone can join one enterprise as staff or join the referrer network up to the default three-enterprise limit, then list or exit memberships and retrieve the current promotion token. Tokens are server-key-derived, opaque 192-bit values; PostgreSQL stores only their SHA-256 hashes and no plaintext enterprise identifier is encoded.

Phase 2 made `POST /api/miniprogram/codes/resolve` classify join/promotion tokens, validate state, and write audits. Phase 3 adds a ten-minute encrypted and authenticated pending source for valid promotion codes. Phase 4 now ships the approved promotion-code display and customer claim routes. Resolution still creates no lead; attribution and lead creation happen only when the customer authorization endpoint submits that source.

### 6.1 Enterprise onboarding codes

- Staff and referrer codes have distinct `code_type` values and cannot cross onboarding endpoints.
- QR payloads contain random short tokens with at least 128 bits of entropy; the database stores hashes only.
- Rotation creates a new version and disables the previous version transactionally. Old codes resolve as `code_rotated`.
- A staff scan plus phone authorization and `designer/measurer` selection takes effect immediately.
- A referrer scan plus authorization creates an active membership immediately; the configured limit returns `membership_limit_reached`.
- Designers join the assignment pool only after WeChat ID and personal QR completion. Measurers join after basic profile completion.

### 6.2 Referrer promotion codes

- Each active membership owns one dedicated promotion code.
- The authenticated workbench lists memberships, supports leaving, selects the internal enterprise, and opens its code.
- The customer-visible code screen obeys section 1.3. Enterprise selection never appears in the display/share surface.
- Leaving disables future scans but does not alter locked leads, appointments, or commission beneficiaries.

## 7. Authorization and first valid attribution

Phase 3 implements this server contract. `POST /api/miniprogram/referrals/authorize-and-create-lead` accepts either a phone-authorized `customer` token or direct WeChat `loginCode + phoneCode`; the direct path links the base user, locks attribution, creates the lead, and records assignment facts in one PostgreSQL transaction. `Idempotency-Key` is required, and the same customer/key returns the original lead. A partial unique index plus a customer-scoped transaction lock protects the active attribution. Closing a lead through `LeadRepository.update` releases the active lock in the same transaction.

Scanning has two stages:

1. `resolve` validates the token and creates a short-lived signed pending source without creating a lead.
2. Phone authorization atomically links the user, creates the attribution lock and lead, performs assignment, and writes audit facts.

Concurrency and idempotency:

- Attribution locks use base customer user ID, not phone or OpenID.
- A partial unique constraint on active `customer_attribution_locks` is the final concurrency guard.
- Another code cannot overwrite an open lead's enterprise/referrer. Return the existing project summary without disclosing the newly scanned enterprise.
- Closing the original lead releases the lock transactionally before a new attribution is allowed.
- The authorization endpoint accepts an idempotency key and returns the same lead on retry.
- Notifications run after commit and never roll back the lead.

## 8. Automatic assignment

Phase 3 implements stable server-side assignment. An enterprise-scoped transaction lock serializes load calculation. Designers sort by open-lead count, last assignment, and staff ID; measurers sort by pending measurement-lead count, future appointment duration, last assignment, and staff ID. If either role is unavailable, the lead remains `assignment_pending` and enterprise owners are notified. The service-only retry endpoint and staff onboarding, creation, profile completion, or assignment re-enable trigger idempotent retries.

### 8.1 Designers

Eligible designers are active, same-enterprise users with the designer role, complete WeChat ID and QR, and assignment enabled. Stable sort order:

1. Open lead count ascending.
2. `last_assigned_at NULLS FIRST`.
3. Staff ID ascending.

### 8.2 Measurers

Lead creation provisionally assigns an active same-enterprise measurer. Stable sort order:

1. Pending measurement task count ascending.
2. Future appointment occupied duration ascending.
3. `last_assigned_at NULLS FIRST`.
4. Staff ID ascending.

The first appointment or reschedule retains the provisional measurer if available; otherwise choose the lowest-load available measurer using the same tie-breaks.

Assignments lock candidate statistics or use retryable conditional updates. No eligible staff leaves the lead intact with `assignment_pending`, a reason code, and an administrator notification. Staff onboarding, profile completion, or assignment re-enable triggers idempotent retry.

## 9. Appointments and rescheduling

Defaults: `09:00-18:00` daily, `120` minutes, `30` minute step, `30` day horizon, and customer reschedule cutoff `2` hours before start.

Database conflict contract:

- Store appointment and unavailable intervals as UTC `tstzrange`; render in enterprise time zone.
- Enable `btree_gist` and add a measurer + time-range exclusion constraint for active appointments.
- The partial constraint explicitly states whether `cancelled` and `completed` participate; application checks alone are insufficient.
- Use optimistic `version`; stale writes return `appointment_version_conflict`.

Flow:

1. Designer selects a server-calculated available slot.
2. Transaction confirms measurer availability and replaces the measurer if necessary.
3. After commit, generate the customer card and attempt `measurement_appointment` subscription delivery.
4. Only the lead-bound customer account may open details; forwarded users see an unauthorized state.
5. Before cutoff, customers choose only freshly calculated available slots and the change is immediate.
6. After cutoff, only designer or enterprise administrator may reschedule with a reason.
7. Customers cannot cancel. Designer or enterprise administrator cancels.
8. Every create, reschedule, replacement, cancellation, and completion writes an event.

## 10. Surveying, AI, and customer project

- The only formal surveying entry remains `packages/surveying/editor/surveying-editor` with `leadId` and/or `floorPlanId`.
- Formal floor plans remain v4 `surveyGraph` in millimetres. This plan never revives the legacy editor or legacy `layoutData`.
- Formal submission advances an open `new/measuring` lead to `designing`.
- AI generation and customer publication are separate facts. Customers read only active `ai_generation_publications`.
- The customer project aggregates designer card, latest appointment, formal floor-plan summary, and published designs.
- Public claim pages remain anonymous; the authenticated project and appointment may show the service enterprise.

Phase 6 is implemented through the owner-only customer-project aggregate: `CustomerProjectRepository` aggregates the enterprise, designer contact card, current appointment, completed formal v4 floor-plan summary, and active publications. Reads are enforced by `customer_user_id`, never by phone number or client-supplied enterprise context. The assigned designer or enterprise administrator can only publish/withdraw a succeeded AI generation belonging to the lead; withdrawal retains the generation but immediately removes it from the customer aggregate and protected image endpoint. The approved customer-project screen renders the service rail, actual designer/measurer and appointment data, a completed-formal-plan summary, and explicitly published design cards. It retrieves protected publication images as authenticated bytes into app-local temporary files before previewing them; the formal-plan card remains a summary because the customer API deliberately does not expose an editable graph or a customer editing entry.

## 11. Conversion and three-role commissions

- Enterprises configure separate referrer, designer, and measurer rules as fixed amount or contract percentage.
- If any role uses percentage, conversion requires a positive contract amount.
- The conversion transaction snapshots all rules, beneficiaries, and contract amount and creates three unique `(lead_id, role)` `payable` rows.
- Monetary computation uses decimal arithmetic, never JavaScript floating point. Repository tests lock the rounding rule.
- Enterprise administrators mark offline payments `paid` individually or in bulk. The platform does not pay funds.
- Conversion reversal marks unpaid rows `voided` with a reason. Any `paid` row blocks direct reversal until offline correction is complete.
- Reports group customer, referrer, enterprise, designer, measurer, appointment, contract amount, and all three commission states by lead.

Phase 7 now implements the server-side signing and commission-ledger slice. For referral-network leads, `LeadCommissionRepository` locks the three enterprise rules and beneficiaries inside the signing transaction, calculates fixed or percentage values in integer decimal units, and snapshots three unique `payable` records. Percentage rules require a contract amount. Conversion reversion locks commission rows, rejects any paid record, and marks the remaining payable rows `voided` with the supplied reason. Each report record includes customer, referrer membership, enterprise, designer, measurer, and current confirmed-appointment context. The approved `/lead-commissions` workbench lets enterprise/platform administrators maintain the three rules, filter the real ledger by status, role, and created-date range, inspect the joined context, and confirm an offline batch mark-paid action. It is separate from the legacy acquisition-commission page. Legacy acquisition leads that lack the referrer/preassigned-measurer beneficiaries retain their existing conversion behavior until phase 8 removes that flow.

## 12. Planned API families

Exact route names may be adjusted within an implementation slice to match App Router conventions, but semantics and permission boundaries must remain distinct.

| Family | Planned endpoints |
| --- | --- |
| Identity | `GET /api/miniprogram/identity-contexts`, `POST /api/miniprogram/identity-contexts/switch`; implemented in phase 1. |
| Code resolution | `POST /api/miniprogram/codes/resolve`; phase 3 implements type/state resolution, audit, and a ten-minute encrypted pending source for valid promotion codes; resolution creates no lead. |
| Dual-code management | `GET /api/enterprise/join-codes`, `POST /api/enterprise/join-codes/[type]/rotate`, `POST /api/enterprise/join-codes/[type]/disable`; implemented in phase 2. |
| Onboarding | `POST /api/miniprogram/onboarding/staff`, `POST /api/miniprogram/onboarding/referrer`; implemented in phase 2. |
| Referrers | `GET /api/miniprogram/referrer-memberships`, `DELETE /api/miniprogram/referrer-memberships/[id]`, `GET /api/miniprogram/referrer-memberships/[id]/promotion-code`; implemented in phase 2. |
| Service-code image | `GET /api/miniprogram/referrer-memberships/[id]/promotion-code/image`; implemented in phase 4, validates the active membership and calls the WeChat Mini Program code provider outside the database transaction, returning a non-cacheable PNG. |
| Customer lead creation | `POST /api/miniprogram/referrals/authorize-and-create-lead`; phase 3 implements customer-context/direct WeChat phone authorization, idempotent attribution, and atomic lead creation/assignment. |
| Assignment | `POST /api/internal/lead-assignments/[leadId]/retry`; phase 3 implements this for service identity authenticated by an `INTERNAL_SECRET` of at least 32 characters. |
| Availability | `GET /api/appointments/availability`; phase 5 is complete and returns candidate-measurer availability plus the enterprise time zone, duration, step, and maximum advance-day boundary from enterprise schedules, active appointments, and unavailability. |
| Appointments | `GET/POST /api/appointments`, `POST /api/appointments/[id]/customer-reschedule`, `POST /api/appointments/[id]/internal-reschedule`, `POST /api/appointments/[id]/cancel`, `POST /api/appointments/[id]/complete`; phase 5 is complete with optimistic versions, customer/designer/measurer/enterprise-owner boundaries, automatic measurer replacement, event audit, and post-commit staff and subscribed-customer notification attempts for create, reschedule, and cancellation. Customer reads and reschedules derive their tenant from the customer-owned lead or appointment rather than accepting an enterprise ID from the token or request. |
| Calendar/settings | `GET/PUT /api/appointment-settings`, `GET/POST/DELETE /api/measurer-unavailability`; phase 5 is complete. |
| Customer project and design publication | `GET /api/miniprogram/customer-projects/[leadId]`, `GET /api/miniprogram/customer-projects/[leadId]/published-generations/[generationId]/image`, `POST /api/leads/[id]/ai-publications`, `DELETE /api/leads/[id]/ai-publications/[generationId]`; the Phase 6 backend slice is implemented. Customer reads are restricted to the owning project; designers may only publish/withdraw succeeded generations for their assigned leads, while enterprise administrators may manage their tenant's leads. Withdrawn or deleted generations never appear in the customer aggregate or image endpoint. |
| Commissions | `GET/PUT /api/commission-rules`, `GET /api/lead-commissions?status=&role=&fromDate=&toDate=`, `POST /api/lead-commissions/mark-paid`; implemented in the Phase 7 server slice. Rules are tenant-scoped and can only be read/updated with optimistic versions by enterprise/platform administrators; report and payout APIs only return or mutate records in that enterprise. |

Enterprise endpoints use existing tenant route/context helpers and RLS. Internal retries use a service identity and are not exposed to ordinary clients.

## 13. Planned Mini Program and Admin surfaces

Phase 4 routes now exist and are recorded in the restoration ledger:

- `packages/business/promotion-service-code/promotion-service-code`: selected design left screen shown to customers; the code image comes from a protected provider endpoint.
- `packages/business/free-design-service/free-design-service`: selected design middle and right authorization/result states, including token resolution, phone authorization, idempotent lead creation, and designer contact delivery.

The phase-5 runtime routes now exist and are recorded against their approved phase-5 design references in both restoration ledgers:

- `packages/business/referrer-workbench/referrer-workbench`: memberships, internal enterprise selection, promotion-code entry.
- `packages/business/customer-project/customer-project`: the approved Phase 6 customer project folio renders the real appointment, designer/measurer, completed formal-plan summary, and explicitly published design cards; the protected design-image endpoint is read into an app-local file before customer preview. It intentionally has no customer measurement-editor entry or editable floor-plan viewer.
- `packages/business/appointment-reschedule/appointment-reschedule`: server-calculated customer availability and immediate customer reschedule.
- `packages/business/appointment-booking/appointment-booking`: the assigned designer enters from a lead without a confirmed appointment, provides the service address, selects a server-calculated real slot, and creates the first appointment.
- `packages/business/measurer-calendar/measurer-calendar`: confirmed measurer itinerary with an entry to manage unavailability.
- `packages/business/measurer-unavailability/measurer-unavailability`: measurers manage only their own unavailable periods with native date/time pickers, optional reason, save, and delete; server APIs continue to enforce role and ownership.

The Phase-7 merchant route `/lead-commissions` implements the approved Admin source with all three rule cards, status/role/date ledger filters, real joined report columns, a confirmation-protected batch paid action, and amount summaries. It adds the dedicated `lead-commissions` navigation and permission boundary without replacing `/acquisition-commissions`. Other Admin work stays within merchant boundaries and still requires an approved source before visible implementation.

## 14. Notifications and reliability

- In-app notification/task logs are reliable facts; WeChat subscriptions are best effort.
- Send after transaction commit through an outbox or the existing retryable notification log.
- Appointment creation, reschedule, replacement, cancellation, and retry use distinct event keys.
- Enable `measurement_appointment` only after the real appointment table and confirmation event exist. Never reuse `measureDueAt`.
- WeChat `sent/failed/skipped` never rolls back users, leads, appointments, or commissions.

## 15. Production data and object-storage cleanup

The cleanup utility is independent of ordinary Drizzle migrations and must never run automatically during deployment. It requires:

- `dry-run` with per-table retain/delete counts and a Qiniu candidate manifest.
- Database fingerprint: environment, database, schema, migration head, administrator counts, platform configuration summary.
- Full backup, verified restore rehearsal, and restore-time record.
- Explicit production confirmation containing the target fingerprint and one-time token.
- Ordered deletion list, transaction/batch boundaries, recovery behavior, and final JSON/Markdown audit.
- Human approval of the Qiniu manifest. Delete objects asynchronously after DB commit with retries.

Retain platform administrators, roles/permissions, packages/prices, platform notification configuration, Qiniu configuration, GRS/AI providers and models, prompt templates/categories/mappings, preview media, AI style presets, and migration history.

Delete enterprises, staff, ordinary users, referrer relationships, leads, floor plans, measurements, appointments, business AI tasks/results, conversions, commissions, business notifications/reports, and enterprise media. Prompt-template media must not enter the Qiniu deletion manifest.

Running production cleanup requires separate explicit user approval. Authoring this plan is not authorization.

## 16. Implementation phases

Update this status table incrementally and update both module inventories and affected contracts at each phase. Never mark every phase complete at once.

| Phase | Status | Deliverables and exit condition |
| --- | --- | --- |
| 0. Plan and design lock | `Completed` | Selected design and bilingual plan; no production UI change. |
| 1. Schema and identity | `Completed` | Target tables, lead extensions, forced RLS, repositories, database-backed context list/switch, `contextVersion` invalidation, and ordinary-customer phone login are implemented; DB contract tests pass. Legacy OpenID columns remain only for coexistence with the old flow until phase 8. |
| 2. Dual codes and referrer network | `Completed` | Rotation/disable audit, single-enterprise staff, default three-enterprise membership limit/leave, and reproducible opaque promotion tokens are implemented; repository database contract tests pass. |
| 3. Authorization and assignment | `Completed` | Two-stage scan, atomic user linkage/lead creation, first attribution, stable lowest-load assignment, no-candidate retention, post-commit notification, service retry, and staff-pool-change retry are implemented; repository/RLS/concurrency tests pass. |
| 4. Selected design implementation | `Completed` | `promotion-service-code` and `free-design-service` implement the three selected states at `390x844`; the service-code image endpoint, token resolution, phone authorization, idempotent lead creation, designer QR delivery, and assignment-pending state are wired. Antigravity 2.8.1 used its built-in `generate_image` capability with the fixed 3x2 prompt and ordered references; six independent transparent PNG assets were cut, optimized, and packaged under `packages/business/assets/referral-service-v1/`, each below 300KB. Focused tests pass. An actual WeChat DevTools automator verified exact routes, element bounds, and full host-window captures including the native capsule on the iPhone 12/13 Pro `390x844` simulator. |
| 5. Appointments and calendar | `Completed` | Tenant appointment settings, measurer unavailability, working-slot validation, first appointment, customer/internal rescheduling, cancellation/completion, event audit, optimistic versions, and the database exclusion constraint are implemented. Referrers can list active memberships in the internal workbench, choose one, enter its protected service-code route, or leave it through a confirmation flow without changing historical attribution. The assigned designer can enter booking from a lead without a confirmed appointment, supply the address, and create the first appointment from server-calculated availability. Repository/RLS/concurrency integration tests and the customer/reschedule/measurer itinerary/self-service unavailability/referrer-workbench Mini Program routes are implemented; first booking and customer rescheduling have been checked in the iPhone 12/13 Pro `390x844` automation simulator for window-computed full-width CTA geometry and side insets. Post-commit creation, reschedule, and cancellation attempts notify staff and subscribed customers; the first-booking entry, referrer workbench, customer appointment card, customer rescheduling, first booking, measurer itinerary, and unavailability editor have each verified their exact top route and a full host-window capture including the native capsule in the actual `390x844` WeChat DevTools simulator. |
| 6. Project, surveying, and publication | `Completed` | Project aggregation API, publication/withdrawal fact, owner-only customer read boundary, completed formal-plan summary, and protected published-design preview are implemented. The customer folio has no customer measurement-editor entry or graph editing path. Repository/RLS integration and Mini Program contract tests pass. Actual WeChat DevTools automation confirmed the exact customer-project top route at `390x844` and captured both the application layer and the full host window including the native capsule. |
| 7. Conversion and commissions | `Completed` | Three-rule repository, atomic conversion snapshots, three unique commissions, paid/void constraints, RLS report reads, batch payout API, and the approved `/lead-commissions` rule/report workbench are implemented. Focused PostgreSQL commission testing, the production build, and authenticated `localhost:3005` visual verification of the approved desktop workbench are complete. |
| 8. Legacy removal | `Not started` | Old binding, acquisition confirmation, workbench, and commission removed; docs and permissions aligned. |
| 9. Cleanup rehearsal and production release | `Not started` | Dry-run, backup/restore rehearsal, fingerprint confirmation, audit, separate approval. |

## 17. Test and acceptance matrix

- Identity: ordinary customer account creation; no forged enterprise context; stale tokens expire after relationship change.
- Dual codes: type isolation, immediate rotation invalidation, one staff enterprise, default three referrer memberships, historical ownership retained after leave.
- Anonymous promotion: public/claim states contain no company name, logo, selector, or plaintext ID.
- Attribution: scan creates no lead; authorization does; duplicates/concurrency create one active lock and one lead.
- Assignment: lowest load and stable tie-break; no staff retains the lead; onboarding retries; no manual acceptance.
- Appointments: working hours, step, horizon, leave, exclusion constraint, customer cutoff, internal reason, automatic replacement, version conflict.
- Authorization: forwarded cards cannot cross user boundaries; customers read only their project; staff/referrers cannot cross enterprises; designer QR remains protected.
- Notifications: create, reschedule, replacement, cancel, retry; WeChat failure does not affect business commit.
- Surveying/AI: formal v4 only; customer sees explicitly published designs only.
- Conversion: percentage requires contract amount; three rows in one transaction; paid commission blocks reversal.
- Cleanup: restore succeeds; business tables empty; platform/prompt configuration retained; Qiniu manifest matches audit.

Run verification proportional to the slice:

```powershell
cd admin
npm test
npm run build

cd ..\miniprogram
npm test

cd ..
git diff --check
```

For Mini Program visual work, reuse the current WeChat DevTools window, compile once after attachment, verify the active page stack, and never open a duplicate project window.

## 18. Continuous-development handoff

At the start of each follow-up session:

1. Read root `AGENTS.md`, this plan, and the nearest module instructions.
2. Read both module inventories, the current legacy contract, and the formal surveying contract when relevant.
3. Select only the first incomplete phase in section 16; never assume later dependencies exist.
4. Inspect current code and migrations. This plan is not implementation evidence.
5. Add repository/RLS/concurrency tests first, route handlers second, UI and notifications last.
6. Update English and Chinese docs whenever APIs, permissions, or flows change.
7. After adding a Mini Program runtime route, map the selected design in both restoration ledgers and record `390x844` plus native-capsule evidence.
8. Handoffs list completed work, remaining work, commands run, and known limitations. Avoid “mostly complete.”

## 19. Locked defaults

These decisions do not require repeated confirmation unless the product owner changes them:

- A customer must actively authorize a phone number; scanning cannot retrieve it.
- Personal WeChat cannot be auto-added; show ID and personal QR only.
- Referrers join at most three enterprises by default; platform configuration may change it.
- Staff and referrer onboarding takes effect immediately without review.
- Measurers are provisionally assigned and automatically replaced on appointment conflict.
- Customers select only server-confirmed availability; reschedules take effect immediately.
- Customers cannot cancel appointments themselves.
- Commissions are offline enterprise ledgers; the platform does not pay.
- Production business-data cleanup never runs through ordinary migration and always requires separate explicit approval.
