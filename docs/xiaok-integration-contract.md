# 小K集成模块合同

| 入口和所有者 | 合同 |
| --- | --- |
| Assistant / AgentModelGateway | `ModelTurnInput`、`ModelTurnOutput` 保留现有调用形态、工具调用、文本流、完成原因与用量。现有 Chat Completions 为默认。Bailian Responses 按显式配置和已知模型能力分派。原生工具证据沿模型轮次返回，原生与应用工具重名时拒绝。 |
| Assistant 工具分派 | Agent 的工具注册表按租户、身份、会话和当前来源给出工具。原生观察与应用工具回执绑定原运行和操作键。明确拒绝与结果未知分别记录。 |
| KnowledgeRetriever / Evidence | 企业或项目知识按当前受众、项目成员、版本与来源状态检索。托管库是检索适配器，应用保存授权快照与来源定位。引用打开、历史投影和委托复核重新检查权限与原件。 |
| Construction | 项目、授权成员、有效计划、报告原始记录、已批准方案、整改与复核以 Construction 服务及其事件投影为准。四端依原角色读取获权视图。报告按日或周读取相应周期的同源记录。 |
| Native Workflow / Durable Task | 启用 PostgreSQL runtime stores 时，运行、调度、报告批次与控制读写 PostgreSQL。Durable Task 管理租约、续租/接管、回调、重试与人工处理。未知执行结果留在既有人工处理状态。 |
| Delegation / Outbox | 同一租户配置、`native.delegation.v1` 消费者、事务租户锁、委托主键和来源消息约束。房间型水电任务沿 Native 任务处理，现行工艺与施工复核沿 Bailian 的获权证据处理。两者共用 `state`、出站事件、投递和事件去重。复核详细状态映射到该状态字段，保留原操作键与证据。 |
| Conversation / Message | 原私有咨询保留消息序号、来源和身份。获权业务结果写入原会话，使用稳定的 Outbox 键与可回读回执。人员或来源撤回后重新投影。 |

### 数据迁移与回退

使用 PostgreSQL 17。新库先由库 owner 显式预置 pgvector，再按 `admin/drizzle/meta/_journal.json` 应用。共享迁移至 `0120` 后，按 `0124` 知识、`0125` 存储、`0126` 委托顺序执行。两条历史分支的原账本行和 DDL 在各自路径保留。兼容脚本核对实际 hash 和表结构，插入本次实际执行的三条账本记录。

升版前保存源账本与可恢复快照，隔离验证应用角色、租户、触发器与原业务数据。升版窗口内停用历史 Worker，使用已核对的集成版本连接升级库。业务回退先停用相关企业开关及集成 Worker，保留现有记录与副作用回执。需要回退数据库时将快照恢复到独立库，核对升级后的新增业务和未知回执，再决定切换。按 [集成审查](xiaok-integration-audit.md) 核对具体迁移和生产验收边界。
