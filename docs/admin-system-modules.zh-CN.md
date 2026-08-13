# 后台系统当前功能清单

### 小程序订阅通知模板交接（2026-08-12）

第一批四个“房屋装修”公共模板及其业务映射记录在
[`docs/miniprogram-subscription-notification-template-baseline.zh-CN.md`](miniprogram-subscription-notification-template-baseline.zh-CN.md)。平台现以 `version: 2` 保存四类模板 ID 和精确关键词契约，小程序聚合授权四个模板；通用待办、客户指派和新增客户发送为 `Implemented`。`Limited` 仅指上门量房提醒仍缺少真实预约数据与确认事件，不得复用 SLA 截止时间触发。

### PostgreSQL-only AI 运行时（2026-08-05）

> 2026-08-06 API 迁移测试修复：AI 会话创建/详情响应现统一使用显式 DTO，
> 在 JSON 编码前把 PostgreSQL `id`、`enterpriseId`、`adminId` bigint 转为
> 十进制字符串。不存在的 AI 供应商或媒体存储配置 ID 会在调用上游服务前返回
> `404`，AI Agent 动作缺少必填字段时返回 `400`；认证及既有平台/租户角色边界
> 不变。未认证的源码写入型开发工具 `/api/miniprogram/save-icons` 已删除，不再
> 作为生产 API。上述路由状态仍为 `Implemented`；真实供应商连通成功仍依赖另行
> 配置的外部凭据，不属于本地回归契约。

> 2026-08-06 部署更新：Docker Compose 只定义 PostgreSQL、应用和一次性迁移服务，不会启动或配置 MongoDB。`admin/deploy.sh` 会等待 PostgreSQL 就绪，使用独立迁移角色执行 Drizzle migration，再启动应用并验证 `/api/health`，最后调用受保护且幂等的 seed 接口。长期运行的应用只接收 `DATABASE_URL`，绝不接收迁移凭证。既有 MongoDB 容器和卷不属于此部署流程，也不会被自动删除。`GET /api/health` 有意保持公开，只报告必需 PostgreSQL 连接，不暴露租户、用户或数据库细节。`POST /api/internal/seed` 只为让部署到达其自身的 `INTERNAL_SECRET` 校验而绕过 Cookie 认证；没有该密钥仍不可访问，且不会暴露凭证。Windows 发布请双击 `admin/release.bat`：它会无缓存重建 `zmc1212/sfp-admin:latest` 并尝试执行 `docker push` 推送到 Docker Hub。推送失败会明确提示，但不会丢弃离线备用包；脚本仍会导出 `sfp-admin.tar` 并生成 `admin/release/sfp-admin-release.zip`，其中包含服务器 Compose 文件、迁移文件、部署脚本和环境变量模板。压缩包不包含 `.env.production`，服务器解压后必须先配置真实生产密钥再运行 `./deploy.sh`。部署脚本会显式定位并校验同目录 `docker-compose.yml`，不会因继承的 `COMPOSE_FILE` 或父目录中无关的 Compose 文件而误用其他服务集合；启动 PostgreSQL 前还会验证导入镜像含一次性迁移脚本，避免过期或不完整离线镜像包造成部分部署。发布包会附带 `sfp-admin.tar` 的 `SHA256SUMS`，存在该文件时 `deploy.sh` 会在导入前进行校验；脚本还要求同目录存在 `.env.production` 和 `drizzle/`，缺失时会在连接 Docker 前直接提示。Compose 预检会输出实际解析到的服务列表；若配置解析本身失败，会直接显示 Docker Compose 的原始错误，而不会笼统提示缺少服务。校验清单读取兼容 Windows 的 CRLF 与 Linux 的 LF 换行，因此 Windows 生成的发布清单可在 Linux 部署服务器直接验证。PostgreSQL 就绪后，`deploy.sh` 会在迁移前幂等执行 `docker/postgres/init/001-roles.sql`，从而为曾在该初始化文件挂载前创建的数据卷补建应用角色。

AI 工作台配置和提示词库 API 现在只读取 PostgreSQL 数据。历史 ObjectId 请求直接返回不存在，管理端不再包含 Mongoose 模型、MongoDB 连接工具或 Mongo 维护脚本。保留数据仅限七牛云存储配置和当前 Roomi 提示词库版本。

> 2026-08-05 PostgreSQL 迁移更新：已认证的 Kujiale 城市和户型检索代理不再连接 MongoDB。PostgreSQL bigint 的 AI 资产、生成图、状态、小程序资产交付和管理员重试请求，现仅在显式历史 ObjectId 兼容分支中才加载 MongoDB/Mongoose。既有认证、权限、DTO、上游行为和历史兼容保持不变。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（49/49）。

> 2026-08-05 PostgreSQL 迁移更新：租户 `GET/POST/DELETE
> /api/inspirations` 现通过 `InspirationRepository` 和租户 RLS PostgreSQL bigint
> `inspirations` 表运行。既有筛选、响应中的 `_id` 字符串和数字 `viewCount`、当前菜单权限及案例发布、推荐和删除流程保持不变；读取和变更现要求已认证的企业上下文。历史 MongoDB 案例既未导入，也不会混入新列表。定向 ESLint 与 `npm run test:postgresql` 均通过（49/49）。

> 2026-08-05 PostgreSQL 迁移更新：`GET /api/admin/enterprises/[id]/ai-credits`
> 的企业最近任务列表现从 PostgreSQL bigint `ai_generations` 读取，并关联操作员和当前供应商
> 模型。既有 `super_admin`/`admin` 边界、账户、流水、策略和任务 DTO 字段保持不变；历史
> MongoDB ObjectId 任务不会混入该 PostgreSQL 列表。未导入、删除或重新加密 MongoDB 业务数据。
> 定向 ESLint 与 `npm run test:postgresql` 均通过（48/48）。

> 2026-08-05 PostgreSQL 迁移更新：`GET /api/admin/media-storage` 不再连接 MongoDB。
> 有效、待清理和累计媒体资产数量/容量现通过平台范围 PostgreSQL `media_assets` 与
> `MediaAssetRepository` 聚合；媒体配置、Provider 激活、权限和响应字段保持不变。未导入、
> 删除或重新加密 MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（47/47）。

> 2026-08-05 PostgreSQL 迁移更新：平台 `GET/PATCH /api/admin/ai-image-models` 现通过
> PostgreSQL 平台事务中的 `AiCreationModelProfileRepository` 初始化、读取、校验和更新
> GRS 模型目录；`GET/PATCH /api/admin/ai-image-model-prices` 通过同一目录校验分辨率能力并
> 读写 PostgreSQL 价格记录。既有 `super_admin`/`admin` 权限、响应 DTO、唯一启用默认模型
> 规则及供应商发现模型的只读展示保持不变。未导入、删除或重新加密 MongoDB 业务数据。
> 定向 ESLint 与 `npm run test:postgresql` 均通过（46/46）。

> 2026-08-04 PostgreSQL 迁移更新：`POST /api/admin/ai-generations/[id]/retry`
> 现可在当前企业上下文中处理 bigint 的失败小程序 AI 生成任务。既有
> `super_admin`/`admin` 边界不变；租户 RLS 查询允许管理员重试员工创建的任务，重置其
> 供应商/计费状态后通过 PostgreSQL 运行时提交。历史 ObjectId 重试仍保留 MongoDB
> 兼容分支；未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与
> `npm run test:postgresql` 均通过（44/44）。

> 2026-08-04 PostgreSQL 迁移更新：bigint `PATCH /api/ai/workflows/[id]` 已支持
> 既有 `mock-generation` 手动结果动作。PostgreSQL 资产 URL、图片 data URI 和 HTTP(S)
> 图片会解析或持久化为租户归属的 `ai_generation_output` 媒体；该路由随后在短租户 RLS
> 事务中创建零点数、已成功的 bigint `scenario` 生成记录，并可更新阶段指针。该动作有意
> 跳过供应商执行和点数计费。历史 ObjectId 变更请求仍保持 MongoDB 兼容；未导入、删除或
> 重新加密 MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（43/43）。

> 2026-08-04 PostgreSQL 迁移更新：两步式后台 `POST /api/ai/generate` 与
> `POST /api/ai/render` 现保留既有提示词优先 DTO，但使用租户 RLS bigint
> `floor_plan_style`、`furnishing_render` 及旧版 `soft_furnishing_render` 生成记录。
> 渲染会将显式或继承的来源图片物化为 PostgreSQL 媒体资产，再复用供应商尝试、轮询、
> 结果媒体交付和幂等积分结算；重试会开启新的计费生命周期。`ai-scenarios` 企业权限边界
> 及事务外的供应商/存储 I/O 保持不变；未导入、删除或重新加密 MongoDB 业务数据。定向
> ESLint 与 `npm run test:postgresql` 均通过（42/42）。

> 2026-08-04 PostgreSQL 迁移更新：`POST /api/ai/soft-furnishing/render` 现会将
> 来源图片存为租户所属的 PostgreSQL 媒体资产，并通过既有供应商尝试、轮询、结果媒体及
> 幂等积分结算生命周期执行 bigint `soft_furnishing_render` 生成。其
> `{ id, status, imageUrl }` DTO 和 `ai-scenarios` 企业权限边界保持不变；供应商与
> 存储 I/O 保持在数据库事务外。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与
> `npm run test:postgresql` 均通过（41/41）。

> 2026-08-04 PostgreSQL 迁移更新：`POST /api/ai/advice` 与
> `POST /api/ai/creation/prompt-assist` 现会创建租户 RLS 范围的 PostgreSQL bigint
> `advice` 生成记录。它们保留既有响应 DTO 与 `ai-scenarios` 企业权限边界，并复用
> PostgreSQL 供应商尝试审计及幂等的积分冻结、扣除和释放生命周期。供应商聊天 I/O
> 保持在短数据库事务外；未导入、删除或重新加密历史 MongoDB ObjectId 建议记录。
> 定向 ESLint 与 `npm run test:postgresql` 均通过（40/40）。

> 2026-08-04 PostgreSQL 迁移更新：`GET /api/ai/quota` 和
> `GET /api/ai/design-capabilities` 已不再连接 MongoDB；它们在既有租户和
> `ai-scenarios` 边界内，从 PostgreSQL Repository 和供应商注册表派生不变的点数、
> 价格、策略、供应商就绪状态和动作 DTO。两个路由均没有 MongoDB/ObjectId 回退分支。

> 2026-08-04 PostgreSQL 迁移更新：`GET /api/ai/history` 现只通过
> `AiCreationRepository` 和租户 RLS PostgreSQL 事务读取 bigint 生成记录；分页
> DTO 保持兼容，旧展示类型筛选会映射到 PostgreSQL 场景阶段。迁移 `0012` 为该读取
> 增加租户/时间及租户/类型/时间索引。该路由没有 MongoDB 或 ObjectId 回退分支，且不再
> 读取历史 MongoDB 生成记录。

> 2026-08-04 PostgreSQL 迁移更新：bigint `GET /api/ai/status/[id]` 现在会先刷新到期供应商轮询，再通过租户 RLS PostgreSQL 事务读取生成状态；保留既有状态 DTO 与 PostgreSQL 生成图片交付 URL。历史 ObjectId 状态请求继续使用 MongoDB 兼容分支，且仅在 bigint 判断之后才连接 MongoDB。未导入、删除或重新加密 MongoDB 业务数据。

> 2026-08-04 PostgreSQL 迁移更新：后台 AI 设计助手现通过租户 RLS PostgreSQL Repository
> 查询线索、正式户型和员工，并通过 bigint 工作流服务完成方案列表、详情、创建、推荐、经确认的
> 阶段执行和定稿选择。工具 DTO 与确认行为保持不变，且 bigint 标识符会在面向助手的文本中脱敏。
> 小程序 AI 任务执行现使用 PostgreSQL bigint 任务、媒体、供应商尝试和积分生命周期；历史 ObjectId 素材仅保留只读兼容交付。未导入、删除或重新加密 MongoDB
> 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（39/39）。

> 2026-08-04 PostgreSQL 迁移更新：bigint `POST /api/ai/workflows/[id]/run-stage`
> 现保持确认响应，在租户 RLS 中准备并提交一条 `scenario` 生成记录，再返回 PostgreSQL 工作流
> 上下文。选风格、基准方案和彩平转透视阶段会把正式 v4 控制图保存为 PostgreSQL 输入资产；提交失败
> 会释放冻结点数，结算结果按既有规则推进工作流/首个定稿。`lighting` 的视觉分析与提示词编译也会先
> 写入 PostgreSQL 供应商尝试审计，再复用同一场景图片生命周期。旧 ObjectId 路由仍保持 MongoDB 兼容；
> `mock-generation` 已由上方较新的迁移记录切换为 bigint 兼容。未导入、删除或重新加密 MongoDB
> 业务数据。

> 2026-08-04 PostgreSQL 迁移更新：`GET/POST /api/ai/workflows` 及 bigint
> `GET/PATCH /api/ai/workflows/[id]` 现通过租户 RLS 事务使用 PostgreSQL 工作流、线索和
> 生成数据。既有列表/搜索和详情 DTO 及 `ai-scenarios` 企业权限边界保持不变；PostgreSQL
> 工作流支持创建、重命名、阶段指针和已成功产物的定稿选择。历史 ObjectId 详情/变更请求仍保留
> MongoDB 兼容分支，而集合路由有意仅列出 bigint 记录。上方较新的迁移记录已启用 bigint
> 工作流的 `mock-generation`。这项限制已由上方 2026-08-04 阶段执行迁移记录更新：常规
> 阶段执行、正式户型控制图和供应商输入媒体物化已切换。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与
> `npm run test:postgresql` 均通过（39/39）。

> 2026-08-04 迁移记录：GET /api/ai/workflows/[id]/source-image 现识别 bigint
> 工作流 ID，并在租户 RLS 范围内从 PostgreSQL 读取后交付已持久化的 data URI 来源图。该路由保留
> 原有企业认证边界，MongoDB 连接仅在旧 ObjectId/媒体资产兼容分支建立，因此历史工作流资产仍可读取。
> 本项为 Limited：仅交付 PostgreSQL data URI 来源图；公开工作流创建、阶段执行、外部/供应商媒体存储
> 及 MongoDB 数据迁移均未改变。定向 ESLint 与 npm run test:postgresql 均通过（39/39）。

> 2026-08-04 PostgreSQL 迁移更新：已准备的租户 RLS bigint 工作流 `scenario`
> 生成记录现可进入既有内部供应商生命周期。供应商尝试会快照工作流/阶段/预设元数据；到期且已
> 受理的场景任务使用同一短 `FOR UPDATE SKIP LOCKED` 轮询租约，成功/媒体结算/点数扣除和
> 失败/释放均保持为幂等的租户 RLS 状态变更。本项仍为 `Limited`：供应商和对象存储 I/O
> 保持在事务外，公开工作流阶段路由和权限仍由 MongoDB 支持。未导入、删除或重新加密 MongoDB
> 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（39/39）。

> 2026-08-03 PostgreSQL 迁移更新：`postgres-workflow-service` 现提供租户 RLS
> 范围的工作流创建与读取上下文基础层。它会校验 bigint 线索属于当前租户，且所选户型
> 属于该线索并为可用的已完成 v4 正式量房户型；再使用 PostgreSQL 记录返回既有工作流、
> 线索、生成记录与阶段状态 DTO 形状。本项不切换 `/api/ai/workflows`、阶段执行、来源图
> 媒体持久化/交付或任何权限边界：这些公开 MongoDB 路径仍是当前运行时，待完整 bigint
> 执行切片就绪后再迁移。未导入、删除或重新加密 MongoDB 业务数据。

> 2026-08-03 PostgreSQL 迁移更新：工作流基础层现也可在租户 RLS 范围内变更 bigint
> 工作流状态。重命名、阶段指针调整及已成功生成记录的定稿选择都会锁定相应 PostgreSQL
> 记录，并始终保留唯一的选中定稿。公开工作流变更和阶段执行路由仍由 MongoDB 支持，待完整
> bigint 执行切片就绪后再迁移；未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与
> `npm run test:postgresql` 均通过（38/38）。

> 2026-08-04 PostgreSQL 迁移更新：工作流阶段准备现会在验证租户 RLS 工作流、线索、
> 正式户型关联、阶段依赖、企业策略及活跃阶段冲突后，才写入一条 bigint `scenario` 生成记录，
> 并快照风格、提示词和 `image.scenario` 价格数据。本项仍为 `Limited`：供应商提交/轮询、
> 媒体物化、点数结算和公开工作流阶段路由仍在当前 MongoDB 执行链；未导入、删除或重新加密
> MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（38/38）。

> 2026-08-04 PostgreSQL 迁移更新：内部点数冻结/释放边界现覆盖已准备的 bigint `scenario`
> 生成记录，会通过既有幂等租户 RLS 流水冻结并释放其精确的 `image.scenario` 价格快照。本项
> 仍为 `Limited`：供应商尝试、媒体物化、终态结算、轮询和公开阶段路由均未切换；未导入、删除
> 或重新加密 MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（38/38）。

> 2026-08-03 PostgreSQL 迁移更新：关联的 bigint 自由创作运行时切片现已启用。
> `POST /api/ai/creation/assets`、`GET/POST /api/ai/creation/tasks`、
> `DELETE /api/ai/creation/tasks/[id]`、
> `POST /api/ai/creation/tasks/[id]/batches` 和
> `POST /api/ai/creation/generations/[id]/attach-workflow` 现均在租户 RLS
> 事务内使用 PostgreSQL 媒体、任务、批次、生成、供应商尝试、点数与工作流记录。
> 既有任务 DTO 和 `ai-scenarios` 权限边界不变；十进制生成图片请求会转入
> PostgreSQL 资产交付路由。供应商和存储 I/O 仍在事务外，结果资产会先持久化，
> 再进行幂等点数结算。未导入、删除或重新加密 MongoDB `ObjectId` 创作历史。
> 创作历史刷新仍可为单个租户轮询；既有受保护的 `/api/ai/reconcile` 与
> `/api/admin/ai-reconciliation` 调度边界现会在平台范围认领到期 PostgreSQL 任务，
> 并在旧 MongoDB 结果之外返回 `postgresqlClaimed`。
> 定向 ESLint 与 `npm run test:postgresql` 均通过（38/38）。

> 2026-08-03 PostgreSQL 迁移更新：`postgres-creation-service` 现为后台 worker 提供平台内部的供应商轮询任务认领。
> 短事务会对到期且已受理的 bigint 生成记录使用 `FOR UPDATE SKIP LOCKED`，在 `externalTask` 中持久化不透明租约，
> 并在提交后才返回供应商路由元数据。轮询、成功和失败写入可要求该租约，并拒绝过期 worker。迁移
> `0011_ai-generation-provider-poll-queue` 新增匹配的部分索引。此项仍仅是基础层：供应商 I/O、公开路由、用户权限和
> 工作流归入边界尚未切换；未导入、删除或重新加密 MongoDB 业务数据。

> 2026-08-03 PostgreSQL 迁移更新：`postgres-creation-service` 现可在租户 RLS 范围汇总自由创作批次状态。
> 它会先锁定 bigint 批次，再锁定其有序生成记录，校验预期数量，并且仅在状态变化时写入既有的 `processing`、
> `succeeded`、`partial` 或 `failed`。此项仍仅是基础层：供应商 I/O、公开路由和工作流归入边界尚未切换；
> 未导入、删除或重新加密 MongoDB 业务数据。

> 2026-08-03 PostgreSQL 迁移更新：`postgres-creation-service` 现提供带 RLS 范围的供应商结果结算边界。
> 结果存储完成后，它会锁定成功 bigint 生成记录及其输出资产、再次校验已受理尝试不可变的远端任务 ID，再原子
> 关联 PostgreSQL 资产 URL 并扣除已冻结价格。重复结算保留首次资产和账户余额。此项仍仅是基础层：供应商 I/O、
> 公开路由和工作流归入边界尚未切换；未导入、删除或重新加密 MongoDB 业务数据。

> 2026-08-03 PostgreSQL 迁移更新：`postgres-creation-service` 已为自由创作提供
> PostgreSQL 批次准备基础层：在平台/租户 RLS 范围校验 bigint 任务、素材、目录档案、提示词
> 约束、企业策略和模型价格后，创建保存模型/参数/价格快照的待执行批次和生成记录。该服务尚未
> 接入公开路由；供应商提交/轮询、结果媒体写入、点数扣除/释放和工作流归入仍属于待迁移的
> MongoDB 执行链。本步骤未导入、删除或重新加密业务数据。

> 2026-08-03 PostgreSQL 迁移更新：公开 `GET /api/branding/[id]` 已在平台 PostgreSQL 事务中通过 `EnterpriseRepository` 读取已激活企业的名称、Logo 和品牌配置；接口路径、激活状态边界及未配置品牌色时的默认响应保持不变，不再连接 MongoDB。

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
- 构建/运行说明（2026-08-10）：共享后台外壳通过 `globals.css` 和
  `antd-provider.tsx` 使用本地系统字体栈（`PingFang SC`、`Microsoft YaHei`、
  `Noto Sans CJK SC` 及思源黑体回退），不再在 Docker 构建时下载
  `next/font/google` 资源；路由、API、权限和数据契约保持不变。
- 认证与租户：`src/lib/auth.ts`、`session.ts`、`proxy.ts`、`tenant-context.ts`、`tenant-route.ts`、`miniprogram-auth.ts`。
- 租户隔离：使用 `withTenantRoute`、`withTenantContext`、租户解析器和 `multiTenantPlugin`；平台管理员通过 `global_tenant_id` Cookie 切换全局视图。
- 角色：`super_admin`、`admin`、`enterprise_admin`、`designer`、`salesperson`、`measurer`、`viewer`。菜单和默认权限在 `models/AdminUser.ts`，自定义角色在 `models/SystemRole.ts`。
- 共享反馈：可见变更使用 `components/ui/operation-feedback`，常规操作不得使用原生 `alert()`。
- 已迁移管理页使用 ProComponents `PageContainer` 统一页面标题、说明、返回导航和页面级操作区；列表、表单、详情分别使用 `ProTable`、`ProForm`、`ProDescriptions`。
- 共享后台页面框架会填满侧栏右侧的可用工作区，保留固定响应式内边距（紧凑屏 `20px`、`sm` 起 `28px`），但不再设置居中的最大宽度，保证运营表格能使用完整宽度。
- `PageContainer` 不负责业务区块间距；共享后台壳层会在标题分割线下为内容容器提供 `24px` 顶部内边距，首个区块不得重复添加顶部 margin。迁移页面使用 Ant Design `Flex`/`Space` 或文档明确的 `ProCard` 布局处理区块间距，并使用 `ProForm.submitter.render` 分离底部操作区。
- 迁移列表的行内直接操作统一使用紧凑的 Ant Design 带图标文字按钮，覆盖详情、编辑、删除和状态变更；存在多项低频操作的页面保留可访问的小尺寸图标下拉入口，不新增自定义行操作封装。该展示约定不改变路由、API、权限或数据契约。

## 功能模块

### 1. 登录、注册与会话

- 页面：`/login`、`/register`。
- API：`/api/auth/login`、`/logout`、`/me`、`/miniprogram`、`/register-company`、`/register-enterprise`。
- 模型/工具：PostgreSQL `AdminUserRepository`、`UserRepository`、`EnterpriseRepository`、会话/认证工具和 `miniprogram-jwt`。
- 状态：后台登录/会话复核、企业自助注册、小程序员工登录/身份绑定、JWT/Cookie、账号状态复核和未授权跳转均已切换 PostgreSQL，为 `Implemented`。
- 旧平台管理员恢复：`npm run migrate:legacy-admin-users` 会以幂等方式把 MongoDB 的平台级账号导入 PostgreSQL，保留 bcrypt 密码哈希、角色、账号状态和菜单权限，因此用户可继续使用原密码。带租户的旧账号会被刻意跳过，因为其 MongoDB ObjectId 租户引用必须先显式映射为 PostgreSQL bigint 企业 ID。
- 用户审计页面：`/users`、`/users/[openid]`，由 `/api/users`、`/users/[openid]`、`/users/me` 支撑，已使用 PostgreSQL 查询和更新小程序身份，并返回 PostgreSQL 户型计数/导出列表。后台列表和详情现使用 `PageContainer`、`ProTable` 与 `ProDescriptions`，`users` 菜单权限路由守卫仍为只读；`GET /api/users` 支持可选 `page`、`limit` 参数进行服务端分页，并保留既有 `data`、`count` 字段。`Limited`：仍使用 MongoDB 的 AI 生成/媒体与订单/提成工作流要等后续 Phase 3 域切换后才能消费 PostgreSQL bigint 身份。

### 2. 导航、角色与访问控制

- 页面：`/roles`、共享 Sidebar、路由守卫。
- API：`/api/roles`、管理员、员工和部门接口。
- 状态：`Implemented`。支持菜单可见性、有效权限、角色默认值、自定义菜单 key、账号状态、部门归属和路由角色校验。`/api/roles`、后台/小程序权限解析、管理员/员工 CRUD、部门归属、地推连接表和管理员列表权限映射已使用 PostgreSQL `SystemRoleRepository`、`AdminUserRepository` 和 `DepartmentRepository`；员工和部门操作在 RLS 租户事务内执行。角色 handler 内强制平台 `super_admin`/`admin` 边界，默认角色以幂等插入初始化且不会覆盖已配置菜单。`/roles` 现使用共享 Ant Design 展示模式（`PageContainer`、配置面板与受控 `Checkbox.Group`）维护默认角色菜单；此次仅迁移展示层，不改变 API、菜单 key 数据契约、平台角色边界或已有账号的有效权限语义。

### 3. 平台概览与企业租户

- 页面：`/`、`/enterprises`、`/enterprises/[id]`，以及企业 AI、自动化子页面。
- API：`/api/admin/enterprises`、`/activate`、`[id]`、`[id]/ai-key`、`[id]/ai-sync`、`[id]/ai-usage`、`/api/branding/[id]`。
> 2026-08-05 PostgreSQL 迁移更新：`GET /api/ai/usage` 以及平台兼容企业读取
> `GET /api/admin/enterprises/[id]/ai-key`、`/ai-sync`、`/ai-usage` 现通过
> 租户或平台 RLS 范围内的 typed PostgreSQL Repository 读取
> `enterprise_ai_usage_snapshots`。既有 `super_admin`/`admin` 边界、租户用量
> DTO 和返回 `410` 的已废弃写入接口均不变。由于企业级 Pollinations 凭证已停用，
> `ai-key` 现明确返回 `aiConfig: null`；供应商凭证继续由平台统一管理。未导入、删除
> 或重新加密 MongoDB 业务数据。定向 PostgreSQL 集成测试通过（45/45）。

- 模型/工具：PostgreSQL `EnterpriseRepository`、`AdminUserRepository`、`PromotionRecordRepository`、`CommercialRepository`、`EnterpriseAiUsageSnapshotRepository`。旧 `enterprise-ai` Pollinations 同步实现仅保留给已退役兼容代码；已迁移读取不连接 MongoDB。
- 状态：`Implemented`。覆盖企业入驻/激活、资料、品牌、自动化、AI 配置/用量和平台概览。
- 后台 UI：`/enterprises` 使用共享 Ant Design ProComponents 列表模式，采用 `PageContainer`、`ProTable`、基于权威列表 API 的客户端搜索/分页、状态标签和末列操作菜单。`/enterprises/[id]` 及共享企业编辑弹窗使用 `PageContainer`、Ant Design 卡片、`ProDescriptions` 与 `ModalForm`/`ProForm` 承载资料查看、AI/自动化入口和手动新增/编辑提交；企业 AI 与自动化子页使用同一 `PageContainer` tab 模式，策略、调整、流水/任务查看、通知与 SLA 控件使用 Ant Design `Checkbox.Group`、`Select`、`ProForm` 与 `ProTable`。Base64 Logo 大小限制及共享操作反馈均未改变；API 与平台角色边界均未改变。
- PostgreSQL 边界：企业列表、详情、新建、更新、删除、两个自助注册接口及 `/api/admin/enterprises/activate` 均已切换。激活在单个平台事务中创建企业和企业管理员，校验指定订单属于尚未激活的报备记录，再将指定订单或全部未绑定订单回填至新企业，并把报备推进到 `paid`。租户 `GET /api/ai/usage` 及平台兼容 `[id]/ai-key`、`[id]/ai-sync`、`[id]/ai-usage` 现以既有角色边界读取 PostgreSQL 用量快照；已退役的企业级 Key 写入仍返回 `410`，`ai-key` 返回 `aiConfig: null`。企业核心列表/详情有意继续返回 `aiUsageSnapshot: null`，不在这些 DTO 中加入快照关联。

### 4. 员工、部门与系统账号

- 页面：`/staff`、`/admins`。
- API：`/api/staff`、`/staff/[id]`、`/staff/wechat-qr`、`/departments`、`/departments/[id]`、`/admin-users`、`/admin-users/[id]`。
- 模型/Repository：PostgreSQL `AdminUserRepository`、`DepartmentRepository`、`SystemRoleRepository` 和 `admin_user_promoters` 连接表。
- 状态：`Implemented`。`/staff` 已使用共享 Ant Design ProComponents 模式（`PageContainer`、`ProTable`、`ModalForm` 与 `Tree`）承载服务端员工搜索/分页、部门筛选以及员工和部门维护；此次仅迁移展示层，不改变 API、租户范围或角色边界。编辑设计师时，中文优先的“个人微信二维码”字段会在客户端完成图片格式和 5MB 大小校验后调用 `POST /api/staff/wechat-qr`；上传成功或失败均使用共享操作反馈。既有的企业范围媒体归属和员工管理角色边界不变。后台标准管理表单的图片现统一使用 `components/ui/image-upload-field`：员工二维码、企业 Logo、灵感方案封面/效果图均使用同一个单图卡片控件，提供本地校验、缩略图、放大预览、替换和移除；各业务通过注入上传函数保留原有持久化契约。其共享 `ModuleOverview` 直接从现有列表响应派生当前页岗位数量，并显示已加载的实时部门数，不新增 API 请求。`/admins` 使用同一套 `PageContainer`、`ProTable` 与 `ModalForm` 模式承载平台账号搜索、范围与角色筛选、新建、编辑、密码重置、状态变更和删除，保留 `admins` 菜单权限守卫、PostgreSQL `admin-users` API 契约及渠道地推不绑定企业规则，表单只展示 API 支持的五种管理角色。支持企业员工、平台管理员、角色、部门树、状态和地推/设计师/测量员关系管理；为兼容前端，现有 `_id` 响应字段继续使用十进制字符串，RLS 与 route 角色检查共同执行租户边界。

### 5. B2B 企业报备与协作工作流

- 页面：`/promotion-records`、`/workflow-logs`。
- API：报备、`/promotion-records/pool`、`/conflicts`、平台报备配置、工作台 summary/todos、通知日志和提醒执行。
- 模型/工具：PostgreSQL `PlatformConfigRepository`、`PromotionRecordRepository`、`WorkflowNotificationRepository`、`postgres-promotion-workflow`、`postgres-workflow-automation`、微信通知工具。旧 `PromotionEnterpriseRecord`/`WorkflowNotificationLog` 模型仅保留给旧辅助兼容路径。
- 状态：`Implemented`。支持报备、重复/冲突、公海、认领/审批、分配、业务阶段、跟进时间线、SLA 提醒、通知去重和审计。平台 `admin`/`super_admin` 可通过 `GET/PATCH /api/platform/notification-config` 维护 `workflow_todo`、`lead_assignment`、`new_lead`、`measurement_appointment` 四个全局模板 ID；PostgreSQL `platform_configs.notification_config` 保存 V2 映射、精确关键词契约及旧单 ID 迁移事实，GET 和旧 PATCH 在一个发布周期内继续提供 `miniprogramTemplateId` 兼容。四个 ID 必须非空、合法且互不重复。`/workflow-logs` 沿用既有配置卡和共享操作反馈展示四项固定语义字段，并明确上门量房提醒当前只配置/授权、不触发。工作流按事件选择待办或指派模板并只生成允许的字段，站内日志先于微信发送；企业负责人新增客户、设计师指派/交接和测量员获客提成通知同样先写 `staff_notifications.in_app`，再记录微信 `sent`/`failed`/`skipped`，缺少 openid、模板或微信失败不回滚业务。手机号重复复用线索时不重复通知。`/promotion-records` 现有报备、公海和审批展示、平台 B2B scope、RLS Repository、短事务、角色边界和 DTO 保持不变。`Limited`：真实上门量房预约仍无数据模型/API/确认事件；更换模板后用户仍需按微信规则重新授权。仍引用 MongoDB ObjectId 的 AI/媒体消费者要等依赖切片迁移后再切换。

- 工作台展示：共享 `/` 工作台已使用 `PageContainer` 和 Ant Design 汇总/列表组件。平台角色只查看既有 API 返回的用户、正式户型和企业总量，不再展示节点、趋势、延迟或健康度等占位数据；所有非平台角色只读取 PostgreSQL/RLS 按角色裁剪的工作台卡片和待办，只有 `enterprise_admin` 额外读取既有租户范围内的线索、正式户型和员工总量。本次仅迁移展示层，不改变路由、API、权限或数据契约。

### 6. 套餐、订单与提成

- 页面：`/packages`、`/enterprise-orders`、`/commissions`。
- API：`/api/admin/packages`、`/enterprise-orders`、`/commissions`、结算和提成记录接口。
- 模型：PostgreSQL `PackageRepository` 和 `CommercialRepository`；旧 `EnterpriseOrder` 和 `CommissionRecord` 模型不再是运行时数据源。
- 状态：`Implemented`。支持套餐目录、企业订单生命周期、付费订单提成生成、提成列表、结算和作废。套餐列表/新建/更新/删除现已在平台范围 PostgreSQL 事务内执行，通过现有 `_id` 字段返回 bigint 十进制字符串，并以精确 `numeric(14,2)` 保存金额。订单、提成、结算、作废及工作台待结算提成汇总均在短 PostgreSQL RLS 事务中使用 bigint 关系；付费订单原子更新报备并 upsert 固定提成，取消订单会作废对应提成。企业激活复用同一 PostgreSQL 报备/订单关系，不引入双写。`/enterprise-orders` 已采用共享 Ant Design ProComponents 展示模式（`PageContainer`、`ProTable` 与 `ModalForm`）承载列表筛选、状态流转、创建和付费订单开通；本次仅迁移展示层，保留既有 API、PostgreSQL 数据契约、`enterprise_admin`/`admin`/`super_admin` 写入边界与 `admin`/`super_admin` 企业开通边界。`/packages` 已使用同一共享 Ant Design ProComponents 展示模式（`PageContainer`、`ProTable` 与 `ModalForm`）承载套餐筛选和维护；本次仅迁移展示层，保留其 PostgreSQL 套餐 API 与 `admin`/`super_admin` 平台边界，删除请求进行时锁定对应行，并将表格加载失败交由共享操作反馈处理；窄屏下筛选行会纵向排列。`/commissions` 已使用 `PageContainer`、Ant Design 汇总卡片和 `ProTable` 承载筛选、状态查看与结算；本次仅迁移展示层，保留其 PostgreSQL 提成 API、`salesperson` 读取范围与 `admin`/`super_admin` 结算边界，表格加载失败使用同一反馈，结算操作按记录单独防重，窄屏下筛选行会纵向排列。

### 7. 线索与转化资产

- 页面：`/leads`。
- API：`/api/leads`、`/api/leads/[id]`、`/api/acquisition-tasks` 及户型、员工关联接口。
- 模型/工具：PostgreSQL `LeadRepository`、`FloorPlanRepository`、`AdminUserRepository`、微信工具。
- 状态：`Implemented`。支持线索录入/状态、跟进、创建时绑定设计师、正式户型关联和转化上下文；列表、详情、新建、更新和删除均在 RLS PostgreSQL 事务内执行，并保留十进制字符串 `_id` DTO。线索-户型连接表、主户型选择、租户校验和删除清理为原子操作；普通微信通知在数据库事务提交后调用。企微配置、群分享和员工企微标识已弃用，已从运行时 API 与 UI 移除；历史 MongoDB 字段及 PostgreSQL `admin_users.wecom_user_id` 列保留，不迁移也不删除。`/leads` 后台视图使用共享 Ant Design ProComponents 模式（`PageContainer`、`ProTable`）承载服务端分页、四阶段客户状态筛选和独立获客状态筛选，并在详情抽屉只读展示创建时绑定的设计师、正式户型、跟进记录及获客时间/提成状态；不再提供负责人换绑控件，`PUT /api/leads/[id]` 拒绝 `assignedTo` 写入，测量员—设计师换绑仅在 `/staff` 完成且只影响后续新线索；共享 `ModuleOverview` 从同一分页响应派生当前页漏斗统计。客户主流程为“新线索→量房中→方案设计→已签约”，`已关闭`为终止筛选；历史 `acquired` 归并到“新线索”，草稿/已完成正式户型关联分别推进到量房中/方案设计。获客确认独立使用 `acquired_at/acquired_by` 和提成记录表达，不再占用客户状态。列表和详情继续取消过期请求，租户范围、角色边界及“详情”“方案”“删除”行内操作保持不变，所有可见变更继续使用共享操作反馈。

#### 客户线索归档生命周期（2026-08-10）

- `Implemented`：`closed` 继续表示业务终止；`archived_at`、`archived_by`、`archive_reason`、`archive_note` 独立控制可见性。`/leads` 新增“在用线索 / 已归档”、最多 100 条批量预检与归档、归档只读详情、恢复，以及仅管理角色可用的永久删除预检和客户名称确认；日常列表不再展示直接删除。
- `GET /api/leads` 默认 `archiveState=active`；读取归档区要求服务端实时解析的 `leads.archive_manage`。归档预检、归档、恢复和删除预检均在租户事务中使用行锁并叠加既有负责人/录入人边界；运行中的 AI 任务按条阻止，不影响同批其他可归档线索。
- `super_admin`、`admin`、`enterprise_admin` 固定拥有归档管理能力；设计师和测量员每次按企业角色默认与员工“继承 / 允许 / 禁止”覆盖实时解析。`/staff` 仅向企业负责人和平台管理员提供配置抽屉，员工岗位变化会清理旧覆盖。`leads.purge` 不可下放。
- 永久删除只接受已归档、客户名称完全匹配的空白线索。存在任意户型/正式量房、AI 工作流/生成/运行任务、获客确认/提成或跟进记录时返回 `409 LEAD_PURGE_BLOCKED`。允许删除时只删除基础线索及安全级联的内部通知，不触碰媒体资产；`lead_lifecycle_events` 在删除后继续保留不含客户 PII 的租户审计。
- 归档线索默认从小程序线索、获客任务和 AI 客户选择器隐藏；历史户型、AI 方案和提成继续可读并返回归档标识。线索/跟进更新、获客确认、户型绑定和新增/重试 AI 任务统一返回 `409 LEAD_ARCHIVED`；手机号去重命中归档档案时返回 `409 ARCHIVED_LEAD_EXISTS`，不会自动创建、换绑或重复生成提成。

#### 客户线索归档生命周期（2026-08-10）

- `Implemented`：`closed` 继续表示业务终止；`archived_at`、`archived_by`、`archive_reason`、`archive_note` 独立控制可见性。`/leads` 新增“在用线索 / 已归档”、最多 100 条批量预检与归档、归档只读详情、恢复，以及仅管理角色可用的永久删除预检和客户名称确认；日常列表不再展示直接删除。
- `GET /api/leads` 默认 `archiveState=active`；读取归档区要求服务端实时解析的 `leads.archive_manage`。归档预检、归档、恢复和删除预检均在租户事务中使用行锁并叠加既有负责人/录入人边界；运行中的 AI 任务按条阻止，不影响同批其他可归档线索。
- `super_admin`、`admin`、`enterprise_admin` 固定拥有归档管理能力；设计师和测量员每次按企业角色默认与员工“继承 / 允许 / 禁止”覆盖实时解析。`/staff` 仅向企业负责人和平台管理员提供配置抽屉，员工岗位变化会清理旧覆盖。`leads.purge` 不可下放。
- 永久删除只接受已归档、客户名称完全匹配的空白线索。存在任意户型/正式量房、AI 工作流/生成/运行任务、获客确认/提成或跟进记录时返回 `409 LEAD_PURGE_BLOCKED`。允许删除时只删除基础线索及安全级联的内部通知，不触碰媒体资产；`lead_lifecycle_events` 在删除后继续保留不含客户 PII 的租户审计。
- 归档线索默认从小程序线索、获客任务和 AI 客户选择器隐藏；历史户型、AI 方案和提成继续可读并返回归档标识。线索/跟进更新、获客确认、户型绑定和新增/重试 AI 任务统一返回 `409 LEAD_ARCHIVED`；手机号去重命中归档档案时返回 `409 ARCHIVED_LEAD_EXISTS`，不会自动创建、换绑或重复生成提成。

### 8. 正式户型、搜索与查看

- 页面：`/floorplans`、`/floorplans/[id]`、`/floorplans/kujiale`、`/measurements`。
- API：户型 CRUD、`/floorplans/[id]/export/dxf`、测量、酷家乐城市/搜索和线索关联接口；小程序 `GET /api/floorplans/[id]` 还会返回关联线索的最小身份和小区摘要，供直接进入正式量房时显示项目标题。
- 展示数据合同（2026-08-10）：`lead_floor_plans.measurement_sequence` 是每个线索下稳定的量房序号；历史关联按正式户型创建顺序回填，新关联会在锁定线索行后取得下一个序号。户型 DTO 新增只读 `display`：主标题优先为关联小区，次级身份为“客户 · 第 N 次量房”。持久化的 `FloorPlan.name` 不改名，仅作为兼容回退；`/floorplans`、查看器、小程序线索历史/首页卡片及 AI 来源选择器共用这一合同，原有租户范围和角色校验不变。由于关联表启用了强制 RLS，迁移 `0018` 会在同一迁移事务内临时解除两张关联表的强制 RLS 以回填历史数据，并在提交前恢复。
- 组件/工具：`FloorPlanViewer`、`FloorPlanViewerWrapper`、`survey-graph`、`surveyDimensionPlan`、`surveyWallSolidPlan`、`dxf`；无渲染依赖的尺寸和墙体实体规划器以 `miniprogram/utils` 为源，在后台开发和生产构建前同步到 `admin/src/lib`。
- 状态：正式 v4 墙图解析、后台 2D/3D 查看、房间填充仅接受首墙正向或反向能够完整闭合的墙链、单侧墙体与连接节点补面先做全局实体合并再统一填充和描边（连接节点、L/T 型接入及重合分段不再出现内部端帽、斜缝或独立方框；门窗切口覆盖完整墙厚）、闭合户型使用工程图式外轮廓尺寸方案（空间边界先按几何拆分合并，不同 ID/不同分段的重合共享墙及封闭内部孔洞均不标注；连续多墙或含门洞的外边界使用靠墙的定位分段链；上、下、左、右等每个外侧方向仅有一条跨整套户型外包范围的全局总尺寸，不再为局部 run 重复生成总尺寸；窗户保留 CAD 图形但不生成重复细分尺寸；延伸线从斜接后的外墙转角起笔，再引至整套户型外轮廓之外的全局尺寸带；查看器会为尺寸线、延伸线和文字自动扩展 SVG 视区，避免最外层标注被裁切）、测量筛选和 DXF 下载为 `Implemented`；`/floorplans` 已使用 `PageContainer`、`ProTable` 承载正式户型的搜索、状态筛选、分页和查看器入口，列表只从 version-4 `surveyGraph` 派生已闭合空间、墙体和开口统计，不读取或写入旧布局字段；`GET /api/floorplans` 支持可选 `status` 筛选，`floorplans` 权限、查看器和 DXF 行为均未改变；正式户型列表的查看入口与其他管理列表统一使用 Ant Design 小尺寸带图标文字按钮；酷家乐搜索受上游数据和查询条件影响，为 `Limited`。
- 2026-08-07 查看器同步：只读 `/floorplans/[id]` SVG 已按小程序真实墙厚的门窗规则绘制完整墙厚切口、平开门矩形门套/门扇/开合弧线，以及三轨窗框，并保持既有推拉和双开分类。这只是展示层更新；v4 `surveyGraph`、API、DXF、租户范围与 `floorplans` 权限边界均未改变。
- PostgreSQL 边界：正式户型 CRUD、详情渲染、线索关联、测量关联和 DXF 导出均通过 `FloorPlanRepository`、`MeasurementRepository` 在 RLS 中访问。已认证的酷家乐上游请求不再连接 MongoDB，且在数据库事务外执行；导入结果以毫米制正式 version-4 `surveyGraph` 原子持久化；房间轮廓转换为闭合节点/墙/空间链。由于上游响应尚无可靠的开口到墙体映射，当前不导入酷家乐门窗开口。
- 边界：后台从 `surveyGraph` 派生房间/开口渲染数据，不持久化旧 `rooms` 或其他旧布局字段。

### 9. 测量审计与蓝牙设备资产

- 独立设备指派：平台 `super_admin`/`admin` 可将未归属企业的设备绑定给同样未归属企业且激活的 `salesperson`（渠道地推）；企业设备仍仅能绑定同一企业员工，企业管理员不能查询或绑定独立渠道地推。
- 绑定状态：为闲置设备保存一名或多名绑定人员会自动切换为 `assigned`，这是 `/api/devices/verify-binding` 授权所必需的状态；没有绑定人员的独立设备不能保持 `assigned`，但企业归属设备可在未指定人员时作为企业共享设备使用。`maintenance`、`lost` 状态始终不能被小程序授权。
- 页面：`/devices`、`/measurements`。
- API：设备 CRUD、`/devices/verify`、`/devices/verify-binding`、`/measurements`，以及仅平台可用的独立渠道地推查询 `/api/staff?scope=unassigned-promoters`。平台角色还可通过 `/api/staff?enterpriseId=<id>` 查询所选设备归属企业的激活员工，企业角色不能使用该查询。平台角色即使当前 UI 选择了企业，也以平台作用域读取设备池，确保已有独立设备仍可编辑和绑定。
- 模型/Repository：PostgreSQL `DeviceRepository`、`device_user_bindings`、`MeasurementRepository`、`AdminUserRepository`、`UserRepository`、`FloorPlanRepository`。
- 状态：`Implemented`。支持设备池、企业/用户绑定、校验、状态管理，以及来源为 BLE、手动或系统的长度/高度/面积/角度/门窗审计记录。一台设备可通过 `device_user_bindings` 绑定多名 `admin_users`；为兼容已有消费者，`devices.assigned_user_id` 仍保存首名绑定人员，已有单人绑定会迁移到关系表。平台/企业管理员可变更设备，员工可读取所有绑定到自己的设备。测量写入会在同一 RLS PostgreSQL 流程中校验操作员、企业、正式户型、数值/类型/来源/时间和已分配设备。`/measurements` 后台视图现使用共享 Ant Design ProComponents 列表模式（`PageContainer`、`ProTable`）承载响应式搜索/筛选、加载/失败反馈和来源标识；共享 `ModuleOverview` 从同一最多 100 条的筛选结果派生 BLE、手动和关联户型数量；其 API 参数、角色范围及记录上限不变。`/devices` 使用 `PageContainer`、`ProTable` 与 `ModalForm` 承载搜索、状态筛选和录入/编辑弹窗；平台角色可选择企业，表单会重新加载该企业的多名激活兼容员工后供绑定，并保留既有状态枚举。`POST`/`PATCH` 接受 `assignedUserIds` 并返回 `assignedUsers`，单数 `assignedUserId` 响应继续作为兼容别名；服务端仍负责现有租户和跨企业绑定校验；重复设备编码的新建请求返回 `409` 和“编辑已有设备”的业务提示，不再返回原始数据库错误。其共享 `ModuleOverview` 从现有设备列表响应派生当前筛选的状态数量。设备行内“编辑”和“删除”保留与其他管理列表一致的带图标文字 Ant Design 操作按钮，所有可见变更继续使用共享操作反馈。路由和权限边界不变，PostgreSQL 设备绑定数据契约现为多对多。

### 10. AI 工作室与设计生成

- 页面：`/ai-studio/scenarios` 是客户方案 AI 执行工作台，包含“客户方案、快速工具、AI 助手”；旧 `/ai-studio/designer`、`/ai-studio/floor-plan`、`/ai-studio/furnishing`、`/ai-studio/soft-furnishing` 和方案详情 URL 保留相关查询参数后跳入统一工作台。`/ai-studio/create` 是独立全屏自由创作台，后台侧栏以新标签页打开。资源/配置入口继续为 `/inspirations`、`/ai-presets`、`/ai-providers`、`/ai-models`、`/ai-credit-prices`，企业 AI 页继续管理统一点数。场景新建设计向导现使用带原生步骤指示的 Ant Design `Modal`，版本历史现使用 Ant Design `Drawer`；输入、确认、上传、生成轮询及路由/查询参数行为均不变。
- 三个工作台入口现在共享全宽响应式工作区边距：客户方案、户型/风格/软装三个快速工具和 AI 助手保留既有工作流、API、点数处理及 `ai-scenarios` 企业权限边界。
- AI 供应商后台路由：`/ai-providers` 是供应商列表；`/ai-providers/new` 用于新增供应商；`/ai-providers/[id]` 用于查看和编辑供应商；`/ai-models` 是独立的平台生图模型目录。页面使用基于 Ant Design ProComponents 的共享后台壳层（`ProTable`、`ProForm`、`ProDescriptions`），`/ai-models` 复用 `ai-providers` 平台权限，仅平台 `super_admin`、`admin` 可操作（`Implemented`）。供应商可通过 `PATCH /api/admin/ai-providers/[id]` 停用；没有供应商尝试审计记录引用的供应商可通过 `DELETE /api/admin/ai-providers/[id]` 物理删除，已被引用的供应商返回 `409` 并必须保留为停用状态。相同平台角色可通过 `DELETE /api/admin/ai-providers` 及 `{ ids }` 一次批量删除 1-100 个已选供应商；响应会分别返回已删除、被审计引用阻止和不存在的 ID，以在不删除审计历史的前提下移除可删除配置。
- 灵感方案后台：`/inspirations` 使用同一套 `PageContainer`、`ProTable`、`ModalForm` 展示模式，支持案例筛选、图片预览、发布、推荐状态和删除。`GET/POST/DELETE /api/inspirations` 现通过 `InspirationRepository` 在租户 RLS PostgreSQL `inspirations` 表中运行；既有筛选、十进制字符串 `_id`、数字 `viewCount`、当前菜单权限与案例工作流保持不变。路由要求已认证的企业上下文，状态为 `Implemented`；历史 MongoDB 灵感方案既未导入，也不会混入新的 bigint 列表。
- 灵感方案页的概览从现有列表响应派生当前筛选的方案、推荐和浏览总数，列表失败继续使用共享操作反馈，不新增 API 请求；租户 RLS、企业上下文、菜单权限与案例工作流保持不变。
- 供应商接入契约：`AiProviderConfig` 保留旧版加密 API Key 字段，同时持久化加密/掩码凭证映射和经校验的非敏感 `adapterConfig`。统一编辑页与服务端校验共同读取 `src/lib/ai/provider-adapter-manifest.ts`；当前 GRS、API Nebula、Pollinations、OpenAI Compatible 使用公共的地址/API Key 配置。专用 API Nebula Adapter 复用 OpenAI Compatible 的聊天与模型发现协议，并通过 `/v1/image-tasks/generations`、`/v1/image-tasks/edits` 和 `/v1/image-tasks/{taskId}?detail=true` 执行异步生图。运行时供应商路由始终优先选择已启用的非 fallback 供应商，key 以 `-fallback` 结尾的配置排在主供应商之后。图片执行仅在提交明确未被受理时继续尝试下一供应商；超时或响应含义不明确时不会重复创建上游任务。自由创作只会在供应商映射的远程模型与已持久化 GRS 目录快照完全同名时安全切换，保留原分辨率与点数价格合同。配置 `APINEBULA_API_KEY` 后会幂等创建优先级 20、仅图片能力的 `apinebula-fallback`；不同模型分组可使用不同供应商记录/API Key。API Nebula 未公开余额 API，因此余额仍在其控制台查看。`Limited`：平台生图目录与价格档案仍由 GRS 提供，GRS 专属模型不能切到名称不同的 API Nebula 模型；租户受保护 `data:` 参考图用于 API Nebula 改图时，仍需用所选令牌分组的真实密钥完成兼容验证。
- PostgreSQL 边界：平台供应商列表、新增、更新、停用、密钥轮换、连通测试、模型同步、上游余额查询及运行时供应商选择现统一经由平台范围 PostgreSQL 事务中的 `AiProviderConfigRepository`。加密凭据保持不透明存储；异步网络调用结束后仅回写非敏感运行状态。配置了 API Key 时，环境变量中的 GRS/API Nebula/Pollinations 默认供应商会幂等写入 PostgreSQL。
- PostgreSQL 目录边界：`GET/PATCH /api/admin/ai-image-models` 通过
  `AiCreationModelProfileRepository` 读取和更新平台 GRS 目录；
  `GET/PATCH /api/admin/ai-image-model-prices` 使用同一目录校验并通过
  `AiModelCreditPriceRepository` 读写价格记录。路由保留 `super_admin`/`admin`
  边界、目录 DTO、唯一启用默认模型约束，以及未包含目录元数据的供应商发现模型只读展示。
- 同步文本生成：`POST /api/ai/advice` 与
  `POST /api/ai/creation/prompt-assist` 会在租户 RLS 范围内创建 PostgreSQL bigint
  `advice` 生成记录，保留既有响应 DTO，并使用与其他 PostgreSQL AI 生成路径相同的
  供应商尝试审计以及幂等积分冻结/扣除/释放生命周期。供应商聊天 I/O 保持在短事务外；
  历史 MongoDB 建议记录仍为只读历史数据。
- 直连软装渲染：`POST /api/ai/soft-furnishing/render` 会将输入保存为 PostgreSQL
  租户媒体资产，并创建 bigint `soft_furnishing_render` 生成记录。其图片供应商提交、
  轮询、结果媒体交付和幂等积分生命周期复用 PostgreSQL 执行运行时；既有 DTO 与
  `ai-scenarios` 企业权限边界保持不变。
- 两步式直连渲染：`POST /api/ai/generate` 会持久化租户 RLS bigint 的提示词优先生成记录并
  冻结其价格快照点数；`POST /api/ai/render` 会在供应商提交前，将显式、父生成、已选工作流或
  风格参考来源图片物化为 PostgreSQL 媒体资产。户型、软装及旧版两步式直连软装类型共用
  PostgreSQL 供应商尝试、轮询、结果媒体、结算和重试计费生命周期，并保持既有 DTO 与
  `ai-scenarios` 权限边界。
- API：AI 对话/Agent、生成/渲染/建议、状态/历史、预设、工作流搜索分页及阶段、设计能力/共享动作目录、媒体资源、供应商 CRUD/密钥轮换/连通测试/模型同步/上游余额查询、受保护任务对账、平台业务动作价格、`GET/PATCH /api/admin/ai-image-models`、`GET/PATCH /api/admin/ai-image-model-prices`、企业点数发放/调整/流水/任务和失败任务重试接口。旧企业 `ai-key`/`ai-sync` 和用量读取仅保留原有 DTO 的只读兼容，现由 PostgreSQL 用量快照提供数据；已退役写接口返回 `410`。
- 自由创作 API：`GET /api/ai/creation/bootstrap`、提示词分类/列表/详情/预览、`POST /api/ai/creation/assets`、`GET/POST /api/ai/creation/tasks`、`DELETE /api/ai/creation/tasks/[id]`、`POST /api/ai/creation/tasks/[id]/batches`、`POST /api/ai/creation/tasks/[id]/batches/[batchId]/retry`、提示词优化及生成结果归入现有客户方案。创作台会按顺序把已持久化 batch 渲染为任务内多轮对话，保留每轮提示词/参考图上下文；选中已有任务时追加 batch，桌面端在提示词面板上方提供更大的对话可视区，并隐藏原生滚动条但保留滚动能力。参考图控件现会按已选模型既有的 0–10 张能力上限，呈现全部已上传素材：编号叠放后可在悬浮或键盘聚焦时展开，逐张显示移除入口和与缩略图交叠的圆形追加按钮；提示词文本域隐藏浏览器滚动条外观，但保留鼠标滚轮、触控板、键盘与触摸滚动。执行态任务摘要的参考图缩略图读取已持久化的当前 batch 快照（缺失时回退任务快照），因此从下一次生成输入器移除参考图不会改动已提交的任务历史。点击图片可打开含缩略图切换、上一张/下一张、缩放、旋转、全屏和下载的多图预览。新增重试接口只接受最新的 `failed` 或 `partial` batch，仅重开其失败 generation，成功图片和 batch 轮次保持不变；重开项会清理旧供应商任务状态、递增 `retryCount`，并按快照模型/分辨率的当前启用价格开启新计费周期。输入未变时，失败轮显示“重试本轮”或“重试失败项”；修改提示词、参考图、模型、画幅、数量或模板后则新增一轮。`pending`/`processing` 轮会禁止重复提交并继续轮询状态。界面和接口继续使用租户范围的任务/batch/generation DTO，不新增数据模型或角色边界。页面和整个 API 前缀由代理统一映射到 `ai-scenarios` 权限，写接口还通过 `withTenantRoute` 强制企业上下文。
- PostgreSQL 身份边界：新的自由创作、小程序、场景和 `advice` 任务/生成/媒体/供应商尝试/点数记录均在租户 RLS 范围内一致使用 PostgreSQL bigint 标识符。历史 MongoDB `ObjectId` 媒体仅通过显式只读交付分支可读，该分支会在请求被识别为历史记录后才加载 MongoDB/Mongoose；新记录不存在跨存储身份回退。具有企业上下文的 `admin` 或 `super_admin` 可通过平台重试接口，将失败的 PostgreSQL bigint 小程序生成任务交由租户 RLS 生命周期重试；历史 `ObjectId` 生成任务继续使用 MongoDB 兼容分支。小程序自身的重试路由仍仅限原操作人的 PostgreSQL 任务。
- 企业点数任务边界：平台企业点数读取现从 PostgreSQL bigint 生成记录中列出最近任务，并关联操作员和当前供应商模型。账户/流水/策略/任务 DTO 与 `super_admin`/`admin` 边界保持不变；历史 MongoDB ObjectId 任务有意不与该列表混合。
- 模型/工具：`AiGeneration`、`AiWorkflow`、`AiChatSession`、`AiStylePreset`、`AiProviderConfig`、`AiProviderAttempt`、`MediaAsset`、`AiCreditAccount`、`AiCreditLedger`、`AiCreditPrice`、`AiModelCreditPrice`、PostgreSQL `InspirationRepository`、`src/lib/ai/*`、`src/lib/media-storage/*`。
- 自由创作与模板库模型：`AiCreationTask`、`AiCreationBatch`、`AiCreationModelProfile`、`AiPromptLibraryRevision`、`AiPromptCategory`、`AiPromptTemplate`、`AiPromptParameterTemplate`、`AiPromptSourceModel`、`AiPromptTemplateAsset`、`AiPromptImportRun`。
- 模板库运维：`npm run import:roomi-prompts` 默认只预览；增加 `-- --execute` 才原子发布通过完整校验的新版本，或用 `-- --source-file=<export.json> --execute` 从导出恢复；`npm run verify:roomi-prompts` 校验来源数量、引用、预览图校验和与抽样一致性。临时凭据和快照位于 Git 忽略的 `admin/.roomi-import/`，导入预览图保存在 Git 忽略的本地目录，不上传七牛。
- Phase 4 保留数据迁移：`npm run migrate:phase4-retained-data` 先校验冻结的 RoomiAI 快照，再幂等导入活动版本、完整引用图和本地预览文件至 PostgreSQL；同时导入活动七牛配置和 Provider 指针，执行完整七牛探针并写入迁移检查点。脚本仅只读旧 MongoDB，绝不删除 MongoDB 记录、导入快照或七牛对象。
- PostgreSQL 运行时迁移：提示词库只读 API（`GET /api/ai/creation/prompt-categories`、`GET /api/ai/creation/prompt-templates`、模板详情和预览）已切换到 typed PostgreSQL Repository 与平台事务，DTO 和 `ai-scenarios` 权限边界保持不变；Phase 4 保留数据导入器已将活动提示词库直接写入 PostgreSQL；AI 风格预设的默认初始化、读取和平台管理员更新已切换到 typed `AiStylePresetRepository` 与平台事务，并保持字符串 `_id` API DTO 不变。生成任务持久化和模型档案同步仍待 Phase 3 后续切片，当前继续使用 MongoDB。新建生成批次也通过 PostgreSQL 解析所选模板和参数定义。`Limited`：引用线索或户型的 MongoDB AI 工作流/媒体/生成路由尚不兼容 bigint，不属于本切片。
- AI 供应商配置及运行时选择现使用 typed `AiProviderConfigRepository` 和平台事务，保留既有平台 `ai-providers` 权限、路由与 DTO；AI 工作流、生成、媒体资产及模型档案同步仍为 MongoDB 切片。
- 平台业务动作价格及自由创作模型/分辨率价格现分别使用平台 PostgreSQL 事务中的 `AiCreditPriceRepository` 与 `AiModelCreditPriceRepository`。自由创作批次和生成计费仍是 MongoDB 数字字段时，执行边界只接受正的安全整数 PostgreSQL 价格后才写入批次估算和价格快照。企业 AI 点数账户和流水现通过租户 PostgreSQL 事务中的 `AiCreditRepository` 读写，唯一 `operationId` 流水与余额变更原子执行，保证发放、调整、冻结、扣除和释放的幂等性；账户/流水 bigint 在 API 中仍序列化为数字，企业 AI 点数后台接口已从 PostgreSQL 读取账户、策略和流水，平台角色边界不变。在 `AiGeneration` 迁移完成前，旧 MongoDB 生成记录的 ObjectId 会明确写为 PostgreSQL 流水 `generationId: NULL`，不会错误转换为 bigint 外键。`AiCreationModelProfile` 也继续留在 MongoDB，因为 `AiCreationTask`、`AiCreationBatch`、`AiGeneration` 仍引用其旧 `ObjectId`；本切片将可执行价格及企业点数账本写入 PostgreSQL。
- 新 PostgreSQL bigint 媒体资产现由 `/api/ai/assets/[id]/image` 在租户 RLS 事务中读取交付；旧 ObjectId 素材 URL 在 AI 切换期间仅保留 MongoDB 历史只读兼容路径。
- `GET /api/ai/workflow-leads` 现使用 PostgreSQL 线索/户型关系和 RLS 范围的 `AiWorkflowRepository` 摘要查询，保留原有搜索、正式户型可用性筛选、响应 DTO 与 `ai-scenarios` 企业边界。
- `GET /api/ai/creation/bootstrap` 现通过 PostgreSQL 模型档案/价格 Repository 初始化并读取 GRS 目录，并在租户 RLS 范围读取活动工作流及其关联线索；DTO、点数、供应商和 `ai-scenarios` 边界不变。旧 MongoDB 目录维护仅保留给尚未切换的任务/批次/生成执行链。
- `postgres-creation-service` 现提供内部 PostgreSQL 批次准备边界：它会校验租户所属的 bigint 任务和素材、已启用目录档案、提示词约束、企业策略及精确模型/分辨率点数价格，再持久化保存模型、参数和价格快照的待执行批次及生成记录。其内部执行边界现会在同一租户事务中原子认领生成记录点数流水、冻结价格快照并推进为可提交状态；重复调用不会重复冻结。该服务尚未接入公开路由，供应商提交/轮询、结果媒体写入、点数扣除/释放与工作流归入仍需作为同一执行链共同切换。
- 已冻结的生成记录现可在内部 PostgreSQL 边界原子认领供应商尝试，保存供应商配置、固定远端模型、请求指纹和请求快照并推进为 `processing`；重试复用活动尝试。供应商网络调用最终返回后，其已受理异步响应可在当前生成记录锁内保存远端任务 ID、供应商状态和轮询元数据；重复回执保留首次任务 ID，过期或冲突响应会被拒绝。供应商网络调用、轮询、结果媒体写入和公开路由仍不属于该边界。
- 同一当前生成记录锁内现也可回写非终态轮询状态：`processing` 与 `unknown` 均保持首次记录的远端任务 ID，保存上游诊断和受限的下次轮询元数据；后续 `processing` 响应会清除临时未知状态错误。网络轮询、终态结果结算、结果媒体写入和公开路由仍未切换。
- 同一锁内现也可记录已受理尝试的成功终态：校验不可变的远端任务 ID 后保存供应商结果和实际成本快照，并将尝试和生成记录同步推进为 `succeeded`；重复成功响应保留首次结果。仍冻结的生成记录可进入独立的幂等点数扣除边界，但该步骤不写结果媒体、不调用扣除、不执行供应商网络调用，也不切换公开路由。
- 成功终态还可原子关联一条已持久化且属于租户范围的 `ai_generation_output` 资产：锁定生成记录和资产后再次校验尝试及不可变远端任务 ID，再写入 PostgreSQL 资产 URL，并将未归属结果资产认领给该生成任务。重复关联保留首次图片，另一生成任务无法认领同一资产；该边界不执行供应商下载/存储 I/O，也不切换公开路由。
- 外部存储完成后，供应商结果结算边界会锁定同一条成功生成记录及结果资产、再次校验已受理尝试不可变的远端任务 ID，并在同一短 RLS 事务内关联资产 URL 和完成已冻结点数的扣除流水。重复结算保留首次资产和账户余额。工作流归入仍是独立的显式用户操作；供应商 I/O 和公开路由尚未切换。
- PostgreSQL 还可在任一生成记录终态更新后汇总创作批次：先锁定批次再锁定其有序生成记录，校验请求数量契约，并在状态变化时推导既有的 `processing`、`succeeded`、`partial` 或 `failed`。该边界不执行供应商 I/O，也不切换任务、批次或公开路由执行链。
- 已受理尝试的失败终态现可与当前生成记录原子结算：再次校验不可变远端任务 ID 后，在同一租户 RLS 事务中记录供应商和生成失败元数据，并完成幂等释放流水以清除冻结点数。重复失败响应保留已释放余额；供应商 I/O 和公开路由仍不属于该边界。
- 已冻结生成记录也可在内部 PostgreSQL 边界原子释放：完成幂等释放流水、标记生成失败且不再占用冻结点数；已成功且仍冻结的生成记录现可通过幂等流水原子扣除余额和冻结余额中的同一价格快照。供应商结果处理仍须先确立成功状态再调用扣除。
- AI 对话列表、新建、详情、删除以及 Agent/动作确认的消息历史现使用 RLS PostgreSQL 事务内的 `AiChatSessionRepository`，保持原有企业/管理员隔离和字符串会话 ID；不导入历史 MongoDB 会话。
- 自由创作界面规格：Roomi 风格全屏页使用 `68px` 品牌栏、`1440px` 最小桌面画布、固定尺寸悬浮任务面板及 `1080px` 提示词/参数一体输入器。标题光弧与输入器边框使用本地静态资源，品牌替换为 Smart Floor AI，页面只调用本地数据接口。任务提交后切换为 Roomi 风格执行态：顶部展示任务摘要和参数标签，中部使用紧凑进度/结果缩略块及重新编辑、再次生成、删除操作，右侧显示历史记录窄轨，输入器固定在页面底部。完成结果悬浮后提供下载、引用为参考图、A/B 对比、图片标注编辑、归入客户方案和删除；大图预览支持缩放、旋转、全屏和下载；对比支持交换、仅看 A/B、带中央拖拽手柄的分割线、同步、左右/上下、重置、无边框沉浸式全屏画布（工具栏置于占满余下视口的图片区域上方）和导出。标注编辑器提供方形、圆形、箭头、画笔、标记、六色、撤销/重做、本地下载和“使用”；使用后的 PNG 仍经既有自由创作素材上传 API 保存为参考图，不新增路由、模型或权限边界。
- PostgreSQL 迁移边界：`GET/POST /api/ai/workflows`、bigint `GET/PATCH /api/ai/workflows/[id]` 及 `POST /api/ai/workflows/[id]/run-stage` 已在租户 RLS 事务中切换到工作流、线索和生成记录；保留既有列表/搜索/详情 DTO 及 `ai-scenarios` 企业权限边界。场景阶段执行、手动 `mock-generation` 结果持久化、正式户型控制图渲染、供应商输入媒体物化以及 `lighting` 的视觉分析/提示词编译均已迁移，聊天调用也写入 PostgreSQL 供应商尝试。历史 ObjectId 详情和变更仍通过只读 MongoDB 兼容分支，集合路由只列出 bigint 工作流。
- 状态：`Implemented`。客户方案工作台以“客户/素材/目标”向导发起方案，双栏工作区突出当前定稿、候选版本和唯一推荐下一步；共享动作目录统一名称、输入、计费键、支持端、结果边界和推荐动作。自由创作台支持本地模板搜索和三级分类、模板填入、参考图、提示词优化、本地模型映射、1–4 张输出、比例/质量/分辨率、点数预估、历史、复用、重试、删除、下载及归入现有客户方案；完成结果卡复刻经实际验证的 Roomi 交互面：悬浮操作、可标注引用、完整预览控制与 A/B 对比导出，不增加 Roomi 运行时依赖。模板结果可覆盖活动版本全量增量加载，移动端保留同一套三级分类选择。全屏页面采用已确认的 Roomi 风格深色创作布局：`68px` 品牌栏、紧凑创作轨道、中央画布、悬浮任务面板及底部提示词/参数一体输入器，品牌替换为 Smart Floor AI，并继续只调用本地数据接口。服务端会把模板参数与所选本地模型能力取交集，并保存最终参数快照。生成复用现有供应商执行/轮询及点数冻结、成功扣除、失败释放链路，计费动作是 `image.free_create`。自由创作上传和必须持久化的结果固定使用本地媒体 Provider，即使平台默认配置为七牛也不会上传七牛。第一版模板预览优先尝试导入时审计保存的 `sourceUrl`，失败回退已导入的本地预览；运行时不请求 Roomi API。旧 AI 执行权限键兼容解析为 `ai-scenarios`，角色配置只展示一个“AI 设计”，不会扩大 B2B 渠道 `salesperson` 的数据边界。后台与小程序共用企业 AI 点数和 `AiWorkflow`；`/api/ai/workflow-leads` 已从 PostgreSQL 读取线索、正式户型和活动方案摘要，工作流创建、阶段执行、生成持久化及其媒体写入仍待统一 bigint 切换。带客户/正式户型上下文的小程序参考复刻、整体换风格、户型概念图和软装深化分别映射到后台基准、彩平转透视和软装阶段。`MediaAsset` 持久化图片宽高，旧资产首次复用时从存储文件补写；所有媒体写入、读取、删除和可选签名跳转统一经过注册的 `MediaStorageProvider`。每条资产保存自身 Provider、可移植对象键、可选 Bucket 和 SHA-256，因此本地与七牛/后续对象存储资产可并存，后台和小程序资产 URL 不变。内置 `local` Provider 把路径限制在 `AI_ASSET_STORAGE_DIR` 内，生产 Docker 使用持久化卷挂载该目录；七牛 Kodo Provider 使用私有 Bucket 和短期签名下载，上传失败直接返回错误，不会静默回退本地。小程序按图片尺寸映射供应商支持的输出规格：参考复刻跟随参考图比例；选择正式户型范围时，服务端把所选完整户型或隔离后的单房间控制图作为第一张墙体/门窗结构输入，把参考图作为第二张镜头、画幅、构图和风格输入，不再要求额外空间照片；未选户型时仍兼容“参考图第一、空间图第二”。换风格/软装跟随空间图，完整户型保持方图，单房间默认横图。基准/软装阶段首个成功版本自动采用并推进，同阶段后续成功版本只成为候选，须手动采用才推进；同方案同阶段存在活动任务时拒绝重复冻结和上游提交。成功基准可继续提案/灯光。后台向导只展示包含闭合房间的已完成 v4 正式户型，创建和执行时还会再次拒绝草稿、旧版或失效户型 ID。正式户型驱动的选风格、基准和彩平转透视阶段会派生独立 1024px 控制图 `MediaAsset`；选风格固定使用 `image.edit.standard`，并把该控制图或用户上传来源图放入供应商 `images`，提示词同时加入只读的房间、墙体拓扑、尺寸、层高、门窗约束，且不修改 `FloorPlan.layoutData`。任务创建冻结、正式结果持久化后扣费、明确失败释放；平台 `super_admin`/`admin` 可管理供应商、轮换凭证、测试/同步模型、查询 GRS API Key 上游积分余额、执行对账、发放/调整点数、配置业务动作价格及企业允许功能/`standard` 逻辑档位，企业员工只消费。GRS 连通测试使用积分余额接口同时校验 Host 与 API Key；其节点不支持 `/v1/models` 时，模型同步保留并返回后台配置的模型映射。业务层使用逻辑模型键和 `AiExecutionService`；GRS 图片按当前文档向 `POST /v1/api/generate` 提交 `replyType: "async"`，标准 `gpt-image-2` 使用文档比例，VIP 在来源像素满足约束时沿用原尺寸，否则选择文档中的合法回退尺寸，并通过 `GET /v1/api/result?id=...` 轮询，`violation`/`failed` 均按已退款失败处理。小程序任务详情与历史读取会对可见生成中任务强制执行这次上游状态查询；即使已退款失败耗尽备用供应商，也会返回数据库中的最终失败状态，而不是用 500 遮蔽。临时结果必须先保存到 `MediaAsset`。仅连接失败、明确未受理或已确认退款时切备用；已有远端任务 ID 的已受理/未知状态任务继续冻结并轮询，不会创建第二个上游任务；提交响应没有远端任务 ID 时按不可追踪失败终止，不自动切备用供应商，释放冻结点数并允许运营核实后人工重试，避免永久停留在 `processing`。重试会按当前动作价格重新生成计费快照，并兼容没有历史 `priceSnapshot` 的旧任务。上游成本和余额与企业 AI 点数分账记录：企业购买平台点数，运营方按资金池预警批量补充供应商余额，不做逐笔充值联动。上游成本按原币种微单位单独记录，不改变业务点数价格。供应商页的能力与逻辑/远程模型字段用于路由；成本币种和预计成本只用于内部核算，可为 0 且不发送给供应商。`Limited`：其他适配器的余额/模型发现取决于供应商协议，首期不接微信/自助充值和低余额自动告警；生产本地媒体必须使用持久共享目录，七牛必须使用私有 Bucket、HTTPS 下载域名、服务端加密凭证并先通过完整读写删探针。
- 自由创作失败重试：输入未变时保留当前 batch 轮次并仅重试失败项，已成功图片不变；每个重开 generation 会清理旧供应商任务状态、递增尝试次数，并按快照模型和分辨率的当前启用价格开启新计费周期。提示词、参考图、模型、画幅、数量或模板发生变化时才新建一轮；当前轮仍在排队/生成时禁止重复提交。
- 当前迁移覆盖声明：上述“工作流创建待统一 bigint 切换”的历史说明已失效；公开 PostgreSQL bigint 工作流列表、创建、详情、状态变更、全部场景阶段执行、手动 `mock-generation` 结果持久化、正式户型控制图、供应商输入媒体物化及 `lighting` 视觉分析/提示词编译均已启用。
- GRSAI 现行模型目录：版本化目录按 2026-06-29 协议内置 `gpt-image-2`、`gpt-image-2-vip` 和 11 个 Nano Banana 模型。平台 `super_admin`/`admin` 在 `/ai-providers` 启停模型、指定唯一默认模型并设置 0–10 张参考图上限；供应商同步发现但没有参数能力定义的模型只读展示且不可执行。自由创作台只显示“模型已启用且至少一个分辨率价格已启用”的模型，提供模型/比例/分辨率联动，不再显示通用质量控件；VIP 使用官方像素预设矩阵或经过边长、16 倍数、长短边比与总像素校验的 `CUSTOM` 宽高。
- GRSAI 现行协议与路由：同步结果与完整内置目录合并，`/v1/models` 不可用时仍返回完整目录。请求固定 `replyType: "async"`，不发送文档未定义的 `quality`、`output_format`；Nano 使用 `aspectRatio + imageSize`。自由创作显式模型只在 GRS 配置之间故障转移，并始终保持同一远程模型，不会静默换模型。供应商内部成本可按远程模型和分辨率匹配并写入 `AiProviderAttempt`。
- 自由创作模型点数：`AiModelCreditPrice` 按 `image.free_create + modelProfileKey + resolutionTier` 唯一定价，VIP 自定义尺寸统一使用 `CUSTOM`。批次估算、冻结、成功扣除、失败释放和重试快照保存模型、远程模型及分辨率；客户工作流与小程序继续使用平台场景默认逻辑模型和原业务动作点数。
- 小程序目标上下文：`/api/miniprogram/ai/workflows` 校验 `floorPlanId + targetScope + roomId`，从精确任务而非方案全局阶段派生当前目标状态。缺少范围字段的旧任务继续保留在历史中，但不会自动匹配房间；户型更新会令更早成果过期。小程序防重以方案、阶段、正式户型、目标范围和房间为完整键，允许不同房间并行，并取代上一段对小程序“同方案同阶段”防重的概括；后台仍保留原全局阶段语义。`POST /api/miniprogram/ai/tasks` 接收与手动空间图互斥的 `sourceResultTaskId`，重新校验成功状态、方案、目标、访问权限及时效，把内部或外部成果统一固化为新的 `ai_generation_input`，写入 `parentGenerationId` 后才冻结点数。其他员工只能看到同目标忙碌状态，创建员工可打开进度；不新增房间级 `AiWorkflow`，也不改变后台全局已采用成果语义。PostgreSQL 路由现已在租户范围 Repository 查询中精确应用 `workflowId`，并从匹配的 PostgreSQL 生成记录恢复 `selectedTask`、`latestTask` 和 `targetContext`；传入精确正式户型目标时，早于本次同步修复的历史小程序成果会回退为该目标已验证来源的 `selectedTask`，不会因缺少全局采用标记而隐藏；小程序任务只有在成果图片已持久化后，才会与后台场景任务遵循同一阶段规则：基准/软装阶段首个成功成果自动采用并推进，`pending`、失败或无图任务均不会推进；JWT、企业、操作员与点数边界均不改变。
- GRS 结果图策略：关闭转存开关时，GRS 返回的 `http(s)` 图片 URL 直接作为结果引用持久化，不下载也不创建 `MediaAsset`；供应商尝试校验和积分结算仍在原事务中执行。小程序 DTO 不会暴露该供应商域名：受保护的 `MediaAsset` 图片使用带时效的租户签名 URL，未转存 GRS 结果则使用带时效的任务成果图签名路由，由后台校验租户/任务并转发经过验证的 JPG/PNG 字节；`MINIPROGRAM_API_PUBLIC_ORIGIN` 为示例值或无效值时回退到真实/转发请求 Host，不会输出 `api.example.com` 地址。因此既有成功小程序任务也可恢复读取，不改变后台浏览器的结果直链合同，更不会创建新的计费生成。仅当平台在媒体存储页启用转存且当前默认存储为可用七牛配置时，后续 GRS 结果图才下载并写入该默认七牛配置；不允许被本地 Provider 覆盖。持久化结果对前端仍统一返回 `/api/ai/assets/:id/image`，该私有资产接口会重定向至短期七牛签名下载 URL。Data URI、用户上传、量房控制图及非 GRS 供应商结果仍始终保存为 `MediaAsset`。
- 迁移/运维：现有数据库启用新路由前运行 `npm run migrate:ai-platform`；脚本保留既有 AI 点数原值、为缺失企业创建 0 点账户、不转换 Pollen，并迁移旧生成/预设和写入环境变量供应商配置。点数价格初始化会移除旧版唯一 `mode_1` 索引，避免无 `mode` 的平台动作价格因重复 `null` 导致能力接口失败；`actionKey_1` 仍是价格记录的唯一业务索引。脚本幂等写入完整 GRSAI 模型/分辨率目录，仅默认启用 `gpt-image-2/1K` 并继承既有 `image.free_create` 点数；历史 `roomi-*` 档案与旧任务快照继续可读，但不作为可执行选项。`npm run cleanup:media-assets` 默认只预览，只有增加 `--execute` 才会在宽限期后物理清理软删除媒体；`npm run migrate:media-assets -- --from=<provider-key> --to=<provider-key>` 默认预览，参数使用稳定配置标识，增加 `--execute` 后按大小和 SHA-256 校验目标对象，先提交新定位再删除源对象。定时调用 `/api/ai/reconcile` 时配置 `AI_RECONCILIATION_SECRET`。

- 历史自由创作批次仍可能读取旧快照中的 `quality` 字段；新建 GRSAI 请求只展示模型、比例和分辨率，且不会发送 `quality` 或 `output_format`。
- 自由创作响应式行为：实现使用共享 `lg` 断点承载 `1024px` 桌面编排，确保规则顺序晚于 `sm` 移动规则。视口小于 `1024px` 时取消固定桌面最小宽度、隐藏左侧工具轨，并让模型、数量、比例、分辨率、模板和提交控件自动换行，确保所有命令可触达；`1024px` 及以上的已生成任务会将摘要和结果条保持在居中的画布中，并将提示词/参数面板锚定在底部，从而在常见浏览器缩放下仍保持 Roomi 风格执行态，不会退化为过高的流式表单。已完成的自由创作任务 DTO 直接返回已持久化的结果 URL：转存或本地结果为 `/api/ai/assets/:id/image`，未转存的 GRS 结果为上游 HTTPS URL；不再经过生成图跳转，因此浏览器内容过滤器不会阻止结果图渲染。一个自由创作任务现在会把所有已持久化批次按轮次渲染为任务内对话，保留每轮提示词/参考图上下文，并在打开任务或提交新一轮后自动滚动到最新轮次；选中已有任务时继续追加 batch，“新建任务”仍是显式的新任务边界。权限、模型、点数计费和供应商行为不变。

### 11. 平台媒体存储管理

- 页面/权限：`/media-storage`，菜单权限 key 为 `media-storage`，仅平台 `super_admin`、`admin` 可访问和操作。
- 后台 UI：管理页采用共享 Ant Design ProComponents 应用模式：使用 `PageContainer` 提供页面上下文，使用配置面板承载默认存储和 GRS 结果图策略，使用 `ProTable` 展示存储状态和操作，使用 `ModalForm` 编辑七牛配置。本次仅迁移展示层，路由、API、角色边界和存储行为均未改变。
- API：`GET/POST/PATCH /api/admin/media-storage`、`PATCH/DELETE /api/admin/media-storage/[id]`、`POST /api/admin/media-storage/[id]/test`、`POST /api/admin/media-storage/[id]/activate`。
- 模型/工具：`MediaStorageConfig`、`PlatformConfig.mediaStorage`、PostgreSQL `MediaStorageConfigRepository` 与 `MediaAssetRepository`、`MediaAsset`、`src/lib/media-storage/*`。
- 状态：`Implemented`。页面展示当前默认存储、凭证/配置状态、有效/待清理/累计资产数量与容量和最后测试结果；可管理内置本地存储及多套七牛 Kodo 配置，API 只返回密钥掩码，凭证仅在服务端加密保存。每套七牛配置可选填存储前缀，用于同一 Bucket 内隔离项目；前缀只接受以斜杠分段的字母、数字、`.`、`_`、`-`，拒绝路径穿越并规范为单个结尾斜杠。前缀只作用于后续新上传和健康探针，完整对象 key 会固化在 `MediaAsset.storageKey`，所以修改前缀不会影响历史资产读取。Bucket、区域、域名、前缀或凭证变更会清除原测试通过状态；完整探针依次验证上传、对象查询、私有签名下载、内容一致性和删除，只有测试通过且未归档的七牛配置可设为默认。配置稳定 key 创建后不可修改，并写入 `MediaAsset.storageProvider`。归档配置禁止新写入、测试和重新激活，但仍解析用于历史资产读取/删除；当前默认配置不能归档。GRS 结果图策略默认保留上游 HTTP 图片 URL：PostgreSQL 自由创作、客户方案和小程序结果直接持久化该 URL，不下载也不创建 `MediaAsset`，其供应商尝试校验和积分结算不变。只有当前默认存储是可用七牛配置时，管理员才能启用转存开关；开启后仅后续 GRS 结果写入七牛，并且在关闭开关前不能切回本地默认存储。非 GRS 或非 HTTP 的供应商结果继续经过既有媒体资产交付链路。切换默认值和转存开关都不会迁移旧资产；未初始化平台配置时继续兼容 `local`。
- PostgreSQL 持久化边界：媒体配置 CRUD、加密凭证读取、连通测试结果、归档、默认 Provider、GRS 转存指针以及资产数量/容量统计均已切换到 PostgreSQL。统计通过平台范围 `MediaAssetRepository` 聚合 `media_assets` 的有效、待清理和累计状态；七牛网络探针在数据库事务外执行，结果使用 `updatedAt` 乐观条件回写，避免覆盖探针期间发生的配置修改。旧 MongoDB 管理员 ID 不能写入 PostgreSQL bigint 审计外键，因此身份域迁移前审计字段暂为 `NULL`。
- Phase 4 保留数据迁移已导入活动 `zly-images` 七牛配置和 Provider 指针，未写入旧管理员审计 ID；完整上传、对象查询、私有签名下载、内容一致性与删除探针已通过。生产切换前仍必须在部署环境提供独立的 `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`。
- 限制/运维：生产云凭证必须配置专用 `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`；七牛 Bucket 固定按私有空间处理，下载域名必须为 HTTPS 并加入微信小程序合法域名。页面首期不发起迁移或物理清理任务，仍使用默认 dry-run 的 CLI；迁移参数使用稳定配置标识，例如 `--to=qiniu-primary`。

### 12. 小程序支撑与跨端 API

- API：`/api/auth/miniprogram`、`/api/miniprogram/home`、`/mine`、小程序 AI 能力/来源/方案/媒体/任务/历史接口，以及共享线索、户型、测量、提成、订单、报备接口。
- 状态：`Implemented`。负责小程序身份、员工上下文、首页/我的工作台、定位、品牌、共享业务资产和企业员工 AI 设计；AI API 强制 Bearer JWT、企业和操作员归属校验。媒体上传按文件实际字节识别 JPG/PNG 及宽高，不依赖微信 multipart 请求声明 MIME；`/api/miniprogram/ai/sources` 保留旧版扁平房间数组并新增按正式户型分组的数据，只暴露当前角色可访问的正式户型和闭合房间。任务创建复用相同角色边界并保存显式 `whole_floor_plan`/`single_room` 范围；完整户型生成派生独立 1024px 控制图 `MediaAsset` 并调用图片编辑，单房间户型生成使用量房摘要调用图片生成。关联正式户型的参考复刻也会派生控制图，存在 `roomId` 时只绘制该闭合房间及其门窗，并把控制图置于参考图之前提交，均不修改正式墙图。显式方案直接续接；同客户/户型只有一个活动方案时自动复用，存在多个方案时必须由客户端选择，不会静默合并，并可明确新建备选方案。
- 方案目标响应：正式目标的方案接口同时返回 `sourceFloorPlanId` 和按户型、范围、房间精确匹配的 `targetContext`；`workflowId` 是精确查询条件，旧任务不会自动填图，其他员工的活动任务仅返回忙碌状态。任务续接与目标级防重继续复用上述角色边界。
- PostgreSQL 工作台边界：`/api/miniprogram/home` 和 `/mine` 已通过 typed RLS Repository 派生实时线索、正式户型、测量、设备、报备和待办数据，`/api/users` 也返回 PostgreSQL 户型计数。AI 生成域迁移前，首页 `aiGeneratedCases` 返回 `0`；订单和提成仍由 MongoDB 支撑，不会把 PostgreSQL bigint ID 传入旧 MongoDB 查询。

### 13. 通知、自动化与诊断

- API：提醒执行、通知列表/轮询、`/api/health`、`/api/debug`、`/api/debug/tenant-context`、`/api/internal/seed`。
- 状态：提醒、浏览器轮询、通知日志、健康/调试、种子和 Docker/发布工具为 `Implemented`；内部密钥保护的 seed route 已改为幂等创建 PostgreSQL 初始平台管理员，必须显式配置至少 32 字符的 `INTERNAL_SECRET` 和至少 12 字符的 `INITIAL_ADMIN_PASSWORD`，不再保留源码默认凭据。接口仍需遵守对应角色和运行环境限制。
- 运维恢复：PostgreSQL migration 已完成后，`npm run migrate:legacy-admin-users` 是导入旧 MongoDB 平台管理员身份的幂等运维命令。它绝不覆盖已有 PostgreSQL 账号，并会报告已存在、无效或租户级而被跳过的记录。
- PostgreSQL 迁移基础层：PostgreSQL 17 Docker 服务、隔离的 `sfp_migrator`/`sfp_app`/`sfp_auditor` 角色、受限 `pg.Pool`、可审阅 Drizzle migration、备份/恢复演练、45 张 typed 目标表、外键与索引、租户数据强制 RLS、事务内租户/平台上下文，以及企业、部门、管理员、小程序用户、线索、正式户型、测量、设备、平台配置、提示词库、系统角色、媒体存储配置、报备记录、工作流通知、提醒自动化、订单、提成、企业激活、AI 风格预设和 AI 价格 typed Repository 均为 `Implemented`；恢复演练会核对表、RLS 表和策略数量。`/api/health` 继续以 MongoDB 为必需依赖并单独报告 PostgreSQL；只有 `POSTGRES_HEALTHCHECK_REQUIRED=true` 时 PostgreSQL 才参与健康门禁。Docker migration 通过 `npm run docker:migrate` 显式执行，长期运行的 admin 服务不注入 `DATABASE_MIGRATION_URL`。Docker 构建上下文排除运行时 `.env*`、本地 RoomiAI/导入资源、上传目录和本地数据库备份，这些资产必须在运行时注入或挂载。只重新构建 admin 镜像且不复用 Docker 构建缓存时，可在 `admin/` 目录执行 `npm run docker:build-admin`。`npm run docker:restart` 会依次构建 admin 镜像、运行一次性迁移服务，并强制重建 admin 服务；不会重启 PostgreSQL。`Limited`：AI 工作流、生成和媒体资产持久化仍使用 MongoDB，Phase 3 继续按域迁移。

## Phase 3 迁移状态更新（2026-08-02）

- 订单、提成、结算、作废及工作台待结算提成汇总已切换至 PostgreSQL `CommercialRepository`，使用现有 RLS 目标表及 bigint 关系；付费订单在同一短事务中更新报备并 upsert 提成，取消订单会作废对应提成。
- `/api/admin/enterprises/activate` 已在单个 PostgreSQL 平台事务中完成报备/订单校验、企业及企业管理员创建、订单绑定和报备状态推进；不会读取或写入 MongoDB。旧 `EnterpriseOrder` 和 `CommissionRecord` Mongoose 模型不再是这些运行时 API 的数据源；AI/媒体域仍为 `Limited`，继续使用 MongoDB，等待后续 Phase 3 切片。

## 测量员—设计师获客协作（已实现）

专项业务与数据契约见 [`docs/measurer-designer-acquisition.zh-CN.md`](measurer-designer-acquisition.zh-CN.md)，英文镜像为 `docs/measurer-designer-acquisition.md`。

- `/staff` 中设计师必须填写 `wechatId` 并上传媒体资源二维码；测量员必须绑定同企业启用中的设计师。关系写入 `measurer_designer_bindings`，一个设计师可绑定多个测量员。仍有绑定时禁止停用或删除设计师；该页面不再承载获客提成配置。
- `POST /api/leads` 服务端按绑定关系写入测量员负责人、设计师负责人及 `new` 状态；手机号重复时复用原线索，不重复通知或提成。
- `GET /api/acquisition-tasks` 仅向小程序设计师/测量员开放，按租户、角色、负责人和时间范围返回分页待确认/已完成任务、汇总、脱敏客户信息及提成字段；测量员当前绑定设计师联系方式只作为页面级 `designerProfile` 返回一次，任务条目不重复返回微信号或二维码。它不扩大小程序对后台线索列表的读取范围。
- `POST /api/leads/[id]/acquire` 仅负责该线索的设计师可调用，使用 `assigned_to`、`acquired_at IS NULL` 和允许状态条件做原子确认，只写 `acquiredAt/acquiredBy` 并生成金额快照为 `pending_settlement` 的获客提成；重复确认返回冲突且不会重复提成，也不会修改客户业务状态。直接通过线索新增/更新接口写入 `acquired` 会被拒绝。
- `0017_acquisition_workbench.sql` 将历史 `leads.status='acquired'` 归并为 `new`，迁移时输出缺失 `acquired_at` 或提成关联的修复告警，并为负责人/推广人获客查询建立索引；运行时仍兼容未迁移的历史值。
- `/acquisition-commissions` 及结算 API 使用租户隔离；企业负责人和平台管理员可标记已发放，测量员只能查看自己的记录。其 `/acquisition-commissions/settings` 规则页调用 `GET/PATCH /api/acquisition-commissions/settings`，仅本企业企业负责人可为之后确认的线索设置固定金额；既有记录继续保留确认时的金额快照。
- `staff_notifications` 记录站内通知，小程序提供未读查询与已读接口；获客待确认/已确认通知的 `metadata.page` 深链到协作中心对应 `leadId`。写入冲突目标与其 `(dedupe_key, channel)` 部分唯一索引条件一致，可正确忽略重复写入；微信发送失败不会回滚线索。

## 核心模型

- 身份：`AdminUser`、`SystemRole`、`User`、`Department`。
- 租户/商业：`Enterprise`、`Package`、`EnterpriseOrder`、`CommissionRecord`、`PromotionEnterpriseRecord`。
- 客户资产：`Lead`、`FloorPlan`、`Measurement`、`Device`、PostgreSQL `inspirations`。
- AI/媒体：`AiGeneration`、`AiWorkflow`、`AiChatSession`、`AiStylePreset`、`AiProviderConfig`、`AiProviderAttempt`、`MediaStorageConfig`、`MediaAsset`、`AiCreditAccount`、`AiCreditLedger`、`AiCreditPrice`、`AiModelCreditPrice`；`EnterpriseAiUsageSnapshot` 仅保留为 Pollinations 历史数据。
- 通知/配置：`WorkflowNotificationLog`、`PlatformConfig`。

## 维护清单

修改后台页面、API、模型、工作流或共享组件前，先阅读根目录/后台目录指令和本中英文清单。完成后必须在同一份 diff 中更新页面/API、数据行为、权限边界、状态和限制，并检查 Sidebar 菜单 key、`proxy.ts`、角色默认权限、租户解析、模型索引和操作反馈。没有真实路由、处理器和持久化/供应商链路的 roadmap 项目不得标记为已实现；如果确实没有功能文档影响，必须在交接说明中明确写出。
