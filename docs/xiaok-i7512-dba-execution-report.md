# 家客来 I7.5.12.2 DBA 执行报告

2026-11-16（Asia/Shanghai）。历史开发库真实备份和 i798 完整逻辑恢复已通过。I7.5.16 在 14:37 只读复核了同一归档及回执，当前十条候选迁移的统一门禁为 `passed`。正式迁移状态为 `not_run`，审批和本窗口备份及恢复仍待执行。 [I7.5.16 最终审查](./xiaok-i7516-migration-final-review.md)

## 源库与独立实例

- **源库。** 经核验的 SSH 转发连接 `127.0.0.1:5432/smart_floor_planner`，PostgreSQL 17.10，系统标识 `7696770731622109222`，账本仍为 119 条。已建 `sfp_backup` 具有 `LOGIN` 和 `BYPASSRLS`，覆盖 `app` 的 174 张表和 146 个序列的备份读权限，无业务写权限或 owner/migrator 成员关系。14:37 门禁观测到其他源库客户端、应用监听及 Worker 均为 0。
- **i798。** PostgreSQL 17.10，系统标识 `7708385522403597728`，仅监听 `127.0.0.1:55437`，标记 `xiaok-i749-isolated-test`，运行路径为 `C:\i798\pg17.10-vector0.8.2`，数据目录为 `C:\i798\data`。目录继承受保护父目录的三方授权。已建 `sfp_restore` 具备 `CREATEDB/BYPASSRLS`，非超级用户，可 INHERIT/SET `sfp_migrator`。源集群无 `sfp_restore`，i798 无源库同名库，上一演练库仍已释放。
- **扩展。** i798 专用运行目录的 dll、control、0.8.2 安装 SQL 与已构建件 SHA 一致。`template1` 已安装 `vector 0.8.2` 和 `btree_gist 1.7`，owner 为 `sfp_migrator`，以 `sfp_restore` 只读运行向量 L2 距离得到 1。`postgres` 维护库报告扩展可用。新演练库由默认 `template1` 继承扩展及 owner。 [PG17 创建数据库](https://www.postgresql.org/docs/17/sql-createdatabase.html)
- **凭据。** 两套 Windows DPAPI 受限文件可解密，两角色的回环目标和只读登录均通过。凭据仅注入核验进程。检查的本地开发、生产配置及当前进程常驻环境未检出维护账号绑定。

## 真实备份与恢复验收

备份目录 `C:\sfp-backups\i7512-20261116` 禁用 ACL 继承，仅授权本机 Administrator、Administrators 和 SYSTEM，归档目录继承该授权。14:37 剩余 24,923,222,016 字节，超过 10 GiB 门槛。历史两次备份各写入独立目录，均保留 `database.dump`、`database.dump.sha256` 和 Manifest。历史 `pg_dump` 和目录表检查均退出 `0`。

| 归档 | 完成时间 | 大小 | 恢复验收 |
| --- | --- | ---: | --- |
| `xiaok-mig-20261116t043116246z-a572cbd2` | 12:32:05 | 110,204,825 字节 | 原工具 `pg_restore=0`。结构、数据、账本和 RLS 通过，验收器因 `permissions_not_restored` 退出 `1`。 |
| `xiaok-mig-20261116t044327413z-1b8e91b2` | 12:44:16 | 110,204,825 字节 | 独立修复候选 `pg_restore=0`、验收器退出 `0`、`full_restore_passed=true`。本轮创建的演练库按 OID、owner 和用途标记清理，后续只读检查确认库名已释放。 |

最终归档含 2,612 个目录表条目，其中 174 个为表数据。真恢复核对 173 张业务表的 99,302 行及逐表摘要，迁移账本单独核对 119 条。末条为 ID `125`、`0119_platform_portfolio_templates`。结构、索引、约束、扩展、153 张 FORCE RLS 表、208 条策略，以及 schema、320 个关系和 33 个函数的权限摘要均匹配。

| 摘要 | SHA-256 |
| --- | --- |
| 最终归档 | `9cb3fe83b3ddc02bbccbd49272d77772f60e7af19275da3338be9f98676e3cc2` |
| 最终 Manifest | `5510e01c4b78e048fc49be4780e206d6000dcf42375b238d649c9cf126450eb0` |
| 全部业务表摘要汇总 | `2eca8dea27e91fa023a6359c0889e57e0629f63c3ccd2fab1c37547fe4392e81` |
| 119 条迁移账本 | `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381` |
| ACL 摘要 | `fef0b1a42a12f126cd175f45cf533be684de485a6e2c11dbb6adc8178c5a44cb` |

### 权限与排序规则

逐对象对比原归档和真实恢复的 ACL 后，发现 143 个关系仅有条目顺序差异。对象所有者、授权方、被授权方、权限位和授权选项全部相同。独立提交 `ea37a866` 引入 Manifest 模式 `aclitems-c-sort-v1`，按 ACL 条目排序后计算摘要，保留每条授权、所有者和 ACL 空值。I7.5.16 已把这一经过真实恢复验证的修复纳入集成分支。旧 Manifest 沿用原摘要算法。Windows ACL 核验改用系统目录 ACL API，修复当前工具子进程中 `Get-Acl` 模块无法自动加载造成的假阻塞。实际目录权限经独立读取验证。 [PostgreSQL ACL 函数](https://www.postgresql.org/docs/17/functions-info.html)

源库和实际恢复库均为 UTF8。源库 `LC_COLLATE`、`LC_CTYPE` 为 `en_US.utf8`，版本 `2.36`。恢复库两项均为 `C`。合成样本中源库默认把 `a` 排在 `A` 前，i798 模板默认把 `A` 排在 `a` 前。源库 `app` 有 653 个列和 150 个索引使用默认排序规则。本轮通过的逻辑恢复验证覆盖数据和定义，跨环境的文本排序行为存在差异。

## 统一门禁

三次对照均输入同一份真实 Manifest 和通过的完整恢复回执。

| 字段 | 历史集成分支 `002aab09` | 历史九条候选 `ea37a866` | I7.5.16 十条候选 |
| --- | --- | --- | --- |
| `backup_readiness` | `limited` | `passed` | `passed` |
| `restore_readiness` | `limited` | `passed` | `passed` |
| `migration_readiness` | `failed` | `passed` | `passed` |
| `environment_readiness` | `passed` | `passed` | `passed` |
| `overall_readiness` | `failed` | `passed` | `passed` |
| 命令退出码 | `2` | `0` | `0` |

历史集成分支按 128 项 Journal 和九条待迁移校验，额外的 0132 触发 `v1_sql_or_journal_drift` 和 `unexpected_pre_migration_ledger`。当前 129 项 Journal、十条 SQL 和源库依赖全部通过，保留旧 119 条账本摘要。归档和回执覆盖迁移前 119 条结构；排序兼容与审批按执行单确认。 [V1 数据库迁移执行单](./xiaok-i7512-v1-database-migration-runbook.md)

## 本地回执

证据位于 `tmp/xiaok-i7512-dba/real-backup-restore-20261116T043010583Z/`，含原始退出码、失败尝试及后续成功回执。关键文件如下。

- `04-backup-verification.json`、`05c-restore-receipt.json`、`09b-acl-difference.json` 保存原备份、恢复回执及逐对象 ACL 差异。
- `11-backup-verification.json`、`12-restore-receipt.json`、`12-collation-and-cleanup.json` 保存最终备份、恢复回执及实际目标排序规则和清理证据。
- `13-unified-gate-v1-with-acl-fix.json`、`14-unified-gate-current-with-restored-backup.json`、`15-execution-summary.json` 保存两份最终门禁及汇总。

I7.5.16 只读证据位于 `tmp/xiaok-i7516/read-only-20261116T062850975Z/`，含 `unified-gate-final.json`、`unified-gate-final-binding.json`、`source-citations.json` 和 `i798-template-sort.json`。两份原归档和恢复回执继续保留。
