# Mini Program: Current Module Inventory

This inventory describes the current native WeChat Mini Program runtime. It
contains current routes, contracts, permissions, and limitations only; dated
restoration notes and test transcripts belong in Git history or local evidence.

## Runtime and shared context

- Native WeChat Mini Program with custom tab bar, bright-green design tokens,
  and iPhone 13 Pro `390x844` as the visual baseline.
- Sessions use `/api/auth/miniprogram` and bearer JWT. `GET /api/miniprogram/bootstrap`
  validates the signed context and returns the current role, valid role groups,
  enterprise/membership context, landing path, capability allowlist, and
  a server-owned badge summary (`status`/`message`/`counts` keyed by the
  current role Tab). Badge load failure keeps identity bootstrap and returns
  `unavailable` with `暂时无法读取` instead of a local zero. Phone authorization can
  create an ordinary customer account; the phase-3 referral claim endpoint can
  also consume WeChat authorization codes and atomically link the account,
  attribution, and lead. Tokens select a database-validated
  `customer`, `staff`, or `referrer` context and are invalidated by
  `contextVersion`. Professional staff, enterprise context, leads, floor plans,
  AI tasks, commissions, and promotion records resolve through shared APIs.
  On launch/resume the client refreshes the stored token against the current
  context; an invalid context clears local session state, and a referrer
  context restores the promotion workbench instead of silently falling into the
  ordinary-customer shell.
- Primary actions use locally stored, license-documented icons. Native host
  capsule and safe areas remain outside the content lane.
- `Implemented`, `Limited`, and `Placeholder` describe executable runtime
  behavior, not labels or mock responses.

## Page inventory

Appointment detail is the follow-up entry for service-address completion. The assigned designer or measurer opens appointment detail and chooses `Add service address` or `Edit service address` below the address row; `POST /api/appointments/[id]/address` enforces the persisted appointment role and versioned audit. Customers and referrers do not see this action.

| Surface | Runtime routes | Current contract | Status/limitation |
| --- | --- | --- | --- |
| Home and measurement entry | `pages/index/index` | Customer Service home shows the current derived service stage, the current appointment or expiry copy, and one next action (`reschedule` / `rebook` / `view project` / `wait for designer`); the project index remains the Projects tab. Signed designers enter the role workbench; measurer Schedule opens `measurer-calendar`; enterprise-owner Operations handles pending-assignment failures, expired unrebooked work, and staffing gaps. The local `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` switch opens a fresh editor without loading recent plans | Implemented/Limited; role workbenches consume server-derived `GET /api/miniprogram/workbench` and the customer-project `serviceStage`/`nextActionKind`, and must not invent a second stage vocabulary. On cold launch, the custom TabBar and role pages derive the first render from the stored signed `mode/staffRole` context. The customer TabBar exposes Projects to the owned-project index. Tab badges come from bootstrap `counts` (customer reschedule/rebook, designer follow-up plus expired, measurer today/tasks, owner exceptions including expired unrebooked); failed counts show `暂时无法读取` and never a local zero. Authenticated `390x844` native-capsule QA for the new role states remains pending |
| Leads and customer records | `pages/leads-management/leads-management`, `packages/business/lead-form/lead-form`, `packages/business/lead-detail/lead-detail` | Lead list/detail, conversion state, formal-plan summary; the assigned designer can enter first booking when no confirmed appointment exists, and a staff-activity measurer can book the first visit for that same lead; the owning customer can enter the same server-backed booking flow from the project folio. Automatic measurer assignment is displayed separately from the pending appointment time. On the static role Tab route, a measurer sees confirmed appointment tasks plus unscheduled survey work; designers and enterprise owners retain their authorized customer route. JWT-backed staff sessions load the list without requiring a legacy OpenID. When a referral-network lead enters `converted` through the existing signing endpoint, the server snapshots referrer, designer, and measurer commissions in the same transaction; staff-activity leads snapshot designer and measurer only | Implemented/Limited; conversion, customer ownership, and appointment-entry permissions are server enforced, and role Tab items are capability-allowlisted. Percentage rules require a contract amount and a paid three-role commission blocks enterprise-admin signing reversion |
| Promotion and staff tasks | `packages/business/promotion-records/promotion-records`, `packages/business/promotion-record-detail/promotion-record-detail` | Enterprise referral and staff notification flows | Implemented/Limited; WeChat delivery can fail externally |
| Referrer network, appointments, and anonymous claim | `packages/business/onboarding/onboarding`, `packages/business/onboarding-debug/onboarding-debug`, `packages/business/referrer-workbench/referrer-workbench`, `packages/business/referrer-progress/referrer-progress`, `packages/business/referrer-earnings/referrer-earnings`, `packages/business/promotion-service-code/promotion-service-code`, `packages/business/staff-activity-code/staff-activity-code`, `packages/business/free-design-service/free-design-service`, `packages/business/customer-projects/customer-projects`, `packages/business/customer-project/customer-project`, `packages/business/appointment-detail/appointment-detail`, `packages/business/appointment-reschedule/appointment-reschedule`, `packages/business/appointment-booking/appointment-booking`, `packages/business/measurer-calendar/measurer-calendar`, `packages/business/enterprise-appointments/enterprise-appointments`, `packages/business/measurer-unavailability/measurer-unavailability`, `packages/business/identity-recovery/identity-recovery` | Type-isolated onboarding, promotion code, anonymous claim, customer project, and appointment deep routes retain their contracts. The customer index returns only unarchived projects owned by the current JWT customer and presents a neutral free-design service label; the customer project folio likewise omits enterprise branding while retaining the owner-only service facts. The customer project index is itself a customer Tab destination and mounts the shared custom TabBar, while the project folio remains a deep route without the TabBar. Referrer progress and earnings are scoped to the signed active membership and return only masked customer labels, service facts, and the referrer's commission state, never a phone number, exact address, wall graph, internal appointment reason, or design file. Selecting an in-workbench referrer enterprise exchanges the signed membership context before the session is refreshed, so its service code, progress, and earnings share that boundary. A valid onboarding code resolves code type and enterprise before phone authorization; a signed customer who already has an open attribution receives the existing project instead of a new claim. Development-only `onboarding-debug` can select a local code into the same real flow. Appointment actions remain separated among designer, measurer, enterprise owner, and customer; internal reschedule reasons are optional and retained in appointment event audit when supplied. Invalid identities enter a dedicated recovery page before reauthentication | Implemented/Limited; a referrer enters the workbench after onboarding, login, and JWT-backed cold launch. A real signed referrer verified both login completion and cold launch at `390x844`, including a native-capsule host capture. The workbench now opens masked progress and own earnings for its current enterprise; customer-project ownership, appointment role checks, and optimistic versions remain enforced. A temporary identity-context read failure leaves promotion controls usable and hides switching. Customer-facing project surfaces intentionally use neutral free-design/free-survey copy; enterprise names remain available only to internal/referrer surfaces. Phase 12 now exposes the current executable referrer/measurer navigation from bootstrap and clears invalid sessions without exposing the invalid tenant. New customer-project, progress, and earnings routes still need authenticated `390x844` QA; measurer-task aggregation, authenticated appointment/publication actions, and full role production UI remain pending; WeChat delivery is external |
| Commission records | `packages/business/commission-records/commission-records` | Order commissions for eligible commercial roles | Implemented; settlement remains backend/business controlled |
| Inspiration library | `packages/business/inspiration/inspiration` | Tenant-scoped inspiration browsing and detail | Implemented/Limited; media provider is external |
| AI design workflow | `pages/ai-design/ai-design`, `packages/ai-workflow/*` | Customer/project selection, recipe entry, confirmation, task result/history, and lead-scoped publication state. A succeeded result tied to a lead lets the responsible designer or enterprise administrator publish it to or withdraw it from the customer project after confirmation. The static role Tab becomes an assigned formal-survey entry for measurers; the enterprise-owner Appointments tab no longer occupies this shell and opens `enterprise-appointments` | Implemented/Limited; provider, credit, formal-survey eligibility, lead responsibility, publication visibility, and workbench scope are server controlled. Authenticated `390x844` native-capsule QA for the alternate role states remains pending |
| Mine and account | `pages/mine/mine`, `packages/business/profile-edit/profile-edit`, `packages/business/settings/settings`, `packages/business/identity-switch/identity-switch`, `packages/business/identity-recovery/identity-recovery`, `packages/business/account-security/account-security` | Notifications, account security, and server-backed identity-context selection; `GET /api/miniprogram/bootstrap` returns the current role, valid role groups, enterprise/membership context, landing path, capability allowlist, and a server-owned badge summary of role-scoped todo counts. Switching exchanges a signed context token; login, onboarding, claims, switching, and startup recovery refresh and validate bootstrap before shared identity navigation enters a signed landing. `identity-navigation` rejects unknown identities and forbidden deep links; an invalid signed context enters the recovery page, clears its old session, and requires reauthentication | Implemented/Limited; bootstrap roles generate only wired capability-allowlisted navigation: customer `Service/Projects/Mine`, referrer `Promotion/Progress/Earnings/Mine`, designer `Workbench/Customers/Design/Mine`, measurer `Schedule/Tasks/Survey/Mine`, and enterprise owner `Operations/Customers/Appointments/Mine`. The shared custom TabBar paints those server badge counts and shows `暂时无法读取` when the summary is unavailable. The Mine header uses the runtime capsule-safe lane, and the profile card follows that header in normal flow with reserved vertical spacing; designers can self-serve their WeChat ID and personal QR on `profile-edit` (measurers are not required to upload a QR). The focused layout regression test covers the geometry and overlap boundaries. Revocation, deactivation, and version changes expose no invalid-tenant data and never silently fall back to customer |
| Recommendation share | `packages/business/recommendation-share/*` | Read-only shared recommendation and project summary | Limited by share authorization and available assets |

## Formal surveying

The only measurement editor is
`packages/surveying/editor/surveying-editor`, entered with `leadId`
and/or `floorPlanId`. The authoritative contract is
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md).
`FloorPlan.layoutData` contains only version-4 `surveyGraph` data. Wall graph,
Canvas renderer, dimensions, BLE readings, audit queue, undo/redo, the
right-rail confirmed canvas-clear/restart action, and save failure behavior
must follow that contract. Closed `spaces` written by `confirmClosure`,
`deleteWall`, and closed-wall splits come from half-edge faces; the same
transaction rejects the edit if saved spaces and extracted faces diverge.
The persistent top-bar CAD action is disabled until the cloud plan is
`completed`; it downloads through `GET /api/miniprogram/floorplans/[id]/export/dxf`,
which reuses Mini Program floor-plan access control and the same formal-v4 /
closed-space validation as the Admin endpoint. The app saves the DXF to its
file domain and opens the system document handler; an unavailable DXF handler
shows a transfer-to-CAD-device prompt. The file is generated on demand only.
Graph nodes stay on the centerline; working faces and one-sided bodies are
read models. Deleting a wall shared by two closed rooms punches
through that interface and merges them into one closed room, including when the
shared run has been split into collinear segments. A merged inner dimension
plan must remain defined after collinear inner corners collapse. A punch-through
L corner keeps rectangular wall solids and must not convex-miter into the room.
Node joins use local convex/concave predicates (outer miter, overlapping inner
rectangles, outer-only opposite-thickness steps); Admin
`surveyWallSolidPlan.js` uses the same generator. Inner-face punch-through keeps each remaining wall's original body side: the
inner L extends into the merged room, opposite-thickness collinear walls stay a
stepped facade and fill the outer step corner so inner faces stay aligned, and the two remaining
walls keep overlapping rectangular solids instead of a convex-mitered trapezoid.
Closed exterior-wall T branches retain one topology node and physical wall.
An inferred orthogonal close absorbs a collinear continuation into the last
measured wall rather than leaving a butt joint. Loading a saved draft also
folds remaining collinear degree-2 splices into one wall. Deleting a wall that
opens a single closed room restores the remaining loop as the active chain and
offers the missing-edge close when the dangling ends still determine it.
Resetting the cursor onto either dangling vertex resumes that same open chain.
Inner/outer start selects the near/far point on the source boundary and the
corresponding first-wall inset; it does not choose opposite local faces for the
new branch. Every branch segment uses the graph-side working face and inherits
the physical-body side fixed by the first segment. Turn direction and the
source-space centroid cannot re-evaluate that side. Orthogonal touch input stays
on the internal graph, while the preview outline, orange/red path,
live-dimension endpoints, and green cursor remain coincident. Straight-mode
vertex or closure snaps may change at most one axis and must not copy an
off-axis vertex onto the orange preview; the wall-drag lens reports the actual
snap type. Adjacent red edges
meet with equal endpoints, so beginning a second segment cannot shift the cursor
or red line by one wall thickness. Measurement inset/extension fields record
real boundary or closure adjustments only; an ordinary outer-start T turn does
not synthesize a wall-thickness adjustment. Preview, manual/BLE confirmation,
Canvas, and dimension consumers consistently calculate `topology length - start
inset + start extension - end inset`. Closed-room Canvas dimension lanes sit
outside every unclosed wall on the canvas plus a stationary length preview; an
in-flight `wallPreview` drag does not move those lanes. This derived Canvas projection does not
change graph centreline/closure topology. From the second branch wall onward,
turns may
join the rendered wall solids but cannot rewrite preceding measurement insets
or shorten confirmed readings. A shared-boundary closure
chain retains its rendered body side when it closes,
including an exterior-facing chain whose final orange line snaps to an existing
room's inner face; the close operation cannot flip that body across the aligned
line by one wall thickness. When the final cursor targets a source wall's
visible outer face, it retains that physical outer coordinate and bridges to
the topology corner instead of projecting it to the centre line. Corner
continuations and shared internal partitions keep their existing closure behavior.

## Shared APIs and utilities

### Shared Less utilities

The Mini Program uses the WeChat DevTools `less` compiler plugin configured in
`miniprogram/project.config.json`. All page and component styles are `.less`
files; `app.less` imports `styles/utilities.less` globally. New WXML should
reuse the shared layout, sizing, typography, color, radius, button, and status
classes (for example `flex-row flex-1 justify-between gap-8`) instead of
duplicating primitive declarations. Route-specific visual rules remain in the
route's own `.less` file. The compiled runtime still receives standard WXSS.

- Appointment ownership update: the customer project folio now exposes the automatically assigned measurer independently from appointment state. A customer-owned lead without a confirmed appointment can enter `appointment-booking` and create the first slot through `POST /api/appointments`; server availability, ownership checks, and automatic measurer replacement remain authoritative.

- Authentication/context: `/api/auth/miniprogram`, `/api/miniprogram/bootstrap`,
  `/api/miniprogram/identity-contexts`,
  `/api/miniprogram/identity-contexts/switch`, and the shared context resolver.
  Context lists are always read from the database; a switch cannot assert an
  enterprise, staff identity, or referrer membership that is not active.
  `app.js` refreshes the signed token on startup/resume and uses one role-landing
  helper; a 401 or `contextVersion` mismatch clears local session state without
  falling back to an incorrect role.
- Referrer network: enterprise join-code PNG/JPEGs open the dedicated onboarding
  route, which resolves only the opaque token type before phone authorization.
  Both enterprise onboarding and referrer promotion code generation target
  `develop` through `getwxacodeunlimit`, even from a production server process;
  its 32-character `scene` carries the token digest and
  the onboarding page restores the `ej_`/`rp_` prefix before resolution
  and then uses the existing onboarding API. The promotion display route loads
  a protected WeChat Mini Program code for the current referrer membership; the anonymous claim route
  classifies and audits opaque tokens and issues a short-lived pending source
  without creating a lead. Customer
  authorization with `Idempotency-Key` atomically creates the active attribution,
  lead, and assignment; concurrent or repeated scans cannot replace an open
  project. Phone-authorized users can
  join one staff enterprise or up to three referrer enterprises by default;
  leaving a membership disables its promotion token and invalidates old JWTs.
- Customer projects, referrer progress, and design publication: `GET /api/miniprogram/customer-projects` lists only unarchived projects owned by the current `customer_user_id`; `GET /api/miniprogram/customer-projects/[leadId]` returns the enterprise, designer, current appointment, completed v4 floor-plan summary, and active publications for that owner. Published images use a protected endpoint under the same customer identity. `GET /api/miniprogram/referrer-progress` and `GET /api/miniprogram/referrer-earnings` are fixed to the JWT's active membership and return only masked service facts and the referrer's own commission records. The assigned designer can publish or withdraw only succeeded generations belonging to their lead, while the enterprise administrator can manage the tenant; withdrawal retains the generation but immediately removes customer visibility.
- Leads, floor plans, measurements, devices, AI, commissions, promotions, and
  notifications use their corresponding tenant-aware API families. Appointment
  availability returns the enterprise time zone, duration, step, and maximum
  advance-day boundary; booking and rescheduling pages use that server boundary
  instead of treating a locally generated date list as authoritative. Customer
  appointment endpoints derive the tenant only after the requested lead or
  appointment has been verified as customer-owned; the customer token never
  asserts an enterprise ID.
- Measurer appointment detail reads are authorized against the appointment's
  persisted `measurerId`, not only the lead's provisional `measurerId`; the
  detail request includes the selected `appointmentId` for direct lookup. This
  preserves access after an automatic measurer replacement while filtering out
  appointments assigned to another measurer.
- Graph and Canvas sources are `miniprogram/utils/surveyWallGraph.js`,
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`, and the
  surveying dimension/solid planners.
- BLE integration is `miniprogram/utils/bluetooth.js`; protocol semantics come
  from the repository vendor document.

## Visual QA Record

The appointment-detail action group now keeps completion, scheduling, cancellation, and service-address actions in one full-width stack with the same 84rpx minimum height and spacing; the address action remains the secondary visual treatment. Completing an appointment is server-gated: the lead must have a completed formal v4 surveying floor plan with at least one closed space, otherwise `POST /api/appointments/[id]/complete` returns `appointment_survey_required` (409) and does not change appointment status. The existing approved appointment-detail source remains authoritative; refreshed authenticated `390x844` capture is still pending.

On 2026-08-19, the referrer-network and appointment routes were inspected in WeChat DevTools at `390x844`: referrer workbench, progress, earnings, and customer-project index loading/empty/error containers preserve the capsule-safe header. The workbench Progress/Earnings actions now use flex equal sizing with an explicit zero basis to override the native button minimum width, removing the center-border overlap and narrow-screen overflow. The booking page disabled primary CTA now keeps high-contrast white text, long scene copy has flex shrink constraints, and an invalid-lead database error is mapped to a Chinese recovery message. Appointment detail/reschedule, the formal customer folio, and onboarding still need authenticated business data for action-state acceptance.

## Maintenance

### Role entry tightening

Legacy login responses with `role: user` are normalized to the `customer` context so cold launch cannot render the old floor-plan shell; remaining packaged promotion, commission, inspiration, and recommendation deep routes are explicitly capability-mapped instead of being implicitly allowed.

Customer and referrer Mine retain account, identity, and security controls but no longer render the legacy floor-plan list, create-survey, or start-survey actions. The referrer TabBar now exposes the contractual `Promotion/Progress/Earnings/Mine` destinations directly. Designer, enterprise-owner, and customer lead details hide formal-survey edit/create/delete actions; only a measurer can enter the sole formal editor from an assigned task. Lead creation is exposed only to the enterprise owner. Booking, appointment-detail, and reschedule deep links are capability-mapped for customer, designer, measurer, and enterprise-owner contexts, and the shared `openSurveyingEditor` helper performs a second signed-context check.

When a route, API, permission, data contract, status, limitation, or visual
source changes, update its row and the Chinese mirror. Keep one current row per
route in the restoration ledger. Do not append date-based implementation notes,
superseded references, or duplicate test transcripts.

Chinese mirror: [miniprogram-system-modules.zh-CN.md](./miniprogram-system-modules.zh-CN.md)
