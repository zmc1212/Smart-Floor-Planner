# I7.4.9.1 迁移专用备份与独立恢复验证

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`47304b7dc65a`
> 日期：`2026-11-15`（Asia/Shanghai）
> 结论：**迁移专用备份工具与独立恢复验证已在隔离 PG17.10 闭环通过；未对 `smart_floor_planner` 执行 `pg_dump`，未执行迁移，未修改微云 1454。**

## 1. 范围与边界

本轮新增：

- `admin/scripts/xiaok-migration-backup.mjs`：迁移专用 custom archive、独立 SHA-256、`migration-backup-manifest.json`。
- `admin/scripts/xiaok-migration-restore-verify.mjs`：仅恢复到独立可丢弃数据库，并按源库 Manifest 校验。
- `admin/scripts/__tests__/xiaok-migration-backup.test.mjs`、`xiaok-migration-restore-verify.test.mjs` 及隔离夹具。
- `admin/package.json`：`db:migration-backup`、`db:migration-restore-verify`、`test:migration-backup`。

保留 `admin/scripts/postgres-backup.mjs`、`postgres-restore-drill.mjs` 原行为不变，普通备份调用方不受影响。

未执行：对真实开发库导出、`db:migrate`、账本写入、`notification_config` 修改、真实角色 `BYPASSRLS` 授权、企业配置修改、Worker 启动、真实通知、生产部署。本轮验证只使用本机隔离 PG17.10 与合成企业/数据；合成源的 127 条账本由正式迁移器在隔离可丢弃库内构建，未对 `smart_floor_planner` 运行迁移。

## 2. 数据库身份验证

备份工具在导出前必须同时满足：

1. `development` 模式：`NODE_ENV !== production`，URL 协议为 `postgres:`/`postgresql:`，主机仅 `localhost`/`127.0.0.1`/`::1`，端口 `5432`，数据库 `smart_floor_planner`，用户 `sfp_owner`，密码存在，无 query/hash。
2. `isolated` 模式：仅回环地址；端口为动态私有端口（`>=49152`），且显式拒绝 `5432` 与既有共享隔离端口 `55432`；数据库名必须匹配 `^xiaok_i749_[a-z0-9_]{1,40}$`；数据库注释必须是 `xiaok-i749-backup-sandbox`，集群 `postgres` 库注释必须是 `xiaok-i749-isolated-test`。
3. 连接后复核 `current_database()`、`current_user`、`session_user`、`server_version_num`、`pg_is_in_recovery()` 与角色属性；数据库或角色不一致立即失败。
4. PostgreSQL 版本必须为 17（`170000 <= version_num < 180000`）。
5. `pg_dump`/`pg_restore` 客户端主版本必须为 17，并写入 Manifest。

隔离标记是测试专用保护：真实开发库没有这些注释，`isolated` 模式无法指向它；`development` 模式又只接受已批准的库名、角色和端口。

## 3. 备份格式

成功备份目录为 `outputDir/<backupId>/`，包含且仅包含：

| 文件 | 说明 |
| --- | --- |
| `database.dump` | PostgreSQL custom archive（`--format=custom --compress=6`），保留 owner 与 ACL（未使用 `--no-owner`/`--no-privileges`） |
| `database.dump.sha256` | 独立 SHA-256 文本，格式 `<64 hex>  database.dump` |
| `migration-backup-manifest.json` | 迁移专用 Manifest |

`backupId` 形如 `xiaok-mig-20261115t090732400z-961ba61f`。目录先在 `.tmp-<backupId>-<random>` 中完整写完，再原子重命名发布；任何失败都会删除临时目录，不产生半成品，也不覆盖既有已验证备份。

`pg_dump` 走 stdout 流式写文件，`pg_restore --list`/恢复走 stdin，避免 PostgreSQL 客户端处理含中文的工作区路径。

## 4. Manifest 格式

Manifest 至少包含（实际实现还记录 schema、RLS、权限和数据摘要）：

`backupId`、`createdAt`、`sourceDatabase`、`sourceHost`、`postgresqlVersion`、`postgresqlVersionNumber`、`backupRole`、`migrationLedgerCount`、`migrationLedgerDigest`、`migrationLedgerLastId`、`migrationLedgerLastTimestamp`、`backupBytes`、`backupSha256`、`pgDumpVersion`、`pgRestoreVersion`、`restoreListVerified`、`backupStatus`。

补充字段：

- `backupRole`：`name`、`rolsuper`、`rolbypassrls`、`rolcanlogin`、`fullReadProof`、表/序列 `SELECT` 覆盖、schema `USAGE`。
- `historicalHashes`：0021/0051 的账本 ID、timestamp、实际 SHA-256 与白名单匹配结果。
- `rls`：`rlsTableCount`、`forcedRlsTableCount`、RLS 表名列表、FORCE RLS 表名列表。
- `policies` / `functions` / `triggers`：数量与定义摘要。
- `schemaObjects`：列、约束、索引的数量与摘要（约束摘要见 §11 限制）。
- `extensions`：扩展名、版本与摘要。
- `permissions`：schema/关系/函数 owner 与 ACL 摘要。
- `dataSummary`：每张 `app` 叶子表的行数与内容摘要。
- `relations`：`app` schema 表/分区父表清单。
- `manifestDigest`：对除自身外的规范化 JSON 计算 SHA-256，用于检测 Manifest 被改动。

Manifest 不记录密码、连接字符串、密钥或 token。备份工具会递归拒绝名为 `password`、`secret`、`token`、`credential`、`connectionString`、`url`、`dsn` 的键。

## 5. 备份账号权限与 RLS 完整性

备份角色必须同时满足：

- `rolcanlogin = true`；
- `rolsuper = true` 或 `rolbypassrls = true`，否则以 `backup_role_missing_bypass_rls` 失败关闭；
- 对 `app` schema 有 `USAGE`；
- 对全部 `app` 表有 `SELECT`；
- 对全部 `app` 序列有 `SELECT`。

缺少任一权限时，工具在启动 `pg_dump` 前失败并列出缺失对象；不会通过授予 `BYPASSRLS` 绕过，也不会把不完整权限当作成功。

RLS 完整性三重保障：

1. 角色必须具备 `BYPASSRLS` 或 superuser，证明可跨 FORCE RLS 读取全部租户；
2. `pg_dump` 自身在 `row_security=off` 下遇到无绕过权限的 RLS 表会报错而非静默少导；
3. Manifest 记录源库每张非空叶子表的行数，并用 `pg_restore --list` 核对 archive 中每张非空表都有 `TABLE DATA` 条目；缺失即失败。

## 6. 恢复验证

`xiaok-migration-restore-verify.mjs` 只接受：

- 目标库名 `^xiaok_migration_restore_[a-z0-9_]{1,40}$`；
- 目标库名不等于 Manifest 的 `sourceDatabase`；
- `isolated` 模式下集群必须带隔离标记；`development` 模式下目标库必须带 `xiaok-migration-restore-disposable` 注释；
- 目标库为独立可丢弃库，工具在恢复前删除并重建，默认验证后删除；`--keep-target` 可保留。

恢复使用 `pg_restore --single-transaction --exit-on-error`，保留 owner/ACL。验证角色必须是 superuser 或 `BYPASSRLS`，否则以 `verification_role_cannot_read_all_tenants` 失败关闭。恢复过程不连接源数据库，源库不被修改。

校验顺序与结果：

| 检查 | 实现 |
| --- | --- |
| A Manifest 格式 | JSON 解析 + 必填字段/类型/禁止键校验 |
| B SHA-256 一致 | 独立 `.sha256` 与 Manifest 一致，且实际归档摘要一致 |
| C `pg_restore --list` | exit 0，TOC 非空，非空表均有 `TABLE DATA` |
| D 版本兼容 | Manifest、`pg_restore`、目标服务端均为主版本 17 |
| E 账本 | 恢复后条数、JSON 摘要、末条 ID/timestamp 与 Manifest 一致 |
| F 0021/0051 | 历史 SHA 精确等于白名单，且 `matchesAllowlist=true` |
| G 账本条数 | 恢复账本与 Manifest 一致（本轮合成源为 127 条） |
| H 业务表 | 每张叶子表行数与内容摘要一致 |
| I FORCE RLS | RLS/FORCE RLS 表名列表与数量一致 |
| J Policy | 数量与定义摘要一致 |
| K 权限/函数/触发器 | owner/ACL 摘要、函数与触发器数量/摘要、扩展一致 |
| L 不修改源库 | 验证器不连接源库；测试对比源账本前后摘要不变 |

输出中显式区分：

- `schema_restore_passed`
- `data_restore_passed`
- `ledger_verified`
- `rls_verified`
- `permissions_verified`
- `full_restore_passed`

`full_restore_passed` 仅在以上全部为 true 且恢复 exit 0、版本兼容、TOC 完整时为 true。**不会仅凭 `pg_restore` exit 0 宣称完整恢复成功。** 若 archive 由 `--no-owner`/`--no-privileges` 生成，Manifest 的 `archive.ownerMode`/`privilegesMode` 不为 `full`，`permissions_verified` 与 `full_restore_passed` 均为 false。

## 7. 隔离 PG17 真实测试

环境：本机可丢弃 PostgreSQL `17.10`（`127.0.0.1:55435`，非 `5432`/`55432`），`postgres` 库注释 `xiaok-i749-isolated-test`；`pg_dump`/`pg_restore` `17.10`。合成源库使用正式迁移文件构建 127 条账本，0021/0051 按批准的历史 SHA 写入，企业 1454/1455 与项目、会话、消息、提醒均为合成数据。

| # | 场景 | 结果 |
| --- | --- | --- |
| 1 | 正常备份 | 通过：custom archive 非空，Manifest `complete` |
| 2 | 正常生成 Manifest | 通过：必填字段、账本、RLS、数据摘要齐全 |
| 3 | SHA 正确 | 通过：独立 SHA 文件、Manifest、实际归档三者一致 |
| 4 | SHA 被修改 | 通过：`sha256_manifest_mismatch`，拒绝恢复 |
| 5 | Manifest 被修改 | 通过：`manifest_digest_mismatch`，拒绝恢复 |
| 6 | archive 损坏 | 通过：未更新 SHA 时 `sha256_archive_mismatch`；重算 SHA 后 `restore_list_failed`/`restore_failed`，均拒绝恢复 |
| 7 | 恢复后账本摘要一致 | 通过：127 条，digest、末条 ID/timestamp 一致 |
| 8 | RLS 和 Policy 保持 | 通过：167 张 FORCE RLS 表、222 条 Policy，列表与摘要一致 |
| 9 | 不完整权限备份失败 | 通过：`sfp_app` 触发 `backup_role_missing_bypass_rls`，未产生目录 |
| 10 | 恢复目标等于源库 | 通过：`target_same_as_source`，拒绝 |
| 11 | 重复恢复可预测 | 通过：连续两次 `full_restore_passed=true`，源账本摘要不变 |
| 12 | 中途失败不覆盖已验证备份 | 通过：撤销 `sfp_owner` 对一张表的 `SELECT` 后失败；另以无效 `PGOPTIONS` 使 `pg_dump` 启动后失败。两种情况原目录与文件摘要均不变，无 `.tmp-*` |

补充场景：Manifest 版本改为 16.9 后 `database_version_incompatible` 拒绝；恢复目标默认在验证后被删除。

测试命令（环境变量仅在本机设置，不写入仓库）：

```powershell
$env:XIAOK_I749_PG_URL = 'postgresql://postgres:<local-only>@127.0.0.1:55435/postgres'
$env:XIAOK_I749_OWNER_PASSWORD = '<local-only>'
$env:XIAOK_I749_MIGRATOR_PASSWORD = '<local-only>'
$env:XIAOK_I749_APP_PASSWORD = '<local-only>'
$env:XIAOK_I749_AUDITOR_PASSWORD = '<local-only>'
$env:PG_BIN = 'C:\pg17bin\pgsql\bin'
node --test scripts/__tests__/xiaok-migration-backup.test.mjs scripts/__tests__/xiaok-migration-restore-verify.test.mjs
```

结果：**20 passed / 0 failed / 0 skipped**（11 备份、9 恢复）。

## 8. 权限恢复方式

- 备份不使用 `--no-owner`/`--no-privileges`，custom archive 含 owner 与 ACL。
- 恢复在同一隔离集群执行，`sfp_migrator`/`sfp_app`/`sfp_auditor`/`sfp_owner` 角色存在；`pg_restore --single-transaction --exit-on-error` 对缺失角色/ACL 直接报错，不会静默降级。
- 恢复后对比 `app` schema、关系、函数的 owner/ACL 摘要；同时核对列、约束、索引、函数、触发器、扩展摘要。
- 真实开发库演练时，恢复目标必须是同版本 PG17 且存在同名角色；否则 `permissions_verified=false`，`full_restore_passed=false`，必须补齐角色后重做，而不是接受“结构恢复成功”。

## 9. 失败场景

已覆盖并验证：

- 未批准目标、生产环境、错误库名/角色/端口/主机；
- 非 PG17 或非 17 客户端；
- 备份角色非 superuser 且非 `BYPASSRLS`；
- 缺少表/序列 `SELECT` 或 schema `USAGE`；
- 账本无法通过正式校验器（未知迁移、重复 timestamp、前缀缺口、混合 fork、委托结构不符）；
- `pg_dump` 失败、空归档、TOC 缺表数据；
- Manifest 格式/摘要被改动、SHA 文件缺失或与 Manifest/归档不一致；
- 归档损坏、恢复目标等于源库、目标未标记可丢弃、隔离标记缺失、版本不兼容；
- 恢复后 schema/数据/账本/RLS/Policy/权限任一不一致。

## 10. 本轮验收状态

| 标记 | 结果 | 证据 |
| --- | --- | --- |
| `schema_restore_passed` | **true** | 表清单、列、约束、索引、函数、触发器、扩展摘要与 Manifest 一致 |
| `data_restore_passed` | **true** | 187 张叶子表行数与内容摘要一致，合成业务行 14 行 |
| `ledger_verified` | **true** | 127 条，digest `0a78ce2e…a90a0a91`（合成源），0021/0051 历史 SHA 精确命中 |
| `rls_verified` | **true** | 167 张 RLS/FORCE RLS 表，222 条 Policy，列表与摘要一致 |
| `permissions_verified` | **true** | owner/ACL 摘要一致，owner 角色 `sfp_migrator` 存在 |
| `full_restore_passed` | **true** | 上述全部通过，恢复 exit 0，版本兼容，TOC 完整 |

**注意：以上 true 仅针对隔离合成库，不代表已经为 `smart_floor_planner` 生成或验证过备份。**

## 11. 未解决问题与限制

1. **尚未对真实开发库生成备份。** 本轮禁止对 `smart_floor_planner` 执行 `pg_dump`；正式迁移前仍需在批准窗口内、写入静默时运行 `db:migration-backup`，并对真实归档执行 `db:migration-restore-verify`。
2. **CHECK 约束摘要做了括号归一化。** `pg_dump`/`pg_restore` 后 PostgreSQL 渲染 CHECK 的冗余括号会变化；为跨库比较，约束摘要对 CHECK 表达式去掉空白与括号后计算，同时保留约束名、类型、验证状态与列清单。该摘要能发现缺失/改名/列变化，但不是 CHECK 语义等价的数学证明。
3. **Manifest 与 SHA 文件是完整性校验，不是数字签名。** 能检测意外损坏或普通篡改，不能抵御同时改写归档、SHA、Manifest 与 `manifestDigest` 的恶意行为。生产归档应放在受控存储并另行记录哈希。
4. **数据摘要在导出前读取、`pg_dump` 在另一快照导出。** 工具未使用 `--serializable-deferrable` 或导出快照。正式迁移窗口要求写入静默；若窗口内仍有写入，Manifest 事实与归档可能存在时间差。是否增加全局一致快照需在真实库演练时评估。
5. **内容摘要会全表扫描。** 251 MiB 级开发库可接受，但更大库需评估耗时与 `work_mem`。当前按表使用 `md5(string_agg(... ORDER BY md5(...)))`。
6. **恢复验证角色需要 superuser 或 `BYPASSRLS`。** 若真实集群没有满足条件的维护账号，验证会失败关闭；不得用不完整权限账号宣称通过。
7. **未验证 1454 真实数据分布。** 合成库的表数量、RLS 数量、Policy 数量与真实库不同；验证器已改为以源库 Manifest 为准，不依赖旧的固定 68/47/88 预期。
8. **未运行真实 Worker、通知或生产部署。** 与本轮范围一致。

## 12. 回归结果

| 项 | 结果 |
| --- | --- |
| 迁移备份定向测试 | 11 passed |
| 恢复验证定向测试 | 9 passed |
| `xiaok-migration-preflight.test.ts` | 9 passed |
| `xiaok-integration-migrations.test.mjs`（仓库实际文件名；未提供隔离环境时 7 个数据库用例跳过） | 18 passed / 7 skipped / 0 failed |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint（新增脚本与测试） | 0 errors / 0 warnings |
| `git diff --check` | 通过 |

仓库中不存在名为 `postgres-integration-migrations.test.mjs` 的测试文件；对应回归使用 `xiaok-integration-migrations.test.mjs`，未伪造该文件名。
