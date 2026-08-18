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
| Home and measurement entry | `pages/index/index` | Role-aware home, lead/project cards, formal-survey entry; the local `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` switch opens a fresh editor without loading recent plans | Implemented; data is tenant/role shaped in normal mode; the debug switch is local-only |
| Leads and customer records | `pages/leads-management/leads-management`, `packages/business/lead-form/lead-form`, `packages/business/lead-detail/lead-detail` | Lead list/detail, acquisition collaboration, conversion state, formal-plan summary; the assigned designer can enter first booking when no confirmed appointment exists | Implemented; conversion and appointment-entry permissions are server enforced |
| Promotion and staff tasks | `packages/business/promotion-records/promotion-records`, `packages/business/promotion-record-detail/promotion-record-detail`, `packages/business/acquisition-center/acquisition-center` | Enterprise referral, staff task and notification flows | Implemented/Limited; WeChat delivery can fail externally |
| Referrer network, appointments, and anonymous claim | `packages/business/referrer-workbench/referrer-workbench`, `packages/business/promotion-service-code/promotion-service-code`, `packages/business/free-design-service/free-design-service`, `packages/business/customer-project/customer-project`, `packages/business/appointment-reschedule/appointment-reschedule`, `packages/business/appointment-booking/appointment-booking`, `packages/business/measurer-calendar/measurer-calendar`, `packages/business/measurer-unavailability/measurer-unavailability` | The internal referrer workbench lists active enterprise memberships, selects one, enters its protected service-code route, and leaves it without changing historic attribution; existing anonymous-claim APIs; phase-5 appointment contracts and designer first booking, the customer card, rescheduling, measurer itinerary, and self-service unavailability editor routes are implemented. The approved Phase 6 customer project folio reads the owner-only aggregate to render the real appointment/designer/measurer, completed formal-plan summary, and explicitly published designs; it downloads each protected publication image into an app-local temporary file before preview. First booking and customer rescheduling use fixed full-width CTAs computed from the current window, avoiding native-button compression | Implemented/Limited; customer-project APIs enforce `customer_user_id` ownership and omit withdrawn/deleted designs. The customer project intentionally has no measurement-editor entry, editable graph, or full formal-plan viewer; its formal-plan section is the API's completed-plan summary. Repository/RLS/concurrency tests pass and post-commit creation, rescheduling, and cancellation attempts deliver to staff and subscribed customers. Actual WeChat DevTools automation verified the customer-project top route at `390x844` and a full host-window capture including the native capsule. WeChat delivery depends on external configuration and can be rejected |
| Commission records | `packages/business/commission-records/commission-records` | Measurer acquisition commissions and order commissions | Implemented; settlement remains backend/business controlled |
| Inspiration library | `packages/business/inspiration/inspiration` | Tenant-scoped inspiration browsing and detail | Implemented/Limited; media provider is external |
| AI design workflow | `pages/ai-design/ai-design`, `packages/ai-workflow/*` | Customer/project selection, recipe entry, confirmation, task result/history | Implemented; provider, credit and formal-survey eligibility are server controlled |
| Mine and account | `pages/mine/mine`, `packages/business/profile-edit/profile-edit`, `packages/business/settings/settings`, `packages/business/account-security/account-security` | Role-shaped workbench, notifications, account and permission settings | Implemented/Limited; some settings are WeChat-mediated |
| Recommendation share | `packages/business/recommendation-share/*` | Read-only shared recommendation and project summary | Limited by share authorization and available assets |

## Formal surveying

The only measurement editor is
`packages/surveying/editor/surveying-editor`, entered with `leadId`
and/or `floorPlanId`. The authoritative contract is
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md).
`FloorPlan.layoutData` contains only version-4 `surveyGraph` data. Wall graph,
Canvas renderer, dimensions, BLE readings, audit queue, undo/redo, the
right-rail confirmed canvas-clear/restart action, and save failure behavior
must follow that contract.
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
- Referrer network: the promotion display route loads a protected WeChat Mini
  Program code for the current referrer membership; the anonymous claim route
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
