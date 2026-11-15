# I7.4.9.5 微云 1454 真实开发库备份执行前最终安全核验与执行方案

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`e4cbd6a7a1ca`
> 日期：`2026-11-15`（Asia/Shanghai）
> 本轮只读；未执行真实 `pg_dump`，未执行迁移，未修改数据库或角色。
>
> 状态必须分开记录：
> - `backup_preflight = blocked`（能力通过，执行条件未满足）
> - `backup_execution = not_run`
> - `restore_verification = not_run`
> - `migration_execution = not_run`
>
> **I7.4.9.6 更新**：最小权限 `sfp_backup` 已在隔离 PG17 验证通过；正式备份默认使用 `sfp_backup`，`sfp_owner` 仅保留为必须显式开启风险开关的兼容路径。真实开发库尚未创建 `sfp_backup`，详见 [I7.4.9.6 最小权限备份角色](./xiaok-i796-least-privilege-backup-role.md)。
>
> **I7.4.9.7 更新**：已准备正式授权 SQL、只读验收工具 `npm run check:backup-role` 和安全目录脚本。真实角色仍未创建，详见 [I7.4.9.7 角色创建方案](./xiaok-i797-backup-role-provisioning.md)。

## 1. 结论

**微云 1454 当前尚不具备直接执行真实备份的完整条件。** 数据库身份、PostgreSQL 版本、账本、通知配置、备份账号读取能力、写入静默状态均通过只读核验；但存在两个执行前置阻断：

1. **缺少已批准的 `sfp_backup` 凭据**：`.env.local` 只有 `DATABASE_URL`（`sfp_app`）和 `DATABASE_MIGRATION_URL`（`sfp_migrator`），没有 `XIAOK_MIGRATION_BACKUP_URL`，也没有 `XIAOK_MIGRATION_RESTORE_URL`。迁移备份工具默认要求 `sfp_backup` 的完整 URL；当前无法认证，也不能运行工具。`sfp_owner` 兼容路径存在，但必须显式开启风险开关。
2. **默认备份目录空间不足且权限过宽**：默认 `admin/.postgres-backups` 位于 G:，当前可用约 **0.08 GB**；数据库约 **251 MB**，不足以安全生成 archive 和 Manifest。该目录 ACL 还包含 `Authenticated Users: Modify`、`BUILTIN\Users: ReadAndExecute`，不适合保存迁移前备份。此外，工具现在会拒绝位于仓库内的目录。
3. **真实 `sfp_backup` 尚未创建**：隔离验证已通过，但真实角色、授权、密码和默认权限需要负责人单独批准。

补充安全风险：真实 `sfp_owner` 当前是 **superuser + BYPASSRLS**。它具备完整备份能力，但超出最小权限。新计划优先使用 `sfp_backup`；保留 `sfp_owner` 时必须书面接受 SUPERUSER 风险并显式开启 `--allow-legacy-owner`。

在补齐“批准凭据 + 专用受限目录”后，技术条件即具备；准确命令与窗口顺序见下文。

## 2. 真实库身份与账本核验

只读连接获批开发目标 `127.0.0.1:5432/smart_floor_planner`，账号 `sfp_app`，事务只读并在结束时 `ROLLBACK`。

| 项 | 实测 |
| --- | --- |
| 数据库 | `smart_floor_planner` |
| 业务账号 | `sfp_app`（`rolsuper=false`、`rolbypassrls=false`、`rolcanlogin=true`） |
| PostgreSQL | `17.10 (Debian 17.10-1.pgdg12+1)`，`server_version_num=170010` |
| 服务端 | `172.18.0.2:5432`（经已批准隧道） |
| 数据库大小 | `251 MB`（`263,689,907` bytes） |
| 账本条数 | **119** |
| 账本 id | `1–125`（0021 id `28`，0051 id `58`） |
| 账本摘要 | `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381` |
| 0021 | `1786540800000` / `9df6e11e9638ce3c44a907161391ba873736e3155fe875f6d530247c5ad8ab5c` |
| 0051 | `1788184800000` / `a41ef104297b2d5f15bc7728c2d4f3805600fdb709235fa95c5e61d11824939e` |
| 校验 | `validateLedger` 通过；无重复 timestamp、无 prefix gap、无 Mixed fork |
| pending | 9 条：`0120`、`0124`–`0131` |

`notification_config`：

- 行数 9，NULL 行 **8**；
- 列 `jsonb`、可空、无默认值；
- `default` 行 version `2`、8 个模板、无 `subscriptionMessagesEnabled`/旧字段；
- default 配置文本 SHA-256：`e34a0f6aba807167be3d0b0f5cba9b17be7ce948c9a9da906e158d81bc7d6a52`；
- 8 个模板指纹与当前代码默认值一致（`f69746265857`、`e9180ff7fb37`、`cae3683a65ea`、`99f48d91511e`、`c74a7ec2bbfe`、`5c8bf375d406`、`14bb31ab667c`、`ce3bf55e1c3c`）。

## 3. 备份账号现状与目标

当前真实库的备份候选仍是 `sfp_owner`（下表为实测）；目标账号是隔离环境已验证的 `sfp_backup`。真实 `sfp_backup` 尚未创建。

| 项 | `sfp_owner` 实测 | 结论 |
| --- | --- | --- |
| `rolcanlogin` | `true` | 通过 |
| `rolsuper` | **`true`** | 能力通过，但超出最小权限 |
| `rolbypassrls` | `true` | 可跨 FORCE RLS 读取 |
| app schema `USAGE` | `true` | 通过 |
| 业务表读取 | 174 张表，缺少 SELECT **0** | 通过 |
| 序列读取 | 146 个序列，缺少 SELECT **0** | 通过 |
| 认证 | 无已批准 `sfp_owner` URL | **未验证/阻断** |

真实库当前 RLS 结构：**153 张 RLS/FORCE RLS 表、208 条 Policy**（迁移后完整结构为 167/222，属于后续状态，不能用于本次备份前置数量）。

`sfp_owner` 具备完整导出能力，但：

- 真实 `sfp_owner` 是 superuser，建议改用 `sfp_backup`（非 superuser、BYPASSRLS、全表/全序列 SELECT，隔离环境已验证）；
- 在 `sfp_backup` 创建并注入凭据前，`backup_preflight` 不能标记为通过；
- 若负责人书面接受 SUPERUSER 风险，可用 `--allow-legacy-owner` 走兼容路径，Manifest 会记录 `profile=legacy_owner` 与 `superuserConfirmed`。

## 4. 备份工具与参数

| 项 | 实测/结论 |
| --- | --- |
| 迁移备份工具 | `admin/scripts/xiaok-migration-backup.mjs`（`npm run db:migration-backup`） |
| 正式格式 | PostgreSQL custom archive，**不使用** `--no-owner`/`--no-privileges` |
| 普通备份工具 | `postgres-backup.mjs` 使用 `--no-owner`/`--no-privileges`，**禁止用于本次迁移备份** |
| 本地 `pg_dump` | `17.10` |
| 本地 `pg_restore` | `17.10` |
| 远端开发容器 | `sfp-remote-dev-postgres`，镜像 `pgvector/pgvector:0.8.2-pg17`，`127.0.0.1:15432->5432` |
| 容器内 `pg_dump`/`pg_restore` | `17.10 (Debian 17.10-1.pgdg12+1)` |
| `POSTGRES_BACKUP_DATABASE` | 未设置；旧工具默认 `smart_floor_planner` |
| `POSTGRES_BACKUP_USER` | 未设置；旧工具默认 `sfp_owner`；新工具默认 `sfp_backup` |
| `POSTGRES_DOCKER_SERVICE` | 未设置；旧工具默认 `postgres`，本机无该 Compose 服务 |
| `XIAOK_MIGRATION_BACKUP_URL` | **未设置** |
| `XIAOK_MIGRATION_RESTORE_URL` | **未设置** |
| `XIAOK_MIGRATION_ALLOW_LEGACY_OWNER` | 未设置；仅 `sfp_owner` 兼容路径需要 |
| `XIAOK_MIGRATION_MIN_FREE_BYTES` | 未设置；默认 512 MiB |
| 默认输出目录 | `admin/.postgres-backups`（G:），位于仓库内且可用 **0.08 GB**，工具会直接拒绝 |
| 候选输出目录 | `C:` 可用约 **31 GB**，需新建受限目录 |
| 现有目录 ACL | `Authenticated Users: Modify`、`BUILTIN\Users: ReadAndExecute`，过宽 |

说明：真实开发库实际是远端 `sfp-remote-dev-postgres` 容器，经 SSH 隧道映射到本机 `127.0.0.1:5432`。迁移备份工具按直接连接运行，不使用旧工具的本地 Compose 服务名；这也是必须使用 `xiaok-migration-backup.mjs` 而不是 `postgres-backup.mjs` 的原因之一。

## 5. 写入静默与维护窗口现状

| 检查 | 实测 |
| --- | --- |
| Assistant Worker 进程 | 0 个 |
| Worker 健康文件 | 最后成功 `2026-11-15 00:58:41`，约 17.9 小时前，`stale` |
| 本机 3006/3016 监听 | 无 |
| 5432 监听 | 仅已批准 SSH 隧道 |
| 数据库活动连接 | 除本次只读连接外无其他会话 |
| 长事务/idle in transaction | 无 |
| 正在执行的 DDL | 无 |
| app 表锁 | 仅本次只读事务的 AccessShare |
| 远端 app 容器 | 未发现 admin/smart/floor/assistant/xiaok 应用容器 |
| Windows 计划任务 | 未发现 smart/floor/assistant/xiaok/sfp 任务 |
| Outbox | 0 行 |
| 提醒/暂停表 | 不存在（`0128` 未应用） |
| Pilot Scope 表 | 不存在（`0130` 未应用） |
| 周报 | `construction_reports` 0 行，`construction_report_deliveries` 无记录 |
| Assistant Jobs | 0 行 |
| `domain_event_deliveries` | 无记录 |

当前现场没有观察到写入者，但**维护窗口仍必须做最终静默确认**，因为远端其他主机/临时应用可能随时接入。

需要暂停/确认的服务（按顺序）：

1. 所有业务写入入口（Web/API、管理端 PATCH、批量脚本）。
2. Assistant Worker、提醒扫描、周报生成、Outbox 消费者。
3. 任何外部定时器/人工导入任务。
4. 只读监控可保留；确认 `pg_stat_activity` 无业务会话、无长事务、无 DDL。

恢复顺序：

1. 数据库迁移与迁移后备份/恢复验证完成。
2. 启动受管 Worker，确认进程与心跳。
3. 恢复提醒/周报调度与 Outbox 消费。
4. 恢复业务写入入口。
5. 最后恢复微信通知开关；窗口内不得发送真实通知。

## 6. 执行前置条件

`backup_preflight` 需同时满足：

1. 负责人批准本次备份窗口和账号使用方式。
2. 负责人批准创建真实 `sfp_backup`（LOGIN、NOSUPERUSER、BYPASSRLS、NOCREATEDB、NOCREATEROLE、NOREPLICATION），并批准 CONNECT、`app` schema USAGE、现有全部表/序列 SELECT 与默认 SELECT 权限。
   - 正式 SQL：`admin/scripts/sql/xiaok-create-backup-role.sql`
   - 执行示例（待批准，本轮不执行）：
     ```powershell
     psql -h 127.0.0.1 -p 5432 -U postgres -d smart_floor_planner `
       -v ON_ERROR_STOP=1 -v backup_database=smart_floor_planner `
       -f admin/scripts/sql/xiaok-create-backup-role.sql
     # 再交互式设置密码，禁止写入命令行/仓库：
     # \password sfp_backup
     ```
   - 授权后运行只读验收：
     ```powershell
     $env:XIAOK_BACKUP_ROLE_CHECK_URL = '<approved sfp_app URL>'
     npm run check:backup-role
     ```
     必须 `status=passed`，否则不得备份。
3. 从受控密钥存储注入 `XIAOK_MIGRATION_BACKUP_URL`：`postgresql://sfp_backup:<secret>@127.0.0.1:5432/smart_floor_planner`；不得写入仓库、日志或文档。
4. 注入 `XIAOK_MIGRATION_RESTORE_URL`（批准的维护连接 `/postgres`，用于创建/删除一次性恢复库）；如不批准，恢复验证不能执行。
5. 在 C: 或其他有足够空间的受控卷创建专用目录（建议至少 10 GB 可用），并收紧 ACL：
   ```powershell
   $dir = 'C:\sfp-backups\i795-20261115'
   New-Item -ItemType Directory -Force -Path $dir | Out-Null
   icacls $dir /inheritance:r /grant:r "Administrator:(OI)(CI)F" "SYSTEM:(OI)(CI)F"
   ```
   工具会拒绝仓库内目录、`Authenticated Users`/`Everyone` 可写目录和空间不足目录。
6. 确认 `pg_dump`/`pg_restore` 为 17.10，数据库为 17.10，目标目录空间足够。
7. 确认 `sfp_backup` 能力为：可登录、非 superuser、BYPASSRLS、全表/全序列 SELECT；若负责人坚持 `sfp_owner` 兼容路径，必须书面接受 SUPERUSER 风险并显式开启 `--allow-legacy-owner`。
8. 完成一次窗口内最终静默检查：无其他会话、无长事务、无 DDL、Outbox/Jobs/Reports 无新增。

## 7. 正式备份命令（待批准后执行，本轮不执行）

```powershell
# 仅从受控密钥存储注入，禁止写入仓库或日志
$env:XIAOK_MIGRATION_BACKUP_URL = '<approved sfp_backup URL>'
$env:PG_BIN = 'C:\pg17bin\pgsql\bin'

npm run db:migration-backup -- `
  --mode development `
  --database smart_floor_planner `
  --output-dir C:\sfp-backups\i795-20261115 `
  --pg-bin C:\pg17bin\pgsql\bin
```

约束：

- 开发模式只接受 `127.0.0.1:5432/smart_floor_planner`、`sfp_backup`（默认）或显式风险确认的 `sfp_owner`、非 production；
- 工具在 `pg_dump` 前检查角色属性、全表/全序列 SELECT、schema USAGE；`sfp_backup` 若为 SUPERUSER 直接拒绝；
- 工具检查输出目录存在、不在仓库内、ACL 不含 Authenticated Users/Everyone 写权限、空间不低于阈值；失败时不创建任何备份文件；
- 工具使用 custom archive，**不添加** `--no-owner`/`--no-privileges`；
- 工具会生成 `database.dump`、`database.dump.sha256`、`migration-backup-manifest.json`；
- 成功时 Manifest 账本应为 **119** 条（迁移前），`latestMigration` 应为 `0119_platform_portfolio_templates`，0021/0051 历史 SHA 精确记录，0131 尚不存在；
- 不得用 `db:backup`/`postgres-backup.mjs` 替代。

## 8. Manifest、SHA 与 `pg_restore --list` 验证

```powershell
$backup = 'C:\sfp-backups\i795-20261115\<backupId>'
$manifest = Get-Content "$backup\migration-backup-manifest.json" -Raw | ConvertFrom-Json
$manifest.backupStatus                  # complete
$manifest.migrationLedgerCount          # 119
$manifest.migrationLedgerDigest         # 与当前 119 条摘要比对
$manifest.latestMigration.tag           # 0119_platform_portfolio_templates
$manifest.historicalHashes              # 0021/0051 完整 SHA + matchesAllowlist
$manifest.backupRole.name               # sfp_backup
$manifest.backupRole.profile            # least_privilege
$manifest.backupRole.rolsuper           # false
$manifest.backupRole.rolbypassrls       # true
$manifest.restoreListVerified           # true
$manifest.archive.ownerMode             # full
$manifest.archive.privilegesMode        # full

$actual = (Get-FileHash "$backup\database.dump" -Algorithm SHA256).Hash.ToLower()
$shaFile = (Get-Content "$backup\database.dump.sha256" -Raw).Split(' ')[0].ToLower()
if ($actual -ne $manifest.backupSha256 -or $actual -ne $shaFile) { throw 'SHA mismatch' }

& C:\pg17bin\pgsql\bin\pg_restore.exe --list "$backup\database.dump" | Select-Object -First 20
```

任一不一致即停止，不得进入迁移。

## 9. 独立恢复验证命令（待批准后执行，本轮不执行）

前提：`XIAOK_MIGRATION_RESTORE_URL` 为批准的维护连接（可创建/删除一次性数据库，且能跨 FORCE RLS 读取）。目标库名与源库不同，且必须是可丢弃库。

```powershell
$env:XIAOK_MIGRATION_RESTORE_URL = '<approved maintenance URL to /postgres>'
$env:PG_BIN = 'C:\pg17bin\pgsql\bin'

npm run db:migration-restore-verify -- `
  --manifest C:\sfp-backups\i795-20261115\<backupId>\migration-backup-manifest.json `
  --target-database xiaok_migration_restore_i795 `
  --mode development `
  --pg-bin C:\pg17bin\pgsql\bin `
  --keep-target
```

验收：

- `full_restore_passed=true`，且 `schema_restore_passed`、`data_restore_passed`、`ledger_verified`、`rls_verified`、`permissions_verified` 全部 true；
- 恢复账本 **119** 条，0021/0051 历史 SHA 不变；
- 0131 **不存在**（迁移前备份）；
- `notification_config` 8 行 NULL、列可空、无默认值，default 配置文本 SHA `e34a0f6a…bc7d6a52` 与源库一致；
- 153 张 FORCE RLS 表、208 条 Policy、权限摘要一致；
- 验证后删除一次性目标库；不得恢复到源库。

## 10. 迁移前后内容保护

迁移前备份与恢复验证必须保存/比对：

```sql
SELECT key, md5(notification_config::text) AS digest
FROM app.platform_configs
WHERE notification_config IS NOT NULL
ORDER BY key;
```

- 原 9 行中仅 1 行为非空；其文本和模板不得变化；
- 8 行 NULL 只能由 0131 回填；
- 任何非空配置变化都停止迁移并报告。

## 11. 失败处理

### 备份失败

- 工具失败会清理临时目录，不产生可发布 Manifest；
- 不得删除上一个已验证备份；
- 保留失败输出，修复后重新执行；
- 不得在备份失败时进入恢复或迁移。

### 恢复失败

- 恢复验证器默认删除一次性目标库；`--keep-target` 仅用于取证；
- 源库不被修改；
- 若 `full_restore_passed=false`，不得进入迁移；
- 不得用 `pg_restore` exit 0 代替完整验证。

## 12. 维护窗口执行顺序

1. **冻结**：通知业务方，停止写入入口、Worker、提醒/周报/Outbox 消费和外部定时任务。
2. **静默确认**：检查 `pg_stat_activity`、长事务、DDL、Outbox/Jobs/Reports、锁；确认无业务会话。
3. **前置检查**：确认 PG17、账本 119、0021/0051、8 行 NULL、备份账号能力、凭据注入、C: 空间和 ACL。
4. **备份**：执行第 7 节命令；验证 Manifest/SHA/`pg_restore --list`；复制到第二存储。
5. **恢复验证**：执行第 9 节命令；要求 `full_restore_passed=true`；删除一次性目标库。
6. **迁移（另需授权）**：先 `0120`–`0130`，验证后再 `0131`；核对 128 条账本、0021/0051、0131、RLS/Policy、default 配置。
7. **迁移后备份**：再次执行迁移备份与恢复验证；此时期望 128 条账本、0131 存在、`notification_config` NOT NULL 0 NULL。
8. **恢复服务**：启动受管 Worker → 确认心跳 → 恢复提醒/周报/Outbox → 恢复业务写入 → 最后恢复微信通知开关。
9. **观察**：检查 Outbox、Jobs、Reports、提醒投递与心跳；窗口内不发送真实通知。

## 13. 当前状态汇总

| 标记 | 状态 | 说明 |
| --- | --- | --- |
| `backup_preflight` | **blocked** | 能力通过；真实 `sfp_backup` 尚未创建、凭据缺失、默认磁盘不足、目录 ACL 过宽 |
| `backup_execution` | `not_run` | 本轮禁止真实 `pg_dump` |
| `restore_verification` | `not_run` | 依赖备份与维护凭据 |
| `migration_execution` | `not_run` | 另行授权；本轮只读 |

真实 1454 未备份、未迁移、未修改账本、未修改角色、未停止 Worker、未修改 Outbox、未发送通知、未部署生产。
