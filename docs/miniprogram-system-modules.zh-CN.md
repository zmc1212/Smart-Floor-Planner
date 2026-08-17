# 小程序当前功能清单

本文只描述原生微信小程序当前运行入口、合同、权限和限制。日期还原记录和
测试全文由 Git 历史或本地证据保留。

## 运行环境与共享上下文

- 原生微信小程序，使用自定义 TabBar、亮绿色设计 token，视觉基准为 iPhone 13 Pro
  `390x844`。
- 会话使用 `/api/auth/miniprogram` 和 bearer JWT。手机号授权可创建普通客户账号；
  token 选择数据库实时校验的 `customer`、`staff` 或 `referrer` 上下文，并由
  `contextVersion` 使旧 token 失效。专业员工、企业上下文、线索、户型、AI 任务、
  提成和报备记录都通过共享 API 解析。
- 主操作使用本地存储且有许可证记录的图标；原生右上角胶囊和安全区不得被内容覆盖。
- `Implemented`、`Limited`、`Placeholder` 只表示可执行运行时行为，不代表标签或 mock 响应。

## 页面清单

| 界面 | 运行路由 | 当前合同 | 状态/限制 |
| --- | --- | --- | --- |
| 首页与量房入口 | `pages/index/index` | 角色化首页、线索/项目卡片、正式量房入口 | Implemented；数据按租户和角色返回 |
| 线索与客户 | `pages/leads-management/leads-management`、`packages/business/lead-form/lead-form`、`packages/business/lead-detail/lead-detail` | 线索列表/详情、获客协作、签约状态、正式户型摘要 | Implemented；签约权限由服务端执行 |
| 报备与员工任务 | `packages/business/promotion-records/promotion-records`、`packages/business/promotion-record-detail/promotion-record-detail`、`packages/business/acquisition-center/acquisition-center` | 企业报备、员工任务和通知 | Implemented/Limited；微信投递可能被外部拒绝 |
| 推荐人网络后端 | 阶段 2 无生产运行页 | `/api/miniprogram/codes/resolve`、`/api/miniprogram/onboarding/*`、`/api/miniprogram/referrer-memberships/*` 提供令牌类型/状态解析、手机号授权后的员工/推荐人入驻、成员查询/退出和稳定推广令牌 | Limited；后端合同已实现，已批准的工作台和匿名服务三屏仍属阶段 4 |
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
封闭外墙中段的 T 型分支保持同一拓扑节点和实体墙。内边起步的首段工作线位于 graph 内边；外边起步的首段工作线位于派生的实体外边，两种首段读数相差一个墙厚。转角后不能机械地继续选择新墙段的局部外边，因为墙段法向量随方向旋转会让光标瞬移一个墙厚；后续墙段必须选择穿过当前绿色光标的连续工作面。触点按正交规则写入内部 graph，预览黑线、橙线、确认红线、实时尺寸端点和绿色光标必须落在这条连续工作线上。内边起步的后续墙段继承首段实体侧；外边起步的后续墙段则按源房间质心重新决定实体墙朝向，使连续红线保持外侧，改变拖动方向也不得翻转首段实体墙。相邻工作线在直线交点连接，转角红线必须连续。以上 Canvas 派生投影不改变 graph 的中心线和闭合拓扑。T 链第二段及之后的转角只能补齐实体墙连接，不得回写前序墙段的测量内缩或缩短已确认读数。所有共享边闭合链在确认后都保持确认前的实体侧，包括“向外量墙、最后橙线吸附既有房间内边”的路径；不能将墙体翻到已对齐红线/橙线的另一侧或再叠加一个墙厚。最后光标命中既有墙的可见外边时，必须保留该外边工作坐标，并以短桥接连接拓扑角点，不得暗中投影回中心线。墙角续接和共享内墙分区仍遵守原有边界闭合规则。

## 共用 API 与工具

- 身份/上下文：`/api/auth/miniprogram`、`/api/miniprogram/identity-contexts`、
  `/api/miniprogram/identity-contexts/switch` 及共用上下文解析器。身份列表每次从
  数据库读取；切换不能伪造非活动企业、员工身份或推荐人成员关系。
- 推荐人网络：阶段 2 的扫码解析只分类、校验并审计不透明令牌，不创建客户归属或线索。已授权手机号的用户可入驻一家员工企业，或默认最多加入三家推荐人企业；退出会停用对应推广令牌并使旧 JWT 失效。
- 线索、户型、测量、设备、AI、提成、报备和通知使用对应的租户 API 族。
- 几何与 Canvas 源文件为 `miniprogram/utils/surveyWallGraph.js`、
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js` 及量房尺寸/实体规划器。
- BLE 集成位于 `miniprogram/utils/bluetooth.js`；协议语义以仓库厂商文档为准。

## 维护规则

路由、API、权限、数据合同、状态、限制或视觉源变化时，只更新对应行和中文镜像。
还原台账每条路由只保留一行当前状态，不追加日期实现说明、已废弃设计源或重复测试全文。

English mirror: [miniprogram-system-modules.md](./miniprogram-system-modules.md)
