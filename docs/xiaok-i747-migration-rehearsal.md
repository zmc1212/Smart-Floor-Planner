# 小K I7.4.7 微云 1454 数据库迁移安全预演

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`48197765d1f6`
> 预演时间：`2026-11-14T21:22Z`
> 环境：隔离 PostgreSQL `17.10`，`127.0.0.1:55432`
> 结论：**当前 1454 不能直接执行迁移；真实执行器会在任何 DDL 前拒绝两处历史账本哈希。**
> 本轮未连接生产、未修改 `smart_floor_planner` 开发库、未在开发库执行迁移。

## 1. 预演范围

目标迁移文件：

- `admin/drizzle/0128_xiaok_v1_stage_reminders.sql`
- `admin/drizzle/0129_xiaok_v1_stage_reminder_receipts.sql`
- `admin/drizzle/0130_xiaok_pilot_project_scopes.sql`

同时发现并验证 1454 还有 5 个更早的待应用迁移：

`0120_construction_camera_sd_identity_version`、`0124_assistant_knowledge_integration`、
`0125_native_workflow_runtime_integration`、`0126_native_workflow_delegation_integration`、
`0127_native_workflow_delegation_compatibility`。

因此真实执行器实际会一次性应用 **8 个** pending migration（0120、0124–0130），而不是只有 0128–0130。

## 2. 开发库账本实际状态

只读读取 `smart_floor_planner.app.__drizzle_migrations`：

| 项 | 值 |
| --- | --- |
| 账本行数 | `119` |
| 最后一条 | id `125`，`0119_platform_portfolio_templates` |
| 待应用 | `0120`、`0124`、`0125`、`0126`、`0127`、`0128`、`0129`、`0130`（8 个） |
| 开发库 | `smart_floor_planner`，`sfp_app`，非超级用户 |
| 生产库 | **未连接** |

**关键发现：两条账本记录的哈希无法被当前执行器识别。**

| ledger id | tag | 账本哈希 | 当前文件哈希（LF） |
| --- | --- | --- | --- |
| `28` | `0021_platform_notification_config` | `9df6e11e9638ce3c44a907161391ba873736e3155fe875f6d530247c5ad8ab5c` | `ad51f60fdbdcac9a672770877b64d13284de7de283f363405fad4cf773f29d80` |
| `58` | `0051_staff_referrer_network` | `a41ef104297b2d5f15bc7728c2d4f3805600fdb709235fa95c5e61d11824939e` | `e5afd41b641f5e954e82784cba9435223034381e6ce38645f62eff858f8e7d94` |

当前执行器 `validateLedger()` 只接受当前 journal 或 legacy fork 的已知哈希；这两条不在其中，因此 `npm run db:migrate` 会在应用任何 DDL 前抛出：

`Unrecognized migration at ledger row 28 (timestamp 1786540800000).`

只读核对开发库结构后确认，0021/0051 的目标对象均已存在：

- `app.platform_configs.notification_config`（jsonb）
- `app.enterprise_join_codes.inviter_staff_id`、`enterprise_join_codes_inviter_type_check`
- `enterprise_join_codes_active_enterprise_scope_uidx`、`active_staff_scope_uidx`、`inviter_staff_created_idx`
- `app.referrer_enterprise_memberships.invited_by_staff_id`、`invited_by_name_snapshot`、`referrer_memberships_enterprise_inviter_status_idx`

这说明账本哈希与当前文件不一致，但目标结构已存在；**不能据此直接改账本，必须先完成差异审查和审批。**

## 3. 可丢弃 PG17 预演库

| 项 | 值 |
| --- | --- |
| 实例 | 隔离 PostgreSQL `17.10`，`127.0.0.1:55432` |
| 预演库 | `i747_migration_rehearsal`（可丢弃） |
| 迁移账号 | 隔离实例的 owner 账号，仅用于预演库 |
| 业务账号 | `sfp_app`，非超级用户 |
| 基线 | 按当前迁移文件应用至 `0119`，账本 119 条 |
| 合成数据 | 2 个企业、2 个项目、业主/rooms、1 个会话、1 条消息、1 条报告设置、1 条跟进绑定 |
| 生产库 | 未连接 |

预演步骤：

1. 按当前迁移文件构建 `0119` 基线。
2. 写入迁移前合成兼容数据。
3. 将 1454 实际 119 条账本（含两条未知哈希）复制到预演库，执行真实迁移器。
4. 仅在预演库中模拟两处历史哈希核对后的重基线。
5. 制造 0130 冲突，验证整个迁移事务回滚。
6. 并发执行两个真实迁移器，验证 advisory lock。
7. 验证结构、RLS、权限、约束、数据保留和幂等。
8. 删除预演库。

## 4. 预演结果

### 4.1 原始账本：执行器拒绝

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 1454 原始账本直接迁移 | **blocked** | exit `1`，`Unrecognized migration at ledger row 28` |
| 被拒绝前的 DDL | 无 | 账本仍 `119`；`construction_stage_reminders` 不存在 |

这证明当前 1454 **不能直接上线迁移**；执行器在事务内校验账本，失败时不会留下部分迁移。

### 4.2 重基线后完整执行

在可丢弃预演库中只更新两条历史哈希后，真实执行器成功应用 8 个 pending migration：

- 账本 `119 → 127`
- 0120、0124、0125、0126、0127、0128、0129、0130 全部记录
- 0128/0129/0130 目标表、列、约束、索引、触发器和函数均存在

| 对象 | 结果 |
| --- | --- |
| `construction_stage_reminders` | 存在，RLS `ENABLE+FORCE`，策略 `tenant_scope`，0129 的 `conversation_id`/`message_id` 与回执检查存在 |
| `construction_stage_reminder_pauses` | 存在，RLS `ENABLE+FORCE`，策略 `tenant_scope` |
| `xiaok_pilot_project_scopes` | 存在，RLS `ENABLE+FORCE`，策略 `tenant_scope`，触发器 `xiaok_pilot_projects_available` 与函数 `xiaok_validate_pilot_projects` 存在 |
| `sfp_app` 权限 | 提醒/暂停表 `SELECT,INSERT,UPDATE,DELETE`；范围表仅 `SELECT,INSERT`，`UPDATE/DELETE` 被拒绝 |

### 4.3 失败回滚

在预演库中预先创建冲突的 `xiaok_pilot_project_scopes`，再运行真实迁移器：

- 0120/0124–0129 已执行到 0130 前，0130 因 `relation "xiaok_pilot_project_scopes" already exists` 失败。
- 整个迁移事务回滚：账本仍 `119`，`construction_stage_reminders` 和 `construction_stage_reminder_pauses` 均未保留。
- 迁移前合成数据行数保持不变：项目 `2`、报告设置 `1`、会话 `1`、消息 `1`、绑定 `1`。

结论：**执行器的单事务回滚有效；失败不会留下半套 0128/0129。**

### 4.4 并发与幂等

- 两个真实迁移器同时运行，均 exit `0`。
- advisory lock 串行化成功；最终账本 `127`，`distinct created_at = 127`，无重复。
- 再次运行真实迁移器：exit `0`，账本仍 `127`，无重复 DDL。

### 4.5 RLS 与约束功能验证

以 `sfp_app` 在租户 A 中执行：

| 检查 | 结果 |
| --- | --- |
| 提醒租户隔离 | A 可见 `1`，B 可见 `0` |
| 暂停租户隔离 | B 可见 `0` |
| 试点范围租户隔离 | B 可见 `0` |
| 相同 dedupe key 重复提醒 | 被唯一约束拒绝 |
| 未知项目写入 Pilot Scope | 被触发器拒绝 |
| `sfp_app` 更新 Pilot Scope | 权限拒绝 |
| `delivered` 但无 `message_id` | 被 `construction_stage_reminders_receipt_check` 拒绝 |
| 带合法 `conversation_id`/`message_id` 的 `delivered` | 成功 |

### 4.6 开发库只读

预演前后只读核对 `smart_floor_planner`：

| 项 | 前 | 后 |
| --- | --- | --- |
| 迁移账本 | `119` | `119` |
| 项目数（企业 1454） | `217` | `217` |
| 账号 | `sfp_app` 非超级用户 | 同前 |

预演库已删除（`dropped=true`），原始日志保留在 `tmp/i747/run-01/`。

## 5. 结论与上线前整改

### 5.1 不能直接迁移的原因

1. **账本哈希阻断**：0021/0051 两条历史哈希与当前文件不一致，真实执行器拒绝。
2. **待应用迁移不止 3 个**：1454 还缺 0120、0124–0127；只准备 0128–0130 的迁移窗口不完整。
3. **提醒前置条件未就绪**：迁移 0128/0129 后仍需 Assistant Worker 正常运行；当前 1454 的 Worker 心跳为 stale。

### 5.2 整改顺序

1. **不要对 1454 直接执行 `db:migrate`。**
2. 对 0021/0051 做差异审查：
   - 对比历史迁移文件、当前文件和开发库实际结构；
   - 确认当前结构与当时应用结果等价；
   - 由负责人批准后，选择恢复历史文件或受控更新这两条账本哈希。
   - 不得关闭或放宽 `validateLedger()` 的全局校验，不得用超级用户跳过账本。
   - **状态：已完成，见下节「I7.4.7.1 / I7.4.7.2 整改进展」。**
3. 在修复后的**新可丢弃预演库**重跑本流程，确认 8 个 pending migration 全部成功。
4. 备份 1454 开发库；使用迁移账号执行 `npm run db:migrate`，不要使用业务账号或超级用户代替。
5. 迁移后核对账本 `127`、三张新表 FORCE RLS/策略、`sfp_app` 权限和 0129 回执约束。
6. 启动 Assistant Worker，确认 fresh 心跳后再启用提醒/周报试点。

### 5.3 回滚策略

- 当前迁移器**没有 down migration**；每次运行把全部 pending migration 放在一个事务中，失败自动回滚。
- 成功提交后的生产回滚只能依赖迁移前数据库快照/备份恢复，不能依赖 SQL 反向迁移。
- 迁移前必须做可验证快照；不要在业务高峰或 Worker 正在投递时执行。

### 5.4 I7.4.7.1 / I7.4.7.2 整改进展

**I7.4.7.1（只读审查）** 已完成两条哈希的根因审查：

- 两条都属于 `historical_content_change`（历史 SQL 内容确实不同），不是换行或编码差异；全对象库 21,434 个 blob 与 42 份文件副本中没有任何版本能产生账本哈希。
- `0021` 有结构反证：1454 的 `platform_configs.notification_config` 是**可空、无默认值**，而当前文件会写 `SET DEFAULT '{}'` + `SET NOT NULL`；同写法的 0028/0040 都已生效。
- `0051` 结构等价（13 条语句的目标对象逐条在位），且回填时 `referrer_enterprise_memberships` 为 **0 行**，历史回填差异没有数据后果。
- 详见[I7.4.7.1 迁移哈希根因审查](./xiaok-i747-1-migration-hash-root-cause.md)。

**I7.4.7.2（代码整改）** 负责人已批准方案 D，并批准修改 `validateLedger()`：

| 项 | 内容 |
| --- | --- |
| 白名单文件 | `admin/drizzle/legacy/known-hashes.json`，**仅两条**：id `28`（0021，`9df6e11e…ab8ab5c`）、id `58`（0051，`a41ef104…824939e`） |
| 匹配规则 | timestamp、当前 journal tag、完整 64 位 SHA-256 **三项同时精确匹配**；无通配符、无前缀、无模糊匹配 |
| 查询时机 | 仅在当前 journal 与 native/bailian fork 都不匹配之后 |
| 失败处理 | 白名单缺失/非法/缺审批字段/重复身份/非法 SHA → 事务 `begin` 之前抛错（fail closed） |
| 既有检查 | 重复 timestamp、prefix 连续性、Mixed fork、未知迁移拒绝 —— 全部保持不变 |
| 0021 / 0051 | 仅识别为**已应用**，不重跑 SQL，不修改迁移文件与 journal 时间戳 |

该变更**仅解决迁移器的账本识别问题**，不包含任何 DDL，也未连接数据库。

**当前状态（本轮结束时）**：

- **1454 仍未执行迁移**，账本仍是 119 条；
- 仍有 **8 个待应用迁移**：`0120`、`0124`、`0125`、`0126`、`0127`、`0128`、`0129`、`0130`；
- `notification_config` 的结构差异（1454 可空 vs 当前文件 `NOT NULL DEFAULT '{}'`）**仍然存在**，需要单独评估；
- 本预演库是在白名单生效**之前**、通过手工模拟重基线完成的，因此需要在新的可丢弃 PG17 库上重跑一次，验证白名单路径下的真实行为。

## 6. 回归与证据

| 项 | 结果 |
| --- | --- |
| 预演脚本检查 | 16 项 `passed`、0 `failed` |
| 真实迁移器（原始 1454 账本） | exit 1，`Unrecognized migration at ledger row 28` |
| 真实迁移器（重基线后） | exit 0，8 个 pending 全部应用 |
| 0130 冲突回滚 | exit 1，账本 119，0128/0129 未保留 |
| 并发迁移器 | 两个进程均 exit 0，账本 127，无重复 |
| 幂等复跑 | exit 0，账本 127 |
| TypeScript `npx tsc --noEmit` | 通过 |
| 迁移器语法检查 `node --check` | 通过 |
| 定向 ESLint | 通过 |
| 定向预检回归 | `pilot-readiness.test.ts`：19 passed / 0 failed / 1 skipped（迁移故障模拟需要未提供的迁移账号） |

原始证据：

- `tmp/i747/run-01/result.json`
- `tmp/i747/run-01/migrate-exact-ledger.log`
- `tmp/i747/run-01/migrate-conflict-0130.log`
- `tmp/i747/run-01/migrate-concurrent-1.log`、`migrate-concurrent-2.log`
- `tmp/i747/run-01/migrate-idempotent.log`
- `tmp/i747/ledger-map.json`

## 7. 限制

- 预演库基线由当前迁移文件构建到 `0119`，不是 1454 的完整数据克隆；业务数据兼容性用合成行验证，不代表真实 1454 全部数据。
- 原始账本失败测试使用当前代码基线 + 1454 实际 119 条账本；失败发生在任何 DDL 前，因此能真实反映执行器行为。
- 重基线只在可丢弃预演库中模拟，**未修改 1454 账本**。
- 未连接生产、未部署、未发送通知。
- 预演库已删除；完整证据见 `tmp/i747/run-01/result.json` 和同名迁移日志。
