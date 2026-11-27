# Admin production deployment and rollback

This is the production operations contract for `admin/release.bat`,
`admin/auto_deploy.sh`, and `admin/deploy.sh`. The workflow performs application
delivery, a verified pre-migration backup, and application-image rollback. It
never automatically restores production data or runs a migration backwards.

## Current production release

Production Admin, the lead-claim Worker and the XiaoK Worker run `20261127-001` from clean release commit `ad54cf7e`, based on `47b575f0`. This release places customer photos in the human reception transcript and adds audited enterprise consultation history, including conversations still handled by XiaoK. The archive SHA-256 is `a13c5a41d9ae5f712a5953d881321942252120b5aaf9def47af8926a3d2e47b8` and the image config digest is `sha256:696d8e0048b29383315e0fcf3065039271e8ea92ceaa5a42b599d32b48478b63`. [Package binding](../tmp/xiaok-consultations-20261127/package-binding.json) · [Deployment receipt](../tmp/xiaok-consultations-20261127/production-deploy.log)

Migration `0152_assistant_consultation_reads` advanced the ledger from 148 to 149 on the existing PostgreSQL volume. The pre-release backup `smart_floor_planner-20261127T050021Z-pre-20261127-001.dump` contains 40,012,593 bytes and passed SHA-256 and archive checks. Production verification confirmed forced tenant RLS and append-only application audit access, both Worker health checks, authenticated deployment smoke, the installed routes and anonymous 401 responses. Targeted isolated service and browser checks covered an ordinary consultation, audit readback and inline photo preview. Application rollback targets `20261126-006`. The temporary public key was revoked and a new login was rejected. [Server checks](../tmp/xiaok-consultations-20261127/server-check.log) · [Public checks](../tmp/xiaok-consultations-20261127/public-smoke.json) · [Browser verification](../tmp/xiaok-consultations-20261127/browser-receipt.json) · [SSH revocation](../tmp/xiaok-consultations-20261127/ssh-reauth.log)

### Earlier verified releases

Production Admin, the lead-claim Worker and the XiaoK Worker run `20261126-006` from `47b575f0`. The archive SHA-256 is `38854ebfe4fc4f9a2a296a10f23713c35f9eec26239bb885d9b9ccce63621037` and the image config digest is `sha256:d7184275355b4c59fb6187dc74f9919098fde019f40650e00989f451f37d0f65`. The release adds the platform-controlled Mini Program AI entries, includes the latest private camera code and preserves the deployed staff-only no-project follow-up response. The public AI entry API returns `enabled: false`, and the platform endpoint denies anonymous access. Public HTTPS, authenticated Admin smoke checks and both Workers passed. The existing PostgreSQL volume still has 148 migrations. The 39,905,443-byte pre-release backup `smart_floor_planner-20261126T092550Z-pre-20261126-006.dump` passed archive and SHA-256 checks. Application rollback uses `20261125-006`. [Package](../tmp/production-release-20261126-006/package-binding.json) · [Server checks](../tmp/production-release-20261126-006/server-check.log) · [Public checks](../tmp/production-release-20261126-006/public-smoke.json).

The separate camera gateway also runs `20261126-006` from the same source, with image `sha256:abfe14a8b52a4126ffca05922d666124ca651b3394038ab44392d7bfa7aff760`. The owner cover reports the current camera binding, and the gateway handles delayed stream aborts when closing media requests. Gateway health, H5 asset hashes and anonymous rejection passed. The isolated camera suite passed all 91 tests. On-device playback was outside this rollout verification. The rollback bundle at `/datas/smartfloor/backups/camera-backend-20261126-006.Cydlw3SU` restores the parked `20261126-005` gateway through its `switch.sh` rollback action. Fresh SSH login with the rollout identity was denied after revocation. [Gateway checks](../tmp/production-release-20261126-006/camera/switch.log) · [Camera database suite](../tmp/production-release-20261126-006/camera-db-tests.log) · [SSH revocation](../tmp/production-release-20261126-006/ssh-reauth.log).

### Previous verified release 20261125-006

Production Admin and both Workers previously ran `20261125-006` from `46075f38`. ZIP SHA-256 is `254083cf2c6a170dc9e749673734c87c17db1b972baef3897a47e51dac1aa87d` and the image config digest is `sha256:91ad7e76f31ec0e15a2ff03893cef5fa07d1ffc3e913cb9078ed49b105493d2f`. Designers and construction staff without eligible projects now receive `409 construction_followup_no_project` when opening follow-up. The original PostgreSQL volume and 148-entry migration ledger remain in use. The 39,847,047-byte `smart_floor_planner-20261125T161609Z-pre-20261125-006.dump` passed archive and SHA-256 verification. Public health, both Workers and authenticated smoke checks passed. The original designer's Stable DevTools home returned the no-project state with list and settings reads at 200. Temporary SSH authorization was removed and a fresh connection was denied. [Package](../tmp/production-release-20261125-006/package-binding.json) · [Server](../tmp/production-release-20261125-006/server-check.log) · [Backup](../tmp/production-release-20261125-006/backup-verify.log) · [Home readback](../tmp/production-release-20261125-006/native-designer.json) · [SSH revocation](../tmp/production-release-20261125-006/ssh-reauth.log).

WeChat rejected `20261125.6` from `a4567879` for the XiaoK entry failure. The client could not load `enterprise: null`. Public XiaoK is now enabled at v2 on the dedicated system tenant 7, using the existing Bailian `deepseek-v4.1-flash-1017` and the persistent Admin runtime binding. On the production API the unassociated test account completed two turns and read both saved replies after reopening the same conversation. The candidate `12a107d0` passed 2,414 tests and the WeChat preview compile. Stable DevTools verified the original project on the live service. The test credential returned 401 after revocation. The temporary SSH key was removed and denied on reconnect. WeChat development upload, review and Android device verification remain pending. [Tenant setup](../tmp/xiaok-audit-20261126/production-stage-tenant.log) · [Production journey](../tmp/xiaok-audit-20261126/production-journey.json) · [Server checks](../tmp/xiaok-audit-20261126/production-postcheck.log) · [Candidate preview](../tmp/xiaok-audit-20261126/production-candidate-preview.log) · [SSH revocation](../tmp/xiaok-audit-20261126/production-ssh-revocation.log).

### Previous verified release 20261125-005

Production Admin, the lead-claim Worker and the XiaoK Worker previously ran `20261125-005` from clean commit `ec0400d6`. The release adds the built-in public XiaoK backend and configuration page, restricts the scan action to explicit designer requests, and includes the prior consultation routing, role-based WeChat delivery and report updates. The ZIP SHA-256 is `4a5ba2f7fd5379b47e05989a61a14a63efa8b39b587efa806f3c4af4f56a50d3`, and the image config digest is `sha256:b442958bf8c7ebe50403ebf7b6f23784af46c65b704dc2c64fc7a597d29d1b35`. Application image `20261125-004` is available for rollback.

The original PostgreSQL volume advanced from 147 to 148 migrations. Migration `0151_assistant_public_agent_library` grants the application role read access to the mapping table. The 39,827,027-byte pre-release archive `smart_floor_planner-20261125T145106Z-pre-20261125-005.dump` passed integrity checks. Public health, authenticated Admin and both Worker checks passed. 17 of 19 online API checks passed. The retained Enterprise 3 owner-account credential returned 401 across Admin and Mini. The initial-password flag was set before and after the rollout. The platform configuration passed access and version checks. The public consultation switch is off and its dedicated tenant mapping is empty. The designated owner reopened both report originals and two saved consultation answers. Server reply previews were present. Client preview timing and personal WeChat delivery remain unverified. The temporary deployment authorization was revoked. [Package binding](../tmp/production-release-20261125-005/package-binding.json) · [Deployment](../tmp/production-release-20261125-005/server-deploy.log) · [Server checks](../tmp/production-release-20261125-005/server-check.log) · [Online smoke](../tmp/production-release-20261125-005/public-api-check.json) · [Platform config](../tmp/production-release-20261125-005/public-platform.log) · [Owner report](../tmp/production-release-20261125-005/owner-report-regression.json) · [Reply previews](../tmp/production-release-20261125-005/consult-stream-check.log) · [Owner initial-password baseline](../tmp/production-release-20261125-005/boss-pre-release.log) · [SSH revocation](../tmp/production-release-20261125-005/ssh-reauth.log).

### Previous verified release 20261125-004

Production Admin, lead-claim Worker and XiaoK Worker run `20261125-004`, built from clean commit `1732f82f`. The release includes XiaoK's consultation and requirement-recording separation and the shared consultation Worker update. The verified ZIP SHA-256 is `6e848c0daecc818aec595ea7430110e943cd0311bdbfa7a3b8d9d835677309fb`. The image config digest is `sha256:a986aee39556491cd7daed62bfa8dadb9950e28ef6223b1dafb9169d1fe4cd43`. The previous application image `20261125-003` is available for rollback. [Package binding](../tmp/production-release-20261125-004/package-binding.json) · [Deployment](../tmp/production-release-20261125-004/server-deploy.log).

The existing PostgreSQL volume has 147 migration entries before and after deployment. The 39,747,957-byte pre-release archive `smart_floor_planner-20261125T095042Z-pre-20261125-004.dump` passed the archive and SHA-256 checks. Public HTTPS health returned 200. Both workers reported healthy, and authenticated Admin login and `/api/auth/me` passed. The dedicated temporary SSH key was revoked and a fresh login was rejected. The release covers the backend and workers. [Server checks](../tmp/production-release-20261125-004/server-check.log) · [Public health](../tmp/production-release-20261125-004/public-health.json) · [SSH revocation](../tmp/production-release-20261125-004/ssh-reauth.log).

### Previous verified release 20261125-003

Production Admin, the lead-claim Worker and the XiaoK Worker ran `20261125-003` from clean backend commit `7602883f`. It deploys role-scoped personal WeChat report delivery, the homeowner weekly V002 image, and the full backend that includes XiaoK reply streaming. The verified archive SHA-256 is `99bafb12f44b99e332203e755cd721092dd8d2cd55d6245ca9d765e73cc50c39`. The running image config digest is `sha256:0f24732f48b67f115e92fd94eaf07a96d9f8fd35f36942675d1ee3723c959668`. The prior application image remains available as `20261125-001`. [Package binding](../tmp/xiaok-owner-weekly-image-20261125/binding.json) · [Deployment](../tmp/production-release-20261125-003/server-deploy.log).

Migration `0150_xiaok_wechat_role_recipients` advanced the ledger from 146 to 147. The existing PostgreSQL volume was retained, and both WeChat tables still enforce RLS. The 39,708,943-byte pre-migration backup `smart_floor_planner-20261125T082156Z-pre-20261125-003.dump` passed the archive check. Public health returned 200, both workers were healthy, and authenticated Admin smoke checks passed. The release covers the server and workers. Delivery of the homeowner image through actual personal WeChat remains unverified. [Server checks](../tmp/production-release-20261125-003/server-check.log) · [HTTPS health](../tmp/production-release-20261125-003/public-health.json).

### Enterprise 3 lifecycle verification

Project 5 completed ten persisted stage changes and delivered all ten owner inbox notices. Water/electrical and completion also delivered the two configured site-visit messages. Worker submission, designer remote review, manager customer publication and the worker's approval readback passed. The boss brief showed the final move-in stage and the missing schedule. The whole-home record was excluded from the brief, while the room-specific control appeared. The project returned to its original water/electrical stage, note and member role. [Lifecycle receipts](../tmp/production-release-20261125-003/lifecycle-api.json) · [Room control](../tmp/production-release-20261125-003/room-control.json).

The temporary manager role restoration made older report originals unavailable through the membership audit rule. With approval, the original test audit 42 was backed up and the row was marked as the test restoration. The signed test owner reopened daily report 101 and weekly report 89, retrieved both PNGs and persisted read receipts. The owner's site reminder readback passed. These checks used the live owner service through Stable DevTools. The full rendered page interaction and personal WeChat delivery remain unverified. No verified owner WeChat channel was present. The temporary SSH key was removed and fresh authentication was denied. [Audit restoration](../tmp/production-release-20261125-003/report-source-restore.log) · [Owner service receipts](../tmp/production-release-20261125-003/direct-owner-report-acceptance.json) · [Database readback](../tmp/production-release-20261125-003/post-restore-readback.log) · [SSH revocation](../tmp/production-release-20261125-003/ssh-reauth.log).

### Previous verified release 20261125-001

The production Admin, claim worker and XiaoK worker ran `20261125-001` from clean commit `53756742`. The release carries the XiaoK reply-streaming changes onto production base `4c9f72bc`. The image config digest is `sha256:688533bad6dc5c6eecf01e455b43b510e7029bd163b472e599ec4dfc84119eeb`. The verified server archive SHA-256 is `bacfcb0ad030f6d106f52c24c0ef739a8b4aa6657c71dcdb5daef97675dfefa8`. The previous application image is `20261124-002`. [Source and build](../tmp/xiaok-live-reply-release-20261125/backend-binding.json) · [Server deployment](../tmp/xiaok-live-reply-release-20261125/server-deploy.log).

The migration ledger contains 146 records on `sfp-admin-release_postgres_data`. The production script verified the pre-deploy backup `smart_floor_planner-20261125T034538Z-pre-20261125-001.dump`, both workers and authenticated Admin access. The public HTTPS gateway returned 200. The WeChat preview was compiled from `056bf37f` with domain checking enabled and 2,404 Mini Program tests passed. [Server verification](../tmp/xiaok-live-reply-release-20261125/server-check.log) · [Public health](../tmp/xiaok-live-reply-release-20261125/public-health.json) · [Preview binding](../tmp/xiaok-live-reply-release-20261125/preview-fresh.json) · [Mini Program tests](../tmp/xiaok-live-reply-release-20261125/miniprogram-tests-package.log).

The four-minute handset observation received no turn from the designated enterprise 3 test owner. On-device reply timing through the gateway is pending. Fresh SSH authentication rejected the revoked temporary identity. [Handset observation](../tmp/xiaok-live-reply-release-20261125/handset-watch.log) · [Test-owner count](../tmp/xiaok-live-reply-release-20261125/handset-count.log) · [SSH revocation](../tmp/xiaok-live-reply-release-20261125/ssh-reauth.log).

### Previous verified release 20261124-002

Production Admin, the lead claim worker, and the XiaoK worker ran `20261124-002` from clean commit `4c9f72bc`. The image config digest is `sha256:f98470f26b9e8cac524084a416a1ad6a9b4f3e1706741f27a41b60f880813b8d`, and the standard package ZIP SHA-256 is `527e2f12261e9bf8174332a29b68137c6ed690c173250a0cf7f7b92b3eb27f77`. The previous application image remains available as `20261124-001`. [Source binding](../tmp/production-release-20261124-002/source-binding.json) · [Production receipts](../tmp/production-release-20261124-002/production-server.log)

Migrations `0148_assistant_wechat_channels` and `0149_xiaok_publications` advanced the ledger from 144 to 146 entries. Three new tables enforce RLS, and the existing PostgreSQL volume remains in use. The pre-migration backup `smart_floor_planner-20261124T085052Z-pre-20261124-002.dump` passed SHA-256 and archive listing checks. Admin health returned 200, both workers were healthy, and authenticated login and core API smoke checks passed. [Migration rehearsal](../tmp/production-release-20261124-002/isolated-migrations-checked.log) · [Production deployment log](../tmp/production-release-20261124-002/production-deploy.log)

The standard build passed, and all 2,387 Mini Program tests passed. The WeChat Mini Program store release is pending separately. The temporary SSH key was removed, and a fresh connection using it was denied. [Build](../tmp/production-release-20261124-002/build.log) · [Mini Program tests](../tmp/production-release-20261124-002/miniprogram-tests-checked.log) · [Key revocation](../tmp/production-release-20261124-002/production-key-reauth.log)

## Current stage Agent release

The previous production release for Admin, the lead claim worker and the XiaoK worker was `20261124-001` with image config digest `sha256:cbd8a9e9f85f75f961f0a0a77d687761e19a7670e15a3825772f9df52c847ac1`. The standard build used application source tree `637444cf0a60ed240b8c51fd1aad4edfec1a88e5`, which includes the workspace changes captured at packaging. The ZIP SHA-256 is `ae1aef6968219b8ffb9859af1922ee689a549336abc55999e1caaf9c963d7c26`. The preceding Admin release is `20261120-001`. [Source binding](../tmp/production-release-20261124-001/source-binding.json) · [Live services](../tmp/production-release-20261124-001/production-server.log)

Migrations `0144`–`0147` brought the original PostgreSQL volume from 140 to 144 ledger entries. The initial attempt rolled back when `sfp_migrator` lacked permission to define the function's configuration parameter. The verified pre-migration dump is `smart_floor_planner-20261124T021950Z-pre-20261124-001.dump`. A single transaction temporarily granted `SET` on `app.is_platform_admin` to the migrator, ran the original package migrations under that role and revoked the grant before commit. The normal release then reused the same archive and passed. [Initial attempt](../tmp/production-release-20261124-001/production-deploy.log) · [Retry](../tmp/production-release-20261124-001/production-retry.log) · [PostgreSQL 17 parameter grants](https://www.postgresql.org/docs/17/sql-grant.html)

Enterprise 1 and 3 use their existing models through the binding at `/app/tmp/native-workflow-store/.runtime/agent-binding.json`. Eligible managers get ten stages with the packaged knowledge workflow without creating a stage configuration. Production enterprise 3 returned all ten defaults, ran a water/electrical preview through `stage-system-guidance@1`, and reopened the saved answer. The test manager without the knowledge menu received `403`. The temporary SSH key was revoked and a fresh login was denied. [Workflow receipt](../tmp/production-release-20261124-001/production-receipts.log) · [Answer reentry](../tmp/production-release-20261124-001/production-preview-reentry.json) · [Key revocation](../tmp/production-release-20261124-001/production-key-reauth.log)

For application rollback, recover the previous runtime environment from the protected release baseline under `/datas/smartfloor/backups/pre-20261124-001.XWQRoOLN` as applicable, and restore the saved family-invite chunk if recreating `20261120-001`. The WeChat Mini Program store release remains pending.

## 2026-11-19 measurement-booking release

Production Admin, the lead claim worker and the XiaoK worker ran `20261119-004` with image config digest `sha256:69413a9e738cfc440f542443dddc81eaca9b12baca4c7c17b294245f7aa6a9a5`. The server assembled the verified image using three identical blobs from the previous upload. The deployed `sfp-admin-release-20261119-004.zip` has SHA-256 `b15b59f1f01e06e7f72ca033bcdd57cf78d6562ca574b3c93c9e32f53e1e5791`. The preceding application release was `20261119-002`. [Release receipt](../tmp/designer-booking-release-20261119/production-finish-004.log).

The `20261119-003` attempt applied `0143_measurement_appointment_contact` before its worker encountered PostgreSQL's unqualified relation requirement for `FOR UPDATE OF`. The application rollback restored `002` and retained the additive migration. `004` uses an unqualified lead alias for the lock. The ledger stays at 140 entries, `measurement_appointments.contact_phone` is nullable `text`, and the PostgreSQL volume identity is preserved. The pre-deploy backup `smart_floor_planner-20261119T132408Z-pre-20261119-004.dump` is 38,093,357 bytes and passed checksum verification. Admin login, both worker health checks, and the unauthenticated booking endpoint's `401` response passed. The temporary SSH public key was removed and a new login attempt was denied. [Rollback record](../tmp/designer-booking-release-20261119/production-deploy.log), [server verification](../tmp/designer-booking-release-20261119/production-server-004.log), [public verification](../tmp/designer-booking-release-20261119/production-public-004.json).

WeChat developer version `20261119.3` was uploaded, and the on-device preview uses the production API. Formal WeChat review and publication are pending. [Upload receipt](../tmp/designer-booking-release-20261119/wechat-upload.log).

## 2026-11-20 construction family-flow hot fixes (20261120-001 writable layer)

`20261120-001` shipped on 2026-11-20 (`git_commit bc834f43`, full dirty-workspace release, built 13:40:34, with migrations 0141–0143 and the pre-migration backup `smart_floor_planner-20261120T055935Z-pre-20261120-001.dump`). Two in-container hot fixes were later applied to the `20261120-001` writable layer (`.next/server/chunks/_0k7vy46cjrv0a._.js`); the equivalent repository fixes are recorded in the bilingual module docs and the next image release supersedes them:

1. The family invite-code branch compared the path length against `4===I.length`; corrected to `3===I.length`. With `4`, `GET /api/miniprogram/construction/projects/:id/family-invite-code?env=` never matched and fell through to the staff gate returning 403 `construction_forbidden`, so owners could never mint the QR code.
2. Removed six `actor.mode === 'customer'` branch guards across the construction customer flows (accept, customer-projects, family-invite-code, video, progress/family-viewers/family-invite, plus the De-Morgan-shaped owner-sites guard): these flows authorize by the underlying user id (owner gate and family-view bindings live inside the service), so the same user sees identical data under any identity mode; accounts whose login default is the staff context (employee or referrer identities) are no longer locked out of the family flow.

Verified with a staff-token probe (accept moved from `construction_not_found` to `construction_invite_invalid`, i.e. the branch is reached, and customer-projects returns 200); a real phone accepted a family invite by scanning and viewed progress and live video read-only. Diagnostic scripts and evidence: `tmp/family-invite-code-repro-20261120/`.

## 2026-11-18 renovation profile release

Production Admin, lead Worker and XiaoK Worker now run `20261118-003`, image config digest `sha256:996b7e77b8d70684c06dada4678c2717ab9514f08625e7eed4d95a424ce01887`. The release builds on `002` with the focused housing-extraction correction and retains its ordinary-consultation routing fix. It includes no new migration, and the ledger remains at 135 entries. Exact hashes are shipped in `SOURCE_BINDING.json`. Database HTTP health, both Workers, authenticated administrator smoke and the approved test-owner readback passed. All eleven runtime-source hashes and trial inputs matched before and after the four-turn `003` check. The earlier eleven-turn `002` batch remains separate, including its failed housing projection. [Release and verification](../tmp/staff-profile-housing-correction-20261118/production-verification.json).

The standard deploy verified the pre-release custom backup `/datas/smartfloor/backups/postgresql/smart_floor_planner-20261117T185039Z-pre-20261118-003.dump` (37,015,839 bytes), its SHA-256 and archive catalog. PostgreSQL data-volume identity matched before and after release. Server receipts are in `deploy-state/first-reply-20261118-003/`. The earlier `001` migration failure, rolled-back transaction and alignment of the old profile table/lifecycle function to the existing `sfp_migrator` remain in `deploy-state/staff-profile-20261118-001/`. Forced RLS and `sfp_app` privileges were verified there. [Current deployment log](../tmp/staff-profile-housing-correction-20261118/production-deploy.log), [original migration receipt](../tmp/staff-profile-release-20261118/production-backup-and-health.txt).

`current-version`/`current-image` now select `003`, and `previous-version`/`previous-image` select the actual preceding `002`. `auto_deploy.sh rollback` updates Admin and the lead Worker. Use the corresponding Compose's `assistant` profile to switch the XiaoK Worker to that same rollback image. Preserve data and migration history. The earlier `005`/`004` state discrepancy remains in its original `001` audit snapshot. Routing/guidance 28, profile service 24 and unchanged Mini Program 89 checks passed. Full PostgreSQL regression retains prior failures. Staff room aggregation remains Limited, and native-page sending remains unverified. Mini Program `20261118.1` is uploaded and awaits formal audit/publication through the public platform, whose browser access was blocked by site safety policy. [Validation scope](../tmp/staff-profile-housing-correction-20261118/scope-validation.json), [Mini Program receipt](../tmp/staff-profile-release-20261118/miniprogram-upload-status.json).

**2026-11-18 worker report range release 20261118-004 (deployed).** With user authorization this release used `20261118-003` as the base and overlaid only the worker workbench report-range API (`from`/`to`), own report history and today summary, up to nine photos with construction-stage snapshots, and manager/designer/owner review permissions. Package `sfp-admin-release-20261118-004.zip` (SHA-256 `77a11c352bdbabbaa27149aafab74d101331e25726f9749538a532894b952e94`), image `zmc1212/sfp-admin:20261118-004` (`sha256:e9cb56e4f5dd070d0b9a66c0aab2a0b82e87d76b3ce699d3d9dadf5d5f70e500`). `auto_deploy.sh deploy` produced the pre-migration custom backup `smart_floor_planner-20261118T060611Z-pre-20261118-004.dump` (37,314,865 bytes). The migration ledger moved from 135 to 136 with `0140_construction_worker_reports` (`created_at=1797235200000`); the `stage_snapshot` column and `position <= 8` constraint were read back. `current-version`/`current-image` now select `004`, while `previous-version`/`previous-image` select `003`. Admin, lead worker and XiaoK worker all run `004` (the XiaoK worker was synced manually with the same `SFP_RUNTIME_ENV_FILE`); the PostgreSQL data volume identity is unchanged and health, login and core-path smoke checks passed. Online `GET /api/miniprogram/construction/workbench?projectId=5&from=2026-11-18&to=2026-11-18` returns 200 for staff 31, staff 32 and designer 10; a wider range returns two history records; reversed ranges, spans over 92 days and a missing `to` still return 422. Mini Program `20261118.1` needs no re-upload. [Verification evidence](../tmp/worker-reports-20261118/production-verification.json).

**Current construction video cover (2026-11-20, deployed).** The scoped release installs `index.html`, `player.js`, and `style.css` in the writable layer of `smart-floor-planner-admin` on `20261119-004`. For enterprise 1 and 3 camera sessions, `sfp-construction-camera-current` at `127.0.0.1:33418` serves `GET /api/construction-camera/cover/:bindingId` using the shared session handler. The running gateway's host-bound bundle has SHA-256 `527928a7cee4c69f748d50cd46776761c735c8a0149176abf8eeef33a0665dfb`. Include the tracked H5 files and gateway code in subsequent image builds. External readback matched all three assets with `no-store`, and authenticated entry for the enterprise 3 test site returned its 12:00:15 China time JPEG. Anonymous access returned 401. The dedicated SSH key was revoked and a fresh login was refused. Android WeChat cover and tap-to-play acceptance remains pending. [H5 rollout](../tmp/camera-android-autoplay-20261120/production-release/publish-h5-2026-11-20T04-01-21-834Z.json) · [Public checks](../tmp/camera-android-autoplay-20261120/production-release/public-verification.json) · [Authorized cover](../tmp/camera-android-autoplay-20261120/production-release/private-after.json)

The first two scheduled slots hit WVP's three-second snapshot timeout during 4G startup. WVP finished writing both images after the timeout. The original JPEGs were matched to their slots and recovered with their actual capture times. The deployed scheduler now waits for the shared live stream via WVP's start endpoint before asking for the snapshot. The updated provider sequence returned a new JPEG from the production test camera and the isolated scheduler checks passed. The next natural production slot remains pending. [WVP timeout](../tmp/camera-android-autoplay-20261120/production-release/capture-error-2026-11-20T04-02-35-922Z.json) · [Provider verification](../tmp/camera-android-autoplay-20261120/production-release/trace-warmed-camera-capture-2026-11-20T04-04-47-390Z.json) · [Gateway rollout](../tmp/camera-android-autoplay-20261120/production-release/promote-warmed-capture-2026-11-20T04-08-02-538Z.json)

For rollback, compare the running digests with the release receipts, then atomically restore the three `previous-*` assets from `/datas/smartfloor/backups/camera-cover-hotfix-20261120.Cr8r8RoU`, preserving target owner and mode. Restore `gateway.previous.cjs` to the gateway bind path `/datas/smartfloor/camera-gateway/gateway.cjs` and restart `sfp-construction-camera-current`. The backup `gateway-route.cjs` supports rollback of only the scheduled capture change. Verify the gateway health, public hashes and anonymous denial. The preceding autoplay-only hotfix was exercised on Android and still required a gesture. [Autoplay-only receipt](../tmp/camera-autoplay-20261120/production/publish-2026-11-20T03-05-16-818Z.json)

**2026-11-23 Project 5 synthetic debug feed (deployed).** The production 20261120-001 Admin stays in service. The camera gateway and the existing HTTPS camera include route the exact project 5 owner cover, camera list and entry paths through the scoped gateway. Only enterprise 3 project 5 owner user 2 is in the allowlist. The internal `sfp-camera-debug:8080` source uses the local `sfp-camera-debug:20261123-003` image and serves the generated H.264 pattern and a JPEG extracted from the same loop in the private video network. WVP and device records are outside the source path. Before and after SQL reads agree on zero target bindings and project 6 camera 1 binding 6. Restore the backed-up `nginx-before.conf`, validate and reload Nginx, stop the new gateway, restore the parked `sfp-construction-camera-before-project5-20261123` name/start it, then stop the scoped source container. The backed-up configuration and bundle are in `/datas/smartfloor/backups/project5-debug-20261123.HFQle7CD/`. [Deployment receipt](../tmp/project5-debug-camera-synthetic/release/deploy-output.txt) The 13:45 cover rollout can be rolled back on its own. Stop the current gateway and restore its mounted bundle from `gateway-before.cjs`. Stop and rename the current source, rename the parked `sfp-camera-debug-before-cover-20261123` container to `sfp-camera-debug` and start it, then start the gateway. The cover rollback files are in `/datas/smartfloor/backups/project5-cover-20261123.EL8cAlky/`. [Cover release receipt](../tmp/project5-debug-camera-cover/deploy-output.txt)

**2026-11-26 private construction live audio.** Gateway `20261126-005` introduced the production audio path from source `97453113` with image `sha256:fb772ef25704a51b50eba3eac559f8c40001168ddd973d18ff4d713d1feabd66`. `CAMERA_LIVE_AAC_BINDING=3:6:6` selects the exact production test camera. WVP channel `1` has audio enabled. FFmpeg 6.1.1 copies H.264 and converts PCMA to 48 kHz mono AAC-LC in HLS. HTTPS routes the notebook H5, authenticated native start/heartbeat/stop, the staff camera list and compatibility entry, and `/camera-media/native/` to this gateway. Access logs omit raw media-ticket paths. Signed staff camera-list and compatibility-entry checks returned 200 for project 6. Anonymous access returned 401. [Switch receipt](../tmp/camera-aac-production-20261126-r5/switch.log) · [Staff entry](../tmp/camera-aac-production-20261126/native-entries-after.json)

The scoped start prewarms the shared encoder for up to 6.5 seconds. FFmpeg requires an input audio track and aligns its initial timestamps before encoding AAC. The first manifest waits for at least ten seconds of media, and the native manifest also waits for three complete fragments. Each job pins `EXT-X-TARGETDURATION` and retains older fragments beyond the visible playlist. The `004` native trace consumed the first five audio-bearing fragments and stalled before the sixth became available during 4G startup. [Native requests](../tmp/camera-aac-production-20261126-r4/native-status-trace.json) · [4G fragment timing](../tmp/camera-aac-production-20261126-r4/native-fragment-clock.jsonl)

On `005`, the H5 played and decoded real camera audio after a speaker click, returned to silence after the second click, and kept advancing video. The native URL served H.264 and AAC-LC in the same job and denied the stopped lease and its segment. In Stable DevTools the staff player advanced frames and produced audible output when unmuted. The extended run still stalled. Direct sampling on the WVP host saw roughly 15 seconds of original media arrive over 18 seconds. Test readers drained and WVP audio remains enabled. Family-native build `20261126.2` from `3f739c36` is uploaded as a WeChat development version. Formal review, release and handset verification remain pending. The current Mini Program can use sound through the existing H5 entry. [H5 and WVP measurements](../tmp/camera-aac-production-20261126-r5/production-audio.json) · [Native run](../tmp/camera-aac-production-20261126/native-production-playback-r5.json) · [WeChat upload](../tmp/camera-aac-production-20261126/mini-upload.log)

The `005` bundle and rollback files are in `/datas/smartfloor/backups/camera-aac-20261126.abeveeHK`. Its scoped rollback restores the parked `sfp-construction-camera-before-aac-buffer-20261126` to the live name and verifies health. For the full audio rollback, use `/datas/smartfloor/backups/camera-aac-20261126.cZhDguSE` to restore the exact WVP channel setting from `wvp-audio-before.json`, the prior Nginx snippet, and `sfp-construction-camera-before-aac-20261126`. Verify the production H5 and the same camera after rollback. [Build checks](../tmp/camera-aac-production-20261126-r5/image-preflight.log)

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

## Enterprise 1 production demo

Admin `20261113-001` serves the labelled demo project `1` and the 12 demo
portfolio works for enterprise `1`. XiaoK is enabled for enterprise `1` and
uses the shared platform text configuration (`dashscope`,
`deepseek-v4.1-flash-1017`). Four PPT craftsmanship drafts are indexed through
the existing pgvector pipeline with `text-embedding-v4` and remain staff drafts.

`sfp-construction-camera-production` listens on `127.0.0.1:33418`, uses the
production database, and connects to WVP on `sfp-wvp-cloud_default`. Its runtime
files are in `/datas/smartfloor/camera-runtime/`. The Nginx camera snippet and
`sfp-construction-camera-production-map.conf` route enterprise `1` sessions to
this gateway. Ticket exchange uses the existing trial gateway after a production
`401`. Both gateways verify their own tickets and sessions. Project `1` has one
camera binding with view-only access for its demo owner. The owner video entry,
staff session and anonymous rejection were verified. WVP reported the channel
offline and the live attempt returned `502`. Playback remains unverified.

The release Compose file declares `sfp-wvp-cloud_default` as an external network for Admin, so `deploy.sh` recreates Admin with the attachment already in place. For older release packages that predate this declaration, `deploy.sh` and `auto_deploy.sh` also verify and reattach the network after both deploy and rollback. Reattachment only touches the Admin container; it never restarts the camera gateway, WVP, or ZLM. Override the network name with `SFP_CAMERA_NETWORK` (or the same variable in the runtime env file).

Verify after a release or rollback:

```sh
docker inspect smart-floor-planner-admin \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
curl -fsS http://127.0.0.1:33418/camera-gateway-health
```

A failed reattachment only warns and never blocks the release; verify the authorized video entry manually in that case.

The pre-seed database archive and
prior camera configuration are under
`/datas/smartfloor/backups/tenant1-demo-20261113/`. To undo the camera routing,
restore the prior Nginx snippet and remove the production camera map, then run
`nginx -t && nginx -s reload` before stopping the production camera gateway.

### Private portfolio images for the enterprise 1 trial

The private Kodo bucket `sfp-zly-portfolio-demo-20261113` in `z0` holds 144
verified copies of the JPEGs referenced by published demo works `1`–`12`.
The migration uses immutable work/asset identifiers and content fingerprints.
The original image records and public media storage configuration remain
available to existing clients. The account credentials stay in the existing
encrypted Qiniu profile.

`sfp-portfolio-kodo` runs on `127.0.0.1:33419` with the live Admin image and
production database. The HTTPS site includes `sfp-portfolio-kodo.conf` for
`GET /api/miniprogram/assistant/conversations/:id/portfolio/works/:workId/assets/:assetId/kodo?versionId=…`.
The gateway verifies the current consultation and exact publication, then
downloads the JPEG using a 60-second Kodo S3 signature. Streaming it through
the approved Mini Program download domain keeps access checks on every request.
All 144 authenticated reads matched their originals. Anonymous, other-user,
wrong-work and old-version requests were denied. Existing binary/Base64 reads
remain available. The existing Admin and camera containers were not restarted.

Build using `node admin/deployment/portfolio-kodo/build.mjs <output>` and install
`aws4@1.13.2` alongside the bundle. Server runtime files are under
`/datas/smartfloor/portfolio-kodo/`. The root-only previous Nginx configuration
and verification receipts are under `/datas/smartfloor/backups/tenant1-portfolio-kodo/`.
For rollback remove the portfolio include and snippet, run `nginx -t && nginx -s reload`,
then stop `sfp-portfolio-kodo`. The trial client falls back to the authenticated
JPEG endpoint. Retain the private objects for verification or an approved reentry.

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

For routine local packaging, run `release.bat` from `admin`. It checks Docker,
runs ESLint and the survey canvas and AI tests, then builds Next.js in Docker
with layer caching. The default command needs no local PostgreSQL connection.

```powershell
.\release.bat
```

For full release validation, run `.\release.bat -Full`. This adds `npm run
db:check`, the isolated PostgreSQL contract tests, a host Next.js build, and a
no-cache Docker build. The configured development database must be reachable.
The contract tests use the migrated and idle `127.0.0.1:55432/xiaok_embedding_eval`
clone with the application and owner connections from
`tmp/xiaok-vector/connection.private.json` (an isolated `DATABASE_URL` in the
shell can supply the application connection). The isolated preflight uses a
five-second connection timeout and ten-second query timeout. A failed check or
suite stops `-Full` before image packaging. Resolve database or tunnel issues on
the development targets and run any needed migrations explicitly.

The existing hotfix option `.\release.bat -Fast` skips local tests and lint and
still runs the production build in Docker. The script chooses the next daily
`YYYYMMDD-NNN` version or accepts `-Version 20260901-001` in any mode.

The outputs are the versioned ZIP, its `.sha256` sidecar, and
`auto_deploy.sh`. The ZIP contains the equally versioned Docker image, Compose,
migrations, build metadata, and nested integrity manifests. `BUILD_INFO` records
`release_mode` (`standard`, `full`, `fast`) and `postgresql_contract_tests`
(`passed` or `not_run`). The archive contains no runtime environment file.

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
When a XiaoK worker is running in this Compose project or enabled through
`COMPOSE_PROFILES=assistant`, it is recreated from the same image after Admin
becomes healthy. Deployment waits for its health check. Each worker process
reports its own preflight and tick. A disabled platform switch leaves it healthy
and idle.
Compose validation explicitly enables the `migration` profile so its
profile-scoped `migrate` service is included in the preflight service check.
The migration container uses the Drizzle files baked into the verified release
image, avoiding a host bind mount whose path can differ after release promotion.

The release baseline tracks the original bytes and order of the deployed
`0141`–`0143` migrations. The stage Agent and answer controls upgrade follows them with `0144`–`0147`.
Compose persists workflow definitions in the dedicated `native_workflow_store`
volume at `/app/tmp/native-workflow-store` in Admin. The XiaoK worker executes
through the internal Admin endpoint. An installation that overrides
`NATIVE_WORKFLOW_STORE_DIR` retains its own persistent mount. Recover workflow
definitions using the matching volume and PostgreSQL backups.

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
