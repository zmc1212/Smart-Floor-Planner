# 小K 开发环境统一体检（I7.5.2）

`xiaok:env:check` 是家客来（小K）开发、验收和排障的统一环境入口。它只读取运行时、配置和数据库元数据，用于回答“这台机器现在能做什么、缺什么、下一步执行什么命令”，而不是替代业务验收。

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

## 环境级别

| 级别 | 检查内容 |
| --- | --- |
| `development` | Node/npm 版本、`admin/node_modules` 与关键依赖、项目版本/锁文件、`.env.local` 与必要/可选变量是否存在（只报告变量名，不输出值） |
| `isolated-pg17` | `DATABASE_URL` 连接、PostgreSQL 17.x、非超级用户/非 BYPASSRLS 身份、只读事务、核心表 FORCE RLS、迁移账本与待执行迁移 |
| `model` | 官方百炼（`dashscope.aliyuncs.com/compatible-mode`）供应商是否启用并保存 Key、是否配置 `deepseek-v4.1-flash-1017` 映射或企业绑定；真实模型调用固定为 `not_run` |
| `knowledge` | Embedding 配置（百炼托管或本地网关）、知识库供应商与工作区、知识库表/pgvector；真实检索固定为 `not_run` |
| `worker` | `CRON_SECRET`、Worker 端点、健康文件心跳、任务队列积压/失败计数（只读平台范围聚合） |
| `production` | 只读边界、`admin/.env.production` 变量名清单、部署与生产 Worker 明确标记为 `not_run` |

每项输出 `passed` / `failed` / `limited` / `not_run`，以及 `actual`、失败原因、修复命令和复验方法。级别状态取该级别最严重状态：有 `failed` 即 `failed`，否则有 `limited` 即 `limited`，否则有 `passed` 即 `passed`，全部 `not_run` 才为 `not_run`。

## 安全边界

本命令明确不会：

- 重建、删除或初始化数据库；
- 执行迁移（只读取迁移账本和迁移文件）；
- 创建、覆盖 `.env` 或修改现有配置；
- 更换模型供应商；
- 发起真实模型、Embedding 或知识库请求（因此不产生调用费用）；
- 写入业务数据、修改真实企业 1454；
- 启动或修改生产 Worker、部署生产。

数据库连接使用 `default_transaction_read_only=on` 并在结束时回滚。队列统计在只读事务内设置本地平台范围，仅输出聚合计数，不输出任何企业或任务明细。

## 脱敏

报告中的 `variables` 只包含 `set` / `missing`；不输出 `DATABASE_URL`、密码、API Key、连接 URI、加密字段或企业业务数据。错误文本统一经过 `redactSecrets`，会把 `postgresql://...`、`Bearer ...`、`sk-...` 以及 `api_key/password/secret/token=...` 替换为 `[redacted]`。

## 当前真实结果（2026-11-16 00:27 Asia/Shanghai）

基线 `codex/xiaok-integration` / `a5dc1489`。真实执行：

```powershell
cd admin
npm run xiaok:env:check -- --output ../tmp/xiaok-i752-env-check.json
```

汇总：**19 passed / 5 failed / 0 limited / 4 not_run（28 项）**，`overall=failed`。这是真实缺项，不是 Mock 通过。

| 级别 | 状态 | 实际结果 |
| --- | --- | --- |
| `development` | passed | Node `v24.9.0`、npm `11.6.0`、依赖 `7/7`、`.env.local` 存在、必要/可选变量齐全 |
| `isolated-pg17` | failed | 连接/版本/身份/只读/RLS 通过（`sfp_app`、非超级用户、FORCE RLS 7 张核心表）；迁移账本 119 条，**9 条待执行迁移** |
| `model` | failed | 官方百炼供应商已启用且有 Key；但只配置了 `qwen3.7-flash`，**未找到 `deepseek-v4.1-flash-1017` 映射或企业绑定** |
| `knowledge` | failed | 知识库表与 pgvector 存在；默认百炼模式缺少 `ASSISTANT_BAILIAN_RAG_WORKSPACE_ID` / `ASSISTANT_BAILIAN_RAG_API_KEY`；本地 Embedding 变量虽存在，但当前模式为 `bailian` |
| `worker` | failed | `CRON_SECRET` 与端点正常；心跳 `stale`（约 84,500 秒前）；队列 `queued=31,running=2,failed=404`，最早排队约 273,864 秒 |
| `production` | passed | 只读事务、生产变量清单 37 个键齐全；部署与生产 Worker `not_run` |

待执行迁移：`0120_construction_camera_sd_identity_version`、`0124_assistant_knowledge_integration`、`0125_native_workflow_runtime_integration`、`0126_native_workflow_delegation_integration`、`0127_native_workflow_delegation_compatibility`、`0128_xiaok_v1_stage_reminders`、`0129_xiaok_v1_stage_reminder_receipts`、`0130_xiaok_pilot_project_scopes`、`0131_platform_notification_config_not_null`。

对应修复顺序（均需人工授权，不由本命令执行）：

1. 迁移：先 `npm run check:migration-preflight -- --enterprise-id <id>`，再按发布流程备份并执行已授权迁移；复验 `npm run xiaok:env:check`。
2. 模型：在百炼供应商映射或企业 Agent 配置中配置 `deepseek-v4.1-flash-1017`，保持百炼供应商不变。
3. 知识库：在 `admin/.env.local` 配置已批准的百炼工作区与 API Key；若明确采用本地网关，由负责人确认后设置 `ASSISTANT_KNOWLEDGE_PROVIDER=local`。
4. Worker：`npm run worker:assistant`，观察队列消化；复验 `node scripts/assistant-worker-healthcheck.mjs` 与 `npm run xiaok:env:check`。

## 测试

```powershell
cd admin
npm run test:xiaok-env-check
npx tsc --noEmit
npx eslint scripts/xiaok-env-check.ts scripts/xiaok-env-check-lib.ts scripts/__tests__/xiaok-env-check.test.ts
```

本轮结果：定向测试 10/10 通过，TypeScript 通过，定向 ESLint 通过。测试覆盖 Node 版本不足、依赖缺失、环境变量缺失、PG16/超级用户/BYPASSRLS、连接失败、RLS 缺表/未强制、迁移待执行/账本不识别、模型供应商/映射缺失、Embedding/知识库未配置、Worker 心跳缺失/过期、队列积压、脱敏和级别汇总。
