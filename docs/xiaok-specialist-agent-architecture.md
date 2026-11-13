# 防水专业 Agent 架构

主 Assistant 在原 C01 咨询中识别工艺、企业规则、公开规范及当前项目进度。咨询使用当前活动注册，明确持续跟进时从已发布工作流选择可执行的 Agent 版本。子作业沿原 `assistant_jobs`、`AgentModelGateway`、加密模型配置和用量台账，保存原消息、版本、项目及房间。当前开发只启用防水注册。

`KnowledgeRetriever` 和既有 Evidence 持有原文授权、版本和页级定位。已保存的专业段落沿原引用协议输出。工作流据服务端重新校验的选中引用生成有来源的检查项，区分企业标准、公开规范、项目事实、通用建议、待核实及不适用。项目实况来自 Construction 的房间记录。工程验收及工序放行继续使用正式回执。

已发布工作流版本及 digest 固定在原委托。Native Runtime 保留节点与业务回执，Durable Task 等待现场记录或复核时释放执行租约。只有获权的正式现场记录满足同项目、同房间和原问题绑定时，Construction 才登记待核实事项。经理复核版本和授权节选沿原 Outbox 回传 C01。项目权限、人员权限和当前原件变化时重验。模型请求结果未知时保留现有对账记录。

LangGraph 的恢复机制以检查点和可幂等的任务为边界。仓库继续用已落地的 PostgreSQL 租约持有跨业务等待，并在同一租户事务提交 Construction 与 Outbox 回执。JS 子图重复执行问题已有上游修复记录。 [LangGraph 检查点及重放](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/graph-api.mdx) · [上游持久化测试](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/tests/test_subgraph_persistence.py) · [LangGraph.js #2667](https://github.com/langchain-ai/langgraphjs/issues/2667)

节点、操作及验收见[防水工作流](xiaok-waterproof-workflow.md)和[集成审查](xiaok-integration-audit.md)。
