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
native-workflow non-database suite is 90 tests, the shared construction suite
is 89 tests, the real-adapter suite is 14 tests, and the offline entry guards
are 6 tests. `live-integration.test.ts` no longer sets the opt-in itself:
missing `B4_LIVE_DEVELOPMENT`, `B4_LIVE_DEVELOPMENT=0` and
`NODE_ENV=production` all reject before any connection. Scoped ESLint passes;
the repository still has its pre-existing full-lint/type/build failures outside
this module.

The sole XiaoK plan is intentionally not edited in this B branch; the
integration lead should merge the current B4.3 status into A's latest plan
without replacing A's newer progress, failures or unknown records.

Out of scope this round: daily/weekly real integration, the model compose
branch, drag canvas, automatic scheduling, Worker changes, menus and shared
migrations.

## Reproduce

From `admin/` (no database, no Worker, no model):

```powershell
npx tsx --test src/lib/native-workflow/__tests__/validate.test.ts src/lib/native-workflow/__tests__/advance.test.ts src/lib/native-workflow/__tests__/simulate.test.ts src/lib/native-workflow/__tests__/hardening.test.ts src/lib/native-workflow/__tests__/store.test.ts src/lib/native-workflow/__tests__/service.test.ts src/lib/native-workflow/__tests__/admin-draft-state.test.ts src/lib/native-workflow/__tests__/admin-selection.test.ts src/lib/native-workflow/__tests__/live.test.ts src/lib/native-workflow/__tests__/dev-config.test.ts src/lib/native-workflow/__tests__/fixture-ownership.test.ts
npx tsx src/lib/native-workflow/playground/simulate.ts
```

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
