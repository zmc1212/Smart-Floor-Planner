# PostgreSQL Migration Plan And Progress

> Purpose: continue the Smart Floor Planner migration from MongoDB/Mongoose to
> PostgreSQL across multiple Codex conversations. Before starting a new task,
> read this document together with the repository `AGENTS.md`, `admin/AGENTS.md`,
> `docs/admin-system-modules.md`, and its Chinese mirror.
>
> Last verified: 2026-07-31
> Current branch: `dev-jr`
> Current phase: `Phase 1 - PostgreSQL infrastructure` (complete)
> Next phase: `Phase 2 - PostgreSQL target schema and Repositories` (not started)

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
| Phase 2 | PostgreSQL schema and Repository foundation | not started | Pending |
| Phase 3 | Mongoose-to-PostgreSQL application switch | not started | Pending |
| Phase 4 | RoomiAI files/data and Qiniu configuration import | not started | Pending |
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
  `npm run docker:migrate`; the long-running admin service is not explicitly
  given `DATABASE_MIGRATION_URL`.
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

Phase 1 has passed both acceptance gates. The next task begins with Phase 2:
design the target platform, identity, tenant, prompt, media, and AI
configuration tables; add typed Repositories, transaction boundaries, indexes,
RLS, and cross-tenant tests. Do not import or delete production business data
during this schema-first work.
