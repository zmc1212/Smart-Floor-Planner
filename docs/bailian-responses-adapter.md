# 百炼原生 Responses API 适配层（交付说明）

分支：`codex/xiaok-bailian-responses-api`
基线：`11ac22dd`（`origin/codex/xiaok-native-workflow`，已核实为两个业务分支共同包含的最新公共运行时基线）
归属：本分支唯一负责百炼 Responses API 接入、三种原生工具协议、模型能力矩阵、请求/响应诊断与真实模型验收。

本层不修改两个业务分支，也不重复实现工作流、施工工具、公开站点生命周期或来源检索；业务工具继续走现有 Agent Tool Dispatcher。

---

## 1. 官方协议核验结果（2026-11-12）

依据页面：

- https://docs.bailian.console.aliyun.com/zh/model-studio/compatibility-with-openai-responses-api
- https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-api-via-openai-responses
- https://docs.bailian.console.aliyun.com/zh/model-studio/web-search
- https://docs.bailian.console.aliyun.com/zh/model-studio/web-extractor
- https://docs.bailian.console.aliyun.com/zh/model-studio/qwen-code-interpreter

| 项目 | 结论 | 状态 |
|---|---|---|
| Endpoint | `POST {origin}/compatible-mode/v1/responses`；旧路径 `/api/v2/apps/protocols/compatible-mode/v1/responses` 已停止维护 | documented + live_confirmed |
| 鉴权 | `Authorization: Bearer <DASHSCOPE_API_KEY>` | documented + live_confirmed |
| 请求输入 | `input` 支持字符串或消息数组；数组项为 user/assistant/system(EasyInputMessage)、`function_call`、`function_call_output`、`reasoning`、`web_search_call`、`ResponseOutputMessage` | documented + live_confirmed |
| 系统指令 | `instructions`，插入上下文起始位置 | documented |
| 原生工具 | `web_search`、`web_extractor`、`code_interpreter`，形式为 `{"type":"web_search"}` | documented + live_confirmed |
| 工具配对 | `web_extractor` 必须与 `web_search` 同一请求，否则 `InvalidParameter` | documented |
| 思考模式 | `code_interpreter` 在 qwen3.8-max / qwen3.8-flash 等模型上要求思考模式 | documented |
| 自定义函数 | `{"type":"function","name","description","parameters"}`，返回 `function_call` 项 | documented + live_confirmed |
| 响应对象 | `object:"response"`，`status: completed/incomplete/failed`，`output[]` | documented + live_confirmed |
| 原生工具输出项 | `web_search_call.action.{query,queries,sources[]}`；`web_extractor_call.{goal,urls[],output}`；`code_interpreter_call.{code,container_id,outputs[]}` | documented + live_confirmed |
| 流式 | SSE：`response.output_item.done`、`response.output_text.delta`、`response.completed/incomplete/failed` | documented + live_confirmed |
| 用量 | `usage.input_tokens/output_tokens/total_tokens`、`input_tokens_details.cached_tokens/cache_write_tokens`、`output_tokens_details.reasoning_tokens` | documented + live_confirmed |
| 工具用量 | `usage.x_tools.<tool>.count` 与顶层 `tool_usage.<tool>.num_requests` | documented + live_confirmed |
| 多轮 | `previous_response_id`（7 天有效）或完整 `input` 数组；本层固定 `store:false`，由 Agent Runtime 自建历史 | documented |
| 文件输入 | `input_file`（PDF 公网 URL，≤100MB，页数随 `ocr_options.task` 变化），仅 `qwen3.8-flash`/`qwen3.8-max`/`qwen3.5-ocr` | documented（本层未启用，标记待验证） |
| 计费 | 搜索 4 元/1000 次（北京）；网页抓取限免；单请求结算金额响应中不提供 | documented → 实际费用 `unavailable` |
| 错误 | HTTP 4xx/5xx；HTTP 200 但 `status:"failed"` | documented + live_confirmed |
| Chat Completions 区别 | 工具协议不同：Chat 用 `tools[].function` + `tool_calls`；Responses 用 `function_call`/`function_call_output` 项。两者互不套用 | 明确区分 |

未在官方文档明确、或被本层刻意关闭的能力：`background` 异步、`conversation` 会话对象、`file_search`、MCP 工具、`input_file`、`web_search_image`、`image_search`。这些保持 `unknown`，不启用。

---

## 2. 代码清单

新增：

| 文件 | 职责 |
|---|---|
| `admin/src/lib/assistant/contracts/native-tools.ts` | 原生工具证据版本化契约；公开 URL 校验（拒绝私网/环回）；提示注入标记；证据长度上限 |
| `admin/src/lib/ai/providers/bailian-responses-capabilities.ts` | 逐模型能力矩阵（Responses / Function Calling / 三种工具 / 流式 / 用量分开记录）；官方地址绑定；工具启用计划；部署开关 |
| `admin/src/lib/ai/providers/bailian-responses.ts` | 请求组装（Responses 项语义）、严格响应解析、SSE 增量消费/去重/中断终态机、用量/工具计数解析、请求与响应诊断 |
| `admin/src/lib/ai/providers/bailian-responses-retry.ts` | 错误分类与重试策略：只重放显式 429/503 预执行拒绝，遵循 `Retry-After` |
| `admin/src/lib/ai/providers/bailian-responses-evidence.ts` | 从响应项收集 web_search 来源、网页抓取文档、代码执行记录；注入信号；来源拒绝清单 |
| `admin/src/lib/ai/providers/bailian-responses-client.ts` | 单次真实请求执行：绑定校验 → 工具计划 → 组包 → 传输（含窄重试）→ 解析 → 证据与观察值 |
| `admin/src/lib/ai/__tests__/bailian-responses.test.ts` | 26 项离线单元测试 |
| `admin/scripts/bailian-responses-acceptance.ts` | 真实模型验收脚本（写出 `tmp/bailian-responses/`） |

修改（均为增量、默认行为不变）：

| 文件 | 改动 |
|---|---|
| `admin/src/lib/assistant/contracts/model.ts` | `ModelTurnOutput` 增加可选 `nativeTools`；`observation` 增加可选 `protocol` / `request` |
| `admin/src/lib/ai/providers/agent-chat.ts` | 新增 `responsesWireSelected`；仅在部署开关打开且输入契约适用时改走 Responses |
| `admin/src/lib/ai/postgres-workflow-chat.ts` | Responses 走线时不再构造 Chat 诊断体；成功回执写入 `nativeTools` |

---

## 3. 导出接口

```ts
// 能力与绑定
bailianResponsesBinding(baseUrl, model): BailianResponsesBinding | null
bailianResponsesModelProfile(model): BailianResponsesModelProfile
withLiveVerified(profile, verified): BailianResponsesModelProfile
planBailianResponsesTools(binding, requested, { thinking }): { enabled, rejected, thinkingRequired }
bailianResponsesEnabled(runtime, model, env?): boolean
bailianResponsesSettings(env?): { responsesApi, streaming, nativeTools }   // 唯一环境开关读取点
requestedNativeTools(env?): NativeToolName[]
bailianResponsesApplies(input): boolean

// 协议
bailianResponsesBody(input, { nativeTools?, stream? }): Record<string, unknown>
bailianResponsesRequestDiagnostic(body): ResponsesRequestDiagnostic
parseBailianResponses(payload, { requestId, nativeTools }): ModelTurnOutput
parseBailianResponsesUsage(payload): ModelTurnOutput['usage'] | null
parseBailianToolCounts(payload): Partial<Record<string, number>>
bailianResponsesResponseDiagnostic(payload, requestId)
consumeBailianResponsesStream(response, { onTextDelta?, onToolItem? }): Promise<{ payload, streamedText, deltaCount, terminal }>
readBailianResponsesStream(response, options?): Promise<Record<string, unknown>>   // 仅返回终态 payload

// 执行与重试
executeBailianResponses(runtime, input, { nativeTools?, stream?, onTextDelta?, onToolItem?, retryPolicy?, sleep?, now? }): Promise<ModelTurnOutput>
responsesWireSelected(runtime, input, env?): boolean   // agent-chat
bailianResponsesRetryPolicy(env?): { maxRetries, baseDelayMs, maxDelayMs }
bailianResponsesRetryDelay(error, retriesDone, policy): number | null

// 证据
collectNativeToolEvidence(payload, { requestId, tools, capturedAt }): NativeToolEvidence | null
```

返回值仍为标准 `ModelTurnOutput`，因此现有 Agent Runtime、检查点、报告投影无需改动；`nativeTools` 为可选增量字段。

---

## 4. 配置

### 4.1 环境变量

| 变量 | 取值 | 说明 |
|---|---|---|
| `ASSISTANT_RESPONSES_API` | `1` / 未设置 | Responses 走线总开关，默认关闭 |
| `ASSISTANT_NATIVE_TOOLS` | `web_search,web_extractor,code_interpreter` | 允许模型自主调用的原生工具集合，默认空 |
| `ASSISTANT_RESPONSES_STREAM` | `1` / 未设置 | 流式走线开关，默认非流式 |
| `ASSISTANT_RESPONSES_MAX_RETRIES` | `0` / `1`（默认）/ `2` | 显式 429/503 预执行拒绝后的额外尝试次数；越界值回落默认 |

`.env.example` 已包含上述四项（默认关闭）。API Key 不写入任何 env 文件：仍由既有 `ai_provider_configs` 加密记录提供，诊断与日志中不记录 Key、Authorization 或上游回显文本。

Provider 仍使用既有记录（`ai_provider_configs` / 平台 LLM 配置）：`adapter_type = openai_compatible`，`base_url` 必须命中官方 Responses 地址（`dashscope.aliyuncs.com`、`dashscope-intl.aliyuncs.com` 或 `*.{region}.maas.aliyuncs.com` 的 `/compatible-mode` 路径），API Key 使用既有加密存储。

### 4.2 模型能力登记

`bailianResponsesModelProfile(model)` 每条记录包含 8 个独立状态（`responses`、`functionCalling`、`webSearch`、`webExtractor`、`codeInterpreter`、`streaming`、`usageReporting` + 思考要求），状态只允许 `documented | live_verified | unsupported | unknown`。

- 未知模型：全部 `unknown`，原生工具一律不启用，仅可走已存在的 Chat Completions。
- 只有同一模型/同一工具的真实成功证据才能升级为 `live_verified`（`withLiveVerified` 只接受 `live_verified` 输入，不复制其他模型结果）。
- `deepseek-v4.1-flash`（非 `-1017`）在官方工具清单中未列出，保持 `unknown`，不因名称相近推断支持。

### 4.3 工具配置

- `web_extractor` 无 `web_search` 时直接拒绝（`requires_web_search`）。
- `code_interpreter` 在文档要求思考模式的模型（`qwen3.8-max`、`qwen3.8-flash` 等）上未开启思考时拒绝（`requires_thinking`）。
- 能力 `unknown/unsupported` 时在请求前拒绝（`capability_unknown` / `capability_unsupported`），不产生计费请求。

### 4.4 流式语义（R1-03）

- 文本增量只来自 `response.output_text.delta`，按到达顺序回调一次。
- `response.output_text.done` 重复整段文本，**不再回调**；终态 `response.completed/incomplete` 的 `response.output` 是唯一权威正文，避免"增量 + 终态"重复输出。
- 相同 `sequence_number` 且内容完全一致的重复帧只消费一次；编号相同但内容不同的帧不会被丢弃。
- 终态 payload 缺失 `output` 时，才用 `output_item.done` 项回填；连项事件都没有时，才用增量文本合成一条消息（只合成一次）。
- 流内 `error` / `response.failed` → `PROVIDER_RESPONSE_FAILED`；连接中断或 Abort → `PROVIDER_STREAM_INTERRUPTED`（unknown）；无终态事件 → `PROVIDER_STREAM_INCOMPLETE`。三者都不会标记为成功，也不会被重试。

---

## 5. 使用示例

### 5.1 由现有 Runtime 自动走 Responses（推荐）

```ts
process.env.ASSISTANT_RESPONSES_API = '1';
process.env.ASSISTANT_NATIVE_TOOLS = 'web_search,web_extractor';

// 运行时入口不变；报告终稿、咨询 profile、强制函数调用仍自动留在 Chat Completions
const output = await executeAgentChat(runtime, {
  model: 'qwen3.7-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: '查一下最新瓷砖国标编号' }] }],
  tools: [/* 家客来业务工具，继续由现有 Dispatcher 执行 */],
  maxTokens: 512,
  enableThinking: true,
});
output.nativeTools; // 来源、抓取文档、代码执行记录（如触发）
```

### 5.2 直接调用 Adapter

```ts
const binding = bailianResponsesBinding(runtime.baseUrl, 'qwen3.7-flash'); // null 表示不是官方地址
const output = await executeBailianResponses(runtime, input, {
  nativeTools: ['web_search', 'web_extractor', 'code_interpreter'],
  stream: true,
});
```

### 5.3 业务工具与原生工具协同

同一请求可携带不同名称的自定义函数与原生工具。模型返回 `function_call` 时由现有 Runtime 校验参数、权限和幂等，再以 `function_call_output` 回传。相同工具名在派发前拒绝。R3 应用联网轮由 R2 注册、执行和审计，百炼只运行模型。

### 5.4 流式增量消费

```ts
const output = await executeBailianResponses(runtime, input, {
  stream: true,
  onTextDelta: delta => process.stdout.write(delta),   // 每个增量只回调一次
  onToolItem: item => console.log(item.itemType),      // 仅工具项身份，不含内容
});
output.text; // 终态权威正文；不要与已输出的增量再次拼接
```

需要自建 SSE 入口时可单独使用 `consumeBailianResponsesStream(response, callbacks)`，它返回 `{ payload, streamedText, deltaCount, terminal }`；`readBailianResponsesStream` 保持只返回 payload 的兼容形态。

---

## 6. 异常与恢复规范

| 错误码 | disposition | 含义与处理 |
|---|---|---|
| `responses_binding_mismatch` | definitive_failure | 非官方 Responses 地址；不发送请求 |
| `native_tool_capability_unavailable` | definitive_failure | 模型/工具组合未登记或未验证；不发送请求 |
| `responses_input_invalid` | definitive_failure | 超出本地输入上限或工具配对非法；不发送请求 |
| `HTTP_429` / `HTTP_503` | safe_fallback | 限流/平台容量拒绝，未进入模型执行；按策略重试 |
| `PROVIDER_RESPONSE_FAILED` | unknown | HTTP 200 但 `status:"failed"` 或流内 `error` 事件；可能已计费，不重试 |
| `PROVIDER_TIMEOUT` | unknown | 传输超时；可能已受理，不重放 |
| `PROVIDER_STREAM_INCOMPLETE` | unknown | 流无终态事件；保留 unknown |
| `PROVIDER_STREAM_INTERRUPTED` | unknown | 流读取被中断/连接断开；保留 unknown |
| `INVALID_PROVIDER_RESPONSE` | unknown | 帧不合法；附带 `responses-response-diagnostic-v1` 与受控原始帧 |
| `HTTP_4xx`（429/408 除外） | safe_fallback | 明确拒绝，可按既有策略处理 |

重试策略（`bailian-responses-retry.ts`）：

- 仅重放 **HTTP 429（Throttling.*）与 HTTP 503（ServiceUnavailable）** —— 官方把它们定义为限流/平台容量拒绝，请求未进入模型执行。
- 优先使用响应头 `Retry-After`（秒或 HTTP 日期），否则 1s/2s/4s 指数退避；单次等待上限 4s。
- 默认只额外尝试 1 次，`ASSISTANT_RESPONSES_MAX_RETRIES` 允许 0..2。
- 超时、连接失败、500/502/504、流中断、流无终态、非法帧、`status:"failed"` 一律 **不重试**：执行状态未知，自动重放可能重复执行服务端原生工具并重复计费。
- 业务工具只在 Runtime 拿到完整响应后才执行，重试发生在响应之前，不会重复执行有副作用的业务操作。

每次尝试都会把 `observation.request`（哈希与形状）写入既有 `ai_provider_attempts`；发生重试时额外记录 `observation.retries`。

---

## 7. 审计数据格式

写入既有 `ai_provider_attempts.metadata`：

```json
{
  "assistantText": { "enableThinking": true, "maxTokens": 512, "cacheControl": null },
  "assistantWire": "responses",
  "assistantResponse": {
    "usage": { "inputTokens": 0, "outputTokens": 0 },
    "providerRequestId": "x-request-id",
    "finishReason": "stop",
    "observation": {
      "protocol": "responses",
      "latencyMs": 0,
      "request": { "protocol": "responses-request-diagnostic-v1", "payloadHash": "...", "tools": ["record_note","web_search"], "nativeTools": ["web_search"] }
    },
    "nativeTools": {
      "protocol": "bailian-native-tools-v1",
      "provider": "bailian-responses",
      "responseId": "resp_...",
      "requestId": "...",
      "calls": [
        { "tool": "web_search", "status": "completed", "queries": ["..."], "sources": [{ "url": "https://...", "title": null, "retrievedAt": "...", "accepted": true }] },
        { "tool": "web_extractor", "status": "completed", "goal": "...", "documents": [{ "url": "https://...", "hash": "...", "chars": 0, "injectionSignals": [], "trust": "external_unverified" }] },
        { "tool": "code_interpreter", "status": "completed", "code": "print(12**3)", "containerId": "...", "logs": "1728", "outputKinds": ["logs"] }
      ],
      "counts": { "web_search": 1 },
      "provenance": "mixed",
      "rejectedSources": [{ "url": "http://127.0.0.1/…", "reason": "unsafe_or_malformed_url" }]
    }
  }
}
```

诊断只保留哈希、字节数、结构、工具名与计数；不记录提示词、图片、工具参数、网页正文或凭据。

---

## 8. 安全边界

- 企业租户、用户身份、项目权限、会话上下文、业务工具参数校验与幂等：全部沿用现有链路，本层未新增任何数据访问。
- 原生工具是百炼服务端执行：`provenance` 明确标记 `external_public_web` / `provider_sandbox`；抓取文本带 `trust: external_unverified` 与注入标记，禁止自动进入企业知识库、客户可见引用或工地现场证据。
- 来源 URL 只接受公开 http(s)，私网、环回、带凭据或带端口的地址进入 `rejectedSources`。
- 代码解释器在百炼沙箱执行，家客来不在业务服务器 `eval` 任何模型代码；沙箱不接触家客来数据库、环境变量或文件。
- 报告终稿、验收放行、费用与工期承诺仍由原有责任人和审批边界决定。
- R3 应用联网开关及权限边界见第 11 节。R1 原生来源回执仍适用于独立验证与已配置的原生工具调用。

---

## 9. 真实验收结果（2026-11-12）

验收环境：本机开发环境已配置的百炼 Provider（`https://dashscope.aliyuncs.com/compatible-mode`），真实网络请求，无 mock、无重试、无模型回退。

汇总：`18` 个用例中 `15` 通过；`3` 条 `qwen3.8-max` 用例因账号未开通该模型返回 `HTTP_403`（同一模型在 Chat Completions 上同样 403，属账号/模型访问限制，不是适配层缺陷，也不影响其 `documented` 结论）。

| 用例 | 模型 | 结果 | 真实请求 ID | 工具计数 |
|---|---|---|---|---|
| Responses 基础请求 | qwen3.7-flash | 通过 | `b46e01d4-8b79-9a10-ba93-89c57fe9df2c` | - |
| Responses 基础请求（DeepSeek） | deepseek-v4.1-flash-1017 | 通过 | `649af88c-fcb6-918d-8007-a8eef3260eff` | - |
| 原生 Web Search | qwen3.7-flash | 通过 | `ad22a2ca-126e-906a-a17d-789fa283bce6` | `{"web_search":2}` |
| 原生 Web Extractor（含搜索） | qwen3.7-flash | 通过 | `4d8a5426-e0a5-916e-b3e3-1da10a85427c` | `{"web_search":1,"web_extractor":2}` |
| 原生 Code Interpreter（12³=1728） | qwen3.7-flash | 通过 | `5e3618e9-e131-95bf-9fa4-6ef532996b1a` | `{"code_interpreter":1}` |
| 多原生工具连续调用 | qwen3.7-flash | 通过 | `69f58f23-0f63-99cf-b9a5-730431f88ede` | `{"web_search":1,"code_interpreter":1}` |
| 自定义函数调用 | qwen3.7-flash | 通过 | `08912ef4-4ba3-97cf-8dfc-ba20e306e8b1` | - |
| 工具结果回传模型 | qwen3.7-flash | 通过 | `a74f02bb-ca93-987f-8483-416f7ce85181` | - |
| 流式完整事件 | qwen3.7-flash | 通过 | `ecb7995b-8ddd-92e5-87f4-40bf2db31f0a` | - |
| 流式中途中断 | qwen3.7-flash | 通过（AbortError） | - | - |
| 超时进入 unknown、不重放 | qwen3.7-flash | 通过（`PROVIDER_TIMEOUT`/unknown） | - | - |
| Chat Completions 回归 | qwen3.7-flash | 通过 | `bd301e2e-a2ea-9130-a205-dd1cc0bc77c9` | - |
| 运行时入口走 Responses（`executeAgentChat`） | qwen3.7-flash | 通过 | `870a86a0-42ed-935e-a514-4f7c0bdee524` | `{"web_search":1}` |
| Responses 基础请求 | qwen3.8-flash | 通过 | `fcfdb849-be0b-951c-a245-aea9f421144c` | - |
| Responses 基础请求（非 1017 别名） | deepseek-v4.1-flash | 通过 | `bdac2e3b-ecfc-9ec5-a817-8c8df714476f` | - |
| Responses 基础请求 | qwen3.8-max | 未通过：账号 `HTTP_403` | - | - |
| Web Search / Code Interpreter | qwen3.8-max | 未通过：账号 `HTTP_403` | - | - |

补充说明：

- 首轮与第二轮真实运行中，`web_search` 与运行时集成用例曾各出现一次 90s 传输超时；按规范保留为 `unknown`，未自动重放。随后以独立验收运行重新取证（`report-attempt2.json`），两次尝试均记录在案。
- 实际费用：账单结算金额在响应中不可得，统一记为 `unavailable`；token 用量与工具调用次数完整记录，不填零。
- 文件输入（`input_file`）按文档仅对 `qwen3.8-flash`/`qwen3.8-max` 可用，本层未启用，标记待验证；代码解释器文件型输出同样待验证（本次仅验证 `logs` 输出）。

### 9.1 流式增量复验（2026-11-12，本轮）

| 用例 | 模型 | 结果 | 真实请求 ID | 说明 |
|---|---|---|---|---|
| 流式增量 + 终态一致 | qwen3.7-flash | 通过 | `b5bcaf3f-f8a7-91a3-9003-db35f28cb97d` | 收到 48 个增量字符，去重后与终态 `output` 文本一致 |
| 流式中途中断 | qwen3.7-flash | 通过（AbortError） | - | 首个事件后主动中断，未标记成功 |

复验命令：`npx tsx scripts/bailian-responses-acceptance.ts --only=streaming --tool-model=qwen3.7-flash --label=<label>`。
本轮新增的重试分类、429/503 重放、`Retry-After`、超时/401/流中断不重放等均以离线单元测试覆盖；未对真实限流做人为触发，避免影响账号配额。

证据与台账：

- `tmp/bailian-responses/report.json`：主报告（含每次尝试的真实请求 ID、用量、工具计数、文本摘要）
- `tmp/bailian-responses/capabilities.json`：运行期能力台账（仅真实通过的模型/工具组合为 `live_verified`）
- `tmp/bailian-responses/raw/*.json`：逐用例原始证据（请求诊断、响应项、工具证据）
- 仓库内归档：[docs/evidence/bailian-responses-report.json](evidence/bailian-responses-report.json)、[docs/evidence/bailian-responses-capabilities.json](evidence/bailian-responses-capabilities.json)

上线后能力矩阵以 `capabilities.json` 为准；代码内 `documented` 是出厂默认值，未知模型一律 `unknown` 且不启用原生工具。

复现命令：

```bash
cd admin
npx tsx scripts/bailian-responses-acceptance.ts
# 指定模型、工具模型、超时或补充验收：
npx tsx scripts/bailian-responses-acceptance.ts --models=qwen3.7-flash,deepseek-v4.1-flash-1017
npx tsx scripts/bailian-responses-acceptance.ts --only=web_search,code_interpreter --tool-model=qwen3.7-flash
npx tsx scripts/bailian-responses-acceptance.ts --only=access --tool-model=qwen3.8-max   # 区分账号访问限制
```

---

## 10. 给两个业务分支的集成指引

### 10.1 交付提交

| 提交 | 内容 |
|---|---|
| `5b052a60` | 适配层、能力矩阵、原生工具证据、运行时接入、16 项单元测试 |
| `e0e14bda` | 真实验收脚本、交付文档、验收报告与能力台账 |

分支：`codex/xiaok-bailian-responses-api`，交付时 HEAD `e0e14bda`；创建基线 `11ac22dd`（当时 `origin/codex/xiaok-native-workflow` 最新）。

集成时的目标分支 HEAD（本次核对）：`codex/xiaok-native-workflow` = `340d57ee`，`codex/xiaok-public-site-lifecycle` = `569f8cde`。

已在两个目标 HEAD 上分别用 `git cherry-pick -n 5b052a60 e0e14bda` 预演，三个集成文件（`contracts/model.ts`、`providers/agent-chat.ts`、`postgres-workflow-chat.ts`）在这段时间内无变更，两处预演均零冲突。

### 10.2 集成步骤

1. 取目标分支最新 HEAD，单独 cherry-pick 上述两个提交，不要整分支合并。
2. 手工检查三处增量：
   - `contracts/model.ts`：`nativeTools`、`observation.protocol`、`observation.request` 为可选字段；
   - `providers/agent-chat.ts`：`responsesWireSelected` 与 `executeAgentChat` 入口分支；
   - `postgres-workflow-chat.ts`：Responses 走线时跳过 Chat 诊断体，成功回执写入 `nativeTools`。
3. 在目标分支运行：
   - `npx tsx --test src/lib/ai/__tests__/bailian-responses.test.ts`
   - 既有 ai / assistant 回归测试（本次 225 项全通过）
   - `npx tsx scripts/bailian-responses-acceptance.ts --only=basic`
4. 上线顺序：先部署适配层（两个环境变量保持关闭，行为与现状一致）→ 验证 Chat Completions 回归 → 按模型逐个开启 `ASSISTANT_RESPONSES_API` 与 `ASSISTANT_NATIVE_TOOLS`。
5. 回滚：关闭两个环境变量即可回到原 Chat Completions 走线，无需回滚代码。

## 11. R3 应用联网搜索

百炼在所支持的模型及地域通过 `tools: [{ "type": "web_search" }]` 提供原生搜索。完成的 `web_search_call` 输出项中，`action.query` 为查询，`action.sources[]` 为带 `type: "url"` 与 `url` 的来源列表。流式状态为 `response.web_search_call.in_progress`、`searching`、`completed`，完整项由 `response.output_item.done` 返回；次数可见 `usage.x_tools.web_search.count`。网页抽取通过同请求中的 `web_extractor` 与 `web_extractor_call` 项。原生 Responses 无 `enable_source`、`enable_citation` 或 `citation_format` 控件。[创建响应](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses) · [百炼联网搜索](https://help.aliyun.com/zh/model-studio/web-search)

应用端需要逐次权限校验、候选筛选、可重开的原文和引用，因此 R3 复用既有 LangGraph Worker 的工具节点和持久化接口，将四个工具接到 R2 `ToolRegistry` / `ToolExecutor`。模型规划查询；有剩余工具轮时，新的候选批在回答前需要一次读页尝试。发给模型的发现结果只含标题、网址、域名及来源分类。收尾使用已读正文与失败状态，引用 ID 由原 `Evidence` 管线装配。普通问题可直接走原终稿。Responses 工具轮使用 `function_call` 和 `function_call_output`，单工具轮用 `tool_choice: "required"`。终稿轮沿 Chat Completions 结构化通道。I6 实调确认百炼原生 `web_extractor` 是按目标生成的摘要，输出顺序可与 `urls[]` 不同。来源标记无法归属时保留未归属计数，C01 的原文取应用读页。[创建响应](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-responses) · [LangGraph 工具节点](https://langchain-ai.github.io/langgraphjs/reference/classes/langgraph.prebuilt.ToolNode.html)

### 配置与边界

- `ASSISTANT_WEB_SEARCH_TOOLS=1` 对已有网页读取权限的原生 Agent 会话启用。选定 FastGPT 编排、专用咨询配置及专用终稿流程沿各自部署配置。应用联网与 `ASSISTANT_RESPONSES_API` 独立配置。
- `ASSISTANT_WEB_SEARCH_PROVIDER` 可选 `searxng`、`ddgs`、`openserp`。由部署方设置 `ASSISTANT_WEB_SEARCH_URL`，密钥留在部署管理范围。SearXNG 验证使用自托管实例和搜狗、360；配置了新闻引擎的实例可设 `ASSISTANT_SEARXNG_NEWS=1` 提供 `web_search_news`。批量最多三个不同查询。[SearXNG Search API](https://docs.searxng.org/dev/search_api.html) · [DDGS API 源码](https://github.com/deedy5/ddgs/blob/main/ddgs/api_server/api.py)
- `web_fetch` 可读当轮公开候选或用户给出的公开网址。连接前验证协议、地址和 DNS，逐跳固定公网地址，重定向重新验证。搜索和读页各限 12 秒、响应 512,000 字节；正文限 12,000 字节；同进程同时执行最多八个请求。静态 HTML、XHTML 和纯文本读取支持编码识别与导航广告过滤。依赖脚本渲染、付费登录、PDF 或超限原文会返回不可用。
- 来源保留原始请求网址、最终网址、域名、发布与检索时间。域名只给出来源分类；重复正文和同题不同正文、日期的候选有标记。疑似注入内容隔离，合法外部内容仍按不可信数据处理。搜索摘要只用于导航，引用依赖可读、已保存的原文与当前会话权限。企业规范依赖已有企业知识权限及有效来源。

### 验证

在已应用迁移的隔离环回数据库 `xiaok_r3_acceptance` 中使用合成微云 1454。以下命令在 `admin` 运行，`XIAOK_R3_DATABASE_URL` 设为该数据库的应用账号连接串；真实模式沿用已有百炼凭据和部署搜索服务。

```powershell
node --env-file=.env.local --import tsx scripts/xiaok-r3-web-acceptance.ts --label=mock-review
node --env-file=.env.local --import tsx scripts/xiaok-r3-web-acceptance.ts --live --label=live-review
```

原始运行、工具回执、来源及请求 ID 记录在 `tmp/assistant-web-r3/`。模拟与真实运行各用全新的隔离数据库。真实用量取供应商回执，结算金额保持 `unavailable`。

| 验证 | 结果 |
|---|---|
| R1、R2、R3 定向 | 67/67，含权限拒绝、注入隔离、超时、重复、空结果和引用审计 |
| 模拟供应商与真实隔离数据库 | `mock-04` 4/4，含搜索/读页结果接续、引用保存、重进、跨租户拒绝及伪造链接拒绝 |
| AI 与 Assistant 单元套件 | 1131/1132，书桌需求意图用例在起始提交 `bc8daf73` 同样失败 |
| 全量类型检查 | 起始提交与交付版均有同样的 290 条诊断，差集为零 |
| 构建 | Turbopack 在 Windows 创建 junction 时返回 OS error 87。Webpack 完成生产编译，完整构建停在既有 `scripts/fastgpt/setup-unified.mts:113` 类型错误 |
| 真实联调 `live-03` | 普通问答 2/2，搜索 0 次。四类专业问题各跑两次，8/8 取得实际搜索结果并回传模型，6/8 读取并保存公开原文，8 份终稿均因 `unsupported_model_commitment` 被拦截，专业回答验收未通过 |

`live-01` 的设计师与市场题各保存一份带第三方网页链接的答复。设计师答复缺厂家原文并含未证量数；市场题证明第三方网页原文与引用可落库。`live-02` 保留 Responses 单独终稿的实际数组类型错误。三个批次的源码绑定前后一致，证据分别保留。`live-03` 记录 36 次模型调用，观测 116384 输入和 23397 输出 tokens。原生设备、四角色入口及真实新闻源未验。

## 12. R4 企业知识库

百炼北京业务空间为每个企业创建独立托管知识库，使用内置向量存储和 `text-embedding-v4`。导入沿上传租约、OSS PUT、文件注册、解析状态、显式单文件索引、任务状态和切片读取。应用通过 `Retrieve` 获取向量与关键词召回，由原小 K Agent 组织回答。托管接口的混合分数默认阈值为 0.12，可按调用调整。已有中文词法支持关键词模式，重排序可在已授权候选上接入。纯向量模式由显式本地 Provider 提供。[RAG API 概览](https://help.aliyun.com/zh/model-studio/rag-api-overview) · [创建知识库](https://help.aliyun.com/zh/model-studio/rag-api-create-index) · [切片列表](https://help.aliyun.com/zh/model-studio/rag-api-list-chunks) · [直接检索](https://help.aliyun.com/zh/model-studio/rag/channels)

- `ASSISTANT_KNOWLEDGE_PROVIDER=bailian` 是默认模式。Admin API 和知识任务 Worker 使用相同的 `ASSISTANT_BAILIAN_RAG_WORKSPACE_ID`、`ASSISTANT_BAILIAN_RAG_API_KEY`、`ASSISTANT_BAILIAN_RAG_CATEGORY_ID` 和 `ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL`。数据类目默认 `default`，模型默认 `text-embedding-v4`，也可在创建新索引前配置 `qwen3.7-text-embedding`。现有索引的工作空间及向量模型固定。`local` 兼容已有 Embedding Gateway 与 pgvector；现存本地版本可走兼容模式，托管模式的混合检索以托管发布版本为范围。迁移 `0121`、`0122` 增加项目作用域和企业/版本托管映射。历史 `0060` 的新库执行允许纯 PostgreSQL，已执行的库由增量迁移保留现有向量列。[百炼鉴权](https://help.aliyun.com/zh/model-studio/rag-api-authentication)
- 原件及管理授权在应用内保存。导入接受文字 PDF、DOCX、TXT、Markdown、XLSX。保留章节、原段或行、表格坐标和可读图文定位。扫描页通过 OCR 导入接口进入人工审阅，旧 DOC 先转换。含排除块的文件仅发送审阅通过的文本；整件下载仍按原有权限检查。切片引用使用匹配的完整本地原条款和经核验的页码。索引完成后校验工作空间、索引、文档与原片段哈希。无法对齐的文档保留为未就绪。
- 管理员先索引草稿，再发布或切换有效版本。重索引从复制草稿开始。企业隔离由复合外键、强制 RLS 和独立百炼索引共同实施。项目范围、角色、受众、分类、版本与有效期先在服务端筛出允许的版本标签，检索回包再对照实时授权、标签、映射和原片段哈希。撤回和版本替换在本地事务更新知识 epoch，Worker 后续删除已绑定的百炼索引文档及数据中心文件。应用保留版本历史、原件和请求回执。未知写入结果进入待核对状态。[SearchFilters](https://help.aliyun.com/zh/model-studio/how-to-use-search-filters) · [删除文档](https://help.aliyun.com/zh/model-studio/rag-api-delete-document)
- 四个 R2 只读工具 `knowledge_search`、`knowledge_get_document`、`knowledge_get_source`、`knowledge_search_by_category` 使用统一 Evidence 权限校验。企业条款、项目实际记录和公开网页保留各自来源；企业标准冲突要呈现不同依据及适用范围，缺少证据时报告未检索到对应标准。托管请求用量和账单缺失时保留未知值。

### 验证入口

在 `admin` 使用已迁移的独立环回数据库 `xiaok_r4_acceptance`。环境变量 `XIAOK_R4_DATABASE_URL` 指向该数据库应用角色连接，夹具包含合成微云 1454、对照租户及已核验的 PPT 工艺摘录。

```powershell
node --env-file=.env.local --import tsx scripts/xiaok-r4-rag-acceptance.ts --label=mock-review
node --env-file=.env.local --import tsx scripts/xiaok-r4-rag-acceptance.ts --live --label=live-review
node --env-file=.env.local --import tsx scripts/xiaok-r4-bailian-embedding.ts
```

同步 Embedding 独立测量使用 6 条中文查询、8 条材料和 3 轮重复。`qwen3.7-text-embedding-flash` Top‑1 18/18，单次请求中位 221 ms，1500 输入 tokens，按北京公开单价估算 ¥0.0001875。`text-embedding-v4` Top‑1 18/18，中位 205 ms，927 tokens，估算 ¥0.0004635。`qwen3.7-text-embedding` 首次请求返回 `AllocationQuota.FreeTierOnly`，停止该模型后续轮次。托管建库默认采用官方接口示例所列的 V4。托管工作空间及专用 API Key 缺失，真实预检在请求前返回 `bailian_knowledge_not_configured`。实际结算金额待账单核对。原始测试回执在 `admin/tmp/r4/`。[向量同步接口和北京计价](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)


| 范围 | 执行结果 |
|---|---|
| 百炼 RAG Mock 与真实 PostgreSQL 17 | 12/12，含六个 PPT 问答场景、权限变更时正在执行的检索、跨租户回包、PDF 第 2 页、发布替换和云端删除回读。数据库未安装 pgvector |
| R1–R4 定向 | 128/128。R1 另有 3 次真实 Responses/函数回传成功，R3 的真实 SearXNG 搜索返回 3 条结果。联网正文保存与重开由 RAG Mock 回归覆盖 |
| 本地兼容 Provider | 真实开发 Embedding Gateway 与隔离 pgvector 9/9。Assistant 隔离数据库回归按测试额度配置运行 22/22 |
| AI 与 Assistant 单元 | 1139/1140，既有书桌收纳意图用例失败 |
| 类型与构建 | tsc 与基线均有 290 项诊断，差集为零。Webpack 生产编译通过，整包在既有 `scripts/fastgpt/setup-unified.mts:113` 类型错误处停止 |
| 真实托管 RAG | 北京业务空间及托管 API Key 缺失，上传、索引、Retrieve 和多轮模型联调待完成 |

## 13. R6 工艺检索与原生复核

同一 C01 沿 R2 工具返回获权原文，引用绑定当前文档版本。无授权召回时，结构化终稿 schema 允许空引用数组并限制为建议或缺项说明，避免空 `enum` 触发百炼 Chat Completions 的 HTTP 400。Responses 工具轮和结构化终稿沿原通道。持续委托的工艺核对与人工结果分别保存在原事件回执和施工复核服务。

R6 配置预检仍缺北京工作空间与专用 API Key，未提交真实托管请求。R6 隔离库及 Stable 证据、真实 Responses 与本地检索的结果见[原生复核合同](xiaok-assistant-phase-2.zh-CN.md#r6-原生施工复核与托管知识)。[百炼 Responses 协议](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses) · [百炼 Retrieve](https://help.aliyun.com/zh/model-studio/rag/channels)

I6 在原 R6 验收入口使用 `--local-knowledge --durable-integration` 验证真实 Embedding/pgvector、项目权限、版本替换、撤回和原咨询回传。该模式的对话模型为替身。托管混合检索在授权后预检配置，缺项记录 `bailian_knowledge_not_configured` 并投影为资料暂不可用。已配置但无获权命中返回空证据。当前托管接入仍为 Limited。[I6 检索和委托证据](xiaok-integration-audit.md#i62-本地企业知识与持续委托)
