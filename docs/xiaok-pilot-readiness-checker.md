# 小K 1.0 试点企业只读预检（I7.4.2）

> 分支：`codex/xiaok-integration`，基线 `be361f66e5c9`。
> 范围：只读预检工具，用于企业正式启用前确认企业、项目、四端账号、阶段、计划、周报、Assistant 与 Worker 是否准备完成。
> 本轮不执行生产初始化、不部署生产、不修改生产数据。

## 1. 目标与边界

检查器回答一个问题：**指定企业现在是否具备第一批试点条件。**

它只读取数据库、Worker 健康文件和代码内十阶段配置，不创建企业、不修改用户/项目、不创建提醒、不生成周报、不发送通知、不修改生产配置、不绕过 RLS、不输出数据库连接串或密码。

调用方必须显式传入一个 `enterpriseId`；工具不提供“扫描全部企业”的默认行为。

## 2. 运行方式

```powershell
cd admin
npm run check:pilot-readiness -- --enterprise-id 123
```

- `DATABASE_URL`：业务数据库连接，生产必须使用非超级用户（如 `sfp_app`）。
- `ASSISTANT_WORKER_HEALTH_FILE`：Assistant Worker 健康文件；未设置时读取系统临时目录的 `assistant-worker-health.json`。
- 输出：JSON 报告到 stdout。
- 退出码：`0` = ready/limited，`2` = blocked，`1` = 执行错误（含未指定 enterpriseId）。

示例：

```powershell
$env:ASSISTANT_WORKER_HEALTH_FILE="D:\shared\assistant-worker-health.json"
npm run check:pilot-readiness -- --enterprise-id 123 > pilot-readiness-123.json
```

未提供 `--enterprise-id` 或提供非法值时，命令在连接业务数据前失败，不会回退为全企业扫描。

## 3. 检查项

| # | 检查项 | 判定依据 | 失败级别 |
| --- | --- | --- | --- |
| 1 | 企业状态 | `app.enterprises.status='active'`；不可见时明确报告“不存在或无权查看” | blocker |
| 2 | Assistant 启用 | `assistant_enterprise_settings` 的启用、保留期和写入配额（复用 `assistantWritesEnabled`） | blocker |
| 3 | 有效项目 | 线索未归档且项目未归档；没有 active 项目时 warning | blocker / warning |
| 4 | 项目当前装修阶段 | `current_stage_key` 非空且存在于企业阶段配置；非小K标准阶段时 warning | blocker / warning |
| 5 | 十阶段配置 | 十个标准施工阶段 key、十套知识包、十套提醒策略均完整且 active | blocker |
| 6 | 有效施工计划 | 复用 `readSchedule`：已发布、结构有效、节点非空、覆盖当前阶段 | blocker |
| 7 | 业主账号 | 项目线索绑定客户账号且 `customer_access` 开启 | blocker |
| 8 | 老板跨项目权限 | `enterprise_admin` 等管理角色 + `construction_actor_access='owner'` | blocker |
| 9 | 项目经理 | 有效项目上的 active `manager` 成员 + 施工访问权限 | blocker |
| 10 | 项目经理工作台 | `canManageConstructionProject` 成立，工作台待办入口可用 | blocker |
| 11 | 业主 C01 | 存在 open/ai 的 `customer_consultation` 会话且客户参与人 active | blocker（部分项目缺失时 warning） |
| 12 | 设计师项目成员 | active `designer` 成员 + 施工访问权限 | blocker |
| 13 | 施工人员任务权限 | active `worker` 成员 + 施工访问权限 | blocker |
| 14 | 企业报告计划 | `construction_report_settings.enabled=true`；范围引用无效项目/阶段时 warning | blocker / warning |
| 15 | 四角色周报受众 | `audiences` 覆盖 customer/worker/designer/boss；缺少可用跟进会话时 warning | warning |
| 16 | Assistant Worker 心跳 | 复用 `readWorkerHeartbeat`，仅 `fresh` 通过 | blocker |
| 17 | 迁移 0128/0129 | 提醒表、暂停表、回执字段与回执约束存在；账本可读时校验哈希 | blocker / warning |
| 18 | 数据库业务账号 | `current_user` 非超级用户且无 `rolbypassrls` | blocker |
| 19 | 提醒/周报 RLS | 9 张提醒、周报、回执会话表均存在、启用 RLS、存在租户策略；未 FORCE 时 warning | blocker / warning |
| 20 | 站内消息入口 | 业主 C01、经理工作台或四角色跟进会话至少一个可写；缺角色入口时 warning | blocker / warning |
| 21 | 提醒运行状态 | 已存在 failed 提醒时 warning，并列出 `last_error` | warning |

账号检查不会因为“企业里存在该角色账号”就通过：必须同时具备有效项目成员关系、施工访问权限和未强制改密状态。只满足账号存在但缺少项目权限的账号会进入 `rejectedAccounts`，并给出原因。

## 4. 输出结构

```json
{
  "enterpriseId": "123",
  "enterpriseName": "示例企业",
  "checkedAt": "2026-11-14T02:00:00.000Z",
  "readiness": "ready | limited | blocked",
  "projects": [{ "id": "1", "currentStageKey": "utilities", "plan": {}, "c01": {}, "members": {} }],
  "activeStage": { "expectedStages": [], "configuredStages": [], "perProject": [] },
  "roleAccounts": { "owner": [], "boss": [], "manager": [], "designer": [], "worker": [] },
  "rejectedAccounts": [{ "id": "9", "reason": "no_active_project_membership" }],
  "assistantStatus": {},
  "workerStatus": { "freshness": "fresh", "scope": "global" },
  "reminderStatus": { "byStatus": {}, "byRole": {}, "failedReasons": {} },
  "weeklyReportStatus": { "enabled": true, "audiences": [], "missingBindingAudiences": [] },
  "migrationStatus": { "migrations": [] },
  "rlsStatus": { "account": {}, "tables": [] },
  "inboxStatus": { "channels": {}, "missingChannels": [] },
  "blockers": [],
  "warnings": [],
  "checks": []
}
```

`blockers` 与 `warnings` 中的每一项都包含：

- `checkId` / `check`：检查项。
- `actual`：实际状态。
- `reason`：失败原因。
- `fix`：修复建议。
- `projectId`：项目级问题时的项目 ID。

判定规则：

- `blocked`：存在任一 blocker，必须修复后才能试点。
- `limited`：没有 blocker，但存在已知限制或 warning，可在明确边界下试点。
- `ready`：没有 blocker 和 warning。

## 5. 已知限制

1. **Worker 心跳是全局的**：健康文件只证明本机 Worker 近期成功执行，不区分企业；报告中的 `workerStatus.scope` 固定为 `global`。
2. **健康文件必须是无 BOM 的 JSON**：现有 Worker 写入 `{lastSuccessAt}`，带 BOM 的文件会被视为不可读并给出 blocked。
3. **迁移账本可能不可读**：应用账号在部分安装中无权读取 `app.__drizzle_migrations`。此时以 0128/0129 的实际表、字段、约束作为主证据，账本仅作辅助。
4. **自定义阶段只给 warning**：非小K标准阶段仍可保留施工事实，但阶段 Agent、知识包和周报模板无法按十阶段工作。
5. **C01 依赖 customer_access**：客户项目未开启 `customer_access` 时，业主角色会进入 `rejectedAccounts`，C01 也不会被判定为可用。
6. **周报受众与会话分开检查**：`audiences` 完整但缺少可用 `construction_followup` 会话时只给 warning；报告计划未启用则是 blocker。
7. **本轮不做生产操作**：工具只读，不执行初始化、不部署生产；生产使用仍需数据库快照、非超级用户连接和明确授权。

## 6. 隔离测试

环境：独立 PostgreSQL 17 实例 `127.0.0.1:55432`，数据库 `pilot_readiness_eval`，业务账号 `sfp_app`（非超级用户，FORCE RLS）。

准备：

```powershell
cd admin
$env:PILOT_READINESS_TEST_DATABASE_URL="postgresql://sfp_app:<local-only>@127.0.0.1:55432/pilot_readiness_eval"
npx tsx --test --test-concurrency=1 src/lib/xiaok-v1/__tests__/pilot-readiness.test.ts
```

测试覆盖：

| 场景 | 预期 | 结果 |
| --- | --- | --- |
| A 配置完整的试点企业 | `ready`，无 blocker/warning | passed |
| B 缺少周报计划 | `blocked`，`report.plan` | passed |
| C 缺少项目经理 | `blocked`，`role.manager` + `manager.workbench` | passed |
| D Worker 未运行 | `blocked`，仅 `worker.heartbeat` | passed |
| E 缺少有效施工计划 | `blocked`，仅 `project.schedule` | passed |
| F 权限不完整 | `blocked`，老板/设计师/施工人员无项目权限，账号进入 `rejectedAccounts` | passed |
| 企业隔离 | A/G 报告只含各自项目、账号和报告范围；跨租户 RLS 查询为 0 | passed |
| 无写入副作用 | 检查前后 20 张业务表的行数+内容摘要一致 | passed |
| 重复执行稳定 | 同一 `now` 连续执行报告完全一致 | passed |
| 非超级用户 | `sfp_app` 完成全部允许检查 | passed |
| 不存在/不可见企业 | `blocked` 且明确报告企业不可见，不泄露其他企业数据 | passed |

结果：9/9 passed。同时执行以下回归：

```powershell
npx tsx --test src/lib/xiaok-v1/__tests__/*.test.ts   # 34 passed, 9 skipped（预检测试未配置隔离库时跳过）
npx tsc --noEmit                                      # passed
npx eslint src/lib/xiaok-v1/pilot-readiness.ts src/lib/xiaok-v1/__tests__/pilot-readiness.test.ts scripts/xiaok-pilot-readiness.ts
```

证据：

- `tmp/xiaok-i742-pilot-readiness/test.log`
- `tmp/xiaok-i742-pilot-readiness/result-summary.json`
- `tmp/xiaok-i742-pilot-readiness/cli-ready.json`
- `tmp/xiaok-i742-pilot-readiness/cli-blocked-report-plan.json`
- `tmp/xiaok-i742-pilot-readiness/cli-blocked-worker.json`

## 7. 使用建议

1. 在正式启用前，由平台管理员提供企业 ID，并按第 2 节运行。
2. 先修复所有 blocker，再处理 warning；不要用超级用户或关闭 RLS 的方式“通过”检查。
3. 报告计划启用后，如需四角色周报，确认 `bindingAudiences` 覆盖四类受众。
4. 将输出 JSON 存档到运维证据目录，记录企业 ID、检查时间和 `readiness`。
5. 生产环境仍需先做数据库快照，再执行迁移；本工具不替代迁移和部署流程。
