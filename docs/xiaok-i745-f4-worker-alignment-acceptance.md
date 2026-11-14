# 小K I7.4.5-F4 统一 Worker 配置与四项任务端到端验收

> 基线：`codex/xiaok-integration`，源码 SHA `9fe0f6564d1d`。
> 状态：`passed`、`failed`、`limited`、`not_run`。
> 复用 F1/F2 的隔离 PostgreSQL 17 数据库，未连接生产库、未部署生产、未修改微云真实企业配置、未发送真实微信/订阅通知。

## 1. 隔离环境

| 项 | 值 |
| --- | --- |
| 实例 | PostgreSQL `17.10`（Debian 17.10-1.pgdg12+1） |
| 地址 | `127.0.0.1:55432`，数据库 `i745_f1_accept` |
| 业务账号 | `sfp_app`，`rolsuper=false` |
| RLS | 范围、提醒、报告设置、报告、报告版本、投递、站内消息均 `relrowsecurity=true`、`relforcerowsecurity=true` |
| 合成企业 | `5`（F2 提醒企业），项目 `8`（试点内）、`9`（范围外） |
| Pilot | `f2-pilot`，最新范围版本 `8`，`active`，`project_ids=[8]` |
| F1 企业 | `1`，只读核验，未修改 |
| 早前 F2 企业 | `4`，只读核验，未修改 |
| 证据 | `tmp/xiaok-i745-f4/run-03/result.json`（run-01/run-02 失败记录同样保留） |

复跑（在 `admin/`）：

```powershell
npx tsx scripts/xiaok-i745-f4-worker-alignment-acceptance.ts --output=../tmp/xiaok-i745-f4/run-04
```

脚本只接受 `127.0.0.1:55432/i745_f1_accept` 且业务用户为 `sfp_app`；连接信息来自未提交的 `tmp/xiaok-i745-f2/connection.private.json`。

## 2. Worker 编排抽取

`admin/src/app/api/internal/assistant/jobs/run/route.ts` 只保留 401 鉴权、请求体校验和响应封装。每次 tick 的编排抽取到 `admin/src/lib/assistant/infrastructure/jobs-tick.ts` 的 `runAssistantJobsTick()`：

- 默认依赖与抽取前完全相同，生产调用不传参数。
- 可注入 `now`、`env` 及每个 Job 函数，用于按调用次数验证。
- 顺序保持：Native Workflow 调度 → Knowledge Batch → 周报生成 → 提醒生成 → Assistant Job → Native Workflow 委派/工具 → 周报投递 → 站内通知/公开同意 → 提醒投递 → Portfolio Copy。
- 周报生成与投递新增与提醒一致的独立 `try/catch`，单个 Worker 失败只记录错误，不跳过其他独立任务。

未重写 API，未改变 401、422、503 语义。

## 3. 配置组合 A–H

`checkPilotWorkerAlignment()` 使用现有 `readStageReminderConfig()` 与 `readWeeklyReportConfig()`，未新增解析器。

| 组合 | 配置 | alignment | 四项行为 |
| --- | --- | --- | --- |
| A | 两边 `enterprise`，均未指定企业 | `aligned` + `enterprise` | 各执行 1 次 |
| B | 两边 `enterprise`，企业 ID 相同 | `aligned` + `enterprise` | 各执行 1 次 |
| C | 两边 `pilot`，`enterpriseId` 与 `pilotId` 相同 | `aligned` + `pilot` | 各执行 1 次 |
| D | 提醒 `pilot`、周报 `enterprise` | `mismatch` / `pilot_worker_mode_mismatch` | 四项均 0 次 |
| E | 提醒 `enterprise`、周报 `pilot` | `mismatch` / `pilot_worker_mode_mismatch` | 四项均 0 次 |
| F | 两边 `enterpriseId` 不同 | `mismatch` / `pilot_worker_enterprise_mismatch` | 四项均 0 次 |
| G | 两边 `pilotId` 不同 | `mismatch` / `pilot_worker_pilot_mismatch` | 四项均 0 次 |
| H | 任意一边配置非法 | `invalid` + `mode=null` | 四项均 0 次，不回退 `enterprise` |

D–H 的四项响应均包含 `skipped: true`、`reason: 'pilot_worker_alignment'` 和对应错误码；同一 tick 内 Knowledge Batch 与 Assistant Job 仍各执行 1 次。

## 4. 真实 Route（配置不一致）

在两套配置不一致、且数据库没有待处理 Assistant Job 时执行完整 HTTP Route。

| 项 | 值 |
| --- | --- |
| 请求 ID | `0eb74833-2eee-4b2b-893e-0c5105e44769` |
| HTTP 状态 | `200`，`success=true` |
| 配置摘要 | 提醒 `pilot`（企业 `5`，试点 `f2-pilot`）；周报 `enterprise`（企业 `5`） |
| alignment | `mismatch`，`pilot_worker_mode_mismatch` |
| 四项 | 全部 `skipped`，`errorCode=pilot_worker_mode_mismatch` |
| 其他 Job | `claimed=false`、`inAppDeliveries=0`、`knowledgeBatchChecks=0`；Native Workflow 三项均为 `null`（未启用） |
| 业务数据 | 验收前后完全一致：提醒 33/4、报告 0、投递 0、消息 25、Outbox 41 |

未携带 Worker 密钥的同一 Route 返回 `401`，且不进入任何任务。

## 5. PG17 统一试点真实执行

统一配置：

| 链路 | 模式 | 企业 | Pilot |
| --- | --- | --- | --- |
| 提醒 | `pilot` | `5` | `f2-pilot` |
| 周报 | `pilot` | `5` | `f2-pilot` |

同一编排函数 `runAssistantJobsTick()`，真实提醒/周报业务入口，真实数据库行。其他 Assistant Job 使用确定性替身，避免处理无关任务。

### 5.1 第一次 tick

| 检查 | 结果 | 真实依据 |
| --- | --- | --- |
| alignment | `aligned` + `pilot` | 企业 `5`、`f2-pilot` 完全一致 |
| 提醒生成 | `created=6`，新增 3 行 | scopeVersion `8`、`active`、扫描 1 个项目 |
| 周报生成 | `queued=2` | scopeVersion `8`、`scopedProjects=1`、errors 0 |
| 提醒投递 | `delivered=2`、`failed=1` | 业主与施工人员站内消息；项目经理 `no_inbox` |

### 5.2 周报事实与投递

| reportId | audience | revision | runId | facts projectIds | policy projectIds | facts_hash |
| --- | --- | --- | --- | --- | --- | --- |
| `13` | customer | 1 | `13` | `[8]` | `[8]` | `b22d13e1ac583324b74f1a0bf9de4b19f56279ec9c0254ac3db1c4b9d09b379a` |
| `14` | boss | 1 | `14` | `[8]` | `[8]` | `535a5ec9ef969ee84039e1a2bbe0e8898cd29caf59427ea60c3ee31a73845f77` |

| 投递 | reportId | 状态 | eventId | messageId | conversationId |
| --- | --- | --- | --- | --- | --- |
| `13:1` | `13` | `delivered` | `102` | `52` | `15`（业主） |
| `14:1` | `14` | `delivered` | `104` | `53` | `19`（老板） |

### 5.3 提醒回执

| reminderId | 角色 | 状态 | messageId | conversationId |
| --- | --- | --- | --- | --- |
| `rem_e320ce5f3e451d84a4fc98bf` | owner | `delivered` | `50` | `15` |
| `rem_d8aeae850e3eda320847c4af` | worker | `delivered` | `51` | `17` |
| `rem_ec6c6e03f3dd7c90dee06459` | manager | `failed/no_inbox` | — | — |

项目经理没有私人会话，沿用既有合同进入项目工作台待办，不伪造站内消息。

### 5.4 范围与版本

| 检查 | 结果 |
| --- | --- |
| 两条链路使用相同企业/试点 | `5` / `f2-pilot` |
| 提醒 scopeVersion | `8` |
| 周报 scopeVersion | `8` |
| 周报投递 scopeVersion | `8` |
| 数据库最新 active 范围 | 版本 `8`，`[8]` |
| 范围外项目 9 | 提醒仍为 4 条，无新增；无周报 |
| 跨企业项目进入范围 | `0` |

### 5.5 重复 tick

第三次统一 tick：

- 提醒投递 `0`，周报生成 `queued=0`，周报投递 `0`。
- 提醒、周报、投递、消息、Outbox 前后完全一致：`36 / 4 / 2 / 2 / 29 / 49`。
- 未新增报告、消息或投递回执。

### 5.6 配置不一致 tick

在已有 F4 业务数据上再次执行，提醒 `pilot`、周报 `enterprise`：

- alignment `mismatch`，`pilot_worker_mode_mismatch`。
- 四项显式调用计数均为 `0`。
- Knowledge Batch 与 Assistant Job 各执行 `1` 次。
- 业务数据完全不变，四项响应均为 `skipped`，未回退企业模式。

## 6. 工程回归

| 项 | 结果 |
| --- | --- |
| `pilot-worker-alignment.test.ts` | 11 项通过 |
| `worker-tick-alignment.test.ts` | 14 项通过（A–H 调用次数、异常隔离、Native Workflow、401/422） |
| `stage-reminder-worker.test.ts`、`reminder-service.test.ts`、`pilot-scope-resolver.test.ts`、`stage-reminder-config.test.ts` | 通过 |
| `report-worker-pilot.test.ts`、`report-store-pilot-scope.test.ts`、`pilot-report-scope.test.ts`、`weekly-report-config.test.ts` | 通过 |
| 上述 10 个定向文件合计 | `121 passed / 0 failed` |
| TypeScript `npx tsc --noEmit` | 通过 |
| 定向 ESLint | 通过 |
| F1 企业 `1` 只读回归 | 项目 2、记录 2、提醒 0、报告 10、投递 10、设置 `project_ids=[]`，与 F1 记录一致 |
| 早前 F2 企业 `4` 只读回归 | 项目 2、提醒 28（已投递 14）、报告 0，与 F2 记录一致 |

## 7. 失败轮次与清理说明

| 轮次 | 结果 | 原因 |
| --- | --- | --- |
| run-01 | `failed` | F2 手工创建的业主会话缺少 `assistant_participants`，周报 facts 授权返回 `assistant_resource_not_found` |
| run-02 | `failed` | 验收把合成项目推进到 `completion`，而周报只覆盖 `completion`/`move_in` 之前的项目，导致 `queued=0` |
| run-03 | `passed` | 补业主参与者、项目归一化为油漆→软装后重跑 |

run-01 在 facts 生成前失败，产生了两条无 facts、无投递、无消息的报告行及其失败 Job。为恢复合成夹具后重跑，已仅清理这两条未产生业务触达的报告/版本/Job/运行记录及对应的老板绑定/会话；run-01 的 `result.json` 保留。run-02 产生的完成阶段提醒保留，作为追加历史。

## 8. 状态汇总

| 类别 | 状态 |
| --- | --- |
| 配置组合 A–H | `passed` |
| 四项调用次数（一致=1，不一致=0） | `passed` |
| 其他 Assistant Job 不受影响 | `passed` |
| 401 提前拒绝 | `passed` |
| Native Workflow 启用条件不变 | `passed` |
| PG17 统一试点提醒生成/投递 | `passed` |
| PG17 统一试点周报生成/投递 | `passed` |
| 两条链路同企业/试点并读取最新 scopeVersion | `passed` |
| 范围外项目零新增 | `passed` |
| 重复 tick 幂等 | `passed` |
| 完整 Route（统一配置） | `limited`：时钟不可注入，且会处理队列中的报告正文 Job |
| 完整 Route（配置不一致） | `passed` |
| 真实微信/订阅通知、生产部署 | `not_run` |
| 多企业并发、长周期压测 | `limited`（本轮单企业、单周） |

## 9. 明确限制

- 统一配置下四项任务使用真实业务入口、真实数据库和抽取后的编排函数；完整 HTTP Route 只在配置不一致路径做真实执行。原因是 Route 使用进程时钟，无法固定周报周期，并会处理与本验收无关的排队任务。
- 未发送真实微信/订阅通知；提醒和周报均为隔离数据库内的站内消息。
- 未合并 `main`、未部署生产、未修改生产环境变量或微云真实企业配置。
- 合成项目从 `completion` 归一化回 `油漆→软装`，仅用于让周报覆盖该 active 项目；该操作记录在验收证据中。
