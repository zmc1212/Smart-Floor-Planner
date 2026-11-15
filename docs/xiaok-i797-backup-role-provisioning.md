# I7.4.9.7 真实 sfp_backup 角色安全创建方案与授权脚本

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`1951377a7ae2`
> 日期：`2026-11-15`（Asia/Shanghai）
> 状态：`provisioning_scripts_ready = true`、`isolated_validation_passed = true`、`real_role_created = false`、`real_database_modified = false`

## 1. 结论

本轮已准备并验证三件交付物：

1. 正式授权 SQL：`admin/scripts/sql/xiaok-create-backup-role.sql`；
2. 只读验收工具：`admin/scripts/xiaok-backup-role-preflight.ts`（`npm run check:backup-role`）；
3. 安全目录准备脚本：`admin/scripts/prepare-xiaok-backup-directory.ps1`。

在独立 PG17.10 环境通过正式 SQL 创建 `sfp_backup`，6 项角色/目录测试全部通过。**真实 `smart_floor_planner` 尚未创建 `sfp_backup`，未设置真实密码，未修改任何真实角色或权限。**

## 2. 角色创建 SQL

文件：`admin/scripts/sql/xiaok-create-backup-role.sql`

```sql
\set ON_ERROR_STOP on
\echo 'WARNING: creating sfp_backup with LOGIN, NOSUPERUSER, BYPASSRLS, NOCREATEDB, NOCREATEROLE, NOREPLICATION'
\echo 'WARNING: this role can read every tenant through FORCE RLS and must never be used by application traffic'

\if :{?backup_database}
\else
\set backup_database smart_floor_planner
\endif

CREATE ROLE sfp_backup LOGIN
  NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

GRANT CONNECT ON DATABASE :"backup_database" TO sfp_backup;
GRANT USAGE ON SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON TABLES TO sfp_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON SEQUENCES TO sfp_backup;

\echo 'sfp_backup created with SELECT-only coverage. No password was set.'
\echo 'Set the password separately with: \password sfp_backup'
```

特点：

- 不包含明文密码；
- 角色已存在时 `CREATE ROLE` 直接失败，不静默 ALTER 现有角色；
- `BYPASSRLS` 警告在脚本输出中明确显示；
- 不授予 INSERT/UPDATE/DELETE/TRUNCATE、CREATE、ALTER、DROP、迁移账本写权限或角色成员关系；
- 不把 `sfp_backup` 设为任何业务表 owner；
- `backup_database` 可通过 psql 变量指定，默认 `smart_floor_planner`。

执行必须由负责人批准的管理连接完成；不要用 `sfp_backup` 自己执行授权。

## 3. 密码设置方法

SQL 不设置密码。授权完成后，用独立交互式步骤：

```powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d smart_floor_planner
```

```sql
\password sfp_backup
```

要求：

- 密码只进入 PostgreSQL 交互式提示，不进入 Shell 历史、SQL 文件、命令行参数或仓库；
- 不自动生成并打印密码；
- 正式备份时仅从受控密钥存储临时注入：
  `XIAOK_MIGRATION_BACKUP_URL=postgresql://sfp_backup:<secret>@127.0.0.1:5432/smart_floor_planner`；
- 禁止写入 `DATABASE_URL`、`DATABASE_MIGRATION_URL`、应用/Worker 环境、GitHub、Manifest 或日志。

## 4. 权限清单

| 权限 | 授予 |
| --- | --- |
| 角色属性 | LOGIN、NOSUPERUSER、BYPASSRLS、NOCREATEDB、NOCREATEROLE、NOREPLICATION |
| 数据库 | `CONNECT` on `smart_floor_planner` |
| schema | `USAGE` on `app` |
| 现有表 | `SELECT` on all tables |
| 现有序列 | `SELECT` on all sequences |
| 未来对象 | 由 `sfp_migrator` 在 `app` 创建的表/序列默认 `SELECT` |
| 写/DDL | 无 |
| 迁移账本 | 无写权限 |
| owner | 无 |
| 角色成员 | 不属于 `sfp_owner`/`sfp_migrator` |

`BYPASSRLS` 是跨 FORCE RLS 完整备份的最小手段，但属于高敏感权限：不得加入业务连接池、应用运行时或 Worker 环境。

## 5. 只读验收工具

命令：

```powershell
npm run check:backup-role
```

目标连接通过 `XIAOK_BACKUP_ROLE_CHECK_URL` 注入，必须使用 `sfp_app`、只读事务；不打印密码或连接串。开发模式仅接受 `127.0.0.1:5432/smart_floor_planner`；隔离模式要求动态端口、`xiaok_i749_*` 库名和数据库标记。

检查项：

1. 角色存在；
2. `rolcanlogin=true`；
3. `rolsuper=false`；
4. `rolbypassrls=true`；
5. `rolcreatedb=false`；
6. `rolcreaterole=false`；
7. `rolreplication=false`；
8. 不属于 `sfp_owner`/`sfp_migrator`；
9. `app` schema USAGE；
10. 所有现有表 SELECT；
11. 所有现有序列 SELECT；
12. 无 INSERT/UPDATE/DELETE/TRUNCATE；
13. 无 CREATE/ALTER/DROP、无 schema/database CREATE、无对象 owner；
14. 无迁移账本写权限；
15. `sfp_app` 仍非 superuser/非 BYPASSRLS，且 FORCE RLS/Policy 仍适用；
16. 无 `sfp_backup` 活动业务会话，且 `DATABASE_URL`/`DATABASE_MIGRATION_URL`/`XIAOK_MIGRATION_RESTORE_URL` 未出现 `sfp_backup`。

连接失败、目标不明确或任一检查失败时 fail closed，输出 JSON 且退出码非 0。

## 6. PG17 验证结果

环境：隔离 PG17.10，合成企业 1454/1455、完整 128 条迁移结构。通过正式 SQL 创建角色，密码仅由测试步骤临时设置。

| 场景 | 结果 |
| --- | --- |
| A. 角色属性 | 通过：LOGIN、NOSUPERUSER、BYPASSRLS、NOCREATEDB、NOCREATEROLE、NOREPLICATION |
| B. 跨企业 FORCE RLS 读取 | 通过：读取 1454/1455 共 2 条提醒 |
| C. 全部业务表 SELECT | 通过：缺失 0 |
| D. 全部序列 SELECT | 通过：缺失 0 |
| E. INSERT/UPDATE/DELETE/TRUNCATE | 全部 `42501` |
| F. CREATE/ALTER/DROP | 全部 `42501` |
| G. 迁移账本 | INSERT `42501` |
| H. owner | 不拥有任何业务表/序列 |
| I. sfp_migrator 成员 | 否 |
| J. 未来对象默认 SELECT | 通过：`sfp_migrator` 新建表/序列后 `sfp_backup` 自动可 SELECT，INSERT 仍拒绝 |
| K. sfp_app RLS | 通过：1454/1455 各只能看到 1 条提醒 |
| L. 缺少表 SELECT | preflight 失败（`all_tables_selectable`） |
| M. 缺少 BYPASSRLS | preflight 失败（`rolbypassrls_true`） |

测试结果：**6 passed / 0 skipped**。备份/恢复回归：**25 passed / 0 skipped**。TypeScript、定向 ESLint 通过。

## 7. 恢复权限独立审查

真实 `XIAOK_MIGRATION_RESTORE_URL` 仍无凭据。恢复工具实际需要：

1. 创建和删除一次性恢复数据库（`CREATEDB` 或 superuser）；
2. 恢复原 owner/ACL（需能引用/设置对象 owner，通常为 superuser 或具备 `SET ROLE` 到 `sfp_migrator`/`sfp_owner` 的维护角色）；
3. 创建必要角色引用（目标集群已有角色；不创建新业务角色）；
4. 恢复 schema/data 并跨 FORCE RLS 校验；
5. 删除临时恢复库。

最小权限方案：

- 专用维护角色（不复用 `sfp_backup`）：LOGIN、CREATEDB、BYPASSRLS，且被批准可 `SET ROLE` 到 `sfp_migrator`/`sfp_owner`；
- 或不创建新角色，使用受控 superuser 维护连接，但必须书面接受管理级权限；
- 恢复账号不得进入业务环境，不得用于日常备份；
- 本轮不创建真实恢复角色。

## 8. 安全目录准备

脚本：`admin/scripts/prepare-xiaok-backup-directory.ps1`

- 默认目录：`C:\sfp-backups\i795-20261115`；
- 创建目录、移除继承、仅本地 Administrators 组与 SYSTEM 完全控制；
- 检查至少 10 GB 可用空间（可参数化）；
- 拒绝 Git 仓库内路径；
- 检查 ACL/owner，拒绝 Authenticated Users/Everyone 写权限；
- 不创建备份文件，不删除已有文件；
- 重复执行安全、可预测。

隔离测试结果：

- 安全目录首次执行通过，第二次执行通过且目录不变；
- `MinFreeGB=100000` 失败且未创建目录；
- 仓库内路径失败且未创建目录；
- 输出无 Authenticated Users/Everyone 写权限；
- 静态 PowerShell 解析通过。

真实默认目录尚未创建；本轮只做本机安全目录测试。

## 9. 真实开发库状态与所需审批

真实 `smart_floor_planner`：

- 未创建 `sfp_backup`；
- 未修改 `sfp_owner`、任何角色、表、序列或账本；
- 未设置真实密码；
- 未执行真实 `pg_dump`、`db:migrate`、Worker 或生产部署。

创建真实角色还需要负责人批准：

1. 批准执行创建 SQL 的管理连接（需 CREATEROLE 或 superuser，并能以 `sfp_migrator` 设置默认权限）；
2. 批准 `sfp_backup` 的角色属性与 SELECT-only 权限；
3. 批准通过交互式 `\password` 设置密码；
4. 批准 `sfp_backup` 仅用于离线备份，不进入应用/Worker/连接池；
5. 批准或拒绝保留 `sfp_owner` 的 legacy 兼容路径；
6. 批准 `XIAOK_MIGRATION_RESTORE_URL` 的独立维护角色方案；
7. 批准在 C: 或其他受控卷创建 10 GB 以上的安全目录。

## 10. 文件

- `admin/scripts/sql/xiaok-create-backup-role.sql`
- `admin/scripts/xiaok-backup-role-preflight.ts`
- `admin/scripts/prepare-xiaok-backup-directory.ps1`
- `admin/scripts/__tests__/xiaok-backup-role-preflight.test.mjs`
