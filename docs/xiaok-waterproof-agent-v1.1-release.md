# 防水专业 Agent V1.1 交付报告（I6.18）

分支 `codex/xiaok-integration`，起点 `c3de28c29c0a2447b5df52e088d6b914791e5d0c`。本轮只完成 I6.17 遗留问题的最后一次有界修复、两批真实模型验收、V1.1 冻结核验与工程回归；未开发水电 Agent，未重写 Runtime/RAG/Evidence/PDF Reader/Native Workflow，未新增模型网关。

统一真实模型：`bailian` / `deepseek-flash` / 实际 `deepseek-v4.1-flash-1017`，Responses API。两批共 44 次供应商尝试（42 Responses），97,646 输入 / 23,704 输出 / 36,096 缓存输入 tokens，全部有请求 ID 与实际模型，用量 unknown 0，结算金额 `unknown`。未保存 API Key。

## A. Released（真实通过）

| 能力 | 依据 |
| --- | --- |
| B 基层潮湿条件回归 | 第一批 Run 42 保存正文，3 条公开引用，0 业务写入；公开规范、一般解释与现场缺项分开。 |
| D 企业资料不可用时如实说明 | 第一批 Run 43 保存正文，0 引用、0 业务写入；明确“本次未取得企业资料”，未补造企业高度、遍数或闭水时长，未把通用做法写成公司规定。 |
| G 厨房无记录与房间更正 | 第一批 Run 45、46 保存；厨房无发布记录，更正为卫生间后未沿用厨房记录。 |
| G 主卧与记录对比 | 第一批 Run 49、50 保存；主卧读取服务端快照且无发布记录，卫生间两条记录按版本与待核对事实分开。第二批 Run 56、59 继续保存，Run 56 有 2 条引用。 |
| V1 原版本不变 | `waterproof-specialist@1` 仍为唯一 `active`；Workflow rev1 `a34557…`、rev2 `d735ae…`、rev3 `44f15a…` 字节未改。 |
| V1.1 独立版本 | `waterproof-specialist@2` 为 `candidate`；Workflow revision 4 digest `dc9c3fda69b5762b312293dd40d6e93e2316571f9284f3a751487a69608e54f0`，由隔离库 4 个 Run 绑定。 |
| 旧 Run 绑定不变 | 隔离库 4 个 `native_workflow_runs` 的 revision/digest 仍为 4/`dc9c…`，状态 `cancelled`/`failed`/`cancelled`/`completed` 未改写。 |

## B. Limited（真实失败或仅离线复验）

| 场景 | 真实结果 | 根因与边界 |
| --- | --- | --- |
| E 企业标准与国家规范对比 | 第一批 Run 44、第二批 Run 53 均失败。 | Run 44 首稿使用 `[id][id]` 裸括号载体，未被引用门识别；唯一修复含字面 `<think>`。Run 53 首稿被企业归属守卫误判为“企业规定”；离线修复后仍因单段 9 条签发引用超过 4 条结构上限而失败。 |
| D 第二批 | Run 52 失败 `ungrounded_response_scope`。 | 守卫把“企业标准通常涵盖……”范围描述和“以免把别家做法当成公司规定”误判为企业声明；第二批后已离线修复，Run 52 原稿复验通过，但未再消耗真实采样。 |
| G 更正轮第 2 问 | 第二批 Run 55 失败 `invalid_model_answer`。 | 首稿以 `<think></think>` 开头，触发整稿拒绝；属于供应商协议失败，非业务依据错误。 |
| G 管根原因/防水时机 | 第一批 Run 47、48 与第二批 Run 54、57、58 失败。 | Run 47 首稿日期 2023-04-01 未引用公告；Run 48 首稿把条文与机理写在同一段；Run 54/58 项目观察段落没有自身 CITE，未取得快照支撑；Run 57 单段 5 条引用超过结构上限。第二批后已离线修复快照支撑与修复诊断，Run 54/58 原稿复验通过；Run 57 仍受 4 条引用上限限制。 |
| B 第二批 | Run 51 失败 `invalid_model_answer`。 | 唯一修复输出字面 `<think>` 且 `finishReason=length` 截断；第一批已通过，第二批为供应商协议失败。 |
| 两条真实模型批次一致性 | 第一批 B/D/G 部分通过，第二批多数失败。 | 问题集中在供应商输出协议与少量守卫边界，不是来源权限或业务写入错误；两批业务写入均为 0。 |

第二批后只做离线修复与复验，未执行第三批相同问题采样。离线复验：D Run 52、G Run 54/58 通过；E Run 53、G Run 55/57 仍失败（引用条数上限或字面 `<think>`）。

## C. Not Run（缺少真实素材、真机或外部配置）

- 真实工地照片：仍无合法授权素材，合成图不计为真实工地通过。
- 真机、真实微信登录、BLE、Stable 四端完整旅程：本轮未执行。
- 托管 RAG：`bailian_knowledge_not_configured`，企业检索持续 `retrieval_unavailable`。
- 12–18k 真实网页原文的隔离读取：公开候选 403、超时或过短，未取得合适原文；12,000 bytes 节选合同已由确定性测试验证。
- PostgreSQL live runtime / Durable Task live / WAIT_EVENT live / Outbox live / 双 Worker 争用实库套件：本轮未在含验收数据的隔离库重跑，沿用 I6.17 证据。

## D. Unsupported（当前模型或系统明确不支持）

- 不支持仅凭照片宣布防水合格、放行、闭水试验通过或给出精确施工量数。
- 不支持无原文依据的规范条件、企业条款或项目完成断言；守卫拒绝时不自动改写为通过。
- 不支持单个专业段落承载超过 4 条签发引用；超出时按 `invalid_model_answer` 失败关闭。
- 不支持在终稿正文中输出 `<think>` 等推理标记；字面推理标记整稿拒绝。
- 不支持把公开规范原文当作企业制度，或把企业资料缺失写成“企业没有标准”。

## E. Production Blockers

1. 企业托管 RAG 未配置，D/E 只能如实说明“本次未核实”；上线前需完成专用知识库与凭据。
2. E 单段引用条数与供应商引用载体仍不稳定；需要模型侧输出约束或分段渲染，不应放宽引用校验来通过。
3. 供应商修复轮偶发字面 `<think>` 或输出截断；当前按失败保留，未见可接受的运行时兜底。
4. 真实工地照片、真机、真实微信登录、BLE 未验证，不能宣称现场验收能力。
5. PostgreSQL live runtime、Outbox、双 Worker 与四端完整旅程未在本轮重跑，生产发布仍需独立授权与目标环境验收。

## F. 下一阶段：I7.0 水电专业 Agent

- 复用既有 `AgentModelGateway`、Responses Adapter、Evidence、Knowledge Scope、Native Workflow、Construction 事项与人工复核，不新建网关、RAG 或 PDF Reader。
- 以 `electrical-specialist` 注册 `draft`，只在固定问答、项目房间、公开原文、事项回传与四端证据通过后转 `active`。
- 继承本轮边界：单段最多 4 条签发引用；企业资料不可用必须写明“本次未核实”；项目状态只来自服务端快照；推理标记整稿拒绝。
- 继续固定 `bailian / deepseek-flash / deepseek-v4.1-flash-1017`，真实调用记录请求 ID、用量、首稿、唯一修复与最终状态。
- 防水 V1.1 维持 `candidate`，不因本轮部分通过而标记为生产 Released。

## 证据索引

| 内容 | 路径 |
| --- | --- |
| 第一批/第二批首稿、工具、引用、请求 ID | `admin/tmp/i6.18/final/case-batch1-*.json`、`case-batch2-*.json` |
| 批次结论与根因 | `admin/tmp/i6.18/final/batch-summary.json` |
| 模型用量 | `admin/tmp/i6.18/final/model-usage.json` |
| 工程回归 | `admin/tmp/i6.18/final/regression-summary.json` |
| I6.17 离线复验 | `admin/tmp/i6.18/replay-i617.json` |
| 第二批离线复验 | `admin/tmp/i6.18/replay-batch2.ts` 输出 |
| 长网页确定性测试 | `admin/src/lib/assistant/__tests__/dialogue-web-tools.test.ts` |
| 冻结定义 | `admin/tmp/i6.16/definitions/waterproof-inspection-v1.json`（rev1–4） |
| 隔离库 | `sfp-xiaok-i67-test` / `xiaok_i616_validation`，企业 `5`、项目 `1`、卫生间 `1`、厨房 `2`、主卧 `3` |
