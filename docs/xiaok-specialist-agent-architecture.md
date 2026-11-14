# 防水专业 Agent 架构

主 Assistant 在原 C01 咨询中识别工艺、企业规则、公开规范及当前项目进度。咨询使用当前活动注册，明确持续跟进时从已发布工作流选择可执行的 Agent 版本。子作业沿原 `assistant_jobs`、`AgentModelGateway`、加密模型配置和用量台账，保存原消息、版本、项目及房间。当前开发只启用防水注册。

`KnowledgeRetriever` 和既有 Evidence 持有原文授权、版本和页级定位。共用校验从同段已验证引用匹配规范前提的约束对象，按条件和核对项读取谓词。缺少本轮输入与现场记录缺项分别校验，实际工程结论由 Construction 回执提供。终稿及唯一修复沿相同承诺和量数检查。已保存 PDF 原件由私有检查点持有，读回同时复核字节指纹、实际页、当前源站版本及公开权限。

I6.11 起，验收表述的 A 标准规定、B 专业解释、C 项目事实、D 正式业务结论由同一语义合同区分，Agent 提示词、终稿校验和保存层共用；规范条件与解释需要本答案实际选中、同对象的原文，项目完成仍须 Construction 回执。房间只来自服务端绑定，其他房间的有效记录不能支撑本房间回答。检查项绑定项目、房间、阶段、Agent 版本、Run、来源版本、来源类型、适用性、当前项目状态、检查状态和人工复核标记，模型分析不产生「已正式复核」。照片使用固定分析信封，只能描述可见现象和待核实项；真实图像调用证明 DeepSeek Flash 在工具参数中加入结构化字段会产生非法帧，因此产品路径暂保留原 text 协议，信封作为服务端校验合同。

`createSpecialistInspectionDefinition(agent)` 从活动注册装配模板。注册提供标识、版本、阶段、工具、知识范围、模板和公开规范标识。新图的 Agent 节点交付已保存分析回执，Evidence Assessment 节点从原授权服务重验选中来源，区分企业与公开依据、项目记录以及资料缺项。Condition 读取服务端输出。新节点沿原注册表、验证器、编译器、模拟器、X6 端口及运行存储工作。旧图保留原能力版本。

图片使用原 `conversation-images-v1` 和同一网关。用户上传图与已对该用户发布的同项目同房间记录保留各自来源；发送、恢复和读回均核对相应授权及版本。仅凭照片只能描述可见现象，工程验收与放行由正式回执提供。

已发布工作流版本及 digest 固定在原委托。Native Runtime 保留节点与业务回执，Durable Task 等待现场记录或复核时释放执行租约。只有获权的正式现场记录满足同项目、同房间和原问题绑定时，Construction 才登记待核实事项。经理复核版本和授权节选沿原 Outbox 回传 C01。项目权限、人员权限和当前原件变化时重验。模型请求结果未知时保留现有对账记录。

LangGraph 的恢复机制以检查点和可幂等的任务为边界。仓库继续用已落地的 PostgreSQL 租约持有跨业务等待，并在同一租户事务提交 Construction 与 Outbox 回执。JS 子图重复执行问题已有上游修复记录。 [LangGraph 检查点及重放](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/graph-api.mdx) · [上游持久化测试](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/tests/test_subgraph_persistence.py) · [LangGraph.js #2667](https://github.com/langchain-ai/langgraphjs/issues/2667)

I6.15 在 `xiaok-native-executor-v1` 和 LangGraph 装配同一 `delegationToolForQuestion`、`dispatchDelegationTool` 和 `DelegationService`。当前业主、原咨询、项目、精确房间、原话授权、操作键、活动注册与发布版本均由服务端决定。`consultation` 或 `structuredFinal` 与 Native 配置的组合在建 Run 时显式路由到 LangGraph，并保留路由诊断；已固定且不兼容的旧快照在模型派发前给出配置错误。持久化的登记回执可直接结束一条独立授权消息。模型首稿、工具执行和服务回执分别保留，混合咨询的正文继续走原来源及承诺校验。

I6.16 的 @2 候选由显式发布的 Workflow revision 选中。子作业以当前 Run 的审核原页及获权项目上下文为输入，省去副作用无关的委托状态历史选择。Evidence Assessment 匹配实际选中引文与 Workflow 已读原附件的指纹、页码及标准编号。公开原页技术内容和同版现行性各有独立状态，托管检索不可用时也分别留痕。独立登记和混合问题的回执均重验原事务事件，混合终稿被拒时退回其实际失败码。

节点、操作及验收见[防水工作流](xiaok-waterproof-workflow.md)和[集成审查](xiaok-integration-audit.md)。

I6.12 把照片观察的结构化从模型工具参数移到服务端：图像轮仍只提交 \kind\/\	ext\，正文七节固定文本由服务端解析；解析失败时执行一次独立文本归一化调用，结果再经固定信封 Schema 与语义校验。该调用复用同一 \AgentModelGateway\、加密配置、用量台账和请求回执，不新增网关或生产默认值。真实回执见 \dmin/tmp/i6.12/photo-01/\；真实工地照片、真机与 BLE 仍未验。工作流、四端与冻结标识见[防水工作流](xiaok-waterproof-workflow.md)和[第一版交付](xiaok-waterproof-agent-v1-release.md)。

I6.13 复核：知识解释的单次修复改为精确诊断——按 Q/段号列出未由本段引用支持的数字、量数与同轮 citationId 候选；`standard_status_unverified` 同样返回状态候选，避免删除真实状态结论。语义复核承认服务端对 `advice` 的“一般建议”展示标签。PDF 页引用在 Stable 业主会话完成点击与重进；施工端/业主授权 UI 本轮未重跑，保持 `limited`/`not_run`。证据见[集成审查](xiaok-integration-audit.md)。

## I6.18 专业回答守卫边界

- 施工量数视图统一使用 `provenanceMetadataText`：版本号、记录编号、带修饰语的照片张数（如“1 张现场照片”）是来源元数据，不是施工量数；最终数值校验与修复诊断共用同一视图。
- 归属录备注中的“原话称已完成”只作为来源展示；`attributedRecordNotes` 仅在服务端已核对发布记录快照存在时启用，模型自己的“已完成/验收”仍失败关闭。
- 否定完成投影覆盖“不能据此认为……已完成，或已经通过验收”；同一段后续出现新的完成断言仍拒绝。
- 引用载体兼容 `CITE[id]`、`[id](CITE id)`、裸 `[id]`/`[id][id]`，但只在 id 是本轮签发引用时归一；未知 id 保持失败关闭。
- 企业资料不可用时，企业标准范围描述、索要客户文件、以免误认公司规定的否定语境不当作企业声明；真实的要求谓词仍由 `unsupported_enterprise_claim` 拦截。
- 原生项目快照可支撑没有自身 CITE 的阶段观察；该快照仅限 `kind=project` 且无 material/followup 的服务端聚合来源。
- 无引用段落无法生成修复诊断时返回可定位修复问题，不再直接抛出 `ungrounded_response_scope`；修复后仍执行原有数值、承诺、引用与范围校验。

上述边界由 `parameter-provenance.test.ts`、`formal-claim-scope.test.ts`、`synthesis-source-roles.test.ts`、`dialogue-web-tools.test.ts` 与 `agent-runtime.test.ts` 覆盖。真实模型仍保留 E 单段引用超限与 G `<think>` 协议失败，详见[V1.1 交付报告](xiaok-waterproof-agent-v1.1-release.md)。
