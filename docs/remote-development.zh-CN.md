# 远端开发连接记录

<!-- xiaok-mineru-native -->

**远端MinerU：部署及本地解析Implemented，小K真实问答仍Limited。** 用户2026-11-07明确授权，专用目录`D:/Smart-Floor-Planner-Dev/mineru-pilot`已安装独立Python3.12.10/MinerU4.1.7，依赖锁、官方Python签名及hash留存。Windows原生ONNX/DirectML+llama.cpp已识别RTX4080；19模型文件约2.12GB来自官方OpenDataLab ModelScope库，独立状态/缓存、关闭遥测、本机推理，不改全局PATH/Python或默认Worker，不设公网服务端口。现有20容器身份/启动/状态/全部挂载字段前后一致（仅规范化挂载排序），未重启或迁移其他服务。

`admin/deployment/mineru/install-native.ps1`安装；`run-native.ps1`支持Version/Hardware/DownloadModels/VerifyModels/Parse，必须在专用根内读写且拒绝覆盖输出。前台SSH任务保留运行，避免SSH结束时丢失后台进程。例：`powershell -NoProfile -ExecutionPolicy Bypass -File D:/Smart-Floor-Planner-Dev/mineru-pilot/run-native.ps1 -Action Parse -InputFile input/jingyi.pdf -OutputFile output/jingyi-next.zip -Tier standard`。

原精艺.pdf完整30页standard解析117.86秒，重点6页41.68秒；输入/ZIP传输hash一致。4页图注/脚注16块已回填，20页书页37/38均123㎡；basic裁块识别123但漏m，仅留诊断。原表单元格保留，独立108块FastGPT索引及旧问答留历史审计。用户将一期限定为PPT工艺后，旧28份隔离候选已退役。10971书页正确但解释/引用失败，旧固定批余5问未派发，见[合同](xiaok-assistant-phase-2.zh-CN.md#minerufastgpt员工草稿预览limited)。下载超时、镜像回退和驱动失败保留，金额未知不记零。版本/依赖/模型指纹、完整原件和[完整性回执](../tmp/xiaok-mineru-fastgpt-preview-20261107/ocr-followup/ocr-integrity.json)在原ocr-followup目录。SSH身份及生产边界沿下文，原PDF/主库376–405/410–411不替换。

<!-- /xiaok-mineru-native -->


<!-- xiaok-fastgpt-capabilities -->
**阶段/知识开发工作流：Limited。** 原授权v4.17.4实例保留阶段/旧包裹应用，并新增Qwen及用户指定deepseek-v4.1-flash-1017两个私有原生问答对照应用；独立传输别名/渠道仅指向短期票据回环18310，实际模型仍走原获权供应商网关/逐次计量。保护配置tmp/fastgpt-native-qa-20261106/runtime.private.json及runtime-deepseek.private.json。当前管理登录已通过官方API验证，仅留ACL保护会话，不存密码；未重置root或切默认模型。五个原生问答批均停，完整旅程未通过；现已停止新增实模。设置、微云1454/55432合成夹具及原生注入恢复，源码/发布配置drift空，队列/待投递0。反向18310、reader及egress沿finally关闭，所属18300转发在收拢时释放。见[合同](xiaok-assistant-phase-2.zh-CN.md#fastgpt阶段提醒与知识问答工作流limited)。未迁业务容器/数据库，未扩生产、真实客户或外部消息授权。

主干私有应用6aedfd3e093915ea6cf27ab0/9节点及保护runtime-deepseek-mainline.private.json沿用；只读主5432配置取得原百炼连接，隔离55432默认设置测试后恢复。新增一个禁用的合成诊断供应商记录和3267–3268计量绑定准确凭据/模型，未改默认路由。403明确AllocationQuota.FreeTierOnly，仅替换请求ID即可复现旧3266响应哈希。已登录控制台仅关闭准确deepseek-v4.1-flash用尽即停（1成功/0失败），验证3268返回200；授权账户改动保留，未充值、轮换Key、切其他模型或改账户全局额度。fixed01原生批复用已核实外部18300转发、所属反向18310、本机库存OpenSERP/百度直连18098和受控reader/egress；10929通过后10930建议质量失败，后8问不派发。源码/发布绑定无漂移，配置/夹具/原生注入恢复，队列/待投递0；所属搜索/浏览器/reader/egress/反向资源清理，外部18300进程保持。新增4请求/账本1489→1493分开保留，质量停止后无新推理。未扩生产、迁业务容器/数据库或改默认Worker/企业知识/UI/API路由/schema。证据tmp/fastgpt-native-qa-20261107/bailian403-repair01/assessment.json。

MinerU语料测试夹具（2026-11-07，用户授权旅程）：实例新增aiproxy通道5（小K语料测试·百炼embedding，DashScope text-embedding-v4）、注册并激活系统模型text-embedding-v4（默认模型未变），数据集6aee0860093915ea6cf27f6c精艺手册MinerU测试语料（测试专用·样板房模板·勿接生产），其中collection 6aee0b41093915ea6cf28cc6存有精艺.pdf各页92个清洗块。固定题集检索测试12/12前3命中；答案级问答应用6aee11d9093915ea6cf2a183（community-CQ简化链路，qwen3.7-flash）10/10行为合格（8道知识题事实齐备、2道陷阱题正确拒绝/转公司联系方式，1处跨表合成总价行为留待产品层校验把关）。既有应用/数据集未动。证据与可复用脚本：tmp/mineru-online-test/。

当前一期PPT工艺接入：Limited，限定四首稿及原生保存/引用/重进/撤权闭环已通过。原独立应用6aeebd3e093915ea6cf2db61及dataset6aeebd1a093915ea6cf2da78/collection6aeebd1a093915ea6cf2da8f保留；新增接入应用6aeec3f9093915ea6cf2e489在原三节点RAG上增加原服务来源守卫。channel5仍调用百炼text-embedding-v4；channel6/别名sfp-ppt-rag-qwen37-flash仅经所属18310回环接入原PostgreSQL模型网关，实际模型qwen3.7-flash，沿原计量及unknown不重试。FastGPT不另存会话或生成标题。保护配置tmp/xiaok-fastgpt-rag-session-20261107/runtime.private.json仅显式开发启用；原应用/默认模型/业务数据库不切换。用户明确授权隔离55432/微云1454四份PPT文档2511–2514/版本2756–2759对客发布并保留，临时撤权后恢复；不授权主库或生产。原独立账本577–596保留；本次597–608为6次embedding/171输入及同一6次模型传输，实际attempt3325–3330为6504输入/593输出，费用未知。模型固定4首稿与CLI中断分开记录；repair1-saved09原保存消息/引用/重进/撤权/恢复及真实HTTP503通过，新增模型/embedding调用均0，源码/工作流绑定一致。原生注入、设置、供应商配置、所属SSH18300/反向18310及验收锁均已finally清理；publication-after确认四份资料保持active/customer_public。[证据](../tmp/xiaok-fastgpt-rag-session-20261107/)。
<!-- /xiaok-fastgpt-capabilities -->

<!-- xiaok-fastgpt-report-pilot -->
## FastGPT报告工作流开发实例（Limited）

2026-11-06用户授权的专用实例位于`D:/Smart-Floor-Planner-Dev/fastgpt-pilot`；Compose项目`sfp-fastgpt-pilot`，九服务、独立卷/网络；应用仅远端回环18300，本机同端口SSH转发。官方v4.17.4/source09192051及逐blob/manifest校验记录见`verified-images.json`。Docker Hub超时/Desktop拉取停滞保留，PullDirect仅从官方阿里云镜像仓库分段下载并校验导入，不改全局代理或其他容器。Mongo副本集、必需plugin及平台接口已就绪；默认root安装凭据已按官方reset-root算法随机化，后经用户在页面激活新密码；安装凭据不再代表当前登录密码，脚本保留已激活密码。

部署源`admin/deployment/fastgpt/`；`admin/scripts/fastgpt/remote.ps1`提供Prepare/Pull/PullDirect/Up/Status/Tunnel，Up仅初始化默认安装凭据，保留已激活密码。管理配置可由`FASTGPT_PILOT_ROOT_PASSWORD`环境变量显式提供当前密码；当前用户提供的凭据已通过官方登录API验证，仅留保护会话、不保存密码；报告API不受影响。验收改读实际已发布版本的只读SSH指纹及模型API目录，不依赖浏览器会话。凭据仅远端ACL保护的`.env.fastgpt`及本机`tmp/fastgpt-report-pilot-20261106/fastgpt.private.json`，不入Git/不输出值。已有百炼`qwen3.7-flash`兼容接口接通；自托管不扣FastGPT云积分，模型供应商仍计费、金额未返回不记零。原生AI节点提供token观察；试点preload阻断SDK自动网络重放，AIProxy重试0。每次服务验证暂开反向SSH18310，finally关闭；企业1454的Agent V2开发默认则在其启用期间保留一条常驻反向18310隧道（`ssh -N -R 127.0.0.1:18310:127.0.0.1:18310 Administrator@192.168.10.54`，PID14780），仅开发用途，有意停用Agent V2时须停止，不是生产回调路径；只处理隔离55432/微云1454合成数据。实际批、原生验证及边界见[二期合同](xiaok-assistant-phase-2.zh-CN.md#fastgpt四端日报周报开发试点limited)。无生产切换或真实客户/外部投递。
<!-- /xiaok-fastgpt-report-pilot -->


<!-- cloud-camera-cloud-mini-integration -->
**私有SD时间接入：限定Implemented。** 新增sfp-wvp-sd-clock-20261106组件，复用原镜像/只读WVP日志，白名单/token私有配置位于/datas/sfp-wvp-sd-clock-20261106/；仅127.0.0.1:28083、UID10001/cap_drop/全只读挂载/无Docker socket、unless-stopped。经原WVP观察新DeviceStatus时间，原28容器、二进制/站点/配置保持。配置0400并私有备份；应用用CAMERA_SD_CLOCK_ORIGIN/TOKEN显式选择，不回退服务器时间。Mini仅列当前注册身份/时间可信窗口，缓存开播再核身份/时差。真实Mini宿主/H5 SD查询/播放/重进/故障重试/STOP通过，私有媒体/义务0；自有3417/3418/四端口转发/unit库/公钥已清理，保留副本/共享3017/D/SSH。新SQL/组件/站点备份与新SSH登录拒绝已验。[实证](../tmp/cloud-camera-mini-sd-20261106/assessment.json)。无正式业务/小程序发布，不冒称完整恢复/物理微信/PTZ/重连通过。
<!-- /cloud-camera-cloud-mini-integration -->

<!-- cloud-camera-phone-trial -->
**微云手机体验版：Limited，云端接入/有界联调Implemented。** 用户11-06最终选择“体验版＋微云测试员工”，取代此前精艺企业3选择。AppID wxa7728432f59779d1、体验版本20261106-camera-sd-2；正式小程序1.5.0、Admin20260905-001和正式库保持。smartfloor.zlyun168.com既有request合法域名及WebView业务域名已回读，无域名配置变更；体验包urlCheck=true，无跨环境回退。

部署源[camera-trial](../admin/deployment/camera-trial/)，目录/datas/sfp-camera-trial-20261106、Compose sfp-camera-trial。独立PG/网关不发布宿主端口，专网10.203.207.0/24；网关只监听10.203.207.2:33417，PG专网5432，WVP走原私网。网关UID1001/只读根/cap_drop/无Docker socket/768MiB，PG384MiB，两者unless-stopped；独立raw规则/systemd在Docker前保护私有端口。JWT与正式站独立，环境/导入/备份均为root私有。数据库由隔离schema快照恢复，迁移账本0，不伪填已执行迁移，不作正式库迁移基线或自动跑混合journal。仅复制微云一个合成工地及保留员工，正式57迁移/4企业/78用户/18员工/39线索未变，原29容器（28运行/1已停）ID/启动时间/全部挂载无漂移，原WVP网络/规则保持。

Nginx只增加测试API/H5/媒体路径；原站有私有备份，nginx -t/平滑重载通过，主进程31981保持。回退只撤测试include并验证/重载、停止本Compose，保留测试数据，不覆盖正式库。已在线导出并校验本实例PGDMP/目录；不等于完整媒体灾备。专用SSH结束时撤销并验证；体验服务无本机/SSH转发依赖。公网1080p直播/SD和Stable真实员工入口/重进已验，真机解码/持续观看未验。[当前资源/备份/回滚实证](../tmp/cloud-camera-production-20261106/assessment.json)。

体验版无参数登录现按 /camera-test-api 配置自动选用已有账号密码态，普通环境仍默认手机号；修正版 20261106-camera-sd-2 已上传，官方trial码直达 packages/business/login/login。首轮手机19:18的403原件保留；客户端24项、Stable390×844无mode参数默认表单/实际员工登录/视频入口/重进4项通过，零漂移并恢复会话。未改登录布局、文案、素材或服务端身份限制；修正版手机重试/解码仍未独立观察。[入口修复](../tmp/cloud-camera-production-20261106/login-entry-fix.json)。

11-07 用户恢复专用 SSH 后更新独立测试网关 r2。仅网关容器重建，现有 30 个其他容器及挂载无漂移，隔离库 PGDMP 备份已校验。微云 1454 工地 12 实播 1080p 直播和 SD，停播后义务为 0。试用相册仅测试员工可读，合成记录与照片已保存。20261107-site-1 已上传，待在微信公众平台选为体验版，两枚官方体验码已生成。专用公钥已撤销且新连接拒绝，试用 HTTPS 回读 200。[网关](../tmp/cloud-site-trial-20261107/gateway-r2/deployment.json) · [实播](../tmp/cloud-site-trial-20261107/playback-deployed.json) · [上传](../tmp/cloud-site-trial-20261107/upload.json) · [SSH 收口](../tmp/cloud-site-trial-20261107/ssh-cleanup.json)

11-11 用户再次加回同一把专用密钥，用于 SD 身份诊断与网关 r3 部署（稳定身份、试验库迁移 0120、sd-clock 探针 v2；详见 production-deployment 的工地试验记录）。仅重建试验网关容器，验证通过后当日再次撤销该密钥。[r3 部署](../tmp/cloud-site-trial-r3-20261111/deployment.json)
<!-- /cloud-camera-phone-trial -->

**独立WVP试部署：办公网/HTTPS管理限定Implemented，4G直播用户反馈可播，产品集成Limited。** [https://wvp.zlyun168.com](https://wvp.zlyun168.com)复用DNSPod的A124.70.90.30、原泛域名证书及Nginx；正常公网解析/TLS、admin登录/设备重进、真实1920×1080 Jessibuca WSS播放通过。媒体请求/WS握手复用原wvp_token，匿名/无效会话401，公网控制/Hook/文档404。固定2.7.4在HTTP后端下须代理归一TLS字段，原生节点覆盖值重启会重置，不作为最终修复。上游仍回环28080/28081/28082，数据库不开放；摄像头192.168.10.100保留ID、TCP/TCP-PASSIVE、单设备24位密码；用户已开启4G并反馈直播可播。办公/32及手工4G临时策略仅涉及TCP15060/20000–20035，当前出口/云规则未独立回读。五服务健康，5安装检查及原8认证容量实证保留；仅本栈WVP因持久性核对重启，其余27容器/原11站点文件/Nginx主进程保持，工作进程平滑重载属预期。上轮自有测试结束时媒体/读者0且录像关闭，本次用户观看/网络状态未回读，不得自动恢复旧设置或清理用户会话。原备份/密钥清理实证保留。[域名实证](../tmp/wvp-bundle-20261105-01/public-management-verification.json)、[接入实证](../tmp/wvp-bundle-20261105-01/onboarding-verification.json)、[合同](production-deployment.zh-CN.md#独立-wvp-试部署包)。001归档/原网络保护/旧数据保持，无Admin/Mini路由/API/角色/schema/UI或业务网关发布；原4G报告保留为[用户反馈](../tmp/wvp-bundle-20261105-01/4g-live-user-report-20261106.json)，独立出口/重连/物理微信/PTZ/公网WebRTC/RTSP/RTMP/多路/完整恢复及原失败74h覆盖未验，不续跑旧批。 仅后台SSH，ecs-7c0c/root:22及StrictHostKeyChecking/BatchMode/IdentitiesOnly；密钥仅引用C:/Users/Administrator/.ssh/sfp_wvp_deploy_20261106_ed25519，不读私钥、不操作Xshell。域名任务后临时公钥已撤销，后续SSH需用户重新添加，其余授权/会话保持。

**2026-11-03用户授权本地Docker清零：限定Implemented。** 剩余8个本地在用Docker依赖已迁至批准的`192.168.10.54`：WVP、ZLM、MySQL、Redis、接入服务、只读容量探针，以及独立公开直播PostgreSQL／媒体服务。既有远端5个容器的ID、启动时间、状态和完整挂载字段保持；仅对挂载列表排序后比较，未删字段。未重启既有远端Docker／服务，未迁主库／评估库schema，无生产发布。

- 本机Docker Desktop和`docker-desktop` WSL均已停止，Docker进程**0**，辅助服务Stopped／Manual，Desktop `AutoStart=false`，无Desktop登录自启项；默认CLI context为`sfp-remote-dev`。原本地容器、数据卷、F录像和旧VHD保留用于回退；未启动或删除其他历史停用项目。隧道断开时不得自动启动本机Docker兜底。
- 远端实际目录为受ACL保护的`D:/Smart-Floor-Planner-Dev/migrated-services-20261103/`；`deployment.private.json`含真实环境／凭据，禁止入Git。Compose运维须通过SSH在远端真实目录执行。8个原卷完成冷复制，WVP容器内部历史抓图新增第9个持久卷，另复制ZLM内部抓图缓存。录像`/opt/media/www/record`和只读探针共同挂载远端物理D盘的`record/`；独立主机保留原容器／卷名及应用内路径。
- 13份基础镜像／冷备份／SQL（12,341,617,952字节）和额外ZLM缓存归档完成传输及hash校验；原F盘53个录像文件（6,431,924,380字节）恢复时逐文件SHA-256一致，8个原卷完成tar内容／元数据比较。7个镜像跨本机containerd manifest ID与远端classic config digest，文件层与配置内容一致；映射和原ID断言失败保留。已封存、完成checkpoint且无WAL尾文件的SQLite，以immutable只读方式完整性核验ok，原普通只读打开失败保留。此为本次依赖恢复，不升级主库／评估库完整恢复演练状态。
- 新增独立`admin/scripts/remote-dev/docker-services-tunnel.ps1`，保持本机／远端回环端口**8080、18080、18081、18082、11935、18554、18084、55434**，应用origin不变。`install-docker-services-tunnel.ps1 -Start`安装／启动当前用户隐藏`SFP-Remote-Docker-Services.lnk`监管，沿用严格主机检查和原SSH身份。核完整身份后仅中断该SSH子进程，8,180ms内8端口自动恢复；数据库／Embedding隧道独立保持。远端仍依赖既有Windows交互登录Docker任务，未新增登录前／重启验收。
- 仅将批准实体摄像头的持久`GB28181CFG.SIP_IP`从`192.168.10.32`改至`192.168.10.54`，其他持久GB字段、设备／通道ID、凭据和启用状态逐项回读保持。`OnlineStatus`为动态连接状态，不作为持久配置相等判断。新增2条入站SIP／RTP规则，仅允许摄像头`192.168.10.100`访问TCP／UDP15060及30000–30099；HTTP管理／媒体控制仍只绑定远端回环。无格式化、重启、固件、录制模式或设备计划操作。
- 验证：远端8个运行／健康，原5个保持；恢复的公开直播库150张RLS／150张force-RLS关系；鉴权容量与原生D盘总量1,403,827,589,120字节一致，匿名指标401；ZLM唯一测试文件确实写入远端D，原生hash一致后仅移除该自有文件。原H5入口200，真实私有MP4 Range206且有MP4头、匿名401，直播SIP／RTP200并接收70,358字节FLV。首轮发现原用户停止清理已释放3017／3018，容量unavailable失败保留；本次临时恢复网关／Next用于验证，随后按PID／创建时间／解释器／子树守卫释放，原3006 PID540892保持。未新增小程序原生／视觉／长期验收。本机内存仍偏紧，其他Node／ChatGPT／IDE进程保持，未声称整机可用内存已增加，也未擅停其他任务。

原74小时批次`2026-11-03T09-03-04-699Z`仍按用户要求保持停止，4次观测及interrupted／failed原回执不变。最终独立确认SD/off/stopped版本46、MP4=false，SD／观看／云台／写入义务0且无长测控制器；未恢复长测或自动化。未来仅在用户明确授权录制后，创建绑定远端新环境的新批次，并设置`CAMERA_RECORDING_HOST_PATH=D:/Smart-Floor-Planner-Dev/migrated-services-20261103/record`；不得复用F／本机原生statfs／旧物理挂载证据、修改固定05快照，或对本部署执行仅适用于本地Docker的容量部署脚本。

回退须主动、串行：先确认所属停写及义务清空，重新备份远端数据库／媒体并核字节和索引后，再同步切换后的新增写入。仅在明确回退时恢复原本地依赖，原服务就绪后只恢复摄像头原SIP目标，只停止本次新增依赖隧道。不得用旧本地快照覆盖既有远端主库／向量库。凭据、租户、留存、源撤回和生产边界保持。证据及精确归属：`tmp/docker-remote-migration-20261103-01/completion.json`、备份／恢复清单、provider追踪及进程回执；原准备／清理／验证失败全部保留。无产品UI／API／schema／角色变更，模型调用0，无新原生验收。

**CV-04只读驱动前置已验：** 固定执行prepare及长测改用显式Docker context/精确宿主目录；容量工具的`--context sfp-remote-dev --check --output <tmp下全新JSON>`只读验证远端Windows原生D、同源RW/RO挂载、15秒探针及匿名401，未知/错源拒绝且不回退本地Docker。新固定06的85333文件/7外部资源绑定前后稳定，JS18/18、清理守卫4/4、62入口类型0及6文件lint0；只读前后SD/off/stopped46、MP4=false/义务0，网关停止导致DB健康行unavailable不算Worker通过。首个缺失SSH转发失败保留，恢复原8端口监管443384/350404后物理前检02通过，监管继续常驻。无3017/3018/录制/自动化启动，无UI/API/schema/角色/素材变化，Mini/Stable只复用未变入口；整体Limited，该前置批未执行录制检查；当前录制范围/状态以[视频计划第2节](./cloud-construction-video-plan.zh-CN.md#2-唯一当前任务)为准。证据tmp/cloud-camera-remote-preflight-20261103-01/validation-06.json，调度仅看[视频计划第2节](./cloud-construction-video-plan.zh-CN.md#2-唯一当前任务)。

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

当前数据库连接（2026-10-27，**Implemented**）：本机回滚容器`smart-floor-planner-postgres`（`0e59eca3a130`）与`xiaok-vector-eval`（`533ec1414f2c`）占用5432/55432后，已恢复原批准的主库/评估库SSH转发。本机主库只有60条迁移且缺少`admin_users.construction_trades`，可复现小程序密码登录查询失败；远端主库有90条迁移且字段完整。只停止这两个已核实的本机容器，保留原数据卷及快照后续本地写入，未把这些写入合并或覆盖到远端。本机主库重启策略改为`no`，避免Docker重启后再次占用应用端口；其他本机Docker服务仍运行。`admin/scripts/remote-dev/install-tunnel.ps1 -Start`已刷新隐藏的Startup维护进程，两个本机回环端口均由其已核实的SSH子进程监听。原`sfp_app`连接URL/凭据、远端数据卷均未改变。当前小程序local API为`http://192.168.10.32:3006/api`，与源码一致；无生产切换或数据库迁移。真实登录、身份写入、bootstrap、刷新及权限检查通过，证据与合成数据清理记录在`tmp/login-recovery-20261027/`。下文旧迁移/切换计数保留为历史记录。 真机网络修正：当前WLAN为192.168.10.32，旧192.168.10.111有线网卡已断开/Deprecated，本机仍可访问旧地址掩盖了手机不可达。从已批准远端电脑192.168.10.54无代理请求，旧111:3006超时、新32:3006可达，响应请求ID已在本机Next.js日志核对。只改变小程序local API地址与测试预期，SSH端点、数据库转发、凭据、服务监听0.0.0.0:3006、生产和防火墙设置均未改变。网络证据为`tmp/login-recovery-20261027/device-network/`；真机成功仍未验证。 官方Stable CLI已按修正的WLAN API成功编译开发预览包，二维码及源码绑定保存在网络证据目录，无生产部署。

**成熟搜索/读取对照已收口（2026-10-23），CONSULT-02仍Limited。** 原版Open WebUI0.12.3＋国内免费SearXNG（百度/360）＋Crawl4AI0.9.2/pypdf替换手写HTML解析，保持DeepSeek Flash、企业/项目文件及合成V1/V2原PNG。独立安全导航和原版Tool都能读到真实6页厂家PDF，但两组自主综合问答仍停在代理资讯。16轮固定＋4轮传输受影响复测、20重进/32内部全文核对/8份实际图像输入通过的是完整性，不是业务达标。两组首图都擅称净尺寸；追问沿用网页[4][5]或[5]但当前仅2来源，界面显示undefined。206实际运行依赖类型0/无漂移，139读取器源码及依赖版本稳定，288原版核心未改。51调用/251487tokens；DeepSeek具名日账单¥0，额度687.85K→436.37K（舍入差7），用完即停保留开启。2企业AI停/12身份撤权、队列0/配置投影/profile/task恢复；原UI/向量停且保留卷，2自有辅助容器移除、SSH363836/307228及读取器停，原开发服务保留。无产品路由/API/schema/权限/UI/.env/Worker或生产变更、无新Mini/租户/源撤回通过。证据：双语二期及tmp/xiaok-intelligent-consult/openwebui-mature-{review-01,close-01,ui-01}.json；下列旧记录独立保留。

原版向量URL仍指向172.17.0.3；先启动辅助搜索占用了该地址，openwebui-mature-network-order-01.json已按原向量/UI先于辅助服务的顺序恢复，原精确ID/卷/凭据保持。前置失败及容器回环RPC错误分别保留，不能据此判断模型能力。Crawl4AI实际使用隔离本地Python3.12.10环境，未宣称Docker爬虫镜像拉取成功；未改的上游地址固定代理运行于批准的远端Docker网络，避开本机fake-IP。int.quick-step.com证书吊销和旧quick-step.cn的TLS问题继续拒绝，不启用不安全TLS、内网目标、公网端口或付费回退。此前Flash别名额度开关限制未变，不声称账号所有设置还原。

**最新DeepSeek原版对照已停止（2026-10-23），CONSULT-02仍Limited。** 复用同owner openwebui-comparison原UI/向量ID、官方0.12.3镜像和标签卷，288核心未改、未新增容器。16轮＋4轮定向复测/41调用/212755tokens；DeepSeek具名日账单¥0，额度900.61K→687.85K，其用完即停保留true。openwebui-deepseek-repair-close-01.json通过4501–4503企业AI停/18身份撤权、两库jobs0、开发/隔离55432配置投影/profile/task恢复、非全局Filter已停；精确停原UI/向量和SSH69160（本机127.0.0.1:18092↔远端127.0.0.1:18092、远端127.0.0.1:18093→本机3108），保留卷及3006/5432/55432/18089/18090/Worker。1297/1298绑定类型0/无漂移；同字节扩展保存在scripts/openwebui-comparison/。厂家技术原文的完整链路仍未过；共享搜狗302兼容和原站TLS未解决，baidu覆盖请求回落原引擎不算百度通过；匿名Jina Reader探针401/IP信誉拦截，未采用。未改小K/产品/.env/凭据/生产，未降TLS/SSRF或启付费回退。此前Flash别名额度开关恢复仍不完整，不称账号全部还原。详见双语二期及repair review/close/UI/bill证据；下列旧对照独立保留。

原版Open WebUI免费替代隔离对照（2026-10-23，已停止，CONSULT-02仍Limited）：仅复用owner openwebui-comparison的sfp-openwebui-compare（2GiB/2CPU）及sfp-openwebui-compare-vector（512MiB/1CPU）和原标签卷sfp_openwebui_compare_data/vector；官方0.12.3 image ID `sha256:f68c6b58d6ea0ddc220b4d04ce22fa123dd261a08a74bab3a0b255f954fd95b0`、288后端文件未改，无重复容器。新13免费候选/104用例/107attempt、104重进/52完整追问链，0厂家原文读取，无完整三源成功；新observed模型116107tokens、Embedding104次6916tokens/费用null。开发与隔离55432/xiaok_embedding_eval平台配置/投影恢复、13企业AI停/52身份撤权、两库jobs0、13测试profile清理及原GLM9 registry恢复。精确停止自有UI/向量、SSH439148（本机18092↔远端127.0.0.1:18092、远端18093→本机3108）和只读501248；卷/原版镜像保留。原3006/5432/55432/18089/18090服务保持；本轮未动小K/UI/API/.env/Worker。搜狗在HTTP302分支的resp.next_request报AttributeError，360返回4/4/7真实候选；搜索配置未改，不能宣称全DNS/超时修复。1290绑定/类型0，06摄像头注释漂移原失败保留、0模型运行时等价补验通过。HEAD814e5cf3fc28cd45a7b9e53f315feac8fa89571e/index fe96733992eec0e3e1ce12e955c980ad2ab0e09c归现有工作，未暂存/提交无关改动。见tmp/xiaok-intelligent-consult/openwebui-free-{network-01,review-01,close-01,drift-impact-01,search-diagnostic-01}.json；旧narrow/30工具和unknown独立保留，不含部署/付费许可。

免费搜索开发接入（2026-10-23，**国内搜索可用，完整咨询可行性未通过，Limited**）：保留批准sfp-remote-dev中的唯一自有sfp-remote-dev-search，owner assistant-search-development，固定`ghcr.io/searxng/searxng@sha256:5ed0323b5f5f8701264ef65e239a2bd83cb57098f2b971fa30bf79c06eeae271`、512MiB/1CPU、远端127.0.0.1:18090:8080/本机18090 SSH。development.ps1继续核对归属/镜像/回环绑定，-UpdateSettings仅重启该服务。国内免费搜狗/360为8秒上游/10秒最大超时/无重试，百度CAPTCHA/Bing无关保留，不绕过。可选ASSISTANT_WEB_DNS=alidns校验阿里公共HTTPS DNS的IPv4答案，拒绝私网/fake-IP/混合并逐页面/重定向固定地址复核；cn-dns-ready.json的87检查/215依赖0类型/lint沿原绑定。search-cn-originals-01.json的独立5068字节原文不是相关性选页通过。最新固定8实模run8687–8694没有业务网页，模型猜测域名/追问无效域名暴露规划缺陷；feasibility-search-diagnostic-01.json同词带猜测域名0条、去掉后892ms有8条，0新模型调用。故不以当前空结果重做网络或放松SSRF，不开始产品编排实施。沿批准目标恢复本机127.0.0.1:18089→远端127.0.0.1:8089的Embedding SSH隧道，真实1024维/合成知识索引通过；不改凭据或暴露端口。18091诊断反向代理已撤下，原本机代理设置未动。当前同一服务/固定镜像运行，本机18090隐藏SSH经原development.ps1恢复（PID39516），未更新远端配置或扩大绑定。`tmp/v1-01-weiyun-jingyi/natural-answer-20261105/web-connected.json`以进程内searxng/回环URL/alidns选项进行零模型实际搜索，读取1页1719字节原文，另2页保留web_page_too_large；这仅证明搜索/原文连通，不改判原8实模或装修回答相关性。.env.local现仅追加searxng/回环18090/alidns三项，原配置字节完整保留，读取确认provider可用；Next/Worker未重启、未启用企业/模型协议。证据为同目录development-search-config.json及config-readback.json；隔离平台LLM临时复用既有GLM9并在finally精确恢复、开发配置及VLM/1454保持。原C01的3类已存状态Stable重进通过，不是完整咨询/网页来源片通过；AI停/身份递增/队列0、控制器与验收锁释放。详见双语二期合同及feasibility-semantic-review-01.json，无公网、付费、生产或发布批准。

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

摄像头CV-04执行/回滚合同见[视频计划第5节](./cloud-construction-video-plan.zh-CN.md#5-验收运行与部署边界)。prepare显式--context sfp-remote-dev，新建固定批次并使用远端D目录（固定06仅为原前置证据），原生容量通过批准SSH主机读取；不得把旧F/固定05环境当新远端批。数据库仍仅原55432→远端15433/cloud_camera_eval，当前前置无schema迁移，0114仍缺，不重放混合journal；凭据/主库/向量库及独立转发保持。释放所属评估运行时前，仅关闭版本归属本批的录像并确认物理MP4=false、本批originalPolicy对应模式/off/stopped及SD/观看/PTZ/写入义务0，再核完整进程身份。保留共享3006、远端WVP/ZLM/探针/D媒体及独立SSH监管；F/旧卷仅为回退数据，切回前须新鲜备份、完整hash/索引核对切换后的新增写入。存储不可达不新增为清理停录前置；未知写入不重放。11-03停止批次保留原终态，automation-4继续暂停；当前授权与批次状态以[视频计划第2节](./cloud-construction-video-plan.zh-CN.md#2-唯一当前任务)为准。生产HTTPS/业务域名/监督/部署及完整恢复演练仍未授权/未验。

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
