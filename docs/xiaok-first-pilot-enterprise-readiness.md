# 小K 1.0 首家试点企业预检与整改清单

## 当前试点边界（I7.4.4）

微云 `1454` 的首批项目由有施工管理权限的企业管理员明确提交。保存后，按 `pilotId` 检查该范围的最新版本。未选中的 active 项目继续保留原状态，其阶段、施工计划、成员和 C01 缺项不再成为首批试点的项目阻断。迁移、强制 RLS、Worker、Assistant 等企业检查仍是必要条件。见[试点范围合同](xiaok-pilot-project-scope.md)。

本轮验证使用独立 PG17 `127.0.0.1:55448/pilot_readiness_eval` 及合成数据。微云的真实试点名单尚未提交，所以下列 I7.4.3 结果仍是历史企业盘点，不能据此判断某个首批项目范围已经就绪。

启用触达前需要核对两套现有规则。阶段提醒 Worker 会扫描具备触发条件的有效 active 项目，企业周报计划可能同时覆盖多个项目，且存量待发或挂起周报保存了原事实快照。预检会列出范围外命中情况和存量记录。此次配置和预检均不派发消息，现有规则继续执行。

| 隔离场景 | 实际结果 |
| --- | --- |
| A 单项目 | 仅检查选定项目，企业安全项通过。现有提醒与周报覆盖另一个 active 项目，结果为 `limited`。 |
| B 两项目 | 两个项目分别通过，加入存量测试提醒前为 `ready`。 |
| C 其他企业项目 ID | API 拒绝，数据库也拒绝直接写入。试算为 `blocked`，无外企项目明细。 |
| D 空范围、未指定范围或无对应试点 | 均为 `blocked`。模拟迁移缺失、FORCE RLS 缺失、Assistant 停用和 Worker 心跳缺失时，企业级失败全部保留。 |
| E 范围内缺阶段 | `blocked`，同时列出该项目的计划、施工人员和 C01 缺项。 |
| F 范围外缺阶段 | 并入范围外 active 清单，选中项目为 `ready`。 |
| G 范围外存量提醒与周报 | 报告查到 3 条未完成提醒及 1 条待发周报。连续两次输出一致，23 张表行数和内容摘要保持一致。 |
| H 同一企业多个试点 | 各自独立版本，过期版本提交返回 409，停用后仍保留版本历史。 |

目标回归 54 项通过，其中 20 项使用隔离 PG17。迁移兼容回归 7 项通过，验证 0129 基线只追加 0130，原项目、提醒和报告配置摘要一致。管理端配置入口覆盖企业负责人、平台管理员、超级管理员、强制改密及跨租户拒绝。独立本地 HTTP 验证了保存、重读、未登录拒绝和过期版本冲突。CLI 的 `limited` 和 `blocked` 分别返回退出码 0 和 2。TypeScript、定向 ESLint、本地 Next.js 构建通过。证据位于 `tmp/xiaok-i744-pilot-scope/`。

首次准备隔离库时，WSL 调用未把指定的迁移连接传入 Windows Node，命令读到了本地开发库。迁移在执行任何新迁移前因旧账本不匹配终止，事务已回滚。只读复核得到原 119 条账本，提醒表和试点范围表仍不存在。后续迁移及验收固定在独立 PG17。原始记录见同目录的 `migrations-baseline.log`、`development-ledger-readonly.log` 和 `migrations-final.log`。

## I7.4.6 当前项目候选评估（2026-11-15）

> 基线：`codex/xiaok-integration`，`eb69a6a54f97`。
> 环境：开发/试点库 `smart_floor_planner`，`sfp_app` 非超级用户；未连接生产库。
> 方式：现有 `check:pilot-readiness` 企业盘点和 10 个当前有效项目的逐一预检。

企业 1454 仍为 **Blocked（13 blockers / 2 warnings）**：

- 迁移 0128/0129/0130 未应用，账本 119 条；提醒表、提醒暂停表和试点范围表不存在，对应 FORCE RLS 与租户策略缺失。
- Assistant Worker 心跳为 `stale`（检查时约 3.6 小时前）。该时间戳来自本机 `3016` 临时开发运行留下的最后一次成功，见下方 I7.4.8。
- 当前 217 个项目中 10 个有效（7 `active`、3 `paused`），207 个已归档；7 个 active 项目均未发布施工计划。
- 业主 C01 warning 为项目 234、451；237/238/239/647 的角色和 C01 相对完整。
- 现有周报投递 596 条，`pending/held=0`；企业报告计划 `project_ids=[]`，当前覆盖全部 active 项目。

项目候选结论：**10 个当前有效项目全部 `blocked`，没有 `ready` 或 `limited`。** 受控技术试点的准备优先级为 **238 → 237 → 239 → 647**；1、234、451 和暂停的 402/403/404 不建议进入首批。仓库现有资料把这些项目记录为合成手测/测试/四端演练项目，没有合同、现场或业务确认等证据证明其中任何一个是真实在施工工地，因此上述排序不能作为真实业务首批名单。

本轮只读：22 张表前后快照 0 变化；企业检查和 10 个项目检查重复执行结果稳定；未保存 Pilot Scope，未修改阶段、计划、成员、C01、提醒、周报或消息。

详见[I7.4.6 候选矩阵](./xiaok-i746-pilot-project-candidates.md)。

### I7.4.7 迁移安全预演结论

在隔离 PG17 可丢弃库 `i747_migration_rehearsal` 上使用真实迁移器预演后确认：

- 1454 当前账本 119 条，pending 实际为 **8 个**：`0120`、`0124`–`0130`，不是只有 0128–0130。
- 账本 id `28`（`0021_platform_notification_config`）和 id `58`（`0051_staff_referrer_network`）的历史哈希无法被当前执行器识别；真实迁移器在应用任何 DDL 前拒绝，账本保持 119。
- 仅在预演库模拟两处哈希重基线后，8 个 pending migration 全部成功；0130 冲突可导致整个事务完整回滚；并发迁移器通过 advisory lock 串行化；重复执行为幂等。
- 0128/0129/0130 的 RLS、权限、回执约束、试点范围触发器和租户隔离均通过。开发库前后账本 119、企业 1454 项目 217 不变。
- 当时正式迁移器在历史哈希校验处终止。后续白名单复跑及真实开发库检查见 I7.4.7.3 和 I7.4.9。

详见[I7.4.7 迁移安全预演](./xiaok-i747-migration-rehearsal.md)。

### I7.4.7.1 / I7.4.7.2 账本识别整改（2026-11-15）

- 根因审查结论：0021/0051 两条账本哈希属于 `historical_content_change`，不是换行/编码差异，历史原文在仓库中不可复原。详见[I7.4.7.1 迁移哈希根因审查](./xiaok-i747-1-migration-hash-root-cause.md)。
- 负责人已批准**方案 D**：提交式精确历史哈希白名单（`admin/drizzle/legacy/known-hashes.json`，仅 2 条），**不修改数据库账本**，并批准修改 `validateLedger()`。
- 匹配要求 timestamp、当前 journal tag、完整 SHA-256 **三项精确一致**；白名单之外的未知迁移仍然严格拒绝；重复 timestamp、prefix 连续性、Mixed fork 检查全部保持不变。
- 0021/0051 仅被识别为**已应用**，不会重新执行（0051 含非幂等约束/策略，禁止重跑）。
- 该变更**只解决迁移器的账本识别**，不包含任何 DDL，本轮未连接数据库。
- **1454 仍未执行迁移**，账本仍为 119 条，仍有 **8 个待应用迁移**：`0120`、`0124`–`0130`。
- `notification_config` 结构差异（1454 可空、当前文件 `NOT NULL DEFAULT '{}'`）**仍然存在**，需单独评估。
- **I7.4.7.3 已完成该复跑**：全新可丢弃 PG17 17.10 库上，白名单路径下账本 `119 → 127`，8 个 pending 全部应用，0021/0051 未重跑，A–G 失败/回滚/幂等场景全部通过；`notification_config` 结构差异仍存在。详见[I7.4.7.3 白名单预演](./xiaok-i747-3-allowlist-rehearsal.md)。1454 仍未执行迁移。

### I7.4.8 Assistant Worker 心跳诊断（2026-11-15）

两次 I7.4.6 预检读取了同一条全局心跳，最后成功为上海时间 `00:58:41.164`。该时间与 `3016` 临时开发服务日志最后一次 Worker HTTP 200 相差不到一秒。现场没有匹配的 Windows Worker，`3006` 与 `3016` 均无监听，旧文件随时间过期。常规开发启动器会让 Worker 跟随 Next.js 的端口，现有证据不要求修改端口配置。

Healthcheck 现可报告最近请求结果及失败原因，并独立显示本机 PID 状态。现场的旧文件仍返回 `heartbeat_stale`。恢复消费仍需在获批环境启动受管的 Next.js 和 Worker，再确认新心跳。预检的 Worker 阻断仍有效。详见 [I7.4.8 现场证据与验证](./xiaok-i748-assistant-worker-diagnostics.md)。

### I7.4.9 正式迁移前只读预检（2026-11-15）

获批开发库 `smart_floor_planner` 的实际版本为 PG17.10。非超级账号 `sfp_app` 在只读事务中确认微云 `1454` 为 active。正式校验器接受 119 条账本，0021 和 0051 精确匹配白名单。实际待迁移为 `0120`、`0124`–`0130`，逐条检查通过，56 个既有外键无孤儿记录。迁移账号 `sfp_migrator` 也通过同一目标的只读登录验证。

正式执行仍为 `blocked`。需要绑定当前账本的可恢复备份、维护窗口与写入侧静默确认，以及负责人对该开发库执行范围的批准。`notification_config` 仍可空且有 8 行 NULL，当前 Drizzle 模型与 0021 文件均声明非空和空对象默认值，建议单独审批追加对齐迁移并保留现有模板。Windows Worker 当前停运，健康文件仍为 `stale`。详见 [I7.4.9 只读预检](./xiaok-i749-migration-preflight.md)。

### I7.4.9.1 迁移备份与独立恢复验证能力（2026-11-15）

新增迁移专用 `db:migration-backup` 与 `db:migration-restore-verify`：custom archive 保留 owner/ACL，生成独立 SHA-256 与 `migration-backup-manifest.json`，Manifest 绑定账本条数/摘要/末条、0021/0051 历史 SHA、RLS/FORCE RLS 表清单、Policy 定义摘要、函数/触发器/列/约束/索引、扩展、owner/ACL 与逐表行数/内容摘要。备份前要求目标为已批准库或带隔离标记的可丢弃库、PG17、备份角色具备 `BYPASSRLS`/superuser 与全表全序列 `SELECT`，否则失败关闭。恢复验证只恢复到独立可丢弃库，按源库 Manifest 校验，并显式区分 `schema_restore_passed`、`data_restore_passed`、`ledger_verified`、`rls_verified`、`permissions_verified`、`full_restore_passed`。

隔离 PG17.10 上 12 项真实场景全部通过：正常备份/Manifest/SHA、SHA 与 Manifest 篡改、归档损坏、权限不足、目标等于源库、重复恢复、中途失败不覆盖已验证备份；恢复后 127 条合成账本、167 张 FORCE RLS 表、222 条 Policy 与 14 行合成业务数据均一致。定向 20 项测试通过，预检与迁移器回归、TypeScript、ESLint 通过。

**迁移仍为 `blocked`**：本轮未对 `smart_floor_planner` 执行 `pg_dump`，真实备份、真实恢复回执与维护窗口仍未完成，`notification_config` 结构差异和 Worker `stale` 也仍待处理。详见 [I7.4.9.1 备份与恢复验证](./xiaok-i749-1-backup-restore-verification.md)。

### I7.4.9.2 notification_config 结构漂移方案（2026-11-15）

只读核查确认 `smart_floor_planner.platform_configs` 共 9 行：8 行 `notification_config IS NULL`，全部为 `ai-provider-environment:*` 与 `phase2-*` 标记行，不是通知业务配置；唯一 `default` 行为 V2、8 个模板，8 个模板 ID 指纹全部与当前代码默认值一致。列为 `jsonb`、可空、无默认值，与 Drizzle `jsonObject()` 的 `NOT NULL DEFAULT '{}'::jsonb` 不一致。

规范 B 已从模型、读写路径、API、管理端、小程序模板读取、订阅发送和历史模板路径复核；应用对 NULL 与 `{}` 统一归一化，没有 NULL 专用业务语义。设计的 `0131_platform_notification_config_not_null` 只回填 NULL、设置默认值与非空约束，不重跑 0021、不重种模板、不改写任何非空配置；显式 `ACCESS EXCLUSIVE` 锁关闭回填与约束之间的并发竞态。

隔离 PG17.10 的 8 项定向测试全部通过：回填、非空配置逐字节保留、模板 ID 保留、默认值、显式 NULL 拒绝、并发 NULL 写入 `23502`、事务回滚、重复执行 0 行；旧版 8 模板和空对象读取均正常。**本轮仅设计，未创建正式 0131 文件、未执行 `db:migrate`、未修改真实库。** 建议负责人在完成备份/恢复验证和维护窗口后批准，优先采用先 0120–0130、再 0131 的两阶段实施。详见 [I7.4.9.2 notification_config 对齐方案](./xiaok-i749-2-notification-config-alignment.md)。

### I7.4.9.3 0131 正式迁移与隔离验收（2026-11-15）

负责人已批准规范 B。正式新增 `admin/drizzle/0131_platform_notification_config_not_null.sql`，journal 追加 idx `127`、when `1796457600000`、tag `0131_platform_notification_config_not_null`，未修改此前记录。迁移只回填 `notification_config IS NULL` 的 8 行、设置 `DEFAULT '{}'::jsonb` 与 `NOT NULL`，不重跑 0021、不种模板、不改写非空配置。

隔离 PG17.10 使用正式迁移器完成 A–N 验收：8 行 NULL 全部变为 `{}`；原 `default` 配置的 JSON 文本、SHA-256 和 8 个模板 ID 完全保持；新插入只写 key 得到 `{}`，显式 NULL 返回 `23502`；锁超时使正式迁移器失败并完整回滚；并发 NULL 写入在迁移提交后返回 `23502`；重复执行不再执行 0131；0021/0051 历史 SHA 与其他 127 条账本不变，仅追加 0131；最终 pending 为空。对齐测试 6 passed / 0 skipped，通知相关 18 passed，预检 9 passed，迁移备份/恢复 20 passed（合成源账本随 journal 变为 128 条），TypeScript 与定向 ESLint 通过。

**微云 1454 真实开发库仍未执行迁移。** 加入 0131 后正式待迁移项为 9 条：`0120`、`0124`–`0130`、`0131`；真实库仍为 119 条账本、8 行 NULL。执行前仍需完成 I7.4.9.1 真实备份/恢复验证、维护窗口和写入静默确认。详见 [I7.4.9.3 0131 验收](./xiaok-i749-3-0131-migration-acceptance.md)。

### I7.4.9.4 119→128 完整链路与备份恢复联合验收（2026-11-15）

在全新可丢弃 PG17.10 集群上，用正式迁移器把 119 条合成账本（id `7–125`，0021 id `28`、0051 id `58`）推进到 128 条（id `7–134`），pending 从 9 条降为 0。9 条迁移 SHA 全部与正式 SQL 一致；前 119 条与 0021/0051 历史 SHA 完全不变。0131 回填 8 行 NULL；原 synthetic default 配置文本 SHA-256 `1d4550fc…fdf248c` 与 8 个模板 ID 保持不变。

结构与业务验收覆盖 38 个关系、6 个函数、5 个触发器、167 张 FORCE RLS 表、222 条 Policy；`sfp_app` `rolbypassrls=false`，跨企业读取隔离、跨企业写入 `42501`、非法 Pilot 项目拒绝、Pilot Scope 更新/删除 `42501`、提醒去重 `23505`、投递回执 `23514` 均通过。

迁移备份 `xiaok-mig-20261115t103306894z-780f8616`：archive SHA `afb216d2…20e6ae4`，Manifest SHA `c0e9b88f…c129576a`，Manifest 账本 128 条并记录 0131 SHA `a7fd555f…386291`。独立恢复到 `xiaok_migration_restore_i794`，`full_restore_passed=true`，128 条账本、0021/0051、0131、default 配置、167 张 FORCE RLS 表、222 条 Policy 与权限摘要全部一致。锁超时回滚、未知 SHA、SHA/Manifest 篡改、同源目标、恢复失败保留备份、重复迁移、并发迁移均通过。

回归 **71 passed / 7 skipped**（7 项为 `xiaok-integration-migrations.test.mjs` 的数据库用例，因本机无 pgvector 按设计跳过），TypeScript 与定向 ESLint 通过。**真实 1454 仍未执行迁移、备份或恢复。** 详见 [I7.4.9.4 完整链路验收](./xiaok-i794-full-migration-restore-acceptance.md)。

### I7.4.9.5 真实备份执行前最终安全核验（2026-11-15）

只读核验确认：真实库 `smart_floor_planner` 为 PG17.10、约 251 MB，119 条账本（id `1–125`，摘要 `1d156566…77b381`），0021/0051 历史 SHA 精确命中，pending 9 条；`notification_config` 9 行中 8 行 NULL，default 为 V2、8 模板，文本 SHA `e34a0f6a…7d6a52`。`sfp_app` 非 superuser/非 BYPASSRLS；`sfp_owner` 可登录且可读取全部 174 张表、146 个序列，但当前为 **superuser + BYPASSRLS**，存在超权限风险。真实 RLS 为 153 张 FORCE RLS、208 条 Policy。

当前无 Assistant Worker、无 3006/3016 监听、无其他数据库会话/长事务/DDL、Outbox 0、周报 0、Assistant Jobs 0；Worker 心跳约 17.9 小时前，已 `stale`。远端开发容器为 `sfp-remote-dev-postgres`（pgvector 0.8.2-pg17），容器与本机 `pg_dump`/`pg_restore` 均为 17.10。

`backup_preflight` 仍为 **blocked**：缺少已批准的 `sfp_owner` 凭据（无 `XIAOK_MIGRATION_BACKUP_URL`/`XIAOK_MIGRATION_RESTORE_URL`）；默认 G: 备份目录仅余约 0.08 GB，不足以容纳 251 MB 数据库；现有 `.postgres-backups` ACL 含 `Authenticated Users: Modify`，不适合保存迁移备份。备份、恢复验证、迁移执行均仍为 `not_run`。回归 20 项备份/恢复测试与 9 项预检测试通过，TypeScript 与定向 ESLint 通过。详见 [I7.4.9.5 真实备份执行方案](./xiaok-i795-real-backup-execution-plan.md)。

### I7.4.9.6 最小权限备份角色 sfp_backup（2026-11-15）

新增并验证专用备份角色设计：`sfp_backup` 为 LOGIN、NOSUPERUSER、BYPASSRLS、NOCREATEDB、NOCREATEROLE、NOREPLICATION，不属于 `sfp_owner`/`sfp_migrator` 成员，不拥有业务表。仅授予 `app` schema USAGE、现有全部表/序列 SELECT，以及未来对象的默认 SELECT；不授予任何写、DDL、账本或迁移权限。

隔离 PG17.10 验证通过：跨 FORCE RLS 读取 1454/1455 全部数据；174 张表、146 个序列 SELECT 覆盖；custom archive 备份成功；独立恢复 `full_restore_passed=true`；INSERT/UPDATE/DELETE/CREATE/ALTER/账本写入均返回 `42501`；`rolsuper=false`、`rolbypassrls=true`、无 owner/migrator 成员关系；`sfp_app` 仍受租户 RLS 限制。缺少 BYPASSRLS 或表 SELECT 时工具 fail closed。

备份工具默认使用 `sfp_backup`；`sfp_owner` 仅保留显式 `--allow-legacy-owner`/环境开关的兼容路径，且 `sfp_backup` 若为 SUPERUSER 会被拒绝。Manifest 记录角色属性、profile、风险确认与覆盖检查。新增目录安全预检：拒绝仓库内目录、Authenticated Users/Everyone 可写 ACL、空间不足目录；失败不创建备份。

真实开发库**尚未创建 `sfp_backup`**，未修改 `sfp_owner` 或 1454 权限。创建真实角色、授权、密码注入、默认权限和保留 legacy 兼容均需负责人单独批准。回归：备份 16 passed、恢复 9 passed、迁移器 18 passed / 7 skipped，TypeScript 与定向 ESLint 通过。详见 [I7.4.9.6 最小权限备份角色](./xiaok-i796-least-privilege-backup-role.md)。

### I7.4.9.7 真实 sfp_backup 创建方案与授权脚本（2026-11-15）

新增正式授权 SQL `admin/scripts/sql/xiaok-create-backup-role.sql`：不写明文密码，角色已存在时直接失败，明确输出 BYPASSRLS 警告；仅授予 CONNECT、`app` USAGE、现有全表/全序列 SELECT 和 `sfp_migrator` 未来对象的默认 SELECT，不授予写、DDL、账本或角色成员关系。

新增只读验收工具 `npm run check:backup-role`，检查角色属性、全表/全序列覆盖、无写/DDL/账本权限、`sfp_app` 仍受 FORCE RLS 限制、`sfp_backup` 未被应用/Worker 使用；目标不明确或任一检查失败时 fail closed。

隔离 PG17.10 通过正式 SQL 创建角色并验证 6 项：角色属性、跨企业 FORCE RLS 读取、全表/全序列 SELECT、写/DDL/账本拒绝、未来对象默认 SELECT、`sfp_app` 租户隔离；缺少 SELECT 或缺 BYPASSRLS 时 preflight 失败。新增 PowerShell 安全目录脚本，验证了受限 ACL、10 GB 空间检查、仓库内路径拒绝和重复执行幂等。

真实开发库**尚未创建 `sfp_backup`**，未设置真实密码，未修改 `sfp_owner` 或 1454 权限。恢复账号仍需独立的 CREATEDB/BYPASSRLS/owner 切换维护权限，不复用 `sfp_backup`。回归：角色 6 passed、备份/恢复 25 passed，TypeScript 与定向 ESLint 通过。详见 [I7.4.9.7 角色创建方案](./xiaok-i797-backup-role-provisioning.md)。

### I7.4.9.8 独立恢复维护角色 sfp_restore（2026-11-15）

只读核查确认真实 `app` schema、174 张业务表、146 个序列、33 个函数全部由 `sfp_migrator` 拥有（非 SUPERUSER、非 BYPASSRLS）；`btree_gist`/`plpgsql` 扩展由 `sfp_owner` 超级用户拥有。据此设计 `sfp_restore`：LOGIN、NOSUPERUSER、CREATEDB、BYPASSRLS、NOCREATEROLE、NOREPLICATION，仅加入 `sfp_migrator`，不加入 `sfp_owner`，不授予源库 CONNECT。

PG17.10 使用**独立恢复集群**验证：可创建/删除一次性恢复库、完整恢复 custom archive、恢复业务对象 owner 与 ACL、128 条账本、数据、FORCE RLS/Policy；`full_restore_passed=true`；`rolsuper=false`、`rolcreaterole=false`；源集群无该角色，无法修改源库；`sfp_backup` 凭据被恢复工具拒绝。混合非超级用户 owner 需要对应成员关系；`pg_restore --role` 不能替代成员关系。超级用户拥有的扩展 owner/comment 无法在非超级用户下逐字恢复，恢复集群需预创建扩展并指定非超级用户 owner。

真实 `sfp_restore` 和恢复集群尚未创建；本轮未修改真实角色或数据库。回归：角色 5 passed、备份/恢复 25 passed，TypeScript 与定向 ESLint 通过。详见 [I7.4.9.8 恢复维护角色](./xiaok-i798-restore-maintenance-role.md)。

## 历史企业盘点（I7.4.3）

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`8b4062461f16`
> 目标企业：**1454（微云）**
> 检查时间：`2026-11-14T16:02:55.155Z`（Asia/Shanghai `2026-11-15 00:02:55`）
> 预检结论：**Blocked**
> 原始 JSON：`tmp/xiaok-i743-first-pilot/readiness-1454.json`

## 1. 目标企业与执行环境

### 1.1 为什么是 1454

没有扫描全部企业，也没有自行挑选生产企业。1454 是仓库文档中唯一明确指定的试点企业：

- [微云企业的小K人工测试数据](./xiaok-manual-test-data.zh-CN.md)：**“已批准开发环境的当前企业 微云（1454）”**，并限定该夹具只允许微云 1454、客户 645 和已核实的开发库。
- [小K Agent 分层与 FastGPT 工具网关契约](./xiaok-fastgpt-agent-layering.zh-CN.md)：**“`site.public` 已在 1454 试点激活”**。

除上述文档外，本轮没有找到其他被明确指定为“首家试点”的企业 ID。

### 1.2 目标环境

| 项 | 值 |
| --- | --- |
| 数据库 | 开发库 `smart_floor_planner`（由 `admin/.env.local` 配置） |
| 业务账号 | `sfp_app` |
| 超级用户 | 否 |
| `rolbypassrls` | 否 |
| 连接方式 | 租户事务，`app.current_enterprise_id=1454` |
| 生产库 | **未连接** |
| 生产部署 | **未执行** |

本轮使用当前工作区可用的非超级用户业务账号完成只读检查，没有使用超级用户或关闭 RLS 绕过企业隔离。该环境是开发/试点环境，不是生产环境；生产结论仍需单独执行。

## 2. 预检结论

**Blocked。12 个 blocker、1 个 warning，暂不具备试点条件。**

| 检查项 | 状态 | 实际结果 |
| --- | --- | --- |
| 企业状态 | passed | `active` |
| Assistant 启用 | passed | `enabled=true`，保留期 90 天，每日 100 请求 |
| 有效项目 | passed | 10 个有效项目，其中 7 个 active |
| 十阶段配置 | passed | 十个标准阶段、知识包、提醒策略完整 |
| 项目当前装修阶段 | **failed** | 3 个 active 项目未设置阶段 |
| 有效施工计划 | **failed** | 7 个 active 应报告项目均未发布计划 |
| 业主账号 | passed | 4 个有项目权限的客户 |
| 老板跨项目权限 | passed | 2 个 `construction_actor_access=owner` |
| 项目经理 | passed | 3 个有效 manager 成员 |
| 项目经理工作台 | passed | 3 个经理工作台入口 |
| 设计师项目成员 | passed | 3 个有效 designer 成员 |
| 施工人员任务权限 | passed | 2 个有效 worker 成员 |
| 业主 C01 | warning | 9 个项目可用；项目 451 客户无开放会话 |
| 企业报告计划 | passed | 已启用，项目范围为空（全部项目） |
| 四角色周报受众 | passed | customer/worker/designer/boss 完整，4 类会话可用 |
| Assistant Worker 心跳 | passed | `fresh`，0 秒前成功 |
| 迁移 0128/0129 | **failed** | 数据库账本 119 条，0128/0129 均未应用 |
| 数据库业务账号 | passed | `sfp_app`，非超级用户、无 bypass RLS |
| 提醒/周报 RLS | **failed** | 两张提醒表不存在；周报/会话表 RLS 正常 |
| 站内消息入口 | passed | 五类入口均可用 |
| 提醒运行状态 | skipped | 提醒表不存在，由迁移检查阻断 |

## 3. 全部通过项

以下项目已通过，不需要整改：

1. **企业状态**：企业 1454 为 `active`。
2. **Assistant 设置**：已启用，策略版本 62，保留期 90 天，每日请求 100、Token 1,200,000、费用 100,000,000 micros。
3. **有效项目**：10 个未归档项目，7 个 active；项目事实可读取。
4. **十阶段配置**：十个标准施工阶段 key 完整；十套知识包和十套提醒策略均为 active。
5. **业主账号**：4 个客户与项目存在有效绑定，且 `customer_access=true`。
6. **老板跨项目权限**：2 个管理账号的 `construction_actor_access` 返回 `owner`。
7. **项目经理**：3 个 active `manager` 成员，均有施工访问权限。
8. **项目经理工作台**：3 个经理工作台入口可用。
9. **设计师项目成员**：3 个 active `designer` 成员，均有施工访问权限。
10. **施工人员任务权限**：2 个 active `worker` 成员，均有施工访问权限。
11. **企业报告计划**：`construction_report_settings.enabled=true`，周期与项目范围可读。
12. **四角色周报受众**：`customer/worker/designer/boss` 四类受众完整；4 类可用跟进会话均存在。
13. **Worker 心跳**：健康文件为 fresh（检查时 0 秒前成功）；Worker 为全局进程，不按企业拆分。
14. **数据库业务账号**：连接账号为 `sfp_app`，非超级用户且无 `rolbypassrls`。
15. **站内消息入口**：业主 16 个（C01 9 个 + 客户会话 7 个）、老板 2 个、经理 3 个、设计师 4 个、施工人员 4 个；24 个启用中的跟进绑定。
16. **周报/会话表 RLS**：报告设置、跟进绑定、报告、报告版本、报告投递、Assistant 会话与消息均启用并强制 RLS，存在租户策略。

## 4. Blocker 与具体整改办法

### 4.1 项目当前装修阶段（3 项）

| 项目 | 实际状态 | 失败原因 | 整改办法 | 复检标准 |
| --- | --- | --- | --- | --- |
| 234 `测试工地·全流程演练·1028` | `current_stage_key=null` | 项目未设置当前阶段 | 如企业管理员将该项目纳入试点，由项目经理在项目进度中设置阶段 | 项目详情显示有效阶段，`project.stage` 不再报错 |
| 451 `合成·字体校验工地 2026-11-09` | `current_stage_key=null` | 同上；该项目还没有设计师/施工人员成员和 C01 | 如企业管理员将该项目纳入试点，补齐阶段、成员和 C01 | 阶段有效，角色与 C01 检查通过 |
| 647 `【合成四端】mwd7tyrb 四端工地` | `current_stage_key=null` | 项目未设置当前阶段 | 由项目经理设置当前阶段；该项目的经理、设计师、施工人员成员已存在 | 阶段有效且计划覆盖当前阶段 |

> 不要通过数据库直接写 `current_stage_key` 来绕过项目进度和审计；使用现有项目进度动作。

### 4.2 有效施工计划（7 项）

以下 active 且未完工项目均没有已发布施工计划：

| 项目 | 实际状态 | 失败原因 | 整改办法 |
| --- | --- | --- | --- |
| 1 `小K工地对话测试（微云·1017）` | `plan.available=false` | 未发布计划 | 由项目经理发布包含真实房间和当前阶段节点的计划 |
| 234 `测试工地·全流程演练·1028` | `plan.available=false` | 未发布计划，且当前阶段为空 | 先设置阶段，再发布包含该阶段节点的计划 |
| 237 `合成手测甲工地·小K全流程` | `plan.available=false` | 未发布计划 | 由项目经理发布计划；当前阶段为安装 |
| 238 `合成手测乙工地·小K全流程` | `plan.available=false` | 未发布计划 | 由项目经理发布计划；当前阶段为泥木 |
| 239 `合成手测公开样板工地·小K全流程` | `plan.available=false` | 未发布计划 | 由项目经理发布计划；当前阶段为水电 |
| 451 `合成·字体校验工地 2026-11-09` | `plan.available=false` | 未发布计划，阶段/成员/C01 也不完整 | 如企业管理员将该项目纳入试点，补齐阶段、成员、C01 和计划 |
| 647 `【合成四端】mwd7tyrb 四端工地` | `plan.available=false` | 未发布计划，当前阶段为空 | 先设置阶段，再发布计划 |

计划验收标准：

- `construction_plans` 出现当前有效计划版本，`readSchedule.available=true`。
- 计划节点引用真实房间和当前阶段，`structurallyValid=true`。
- 当前阶段至少有一个计划节点，`currentStageScheduled=true`。
- 不得用空计划、伪造日期或没有房间的节点“通过”检查。

暂停项目 402、403、404 当前不要求计划；如果重新改为 active，将重新进入计划检查。

### 4.3 迁移 0128/0129（1 项）

| 实际状态 | 失败原因 | 整改办法 | 复检标准 |
| --- | --- | --- | --- |
| 迁移账本 119 条；0128、0129 的表/字段/约束均不存在 | 开发库尚未应用 I7.1/I7.2 提醒迁移 | 先做数据库快照；使用迁移账号执行 `npm run db:migrate`；不要用业务账号或超级用户直接补表 | 账本包含 0128、0129；`construction_stage_reminders`、`construction_stage_reminder_pauses` 及回执字段存在 |

迁移后必须同时确认：

- `construction_stage_reminders` 有 `conversation_id`、`message_id` 和回执约束。
- 两张提醒表均启用 `FORCE ROW LEVEL SECURITY`。
- 租户策略 `tenant_scope` 存在，业务账号仍非超级用户。

### 4.4 提醒/周报 RLS（1 项）

| 实际状态 | 失败原因 | 整改办法 | 复检标准 |
| --- | --- | --- | --- |
| 两张提醒表不存在；其余周报/会话表 RLS 正常 | 0128、0129 未应用，提醒表没有 RLS | 先完成迁移；迁移后核对 ENABLE/FORCE RLS 和 `tenant_scope` 策略；不得为业务账号关闭 RLS | `database.rls` 九张表全部 `exists=true,rls=true,forced=true,policies>0` |

## 5. Warning 与具体整改办法

| 项目 | 实际状态 | 原因 | 整改办法 |
| --- | --- | --- | --- |
| 451 `合成·字体校验工地 2026-11-09` | 客户 4126 无开放 C01 会话 | 客户可进入项目，但没有 `customer_consultation` open/ai 会话 | 如企业管理员将该项目纳入试点，走现有 C01 初始化流程 |

该 warning 不是 blocker，但在项目 451 保留为试点项目时必须处理。

## 6. 其他整改建议

1. **设计师 2855 处于强制改密状态**：检查器未将其计入有效设计师（`must_change_password`）。当前 `role.designer` 仍由其他 3 个账号通过；如果项目 1、234 属于试点，需要该账号完成改密或改派其他设计师。
2. **项目 1、234 没有施工人员成员**：当前企业级 `role.worker` 由其他项目通过；如果这两个项目属于试点，需要补 active `worker` 成员。
3. **项目 451 没有设计师和施工人员成员**：与 C01 缺失一起处理，或将该合成项目移出试点范围。
4. **试点范围**：企业管理员按实际业务明确提供项目 ID。项目名称仅用于展示，项目变更继续使用 Construction 的现有流程。
5. **不要用数据库直写代替业务流程**：阶段、计划、成员、C01 和报告范围都应通过现有项目/跟进/报告流程配置，保留审计和权限检查。

## 7. 验收核对

### 7.1 只读与无副作用

在真实企业 1454 上对以下 17 张表执行检查前后快照（行数 + 内容 MD5）：

`construction_projects`、`construction_members`、`construction_stage_settings`、`construction_report_settings`、`construction_followup_bindings`、`construction_stage_reminders`、`construction_stage_reminder_pauses`、`construction_reports`、`construction_report_versions`、`assistant_conversations`、`assistant_messages`、`assistant_participants`、`assistant_runs`、`assistant_jobs`、`domain_event_outbox`、`admin_users`、`leads`。

结果：**0 张表发生变化**。没有创建提醒、周报、报告版本、站内消息或 outbox 事件；没有发送任何通知。

### 7.2 重复执行稳定

连续执行两次预检，去除 `checkedAt` 和 Worker 心跳时间/年龄后，两次报告的以下内容完全一致：

- `readiness`：`blocked`
- 21 项检查状态
- 12 个 blocker
- 1 个 warning
- 项目、角色账号、拒绝账号、周报计划、迁移与 RLS 结果

仅有 `checkedAt`、`lastSuccessAt` 和心跳秒数不同，属于运行时间差异。

### 7.3 权限边界

- 只读取企业 1454，没有扫描其他企业。
- 使用租户事务和 `sfp_app`；`superuser=false`、`bypassRls=false`。
- 没有使用平台管理员事务、超级用户或关闭 RLS 的方式绕过权限。
- 客户是平台级身份，租户事务看不到客户 `app.users` 行；检查器按线索/项目绑定识别业主，不把“用户行不可见”误判为没有业主。

### 7.4 检查器诊断修正

本轮真实预检发现并修正了两处诊断问题：

1. 业主检测不再 `join app.users`。客户是平台级身份，企业租户 RLS 会隐藏客户行；现在按 `leads.customer_user_id + customer_access` 识别业主，C01 仍单独核验真实会话。
2. 提醒表不存在时，`reminder.state` 标记为 `skipped`，不再显示为 passed；迁移/RLS 检查继续作为 blocker。

隔离 PG17 回归仍为 9/9 passed，`tsc --noEmit` 与定向 ESLint 通过。

## 8. 生产环境尚未验证的条件

本轮**没有连接生产数据库**，以下条件均未验证：

1. 生产企业 ID 是否为 1454、企业名称与状态是否一致；本报告只证明开发/试点环境中的 1454。
2. 生产数据库是否已应用 0128、0129，迁移账本与 RLS 是否正常。
3. 生产业务账号是否为非超级用户、是否保持 FORCE RLS。
4. 生产 Worker 是否运行、健康文件路径是否与服务配置一致。
5. 生产企业 Assistant 设置、报告计划、四角色受众与跟进会话是否与开发环境一致。
6. 生产项目、阶段、施工计划、成员和 C01 的真实配置。
7. 真实微信订阅消息、真机、真实相机/相册等仍未验证。

因此，本报告的 `blocked` 结论只适用于当前开发/试点环境和该次检查时间，不能作为生产上线批准。

## 9. 复跑方式

```powershell
cd admin
npm run check:pilot-readiness -- --enterprise-id 1454 --pilot-id '<管理员保存的试点ID>'
```

- 退出码 `0`：ready/limited；`2`：blocked；`1`：执行错误。
- 修复后重新执行，直到 blocker 为 0；只剩 warning 时为 `limited`。
- 复跑必须继续使用非超级用户业务账号，不得用超级用户或关闭 RLS 绕过。
- 原 I7.4.3 企业盘点可加 `--enterprise-audit` 复查。单独保存每次输出，保留原始证据。

### 证据文件

- `tmp/xiaok-i743-first-pilot/readiness-1454.json`（原始 JSON）
- `tmp/xiaok-i743-first-pilot/readiness-1454-run1.json`、`readiness-1454-run2.json`（稳定性复跑）
- `tmp/xiaok-i743-first-pilot/summary.json`（摘要）
- `tmp/xiaok-i743-first-pilot/db-before.json`、`db-after.json`（只读快照）
