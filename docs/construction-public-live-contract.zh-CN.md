# 施工公开直播合同

英文镜像：[construction-public-live-contract.md](./construction-public-live-contract.md)。执行及实际状态只维护在[小K唯一计划](./xiaok-renovation-agent-development-plan.md)第2节；本文是运行时合同，不是另一份任务队列。

当前Limited：独立授权、无声代理和客户端状态已接线，尚未完成原用户旅程。历史service04六项/HTTP02三项证明当时媒体与状态范围。boundary01原投递失败保留；现复用ActorContext/原参与者的修复已通过delivery-service01三项真实服务检查；Admin02仅证明状态写入/重进，SQL独立边界五项通过。原生01–06未进入业务，当前Mini32/34有两项包体失败，类型保留82继承诊断。本合同同时保留要求与当前缺口，不能把状态成功当投递或播放成功。真实摄像头公开和生产部署未授权。

## 入口与设计

- `/construction-projects` → 项目Drawer → 原公开材料Tab → **直播公开**，沿Ant Design Form/Select/Card/Steps/Alert与共享操作反馈。摄像头管理者及所选企业管理角色可准备合法绑定、公开名称与机位别名，普通观看成员不能准备。只有`enterprise_admin`、`admin`、`super_admin`可审核当前业主的这一版同意；平台管理无需入职或成为项目成员。
- 业主在既有私人客户咨询收到持久服务事件。`liveEvent`锁定该咨询及有效原客户参与者，再以已认证调用者ActorContext复用既有system消息写入；不关联全局用户表、不伪造接收者身份。发送目的地缺失则失败回滚；终止撤权在目的地关闭时仍有效。原生卡设计先展开完整画面、受众和范围，再明确同意/拒绝/稍后；阅读、普通回复及沉默不构成同意。同意只进入待企业审核。重进读取实际保存版本、revision和当前关系。
- `packages/construction/public-site/public-site`及原Agent详情纸页在当前批准存在时显示独立直播入口。`packages/construction/public-live/public-live`仅一个16:9完整画面，真实连接/播放/暂停/失败反馈、别名、全屏及返回/本人咨询动作；不提供进度条、音量、PTZ、抓拍、录像下载或历史回放。
- 批准源为`design-references/xiaok-p4b-public-sites-v1/README.md`，Agent风格C03-04/C03-05 v001及C05-02 v002，853×1844映射390×844。普通状态复用共享规则；精确16:9组件规格优先于生图的近似画框。纸页、书脊、装订、布签和控件均为原生代码，不切片整屏。复用既有独立F1头像并优化PNG编码，原件/比较保留于`tmp/public-live-package/avatar-*`。

## API与数据

| 调用者 | 入口 |
| --- | --- |
| 所选企业cookie | `/api/construction/public-live/:projectId` GET读取、POST保存；POST `submit`、`publish`、`reject`、`withdraw`、`session`、`reconcile` |
| 原咨询业主bearer | `/api/miniprogram/assistant/public-live/:conversationId` GET；POST `:liveId/preview`、`approve`、`decline`、`later`、`withdraw`、`session` |
| 匿名 | `/api/public/construction-live/:enterpriseId/site/:publicPhotoSiteId` GET当前入口；`/:publicKey` GET安全元数据；`/:publicKey/session` POST；`/:publicKey/media/:token/:resource` GET |

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

原生自动化在业务执行前阻塞。native05（异步封套）和native06（同步定义对象封套）均在fresh compile后无法取得当前wx运行信息回执；06在finally已停止合成授权/代理，依赖无漂移，尚未安装控制器。较早独立元信息/对象封套判别成功只证明较窄条件，不能当业务验收。归属原生验收驱动；共同原因假设为编译前后evaluate回执/通道条件，尚未证实，单改封套并未解决。保留精确CLI trace，先离线比较原成功判别与05/06，再考虑有机制依据的重开。最新用户指令为“正常开发继续，仅重复试修止损”，工程包数不停止正常开发；同一原生期望已失败两轮，须先做机制判别，不继续封套/重编译采样。授权实际点击、原生播放、重进、重试/停止与光学校验仍未执行；独立Admin、清理和静态检查可串行继续。

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
