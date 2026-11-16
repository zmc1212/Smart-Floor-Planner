# 家客来数据库环境准备报告（I7.5.6）

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`a593a9c6f9e11de308e854bceb2059e9087e98b7`（与 `origin/codex/xiaok-integration` 完全一致，无 ahead/behind）
> 日期：`2026-11-16`（Asia/Shanghai）
> 性质：**只读调查**。未执行迁移、未创建/删除/重建数据库、未修改 `.env`、未修改企业 1454 业务数据、未启动 Worker、未删除历史数据。
> 结论：**9 条迁移的技术前置全部满足，可在一次原子事务内执行；但正式执行仍被 6 项环境与授权缺口阻断（无真实备份、无备份/恢复凭据、无隔离库连接、备用目录不安全、Worker 停运、维护窗口未批）。**

---

## I7.5.12 当前只读复核

从 `admin` 运行 `npm run xiaok:migration`。当前工位在 PATH 中缺少 PG 客户端，使用已验证的 `--pg-bin C:\pg17bin\pgsql\bin` 可找到三项 17.10。正式步骤、证据和回滚见 [第一版迁移执行单](./xiaok-i7512-v1-database-migration-runbook.md)。

| 门禁 | 当前结果 | 证据或缺项 |
| --- | --- | --- |
| `backup_readiness` | `failed` | 源目录候选 `C:\sfp-backups\i7512-20261116` 不存在，`admin/.postgres-backups` 在 Git 工作树内，历史 `C:\i794\backups` 的 ACL 含宽泛授权。本机 C: 空闲约 22 GiB、G: 约 28 GiB，高于 512 MiB 默认下限。源库目录查无 `sfp_backup`，缺 `XIAOK_MIGRATION_BACKUP_URL`，真实归档检查 `not_run`。 |
| `restore_readiness` | `failed` | 源集群无 `sfp_restore`，两个历史隔离实例未运行，缺 `XIAOK_MIGRATION_RESTORE_URL` 及本次验证回执。真实恢复 `not_run`。 |
| `migration_readiness` | `passed` | 账本 119 条，末条 `0119`、ID 125，0021/0051 精确。9 个原始 SHA、journal 顺序、依赖与 0131 的只读检查均通过。真实 `sfp_migrator` 登录、账本一致和权限通过。0131 待回填 8 行，原 `default` 行摘要已记录。 |
| `environment_readiness` | `limited` | 已核对开发转发、PG17、客户端版本和当时的 0 Worker/0 应用监听/0 其他数据库客户端。独立恢复端点未连接。 |
| `overall_readiness` | `failed` | 等待受限目录、真实备份和独立恢复证据。维护窗口和单批次执行由负责人签批。 |

命令默认只读。退出码 `0` 表示全部 `passed`，`2` 表示任一项尚未就绪，`1` 表示工具异常。报告仅包含变量名、固定错误码、可核对的摘要和元数据。实际输出为本机 `tmp/xiaok-i7512-readiness-final.json`。已核对历史 `C:\i794\evidence\acceptance.json` 和三份保留的归档清单，均对应合成库。以下早期数据和文件指纹仍保留为 I7.5.6 基线。

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
| `db:migration-backup` → `xiaok-migration-backup.mjs` | **迁移级备份**：custom archive（保留 owner+ACL）+ 独立 `.sha256` + `migration-backup-manifest.json`（账本/RLS/policy/函数/触发器/权限/逐表数据摘要） | **源码具备同快照导出，等待受限目录、`sfp_backup` 和导出凭据** |
| `db:migration-restore-verify` → `xiaok-migration-restore-verify.mjs` | **迁移级恢复校验**：恢复到独立可丢弃库并逐项比对 Manifest | 使用独立 PG17、`sfp_restore` 和不存在的新库名，等待实际目标及凭据 |
| `check:backup-role` → `xiaok-backup-role-preflight.ts` | 只读核验备份角色最小权限 | 可运行；真实库**尚无** `sfp_backup` 可核验 |
| `prepare-xiaok-backup-directory.ps1` | 目录安全预检：拒绝仓库内路径、清理继承 ACL、10 GB 空间门禁 | 可用（需指定非仓库路径） |
| `scripts/sql/xiaok-create-backup-role.sql` | 创建 `sfp_backup`（LOGIN/NOSUPERUSER/**BYPASSRLS**）并只授 SELECT | 未执行（需审批） |

### 5.2 备份账号现状

| 角色 | 属性 | 结论 |
| --- | --- | --- |
| `sfp_backup` | **不存在** | 最小权限备份路径不可用 |
| `sfp_owner` | LOGIN + **SUPERUSER + BYPASSRLS + CREATEDB** | 源库超权限历史角色。当前开发导出路径固定使用 `sfp_backup` |
| `sfp_migrator` | 非超管 / 非 BYPASSRLS | 不能作为备份角色（工具会以 `backup_role_missing_bypass_rls` 失败关闭） |
| `sfp_restore` | **不存在** | 维护角色只部署于另行批准的独立恢复集群，源库保持无该角色 |

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

### 6.2 正式恢复环境

真实开发归档使用 `--mode isolated`。连接目标为带 `xiaok-i749-isolated-test` 标记的独立 PG17 维护库 `postgres`，且该集群的库目录中没有源库。使用 `sfp_restore`，目标名称形如 `xiaok_migration_restore_*`，预检会拒绝已存在的目标。归档保留 owner/ACL。恢复工具以 OID、owner 和本次唯一标记确认清理对象并报告清理结果。

DBA 需预置归档涉及的角色及匹配扩展版本，处理扩展 owner/COMMENT 权限。审批和恢复证据见 [执行单](./xiaok-i7512-v1-database-migration-runbook.md) 与 [I7.4.9.8 角色验证](./xiaok-i798-restore-maintenance-role.md)。

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

## 9. 当前待批准事项

1. 由 DBA 批准真实开发库的全量导出，提供最小权限 `sfp_backup` 和进程级 `XIAOK_MIGRATION_BACKUP_URL`，指定带受限 ACL 的仓库外归档目录。
2. 由 DBA 批准独立 PG17 的恢复、建库和清理作用域，准备角色、扩展与维护库标记，提供进程级 `XIAOK_MIGRATION_RESTORE_URL`。
3. 完成真实备份和独立恢复取证后，由负责人批准停写维护窗口、候选 SHA、一次性迁移与必要时回滚的责任人。

正式执行条件、命令、结构预期和故障分流统一见 [I7.5.12 第一版迁移执行单](./xiaok-i7512-v1-database-migration-runbook.md)。

---

## 附录 A：I7.5.6 使用的只读命令

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

## 附录 B：I7.5.6 关键证据值

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
