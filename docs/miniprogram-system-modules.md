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
  server-owned badge summary. Phone authorization can
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

| Surface | Runtime routes | Current contract | Status/limitation |
| --- | --- | --- | --- |
| Home and measurement entry | `pages/index/index` | Customer shared home, or the signed designer/measurer/enterprise-owner role workbench. Designer shows only own assigned customer work, measurer shows only own confirmed schedule and assigned survey entry, and enterprise owner shows tenant operations. The local `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` switch opens a fresh editor without loading recent plans | Implemented/Limited; role workbenches read the server-derived `GET /api/miniprogram/workbench` aggregate and reuse the four static Tab routes. The customer TabBar exposes `Projects` to the owned-project index; the debug switch remains local-only. Authenticated `390x844` native-capsule QA for the new role states remains pending |
| Leads and customer records | `pages/leads-management/leads-management`, `packages/business/lead-form/lead-form`, `packages/business/lead-detail/lead-detail` | Lead list/detail, conversion state, formal-plan summary; the assigned designer can enter first booking when no confirmed appointment exists. On the static role Tab route, a measurer sees only own confirmed appointment tasks; designers and enterprise owners retain their authorized customer route. JWT-backed staff sessions load the list without requiring a legacy OpenID. When a referral-network lead enters `converted` through the existing signing endpoint, the server snapshots referrer, designer, and measurer commissions in the same transaction | Implemented/Limited; conversion and appointment-entry permissions are server enforced, and role Tab items are capability-allowlisted. Percentage rules require a contract amount and a paid three-role commission blocks enterprise-admin signing reversion |
| Promotion and staff tasks | `packages/business/promotion-records/promotion-records`, `packages/business/promotion-record-detail/promotion-record-detail` | Enterprise referral and staff notification flows | Implemented/Limited; WeChat delivery can fail externally |
| Referrer network, appointments, and anonymous claim | `packages/business/onboarding/onboarding`, `packages/business/onboarding-debug/onboarding-debug`, `packages/business/referrer-workbench/referrer-workbench`, `packages/business/referrer-progress/referrer-progress`, `packages/business/referrer-earnings/referrer-earnings`, `packages/business/promotion-service-code/promotion-service-code`, `packages/business/free-design-service/free-design-service`, `packages/business/customer-projects/customer-projects`, `packages/business/customer-project/customer-project`, `packages/business/appointment-detail/appointment-detail`, `packages/business/appointment-reschedule/appointment-reschedule`, `packages/business/appointment-booking/appointment-booking`, `packages/business/measurer-calendar/measurer-calendar`, `packages/business/measurer-unavailability/measurer-unavailability`, `packages/business/identity-recovery/identity-recovery` | Type-isolated onboarding, promotion code, anonymous claim, customer project, and appointment deep routes retain their contracts. The customer index returns only unarchived projects owned by the current JWT customer. Referrer progress and earnings are scoped to the signed active membership and return only masked customer labels, service facts, and the referrer's commission state, never a phone number, exact address, wall graph, internal appointment reason, or design file. Selecting an in-workbench referrer enterprise exchanges the signed membership context before the session is refreshed, so its service code, progress, and earnings share that boundary. A valid onboarding code resolves code type and enterprise before phone authorization; development-only `onboarding-debug` can select a local code into the same real flow. Appointment actions remain separated among designer, measurer, enterprise owner, and customer; the referrer workbench keeps logout visible and only shows identity switching when the server reports more than one distinct identity mode. Invalid identities enter a dedicated recovery page before reauthentication | Implemented/Limited; a referrer enters the workbench after onboarding, login, and JWT-backed cold launch. A real signed referrer verified both login completion and cold launch at `390x844`, including a native-capsule host capture. The workbench now opens masked progress and own earnings for its current enterprise; customer-project ownership, appointment role checks, and optimistic versions remain enforced. A temporary identity-context read failure leaves promotion controls usable and hides switching. Phase 12 now exposes the current executable referrer/measurer navigation from bootstrap and clears invalid sessions without exposing the invalid tenant. New customer-project, progress, and earnings routes still need authenticated `390x844` QA; measurer-task aggregation, authenticated appointment/publication actions, and full role production UI remain pending; WeChat delivery is external |
| Commission records | `packages/business/commission-records/commission-records` | Order commissions for eligible commercial roles | Implemented; settlement remains backend/business controlled |
| Inspiration library | `packages/business/inspiration/inspiration` | Tenant-scoped inspiration browsing and detail | Implemented/Limited; media provider is external |
| AI design workflow | `pages/ai-design/ai-design`, `packages/ai-workflow/*` | Customer/project selection, recipe entry, confirmation, task result/history, and lead-scoped publication state. A succeeded result tied to a lead lets the responsible designer or enterprise administrator publish it to or withdraw it from the customer project after confirmation. The static role Tab becomes an assigned formal-survey entry for measurers and confirmed-appointment view for enterprise owners | Implemented/Limited; provider, credit, formal-survey eligibility, lead responsibility, publication visibility, and workbench scope are server controlled. Authenticated `390x844` native-capsule QA for the alternate role states remains pending |
| Mine and account | `pages/mine/mine`, `packages/business/profile-edit/profile-edit`, `packages/business/settings/settings`, `packages/business/identity-switch/identity-switch`, `packages/business/identity-recovery/identity-recovery`, `packages/business/account-security/account-security` | Notifications, account security, and server-backed identity-context selection; `GET /api/miniprogram/bootstrap` returns the current role, valid role groups, enterprise/membership context, landing path, capability allowlist, and server-owned badge summary. Switching exchanges a signed context token; login, onboarding, claims, switching, and startup recovery refresh and validate bootstrap before shared identity navigation enters a signed landing. `identity-navigation` rejects unknown identities and forbidden deep links; an invalid signed context enters the recovery page, clears its old session, and requires reauthentication | Implemented/Limited; bootstrap roles generate only wired capability-allowlisted navigation: customer `Service/Projects/Mine`, referrer `Promotion/Progress/Earnings/Mine`, designer `Workbench/Customers/Design/Mine`, measurer `Schedule/Tasks/Survey/Mine`, and enterprise owner `Operations/Customers/Appointments/Mine`. Revocation, deactivation, and version changes expose no invalid-tenant data and never silently fall back to customer |
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
Inner/outer start selects the near/far point on the source boundary and the
corresponding first-wall inset; it does not choose opposite local faces for the
new branch. Every branch segment uses the graph-side working face and inherits
the physical-body side fixed by the first segment. Turn direction and the
source-space centroid cannot re-evaluate that side. Orthogonal touch input stays
on the internal graph, while the preview outline, orange/red path,
live-dimension endpoints, and green cursor remain coincident. Adjacent red edges
meet with equal endpoints, so beginning a second segment cannot shift the cursor
or red line by one wall thickness. Measurement inset/extension fields record
real boundary or closure adjustments only; an ordinary outer-start T turn does
not synthesize a wall-thickness adjustment. Preview, manual/BLE confirmation,
Canvas, and dimension consumers consistently calculate `topology length - start
inset + start extension - end inset`. This derived Canvas projection does not
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
- Graph and Canvas sources are `miniprogram/utils/surveyWallGraph.js`,
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`, and the
  surveying dimension/solid planners.
- BLE integration is `miniprogram/utils/bluetooth.js`; protocol semantics come
  from the repository vendor document.

## Maintenance

When a route, API, permission, data contract, status, limitation, or visual
source changes, update its row and the Chinese mirror. Keep one current row per
route in the restoration ledger. Do not append date-based implementation notes,
superseded references, or duplicate test transcripts.

Chinese mirror: [miniprogram-system-modules.zh-CN.md](./miniprogram-system-modules.zh-CN.md)
