# PostgreSQL Migration Plan And Progress

> 2026-08-05 migration record: platform `GET/PATCH
> /api/admin/ai-image-models` now initializes, reads, validates, and updates
> GRS catalog profiles through `AiCreationModelProfileRepository` in PostgreSQL
> platform transactions. The coupled `GET/PATCH
> /api/admin/ai-image-model-prices` route validates PostgreSQL catalog
> capabilities and reads/writes PostgreSQL price rows. Existing
> `super_admin`/`admin` access, DTOs, one-enabled-default rule, and read-only
> provider-discovered entries are unchanged. No MongoDB business data was
> imported, deleted, or re-encrypted. Targeted ESLint and
> `npm run test:postgresql` passed 46/46.

> 2026-08-05 migration record: tenant `GET /api/ai/usage` and the deprecated
> platform enterprise reads `GET /api/admin/enterprises/[id]/ai-key`, `/ai-sync`,
> and `/ai-usage` now read the tenant-scoped PostgreSQL
> `enterprise_ai_usage_snapshots` table. Their existing read DTOs and
> `super_admin`/`admin` boundary are preserved; retired enterprise Pollinations
> credential writes remain `410`, and `ai-key` reports `aiConfig: null` to avoid
> exposing a retired per-enterprise key model. No MongoDB business data was
> imported, deleted, or re-encrypted. `npm run test:postgresql` passed 45/45.

> 2026-08-04 migration record: `POST /api/admin/ai-generations/[id]/retry`
> now recognizes bigint failed Mini Program generations. A platform
> `super_admin` or `admin` must have an enterprise context; the tenant-RLS
> runtime can then retry a staff-owned task without requiring the administrator
> to be its original operator. It clears the failed provider state, advances
> the billing cycle, and resubmits through the existing PostgreSQL lifecycle.
> Historical ObjectId retries remain MongoDB-compatible. No MongoDB business
> data was imported, deleted, or re-encrypted. Targeted ESLint and
> `npm run test:postgresql` passed 44/44.

> 2026-08-04 migration record: bigint `PATCH /api/ai/workflows/[id]` now
> supports the existing `mock-generation` manual-result action through
> PostgreSQL. A PostgreSQL asset URL, image data URI, or HTTP(S) image is stored
> or resolved as a tenant-owned `ai_generation_output` asset, then a zero-credit
> succeeded bigint `scenario` generation and its optional stage-pointer update
> are committed in one tenant-RLS transaction. Provider I/O and credit billing
> are intentionally skipped; historical ObjectId requests retain their MongoDB
> compatibility branch. No MongoDB business data was imported, deleted, or
> re-encrypted. Targeted ESLint and `npm run test:postgresql` passed 43/43.

> 2026-08-04 migration record: the two-step direct Admin `POST
> /api/ai/generate` and `POST /api/ai/render` routes now use tenant-RLS bigint
> `floor_plan_style`, `furnishing_render`, and legacy `soft_furnishing_render`
> records. They retain their prompt-first DTO; render input is stored as a
> PostgreSQL media asset and provider submission, polling, result-media,
> idempotent credit settlement, and retry billing reuse the PostgreSQL runtime.
> Provider and storage I/O remain outside transactions. No MongoDB business
> data was imported, deleted, or re-encrypted. Targeted ESLint and `npm run
> test:postgresql` passed 42/42.

> 2026-08-04 migration record: `POST /api/ai/soft-furnishing/render` now
> persists a tenant-owned PostgreSQL input asset and a bigint
> `soft_furnishing_render` generation. It reuses the PostgreSQL provider-attempt,
> poll, result-media, and idempotent credit lifecycle while retaining its
> existing DTO and `ai-scenarios` enterprise boundary. Provider and storage I/O
> remain outside transactions. No MongoDB business data was imported, deleted,
> or re-encrypted. Targeted ESLint and `npm run test:postgresql` passed 41/41.

> 2026-08-04 migration record: `POST /api/ai/advice` and
> `POST /api/ai/creation/prompt-assist` now create tenant-RLS PostgreSQL bigint
> `advice` generations. Existing response DTOs and the `ai-scenarios` enterprise
> boundary are unchanged. Chat I/O occurs outside short database transactions;
> PostgreSQL provider-attempt records and idempotent credit hold, consume, and
> release records audit the lifecycle. No MongoDB business data was imported,
> deleted, or re-encrypted. Targeted ESLint and `npm run test:postgresql` passed
> 40/40.

> 2026-08-04 migration record: Mini Program AI asset upload, formal-plan source
> discovery, task creation/run/retry/detail/history/delete, and the lightweight
> workflow list now use tenant-RLS PostgreSQL bigint records. `miniprogram`
> generations reuse the PostgreSQL provider-attempt, media, credit-hold,
> settlement, and poll-lease lifecycle. Public paths and task DTO fields remain
> stable. Historical ObjectId assets remain readable only through the existing
> asset-delivery compatibility branch; no MongoDB business data was imported,
> deleted, or re-encrypted.

> 2026-08-04 migration record: the Admin AI Designer Agent now reads leads,
> formal floor plans, and staff through tenant-RLS PostgreSQL repositories, and
> uses the bigint workflow context for list/detail/create/recommend, confirmed
> stage submission, and baseline selection. Its tool DTOs and explicit
> confirmation behavior are preserved; bigint identifiers are also redacted
> from assistant-facing text. No
> MongoDB business data was imported, deleted, or re-encrypted. Targeted ESLint
> and `npm run test:postgresql` passed 39/39.

> 2026-08-04 migration record: bigint `POST /api/ai/workflows/[id]/run-stage`
> now prepares and submits PostgreSQL `scenario` generations through the
> existing provider-attempt lifecycle. It preserves the confirmation response,
> uses a formal v4 floor-plan control image for direction/base-render/perspective
> stages, stores that image as a tenant-owned PostgreSQL media asset, and releases
> held credits if input or provider execution fails. Successful scenario
> settlement advances the workflow and automatically selects the first base or
> soft-furnishing result, matching the existing workflow rules. `lighting` now
> records its vision-analysis and prompt-compilation calls in PostgreSQL provider
> attempts before reusing that lifecycle. The historical ObjectId route remains
> MongoDB-compatible.
> No MongoDB business data was imported, deleted, or re-encrypted. Targeted
> ESLint and `npm run test:postgresql` passed 39/39.

> 2026-08-04 migration record: `GET/POST /api/ai/workflows` and bigint
> `GET/PATCH /api/ai/workflows/[id]` now use PostgreSQL workflow, lead, and
> generation records in tenant-RLS transactions. The list preserves its
> pagination, active/archive, lead, and search DTO semantics; creation and the
> rename/stage-pointer/baseline mutations preserve the existing `ai-scenarios`
> enterprise boundary. Historical ObjectId workflow detail and mutation requests
> retain their MongoDB compatibility branch, but the collection endpoint returns
> only bigint records. The later manual-result migration record supersedes its
> earlier PostgreSQL `mock-generation` limitation. No MongoDB business data was imported, deleted, or
> re-encrypted. Targeted ESLint and `npm run test:postgresql` passed 39/39.

> 2026-08-04 migration record: GET /api/ai/workflows/[id]/source-image now
> recognizes bigint workflow IDs and streams their persisted data-URI source image
> after an RLS-scoped PostgreSQL lookup. The route retains its existing enterprise
> authentication boundary and defers the MongoDB connection to the legacy
> ObjectId/media-asset branch, so historical workflow assets remain readable.
> This is Limited: only PostgreSQL data-URI sources are delivered; public workflow
> creation, stage execution, external/provider media storage, and MongoDB data
> migration are unchanged. Targeted ESLint and npm run test:postgresql passed 39/39.

> 2026-08-04 migration record: prepared bigint workflow `scenario` generations
> now use the PostgreSQL provider-attempt lifecycle under tenant RLS. Attempts
> snapshot the workflow/stage/preset context; accepted scenario jobs can be
> claimed with the existing short `FOR UPDATE SKIP LOCKED` polling lease, then
> record polling, terminal success with media settlement and credit consumption,
> or terminal failure/release idempotently. This remains internal only: provider
> and storage I/O stay outside transactions, no public workflow-stage route or
> permission boundary has switched, and no MongoDB business data was imported,
> deleted, or re-encrypted. Targeted ESLint and `npm run test:postgresql` passed
> 39/39.

> 2026-08-03 migration record: `postgres-workflow-service` now provides a
> tenant-RLS foundation for bigint workflow creation and read context. It
> verifies the tenant-scoped lead, lead-to-floor-plan relation, and completed
> formal v4 survey eligibility before persistence, then derives the existing
> workflow/lead/generation/stage-state DTO shape from PostgreSQL records.
> `/api/ai/workflows`, source-image media persistence/delivery, provider stage
> execution, and their permissions remain on the current MongoDB runtime until
> the complete bigint execution slice can switch together. No MongoDB business
> data was imported or deleted, and no secret was re-encrypted.

> 2026-08-03 migration record: PostgreSQL workflow state now has a tenant-RLS
> mutation foundation for renaming, setting a stage pointer, and selecting a
> succeeded bigint generation as the baseline. Baseline selection locks the
> active workflow and its generation, clears prior selections, and advances the
> workflow only from the selected record's saved next-stage value. Public
> workflow mutation and provider-stage routes remain on the current MongoDB
> runtime until their complete bigint execution slice can switch together. No
> MongoDB business data was imported or deleted, and no secret was re-encrypted.
> Targeted ESLint and `npm run test:postgresql` passed 38/38.

> 2026-08-04 migration record: the PostgreSQL hold/release boundary now also
> accepts a prepared bigint `scenario` generation. It freezes and releases the
> stage's exact snapshotted `image.scenario` price through the same idempotent
> tenant-RLS ledger as free creation, leaving no frozen balance after an
> intentionally skipped submission. Provider attempt creation, media
> materialization, terminal settlement, polling, and public routes remain
> unchanged. No MongoDB business data was imported or deleted, and no secret
> was re-encrypted. Targeted ESLint and `npm run test:postgresql` passed 38/38.

> 2026-08-04 migration record: PostgreSQL workflow-stage preparation now
> validates the tenant-RLS workflow, lead, formal floor-plan eligibility, stage
> dependency, policy, and active-generation conflict before it persists one
> bigint `scenario` generation. The record carries immutable style/prompt and
> `image.scenario` price snapshots, but it does not yet submit a provider job,
> materialize media, freeze credit, or change a public route. No MongoDB
> business data was imported or deleted, and no secret was re-encrypted.
> Targeted ESLint and `npm run test:postgresql` passed 38/38.

> 2026-08-03 migration record: the connected free-creation bigint runtime
> slice is now switched. Asset upload, task list/create/archive, batch
> preparation/submission, generation image delivery, and explicit workflow
> attachment use typed PostgreSQL repositories and tenant RLS while retaining
> the existing APIs, DTOs, and `ai-scenarios` authorization boundary. Provider
> and object-storage I/O stay outside transactions; the runtime persists the
> provider attempt, output asset, and idempotent credit settlement in the
> established PostgreSQL boundaries. Task-history reads can claim tenant polls,
> and the existing protected reconciliation endpoints now claim due PostgreSQL
> work platform-wide. No MongoDB business data was
> imported or deleted, and no secret was re-encrypted. Targeted ESLint and
> `npm run test:postgresql` passed 38/38.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal provider-poll claim boundary for background workers. A short platform
> transaction selects due accepted bigint generations with `FOR UPDATE SKIP
> LOCKED`, writes an opaque poll lease and its next-poll timestamp, then returns
> only the provider routing metadata needed for I/O after commit. Guarded poll,
> success, and failure updates reject an expired or superseded lease and remove
> it when they persist state. Migration `0011_ai-generation-provider-poll-queue`
> adds the matching partial due-poll index. This is platform-internal only: no
> public route or user permission boundary has switched, and provider network
> I/O remains outside the transaction and in the connected MongoDB runtime chain.
> No MongoDB business data was imported or deleted, and no secret was
> re-encrypted. `npm run db:migrate`, `npm run db:check`, targeted ESLint, and
> `npm run test:postgresql` passed 37/37.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal batch-status reconciliation boundary. It locks a tenant-scoped bigint
> batch before its ordered generation rows, verifies the expected generation
> count, and derives the batch's existing `processing`, `succeeded`, `partial`,
> or `failed` status from their current states. Replays avoid a redundant write.
> No public route has switched: provider I/O, workflow attachment, and task/
> batch runtime execution remain the connected MongoDB chain. No MongoDB business
> data was imported or deleted, and no secret was re-encrypted. Targeted ESLint
> and `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal provider-result settlement boundary. After external storage has
> persisted an output asset, it locks the accepted bigint generation and its
> asset, verifies the immutable remote task ID, atomically binds the asset URL,
> and completes the exact idempotent credit-consumption ledger. Replays retain
> both the first asset and the consumed balance. No public route has switched:
> provider network/storage I/O and workflow attachment remain the connected
> MongoDB execution chain. No MongoDB business data was imported or deleted, and
> no secret was re-encrypted. Targeted ESLint and `npm run test:postgresql`
> passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal provider-failure settlement boundary. It locks the current accepted
> bigint attempt and generation, validates their immutable remote task ID, and
> atomically records provider failure, generation failure metadata, and the
> idempotent credit-release ledger. Replayed failure responses retain the
> released balance. No public route has switched: provider network I/O, result
> storage, successful credit-consumption invocation, and workflow attachment
> remain the connected MongoDB execution chain. No MongoDB business data was
> imported or deleted, and no secret was re-encrypted. Targeted ESLint and
> `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal result-media attachment boundary. It locks a terminal bigint
> generation and its tenant-scoped media asset, verifies the accepted attempt's
> immutable remote task ID and output ownership, then atomically binds the
> PostgreSQL asset URL. Replayed attachment keeps the original image and no
> asset can be assigned to another generation. No public route has switched:
> provider download/storage I/O, credit-consumption invocation, and workflow
> attachment remain the connected MongoDB execution chain. No MongoDB business
> data was imported or deleted, and no secret was re-encrypted. Targeted ESLint
> and `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now records
> an accepted provider attempt's terminal success internally. It locks the
> current bigint generation, verifies the immutable remote task ID, records the
> provider-result and actual-cost snapshots, and transitions both attempt and
> generation to `succeeded`; repeated terminal responses retain the first
> result. The succeeded held generation is then eligible for the existing
> idempotent credit-consumption boundary. No public route has switched: provider
> network I/O, result-media writes, consumption invocation, and workflow
> attachment remain the connected MongoDB execution chain. No MongoDB business
> data was imported or deleted, and no secret was re-encrypted. Targeted ESLint
> and `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now records
> non-terminal provider polling states internally. An accepted attempt's current
> bigint generation is locked before `processing` or `unknown` status, upstream
> diagnostics, and bounded next-poll metadata are persisted; a later processing
> response clears a transient unknown-status error. The response must retain the
> attempt's recorded remote task ID. No public route has switched: provider
> network I/O, terminal result handling, result media writes, and workflow
> attachment remain the connected MongoDB execution chain. No MongoDB business
> data was imported or deleted, and no secret was re-encrypted. Targeted ESLint
> and `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal, idempotent provider-submission acknowledgement boundary. It locks the
> current bigint generation and persists an accepted attempt's remote task ID,
> provider status, and next polling metadata. Replayed acknowledgements keep the
> originally recorded task unchanged; mismatched, stale, or untrackable task
> responses are rejected. No public route has switched: provider network I/O and
> polling, result media writes, and workflow attachment remain the connected
> MongoDB execution chain. No MongoDB business data was imported or deleted, and
> no secret was re-encrypted. Targeted ESLint and `npm run test:postgresql`
> passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal, idempotent credit-consumption boundary. It accepts only succeeded,
> held bigint generations, atomically debits the exact snapshotted price from
> both balance and frozen balance, and completes a consume ledger. Repeated calls
> retain the completed account state. No public route has switched: provider
> submission/polling, result media writes, and workflow attachment remain the
> connected MongoDB execution chain. No MongoDB business data was imported or
> deleted, and no secret was re-encrypted. Targeted ESLint and
> `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal, idempotent credit-release boundary. It releases a held bigint
> generation's exact snapshotted price in one tenant RLS transaction, records a
> release ledger, and marks the generation failed with the supplied error. A
> repeated release reuses the completed result without changing the frozen balance.
> No public route has switched: provider submission/polling, result media writes,
> successful credit consumption, and workflow attachment remain the connected
> MongoDB execution chain. No MongoDB business data was imported or deleted, and
> no secret was re-encrypted. Targeted ESLint and `npm run test:postgresql`
> passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal provider-attempt claim boundary. After a bigint generation's credit
> hold, it records the selected provider configuration, snapshotted remote model,
> request fingerprint, and submission request before marking the generation
> `processing`; retries reuse the active attempt rather than creating a duplicate
> upstream task. It performs no provider network I/O. No public route has
> switched: submission/polling, result media writes, credit consumption/release,
> and workflow attachment remain the connected MongoDB execution chain. No MongoDB
> business data was imported or deleted, and no secret was re-encrypted. Targeted
> ESLint and `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation execution now has an
> internal, tenant-RLS-scoped credit-hold boundary. It atomically claims the
> bigint generation hold ledger, verifies available credit, freezes the exact
> snapshotted price, and advances the generation to submission-ready state;
> repeated calls reuse the completed ledger without double-freezing credit.
> No public route has switched: submission/polling, result
> media writes, credit consumption/release, and workflow attachment remain the
> connected MongoDB execution chain. No MongoDB business data was imported or
> deleted, and no secret was re-encrypted. Targeted ESLint and
> `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: PostgreSQL free-creation batch preparation now
> validates bigint tasks, media assets, model profiles, prompt parameters,
> enterprise policy, and exact model-resolution pricing under the appropriate
> platform or tenant RLS transaction. It persists a pending batch and ordered
> pending generations with immutable model, parameter, and price snapshots.
> No public route has switched: provider submission/polling, result media writes,
> credit consumption/release, and workflow attachment remain the connected MongoDB
> execution chain. No MongoDB business data was imported or deleted, and no secret was
> re-encrypted. Targeted ESLint and `npm run test:postgresql` passed 36/36.

> 2026-08-03 migration record: `GET /api/ai/creation/bootstrap` now seeds and
> reads the GRS model catalog through the PostgreSQL model-profile and price
> repositories, reads active workflows plus their leads in one tenant RLS
> transaction, and keeps its existing DTO, credit, provider, and
> `ai-scenarios` boundary. Legacy MongoDB catalog maintenance remains only for
> the not-yet-migrated task/batch/generation execution chain. No MongoDB
> business data was imported or deleted, and no secret was re-encrypted.
> Targeted ESLint and `npm run test:postgresql` passed 35/35.

> 2026-08-03 migration record: `GET /api/ai/workflow-leads` now reads the
> tenant's lead/floor-plan relations and active-workflow summaries through
> PostgreSQL RLS transactions. It preserves the existing search, formal-plan
> eligibility filter, DTO, and `ai-scenarios` enterprise boundary. Workflow
> creation, stage execution, generation persistence, and media writes remain in
> the connected bigint runtime slice. No MongoDB business data was imported or
> deleted, and no secret was re-encrypted. Targeted ESLint and
> `npm run test:postgresql` passed 34/34.

> 2026-08-03 migration record: tenant-scoped PostgreSQL media assets can now
> be delivered through the existing admin and Mini Program asset-image routes.
> The asset metadata lookup runs in an RLS transaction, while local objects are
> streamed and private object-store assets retain their signed redirect behavior.
> Legacy MongoDB ObjectId URLs remain a read-only compatibility path. The
> free-creation upload, task, batch, generation, provider-execution, and workflow
> routes have not switched in this partial runtime boundary. No MongoDB business
> data was imported or deleted, and no secret was re-encrypted. Targeted ESLint
> and `npm run test:postgresql` passed 34/34.

> 2026-08-03 migration update: public enterprise branding reads through
> `GET /api/branding/[id]` now use `EnterpriseRepository` in a platform
> PostgreSQL transaction rather than MongoDB. AI workflow, generation, and
> media-asset writes and execution remain one subsequent bigint runtime slice.

> Purpose: continue the Smart Floor Planner migration from MongoDB/Mongoose to
> PostgreSQL across multiple Codex conversations. Before starting a new task,
> read this document together with the repository `AGENTS.md`, `admin/AGENTS.md`,
> `docs/admin-system-modules.md`, and its Chinese mirror.
>
> Last verified: 2026-08-03
> Current branch: `dev-jr`
> Current phase: `Phase 3 - Mongoose-to-PostgreSQL application switch`
> (in progress)

## 1. Decisions

- Target database: PostgreSQL 17.
- Target access layer: `drizzle-orm` with `pg`; migrations must remain
  reviewable SQL/Drizzle migrations.
- Strategy: create a new PostgreSQL business database. Do not migrate legacy
  enterprises, users, leads, floor plans, measurements, orders, commissions, or
  historical AI tasks.
- Retain only:
  - the active RoomiAI prompt library and its complete reference graph;
  - RoomiAI preview files and import manifests;
  - Qiniu media-storage configuration and the active provider pointer.
- New business rows do not need MongoDB ObjectId compatibility. Use UUIDv7 or
  `bigint identity` for new tables. RoomiAI rows should receive new internal IDs
  during import rather than preserving Mongo `_id` values as a new public
  contract.
- Keep `FloorPlan.layoutData` as `jsonb` for future business data. Legacy floor
  plans are not migrated in this reset.
- Do not maintain long-term MongoDB/PostgreSQL dual writes. Use a short read-only
  initialization and cutover window after code and data validation.

## 2. Verified facts

- 39 Mongoose models, 127 API routes, approximately 125 MongoDB import sites,
  and approximately 66 ObjectId-coupled files remain in the codebase.
- The current database has 40 collections, 2,558 documents, and about 27.2 MB of
  document data.
- The active RoomiAI revision contains 84 categories, 960 templates, 6
  parameter templates, 5 source models, and 960 preview assets.
- `npm run verify:roomi-prompts` passed on 2026-07-31 with 960/960 assets verified
  and no errors.
- RoomiAI previews use the local media provider and occupy about 2.5 GB under
  `admin/uploads/ai-assets`. The import manifest and snapshot are under
  `admin/.roomi-import`.
- The active Qiniu provider key is `zly-images`. Credentials are encrypted in
  `MediaStorageConfig`; the active provider pointer is stored in
  `PlatformConfig.mediaStorage`.

## 3. Retained data

Retain these prompt-library models/tables:

- `AiPromptLibraryRevision`
- `AiPromptCategory`
- `AiPromptParameterTemplate`
- `AiPromptSourceModel`
- `AiPromptTemplateAsset`
- `AiPromptTemplate`

The active RoomiAI revision is the source of truth. Failed revisions and old
`AiPromptImportRun` records do not need to be imported, but must remain in the
pre-cleanup backup.

Retain the following files:

- `admin/uploads/ai-assets`
- `admin/.roomi-import`

Retain the Qiniu configuration fields from `MediaStorageConfig`:

- provider key, bucket, region, domain, and object prefix;
- encrypted access and secret keys;
- status and last successful connectivity state.

Retain the active provider pointer from `PlatformConfig.mediaStorage`.
Preserve `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`; otherwise encrypted credentials
cannot be reused. Audit references to deleted administrators must be mapped to a
new platform administrator or set to `NULL`.

Do not delete Qiniu bucket objects as part of the database reset. Object cleanup
requires a separate inventory and explicit approval.

## 4. Phase status

Allowed status values are `not started`, `in progress`, `complete`, `blocked`,
and `cancelled`.

| Phase | Scope | Status | Evidence |
| --- | --- | --- | --- |
| Phase 0 | Decision, code inventory, retained-data definition | complete | This document and read-only inspection |
| Phase 0.1 | Active RoomiAI revision and preview verification | complete | `npm run verify:roomi-prompts` |
| Phase 0.2 | Qiniu configuration and encrypted-field verification | complete | Read-only inspection; no secrets logged |
| Phase 1 | PostgreSQL instance, roles, pooling, migration runner | complete | Codex verification and user database-health/admin-page regression passed |
| Phase 2 | PostgreSQL schema and Repository foundation | complete | Codex and user acceptance passed on 2026-08-01 |
| Phase 3 | Mongoose-to-PostgreSQL application switch | in progress | Identity/enterprise core and public branding reads, leads, formal plans, measurements/devices, prompt-library reads, roles, global promotion/media config, package catalog, promotion records, orders/commissions, enterprise activation, workflow notifications, workbench, reminder runtime, AI style presets, AI provider configuration/runtime, GRS image-model catalog and model pricing, AI action/model pricing, AI credit accounts/ledgers, AI chat sessions, enterprise AI usage snapshot reads, PostgreSQL media-asset delivery, free-creation execution, Mini Program AI task execution and administrator retry, public bigint workflow list/detail/create/state/stage execution, manual `mock-generation` result persistence, synchronous advice/prompt-assist generation, direct soft-furnishing rendering, two-step direct `generate`/`render`, and the Admin AI Designer Agent’s bigint lead/floor-plan/workflow consumers are switched. |
| Phase 4 | RoomiAI files/data and Qiniu configuration import | in progress: awaiting user acceptance | PostgreSQL active Roomi revision, 960 verified local previews, imported Qiniu configuration, and successful probe on 2026-08-01 |
| Phase 5 | Contract tests and cutover rehearsal | not started | Pending |
| Phase 6 | Production PostgreSQL cutover | not started | Pending |
| Phase 7 | End of MongoDB read-only retention | not started | Pending |

### 4.1 Two-gate acceptance rule

Starting with Phase 1, every phase must pass these gates in order:

1. **Codex verification**
   - Codex runs the migrations, idempotency, connections, privileges, schema,
     unit/integration/API contract tests, lint, build, Docker, backup/restore,
     and data checks applicable to that phase.
   - Required local services must actually be started and changed APIs or
     runtime paths exercised. Code inspection alone is not completion evidence.
   - Commands, results, warnings, uncovered scope, deletion, and secret handling
     must be recorded in this document.
2. **User acceptance**
   - After Codex verification passes, Codex provides an executable checklist
     with prerequisites, account/data requirements, pages or APIs, actions,
     expected results, and stop/rollback steps.
   - The user tests the complete primary flow of the migrated domain plus login,
     authorization, tenant isolation, and adjacent high-risk regression paths.
     Unrelated system-wide buttons need not be repeated in every phase.
   - Phase 5 and the pre-cutover gate require full admin and Mini Program
     end-to-end regression.
   - A failure returns to implementation and Codex verification before retest.

A phase becomes `complete` only after Codex verification passes and the user
explicitly confirms manual acceptance. Until then it remains
`in progress: awaiting user acceptance`.

Use this record for every phase:

| Acceptance item | Owner | Status | Date | Evidence/issues |
| --- | --- | --- | --- | --- |
| Automated and runtime verification | Codex | pending | - | Commands and results |
| Complete primary-flow manual test | User | pending | - | Pages, actions, results |
| Critical regression manual test | User | pending | - | Login, roles, tenants, adjacent flows |

## 5. Implementation sequence

1. Set up PostgreSQL, migration roles, pooling, health checks, backups, and a
   restore drill.
2. Create target tables for platform configuration, identity, prompt library,
   media configuration, and future business domains.
3. Build typed Repositories and keep existing API response DTOs stable.
4. Add JSONB, foreign keys, tenant indexes, partial indexes, RLS, and short
   transaction boundaries.
5. Switch code by domain: configuration/prompt library, identity/tenants,
   leads/surveying, orders/credits, then AI/media.
6. Import the active RoomiAI snapshot and preview files with checksum validation.
7. Import the Qiniu configuration without logging plaintext secrets.
8. Run admin, Mini Program, prompt preview, Qiniu probe, tenant, backup, and
   restore tests.
9. Perform a short read-only cutover; keep MongoDB read-only for at least 14 days.

### Phase 1 completion record (2026-07-31)

- Docker runs PostgreSQL `17.10` as the healthy
  `smart-floor-planner-postgres` service with the `postgres_data` named volume.
- `sfp_migrator` owns DDL and the database-level `CREATE` privilege required by
  the Drizzle migrator. `sfp_app` has application read/write privileges without
  DDL; `sfp_auditor` is read-only without DDL. Production deployments must not
  reuse the local Compose passwords.
- `admin/src/lib/postgresql.ts` provides the bounded singleton `pg.Pool` and
  Drizzle connection. `admin/scripts/postgres-migrate.mjs` is an independent
  migration runner, with Drizzle migration metadata stored in the `app` schema.
  Docker invokes it explicitly as the one-off `migrate` profile through
  `npm run docker:migrate`; that service read-only mounts the workspace
  `admin/drizzle/` directory so newly generated SQL cannot be hidden by a stale
  application image. The long-running admin service is not explicitly given
  `DATABASE_MIGRATION_URL`.
- Baseline migration `admin/drizzle/0000_vengeful_bishop.sql` has run and
  currently creates only `app.migration_checkpoints`. Business tables and
  Repositories belong to Phase 2.
- `npm run db:migrate`, `npm run db:check`, `npm run test:postgresql`, targeted
  ESLint, `docker compose config --quiet`, and `npm run build` passed.
- `docker compose build admin` produced an approximately 89.4 MB final image.
  `.dockerignore` excludes the approximately 2.5 GB local RoomiAI previews,
  `.roomi-import`, `.postgres-backups`, `uploads`, and all `.env*` files.
  `npm run docker:migrate` successfully ran the idempotent migration from the
  final image; image inspection found no `.env.production`, and the admin
  service had no migrator connection string.
- `npm run db:backup` produced a 4,479-byte custom-format local backup.
  `npm run db:restore-drill` restored it to an isolated database, queried
  `app.migration_checkpoints`, and removed the drill database. The ignored
  `admin/.postgres-backups/` directory is not a production backup destination.
- The successful build retained a pre-existing Windows standalone tracing
  warning for `miniprogram/images/mine-icons`; it is unrelated to Phase 1.
- Repository-wide `npm run lint` still reaches pre-existing cross-module
  findings; the PostgreSQL and health files added or changed in Phase 1 pass
  targeted ESLint.
- No MongoDB data, RoomiAI files, Qiniu objects, or encryption secrets were
  deleted, re-encrypted, or logged. MongoDB remains the sole source of business
  data.
- Production must inject credentials through secret management and use managed
  PostgreSQL PITR or an equivalent scheduled backup policy; Phase 1 verifies the
  repository's Docker backup/restore path only.

Phase 1 acceptance status:

| Acceptance item | Owner | Status | Date | Evidence/issues |
| --- | --- | --- | --- | --- |
| Migration, connection/role, tests, lint, build, Docker, backup/restore | Codex | passed | 2026-07-31 | See the completion record above |
| PostgreSQL and `/api/health` manual test | User | passed | 2026-07-31 | MongoDB `ok`, PostgreSQL `ok`, `required: true` |
| Core MongoDB-backed admin page regression | User | passed | 2026-07-31 | Pages manually tested without blank screens; user explicitly accepted |

Phase 1 user checklist:

1. In PowerShell, enter `admin/`, run `docker compose up -d postgres mongo`,
   then `docker compose ps`. Expect PostgreSQL to be `healthy` and MongoDB to be
   `Up`, with Mongo mapped as `localhost:27018 -> mongo:27017`.
2. Ensure local `MONGODB_URI` uses `localhost:27018`, and `DATABASE_URL` uses
   `localhost:5432` with the `sfp_app` role. Do not record production
   credentials here. Run
   `npm run docker:migrate` and `npm run db:check`. Both must report success,
   and the check must identify `sfp_app` with `app` schema usage.
3. Run `npm run dev`, open `http://localhost:3005/api/health`, and expect HTTP
   200 with both `databases.mongodb.status` and
   `databases.postgresql.status` equal to `ok`.
4. Sign in with an existing platform administrator and verify the workbench,
   `/leads` plus one detail, `/floorplans` plus one detail,
   `/ai-studio/create`, and `/media-storage` load without a 500 and render their
   current empty states. Full RoomiAI preview and Qiniu configuration validation
   occurs after their Phase 4 PostgreSQL import. Check Console and Network for
   new persistent PostgreSQL-related failures.
5. The Docker Mongo volume is a different data source from the old Windows
   MongoDB. It currently has three `adminusers`, while the six RoomiAI
   collections, `mediastorageconfigs`, `platformconfigs`, and `users` are empty.
   Phase 1 neither copies these rows nor creates PostgreSQL business rows.
6. Stop local databases when desired with `docker compose stop postgres mongo`.
   Do not run `docker compose down -v`, which deletes local database volumes.

Report either `Phase 1 manual test: passed` or include the failed step, page/API,
observed behavior, and Console/Network error.

Local port note: the Windows MongoDB service on this machine owns `27017`, and a
normal terminal could not change its service startup mode. Docker MongoDB
therefore publishes host port `27018` while remaining `mongo:27017` internally.
To permanently stop the Windows service, use an Administrator PowerShell:
`Stop-Service MongoDB` followed by `Set-Service MongoDB -StartupType Manual`.
This is optional for the project because `admin/.env.local` points to `27018`.

The old Windows MongoDB retained-data source was read-only rechecked on
2026-07-31 and remains intact: 84 RoomiAI categories, 960 templates, 6 parameter
templates, 5 source models, 960 template assets, one media-storage
configuration, one platform configuration, and three Mini Program users. Keep
these rows in the source database and import them directly into PostgreSQL in
Phase 4; do not pre-copy or delete them merely to populate Docker MongoDB.

### Phase 2 verification record (2026-07-31)

- `admin/src/db/schema.ts` defines 44 typed target tables covering the current
  platform, identity, tenant, prompt-library, media, AI, surveying, lead,
  commercial, workflow, and notification domains. The database reports 45
  `app` tables including Drizzle migration metadata, 95 foreign keys, and 172
  indexes.
- New rows use `bigint identity`; time values use `timestamptz`, money uses
  exact `numeric`, and evolving nested payloads use `jsonb`. Formal
  `floor_plans.layout_data` accepts only the version-4 surveying contract.
- The RoomiAI graph uses normal foreign keys from revisions to categories,
  parameter templates, source models, templates, and preview assets. One active
  revision per source is enforced by a partial unique index.
- Mongo ObjectId arrays that represent entity relationships use junction tables
  in PostgreSQL, including admin promoters, lead floor plans, and ordered
  free-creation reference assets. Batch generations are derived through their
  ordinary `creation_batch_id` foreign key.
- Twenty-six tenant or tenant-relationship tables force RLS with 52 policies.
  `withTenantTransaction` and `withPlatformTransaction` set context through
  transaction-local `set_config`, so pooled connections cannot retain a tenant.
  `sfp_app` has DML without DDL; `sfp_auditor` has SELECT without DML/DDL.
- Typed repositories exist for enterprises, departments, platform
  configuration, and the prompt library. They establish the Phase 3 pattern;
  existing API response DTOs and routes remain unchanged.
- `npm run test:postgresql` passed 10/10 tests, including cross-tenant read
  isolation, cross-tenant write rejection, platform scope, transaction rollback,
  pool-context cleanup, runtime configuration, and complete foreign-key index
  coverage.
- The migration runner applied the schema and the follow-up FK-index migration
  on PostgreSQL 17, then passed two consecutive no-op reruns. Direct use of the
  runtime `sfp_app` connection for DDL failed with PostgreSQL `42501`, as
  intended. A separate `smart_floor_planner_phase2_drill` database replayed
  migrations `0000` through `0004` from empty state, verified 45 tables, 26 RLS
  tables, 52 policies, and the strict floor-plan column contract, then was
  removed.
- `npm run db:backup` created a 226,624-byte custom-format backup.
  `npm run db:restore-drill` restored an isolated database and verified 45
  tables, 26 RLS tables, and 52 policies before removing the drill database.
- No MongoDB documents, RoomiAI files, Qiniu objects, or production business
  rows were imported or deleted. No secret was re-encrypted or logged. MongoDB
  remains the sole runtime business-data source.
- Targeted ESLint passed for all Phase 2 files and `npm run build` completed
  successfully. Repository-wide `npm run lint` still reports the pre-existing
  baseline of 263 errors and 99 warnings outside the Phase 2 files. The build
  also retains the pre-existing Windows standalone trace-copy warning for the
  save-icons route; its exit code is 0 and it is unrelated to PostgreSQL.

Phase 2 acceptance status:

| Acceptance item | Owner | Status | Date | Evidence/issues |
| --- | --- | --- | --- | --- |
| Schema, migration, privileges, RLS, Repository tests, build, backup/restore | Codex | passed | 2026-07-31 | See the Phase 2 verification record |
| Phase 2 migration and database-boundary manual test | User | passed | 2026-08-01 | User confirmed `Phase 2 manual test: passed` |
| Existing MongoDB admin regression | User | not applicable | carried from Phase 1 | No business route changed in Phase 2; repeat after the Phase 3 PostgreSQL switch |

Phase 2 user checklist:

1. In `admin/`, run `docker compose up -d postgres mongo`, then
   `npm run docker:migrate`, `npm run db:check`, and
   `npm run test:postgresql`. All commands must pass; `db:check` must report
   `sfp_app`.
2. Run `npm run db:backup` and `npm run db:restore-drill`. The drill must report
   `tableCount: 45`, `rlsTableCount: 26`, and `policyCount: 52`.
3. Run `npm run dev` and, after signing in if the route requires authentication,
   open `/api/health`; confirm MongoDB and PostgreSQL are both `ok`.
4. No page-level CRUD regression is required for Phase 2 because no business
   route changed data access. Repeat the complete CRUD, permission, and tenant
   isolation flows after the Phase 3 PostgreSQL switch.
5. Stop with `docker compose stop postgres mongo` if desired. Do not run
   `docker compose down -v`.

Report `Phase 2 manual test: passed`, or include the failed step, command/page,
observed result, and relevant error. Phase 3 must not start until this acceptance
is recorded.

### Phase 3 progress record (2026-08-01)

- The prompt-library read path now uses `PromptLibraryRepository` inside a
  platform-scoped PostgreSQL transaction for categories, paginated template
  search, template detail, and preview-asset lookup. The existing API DTOs,
  route paths, and `ai-scenarios` authorization boundary are unchanged. New
  generation batches resolve their selected prompt template and parameter
  definition through the same PostgreSQL read path.
- Added Repository coverage verifies active revision lookup, category filtering,
  template search/count, and related parameter/model/preview records.
- Global promotion configuration now reads/writes `platform_configs` through
  `PlatformConfigRepository`; `super_admin`/`admin` route roles and response DTOs
  are unchanged. Repository coverage verifies that updating promotion JSON does
  not overwrite the adjacent media-storage JSON section.
- With the existing local dev server and a five-minute locally signed admin JWT,
  authenticated `GET /api/platform/promotion-config` returned HTTP 200 and the
  normalized PostgreSQL/default DTO. Unauthenticated migrated routes returned
  HTTP 401. This runtime check performed no configuration write.
- Media-storage configuration CRUD, encrypted credential reads, connectivity-test
  state, archival, active-provider selection, and the GRS persistence pointer now
  use `MediaStorageConfigRepository` and `PlatformConfigRepository`. Qiniu probes
  remain outside transactions and use an `updatedAt` optimistic write-back. The
  `0005_fat_joseph.sql` migration replaces the single-column status index with
  `(status, created_at)` to match list ordering. MongoDB `MediaAsset` still backs
  asset statistics, and bigint audit fields remain `NULL` until MongoDB admin
  identities are replaced.
- System-role listing, idempotent default seeding, permission updates, effective
  permission resolution for Admin/Mini Program login, and admin-list permission
  mapping now use `SystemRoleRepository`. The role handler independently enforces
  platform `super_admin`/`admin` access; an authenticated admin GET returned 200
  with seven roles and string IDs, while invalid and viewer bearer tokens returned
  401 and 403. A temporary-role PATCH returned 200 with the updated menu keys and
  string ID; the exact test role was then deleted and a follow-up query returned
  zero rows.
- Admin login, session/me validation, Mini Program password/WeChat/refresh
  identity resolution, enterprise self-registration, admin/staff CRUD,
  department CRUD, and Mini Program user profile routes now use
  `AdminUserRepository`, `UserRepository`, `EnterpriseRepository`, and
  `DepartmentRepository`. PostgreSQL bigint IDs are serialized through the
  existing `_id` fields as decimal strings, and active account status is
  revalidated during session and Mini Program context resolution. The
  internal-secret-protected seed route now creates the initial PostgreSQL
  platform admin idempotently and has no built-in secret/password fallback.
- Tenant staff, department, user, and promoter-junction access runs inside
  transaction-scoped PostgreSQL RLS. Integration coverage verifies admin
  promoter relations, tenant visibility, Mini Program OpenID lookup/profile
  updates, and cross-tenant denial. Enterprise creation and the automatic
  enterprise-admin account insert are atomic.
- Lead list/detail/create/update/delete, formal floor-plan CRUD/detail/DXF,
  measurement list/create, and device list/verify/binding/mutations now use typed
  `LeadRepository`, `FloorPlanRepository`, `MeasurementRepository`, and
  `DeviceRepository` access. Decimal-string `_id` DTOs preserve the current API
  shape while all relations use PostgreSQL bigint keys and RLS transactions.
  Relations are batch-loaded instead of per-row queries; lead status counts use
  one grouped query.
- Lead-floor-plan junction updates, primary-plan selection, tenant validation,
  delete cleanup, and Kujiale-plan persistence/linking are atomic. Kujiale network
  calls stay outside database transactions. Imported room outlines are converted
  to a formal millimetre version-4 wall graph; openings are omitted until the
  upstream response supplies a reliable opening-to-wall mapping.
- Device `assigned_user_id` now references `admin_users`, matching staff binding.
  Measurement writes validate operator, enterprise, formal plan, value/type/source,
  date, and assigned device. Query-aligned FK/composite indexes cover the migrated
  tenant, relation, phone, status, and time-ordered paths.
- `/api/miniprogram/home`, `/api/miniprogram/mine`, `/api/users`, the admin
  floor-plan detail page, and the user detail export list now consume the migrated
  repositories. Home returns `aiGeneratedCases: 0` until AI generation moves;
  Mine now reads promotion/workbench todos from PostgreSQL. Orders and
  commissions remain MongoDB-backed and are not queried with PostgreSQL bigint IDs.
- Package catalog list/create/update/delete now uses `PackageRepository` in
  platform-scoped PostgreSQL transactions. Existing `_id` response fields carry
  decimal bigint strings while prices and promotion commissions remain exact
  `numeric(14,2)` values. Migration `0008_whole_gravity.sql` adds the database
  uniqueness contract for package names; the existing `(status, created_at)`
  index matches filtered list ordering. Orders and commissions deliberately
  remain on MongoDB because their legacy ObjectId relations have not yet been
  converted, avoiding a mixed-store foreign-key boundary.
- Promotion records, pool/conflict operations, workflow notifications, workbench
  summary/todos, and reminder automation now run on the PostgreSQL repositories.
  Migrations
  `0009_neat_rafael_vega.sql` and `0010_eminent_wildside.sql` replace JSON-only
  hot-path state with explicit bigint foreign keys for claim review,
  measurement/design assignment, and conflict review; add the corresponding
  role/query indexes; and align notification deduplication with the existing
  `(dedupeKey, channel)` contract. `PromotionRecordRepository` and
  `WorkflowNotificationRepository` provide RLS-scoped role visibility, relation
  loading, duplicate lookup, atomic conditional transitions, timeline appends,
  notification listing, and recipient-scoped alert acknowledgement. Runtime
  mutations use short RLS transactions with conditional state updates; WeChat
  subscription dispatch runs after commit. Existing response DTOs and role
  boundaries remain unchanged, and no dual write was introduced.
- `/api/admin/enterprises/activate` now runs entirely in a PostgreSQL platform
  transaction. It validates the promotion record and optional order relation,
  checks account identity conflicts, creates the enterprise/admin account, and
  then binds the applicable PostgreSQL order rows while advancing the promotion
  record to `paid`. No MongoDB reads or writes, data import, deletion, or secret
  re-encryption occur in this slice. Enterprise AI key/sync/usage/credits,
  branding, and AI generation/workflow/media consumers remain unswitched. Core
  enterprise responses expose `aiUsageSnapshot: null`, and MongoDB AI routes
  that reference migrated bigint lead/plan IDs remain `Limited` until their
  slice.
- Drizzle migrations `0006_exotic_wild_pack.sql` through
  `0010_eminent_wildside.sql` were generated and
  applied with the dedicated migration container/role. Direct DDL through the
  runtime `sfp_app` role was rejected with PostgreSQL `42501`, preserving the
  intended privilege boundary. `npm run test:postgresql` passes 25/25 and
  `npm run test:ai` passes 106/106.
  Targeted ESLint and the production build pass. Read-only HTTP smoke checks
  return 401 without authentication and 200 with a short-lived local admin bearer
  token for leads, floor plans, devices, measurements, and users; unauthenticated
  promotion, pool, notification, workbench, and reminder routes returned 401. The Mini Program
  suite passes 90/91; its one pre-existing API-environment assertion expects
  `localhost` while the configured local base is `192.168.10.111`, which is
  unrelated to this PostgreSQL slice. The build exits 0 with the known Windows
  standalone trace-copy warning for `save-icons`.
- AI style-preset default seeding, reads, and platform-admin updates now use
  `AiStylePresetRepository` in platform-scoped PostgreSQL transactions. The
  public preset DTO continues to expose the PostgreSQL bigint as a string `_id`.
  Targeted ESLint and the PostgreSQL integration suite pass (26/26). The
  subsequent Mini Program retry migration also corrected the legacy retry
  route's `enterpriseId` boundary to pass the string identifiers required by
  the AI task context.
  Generation task persistence/model-profile synchronization and AI
  workflows/generation/media still require Phase 3 work. Their legacy MongoDB
  ObjectId boundaries remain `Limited` until their dependent slices are migrated.
- No MongoDB documents, PostgreSQL production rows, Qiniu objects, or secrets
  were imported, re-encrypted, or logged in this slice. One API-test-only archived
  row with a `phase3-api-*` key was deleted after an exact prefix check; the
  immediate follow-up query returned zero matching rows.
- On 2026-08-02, AI provider configuration/runtime was switched to
  `AiProviderConfigRepository` in platform PostgreSQL transactions. Provider
  CRUD, key rotation, connection testing, model discovery, upstream balance,
  environment-default seeding, and runtime selection preserve their routes,
  DTOs, and `super_admin`/`admin` `ai-providers` permission boundary. Encrypted
  values are not logged; asynchronous provider calls complete before only
  non-secret operational state is persisted. Targeted ESLint and
  `npm run test:postgresql` passed 28/28. The full TypeScript check still has
  the pre-existing test-only errors recorded above, none in this provider slice.
- On 2026-08-02, platform action prices and free-creation model/resolution
  prices were switched to `AiCreditPriceRepository` and
  `AiModelCreditPriceRepository` in platform PostgreSQL transactions. The
  existing `/api/admin/ai-credit-prices` and
  `/api/admin/ai-image-model-prices` routes retain their `super_admin`/`admin`
  boundary and DTOs; price values use PostgreSQL `bigint` internally and return
  API numbers. `AiCreationModelProfile` remains MongoDB-backed because tasks,
  batches, and generations retain its legacy ObjectId references. No MongoDB
  data was imported or deleted. Targeted ESLint and `npm run test:postgresql`
  passed 29/29. Until the creation runtime slice moves, its MongoDB numeric
  batch and billing snapshots reject PostgreSQL prices outside the positive
  JavaScript-safe-integer range rather than silently rounding them.
- On 2026-08-02, AI credit accounts and ledgers were switched to
  `AiCreditRepository` in tenant PostgreSQL transactions. The unique
  `operationId` ledger constraint now makes grant, adjustment, hold, consume,
  and release requests idempotent with each balance change; PostgreSQL bigint
  values remain API numbers. The platform enterprise-credit route now reads
  PostgreSQL enterprises, account, policy, and ledger rows, while its task list
  remains MongoDB-backed until generation persistence moves. Legacy generation
  ObjectIds are intentionally stored as `NULL` ledger generation references;
  no MongoDB data was imported or deleted. Targeted ESLint,
  `npm run test:postgresql` (30/30), and `npm run test:ai` (106/106) passed.
- On 2026-08-02, `AiCreationModelProfileRepository` was added as the
  PostgreSQL foundation for the free-creation execution chain. It upserts the
  global GRS catalog, retains explicit enabled/default settings, and provides
  bigint-safe catalog lookups. No public route is switched in this foundation
  step because creation tasks, batches, generations, provider attempts, media
  assets, and workflows must move together to avoid a MongoDB ObjectId to
  PostgreSQL bigint foreign-key split. No MongoDB data was imported or deleted,
  and no secret was re-encrypted. Targeted ESLint and `npm run test:postgresql`
  passed 31/31.
- On 2026-08-03, `AiCreationRepository` added the PostgreSQL persistence
  contract for tenant-scoped media assets, creation tasks, batches and ordered
  reference assets, generations, and provider attempts. Its integration test
  verifies bigint relations, RLS isolation, task-view loading, current-attempt
  updates, and the intentional archival rule that soft-deleting a task marks
  its generations deleted without destroying their historical rows. No public
  route is switched: workflow creation/attachment and the existing media and
  provider execution services still use MongoDB ObjectIds and must migrate in
  the same runtime slice. No MongoDB data was imported, deleted, or re-encrypted.
  Targeted ESLint and `npm run test:postgresql` passed 32/32.
- On 2026-08-03, `AiWorkflowRepository` added RLS-scoped workflow create,
  list, lookup, update, and succeeded free-creation attachment primitives. The
  attachment transaction locks the workflow and generation rows, selects only
  the first attached result as the baseline, and preserves later successful
  attachments as candidates while advancing `lastGenerationId`. Integration
  coverage verifies bigint relations and cross-tenant invisibility. No public
  route has switched, and no MongoDB business data was imported, deleted, or
  re-encrypted. Targeted ESLint and `npm run test:postgresql` passed 33/33.
- On 2026-08-03, `postgres-creation-service` added a PostgreSQL-only
  free-creation batch-preparation primitive. It verifies the tenant-owned task
  and reference assets, enabled global model profile, active prompt-template
  constraints, enterprise policy, and exact bigint model-resolution price before
  creating a pending batch and pending generations with model, parameter, and
  price snapshots. No route has switched because the credit-hold, provider
  attempt, polling, media-write, and workflow-attachment paths must move with
  this persistence step. No MongoDB business data was imported, deleted, or
  re-encrypted. Targeted ESLint and `npm run test:postgresql` passed 36/36.
- On 2026-08-02, the unused WeCom configuration, group-sharing API/UI, and
  employee WeCom identifiers were deprecated rather than migrated. The feature
  was removed from runtime code and documentation; legacy MongoDB fields and
  the PostgreSQL `admin_users.wecom_user_id` column remain intact without a data
  migration or destructive cleanup.

Phase 3 acceptance status:

| Acceptance item | Owner | Status | Date | Evidence/issues |
| --- | --- | --- | --- | --- |
| Prompt-library/role/config APIs, Repository integration tests, lint/build | Codex | passed | 2026-08-01 | 15/15 PostgreSQL and 106/106 AI tests; targeted ESLint/build; migrated API auth checks 200/401/403 |
| Identity/enterprise core APIs, RLS Repository tests, lint/build | Codex | passed | 2026-08-01 | PostgreSQL 17/17; AI 106/106; targeted ESLint/build; live invalid login and unauthenticated identity requests returned 401; bigint `_id` DTO compatibility and remaining mixed-store boundaries documented |
| Leads/formal plans/measurements/devices and Mini Program aggregates | Codex | passed | 2026-08-01 | PostgreSQL 18/18; AI 106/106; targeted ESLint/build; authenticated migrated list APIs 200 and unauthenticated APIs 401; tenant isolation and relation cleanup covered; Mini Program 90/91 with one unrelated API-environment expectation failure |
| Package catalog API and Repository | Codex | passed | 2026-08-01 | PostgreSQL 20/20; targeted ESLint/build; authenticated GET 200 and unauthenticated GET 401; `0008` applied by migration container and unique index verified; runtime role DDL denied with `42501`; both source/target package tables had 0 rows, so no business import was required |
| Promotion records/workflow runtime and notification automation | Codex | passed | 2026-08-02 | `0009`/`0010` applied by the dedicated migrator; PostgreSQL 23/23; targeted ESLint and production build passed; tenant RLS, role visibility, FK index coverage, conditional state transitions (including optimistic approval/rejection/release), relation DTOs, channel-scoped notification dedupe, route cutover, workbench todos, and reminder automation verified |
| AI style-preset runtime | Codex | passed | 2026-08-02 | Default seeding, reads, and administrator updates use `AiStylePresetRepository` and platform transactions; JSON image-field updates preserve adjacent fields; PostgreSQL integration suite 26/26 and targeted ESLint passed. No business data was imported or deleted. |
| AI action and model pricing | Codex | passed | 2026-08-02 | Default action pricing plus free-creation model/resolution pricing use `AiCreditPriceRepository` and `AiModelCreditPriceRepository` in platform transactions; APIs and administrator boundary are unchanged; PostgreSQL `bigint` credits serialize as numbers. Targeted ESLint and PostgreSQL integration suite 29/29 passed. Model profiles remain MongoDB-backed pending their ObjectId-dependent slice. |
| AI credit accounts and ledgers | Codex | passed | 2026-08-02 | `AiCreditRepository` applies idempotent grant, adjustment, hold, consume, and release operations with RLS-scoped PostgreSQL transactions; bigint account/ledger values serialize as API numbers. The enterprise-credit route now reads PostgreSQL account, policy, and ledger data. Legacy MongoDB generation IDs remain `NULL` ledger references until the generation slice. PostgreSQL 30/30 and AI 106/106 passed. |
| AI creation model-profile Repository foundation | Codex | foundation verified | 2026-08-02 | `AiCreationModelProfileRepository` upserts global GRS catalog records and preserves explicit runtime enabled/default settings; PostgreSQL 31/31 and targeted ESLint passed. No route cutover or data import occurred because dependent task/batch/generation/media/workflow foreign keys must switch together. |
| AI creation persistence Repository foundation | Codex | foundation verified | 2026-08-03 | `AiCreationRepository` now covers RLS-scoped media, tasks, batches, reference-asset links, generations, and provider attempts; it preserves generation history when a task is archived. PostgreSQL 32/32 and targeted ESLint passed. No route cutover or data import occurred because workflow/media/provider execution consumers still require one bigint runtime slice. |
| AI workflow Repository foundation | Codex | foundation verified | 2026-08-03 | `AiWorkflowRepository` provides RLS-scoped workflow CRUD primitives and locks a workflow plus succeeded free-creation generation during attachment. The first attached generation becomes the selected baseline and later attachments remain candidates. PostgreSQL 33/33 and targeted ESLint passed; no route cutover or data import occurred. |
| PostgreSQL media-asset delivery boundary | Codex | partial verification | 2026-08-03 | `/api/ai/assets/[id]/image` and `/api/miniprogram/ai/assets/[id]/image` resolve decimal bigint IDs in tenant RLS scope and preserve existing local-buffer/private signed-redirect delivery. Legacy ObjectId URLs remain read-only MongoDB compatibility. PostgreSQL 34/34 and targeted ESLint passed; upload, task, batch, generation, execution, and workflow routes remain pending in the connected bigint slice. |
| AI workflow-lead selector | Codex | partial verification | 2026-08-03 | `GET /api/ai/workflow-leads` now uses `LeadRepository` search/updated-time ordering and `AiWorkflowRepository` active summaries in one tenant RLS transaction. Existing DTO, formal-plan eligibility filter, and `ai-scenarios` boundary are unchanged. PostgreSQL 34/34 and targeted ESLint passed; workflow writes and generation execution remain pending. |
| AI free-creation bootstrap read | Codex | partial verification | 2026-08-03 | `GET /api/ai/creation/bootstrap` initializes and reads GRS bigint model profiles/prices through PostgreSQL, and reads active workflows with their leads in a tenant RLS transaction. Its DTO, credit, provider, and `ai-scenarios` boundary are unchanged. Legacy MongoDB model-profile maintenance remains only for the unswitched task/batch/generation execution chain. PostgreSQL 35/35 and targeted ESLint passed. |
| AI free-creation batch preparation foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` validates bigint task, asset, catalog profile, prompt parameter, policy, and model-price relations under platform/tenant RLS before creating a pending batch and generations with model/parameter/price snapshots. No route cutover or data import occurred; provider execution, polling, media writes, consumption/release, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation credit-hold foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` atomically claims a bigint generation hold ledger, verifies available credit, freezes the immutable generation price, and marks it submission-ready in a tenant RLS transaction. Repeated calls reuse the completed ledger. No route cutover or data import occurred; provider execution, polling, media writes, consumption/release, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation provider-attempt foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` atomically records the selected provider configuration, snapshotted model, request fingerprint, and request snapshot for a held bigint generation, then marks it `processing`. Repeated calls reuse the active attempt. No network I/O, route cutover, or data import occurred; submission/polling, media writes, consumption/release, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation provider-submission acknowledgement foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` locks the current bigint generation and persists an accepted attempt's remote task ID, provider status, and polling metadata. Repeated acknowledgements preserve the first task ID; stale or conflicting responses are rejected. No network I/O, route cutover, or data import occurred; provider polling, media writes, completion, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation provider-poll-state foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` locks an accepted attempt's current bigint generation before persisting its non-terminal `processing` or `unknown` provider state, diagnostics, and bounded next-poll metadata. The recorded remote task ID cannot change, and a later processing state clears transient unknown diagnostics. No network I/O, route cutover, or data import occurred; terminal handling, media writes, completion, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation batch-status reconciliation foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` locks a tenant-scoped bigint batch before its ordered generation rows, verifies the requested-count contract, and reconciles `processing`, `succeeded`, `partial`, or `failed` from current generation states without a redundant replay write. Provider I/O, workflow attachment, public route cutover, and data import remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation provider-result settlement foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` locks a succeeded accepted bigint generation and its tenant-scoped output asset, rechecks the immutable remote task ID, then binds the PostgreSQL asset URL and completes the exact idempotent consumption ledger in one short RLS transaction. Replays retain the first asset and account balance. Provider network/storage I/O, workflow attachment, public route cutover, and data import remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation provider-success foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` locks the current bigint generation, verifies the accepted attempt's immutable remote task ID, persists terminal provider-result/actual-cost snapshots, and transitions both rows to `succeeded`. Replayed successes retain the original result and make the still-held generation eligible for the existing idempotent consumption boundary. No network I/O, route cutover, or data import occurred; result-media writes, consumption invocation, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation result-media attachment foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` locks a terminal bigint generation plus its tenant-scoped result asset, validates the accepted attempt and immutable remote task ID, and atomically writes the PostgreSQL asset URL while binding the unclaimed result asset to that generation. Replays preserve the original image and another generation cannot claim the asset. No provider download/storage I/O, route cutover, or data import occurred; consumption invocation and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation provider-failure settlement foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` locks the current accepted bigint attempt and generation, verifies the immutable remote task ID, records terminal provider/generation failure metadata, and completes the idempotent release ledger in the same tenant RLS transaction. Replayed failures preserve the released balance. No provider I/O, route cutover, or data import occurred; result storage, successful consumption invocation, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation credit-release foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` atomically releases a held bigint generation's snapshotted price, completes an idempotent release ledger, and marks the generation failed. Repeated releases preserve the frozen balance. No route cutover or data import occurred; provider submission/polling, media writes, successful consumption, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| AI free-creation credit-consumption foundation | Codex | foundation verified | 2026-08-03 | `postgres-creation-service` atomically consumes a succeeded, held bigint generation's snapshotted price from both balance and frozen balance and completes an idempotent consume ledger. Repeated calls preserve the completed account state. No route cutover or data import occurred; provider submission/polling, media writes, and workflow attachment remain pending. PostgreSQL 36/36 and targeted ESLint passed. |
| Orders, commissions, and workbench totals | Codex | partial verification | 2026-08-02 | `CommercialRepository` and the existing RLS-protected target tables now back the order, commission, settlement, voiding, commission-record, and workbench routes; targeted lint and PostgreSQL integration suite (23/23) passed. Dedicated commercial route and transition coverage remains pending |
| Prompt-library primary-flow manual test | User | pending | - | Requires an active PostgreSQL prompt revision after the Phase 4 import |
| Login, authorization, tenant, and adjacent AI regression | User | pending | - | Must be repeated after the remaining Phase 3 slices |

### Phase 4 progress record (2026-08-01)

- Added `admin/scripts/import-phase4-retained-data.ts` and the explicit
  `npm run migrate:phase4-retained-data` command. It imports only the retained
  RoomiAI snapshot, its manifest-indexed previews, and the active Qiniu
  configuration from the read-only legacy MongoDB source; it never imports or
  deletes other business collections or Qiniu objects.
- The active PostgreSQL Roomi revision is
  `roomi-522ebb4f5d521fc54409b70b5650b4b10631943ee99efa48c1a632588a398df4`
  with 84 categories, 960 templates, 6 parameter templates, 5 source models,
  and 960 preview assets. The imported manifest/content hashes match the source
  snapshot. All 960 staged files passed size, SHA-256, and image-dimension
  checks before import and were read and hashed again after storage.
- The `zly-images` Qiniu configuration and active provider pointer were
  imported without logging plaintext credentials. The legacy administrator
  audit reference was deliberately mapped to `NULL`. A full upload, stat,
  private signed-download, content, and cleanup probe passed; the temporary
  probe object was deleted. Production deployment still must supply the
  dedicated `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` that can decrypt the imported
  credentials.
- The importer is idempotent: its final rerun detected the complete active
  revision, verified all 960 local objects, and repeated the Qiniu probe. Its
  `app.migration_checkpoints` entry is `phase4-retained-data` with
  `status: codex_verified`.
- `npm run test:postgresql` passed 18/18 and `npm run test:ai` passed 106/106.
  Authenticated prompt-category and prompt-template API smoke requests both
  returned HTTP 200. No MongoDB document, snapshot file, or Qiniu production
  object was deleted; source data remains available for rollback/reference.

Phase 4 acceptance status:

| Acceptance item | Owner | Status | Date | Evidence/issues |
| --- | --- | --- | --- | --- |
| Import, idempotency, integrity checks, Qiniu probe, and automated tests | Codex | passed | 2026-08-01 | `phase4-retained-data` checkpoint; 84/960/6/5/960 counts; 960 verified previews; 18 PostgreSQL and 106 AI tests passed |
| Prompt-library and preview primary flow | User | pending | - | Requires the active PostgreSQL Roomi revision in the admin UI |
| Qiniu configuration and critical regression | User | pending | - | Confirm media-storage configuration, login, permissions, and tenant boundaries |

## 6. Rollback

Before PostgreSQL accepts business writes, switching back to MongoDB is direct.
After PostgreSQL accepts writes, the old MongoDB copy is stale and cannot be used
as an automatic rollback target. A tested PostgreSQL change-replay or rebuild
tool is required before Phase 6 can be considered rollback-ready.

## 7. Continuation protocol

Every new migration task must report the document date, current phase status,
files being changed, whether destructive deletion or secret re-encryption is
involved, and the evidence produced. Update this document after each completed
phase. Never advance a phase based only on conversation memory.

Phase 3 identity/enterprise core plus leads, formal floor plans, measurements,
devices, their Mini Program aggregates, the package catalog, promotion workflow
runtime, orders, commissions, enterprise activation, AI style presets, AI
provider configuration/runtime, AI action/model pricing, AI credit accounts/ledgers,
AI creation foundations, and public bigint workflow list/create/detail/state
mutations are switched. The connected bigint free-creation task, batch,
generation, media, provider-attempt, and explicit workflow-attachment runtime
is also switched. PostgreSQL workflow-stage execution now covers every scenario
stage, including `lighting` vision analysis and prompt compilation, plus formal-plan
control-image/provider-input materialization. The Admin AI Designer Agent is now
also a bigint lead/plan consumer. Mini Program AI task execution, synchronous
advice, prompt assistance, direct soft-furnishing rendering, and two-step direct
Admin `generate`/`render`, the manual `mock-generation` compatibility action,
and the administrator Mini Program task retry now use PostgreSQL bigint records.
Beyond the completed Phase 4
whitelist import, do not import production business data without an explicit
migration slice and acceptance record.
