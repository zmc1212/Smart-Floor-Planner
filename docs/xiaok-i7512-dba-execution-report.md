# 家客来 I7.5.12.2 DBA 执行报告

2026-11-16（Asia/Shanghai）。负责人批准的四项环境操作及只读核验均为 `passed`。
真实备份、创建恢复数据库、真实恢复和正式迁移均为 `not_run`。

## 授权执行结果

| 操作 | 状态 | 实测结果 |
| --- | --- | --- |
| 源库 `sfp_backup` | `passed` | 核实目标为 PostgreSQL 17.10 开发库 `smart_floor_planner`，确认角色缺席后，由 DBA 在事务中执行正式脚本，退出码 `0`。经原 SSH 转发在 `127.0.0.1:5432` 以新角色完成只读登录，`app` 的 174/174 张表与 146/146 个序列可 SELECT。 |
| `C:\i798` ACL | `passed` | 备份并收紧原 ACL 后复核 1,010 个既有条目，宽泛主体的允许项为 0。根目录保护继承，仅向 SYSTEM、Administrators 及实例操作者授予必要权限。ACL 应用和校验退出码 `0`。 |
| 启动 i798 | `passed` | 使用原 `C:\i798\data` 与登记配置启动，`pg_ctl` 退出码 `0`。检查实际监听进程，只绑定 `127.0.0.1:55437`。pgvector 运行文件装在 i798 专用的 PG17.10 目录。 |
| 独立 `sfp_restore` 与扩展 | `passed` | 复用既有角色并设置独立凭据。在既有 `template1` 实测 `vector 0.8.2` 的 L2 距离运算，返回 `1`、退出码 `0`。`btree_gist 1.7` 和 `plpgsql 1.0` 已读回。 |

[正式备份角色脚本](../admin/scripts/sql/xiaok-create-backup-role.sql) ·
[独立恢复角色规范](./xiaok-i798-restore-maintenance-role.md)

## 权限与隔离

- **源库。** `sfp_backup` 为 `LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`，有库 CONNECT、`app` schema USAGE 及 `sfp_migrator` 新建表和序列的默认 SELECT。业务表和列的写权限、序列 USAGE/UPDATE、库或 `app` schema CREATE、对象所有权以及角色成员关系均未检出。实查 119 条迁移账本及 153 张强制 RLS 表。以 `sfp_app` 执行正式的 19 项备份角色检查全部通过，含应用角色的 RLS 限制。
- **独立集群。** `sfp_restore` 实际登录 `postgres`，读回 PostgreSQL 17.10、系统标识 `7708385522403597728`、标记 `xiaok-i749-isolated-test`。源库系统标识为 `7696770731622109222`。i798 当前只有 `postgres`、`template0`、`template1`，`smart_floor_planner` 和 `xiaok_migration_restore_i75121` 均不存在。正式恢复目标只读检查通过。
- **恢复权限。** `sfp_restore` 为 `LOGIN NOSUPERUSER BYPASSRLS CREATEDB NOCREATEROLE NOREPLICATION`。撤销其原有的 i798 `sfp_owner` 成员关系后，保留 `sfp_migrator` 的 INHERIT 和 SET 权限，无法切换为超级用户。`vector` 与 `btree_gist` 在 `template1` 中归 `sfp_migrator`，`sfp_restore` 有相应 Owner 权限。安装 `vector` 所用的临时 NOLOGIN 安装角色已在事务内移除。
- **凭据与应用隔离。** 两套维护凭据分别以 Windows DPAPI CurrentUser 加密保存在仓库外的 `C:\sfp-backups\i7512-maintenance-credentials`，已用同一 Windows 账户解密读回，并通过实际登录确认。仅向对应维护子进程注入 `XIAOK_MIGRATION_BACKUP_URL` 或 `XIAOK_MIGRATION_RESTORE_URL`。本机 `DATABASE_URL`、`DATABASE_MIGRATION_URL` 和所查 Compose Worker 配置均未检出维护账号。

## 归档、恢复与统一门禁

| 项目 | 本轮状态 | 依据 |
| --- | --- | --- |
| 备份目录 | `passed`（沿用前次检查） | `C:\sfp-backups\i7512-20261116` 已通过受限 ACL 和 10 GiB 空间阈值检查。 |
| 真实备份 | `not_run` | 待批准导出开发库。归档、SHA-256、数据摘要及真实 Manifest 待生成。 |
| 创建目标库及真实恢复 | `not_run` | 目标库创建和使用真实归档恢复仍需分别批准。i798 模板为 UTF8 / `C`，源库为 UTF8 / `en_US.utf8`。扩展已实测，真实归档与排序规则的兼容性需在后续演练核验。 |
| 完整恢复验收 | `not_run` | `full_restore_passed` 待取得。恢复后的 schema、全量数据摘要、账本、RLS、权限及临时目标清理均待验证。 |
| 本轮统一门禁 | `not_run` | 已复核角色及目标实例。完整门禁需真实 Manifest 和恢复回执。 |
| 正式迁移 | `not_run` | 尚缺完整恢复验收和通过的统一门禁。 |

最近一次完整门禁是 11:17 的历史记录，退出码 `2`。当时
`backup_readiness=failed`、`restore_readiness=failed`、`migration_readiness=passed`、
`environment_readiness=limited`、`overall_readiness=failed`。
当时的迁移通过结果绑定 128 项 Journal 和 V1 的 9 条待迁移项。
本轮准备期间，集成分支 `e133a7d6` 纳入 `0132_assistant_platform_knowledge_citations`。
相对源库的 119 条账本，当前 129 项 Journal 包含 10 条待迁移项，下一次门禁须按实际迁移批次核对。
[V1 数据库迁移执行单](./xiaok-i7512-v1-database-migration-runbook.md)

## 本地证据

`tmp/xiaok-i7512-dba/authorized-execution-20261116T035154711Z/` 保留原始检查结果、初期失败、日志和命令退出码。
汇总见 `15-authorized-readiness-summary.json`，关键回执为：

- `04b-i798-acl-native-result.json`、`08-i798-startup.json`，记录 ACL 和实例启动。
- `07-vault-provisioning.json`，记录凭据的加密和读回验证。
- `13-source-role-live-verification.json`，记录源库角色事务和新角色实际登录。
- `11b-i798-preparation-secure-input.json`、`12-i798-live-verification.json`，记录恢复角色、扩展准备和实测。
- `14b-official-role-contract-and-config.json`，记录正式只读检查及应用配置审计。

本次为环境运维与报告交付，模块清单无需更新。
