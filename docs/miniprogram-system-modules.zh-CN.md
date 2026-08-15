# 小程序当前功能清单

本文只描述原生微信小程序当前运行入口、合同、权限和限制。日期还原记录和
测试全文由 Git 历史或本地证据保留。

## 运行环境与共享上下文

- 原生微信小程序，使用自定义 TabBar、亮绿色设计 token，视觉基准为 iPhone 13 Pro
  `390x844`。
- 会话使用 `/api/auth/miniprogram` 和 bearer JWT。专业员工、企业上下文、线索、
  户型、AI 任务、提成和报备记录都通过共享租户 API 解析。
- 主操作使用本地存储且有许可证记录的图标；原生右上角胶囊和安全区不得被内容覆盖。
- `Implemented`、`Limited`、`Placeholder` 只表示可执行运行时行为，不代表标签或 mock 响应。

## 页面清单

| 界面 | 运行路由 | 当前合同 | 状态/限制 |
| --- | --- | --- | --- |
| 首页与量房入口 | `pages/index/index` | 角色化首页、线索/项目卡片、正式量房入口 | Implemented；数据按租户和角色返回 |
| 线索与客户 | `pages/leads-management/leads-management`、`packages/business/lead-form/lead-form`、`packages/business/lead-detail/lead-detail` | 线索列表/详情、获客协作、签约状态、正式户型摘要 | Implemented；签约权限由服务端执行 |
| 报备与员工任务 | `packages/business/promotion-records/promotion-records`、`packages/business/promotion-record-detail/promotion-record-detail`、`packages/business/acquisition-center/acquisition-center` | 企业报备、员工任务和通知 | Implemented/Limited；微信投递可能被外部拒绝 |
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
读数、审计队列、撤销/重做和保存失败行为都必须遵守该合同。

## 共用 API 与工具

- 身份/上下文：`/api/auth/miniprogram` 及共用上下文解析器。
- 线索、户型、测量、设备、AI、提成、报备和通知使用对应的租户 API 族。
- 几何与 Canvas 源文件为 `miniprogram/utils/surveyWallGraph.js`、
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js` 及量房尺寸/实体规划器。
- BLE 集成位于 `miniprogram/utils/bluetooth.js`；协议语义以仓库厂商文档为准。

## 维护规则

路由、API、权限、数据合同、状态、限制或视觉源变化时，只更新对应行和中文镜像。
还原台账每条路由只保留一行当前状态，不追加日期实现说明、已废弃设计源或重复测试全文。

English mirror: [miniprogram-system-modules.md](./miniprogram-system-modules.md)
