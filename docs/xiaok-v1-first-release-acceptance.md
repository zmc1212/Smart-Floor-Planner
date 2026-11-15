# 家客来 1.0 第一期产品纵向闭环验收（I7.5.0）

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`cb0014332a42`
> 日期：`2026-11-15`（Asia/Shanghai）
> 结论：**隔离环境 20 passed / 0 failed / 2 limited / 1 not_run；真实 1454 环境 `not_run`。**
> 后续：I7.5.1 已在同一合成夹具上补齐四端周报 AI 正文生成，详见 `docs/xiaok-i751-weekly-report-ai-body-acceptance.md`。
> 后续：I7.5.5 已解除阶段知识问答 limited（十阶段正式 C01 确定性回答 + 真实模型按需调用），详见 `docs/xiaok-i755-stage-knowledge-acceptance.md`；下方 I7.5.0 历史结果保留不改写。

## 1. 验收范围与环境

本轮只验证家客来 1.0 第一期四项核心能力：主动阶段提醒、阶段知识问答、四端周报、Worker 持续运行与站内消息投递。复用既有实现，不重写提醒、周报、Construction、Assistant 或 Native Workflow。

| 项 | 值 |
| --- | --- |
| 数据库 | 隔离 PostgreSQL `17.10`，`127.0.0.1:55432/i745_f1_accept` |
| 业务账号 | `sfp_app`，`rolsuper=false`、`rolbypassrls=false` |
| RLS | 11 张核心表 `relrowsecurity=true`、`relforcerowsecurity=true` |
| 合成企业 | `21`（本轮新建，未复用微云 1454 业务数据） |
| 试点项目 | `38`（试点内）、`39`（范围外） |
| Pilot | `i750-pilot`，最新 `scopeVersion=3`，`active`，`project_ids=[38]` |
| 角色 | 业主 `110`、老板 `71`、项目经理 `72`、设计师 `73`、施工人员 `74` |
| 模型 | 阿里云百炼 `deepseek-v4.1-flash-1017`（逻辑模型 `deepseek-flash`） |
| 模型凭据 | 仅显式 `--llm-source=development` 时，从开发库 `app.platform_configs.llm_config` 的 DashScope 配置只读复制到隔离库；验收结束在 `finally` 恢复隔离库原值 |
| 真实微信 | **未发送** |
| 真实 1454 | **未连接业务库、未修改配置、未执行迁移** |
| 证据 | `tmp/xiaok-i750-product-acceptance/run-14/result.json` |

验收脚本：`admin/scripts/xiaok-v1-product-acceptance.ts`，命令：

```powershell
cd admin
npm run test:xiaok-v1-product-acceptance -- --llm-source=development
```

脚本只接受 `127.0.0.1:55432/i745_f1_accept` 且业务用户为 `sfp_app`；不重建 PG17 基础设施，不删除历史数据，每次执行生成独立 `runId` 和独立输出目录。

## 2. 合成项目夹具

| 夹具 | 实际内容 |
| --- | --- |
| 企业 | `I7.5.0 第一期合成企业-<时间戳>`，`active`，Assistant 已启用 |
| 十阶段配置 | `stageDefinitions` 10、默认施工阶段 10、阶段知识包 10、提醒策略 10，一一对应 |
| 项目 38 | `active`，房间：卫生间、客厅、厨房；当前阶段：泥木（`masonry_carpentry`） |
| 项目 39 | `active`，房间：阳台；仅用于范围外隔离验证，验收期间暂停 |
| 施工计划 | 项目 38 已发布计划 V1，两个泥木节点分别引用卫生间和客厅 |
| 现场记录 | 项目 38 卫生间/客厅两条已发布记录；项目 39 阳台一条范围外记录 |
| 事项 | 项目 38 两条真实事项：施工人员“补拍卫生间照片并补充现场记录”、设计师“请核对客厅墙砖排版与现场尺寸” |
| 站内会话 | 业主 `customer`、设计师 `designer`、施工人员 `worker`、老板 `boss` 四类 `construction_followup` 绑定与会话 |
| 周报计划 | 启用，受众 `customer/designer/boss/worker`，项目筛选为空，周报时间 `08:00`，`stage_enabled=false` |
| 隔离事项种子 | 隔离库原仅预置 `construction_staff` 系统角色；本轮为夹具补入 `designer` 的 `construction-projects` 菜单配置，未修改真实角色表 |

## 3. 统一验收结果

### 3.1 检查项

| 检查 | 状态 | 说明 |
| --- | --- | --- |
| `env.pg17_rls` | passed | 隔离 PG17.10、非超级用户、11 张核心表强制 RLS |
| `stage.ten_stage_config` | passed | 十阶段定义/默认配置/知识包/提醒策略完整 |
| `fixture.stage_and_plan` | passed | 有效当前阶段、已发布计划、房间与节点有效 |
| `fixture.report_settings` | passed | 四类受众周报计划启用 |
| `qa.stage_answers` | passed | 既有阶段问答链路的四个固定场景按泥木阶段回答 |
| `qa.real_bailian_model` | **limited** | 百炼真实调用可达并记录模型/Token/耗时；1/4 轮交付有效阶段事实答案，其余被响应范围/完成声明校验拒绝 |
| `reminder.stage_identified` | passed | 识别泥木阶段 |
| `reminder.policy_matched` | passed | 策略角色为 owner/designer/worker/manager，提醒仅当前阶段 |
| `reminder.facts_read` | passed | 读取阶段事件、计划节点、项目事实，生成标题/正文/actionUrl |
| `reminder.generated` | passed | 试点 active 时生成 20 条待发提醒 |
| `reminder.delivered` | passed | 14 条写入正确业主/设计师/施工人员会话，均带 messageId/conversationId |
| `reminder.manager_no_inbox` | **limited** | 项目经理无私人站内会话，按现有合同 failed/no_inbox，进入工作台待办 |
| `reminder.idempotent` | passed | 重复执行不新增提醒、不重复发送 |
| `reminder.scope_exit_stops` | passed | 退出 Pilot Scope 后零生成、零投递，待发记录保留 |
| `reminder.project_paused_stops` | passed | 项目暂停后零生成，待发提醒取消 |
| `report.generation` | passed | 周报按计划为四类受众排入（项目经理按既有映射进入 worker 受众） |
| `report.four_audiences` | passed | 实际生成 customer/boss/worker/designer/worker 共 5 份周报 |
| `report.facts_same_source` | passed | 全部 facts 与 policy snapshot 只含项目 38，facts_hash 64 位 |
| `report.role_digests` | passed | 业主无内部事项；施工人员只见本人任务；设计师只见核对项；老板只见获权项目 |
| `report.delivery` | passed | 四端（含两名 worker）均 delivered；设计师会话人工接管时 held，恢复 ai 后重试 delivered |
| `report.idempotent` | passed | 重复执行不新增报告/版本/投递/消息 |
| `report.scope_isolation` | passed | 项目 39 无提醒、未进入任何周报 facts |
| `report.body_composition` | **passed（I7.5.1 补齐）** | 四端与经理共 5 份周报正文由正式 `construction.report.compose` 任务生成并保存；事实、引用、角色、投递、幂等通过；模型正文范围见下 |
| `report.body_model_scope` | **limited** | 企业知识库未启用时模型只写 `standards` 建议段；进展/待核对/安排由服务端按角色事实生成并引用 |
| `report.body_facts_fallback` | passed | 正文不可用时正式读取返回 `contentStatus=facts_only`、`state=facts_ready`，facts 与角色周报仍可读，投递状态不变 |

### 3.2 统一状态

| 字段 | 状态 |
| --- | --- |
| `reminderStatus` | **limited**（主动提醒主链路通过；项目经理 no_inbox 按现有入口合同） |
| `knowledgeAnswerStatus` | **limited → I7.5.5 已解除**（确定性四问通过；I7.5.5 十阶段 C01 全部确定性通过，模型仅在项目事实问题按需调用；下方为 I7.5.0 历史结论） |
| `weeklyReportStatus` | **passed** |
| `reportBodyStatus` | **limited（仅 body.model_scope；四端正文生成与事实校验为 passed）** |
| `customerDelivery` | **passed** |
| `designerDelivery` | **passed** |
| `bossDelivery` | **passed** |
| `workerDelivery` | **passed** |
| `idempotencyStatus` | **passed** |
| `projectScopeStatus` | **passed** |

## 4. 主动阶段提醒

使用正式实现 `advanceConfiguredStageReminders` / `deliverConfiguredStageReminders`，统一配置：

| 链路 | 模式 | 企业 | Pilot |
| --- | --- | --- | --- |
| 提醒 | `pilot` | `21` | `i750-pilot` |

真实结果：

- 首次生成 `created=20`，全部为项目 38、当前阶段 `masonry`；触发类型包含 `stage_entered`、`plan_node_due_soon`、`stage_ending`、`data_stale` 等真实事实触发。
- 提醒正文包含项目/阶段/房间信息，`action_url` 非空，`trigger_evidence` 记录 `stage_event` / `plan_node`。
- 首次投递 `delivered=14`；业主、设计师、施工人员分别进入绑定会话，均保存真实 `messageId`/`conversationId`。项目经理提醒保持 `failed/no_inbox`，未伪造站内消息。
- 重复执行：零新增提醒、零重复投递、消息数不变。
- 项目暂停：`created=0`、`delivered=0`，原待发提醒全部 `cancelled`。
- 退出试点范围：项目 38 零生成、零投递，原待发提醒保留；范围外项目 39 暂停，未产生提醒。

## 5. 阶段知识问答

### 5.1 既有确定性阶段问答

`stageAnswerForProject` 按当前项目 `masonry_carpentry` 回答四个固定场景：

1. 当前装修阶段是什么？
2. 当前阶段有哪些重点注意事项？
3. 当前阶段下一步应该做什么？
4. 某项施工工作完成后需要检查什么？

四个回答均返回 `stageKey=masonry_carpentry`、阶段名“泥木”、`basis=stage_knowledge`，且正文长度与内容有效。该链路**不调用模型**，属于家客来 1.0 既有确定性知识包能力。

### 5.2 百炼真实模型

使用现有 C01 Assistant 正式链路（`appendMessage` → `newRun` → `claimJob` → `processAnswer`），模型固定百炼 `deepseek-v4.1-flash-1017`，真实网络请求，无 Mock、无供应商回退。

| 项 | 实际结果 |
| --- | --- |
| 真实模型 ID | `deepseek-v4.1-flash-1017`（每次 attempt 均记录） |
| Token 用量 | 记录在 `assistant_usage_records`：四轮合计约 36,900 输入 / 2,200 输出 tokens |
| 请求耗时 | 记录在 `ai_provider_attempts.duration_ms`；单轮墙钟耗时约 33–50 秒（含工具轮） |
| API Key | 未输出、未写入证据 |
| 有效回答 | 第 4 轮“工地现在有照片或记录吗？” delivered：回答明确当前节点为“泥木”，说明未查到可核实的现场照片/记录，并列出待核实项 |
| 被拒绝场景 | 前 3 轮返回 `ungrounded_response_scope`：企业知识来源未配置，响应范围校验拒绝无来源的通用说明 |

因此 `knowledgeAnswerStatus=limited`：**百炼真实调用可达，模型 ID、Token 用量和耗时均完整记录；1/4 轮交付了正确使用当前阶段的有效模型答案；其余三轮被产品响应范围校验拒绝，阻塞在企业知识来源配置，而不是模型凭据或网络。** 不使用 Mock 冒充通过。

## 6. 四端周报

使用正式实现 `advanceConfiguredConstructionReports` / `deliverConfiguredConstructionReports`，同一合成项目生成：

| 报告 | 受众 | 结果 |
| --- | --- | --- |
| 67 | customer | facts_ready → delivered（message 330 / conversation 106） |
| 68 | boss | facts_ready → delivered（message 331 / conversation 109） |
| 69 | worker（施工人员） | facts_ready → delivered（message 332 / conversation 110） |
| 70 | designer | facts_ready → delivered（message 334 / conversation 107） |
| 71 | worker（项目经理，按既有 `construction_staff → worker` 映射） | facts_ready → delivered（message 333 / conversation 108） |

共同事实：

- 五份周报的 `facts.projects` 均只含项目 38；`policy_snapshot.scope.project_ids` 均只含项目 38；`facts_hash` 均为 64 位 SHA-256。
- 业主投影不包含内部事项、设计师核对项或施工人员任务；只包含已发布记录及面向业主的确认事项。
- 施工人员投影只包含分配给本人的任务与待补资料；设计师投影只包含本人核对项；老板投影只包含试点项目汇总，不包含范围外项目 39。
- 设计师会话 `mode=human` 时投递进入 `held`；恢复 `ai` 后下一次投递变为 `delivered`，未新增报告或版本。
- 重复执行：`queued=0`、`delivered=0`，报告/版本/投递/消息计数不变。

### 6.1 AI 正文（I7.5.1 补充）

I7.5.1 在同一批报告版本上通过正式 `construction.report.compose` 任务补齐了模型正文：

- customer `67`、boss `68`、designer `70`、施工人员 `71`、经理 `69` 共 5 份正文全部 `knowledge_status=ready`。
- 真实百炼 `deepseek-v4.1-flash-1017`，9 次真实调用（含 4 个失败角色各一次首稿与一次定向修复），输入约 11,357 tokens、输出约 1,479 tokens。
- 四端正文均通过项目、阶段、记录、引用、完成声明、日期/数值、员工信息、跨项目与角色范围校验；正文生成后重复投递零新增消息。
- 正文不可用时 facts-only 降级通过：读取返回 `facts_only`，项目事实与角色周报仍可读，投递状态不变，探针版本已按原值恢复并读回核对。
- 首稿失败根因：模型建议复述内部事项编号 `507/509`，被既有完成/数量校验拒绝；未降低校验强度，只加固通用正文提示词并做一次修复。
- `body.model_scope=limited`：knowledge-off 路径模型只写 `standards` 建议段；进展、待核对、安排由服务端按角色事实生成并引用。完整四段模型正文需要企业知识库与 Embedding 环境。

完整证据与逐项结果见 `docs/xiaok-i751-weekly-report-ai-body-acceptance.md`。

## 7. 权限与隔离

| 检查 | 结果 |
| --- | --- |
| 企业隔离 | 全部读写限定在合成企业 21；未连接微云 1454 业务库 |
| 项目隔离 | 周报 facts 只含试点项目 38；项目 39 无提醒、无报告 |
| 角色隔离 | 业主/设计师/施工人员/老板使用各自绑定会话与角色投影；项目经理 no_inbox，不借用他人会话 |
| 范围隔离 | 项目退出 Pilot Scope 后提醒零生成/零投递；范围外交互不产生业务记录 |
| RLS | 隔离库 `sfp_app` 非超级用户，核心表强制 RLS |
| 真实通知 | 未调用微信/订阅消息接口 |
| 真实 1454 | 未修改企业、项目、阶段、计划、成员、提醒、周报或通知配置 |

## 8. 三级状态

| 层级 | 状态 | 依据 |
| --- | --- | --- |
| 代码通过 | **passed** | `npx tsc --noEmit` 通过；定向 ESLint 通过；147 项既有定向测试通过 |
| 隔离环境通过 | **passed（含 2 项 limited、1 项 not_run）** | PG17.10 真实数据库、真实业务实现、真实站内消息；20 passed / 0 failed / 2 limited / 1 not_run |
| 真实 1454 环境通过 | **not_run** | 未连接真实 1454 业务库、未执行迁移、未启动真实 Worker、未发送真实微信、未部署生产 |

## 9. 当前仍然缺少什么

1. **企业知识来源未配置**：模型对“重点注意事项/下一步/检查项”等通用知识回答被 `ungrounded_response_scope` 拒绝。需要按既有知识管理流程发布企业知识文档，并具备可用的 Embedding/检索环境（本机 PG17 无 pgvector）。
2. **项目经理站内入口**：经理提醒按现有合同进入项目工作台待办，没有私人站内会话；本轮 20 条提醒中经理项保持 `failed/no_inbox`。
3. **四端周报 AI 正文**：I7.5.1 已补齐五份正文的模型生成、事实/引用/角色校验、投递与幂等；仍缺“全四段均由模型撰写”的企业知识库与 Embedding 环境。
4. **真实微信/订阅通知**：未验证真机、模板、订阅授权与实际发送。
5. **真实 Worker 持续运行**：验证通过进程内正式 Worker 入口与真实数据库执行；未启动生产 Worker 进程，也未验证生产端口、心跳与定时调度。
6. **设计师角色目录**：隔离库原仅预置 `construction_staff` 系统角色；本轮为夹具补入 `designer` 的 `construction-projects` 菜单配置。真实环境需确认角色目录已包含设计师的施工项目权限。

## 10. 距离真实试点还有哪些阻塞

1. 微云 1454 仍有 9 条待迁移：`0120`、`0124`–`0130`、`0131`；真实库仍 119 条账本，提醒表、提醒暂停表、试点范围表与 `notification_config` 非空约束尚未应用。
2. 真实迁移前仍需完成可恢复备份、维护窗口、写入静默确认和独立恢复验证；`sfp_backup` 尚未在真实库创建。
3. 真实 Assistant Worker 当前停运，健康文件 `stale`；试点触达前需在获批环境启动受管 Next.js 与 Worker，并确认心跳。
4. 企业知识库、Embedding 服务与 pgvector 环境尚未为试点企业配置；未配置前，模型驱动的阶段知识问答只能达到 `limited`。
5. 真实企业管理员尚未提交首批试点项目名单；现有候选项目均缺当前阶段/有效施工计划。
6. 真实微信订阅消息、真机、相机/相册、生产部署均未验证。

## 11. 四项核心能力结论

| 能力 | 代码 | 隔离环境 | 真实环境 | 结论 |
| --- | --- | --- | --- | --- |
| 1. 装修阶段主动提醒 | 通过 | **通过（经理 no_inbox 为 limited）** | not_run | 主链路已跑通；真实试点触达待迁移/Worker/配置 |
| 2. 装修阶段知识问答 | 通过 | **limited** | not_run | 确定性四问已跑通；百炼真实调用可达并交付 1/4 轮阶段事实答案；其余被响应范围/完成声明校验拒绝，通用知识问答缺企业知识来源 |
| 3. 四端周报 | 通过 | **通过（I7.5.1：正文生成 + 事实/角色/投递/幂等；模型正文范围为 limited）** | not_run | 四端生成、事实隔离、角色投影、站内投递、幂等与 AI 正文均已跑通；全四段模型正文待企业知识库 |
| 4. Worker 持续运行及消息投递 | 通过 | **通过（进程内正式入口 + 真实库）** | not_run | 站内消息投递已跑通；真实 Worker 进程、定时调度与微信未验证 |

**明确回答：** 家客来 1.0 四项核心能力中，**主动提醒主链路、四端周报、站内消息投递已经在隔离环境真正跑通**；**阶段知识问答只跑通了“确定性四问 + 1/4 轮百炼阶段事实回答”，其余模型回答被响应范围/完成声明校验拒绝，通用知识问答尚未跑通**；四项能力在**真实微云 1454 环境均未跑通**，阻塞在迁移、备份/恢复、Worker 启动、企业知识来源和真实微信验证。

## 12. 历史轮次与修正

所有失败轮次证据保留，不删除：

| 轮次 | 结果 | 原因 |
| --- | --- | --- |
| run-01 | failed | 计划节点日期用了 ISO 时间，施工计划要求 `YYYY-MM-DD` |
| run-02 | failed | 范围外项目未加入施工人员成员，现场记录写入被拒 |
| run-03 | failed | 两条事项复用同一记录，`issue.opened.v1` Outbox 唯一键冲突 |
| run-04 | failed | 隔离库缺 `designer` 系统角色配置，设计师绑定被数据库触发器拒绝 |
| run-05 | failed | 问答业主线索查询条件写反；周报 facts 未落在已完成周 |
| run-06 | failed | 周报周期仍与夹具事实不在同一周 |
| run-07 | failed | 模型回答引用已完成记录，被客户完成声明校验拒绝 |
| run-08 | failed | 模型通用知识回答被响应范围校验拒绝 |
| run-09 | failed | 模型问答场景仍含计划/知识问题，部分被响应范围校验拒绝 |
| run-10 | passed（20/0/2） | 模型问答 1 轮成功；最终脚本仍保留历史模型场景 |
| run-11 | failed | 模型 4 轮全部被响应范围校验拒绝；脚本补充周报正文排队清理 |
| run-12 | failed | 模型 3 轮被响应范围校验拒绝，第 4 轮命中确定性阶段问答 |
| run-13 | failed | 模型出现完成声明校验拒绝，状态判定未覆盖该错误码 |
| run-14 | **20 passed / 0 failed / 2 limited / 1 not_run** | 最终验收轮次 |

## 13. 复跑

```powershell
cd admin
npx tsc --noEmit
npx eslint scripts/xiaok-v1-product-acceptance.ts
npm run test:xiaok-v1-product-acceptance -- --llm-source=development
```

真实模型未配置时可省略 `--llm-source=development`：脚本会将 `qa.real_bailian_model` 标记为 `not_run`，绝不使用 Mock 冒充通过。

定向回归：

```powershell
npx tsx --test src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts `
  src/lib/construction/__tests__/report-worker-pilot.test.ts `
  src/lib/xiaok-v1/__tests__/worker-tick-alignment.test.ts `
  src/lib/xiaok-v1/__tests__/weekly-report.test.ts `
  src/lib/xiaok-v1/__tests__/weekly-report-service.test.ts `
  src/lib/xiaok-v1/__tests__/weekly-report-config.test.ts `
  src/lib/xiaok-v1/__tests__/stage-answer.test.ts `
  src/lib/xiaok-v1/__tests__/reminder-engine.test.ts `
  src/lib/xiaok-v1/__tests__/reminder-service.test.ts `
  src/lib/xiaok-v1/__tests__/stage-reminder-config.test.ts `
  src/lib/xiaok-v1/__tests__/pilot-worker-alignment.test.ts `
  src/lib/xiaok-v1/__tests__/pilot-report-scope.test.ts `
  src/lib/xiaok-v1/__tests__/pilot-scope-resolver.test.ts `
  src/lib/construction/__tests__/report-store-pilot-scope.test.ts
```

结果：**147 passed / 0 failed / 0 skipped**。

## 14. I7.5.5 十阶段知识问答闭环（limited 解除）

I7.5.5 在隔离 PG17 上新增正式 C01 端到端验收 `admin/scripts/xiaok-i755-stage-knowledge-acceptance.ts`，结果 `12 passed / 0 failed`（`tmp/xiaok-i755-stage-knowledge/run-4/result.json`）：

- 十个装修阶段各自通过 `appendMessage → newRun → claimJob → processAnswer` 回答，`purpose=construction.stage_knowledge`，无 provider attempt、Token 为 0。
- 未知阶段明确停止；多项目歧义列出项目并请用户选择；历史会话项目链接优先；非本人业主与未授权施工人员均被拒绝。
- 企业知识未配置时标注通用知识；企业知识可用时保留真实标题与原句。
- 深度专业问题（闭水试验等）进入既有防水/水电专业 Agent 路由，不借用阶段知识包。
- 真实百炼 `deepseek-v4.1-flash-1017` 仅在项目事实问题调用，记录模型 ID、Token 与结果；供应商未回传请求 ID，未使用 Mock。

**结论：`knowledgeAnswerStatus` 的阶段知识问答 limited 已真正解除。** 原先 `ungrounded_response_scope` 拒绝的根因是无企业知识时把普通阶段知识交给模型；现在普通阶段知识由当前阶段知识包确定性回答，不再进入模型，且原有完成声明、数值、企业规定、证据与权限校验强度未降低。

完整证据、十阶段明细与仍保留的边界见 `docs/xiaok-i755-stage-knowledge-acceptance.md`。真实 1454 环境仍为 `not_run`。
