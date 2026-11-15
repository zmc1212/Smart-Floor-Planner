# 家客来 AI 与 Worker 环境准备报告（I7.5.7）

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 调查基线：`a593a9c6f9e11de308e854bceb2059e9087e98b7`（调查时与 `origin/codex/xiaok-integration` 完全一致）
> 提交时远端：`bcfda7b6`（先有 `6f9cf0b4` 知识问答闭环，后有 `bcfda7b6` 数据库迁移环境文档）。两者均不改变本报告的模型、知识库与 Worker 结论。
> 调查时间：2026-11-16 01:12–01:16（Asia/Shanghai）
> 性质：**只读调查**。调查期间未修改业务代码、未提交、未推送、未执行迁移、未修改模型/知识库配置、未调用真实模型、未启动 Worker、未重试或删除任务、未发送通知、未修改企业 1454 数据；调查完成后仅提交本报告。
> 结论：**AI 模型配置存在但目标模型不一致；企业知识库内容与本地 Embedding 服务可用，但当前供应商模式与数据库结构不匹配；Worker 完全停运，31 条排队 + 2 条可回收运行任务未处理；404 条 failed 任务均为终态，不会被自动重试。**

---

## 1. 调查边界与并行保护

| 项 | 结果 |
| --- | --- |
| 远端同步 | 调查时 `git fetch` 后 HEAD `a593a9c6` 与远端一致；提交前再次 fetch，远端已前进至 `6f9cf0b4`（知识问答闭环提交） |
| 本任务改动 | 仅新增本报告文件；未改任何代码、SQL、配置或数据库 |
| 并行 Agent 未提交改动 | **原样保留、未触碰、未提交**。调查时 33 个已跟踪文件被修改；其中知识问答链路已由 `6f9cf0b4` 提交，其余 `AGENTS.md`、`source-manifest.json`、`tsconfig.json`、小程序页面/测试等仍未提交 |
| 关键并行改动 | `admin/src/lib/assistant/infrastructure/answer-worker.ts` 的 3 行 stage knowledge 参数传递已进入 `6f9cf0b4`；不改变 Worker 队列、模型路由或知识库检索结论 |
| 数据库访问 | 所有 SQL 均在 `default_transaction_read_only=on` 会话与只读事务内执行；平台聚合读取使用事务级 `set_config`，会话结束自动失效 |
| 未做的事 | 未 `db:migrate`、未 `db:backup`、未创建/删除/重建数据库、未启动 Next/Worker、未执行任何模型或 Embedding 请求 |

相关既有文档（本报告不重复其内容）：

- `docs/xiaok-environment-check.md`：统一环境体检 `npm run xiaok:env:check` 的权威说明。
- `docs/xiaok-i756-database-environment-preparation.md`：并行任务 I7.5.6 的数据库迁移只读评估。

---

## 2. 当前真实配置与运行状态

### 2.1 统一环境体检结果

命令：

```powershell
cd admin
npm run xiaok:env:check -- --output ../tmp/xiaok-i757-env-check.json
```

结果：**23 passed / 6 failed / 1 limited / 8 not_run（共 38 项），overall=failed**。

| 环境级别 | 状态 | 关键实际值 |
| --- | --- | --- |
| `development` | failed | Node `v24.9.0`、npm `11.6.0`、依赖 `7/7`；开发库连接、PG17.10、`sfp_app` 非超管、只读事务、7 张核心表 FORCE RLS 均通过；迁移账本 119 条，**9 条待执行** |
| `isolated-pg17` | not_run | 未配置 `XIAOK_ISOLATED_DATABASE_URL`；未复用开发库结果 |
| `model` | failed | 平台 LLM 覆盖已启用，但模型为 `qwen3.7-flash`，不是 `deepseek-v4.1-flash-1017` |
| `knowledge` | failed | 默认 `bailian` 模式缺少工作区/API Key；知识库表与 pgvector 存在 |
| `worker` | failed | 心跳 `stale`（约 87,450 秒）；`queued=31,running=2,failed=404`，最早排队约 276,000 秒 |
| `production` | limited | `.env.production` 指向 `localhost`，属模板/开发库风险；未连接生产 |

待执行迁移（顺序即 journal 顺序）：

`0120_construction_camera_sd_identity_version`、`0124_assistant_knowledge_integration`、`0125_native_workflow_runtime_integration`、`0126_native_workflow_delegation_integration`、`0127_native_workflow_delegation_compatibility`、`0128_xiaok_v1_stage_reminders`、`0129_xiaok_v1_stage_reminder_receipts`、`0130_xiaok_pilot_project_scopes`、`0131_platform_notification_config_not_null`。

其中与本任务直接相关：

- **0124**：知识库 `scope/project_id` 列与 `assistant_managed_knowledge_*` 表。缺失时企业知识检索 SQL 直接报错。
- **0128–0130**：阶段提醒、提醒回执、试点项目范围。缺失时提醒/试点 Worker 无法完成真实业务。
- **0131**：`platform_configs.notification_config` 非空约束。影响通知配置写入，不阻塞当前只读调查。

### 2.2 AI 模型配置（`platform_configs.llm_config`）

`app.platform_configs` 中 `key='default'` 的真实值（凭据只显示长度/掩码，不输出明文）：

| 字段 | 实际值 |
| --- | --- |
| `enabled` | `true` |
| `providerKey` | `dashscope` |
| `baseUrl` | `https://dashscope.aliyuncs.com/compatible-mode/v1`（运行时归一化为 `.../compatible-mode`） |
| `model` | **`qwen3.7-flash`** |
| `apiKeyEncrypted` | 存在，长度 198 |
| `apiKeyMasked` | 存在 |
| `lastTestStatus` / `lastTestAt` | **均为 `null`（从未通过平台“测试连接”记录）** |
| `updated_at` | `2026-10-30T03:05:42.956Z` |
| 其他键 | `profiles`、`vision`、`reuseLlmCredentials` 等存在 |

### 2.3 `ai_provider_configs`

| key | 启用 | 能力 | `chat.general` | Base URL | 凭据 | 最近测试 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `llm-settings-override` | 是 | chat | `qwen3.7-flash` | `https://dashscope.aliyuncs.com/compatible-mode` | 密文 198 + 掩码 | 无 | 平台 LLM 的系统托管投影，priority 0 |
| `vlm-settings-override` | 否 | vision | 空 | `https://api.siliconflow.cn` | 空 | 无 | VLM 托管投影，未启用 |
| `grs` | 是 | chat/vision/image | `gemini-3.1-pro` | `https://grsai.dakka.com.cn` | 密文 90 + 掩码 | 2026-09-04 成功，提示“上游余额 0 GRS 积分” | 平台覆盖启用时**不参与路由** |
| `nebula` | 是 | chat/vision/image | `gemini-3.1-pro` | `https://apinebula.ai` | 密文 110 + 掩码 | 无 | 平台覆盖启用时**不参与路由** |

`xiaok:env:check` 统计的 `ai_provider_configs` 候选为 `candidates=2`（`grs`、`nebula`），但 `used=false`，因为平台覆盖已启用。

### 2.4 模型调用路由

实际顺序（`admin/src/lib/ai/postgres-workflow-chat.ts:128-148`）：

1. 对 `chat.general` / `vision.reference_analysis`，先调用 `getPlatformLlmOverrideRuntime()`。
2. 平台覆盖启用且可用时，**只使用唯一 runtime**，不读取 `ai_provider_configs`，也没有供应商 fallback。
3. 平台覆盖关闭、字段缺失或迁移前默认关闭时，才调用 `listProviderRuntimes()`，从 `ai_provider_configs` 选择启用、具备 `chat` 能力且有 `chat.general` 映射的供应商（`-fallback` 排最后，再按 priority、createdAt 排序）。
4. 平台覆盖启用但凭据缺失/无法解密时**不会回退**，直接失败。

企业 1454 的 `assistant_enterprise_settings.agent_config` 也与平台覆盖一致地固定在：

```json
{
  "runtime": "langgraph-v1",
  "providerKey": "dashscope",
  "model": "qwen3.7-flash",
  "tools": true,
  "imageInput": true,
  "probeVersion": "qwen37-queue-wire-20261030:chatcmpl-fe5fd5d2-edf0-9b8a-b58c-ce9146c278f7",
  "enterpriseKnowledgeEnabled": true
}
```

注意：`postgres-workflow-chat.ts:145-147` 要求 `agent.config.model` 与最终 runtime 的 `remoteModel` 一致、`agent.config.providerKey` 与 runtime 的 `providerPreset` 一致。**只改平台模型、不同步改企业 Agent 配置，会让请求直接以 `assistant_model_configuration_invalid` 失败。**

### 2.5 “配置存在 / 凭据可用 / 真实调用成功”三层判定

| 层次 | 结论 | 证据 |
| --- | --- | --- |
| 配置存在 | **是** | 平台覆盖启用、endpoint/preset/模型字段完整；`ai_provider_configs` 托管投影存在 |
| 凭据可用 | **大概率可用，但未重新验证** | 密文与掩码存在，`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`/加密密钥就绪；历史真实调用在 2026-11-12 前持续成功。但平台 `lastTestStatus=null`，且本次禁止真实调用，无法确认当前密钥仍有效 |
| 真实调用成功 | **qwen3.7-flash：是（历史）；deepseek-v4.1-flash-1017：无记录** | `app.ai_provider_attempts`：`llm-settings-override` + `qwen3.7-flash` 成功 1171 次，最新 `2026-11-12 05:40:24Z`；`deepseek-flash`（别名）成功 1848 次，最新 `2026-10-20 01:59:06Z`；**精确 ID `deepseek-v4.1-flash-1017` 从未出现在调用记录中** |
| 目标模型一致 | **否** | 环境体检要求 `deepseek-v4.1-flash-1017`，实际为 `qwen3.7-flash`；`model.final_runtime=failed` |

补充：

- `assistant_usage_records` 有 1240 条 `tokens/observed` 记录，累计输入 3,325,740、输出 140,165（企业 1454），最新 `2026-11-12 05:40:16Z`，证明模型链路曾真实成功。
- 代码中的目标模型常量：`admin/src/lib/assistant/specialists/registry.ts:5-10`，`providerKey='bailian'`、`logicalModel='deepseek-flash'`、`model='deepseek-v4.1-flash-1017'`。
- 专业 Agent（防水/水电）路由条件要求 `providerKey='bailian'` 且 `model='deepseek-v4.1-flash-1017'`（`admin/src/lib/assistant/agent/worker.ts:972-975`、`:1506`）。当前 `dashscope + qwen3.7-flash` 不满足条件，**专业 Agent 当前不会被路由**（代码未删除，能力保留）。

### 2.6 Responses API 状态

- 代码已存在 Responses API 适配层：`admin/src/lib/ai/providers/bailian-responses-capabilities.ts`、`bailian-responses-client.ts`。
- 选择条件：`responsesWireSelected()`（`admin/src/lib/ai/providers/agent-chat.ts:206-223`）要求 `bailianResponsesApplies(input)` **且** `bailianResponsesEnabled()` 为真。
- `bailianResponsesEnabled()` 要求部署环境显式设置 `ASSISTANT_RESPONSES_API=1`（`:153-171`）。
- 当前 `admin/.env.local` **未设置 `ASSISTANT_RESPONSES_API`**，因此即使配置了百炼官方 endpoint，当前仍走 **Chat Completions**，不是 Responses API。
- `deepseek-v4.1-flash-1017` 在代码能力表中有 documented 记录（Responses / function calling / web_search / web_extractor / code_interpreter / streaming / usage），但只是“文档记录”，不是 `live_verified`。

---

## 3. 企业知识库

### 3.1 配置事实

| 项 | 实际值 |
| --- | --- |
| 知识库供应商模式 | `ASSISTANT_KNOWLEDGE_PROVIDER` **未设置** → 代码默认 `bailian`（`bailian-provider.ts:14-18`） |
| 百炼工作区 | `ASSISTANT_BAILIAN_RAG_WORKSPACE_ID` **缺失** |
| 百炼 API Key | `ASSISTANT_BAILIAN_RAG_API_KEY` **缺失** |
| 百炼分类/Embedding 模型 | 未设置 → 默认 `default` / `text-embedding-v4` |
| 本地 Embedding URL | 已设置：`http://127.0.0.1:18089` |
| 本地 Embedding API Key | 已设置 |
| 本地 Embedding Provider | 未设置 → 默认 `local` |
| 企业知识开关 | `agent_config.enterpriseKnowledgeEnabled=true` |
| 活跃索引 Profile | `active_index_profile_id=1`，`qwen3-embedding-0.6b-1024-zh-v1` |

### 3.2 Embedding 服务可用性（真实探测，未执行 Embedding 调用）

`GET http://127.0.0.1:18089/health`（带本地 API Key）返回 `200`：

```json
{
  "status": "ok",
  "model": "Qwen/Qwen3-Embedding-0.6B",
  "revision": "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3",
  "profile": "qwen3-embedding-0.6b-1024-zh-v1",
  "dimensions": 1024,
  "normalized": true,
  "dtype": "float16",
  "device": "cuda",
  "max_tokens": 512,
  "max_batch": 8,
  "queued": 0
}
```

该返回与 `admin/src/lib/assistant/infrastructure/embedding-gateway.ts:4-10` 的 `EMBEDDING_PROFILE` **完全一致**（模型、revision、维度、归一化、dtype），说明本地 Embedding 服务本身可用且与现有索引 profile 匹配。

### 3.3 pgvector 与索引

| 项 | 实际值 |
| --- | --- |
| pgvector | `vector 0.8.2` 已安装 |
| `assistant_knowledge_chunks.embedding` | `vector(1024) NOT NULL` |
| 向量索引 | **无 ivfflat / hnsw**；只有 btree（企业+版本+profile、唯一键等） |
| 当前规模 | 企业 1454 共 177 条 chunk，全部有 embedding（`embedding_null=0`） |
| 评价 | 177 条规模下精确扫描（`<=>`）可接受；规模扩大后再评估 ANN 索引，不是当前阻塞项 |

### 3.4 企业 1454 知识内容

| 项 | 数量 |
| --- | --- |
| 文档总数 | 79 |
| `active` 且已发布版本 | 33（`customer_public` 22、`staff_internal` 11） |
| `draft` | 30 |
| `retired` | 16（其中 15 有历史发布版本） |
| `ready` 索引版本 / chunks | 51 / 177 |
| `pending` 索引版本 | 29（多为 OCR 待复核草稿） |
| `failed` 索引版本 | 1（文档 419，`index_status=failed`） |
| 已 ready 但当前未发布的版本 | 3 |
| 内容类型 | 精艺原件测试资料、合成测试、V1-03 员工内部测试参考等 |

结论：**企业知识内容与本地向量数据是存在的，不是“空知识库”**；33 个 active 文档、177 条 chunk 可用于本地模式检索。

### 3.5 三层判定

| 层次 | 结论 | 说明 |
| --- | --- | --- |
| 配置缺失 | **是** | 当前模式为 `bailian`，但工作区/API Key 缺失；`bailianKnowledgeConfig()` 直接抛 `bailian_knowledge_not_configured`，检索被包装为 `retrieval_unavailable` |
| 服务不可用 | **否（本地）** | 本地 Embedding `/health` 200，模型与 revision 匹配；百炼托管服务未配置，无法判断 |
| 真实检索失败 | **是（当前配置下）** | 404 条 failed 中有 4 条 `retrieval_unavailable`（最近 `2026-11-11 09:57Z`，近 7 天 2 条）；根因是供应商模式/配置，不是内容为空 |

### 3.6 结构性阻塞：0124 未应用

`admin/src/lib/assistant/knowledge/retrieval.ts` 的检索 SQL 始终选择 `d.scope`（`knowledgeColumns`，`:75-83`）并使用 `sourceScope`；托管模式还会读取 `app.assistant_managed_knowledge_imports`（`:149-150`）与 `managed-store` 的 `assistant_managed_knowledge_libraries`。

而开发库当前：

- `assistant_knowledge_documents` **没有 `scope` 列**（实测查询报 `42703: column "scope" does not exist`）；
- `app.assistant_managed_knowledge_libraries` **不存在**（实测报 `42P01`）。

两者都由待执行的 `0124_assistant_knowledge_integration.sql` 创建（`:21-22`、`:60-91`）。因此：

- **即使现在把 `ASSISTANT_KNOWLEDGE_PROVIDER` 改成 `local`，检索 SQL 仍会因缺列失败；**
- **即使现在补齐百炼工作区/API Key，托管检索仍会因缺表失败；**
- `xiaok:env:check` 的 `knowledge.tables=passed` 只检查表存在与 pgvector，不检查列/结构，所以不能据此认定“真实检索可用”。

### 3.7 最低成本可用配置方案

**推荐：本地 Embedding 模式，复用现有 177 条已向量化 chunk。**

1. 先应用 `0124_assistant_knowledge_integration`（补齐 `scope/project_id`、托管表；需人工授权 + 备份）。
2. 在 `admin/.env.local` 显式设置 `ASSISTANT_KNOWLEDGE_PROVIDER=local`。
3. 不需要重新生成 embedding，也不需要购买百炼知识库：现有 profile、revision、维度与本地服务完全匹配。
4. 用一次已授权的真实本地检索验证 33 个 active 文档可命中；该验证只调用本地 Embedding 服务，不产生外部模型费用。

**备选：百炼托管模式。**

需要同时补齐：`ASSISTANT_BAILIAN_RAG_WORKSPACE_ID`、`ASSISTANT_BAILIAN_RAG_API_KEY`、可选的 category/embedding model，并完成 0124 的托管表、知识导入/索引。成本与配置量都高于本地模式，且当前没有可复用的托管索引证据。

---

## 4. Worker

### 4.1 正式启动入口

| 场景 | 入口 | 说明 |
| --- | --- | --- |
| 本地开发（推荐） | `cd admin; npm run dev` | `scripts/dev.mjs:37-69` 同时监督 Next 和 `scripts/assistant-worker.mjs`；Next 退出或 Worker 退出会联动停止/重启；要求 `CRON_SECRET` 非空 |
| 本地仅 Worker | `cd admin; npm run worker:assistant` | `package.json:25`；需要 Next 已在 `3006` 运行，默认 endpoint `http://localhost:3006/api/internal/assistant/jobs/run` |
| 容器/生产 | `assistant-worker` 服务 | `admin/docker-compose.yml:60-78`；`profiles: ["assistant"]`，默认 `docker compose up -d` **不会启动**；生产 endpoint `http://admin:3005/api/internal/assistant/jobs/run` |
| 独立 Lead Worker | `npm run worker:lead-claims` | 与本报告 Assistant Worker 不同，不处理 `assistant_jobs` |

Worker 本身只是“ticker”：每 2 秒 POST 一次内部 route（`assistant-worker.mjs:49-95`），实际任务执行在 Next 进程内（`jobs-post-handler.ts` → `jobs-tick.ts`）。**Next 不在运行，Worker 单独启动也无法处理任务。**

### 4.2 心跳文件与健康检查

| 项 | 实际值 |
| --- | --- |
| 健康文件默认路径 | `%TEMP%\assistant-worker-health.json`（`os.tmpdir()`；可用 `ASSISTANT_WORKER_HEALTH_FILE` 覆盖） |
| 写入方式 | 先写唯一临时文件再 `rename` 原子替换（`assistant-worker.mjs:22-32`） |
| 默认过期阈值 | **210 秒**（`operations.ts:44`；可用 `ASSISTANT_OPERATIONS_WORKER_STALE_SECONDS` 覆盖） |
| 实际文件内容 | `{"lastSuccessAt":1794675521164}`，**没有 `workerPid`** |
| 时间 | `2026-11-14T16:58:41.164Z`（2026-11-15 00:58:41 Asia/Shanghai） |
| 健康检查实测 | `{"processStatus":"unknown","ageSeconds":87452,"workerPid":null,"healthy":false,"tickStatus":"stale","reason":"heartbeat_stale"}` |
| 进程实测 | 无 `assistant-worker.mjs` 进程；`3006` 端口无监听 |

注意：真实 Worker 循环会写入 `workerPid`（`assistant-worker.mjs:13-21`）。当前文件只有 `lastSuccessAt`，形态与测试/一次性脚本写入一致，**不能作为“Worker 曾持续运行”或“当前存活”的证据**。健康检查也把进程状态判为 `unknown`。

### 4.3 任务领取、租约、超时恢复与幂等

| 机制 | 实现事实 |
| --- | --- |
| 领取范围 | 只领取 `kind='chat_turn'` 且 `status='queued' and available_at<=now()`，或 `status='running' and lease_expires_at<=now()`（`job-queue.ts:57-80`、`:270-277`） |
| 并发防重 | 平台扫描候选 → 租户事务内 `SELECT ... FOR UPDATE SKIP LOCKED`；先锁 `assistant_enterprise_settings` 作为顺序点 |
| 并发度 | 全局默认 **1**（最大 8，`ASSISTANT_WORKER_CONCURRENCY`）；单企业默认 **1**（最大 4，`ASSISTANT_ENTERPRISE_CONCURRENCY`） |
| 租约 | `leaseMs=150000`（150 秒）；`heartbeatMs=30000`；provider 超时 90 秒；请求超时 180 秒（`job-queue.ts:16`） |
| 心跳保活 | `live()` 校验 `running + lease_token + lease_expires_at>now()`；`heartbeat()` 刷新 150 秒租约（`:118-137`） |
| Provider 调用前标记 | `markProviderStarted()` 在真正 I/O 前提交 `provider_started_at`，防止“未知计费被当作免费” |
| 超时恢复 | running 租约过期且 `provider_started_at` 未设置 → 可被重新领取；已设置但无完成的 `agent_model` step → 置为 `indeterminate`（`provider_outcome_unknown`），**不自动重放**，额度置 `reconciling` |
| 重试上限 | 领取时 `attempts>=3` → 直接 `failed model_unavailable`（`:103`） |
| 幂等 | `chat_turn` 的 `dedupe_key='run:<runId>'`；数据库唯一约束 `UNIQUE(enterprise_id,run_id)`、`UNIQUE(enterprise_id,dedupe_key)`（`drizzle/0058_assistant_foundation.sql:123-126`）；完成/失败均校验租约 token 与状态 |
| 知识任务 | `knowledge_index`/`knowledge_parse` 有独立领取与 150 秒租约；`attempts>=3` → `failed retry_exhausted`；未知结果 → `indeterminate`，不自动重放（`index-worker.ts:47-74`） |
| failed 生命周期 | `failed` 是终态；领取条件不包含 `status='failed'`；未发现自动重试或 retry API。恢复只能通过用户重新发起新 run，或经人工授权的运维重放 |

### 4.4 当前队列与积压

快照时间：`2026-11-16 01:16 Asia/Shanghai`（数据库 `now()` 一致）。

| 状态 | 数量 | 说明 |
| --- | --- | --- |
| `queued` | **31** | 全部企业 1454、`chat_turn`；`attempts=0`；最早 `2026-11-12 12:22:36Z`，最晚 `2026-11-14 06:15:02Z` |
| `running` | **2** | 企业 1454；`attempts=1`；租约已于 `2026-11-12 12:26Z` 过期；`provider_started_at=null`；会话均为 `open` |
| `failed` | **404** | 400 `chat_turn` + 4 `knowledge_index` |
| `indeterminate` | 86 | 不计入 404；调查期间由 83 变为 86，说明仍有并行活动写入任务状态 |
| `cancelled` | 39 | 历史取消 |
| `succeeded` | 3080 | 历史成功 |

31 条 queued 与 2 条 running 对应的 run purpose 主要是 `construction.report.compose` / `construction.report.facts`，即**日报/周报生成管线**。这说明报告生成已被 Worker 停运阻塞约 3 天。

2 条 running 的 `provider_started_at=null`，属于**安全可回收**（没有未知的外部调用结果），Next + Worker 恢复后可被重新领取；31 条 queued 也会被正常领取。但它们是业务任务，恢复执行会产生模型调用，可能继续生成/投递报告。

### 4.5 404 条历史 failed 任务只读分类

分类规则（只读 SQL，未重试、未删除）：

- `1_test_artifact`：`last_error='recovery_check_synthetic_cleanup'`，恢复性测试清理残留。
- `2_expired_or_revoked`：`context_changed`、`assistant_resource_not_found`、`assistant_disabled`、`assistant_capability_forbidden`，或 run/会话缺失、会话已关闭。
- `3_unknown_or_payment`：`provider_outcome_unknown`、`provider_payment_required`。
- `4_config_blocked`：`model_unavailable`、`fastgpt_workflow_unavailable`、`retrieval_unavailable`。
- `5_invalid_input`：`invalid_message`、`invalid_construction`、`invalid_tool_arguments`。
- `6_model_contract_reject`：其余模型输出/引用/结构化契约不通过。

| 分类 | 数量 | 任务类型 | 可恢复性结论 |
| --- | --- | --- | --- |
| 测试残留 | **68** | chat_turn 65 + knowledge_index 3 | **不重试、不删除**；保留为恢复测试证据 |
| 模型输出/契约不通过 | **268** | chat_turn 268 | **不可自动恢复**；需修复模型/提示/引用/结构化输出策略后由用户重新发起；原失败保留 |
| 已过期/权限失效 | **32** | chat_turn 31 + knowledge_index 1 | **不可恢复**；会话已关闭/权限撤销/上下文版本变化/run 缺失，需新会话或新授权 |
| 配置阻塞 | **22** | chat_turn 22 | **配置修复后可恢复**（重新发起，不重放）：`model_unavailable` 14、`retrieval_unavailable` 4、`fastgpt_workflow_unavailable` 4 |
| 无效输入 | **9** | chat_turn 9 | **需修正输入/工具参数后新请求**，原任务不可恢复 |
| 未知结果/支付 | **5** | chat_turn 5 | **禁止自动重放**：1 条 `provider_outcome_unknown` 需人工对账；4 条 `provider_payment_required` 需充值后新请求 |
| **合计** | **404** | chat_turn 400 + knowledge_index 4 | — |

错误码明细（合计 404）：

| `last_error` | 数量 | 说明 |
| --- | --- | --- |
| `unsupported_model_commitment` | 73 | 模型作出未授权承诺，被答案校验拒绝 |
| `recovery_check_synthetic_cleanup` | 68 | 恢复性测试残留 |
| `invalid_model_citation` | 43 | 引用校验失败（41 次 1 attempt + 2 次 2 attempts） |
| `agent_input_limit` | 43 | Agent 输入超限 |
| `invalid_model_answer` | 41 | 模型答案结构/内容不合法 |
| `ungrounded_response_scope` | 36 | 回答超出已授权范围 |
| `native_schema_unverified` | 19 | Native 结构化输出 schema 未验证 |
| `context_changed` | 18 | 会话/策略/知识 epoch/版本变化 |
| `model_unavailable` | 14 | 模型运行不可用（含 2 条 attempts=3） |
| `assistant_capability_forbidden` | 7 | 能力/权限不允许 |
| `invalid_message` | 6 | 请求消息不合法 |
| `assistant_resource_not_found` | 4 | 资源不存在（2 条会话已关闭） |
| `provider_payment_required` | 4 | 上游余额/支付问题 |
| `retrieval_unavailable` | 4 | 知识检索不可用 |
| `agent_deadline_exceeded` | 4 | Agent 超时 |
| `incomplete_model_answer` | 4 | 模型答案不完整 |
| `fastgpt_workflow_unavailable` | 4 | FastGPT 工作流不可用 |
| `missing_citation` | 4 | 缺少引用 |
| `invalid_tool_arguments` | 2 | 工具参数不合法 |
| `agent_iteration_limit` | 2 | Agent 迭代上限 |
| `provider_outcome_unknown` | 1 | Provider 结果未知（禁止自动重放） |
| `assistant_disabled` | 1 | 助手关闭 |
| `invalid_construction` | 1 | 施工上下文不合法 |
| `index_deadline_exceeded` | 1 | 知识索引超时 |

补充事实：

- 404 条 failed 均无活跃租约（`with_lease=0`、`lease_active=0`），`available_at` 均不在未来，**最近 24 小时没有新增 failed**。
- 404 条 failed **不在 Worker 领取条件内**；不存在“重启 Worker 就自动重试 404 条”的路径。
- 真正可被 Worker 恢复的是队列里的 **31 queued + 2 running**（不在 404 内），且恢复执行会产生模型调用/报告生成副作用。

### 4.6 Worker 根因

1. **Next 与 Worker 都没有运行**：无 `assistant-worker.mjs` 进程，`3006` 无监听；Worker 即使启动也会因 endpoint 不可达失败。
2. **心跳文件不是真实 Worker 写的**：只有 `lastSuccessAt`、没有 `workerPid`；健康检查 `processStatus=unknown`、`stale`。
3. **2 条 running 租约已过期 3 天**，但 `provider_started_at=null`，属于安全可回收；31 条 queued 从未被领取（`attempts=0`）。
4. **提醒/试点相关迁移未应用**（0128–0130），提醒与试点范围 Worker 无法完成真实业务。
5. **启动 Worker 存在真实通知风险**：`XIAOK_STAGE_REMINDER_MODE` 与 `XIAOK_WEEKLY_REPORT_MODE` 都未设置时，两者默认 `enterprise` 且 enterpriseId 为空，`pilotScopeAlignment=aligned`（`pilot-worker-alignment.ts:47-58`），报告/提醒 Worker 会按企业模式运行，可能向真实用户投递。**本轮禁止启动 Worker 是正确且必要的。**

---

## 5. 故障根因汇总

按影响排序：

1. **Worker 停运**：Next + Assistant Worker 均未运行，31 条报告任务排队约 3 天，2 条运行任务租约过期。
2. **模型目标不一致**：平台覆盖与企业 Agent 均固定 `qwen3.7-flash`；代码要求 `deepseek-v4.1-flash-1017`。环境体检失败；专业 Agent 不路由；精确 deepseek 快照从未真实调用。
3. **知识库模式与配置不匹配**：默认 `bailian`，但工作区/API Key 缺失；本地 Embedding 服务健康且已有 177 条向量，却未被使用。
4. **0124 未应用**：知识检索 SQL 依赖 `documents.scope` 与 `assistant_managed_knowledge_*`；当前直接报 `42703`/`42P01`，是“真实检索失败”的结构性根因。
5. **Responses API 未启用**：`ASSISTANT_RESPONSES_API` 缺失，当前仍走 Chat Completions；若验收要求 Responses 协议，属配置缺口。
6. **迁移批次未完成**：0120、0124–0131 共 9 条待执行；其中 0124/0128–0130 直接阻塞知识与提醒/试点。
7. **404 条 failed 全部为终态**：没有自动重试路径；其中 268 条是模型输出/契约问题，32 条已过期/撤权，68 条是测试残留。
8. **生产配置仍是模板**：`.env.production` 指向 `localhost`，不能视为生产可用；本任务未连接生产。

---

## 6. 需要补充的配置

### 6.1 模型

| 配置 | 当前 | 建议 | 授权要求 |
| --- | --- | --- | --- |
| `platform_configs.llm_config.model` | `qwen3.7-flash` | 若目标为百炼 deepseek：改为 `deepseek-v4.1-flash-1017`；若接受 qwen 过渡，需产品明确确认并调整验收期望 | 人工授权 |
| `platform_configs.llm_config.providerKey` | `dashscope` | 保持 `dashscope`/`bailian` 官方百炼 preset | 人工授权 |
| `platform_configs.llm_config.baseUrl` | 官方 compatible-mode | 保持 `https://dashscope.aliyuncs.com/compatible-mode` | 人工授权 |
| 企业 1454 `agent_config.model/providerKey` | `qwen3.7-flash` / `dashscope` | 与平台覆盖同一次变更同步为目标模型/preset；更新 `probeVersion` | 人工授权，禁止单改一边 |
| `ASSISTANT_RESPONSES_API` | 缺失（Chat Completions） | 若必须使用 Responses API，设为 `1`；同时确认 `ASSISTANT_RESPONSES_STREAM`、`ASSISTANT_NATIVE_TOOLS` | 人工授权 + 真实调用预算 |
| 专业 Agent | `bailian` + deepseek 条件不满足 | 若需防水/水电专业 Agent，改为 `providerKey='bailian'`、`model='deepseek-v4.1-flash-1017'`、`tools=true` | 人工授权 |

注意：平台模型、企业 Agent 配置、`probeVersion` 必须同一窗口同步变更；否则会触发 `assistant_model_configuration_invalid`。

### 6.2 知识库

**最低成本方案（推荐）**

1. 应用 `0124_assistant_knowledge_integration`。
2. 设置 `ASSISTANT_KNOWLEDGE_PROVIDER=local`。
3. 复用现有本地 Embedding 服务与 177 条向量，不重建索引。

**百炼托管方案（备选）**

补齐 `ASSISTANT_BAILIAN_RAG_WORKSPACE_ID`、`ASSISTANT_BAILIAN_RAG_API_KEY`（可选 `ASSISTANT_BAILIAN_RAG_CATEGORY_ID`、`ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL`），应用 0124，并完成托管知识导入/索引。

### 6.3 Worker

| 配置/动作 | 当前 | 建议 |
| --- | --- | --- |
| Next `3006` | 未运行 | 启动 `npm run dev`（会同时监督 Worker）或先启动 Next 再 `npm run worker:assistant` |
| `CRON_SECRET` | 已设置 | 保持 API 与 Worker 一致 |
| 心跳文件 | `%TEMP%` 下陈旧文件 | 保持默认或设置共享 `ASSISTANT_WORKER_HEALTH_FILE`；以真实 Worker 写入的 `workerPid` 为准 |
| 试点/企业范围 | `XIAOK_STAGE_REMINDER_MODE`、`XIAOK_WEEKLY_REPORT_MODE` 未设置，默认企业模式 | 若只允许 1454 试点，显式配置两者为同一 `pilot` + 相同 enterprise/pilot；否则启动后会按企业模式运行 |
| 迁移 0128–0130 | 未应用 | 应用后再验收提醒/试点范围 |
| 通知投递 | 未发送 | 启动 Worker 前确认不会向真实用户投递；必要时先只处理队列、不投递，需代码/配置授权 |

---

## 7. 推荐修复步骤（按顺序，均需人工授权）

1. **冻结并备份**：确认无其他 Agent 正在写库；按 I7.5.6 报告准备迁移级备份（独立安全目录 + 凭据）。不要用 `db:backup` 的 `--no-owner/--no-privileges` 产物做迁移恢复校验。
2. **执行 9 条迁移**：`0120`、`0124`–`0131`，单批次原子执行；执行后复验 `npm run xiaok:env:check` 与 `check:migration-preflight`。
3. **模型配置对齐**：确定目标模型（deepseek-v4.1-flash-1017 或明确接受 qwen3.7-flash 过渡）；同步修改平台 LLM 设置与企业 1454 `agent_config`；如使用 Responses API，设置 `ASSISTANT_RESPONSES_API=1`；执行一次经授权的连接测试并记录模型 ID、请求 ID、用量、结果。
4. **知识库模式切换**：优先 `local`；应用 0124 后执行一次本地检索验收，确认 33 个 active 文档可命中、引用可回溯；不重建 177 条 chunk。
5. **Worker 恢复**：在模型/知识/迁移完成后，先配置试点范围或明确“不投递”策略，再启动 `npm run dev` / `npm run worker:assistant`；观察 31 queued + 2 running 的消化，不删除、不重试 failed。
6. **404 条 failed 处置**：保持现状；仅对经批准的小样本做“用户重新发起”，不重放原任务；68 条测试残留保留为证据；1 条 `provider_outcome_unknown` 进入人工对账，不自动重放。
7. **生产**：`.env.production` 当前是 localhost 模板；生产部署、`assistant` compose profile、生产 Worker 启动均需单独授权，本任务不执行。

---

## 8. 可立即执行的无风险操作

以下操作只读或只写临时文件，不产生模型费用、不修改数据库/配置、不启动 Worker：

| 操作 | 命令/方式 | 状态 |
| --- | --- | --- |
| 环境体检 | `cd admin; npm run xiaok:env:check` | **已执行**，结果 `overall=failed` |
| Worker 健康检查 | `cd admin; node scripts/assistant-worker-healthcheck.mjs` | **已执行**，`stale` / `processStatus=unknown` |
| 本地 Embedding 健康检查 | `GET http://127.0.0.1:18089/health`（带本地 Key） | **已执行**，200，模型/revision 匹配 |
| 只读队列与失败分类 | 只读事务 + 平台聚合查询 | **已执行**，见 §4.4/§4.5 |
| 迁移只读预检 | `cd admin; npm run check:migration-preflight -- --enterprise-id 1454` | 可执行（只读）；建议由数据库负责 Agent 统一执行 |
| 远端状态核对 | `git fetch origin; git status; git log -1` | 可执行 |
| 备份目录/备份角色只读核验 | `check:backup-role`、备份目录安全预检 | 可执行；不创建备份、不写业务库 |

**不要**把“启动 Worker 观察队列消化”当作无风险操作：它会处理 31 条报告任务并可能产生模型调用与真实通知。

---

## 9. 需要人工授权的操作

| 操作 | 为什么需要授权 |
| --- | --- |
| 执行 0120、0124–0131 迁移 | DDL、锁表、不可回滚的业务结构变更；必须先备份 |
| 修改 `platform_configs.llm_config` / 企业 1454 `agent_config` | 变更真实模型与专业 Agent 路由；需产品确认目标模型 |
| 设置 `ASSISTANT_RESPONSES_API=1` 并做真实连接测试 | 产生真实模型调用费用 |
| 切换 `ASSISTANT_KNOWLEDGE_PROVIDER=local` 或配置百炼工作区/Key | 变更企业知识库真实配置 |
| 启动 Next / Assistant Worker | 会处理 31 queued + 2 running，产生模型调用，可能生成/投递报告与提醒 |
| 配置 `XIAOK_STAGE_REMINDER_MODE` / `XIAOK_WEEKLY_REPORT_MODE` 试点范围 | 决定是否向真实企业/用户投递 |
| 重试/重放任何 failed 任务 | 可能重复计费或重复投递；本任务明确禁止 |
| 生产 `.env.production`、生产 compose `assistant` profile、生产 Worker | 生产部署边界，需单独授权 |
| 修改真实企业 1454 的项目、成员、报告、通知配置 | 用户明确禁止 |

---

## 10. 未验证 / 未知项

| 项 | 状态 |
| --- | --- |
| `deepseek-v4.1-flash-1017` 真实调用 | **not_run**（禁止产生费用）；仅确认代码能力表为 documented，从未有该精确 ID 的调用记录 |
| 当前平台凭据是否仍有效 | **unknown**；历史成功至 2026-11-12 05:40Z，平台 `lastTestStatus=null` |
| Responses API 真实链路 | **not_run**；`ASSISTANT_RESPONSES_API` 未启用 |
| 本地模式真实检索 | **not_run**；0124 未应用，SQL 缺列，且本任务禁止检索验收 |
| 百炼托管检索 | **not_run**；工作区/API Key/托管表均缺失 |
| Worker 恢复后的队列消化 | **not_run**；未启动 Worker |
| 86 条 `indeterminate` 任务 | 未逐条分类（不在 404 范围）；其中可能包含 `provider_outcome_unknown`，禁止自动重放 |
| 隔离 PG17 | **not_run**；`XIAOK_ISOLATED_DATABASE_URL` 未配置（本机 55432 有监听，但本任务不使用、不判断其归属） |
| 生产环境 | **not_run**；仅识别 `.env.production` 指向 localhost 模板，未连接 |
| 未提交改动后的最终 Worker 行为 | **limited**；`answer-worker.ts` 的 stage knowledge 参数变更已进入 `6f9cf0b4`，其余未提交改动不涉及 Worker 队列、模型路由或知识检索 |

---

## 11. 证据位置

- 统一环境体检 JSON：`tmp/xiaok-i757-env-check.json`
- 只读数据库探针（临时脚本/输出，不入库）：`tmp/xiaok-i757-db-probe*.mjs`、`tmp/xiaok-i757-db-probe*.json`
- 最终队列计数快照：`tmp/xiaok-i757-final-count.mjs` 输出（404 failed / 31 queued / 2 running，2026-11-16 01:16 CST）
- 代码证据：
  - Worker 入口：`admin/package.json:25`、`admin/scripts/assistant-worker.mjs`、`admin/scripts/dev.mjs:37-69`、`admin/docker-compose.yml:60-78`
  - 心跳/健康检查：`admin/scripts/assistant-worker-health.mjs:18-29`、`admin/scripts/assistant-worker-healthcheck.mjs:13-36`、`admin/src/lib/assistant/operations.ts:162-191`
  - 领取/租约/幂等：`admin/src/lib/assistant/infrastructure/job-queue.ts:16`、`:57-137`、`:268-292`；`admin/drizzle/0058_assistant_foundation.sql:123-126`
  - 模型路由：`admin/src/lib/ai/postgres-workflow-chat.ts:128-148`、`admin/src/lib/platform-llm-config.ts:349-385`、`admin/src/lib/ai/provider-registry.ts:132-147`
  - 专业 Agent 模型：`admin/src/lib/assistant/specialists/registry.ts:5-10`、`admin/src/lib/assistant/agent/config.ts:28-32`、`admin/src/lib/assistant/agent/worker.ts:972-975`、`:1506`
  - Responses API：`admin/src/lib/ai/providers/bailian-responses-capabilities.ts:98-110`、`:153-171`、`admin/src/lib/ai/providers/agent-chat.ts:206-223`
  - 知识库：`admin/src/lib/assistant/knowledge/bailian-provider.ts:14-28`、`admin/src/lib/assistant/knowledge/retrieval.ts:75-83`、`:136-218`、`admin/src/lib/assistant/infrastructure/embedding-gateway.ts:4-42`
  - 0124 迁移：`admin/drizzle/0124_assistant_knowledge_integration.sql:21-22`、`:60-91`

---

## 12. 交接结论

- **AI 模型**：配置与凭据存在，链路历史上真实成功；但当前实际模型是 `qwen3.7-flash`，不是要求的 `deepseek-v4.1-flash-1017`，且 Responses API 未启用。精确 deepseek 快照的真实调用为 `not_run`。
- **企业知识库**：内容（33 active 文档 / 177 chunks）与本地 Embedding 服务均可用；当前默认百炼模式缺工作区/Key，且 0124 未应用导致检索 SQL 缺列/缺表。最低成本方案是“应用 0124 + 显式 `local` 模式”，复用现有向量，不需要购买新服务或重建索引。
- **Worker**：正式入口存在（`npm run dev` 内嵌监督、`worker:assistant`、compose `assistant` profile），但当前完全停运；心跳文件不是真实 Worker 写入；31 queued + 2 running 可被安全回收，但恢复执行有模型调用与通知副作用，必须授权。
- **404 failed**：全部为终态，不会被自动重试；68 条测试残留、268 条模型契约不通过、32 条过期/撤权、22 条配置阻塞、9 条无效输入、5 条未知/支付。未重试、未删除。
- 本次调查未修改任何业务代码、配置或数据，等待项目总协调 Agent 集成。
