# Admin 后台系统功能模块清单

本文档整理当前 `admin` Next.js 后台系统的功能模块。每次后台路由、API、权限、模型或业务流程变化时，必须同步更新 `docs/admin-system-modules.md` 和本中文版文件。

## 范围

- 应用根目录：`admin/src/app`。
- 框架：Next.js App Router，后台路由按 `(admin)`、`(platform)`、`(merchant)` 分组。
- 数据层：`admin/src/models` 下的 Mongoose 模型连接 MongoDB。
- 租户模型：主要业务数据通过 `withTenantContext`、`withTenantRoute` 和 `multiTenantPlugin` 做企业租户隔离。
- 主要角色：`super_admin`、`admin`、`enterprise_admin`、`designer`、`salesperson`、`measurer`、`viewer`。

## 共享架构

- 后台外壳：`admin/src/app/(admin)/layout.tsx`、`admin/src/components/Sidebar.tsx`、`admin/src/components/FetchInterceptor.tsx`。
- 登录/会话：`admin/src/lib/auth.ts`、`session.ts`、`tenant-context.ts`、`tenant-route.ts`、`miniprogram-auth.ts`、`proxy.ts`。
- UI 基础组件：`admin/src/components/ui/*`，包括共享的 `operation-feedback`。
- 租户隔离：`admin/src/lib/mongoose-tenant-plugin.ts` 中的模型插件；平台管理员可通过 `global_tenant_id` 做全局企业视图切换。
- 权限：菜单 key 和默认权限在 `admin/src/models/AdminUser.ts`；角色权限覆盖使用 `admin/src/models/SystemRole.ts`。

## 功能模块

### 1. 登录、注册和会话管理

- 页面：`/login`、`/register`。
- API：`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`、`/api/auth/miniprogram`、`/api/auth/register-company`、`/api/auth/register-enterprise`。
- 模型/工具：`AdminUser`、`User`、`Enterprise`、`session.ts`、`auth.ts`、`miniprogram-jwt.ts`。
- 职责：后台登录/退出、会话校验、企业注册、小程序登录绑定、JWT/cookie 处理，以及 401 自动跳转。

### 2. 导航、角色和访问控制

- 页面：共享后台布局、`/roles`。
- API：`/api/roles`。
- 模型/工具：`AdminUser`、`SystemRole`、`staff-access.ts`、`proxy.ts`。
- 职责：菜单可见性、路由权限校验、默认角色权限、自定义角色菜单 key，以及侧边栏有效权限计算。

### 3. 平台仪表盘和全局运营视图

- 页面/组件：`/`、`PlatformDashboard`。
- 依赖 API：`/api/users`、`/api/floorplans`、`/api/admin/enterprises`。
- 职责：平台级用户、户型资产、入驻企业和系统运行概况统计。

### 4. 企业租户管理

- 页面：`/enterprises`、`/enterprises/[id]`、`/enterprises/[id]/ai`、`/enterprises/[id]/automation`、`/enterprises/[id]/wecom`。
- API：`/api/admin/enterprises`、`/api/admin/enterprises/[id]`、`/api/admin/enterprises/activate`、`/api/admin/enterprises/[id]/ai-key`、`/api/admin/enterprises/[id]/ai-sync`、`/api/admin/enterprises/[id]/ai-usage`、`/api/branding/[id]`。
- 模型/工具：`Enterprise`、`EnterpriseAiUsageSnapshot`、`AdminUser`、`enterprise-wecom.ts`、`enterprise-ai.ts`。
- 职责：企业入驻、激活、租户资料、品牌色/logo、自动化 SLA 配置、企微配置、企业 AI key/运行时配置和 AI 用量概览。

### 5. 系统管理员、员工和部门

- 页面：`/admins`、`/staff`。
- API：`/api/admin-users`、`/api/admin-users/[id]`、`/api/staff`、`/api/staff/[id]`、`/api/departments`、`/api/departments/[id]`。
- 模型/工具：`AdminUser`、`Department`、`SystemRole`。
- 职责：平台管理员账号、企业员工账号、员工角色、部门树、账号状态管理和权限分配。

### 6. B2B 企业报备和协作流程

- 页面：`/promotion-records`、`/workflow-logs`。
- API：`/api/promotion-records`、`/api/promotion-records/[id]`、`/api/promotion-records/conflicts`、`/api/promotion-records/pool`、`/api/platform/promotion-config`、`/api/workbench/summary`、`/api/workbench/todos`、`/api/workflow-notification-logs`、`/api/workflow-notification-logs/poll`。
- 模型/工具：`PromotionEnterpriseRecord`、`WorkflowNotificationLog`、`promotion-workflow.ts`、`promotion-timeline.ts`、`workflow-automation.ts`、`wechat-notification.ts`。
- 职责：地推企业报备、重复/冲突处理、公海和认领流程、跟进 SLA、量房/设计任务分配、商机阶段时间线、协作待办、提醒和通知日志。

### 7. 套餐、订单和提成结算

- 页面：`/packages`、`/enterprise-orders`、`/commissions`。
- API：`/api/admin/packages`、`/api/admin/packages/[id]`、`/api/enterprise-orders`、`/api/enterprise-orders/[id]`、`/api/commissions`、`/api/commissions/[id]/settle`、`/api/commission-records`、`/api/commission-records/[id]`。
- 模型/工具：`Package`、`EnterpriseOrder`、`CommissionRecord`。
- 职责：套餐目录、企业成交订单、地推提成计算、提成记录和结算操作。

### 8. 线索和客户转化

- 页面：`/leads`。
- API：`/api/leads`、`/api/leads/[id]`、`/api/leads/[id]/share`。
- 模型/工具：`Lead`、`FloorPlan`、`AdminUser`、`wecom.ts`、`wechat-notification.ts`。
- 职责：客户线索录入、状态跟踪、关联户型图、新版测绘原型草稿可见、地推/设计师分配、跟进记录、企微群创建和线索分享。

### 9. 户型图、量房记录和设备

- 页面：`/floorplans`、`/floorplans/[id]`、`/measurements`、`/devices`。
- API：`/api/floorplans`、`/api/floorplans/[id]`、`/api/floorplans/[id]/export/dxf`、`/api/measurements`、`/api/devices`、`/api/devices/[id]`、`/api/devices/verify`、`/api/devices/verify-binding`。
- 模型/工具：`FloorPlan`、`Measurement`、`Device`、`User`、`dxf.ts`、`FloorPlanViewer`。
- 职责：量房户型数据存储、布局查看、新版测绘原型墙图只读展示、正式布局 DXF 导出、蓝牙测距设备管理、设备绑定校验和量房审计日志。

### 10. AI 工作室和设计生成

- 页面：`/ai-studio/designer`、`/ai-studio/scenarios`、`/ai-studio/scenarios/[id]`、`/ai-studio/floor-plan`、`/ai-studio/floor-plan/[id]`、`/ai-studio/furnishing`、`/ai-studio/soft-furnishing`、`/inspirations`、`/ai-presets`。
- API：`/api/ai/agent`、`/api/ai/agent/actions`、`/api/ai/conversations`、`/api/ai/conversations/[id]`、`/api/ai/generate`、`/api/ai/render`、`/api/ai/advice`、`/api/ai/soft-furnishing/render`、`/api/ai/history`、`/api/ai/status/[id]`、`/api/ai/usage`、`/api/ai/quota`、`/api/ai/presets`、`/api/ai/presets/[id]`、`/api/ai/workflows`、`/api/ai/workflows/[id]`、`/api/ai/workflows/[id]/run-stage`、`/api/ai/workflows/[id]/source-image`、`/api/ai/workflow-leads`、`/api/ai/assets/[id]/image`、`/api/ai/generations/[id]/image`、`/api/ai/image-proxy`、`/api/inspirations`。
- 模型/工具：`AiGeneration`、`AiWorkflow`、`AiChatSession`、`AiStylePreset`、`AiQuota`、`EnterpriseAiUsageSnapshot`、`MediaAsset`、`Inspiration`、`ai/*`、`gemini.ts`、`dxf.ts`。
- 职责：AI 设计师聊天、设计场景工作流、户型标注/渲染、风格渲染、软装渲染、提示词/预设配置、生成历史、用量/额度校验、媒体资产持久化和灵感库。

### 11. 小程序支撑 API

- API：`/api/auth/miniprogram`、`/api/miniprogram/home`、`/api/miniprogram/mine`、`/api/location/reverse`、`/api/branding/[id]`。
- 模型/工具：`User`、`AdminUser`、`Enterprise`、`FloorPlan`、`Lead`、`Measurement`、`CommissionRecord`、`EnterpriseOrder`、`PromotionEnterpriseRecord`。
- 职责：小程序身份上下文、首页数据、我的/个人数据、逆地理编码、品牌信息查询和跨端业务数据访问。

### 12. 自动化、通知和提醒

- API：`/api/automation/reminders/run`、`/api/workflow-notification-logs`、`/api/workflow-notification-logs/poll`。
- 模型/工具：`WorkflowNotificationLog`、`workflow-automation.ts`、`wechat-notification.ts`、`enterprise-wecom.ts`、`wecom.ts`、`useBrowserNotification.ts`。
- 职责：定时提醒执行、通知去重、浏览器通知轮询、小程序/微信通知和企业企微集成。

### 13. 诊断、种子数据和部署支撑

- API：`/api/health`、`/api/debug`、`/api/debug/tenant-context`、`/api/internal/seed`。
- 工具：`admin/scripts/seed-admin.js`、`seed-inspirations.ts`、`Dockerfile`、`docker-compose.yml`、`deploy.sh`、`release.sh`。
- 职责：健康检查、租户上下文调试、种子数据、Docker 部署和发布打包。

## 核心数据模型

- 身份和权限：`AdminUser`、`SystemRole`、`User`、`Department`。
- 租户和商业运营：`Enterprise`、`Package`、`EnterpriseOrder`、`CommissionRecord`、`PromotionEnterpriseRecord`。
- 客户资产：`Lead`、`FloorPlan`、`Measurement`、`Device`、`Inspiration`。
- AI 系统：`AiGeneration`、`AiWorkflow`、`AiChatSession`、`AiStylePreset`、`AiQuota`、`EnterpriseAiUsageSnapshot`、`MediaAsset`。
- 通知：`WorkflowNotificationLog`、`PlatformConfig`。

## 维护说明

- 在 `admin/src/app/(admin)` 下新增页面时，要检查 `Sidebar.tsx` 的菜单权限、`proxy.ts` 的路由守卫，以及 `AdminUser.ts` 的默认角色权限。
- 新增涉及租户数据的 API 时，优先使用 `withTenantRoute` 或 `withTenantContext`，并确认相关模型在需要时使用 `multiTenantPlugin`。
- 用户可见的后台管理操作应使用共享操作反馈 UI，不要使用原生 `alert()` 作为常规反馈。
- 扩展 AI 工作流时，要同步页面路由、API 路由、`AiGeneration`/`AiWorkflow` 模型类型、预设定义和本文档对。
- 改动 B2B 报备流程状态或 SLA 行为时，要同步 `PromotionEnterpriseRecord`、工作流工具、通知日志、工作台 API 和本文档对。
