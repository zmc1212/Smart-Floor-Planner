# 家客来 1.0 试点项目范围（I7.4.4）

企业管理员通过管理端 API 提交第一批试点的明确项目 ID。每个企业可以维护多个 `pilotId`，预检每次读取指定试点的最新版本。

## 范围合同

| 字段 | 约束 |
| --- | --- |
| `enterpriseId` | 从管理端会话取得当前企业，正 bigint 字符串。 |
| `pilotId` | 同一企业内的试点标识，1–128 个英文字母、数字或 `._:-`。 |
| `projectIds` | 非空、无重复的正 bigint 字符串数组。每个项目必须属于当前企业，项目和关联线索均未归档。已暂停项目可被显式选中，预检按其实际状态报告。 |
| `createdBy` | 服务端记录保存该版本的管理端账号 ID。 |
| `createdAt` | 数据库生成的版本时间，接口返回 UTC ISO 8601。 |
| `scopeVersion` | 每个企业、每个试点独立从 1 递增。 |
| `status` | `active` 供预检读取，`inactive` 停用该试点。停用沿用最新版本的项目清单，即使项目后来已归档或删除。 |

迁移 `0130` 新建 `app.xiaok_pilot_project_scopes`。每次保存追加版本，校验 `expectedVersion`，并在同一试点内串行写入。数据库触发器在写入有效范围时核对项目和线索归属，跨企业、未知或已归档的引用统一返回 `pilot_project_unavailable`。范围表启用并强制 RLS。项目后续生命周期由 Construction 管理，预检会重新核对已选项目是否可用。

## 管理端 API

- `GET /api/construction/pilot-scopes/{pilotId}` 读取最新版本。未知试点返回 404。
- `PUT /api/construction/pilot-scopes/{pilotId}` 提交 `projectIds`、`expectedVersion`、`status`。首次保存传 `expectedVersion: 0` 和 `status: "active"`。后续保存传当前版本，冲突返回 409，读取后再提交。停用时传当前项目清单及其原顺序。

使用管理端会话，沿用选定企业、施工管理角色和实时 `construction_actor_access='owner'` 核验。企业负责人只能管理本企业。平台 `admin`、`super_admin` 沿用选定企业管理权限。施工人员、项目经理、设计师、需改密账号和小程序身份均无配置权限。项目状态、成员权限、企业跨项目权限及报告设置继续由各自的业务服务管理。

以下为合成示例请求体。

```json
{"projectIds":["101","205"],"expectedVersion":0,"status":"active"}
```

## 只读预检

```powershell
cd admin
npm run check:pilot-readiness -- --enterprise-id 123 --pilot-id first-pilot
npm run check:pilot-readiness -- --enterprise-id 123 --project-ids 101,205
```

- `--pilot-id` 检查已保存的最新版本。缺失、停用、不可用 ID、空范围均为 `blocked`。部分 ID 不可用时整组判为无效。
- `--project-ids` 供只读试算。有效名单至少产生一条 `pilot.scope` warning，因为它尚无企业管理员保存的记录。
- 只提供企业 ID 时返回企业检查及缺少范围的 blocker。诊断整个企业的历史项目可显式传 `--enterprise-audit`。
- 企业检查包括 Assistant、全局 Worker、迁移 0128–0130、业务账号和强制 RLS。试点项目检查分别给出缺阶段、缺有效计划、角色覆盖不完整和 C01 缺失的 ID。部分 C01 缺失沿用 warning，没有任何可用 C01 时阻断。
- `outsideScope.activeProjects` 列出范围外 active 项目。范围外项目资料缺项独立于试点项目就绪结果。

## 统一只读范围解析（I7.4.5-A）

`admin/src/lib/xiaok-v1/pilot-scope-resolver.ts` 提供提醒与周报后续复用的统一读取入口。调用方传入当前企业、试点 ID 和本次业务运行的只读上下文；解析器只读取最新版本，不写库、不发送提醒或周报，也不改变现有 Worker。

| 输入 | 约束 |
| --- | --- |
| `enterpriseId` | 正 bigint 字符串，来自当前业务运行的企业范围。 |
| `pilotId` | 同一企业内的试点标识，1–128 个英文字母、数字或 `._:-`。 |
| `context.read` | 绑定当前租户事务的只读查询；使用 `tenantPilotScopeRead(tx)` 复用调用方已有事务，不新开连接。 |
| `context.now` | 本次业务运行的可信当前时间；缺省使用进程时间。 |

| 输出 | 含义 |
| --- | --- |
| `enterpriseId`、`pilotId` | 规范化后的请求标识。 |
| `scopeVersion` | 最新保存的版本号；试点不存在时为 `null`。 |
| `projectIds` | 仅 `active` 返回保存的项目；其他状态为空数组。 |
| `status` | `active`、`inactive`、`not_found` 或 `empty`。 |
| `resolvedAt` | 本次解析时间，UTC ISO 8601。 |

- 每次只读取指定企业、指定试点的最新版本，不回退到更早的 active 版本。
- 读取函数已按企业和试点过滤；解析器再核对返回记录的企业和试点，外来或不匹配的记录按 `not_found` 处理，不返回其项目 ID。
- 最新版本停用时返回 `inactive`。不存在时返回 `not_found`。
- 最新版本为 active 但项目集合为空时返回 `empty`，不扩大到全企业。现有保存接口和数据库约束拒绝空清单，该状态用于防御历史或人工数据。
- 解析器不读取项目明细、提醒、报告、会话或 Outbox，不产生任何数据库写入。I7.4.5-A 只提供读取入口；I7.4.5-B 已把提醒 Worker 的显式试点模式接入该入口（见下节），周报尚未接入。

定向验证：

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/pilot-scope-resolver.test.ts
```

## 提醒 Worker 试点范围（I7.4.5-B）

`admin/src/lib/xiaok-v1/reminder-service.ts` 的 `advanceStageReminders(now, enterpriseId, pilotId)` 增加可选 `pilotId`。企业 ID 仍来自当前业务运行上下文（Worker 调用方），不从试点记录反推；传入 `pilotId` 但缺少企业 ID 时直接抛出 `pilot_scope_enterprise_required`，不执行任何查询。

### 普通企业模式

未传 `pilotId` 时保留原企业提醒 Worker 行为：按有效 active 项目和阶段事实逐个项目计算提醒，返回结构仍为 `{created, errors}`，不读取试点范围，也不改变历史已发送提醒。

### 试点提醒模式

传入 `pilotId` 时：

| 步骤 | 规则 |
| --- | --- |
| 读取范围 | 在调用方企业 ID 的租户事务中通过 `resolvePilotScope()`（`tenantPilotScopeRead(tx)`）只读最新版本。 |
| 项目筛选 | 只查询并处理 `scope.projectIds` 中的项目；范围外项目不查询、不计算、不写入。 |
| 事务与 RLS | 范围读取和每个项目的提醒计算都复用 `withTenantTransaction()`，不新开租户范围。 |
| 历史提醒 | 只按现有规则重整 pending/paused/failed 状态；delivered 历史提醒不修改。 |

返回结果在 `created`、`errors` 之外增加：

| 字段 | 含义 |
| --- | --- |
| `pilotId` | 本次运行的试点标识。 |
| `scopeVersion` | 使用的最新版本号；试点不存在或读取失败时为 `null`。 |
| `scopeStatus` | `active`、`inactive`、`not_found`、`empty`，或读取/项目查询失败时的 `unavailable`。 |
| `scannedProjects` | 实际处理的范围项目数；处理失败的项目仍计入。 |
| `skippedProjects` | 范围内未被现有 Worker 规则处理的数（缺失、已归档或非 active），不统计范围外项目。 |

### 失败关闭规则

- 试点不存在：`not_found`，不处理项目。
- 最新版本停用：`inactive`，即使历史版本有项目也不处理。
- 最新版本 active 但项目为空：`empty`，不扩大到全企业。
- 范围读取失败或范围项目查询失败：`unavailable`，`errors` 记录 `pilot_scope_unavailable`，不回退到全企业扫描。
- 单个项目提醒计算失败：该项目记入 `errors`（`stage_reminder_unavailable` 或业务错误码），其他范围项目继续处理，范围外项目仍不处理。

定向验证（I7.4.5-B 的 9 项保留；I7.4.5-C3 追加投递用例后同一文件共 22 项）：

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/reminder-service.test.ts
```

测试结果：I7.4.5-B 验收时 9 项通过，0 失败；C3 追加后当前 22 项通过（见下节）。`npx tsc --noEmit` 与定向 ESLint 通过。该验证使用内存替身，不连接数据库、不发送提醒；真实试点触达仍需单独的隔离环境验收。

## 提醒 Worker 模式配置（I7.4.5-C1）

`admin/src/lib/xiaok-v1/stage-reminder-config.ts` 提供纯配置解析。本轮不接入 Worker，不读取数据库，不发送通知，不修改任何环境变量。

| 环境变量 | 含义 |
| --- | --- |
| `XIAOK_STAGE_REMINDER_MODE` | `enterprise` 或 `pilot`；未配置时默认 `enterprise`。 |
| `XIAOK_STAGE_REMINDER_ENTERPRISE_ID` | 正 bigint 企业 ID；pilot 模式必填，enterprise 模式可选。 |
| `XIAOK_STAGE_REMINDER_PILOT_ID` | 1–128 个英文字母、数字或 `._:-`；pilot 模式必填，enterprise 模式忽略。 |

解析结果 `readStageReminderConfig(env)`：

| 结果 | 含义 |
| --- | --- |
| `{ok:true, mode:'enterprise', enterpriseId, pilotId:null}` | 普通企业模式；未配置模式时也返回此项。 |
| `{ok:true, mode:'pilot', enterpriseId, pilotId}` | 完整试点配置。 |
| `{ok:false, mode, code}` | 明确配置错误，调用方不得自行回退。 |

失败关闭规则：

- 未知模式：`stage_reminder_mode_invalid`，`mode` 为 `null`。
- pilot 缺少企业 ID（未设置、空串或空白）：`stage_reminder_enterprise_required`。
- 企业 ID 非法（前导零、非数字、小数或超出 bigint）：`stage_reminder_enterprise_invalid`。
- pilot 缺少试点 ID：`stage_reminder_pilot_required`。
- 试点 ID 非法：`stage_reminder_pilot_invalid`。
- enterprise 模式提供非法企业 ID 时同样返回 `stage_reminder_enterprise_invalid`；显式 enterprise 模式下残留的 pilotId 被忽略，不会切换成试点。
- 任何错误都不会自动回退到 enterprise。

定向验证（8 项）：

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/stage-reminder-config.test.ts
```

测试结果：8 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。C1 未接入 Worker；I7.4.5-C2 已接入，见下节。

## Worker 接入（I7.4.5-C2）

`admin/src/app/api/internal/assistant/jobs/run/route.ts` 在每次 Worker tick 的提醒推进处调用 `advanceConfiguredStageReminders({now})`。该函数位于 `admin/src/lib/xiaok-v1/stage-reminder-worker.ts`，先读取 C1 配置，再按模式调用现有 `advanceStageReminders()`：

| 模式 | 调用 |
| --- | --- |
| 未配置 / `enterprise` | 调用原企业级提醒 Worker；配置了企业 ID 时作为 `onlyEnterprise` 传入，pilotId 不参与。 |
| `pilot` | 传入明确的 `enterpriseId` 和 `pilotId`，只处理该试点最新范围。 |
| 配置错误 | 记录错误并跳过本轮提醒，不调用提醒服务，不回退企业模式。 |

`stageReminderChecks` 记录 `mode`、`pilotId`、`scopeVersion`、`scopeStatus`、`scannedProjects`、`skippedProjects`、`created`、`errors`。企业模式的试点范围字段为 `null`，表示不适用；配置错误的 `errors` 携带 C1 错误码，计数均为 0。

隔离边界：

- 提醒推进仍包在独立 `try/catch` 中，失败只写入 `stageReminderChecks`，不影响后续 Assistant Job。
- 周报推进与投递、其他 Worker Job 未修改；`deliverStageReminders()` 的投递路径在 C2 中未修改，C3 已把投递接入同一模式配置（见下节）。
- 未授权请求仍在进入任何任务前返回 401。
- 本轮未修改任何生产环境变量，未发送真实试点通知。

定向验证（I7.4.5-C2 时 A–G 共 6 项；C3 追加投递用例后同一文件共 10 项）：

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts
```

测试结果：C2 验收时 6 项通过，0 失败；C3 追加后当前 10 项通过（见下节）。`npx tsc --noEmit` 与定向 ESLint 通过。

## 提醒投递试点范围（I7.4.5-C3）

`admin/src/lib/xiaok-v1/reminder-service.ts` 的 `deliverStageReminders(now, enterpriseId, pilotId)` 增加可选 `pilotId`，与 `advanceStageReminders` 使用同一组企业和试点参数。`admin/src/lib/xiaok-v1/stage-reminder-worker.ts` 新增 `deliverConfiguredStageReminders({now})`；它先读取与提醒生成相同的 `readStageReminderConfig()`，再按模式投递。`route.ts` 只把原来的 `deliverStageReminders()` 调用替换为该入口，不重构其他 Worker Job。

| 模式 | 投递范围 |
| --- | --- |
| 未配置 / `enterprise` | 保持原企业投递：按 `onlyEnterprise`（如配置）查询到期 pending/failed 提醒，逐项目投递。 |
| `pilot` | 在调用方企业 ID 下通过 `resolvePilotScope()`（`tenantPilotScopeRead(tx)`）只读最新 active 范围；项目查询直接带 `project_id in (scope.projectIds)`，范围外项目不查询、不投递、不重试。 |
| 配置错误 | 不调用投递服务，返回 C1 错误码，不执行企业投递。 |

投递规则：

- `not_found`、`inactive`、`empty` 均零投递；Resolver 读取失败或范围项目查询失败为 `unavailable`，同样零投递，不回退全企业。
- 每个范围内项目仍走原有投递规则：阶段变更过期、收件人权限复核（`permission_revoked`）、暂停、会话缺失 `no_inbox`、Outbox 唯一键幂等和 savepoint。
- 只查询并更新 `pending`/`failed`；已 `delivered` 的历史提醒不修改，范围外历史提醒不删除。
- 提醒生成与投递分别调用同一个 `readStageReminderConfig()`，同一 Worker tick 内使用同一 `mode` 和 `pilotId`。
- `stageReminderDeliveries` 记录 `mode`、`pilotId`、`scopeVersion`、`scopeStatus`、`scannedProjects`、`skippedProjects`、`delivered`、`paused`、`cancelled`、`failed`、`errors`。企业模式的试点字段为 `null`。
- `skippedProjects` 只统计本 tick 范围内没有到期可投递提醒的项目，不统计范围外项目。

测试使用内存替身和源码断言，不连接数据库、不发送真实通知。覆盖 A–J（企业模式原行为、试点只投递范围项目、范围外 pending、范围外 failed、试点不存在、停用、Resolver 故障、版本更新、delivered 历史、收件人撤权与 Outbox 幂等）以及空范围和范围查询失败。

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/reminder-service.test.ts src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts
```

测试结果：两个文件共 32 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。本轮未合并 `main`、未部署生产、未修改生产环境变量、未发送真实试点通知。

## 周报试点范围交集（I7.4.5-D1）

`admin/src/lib/xiaok-v1/pilot-report-scope.ts` 新增纯函数 `computePilotReportScope()`，只计算试点项目范围与企业周报 `construction_report_settings.project_ids` 的交集。本轮不接入 `report-worker.ts`、`report-store.ts` 或周报服务，不读取数据库，不生成或发送周报。

| 输入 | 含义 |
| --- | --- |
| `pilotProjectIds` | 试点最新 active 范围内的项目 ID。 |
| `reportProjectIds` | 企业原有周报项目筛选；空数组表示不限制企业项目范围。 |

| 输出 | 含义 |
| --- | --- |
| `projectIds` | 交集项目 ID，按试点输入顺序去重；新建数组，不修改输入。 |
| `status` | `active` 或 `empty`。 |
| `pilotScopeApplied` | 试点范围始终作为上限，固定为 `true`。 |
| `reportFilterApplied` | 企业周报筛选非空时为 `true`；空数组时为 `false`。 |

规则：

- 试点项目范围始终是上限；企业筛选为空时返回全部试点项目，但不会扩大到企业其他项目。
- 企业筛选非空时只返回两者交集；交集为空返回 `empty`，不回退全企业。
- 两个输入都去重，并统一使用现有 `id()` 的正 bigint 字符串格式；非法项目 ID 返回 `invalid_message`/422，非数组输入返回 `pilot_report_scope_invalid`/422。
- 不跨企业推断项目：函数只比较 ID，不查询项目归属。
- 输出顺序固定为试点输入顺序，重复调用结果稳定。

定向验证（8 项，覆盖 A–H：无企业限制、部分重叠、完全不重叠、空试点、重复 ID、非法 ID、不修改输入、稳定顺序）：

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/pilot-report-scope.test.ts
```

测试结果：8 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。D1 未接入周报 Worker，未修改企业周报配置，未生成或发送真实周报。

## 周报 Worker 模式配置（I7.4.5-D2a）

`admin/src/lib/xiaok-v1/weekly-report-config.ts` 提供周报 Worker 独立的纯配置解析。本轮不接入 `report-worker.ts`、`report-store.ts` 或周报服务，不读取数据库，不生成或发送周报，不修改任何环境变量。

| 环境变量 | 含义 |
| --- | --- |
| `XIAOK_WEEKLY_REPORT_MODE` | `enterprise` 或 `pilot`；未配置时默认 `enterprise`。 |
| `XIAOK_WEEKLY_REPORT_ENTERPRISE_ID` | 正 bigint 企业 ID；pilot 模式必填，enterprise 模式可选。 |
| `XIAOK_WEEKLY_REPORT_PILOT_ID` | 1–128 个英文字母、数字或 `._:-`；pilot 模式必填，enterprise 模式忽略。 |

周报模式使用独立环境变量，不读取 `XIAOK_STAGE_REMINDER_MODE` 等提醒 Worker 配置。

解析结果 `readWeeklyReportConfig(env)`：

| 结果 | 含义 |
| --- | --- |
| `{ok:true, mode:'enterprise', enterpriseId, pilotId:null}` | 普通企业模式；未配置模式时也返回此项。 |
| `{ok:true, mode:'pilot', enterpriseId, pilotId}` | 完整试点配置。 |
| `{ok:false, mode, code}` | 明确配置错误，调用方不得自行回退。 |

失败关闭规则：

- 未知模式：`weekly_report_mode_invalid`，`mode` 为 `null`。
- pilot 缺少企业 ID（未设置、空串或空白）：`weekly_report_enterprise_required`。
- 企业 ID 非法（前导零、非数字、小数或超出 bigint）：`weekly_report_enterprise_invalid`。
- pilot 缺少试点 ID：`weekly_report_pilot_required`。
- 试点 ID 非法：`weekly_report_pilot_invalid`。
- enterprise 模式提供非法企业 ID 时同样返回 `weekly_report_enterprise_invalid`；显式 enterprise 模式下残留的 pilotId 被忽略，不会切换成试点。
- 任何错误都不会自动回退到 enterprise。

定向验证（9 项，覆盖 A–H 及提醒变量隔离）：

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/weekly-report-config.test.ts
```

测试结果：9 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。D2a 未接入周报 Worker，企业报告配置和真实周报均未修改。

## 周报生成 Worker 试点范围（I7.4.5-D2b）

`admin/src/lib/construction/report-worker.ts` 的 `advanceConstructionReports(now, enterpriseId, pilotProjectIds)` 增加可选试点项目范围；`report-store.ts` 新增 `pilotScopedReportSettings()`，用 D1 的 `computePilotReportScope()` 把试点项目与企业 `construction_report_settings.project_ids` 求交集。Worker tick 改为调用 `advanceConfiguredConstructionReports({now})`，读取 D2a 的独立周报模式配置。

| 模式 | 生成范围 |
| --- | --- |
| 未配置 / `enterprise` | 完全保持原企业周报行为，项目筛选、受众和调度字段不变。 |
| `pilot` | 只处理配置中的企业和最新 active 试点范围；使用 `pilotScopedReportSettings()` 得到的有效设置发现 followup bindings，并只为范围内项目创建 daily、weekly、stage 报告。 |
| 配置错误 | 不调用周报 Worker，`errors` 返回 D2a 错误码。 |

规则：

- 试点范围始终是上限；企业 `project_ids` 为空时代表没有额外限制，但仍只生成试点项目。
- 企业 `project_ids` 非空时取交集；交集为空本轮零报告，不回退全企业。
- 有效设置是原 settings 的浅拷贝，只替换 `project_ids`；原企业 `settings.project_ids` 不写回、不修改。
- 新排队报告的 `policy_snapshot.scope.project_ids` 固定为本次交集；范围外 stage event 只推进 `stage_cursor`，不创建报告。
- 试点不存在、停用、空范围、Resolver 失败均零生成，不回退企业全量。
- 角色权限、`audiences`、`stage_keys` 和 `reportAudienceEnabled` 过滤保持不变。
- pilot 模式不执行历史日报补发修正（`supplementClosedDailyReports`），避免为范围外历史事实创建新任务；该逻辑仅在企业模式运行。
- 周报投递路径 `deliverConstructionReports()` 和已排队历史报告本轮不修改。

定向验证（report-store 7 项、Worker 11 项，覆盖 A–J 及配置错误）：

```powershell
cd admin
npx tsx --test src/lib/construction/__tests__/report-store-pilot-scope.test.ts src/lib/construction/__tests__/report-worker-pilot.test.ts
```

测试结果：18 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。本轮未修改生产环境变量和真实企业报告配置，未发送真实周报。

## 周报投递范围隔离（I7.4.5-D3）

`admin/src/lib/construction/report-worker.ts` 新增 `deliverConfiguredConstructionReports({now})`，Worker Route 的周报投递改为该统一入口，与周报生成共用 `readWeeklyReportConfig()`、`resolvePilotScope()` 和 `tenantPilotScopeRead()`。

| 模式 | 投递范围 |
| --- | --- |
| 未配置 / `enterprise` | 保持原企业投递、收件人、会话、阶段和幂等规则。 |
| `pilot` | 只处理配置企业的最新 active 试点范围；对每条 pending/held delivery 的不可变 facts 快照校验全部项目，全部在范围内才投递。 |
| 配置错误 / 试点不存在 / 停用 / 空范围 / Resolver 失败 | 零投递，不回退企业全量。 |

历史待发送报告规则：

- 每次 Worker tick 都按最新范围重新核验；范围版本变化后，下一 tick 对待发送报告立即生效。
- facts 快照包含任一范围外项目时，将该条 pending/held delivery 置为 `revoked`，不修改 report version、facts、facts_hash、历史消息或 Outbox。
- facts 缺失、为空、项目缺少合法 ID 或归属无法确认时同样不投递。
- 老板跨项目报告检查 `facts.projects` 的全部项目，不只看 `binding_id` 或 `report.projectId`。
- 已 `delivered` 历史报告不修改；不删除历史报告、消息或事件；不重新生成旧报告。
- 原有收件人权限、项目成员、`context_revision`、会话 mode/status 和 stage event 校验继续生效。

`admin/src/lib/xiaok-v1/pilot-report-scope.ts` 新增 `validatePilotReportDelivery()`，输出 `scopeStatus`、`scopeVersion`、`reportProjectIds`、`allowedProjectIds`、`excludedProjectIds`、`deliverable`。范围外快照只撤销投递，不裁剪 facts 后继续使用旧 hash。

定向验证（投递 A–O、生成 A–J 及两类配置错误）：

```powershell
cd admin
npx tsx --test src/lib/construction/__tests__/report-worker-pilot.test.ts src/lib/construction/__tests__/report-store-pilot-scope.test.ts src/lib/xiaok-v1/__tests__/weekly-report-config.test.ts src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts
```

测试结果：52 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。未发送真实周报，未修改生产环境变量或真实企业报告配置。

## 通知边界

`active` 状态供预检选择配置版本。保存和检查均无投递入口。现有提醒 Worker 的生成与投递按同一部署模式运行：默认 `enterprise` 仍按有效 active 项目和阶段事实生成并投递；`pilot` 在生成和投递两个环节都只处理该试点最新范围，范围外 pending/failed 不查询、不投递、不重试，配置错误时跳过本轮提醒（见上节）。周报生成与投递均按独立的企业/试点模式运行：默认 `enterprise` 保持原有生成和投递行为；`pilot` 生成只取试点范围与企业 `project_ids` 交集，投递只允许 facts 快照全部项目都在最新试点范围内的 pending/held 报告，范围外或无法确认的待发送报告直接撤销投递，配置错误、试点不存在/停用/不可用或空范围时零生成零投递，不回退企业全量。已 `delivered` 历史、报告版本、facts 快照、消息和 Outbox 均不修改。

预检列出现有规则可能覆盖的范围外项目及未完成提醒，另读取周报待发或挂起事实快照中引用的范围外项目。候选覆盖和排队记录都不是发送回执。已有规则或存量投递涉及范围外项目时会给出 `pilot.outside_delivery`。范围外原有规则继续运行，启用试点触达前须另行核定运行时范围及存量投递。详见[预检工具](xiaok-pilot-readiness-checker.md)和[首家试点记录](xiaok-first-pilot-enterprise-readiness.md)。
