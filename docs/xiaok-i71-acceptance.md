# I7.1 验收记录

> 状态：`passed`、`failed`、`limited`、`not_run`、`unknown`。
> 本轮验证以确定性单元测试、TypeScript、定向 ESLint 和现有 Construction/Report 回归为主；未连接真实隔离数据库、未部署生产、未发送真实微信消息。

## 1. 功能矩阵

| 编号 | 验收项 | 状态 | 证据与边界 |
| --- | --- | --- | --- |
| A | 项目进入水电阶段，小K主动提醒 | `limited` | 现有 `construction.stage.updated.v1` + 站内阶段消息保留；新 `stage_entered` 提醒由 `reminder-engine.test.ts` 覆盖。真实项目 tick `not_run`。 |
| B | 业主询问水电点位问题，阶段 Agent 正确回答 | `passed`（离线） | `stage-answer.test.ts`：普通点位问题命中 `stage-utilities`，明确“本次未核实企业施工标准”。真实小程序 API `not_run`。 |
| C | 施工人员提交现场记录，系统关联并更新项目事实 | `limited` | 复用既有 Construction 发布记录与周报事实；本轮未重跑真实施工端写入，`not_run`。 |
| D | 设计师收到自己需要处理的事项提醒 | `passed`（离线） | `reminder-engine.test.ts` 角色化待办；真实投递 `not_run`。 |
| E | 老板收到跨项目周报 | `passed`（离线） | `weekly-report-service.test.ts` 老板 `projectId=null`、跨项目章节；真实周报投递 `not_run`。 |
| F | 业主收到自己的项目周报 | `passed`（离线） | 业主摘要只读已发布对客记录，不泄露内部事项。真实投递 `not_run`。 |
| G | 施工人员收到自己的施工周报 | `passed`（离线） | 施工角色章节与授权事项过滤通过。真实投递 `not_run`。 |
| H | 设计师收到自己的设计协作周报 | `passed`（离线） | 设计角色章节、待核对事项过滤通过。真实投递 `not_run`。 |
| I | 项目进入泥木阶段，旧阶段提醒自动重新评估 | `passed`（离线） | `reconcileReminders` 将旧阶段提醒置为 `expired/stage_changed`。真实 tick `not_run`。 |
| J | 同一周报重复执行不重复生成 | `passed`（离线） | 现有 `construction_reports` 唯一键 + `weeklyReportDedupeKey` 稳定。真实重复 tick `not_run`。 |
| K | 提醒发送失败后可恢复 | `passed`（离线） | 失败状态保留且条件仍成立时不取消；站内重试路径由 Worker 下轮处理。真实失败注入 `not_run`。 |
| L | 权限撤销后停止发送 | `passed`（离线） | 权限撤销取消待发提醒；停止后不向失权人员投递。真实撤权 `not_run`。 |
| M | 没有施工计划时不生成虚假红黄绿 | `passed`（离线） | 计划缺失返回灰色 `未排期`；提醒引擎不生成精确到期/阶段结束提醒。 |
| N | AI 服务不可用时原始记录和人工业务仍可用 | `limited` | 阶段问答、提醒和周报摘要均为确定性服务，不依赖模型；未做真实 AI 故障注入。 |

十阶段知识包与提醒配置：`stage-registry.test.ts` 校验十阶段、十知识包、十提醒策略、每阶段一个 active Agent，`passed`。

## 2. 工程检查

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| `npx tsx --test src/lib/xiaok-v1/__tests__/*.test.ts` | `passed` | 31 项通过 |
| `npx tsx --test`（含 site-schedule / report-composition / report-history） | `passed` | 51 项通过 |
| `npx tsc --noEmit` | `passed` | 无错误 |
| 定向 ESLint | `passed` | 无错误/警告 |
| 小程序全量测试 | `passed`（保留历史失败） | 2,246/2,247；唯一失败为既有的测绘 Phase 0 审计，本轮未新增失败 |
| 生产 Webpack 构建 | `passed` | `npm run build` 成功，`/api/miniprogram/xiaok/stage-answer` 与 `/api/miniprogram/xiaok/reminders` 已进入构建产物 |
| 迁移 `0128` 应用 | `not_run` | 未连接隔离数据库；SQL 与 journal 已加入，需在隔离库执行 |
| 真实小程序页面点击 | `not_run` | 未启动开发者工具/真机 |
| 真实微信订阅消息 | `not_run` | 本轮仅站内提醒 |

## 3. 已知边界

1. 阶段问答 API 当前未注入企业 KnowledgeRetriever；企业知识未配置时明确“本次未核实企业施工标准”。后续接入时必须沿用现有受众、项目和版本权限。
2. 旧周报（本切片前生成）没有 `weekSchedule` 快照，角色摘要显示灰色/待核实；新周报在事实阶段捕获计划快照。
3. `issue_overdue` 只有在问题存在真实约定期限时才生成；现有 Construction 问题没有期限字段，因此当前不会生成该提醒，避免推断逾期。
4. 站内提醒 `delivered` 表示已进入接收人站内收件箱，不代表已读、承诺或完成。
5. 微信订阅消息、真实数据库迁移和四端 Stable 点击验收未在本轮执行，按 `not_run` 保留。
