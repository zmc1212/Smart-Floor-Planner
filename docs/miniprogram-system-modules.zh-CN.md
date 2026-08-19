# 小程序当前功能清单

本文只描述原生微信小程序当前运行入口、合同、权限和限制。日期还原记录和
测试全文由 Git 历史或本地证据保留。

## 运行环境与共享上下文

- 原生微信小程序，使用自定义 TabBar、亮绿色设计 token，视觉基准为 iPhone 13 Pro
  `390x844`。
- 会话使用 `/api/auth/miniprogram` 和 bearer JWT；`GET /api/miniprogram/bootstrap` 会校验签名上下文并返回当前角色、有效角色组、企业/成员关系、落点、能力白名单和服务端徽标摘要。手机号授权可创建普通客户账号；阶段 3 的推荐领取接口也可直接使用微信授权码，在同一事务中关联账号、归属和线索；
  token 选择数据库实时校验的 `customer`、`staff` 或 `referrer` 上下文，并由
  `contextVersion` 使旧 token 失效。专业员工、企业上下文、线索、户型、AI 任务、
  提成和报备记录都通过共享 API 解析。小程序启动/回到前台时会用保存的 token 调用
  `refresh` 重新读取当前上下文，随后由 bootstrap 确认服务端能力与落点；上下文失效会清理本地会话，推荐人上下文从首页或“我的”
  冷启动时恢复到推广工作台，避免静默落入普通客户界面。
- 主操作使用本地存储且有许可证记录的图标；原生右上角胶囊和安全区不得被内容覆盖。
- `Implemented`、`Limited`、`Placeholder` 只表示可执行运行时行为，不代表标签或 mock 响应。

## 页面清单

| 界面 | 运行路由 | 当前合同 | 状态/限制 |
| --- | --- | --- | --- |
| 首页与量房入口 | `pages/index/index` | 客户继续使用共用首页；已签名设计师、测量员、企业负责人分别进入角色工作台。设计师只看本人已派客户，测量员只看本人已确认日程和已派量房入口，企业负责人只看当前租户经营数据。本地 `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` 开关会跳过最近户型加载并直接新建量房 | Implemented/Limited；角色工作台读取服务端派生的 `GET /api/miniprogram/workbench` 聚合，并复用四个静态 Tab 路由。客户 TabBar 已增加“项目”入口并指向本人项目索引；调试开关仅限本地使用。新增角色态尚待登录态 `390x844` 原生胶囊核验 |
| 线索与客户 | `pages/leads-management/leads-management`、`packages/business/lead-form/lead-form`、`packages/business/lead-detail/lead-detail` | 线索列表/详情、签约状态、正式户型摘要；负责设计师在尚无有效预约时可进入首次预约。静态角色 Tab 中，测量员只看到本人已确认预约任务；设计师和企业负责人仍进入各自已授权的客户入口。带 JWT 的员工会话无需 legacy OpenID 也可加载线索列表。推荐网络线索经现有签约接口进入 `converted` 时，服务端在同一事务快照推荐人、设计师、测量员三条提成 | Implemented/Limited；签约与预约入口权限由服务端执行，角色 Tab 条目按能力白名单生成；比例规则要求合同金额，已支付三方提成会阻止企业负责人撤销签约 |
| 报备与员工任务 | `packages/business/promotion-records/promotion-records`、`packages/business/promotion-record-detail/promotion-record-detail` | 企业报备和员工通知 | Implemented/Limited；微信投递可能被外部拒绝 |
| 推荐人网络、预约与匿名领取 | `packages/business/onboarding/onboarding`、`packages/business/onboarding-debug/onboarding-debug`、`packages/business/referrer-workbench/referrer-workbench`、`packages/business/referrer-progress/referrer-progress`、`packages/business/referrer-earnings/referrer-earnings`、`packages/business/promotion-service-code/promotion-service-code`、`packages/business/free-design-service/free-design-service`、`packages/business/customer-projects/customer-projects`、`packages/business/customer-project/customer-project`、`packages/business/appointment-detail/appointment-detail`、`packages/business/appointment-reschedule/appointment-reschedule`、`packages/business/appointment-booking/appointment-booking`、`packages/business/measurer-calendar/measurer-calendar`、`packages/business/measurer-unavailability/measurer-unavailability`、`packages/business/identity-recovery/identity-recovery` | 按类型隔离的入驻、推广码、客户领取、项目和预约深层路由保持既有合同。客户项目索引仅返回当前 JWT 客户本人未归档项目的企业、阶段摘要和更新时间；推荐人进度/收益仅在当前签名成员关系下返回脱敏客户标识、服务事实和本人提成状态，绝不返回手机号、精确地址、户型 graph、内部预约原因或设计文件。推荐人工作台选择企业会先交换签名成员关系上下文并刷新会话，因此服务码、进度和收益始终使用同一边界。手机号授权前，有效入驻码会解析码类型和企业展示名称；开发版 `onboarding-debug` 可选择本地小程序码进入同一真实流程。预约动作继续按设计师、测量员、企业负责人和客户边界执行；推荐人工作台保留退出当前账号，只有服务端返回多个不同身份类型时才显示切换入口；身份失效会进入独立恢复页后重新登录 | Implemented/Limited；推荐人首次入驻、登录和带 JWT 的冷启动会进入推广工作台；已用真实登录态推荐人在 `390x844` 核验登录完成与冷启动，并保存包含原生胶囊的宿主截图。工作台现可进入当前企业的服务进度和本人收益，客户项目与预约 API 继续执行所有权、岗位权限和乐观锁；身份列表暂时不可用时不阻断推广工作台，但切换入口保持隐藏。第 12 阶段已按 bootstrap 显示当前可执行的推荐人/测量员入口，并在失效时清除会话且不展示失效企业；新增客户项目、推荐进度和收益页待真实登录态 `390x844` 核验，测量任务聚合、预约/方案发布登录态动作与完整角色生产 UI 仍待补，微信投递依赖外部配置 |
| 提成记录 | `packages/business/commission-records/commission-records` | 适用商业角色的订单提成 | Implemented；结算仍由后台业务控制 |
| 灵感库 | `packages/business/inspiration/inspiration` | 租户范围内灵感浏览和详情 | Implemented/Limited；媒体供应商为外部服务 |
| AI 设计工作流 | `pages/ai-design/ai-design`、`packages/ai-workflow/*` | 客户/项目选择、方案入口、确认、结果、历史及线索范围的发布状态。绑定线索的成功结果允许负责设计师或企业负责人确认后发布到客户项目或撤回。静态角色 Tab 对测量员变为已派正式量房入口，对企业负责人变为已确认预约查看 | Implemented/Limited；供应商、点数、正式量房资格、线索责任人、发布可见性和工作台范围均由服务端控制；替代角色态尚待登录态 `390x844` 原生胶囊核验 |
| 我的与账号 | `pages/mine/mine`、`packages/business/profile-edit/profile-edit`、`packages/business/settings/settings`、`packages/business/identity-switch/identity-switch`、`packages/business/identity-recovery/identity-recovery`、`packages/business/account-security/account-security` | 通知、账号安全及服务端身份上下文选择；`GET /api/miniprogram/bootstrap` 返回当前角色、有效角色组、企业/成员关系、落点、能力白名单和服务端徽标摘要；切换会交换签名 token，登录、入驻、领取、切换和冷启动均先刷新并校验 bootstrap，再通过统一身份导航进入已签发落点；`identity-navigation` 对未知身份和越权深链返回明确拒绝；失效的签名上下文跳转至恢复页，清除旧会话并要求重新登录 | Implemented/Limited；bootstrap 角色只生成当前已接通且按能力白名单裁剪的导航：客户“服务/项目/我的”，推荐人“推广/进度/收益/我的”，设计师“工作台/客户/设计/我的”，测量员“日程/任务/量房/我的”，企业负责人“经营/客户/预约/我的”。撤权、停用或版本变化不展示失效企业数据，也不静默回落客户 |
| 推荐分享 | `packages/business/recommendation-share/*` | 只读推荐方案和项目摘要 | 受分享授权及可用资源限制 |

## 正式量房

唯一量房编辑器是 `packages/surveying/editor/surveying-editor`，进入时
携带 `leadId` 和/或 `floorPlanId`。权威合同见
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md)。
`FloorPlan.layoutData` 只保存 v4 `surveyGraph`；wall graph、Canvas、尺寸、BLE
读数、审计队列、撤销/重做、右侧工具栏经确认的清空重做操作和保存失败行为都必须遵守该合同。闭合、删墙和闭合墙上的拆分通过半边求面写入闭合空间，事务要求已保存空间与求面结果一致，否则拒绝该次编辑。Graph 节点只存中心线；工作面和单侧实体是读模型。删除两个闭合房间的共用墙会打通该界面并合并成一个闭合房间；共用界面被拆成共线多段时，删除其中任一段都会去掉整条共线共用墙。打通后若共线内角点被折叠，净尺寸计划仍须按折叠后的内边界给出每一段端点。打通形成的 L 型凹角保持矩形墙体相接，不得按凸角斜接把剩余外墙错进房间。节点求交按局部凸/凹（凸角外斜接、凹角重叠矩形、对侧共线只补外侧台阶）；Admin `surveyWallSolidPlan.js` 使用同一生成规则。内边闭合打通后仍保持各墙原有实体侧：内转角伸进合并房间，对侧共线墙保持台阶外皮并只补外侧台阶转角、内边仍与共用节点对齐，内 L 两墙保持矩形重叠相接，不得斜接成梯形缺口。
封闭外墙中段的 T 型分支保持同一拓扑节点和实体墙。“内边/外边起步”只选择源墙边界的近侧/远侧起点及对应的首段起点内缩，不得再次解释为新分支墙相反的局部测量面。分支所有墙段统一使用 graph 侧工作面，并继承首段确定的实体侧；转向和源房间质心都不得重新翻面。触点按正交规则写入内部 graph，预览黑线、橙线、确认红线、实时尺寸端点和绿色光标必须重合在同一条连续工作路径上；相邻红线端点严格相等，拉出第二段时光标和红线不得横移一个墙厚。`measurementStartInsetMm`、`measurementStartExtensionMm` 和 `measurementEndInsetMm` 只记录真实边界或闭合修正，普通外边 T 转角不得自动生成一个墙厚的修正。预览、手工/BLE 确认、Canvas 和尺寸消费者统一按“拓扑长度 - 起点内缩 + 起点延伸 - 终点内缩”计算。以上 Canvas 派生投影不改变 graph 的中心线和闭合拓扑；T 链第二段及之后的转角只能补齐实体墙连接，不得回写前序墙段的测量内缩或缩短已确认读数。所有共享边闭合链在确认后都保持确认前的实体侧，包括“向外量墙、最后橙线吸附既有房间内边”的路径；不能将墙体翻到已对齐红线/橙线的另一侧或再叠加一个墙厚。最后光标命中既有墙的可见外边时，必须保留该外边工作坐标，并以短桥接连接拓扑角点，不得暗中投影回中心线。墙角续接和共享内墙分区仍遵守原有边界闭合规则。

## 共用 API 与工具

- 身份/上下文：`/api/auth/miniprogram`、`/api/miniprogram/bootstrap`、`/api/miniprogram/identity-contexts`、
  `/api/miniprogram/identity-contexts/switch` 及共用上下文解析器。身份列表每次从
  数据库读取；切换不能伪造非活动企业、员工身份或推荐人成员关系。`app.js` 的启动
  恢复会用 `/api/auth/miniprogram` 的 `refresh` 重新签发当前 token，并在 `customer/staff/referrer`
  三种上下文间使用统一落点；401/`contextVersion` 失效会清除本地会话且不会触发冷启动时的
  错误角色回退。
- 推荐人网络：企业入驻码 PNG/JPEG 打开专用入驻页；该页在手机号授权前只解析不透明令牌类型，之后调用既有入驻接口。企业入驻码和推荐推广码均通过 `getwxacodeunlimit` 指向 `develop`，即使服务端以生产模式运行也不回退到正式版；使用 32 位 `scene` 携带令牌摘要，入驻页恢复 `ej_`/`rp_` 前缀后再解析。推广展示页为当前推荐人成员关系加载受保护的微信小程序码；客户领取页只解析、校验、审计不透明令牌并签发短时待确认来源，不创建线索。客户使用 `Idempotency-Key` 授权后才原子创建活动归属、线索和派单；并发或重复扫码不能覆盖未关闭项目。已授权手机号的用户可入驻一家员工企业，或默认最多加入三家推荐人企业；退出会停用对应推广令牌并使旧 JWT 失效。
- 客户项目、推荐进度与方案发布：`GET /api/miniprogram/customer-projects` 只列出当前 `customer_user_id` 的未归档项目摘要，`GET /api/miniprogram/customer-projects/[leadId]` 才返回企业、设计师、当前预约、完成的 v4 户型摘要和活动发布方案；已发布图片通过同一客户身份的受保护端点读取。`GET /api/miniprogram/referrer-progress` 和 `GET /api/miniprogram/referrer-earnings` 固定按 JWT 当前活动成员关系过滤，分别仅返回脱敏服务阶段/更新时间和本人提成记录。负责设计师只能发布或撤回自己负责线索的已成功 generation，企业负责人可管理本企业；撤回不删除生成结果但立即取消客户可见性。
- 线索、户型、测量、设备、AI、提成、报备和通知使用对应的租户 API 族。预约可用
  时段接口会返回企业时区、时长、步长和最远可预约天数；预约与改期页面以该服务端
  边界为准，不将本地生成的日期列表当作权威范围。客户预约接口只在确认请求的线索
  或预约归属该客户后才推导企业范围；客户 token 不携带或声明企业 ID。
- 几何与 Canvas 源文件为 `miniprogram/utils/surveyWallGraph.js`、
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js` 及量房尺寸/实体规划器。
- BLE 集成位于 `miniprogram/utils/bluetooth.js`；协议语义以仓库厂商文档为准。

## 维护规则

路由、API、权限、数据合同、状态、限制或视觉源变化时，只更新对应行和中文镜像。
还原台账每条路由只保留一行当前状态，不追加日期实现说明、已废弃设计源或重复测试全文。

English mirror: [miniprogram-system-modules.md](./miniprogram-system-modules.md)
