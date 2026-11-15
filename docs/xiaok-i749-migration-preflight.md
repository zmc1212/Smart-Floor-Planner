# I7.4.9 微云 1454 开发库迁移前只读预检

2026-11-15 14:58（Asia/Shanghai），基线 `1f308d574db0`，分支 `codex/xiaok-integration`。实际待迁移项为 `0120`、`0124`–`0130`。**8 项结构与数据预检通过，正式执行仍为 `blocked`。** 当前缺少与 119 条账本绑定且验证可恢复的备份，以及负责人批准的开发库维护窗口。窗口开始前须确认所有写入入口静默。

| 核查项 | 状态 | 证据 |
| --- | --- | --- |
| 目标身份 | `passed` | 配置 `localhost:5432/smart_floor_planner`，实际使用 IPv4 `127.0.0.1:5432`。Windows 监听者是获批 SSH 转发，远端 `192.168.10.54` 的 `sfp-remote-dev-postgres` 当前将回环 `15432` 映射至容器 5432。服务端地址为 `172.18.0.2/32:5432`，版本为 PostgreSQL 17.10（`170010`）。 |
| 连接权限与企业 | `passed` | `current_database()=smart_floor_planner`，`current_user=session_user=sfp_app`，`rolsuper=false`，`rolbypassrls=false`。事务回读 `repeatable read` 和 `transaction_read_only=on`。微云 1454 存在且 active。 |
| 迁移账号 | `passed` | `sfp_migrator` 通过同一开发目标的只读登录，`rolsuper=false`、`rolbypassrls=false`。拥有所检查的既有迁移对象，具备 `app` schema CREATE 及账本读取和写入权限。权限均以目录查询核实。 |
| 账本和待迁移依赖 | `passed` | 119 条全部获正式校验器识别，末条 ID 125。8 项逐条检查均通过。 |
| 0021 列结构 | `failed` | 实际列可空且无默认值，有 8 行 NULL。源码的 Drizzle 声明和当前 0021 SQL 均要求非空并以空对象为默认值。 |
| 本机 Worker 健康 | `failed` | Windows 查得 0 个 Assistant Worker，3006、3016 均无监听。默认文件存在，健康检查报 `heartbeat_stale`。 |
| 容器运行检查 | `limited` | SSH 已查明获批远端没有 `assistant-worker` Compose 服务容器。本机 Docker Desktop Linux engine 不可达，容器清单无法读取。 |
| 备份工具与容量 | `passed` | 已核实获批开发容器的 `pg_dump` 和 `pg_restore` 均为 17.10，目标磁盘空间见下文。 |
| 当前备份与维护窗口 | `blocked` | 已检查目录无绑定当前账本的备份和恢复回执。执行窗口、写入侧静默与负责人批准待确认。 |
| 数据库写入、DDL、备份出档与正式恢复 | `not_run` | 现场数据库操作限于只读事务，连接以 `ROLLBACK` 结束。 |

## 迁移账本

读取 `app.__drizzle_migrations` 全部 119 条，使用正式 `validateLedger()`、活跃 journal、两个归档 fork 和 `known-hashes.json` 在内存校验。0021（行 28，`1786540800000`，`9df6e11e…ad8ab5c`）与 0051（行 58，`1788184800000`，`a41ef104…824939e`）均以完整 SHA-256 精确命中。其余 117 条匹配当前 journal。重复 timestamp、prefix gap、混合 fork 和白名单外未知迁移均为 0。正式委托结构校验返回 `absent`，与 0126 前的账本一致。

两次完整结果逐字节一致，账本 SHA-256 汇总为 `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381`。八条实际 pending 与 [I7.4.7.3 预演](./xiaok-i747-3-allowlist-rehearsal.md)相同。

## 0021 通知配置

`app.platform_configs.notification_config` 实测为 `jsonb`、`is_nullable=YES`、`column_default=NULL`，SQL NULL 共 8 行。唯一的 `key='default'` 行存在，存储版本为 2，含 8 类模板。应用的 normalizer 可以读取该值并补齐默认值，归一化后的模板 ID 通过格式和唯一性校验。当前存储行缺少新保存路径写入的布尔开关字段，运行时按现有规则使用默认关闭值。微信侧实际投递为 `not_run`。

| 模板类型 | 当前 ID 指纹 | 0021 种子指纹 | 与当前文档和运行时代码 |
| --- | --- | --- | --- |
| `workflow_todo` | `f69746265857` | `c76e674a1c0c` | 均匹配 |
| `lead_assignment` | `e9180ff7fb37` | `eb5d0dd4671f` | 均匹配 |
| `new_lead` | `cae3683a65ea` | `c01349e30192` | 均匹配 |
| `measurement_appointment` | `99f48d91511e` | `14362bf760ad` | 均匹配 |

本次重读修正了早期报告的三项差异结论。按当前文件，以上四类均与 0021 种子不同，且均与现行文档及 `DEFAULT_SUBSCRIPTION_TEMPLATES` 一致。对照只保留 SHA-256 前 12 位。[模板文档](./miniprogram-subscription-notification-template-baseline.zh-CN.md)

**推荐规范 B，`NOT NULL DEFAULT '{}'::jsonb`。** `schema.ts` 的 `notificationConfig` 调用 `jsonObject()`，该助手明确应用了 ``.notNull().default(sql`'{}'::jsonb`)``。运行时对 NULL 和缺字段保留兼容读法，正常保存写入完整配置。建议负责人单独批准一条追加迁移，只把 SQL NULL 回填成空对象，再设置默认值与非空约束，同时比对所有已有非空内容的摘要。该列漂移与本批八条 SQL 的执行前提独立，当前模板和开关应当按已保存配置保留。

## 八条待执行迁移

以下检查覆盖各迁移的现有宿主表、所需列和引用键、相关对象命名及索引签名。在批准的开发库平台读取范围内核了 56 个不同的既有 FK，孤儿为 0。所核对的对象冲突和重复索引均为 0。待新建表的历史行检查标为 `not_run`。

| 迁移 | 状态 | 现场结果与执行风险 |
| --- | --- | --- |
| `0120_construction_camera_sd_identity_version` | `passed` | SD 窗口表及其现有 FK 正常，新列与约束均不存在。现有行由新列默认值 0 满足检查约束。主要风险为现有表 DDL 锁。 |
| `0124_assistant_knowledge_integration` | `passed` | 知识表、旧 CHECK 和复合引用键在位。新列、索引、函数、触发器与管理索引库表无冲突。资产格式、来源形状、尝试操作三项违反数均为 0。注意替换 CHECK 的扫描锁。 |
| `0125_native_workflow_runtime_integration` | `passed` | 六张运行时目标表均不存在。企业主键与现有 Outbox delivery 索引所需列在位，无目标索引冲突。主要风险是新索引构建与既有表写入争用。 |
| `0126_native_workflow_delegation_integration` | `passed` | 账本走全新委托表分支。记忆、委托父子表及目标索引、函数和触发器均无冲突，项目、消息及 Outbox 引用键在位。执行后应核对新触发器与生产者的兼容性。 |
| `0127_native_workflow_delegation_compatibility` | `passed` | 依赖同一迁移事务内的 0126。当前无旧委托表可产生电气来源键重复，目标部分唯一索引名空闲。执行后核对 review/electrical 两种投影及唯一约束。 |
| `0128_xiaok_v1_stage_reminders` | `passed` | 提醒、暂停表及目标索引均不存在。企业和复合项目 FK 键在位。执行后核对 FORCE RLS、策略、授权与去重键。 |
| `0129_xiaok_v1_stage_reminder_receipts` | `passed` | 当前无提醒表和历史已投递行，依赖 0128 同事务建表。会话、消息两个复合被引用键均在位。回执 CHECK 与两条 FK 须在执行后确认。 |
| `0130_xiaok_pilot_project_scopes` | `passed` | Pilot Scope 表与校验函数不存在，无历史范围数据会触发新约束。企业主键、项目和线索的关联与归档字段在位。后续保存范围时须走原触发器，拒绝跨租户、重复或不可用项目引用。 |

## 备份、写入暂停与恢复

- 已确认实际库约 251.5 MiB。工作站 C 盘约有 32.7 GiB，G 盘约有 3.8 GiB，开发容器数据卷约有 937 GiB 可用。容器内已验证 PG17.10 的导出和恢复工具。目录显示仓库备份脚本默认选择 `postgres` 服务，并省略 owner 和 ACL，执行时应使用已核实的开发容器及保留或另行记录权限元数据的方案。
- `admin/.postgres-backups` 内所见最新 `smart_floor_planner` 文件时间为上海时间 2026-10-15 01:53，大小 6,187,753 字节，头部 `PGDMP`。它早于当前账本快照。旧预演和隔离夹具备份记录也早于或属于其他目标。当前备份能力已验证，当前可恢复快照待建立并验收。
- 负责人批准窗口后，先盘点所有请求生产者和消费者，确认无在途写入、Worker tick 和调度活动。当前 Windows Worker 已无进程，`G:/AppData/Local/Temp/assistant-worker-health.json` 最后成功为上海时间 `00:58:41.164`，14:58 时已过去 50,367 秒。主 Compose 的 `assistant` profile 调用 `admin:3005`，实际远端开发 Compose 只承载数据库相关服务。迁移窗口仍须复核部署侧实际写入者。
- 从已确认的开发主库导出完整 custom archive 到受控存储。备份账号须具备跨 FORCE RLS 表的完整读取权限，目录中核实的 `sfp_owner` 具该能力。记录源库、账本摘要、时间、字节数与 SHA-256，用 `pg_restore --list` 检查目录，并在独立 PG17 恢复库复核 119 条账本、代表性表行数、权限与 RLS。当前权限核实未登录备份账号。
- 备份通过后由负责人批准在该开发库使用 `sfp_migrator` 正式执行八条待迁移。迁移后先验收，再通过现有开发启动器恢复单个受管 Worker，核对端口及近期成功心跳，并观察积压按原租约、Outbox 和投递幂等机制推进。

## 迁移后验收

1. 正式校验器识别 127 条账本、原 119 行原样保留、两条白名单历史记录仍精确命中，pending 为空。
2. 验证八条迁移的列、CHECK、FK、索引、触发器、角色授权和 FORCE RLS。对照预迁移账本和数据摘要核查既有行。
3. 按当前开发库重新做企业 1454 只读试点预检。需要提交实际项目范围时，由有权限的管理员独立办理。
4. 验收通过并授权恢复后核对 Worker、提醒和周报回执、Outbox 积压及去重。通知配置的结构对齐单独记录，不重放历史模板种子。

## 复跑与测试

`npm run check:migration-preflight -- --enterprise-id 1454` 只连接已经核实的 Windows 开发 SSH 转发，使用 `sfp_app` 和只读快照。输出包含实际 pending、结构漂移、约束冲突及 Worker 观察值。当前 CLI 为 `limited`，对应独立的通知配置漂移。正式执行条件见本报告开头。

- 两次实际 CLI 结果逐字节相同，26 个绑定源码或配置文件前后摘要一致。脱敏回执在本机 `tmp/xiaok-i749/run1.json`、`run2.json`、`stability.json` 和 `migration-role.json`。
- 迁移器定向 18 项通过、7 项跳过。预检定向 9 项通过。`pilot-readiness.test.ts` 已运行，20 项需要建库或写入 fixture 的用例均跳过。实际开发库证据来自上面的只读检查。
- TypeScript、定向 ESLint 和 `git diff --check` 通过。初次 CLI 因加载 Worker 模块的格式兼容问题在连接数据库前退出，修正后按正式命令复跑，原始结果保留在 `startup-attempt.json`。
