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
| I2 Native | 已集成，隔离服务验证通过，整体验收 Limited | 提交 `35e34127d532c4ed615a0473b4d35b798e8b5da5`。571/571 单元、7/7 Native 实库和 10/10 R6 合成业务。覆盖双 Admin/Worker、租约接管、四角色同周投递、回执重进、跨租户和故障回滚。 |
| I3 Public | 已合流，整体验收 Limited | 提交 `ad527d465425f79b08b5bdc9128dc3b153cf1556`，父提交为 I2 和 Public。本节后列出集成基线、历史复用和剩余限制。 |

I1 源码索引 `f256cebc1fd57531191a687e67e357e0689acb2f`。完整 `tsc` 的 290 条诊断与 Bailian R6 的 `type-final.log` 逐条一致，其中应用源码两处位于 `report-context.ts`、`period-report-status.ts`。首次 ESLint 命令因相对路径为空实际扫描全项目，保留其中一条基线错误的日志。改为定向路径后通过。首次空库迁移因 migrator 无权安装 vector 失败，由隔离库 owner 显式预置扩展后通过，共同 `0060` 保持原字节。原始测试日志在集成工作树 `tmp/i1-*.log`。

实模固定 `qwen3.7-flash`。本机独立库使用留存的北京百炼开发凭据，首个配置脚本缺历史 catalog 文件，在发请求前停止。复用现有凭据加载器和官方域名校验后配置成功。两次已知成功共 87 输入、453 输出 tokens，实际账单未返回。第三次 `PROVIDER_TIMEOUT` 用量未知且未重放，网页提取与代码解释器后续用例未执行。原请求及结果见工作树 `tmp/bailian-responses/`。托管知识仍缺 R6 专用工作空间配置。

### I2 迁移与运行验证

- 活动依赖图。旧分支路径只用于识别已应用的原始记录，所有升级收敛到同一活动尾部。

```mermaid
flowchart LR
    P["PG17 与预置 pgvector"] --> S["共同 0000–0120<br/>0060 知识与 Assistant、Construction、Outbox"]
    S --> K["0124 项目及企业知识、托管检索"]
    S --> B["已应用 Bailian 0121–0123"]
    S --> N["已应用 Native 0121–0123"]
    B --> K
    N --> K
    K --> R["0125 PostgreSQL runtime 与 Durable Task"]
    R --> D["0126 长期记忆与统一委托"]
```

- 以活动 Journal 的 `0124` 知识 → `0125` Native 存储及 Durable Tasks → `0126` 长期记忆与委托合流为唯一顺序。活动时间戳为 `1795334400000`、`1795420800000`、`1795507200000`。分叉 SQL 与原条目保存在 `admin/drizzle/legacy/`，保留原 tag、时间戳和字节。兼容迁移核对已知原 hash 与表/约束，发现两类原账本混用或未知分叉 hash 时拒绝。原 `0060` 在新库要求预置 pgvector，托管检索本身沿原可选配置。
- 隔离 PG17 全新库 123 条，Bailian、Native 原序列各从 123 到 126 条，相关 11 张表全部强制 RLS。对停止的 R6 原卷取只读副本，确认原 Bailian 三条 hash；实际升级两次，旧账本 123 行、2 条委托和 27 条事件的逐行摘要相同。完成和取消状态映射保持。Native 升级库以原 Native 三条迁移初始化后完成实库写入与双实例测试。历史不匹配的 runtime 变体保留在旧证据库，尚未核准升级。
- Native 使用同一租户锁、Outbox 投递、状态与身份边界。R6 的工艺读取和施工复核接入该消费者，原始副作用回执与重进沿 Construction 和 Assistant。详见[统一模块合同](xiaok-integration-contract.md)。
- 测试索引 `5224f11330621383e9af4249159a74b5434de2b8`。97 个目标文件 ESLint 零错误。首次类型检查发现新增 `safeText` 未导入，已修正；顺带处理两条继承的应用源码类型错误。全量类型与构建随 I3 锁文件一并复验。证据为集成工作树 `tmp/i2-*.log` 与 `admin/tmp/r6/integration-i2-service-01/`。R6 使用测试托管替身和隔离服务，真实模型调用 0，保留 I1 的超时结果。

### I3 业务合流

- Public 的公开版本、历史消息投影与原生执行器沿同一模型网关和权限边界，保留 Bailian 工具、检索与托管资源清理。来源变化触发读回重验，重进及增量读回使用原消息序号和稳定请求键。小程序沿用两份还原台账所列 C01 和工地设计，使用存量方案与关闭回执组件。Markdown 从助手正文生成渲染节点，原消息事实留在服务端。实际冲突清单在集成工作树 `tmp/i3-conflict-hunks.json`。
- 设计核对、精确版本方案、施工回传、整改、复核与关闭从同一 Construction 事件投影读取。房间委托优先绑定已确定的唯一现场事项，仍待确认的设计需求保留独立状态。委托查询重读原指令和当前有权访问的事项。项目更新事务写入同一版本的 Outbox，后置触发器沿同一键去重并保留系统更新能力，原迁移 SQL 与 Journal 未改。

### 集成验收范围

I3 最终运行代码在文档更新前的树为 `6f7a1f035b976d98448dd41ee7fc9bf4029b722e`。受测源码、驱动和配置文件的暂存清单摘要为 `26a6409c738cea305f4916f7539697dd10e170acbec03e7aa18e201955536df0`，最终构建及隔离服务在固定源码下执行。早期测试保留各自的快照和结果。

| 层 | 集成结果 | 本地证据 |
| --- | --- | --- |
| 单元与客户端 | I3 定向单元 235/235，涉及网关、Assistant、Construction 和委托。定向小程序 85/85。全量小程序 2243/2244，唯一失败为测量 Phase 0 facade 的冻结调用清单。原 Public 基线复现同一遗漏 `surveying-editor-autosave.test.js`。 | `tmp/i3-units.log`、`tmp/i3-mini-*.log` |
| 服务与隔离 PG17 | Public/Construction 44/44，覆盖公开与本人项目切换、多轮和历史、撤回、原请求失败恢复、批准方案、整改和关闭。B5.9/B5.10 9/9，包括真实照片与语音回传、四角色状态、两 Admin HTTP 实例、角色及跨租户拒绝、原回执和撤权。R6 11/11，覆盖 PPT 授权工艺及撤回、私有偏好、委托、同源施工原件、Outbox 重试和查询回执重投影。R6 使用模型与托管替身。 | `tmp/i3-services-verified.log`、`tmp/i3-b59-verified.log`、`admin/tmp/r6/integration-i3-verified/report.json` |
| 持久化与日周报 | Native runtime 7/7。双 Admin revision、双 Worker 租约接管、事务失败回滚及运行存储从文件切换至 PG 并回退通过。两进程争用同一周槽只生成四个持久报告任务。另一隔离库用一条现场记录生成四种角色的日报及周报事实，每周期五份（两个企业管理者）。原跟进详情和历史可读，同周期重复投递为 0。 | `tmp/i3-runtime-verified.log`、`tmp/i3-report-delivery.log` |
| Stable DevTools | 官方 Stable 与 `miniprogram-automator 0.13.0`，390×844、基础库 3.17.2，单控制器在独立集成项目次屏。原咨询的授权照片、实际发送委托状态、即时读回与重进通过。已同意图纸及关闭回执原件通过。同版本的单独咨询验证 Markdown 标题、列表、原始正文和重进，模型替身。未完成范围包括四端完整界面、公开直播和真机。 | `tmp/i3-stable/r6-native-verified/verification.json`、`tmp/i3-stable/native-markdown/verification.json` 及同目录截图 |
| 配置模型 | I1 真实 Chat Completions 和 Responses 基础调用各通过一次。Responses 联网超时 unknown，未重放。原生联网、提取、代码执行和真实托管 RAG 缺本轮成功证据。I2、I3 实库及 Stable 使用替身或确定性流程。 | `tmp/i1-live-*.log`、`tmp/bailian-responses/` |
| 构建与部署 | Next.js 16.4.6 Webpack 生产构建与独立 TypeScript 通过。153 文件 ESLint 0 错误、25 警告。本地 standalone 连接隔离 PG 并返回健康状态，未认证请求返回 401。生产环境尚未发布或验收。 | `tmp/i3-webpack-verified.log`、`tmp/i3-type-verified.log`、`tmp/i3-lint-verified.log`、`tmp/i3-standalone-verification.json` |

早期 Stable 保留了实库写入成功而回执被旧权限投影隐藏的记录。补齐真实读取后，撤销与恢复项目授权通过；此前同一项目更新触发器与应用发出重复键的原失败保留。带图纸和关闭回执的 Stable 批次中 Markdown Worker 前置状态失败，后用与 R6 一致的配置和独立合成咨询完成渲染及重进。重复使用同一个已领周槽的 Native fixture 曾被前置校验拒绝，旧库保留，新隔离库重新执行通过。

交付检查确认 I3 合并提交的 Admin 和 Mini Program 源码与最终受测源码一致，迁移文件与 I2 一致。原 Public 工作树的未提交修改保留。测试结束后释放 Stable 控制器和集成窗口，清除本轮隔离库中的临时百炼配置并停止两台集成测试容器。测试卷和原始证据保留。

上线前需在获准环境核对实际迁移账本、配置和备份恢复，补足联网与托管实调及目标设备验收。生产发布仍需独立授权。

## I4 数据库兼容性

起点为 `5881f89f8c7205c593b8755aaa4252f56d73c8ab`。Fetch 后三条原始分支各有 0 条 Integration 之外的提交。独立 Integration 工作树起点干净，原 Public 工作树的测量清单改动保留。

隔离库复现两个基线失败。同一原消息含不同操作键的两条 Bailian 委托时，`0126` 在全表来源唯一约束处返回 `23505`。未知新时间戳的真实 DDL 及其 hash 让旧迁移命令跳过集成并报告成功。普通 Bailian 原库升级缺两个水电查询索引。原始日志在 `tmp/i4-i5-20261113/i4-baseline*.log`。

`0127` 兼容原 Bailian 同源委托，补足索引和统一触发器。空库及 Native 原库继续执行原 `0126`。完整 Bailian 原库走 `0127` 的兼容升级，已执行 `0126` 的库直接前进。原 SQL、已执行账本及委托的身份、来源、原事件、投递和未知状态保留。迁移入口锁定并检查完整账本及委托表形态；历史 hash 的差异必须在隔离快照中核对后才能升级。实际测试使用 PG17.10 的专用环回容器和合成数据，`sfp_migrator` 执行 DDL，`sfp_app` 执行读写和跨租户拒绝。执行入口、限制和回退见[集成合同](xiaok-integration-contract.md#数据迁移与回退)。

在 `b612ea0692acc5fac62ca8487029196bec7809cb` 执行 `admin/scripts/__tests__/xiaok-integration-migrations.test.mjs`，6/6 通过。三条路径分别用全新 PG17、原 Native SQL、原 Bailian SQL 初始化。附加用例包含没有 vector 扩展的 Bailian 同源记录、已执行 `0126` 的库及未知 hash 拒绝。逐字段核对 Native 10 种和 Bailian 11 种旧状态、原事件和原投递状态。核对 11 张表的强制 RLS 与应用角色权限、10 个索引及 4 个触发器。Native 升级后的快照恢复到同容器独立库，127 条账本、13 条委托、11 条事件、13 条投递和 1 条持久任务摘要全部匹配，跨租户读回 0 条。证据见 `tmp/i4-i5-20261113/i4-final.log`、`i4-binding.txt` 和 `i4-restore.json`。

## I5 业主原咨询与持久执行

Agent 在原咨询读取当前获权项目、阶段和房间，通过 `start_delegation` 登记跟进。登记在原咨询去重，整条指令只触发单项登记时可以采用已保存的登记回执。Native 使用同一委托主记录、Outbox 消费者和 PostgreSQL Durable Task 租约。Construction 沿正式业务服务处理设计师核对、施工原件、事项版本与管理者复核。Conversation 保存结果及原件授权，C01 重进重新投影。

I5 验收以 `b612ea0692acc5fac62ca8487029196bec7809cb` 为基线，测试前后应用源码、测试、迁移和小程序的 3502 个文件内容摘要均为 `41235c05009a6fff358cc6fbeee51056fd9bd48cb987b9f605b153e10f45840d`。定向后台测试及构建的工作树差异指纹为 `7237c324b59abd8eab1311e87e8bd89a9e590810`，新增 `delegation-execution.ts` 的 SHA-256 为 `4cf03a8c890f4fdac6dbb178ff635bc3942fd3d3dae9e5d73732f11dbef595b`。服务、模拟器和模型固定用例使用同一专用 PG17.10 容器的隔离合成库。`*.binding` 及原始报告在 `tmp/i4-i5-20261113/`。

提交可按 Git 子树核对。`admin/src` 为 `0391f1e082252bc20112b32463b1fe356ca5031d`，`admin/scripts` 为 `85d0bd17cd52a731594fd356fde28dbe9a4750cf`，`admin/drizzle` 为 `397b0b05e3e3409d407bdf454ea95425e849593e`，`miniprogram` 为 `21dad1fdd62127d9f91ccf976159ea6e0da2c850`。

| 层 | 状态与本轮证据 |
| --- | --- |
| 定向单元、客户端 | 通过。Native 和 Assistant 109/109，Construction 13/13，小程序 Chat、跟进与 Markdown 84/84。 |
| PostgreSQL 与多进程 | B5.9/B5.10 10/10，两个独立 Admin HTTP 进程、两个 Worker、进程被终止、已过期租约拒绝及重复事件均通过。重领后的尝试为 `timed_out → succeeded`，同一事件链接及消息各写入一次。B5.11 在新隔离库 7/7，先前复用已领取的周槽导致的失败保留。B5.8 水电及事件重试 9/9，历史实模续轮用例未运行。 |
| Agent、Construction 与权限 | 通过。`xiaok_r6_acceptance_i5delivery` R6 14/14，签名会话和真实 PostgreSQL 写入。同键重发、独立咨询、原项目/房间/阶段、团队角色和跨企业权限、设计师和工人撤权、事项旧版本及原咨询回传通过。原咨询 2 收到消息 43，关联事项 46、方案 52 和现场记录 3。语言模型、托管检索和图片整理使用替身，施工结论由获权角色经正式服务写入。证据 `admin/tmp/r6/integration-i5-delivery/`。 |
| Stable C01 | 通过。Stable 2.02.2608080、基础库 3.17.2、逻辑 390×844。从 C01 输入原业主需求，消息 7 发起 run 4，同键重发沿用原请求。使用相同的 14 项服务断言执行至获权团队回传，退到首页重进后读取原咨询 2 的结果 43 和原图。证据 `admin/tmp/r6/integration-i5-native-c01/native-owner-journey.json`。独立批 `stable-delivery/verification.json` 的查看委托、退出重进及撤回后回执失效 5/5。两批截图均为 363×785。 |
| 配置模型 | 百炼 Responses `qwen3.7-flash` 首批第 1 条在选中正确工具和房间后因跨咨询复用与终稿形态失败（run 11，`invalid_model_answer`），第 2 条未执行。两次已接受调用共输入 11040、输出 6436 token，其中缓存输入 5120。修复后固定卫生间和厨房两条用例 2/2（run 12、13），各 1 次调用，共输入 10743、输出 1882 token。两批货币用量均未知，分别保留 `i5-configured-model.json`、`i5-configured-model-verified.json` 和对应日志、绑定。 |
| 质量 | TypeScript、受影响 ESLint 和生产 Webpack 构建通过。完整 `postgresql-integration.test.ts` 61/62，唯一失败是继承的索引检查。相同 SQL 在升级前后均得到同一组 151 个缺索引列，见 `i5-postgresql-final.log` 与 `pg-index-baseline.json`。 |

原 R6 失败和环境前置结果保留在 `tmp/i4-i5-20261113/i5-r6-*.log`。合成 unknown 留在 `indeterminate`、预约待对账和零新增委托，原请求重发仍沿原 run。Stable 的输入时机、失效页面引用、项目路径和测试驱动失败保留在同目录 `stable-*.log`。模拟器使用临时签名及传输覆盖连接隔离服务，运行后恢复覆盖和项目配置原字节。地图服务缺配置使隔离环境定位支线返回 503。真机、BLE、真实微信登录、真实托管和联网以及生产环境未执行。历史 I1 unknown 请求保持原记录。

## I6 真实模型与获权知识验收（Limited）

起点为 fetch 后的 `origin/codex/xiaok-integration@accc750093973a8c79f799a2bd9cdb8c6f9e4794`。集成工作树独立，原 Public 工作树未提交修改保留。隔离 PG17.10/pgvector 使用 `sfp_app` 和合成微云 1454。独立 OpenSERP 0.8.17/Baidu 及配置模型使用开发凭据。托管预检在请求前返回 `bailian_knowledge_not_configured`，缺专用工作空间和 API Key。

### I6.1 联网与引用

| 检查 | 结果与证据 |
| --- | --- |
| 百炼原生工具 | `qwen3.7-flash` 的 Responses 同请求观察到搜索及提取，另一次真实代码解释器返回 1728。历史 I1 `PROVIDER_TIMEOUT` 仍为 unknown，未重放。提取回执中两个段落的来源顺序与 URL 列表相反，现按段内来源绑定，歧义段计为未归属。百炼工具输出为摘要，C01 引用使用应用读页原文。 |
| 应用搜索、读页及保存 | 在 `current-first` 和 `current-repair` 实际搜索并读到住建部公告。run 2 以同一会话打开持久引用，已核实来源网址、标题、读取时间及公告原句。首次业务失败 `unsupported_model_commitment`；修复版虽然保存，仍把旧公告的条文当作今天有效。run 3 追问时模型请求未开放工具，`assistant_capability_forbidden`，未执行该工具。 |
| 防水规范 | `workmanship-first` run 4 真实搜索。候选页未能读取，模型首稿在无来源时给出具体水深、时间及工序，终稿守卫拒绝。后续管根问题未执行。本批没有把第二次搜索命中或任何摘要计为条款证据。 |
| 重开及变更 | C01 完整历史及点开引用用原 reader 检查正文版本、撤除和网络故障，在 I/O 前后验证会话及快照。隔离数据库 7/7，含改页、其他客户和跨租户、历史清理及失败反馈。快速 Responses/网页测试 67/67。 |

原始首稿、唯一修复批和实际请求回执保存在集成工作树 `tmp/i6-20261113/web/`、`tmp/bailian-responses/report-i6-native-tools.json` 及对应 `raw/`。旧公告与后续废止公告的差异由人工对照确认，事后对照没有补入原运行 Evidence。停止对首问重复取样。现行性仍需能读到正式状态或更新文件，历史公告的上线日期和当时条文只能支持历史陈述。[GB 55032-2022 公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2024/art_17339_767714.html) · [GB 55038-2025 公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2025/art_66adac27fa2144bb86f98fe4c297efd6.html)

独立诊断复用了本机既有公开原文服务。两份住建部公告可读。防水规范附件超过当前下载上限，给排水规范附件返回 28 页但没有可提取文字。探针使用已运行的开发 reader，其源码 hash 与 Integration 文件不同。诊断原样保存为 `tmp/i6-20261113/public-reader-official-probe.json`，没有输入模型或加入企业库。[防水规范发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html) · [给排水规范发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2021/art_17339_762458.html)

应用批次 15 次已完成供应商调用，共 52,273 输入、3,776 输出 tokens，其中缓存输入 8,832。原生提取请求 `5d30658a-debe-9aef-9fb2-a80be46d25b2` 计 7,285/2,264 tokens，含缓存输入 1,920，报告 1 次搜索和 1 次提取。代码解释器 `d71cca44-25f2-9291-843a-498d7f117206` 计 824/166 tokens，执行 1 次。实际结算金额未返回。

### I6.2 本地企业知识与持续委托

- `integration-i6-local-final` 使用真实本地 Embedding/pgvector、同一 KnowledgeRetriever 和 PostgreSQL Durable Task。业主召回 PPT 第 18 页第 3、5 行，保留项目、版本、片段 hash 和定位。业主、设计师、工人、老板的实库查询各报告 28 输入 tokens。对照项目不返回此资料；跨租户和撤销成员权限受原服务约束。对话模型与故障注入是替身。
- 正式版本替换后旧引用和旧委托核对结果失效。下一个项目事件走原 Dispatcher 重新检索新版本，撤回后重新核对为 `no_match`。工人原图不使事项自动完成。授权人员核对后，正式结论和获准原图回原咨询。原请求重发、租约接管与故障恢复沿同一业务键。
- 企业知识关闭在检索前拒绝。开启而托管缺配置时返回 `retrieval_unavailable`，保留 `bailian_knowledge_not_configured` 且无请求 ID。配置缺口与有权限但查无结果有各自状态。托管请求为 0，仍为 Limited。
- 原始回执在 `admin/tmp/r6/integration-i6-local-final/`，含 `retrieval-scopes.json`、`version-recovery.json`、`formal-result.json`、`durable-steps.json` 和注入 unknown。PPT 仅写明项目团队安排防水施工和后续检查。材料、管根做法、验收阈值和铺砖放行条件没有获准企业原文，不能由相似检索或模型补成企业条款。

### I6.3–I6.5 固定自然对话

以 C01 的签名 HTTP 请求、原 Worker 和北京配置模型执行。公开资料用应用工具，企业资料用真实 Embedding/pgvector。首次测试把 PPT 片段绑在合成项目。B 首轮的模型显式选 `scope=enterprise`，按约定排除了项目文档。修复批按原题将同一已核 PPT 内容作为企业通用资料发布到新隔离库，项目范围仍由 I6.2 的独立对照保留。当前工具说明明确了省略范围的语义。C 修复只开放原业务查询的施工域，并将指定房间限制到唯一在施工项目及向业主发布的原记录。两批请求绑定无源码漂移。

| 固定场景 | 首批 | 一次定向复验 |
| --- | --- | --- |
| A 管根、防水、铺砖 | run 2–4。前两轮未查依据且把施工做法说得过于确定。第三轮引用了确实支持团队安排检查的 PPT 原文，但未给出可核查的铺砖放行条件。 | 未执行。企业资料没有这些条件。公开防水原文测试见 I6.1。 |
| B 企业做法与国家通用要求 | run 5 查询范围为空，首稿及唯一修复仍补了无据高度和闭水时长，拒绝保存。第二问未执行。 | run 3 引用 PPT 第 18 页，保留具体参数缺项。run 4 仅检索企业来源，未完成公开标准原文核读，首稿及修复仍被拦截。 |
| C 真实水电和主卧进度 | run 6–7 返回固定现场引导，未使用已发布事实。 | run 5–6 读取项目实际水电节点与主卧待核对记录，排除厨房完工对照。两条首稿后的结构/来源修复均保留。房间记录撤回后旧派生答复不可用在隔离服务复核。 |
| D 插座设计协作 | run 8 使用现场团队引导；没有根据该咨询的正式图纸版本给出解释。run 9 按业主明确请求创建主卧插座委托，返回登记回执并等候获权协作。 | 未追加实模。真实 Construction 精确版本与原咨询回传单独通过。 |
| E 房间更正 | run 10 的无据工艺答复被拦，纠正问未执行。 | run 7 保存一般建议；run 8 的查询已转为卫生间，首稿仍重问且补无据高度，唯一修复仍补无据高度，终稿失败。该更正轮没有写长期记忆。 |
| 私有偏好 | run 11–12 保存本人沟通偏好，新咨询正确读回“先告诉我结论，再说细节”。 | 复用首批证据。 |

首批 18 次供应商调用，84,349 输入、16,168 输出、8,960 缓存输入 tokens，检索 Embedding 105 输入 tokens。修复批 19 次供应商调用，93,564 输入、12,974 输出、0 缓存输入 tokens，检索 Embedding 164 输入 tokens。实际结算金额不可得。源首稿、每轮唯一修复、请求 ID、工具输入和实测用量分别保存在 `admin/tmp/r6/integration-i6-live-configured/` 和 `admin/tmp/r6/integration-i6-live-repair/` 的 `turn-*.json`。早期配置试跑本地密钥不可解密，未发供应商请求。B 对比及 E 缺少支持工艺量数的适用原文，停止重复采样。模型能力和代表请求见[模型矩阵](bailian-responses-adapter.md#14-i6-模型能力矩阵)。

### I6.6 业务回传与工程检查

- 通过。最终隔离 R6 批 `integration-i6-project-status-final` 16/16，含真实 Embedding、房间记录过滤、撤回后历史隐藏、阶段记录与房间记录独立、四角色及原咨询正式回传。业务链使用替身模型。受影响 Assistant、Responses、RAG 与 Native 快速测试 219/219，小程序最终定向 341/341，Construction 设计核对、施工计划/整改及自然语言正式方案合计 21/21，网页实库 7/7。专业 RAG 实库 11/11，包含阶段适用条件、阶段变化、检索中途撤回。项目资料 10 通过、1 跳过。TypeScript、受影响 ESLint 与生产 Webpack 构建通过。
- 失败。较广 Assistant 批 1033/1034，失败的「书桌收纳」测试及其实现与基线相同。历史资料及专业检索夹具默认关闭知识，首次失败后显式开启测试企业开关并保留原日志。混合现场测试改用现行 RAG 工具，继续断言现场分流后不能再读档。正式方案夹具改用已有隔离端口参数，仍只准环回 `xiaok_embedding_eval`。夹具调整没有改运行时。证据 `tmp/i6-20261113/{materials-final,professional-knowledge-final,isolated-professional-construction}.log`。
- Stable C01。逻辑 390×844，截图 363×785。通过实际点击打开配置模型保存的 PPT 引用及独立联网批已保存的住建部历史公告引用，显示原句、网址和读取时间。另在同一获权咨询实际发送两条项目进度追问，并退出后读到同两条答复；此批 Worker 使用替身模型和真实 Construction 读取。原咨询 2 中的真实复核结果 43、授权原图和实际发送的委托状态回执 64 均在重进后可读。固定 A–E 的实模连续界面未执行。前序夹具、输入和轮询驱动失败保留。证据 `tmp/i6-20261113/{stable-citations-final,stable-delegation-final,stable-web-citation}/verification.json`。
- unknown。I1 供应商超时原回执保持待对账。R6 故障注入的未知状态单列，未重放原请求，也未当作真实供应商调用。
- 环境阻塞。百炼托管库缺专用配置。
- 未执行。真机、真实微信登录、BLE、额外资料试验模型及生产部署。

## I6.7 专业规范证据链（Limited）

### I6.7.1 附件读取与逐页覆盖

- 集成基线 `ab0a018e93ba37ac367ed8f8ee503d17dbef489d` 与抓取后远端一致。使用已有集成工作树。住建部防水附件 5,659,379 字节，三个 ETag 绑定分段，原件 SHA-256 `aabd71d70809673a4009fcdbcfc0c759f3a22b1c3566f8022dfea9a7a529dc80`。给排水附件 3,978,385 字节，SHA-256 `d84b943144c51db7bbc8029493a39fe6a98358e81f19d5480da9f2459cea0112`。新版 reader 对原件的 40 页及 28 页均识别为需要 OCR。目视核对发现 selectable 层只有重复的浏览水印，条文存在于扫描图。原件、页覆盖、失败和读页源码绑定保存在集成工作树 `tmp/i6.7/`。[防水发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html) · [给排水发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2021/art_17339_762458.html)
- 58/58 定向 TypeScript 单测及 3/3 Python 检查，覆盖原文范围、扫描状态、分段版本失败、DOCX 与本地 PDF 解析。首次测试发现旧样例期待空页进入 Evidence，保留原测试结果。空页保留在私有原件，引用目录只收可读文字。扫描条文的获权回读与固定场景验收继续进行。

### I6.7.2–I6.7.5 依据、原话和项目权限

- 防水附件按真实扫描页核对六页摘录。PDF 第 5、27、28、31、36、37 页覆盖工程范围、开工前基层核对、预埋、下一工序、管根与室内试验。由源站、路径、原件字节 SHA-256、页码和摘录哈希约束。发布公告支持发布日期与实施日期及指定旧条文废止；独立目录列该版为现行。C01 每次复验同一 PDF 时只下载一次再检查各页。未复核的扫描页及给排水附件的全部扫描页仍为 `pdf_ocr_required`。原件与对照在 `tmp/i6.7/{standard-readback,attachments-reader-receipt,ocr-diagnostic}.json`。[GB 55030-2022 发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html) · [同版状态目录](https://ebook.chinabuilding.com.cn/zbooklib/book/detail/show?SiteID=1&bookID=154718)
- 实库合成微云与对照租户验证本地 Embedding/pgvector、PPT 通用和项目受众、实时成员权限、版本替换、停用、撤回、历史失效、项目与房间隔离、委托幂等和团队原咨询回传。原知识资料只取 PPT 第 18 页获权工艺。R6 工程回归用替身对话模型，16/16，包括主卧实际记录及撤回后原答隐藏。补充专业检索和网页实库 18/18，Construction 15/15。初次 Construction 夹具缺设计师、工人角色菜单而返回 403，修正隔离夹具后通过。托管预检记录 `retrieval_unavailable` / `bailian_knowledge_not_configured`，请求 ID 为空，托管请求 0。证据 `admin/tmp/r6/integration-i67-{rooms-rag-native,hosted-result}/` 与 `tmp/i6.7/{isolated-services,construction-recheck}.log`。
- Stable 原 C01 在次屏的 390×844、基础库 3.17.2，打开保存的真实模型回答并点击第 31 页引用。引用弹层显示章节、逐字原句、读取时间与公开 URL，截图为 363×785。切断本次引用的 reader 得到现有不可读反馈，恢复后退出重进可开同一引用。前序模拟器的定位覆盖导致刷新清空弹层，独立驱动屏蔽隔离环境的定位请求后完成，覆盖已恢复。图中很长的网址沿既有样式显示，完整 URL 保留在接口。证据 `tmp/i6.7/stable-c01-verified/verification.json` 与同目录截图。小程序未改 UI 代码。真机、真实微信授权与 BLE 未验。

### I6.7.6 固定真实对话与停止点

每次新增实模请求都用北京百炼 `bailian`，逻辑名 `deepseek-flash`，供应商响应实际为 `deepseek-v4.1-flash-1017`。应用联网与供应商原生工具分别记账。成功的 API 回执也可能对应被应用拒绝的答复。固定提问和预期、首稿及唯一修复、实际工具、原始 Evidence、最终状态、请求 ID 和用量在 `admin/tmp/r6/integration-i67-*/{fixed-conversations,turn-*,report}.json`。协议能力及费用边界见[百炼 I6.7](bailian-responses-adapter.md#15-i67-起的实模开发与验收)。历史 Qwen 结果和 I1 unknown 保留，未重放。

| 场景 | 结果和依据 |
| --- | --- |
| A 管根、防水、铺砖 | 首批三问完成写入但依据不足。引入正式原文后首轮在模型前超限（0 请求）。压缩来源后，真实模型保存第 31 页管根引用，首轮重进断言受分段复核时限影响。合并读原件后实库及 Stable 重开通过。用原咨询继续后两问，均保存并重进。第二问虽读到基层验收和预埋原文，最终只返回现场确认引导，未通过。第三问的唯一修复引用第 28 页 5.1.12，回答防水层验收后才能进入铺砖，同时区分未取得的项目放行状态。原咨询的技术问答整体仍 Limited。证据 `integration-i67-a-continuation/`。 |
| B 企业与公开标准对比 | 首批把历史 JGJ 公告的已废止条文说成仍须执行。增加原件、状态和企业必读后，最近一轮已取得 PPT 和公开原文；首稿及唯一修复仍因无据量数被拒，未形成通过终稿。 |
| C 状态、日期及适用范围 | 发布公告、目录现行状态及 PDF 原文进入同轮。一次诊断批有源码漂移，仅保留原请求及失败。后续走同版三份来源，首稿和唯一修复仍带额外未请求的工序和参数，最终被拒。离线回放区分状态否定被误判与实际无据量数，后者仍拒绝。未通过旧房适用性的整答验收。 |
| D 厨房更正卫生间 | 厨房首问先后发生引用、请求超限和无据施工条件失败，最后一次首稿及修复仍失败。按停止规则保留失败，更正轮未执行。 |
| E 主卧项目实况 | 独立实模询问走原 `query_business`，只读主卧已发布记录并返回水管根部待核对，重进通过。厨房完工记录未进入答复，委托写入 0。D→E 同一会话尚未完成。 |
| F 企业参数缺项 | 实模引用 PPT，明确本次资料未写卫生间闭水时长和防水涂刷高度，未给企业数值，重进及零委托通过。 |
| 私有沟通偏好 | 首次拒绝缺 `topic` 的模型参数，没有保存。将原工具的独立偏好写入契约收紧为必填主题、类别和原话后，实模保存成功，新咨询读回先结论后细节。 |

后继判据是用保存稿分辨条款用途、分段出处与项目适用性。B、C、D 的同类试错停止；一般提示改写或重复采样不能充当新机制。A 的第二问需检查已有条文时，现场确认分流为何把公开工艺解释整段替换掉。企业资料边界、项目权限和业务回执仍由现有服务验证。

实模对话请求共 52 次，Responses 37 次、Chat Completions 15 次，338,307 输入、24,210 输出、126,976 缓存输入 tokens，均有请求 ID 与实际模型。含一次漂移批的 2 个请求与所有应用拒绝结果。单列的 6 次协议探测使用 21,903 输入、1,439 输出、11,520 缓存输入 tokens。两组实际结算金额均不可得。本轮实模无供应商 unknown。租约恢复中的未知结果是明确注入的工程回归，历史 I1 unknown 独立保留。

### I6.7.7 工程检查

- Assistant 较广离线检查 1,038/1,039，唯一失败仍是已记录的「书桌收纳」意图，保留 I6 的 1,033/1,034 历史记录。小程序 Assistant/Construction 341/341。原始日志在 `tmp/i6.7/{assistant-release,miniprogram-tests}.log`。
- 最终定向 Assistant 与协议 89/89、公开读取 32/32，二者有交集；Python reader 3/3。覆盖 PDF/DOCX、发现与网页读取、原文、引用、冲突与无据量数。计划检查、TypeScript、定向 ESLint 与生产 Webpack 构建通过，静态生成 115 页。源码绑定 `tmp/i6.7/release-source.json`，日志 `{focused-final,public-final,python-reader-direct,eslint-branch,webpack-final}.log`。实库、实模和模拟器结果以各自源码绑定为准。
- 隔离测试结束后清理临时百炼加密覆盖、停止测试数据库与新增读页/搜索进程。关闭本轮打开的次屏项目，原窗口和原小程序私有配置保留。测试卷与原始回执保留。

## I6.10 防水专业 Agent 可信度与现场资料（Limited）

从 `origin/codex/xiaok-integration` 的 `682bcbf1e81fb554cf008c542478029978fe7f31` 开始。主工作区其他分支和未提交的测绘文件保持原样。隔离环境为微云 1454、PG17/pgvector、受限应用角色及指定 Stable 项目。源码、配置、执行器、原始首稿、唯一修复及请求逐条保存在对应批次，回执按各自绑定使用。

- **专业对话。** `dialogue-01` 两轮 16 问保存 5 个答复，7 个承诺校验和 4 个企业检索错误。调整后 `dialogue-02` 两轮 18 问保存 10 个，4 个承诺、2 个作用域及 2 个 `source_read_required`。两轮同版现行性及翻修条文均保存。保存稿回放 120、128、132 的原公开规范段落通过，共 28 段，独立项目验收与无据量数测试仍拒绝。后续限定 `dialogue-read-01` 两轮 8 问保存 5 个，企业原文与主卧实际读取分别 2/2，国标原文 1/2，两个更正终稿仍被拒绝。国标原文已由公网分派，后一轮失败发生于终稿承诺校验。停止相同开工和更正场景的措辞补丁循环。工程状态可从原回执读取，部分清单分析正文仍误述未登记或无法跟进。
- **规范原件。** I6.9 Reader 日志在防水原件分段下载超时。I6.10 保存同一原件 SHA-256，首次获取在同一时限内验证各段 ETag、Range、长度和顺序。C01 已存原件先核验私有检查点，再对源站与原公告链接重新核验。真实打开 `w:124:1`，PDF 第 27 页和原引文一致。隔离错误注入验证超时、撤回、替换及拒绝的具体码，恢复真实 Reader 后同引用可重开。GB 55030-2022 沿用第 5、27、28、31、36、37 页。GB 55020-2021 的原件和同版目录实读通过，28 页完成 OCR，逐图核对第 12、24、25 页的有限摘录进入 Evidence，其余 25 页保留待核。证据 `tmp/i6.10/pdf-read-01.json`、`reader-baseline.json`、`plumbing-ocr-unreviewed.json` 与对应原图。[防水公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html) · [给排水公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2021/art_17339_762458.html)
- **隔离实库分支。** `workflow-checklist-02` 的 C01 `56` 从公开依据保存清单、等待并释放租约，事项 `301` 经项目经理授权回传消息 `225`。初次 `workflow-checklist-01` 的依据结构失败保留。 `workflow-material-01` 的 C01 `67` 在托管检索未配置时记录不可用，仍保存公开依据回答，经补资料进入事项 `374` 并回传消息 `273`。两条均验证普通记录、错房间、重复事件、非经理及同业主其他咨询的边界，发布新版本后保持旧绑定。 `workflow-direct-01` 的分析 `139` 保留承诺失败，`workflow-direct-02` 的 C01 `77` 以同房间获权待核对记录直接创建唯一事项 `448`，随后原咨询取消并终止等待任务。正式经理回传由另外两条完成分支验证。历史 v1/v5/v6/v8/v9 保留原证据。
- **图像与 Stable。** 北京目录精确命中实际 ID，Responses 与 Chat Completions 都读出合成探针。产品 `vision-01` 首稿错误混用字段，已留存。 `vision-02` runs `141–143` 依次读同房间获权施工图、用户上传图和后续追问。真实保存圆形/弧线观察，排除错房间与内部照片，撤回施工图后旧答复不可用且媒体返回 404。Stable 390×844 / SDK 3.17.2 实际发送状态查询、重进原 C01、读同一经理结果和原件、点击公开引用、查看照片观察与撤回。合成图像适用于验证可见特征及权限。实体工地材质和物理验收、真机、BLE、真实微信授权及生产仍未验。证据 `tmp/i6.10/stable-02/verification.json` 及截图。
- **工程检查。** 带登录态 Chromium 画布 13 节点、32 条线，依据节点类型化端口和草稿校验通过。真实运行查询 200，未登录 401。Native Workflow PostgreSQL 独立空库迁移后 7/7，Python Reader 4/4，定向 Agent、Specialist 与 Native Workflow 共 1,548 项，1,520 通过、27 项环境跳过，保留 1 项书桌收纳意图基线。Mini 2,243/2,244，保留测绘 Phase 0 基线。TypeScript、定向 ESLint、Webpack 115 页与计划自测通过。证据 `tmp/i6.10/{admin-canvas-01.json,postgres-01.log,reader-unit-02.log,admin-regression-02.log,miniprogram-01.log,lint-final.log,webpack-02.log}`。

| 有实际用量的批次 | Responses / Chat Completions | 输入 / 输出 / 缓存输入 tokens |
| --- | --- | --- |
| 双协议图像探针 | 1 / 1 | 476 / 237 / 0 |
| 清单初次及完成 | 2 / 1 | 5,181 / 1,088 / 768 |
| 补资料 | 1 / 1 | 4,179 / 1,182 / 768 |
| 直达事项初次及取消 | 2 / 4 | 12,649 / 1,863 / 6,656 |
| 图像首稿及产品复验 | 1 / 3 | 5,984 / 1,501 / 512 |
| 两个对话全批 | 7 / 52 | 155,961 / 22,946 / 80,384 |
| 两条读取限定复验 | 2 / 13 | 28,567 / 3,923 / 12,800 |

真实调用仅使用 `bailian`、`deepseek-flash` / `deepseek-v4.1-flash-1017`。请求 ID、协议、实际模型及 token 见 `tmp/i6.10/{bailian-vision-wire,model-receipts-index}.json`，实际费用未知。历史未明调用保留原状态。验收后恢复隔离模型覆盖和图片设置，关闭本轮 Stable 窗口、Admin、Reader 与数据库进程，保留隔离数据与回执。[百炼能力与回执](bailian-responses-adapter.md#17-i610-北京百炼图像输入)

## I6.9 防水专业 Agent 闭环（Limited）

起点为 fetch 后的 `0892909ae1c4`，工作树已有的 X6 改动在开发期间进入远端 `deaf1429`。使用独立 Integration 工作树、微云 1454 的合成隔离库及受限 `sfp_app`。百炼实际目录返回 `deepseek-v4.1-flash-1017`，专业 Agent 逻辑名 `deepseek-flash`，凭据沿原加密配置和用量台账。目录回执 `tmp/i6.9/bailian-catalog.json`。

- **真实对话**。配置修正前的 run 114 失败，4 次 Chat Completions，9,955 输入、1,378 输出、5,376 缓存输入。修正 reader 与隔离检索配置后，两轮 16 个原问题中 10 个保存了答复。两次主卧进度、更正、缺资料和企业 PPT 清单均有已保存回执。115、117、118、125、126 为 `unsupported_model_commitment`，127 为 `standard_status_unverified`。例如 117 的两稿都把规范规定的基层验收前提写在现场咨询中，保存层仍拒绝该表述。保留原首稿、唯一修复、工具与失败码。33 次 Chat Completions，90,332 输入、20,774 输出、44,544 缓存输入，成本未知。见 `tmp/i6.9/dialogue-01/` 和 `dialogue-02/`，各批次以自己的源码绑定为准。
- **编辑与真实执行**。Chrome 从 X6 面板拖入 Agent，完成错误定位、类型化端口及配置验证、草稿保存、v5 发布和三路模拟，显示 v1 与 v5 的真实运行。v5 同时要求企业与公开依据，实际按项目范围、topK=1 和 14 天等待进入补资料。v5 Run 等待期间发布 v6，下一条 Run 绑定 v6；发布 v7 后原 v6 仍完成。两个实模闭环分别关联 C01/事项 `61/328` 与 `64/368`，复核版本均为 2。错房间、普通现场记录、重复回调以及非经理复核均已验证。两次等待无 Worker 租约，原咨询以外的会话无复核回执。v5 用量 3,714 输入、1,574 输出、256 缓存输入。v6 按 Responses 优先设置，4 次 Responses 和 1 次 Chat Completions，13,372 输入、2,507 输出、5,120 缓存输入。终稿仍沿适配器已验证的工具载体。v5 首稿仍混入无法持续跟进的说法，原已登记委托和正式回传单独保留。另以 v8 验证关闭配置，会话 `67` 的事项 `432` 在解决后保持等待，关闭才回传消息 `304`，复核版本 3。该轮 1 次 Responses 和 1 次 Chat Completions，3,716 输入、1,155 输出、768 缓存输入。v9 会话 `70` 在分析前已有合规现场记录，直接登记事项 `466` 并进入复核等待。原咨询取消后等待任务终止，回放只有一个正式事项。3 次 Responses，7,475 输入、1,444 输出、5,632 缓存输入。证据为 `browser-edit.log`、`browser-retest-03.log`、`browser-debug-09.log`、`workflow-01/` 至 `workflow-03/` 和 `direct-01/`。
- **权限与恢复**。隔离复核消息丢失后由原 Outbox `383` 重建消息 `274`，重复读取仍只有一条投影。房间变更、客户授权撤回、施工人员和经理撤权时停止返回原结果。平台调试用其他租户或非平台人员请求被拒。PostgreSQL 真实套件 7/7，包括双 Worker 抢占、租约到期、进程重启、未知结果与对账。知识版本及撤回由定向证据和 RAG 测试验证，当前活跃注册仍为 Agent v1。证据为 `recovery-02/`、`postgres-01.log` 和 `assistant-01.log`。
- **Stable**。精确 Integration 项目，SDK 3.17.2，逻辑窗口 390×844。原 C01 会话 `64` 退出重进读到 v6 同一 Run、事项 `368` 和消息 `270`。真实输入后点按发送查询，签名 API 返回 202 并读回状态。独立的同版自然对话 C01 `52` 打开企业 PPT 第 18 页第 3 行。原 C01 `54` 的公开 PDF 引用真实点击到达 API，因原件超时返回 `source_unreadable`。证据为 `stable-01/verification.json` 与 `stable-02/verification.json`，均保留原结果。
- **回归**。定向 Native Workflow 和 Specialist 481/481，Assistant、RAG、Responses 1,082/1,083，保留 `need-write-intent.test.ts` 普通询问预期失败。小程序 2,243/2,244，保留测绘 Phase 0 审计的基线差异。TypeScript、定向 ESLint、生产 Webpack 和计划检查通过。文本模型未读取照片像素。公开 PDF 重新可读与同版现行性、稳定的专业答复、有据清单分支的真实运行、Agent 新版本切换和物理设备仍需验证。有据清单由模拟和证据测试覆盖，注册测试覆盖候选及停用版本。

## I6.8 防水专业 Agent 与工作流（Limited）

从 `59bf257e` 的 Integration 工作树推进。通过既有 LangGraph、Evidence、Construction、Native Definition Store、PostgreSQL Runtime 与委托 Outbox 实现防水纵向流程。其余五个注册为 `draft`。画布沿原管理端草稿、模拟和发布，新增 X6 端口编辑和获权运行调试。未做生产发布。[节点及权限合同](xiaok-waterproof-workflow.md)。

| 验收 | 本轮结果 |
| --- | --- |
| A/B 防水咨询与追问 | 固定两轮中管根、前置基层核对、铺砖前验收均保存。管根引用实际第 31 页，基层与后工序读取第 27/28 页。原 A 在现场引导处提前结束，修复后普通解释不进入该分流。第 70、71、75、76 轮原稿被承诺守卫误拒；用保存稿复现并仅在同段已引规范明确支持时区分技术前提和实际完成。保留仍有条款顺序外推、回答偏长的原文。 |
| C 企业标准及国标对照 | 两轮均引用获权 PPT 第 18 页及实际 PDF。PPT 只说明团队安排施工与后续检查，无企业量数或放行条件。旧稿将正文元数据日期混入技术解释，现模型技术视图只带实际相关条文。 |
| I6.7 C 同版状态及翻修适用 | 公告实读证明实施日期，目录实读证明同版状态，PDF 第 5、31 页区分总则与室内装修改造。最后两次有一轮保存、一轮 `standard_status_unverified`，保留原稿及唯一修复。保存稿仍有概括过宽，整项 Limited。 |
| D 最新房间及项目实况 | 两轮厨房→卫生间更正和进度均保存。Construction 回执为唯一实际项目的「水电」节点，没有该房间已发布记录时明确缺项，不将计划写成完成。 |
| E/F/G 现场闭环 | 隔离库原咨询 `41`、事项 `200`、结果 `156`。Run `specialist:0bdb4820-5d53-4b31-82f3-9c961f3256e8` 在已发布 v1 等照片，发布 v2 后仍以 v1 推进。错误房间和重复投递不建第二事项，无项目人员与施工员无权确认。施工员另行回传记录 `5`，负责人实际复核并授权回传原件。签名 API 与 Stable C01 退出重进均读到同一 Run、v1、结果及授权原件；同业主另一咨询读不到结果。模型未读取照片像素，E 的可见现象识别未通过；分析消息 138 将清单作业误述为不能继续跟进，实际委托仍按事件运行。 |
| 管理端可视化 | Edge Playwright 实测 10 个节点和 20 条控制/数据线，拒绝 object 接入 boolean，拖回兼容端口并检查缺失输入校验。保存 r3、发布 v3，两个模拟分别完成和等待，真实运行按 v1 画布展示 Agent、用量、来源与恢复记录。未登录、无企业、员工、他企业分别得到 401/409/403/404，获权平台管理员读到真实运行。 |
| 工程验证 | 192 项定向 Agent/Native 检查通过，105 项 C01/工地客户端定向通过，PDF reader 3 项通过。完整小程序套件 2243/2244，剩余测绘 Phase 0 调用清单基线，未修改测绘。TypeScript、定向 ESLint 与生产 Webpack 构建通过。 |

对话最后固定批为 `admin/tmp/r6/integration-i68-dialogue-05`。双端源码指纹一致，17/18 轮落盘，25 次百炼响应，Responses 2 次、Chat Completions 23 次，53,545 输入、8,124 输出 tokens。现场闭环 `admin/tmp/r6/integration-i68-workflow-06`，登记和清单作业共 2 次，Responses 与 Chat Completions 各 1 次，3,511 输入、872 输出 tokens。两批实际价格未回传。所有实模实际 ID 均为 `deepseek-v4.1-flash-1017`。终稿保留既有已验证载体，工具轮满足已有 Responses 合同时优先使用。Stable 证据位于 `tmp/i6.8/stable-workflow-04/verification.json`，回到原咨询与下载原件通过，额外的原生状态发送未到达 API，批次保留失败状态。管理端证据位于 `tmp/i6.8` 的 `admin-playwright-ports.log`、`admin-playwright-live-final.log` 及 `admin-api-check.json`。目录响应、原稿、失败、未知和实际用量保留在各批次。真机、BLE、真实微信登录和生产均未验。
