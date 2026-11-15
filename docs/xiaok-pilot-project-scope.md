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

## PG17 双项目真实隔离验收（I7.4.5-F1）

在独立 PostgreSQL `17.10` 数据库 `i745_f1_accept` 上，使用真实 Worker 入口 `advanceConfiguredConstructionReports()` / `deliverConfiguredConstructionReports()` 完成 101/205 双项目周报生成、投递、范围收缩和故障验收。19 项检查全部 `passed`：

- 主链路业主与老板周报只包含项目 101；企业 `project_ids=[]` 时仍受 Pilot Scope 限制。
- 企业 `project_ids=[205]` 与试点 `[101,205]` 交集为 `[205]`，只生成项目 205 周报。
- 范围从 `[101,205]` 收缩为 `[101]` 后，已排队老板报告被 `revoked`，report version、facts、facts_hash、历史消息和 Outbox 均不变。
- 权限与故障 A–H 全部 fail closed；`enterprise` 模式仍可投递双项目老板报告。

详见 [I7.4.5-F1 PG17 验收](./xiaok-i745-f1-live-acceptance.md)。限制：单企业单周、故障场景 facts 为合成最小事实、Resolver 故障通过临时权限撤销注入、未发送真实通知。

## 主动提醒双项目真实隔离验收（I7.4.5-F2）

在 F1 同一 PG17.10 数据库 `i745_f1_accept` 新建合成企业 `5`，复用 127 条迁移与强制 RLS，使用真实 `advanceConfiguredStageReminders()` / `deliverConfiguredStageReminders()` 完成提醒生成、站内投递、范围扩张/收缩、权限与故障验收。12 项 `passed`、0 `failed`、1 项 `limited`（空 active 范围被数据库约束拒绝，单元测试覆盖）。

- 范围仅 101 时只为项目 101 生成提醒；项目 205 无提醒、无试点消息。
- 范围扩至 101+205 后两个项目生成 pending；收缩为仅 101 后只投递 101，205 pending 保留且不删除。
- delivered 提醒均有真实 messageId/conversationId；重复 tick 不重复生成/发送。
- Pilot 不存在/停用/Resolver 失败零生成零投递；业主撤权取消；删除目标会话保持 failed/no_inbox，恢复后重试 delivered；enterprise 模式可投递 205。
- F1 企业原始项目、记录和提醒不变。

详见 [I7.4.5-F2 主动提醒 PG17 验收](./xiaok-i745-f2-reminder-acceptance.md)。

## 提醒与周报统一配置校验（I7.4.5-F3）

`admin/src/lib/xiaok-v1/pilot-worker-alignment.ts` 新增 `checkPilotWorkerAlignment(env)`，复用 `readStageReminderConfig()` 与 `readWeeklyReportConfig()`，不重复实现解析，也不读取数据库。

| 状态 | 条件 | Worker 行为 |
| --- | --- | --- |
| `aligned` + `enterprise` | 两者均 `enterprise`，且 `enterpriseId` 完全相同（两边都为空，或同为同一企业） | 保持原企业级提醒/周报行为 |
| `aligned` + `pilot` | 两者均 `pilot`，`enterpriseId` 与 `pilotId` 完全一致 | 允许四项运行 |
| `mismatch` | 一方 pilot、一方 enterprise；Enterprise 仅一边配置企业 ID；企业 ID 不同；pilot ID 不同 | 跳过四项 |
| `invalid` | 任一配置解析失败 | 跳过四项 |

Enterprise 范围规则：两边 `enterpriseId` 都为空表示全企业模式；两边必须同时为空或同为同一企业。只有提醒配置企业 ID、只有周报配置企业 ID、或两边企业 ID 不同，均返回 `pilot_worker_enterprise_mismatch`。系统不会自动清空单边配置，也不会回退全企业。

错误码：`pilot_worker_mode_mismatch`、`pilot_worker_enterprise_mismatch`、`pilot_worker_pilot_mismatch`；解析错误沿用 `stage_reminder_*` / `weekly_report_*`。

Worker Route 在四个入口前调用一次 `checkPilotWorkerAlignment()`，只有 `aligned` 时执行：

- `advanceConfiguredStageReminders()`
- `deliverConfiguredStageReminders()`
- `advanceConfiguredConstructionReports()`
- `deliverConfiguredConstructionReports()`

非 `aligned` 时四项返回 `skipped: true, reason: 'pilot_worker_alignment', errorCode`，响应包含完整的 `pilotScopeAlignment`。其他 Assistant Job、Knowledge Batch、Native Workflow、站内公开通知继续运行；401 授权逻辑不变；任何失败都不回退到 enterprise。

定向验证（11 项一致性检查 + Worker/周报回归，共 47 项）：

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/pilot-worker-alignment.test.ts src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts src/lib/construction/__tests__/report-worker-pilot.test.ts
```

测试结果：47 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。本轮未修改生产环境变量、真实企业配置，未发送真实通知。

## Worker 统一配置端到端验收（I7.4.5-F4）

Worker 编排从 `jobs/run/route.ts` 抽取到 `admin/src/lib/assistant/infrastructure/jobs-tick.ts` 的 `runAssistantJobsTick()`。Route 仅保留 401 鉴权、请求体校验与响应封装；编排函数默认依赖不变，并可注入 `now`、`env` 和各 Job 函数以验证真实调用次数。周报生成与投递补上与提醒一致的独立 `try/catch`，单个 Worker 失败不再跳过其他独立任务。

配置组合与行为：

| 组合 | 配置 | 四项 Worker |
| --- | --- | --- |
| A/B | 两边 `enterprise`，企业 ID 均为空或相同 | 各执行 1 次 |
| C | 两边 `pilot`，`enterpriseId` 与 `pilotId` 相同 | 各执行 1 次 |
| D/E | 一边 `pilot`、一边 `enterprise` | 均 0 次，`pilot_worker_mode_mismatch` |
| F | 两边 `enterpriseId` 不同 | 均 0 次，`pilot_worker_enterprise_mismatch` |
| G | 两边 `pilotId` 不同 | 均 0 次，`pilot_worker_pilot_mismatch` |
| H | 任意一边配置非法 | 均 0 次，解析错误码，`mode=null` |

不一致时四项均返回 `skipped`，Knowledge Batch、Assistant Job、站内通知与 Native Workflow 继续按原条件运行；401 仍在任何任务前拒绝；任何情况都不回退 `enterprise`。

PG17 复用 `i745_f1_accept` 与 F2 合成企业 `5`、`f2-pilot`、项目 `8`/`9`，统一配置执行：

- 提醒 scopeVersion 与周报 scopeVersion 均为数据库最新的 `8`；提醒新增 3 行（业主/施工投递，经理 `no_inbox`），周报 `queued=2`。
- 业主周报 `13`（message `52`）与老板周报 `14`（message `53`）均 `delivered`，facts 与 policy 只含项目 `8`。
- 范围外项目 `9` 无新增提醒或周报；重复 tick 业务计数完全不变。
- 真实 HTTP Route 在提醒 `pilot`、周报 `enterprise` 时返回 200，四项全部跳过，其他 Job 正常执行且业务数据零变化。

定向验证（10 个文件，122 项）：`pilot-worker-alignment.test.ts`、`worker-tick-alignment.test.ts`、`stage-reminder-worker.test.ts`、`reminder-service.test.ts`、`report-worker-pilot.test.ts`、`report-store-pilot-scope.test.ts`、`pilot-scope-resolver.test.ts`、`pilot-report-scope.test.ts`、`stage-reminder-config.test.ts`、`weekly-report-config.test.ts`。测试结果：122 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。

I7.4.5-F4.1 补充完整 HTTP Route 一致配置验收：`createAssistantJobsPost()` 位于 `admin/src/lib/assistant/infrastructure/jobs-post-handler.ts`，只允许注入固定时钟、环境和确定性非目标 Job，四项提醒/周报始终使用真实实现，注入参数无法通过 HTTP 请求控制。在 PG17 同一合成企业上连续三次真实 POST 均返回 200，两次链路 scopeVersion 均为 `10`；第一次生成提醒并投递 2 条、排入 1 份老板周报，第二次投递该周报（message `59`），第三次零新增，业务计数保持 `42 / 4 / 4 / 4 / 35 / 61`；401、422、503 均保持原语义。未发送真实通知、未部署生产、未合并 `main`。

详见 [I7.4.5-F4 统一 Worker 配置验收](./xiaok-i745-f4-worker-alignment-acceptance.md)。

## 通知边界

`active` 状态供预检选择配置版本。保存和检查均无投递入口。现有提醒 Worker 的生成与投递按同一部署模式运行：I7.5.8 起，未配置模式或使用企业模式时，四项业务 Worker 不运行（安全门禁关闭）；只有显式 `pilot` 模式才按试点最新范围生成并投递，范围外 pending/failed 不查询、不投递、不重试，配置错误时跳过本轮提醒（见上节）。周报生成与投递均按独立的企业/试点模式运行：企业模式在 I7.5.8 中保持关闭；`pilot` 生成只取试点范围与企业 `project_ids` 交集，投递只允许 facts 快照全部项目都在最新试点范围内的 pending/held 报告，范围外或无法确认的待发送报告直接撤销投递，配置错误、试点不存在/停用/不可用或空范围时零生成零投递，不回退企业全量。已 `delivered` 历史、报告版本、facts 快照、消息和 Outbox 均不修改。I7.4.5-F1 已在独立 PG17 数据库完成双项目周报真实生成、投递和范围收缩验收；I7.4.5-F2 已完成主动提醒的双项目生成、站内投递、范围收缩、权限与故障验收；I7.4.5-F3 增加提醒/周报统一配置校验，不一致或非法时四个 Worker 入口均跳过（见 I7.4.5-F3 节）；I7.4.5-F4 已抽取统一 Worker 编排并完成四项任务端到端验收；I7.4.5-F4.1 已完成完整 HTTP Route 一致配置验收（见上节）。

预检列出现有规则可能覆盖的范围外项目及未完成提醒，另读取周报待发或挂起事实快照中引用的范围外项目。候选覆盖和排队记录都不是发送回执。已有规则或存量投递涉及范围外项目时会给出 `pilot.outside_delivery`。范围外原有规则继续运行，启用试点触达前须另行核定运行时范围及存量投递。详见[预检工具](xiaok-pilot-readiness-checker.md)和[首家试点记录](xiaok-first-pilot-enterprise-readiness.md)。

## Worker 安全启动门禁（I7.5.8）

`admin/src/lib/xiaok-v1/worker-safety-gate.ts` 提供纯函数 `evaluateWorkerSafetyGate(env)`，在提醒/周报模式一致性检查之上再增加一层部署门禁：

| 配置 | 门禁 | 说明 |
| --- | --- | --- |
| 两边 `pilot`，企业/试点一致 | `open` | 仍需每次 tick 解析最新保存范围 |
| 未配置模式，或只配置企业 ID | `closed` | `pilot_scope_missing` |
| 任意 `enterprise`（含指定一个企业） | `closed` | `enterprise_scope_not_allowed`，企业全量保持关闭 |
| 模式/企业/试点不一致或非法 | `closed` | 保留原有 `pilot_worker_alignment` 错误码 |

`runAssistantJobsTick()` 只在门禁 `open` 时调用四项业务 Worker；跳过时返回 `skipped=true`、`reason=worker_safety_gate`、`gateReason` 和错误码。其他 Assistant Job 保持原条件运行。`GET /api/internal/assistant/jobs/preflight`（`CRON_SECRET` 保护）返回门禁、脱敏模式摘要、试点范围状态与**全局**只读队列预览；`assistant-worker.mjs` 在 tick 前调用该接口，门禁关闭退出码 2，预检不可用/无效退出码 1。企业全量没有环境变量旁路。

队列预览在 PostgreSQL `READ ONLY` 事务中统计 queued、expired running、failed、indeterminate，并只把“已到期 queued、过期且未派发供应商、过期且 agent 步骤结果完整”标记为可安全领取；`provider_started_at` 已设置但结果未知保持 indeterminate，`failed`/`indeterminate` 不自动重试。预览不领取、不标记、不发送通知。

验收：隔离 PG17 `i745_f1_accept` 21 passed / 0 failed；门禁、dry-run 不变性、重复启动、并发领取、心跳 fencing、provider start 幂等、未知结果不重放、failed 终态与未保存试点零生成零投递均通过。详见 [I7.5.8 验收](./xiaok-i758-worker-safe-startup-acceptance.md)。
