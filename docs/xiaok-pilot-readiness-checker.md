# 小K 1.0 试点只读预检

检查器在指定企业的租户事务中读取一个试点版本、项目事实及企业安全状态，结果写到 stdout。现有权限判断会取得共享锁，整次检查使用一致读快照。工具不创建试点、提醒、消息、报告或 Outbox 事件。

## 命令

```powershell
cd admin
npm run check:pilot-readiness -- --enterprise-id 123 --pilot-id first-pilot
npm run check:pilot-readiness -- --enterprise-id 123 --project-ids 101,205
npm run check:pilot-readiness -- --enterprise-id 123 --enterprise-audit
```

- `DATABASE_URL` 使用非超级用户业务账号，如 `sfp_app`。必须提供单一企业 ID。省略范围时先执行企业检查，并返回缺少显式范围的 blocker。
- `ASSISTANT_WORKER_HEALTH_FILE` 指向原 Worker 健康文件，未设置则读系统临时目录下的 `assistant-worker-health.json`。新鲜心跳证明全局 Worker 近期成功执行，企业投递仍按项目和收件范围判定。
- 三种范围参数互斥。试点验收使用 `--pilot-id`。仅传 ID 列表属于试算，`pilot.scope` 至少为 warning。`--enterprise-audit` 用于全企业盘点。
- 退出码 `0` 表示 `ready` 或 `limited`，`2` 表示 `blocked`，`1` 表示输入或执行错误。调用方应读取 JSON 的 `readiness`。

## 报告

| 字段 | 计入条件 |
| --- | --- |
| `enterpriseChecks` | 企业状态、Assistant 启用与配额、十阶段配置、老板权限、企业报告计划与受众、Worker 心跳、迁移、业务账号、强制 RLS。即使项目范围为空也执行。 |
| `pilotScope` | 选择模式、试点配置、传入 ID 与当前企业内不可用 ID。其他企业 ID 和未知 ID 使用同一结果，项目明细留空。 |
| `pilotProjectChecks`、`projects` | 已选项目的阶段、发布计划、角色账号和工作台、业主 C01、周报覆盖及会话、提醒运行状态与投递风险。 |
| `projectGaps` | 缺少或无效阶段、缺少有效计划、有效角色不齐、C01 不可用的项目。施工计划对 active 且未完工项目为必需。 |
| `outsideScope.activeProjects` | 范围外 active 项目的 ID、名称、当前阶段和线索归档状态。 |
| `outsideScope.reminders` | 现有阶段规则候选 ID、每项目的 `pending`、`failed`、`paused` 计数。 |
| `outsideScope.weeklyReports` | 现有报告计划候选 ID、按已生成事实快照统计的 `pending` / `held` 投递计数。 |
| `checks`、`blockers`、`warnings` | 完整检查与问题清单。项目问题带 `projectId`。`blocked` 表示有 blocker，`limited` 表示只有 warning，`ready` 表示两者都没有。 |

部分项目缺失 C01 延续 warning。没有任何可用 C01 时阻断。客户是平台级账号，业主识别使用当前企业的线索绑定和 `customer_access`，C01 仍核查本企业会话、当前业主参与人及会话上下文。自定义阶段若存在于企业配置中会给出 warning。项目经理、设计师和施工人员必须有对应项目的有效成员关系和施工权限。

迁移 0128–0130 以实际结构为必需条件。账本可读时还需要匹配迁移文件哈希。账本不可读时报告 `ledgerReadable: false`。提醒、周报、会话及试点配置的目标表需要 ENABLE/FORCE RLS 和租户策略。缺表时，受影响的查询标为不可用，剩余安全检查继续执行。

范围外候选是规则覆盖信息。已存在待发或挂起的周报按保存的事实快照统计，适用项目的收件资格、周期和最终送达还由既有 Worker 裁定。相关数据无法读取时相应聚合字段为 `null`。保存的范围本身没有投递动作。详见[试点范围合同](xiaok-pilot-project-scope.md)。

## 验证

```powershell
cd admin
$env:PILOT_READINESS_TEST_DATABASE_URL="postgresql://sfp_app:<local-only>@127.0.0.1:55448/pilot_readiness_eval"
$env:PILOT_READINESS_TEST_MIGRATION_URL="postgresql://sfp_migrator:<local-only>@127.0.0.1:55448/pilot_readiness_eval"
npx tsx --test --test-concurrency=1 src/lib/xiaok-v1/__tests__/*.test.ts
```

迁移连接仅供隔离测试临时模拟表缺失和 FORCE RLS 缺失。`I7.4.2` 的初次验收记录见 `8b406246` 和 `tmp/xiaok-i742-pilot-readiness/`。当前验收范围和实际结果见[首家试点记录](xiaok-first-pilot-enterprise-readiness.md)。
