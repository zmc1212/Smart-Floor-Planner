# Referrer Network and Measurement Appointment Development Plan

Status: `Phase 10 in progress / Phase 11 completed`

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
7. Production must use native WXML/Less, semantic controls, and project icon assets. Never slice or paint the design board into product UI.
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

Phase 2 implements this section's server contract. Enterprise administrators can list, rotate, disable, and generate private WeChat Mini Program PNGs for distinct staff/referrer join codes, with rotation, resolution, and code-image outcomes audited. A Mini Program user with an authorized phone can scan the code into the dedicated onboarding route, join one enterprise as staff or join the referrer network up to the default three-enterprise limit, then list or exit memberships and retrieve the current promotion token. Tokens are server-key-derived, opaque 192-bit values; PostgreSQL stores only their SHA-256 hashes and no plaintext enterprise identifier is encoded.

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
| Dual-code management | `GET /api/enterprise/join-codes`, `POST /api/enterprise/join-codes/[type]/rotate`, `POST /api/enterprise/join-codes/[type]/disable`, `POST /api/enterprise/join-codes/[type]/image`; implemented in phase 2/10. The image endpoint is tenant-authorized, audited, private/no-store, preserves WeChat PNG/JPEG media, and always generates a `develop` Mini Program code through `getwxacodeunlimit`. |
| Onboarding | `POST /api/miniprogram/onboarding/staff`, `POST /api/miniprogram/onboarding/referrer`; implemented in phase 2. |
| Referrers | `GET /api/miniprogram/referrer-memberships`, `DELETE /api/miniprogram/referrer-memberships/[id]`, `GET /api/miniprogram/referrer-memberships/[id]/promotion-code`; implemented in phase 2. |
| Service-code image | `GET /api/miniprogram/referrer-memberships/[id]/promotion-code/image`; implemented in phase 4, validates the active membership and calls the WeChat Mini Program code provider outside the database transaction, returning non-cacheable PNG/JPEG bytes. It uses the same `getwxacodeunlimit` `develop` environment as enterprise onboarding codes. |
| Customer lead creation | `POST /api/miniprogram/referrals/authorize-and-create-lead`; phase 3 implements customer-context/direct WeChat phone authorization, idempotent attribution, and atomic lead creation/assignment. |
| Assignment | `POST /api/internal/lead-assignments/[leadId]/retry`; phase 3 implements this for service identity authenticated by an `INTERNAL_SECRET` of at least 32 characters. |
| Availability | `GET /api/appointments/availability`; phase 5 is complete and returns candidate-measurer availability plus the enterprise time zone, duration, step, and maximum advance-day boundary from enterprise schedules, active appointments, and unavailability. |
| Appointments | `GET/POST /api/appointments`, `POST /api/appointments/[id]/customer-reschedule`, `POST /api/appointments/[id]/internal-reschedule`, `POST /api/appointments/[id]/cancel`, `POST /api/appointments/[id]/complete`; phase 5 is complete with optimistic versions, customer/designer/measurer/enterprise-owner boundaries, automatic measurer replacement, event audit, and post-commit staff and subscribed-customer notification attempts for create, reschedule, and cancellation. Customer reads and reschedules derive their tenant from the customer-owned lead or appointment rather than accepting an enterprise ID from the token or request. |
| Calendar/settings | `GET/PUT /api/appointment-settings`, `GET/POST/DELETE /api/measurer-unavailability`; phase 5 is complete. |
| Customer project and design publication | `GET /api/miniprogram/customer-projects/[leadId]`, `GET /api/miniprogram/customer-projects/[leadId]/published-generations/[generationId]/image`, `POST /api/leads/[id]/ai-publications`, `DELETE /api/leads/[id]/ai-publications/[generationId]`; the Phase 6 backend slice is implemented. Customer reads are restricted to the owning project; designers may only publish/withdraw succeeded generations for their assigned leads, while enterprise administrators may manage their tenant's leads. Withdrawn or deleted generations never appear in the customer aggregate or image endpoint. |
| Startup and identity shell | `GET /api/miniprogram/bootstrap`; implemented in Phase 11. The server validates the signed JWT `contextVersion` and active staff/referrer relations, then returns the current role, valid role groups, enterprise/membership context, landing path, capability allowlist, and server-owned badge summary. Invalid contexts return `identity_context_invalid` and never fall back to customer mode. |
| Commissions | `GET/PUT /api/commission-rules`, `GET /api/lead-commissions?status=&role=&fromDate=&toDate=`, `POST /api/lead-commissions/mark-paid`; implemented in the Phase 7 server slice. Rules are tenant-scoped and can only be read/updated with optimistic versions by enterprise/platform administrators; report and payout APIs only return or mutate records in that enterprise. |

Enterprise endpoints use existing tenant route/context helpers and RLS. Internal retries use a service identity and are not exposed to ordinary clients.

## 13. Planned Mini Program and Admin surfaces

Phase 4 routes now exist and are recorded in the restoration ledger:

- `packages/business/promotion-service-code/promotion-service-code`: selected design left screen shown to customers; the code image comes from a protected provider endpoint.
- `packages/business/free-design-service/free-design-service`: selected design middle and right authorization/result states, including token resolution, phone authorization, idempotent lead creation, and designer contact delivery.

The phase-5 runtime routes now exist and are recorded against their approved phase-5 design references in both restoration ledgers:

- `packages/business/referrer-workbench/referrer-workbench`: memberships, internal enterprise selection, promotion-code entry.
- `packages/business/customer-project/customer-project`: the approved Phase 6 customer project folio renders the real appointment, designer/measurer, completed formal-plan summary, and explicitly published design cards; the protected design-image endpoint is read into an app-local file before customer preview. It intentionally has no customer measurement-editor entry or editable floor-plan viewer.
- `packages/business/appointment-detail/appointment-detail`: the real dispatch record and role-limited internal reschedule, cancel, and completion actions.
- `packages/business/appointment-reschedule/appointment-reschedule`: server-calculated customer availability plus customer reschedule or internal reschedule with an optional audit reason.
- `packages/business/appointment-booking/appointment-booking`: the assigned designer enters from a lead without a confirmed appointment, provides the service address, selects a server-calculated real slot, and creates the first appointment.
- `packages/business/measurer-calendar/measurer-calendar`: confirmed measurer itinerary with an entry to manage unavailability.
- `packages/business/measurer-unavailability/measurer-unavailability`: measurers manage only their own unavailable periods with native date/time pickers, optional reason, save, and delete; server APIs continue to enforce role and ownership.
- `packages/business/onboarding/onboarding`: staff/referrer join-code landing route. It resolves the code type before phone authorization, collects the authorization, selects only `designer` or `measurer` for staff, calls the existing onboarding endpoint, and switches to the returned context.
- `packages/business/identity-switch/identity-switch`: lists active server contexts, exchanges the signed context token, refreshes the full session payload, and relaunches the selected customer/staff/referrer surface.

The Phase-7 merchant route `/lead-commissions` implements the established Admin UI direction with all three rule cards, status/role/date ledger filters, real joined report columns, a confirmation-protected batch paid action, and amount summaries. It adds the dedicated `lead-commissions` navigation and permission boundary without replacing `/acquisition-commissions`. Other functional Admin work follows the bilingual Admin UI refactor contract and the existing Ant Design/Admin Pro route patterns.

### 13.1 Phase 10: Admin operations and end-to-end acceptance workbench (In progress)

The dual-code, staff/referrer onboarding, assignment eligibility, and end-to-end business contracts exist server-side, but operations staff have no visual Admin entry that avoids API calls. Phase 10 provides `/referrer-network-operations`, `/appointment-settings`, and a role-rendered Admin home workbench so management roles can run acceptance and designers/measurers can process their own tasks inside the existing tenant boundary:

1. Select the current enterprise; view staff/referrer-code status, version, expiry, and creation/disable audit; rotate, disable, display, or download scannable onboarding QR codes after confirmation. Tokens never leave the server for an Admin page, ordinary logs, or public pages.
2. Check designer/measurer onboarding, account status, `assignmentPaused`, designer WeChat ID/QR completeness, and current assignment eligibility in the same workbench. It reuses existing staff-profile and assignment-retry contracts; it adds no manual acceptance or cross-enterprise assignment.
3. Provide testers with a complete-workflow readiness checklist: referrer onboarding, promotion service code, eligible designer/measurer, appointment settings, three-role commission rules, and external WeChat capability. The checklist shows only real state and navigation entries; it does not fabricate customers, leads, appointments, surveying, AI, or conversion data.
4. Run manual acceptance with real Mini Program accounts through referrer onboarding, service-code display, customer claim, automatic assignment, appointment, formal surveying, AI publication, signing, and the commission ledger. The workbench only presents facts/audits that occurred; it never bypasses phone authorization, anonymous boundaries, or customer ownership checks.

This functional Admin UI follows the bilingual Admin UI refactor contract and the existing Ant Design/Admin Pro routes; an independent desktop design source is not required. Do not reuse the anonymous customer-claim design or slice QR/token/audit content into UI assets. After implementation, record the final route, permission, visual evidence, and limitation in both Admin UI ledgers and module inventories.

The current slice implements `/referrer-network-operations` with direct links for every readiness item and `/appointment-settings` with an explicit distinction between an auto-created default and an administrator-confirmed policy. Promotion-code readiness reads the persisted active-code count separately from active memberships, so a membership is never treated as proof that its service code remains usable. It also closes the previously API-only client gaps: appointment detail/internal actions, AI result publication/withdrawal, and identity switching. Ordinary code listing never returns an active token; the tenant-authorized, audited image endpoint remains private and no-store. The Admin home now renders a role-specific designer/measurer employee workbench from the Cookie session; `GET /api/workbench/staff` derives the role in a tenant transaction and returns only assigned leads, appointments, and survey handoff data. The measurer surface exposes task and existing Admin links only; formal BLE surveying remains the Mini Program editor's sole production entry. The Mini Program now refreshes its stored JWT on launch/resume, validates `contextVersion`, and uses one role-landing helper; a referrer login and cold launch re-launch the promotion workbench rather than returning to the pre-login tab, while invalid contexts clear local session state. JWT-backed staff lead lists no longer require a legacy OpenID before loading. Authenticated Chrome QA is complete at `http://localhost:3006`; a real signed referrer has passed login completion and fresh-compilation cold launch at `390x844`, including a native-host-capsule capture. Role-authenticated Admin visual QA, appointment actions, and publication actions still need real assigned data.

Phase 11 completes the identity startup and authorization shell. `GET /api/miniprogram/bootstrap` takes the signed current context as its only authority and returns the current role, valid role groups, enterprise/membership context, default landing, capability allowlist, and server-owned badge summary. Cold launch, login, onboarding, identity switching, and successful customer claims refresh and validate bootstrap before entering a landing. Revoked, deactivated, or version-mismatched contexts clear the token while retaining an explicit recovery reason; the client no longer fabricates a local identity. `identity-navigation` provides role capabilities and a deep-link guard that sends forbidden routes to the current valid landing, while unknown identities never fall back to customer UI. Phase 12 received authorization to extend the current Mini Program visual style; bootstrap role navigation and the identity-recovery page are now under implementation, while complete role workbenches still need later data contracts.

### 13.2 Phases 11-15: role-complete Mini Program experience (Planned)

The server can create and switch `customer/staff/referrer` contexts, and the client now restores a referrer to the promotion workbench after JWT-backed cold launch, login, and onboarding. The referrer workbench exposes identity switching only when the server confirms multiple available contexts and always keeps logout visible. Home, leads, surveying, design, and Mine still use the legacy staff/non-staff split. The static tab bar also exposes leads, surveying, or AI entries to unrelated roles; other roles still primarily reach identity switching through Settings, while multi-enterprise referrer memberships are represented both in the identity list and again in the workbench. Phases 11-15 must remove these product gaps; the existence of deep routes is not proof of a complete role workflow.

#### 13.2.1 Approved role and responsibility boundary

The Mini Program serves five business workbench roles: customer, referrer, designer, measurer, and enterprise owner. Platform administrators and the legacy `salesperson` stay in Admin and are outside this Mini Program information architecture. One base WeChat account may own several roles, but exactly one signed context is active at a time. A person who is both a designer, referrer, or enterprise owner must switch explicitly; permissions are never merged.

| Active identity | Default landing and navigation | Core job | Must never appear |
| --- | --- | --- | --- |
| Customer | `Service / Projects / Mine` | Read owned service progress, current appointment, formal-plan summary, and published designs; reschedule inside the allowed window | Staff lead pool, formal surveying editor, BLE, AI production tools, conversion/commission administration |
| Referrer | `Promote / Progress / Earnings / Mine` | Select the service enterprise inside the workbench, show its service code, and read masked customer milestones plus own commission state | Customer phone, precise address, editable plan, internal appointment reasons, staff dispatch, or enterprise rules |
| Designer | `Workbench / Customers / Design / Mine` | Process assigned leads, create or coordinate appointments, consume formal survey results, generate/publish designs, and collaborate on conversion | Measurer unavailability, other designers' leads, enterprise commission configuration, or context-free surveying |
| Measurer | `Schedule / Tasks / Survey / Mine` | Read assigned appointments, maintain own unavailability, enter the single formal survey editor from an assigned task, and complete handoff | Design publication, conversion, referrer earnings, enterprise rules, or unassigned customer data |
| Enterprise owner | `Operations / Customers / Appointments / Mine` | Read tenant exceptions and key measures, resolve assignment/appointment exceptions, inspect the customer lifecycle, and perform existing authorized conversion/mobile approvals | Implicit designer or measurer tools; hands-on work requires switching to that staff identity |

The tab bar is generated from a role allowlist and no longer preserves a universal center Survey action. Only the measurer context exposes surveying as a primary entry. Designers and enterprise owners reach permitted read-only results or existing actions from a lead/floor-plan context; customers and referrers never see the survey editor. Client visibility, deep-link guards, and server authorization must agree; hiding a control is not access control.

#### 13.2.2 Identity startup, recovery, and two-level switching

1. Add or extend a unified `GET /api/miniprogram/bootstrap` contract returning the signed current context, available role groups, current enterprise/membership, allowed navigation capabilities, default landing, and necessary badge summaries. Pages must not infer identity independently from `role === 'staff'`.
2. Cold launch, warm launch, phone/password login, successful onboarding, and identity switching all refresh and validate the current context before entering its landing surface. Preserve the last context while it remains valid; otherwise show an explicit recovery/selection state and never silently fall back to customer UI.
3. Mine always exposes the current role and enterprise plus a discoverable identity switch on its first screen. A single-role account shows its current identity without creating a pointless switch flow.
4. Referrer appears once at the role level. Enterprise selection happens inside the promotion workbench and uses the existing signed switch contract to update `referrerMembershipId`; subsequent data, service codes, and commissions remain scoped to that membership.
5. Leaving a membership, staff deactivation, enterprise deactivation, or `contextVersion` change invalidates the old token immediately. Recovery explains the change and lists only still-valid identities without leaking inactive enterprise data.

#### 13.2.3 Five-role interface design contract

All new design continues `miniprogram/DESIGN.md`, the design tokens, and the F1 Xiao K + F3 spatial-transformation system; it does not create a parallel visual language. Xiao K has one operational role per identity: customer service guide, referrer promotion steward, designer case coordinator, measurer partner, enterprise dispatch observer, and identity custodian in Mine. The IP must organize real information or action and cannot become repeated decoration or imply unavailable capability.

Phase 12 must first produce explicit design sources for the role shell, five landings, role-aware tab bar, identity selection/recovery, and key empty states, then receive user approval before production UI work. Each runtime route enters both restoration ledgers only after implementation and `390x844` native-host verification; this plan is not visual implementation approval. Existing approved customer-project, promotion-code, appointment, and formal-survey designs remain authoritative for their deep routes and must not be replaced with generic cards during shell work.

The current phase-12 design source is [miniprogram-role-shell-design-v1.md](./miniprogram-role-shell-design-v1.md) and its Chinese mirror. The user approved extension of the current Mini Program visual language. This slice maps bootstrap role allowlists only to executable existing routes and enters a recovery page that exposes no invalid-tenant data after token loss. Customer-project indexing, referrer progress/earnings, measurer task aggregation, and enterprise operations mobile entry remain phase-13/14 work and do not use blank or simulated tabs. Restoration ledgers still wait for `390x844` native-host verification of each runtime route.

#### 13.2.4 End-to-end role workflow

```text
Referrer selects an enterprise and presents its service code
  -> customer reads the anonymous service and authorizes a phone number
  -> system locks attribution, creates the lead, and assigns designer/measurer
  -> designer contacts the customer and creates the first appointment
  -> measurer enters the formal survey from the assigned schedule and hands it off
  -> designer consumes the formal plan, generates, and explicitly publishes a design
  -> customer reads appointment, plan summary, and published design in the owned project
  -> enterprise owner confirms conversion and creates three-role commissions
  -> referrer reads only masked service milestones and own payable/paid earnings
```

Cross-role handoffs are driven by real events: assignment, appointment create/reschedule/complete, formal-plan completion, publication, conversion, and commission changes each produce retryable notifications and durable in-app facts. A role landing aggregates only executable next steps for that identity. It does not copy whole business tables or use APIs, scripts, fabricated records, or manual database edits as acceptance substitutes.

#### 13.2.5 States, ranges, and privacy

- Every role covers first use, populated, empty, loading, retryable error, expired session, revoked permission, and paginated long lists. Referrer additionally covers zero/one/many enterprises and membership exit.
- Customer project lists use `customer_user_id` ownership; designers read assigned leads; measurers read assigned current/history tasks; enterprise owners stay inside the current tenant; referrers read masked attribution and own commissions for the current membership.
- Referrer progress exposes only service stage, masked customer identity, attributed enterprise, update time, and commission state needed to prove service. It never returns phone, WeChat ID, precise address, floor-plan graph, internal appointment reason, or design files.
- A deep link outside the current identity renders a clear no-access recovery and returns to the role landing. It never renders the legacy UI, a blank page, or continues with another role's token.
- Home and tab badges come from real server counts in the active role scope. Unknown or failed counts use recoverable states instead of local mock numbers.

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
| 5. Appointments and calendar | `Completed` | Tenant appointment settings, measurer unavailability, working-slot validation, first appointment, customer/internal rescheduling, cancellation/completion, event audit, optimistic versions, and the database exclusion constraint are implemented. The Admin settings sheet confirms policy defaults; lead detail and the measurer itinerary enter a real appointment dispatch page, where the responsible role sees only its allowed actions, cancellation reasons remain required, and internal reschedule reasons are optional but audited when supplied. Existing appointment states have prior `390x844` evidence; the new detail/internal-action states await refreshed capture. |
| 6. Project, surveying, and publication | `Completed` | Project aggregation, publication/withdrawal facts, owner-only reads, completed formal-plan summary, and protected preview are implemented. The AI result page now reads true publication state and lets the responsible designer or enterprise administrator publish or withdraw after confirmation. The customer folio has no measurement-editor or graph-editing path. Existing customer-project evidence remains valid; the new result control needs refreshed capture. |
| 7. Conversion and commissions | `Completed` | Three-rule repository, atomic conversion snapshots, three unique commissions, paid/void constraints, RLS report reads, batch payout API, and the approved `/lead-commissions` rule/report workbench are implemented. Focused PostgreSQL commission testing, the production build, and authenticated `localhost:3006` visual verification of the approved desktop workbench are complete. |
| 8. Legacy removal | `Completed` | Runtime schema, endpoints, menus, workbench, and obsolete Mini Program contact entries are removed. PostgreSQL contract tests and Mini Program tests pass. Historical database objects and business data are retained for the separately approved Phase-9 cleanup rehearsal. |
| 9. Cleanup rehearsal and production release | `Completed` | The user-confirmed local Docker production volume completed the read-only dry-run, target-fingerprint and empty-Qiniu-manifest confirmation, pre-cleanup full backup, single-transaction business-data cleanup, JSON/Markdown audit, and restore rehearsal from the pre-cleanup backup. Platform administrators, roles/permissions, packages, platform/media/AI configuration, prompts, and migration records remain; business tables are empty and Qiniu has no candidate objects. |
| 10. Admin operations and end-to-end acceptance workbench | `In progress` | `/referrer-network-operations` implements dual-code operations, assignment eligibility, and an actionable real-state checklist; `/appointment-settings` exposes and confirms enterprise policy. Mini Program deep routes, signed-session refresh, and referrer cold-launch landing now exist, but the five-role home, static navigation trimming, and masked progress/earnings loop are not complete. Authenticated Admin QA is complete at `http://localhost:3006`; a JWT-only designer lead-list empty state and a real signed referrer login/cold-launch workbench, both with native-host-capsule captures, now pass at `390x844`, while authenticated appointment and publication actions still need real assigned data. |
| 11. Identity startup and authorization shell | `Completed` | `GET /api/miniprogram/bootstrap` returns the signed current role, valid role groups, enterprise/membership context, landing path, capability allowlist, and server-owned badge summary; cold launch, login, onboarding, claims, and switching refresh and validate it first; revocation/deactivation/version changes clear the session and retain an explicit recovery reason; identity navigation rejects unknown identities and forbidden deep links without falling back to customer UI. Revocation, deactivation, multi-role recovery, and negative deep-link tests pass. |
| 12. Role information architecture and design approval | `In progress` | The user approved the current Mini Program visual language. `docs/miniprogram-role-shell-design-v1.*` defines role targets, allowlists, recovery states, and safe areas; production now includes bootstrap-driven navigation for current executable routes and a recovery page that exposes no invalid-tenant data. Customer-project index, referrer progress/earnings, measurer tasks, and enterprise operations wait for phase-13/14 contracts; route ledgers await `390x844` verification. |
| 13. Customer and referrer loops | `In progress` | `GET /api/miniprogram/customer-projects` now exposes an owned, unarchived customer-project index from the current JWT. Selecting another enterprise in the referrer workbench exchanges the signed `referrerMembershipId` context before refreshing the session; service code, `GET /api/miniprogram/referrer-progress`, and `GET /api/miniprogram/referrer-earnings` consequently share one active membership boundary. The aggregates return only masked customer labels, service stage/update facts, and the referrer's payable, paid, or voided earnings. Customer/referrer negative authorization tests and focused Mini Program tests pass; the new routes still need authenticated `390x844` native-capsule QA. |
| 14. Designer, measurer, and enterprise-owner loops | `In progress` | `GET /api/miniprogram/workbench` now derives the signed staff role, enterprise, and staff scope in the tenant transaction; Admin adds `GET /api/workbench/staff`, which derives designer/measurer scope from the Cookie session for the role-specific home workbench. Designers receive only assigned leads and appointments, measurers only own confirmed appointments and linked survey tasks, and enterprise owners only tenant lead/confirmed-appointment aggregates. The existing static Tab routes now render `Workbench/Customers/Design/Mine`, `Schedule/Tasks/Survey/Mine`, or `Operations/Customers/Appointments/Mine` by capability; measurer survey entry uses the sole formal editor with assigned context. Focused navigation tests pass. Authenticated Admin role QA, `390x844` native-capsule QA, and real multi-role data acceptance remain pending. |
| 15. Real five-role end-to-end acceptance | `Planned` | Use real WeChat accounts or real contexts on one account to verify service code through authorization, assignment, appointment, survey, publication, conversion, and commissions. Cover cold launch, switching, revocation, notification failure, pagination, and negative deep links, then close every affected route with `390x844` native-capsule evidence and bilingual documentation. |

## 17. Test and acceptance matrix

- Identity: ordinary customer account creation; no forged enterprise context; stale tokens expire after relationship change.
- Dual codes: type isolation, immediate rotation invalidation, one staff enterprise, default three referrer memberships, historical ownership retained after leave.
- Anonymous promotion: public/claim states contain no company name, logo, selector, or plaintext ID.
- Attribution: scan creates no lead; authorization does; duplicates/concurrency create one active lock and one lead.
- Assignment: lowest load and stable tie-break; no staff retains the lead; onboarding retries; no manual acceptance.
- Appointments: working hours, step, horizon, leave, exclusion constraint, customer cutoff, internal reason, automatic replacement, version conflict.
- Authorization: forwarded cards cannot cross user boundaries; customers read only their project; staff/referrers cannot cross enterprises; designer QR remains protected.
- Role startup: cold launch, later login, onboarding completion, and identity switching enter the current valid role landing; invalid context never silently becomes customer.
- Role navigation: each identity exposes only allowlisted tabs/actions; customer/referrer has no survey entry, measurer has no design publication, and enterprise owner does not inherit specialist tools.
- Multi-role: token, landing, tab bar, cache, and request scope all update after switching; enterprise selection inside referrer mode updates the signed membership context.
- Referrer privacy: progress and earnings are auditable while phone, precise address, floor-plan graph, internal appointment reason, and design files remain hidden.
- Role deep links: copied or forwarded routes are rejected server-side and recover client-side without flashing unauthorized content.
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
- Mini Program workbenches are limited to customer, referrer, designer, measurer, and enterprise owner; platform administrators and legacy `salesperson` remain in Admin.
- Referrer has one role entry; multiple enterprises are selected inside its workbench and update the signed membership context.
- Customers do not use staff leads, formal-survey editing, or AI production tools; enterprise owners do not automatically receive designer/measurer hands-on entries.
- Exactly one identity context is active at a time; invalid context requires explicit recovery and never silently falls back to ordinary-user UI.
- Staff and referrer onboarding takes effect immediately without review.
- Measurers are provisionally assigned and automatically replaced on appointment conflict.
- Customers select only server-confirmed availability; reschedules take effect immediately.
- Customers cannot cancel appointments themselves.
- Commissions are offline enterprise ledgers; the platform does not pay.
- Production business-data cleanup never runs through ordinary migration and always requires separate explicit approval.
