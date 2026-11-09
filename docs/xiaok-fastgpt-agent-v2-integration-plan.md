# 小K FastGPT Agent V2 集成开发计划（专项提案）

> 状态：F0/F1/F2/F3 已在开发环境实施并按 bounded 范围验收（2026-11-09）；默认与生产未切换。
> 本文件不改变
> [`docs/xiaok-renovation-agent-development-plan.md`](./xiaok-renovation-agent-development-plan.md)
> 第 2 节的唯一执行入口，也不另立并行任务队列。当前交付与证据以该节为准；本文件
> 只描述 F0–F3 实现边界与后续限制。

## 1. 结论与依据

**思路合理。** FastGPT 只负责理解、编排、回答、开场白/猜你想问和技能内容；当前项目继续
负责授权、知识检索、业务动作、引用、持久任务、计量、审计和人工接管。这不是把 Agent
整体搬走，而是把“编排/表达层”换掉。

2026-11-09 隔离 A/B（DeepSeek V4 Flash、同一 5 问、微云 1454）显示：

- FastGPT 平均 3.5s / 4,635 tokens；内置 26.8s / 8,600 tokens。FastGPT 约快 7.6 倍、省 46% tokens。
- 两者知识页命中均 4/4，自主调用 `DatasetSearch`/`query_business` 均正确。
- FastGPT 消息引用为 0，内置 4/4 可点击页码引用；FastGPT 出现 2 次无工具支撑的动作承诺。
- 内置 q5 校验失败后回退原始预约文本，暴露内部 ID/ISO 时间，需一并修复。

因此：**只搬编排/回答可以，但网关、引用协议和回答校验是前置条件，不是可选优化。**
仓库已有同类边界的实现基础：`admin/src/lib/assistant/fastgpt/unified-worker.ts`、
`native-rag.ts`、`runtime.ts`、`rag-config.ts`。

## 2. 目标架构

```text
小程序 / 后台
  └─ 现有 /api/assistant/*（登录、租户、会话、权限）
       └─ ConversationService + assistant_runs/jobs（本项目的唯一事实源）
            └─ processAnswer: runtime = fastgpt-agent-v2
                 └─ FastGPT Gateway（服务端持有 API Key）
                      ├─ FastGPT Agent V2 App（编排/回答/开场白/猜你想问/技能）
                      ├─ HTTP 工具 knowledge.search → 回调桥 → KnowledgeRetriever/Evidence
                      ├─ HTTP 工具 query_business   → 回调桥 → 现有业务服务
                      └─ 返回文本块、工具调用、真实 usage、[id](CITE) 引用标记
                 └─ 现有校验/引用保存/消息落库/任务完成
```

### 2.1 职责边界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| FastGPT Agent V2 | 意图理解、工具选择、回答组织、开场白文案、猜想问生成、技能 SOP 内容 | 租户/用户身份、知识授权、业务写动作、引用可用性、任务持久化、费用结算 |
| 当前项目 | 登录/租户/成员、KnowledgeRetriever/Evidence、业务服务与回执、引用保存与撤回、run/job/usage/audit、人工接管 | 不重复实现通用对话编排 |
| 小程序 | 只调本项目 API，渲染现有聊天/欢迎界面 | 不直连 FastGPT，不持有 FastGPT 凭证 |

### 2.2 一次请求

1. 小程序调用现有会话/发送接口；`ConversationService` 创建 run/job，策略快照记录 `fastgpt-agent-v2`。
2. `processAnswer` 选择新运行时，由 Gateway 组装本轮历史和企业/用户绑定；桥密钥只存在部署配置和服务端静态头，不进入对话。
3. Gateway 调用 FastGPT `chat/completions`；Agent 通过 HTTP 工具回调本项目授权接口。
4. Gateway 校验回答、保存引用/消息/usage，`completeRun` 交付；小程序沿用现有轮询/重进。
5. FastGPT 的 chatId 仅用于本次 run 的上下文，不作为消息事实源；不复制一份长期会话到 FastGPT。

## 3. 复用与新增

**复用（不重写）**

- `ConversationService`、`processAssistantRun`、job/lease、`runContext`、`completeRun`/`failRun`、usage 记录。
- `KnowledgeRetriever`/`Evidence`、`retrieveKnowledge`、`resolveEvidence`、`synthesisContextAvailable`、`saveKnowledgeCitation`。
- `[id](CITE)` 引用解析协议（`fastgpt/native-rag.ts` 的 `ragAnswerParts`）和现有引用 chips。
- `query_business` 参数/结果语义（`agent/business-tools.ts`），归档 lead 过滤、角色/租户检查。
- `fastgpt/runtime.ts` 的本地回调桥、`native-rag.ts` 的 run ticket/HMAC 模式、`unified-worker.ts` 的工具回调与 citation catalog。

**新增**

- `fastgpt/agent-v2/`：Gateway、运行时策略、FastGPT 应用配置绑定、回答校验、usage 映射。
- 内部工具回调路由（仅服务端可达）：`knowledge.search`、`query_business` 及后续业务工具。
- 开场白/猜你想问的配置读取与生成服务；技能包目录与版本绑定。

**明确不复用**

- 评测期匿名 bridge、临时 FastGPT 应用、固定 source 全量准入（`rag-config.ts` 的 ≤100 条白名单只适用于既有 RAG 实验）。
- 小程序直连 FastGPT，或把 FastGPT 当第二事实库。

## 4. 工作流

| 阶段 | 交付 | 完成条件 |
| --- | --- | --- |
| **F0（已完成）** | Gateway + `fastgpt-agent-v2` 运行时开关 + 知识检索工具 + `[id](CITE)` 引用 + 回答落库/重进 | 4 个 PPT 工艺问走真实服务；页码引用 4/4；撤权后无内容；无证据明确说未知；失败可重进；内置运行时仍可回退 |
| **F1（已完成）** | 业务工具 `query_business`（预约/方案/户型/施工）+ 动作/字段校验 | 第 5 问；跨租户/他客拒绝；归档 lead 排除；不泄露内部预约 ID/ISO 时间；无工具支撑的动作承诺为 0 |
| **F2（已完成）** | 开场白 + 猜你想问 | 欢迎语/预设问题由配置提供；猜你想问按本轮回答生成并缓存，失败回退预设；不改变已批准欢迎页视觉，新增动态 chips 需设计批准 |
| **F3（已完成，当前交付）** | 技能包 + 灰度 | 3–5 个 SOP 技能可版本化、可停用；不绕过工具权限；1454 显式启用，5 问 + 权限/撤回/失败矩阵通过；默认与生产不切换 |

**F0 状态（2026-11-09）：实现完成，bounded 验收完成。** 4 个 PPT 工艺问在 f0-03 中通过真实服务保存并分别引用第17/18/19/21页；无证据问题无引用；文档2511撤权使依赖答案全部不可用、恢复后可读；绑定不匹配失败停在派发前、重试成功；f0-08运行11090证明移除开关后内置运行时以`agentRuntime:null`正常回答。保留失败：f0-03回退11083（旧驱动进程内改写运行文件，产品漂移守卫fail-closed）、f0-04 FastGPT臂403 `AllocationQuota.FreeTierOnly`（外部配额）、f0-05/06/07/09内置qwen内容校验拒绝。未因失败重采样或换模型；F1 开始前不重跑同一答案批次。

**F1 状态（2026-11-09）：实现完成，bounded 验收完成。** `query_business` 已接入 `/agent-v2-tool/*` 与 Agent V2 工具回调：严格接收 `domain`/`leadId` 两字段，非法 domain 或多余/缺失/重复字段 422；绑定 lead 的会话拒绝查询其他 lead，归档/他客/跨租户记录统一 404；同一查询去重并记入独立 `agent_tool` 步骤。业务回答只交付授权快照的客户可读文本（项目、状态、北京时间），模型草稿仅留在 1006 审计，不泄露内部 ID、版本或 ISO 时间；无业务快照的自由文本继续复用既有承诺/价格守卫。f1-03（runs 11096–11106）以确定性模拟 FastGPT 传输经真实 18310 桥、真实服务/DB 和持久化验收：第 5 问 2 条预约且归档 1724/预约 254 不出现；空结果如实；归档/他客/跨租户/绑定 lead 均拒绝；非法字段 422；无工具承诺 `unsupported_model_commitment`；交付前快照变更 `context_changed`；知识搜索、引用、幂等、重进回归通过。f1-01/02 为驱动断言错误（UTC+8 预期换算、读错审计字段路径），原批保留。真实模型第 5 问仍待 FastGPT 渠道外部 `AllocationQuota.FreeTierOnly` 恢复，未重采样，不宣称该臂通过。

**F2 状态（2026-11-09）：实现完成，bounded 验收完成；仅配置/接口能力，无可见 UI 变更。** 绑定配置新增可选 `welcome`/`presets`/`suggestionAppId`，严格校验；`entry-context` 仅在配置存在时附加 `welcome`/`presetQuestions`，不暴露 appId、模型或桥密钥，配置损坏时降级不阻塞入口。回答完成后由独立无工具、同模型的 FastGPT 应用做一次受约束生成（输入仅本轮已交付文本，剥离 CITE 标记，不带历史/身份/内部 ID），严格解析 3–4 条；provider 失败或输出不合格回退配置预设，答案照常交付。建议存入 run step 1007 `agent_suggestions`（`questions`+`source`），经 `GET /api/miniprogram/assistant/conversations/:id/suggestions` 读取，按最新已交付答案缓存/失效，retention 脱敏会话仅返回预设；usage 单独记 `suggestion_tokens`（observed/unavailable），不混淆答案 `tokens`，未知建议用量不把 run 判成 provider 结果未知。f2-02（runs 11112–11116）以确定性模拟传输经真实桥/服务/DB 验收：入口欢迎语/3 条预设正确且无部署内部字段；搜索+引用回归；业务快照回答与基于交付文本的建议并存；provider 500 与短输出均回退预设且分别记 unknown/observed；同会话后续答案使缓存失效；失败运行不生成建议、接口如实返回预设；他客读取建议 404。f2-01 为驱动缺陷（越权检查用了过期用户上下文版本，401 `identity_context_invalid`；该批 F2 业务断言均已通过），修正驱动后另批 f2-02，原批保留。真实模型建议质量仍待 FastGPT 渠道外部 `AllocationQuota.FreeTierOnly` 恢复，未重采样。可见 chips 未实现，需先补设计源并获批。

**F3 状态（2026-11-09）：实现完成，bounded 验收完成；仅技能内容与运行绑定，不新增工具或权限。** 新增项目自有版本化 SOP 目录 `agent-v2/skills.ts`（包版本 `v1`，含施工阶段提醒、验收要点、量房预约、项目进度、日周报追问 5 个技能）；私有运行文件以 `skills:{version:'v1',enabled:[...]}` 选择，随运行绑定一起固定，未配置或 `enabled:[]` 即停用，未知版本/ID、重复或非字符串项 `context_changed` fail-closed。启用技能只作为一条前置 `system` 消息进入模型请求，明确声明不授予任何工具、权限或业务动作；事实、来源和动作仍只来自授权工具，不新增工具、检索路径、沙箱、网络或文件访问；选择记入 run step 1006 和供应商审计。f3-03（runs 11119–11128）以确定性模拟传输经真实 18310 桥、服务/DB 和持久化通过：4 个 PPT 工艺问分别引用第17/18/19/21页；第 5 问只交付授权预约快照且模型草稿承诺未交付；承诺守卫、供应商失败、绑定 lead/非法 domain/归档 lead/他客拒绝、撤权隐藏/恢复、停用/空/部分选择、绑定/票据/桥密钥隔离均按约定。f3-01/02 为驱动断言错误（提示词按技能标题展示，驱动断言技能 ID），原批保留。真实模型技能质量仍待 FastGPT 渠道外部 `AllocationQuota.FreeTierOnly` 恢复，未重采样。技能仅对 1454 显式启用；默认 Worker/配置/路由/schema/UI 与生产均未切换。

**F0/F1/F2/F3 均为已完成交付。** 本计划当前阶段结束；真实模型臂仍受外部渠道配额限制，默认/生产切换、可见 UI 新设计均需单独明确授权。

## 5. 开场白、猜你想问、关联技能

- **开场白**：文案/预设问题随绑定运行时配置提供，由本项目 `entry-context` bootstrap 附加下发（`welcome`/`presetQuestions`，缺省不附加）；继续使用已批准的笔记本欢迎页和 3 张话题卡，不新造布局。F2 未改小程序欢迎页代码。
- **猜你想问**：补全接口不返回动态问题（本次 A/B 已确认），因此由 Gateway 在回答完成后用独立无工具、同模型的 FastGPT 应用做一次受约束生成，输入仅本轮已交付文本（剥离 CITE、限长、不带历史/身份/内部 ID），输出 3–4 条并严格解析；失败回退配置预设且不影响答案交付。结果缓存于 run step 1007 `agent_suggestions`，按会话最新已交付答案读取/失效，`GET /api/miniprogram/assistant/conversations/:id/suggestions` 只返回 `conversationId`/`messageId`/`source`/`questions`；usage 记 `suggestion_tokens`。若要在聊天气泡下新增动态 chips，属于可见 UI 变更，先走设计源检查和批准（F2 未实现）。
- **关联技能**：定义为“回答 SOP/工艺要点/话术”的版本化内容包，不是第二套工具或权限系统。V1 已实装项目自有目录 `v1`，含施工阶段提醒、验收要点、量房预约、项目进度、日周报追问 5 个技能，可在私有运行文件中显式启用/停用；不使用可联网/可读写文件的 sandbox，业务动作一律仍走 HTTP 工具。风格推荐、公开工地等其余候选项未纳入 v1。

## 6. 工具与知识迁移

- **知识不迁移数据**：继续由 `KnowledgeRetriever`/`Evidence` 解析、索引、发布、版本/epoch/audience 校验；FastGPT 不持有知识库副本。`knowledge.search` 工具返回获权 Evidence 的 ref/quote/页码和 citation id；检索为空返回 `unavailable`，不编造。
- **业务不重写接口**：`query_business` 等工具调用现有服务；参数、租户/角色、归档过滤、版本和回执保持原语义。工具输出给模型的是用户可读字段 + 稳定 resultKey，内部 ID 只用于校验，不进入回答。
- **模型执行**：F0 已决由 FastGPT 直连 DeepSeek V4 Flash 渠道，真实 usage 从 `responseData` 的 agent 节点回填（顶层 usage 是占位值，忽略）；缺失记 unknown。F1 稳定后再评估切到本项目 transport（复用 `/native-model`、去重、no-retry 与统一计量），不在 F0 同时改两件事。
- **引用协议**：系统提示要求有据内容输出 `[id](CITE)`；Gateway 用既有解析器保存引用并移除标记，未知 id 判 `invalid_model_citation`，不交付。

## 7. 安全、数据与失败语义

- 工具回调仅服务端可达；接受部署级固定桥密钥，且只在同一桥恰好一个活动运行时归属该运行；无活动运行或并发运行一律 fail-closed。每次回调重新校验策略绑定、身份、企业、会话和来源，并记录工具调用。
- FastGPT API Key 只在 Gateway；小程序/后台浏览器不持有。工具结果和网页内容都是数据，不是指令。
- 交付前重查成员/来源/版本/epoch；撤权或来源变更使本轮失败，不把旧内容重新交付。
- 回答校验复用现有动作/承诺/引用守卫；无工具支撑的“我帮你安排/已经记录/已批准”一律拒绝。
- usage 以节点真实值为准；未知费用记 unknown，不重放未知 provider 调用；FastGPT chatId 设 TTL/清理，不形成第二份长期聊天记录。
- 预派发失败可回退内置运行时；一旦 provider 已开始，按 unknown 处理，不自动换运行时重跑。

## 8. 验收与回滚

- 固定矩阵：5 个既定问题 + 开场白/预设问题 + 猜你想问 + 跨租户/他客 + 来源撤回 + 工具失败/超时 + 虚假动作承诺 + 引用可用性 + 重进。
- 每条证据绑定源码/配置/驱动版本；首稿失败保留，不重采样到通过；单模型单次结论只作方向性证据。
- 1454 显式启用灰度；默认企业仍走内置运行时。任何生产部署、真实客户写入和 UI 新设计需单独明确授权。
- 回滚开关：企业策略 `agentRuntime` 切回 `langgraph-v1`；FastGPT 应用/渠道停用不影响已保存消息和引用读取。

## 9. 已决事项（2026-11-09）

1. **模型执行：F0 走 FastGPT 渠道，已决。** A/B 证据就在该路径；Agent V2 agent 节点与现有 transport 的模型调用契约（工具 schema、流式、重试）未验证，F0 同时换路径会让失败无法归因。usage 只取 `responseData` 的 agent 节点真实值，缺失记 unknown；F1 稳定后再评估本项目 transport。
2. **猜你想问：F2 只做配置/接口能力，不新增可见 chips。** 现行批准设计是笔记本欢迎页和 3 张静态话题卡，没有“气泡下动态 chips”的设计源。F2 下发欢迎语/预设问题并生成、缓存建议；新增聊天 chips 须先补设计源并获批。
3. **技能包：F3 已完成，已决。** 技能是版本化 SOP 内容包，不是第二套工具/权限系统；v1 实装施工阶段提醒、验收要点、量房预约、项目进度、日周报追问 5 个技能，风格推荐/公开工地保留候选；不使用 sandbox 网络/文件，业务动作仍走 HTTP 工具。
4. **回调网络：开发用现有 SSH 反向隧道，生产另批，已决。** 路径为 FastGPT 开发主机 Docker → `host.docker.internal:18310` → `ssh -R 127.0.0.1:18310` → 本机 Worker bridge。FastGPT 4.17.4 的 HTTP 工具集只把模型生成的工具参数和工具静态绑定交给 `replaceEditorVariable`，工作流 `variables`/`chatId` 不会进入工具请求（`service/core/app/http.ts`、`workflow/dispatch/utils/replaceEditorVariable.ts`），因此不能用 `{{workflowTicket}}` 做逐次票据。F0 改为部署级固定桥密钥（静态头）+ 同一桥同一时刻只允许一个活动运行，工具回调按活动运行归属并 fail-closed；第二个并发运行返回 `conversation_busy`。生产需私有网络/固定回调域名、HTTPS、短时签名、白名单和限流，单独审批；F0 只在开发隧道与 1454 验收。

## 10. 证据

- A/B 背景：[内置臂评估](../tmp/xiaok-agentv2-ab-20261109/builtin/assessment.json)、[FastGPT Agent V2 运行](../tmp/xiaok-agentv2-ab-20261109/fastgpt-runs.json)、[工具调用归一化](../tmp/xiaok-agentv2-ab-20261109/fastgpt-normalized.json)、[临时应用脱敏快照](../tmp/xiaok-agentv2-ab-20261109/fastgpt-app-snapshot.json)
- F0 验收：`tmp/xiaok-fastgpt-agentv2-f0-20261109/`
  - f0-03 四问/未知/撤权/重试（runs 11076–11082），回退11083失败保留
  - f0-04 FastGPT臂403外部配额，保留
  - f0-05/06/07/09 内置qwen校验拒绝，保留
  - f0-08 回退运行11090成功（`agentRuntime:null`）；批次因驱动日志缺陷标failed，证据有效
- F1 验收：`tmp/xiaok-fastgpt-agentv2-f1-20261109/`
  - f1-03 确定性模拟传输（runs 11096–11106）通过；f1-01/02 驱动断言错误保留
  - 真实模型第 5 问 pending 外部 `AllocationQuota.FreeTierOnly`，未重采样
- F2 验收：`tmp/xiaok-fastgpt-agentv2-f2-20261109/`
  - f2-02 确定性模拟传输（runs 11112–11116）通过；f2-01 驱动上下文版本缺陷保留
  - 建议应用 `6af178bd093915ea6cf38c11`（无工具/无数据集）；绑定运行时 `runtime.private.json`，未改 F1 运行时
  - 真实模型建议质量 pending 外部 `AllocationQuota.FreeTierOnly`，未重采样
- F3 验收：`tmp/xiaok-fastgpt-agentv2-f3-20261109/`
  - f3-03 确定性模拟传输（runs 11119–11128）通过；f3-01/02 驱动断言错误保留
  - 绑定运行时 `runtime.private.json`（`skills v1`，无建议应用）；f3-01 原运行文件保留为 `runtime.private.f3-01.json`
  - 真实模型技能质量 pending 外部 `AllocationQuota.FreeTierOnly`，未重采样
- 现有 FastGPT 边界：[unified-worker.ts](../admin/src/lib/assistant/fastgpt/unified-worker.ts)、[native-rag.ts](../admin/src/lib/assistant/fastgpt/native-rag.ts)、[runtime.ts](../admin/src/lib/assistant/fastgpt/runtime.ts)
- 实现：[agent-v2/config.ts](../admin/src/lib/assistant/fastgpt/agent-v2/config.ts)、[agent-v2/suggestions.ts](../admin/src/lib/assistant/fastgpt/agent-v2/suggestions.ts)、[agent-v2/skills.ts](../admin/src/lib/assistant/fastgpt/agent-v2/skills.ts)、[agent-v2/runtime.ts](../admin/src/lib/assistant/fastgpt/agent-v2/runtime.ts)、[agent-v2/worker.ts](../admin/src/lib/assistant/fastgpt/agent-v2/worker.ts)、[agent-v2-acceptance.mts](../admin/scripts/fastgpt/agent-v2-acceptance.mts)、[agent-v2-business-acceptance.mts](../admin/scripts/fastgpt/agent-v2-business-acceptance.mts)、[agent-v2-suggestions-acceptance.mts](../admin/scripts/fastgpt/agent-v2-suggestions-acceptance.mts)、[agent-v2-skills-acceptance.mts](../admin/scripts/fastgpt/agent-v2-skills-acceptance.mts)
