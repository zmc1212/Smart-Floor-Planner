# Admin production deployment and rollback

This is the production operations contract for `admin/release.bat`,
`admin/auto_deploy.sh`, and `admin/deploy.sh`. The workflow performs application
delivery, a verified pre-migration backup, and application-image rollback. It
never automatically restores production data or runs a migration backwards.

<!-- cloud-camera-cloud-mini-integration -->
**Private SD clock integration — bounded Implemented.** One additional sfp-wvp-sd-clock-20261106 container uses the original image/read-only WVP logs and protected allowlist/token config under /datas/sfp-wvp-sd-clock-20261106/; only127.0.0.1:28083,UID10001/cap_drop/read-only mounts/no Docker socket, restart unless-stopped. It observes fresh DeviceStatus time through the original WVP; original28 containers/binaries/site/configuration remain unchanged. Config is0400 and backed up privately. CAMERA_SD_CLOCK_ORIGIN/TOKEN select it explicitly, without server-time fallback. Only current registration/calibrated windows enter Mini; cached starts recheck identity/skew. Real Mini-host/H5 SD query/play/reentry/outage-retry/STOP passed; private media/duties0. Own3417/3418/four forwards/unit DB/key removed; clone/shared3017/D/SSH preserved. Fresh SQL/clock/site backup and new-login denial pass. [Evidence](../tmp/cloud-camera-mini-sd-20261106/assessment.json). No formal business/Mini release or full restore/physical WeChat/PTZ/reconnect claim.
<!-- /cloud-camera-cloud-mini-integration -->

<!-- cloud-camera-phone-trial -->
**Weiyun phone trial — Limited; cloud integration/bounded acceptance Implemented.** The final11-06 user choice is a trial with retained Weiyun test staff,superseding enterprise3. AppID wxa7728432f59779d1/trial20261106-camera-sd-2;formal Mini1.5.0,Admin20260905-001 and formal DB remain. Existing smartfloor.zlyun168.com request/WebView business domains were read back without configuration changes. The trial has urlCheck=true,no environment fallback.

Source [camera-trial](../admin/deployment/camera-trial/),root/datas/sfp-camera-trial-20261106,Compose sfp-camera-trial. Independent PG/gateway publish no host ports;dedicated10.203.207.0/24,gateway binds only10.203.207.2:33417,PG private5432,WVP through its existing private network. Gateway UID1001/read-only root/cap_drop/no Docker socket/768MiB,PG384MiB,both unless-stopped;dedicated raw rules/systemd protect private ports before Docker. JWT is separate;environment/import/backups are root-private. This is an isolated schema-snapshot restoration,ledger0,without invented migration receipts;not a formal migration baseline or an automatic mixed-journal target. Only one synthetic Weiyun project/retained employees are copied. Formal57 migrations/4 enterprises/78 users/18 staff/39 leads remain;all original29 containers(28 running/1 exited),start times/full mounts and original WVP network/rules are unchanged.

Only trial API/H5/media locations are added to the existing Nginx host,with private original-config backup,nginx -t/graceful reload and master31981 preserved. Rollback removes only the trial include after validation/reload and stops this Compose,preserving trial data;never restore over production. An online PGDMP/archive catalog is verified;not full media disaster recovery. Dedicated SSH is revoked/verified at completion;no local process/SSH forwarding dependency. Public1080p live/SD and Stable real-employee entry/reentry pass;physical WeChat decoding/sustained viewing remain unverified. [Resources/backup/rollback evidence](../tmp/cloud-camera-production-20261106/assessment.json).

The trial now selects the existing password state from /camera-test-api without a mode query;ordinary environments keep phone default. Fix 20261106-camera-sd-2 is uploaded;an official trial code opens packages/business/login/login. Retain the original19:18 phone403. Client24 and Stable390×844 default-form/actual staff login/video entry/reentry4 pass,zero drift/restored session. No markup,copy,asset or server-identity change;physical phone retry/decoding remains unverified. [Entry fix](../tmp/cloud-camera-production-20261106/login-entry-fix.json).

**2026-11-11 gateway r3 (20261111-site-1) — stable SD identity deployed, bounded Implemented.** Diagnosis on the deployed trial: the camera stayed online the whole time (verified windows advanced daily 11-06→11-11) and server containers never stopped; the pre-r3 legacy identity hash included the GB28181 registration timestamp, so the camera's ~15-minute re-registration cycle broke the verified window chain ~110 times/day and replayable SD coverage never exceeded the last ~15 minutes. The user re-added the dedicated SSH key; the deployed trial then received, in order: the stable sd-clock probe (identity v2, registerTimeStamp excluded from the hash), migration `0120_construction_camera_sd_identity_version.sql` on `camera_trial` (fresh `before-0120.dump` first), and gateway r3 built from HEAD `c190fd3f` (287 tracked bundle inputs byte-verified against the commit; r2's Dockerfile and all 16 public H5 assets reused byte-exact, page hash unchanged). Only the gateway container was recreated; the other30 containers show no drift, and the automatic rollback guard did not trigger. All 484 window rows rebased once to `identity_version=1` with a single stable hash; the window chain then ran continuously for 20+ minutes across a re-registration cycle with the 60-second checker succeeding (previously impossible), zero new window rows. Replayed coverage verified per Shanghai day: 11-06 18:31 onward = six days (11-06 through 11-11,15–17 real device clips per day); 11-05 and earlier return no device footage (loop overwrite). Unknowns: the camera's exact card size/bitrate, and whether single failed checker cycles can still split windows under a different device, remain unmeasured. Receipts: [deployment](../tmp/cloud-site-trial-r3-20261111/deployment.json), [post-deploy probe](../tmp/cloud-site-trial-r3-20261111/post-deploy-probe.json), [build manifest](../tmp/cloud-site-trial-r3-20261111/gateway-candidate.json). The dedicated SSH key was revoked again after verification.
<!-- /cloud-camera-phone-trial -->

## Standalone WVP trial bundle

The user authorized a fresh WVP/ZLM/MySQL/Redis/read-only capacity stack on
`124.70.90.30` through background OpenSSH, with no computer-use. The offline
bundle was built on the approved development workstation. No Admin release,
business migration, Mini gateway or existing-project upgrade is included.
Target: CentOS7.9/x86_64,8 cores/32GB; initial available RAM5.7GiB,data108.5GiB,
root14.6GiB; Docker26.1.4/Compose2.27.1/Python3.6.8. Bandwidth plan unknown.
Current: **office enrollment and public HTTPS management at https://wvp.zlyun168.com verified,
including actual1920×1080 H264 playback**;
five services healthy,eight auth/capacity checks and five installer tests pass.
[Onboarding evidence](../tmp/wvp-bundle-20261105-01/onboarding-verification.json);
[initial infrastructure](../tmp/wvp-bundle-20261105-01/production-verification.json).

Release: `/datas/sfp-wvp-production-20261106/sfp-wvp-20261105-001-linux-amd64`;
data: `/datas/sfp-wvp-data`; project: `sfp-wvp-cloud`. Loopback HTTP/media/probe:
28080/28081/28082; SIP15060,RTP20000–20035. Existing FRP18080 and native ZLM
30000–35000 are preserved. Databases publish no host ports; recording stays off.
[Maintained installer](../admin/deployment/wvp/README.md),
[exporter](../admin/scripts/remote-dev/export-wvp-bundle.ps1): pinned five images,
random credentials,ownership/checksum/port guards and UID10001 directories.
Archive869MB,SHA256 `8e506d8693ad897c480851f8868c286355ce5ac0e3ca0c43032424132f6414a5`.
[Bundle acceptance](../tmp/wvp-bundle-20261105-01/verification.json) retains
original failures and isolated22-table restoration.

The separate [host-network-guard.py](../admin/deployment/wvp/host-network-guard.py)
is not in frozen release001. It lives in the release parent directory and adds
two exact raw/PREROUTING rules protecting only this instance's loopback HTTP and
private subnet ports. Reentry preserves original rules without duplicates.
`sfp-wvp-cloud-network-guard.service` is configured before Docker at boot; reboot remains untested.
Network `sfp-wvp-cloud_default` currently uses `192.168.80.0/20`; revalidate
network-guard.json before network recreation. No daemon/OS/old-service restart
or upgrade. CentOS7 is EOL; this bounded legacy-host trial is not a maintained
production-host endorsement. [CentOS](https://www.centos.org/centos-linux/),
[Docker loopback caveat](https://docs.docker.com/engine/network/port-publishing/).

The user created wvp-camera,associated it only with124.70.90.30,retained default,
and confirmed initial office/32 TCP15060/20000–20035. The manual4G test guide adds
only those two TCP source rules temporarily; current cloud rules/egress are not re-read. The camera192.168.10.100 now registers with original device/channel
IDs34020000001320000005/34020000001320000006,TCP/TCP-PASSIVE. Its firmware truncates
32-character SIP passwords to31; the first write was rolled back. Native WVP
per-device24-character random authentication now works,with global secrets unchanged.
LTE was disabled for the initial office acceptance. The user now enabled it and
reports live playback on built-in4G; preserve their settings,without independently
asserting the route/public egress. [User report](../tmp/wvp-bundle-20261105-01/4g-live-user-report-20261106.json). IP/DHCP/gateway/ports remain unchanged; an attempted gateway
MAC edit was ignored by firmware and is not a proven cause. No reboot/SD/PTZ action.
The first playback failed ZLM's minimum36-port assertion. A backed-up runtime
repair changed20000–20009→20000–20035 and recreated only this stack's WVP/ZLM;
the frozen001 archive/images remain intact. Maintained installer validation now
rejects smaller pools before Docker. Received RTP20032,1,441,792 FLV bytes and
decoded224 H264 frames at1920×1080. Test playback stopped,media/RTP absent,
recording off; device remains online. Before/after driver/config/resource binding
is stable for office enrollment; original23 containers remain. The separate HTTPS
Nginx worker reload is documented below. Preserve the original
probe/password/port failures and unsorted-mount assertion with its canonical
readback; never replay their writes. Independent4G reconnect/SD,WeChat,product
gateway,multistream and full media recovery remain unverified. [Huawei instructions](https://support.huaweicloud.com/usermanual-ecs/zh-cn_topic_0030878383.html).
The original74h run failed at11-06 11:37 Asia/Shanghai from resource-hash drift,
18.09h/1086 observations,not this cutover. Fresh read:policy58/cloud/off/stopped,
MP4=false,all SD/view/PTZ/writer obligations0,no controller; never resume it.

Public management: [https://wvp.zlyun168.com](https://wvp.zlyun168.com),account `admin`,
existing generated WVP administrator password. DNSPod A points to124.70.90.30;
the existing wildcard certificate is valid through2027-01-13. The independent
[Nginx host](../admin/deployment/wvp/nginx-public.conf) proxies loopback services,
reuses native wvp_token/API authorization for media requests/WS handshakes and
denies public ZLM control/hooks/docs. Access logs exclude credential query strings.
Pinned2.7.4's null TLS StreamInfo fields are normalized by the proxy; native-node
TLS overrides reset on startup. Existing11 site configs/27 other containers and
Nginx master remain; own WVP restart/worker reload were intentional verification.
Normal public DNS/TLS,stock login/device reentry and actual1920×1080 canvas/WSS
328 messages/811829 bytes pass. Those owned tests ended with media/readers0 and
recording off; current user viewing is not queried or stopped. 4G live is user-reported;
WebRTC/RTSP/RTMP,4G reconnect/SD,Mini integration and full media recovery remain unverified. Current
[public evidence](../tmp/wvp-bundle-20261105-01/public-management-verification.json)
retains original black-player/native-reset/automation failures and final source hash.
Post-domain SQL/config/ingress backup is `.state/backup-20261106T075146669182Z`;
its checksum and key cleanup are verified. This is not full media disaster recovery.

Optional operator tunnel: `ssh -N -L 28080:127.0.0.1:28080 -L 28081:127.0.0.1:28081 root@124.70.90.30`;
open `http://127.0.0.1:28080`. Admin/SIP credentials remain only in the release's
private `.state/installation.private.json`. The restricted deployment key cannot forward.
The dedicated key was revoked and a new login was denied; other SSH authorization/Xshell sessions remain. Later remote onboarding requires the user to re-add the dedicated public key. `bash deploy.sh stop` stops
only this stack and preserves data. `backup` covers MySQL/config only,not media,
JWK or snapshots; no full disaster recovery or in-place version-upgrade claim.

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

Before the quality gate, the script checks the Docker engine and runs `npm run
db:check`. Docker Desktop must be running, and the local database selected by
`DATABASE_URL` must be reachable and migrated. `ECONNREFUSED` on local port
`5432` means the database is not accepting connections; it is not an ESLint
failure. Start the existing local PostgreSQL service/container, then apply any
pending local migrations with `npm run db:migrate` and rerun `release.bat`.
Do not point the contract tests at production. Failed prechecks stop the release;
they do not skip tests or automatically migrate a database.

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

To repair production activity/promotion rows before publishing a Mini Program
build, run the script inside the Admin container. It is read-only by default;
`--apply` commits the transaction and `--rotate-all` explicitly rotates every
active code. The output contains only code type, owner ID, and versions, never
tokens:

```bash
docker exec smart-floor-planner-admin node scripts/refresh-service-codes.mjs --kind all
docker exec smart-floor-planner-admin node scripts/refresh-service-codes.mjs --kind all --apply
```

The script does not have to ship in the image. Upload the single file and copy
it into the existing container before running it; the container must expose its
existing `DATABASE_URL`, `REFERRER_TOKEN_SECRET`/`JWT_SECRET`, and Node `pg`
dependency:

```bash
scp admin/scripts/refresh-service-codes.mjs user@server:/tmp/
docker cp /tmp/refresh-service-codes.mjs smart-floor-planner-admin:/tmp/refresh-service-codes.mjs
docker exec smart-floor-planner-admin node /tmp/refresh-service-codes.mjs --kind all
```

Use `--apply` in the final command to commit. A script uploaded under `/tmp`
does not treat that upload directory as an `.env` directory; container runs use
the injected environment variables first. When run from a checkout with
`@next/env` installed, it can also load `.env` files from the current working
directory. Running it on the host instead can use Node 20's `--env-file` (or
explicitly exported variables) and requires a compatible installed `pg` package.

Optional filters are `--kind staff|promotion|all` and `--enterprise-id ID`.
Without `--rotate-all`, only active rows that cannot be reconstructed from the
current `REFERRER_TOKEN_SECRET` (falling back to `JWT_SECRET`) are rotated. With
it, old codes become invalid immediately and the next version is inserted. The
script locks each staff/member owner while it runs and rolls the whole
transaction back on failure. It changes token rows only; already downloaded or
distributed QR images cannot be rewritten.

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
