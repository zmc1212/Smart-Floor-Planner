# 云工地视频开发计划

**当前真实长测终态：FAILED，不计24/72小时通过。** `2026-10-23T07-33-15-912Z` 于2026-10-23T13:27:40.462Z结束，共5.8866小时/350次观测；原错误 `camera_service_auth_failed`，策略状态实际为error而预期recording，passed/soakPassed=false、milestones为空。已完成5次小时封口私有回放206/匿名401；原G盘停止/烟测及独立功能证据仍分别保留。

- 控制器自清理将自有策略39关闭为版本40，enabled=false/state=stopped。`tmp/cloud-camera/soak-terminal-2026-10-23T14-05-39-367Z.json` 独立确认实际ZLM MP4=false，6段封口索引含尾段、47项前后绑定无漂移。末段13:27:37.713Z封口，无隐藏活动MP4。WVP/ZLM/探针/Redis/MySQL共享服务仍运行，故障时未重启；原46源码/配置及3固定镜像/挂载身份一致，F盘健康，此次不是空间耗尽。
- 只读判别用假transport复现适配器当前机制：首次401清空缓存token并让当次请求失败，下一次独立调用才重新登录；没有真实WVP登录、计划/摄像头变更或录制重启。这证实当次恢复缺口，凭据失效的上游原因（到期或其他）仍未核验，本次未修改冻结适配器。诊断脚本首次模块解析设置失败发生于DB/网络调用前，修正后核验通过，不记作长测验收。
- 原 `soak.json`、时间戳批次与失败/进程日志完整保留。录像仍在批准的F盘私有保留范围，旧G盘批次仍排除。原独立功能回执的策略39/运行中表述是终态前观测，当前状态以本终态为准；24小时、72小时、自然到期和最终连续覆盖均未通过。不加速时钟、不自动重跑；记录终态后停用automation-4，下一交付为有界鉴权恢复及新验收批次。


### 1.8 只读录像清理明细（Implemented）

- 已核实缺口/入口：容量预览原先只有清理数量，无法定位对应录像。负责人现在可在原项目视频页打开“清理记录”。设计源为双语 Admin Ant/重构合同及既有运行记录弹窗：宽760，复用Modal/Table/Alert/Empty，正文/表格内滚并保留关闭按钮。Mini/H5及插画不变。
- GET `/api/construction/video-cleanup/projects/:projectId/bindings/:bindingId` 复用租户事务/摄像头访问。仅enterprise_admin/admin/super_admin可读有效启用绑定，平台管理者在所选企业无需入职/项目成员。拒绝经理/成员、跨项目/租户/绑定、退役/禁用绑定和Mini bearer冒充。可选 `beforeId` 为正signed-bigint游标；非法ID、未知/重复参数422，POST405，no-store。
- 按登记ID倒序20条加前瞻，读取既有 `app.construction_recordings` deleting/deleted/missing，排除ready。仅返回源时间、精确十进制字节、保存状态、仅deleted的已记录完成时间及安全失败原因，不返回上游ID、路径或原始错误。按北京时间及B/KB/MB/GB显示。此为当前状态，不是删除事件时间线、推断重试次数或新的物理文件检查；missing本身不证明本模块删除文件。不改schema，不写策略/录像/审计，不调WVP、不改Worker，无手工删除/重试动作。
- 复用加载/空/错误重试、刷新及最新页重进；更早页失败保留行，重试追加。关闭中止读取，项目/绑定key隔离，源/错误过滤及原真实录像/清理机制保持。
- 最终证据：`tmp/cloud-camera/cleanup-check-2026-10-23T11-52-29-939Z.{json,log}`，隔离 `cloud_camera_cleanup_eval` 9/9、57稳定绑定；有标识写入/读回/清理，两租户均有数据，三类负责人、权限撤回/RLS、同时间分页/重进、真实空绑定及策略/录像/审计不变。`cleanup-http.json`：3018真实HTTP11/11、54稳定绑定，策略开启/3天/版本39不变。最终49入口类型/定向lint通过。`cleanup-validation-final.json`：1155源码/配置绑定稳定；全量lint仍仅固定hls/mpegts分发文件161错误，构建编译成功后仍被既有 `AiDesignerLegacyPage` 导出类型阻断，均不称全量通过。更早构建在类型阶段超时，单独保留。
- `cleanup-ui.json`：10项/57稳定绑定。正常页读取两条此前真实删除的保留验收记录14.3/14.2MB。空/25行状态及分页响应明确为客户端专用fixture，不算物理删除或长测证据；真实服务分页/空态由隔离库覆盖。更早页失败保留20行，重试追加5行。1280×720长正文460/按钮底656；663×892正文632/按钮底836，700表格在584内横滚，页面无溢出。截图：`admin-recording-cleanup.jpg`、`admin-recording-cleanup-error.jpg`、`admin-recording-cleanup-empty.jpg`、`admin-recording-cleanup-narrow.jpg`。Fetch/网络/视口覆盖已清除，恢复真实两行重进并关闭页签；初始GB舍入及浏览器定位/关闭动画/拦截观察保留在回执。 浏览器实际返回JPEG，扩展名已核对修正；最初未完成绘制的空态帧保留为`admin-recording-cleanup-empty-before-paint.jpg`并排除。`emptyRecheck`补充核验刷新按钮已结束加载、空态可见并重拍，源码绑定稳定。 补充空态JPEG为1920×863；窄屏稳定重拍为663×892、真实两行/按钮底506，上述25行滚动界限仍取原客户端fixture的DOM回执。最初663×373窄屏帧保留为`admin-recording-cleanup-narrow-before-paint.jpg`并排除，`narrowRecheck`记录重拍与稳定源码。
- 从admin重跑：`node scripts/construction-camera-cleanup-check.mjs`；既有真实fixture HTTP：`node --import tsx scripts/construction-camera-cleanup-http.ts`。同一74小时控制器、46冻结录像文件、策略39/区间33、F挂载及录像/探针配置不变。前4次每小时私有206/匿名401，24/72小时/自然到期待验；automation-4仍留原验收聊天。下一项为实际长测节点，稳定边界后继续CV-04其余依赖。SD/生产暂停。

### 1.7 只读每日录像覆盖（Implemented）

- 已确认缺口/用户结果：负责人原来能查策略/存储事件，不能直接核对每天已入库覆盖和区间内缺口。原工地视频新增“录像覆盖”，复用已批准Ant Design Modal/Table/DatePicker/Alert/Empty及运行记录弹窗的760px/正文滚动方式；无Mini/H5、插画或还原台账变更。
- GET `/api/construction/video-coverage/projects/:projectId/bindings/:bindingId?day=YYYY-MM-DD` 复用原租户事务和camera access，仅enterprise_admin/admin/super_admin可读有效且启用的绑定，平台管理在所选企业无需入职/项目成员。经理/成员、跨项目/企业/绑定、历史/停用绑定及Mini bearer冒充Admin均拒绝；必须恰好一个day，未知/重复/非法参数和ID返回422，POST405，no-store。
- 日期为北京时间；区间沿私有回放采用视频源时间，只读精确绑定下ready封存记录，保留原最早时差边界的保留期检查。跨午夜片段纳入后按所选日截取；重叠/相接合并不重复计时，保留毫秒，只报告两个已知区间之间的未覆盖。不能据此推断日期两端缺口、停机原因、正在录制未封存部分、物理文件可播或长测通过。最多读1001条，超过时仅统计前1000条并明确“部分统计”；仅返回日期/时间/数量/时长，不返回路径、上游ID、凭据或原始错误；不改schema/迁移、策略/WVP调用和Worker。
- 加载、空、错误重试、日期切换、刷新和重进沿原控件。关闭中止读取，项目/绑定key隔离状态；重进选今天，刷新/日期切换回第1页。短视口正文/表格内部滚动，底部按钮可见。
- 最终证据：`tmp/cloud-camera/coverage-check-2026-10-23T11-29-30-832Z.{json,log}`，隔离 `cloud_camera_coverage_eval` 10/10、59绑定无漂移，含合成真实写入/回读/清理、两个租户均有录像/三种负责人、拒绝路径、午夜/重叠/缺口/时差过期、空/重进、1000条部分上限及策略/录像行不变。最终夹具先以平台读取确认他租户行确实存在，再验RLS不可见，未改产品字节；`coverage-http-2026-10-23T11-25-43-644Z.json` 真实3018 HTTP 11/11、55绑定无漂移，策略仍开启/3天/版本39。最终42入口类型及定向lint通过；全量lint尝试仍仅固定hls/mpegts发行文件161错误，构建尝试已编译后仍受原 `AiDesignerLegacyPage` 导出类型阻断，均不是全量通过；最终格式修正由最终定向检查/HTTP/UI覆盖。
- 页面：`coverage-ui.json`，5项/51绑定无漂移。当日此前测试实际23片段合成21区间，覆盖3小时20分35.055秒、区间未覆盖2小时11分13.678秒；这不是本次长测的连续性结果。1280×720下宽760、正文460、按钮底656/弹窗底676，无页面横向溢出；663×892下按钮底836/弹窗底856，650px表格在584px容器内滚动。截图：`admin-recording-coverage.png`、`admin-recording-coverage-empty.png`、`admin-recording-coverage-error.png`、`admin-recording-coverage-narrow.png`；已验失败重试、空、关闭重进及第2页→刷新第1页。临时请求拦截/视口已恢复，标签关闭。首次Bun驱动失败保留于11-14-36日志/回执，明确Node重跑通过；首次时间仅显示小数位已修正为明确时分秒，UI回执保留原观察及关闭动画时驱动重试，未混作一次无失败通过。
- 从 `admin` 复测：`node scripts/construction-camera-coverage-check.mjs`；真实夹具只读HTTP：`node --import tsx scripts/construction-camera-coverage-http.ts`。同一74小时控制器、46冻结文件、策略39/区间33和录像/探针配置不变；前3小时私有206/匿名401，24/72小时/自然到期待观察。既有每小时automation-4仍ACTIVE并留在原录像验收聊天，未重复创建或改目标。SD/生产暂停；下一项仍是真实长测检查点，稳定边界后再评估CV-04其余依赖。

### 1.6 只读录像运行记录（Implemented）

- 已确认缺口/用户结果：原工地视频只有当前录像/存储状态，没有负责人可读的持久历史。“运行记录”复用已批准Ant Design Table/Modal/Alert/Empty，不引入新视觉方向或Mini/H5改动；负责人可查看策略意图、存储等级变化、时间、安全来源标签，加载更早记录、刷新及重进。
- GET `/api/construction/video-activity/projects/:projectId/bindings/:bindingId` 只读原 `app.construction_audits`；可选 `beforeId` 为正数signed-bigint游标。仅负责人管理角色可读，含admin/super_admin在所选企业继承、无需入职/项目成员；复用共享租户/项目检查并要求当前有效且启用的摄像头绑定。经理/成员、跨项目/企业/绑定、历史绑定被拒绝；未知/重复查询参数或非法ID返回422，POST405，响应no-store。
- 按租户/项目/精确绑定及原有六类action过滤：recording.configure、storage.ok/warning/critical/blocked/unavailable。按审计ID倒序每页20条、多读1条判断下一页，同时间记录不重不漏，不返回其他绑定总量。仅输出ID/时间、管理/系统/未记录来源、校验过的开关/1..30天、0..100百分比及白名单原因；不暴露原始snapshot、人员身份、路径或错误细节。历史缺失字段仍未知，容量不可用事件的百分比标为“最近已知”。事件表示策略意图/保护判断，不是已确认录制启停回执；不补造历史，不新增schema/迁移、策略写入、WVP调用或Worker。
- 状态/恢复：沿原加载、Empty、错误Alert/重试；更早页失败保留已读行。关闭中止未完成读取，项目/绑定key隔离旧视图，重进从最新页开始。入口仅在原负责人录制设置旁，短视口沿Ant弹窗正文滚动保留底部按钮。
- 证据：`tmp/cloud-camera/activity-check-2026-10-23T09-34-02-438Z.{json,log}`，隔离 `cloud_camera_activity_eval` 8/8、57绑定无漂移，真实合成写入/回读/清理、双租户/三种管理角色、经理成员拒绝、同时间ID分页/重进、空/非法字段及策略/审计不变；`activity-http-2026-10-23T09-34-42-937Z.json` 真实3018 HTTP 11/11、54绑定无漂移，策略前后均开启/3天/版本39。35入口类型与定向lint通过；全量lint仍固定vendor161错误，隔离构建已编译、类型校验仍受原 `AiDesignerLegacyPage` 导出阻断。最后“最近已知值”格式调整已由最终测试/类型/lint/HTTP覆盖；未变Mini/H5/原生范围复用原证据。
- 页面：`tmp/cloud-camera/admin-recording-activity.png`，1280×720、宽760、正文滚动高460、按钮底656/弹窗底700，无横向溢出；真实20→40条保持唯一且保留前20条，关闭重进恢复20条。663×892下底部按钮也在视口内，长内容沿表格内部横向滚动；小程序还原台账不变。从 `admin` 复测：`node scripts/construction-camera-activity-check.mjs`；真实夹具只读HTTP：`node --import tsx scripts/construction-camera-activity-http.ts`。
- 同一74小时控制器继续运行，46冻结源码/配置和策略39/区间33不变。前2小时封口片段私有206/匿名401；24/72小时/自然到期仍待观察。SD/重启/格式化及生产继续暂停；需改冻结录像依赖的剩余项等待稳定验收边界。

### 1.5 只读保留容量预览（Implemented，独立于当前长测）

- 入口/设计源：原 `/construction-projects` → 项目Drawer → 工地视频 → 录制设置，复用已批准Ant Design Modal/Form/Alert。短视口只滚动弹窗正文；宽520，1280×720下按钮底656、弹窗底700，无横向溢出。Mini/H5标记、素材、路由及还原台账均未改动。
- GET `/api/construction/video-capacity/projects/:projectId/bindings/:bindingId` 复用共享租户事务与原camera access；仅负责人管理角色可读，admin/super_admin在所选企业继承，无需入职/项目成员。经理/普通成员、跨企业/项目/绑定、历史绑定被拒绝；拒绝多余查询参数，无写接口、WVP调用、新schema或迁移。
- 对当前绑定最近24小时内最多12段ready封口录像，累计字节除以实际片段时长求平均码率，至少60秒；陈旧/未来/缺失/已删除/待删除片段不参与码率。未知为null。用整数计算十进制GB/天和所选1..30天预算，另列25%规划余量；界面仍沿当前节点1..7天保存上限。预览不保存、不执行容量配额；登记存量及待清理/失败数只读，不暴露原始路径或错误。此项不是剩余可录时长预测。
- 证据：`tmp/cloud-camera/capacity-check-2026-10-23T08-48-34-399Z.{json,log}`，隔离 `cloud_camera_capacity_eval` 9/9、57源码/配置绑定无漂移；`capacity-http-2026-10-23T08-49-51-910Z.json` 真实HTTP 6/6、54绑定无漂移，策略前后均开启/3天/版本39。28入口类型和功能定向lint通过；全量lint仍仅固定hls/mpegts发行文件161错误，构建已编译、仍被原有 `AiDesignerLegacyPage` 非法导出阻断类型校验。首次effect同步重置lint错误已修正；HTTP驱动默认导入首次尝试在请求前失败，改为具名导入后通过。
- 页面证据：`tmp/cloud-camera/admin-capacity-estimate-3days.png`、`admin-capacity-estimate-7days.png`。实测0.910Mbps、约9.8GB/天；3天29.5GB/含余量36.9GB，7天未保存预览68.8GB/86.1GB；取消后重进仍3天。加载/不足/失败重试沿同一Alert，不禁用原保存；上述为当次样本，不是固定未来码率。
- 真实74小时批次的46个冻结源码/配置、录制策略39/区间33、F盘挂载和录制/探针镜像未改变。首小时封口片段私有回放206、匿名401；24/72小时和自然到期仍待观察。新增只读文件位于冻结绑定之外。SD继续暂停；需改冻结依赖的录制/默认值/授权/抓拍保留项等待稳定验收边界。

English mirror: [cloud-construction-video-plan.md](./cloud-construction-video-plan.md)

更新：2026-10-23。**真实74小时批次在5.8866小时因 `camera_service_auth_failed` 失败，已确认关闭其自有录制。** 云录像/私有回放、恢复、容量保护及负责人只读运维保留有界开发证据，整体Limited；24/72小时/自然到期均未通过。保留失败批次，不自动重开；SD暂停，不部署生产。

## 1. 当前交付记录

| 项目 | 内容 |
| --- | --- |
| 当前ID | CV-04真实74小时批次失败并已安全停录；容量保护/负责人只读运维仍限定Implemented。下一缺口为鉴权恢复，SD暂停 |
| 用户结果 | 负责人在原工地视频管理录像/保留天数，核对容量、策略/存储历史、每日封存覆盖及每段清理状态；员工继续H5直播/私有回放及重进 |
| 技术方向/基础 | Mini web-view + H5；mpegts.js1.8.2/FLV、hls.js1.6.13/MSE/原生HLS，复用WVP/ZLM、施工项目/成员/租户权限，不依赖live-player |
| 实际状态 | F盘批次2026-10-23T07-33-15-912Z于10月23日21:27:40运行5.8866小时/350观测后因camera_service_auth_failed失败。控制器564360已退出，自清理将自有策略39关闭为40，enabled=false/state=stopped、区间33。22:05独立ZLM核验actualRecording=false；6段封口索引、前5次小时私有206/匿名401。46冻结文件及3镜像/挂载不变，F盘容量正常；24/72小时/自然到期未通过 |
| 完成检查 | 清理9项隔离/57稳定绑定、11项真实HTTP/54、10项UI/57，最终49入口类型/定向lint通过；真实两行界面、隔离库25行分页/空态及明确客户端专用UI变体。策略39/3天及46冻结文件不变。全量lint/构建仍既有vendor/旧页面阻断，1155稳定绑定；原覆盖/运行记录/容量/Mini/H5/原生仅按未变范围复用 随后真实74小时批次失败，5次小时检查不计24/72小时验收；独立终态核验确认策略40关闭且实际MP4停录，401恢复机制仅用假transport复现。 |
| 未核验/未实现 | 本批失败，真实24/72小时/自然到期均未通过；有界WVP401恢复尚未修复。SD、多路、企业默认、客户授权/抓拍保留、实机PTZ/断电断网/服务重启、HTTPS/微信/公网4G/生产等按下文范围仍待验 |
| 下一ID | 修复并验证有界WVP401鉴权恢复，再以新源码绑定/新run ID重新开展真实74小时验收。本次heartbeat不改冻结源码/配置、不重开录像；保留失败批次，终态文档后停用automation-4。换卡后再测SD，不启用生产/4G |

设计/实施源：2026-10-22用户批准单路H5/云工地配色、摄像头切换、抓拍历史及云台，去掉源地址/诊断。当时排除录像；2026-10-23进一步明确批准在播放器下加入直播/回放切换、日期、真实片段、返回直播，空/失败沿用既有反馈。当前实现保留此层级和配色，无截图切片/新增插画；Admin沿双语Ant Design/refactor合同。不能将空查询或接口完成记为SD支持。

### 1.1 当前实现合同（优先于后文尚未实现的完整提案）

- Admin `/construction-projects` 原Drawer“工地视频”：平台管理员在所选企业分配已验证WVP通道；负责人/经理绑定解绑/抓拍/已开放云台；只有负责人管理角色保存云台和录像策略，含admin/super_admin继承，无需入职/项目成员。有效普通成员只观看；客户授权尚未实现。
- Mini `packages/construction/projects/projects` → `packages/construction/camera/camera` → H5 `/construction-camera`。一次性入口30秒；独立HttpOnly/SameSite=Strict cookie/CSRF同源会话，观看/会话租约60秒、心跳20秒、绝对4小时。隐藏/退出关闭本观众传输；重进新入口，迟到入口丢弃。
- 员工API：Admin `/api/construction/video`、Mini `/api/miniprogram/construction/video`，`register`、`inventory`、`projects/:id/{inventory,cameras,binding,configure,recording,entry}`。POST recording仅负责人管理角色可写，版本控制/相同设置幂等，默认关闭、3天，整数1..节点上限（当前7天），不超过WVP节点自身保留；经理/成员不能开启持续上传。4G工地保持关闭，SD尚不可用。
- H5 `/api/construction-camera/{exchange,state,heartbeat,stop,live,snapshots,ptz,recordings/query,playback}`、私有图片 `/snapshots/:id`；直播网关 `/camera-media/:generation/*`、私有MP4 `/camera-recording/:generation/:recordingId.mp4`，支持单Range/HEAD，不暴露源地址/路径/凭据。请求及传输中每5秒重验项目权限/租约/代次/录像保留窗口；撤权/停止/切换使旧媒体失效。
- 0090为设备/绑定/入口/会话/抓拍/停止义务6张强制RLS表；0091新增策略/封口录像2张强制RLS表及会话recording_id复合FK。录像按原绑定/启用区间导入，迁移设备后归原项目，跨绑定边界片段不认领；历史与新项目录制互不干扰，不覆盖外部录像计划。
- 0092新增强制RLS录制区间表及持久补查游标。重新开启新建所属录制区间，保留旧区间并排除停录缺口；增量按源开始时间推进，每10分钟完整补查节点保留窗口，持久保存快照/页码，每tick最多2×100条。迟到/乱序封口可补入，重复/已删记录不复活。策略保存与Worker在绑定行锁之前共用同一advisory锁，修复实测锁顺序反转。
- 0093分离媒体节点私有直连HTTP-Date/源时间与数据库业务时间。开启前及实际停止后采样有界时差，仅有校准证据的区间可新增认领；绑定检查使用保守时差界，最早可能开始时间决定访问到期，最晚可能结束时间决定物理删除。同绑定区间重叠时保留完整可能时差，不放宽跨工地边界。缺少可信时间或时差超过60秒时拒绝认领；旧区间不猜测补写，已索引历史仍可用，旧的开放区间须关闭确认停止后重开取得校准。
- 关闭时先撤下本模块所属计划，再做时间/索引诊断。校准异常仍保留可见error并拒绝未核实导入/停止确认，校准恢复后Worker确认停止/关闭区间；诊断依赖不能让用户已关闭的写入持续运行，外部计划仍不触碰。
- CV-04容量实施：0094新增平台专属强制RLS节点健康表及租户策略健康级别/转换审计。私有Python statvfs探针只读挂载实际既有ZLM媒体卷，无Docker socket/文件内容接口。80%预警、90%紧张、95%或可用<5GiB或已报告空闲inode<128时暂停所属写入；恢复须<90%、可用≥8GiB且已报告空闲inode≥512。未知/过期/非法指标按保护处理；保留原启用意图、外部计划、直播/私有历史及有效保留窗口，明确关闭后不自动重启。后台复用批准的Ant Design Alert/状态，仅负责人管理角色获原始指标；H5复用原录像反馈显示本租户已确认暂停原因。保护依赖运行中的对账Worker，不是硬件磁盘看门狗。
- 兼容固定WVP2.7.4 commit3fcd3ae80c30c95aeb82ef830af439a835257067：[RecordPlanServiceImpl](https://github.com/648540858/wvp-GB28181-pro/blob/3fcd3ae80c30c95aeb82ef830af439a835257067/src/main/java/com/genersoft/iot/vmp/service/impl/RecordPlanServiceImpl.java)有观众时保留流，[PlayServiceImpl](https://github.com/648540858/wvp-GB28181-pro/blob/3fcd3ae80c30c95aeb82ef830af439a835257067/src/main/java/com/genersoft/iot/vmp/gb28181/service/impl/PlayServiceImpl.java)复用就绪流，计划关联不能代表MP4实际启停。重新确认所属计划成员后，私有ZLM startRecord/stopRecord（type1、精确app/stream）须result=true及isRecording确认；开启直播也在同锁内守卫录制意图/保护。外部计划保留，容量保护不关闭整条直播流。
- 独立5秒对账恢复应录通道；只有ZLM实际状态确认后才显示recording/stopped。解绑须先关闭且确认stopped。每10分钟认领过期封口记录，deleting→真实文件404/410且WVP索引消失→deleted；失败留错误重试，不删除仍有有效观看租约的文件。企业清理在录制/媒体未完成时拒绝，防止丢失物理文件归属；暂停项目如保留enabled意图，删除前需恢复可管理状态并显式关闭。
- 当前MP4节点分段上限3600秒，非后文提案5分钟。跨保留边界整段不可访问，整段到期后才删除，有一段粒度偏差；扫描最多30个候选/次，失败可形成积压。日期最多300段；只有≤1秒连续区间自动切下一段，缺口需手选，无时间轴/跨日自动跳转。选择按项目在localStorage保留，重进不自动播放。企业默认仍未实现。
- 私有JPEG bytea≤4MiB，pending/ready/failed/幂等持久化并每次鉴权，最新30张；尚无自动抓拍保留，录像三天不适用于抓拍。PTZ默认关闭，仅方向/STOP，300ms脉冲、2秒持久停止义务、独立500ms watchdog重试未知STOP；800ms为HTTP超时，不是设备物理停止保证。实际转动/变倍未证实。

### 1.2 配置与复测

1. 只在获授权数据库应用0090–0094；Next/独立Node-tsx网关共用DATABASE_URL，`cd admin && npm run camera:gateway`。未自动加入生产Docker。专属cloud_camera_eval/cloud_camera_unit_eval沿既有127.0.0.1:55432→获授权远程验收PostgreSQL15433转发（见remote-development双语记录），属于隔离数据库而非本机PostgreSQL；Next3018/网关3017不切3006/生产。恢复/时差迁移在停录时应用，不能猜测旧区间校准。
2. 服务端配置CAMERA_WVP_ORIGIN、CAMERA_MEDIA_ORIGIN、CAMERA_WVP_USERNAME/PASSWORD、CAMERA_PUBLIC_ORIGIN、CAMERA_APP_ORIGIN；生产PUBLIC_ORIGIN必须HTTPS，网关默认127.0.0.1:3017。反向代理关闭媒体缓冲、原WVP/ZLM端口只对内、小程序登记HTTPS业务域名，尚未生产实施。
3. 录像额外配置CAMERA_ZLM_SECRET、CAMERA_MEDIA_SERVER_ID、CAMERA_RECORDING_ROOT、CAMERA_NODE_RETENTION_DAYS；本地对应私有secret、wvp-zlm-01、/opt/media/www/record、7。节点启动必须设`api.downloadRoot=/opt/media/www/record`，不能用/放宽；ZLM禁止热改。已修复仓库外`G:/workspace/向总/wvp/docker/zlm/start.sh`并仅重建/重启本地zlm、保留媒体卷，分发节点须同步该修正。
4. `construction-camera-check.mjs`迁移专属cloud_camera_unit_eval并运行37项，不与真实STOP worker共库；`--runtime-schema`仅迁移真实隔离库。`npm run check:camera`校验21个类型入口/依赖。`construction-camera-local.mjs`从CAMERA_LOCAL_WVP_ENV加载已授权WVP环境，`--gateway`/`--fixture`启动服务/合成数据；凭据仅忽略目录。
5. `--recording-check`实际录制后finally关闭；加`--playback-only`只复验已有回放。`--retention-check`加速到期并删除专属测试库最早封口测试录像、保留较新片段，拒绝其他数据库。`--recovery-check`限定标记的隔离项目且无其他观众，只断开所属媒体流/重启核验过的3017进程，确认实际写入/Worker/片段回放，finally关闭；正常检查不由驱动直接对账、不操作SD。前后绑定源码/媒体镜像并核验未新增数据库死锁。`construction-camera-native.mjs`沿Stable单控制器/锁/精确项目/副屏纪律；真实PTZ脚本只用于授权设备。停服务前排空STOP，业务回退不删除历史媒体。
6. `node scripts/construction-camera-storage-local.mjs`核验既有卷及精确录像覆盖挂载；Windows拒绝仅凭Docker卷内余量，私有只读探针须与ZLM同源宿主bind，实测总量/可用须匹配原生statfs。storage-deployment.json记录physicalCapacityVerified，无Docker socket/宿主文件内容API；服务端CAMERA_STORAGE_ORIGIN/TOKEN/MEDIA_VOLUME仍共用。
7. `construction-camera-local.mjs --storage-check`以带鉴权的模拟容量/故障核验真实MP4/直播/私有回放，不填满磁盘；`--ui-hold`供串行渲染QA/程序化完成，不是人工批准门槛。finally恢复真实指标/网关并关闭所属测试策略。
8. `--soak-check --smoke`真实3分钟；`--soak-check --background`隐藏启动74小时。`--soak-control`核验PID，`--request-stop`写本次标记，`--cleanup-orphan`拒绝存活控制器/其他fixture/已变启用策略，确认MP4实际停止。46源码/配置及3镜像/挂载绑定，每分钟观测（盲区≤120秒）、Worker新鲜/实际在录、封口缺口≤2秒、每小时私有206/匿名401、24/72小时覆盖及自然三天文件/索引真实消失；不加速时钟。本机/Docker/转发/服务须运行，automation-4每小时跟进本对话，无变化安静。
9. F盘：所属写入关闭/确认停止后先复制/hash校验，沿原wvp-stack项目/环境合并既有WVP compose及admin/docker-compose.camera-media.local.yml，设CAMERA_RECORDING_HOST_PATH=F:/SmartFloorPlannerCamera/media/record，仅up -d --no-deps zlm，不重启摄像头/其他服务。探针自动合并docker-compose.camera-storage.host.yml。旧media-data卷作固定回退副本；回退须停录/完整校验新增媒体复制，不能直接撤覆盖挂载。先前0.913Mbps样本估算74小时≈30.4GB/28.3GiB（另留余量），三天到期从F盘删整段；Docker稀疏VHD内可用不等于Windows物理余量。

### 1.3 当前证据、原失败与限制

- verification.json（15:12:51–15:15:33）：219绑定无漂移，37服务/适配、19Mini、21类型入口/0错误、定向lint/H5语法及当时2探针测试通过。后续源码仅server.py/宿主compose/测试明确Windows inode证据，3项探针对应复验通过；JS/租户/归属行为未变。native.json（15:22:59–15:23:43）：227绑定无漂移，Stable2.02.2608080/SDK0.13/base3.17.2原生5项通过；新就绪/拒绝截图已审看，逻辑390×844/PNG348×752，只证入口/反馈，不计微信真机H5解码。孤儿清理另验真实MP4停止，保留外部新意图。
- 既有提交c1956a90（直播）、f4830650（云录像）、0606b960（SD证据）、814e5cf3（恢复），未变证据按范围复用。完整webpack构建50秒编译后被既有AiDesignerLegacyPage非法路由导出阻断（build-2026-10-23T06-54-21-925Z.log）。全量lint首次误扫隔离构建产物后停止，仅排除.next-camera/.next-camera-build重验执行完成：未改动固定hls/mpegts第三方包161错误，全库2366警告（source-lint-20261023-145828.log），本轮自有源码无错误；定向lint/类型通过，不宣称全量lint/build通过。
- `recovery-live-2026-10-23T05-28-02-460Z.json`/`recovery-live.json`：4项真实检查通过，210个源/配置/镜像绑定无漂移，数据库死锁1→1，清理后关闭/已停止/3天。只断开所属rtp流，4431ms自动恢复；网关替换10060ms恢复且WVP继续写入；新增片段05:28:09及05:28:25UTC开始，私有Range206/MP4头、匿名401，旧历史仍可访问。正常检查依靠独立Worker，直接对账仅用于清理，无SD请求。
- 保留各次原恢复失败：05:01驱动缺必需schema，05:03真实保存/索引死锁（recovery-deadlock.txt），05:10过早观测网关就绪，05:13数据库/媒体时差导致首段排除。分别修正schema/result0、advisory先于行锁、健康及服务器checked_at新值、媒体区间校准，未放宽绑定边界。首轮时间回归还暴露同绑定时差重叠，现保留保守min/max界；原失败不与最后通过批次合并。
- 最后停止顺序保障增加第28项服务回归：时间证据缺失仍先撤下已关闭的所属写入，恢复后确认停止。`recovery-live-2026-10-23T05-37-17-277Z.json`为该修正后的最终4项/210绑定检查：断流6256ms、网关10165ms恢复，新增05:37:22/05:37:38UTC片段，私有206/匿名401、死锁1→1、清理关闭/已停止/3天。05:28通过批次保留为先前校准机制及浏览器片段证据，其实际恢复时间为4431ms/10060ms。
- `recording-live-2026-10-23T04-07-26-578Z.json`证明实际开启、无人观看120秒（超原90秒无人观看超时）、关闭/封口；该次回放失败保留。下载根修正后`recording-live.json`单独复验Range206/MP4头/匿名401通过，不合并为一次无失败全流程。毫秒时间、0..1440分钟计划、关联必传planId、停止后特定stream缺失返回均有回归；后续GC修正未改变已验启停方法，复用120秒证据。
- `retention-live.json`：加速的是一条明确测试记录的时间，真实文件404、WVP索引消失、对账不复活；未声称自然三天运行。测试含三种负责人角色/无入职平台管理、普通成员拒绝、跨租户RLS、版本/幂等、撤权/旧代次、原绑定归属、失败删除重试与迁移隔离。
- 已登录隔离IAB Admin真实保存保留3→2，重进回读2，再恢复3/off并有统一反馈。390×844 H5实际录像1920×1080/125.409秒，currentTime13.399→26.164；日期/片段/模式重进保留且不自动播放，空日期禁用播放，返回直播1920×1080出画。证据h5-playback.png、h5-playback-empty.png、admin-recording.png；沿批准布局无横向溢出。
- 本轮恢复后13:28:25–13:28:53本地时间片段，在390×844解码1920×1080/28.138秒，currentTime10.386160→22.544381、readyState4/播放中且无横向溢出，h5-recovery-playback.png已审看。Admin1280×720确认已停止/3天，见admin-recovery.png。沿既有批准布局/配色与共用状态，浏览器视口已还原、测试观众已关闭。
- 原共享库STOP watchdog争用失败保留verification-20261023-shared-db-failure.json/checks-20261023-shared-db-failure.log；单独unit库后修复。旧WXML/最小化窗口误截图作废；合成GC过期数据修复前失败、verification-before-final-recording-fixes.json源漂移批次及所有recording-live时间戳尝试保留，不计入最终通过。
- 较早容量storage-live-2026-10-23T06-40-55-994Z.json：6/6、217绑定无漂移。85/92%告警，96%实际停写且直播/私有历史可用，93%保护/88%原意图恢复，探针故障及明确关闭均核验。06:18续录和06:31有观众仍写入失败/中间批次保留，修复所属MP4启停/直播守卫机制，未削弱断言。下列F盘真实证据取代当时的虚拟卷容量位置。
- 渲染QA沿批准Ant/H5源。Admin1280×720真实健康容量/正在录制/3天，admin-storage-recording.png已审看；模拟admin-storage-protection.png表格遇轮询spinner，仅作补充。H5390×844显示确认暂停/14真实片段，实际写入false时私有1920×1080/125.409秒录像时间24.998→50.709；h5-storage-paused.png/h5-storage-playback.png已审看、无溢出，临时观众关闭/视口还原。
- soak-smoke-2026-10-23T06-49-58-570Z.json：18次真实观测、183.839秒封口覆盖、末尾206/401，42绑定/3镜像无漂移，清理关闭/已停止；driverSmokePassed=true、soakPassed=false。soak-control-verify.json明确是合成孤儿控制器测试：拒绝其他fixture、确认控制器消失及写入实际停止，不计长测。
- 原soak-2026-10-23T07-00-32-665Z于15:07:48安全中断，关闭/停止确认，不计通过。原生Windows核验VHD实际在G:/AppData/Local/Docker/wsl/disk/docker_data.vhdx，物理≈19GiB而内部810GiB，74小时≈28.3GiB不可继续。用户选F。media-host-verification.json（15:14:44）确认原20文件SHA256全同、旧卷保留、ZLM可写/探针只读同源及实际总量/可用；ZLM镜像不变，最终探针镜像sha256:768ad57e37971c24ca4d145b4392e9c1558dac545cdac826d10fa9a2c515cece。
- F盘15:18原失败/off保留：Windows bind statvfs合成inode999/1000000按无效拒绝。仅Windows宿主覆盖明确inode不可用（0/0），字节/占用率匹配原生F盘；Linux已报inode检查仍严格。最终storage-live-2026-10-23T07-22-54-594Z.json（至15:24:00）：6/6真实MP4/直播/私有检查，220绑定/最终探针镜像无漂移，恢复真实F指标/关闭/停止。
- F驱动15:24冒烟封口188.291秒/私有206/401，但Docker重排未变的WVP挂载列表而失败。复用保存的完整挂载/镜像确认身份未变，按目标/名称排序且保留全部字段；21入口类型/驱动lint通过。最终soak-smoke-2026-10-23T07-29-25-548Z.json（至15:32:40）：driverSmokePassed=true、soakPassed=false，183.641秒本次封口/私有206/匿名401，46源码配置/3完整镜像挂载无漂移，清理关闭/停止；原失败仍排除。
- retention-live.json（15:32:57–15:33:02）/retention-host.json仅加速一条隔离旧fixture，ZLM404/WVP索引消失/不复活，Windows F文件实际消失、较新F文件仍在；原迁移前回执retention-live-before-host-mount.json保留。只证明删除机制，非自然三天通过。
- 真实soak-2026-10-23T07-33-15-912Z.json/soak.json：PID564360、策略39/区间33，10月23日15:33:22→预计10月26日17:33:22，46绑定/3镜像挂载身份，automation-4 ACTIVE/每小时；启动实际录制/物理F健康正常。24/72小时、自然到期和末尾覆盖待观察；多路/摄像头断电断网/WVP重启/生产仍未验。

### 1.4 共用状态与恢复

| 触发 | 可见反馈/动作 | 重进/边界 |
| --- | --- | --- |
| 保存开关/天数 | 统一成功或失败通知，pending/recording/stopped/error真实状态 | 后台回读持久策略，只有负责人角色可写；相同设置幂等 |
| 查询/空日期/失败 | 正在读取、真实片段数或空/错误文案，空/失败禁用播放、可查询重试 | 记住日期/选择，不伪造片段，不自动播放 |
| 播放/段结束/缺口 | 原播放器状态、真实回放；仅连续≤1秒自动下一段，缺口手选 | 切换/返回直播先停止本代次，普通成员只读媒体 |
| 撤权/会话或保留到期 | 既有失败反馈、停止媒体、重新从项目申请入口 | 每次及流中重验，不复活旧代次/过期文件 |
| 删除失败 | deleting/last_error保留并重试 | 仅本模块封口文件，文件与源索引均确认消失后deleted |
| 录制/恢复 | 已绑定健康/状态每5秒刷新；容量Alert仅负责人可见，操作共用结构化反馈 | 丢弃上一项目迟到响应、关闭仍关闭、保持批准布局/配色 |
| 容量/保护/恢复 |80/90%预警，95%/低字节/inode或无指标保护所属MP4；H5确认暂停，直播/历史仍可用 | 持久意图/转换审计、确认实际停止；回差恢复、明确关闭不续录、外部计划不动 |
| 每日覆盖 | 沿原Ant日期/表格/加载/Empty/错误重试；封存记录超过1000条明确部分统计 | 仅负责人有效绑定，只读有效索引，不推断日期两端停机或物理可播；关闭中止、重进今天、刷新复位分页 |
| 时间/索引不可核对 | 原失败/重试反馈，保留期望策略及补查快照/页码 | 不认领未核实区间、不跳过失败页、不把历史迁到当前绑定 |

## 2. 事实基线与既有计划关系

- [添加摄像头到 WVP](codex://threads/01a16235-d88b-73e3-81af-e01333b5f8bd)：已完成局域网扫描、统一账号批量接入、幂等编号和点播验证；摄像头 `192.168.10.80` 的一路视频有成功记录。接入页支持每批最多 100 台，当前适配 NZ 系列及兼容固件；这不是视频并发容量证明。
- [梳理摄像头对接文档](codex://threads/01a151c3-85dd-7e21-868f-dfaffd8d6368)：用户明确没有 `live-player` 权限，选择 H5 + `web-view`，并已确认企业或个体主体。`G:/workspace/向总/camera/test/README.md` 记录 2026-10-19 桌面浏览器实际播放 FLV、原生 HLS、两者切换及 1920×1080 画面成功；微信真机与 HTTPS 业务域名仍未验证。历史末条有停止 WVP 的记录，本轮没有重新运行媒体验收。
- 复用播放器源码：`G:/workspace/向总/camera/test/h5/{index.html,player.js,style.css}`、本地 `vendor/mpegts-1.8.2.js` 及许可证；小程序壳位于该测试项目的 `miniprogram/pages/webview/`。移入产品前固定源码哈希、依赖与许可证，移除硬编码 LAN 地址和测试诊断内容；既有测试页不是生产鉴权实现或已批准的产品视觉稿。
- WVP 工作目录：`G:/workspace/向总/wvp`。固定源码提交 `3fcd3ae80c30c95aeb82ef830af439a835257067`，镜像 `wvp-stack/wvp:2.7.4-3fcd3ae`；ZLM 固定镜像摘要见该目录 `scripts/versions.psd1`。已有服务端 JPEG 抓拍历史证据；持续录像、清理和 PTZ 尚无本计划验收证据。
- 现配置 `config/application.yml` 的 `record-sip`、`record-push-live` 为 false；`record-day: ${RECORD_DAYS:7}` 是媒体节点级配置。**设置保留天数不等于开启持续录像，也不等于逐摄像头策略已经实现。**
- 产品已有 `/construction-projects`、`packages/construction/projects/projects`、施工聊天和公开照片工地。施工业务实际使用 `admin/src/db/construction-schema.ts` 的 PostgreSQL/Drizzle 表与租户事务/RLS；不因旧总说明提到 Mongoose 而另建一套 MongoDB 摄像头业务。WVP 自身 MySQL/Redis 继续由 WVP 管理。
- 本计划细化既有 XiaoK 路线图 P4C 的视频技术部分。历史的设备租赁、报价、押金、90 天服务期、退款和售后不自动进入本次范围；**三天录像留存与服务期是不同参数**。D7 里程碑①现已在后台工地抽屉记录托管服务订单、报价版本和安装点位验收，费用仍在线下结算；该仅记录服务由开发总计划和后台模块清单记载，不改变本计划的摄像头录像、留存或计费行为。不增加 Agent 工具，不把摄像头画面自动送入模型，不扩大 P4B 公开工地范围。

### 2.1 SD 卡方案的当前验证结论

当前用户指示：先推进其他开发，等待其后续换卡再恢复SD验证；期间不再重复读卡、重启或格式化，保留下列原失败证据。云端录制/受控媒体断流测试独立进行，不等同于SD路径恢复。

最新换卡复测（2026-10-23 12:37–12:38）：用户更换另一张卡后，首次读取及一次GB重启后均为SDStatus=-1/SDInfo=0/SDFreeSpace=0。重启后实际SIP远端为192.168.10.84，原序列号一致；按此前授权再请求SD格式化，被设备拒绝，cardFormatted=false，设备录像仍0条，未追加重启/恢复出厂/改变录制计划。证据`tmp/cloud-camera-sd/probe-20261023T043713Z.json`、`probe-20261023T043734Z.json`、`probe-20261023T043842Z.json`。当前设备前端确认-1为“无SD卡”、格式化为frmHDFormat/Type1/FormatList:[1]；适配器通用“配置权限”报错不能直接诊断权限问题。换卡后仍失败也不能判定卡或卡槽损坏；已向用户询问新卡容量/品牌型号以进一步核对。无产品路由/API/权限/UI或已验云录像变化，SD路径仍未验证。

用户条件：**先确认这款设备能通过 WVP 查询并实际回放 SD 录像；支持后，将计划切换为有线云端录像、4G SD录像。** 当前仍未满足，不能将空查询/控制成功记为 SD 回放支持，也不能仅据0条判定设备不支持。

2026-10-22 未插卡的原证据 `tmp/cloud-camera-sd/verification.json` 保留。2026-10-23 用户明确确认同一台已插卡、尚未重启；设备 `frmIotRecordCfg` 读取 `SDStatus=-1/SDInfo=0/SDFreeSpace=0`，时钟正确。执行一次 `frmDeviceReboot` 后，设备11:17重新注册 WVP；其 DHCP 地址由 `192.168.10.80` 变为 `192.168.10.81`。通过 SIP TCP 实际远端地址定位，并核对原设备序列号一致；未重建 WVP 通道或修改绑定。

用户重新插拔后，已经GB重启并从实际SIP TCP远端定位192.168.10.83，核对同一序列号；仍返回SDStatus=-1、容量0。再次按已授权frmHDFormat/Type1/FormatList:[1]请求，被设备拒绝，格式化未完成；拒绝后未追加重启、未恢复出厂。最新证据tmp/cloud-camera-sd/probe-20261023T034117Z.json及probe-20261023T035245Z.json；此前首次重启、15秒手动Record/finally StopRecord、0条GB录像及首次格式化失败的probe全部保留。协议确认和新增云端文件均不证明SD写入/回放，硬件卡识别仍阻塞SD路径。

复测脚本 `admin/scripts/construction-camera-sd-probe.py` 复用本地 WVP onboarding 认证，强制原设备序列号校验后才允许重启/格式化；`--camera-ip` 可指定已从实际 SIP 连接定位的 DHCP 地址。默认只读；`--reboot`、`--record-seconds 5..60`（finally补StopRecord）和用户明确授权后才可使用的 `--format-sd` 是显式测试动作。凭据只在忽略目录。硬件可读后再产生短录像、查询非空区间、启动回放并验证解码/时间推进，最后停止本会话；无需用户手动播放验收。移动/定位/倍速分别记录。

若实测通过，按已有授权直接修订双语计划：**有线保持云端持续录像与可配置三天保留；4G改为SD本地持续录制、仅看直播/回放时上传媒体，退出后自动断流**。抓拍/必要片段可单独保存，SD回放可用窗口以实际录像索引和卡容量为准，不能套用云端三天物理删除承诺；断网期间可本地录像但远程不可读。公网4G兼容性仍须独立验证。当前其余章节的持续云录像规格保持原提案，双模式仍为待实证的条件方案。

## 3. 产品范围与建议默认值

| 能力 | 首版范围 | 完成标准 |
| --- | --- | --- |
| 直播 | 工地多摄像头列表、单路播放、切换、静音、全屏、重连、在线状态；H5 内完成播放和操作 | 获权用户实际出画；未获权用户拿到项目/设备 ID 或旧地址仍不能播放 |
| 录像与回放 | 已启用设备持续收流、服务端 MP4 分段、日期/时间段查询、定位、连续切段、返回直播 | 没人观看也有录像；重进可查；断网处明确缺口；过期段不可再访问并清理 |
| 抓拍 | 从当前实时流生成独立图片，显示时间/摄像头，保存为项目私有抓拍，可再次查看 | 服务端实际生成并持久化；不是手机截图或缓存旧图；失败可恢复且重复请求不重复入库 |
| 云台 | 支持设备的方向、停止及经验证的变倍；能力不足则明确不可用 | 真实执行和停止；离页/断网/竞争操作有控制租约和超时保护 |

建议默认：录像开启后全天持续录制，滚动保留 **72 小时**，每段 **5 分钟**；每 **10 分钟**执行过期清理。界面显示实际可回放区间，不承诺启用前录像或断网期间补录。

保留时间采用“企业默认 + 摄像头可覆盖”，首版建议 1–30 天整数、默认 3 天，受平台容量上限约束；这是拟定参数范围，可在实现前调整。提高天数不恢复已删除录像；降低天数展示预计影响并经明确保存后生效。录像开关独立，0 不同时表示关闭与永久保存。

仅过期且已经封口的片段可删除。边界片段为避免破坏有效画面可延后删除，物理清理延迟目标不超过一个分段周期加一次扫描周期（默认约 15 分钟）；播放授权仍按有效保留窗口裁定。未授权永久保留、导出大文件、定时抓拍、巡航、语音对讲、AI 视频分析及匿名直播不纳入首版。

## 4. 架构与 H5 接入

```mermaid
flowchart LR
  C[摄像头] -->|GB28181 信令| W[WVP]
  C -->|RTP 媒体| Z[ZLMediaKit]
  W --> Z
  M[小程序云工地] -->|本人身份申请一次性入口| B[业务 API / 项目权限]
  M --> V[web-view 内 H5 播放页]
  V -->|同源业务会话| B
  V -->|获权 FLV / HLS / MP4| G[HTTPS 媒体网关]
  G --> Z
  Z --> R[私有录像存储]
  G --> R
  B --> A[WVP / 厂家协议适配层]
  A --> W
  B --> D[现有 PostgreSQL 施工域]
  J[媒体任务与对账 Worker] --> A
  J --> R
  J --> D
```

### 4.1 播放路径

1. 员工沿“我的 → 云工地 → 项目 → 摄像头”进入。业主从本人获权工地入口进入；不因知道项目 ID 获权，也不把员工专用施工 API 改成任意用户通用接口。
2. 新增专用小程序壳，候选路由 `packages/construction/camera/camera`；新建 H5 页面候选 `/construction-camera`，放在 Admin 登录布局之外，使用独立的摄像头会话。路线名称在实施时定稿，目前均为拟新增。
3. 小程序用既有 bearer 身份申请短时、一次性 entry code，绑定用户、企业、项目、摄像头/绑定版本和用途。H5 通过 POST 交换受限会话；不把小程序长期 JWT、摄像头密码、WVP token 或 ZLM secret 拼进 URL。
4. 推荐同一 HTTPS 站点承载 H5、相关 API 和媒体网关。entry code 采用 URL fragment 传递，兑换后清除；页面不加载第三方分析脚本，设置 `Referrer-Policy: no-referrer`。会话使用 Secure/HttpOnly cookie，写请求验证 Origin/CSRF；禁止把它用作 Admin 登录会话。
5. 延续已验证的能力检测：有 MSE 实时解封装能力时用 mpegts.js 1.8.2 播 FLV；支持原生 HLS 时可选择 HLS。错误后有界重连/明确切换，不无限循环、不暗中同时拉两路。不假定所有 iOS/Android 微信 WebView 都支持同一协议。现阶段不强制更换播放器或新增 hls.js。
6. H5 内实现摄像头切换、回放时间轴、抓拍、云台和反馈；不依赖在 `web-view` 上叠加原生按钮。`postMessage` 只用于非实时通知，控制动作直接调用 H5 获权 API。刷新、返回、切账号及切企业后重新核验会话；H5 页面失活释放观看租约并停止云台。
7. FLV、HLS 清单及每个分片、MP4 Range、抓拍图片都走媒体授权；仅保护 H5 页面不够。媒体网关关闭直接源站绕过、匿名目录及缓存泄漏。长连接不能只在建立时校验：撤权后定向终止观看会话，建议服务端失效传播目标 ≤30 秒，不关闭其他人的共享流或连续录像。
8. 一次性 code 建议 30 秒有效，短播放凭据建议 60 秒有效；确切值在 CV-01 固定。重进重新申请；用户撤权、绑定迁移、项目停用和账号停用让后续请求失效。已合法传到终端的字节无法远程收回，不作此承诺。

### 4.2 WVP 与厂商协议分工

优先复用固定版本 WVP 已有接口。下列为已核对源码的上游候选，不直接向客户端透传：

| 用途 | WVP / ZLM 接口依据 |
| --- | --- |
| 设备、通道 | WVP `/api/device/query/devices`、`/api/device/query/devices/{deviceId}/channels` |
| 实时点播 | WVP `/api/play/start/{deviceId}/{channelId}`；停止点播必须核对录像/其他观看者租约 |
| 持续录制计划 | WVP `/api/record/plan/{add,link,get,query,update}`，按通道绑定全天计划 |
| 云端录像索引/播放 | WVP `/api/cloud/record/{date/list,list,play/path,loadRecord,seek,speed}` |
| 抓拍 | WVP `/api/play/snap` 或 ZLM `/index/api/getSnap`，验证新鲜度及实际输出后入库 |
| PTZ | WVP `/api/front-end/ptz/{deviceId}/{channelId}`，动作/速度按固定源码与实机能力映射 |
| 录制与事件 | ZLM `startRecord`、`isRecording`、`on_record_mp4` 等；优先通过 WVP 计划管理，禁止另一个循环反复启停同一路录制 |

厂家 [Slink IPC 文档](https://www.eolink.com/share/inside/98608ece654780d9b0b46bb615ccb020/api/-1) 已实际打开核对：

- [抓拍 `/CaptureV2`](https://www.eolink.com/share/inside/98608ece654780d9b0b46bb615ccb020/api/2767966/detail/52909562)：有 `Type/Ch/Dev/Data`，`DataType` 区分二进制与 base64，`StreamNo` 区分主/子码流。仅在设备 HTTP 可达且适配验证后作为抓拍补充路径。
- [云台 `/frmPTZControl`](https://www.eolink.com/share/inside/98608ece654780d9b0b46bb615ccb020/api/2767990/detail/52909734)：含 `Cmd`、`IsStop`、`Speed`，速度文档范围 1–10；单步、预置点和能力集另有接口。不能拿示例 `Cmd` 数字推断全部方向，须核对命令字与实际固件。
- [Digest 认证示例](https://www.eolink.com/share/inside/98608ece654780d9b0b46bb615ccb020/doc/-1/detail/684449) 描述 `/digest/frmUserLogin` 的挑战认证及特定 User-Agent；现批量接入也有 X-Digest 和 `goform/` 固件适配。复用已验证适配，凭据只在服务端保存，不新造通用浏览器登录流程。
- 云服务器无法因设备 GB28181 在线就直接访问其内网 HTTP/RTSP。公网/4G 优先 GB28181；厂家 HTTP 补充需要已有可达网关/VPN 或明确的厂家中转能力。SD 卡 `/frmVideoRecordsQuery` 不作为本次服务器三天录像的实现依据。

保留 WVP 现有 ZLM Hook。需要事件镜像时增加可靠转发/对账，不直接覆盖 Hook 使 WVP 丢失流生命周期和录像索引。媒体传输由网关/ZLM 负责，Next.js 不承担大流量视频逐字节转发。

## 5. 数据、权限与关键服务规则

拟新增下列施工域记录，最终迁移号按开发时实际顺序分配：

| 记录 | 关键内容 |
| --- | --- |
| 摄像头/通道 `construction_cameras` | enterpriseId、媒体节点、WVP device/channel 标识、序列号引用、名称、在线时间、经验证能力；节点凭据引用置于服务端配置 |
| 历史绑定 `construction_camera_bindings` | enterpriseId、projectId、cameraId、绑定起止时间/版本；同一通道同一时刻仅一个有效工地绑定 |
| 策略 `construction_camera_policies` | 企业默认/设备覆盖、录像开关、保留天数、配置版本、应用状态及失败原因 |
| 录像索引 `construction_recordings` | 固定 bindingId、stream generation、源 record ID、起止时间、私有 storage key、大小、校验及 ready/deleting/deleted/missing 状态 |
| 抓拍 `construction_camera_snapshots` | bindingId、请求幂等键、拍摄/获取时间、发起人、媒体资产引用与状态 |
| 会话/任务/审计 | 观看和 PTZ 租约、一次性入口、操作幂等、重试/未知结果；复用既有持久任务/审计范式，不接入模型 Worker |

业务表沿用 `withTenantTransaction` 和 RLS，使用企业/项目复合关联。Admin 使用 `withTenantRoute`、`isEnterpriseManagementRole`；Mini 使用当前有效签名身份解析和现有施工权限。平台管理员在所选企业内继承负责人管理权，不要求先成为项目员工。

建议权限矩阵（本计划提出的默认值，实施前随设计/业务合同定稿）：

| 用户 | 直播/回放 | 抓拍 | PTZ | 绑定/录像策略 |
| --- | --- | --- | --- | --- |
| 企业负责人、所选企业 admin/super_admin | 企业内获权设备 | 是 | 设备支持时 | 是；设备须已分配给本企业 |
| 当前项目经理 | 本人管理项目 | 是 | 设备支持时 | 可管理项目内布置；不改变企业归属/保留上限 |
| 当前项目设计师/施工成员 | 当前有效成员项目 | 经项目授权 | 默认关闭，可单独授权 | 否 |
| 业主 | 本人关联且已开放视频的项目 | 默认关闭，可单独授权 | 默认关闭，可单独授权 | 否 |
| 访客/公众 | 否 | 否 | 否 | 否 |

平台先把设备分配给企业；企业不能提交任意 WVP deviceId 认领其他企业设备。摄像头迁移先停止旧绑定会话/控制、封口当前录像，生成新 binding epoch，再建立新绑定；旧录像和抓拍仍属于原项目，迟到事件不能归入新工地。

### 5.1 持续录像与清理

- WVP 录制计划保持全天收流，业务 Worker 对账设备在线、媒体存在、录制状态及最近封口时间；无观众也录制。监测 `on_stream_none_reader`、`mp4_as_player` 等实际行为，不能靠配置名称推断持久录制成功。
- Worker 启动/重启后恢复应录通道，指数退避重试，记录断流/故障区间；停止观看只释放观看会话。状态区分“已启用录像”“正在录制”“录像中断”，请求被接收不等于已录制。
- WVP/ZLM 负责生成媒体，业务索引负责租户、绑定历史和有效留存窗口。封口事件重复/乱序幂等入库，丢 Hook 通过索引/文件对账恢复；录像文件不写数据库、不放 `design-references/` 或公开上传目录。
- **只设一个物理删除责任方。** 逐设备保留采用业务清理 Worker，只处理本模块认领的已封口记录，通过已验证的 WVP 删除能力同步源索引。WVP 节点级自动清理须关闭或设置为不会早于任何有效策略的上限；`0` 的实际含义先验证。共享节点不得未经隔离就修改其他业务的清理策略，必要时使用独立节点/卷。
- 删除采用 claim → deleting → 物理删除 → deleted，可幂等重试；数据库过期不等于文件已删。验证无开放写入、无合法播放租约、在允许存储根内，并同步清理临时文件/HLS 派生缓存。清理失败暴露积压，不标记完成。
- 容量预警建议 80%/90%，极低空间停止新增录制并显示失败，不能悄悄删掉仍在承诺窗口内的数据。保留策略保存前估算容量；事故停止、恢复及缺口均有审计。
- 全部时间入库 UTC，UI 用 Asia/Shanghai；摄像头时间校准、源时间戳、服务器时间分开记录。回放处理跨日、关键帧定位误差、缺口和分段边界，不将空白伪装成连续录像。

### 5.2 抓拍与 PTZ

抓拍优先复用实时流；校验设备/通道、图像解码和请求后新鲜度。无流时受控点播，完成只释放本任务的租约，不停止持续录制。写入私有媒体后返回持久 ID，未知结果重进查询同一任务。抓拍首版建议沿用对应摄像头保留天数；若以后显式纳入施工记录，应复制为独立业务资产并遵循其发布/保留合同，不自动公开。

PTZ 每设备仅一个短控制租约，命令带序号和失效时间，拒绝迟到/过期移动，停止命令优先。H5 `pointerup/pointercancel`、失焦、隐藏、退出均停止，客户端心跳丢失时服务端也在上限内发出停止（建议 ≤2 秒，CV-00 结合实机固定）。设备/WVP链路不可达时不能承诺已物理停止，应显示结果未知，恢复连接先补 STOP；若设备支持有限步进/运动超时，优先利用该能力。服务端进程恢复首先清理过期控制租约。不把 STOP 丢进普通排队任务；超时结果标为未知，不能盲重试移动。只提供实机验证能力，固定枪机无 PTZ 时不展示可操作的云台。预置位/变倍必须单独确认支持后开放。

## 6. 拟定业务 API 与工程落点

以下均为规划名称，不是现有接口：

- Admin 继续扩展 `/construction-projects` 设备管理区，通过 `/api/construction/projects/:projectId/cameras` 绑定/解绑、更新策略；平台配置负责媒体节点和企业分配。绑定/策略使用版本检查、幂等键和共享操作反馈。
- Mini 申请入口：`POST /api/miniprogram/construction/projects/:projectId/cameras/:cameraId/entry`。员工/客户复用各自现有身份与项目解析，显式分支，不放宽原员工专用路由。
- H5：`POST /api/construction-camera/session/exchange`；后续获权 `cameras`、`live-sessions`、`recordings?from=&to=`、`playback-sessions`、`snapshots`、`ptz/lease`、`ptz/command`、`ptz/stop`。后端解析企业/绑定，不相信浏览器传入的 WVP 地址/通道/存储路径。
- Media：仅允许获权 session 的不透明资源 ID；同源代理 FLV/HLS/MP4/图片，正确处理 Range、内容类型、CORS/Origin 和缓存。退出操作只取消本人的观看/控制会话。
- 主要实现落点：`admin/src/lib/construction/` 的摄像头服务/权限；独立 WVP/Slink 适配模块；`admin/src/db/` 的施工扩展与迁移；Admin 项目设备区；独立 H5 页面；Mini 专用 `web-view` 壳；持久媒体任务/对账进程。

## 7. 分阶段实施与验收

| 阶段 | 可交付用户结果 | 必须完成的有界检查 | 工作量预估 |
| --- | --- | --- | --- |
| CV-00 基线与设计 | 确定复用播放器、设备能力、H5 主稿/关键状态及权限规则 | 核对版本/协议/设备 PTZ 与录像能力；登记业务域名/HTTPS 状态；明确清理责任；设计源完成映射 | 1–2 人日 |
| CV-01 绑定与直播 | Admin 分配/绑定设备；Mini 从真实工地进入 H5，看直播并切换/重进 | 实际绑定写回、一次性兑换/重放拒绝、FLV/HLS 出画与切换、离线恢复、跨租户/撤权/旧链接拒绝、退出不影响其他观众 | 3–5 人日 |
| CV-02 录像与回放 | 开录像后无人观看仍录制；H5 按日期/时间回放，默认三天且可修改 | 真实封口文件/索引、跨段/跨日/缺口、Worker/媒体重启恢复、默认72小时逻辑、策略覆盖、两阶段删除及清理失败；小程序入口/反馈/重进 | 4–6 人日 |
| CV-03 抓拍与云台 | H5 抓拍并查看历史；支持设备按授权控制/停止 | 实际图像持久化/幂等/重进、离线/权限失败；PTZ 起停/失焦/断网/抢占/过期指令，能力不支持分支；同项目多用户隔离 | 3–5 人日 |
| CV-04 连续运行与交付 | 管理者看到在线/录像健康、容量及失败原因，异常能恢复 | 单/多路并发、真实录像浸泡运行、清理与容量告警、断网/重启、鉴权全链路、H5浏览器与Stable原生入口回归、文档/部署回滚预案 | 2–4 人日，另含被动运行观察 |

串行预算约 **13–22 工程人日**，以复用现有服务且设备支持所需能力为前提，不含等候新视觉批准、域名/网络开通或实际 72 小时观察的纯等待时间；不是工期承诺。直播可先交付，无需等租赁/支付/售后体系。

测试使用批准开发库的合成企业、项目、成员和专门标记的测试摄像头绑定；真实视频只保留在私有测试存储，不公开。每阶段包含 Mini 入口、真实服务写入/回读、可见反馈、持久重进和权限/失败恢复。Native 验收沿用 Stable DevTools 单控制器、既有锁和窗口纪律；不复制临时小程序项目。

播放器测试复用既有 FLV/HLS 证据，新增部分测 H5 会话、安全媒体地址、回放与控制。浏览器自动化证明 H5 出画，Stable 验证入口/路由/会话/业务状态；微信容器、iOS/Android 真机、公网/4G 等缺少实证时明确记为未验证，**不要求用户常规手测或以此阻塞独立开发，也不宣称发布验收通过**。加速时钟/过期合成文件验证保留逻辑，真实持续运行验证录制稳定性，两类证据不能互相代替。

每次执行前后绑定源代码、测试、驱动、媒体版本、配置及固件；保留失败和未知结果。连续录像观察至少覆盖24小时；完整72小时连续窗口和自然到期清理只有取得实际证据后才可声称通过，不以短烟测代替。完成相关检查后推进下一授权阶段，不另设人工截图确认门槛。

## 8. 容量与运行参数

按码流实际平均码率估算（十进制 GB，未含额外音轨/封装/冗余）：`每天GB = Mbps × 10.8`；`三天GB = Mbps × 32.4`。

| 单路码率 | 每天 | 三天 | 三天加25%余量 |
| --- | --- | --- | --- |
| 1 Mbps | 10.8 GB | 32.4 GB | 40.5 GB |
| 2 Mbps | 21.6 GB | 64.8 GB | 81 GB |
| 4 Mbps | 43.2 GB | 129.6 GB | 162 GB |

示例：5 路各 1 Mbps 连续录像，三天原始视频约162 GB，预留后约203 GB；5 路各2 Mbps 则约405 GB。全天上传，1 Mbps 单路每30天约324 GB，上行流量不因只保留三天而降为三天流量。现场持续上行约所有录像码率之和，服务器观看下行另按并发播放路数累加；需留协议和波动余量。

首版延续已验证 H.264；实际码率由设备/现有服务合同决定，不暗改摄像头编码。最多2路≤1Mbps是历史P4C服务基线，不能当作当前服务器实测容量，也不能混同全天所有摄像头录像的上行预算。CPU/内存/磁盘型号与设备总量/转码需求在 CV-00 实测后确定；默认避免重编码，确有不兼容才评估转码成本。

## 9. 设计、文档与部署边界

- 现有批准云工地映射是 `design-references/construction-workflow/cloud-site/manager.png`，业主参考 `owner.png`；两个 prompt 均明确排除 CCTV/live-stream UI。因此只继承品牌/导航语言，不把现有照片记录页视为已批准直播稿。
- 补充一张 H5 直播主稿、一张回放关键变体，以及共享抓拍反馈/PTZ面板/异常/撤权状态规则即可；按 390×844 对应源画布和实际 web-view 可用区标定。默认纵向单路，宽屏/横屏全屏作为适配。无需每个错误各画一张整页，不自动添加四/九宫格大屏。
- 后续实现使用 draw-ui，先读取其校准/实现参考；新业务插画如需要，依仓库规则独立生成透明资产，禁止切复合截图。H5测试页只复用媒体逻辑，产品UI需明确设计源和实施授权。
- 每个阶段更新 `admin-system-modules.{md,zh-CN.md}`、`miniprogram-system-modules.{md,zh-CN.md}`；可见路由实现后更新双语还原台账唯一当前行，Admin UI受影响时同步双语 refactor 合同。未完成的能力保持 Limited/Placeholder。
- 最初规划仅新增双语文件；当前实施、路由/API/数据/权限/UI变化及对应清单/台账以第1节为准。不得混入其他对话脏改动。
- 远程工作前读取 `remote-development.md` 与中文镜像；H5 正式业务域名/HTTPS 与媒体代理同源配置作为部署检查，不能用关闭域名校验作为上线方案。本计划不启动远程部署、采购、支付、摄像头生产录制或改变现有网络暴露。

## 10. 参考与本轮核对

- [微信 web-view 官方文档](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)：主体/业务域名、嵌入与通信约束。`web-view`业务域名不是`request`合法域名。
- [mpegts.js 官方项目](https://github.com/xqq/mpegts.js)：播放器能力依据；采用已验证的本地1.8.2基线，升级另行验证。
- [固定版本 WVP 源码](https://github.com/648540858/wvp-GB28181-pro/tree/3fcd3ae80c30c95aeb82ef830af439a835257067)：本轮核对本地 vendor 中 PlayController、PtzController、DeviceQuery、RecordPlanController、CloudRecordController、MediaConfig。
- [ZLM RESTful API](https://docs.zlmediakit.com/zh/guide/media_server/restful_api.html)、[ZLM Web Hook](https://docs.zlmediakit.com/zh/guide/media_server/web_hook_api.html)：录制、抓拍、流状态和播放/HTTP访问鉴权；以固定部署实际响应为最终适配依据。
- 原规划核对包括历史、WVP/播放器/施工源码、双语模块、设计prompt和厂家认证/抓拍/PTZ页面；当前云端集成与真实检查见第1节。SD实录/回放仍未通过，最新卡状态见2.1。
