# Admin

Next.js 16 App Router application for Smart Floor Planner administration.

## Local development

```powershell
cd admin
npm install
npm run dev
```

Open `http://localhost:3006`. The application requires the repository's
configured PostgreSQL and provider environment variables for authenticated
business flows.

## Production release

On Windows, `release.bat` runs ESLint, the survey/AI/PostgreSQL test suites, a
production Next.js build, and a no-cache Docker build. A release gets a stable
`YYYYMMDD-NNN` version, a matching `zmc1212/sfp-admin:<version>` image, integrity
manifests, and `release/sfp-admin-release-<version>.zip`. Pass an explicit
version when needed, for example `release.bat -Version 20260901-001`.

The archive intentionally contains no `.env.production`. Keep production
secrets in `/datas/smartfloor/.env.production` on the server with mode `600`,
and configure a dedicated low-privilege smoke account through
`DEPLOY_SMOKE_USERNAME` / `DEPLOY_SMOKE_PASSWORD`. Optional comma-separated
authenticated GET checks use `DEPLOY_SMOKE_PATHS`; `/api/auth/me` is always
checked.

Upload the versioned ZIP, its `.sha256` sidecar, and the current
`auto_deploy.sh` to the stable deployment root. Then use:

```bash
chmod +x auto_deploy.sh
./auto_deploy.sh deploy                         # newest uploaded ZIP
./auto_deploy.sh status
./auto_deploy.sh rollback                       # recorded previous version
./auto_deploy.sh rollback 20260901-001          # exact retained version
```

Deployment uses a temporary extraction directory, discovers and preserves the
existing Compose project name (and therefore the existing PostgreSQL volume),
verifies every packaged checksum, creates and validates a custom PostgreSQL
dump plus SHA-256 before migration, runs Drizzle migrations, recreates Admin and
the claim worker, and requires database health, worker health, authenticated
login, and configured core API checks to pass. Releases, deployment state, and
backups remain outside the extracted package. A failed new application check
automatically restores the previously running image when available.

Application rollback never reverses a PostgreSQL migration. Every migration
must remain backward compatible with the immediately previous application
release. See the bilingual production runbook in
`../docs/production-deployment.md` and
`../docs/production-deployment.zh-CN.md`.

Alpine `apk` uses `mirrors.aliyun.com` because `dl-cdn.alpinelinux.org` often
fails TLS from China during `libc6-compat` / CJK font installation.

## Runtime references

- Current module map: `../docs/admin-system-modules.md`
- Admin visual rules: `DESIGN.md`
- Tenant/auth and contribution rules: `../AGENTS.md` and `AGENTS.md`
