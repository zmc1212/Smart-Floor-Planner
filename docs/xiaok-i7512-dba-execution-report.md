# 家客来 I7.5.12.2 DBA 执行报告

2026-11-16（Asia/Shanghai）。开发库真实备份和 i798 完整恢复均已通过。独立 V1 候选取得 `full_restore_passed=true` 和 `overall_readiness=passed`。当前集成分支的统一门禁为 `failed`，正式迁移为 `not_run`。

## 源库与独立实例

- **源库。** 经核验的 SSH 转发连接 `127.0.0.1:5432/smart_floor_planner`，PostgreSQL 17.10，系统标识 `7696770731622109222`。专用 `sfp_backup` 具有 `BYPASSRLS`，对 `app` 的 174 张表和 146 个序列有 SELECT。无业务写权限，无 owner 或 migrator 成员关系。备份前实测其他源库客户端、应用监听及 Worker 均为 0。
- **i798。** PostgreSQL 17.10，系统标识 `7708385522403597728`，仅监听 `127.0.0.1:55437`，实例标记 `xiaok-i749-isolated-test`。使用已收紧 ACL 的原数据目录及 i798 专用 PG17.10 运行目录。以 `sfp_restore` 执行演练，拥有 `sfp_migrator` 的 INHERIT 和 SET 权限。归档扩展核验通过，含 `vector 0.8.2` 和 `btree_gist 1.7`。
- **凭据。** 两套维护凭据从本机 Windows DPAPI 受限存储解密，仅注入对应维护进程。正式应用和 Worker 配置范围内未检出维护账号。

## 真实备份与恢复验收

备份目录 `C:\sfp-backups\i7512-20261116` 通过 ACL 和 10 GiB 可用空间检查。两次备份各写入全新目录，均保留 `database.dump`、`database.dump.sha256` 和 `migration-backup-manifest.json`，使用 PostgreSQL 17.10 工具，`pg_dump` 与归档目录表检查均为退出码 `0`。

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

逐对象对比原归档和真实恢复的 ACL 后，发现 143 个关系仅有条目顺序差异。对象所有者、授权方、被授权方、权限位和授权选项全部相同。独立分支 `codex/xiaok-i7512-acl-digest` 的本地提交 `ea37a866` 为新版 Manifest 的 ACL 条目排序后计算摘要，保留每条授权、所有者和 ACL 的空值状态。旧 Manifest 继续使用原摘要算法。离线回归通过 8 项，另建合成数据库的 18 项未运行。真实备份和真实恢复验证了修复。 [PostgreSQL ACL 函数](https://www.postgresql.org/docs/17/functions-info.html)

源库和实际恢复库均为 UTF8。源库 `LC_COLLATE`、`LC_CTYPE` 为 `en_US.utf8`，版本 `2.36`。恢复库两项均为 `C`。合成样本中源库默认把 `a` 排在 `A` 前，i798 模板默认把 `A` 排在 `a` 前。源库 `app` 有 653 个列和 150 个索引使用默认排序规则。本轮通过的逻辑恢复验证覆盖数据和定义，跨环境的文本排序行为存在差异。

## 统一门禁

两次最终门禁均输入同一份真实 Manifest 和通过的完整恢复回执。

| 字段 | 当前集成分支 `002aab09` | 独立 V1 候选 `ea37a866` |
| --- | --- | --- |
| `backup_readiness` | `limited` | `passed` |
| `restore_readiness` | `limited` | `passed` |
| `migration_readiness` | `failed` | `passed` |
| `environment_readiness` | `passed` | `passed` |
| `overall_readiness` | `failed` | `passed` |
| 命令退出码 | `2` | `0` |

当前集成分支 Journal 有 129 项、待迁移 10 项。门禁固定核对 V1 的 128 项 Journal 和 9 条待迁移项。额外的 `0132_assistant_platform_knowledge_citations` 触发 `v1_sql_or_journal_drift`、`unexpected_pre_migration_ledger`，并使归档及回执检查停在 `limited`。独立候选基于已验收的 V1 批次 `5b01295f`。正式迁移需先确认实际批准批次并取得该批次的完整门禁通过。 [V1 数据库迁移执行单](./xiaok-i7512-v1-database-migration-runbook.md)

## 本地回执

证据位于 `tmp/xiaok-i7512-dba/real-backup-restore-20261116T043010583Z/`，含原始退出码、失败尝试及后续成功回执。关键文件如下。

- `04-backup-verification.json`、`05c-restore-receipt.json`、`09b-acl-difference.json` 保存原备份、恢复回执及逐对象 ACL 差异。
- `11-backup-verification.json`、`12-restore-receipt.json`、`12-collation-and-cleanup.json` 保存最终备份、恢复回执及实际目标排序规则和清理证据。
- `13-unified-gate-v1-with-acl-fix.json`、`14-unified-gate-current-with-restored-backup.json`、`15-execution-summary.json` 保存两份最终门禁及汇总。

集成分支此次只提交本报告。运维脚本修复位于独立分支，业务模块行为和模块清单无需更新。
