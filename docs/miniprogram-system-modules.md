# Mini Program: Current Module Inventory

This inventory describes the current native WeChat Mini Program runtime. It
contains current routes, contracts, permissions, and limitations only; dated
restoration notes and test transcripts belong in Git history or local evidence.

## Runtime and shared context

- Native WeChat Mini Program with custom tab bar, bright-green design tokens,
  and iPhone 13 Pro `390x844` as the visual baseline.
- Sessions use `/api/auth/miniprogram` and bearer JWT. Professional staff,
  enterprise context, leads, floor plans, AI tasks, commissions, and promotion
  records resolve through the shared tenant-aware API.
- Primary actions use locally stored, license-documented icons. Native host
  capsule and safe areas remain outside the content lane.
- `Implemented`, `Limited`, and `Placeholder` describe executable runtime
  behavior, not labels or mock responses.

## Page inventory

| Surface | Runtime routes | Current contract | Status/limitation |
| --- | --- | --- | --- |
| Home and measurement entry | `pages/index/index` | Role-aware home, lead/project cards, formal-survey entry | Implemented; data is tenant/role shaped |
| Leads and customer records | `pages/leads-management/leads-management`, `packages/business/lead-form/lead-form`, `packages/business/lead-detail/lead-detail` | Lead list/detail, acquisition collaboration, conversion state, formal-plan summary | Implemented; conversion permissions are server enforced |
| Promotion and staff tasks | `packages/business/promotion-records/promotion-records`, `packages/business/promotion-record-detail/promotion-record-detail`, `packages/business/acquisition-center/acquisition-center` | Enterprise referral, staff task and notification flows | Implemented/Limited; WeChat delivery can fail externally |
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
Closed exterior-wall T branches retain one topology node and physical wall. An
inner start places the first red edge on the dragged graph line; an outer start
offsets only that first red edge to the branch outer face, one wall thickness
away. That measurement offset does not propagate beyond the first wall. After
a turn, every later red/orange segment and the cursor stay on the operator's
actual dragged graph line instead of shifting by another wall thickness.
Confirming the first branch wall separately fixes the wall-local side used by
its physical body. Every later left/right preview and committed turn inherits
that body side, so changing drag direction cannot reflect the confirmed first
wall. The first outer edge meets the following dragged edge at their line
intersection, keeping the red corner continuous. This is derived Canvas
geometry and does not change graph centreline/closure topology. From the second branch wall onward, turns may
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

- Authentication/context: `/api/auth/miniprogram` and shared context resolver.
- Leads, floor plans, measurements, devices, AI, commissions, promotions, and
  notifications use their corresponding tenant-aware API families.
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
