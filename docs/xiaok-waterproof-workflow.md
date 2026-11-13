# I6.9 防水专业 Agent 与工作流

业主在 C01 询问管根、基层、防水层、试验、保护层和验收。普通解释、企业工艺和本人项目进度沿本轮意图读取各自依据。明确提出持续跟进后，原咨询登记委托并绑定已发布的 `waterproof-inspection-v1`，施工团队从原工地入口处理现场材料与事项。

## 角色和版本

| 层 | 职责 |
| --- | --- |
| Assistant | 识别防水主题、追问和最新房间更正。只给专业 Agent 原咨询历史及当前可用的项目、知识与工具范围。用现有 Worker、模型网关、配额、Evidence 和对话服务。 |
| 专业 Agent 注册表 | 记录阶段、意图、知识范围、模板、工具、输入/输出 schema、版本和状态。同一 Agent 只有一个活动版本。水电、泥木、油漆、安装、竣工的注册均为 `draft`。 |
| KnowledgeRetriever / Evidence | 企业工艺按受众、成员、项目、版本、来源撤回和知识 epoch 校验。PPT 第 18 页只支持由项目团队安排卫生间防水及后续检查。 |
| 公网来源 | 公告确认发布日期及实施日期，目录核对同版状态，正式 PDF 保留内容、适用范围、实际页及指纹。未核扫描页的 OCR 不产生可引用条文。 |
| Construction | 读取实际施工节点及获准公开给该业主的记录。经现有流程登记待核实事项、分配人员、保存整改证据、由项目经理复核及明确回传节选。 |
| Native Workflow | 校验、编译、模拟、发布和执行同一定义，绑定版本和摘要。PostgreSQL 中保存执行节点、等待、效果回执、Outbox 消费及租约。 |

采用同一 LangGraph Worker 中的专业路由与带范围的 Assistant 作业。LangGraph 子图支持父级/子级持久化，JS 另有并行子图恢复的公开问题。此处由现有 PostgreSQL Worker 租约和 Outbox 持有可恢复业务状态，专业节点通过原作业入口派发并等待终态。保留来源撤回、版本、用量和人接续的现有边界。[LangChain 子 Agent](https://docs.langchain.com/oss/javascript/langchain/multi-agent/subagents) · [LangGraph 子图持久化测试](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/tests/test_subgraph_persistence.py) · [LangGraph.js 恢复问题](https://github.com/langchain-ai/langgraphjs/issues/2667)

## 防水模板

| 节点 | 输入与输出 |
| --- | --- |
| START | 原 C01 委托及原话，绑定业主、项目、房间、主题、Agent 版本和发布摘要。 |
| PROJECT_DATA | Construction 同一活动项目和精确房间。输出当前节点、项目修订和获权记录标识。 |
| KNOWLEDGE_RETRIEVAL | 项目范围内调用原企业工艺检索，输出范围、epoch、来源及失败状态。 |
| PUBLIC_WEB_SEARCH | 读取住建部公告的实际附件，通过原 PDF reader 检查来源、SHA-256 与已核页。 |
| AGENT | 通过原 Assistant 作业运行 `waterproof-specialist`。答复保存在原 C01，节点保留消息、引用、用量与状态。 |
| CONDITION | 已获权、已引用的适用企业原文或同版公开规范可走清单分支。企业缺项与服务故障分别保留。已授权的同房间待核实记录可走事项分支。 |
| CHECKLIST / REQUEST_MATERIAL | 从已保存的分析段落及其实际引用生成检查项，或记录当前缺少的依据与现场资料。两条路径均进入现场等待。 |
| WAIT_EVENT | 通过 Durable Task 等待符合条件的施工记录。只认当前对客发布版本、现场原话、照片、项目房间及有效人员。 |
| CREATE_ISSUE | 用 Construction 的原事项写入登记待核实，复用项目材料锁、事件唯一键及该记录修订。 |
| HUMAN_REVIEW | 工人正式提交另一个整改记录。项目经理依原权限核对并确认回传。等待时释放模型与 Worker 租约。 |
| OUTPUT | 按确切复核事件通过原投递链写回 C01。保留原业务结果和已分享原件的访问限制。 |

平台管理员在 `/native-workflow/waterproof-inspection-v1` 用 X6 编辑流程线和类型相符的 INPUT/OUTPUT 数据端口，设置 Agent 版本及条件，沿原 JSON 草稿保存、模拟与发布。节点布局由定义计算，已发布版本不可变。真实运行调试读取所选企业和获权项目的概要，显示当前节点、版本、效果、来源、耗时、用量、错误和恢复记录。历史运行通过原版本及摘要恢复，发布新版只影响后续委托。

持续跟进由业主的明确委托启动。已有合格现场记录时可直接登记待核实事项。清单和补资料各自留痕，等待中释放 Worker。Construction 在写入事务复核记录、成员与原委托，并按同一来源复用事项。项目经理沿原事项核对整改并授权回传。照片作为项目团队核对的原件，隐蔽工程和放行结论沿正式验收权限。I6.9 仍为 Limited，详见集成审查。

开发验证、已知缺口和真实模型批次见[集成审查](xiaok-integration-audit.md#i69-防水专业-agent-闭环limited)。
