# Mini Program: Current Module Inventory

This inventory describes the native WeChat Mini Program under `miniprogram/`.
The implementation baseline is the current `app.json`, page handlers, shared
utilities, and the admin APIs they call.

## Status Legend And Runtime

- `Implemented`: the page and its real data/action path work.
- `Limited`: the path depends on login, an enterprise role, BLE hardware, a
  provider, or a particular formal wall-graph shape.
- `Placeholder`: the page or control is visible, but uses mock/local behavior,
  a planned toast, or no real server operation.
- Runtime: native WeChat Mini Program, JWT bearer requests through
  `utils/api.js`, `threejs-miniprogram` for 3D previews, and optional BLE laser
  distance meter integration.
- Main tabs: Home (`index`), Leads (`leads-management`), Inspiration
  (`inspiration`), and Mine (`mine`). Login, detail, workflow, AI, recommendation,
  and formal surveying pages are secondary routes.

## Shared Identity And Context

- `/pages/login/login`: WeChat phone quick login and username/password login via
  `/api/auth/miniprogram`; restores a JWT/user session in app storage.
- `app.js`: restores sessions, reads QR/referral `enterpriseId`/`staffId`, syncs
  staff professional context, loads enterprise branding, and attempts silent BLE
  reconnection for a remembered device.
- `utils/api.js`: sends the bearer token, retries configured local/LAN API bases,
  clears expired sessions, and redirects to login after a 401.
- Status: login and context restoration are `Implemented`; a valid WeChat
  authorization, account, API base, and enterprise/provider configuration are
  required for the corresponding path.

## Page Inventory

### Home And Measurement Entry

- Page: `pages/index/index`.
- APIs: `/api/miniprogram/home`, `/api/floorplans`, `/api/floorplans` POST/PUT,
  `/api/leads/[id]`, `/api/location/reverse`, `/api/users/me`.
- Implemented: dashboard summaries, location/city, recent cloud plans, lead
  capture, BLE connection state, remembered-device auto-connect, new/continue
  formal surveying, floor-plan room entry, and AI handoff for a room.
- Placeholder: quick quotation, help center, and some shortcut cards only show
  an “upcoming”/planned message.

### Leads And Customer Records

- Pages: `pages/lead-form/lead-form`, `pages/leads-management/leads-management`,
  `pages/lead-detail/lead-detail`.
- APIs: `/api/leads`, `/api/leads/[id]`, `/api/floorplans/[id]` DELETE.
- Implemented: customer name/phone/community/area/style capture, recent leads,
  list/detail views, formal-plan association, continue measurement, start a new
  independent measurement, and delete active formal plans with local pointer
  cleanup.
- Limited: lead creation and plan operations require a valid Mini Program session;
  phone and community validation are client-side plus server-side checks.

### Enterprise Promotion And Staff Tasks

- Pages: `pages/promotion-records/promotion-records` and
  `pages/promotion-record-detail/promotion-record-detail`.
- APIs: `/api/promotion-records`, `/promotion-records/[id]`, `/promotion-records/pool`,
  `/staff?roles=...`, workbench summary/todos, and related update endpoints.
- Implemented: create enterprise reports, list role-specific views (`my`,
  `measure`, `design`, `admin`, `overdue`, `pool`), search/filter, public-pool
  claim or approval request, conflict ownership resolution, follow-up notes and
  due dates, measurer/designer/promoter assignment, and business-stage actions.
- Limited: available actions and list views depend on the logged-in staff role
  and the server-side promotion workflow state.

### Commission Records

- Page: `pages/commission-records/commission-records`.
- API: `/api/commission-records`.
- Implemented: summary cards and lists for pending, paid, and voided commission
  records, with order/settlement explanation.
- Limited: records are generated and settled by the enterprise order workflow;
  the Mini Program is a read view, not the settlement authority.

### Inspiration Library

- Page: `pages/inspiration/inspiration`.
- API: `/api/inspirations?page=...&style=...&roomType=...`.
- Implemented: paginated loading, pull-to-refresh, style and room filters,
  image preview, share-poster shell, and free-design lead entry.
- Limited: result availability depends on published backend inspiration content.

### AI Room Generation

- Page: `pages/ai-gen/ai-gen`.
- APIs: `/api/ai/render` and `/api/ai/advice` through
  `utils/renderingService.js`.
- Implemented: receives a room derived from a formal plan, selects a style and
  effect/plan mode, sends dimensions/openings/polygon to the backend, downloads
  the rendered image, requests design advice, previews the image, creates
  a share poster, and copies a generated prompt.
- Limited: requires a current room context, authenticated API access, and an
  available enterprise AI provider/configuration. Lead capture is a separate
  `lead-form` flow.

### Mine And Workbench

- Page: `pages/mine/mine`.
- APIs: `/api/miniprogram/mine`, `/api/floorplans`, and navigation to leads,
  promotion records, commissions, surveying, and AI.
- Implemented: profile/role display, workbench summary, todos, floor-plan list,
  notification/account actions, logout, new measurement, and AI entry from a
  plan card.
- Limited: workbench cards and task actions vary by professional role; some
  account/notification cards are informational rather than configuration APIs.

### Recommendations Share Page

- Page: `pages/recommendations/index`.
- Limited: the registered page displays local styles/progress and defines a
  WeChat `onShareAppMessage` payload.
- Placeholder: recommendations are hard-coded mock data; “PDF download” is a
  timed success toast and does not generate or download a real PDF; the custom
  share ActionSheet has no follow-up operation; interaction tracking is local
  logging only.

## Formal Surveying

- Page: `pages/surveying-editor/surveying-editor`; all entries use
  `utils/surveyNavigation.js` with `leadId` and/or `floorPlanId`.
- Data contract: `FloorPlan.layoutData` is only `{ version: 4,
  measurementMode: 'surveying', surveyGraph }`; graph units are millimetres.
- Implemented editor behavior: startup restore, local draft and cloud draft
  persistence, straight and diagonal wall preview/commit, live BLE/manual length,
  remeasure, shared-wall closure, advisory close candidate, openings, opening
  dimensions and side, cursor placement for new wall chains, undo/reset, completed
  submission, and measurement audit queue/flush.
- Implemented angle behavior: diagonal direction snap within the documented
  threshold, number-pad angle entry, operator-confirmed phone motion angle, and
  three BLE triangle readings validated with the cosine rule. Closing the angle
  panel does not mutate wall geometry or leave motion listening active.
- Implemented rendering/editor behavior: CAD-like full-width door/window symbols,
  inner-edge unfinished redline, closed-space inner/outer dimensions, opening
  chain dimensions, opening component specifications, BLE component measurement,
  flip/model panels, and a Three.js preview for the selected door/window.
- Limited: BLE actions require a compatible connected device; some reserved
  bottom/object tools intentionally display a planned/unavailable message.
- Boundary: the Mini Program editor does not expose a current report exporter or
  full-plan CAD/3D export. Admin `FloorPlanViewer` owns full-plan 2D/3D viewing
  and DXF download through backend adapters. No legacy layout mirror may be saved.
- Operational details and cleanup procedure: `docs/surveying-module/README.md`
  and `formal-surveying.md`.

## Shared Components And Utilities

- BLE: `components/ble-connector`, `components/ble-gate`, and `utils/bluetooth.js`.
- Navigation: `utils/surveyNavigation.js` owns formal editor entry and local
  resume-pointer cleanup.
- Graph/rendering: `surveyWallGraph.js`, `surveyCanvasRenderer.js`,
  `surveyLayout.js`, and `renderingService.js`.
- UI: nav bar, custom tab bar, lead list/modal, share poster, room library, and
  survey compass components.

## Maintenance Rules

Before changing any Mini Program page, component, utility, API flow, or data
contract, read the root instructions, this inventory, and the applicable design
or formal-surveying document. In the same change, update this inventory and its
Chinese mirror with the real entry route, API, role/condition, data contract,
status, and limitations. Keep formal surveying rules aligned with the v4 graph
contract; do not document a mock or planned control as a live feature. If a change
has no functional documentation impact, state that explicitly in the handoff.
