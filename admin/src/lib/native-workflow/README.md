# Native Workflow (B0-B5)

Pure workflow core, a B-owned draft/publish store, a server-only B4 adapter for
家客来 native business orchestration, and the B5 period-report chain. B0-B2
defines, validates, compiles and simulates workflows; B3 adds drafts, immutable
published versions and a simulation debugging surface; B4 connects one published
stage-reminder flow to the existing construction authorization, outbox save and
in-app delivery services; B5 adds the daily/weekly single-receiver chain, the
one-project four-receiver batch, and the B5.9 bounded weekly scheduler that runs
inside the existing assistant-worker tick. The pure core still does not connect
a model, database, queue, scheduler, Worker, business write path or message
channel; only the separate `live/` adapter does, under host identity.

Owner: B line (`codex/xiaok-native-workflow`). Shared migrations, dependencies,
menus, the sole XiaoK plan and the bilingual module inventories' integration
wiring remain owned by the integration lead.

Parallel-branch boundary: the Responses API task
(`codex/xiaok-bailian-responses-api`) owns the public adapter layer for Bailian
Responses API, native web search, web extractor and code interpreter. B line
never adds a Responses provider adapter and never edits that layer. Both lines
meet only at the existing provider-neutral contract in
`src/lib/assistant/contracts/model.ts` (`AgentModelGateway`,
`ModelTurnInput`/`ModelTurnOutput`) and at `src/lib/ai/providers/*`; those files
and the Chat Completions gateway stay untouched here. Any new model capability
B line needs must first be proposed as a contract change and accepted by the
Responses task owner; B5 report and draft turns currently need none.

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

## B5.4 single-project weekly period report

The B5.2 daily adapter and B5.3 status reader now accept `weekly` without a new
workflow, scheduler, Worker, message channel or dedupe rule.

- Period contract: a weekly event uses `periodStart` = a Shanghai Monday and
  `periodEnd` = the next Monday (exclusive), exactly seven calendar days later.
  `parseFixedPeriod` maps them to Shanghai midnights: start = `periodStart`
  midnight, end/cutoff = `periodEnd` midnight, right-open. Both dates must be
  Mondays, the week must be complete, and `end <= now` is checked with the
  trusted server clock; `occurredAt` is only the schedule stamp. The daily rule
  (`periodStart === periodEnd`, next-midnight end) and
  `parseFixedDailyPeriod` stay unchanged.
- The published definition's `inputSchema.periodKind`, the event kind and the
  business event kind must agree. `periodReportKey` keeps the existing
  `kind + start + end + event + conversation generation` formula, so a daily and
  weekly window with overlapping dates never share a report. Facts still come
  from the week's authorized raw published records/photos; model dailies are
  never used as weekly facts. The deterministic compose heading is
  `施工周报 · <start> ~ <end>` for weekly.
- Status observation accepts both kinds, checks the report kind against the
  fixed binding, and converts the stored boundaries kind-aware (daily: next
  midnight; weekly: the Monday midnight). The Admin page shows `业务周期` for
  weekly and keeps the B5.3 stopped/authorization/generation/lifecycle behavior.
- CLI: `--period-kind weekly` selects `period-report-weekly` and derives
  `periodEnd` as `periodStart + 7` when omitted; the original daily command is
  unchanged. The acceptance driver accepts the same flag, creates two `[B5.4]`
  raw records on two dates inside the week (one authorized photo), keeps the
  fresh/replay/model-evidence checks, and reuses an already-enabled B provider
  instead of requiring the main database.

Recorded B evidence (2026-11-11, isolated B database, week 2026-10-26 →
2026-11-02): report `7`/revision `1`/facts run `12`/body run `13`/message `120`,
delivery `delivered`, two controlled records `2` and `3` (photos on `2`). Fresh
generation moved counters from reports/jobs/runs/attempts/usage/messages/
deliveries `6/11/11/3/3/6/6` to `7/13/13/4/4/7/7`; the same-period replay with a
new workflow runId reused report `7`, revision `1`, facts run `12` and the same
delivery receipt with every counter unchanged. The body used one succeeded
`llm-settings-override` attempt (`accepted:true`) with observed `1217` input +
`769` output tokens and zero FastGPT attempts. The original XiaoK entry listed
the weekly report (`?kind=weekly`), opened both raw records and the authorized
photo, returned the same report/record/photo after exit and re-entry, and
invalidated/restored under customer-access and photo revocation. The Admin page
opened the same workflow `runId`, showed `已完成`, `业务周期 2026-10-26 ~
2026-11-02`, report `7`/r1 and delivery `已投递`, while the raw card kept
`failed`/`delivery_not_confirmed`. Restoration reported worker, media,
customer_access, report_plan and agent_settings all restored. Evidence:
`admin/tmp/b5-4-period-report-runs/b5-4-weekly-20261111095128486/verification.json`
(generation/replay) and
`admin/tmp/b5-4-period-report-runs/b5-4-weekly-20261111095128486/native-ui/native-ui.json`
with 9 screenshots in the same folder (native UI).

Stable DevTools native acceptance passed all 19 checks: the original XiaoK
customer entry (leadId `1454000003`) opened the history binding `1`
`[B4] 水路阶段测试项目` with the weekly card `10月26日 · 施工周报`, period
`10月26日 00:00—11月2日 00:00`. The 简报记录 sheet defaults to the current
Shanghai month `2026-11`, which hides the report; selecting `2026年10月` plus
the `周报` filter lists `10月26日—11月1日 · 施工周报` — the month rule is the
saved period start in Shanghai (October), not delivery time. The detail showed
report `7` / revision `1`, kind `weekly`, `contentStatus: composed`, delivery
`delivered`, `本周记录` with both records' completed values, and
`查看原记录 2` / `查看原记录 3`. Both originals opened through real UI taps:
record `2` version `3` `[B5.4] 水电线管敷设` with photo media `2` (path key
`2_3_2`, 15157-byte JPEG), and record `3` version `3`
`[B5.4] 底盒固定与回路核对` with no photo. Exit and re-entry read the same
report `7` / revision `1`, the same period and the same two records.
Customer-access revocation returned API `404 assistant_resource_not_found`
with no binding/report in native history; restoration returned the same binding
and re-read report `7`/r1 composed. Photo withdrawal returned report-detail API
`200` with `available:false`, the media endpoint `404`, and the native sheet
showed `这份简报已不可用` / `来源或权限已变化，这份简报当前不可查看。` with no
retained projects or original (the existing source rule invalidates the saved
section when attached media is withdrawn); restoring the photo re-read the
card/detail and the photo path. Counters stayed
reports/jobs/runs/attempts/usage/messages/deliveries `7/13/13/4/4/7/7` with
zero new model calls; the only write was the legitimate delivery read receipt
(`read_at` null → `2026-11-11T11:48:26.875Z`).

Environment note: the already-open Stable DevTools window is the main-workspace
checkout `G:\workspace\向总\Smart-Floor-Planner\miniprogram` of the same Mini
Program (appId `wxa7728432f59779d1`), not this worktree path. No window was
closed, opened or replaced. The report/followup UI files driven here are
byte-identical between the two branch tips; the only Mini Program difference is
`packages/assistant/lib/chat.js` (ordinary chat message sync) plus a deleted
test file. This is an environment note, not a failure of the report path.

`--period-kind` missing-value fix: the acceptance driver previously used a
helper that returned `undefined` both when the flag was absent and when it was
present without a value, silently defaulting to `daily`. The new pure helpers
in `live/period-cli.ts` make `readCliOption(argv, name)` distinguish the two
cases; `parsePeriodKindArg(argv)` returns `daily` only when the flag is absent,
throws `period_kind_missing` (`--period-kind requires a value (daily or
weekly)`) for a bare `--period-kind` or `--period-kind=`, and
`period_kind_invalid` for unknown values. The acceptance entry parses this at
module load and fails in `bootstrap()` before `resolveB4DatabaseTarget`, the
`pg.Pool` or any fixture mutation; the other CLI
(`scripts/native-workflow-period-report.ts`) already rejected a missing value
through its own `option()` helper and is unchanged. Targeted test:
`npx tsx --test src/lib/native-workflow/__tests__/period-cli.test.ts` → 11/11
pass.

Tests: at B5.4 time the documented offline native-workflow command (the list
below, now 25 files) ran 270 tests, all 270 passed with 0 fail; the weekly additions cover the
Monday-to-Monday conversion, partial/cross-week/non-Monday rejection,
trusted-now ended checks, daily compatibility, weekly port
enqueue/idempotency, weekly status kind/boundary checks and the CLI window
rules. `npx tsx --test
src/lib/native-workflow/__tests__/live-integration.test.ts
src/lib/native-workflow/__tests__/live-integration-guards.test.ts` is 6/6; its
B live case skips without the B URLs, and the 4 strict-opt-in live route cases
remain skipped/unchanged without `B4_LIVE_DEVELOPMENT=1` (they did not run this
round). `npm run build` prints "Compiled successfully" and then exits 1 at the
pre-existing `scripts/fastgpt/setup-unified.mts:113:75` TypeScript error
(`Property 'selectedType' does not exist…`); this is not a full build pass, and
the generated `admin/src/lib/survey-runtime/source-manifest.json` change was
reverted.

## B5.5 single-project worker weekly report

The same weekly adapter now serves a second receiver. A worker report stays one
project, one worker, one weekly window; no scheduler, Worker, message channel or
Mini Program source change is added.

- Receiver/scope contract: `PeriodReportScope` carries `receiverKind`
  (`customer`/`worker`), `receiverAdminId`, `receiverUserId` and
  `bindingAudience`. Worker reads reuse the existing non-customer facts branch
  and deliberately do not check `customer_access`; a worker report requires the
  plan's `project_ids` to be exactly `[projectId]`. An existing worker report is
  reused only when binding, conversation generation, kind/period and
  `policy_snapshot.scope.project_ids` all match, otherwise the run fails with
  `period_report_scope_conflict` or `period_report_generation_conflict`.
- Worker binding identity: the receiver is binding `2`, enterprise-scoped
  (`principal_key=admin:1454000008`, `audience=worker`, `project_id NULL`,
  `scope_key=enterprise`, conversation `1454000008`), created by the persistent
  marked fixture through `ensureFollowupBinding`. There is no project-scoped
  worker binding; the customer keeps binding `1`.
- CLI: `--receiver-kind customer|worker` (default `customer`) and
  `--worker-id`. Pure argument checks (`receiver_kind_missing`,
  `receiver_kind_invalid`, `worker_id_missing`, `worker_id_invalid`,
  `worker_id_forbidden`) run before the database target is resolved or any
  connection is opened. After connecting, the shared entry
  (`live/period-report-entry.ts`) runs the load-bearing order: trusted
  ended-period check → resolve the selected published revision → shared
  published-target precheck → management-executor authorization → worker
  account/member/staff-access checks → `ensureFollowupBinding` → the live
  runner with the same selected revision and event. The precheck is
  `live/published-target.ts` (`resolvePublishedTarget`): compiled
  definitionId/revision/digest, recorded `nodeVersions`, `eventType` and
  `periodKind`. The runner calls the same function before its first effect, so
  the CLI and the runner cannot drift, and a valid executor plus a valid worker
  without a binding is rejected on a `weekly` event + daily template before
  any conversation/binding/participant or enqueue. `ensureFollowupBinding()` is
  the last step inside that transaction, after those read-only checks.
  `--admin-id` stays the management executor, the worker is only the receiver,
  and evidence queries use the receipt reportId/binding so they never pick up
  the same-period customer report.

Recorded B evidence (2026-11-11, isolated B database, week 2026-10-26 →
2026-11-02): enterprise `1454`, project `1454000004`, worker admin/base user
`1454000008` (`b4-live-worker-1454`, `construction_staff`, linked to base user
`b5-5-worker-user-1454`) with an active `worker` project member role. Fresh
generation created report `8`/revision `1`/facts run `14`/body run `15`/message
`122`, delivery `delivered`. Its `report_key` equals customer report `7` because
the existing formula has no projectId; binding `2` and
`policy_snapshot.scope.project_ids=['1454000004']` keep them distinct. Facts
records are `[2,4,3]`: customer records `2` and `3` plus the marked internal
record `4` `[B5.5] 内部巡检记录` (worker author; edited and published by the
management executor with management permission (owner/manager); photo media
`3`, 16804-byte JPEG) aligned to 2026-10-28 inside the week. Counters moved
reports/versions/jobs/runs/attempts/usage/report messages/deliveries
`7/7/13/13/4/4/7/7` → `8/8/15/15/5/5/8/8`; the same-period replay with a new
workflow runId reused report `8`/r1/facts run `14` and the same delivery with
every counter unchanged. The body used exactly one succeeded
`llm-settings-override` attempt (`accepted:true`), observed `1291` input +
`1398` output tokens, zero FastGPT.

Staff read and native UI: the staff token (base user `1454000008`, mode
`staff`, `staffId` `1454000008`, `construction_staff`) lists binding `2` and
report `8`, opens the weekly detail (`composed`/`delivered`) with record `4` and
its photo, and re-enters the same report `8`/r1. Stable DevTools passed 8/8
checks under temporarily rebuilt readable conditions (audit `125` was
snapshotted, temporarily removed, then re-inserted and read back): the staff
entry auto-opens the worker binding and the weekly card
`10月26日 · 施工周报` (period `10月26日 00:00—11月2日 00:00`); the detail shows
report `8`/r1 `本周记录` with records `2`/`4`/`3` and their original links;
record `4` v3 + photo, record `2` v3 + photo, record `3` v3 without photo;
exit/re-entry returns the same report `8`/r1. Opening the report acknowledged
the real delivery read receipt (`read_at` null → `2026-11-11T13:33:20.385Z`).

- Customer isolation: the customer list contains only binding `1`, never worker
  binding `2`; the customer cannot read the worker report or the internal record
  (403/404), and no customer weekly report was generated for the fixed period.
  Customer report `7` stays available.
- `customer_access=false` does not gate the worker: the worker detail and the
  status observation still read. The switch was restored and read back.
- Member revocation: `ConstructionService.execute('member', …)` wrote real audit
  `125` (adminId `1454000008`, `active=false`); the worker list hid binding `2`
  and detail/record/media returned 404. Restoring `active=true` wrote audit
  `126`. The old worker report stays historically unavailable (`200
  available:false` / `source_unavailable`) and does not resurrect under
  `siteAccessRevoked`; customer report `7` remains available.
- Status reader: the bound worker receiver (`receiverKind=worker`, admin
  `1454000008`) reports `projectScope=[1454000004]` and overall `completed`; it
  stays `completed` while `customer_access=false`, becomes `unavailable` after
  revocation and stays `unavailable` (`source_unavailable`) after restoration.
  The Admin page adds a `接收人` item while keeping `业务周期`/`业务日期`.
- B5.5 evidence is classified; it is not one normally executed, continuous
  lifecycle.
  - (i) Existing fresh/replay/model evidence: the fresh run created report
    `8`/revision `1`/facts run `14`/body run `15`; the new-runId replay reused
    the same report/facts run/delivery with every counter unchanged; the body
    used one succeeded `llm-settings-override` attempt.
  - (ii) Existing API evidence of real member revocation and restoration: audit
    `125` (`active=false`) hid binding `2` and made detail/record/media 404;
    audit `126` restored the member, while the old weekly report stayed
    `available:false`/`source_unavailable` and did not resurrect (customer
    report `7` stayed available).
  - (iii) Positive native UI display evidence with a temporary condition: the
    previously reported native 8/8 is positive display evidence under
    temporarily rebuilt readable conditions. Audit `125` was snapshotted,
    temporarily removed, the staff UI driven, and the exact row re-inserted and
    read back; the report then returned to
    `available:false`/`source_unavailable`. This is a controlled temporary
    audit suspension with exact restoration, not a normal user operation.
  - (iv) Native unavailable-state evidence with audits `125`/`126` left intact
    is recorded in the closeout paragraph below: the staff entry, list refresh
    and exit/re-entry stayed on the unavailable card, the detail controller
    returned only `available:false`, record/media stayed `404`, and no report,
    task, model call or counter changed.
- The minimal later acceptance boundary is fixed only as an order: positive
  API/native UI/re-entry → real revocation → negative API/native UI → restore
  member → old report still unavailable. This round fixes only that order and
  does not re-run fresh model generation. Operationally,
  `native-workflow-worker-report-acceptance.ts --hold-after-positive` writes a
  checkpoint after the positive API reads and waits up to 30 minutes for
  `<outputDir>/positive-ui-done`; create that marker after the positive native
  UI/re-entry pass so the same in-memory run continues into the real revocation
  without a second generation.
- Environment: the already-open Stable DevTools window is the main-workspace
  checkout `G:\workspace\向总\Smart-Floor-Planner\miniprogram` of the same app
  (appId `wxa7728432f59779d1`), not this worktree path; no window was closed,
  opened or replaced. Worker followup/report UI files are byte-identical between
  the two branch tips; the only Mini Program difference is
  `packages/assistant/lib/chat.js` (ordinary chat sync) plus a deleted test file.
  The B API server was the worktree admin on `http://127.0.0.1:3018` against B
  database `127.0.0.1:55433/smart_floor_planner`.
- Evidence: `admin/tmp/b5-5-period-report-runs/b5-5-worker-20261111132739076/verification.json`
  (fresh/replay/model/API/permissions) and `.../native-ui/native-worker.json`
  plus 5 screenshots in the same folder.

<!-- B5.5-CLOSEOUT-EVIDENCE -->
B5.5 closeout evidence with audits `125`/`126` untouched (2026-11-11): the
staff entry was freshly compiled (Stable `2.02.2608080`, base `3.17.2`,
`390x844`, automator port `9420`) and opened against the worktree B API on
`127.0.0.1:3018`; only the Mini Program's external API origin was rewritten in
memory and restored afterwards. The entry auto-opened binding `2`; report `8`
appeared only as the unavailable card `这份简报已不可用` /
`来源或权限已变化` (`available:false`, no projects), and both an explicit list
refresh and exit/re-entry returned the same card. Entering through the existing
detail controller returned only `available:false` with no body, projects,
original records or photo paths; record `4` and media `3` stayed `404`. The
independent construction project entry still returned `200` under the active
worker's own permission, so this is not a blanket record lockout. Before and
after the check, `assistant_conversations`/`construction_followup_bindings`/
`assistant_participants` stayed `4/2/3`, reports/versions/jobs/runs/attempts/
usage/report messages/deliveries stayed `8/8/15/15/5/5/8/8`, delivery `read_at`
stayed `2026-11-11T13:33:20.385056+00:00`, audit `125` (`active=false`) and
`126` (`active=true`) stayed present, and the worker member stayed active. No
report, task, model call or message was created. Evidence:
`admin/tmp/b5-5-closeout/native-unavailable.json` (9/9 checks) plus
`unavailable-card.png`, `unavailable-detail.png` and `unavailable-reentry.png`.

Real CLI ordering check on the same B database (no worker binding was deleted):
an observer executor (`1454000009`) and an unavailable executor (`1454099999`)
were rejected with `construction_forbidden`, and the unfinished week
`2026-11-09` → `2026-11-16` with `period_not_ended`. The three tables stayed
`4/2/3` and reports/jobs/runs/attempts/usage/messages/deliveries stayed
`8/15/15/5/5/22/8`; no enqueue ran.

Published-target precheck closeout (2026-11-11, offline): the runner's
published-revision and event checks moved unchanged into
`live/published-target.ts` and the CLI now calls that shared function inside
`live/period-report-entry.ts` before `prepareWorkerPeriodReport`. The order is
trusted ended period → select published revision → precheck (compiled
definitionId/revision/digest, `nodeVersions`, `eventType`, `periodKind`) →
management authorization → worker checks → `ensureFollowupBinding` → runner,
with the same selected revision/event reaching both the precheck and the run.
New `period-report-entry.test.ts` (5/5) drives that real entry: a valid manager
with a valid worker that has no binding plus `weekly` event on the daily
template is rejected (`live_event_type_unsupported`) with 0 transactions, 0
authorization/binding queries, 0 writes to
conversations/bindings/participants, 0 report/job/usage/attempt queries, 0 port
calls and 0 run records; a tampered digest and tampered `nodeVersions` are
rejected (`published_version_invalid`) with the same zero-write assertions; the
matching weekly template/event passes the precheck, keeps the project lock →
staff checks → binding order, and the runner binds the same revision, digest and
event; an unfinished week is rejected before `loadPublished` is called. No live
model call, report or message was created this round.

Tests: the documented offline command now lists 26 files and runs 284 tests,
all 284 pass with 0 fail; the new `period-report-entry.test.ts` is 5/5. The
focused four-file command (worker-receiver,
worker-fixture, period-report ports, period CLI) is 52/52; the new
`worker-receiver.test.ts` is 4/4 and `worker-fixture.test.ts` is 5/5.
`period-report-ports.test.ts` is 28/28,
`period-report-status(-reentry).test.ts` 45/45, `period-cli.test.ts` 15/15, and
`live-integration` plus guards 6/6 with the B live case skipped without URLs.
The Mini Program `assistant-followups.test.js` is 26/26 including the new
"later unavailable read clears the loaded body, projects and original" case.
The 4 strict-opt-in live route cases were not run this round. `npm run build`
still prints "Compiled successfully" and then exits 1 at the pre-existing
`scripts/fastgpt/setup-unified.mts:113:75` type error; this is not a full build
pass, and the generated `admin/src/lib/survey-runtime/source-manifest.json`
change was reverted. Scope stays one project/one worker; boss and multi-project
receivers, the scheduler, canvas, Worker changes and shared migrations remain out
of scope.

## B5.6 single-project designer weekly report

The same weekly adapter now serves a designer receiver. A designer report stays
one project, one designer, one weekly window; no scheduler, Worker, message
channel, Mini Program source or shared migration is added.

- Receiver/scope contract: `PeriodReportScope.receiverKind` is
  `customer`/`worker`/`designer`. `live/staff-receiver.ts` is the shared
  worker/designer preparation (it replaces the worker-only helper) and keeps the
  load-bearing order: trusted ended period → selected published version →
  `resolvePublishedTarget` → management-executor `update` authorization →
  active staff account check → active non-observer project membership →
  `construction_followup_staff_access` → `ensureFollowupBinding()` last. A
  designer requires an active `designer` admin without a required password
  change (a `construction_staff` account is rejected), and `--admin-id` stays
  the management executor: receiving a report grants no management permission.
- Binding: the designer is an existing enterprise-scoped binding
  (`principal_key=admin:<id>`, `audience=designer`, `project_id NULL`,
  `scope_key=enterprise`). There is no project-scoped designer binding; the
  customer keeps binding `1` and the worker keeps binding `2`.
- Facts: designer reads reuse the non-customer facts branch and deliberately do
  not check `customer_access`. Records/photos come from the fixed project's
  authorized published records through membership, not from the customer link
  or another role's report. The plan must still be exactly
  `project_ids=[projectId]`; a broader or empty plan fails with
  `period_report_project_scope_mismatch`.
- Reuse/isolation: an existing report is reused only when binding, conversation
  generation, kind/period and `policy_snapshot.scope.project_ids` all match;
  otherwise the run fails with `period_report_scope_conflict` or
  `period_report_generation_conflict`. `report_key` alone never selects a
  customer or worker report.
- CLI: `--receiver-kind designer` and `--designer-id`; a worker receiver rejects
  `--designer-id` and a designer receiver rejects `--worker-id`. The pure
  `receiver_kind_missing`/`receiver_kind_invalid`/`designer_id_missing`/
  `designer_id_invalid`/`designer_id_forbidden`/`worker_id_forbidden` checks run
  before the database target is resolved.
- Ports/status: `read.receiver_scope` returns `enterprise_designer` with
  `designerAdminId`; the save receipt records `receiverKind=designer`,
  `receiverAdminId` and `projectScope=[projectId]`; `deliver.inapp` matches that
  exact object. The status reader reports `receiverKind=designer`, requires
  exactly one frozen project, uses the designer binding plus current membership
  as its access proof (no `customer_access`), and rejects an unknown receiver
  type with `receiver_kind_unsupported` (receipt) or `receiver_kind_invalid`
  (ports) instead of falling back to the owner. The Admin live tab shows
  `designer <id>` as the receiver.

Recorded B evidence (2026-11-11, isolated B database, week 2026-10-26 →
2026-11-02, enterprise `1454`, project `1454000004`): the designer fixture
seeded marked designer `1454000011` (`b5-6-designer-1454`, base user
`1454000011` `b5-6-designer-user-1454`, active `designer` member) and marked
outsider `1454000012` without project membership. Fresh generation created
report `10`/revision `1`/facts run `18`/body run `19`/message `125` at
conversation `1454000009` (`seq 2`), delivery `delivered`; its `report_key`
equals customer report `7` and worker report `8` because the existing formula
has no projectId, and binding `3` plus
`policy_snapshot.scope.project_ids=['1454000004']` keep them distinct. Facts
records are `[2,3]`: record `4` (worker author) is excluded by the existing
revocation rule, so a new designer report never resurrects a worker record
invalidated by audit `125`. Fresh counters moved reports/deliveries/messages
`9/9/9`→`10/10/10` and jobs/runs `17/17`→`19/19`, attempts/usage `6/6`→`7/7`.
The body used exactly one succeeded `llm-settings-override` attempt
(`accepted:true`), observed `1180` input + `2051` output tokens, zero FastGPT.
The same-period replay with a new workflow runId reused report `10`/r1/facts run
`18` and the same delivery with every counter unchanged.

Report `9` attribution (read-only reconciliation, 2026-11-11): the increment
from the B5.5 endpoint `reports/jobs/runs/attempts/usage` `8/15/15/5/5` to the
pre-report-10 baseline `9/17/17/6/6` is report `9`, created by the preceding
designer acceptance run `b5-6-designer-20261111151357297` (started
`15:13:57.297Z`). Report `9` is `weekly` on binding `3`, designer
`1454000011`, conversation `1454000009`, period `2026-11-02 -> 2026-11-09`
(Shanghai), revision `1`, facts run `16`, body run `17`, delivery message `124`
(`delivered` at `15:14:01.247Z`, read at `15:15:07.859Z`), facts records
`[5,1]`, and one succeeded accepted `llm-settings-override` attempt `6` with
observed usage `6` (`1192` input + `1425` output tokens). That run's own
verification ended with failed checks: the facts job was already `succeeded`
when the acceptance expected `queued` before starting its own Worker, and two
negative assertions did not accept the CLI's stderr rejection envelope even
though both calls exited `1` with `designer_receiver_unavailable`. The later
journey re-ran the same negatives successfully. Report `9` is not a version or
predecessor of report `10`: its week and `report_key` differ. Report `10` was
used for B5.6 because the fixed week is `2026-10-26 -> 2026-11-02`; its
`report_key` `24f5c6a8...` matches customer report `7`/worker report `8`, and
its facts `[2,3]` are the fixed week's records.

The report-10 acceptance `verification.json` itself ended `success:false` at
`15:19:12.338Z` on the old assertion "the designer report facts do not contain
the internal designer record": the driver had selected worker-authored record
`4`, which the existing audit-125 rule excludes from designer facts. This is a
driver selection/assertion failure, not a designer receiver block; the report
`10` rows were real and delivered. The journey continuation re-read the same
report with executor-authored record `2`.

Provider preflight: all three B5.6 runs recorded `provider.copied:false`,
`platformCopied:false` and `reused:true`. No MAIN fallback ran and no provider
or platform row was written. The driver now only reads the B
`llm-settings-override` provider and platform override, and fails with a clear
error before binding/plan/agent mutation or report enqueue when either is
missing or disabled; the separate B environment step owns provider/platform
initialization.

Journey (the same report, `journey.json`, 20/20 checks): the designer staff token
lists binding `3`, opens the weekly detail (`composed`/`delivered`) with records
`2`/`3`, opens the record `2` photo (media `2`) and record `3`, and observes the
real read receipt already written at `2026-11-11T15:28:01.585Z` (its
acknowledge call returns the same `read_at`; the receipt predates the journey
start). Exit/re-entry returns the same report/records/photo. The customer list
contains only binding `1` and the worker list only binding `2`; both get 403/404
on the designer report and record, and a cross-enterprise designer token/status
read is rejected (403/401).
`customer_access=false` does not block the designer detail/status; it was
restored and read back. A designer without project membership and a
`construction_staff` account used as the designer receiver are rejected with
`designer_receiver_unavailable`; an observer executor is rejected with
`construction_forbidden`; the unfinished week `2026-11-09`→`2026-11-16` and a
weekly event on the daily template are rejected before business writes; all
negative cases left every counter unchanged. A real
`ConstructionService.execute('member', …)` revocation wrote audit `127`
(`active=false`): the list hid binding `3`, detail/record/media returned
404/403, and the status reader reported `unavailable`/`access_revoked`/
`designer_membership_revoked`. Restoration wrote audit `128` (`active=true`); the
old report stays `unavailable`/`source_unavailable`/`source_project_revoked`
under the existing historical rule, while customer report `7` stays available.
The whole journey added no report, delivery, message, job, run or model call
(`7/7/19/19/10/10/10` before and after).

Stable DevTools native evidence (main-workspace `miniprogram` checkout, same
appId, no window replaced; runtime-only API rewrite to the worktree B server on
`127.0.0.1:3018`): the designer entry auto-opened binding `3` and the weekly card
`10月26日 · 施工周报` (period `10月26日 00:00—11月2日 00:00`, `delivered`);
detail showed report `10`/r1 `composed` with records `2`/`3`; both originals
opened by real taps (record `2` v3 with media `2`, path key `2_3_2`; record `3`
v3 without a photo); opening the detail acknowledged the delivery; exit/re-entry
returned the same card and read state (positive 7/7, screenshots). The designer
first-entry guide was skipped by its normal `跳过` action before the chat route;
that is a user action, not a data/audit change.

Actual timeline of the report-10 evidence (from `journey.json`, the two native
JSON files and audits `127`/`128`): the journey started at `15:30:19.858Z`;
its positive hold opened at `15:32:03.350Z`; native positive 7/7 ran
`15:32:10.113Z`–`15:33:02.660Z` and released the marker at `15:33:02.916Z`;
audit `127` (`active=false`) was written at `15:33:02.936Z`; the negative API
reads ran at `15:33:03.044Z` (binding hidden, detail/record `404`, status
`unavailable`/`designer_membership_revoked`); the negative-UI hold opened at
`15:33:03.062Z` and was released at `15:33:19.179Z`; audit `128`
(`active=true`) restored the member at `15:33:19.191Z`; the journey read the
post-restore historical state at `15:33:19.240Z` and finished at
`15:33:19.325Z`. The native unavailable-state automation
(`native-designer-negative.json`) started at `15:33:47.528Z`, i.e. after the
restore. It showed the report only as an unavailable card, kept the detail
closed and returned no record/photo (negative 4/4), but it proves the
post-restore historical unavailability (`source_unavailable`), not the
revoked-member native state. No native artifact exists inside the
`15:33:03Z`–`15:33:19Z` revocation window, so the revocation-phase native UI
remains unverified (Limited); the two `designer-revoked-*.png` screenshots
belong to the post-restore phase.

Evidence:
`admin/tmp/b5-6-period-report-runs/b5-6-designer-20261111151733062/verification.json`
(fresh/replay/model), `journey.json` (API/isolation/revocation/restoration) and
`native-ui/native-designer-positive.json`, `native-designer-negative.json` plus
7 screenshots. The fixture script is
`admin/scripts/native-workflow-designer-fixture.ts` and the drivers are
`admin/scripts/native-workflow-designer-report-acceptance.ts` and
`admin/tmp/b5-6-designer-journey.ts`.

Tests: the documented offline command now lists 27 files and runs 310 tests,
all 310 pass with 0 fail. The new `acceptance-provider.test.ts` is 6/6 (missing
or disabled B provider/platform fails before any copy or enqueue, and an
enabled pair is reused). `staff-receiver.test.ts` is 7/7 (workers, designers,
role/membership rejection and no-write assertions), `period-cli.test.ts` is
17/17 (including `--designer-id` and unknown receiver kinds),
`period-report-ports.test.ts` is 34/34 (designer scope/save/delivery and
single-project reuse), `period-report-entry.test.ts` is 7/7 (designer binding
and unknown receiver rejection before writes), and the status suite covers
designer receipts/bindings/availability plus the explicit unknown-receiver
reason. `npm run build` still prints "Compiled successfully" and then exits 1 at
the pre-existing `scripts/fastgpt/setup-unified.mts:113:75` type error; the
generated `source-manifest.json` change was reverted. Scope stays one
project/one designer; boss and multi-project receivers, the scheduler, canvas,
Worker changes and shared migrations remain out of scope. B5.5 worker report
`8`, audits `125`/`126` and their acceptance limits are unchanged and are not
replaced by this designer evidence. The worker positive native 8/8 was obtained
under a temporarily suspended audit `125`; this round neither re-ran nor
reclassified it. The current read-back confirms the current rows only and does
not prove the audit table was never different at earlier times; the worker's
"complete continuous lifecycle not verified" limitation still stands.

## B5.7 single-project boss weekly report

The same weekly adapter now serves the enterprise boss. A boss report stays one
project, one boss and one finished Shanghai week; no scheduler, Worker, message
channel, Mini Program source or shared migration is added.

- Receiver/scope contract: `PeriodReportScope.receiverKind` is
  `customer`/`worker`/`designer`/`boss`. The boss is the existing enterprise
  owner contract, not a project staff member: `live/boss-receiver.ts` requires a
  same-enterprise active `enterprise_admin` account without a required password
  change whose `construction_followup_staff_access` role is `owner`. It deliberately does
  not query `construction_members` and never reads `customer_access`. A
  `construction_staff`/designer account, a disabled account or a different
  enterprise is rejected with `boss_receiver_unavailable` before the binding
  write. `--admin-id` stays the management executor; receiving a report grants
  no management permission.
- Binding: the boss uses the shared enterprise-scoped binding
  (`principal_key=admin:<id>`, `audience=boss`, `project_id NULL`,
  `scope_key=enterprise`). The customer keeps binding `1`, the worker binding
  `2` and the designer binding `3`; the boss binding is `4` in the B fixture.
- Facts/isolation: the plan must still be exactly `project_ids=[projectId]`
  and the facts run freezes that single project. A boss may own multiple
  enterprise projects under the existing read rule, but this B run, its facts
  snapshot, receipt and source reads are limited to the one target project.
  Reuse requires binding + conversation generation + kind/period +
  `policy_snapshot.scope.project_ids`; a `report_key` shared with the customer/
  worker/designer reports never selects another role's report.
- CLI: `--receiver-kind boss` and `--boss-id`; a worker/designer receiver
  rejects `--boss-id`, and a boss receiver rejects `--worker-id`/
  `--designer-id` (`boss_id_forbidden`, `worker_id_forbidden`,
  `designer_id_forbidden`). Unknown receiver types and valueless flags are
  rejected before the database target is resolved.
- Ports/status: `read.receiver_scope` returns `enterprise_boss` with
  `bossAdminId`; the save receipt records `receiverKind=boss`,
  `receiverAdminId` and `projectScope=[projectId]`; `deliver.inapp` matches that
  exact object. The status reader reports `receiverKind=boss`, requires exactly
  one frozen project, uses the boss binding plus current owner access as its
  proof (no `customer_access`), and reports a revoked account as
  `unavailable`/`access_revoked`/`boss_access_revoked` rather than a project
  membership revocation. The Admin live tab shows `boss <id>`.

Recorded B evidence (2026-11-11, isolated B database, week 2026-10-26 →
2026-11-02, enterprise `1454`, project `1454000004`): the boss fixture seeded
marked `enterprise_admin` `1454000013` (`b5-7-boss-1454`, base user
`1454000013` `b5-7-boss-user-1454`) deliberately without a project member row.
Fresh generation created report `11`/revision `1`/facts run `20`/body run `21`/
message `126` at conversation `1454000010`, delivery `delivered`. Its
`report_key` equals customer report `7`, worker report `8` and designer report
`10` because the existing formula has no projectId; binding `4` plus
`policy_snapshot.scope.project_ids=['1454000004']` keep them distinct. Facts
records are `[2,3]`, both version `3`; record `2` carries photo media `2`.
Fresh counters moved reports/deliveries/messages `10/10/10`→`11/11/11` and
jobs/runs `19/19`→`21/21`, attempts/usage `7/7`→`8/8`. The body used exactly
one succeeded `llm-settings-override` attempt (`accepted:true`), observed
`1179` input + `1881` output tokens, zero FastGPT. The same-period replay with
a new workflow runId reused report `11`/r1/facts run `20` and the same delivery
with every counter unchanged.

The boss staff token lists only binding `4` (`企业工地简报`) and opens report
`11` (`composed`/`delivered`) with project `1454000004`, records `2`/`3` and the
record `2` photo. Its first acknowledge wrote `read_at=16:19:11.757Z`; a repeat
acknowledge returned the same timestamp instead of rewriting it. Exit/re-entry
returned the same report/record/photo. The customer, worker, designer and an
unrelated account do not list binding `4` and get 403/404 on the report/record;
a cross-enterprise boss token and a status read for another enterprise are
rejected. `customer_access=false` did not gate the boss detail/status and was
restored and read back. A `construction_staff` account and a non-owner account
used as the boss receiver are rejected with `boss_receiver_unavailable`; an
observer executor is `construction_forbidden`; an unfinished week and a weekly
event on the daily template are rejected before business writes with unchanged
counters.

Real account loss used the existing staff account contract
(`AdminUserRepository.update`, the repository behind `PUT /api/staff/[id]`),
not a member or customer_access toggle: `admin_users.status='disabled'` at
`16:25:29.581Z` wrote no construction audit and left the management executor
active. The boss list returned 401 and detail/record/media 401; the status
reader returned `unavailable`/`access_revoked`/`boss_access_revoked`. The native
entry showed no boss binding, report, detail or original after entry and
re-entry. Restoring `status='active'` at `16:26:40.383Z` kept the same
binding/conversation generation and source, so the same account read report
`11` and its original again, and the status reader returned
`available`/`completed`. The whole journey added no report, delivery, message,
job, run or model call (`8/8/21/21/11/11/11` before and after).

Native evidence (main-workspace `miniprogram` checkout, same appId, runtime-only
API rewrite to the worktree B server on `127.0.0.1:3018`): positive 4/4 — the
staff entry auto-opened binding `4` (`企业工地简报`), the `企业周报` card
`10月26日—11月1日`, the detail (`10月26日 · 施工周报`, records `2`/`3` and the
record `2` original with media `2`) and the same card after exit/re-entry;
negative 2/2 — after the account was disabled the entry listed no binding/
report and kept detail/original cleared after re-entry; restored native 1/1 —
the same card returned after the account was restored.

The main acceptance `verification.json` ended with 52/54 checks passing. Its only
two failures are driver-side false negatives: duplicate `--period-start/
--period-end` flags made the "unfinished week" case reuse the fixed week, and
the "wrong template" case asked for a daily revision `1` that did not exist.
Both were preserved. `negative-continuation.json` re-ran only those two
corrected cases on the same report/store: `period_not_ended` and
`live_event_type_unsupported` both exited `1` with every business counter
unchanged (`3/3`).

Evidence: `admin/tmp/b5-7-period-report-runs/b5-7-boss-20261111161739690/`
(`verification.json`, `negative-continuation.json`, `native-ui/native-boss-
positive.json`, `native-boss-negative.json`, `native-boss-restored.json` and
seven screenshots). The fixture script is
`admin/scripts/native-workflow-boss-fixture.ts` and the driver is
`admin/scripts/native-workflow-boss-report-acceptance.ts`.

Tests: the documented offline command now lists 28 files and runs 338 tests,
all 338 pass with 0 fail. `boss-receiver.test.ts` is 7/7 (owner access, missing/
disabled/non-owner/platform-role rejection and no member/customer_access read),
`period-cli.test.ts` is 18/18 (including `--boss-id` and cross-flag rejection),
`period-report-ports.test.ts` is 40/40 (boss scope/save/delivery, platform-role
rejection and cross-scope delivery rejection), `period-report-entry.test.ts` is
11/11 (boss binding, platform-role and non-owner rejection before writes), and
the status suite covers boss receipts/bindings/availability plus the explicit
`boss_access_revoked` reason.
`npm run build` still prints "Compiled successfully" and then exits 1 at the
pre-existing `scripts/fastgpt/setup-unified.mts:113:75` type error.

Scope stays one project/one boss; boss multi-project aggregation, scheduling
expansion and new UI capabilities remain out of scope. The worker's complete
continuous lifecycle and the designer revocation-window native UI remain
unverified and are not replaced by this boss evidence. B5.5/B5.6 reports,
audits and their acceptance limits are unchanged.

### B5.7 closeout: boss identity scope and account restore

The native boss receiver is now limited to the enterprise's own active
`enterprise_admin`, not any active account whose
`construction_followup_staff_access` returns `owner`. Platform `admin` and
`super_admin` accounts may still be owners under the shared permission
function, but they may only join a follow-up themselves; the native boss path
rejects them with `boss_receiver_unavailable` before `ensureFollowupBinding()`
or any enqueue. `period-report-ports.ts` repeats the same `enterprise_admin`
identity check (SQL predicate plus an explicit role check) in both the scope
read and the write transaction, so a direct ports/store call cannot bind or
queue a platform owner account. The shared owner permission function, the
existing platform self-join service and the existing platform report read/
restore semantics are unchanged.

The acceptance account-status flow now registers the restoration
responsibility before the mutation attempt. `live/acceptance-state.ts` exposes
`applyAccountStatus()` and `accountStatusRestorationStep()` for the real driver:
a committed `status='disabled'` whose independent read-back fails is still
restored in `finally`, and the responsibility is cleared only after a
confirmed read-back of the original status. A failed restore remains an error
in the `runRestorations` outcome, does not stop later cleanup steps, and makes
the run non-successful. The driver uses the captured `bossStatusBefore` via the
responsibility object rather than setting a late boolean flag.

Offline tests are 338/338 across the documented 28 files. The new cases cover
`admin`/`super_admin` rejection with owner access, no conversation/binding/
participant writes, no live run or port execution from the entry, the ports
store-enqueue boundary, and the account restore control flow with committed-
update/read-back failure, successful restore, failed restore, and stale
read-back mismatch. No database or model call was made for this closeout;
report `11`/r1 and all existing evidence remain unchanged.

## B5.8 one-project four-receiver joint weekly report

The B5.8 host entry runs one project, one finished week and exactly four
host-fixed receivers in one action: the project customer plus one worker, one
designer and one enterprise boss. It is a thin coordinator
(`live/period-report-batch.ts`) around the existing single-receiver entry and
ports; it does not compose a shared body, copy a report, discover receivers,
change the Worker, add a queue or add a shared migration.

- Receiver identity is explicit. The customer is the existing project customer
  binding (`ensureFollowupBinding` is never auto-discovered here); the worker,
  designer and boss are host admin ids. `live/period-cli.ts`
  `parseBatchReceiverTargets()` requires all three admin id flags, rejects
  `--receiver-kind`, and runs before the database target is resolved. Export
  discovery (`discoverFollowups`) is never called by this path, so the
  management executor and any other enterprise owner cannot create extra
  bindings. The boss receiver must differ from the management executor.
- One action fixes the enterprise, one project, the period, one selected
  published revision/digest/node versions and one event before any sub-run.
  The coordinator checks the trusted period end, the shared published target
  and (for a new request) the executor write permission plus the single report
  plan before the first business write. The plan must be enabled, stage off,
  both legacy schedules parked, `project_ids=[projectId]` and the same
  `audiences` row must allow all four receivers. The batch never rewrites the
  plan between receivers.
- `live/period-report-batch-store.ts` persists the B-owned host manifest under
  `NATIVE_WORKFLOW_BATCH_DIR` (default `admin/tmp/native-workflow-batches`) with
  the same same-directory temporary file, atomic rename and serial lock as the
  run store. It records the request identity, four reserved sub-runIds and the
  latest entry observations. `create` is exclusive; `update` rejects a
  different enterprise/project/period/target/revision with
  `period_report_batch_conflict` (409).
- Each receiver calls `runPeriodReportEntry()` with its own
  `createPeriodReportPorts({ actor, receiver })`, the same selected published
  object and event, and a deterministic sub-runId
  `<requestId>-<receiver>`. The existing binding, conversation generation,
  kind/period, frozen single-project facts scope and `enqueueReport` dedupe
  remain the business idempotency; the four reports/messages/read receipts are
  independent and the customer facts never contain internal records.
- Dispatch continues when a receiver already has a real save receipt and the
  raw run is only `delivery_not_confirmed`; that is asynchronous progress and
  is never rewritten as delivered. A receiver-unavailable error keeps its
  reason and does not borrow another binding. A blocking failure or unknown
  stops later receivers, keeps earlier receipts and marks unexecuted entries
  `not_started`. The batch status is `completed` only when all four observed
  business states are `completed`.
- Status observation reuses `readPeriodReportRunStatus()`. It never executes
  ports, re-enqueues, composes or delivers. A repeated request id only
  authorizes and observes the existing manifest; a new request id for the same
  period/targets reuses the existing reports/deliveries without new tasks,
  messages or provider calls.
- CLI: `scripts/native-workflow-period-report-batch.ts`. One call:

```powershell
npx tsx scripts/native-workflow-period-report-batch.ts --development --ensure-published `
  --admin-id 1454000001 --project-id 1454000004 `
  --worker-id 1454000008 --designer-id 1454000011 --boss-id 1454000013 `
  --period-kind weekly --period-start 2026-10-19 --period-end 2026-10-26 `
  --request-id b5-8-joint-<stamp>
```

  `--show-batch <requestId>` reads the manifest only. The acceptance driver is
  `scripts/native-workflow-joint-report-acceptance.ts`; it creates two marked
  raw records (customer-visible and internal) only when the fixed week is
  fresh, reads the original XiaoK entry for all four roles, records each role's
  own delivery read receipt and proves re-entry, same-request observation and
  new-request reuse. `--resume <acceptanceId>` continues a partially completed
  acceptance without changing the fixed week or creating a second round.

Offline tests: `period-report-batch.test.ts` covers the pre-write period,
published-target and preflight rejections; one version/event for four
receivers; distinct runIds/receipts; queued first receiver not stopping
dispatch; unavailable/failed/unknown not masked as success; same-request
observation; conflict on project/period/target/version changes; new-request
reuse; receiver-shape rejection; read-only observation, the file store's
exclusive/identity behaviour and the crash-recovery cases described below.

B5.8 closeout (crash recovery and idempotent re-entry): the coordinator no
longer trusts the manifest's `executed` flag. Every re-entry first reads the
real run store by the four reserved sub-runIds, so a crash between the run's
exclusive create and the manifest write can no longer skip a real sub-run or
leave a request stuck at `not_started`. An existing run is classified from its
immutable trace and is never re-created, re-enqueued, re-composed, re-delivered
or sent to the provider again; the manifest entry is rebuilt from that trace and
then observed through `readPeriodReportRunStatus()`:

- no record: dispatch only when the manifest entry is still `not_started` with
  no reason, i.e. it provably never started;
- `running`: the record was created but no port began (the runner's first write
  precedes the start event). It stays `unknown` with reason
  `run_created_not_executed` and blocks later receivers; it is never retried;
- in-flight `unknown` (including any unknown operation): stays `unknown`;
- a real save receipt: `completed`, or `processing`/`delivery_pending` while
  delivery is still outstanding, which keeps waiting read-only;
- `failed`: stays `failed` and blocks later receivers;
- a manifest entry that recorded execution but whose trace vanished, or an
  entry that failed before a run existed, is never re-dispatched;
- an existing run whose enterprise/project/event/target/receiver differs from
  the manifest is `period_report_batch_conflict` (409), never adopted.

One minimal cross-process execution lease was added to the existing batch store
(`requests/<requestId>.lease.json`, exclusive create plus expiry; the in-memory
store mirrors it). Only the lease owner recovers, dispatches and writes; a
concurrent call returns the stored manifest with `observedOnly:true` and starts
nothing. A crashed owner's lease is taken over only after ten minutes; until
then calls stay read-only, and `release` never frees another owner's lease. The
manifest identity (requestId, four sub-runIds, receivers, project, period,
published revision/digest/node versions) is still immutable, so a changed
identity still returns `period_report_batch_conflict`.

The batch tests now cover a sub-run created before the manifest update; a
recovered save with a pending delivery; a created-but-unexecuted run; recovered
failed and unknown runs; a truly missing receiver; repeat re-entry; two
concurrent recoveries (exactly one dispatcher); a conflicting identity on a
crashed manifest; and the file store's cross-instance lease/TTL. Every case
asserts synthetic coordinator counters (run creates, enqueue/save, delivery and
message counts; facts jobs, body jobs, provider attempts and usage stay 0 in the
offline fakes) instead of only a final state string. No real database or native
mini-program run was repeated this round: the four-receiver evidence below
(reports `12`-`15`, facts runs `22`-`25`, body runs `26`-`29`, messages
`129`-`132`, bindings `1`-`4`) was not regenerated, and the historical Limited
items (the worker's full continuous lifecycle and the designer's native UI
during the revocation window) remain unverified.

Recorded B evidence (2026-11-11, isolated B database, week 2026-10-19 →
2026-10-26, enterprise `1454`, project `1454000004`): the week had no report for
any of the four targets before the action. One host call created report `12`
(customer), `13` (worker), `14` (designer) and `15` (boss), all revision `1`,
facts runs `22`-`25`, body runs `26`-`29`, messages `129`-`132` on bindings
`1`-`4` and conversations `1454000007`-`1454000010`. All four receipts share
`report_key` `7c5c5344…`; the binding and
`policy_snapshot.scope.project_ids=['1454000004']` keep them independent. The
two marked records are record `6` (customer-visible, photo `6`) and record `7`
(internal, photo `7`). The existing facts service's expected set is `[6]` for
all four receivers: record `7` is worker-authored and the pre-existing audit-125
revocation rule excludes it from every non-customer facts set. The frozen facts
match that oracle, the customer cannot read record `7` directly (403/404), and
this is the existing rule, not a B5.8 receiver failure.

Counters moved reports/jobs/runs/attempts/usage/deliveries/messages
`11/21/21/8/8/11/11` → `15/29/29/12/12/15/15`. Each body run (`26`-`29`) has one
succeeded accepted `llm-settings-override` attempt (attempts `9`-`12`) with
observed usage `1112+76`, `1092+83`, `1093+78` and `1092+69` tokens; zero
FastGPT. The same request id re-entry returned all four `completed` with
refreshed delivery receipts `129`-`132` and no second round; a new request for
the same period/targets reused the same reports/versions/facts runs/deliveries
with `reused:true` and no new rows or model calls; repeated observation left
every counter unchanged. Each role's original XiaoK API read returned its own
binding/report/record/photo, acknowledgements wrote `read_at`
`17:54:40.816Z` (customer), `17:54:41.510Z` (worker), `17:54:41.998Z`
(designer) and `17:54:42.142Z` (boss), repeat acknowledgements did not rewrite
them, exit/re-entry returned the same report/records/photo, and every role got
403/404 on the other receivers' binding/report/record. Restoration reported
worker, customer_access, report_plan and agent_settings restored; the four
reports and two marked records are retained. The acceptance's first pass stopped
after the one host call on a driver event-id assertion; it was continued with
`--resume <acceptanceId>` on the same fixed week, without changing the period,
creating a second batch round or re-sampling model calls. The first-attempt
verification is `verification.first-attempt.json`. Evidence:
`admin/tmp/b5-8-period-report-runs/b5-8-joint-20261111174324393/verification.json`.

Native Stable DevTools evidence (main-workspace `miniprogram` checkout, same
appId, no window replaced; runtime-only API rewrite to `127.0.0.1:3018`):
20/20 checks. The customer opened the private followup through the original
lead chat, saw the weekly card `10月19日 · 施工周报` (period
`10月19日 00:00—10月26日 00:00`, delivered, `readAt`
`17:54:40.816767Z`), opened report `12`/r1, the composed body, record `6` v3
and photo `6` (path key `6_3_6`), and re-entry returned the same card. Worker
`13`/r1 (`readAt 17:54:41.510458Z`), designer `14`/r1 (`17:54:41.99844Z`) and
boss `15`/r1 (`17:54:42.142301Z`) each opened their own card, detail, record
`6`/photo `6` and the same read state after re-entry. The 16 screenshots and
`native-joint.json` are under `.../native-ui/`. The native window introduced no
report/message/job/run/attempt/usage row and did not rewrite any `readAt`.

## B5.9 scheduled four-receiver weekly report and follow-up

B5.9 upgrades the B5.8 four-receiver batch from a manual CLI action to a
bounded weekly scheduler. It does not create a second report engine, Worker,
queue or timer:

- `live/period-report-schedule.ts` is the unified entry
  `runScheduledPeriodReportDispatch()`. It resolves the latest finished
  Shanghai Monday-to-Monday week (right-open end, trusted server clock), creates
  or reuses one schedule run per enterprise, discovers eligible projects,
  dispatches one project at a time through the existing
  `runPeriodReportBatch()`, and observes the existing report/body/delivery/read
  state through `readPeriodReportRunStatus()`. The `periodStart` option is an
  explicit acceptance/replay override; the scheduler never picks a future week.
- The scheduler runs inside the existing assistant-worker endpoint
  (`/api/internal/assistant/jobs/run`) before `advanceConstructionReports()`.
  It is loaded only when `NATIVE_WORKFLOW_SCHEDULE_ENABLED=1` and at least one
  id in `NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS` is set. A schedule failure is
  isolated and never blocks the existing assistant/report jobs. No new Worker,
  interval or cron system exists.
- Discovery reuses the existing rules instead of inventing status fields:
  enterprise `active`, assistant enabled, `construction_report_settings.enabled`,
  `stage_enabled=false`, the configured `audiences` include all four, project
  `active`, stage not `completion`/`move_in`, lead not archived, the existing
  `project_ids`/`stage_keys` filters, and at least one real period signal:
  a published site record, a stage event, or an open `construction.site.issue.*`
  item. Archived/paused/terminal projects are excluded and counted. Candidate
  and per-enterprise limits reuse the existing 20-project discovery bound; the
  scheduler processes at most 5 projects per round by default
  (`NATIVE_WORKFLOW_SCHEDULE_MAX_PROJECTS`).
- Receivers are resolved from the current server contracts:
  - customer: the lead's current `customer_user_id` plus `customer_access`,
    through the existing `ensureFollowupBinding` customer rule;
  - worker: active `construction_staff` with an active non-observer project
    member row and current `construction_followup_staff_access`;
  - designer: active `designer` with the same membership/follow-up checks;
  - boss: active `enterprise_admin` with the current owner follow-up role; no
    project member row is required;
  - executor: a real owner/manager project writer, deliberately separate from
    the boss receiver.
  Existing enabled enterprise-scoped bindings disambiguate multiple staff or
  owner candidates. A missing, duplicate, ambiguous or revoked receiver is
  recorded with its specific reason; the scheduler never borrows another
  binding or widens authorization. A retryable pre-dispatch gap re-reads the
  current account/member/project/source permission on every recheck: first at
  the fast interval (three rounds by default), then at a slow six-hour
  interval, bounded to seven days after the period end. A fix before any batch
  manifest exists dispatches under the same deterministic request id.
  Once a manifest exists the receiver ids, project, period and published
  revision are frozen: a later identity change is refused under the original
  batch contract instead of replacing the receiver.
- One project + one period has one deterministic request id
  (`schedule-<enterprise>-<project>-weekly-<periodStart>`) and one batch
  manifest. The B5.8 batch store, its cross-process lease, deterministic
  sub-runIds, real run-store recovery, published-target precheck and four
  independent ports are reused unchanged. A repeated tick reuses the existing
  request; a completed batch never creates a second report, task, message or
  provider call; `failed` keeps its reason; `unknown` is never re-dispatched;
  a blocking failure stops only that project, not other projects.
- The weekly execution gate has two independent halves (B5.9.1):
  - the latest finished Shanghai Monday-to-Monday week is mapped with
    `weeklyExecutionAt()` to the first configured `weekly_day`/`weekly_time`
    instant at or after its Monday 00:00 end. An ended week alone is not an
    execution time; before that instant the tick only performs read-only
    observation and creates no run, batch or business row;
  - the existing `construction_report_settings.next_weekly_at` must also be
    due. If the configured instant passed but the stored slot is already in
    the future, the legacy weekly worker or an earlier B tick consumed this
    cycle and B must not generate a second time.
  Only after both checks does one conditional `UPDATE ... WHERE
  next_weekly_at <= now` claim the enterprise slot. The settings row lock plus
  that condition make the claim exactly-once across concurrent Worker ticks.
  `nextWeeklyClaimAt()` advances past the next legacy occurrence that would
  still process the same week, so the old weekly scheduler cannot create a
  parallel/empty weekly report after B takes the week. A due daily schedule
  remains independent and is allowed in `weekly_claimed` mode; stage reports
  must stay off.
- The claim receipt (`weeklyClaim`) is stored once in the host run record and
  is immutable. A run that already owns its claim continues dispatch,
  reclaim and observation even after `next_weekly_at` moved to the next week;
  a bounded pass also continues older claimed runs with pending work. An
  explicit old-period replay never claims and never writes the current
  `next_weekly_at`.
- `live/period-report-schedule-store.ts` is host schedule state under
  `NATIVE_WORKFLOW_SCHEDULE_DIR` (default
  `admin/tmp/native-workflow-schedules`): one run per enterprise/period,
  `control/<enterpriseId>.json` for pause/resume, and
  `ledger/<enterpriseId>/<projectId>.json` for existing issue references. The
  same-directory temporary file, atomic rename and serial-lock convention as
  the run/batch stores is used; `create` is exclusive and `update` refuses a
  different enterprise/period/published identity. A concurrent creator's
  `startedAt`/published revision is adopted, not treated as a conflict.
- Continuous follow-up separates business states that must never be conflated:
  - facts/body/delivery progress comes from the existing status reader; an
    honest `delivery_not_confirmed` stays processing and is never rewritten as
    delivered;
  - delivered vs read vs unread is recorded per receiver; `readAt` is read-only
    and never overwritten; unread is not a rejection or a business exception;
    a completed report keeps a bounded 7-day read-observation window;
  - existing `construction.site.issue.opened/progress/lifecycle` events are
    projected into the ledger by their original issue id (record id, status,
    owner, last result, first/last period and the period list). The next week
    links the same item instead of creating a duplicate; closed/cancelled/
    resolved items are not carried as open;
  - reminders reuse the existing in-app message channel and a
    `construction.report.followup.v1` outbox row as the idempotency key. Only
    currently authorized existing enterprise-scoped worker/designer/boss
    bindings receive them; the customer, SMS, email and external WeChat are
    never used. `awaiting_review` goes to the designer, `implemented`/`resolved`
    and unassigned/invalidated/carried-over items go to the boss, and an
    assigned worker/designer owner receives it when that receiver is available.
    Reminder text references the real issue/record/state only and never creates
    a confirmed construction defect from model prose.
- Run records expose the enterprise, project, period, four receivers,
  published revision, batch request id, per-receiver report id/facts run id,
  delivery/message id, current state, last observation, failure reason and the
  next allowed observation/retry time. Counts separate due/completed/
  processing/waiting-delivery/needs-attention/skipped/failed/unknown. The run
  record is not a replacement for `construction_reports` or the real receipts.
- Operations:
  - `GET /api/native-workflow/schedule` (tenant-scoped, platform admin) returns
    the latest/selected run, control state and counts; it is read-only and
    never acquires a lease.
  - `POST /api/native-workflow/schedule` with `{action:'pause'|'resume'}` sets
    the tenant pause flag; the scheduler re-reads it before each project.
    `{action:'cancel', periodStart?}` cancels one finished week for that tenant
    only (default: the latest finished Shanghai week); it is terminal for that
    period and never touches other weeks or tenants.
  - `scripts/native-workflow-period-report-schedule.ts` is the one-shot CLI
    (`--show-latest`, `--show-run`, `--list`, `--pause`, `--resume`, `--cancel`,
    `--mode`, `--period-start`, `--ensure-published`). It rejects an
    unended/future week before publishing, resolving the DB target or
    connecting.
- No database migration is required. The only business settings write is the
  existing `next_weekly_at` claim. The schedule/control/ledger files are B host
  state, not shared tables.

### B5.6 multi-tenant reliability and recovery

B5.6 hardens the same scheduler; it adds no second queue, timer, Worker,
migration or business table.

- **Tenant isolation.** Every control, cancellation, lease, run file and trace
  is keyed by the allow-listed enterprise. `pause`/`cancel` for one tenant never
  changes another tenant's control or run, and one tenant's store, claim,
  discovery, batch or observation failure is caught per tenant in the tick loop
  and reported as that tenant's own error. A record loaded by a deterministic
  run id whose `enterpriseId` does not match the tick is refused with
  `period_report_schedule_forbidden` and is never advanced or rewritten.
- **Weekly lifecycle.** `cancelled` and `expired` are explicit terminal run
  states. Cancellation is checked before the weekly claim and again before each
  project dispatch, so a cancelled period neither claims `next_weekly_at` nor
  creates a batch, and an in-flight tick stops the remaining projects. A run
  with unfinished work whose 7-day recovery/read window has closed is finalized
  as `expired` instead of staying `dispatching`/`observing` forever; no active
  state is polled past that window. Cross-week, cross-month and year-boundary
  weeks stay Monday-to-Monday Shanghai time (UTC+8, no DST), and a new week
  always gets a new run id and request ids, so the previous week's run file
  keeps its claim, period, receivers and requests.
- **Idempotency and concurrency.** The project/period job id is the existing
  deterministic batch request id; the run id is the deterministic
  enterprise/period id. The cross-process lease with a TTL admits only one
  tick per run; a crashed owner's lease is taken over after the TTL and the
  batch is resumed, not duplicated. `dispatchAttempts` counts real dispatch
  calls while `recheckCount` counts bounded discovery retries, and a frozen
  manifest is re-observed instead of re-executed. `failed`/`unknown` projects
  are never auto-replayed.
- **Failure recovery.** Recheck errors are classified: transient permission or
  database conflicts keep the bounded attention retry, while permanent codes
  (`published_changed`, `construction_not_found`, conflicting/receiver-invalid
  identities) stop the project on the first failure. Every failure keeps its
  original receiver/batch/issue evidence and an audit entry; cancellation and
  expiry also keep the already reported evidence.
- **Observability.** `live/period-report-schedule-observability.ts` derives one
  redacted run trace and one job trace per project/period (`tenantId`,
  `scheduleId`, `jobId`, period, `plannedAt`, `dispatchedAt`, `observedAt`,
  `workerId`, state, `attempts`, `retryCount`, `failureCode`). The runtime emits
  one bounded JSON line per tick and the tick summary, the read API/CLI and the
  run `audit` carry the same identities. Project names, issue text, receiver
  admin ids and model output are never included.

Offline tests: `period-report-schedule.test.ts` covers Shanghai week
resolution, unended-period rejection, project selection/skip reasons, missing/
ambiguous receivers, recheck recovery after the fast budget, frozen-batch
recovery, multi-project request isolation, one failure not stopping another
project, repeated ticks, unknown/delivery waiting, delivered vs read,
cross-week issue carry-over, closed issues, pause/resume, bounded rounds, the
read-only query, the Monday 00:00 boundary, before/at/after the configured
weekly time, an already-consumed slot, a claimed run surviving a moved
`next_weekly_at`, a replay that never claims, and the `weekly_day` execution
mapping; `period-report-schedule-store.test.ts` covers exclusive
create/identity, concurrent adoption, immutable claim receipts, control/ledger
and the lease TTL; `period-report-schedule-ports.test.ts` covers plan scope,
`weekly_claimed` legacy handling and the weekly claim boundary. B5.6 adds
multi-tenant concurrent dispatch, one-tenant batch failure isolation, a
same-window concurrent trigger, crashed-lease takeover after TTL, crash retry
over a frozen batch, cross-month/year weeks, cancellation, permanent-error
stop, window expiry, previous-week preservation, a foreign-tenant run refusal,
and redacted trace fields; `period-report-schedule-store.test.ts` also covers
per-tenant cancellation across pause/resume and a legacy control file without
the field. The documented
offline command remains 404/404 (B5.9.2 fixed a live-only SQL shape bug and
extended the acceptance driver without adding offline cases).

B5.9.2 real B-isolated acceptance (2026-11-12): the Docker Desktop GUI service
still cannot be started from the non-elevated session, but the existing Docker
engine was reachable through
`npipe:////./pipe/dockerDesktopLinuxEngine`. The existing
`sfp-b4-native-postgres` container had exited 255 when the WSL VM restarted;
it was started unchanged (no container/volume deletion or rebuild) and
PostgreSQL completed crash recovery. `smart_floor_planner`, roles `sfp_app` /
`sfp_owner`, enterprise `[B4] 微云原生编排测试` (`1454`) and project
`[B4] 水路阶段测试项目` (`1454000004`) were verified before any write.

The first live failure was a real adapter bug: `discoverProjectManagers` used
`select distinct a.id::text ... order by a.id`, which PostgreSQL rejects with
`42P10` (ORDER BY expression not in the select list). The fix is
`select distinct on (a.id) ... order by a.id`. This path had only been exercised
with fakes before; a direct read-only query against the B database reproduced
the failure and the fixed query returned manager `1454000007`.

Acceptance period `2026-11-02`→`2026-11-09` (latest finished Shanghai week),
enterprise `1454`, project `1454000004`:

- before the configured time: no schedule run, batch, report, job, delivery or
  message;
- paused at the configured time: no claim and no dispatch;
- due: one atomic claim, one discovered project, one manifest with four
  receivers, three new reports (`16` customer, `17` worker, `18` boss) and the
  existing designer report `9` reused. Facts runs `30`-`32`; delivery ids
  `251`/`253`/`255`; messages `133`/`134`/`135`; designer delivery `224` /
  message `124`;
- the first body attempt created runs `33`-`35` and failed before provider
  dispatch with `model_unavailable` because the B app process was started
  without the provider encryption/JWT environment. No provider attempt or usage
  row was created; that failure evidence is preserved. Loading the existing
  `.env.local` (with the B `DATABASE_URL` override) and re-enqueuing bodies
  created runs `36`-`38`, attempts `13`-`15` (`llm-settings-override`,
  `qwen3.7-flash`, `succeeded`/`accepted:true`) and observed usage
  `1167+61`, `1201+72`, `1199+84` tokens;
- counters moved from `15/15/15/29/29/12/12` (reports/deliveries/report
  messages/jobs/runs/attempts/usage) to `18/18/18/35/35/12/12` after facts and
  the failed pre-dispatch bodies, then to `18/18/18/38/38/15/15` after the
  successful body retry. The final reuse acceptance ran with
  `18/18/18/38/38/15/15` before, after the due tick, after the repeated tick
  and at the end: `reportsAdded=0`, `deliveriesAdded=0`;
- repeated tick added no report/job/message/delivery/attempt/usage row; pause
  blocked dispatch and resume kept the claimed run observable; the read-only
  old-period replay did not claim, did not move `next_weekly_at` and added no
  report/delivery; the final acceptance passed 33/33 checks;
- the report plan restored exactly (`enabled=true`, daily `20:00`, weekly
  `08:00`, `weekly_day=1`, both next stamps `2099-01-01`, `project_ids`
  `[1454000004]`, empty `stage_keys`, all four audiences, `stage_enabled=false`,
  `stage_cursor=174`, `dispatch_epoch=1`, `inactive_policy=pause_inactive`);
  only the version counter advanced. `restore.json` is `restored:true`.

Four-end result: customer/worker/boss reports `16`/`17`/`18` are delivered and
unread (`readAt=null`); each has a distinct binding, conversation, report,
delivery and message. The customer facts contain only customer-visible record
`1`, not internal record `5`. The designer report `9` is delivered and was read
on 2026-11-11, but its current status is `unavailable` /
`source_project_revoked`: audit `127` deactivated the designer after report `9`
was generated and audit `128` restored membership; the existing contract
invalidates the saved sources and does not resurrect the old report. This is a
historical B5.6 condition, not a scheduler defect, and it means the four-end
viewability is not complete this round. The worker's continuous lifecycle and
the designer's native UI in the revocation window remain Limited.

Evidence:
`admin/tmp/b5-9-2-schedule-runs/b5-9-2-schedule-2026-11-12T0603-1879c19f/`
(first generation run, `success:false` on the pre-retry body failure, preserved;
`retry-verification.json` records the successful retry) and
`.../b5-9-2-schedule-2026-11-12T0619-e705c20f/verification.json` (final 33/33
reuse acceptance) plus `restore.json` in each run directory.

The acceptance driver command remains:

```powershell
$env:B4_LIVE_APP_DATABASE_URL='postgresql://sfp_app:...@127.0.0.1:55433/smart_floor_planner'
npx tsx scripts/native-workflow-schedule-acceptance.ts --development `
  --enterprise-id 1454 --project-id 1454000004 `
  --worker-id 1454000008 --designer-id 1454000011 --boss-id 1454000013 `
  --customer-user-id 1454000002 --wait-worker
```

It temporarily configures `weekly_day`/`weekly_time`/`next_weekly_at` and
checks before-time, paused, due, repeated-tick, pause/resume, read-only replay,
per-receiver identity, customer record scope and restore. Existing reports are
reused; the driver does not force a new report per receiver. Production
automatic scheduling remains off (`NATIVE_WORKFLOW_SCHEDULE_ENABLED=0` plus an
explicit `NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS` allowlist). Because the
designer end is not currently viewable, this round does not recommend enabling
production scheduling.

## B5.9.3 invalid historical report recovery

B5.9.2 correctly marked the designer report `9` as
`unavailable/source_project_revoked`, but the scheduler still reused it. The
root cause was in the save port: `findReportInTransaction()` treated a report
key + binding + conversation hit as reusable and never revalidated the saved
facts. The read path and delivery Worker already used
`projectReportFacts()`; the save path did not. Audit `127` deactivated designer
`1454000011` after report `9` was generated (`2026-11-11T15:14:01Z`), audit
`128` restored membership at `15:33:19Z`, and the existing contract
intentionally does not resurrect facts invalidated by a formal removal. The
old report therefore stayed unavailable while the scheduler kept its old
receipt.

The fix separates reuse from generation:

- `save.period_report` now calls `store.reuseReport()`. It revalidates the
  current receiver identity, binding status, conversation generation, report
  key, latest revision, single-project policy scope and the saved facts through
  `projectReportFacts()`. A still-valid report is reused with no new work.
- `access_revoked` (disabled binding, changed generation, lost membership or
  account) is refused. It is not regenerated because the current receiver has
  no safe destination.
- `source_unavailable` (a formal historical revocation or withdrawn original)
  is replaced through the existing correction contract:
  `store.regenerate()` calls `enqueueReportCorrection()` and adds a new
  immutable revision to the **same report**, reusing the same binding and
  conversation. The new facts run re-collects current authorized records and
  photos; it never copies the old facts, body or citations. The old revision,
  body, delivery, message, `readAt` and audits are not changed.
- The save receipt includes `regenerated`, `supersededReportId`,
  `supersededRevision` and `supersededReason`. The old report id is kept for
  audit; the current `reportId`/`revision` points at the new revision.
- `period-report-schedule.ts` records the old receiver under
  `receivers[].superseded` (run, report, revision, reason, delivery, message,
  `deliveredAt`, `readAt`, `replacedAt`) and starts exactly one recovery run
  with the deterministic id
  `schedule-<enterprise>-<project>-weekly-<period>-<kind>-recovery`. The frozen
  batch manifest stays untouched as historical evidence. A recovered receiver
  is observed through its recovery run; the project state is derived from the
  active receiver views, so the old `delivered` receipt can never make the
  project completed. A second recovery is not started after one has been
  recorded, and the same recovery run id is returned by the run store on a
  replay.
- A source-revoked receiver without a safe current contract, or a recovery that
  still ends `source_unavailable`, becomes `needs_attention` instead of
  `processing`, `delivered` or `completed`. No authorization is widened to make
  the recovery pass.

Offline coverage: `period-report-ports.test.ts` adds a source-revoked reuse
that must create a new revision and an access-revoked reuse that must not
regenerate; `period-report-schedule.test.ts` adds a source-revoked designer
that gets one recovery run, keeps the old report/revision/read receipt under
`superseded`, and is never counted delivered from the old manifest. The
existing offline suite remains 413 pass / 4 skipped (417 total).

B5.9.3 real B-isolated acceptance (2026-11-12, enterprise `1454`, project
`1454000004`, period `2026-11-02`→`2026-11-09`):

- before any write, report `9` was `latest_revision=1`, version `1` was
  `facts_ready` with facts run `16`/body run `17`, delivery was
  `delivered`/message `124`, `readAt=2026-11-11T15:15:07.859Z`; audits `127`
  (`active=false`) and `128` (`active=true`) were present;
- the scheduler reuse decision returned `source_unavailable`; the save path
  created revision `2` on the same report `9` with facts run `39` and body run
  `40`. No second report row, conversation or binding was created. The next
  Worker tick produced facts `39` (`succeeded`), body `40` (`succeeded`) and
  delivery/message `136`; only one model call was made (usage `1192` input +
  `785` output tokens, provider attempt `16`, run `40`);
- the old revision `1` remains `available:false` / `state:source_unavailable`;
  its delivery, message `124`, `readAt` and audits `127`/`128` are unchanged;
- the designer read API and the original XiaoK DevTools entry opened report `9`
  revision `2` (`contentStatus=composed`, `deliveryState=delivered`), listed
  originals `5` and `1`, opened record `1` with photo `1`, acknowledged
  revision `2` (`readAt=2026-11-12T07:01:17.097Z`), and returned the same
  revision after exit/re-entry;
- customer report `16`, worker `17` and boss `18` remain unchanged and
  delivered; the customer facts still exclude internal record `5`; customer,
  worker, designer and boss cross-private reads all return
  `assistant_resource_not_found` (customer uses the same binding authorization
  through the real service);
- a repeated tick after completion observed nothing, dispatched nothing and
  added `0` reports/versions/deliveries/messages/runs/jobs/usage rows
  (`18/19/19/36/40/40/16`, last audit `128` unchanged).

Evidence:
`admin/tmp/b5-9-3-20261112-145547-attempt2/{baseline.json,counts-before-replay.json,counts-after-replay.json,api-read.json,four-ends.json,customer-four-end.json,native-ui/designer-ui.json,verification.json}`.
The isolated host stores are the copies under the same directory (`schedules`,
`batches`, `runs`); the normal B stores and the original B5.9.2 artifacts are
not overwritten. Production scheduling remains off
(`NATIVE_WORKFLOW_SCHEDULE_ENABLED=0`).

Remaining limits: the old report row's latest revision is now the new valid
revision (the old revision remains individually unavailable by the existing
read contract); the body stored by this run had empty citations because
enterprise knowledge was off (addressed in B5.9.4 below). The worker's
continuous lifecycle and a production-sized multi-enterprise dispatch remain
unverified.

## B5.9.4 report citations and four-recipient native close-out

The four current reports stored `citations: []` because enterprise knowledge
was off, not because persistence lost them. With `knowledgePolicy.enabled=false`
the body is composed by `parseGeneralReport()`: progress, pending and
arrangements are written by the service itself, standards are model advice, and
every segment is created with a hard-coded empty citation list. The
general-advice prompt and tool never offer a citation catalog, so no citation
was requested from the model and none could be dropped on save.

`report-citations.ts` adds a server-owned, deterministic citation projection:

- only the exact service sentences (`进展以本份报告的原记录为准。`,
  `待核对项以本份报告的原记录为准。`, `安排以本份报告中已确认的原记录为准。`)
  may receive a server-derived citation; model prose is never retroactively
  labelled as supported by a record it did not cite;
- quotes are exact spans of the saved project source (`本次完成：…`,
  `尚未完成：…`, `待沟通：…`, published pending items and
  `安排<id>（版本<v>）：…`); no URL or free-form source is generated;
- `verifyReportCitation()` requires the source to belong to the same project
  body, the quote to exist in that saved source, and any scoped source to match
  the report/revision/project/facts hash plus the current facts record,
  published pending item, issue or arrangement (id, version and hash).
  Unknown record ids, cross-project sources, stale versions and revoked
  originals are rejected;
- customer facts contain only that customer's published records and pending
  items, so a customer citation can never resolve the internal record `5`;
- `attachReportFactCitations()` and `assertReportBodyCitations()` run in
  `processReportComposition()` before the body row is written. A
  model-generated citation that cannot be verified rejects the body instead of
  being stored;
- `reportBodyView()` applies the same projection to older bodies at read time
  and re-verifies every citation against the current facts and authorization.
  Invalid citations are hidden (`citationStatus: 'rejected'`); a service
  sentence with no valid original is marked
  `（本段没有可核验的原记录引用）` instead of inventing a source. Advice
  segments stay uncited and keep the existing model-knowledge label.

`scripts/report-citations-backfill.ts` is the one-off, model-free backfill for
already delivered reports. It revalidates facts through `projectReportFacts()`,
fills only empty citation arrays on the service sentences, verifies every span,
and leaves prose, facts, runs, messages, deliveries, `readAt` and history
untouched. Revision `9:1` was not modified.

B5.9.4 real B-isolated acceptance (2026-11-12, enterprise `1454`, project
`1454000004`, period `2026-11-02`→`2026-11-09`):

- backfill: report `9:2` received 6 citations, customer `16:1` 5, worker `17:1`
  6 and boss `18:1` 6. `9:1` kept its byte-identical body and zero citations;
  customer `16` cites only record `1` and published pending record `3`; designer
  `9:2`, worker and boss cite records `1` and `5` at version `3`;
- DB 43/43: every citation is an exact span of the saved source and resolves to
  the current facts original; deliveries/messages/audits `127`/`128` are
  unchanged; the three newly opened reports carry their own later `readAt`
  while `9:1`/`9:2` keep `15:15:07Z`/`07:01:17Z`; photos belong to the cited
  published record version;
- four-end HTTP 41/41: current binding/report/revision, verified citations,
  originals and photos for all four recipients, customer internal record
  denied, designer `r1` unavailable, cross-private reads denied;
- designer API 16/16: original XiaoK entry, revision 2, originals `1`/`5`,
  photos, `r1` unavailable, read receipt on revision 2, re-entry;
- native UI 37/37 on one Stable DevTools window: customer `16`, worker `17`,
  designer `9/r2` and boss `18` each show the correct title/period/project,
  complete body, authorized originals and photo, a `readAt` on the current
  revision, stable content through a full 7-second refresh, and the same
  revision after exit/re-entry; no other recipient binding or report appears;
  designer never shows revision `1`;
- revocation regression 6/6 inside rollback-only transactions: deactivating the
  current designer member drops the `r2` facts; withdrawing cited record `5`
  drops the `r2` facts and its citations stop resolving; after rollback `r2` is
  valid again, `r1` stays unavailable because audit `127` is after its
  `generatedAt`, audits `127`/`128` are unchanged and no regression audit row
  was written;
- a repeated scheduler tick observed the completed dispatch, dispatched
  nothing, and kept counts `18/19/19/36/40/40/16` with last audit `128`. B5.9.4
  made no model call (0 attempts, 0 tokens).

Evidence:
`admin/tmp/b5-9-4-20261112-153826/{baseline.json,backfill-dry-run.json,backfill-apply.json,citations-final.json,four-ends.json,designer-api.json,native-ui/four-role-ui.json,revocation.json,after-tick.json,final.json,verification.json}`.
The `schedules`, `batches` and `runs` stores under the same directory are
isolated copies; earlier evidence and the normal B stores are not overwritten.

Remaining limits: a production-sized multi-enterprise dispatch is still
unverified. The worker's continuous lifecycle is now verified inside the B
fixture (B5.9.5 below), including real link/photo taps rather than direct page
handler calls. Production scheduling remains off
(`NATIVE_WORKFLOW_SCHEDULE_ENABLED=0`) and the enterprise allow-list was not
expanded.

## B5.9.5 native click evidence, worker lifecycle and cross-period recovery

The B5.9.4 run could not claim the worker/boss original link because the link
sat below the sheet viewport and the page handler was called directly. B5.9.5
repeats both flows on the worktree Mini Program checkout with real taps:

- the detail sheet is scrolled until the original link is inside the rendered
  viewport, then the link is tapped at its measured centre. Worker: report `13`
  (`10月19日 · 施工周报`), link point `(81.66, 343.72)`, record `6` version `3`;
  boss: report `18` (`11月2日 · 施工周报`), link point `(81.66, 343.47)`, record
  `1` version `3`;
- the photo is tapped at its measured offset and the download wrapper records
  the exact media URL: worker
  `/followups/2/reports/13/projects/1454000004/records/6/media/6?revision=2`,
  boss `/followups/4/reports/18/projects/1454000004/records/1/media/1?revision=1`.
  This ties the preview to the cited record, revision and photo instead of only
  asserting that a preview appeared;
- both roles refresh the page for 7 seconds and exit/re-enter: the same
  report/revision, delivery state and `readAt` return, with no other recipient
  binding or report visible. 16/16 checks pass.

The worker lifecycle (`admin/tmp/b5-9-5-probe/worker-lifecycle.ts`) starts from
the normal authorized state on the marked B fixture and records every stage:

1. authorization returns the worker's own binding `2`;
2. the worker uploads photo `15` and creates record `12` (`穿线现场记录`);
3. the draft is published as an internal publication at version `3`, with the
   unassigned room label cleared;
4. `collectReportFacts()` for the running week contains record `12` version `3`
   with its real SHA-256 hash;
5. the saved weekly report `13` revision `5` (body run `48`, one attempt) keeps
   its frozen facts and digest; it is not regenerated by this stage;
6. delivery `144` is the worker's own conversation message;
7. the native entry opens revision `5`, the original record `6` version `3` and
   its photo, and marks the read receipt at `09:35:40Z`;
8. a full refresh and exit/re-entry return the same delivered revision and
   receipt;
9. revoking the worker membership writes audit `137`; the list returns no
   binding, the report/original/photo and the live record versions return
   `404 assistant_resource_not_found`, and the relaunched native page no longer
   shows the restricted card;
10. restoring membership writes audit `138`; live record access returns;
11. per the existing revocation contract the saved report stays
    `source_unavailable` because the recipient revocation is later than its
    `generatedAt`. Restoring membership does not silently make the old report
    readable again and no audit row was deleted.

Result: 25/25 checks, one record/photo/message added, no report, version,
delivery or run added, and the report digest is unchanged.

Why report `13` was regenerated: before this round every worker report was
already `source_unavailable` because audit `129` (the earlier worker revoke) is
later than their `generatedAt`. The existing contract therefore created new
revisions of the same report (`r2`…`r5`) when the period was dispatched again.
The four B5.9.4 reports (`16`, `17`, `9/r2`, `18`) were not regenerated; only the
worker's older weekly report `13` received contract-mandated revisions, and each
revision cost one body call.

Citation regression reuses the 23 existing citations: DB 43/43 (exact source
span, same project, current record/version/hash, customer excludes internal
record `5`, photos on the cited published version, `9:1` byte-identical,
deliveries/messages/audits `127`/`128` unchanged). Over the real API the boss
report shows the service sentences with `引用` labels and uncovered originals,
`standards` advice segments carry zero citations, and the `arrangements`
synthesis segment ends with `（本段没有可核验的原记录引用）`. The citation unit
suite passes 9/9 including stale-version and revoked-line rejection.

Cross-period scheduling re-ran the B5.9.2 acceptance on the latest ended week
(`2026-11-02`→`2026-11-09`) with a fresh isolated schedule store: 33/33 checks,
including "not due" no-ops, paused no-dispatch, one atomic claim, four distinct
receivers, repeated tick with zero new business rows, old-period replay that
never claims or moves `next_weekly_at`, and `needs_attention` caused by the
worker's `source_project_revoked` (an honest settled state, not a new failure).
The scheduler suite passes 35/35, adding targeted cases for implemented→boss,
assigned→current owner, one reminder per issue/target/period, and a revoked
recipient recorded as `skipped` with no message. A new period creates its own
`report_key` and request id; the worker report `13` (period `2026-10-19`) and the
four reports (period `2026-11-02`) never share one.

Model usage: four body calls for the necessary new-period revisions (`run`
`42`/`44`/`46`/`48`, provider `llm-settings-override`, model
`qwen3.7-flash`): 1092 input tokens each and 71/60/69/83 output tokens. No call
was repeated for evidence sampling, and the four existing reports and their
citations were not regenerated.

Evidence:
`admin/tmp/b5-9-5-20261112-1734/worker-boss-click.json`,
`admin/tmp/b5-9-5-20261112-1826/worker-lifecycle.json`,
`admin/tmp/b5-9-5-20261112-1835/{citations.json,citation-view.json}` and
`admin/tmp/b5-9-2-schedule-runs/b5-9-2-schedule-2026-11-12T0943-26fb1b18/verification.json`.

### B5.9.5 round-2 availability re-check

Re-reading the same B database after the lifecycle adds no new report and no
model call, but it fixes the worker evidence boundary. Worker binding `2`
reports `17/r1`, `13/r5` and `8/r1` now all return `source_unavailable` because
the worker revocation audit `137` is later than their `generatedAt`; restoring
membership (`138`) does not reopen them, and the contract forbids regenerating
them for evidence. Report `17` therefore cannot be opened or clicked again
today, so the real-click proof above is report `13` revision `2`, which was
readable at click time; report `13` itself is also `source_unavailable` now for
the same reason. Boss `18/r1`, designer `9/r2` and `14/r1` remain
`facts_ready`, designer `10/r1` is `source_unavailable`, and the customer
follow-up list still needs a public-site entry token (`X-Assistant-Entry`,
covered by B5.9.4). The citation proof re-runs at 43/43 over the same 23
citations, and report/version/delivery/message/readAt/audit counts and digests
are unchanged. Evidence:
`admin/tmp/b5-9-5-round2-20261112-1753/{state-before.json,citations.json,role-availability.json}`.

## B5.10 multi-tenant production-readiness review

This round audits the B5.9 scheduler; it does not enable production. Automatic
scheduling stays off (`NATIVE_WORKFLOW_SCHEDULE_ENABLED=0`) and the enterprise
allowlist is unchanged.

Tenant isolation (code review + tests):

- one run id is `schedule-<enterprise>-weekly-<periodStart>`; control is
  `control/<enterpriseId>.json` and the issue ledger is
  `ledger/<enterpriseId>/<projectId>.json`, so two tenants never share a run,
  lease, control file or ledger;
- every discovery, weekly claim, receiver/binding lookup, status read and issue
  read runs inside `withTenantTransaction(enterpriseId, ...)` with an explicit
  `enterprise_id=` predicate; there is no cross-tenant query path;
- the admin `GET /api/native-workflow/schedule` takes the enterprise from the
  session/tenant selector, never from the query string, and
  `readScheduledPeriodReportDispatch()` returns `403
  period_report_schedule_forbidden` when a supplied `runId` belongs to another
  enterprise; `POST` pause/resume is tenant-scoped in the same way;
- `NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS` is parsed strictly (positive
  integers only); an empty or entirely invalid allowlist returns
  `no_enterprise_scope` before any store, database or dispatch work, and the
  tick is additionally capped at 20 enterprises.

Concurrency and resources:

- the tick processes allow-listed enterprises sequentially inside the existing
  assistant-worker request; no second Worker, queue or timer exists;
- each run has an exclusive lease file with a 10-minute default TTL while the
  whole tick is bounded to 90 seconds (`NATIVE_WORKFLOW_SCHEDULE_MAX_RUN_MS`),
  and the reused B5.8 batch store keeps its own cross-process lease; a
  concurrent dispatcher observes the lease and skips instead of duplicating;
- run updates use same-directory temporary files plus atomic rename, and
  run/entry/reminder/ledger arrays are bounded (200/50/20/50), so a long-lived
  period file cannot grow without limit;
- the scheduler uses the existing PostgreSQL pool (default 10 connections) and
  holds at most one tenant transaction at a time.

Failure isolation (fixed this round): a thrown store/database/discovery/claim
error for one enterprise used to abort the whole tick. `runScheduledPeriodReportDispatch()`
now catches it per enterprise, reports that tenant as `status: failed` with the
error code and an empty work set, and continues with the next allow-listed
tenant. Pausing one tenant already short-circuits only that tenant. The existing
per-project isolation, "unknown never replayed", queued≠delivered and
delivered≠read contracts are unchanged.

Operations API: `GET /api/native-workflow/schedule` now also returns
`settings` from the tenant's `construction_report_settings` row
(`settingsEnabled`, `stageEnabled`, `weeklyDay`, `weeklyTime`, `nextWeeklyAt`,
`audiences`) through a new read-only `readWeeklyScheduleSettings()` that never
locks, claims or advances the slot; a read failure is reported as
`settingsError` without failing the run summary. The same response still
contains `control`, the run with every project entry/receiver/issue state and
`counts`, so last execution time (`run.updatedAt`), project/四端 status, failed
and unknown states are queryable.

Tests: the offline suite passes 416/416, including three new scheduler tests —
one enterprise failure does not stop the next tenant, a paused tenant does not
block another tenant, and two allow-listed tenants produce independent runs and
request ids — plus a new runtime test file proving that a disabled flag or an
empty/invalid allowlist performs no store or database work.

Cost observation (B isolated database, observed values only):

- one project-period creates four body calls (customer, worker, designer,
  boss). Observed in the four-receiver batch: 1167/61, 1201/72, 1199/84 and
  1192/785 input/output tokens; facts runs used no model tokens;
- contract-mandated revisions of one report cost one body call each: four
  revisions used 1092 input tokens with 71/60/69/83 output tokens;
- storage observed for one enterprise/project/period: run file 7.3 KB, control
  178 B, ledger 186 B; the baseline had 18 reports, 23 versions, 23 deliveries
  and 48 runs.
- Prediction (not observed): weekly body calls ≈ 4 × dispatched projects;
  peak per tick ≈ 4 × `NATIVE_WORKFLOW_SCHEDULE_MAX_PROJECTS` (default 5) per
  enterprise, serialized across enterprises. No token price or wall-clock
  duration is inferred from this data.

Bounded B acceptance: the deterministic multi-tenant tests above are the
acceptance for this round. A second live enterprise was not created because the
B fixtures only define the marked enterprise `1454`; adding another tenant is a
fixture-authoring decision, not something this review may do silently. The
remaining production risks are the shared-filesystem schedule store (single
host; a multi-host deployment needs a shared volume or a database-backed store)
and the still-unapproved enterprise allowlist expansion.

## B5.8 persistent delegations and business events

The approved consultation composer starts an electrical follow-up scoped to one active project and two registered rooms. The first task tracks a published progress record. The second tracks socket design, the exact customer-approved plan, recorded field evidence and an authorized manager resolution. A valid published room record can complete the first task while the second still waits. The final result uses the existing `construction.result` delivery to the origin consultation. The project reply card shows the current shared team request.

| Event source | Impact |
| --- | --- |
| `construction.record.captured/publish/edit/withdraw/request_changes/resubmit.v1` and `assistant.run.terminal.v1` | Match the actual record, unique room and work kind. Record attachment, version and job references. A captured photo is evidence for review. |
| `native.delegation.requirement.v1` | React to a committed current need from the same consultation. An immediate reply can use the exact active room question as scope. The original reply stays private until consented sharing. |
| `construction.material.shared/revoked.v1` | Recheck current room grants for need and drawing and invalidate older dependencies. |
| `construction.site.issue.opened/progress/lifecycle.v1` | Link the uniquely matching issue and its staff opinion, formal implementation or manager resolution. The existing project role checks govern each step. |
| `construction.plan.published/status.v1`, `construction.project.changed.v1`, `construction.schedule.changed.v1` | Recheck exact plan approval, stage, access and room/project schedules. Preserve prior bases in event receipts. A changed basis requires recheck through the original authorization flow. |
| `native.delegation.refresh/timeout.v1` | Reconcile live inputs on start/resume. The same Worker produces deadline and expiry events. |

State transitions follow the saved per-task actions. `active` starts or resumes evaluation, `processing` tracks a scoped organizing job, and `waiting` records the person or role, requested data, start and due time. `blocked` records missing or invalid dependencies, lost access or an organizing failure with its originals. `awaiting_authorization` covers material sharing and formal plan decisions. `paused` fences new work and retains the delegation. Explicit resume rechecks current sources. `completed` requires all task completion conditions, `failed` represents loss of the required room, `cancelled` is the owner's terminal stop, and `expired` follows the 30-day lifetime. Terminal states have no event-driven reactivation. A 48-hour wait records elapsed time and sends at most one in-app reminder when the owner opted in and AI mode remains current.

Migration `0121_native_workflow_delegations` uses forced RLS on both new tables and the existing outbox delivery unique key. The Worker consumes committed deliveries in event ID order per tenant. Each attempt locks the tenant delivery and the affected original conversations, rechecks live source revisions, and commits state, task links and message receipts together. A savepoint rolls back effects on errors. Retry backoff and the fifth-attempt dead receipt persist. Staff notices share a stable project/room/action/basis key, including when multiple delegations observe the same event.

Apply the migration before enabling `NATIVE_WORKFLOW_DELEGATION_ENABLED=1` and the explicit `NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS` on the application Worker. The opt-in defaults off. For operational rollback, set the flag to `0` and keep the additive schema and current source guards so persisted receipts remain scoped. For a full schema rollback, first stop processing and archive the two new tables, redact feature-owned consultation and collaboration receipts before reverting their source guards, then remove the two feature triggers/functions, the delivery index and the two tables via a controlled forward migration or a verified database restore. Retain the existing outbox and formal business data. A snapshot restore must account for later writes.

The isolated PostgreSQL suite uses the `sfp_app` role and requires `B58_LIVE_DEVELOPMENT=1`, `DATABASE_URL` for loopback `55433/xiaok_b58_test`, and `B58_MIGRATION_DATABASE_URL` for that database's fixture role. Run from `admin` with `node --import tsx --test src/lib/native-workflow/__tests__/delegation.live.test.ts`. The optional `B58_CONFIGURED_MODEL=1` runs the two fixed natural replies against the configured model. Engine verification uses saved photos and PCM originals with deterministic extraction/ASR adapters; model continuation is verified separately. This slice uses existing in-app routes and supports one electrical follow-up per active project/consultation. Other delegation types and off-platform reply channels remain outside the implemented scope.

Validation on the B worktree used the real `sfp_app` role in `55433/xiaok_b58_test`. All nine database cases passed. They cover the six-step workflow with a simulated next day, an actual fresh Worker process, database failure/retry, duplicate events and staff requests, project revocation, two tenants, reminder consent and source/schedule invalidation. The full six-step result was saved in consultation 103 as message 407. Evidence is in `admin/tmp/b58-live06.log`. The isolated migration hash was `86aabfda7cd31ce59aea2e68ab8ad93289293bd118b62202826f593e88635450` with forced RLS on both new tables.

The two configured Qwen replies resumed the exact original wait and entered designer review after sharing. The first drafts in runs 17/18 used attempts 1–8 (27,405 input / 645 output tokens) and failed the business expectation. Runs 27/28 after binding the actual question used attempts 9–16 (27,549 input / 569 output tokens) and passed. The FastGPT connection-refused attempts ended before model dispatch. Evidence is retained in `admin/tmp/b58-configured-native.log`, `admin/tmp/b58-configured-diagnostic.log` and `admin/tmp/b58-live05.log`.

Stable 2.02.2608080 with library 3.17.2 at 390×844 exercised the original C01 composer, persisted start, question, pause, resume, cancel and re-entry. The first empty-window receipt exposed the client sending `afterSeq=0`. The client now loads the first window with the established full-history request. The final native read verified formal result message 244 in consultation 72. The screenshot RPC timed out. Evidence is in `admin/tmp/b58-native-journey/{verification,final-result}.json`. Physical microphone capture, live ASR and production use remain unverified.

The offline workflow and construction suites passed 567 checks with four skips. The focused Mini Program tests passed 88 checks. The full Mini Program run passed 2222 of 2225, with three survey baseline and mirror-audit failures. Scoped ESLint passed. Full ESLint still reports the existing `fastgpt-rag.test.ts:22` error. The production webpack bundle compiled and the build stopped on the baseline `scripts/fastgpt/setup-unified.mts:113` type error. Comparing the same TypeScript scope against `191e47f7` produced 289 diagnostics on both revisions, with zero new diagnostics.

## B5.9 cross-role project collaboration

Enable the slice in development with `NATIVE_WORKFLOW_COLLABORATION_ENTERPRISE_IDS`. The base scope is one enterprise and its project, rooms and stage assignments. Current views are derived from the same durable facts:

| Fact | Authority and revision |
| --- | --- |
| Actual construction | Project progress revision, stage audit, and exact construction record version with its original message, photo and speech references |
| Dated plan | Latest `construction.schedule.published.v1` project version and stable room/stage node keys. An assigned manager can bind a reviewed room record to one node when publishing it |
| Need and professional opinion | Current explicit material grant and its original consultation, stable design matter ID, issue revision, drawing grant and designer reply hash |
| Effective construction requirement | Current plan publication and its own decision revision, scoped to the original homeowner. A new opinion, replacement, withdrawal, or source revocation invalidates the affected older requirement |
| Issue, execution and review | The same site issue ID, source revision and append-only lifecycle revisions, with the exact submitted record and plan when required |
| Delegation and notification | The existing delegation task keys and outbox deliveries. The exact result event, recipient, message and sync receipt remain traceable |

The approved C01, project detail, brief and V3 conversation entries use those projections on refresh and reentry. Staff project detail and brief share their issue groups. The quality confirmation requires a current reviewed record, an original photo and a manager's explicit reason. Ordinary reports and missing materials stay in their original record flow. Rectification submission takes the item to review. A separate assigned manager confirms the submitted evidence. The fixed list contains confirmed, current results. Exclusions and design work have their own visible entries. Reopening keeps the issue ID, records a new lifecycle revision, and requires fresh execution evidence for a new review. Engineering acceptance remains governed by its existing project process.

An actual completion anchor is room- and stage-specific. For plan timing, compare its saved date with the effective plan's Shanghai business dates. Green is early, yellow is on schedule, red is late and gray is unverified or unscheduled. Staff can trace the plan and its source record or stage audit. The owner view includes references to records published to that household. Family grants are explicitly revocable, scoped to a single project and limited to progress. Plan decisions, grants and chat access each check their own live authorization. Organization management visibility does not grant a project designer or reviewer assignment.

Relevant writes are version-checked inside the existing PostgreSQL transaction and idempotency boundary. Plan and review events retain immutable history. The Worker consumes its original delivery table, uses the latest committed facts and maintains a monotonic event watermark. A completed delegation with the exact issue can resume on a formal reopen within its authorization period. Delivery states are pending, processing, failed and succeeded. Readback revalidates source availability and audiences before using any result.

The schema remains at migration `0121_native_workflow_delegations`. This slice adds event payloads and read paths to the existing outbox, record-version and delivery contracts. Legacy records are retained and unbound records can evidence progress without claiming node completion. Deployment rollback uses the enterprise allowlist and app revision; existing business events and originals are retained. No data backfill is required.

For isolation and replay, set `B59_LIVE_DEVELOPMENT=1` and point the development `DATABASE_URL` to loopback `55433/xiaok_b59_test` using the restricted `sfp_app` role. Run `node --import tsx --test src/lib/native-workflow/__tests__/cross-role.live.test.ts` from `admin`. The suite uses signed Mini API handlers, PostgreSQL writes, stored PNG and PCM originals, and a fresh Worker process. Speech recognition and model responses use deterministic test adapters. Device capture, live speech recognition, real WeChat authorization, and production remain unverified.

The [isolated run](../../../tmp/b59-live08.log) passed 7/7, with no source drift in its [binding](../../../tmp/b59-live08.log.binding.json). Project `6` binds original consultation `11`, master bedroom record `23`, issue `379`, effective study plan `394` (V2), and the exact review result `387`. The suite checks simultaneous writes, stale and repeated delivery, the restart, reopening, tenant and family boundaries, and matching quality counts. The [Stable run](../../../tmp/b59-native-03/verification.json) passed 6/6 at a logical 390×844 on the same project. Its native entries verified the boss brief/detail and designer issue, a persisted worker query for V2, and a persisted homeowner status query followed by reentry into C01. The earlier [native attempt](../../../tmp/b59-native-02/verification.json) retains the failed room-link case. The final route resolves the room by the effective plan's server ID and retains an existing draft.

## Reproduce

From `admin/` (no database, no Worker, no model):

```powershell
npx tsx --test src/lib/native-workflow/__tests__/validate.test.ts src/lib/native-workflow/__tests__/advance.test.ts src/lib/native-workflow/__tests__/simulate.test.ts src/lib/native-workflow/__tests__/hardening.test.ts src/lib/native-workflow/__tests__/store.test.ts src/lib/native-workflow/__tests__/service.test.ts src/lib/native-workflow/__tests__/admin-draft-state.test.ts src/lib/native-workflow/__tests__/admin-selection.test.ts src/lib/native-workflow/__tests__/live.test.ts src/lib/native-workflow/__tests__/dev-config.test.ts src/lib/native-workflow/__tests__/fixture-ownership.test.ts src/lib/native-workflow/__tests__/acceptance-store.test.ts src/lib/native-workflow/__tests__/acceptance-conversation.test.ts src/lib/native-workflow/__tests__/acceptance-state.test.ts src/lib/native-workflow/__tests__/acceptance-provider.test.ts src/lib/native-workflow/__tests__/period-report-ports.test.ts src/lib/native-workflow/__tests__/report-model-evidence.test.ts src/lib/native-workflow/__tests__/period-report-status.test.ts src/lib/native-workflow/__tests__/period-report-status-reentry.test.ts src/lib/native-workflow/__tests__/admin-run-status.test.ts src/lib/native-workflow/__tests__/period-report-status-route.test.ts src/lib/native-workflow/__tests__/period-report-status-route-guards.test.ts src/lib/native-workflow/__tests__/period-event-weekly.test.ts src/lib/native-workflow/__tests__/period-cli.test.ts src/lib/native-workflow/__tests__/staff-receiver.test.ts src/lib/native-workflow/__tests__/boss-receiver.test.ts src/lib/native-workflow/__tests__/worker-fixture.test.ts src/lib/native-workflow/__tests__/period-report-entry.test.ts src/lib/native-workflow/__tests__/period-report-batch.test.ts src/lib/native-workflow/__tests__/period-report-schedule.test.ts src/lib/native-workflow/__tests__/period-report-schedule-store.test.ts src/lib/native-workflow/__tests__/period-report-schedule-ports.test.ts src/lib/native-workflow/__tests__/period-report-schedule-runtime.test.ts
npx tsx --test src/lib/construction/__tests__/report-citations.test.ts src/lib/construction/__tests__/report-composition.test.ts
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
