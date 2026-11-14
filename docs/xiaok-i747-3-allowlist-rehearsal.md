# 小K I7.4.7.3 精确历史哈希白名单 PG17 真实迁移预演

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`30260fd66afa8c48a24101874c67e2442dee1390`
> 预演时间：`2026-11-15`
> 结论：**白名单路径下，正式迁移器成功把 1454 的 119 条历史账本推进到 127 条，8 个 pending migration 全部应用；0021/0051 未被重新执行，两条历史哈希保持不变。**
> 本轮只操作隔离可丢弃数据库，未连接 `smart_floor_planner`，未连接生产，未修改任何迁移文件。

## 1. 环境与安全校验

### 1.1 实例来源（与计划的偏差，如实记录）

计划复用 I7.4.7 的隔离实例 `127.0.0.1:55432`（SSH 隧道 → `192.168.10.54:15433`）。实际执行时该实例要求 SCRAM 密码认证，而本机与仓库均无该实例的账号口令（负责人亦无法提供），因此改用**本机全新的可丢弃 PostgreSQL 17.10 便携实例**：

| 项 | 值 |
| --- | --- |
| 版本 | PostgreSQL `17.10`（`server_version_num = 170010`），与 I7.4.7 记录一致 |
| 地址 | `127.0.0.1:55433`（仅回环，非 5432 / 非 55432） |
| 二进制 | 临时目录内的便携发行版，复制到纯 ASCII 路径后运行（中文路径会导致 `postgres` 启动时 UTF-8 解码失败） |
| 数据目录 | `C:\i7473\data`，预演后停止实例 |
| 迁移账号 | `sfp_migrator`（`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`） |
| 业务账号 | `sfp_app`（同上） |
| 主预演库 | `i7473_allowlist_rehearsal` |

**未连接** `smart_floor_planner`、未连接生产、未使用超级用户执行业务验证。

### 1.2 执行前安全断言（脚本内硬校验）

| 断言 | 结果 |
| --- | --- |
| 目标主机必须是 `127.0.0.1` | 通过 |
| 端口不得为 5432 / 55432（共享库与隧道） | 通过 |
| 版本必须为 17 | 通过 |
| 集群内不存在 `smart_floor_planner` | 通过（见 `environment.databases`） |
| 库名必须以 `i7473_` 前缀且不等于禁用名 | 通过 |
| 白名单文件必须存在 | 通过 |

## 2. 基线构建与账本复制

### 2.1 0119 基线

按当前迁移文件逐条应用到 `0119_platform_portfolio_templates`（journal `idx 0..118`），以 `sfp_migrator` 执行，与 1454 的实际应用方式一致。

**唯一偏离**：本机便携实例不含 `pgvector`（`vector.control` 不存在），而 `0060_assistant_knowledge.sql` 会 `CREATE EXTENSION vector` 并把 `embedding` 设为 `vector(1024)`。因此基线构建时对 `0060` 使用仓库自带的 stock-PostgreSQL 变体 `legacy/bailian/0060_assistant_knowledge.sql`（其扩展创建已被 `pg_available_extensions` 守护）。差异仅为：

- `app.assistant_knowledge_chunks.embedding` 为 `text`（而非 `vector(1024)`）、可空；
- 后续 `0124` 对该列只做 `DROP NOT NULL`，与类型无关，因此不影响本轮结论。

`btree_gist` 由超级用户在每库预建，`0024` 的 `CREATE EXTENSION IF NOT EXISTS` 因此为幂等空操作。

### 2.2 1454 账本形状

最终账本为 **119 条**，`id` 连续 `7..125`，`created_at` 取自 journal `when`。该形状由三个已观测锚点唯一确定：

| 锚点 | 值 | 推导 |
| --- | --- | --- |
| `0021` | id `28`（journal idx 21） | 21 + 1 + 6 = 28 |
| `0051` | id `58`（journal idx 51） | 51 + 1 + 6 = 58 |
| `0119` | id `125`（journal idx 118） | 118 + 1 + 6 = 125 |

即 0021 之前有 6 个由失败尝试消耗的序列值（`nextval` 不随事务回滚），0021 之后无空洞。

两条历史记录**按原值直接插入，未执行任何 UPDATE**：

| id | when | hash |
| --- | --- | --- |
| `28` | `1786540800000` | `9df6e11e9638ce3c44a907161391ba873736e3155fe875f6d530247c5ad8ab5c` |
| `58` | `1788184800000` | `a41ef104297b2d5f15bc7728c2d4f3805600fdb709235fa95c5e61d11824939e` |

其余 117 条使用当前文件哈希（与 1454 一致，I7.4.7 已证明只有这 2 条不匹配）。

## 3. 正式迁移器结果

命令：`npm run db:migrate`（`node scripts/postgres-migrate.mjs`），`DATABASE_MIGRATION_URL` 指向 `i7473_allowlist_rehearsal`，账号 `sfp_migrator`。

```text
> admin@0.1.0 db:migrate
> node scripts/postgres-migrate.mjs

{"success":true,"migrationsFolder":"drizzle"}
```

| 项 | 结果 |
| --- | --- |
| exit code | `0` |
| 0021 识别 | 已应用（白名单精确匹配 id 28 的 timestamp + tag + hash） |
| 0051 识别 | 已应用（白名单精确匹配 id 58） |
| 历史 SQL 重跑 | **未发生**（见 §4.1） |
| 账本最终条数 | `119 → 127` |

新增 8 条，顺序与 journal 完全一致：

`0120_construction_camera_sd_identity_version`、`0124_assistant_knowledge_integration`、`0125_native_workflow_runtime_integration`、`0126_native_workflow_delegation_integration`、`0127_native_workflow_delegation_compatibility`、`0128_xiaok_v1_stage_reminders`、`0129_xiaok_v1_stage_reminder_receipts`、`0130_xiaok_pilot_project_scopes`。

### 4.1 历史账本验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 0021 原始 SHA 不变 | 通过 | `id=28` 仍为 `9df6e11e…ab8ab5c` |
| 0051 原始 SHA 不变 | 通过 | `id=58` 仍为 `a41ef104…824939e` |
| 原有 119 条未被修改 | 通过 | 逐条 `id + hash` 比对，`untouched=true` |
| 新增 8 条 | 通过 | `added=8` |
| 最终 127 条 | 通过 | `total=127` |
| 无重复 timestamp | 通过 | `distinct=127`，`duplicateTimestamps=0` |
| 新记录哈希正确 | 通过 | 8 条在本机检出下均为文件的 CRLF 变体哈希，属于 `hashes()` 接受的三种形式 |

**未重跑的直接证据**：

- 0051 含非幂等语句（`ADD CONSTRAINT`、`CREATE POLICY` 无 `IF NOT EXISTS`），若重跑必然报 `duplicate_object`；实际 exit `0`。
- `app.enterprise_join_codes` 上 `enterprise_join_codes_inviter_type_check` 计数为 `1`，`active_enterprise_scope_uidx`、`active_staff_scope_uidx`、`inviter_staff_created_idx`、`referrer_memberships_enterprise_inviter_status_idx` 各存在一份。
- `referrer_enterprise_memberships` 仍为 `0` 行，没有回填副作用。

### 4.2 0128 / 0129

| 对象 | 结果 |
| --- | --- |
| `app.construction_stage_reminders` | 存在，RLS `true`，FORCE `true`，`tenant_scope` 策略 1 条 |
| `app.construction_stage_reminder_pauses` | 存在，RLS `true`，FORCE `true`，`tenant_scope` 策略 1 条 |
| `conversation_id` / `message_id` | 均存在 |
| `construction_stage_reminders_conversation_fk` / `_message_fk` | 存在 |
| `construction_stage_reminders_receipt_check` | 存在 |
| `construction_stage_reminders_inbox` / `_project` | 存在 |
| `sfp_app` 权限 | 两张表均 `SELECT/INSERT/UPDATE/DELETE` |

### 4.3 0130

| 对象 | 结果 |
| --- | --- |
| `app.xiaok_pilot_project_scopes` | 存在，`PRIMARY KEY (enterprise_id, pilot_id, scope_version)` |
| 检查约束 | `pilot_id` 格式、`cardinality(project_ids)>0`、`created_by>0`、`scope_version>0`、`status IN ('active','inactive')` 全部存在 |
| `xiaok_validate_pilot_projects` | 存在（1 个） |
| 触发器 `xiaok_pilot_projects_available` | 存在（1 个，非内部触发器） |
| RLS | `ENABLE` + `FORCE` |
| 策略 | `tenant_scope` |
| `sfp_app` 权限 | `SELECT=true`、`INSERT=true`、`UPDATE=false`、`DELETE=false` |

### 4.4 业务账号（`sfp_app`）验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 合法租户读取 | 通过 | 企业 1454 可见自己的提醒 |
| 跨企业读取隔离 | 通过 | 切换到 1455 后 `visibleTo1455=0` |
| 跨企业项目写入拒绝 | 通过 | `42501`（RLS `WITH CHECK`） |
| 合法 Pilot Scope 创建 | 通过 | 插入成功，`rows=1` |
| 不可用项目写入 | 通过 | `23514` + `constraint=xiaok_pilot_projects_available` |
| Pilot Scope 不可改写 | 通过 | `UPDATE` 与 `DELETE` 均 `42501` |
| 正常提醒插入（含回执） | 通过 | 插入成功，补齐 `conversation_id/message_id` 后置 `delivered` 成功 |
| 相同 dedupe key 重复写入 | 通过 | `23505` |
| `delivered` 缺少 `message_id` | 通过 | `23514` + `constraint=construction_stage_reminders_receipt_check` |
| 过期版本返回 409 | **limited** | `409` 是应用层映射，见 [pilot-project-scope.ts:70](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/lib/xiaok-v1/pilot-project-scope.ts#L70) 的 `fail('version_conflict', 409)`；SQL 层无法产生该状态码，本轮未走 HTTP，**不谎称已验证** |

## 5. 历史结构差异（0021）

预演库由当前 0021 文件构建，因此：

| 环境 | `platform_configs.notification_config` |
| --- | --- |
| `i7473_allowlist_rehearsal` | `is_nullable=NO`，`default='{}'::jsonb` |
| 微云 1454 | `is_nullable=YES`，无默认值 |

**预演库结构与 1454 在该列上并不一致**，不能声称"完全复现"。

本轮不修改 0021、不新增修复迁移。已确认 `0120`、`0124`–`0130` **不依赖**该列的 `NOT NULL` 约束：

- 全库检索迁移目录，`notification_config` 只在 `0021` 与 `meta/0024_snapshot.json` 中出现；
- 8 个 pending migration 的执行与校验全部通过，未出现与该列相关的错误。

该差异留待单独评估（对齐 1454 或对齐文件），不在本轮处理。

## 6. 失败、回滚与幂等（A–G）

每个场景使用独立数据库或独立沙箱目录，互不影响。

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| A. 原始 119 条账本经白名单识别 | 通过 | 主预演 exit `0`，账本 `127` |
| B. 0021 SHA 改一位 | 通过 | exit `1`，`Unrecognized migration`，账本保持 `119` |
| C. 0051 SHA 改一位 | 通过 | exit `1`，`Unrecognized migration`，账本保持 `119` |
| D. 白名单文件缺失 | 通过 | 沙箱副本删除白名单后 exit `1`，报错含 `known-hash allowlist`，账本保持 `119` |
| E. 0130 对象冲突 | 通过 | 预建同名表后 exit `1`，`relation "xiaok_pilot_project_scopes" already exists`；账本回滚至 `119`，`construction_stage_reminders` 不存在 |
| F. 两个迁移器并发 | 通过 | 两个进程均 exit `0`，账本 `127`，`distinct timestamp=127`（advisory lock 生效） |
| G. 成功后复跑 | 通过 | exit `0`，账本前后均为 `127`，无变化 |

场景 D 的实现方式：把 `admin/scripts` 与 `admin/drizzle` 复制到 `admin/tmp/i747-3-sandbox`，仅删除沙箱内的 `legacy/known-hashes.json`，再以 `node scripts/postgres-migrate.mjs` 运行；仓库内真实白名单未被改动，沙箱用完即删。

## 7. 限制与未验证项

- **实例不是 I7.4.7 的原隔离实例**：因缺少口令改为本机全新 17.10 便携实例（§1.1）。两者版本一致，但不是同一台机器。
- **缺少 pgvector**：基线对 `0060` 使用仓库自带的 stock-PostgreSQL 变体，`assistant_knowledge_chunks.embedding` 为 `text`（§2.1）。
- **1454 账本的 119 条为重建而非直连复制**：形状由三个锚点唯一确定（§2.2），两条历史哈希按原值插入；本轮禁止连接开发库，无法逐条导出比对。
- **`business.stale_version_409` 为 limited**：属应用层 HTTP 语义，SQL 无法覆盖。
- **未验证 1454 真实数据下的表现**：预演库使用合成企业 1454/1455 与合成项目，不代表真实数据分布。
- **未执行 1454 迁移**：本轮不备份、不窗口、不停 Worker、不部署生产。

## 8. 回归与证据

| 项 | 结果 |
| --- | --- |
| 迁移器定向测试 `node --test scripts/__tests__/xiaok-integration-migrations.test.mjs` | 18 passed / 0 failed / 7 skipped（数据库用例未提供隔离环境，按设计跳过） |
| `node --check scripts/postgres-integration-migrations.mjs` | 通过 |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint（迁移器 + 测试） | 通过 |

原始证据（未提交，位于 `tmp/i747-3/`）：

- `run-01/result.json`：全部 23 项检查（22 passed / 0 failed / 1 limited）
- `run-01/migrate-allowlist.log`：主迁移器输出
- `run-01/scenario-b.log`、`scenario-c.log`、`scenario-d.log`、`scenario-e.log`、`scenario-f-1.log`、`scenario-f-2.log`、`scenario-g.log`
- `run-01/structure.json`：预演库结构事实（含 `notification_config` 可空性、0021/0051 对象与账本）
- `pg/rehearse.mjs`：可复跑的预演执行器（含安全断言与全部场景）

本轮未修改任何迁移文件、journal、`validateLedger`、白名单或生产配置；未合并 `main`。
