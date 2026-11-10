# 小K Agent 分层与 FastGPT 工具网关契约（设计提案）

状态：**两步代码已实施；`site.public` 已在 1454 试点激活（appId `6af27edb3a245855a926e011`）并通过真实端到端校验**。

- 2026-11-10 网关：新增 `recommend_designers`（零参数、公开署名优先在服务内解析、落 `agent_designer_result` step、卡片仅由投影产生）；网关单测 5 项通过。
- 2026-11-10 开场：新增 `XIAOK_OPENINGS_FILE` 场景注册表、`intro()` 无票据调用、`public.site.intro` 分支、白名单事实与出口校验；注册表/校验/调用单测 5 项通过。未注册场景不绑定 FastGPT，本地链路保持。
- 2026-11-10 激活：已由脚本在试点实例创建并发布无工具、无知识库的 `chatAgent` 应用（`workflowStart` + `agent`，`history=0`，`agent_selectedTools=[]`，`agent_datasetParams.datasets=[]`，模型 `6af16527093915ea6cf38425` 与主应用一致）；当前 appId `6af27edb3a245855a926e011`（中性 prompt，仅“只输出正文”）；加载器实测 `site.public` 生效、其他企业仍 disabled。
- 2026-11-10 端到端走查（1454 工地 11/版本 38，新客户会话 1548）：入口返回 `intro:"queued"`，V2 开场分支执行后 run 2579 以 `invalid_model_answer` 失败。直接复现模型输出两次：120 字但仍分 3 段多行；170 字且带项目符号，均违反 `validatePublicIntro` 的“≤140 字且≤4 行”。
- 诊断（已解决）：原先 `intro()` 把写作要求放 system、把 JSON 快照单独放 user，模型把 user 快照当请求而照抄记录；两次提示词调整（收紧格式要求、改应用 prompt）均未通过，按“两次修复无效即停”暂停，改为“指令与快照同置 user 轮”并压缩 excerpt 换行。
- 2026-11-10 修复与复测：`intro()` 改为单条 user 消息（写作要求 + 快照），`publicIntroFacts` 把 excerpt 换行压成单行，提示词按 `maxChars-25` 下达预算；直连 5 次全过（99–118 字），完整链路 run 2581 成功（step 1006 `agent_intro`、`intro_tokens` 1649 observed、正文 110 字过校验）；重进返回 `intro:"existing"`，run 与助手消息均未增加。
- 2026-11-10 可疑路由：真实审计中“周围有什么工地”被`query_business(construction)`当作本人项目；已补零参数 `recommend_public_sites`（服务端按会话获权城市/区县读已发布目录、落 `agent_public_sites` step、卡片随实际结果展示）与词面识别，网关/文案/词面单测 9 项通过；2026-11-10 已重发布（`selectedTools` 6 项，含 `recommend_designers`），真实链路探针 probe-04 仍因本机读页链路（18095 reader＋18097 出口代理）ProxyError 无原文/引用。
- 遗留：该应用 `chatConfig.welcomeText` 仍为模板文案（“猜你想问生成器”），仅影响 FastGPT 控制台预览，本系统不读取。
- 未验：真机与生产；`construction-public-sites.test.ts` 的落 step/卡片投影路径仍因凭证读取策略未执行。

确认后按第 8 节第二步实施，并把结论并入
`docs/xiaok-renovation-agent-development-plan.md` 与英文/中文模块清单。

---

## 1. 现状核查（代码事实）

| 事实 | 位置 |
| --- | --- |
| 执行者由 **run 的 `policy_snapshot`** 决定，不看 purpose | `lib/assistant/infrastructure/answer-worker.ts:31-32` |
| `agentRuntime` 只在 `purpose='reply'`、`trigger='user_message'`、`purpose='customer_consultation'`、非评审模式、知识开启且触发消息全为文本时写入 | `lib/assistant/core/conversation.ts:158-163` |
| V2 授权强制 `run.purpose === 'reply'`，否则 `context_changed` | `lib/assistant/fastgpt/agent-v2/worker.ts:55-65` |
| V2 工具面：`search_enterprise`、`query_business`、`search_web`、`read_web`、`recommend_designers`、`recommend_public_sites` | `lib/assistant/fastgpt/agent-v2/runtime.ts:8-16` |
| 网关鉴权＝静态 `bridgeKey`，单活跃票据，票据 180 秒 | `runtime.ts` `handle()` / `run()` |
| 已有“任务专用、无工具 FastGPT 应用”先例：`suggestionAppId` → `suggest()` | `runtime.ts` `suggest()` |
| 消息正文只允许 text block；卡片靠 run step 读取时投影 | `job-queue.ts:131`、`portfolio/designer-recommendation.ts` `designerMessageProjection` |
| 绑定哈希＝配置文件字节的 sha256，写入 run 策略；文件一变，在途运行 `context_changed` | `agent-v2/config.ts` |

结论：现在不是“两套 Agent 混用”，而是**按 purpose 分执行者**：

- `reply` → FastGPT V2
- 报告正文 → FastGPT 报告应用（`stageAppId`）
- 追问建议 → FastGPT 建议应用（`suggestionAppId`，无工具）
- `public.site.intro` → 本地 LangGraph

最后一条正是违和感的来源：同一条客户会话里，开场白走本地编排，后续回复走 FastGPT。
这不是缺陷（`agentRuntime` 未写入，本地分支能正常跑），而是**编排归属不一致**。

---

## 2. 不变量（任何一步实施都必须保持）

1. **FastGPT 只做理解与表达**；租户/成员/来源撤回/幂等/配额/回执/引用/卡片投影永远由代码负责。
2. **一个 run 只有一个执行者**，且执行者必须显式声明它能处理的 purpose 集合；未声明即拒绝，不允许“未知 purpose 落回主应用”。
3. **无工具应用不得拥有工具面**；有工具应用只能经带票据的网关取数。
4. **对外消息只能落 text block**（`completeRun` 约束）；卡片、业务快照由持久化的 run step 在读取时投影，绝不塞进消息正文。
5. **开场白不是对话轮次**：无客户原话、不写需求、不查知识、不查业务、不产生卡片。
6. **公开材料边界不变**：只用已同意 + 已审核 + 未撤回的公开版本；内部派工不因开场白变成公开信息。
7. **失败必须可见**：校验不过就 fail run，不落半成品、不用兜底文案冒充模型输出。

---

## 3. 目标分层

```
接入层        HTTP 路由 / 小程序轮询（不变）
会话编排      FastGPT A：客户对话主应用（reply，全工具面）
系统事件编排  FastGPT B：围观开场（public.site.intro，无工具）
              FastGPT C：追问建议（suggestion，无工具）
              FastGPT D：报告正文（construction.report.*，现状）
工具网关      本服务 /agent-v2-tool/<name>（票据 + 精确键集 + 计量 + 审计）
事实与校验    租户事务、来源可用性、防承诺、引用绑定、快照重校验
交付与投影    completeRun（text）+ run step → DTO（卡片/快照）
```

边界一句话：**FastGPT 决定“说什么、调哪个工具”，我们的网关决定“能拿到什么、能不能写”。**

---

## 4. 路由契约

路由键：`(run.purpose, policy_snapshot)`。

| run.purpose | 绑定条件 | 执行者 | 工具面 | 输出 |
| --- | --- | --- | --- | --- |
| `reply` | 现有条件不变 | V2 主应用 | 4 + `recommend_designers` | text + 快照 + 知识引用 |
| `public.site.intro`（族：`intro.<scene>`） | 新增：V2 已绑定且注册表含该场景 | V2 该场景应用 | **无** | 纯 text（≤140 字） |
| `public.site.intro` | 未绑定 V2 / 未配置开场应用 | 本地 LangGraph（现状） | 无 | 纯 text |
| `construction.report.*` | 不变 | 报告应用 | 无 | text |
| `knowledge_preview` / `site.question` / `site.action` | 不变 | 本地 LangGraph | 视权限 | text + step |

规则：

- 新增 `publicIntroAppId` 时，`conversation.ts` 的 `agentRuntime` 条件从
  `purpose === 'reply'` 放宽为 `['reply','public.site.intro'].includes(purpose)`，
  且开场仅在同企业已配置 `publicIntroAppId` 时绑定；否则保持本地路径，避免“绑了 runtime 却没有可用应用”。
- `processAgentV2Answer` 的授权改为按 purpose 分支：
  `reply` 走现有全量校验；`public.site.intro` 只校验绑定哈希、企业、会话 purpose、
  用户主体、公开工地引用仍可用。**不得**复用 `nativeConversation`（那是 reply 的历史装配）。
- 两个分支都写 `answer_kind`、都用 `completeRun`，客户端轮询与失败态无需改动。

---

## 5. 工具网关契约 v1

### 5.1 端点与鉴权（沿用现状）

```
POST /agent-v2-tool/<name>
Authorization: Bearer <bridgeKey>        # 至少 32 字符，常量时间比较
Content-Type: application/json | application/x-www-form-urlencoded
```

- 未知 `name` 或错误 key → `404`（不泄露工具是否存在）。
- 无活跃票据 → `409 {"error":"context_unavailable"}`。
- 票据已记录失败 → `409 {"error":"<code>"}`，后续调用一律失败（fail-closed）。

### 5.2 请求格式

- 体积上限 8000 字节。
- 字段集合必须与工具声明**完全一致**（多一个、少一个都 422），防止模型塞入未声明参数。
- 仅接受字符串值；数值/布尔由服务端解析，不由模型传。
- 本批新增：`recommend_designers` 接受空对象或无 body；若 FastGPT 工具模板强制参数，
  统一用 `style`（可空字符串，仅作提示，不参与权限判断）。

### 5.3 统一响应信封（新增，向后兼容）

```jsonc
{
  "status": "ready" | "empty" | "unavailable",
  "resultKey": "<可选，指向本次 run step 快照>",
  "text": "<可选，面向模型的简短事实摘要>",
  "cites": { ... },          // 沿用 nativeCites 结构
  "instructions": "<可选，使用限制>",
  "tool": "<工具名>",         // 新增，便于 FastGPT 侧分支
  "diagnostic": { ... }       // 可选，不含客户内容
}
```

现有四个工具保留各自字段，只补 `status`/`tool`；`recommend_designers` 从一开始就用完整信封。

### 5.4 错误码

| 场景 | HTTP | body |
| --- | --- | --- |
| 未知工具/错 key | 404 | `not_found` |
| 无活跃票据、票据过期 | 409 | `context_unavailable` |
| 票据已失败 | 409 | 原错误码 |
| 字段不匹配、超长、非法 ID | 422 | `invalid_message` |
| 上游不可用 | 502 | `fastgpt_workflow_unavailable` |

### 5.5 票据与并发（硬约束）

FastGPT 4.17.4 的 HTTP 工具节点只能解析**静态头**，不能注入每-run 票据（`runtime.ts` 注释已记录）。
因此：

- 同一 bridge 同时只允许一个活跃 run；`busy()` 为真时新 run 直接被拒（`conversation_busy`）。
- 票据只用于**归因**，不作为鉴权因子；真正的鉴权是 `bridgeKey` + 单活跃不变量。
- **开场应用无工具，因此不建票据、不参与 `busy()`**；否则一次开场会把客户对话卡住。

### 5.6 计量与审计

| 工具 | 计量类别 | 现状 |
| --- | --- | --- |
| `search_enterprise` | `query_embedding`（观测/未知） | 已有 |
| `search_web` / `read_web` | `web_search` / `web_read` | 已有 |
| `query_business` | 不计费（纯读） | 已有 |
| `recommend_designers` | 不计费（纯读） | 新增 |
| `recommend_public_sites` | 不计费（纯读） | 新增 |
| `public.site.intro` | `intro_tokens`（观测/未知） | 新增 |

审计事件 `agent_v2_tool`：只记工具名、状态、来源数量、查询摘要；**不记客户原文、不记快照内容**。

### 5.7 本批新增工具：`recommend_designers`

- 入参：无（或空 `style`）。
- 行为：在租户事务内调用 `recommendDesigners(tx, actor, conversation)`；
  公开署名优先逻辑已在服务内，不在网关重复。
- 落库：`assistant_run_steps(kind='agent_designer_result', step_seq=2000, private_checkpoint=<snapshot>)`。
- 返回：`{status:'ready'|'empty', resultKey:'<runId>:2000', text:'<人数与范围摘要>'}`；
  `needContext` 时返回 `status:'empty'` 且 `text` 说明还缺城市或方向，**不返回卡片**。
- 卡片：不在响应里，也不在消息正文里；由 `designerMessageProjection` 在读取消息时重校验并投影。
  这与本地 `kind:'designers'` 的交付路径同源，小程序无需改动。

### 5.9 本批新增工具：`recommend_public_sites`

- 入参：无。城市/区县由服务端 `recommendationRegion(entry_snapshot, housing, 本轮原话)` 解析，模型的参数一律不参与筛选。
- 行为：租户事务内读同一 `publicCandidates` 已发布目录（当前版本、已同意、已审核、来源可用），最多 3 条。
- 落库：`assistant_run_steps(kind='agent_public_sites', step_seq=2010, source_refs=<siteId/versionId>, private_checkpoint=<region+count>)`。
- 返回：`status=ready|empty|need_region` 与简短 text；只写名称/区县/阶段，不声称距离、最近或该工地属于客户；`need_region` 请客户授权定位或补充城市。
- 卡片：小程序按回复的 `discovery.sites` 调 `GET .../public-sites/recommendations?replyId=`。`discoveryReplies` 把本条 run 的成功 `agent_public_sites` 步骤也视为工地浏览意图，避免只靠词面命中；词面同时补充“周围/附近+有什么/有哪些/哪个+工地”。
- 部署：工具集、应用提示与发布校验在 `admin/scripts/fastgpt/agent-v2-provision.mts`；需重跑 `--apply` 才在试点实例生效。

### 5.10 写入类工具（第二步之后，不在本批）

`record_need`、方案/资料/事项写操作若要进网关，必须满足：

1. 只接受**结构化意图**，不接受模型生成的事实或业务 ID 作为已确认数据。
2. 必须带 `operationId`（客户端/服务端生成），重复调用返回同一回执。
3. 返回 `saved | not_saved` 与原因；`not_saved` 时模型不得说“已记录”。
4. 写操作前必须重校验会话版本、来源可用性与权限；失败即 `context_changed`。
5. 不在同一 run 内自动重试写操作。

本批**不实现**，避免把已验证的本地写入路径在无回归的情况下搬走。

---

## 6. 开场应用契约（场景注册表）

### 6.1 场景注册表与配置

开场不是一个功能，是一族场景。不要把四个场景塞进一个 `publicIntroAppId`：

| 场景键 | 受众 | 批次 | 输入来源 |
| --- | --- | --- | --- |
| `site.public` | 客户 | 本批 | 已公开工地版本快照 |
| `designer.public` | 客户 | 后续 | 已发布设计师公开资料/作品 |
| `case.public` | 客户 | 后续 | 已同意公开的案例 |
| `boss.daily` / `manager.daily` | 员工 | 后续，需单独授权 | 内部项目/团队记录 |

配置放在**独立文件** `XIAOK_OPENINGS_FILE`，与 `XIAOK_FASTGPT_WORKFLOWS_FILE` 分离。理由：

1. 绑定哈希是整文件字节的 sha256，每加一个开场场景都会让**在途 V2 运行** `context_changed`；
2. 加开场不应打断正在进行的客户对话。

```jsonc
{
  "protocol": "xiaok-openings-v1",
  "enterpriseId": "1454",
  "scenes": {
    "site.public": {
      "appId": "<24 hex>",
      "audience": "customer",
      "input": ["name", "cityName", "district", "stageName", "excerpts", "photoCount", "designerName"],
      "constraints": { "minChars": 8, "maxChars": 140, "noUrl": true,
                       "noCitationMarkers": true, "noPhotoClaims": true, "noCommitments": true }
    }
  }
}
```

`purpose` 不写在配置里，由场景键推导：`site.public` → `public.site.intro`（保留历史 run 兼容），其余 `intro.<scene>`，避免配置与路由不一致。

契约规则：

- **缺场景即不启用**：未注册的场景不生成开场，也不落回主应用；
- **受众必须显式**：`audience:"customer"` 只接受客户主体；员工受众需要额外的主体/能力校验（V2 现只授权 `principal.kind==='user'`），故老板/经理开场不能靠加配置完成；
- **输入白名单**：只按注册表 `input` 组装，快照里存在但未列出的字段一律不发送；
- **一场景一应用**：不共用一个应用靠 prompt 分支区分，否则改一个场景会波及其他场景，出口校验也无法分场景；
- **幂等键泛化**：`entry_snapshot.publicIntros` 从 `{siteId, versionId}` 改为 `{scene, subjectId, subjectVersion}`，同场景同主题同版本只生成一次；
- **purpose 族**：保留 `public.site.intro`，后续场景用 `intro.<scene>`，worker 按族匹配而不逐个写死。

### 6.2 输入（只给这些）

系统消息＝固定指令（含 maxChars）；用户消息＝白名单字段组装的事实包：

```jsonc
{
  "sourceRole": "published_site_snapshot",
  "site": {
    "name": "...", "cityName": "...", "district": "...",
    "stageName": "...", "excerpts": [{ "role": "...", "text": "...", "date": "..." }],
    "photoCount": 3, "designerName": "..." // 无署名则不带该字段
  }
}
```

不含：会话历史、客户身份、项目/业主信息、私聊内容、照片像素、工地内部记录。
调用使用 `chatId: 'NO_RECORD_HISTORIES'`，且不带 `variables.workflowTicket`，与建议应用一致。

### 6.3 输出与校验

| 检查 | 失败处理 |
| --- | --- |
| 非空、`minChars`–`maxChars`（默认 8–140 字） | `invalid_model_answer`（502），run 失败 |
| 无引用标记（`[K1](CITE)` 等）、无 URL | 同上 |
| 无表格、标题、超过 4 行 | 同上 |
| 通过 `guardAnswerCommitments`（不承诺价格/工期/验收） | 同上 |
| 不出现“照片里/我看到”等像素断言 | 同上 |
| 不含手机号、邮箱 | 同上 |

校验不过**不落消息**；`schedulePublicIntro` 已允许同版本再试一次（attempts ≤ 2）。

### 6.4 计量

写 `assistant_usage_records(category='intro_tokens', measurement_kind='observed'|'unavailable')`；
应用未返回 usage 时标 `unavailable`，不估算。

### 6.5 回退

未注册的场景不生成开场，也不绑定 V2，保持该场景现有行为（本批即本地 LangGraph）。
不采用“用主应用冒充开场应用”：主应用带工具面，远端 prompt 也可能引导它检索，边界不可控。

### 6.6 激活条件（当前未满足）

1. 在 FastGPT 试点实例创建一个无工具、无知识库的场景应用，模型与主应用一致。
2. 该应用 24 位 appId 已写入 `admin/deployment/fastgpt/openings.1454.json` 的 `scenes.site.public.appId`（留空即禁用）。该文件每次运行实时读取，填 ID 不需要重启。
3. 重启应用使 Worker 读取新文件；此变更只影响开场，不改主绑定哈希。
4. 应用侧 prompt 保持中性（如“只输出正文”）：写作要求与快照现在同置一条 user 消息下发，应用层再写“只按用户消息里的指令”之类会与之冲突。

创建应用需要试点平台的管理会话或团队令牌，当前不在可见工具/凭据范围内，因此 appId 由有权限的操作者提供；**不使用伪造 ID**，否则运行会在授权阶段失败并污染证据。

---

## 7. 卡片与快照交付契约

1. 消息正文只写 text；`completeRun` 会拒绝其他 block。
2. 卡片/快照一律落 run step，读取时投影（`designerMessageProjection` 已是此模式）。
3. 投影时重校验：作品撤回、作者停用、版本替换 → 卡片消失，消息本身保留。
4. V2 与本地必须在同一 step 约定下产出，客户端只认投影结果，不认执行者。

---

## 8. 实施步骤与验收

### 第一步：网关与路由

改动（**只动网关，不动路由**，避免出现“绑定了 runtime 却没有处理分支”）：

- `runtime.ts`：工具名表加 `recommend_designers`；空 body 容忍；响应补 `tool`/`status`。
- `agent-v2/worker.ts`：工具分发 + step 落库（`agent_designer_result`）。
- 新增/扩展单测：网关鉴权、精确键集、无票据 409、票据过期、失败传播、`recommend_designers` 空/有结果两条路径。

验收：

- 本地库 `construction-public-sites.test.ts` 原断言不变（署名优先、匿名 detail 无署名）。
- V2 工具调用后 `agent_designer_result` 存在，消息投影能取到卡片。
- 无票据/错 key/多余字段分别返回 409/404/422。

### 第二步：开场应用

状态：**代码已实施**（注册表、授权分支、白名单事实、出口校验、计量、回退）；真实应用与下列运行验收未执行。

改动（**先有分支，再放开路由**）：

- 新增 `openings` 注册表（`XIAOK_OPENINGS_FILE` + 严格解析），本批只含 `site.public`。
- `runtime.ts`：`intro(site)` 方法（无票据、无工具、45 秒超时）。
- `agent-v2/worker.ts`：`public.site.intro` 授权分支 + 生成 + 校验 + 计量 + `completeRun`。
- `conversation.ts`：确认生产分支可用后，才把 `agentRuntime` 条件按第 4 节放宽
  （仅当该企业已配置 `publicIntroAppId`）。
- 文档：模块清单与计划第 2 节。

验收：

- 首次进入：一次开场，落 1 条 `public.site.intro` run，无用户消息。
- 重进同版本：`existing`，不重发；换工地：旧的排队开场被取消。
- 校验不过：run failed，无消息；再进一次允许重试，第三次 `unavailable`。
- 撤回公开版本后：不再生成，`context` 返回不可用。

### 明确未验证（实施后仍需真实环境）

- 真实 FastGPT 应用与 18300 隔离端点下的开场质量。
- 微信开发者工具/真机渲染。
- 生产。

---

## 9. 风险与取舍

| 风险 | 处置 |
| --- | --- |
| 静态头限制 → 单活跃运行，并发即 busy | 保持串行；开场不占票据；必要时按企业限流 |
| 远端 prompt 漂移导致越界表述 | 出口校验（第 6.3）+ 只给公开快照 |
| 配置改动使在途运行失效 | 变更窗口执行；失败按现有重试语义恢复 |
| 双路径长期并存 | 第二步后仅保留“未配置时的本地回退”，并在模块文档标注为过渡 |
| 卡片被误认为模型输出 | 卡片只来自 step 投影，正文不嵌入卡片数据 |

## 10. 本期不做

- `record_need`、方案/资料/事项写操作迁入网关。
- 图片理解、照片像素、媒体生成。
- 会话中途切换应用（开场与追问同属一条会话，追问仍走主应用）。
- 员工侧开场（老板/经理）：涉及 admin 主体授权与内部数据边界，单独批次。
- 开场文案编辑器：注册表由服务端运维配置，本批不做界面。
- 新页面、新样式、新素材。
- 生产部署或多企业开放。
