# Lead Claim Expiry Worker Operations

## Release and startup

1. Apply PostgreSQL migration `0038_lead_claim_racing.sql` before deploying the Admin/API and worker.
2. Configure the same database connection as Admin, `CRON_SECRET`, and the application base URL. The Docker Compose service is `lead-claim-worker`; its command is `npm run worker:lead-claims`.
3. The worker invokes the internal scan every two seconds. Under healthy operation, expired windows should be assigned within five seconds.

## Health and diagnostics

- Call `GET /api/internal/lead-claim-windows/run` with `x-cron-secret: <CRON_SECRET>` to read the last scan, last success/failure, processed count, and recent error.
- `node scripts/lead-claim-worker-healthcheck.mjs` exits nonzero when the API is unavailable or the last successful scan is older than 15 seconds; Docker Compose uses it as the healthcheck.
- Runtime logs use the `[lead-claim-worker]` prefix. A scan failure never extends claim eligibility: the claim API always enforces database `expiresAt` and resolves an overdue window transactionally as a fallback.

## Concurrency and recovery

- Scans use `FOR UPDATE SKIP LOCKED`, followed by a per-enterprise transaction advisory lock. Multiple workers cannot assign the same window twice or race the persistent 70/30 counters.
- Restart is safe. Unresolved `open` windows remain in PostgreSQL and are picked up after recovery; manually assigned or claimed windows are skipped.
- If no designer is eligible, resolution records the automatic attempt and the lead becomes `assignment_pending/designer_unavailable`; the owner is notified. After staff profile, pause, or capacity recovery, use the existing assignment retry path.
- For repeated failures, check Admin health, matching `CRON_SECRET`, migration state, and database/RLS connectivity. Do not recover by changing `expiresAt` or editing distribution counters directly.

Chinese mirror: [lead-claim-worker-operations.zh-CN.md](./lead-claim-worker-operations.zh-CN.md)
