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

The isolated service command exited 1 while acquiring `lockAssistantAcceptance`: `Another assistant acceptance run holds the isolated database lock.` A read-only check confirmed another process still held that lock; see `service-attempt.log` and `lock-observation.json`. The test child never started: **0 database tests executed**, with no fixtures created/reset/cleaned, data writes, or competing Worker from this line. This check is pending lock availability, not a passed/failed/skipped test result. Database acceptance was not rejected by automatic approval review.

Offline authorization/version cases simulate the port, not database RLS or real-model acceptance. This run made no model/Embedding calls. Service tests will use a deterministic text model and the existing indexing steps will use the real isolated database/Embedding when executed. With no model-semantic, route, or schema change, this batch does not run full build, Chrome, Stable native, physical-device/BLE, or production-release acceptance; none is claimed as passed.

## Plan preservation

The original worktree plans are not edited, staged, or committed. Only the two manifest-listed plans were copied into this worktree's ignored `tmp/knowledge-batch/plans/`. Original/snapshot/copied SHA256 values agree: Chinese `498b36b66299fe188cd429d7823e1dc97075c19bf81da06fffe2a6bf2d50d968`; English `e4a4d65d063069a7eea38d2228c553ed0ddfff60cee775dbd538442bed457235`. The roadmap hash matches the handoff: `432611441d0c6c257913472619c3dd6128a0a7d0ab5bd0e769016cdb0e9aae9d`. The original repository currently has no `.agents/skills`; root/admin instructions, relevant inventories, and the KB-4 contract were read.
