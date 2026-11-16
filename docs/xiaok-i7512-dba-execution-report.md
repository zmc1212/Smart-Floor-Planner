# 家客来 I7.5.12.2 DBA 执行报告

2026-11-16（Asia/Shanghai）。本次 DBA 授权准备基线为 `codex/xiaok-integration` 的
`b32bb8dd8d459808df7812fdffb14b3668cf2c72`。只读准备已完成，整体准备状态为 `limited`。
源库维护角色、独立实例 ACL、启动及角色和扩展准备待分别授权，真实备份、创建恢复数据库、真实恢复和正式迁移均为 `not_run`。

## 实际盘点

| 项目 | 状态 | 结果 |
| --- | --- | --- |
| 开发库身份 | `passed` | 11:40:03 经原 SSH 转发以 `sfp_app` 连接 `127.0.0.1:5432/smart_floor_planner`。PostgreSQL 17.10 主库，事务为 `repeatable read`、`readOnly=on`。应用角色为非超级用户且无 `BYPASSRLS`。 |
| 源库迁移账本 | `passed` | 119 条，末条 ID `125`、`0119_platform_portfolio_templates`、`created_at=1794902400000`。账本 SHA-256 为 `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381`，与上轮一致。 |
| 工作区迁移输入 | `limited` | 已提交 Journal 为 128 项，V1 批次 9 条。当前工作区在相同前缀后增加未提交的 `0132_assistant_platform_knowledge_citations`，计算出 10 条待执行项。只读命令因此报告 `observed_drift`、退出码 `2`。 |
| `sfp_backup` 缺席检查 | `passed` | 当前目录查询确认角色不存在。实际角色属性、成员关系、SELECT 覆盖和业务写权限验证为 `not_run`。 |
| 应用和 Worker 配置 | `passed` | 开发配置使用 `sfp_app` 和 `sfp_migrator`。核对本机 Admin 环境文件及两个 Compose Worker 所引用的配置，未检出维护账号。复测记录本地 Assistant Worker 数为 0。 |
| 备份目录 | `passed` | 上次门禁确认 `C:\sfp-backups\i7512-20261116` 通过受限 ACL 和 10 GiB 存储阈值检查。初次准备脚本及创建、删除自有探针文件的检查均成功。 |
| PG17 工具与 pgvector 构建件 | `passed` | `C:\pg17bin\pgsql\bin` 中的 `psql`、`postgres` 和 `pg_ctl` 均为 17.10。pgvector 0.8.2 x64 暂存件的 DLL、control 和安装 SQL 均与原构建 SHA-256 一致。 |
| pgvector 运行条件 | `failed` | 本机 PG17 安装树尚缺 pgvector DLL、control 和安装 SQL。独立实例内的版本与运行验证为 `not_run`。 |
| 维护凭据 | `failed` | 当前维护进程缺少 `XIAOK_MIGRATION_BACKUP_URL` 和 `XIAOK_MIGRATION_RESTORE_URL`。 |

[pgvector v0.8.2 上游发布](https://github.com/pgvector/pgvector/releases/tag/v0.8.2) ·
[已执行的 Windows 构建入口](https://github.com/pgvector/pgvector/blob/v0.8.2/Makefile.win)

### 独立恢复实例准备

- **离线路径、端口与系统标识 `passed`。** `C:\i798\data` 为原目录，PG17。控制记录标识 `7708385522403597728`，与源库实读标识不同，集群状态为 `shut down`。`pg_ctl status` 退出码 `3`。登记配置仅监听 `127.0.0.1:55437`，本次无端口占用及关联 Windows 服务或计划任务。
- **ACL `failed`。** `C:\i798` 与 `data` 均由本机 `Administrator` 所有，无 reparse point，仍继承 `Authenticated Users` 的 Modify 权限。变更前的 ACL 回执和 SDDL 已留存。
- **启动后核验 `not_run`。** 待确认实时监听仅为 `127.0.0.1`、PG17、实时系统标识、数据库列表、`smart_floor_planner` 缺席、目标库名空闲和标记 `xiaok-i749-isolated-test`。恢复角色、成员权限及扩展可用性待验。
- **源库兼容要求已读回。** 174 张表、146 个序列及 33 个函数归 `sfp_migrator`。源库使用 UTF8、`en_US.utf8`，`public` 有 `btree_gist 1.7` 与 `vector 0.8.2`，另有 `plpgsql 1.0`。扩展 owner 为超级用户 `sfp_owner`。独立目标需要核对模板编码、排序规则、扩展版本和 COMMENT 权限。 [PostgreSQL 扩展安装与权限](https://www.postgresql.org/docs/17/sql-createextension.html)

### 备份、恢复与统一门禁

`pg_dump` 和 `pg_restore` 均为 `not_run`，没有退出码。本轮无
`database.dump`、`database.dump.sha256`、真实 Manifest 或恢复回执。归档时间、大小、SHA-256、
快照全量数据摘要，以及恢复后的 schema、119 条账本、RLS 策略、权限和数据一致性都未验证。
目标数据库创建和清理为 `not_run`，`full_restore_passed` 未取得。

上次统一门禁于 11:17:52 执行 `npm run xiaok:migration`，退出码 `2`。
门禁采用 10 GiB 存储阈值，输入为指定的 PG 工具目录、备份目录及目标数据库名。

| 门禁字段 | 上次门禁状态 | 依据 |
| --- | --- | --- |
| `backup_readiness` | `failed` | 目录与工具通过。源库缺少 `sfp_backup`，备份凭据缺失，备份登录与归档核验 `not_run`。 |
| `restore_readiness` | `failed` | 源库没有 `sfp_restore`，角色隔离通过。恢复凭据缺失，独立实例与恢复回执核验 `not_run`。 |
| `migration_readiness` | `passed` | 9 条 SQL、128 项 Journal、迁移输入、事务运行器、源账本、迁移依赖和 `sfp_migrator` 只读登录均通过。 |
| `environment_readiness` | `limited` | 原 SSH 转发、开发库、PG 工具和空闲检查通过。观测到 Worker 0、应用监听端口 0、其他源库客户端 0。独立恢复目标 `not_run`。 |
| `overall_readiness` | `failed` | 备份角色、两套维护凭据及真实备份和恢复证据待完成。 |

## 需负责人放行的操作

1. **源库角色及跨 RLS 读取。** 请批准使用 DBA 管理连接，确认角色仍缺席后以一个事务执行正式脚本，并通过交互式 `\password sfp_backup` 设置独立密码。该角色可跨 FORCE RLS 读取所有租户的 `app` 表和序列。授权仅含数据库 CONNECT、schema USAGE、现有表和序列 SELECT，以及 `sfp_migrator` 在 `app` 新建表和序列的默认 SELECT。源目录扫描中，对象的 PUBLIC 写 ACL 和 PUBLIC 可执行的 SECURITY DEFINER 函数均为 0。创建后用实际账号验证 SELECT 覆盖、序列 USAGE/UPDATE 和表或列写权限缺席、无 owner/migrator 成员关系，以及未进入应用或 Worker 配置。 [正式备份角色脚本](../admin/scripts/sql/xiaok-create-backup-role.sql)
2. **独立目录 ACL。** 请批准对 `C:\i798` 及所用 `data` 和日志路径收紧权限，移除宽泛主体的继承访问并校验子目录，保留 SYSTEM、Administrators 和明确获准的实例操作者所需权限。
3. **独立实例启动。** 请单独批准在 ACL 验证通过且端口仍空闲后，按已登记的 `postgresql.conf` 启动既有 PG17 数据目录。启动后从 `postgres` 只读核对监听、系统标识、数据库、标记、实际 HBA 和角色。
4. **独立角色与扩展。** 请批准只在确认独立后按需标记集群，在现有授权模板中准备扩展及归档引用角色。缺少 `sfp_restore` 时按脚本创建 `LOGIN NOSUPERUSER BYPASSRLS CREATEDB NOCREATEROLE NOREPLICATION`，使用独立密码。校验 `sfp_migrator` 等实际非超级用户 owner 的 `INHERIT` 和 `SET`，确认 `sfp_restore` 无法 `SET ROLE` 为超级用户。安装经哈希核验的 pgvector 文件后，核对 `pg_available_extension_versions`、已安装的 `extversion` 和扩展 owner、COMMENT 权限，再以 `sfp_restore` 在获准的现有数据库调用一次向量距离运算验证 DLL 实际可用。 [正式恢复角色脚本](../admin/scripts/sql/xiaok-create-restore-role.sql)
5. **后续执行。** 两套维护凭据仅注入各自受控进程。真实备份、创建 `xiaok_migration_restore_i75121` 和使用真实归档恢复三项分别申请批准，并明确当次临时目标的清理范围。

已审查的源库最小授权 SQL，供 DBA 审批。

```sql
CREATE ROLE sfp_backup LOGIN
  NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT CONNECT ON DATABASE smart_floor_planner TO sfp_backup;
GRANT USAGE ON SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON TABLES TO sfp_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON SEQUENCES TO sfp_backup;
```

获批后，先复核 `55437` 无监听、`C:\i798\data` 仍停机且权限已收紧。`$startupLog` 取本轮专用且尚不存在的受限日志路径。

```powershell
& C:\pg17bin\pgsql\bin\pg_ctl.exe start -D C:\i798\data -l $startupLog -w -t 60
```

核验实例并取得凭据后，从 `admin` 依次运行项目的正式入口。将恢复命令的 JSON stdout 以 UTF-8 无 BOM 保存为真实回执，另记退出码。

```powershell
$env:XIAOK_MIGRATION_MIN_FREE_BYTES = '10737418240'
npm run --silent db:migration-backup -- --mode development --output-dir C:\sfp-backups\i7512-20261116 --pg-bin C:\pg17bin\pgsql\bin --label i7512-pre
npm run --silent db:migration-restore-verify -- --mode development --pg-bin C:\pg17bin\pgsql\bin --target-database xiaok_migration_restore_i75121 --manifest $manifestPath
npm run --silent xiaok:migration -- --pg-bin C:\pg17bin\pgsql\bin --backup-dir C:\sfp-backups\i7512-20261116 --target-database xiaok_migration_restore_i75121 --manifest $manifestPath --restore-receipt $restoreReceiptPath
```

## 证据交接

本次只读源库、i798 ACL 和配置、pgvector 哈希、迁移输入差异及命令退出码位于本地 `tmp/xiaok-i7512-dba/authorization-prep-20261116T033711879Z/`，
汇总文件为 `05-authorization-prep.json`。上次统一门禁合并回执位于本地 `tmp/xiaok-i7512-ssh-recovery/db-recheck-20261116T031705118Z/read-only-database-verification.json`。
本次为环境运维与报告交付，模块清单无需更新。 [V1 数据库迁移执行单](./xiaok-i7512-v1-database-migration-runbook.md)
