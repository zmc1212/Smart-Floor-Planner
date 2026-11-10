# Cloud construction video development plan

> 2026-11-05:Mini live/playback/snapshot/PTZ.§2 alone schedules;replace values.Client fixes authorized;original soak unchanged.

Chinese mirror: [cloud-construction-video-plan.zh-CN.md](./cloud-construction-video-plan.zh-CN.md)

## 1. Final deliverable

**Four actions for a supported, authorized camera in the existing Mini/embedded-H5 entry.** No new video platform.

| Feature | User outcome |
| --- | --- |
| Live | Moving video,camera switching,exit/reentry and clear offline/permission feedback. |
| Playback | Select actual date/segment,play/return-live;truthful empty/expired/error states. |
| Snapshot | Save a current camera image with feedback;reenter private,unexpired history. |
| PTZ | Authorized/supported movement/stop;release/exit/disconnect stop protection.Unsupported controls unavailable. |

Wired=cloud,4G=local SD/transmit while viewed.Cloud defaults off/3days;enterprise defaults/camera overrides within node1..7days.SD follows actual capacity/indexes,no three-day deletion promise.This camera has bounded Mini SD/time evidence; stable binding identity and one-time legacy-window rebase are implemented and pass the isolated suite, so re-registration keeps the same binding's history; physical WeChat/independent route/reconnect remain pending.

Reuse configuration/access/storage/operations.Exclude billing/rental/after-sales,public-live consent,XiaoK analysis,permanent retention/bulk export,scheduled captures,patrol,intercom,timeline/speed controls.

## 2. Current delivery

| Field | Current record |
| --- | --- |
| Delivery and owner | Four Mini features,CV-01–04;CV-04 Limited,single owner,no new stage.11-05 recording replaces11-03 stop;old batches terminal. |
| Entry and outcome | Trial build 20261107-site-1 uploaded, with trial selection pending in the WeChat console. Scan and use the retained Weiyun employee account for project12, live, SD, records and the read-only album. |
| Verified gap | Physical WeChat, sustained viewing, PTZ, 4G reconnect and formal release remain unverified. SD remains limited to trusted post-binding/activation windows; re-registration no longer clears the same binding's history. Failed74h09 stays terminal. The uploaded build awaits trial selection. |
| Completed | Isolated gateway r2 deployed. Eleven asset hashes and 14 online page/permission checks passed. Actual 1080p live and SD playback stopped with zero viewer/SD/PTZ duties. WeChat upload and two trial codes succeeded. The dedicated key was revoked. [Playback](../tmp/cloud-site-trial-20261107/playback-deployed.json) |
| Next action | Select the uploaded 20261107-site-1 in the WeChat console and scan the generated trial code. Browser policy blocked the console page. Keep SD/off and leave the terminal soak stopped. |
| Required acceptance | Each feature:real action/feedback/reentry/access/failure recovery.Separate software/device/WeChat evidence.Soak supplements recording/expiry,never replaces features or blocks independent work. |
| Failures and calls | Retain auth5.8866h/350,DB/cleanup,stale sampling,unknown SDK/SD/whole-day outcomes.Storage/CIM/sampling/trace repairs1 each;recovery-driver2/fixture correction.User stop is not SDK failure.No unknown-write replay.Model/image/paid0,no new authority.Bundle WVP permission repair passed;policy/download/controller failures retained in receipt. |
| Environment/resources | Independent PG/gateway at/datas/sfp-camera-trial-20261106,private10.203.207.0/24. Original29 containers(28 running/1 exited) stable,formal57 migrations/data counts unchanged. Separate JWT,synthetic staff/one project,no real WeChat identities/cloud recording. Existing smartfloor domain entries read back,urlCheck=true;PGDMP/catalog verified. Shared3017/D/SSH/09 and paused automation remain. Dedicated key revoked/verified at completion;no local forwarding dependency. |
| Evidence and successor | [Gateway](../tmp/cloud-site-trial-20261107/gateway-r2/deployment.json), [playback](../tmp/cloud-site-trial-20261107/playback-deployed.json), [upload](../tmp/cloud-site-trial-20261107/upload.json) and [prior trial](../tmp/cloud-site-trial-20261107/../cloud-camera-production-20261106/assessment.json) retain separate scopes. Keep the original401 and preflight failures, never replay unknown writes. Continue this chat without an automatic successor. |

## 3. Reused foundation and contracts

- **Entries/data:** Admin `/construction-projects`;Mini `packages/construction/projects/projects` → `packages/construction/camera/camera` → H5 `/construction-camera`. Reuse PostgreSQL/Drizzle tenant transactions/RLS,WVP/ZLM adapters,independent gateway/Worker. Current API/migration/state details: [Admin](admin-system-modules.md),[Mini](miniprogram-system-modules.md);old API proposals do not schedule implementation.
- **Access:** enterprise_admin/selected-enterprise admin/super_admin manage configuration/grants without platform-admin employment/membership.Managers bind/capture/control;members view.Customer own-project grants required;capture/history/PTZ independently off.Report/public-live consent separate.
- **Media/device safety:** single-use entry,H5 session,leases/generations/CSRF/transfer revocation remain. Cloud keeps its calibrated binding;SD only trusted post-binding/activation footage; the stable identity excludes the registration timestamp, legacy windows are rebased once per binding, and re-registration does not reset history. Unknown clocks fail closed,unknown starts never replay. Keep durable STOP/shared leases/capability guards. Viewer exit does not stop recording.
- **Retention/recovery:** no revival by extending policy.Cloud deletion=physical404/410+no WVP index;snapshots expire/clear private bytes per policy.Keep capacity/15s freshness/hysteresis,explicit off/foreign plans.Cloud segments reach3600s;old5min/1..30day proposals are not implemented limits.
- **Approved UI:** 11-07 [cloud-site notebook 03/04](../design-references/cloud-site-redesign-20261107/README.md) and shared states govern Mini/H5 appearance; the 11-03 archive entry and Admin Ant/refactor remain. Loading, error/retry, revocation and no-autoplay retain their original behavior. [Ledger](miniprogram-design-restoration-ledger.md); [frozen behavior §§1.4,1.9,1.11](archive/cloud-construction-video-plan-before-simplification-20261105.md).

## 4. Accept the four features

| Feature | Existing evidence/status | Closure checks |
| --- | --- | --- |
| Live (CV-01) | Real H5 video,switch/reentry,revocation and Stable entry;bounded Implemented. | Mini entry to moving video,exit/reentry,offline retry and foreign-tenant denial;distinguish H5-browser,Stable-entry and physical-WeChat evidence. |
| Playback (CV-02) | Actual cloud/replacement-device LAN SD decoding;[dual mode](../tmp/cloud-camera-dual-20261103/),[defaults](../tmp/cloud-camera-defaults-20261103/),[customer grants](../tmp/cloud-camera-customer-20261103/),bounded Implemented. | Existing date/segment playback,return-live,empty/expired recovery and persisted selection;retain cloud/SD/source ownership,do not replace the player. |
| Snapshot (CV-03) | [Actual private capture/automatic retention](../tmp/cloud-camera-snapshot-20261103/) Implemented. | Real saved image/history reentry;retries do not duplicate captures;anonymous/revoked/expired reads denied. |
| PTZ (CV-03) | Software direction/STOP,leases/watchdog;physical movement/stopping/precision/zoom unverified,Limited. | Evidence of actual movement/stopping on supported hardware;release/exit/disconnect protection,contention and denial/unsupported branches.HTTP acknowledgement is not physical stop. |

Reuse matching source/configuration/scope. Client checks use authorized Stable's single window/controller/lock/finally cleanup. Stable5/5+host3/3 prove only their entry scope;browser video is not WeChat proof. Independent4G/SD/device/multistream/PTZ gaps stay explicit,without routine user hand-tests or blocking independent development.

recording-live=frozen07;08's gateway-ownership failure remains;09 passed recovery/capacity/cleanup. Synthetic expiry deleted28631;its playback receipt proves only that earlier window. Preserve each batch's failures/drift/build blockers;no new full-build/full database-suite pass implied.

## 5. Acceptance, operation and deployment boundaries

1. **Features/soak:** deliver the four Mini features. Existing74h observation supplements reliability/expiry,not a feature or all-development gate. Require real1/min(max120s),fresh Worker/actual MP4,gaps≤2s,hourly private206/anonymous401,24/72h coverage,natural3day physical404/410+missing WVP index. Smoke/synthetic401/aged fixtures cannot substitute;no clock acceleration/failed-batch continuation.
2. **Bounded checks:** name the gap/check;run only affected unit/type/lint,service/client validation. Bind source/drivers/dependencies/configuration,container/full mounts/SSH/physical capacity.Drift/blocking failure stops affected batches.Preserve original failures/unknowns/costs/counts;diagnose before repair.Allowlisted401 reads replay once at most;controls/writes/capture/deletion/unknown outcomes never replay.
3. **Environment:** authorized fixtures/`cloud_camera_eval`,55432→remote15433;115 entries after0116,0114 absent,no mixed-journal replay.Read [remote contract](remote-development.md):`sfp-remote-dev`/physical D,ZLM writable/probe readonly same source.Preserve shared3006/remote media/databases/SSH;local Docker off,F/old volumes rollback-only;automation-4 paused,no parallel owner/controller.No new formatting/reboot/PTZ/device-plan/paid-call authority from this clarification.
4. **Terminal cleanup:** fixture/version/process guards restore this batch's originalPolicy without overwriting human changes.Confirm MP4=false,off/stopped,zero SD/view/PTZ/writer duties before releasing owned resources.Resolve unknown initial writes from actual state;capacity/probe failure cannot block stopping.Never read/copy private keys.
5. **Production:** authorized scope is the standalone WVP stack,original-camera onboarding and now formal HTTPS WVP management via existing wildcard/Nginx pattern.No Admin/business migration/Mini gateway rollout.Preserve other host services/data;new ingress needs exact owned config,syntax/auth/live checks and graceful reload.Back up additions before owned rollback;old F alone is insufficient.[Frozen rollback§9.1](archive/cloud-construction-video-plan-before-simplification-20261105.md) retains history,not additional authority.

## 6. Record maintenance

- **Limits:**160 lines/language;Chinese8000/English12000 Unicode characters.Section2:one table/9 fields,Chinese2400/English4200.Replace values,never append latest/patch/next-step updates.Merge/link evidence to fit;preserve failures/unknowns/authorization,never silently relax caps.
- **Responsibilities:**plan=four outcomes/current task/acceptance/boundaries;inventories=current behavior/limits.Commands/hashes/logs/resources/usage/attempts stay in evidence.No journals or new product stages for internal repairs.
- **Checks:**count lines/Unicode characters/current fields and length;verify bilingual parity,paths/anchors and `git diff --check`.Document edits trigger no model/product replay,batch resumption,owner takeover or unrelated commits.
- **Same-chat continuation:**automatic successor/handoff authorization is revoked.Continue this chat after compaction;replace§2 checkpoint when needed,retaining decisions/workspace/evidence/failures/unknowns/resources/next action.Only an explicit user request permits a successor;historical handoffs grant no authority.

## 7. History and evidence

- [Frozen original](archive/cloud-construction-video-plan-before-simplification-20261105.md):specifications/designs/sources/failures/unknowns/counts/costs/approvals;targeted lookup,never a queue.
- Only§2 schedules.Frozen09 retains manifest/environment/short-test/cleanup/soak.[Old operations](../tmp/cloud-camera-operations-20261103-05/),[cloud](../tmp/cloud-camera/),[SD](../tmp/cloud-camera-sd/) and§4 evidence stay separate,never pooled into a clean pass.Current client/snapshot fixes are documented;routes/access/approved layout/production boundaries remain.
