# I7.4.9.4 119→128 完整迁移链路及备份恢复联合验收

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`64f2c73a2be2`
> 日期：`2026-11-15`（Asia/Shanghai）
> 状态：`isolated_full_chain_passed = true`、`real_database_not_modified = true`、`real_migration_run = false`

## 1. 环境

- 全新可丢弃 PostgreSQL `17.10`，`127.0.0.1:55436`（非 `5432`/`55432`）。
- 集群 `postgres` 库注释 `xiaok-i749-isolated-test`；源库注释 `xiaok-i749-backup-sandbox`。
- 角色：`sfp_migrator`（`rolsuper=false`、`rolbypassrls=false`）、`sfp_app`（`rolsuper=false`、`rolbypassrls=false`、`rolcanlogin=true`）、`sfp_owner`（`BYPASSRLS`，仅备份用）、`sfp_auditor`。
- 迁移与业务数据全部为合成数据；未连接 `smart_floor_planner`。

## 2. 迁移前 119 条账本

使用正式迁移文件构建截至 `0119` 的结构，并复现此前 1454 合成账本形状：

- 账本条数：**119**；
- id：**7–125**；
- 账本摘要：`cafb8096cb620971bd311b754216c65410822991a322b426286b5c9228cf1d80`；
- 0021：id `28`、timestamp `1786540800000`、历史 SHA `9df6e11e9638ce3c44a907161391ba873736e3155fe875f6d530247c5ad8ab5c`；
- 0051：id `58`、timestamp `1788184800000`、历史 SHA `a41ef104297b2d5f15bc7728c2d4f3805600fdb709235fa95c5e61d11824939e`；
- 0060 使用仓库自带 stock PostgreSQL 变体；
- 无重复 timestamp、无 prefix gap、无 Mixed XiaoK fork；
- `validateLedger()` 通过；
- pending 恰好 9 条：`0120`、`0124`–`0131`。

迁移前 `platform_configs` 模拟 1454 漂移：可空、无默认值、9 行（1 行 synthetic default + 8 行 NULL 标记）。

## 3. 9 项正式迁移

执行：`node scripts/postgres-migrate.mjs`（`DATABASE_MIGRATION_URL` 指向隔离源库的 `sfp_migrator`）。未使用测试 SQL 替代正式迁移器。

| 迁移 | 正式 SQL SHA-256 |
| --- | --- |
| `0120_construction_camera_sd_identity_version` | `4bf4f4f9a0ce596a9377a04091dc7ca520ff910500c6e163bd75110292e005f2` |
| `0124_assistant_knowledge_integration` | `e17d50b8b85aa77277dce9a5d9043ea3d51a641e2647c3bb2046dc86d6e77788` |
| `0125_native_workflow_runtime_integration` | `6cc59fb40d57dc5a7829bbae9a9bc6e179017855044682a9955642768e7b84f7` |
| `0126_native_workflow_delegation_integration` | `08cdb5a0a16f965a4857af2e938f42ccff74c3aa854e312713d423fc2c37989c` |
| `0127_native_workflow_delegation_compatibility` | `83350941abebc88e19dd63eaccafa1e6d1a5008a7e04c68770f5e28ccd5ae09c` |
| `0128_xiaok_v1_stage_reminders` | `2176a1199a2212b5b620e270ff8249d3aedc889dc3760d9e81cab9674862b49c` |
| `0129_xiaok_v1_stage_reminder_receipts` | `966e93d18077b77773a5fb215ba3863f7fbbadddc51807176d09e44aa6263618` |
| `0130_xiaok_pilot_project_scopes` | `49ede82f820ccd9c66b3911419c8784f1e43c6396c21ea7f40ea36b9a21501ee` |
| `0131_platform_notification_config_not_null` | `a7fd555fa43a149ddffc74067e6263cbf91446cf67d581706491756a86386291` |

迁移后：

- 账本 **119 → 128**；
- id：**7–134**；
- 账本摘要：`f586ce3439f6ebc0aa478b916d87c3f256c0c466665c1a6761c4adef3a2cafed`；
- 前 119 条逐条完全不变；
- 0021/0051 历史 SHA 不变；
- 新增 9 条 SHA 全部与正式 SQL 一致；
- pending 为空；
- 128 个 timestamp 全部唯一。

## 4. 结构与业务验收

结构检查覆盖 38 个新增/相关关系、6 个关键函数、5 个关键触发器、6 张 FORCE RLS 核心表、222 条 Policy：

- **0120**：`construction_camera_sd_windows.identity_version smallint NOT NULL DEFAULT 0`；`construction_camera_sd_identity_version_check` 存在。
- **0124**：知识文档/资产/版本/分块/尝试表及 managed knowledge 关系存在；关键函数与 scope 触发器存在；`assistant_knowledge_documents` FORCE RLS。
- **0125**：Native Workflow 运行时、调度、批次、控制、账本、durable task 及索引存在。
- **0126**：Delegation 父子表、长期记忆表、相关函数/触发器/RLS 存在。
- **0127**：`native_delegation_electrical_origin` 唯一索引存在。
- **0128/0129**：提醒/暂停表、去重唯一约束、conversation/message 复合 FK、`construction_stage_reminders_receipt_check`、FORCE RLS 与索引存在。
- **0130**：Pilot Scope 主键与 4 个以上 CHECK、`xiaok_validate_pilot_projects`、`xiaok_pilot_projects_available`、FORCE RLS 与租户策略存在。
- **0131**：`notification_config` NULL 行 **0**、`is_nullable=NO`、`column_default='{}'::jsonb`；原 synthetic default 配置文本 SHA-256 `1d4550fc508e15fd1a46da89287513b77324302554861205956037db9fdf248c` 前后一致，8 个模板 ID 全部保留；8 个原 NULL 标记行全部变为 `{}`。

业务/RLS（`sfp_app`，`rolbypassrls=false`）：

- 1454 与 1455 各 1 条提醒，跨企业读取互不可见；
- 以 1455 身份插入 1454 项目被拒绝（`42501`）；
- 非法 Pilot 项目被 0130 触发器拒绝；
- `sfp_app` 更新/删除 Pilot Scope 被拒绝（`42501`）；
- 相同 dedupe key 重复提醒被拒绝（`23505`）；
- `delivered` 缺少 `message_id` 被拒绝（`23514`）。

## 5. 备份

调用 `node scripts/xiaok-migration-backup.mjs`（等价 `npm run db:migration-backup`）：

- backupId：`xiaok-mig-20261115t103306894z-780f8616`
- custom archive：`database.dump`
- archive SHA-256：`afb216d2f5d54a740190ecdba486efc86b2f64a83b923e1aca29886ec20e6ae4`
- Manifest SHA-256：`c0e9b88f16693b05e9770877488ec0bd33dacaf9a1ecc4b6b2b3aad9c129576a`
- Manifest 账本：128 条，digest `f586ce34…a2cafed`
- `latestMigration`：`0131_platform_notification_config_not_null`，ledger id `134`，SHA `a7fd555f…386291`
- 0021/0051 历史 SHA 精确记录且 `matchesAllowlist=true`
- 167 张 FORCE RLS 表、222 条 Policy
- 权限摘要：`82886b7a8cf7cf594a9f76fc73cf10e2703090719aa28f43395db1079f7ca833`
- 187 张数据表摘要；`platform_configs` 9 行
- `pg_restore --list` 验证通过

## 6. 独立恢复

目标：`xiaok_migration_restore_i794`（与源库不同；验证时 `--keep-target`，查询后删除）。

结果：

| 检查 | 结果 |
| --- | --- |
| archive SHA | 一致 |
| Manifest digest | 一致 |
| `schema_restore_passed` | true |
| `data_restore_passed` | true |
| `ledger_verified` | true |
| `rls_verified` | true |
| `permissions_verified` | true |
| `full_restore_passed` | **true** |
| 128 条账本 | 一致 |
| 0021/0051 历史 SHA | 不变 |
| 0131 | 存在，SHA `a7fd555f…386291` |
| 原 default 通知配置 | 文本与模板完全一致 |
| FORCE RLS / Policy | 167 / 222，一致 |
| 角色与关键函数/触发器 | 完整，权限摘要一致 |

恢复不是仅凭 `pg_restore` 退出码判定；以上各项均为 true 才标记 `full_restore_passed`。

## 7. 故障场景

| 场景 | 结果 |
| --- | --- |
| 0131 锁超时回滚 | 9 条迁移整批回滚；账本仍 119，`construction_stage_reminders` 不存在 |
| 未知历史 SHA | `Unrecognized migration` 拒绝；账本 119 |
| 备份 SHA 篡改 | 拒绝（`sha256_manifest_mismatch`） |
| Manifest 篡改 | 拒绝（`manifest_digest_mismatch`） |
| 目标等于源库 | 拒绝（`target_same_as_source`） |
| 恢复中途失败 | 归档损坏导致恢复失败；原已验证备份文件 SHA 不变 |
| 重复迁移 | exit 0，账本 128 不变，无重复副作用 |
| 并发迁移 | advisory lock 串行化；两个进程均 exit 0，账本 128，无重复 timestamp |

## 8. 回归与跳过

| 项 | 结果 |
| --- | --- |
| `xiaok-notification-config-alignment.test.ts` | 6 passed / 0 skipped |
| `xiaok-migration-backup.test.mjs` + `xiaok-migration-restore-verify.test.mjs` | 20 passed / 0 skipped |
| `xiaok-migration-preflight.test.ts` | 9 passed |
| `subscription-notification.test.ts` + `wechat-notification-wiring.test.ts` | 18 passed |
| `xiaok-integration-migrations.test.mjs` | 18 passed / 7 skipped |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint | 0 errors / 0 warnings |

测试合计 **71 passed / 7 skipped**。跳过的 7 项是 `xiaok-integration-migrations.test.mjs` 的数据库用例（标准离线运行按设计跳过）；本机便携 PG17 没有 `vector` 扩展，live 运行无法 provisioning，这不是 0131 或本轮迁移失败。联合验收本身使用 stock PostgreSQL `0060` 变体，完整链路 0 跳过。

## 9. 真实 1454 状态

**微云 1454 真实开发库未执行本轮任何迁移、备份或恢复。**

- 未连接 `smart_floor_planner` 执行 `pg_dump` 或 DDL；
- 未执行真实 `db:migrate`；
- 未修改真实账本、通知配置、模板或企业配置；
- 未启动真实 Worker，未发送微信通知，未部署生产；
- 真实库仍为 119 条账本、8 行 `notification_config IS NULL`；
- 加入 0131 后正式待迁移为 9 条：`0120`、`0124`–`0130`、`0131`。

## 10. 证据

- 原始验收 JSON：`C:\i794\evidence\acceptance.json`（外部证据，未提交）
- 备份目录：`C:\i794\backups\xiaok-mig-20261115t103306894z-780f8616`
- 隔离集群：`127.0.0.1:55436`，验收后已停止

## 11. 下一轮建议

1. 先完成真实 1454 的迁移前备份与独立恢复验证（I7.4.9.1 工具）。
2. 维护窗口确认写入静默，按两阶段执行：先 `0120`–`0130`，再 `0131`。
3. 迁移前后保存非空 `notification_config` 键/摘要并逐条比对。
4. 迁移后核对 128 条账本、0021/0051 SHA、0131 回填、NOT NULL/default、default 配置与模板 ID。
5. 在具备 pgvector 的隔离环境复跑 `xiaok-integration-migrations.test.mjs` 的 7 个数据库用例。
