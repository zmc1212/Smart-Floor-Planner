# Smart Floor Planner Project Instructions

## Default Local Test Enterprise And Knowledge

- Local development and test journeys default to **微云 (enterprise ID `1454`)**.
- User instruction, 2026-11-07: V1 enterprise knowledge and acceptance use only
  the craftsmanship content of `家客来小K装修服务功能方案.pptx`. Use the verified
  passages in `admin/scripts/fixtures/xiaok-ppt-craft-preview.json` for staff
  draft trials. Discuss budgets and quotes offline. Budget tables, price
  inference and quote scenarios are outside the V1 knowledge and test scope.
- Reuse its retained labelled test accounts/projects; create missing synthetic
  records inside this enterprise through existing services and preserve real
  customer data. Cross-tenant denial checks may use an explicit control tenant.
- Retain the historical source `docs/装修施工标准手册制度规范/精艺.pdf`,
  SHA-256 `efcdc6f1e01ec848d0908e99ddd08929a7f0f07b3942f5b539864361f4aa049b`.
  Its primary documents `376`–`405` and the previously approved customer-scope
  versions `410`/`411` on `404`/`405` are read-only historical controls.
  Keep the isolated full-manual preview corpus out of V1 and retain its receipts
  for audit. The later 2026-11-07 user instruction explicitly permits publishing
  the four labelled PPT craft test documents `2511`–`2514` / versions
  `2756`–`2759` in isolated `xiaok_embedding_eval` (enterprise `1454`) and
  retaining publication after verification. Restore temporary test revocations;
  this exception does not authorize primary/production publication.
- This is development testing, not production seeding or rollout permission;
  original permission/revocation requirements remain in force.

This repository contains the Smart Floor Planner product: a Next.js/Mongoose
administration system and a native WeChat Mini Program for renovation leads,
formal surveying, and AI-assisted design.

## Stage Progression And Automated Testing

- When an authorized test lacks data, create clearly labelled synthetic
  enterprises, users, projects, records and media in the approved development
  or isolated test database, then exercise real writes, reentry and permission
  states. Do not test only an empty page or defer a check for missing data.
  Keep fixture IDs and repeatable commands separate from real customer data;
  this does not authorize production seeding.

- For early XiaoK development, use the PPT scenarios assigned to the current
  stage as the acceptance scope. Once those scenarios and relevant engineering
  checks pass, continue the next authorized stage. Extra long-tail image,
  language, benchmark, or product-comparison evaluations are follow-up work,
  not additional progression gates. Preserve required tenant/permission/data
  integrity checks and record uncovered checks honestly. This does not
  declare the whole PPT implemented or authorize new designs or production.
- Each user-facing stage must include a Mini Program entry, real service writes,
  visible feedback, persisted reentry, permission/error handling, and test steps.
  Backend-only milestones are internal progress, not completed stage deliveries;
  never defer all client integration until the end of the roadmap.
- After completing a stage's implementation, relevant automated checks, and
  documentation, report the executed checks and results, then continue the next
  authorized development stage without waiting for manual tests, screenshots,
  human A10 review, or a confirmation reply.
- The user's standing instruction is to use the verified stable WeChat DevTools
  automation workflow for future Mini Program testing. Do not require fresh
  task-specific automation approval, assign routine manual test checklists, or
  ask the user to capture screenshots for acceptance. Manual review is optional
  when the user chooses or explicitly requests it.
- Report uncovered physical-device, BLE, real WeChat authorization, and other
  simulator limitations as unverified/non-blocking for development; do not
  convert them into required user hand-tests. Historical pending checks remain
  unverified until actual evidence exists. Never treat silence or a basic
  automation smoke test as passed business acceptance or release approval.
- This policy supersedes earlier manual/screenshot requirements and DevTools
  automation prohibitions in these instructions and planning documents.
  Preserve approved designs, tenant/permission/data checks, and deployment
  authorization boundaries. New design directions and production rollout
  still follow their existing authorization requirements.

## Source Of Truth

- Treat the current code, route handlers, schemas, and tests as authoritative.
- XiaoK development has one execution plan:
  `docs/xiaok-renovation-agent-development-plan.md`. Its section 2 is the only
  current delivery record. The former roadmap, Agent/knowledge plans and old
  handoffs are historical references, not task queues or testing gates.
- User scope clarification,2026-11-05: XiaoK V1 includes natural renovation
  dialogue (general knowledge, real web search and authorized enterprise knowledge),
  stage-specific craft reminders, four-role daily/weekly reports compiled from
  authorized progress records and manager/worker photos, nearby approved public
  site live viewing, and public designer/work recommendations by stated style.
  Daily/weekly share one reporting pipeline with different periods. Reuse current
  services and evidence; do not expand into device commerce or a new recommendation
  platform. This replaces the preceding three-feature reduction; follow the plan.
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
- `docs/remote-development.md` and `docs/remote-development.zh-CN.md` are the
  canonical record for approved remote SSH access and deployment boundaries.
  Remote tasks must read this pair first and ask only when the record is
  missing or conflicts with current evidence.
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

## Development Plan Hygiene

- Keep newly created or revised execution plans concise: one current delivery,
  user outcome, bounded acceptance, next action and effective boundaries. Replace
  current values; do not append dated patch, test, owner or handoff histories.
- For XiaoK, keep the canonical plan within160 lines/8000 Unicode characters and
  section2 within2400 characters and its nine defined fields. After editing it,
  run `node scripts/check-xiaok-plan.mjs`; do not silently relax the limits.
- Put raw attempts, hashes, usage and transcripts in their original evidence
  locations. Current bilingual inventories/contracts describe current behavior
  and limitations, with evidence links; do not copy debugging journals into them.
  Preserve failures, unknowns, costs and approvals when compressing records.
- Frozen history is for targeted lookup, never a default full read, second task
  queue or source of renewed permission. Reuse the existing plan and contracts.
  Do not proliferate successor plans or per-patch summary documents.
- Documentation-only edits require document checks, not model calls or product
  reacceptance. They neither change the development owner nor reopen stopped
  batches, expand scope/costs, or authorize designs/publication/deployment.

## Development Context And User Direction

- User instruction, 2026-11-05: automatic context-capacity chat creation and
  handoff are revoked. Continue in the current chat by default, including after
  automatic compaction. Do not create, fork or transfer to a successor chat
  unless the user explicitly requests that action. Earlier standing handoff
  authorization and historical handoff notes no longer authorize a new chat.
- Keep a concise checkpoint in the existing plan when needed: current user
  decisions, source/workspace state, valid evidence, failures, unknown calls,
  resources and the exact next action. A checkpoint is not a new plan, another
  development stage or a reason to restart tests. Do not invent context limits.
- After compaction or a user-requested new chat, read the latest user direction
  before following a recorded next action. Correct a stale next action when it
  conflicts with that direction; tactical debugging notes are not the goal.
- XiaoK's current method constraint is: model understands and explains,
  KnowledgeRetriever/Evidence supplies authorized enterprise material, and code
  controls permissions, current sources, business actions and truthful receipts.
  Prove accurate, natural answers on a small fixed set of real conversations
  before expanding engineering regression. Necessary fast checks remain valid.
- Do not default to new prompt clauses, keyword/regex rules, scheduler branches,
  validators or larger test matrices for an ordinary answer-quality failure.
  First show the concrete input/output and why the proposed rule is necessary
  for an actual permission/fact/action boundary rather than a model-expression
  task. Reuse existing framework/service capabilities and remove interference.
- Two failed repair iterations for the same business expectation stop that
  patch loop across compactions and chats. Retain original failures and examine
  the shared mechanism; do not reset the count, rename the case, resample until
  green or call internal test counts proof of user-facing quality.
- Keep this method constraint in the sole plan's current record. Its checker
  verifies that the constraint and no-automatic-handoff rule remain present;
  passing that document check does not prove compliance or answer quality.

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

## Design Coverage And Canvas Discipline

- **Complete state handling does not require a separate full-screen design for
  every state.** Use three levels: main-screen designs for layout, typography,
  spacing and visual language; key variants only when layout or available
  actions materially change (such as human takeover or an editing sheet); and
  shared component/state specifications for ordinary loading, sending,
  failure, retry, empty states and copy variations.
- Reuse the same approved component for the same interaction. A different
  conversation topic, such as quotation versus schedule, is normally a copy
  variant, not a new page, role, workflow or approval gate.
- Do not make drawing every state or obtaining approval for every specimen a
  prerequisite for development. Once the main designs, material variants and
  reusable state rules are sufficiently defined and the user has explicitly
  authorized implementation, proceed. Additional state images are supporting
  examples, not separate implementation requirements.
- Preserve functional completeness in a concise state table: trigger, visible
  feedback, enabled actions, recovery/reentry and permission boundary. Shared
  approved components plus their documented state rules count as a design
  source under the UI Design Source Check; a missing standalone raster for an
  ordinary state alone is not a blocker. Ask only when a genuinely new or
  conflicting visual/interaction decision remains unresolved.
- Before extending an existing PPT, screenshot or approved design, inspect its
  original single-screen dimensions and logical viewport mapping. Keep that
  canvas, aspect ratio, source-calibrated glyph/icon sizes, spacing and safe
  areas consistent across related screens. For the current XiaoK PPT sources,
  the single-screen canvas is 853x1844, mapped by width to the 390x844 Mini
  Program baseline; the sub-pixel height rounding is not a layout change.
- Multi-screen boards are presentation overviews only. Do not infer element
  dimensions from differently scaled board panels or use them as the sole
  implementation ruler. Retain correctly proportioned standalone main designs
  and the common measurements. Do not stretch an image or shrink text to force
  all content into one screen; reflow content or allow appropriate scrolling.
- Check canvas and containers first, then visible typography and wrapping,
  spacing, and artwork. Equal exported image dimensions alone do not establish
  visual consistency. Keep design review distinct from runtime/native QA.
- These rules apply to future design tasks and do not relax explicit design
  approval, product implementation authorization, or production deployment
  boundaries. Prefer updating existing design specifications over proliferating
  parallel documents and state-image checklists.

## Preferred Skill For UI Restoration

- Use `draw-ui` as the first-choice skill for restoring approved interfaces
  from PPTs, design images or screenshots, and for visual calibration of
  existing Mini Program and Admin pages. Read its `SKILL.md`,
  `references/calibration.md`, and the applicable implementation reference
  before starting restoration work. Follow an explicit user choice of another
  skill when provided.
- Keep the approved design as the baseline. Apply draw-ui's measurement order:
  viewport and containers, typography and wrapping, spacing, then artwork.
  Distinguish visible glyph/stroke/alpha bounds from element or image boxes;
  calibrate font hierarchy, icon optical size and illustration proportions,
  rather than treating minimum font sizes or absence of overlap as fidelity.
- Reuse the existing route element ledger and documentation for measurements
  and verification; keep temporary calibration artifacts under `tmp/` or
  `design-references/`. Do not create a parallel design authority.
- This preference does not override project design approval, asset/no-slicing,
  native-capsule, automated-QA or deployment rules. Browser fixtures are
  supplemental diagnostics, not native Mini Program acceptance. Use the
  authorized stable DevTools workflow for native QA; do not introduce an
  HTML-first implementation gate through the skill.

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

- All future user-facing Agent tests must use natural language and realistic
  conversation conditions. Users state their needs; they do not name tools,
  prescribe internal steps, supply expected answers, or repeat safety rules to
  make the Agent pass. Include incomplete information, gradual clarification,
  corrections, reentry and actual service failures. Keep expected actions and
  assertions outside user messages. Preserve low-level permission, protocol and
  accounting checks as engineering evidence, not proof of a successful real-user
  journey. Historical explicit-instruction trials remain historical evidence.

### Agent Development: Reference Existing Implementations

- Before extending or restructuring the XiaoK Agent, inspect relevant maintained
  open-source Agent implementations, their tests and known provider issues.
  Prefer existing framework capabilities and established message/tool protocols
  over duplicating orchestration, multimodal handling or recovery machinery.
- Compare the actual implementation with this project's tenant permissions,
  source revocation, durable jobs, usage accounting and human handoff contract.
  Preserve those boundaries when reusing or replacing components. A framework
  migration or full rewrite needs a concrete advantage over a focused change.
- Record relevant source links and adoption decisions in the existing bilingual
  Agent contract when architecture changes. Distinguish provider-specific
  workarounds from general practices; validate both with end-to-end regression
  tests for the configured model, rather than inferring quality from examples.

### Unified Agent And Knowledge Development And Automated Acceptance

- The one active chat designated by the user owns the XiaoK renovation Agent
  plan, including Agent and knowledge work, integration, fixes and acceptance.
  Complete implementation, relevant tests, fixes, documentation and the local
  stage commit in one continuous flow, then continue the next authorized stage.
  Older chats do not resume competing work on a historical freeze-release or
  resource-handoff message.
- Routine work uses this single owner and the existing authorized development
  environment. Do not create a separate development/testing chat, request a
  user-approved workspace freeze, or require cross-chat lock handoffs as a
  progression gate. This rule supersedes earlier routine freeze/coordination
  requirements in planning documents; historical evidence remains intact.
  Only a user-requested successor may replace this owner sequentially; context
  capacity alone never authorizes another development or testing chat.
- Keep responsibilities separate within that one plan and owner. The Agent
  domain owns runtime, memory, tool orchestration, current-project composition,
  model citation catalogs, final response validation and recovery. The
  knowledge domain owns file parsing/chunking, indexing/retrieval,
  publication, version/epoch/audience checks, original locators and knowledge
  operations/UI. Retain `KnowledgeRetriever` / `Evidence`; do not add another
  Agent, facts store, permission resolver or citation pipeline. Classify a
  cross-domain defect using its concrete failing input/output, implement it
  in its owning domain, then run combined regression. The same owner handles
  legacy mixed files such as `knowledge/sources.ts` and `knowledge/batches.ts`;
  directory location alone does not assign every responsibility.
- Integrate one feature change at a time, preserve unrelated dirty changes,
  and rerun affected compatibility, tenant and revocation checks on the combined
  result. Bind evidence to the actual source/test/configuration version before
  and after execution. Source drift invalidates that batch even if assertions
  pass; retain it separately and rerun the affected checks on a stable version.
  Preserve original failures, provider attempts, unknown outcomes and usage;
  do not pool different versions or repaired responses into first-draft results.
- Run Stable DevTools native acceptance serially with one controller in the
  same workflow. Retain the existing acceptance lock, idle-queue guard and
  verified window discipline. Acquire and release owned resources
  programmatically in cleanup/finally paths. If a resource is busy, wait or do
  independent offline work; do not seize another task's process or turn routine
  contention into a user freeze/coordination approval request. These are resource
  safeguards, not a requirement to stop all development or create a new chat.
- If the user explicitly requests independent or parallel work, test a fixed
  commit or a fully recorded source snapshot in a separate managed worktree.
  Each concurrent service test needs its own test database, ports, Worker,
  configuration, media/fixtures, outputs and provider-attempt records; a
  worktree alone does not isolate shared resources. Until that isolation is
  ready, the unified owner runs the work serially; building a CI/container
  platform is not a prerequisite. Native tests still use one verified project
  window/controller and never a temporary project copy.
- Inspect attached worktrees before creating another; use `codex/` branches
  from the required integration baseline. Worktrees do not copy uncommitted
  changes. Do not silently omit required local dependencies, discard dirty
  changes or commit unrelated work just to prepare a worktree. Independent
  chats must not write the same Agent checkout/shared files concurrently.
  Cross-chat messaging still requires direct human authorization; routine
  progress must not depend on sending such messages.
- User-facing stage acceptance still requires the real client/service writes,
  feedback, reentry, permissions and failure/recovery checks defined above.
  Pending, skipped and failed tests remain explicit. Tenant/source revocation,
  durable-job/accounting boundaries, approved designs and production-deployment
  authorization remain in force.

### XiaoK Delivery Execution

- A request to continue XiaoK resumes section 2 of
  `docs/xiaok-renovation-agent-development-plan.md`, the sole execution plan
  established on 2026-10-27. Read that record, the affected module inventory
  and only the relevant code/contract/evidence. Do not resume the former
  roadmap, Agent/knowledge queues, historical handoff instructions or full-suite
  testing manuals. Preserve implementation facts, original failures, costs,
  approved designs and deployment boundaries. New human instructions prevail.
- Before implementation or testing, state the user action, verified gap,
  completion checks and next delivery. Keep one current record: delivery ID,
  user outcome/entry, reused foundation, actual status, bounded acceptance,
  blockers with affected scope, evidence and next ID. Replace this record on
  completion; do not append a new product stage for every patch.
- If the current delivery is already evidenced complete, reuse it and advance.
  If incomplete, implement the missing behavior before starting broad tests.
  A passing error guard, commit, test count or repair checkpoint does not
  complete the normal user journey.
- Select tests from the current delivery's actual dependencies: affected fast
  unit/client checks during edits, real services and affected compatibility
  after integration, then required Stable native acceptance. New or materially
  changed semantic core cases need at least two configured-model trials;
  fix the trial scope before execution and retain every first-draft failure;
  do not keep sampling until two passing outputs appear. Deterministic changes
  do not require unrelated model calls. Preserve client
  entry, real writes/readback, feedback, reentry, tenant/permission/source
  revocation, idempotency, truthful receipts and failure recovery.
- Before a repeat run, name the changed behavior, prior failure or unresolved
  risk it will verify. Reuse valid evidence for unchanged scope/configuration;
  neither a new chat, a documentation-only edit nor an internal version number
  requires a new full suite. Bind dependencies, tests, drivers and configuration
  before/after each run; drift within that scope invalidates it. An unrelated
  change requires a recorded impact check, not automatic whole-product replay.
  Never shrink a binding retroactively to make a failed/drifted batch pass.
- After two repair iterations fail the same business expectation, stop that
  patch/retest loop before a third. Record expected versus actual I/O, original
  attempts, owning domain, a shared-cause hypothesis and a discriminating check
  in the existing phase-two contract. Reuse saved traces first; new calls must
  distinguish hypotheses. Another wording/regex/prompt variant is insufficient.
  The count persists across chats, renamed cases and internal version changes.
- A new mechanism-level change may reopen affected acceptance. Otherwise retain
  the failure and move serially to the named independent authorized delivery,
  recording why it does not depend on the defect. Safety/receipt/revocation
  defects still block every affected path. Never weaken guards, drop original
  required cases or call an incomplete feature complete to advance. If all
  remaining deliveries share a proven blocker, report that concrete blocker
  and the decision needed, rather than running an unbounded matrix.
- Knowledge owns parsing/retrieval/publication/Evidence defects; Agent owns
  consumption, orchestration and final-answer defects when Evidence is correct.
  A knowledge "no change required" dependency is valid progress accounting.
  Do not rebuild or retest ingestion because an Agent answer failed; record
  the domain dependency in the single current delivery, without another plan.
- Finish a delivery with scoped evidence, bilingual contracts/inventories and
  the related local commit, then advance to its named successor without routine
  confirmation. Report the newly usable action, limits and successor first.
  Internal commits remain internal; record their real hashes in the next
  necessary documentation update, not a mandatory commit-only/hash-only loop.
- Carry delivery ID, remaining checks, failure-iteration count, evidence reuse
  and next ID through a user-requested sequential owner handoff; preserve ownership,
  resource locks, unknown outcomes/costs, approved designs and deployment limits.
  These rules replace earlier routine all-stage test or independent-test-chat
  instructions. They do not authorize new designs, paid fallback or production.

### Git

Use a Conventional Commit English subject: `feat:`, `fix:`, `refactor:`,
`docs:`, `chore:`, or `test:`. Keep it concise and limited to the related
staged change; split unrelated work.

### Repository Hygiene

- `admin/.next` is regenerable, Git-ignored build output and must stay bounded.
  `admin/scripts/prune-next-cache.mjs` is the only supported cleanup path:
  every `dev`, `dev:webpack`, `dev:turbo`, and `build` script runs it through
  its pre-hook, and it removes a cache only when it exceeds
  `NEXT_DEV_CACHE_MAX_GB` (default 8GB, Turbopack dev) or
  `NEXT_WEBPACK_MAX_GB` (default 6GB, webpack), or when run
  explicitly as `npm run cache:prune`. Use `npm run cache:check` for a dry run.
  Do not delete `.next` on every run or remove individual `.sst` cache segments;
  keeping warm caches under these limits is what preserves local start speed.
- `design-references/` is a git-ignored, recyclable working area. The durable
  set is the files referenced from repository documents (restoration ledger,
  icon-source license notes, module docs, brand guidelines, source comments);
  `scripts/cleanup-design-references.mjs` rebuilds that protection list on
  every run. A directory-level reference in a doc protects the whole subtree,
  so keep index-style directory pointers intentional.
- After a design milestone, or at least monthly, run
  `node scripts/cleanup-design-references.mjs` (dry run), then `--apply` to
  move unreferenced files older than 30 days into `design-references/.recycle/`.
  Review the batch, then reclaim the space with `--purge`; `--restore <batch>`
  recovers a batch.
- Runtime AI-generated images never go into `design-references/`. They belong
  to admin media storage (`uploads/ai-assets`) and follow its soft-delete and
  purge pipeline (`admin/scripts/media-purge.mjs`).

### Admin UI And Feedback

- **Administrator inheritance:** `admin` and `super_admin` inherit every
  enterprise-owner (`enterprise_admin`) business-management permission. Do not
  restrict an owner action to `role === 'enterprise_admin'`; use the shared
  `isEnterpriseManagementRole` policy for role checks and test all three roles.
  Platform administrators act within the explicitly selected enterprise; tenant,
  source/participant, consent, lifecycle and sensitive-password checks still apply.
  Do not require a platform administrator to become an enterprise employee or
  project member to exercise owner management permissions.
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

### XiaoK Construction Chat And PPT Fidelity

- For S04, use the original XiaoK construction-chat screen on PPT pages 22
  and 38 as the visual and interaction baseline. Original messages/photos,
  XiaoK's draft, review/edit/publish actions and the composer belong to the
  same conversation. Do not turn this into a standalone record form, dashboard
  or a newly styled chat without the user's explicit request.
- Preserve the source's canvas, hierarchy, typography, spacing, soft background,
  XiaoK artwork, photo layout and chat-card proportions. Add project identity,
  actual data and required states through that design's existing components.
  Functional completeness is not permission to replace the PPT with generic
  cards, heavier typography or extra explanatory UI. Earlier unaccepted S04
  redraws are not design sources; V4 is supplemental and cannot override the PPT.
- Each enterprise-scoped construction project has one independent shared XiaoK
  conversation. Effective project members, including the construction manager,
  workers and assigned designers, see the same messages, original attachments,
  unpublished drafts and record versions. Do not create separate employee
  conversations or copies of the same project record.
- Keep different projects and the homeowner's private consultation separate.
  Homeowners receive only records/materials explicitly published to their
  authorized scope, not access to the internal project conversation. Shared
  visibility does not grant everyone edit/publish rights: preserve author and
  manager action boundaries, version/conflict checks and audit provenance.
  Membership removal must revoke reads, media access, writes and later delivery.
- These are the user-confirmed design/target-contract rules, not proof that P4A
  is implemented or approved for deployment. Keep D4 in the sole XiaoK plan
  and the existing design specification aligned; runtime inventories change
  only with implementation.

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
  `miniprogram/DESIGN.md` at both `390x844` and a tall-device simulator viewport;
  reuse user-supplied tall-device screenshots when available. A viewport-growing
  gap inside one semantic reading group is a
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
  and compliance with minimum floors cannot close visual QA; confirm the optical
  scale against the approved source using route-verified native DevTools
  captures, including the host layer when applicable. User screenshots are
  optional supporting evidence, not an acceptance gate.
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

- **Stable DevTools automation is the project default.** The user has given
  standing authorization for future Mini Program testing through this workflow;
  no repeated task-specific approval or routine human hand-test is required.
  The verified installation is Stable `2.02.2608080` at
  `D:\微信开发工具\微信web开发者工具`, using official
  `miniprogram-automator@0.13.0`, base library `3.17.2`, and logical viewport
  `390x844`. Nightly `2.01.2512292` repeatedly timed out on `page.data()` and
  `page.$$()`; do not switch back to it for tests. Revalidate equivalent
  capabilities before adopting a different tool version.
- Verify SDK connection, live `systemInfo`, nonempty `page.data()`, positive
  element queries, real element taps/inputs, navigation, and screenshots as
  relevant to each changed flow. Wait for asynchronous route/data updates;
  restore temporary inputs/state. These checks are a baseline, not proof that
  every business flow passed: also exercise the affected service writes,
  persisted reentry, permissions, and failure/recovery paths with test data.
  Record logical viewport and encoded screenshot dimensions separately because
  simulator display scaling may produce a smaller PNG.
- Keep the Mini Program
  verification window on the secondary monitor. Confirm its placement before
  visual interactions; do not cover the primary monitor or repeatedly steal
  focus. Prefer the automation endpoint for compilation, navigation and page
  inspection. If window placement cannot be verified, pause window interaction
  and continue independent backend checks until the user confirms placement.
  DevTools simulator evidence does not establish physical-device or real
  WeChat-login acceptance; record those separately.
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

## FastGPT 隔离开发实例凭据（开发用，勿提交明文）

- 小K Agent V2 使用的 FastGPT 隔离开发实例（`http://127.0.0.1:18300`，企业 1454）
  管理账号为 `root`。口令由用户在 2026-11-10 口头提供，明文保存在已被
  `.gitignore` 排除的 `tmp/fastgpt-admin.private.json`，请从该文件读取，不要写进
  受版本管理的文档或提交记录。
- 刷新会话：先 `GET /api/support/user/account/preLogin?username=root` 取 `code`，
  再 `POST /api/support/user/account/loginByPassword`，`password` 传
  `sha256(明文)`，从响应 `Set-Cookie` 取 `fastgpt_token` 写回
  `tmp/xiaok-fastgpt-rag-session-20261107/runtime.private.json` 的
  `managementCookie`；之后才能运行 `admin/scripts/fastgpt/agent-v2-provision.mts --apply`
  更新并发布 Agent V2 工具集。
- 口令仅限本地开发环境使用；生产部署、跨环境复用或对外共享仍需用户明确授权。
