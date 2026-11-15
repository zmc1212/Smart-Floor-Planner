# 小K 开发环境统一体检（I7.5.3）

`xiaok:env:check` 是家客来（小K）开发、验收和排障的统一环境入口。它只读取运行时、配置和数据库元数据，用于回答“这台机器现在能做什么、缺什么、下一步执行什么命令”，而不是替代业务验收。

I7.5.3 起明确拆开三个数据库环境：开发库、独立隔离库、生产环境。开发库的 PG17 结果不再冒充隔离库通过；生产环境只识别配置，不建立连接。

## 命令

```powershell
cd admin
npm run xiaok:env:check
npm run xiaok:env:check -- --output ../tmp/xiaok-env-check.json
npm run xiaok:env:check -- --require development,isolated-pg17,model,worker
```

- 默认把 JSON 报告写到 stdout；`--output` 额外落盘。
- `--require` 指定必须为 `passed` 的环境级别。任一必需级别不是 `passed` 时退出码为 `2`，便于验收脚本前置门禁。
- 退出码：未指定 `--require` 时，`0` 表示无 `failed` 项、`2` 表示存在 `failed`；指定 `--require` 时，只按必需级别判定，全部 `passed` 为 `0`，否则为 `2`。`1` 表示执行错误。
- 后续验收脚本应调用本命令（或从 `scripts/xiaok-env-check.ts` 导入 `runEnvironmentCheck`），不要在脚本内重复实现 Node、PG17、模型、知识库和 Worker 检测。
- `admin/.env.example` 已提供注释形式的 `XIAOK_ISOLATED_DATABASE_URL` 示例；本命令不会创建 `.env.local`、不会创建数据库，也不会修改现有配置。

## 三个数据库环境

| 环境 | 连接来源 | 行为 |
| --- | --- | --- |
| DEVELOPMENT | `DATABASE_URL` | 实际连接开发库，检查数据库名称/版本、连接账号与权限、只读事务、FORCE RLS、迁移账本和连接失败原因。Worker 心跳与队列也只代表这个环境。 |
| ISOLATED | `XIAOK_ISOLATED_DATABASE_URL` | 仅在显式配置时实际连接独立隔离库，检查同一组项目。未配置时 `isolated-pg17` 必须为 `not_run`，不会复用 `DATABASE_URL` 的结果，也不会自动创建数据库。 |
| PRODUCTION | `admin/.env.production` 的 `DATABASE_URL` | 只解析目标 `host` / `database` / 凭据是否存在，不连接、不执行 SQL、不修改。报告 `production.connection=not_run`。 |

报告新增 `targets` 字段，分别给出 `development`、`isolated`、`production` 的来源、是否配置、是否连接、host、database 和 role。凭据值不会输出。

隔离库还会执行 `isolated-pg17.independence`：如果 `XIAOK_ISOLATED_DATABASE_URL` 与 `DATABASE_URL` 指向同一 `host/port/database`，该检查失败，避免“配置了隔离变量但实际仍是开发库”。

## 环境级别

| 级别 | 检查内容 |
| --- | --- |
| `development` | Node/npm 版本、`admin/node_modules` 与关键依赖、项目版本/锁文件、`.env.local` 与必要/可选变量；`DATABASE_URL` 的数据库名称/版本、账号权限、只读事务、RLS、迁移账本 |
| `isolated-pg17` | 仅使用 `XIAOK_ISOLATED_DATABASE_URL` 的数据库名称/版本、账号权限、只读事务、RLS、迁移账本、与开发库的独立性；未配置时整级 `not_run` |
| `model` | 官方百炼（`dashscope.aliyuncs.com/compatible-mode`）供应商是否启用并保存 Key、是否配置 `deepseek-v4.1-flash-1017` 映射或企业绑定；真实模型调用固定为 `not_run` |
| `knowledge` | Embedding 配置（百炼托管或本地网关）、知识库供应商与工作区、知识库表/pgvector；真实检索固定为 `not_run` |
| `worker` | `CRON_SECRET`、Worker 端点、健康文件心跳、开发库任务队列积压/失败计数；所有条目明确标记 `environment=development`，不读取隔离库或生产队列 |
| `production` | `.env.production` 的数据库目标识别、生产变量名清单、`production.connection=not_run`、部署与生产 Worker 明确 `not_run` |

每项输出 `passed` / `failed` / `limited` / `not_run`，以及 `actual`、失败原因、修复命令和复验方法。级别状态取该级别最严重状态：有 `failed` 即 `failed`，否则有 `limited` 即 `limited`，否则有 `passed` 即 `passed`，全部 `not_run` 才为 `not_run`。

## 安全边界

本命令明确不会：

- 重建、删除、初始化或创建开发库/隔离库；
- 执行迁移（只读取迁移账本和迁移文件）；
- 创建、覆盖 `.env` 或修改现有配置；
- 更换模型供应商；
- 发起真实模型、Embedding 或知识库请求（因此不产生调用费用）；
- 写入业务数据、修改真实企业 1454；
- 启动 Worker、处理队列、重试失败任务、删除任务或发送通知；
- 连接生产数据库、部署生产或启动/修改生产 Worker。

开发库连接使用 `default_transaction_read_only=on` 并在结束时回滚。开发队列统计在只读事务内设置本地平台范围，仅输出聚合计数，不输出任何企业或任务明细。隔离库连接同样只读；生产环境完全不建立连接。

## 脱敏

报告中的 `variables` 只包含 `set` / `missing`；`targets` 只输出 host、database、role 和布尔状态。不输出 `DATABASE_URL`、`XIAOK_ISOLATED_DATABASE_URL`、密码、API Key、连接 URI、加密字段或企业业务数据。错误文本统一经过 `redactSecrets`，会把 `postgresql://...`、`Bearer ...`、`sk-...` 以及 `api_key/password/secret/token=...` 替换为 `[redacted]`。

## 当前真实结果（2026-11-16 Asia/Shanghai）

基线 `codex/xiaok-integration` / `28a1a549`。真实执行：

```powershell
cd admin
npm run xiaok:env:check -- --output ../tmp/xiaok-i753-env-check.json
```

汇总：**19 passed / 5 failed / 1 limited / 7 not_run（32 项）**，`overall=failed`。这是真实缺项，不是 Mock 通过。

| 环境/级别 | 状态 | 实际结果 |
| --- | --- | --- |
| `development` | failed | Node `v24.9.0`、npm `11.6.0`、依赖 `7/7`、`.env.local` 与变量齐全；`DATABASE_URL` 目标 `smart_floor_planner`（role `sfp_app`）连接、PG17、账号权限、只读事务、7 张核心表 FORCE RLS 均通过；迁移账本 119 条，**9 条待执行**，故整级 failed |
| `isolated-pg17` | not_run | **未配置 `XIAOK_ISOLATED_DATABASE_URL`**；连接与独立性均为 `not_run`，没有使用开发库的 PG17 结果冒充通过 |
| `model` | failed | 官方百炼供应商已启用且有 Key；但只配置了 `qwen3.7-flash`，**未找到 `deepseek-v4.1-flash-1017` 映射或企业绑定** |
| `knowledge` | failed | 知识库表与 pgvector 存在；默认百炼模式缺少 `ASSISTANT_BAILIAN_RAG_WORKSPACE_ID` / `ASSISTANT_BAILIAN_RAG_API_KEY`；本地 Embedding 变量虽存在，但当前模式为 `bailian` |
| `worker` | failed | 明确标记 `environment=development,database=smart_floor_planner`；心跳 `stale`（约 85,000 秒前）；队列 `queued=31,running=2,failed=404`，最早排队约 274,000 秒 |
| `production` | limited | `.env.production` 可识别：`host=localhost,database=smart_floor_planner,credentials=set`；因指向本机地址，判定为模板/开发库风险，`production.config=limited`；生产变量清单 37 个键齐全；`production.connection=not_run`，未连接生产 |

待执行开发库迁移：`0120_construction_camera_sd_identity_version`、`0124_assistant_knowledge_integration`、`0125_native_workflow_runtime_integration`、`0126_native_workflow_delegation_integration`、`0127_native_workflow_delegation_compatibility`、`0128_xiaok_v1_stage_reminders`、`0129_xiaok_v1_stage_reminder_receipts`、`0130_xiaok_pilot_project_scopes`、`0131_platform_notification_config_not_null`。

对应修复顺序（均需人工授权，不由本命令执行）：

1. 开发库迁移：先 `npm run check:migration-preflight -- --enterprise-id <id>`，再按发布流程备份并执行已授权迁移；复验 `npm run xiaok:env:check`。
2. 隔离库：由负责人提供独立的 `XIAOK_ISOLATED_DATABASE_URL`；本命令不会自动创建数据库，也不会复制开发库。配置后 `isolated-pg17` 才会实际检查；若与开发库同目标，`isolated-pg17.independence` 失败。
3. 模型：在百炼供应商映射或企业 Agent 配置中配置 `deepseek-v4.1-flash-1017`，保持百炼供应商不变。
4. 知识库：在 `admin/.env.local` 配置已批准的百炼工作区与 API Key；若明确采用本地网关，由负责人确认后设置 `ASSISTANT_KNOWLEDGE_PROVIDER=local`。
5. Worker：`npm run worker:assistant`，观察开发环境队列消化；复验 `node scripts/assistant-worker-healthcheck.mjs` 与 `npm run xiaok:env:check`。不要通过删除任务或重试失败任务制造通过。
6. 生产：`.env.production` 目前指向 `localhost`，只能作为配置模板识别；真实生产配置由部署环境提供，本命令仍不会连接生产。

## 测试

```powershell
cd admin
npm run test:xiaok-env-check
npx tsc --noEmit
npx eslint scripts/xiaok-env-check.ts scripts/xiaok-env-check-lib.ts scripts/__tests__/xiaok-env-check.test.ts
```

本轮结果：定向测试 16/16 通过，TypeScript 通过，定向 ESLint 通过。测试覆盖：

- 只有 `DATABASE_URL` 时，`isolated-pg17` 必须 `not_run`，不能出现 `passed`；
- 两套数据库都配置时，分别检查并输出各自 target；
- 隔离库连接失败时，只影响 `isolated-pg17`，开发库仍按自身结果判定；
- 开发库正常但隔离库缺失时，隔离库仍为 `not_run`；
- 两个数据库迁移账本不一致时，只让对应数据库的迁移检查失败；
- 另外覆盖 Node 版本不足、依赖缺失、环境变量缺失、PG16/超级用户/BYPASSRLS、RLS 缺表/未强制、模型供应商/映射缺失、Embedding/知识库未配置、Worker 心跳缺失/过期、开发队列积压、生产配置只识别不连接、脱敏和级别汇总。
