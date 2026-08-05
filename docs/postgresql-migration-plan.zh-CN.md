# PostgreSQL 迁移计划与进度

### PostgreSQL-only 切换决定（2026-08-05）

本次切换不再保留 MongoDB ObjectId 兼容 API，也不导入历史业务文档，运行时不再依赖 MongoDB。仅保留 Phase 4 白名单数据：七牛云 `zly-images` 存储配置，以及 AI 工作台当前 Roomi 提示词库版本（分类、提示词模板、参数模板、来源模型和预览资源）。运行时代码、Docker Compose、环境示例、依赖清单和维护脚本均为 PostgreSQL-only。现有 MongoDB 数据和正在运行的 MongoDB 容器未做破坏性删除，待用户验收后再手工归档或删除；部署应用不再使用它们。

> 2026-08-05 迁移记录：`GET /api/kujiale/cities` 和 `GET
> /api/kujiale/floorplans/search` 在发起已认证的上游请求前不再连接 MongoDB；既有后台/小程序认证、查询及响应 DTO 和外部供应商限制保持不变。十进制 PostgreSQL bigint 请求 `GET
> /api/ai/assets/[id]/image`、`/api/ai/generations/[id]/image`、
> `/api/miniprogram/ai/assets/[id]/image`、`/api/ai/status/[id]` 以及 `POST
> /api/admin/ai-generations/[id]/retry` 现仅在需要显式历史 ObjectId 兼容分支时才加载 MongoDB/Mongoose。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（49/49）。

> 2026-08-05 迁移记录：租户 `GET/POST/DELETE /api/inspirations` 现通过
> `InspirationRepository` 在租户 RLS PostgreSQL bigint `inspirations` 表中运行。
> 既有筛选、响应中的 `_id` 字符串和数字 `viewCount` 字段、当前菜单访问权限及案例发布、推荐和删除流程均保持不变。路由现要求已认证的企业上下文后才能读取或变更案例。未导入、删除或重新加密 MongoDB 业务数据。
> 定向 ESLint 与 `npm run test:postgresql` 均通过（49/49）。

> 2026-08-05 迁移记录：`GET /api/admin/enterprises/[id]/ai-credits` 现从
> PostgreSQL bigint `ai_generations` 读取企业最近任务列表，并关联操作员和当前供应商模型。
> 既有 `super_admin`/`admin` 边界及账户、流水、策略和任务 DTO 字段保持不变；历史 MongoDB
> ObjectId 任务有意不与该列表混合。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint
> 与 `npm run test:postgresql` 均通过（48/48）。

> 2026-08-05 迁移记录：`GET /api/admin/media-storage` 现通过平台范围 PostgreSQL
> `media_assets` 和 `MediaAssetRepository` 读取有效、待清理及累计媒体资产数量/容量，路由
> 不再连接 MongoDB。媒体存储配置、Provider 激活、权限、DTO 字段和供应商 I/O 行为保持不变。
> 未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（47/47）。

> 2026-08-05 迁移记录：平台 `GET/PATCH /api/admin/ai-image-models` 现通过
> PostgreSQL 平台事务中的 `AiCreationModelProfileRepository` 初始化、读取、校验和更新
> GRS 模型目录。配套的 `GET/PATCH /api/admin/ai-image-model-prices` 使用 PostgreSQL
> 目录能力进行校验，并读写 PostgreSQL 价格记录。既有 `super_admin`/`admin` 权限、DTO、
> 唯一启用默认模型规则和供应商发现模型只读展示保持不变。未导入、删除或重新加密 MongoDB
> 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（46/46）。

> 2026-08-04 迁移记录：`POST /api/admin/ai-generations/[id]/retry` 已识别
> bigint 的失败小程序 AI 生成任务。平台 `super_admin` 或 `admin` 必须具有企业上下文；
> 在租户 RLS 范围内，管理员可重试员工创建的任务而不必等于原操作人。该路径会清空失败的
> 供应商状态、推进计费周期，并通过既有 PostgreSQL 生命周期重新提交。历史 ObjectId 重试仍
> 保持 MongoDB 兼容。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与
> `npm run test:postgresql` 均通过（44/44）。

> 2026-08-04 迁移记录：bigint `PATCH /api/ai/workflows/[id]` 已支持既有
> `mock-generation` 手动结果动作。PostgreSQL 资产 URL、图片 data URI 或 HTTP(S)
> 图片会解析或持久化为租户归属的 `ai_generation_output` 资产，随后在同一短租户 RLS
> 事务中创建零点数、已成功的 bigint `scenario` 生成记录，并按请求更新阶段指针。
> 此路径有意跳过供应商执行和点数计费；历史 ObjectId 请求仍走 MongoDB 兼容分支。
> 未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql`
> 均通过（43/43）。

> 2026-08-04 迁移记录：两步式后台 `POST /api/ai/generate` 与 `POST /api/ai/render`
> 现使用租户 RLS bigint `floor_plan_style`、`furnishing_render` 及旧版
> `soft_furnishing_render` 记录，并保留既有提示词优先 DTO。渲染输入会保存为 PostgreSQL
> 媒体资产，供应商提交、轮询、结果媒体、幂等积分结算和重试计费均复用 PostgreSQL 运行时。
> 供应商及存储 I/O 保持在事务外。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint
> 与 `npm run test:postgresql` 均通过（42/42）。

> 2026-08-04 迁移记录：`POST /api/ai/soft-furnishing/render` 现会持久化租户所属的
> PostgreSQL 输入媒体资产和 bigint `soft_furnishing_render` 生成记录。它复用
> PostgreSQL 供应商尝试、轮询、结果媒体和幂等积分生命周期，并保留既有 DTO 与
> `ai-scenarios` 企业权限边界。供应商和存储 I/O 保持在事务外。未导入、删除或重新加密
> MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（41/41）。

> 2026-08-04 迁移记录：`POST /api/ai/advice` 与
> `POST /api/ai/creation/prompt-assist` 现会创建租户 RLS 范围的 PostgreSQL bigint
> `advice` 生成记录。既有响应 DTO 与 `ai-scenarios` 企业权限边界保持不变。聊天 I/O
> 位于短数据库事务外，PostgreSQL 供应商尝试记录和幂等的积分冻结、扣除、释放记录完整审计
> 其生命周期。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与
> `npm run test:postgresql` 均通过（40/40）。

> 2026-08-04 迁移记录：后台 AI 设计助手现通过租户 RLS PostgreSQL Repository 读取线索、
> 正式户型和员工，并使用 bigint 工作流上下文完成方案列表、详情、创建、下一步推荐、经确认的
> 阶段提交和定稿选择。工具 DTO 与显式确认行为保持不变，且会从面向助手的文本中脱敏 bigint
> 标识符。未导入、删除
> 或重新加密 MongoDB 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（39/39）。

> 2026-08-04 迁移记录：bigint `POST /api/ai/workflows/[id]/run-stage` 现通过既有
> 供应商尝试生命周期准备并提交 PostgreSQL `scenario` 生成记录。它保持确认响应；对选风格、
> 基准方案和彩平转透视阶段使用正式 v4 户型控制图，并将该图保存为租户范围 PostgreSQL 媒体资产；
> 输入或供应商执行失败会释放冻结点数。场景结果成功结算后会推进工作流，并按既有规则自动采用首个
> 基准或软装结果。`lighting` 的视觉分析与提示词编译调用现会先写入 PostgreSQL 供应商尝试审计，
> 再复用该生命周期。历史 ObjectId 路由仍保留 MongoDB 兼容。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint
> 与 `npm run test:postgresql` 均通过（39/39）。

> 2026-08-04 迁移记录：`GET/POST /api/ai/workflows` 及 bigint
> `GET/PATCH /api/ai/workflows/[id]` 现通过租户 RLS 事务使用 PostgreSQL 工作流、线索和
> 生成记录。列表保持原有分页、活跃/归档、线索和搜索 DTO 语义；创建、重命名、阶段指针和定稿选择
> 保持既有 `ai-scenarios` 企业权限边界。历史 ObjectId 工作流详情和变更请求仍保留 MongoDB
> 兼容分支，但集合路由仅返回 bigint 记录。上方手动结果迁移记录已取代早期 PostgreSQL
> `mock-generation` 限制；常规场景阶段
> 执行、正式户型控制图及供应商输入物化已切换。未导入、删除或重新加密 MongoDB 业务数据。定向 ESLint 与
> `npm run test:postgresql` 均通过（39/39）。

> 2026-08-04 迁移记录：GET /api/ai/workflows/[id]/source-image 现识别 bigint
> 工作流 ID，并在租户 RLS 范围内从 PostgreSQL 读取后交付已持久化的 data URI 来源图。该路由保留
> 原有企业认证边界，MongoDB 连接仅在旧 ObjectId/媒体资产兼容分支建立，因此历史工作流资产仍可读取。
> 本项为 Limited：仅交付 PostgreSQL data URI 来源图；公开工作流创建、阶段执行、外部/供应商媒体存储
> 及 MongoDB 数据迁移均未改变。定向 ESLint 与 npm run test:postgresql 均通过（39/39）。

> 2026-08-04 迁移记录：已准备的 bigint 工作流 `scenario` 生成记录现可在租户 RLS
> 范围使用 PostgreSQL 供应商尝试完整生命周期。尝试会快照工作流/阶段/预设上下文；已受理
> 的场景任务可通过既有短 `FOR UPDATE SKIP LOCKED` 轮询租约认领，随后幂等地记录轮询、
> 带媒体结算和点数扣除的成功终态，或失败/释放终态。本项仍仅供内部使用：供应商和存储 I/O
> 保持在事务外，未切换公开工作流阶段路由或权限边界，未导入、删除或重新加密 MongoDB
> 业务数据。定向 ESLint 与 `npm run test:postgresql` 均通过（39/39）。

> 2026-08-03 迁移记录：`postgres-workflow-service` 现提供 bigint 工作流创建与
> 读取上下文的租户 RLS 基础层。它会在持久化前校验租户范围线索、线索与户型的关联、以及
> 已完成 v4 正式量房资格，再从 PostgreSQL 记录派生既有工作流/线索/生成记录/阶段状态
> DTO 形状。`/api/ai/workflows`、来源图媒体持久化/交付、供应商阶段执行及其权限仍保持
> 当前 MongoDB 运行时，待完整 bigint 执行切片可同时切换后再迁移。未导入或删除 MongoDB
> 业务数据，未重新加密密钥。

> 2026-08-03 迁移记录：PostgreSQL 工作流状态现新增租户 RLS 范围的变更基础层，支持
> 重命名、设置阶段指针，以及将已成功的 bigint 生成记录设为定稿。定稿选择会锁定活跃
> 工作流与对应生成记录，清除先前选择，并且仅依据该生成记录已保存的下一阶段值推进工作流。
> 公开工作流变更和供应商阶段执行路由仍保持当前 MongoDB 运行时，待完整 bigint 执行切片可
> 一起切换后再迁移。未导入或删除 MongoDB 业务数据，未重新加密密钥。定向 ESLint 与
> `npm run test:postgresql` 均通过（38/38）。

> 2026-08-04 迁移记录：PostgreSQL 冻结/释放边界现也接受已准备的 bigint `scenario`
> 生成记录。它会通过与自由创作相同的幂等租户 RLS 流水，冻结并释放阶段快照中的精确
> `image.scenario` 价格；刻意跳过提交后不会遗留冻结余额。供应商尝试创建、媒体物化、终态
> 结算、轮询和公开路由均保持不变。未导入或删除 MongoDB 业务数据，未重新加密密钥。定向
> ESLint 与 `npm run test:postgresql` 均通过（38/38）。

> 2026-08-04 迁移记录：PostgreSQL 工作流阶段准备现会在持久化一条 bigint `scenario`
> 生成记录前，校验租户 RLS 工作流、线索、正式户型资格、阶段依赖、企业策略及活跃生成冲突。
> 记录会保存不可变的风格/提示词和 `image.scenario` 价格快照，但尚不提交供应商任务、物化媒体、
> 冻结点数或切换公开路由。未导入或删除 MongoDB 业务数据，未重新加密密钥。定向 ESLint 与
> `npm run test:postgresql` 均通过（38/38）。

> 2026-08-03 迁移记录：关联的自由创作 bigint 运行时切片现已切换。资产上传、任务
> 列表/新建/归档、批次准备/提交、生成图片交付和显式工作流归入均使用 typed
> PostgreSQL Repository 与租户 RLS，同时保留既有 API、DTO 和 `ai-scenarios`
> 权限边界。供应商与对象存储 I/O 保持在事务外；运行时会在既有 PostgreSQL 边界中
> 持久化供应商尝试、结果资产和幂等点数结算。任务历史读取可认领租户轮询，既有受保护
> 的对账端点现可在平台范围认领到期 PostgreSQL 任务。未导入、删除 MongoDB 业务数据，
> 也未重新加密密钥。定向
> ESLint 与 `npm run test:postgresql` 均通过（38/38）。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增供后台 worker 使用的内部供应商轮询任务认领边界。
> 短平台事务通过 `FOR UPDATE SKIP LOCKED` 选择到期且已受理的 bigint 生成记录，写入不透明轮询租约和下次
> 轮询时间，再仅返回提交后事务外 I/O 所需的供应商路由元数据。带租约的轮询、成功和失败写入会拒绝已过期或被
> 新任务替代的租约，并在持久化状态时移除租约。迁移 `0011_ai-generation-provider-poll-queue` 新增匹配的部分
> 到期轮询索引。本项仅供平台内部使用：公开路由和用户权限边界均未切换；供应商网络 I/O 仍在事务外，且仍属于
> 关联的 MongoDB 运行时执行链。未导入或删除 MongoDB 业务数据，未重新加密密钥；`npm run db:migrate`、
> `npm run db:check`、定向 ESLint 和 `npm run test:postgresql`（37/37）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部批次状态汇总边界。它会先锁定租户范围
> bigint 批次，再锁定其有序生成记录，校验预期生成数量，并依据当前状态推导既有的 `processing`、
> `succeeded`、`partial` 或 `failed` 批次状态；重复刷新不会产生冗余写入。公开路由尚未切换：供应商
> I/O、工作流归入及任务/批次运行时仍属于关联的 MongoDB 执行链。未导入或删除 MongoDB 业务数据，未
> 重新加密密钥；定向 ESLint 和 `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部供应商结果结算边界。外部存储完成结果资产
> 落库后，它会锁定已受理的 bigint 生成记录及其资产、校验不可变远端任务 ID，并在同一短 RLS 事务内关联
> 资产 URL 和完成精确、幂等的点数扣除流水。重复结算保留首次资产和已扣除余额。公开路由尚未切换：供应商
> 网络/存储 I/O 与工作流归入仍属于关联的 MongoDB 执行链。未导入或删除 MongoDB 业务数据，未重新加密
> 密钥；定向 ESLint 和 `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部供应商失败结算边界。它会锁定当前已受理
> bigint 尝试和生成记录、校验不可变远端任务 ID，并在同一事务内记录供应商失败、生成失败元数据及幂等
> 点数释放流水。重复失败响应保留已释放余额。公开路由尚未切换：供应商网络 I/O、结果存储、成功扣除调用
> 和工作流归入仍属于关联的 MongoDB 执行链。未导入或删除 MongoDB 业务数据，未重新加密密钥；定向
> ESLint 和 `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部结果媒体关联边界。它会锁定终态 bigint
> 生成记录及其租户范围媒体资产，校验已受理尝试不可变的远端任务 ID 和结果归属后，原子关联 PostgreSQL
> 资产 URL。重复关联保留首次图片，任何资产均不能被另一生成任务认领。公开路由尚未切换：供应商下载/存储
> I/O、点数扣除调用和工作流归入仍属于关联的 MongoDB 执行链。未导入或删除 MongoDB 业务数据，未重新
> 加密密钥；定向 ESLint 和 `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现可在内部记录已受理供应商尝试的成功终态。它会锁定
> 当前 bigint 生成记录、校验不可变的远端任务 ID、保存供应商结果和实际成本快照，并将尝试和生成记录
> 同步推进为 `succeeded`；重复成功响应保留首次结果。仍处于冻结状态的成功生成记录随后可进入既有的幂等
> 点数扣除边界。公开路由尚未切换：供应商网络调用、结果媒体写入、扣除调用和工作流归入仍属于关联的
> MongoDB 执行链。未导入或删除 MongoDB 业务数据，未重新加密密钥；定向 ESLint 和
> `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现可在内部记录供应商的非终态轮询状态。它会在
> 持久化 `processing` 或 `unknown` 状态、上游诊断和受限的下次轮询元数据前锁定已受理尝试的当前
> bigint 生成记录；后续 `processing` 响应会清除临时未知状态错误。响应必须保持该尝试已记录的
> 远端任务 ID。公开路由尚未切换：供应商网络调用、终态结果处理、结果媒体写入和工作流归入仍
> 属于关联的 MongoDB 执行链。未导入或删除 MongoDB 业务数据，未重新加密密钥；定向 ESLint 和
> `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部幂等供应商提交回执边界：它会锁定
> 当前 bigint 生成记录，并持久化已受理尝试的远端任务 ID、供应商状态和下一次轮询元数据。重复
> 回执保留首次记录的任务不变；任务不一致、已过期或不可追踪的响应会被拒绝。公开路由尚未切换：
> 供应商网络调用/轮询、结果媒体写入和工作流归入仍属于关联的 MongoDB 执行链。未导入或删除
> MongoDB 业务数据，未重新加密密钥；定向 ESLint 和 `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部幂等点数扣除边界：仅接受已成功且
> 仍冻结的 bigint 生成记录，在一个事务中从余额和冻结余额扣除精确价格快照并完成 consume
> 流水；重复调用保持已完成账户状态不变。公开路由尚未切换：供应商提交/轮询、结果媒体写入和
> 工作流归入仍属于关联的 MongoDB 执行链。未导入或删除 MongoDB 业务数据，未重新加密密钥；
> 定向 ESLint 和 `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部幂等点数释放边界：它会在一个
> 租户 RLS 事务中释放已冻结 bigint 生成记录的精确价格快照、记录释放流水，并以给定错误标记
> 生成失败；重复释放复用已完成结果，不再改变冻结余额。公开路由尚未切换：供应商提交/轮询、
> 结果媒体写入、成功后的点数扣除和工作流归入仍属于关联的 MongoDB 执行链。未导入或删除
> MongoDB 业务数据，未重新加密密钥；定向 ESLint 和 `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部供应商尝试认领边界：在 bigint
> 生成记录完成点数冻结后，它会记录选定的供应商配置、固定远端模型、请求指纹和提交请求，再将
> 生成记录推进为 `processing`；重试复用活动尝试，不创建重复上游任务。该步骤不执行供应商网络
> 调用。公开路由尚未切换：提交/轮询、结果媒体写入、点数扣除/释放和工作流归入仍属于关联的
> MongoDB 执行链。未导入或删除 MongoDB 业务数据，未重新加密密钥；定向 ESLint 和
> `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作执行链现新增内部租户 RLS 点数冻结边界：
> 它会原子认领 bigint 生成记录的冻结流水、校验可用点数、冻结精确的价格快照，并将生成记录
> 推进至可提交状态；重复调用会复用已完成流水，不会重复冻结点数。公开路由尚未切换：供应商
> 尝试、提交/轮询、结果媒体写入、点数扣除/释放以及工作流归入仍属于关联的 MongoDB 执行链。
> 未导入或删除 MongoDB 业务数据，未重新加密密钥；定向 ESLint 和
> `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：PostgreSQL 自由创作批次准备层现会在相应的平台或租户 RLS
> 事务中校验 bigint 任务、媒体资产、模型档案、提示词参数、企业策略及精确的模型/分辨率
> 点数价格，并持久化待执行批次和按顺序待执行的生成记录，保存模型、参数和价格快照。尚未
> 切换公开路由：供应商提交/轮询、结果媒体写入、点数扣除/释放和工作流归入仍属于关联的
> MongoDB 执行链。未导入或删除 MongoDB 业务数据，未重新加密密钥；定向 ESLint 和
> `npm run test:postgresql`（36/36）通过。

> 2026-08-03 迁移记录：`GET /api/ai/creation/bootstrap` 现通过 PostgreSQL 模型档案和价格 Repository 初始化并读取 GRS 模型目录，并在一个租户 RLS 事务中读取活动工作流及其线索；既有 DTO、点数、供应商和 `ai-scenarios` 边界保持不变。旧 MongoDB 目录维护仅保留给尚未迁移的任务/批次/生成执行链。未导入或删除 MongoDB 业务数据，未重新加密密钥；定向 ESLint 和 `npm run test:postgresql`（35/35）通过。

> 2026-08-03 迁移记录：`GET /api/ai/workflow-leads` 已通过 PostgreSQL RLS 事务读取当前企业的线索/户型关系和活动工作流摘要，保留原有搜索、正式户型可用性筛选、DTO 与 `ai-scenarios` 企业边界。工作流创建、阶段执行、生成持久化和媒体写入仍属于关联的 bigint 运行时切片。未导入或删除 MongoDB 业务数据，未重新加密密钥；定向 ESLint 和 `npm run test:postgresql`（34/34）通过。

> 2026-08-03 迁移记录：租户范围 PostgreSQL 媒体资产现可通过既有后台和小程序素材图片路由交付。资产元数据查询运行在 RLS 事务内；本地对象继续直接输出字节，私有对象存储继续使用签名跳转。旧 MongoDB ObjectId URL 保留为只读兼容路径。本次仅切换部分运行时边界，自由创作上传、任务、批次、生成、供应商执行和工作流路由尚未切换。未导入或删除 MongoDB 业务数据，未重新加密密钥；定向 ESLint 和 `npm run test:postgresql`（34/34）通过。

> 2026-08-03 迁移更新：公开企业品牌读取 `GET /api/branding/[id]` 已切换为平台 PostgreSQL 事务中的 `EnterpriseRepository` 查询，不再读取 MongoDB；AI 工作流、生成以及媒体资产写入/执行仍保持后续同一 bigint 运行时切片。

> 2026-08-03 迁移记录：新增 `AiWorkflowRepository`，提供 RLS 范围的工作流创建、列表、查询、更新以及成功自由创作结果归入方案的基础操作。归入事务会锁定方案和生成记录，仅将首个归入结果设为基准，后续成功结果保留为候选并更新 `lastGenerationId`。集成测试覆盖 bigint 关系和跨租户不可见性。未切换公开路由，未导入、删除或重新加密 MongoDB 业务数据；定向 ESLint 和 `npm run test:postgresql`（33/33）通过。
> 2026-08-03 迁移记录：新增 `AiCreationRepository`，为租户范围的媒体资产、自由创作任务、批次、按顺序引用资产、生成记录和供应商尝试提供 PostgreSQL 持久化契约。集成测试覆盖 bigint 关系、RLS 隔离、任务视图加载、当前尝试回填，以及“归档任务只软删除关联生成记录、不销毁历史行”的既定语义。由于工作流创建/归入、媒体交付和供应商执行服务仍依赖 MongoDB `ObjectId`，本步骤未切换公开路由，未导入、删除或重新加密 MongoDB 数据；定向 ESLint 和 `npm run test:postgresql`（32/32）通过。

> 2026-08-02 迁移记录：新增 `AiCreationModelProfileRepository` 作为自由创作执行链的 PostgreSQL 基础层；它同步全局 GRS 目录并保留显式启用/默认配置。由于任务、批次、生成、供应商尝试、媒体资产和工作流必须共同切换，本步骤未改动公开路由，未导入或删除 MongoDB 数据，也未重新加密密钥；定向 ESLint 和 `npm run test:postgresql`（31/31）通过。

> 文档用途：跨 Codex 对话持续推进 Smart Floor Planner 从 MongoDB/Mongoose
> 迁移到 PostgreSQL。任何新对话开始前，先读取本文档，再读取根目录
> `AGENTS.md`、`admin/AGENTS.md`、`docs/admin-system-modules.md` 和其中文镜像。
>
> 最后核验日期：2026-08-03
> 当前分支：`dev-jr`
> 当前阶段：`Phase 3 - API/业务代码切换`（进行中）

## 1. 关键决策

- 目标数据库：PostgreSQL 17。
- 目标访问层：`drizzle-orm` + `pg`，迁移使用可审阅的 SQL/Drizzle migration。
- 迁移策略：建立全新的 PostgreSQL 业务库，不迁移历史企业、用户、线索、
  户型、测量、订单、佣金、AI 历史任务等业务数据。
- 保留范围仅限：
  - 活动 RoomiAI 提示词模板及其完整引用链。
  - RoomiAI 模板预览资源及导入清单。
  - 七牛云媒体存储配置和当前激活 provider 指针。
- 新业务数据不需要兼容旧 MongoDB ObjectId，可采用 UUIDv7 或
  `bigint identity`。RoomiAI 导入数据也应在 PostgreSQL 中重新生成内部 ID，
  不要把 MongoDB `_id` 当成新的公共契约。
- `FloorPlan.layoutData` 的 PostgreSQL 表结构预留 `jsonb`，但由于本次不迁移
  旧户型数据，不需要先处理历史户型格式。
- 不做长期 MongoDB/PostgreSQL 双写。完成代码和数据验收后，以一次短时只读窗口
  初始化 PostgreSQL 并切换应用。

## 2. 当前仓库与数据库事实

### 2.1 代码耦合

- `admin/src/models/` 有 39 个 Mongoose 模型。
- `admin/src/app/api/` 有 127 个 API route。
- 约 125 个文件直接导入 MongoDB 连接。
- 约 66 个文件直接依赖 `mongoose.Types.ObjectId` 或其校验逻辑。
- 现有代码有大量 `populate()`、`Schema.Types.Mixed` 和 MongoDB 更新操作。
- 未发现已经实现的 MongoDB Session 事务。

现有连接入口是 [admin/src/lib/mongodb.ts](../admin/src/lib/mongodb.ts)，依赖声明
在 [admin/package.json](../admin/package.json)。租户查询隔离由
[admin/src/lib/mongoose-tenant-plugin.ts](../admin/src/lib/mongoose-tenant-plugin.ts)
提供。迁移完成前，不要删除这些兼容代码。

### 2.2 当前数据规模

只读统计结果：

- MongoDB 集合：40
- 文档总数：2,558
- 文档数据体积：约 27.2 MB
- 当前数据中存在历史业务数据，但这些数据不属于迁移白名单。

已发现但不需要在本次迁移中修复的历史问题：

- 5 个 FloorPlan 的 creator 引用不存在。
- 32 个户型不是正式 v4 墙图，只有 3 个符合正式墙图合同。
- 一些平台级用户或户型没有 `enterpriseId`，不能把所有缺失租户字段都当成错误。
- 存在需要归档确认的历史集合，例如 `aiquotas`。

因为这些业务数据不迁移，不要为了迁移 PostgreSQL 而修改或删除它们；只需在
清理前完成备份。

## 3. 保留白名单

### 3.1 RoomiAI 活动提示词版本

当前活动 revision：

- `source`: `roomi`
- `status`: `active`
- revision key：
  `roomi-522ebb4f5d521fc54409b70b5650b4b10631943ee99efa48c1a632588a398df4`
- `84` 个分类
- `960` 个模板
- `6` 个参数模板
- `5` 个源模型
- `960` 个预览资源

必须保留的 MongoDB 模型/目标表：

- `AiPromptLibraryRevision`
- `AiPromptCategory`
- `AiPromptParameterTemplate`
- `AiPromptSourceModel`
- `AiPromptTemplateAsset`
- `AiPromptTemplate`

失败 revision、历史 `AiPromptImportRun` 和不再被活动 revision 引用的记录可以不
迁移，但在清理前应留在备份中。

RoomiAI 导入使用 [admin/scripts/import-roomi-prompts.ts](../admin/scripts/import-roomi-prompts.ts)
的 manifest/snapshot 作为可重放来源。优先从 snapshot 重新导入 PostgreSQL，
不要直接把 MongoDB 文档逐条复制成最终表。

### 3.2 RoomiAI 预览文件

导入脚本把预览资源写到 `local` provider，而不是七牛云。当前验证结果：

- 存储目录：`admin/uploads/ai-assets`
- 已验证资源：`960/960`
- 已验证字节数：约 `2,507,732,114`
- `npm run verify:roomi-prompts`：成功，`errors: []`

必须将以下目录作为迁移资产单独备份，并在 PostgreSQL 导入后逐文件校验：

- `admin/uploads/ai-assets`
- `admin/.roomi-import`

如果后续决定把预览资源迁移到七牛云，应使用独立的媒体迁移步骤，不能把数据库
迁移和对象存储迁移混成一个不可回滚操作。

### 3.3 七牛云配置

必须保留：

- `MediaStorageConfig`
  - provider key：`zly-images`
  - driver：`qiniu`
  - bucket、region、domain、object prefix
  - 加密后的 access key 和 secret key
- `PlatformConfig.mediaStorage`
  - `activeProviderKey: zly-images`
  - `persistGrsAiOutputs`
  - 激活时间

当前配置的密钥字段是加密保存的，见
[admin/src/models/MediaStorageConfig.ts](../admin/src/models/MediaStorageConfig.ts)。
必须同时保留环境变量 `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`，否则原密文无法解密。

`activatedBy`、`createdBy`、`updatedBy` 如果指向将被清空的旧管理员，应在新库中
改成新平台管理员 ID 或设为 `NULL`。不要保留失效外键。

数据库清空不等于清理七牛 Bucket。七牛对象必须另行盘点；未经明确授权，不执行
远程对象删除。

## 4. 阶段状态

状态值只允许使用：`未开始`、`进行中`、`已完成`、`阻塞`、`已取消`。

| 阶段 | 内容 | 状态 | 完成证据 |
| --- | --- | --- | --- |
| Phase 0 | 迁移决策、代码/数据盘点、保留白名单 | 已完成 | 本文档；只读数据库统计 |
| Phase 0.1 | RoomiAI 活动版本和 960 个预览资源核验 | 已完成 | `npm run verify:roomi-prompts` 成功 |
| Phase 0.2 | 七牛配置、激活指针和加密字段核验 | 已完成 | 只读配置检查，未输出密钥 |
| Phase 1 | PostgreSQL 实例、角色、连接池和 migration runner | 已完成 | Codex 自动验收与用户数据库健康/后台页面回归均通过 |
| Phase 2 | PostgreSQL 目标 schema 和 Repository 基础层 | 已完成 | Codex 与用户验收已于 2026-08-01 通过 |
> 2026-08-05 迁移记录：租户 `GET /api/ai/usage` 及已废弃的平台企业读取
> `GET /api/admin/enterprises/[id]/ai-key`、`/ai-sync`、`/ai-usage` 现读取
> 租户隔离的 PostgreSQL `enterprise_ai_usage_snapshots` 表。既有读取 DTO 和
> `super_admin`/`admin` 边界不变；已退役的企业 Pollinations 凭证写入仍返回 `410`，
> `ai-key` 返回 `aiConfig: null`，避免暴露已退役的企业级 Key 模型。未导入、删除或重新
> 加密 MongoDB 业务数据。`npm run test:postgresql` 通过（45/45）。

| Phase 3 | API/业务代码从 Mongoose 切换到 PostgreSQL | 进行中 | 身份/企业核心、线索、正式户型、测量/设备、灵感方案、提示词库读取、角色、全局报备/媒体配置、套餐目录、报备记录、工作流通知、工作台、提醒运行时、订单/提成、企业激活、AI 风格预设、AI 供应商配置/运行时、GRS 生图模型目录及模型价格、AI 动作/模型价格、AI 点数账户/流水、AI 对话会话、企业 AI 用量快照及最近点数任务读取、PostgreSQL 媒体资产交付、自由创作执行、小程序 AI 任务执行及管理员重试、公开 bigint 工作流列表/详情/创建/状态/阶段执行、手动 `mock-generation` 结果持久化、同步建议/提示词优化生成、直连软装渲染、两步式后台 `generate`/`render`，以及后台 AI 设计助手的 bigint 线索/户型/工作流消费者均已切换。 |
| Phase 4 | RoomiAI snapshot、预览资源和七牛配置导入 | 进行中：待用户手动验收 | 2026-08-01 已写入 PostgreSQL 活动 Roomi 版本、960 个已校验本地预览、七牛配置并完成探测 |
| Phase 5 | 管理端/小程序合同测试与切换演练 | 进行中：Codex 自动验证已通过 | 专用迁移器已幂等完成；PostgreSQL 合同/RLS 测试和本地备份恢复演练已于 2026-08-05 通过。管理端和小程序用户验收仍待完成。 |
| Phase 6 | 正式切换到 PostgreSQL | 未开始 | 待记录切换时间、版本和回滚窗口 |
| Phase 7 | MongoDB 只读保留期结束 | 未开始 | 待明确归档/销毁批准和备份位置 |

### 4.1 每阶段双重验收门禁

从 Phase 1 开始，每个阶段必须依次通过以下两个门禁：

1. **Codex 自动验收**
   - Codex 先执行该阶段适用的 migration、幂等性、连接、权限、schema、单元、
     集成、API 合同、lint、build、Docker、备份/恢复和数据校验。
   - Codex 必须实际启动所需的本地服务，并验证本阶段修改的 API 或运行路径；
     不能只根据代码审阅宣称成功。
   - 命令、结果、已知警告、未覆盖范围和是否涉及删除/密钥操作必须写入本文档。
   - 自动验收失败时阶段保持 `进行中` 或标记为 `阻塞`，不得交给用户当作已完成
     功能验收。
2. **用户手动验收**
   - Codex 自动验收通过后，必须提供可逐项执行的手测清单，包括前置服务、测试
     账号/数据要求、页面或 API、操作、预期结果、停止/回滚方式。
   - 用户手测覆盖本阶段迁移域的完整主要流程，并回归登录、权限、租户隔离及相邻
     高风险流程；不要求每个阶段重复点击全系统所有无关按钮。
   - Phase 5 和正式切换前必须执行管理端与小程序的全量端到端回归。
   - 用户报告失败后，Codex 修复并重新执行自动验收，再提供受影响项目的复测步骤。

只有 Codex 自动验收通过且用户明确确认手测通过，阶段状态才能改为 `已完成`。
用户尚未反馈时，应记录为 `进行中：待用户手动验收`，不能仅凭对话记忆跳过。

每阶段使用以下记录格式：

| 验收项 | 执行者 | 状态 | 日期 | 证据/问题 |
| --- | --- | --- | --- | --- |
| 自动测试与运行验证 | Codex | 待执行 | - | 命令和结果 |
| 本阶段完整主流程手测 | 用户 | 待执行 | - | 页面、操作和结果 |
| 核心回归手测 | 用户 | 待执行 | - | 登录、权限、租户和相邻流程 |

## 5. 分阶段实施计划

### Phase 1 - 基础设施

- [x] 增加 PostgreSQL 17 本地 Docker 服务和生产连接配置。
- [x] 创建独立的 migration runner，不在 Next.js 启动时自动改 schema。
- [x] 创建应用角色、迁移角色和只读审计角色。
- [x] 配置 `pg.Pool`；长事务和外部 AI/七牛 HTTP 请求不得放在数据库事务内。
- [x] 增加 `/api/health` 的 PostgreSQL 检查，但保留 MongoDB 检查直到切换完成。
- [x] 完成本地 `pg_dump` 备份和隔离数据库恢复演练。

完成记录（2026-07-31）：

- Docker `postgres:17` 实际版本为 PostgreSQL `17.10`，服务
  `smart-floor-planner-postgres` 状态为 `healthy`，数据使用命名卷
  `postgres_data`。
- `sfp_migrator` 负责 DDL，并拥有运行 Drizzle migrator 所需的数据库
  `CREATE` 权限；`sfp_app` 只有 `app` schema 的业务读写权限且无 DDL；
  `sfp_auditor` 只有只读权限且无 DDL。生产密码不得复用 Compose 本地默认值。
- `admin/src/lib/postgresql.ts` 提供受环境变量约束的单例 `pg.Pool` 和 Drizzle
  连接；`admin/scripts/postgres-migrate.mjs` 是独立 runner，迁移记录表位于
  `app` schema。Docker 使用一次性 `migrate` profile 服务，通过
  `npm run docker:migrate` 显式执行；该服务以只读方式挂载工作区
  `admin/drizzle/`，避免旧应用镜像遮蔽新生成的 SQL。长期运行的 admin 服务不显式
  持有 `DATABASE_MIGRATION_URL`。
- 基线 migration `admin/drizzle/0000_vengeful_bishop.sql` 已执行，当前只创建
  `app.migration_checkpoints`。业务表和 Repository 属于 Phase 2。
- `npm run db:migrate`、`npm run db:check`、`npm run test:postgresql`、
  新增文件定向 ESLint、`docker compose config --quiet` 和 `npm run build`
  均成功。
- `docker compose build admin` 已成功生成约 `89.4 MB` 的最终镜像；
  `.dockerignore` 排除了约 2.5 GB 的本地 RoomiAI 预览资源、`.roomi-import`、
  `.postgres-backups`、`uploads` 和全部 `.env*`。`npm run docker:migrate`
  已从最终镜像成功执行幂等 migration，镜像检查确认不包含
  `.env.production`，admin 服务检查确认没有 migrator 连接串。
- `npm run db:backup` 生成了 `4,479` 字节 custom-format 本地备份；
  `npm run db:restore-drill` 已成功恢复到隔离数据库、查询
  `app.migration_checkpoints`，并自动删除演练数据库。备份目录
  `admin/.postgres-backups/` 已忽略，不作为生产备份位置。
- 构建仍有一个 Windows standalone 文件追踪警告，目标为
  `miniprogram/images/mine-icons`；构建退出码为 0，该警告与 PostgreSQL
  Phase 1 无关。
- 仓库全量 `npm run lint` 仍会命中既有的跨模块问题；Phase 1 新增和修改的
  PostgreSQL/health 文件已通过定向 ESLint。
- 本阶段没有删除 MongoDB 数据、RoomiAI 文件或七牛对象，也没有重加密或输出
  七牛密钥。MongoDB 仍是全部业务数据的唯一运行时来源。
- 生产部署需使用密钥管理器注入连接信息，并采用托管 PostgreSQL 的 PITR 或等价
  定期备份策略；本阶段只验证了项目自带的 Docker 备份/恢复路径。

Phase 1 验收状态：

| 验收项 | 执行者 | 状态 | 日期 | 证据/问题 |
| --- | --- | --- | --- | --- |
| migration、连接/角色、单测、lint、build、Docker、备份恢复 | Codex | 已通过 | 2026-07-31 | 见上述完成记录 |
| PostgreSQL 与 `/api/health` 手测 | 用户 | 已通过 | 2026-07-31 | MongoDB `ok`、PostgreSQL `ok`、`required: true` |
| 后台 MongoDB 核心页面回归 | 用户 | 已通过 | 2026-07-31 | 页面已手测，无白屏，用户明确确认通过 |

Phase 1 用户手动验收清单：

1. 打开 PowerShell，进入 `admin/`，启动本地数据库：

   ```powershell
   docker compose up -d postgres mongo
   docker compose ps
   ```

   预期：`postgres` 为 `healthy`，`mongo` 为 `Up`，Mongo 映射为
   `localhost:27018 -> mongo:27017`。数据库仍运行在本机，只是由 Docker 管理。
2. 确认本机开发环境的 `MONGODB_URI` 使用 `localhost:27018`，
   `DATABASE_URL` 使用 `localhost:5432` 和 `sfp_app` 应用角色；不要把生产连接
   串或真实密码写入本文档。然后执行：

   ```powershell
   npm run docker:migrate
   npm run db:check
   ```

   预期：两个命令均输出 `success: true`，`db:check` 中
   `database_user` 为 `sfp_app`、`can_use_app_schema` 为 `true`。
3. 启动管理端：

   ```powershell
   npm run dev
   ```

   打开 `http://localhost:3005/api/health`。预期 HTTP 200，响应中
   `databases.mongodb.status` 和 `databases.postgresql.status` 都是 `ok`。
4. 使用现有平台管理员账号登录 `http://localhost:3005/login`，逐项检查：
   - 首页/工作台可以打开，刷新后会话正常，没有 500 或白屏。
   - `/leads` 和一个线索详情可以读取。
   - `/floorplans` 和一个户型详情可以读取。
   - `/ai-studio/create` 可以打开并正确显示当前空状态，不出现 500。RoomiAI
     模板的完整浏览/预览在 Phase 4 导入 PostgreSQL 后验收。
   - `/media-storage` 可以打开并正确显示当前空状态，不出现 500。七牛配置读取/
     连通测试在 Phase 4 导入 PostgreSQL 后验收。
   - 浏览器开发者工具 Console 和 Network 中没有因 PostgreSQL 新增的持续报错或
     失败请求。
5. 本阶段业务仍由 MongoDB 提供，但新的 Docker Mongo volume 与旧 Windows
   MongoDB 是不同数据源。Docker Mongo 当前有 `3` 个 `adminusers`，而 RoomiAI
   六类集合、`mediastorageconfigs`、`platformconfigs` 和 `users` 均为 `0`。
   Phase 1 不复制这些数据，也不要求创建 PostgreSQL 业务数据。
6. 验收结束后按需停止本地服务：

   ```powershell
   docker compose stop postgres mongo
   ```

   不要执行 `docker compose down -v`，`-v` 会删除本地数据库卷。

用户反馈格式：

```text
Phase 1 手测：通过
或
Phase 1 手测：失败
- 失败步骤：
- 页面/API：
- 实际现象：
- Console/Network 错误：
```

本地端口说明：当前机器的 Windows MongoDB 服务占用了 `27017`，普通终端无法
修改该服务的启动方式，因此 Docker MongoDB 使用宿主机 `27018`。如需永久停用
Windows 服务，应在管理员 PowerShell 中执行 `Stop-Service MongoDB` 和
`Set-Service MongoDB -StartupType Manual`；不执行也不影响本项目连接 Docker
MongoDB，因为 `admin/.env.local` 已指向 `27018`。

旧 Windows MongoDB 白名单数据已在 2026-07-31 只读复核且仍然完整：
RoomiAI 分类 `84`、模板 `960`、参数模板 `6`、源模型 `5`、模板资源 `960`，
`mediastorageconfigs: 1`、`platformconfigs: 1`、`users: 3`。这些记录留在源库，
Phase 4 直接导入 PostgreSQL；不得为了填充 Docker Mongo 而提前复制或删除。

### Phase 2 - 目标 schema 与 Repository

- 先创建平台、身份、租户、提示词、媒体配置和 AI 配置的目标表。
- 业务表按未来需要设计，不导入旧业务数据。
- RoomiAI 的活动 revision 使用普通外键：
  `revision -> categories/parameters/source_models/templates/assets`。
- 动态字段使用 `jsonb`，金额使用 `numeric` 或最小货币单位整数，时间使用
  `timestamptz`。
- 统一索引租户列、外键列、状态列和轮询列。
- 对高频未删除/未完成任务使用 partial index。
- 通过 Repository 保留现有 API response DTO，避免管理端和小程序同时改协议。
- 在事务边界内设置租户上下文，补充 RLS 和跨租户访问测试。

Phase 2 自动验收记录（2026-07-31）：

- `admin/src/db/schema.ts` 已定义 44 张 typed 目标表，覆盖当前平台、身份、租户、
  提示词库、媒体、AI、量房、线索、商业、工作流和通知域。数据库中包含 Drizzle
  元数据表在内共有 45 张 `app` 表、95 个外键和 172 个索引。
- 新记录使用 `bigint identity`；时间使用 `timestamptz`，金额使用精确 `numeric`，
  动态嵌套数据使用 `jsonb`。正式 `floor_plans.layout_data` 只接受 version 4
  正式量房合同。
- RoomiAI revision 与分类、参数模板、源模型、模板和预览资源使用普通外键；partial
  unique index 保证每个来源最多一个活动 revision。
- Mongo ObjectId 数组中表示实体关系的字段在 PostgreSQL 中改用连接表，包括管理员
  推广关系、线索户型关系和带顺序的自由创作参考媒体；批次成果通过普通
  `creation_batch_id` 外键反向派生。
- 26 张租户或租户关系表强制启用 RLS，共 52 条策略。
  `withTenantTransaction`/`withPlatformTransaction` 通过事务内 `set_config`
  设置上下文，连接池不会残留租户。`sfp_app` 只有 DML、没有 DDL；
  `sfp_auditor` 只有 SELECT、没有 DML/DDL。
- 已建立企业、部门、平台配置和提示词库 typed Repository，作为 Phase 3 的切换
  模式；现有 API response DTO 和路由未改变。
- `npm run test:postgresql` 10/10 通过，覆盖跨租户读取隔离、跨租户写入拒绝、平台
  作用域、事务回滚、连接池上下文清理、运行配置和全部外键索引审计。
- migration 已在 PostgreSQL 17 应用，并连续两次空跑成功。运行时 `sfp_app`
  直接执行 DDL 被 PostgreSQL `42501` 正确拒绝。独立临时数据库
  `smart_floor_planner_phase2_drill` 已从空库重放 `0000` 到 `0004`，核对
  45 张表、26 张 RLS 表、52 条策略和严格户型合同后自动删除。
- `npm run db:backup` 生成 226,624 字节 custom-format 备份；
  `npm run db:restore-drill` 在隔离数据库恢复并核对 45 张表、26 张 RLS 表和
  52 条策略后删除演练数据库。
- 未导入或删除 MongoDB 文档、RoomiAI 文件、七牛对象或生产业务数据；未重加密
  或输出密钥。MongoDB 仍是唯一运行时业务数据来源。
- Phase 2 全部文件定向 ESLint 通过，`npm run build` 成功。仓库全量
  `npm run lint` 仍报告 Phase 2 文件之外的既有基线：263 个 error、99 个
  warning。build 仍有既存 Windows standalone save-icons route 文件追踪复制
  警告，但退出码为 0，且与 PostgreSQL 无关。

Phase 2 验收状态：

| 验收项 | 执行者 | 状态 | 日期 | 证据/问题 |
| --- | --- | --- | --- | --- |
| schema、migration、权限、RLS、Repository 测试、build、备份恢复 | Codex | 已通过 | 2026-07-31 | 见上述自动验收记录 |
| Phase 2 migration 与数据库边界手测 | 用户 | 已通过 | 2026-08-01 | 用户确认 `Phase 2 手测：通过` |
| 现有 MongoDB 后台回归 | 用户 | 不适用 | 沿用 Phase 1 | Phase 2 没有业务 route 变化；Phase 3 切换 PostgreSQL 后再回归 |

Phase 2 用户手动验收清单：

1. 进入 `admin/`，执行 `docker compose up -d postgres mongo`，再执行
   `npm run docker:migrate`、`npm run db:check` 和
   `npm run test:postgresql`。全部命令必须成功，`db:check` 必须报告
   `sfp_app`。
2. 执行 `npm run db:backup` 和 `npm run db:restore-drill`。恢复演练必须报告
   `tableCount: 45`、`rlsTableCount: 26`、`policyCount: 52`。
3. 执行 `npm run dev`，如该路由需要认证则先登录，再打开 `/api/health`，
   确认 MongoDB 和 PostgreSQL 均为 `ok`。
4. Phase 2 不要求页面级增删改查回归，因为没有业务 route 更换数据访问层。
   PostgreSQL 切换到 Phase 3 后，再完整回归增删改查、权限和租户隔离流程。
5. 如需停止服务，执行 `docker compose stop postgres mongo`；不要执行
   `docker compose down -v`。

如需补充问题，请附失败步骤、命令/页面、实际现象和相关错误。Phase 2
双重验收已完成，下一步进入 Phase 3。

### Phase 3 进度记录（2026-08-01）

- 提示词库只读路径已切换：分类、分页模板搜索、模板详情和预览资源查询
  均通过平台范围 PostgreSQL 事务调用 `PromptLibraryRepository`。现有 API
  DTO、route 路径和 `ai-scenarios` 权限边界保持不变；新建生成批次也通过
  同一 PostgreSQL 读取路径解析所选模板和参数定义。
- 新增 Repository 集成覆盖活动 revision、分类过滤、模板搜索/计数以及
  参数模板、来源模型和预览资源关联查询。
- 全局报备配置已通过 `PlatformConfigRepository` 读写
  `platform_configs`；`super_admin`/`admin` route 角色和响应 DTO 不变。
  Repository 集成覆盖确认更新报备 JSON 不会覆盖相邻的媒体存储 JSON。
- 使用现有本地开发服务和五分钟有效的本地管理员 JWT，已认证
  `GET /api/platform/promotion-config` 返回 HTTP 200 和规范化的
  PostgreSQL/默认 DTO；未认证迁移 route 返回 HTTP 401。本次运行时检查
  未写入配置。
- 媒体配置 CRUD、加密凭证读取、连通测试状态、归档、默认 Provider 和 GRS
  转存指针已切换到 `MediaStorageConfigRepository` 和
  `PlatformConfigRepository`。七牛网络探针保持在事务外，结果通过
  `updatedAt` 乐观条件回写。`0005_fat_joseph.sql` 将单列状态索引替换为
  匹配列表排序的 `(status, created_at)` 复合索引。资产统计仍读取 MongoDB
  `MediaAsset`；旧 Mongo 管理员身份替换前 bigint 审计字段保持 `NULL`。
- 系统角色列表、幂等默认初始化、权限更新、后台/小程序登录有效权限解析和
  管理员列表权限映射已切换到 `SystemRoleRepository`。角色 handler 内独立
  强制平台 `super_admin`/`admin` 边界；管理员认证 GET 返回 200、7 个角色和
  字符串 ID，无效及 `viewer` bearer token 分别返回 401、403。临时角色
  PATCH 返回 200、更新后的
  菜单权限和字符串 ID；随后按精确 role key 删除，复查匹配行数为 0。
- 后台登录、session/me 复核、小程序密码/微信/刷新身份解析、企业自助注册、
  管理员/员工 CRUD、部门 CRUD 和小程序用户资料接口已使用
  `AdminUserRepository`、`UserRepository`、`EnterpriseRepository` 和
  `DepartmentRepository`。PostgreSQL bigint ID 继续通过现有 `_id` 字段返回
  十进制字符串；后台会话和小程序上下文解析会复核账号启用状态。内部密钥保护
  的 seed route 已改为幂等创建 PostgreSQL 初始平台管理员，不再内置 secret/
  password 回退值。
- 租户员工、部门、小程序用户和地推连接表均在 PostgreSQL RLS 事务内访问。
  集成测试覆盖管理员地推关系、租户可见性、小程序 OpenID 查询/资料更新和跨
  租户拒绝；企业与自动创建的企业管理员账号在同一事务内写入。
- 线索列表/详情/新建/更新/删除、正式户型 CRUD/详情/DXF、测量列表/新建和
  设备列表/校验/绑定/变更均已使用 typed `LeadRepository`、
  `FloorPlanRepository`、`MeasurementRepository`、`DeviceRepository`。
  API 保留十进制字符串 `_id` DTO，关系内部统一使用 PostgreSQL bigint 和 RLS
  事务；关联数据批量加载，线索状态统计使用单次分组查询。
- 线索-户型连接表、主户型选择、租户校验、删除清理和酷家乐户型写入/关联均为
  原子操作；酷家乐网络调用不占用数据库事务。导入房间轮廓转换为毫米制正式 v4
  墙图；上游尚无可靠的开口到墙体映射，因此当前不导入门窗开口。
- 设备 `assigned_user_id` 已改为引用 `admin_users`，与员工绑定语义一致。测量写入
  会校验操作员、企业、正式户型、数值/类型/来源/时间和已分配设备；新增索引覆盖
  已迁移租户、关系、手机号、状态和按时间排序查询。
- `/api/miniprogram/home`、`/api/miniprogram/mine`、`/api/users`、后台户型详情
  和用户详情导出列表已接入迁移后的 Repository。AI 生成域迁移前首页
  `aiGeneratedCases` 返回 `0`；“我的”已从 PostgreSQL 读取报备/工作台待办。
  订单和提成仍由 MongoDB 支撑，不会把 PostgreSQL bigint ID 传入旧查询。
- 套餐目录列表/新建/更新/删除已在平台范围 PostgreSQL 事务中使用
  `PackageRepository`。现有 `_id` 响应字段承载 bigint 十进制字符串，套餐价格和
  地推提成继续使用精确 `numeric(14,2)`。`0008_whole_gravity.sql` 增加套餐名称
  数据库唯一约束；现有 `(status, created_at)` 索引匹配按状态筛选及时间排序。
  报备记录切换后，订单与提成仍刻意保留在 MongoDB，因为其旧 ObjectId 关系尚未
  转换，避免跨存储外键边界。
- 报备记录、公海/冲突、工作流通知、工作台 summary/todos 和提醒自动化现已运行
  在 PostgreSQL Repository 上。
  `0009_neat_rafael_vega.sql` 和 `0010_eminent_wildside.sql` 将认领审批、量房/设计
  分配、冲突审批等高频状态从仅有 JSON 的结构补充为显式 bigint 外键，增加对应的
  角色/查询索引，并把通知去重约束对齐现有 `(dedupeKey, channel)` 契约。
  `PromotionRecordRepository` 与 `WorkflowNotificationRepository` 已覆盖 RLS 范围内
  的角色可见性、关系装载、重复查询、原子条件状态转换、时间线追加、通知列表及按
  接收人确认提醒。运行时变更使用带 RLS 的短事务和条件状态更新；微信订阅消息
  在事务提交后发送。既有 DTO 和角色边界保持不变，本切片没有引入双写。
- `/api/admin/enterprises/activate` 已完全运行在 PostgreSQL 平台事务中：校验报备记录和
  可选订单的关系及账号冲突，创建企业/企业管理员，再回填适用的订单并将报备推进到
  `paid`。本切片不读取或写入 MongoDB，不导入或删除数据，也不重加密密钥。企业 AI
  key/sync/usage/credits、品牌及 AI 生成/工作流/媒体消费者尚未切换。企业核心响应
  返回 `aiUsageSnapshot: null`；引用已迁移 bigint 线索/户型 ID 的 MongoDB AI 路由在
  对应切片前保持 `Limited`。
- 已生成 `0006_exotic_wild_pack.sql` 至 `0010_eminent_wildside.sql`，并通过专用
  migration 容器/角色应用。运行时 `sfp_app`
  直接执行 DDL 被 PostgreSQL 以 `42501` 拒绝，权限边界保持有效。
  `npm run test:postgresql` 25/25、`npm run test:ai` 106/106、定向 ESLint 和生产
  build 通过。只读 HTTP 冒烟检查确认报备、公海、通知、工作台和提醒路由的未认证
  请求均为 401；短时本地管理员 Bearer token 访问线索、户型、设备、测量和用户列表
  均为 200。
  小程序测试 90/91；唯一失败是既有 API 环境断言期望 `localhost`、实际本地配置为
  `192.168.10.111`，与本 PostgreSQL 切片无关。生产 build 退出码为 0，并保留已知
  Windows `save-icons` standalone trace-copy 警告。
- AI 风格预设的默认初始化、读取和平台管理员更新现已在平台范围 PostgreSQL 事务中通过
  `AiStylePresetRepository` 执行；公开预设 DTO 仍把 PostgreSQL bigint 以字符串 `_id` 返回。
  定向 ESLint 与 PostgreSQL 集成测试均通过（26/26）。后续 Mini Program 重试迁移也已修正旧
  重试路由的 `enterpriseId` 边界，使其传递 AI 任务上下文所要求的字符串标识。
  生成任务持久化/模型档案同步以及 AI 工作流/生成/媒体仍需继续完成 Phase 3；其旧
  MongoDB ObjectId 边界在依赖切片完成前标记为 `Limited`。
- 本切片未导入生产 PostgreSQL 数据、未删除 MongoDB 文档或七牛对象，也未
  重加密或输出密钥。仅在精确前缀核对后删除 1 条 `phase3-api-*` 已归档 API
  测试记录，立即复查匹配行数为 0。
- 2026-08-02：AI 供应商配置/运行时已切换到平台 PostgreSQL 事务中的
  `AiProviderConfigRepository`。供应商 CRUD、密钥轮换、连通测试、模型同步、
  上游余额查询、环境默认供应商初始化及运行时选择保持原有路由、DTO 与
  `super_admin`/`admin` 的 `ai-providers` 权限边界。加密值不会写入日志；
  异步供应商调用完成后仅持久化非敏感运行状态。目标 ESLint 与
  `npm run test:postgresql` 均通过（28/28）；全量 TypeScript 检查仍仅有此前
  记录的测试文件错误，本供应商切片没有新增错误。
- 2026-08-02：平台业务动作价格及自由创作模型/分辨率价格已分别切换到平台 PostgreSQL
  事务中的 `AiCreditPriceRepository` 与 `AiModelCreditPriceRepository`。既有
  `/api/admin/ai-credit-prices`、`/api/admin/ai-image-model-prices` 路由、
  `super_admin`/`admin` 权限边界和 DTO 保持不变；价格内部使用 PostgreSQL `bigint`，
  API 仍返回数字。`AiCreationModelProfile` 仍使用 MongoDB，其中模型档案继续被任务、批次和生成记录的旧 `ObjectId` 引用。
  未导入或删除 MongoDB 数据；定向 ESLint 与 `npm run test:postgresql` 通过（29/29）。在自由创作运行时切换前，
  MongoDB 数字批次和计费快照会拒绝超出正 JavaScript 安全整数范围的 PostgreSQL 价格，避免静默舍入。
- 2026-08-02：AI 点数账户和流水已切换到租户 PostgreSQL 事务中的 `AiCreditRepository`。唯一 `operationId` 流水约束使发放、调整、冻结、扣除和释放与余额更新保持原子幂等；PostgreSQL bigint 在 API 中仍返回数字。平台企业点数接口现从 PostgreSQL 读取企业、账户、策略、流水及最近 bigint 任务列表；后续任务列表迁移有意不混合历史 MongoDB ObjectId 生成记录。旧 MongoDB 生成记录的 ObjectId 明确写为流水 `generationId: NULL`；未导入或删除 MongoDB 数据。定向 ESLint、`npm run test:postgresql`（30/30）和 `npm run test:ai`（106/106）均通过。
- 2026-08-02 已将未使用的企微配置、群分享 API/UI 和员工企微标识标记为弃用，不再迁移。
  该功能已从运行时代码与文档移除；历史 MongoDB 字段及 PostgreSQL
  `admin_users.wecom_user_id` 列保持原样，不执行数据迁移或破坏性清理。

Phase 3 验收状态：

| 验收项 | 负责人 | 状态 | 日期 | 证据/问题 |
| --- | --- | --- | --- | --- |
| 提示词库/角色/配置 API、Repository 集成测试、lint/build | Codex | 通过 | 2026-08-01 | PostgreSQL 15/15、AI 106/106；定向 ESLint/build；迁移 API 认证检查 200/401/403 |
| 身份/企业核心 API、RLS Repository 测试、lint/build | Codex | 通过 | 2026-08-01 | PostgreSQL 17/17；AI 106/106；定向 ESLint/build；运行时无效登录与未认证身份请求返回 401；bigint `_id` DTO 兼容和混合存储待切边界已记录 |
| 线索/正式户型/测量/设备及小程序聚合 | Codex | 通过 | 2026-08-01 | PostgreSQL 18/18；AI 106/106；定向 ESLint/build；迁移列表 API 认证后 200、未认证 401；覆盖租户隔离与关系清理；小程序 90/91，1 项为无关 API 环境期望失败 |
| 套餐目录 API 与 Repository | Codex | 通过 | 2026-08-01 | PostgreSQL 20/20；定向 ESLint/build；认证 GET 200、未认证 GET 401；migration 容器已应用 `0008` 并确认唯一索引存在；运行时角色 DDL 以 `42501` 被拒绝；来源/目标套餐表均为 0 行，无需导入业务数据 |
| 报备记录/工作流运行时与通知自动化 | Codex | 通过 | 2026-08-02 | 专用 migrator 已应用 `0009`/`0010`；PostgreSQL 23/23、定向 ESLint 和生产 build 通过；已验证租户 RLS、角色可见性、外键索引覆盖、含乐观版本条件的审批/驳回/释放、关系 DTO、按渠道通知去重、路由切换、工作台待办和提醒自动化；订单/提成仍为 MongoDB `Limited` |
| AI 风格预设运行时 | Codex | 通过 | 2026-08-02 | 默认初始化、读取和管理员更新均使用 `AiStylePresetRepository` 与平台事务；图片 JSON 字段更新保留相邻字段；PostgreSQL 集成测试 26/26 与定向 ESLint 通过。未导入或删除业务数据。 |
| AI 动作和模型价格 | Codex | 通过 | 2026-08-02 | 默认动作价格及自由创作模型/分辨率价格通过 `AiCreditPriceRepository`、`AiModelCreditPriceRepository` 在平台事务中读写；API 和管理员权限边界不变；PostgreSQL `bigint` 点数序列化为数字。定向 ESLint 与 PostgreSQL 集成测试 29/29 通过。模型档案仍在 MongoDB，等待依赖其 ObjectId 的切片。 |
| AI 点数账户和流水 | Codex | 通过 | 2026-08-02 | `AiCreditRepository` 在带 RLS 的 PostgreSQL 租户事务中原子执行幂等的发放、调整、冻结、扣除和释放；账户/流水 bigint 在 API 中序列化为数字。企业点数接口现从 PostgreSQL 读取账户、策略和流水。生成记录切片完成前，旧 MongoDB 生成 ID 在流水外键中保持 `NULL`。PostgreSQL 30/30、AI 106/106 通过。 |
| AI 自由创作持久化 Repository 基础层 | Codex | 基础层已验证 | 2026-08-03 | `AiCreationRepository` 覆盖 RLS 范围的媒体、任务、批次、引用资产关联、生成和供应商尝试；归档任务时保留生成历史。PostgreSQL 32/32 和定向 ESLint 通过。由于工作流/媒体/供应商执行消费者必须统一切换，本步骤没有路由切换或数据导入。 |
| AI 工作流 Repository 基础层 | Codex | 基础层已验证 | 2026-08-03 | `AiWorkflowRepository` 提供 RLS 范围的工作流 CRUD 基础操作，并在归入已成功自由创作结果时锁定工作流和生成记录。首个归入结果成为选中基准，后续结果保留为候选。PostgreSQL 33/33 和定向 ESLint 通过；未发生路由切换或数据导入。 |
| PostgreSQL 媒体资产交付边界 | Codex | 部分验证 | 2026-08-03 | `/api/ai/assets/[id]/image` 和 `/api/miniprogram/ai/assets/[id]/image` 在租户 RLS 范围内解析十进制 bigint ID，并保持本地字节输出/私有对象存储签名跳转。旧 ObjectId URL 仍为只读 MongoDB 兼容路径。PostgreSQL 34/34 与定向 ESLint 通过；上传、任务、批次、生成、执行和工作流路由仍在同一 bigint 切片中待迁移。 |
| AI 工作流线索选择器 | Codex | 部分验证 | 2026-08-03 | `GET /api/ai/workflow-leads` 现通过一个租户 RLS 事务调用 `LeadRepository` 搜索/更新时间排序和 `AiWorkflowRepository` 活动摘要。既有 DTO、正式户型可用性筛选和 `ai-scenarios` 边界不变。PostgreSQL 34/34 与定向 ESLint 通过；工作流写入和生成执行仍待迁移。 |
| AI 自由创作启动读取 | Codex | 部分验证 | 2026-08-03 | `GET /api/ai/creation/bootstrap` 现通过 PostgreSQL 初始化并读取 GRS bigint 模型档案/价格，并在租户 RLS 事务中读取活动工作流及其线索。既有 DTO、点数、供应商和 `ai-scenarios` 边界不变。旧 MongoDB 模型档案维护仅保留给未切换的任务/批次/生成执行链。PostgreSQL 35/35 与定向 ESLint 通过。 |
| AI 自由创作批次准备基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会在平台/租户 RLS 下校验 bigint 任务、资产、目录档案、提示词参数、策略和模型价格，再创建保存模型/参数/价格快照的待执行批次和生成记录。未切换路由或导入数据；供应商执行、轮询、媒体写入、扣除/释放和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作点数冻结基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会在租户 RLS 事务中原子认领 bigint 生成记录冻结流水、校验可用点数、冻结不可变生成价格并推进为可提交状态；重复调用复用已完成流水。未切换路由或导入数据；供应商执行、轮询、媒体写入、扣除/释放和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作供应商尝试基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会为已冻结的 bigint 生成记录原子记录选定供应商配置、固定模型、请求指纹和请求快照，并推进为 `processing`；重复调用复用活动尝试。未执行网络调用、切换路由或导入数据；提交/轮询、媒体写入、扣除/释放和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作供应商提交回执基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会锁定当前 bigint 生成记录，并持久化已受理尝试的远端任务 ID、供应商状态和轮询元数据；重复回执保留首次任务 ID，过期或冲突响应会被拒绝。未执行网络调用、切换路由或导入数据；供应商轮询、媒体写入、完成和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作供应商轮询状态基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会锁定已受理尝试的当前 bigint 生成记录，再保存非终态 `processing` 或 `unknown` 供应商状态、诊断和受限的下次轮询元数据。已记录远端任务 ID 不可变更，后续 `processing` 状态会清除临时未知诊断。未执行网络调用、切换路由或导入数据；终态处理、媒体写入、完成和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作批次状态汇总基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会先锁定租户范围 bigint 批次，再锁定其有序生成记录，校验请求数量契约，并从当前生成状态汇总为 `processing`、`succeeded`、`partial` 或 `failed`，重复刷新不产生冗余写入。供应商 I/O、工作流归入、公开路由切换和数据导入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作供应商结果结算基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会锁定已成功且受理的 bigint 生成记录及租户范围输出资产，再次校验不可变远端任务 ID，并在同一短 RLS 事务内关联 PostgreSQL 资产 URL 和完成精确、幂等的扣除流水。重复调用保留首次资产和账户余额。供应商网络/存储 I/O、工作流归入、公开路由切换和数据导入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作供应商成功终态基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会锁定当前 bigint 生成记录、校验已受理尝试不可变的远端任务 ID、持久化终态供应商结果/实际成本快照，并将两条记录推进为 `succeeded`。重复成功响应保留首次结果，仍冻结的生成记录可进入既有幂等扣除边界。未执行网络调用、切换路由或导入数据；结果媒体写入、扣除调用和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作结果媒体关联基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会锁定终态 bigint 生成记录及租户范围结果资产，校验已受理尝试和不可变远端任务 ID 后原子写入 PostgreSQL 资产 URL，并把未认领结果资产归属给该生成任务。重复关联保留首次图片，其他生成任务不可认领该资产。未执行供应商下载/存储 I/O、切换路由或导入数据；扣除调用和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作供应商失败结算基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会锁定当前已受理 bigint 尝试和生成记录，校验不可变远端任务 ID 后，在同一租户 RLS 事务内记录供应商/生成失败元数据并完成幂等释放流水。重复失败响应保留已释放余额。未执行供应商 I/O、切换路由或导入数据；结果存储、成功扣除调用和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作点数释放基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 会原子释放已冻结 bigint 生成记录的价格快照、完成幂等释放流水并标记生成失败；重复释放保持冻结余额不变。未切换路由或导入数据；供应商提交/轮询、媒体写入、成功扣除和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| AI 自由创作点数扣除基础层 | Codex | 基础层已验证 | 2026-08-03 | `postgres-creation-service` 仅为已成功且仍冻结的 bigint 生成记录原子扣除余额和冻结余额中的价格快照，并完成幂等 consume 流水；重复调用保持账户状态不变。未切换路由或导入数据；供应商提交/轮询、媒体写入和工作流归入仍待完成。PostgreSQL 36/36 和定向 ESLint 通过。 |
| 提示词库主流程手测 | 用户 | 待验证 | - | 需要 Phase 4 导入活动 PostgreSQL prompt revision 后执行 |
| 登录、授权、租户与相邻 AI 回归 | 用户 | 待验证 | - | 其余 Phase 3 切片完成后重复执行 |

### Phase 4 进度记录（2026-08-01）

- 新增 `admin/scripts/import-phase4-retained-data.ts` 及显式执行命令
  `npm run migrate:phase4-retained-data`。脚本只从只读旧 MongoDB 来源导入保留的
  RoomiAI snapshot、manifest 索引的预览资源和当前七牛配置；不会导入其他业务集合，
  也不会删除 MongoDB 或七牛对象。
- PostgreSQL 当前活动 Roomi revision 为
  `roomi-522ebb4f5d521fc54409b70b5650b4b10631943ee99efa48c1a632588a398df4`，
  包含 84 个分类、960 个模板、6 个参数模板、5 个源模型和 960 个预览资源。导入的
  manifest/content hash 与源 snapshot 一致；960 个暂存文件均在导入前通过大小、
  SHA-256 和图片尺寸校验，写入存储后又逐一读取并复核哈希。
- 已导入 `zly-images` 七牛配置及默认 Provider 指针，过程未输出明文凭据。旧管理员
  审计引用按合同映射为 `NULL`。完整上传、对象查询、私有签名下载、内容一致性和清理
  探测均已通过，临时探测对象已删除。生产部署仍必须注入可解密本次导入凭据的专用
  `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`。
- 导入器可幂等重复执行：最终复跑识别到完整活动版本、复核 960 个本地对象并再次完成
  七牛探测。`app.migration_checkpoints` 已记录 `phase4-retained-data`，状态为
  `codex_verified`。
- `npm run test:postgresql` 18/18、`npm run test:ai` 106/106 通过；带认证的提示词
  分类与模板 API 冒烟请求均返回 HTTP 200。未删除任何 MongoDB 文档、snapshot 文件或
  七牛生产对象，来源数据仍保留以便回滚/核对。

Phase 4 验收状态：

| 验收项 | 负责人 | 状态 | 日期 | 证据/问题 |
| --- | --- | --- | --- | --- |
| 导入、幂等、完整性、七牛探测和自动化测试 | Codex | 通过 | 2026-08-01 | `phase4-retained-data` 检查点；84/960/6/5/960 计数；960 个预览通过复核；PostgreSQL 18 项与 AI 106 项测试通过 |
| 提示词库和预览主流程 | 用户 | 待验证 | - | 在后台 UI 验证活动 PostgreSQL Roomi 版本 |
| 七牛配置和关键回归 | 用户 | 待验证 | - | 确认媒体存储配置、登录、权限与租户边界 |

### Phase 5 进度记录（2026-08-05）

- PostgreSQL 容器处于健康状态。专用 `sfp_migrator` 角色已成功执行
  `npm run docker:migrate`；本地运行时 `sfp_app` 角色按最小权限设计不具备 DDL 权限。
- `npm run db:check` 确认 `sfp_app` 运行时连接可使用 `app` schema，并报告既有的
  `phase4-retained-data` 检查点。
- `npm run test:postgresql` 49/49 通过，覆盖租户 RLS、外键索引、正式量房、商业激活、AI
  生命周期和 PostgreSQL 运行时配置。测试输出一条关于并发 `client.query()` 的 `pg` 未来弃用
  警告；它未导致测试失败，作为后续技术债记录。
- `npm run db:backup` 写入一个 798,009 字节的本地 custom-format 备份。`npm run
  db:restore-drill` 仅将其恢复到 `smart_floor_planner_restore_drill`，验证 45 张 `app`
  表、26 张 RLS 表、52 条策略和 1 条 migration checkpoint，随后移除了该演练数据库。
- 全仓库 lint 仍被 66 项既有且与本迁移无关的错误阻塞。本次 Phase 5 自动验证未导入、删除、
  记录日志或重新加密任何 MongoDB 业务文档、PostgreSQL 业务数据、七牛对象或密钥。

Phase 5 验收状态：

| 验收项 | 负责人 | 状态 | 日期 | 证据/问题 |
| --- | --- | --- | --- | --- |
| 迁移器、运行时数据库检查、PostgreSQL 合同/RLS 套件、备份与恢复演练 | Codex | 通过 | 2026-08-05 | `docker:migrate`、`db:check`、PostgreSQL 49/49、798,009 字节备份和 45/26/52 恢复验证通过 |
| 管理端和小程序模板浏览/预览合同流程 | 用户 | 待验证 | - | 需要 PostgreSQL 活动 Roomi revision 以及已认证的管理端/小程序会话 |
| 完整切换回归和租户隔离验收 | 用户 | 待验证 | - | Phase 6 前必须覆盖登录、角色、租户隔离、媒体存储和相邻 AI 流程 |

### Phase 3 - 业务代码切换

建议按以下顺序切换：

1. 配置、角色、提示词库和媒体配置。
2. 管理员、企业、部门和小程序身份。
3. 线索、户型、测量和设备。
4. 订单、佣金和 AI 点数。
5. AI 工作流、生成任务、媒体资产和聊天。

每个域完成后必须记录：

- 已替换的模型和 route。
- 新增的 Repository、事务和索引。
- 权限/租户边界。
- 已通过的单元、集成和 API 合同测试。
- 尚未切换的调用点。

### Phase 4 - 白名单数据导入

- 在 PostgreSQL 中创建空目标 schema。
- 从 RoomiAI snapshot 导入活动 revision。
- 使用 manifest 中的资源清单导入模板预览文件。
- 导入后计算并比对每个模板资源的 SHA-256、大小和尺寸。
- 导入七牛配置；密文只有在加密 secret 相同的情况下才能直接复用。
- 新建平台管理员后再处理 `activatedBy` 等审计字段。
- 不导入其他 MongoDB 业务集合。

### Phase 5 - 验收

必须满足：

- 活动 revision 的 6 类记录数量完全一致。
- 960 个模板均能查到有效分类、参数模板和预览资源。
- 960 个预览资源全部可读，哈希一致。
- 七牛上传、查询、私有下载签名和删除探针全部成功。
- 管理端和小程序模板浏览/预览合同测试通过。
- RLS/租户测试不存在跨企业读取。
- 新库备份恢复成功。

### Phase 6 - 切换

1. 备份 MongoDB、RoomiAI snapshot、预览文件和配置密文。
2. 开启短时只读模式，暂停自动任务和后台写入。
3. 执行 PostgreSQL schema migration 和白名单导入。
4. 运行 Phase 5 的验收脚本。
5. 发布 PostgreSQL 数据访问层。
6. 先开放内部账号，再逐步恢复管理端和小程序流量。
7. MongoDB 保持只读至少 14 天。

正式切换前不得执行 MongoDB 或七牛对象的不可恢复删除。

## 6. 回滚规则

- PostgreSQL 尚未接受业务写入前：可以直接切回旧 MongoDB。
- PostgreSQL 已接受业务写入后：不能把旧 MongoDB 当成自动回滚目标，因为它
  不包含新写入。
- 若需要切回，必须先进入只读窗口，使用已演练的 PostgreSQL 变更回放/重建
  工具把需要保留的数据写回 MongoDB，再切换应用。
- 在回滚工具完成并演练前，Phase 6 不具备“可回滚”资格。

## 7. 后续对话续接规则

新对话必须先报告：

1. 当前读取的文档版本和最后核验日期。
2. 当前阶段状态表中哪些项发生变化。
3. 本次准备修改的文件和所属阶段。
4. 是否涉及数据库删除、对象存储删除或密钥重加密。
5. 完成后更新本文档的状态、证据、阻塞项和下一步。

禁止根据旧对话记忆推断迁移已经完成。只有代码、migration 文件、测试输出、
导入日志或切换记录可以推进阶段状态。

## 8. 当前下一步

> 2026-08-04 更新：公开 bigint 工作流列表、创建、详情、状态变更、全部场景阶段执行（含 `lighting` 视觉分析/提示词编译）及手动 `mock-generation` 结果持久化、后台 AI 设计助手的 bigint 线索/户型消费者、小程序 AI 任务执行链、同步建议/提示词优化生成、直连软装渲染以及两步式后台 `generate`/`render` 均已切换 PostgreSQL。

Phase 3 身份/企业核心、线索、正式户型、测量、设备、小程序聚合、套餐目录、报备
工作流运行时、订单/提成、企业激活、AI 风格预设、AI 供应商配置/运行时、AI 动作/模型价格及 AI 点数账户/流水、自由创作模型档案，以及公开 bigint 工作流列表/创建/详情/状态变更、全部场景阶段执行和手动 `mock-generation` 结果持久化均已完成。关联的 bigint 自由创作任务、批次、生成、媒体、供应商尝试和显式工作流归入运行时也已切换；后台 AI 设计助手已成为 bigint 线索/户型消费者，小程序 AI 任务执行及管理员重试、同步建议/提示词优化生成、直连软装渲染及两步式后台 `generate`/`render` 也已切换。除已完成的
Phase 4 白名单导入外，没有显式迁移切片与验收记录时不得导入生产业务数据。
