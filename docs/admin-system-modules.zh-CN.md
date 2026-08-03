# 后台系统当前功能清单

> 2026-08-03 PostgreSQL 迁移更新：`AiWorkflowRepository` 已提供带 RLS 范围的工作流持久化和“已成功自由创作结果归入方案”的原子操作。该操作会锁定方案和生成记录，首个归入结果成为选中基准，后续结果保留为候选并更新最新结果。此项仍只是基础层：工作流和自由创作公开路由尚未切换，也未导入、删除或重新加密 MongoDB 业务数据。

> 2026-08-03 PostgreSQL 迁移更新：`AiCreationRepository` 已为媒体资产、自由创作任务、批次、按顺序引用资产、生成记录和供应商尝试提供 typed/RLS 范围的 PostgreSQL 持久化基础。该步骤未切换任何公开 API、权限边界、工作流、媒体交付或供应商执行路由；这些消费者仍使用 MongoDB，必须在同一 bigint 运行时切片中完成迁移，避免混用 bigint 与 `ObjectId` 引用。本步骤未导入、删除或重新加密业务数据。

> 2026-08-02 PostgreSQL 迁移更新：`AiCreationModelProfileRepository` 已作为自由创作执行链的 PostgreSQL 持久化基础层，提供 GRS 目录元数据同步、显式启用/默认配置保留与 bigint 安全查询。任务、批次、生成、供应商尝试、媒体资产和工作流尚未共同完成切换，因此没有公开路由读取此 Repository，运行时仍使用 MongoDB；本步骤未导入、删除或重新加密业务数据。

本文档记录 `admin/` 的当前实现。路由、API、模型、权限或工作流变化时，必须同步更新本文件和 `admin-system-modules.md`。

## 状态与范围

- `Implemented`（已实现）：存在真实页面、API 和数据链路。
- `Limited`（有限支持）：仅在特定角色、供应商、数据形态或运行条件下可用。
- `Placeholder`（占位/未开放）：只有 UI、mock、规划动作或没有真实持久化/集成。
- 技术栈：Next.js 16 App Router、React 19、Tailwind CSS 4、shadcn/ui + Radix；Phase 3 已迁移域通过 `drizzle-orm` + `pg` 使用 PostgreSQL 17，剩余域继续使用 Mongoose/MongoDB；身份/企业核心、线索、正式户型、测量、蓝牙设备、提示词库读取、系统角色、全局报备配置、媒体存储配置、套餐目录以及报备/工作流通知运行时现已使用 PostgreSQL；另含 Three.js 和客户端数据请求。
- 本地开发：`npm run dev` 在 `3005` 端口运行合并的 Next.js 页面/API；Docker 将 MongoDB 发布到宿主机 `27018`（容器内仍为 `mongo:27017`），将 PostgreSQL 发布到宿主机 `5432`（容器内仍为 `postgres:5432`）。`27018` 用于避开既有 Windows MongoDB 服务；容器之间继续使用服务名连接。
- 路由分组：`(platform)` 为平台/B2B 运营，`(merchant)` 为企业工作台资产，公共页面位于 `(admin)`。

## 共享架构

- 外壳和导航：`src/app/(admin)/layout.tsx`、`Sidebar.tsx`、`FetchInterceptor.tsx` 和 `useCurrentUser`。
- 认证与租户：`src/lib/auth.ts`、`session.ts`、`proxy.ts`、`tenant-context.ts`、`tenant-route.ts`、`miniprogram-auth.ts`。
- 租户隔离：使用 `withTenantRoute`、`withTenantContext`、租户解析器和 `multiTenantPlugin`；平台管理员通过 `global_tenant_id` Cookie 切换全局视图。
- 角色：`super_admin`、`admin`、`enterprise_admin`、`designer`、`salesperson`、`measurer`、`viewer`。菜单和默认权限在 `models/AdminUser.ts`，自定义角色在 `models/SystemRole.ts`。
- 共享反馈：可见变更使用 `components/ui/operation-feedback`，常规操作不得使用原生 `alert()`。
- 已迁移管理页使用 ProComponents `PageContainer` 统一页面标题、说明、返回导航和页面级操作区；列表、表单、详情分别使用 `ProTable`、`ProForm`、`ProDescriptions`。
- `PageContainer` 不负责业务区块间距；共享后台壳层会在标题分割线下为内容容器提供 `24px` 顶部内边距，首个区块不得重复添加顶部 margin。迁移页面使用 Ant Design `Flex`/`Space` 或文档明确的 `ProCard` 布局处理区块间距，并使用 `ProForm.submitter.render` 分离底部操作区。

## 功能模块

### 1. 登录、注册与会话

- 页面：`/login`、`/register`。
- API：`/api/auth/login`、`/logout`、`/me`、`/miniprogram`、`/register-company`、`/register-enterprise`。
- 模型/工具：PostgreSQL `AdminUserRepository`、`UserRepository`、`EnterpriseRepository`、会话/认证工具和 `miniprogram-jwt`。
- 状态：后台登录/会话复核、企业自助注册、小程序员工登录/身份绑定、JWT/Cookie、账号状态复核和未授权跳转均已切换 PostgreSQL，为 `Implemented`。
- 旧平台管理员恢复：`npm run migrate:legacy-admin-users` 会以幂等方式把 MongoDB 的平台级账号导入 PostgreSQL，保留 bcrypt 密码哈希、角色、账号状态和菜单权限，因此用户可继续使用原密码。带租户的旧账号会被刻意跳过，因为其 MongoDB ObjectId 租户引用必须先显式映射为 PostgreSQL bigint 企业 ID。
- 用户审计页面：`/users`、`/users/[openid]`，由 `/api/users`、`/users/[openid]`、`/users/me` 支撑，已使用 PostgreSQL 查询和更新小程序身份，并返回 PostgreSQL 户型计数/导出列表。`Limited`：仍使用 MongoDB 的 AI 生成/媒体与订单/提成工作流要等后续 Phase 3 域切换后才能消费 PostgreSQL bigint 身份。

### 2. 导航、角色与访问控制

- 页面：`/roles`、共享 Sidebar、路由守卫。
- API：`/api/roles`、管理员、员工和部门接口。
- 状态：`Implemented`。支持菜单可见性、有效权限、角色默认值、自定义菜单 key、账号状态、部门归属和路由角色校验。`/api/roles`、后台/小程序权限解析、管理员/员工 CRUD、部门归属、地推连接表和管理员列表权限映射已使用 PostgreSQL `SystemRoleRepository`、`AdminUserRepository` 和 `DepartmentRepository`；员工和部门操作在 RLS 租户事务内执行。角色 handler 内强制平台 `super_admin`/`admin` 边界，默认角色以幂等插入初始化且不会覆盖已配置菜单。

### 3. 平台概览与企业租户

- 页面：`/`、`/enterprises`、`/enterprises/[id]`，以及企业 AI、自动化子页面。
- API：`/api/admin/enterprises`、`/activate`、`[id]`、`[id]/ai-key`、`[id]/ai-sync`、`[id]/ai-usage`、`/api/branding/[id]`。
- 模型/工具：PostgreSQL `EnterpriseRepository`、`AdminUserRepository`、`PromotionRecordRepository`、`CommercialRepository`，以及尚未切换的 `EnterpriseAiUsageSnapshot`、`enterprise-ai` 路径。
- 状态：`Implemented`。覆盖企业入驻/激活、资料、品牌、自动化、AI 配置/用量和平台概览。
- 后台 UI：`/enterprises` 使用共享 Ant Design ProComponents 列表模式，采用 `PageContainer`、`ProTable`、基于权威列表 API 的客户端搜索/分页、状态标签和末列操作菜单。既有资料编辑弹窗及企业详情/AI/自动化页面仍保留当前展示层，API 与平台角色边界均未改变。
- PostgreSQL 边界：企业列表、详情、新建、更新、删除、两个自助注册接口及 `/api/admin/enterprises/activate` 均已切换。激活在单个平台事务中创建企业和企业管理员，校验指定订单属于尚未激活的报备记录，再将指定订单或全部未绑定订单回填至新企业，并把报备推进到 `paid`。`Limited`：`ai-key`、`ai-sync`、`ai-usage`、`ai-credits`、品牌和用量快照调用点归入后续 Phase 3 域。AI 域切换前，企业核心列表/详情返回 `aiUsageSnapshot: null`。

### 4. 员工、部门与系统账号

- 页面：`/staff`、`/admins`。
- API：`/api/staff`、`/staff/[id]`、`/departments`、`/departments/[id]`、`/admin-users`、`/admin-users/[id]`。
- 模型/Repository：PostgreSQL `AdminUserRepository`、`DepartmentRepository`、`SystemRoleRepository` 和 `admin_user_promoters` 连接表。
- 状态：`Implemented`。支持企业员工、平台管理员、角色、部门树、状态和地推/设计师/测量员关系管理；为兼容前端，现有 `_id` 响应字段继续使用十进制字符串，RLS 与 route 角色检查共同执行租户边界。

### 5. B2B 企业报备与协作工作流

- 页面：`/promotion-records`、`/workflow-logs`。
- API：报备、`/promotion-records/pool`、`/conflicts`、平台报备配置、工作台 summary/todos、通知日志和提醒执行。
- 模型/工具：PostgreSQL `PlatformConfigRepository`、`PromotionRecordRepository`、`WorkflowNotificationRepository`、`postgres-promotion-workflow`、`postgres-workflow-automation`、微信通知工具。旧 `PromotionEnterpriseRecord`/`WorkflowNotificationLog` 模型仅保留给旧辅助兼容路径。
- 状态：`Implemented`。支持报备、重复/冲突、公海、认领/审批、分配、业务阶段、跟进时间线、SLA 提醒、通知去重和审计。平台管理员通过 PostgreSQL 读取和更新全局报备保护期/审批配置。报备路由、公海/冲突、工作台 summary/todos、通知日志/轮询和提醒自动化均已在租户/平台 RLS 事务内使用 typed PostgreSQL Repository；状态变更使用短事务条件更新，通知在事务提交后发送，既有 DTO、角色边界和小程序 API 路径保持不变。平台归属的 `salesperson` 可以没有企业，因为其职责是为平台拓展潜在客户；此时报告列表/详情、公海认领、工作台和通知轮询进入显式平台 B2B scope，但 Repository 的 actor 过滤和写操作角色检查仍只允许访问本人记录或可认领公海记录，且不能把新报备指定到任意企业。`Limited`：仍引用 MongoDB ObjectId 的 AI/媒体消费者要等依赖切片迁移后再切换。

### 6. 套餐、订单与提成

- 页面：`/packages`、`/enterprise-orders`、`/commissions`。
- API：`/api/admin/packages`、`/enterprise-orders`、`/commissions`、结算和提成记录接口。
- 模型：PostgreSQL `PackageRepository` 和 `CommercialRepository`；旧 `EnterpriseOrder` 和 `CommissionRecord` 模型不再是运行时数据源。
- 状态：`Implemented`。支持套餐目录、企业订单生命周期、付费订单提成生成、提成列表、结算和作废。套餐列表/新建/更新/删除现已在平台范围 PostgreSQL 事务内执行，通过现有 `_id` 字段返回 bigint 十进制字符串，并以精确 `numeric(14,2)` 保存金额。订单、提成、结算、作废及工作台待结算提成汇总均在短 PostgreSQL RLS 事务中使用 bigint 关系；付费订单原子更新报备并 upsert 固定提成，取消订单会作废对应提成。企业激活复用同一 PostgreSQL 报备/订单关系，不引入双写。

### 7. 线索与转化资产

- 页面：`/leads`。
- API：`/api/leads`、`/leads/[id]` 及户型、员工关联接口。
- 模型/工具：PostgreSQL `LeadRepository`、`FloorPlanRepository`、`AdminUserRepository`、微信工具。
- 状态：`Implemented`。支持线索录入/状态、跟进、分配、正式户型关联和转化上下文；列表、详情、新建、更新和删除均在 RLS PostgreSQL 事务内执行，并保留十进制字符串 `_id` DTO。线索-户型连接表、主户型选择、租户校验和删除清理为原子操作；普通微信通知在数据库事务提交后调用。企微配置、群分享和员工企微标识已弃用，已从运行时 API 与 UI 移除；历史 MongoDB 字段及 PostgreSQL `admin_users.wecom_user_id` 列保留，不迁移也不删除。

### 8. 正式户型、搜索与查看

- 页面：`/floorplans`、`/floorplans/[id]`、`/floorplans/kujiale`、`/measurements`。
- API：户型 CRUD、`/floorplans/[id]/export/dxf`、测量、酷家乐城市/搜索和线索关联接口；小程序 `GET /api/floorplans/[id]` 还会返回关联线索的最小身份和小区摘要，供直接进入正式量房时显示项目标题。
- 组件/工具：`FloorPlanViewer`、`FloorPlanViewerWrapper`、`survey-graph`、`surveyDimensionPlan`、`surveyWallSolidPlan`、`dxf`；无渲染依赖的尺寸和墙体实体规划器以 `miniprogram/utils` 为源，在后台开发和生产构建前同步到 `admin/src/lib`。
- 状态：正式 v4 墙图解析、后台 2D/3D 查看、房间填充仅接受首墙正向或反向能够完整闭合的墙链、单侧墙体与连接节点补面先做全局实体合并再统一填充和描边（连接节点、L/T 型接入及重合分段不再出现内部端帽、斜缝或独立方框；门窗切口覆盖完整墙厚）、闭合户型使用工程图式外轮廓尺寸方案（空间边界先按几何拆分合并，不同 ID/不同分段的重合共享墙及封闭内部孔洞均不标注；连续多墙或含门洞的外边界使用靠墙的定位分段链；上、下、左、右等每个外侧方向仅有一条跨整套户型外包范围的全局总尺寸，不再为局部 run 重复生成总尺寸；窗户保留 CAD 图形但不生成重复细分尺寸；延伸线从斜接后的外墙转角起笔，再引至整套户型外轮廓之外的全局尺寸带；查看器会为尺寸线、延伸线和文字自动扩展 SVG 视区，避免最外层标注被裁切）、测量筛选和 DXF 下载为 `Implemented`；酷家乐搜索受上游数据和查询条件影响，为 `Limited`。
- PostgreSQL 边界：正式户型 CRUD、详情渲染、线索关联、测量关联和 DXF 导出均通过 `FloorPlanRepository`、`MeasurementRepository` 在 RLS 中访问。酷家乐上游请求在数据库事务外执行，导入结果以毫米制正式 version-4 `surveyGraph` 原子持久化；房间轮廓转换为闭合节点/墙/空间链。由于上游响应尚无可靠的开口到墙体映射，当前不导入酷家乐门窗开口。
- 边界：后台从 `surveyGraph` 派生房间/开口渲染数据，不持久化旧 `rooms` 或其他旧布局字段。

### 9. 测量审计与蓝牙设备资产

- 页面：`/devices`、`/measurements`。
- API：设备 CRUD、`/devices/verify`、`/devices/verify-binding`、`/measurements`。
- 模型/Repository：PostgreSQL `DeviceRepository`、`MeasurementRepository`、`AdminUserRepository`、`UserRepository`、`FloorPlanRepository`。
- 状态：`Implemented`。支持设备池、企业/用户绑定、校验、状态管理，以及来源为 BLE、手动或系统的长度/高度/面积/角度/门窗审计记录。设备分配外键指向 `admin_users`；平台/企业管理员可变更设备，员工只能读取自己的绑定。测量写入会在同一 RLS PostgreSQL 流程中校验操作员、企业、正式户型、数值/类型/来源/时间和已分配设备。

### 10. AI 工作室与设计生成

- 页面：`/ai-studio/scenarios` 是客户方案 AI 执行工作台，包含“客户方案、快速工具、AI 助手”；旧 `/ai-studio/designer`、`/ai-studio/floor-plan`、`/ai-studio/furnishing`、`/ai-studio/soft-furnishing` 和方案详情 URL 保留相关查询参数后跳入统一工作台。`/ai-studio/create` 是独立全屏自由创作台，后台侧栏以新标签页打开。资源/配置入口继续为 `/inspirations`、`/ai-presets`、`/ai-providers`、`/ai-models`、`/ai-credit-prices`，企业 AI 页继续管理统一点数。
- AI 供应商后台路由：`/ai-providers` 是供应商列表；`/ai-providers/new` 用于新增供应商；`/ai-providers/[id]` 用于查看和编辑供应商；`/ai-models` 是独立的平台生图模型目录。页面使用基于 Ant Design ProComponents 的共享后台壳层（`ProTable`、`ProForm`、`ProDescriptions`），`/ai-models` 复用 `ai-providers` 平台权限，仅平台 `super_admin`、`admin` 可操作（`Implemented`）。
- 供应商接入契约：`AiProviderConfig` 保留旧版加密 API Key 字段，同时持久化加密/掩码凭证映射和经校验的非敏感 `adapterConfig`。统一编辑页与服务端校验共同读取 `src/lib/ai/provider-adapter-manifest.ts`；当前 GRS、Pollinations、OpenAI Compatible 使用公共的地址/API Key 配置。`Limited`：平台生图模型目录当前仍是 GRS 来源契约，新增供应商必须实现 Adapter 与目录档案支持，不能只新增前端选项。
- PostgreSQL 边界：平台供应商列表、新增、更新、停用、密钥轮换、连通测试、模型同步、上游余额查询及运行时供应商选择现统一经由平台范围 PostgreSQL 事务中的 `AiProviderConfigRepository`。加密凭据保持不透明存储；异步网络调用结束后仅回写非敏感运行状态。配置了 API Key 时，环境变量中的 GRS/Pollinations 默认供应商会幂等写入 PostgreSQL。
- API：AI 对话/Agent、生成/渲染/建议、状态/历史、预设、工作流搜索分页及阶段、设计能力/共享动作目录、媒体资源、供应商 CRUD/密钥轮换/连通测试/模型同步/上游余额查询、受保护任务对账、平台业务动作价格、`GET/PATCH /api/admin/ai-image-models`、`GET/PATCH /api/admin/ai-image-model-prices`、企业点数发放/调整/流水/任务和失败任务重试接口。旧企业 `ai-key`/`ai-sync` 仅保留只读兼容，写接口返回 `410`。
- 自由创作 API：`GET /api/ai/creation/bootstrap`、提示词分类/列表/详情/预览、`POST /api/ai/creation/assets`、`GET/POST /api/ai/creation/tasks`、`DELETE /api/ai/creation/tasks/[id]`、`POST /api/ai/creation/tasks/[id]/batches`、提示词优化及生成结果归入现有客户方案。页面和整个 API 前缀由代理统一映射到 `ai-scenarios` 权限，写接口还通过 `withTenantRoute` 强制企业上下文。
- PostgreSQL 身份兼容：自由创作任务、批次、生成、媒体、供应商尝试和点数记录会保留旧 MongoDB `ObjectId`，同时允许新记录使用当前 PostgreSQL 企业/操作人 ID 字符串。租户过滤和媒体归属读取始终按已存储的原始身份值精确匹配，因此 PostgreSQL 企业不会在没有显式映射时读取旧记录。自由创作对 bigint 身份从 PostgreSQL `enterprises.ai_policy` 读取策略，旧 `ObjectId` 仍走 MongoDB 策略读取。平台对历史小程序生成任务的重试接口仍只接受 `ObjectId` 租户，传入 PostgreSQL 身份会返回 `409`，直至该工作流完成迁移。
- 模型/工具：`AiGeneration`、`AiWorkflow`、`AiChatSession`、`AiStylePreset`、`AiProviderConfig`、`AiProviderAttempt`、`MediaAsset`、`AiCreditAccount`、`AiCreditLedger`、`AiCreditPrice`、`AiModelCreditPrice`、`Inspiration`、`src/lib/ai/*`、`src/lib/media-storage/*`。
- 自由创作与模板库模型：`AiCreationTask`、`AiCreationBatch`、`AiCreationModelProfile`、`AiPromptLibraryRevision`、`AiPromptCategory`、`AiPromptTemplate`、`AiPromptParameterTemplate`、`AiPromptSourceModel`、`AiPromptTemplateAsset`、`AiPromptImportRun`。
- 模板库运维：`npm run import:roomi-prompts` 默认只预览；增加 `-- --execute` 才原子发布通过完整校验的新版本，或用 `-- --source-file=<export.json> --execute` 从导出恢复；`npm run verify:roomi-prompts` 校验来源数量、引用、预览图校验和与抽样一致性。临时凭据和快照位于 Git 忽略的 `admin/.roomi-import/`，导入预览图保存在 Git 忽略的本地目录，不上传七牛。
- Phase 4 保留数据迁移：`npm run migrate:phase4-retained-data` 先校验冻结的 RoomiAI 快照，再幂等导入活动版本、完整引用图和本地预览文件至 PostgreSQL；同时导入活动七牛配置和 Provider 指针，执行完整七牛探针并写入迁移检查点。脚本仅只读旧 MongoDB，绝不删除 MongoDB 记录、导入快照或七牛对象。
- PostgreSQL 运行时迁移：提示词库只读 API（`GET /api/ai/creation/prompt-categories`、`GET /api/ai/creation/prompt-templates`、模板详情和预览）已切换到 typed PostgreSQL Repository 与平台事务，DTO 和 `ai-scenarios` 权限边界保持不变；Phase 4 保留数据导入器已将活动提示词库直接写入 PostgreSQL；AI 风格预设的默认初始化、读取和平台管理员更新已切换到 typed `AiStylePresetRepository` 与平台事务，并保持字符串 `_id` API DTO 不变。生成任务持久化和模型档案同步仍待 Phase 3 后续切片，当前继续使用 MongoDB。新建生成批次也通过 PostgreSQL 解析所选模板和参数定义。`Limited`：引用线索或户型的 MongoDB AI 工作流/媒体/生成路由尚不兼容 bigint，不属于本切片。
- AI 供应商配置及运行时选择现使用 typed `AiProviderConfigRepository` 和平台事务，保留既有平台 `ai-providers` 权限、路由与 DTO；AI 工作流、生成、媒体资产及模型档案同步仍为 MongoDB 切片。
- 平台业务动作价格及自由创作模型/分辨率价格现分别使用平台 PostgreSQL 事务中的 `AiCreditPriceRepository` 与 `AiModelCreditPriceRepository`。企业 AI 点数账户和流水现通过租户 PostgreSQL 事务中的 `AiCreditRepository` 读写，唯一 `operationId` 流水与余额变更原子执行，保证发放、调整、冻结、扣除和释放的幂等性；账户/流水 bigint 在 API 中仍序列化为数字，企业 AI 点数后台接口已从 PostgreSQL 读取账户、策略和流水，平台角色边界不变。在 `AiGeneration` 迁移完成前，旧 MongoDB 生成记录的 ObjectId 会明确写为 PostgreSQL 流水 `generationId: NULL`，不会错误转换为 bigint 外键。`AiCreationModelProfile` 也继续留在 MongoDB，因为 `AiCreationTask`、`AiCreationBatch`、`AiGeneration` 仍引用其旧 `ObjectId`；本切片将可执行价格及企业点数账本写入 PostgreSQL。
- AI 对话列表、新建、详情、删除以及 Agent/动作确认的消息历史现使用 RLS PostgreSQL 事务内的 `AiChatSessionRepository`，保持原有企业/管理员隔离和字符串会话 ID；不导入历史 MongoDB 会话。
- 自由创作界面规格：Roomi 风格全屏页使用 `68px` 品牌栏、`1440px` 最小桌面画布、固定尺寸悬浮任务面板及 `1080px` 提示词/参数一体输入器。标题光弧与输入器边框使用本地静态资源，品牌替换为 Smart Floor AI，页面只调用本地数据接口。任务提交后切换为 Roomi 风格执行态：顶部展示任务摘要和参数标签，中部使用紧凑进度/结果缩略块及重新编辑、再次生成、删除操作，右侧显示历史记录窄轨，输入器固定在页面底部。完成结果悬浮后提供下载、引用为参考图、A/B 对比、图片标注编辑、归入客户方案和删除；大图预览支持缩放、旋转、全屏和下载；对比支持交换、仅看 A/B、带中央拖拽手柄的分割线、同步、左右/上下、重置、无边框沉浸式全屏画布（工具栏置于占满余下视口的图片区域上方）和导出。标注编辑器提供方形、圆形、箭头、画笔、标记、六色、撤销/重做、本地下载和“使用”；使用后的 PNG 仍经既有自由创作素材上传 API 保存为参考图，不新增路由、模型或权限边界。
- 状态：`Implemented`。客户方案工作台以“客户/素材/目标”向导发起方案，双栏工作区突出当前定稿、候选版本和唯一推荐下一步；共享动作目录统一名称、输入、计费键、支持端、结果边界和推荐动作。自由创作台支持本地模板搜索和三级分类、模板填入、参考图、提示词优化、本地模型映射、1–4 张输出、比例/质量/分辨率、点数预估、历史、复用、重试、删除、下载及归入现有客户方案；完成结果卡复刻经实际验证的 Roomi 交互面：悬浮操作、可标注引用、完整预览控制与 A/B 对比导出，不增加 Roomi 运行时依赖。模板结果可覆盖活动版本全量增量加载，移动端保留同一套三级分类选择。全屏页面采用已确认的 Roomi 风格深色创作布局：`68px` 品牌栏、紧凑创作轨道、中央画布、悬浮任务面板及底部提示词/参数一体输入器，品牌替换为 Smart Floor AI，并继续只调用本地数据接口。服务端会把模板参数与所选本地模型能力取交集，并保存最终参数快照。生成复用现有供应商执行/轮询及点数冻结、成功扣除、失败释放链路，计费动作是 `image.free_create`。自由创作上传和必须持久化的结果固定使用本地媒体 Provider，即使平台默认配置为七牛也不会上传七牛。第一版模板预览优先尝试导入时审计保存的 `sourceUrl`，失败回退已导入的本地预览；运行时不请求 Roomi API。旧 AI 执行权限键兼容解析为 `ai-scenarios`，角色配置只展示一个“AI 设计”，不会扩大 B2B 渠道 `salesperson` 的数据边界。后台与小程序共用企业 AI 点数和 `AiWorkflow`；带客户/正式户型上下文的小程序参考复刻、整体换风格、户型概念图和软装深化分别映射到后台基准、彩平转透视和软装阶段。`MediaAsset` 持久化图片宽高，旧资产首次复用时从存储文件补写；所有媒体写入、读取、删除和可选签名跳转统一经过注册的 `MediaStorageProvider`。每条资产保存自身 Provider、可移植对象键、可选 Bucket 和 SHA-256，因此本地与七牛/后续对象存储资产可并存，后台和小程序资产 URL 不变。内置 `local` Provider 把路径限制在 `AI_ASSET_STORAGE_DIR` 内，生产 Docker 使用持久化卷挂载该目录；七牛 Kodo Provider 使用私有 Bucket 和短期签名下载，上传失败直接返回错误，不会静默回退本地。小程序按图片尺寸映射供应商支持的输出规格：参考复刻跟随参考图比例；选择正式户型范围时，服务端把所选完整户型或隔离后的单房间控制图作为第一张墙体/门窗结构输入，把参考图作为第二张镜头、画幅、构图和风格输入，不再要求额外空间照片；未选户型时仍兼容“参考图第一、空间图第二”。换风格/软装跟随空间图，完整户型保持方图，单房间默认横图。基准/软装阶段首个成功版本自动采用并推进，同阶段后续成功版本只成为候选，须手动采用才推进；同方案同阶段存在活动任务时拒绝重复冻结和上游提交。成功基准可继续提案/灯光。后台向导只展示包含闭合房间的已完成 v4 正式户型，创建和执行时还会再次拒绝草稿、旧版或失效户型 ID。正式户型驱动的选风格、基准和彩平转透视阶段会派生独立 1024px 控制图 `MediaAsset`；选风格固定使用 `image.edit.standard`，并把该控制图或用户上传来源图放入供应商 `images`，提示词同时加入只读的房间、墙体拓扑、尺寸、层高、门窗约束，且不修改 `FloorPlan.layoutData`。任务创建冻结、正式结果持久化后扣费、明确失败释放；平台 `super_admin`/`admin` 可管理供应商、轮换凭证、测试/同步模型、查询 GRS API Key 上游积分余额、执行对账、发放/调整点数、配置业务动作价格及企业允许功能/`standard` 逻辑档位，企业员工只消费。GRS 连通测试使用积分余额接口同时校验 Host 与 API Key；其节点不支持 `/v1/models` 时，模型同步保留并返回后台配置的模型映射。业务层使用逻辑模型键和 `AiExecutionService`；GRS 图片按当前文档向 `POST /v1/api/generate` 提交 `replyType: "async"`，标准 `gpt-image-2` 使用文档比例，VIP 在来源像素满足约束时沿用原尺寸，否则选择文档中的合法回退尺寸，并通过 `GET /v1/api/result?id=...` 轮询，`violation`/`failed` 均按已退款失败处理。小程序任务详情与历史读取会对可见生成中任务强制执行这次上游状态查询；即使已退款失败耗尽备用供应商，也会返回数据库中的最终失败状态，而不是用 500 遮蔽。临时结果必须先保存到 `MediaAsset`。仅连接失败、明确未受理或已确认退款时切备用；已有远端任务 ID 的已受理/未知状态任务继续冻结并轮询，不会创建第二个上游任务；提交响应没有远端任务 ID 时按不可追踪失败终止，不自动切备用供应商，释放冻结点数并允许运营核实后人工重试，避免永久停留在 `processing`。重试会按当前动作价格重新生成计费快照，并兼容没有历史 `priceSnapshot` 的旧任务。上游成本和余额与企业 AI 点数分账记录：企业购买平台点数，运营方按资金池预警批量补充供应商余额，不做逐笔充值联动。上游成本按原币种微单位单独记录，不改变业务点数价格。供应商页的能力与逻辑/远程模型字段用于路由；成本币种和预计成本只用于内部核算，可为 0 且不发送给供应商。`Limited`：其他适配器的余额/模型发现取决于供应商协议，首期不接微信/自助充值和低余额自动告警；生产本地媒体必须使用持久共享目录，七牛必须使用私有 Bucket、HTTPS 下载域名、服务端加密凭证并先通过完整读写删探针。
- GRSAI 现行模型目录：版本化目录按 2026-06-29 协议内置 `gpt-image-2`、`gpt-image-2-vip` 和 11 个 Nano Banana 模型。平台 `super_admin`/`admin` 在 `/ai-providers` 启停模型、指定唯一默认模型并设置 0–10 张参考图上限；供应商同步发现但没有参数能力定义的模型只读展示且不可执行。自由创作台只显示“模型已启用且至少一个分辨率价格已启用”的模型，提供模型/比例/分辨率联动，不再显示通用质量控件；VIP 使用官方像素预设矩阵或经过边长、16 倍数、长短边比与总像素校验的 `CUSTOM` 宽高。
- GRSAI 现行协议与路由：同步结果与完整内置目录合并，`/v1/models` 不可用时仍返回完整目录。请求固定 `replyType: "async"`，不发送文档未定义的 `quality`、`output_format`；Nano 使用 `aspectRatio + imageSize`。自由创作显式模型只在 GRS 配置之间故障转移，并始终保持同一远程模型，不会静默换模型。供应商内部成本可按远程模型和分辨率匹配并写入 `AiProviderAttempt`。
- 自由创作模型点数：`AiModelCreditPrice` 按 `image.free_create + modelProfileKey + resolutionTier` 唯一定价，VIP 自定义尺寸统一使用 `CUSTOM`。批次估算、冻结、成功扣除、失败释放和重试快照保存模型、远程模型及分辨率；客户工作流与小程序继续使用平台场景默认逻辑模型和原业务动作点数。
- 小程序目标上下文：`/api/miniprogram/ai/workflows` 校验 `floorPlanId + targetScope + roomId`，从精确任务而非方案全局阶段派生当前目标状态。缺少范围字段的旧任务继续保留在历史中，但不会自动匹配房间；户型更新会令更早成果过期。小程序防重以方案、阶段、正式户型、目标范围和房间为完整键，允许不同房间并行，并取代上一段对小程序“同方案同阶段”防重的概括；后台仍保留原全局阶段语义。`POST /api/miniprogram/ai/tasks` 接收与手动空间图互斥的 `sourceResultTaskId`，重新校验成功状态、方案、目标、访问权限及时效，把内部或外部成果统一固化为新的 `ai_generation_input`，写入 `parentGenerationId` 后才冻结点数。其他员工只能看到同目标忙碌状态，创建员工可打开进度；不新增房间级 `AiWorkflow`，也不改变后台全局已采用成果语义。
- GRS 结果图策略：默认对 GRS 返回的 `http(s)` 图片只保存上游 URL，不创建 `MediaAsset`。仅当平台在媒体存储页启用转存且当前默认存储为可用七牛配置时，后续 GRS 结果图才下载并写入七牛；Data URI、用户上传和量房控制图仍始终保存为 `MediaAsset`。
- 迁移/运维：现有数据库启用新路由前运行 `npm run migrate:ai-platform`；脚本保留既有 AI 点数原值、为缺失企业创建 0 点账户、不转换 Pollen，并迁移旧生成/预设和写入环境变量供应商配置。点数价格初始化会移除旧版唯一 `mode_1` 索引，避免无 `mode` 的平台动作价格因重复 `null` 导致能力接口失败；`actionKey_1` 仍是价格记录的唯一业务索引。脚本幂等写入完整 GRSAI 模型/分辨率目录，仅默认启用 `gpt-image-2/1K` 并继承既有 `image.free_create` 点数；历史 `roomi-*` 档案与旧任务快照继续可读，但不作为可执行选项。`npm run cleanup:media-assets` 默认只预览，只有增加 `--execute` 才会在宽限期后物理清理软删除媒体；`npm run migrate:media-assets -- --from=<provider-key> --to=<provider-key>` 默认预览，参数使用稳定配置标识，增加 `--execute` 后按大小和 SHA-256 校验目标对象，先提交新定位再删除源对象。定时调用 `/api/ai/reconcile` 时配置 `AI_RECONCILIATION_SECRET`。

- 历史自由创作批次仍可能读取旧快照中的 `quality` 字段；新建 GRSAI 请求只展示模型、比例和分辨率，且不会发送 `quality` 或 `output_format`。
- 自由创作响应式行为：视口小于 `1440px` 时取消固定桌面最小宽度、隐藏左侧工具轨，并让模型、数量、比例、分辨率、模板和提交控件自动换行，确保所有命令可触达；`1440px` 及以上继续保持原有 Roomi 风格固定画布。

### 11. 平台媒体存储管理

- 页面/权限：`/media-storage`，菜单权限 key 为 `media-storage`，仅平台 `super_admin`、`admin` 可访问和操作。
- 后台 UI：管理页采用共享 Ant Design ProComponents 应用模式：使用 `PageContainer` 提供页面上下文，使用配置面板承载默认存储和 GRS 结果图策略，使用 `ProTable` 展示存储状态和操作，使用 `ModalForm` 编辑七牛配置。本次仅迁移展示层，路由、API、角色边界和存储行为均未改变。
- API：`GET/POST/PATCH /api/admin/media-storage`、`PATCH/DELETE /api/admin/media-storage/[id]`、`POST /api/admin/media-storage/[id]/test`、`POST /api/admin/media-storage/[id]/activate`。
- 模型/工具：`MediaStorageConfig`、`PlatformConfig.mediaStorage`、PostgreSQL `MediaStorageConfigRepository`、`MediaAsset`、`src/lib/media-storage/*`。
- 状态：`Implemented`。页面展示当前默认存储、凭证/配置状态、有效/待清理/累计资产数量与容量和最后测试结果；可管理内置本地存储及多套七牛 Kodo 配置，API 只返回密钥掩码，凭证仅在服务端加密保存。每套七牛配置可选填存储前缀，用于同一 Bucket 内隔离项目；前缀只接受以斜杠分段的字母、数字、`.`、`_`、`-`，拒绝路径穿越并规范为单个结尾斜杠。前缀只作用于后续新上传和健康探针，完整对象 key 会固化在 `MediaAsset.storageKey`，所以修改前缀不会影响历史资产读取。Bucket、区域、域名、前缀或凭证变更会清除原测试通过状态；完整探针依次验证上传、对象查询、私有签名下载、内容一致性和删除，只有测试通过且未归档的七牛配置可设为默认。配置稳定 key 创建后不可修改，并写入 `MediaAsset.storageProvider`。归档配置禁止新写入、测试和重新激活，但仍解析用于历史资产读取/删除；当前默认配置不能归档。GRS 结果图默认保留上游 URL；只有当前默认存储是可用七牛配置时，管理员才能启用其转存开关，开启后仅后续 GRS 结果写入七牛，并且在关闭开关前不能切回本地默认存储。切换默认值和转存开关都不会迁移旧资产；未初始化平台配置时继续兼容 `local`。
- PostgreSQL 持久化边界：媒体配置 CRUD、加密凭证读取、连通测试结果、归档、默认 Provider 和 GRS 转存指针均已切换到 PostgreSQL。七牛网络探针在数据库事务外执行，结果使用 `updatedAt` 乐观条件回写，避免覆盖探针期间发生的配置修改。资产数量/容量统计仍聚合 MongoDB `MediaAsset`，待后续 Phase 3 媒体资产域迁移；旧 MongoDB 管理员 ID 不能写入 PostgreSQL bigint 审计外键，因此身份域迁移前审计字段暂为 `NULL`。
- Phase 4 保留数据迁移已导入活动 `zly-images` 七牛配置和 Provider 指针，未写入旧管理员审计 ID；完整上传、对象查询、私有签名下载、内容一致性与删除探针已通过。生产切换前仍必须在部署环境提供独立的 `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`。
- 限制/运维：生产云凭证必须配置专用 `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`；七牛 Bucket 固定按私有空间处理，下载域名必须为 HTTPS 并加入微信小程序合法域名。页面首期不发起迁移或物理清理任务，仍使用默认 dry-run 的 CLI；迁移参数使用稳定配置标识，例如 `--to=qiniu-primary`。

### 12. 小程序支撑与跨端 API

- API：`/api/auth/miniprogram`、`/api/miniprogram/home`、`/mine`、小程序 AI 能力/来源/方案/媒体/任务/历史接口，以及共享线索、户型、测量、提成、订单、报备接口。
- 状态：`Implemented`。负责小程序身份、员工上下文、首页/我的工作台、定位、品牌、共享业务资产和企业员工 AI 设计；AI API 强制 Bearer JWT、企业和操作员归属校验。媒体上传按文件实际字节识别 JPG/PNG 及宽高，不依赖微信 multipart 请求声明 MIME；`/api/miniprogram/ai/sources` 保留旧版扁平房间数组并新增按正式户型分组的数据，只暴露当前角色可访问的正式户型和闭合房间。任务创建复用相同角色边界并保存显式 `whole_floor_plan`/`single_room` 范围；完整户型生成派生独立 1024px 控制图 `MediaAsset` 并调用图片编辑，单房间户型生成使用量房摘要调用图片生成。关联正式户型的参考复刻也会派生控制图，存在 `roomId` 时只绘制该闭合房间及其门窗，并把控制图置于参考图之前提交，均不修改正式墙图。显式方案直接续接；同客户/户型只有一个活动方案时自动复用，存在多个方案时必须由客户端选择，不会静默合并，并可明确新建备选方案。
- 方案目标响应：正式目标的方案接口同时返回 `sourceFloorPlanId` 和按户型、范围、房间精确匹配的 `targetContext`；旧任务不会自动填图，其他员工的活动任务仅返回忙碌状态。任务续接与目标级防重继续复用上述角色边界。
- PostgreSQL 工作台边界：`/api/miniprogram/home` 和 `/mine` 已通过 typed RLS Repository 派生实时线索、正式户型、测量、设备、报备和待办数据，`/api/users` 也返回 PostgreSQL 户型计数。AI 生成域迁移前，首页 `aiGeneratedCases` 返回 `0`；订单和提成仍由 MongoDB 支撑，不会把 PostgreSQL bigint ID 传入旧 MongoDB 查询。

### 13. 通知、自动化与诊断

- API：提醒执行、通知列表/轮询、`/api/health`、`/api/debug`、`/api/debug/tenant-context`、`/api/internal/seed`。
- 状态：提醒、浏览器轮询、通知日志、健康/调试、种子和 Docker/发布工具为 `Implemented`；内部密钥保护的 seed route 已改为幂等创建 PostgreSQL 初始平台管理员，必须显式配置至少 32 字符的 `INTERNAL_SECRET` 和至少 12 字符的 `INITIAL_ADMIN_PASSWORD`，不再保留源码默认凭据。接口仍需遵守对应角色和运行环境限制。
- 运维恢复：PostgreSQL migration 已完成后，`npm run migrate:legacy-admin-users` 是导入旧 MongoDB 平台管理员身份的幂等运维命令。它绝不覆盖已有 PostgreSQL 账号，并会报告已存在、无效或租户级而被跳过的记录。
- PostgreSQL 迁移基础层：PostgreSQL 17 Docker 服务、隔离的 `sfp_migrator`/`sfp_app`/`sfp_auditor` 角色、受限 `pg.Pool`、可审阅 Drizzle migration、备份/恢复演练、44 张 typed 目标表、外键与索引、租户数据强制 RLS、事务内租户/平台上下文，以及企业、部门、管理员、小程序用户、线索、正式户型、测量、设备、平台配置、提示词库、系统角色、媒体存储配置、报备记录、工作流通知、提醒自动化、订单、提成、企业激活、AI 风格预设和 AI 价格 typed Repository 均为 `Implemented`；恢复演练会核对表、RLS 表和策略数量。`/api/health` 继续以 MongoDB 为必需依赖并单独报告 PostgreSQL；只有 `POSTGRES_HEALTHCHECK_REQUIRED=true` 时 PostgreSQL 才参与健康门禁。Docker migration 通过 `npm run docker:migrate` 显式执行，长期运行的 admin 服务不注入 `DATABASE_MIGRATION_URL`。Docker 构建上下文排除运行时 `.env*`、本地 RoomiAI/导入资源、上传目录和本地数据库备份，这些资产必须在运行时注入或挂载。`Limited`：AI 工作流、生成和媒体资产持久化仍使用 MongoDB，Phase 3 继续按域迁移。

## Phase 3 迁移状态更新（2026-08-02）

- 订单、提成、结算、作废及工作台待结算提成汇总已切换至 PostgreSQL `CommercialRepository`，使用现有 RLS 目标表及 bigint 关系；付费订单在同一短事务中更新报备并 upsert 提成，取消订单会作废对应提成。
- `/api/admin/enterprises/activate` 已在单个 PostgreSQL 平台事务中完成报备/订单校验、企业及企业管理员创建、订单绑定和报备状态推进；不会读取或写入 MongoDB。旧 `EnterpriseOrder` 和 `CommissionRecord` Mongoose 模型不再是这些运行时 API 的数据源；AI/媒体域仍为 `Limited`，继续使用 MongoDB，等待后续 Phase 3 切片。

## 核心模型

- 身份：`AdminUser`、`SystemRole`、`User`、`Department`。
- 租户/商业：`Enterprise`、`Package`、`EnterpriseOrder`、`CommissionRecord`、`PromotionEnterpriseRecord`。
- 客户资产：`Lead`、`FloorPlan`、`Measurement`、`Device`、`Inspiration`。
- AI/媒体：`AiGeneration`、`AiWorkflow`、`AiChatSession`、`AiStylePreset`、`AiProviderConfig`、`AiProviderAttempt`、`MediaStorageConfig`、`MediaAsset`、`AiCreditAccount`、`AiCreditLedger`、`AiCreditPrice`、`AiModelCreditPrice`；`EnterpriseAiUsageSnapshot` 仅保留为 Pollinations 历史数据。
- 通知/配置：`WorkflowNotificationLog`、`PlatformConfig`。

## 维护清单

修改后台页面、API、模型、工作流或共享组件前，先阅读根目录/后台目录指令和本中英文清单。完成后必须在同一份 diff 中更新页面/API、数据行为、权限边界、状态和限制，并检查 Sidebar 菜单 key、`proxy.ts`、角色默认权限、租户解析、模型索引和操作反馈。没有真实路由、处理器和持久化/供应商链路的 roadmap 项目不得标记为已实现；如果确实没有功能文档影响，必须在交接说明中明确写出。
