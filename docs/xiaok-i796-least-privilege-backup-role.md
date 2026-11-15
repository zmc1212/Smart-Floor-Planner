# I7.4.9.6 最小权限专用数据库备份角色 sfp_backup

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`0908ed7a65fb`
> 日期：`2026-11-15`（Asia/Shanghai）
> 状态：`role_designed = true`、`isolated_validation_passed = true`、`real_role_created = false`、`real_database_modified = false`

## 1. 结论

`sfp_backup` 的权限模型已在独立 PostgreSQL 17.10 环境验证通过：

- 可以跨 FORCE RLS 读取全部租户数据；
- 可以读取全部现有业务表和序列；
- 可以完成 custom archive 备份；
- 可以完成独立恢复并通过数据、账本、RLS、权限摘要验证；
- 不能 INSERT/UPDATE/DELETE；
- 不能 CREATE/ALTER 业务对象；
- 不能写迁移账本；
- 不是 superuser，不是 sfp_owner/sfp_migrator 成员。

**真实开发库尚未创建 `sfp_backup`**，也未修改 `sfp_owner` 或 1454 数据库权限。

## 2. 角色属性

```sql
CREATE ROLE sfp_backup LOGIN
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
```

| 属性 | 目标值 |
| --- | --- |
| LOGIN | true |
| NOSUPERUSER | true（rolsuper=false） |
| BYPASSRLS | true |
| NOCREATEDB | true |
| NOCREATEROLE | true |
| NOREPLICATION | true |
| sfp_owner / sfp_migrator 成员 | 否 |
| 业务表 owner | 否 |
| 迁移权限 | 否 |

## 3. 完整权限清单

仅授予：

```sql
GRANT CONNECT ON DATABASE smart_floor_planner TO sfp_backup;
GRANT USAGE ON SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO sfp_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA app TO sfp_backup;

ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON TABLES TO sfp_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE sfp_migrator IN SCHEMA app
  GRANT SELECT ON SEQUENCES TO sfp_backup;
```

不授予：

- schema `CREATE`；
- 表/序列的 INSERT、UPDATE、DELETE、USAGE、ALTER；
- 表/序列所有权；
- `app.__drizzle_migrations` 写权限；
- 任何角色成员关系；
- SUPERUSER、CREATEDB、CREATEROLE、REPLICATION。

元数据读取（`pg_class`、`pg_policies`、`pg_roles` 等）由 PostgreSQL 默认目录可见性提供，无需额外授权。

未来新增业务表/序列由 `ALTER DEFAULT PRIVILEGES` 仅授予 SELECT；不会自动获得写权限。若未来新增对象由其他 owner 创建，必须单独评估并补充 SELECT，不自动扩大权限。

## 4. 为什么需要 BYPASSRLS

真实库 `app` 下 153 张表启用 FORCE RLS。FORCE RLS 对表 owner 也生效，因此：

- 普通非 BYPASSRLS 角色只能看到当前租户；
- `pg_dump` 在 `row_security=off` 下遇到无法绕过的 RLS 表会失败（否则可能静默漏行）；
- 不能把“部分租户备份成功”当作完整备份。

`BYPASSRLS` 是让只读备份账号在不获得 SUPERUSER 的前提下证明“可完整读取所有租户”的最小权限手段。该权限高度敏感，因此：

- 不得加入业务连接池；
- 不得放入应用运行环境；
- 仅通过受控密钥存储注入备份进程；
- 不得授予 SUPERUSER；
- 不得授予任何写/DDL 权限。

## 5. 为什么不用 SUPERUSER

`sfp_owner` 当前是真实库的 superuser（且 BYPASSRLS），能力足够但权限过大：

- 可修改/删除任意对象和数据；
- 可读取角色与敏感配置；
- 可绕过所有权限检查；
- 一旦凭据泄露，影响远超备份。

`sfp_backup` 把这个风险限制为“只读 + 跨 RLS”。

## 6. PG17 验证结果

环境：独立可丢弃 PostgreSQL 17.10，端口 `55436`，合成企业 1454/1455、跨租户提醒数据、完整 128 条迁移结构。只使用 `sfp_backup` 与 `sfp_app`，不连接真实数据库。

| 场景 | 结果 |
| --- | --- |
| A. 跨 FORCE RLS 读取全部租户 | 通过：备份角色读到 1454/1455 全部 2 条提醒 |
| B. 读取全部业务表 | 通过：174 张表 SELECT 覆盖，缺失 0 |
| C. 读取全部序列 | 通过：146 个序列 SELECT 覆盖，缺失 0 |
| D. custom archive 备份 | 通过：`sfp_backup` 成功生成 archive/Manifest/SHA |
| E. 完整恢复并验证摘要 | 通过：`full_restore_passed=true`，账本/数据/RLS/权限一致 |
| F. 不能 INSERT | 通过：`42501` |
| G. 不能 UPDATE | 通过：`42501` |
| H. 不能 DELETE | 通过：`42501` |
| I. 不能 CREATE/ALTER 业务对象 | 通过：`42501` |
| J. rolsuper=false | 通过 |
| K. rolbypassrls=true | 通过 |
| L. 不属于 sfp_owner/sfp_migrator | 通过：`pg_has_role(...,'MEMBER')=false` |
| M. sfp_app 仍受 RLS 限制 | 通过：1454/1455 各只能看到 1 条提醒 |

额外验证：

- 缺少 BYPASSRLS 时备份 fail closed（`backup_role_missing_bypass_rls`）；
- 缺少表 SELECT 时备份 fail closed（`backup_role_missing_table_select`）；
- 未批准用户名在连接前被拒绝（`unapproved_backup_role`）；
- 迁移账本 insert 被拒绝（`42501`）。

## 7. 备份工具兼容

`admin/scripts/xiaok-migration-backup.mjs` 已调整：

- 默认优先 `sfp_backup`；
- 仅接受 `sfp_backup` 与 `sfp_owner` 两个明确批准的用户名，不接受任意用户名；
- `sfp_owner` 兼容路径必须显式开启风险确认：`--allow-legacy-owner` 或 `XIAOK_MIGRATION_ALLOW_LEGACY_OWNER=1`；
- `sfp_backup` 若实际为 SUPERUSER，直接拒绝（`least_privilege_backup_role_must_not_be_superuser`）；
- 旧 `sfp_owner` 若为 SUPERUSER，未确认时拒绝（`superuser_backup_requires_explicit_confirmation`）；
- 任何模式都要求 BYPASSRLS 或已确认的旧路径，并要求 schema USAGE、全表 SELECT、全序列 SELECT；
- Manifest 记录 `backupRole.name`、`profile`、`rolsuper`、`rolbypassrls`、`rolcreatedb`、`rolcreaterole`、`rolreplication`、`legacyOwnerRiskConfirmed`、`superuserConfirmed`、覆盖检查结果；
- 不记录密码、连接串或密钥；
- 子进程环境继续清理 `DATABASE_URL`、`DATABASE_MIGRATION_URL`、`XIAOK_MIGRATION_BACKUP_URL`、`XIAOK_MIGRATION_RESTORE_URL`；
- 恢复工具仍使用独立维护连接，不继承备份账号权限。

## 8. 备份目录安全预检

工具现在在创建备份前检查输出目录：

- 必须已存在；
- 不得位于仓库内；
- 目录所有者不得是 Everyone/Authenticated Users；
- Windows ACL 中 `Authenticated Users`/`Everyone` 不得具有 Modify/FullControl/Write/CreateFiles/AppendData/Delete；
- POSIX 目录不得 group/world writable；
- 可用空间不得低于阈值（默认 512 MiB，可用 `--min-free-bytes` 或 `XIAOK_MIGRATION_MIN_FREE_BYTES` 调整）。

任一项失败即 `blocked`，不会创建临时目录或备份文件。

实际结果：

- 合成安全目录（仅 Administrator/SYSTEM）通过；
- `Everyone:(M)` 测试目录被拒绝；
- 仓库内目录被拒绝；
- 1 TB 空间阈值测试被拒绝；
- 真实 `admin/.postgres-backups` 的 ACL 含 `Authenticated Users: Modify`，不可用于正式迁移备份；
- G: 当前可用约 0.08 GB，默认目录空间不足；
- C: 可用约 31 GB，需创建独立受限目录。

## 9. 真实开发库状态与所需审批

真实 `smart_floor_planner`：

- 未创建 `sfp_backup`；
- 未修改 `sfp_owner`；
- 未修改任何角色、权限、表、序列或账本；
- 未执行 `pg_dump`、`db:migrate` 或生产部署。

创建真实 `sfp_backup` 需要负责人单独批准：

1. 批准创建 `sfp_backup`（LOGIN、NOSUPERUSER、BYPASSRLS、NOCREATEDB、NOCREATEROLE、NOREPLICATION）。
2. 批准 `CONNECT`、`app` schema `USAGE`、现有全部表/序列 SELECT。
3. 批准由 `sfp_migrator`（或受控超级用户）设置默认 SELECT 权限。
4. 批准通过受控密钥存储设置密码，禁止写入仓库/日志/Manifest。
5. 确认 `sfp_backup` 不加入任何业务连接池、不进入应用运行环境。
6. 确认是否保留 `sfp_owner` 兼容路径；若保留，必须书面接受 SUPERUSER 风险并使用显式开关。
7. 批准在 C: 或其他受控卷创建独立受限备份目录。

## 10. 测试与回归

| 项 | 结果 |
| --- | --- |
| `xiaok-migration-backup.test.mjs` | 16 passed / 0 skipped |
| `xiaok-migration-restore-verify.test.mjs` | 9 passed / 0 skipped |
| 迁移器定向测试 | 18 passed / 7 skipped（无 pgvector 的数据库用例按设计跳过） |
| TypeScript | 通过 |
| 定向 ESLint | 0 errors / 0 warnings |

测试使用隔离 PG17 合成数据；未连接真实 `smart_floor_planner`。
