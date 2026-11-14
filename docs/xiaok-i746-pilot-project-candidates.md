# 小K I7.4.6 微云 1454 首批试点项目候选矩阵

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`eb69a6a54f97`
> 检查时间：`2026-11-14T20:34Z`（Asia/Shanghai `2026-11-15 04:34`，首次检查）
> 目标企业：**1454（微云）**
> 企业预检结论：**Blocked（13 blockers / 2 warnings）**
> 项目候选结论：**无 `ready`、无 `limited`；10 个当前有效项目均为 `blocked`**
> 本轮只读，未保存 Pilot Scope，未修改项目、阶段、计划、成员、C01、提醒、周报或消息。

## 1. 执行环境与只读边界

| 项 | 值 |
| --- | --- |
| 数据库 | 开发/试点库 `smart_floor_planner`（`admin/.env.local`） |
| 连接 | 本机开发库，`sfp_app`，`superuser=false`、`rolbypassrls=false` |
| 企业 | `1454`，名称“微云”，`status=active` |
| 生产库 | **未连接** |
| 生产部署 | **未执行** |
| 工具 | 现有 `npm run check:pilot-readiness` |
| 企业级检查 | `--enterprise-id 1454 --enterprise-audit` |
| 项目级检查 | `--enterprise-id 1454 --project-ids <id>`，对 10 个当前有效项目逐一执行 |

数据库口径：企业 1454 共 **217** 个项目，其中 **207 个已归档**、**10 个当前有效**（7 `active`、3 `paused`）。本轮只评估当前 10 个，不把历史项目 ID 当作仍然存在或 active。

原始证据（未提交）：

- `tmp/xiaok-i746/readiness-1454-audit-run1.json`、`run2.json`
- `tmp/xiaok-i746/readiness-1454-project-<id>.json`、`-run2.json`
- `tmp/xiaok-i746/db-before.json`、`db-after.json`
- `tmp/xiaok-i746/db-probe.json`
- `tmp/xiaok-i746/stability.json`、`project-summary.json`

## 2. 企业级只读检查

| 检查 | 状态 | 实际结果 |
| --- | --- | --- |
| 企业状态 | passed | `active` |
| Assistant 启用 | passed | `enabled=true`，保留 90 天，每日 100 请求，策略版本 62 |
| 十阶段配置 | passed | 10 个标准阶段齐全，缺阶段/知识包/提醒策略均为 0 |
| 老板跨项目权限 | passed | 2 个有效 owner |
| 企业报告计划 | passed | `enabled=true`，`project_ids=[]`、`stage_keys=[]`，四受众，版本 408 |
| 周报受众 | passed | customer/worker/designer/boss 完整 |
| Assistant Worker 心跳 | **failed** | 最近成功约 `12,963` 秒前（约 3.6 小时），`stale` |
| 迁移 0128/0129/0130 | **failed** | 账本 119 条；0128、0129、0130 结构和账本均缺失 |
| 数据库业务账号 | passed | `sfp_app`，非超级用户、无 bypass RLS |
| 提醒/周报/试点 RLS | **failed** | `construction_stage_reminders`、`construction_stage_reminder_pauses`、`xiaok_pilot_project_scopes` 不存在，RLS/策略为 0 |

企业级 blocker：

1. Assistant Worker 未运行或健康文件不可读；提醒与周报事实不会推进。
2. 迁移 0128/0129/0130 未应用；提醒表、提醒暂停表和试点范围表不存在。
3. 上述三张表的 FORCE RLS 与租户策略不存在。

补充只读事实：

- 企业报告计划 `next_daily_at=2026-11-14T12:00Z` 已过期，`next_weekly_at=2026-11-16T12:00Z`；Worker 恢复后可能补生成日报，试点前需要单独核定是否收窄报告范围或暂停日报。
- 现有报告投递 596 条：`delivered=564`、`revoked=21`、`muted=11`、`pending/held=0`。
- 当前没有待发送或挂起的周报，也没有已保存的 Pilot Scope（表不存在）。

## 3. 候选矩阵

> 所有项目另受企业级 3 项 blocker 影响：Worker 心跳 stale、迁移 0128/0129/0130 缺失、提醒/试点 RLS 缺失。表中 `blockers` 只列项目级阻断。  
> 十阶段知识包企业级全部可用（`missingKnowledge=0`）；阶段为 `null` 的项目没有阶段 Agent/知识包可用。  
> `weeklyReportStatus` 的 `pending/held=0` 来自企业级报告投递快照；企业报告计划 `project_ids=[]`，当前覆盖全部 active 项目。

所有 `missing` 计划同时满足 `available=false`、`structurallyValid=false`、`currentStageScheduled=false`、`nodes=0`。提醒表不存在，因此现有提醒、暂停记录和待发送提醒均为 0，无法读取实际提醒流水。

| projectId | projectName | status | currentStage | planStatus | ownerStatus | C01Status | managerStatus | designerStatus | workerStatus | reminderStatus | weeklyReportStatus | blockers | warnings | readiness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 小K工地对话测试（微云·1017） | active | utilities（水电） | missing（required，nodes=0） | 645 / customer_access=true | available（790） | valid（2853） | invalid（2855 必须改密） | missing | blocked：提醒表未迁移；计划节点缺失 | reportable；受众 3/4（缺 worker）；pending/held=0 | plan、designer、worker | 设计师 2855 处于强制改密；企业报告计划覆盖全部项目 | blocked |
| 234 | 测试工地·全流程演练·1028 | active | null（未设置） | missing（required，nodes=0） | 645 / customer_access=true | missing | valid（2853） | invalid（2855 必须改密） | missing | blocked：无阶段；提醒表未迁移；计划缺失 | reportable；受众 3/4（缺 worker）；pending/held=0 | stage、plan、designer、worker、C01 | 设计师 2855 处于强制改密；C01 缺失 | blocked |
| 237 | 合成手测甲工地·小K全流程 | active | installation（安装） | missing（required，nodes=0） | 645 / customer_access=true | available（2442） | valid（5370） | valid（5368） | valid（5371） | blocked：提醒表未迁移；计划节点缺失；迁移后阶段提醒可生成 | reportable；受众 4/4；pending/held=0 | plan | 公开站 `12`/rev3 为 `pending_owner`；企业计划覆盖全部 | blocked |
| 238 | 合成手测乙工地·小K全流程 | active | masonry_carpentry（泥木） | missing（required，nodes=0） | 645 / customer_access=true | available（805） | valid（5370） | valid（5369） | valid（5371） | blocked：提醒表未迁移；计划节点缺失；迁移后阶段提醒可生成 | reportable；受众 4/4；pending/held=0 | plan | 企业报告计划覆盖全部项目 | blocked |
| 239 | 合成手测公开样板工地·小K全流程 | active | utilities（水电） | missing（required，nodes=0） | 3880 / customer_access=true | available（2571） | valid（5370） | valid（5368） | valid（5371） | blocked：提醒表未迁移；计划节点缺失；迁移后阶段提醒可生成 | reportable；受众 4/4；pending/held=0 | plan | 公开站 `11`/rev6 已 `published`，存在公开曝光；企业计划覆盖全部 | blocked |
| 402 | 测试专用 · 开发语音全流程 | paused | utilities（水电） | not required（paused，未发布） | 3880 / customer_access=true | available（2571，共享会话） | inactive（5443 disabled） | missing | inactive（5445 disabled） | not_applicable：项目暂停；提醒表未迁移 | not reportable（paused）；受众 1/4；pending/held=0 | paused、manager、designer、worker | C01 为共享会话；项目暂停 | blocked |
| 403 | 测试专用 · 春和苑 | paused | utilities（水电） | not required（paused，未发布） | 3880 / customer_access=true | available（2571，共享会话） | inactive（5443 disabled） | missing | inactive（5445 disabled） | not_applicable：项目暂停；提醒表未迁移 | not reportable（paused）；受众 1/4；pending/held=0 | paused、manager、designer、worker | C01 为共享会话；项目暂停 | blocked |
| 404 | 测试专用 · 春和苑 | paused | utilities（水电） | not required（paused，未发布） | 3880 / customer_access=true | available（2571，共享会话） | inactive（5443 disabled） | missing | inactive（5445 disabled） | not_applicable：项目暂停；提醒表未迁移 | not reportable（paused）；受众 1/4；pending/held=0 | paused、manager、designer、worker | C01 为共享会话；项目暂停 | blocked |
| 451 | 合成·字体校验工地 2026-11-09 | active | null（未设置） | missing（required，nodes=0） | 4126 / customer_access=true | missing | valid（2853） | missing | missing | blocked：无阶段；提醒表未迁移；计划缺失 | reportable；受众 2/4（缺 worker、designer）；pending/held=0 | stage、plan、designer、worker、C01 | C01 缺失；无设计师/施工人员 | blocked |
| 647 | 【合成四端】mwd7tyrb 四端工地 | active | null（未设置） | missing（required，nodes=0） | 4256 / customer_access=true | available（2691） | valid（5644） | valid（5642） | valid（5643） | blocked：无阶段；提醒表未迁移；计划缺失 | reportable；受众 4/4；pending/held=0 | stage、plan | 企业报告计划覆盖全部项目 | blocked |

## 4. 逐项目说明

### 4.1 238（合成手测乙工地）

- 阶段、项目经理、设计师、施工人员、业主、C01、四类周报会话均完整。
- 唯一项目级 blocker 是未发布施工计划；当前阶段 `masonry_carpentry` 没有计划节点。
- 没有已发布公开站；现有站点记录 1 条，已发布 1 条。
- 企业级迁移和 Worker 问题解决后，仍需先发布包含真实房间和泥木阶段节点的计划。

### 4.2 237（合成手测甲工地）

- 阶段、三类项目成员、业主和 C01 完整。
- 未发布施工计划；当前阶段 `installation` 无计划节点。
- 公开站 `12` 为 `pending_owner`（rev 3），不是已发布状态，但试点前应确认是否保留该公开站流程。
- 现有站点记录 3 条，已发布 1 条。

### 4.3 239（合成手测公开样板工地）

- 阶段、三类成员、业主和 C01 完整；未发布施工计划。
- 公开站 `11` 已发布（rev 6），存在真实公开曝光面；首批试点若选它，必须先由业务确认公开样板可继续对外。
- 项目名称和文档均表明它是“合成手测公开样板”，不能据此认定为真实在施工工地。

### 4.4 647（合成四端）

- 项目经理、设计师、施工人员、业主和 C01 完整，周报受众 4/4。
- 当前阶段为空，且没有施工计划；需要先通过项目进度设置阶段，再发布计划。
- 无公开站、无站点记录。

### 4.5 1（小K工地对话测试）

- 阶段有效（水电），业主 645 和 C01 790 可用，经理 2853 有效。
- 设计师 2855 处于强制改密，检查器不计为有效设计师；没有施工人员成员。
- 未发布施工计划；周报受众缺 worker。

### 4.6 234（测试工地·全流程演练）

- 当前阶段为空，C01 缺失，设计师 2855 强制改密，施工人员缺失，未发布计划。
- 业主 645 有项目访问权限，经理 2853 有效，但不足以进入首批。

### 4.7 451（合成·字体校验工地）

- 当前阶段为空，C01 缺失，没有设计师/施工人员成员，未发布计划。
- 业主 4126 有项目访问权限，经理 2853 有效。
- 优先级低于 237/238/239/647。

### 4.8 402 / 403 / 404（暂停项目）

- 三个项目均为 `paused`，当前报告不可生成；经理 5443、施工人员 5445 的账号为 `disabled`，没有设计师。
- C01 检查返回共享会话 2571，不能视为项目专属、可用的 C01。
- 不建议进入首批；如重新启用，需要重新分配有效成员、确认 C01 并按 active 项目要求发布计划。

## 5. 推荐结果

### 5.1 候选排名

> 这是只读推荐，不是试点范围选择。未保存任何 Pilot Scope，也未修改企业或项目配置。

1. **238 `合成手测乙工地·小K全流程`：技术试点首选候选。**  
   数据完整度最高：阶段有效、三类成员齐全、业主和 C01 可用、四类周报会话齐全、没有公开站。当前仍 `blocked`，只差项目计划和企业级迁移/Worker。
2. **237 `合成手测甲工地·小K全流程`：第二候选。**  
   数据完整度与 238 相同，但公开站处于 `pending_owner`，需要确认公开流程。
3. **239 `合成手测公开样板工地·小K全流程`：保留候选。**  
   数据完整，但公开站已发布，存在公开曝光；未经业务确认不建议作为首批。
4. **647 `【合成四端】mwd7tyrb 四端工地`：保留候选。**  
   成员和 C01 完整，但当前阶段为空；补齐阶段后才能进入计划与提醒流程。
5. **1、234、451：不建议进入首批。**  
   分别缺少施工人员/有效设计师、阶段/C01/成员、阶段/C01/成员；需要先完成项目整改。
6. **402、403、404：不建议进入首批。**  
   项目暂停且没有有效经理/设计师/施工人员，不属于当前可运营项目。

### 5.2 业务真实性判断

仓库文档明确把 **237、238、239** 记录为“合成手测”项目，其中 239 是“合成手测公开样板”；1、234、451、647 的现有资料也属于测试/合成/四端演练语境。本轮没有找到合同、真实施工现场、业主确认或业务负责人签字等证据，能把其中任何一个认定为真实在施工工地。

因此：

- 上述排名只能作为**受控技术试点候选**，不能作为真实业务首批名单。
- 真实首批项目必须由企业管理员基于实际业务指定，并提供项目真实性/在施工状态依据。
- 不能因为数据库 `status=active`、有阶段或成员就认定为真实工地。

### 5.3 推荐整改顺序

1. 先修复企业级 blocker：备份数据库，使用迁移账号应用 0128/0129/0130；启动 Assistant Worker；核对提醒表和试点范围表的 FORCE RLS/租户策略。
2. 由企业管理员选定 1 个真实或明确批准的技术试点项目；本轮推荐优先准备 238，其次 237。
3. 由项目经理通过现有项目进度/计划流程发布包含真实房间和当前阶段节点的计划，不使用空计划或伪造日期。
4. 补齐候选项目的角色、C01 和周报受众；239 还需业务确认公开站曝光。
5. 试点触达前收窄企业报告计划项目范围或明确范围外报告策略，避免周报继续覆盖未选项目。
6. 最后由企业管理员显式提交 Pilot Scope；预检通过后再启动提醒/周报 Worker。

## 6. 整改清单

### 6.1 企业级（所有项目前置）

| 项 | 当前 | 整改 | 复检标准 |
| --- | --- | --- | --- |
| 迁移 0128/0129/0130 | 账本 119，三张表/结构缺失 | 备份后由迁移账号执行 `npm run db:migrate` | 账本包含 0128–0130；三张表存在 |
| 提醒/试点 RLS | 三张表不存在，RLS/策略缺失 | 迁移后核对 ENABLE/FORCE RLS 和 `tenant_scope` | 九张相关表 `exists/rls/forced/policies` 通过 |
| Assistant Worker | 心跳约 3.6 小时前，stale | 启动 `assistant-worker`，确认健康文件和近期成功心跳 | `worker.heartbeat` 为 fresh |
| 报告计划 | 已启用，覆盖全部项目；日报时间已过期 | 试点前核定是否收窄 `project_ids`、暂停/调整日报 | 计划范围与试点一致，无范围外待发报告 |
| 试点范围 | 未保存 | 由企业管理员显式提交，不由本轮代选 | `--pilot-id` 预检通过 |

### 6.2 候选项目

| 项目 | 需要补充/整改 | 复检 |
| --- | --- | --- |
| 238 | 发布包含房间和 `masonry_carpentry` 当前阶段节点的施工计划；确认业务真实性 | `plan.available=true`、`currentStageScheduled=true` |
| 237 | 发布 `installation` 阶段计划；确认公开站 `12` 是否保留/处理 | 计划与公开站状态明确 |
| 239 | 发布 `utilities` 阶段计划；业务确认已发布公开站 `11` 是否继续曝光 | 计划通过、公开曝光获批 |
| 647 | 设置当前阶段；发布该阶段计划 | `project.stage` 与 `project.schedule` 通过 |
| 1 | 完成设计师 2855 改密或改派；补施工人员；发布 `utilities` 计划 | 角色、计划、周报受众通过 |
| 234 | 设置阶段；发布计划；补设计师/施工人员；初始化业主 645 的 C01 | 阶段/计划/角色/C01 通过 |
| 451 | 设置阶段；发布计划；补设计师/施工人员；初始化业主 4126 的 C01 | 阶段/计划/角色/C01 通过 |
| 402/403/404 | 如重新启用：恢复 `active`、分配有效经理/设计师/施工人员、确认专属 C01、发布计划 | 角色/C01/计划通过；否则保持暂停 |

现有报告投递 596 条：`delivered=564`、`revoked=21`、`muted=11`、`pending/held=0`。因此当前没有任何待发送周报包含范围外项目；但企业报告计划 `project_ids=[]`，未来 Worker tick 仍会覆盖全部 active 项目，启用试点前需要核定/收窄。

## 7. 只读、无副作用与稳定性

### 7.1 数据库前后快照

对 22 个表/对象执行企业租户内行数与内容 MD5 快照（不存在的表记录 `exists=false`）：

`construction_projects`、`construction_members`、`construction_stage_settings`、`construction_report_settings`、`construction_followup_bindings`、`construction_stage_reminders`、`construction_stage_reminder_pauses`、`construction_reports`、`construction_report_versions`、`construction_report_deliveries`、`assistant_conversations`、`assistant_messages`、`assistant_participants`、`assistant_runs`、`assistant_jobs`、`domain_event_outbox`、`admin_users`、`leads`、`construction_plans`、`construction_plan_nodes`、`construction_public_sites`、`construction_site_records`。

结果：**0 张表变化**。未修改项目阶段、未创建计划、未修改成员、未创建 C01、未创建提醒、未生成周报、未发送消息、未保存 Pilot Scope。

### 7.2 重复执行

企业级检查和 10 个项目检查各连续执行两次。仅 Worker 心跳秒数变化，归一化后：

- `readiness`、`blockers`、`warnings`、项目事实、角色、C01、报告计划和范围外聚合完全一致。
- 10 个项目结果全部稳定。
- `stability.json`：`snapshotEqual=true`、`auditEqual=true`、`allStable=true`。

### 7.3 定向回归

```powershell
cd admin
$env:PILOT_READINESS_TEST_DATABASE_URL="<pilot_readiness_eval sfp_app>"
npx tsx --test --test-concurrency=1 src/lib/xiaok-v1/__tests__/pilot-readiness.test.ts
```

- 隔离 PG17 测试库 `pilot_readiness_eval` 原账本 126 条，缺少 0130；先用该库的隔离迁移账号应用 0130，再以 `sfp_app` 执行。
- 结果：**19 passed / 0 failed / 1 skipped**。跳过项为需要 `PILOT_READINESS_TEST_MIGRATION_URL` 的迁移故障模拟；本轮未提供该迁移账号，未伪造通过。
- `npx tsc --noEmit` 通过；`pilot-readiness.ts`、`xiaok-pilot-readiness.ts` 定向 ESLint 通过。
- 该测试库与开发库 `smart_floor_planner`（企业 1454）分离；测试未写入企业 1454。

## 8. 明确限制

- 本轮只验证开发/试点库 `smart_floor_planner` 中的企业 1454；未连接生产库，不能作为生产上线结论。
- 企业 1454 有 217 个项目，其中 207 个已归档；本轮只评估 10 个当前有效项目，未逐个复核历史归档项目。
- 检查器把暂停项目的共享 C01 会话识别为 available；该结果不能视为项目专属 C01，已在矩阵中标注。
- 项目是否属于真实在施工工地没有业务证据；推荐仅用于技术试点准备。
- 未保存 Pilot Scope、未部署生产、未发送真实微信/订阅通知。
