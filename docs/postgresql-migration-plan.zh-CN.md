# PostgreSQL 迁移计划与进度

> 文档用途：跨 Codex 对话持续推进 Smart Floor Planner 从 MongoDB/Mongoose
> 迁移到 PostgreSQL。任何新对话开始前，先读取本文档，再读取根目录
> `AGENTS.md`、`admin/AGENTS.md`、`docs/admin-system-modules.md` 和其中文镜像。
>
> 最后核验日期：2026-08-01
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
| Phase 3 | API/业务代码从 Mongoose 切换到 PostgreSQL | 进行中 | 身份/企业核心、线索、正式户型、测量/设备、提示词库读取、角色和全局报备/媒体配置已切换；商业与 AI/媒体域待完成 |
| Phase 4 | RoomiAI snapshot、预览资源和七牛配置导入 | 未开始 | 待补充导入日志、哈希和验收报告 |
| Phase 5 | 管理端/小程序合同测试与切换演练 | 未开始 | 待补充测试报告和恢复演练 |
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
  `npm run docker:migrate` 显式执行；长期运行的 admin 服务不显式持有
  `DATABASE_MIGRATION_URL`。
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
  `aiGeneratedCases` 返回 `0`；商业工作流迁移前“我的”返回 `todos: []`。
- 企业激活仍联动 MongoDB 报备/订单；企业 AI key/sync/usage/credits、品牌/
  企微配置、商业工作流和 AI 生成/工作流/媒体消费者尚未切换。企微线索分享因此
  明确返回 `400`；企业核心响应返回 `aiUsageSnapshot: null`；引用已迁移 bigint
  线索/户型 ID 的 MongoDB AI 路由在对应切片前保持 `Limited`。
- 已生成并使用宿主机 migration runner 应用 `0006_exotic_wild_pack.sql` 和
  `0007_simple_mindworm.sql`。`npm run test:postgresql` 18/18、`npm run test:ai`
  106/106、定向 ESLint 和生产 build 通过。只读 HTTP 冒烟检查确认未认证请求为
  401，短时本地管理员 Bearer token 访问线索、户型、设备、测量和用户列表均为 200。
  小程序测试 90/91；唯一失败是既有 API 环境断言期望 `localhost`、实际本地配置为
  `192.168.10.111`，与本 PostgreSQL 切片无关。生产 build 退出码为 0，并保留已知
  Windows `save-icons` standalone trace-copy 警告。
- RoomiAI 导入脚本、生成任务持久化/模型档案同步、商业记录/工作流、企业激活/
  企微以及 AI 工作流/生成/媒体仍需继续完成 Phase 3。
- 本切片未导入生产 PostgreSQL 数据、未删除 MongoDB 文档或七牛对象，也未
  重加密或输出密钥。仅在精确前缀核对后删除 1 条 `phase3-api-*` 已归档 API
  测试记录，立即复查匹配行数为 0。

Phase 3 验收状态：

| 验收项 | 负责人 | 状态 | 日期 | 证据/问题 |
| --- | --- | --- | --- | --- |
| 提示词库/角色/配置 API、Repository 集成测试、lint/build | Codex | 通过 | 2026-08-01 | PostgreSQL 15/15、AI 106/106；定向 ESLint/build；迁移 API 认证检查 200/401/403 |
| 身份/企业核心 API、RLS Repository 测试、lint/build | Codex | 通过 | 2026-08-01 | PostgreSQL 17/17；AI 106/106；定向 ESLint/build；运行时无效登录与未认证身份请求返回 401；bigint `_id` DTO 兼容和混合存储待切边界已记录 |
| 线索/正式户型/测量/设备及小程序聚合 | Codex | 通过 | 2026-08-01 | PostgreSQL 18/18；AI 106/106；定向 ESLint/build；迁移列表 API 认证后 200、未认证 401；覆盖租户隔离与关系清理；小程序 90/91，1 项为无关 API 环境期望失败 |
| 提示词库主流程手测 | 用户 | 待验证 | - | 需要 Phase 4 导入活动 PostgreSQL prompt revision 后执行 |
| 登录、授权、租户与相邻 AI 回归 | 用户 | 待验证 | - | 其余 Phase 3 切片完成后重复执行 |

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

Phase 3 身份/企业核心、线索、正式户型、测量、设备及其小程序聚合已切换。
下一批应迁移商业记录/工作流（含企业激活和企微配置），再迁移 AI 工作流、生成、
媒体持久化及其 bigint 线索/户型消费者。Phase 4 白名单导入前不导入生产业务数据。
