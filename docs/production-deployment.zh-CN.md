# Admin 正式环境发布与回滚

本文是 `admin/release.bat`、`admin/auto_deploy.sh` 和 `admin/deploy.sh` 的正式运维合同。发布脚本只做应用发布、迁移前备份和应用版本回滚；它不会自动把生产数据库恢复到旧备份，也不会逆向执行迁移。

## 当前阶段 Agent 发布

正式后台、抢单 Worker 和小 K Worker 已同步至 `20261124-001`，镜像 config digest 为 `sha256:cbd8a9e9f85f75f961f0a0a77d687761e19a7670e15a3825772f9df52c847ac1`。标准打包使用工作区应用源码快照 `637444cf0a60ed240b8c51fd1aad4edfec1a88e5`。ZIP SHA-256 为 `ae1aef6968219b8ffb9859af1922ee689a549336abc55999e1caaf9c963d7c26`。上一后台版本为 `20261120-001`。[源码绑定](../tmp/production-release-20261124-001/source-binding.json) · [服务核验](../tmp/production-release-20261124-001/production-server.log)

原 PostgreSQL 数据卷应用 `0144`–`0147`，迁移账本从 140 条增至 144 条。首次尝试遇到 `sfp_migrator` 定义函数配置参数的权限限制并回滚。迁移前备份 `smart_floor_planner-20261124T021950Z-pre-20261124-001.dump` 校验通过。在同一事务内临时授予迁移角色对 `app.is_platform_admin` 的 `SET` 权限，以迁移角色执行原包 SQL，并在提交前撤销权限。随后复用同一发布包完成标准发布。[首次记录](../tmp/production-release-20261124-001/production-deploy.log) · [重试记录](../tmp/production-release-20261124-001/production-retry.log) · [PostgreSQL 17 参数授权](https://www.postgresql.org/docs/17/sql-grant.html)

已启用小 K 的企业 1、3 通过卷内 `/app/tmp/native-workflow-store/.runtime/agent-binding.json` 使用现有模型。获权管理员可直接使用十个系统默认阶段。正式测试企业 3 读到全部默认项，水电试问实际调用 `stage-system-guidance@1`，重新登录可读回已保存回复。缺少知识库菜单权限的测试账号返回 `403`。临时 SSH 公钥已撤销并验证重新登录被拒。[工作流回执](../tmp/production-release-20261124-001/production-receipts.log) · [回复回读](../tmp/production-release-20261124-001/production-preview-reentry.json) · [公钥撤销](../tmp/production-release-20261124-001/production-key-reauth.log)

应用回滚时按需用 `/datas/smartfloor/backups/pre-20261124-001.XWQRoOLN` 下的受保护基线恢复运行时配置。重建 `20261120-001` 时恢复保留的家人邀请码热修文件。微信小程序正式版仍待发布。

## 2026-11-19 预约量房发布

正式 Admin、抢单 Worker 和小 K Worker 当时更新至 `20261119-004`，镜像 config digest 为 `sha256:69413a9e738cfc440f542443dddc81eaca9b12baca4c7c17b294245f7aa6a9a5`。服务器复用上次上传中三个字节一致的镜像层并重组发布包。发布包 `sfp-admin-release-20261119-004.zip` 的 SHA-256 为 `b15b59f1f01e06e7f72ca033bcdd57cf78d6562ca574b3c93c9e32f53e1e5791`。上一应用版本为 `20261119-002`。[发布回执](../tmp/designer-booking-release-20261119/production-finish-004.log)

`20261119-003` 首次发布应用 `0143_measurement_appointment_contact` 后，抢单 Worker 的 `FOR UPDATE OF` 因表名带 schema 而失败。应用回滚至 `002` 后保留新增字段。`004` 改用线索表别名锁定，迁移账本保持 140 条，`measurement_appointments.contact_phone` 为可空 `text`，PostgreSQL 数据卷标识一致。发布前备份 `smart_floor_planner-20261119T132408Z-pre-20261119-004.dump` 共 38,093,357 字节，校验通过。后台登录、两个 Worker 健康检查及未登录访问预约接口返回 `401` 均通过。临时 SSH 公钥已移除，重新登录验证被拒绝。[回滚记录](../tmp/designer-booking-release-20261119/production-deploy.log)、[服务器验证](../tmp/designer-booking-release-20261119/production-server-004.log)、[公网验证](../tmp/designer-booking-release-20261119/production-public-004.json)。

微信开发版 `20261119.3` 已上传，真机预览使用正式 API。正式版待微信公众平台提审和发布。[上传回执](../tmp/designer-booking-release-20261119/wechat-upload.log)。

## 2026-11-20 云工地家人流程热修（20261120-001 可写层）

`20261120-001` 于 2026-11-20 发布（`git_commit bc834f43`、dirty 工作区全量发布、构建于 13:40:34，含迁移 0141–0143 与预迁移备份 `smart_floor_planner-20261120T055935Z-pre-20261120-001.dump`）。发布后在 `20261120-001` 可写层做过两处容器内热修（`.next/server/chunks/_0k7vy46cjrv0a._.js`），等效仓库修复已在中英模块文档记录，下次镜像发版自然覆盖：

1. 家人邀请码分支路径长度判断 `4===I.length` 修正为 `3===I.length`：`4` 导致 `GET /api/miniprogram/construction/projects/:id/family-invite-code?env=` 永不命中、落入员工门禁返回 403 `construction_forbidden`，业主扫码出码始终失败。
2. 移除施工客户流程 6 处 `actor.mode === 'customer'` 分支前置（accept、customer-projects、family-invite-code、video、progress/family-viewers/family-invite，及德摩根形式下的 owner-sites 守卫）：这些流程按底层 userId 鉴权（业主门禁、家人绑定在服务内部），同一用户任意身份模式可见数据一致；修复后带员工/推荐人身份的账号不再被登录默认 staff 上下文挡在家人流程之外。

修复经 staff token 探针验证（accept 由 `construction_not_found` 变为分支命中后的 `construction_invite_invalid`，customer-projects 返回 200），真机家人扫码接受邀请并只读查看进度与直播通过。诊断脚本与证据：`tmp/family-invite-code-repro-20261120/`。

## 2026-11-18 装修画像发布

正式 Admin、线索 Worker 和小K Worker 已更新至 `20261118-003`，镜像 config digest 为 `sha256:996b7e77b8d70684c06dada4678c2717ab9514f08625e7eed4d95a424ce01887`。本版沿 `002` 补房屋提取修正，并保留其普通咨询路由修复。没有新迁移，账本保持 135 条，具体哈希随包保存在 `SOURCE_BINDING.json`。数据库 HTTP 健康、两个 Worker、管理员登录冒烟及获准测试业户画像回读均通过。`003` 四轮定向验证前后的 11 个运行时文件及试验输入哈希一致，较早 `002` 的 11 轮及房屋投影失败独立保留。[发布与验证](../tmp/staff-profile-housing-correction-20261118/production-verification.json)。

标准发布流程已验证发布前 custom 备份 `/datas/smartfloor/backups/postgresql/smart_floor_planner-20261117T185039Z-pre-20261118-003.dump`（37,015,839 字节）的 SHA-256 和归档目录，PostgreSQL 数据卷身份前后一致。服务器回执位于 `deploy-state/first-reply-20261118-003/`。此前 `001` 的迁移失败、事务回滚和旧画像表/生命周期函数归属对齐为现有 `sfp_migrator` 的记录仍保存在 `deploy-state/staff-profile-20261118-001/`，强制 RLS 和 `sfp_app` 数据权限在该批已核对。[当前发布日志](../tmp/staff-profile-housing-correction-20261118/production-deploy.log)、[原迁移回执](../tmp/staff-profile-release-20261118/production-backup-and-health.txt)。

`current-version`/`current-image` 当前指向 `003`，`previous-version`/`previous-image` 指向上一实际版本 `002`。`auto_deploy.sh rollback` 更新 Admin 和线索 Worker，小K Worker 需使用对应 Compose 的 `assistant` profile 同步切回相同回退镜像，保留数据和迁移历史。此前 `005`/`004` 状态不一致的原快照保留于 `001` 审计记录。路由/引导 28 项、画像服务 24 项及未改动的小程序 89 项通过，全量 PostgreSQL 回归保留原失败。后台房间汇总仍为 Limited，原生页面发送未验证。小程序 `20261118.1` 已上传，公众平台浏览器访问被站点安全策略拦截，正式审核/发布待完成。[验证范围](../tmp/staff-profile-housing-correction-20261118/scope-validation.json)、[小程序回执](../tmp/staff-profile-release-20261118/miniprogram-upload-status.json)。

**2026-11-18 Worker 上报范围发布 20261118-004（已部署）。** 按用户授权以 `20261118-003` 为基线，仅叠加工人工作台上报范围接口（`from`/`to`）、本人历史上报与今日汇总、最多 9 张照片与施工阶段快照、经理/设计师/老板审核权限，生成并部署 `20261118-004`。发布包 `sfp-admin-release-20261118-004.zip`（SHA-256 `77a11c352bdbabbaa27149aafab74d101331e25726f9749538a532894b952e94`），镜像 `zmc1212/sfp-admin:20261118-004`（`sha256:e9cb56e4f5dd070d0b9a66c0aab2a0b82e87d76b3ce699d3d9dadf5d5f70e500`）。`auto_deploy.sh deploy` 在迁移前生成 custom 备份 `smart_floor_planner-20261118T060611Z-pre-20261118-004.dump`（37,314,865 字节）；迁移账本 135→136，新增 `0140_construction_worker_reports`（`created_at=1797235200000`），`stage_snapshot` 列与 `position <= 8` 约束已回读。`current-version`/`current-image` 现为 `004`，`previous-version`/`previous-image` 为 `003`。Admin、线索 Worker、小K Worker 均为 004（小K Worker 使用同一 `SFP_RUNTIME_ENV_FILE` 手动同步），PostgreSQL 数据卷身份前后一致，`/api/health`、登录与核心路径冒烟通过。线上 `GET /api/miniprogram/construction/workbench?projectId=5&from=2026-11-18&to=2026-11-18` 对员工 31、员工 32 与设计师 10 返回 200；宽范围返回 2 条历史；反向区间、超过 92 天和缺少 `to` 仍返回 422。小程序 `20261118.1` 无需重新上传。[验证证据](../tmp/worker-reports-20261118/production-verification.json)。

**当前工地视频抓拍封面（2026-11-20，已部署）。** 本次将 `index.html`、`player.js` 和 `style.css` 安装到正式 `20261119-004` 的 `smart-floor-planner-admin` 可写层。正式企业 1 和 3 的视频会话经 `127.0.0.1:33418` 上的 `sfp-construction-camera-current` 使用共享会话处理器读取 `GET /api/construction-camera/cover/:bindingId`。线上网关绑定文件 SHA-256 为 `527928a7cee4c69f748d50cd46776761c735c8a0149176abf8eeef33a0665dfb`。后续镜像需纳入仓库中的播放器和网关代码。公网三份资源哈希一致，均返回 `no-store`。正式企业 3 的测试工地通过员工入口取到北京时间 12:00:15 的 JPEG，匿名读取返回 401。临时 SSH 密钥已撤销，重新登录被拒。安卓微信进页封面和一次点击播放待真机核验。[H5 发布](../tmp/camera-android-autoplay-20261120/production-release/publish-h5-2026-11-20T04-01-21-834Z.json) · [公网核验](../tmp/camera-android-autoplay-20261120/production-release/public-verification.json) · [鉴权封面](../tmp/camera-android-autoplay-20261120/production-release/private-after.json)

最初两轮定时抓拍在 4G 起流阶段触发 WVP 的 3 秒截图超时，摄像头随后仍生成了照片。已按原始文件与槽位配对，使用实际拍摄时间恢复两张封面。新版调度先经 WVP 的直播入口等待共享视频流，再获取抓拍。该取图流程已在线上测试机位取到新 JPEG，隔离库调度检查通过，下一轮线上定时触发待观察。[WVP 超时](../tmp/camera-android-autoplay-20261120/production-release/capture-error-2026-11-20T04-02-35-922Z.json) · [实机取图](../tmp/camera-android-autoplay-20261120/production-release/trace-warmed-camera-capture-2026-11-20T04-04-47-390Z.json) · [网关发布](../tmp/camera-android-autoplay-20261120/production-release/promote-warmed-capture-2026-11-20T04-08-02-538Z.json)

回滚前对照发布回执核对现行哈希。用 `/datas/smartfloor/backups/camera-cover-hotfix-20261120.Cr8r8RoU` 中的三份 `previous-*` 文件原子恢复 H5，沿用目标文件的属主和权限。将 `gateway.previous.cjs` 恢复到 `/datas/smartfloor/camera-gateway/gateway.cjs` 后重启 `sfp-construction-camera-current`。如仅回退定时抓拍流程，可恢复同目录的 `gateway-route.cjs`。恢复后核对网关健康、公网资源哈希和匿名拒绝。前版仅修复自动播放的热更新在安卓微信实测仍要求手势。[前版发布回执](../tmp/camera-autoplay-20261120/production/publish-2026-11-20T03-05-16-818Z.json)

**2026-11-23 项目 5 合成调试机位（已部署）。** 正式后台保持 20261120-001。视频网关配合原 HTTPS 摄像头 include 接入项目 5 的业主封面、机位列表和入场三个精确路径，白名单只含企业 3 项目 5 的业主用户 2。内部源 `sfp-camera-debug:8080` 运行本地镜像 `sfp-camera-debug:20261123-003`，在私有视频网络提供合成 H.264 画面和同一段素材提取的 JPEG 封面。WVP 和实体设备记录沿用原流程。部署前后 SQL 回读一致，项目 5 的实体绑定为 0，项目 6 为机位 1、绑定 6。回滚按顺序恢复备份的 `nginx-before.conf` 并验证、重载 Nginx，停止新网关，将保留的 `sfp-construction-camera-before-project5-20261123` 恢复原名及运行，最后停止专用源容器。备份配置及网关包位于 `/datas/smartfloor/backups/project5-debug-20261123.HFQle7CD/`。[发布回执](../tmp/project5-debug-camera-synthetic/release/deploy-output.txt) 13:45 上线的封面子版本可独立回滚。停止当前网关，使用 `gateway-before.cjs` 恢复挂载文件。停止并改名当前合成源，将保留的 `sfp-camera-debug-before-cover-20261123` 改回 `sfp-camera-debug` 并启动，再启动网关。封面回滚文件位于 `/datas/smartfloor/backups/project5-cover-20261123.EL8cAlky/`。[封面发布回执](../tmp/project5-debug-camera-cover/deploy-output.txt)

<!-- cloud-camera-cloud-mini-integration -->
**私有SD时间接入：限定Implemented。** 新增sfp-wvp-sd-clock-20261106组件，复用原镜像/只读WVP日志，白名单/token私有配置位于/datas/sfp-wvp-sd-clock-20261106/；仅127.0.0.1:28083、UID10001/cap_drop/全只读挂载/无Docker socket、unless-stopped。经原WVP观察新DeviceStatus时间，原28容器、二进制/站点/配置保持。配置0400并私有备份；应用用CAMERA_SD_CLOCK_ORIGIN/TOKEN显式选择，不回退服务器时间。Mini仅列当前注册身份/时间可信窗口，缓存开播再核身份/时差。真实Mini宿主/H5 SD查询/播放/重进/故障重试/STOP通过，私有媒体/义务0；自有3417/3418/四端口转发/unit库/公钥已清理，保留副本/共享3017/D/SSH。新SQL/组件/站点备份与新SSH登录拒绝已验。[实证](../tmp/cloud-camera-mini-sd-20261106/assessment.json)。无正式业务/小程序发布，不冒称完整恢复/物理微信/PTZ/重连通过。
<!-- /cloud-camera-cloud-mini-integration -->

<!-- cloud-camera-phone-trial -->
**微云手机体验版：Limited，云端接入/有界联调Implemented。** 用户11-06最终选择“体验版＋微云测试员工”，取代此前精艺企业3选择。AppID wxa7728432f59779d1、体验版本20261106-camera-sd-2；正式小程序1.5.0、Admin20260905-001和正式库保持。smartfloor.zlyun168.com既有request合法域名及WebView业务域名已回读，无域名配置变更；体验包urlCheck=true，无跨环境回退。

部署源[camera-trial](../admin/deployment/camera-trial/)，目录/datas/sfp-camera-trial-20261106、Compose sfp-camera-trial。独立PG/网关不发布宿主端口，专网10.203.207.0/24；网关只监听10.203.207.2:33417，PG专网5432，WVP走原私网。网关UID1001/只读根/cap_drop/无Docker socket/768MiB，PG384MiB，两者unless-stopped；独立raw规则/systemd在Docker前保护私有端口。JWT与正式站独立，环境/导入/备份均为root私有。数据库由隔离schema快照恢复，迁移账本0，不伪填已执行迁移，不作正式库迁移基线或自动跑混合journal。仅复制微云一个合成工地及保留员工，正式57迁移/4企业/78用户/18员工/39线索未变，原29容器（28运行/1已停）ID/启动时间/全部挂载无漂移，原WVP网络/规则保持。

Nginx只增加测试API/H5/媒体路径；原站有私有备份，nginx -t/平滑重载通过，主进程31981保持。回退只撤测试include并验证/重载、停止本Compose，保留测试数据，不覆盖正式库。已在线导出并校验本实例PGDMP/目录；不等于完整媒体灾备。专用SSH结束时撤销并验证；体验服务无本机/SSH转发依赖。公网1080p直播/SD和Stable真实员工入口/重进已验，真机解码/持续观看未验。[当前资源/备份/回滚实证](../tmp/cloud-camera-production-20261106/assessment.json)。

体验版无参数登录现按 /camera-test-api 配置自动选用已有账号密码态，普通环境仍默认手机号；修正版 20261106-camera-sd-2 已上传，官方trial码直达 packages/business/login/login。首轮手机19:18的403原件保留；客户端24项、Stable390×844无mode参数默认表单/实际员工登录/视频入口/重进4项通过，零漂移并恢复会话。未改登录布局、文案、素材或服务端身份限制；修正版手机重试/解码仍未独立观察。[入口修复](../tmp/cloud-camera-production-20261106/login-entry-fix.json)。

**2026-11-11 网关 r3（20261111-site-1）—— SD 稳定身份已部署，有界 Implemented。** 已部署试验环境的诊断结论：摄像头全程在线（核验窗口 11-06→11-11 每天都在推进），服务器容器从未停机；问题在 r3 之前的旧身份指纹把 GB28181 注册时间戳算进哈希，该摄像头每约 15 分钟重新注册一次，窗口链每天断约 110 次，SD 可回放范围永远只有最近约 15 分钟。用户重新加回专用 SSH 密钥后，按顺序落地：sd-clock 探针升级为稳定身份（identity v2，哈希排除 registerTimeStamp）、试验库 `camera_trial` 先备份（`before-0120.dump`）再应用迁移 `0120_construction_camera_sd_identity_version.sql`、然后部署以 HEAD `c190fd3f` 构建的网关 r3（287 个受管 bundle 输入逐字节验证等于该提交；Dockerfile 与 16 个 H5 公开资源逐字节复用 r2，页面哈希不变）。仅重建网关容器，其余 30 个容器无漂移，自动回滚护栏未触发。全部 484 行窗口一次性重基为 `identity_version=1`、单一稳定指纹；随后窗口链跨过一次重注册周期连续运行 20+ 分钟、60 秒核对持续成功（旧机制下不可能），零新窗口行。按上海日期实测可回放：11-06 18:31 起共六天（11-06 至 11-11，每天 15–17 段设备真实录像）；11-05 及更早设备已无片段（循环覆盖）。未知项：摄像头确切卡容量/码率、以及换用其他设备时单个核对失败周期是否仍可能切分窗口，均未测量。凭证：[部署](../tmp/cloud-site-trial-r3-20261111/deployment.json)、[部署后探测](../tmp/cloud-site-trial-r3-20261111/post-deploy-probe.json)、[构建清单](../tmp/cloud-site-trial-r3-20261111/gateway-candidate.json)。专用 SSH 密钥在验证完成后已再次撤销。
<!-- /cloud-camera-phone-trial -->

## 企业 1 线上演示环境

Admin `20261113-001` 为企业 `1` 提供带演示标记的项目 `1` 和 12 套作品。
小K已在企业 `1` 启用，使用平台共享文字模型配置（`dashscope`、
`deepseek-v4.1-flash-1017`）。4 份 PPT 工艺资料通过现有 pgvector 链路和
`text-embedding-v4` 完成索引，保留为员工草稿。

`sfp-construction-camera-production` 监听 `127.0.0.1:33418`，使用正式库，
通过 `sfp-wvp-cloud_default` 连接 WVP。运行文件位于
`/datas/smartfloor/camera-runtime/`。Nginx 摄像头片段与
`sfp-construction-camera-production-map.conf` 将企业 `1` 的会话路由到此网关。
换票在正式网关返回 `401` 后交给原试用网关。两个网关各自校验票据和会话。
项目 `1` 绑定一台摄像头，演示业主具备仅观看权限。业主视频入口、员工会话和
匿名拒绝均已验证。WVP 报告通道离线，实际点播返回 `502`，画面仍待验证。

发布包的 Compose 已把 `sfp-wvp-cloud_default` 声明为 Admin 的外部网络，`deploy.sh` 重建 Admin 时会同时接入，不再丢网。为兼容没有这条声明的旧发布包，`deploy.sh` 与 `auto_deploy.sh` 在部署和回滚完成后都会自动检查并补接；补接只作用于 Admin 容器，不会重启摄像头网关、WVP 或 ZLM。网络名可用 `SFP_CAMERA_NETWORK`（或运行时 env 文件中的同名变量）覆盖。

发布或回滚后可自查：

```sh
docker inspect smart-floor-planner-admin \
  --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
curl -fsS http://127.0.0.1:33418/camera-gateway-health
```

补接失败只输出告警、不阻断发布；此时应手工核查授权视频入口。

写入前的数据库归档与原摄像头配置位于
`/datas/smartfloor/backups/tenant1-demo-20261113/`。如需回退摄像头路由，
恢复原 Nginx 片段并移除正式摄像头映射，再执行 `nginx -t && nginx -s reload`，
然后停止正式摄像头网关。

### 企业 1 体验版作品私有图

华东 `z0` 私有空间 `sfp-zly-portfolio-demo-20261113` 保存已发布演示作品
`1`–`12` 引用的 144 张 JPEG 副本，逐张与原件核对。对象键绑定不可变的作品、
资产编号和内容指纹。原图记录和公开媒体存储配置继续服务已有客户端。
七牛凭据沿用现有加密配置。

`sfp-portfolio-kodo` 通过线上 Admin 镜像和正式库运行，监听 `127.0.0.1:33419`。
正式 HTTPS 站点的 `sfp-portfolio-kodo.conf` 提供
`GET /api/miniprogram/assistant/conversations/:id/portfolio/works/:workId/assets/:assetId/kodo?versionId=…`。
网关先校验当前咨询和准确的发布版本，再用 60 秒七牛 S3 签名读取 JPEG，
通过已配置的小程序下载域名传输，每次请求均重新鉴权。已验证 144 张授权读回
与原图相同，匿名、他客、错作品及旧版本拒绝。原二进制和 Base64 接口仍可用。
本次无需重启 Admin 和摄像头容器。

以 `node admin/deployment/portfolio-kodo/build.mjs <输出目录>` 打包，运行依赖
`aws4@1.13.2`。服务器运行文件在 `/datas/smartfloor/portfolio-kodo/`，原 Nginx
配置和验证回执在 root 私有目录 `/datas/smartfloor/backups/tenant1-portfolio-kodo/`。
回退时移除作品网关的 include 和片段，运行 `nginx -t && nginx -s reload` 后
停止 `sfp-portfolio-kodo`。体验版会回退原鉴权 JPEG 接口，私有对象留存以便核验和重新接入。

## 独立 WVP 试部署包

用户已授权在 `124.70.90.30` 独立新装 WVP/ZLM、MySQL、Redis、只读容量探针，
通过后台 OpenSSH 操作；禁止 computer-use 占用桌面。原开发电脑制作的离线包保持，
本范围不包含 Admin 发布、业务库迁移、小程序网关或现有项目升级。
服务器为 CentOS7.9/x86_64、8核/32GB，预检可用内存约5.7GiB、数据盘约108.5GiB、
系统盘约14.6GiB；Docker26.1.4/Compose2.27.1/Python3.6.8。公网带宽套餐未核。
当前状态：**办公网接入及https://wvp.zlyun168.com正式HTTPS管理已验，含真实1920×1080 H264出画**；五服务健康，
8项认证/容量检查、5项安装边界测试通过。[接入实证](../tmp/wvp-bundle-20261105-01/onboarding-verification.json)，
[初始基础设施实证](../tmp/wvp-bundle-20261105-01/production-verification.json)。

安装目录 `/datas/sfp-wvp-production-20261106/sfp-wvp-20261105-001-linux-amd64`，
数据目录 `/datas/sfp-wvp-data`，Compose项目 `sfp-wvp-cloud`。
管理/媒体/容量端口为回环 `28080/28081/28082`，SIP15060、RTP20000–20035；
避开原FRP18080和旧ZLM30000–35000。MySQL/Redis不发布宿主端口，默认不启录。
固定五镜像、随机凭据、归属/校验/端口/UID10001目录保护见
[维护源码与操作指引](../admin/deployment/wvp/README.zh-CN.md)，
[远端导出器](../admin/scripts/remote-dev/export-wvp-bundle.ps1)。
成品SHA256 `8e506d8693ad897c480851f8868c286355ce5ac0e3ca0c43032424132f6414a5`，
文件869MB；[隔离包验收](../tmp/wvp-bundle-20261105-01/verification.json)保留原失败与22表恢复实证。

宿主独立适配 [host-network-guard.py](../admin/deployment/wvp/host-network-guard.py)
不在001冻结归档内，单独部署于上述父目录。Docker26的回环端口限制由两条精确的
raw/PREROUTING规则补充：保护该实例回环HTTP与独有子网私有端口；不清空旧规则。
`sfp-wvp-cloud-network-guard.service`配置在Docker启动前恢复规则；重入无重复，原规则保持，重启实测未做。
网络 `sfp-wvp-cloud_default` 的固定当前子网为 `192.168.80.0/20`；重建网络前须重核
`network-guard.json`，不得套用旧子网。当前未升级/重启Docker、系统或旧业务。
CentOS7已结束维护；这是一台旧宿主上的有限试部署，不作为长期生产维护达标证明。
[CentOS](https://www.centos.org/centos-linux/)；[Docker回环限制](https://docs.docker.com/engine/network/port-publishing/)。

用户已创建wvp-camera并仅关联124.70.90.30，保留default及办公/32规则。手工4G测试
方案仅增加TCP15060/20000–20035临时来源规则，当前云规则/运营商出口未独立回读。
摄像头 `192.168.10.100` 已切云端，设备/视频通道ID仍为
34020000001320000005/34020000001320000006，TCP信令/TCP-PASSIVE媒体。
固件将32位SIP密码截成31位，首写已回退；当前采用WVP原生单设备24位随机密码，
全局凭据保持。初次办公验收曾关闭4G；用户现已自行启用并反馈4G直播可播，保留
其当前设置，不据此宣称独立核验纯4G路由/公网出口。[用户反馈](../tmp/wvp-bundle-20261105-01/4g-live-user-report-20261106.json)。
IP/DHCP/网关/端口均保持；网关MAC写入被固件忽略，不能认定它是原因。无重启/SD/PTZ动作。
首次点播因ZLM端口池不足36而失败；备份后将运行配置20000–20009改为20000–20035，
只重建本栈WVP/ZLM，001归档及固定镜像保持。维护源码已在Docker前拒绝更小端口池。
实际RTP20032、收到1,441,792字节FLV并解码224帧1920×1080 H264；测试点播已停，
媒体/RTP消失、录像关闭，设备仍在线。办公接入实证的驱动/配置/资源稳定，原23容器保持；
后续HTTPS的Nginx工作进程平滑重载见下文。
保留早期探测、密码、端口及未排序挂载断言失败与规范化回读，不重放原写入。
独立4G重连/SD、微信、产品网关、多路及完整媒体灾备仍未验。[华为云路径](https://support.huaweicloud.com/usermanual-ecs/zh-cn_topic_0030878383.html)。
原74h批次已于11-06 11:37因资源哈希漂移失败，
18.09h/1086观测，不是此次主动切换中断；新只读检查为策略58/cloud/off/stopped、
MP4=false、SD/观看/PTZ/写入义务0，无长测控制器，不续跑旧批。

正式管理入口为 [https://wvp.zlyun168.com](https://wvp.zlyun168.com)，账号`admin`，
沿用安装生成的WVP管理员密码。DNSPod的A解析指向124.70.90.30，复用原有效至
2027-01-13的泛域名证书；[独立Nginx入口](../admin/deployment/wvp/nginx-public.conf)
代理回环服务，媒体请求/WS握手复用原wvp_token/API鉴权，公网ZLM控制/Hook/文档拒绝。
访问日志不含凭据查询参数。固定2.7.4的空TLS播放字段由代理归一，原生节点TLS手改值
重启会重置。原11站点配置/其余27容器/Nginx主进程保持，仅本栈WVP重启与工作进程
平滑重载属本次预期验证。正常公网DNS/TLS、原版登录/设备重进、真实1920×1080画布与
WSS328消息/811829字节已验；上轮自有测试结束时媒体/读者0且录像关闭，当前用户观看
未查询/停止。4G直播按用户反馈记录；WebRTC/RTSP/RTMP、独立4G重连/SD、小程序集成及完整媒体灾备未验。[域名实证](../tmp/wvp-bundle-20261105-01/public-management-verification.json)
保留原黑屏/原生覆盖/驱动失败及最终源码哈希。域名接入后的SQL/配置/入口备份为
`.state/backup-20261106T075146669182Z`，校验与密钥清理已证，不等于完整媒体灾备。

也可在本机手动保持 `ssh -N -L 28080:127.0.0.1:28080 -L 28081:127.0.0.1:28081 root@124.70.90.30`，
浏览器访问 `http://127.0.0.1:28080`；admin及SIP随机密码只存安装目录
`.state/installation.private.json`，不贴聊天。临时受限公钥不支持转发。本次专用公钥已撤销并验证拒绝登录；其余SSH授权及Xshell会话保持。后续远程接入操作需用户重新添加专用公钥。
停止用包内 `bash deploy.sh stop`，只停本实例并保留数据；备份用 `bash deploy.sh backup`，
仅含MySQL与安装配置，不含录像/JWK/抓图，不等于完整灾备或跨版本覆盖恢复。

## 一次性服务器准备

建议固定目录为 `/datas/smartfloor`：

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

`.env.production` 只保存在服务器，不进入 ZIP、Git 或 Docker 镜像；执行 `chmod 600 /datas/smartfloor/.env.production`。正式环境至少确认：

- `AUTH_COOKIE_SECURE=true`；
- `ALLOW_TENANT_ENTERPRISE_RESET=false`；
- `JWT_SECRET`、`INTERNAL_SECRET`、`CRON_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` 均至少 32 位强随机值；
- `INITIAL_ADMIN_PASSWORD` 至少 12 位，首次初始化后改密；
- 配置专用、低权限、活动状态的 `DEPLOY_SMOKE_USERNAME` 和 `DEPLOY_SMOKE_PASSWORD`；
- 可用 `DEPLOY_SMOKE_PATHS=/api/path-a,/api/path-b` 增加适合该账号权限的只读核心 GET 检查；`/api/auth/me` 始终检查。

脚本优先读取环境变量 `SFP_ENV_FILE` 指向的文件，其次读取部署根目录 `.env.production`。首次从旧部署升级时可临时回退使用 `sfp-admin-release/.env.production`，但应尽快迁出旧目录。

如果服务器上已有 `smart-floor-planner-postgres` 或 `smart-floor-planner-admin`，脚本会读取其 `com.docker.compose.project` 标签并继续使用同一 Compose project，从而继续挂载原 PostgreSQL volume。没有既有容器时默认 project 为 `smart-floor-planner`；特殊环境可明确设置 `SFP_COMPOSE_PROJECT`。不得随意修改这一值。

Compose 只把 PostgreSQL 映射到宿主机 `127.0.0.1:5432`；容器间走私有网络。云安全组和主机防火墙仍应明确拒绝公网 `5432`。

## 构建发布包

在 Windows 的 `admin` 目录执行 `release.bat` 进行日常打包。脚本检查 Docker，
运行 ESLint、量房画布和 AI 测试，再使用 Docker 缓存构建 Next.js 生产镜像。
默认流程无需连接本地 PostgreSQL。

```powershell
.\release.bat
```

完整发布验收使用 `.\release.bat -Full`，额外执行 `npm run db:check`、隔离
PostgreSQL 合同测试、宿主机 Next.js 构建和无缓存 Docker 构建。开发库需可连接。
合同测试使用已迁移、空闲的 `127.0.0.1:55432/xiaok_embedding_eval`，从
`tmp/xiaok-vector/connection.private.json` 读取应用账号与所有者连接。也可通过
Shell 中指向隔离库的 `DATABASE_URL` 提供应用连接。隔离库预检的连接超时为
5 秒，单次查询超时为 10 秒。预检或测试失败会在镜像打包前停止。请在开发环境
恢复数据库或隧道，需要迁移时单独执行。

热修复仍可用 `.\release.bat -Fast` 跳过本地 lint 和测试，Docker 仍执行生产构建。
各模式默认生成当天递增的 `YYYYMMDD-NNN` 版本，也可用 `-Version 20260901-001` 指定。

产物为：

```text
admin/release/sfp-admin-release-20260901-001.zip
admin/release/sfp-admin-release-20260901-001.zip.sha256
admin/release/auto_deploy.sh
```

ZIP 内含带相同 tag 与 OCI version label 的 Docker 镜像、Compose、迁移、构建信息以及两级 SHA-256 清单。
`BUILD_INFO` 记录 `release_mode`（`standard`、`full`、`fast`）和 `postgresql_contract_tests`（`passed` 或 `not_run`）。ZIP 不含生产环境文件。

## 一键发布

上传上述三个文件到固定部署根目录后执行：

```bash
chmod +x auto_deploy.sh
./auto_deploy.sh deploy
```

也可精确指定文件：

```bash
./auto_deploy.sh deploy sfp-admin-release-20260901-001.zip
```

脚本会取得独占发布锁，并依次完成：

1. 校验 ZIP 的外部 SHA-256；
2. 在部署根目录内的随机临时目录解压，校验版本、镜像、Compose、全部迁移和包内 SHA-256；
3. 把已校验版本移动到 `releases/<version>`，不覆盖其他版本；
4. 在接触 PostgreSQL 前校验 Cookie、危险清理开关、四项关键密钥和专用冒烟账号配置；
5. 启动并确认原 PostgreSQL 容器，保留现有 Compose project 和 volume；
6. 在 `backups/postgresql` 生成迁移前 custom dump，要求文件非空、`pg_restore --list` 可读，并生成独立 SHA-256；
7. 执行 PostgreSQL 角色准备和 Drizzle 迁移；
8. 用版本化镜像重建 Admin 与抢单 Worker。当前 Compose project 中正在运行的小 K Worker，或通过 `COMPOSE_PROFILES=assistant` 启用的小 K Worker，在 Admin 健康后同步换版。
9. 在有限超时内检查 `/api/health`、纳入本次发布的 Worker 健康、真实账号登录、`/api/auth/me` 和配置的只读核心路径。
10. 成功后原子写入 `deploy-state/current-*`、`previous-*` 和部署时间。

Compose 预检会显式启用 `migration` profile，确保仅在该 profile 下可见的
`migrate` 服务也进入服务完整性检查。
迁移容器直接使用已校验发布镜像内置的 Drizzle 文件，不再依赖发布目录的
宿主机 bind mount，避免版本目录提升后挂载路径失效。

阶段 Agent 的工作流定义随 `native_workflow_store` 卷持久保存，默认挂载到 Admin 的 `/app/tmp/native-workflow-store`。Worker 通过 Admin 的内部任务接口读取同一版本。自定义 `NATIVE_WORKFLOW_STORE_DIR` 时沿用其持久挂载。恢复工作流时同时使用对应的卷备份和 PostgreSQL 备份。小 K Worker 重建后以当前进程的预检和轮询上报健康，平台关闭时仍以正常空闲状态运行。

发布基线跟踪已上线的 `0141`–`0143` 原字节和顺序。阶段 Agent 与回答操作升级在这三条后执行 `0144`–`0147`。

任何备份、迁移、启动或检查失败都会返回非零状态。若新应用已经切换但检查失败，脚本会尝试恢复发布前的应用镜像；数据库迁移不会逆转。未通过的版本不会成为 `current`。

## 实时请求日志

正式域名使用系统安装的 Nginx。该站点的访问日志用于查看所有到达它的 HTTP 请求，
包括静态资源、API 响应和上游失败。先确认实际 `server` / `location` 的日志配置：

```bash
sudo nginx -T 2>&1 | grep -E 'server_name|access_log|error_log'
```

如果该域名使用以下常见路径，可直接跟踪；否则替换为配置中的实际路径。
`-F` 会在日志轮转后继续跟踪新文件。

```bash
sudo tail -n 100 -F /var/log/nginx/access.log /var/log/nginx/error.log
```

另开一个 SSH 窗口发送不写业务数据的探测请求，再重新扫码：

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' https://smartfloor.zlyun168.com/api/health
```

Nginx 在请求处理结束时记录访问。如果看不到探测请求，核对对应域名与 location 是否有
`access_log off`、独立日志路径、条件记录或 `buffer` / `flush` 缓冲。需要记录全部请求时，
为该站点启用无条件 `access_log`，并移除相关 location 中覆盖它的 `off`。
例如不带缓冲的 `access_log /var/log/nginx/smartfloor.access.log combined;` 会逐条写入
已完成请求；如果站点原有格式含需要的耗时字段，继续使用该格式。
修改配置后先运行 `sudo nginx -t`，通过后用 `sudo systemctl reload nginx` 平滑重载，
再跟踪配置的文件。本仓库不远程修改 Nginx 配置。

应用内部输出单独查看：

```bash
docker logs --tail 200 --timestamps -f smart-floor-planner-admin
```

部署已接入诊断的新 Admin 后，`[MiniProgramRequest]` JSON 日志覆盖
`POST /api/miniprogram/codes/resolve`、`POST /api/auth/miniprogram`、
`POST /api/miniprogram/onboarding/referrer`、`POST /api/miniprogram/onboarding/staff` 和
`GET /api/miniprogram/bootstrap`。每次请求立即记录 `start`，完成时记录 `complete`，
包含状态码、业务结果、阶段、耗时及同一 `requestId`（同时通过 `X-Request-Id` 返回）。
捕获异常增加 `exception`；未捕获异常增加 `failed` 并保留原抛出行为。
日志保留错误类型、源码位置、嵌套 PostgreSQL/网络错误码和微信数字错误码，不记录异常原文、
SQL/参数、请求/响应体、查询字符串、手机号和凭据。角标/派单异常后仍可能记录成功结果，
因为既有业务流程允许对应子步骤降级。

查看日志本身不需要 DEBUG 开关或重启。新增应用日志需要部署新镜像，重启旧镜像不会补上日志。
部署替换容器后应重新执行 `docker logs`。这只是五个接口的诊断日志，全部 HTTP 访问以 Nginx
日志为准。

如需在发布小程序前先修复线上活动码/推广码，可在 Admin 容器内执行脚本。默认只读检查，
不会写库；`--apply` 才提交事务，`--rotate-all` 才会强制轮换所有 active 码。脚本只输出
类型、主体 ID 和版本，不输出令牌：

```bash
docker exec smart-floor-planner-admin node scripts/refresh-service-codes.mjs --kind all
docker exec smart-floor-planner-admin node scripts/refresh-service-codes.mjs --kind all --apply
```

脚本不要求随镜像发布。也可以只把单文件上传到服务器，再复制到现有容器执行；容器需要
能使用现有 `DATABASE_URL`、`REFERRER_TOKEN_SECRET`/`JWT_SECRET` 和 Node `pg` 依赖：

```bash
scp admin/scripts/refresh-service-codes.mjs user@server:/tmp/
docker cp /tmp/refresh-service-codes.mjs smart-floor-planner-admin:/tmp/refresh-service-codes.mjs
docker exec smart-floor-planner-admin node /tmp/refresh-service-codes.mjs --kind all
```

执行 `--apply` 的复制命令同样只替换最后一个参数。上传到 `/tmp` 的脚本不会把上传目录当作
`.env` 目录；容器运行时优先使用已注入的环境变量。若在仓库工作目录直接运行且已安装
`@next/env`，脚本也会读取该工作目录的 `.env` 文件。若在宿主机直接运行 Node，请使用 Node 20
的 `--env-file` 或显式导出环境变量，并确保宿主机已安装兼容版本的 `pg`。

可选参数为 `--kind staff|promotion|all` 和 `--enterprise-id ID`。不加 `--rotate-all` 时，
只轮换当前 `REFERRER_TOKEN_SECRET`（未设置则使用 `JWT_SECRET`）无法重建的 active 记录；
加上后会让旧码立即失效并生成下一版本。脚本执行期间按员工/成员关系加行锁，提交失败会
整体回滚。数据库刷新只更新令牌记录，不会改写已经下载或分发的二维码图片。

扫码返回 `404` 时应看响应体：JSON `code_not_found` 表示不透明令牌未匹配到数据库记录，
不是 Next.js 路由缺失。向 `/api/miniprogram/codes/resolve` 发送空对象 `{}` 应在任何数据库
写入之前返回 `400 / invalid_token`，可用于验证路由存在。随后确认二维码来自同一数据库。
查看已有码时，服务端用 `REFERRER_TOKEN_SECRET`（未设置则用 `JWT_SECRET`）、范围与版本
重建令牌；若改过密钥但已有记录仍保存旧令牌哈希，重新下载的图片也可能校验失败。
换码或改密钥前先确认该条件；换码会使已分发的旧码失效。仅凭 Nginx 的状态码不能确定是哪种原因。

## 状态与回滚

查看当前容器、版本和最近备份：

```bash
./auto_deploy.sh status
```

回滚到记录的上一应用版本：

```bash
./auto_deploy.sh rollback
```

回滚到指定保留版本：

```bash
./auto_deploy.sh rollback 20260901-001
```

回滚只切换 Admin/worker 镜像并重新执行健康、登录和核心路径检查；不会执行迁移，也不会恢复数据库。每个正式迁移必须至少向后兼容紧邻的上一应用版本。若某迁移无法满足这一要求，发布前必须设计独立的 expand/migrate/contract 多阶段方案，而不能依赖一键回滚。

## 备份与恢复边界

每次正式发布都会产生一份发布前备份，但它不能替代定时和异地备份。正式运营仍应配置每日全量备份、异地加密副本、保留周期、失败告警和每月恢复演练。

恢复生产数据库属于独立高风险操作：先停写、确认目标数据库和备份 SHA-256，在独立数据库完成恢复验证并取得审批后再执行。发布或应用回滚脚本永远不会自动覆盖生产数据库。

English mirror: [production-deployment.md](./production-deployment.md)
