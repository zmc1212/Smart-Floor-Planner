# Native Workflow (B0-B2)

Pure, simulation-only workflow core for 家客来 native business orchestration.
B0-B2 defines, validates, compiles and simulates workflows. It does **not**
connect a model, database, queue, scheduler, media store or message channel.

Owner: B line (`codex/xiaok-native-workflow`). Shared files, the sole XiaoK plan
and the bilingual module inventories remain owned by the integration lead.

## Boundary

- Imports only Node built-ins and local files in this directory.
- Never starts jobs, timers, workers or network calls on import.
- Never reads production keys, customer data or real receipts.
- Simulated saves/deliveries are proposals with `simulated: true`; they must
  never be presented as generated, saved or sent to a customer.
- Real capability adapters (authorized reads, model compose, persistence,
  in-app outbox) are B4 work behind the same `PendingOperation` descriptions.

## Public API (`index.ts`)

| Function | Contract |
| --- | --- |
| `validateDefinition(raw)` | Structure, capability whitelist, references, type compatibility, upstream dependency, edge legality, cycle/bounds and import safety. |
| `compileDefinition(raw)` | Validates, then returns an immutable plan with digest, node versions, outgoing edges, topological order and bounds. |
| `advance(plan, state, event)` | Pure transition. Accepts `start` or `observation`; returns a new state, trace entries and pending operation descriptions only. |
| `simulate({ definition, scenario, fixtures })` | Drives `advance` with fixture observations. Deterministic for the same definition/scenario/fixtures. |
| `parseDefinitionJson` / `exportDefinitionJson` | Canonical import/export with size, forbidden-content and schema checks. |
| `createStageReminderDefinition` / `createPeriodReportDefinition(kind)` | The two B2 templates. |

Supporting exports: `definitionDigest`, `capabilityCatalog`, `getCapability`,
`createRunState`, `WORKFLOW_BOUNDS`.

## Definition contract

- Root: `schemaVersion` (1), `definitionId`, `revision`, `entryNodeId`,
  `inputSchema`, `nodes`, `edges`.
- Node: `nodeId`, `type`, `typeVersion` (1), `capabilityRef`, `config`, `inputs`.
  Inputs are references `{ nodeId, outputPath }`; there are no literal inputs.
- Edge: `{ from, to, when? }`. `when` is only valid on `condition` edges and is
  unique per branch. Non-condition nodes have at most one outgoing edge.
- Bounds: 32 nodes, 64 edges, 16 input mappings per node, 64 KB imported JSON,
  64 execution steps.
- Entry must be the only trigger, have one unconditional outgoing edge and no
  incoming edge. All nodes must be reachable. `save_result`/`deliver_inapp`
  nodes may be terminal; every save needs a path to a delivery node. Cycles,
  duplicate nodes/edges, unknown nodes/capabilities, missing outputs, type
  mismatches and forward references are rejected.
- Imported JSON may not contain URLs, SQL, code/`require`/`import()`, secrets,
  file paths, `${...}` expressions or unknown transport fields.

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

1. `start` validates the trigger event against `inputSchema`, records the event
   ID, stores trigger outputs and pumps deterministic nodes until a host effect
   or a terminal state.
2. `observation` matches the pending node, validates all declared output ports
   and their types, stores only declared outputs, then pumps.
3. `pending` contains at most one descriptive operation (`nodeVersion`,
   resolved input, `simulation` marker, idempotency key). No effect is executed.
4. Failures become `failed` with the original error; unmatched condition
   branches become `halted`; terminal save/delivery becomes `completed`.

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
- `save_result`/`deliver_inapp` fixtures must confirm the effect and provide a
  `receiptId`; the simulator forces `simulated: true` and rejects receipts that
  claim to be real (`fixture_receipt_not_simulated`).
- Every trace entry is marked `mode: 'simulation'`.

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

## Reproduce

From `admin/` (no database, no Worker, no model):

```powershell
npx tsx --test src/lib/native-workflow/__tests__/validate.test.ts src/lib/native-workflow/__tests__/advance.test.ts src/lib/native-workflow/__tests__/simulate.test.ts
npx tsx src/lib/native-workflow/playground/simulate.ts
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
