# Admin production deployment and rollback

This is the production operations contract for `admin/release.bat`,
`admin/auto_deploy.sh`, and `admin/deploy.sh`. The workflow performs application
delivery, a verified pre-migration backup, and application-image rollback. It
never automatically restores production data or runs a migration backwards.

## One-time server preparation

Use a stable root such as `/datas/smartfloor`:

```text
/datas/smartfloor/
  .env.production
  auto_deploy.sh
  sfp-admin-release-YYYYMMDD-NNN.zip
  sfp-admin-release-YYYYMMDD-NNN.zip.sha256
  releases/
  deploy-state/
  backups/postgresql/
```

Keep `.env.production` only on the server, outside ZIP archives, Git, and Docker
images, with mode `600`. Production must set `AUTH_COOKIE_SECURE=true`,
`ALLOW_TENANT_ENTERPRISE_RESET=false`, and at least 32 random characters for
`JWT_SECRET`, `INTERNAL_SECRET`, `CRON_SECRET`, and
`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`. Configure a
dedicated low-privilege active account through `DEPLOY_SMOKE_USERNAME` and
`DEPLOY_SMOKE_PASSWORD`. Optional comma-separated authenticated read-only GET
checks use `DEPLOY_SMOKE_PATHS`; `/api/auth/me` is always checked.

The script first honors `SFP_ENV_FILE`, then the deployment-root environment
file. A legacy `sfp-admin-release/.env.production` is accepted only as a
transition fallback. An existing Admin or PostgreSQL container supplies its
Compose project label so the existing PostgreSQL volume remains attached.
Without an existing container the default project is `smart-floor-planner`;
exceptional installations may explicitly set `SFP_COMPOSE_PROJECT` and must
keep it stable.

Compose binds PostgreSQL only to host loopback `127.0.0.1:5432`; containers use
the private Compose network. Cloud firewall and host firewall rules must still
deny public port `5432`.

## Build

Run `release.bat` from `admin`. It executes ESLint, survey, AI, and PostgreSQL
tests, a Next.js production build, and a no-cache Docker build. It generates the
next daily `YYYYMMDD-NNN` version or accepts an explicit value such as:

```powershell
release.bat -Version 20260901-001
```

The outputs are the versioned ZIP, its `.sha256` sidecar, and
`auto_deploy.sh`. The ZIP contains the equally versioned Docker image, Compose,
migrations, build metadata, and nested integrity manifests; it contains no
runtime environment file.

## Deploy

Upload all three outputs to the stable root and run:

```bash
chmod +x auto_deploy.sh
./auto_deploy.sh deploy
```

An exact ZIP can be selected as the second argument. The workflow obtains an
exclusive lock, verifies the outer ZIP hash, extracts into a random staging
directory, verifies package and migration hashes, promotes the immutable
release directory, rejects unsafe production settings before touching the
database, preserves the Compose project and PostgreSQL volume, creates
and catalogs a non-empty custom dump with its SHA-256, runs Drizzle migrations,
recreates Admin and the claim worker, and requires health, worker health,
authenticated login, `/api/auth/me`, and configured core reads to pass.
Compose validation explicitly enables the `migration` profile so its
profile-scoped `migrate` service is included in the preflight service check.
The migration container uses the Drizzle files baked into the verified release
image, avoiding a host bind mount whose path can differ after release promotion.

Only a fully verified release becomes current. If verification fails after the
new image starts, the script attempts to restore the image that was running
before deployment; database migrations are never reversed.

## Status and rollback

```bash
./auto_deploy.sh status
./auto_deploy.sh rollback
./auto_deploy.sh rollback 20260901-001
```

Rollback switches only Admin and worker images and repeats health and
authenticated smoke checks. Every migration must therefore remain compatible
with the immediately previous application. An incompatible schema change needs
an explicit expand/migrate/contract rollout rather than relying on image
rollback.

Per-release dumps supplement, but do not replace, scheduled encrypted off-host
backups, retention, alerting, and regular restore drills. Production restore is
a separately approved high-risk operation and is never initiated by these
deployment scripts.

Chinese mirror: [production-deployment.zh-CN.md](./production-deployment.zh-CN.md)
