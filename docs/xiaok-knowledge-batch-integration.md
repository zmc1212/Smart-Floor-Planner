# KB-4 batch regressions: knowledge-line implementation and integration handoff

Status: **Limited; internal capabilities implemented, not connected to API/UI.** This is a reviewable knowledge-line integration proposal, not a replacement for the [phase-two contract](./xiaok-assistant-phase-2.md), [admin inventory](./admin-system-modules.md), or the user's local enterprise-knowledge plans. Baseline: `d023854313842ef447efb2973beb540d1511e125`. The original business worktree's branch and product source are not changed.

## Implementation boundary

- `KnowledgeOperations.prepareBatch({cases:[{caseId,expectedVersion}]}, requestKey)` atomically prepares existing evaluation records for 1–50 saved questions inside the existing knowledge-manager transaction. It reuses `assistant_knowledge_evaluations`, original `create_key/send_key`, and `assistant_idempotency_records`. It creates no conversations, runs, jobs, reservations, or model calls. Individual `start` shares the same evaluation-insertion helper.
- The receipt preserves selection order, case version/revision, question/expectation/required-source snapshot hash, knowledge epoch, profile ID/configuration hash, policy version, selected enterprise, and owning admin. Required sources retain the existing effective, published, index-ready `customer_public` checks; forbidden sources retain document IDs plus epoch. Preparation requires an existing profile and does not create a second indexing configuration.
- Any stale version, unready source, authorization failure, or enterprise 2,000-evaluation limit rolls back the complete preparation, including earlier items and the operation receipt. Original-key duplicates return all original evaluation IDs; a changed payload with the same key conflicts. Replaying an old key after edits/source changes still returns the old receipt, not current execution authorization.
- `evaluation-batch.ts` supplies immutable manifests, bounded `advance()` sweeps, per-item progress, and `requestCancel()`. Every sweep rereads all original evaluations. Existing queued/running, indeterminate, and unreconciled items consume slots, default 2 and maximum 4. Existing activity above the requested cap permits no additional dispatch. The coordinator only resumes prepared evaluations; it never calls start, run retry, a provider, or a Worker.
- Manifests/checkpoints retain identities, hashes, and status, excluding answers, source text, diagnostics, review notes, and raw provider errors. Changed sources hide old run/structural output. Structural success remains `requires_review`. Total cost stays `null`; unknown usage and unreconciled items are explicit rather than zero-filled.

This creates no alternative durable job or lease authority. Existing services own evaluations, runs, jobs, operation keys, sources, usage, and reservations. An unkeyed manifest hash checks integrity and is never authorization proof.

## Ports owned by the business integrator

`EvaluationBatchPort` is an explicit dependency. No production adapter or route is supplied. Browser state or model output cannot implement these guarantees.

| Port | Required contract |
| --- | --- |
| `preflight(manifest)` | Revalidate the selected enterprise, current manager/password state, private evaluation ownership, case revisions/snapshots, epoch, profile ID/hash, policy version, and execution revision on the server. Called before actions and before returning progress. Failure must clear stale progress views instead of exposing cached content. |
| `observe(manifest,item)` | Read current, safe evaluation/run state, not cached answers. Verify the actual evaluation matches manifest identity and snapshot hash; a computable hash does not confer authorization. Detect committed sends whose evaluation run_id writeback was lost; preserve unknown attempts and reservations. |
| `resume(manifest,item)` | Recheck permission/version within the existing transactional write boundary and use only that evaluation's server-owned original create/send keys. Never create a new evaluation or replace keys to retry an indeterminate operation. A separate preflight is not an atomic mutation guard. |
| `cancel(manifest,item,key)` | Use existing cancellation such as `ConversationService.run(runId,'cancel',key)` for an existing run only. Never resume/send to discover a run ID. A cancellation receipt does not settle provider billing. |

The server must construct and continually verify `executionRevision` as SHA256 over explicitly selected execution mode, provider identity, model/revision, actual prompt/version, and relevant generation settings, excluding credentials. Existing administrator evaluations use knowledge previews, **not the customer C01 Agent**. A preview configuration must not be labelled an Agent prompt/model version; extractive preview output is not live-project semantic acceptance. Agent execution pinning/adapter work belongs to the business integrator; this line changes no shared runtime.

One coordinator rejects overlapping sweeps. Cross-process/multi-tab control of one manifest, durable cancellation intent, and an atomic fence between cancellation and unstarted items still require serialized integration through existing mechanisms. Until then, expose no batch API/UI and claim no distributed concurrency or durable-cancel acceptance. Do not invent a queue, schema, migration, or lease to bypass this dependency.

## States and recovery

| Trigger | Implemented feedback/data | Recovery and limits |
| --- | --- | --- |
| Preparation/original-key reentry | Original ordered evaluation IDs and frozen snapshots | Reread the receipt; no automatic dispatch. |
| Normal advance | Per-item dispatch_pending/queued/running/terminal and structural state | A new controller reuses the same serialized manifest and rereads server state before allocating slots. |
| In-instance cancellation | Stops new resumes immediately; requests cancellation of late, known active runs | Unstarted items remain pending, not falsely server-cancelled. An explicitly new controller continues their original IDs; durable stop intent needs integration. |
| Lost resume/cancel receipt | Immediate reread with action unconfirmed; no raw error body | Confirm the original run on a later poll. Never replace keys or retry unknown provider work. Unsafe reread fails the entire sweep. |
| Indeterminate/unreconciled cost | Preserved status, null cost, occupied capacity | Existing usage/reconciliation permission applies. The batch layer never settles or clears accounting. |
| Case/source/profile/configuration changes or revocation | Rejected advance, or content-free source_changed status | Explicitly prepare current versions. Old receipts remain audit records, not execution permission. |
| Structural success/finished execution | Separate structural counts and execution terminal states | Existing explicit professional review is still required. Finished execution certifies neither billing nor product acceptance. |

## Shared documentation and interface boundary

Following the handoff's single-integrator rule, this line changes no shared bilingual contract/inventory, Agent, queue, schema, migration, citation permission, or native UI. Current routes/APIs/menus/permissions and visible flows remain unchanged. The inventory's delivered per-question core and remaining batch execution description remains accurate. This bilingual document records internal data/execution contracts; it is not a delivered user-facing stage.

At integration, replace the existing KB-4 current paragraph in both admin inventories and update the same KB-4 record in both phase-two contracts, using this scope:

> Internal batch preparation atomically persists original evaluation identities. A bounded coordination layer reuses existing preview/run/idempotency/accounting protocols, with offline per-item progress, local concurrency, and cancel/recovery port checks. Batch API/UI, distributed fencing, actual execution-configuration pinning, and customer Agent/native regression remain pending; overall Limited.

Replace pending items with actual evidence only after integration. Verify the existing Ant Design/Admin Pro/shared-feedback flow, service writes/reentry/permissions/errors, and affected C01 citation/reentry scenarios. This proposal is not a new visual direction or automatic inventory-status upgrade.

## Verification and reproduction

From this worktree's `admin`:

```powershell
node scripts/assistant-knowledge-batch-acceptance.mjs
node scripts/assistant-knowledge-batch-acceptance.mjs --service --connection-file 'G:/workspace/向总/Smart-Floor-Planner/tmp/xiaok-vector/connection.private.json' --env-dir 'G:/workspace/向总/Smart-Floor-Planner/admin'
node scripts/assistant-knowledge-batch-typecheck.mjs d023854313842ef447efb2973beb540d1511e125
```

The first command runs offline tests plus existing structural/context/file-locator units without accessing a database. The second must acquire the whole-suite `lockAssistantAcceptance` lock, enforcing approved `55432/xiaok_embedding_eval`, a non-superuser/non-BYPASSRLS role, and an idle queue before knowledge-operations service regression. It starts no standalone Worker and drives existing work functions through the original tests. Lock failure never resets fixtures or clears a queue. Only `synthetic-kb4-<UUID>` enterprises/users and labelled synthetic questions are used; cleanup is restricted to this suite's fixture IDs. Existing environment/connection files are read without copying or adding credentials.

Related offline checks were rerun: **41 passed, 0 failed, 0 skipped**, comprising 27 coordinator cases and 14 existing units, with stable tested-source hashes. All six related files have zero ESLint errors/warnings. Same-source-program diagnostics remain **287 before and after, 0 added**; the full project is still not free of type errors. Logs/JSON are in the worktree's `tmp/knowledge-batch/fixture-fix/`.

Ownership was checked first: `admin/src/db/__tests__/assistant-knowledge-operations.test.ts` is the dedicated knowledge-operations regression; this line added case 14 in `782eb8ac`. The original business worktree has no committed or uncommitted changes to that file since `d0238543`, and the handoff's shared single-writer list does not classify this knowledge test as a shared Agent/permission file. Only the fixture's `menu_permissions` construction changed to explicit `ARRAY['assistant-knowledge']::text[]` / `ARRAY[]::text[]`, retaining all permission assertions. The same test file now emits complete accounting before cleanup; `finally` still guarantees cleanup by this suite's fixture IDs. Product implementation, API/UI, shared runtime/queue/schema/permission source remain unchanged.

The final service result is a **new run after the fixture fix: 14 tests, 14 passed, 0 failed, 0 skipped, 0 cancelled**, exit 0, approximately **175.34 seconds**. All original assertions for `enterprise_admin/admin/super_admin` in case 14 executed. The service runner's before/after source hashes match; a separate check found no changes across nine test/accounting source files. The original `lockAssistantAcceptance` enforced the approved target, non-superuser/non-BYPASSRLS role, and idle queue. Backend `460828`, role `sfp_app`, held our lock with application name `knowledge_batch_fixture_fix_20261018T1544Z`.

Before deleting fixtures, the cleanup hook emitted one complete `KB4_SERVICE_AUDIT` covering all index attempts, query-Embedding usage, and reservations for both enterprises, replacing the previous partial in-run counting limitation. The existing gateway sends one `/v1/embeddings` HTTP request for each valid embed invocation, without automatic retries/fallbacks. Successful attempts / observed usage correspond to these actual application-side requests:

| Scope | Actual requests | Known input tokens | Unknown-input calls |
| --- | --- | --- | --- |
| Document Embedding (succeeded embed) | 3 | 121 | 0 |
| Query Embedding (observed query_embedding) | 4 | 164 | 0 |
| This run total | **7** | **285** | **0** |

Three successful chunk attempts had three unknown input measurements; they are excluded from the Embedding request count. Cost remains `costMicros:null`. Before cleanup, 4 reservations were `reconciling` and 1 was `released`; unknown fees were neither zero-filled nor marked reconciled. Only this suite's synthetic fixtures were deleted by the original cleanup procedure after their audit was retained separately.

Current fixtures were enterprises `3445/3446`, eight admins `6773–6780`, and prefix `synthetic-kb4-6d269aca-cda0-41e6-8330-fecd854baf0a`. At 15:48:50 UTC, a read-only audit found no remaining enterprises, prefixed/exact-ID admins, or records across 13 assistant tables; owned active jobs were 0 and the shared active queue was empty. PIDs `378580/267468/345656` exited and lock `460828` was released. No standalone Worker was started, existing development Worker replaced, other task's fixture cleaned, or its lock deleted/preempted.

The independent run at original code `782eb8ac` remains **13 passed, 1 failed**: case 14 failed before permission assertions when the synthetic admin INSERT at original line 184 produced `($4)::text[]` with bare string `assistant-knowledge`; the read-only control reproduced `22P02 / malformed array literal`. That failure was not relabelled as passed. Its full original log/status and root cause remain in `service-followup/` and `fixture-fix/previous/`. The initial lock-blocked attempt with 0 tests executed remains in `service-attempt.log` and `lock-observation.json`, excluded from the final 14-test count.

Current evidence: `fixture-fix/{ownership.json,preparation.json,unit.log,unit-status.json,lint-status.json,type-comparison.json,service-final.log,service-final-status.json,embedding-audit.json,embedding-summary.json,cleanup-audit.json,owned-processes.json,process-cleanup.json,final-source-check.json}`. The archive wrapper initially rejected unnormalized `admin/../` paths; complete primary logs/JSON were recovered, as recorded in `artifact-recovery.json`. This is not an additional passed/failed test case.

Service tests used real isolated PostgreSQL/RLS and the existing real Embedding, with deterministic simulated text generation. Offline port permission/version cases remain simulations and do not replace database or customer-semantic acceptance. Configured real text-model answers, C01 Agent/native semantics, full build, Chrome, Stable native, physical-device/BLE, production capacity/restore, and release acceptance were not run. Batch API/UI, execution-version pinning, and distributed cancellation fencing still require the integrator. Overall status remains **Limited**; no automatic merge or deployment occurred.

## Plan preservation

The original worktree plans are not edited, staged, or committed. Only the two manifest-listed plans were copied into this worktree's ignored `tmp/knowledge-batch/plans/`. Original/snapshot/copied SHA256 values agree: Chinese `498b36b66299fe188cd429d7823e1dc97075c19bf81da06fffe2a6bf2d50d968`; English `e4a4d65d063069a7eea38d2228c553ed0ddfff60cee775dbd538442bed457235`. The roadmap hash matches the handoff: `432611441d0c6c257913472619c3dd6128a0a7d0ab5bd0e769016cdb0e9aae9d`. The original repository currently has no `.agents/skills`; root/admin instructions, relevant inventories, and the KB-4 contract were read.
