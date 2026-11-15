# 家客来数据库环境准备报告（I7.5.6）

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`a593a9c6f9e11de308e854bceb2059e9087e98b7`（与 `origin/codex/xiaok-integration` 完全一致，无 ahead/behind）
> 日期：`2026-11-16`（Asia/Shanghai）
> 性质：**只读调查**。未执行迁移、未创建/删除/重建数据库、未修改 `.env`、未修改企业 1454 业务数据、未启动 Worker、未删除历史数据。
> 结论：**9 条迁移的技术前置全部满足，可在一次原子事务内执行；但正式执行仍被 6 项环境与授权缺口阻断（无真实备份、无备份/恢复凭据、无隔离库连接、备用目录不安全、Worker 停运、维护窗口未批）。**

---

## 1. 调查边界与并行保护

| 项 | 结果 |
| --- | --- |
| 远端同步 | 已 `git fetch`，本地 HEAD 与远端一致，无新提交需要合入 |
| 本任务改动 | 仅新增本报告文件，未改任何代码、SQL、配置 |
| 并行 Agent 未提交改动 | **保留原样、未触碰、未提交**。调查期间观察到约 30 个已跟踪文件被修改，另有未跟踪文件 `admin/scripts/xiaok-i755-stage-knowledge-acceptance.ts`、`miniprogram/utils/native-preview.js`、`家客来微任务开发协调_SKILL.md`；该数量随并行开发持续增长，属正常现象，不作为本任务基线 |
| 并行改动涉及面 | 主要是 I7.5.5 知识问答链路（`admin/src/lib/xiaok-v1/stage-answer.ts`、`stage-chat-service.ts`、`stage-router.ts`、`assistant/infrastructure/answer-worker.ts`）与小程序端页面/测试；**不包含任何 drizzle 迁移文件**，因此与本任务的迁移执行不冲突 |
| 数据库写入 | 所有 SQL 均在 `default_transaction_read_only=on` 会话或只读事务中执行；平台/租户上下文使用 `set_config(..., true)`（事务级），会话结束自动失效 |
| 未做的事 | 未 `db:migrate`、未 `pg_dump`、未创建角色、未 `CREATE/DROP DATABASE`、未启停任何隔离集群、未启动 Worker |

---

## 2. 当前环境真实状态

### 2.1 连接拓扑

本机不直连远端库，全部经长驻 SSH 隧道（PID 64180，`Administrator@192.168.10.54`，密钥 `toonflow_remote_ed25519`）：

| 本地端口 | 远端目标 | 用途 | 状态 |
| --- | --- | --- | --- |
| `127.0.0.1:5432` | `127.0.0.1:15432` | 开发/业务库 `smart_floor_planner` | 监听中 |
| `127.0.0.1:55432` | `127.0.0.1:15433` | 共享隔离评估库（`cloud_camera_eval`，摄像头评估与合成 1454 夹具） | 监听中 |

隧道命令行与 `xiaok-migration-preflight` 内置的 `windowsRuntime()` 校验完全匹配（`-L 127.0.0.1:5432:127.0.0.1:15432` + `Administrator@192.168.10.54`），因此**官方预检的"已批准开发转发"门禁可通过**。

### 2.2 开发库（`DATABASE_URL`）

| 项 | 实际值 |
| --- | --- |
| 数据库 / 账号 | `smart_floor_planner` / `sfp_app`（`session_user` 一致） |
| 版本 | PostgreSQL `17.10`（`170010`，Debian 17.10-1.pgdg12+1） |
| 账号属性 | `rolsuper=false`、`rolbypassrls=false`、`rolcreatedb=false` |
| 服务端地址 | `172.18.0.2/32`（远端容器 `sfp-remote-dev-postgres` 内部地址，经隧道访问） |
| 库大小 | 263,689,907 字节（约 251 MB） |
| 迁移账号 | `sfp_migrator`：可登录、非超级用户、非 BYPASSRLS、`app` schema 可建、账本可读写 |
| 既有角色 | `sfp_app`、`sfp_auditor`、`sfp_migrator`（均非超级/非 BYPASSRLS）、`sfp_owner`（**SUPERUSER + BYPASSRLS + CREATEDB**） |
| 扩展 | `btree_gist 1.7`、`plpgsql 1.0`、`vector 0.8.2`（三者 owner 均为 `sfp_owner`） |
| 结构规模 | 174 张业务表，其中 153 张同时 ENABLE+FORCE RLS；208 条 policy；146 个序列；33 个 `app` 函数 |
| 当前负载 | 无其他会话（`pg_stat_activity` 其他连接 0）、无长事务、Outbox 3408（1454）/7259（全企业）、Assistant Jobs 1672（1454） |

### 2.3 关键业务数据量（平台作用域真实值）

> 说明：`sfp_app` 受 FORCE RLS 限制，不带租户/平台上下文时计数会返回 0，**不可据此判断"无数据"**。下表为设置 `app.is_platform_admin=true` 或 `app.current_enterprise_id=1454` 后的真实计数。

| 表 | 行数 | 总大小 |
| --- | --- | --- |
| `assistant_knowledge_documents` | 456 | 240 kB |
| `assistant_knowledge_assets` | 140（docx 14 / pdf 102 / xlsx 24） | — |
| `assistant_knowledge_versions` | 464 | — |
| `assistant_knowledge_chunks` | 2,909 | 20 MB |
| `assistant_knowledge_attempts` | 3,823（chunk 2,982 / embed 701 / parse 140） | — |
| `domain_event_deliveries` | 4,053 | 1.8 MB |
| `domain_event_outbox` | 7,259 | — |
| `assistant_messages` | 13,331 | 9.2 MB |
| `assistant_conversations` | 1,723 | 1.9 MB |
| `construction_projects` | 449（企业 1454：217，其中 207 已归档） | 256 kB |
| `construction_plans` | 0 | 24 kB |
| `construction_camera_sd_windows` | 0 | — |
| `platform_configs` | 9（其中 `notification_config IS NULL` 8 行） | 120 kB |

### 2.4 Worker 与本地工具链

| 项 | 实际值 |
| --- | --- |
| Assistant Worker | **未运行**：`workerCount=0`，3006/3016 无监听 |
| Worker 心跳 | `lastSuccessAt = 1794675521164`（2026-11-15 00:58:41），已 `stale` 约 24.3 小时 |
| Docker Desktop | **未运行**（`npipe:////./pipe/dockerDesktopLinuxEngine` 不存在）→ `docker compose` 类脚本当前不可用 |
| PG 客户端（PATH） | `pg_dump` / `pg_restore` / `psql` / `pg_basebackup` **均不在 PATH** |
| PG 客户端（便携版） | `C:\pg17bin\pgsql\bin`：`pg_dump 17.10`、`pg_restore 17.10`、`psql 17.10`（主版本正确） |
| `PG_BIN` | 未配置 |
| 磁盘 | C: 空闲 28.36 GB；G: 空闲 33.94 GB（备份工具默认最低 512 MiB） |

### 2.5 统一环境体检（`npm run xiaok:env:check` 实测）

- 总体：`failed`；汇总 **23 passed / 6 failed / 1 limited / 8 not_run（共 38 项）**
- 分级：`development` failed、`isolated-pg17` **not_run**、`model` failed、`knowledge` failed、`worker` failed、`production` limited
- 三级目标：`development` 已连接 `smart_floor_planner`；`isolated` **未配置**；`production` 指向 `localhost/smart_floor_planner`（模板式配置，`limited`，本次未连接）
- 开发库唯一失败项：`development.database.migrations` → `ledger=119, schema=absent, pending=9`

---

## 3. 迁移账本现状与 9 条待执行迁移

### 3.1 账本事实（正式预检输出，`check:migration-preflight --enterprise-id 1454`）

| 项 | 值 |
| --- | --- |
| 账本条数 | **119** |
| id 范围 | `1–125`（末条 id `125`，存在 id 跳号，属历史形状，非缺口） |
| 末条 timestamp | `1794902400000` → 对应 `0119_platform_portfolio_templates` |
| 账本摘要 | `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381` |
| 重复 timestamp | 0 |
| 前缀缺口 | 无（`prefixGap=false`） |
| Mixed fork | 无（`mixedFork=false`，`legacyFork=null`） |
| 委托结构 | `schema=absent`，`verifyDelegationSchema` 通过 |
| 历史哈希白名单 | 0021（id 28，`9df6e11e…`）、0051（id 58，`a41ef104…`）**两项 exact=true** |
| `sfp_migrator` | `appSchemaCreate=true`、`ledgerWrite=true`、非超管、非 BYPASSRLS |
| `notification_config` | `is_nullable=YES`、`column_default=null`、NULL 行 **8**、default 行存在且非空 |

### 3.2 待执行清单（9 条，顺序即 journal 顺序）

| # | 迁移 | journal idx | journal `when` | 文件字节 | 文件 SHA-256（raw） |
| --- | --- | --- | --- | --- | --- |
| 1 | `0120_construction_camera_sd_identity_version` | 119 | 1794988800000 | 723 | `4bf4f4f9a0ce596a9377a04091dc7ca520ff910500c6e163bd75110292e005f2` |
| 2 | `0124_assistant_knowledge_integration` | 120 | 1795334400000 | 8,671 | `e17d50b8b85aa77277dce9a5d9043ea3d51a641e2647c3bb2046dc86d6e77788` |
| 3 | `0125_native_workflow_runtime_integration` | 121 | 1795420800000 | 7,619 | `6cc59fb40d57dc5a7829bbae9a9bc6e179017855044682a9955642768e7b84f7` |
| 4 | `0126_native_workflow_delegation_integration` | 122 | 1795507200000 | 19,611 | `08cdb5a0a16f965a4857af2e938f42ccff74c3aa854e312713d423fc2c37989c` |
| 5 | `0127_native_workflow_delegation_compatibility` | 123 | 1795593600000 | 11,844 | `83350941abebc88e19dd63eaccafa1e6d1a5008a7e04c68770f5e28ccd5ae09c` |
| 6 | `0128_xiaok_v1_stage_reminders` | 124 | 1795680000000 | 4,101 | `2176a1199a2212b5b620e270ff8249d3aedc889dc3760d9e81cab9674862b49c` |
| 7 | `0129_xiaok_v1_stage_reminder_receipts` | 125 | 1795766400000 | 867 | `966e93d18077b77773a5fb215ba3863f7fbbadddc51807176d09e44aa6263618` |
| 8 | `0130_xiaok_pilot_project_scopes` | 126 | 1795852800000 | 2,312 | `49ede82f820ccd9c66b3911419c8784f1e43c6396c21ea7f40ea36b9a21501ee` |
| 9 | `0131_platform_notification_config_not_null` | 127 | 1796457600000 | 790 | `a7fd555fa43a149ddffc74067e6263cbf91446cf67d581706491756a86386291` |

**重要校验：上表 9 个 SHA-256 与 `docs/xiaok-i794-full-migration-restore-acceptance.md` §3 记录的正式 SQL 哈希逐条完全一致**，说明自 I7.4.9.4 全链路演练通过以来，迁移文件字节未被改动，演练结论仍适用于当前版本。

补充事实：
- `0121`、`0122`、`0123` 在本分支 journal 中**不存在**（属其他 fork 时间线），0124–0126 的 `IF NOT EXISTS(... created_at=1795075200000/1795161600000/1795248000000 ...)` 分支在当前账面全部为"未命中"，因此走 **fresh apply** 路径（非 Bailian/native fork 兼容路径）。
- journal `when` 不是真实日期：它们以 86,400,000 ms 递增，映射到 2026-11-17 ~ 2026-12-05。它们只是账本排序键与 `created_at` 标识，**不代表调度时间**。
- `0120`、`0124`–`0127` 在工作区为 CRLF，`0128`–`0131` 为 LF。迁移器的 `hashes()` 同时接受 raw/LF/CRLF 三种变体，账本识别不受换行影响。

---

## 4. 9 条迁移逐条风险分析

### 4.0 执行模型（决定全部风险的前提）

正式迁移器 `npm run db:migrate` → `scripts/postgres-migrate.mjs` → `migratePostgresIntegration()`：

1. 单连接、`application_name=smart-floor-planner-migrator`、`statement_timeout=120s`；
2. `BEGIN` → `pg_advisory_xact_lock(hashtext('smart-floor-planner:drizzle:migrate'))` → 校验账本与委托结构；
3. **9 条迁移的全部语句在同一个事务内顺序执行**，每条执行后写一行 `app.__drizzle_migrations`；
4. 末尾 `verifyDelegationSchema(client,'integrated')` → `COMMIT`；任何异常 `ROLLBACK`。

由此得出三条硬结论：
- **原子性成立**：任一迁移失败 → 9 条整体回滚，账本仍 119，不会留下半成品（I7.4.9.4 已用 0131 锁超时实测验证）。
- **锁持有期 = 整个批次**：前面 DDL 取得的 `ACCESS EXCLUSIVE` 会一直持有到最终 `COMMIT`；最后执行的 0131 一旦取得 `platform_configs` 排他锁，该锁同样持续到提交。
- **无法"分两阶段"执行**：I7.4.9.4 §11 建议的"先 0120–0130，再 0131"在当前迁移器下**没有对应代码路径**，实现它需要临时改动 `drizzle/` 或手工写账本 —— 两者均属本轮禁止项。**推荐按单批次原子执行**。

### 4.1 风险表

| # | 迁移 | 主要动作 | 锁与阻塞 | 触碰真实数据 | 依赖校验 | 风险等级 |
| --- | --- | --- | --- | --- | --- | --- |
| 0120 | SD 身份版本 | `ALTER TABLE ... ADD COLUMN identity_version smallint NOT NULL DEFAULT 0` + CHECK | `ACCESS EXCLUSIVE` × 1 表，毫秒级 | 0 行（表为空） | 表存在、无同名列/约束 | **低** |
| 0124 | 知识库整合 | 加 `scope/project_id`、FK、CHECK、索引、不可变触发器；重建 2 个 CHECK；`chunks.embedding DROP NOT NULL`；新建 2 张 managed 表 + RLS + policy | 5 张知识表 `ACCESS EXCLUSIVE`；CHECK/FK 全表校验 | documents 456 / assets 140 / versions 464 / chunks 2,909 | 3 个旧约束名精确存在；4 组复合唯一键存在；4 张表为空且格式/形状 0 违规 | **中低** |
| 0125 | Native 运行时 | 新建 5 张运行时/调度/批次/控制/账本表 + RLS + policy + 3 个索引；新建 `durable_tasks` + RLS；在 `domain_event_deliveries` 建 2 个部分索引 | 新建表无流量；`CREATE INDEX`（非 CONCURRENTLY）短暂阻塞 `domain_event_deliveries` 写入 | 0 行（全部新表） | `enterprises`、`domain_event_deliveries` 及 5 列存在 | **低** |
| 0126 | 委托整合 | 新建 `assistant_long_term_memories`、`native_workflow_delegations`、`native_workflow_delegation_events` + RLS/policy；追加 13 个列（Bailian 兼容分支）与 4 个约束；新建 4 个函数；**在 `domain_event_outbox`、`construction_projects`、`construction_plans` 上建 3 个触发器** | 3 张热表 `SHARE ROW EXCLUSIVE`（建触发器），与写入互斥但仅元数据级 | 0 行（新表）；触发器提交后立即生效 | 复合唯一键（projects/messages/outbox/users）齐备；无同名函数/触发器/表 | **中** |
| 0127 | 委托兼容 | `CREATE OR REPLACE` 4 个函数；`DROP CONSTRAINT IF EXISTS`；新建部分唯一索引 `native_delegation_electrical_origin`；`CREATE OR REPLACE TRIGGER` × 3 | 同 0126 的 3 张热表 | 0 行 | 属性自检（requester/owner/tasks/receipt）；PG ≥14 支持 `CREATE OR REPLACE TRIGGER`（本库 17.10 ✓） | **低** |
| 0128 | 阶段提醒 | 新建 2 张表 + 2 个索引 + FORCE RLS + policy + 授权 | 新建表，无阻塞 | 0 行 | `enterprises`、`construction_projects`、`app.has_platform_access()`/`current_enterprise_id()` 存在 | **低** |
| 0129 | 提醒回执 | 加 `conversation_id`/`message_id` + 2 个复合 FK + `receipt_check` | `ACCESS EXCLUSIVE` × 1 张空表 | 0 行 | `assistant_conversations(enterprise_id,id)`、`assistant_messages(enterprise_id,id)` 唯一键存在（已核验） | **低** |
| 0130 | 试点范围 | 新建 `xiaok_pilot_project_scopes` + 校验函数 + BEFORE 触发器 + FORCE RLS + policy；`GRANT SELECT,INSERT`、`REVOKE UPDATE,DELETE` | 新建表 | 0 行 | `construction_projects.lead_id/status`、`leads.enterprise_id/archived_at` 存在 | **低** |
| 0131 | 通知配置非空 | `SET LOCAL lock_timeout='5s'`；`LOCK TABLE platform_configs ACCESS EXCLUSIVE`；UPDATE 8 行 NULL → `{}`；SET DEFAULT `'{}'::jsonb`；SET NOT NULL | **唯一一处显式强锁 + 5 秒超时**；与 `platform_configs` 的任何读写互斥 | 8 行（预期内回填） | 列存在、`default` 行必须保持非空不变 | **中低** |

### 4.2 需要特别说明的 4 点

1. **0131 是唯一的"整批失败放大器"**
   它带 `SET LOCAL lock_timeout='5s'`。若此刻应用正持有 `platform_configs` 的长事务/长查询，5 秒内拿不到锁即报错，`ROLLBACK` 会连同 0120–0130 一起回滚。因 0131 排在最后，失败无副作用，但会让整个窗口白跑。
   `SET LOCAL statement_timeout='60s'` 会延续到事务结束；当前 0131 是最后一条，无影响；未来若在其后再加迁移，会继承这两个超时——属潜在后续隐患，建议后续在 0131 后显式复位。

2. **0126/0127 会即时开启新业务行为**
   触发器 `native_delegation_event_delivery`（`domain_event_outbox` AFTER INSERT）、`native_delegation_project_change`（`construction_projects` AFTER UPDATE OF version）、`native_delegation_schedule_change`（`construction_plans` 全 DML）在 `COMMIT` 瞬间开始工作。由于新表为空且 `EXISTS(...native_workflow_delegations...)` 为假，**当前不会产生任何投递**；但每笔 outbox/项目/计划写入都会多一次轻量 `EXISTS` 查询。

3. **0124/0126 的"分叉兼容分支"在本库不触发**
   这三处 `created_at=1795075200000/1795161600000/1795248000000` 的判断用于识别 Bailian/native 分叉账本；本库 `schema=absent`，全部走 fresh apply。若未来把本库账本与分叉历史混合（禁止操作），这些分支的语义会改变，届时必须重新预检。

4. **`ON DELETE SET NULL (project_id)` 需 PG ≥ 15**
   0124 使用列级 `SET NULL` 语法；本库 17.10 支持 ✓。若未来降级到 PG 14 及以下会直接语法报错。

### 4.3 数据级阻断项排查（全部为 0，已实测）

| 迁移 | 检查 | 结果 |
| --- | --- | --- |
| 0120 | `identity_version` 需为 0/1 的历史行 | 表 0 行 → 不适用 |
| 0124 | asset `format` 是否都在 `docx/pdf/xlsx/txt/md` | 违规 **0** |
| 0124 | `source_asset_id`/`source_file` 形状是否满足新 CHECK | 违规 **0**；单边为空 **0** |
| 0124 | `attempts.operation` 是否都在新枚举内 | 现有仅 chunk/embed/parse，均在新枚举内 |
| 0124 | 新增 `scope` CHECK（`enterprise` 且 `project_id IS NULL`） | 新列默认 `enterprise` + `project_id` 全 NULL → 全部通过 |
| 0124 | chunks `embedding` 当前 NULL 行 | 0（`DROP NOT NULL` 只是放宽，不阻塞） |
| 0125/0126/0127 | 相关 FK 孤儿行 | 预检 `foreignKeys` 全部 `passed, count=0` |
| 0128/0129/0130 | 目标表/列/约束名冲突 | `collisions=[]`、`missingColumns=[]`、`missingConstraints=[]` |
| 0131 | `notification_config` NULL 行 | 8 行（即预期回填目标）；`default` 行非空 |

---

## 5. 备份与恢复能力

### 5.1 脚本矩阵

| 脚本 / npm 命令 | 用途 | 当前可用性 |
| --- | --- | --- |
| `db:backup` → `postgres-backup.mjs` | 旧版日常备份：`docker compose exec postgres pg_dump -U sfp_owner --no-owner --no-privileges` | **不可用**：Docker 未运行；且 `--no-owner/--no-privileges` 产出的归档**不能**通过迁移级恢复校验（`permissions_verified=false`） |
| `db:restore-drill` → `postgres-restore-drill.mjs` | 旧版恢复演练：docker 内 `dropdb/createdb/pg_restore/psql` | **不可用且已过时**：依赖 Docker；硬编码期望 68 表/47 RLS/88 policy 与当前 174/153/208 不符；还引用已不存在的 `app.migration_checkpoints` |
| `db:migration-backup` → `xiaok-migration-backup.mjs` | **迁移级备份**：custom archive（保留 owner+ACL）+ 独立 `.sha256` + `migration-backup-manifest.json`（账本/RLS/policy/函数/触发器/权限/逐表数据摘要） | **可运行但缺凭据与安全目录** |
| `db:migration-restore-verify` → `xiaok-migration-restore-verify.mjs` | **迁移级恢复校验**：恢复到独立可丢弃库并逐项比对 Manifest | **可运行但缺凭据**，且目标集群/角色需满足约束 |
| `check:backup-role` → `xiaok-backup-role-preflight.ts` | 只读核验备份角色最小权限 | 可运行；真实库**尚无** `sfp_backup` 可核验 |
| `prepare-xiaok-backup-directory.ps1` | 目录安全预检：拒绝仓库内路径、清理继承 ACL、10 GB 空间门禁 | 可用（需指定非仓库路径） |
| `scripts/sql/xiaok-create-backup-role.sql` | 创建 `sfp_backup`（LOGIN/NOSUPERUSER/**BYPASSRLS**）并只授 SELECT | 未执行（需审批） |

### 5.2 备份账号现状

| 角色 | 属性 | 结论 |
| --- | --- | --- |
| `sfp_backup` | **不存在** | 最小权限备份路径不可用 |
| `sfp_owner` | LOGIN + **SUPERUSER + BYPASSRLS + CREATEDB** | 可作为 `--allow-legacy-owner` 兼容路径，但属超权限，需显式确认 |
| `sfp_migrator` | 非超管 / 非 BYPASSRLS | 不能作为备份角色（工具会以 `backup_role_missing_bypass_rls` 失败关闭） |
| `sfp_restore` | **不存在** | I7.4.9.8 设计的独立恢复维护角色尚未创建 |

### 5.3 凭据与目录现状

| 项 | 状态 |
| --- | --- |
| `XIAOK_MIGRATION_BACKUP_URL` | **未配置**（`.env.local` 无该键） |
| `XIAOK_MIGRATION_RESTORE_URL` | **未配置** |
| `sfp_owner` 密码 | 本机**无可用凭据**（`.env.local` 仅有 `sfp_app` 与 `sfp_migrator`） |
| `PG_BIN` | 未配置；实际二进制在 `C:\pg17bin\pgsql\bin`（17.10，主版本正确） |
| 默认输出目录 `admin/.postgres-backups` | **不可用**：① 位于 Git 工作树内（工具直接拒绝）；② ACL 含 `NT AUTHORITY\Authenticated Users: Modify`（工具拒绝） |
| `C:\sfp-backups` | **不存在**（`prepare-xiaok-backup-directory.ps1` 的默认目标） |
| 磁盘余量 | C: 28.36 GB / G: 33.94 GB，均远大于 251 MB 备份与 512 MiB 下限 |

### 5.4 现存备份的真实价值

| 位置 | 内容 | 结论 |
| --- | --- | --- |
| `admin/.postgres-backups` | 8 个 `.dump`，最新 `smart_floor_planner-2026-10-14T17-53-43-109Z.dump`（6,187,753 B） | **旧格式**（`--no-owner --no-privileges`）+ 已过期约 1 个月 → 只能做应急参考，**不能作为本次迁移的回滚点** |
| `C:\i794\backups` | 3 个 `xiaok-mig-…` 目录（各含 `database.dump`/`.sha256`/manifest） | 源库是**隔离合成库**（1.3 MB），非真实 `smart_floor_planner` |

**结论：真实开发库至今没有任何一次迁移级可恢复备份。**

---

## 6. 恢复演练能力评估

### 6.1 工具能力（已具备）

`verifyRestore()` 会依次校验：Manifest 格式/摘要 → 归档 SHA-256 → `pg_restore --list` 完整性 → 版本兼容（Manifest/pg_restore/目标服务端均须 PG17）→ 恢复到 `xiaok_migration_restore_*` → 账本 digest/末条 ID+timestamp → 0021/0051 历史白名单 → 逐表行数与内容摘要 → RLS/FORCE RLS 清单 → policy 摘要 → 函数/触发器/列/约束/索引/扩展摘要 → 权限（owner+ACL）摘要。只有全部为真才 `full_restore_passed=true`，**不会仅凭 `pg_restore` 退出码判定成功**。

### 6.2 能否在独立临时库执行？—— 能，但有两条路径、各自有门槛

**路径 A：development 模式（在 5432 同一集群内建临时库）**
- 硬约束：`XIAOK_MIGRATION_RESTORE_URL` 必须指向 `127.0.0.1:5432`（ tunnnel 端口），角色须为 SUPERUSER 或 BYPASSRLS（→ 只能是 `sfp_owner`），目标库名须匹配 `^xiaok_migration_restore_[a-z0-9_]{1,40}$` 且 ≠ 源库。
- 可行性：`sfp_owner` 具备 CREATEDB，工具会 `DROP ... WITH (FORCE)` 后 `CREATE`，结束时默认删除。**不修改 `smart_floor_planner`**。
- 代价：会在远端生产前集群上短暂创建/删除一个库；需 251 MB 备份 + 约等量恢复空间。
- 阻塞：缺 `sfp_owner` 凭据。

**路径 B：isolated 模式（推荐）**
- 硬约束：端口 ≥ 49152 且不得为 5432/55432；集群 `postgres` 库注释必须为 `xiaok-i749-isolated-test`；数据库名须匹配 `^xiaok_i749_[a-z0-9_]{1,40}$`。
- 现有可用候选：`C:\i794`（端口 **55436**）与 `C:\i798`（端口 **55437**），均为 PG17.10、**当前已停止**（`postmaster.pid` 不存在，日志显示 2026-11-15 21:24 干净 fast shutdown），数据目录保留。
- 可行性：**可满足**，但需要启动集群（属本轮禁止动作），并复验集群注释标记。
- 阻塞：`XIAOK_ISOLATED_DATABASE_URL` 未配置；集群未启动。

### 6.3 恢复校验的一个已知限制（来自 I7.4.9.8）

`btree_gist`/`plpgsql`/`vector` 三个扩展的 owner 是 `sfp_owner`（超级用户）。若恢复集群没有预创建这些扩展、或没有对应超管 owner，`permissions_verified` 可能为 false，从而 `full_restore_passed=false`。路径 A 复用同一集群，扩展天然存在，风险最低；路径 B 需预先按 I7.4.9.8 说明预置扩展与 owner。

---

## 7. 独立隔离 PostgreSQL 17 可用性

| 候选 | 位置 | 版本 | 状态 | 能否用于迁移/恢复 |
| --- | --- | --- | --- | --- |
| 共享评估库 | `127.0.0.1:55432` → 远端 `15433` | 可响应 PG 协议（认证失败 `28P01`，说明服务在线） | 运行中 | **禁止**：工具显式把 `55432` 列入 `blockedIsolatedPorts`；且它是摄像头评估/合成 1454 夹具库，非迁移专用 |
| I7.4.9.4 演练集群 | `C:\i794`，端口 `55436` | 17.10 | **已停止**，数据保留 | 可用（需启动 + 复验注释） |
| I7.4.9.8 演练集群 | `C:\i798`，端口 `55437` | 17.10 | **已停止**，数据保留 | 可用（需启动 + 复验注释） |
| 正式隔离连接 | `XIAOK_ISOLATED_DATABASE_URL` | — | **未配置** | 不可用 |

**结论：当前不存在"已配置且运行中"的迁移专用隔离库。** `isolated-pg17` 级别在体检中为 `not_run`（2 项），这是 `pending=9` 之外唯一未通过的环境层级。

---

## 8. 开发库与隔离库的迁移账本差异

| 维度 | 开发库 `smart_floor_planner` | 隔离库 |
| --- | --- | --- |
| 账本条数 | 119 | **无可比对象**：`XIAOK_ISOLATED_DATABASE_URL` 未配置，`isolated-pg17` 为 `not_run`（不会复用 `DATABASE_URL` 结果） |
| id 范围 | 1–125 | — |
| 末条 | `0119_platform_portfolio_templates`，`when=1794902400000` | — |
| digest | `1d156566…77b381` | — |
| 待迁移 | 9 条 | — |
| 参考（历史演练） | — | I7.4.9.4 合成隔离库：`119 → 128`，id `7–134`，digest `f586ce34…a2cafed`，前 119 条逐条不变 |

如需真正做"账本差异比对"，必须先配置 `XIAOK_ISOLATED_DATABASE_URL`，再运行 `npm run xiaok:env:check`（其 `isolated-pg17.migrations` 会独立输出 pending 差异）。**当前环境下该比对结论只能是 `not_run`，不得用开发库结果冒充。**

---

## 9. 缺失的权限与配置（按阻断强度排序）

| # | 缺口 | 影响 | 修复方式（需审批） |
| --- | --- | --- | --- |
| 1 | 真实库**无迁移级备份**（从未执行） | 无法回滚到迁移前状态 → 迁移本身不具备安全前提 | 批准后在写入静默窗口执行 `db:migration-backup` |
| 2 | `XIAOK_MIGRATION_BACKUP_URL` / `XIAOK_MIGRATION_RESTORE_URL` **均未配置**；`sfp_owner` 密码本机不可得 | 备份与恢复校验都无法启动 | 由负责人提供受控凭据（只注入环境变量，不写入仓库/`.env`） |
| 3 | `sfp_backup` 角色不存在 | 只能走 `sfp_owner` 超权限兼容路径 | 审批并执行 `scripts/sql/xiaok-create-backup-role.sql` + 交互式设密 |
| 4 | 备份目录不安全且默认目录在仓库内 | 工具 fail closed，无法落盘 | 运行 `prepare-xiaok-backup-directory.ps1 -Directory C:\sfp-backups\i756-20261116`，备份时 `--output-dir` 指向该路径 |
| 5 | `XIAOK_ISOLATED_DATABASE_URL` 未配置；`C:\i794`/`C:\i798` 已停止 | `isolated-pg17` 全级 `not_run`，无独立验收环境 | 明确选择：启动 55436/55437 之一并配置 URL，或新建可丢弃 PG17 |
| 6 | Assistant Worker 停运、心跳 stale 约 24.3 h | 迁移后无法立即验证提醒/周报链路；试点就绪仍 blocked | 迁移完成后按发布流程单独启动，不在迁移窗口内启动 |
| 7 | `sfp_restore` 角色不存在 | 恢复只能复用 `sfp_owner`（超权限） | 按 I7.4.9.8 方案单独审批创建 |
| 8 | 维护窗口与"写入静默"未确认 | 0131 锁冲突会导致整批回滚；备份与导出快照可能不一致 | 由负责人确定窗口并确认停写 |

补充提示（非本任务范围，但影响后续）：
- `.env.production` 的 `DATABASE_URL` 指向 `localhost/smart_floor_planner`，属模板式配置；体检把 `production` 判为 `limited`。上线前必须由部署负责人替换，本轮未修改。
- Docker Desktop 处于停止状态且**不应自动拉起**（远端服务已迁移）。

---

## 10. 正式迁移前的推荐执行顺序

> 以下为**待审批的操作清单**，本任务未执行任何一步。

**阶段 0：前置确认（只读）**
1. `cd admin; npm run check:migration-preflight -- --enterprise-id 1454` → 期望 `ledger.count=119`、`pending=9`、`historicalHashes` 两项 exact。
2. `cd admin; npm run xiaok:env:check` → 记录 `development`/`isolated-pg17` 分级基线。

**阶段 1：准备安全备份目录与凭据**
3. `powershell -NoProfile -ExecutionPolicy Bypass -File admin\scripts\prepare-xiaok-backup-directory.ps1 -Directory C:\sfp-backups\i756-20261116 -MinFreeGB 10`
4. 在**进程环境**（不写 `.env`）注入：`XIAOK_MIGRATION_BACKUP_URL`、`XIAOK_MIGRATION_RESTORE_URL`、`PG_BIN=C:\pg17bin\pgsql\bin`。
5. （若批准）创建 `sfp_backup` 并复核：`psql -f admin/scripts/sql/xiaok-create-backup-role.sql` → `npm run check:backup-role`。

**阶段 2：备份与独立恢复验证（迁移的硬前提）**
6. `cd admin; npm run db:migration-backup -- --mode development --output-dir C:\sfp-backups\i756-20261116 --pg-bin C:\pg17bin\pgsql\bin`
   - 期望：`status=passed`；`migrationLedgerCount=119`；`migrationLedgerDigest=1d156566…77b381`；`backupBytes≈251 MB`；目录内含 `database.dump`、`database.dump.sha256`、`migration-backup-manifest.json`。
7. `cd admin; npm run db:migration-restore-verify -- --manifest <上一步目录>\migration-backup-manifest.json --target-database xiaok_migration_restore_i756 --mode development --pg-bin C:\pg17bin\pgsql\bin`
   - 期望：`full_restore_passed=true`（`schema/data/ledger/rls/permissions` 全 true），且目标库默认被删除。
   - 若走 isolated 路径：改 `--mode isolated`，目标库名须为 `xiaok_i749_*`，集群注释须为 `xiaok-i749-isolated-test`。

**阶段 3：维护窗口内执行迁移（单批次原子）**
8. 确认写入静默：无 Worker、无 3006/3016、无应用长事务（`pg_stat_activity` 其他会话 0）。
9. `cd admin; npm run db:migrate`（`DATABASE_MIGRATION_URL` 已就绪，`sfp_migrator`）
   - 期望：`success=true`；单事务提交；账本 `119 → 128`。

**阶段 4：迁移后复验（只读）**
10. `npm run check:migration-preflight -- --enterprise-id 1454` → 期望 `pending=[]`、`status=passed`、`notification.status=passed`、账本 128。
11. `npm run xiaok:env:check` → `development.database.migrations=passed`。
12. 结构抽查（与 I7.4.9.4 §4 对齐）：`construction_stage_reminders`、`xiaok_pilot_project_scopes`、`native_workflow_delegations`、`assistant_managed_knowledge_libraries` 存在且 FORCE RLS；`platform_configs.notification_config` 的 NULL 行为 0、`is_nullable=NO`、`column_default='{}'::jsonb`；`default` 行配置文本与 8 个模板 ID 逐字未变。

**失败处理**：任何一步失败 → 事务已自动回滚（账本仍 119、无半成品）→ 不做手工账本修补、不重跑损坏归档；保留 `manifest`/`sha256`/`stdout` 证据后重新走阶段 2。

---

## 11. 维护窗口要求（建议写入执行单）

| 项 | 要求 |
| --- | --- |
| 时长 | 建议预留 30 分钟（备份/恢复验证约 5–15 分钟；迁移事务预计数秒至十余秒） |
| 写入静默 | Worker 停止、3006/3016 无监听、无批量导入、无长事务 |
| 锁预期 | 0130 之前：知识表 + `construction_camera_sd_windows` 的 `ACCESS EXCLUSIVE`（毫秒级）；0126/0127：outbox/projects/plans 的 `SHARE ROW EXCLUSIVE`；0131：`platform_configs` 强锁 + **5 秒** `lock_timeout` |
| 回滚点 | 阶段 2 产出的 `xiaok-mig-*` 备份目录（含 SHA 与 Manifest），**不是** `.postgres-backups` 里的旧 dump |
| 观察指标 | 账本 128、pending 0、FORCE RLS 153→新增表、policy 208→新增、outbox 无异常堆积 |
| 禁止 | 手工写 `app.__drizzle_migrations`、重跑 0021、改模板 ID、为通过验收而删除数据/任务 |

---

## 12. 需要人工审批的事项

| # | 事项 | 原因 | 建议决策 |
| --- | --- | --- | --- |
| A | 对真实开发库执行 `pg_dump`（迁移级备份） | 首次触碰真实库导出；涉及数据外带与目录写入 | 批准，且限定在写入静默窗口 |
| B | 创建 `sfp_backup`（**BYPASSRLS**）并设密 | BYPASSRLS 属高敏权限 | 批准最小权限角色；或临时批准 `sfp_owner` + `--allow-legacy-owner` |
| C | 提供 `XIAOK_MIGRATION_BACKUP_URL` / `XIAOK_MIGRATION_RESTORE_URL` 凭据 | 本机无可得凭据 | 由负责人以进程环境注入，禁止提交 |
| D | 选择恢复校验目标：同集群临时库（路径 A）或启动隔离集群 55436/55437（路径 B） | 前者在同集群建/删库，后者需启停服务 | 建议 B；若批准 A 需确认允许在 15432 集群建临时库 |
| E | 维护窗口与写入静默确认 | 0131 强锁 + 单事务原子性 | 批准具体时间窗与停写责任 |
| F | 执行 `npm run db:migrate`（9 条一次性应用） | 生产前最后一步不可逆变更（虽可回滚） | 在阶段 2 通过后签字 |
| G | 迁移后是否启动 Worker / 发送通知 | 涉及真实消息投递 | 单独审批，不与迁移窗口合并 |
| H | 创建 `sfp_restore` 独立恢复角色 | 降低超管依赖 | 可选，建议与 A/B 同批 |

---

## 13. 结论速览

- **技术侧已就绪**：9 条迁移的 SQL、依赖、约束名、复合唯一键、数据形状全部核验通过；8 条预检 `passed`，0131 因缺少专用检查器为 `limited`（其数据条件已单独核验：8 行 NULL、default 行非空）。
- **文件侧已冻结**：9 个 SHA-256 与 I7.4.9.4 全链路演练完全一致，演练结论可复用。
- **执行侧被阻断**：无真实备份、无备份/恢复凭据、无隔离库 URL、备份目录不安全、Worker 停运、维护窗口未批——共 6 项。
- **风险可控**：单事务原子性 + 0131 5 秒锁超时 + 事务回滚，使"最坏结果"退化为"窗口白跑一次"，不会留下半迁移状态。
- **下一步**：按 §10 阶段 0→4 推进，先补齐 §9 的 1–5 项，再申请 §12 的 A/B/C/E/F 四项签字。

---

## 附录 A：本次使用的只读命令

```text
git status --short --branch / git log / git fetch origin codex/xiaok-integration
npm run check:migration-preflight -- --enterprise-id 1454
npm run xiaok:env:check
node（只读 pg 客户端，options=-c default_transaction_read_only=on）
  - 账本、角色、扩展、RLS/policy、结构、行数、表大小
  - set_config('app.current_enterprise_id'|'app.is_platform_admin', ..., true) 仅事务级
Get-Content C:\i794\pg.log / C:\i798\pg.log（确认已停止）
Get-Acl / Get-PSDrive（备份目录 ACL 与磁盘余量）
```

## 附录 B：关键证据值

| 证据 | 值 |
| --- | --- |
| HEAD | `a593a9c6f9e11de308e854bceb2059e9087e98b7` |
| 账本条数 / 末条 id | 119 / 125 |
| 账本 digest | `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381` |
| pending | 9（0120、0124–0131） |
| 预检总体 | `blocked`，issues = `["0131_platform_notification_config_not_null"]` |
| 环境体检 | `overall=failed`，23 passed / 6 failed / 1 limited / 8 not_run |
| 数据库 | PostgreSQL 17.10 / `smart_floor_planner` / `sfp_app`（非超管、非 BYPASSRLS）/ 251 MB |
| 结构 | 174 表 / 153 FORCE RLS / 208 policy / 146 序列 / 33 函数 |
| `platform_configs` | 9 行，8 行 NULL，`is_nullable=YES`，无 default |
| Worker | 未运行，心跳 2026-11-15 00:58:41（stale ≈24.3h） |
| 备份账号 | `sfp_backup` 不存在；`sfp_owner` = SUPERUSER+BYPASSRLS+CREATEDB |
| 隔离库 | `XIAOK_ISOLATED_DATABASE_URL` 未配置；`isolated-pg17` = not_run；`C:\i794`(55436)/`C:\i798`(55437) 已停止、数据保留 |
| 旧备份 | 最新 `smart_floor_planner-2026-10-14T17-53-43-109Z.dump`（6.19 MB，`--no-owner`，不可用于迁移回滚） |
