# 施工公开直播合同

英文镜像：[construction-public-live-contract.md](./construction-public-live-contract.md)。执行及实际状态只维护在[小K唯一计划](./xiaok-renovation-agent-development-plan.md)第2节；本文是运行时合同，不是另一份任务队列。

当前状态 Limited。Stable 本机真实机位验收已覆盖 C05 原咨询原始 1080p 预览、本人项目兼容播放、C03 围观首播、开放态重进与撤回。对外公开和生产沿各自授权流程，真实微信真机、默认私有 FLV 连续性和实际编译包体仍待验证。

业主及员工媒体授权依次读取企业策略、适用的身份与咨询，再读取直播授权。源读取在直播数据行之前对启用策略持共享锁。媒体输出前继续复验授权。真实应用角色数据库屏障下，两条并发业主清单请求由 `[503,200]` 和 `40P01` 恢复为 `[200,200]`。`enterprise_admin`、`admin`、`super_admin` 返回 200。错误业主被拒，撤权后业主旧清单、分片与匿名旧清单均 404。匿名请求在策略锁等待时，策略写入方仍能获取授权行。证据见 `tmp/public-live-package/owner-preview-lock-{before01,after01}/`。

已有业主媒体会话读取清单和分片时，对企业策略、原咨询与有效参与者持共享行锁。会话创建、代理创建及同意写入沿用原锁。以同一 164,124 字节合成分片固定分为三块，四路并发全部读完耗时共享锁 1.49–1.51 秒、原排他锁 7.69–7.73 秒，每路均执行九次授权复验。真实应用角色数据库验证了写方受共享锁约束，业主读请求先等待策略，再读取咨询与直播授权。第二块等待上游时撤回，该块在输出前被拒，原业主清单、分片及匿名清单均 404。证据见 `tmp/public-live-package/owner-shared-lock-02/`。

复用微云1454同一真实在线机位（project12/binding9/camera8 v2）。私有进入和重进均实际解码41帧/4.095秒（1920×1080），HLS分片200；原H5页面实际播放从27.4086到31.3789秒，解码帧137→157，只显示观看能力。合成业主临时观看授权恢复关闭v16。用户单次授权本机隔离围观，复用同一真实源经专用转发。合成业主从原咨询实际预览，企业审核前匿名404。审核后本机匿名实际解码31帧/3.071秒（1920×1080），无音轨。撤回后旧详情、清单、分片均404；原转发退出等待超时保留，独立只读复核确认隔离代理、转发、有效会话及媒体文件均为0，真实绑定和录像状态经复核保持。按批准C03-05/C05-02共享失败态，503、连接和解码失败显示“暂时无法连接直播”，撤权/停止显示“直播已停止公开”；公开端须有正播放进度才显示直播中。业主仍须当前尝试实际预览进度才能同意。定向客户端含包体61项通过。Stable 390×844验证真实HTTP503反馈、点击重试及已撤回记录返回404后的返回入口。 同一C03批准稿校准导航、关闭和主按钮，原生设计师按钮92×44、胶囊净距10px、关闭44×44、主按钮宽330，播放器330×185.625。04保存并复核390×844及完整副屏宿主截图，原窗口与焦点已恢复。01驱动超时与03宿主前置失败保留。原native-business01/02首播失败及止损计数保留。本机服务和H5播放已验，Stable公开HLS完整首播、真实微信真机及生产仍待核。 证据 `tmp/public-live-package/{v104-goal-private01,v104-goal-h5-01,v104-goal-public01,v104-goal-feedback01,v104-goal-feedback02,v104-goal-feedback03,v104-goal-feedback04}/`。

共享锁后两次复验沿批准的 C05-02 v002 入口与同一 Stable 工程，显式编译后均读到 390×844 和基础库 3.17.2。两次都在 `automation_evaluate` 检查控制器归属时超时，当时尚未安装合成身份或打开原咨询。第二次在副屏无焦点显示已核窗口，并恢复原最小化状态。两批合成授权、会话和转发夹具已清理，源码绑定均无漂移。旧播放失败单列保留。本次改动后的 C05 正向播放、同意及持久重进仍待核。证据见 `tmp/public-live-package/owner-shared-lock-native-{01,02}/`。

续验驱动先等待编译交接，再检查实时页面数据、专用 systemInfo 调用和控制器归属，通过后才创建合成夹具。沿批准的 C05-02 v002 卡片，预览按当前版本回执更新授权卡并保留原咨询挂载，同意后仍重读原咨询。Stable 390×844 已记录播放器正向进度。驱动按滚动方向取整，保留实测裁切边界。原负载播放至 0.975 秒后报 bufferAppendError。同尺寸、帧率、编码的 200 kbit/s VBV 对照播放至 0.960 秒后报 bufferStalledError。两次均在同意前丢失当前预览资格。C05 同意与持久重进、C03 完整播放及真实微信真机仍待核。旧失败与隔离清理保留，证据见 tmp/public-live-package/ 下的 c05-native-retain-preview-01 和 c05-native-bounded-payload-01。

已批准的 C05 封面卡只显示当前绑定和直播版本最近一次有效的定时 JPEG。待业主决定且来源有效时，每 15 分钟由公开直播 Worker 通过原抓拍表和 WVP JPEG 适配器最多认领一次。封面请求重验原咨询、待决定状态和当前来源。定时封面不会进入普通私有抓拍历史或公开材料；暂无封面时，获权用户仍可打开直播。

从原咨询点击播放，通过现有摄像头 WebView 打开精确版本的 C05 无声只读 H5。播放器实际解码并推进后上报；服务端仅在同一获权会话已完整输出分片时接收。重新预览使旧回执失效。返回原咨询时重读资格；同意时再次核验当前业主、身份上下文、咨询、版本、修订号及未过期回执。公开仍需企业审核。H5 播放回执以同一短会话路径的 `POST .../media/:token/played` 提交。数据变更见迁移 0117。

Stable 390×844 已通过 C05 隔离合成旅程。业主看到 263×147.9375 的定时封面，通过原 WebView 实际播放 HLS，完整送出两个分片，再返回原咨询。提前提交回执和同意均被拒。实际 H5 回执启用明确同意，重进读到已同意、待企业审核。匿名播放和错误业主封面读取被拒。同槽抓拍只写一次，1553 项绑定零漂移，所属测试资源已清理。证据见 tmp/public-live-package/c05-webview-03/。

Stable 重新登录后，同一获权的真实开发机位也通过 C05 私有闭环。原咨询展示该机位已有的真实 JPEG，并保留原抓拍时间。真实直播只在隔离夹具内转码转发（640×360、15 fps、目标 160 kbit/s），原 H5 实际解码并取得回执，两个分片完整送达。返回原咨询后可实际同意，重进读到“已同意，待企业审核”；匿名保持 404。原始 1920×1080 码流对照有 5 个完整分片和 6 个取消，无播放回执，同意未开放。两轮均清理了自有资源，并复核真实绑定、观看授权和录像策略不变。证据：tmp/public-live-package/c05-webview-physical-{03,04}/。

原码流约每 2.05 秒出一片，应用完整传输却耗时 3.4–3.8 秒。H5 随短清单滑动跳到未缓冲的位置并取消下载。移除读取前的重复校验缩短了耗时。C05 改为距直播端一个目标分片时长起播后取得回执，但仅推进 1.33 秒就停住。独立 282,072 字节对照逐字节一致，128 KiB 块将完整传输从约 2.04 秒降到 1.50–1.63 秒。转发现按最多 128 KiB 输出，在每块输出前和标记分片完整前重新鉴权。中断和撤权会拦住等待中的下一块，部分分片不能解锁同意。 Stable 复用同一机位原始 1920×1080 视频（直接复制码流），在同一已播放区间推进 4.96 秒并解码 78 帧，共完整送达 9 个分片。业主由 H5 返回原咨询实际同意，重进读到待企业审核。提前回执与提前同意被拒，匿名详情返回 404。证据见 tmp/public-live-package/c05-original-1080p-reopened-01/。

C03-05 只接受当前播放器的进度和解码错误。继续观看或续期后，须等新源正向进度才显示直播中。实际进入播放后可暂停。解码失败沿原重试入口恢复，并停止定时续期，授权轮询仍可清除已撤回的流。当前 Stable 390×844 通过隔离应用路由进入直播中并收到两个完整合成 HLS 分片。首轮驱动在暂停前中止，且有配置漂移。第二轮零漂移，暂停点击因选择器找不到元素而停止。固定 HLS 与受控 HTTP 对照在同一 Stable 路由通过暂停、新会话继续、503 重试、撤回清画面及重进。最终隔离服务用合成滚动直播通过播放、暂停、继续建立新会话、受控 503 重试、实际撤回及停止后重进，三个旧清单均返回 404。两条作品相关路由实际加载包内字体，Brotli 文件在 Stable 解出 696,256 字节 WOFF2。沿批准 C03-05 原结构、文案和授权合同。定向客户端 43/43，字体及源码包体 18/18。证据见 `tmp/public-live-package/c03-player-generation-{01,02,03}/` 和 `tmp/public-live-package/c03-native-state-control-{01,02,03}/`。实际编译包字节数仍待验证。

2026-11-05 单次本机隔离验收中，Stable 390×844 从原 C03 路由播放微云 1454／项目 12／绑定 9／机位 8（v2）的真实源。隔离转发为无声 640×360 H.264、15 fps、目标 160 kbit/s。业主预览取得真实回执并同意，企业审核通过；业主同意前及待企业审核时匿名详情均 404。访客播放器收到 6 个完整 HLS 分片，12 个正向时间样本推进 2.916 秒。驱动随后在多级分片路径取错会话下标，未执行授权有效期间的重进。清理已撤回授权，停止自有转发和代理、清除会话，真实配置回读一致。独立零漂移复核从原链接进入 Stable，显示「直播已停止公开」且无视频源，旧详情及新会话请求均 404。原媒体令牌未保留。使用产品原清单改写离线验证了下标修正。证据 `tmp/public-live-package/v104-c03-real-native02/{report,withdrawn-readback02}.json`。

第二轮获准的本机隔离验收补齐了开放态重进。业主同意、企业审核后，Stable 从原 C03 路由打开同一真实机位，回到小程序首页，再从原入口建立新会话。首次和重进的播放进度分别推进 3.185 秒和 2.394 秒，两次会话合计 9 个完整无声 HLS 分片。撤回后清除画面，原详情、两次会话的原清单与原分片均返回 404，再进显示停止状态。临时公开、身份、代理及转发均已清理，活动会话与自有代理均为 0，真实机位配置回读一致，1,859 个绑定项零漂移。C03 本机 640×360／15 fps 范围通过。真实微信真机、生产和实际编译包体仍待验。证据 `tmp/public-live-package/v104-c03-real-native03/{report,binding}.json`。

业主本人项目档案已在 Stable 390×844 通过兼容播放的真实私有链路。测试驱动选用 H5 既有播放控件，从原始 1080p 画面读取连续播放进度和解码帧。首次 2.248 秒／27 帧，重进 2.124 秒／25 帧，合计五个完整 HLS 分片。匿名入口 401；撤权后旧 H5 会话、新入口均 404，项目档案隐藏摄像头。临时授权最终关闭 v22，临时微信身份及控制器移除，活动会话 0，录像策略回读一致。首轮滚动回调序列化带入 `__name`，在点击前失败；默认自动 FLV 批解码 142 帧但未达到 2 秒连续播放。该批还原控制器后重复执行清理步骤而报错，末批复核活动会话 0。最终六步通过，292 个文件绑定无漂移，小程序定向检查 12 项通过。证据 `tmp/public-live-package/v104-owner-project-native{01,02,03}/`。通过范围为模拟器兼容 HLS 私有播放。C03 真实机位围观须有独立明确授权。

## 入口与设计

- `/construction-projects` → 项目Drawer → 原公开材料Tab → **直播公开**，沿Ant Design Form/Select/Card/Steps/Alert与共享操作反馈。摄像头管理者及所选企业管理角色可准备合法绑定、公开名称与机位别名，普通观看成员不能准备。只有`enterprise_admin`、`admin`、`super_admin`可审核当前业主的这一版同意；平台管理无需入职或成为项目成员。
- 业主在既有私人客户咨询收到持久服务事件。`liveEvent`锁定该咨询及有效原客户参与者，再以已认证调用者ActorContext复用既有system消息写入；不关联全局用户表、不伪造接收者身份。发送目的地缺失则失败回滚；终止撤权在目的地关闭时仍有效。原生卡设计先展开完整画面、受众和范围，再明确同意/拒绝/稍后；阅读、普通回复及沉默不构成同意。同意只进入待企业审核。重进读取实际保存版本、revision和当前关系。
- `packages/construction/public-site/public-site`及原Agent详情纸页在当前批准存在时显示独立直播入口。`packages/construction/public-live/public-live`仅一个16:9完整画面，真实连接/播放/暂停/失败反馈、别名、全屏及返回/本人咨询动作；不提供进度条、音量、PTZ、抓拍、录像下载或历史回放。
- 批准源为`design-references/xiaok-p4b-public-sites-v1/README.md`，Agent风格C03-04/C03-05 v001及C05-02 v002，853×1844映射390×844。普通状态复用共享规则；精确16:9组件规格优先于生图的近似画框。纸页、书脊、装订、布签和控件均为原生代码，不切片整屏。复用既有独立F1头像并优化PNG编码，原件/比较保留于`tmp/public-live-package/avatar-*`。

## API与数据

| 调用者 | 入口 |
| --- | --- |
| 所选企业cookie | `/api/construction/public-live/:projectId` GET读取、POST保存；POST `submit`、`publish`、`reject`、`withdraw`、`session`、`reconcile` |
| 原咨询业主bearer | `/api/miniprogram/assistant/public-live/:conversationId` GET；GET `:liveId/cover/:coverId`；POST `:liveId/preview`、`webview`、`approve`、`decline`、`later`、`withdraw`、`session` |
| 匿名 | `/api/public/construction-live/:enterpriseId/site/:publicPhotoSiteId` GET当前入口；`/:publicKey` GET安全元数据；`/:publicKey/session` POST；`/:publicKey/media/:token/:resource` GET及仅媒体OPTIONS |

应用响应均no-store。公开元数据仅公开名称/别名、授权版本/revision及范围，不含摄像头/绑定/设备标识、私有源地址或私聊。照片目录ID仍重验自己的来源；直播分享入口可独立于照片公开存在。

`app`下五表保存当前授权、不可变的精确绑定/摄像头版本范围、自有代理尝试、仅存hash的短会话及审计。复合租户/项目外键与强制RLS沿既有租户事务，复用原咨询/outbox和幂等记录，不新增Agent、知识索引或引文管线。

保存使用预期revision与幂等键，轮换公开key并生成不可变版本；活动授权或代理结果未决时不能直接替换。发送绑定当前业主及精确原私人目的地。同版完整预览登记后才能同意，管理审核仍要求同一业主/版本。每次重验租户、有效项目/对客范围、当前业主、精确活动绑定/摄像头版本、准备者权限及管理审核；历史回执不能授予新权限。

## 媒体与撤回

媒体流程在外部调用前持久保存唯一代理所有权意图，复用WVP play及`guardLiveWriter`，再创建仅属于本模块的`sfp_public_live` ZLM代理：`enable_audio=0`、`add_mute_audio=0`、`enable_mp4=0`、启用HLS、`retry_count=0`。须观察ready视频且没有任何音轨才授予观看会话，前端muted仅为补充。真实合成输入带AAC音轨；service04解码公开HLS并证实仅有视频、没有音轨。

创建结果未知不自动重放。核对按精确自有key清理并验证代理列表/媒体均不存在；之后明确连接可建立另一个独立记账尝试。授权/取景锁避免停止与延迟创建交错；失联starter在有界请求窗口内保留停止义务。清理不停止共享WVP源。本机固定构建在成功空`listStreamProxy`省略`data`，仍要求code=0及独立媒体不存在才能确认。

每个清单/分片及响应chunk都重验当前授权、来源和会话代次。HLS的Range请求返回同一有界实时资源完整内容，清单改写将资源限定在自有代理内。会话两分钟过期，恢复权限或新授权不复活旧会话。停止先提交撤权再清理外部代理，清理未确认如实反馈。来源/身份撤权失败关闭；成员、项目、业主、设置变化持久作废，恢复不静默沿用旧批准。机位绑定/配置及持久PTZ义务在公开停止/清理确认前受到数据库拦截。不自动检测人工物理移动摄像头。

`scripts/public-live-worker.ts`专责每五秒核对既有自有义务，支持`--once`，不启动或重放创建；提供此功能的环境必须运行该职责。已经送达的画面不能召回，客户端清空播放器，服务端拒绝后续请求。

## 配置与证据

`PUBLIC_LIVE_ZLM_ORIGIN`、`PUBLIC_LIVE_ZLM_SECRET`、`PUBLIC_LIVE_SOURCE_ORIGIN`指定私有代理及服务端可达的源origin；可选`PUBLIC_LIVE_PUBLIC_ORIGIN`提供小程序媒体使用的公开应用origin。生产只允许HTTPS，开发可用loopback HTTP；这些不是设备地址。代理HTTP根须与HLS落盘根一致。隔离夹具最初将`/opt/media/www`与`/opt/media/bin/www`配错，原始清单/分片判别及修正配置均留存。

本地验证使用新建`127.0.0.1:55434/sfp_public_live_eval`、标记微云1454合成夹具、独立ZLM18084/RTSP18554、合成WVP18085、Next3019及带声音测试流；不使用既有camera数据库、真实摄像头、生产迁移、应用模型/图片调用或旧unknown账册。保留service01的Range失败/清理初始未确认、service02正确拦住未清理状态、service03的HLS根失败，以及HTTP01的驱动JWT前置失败。`service04/report.json`、`http02/report.json`是各自无漂移的成功范围；未执行的原生检查不因它们而升级。

<!-- public-live-native-bounded-status -->
Native01–08保留原失败。native-mechanism02在1191项绑定/drift[]下固定判别：编译前直接/封套对象通过；单次刷新后currentPage/直接wx元信息通过，原封套10,751ms返回结构化桥接超时（exit1/killed=false/signal=null）。安装的Stable0.3.11直传fnSource至App.callFunction，桥接默认10s；没有证明必须用封套或30s外层截断是根因。execFile Error.stack遗漏stdout业务JSON，客户端现保留具体错误、耗时/退出/信号。native07跨盘假漂移已用真实文件未变/修改/删除及配置回归修正，未移除绑定。native08立即getData在14,966ms失败，cleanup.stopped=true/drift[]；随后相同读取1,899ms成功，135次观测持续可见/非最小化并有有效被动宿主。固定可见/最小化/可见对照三次均成功（1,326/857/776ms），不证明最小化是原因；该对照最终焦点断言失败，整批保留失败，未置前重试。

Native09复用其中1181项未变Mini/运行时依赖的编译与就绪证据，不再刷新；实际源/配置绑定结束drift[]，精确数量见report.json。原始断言记录三个通过、匿名视频失败；同意及原咨询重进确有持久写入/回读，但C05可见用户期望未通过：预览(45,1923.90625)/263×147.9375及同意(45,2275.796875)/263×46在390×844可见区外，owner-full-scope.png显示照片/历史状态，并未显示直播范围卡。有效被动宿主捕获保持前台焦点，也不能弥补目标缺失。原断言/截图及本次复核分别保留，不能合成完整原生授权或光学通过。

冻结native09批中，匿名Authorization为空、元数据/session200，两清单200但未观察分片或真实解码错误，不能认定模拟器编解码限制；播放/暂停/503/停止均未通过。该源还存在playbackFailed清URL后仍可仅凭展开同意的缺口。下方successor01记录其后就绪守卫、真实在屏与实际媒体判别，原native09结论不升级。

最终确定性驱动范围driver-verification03.json：单元6/6、定向lint/types0、drift[]；首轮单元转义夹具失败及类型01/02原失败保留。Mini结构/样式/素材/文案/API及后台权限未改。自有live1/version28/revision113已withdrawn，独立照片1/version1仍published，活动授权/未结代理/自有55434 advisory锁0，保留代理总记录8。所有尝试的内存覆盖已恢复，自有源/WVP/Next及3019/18085/18086已停，Docker55434/18084/18554保留。绑定收口后tsconfig/next-env恢复启动前精确字节，不倒算运行中漂移。新模型/Embedding/图片0；旧9图金额unknown及全部旧未知/次数保持。实际编译包体、原生Brotli/字体读取和还原未验。后续默认shell缺Core Utility清单；只在子进程直接加载已安装Utility DLL的只读判别已成功（powershell-utility-probe.json），没有全局修复，后继可按这一实证处理。
<!-- /public-live-native-bounded-status -->

## 2026-11-03有界收口与保留缺口

- `tmp/public-live-package/admin-ui01`因外部cleanup新增私有视频授权计数/删除而drifted；唯一复核`admin-ui02`最终272文件无漂移，4项仅为真实保存/勾选门槛/发送状态/重进。初次Admin预览无稳定视频帧；相邻照片材料重进出现服务错误，均未通过。临时浏览器cookie已清除，自有3019/helper已停。
- `boundary01`原消息断言失败并已停止代理；只读判别确认sfp_app租户下users0/conversation1/participant1/deliveryJoin0，message_id=null、直播消息0。`domain_event_outbox`已有事件不等于咨询已收到；原service04/HTTP02不再支撑“原咨询投递通过”。该原失败保留，不改记通过；后续定点修复保留RLS，不开放用户表。
- `boundary-independent01`保留缺少内建角色行的夹具失败；改用已有合成员工服务准备后，`boundary-independent02`原5项工程检查通过、cleanup.stopped=true、drift[]。覆盖五表计数/非绕过RLS、角色/业主context/准备者密码状态撤回及恢复不复活、模拟自有代理stopping拦截、真实域删除和完整回滚、跨租户拒绝。不是用户端业务验收。自有55434仅补0113及外部当前0115兼容结构；canonical01仍仅是当时完整journal/0114证据，未迁移共享库。
- `mini-final01`是误用Bun的解释器前置失败；真实Node v24.9.0的`mini-final02`34项中32通过/2失败、1175文件无漂移。assistant源2,084,200字节，高于含96KiB预留的1,998,848预算；主包源向上取整2050KiB，高于2048KiB硬上限。保留预算，不删用例或放宽阈值。
- `lint-final01`31相关文件0错误/3警告、无漂移。`types-final01`87项中5项是诊断脚本缺少宿主声明；仅补可擦除声明，转译JS前后hash相同。`types-final02`为82项继承诊断、本功能0/新增0、2950文件无漂移。独立dist构建结果见唯一计划第2节；不运行共享清缓存prebuild。
- 批准来源/生产路径：C03-04 Agent图→public-site及原chat纸页；C03-05→public-live；C05-02 v002→原chat/root共用卡。整屏仅作标尺，均853×1844→390×844，视频由代码保持精确16:9/contain。既有独立F1原PNG（49,659字节/原hash7cfb0779…）经调色板重编码→`miniprogram/packages/assistant/assets/xiaok-chat-avatar.png`（19,084字节/82ac026d…），alpha范围0..255、角点alpha0，原件和比较保留于avatar-*；不是无损像素一致或原生光学通过的宣称。
- 已离线比较两个成功判别与05/06：前者返回当前wx对象/包裹数组，后者在fresh compile后仅有skill-call输出、无成功回执。编译前后条件与封套同时变化，尚无控制变量证据证明共同机制；不能据此启动第7轮。全部原失败、修复次数、9次旧图片费用unknown、新模型/图片调用0和生产边界不变。

收口集成保留外部`24c16782`（业主私有视频明确授权），只在其journal后追加0114；无关0102登记仍留工作区。暂存0114 SQL hash与canonical01相同，新合并journal不同且未重跑。build-final01编译108s后在继承`scripts/xiaok-manual-fixture.ts:43`（state.keys unknown）类型失败，原批还保留tsconfig自动格式漂移；只移除自有include/还原自有next-env导入，继承设置保留。自有合成源/WVP/Next/helper已停，代理/授权及自有库advisory锁均0；隔离DB/媒体容器与夹具保留供核查。

## 用户纠偏后的定点续作（2026-11-03）

- `tmp/public-live-package/delivery-service01/report.json`：真实服务3/3，cleanup.stopped=true、drift[]。员工发送生成原咨询非空message_id且原业主能读回，同键不重复。业主同意、管理审核和员工停止在同一原咨询形成四条持久消息/投递。跨租户及接收者失效均失败关闭，失败事件完整回滚；全局用户仍不可见，不新建咨询/run/job，无新迁移、模型、原生或媒体创建调用。
- `publicLiveDesigner`对应既有C03-04“找设计师聊”及`PublicSitesController.privateChat`入口合同，传递conversationId/publicEnterpriseId/publicSiteId/publicVersionId/findDesigner，由既有onShow先附加再接续；保留原草稿，不携带lead/project/owner身份。隐藏、加载、不可用或不完整详情不能跳转；附加失败/已撤回不触发接续。结构/样式/素材和视觉层级不变。`tmp/public-live-package/resumed-fixes01`客户端20/20仅为逻辑证据，不新增渲染/原生验收。
- 正常授权开发继续包体修复及原用户旅程；历史失败、同一问题两轮失败计数、未知费用和部署边界保持，不授权真实摄像头公开或生产。
- 确定性包体续作`tmp/public-live-package/font-package01`在1180项绑定/drift[]下通过Node客户端/包体42/42。真实`packOptions`现排除保留的base64开发字体副本和本地项目配置，显式包含`assets/studio-serif.woff2.br`（696,261字节）；官方`readCompressedFile`还原原696,256字节、SHA-256 `79b60b72cddf95eaec6bec7fb3b6a519afba685b47c6ddd0cc01f1d452bc1325`，再沿同一全局900字重Data URL加载。源码主包2,094,813/assistant1,853,163字节，通过未放宽的2MiB硬上限/assistant96KiB预留；这是保守源码计数，不是编译预览大小。当前编译体积/原生包文件加载仍未验，旧字体/几何原生证据只属原绑定。未改字形、样式、路由、API或权限。 Official support: [upload whitelist](https://developers.weixin.qq.com/miniprogram/dev/framework/structure.html#允许上传的文件), [packOptions](https://developers.weixin.qq.com/miniprogram/dev/devtools/projectconfig.html#packOptions), [Brotli file read](https://developers.weixin.qq.com/miniprogram/dev/api/file/FileSystemManager.readCompressedFile.html), [Data URL font](https://developers.weixin.qq.com/miniprogram/dev/api/ui/font/wx.loadFontFace.html).
- 原Admin照片/直播并发挂载现统一前置锁顺序：企业/访问、企业设置、项目。staffLiveAccess在cameraAccess持有项目共享锁前预先锁设置，原摄像头、身份、角色与RLS检查保持。原UI503/PG40P01及修复前受控55P03失败保留；同一固定锁序驱动修复后5/5，覆盖设置阻塞时照片事务仍可取得项目更新锁、enterprise_admin/admin/super_admin并发照片/直播读取及持久重进、跨租户拒绝。受影响原咨询投递回归3/3，cleanup.stopped=true/drift[]。真实Chrome Admin在276项源/配置绑定、drift[]下5/5：首次并发照片挂载、关闭Drawer重进、合成草稿实写和640×360真实视频、暂停10,190ms时钟不变并恢复至1445解码帧/106.382507秒，以及实际停止200/stopped=true且照片版本1仍公开。当前Chrome走原生HLS，Hls.js回退未验。临时播放观察器已还原，合成cookie/标签已清，自有Next/WVP/源/helper已停，活动直播/代理义务0。证据tmp/public-live-package/admin-recovery01/。未改结构、样式、素材、API/schema/权限或生产。定向lint0/0；仅诊断性质的全量lint0错误/30警告和types82与原诊断集合逐项一致、本功能0；这两项未事前建立新的全Admin绑定，不作新的全产品验收。

<!-- public-live-successor01 -->

### 当前预览与媒体传输（2026-11-03）

**既有设计师/作品旅程：限定Implemented（2026-11-04）。** 本次未改产品代码或设计，沿批准D01 notebook README及D02 v5，在390×844（PNG348×752）核验。自有55434/sfp_public_live_eval中，带合成标记的1454设计师5/作品1/当前公开版本3经既有D01深链及真实作品点击打开；当前版本仅一次偏好实写，重进保留，“和小K聊聊”返回原咨询1且保存上下文可见。一次受控503通过原重试恢复；真实撤回后，当前作品/图片读取被拒，两条原生旧入口清除受保护内容。native05为6项固定检查（含2项环境/身份前置）、1542依赖绑定、7张路由核对截图，cleanup true/drift[]；独立已发布作品身份/租户/精确版本服务检查5/5。这仅完成notebook无联系动作的返回路径，不升级推荐模型、gallery/申请联系/人工接续、真机微信或完整光学/字体/编译包体范围。

native01元信息超时、02 TSX setIdentity捕获__name保留为业务前驱动失败。native03属性selector测量null；04已真实保存/重进偏好，但测试边界在任何C01服务调用前拦截必需POST entry-context；原业务失败2次后止损。保存源码/VM及entry-discriminator02复用真实Mini ChatController/AssistantClient和实际assistantHttp：旧边界未调服务即失败，修正后入口/会话/消息200且保存上下文可见，无关模型写入仍被拒。只凭该已证机制重新开放一次原固定范围，失败计数不清零。最终作品1行版本13/公开版本3已撤回；两条已发生的偏好消息33/34分别属于版本2/3，后者supersedes前者，原失败写入不擦除。内存身份/存储钩子/全局状态已还原，临时服务及验收锁释放；final-state核idle队列、活动观看会话/未清代理0、live1/v35/rev137 withdrawn及photo1/v1仍published。新增模型/Embedding/生图均0。证据：`tmp/public-live-package/successor03/{designer-native05,designer-permissions01,designer-entry-discriminator02}/`及`designer-final-state.json`。


开发诊断仅在显式`PUBLIC_LIVE_MEDIA_DIAGNOSTICS=1`时启用，生产忽略。服务端只输出独立trace ID、资源类别、阶段/结果、HTTP状态或null、首个abort来源、耗时和字节；不输出源/能力URL、token、源标识、正文或原始错误。初始授权/数据库异常在调用上游前独立分类；原15秒传输deadline仍从初始授权后开始，每chunk权限检查不变，日志异常不改变交付或对客错误响应。

当前工程证据在`tmp/public-live-package/successor03/`：fast05为7/7（248绑定）、types03为3入口/7581程序依赖/诊断0、lint03通过，media-service02为受控HTTP配合真实隔离数据库/会话/媒体服务的8项。上游404/503、成功改写、caller body abort、真实15000ms超时、连接断开、跨租户/畸形会话上游前拒绝、传输中撤回和元数据不泄密均通过，drift[]。初始授权诊断以media-service02为最终绑定，media-service01属于此前版本。最终live1/v35/rev137 withdrawn、代理历史14条/未清0、活动观看会话0、photo1/v1 published。这些受控服务检查没有启动真实WVP/ZLM源或录像。fast01外层超时、fast02夹具origin/清理挂起、types01测试代码NODE_ENV只读诊断、首次审计模块解析失败及主库连接前置/拒绝均保留，不用后续绿色覆盖原失败。 原types03完整绑定保留；758个生成依赖被外部移除，其当前freshness失效。`tmp/public-live-package/successor04/types01.json`沿未改的完整当前tsconfig补核同3入口：6822完整程序依赖、诊断0、drift[]；另1个仍存在的Next `image-types/global.d.ts`随`next-env.d.ts`移除而不再被引用。完整差异保存在`types-impact01.json`，未重建缓存或重跑业务/模型。

既有真实源审计与播放结论分开：private-audit03观察1454/项目12/绑定9/机位8(v2)的真实WVP通道在线，客户12/context1有效，但私有授权关闭(v12)、临时微信身份不存在；审计保留源指纹/绑定时间，不写设备ID。较早private-audit02的身份null是租户RLS不可见，不是账号过期，已沿平台身份查询纠正。primary-schema01通过既有明确远端Docker context及只读事务确认开发主库有摄像头表、无客户授权表；旧本地5432配置及15432拒绝连接不能证明设备离线。未新开授权、公开真实画面、迁库、改隧道、重启源、PTZ或恢复录像。必要私有正常播放仍未验；独立设计师/作品旅程不依赖该授权/schema缺口。旧CORS后native503仍缺当时上游/abort记录，不能倒用本次受控结果给旧失败归因、清零两轮计数或重开相似native-business03全批。


来源保持C05-02 v002及共享状态。只有当前attempt/version/revision/身份绑定的真实正向时间进度才启用原同意动作；展开、session URL、播放意图或诊断MP4均不产生同意条件。session/解码失败清URL/就绪，重试换attempt并清错误；未变读取保留有效预览，版本/revision/身份变化清展开。已提交结果未知仍保留原幂等键/body核对，不新造决定。

| 触发 | 原反馈/动作 | 恢复与边界 |
| --- | --- | --- |
| 当前申请未展开 | 原完整预览动作；拒绝/稍后可用 | 原咨询读取当前版本 |
| 连接中/有URL但无进度 | 范围可读，同意禁用 | 等待或重试，不产生新同意 |
| 当前预览正向进度 | 启用原明确同意 | 仅当前版本/revision/attempt |
| session/解码失败 | 原离线文案/重试，同意禁用 | 新attempt隔离旧回调 |
| 版本/revision/身份变化 | 清预览/就绪/展开 | 重开当前获权版本 |
| 提交结果未知 | 原待核对反馈 | 只核对原键/body，不新发决定 |

合法形状的媒体GET及其拒绝/失败响应返回Access-Control-Allow-Origin: *，不允许凭据。OPTIONS仅对合法形状的媒体能力路径允许GET及可选Range，不披露媒体/session状态、不授权写入；真实GET/每chunk仍沿原直播/session/来源守卫。[HLS.js原始文档](https://github.com/video-dev/hls.js/blob/master/README.md#cors)要求清单与分片允许GET跨域；这项修正与解码能力及余下首播失败分开。

证据：successor01/client-green01为54/54；target-check02新增未知同意重进后55/55，其原3条CommonJS lint错误保留。target-check03为11/11且lint0；cors-fast01为7/7、lint/types0，253项绑定/drift[]；package-check01为13/13、1263项/drift[]。原驱动路径/缺用例及context工具超时与应用失败分别留存，未重放未变全套或模型试验。

media01 fresh compile后元信息桥接11174ms超时/exit1/killed=false，未安装业务控制器/创建媒体；readiness01因Desktop PowerShell UTF8前置失败，未编译。readiness02按要求只重编译一次：Page.getData10850ms超时而两种wx读取成功；固定page-bridge01随后在相同编译绑定下取得非空真实page data和正元素。这仅证明后续就绪，不归因为延时/焦点；后续复用1180项相同Mini/runtime依赖。

media02仅完成固定机制判别：C05当前范围/同意目标(45,337.90625)–(308,735.796875)，确在实测y99–736裁切区，同意禁用。真实HLS为networkError/manifestLoadError/code0；同源合成MP4进度0.256262秒且仍不能同意。直接清单/分片200，160364字节、无声Constrained-Baseline H264640×360且首帧解码成功，不能认定不支持编解码。hooks/临时资产/控制器均还原，未同意/发布。

CORS后native-business01进入分片请求但业主预览就绪仍失败。window01用同一真实员工会话验证即时分片200/336144字节，另一个当前最旧分片延迟5秒为上游404/public_live_media_unavailable。仅自有已迁移ZLM运行时segRetain1→10（直播索引/时长不变）后，native-business02仍在同一期望失败，两轮止损；1524源/配置结束drift[]，运行时10批内不漂移，实际分片200与清单503共存。两批均未进入同意/发布/公开播放/暂停/503恢复/停止目标；下一次须用真实上游HTTP/abort结果及CORS后的SDK错误判别，不做第三轮相似业务试跑，不弱化守卫。归属公开直播媒体传输，Agent/知识无变更。

ZLM当前位于已记录Docker context sfp-remote-dev、容器8aac1f73…及远端D实际挂载；不是本机Docker。挂载配置与原夹具字节一致，未重启容器/动SSH/隧道/F。失败保留窗口实验已凭回执与回读恢复1，本地镜像/tsconfig/next-env恢复原字节。自有授权/代理/job/控制器清空，保留代理总12，photo1/version1仍published。原3353源/20证据及全部失败/unknown保持，外部camera提交676be882及差异保留；新模型/Embedding/图片0，旧9图金额unknown。整个V1-04（含本人项目直播及设计师作品旅程）仍Limited，独立交付只沿唯一计划第2节。

<!-- /public-live-successor01 -->
