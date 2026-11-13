# 防水专业 Agent 架构

主 Assistant 在原 C01 咨询中识别工艺、企业规则、公开规范及当前项目进度。咨询使用当前活动注册，明确持续跟进时从已发布工作流选择可执行的 Agent 版本。子作业沿原 `assistant_jobs`、`AgentModelGateway`、加密模型配置和用量台账，保存原消息、版本、项目及房间。当前开发只启用防水注册。

`KnowledgeRetriever` 和既有 Evidence 持有原文授权、版本和页级定位。共用校验从同段已验证引用匹配规范前提的约束对象，按条件和核对项读取谓词。缺少本轮输入与现场记录缺项分别校验，实际工程结论由 Construction 回执提供。终稿及唯一修复沿相同承诺和量数检查。已保存 PDF 原件由私有检查点持有，读回同时复核字节指纹、实际页、当前源站版本及公开权限。

I6.11 起，验收表述的 A 标准规定、B 专业解释、C 项目事实、D 正式业务结论由同一语义合同区分，Agent 提示词、终稿校验和保存层共用；规范条件与解释需要本答案实际选中、同对象的原文，项目完成仍须 Construction 回执。房间只来自服务端绑定，其他房间的有效记录不能支撑本房间回答。检查项绑定项目、房间、阶段、Agent 版本、Run、来源版本、来源类型、适用性、当前项目状态、检查状态和人工复核标记，模型分析不产生「已正式复核」。照片使用固定分析信封，只能描述可见现象和待核实项；真实图像调用证明 DeepSeek Flash 在工具参数中加入结构化字段会产生非法帧，因此产品路径暂保留原 text 协议，信封作为服务端校验合同。

`createSpecialistInspectionDefinition(agent)` 从活动注册装配模板。注册提供标识、版本、阶段、工具、知识范围、模板和公开规范标识。新图的 Agent 节点交付已保存分析回执，Evidence Assessment 节点从原授权服务重验选中来源，区分企业与公开依据、项目记录以及资料缺项。Condition 读取服务端输出。新节点沿原注册表、验证器、编译器、模拟器、X6 端口及运行存储工作。旧图保留原能力版本。

图片使用原 `conversation-images-v1` 和同一网关。用户上传图与已对该用户发布的同项目同房间记录保留各自来源；发送、恢复和读回均核对相应授权及版本。仅凭照片只能描述可见现象，工程验收与放行由正式回执提供。

已发布工作流版本及 digest 固定在原委托。Native Runtime 保留节点与业务回执，Durable Task 等待现场记录或复核时释放执行租约。只有获权的正式现场记录满足同项目、同房间和原问题绑定时，Construction 才登记待核实事项。经理复核版本和授权节选沿原 Outbox 回传 C01。项目权限、人员权限和当前原件变化时重验。模型请求结果未知时保留现有对账记录。

LangGraph 的恢复机制以检查点和可幂等的任务为边界。仓库继续用已落地的 PostgreSQL 租约持有跨业务等待，并在同一租户事务提交 Construction 与 Outbox 回执。JS 子图重复执行问题已有上游修复记录。 [LangGraph 检查点及重放](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/graph-api.mdx) · [上游持久化测试](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/tests/test_subgraph_persistence.py) · [LangGraph.js #2667](https://github.com/langchain-ai/langgraphjs/issues/2667)

节点、操作及验收见[防水工作流](xiaok-waterproof-workflow.md)和[集成审查](xiaok-integration-audit.md)。
