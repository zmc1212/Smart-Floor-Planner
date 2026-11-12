# 小K三线集成审查

## 2026-11-13 只读审查

| 引用 | Fetch 后提交 |
| --- | --- |
| Bailian `codex/xiaok-bailian-responses-api` | `113043445e0675bbc4e05d92fe4a338c8b6262fa` |
| Native `codex/xiaok-native-workflow` | `e3b9a2df6d012dfdda92d2bd3fb95bcb4a3b8c86` |
| Public `codex/xiaok-public-site-lifecycle` | `44ea5f4434213d6fd7b802cbfa6626602653d034` |
| `origin/main` | `f273b57171d6dab5c3b8beef1fe124e634d51864` |

三线共同祖先是 `c190fd3fe7339b4914f9f9f7ea5b4e963b56a745`。Bailian 与 Native 还共享 `11ac22ddcea422d3d69358b7a2fe221c13487dd7`。`main` 是三线的祖先，相对各线的独有提交均为 0，各线超前 469 / 466 / 460 个提交。以三线共同祖先创建 `codex/xiaok-integration`，按 I1 Bailian、I2 Native、I3 Public 合并并保留父提交。初查本地及远端均无同名分支。原 Public 工作树的 `admin/src/lib/survey-runtime/source-manifest.json` 有未提交修改，集成使用独立工作树。

### 文件与合同冲突

- 以两线对应共同祖先比较。Bailian/Native 交叉修改 21 个路径，Bailian/Public 24 个，Native/Public 38 个，三线同时修改 16 个。只读 `git merge-tree` 分别预报 14、8、26 个文本冲突。三线同时修改的代码包括 Assistant `synthesis.ts`、`worker.ts`、`conversation.ts`、`knowledge/sources.ts`，Construction `report-body-worker.ts`、`service.ts`、`site-chat.ts`、`site-queries.ts`、`site-results.ts`，以及小程序 `assistant/lib/chat.js` 与对应测试。另有四份模块清单与唯一计划。
- I1 以 `AgentModelGateway` / `ModelTurnInput` / `ModelTurnOutput` 承载双协议。配置默认走现有 Chat Completions。Responses 和原生工具依模型能力显式启用，名称冲突、用量和中断状态须有回归。Public 的原生执行器涉及对话运行、回调串行化及引用复核，合入时核对模型派发与恢复的真实调用点。
- I2 两线在 `delegation-state.ts`、`delegation-store.ts`、`delegation-worker.ts`、`delegation-chat.ts` 为新增/新增冲突。Bailian `delegation-sources.ts`、`delegation-knowledge.ts` 提供可撤回的材料与工艺证据。Native 持有房间任务、定时唤醒、租约、报告状态及工具持久化。Construction 的记录、事项、图纸与角色权限仍是业务事实。统一调度需兼容两种委托来源与原会话回执。
- I3 冲突集中在 Assistant 的请求上下文和 Worker、Construction 的设计需求/计划/事项/整改投影、小程序项目与会话。保留 Public 的已批准设计及公开来源失效合同，与 Native 的四端同源数据和 durable receipts 对齐。核查两份还原台账的当前路由行。
- Bailian、Native 在分叉后没有改动 `admin/package.json` 与 `admin/package-lock.json`。Public 成对升级 Next.js `16.2.3 → 16.4.6`、sharp `^0.34.5 → 0.35.5`，并变更 `tsconfig.json`。I3 统一使用 Public 锁文件和独立安装，构建与类型检查分别记录。

### PostgreSQL 迁移

共同 Journal 共 120 条（idx 0–119），尾项是 `0120_construction_camera_sd_identity_version`。此前已有 `0115 → 0114` 的历史依赖顺序，按 Journal 时间戳保留。

| idx | 时间戳 | Bailian | Native |
| --- | --- | --- | --- |
| 120 | 1795075200000 | `0121_assistant_rag_scope` | `0121_native_workflow_delegations` |
| 121 | 1795161600000 | `0122_assistant_managed_knowledge` | `0122_native_workflow_runtime` |
| 122 | 1795248000000 | `0123_assistant_long_term_delegation` | `0123_native_workflow_durable_tasks` |

- 依赖。共同 `0060` 的知识 chunks → 项目/企业作用域 → 托管库及文档导入。共同 Assistant 会话消息、Construction、Outbox → 长期记忆和委托。Native runtime stores 与 durable tasks 还依赖租户和 outbox delivery。两份委托 DDL 创建同名委托、事件表、索引、RLS 与投递触发器。Bailian 按 `owner_id/current_status/evidence`，Native 按 `requester_id/state/tasks`，历史数据要保留业务意图、原消息、审计以及未知副作用。
- 历史 `0060_assistant_knowledge.sql` 在 Bailian 被改成 pgvector 可选，另有无向量初始化通过记录。集成以共同已用 SQL 为正本，历史 Bailian 变体保留作核查。已安装 Drizzle 按账本最大 `created_at` 选择待执行迁移，直接拼接 Journal 会漏掉同时间戳条目。I2 要把历史分支文件及校验保留并采用严格在冲突尾部之后的兼容迁移，以实际 SQL 执行记录生成新账本条目。
- 经现有回环转发只读核对，开发主库有 119 条，隔离评估库有 118 条，两者最新为 `0119`，未见分支委托、Native runtime 或托管知识表。两库的 `0021`、`0051` 历史 hash 与当前仓库不同，保持原样。两库尚未迁移。
- 本机 Native 隔离实例实查到共同基线 120 条、应用原始 Native 委托 121 条，以及应用三个 Native SQL 的 123 条账本。另有保留失败/中间库在两个 runtime 时间戳写有不同 hash（`6c42ecee7bca…`、`b323e1d7b876…`），不可按时间戳判定已应用新版。Bailian R6 已停止实例的隔离副本实查原 123 条迁移、2 条委托和 27 条事件。保留原始 `tmp/r6` 证据与无向量初始化记录。
- 升级验证需覆盖全新 PG17/pgvector、已应用 Native 和已应用 Bailian 的隔离库，校验原账本不变、DDL/RLS/触发器、业务数据以及重跑。任何未知 schema 或账本差异先归因，再决定能否升级。生产和共有开发库的实际应用不在本次授权内。

### 验收记录

历史各分支报告只覆盖各自的快照。保留 Bailian `docs/evidence/bailian-responses-*.json` 及原本地 R4–R6 证据、Native [B5.10 部署审查](native-workflow-b510-deployment-review.zh-CN.md) 及 B5.11 记录、Public 四端与 Markdown 证据。历史模型失败、unknown、实际用量与环境限制继续在原记录查询。集成当前待验证范围包括双协议真实调用及原生工具、企业引用撤权、项目切换与重进、四端日周报和周槽、设计/整改/关闭、PostgreSQL 多实例与副作用幂等、Stable 原生端与完整构建。生产发布维持独立授权。

| 阶段 | 当前状态 | 核对依据 |
| --- | --- | --- |
| I1 Bailian | 已集成，验收 Limited | 提交 `67443d856fc9acfb361d05b8b1ecf9957c396a62`。127/127 定向单元、85/85 客户端，238 个目标文件 ESLint 零错误。PG17 从空库迁移 123 条，托管知识、长期记忆、委托五张表的强制 RLS 已核。实模 Chat Completions 与 Responses 基础请求通过，联网集成请求超时 unknown。 |
| I2 Native | 隔离服务验证通过，整体验收 Limited | 571/571 单元、7/7 Native 实库和 10/10 R6 合成业务。两个 Admin/Worker、租约接管、四角色同周投递、回执重进、跨租户和故障回滚均覆盖。待 I3 统一 Stable 验收。 |
| I3 Public | 待集成 | 用户入口、四端业务与来源生命周期、Stable |

I1 源码索引 `f256cebc1fd57531191a687e67e357e0689acb2f`。完整 `tsc` 的 290 条诊断与 Bailian R6 的 `type-final.log` 逐条一致，其中应用源码两处位于 `report-context.ts`、`period-report-status.ts`。首次 ESLint 命令因相对路径为空实际扫描全项目，保留其中一条基线错误的日志。改为定向路径后通过。首次空库迁移因 migrator 无权安装 vector 失败，由隔离库 owner 显式预置扩展后通过，共同 `0060` 保持原字节。原始测试日志在集成工作树 `tmp/i1-*.log`。

实模固定 `qwen3.7-flash`。本机独立库使用留存的北京百炼开发凭据，首个配置脚本缺历史 catalog 文件，在发请求前停止。复用现有凭据加载器和官方域名校验后配置成功。两次已知成功共 87 输入、453 输出 tokens，实际账单未返回。第三次 `PROVIDER_TIMEOUT` 用量未知且未重放，网页提取与代码解释器后续用例未执行。原请求及结果见工作树 `tmp/bailian-responses/`。托管知识仍缺 R6 专用工作空间配置。

### I2 迁移与运行验证

- 以活动 Journal 的 `0124` 知识 → `0125` Native 存储及 Durable Tasks → `0126` 长期记忆与委托合流为唯一顺序。活动时间戳为 `1795334400000`、`1795420800000`、`1795507200000`。分叉 SQL 与原条目保存在 `admin/drizzle/legacy/`，保留原 tag、时间戳和字节。兼容迁移核对已知原 hash 与表/约束，发现两类原账本混用或未知分叉 hash 时拒绝。原 `0060` 在新库要求预置 pgvector，托管检索本身沿原可选配置。
- 隔离 PG17 全新库 123 条，Bailian、Native 原序列各从 123 到 126 条，相关 11 张表全部强制 RLS。对停止的 R6 原卷取只读副本，确认原 Bailian 三条 hash；实际升级两次，旧账本 123 行、2 条委托和 27 条事件的逐行摘要相同。完成和取消状态映射保持。Native 升级库以原 Native 三条迁移初始化后完成实库写入与双实例测试。历史不匹配的 runtime 变体保留在旧证据库，尚未核准升级。
- Native 使用同一租户锁、Outbox 投递、状态与身份边界。R6 的工艺读取和施工复核接入该消费者，原始副作用回执与重进沿 Construction 和 Assistant。详见[统一模块合同](xiaok-integration-contract.md)。
- 测试索引 `5224f11330621383e9af4249159a74b5434de2b8`。97 个目标文件 ESLint 零错误。首次类型检查发现新增 `safeText` 未导入，已修正；顺带处理两条继承的应用源码类型错误。全量类型与构建随 I3 锁文件一并复验。证据为集成工作树 `tmp/i2-*.log` 与 `admin/tmp/r6/integration-i2-service-01/`。R6 使用测试托管替身和隔离服务，真实模型调用 0，保留 I1 的超时结果。
