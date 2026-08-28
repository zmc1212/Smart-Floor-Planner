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
- `docs/measurer-designer-acquisition.zh-CN.md` and
  `docs/measurer-designer-acquisition.md` describe the measurer–designer lead
  acquisition, notification, commission, permission, and data contract.
- `蓝牙命令列表V1.docx` is the vendor protocol reference for the supported BLE
  laser distance meter's commands, response frames, system information, and
  device-status fields.
- Historical roadmaps, implementation plans, and old design notes are planning
  material, not proof that a feature is implemented.
- Feature status uses `Implemented`, `Limited`, or `Placeholder`. A label, mock
  response, or toast is not an implemented backend capability.

Read the relevant module document before changing that module, and update its
English/Chinese pair when routes, APIs, permissions, or user flows change.

## Mandatory Development Documentation Gate

This gate applies to every feature, bug fix, refactor, and UI/API change:

1. Before editing, read this file, the nearest nested instruction file, and the
   module inventory for the affected surface. For surveying work, also read the
   formal surveying document and data contract. For measurer–designer
   acquisition work, also read both `docs/measurer-designer-acquisition.md` and
   `docs/measurer-designer-acquisition.zh-CN.md`, plus the approved workbench
   plan pair before implementing the dual-track redesign.
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

- Visual QA evidence is optional supporting material. It must not impose an
  HTML-first prototype, pixel-similarity score, heatmap, or implementation-
  authorization gate unless the user explicitly requests one for a specific
  investigation.
- Before any Mini Program visual restoration, read
  `docs/miniprogram-design-restoration-ledger.md` and its Chinese mirror. The
  ledger is the canonical cross-session mapping between a runtime route, its
  latest approved design file, visual-QA status, and whether the production
  Mini Program UI has been restored.
- Keep exactly one ledger row per runtime route and exactly one latest design
  file in that row. A newer approved design replaces the prior source entry; do
  not accumulate old design files in the canonical table. Update visual-QA and
  production-restoration status only after the relevant work is complete.

- Treat requests to design, redesign, restyle, explore, or propose an interface
  as design-only work unless the user explicitly asks for implementation in the
  same request.
- HTML comparison prototypes, heatmaps, overlays, and similarity scores are
  optional investigation tools, not a prerequisite for production UI work.
  Use them only when the user explicitly requests them or when they materially
  help diagnose a specific visual mismatch.
- **No source-image slicing in product UI.** A reference screenshot, composite
  design frame, or browser capture must never be divided into tiles, strips,
  backgrounds, or component cuts and painted into an implementation. Only a
  true standalone artwork asset explicitly supplied by the approved design may
  be reused; it must not contain page layout, UI text, controls, or multiple
  scene layers.
- For design-only work, produce the design proposal, wireframe, mockup, visual
  reference, or review without modifying product code, styles, APIs, tests, or
  runtime module documentation.
- After presenting the design, wait for the user's explicit approval to begin
  development. Only a clear instruction such as “开始开发”, “开始实施”, or
  “按此方案落地” authorizes implementation.
- Do not infer implementation approval from a request to redesign an interface,
  even when the requested design is technically straightforward.
- A Mini Program visual-restoration handoff is incomplete until the English and
  Chinese restoration ledgers contain the final current row for every affected
  route.

## Mandatory UI Design Source Check

- Before changing any visible UI, including a bug fix, state transition, empty
  state, loading/error state, copy, spacing, asset, or navigation treatment,
  first inspect the repository for the corresponding design reference, prompt,
  screenshot, visual-QA record, and any existing implementation restored from
  that design. The confirmed design source and the existing restored UI are the
  authority for the change.
- If a corresponding design source exists, explicitly map the requested change
  to that source before editing. A state-only request must switch the existing
  approved state/data path; it must not replace the state with a generic card,
  self-invented layout, copy, color, icon, or artwork.
- If no design source can be found, or multiple sources conflict, pause and ask
  the user which design to follow. Do not invent a visual solution or begin
  frontend implementation based only on a functional guess.
- When the user asks for behavior/API work and does not authorize a visual
  change, preserve the existing markup, styles, assets, and visual hierarchy.
  If the requested behavior exposes a visual-state decision not covered by an
  approved design, ask before changing the UI.
- Before handoff, verify the rendered state against the confirmed design source
  at the applicable viewport and record the source and verification evidence in
  the relevant module documentation.
- For high-fidelity restoration, build and verify an element-by-element visual
  ledger from the approved design: each visible element's bounds, size,
  alignment, and spacing to adjacent elements must be checked at the target
  viewport. Merely avoiding overlap is not an acceptable substitute for the
  designed spacing. When native host UI participates in the composition (for
  example the WeChat menu capsule), validate both application-layer bounds and
  a full host-window capture that includes the native layer.
- When the approved design already contains the required raster artwork, icon,
  or cut region, reuse or extract that exact design asset for the production UI.
  Do not substitute a stock asset or an unrelated existing project icon for
  convenience. If the artwork exists only inside a composite design and cannot
  be extracted as a clean standalone layer, use the available image-generation
  capability to create a route-specific standalone cutout that matches the
  approved subject, visual language, materials, palette, framing, and apparent
  scale before implementing the UI. Generate each distinct business metaphor as
  its own transparent PNG; do not use a generic line icon as a placeholder or
  final substitute. If image generation is unavailable or the generated cutout
  cannot be brought close enough to the approved source, pause and ask the user
  instead of inventing or silently downgrading the asset. Generated cutouts are
  standalone artwork only: they never authorize slicing or repainting a
  composite screenshot, page layout, UI text, or control surface.
  Record the mapping from approved design source/cut to packaged production path
  in the relevant module documentation and include it in visual QA.
- For every business illustration/cutout present in an approved Mini Program
  design, generate a route-specific standalone transparent PNG with the
  project's image-generation capability before implementation. Do not crop,
  slice, or mask the composite design reference into a product asset. Keep each
  generated cutout independent, optimize it before packaging, enforce the
  `300KB` packaged-asset limit, and record its source-to-package mapping in
  the affected module documentation and restoration ledger.

## Repository Map

- `admin/`: Next.js 16 App Router, React 19, Tailwind 4, Ant Design 5 + Ant Design Pro,
  Mongoose, and MongoDB-backed APIs. Local development uses port `3006`.
- `miniprogram/`: native WeChat Mini Program. BLE laser integration is in
  `utils/bluetooth.js`; graph and canvas logic are in
  `packages/surveying/utils/surveyWallGraph.js` and
  `packages/surveying/utils/surveyCanvasRenderer.js`; Three.js is used for opening previews.
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

- Follow the existing Admin UI direction: Ant Design 5, Ant Design Pro
  (`PageContainer`/`ProTable` where appropriate), and shared `AdminAntdProvider`
  tokens. Reusable Admin controls belong under `admin/src/components/admin/*` or
  established business-component areas; do not introduce a parallel UI system.
- For Admin visual QA, use `http://localhost:3006` rather than `127.0.0.1` or
  another loopback alias. For authenticated flows, control the user's existing
  Chrome session with the Chrome plugin; the in-app Browser uses an isolated
  session and is suitable only for unauthenticated views unless separately
  logged in.
- Before proposing or editing an Admin UI refactor, read
  `docs/admin-ui-refactor.md` and `docs/admin-ui-refactor.zh-CN.md`. Treat the
  route ledger as the selection gate: do not select a route marked `Hold` for a
  generic “continue refactoring” request. Reopen it only when the user names the
  route, a screenshot or reproducible visual defect identifies it, its workflow
  contract changes, or the user explicitly approves a new design direction.
  Prefer an unrecorded or explicitly queued route after auditing the remaining
  Admin surface; do not repeatedly choose familiar low-risk table pages.
- The bilingual Admin UI refactor contract and existing Ant Design/Admin Pro
  routes are the confirmed design source for functional Admin work. A separate
  raster or mockup source is not required unless the user requests a new visual
  direction or the route ledger explicitly requires one.
- Every Admin UI refactor must replace the route's single current record in both
  language files with its visual scope, unchanged route/API/permission
  boundaries, concise verification evidence, and any current reopen trigger.
  Do not append a dated change history or full test transcript.
- Every visible admin-triggered mutation must use the shared operation feedback
  UI for success and failure. Do not use raw `alert()` as normal feedback.
- Dangerous confirmations may be native, but the resulting operation still needs
  a success or failure notification.
- Tenant-aware routes must use `withTenantRoute`, `withTenantContext`, or the
  corresponding shared resolver and must enforce the endpoint's role boundary.

### Mini Program Design And Navigation

- Follow `miniprogram/DESIGN.md`, `design-tokens.json`, and `app.less` tokens for
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
- Use Codex's built-in image generation for design references when it is
  available. If it is unavailable or cannot complete the requested image,
  automatically fall back to the `sub2api-image` skill and its configured
  OpenAI-compatible provider. Keep the same prompt, reference-image order, and
  output constraints across the fallback; report which path produced the final
  image without exposing credentials.
- When the user explicitly asks to generate an image with `Antigravity`, that
  request overrides the normal Codex-to-Sub2API priority for the requested
  image. Reuse the already running standalone Antigravity 2.0 desktop app and
  its `Smart-Floor-Planner` project; do not substitute Antigravity IDE or open
  another Antigravity instance. Use Antigravity's built-in
  `generate_image`/`image_generation` capability rather than installing or
  claiming a separate image-generation plugin.
- `generate_image` is an internal Antigravity-agent capability, not a native
  Codex tool. The absence of a directly callable Codex `generate_image` tool is
  never evidence that the running Antigravity app is unavailable and must not
  trigger a provider fallback. Attach to the existing standalone app through
  its live `%APPDATA%\\Antigravity\\DevToolsActivePort` endpoint, read the
  CDP page target from `http://127.0.0.1:<port>/json/list`, and use that page's
  WebSocket connection to verify the `Smart-Floor-Planner` project, submit the
  generation prompt, and monitor the task. Do not rely on keyboard focus when
  a DOM/CDP interaction is available.
- Never invoke the standalone Electron executable with `--help`, `-h`, or an
  equivalent help flag: `Antigravity.exe --help` opens an unintended desktop
  instance rather than providing a harmless CLI help response. To inspect the
  installation, version, or running state, use executable metadata, installed
  files, and process inspection without launching the executable. To start it
  on the user's request, use the verified executable path with no arguments;
  reuse an existing verified instance whenever possible.
- For an Antigravity image request, give the agent the complete prompt, ordered
  reference-image paths and exact workspace output path. Keep generated design
  references under repository-root `design-references/`, and do not authorize
  unrelated product-source changes. The existing Antigravity configuration is
  `Turbo Mode` with artifact review set to `Always Proceed`; do not downgrade or
  reset it. A turn created before a permission change may retain its old
  permission snapshot, but new turns must use the current project settings.
- Treat an Antigravity generation as successful only after the requested raster
  file actually exists at the target path. Verify its file signature, format,
  pixel dimensions and encoded size, inspect the rendered image, and report the
  final absolute path. A submitted prompt, a running indicator, or a generated
  temporary artifact is not completion. Only after process inspection, CDP
  endpoint discovery, attachment, and an attempted Antigravity tool invocation
  have each failed may the app be called unavailable. When the user explicitly
  named Antigravity, report that exact failure and ask before switching to the
  normal Codex/Sub2API fallback; never silently report a fallback asset as an
  Antigravity result.
- After every raster image generation, optimize the generated file before it is
  retained or packaged. Any generated image shipped in `miniprogram/` must be
  at most 300KB; preserve the asset path and visual composition, reduce colour
  depth and dimensions only as needed, and verify the final encoded size before
  handoff. Do not add a generated asset that exceeds this limit.
- Do not add, generate, or reference WebP assets in the Mini Program runtime.
  Use PNG for transparent or lossless artwork and JPEG for opaque photographs;
  verify the packaged file signature and extension before handoff because WebP
  may fail to render on target devices.
- Use the iPhone 13 Pro `390x844` viewport as the primary visual QA baseline.
  Every Mini Program screen design, generated design reference, and visual QA
  capture must include the native WeChat top-right capsule safe area. Reserve
  that region before positioning title, project identity, save/complete
  actions, or decorative content; do not center a title through the capsule or
  let any interactive element overlap it. For custom navigation, compose the
  title and actions explicitly to the left of the capsule and validate the
  result at the `390x844` baseline.
  Standard fixed-content result/action pages should keep the page heading,
  primary content, key actions, and final CTA visible in one screen including
  the navigation bar and safe area. Lists, dynamic content, accessibility text,
  and smaller viewports may scroll, but critical actions must not be hidden by
  avoidable spacing.
- Fixed-content Mini Program restorations must be content-intrinsic. Do not use
  nested `flex: 1`/`flex-grow`, `height: 100%`, or viewport-derived
  `min-height` to distribute a Hero, illustration, repeated rows, or CTA across
  leftover height. Validate the vertical element ledger from
  `miniprogram/DESIGN.md` at both `390x844` and a user-supplied tall-device
  screenshot; a viewport-growing gap inside one semantic reading group is a
  restoration failure, even when all elements remain visible.
- At the `390x844` baseline, Mini Program typography floors are:
  - Page / nav titles: at least `32rpx` (`nav-title`, page H1).
  - Section titles: at least `28rpx` (card titles, round titles).
  - Primary labels, actions, body copy, business values, and tappable chips: at
    least `24rpx` (about `12px`); key CTAs may use `26–28rpx`.
  - Secondary metadata and helper text: at least `22rpx` (subtitles, prompt
    summaries, time, points copy). Prefer this floor over landing on exactly
    `20rpx` for readable helpers.
  - Tertiary badges only: `20rpx` is allowed solely for non-primary on-image
    badges (for example a “已确认” corner mark) that are not the main reading
    path.
  - Forbidden: any text below `20rpx` that carries an action, status, business
    value, or required explanation. Do not use `transform: scale(...)` or
    image-embedded text to bypass these floors.
- Typography floors are not high-fidelity restoration targets. Normalize the
  approved design and runtime screenshot to the same viewport, then compare
  visible glyph height, hierarchy ratios, wrapping, icon alpha/stroke bounds,
  icon-container size, and optical weight. Do not approve a restoration merely
  because text clears the floor or an `<image>` box has the expected dimensions
  while its visible glyph remains undersized.
- **Known recurring restoration risk — undersized typography and icons.** Before
  implementing any visual restoration, record source-calibrated target sizes for
  the page title, section or benefit labels, helper copy, CTA, icon container,
  and visible icon glyph in the route's element ledger. Bias to the measured
  source scale rather than a smaller "safe" size. Static tests, lack of overlap,
  and compliance with minimum floors cannot close visual QA; the route remains
  pending until the user's manual runtime screenshot confirms the optical scale.
- Use one coherent, locally stored, license-documented icon set for primary
  actions. Do not ship emoji, mixed Unicode symbols, or multi-stroke CSS-drawn
  icons as product icons; CSS is reserved for simple geometry such as status
  dots, chevrons, and separators.
- Where the design calls for a hairline separator, render a short `1px` line and
  use `transform: scaleX(0.5)` or `scaleY(0.5)` on the thickness axis instead of
  a visually heavy full-length border.
- The only formal measurement page is
  `miniprogram/packages/surveying/editor/surveying-editor.*`.
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

- **Manual screenshot QA is the project default.** Do not control, open, reopen,
  replace, compile, navigate, or capture the WeChat DevTools project for Mini
  Program visual QA unless the user explicitly requests DevTools automation in
  that specific task. The user will manually capture runtime screenshots and
  send them to Codex for review. For implementation handoff, complete code,
  asset, documentation, and automated-test checks, then record runtime visual
  QA as pending the user's screenshot. This rule overrides the automatic
  no-automator replacement workflow below unless the user explicitly re-enables
  DevTools automation for the current task.
- Reuse the user's currently open WeChat DevTools project window when that
  exact window already exposes a working `miniprogram-automator` WebSocket
  endpoint. The IDE HTTP service port recorded in `.ide`/`.cli` is not the
  automator port and must not be passed to `automator.connect`.
- Before attaching or replacing a window, resolve and verify the exact open
  project path. It must equal this repository's `miniprogram/` path. If the
  path is ambiguous, multiple windows contain the same project, or a different
  project would be affected, stop and ask the user instead of closing anything.
- If the verified current project window is open normally but has no working
  automator endpoint, Codex is pre-authorized to replace that project window:
  close only the verified old project window through the existing IDE service,
  wait until that project window has closed, then run `cli auto` for the same
  absolute project path with `--auto-port` and `--trust-project`. Prefer fixed
  port `9420` after confirming it is free; if it is occupied by a non-matching
  process, select another free local port and record it in the QA evidence.
  Reuse the existing IDE HTTP service port via `--port`; do not quit or restart
  the whole WeChat DevTools application.
- After the fallback launch, confirm exactly one window is open for the
  project, confirm the selected automator port is listening, connect with
  `miniprogram-automator`, and verify the reported project/page context before
  any interaction. Do not create a temporary project copy.
- Every time Codex controls, opens, or reopens this Mini Program project window,
  including a `cli auto` replacement, trigger one fresh Mini Program compilation
  before the first page-stack check, interaction, or screenshot. Reconnect and
  confirm that the simulator reports a live page at the expected viewport. A
  connected automator whose `systemInfo` or page RPC times out is still frozen;
  that first timeout must never end the visual-QA attempt: invoke an explicit
  Mini Program recompile (not merely a reconnect), wait for compilation to
  finish, then reconnect and retry `systemInfo` plus the target page-stack
  check before deciding whether the runtime remains unavailable. Never treat
  the initial frozen home frame as application behavior or visual-QA evidence.
- Before every Mini Program visual-QA screenshot, identify the intended restored
  page route and inspect the running page stack through the automation runtime.
  Capture only after the top active route exactly matches that target (ignoring
  query parameters and a leading slash) and the simulator has rendered it. A
  launch or home-page frame is never evidence for a different restored page. If
  the route differs, navigate to the target, wait for it to render, and repeat
  the route check before taking the screenshot; record the confirmed route with
  the visual-QA evidence.
- Do not run `cli open`, `cli auto`, or an equivalent command while the old
  verified project window is still open; the fallback above must close that
  project window first so a duplicate is never created.
- Outside the verified no-automator fallback above, never close, restart, or
  replace the user's current WeChat DevTools window without explicit approval.
  A window created by Codex may be closed only after its exact project path has
  been verified.

## Verification

For documentation-only changes, run `git diff --check` and verify referenced
paths, route names, status labels, and English/Chinese parity. For code changes,
run the narrowest relevant tests (`cd miniprogram && npm test`, or the applicable
`admin` lint/build checks) in addition to the document checks.

## Sales Presentation Maintenance

- Treat an explicitly named sales PPTX as the canonical working file. Unless the
  user explicitly requests a new version or backup, edit and overwrite that same
  path instead of creating another suffixed PPTX for each revision.
- Keep temporary builders, renders, audits, generated-image prompts, and QA
  evidence under `tmp/` or `design-references/`; do not place sibling draft PPTX
  files beside the canonical deck.
- Write sales copy from the buyer's business perspective. For renovation-company
  owners, lead with fewer handoff gaps, less re-entry and rework, faster customer
  proposal discussions, clear ownership, and reusable customer/floor-plan/design
  records. Do not make internal terms such as points, frozen balance, task state,
  provider state, or template count the primary sales message; retain them only
  when explaining purchase, operating conditions, or verified product limits.
