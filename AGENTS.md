# Smart Floor Planner Project Instructions

This repository contains the Smart Floor Planner product: a Next.js/Mongoose
administration system and a native WeChat Mini Program for renovation leads,
formal surveying, and AI-assisted design.

## Source Of Truth

- Treat the current code, route handlers, schemas, and tests as authoritative.
- `docs/admin-system-modules.md` describes the current admin surface.
- `docs/miniprogram-system-modules.md` describes the current Mini Program surface.
- `docs/surveying-module/README.md` and `formal-surveying.md` describe the formal
  surveying contract and its operational cleanup procedure.
- `PRODUCT_ROADMAP.md`, `docs/**/implementation_plan.md`, and old design notes are
  historical/planning material, not proof that a feature is implemented.
- Feature status uses `Implemented`, `Limited`, or `Placeholder`. A label, mock
  response, or toast is not an implemented backend capability.

Read the relevant module document before changing that module, and update its
English/Chinese pair when routes, APIs, permissions, or user flows change.

## Mandatory Development Documentation Gate

This gate applies to every feature, bug fix, refactor, and UI/API change:

1. Before editing, read this file, the nearest nested instruction file, and the
   module inventory for the affected surface. For surveying work, also read the
   formal surveying document and data contract.
2. During implementation, treat the module inventory as part of the feature
   change. Update its status, page/route entry, API, model/data contract,
   permission or role boundary, and known limitations whenever the behavior
   changes. Update the English and Chinese pair in the same change.
3. Before declaring the work complete, inspect the diff and confirm that the
   documentation reflects the code. If a change genuinely has no documented
   impact, state that explicitly in the handoff; do not silently skip the check.

This is a completion requirement, not optional follow-up work. Documentation is
the durable project memory used by later AI sessions; code comments, a prompt,
or a roadmap do not replace the current module inventory.

## Repository Map

- `admin/`: Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui + Radix,
  Mongoose, and MongoDB-backed APIs. Local development uses port `3005`.
- `miniprogram/`: native WeChat Mini Program. BLE laser integration is in
  `utils/bluetooth.js`; graph and canvas logic are in `utils/surveyWallGraph.js`
  and `utils/surveyCanvasRenderer.js`; Three.js is used for opening previews.
- `docs/`: current module inventories and focused technical contracts.
- `admin/src/models/`: tenant-aware business schemas.
- `admin/src/app/api/`: server route handlers; `admin/src/lib/` contains auth,
  tenant, workflow, AI, WeCom, and survey adapters.

## Cross-Client Architecture

- Admin sessions use cookie/JWT authentication and role/menu permissions.
- Mini Program sessions use `/api/auth/miniprogram` and a bearer JWT. The same
  API resolves professional staff context, enterprise referral, branding, leads,
  floor plans, measurements, commissions, and promotion records.
- Business data is enterprise-scoped whenever an enterprise context exists.
  Use the shared tenant helpers and model plugin; do not hand-roll an alternate
  tenant filter.
- A formal floor plan is a version-4 surveying wall graph. Admin viewers, DXF,
  3D, AI, and other consumers derive read models through adapters; they must not
  write a legacy layout copy back to `FloorPlan.layoutData`.

## Mandatory Engineering Rules

### Git

Use a Conventional Commit English subject: `feat:`, `fix:`, `refactor:`,
`docs:`, `chore:`, or `test:`. Keep it concise and limited to the related
staged change; split unrelated work.

### Admin UI And Feedback

- Use shadcn/ui and Radix primitives. Reusable controls belong in
  `admin/src/components/ui/*`; business pages should use shared components and
  semantic Tailwind tokens.
- Every visible admin-triggered mutation must use the shared operation feedback
  UI for success and failure. Do not use raw `alert()` as normal feedback.
- Dangerous confirmations may be native, but the resulting operation still needs
  a success or failure notification.
- Tenant-aware routes must use `withTenantRoute`, `withTenantContext`, or the
  corresponding shared resolver and must enforce the endpoint's role boundary.

### Mini Program Design And Navigation

- Follow `miniprogram/DESIGN.md`, `design-tokens.json`, and `app.wxss` tokens for
  new UI. Preserve the bright green, calm home-design visual language.
- Store AI-generated design-reference images only in the repository-root
  `design-references/` directory. It is Git-ignored and must never be placed
  under `miniprogram/`, so reference assets cannot inflate the Mini Program
  package.
- Use the iPhone 13 Pro `390x844` viewport as the primary visual QA baseline.
  Standard fixed-content result/action pages should keep the page heading,
  primary content, key actions, and final CTA visible in one screen including
  the navigation bar and safe area. Lists, dynamic content, accessibility text,
  and smaller viewports may scroll, but critical actions must not be hidden by
  avoidable spacing.
- Use one coherent, locally stored, license-documented icon set for primary
  actions. Do not ship emoji, mixed Unicode symbols, or multi-stroke CSS-drawn
  icons as product icons; CSS is reserved for simple geometry such as status
  dots, chevrons, and separators.
- Where the design calls for a hairline separator, render a short `1px` line and
  use `transform: scaleX(0.5)` or `scaleY(0.5)` on the thickness axis instead of
  a visually heavy full-length border.
- The only formal measurement page is
  `miniprogram/pages/surveying-editor/surveying-editor.*`.
- Every measurement entry uses that page with `leadId` and/or `floorPlanId`.
  Never reintroduce `pages/editor/editor`, `restoreFloorPlan`, or a dual entry.
- Formal `FloorPlan.layoutData` contains only `version: 4`,
  `measurementMode: 'surveying'`, and `surveyGraph`. Never persist `rooms`,
  `homeOutline`, `partitions`, `surveyDraft`, `prototypeOnly`, or
  `surveying_prototype`.
- Wall-graph values are millimetres. BLE readings are logged as formal measurement
  audits; readings captured before the first cloud save remain queued until a
  formal `floorPlanId` exists. Temporary BLE callback owners must restore the
  normal callback when they close.
- Do not bring back the removed legacy editor components or old geometry utilities.

## Verification

For documentation-only changes, run `git diff --check` and verify referenced
paths, route names, status labels, and English/Chinese parity. For code changes,
run the narrowest relevant tests (`cd miniprogram && npm test`, or the applicable
`admin` lint/build checks) in addition to the document checks.
