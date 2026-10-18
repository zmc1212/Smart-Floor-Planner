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

Evidence resides in the worktree's `tmp/knowledge-batch/`. Logs/JSON retain before/after source hashes, exact pass/fail/skip counts, and model category. Final offline checks: **41 passed, 0 failed, 0 skipped**, comprising 27 new coordinator cases and 14 existing units. Tested source hashes remained unchanged during execution. All six related files have zero ESLint errors/warnings. Same-source-program diagnostics are **287 before and after, 0 added**; this is not a clean full-project typecheck.

The first isolated command exited 1 while acquiring `lockAssistantAcceptance`: `Another assistant acceptance run holds the isolated database lock.` That attempt never started the test child and executed 0 database tests; its original `service-attempt.log` and `lock-observation.json` remain intact. Subsequent read-only checks identified PostgreSQL backend `457125`, role `sfp_app`, an empty application name, and client `172.18.0.1:53962`. The local business acceptance parent `323796` still had a descendant running `assistant-team-materials.test.ts`. No connection was terminated, lock deleted/preempted, or other task's fixture cleaned. After observing normal release at 15:28 UTC, the original helper rechecked the target, unprivileged role, and idle queue before acquiring a new lock.

The existing service file was executed at code commit `782eb8ac5a371d2cb64783801b1859022aa5509d`: **14 tests, 13 passed, 1 failed, 0 skipped, 0 cancelled**, exit 1, approximately 170.37 seconds. Source hashes remained identical before/after. All 10 original service cases plus the 3 new preparation/atomic-rollback/revision-reentry cases passed. The new three-manager batch-permission case failed; the suite did not pass in full. Our backend `459405`, role `sfp_app`, held the lock with application name `knowledge_batch_service_followup_20261018T1529Z`. The suite retained `lockAssistantAcceptance` throughout, without bypassing the guard or launching a standalone Worker.

The failure is the synthetic admin INSERT at `admin/src/db/__tests__/assistant-knowledge-operations.test.ts:184`: interpolating a JS array for `menu_permissions` produces `($4)::text[]` with `$4` bound to the bare string `assistant-knowledge`. A read-only `SELECT ($1)::text[]` reproduced `22P02 / malformed array literal`; read-only explicit `ARRAY[$1]::text[]` and `ARRAY[]::text[]` controls succeeded. Case 14 never reached the permission assertions, so it proves neither correct business authorization nor an authorization breach. Fix that test fixture's array SQL and rerun under the shared lock as subsequent work. This follow-up was limited to running/reporting the regression: the failed test, product implementation, API/UI, and shared source were left unchanged.

Fixtures were restricted to enterprises `3442/3443` and prefix `synthetic-kb4-a18a2a94-9f33-4cc5-8387-260f0264ed96`. A post-run read-only audit found no remaining enterprises, prefixed admins, or records across 13 assistant tables, with an empty active queue. Owned runner/test PIDs `365080/455544/127880` exited and our lock `459405` was released. This line started no standalone Worker and did not replace or stop the existing development Worker. Evidence: `service.log`, `service-status.json`, and `service-followup/{preparation.json,run-observation-*.json,service-final.log,service-final-status.json,failure-analysis.json,cleanup-audit.json,owned-processes.json,process-cleanup.json}`. Original lock-blocked evidence remains; there was no automatic-approval rejection or uncertain write outcome.

Offline authorization/version cases simulate the port. This service run used real isolated PostgreSQL/RLS and the existing real Embedding, with deterministic simulated text generation. An in-run snapshot observed 2 successful `embed` calls; this partial count is not a suite total or billing claim. Unknown inputs/costs stay explicit. No configured real text-model answer or customer C01 Agent/native semantic acceptance was performed. The 41 offline checks, lint, and type comparison remain prior-run evidence and were not repeated in this follow-up. With no model-semantic, route, or schema change, full build, Chrome, Stable native, physical-device/BLE, and production-release acceptance were not run. Overall status remains Limited.

## Plan preservation

The original worktree plans are not edited, staged, or committed. Only the two manifest-listed plans were copied into this worktree's ignored `tmp/knowledge-batch/plans/`. Original/snapshot/copied SHA256 values agree: Chinese `498b36b66299fe188cd429d7823e1dc97075c19bf81da06fffe2a6bf2d50d968`; English `e4a4d65d063069a7eea38d2228c553ed0ddfff60cee775dbd538442bed457235`. The roadmap hash matches the handoff: `432611441d0c6c257913472619c3dd6128a0a7d0ab5bd0e769016cdb0e9aae9d`. The original repository currently has no `.agents/skills`; root/admin instructions, relevant inventories, and the KB-4 contract were read.
