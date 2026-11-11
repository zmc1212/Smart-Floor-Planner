# Native Workflow (B0-B4)

Pure workflow core, a B-owned draft/publish store and a server-only B4 adapter
for 家客来 native business orchestration. B0-B2 defines, validates, compiles and
simulates workflows; B3 adds drafts, immutable published versions and a
simulation debugging surface; B4 connects one published stage-reminder flow to
the existing construction authorization, outbox save and in-app delivery
services. The pure core still does not connect a model, database, queue,
scheduler, Worker, business write path or message channel; only the separate
`live/` adapter does, under host identity.

Owner: B line (`codex/xiaok-native-workflow`). Shared migrations, dependencies,
menus, the sole XiaoK plan and the bilingual module inventories' integration
wiring remain owned by the integration lead.

## Boundary

- The pure core imports only Node built-ins and local files in this directory.
- Importing the module never starts jobs, timers, workers or network calls.
- B3 storage is a B-owned file store under `admin/tmp/native-workflow-store`
  (override with `NATIVE_WORKFLOW_STORE_DIR`); it is not a shared migration.
- Never reads production keys, customer data or real receipts.
- Simulated saves/deliveries are proposals with `simulated: true`; they must
  never be presented as generated, saved or sent to a customer.
- The B4 `live/` adapter executes `PendingOperation` descriptions against the
  existing construction services. It is server-only and never imported by the
  pure core. It has no model or embedding client; enterprise knowledge is
  explicitly off in this round.

## Public API (`index.ts`)

| Function | Contract |
| --- | --- |
| `validateDefinition(raw)` | Structure, capability whitelist, references, dominance, type compatibility, edge legality, cycle/bounds and import safety. |
| `compileDefinition(raw)` | Validates, then returns an immutable plan with digest, node versions, outgoing edges, topological order and bounds. |
| `advance(plan, state, event)` | Pure transition. Accepts `start` or `observation`; returns a new state, trace entries and pending operation descriptions only. Version-bound to the plan digest. |
| `simulate({ definition, scenario, fixtures })` | Drives `advance` with fixture observations. Deterministic for the same definition/scenario/fixtures. |
| `parseDefinitionJson` / `exportDefinitionJson` | Canonical import/export with one shared size rule, forbidden-content and schema checks. |
| `createStageReminderDefinition` / `createPeriodReportDefinition(kind)` | The two templates. |

B3 exports:

| Module | Contract |
| --- | --- |
| `createWorkflowService({ store, now? })` | Template drafts, optimistic draft saves, validate/compile publishing, fixed-revision simulation and fixture compatibility. |
| `createFileWorkflowStore({ rootDir })` / `createMemoryWorkflowStore()` | Store interface implementations with atomic draft conflicts and append-only versions. |
| `fixtureSets` / `fixtureSetSummaries` | Built-in normal and failure fixtures for both templates. |

Supporting exports: `definitionDigest`, `capabilityCatalog`, `getCapability`,
`createRunState`, `WORKFLOW_BOUNDS`.

## Definition contract

- Root: `schemaVersion` (1), `definitionId`, `revision`, `entryNodeId`,
  `inputSchema`, `nodes`, `edges`.
- Node: `nodeId`, `type`, `typeVersion` (1), `capabilityRef`, `config`, `inputs`.
  Inputs are references `{ nodeId, outputPath }`; there are no literal inputs.
- Edge: `{ from, to, when? }`. `when` is only valid on `condition` edges and is
  unique per branch. Non-condition nodes have at most one outgoing edge.
- Bounds: 32 nodes, 64 edges, 16 input mappings per node, 64 KB canonical
  definition JSON (one rule shared by import and export), 512 KB raw import
  text, scan depth 32, 10,000 scanned values, 64 execution steps.
- Entry must be the only trigger, have one unconditional outgoing edge and no
  incoming edge. All nodes must be reachable. `save_result`/`deliver_inapp`
  nodes may be terminal; every save needs a path to a delivery node. Cycles,
  duplicate nodes/edges, unknown nodes/capabilities, missing outputs, type
  mismatches and forward references are rejected.
- Input references reject self-references and non-mandatory sources. A source
  must dominate the consumer (every path from the entry passes through it).
  Common pre-branch sources are allowed; a source available on only one branch
  after a merge is rejected with `input_not_mandatory`.
- Capability names, input ports, output ports, required inputs and template
  placeholders use own-property whitelists. Inherited names such as
  `constructor` or `toString` are never treated as contract entries.
- Imported JSON may not contain URLs, SQL, code/`require`/`import()`, secrets,
  file paths, `${...}` expressions or unknown transport fields. The safety scan
  is depth- and size-bounded and reports `scan_depth_exceeded`,
  `scan_nodes_exceeded` or `cyclic_structure` instead of overflowing the stack.

## Six controlled node types

| Type | Capability refs | Effect |
| --- | --- | --- |
| `trigger` | `trigger.stage_changed`, `trigger.period_report` | none (event payload) |
| `read_materials` | `read.project_context`, `read.enterprise_craft`, `read.period_records`, `read.authorized_photos`, `read.receiver_scope` | host read |
| `condition` | `condition.compare_boolean`, `condition.compare_number`, `condition.compare_text` | none |
| `compose_content` | `compose.stage_reminder_deterministic` (no model), `compose.stage_reminder_model`, `compose.period_report` | none / model compose |
| `save_result` | `save.stage_reminder`, `save.period_report` | host save |
| `deliver_inapp` | `deliver.inapp` | host in-app outbox |

Identity (enterprise, user, project, lease, permission) is supplied by the host.
Graph definitions cannot override it. There is no external WeChat/SMS/email
capability. A graph can never assert engineering acceptance.

## State and advance

`createRunState(plan, { runId, mode })` creates `running`, and `advance`:

1. Before handling any event, the state's `definitionId`, `revision` and
   `digest` must match the compiled plan. Cross-version continuation throws
   `run_definition_mismatch`; a published revision is never silently reused.
2. `start` validates the trigger event against `inputSchema`, records the event
   ID, stores trigger outputs and pumps deterministic nodes until a host effect
   or a terminal state.
3. `observation` matches the pending node, validates all declared output ports
   and their types, stores only declared outputs, then pumps.
4. `pending` contains at most one descriptive operation (`nodeVersion`,
   resolved input, `simulation` marker, idempotency key). No effect is executed.
5. Observation outputs, run state and pending inputs are deep-copied at their
   boundaries; later edits to caller-owned JSON cannot mutate earlier snapshots.
   Observation values must be finite JSON (no cycles, `Date`, functions or
   non-finite numbers); violations fail with `invalid_observation` before any
   deep clone runs.
6. Save/delivery observations must confirm `saved`/`delivered` is `true` and
   carry a receipt with a `receiptId`; simulation receipts must also be marked
   `simulated: true`. `saved: false`, `delivered: false`, a missing/invalid
   receipt or an unmarked simulation receipt fails the run with
   `save_not_confirmed`, `delivery_not_confirmed`, `invalid_receipt` or
   `receipt_not_simulated` and never completes it.
7. Failures become `failed` with the original error; unmatched condition
   branches become `halted`; a validated terminal save/delivery becomes
   `completed`.

Duplicate event IDs are ignored before any operation is produced. Terminal runs
reject new events except a duplicate of the processed event.

## Simulation

```ts
simulate({
  definition,
  scenario: { runIdPrefix, clock: { startedAt, stepMs }, events },
  fixtures: { nodes: { [nodeId]: { status: 'ok', outputs } | { status: 'failed', error } } },
});
```

- Time, event IDs and generation results are explicit inputs; the core never
  reads `Date.now()` or generates IDs.
- Duplicate events across the scenario are reported in `duplicateEventIds` and
  produce no second run.
- Failures are injected per node and surfaced with their own codes. A missing
  fixture fails with `fixture_missing`.
- Save/delivery fixtures follow the same core semantics: false confirmations
  fail with `save_not_confirmed`/`delivery_not_confirmed`, invalid receipts fail
  with `invalid_receipt`, and a fixture claiming a real receipt fails with
  `receipt_not_simulated`. Valid receipts are stamped with `simulated: true`.
- Every trace entry is marked `mode: 'simulation'`.
- `dailyReportFixtures` keeps daily records inside the daily period and uses a
  daily title; weekly fixtures keep raw records inside the weekly period.

## Templates

1. `stage-reminder`: stage trigger → project context → known-stage gate →
   subscription gate → authorized craft read → knowledge switch → model or
   deterministic compose → save reminder → in-app delivery. Unknown stages halt;
   knowledge off keeps the zero-model deterministic branch; duplicate stage
   events are ignored.
2. `period-report-daily` / `period-report-weekly`: one shared `period` contract;
   raw period records and authorized photos are read directly. Weekly never
   consumes model-written dailies as source facts. Missing records/photos are
   expressed by compose output; zero receivers saves the report but stops
   before delivery.

## B3 drafts, published versions and debugging

- `createWorkflowService` creates drafts from `stage-reminder`,
  `period-report-daily` and `period-report-weekly`.
- Draft saves require `expectedDraftRevision`; stale writes return
  `draft_conflict` (HTTP 409) with `currentDraftRevision`. Saves run
  `validateDefinition` and force the route `definitionId` plus the next
  `revision`.
- The editor binds its text to `editingBaseRevision`. A 409 keeps the local
  text and original base; it never silently rebases old text onto the remote
  revision. The UI offers explicit "load latest" and "keep local content"
  actions, and a save response only replaces the editor when its text has not
  changed during the request.
- Publishing re-runs `validateDefinition` and `compileDefinition`, then stores
  an append-only version with digest, normalized definition, node versions and
  timestamp. Re-publishing unchanged content returns the existing version;
  editing the draft is required before a new version is created.
- Published versions are read-only. A simulation can run the current draft or a
  fixed published revision, so later edits never change an older trace.
  Fixtures are filtered from the resolved source/revision definition schema,
  including the history "simulate this version" action.
- Storage defaults to a B-owned file store (`admin/tmp/native-workflow-store`,
  override `NATIVE_WORKFLOW_STORE_DIR`). Writes use a unique same-directory
  temporary file, a complete write, then an atomic rename; failures keep the old
  file, remove the temp file and preserve the existing per-file serial lock. The
  store interface allows a Postgres adapter later; the file adapter assumes a
  single admin process. No shared migration is added here.
- Admin surface: `/native-workflow` (list/create) and
  `/native-workflow/[definitionId]` (draft JSON, versions, simulation trace).
  The page and `/api/native-workflow/**` require platform `super_admin`/`admin`.
  Menus are not modified in this round.
- Fixtures cover normal, knowledge-off, duplicate-event, read-denied,
  compose/save/delivery failures, material withdrawal and no-receiver cases.
- No drag canvas is added: no confirmed canvas design was found, so this round
  ships the main page, key states, structured definition editing and traces.

## B4 live stage-reminder adapter

`live/` is a server-only adapter; the pure core and `simulate` are unchanged.
It executes one published `stage-reminder` revision for one fixed server-side
business event and never selects a definition from a draft.

The deterministic compose keeps its single `{{stageLabel}}` placeholder, but its
input is now wired to the host `reminderText`, so the emitted body is the
authoritative business-event text rather than a fixed label.

- B isolation is explicit: `B4_LIVE_APP_DATABASE_URL` and
  `B4_LIVE_FIXTURE_DATABASE_URL` are required and validated against the exact
  host (`127.0.0.1`/`localhost`), port `55433`, database
  `smart_floor_planner` and role (`sfp_app`/`sfp_owner`). Query strings and
  fragments are rejected outright, so `?host=`, `?port=`, `?user=` and
  duplicate/encoded parameters cannot override the verified target. There is
  no `DATABASE_URL` fallback or default. After connecting, the live entry and
  fixture compare `current_database()`/`current_user` with the verified
  target. The fixture performs a read-only ownership preflight before any
  write; the integration suite uses the same resolver and marker-based
  ownership preflight, and its `after` hook deletes nothing when the preflight
  failed.
- `live/runner.ts` fixes `definitionId`, `revision`, `digest`, `nodeVersions`,
  the trigger event and the business event before the first effect. Later
  draft edits or publishes cannot change the compiled plan. `runId` uses
  exclusive `create`/`update`: an existing runId returns its original record or
  rejects a different enterprise/project/event/revision; unknown and failure
  evidence is preserved and never re-executed automatically.
- `live/business-event.ts` fixes a stable cross-run anchor. The outbox payload
  stores `sourceEventKey` (the trigger event id); resolution looks up that key
  before the project's current progress revision. The same event with a new
  runId, a new published revision, or a note-only progress change therefore
  reuses the original outbox/progressRevision/settingsVersion. Events created
  before B4.2 are backfilled with the key when reused. An invalidated event
  stops with `stage_event_invalidated`; it is never silently reinterpreted as
  the current revision. `--outbox-event-id` remains an explicit override but
  cannot override an existing key binding to another outbox event.
- `save.stage_reminder` performs the single binding point after the project
  write lock: it queries `payload->>'sourceEventKey'` before any reuse,
  backfill or insert. A matching outbox/revision/stage is reused; an
  inconsistent binding is rejected with `stage_event_conflict`. This also
  covers two default entries that resolve an older event before either saves;
  the second save cannot create another outbox for the same key.
- `live/construction-ports.ts` maps each `PendingOperation` to existing
  services. Enterprise, admin, project and customer identity come from the
  host; a definition cannot override them.
  - `read.project_context`: `constructionAccess`, the project row, stage
    settings and the open `customer_consultation` conversation. Any active
    member may read; the event stage must equal the project's current stage.
  - `read.enterprise_craft`: deterministic `craftEnabled: false`; no knowledge
    retrieval, model or embedding call exists in this branch.
  - `save.stage_reminder`: requires the owner or an active manager
    (re-checked under the project lock), then reuses or creates the fixed
    `domain_event_outbox` event. A worker/observer, or a manager demoted after
    read, is rejected.
  - `deliver.inapp`: requires the owner or an active manager again, then calls
    the scoped `deliverStageReminderToConversation` for exactly one
    project/event/conversation. The aggregate `syncConstructionReminders`
    entry keeps its original responsibility for other callers. Delivery
    re-checks assistant enabled, the event settingsVersion against the current
    stage settings, project/customer access, current event/stage and the
    conversation before writing; failures keep the saved outbox and add no
    delivery/message. An already delivered stage notice does not resend the
    stage message, but still backfills `appendStageFollowUp` and
    `construction_links` under their independent idempotency. When the notice
    lives in an older conversation, the receipt reports the real message
    conversation and its active participant, plus `requestedConversationId`
    and `reusedConversation`; if that evidence cannot be confirmed, delivery
    returns an unconfirmed status instead of claiming the requested
    conversation.
- Receipts are validated before the operation outcome is written:
  `saved:false`, `delivered:false` or an invalid receipt marks that operation
  `failed` while preserving its outputs and error. Live mode requires
  `simulated:false`; simulation mode requires `simulated:true`; a simulated
  receipt in live mode fails with `receipt_simulated_in_live`.
- Re-running the same business event reuses the same outbox and delivery
  receipts; reminder, delivery and message counts do not increase.

Development evidence (B-isolated PostgreSQL 17 + pgvector on
`127.0.0.1:55433`, enterprise 1454 labelled fixture; no A-line
database/config is read):

```powershell
$env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
$env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
npx tsx scripts/native-workflow-live-fixture.ts --development
npx tsx scripts/native-workflow-live.ts --development --ensure-published `
  --admin-id 1454000001 --project-id 1454000004 `
  --event-id b4-stage-20261111-0001 --stage-key plumbing --stage-label 水路 `
  --run-id b4-1-normal-001
npx tsx scripts/native-workflow-live.ts --show-run b4-1-normal-001
```

The dev entry refuses `NODE_ENV=production` and missing/wrong B targets before
connecting. It supports `--close-conversation-after-save` and
`--disable-admin-after-read` only for controlled delivery/save failures; both
restore the fixture state. The fixture seeds owner/manager/worker/observer test
accounts.

Recorded B4.3 evidence: the explicit outbox override cannot rebind an existing
key (`event1=126` stayed the only binding after an `event2=127` request was
rejected with `stage_event_conflict`). In the interleaved note-only case the
second save was rejected and the project kept exactly one outbox for that key.
The cross-conversation receipt test delivered in generic conversation C1
(`1454900001`, message `78`), later requested C2 (`1454900053`), and returned
the real C1 message/conversation and customer `1454000002` with
`requestedConversationId=C2` and `reusedConversation=true`, without a second
stage message. The shared fixture preflight verifies enterprise code/name,
all four `b4-live-*` admin usernames, the customer username, the main project
name and conversation title before any reset/write; dedicated rows are cleaned
only after marker ownership, and a failed preflight performs zero deletes.

Checks: the original 77 non-database tests are retained and pass; the current
native-workflow non-database suite is 96 tests (90 existing plus 6 new
acceptance-store/acceptance-conversation tests), the shared construction suite
is 89 tests, the real-adapter suite is 14 tests, and the offline entry guards
are 6 tests. `live-integration.test.ts` no longer sets the opt-in itself:
missing `B4_LIVE_DEVELOPMENT`, `B4_LIVE_DEVELOPMENT=0` and
`NODE_ENV=production` all reject before any connection. Scoped ESLint passes;
the repository still has its pre-existing full-lint/type/build failures outside
this module.

The sole XiaoK plan is intentionally not edited in this B branch; the
integration lead should merge the current B4.3 status into A's latest plan
without replacing A's newer progress, failures or unknown records.

Out of scope this round: the formal engineering-acceptance event, the model
compose branch, daily/weekly real integration, drag canvas, automatic
scheduling, Worker changes, menus and shared migrations. B5.1 exercises the
native Mini Program UI only for the customer stage-reminder loop above.

## B5.1 customer stage-reminder loop

The acceptance publishes the current template into a dedicated per-run store
(`admin/tmp/b5-1-acceptance-store/<runId>`) and runs it through the existing
`scripts/native-workflow-live.ts` entry with `--revision 1` against the
B-isolated PostgreSQL on `127.0.0.1:55433` (enterprise 1454 labelled fixture).
The normal B management store (`admin/tmp/native-workflow-store`) is never
opened: its published revision 2 (digest
`599ef7aeaca389bd82e243d5e68d6c4d9173e54783dc261d84a4fa95cbb2eff8`) and any
unpublished draft remain byte-identical, verified by a SHA-256/byte snapshot
before and after. The dedicated store's fixed revision is 1 with digest
`ab9813cbb6e6aac5c1572c67e975e45248f7411f0cb5f4d0f6243ee05ea78251`. The
reminder body stays authoritative to the host: an existing outbox event reuses
`payload.text`, while a new event composes
`stageReminder(project.name, stage, progress_note)` from the construction
domain, so the message carries the project name, stage name, the stage visit
reason, watch points and the manager's `现场补充：...` note. Enterprise
knowledge stays off and no craft citation is invented.

- The original XiaoK customer entry was exercised with a real mini-program JWT
  and the real `assistantHttp` handler: `POST /entry-context` with a
  conversation or lead, `GET /conversations` with `X-Assistant-Entry`,
  `GET /conversations/{id}`, `GET /conversations/{id}/messages` and its
  `?afterSeq=` delta. The same `messageId` came back with
  `constructionReminder: true`, `citations: []` and the real body. A fresh
  session/token, simulating app exit and re-entry, restored the same message
  from the server; full and delta reads added no message.
- The Stable DevTools native run (2.02.2608080, base library 3.17.2,
  390x844) opened the original chat route
  `/packages/assistant/chat/chat?conversationId=1454000005` and rendered the
  persisted reminder `105` with the real project/stage/reason/watch-points and
  `现场补充` text. It then re-read on real hide/show after `customer_access`
  revocation and source invalidation, restored the available projection after
  each restoration, found the real conversation in the authorized history
  sheet, and removed the usable reminder after participant revocation before
  re-entering it after restoration. 9/9 native checks passed; the temporary
  local API switch used for the isolated B server was restored after the run.
- A duplicate business event (new `runId`, same `sourceEventKey`) reused the
  same outbox, delivery and message; the stage-message count stayed unchanged.
- Requesting a temporary per-run generic conversation left the receipt on the
  real conversation with `requestedConversationId` set to the temporary id,
  `reusedConversation=true` and the same `messageId`; no stage message moved.
  The temporary conversation and participant are created in one transaction
  that refuses occupied ids and never reactivates an existing participant;
  cleanup deletes only rows still carrying the run marker. A crashed run may
  leave rows behind, but a later run uses different ids and never reuses them.
- Revoking the customer participant removed the conversation from history and
  made `GET /conversations/{id}` return 404. Revoking `customer_access` made
  the reminder `available:false` with a `notice` block instead of a success
  state, and a synthetic newer stage event made the old notice unavailable.
  All revocations were restored in `finally`.
- A real foreground resume now forces one full message-window re-read even
  when `lastSeq` did not change and the 60-second sync window is still fresh;
  it also supersedes an in-flight idle refresh. Idle polls keep their delta
  path, and pending sends/actions are not cleared or resent. The focused chat
  suite is 57/57.
- The labelled fixture seeds `construction_report_settings` for enterprise 1454
  with `enabled=false` and `stage_enabled=false`. Acceptance and the native run
  observed no assistant job/run, `ai_provider_attempts`,
  `assistant_usage_records`, `assistant_knowledge_attempts`, construction
  reports/report deliveries or `construction.report.%` outbox events; FastGPT,
  model and embedding calls were zero. The disabled report plan covers only the
  labelled B tenant; A/production configuration is untouched.
- Evidence: `admin/tmp/b5-1-acceptance-runs/b5-1-user-loop-20261111033109058/verification.json`
  for the isolated-store run (12/12 checks, normal-store snapshots identical,
  cleanup `{conversations:1,participants:1,links:1,skipped:0}`), and
  `admin/tmp/b5-1-devtools/native-verification.json` plus
  `admin/tmp/b5-1-devtools/chat-reminder.png` for the 9/9 native run. The
  fixture script is `admin/scripts/native-workflow-live-fixture.ts`.

Limitations: no formal engineering-acceptance event exists and the system never
asserts "验收通过". The B5.1 closeout covers only the chat cache commit order
(old full/delta responses can no longer seed the internal cache after their
epoch/ticket is invalid) and acceptance cleanup ownership (one transaction
locks the conversation, participant and `construction_links`; any mismatch
leaves all three untouched and fails the run). B5.2 connects the daily
period-intake, real Worker facts, native model body, in-app delivery, original
XiaoK report/record/photo read, re-entry, dedupe and revocation chain. The
native Mini Program card/detail/original-record/re-entry/revocation flow was
verified in Stable DevTools after the client session was refreshed on
2026-11-11. Weekly reports, a general scheduler, drag canvas,
Worker/menu/shared-migration changes remain out of scope. The native B run used a
temporary local API switch in the B worktree (reverted); A/production
configuration was not changed. Counts: 192 non-database native-workflow tests
(including 20 period-report port, 8 acceptance-state, 31 model-evidence, 23
status-reader, 3 status-reentry, 8 admin-run-status and 7 acceptance-conversation
tests), 89 shared construction tests, 6 offline guards and 59 focused chat. The
full Mini Program suite
remains 2218/2221 with three pre-existing survey-runtime audit failures
unrelated to this chat change.

## B5.2 daily period report

`period-event.ts` fixes one Shanghai calendar day from the run event and rejects
spans and weekly events. `period-report-ports.ts` implements the daily live
capabilities against the existing construction services:

- `read.period_records`, `read.authorized_photos` and `read.receiver_scope`
  reuse `collectReportFacts`, the customer binding, published customer records,
  attachments/media and the existing owner/manager project authorization.
- `save.period_report` calls the real `enqueueReport`: it creates or reuses the
  existing `construction_reports` / `construction_report_versions` /
  `assistant_runs` / `assistant_jobs` rows and returns the real
  reportId/revision/runId. The business key is the existing `report_key`
  (`kind + start + end + stage event + conversation generation`), never a
  workflow runId or published revision.
- `deliver.inapp` only reads `construction_report_deliveries` and
  `assistant_messages`; it never appends a second message. A pending delivery
  returns `delivered:false` and the run fails truthfully.
- Single-path guard: the report plan must be `enabled=true` because the
  existing Worker refuses to process facts/body/delivery otherwise, but both
  next-run timestamps must be parked and `stage_enabled=false`. A due legacy
  schedule refuses the B period with
  `period_report_legacy_scheduler_due`; a disabled plan refuses with
  `period_report_plan_disabled`.

`runPublishedLive` now accepts `period_report` definitions (and still binds one
published revision/digest and one event). `scripts/native-workflow-period-report.ts`
runs one period through a published definition. The acceptance entry
`scripts/native-workflow-period-report-acceptance.ts` prepares one synthetic
published record/photo through `SiteChatService`, creates the customer binding
through `ensureFollowupBinding`, parks the legacy schedule, runs the workflow,
then starts the real assistant Worker HTTP loop against the real internal
endpoint (claim + Lease; no fabricated lease) and replays the same period with a
new workflow runId. It then reads the report through the original XiaoK
`followups → reports → record → media` API, checks re-entry, duplicate counts
and access/photo revocation, and restores the plan/agent configuration.

B5.2 closeout rules:

- `save.period_report` re-authorizes the project inside the same write
  transaction, with the same project → settings → binding → conversation lock
  order as the scope read, so a membership or customer revocation between the
  read and the write cannot enqueue a report.
- `parseFixedDailyPeriod` only accepts a Shanghai calendar day that has already
  ended; an ongoing or future day fails with `period_not_ended`.
- The workflow CLI resolves each app/fixture target with
  `resolveB4DatabaseTarget` and verifies the connected `current_database()` /
  `current_user` against that target before any workflow work, so a fixture
  pointed at the wrong database or role never runs.
- The acceptance restores the captured report plan and agent configuration on
  the failure path as well as on success (`finally`), not only on a clean run.
- The offline contract `live/report-model-evidence.ts` binds model evidence to
  reportId/revision/factsRunId/bodyRunId. Every succeeded `agent_model` step of
  the body run must reference a provider attempt that belongs to the same body
  run, is `succeeded` and `accepted:true`; each such attempt must own a
  `usage.provider_attempt_id` row with category `tokens`, measurement `observed`
  and both token counts. Failed, unaccepted, other-run, FastGPT and
  unknown/unavailable-measurement rows fail even when another row looks usable.
- Fresh generation and replay are evaluated separately. Fresh requires
  `reused:false`, receipts matching the model-evidence binding, every period
  counter strictly increased and succeeded facts/body jobs with at least one
  attempt. Replay requires `reused:true`, the same report/version/facts run and
  delivery receipt, and every counter unchanged; it never describes a reused
  success as a new model call.

Recorded B evidence (2026-11-11, isolated database 55433, enterprise `1454`,
project `1454000004`, Shanghai day 2026-11-05): report `3`, revision `1`, facts
run `5`, body run `6`, delivery message `114` at conversation `1454000007`
(`seq 3`); `report_key` matches the `enqueueReport` formula. The real Worker
claimed the facts job with a Lease (no fabricated lease). The native body ran
through the `llm-settings-override` platform provider (`qwen3.7-flash`) with one
`succeeded` attempt (`accepted:true`), observed usage `1105` input + `1737`
output tokens, and zero FastGPT attempts. The first period run truthfully ends
`delivery_not_confirmed` because the report task is still queued when the run
reaches `deliver.inapp`; after the Worker delivered, the replayed period run
(a new workflow runId) returns `completed`, reuses the same `report:3:1` save
receipt and reads the real `report-delivery:3:1:1` receipt. Repeat execution
added no report/delivery/message/job/run. 19/19 handler checks: the original
XiaoK read returns `contentStatus:'composed'`, generation `ready` and delivery
`delivered`; re-entry returns the same report/record/photo (14823 bytes,
sha256 `1cc96be8…`); customer-access revocation yields `available:false` /
`source_unavailable`; photo withdrawal returns 404.

B5.2 closeout rerun (2026-11-11, same isolated database, Shanghai day
2026-11-06 chosen because no report existed for that binding/day): the first
workflow run created report `4`/revision `1`/facts run `7` with
`reused:false`. The facts job was `queued` with zero attempts before the real
Worker started and `succeeded` with one attempt afterwards; the body job `8`
was also `succeeded` with one attempt. Report `4` is `facts_ready`/`ready`;
body run `8` has one succeeded `agent_model` step (1100) bound to provider
attempt `2` (`llm-settings-override`, `qwen3.7-flash`, `succeeded`,
`accepted:true`) with observed usage `2` (`tokens`, `1108` input + `1427`
output) and zero FastGPT attempts. The fresh contract observed every counter
increase (reports/deliveries/report messages `3→4`, jobs/runs `6→8`,
attempts/usage `1→2`). A new workflow runId replayed the same day with
`reused:true`, the same report `4`/revision `1`/facts run `7`, the same
`report-delivery:4:1:1` receipt (message `115`, conversation `1454000007`), and
every counter unchanged; original XiaoK reads, re-entry and access/photo
revocation added no rows or model calls. Restoration reported `worker`,
`media`, `customer_access`, `report_plan` and `agent_settings` all restored; an
independent read confirmed `enabled=false`/`stage_enabled=false`/parked
schedules/empty project filter, `agent_config={runtime:'extractive-v1'}` with
`enabled=true`, restored customer access and an undeleted photo. 23/23 checks,
exit 0. Evidence:
`admin/tmp/b5-2-period-report-runs/b5-2-daily-20261111071054743/verification.json`.
A failure-path run against an already-generated period (2026-11-05) rejected
the reused report before the Worker started, exited `1`, and still reported
`worker`/`media`/`customer_access`/`report_plan`/`agent_settings` restored with
every counter unchanged; evidence
`admin/tmp/b5-2-period-report-runs/b5-2-daily-20261111071518877/verification.json`.

Native Stable DevTools evidence (2026-11-11, 2.02.2608080, 390×844): the
customer entered the original XiaoK chat through the lead entry, opened the
authorized history, selected the synthetic binding and saw the owner daily card
"11月5日我家进展" with the real published highlights. "查看完整日报" opened
"11月5日施工日报" with the model body under "工艺关注"
(`通用建议（模型知识）…`), the real progress/pending from the record, and a
working "查看原记录" sheet with the authorized photo. Opening the detail
acknowledged the real delivery (`read_at`). Exit/re-entry reopened the same
report `3`/revision `1` with the same body and read state. Access revocation
removed the report from the authorized history (API 404
`assistant_resource_not_found`) and restoration returned it. During the whole
native window no report/delivery/message/job/run/provider attempt/usage row was
added. Evidence: `admin/tmp/b5-2-period-report-runs/b5-2-daily-20261111055019510/verification.json`
and `admin/tmp/b5-2-devtools/native-daily.json`.

## B5.3 period-report run status

`live/period-report-status.ts` freezes the read-only status contract for one
existing period-report workflow `runId`. The status read observes one run; it
never starts, resumes or re-executes it.

- The immutable workflow trace is kept separate from current business progress.
  The raw run may truthfully record `delivery_not_confirmed` while the
  asynchronous report task is still queued; progress reads the current
  `construction_reports` / `construction_report_versions` rows, the facts and
  body runs/jobs and the delivery receipt, and reports facts, body, delivery and
  availability independently.
- Status reads are side-effect free. They read the B-owned run record and one
  business snapshot only: no port execution, report enqueue, model compose,
  in-app delivery or automatic retry. A read error or an indeterminate step
  stays `unknown`; reading again does not retry or write.
- Clients may use bounded polling: the Admin helper polls a processing run at
  most every 3 seconds, stops after 100 reads, and stops on an unbound run or a
  terminal overall state (`completed`/`failed`/`unknown`/`unavailable`).
  Refreshing or re-entering the page keeps the `runId` in the query string, and
  opening the live tab reads the same binding and current business progress
  again; reading does not rewrite the run record.
- The run record freezes `definitionId`/revision/digest and the saved
  reportId/revision/factsRunId. A later published revision never rewrites an old
  run's binding or report identity.
- `runId`, `reportId` and `projectId` are not authorization proof: platform
  role, host enterprise, project business permission and current source
  availability jointly decide what may be read.

Recorded B5.3 evidence (2026-11-11, isolated B database, Shanghai day
2026-11-08): run `b5-3-status-002` created report `6`/revision `1`/facts run
`10`/body run `11`/message `117`. Before the Worker started the same run was
`processing` with facts `queued`; the observed sequence then moved through
facts `ready` + body `queued` + delivery `delivered`, body `running`, and finally
`completed` with body `ready` and delivery `delivered`. The raw trace stayed
`failed`/`delivery_not_confirmed` throughout and was displayed separately.
Counters moved from reports/jobs/runs/attempts/usage/messages/deliveries
`5/9/9/2/2/5/5` to `6/11/11/3/3/6/6`; five repeated status reads left every
counter unchanged. Customer-access revocation produced
`unavailable`/`access_revoked`, record withdrawal produced
`unavailable`/`source_unavailable`, and publishing definition revision `2` left
the old run on revision `1` with the same digest and report `6`. A separate real
run `b5-3-status-001` (report `5`, period 2026-11-07) had its facts card
delivered while body admission failed with `assistant_capability_forbidden`;
the status correctly reported overall `failed` and body `failed`, not
processing. Read-only re-entry repeated both outcomes with zero new rows or
model calls. API authorization rejects unauthenticated (401), enterprise-admin
(403) and wrong-tenant (403) callers; the platform admin read succeeds. The
Admin page check passed 6/6 and refresh/re-entry 5/5. Evidence:
`admin/tmp/b5-3-live/verification.json`, `failed-run.json`,
`readonly-verification.json` and `dev.log`.

B5.3 closeout:

- Status reads authorize before returning any trace. The run record's own
  enterprise/project identity is the only scope source; a run without a project
  scope fails with `run_scope_unavailable` (404). Complete bindings, runs
  without a successful save receipt and old receipts without `bindingId` all
  run the same `readProjectAccess(..., 'share')` check inside the tenant
  transaction. The reader rethrows `AssistantError` 403/404 unchanged, and the
  status route maps them to the same HTTP status instead of a 500
  `native_workflow_error`. Authorized viewers still read unbound diagnostics.
- Facts/body ready with a `muted`/`revoked` delivery is the terminal `stopped`
  state (`processing:false`, `completed:false`, reasons `delivery_muted` /
  `delivery_revoked`). A still-queued/running/waiting facts or body keeps
  `processing` even when delivery is muted/revoked; a failed step keeps
  `failed`; `pending`/`held` delivery stays `processing`; `delivered` still
  completes. Facts, body, the original delivery state and the immutable raw
  trace remain in the response.
- Deleting a follow-up and explicitly resuming it reuses the same binding row
  with a new conversation. The reader compares the current
  `binding.conversation_id` with the save receipt's conversationId and reports
  `access_revoked` / `binding_generation_changed` (overall `unavailable`)
  instead of projecting the old report as available/completed. The old run,
  report identity, receipt, message and raw trace are never rebound to the new
  conversation.
- The Admin live tab is a controlled tab. It reads only while visible; leaving
  stops the timer, invalidates in-flight responses and clears loading; returning
  re-reads a cut-short cycle (a denial or transient failure stays stopped with a
  working manual re-read). HTTP 401/403/404 clears the restricted
  observation/binding/progress/raw; a transient failure keeps the last snapshot
  and shows both the last `observedAt` and the failure time.
- Tests: the native-workflow offline suite is 235 passing with 4 skipped live
  cases; the database cases for the status route live in the independent
  strict-opt-in file `period-report-status-route.live.test.ts` (4 cases), not in
  the offline file. That file skips as a whole without the opt-in and a skip is
  not counted as a pass; with `B4_LIVE_DEVELOPMENT=1` and the B URLs all 239
  pass, including the real route/default-reader bound, unbound and old-receipt
  paths and a 403 after the controlled platform admin is disabled. The new
  offline guards cover the gate, fixture ownership and restore-failure paths.
  The closeout real run is 14/14: muted/revoked/pending mappings, the
  resumed-generation `unavailable`, the three denied paths, restored reads and
  unchanged report/job/run/attempt/usage/message/delivery counters. Evidence:
  `admin/tmp/b5-3-closeout/verification.json`. `npm run build` still stops at
  the pre-existing `scripts/fastgpt/setup-unified.mts:113` type error, which is
  byte-identical to the baseline; Turbopack reports "Compiled successfully"
  before that type check, and all changed files have zero type errors.

Database-gated status-route cases are isolated from the offline entry:

```powershell
$env:B4_LIVE_DEVELOPMENT='1'
$env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
$env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
npx tsx --test src/lib/native-workflow/__tests__/period-report-status-route.live.test.ts
```

Without `B4_LIVE_DEVELOPMENT=1` the whole live file is skipped and never
connects. Once opted in, `production`, a missing B target and any wrong
host/port/database/role are rejected by the shared resolver before a connection
is opened; after connecting, `assertB4ConnectionIdentity` re-checks
`current_database()`/`current_user`. The one temporary disable uses the fixed
admin `1454000010` only when its enterprise, username, platform role and
`[B5.3]` marker all match the fixture; `withControlledStatusRouteAdminDisabled`
restores the row in `finally` and reads it back, and a restore or verification
failure fails the run.

## Reproduce

From `admin/` (no database, no Worker, no model):

```powershell
npx tsx --test src/lib/native-workflow/__tests__/validate.test.ts src/lib/native-workflow/__tests__/advance.test.ts src/lib/native-workflow/__tests__/simulate.test.ts src/lib/native-workflow/__tests__/hardening.test.ts src/lib/native-workflow/__tests__/store.test.ts src/lib/native-workflow/__tests__/service.test.ts src/lib/native-workflow/__tests__/admin-draft-state.test.ts src/lib/native-workflow/__tests__/admin-selection.test.ts src/lib/native-workflow/__tests__/live.test.ts src/lib/native-workflow/__tests__/dev-config.test.ts src/lib/native-workflow/__tests__/fixture-ownership.test.ts src/lib/native-workflow/__tests__/acceptance-store.test.ts src/lib/native-workflow/__tests__/acceptance-conversation.test.ts src/lib/native-workflow/__tests__/acceptance-state.test.ts src/lib/native-workflow/__tests__/period-report-ports.test.ts src/lib/native-workflow/__tests__/report-model-evidence.test.ts src/lib/native-workflow/__tests__/period-report-status.test.ts src/lib/native-workflow/__tests__/period-report-status-reentry.test.ts src/lib/native-workflow/__tests__/admin-run-status.test.ts src/lib/native-workflow/__tests__/period-report-status-route.test.ts src/lib/native-workflow/__tests__/period-report-status-route-guards.test.ts
npx tsx src/lib/native-workflow/playground/simulate.ts
```

This offline command includes `period-report-status-route.test.ts` and its
`period-report-status-route-guards.test.ts` companion; the database cases live
in `period-report-status-route.live.test.ts` and are never part of this entry.
Even a leftover `B4_LIVE_APP_DATABASE_URL` cannot open a connection here because
the live file is not listed and its gate is disabled without
`B4_LIVE_DEVELOPMENT=1`.

The shared construction-service suite is also non-database:

```powershell
npx tsx --test src/lib/construction/__tests__/*.test.ts
```

The real-construction-adapter suite is separate and skips without the B URLs:

```powershell
$env:B4_LIVE_DEVELOPMENT='1'
$env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
$env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
npx tsx --test src/lib/native-workflow/__tests__/live-integration.test.ts
npx tsx --test src/lib/native-workflow/__tests__/live-integration-guards.test.ts
```

The integration suite deliberately does not set `B4_LIVE_DEVELOPMENT` itself;
missing/zero opt-in or production must fail before any connection. The guard
suite uses fake clients to prove that contract and the shared-fixture preflight
without opening a database connection.

The customer stage-reminder loop runs against the same B-isolated database:

```powershell
$env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
$env:B4_LIVE_FIXTURE_DATABASE_URL='postgresql://sfp_owner:...@127.0.0.1:55433/smart_floor_planner'
npx tsx scripts/native-workflow-live-fixture.ts --development
npx tsx scripts/native-workflow-stage-reminder-user-loop.ts --development
```

Fixtures are synthetic and contain no real customer data.

## Sources

- FastGPT reference baseline: `v4.17.4`,
  `09192051eec4e70de4d02e4c5131e11844e0b28f` — graph/node/edge/reference and
  editor-to-execution concepts only.
- No FastGPT or third-party source code is copied into this module. If that
  changes, retain the upstream LICENSE, commit, modification record and any
  applicable notice.
- Existing project foundations reused in later phases: `AgentRuntimePorts`,
  `runRenovationAgent`, `executePostgresText`, Lease/run context. They are not a
  generic workflow API and are not imported here.
