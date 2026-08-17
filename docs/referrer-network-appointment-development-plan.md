# Referrer Network and Measurement Appointment Development Plan

Status: `Approved design / Planned implementation`

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

Names below are the approved implementation target and must be checked against current `admin/src/lib/db/schema.ts` and repository conventions before migration authoring.

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

## 11. Conversion and three-role commissions

- Enterprises configure separate referrer, designer, and measurer rules as fixed amount or contract percentage.
- If any role uses percentage, conversion requires a positive contract amount.
- The conversion transaction snapshots all rules, beneficiaries, and contract amount and creates three unique `(lead_id, role)` `payable` rows.
- Monetary computation uses decimal arithmetic, never JavaScript floating point. Repository tests lock the rounding rule.
- Enterprise administrators mark offline payments `paid` individually or in bulk. The platform does not pay funds.
- Conversion reversal marks unpaid rows `voided` with a reason. Any `paid` row blocks direct reversal until offline correction is complete.
- Reports group customer, referrer, enterprise, designer, measurer, appointment, contract amount, and all three commission states by lead.

## 12. Planned API families

Exact route names may be adjusted within an implementation slice to match App Router conventions, but semantics and permission boundaries must remain distinct.

| Family | Planned endpoints |
| --- | --- |
| Identity | `GET /api/miniprogram/identity-contexts`, `POST /api/miniprogram/identity-contexts/switch` |
| Code resolution | `POST /api/miniprogram/codes/resolve` |
| Dual-code management | `GET /api/enterprise/join-codes`, `POST /api/enterprise/join-codes/[type]/rotate`, `POST /api/enterprise/join-codes/[type]/disable` |
| Onboarding | `POST /api/miniprogram/onboarding/staff`, `POST /api/miniprogram/onboarding/referrer` |
| Referrers | `GET /api/miniprogram/referrer-memberships`, `DELETE /api/miniprogram/referrer-memberships/[id]`, `GET /api/miniprogram/referrer-memberships/[id]/promotion-code` |
| Customer lead creation | `POST /api/miniprogram/referrals/authorize-and-create-lead` |
| Assignment | `POST /api/internal/lead-assignments/[leadId]/retry` |
| Availability | `GET /api/appointments/availability` |
| Appointments | `POST /api/appointments`, `POST /api/appointments/[id]/customer-reschedule`, `POST /api/appointments/[id]/internal-reschedule`, `POST /api/appointments/[id]/cancel`, `POST /api/appointments/[id]/complete` |
| Calendar/settings | `GET/PUT /api/appointment-settings`, `GET/POST/DELETE /api/measurer-unavailability` |
| Commissions | `GET/PUT /api/commission-rules`, `GET /api/lead-commissions`, `POST /api/lead-commissions/mark-paid` |

Enterprise endpoints use existing tenant route/context helpers and RLS. Internal retries use a service identity and are not exposed to ordinary clients.

## 13. Planned Mini Program and Admin surfaces

Do not add planned routes to the restoration ledger before they exist:

- `packages/business/referrer-workbench/referrer-workbench`: memberships, internal enterprise selection, promotion-code entry.
- `packages/business/promotion-service-code/promotion-service-code`: selected design left screen shown to customers.
- `packages/business/free-design-service/free-design-service`: selected design middle and right authorization/result states.
- `packages/business/customer-project/customer-project`: project, appointment, formal floor plan, and publications.
- `packages/business/appointment-reschedule/appointment-reschedule`: customer availability and reschedule.
- `packages/business/measurer-calendar/measurer-calendar`: measurer appointments and unavailability.

Admin work stays within merchant boundaries and adds or replaces staff dual-code management, appointment settings, commission rules, and the three-role report. Before visible Admin work, inspect an approved source. If none exists, implement only models/APIs and do not invent production UI.

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
| 1. Schema and identity | `Not started` | Tables, RLS, repositories, context list/switch, ordinary customer phone login; DB contract tests pass. |
| 2. Dual codes and referrer network | `Not started` | Rotation/disable audit, single-enterprise staff, membership limit/leave, promotion tokens. |
| 3. Authorization and assignment | `Not started` | Two-stage scan, atomic lead creation, first attribution, stable assignment, failure retry. |
| 4. Selected design implementation | `Not started` | Three mapped states implemented at `390x844`, verified for capsule, type, authorization, and device rendering; ledgers updated. |
| 5. Appointments and calendar | `Not started` | Settings, unavailability, exclusion constraint, first appointment, both reschedule paths, cancellation, events, notifications. |
| 6. Project, surveying, and publication | `Not started` | Formal entry, aggregation API, publication fact, customer read boundary. |
| 7. Conversion and commissions | `Not started` | Three rules, conversion snapshot, three unique records, paid/void constraints, report. |
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
