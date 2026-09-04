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

## Live request logs

The production domain uses system-installed Nginx. Its access log is the source
for all HTTP requests that reach that virtual host, including static resources,
API responses and upstream failures. Find the actual `server`/`location` log
configuration first:

```bash
sudo nginx -T 2>&1 | grep -E 'server_name|access_log|error_log'
```

If the domain uses the standard paths below, follow them; otherwise substitute
the configured paths. `-F` continues following a file after log rotation.

```bash
sudo tail -n 100 -F /var/log/nginx/access.log /var/log/nginx/error.log
```

From another SSH terminal, send a non-mutating probe, then reproduce the scan:

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' https://smartfloor.zlyun168.com/api/health
```

Nginx records access when request processing finishes. If the probe is absent,
check the matching virtual host and location: `access_log off`, a different file,
conditional logging or `buffer`/`flush` can suppress or delay a line. For all
requests, enable an unconditional `access_log` on the site and remove overriding
`off` directives from relevant locations. An unbuffered directive such as
`access_log /var/log/nginx/smartfloor.access.log combined;` writes each completed
request. Use the site's existing log format if it contains needed timing fields.
Validate a configuration edit with `sudo nginx -t`, then use
`sudo systemctl reload nginx`; follow the configured file after reloading.
The repository does not remotely modify Nginx configuration.

Application output is separate:

```bash
docker logs --tail 200 --timestamps -f smart-floor-planner-admin
```

After deploying the instrumented Admin, `[MiniProgramRequest]` JSON records cover
`POST /api/miniprogram/codes/resolve`, `POST /api/auth/miniprogram`,
`POST /api/miniprogram/onboarding/referrer`, `POST /api/miniprogram/onboarding/staff`,
and `GET /api/miniprogram/bootstrap`. Every invocation emits `start` immediately,
then `complete` with status, result, stage, duration and the same `requestId`
(also returned in `X-Request-Id`). Caught errors add `exception`; uncaught errors
add `failed` and keep their original throw behavior. Error types, source locations,
nested PostgreSQL/network codes and numeric WeChat codes are retained, without
raw error text, SQL/parameters, request/response bodies, query strings, phone
numbers or credentials. A badge/assignment error may be followed by a successful
completion because the existing flow tolerates that failure.

The log follower needs no debug setting or restart. These application records do
require deployment of the updated image; restarting an older image cannot add
them. Reattach `docker logs` after deployment replaces its container. This is
diagnostic logging for five routes, not a global HTTP access logger.

For a scan-time `404`, inspect the response body: JSON `code_not_found` means the
opaque token has no matching database record; it is not a missing Next.js route.
An empty `{}` POST to `/api/miniprogram/codes/resolve` should return
`400 / invalid_token` before any database write, which safely verifies route
availability. Check that the QR image was generated against the same database.
Viewing an existing code reconstructs its token from `REFERRER_TOKEN_SECRET`
(or `JWT_SECRET` when the former is unset), scope and version. Changing that
secret without updating existing records can make newly downloaded images fail
the stored token-hash lookup. Confirm this before any rotation or secret change;
rotation invalidates previously distributed codes. Nginx access status alone
does not establish which of these conditions caused a failure.

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
