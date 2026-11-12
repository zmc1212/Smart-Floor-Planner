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
| `admin/src/lib/ai/providers/bailian-responses.ts` | 请求组装（Responses 项语义）、严格响应解析、SSE 终态机、用量/工具计数解析、请求与响应诊断 |
| `admin/src/lib/ai/providers/bailian-responses-evidence.ts` | 从响应项收集 web_search 来源、网页抓取文档、代码执行记录；注入信号；来源拒绝清单 |
| `admin/src/lib/ai/providers/bailian-responses-client.ts` | 单次真实请求执行：绑定校验 → 工具计划 → 组包 → 传输 → 解析 → 证据与观察值 |
| `admin/src/lib/ai/__tests__/bailian-responses.test.ts` | 16 项离线单元测试 |
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
requestedNativeTools(env?): NativeToolName[]
bailianResponsesApplies(input): boolean

// 协议
bailianResponsesBody(input, { nativeTools?, stream? }): Record<string, unknown>
bailianResponsesRequestDiagnostic(body): ResponsesRequestDiagnostic
parseBailianResponses(payload, { requestId, nativeTools }): ModelTurnOutput
parseBailianResponsesUsage(payload): ModelTurnOutput['usage'] | null
parseBailianToolCounts(payload): Partial<Record<string, number>>
bailianResponsesResponseDiagnostic(payload, requestId)
readBailianResponsesStream(response): Promise<Record<string, unknown>>

// 执行
executeBailianResponses(runtime, input, { nativeTools?, stream?, now? }): Promise<ModelTurnOutput>
responsesWireSelected(runtime, input, env?): boolean   // agent-chat

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

同一请求内可同时携带 `tools:[{type:'function',...}]` 与原生工具。模型返回 `function_call` 时仍由现有 Runtime 校验参数、权限、幂等并执行，再用 `function_call_output` 回传；百炼服务端工具不会获得家客来业务权限。

---

## 6. 异常与恢复规范

| 错误码 | disposition | 含义与处理 |
|---|---|---|
| `responses_binding_mismatch` | definitive_failure | 非官方 Responses 地址；不发送请求 |
| `native_tool_capability_unavailable` | definitive_failure | 模型/工具组合未登记或未验证；不发送请求 |
| `responses_input_invalid` | definitive_failure | 超出本地输入上限或工具配对非法；不发送请求 |
| `PROVIDER_RESPONSE_FAILED` | unknown | HTTP 200 但 `status:"failed"` 或流内 `error` 事件；可能已计费，不重试 |
| `PROVIDER_TIMEOUT` | unknown | 传输超时；可能已受理，不重放 |
| `PROVIDER_STREAM_INCOMPLETE` | unknown | 流无终态事件；保留 unknown |
| `INVALID_PROVIDER_RESPONSE` | unknown | 帧不合法；附带 `responses-response-diagnostic-v1` 与受控原始帧 |
| `HTTP_4xx`（408 除外） | safe_fallback | 明确拒绝，可按既有策略处理 |

统一原则：一次调用只发一次请求，不自动重试、不切换模型；result 未知时保留尝试记录并停止，等待人工或既有恢复流程。每次成功/失败都会把 `observation.request`（哈希与形状）写入既有 `ai_provider_attempts`。

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
- 现有自建 Web Search / `read_web` 未被删除或替换；两者互不影响。

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

1. 单独 cherry-pick 本分支的适配层提交，不要整分支合并。
2. 冲突面仅三处：`contracts/model.ts`（增量字段）、`providers/agent-chat.ts`（入口分支）、`postgres-workflow-chat.ts`（诊断与回执）。三处均为可选增量，冲突时保留目标分支原有逻辑，仅追加新分支判断。
3. 集成后在目标分支自行运行：`npx tsx --test src/lib/ai/__tests__/bailian-responses.test.ts` 与既有回归测试。
4. 上线顺序：先部署适配层（开关关闭，行为不变）→ 验证 Chat Completions 回归 → 再按模型逐个打开 `ASSISTANT_RESPONSES_API` 与 `ASSISTANT_NATIVE_TOOLS`。
5. 回滚：关闭两个环境变量即可回到原 Chat Completions 走线，无需回滚代码。
