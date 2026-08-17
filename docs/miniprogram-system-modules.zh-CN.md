# 小程序当前功能清单

本文只描述原生微信小程序当前运行入口、合同、权限和限制。日期还原记录和
测试全文由 Git 历史或本地证据保留。

## 运行环境与共享上下文

- 原生微信小程序，使用自定义 TabBar、亮绿色设计 token，视觉基准为 iPhone 13 Pro
  `390x844`。
- 会话使用 `/api/auth/miniprogram` 和 bearer JWT。手机号授权可创建普通客户账号；阶段 3 的推荐领取接口也可直接使用微信授权码，在同一事务中关联账号、归属和线索；
  token 选择数据库实时校验的 `customer`、`staff` 或 `referrer` 上下文，并由
  `contextVersion` 使旧 token 失效。专业员工、企业上下文、线索、户型、AI 任务、
  提成和报备记录都通过共享 API 解析。
- 主操作使用本地存储且有许可证记录的图标；原生右上角胶囊和安全区不得被内容覆盖。
- `Implemented`、`Limited`、`Placeholder` 只表示可执行运行时行为，不代表标签或 mock 响应。

## 页面清单

| 界面 | 运行路由 | 当前合同 | 状态/限制 |
| --- | --- | --- | --- |
| 首页与量房入口 | `pages/index/index` | 角色化首页、线索/项目卡片、正式量房入口；本地 `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` 开关会跳过最近户型加载并直接新建量房 | Implemented；正常模式数据按租户和角色返回，调试开关仅限本地使用 |
| 线索与客户 | `pages/leads-management/leads-management`、`packages/business/lead-form/lead-form`、`packages/business/lead-detail/lead-detail` | 线索列表/详情、获客协作、签约状态、正式户型摘要 | Implemented；签约权限由服务端执行 |
| 报备与员工任务 | `packages/business/promotion-records/promotion-records`、`packages/business/promotion-record-detail/promotion-record-detail`、`packages/business/acquisition-center/acquisition-center` | 企业报备、员工任务和通知 | Implemented/Limited；微信投递可能被外部拒绝 |
| 推荐人网络与匿名领取 | `packages/business/promotion-service-code/promotion-service-code`、`packages/business/free-design-service/free-design-service` | `/api/miniprogram/codes/resolve` 解析并审计令牌且签发 10 分钟待确认来源；`/api/miniprogram/referrer-memberships/[id]/promotion-code/image` 校验当前关系并返回受保护的微信小程序码；`/api/miniprogram/referrals/authorize-and-create-lead` 在手机号授权后原子锁定首次归属、建线索并稳定分配设计师/测量员；入驻和成员接口继续提供双码网络管理 | Implemented/Limited；公共页面不展示企业身份，客户必须主动授权手机号后才建线索，微信小程序码/授权依赖外部配置，无候选线索保留待重试 |
| 提成记录 | `packages/business/commission-records/commission-records` | 测量员获客提成和订单提成 | Implemented；结算仍由后台业务控制 |
| 灵感库 | `packages/business/inspiration/inspiration` | 租户范围内灵感浏览和详情 | Implemented/Limited；媒体供应商为外部服务 |
| AI 设计工作流 | `pages/ai-design/ai-design`、`packages/ai-workflow/*` | 客户/项目选择、方案入口、确认、结果和历史 | Implemented；供应商、点数和正式量房资格由服务端控制 |
| 我的与账号 | `pages/mine/mine`、`packages/business/profile-edit/profile-edit`、`packages/business/settings/settings`、`packages/business/account-security/account-security` | 角色化工作台、通知、账号和权限设置 | Implemented/Limited；部分设置由微信平台托管 |
| 推荐分享 | `packages/business/recommendation-share/*` | 只读推荐方案和项目摘要 | 受分享授权及可用资源限制 |

## 正式量房

唯一量房编辑器是 `packages/surveying/editor/surveying-editor`，进入时
携带 `leadId` 和/或 `floorPlanId`。权威合同见
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md)。
`FloorPlan.layoutData` 只保存 v4 `surveyGraph`；wall graph、Canvas、尺寸、BLE
读数、审计队列、撤销/重做、右侧工具栏经确认的清空重做操作和保存失败行为都必须遵守该合同。
封闭外墙中段的 T 型分支保持同一拓扑节点和实体墙。“内边/外边起步”只选择源墙边界的近侧/远侧起点及对应的首段起点内缩，不得再次解释为新分支墙相反的局部测量面。分支所有墙段统一使用 graph 侧工作面，并继承首段确定的实体侧；转向和源房间质心都不得重新翻面。触点按正交规则写入内部 graph，预览黑线、橙线、确认红线、实时尺寸端点和绿色光标必须重合在同一条连续工作路径上；相邻红线端点严格相等，拉出第二段时光标和红线不得横移一个墙厚。`measurementStartInsetMm`、`measurementStartExtensionMm` 和 `measurementEndInsetMm` 只记录真实边界或闭合修正，普通外边 T 转角不得自动生成一个墙厚的修正。预览、手工/BLE 确认、Canvas 和尺寸消费者统一按“拓扑长度 - 起点内缩 + 起点延伸 - 终点内缩”计算。以上 Canvas 派生投影不改变 graph 的中心线和闭合拓扑；T 链第二段及之后的转角只能补齐实体墙连接，不得回写前序墙段的测量内缩或缩短已确认读数。所有共享边闭合链在确认后都保持确认前的实体侧，包括“向外量墙、最后橙线吸附既有房间内边”的路径；不能将墙体翻到已对齐红线/橙线的另一侧或再叠加一个墙厚。最后光标命中既有墙的可见外边时，必须保留该外边工作坐标，并以短桥接连接拓扑角点，不得暗中投影回中心线。墙角续接和共享内墙分区仍遵守原有边界闭合规则。

## 共用 API 与工具

- 身份/上下文：`/api/auth/miniprogram`、`/api/miniprogram/identity-contexts`、
  `/api/miniprogram/identity-contexts/switch` 及共用上下文解析器。身份列表每次从
  数据库读取；切换不能伪造非活动企业、员工身份或推荐人成员关系。
- 推荐人网络：推广展示页为当前推荐人成员关系加载受保护的微信小程序码；客户领取页只解析、校验、审计不透明令牌并签发短时待确认来源，不创建线索。客户使用 `Idempotency-Key` 授权后才原子创建活动归属、线索和派单；并发或重复扫码不能覆盖未关闭项目。已授权手机号的用户可入驻一家员工企业，或默认最多加入三家推荐人企业；退出会停用对应推广令牌并使旧 JWT 失效。
- 线索、户型、测量、设备、AI、提成、报备和通知使用对应的租户 API 族。
- 几何与 Canvas 源文件为 `miniprogram/utils/surveyWallGraph.js`、
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js` 及量房尺寸/实体规划器。
- BLE 集成位于 `miniprogram/utils/bluetooth.js`；协议语义以仓库厂商文档为准。

## 维护规则

路由、API、权限、数据合同、状态、限制或视觉源变化时，只更新对应行和中文镜像。
还原台账每条路由只保留一行当前状态，不追加日期实现说明、已废弃设计源或重复测试全文。

English mirror: [miniprogram-system-modules.md](./miniprogram-system-modules.md)
