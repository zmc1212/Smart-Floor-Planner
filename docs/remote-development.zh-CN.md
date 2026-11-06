# 远端开发连接记录

<!-- xiaok-fastgpt-capabilities -->
**阶段/知识开发工作流：Limited。** 原隔离FastGPT v4.17.4实例已有两个私有advanced应用，经原授权API创建，未重置root密码。保护配置tmp/fastgpt-capabilities-20261106/runtime.private.json；仅本任务开发Worker设置XIAOK_FASTGPT_WORKFLOWS_FILE。知识调原模型回调，阶段用已配置原生模型；回环18310须短期票据/原守卫，复用18300转发，临时反向18310在清理时关闭。仅55432/微云1454合成测试，恢复设置/账号/队列并绑定前后实际发布流程。两份真实阶段正文保存投递及原生保存正文检查通过，知识完整旅程仍失败，见[当前合同](xiaok-assistant-phase-2.zh-CN.md#fastgpt阶段提醒与知识问答工作流limited)。未迁业务容器/数据库，未切默认路径/生产，未增真实客户或外部消息权限。
<!-- /xiaok-fastgpt-capabilities -->

<!-- xiaok-fastgpt-report-pilot -->
## FastGPT报告工作流开发实例（Limited）

2026-11-06用户授权的专用实例位于`D:/Smart-Floor-Planner-Dev/fastgpt-pilot`；Compose项目`sfp-fastgpt-pilot`，九服务、独立卷/网络；应用仅远端回环18300，本机同端口SSH转发。官方v4.17.4/source09192051及逐blob/manifest校验记录见`verified-images.json`。Docker Hub超时/Desktop拉取停滞保留，PullDirect仅从官方阿里云镜像仓库分段下载并校验导入，不改全局代理或其他容器。Mongo副本集、必需plugin及平台接口已就绪；默认root安装凭据已按官方reset-root算法随机化，后经用户在页面激活新密码；安装凭据不再代表当前登录密码，脚本保留已激活密码。

部署源`admin/deployment/fastgpt/`；`admin/scripts/fastgpt/remote.ps1`提供Prepare/Pull/PullDirect/Up/Status/Tunnel，Up仅初始化默认安装凭据，保留已激活密码。管理配置可由`FASTGPT_PILOT_ROOT_PASSWORD`环境变量显式提供当前密码；用户提供的新密码尚未通过脚本登录，报告API不受影响。验收改读实际已发布版本的只读SSH指纹及模型API目录，不依赖浏览器会话。凭据仅远端ACL保护的`.env.fastgpt`及本机`tmp/fastgpt-report-pilot-20261106/fastgpt.private.json`，不入Git/不输出值。已有百炼`qwen3.7-flash`兼容接口接通；自托管不扣FastGPT云积分，模型供应商仍计费、金额未返回不记零。原生AI节点提供token观察；试点preload阻断SDK自动网络重放，AIProxy重试0。每次服务验证暂开反向SSH18310，finally关闭；只处理隔离55432/微云1454合成数据。实际批、原生验证及边界见[二期合同](xiaok-assistant-phase-2.zh-CN.md#fastgpt四端日报周报开发试点limited)。无生产切换或真实客户/外部投递。
<!-- /xiaok-fastgpt-report-pilot -->

**2026-11-03用户授权本地Docker清零：限定Implemented。** 剩余8个本地在用Docker依赖已迁至批准的`192.168.10.54`：WVP、ZLM、MySQL、Redis、接入服务、只读容量探针，以及独立公开直播PostgreSQL／媒体服务。既有远端5个容器的ID、启动时间、状态和完整挂载字段保持；仅对挂载列表排序后比较，未删字段。未重启既有远端Docker／服务，未迁主库／评估库schema，无生产发布。

- 本机Docker Desktop和`docker-desktop` WSL均已停止，Docker进程**0**，辅助服务Stopped／Manual，Desktop `AutoStart=false`，无Desktop登录自启项；默认CLI context为`sfp-remote-dev`。原本地容器、数据卷、F录像和旧VHD保留用于回退；未启动或删除其他历史停用项目。隧道断开时不得自动启动本机Docker兜底。
- 远端实际目录为受ACL保护的`D:/Smart-Floor-Planner-Dev/migrated-services-20261103/`；`deployment.private.json`含真实环境／凭据，禁止入Git。Compose运维须通过SSH在远端真实目录执行。8个原卷完成冷复制，WVP容器内部历史抓图新增第9个持久卷，另复制ZLM内部抓图缓存。录像`/opt/media/www/record`和只读探针共同挂载远端物理D盘的`record/`；独立主机保留原容器／卷名及应用内路径。
- 13份基础镜像／冷备份／SQL（12,341,617,952字节）和额外ZLM缓存归档完成传输及hash校验；原F盘53个录像文件（6,431,924,380字节）恢复时逐文件SHA-256一致，8个原卷完成tar内容／元数据比较。7个镜像跨本机containerd manifest ID与远端classic config digest，文件层与配置内容一致；映射和原ID断言失败保留。已封存、完成checkpoint且无WAL尾文件的SQLite，以immutable只读方式完整性核验ok，原普通只读打开失败保留。此为本次依赖恢复，不升级主库／评估库完整恢复演练状态。
- 新增独立`admin/scripts/remote-dev/docker-services-tunnel.ps1`，保持本机／远端回环端口**8080、18080、18081、18082、11935、18554、18084、55434**，应用origin不变。`install-docker-services-tunnel.ps1 -Start`安装／启动当前用户隐藏`SFP-Remote-Docker-Services.lnk`监管，沿用严格主机检查和原SSH身份。核完整身份后仅中断该SSH子进程，8,180ms内8端口自动恢复；数据库／Embedding隧道独立保持。远端仍依赖既有Windows交互登录Docker任务，未新增登录前／重启验收。
- 仅将批准实体摄像头的持久`GB28181CFG.SIP_IP`从`192.168.10.32`改至`192.168.10.54`，其他持久GB字段、设备／通道ID、凭据和启用状态逐项回读保持。`OnlineStatus`为动态连接状态，不作为持久配置相等判断。新增2条入站SIP／RTP规则，仅允许摄像头`192.168.10.100`访问TCP／UDP15060及30000–30099；HTTP管理／媒体控制仍只绑定远端回环。无格式化、重启、固件、录制模式或设备计划操作。
- 验证：远端8个运行／健康，原5个保持；恢复的公开直播库150张RLS／150张force-RLS关系；鉴权容量与原生D盘总量1,403,827,589,120字节一致，匿名指标401；ZLM唯一测试文件确实写入远端D，原生hash一致后仅移除该自有文件。原H5入口200，真实私有MP4 Range206且有MP4头、匿名401，直播SIP／RTP200并接收70,358字节FLV。首轮发现原用户停止清理已释放3017／3018，容量unavailable失败保留；本次临时恢复网关／Next用于验证，随后按PID／创建时间／解释器／子树守卫释放，原3006 PID540892保持。未新增小程序原生／视觉／长期验收。本机内存仍偏紧，其他Node／ChatGPT／IDE进程保持，未声称整机可用内存已增加，也未擅停其他任务。

原74小时批次`2026-11-03T09-03-04-699Z`仍按用户要求保持停止，4次观测及interrupted／failed原回执不变。最终独立确认SD/off/stopped版本46、MP4=false，SD／观看／云台／写入义务0且无长测控制器；未恢复长测或自动化。未来仅在用户明确授权录制后，创建绑定远端新环境的新批次，并设置`CAMERA_RECORDING_HOST_PATH=D:/Smart-Floor-Planner-Dev/migrated-services-20261103/record`；不得复用F／本机原生statfs／旧物理挂载证据、修改固定05快照，或对本部署执行仅适用于本地Docker的容量部署脚本。

回退须主动、串行：先确认所属停写及义务清空，重新备份远端数据库／媒体并核字节和索引后，再同步切换后的新增写入。仅在明确回退时恢复原本地依赖，原服务就绪后只恢复摄像头原SIP目标，只停止本次新增依赖隧道。不得用旧本地快照覆盖既有远端主库／向量库。凭据、租户、留存、源撤回和生产边界保持。证据及精确归属：`tmp/docker-remote-migration-20261103-01/completion.json`、备份／恢复清单、provider追踪及进程回执；原准备／清理／验证失败全部保留。无产品UI／API／schema／角色变更，模型调用0，无新原生验收。

**CV-04只读驱动前置已验：** 固定执行prepare及长测改用显式Docker context/精确宿主目录；容量工具的`--context sfp-remote-dev --check --output <tmp下全新JSON>`只读验证远端Windows原生D、同源RW/RO挂载、15秒探针及匿名401，未知/错源拒绝且不回退本地Docker。新固定06的85333文件/7外部资源绑定前后稳定，JS18/18、清理守卫4/4、62入口类型0及6文件lint0；只读前后SD/off/stopped46、MP4=false/义务0，网关停止导致DB健康行unavailable不算Worker通过。首个缺失SSH转发失败保留，恢复原8端口监管443384/350404后物理前检02通过，监管继续常驻。无3017/3018/录制/自动化启动，无UI/API/schema/角色/素材变化，Mini/Stable只复用未变入口；整体Limited，实际短录/父丢失及新24/72小时/自然到期等待明确恢复录制。证据tmp/cloud-camera-remote-preflight-20261103-01/validation-06.json，调度仅看视频计划第1节。

机制参考：[Docker镜像存储](https://docs.docker.com/desktop/features/containerd/)、[SQLite只读WAL](https://www.sqlite.org/wal.html#read_only_databases)。下列历史记录保留原日期与范围；当前Docker位置以本条为准。

**2026-11-03抓拍保留隔离迁移：限定Implemented。** 仅cloud_camera_eval在既有55432→批准远端15433/sfp-remote-dev-vector上114→115应用0116，独立0114运行库仍未应用，未迁主库/生产。1,760,060字节PGDMP/TOC备份SHA256`0855d964a16fd5f4d57fcba1b6aef54db35f5580a2b2d2ae694a4b61b03b90c7`，受限ACL/抓拍强制RLS/精确hash/原策略及图片字节保留通过。完整恢复演练未验；证据tmp/cloud-camera-snapshot-20261103/migration.json，SSH/凭据/端点/卷与部署边界保持。

**2026-11-03业主视频隔离迁移：限定Implemented。** 仅cloud_camera_eval（既有55432→批准远端15433/sfp-remote-dev-vector）113→114应用0115；独立0114前后均不存在，未迁主库/生产。1,671,521字节custom备份SHA256`4d8f020fc1a2545ff25a54388bfeec5bfb51411ad973aab8fa9170e00903325c`，受限ACL/PGDMP/TOC通过；新授权表强制RLS/精确hash、全部原策略及抓拍字节保留。首次同步Docker EOF在DDL前，原回执保留，异步备份后完成；完整恢复演练未验。证据tmp/cloud-camera-customer-20261103/migration*.json。SSH/端点/凭据/卷与生产边界保持。

**2026-11-03云视频隔离迁移：限定Implemented。** 同既有55432→远端15433、sfp-remote-dev/sfp-remote-dev-vector内cloud_camera_eval由112升级113（0113企业默认留存），未迁开发主库/生产或其他任务0114。受限ACL custom备份1,667,303字节，PGDMP/目录校验通过，SHA256 `2631555a2a8c8e915f4d782d0acb28817a392b457c6de36cfef82fd90e2ab24b`；新默认表强制RLS、0113精确hash及旧策略全部原字段不变通过，旧策略显式回填。证据tmp/cloud-camera-defaults-20261103/migration.json及其before-0113备份；旧95→112/SD迁移回执仍在tmp/cloud-camera-dual-20261103/。新专用unit库按各批记录journal执行，成功后只清理自有新库，失败原库保留。SSH/端点/凭据/真实客户/卷保留；无主库/生产/设备配置权限扩展；完整恢复演练未做。

<!-- xiaok-embedding-forward-recovery-20261102 -->
**原Embedding开发转发恢复（2026-11-02，限定Implemented）：** V1-02 report272/body1919仅在查询Embedding阶段unknown，文本provider调用0；鉴权GET /health证实本机127.0.0.1:18089 ECONNREFUSED且无专用监管/监听。按本记录原授权，以既有密钥属主和原admin/scripts/xiaok-embedding/tunnel.ps1恢复隐藏专用监管84052/SSH子进程518972，保持BatchMode/StrictHostKeyChecking、回环18089→原远端8089和原凭据，未改远端进程/ComfyUI/DB隧道/配置/生产。随后鉴权health200、Qwen原revision/profile/1024维一致、queued0；专用服务保持可用，不在测试清理时终止。原1919及3753未知用量保留，未重放；后续新报告查询有37 tokens观测，摄取0。证据tmp/v1-02-live-reports/embedding-health-01.json、embedding-supervisor.json、embedding-health-02.json和diagnosis-02.json。此恢复不代表正文/四端业务验收通过。


<!-- portfolio-development-recovery-20261030 -->
**开发环境设计师推荐恢复（2026-10-30）：本次报错范围Implemented。** 原企业1454／客户咨询802的推荐请求因开发主库缺少`app.portfolio_portraits`返回`503 assistant_unavailable`。先完成受ACL保护的59,164,410字节custom备份并核验`PGDMP`签名及archive目录，再仅向已批准的本机5432／远端15432开发主库补齐原有、源码未改的`0095_portfolio_enrichment`（SHA256 `a1183439b97cee7f697f49359ba32b15f053e437449185b9d1ead24ed2c42928`）。主库该迁移精确hash、六个作品集迁移、九张强制RLS表及头像同意列均已核验。原认证推荐请求现为200，当前地区实际可推荐公开作品0项；Stable新编译390×844，通过真实历史入口重进原咨询802，原错误消失（原生3/3，一张核route／咨询ID的348×752截图审看，源码／配置drift[]）。未修改客户资料、作品、模型答复、UI、API或权限策略；模型调用0，未生产发布。只读请求观察器及原最小化副屏窗口已恢复。

Mini40/40与隔离作品集服务回归56/56分别保留为工程证据。评测库已有头像表，但迁移账本缺少0095精确hash，因此双库迁移检查仍在评测目标失败；它与本次开发接口恢复独立，未重写该账本，原失败保留。备份／诊断／迁移／账本／原生证据：`tmp/xiaok-portfolio-error-20261030/`；完整备份恢复演练、真机／真实微信登录、配置模型语义及生产仍未验。

**开发助手消费恢复（2026-10-28）：** 真机所报“新房”run1576于01:42:46Z入队、从未启动，现场有2条等待任务；本机助手消费者未运行，默认心跳已过期。将原 `scripts/assistant-worker.mjs` 恢复为隐藏专用 Node 进程（初始 PID558932），沿用本机3006内部端点及 `.env.local` secret。旧排队任务被既有总时限守卫判失败、无供应商 I/O；随后通过获权幂等重试恢复原咨询789，run1578/attempt4050已实际调用 Qwen 成功。三个开发命令现由 `scripts/dev.mjs` 联动并监管 Next.js 与该消费者；`worker:assistant` 保留为独立/容器入口。企业 Qwen 绑定与平台 GLM 模型独立，仅复用匹配供应商的既有凭据。未改凭据、数据库端点/转发、SSH、远端容器、Embedding 服务、模型选择或生产部署。证据及限制见 `tmp/xiaok-chat-queue-20261028/` 与[排障合同](./xiaok-assistant-phase-2.zh-CN.md#当前聊天队列停滞恢复)；未将当前手机重进记为已验证。

**Embedding转发恢复（2026-10-30）：** 真实客户run1588因本机127.0.0.1:18089无监听报retrieval_unavailable，企业1454 profile1有效。复用admin/scripts/xiaok-embedding/tunnel.ps1及获批密钥属主（监管602288、初始SSH监听113068），保持BatchMode/StrictHostKeyChecking和原远端127.0.0.1:8089。鉴权health200，既有Qwen/Qwen3-Embedding-0.6B revision/profile/1024维一致；原咨询802检索5条获权资料，观测26 query tokens。原用户登录启动快捷方式已指向本监管脚本，保持不变；未改远端进程、ComfyUI、凭据、数据库隧道、端点或生产部署。原1588/1584失败及2026-10-28旧隧道证据保留；当前证据tmp/xiaok-chat-queue-20261030/retrieval-diagnosis.json、embedding-supervisor.json、user-802-retrieval-probe.json、real-knowledge-recovery.json；仅证明本次开发依赖/恢复范围，不升级完整D2。

当前开发文字模型（2026-10-22）：用户明确指定免费GLM9继续剩余长聊、更正回读和压缩，不重复已通过范围。复用实时认证免费目录、GLM91437/1438及隔离8666/8668证据，经原平台服务保存并回读siliconflow / THUDM/GLM-4-9B-0414。凭据、独立VLM配置、enterprise1454历史配置/探针/授权/配额、空ASSISTANT_TEXT_MODEL与原关闭思考标记保持。正常投影upsert会刷新updated_at；驱动在保留检查通过后因严格时间戳断言失败，confirm.json另行只读确认已保存状态，没有再次调用模型或写配置。仅对明确标记的CONSULT-02合成咨询对齐所选文字模型，不宣称图片能力或所有企业配置已迁移。复用既有Next3006/HTTP Worker及5432/55432/18089隧道。历史Qwen/GLM业务失败与1430/3862未知结果及账务保持；连接可用不等于业务验收。当前证据tmp/xiaok-consult-02-glm9/configure.json、confirm.json和align.json，旧模型切换证据保持原绑定。无付费/pro备用、SSH/端点/凭据变更、生产部署或发布批准。

KB-4有界批量开发扩展：`0089_assistant_knowledge_batches`已应用开发主库`smart_floor_planner`及55432隔离`xiaok_embedding_eval`，SQL SHA256 `5448116bb90626a4322e5ff961d526ad064b0f6c13ce724f8a7fd21ac237c9d8`、两张批次/关联表的强制RLS及应用角色non-BYPASS已核验。仅以本人私有批次分组既有evaluation/run，原Worker/租约/用量/取消与管理角色边界沿用；非第二套模型任务队列。迁移前2026-10-19T06-06-59-739Z的主库16,427,580字节、隔离8,318,824字节custom备份在`tmp/xiaok-kb4-batches/`，PGDMP/归档目录及受限ACL通过；首次归档目录流提前结束的SSH EOF在DDL之前，失败保留为`migration-attempt-1.json`，已改为完整接收后核对。完整0089恢复演练及生产镜像兼容仍未验证。SSH、端口/隧道、身份文件、供应商及生产部署均未改变；实施/实测以二期KB-4合同和`migration.json`为准。

KB-2 XLSX开发扩展：0088_assistant_spreadsheet_sources已应用开发主库`smart_floor_planner`与55432隔离`xiaok_embedding_eval`，SQL哈希`b0d9aed4b60e62686eabfb9ee8a3fca009d3ff718363799a3c69e63f09f2d4c2`、两条格式CHECK、原强制RLS及应用角色non-BYPASS核验通过。只扩原件/版本格式，不增加表、端点、角色或发布通道。迁移前custom备份位于`tmp/xiaok-kb2-xlsx/`：`development-before-0088-2026-10-19T04-53-13.866Z.dump`为15,205,315字节，`evaluation-before-0088-2026-10-19T04-53-10.680Z.dump`为8,188,026字节，两者PGDMP/归档目录已校验；0088完整恢复演练仍未验证。复用原SSH/两个数据库隧道、Embedding、开发服务与Worker，未改凭据、供应商或生产。范围与实测见二期KB-2合同及`tmp/xiaok-kb2-xlsx/migration.json`。

P4B开发迁移：0084_construction_public_sites已应用smart_floor_planner及55432隔离xiaok_embedding_eval，两库SQL哈希及施工20表强制RLS通过。迁移前备份`tmp/xiaok-vector/phase2-pre-migration-2026-10-17T13-28-19-728Z.dump`为6,998,135字节，PGDMP/归档目录验证通过；0084完整恢复演练待执行。公开副本/业主精确同意/企业审核/撤回与真实模型隔离回归见3.7，原企业/项目资料未自动转为公开。开发服务/Worker、SSH/隧道/端点/凭证/生产边界不变。

P4A开发迁移：0083_construction_shared_chat已应用smart_floor_planner及55432隔离xiaok_embedding_eval，两库SQL哈希、独立共享会话用途/5参数实时权限适配及15张施工表强制RLS核验通过。迁移前备份`tmp/xiaok-vector/phase2-pre-migration-2026-10-17T11-16-22-729Z.dump`为6,955,847字节，PGDMP签名与归档目录校验通过；0083完整恢复演练待执行。项目共享对话、原材料/版本、明确业主发布、关注/取消和站内outbox见总计划3.5；原生/人工仍待测。复用现有本地开发服务与Worker，未改SSH、隧道、端点、凭据、供应商或生产部署。

地图服务配置：0076/0078/0079_optional_map_authorization已应用开发主库/隔离库，哈希、配置/供应商列、多供应商身份约束及8张强制RLS表核验通过。0079仅取消地图绑定必须有到期日的约束，保留备注/日期，缺失或到期不拦截搜索/绑定/公开匹配。0079前备份`tmp/map-services-before-2026-10-17T08-30-07-041Z.dump`为6,471,097字节，通过PGDMP/归档检查，新0079恢复演练待执行。另同步共享代码已有0080_construction_staff至两开发库，使当前admin_users字段与鉴权/清理回归一致；0080前备份`tmp/map-services-before-2026-10-17T08-34-43-072Z.dump`为6,470,898字节，归档核验通过。高德仍为默认，原加密Key/选填备注保留，现已显式开启；宜昌真实连接返回10条候选、不存POI，鉴权保存/回读200、匿名401及Key无明文回传通过。相关地图/作品50/50回归及全量ESLint通过，人工视觉、天地图真实召回及新恢复演练待测。未改变生产、端点、SSH、隧道或采购。

P3A当前开发范围：0080_construction_staff、0081_construction_identity_scope、0082_construction_staff_role已应用smart_floor_planner及55432隔离库xiaok_embedding_eval。npm run check:construction核对施工迁移SQL哈希、9张强制RLS表、员工/成员列、施工角色约束及唯一4参数实时会话函数通过；已应用0080保留原哈希，修复用0081/0082追加迁移。备份tmp/xiaok-vector/phase2-pre-migration-2026-10-17T08-41-01-322Z.dump为6,475,951字节，通过PGDMP/归档核验；0082完整恢复演练待测。设计师/施工员工/老板共用云工地及员工资料实时拨号见总计划3.3。已按既有tunnel.ps1恢复5432/55432转发，复用3006开发服务（健康200）并恢复隐藏assistant Worker（healthcheck退出0）；SSH、转发配置、端点、凭据及生产未改，无供应商采购。

P2C.1开发更新：0071_designer_portfolio和0072_portfolio_provider_guard已应用开发主库/隔离库，npm run check:portfolio核对SQL哈希、8张作品表强制RLS及保护列通过。迁移前主库备份tmp/xiaok-vector/phase2-pre-migration-2026-10-16T16-36-04-388Z.dump为6,389,460字节，PGDMP/归档目录校验通过；新0072恢复演练待执行。管理员/设计师角色默认增加独立case-publishing菜单，不增加assistant-knowledge权限。未核实商业/绑定权益前高德业务检索保持关闭；已保存Key的连接诊断现走/map-settings，无供应商采购。SSH、隧道、端点、凭据和生产边界保持；实施及待接客户链路见二期契约。

P2A.3/P2C开发更新：0070_assistant_reference_cases已应用开发主库及隔离评测库，SQL哈希/reference_case列/强制RLS校验通过。迁移前主库备份tmp/xiaok-vector/phase2-pre-migration-2026-10-16T14-46-57-548Z.dump（6,387,541字节）通过PGDMP/目录校验；0070恢复演练待执行。运行提示词v10，配置保留原v9启用证据标记；未改生产、供应商、端点或SSH边界，未导入无授权客户案例。详见二期契约。

**P2A.3之前的P2M v9基线：Limited。** 开发环境localhost:3006／远端开发数据库的企业1454使用DeepSeek官方deepseek-flash，langgraph-v1、图片/工具启用，xiaok-renovation-v9、policy_version=3。回读一致、在途0、Worker健康200/fresh。证据：结构160/160、合成图片语义16/16、扩展会话44/44段（114/114轮）、隔离Worker19/19、纯测试63/63通过。未明确房间的指代先澄清再写记忆；通用预算/图片证据边界问答避免无谓转入企业知识检索。素材为2位作者的5张公开CC0照片及3种确定性降质变体，具有代表性的装修质量及原生人工验收仍待验证。现有路由/API/角色、C01/C02/S01/U01界面及正式量房写入保持，无生产发布。本段优先于下文历史仅规则/不能识图描述；未选择新Agent的企业仍走旧执行器。方法、证据及限制见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。

开发切换仅改变平台LLM/助手覆盖及企业1454的agent_config。SSH、隧道、数据库端点、凭据与图片生成供应商保持。admin/scripts/assistant-p2m-dev.ts --disable恢复旧执行器；不含凭据的模型回滚记录为tmp/xiaok-vector/p2m-model-before-deepseek.json。

小K主动引导更新：0065_assistant_guidance已应用开发主库与隔离评估库；SQL哈希、guidance_config字段及现有强制RLS验证通过，迁移表ID72。迁移前备份 `tmp/xiaok-vector/phase2-pre-migration-2026-10-15T15-35-08-179Z.dump` 已验证。原0064恢复演练证据仍为历史结果，不冒充0065新演练。未改变SSH、端口或生产。 小K P2A开发更新：开发主库smart_floor_planner及隔离评估库xiaok_embedding_eval均已应用0064_assistant_requirements，并按SQL文件SHA-256与新增表强制RLS逐项复核。主库迁移前custom备份为 `tmp/xiaok-vector/phase2-pre-migration-2026-10-15T14-54-11-848Z.dump`，已验证可读取。恢复演练现按0058–0064实际SQL哈希检查，不再把迁移表自增ID当作文件编号；23张相关表恢复校验及克隆清理通过。未改变SSH、端口、服务配置或生产环境。

这是远端开发电脑的项目内长期记录。进行任何远端核验、Docker 环境配置、
Embedding 维护或进程操作前，先阅读本文件及英文镜像。端点、身份文件路径、
服务边界或部署状态变化时，必须同步更新中英文两份记录。

## SSH 连接

- 目标：`Administrator@192.168.10.54`，端口 `22`；主机标识：
  `User-2026PKPRRP`。
- 远端系统：Windows 11。已安装 Docker Desktop `4.34.3`。
- SSH 身份文件路径（只记录路径，禁止读取、复制或提交私钥）：
  `C:/Users/Administrator/.ssh/toonflow_remote_ed25519`。
- 已验证选项：`BatchMode=yes`、`StrictHostKeyChecking=yes`、
  `ConnectTimeout=8`。
- 最近验证：2026-10-15。历史上下文：
  `codex://threads/01a13d52-6fdd-7421-b3aa-9eb54f8170e1`。

确认本机 SSH known-hosts 已存在该主机密钥后，可直接复制以下 PowerShell
命令：

```powershell
$RemoteTarget = 'Administrator@192.168.10.54'
$RemoteIdentity = 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519'
$SshOptions = @(
  '-i', $RemoteIdentity,
  '-p', '22',
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', 'ConnectTimeout=8'
)

ssh @SshOptions $RemoteTarget 'hostname'
ssh @SshOptions $RemoteTarget 'docker version'
ssh @SshOptions $RemoteTarget 'docker info'
```

现有本地 Embedding 隧道需要临时前台运行时使用以下安全命令。先确认
`127.0.0.1:18089` 空闲；如果维护隧道已经运行，不要重复启动以免占用同一端口：

```powershell
ssh @SshOptions -N `
  -o 'ExitOnForwardFailure=yes' `
  -o 'ServerAliveInterval=15' `
  -o 'ServerAliveCountMax=3' `
  -L '127.0.0.1:18089:127.0.0.1:8089' `
  $RemoteTarget
```

远端验收 PostgreSQL 端口同样只绑定回环地址。本地
`127.0.0.1:15432` 空闲时，使用以下独立前台隧道：

```powershell
ssh @SshOptions -N `
  -o 'ExitOnForwardFailure=yes' `
  -o 'ServerAliveInterval=15' `
  -o 'ServerAliveCountMax=3' `
  -L '127.0.0.1:15432:127.0.0.1:15432' `
  $RemoteTarget
```

## 当前状态与部署边界

- 开发迁移状态：截至2026-10-15，隔离远端开发环境为 `Implemented`。这表示数据库恢复、
  对比核验和本机连接交接已完成；不表示小K产品发布、真实企业切换或生产就绪。
- 独立远端 Embedding 服务位于 `D:/XiaoK-Embedding/`，仅监听远端
  `127.0.0.1:8089`；本地应用通过 `127.0.0.1:18089` 访问。仓库维护入口为
  `admin/scripts/xiaok-embedding/tunnel.ps1`，本次未修改该隧道；迁移后带认证的健康检查返回200。
  本次未操作 ComfyUI 环境或进程。
- 远端 Windows 11 的 Docker Desktop 报告 server `27.2.0`、Linux 容器和 WSL2 后端。
  Windows `com.docker.service` 为 `Stopped` 不代表 WSL2 不可用；以 `docker info` 为准。
  专用任务 `SFP-Docker-Desktop` 以 `Administrator`、`Interactive` 登录方式和
  `Highest` 运行级别启动，现已增加 `Administrator` 登录触发器；可用
  `Start-ScheduledTask -TaskName SFP-Docker-Desktop` 重用。该账户登录后会启动 Docker。
  尚未实机重启验收，因此不保证 Windows 登录前可用。
- 远端开发目录为 `D:/Smart-Floor-Planner-Dev/`，当前有两个隔离容器，均使用固定镜像
  `pgvector/pgvector:0.8.2-pg17@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966`：
  `sfp-remote-dev-postgres` 仅暴露 `127.0.0.1:15432`，使用数据卷
  `sfp_remote_dev_postgres_data`；`sfp-remote-dev-vector` 仅暴露 `127.0.0.1:15433`，使用数据卷
  `sfp_remote_dev_vector_data`。
- compose 源文件为 `admin/docker-compose.remote-dev.yml`，已按同名文件复制到远端目录；当前仓库源
  SHA256 为 `375AA7B1A7FEDE04FE97DFE4585D1D25227E5D28C4A908B51B517181EC491B37`。
- 主库`smart_floor_planner`在微云开发联调中由0059升级至0062，平台管理员知识访问修复进一步将主库及评估库升级至0063；恢复库仍0059，均保留vector `0.8.2`。迁移前已验证新的custom备份`tmp/xiaok-vector/before-0063-20261015.dump`（6,361,933字节；容器副本`/tmp/xiaok-before-0063-20261015.dump`），SHA256 `19809E8A77A6213D93A4CA1CFD4FA2E5C755767C06B55C8CA04B96A03EF4042A`。18张助手表全部强制RLS。仅企业1454启用；enterprise_admin2853保留显式知识授权，平台admin/super_admin按选定企业管理知识及本人试问，其他小K授权不变。开发super_admin16实际页面/API与真实模型回答/引用/历史通过，客户645/项目1818既有联调见一期契约。生产部署不变。
- source dump 带 owner/grants，角色已恢复；主库 `sfp_owner` 保留新的随机 bootstrap 密码，
  app/migrator 密码不变；eval 保留原角色密码，原 `connection.private.json` 未改。密码及文件内容
  不写入本记录。
- 备份证据位于本机 `tmp/remote-dev-migration-20261015/` 和远端
  `D:/Smart-Floor-Planner-Dev/backup-20261015/`：3个 dump 加2个 `roles.private.sql` 文件；5个
  SHA256 传输校验一致。访问仅限用户、`SYSTEM` 和 `Administrators`。
- 逐表对比的 data 摘要、sequence、列语义顺序、constraints、indexes、functions、triggers、
  grants、DB settings 和 RLS 均匹配：主库 `93表/72张force-RLS表/125条策略/2882行`；eval
  `101/80/133/2952`；restore `94/73/126/2945`。
- 本机 `npm run db:check` 在本机 Docker 关闭/隧道重连前后均使用 `sfp_app` 成功。只读 RLS 探针显示两个租户各自只能看到自己的2行，
  未设置租户上下文时可见0行，跨租户可见0行，使用的是非 superuser、非 BYPASSRLS 角色。既有服务端 platform flag
  信任模型未变；本记录不宣称额外加固。
- 本机两个源容器已停止，卷 `admin_postgres_data`、`xiaok_vector_eval_data` 保留。
  `.env.production`、eval配置及应用`DATABASE_URL`保持不变。后续本地联调仅向`.env.local`
  增加独立随机`CRON_SECRET`，`worker:assistant`按Next开发模式读取；`npm run dev`默认
  Webpack，避开当前Windows的Turbopack pg目录链接错误。小程序开发连接用户配置的
  局域网地址`http://124.70.90.30:9966/api`，发布前须恢复production。
- `admin/scripts/remote-dev/install-tunnel.ps1 -Start` 已安装当前用户 Startup 快捷方式
  `SFP-Remote-Dev-Tunnel.lnk`。`tunnel.ps1` 常驻维护 `127.0.0.1:5432 -> 远端15432` 和
  `127.0.0.1:55432 -> 远端15433` 两条回环转发，断线重连，并用 Mutex 防止重复。最终交接时只主动
  终止了命令行已核实的专用数据库 SSH 进程，约7秒后新 PID 自动重连，两个本机端口仍由 SSH 监听；
  它与未改动的 Embedding 隧道独立。
- 本机 SSH config 已建立 `Host sfp-remote-dev`，Docker context `sfp-remote-dev` 指向
  `ssh://sfp-remote-dev`，默认 Docker context 现为 `sfp-remote-dev`，独立查询已通过。本机 Docker
  Desktop 已执行 `docker desktop stop`（普通等待后使用受支持的 `--force --timeout 30` 兜底），
  `LOCAL_DOCKER_PROCESSES=0`；`docker version` 报告远端 server `27.2.0`/Linux，`docker ps` 显示
  远端两个容器均为 healthy。本机 Docker 的 `AutoStart` 原值已为 `false`，保持不变。
- 原业务库仍是回滚快照，不得直接替换其卷、不得用本地 `G:` 路径运行全栈 Compose，也不得让应用
  长期使用 superuser `sfp_owner`。凭据、Bearer token 和私钥内容必须留在 Git 之外。

日常远端 compose 运维必须经 SSH 使用远端真实目录；remote context 的 bind mount 指向远端路径，
不能从本地 checkout 路径解析：

SSH 登录会话无法使用远端 Docker Desktop 的桌面凭据助手。专用
`docker-cli/config.json` 只为 Docker Hub 配置匿名公共镜像入口，维护命令通过 `--config`
显式使用它；未修改用户原有 Docker 登录配置。运行时密码保存在受 ACL 保护的
`.env.remote-dev`，不进入仓库。

```powershell
ssh @SshOptions $RemoteTarget 'docker --config D:/Smart-Floor-Planner-Dev/docker-cli compose --env-file D:/Smart-Floor-Planner-Dev/.env.remote-dev -f D:/Smart-Floor-Planner-Dev/docker-compose.remote-dev.yml up -d'
ssh @SshOptions $RemoteTarget 'docker --config D:/Smart-Floor-Planner-Dev/docker-cli compose --env-file D:/Smart-Floor-Planner-Dev/.env.remote-dev -f D:/Smart-Floor-Planner-Dev/docker-compose.remote-dev.yml ps'
docker context use sfp-remote-dev
docker --context sfp-remote-dev info
```

## 运维与回滚

摄像头CV-04执行/回滚合同见[视频计划§1.13](./cloud-construction-video-plan.zh-CN.md)。prepare显式--context sfp-remote-dev，使用新固定06及远端D目录，原生容量通过批准SSH主机读取；不得把旧F/固定05环境当新远端批。数据库仍仅原55432→远端15433/cloud_camera_eval，当前前置无schema迁移，0114仍缺，不重放混合journal；凭据/主库/向量库及独立转发保持。释放所属评估运行时前，仅关闭版本归属本批的录像并确认物理MP4=false、原SD/off/stopped及SD/观看/PTZ/写入义务0，再核完整进程身份。保留共享3006、远端WVP/ZLM/探针/D媒体及独立SSH监管；F/旧卷仅为回退数据，切回前须新鲜备份、完整hash/索引核对切换后的新增写入。存储不可达不新增为清理停录前置；未知写入不重放。当前用户停录及automation-4暂停保持；实际短录/父丢失/24/72小时/自然到期须明确恢复后验收。生产HTTPS/业务域名/监督/部署及完整恢复演练仍未授权/未验。

小K隔离恢复验收使用 `XIAOK_RESTORE_TARGET=remote-dev npm run test:assistant:restore`（PowerShell先设置同名环境变量，从admin运行）。脚本固定Docker context/SSH端点、评估容器及127.0.0.1:15433绑定，使用既有55432应用隧道获取互斥锁；不访问开发主库或原卷。最新实跑0058–0063恢复、22表摘要、权限/引用/用量检查及随机克隆库/dump清理均通过，证据 `tmp/xiaok-vector/assistant-restore-acceptance.json`。这不是生产回滚或无人登录连通性验收。

1. 用 `docker info` 核对远端引擎，再通过 SSH 在 `D:/Smart-Floor-Planner-Dev/` 维护 compose；
   不得使用本地 `G:` bind path 运行全栈 Compose。
2. 回滚先移除当前用户 Startup 中的 `SFP-Remote-Dev-Tunnel.lnk`，核实命令行后先停止运行
   `admin/scripts/remote-dev/tunnel.ps1` 的专用 PowerShell 父进程，再停止其 SSH 子进程；
   只杀 SSH 会触发自动重连。确认5432/55432端口已释放，不得触碰 Embedding 隧道。
3. 启动本机 Docker Desktop，执行 `docker context use desktop-linux`，使用保留卷启动原有容器；
   不删除远端卷。
4. 若远端已有写入，切回前必须先备份并迁回这些写入；本机旧源库只是切换时快照，不能直接无损回滚。

停止或重启任何进程前，先核实 PID、可执行文件路径、命令行、所有者以及任务/容器归属。
只操作已确认属于专用服务的进程；禁止按通用进程名匹配 Python、SSH、Docker 或 ComfyUI。

## 小K P2B / P2A.2 开发库迁移

P2M：0069_assistant_agent已应用于开发主库及隔离评估库，迁移哈希、agent_config/private_checkpoint字段与两表强制RLS核验通过（admin/scripts/assistant-p2m-migration-check.mjs）。主库迁移前备份 tmp/xiaok-vector/phase2-pre-migration-2026-10-16T11-59-26-864Z.dump，6,387,371 bytes，PGDMP及归档列表检查通过。0069完整恢复演练待执行；新Agent默认关闭，未向现有客户启用视觉，无生产变更。

P2A.2：同一授权边界内将 `0067_assistant_media.sql`、`0068_assistant_media_source.sql` 应用于开发主库和隔离评估库，两库迁移哈希、强制RLS及source_ref核验通过。0067前主库custom备份 `tmp/xiaok-vector/phase2-pre-migration-2026-10-16T06-46-19-997Z.dump`（6,336,913 bytes）通过PGDMP签名及归档列表检查。证据：`tmp/xiaok-vector/media-migrations.json`。恢复验收脚本已更新为0058–0068及媒体字段；尚未执行新的0068恢复演练。无生产部署。

2026-10-16：按本记录既有开发授权，将 `admin/drizzle/0066_assistant_handoff_guard.sql` 应用于开发主库及隔离评估库；两库迁移哈希和两个成员/消息触发器函数核验通过。主库迁移前 custom 备份 `tmp/xiaok-vector/phase2-pre-migration-2026-10-15T16-55-06-791Z.dump`，6,330,414 bytes，归档校验通过。保留强制RLS，无生产部署或连接权限扩展。流程见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。

## 相关项目记录

- [小K第一期实施契约](./xiaok-assistant-phase-1.zh-CN.md)
- [英文远端开发连接记录](./remote-development.md)
- `admin/scripts/xiaok-embedding/`
