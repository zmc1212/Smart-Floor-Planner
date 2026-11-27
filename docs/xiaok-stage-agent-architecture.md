# 小K 轻量 Stage Agent 架构（I7.1）

## 企业阶段 Agent 和可复用模板

平台在「Agent 工作流模板」从阶段知识问答或现场核对清单建立模板，通过 X6 编辑节点、连接及输出，模拟后可发布。企业在「小 K 知识库 → 阶段 Agent」设定名称、职责、开场白与预设问题、回答后追问、输入词库、可调用版本与默认工作流。企业可单独配置对话体验。一个企业的一个阶段至多一条配置。启用、停用和切换版本均检查预期版本，其他阶段可继续使用原发布版。

未保存企业覆盖的十个阶段默认启用。工作台显示「系统默认」，共同绑定随应用提供的只读「阶段知识问答」`stage-system-guidance@1`，各阶段仍读取自身知识包。系统默认以配置版本 `0` 读取，首次编辑保存沿企业配置创建流程。已保存的配置和停用状态优先。

工地阶段问答按当前项目和角色调用默认模板。原生对话根据已绑定模板的名称与用途选择。无唯一获权项目、围观公开项目、专业委托或独立咨询不带入该工具。每次执行创建独立运行状态，服务端验证模板摘要并限定只读节点。会话回执含模板 ID、版本、摘要、Agent 配置版本和执行节点。企业规范、工程写入和专业复核沿既有权限与 Evidence 链。[后台清单](./admin-system-modules.zh-CN.md) · [二期合同](./xiaok-assistant-phase-2.zh-CN.md)

阶段配置通过 `0146` 迁移扩展同一张企业配置表，兼容没有体验字段的旧配置和旧客户端。开场白展开施工阶段与管理员填写的变量。后台草稿预览保存在管理员自己的 `knowledge_preview` 会话中，复用原生 Worker、用量记录和建议生成恢复机制。预览限定业主公开资料和只读工具。后台与小程序都在本轮回复完成后读取追问；关闭追问跳过该次模型调用。输入引导只匹配阶段词库。模型及可用额度由企业配置统一授权。[后台与 FastGPT 对照稿](./design/xiaok-stage-agent-workbench.zh-CN.md)。

私有绑定使用 `protocol=fastgpt-agent-v2-v1`、企业 ID 和 `runtime=langgraph-v1` 选择原生执行器，可附带预设问题。旧格式仍保留其验证和任务绑定摘要。

## 1. 目标

十个装修阶段共享**一个运行时**和**六类统一接口**，通过配置区分知识包、提醒策略和周报模板。禁止为每个阶段复制 Runtime、模型网关或权限体系。

实现位置：`admin/src/lib/xiaok-v1/`。

| 模块 | 职责 |
| --- | --- |
| `stages.ts` | 十个阶段 ID、名称、与现有 Construction 阶段键的映射。 |
| `stage-agent-registry.ts` | 十阶段 Agent 注册、版本校验、按阶段/业务键解析。 |
| `stage-knowledge.ts` | 十套版本化知识包。 |
| `stage-reminder-policies.ts` | 十套提醒策略。 |
| `stage-router.ts` | 阶段识别、意图分类、专业问题转交。 |
| `stage-answer.ts` | 阶段知识问答与答案安全守卫。 |
| `stage-agent-runtime.ts` | 共享运行时；进度/待办读取通过依赖注入复用现有业务服务。 |
| `progress-status.ts` | 统一红黄绿、施工状态和问题状态。 |
| `reminder-engine.ts` | 提醒生成、去重、重评和状态规约。 |
| `reminder-service.ts` | 真实持久化、暂停、恢复、取消、站内回执和 Worker tick。 |
| `weekly-report.ts` | 四角色周报事实投影、来源快照和版本合同。 |
| `stage-chat-service.ts` | 业主 C01 当前项目/阶段解析与阶段知识回答。 |

## 2. 阶段与业务键

阶段 ID 用于 Agent/知识/提醒/周报配置；现有 Construction 阶段键继续作为业务事实键。

| Stage ID | 名称 | Construction 键 |
| --- | --- | --- |
| `pre_construction` | 前期 | `preparation` |
| `design` | 设计 | `design` |
| `demolition` | 拆改 | `demolition` |
| `utilities` | 水电 | `utilities` |
| `masonry` | 泥木 | `masonry_carpentry` |
| `painting` | 油漆 | `painting` |
| `installation` | 安装 | `installation` |
| `furnishing` | 软装 | `furnishing` |
| `completion` | 完工 | `completion` |
| `occupancy` | 入住 | `move_in` |

自定义企业阶段没有映射时返回 `no_stage`，不猜测阶段，也不生成提醒。

## 3. 注册合同

`StageAgentRegistration` 固定字段：

- `agentId`、`stageId`、`name`、`description`
- `supportedIntents`：`stage_knowledge`、`reminder`、`progress`、`todo`、`weekly_report`、`specialist_handoff`
- `knowledgePackId`、`reminderPolicyId`、`weeklyReportTemplateId`
- `toolPermissions`：`knowledge`、`project_progress`、`todo_read`、`weekly_report`、`specialist_handoff`
- `supportedConstructionStageKeys`
- `version`、`status`

当前十个阶段均为 `active@1`。注册表在加载时校验：阶段覆盖完整、每阶段最多一个 active、知识包匹配、业务键一致。

## 4. 统一接口

`createStageAgentRuntime()` 暴露：

1. `identify(constructionStageKey)`：阶段识别。
2. `answer(...)`：阶段知识问答。
3. `planReminders(...)`：阶段主动提醒。
4. `readProgress(...)`：阶段进度读取，委托给现有 Construction 读取。
5. `readTodos(...)`：阶段待办整理，委托给现有业务服务。
6. `generateWeeklyReport(...)`：阶段周报生成。

运行时本身不写数据库。正式业务写入继续经过 `ConstructionService`、Native Workflow、Outbox 和 Durable Task。

## 5. 问答边界

- 普通问题先走阶段知识包；只有明确专业问题才转交现有 `waterproof-specialist` / `electrical-specialist`。
- 企业知识未配置时，答案固定声明“本次未核实企业施工标准”，通用知识不得写成公司规定。
- 答案守卫拦截无来源数字参数、完成/验收断言和未核实企业规定。
- 知识包自身不保存具体尺寸、材料参数、闭线时长、线径、管径或验收数值；这些只能来自当前有效企业/公开来源。

## 6. 与既有专业 Agent 的关系

- `waterproof-specialist@1` active、`@2` candidate 和 `electrical-specialist@1` 保持不变。
- 水电阶段的普通点位、生活习惯问题由 `stage-utilities` 回答；防水、闭水、管径、线径、回路、隐蔽验收等深入问题转交专业 Agent。
- 专业 Agent 的注册、工作流、Evidence、Durable Task 和权限合同不因轻量阶段入口而修改。

## 7. C01 阶段知识接入（I7.2）

`stage-chat-service.ts` 处理业主普通阶段问题及需要澄清的阶段追问。解析顺序：

1. 原会话 `construction_links` 中唯一获权项目。
2. 业主 customer followup binding 的项目。
3. 业主唯一可访问的进行中项目。

用获权项目的当前阶段解释准备、检查和工序。「提前」「接下来」「需要准备」本身不代表进度查询；询问实际进度、日期、待办等仍走现有事实/模型路径。只有「接下来呢」等未说明对象的追问会先问清是通用准备还是实际安排。多项目、无项目或阶段未知也先澄清。深入防水/水电问题仍使用 `specialist_handoff`；现有专业路由能识别的追问不被澄清分支截断。项目 `stage-answer` 接口不读取实际进度或待办，收到此类问题只指向项目事实入口。

阶段回答与澄清经 `completeStageKnowledge` 写入原会话（`purpose='construction.stage_knowledge'`），保留原消息顺序和连续追问。知识回答末尾明确“不替代企业书面标准、正式图纸和现场验收”；企业知识未接入时明确“本次未核实企业施工标准”。I7.5.19 C01 回归（Git `d28c6ccb:docs/xiaok-i7519-business-defect-fix-acceptance.md`）。

## 8. 测试

`admin/src/lib/xiaok-v1/__tests__/stage-registry.test.ts` 与 `stage-answer.test.ts` 覆盖十阶段注册、业务键映射、知识包匹配、企业边界、专业转交和无据参数拦截。`admin/scripts/xiaok-i72-acceptance.ts` 在隔离库验证 C01 会话内的水电阶段回答。
