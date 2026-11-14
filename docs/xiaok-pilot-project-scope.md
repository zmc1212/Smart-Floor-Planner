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

定向验证（9 项，覆盖普通模式、101/205 范围、306 范围外、试点不存在、停用、空范围、版本更新、同企业双试点隔离、Resolver 失败关闭）：

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/reminder-service.test.ts
```

测试结果：9 项通过，0 失败；`npx tsc --noEmit` 与定向 ESLint 通过。该验证使用内存替身，不连接数据库、不发送提醒；真实试点触达仍需单独的隔离环境验收。

## 通知边界

`active` 状态供预检选择配置版本。保存和检查均无投递入口。现有提醒 Worker 缺省仍按有效 active 项目和阶段事实运作；显式传入试点 ID 时只处理该试点最新范围（见上节）。周报仍按 `construction_report_settings.project_ids`、`stage_keys`、项目生命周期和收件权限计算。空的企业周报项目清单表示全部符合条件的项目。

预检列出现有规则可能覆盖的范围外项目及未完成提醒，另读取周报待发或挂起事实快照中引用的范围外项目。候选覆盖和排队记录都不是发送回执。已有规则或存量投递涉及范围外项目时会给出 `pilot.outside_delivery`。范围外原有规则继续运行，启用试点触达前须另行核定运行时范围及存量投递。详见[预检工具](xiaok-pilot-readiness-checker.md)和[首家试点记录](xiaok-first-pilot-enterprise-readiness.md)。
