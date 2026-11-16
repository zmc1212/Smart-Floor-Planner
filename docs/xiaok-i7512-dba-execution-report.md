# 家客来 I7.5.12.2 DBA 执行报告

2026-11-16（Asia/Shanghai）。验收基线为 `codex/xiaok-integration` 的
`4f1ad799abbcac2bab6a27ea3a022cab999d875a`。备份目录已通过检查，pgvector 构建件已暂存。
真实备份和恢复均为 `not_run`。统一门禁 `overall_readiness=failed`，正式迁移未执行，当前不具备执行条件。

## 实际盘点

| 项目 | 结果 |
| --- | --- |
| 开发库和权限 | 盘点初期在 `127.0.0.1:5432` 观察到原 SSH 转发，随后监听消失。远端 SSH 的 TCP 22 可达，协议 banner 交换超时，OpenSSH 退出码 `255`。原转发监管仍在。最新检查中，源库登录、角色目录和实时权限回读为 `not_run`。 |
| 上轮真实源库基线 | I7.5.12.1 于 09:45:37 实测 PostgreSQL 17.10、`sfp_app`、只读事务、非超级用户、无 `BYPASSRLS`。源库逻辑大小 263,730,867 字节。账本 119 条，待执行 9 条，账本摘要 SHA-256 为 `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381`。 |
| `sfp_backup` | 尚未就绪。上轮真实目录检查没有此角色。本轮无法重读目录，角色属性、成员关系、表和序列权限及业务写权限均未核实。正式 SQL 已审查，执行待授权。 |
| 应用和 Worker 配置 | 实际加载的开发配置中，`DATABASE_URL` 使用 `sfp_app`，`DATABASE_MIGRATION_URL` 使用 `sfp_migrator`。两个 Compose Worker 引用的环境文件及所查的本地配置均未发现维护角色或维护 URL。检查窗口内未观察到本地 Assistant Worker 进程。 |
| 备份目录 | 项目 `prepare-xiaok-backup-directory.ps1` 退出码 `0`。新建 `C:\sfp-backups\i7512-20261116`，校验仓库外路径、各级目录 reparse point 和 ACL。父目录及目标关闭 ACL 继承，SYSTEM 和 Administrators 有完全控制，当前本机操作者有单独的 Modify 权限，实际创建和关闭即删除的探针通过。门禁测得 C 盘约 27.60 GiB 可用，按 10 GiB 阈值通过。盘点时 G 盘约 37.09 GiB 可用。目标初始条目 0。 |
| PG 工具和扩展 | `C:\pg17bin\pgsql\bin` 的 `psql`、`pg_dump`、`pg_restore`、`postgres` 和 `pg_ctl` 均为 17.10，工具版本检查退出码 `0`。安装树有 `btree_gist 1.7`、`plpgsql 1.0` 的控制文件和 DLL，缺少 `vector`。已针对这套 PG17 头文件构建上游 v0.8.2 的 x64 DLL、control 和安装 SQL，构建退出码 `0`，SHA-256 见本地回执。安装与实库扩展兼容性待验证。 |
| 维护凭据 | 当前进程中 `XIAOK_MIGRATION_BACKUP_URL` 和 `XIAOK_MIGRATION_RESTORE_URL` 均未配置。PG 工具目录以 `--pg-bin` 显式传入。 |

[pgvector v0.8.2 上游发布](https://github.com/pgvector/pgvector/releases/tag/v0.8.2) ·
[已执行的 Windows 构建入口](https://github.com/pgvector/pgvector/blob/v0.8.2/Makefile.win)

### 独立恢复候选

- `C:\i794\data` 配置在 `127.0.0.1:55436`。初检停机，复查期间该目录对应的既有 PostgreSQL 进程开始监听，`pg_ctl status` 从 `3` 变为 `0`。本任务未启动该进程，当前归其他活动占用。
- `C:\i798\data` 配置在 `127.0.0.1:55437`，`pg_ctl status` 退出码 `3`，离线控制记录为 `shut down`。未发现关联 Windows 服务、计划任务或端口占用。优先请批这个候选。
- 两个目录均为 PG17，离线控制记录的系统标识各异。两处根目录及数据目录均继承 `Authenticated Users` 的 Modify 权限。候选实时数据库列表、`smart_floor_planner` 缺席、与源库系统标识对照、维护库标记 `xiaok-i749-isolated-test`、`sfp_restore` 及 owner 成员关系均待授权后查验。本轮没有可用于真实恢复的已验收实例。

### 备份、恢复与统一门禁

`pg_dump` 和 `pg_restore` 均为 `not_run`，没有退出码。本轮无
`database.dump`、`database.dump.sha256`、真实 Manifest 或恢复回执。归档时间、大小、SHA-256、
快照全量数据摘要，以及恢复后的 schema、119 条账本、RLS 策略、权限和数据一致性都未验证。
目标数据库创建和清理为 `not_run`，`full_restore_passed` 未取得。

10:11:50 执行 `npm run xiaok:migration`，退出码 `2`。
门禁采用 10 GiB 存储阈值，输入为指定的 PG 工具目录、备份目录及目标数据库名。

| 门禁字段 | 当前状态 | 依据 |
| --- | --- | --- |
| `backup_readiness` | `failed` | 目录与工具通过，备份凭据缺失。源角色、备份登录及归档检查 `not_run`。 |
| `restore_readiness` | `failed` | 恢复凭据缺失。实例与角色验证、恢复回执检查 `not_run`。 |
| `migration_readiness` | `limited` | 9 条 SQL、128 项 Journal、迁移输入和审查过的事务运行器指纹通过。当前源账本、依赖、迁移账号检查 `not_run`。 |
| `environment_readiness` | `failed` | 原开发转发复核失败，源库未能连接，独立目标未验收。 |
| `overall_readiness` | `failed` | 真实备份、恢复证据及当前环境核验待完成。 |

## 需负责人放行的操作

1. **源库权限。** 先恢复原开发 SSH 转发，用 `sfp_app` 重新核对 DB 身份、账本、角色及连接状态。确认 `sfp_backup` 缺席后，请批准在开发库使用 DBA 管理连接，以一个事务执行下列正式脚本权限范围，并通过独立管理会话的交互式 `\password sfp_backup` 设置凭据。该角色可跨 FORCE RLS 读取所有租户的 `app` 表与序列。默认 ACL 只涉及 `sfp_migrator` 今后在 `app` 创建的表与序列。创建后验证实际登录、SELECT 覆盖、无业务写权限和无 owner/migrator 成员关系。 [正式备份角色脚本](../admin/scripts/sql/xiaok-create-backup-role.sql)
2. **独立实例及权限。** 请批准仅对 `C:\i798` 执行所需的 ACL 收紧，并在回环 `55437` 启动既有数据目录，启动输出写入新的受限日志。先从维护库 `postgres` 只读查验 PG17、系统标识、数据库列表、标记、实际 HBA 和已有角色。仅在确认独立、没有 `smart_floor_planner` 及目标名后，按需批准设置标记、准备归档引用角色与兼容的模板扩展，并核对编码及排序规则。缺少 `sfp_restore` 时按项目脚本创建 `LOGIN NOSUPERUSER BYPASSRLS CREATEDB NOCREATEROLE NOREPLICATION`，为实际非超级用户 owner 校验 `INHERIT` 和 `SET` 权限。预计要有 `sfp_app`、`sfp_migrator`、`sfp_auditor`、`sfp_backup`，其余按真实 TOC 和 ACL 决定。扩展需由 DBA 准备并验证 owner 和 COMMENT 权限。 [正式恢复角色脚本](../admin/scripts/sql/xiaok-create-restore-role.sql)
3. **真实备份与恢复。** 请批准从开发库导出完整快照至受限目录，指定执行窗口和归档保管责任人。请同时批准在已核验的独立实例创建 `xiaok_migration_restore_i75121`、载入本次真实归档，以及按恢复脚本的 OID、owner 和用途标记校验清理本轮新建库。两套维护凭据通过受控进程环境注入各自变量。

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
& C:\pg17bin\pgsql\bin\pg_ctl.exe start -D C:\i798\data -o '-p 55437 -c listen_addresses=127.0.0.1' -l $startupLog -w -t 60
```

核验实例并取得凭据后，从 `admin` 依次运行项目的正式入口。将恢复命令的 JSON stdout 以 UTF-8 无 BOM 保存为真实回执，另记退出码。

```powershell
$env:XIAOK_MIGRATION_MIN_FREE_BYTES = '10737418240'
npm run --silent db:migration-backup -- --mode development --output-dir C:\sfp-backups\i7512-20261116 --pg-bin C:\pg17bin\pgsql\bin --label i7512-pre
npm run --silent db:migration-restore-verify -- --mode development --pg-bin C:\pg17bin\pgsql\bin --target-database xiaok_migration_restore_i75121 --manifest $manifestPath
npm run --silent xiaok:migration -- --pg-bin C:\pg17bin\pgsql\bin --backup-dir C:\sfp-backups\i7512-20261116 --target-database xiaok_migration_restore_i75121 --manifest $manifestPath --restore-receipt $restoreReceiptPath
```

## 证据交接

本地非提交目录 `tmp/xiaok-i7512-dba/` 留存主机、角色配置、目录 ACL、监听、扩展构建和门禁原始 JSON、日志与命令退出码。
当前门禁使用 `09-readiness-raw.json` / `09-readiness-command.json`，扩展构建使用
`10-pgvector-build.json`，候选最后一次进程归属见 `12-listener-identity.json`。
上轮账本和源角色读回来自 `tmp/xiaok-i75121-migration-readiness.json`。
本次为环境运维与报告交付，模块清单无需更新。 [V1 数据库迁移执行单](./xiaok-i7512-v1-database-migration-runbook.md)
