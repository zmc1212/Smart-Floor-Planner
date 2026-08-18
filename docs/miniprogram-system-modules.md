# Mini Program: Current Module Inventory

This inventory describes the current native WeChat Mini Program runtime. It
contains current routes, contracts, permissions, and limitations only; dated
restoration notes and test transcripts belong in Git history or local evidence.

## Runtime and shared context

- Native WeChat Mini Program with custom tab bar, bright-green design tokens,
  and iPhone 13 Pro `390x844` as the visual baseline.
- Sessions use `/api/auth/miniprogram` and bearer JWT. Phone authorization can
  create an ordinary customer account; the phase-3 referral claim endpoint can
  also consume WeChat authorization codes and atomically link the account,
  attribution, and lead. Tokens select a database-validated
  `customer`, `staff`, or `referrer` context and are invalidated by
  `contextVersion`. Professional staff, enterprise context, leads, floor plans,
  AI tasks, commissions, and promotion records resolve through shared APIs.
- Primary actions use locally stored, license-documented icons. Native host
  capsule and safe areas remain outside the content lane.
- `Implemented`, `Limited`, and `Placeholder` describe executable runtime
  behavior, not labels or mock responses.

## Page inventory

| Surface | Runtime routes | Current contract | Status/limitation |
| --- | --- | --- | --- |
| Home and measurement entry | `pages/index/index` | Current shared home, lead/project cards, and formal-survey entry; the local `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` switch opens a fresh editor without loading recent plans | Limited; server data can be tenant/role scoped, but the client still uses a staff/non-staff split and the static tab bar exposes leads, surveying, or AI entries to unrelated customer/referrer contexts. Phases 11-15 replace it with a five-role allowlisted shell; the debug switch remains local-only |
| Leads and customer records | `pages/leads-management/leads-management`, `packages/business/lead-form/lead-form`, `packages/business/lead-detail/lead-detail` | Lead list/detail, conversion state, formal-plan summary; the assigned designer can enter first booking when no confirmed appointment exists. When a referral-network lead enters `converted` through the existing signing endpoint, the server snapshots referrer, designer, and measurer commissions in the same transaction | Implemented/Limited; conversion and appointment-entry permissions are server enforced, but the shared tab bar does not yet remove irrelevant lead entries by identity. Percentage rules require a contract amount and a paid three-role commission blocks enterprise-admin signing reversion |
| Promotion and staff tasks | `packages/business/promotion-records/promotion-records`, `packages/business/promotion-record-detail/promotion-record-detail` | Enterprise referral and staff notification flows | Implemented/Limited; WeChat delivery can fail externally |
| Referrer network, appointments, and anonymous claim | `packages/business/onboarding/onboarding`, `packages/business/onboarding-debug/onboarding-debug`, `packages/business/referrer-workbench/referrer-workbench`, `packages/business/promotion-service-code/promotion-service-code`, `packages/business/free-design-service/free-design-service`, `packages/business/customer-project/customer-project`, `packages/business/appointment-detail/appointment-detail`, `packages/business/appointment-reschedule/appointment-reschedule`, `packages/business/appointment-booking/appointment-booking`, `packages/business/measurer-calendar/measurer-calendar`, `packages/business/measurer-unavailability/measurer-unavailability` | Type-isolated onboarding, promotion code, anonymous claim, customer project, and appointment deep routes retain their contracts. A valid onboarding code resolves code type and enterprise before phone authorization; development-only `onboarding-debug` can select a local code into the same real flow. Appointment actions remain separated among designer, measurer, enterprise owner, and customer | Implemented/Limited; a referrer can enter the workbench immediately after onboarding, but cold launch/login does not restore that landing and the workbench currently contains only enterprise/service-code controls, not masked progress or own earnings. Customer-project ownership, appointment role checks, and optimistic versions remain enforced. Authenticated role-action/native-host captures and the Phase 11-15 role shell remain pending; WeChat delivery is external |
| Commission records | `packages/business/commission-records/commission-records` | Order commissions for eligible commercial roles | Implemented; settlement remains backend/business controlled |
| Inspiration library | `packages/business/inspiration/inspiration` | Tenant-scoped inspiration browsing and detail | Implemented/Limited; media provider is external |
| AI design workflow | `pages/ai-design/ai-design`, `packages/ai-workflow/*` | Customer/project selection, recipe entry, confirmation, task result/history, and lead-scoped publication state. A succeeded result tied to a lead lets the responsible designer or enterprise administrator publish it to or withdraw it from the customer project after confirmation | Implemented; provider, credit, formal-survey eligibility, lead responsibility, and publication visibility are server controlled |
| Mine and account | `pages/mine/mine`, `packages/business/profile-edit/profile-edit`, `packages/business/settings/settings`, `packages/business/identity-switch/identity-switch`, `packages/business/account-security/account-security` | Notifications, account security, and server-backed identity-context selection; switching exchanges a signed token, refreshes profile data, and persists the session | Implemented/Limited; the switch entry is buried in Settings, a referrer context currently enters the ordinary-user Mine branch, cold launch has no role landing recovery, and multi-enterprise referrer memberships are duplicated between identity list and workbench. Exactly one context remains active; authenticated list capture and the Phase 11-15 role redesign are pending |
| Recommendation share | `packages/business/recommendation-share/*` | Read-only shared recommendation and project summary | Limited by share authorization and available assets |

## Formal surveying

The only measurement editor is
`packages/surveying/editor/surveying-editor`, entered with `leadId`
and/or `floorPlanId`. The authoritative contract is
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md).
`FloorPlan.layoutData` contains only version-4 `surveyGraph` data. Wall graph,
Canvas renderer, dimensions, BLE readings, audit queue, undo/redo, the
right-rail confirmed canvas-clear/restart action, and save failure behavior
must follow that contract. Deleting a wall shared by two closed rooms punches
through that interface and merges them into one closed room, including when the
shared run has been split into collinear segments.
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

- Authentication/context: `/api/auth/miniprogram`,
  `/api/miniprogram/identity-contexts`,
  `/api/miniprogram/identity-contexts/switch`, and the shared context resolver.
  Context lists are always read from the database; a switch cannot assert an
  enterprise, staff identity, or referrer membership that is not active.
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
- Customer projects and design publication: `GET /api/miniprogram/customer-projects/[leadId]` returns the enterprise, designer, current appointment, completed v4 floor-plan summary, and active publications only to the lead's `customer_user_id`; published images use a protected endpoint under the same customer identity. The assigned designer can publish or withdraw only succeeded generations belonging to their lead, while the enterprise administrator can manage the tenant; withdrawal retains the generation but immediately removes customer visibility.
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
