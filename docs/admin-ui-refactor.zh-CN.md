# 后台 UI 当前约定

本文只记录当前后台 UI 规则和已批准重构方向的最新状态，不记录迁移流水。
早期重构过程由 Git 历史保留。

## 共用约定

- Next.js App Router 页面使用既有 Ant Design 5 和 Ant Design Pro 系统，包含共享的 `AdminAntdProvider` token 配置。
- 在适合工作流时使用 `PageContainer`、`ProTable`、Ant Design 表单/反馈 primitive 及既有后台业务组件；新的后台工作不得引入平行 UI 系统。
- 页面内容区兄弟区块保持 20px 间距；页头附加操作换行而不是挤压标题；表格、筛选和操作标签保持单行。以链接渲染或包在 `Link` 内的按钮仍使用按钮自身的文字色，避免主色绿底或危险按钮看不清字。
- 保持路由、API、租户、角色和操作边界不变。
- 可复用后台控件放在 `admin/src/components/admin/*` 或既有业务组件目录。
- 所有可见后台变更使用共用成功/失败操作反馈 UI。
- 视觉检查使用 `http://localhost:3006`；认证流程使用用户现有 Chrome 会话。

## 路由记录格式

每条路由最多保留一条当前记录：

| 字段 | 必填内容 |
| --- | --- |
| 路由 | 当前 pathname 和页面归属 |
| 视觉范围 | 当前修改或还原的界面范围 |
| 边界 | 未改变的 API、权限、租户和导航合同 |
| 核验 | 最近一次聚焦测试、构建或视觉证据 |
| 未决项 | 当前仍存在的风险或下次重开触发条件 |

路由再次变化时直接替换旧记录。不要追加日期进度、已废弃设计源或重复测试
全文。

## 当前队列

通用重构请求只能选择未记录或明确排队的路由。标记为 `Hold` 的路由只有在
用户点名、存在可复现缺陷、工作流合同变化或获得新的设计方向批准时才能重开。

## 当前路由记录

| 路由 | 视觉范围 | 边界 | 核验 | 未决项 |
| --- | --- | --- | --- | --- |
| `/lead-commissions` — 商户三方提成工作台 | 批准第 7 阶段设计源之上的功能态增量：台账按线索主行展开（主行展示客户/人员/预约、提成合计与状态摘要；子表展示角色/规则/应付/状态/调整，默认展开）；待支付行「调整」弹窗（须改金额和/或受益人；受益人与原因选填；原始应付提示与已调整标记）。子表状态标签（待支付/已支付/已作废/已调整）贴合文案宽度（`Flex align="flex-start"`），不再被列宽横向撑满。规则卡与台账筛选（含线索来源）保持不变 | 路由/API 权限 `lead-commissions` 仍限 `super_admin`/`admin`/`enterprise_admin`；`PATCH /api/lead-commissions/[id]` 的原因与受益人选填，但仍须至少变更金额或受益人；`GET /api/lead-commissions/beneficiaries?role=` 不变。台账推荐人列仍走成员资料 | 子表状态标签不再横向撑满列宽；主行勾选同步该线索下全部待支付子行，子表可单独勾选；分页按线索计；认证 Chrome 视觉核验可选 | 仅在批准设计改变、观察到有数据台账的布局缺陷，或工作流/权限合同变化时重开 |
| `/referrer-network-operations` — 推荐网络运营与验收工作台 | 沿用既有 Ant Design/Admin Pro 方向：就绪数字、每行都提供真实处理入口的状态验收清单（含**企业安全密码**，点击打开侧栏头像账户菜单中的共享设置弹窗，不再内嵌卡片）、最近 5 条双码审计预览（动作/结果为中文标签），以及**当前企业测试数据危险操作**卡片（预览计数、重跑保留操作者说明、企业全名确认、「清空并重跑入驻」与「删除整家企业（含企业壳）」两档）。双码作业、推荐人名册、派单资格全表和完整审计不再放在本页。推广服务码就绪项将已持久化活动码数量与活动成员关系分开呈现，并跳转到 `/referrers`。小程序服务码能力只呈现可用性，并链接当前企业的送达诊断，不将平台凭据误称为企业可配置项 | 路由与 `referrer-network-operations` 权限继续限当前租户的 `super_admin`、`admin`、`enterprise_admin`。并列页 `/join-codes`、`/referrers`、`/appointment-settings` 复用该权限。`GET/PUT /api/enterprise/sensitive-password` 仅 `enterprise_admin`，写入 `enterprises.sensitive_operation_password_hash`（bcrypt，明文不回读）；设置 UI 在侧栏头像 `AccountSettingsProvider` 中，不在本页。清空 API `GET/POST /api/enterprise/enterprise-reset*` 与整企删除 `POST /api/enterprise/enterprise-purge`（预览 `?mode=purge`）复用同一权限，须企业全名确认；`NODE_ENV=production`（含 Docker Compose / `next start`）默认拒绝，仅 `.env.production` 中 `ALLOW_TENANT_ENTERPRISE_RESET=true` 并重建容器时允许。预览失败时卡片展示接口错误。重跑保留企业壳与当前操作者员工行；整企删除不保留任何员工，并删状态事件与企业行（仅清空 `users.enterprise_id`）。成功后商户负责人登出至 `/login`，平台管理员跳转 `/enterprises`。预约默认值在管理员保存前保持“待处理”；工作台不创建测试数据，也不绕过客户授权。审计 `eventType`/`result` 展示复用共享 `code-audit-labels` | 聚焦 PostgreSQL 租户清空/整企删除、归因、中文审计标签、登录密码与企业安全密码合同测试通过。安全密码设置弹窗 GET 仅在打开时请求，读取时不刷新就绪接口。危险操作卡片预览失败时展示接口错误（含生产环境闸门）。拆分后的登录态视觉核验待补 | 仅在出现清单/清空/整企删除/安全密码/审计标签缺陷，或工作流/权限合同变化时重开 |
| `/join-codes` — 企业员工/推荐人入驻码 | 沿用既有 Ant Design/Admin Pro 方向：两张双码卡片提供换新/停用，并在卡片内直接展示当前有效二维码供查看/下载（不换新、不限时隐藏），同时展示完整双码审计（动作/结果经共享 `code-audit-labels` 显示中文）。令牌不出现在后台页或列表 DTO；二维码仍为当前页会话内的私有 no-store Blob | 复用 `GET /api/enterprise/join-codes`（双码 + 审计）及既有换新/停用/图片接口，权限为 `referrer-network-operations`。图片接口只还原当前生效令牌，不换新。不在本页创建员工或推荐人记录 | 归因与中文审计标签合同测试通过。认证 Chrome 核验待补 | 仅在双码合同变化或出现可复现二维码/审计缺陷时重开 |
| `/referrers` — 企业推荐人名册 | 沿用既有 Ant Design/Admin Pro ProTable：姓名、手机号、加入时间、活动推广码、成员状态、姓名/手机号搜索和停用后续扫码。无后台新建表单 | 复用 `GET /api/enterprise/referrer-memberships` 与 `POST /api/enterprise/referrer-memberships/[id]/disable`，权限为 `referrer-network-operations`。停用不改写历史线索和提成 | 聚焦 PostgreSQL 名册测试通过。认证 Chrome 核验待补 | 仅在成员合同变化或出现可复现名册缺陷时重开 |
| `/appointment-settings` — 企业预约策略 | 沿用既有 Ant Design/Admin Pro 设置单方向：确认状态、时区、七天多时段开放时间和预约数值边界，只有一个主保存动作 | 复用 `GET/PUT /api/appointment-settings` 与 `referrer-network-operations` 权限，限已选租户的 `super_admin`、`admin`、`enterprise_admin`；商户侧栏现将该路由放在「推荐网络」分组。保存会确认默认策略，不改变预约岗位 API | 聚焦 ESLint 与 `npm run build` 通过。认证 Chrome 已在 `http://localhost:3006` 确认确认状态、七天排期、增加时段交互、预约边界和可用保存动作 | 仅在策略合同变化或出现可复现表单缺陷时重开 |
| `/` — 设计师/测量员员工工作台与企业负责人业务概览 | 沿用 Ant Design/Admin Pro 首页：保留库存三卡（负责人）；插入只读周期经营大盘（本周/本月默认/本年 + 自定义 RangePicker）与五卡 KPI（新增线索、已完成量房、方案交付率、已签约、签单率=同窗已签约÷新增线索）。员工为个人归因且不展示签约金额；企业负责人为全店并可展示签约金额 detail。设计源：`design-references/admin-merchant-dashboard-v1/`（`01`–`04`）。首页原「协作待办」整块（企业报备数、旧待分配/超时待办、旧待结算提成）已移除——属于旧企业报备协作链路，不是推荐网络线索漏斗。测量员仍提示正式 BLE 量房在小程序 | 首页按后台 Cookie 角色渲染。共享 `loadOpsDashboard` 同时服务 `GET /api/workbench/ops-dashboard`（后台 Cookie）与 `GET /api/miniprogram/workbench?period=`（小程序）。`GET /api/workbench/staff` 仍只返回个人待办队列。旧 `/api/workbench/summary` 与报备待办仍可供 `/promotion-records` 使用，但企业首页不再请求。不改变 `/leads`、`/measurements`、`/floorplans`、AI 路由与正式量房权限边界 | 共享周期与签单率单测通过；Admin 面板已接入 MerchantDashboard/StaffWorkbench；企业首页已去掉旧协作条。对照 `01`–`04` 的角色登录态视觉核验待补 | 仅在 KPI 口径、周期边界、归因范围或正式量房入口合同变化时重开 |
| `/leads` 与 `/leads/[id]` — 线索操作与预约交接 | 既有 Ant Design ProTable 转化卡片视觉不变，仅在设计师/测量员 `LeadStaffCardField` 上按 DTO `assignmentActions` 增加小型「分配/更换」。弹窗 `Select` 数据来自 `GET /api/leads/[id]/assignable-staff?role=`，提交 `POST /api/leads/[id]/assign-staff`，成功和 409 走共享 `notify`。已绑定设计师只看到测量员操作；测量员无改派入口。「重试派单」仍只走自动池。导出工具栏、浅色 16px 节奏、20px 头底内边距、卡内改期和 `/leads/[id]` 抽屉交接保持既有还原 | `PUT /api/leads/[id]` 仍拒绝改 `assignedTo`。租户范围、归档/关闭禁止、导出/安全密码、设计师仅操作本人线索的限制不变。员工覆盖改派、角色矩阵、`assignmentActions`、线索范围花名册、已确认预约改写（`staff_reassigned`，测量员时段冲突 409 且排除本条）现属工作流合同 | 聚焦 `lead-assignment-actions`、`lead-assign-staff`、`referral-lead` 与后台 `/leads` notify 合同测试；布局间距视觉核验未重跑 | 仅在出现有数据卡片布局缺陷、响应式裁切、导出/安全密码合同变化，或预约/员工改派工作流合同再次变化时重开 |
| `/ai-studio/scenarios` — 商户 AI 工作台 | 全屏独立窗口（无后台侧栏）：左侧沿用当前客户/方案对话列表，右侧用创作台出图条（应用到哪里：默认完整户型或闭合单房间，说明「只应用到当前选择…」、模型/张数/比例/分辨率、提示词模板、参考图槽锁定展示当前作用域控制图缩略图（选闭合房间时为该房间裁切图）、额外用户参考图（选用模板时会把封面克隆进该槽）、轮次宫格、发送给客户）。作用域选择器触发器只用短标签，生成按钮留在出图条框内。对话标题旁展示绑定户型的 canvas 快照供设计师对照（可放大、与效果图左右对照、打开正式户型），效果与 `/floorplans/[id]` 的墙体、门窗、尺寸和房间标注一致。只看效果图时使用受限预览视口，并复用创作台已有的放大、缩小、1:1、顺时针旋转、全屏和下载快捷操作。夜间主题对齐创作台，新建/发送弹窗的取消按钮复用既有深色次级控件令牌，确保文字可读；日间用后台 `#16a34a` / `#f6f8f6`，选择会记住。共享工作台/创作控件（`workbench-workspace`、`creation-workspace`、提示词模板库、图片编辑器）已改用 Ant Design `Button` / `Modal` / `Input` / `Select` / `Dropdown` 并通过主题 className 适配；`notify` 仍为共享操作反馈。「基于此图继续」直接加入由服务端解析的生成图资产，不再由浏览器读取对象存储 URL，避免 CORS 或重定向使卡片操作无响应。常驻深色的提示词模板库与图片编辑器弹窗自带 `studioDarkAntdTheme`，从日间主题打开时 Ant Design 控件仍然清晰可读。全屏工作室路径由 `AdminAntdProvider` 包裹。出图条提示词文本域在对话框上半区撑满可用高度；「发送给客户」禁用态改为深灰底+灰字（日间浅绿底），避免紫底白字对比不足；顶栏去掉独立「返回管理后台」图标入口，仍可通过品牌 Logo 回首页；加载失败态保留「返回管理后台」文字按钮。出图条「应用到哪里」作用域选择（默认完整户型 + 闭合单房间；未绑户型时隐藏该选择器，批次不传范围）、批次携带 `targetScope`/`roomId`，轮次展示作用域标签 | 路由仍为 `/ai-studio/scenarios`，权限为租户 `ai-scenarios`，侧栏新开标签。已量房线索开对话仍绑合格正式 v4 户型；未量房线索可新建仅绑线索的 `rough_sketch` 对话（隐藏「应用到哪里」，批次不传范围），仍可发给客户。出图走 `POST /api/ai/creation/tasks/[id]/batches`，带 `workflowId` 与可选 `targetScope`/`roomId`（默认完整户型），按作用域把控制图作为首张参考图上传（整屋快照或单房间裁切），在批次快照写入 `roomData`/作用域并绑定该对话；工作台详情返回闭合房间列表供选择。`GET /api/ai/workflows/[id]/floor-plan-preview` 只给设计师看整屋快照，加 `?roomId=` 则看对应房间裁切图。方案图集仍走 `POST /api/leads/[id]/ai-scheme-publications`。小程序单图发布 API 保留；`POST /api/ai/creation/assets/from-generation` 仍按企业范围校验且只返回本租户已成功结果 | 出图条参考图槽按当前作用域展示锁定控制图，未绑户型时隐藏「应用到哪里」；`workbench-studio` 与 `photo-scheme-contract` 覆盖房间预览 URL 与未量房新建对话；PostgreSQL 预览测试覆盖 `roomId` 裁切与无效房间；双主题登录态视觉核验待执行 | 仅在工作流/权限合同变化或出现可复现布局缺陷时重开 |
| `/ai-studio/create` — 自由创作台 | 保留既有夜间创作台构图（`#7047ff` 强调色、深色底面）。共享 AI 创作组件将 shadcn `Button` / `Dialog` / `Input` / `Select` / `Textarea` / `DropdownMenu` 换成 Ant Design 5 `Button` / `Modal` / `Input` / `Input.TextArea` / `Select` / `Dropdown`，用 className/`popupClassName` 与工作室 `ConfigProvider`（`studioDarkAntdTheme`）保持深色主题。「基于此图继续/引用为参考图」改由服务端直接加入当前租户的生成图资产，不再让浏览器读取对象存储 URL，避免重定向或 CORS 使点击无效。共享 `notify` 位于 `@/components/admin/operation-feedback` | 路由、创作 API、租户 `ai-creation` 权限与业务流程不变；共享生成图引用端点仍按企业范围校验 | 共享 AI 创作文件聚焦 ESLint；`http://localhost:3006/ai-studio/create` 深色主题登录态视觉核验待补 | 仅在创作台工作流/权限合同变化或出现可复现深色控件布局缺陷时重开 |
| `/ai-studio/floor-plan`、`/ai-studio/furnishing`、`/ai-studio/soft-furnishing`、`/ai-studio/floor-plan/[id]`、`/ai-studio/designer` — 商户 AI 工具页 | 保留既有工具页构图（额度条、户型/风格选择、生成动作、历史）。页面与共享助手（`AiQuotaBar`、`RechargeDialog`、`ai-tool-frame`、`ChatInterface`、`workflow-runner`、`ImageCropperDialog`）将 shadcn `Button` / `Badge` / `Select` / `Dialog` / `Sheet` 换成 Ant Design `Button` / `Tag` / `Select` / `Modal` / `Drawer` | 路由、AI 生成/历史/额度 API 与租户 AI 权限不变；仅视觉控件库改为 Ant Design | 工具页与共享 AI studio 助手聚焦 ESLint；认证登录态视觉核验待补 | 仅在工具工作流/权限合同变化或出现可复现控件布局缺陷时重开 |

| `/enterprise-registration-codes` — 平台小程序开户码 | 沿用既有 Ant Design/Admin Pro 方向：单张生效码卡片提供换新/停用，并在卡片内直接展示当前有效二维码供查看/下载（不换新、不限时隐藏），可选复制 Web `/register` 邀请链接，并展示近期审计（动作/结果经共享 `code-audit-labels` 显示中文）。令牌不出现在后台页或列表 DTO；二维码仍为当前页会话内的私有 no-store Blob | 仅平台 `super_admin`/`admin`；复用 `enterprises` 菜单权限与 `GET/POST /api/admin/enterprise-registration-codes`（及 `rotate` / `disable` / `image`，`requireEnterprise: false`）。商户 `ej_` 入驻码仍在 `/join-codes` | 聚焦仓储、自助开户、后台二维码查看与中文审计标签合同测试通过。认证 Chrome 核验待补 | 仅在开户码合同变化或出现可复现二维码/审计缺陷时重开 |
| `/mini-program-code-settings` — 全局小程序码环境 | 沿用既有 Ant Design 5/Admin Pro 设置单方向：开发版 / 体验版 / 正式版三段选择、当前状态标签、单一保存动作，并明确提示历史图片不被改写 | 路由和 `GET/PATCH /api/platform/mini-program-code-config` 仅限平台 `super_admin`/`admin`；只改变后续企业入驻码（`ej_`）、平台开户码（`er_`）、推荐推广码和员工活动码图片的生成环境 | 聚焦 lint 与含开户码在内的图片接口生成合同测试覆盖；认证登录态视觉核验待补 | 仅在观察到设置页缺陷，或码环境/API/权限合同变化时重开 |
| `/floorplans/[id]` — 正式户型 2D 查看器 | 保留现有详情壳（返回、标题、墙体/空间/门窗/节点统计、导出 CAD）。把独立 SVG 重建换成小程序 `surveyCanvasRenderer` 画布：去掉编辑 session 后绘制已确认墙体、门窗、尺寸和房间标注；拖拽平移、滚轮缩放、双击适应。已完成保存会把该画布导出为系统内 PNG 快照，供 AI/工作台复用。共享 `FloorPlanViewer` 壳层控件（AI 风格预览与 CAD 导出的 `Button` / `Modal` / `Select`）已改为 Ant Design，不再使用 `@/components/ui` | 路由、租户/责任人权限、`layoutData` 合同、DXF 导出和小程序编辑器/BLE 入口不变。视口只留在当前会话，不写回 graph。快照元数据在 `floor_plans.preview_asset_id`，不写入 `layoutData` | 聚焦 `npm run test:survey-canvas` 覆盖适应/平移/缩放、渲染修订号对齐、PNG 快照导出和不写 graph。`http://localhost:3006/floorplans/[id]` 认证视觉核验待补 | 仅在与小程序画布出现可复现差异、批准后台编辑合同，或路由/API/权限变化时重开 |
| `/login` — 公开后台登录 | 保留品牌优先的登录构图（Logo、产品名、凭据表单、安全页脚）。Ant Design `Input` / `Input.Password` / `Button` / `Tag` / `Alert`；因路由在 `(admin)` 之外，用 `AdminAntdProvider includeAccountSettings={false}` 包裹，避免登录页请求 `/api/auth/me` | 公开 `/login` 与 `POST /api/auth/login` 不变。登录成功后整页跳转到 `/`（`window.location.assign`），侧栏当前用户不再复用登录前 401 的 SWR 缓存 | 聚焦 `current-user-session` 测试覆盖角色文案、401 抛错、登录整页跳转、以及登录壳不挂账户设置。`http://localhost:3006/login` 视觉核验待补 | 仅在出现凭据表单缺陷，或认证/会话合同再次变化时重开 |
| `/floorplans/kujiale` — 酷家乐开放户型搜索 | 保留既有搜索页构图（返回链接、城市/小区筛选、结果卡片）。将 shadcn `Cascader` / `Input` / `Select` / `Button` / `Badge` / `Pagination` 换成 Ant Design `Cascader` / `Input` / `Select` / `Button` / `Tag` / `Pagination`。搜索反馈仍用共享 `notify` | 路由、酷家乐城市/搜索 API、sandbox-openapi 边界和只读（不导入本地库）行为不变；仍从 `/floorplans` 入口进入 | 页面聚焦 ESLint 通过。`http://localhost:3006/floorplans/kujiale` 认证 Chrome 核验待补 | 仅在酷家乐 API/搜索合同变化，或出现可复现筛选/结果布局缺陷时重开 |
| `/workflow-logs` — 通知送达台账 | 沿用 Ant Design/Admin Pro ProTable：状态附带通道（站内 / 微信订阅）、类型、接收人姓名+用户名+电话+角色、中文发送原因、结果说明、企业/报备上下文与发送时间。手工扫描仅跑预约过期；旧报备催办类型标为已停发历史行。平台模板卡顶部增加「启用微信订阅消息下发」开关（`subscriptionMessagesEnabled`，缺省关闭），其下仍维护八个模板 ID | 路由与 `GET /api/workflow-notification-logs` 仍限 `super_admin`/`admin`/`enterprise_admin`；列表 DTO 含用户名/电话；模板配置卡与下发开关仍仅平台，经 `GET/PATCH /api/platform/notification-config`；开关关闭时 `sendSubscriptionMessage` 跳过微信，站内通知照常；报备创建/更新与提醒 cron 不再派发旧工作流通知 | 接线测试断言旧报备停发、cron 仅预约过期，以及订阅下发门控；认证 Chrome 核验待补 | 仅在通知合同变化或出现可复现台账布局缺陷时重开 |

## 交接

`/login`、`/floorplans/kujiale`、AI Studio 簇（`create` / `scenarios` / 工具页及 creation/workbench/ChatInterface 共享组件）、`FloorPlanViewer` 与后台 `Sidebar` 壳层现已使用 Ant Design 5 控件。暗色工作室壳通过 `ConfigProvider` + `studio-antd-theme` 保留夜间主题。根布局 `AntdRegistry` 开启 css-in-js `layer`，并声明 `@layer theme, base, antd, components, utilities`，使 Tailwind 工具类能盖过 Ant Design 全局 `a { color: colorLink }`（侧栏未选中项保持灰字，仅当前路由用主题绿）。未分层的 `a.ant-btn*` / `a .ant-btn*` 规则补回链接按钮应有的文字对比度。共享 `notify`、`ConfirmDialogProvider`/`useConfirmDialog`（在 `AdminAntdProvider` 的 `ConfigProvider` + `App` 下使用 antd `App.useApp().modal.confirm`）、`AccountSettingsProvider`/`useAccountSettings`（侧栏头像账户菜单与登录/安全密码弹窗）和 `ImageUploadField` 迁至 `admin/src/components/admin/*`。原 `@/components/ui` 平行控件库及无引用死代码（`UserDashboard`、`DepartmentTree`、`EnterprisePageHeader`、`enterprise-utils`）已删除。无路由/API/权限或模块清单行为变化。

可见行为变化时同步更新该路由的唯一当前记录和中英文文件。只有实现细节变化、
且不影响路由/API/权限/视觉时，在交接中说明即可，不新增台账记录。

English mirror: [admin-ui-refactor.md](./admin-ui-refactor.md)
