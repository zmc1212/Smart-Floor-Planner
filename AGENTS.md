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
- `蓝牙命令列表V1.docx` is the vendor protocol reference for the supported BLE
  laser distance meter's commands, response frames, system information, and
  device-status fields.
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

## Mandatory Design Approval Gate

- Treat requests to design, redesign, restyle, explore, or propose an interface
  as design-only work unless the user explicitly asks for implementation in the
  same request.
- For design-only work, produce the design proposal, wireframe, mockup, visual
  reference, or review without modifying product code, styles, APIs, tests, or
  runtime module documentation.
- After presenting the design, wait for the user's explicit approval to begin
  development. Only a clear instruction such as “开始开发”, “开始实施”, or
  “按此方案落地” authorizes implementation.
- Do not infer implementation approval from a request to redesign an interface,
  even when the requested design is technically straightforward.

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
- Before designing or redesigning a Mini Program surface, also read
  `docs/design/jiakelai-brand-ip-guidelines.md`. Treat its confirmed
  `F1 character body + F3 spatial transformation` system and the C-style
  business-metaphor direction as the default brand-IP language unless the user
  explicitly approves another direction.
- Give Xiao K one clear business role on each surface and integrate that role
  into a real information structure or interaction metaphor. Do not use the IP
  as repeated decoration, let it obscure high-frequency work, or use it to
  imply unavailable functionality.
- The approved Leads C comp is a design north star, not proof of implementation.
  Keep production status, live behavior, data, permissions, and route support
  grounded in the current code and module inventory.
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
- At the `390x844` baseline, primary labels, actions, body copy, and business
  values must render at `24rpx` (about `12px`) or larger. Secondary metadata and
  helper text must render at `20rpx` (about `10px`) or larger. Text below
  `20rpx` is reserved for nonessential decorative annotations only and must
  never carry an action, status, business value, or required explanation. Do
  not use `transform: scale(...)` or image-embedded text to bypass these floors.
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

### BLE Device Protocol

- Before diagnosing or changing BLE discovery, commands, response parsing,
  system information, battery/status display, or related Mini Program UI, read
  the repository-root `蓝牙命令列表V1.docx` in addition to the applicable
  Mini Program and formal-surveying documentation.
- Treat the document's command and frame definitions as the protocol source of
  truth. When it conflicts with a connected device's observed behavior, retain
  the raw response bytes and resolve the discrepancy before assigning field
  meaning or persisting/displaying a value.

### WeChat DevTools Window Discipline

- Reuse the user's currently open WeChat DevTools project window for Mini
  Program compilation, automation, screenshots, and visual QA.
- Do not run `cli open`, `cli auto`, or an equivalent command when it would open
  a duplicate WeChat DevTools window for the same project. Connect only to the
  automation endpoint already exposed by the current window.
- If the current window has not enabled automation or its endpoint is
  unavailable, report that limitation and ask the user to enable it in the
  existing window. Do not create a temporary project copy or launch another
  DevTools window as a workaround.
- Never close, restart, or replace the user's current WeChat DevTools window
  without explicit approval. A window created by Codex may be closed only after
  its exact project path has been verified.

## Verification

For documentation-only changes, run `git diff --check` and verify referenced
paths, route names, status labels, and English/Chinese parity. For code changes,
run the narrowest relevant tests (`cd miniprogram && npm test`, or the applicable
`admin` lint/build checks) in addition to the document checks.
