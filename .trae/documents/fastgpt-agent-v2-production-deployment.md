# FastGPT Agent V2 生产上线计划（按评审修订）

## Context

原计划方向保留：桥在 Admin、每企业独立 FastGPT 应用与 `bridgeKey`、只迁应用/工具/模型/配置、家客来继续掌握权限与知识来源、先灰度再扩到全部企业。

但评审指出两处需要纠正的推断：

1. **不能把“当前工具模板使用静态请求头”当成“FastGPT 4.17.4 无法传每次请求的票据”。** 上游 Agent 工具执行会从工作流变量解析 `resolveReference`，HTTP 工具支持 `headerSecret`，凭据支持 `{ref: ...}`。应先用 `headerSecret.ref` 验证独立运行时请求头，再决定桥的设计。
2. **多企业实例不等于生产并发。** `assistant-worker` 每次 `/jobs/run` 等待完成再等 2 秒，`processAssistantJob` 每次最多领取一个昂贵任务并等待；只启动一个 worker 仍会全局串行。

因此本轮不直接上生产，先交付 **D0 范围/依赖基线 + D1 请求票据与隔离 + 生产依赖闭环**。D0/D1 不依赖生产 SSH。

源码基线：`c190fd3`。工作区已有 `report-question-plan` 相关未提交修改，D0 盘点时保留，不覆盖。

## 保留的安排

| 安排 | 结论 |
|---|---|
| 桥运行在 Admin，`assistant-worker` 负责触发 | 保留；生产网络围绕实际执行进程配置 |
| 每企业独立应用 + 独立 `bridgeKey` | 保留，作为配置隔离和按企业启停手段 |
| 只迁应用、工具、模型、配置，不搬开发历史 | 保留 |
| 家客来掌握权限、业务查询、知识来源、引用、任务状态 | 保留 |
| 配置变化后重启 Admin | 保留；补在途任务处理 |
| 先一家，再扩全部企业 | 保留；全企业开放是最终目标 |

## 七个必须调整

### 1. 请求票据与隔离（最高优先级）

现状：`active()` 只接受唯一活跃 ticket；同一企业 A 的连接丢失释放 ticket 后，B 成为活跃 ticket，A 的迟到工具回调会被交给 B 的上下文。现有测试只覆盖“请求结束后没有新请求”的 409，没有覆盖“B 已开始”的窗口。

方案：

- 静态 `Authorization` 只做企业路由；新增服务端生成的 run ticket，由 FastGPT 工作流变量注入第二个请求头（如 `X-SFP-Run-Ticket`）。
- 桥按 ticket 查找对应 run，不再取“唯一活跃 ticket”；ticket 过期、取消、迟到一律拒绝。
- 先做 spike：验证 `v4.17.4` 的 `headerSecret.ref` / `resolveReference` 在实际镜像、工具保存、发布、运行链路中可用；注意 `staticHeaders` 最后合并会覆盖同名动态头，不能直接复用 `Authorization`。
- 若 spike 失败，停在 D1，不进入多企业；备选“每并发槽独立应用/工具集”成本高，需重新评估。
- 测试：A 结束、B 活跃时，A 的迟到回调被拒绝，B 的工具调用次数不增加。

**spike 结果（2026-11-10，dev pilot 实测）：**

- `headerSecret.ref: ['VARIABLE_NODE_ID','workflowTicket']` 在 4.17.4 的 HTTP 工具保存、发布、运行链路可用；发布后的工具集保留该引用，回调实际收到 `x-sfp-run-ticket`，同时 `staticHeaders` 的 `Authorization` 保持不变。
- 前提：应用必须在 `chatConfig.variables` 声明 `workflowTicket`（`type: 'input'`, `required: true`）。FastGPT 的 `WorkflowVariableState.create` 只从 API `variables` 中读取已声明的变量；未声明时引用解析为 `undefined`，工具报 `Secret reference [...] resolved to undefined`，请求不会发出。
- 动态头不能复用 `Authorization`：头合并顺序为 `customHeaders → headerSecret → staticHeaders`，静态头会覆盖同名动态头。
- 新桥已按 ticket 精确路由；未带 ticket、过期或未知 ticket 返回 409 `context_unavailable`。真实模型冒烟在新桥下通过（run `11439`，2 条企业引用）。
- 发布顺序固定为：**先发布工具集（含动态头）→ 再发布声明了 `workflowTicket` 的应用 → 最后部署要求 ticket 的新桥**。提前部署新桥会让所有旧工具回调变成 409。

**D2 结果（2026-11-10，dev pilot 真实队列实测）：**

- **多企业配置**：`agentV2` 支持单对象或数组；每家企业独立 `binding`（只哈希本企业配置），`runtime: 'langgraph-v1'` 只停该企业的 V2，不改 `assistant_enterprise_settings` 的知识开关或 `knowledge_epoch`。
- **桥隔离**：一个桥注册多个企业 profile；`Authorization` 定位企业、`x-sfp-run-ticket` 定位 run，票不属于该企业直接用该企业的 key 也返回 404；`busy` 按企业统计，A 的慢请求不再占 B 的槽。
- **调度**：`claimJob` 每企业只取最老任务，并在租约内检查该企业运行数；同企业不同会话继续排队，不直接失败。`processAssistantJob` 每次最多领 `ASSISTANT_WORKER_CONCURRENCY` 个任务（1–8，默认 1），每企业上限 `ASSISTANT_ENTERPRISE_CONCURRENCY`（1–4，默认 1）。
- **派发顺序**：仍为“拿到租约 → 校验权限/配置 → `markProviderStarted` → 发起供应商请求”；槽位满时任务留在队列，不会先记供应商已开始。
- **旧能力回退**：`knowledgeAppId`/`stageAppId` 可缺省；Agent 回答和阶段报告按能力显式选择执行器，未配置旧工作流时走原模型路径，不再因为存在 workflows 文件隐式接管。
- **开场注册**：`openings` 支持 `enterprises` 数组，每家企业独立场景与 App。

验收证据（`tmp/xiaok-agentv2-d2-20261110/acceptance.json`）：

| 观察项 | 结果 |
|---|---|
| 两企业真实队列并发 | run `11453` / `11454` 的供应商窗口 `15:19:24.204–15:19:30.201` 与 `15:19:24.275–15:19:30.232` 重叠 |
| 企业资料不混用 | 甲企业引用「甲企业防水标准」48 小时，乙企业引用「乙企业防水标准」72 小时；两边 step/citation 都不含对方标题 |
| 同企业不同会话排队 | 第二个会话在第一个运行期间保持 `queued`；此时 `claimJob()` 返回 `null`；槽位释放后 run `11455` 成功 |
| 停用单个企业 V2 | 仅 B 的 `fastGPTAgentV2Configuration` 返回空；A 的 binding 不变；两家设置的 `agent_config`/`policy_version`/`knowledge_epoch` 未变 |
| 清理 | 临时企业、用户、助手数据、队列均清零 |

生产默认保持单并发；确认生产容量后显式设置 `ASSISTANT_WORKER_CONCURRENCY` 才会跨企业并行。dev pilot 只有一套已发布应用，验收让两家企业临时共用该应用；生产仍按“每企业独立应用 + 独立 bridgeKey”配置，桥和调度代码已按企业区分。

**D2 状态：完成（dev pilot）。** 复跑：`cd admin && npx tsx scripts/fastgpt/agent-v2-multi-enterprise-acceptance.mts`（需要 5432/55432/18300/18310 与到 pilot 主机的 SSH 反向隧道，脚本自行清理临时企业、用户和队列）。

### 2. 生产依赖清单

FastGPT 九容器之外，还必须补齐：

| 能力 | 当前依赖 | 生产要求 |
|---|---|---|
| 企业检索 | `ASSISTANT_EMBEDDING_URL`、key、固定 Qwen3-Embedding-0.6B revision、1024 维 profile | 从 Admin 容器可访问，profile/revision/维度匹配，实测检索成功 |
| 联网搜索 | `ASSISTANT_WEB_SEARCH_PROVIDER`、`ASSISTANT_WEB_SEARCH_URL` | 独立生产服务，不依赖 FastGPT 启动 |
| 网页原文读取 | `ASSISTANT_PUBLIC_READER_URL`，当前硬编码 `http://127.0.0.1:18095` | Admin 容器内该地址指向容器自身；必须部署/接通受控 reader 并改端点 |

新增“工具生产依赖”交付项，从 Admin 容器内部跑通：

> 企业检索 → 授权原文 → 引用落库；
> 搜索 → 候选网页 → 读取原文 → 回答引用 → 小程序打开与重进。

### 3. 企业 readiness

“全部 active + 知识开关 true”不等于可用。`agentConfig()` 需要 `runtime/model/providerKey/probeVersion/imageInput/tools`；缺字段返回 `null`，V2 不会被选中；没有助手设置行的企业不会被批量 `UPDATE` 补齐。

知识就绪不能只看 `active_index_profile_id`，还要检查：对客可见范围、当前发布版本、生效时间、索引 ready、内容 hash 与索引 profile 一致。

逐企业检查表：

| 检查项 | 通过条件 |
|---|---|
| 企业状态 | active |
| 助手配置 | 设置存在、已启用、必要配置可解析 |
| 模型能力 | 当前绑定与能力记录有效 |
| FastGPT 配置 | 企业、应用、工具集、key 对应正确 |
| 企业知识 | 有当前有效、允许目标用户访问的内容 |
| 索引与 Embedding | profile 匹配，实际检索成功 |
| 回退能力 | 关闭 V2 后原有执行路径可用 |
| 实际路由 | 测试 run 的策略快照确实记录 V2 |

“SQL 已更新”不记为“企业已开通”；未就绪企业要有原因和补齐动作。

### 4. 真实并发与派发顺序

- 复用现有 PostgreSQL 任务/租约；增加可配置全局并发上限、每企业并发限制与公平领取。
- 同企业不同用户的正常请求优先排队，不直接失败；同一会话重复提交继续拒绝。
- 派发顺序改为：**获得执行槽位 → 校验权限和配置 → `markProviderStarted` → 发起供应商请求**。不要先标记供应商已开始再 busy，否则会出现“没调模型却进入待对账”。
- 并发验收必须经过真实队列入口，检查两个企业任务的执行时间确实重叠；测试里同时调两个实例不能证明生产调度已并发。

### 5. 旧工作流回退

`knowledgeAppId`/`stageAppId` 可缺省的同时，必须改旧调用方：

- `admin/src/lib/construction/report-body-worker.ts:134` 使用 `workflow.stage.model`；
- `admin/src/lib/assistant/agent/worker.ts:1182` 调用 `workflow.knowledge.dispatch()`。

按能力选择执行器：配置 V2 才启用 V2；配置 stage workflow 才用该工作流；未配置旧工作流时明确走原模型路径；不要因为“存在 workflows 配置文件”隐式接管其他能力。

本次 V2 范围：**客户文字咨询 + 指定公开工地开场**；不宣称四端、图片、语音和全部业务流程已迁移。

### 6. 回滚

不要把 `enterpriseKnowledgeEnabled` 同时当作知识开关、V2 开关和紧急停流开关：`openingReady || enterpriseKnowledgeEnabled` 会让开场在知识关闭后仍走 V2；V2 配置读取发生在知识判断之前，配置损坏时关知识也绕不过读取错误。

拆成三个动作：

1. **停新 V2 任务**：独立运行时开关，覆盖普通回复与开场。
2. **处置已有任务**：排队、执行中、供应商结果未知分别处理。
3. **恢复兼容版本**：镜像、Compose、配置版本、环境变量与 worker 一起恢复。

旧任务保存了执行协议与 binding，改文件+重启不会转成 LangGraph；已派发但结果未知的请求不自动重放。`auto_deploy.sh rollback` 读外部运行环境，旧脚本未必管理新 assistant worker，必须演练。

### 7. 操作顺序与容量

- D0/D1 先做，不被 SSH 阻塞；生产盘点只阻塞需要服务器事实的步骤。
- 容量预算包含 `proxy-db`；八项限额已合计约 9GiB，还要按实际峰值验证，不能只看 `free -h`。
- 默认密码初始化由 `remote.ps1` 显式执行，挂载脚本不会自动执行；生产必须迁移该步骤。
- 先构建、验包、加载包含新脚本的固定镜像，再执行 provision。
- 健康检查增加桥就绪与真实工具探测；现有 `/api/health` 只查 PostgreSQL，worker 健康只看轮询。
- 盘点生产镜像版本、迁移账本、待执行 SQL。
- `workflows.json` 与 `openings.json` 按同一配置版本生成、校验、启用，避免组合不一致。

## D0–D6 交付

| 阶段 | 交付结果 | 主要工作 | 完成条件 |
|---|---|---|---|
| D0 范围与依赖基线 | 知道发布哪些路径、依赖哪些服务 | 固定源码版本；六工具依赖；旧工作流调用；企业 readiness 定义 | 清单与实际调用链一致；生产未知项列出 |
| D1 请求票据与隔离 | 每个回调只能进入所属 run | 验证 `headerSecret.ref`；应用声明 `workflowTicket`；可信 ticket；过期/取消/迟到处理 | A 结束、B 活跃时 A 的旧回调被拒绝，不调用 B 工具 |
| D2 多企业执行与切换 | 企业独立启停，任务正确排队并发 | 多企业配置；独立运行时开关；有界调度；派发计量顺序；旧能力显式回退 | 两企业真实队列并发；同企业不同会话排队；停 V2 不改知识策略 |
| D3 生产服务与部署产物 | 干净环境可重复建立完整依赖 | FastGPT、Embedding、搜索、reader；端点/网络；模板；初始化；provision | 发布镜像内可执行；无开发路径/隧道；重复 provision 不产生重复应用 |
| D4 发布与回滚演练 | 新版本失败后能恢复 | 配置版本切换；worker 生命周期；迁移差异；在途任务处理 | 新旧切换成功；无重复调用；未知结果保留；旧版本与数据库兼容 |
| D5 单企业生产验证 | 一家企业完成真实客户链路 | 只读盘点后部署；readiness；问答、知识、联网、引用、重进 | 完整链路成功；日志、run、引用、用量可对应 |
| D6 扩大到全部企业 | 所有目标企业逐一可用 | 先验证跨企业，再分批开通；统计失败原因；新企业初始化流程 | 每家都有可复核结果；未就绪企业不计完成 |

## 下一轮具体交付

**《Agent V2 请求隔离与生产依赖闭环》**

1. D0：六工具依赖矩阵、旧工作流调用点、企业 readiness 定义。
2. D1：`headerSecret.ref` spike；run ticket；桥按 ticket 路由；迟到/取消/过期测试。
3. 生产依赖：Embedding、搜索、reader 的端点改造与容器内真实链路验证。
4. 旧工作流：显式执行器选择，阶段报告/日周报不被隐式接管。
5. 不接生产、不改企业知识开关；生产盘点另行穿插。

## 验收场景

| 场景 | 必须观察到的结果 |
|---|---|
| 两企业问各自施工标准 | 引用各自当前有效来源，不混用企业资料 |
| 同企业不同用户，旧请求迟到 | 旧 ticket 被拒绝，新请求工具调用次数不增加 |
| 两企业从真实队列同时提交 | 执行时间有重叠，长任务不堵另一企业 |
| 同企业容量已满 | 新会话留在队列；未调用模型不标记供应商已开始 |
| 知识未发布/索引失配/来源撤回 | 明确不可用，不返回其他企业材料，不编造企业规定 |
| 真实联网问题 | 完成搜索、读页、原文引用和客户端打开 |
| 关闭 V2 | 回复、开场均按预定路径处理，知识授权保持独立 |
| 切换配置或回滚镜像 | 在途任务状态明确，worker 版本匹配，不重复发送供应商请求 |
| 原有阶段提醒和日周报 | 本次配置变化没有破坏原执行路径 |
| 客户退出后重新进入 | 已保存回答、引用和卡片仍能按当前权限读取 |

体验预算：主调用 150 秒、追问建议 45 秒、worker HTTP 超时 180 秒；需统一预算或让建议生成不阻塞主回答交付。

## 仍待生产核实

- 服务器实际容量、现有容器峰值、`/datas` 余量。
- 生产 active 企业、助手设置行、模型能力、知识发布/索引状态。
- 生产镜像版本、迁移账本、本次待执行 SQL。
- 报告追问已知未通过项是否纳入首批入口发布条件。
- 临时 SSH 授权（不阻塞 D0/D1）。
