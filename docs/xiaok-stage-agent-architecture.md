# 小K 轻量 Stage Agent 架构（I7.1）

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
| `weekly-report.ts` | 四角色周报事实投影、来源快照和版本合同。 |

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

## 7. 测试

`admin/src/lib/xiaok-v1/__tests__/stage-registry.test.ts` 与 `stage-answer.test.ts` 覆盖十阶段注册、业务键映射、知识包匹配、企业边界、专业转交和无据参数拦截。
