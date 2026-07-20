# 后台系统当前功能清单

本文档记录 `admin/` 的当前实现。路由、API、模型、权限或工作流变化时，必须同步更新本文件和 `admin-system-modules.md`。

## 状态与范围

- `Implemented`（已实现）：存在真实页面、API 和数据链路。
- `Limited`（有限支持）：仅在特定角色、供应商、数据形态或运行条件下可用。
- `Placeholder`（占位/未开放）：只有 UI、mock、规划动作或没有真实持久化/集成。
- 技术栈：Next.js 16 App Router、React 19、Tailwind CSS 4、shadcn/ui + Radix、Mongoose、MongoDB、Three.js 和客户端数据请求。
- 路由分组：`(platform)` 为平台/B2B 运营，`(merchant)` 为企业工作台资产，公共页面位于 `(admin)`。

## 共享架构

- 外壳和导航：`src/app/(admin)/layout.tsx`、`Sidebar.tsx`、`FetchInterceptor.tsx` 和 `useCurrentUser`。
- 认证与租户：`src/lib/auth.ts`、`session.ts`、`proxy.ts`、`tenant-context.ts`、`tenant-route.ts`、`miniprogram-auth.ts`。
- 租户隔离：使用 `withTenantRoute`、`withTenantContext`、租户解析器和 `multiTenantPlugin`；平台管理员通过 `global_tenant_id` Cookie 切换全局视图。
- 角色：`super_admin`、`admin`、`enterprise_admin`、`designer`、`salesperson`、`measurer`、`viewer`。菜单和默认权限在 `models/AdminUser.ts`，自定义角色在 `models/SystemRole.ts`。
- 共享反馈：可见变更使用 `components/ui/operation-feedback`，常规操作不得使用原生 `alert()`。

## 功能模块

### 1. 登录、注册与会话

- 页面：`/login`、`/register`。
- API：`/api/auth/login`、`/logout`、`/me`、`/miniprogram`、`/register-company`、`/register-enterprise`。
- 模型/工具：`AdminUser`、`User`、`Enterprise`、会话/认证工具、`miniprogram-jwt`。
- 状态：`Implemented`。支持后台会话、企业注册、小程序身份绑定、JWT/Cookie 处理和未授权跳转。
- 用户审计页面：`/users`、`/users/[openid]`，由 `/api/users`、`/users/[openid]`、`/users/me` 支撑，可查询小程序用户及其关联户型导出库，状态为 `Implemented`。

### 2. 导航、角色与访问控制

- 页面：`/roles`、共享 Sidebar、路由守卫。
- API：`/api/roles`、管理员、员工和部门接口。
- 状态：`Implemented`。支持菜单可见性、有效权限、角色默认值、自定义菜单 key、账号状态、部门归属和路由角色校验。

### 3. 平台概览与企业租户

- 页面：`/`、`/enterprises`、`/enterprises/[id]`，以及企业 AI、自动化、企微子页面。
- API：`/api/admin/enterprises`、`/activate`、`[id]`、`[id]/ai-key`、`[id]/ai-sync`、`[id]/ai-usage`、`/api/branding/[id]`。
- 模型/工具：`Enterprise`、`EnterpriseAiUsageSnapshot`、`AdminUser`、`enterprise-ai`、`enterprise-wecom`。
- 状态：`Implemented`。覆盖企业入驻/激活、资料、品牌、自动化、企微、AI 配置/用量和平台概览。

### 4. 员工、部门与系统账号

- 页面：`/staff`、`/admins`。
- API：`/api/staff`、`/staff/[id]`、`/departments`、`/departments/[id]`、`/admin-users`、`/admin-users/[id]`。
- 模型：`AdminUser`、`Department`、`SystemRole`。
- 状态：`Implemented`。支持企业员工、平台管理员、角色、部门树、状态和地推/设计师/测量员关系管理。

### 5. B2B 企业报备与协作工作流

- 页面：`/promotion-records`、`/workflow-logs`。
- API：报备、`/promotion-records/pool`、`/conflicts`、平台报备配置、工作台 summary/todos、通知日志和提醒执行。
- 模型/工具：`PromotionEnterpriseRecord`、`WorkflowNotificationLog`、`promotion-workflow`、`promotion-timeline`、`workflow-automation`、微信/企微通知工具。
- 状态：`Implemented`。支持报备、重复/冲突、公海、认领/审批、分配、业务阶段、跟进时间线、SLA 提醒、通知去重和审计。

### 6. 套餐、订单与提成

- 页面：`/packages`、`/enterprise-orders`、`/commissions`。
- API：`/api/admin/packages`、`/enterprise-orders`、`/commissions`、结算和提成记录接口。
- 模型：`Package`、`EnterpriseOrder`、`CommissionRecord`。
- 状态：`Implemented`。支持套餐目录、企业订单生命周期、付费订单提成生成、提成列表、结算和作废。

### 7. 线索与转化资产

- 页面：`/leads`。
- API：`/api/leads`、`/leads/[id]`、`/leads/[id]/share` 及户型、员工关联接口。
- 模型/工具：`Lead`、`FloorPlan`、`AdminUser`、微信/企微工具。
- 状态：`Implemented`。支持线索录入/状态、跟进、分配、正式户型关联、分享和转化上下文。

### 8. 正式户型、搜索与查看

- 页面：`/floorplans`、`/floorplans/[id]`、`/floorplans/kujiale`、`/measurements`。
- API：户型 CRUD、`/floorplans/[id]/export/dxf`、测量、酷家乐城市/搜索和线索关联接口。
- 组件/工具：`FloorPlanViewer`、`FloorPlanViewerWrapper`、`survey-graph`、`dxf`。
- 状态：正式 v4 墙图解析、后台 2D/3D 查看、闭合户型仅在外边界标注尺寸（共享内墙不标注）、测量筛选和 DXF 下载为 `Implemented`；酷家乐搜索受上游数据和查询条件影响，为 `Limited`。
- 边界：后台从 `surveyGraph` 派生房间/开口渲染数据，不持久化旧 `rooms` 或其他旧布局字段。

### 9. 测量审计与蓝牙设备资产

- 页面：`/devices`、`/measurements`。
- API：设备 CRUD、`/devices/verify`、`/devices/verify-binding`、`/measurements`。
- 模型：`Device`、`Measurement`、`User`。
- 状态：`Implemented`。支持设备池、企业/用户绑定、校验、状态管理，以及来源为 BLE、手动或系统的长度/高度/面积/角度/门窗审计记录。

### 10. AI 工作室与设计生成

- 页面：`/ai-studio/scenarios` 是唯一 AI 执行工作台，包含“客户方案、快速工具、AI 助手”；旧 `/ai-studio/designer`、`/ai-studio/floor-plan`、`/ai-studio/furnishing`、`/ai-studio/soft-furnishing` 和方案详情 URL 保留相关查询参数后跳入统一工作台。资源/配置入口继续为 `/inspirations`、`/ai-presets`、`/ai-providers`、`/ai-credit-prices`，企业 AI 页继续管理统一点数。
- API：AI 对话/Agent、生成/渲染/建议、状态/历史、预设、工作流搜索分页及阶段、设计能力/共享动作目录、媒体资源、供应商 CRUD/密钥轮换/连通测试/模型同步/上游余额查询、受保护任务对账、平台业务动作价格、企业点数发放/调整/流水/任务和失败任务重试接口。旧企业 `ai-key`/`ai-sync` 仅保留只读兼容，写接口返回 `410`。
- 模型/工具：`AiGeneration`、`AiWorkflow`、`AiChatSession`、`AiStylePreset`、`AiProviderConfig`、`AiProviderAttempt`、`MediaAsset`、`AiCreditAccount`、`AiCreditLedger`、`AiCreditPrice`、`Inspiration`、`src/lib/ai/*`。
- 状态：`Implemented`。工作台以“客户/素材/目标”向导发起方案，双栏工作区突出当前定稿、候选版本和唯一推荐下一步；共享动作目录统一名称、输入、计费键、支持端、结果边界和推荐动作。旧 AI 执行权限键兼容解析为 `ai-scenarios`，角色配置只展示一个“AI 设计”，不会扩大 B2B 渠道 `salesperson` 的数据边界。后台与小程序共用企业 AI 点数和 `AiWorkflow`；带客户/正式户型上下文的小程序参考复刻、整体换风格、户型概念图和软装深化分别映射到后台基准、彩平转透视和软装阶段。基准/软装阶段首个成功版本自动采用并推进，同阶段后续成功版本只成为候选，须手动采用才推进；同方案同阶段存在活动任务时拒绝重复冻结和上游提交。成功基准可继续提案/灯光。后台工作流的纯户型图片生成会把正式 v4 墙图的尺寸、层高与开口摘要加入提示词，不要求伪造来源图片，也不修改 `FloorPlan.layoutData`。任务创建冻结、正式结果持久化后扣费、明确失败释放；平台 `super_admin`/`admin` 可管理供应商、轮换凭证、测试/同步模型、查询 GRS API Key 上游积分余额、执行对账、发放/调整点数、配置业务动作价格及企业允许功能/`standard` 逻辑档位，企业员工只消费。GRS 连通测试使用积分余额接口同时校验 Host 与 API Key；其节点不支持 `/v1/models` 时，模型同步保留并返回后台配置的模型映射。业务层使用逻辑模型键和 `AiExecutionService`；GRS 图片按当前文档向 `POST /v1/api/generate` 提交 `replyType: "async"`，并通过 `GET /v1/api/result?id=...` 轮询，`violation`/`failed` 均按已退款失败处理，临时结果必须先保存到 `MediaAsset`。仅连接失败、明确未受理或已确认退款时切备用；已受理、超时或状态未知不会创建第二个上游任务并继续冻结。上游成本和余额与企业 AI 点数分账记录：企业购买平台点数，运营方按资金池预警批量补充供应商余额，不做逐笔充值联动。上游成本按原币种微单位单独记录，不改变业务点数价格。供应商页的能力与逻辑/远程模型字段用于路由；成本币种和预计成本只用于内部核算，可为 0 且不发送给供应商。`Limited`：其他适配器的余额/模型发现取决于供应商协议，首期不接微信/自助充值和低余额自动告警，生产媒体仍需持久共享存储。
- 迁移/运维：现有数据库启用新路由前运行 `npm run migrate:ai-platform`；脚本保留既有 AI 点数原值、为缺失企业创建 0 点账户、不转换 Pollen，并迁移旧生成/预设和写入环境变量供应商配置。点数价格初始化会移除旧版唯一 `mode_1` 索引，避免无 `mode` 的平台动作价格因重复 `null` 导致能力接口失败；`actionKey_1` 仍是价格记录的唯一业务索引。定时调用 `/api/ai/reconcile` 时配置 `AI_RECONCILIATION_SECRET`。

### 11. 小程序支撑与跨端 API

- API：`/api/auth/miniprogram`、`/api/miniprogram/home`、`/mine`、小程序 AI 能力/来源/方案/媒体/任务/历史接口，以及共享线索、户型、测量、提成、订单、报备接口。
- 状态：`Implemented`。负责小程序身份、员工上下文、首页/我的工作台、定位、品牌、共享业务资产和企业员工 AI 设计；AI API 强制 Bearer JWT、企业和操作员归属校验，`/api/miniprogram/ai/sources` 只暴露当前角色可访问的正式户型和闭合房间。显式方案直接续接；同客户/户型只有一个活动方案时自动复用，存在多个方案时必须由客户端选择，不会静默合并，并可明确新建备选方案。

### 12. 通知、自动化与诊断

- API：提醒执行、通知列表/轮询、`/api/health`、`/api/debug`、`/api/debug/tenant-context`、`/api/internal/seed`。
- 状态：提醒、浏览器轮询、通知日志、健康/调试、种子和 Docker/发布工具为 `Implemented`；接口仍需遵守对应角色和运行环境限制。

## 核心模型

- 身份：`AdminUser`、`SystemRole`、`User`、`Department`。
- 租户/商业：`Enterprise`、`Package`、`EnterpriseOrder`、`CommissionRecord`、`PromotionEnterpriseRecord`。
- 客户资产：`Lead`、`FloorPlan`、`Measurement`、`Device`、`Inspiration`。
- AI/媒体：`AiGeneration`、`AiWorkflow`、`AiChatSession`、`AiStylePreset`、`AiProviderConfig`、`AiProviderAttempt`、`MediaAsset`、`AiCreditAccount`、`AiCreditLedger`、`AiCreditPrice`；`EnterpriseAiUsageSnapshot` 仅保留为 Pollinations 历史数据。
- 通知/配置：`WorkflowNotificationLog`、`PlatformConfig`。

## 维护清单

修改后台页面、API、模型、工作流或共享组件前，先阅读根目录/后台目录指令和本中英文清单。完成后必须在同一份 diff 中更新页面/API、数据行为、权限边界、状态和限制，并检查 Sidebar 菜单 key、`proxy.ts`、角色默认权限、租户解析、模型索引和操作反馈。没有真实路由、处理器和持久化/供应商链路的 roadmap 项目不得标记为已实现；如果确实没有功能文档影响，必须在交接说明中明确写出。
