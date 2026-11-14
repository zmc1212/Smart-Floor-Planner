# I6.17 专业回答失败根因矩阵

分支 `codex/xiaok-integration`，起点 `491234564ffd`。本轮只处理防水专业回答的资料、证据与最终回答问题；未开发水电 Agent，未增加装修阶段，未重写 LangGraph/Native Workflow，未新建 RAG、模型网关或更换模型。所有新增真实模型调用固定为百炼 `bailian` / `deepseek-flash` / `deepseek-v4.1-flash-1017`，Responses API。

状态口径：`passed` 真实模型与固定预期均满足；`failed` 真实模型仍失败；`limited` 已有真实失败且本轮修复只完成离线复验，未再消耗同类真实采样；`not_run` 本轮未执行；`unknown` 证据不足。

## 1. 根因分类

| 代码 | 含义 |
| --- | --- |
| A | Retrieval Failure：没有检索到需要的资料 |
| B | Source Failure：来源本身不可靠、过期或未核验 |
| C | Evidence Selection Failure：有资料但选择错误 |
| D | Evidence Applicability Failure：引用存在但不能支持当前结论 |
| E | Model Generation Failure：模型自行补充无据事实 |
| F | Context Contamination：历史项目、房间或资料污染 |
| G | Final Validation Failure：有据回答被错误拒绝 |
| H | Protocol Failure：供应商响应解析或工具合同异常 |
| I | Configuration Failure：模型、知识或运行时配置问题 |

## 2. I6.16 历史失败归属（证据保留，不重判）

| 固定 Run | 实际结果 | 根因 | 关键证据 |
| --- | --- | --- | --- |
| Run 2（A/C 无据高度） | `failed` | E + D | 首稿删除 200 mm 后仍以“师傅这个高度也可以”间接认可；`admin/tmp/i6.16/numeric.json`、`knowledge-explanation.test.ts` 历史回归 |
| Run 14（B 基层条件） | `failed` | G + H | 首稿以“现行国家规范”表述被 `standard_status_unverified` 拒绝；唯一修复输出整段 `<think>` 并截断，`invalid_model_answer`。见 `case-native-B.json` |
| Run 15（D 企业标准） | `failed` | G + H | 首稿“现行其他标准中……以该规范为准”被状态守卫误判；修复稿夹带 `<think>`。见 `case-native-D.json` |
| Run 16（E 企业/公开对比） | `failed` | D + E + H | 模型写入非本轮签发的引用 id（含西里尔字符），并补写引文未支持的穿管时序；修复未删除非法 id。见 `case-native-E.json` |
| Run 17（F 标准现行性） | `failed` | C + G + H | 首稿没有任何有效 CITE 标记；修复输出思考过程且仍未引用状态来源。见 `case-native-F.json` |
| Run 18（G 厨房进度） | `failed` | G | 回答事实正确（厨房无已发布记录），但状态抽取把“查了当前施工节点：团队标记的当前节点是水电”中的标签误当状态值，触发 `misattributed_project_status`。见 `case-native-G.json` |
| Run 19（G 更正卫生间） | `failed` | C + F | 已发布记录的自由备注仍含“本条为……草稿，未发布”，模型把已发布记录说成草稿。见 `case-native-G.json` |
| Run 27（LangGraph B） | `failed` | H + I | 单条 `web.read` 工具回执 36,981 字符，第三轮输入达到 46,248 bytes，追加读取后触发 `agent_input_limit`。见 `case-langgraph-retry-B.json` |
| Run 28（D 企业标准重试） | `failed` | B + E + H | 企业托管检索 `retrieval_unavailable`，首稿仍写 250 mm；唯一修复把数字与思考标签混入输出，`invalid_model_answer`。见 `case-native-retry-D.json` |
| Run 10（I 有据清单） | `limited` | H + F | 首稿截断，唯一修复使用非标准引文拼写；离线按每段来源重验可保存 5 条直接引文。见 `ordinary-c01-citation-offline.json` |

## 3. 本轮代码切片与根因对应

| 切片 | 修复内容 | 对应根因 |
| --- | --- | --- |
| 施工量数来源合同 | 新增 `parameter-provenance.ts`：区分标准原文、企业工艺、项目记录、师傅/用户未核实、模型估计；拦截“删数字后仍以‘这个高度可以/按此施工’间接认可”；不新增数值、不改写原文 | D/E |
| 规范现行性 | “现行（其他/工程）建设标准中……不一致的，以本规范为准”识别为优先关系而非现行性结论；无状态目录的修复只要求删除“现行/有效”状态词并保留发布、实施日期与条文 | G |
| 引用载体 | 引用同形字符仅在映射到本轮已签发 id 时归一；接受 `CITE[id]`、`[id](CITE id)` 等已签发载体；未知 id 仍失败关闭 | D/H |
| 已发布记录 | 新增 `publishedSiteRecordText`：先写服务端正式状态与版本，再投影自由备注；只移除本条记录的“草稿/未发布”状态句，保留“管根密封仍待核对”等真实待核对事实 | C/F |
| 企业不可用 | 企业检索 `retrieval_unavailable` 时，通用做法不得写成“公司规定/企业标准”；企业部分明确“本次未核实” | D/E |
| 最终收尾 | 收尾轮若只返回文本并附带未被提供的只读调用，调用不执行、文本仍走原校验；写入调用与混合包仍失败关闭 | H |
| 收尾约束 | 状态问题没有状态目录、企业检索不可用时，在收尾轮明确只能报告已取得事实并写明无法确认 | G/I |
| Web 回执 | 模型可见 `documents[].text` 按 12,000 bytes 截断，`cites` 与持久快照保持完整，避免长原文挤爆输入预算 | H/I |

## 4. 本轮真实模型批次

统一配置：`bailian` / `deepseek-flash` / `deepseek-v4.1-flash-1017`，Responses 18 + 24 次，共 42 次；输入 115,303 tokens，输出 17,176 tokens，结算金额 `unknown`；未保存 API Key。隔离库 `xiaok_i616_validation`、企业 `5`、项目 `1`、原 C01 `1`。

### 第一批（验证根因修复，Run 29–34）

| 场景 | Run | 状态 | 实际结果 |
| --- | --- | --- | --- |
| B 基层条件 | 29 | passed | 保存正文，1 条公开引用，0 业务写入 |
| D 企业标准 | 30 | failed | 首稿已说明企业资料不可用，但“本企业规定……没能取得”被企业归属守卫误判为 `ungrounded_response_scope` |
| E 企业/国标对比 | 31 | failed | 首稿正文完整，收尾轮附带未被提供的 `read_web`，触发 `assistant_capability_forbidden` |
| F 标准现行性 | 32 | failed | 仍从发布公告推导“有效”，`standard_status_unverified`，且收尾轮无修复预算 |
| G 厨房 | 33 | passed | 厨房无已发布记录，未把水电当防水完成 |
| G 更正卫生间 | 34 | failed | 首稿把“1 张照片”当施工量数拦截，唯一修复重复被拒，`invalid_model_answer` |

### 第二批（最终整合，Run 35–41）

| 场景 | Run | 状态 | 实际结果 |
| --- | --- | --- | --- |
| B 基层条件 | 35 | passed | 保存正文，4 条公开引用，0 业务写入 |
| D 企业标准 | 36 | failed | 仍未消除“没能取得”误判；首稿无企业规定、无具体量数 |
| E 企业/国标对比 | 37 | failed | 首稿使用 `CITE[...]` 非标准载体，交付时被当无引用处理；企业部分明确不可用 |
| F 标准现行性 | 38 | passed | 4 条引用，现行状态未能确认时保留范围限制，未再凭公告断言有效 |
| G 厨房 | 39 | passed | 与 Run 33 一致 |
| G 更正卫生间 | 40 | failed | 首稿把“版本 3/4”和“1 张照片”当量数拦截，唯一修复被拒 |
| H 主卧 | 41 | passed | 读取同一项目节点，未用卫生间记录替代主卧 |

### 第二批后离线修复（未追加真实采样）

| 问题 | 离线结果 | 状态 |
| --- | --- | --- |
| Run 36 企业归属误判 | `没能取得` 已纳入否定语境；相同草稿 `parseSynthesis` 通过 | limited |
| Run 37 `CITE[...]` 载体 | 已签发 id 归一为 `[id](CITE)`；新增测试通过 | limited |
| Run 40 版本号/照片张数 | 版本号与照片张数从量数视图移除；相同草稿 `parseSynthesis` 通过 | limited |
| Run 27 输入上限 | Web 回执按 12,000 bytes 截断，isolation 代码路径已修改；未追加真实 LangGraph 采样 | not_run |

## 5. 本轮结论

1. 五类专业回答失败均有根因归属：Run 14/15/18 为最终校验误判，Run 16/19 为证据选择/适用性，Run 17/27 为协议与输入上限，Run 28 为来源不可用叠加模型补数。
2. 无依据施工参数现在有两层拦截：数字必须由本段引用或本轮实际来源支持；删除数字后仍检查“这个高度可以/按此施工”等间接认可。
3. 有依据的专业解释可正常返回：B、F、H 与 G 的厨房问题在第二批通过。
4. 企业标准与国家规范分别说明；企业检索不可用时明确“本次未核实”，不再把它写成“企业没有标准”。
5. `retrieval_unavailable`、`no_match`、`retrieved_and_verified` 等来源状态已进入工具回执，不互相冒充。
6. 标准现行性在 F 通过；无状态目录时收尾约束要求写明无法确认。
7. 厨房、卫生间、主卧未互相串用；已发布记录的服务端状态优先于自由备注。
8. D、E、G 更正仍保留真实失败；第二批后的三处修复只完成离线复验，按 `limited` 记录，不再追加第三次同类采样。
9. LangGraph 输入上限修复未在本轮追加真实采样，按 `not_run` 记录；I6.16 的 Run 27 失败证据保留。
