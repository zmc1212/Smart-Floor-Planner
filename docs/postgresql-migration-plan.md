# PostgreSQL Runtime Architecture

This document records the current database boundary. It is not a migration
diary. Git history contains the implementation sequence and old phase notes.

## Current decision

- PostgreSQL 17, accessed through `drizzle-orm` and `pg`, is the runtime source
  for migrated business domains.
- New business records use PostgreSQL identity values (primarily `bigint`);
  public DTOs keep the existing string `_id` shape where compatibility requires
  it.
- Tenant reads and writes run through repository transactions with PostgreSQL
  RLS. Route handlers retain their existing authentication and role boundaries.
- `FloorPlan.layoutData` remains JSONB and contains only the version-4
  surveying contract: `version`, `measurementMode: 'surveying'`, and
  `surveyGraph`.
- The deployed application is PostgreSQL-only. Historical MongoDB documents
  and containers are outside the deployed runtime; compatibility branches are
  limited to explicitly documented legacy identifiers.

## Migrated runtime areas

Identity and enterprise context, staff and roles, leads, formal floor plans,
measurements, BLE device records, packages, orders, commissions, promotion and
notification workflows, media storage, AI providers/pricing/credits, AI
generation workflows, Mini Program AI tasks, and the Admin AI Designer Agent use
PostgreSQL repositories. External provider and object-storage I/O stays outside
short database transactions.

## Retained external data

The active RoomiAI prompt revision and its template graph, preview assets, and
the active Qiniu media-storage configuration are retained. Credentials remain
encrypted in the existing configuration model. No historical business-document
import is part of the current runtime contract.

## Operational boundaries

- Run repository/RLS contract tests before changing a migrated route.
- Use explicit DTO serialization for `bigint`; do not return repository rows
  directly from an API handler.
- A PostgreSQL write cannot be rolled back by switching to the stale MongoDB
  copy. Restore PostgreSQL from the tested backup/rebuild procedure instead.
- `npm run db:backup` creates a custom PostgreSQL dump and records its duration.
  `npm run db:restore-drill` restores only into the fixed
  `smart_floor_planner_restore_drill` database, verifies the current app-schema
  table/RLS/policy counts, records restore duration, and removes that drill
  database afterwards.
- Data deletion, secret re-encryption, bucket cleanup, and a new migration slice
  require a separate approved operational procedure.

## Current verification

The active code, migrations, repository tests, and deployment configuration are
the source of truth for completion. This file records architecture only; dated
test reports and per-route migration records are intentionally not maintained.

English mirror: [postgresql-migration-plan.zh-CN.md](./postgresql-migration-plan.zh-CN.md)
