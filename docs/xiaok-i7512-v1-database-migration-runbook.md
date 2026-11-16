# 家客来 I7.5.12 第一版数据库迁移执行单

状态 **已完成 I7.5.16 审查，待签批执行**。V1 批次为 `codex/xiaok-integration` 开发库 `127.0.0.1:5432/smart_floor_planner` 的 **119 → 129**，隔离恢复实例为 i798 `127.0.0.1:55437`。按已审查的十条迁移、Journal 和实际候选提交签批。历史真实归档与恢复回执已在当前门禁通过只读复核。 [最终审查、SHA 与审批](./xiaok-i7516-migration-final-review.md) · [DBA 执行报告](./xiaok-i7512-dba-execution-report.md)

## 审批和凭据

| 事项 | 责任与放行条件 |
| --- | --- |
| 源库全量导出 | 复用已核验的 `sfp_backup`。DBA 批准本窗口的真实导出并复核 `LOGIN`、`BYPASSRLS`、`CONNECT`、`app` 的 `USAGE` 及表/序列 `SELECT`。要求 `NOSUPERUSER`、无业务写权限、无 owner/migrator 成员关系。受控进程注入 `XIAOK_MIGRATION_BACKUP_URL`。 |
| 归档保管 | 指定仓库外的受限目录、授权操作者、保留期限和责任人。当前核验目录为 `C:\sfp-backups\i7512-20261116`，可用空间至少满足当前源库逻辑大小和 10 GiB 运维阈值中的较大值。 |
| 独立恢复 | DBA 审批本窗口对真实归档的访问和新演练库的创建及清理。复核 i798 的隔离标记 `xiaok-i749-isolated-test`、模板扩展及所有者、`sfp_restore` 登录和 `sfp_migrator` 的 `INHERIT/SET`。`XIAOK_MIGRATION_RESTORE_URL` 使用 i798 的 `postgres` 维护库。明确 `en_US.utf8` 与 `C` 的排序差异如何处置，以及实际回滚目标需要的排序兼容性。 |
| 正式执行 | 负责人确认开发库端点、候选 SHA、十条 SQL 的实际执行哈希、维护窗口、停写和回滚责任人。由 `sfp_migrator` 通过显式注入的 `DATABASE_MIGRATION_URL` 执行一次，预先核对其解析到核验过的开发端点。 |

维护凭据从安全渠道注入当前进程。执行单、Git、命令历史和回执只记录变量名及检查结果。操作使用专用账号，保留原业务租户权限。

## 迁移前后结构差异

下表适用于源库 119 条账本、无旧委托分叉的路径。I7.4.9.4 在隔离合成数据上验证过前九条。0132 的隔离数据库与百炼验收见 I7.5.15。本窗口按实际候选执行后逐项比对。 [历史完整演练](./xiaok-i794-full-migration-restore-acceptance.md) · [I7.5.15 验收](./xiaok-i7515-bailian-rag-integration.md)

| 顺序 | 迁移 | 迁移前与依赖 | 提交后应见 |
| --- | --- | --- | --- |
| 1 | 0120 | `construction_camera_sd_windows` 已存在，身份版本列和约束均尚未加入 | 新增 `identity_version smallint NOT NULL DEFAULT 0` 和取值 `0/1` 的 CHECK |
| 2 | 0124 | 文档、资产、版本、分块、尝试、索引 profile 和任务表存在。核对旧 CHECK、现有格式/来源形状及项目、profile、任务、版本复合唯一键 | 文档增加 `scope/project_id`、项目复合 FK、索引及防改触发器。扩展资产格式、版本来源和尝试类型 CHECK，新增 `provider_request_id`，分块 `embedding` 允许 NULL。新增 `assistant_managed_knowledge_libraries`、`assistant_managed_knowledge_imports` 和导入索引及 FORCE RLS |
| 3 | 0125 | `enterprises` 与 `domain_event_deliveries` 存在，事件投递所需列齐备 | 新增 `native_workflow_runs`、`native_workflow_schedule_runs`、`native_workflow_report_batches`、`native_workflow_schedule_controls`、`native_workflow_schedule_ledgers`、`native_workflow_durable_tasks`，均带 FORCE RLS。新增运行时索引和事件投递部分索引 |
| 4 | 0126 | 当前账本委托结构为 `absent`。依赖企业、用户主键，项目、消息、outbox 复合键及计划和投递表。核对函数/触发器名 | 新增 `assistant_long_term_memories`、`native_workflow_delegations`、`native_workflow_delegation_events`，含原生/审阅投影、索引和 FORCE RLS。outbox、项目、计划三表获得委托触发器 |
| 5 | 0127 | 接续 0126 的委托与事件结构，依赖项目、计划、outbox 和投递表 | 替换四个委托函数和三个触发器，移除旧通用 origin 唯一约束，新增 `native_delegation_electrical_origin` 部分唯一索引 |
| 6 | 0128 | `enterprises`、项目复合键和租户策略所用函数已存在 | 新增 `construction_stage_reminders`、`construction_stage_reminder_pauses`，含去重、收件箱/项目索引、租户策略和 FORCE RLS |
| 7 | 0129 | 接续 0128，已有会话和消息的租户复合键 | 提醒表新增 `conversation_id`、`message_id`、两个复合 FK，已投递行必须有消息回执 |
| 8 | 0130 | 项目和线索的企业归属及归档字段已存在 | 新增 `xiaok_pilot_project_scopes`、租户策略、FORCE RLS、校验函数与 `xiaok_pilot_projects_available` 触发器。应用角色在表上拥有 SELECT、INSERT |
| 9 | 0131 | `platform_configs.notification_config` 为可空 jsonb、无默认值，当前 8 行 NULL，已有一条非空 `default` 行，记录其摘要 | 8 行 NULL 回填为 `{}`，列为 `NOT NULL DEFAULT '{}'::jsonb`。复验 `default` 行全文摘要及模板指纹一致 |
| 10 | 0132 | 接续 0124 的托管映射。引用表 owner、原租户策略、旧来源 FK 和历史行已核验。依赖企业主键、知识版本/分片复合键与 `admin_users` | 新增空的单例平台映射，`sfp_app` 只有 SELECT。引用表新增来源归属字段、CHECK、绑定触发器及平台映射 FK，替换两条来源复合 FK。历史行回填为原租户。引用与知识表继续 FORCE RLS，托管库索引身份加防改触发器 |

前 119 行三元组 `(id, hash, created_at)` 原样保留，0021/0051 的批准历史哈希逐项核对。十条新增记录以 [最终审查的顺序和时间戳](./xiaok-i7516-migration-final-review.md#迁移文件与-journal) 及**实际执行检出字节**的 SHA-256 对账。预期新增 15 张 `app` 表，其中 14 张强制 RLS，整体为 167 张强制 RLS 表。平台映射是全局只读配置。运行器在同一事务内持有 advisory lock 并写入账本。0131 持有 `ACCESS EXCLUSIVE`，其本地 5 秒 `lock_timeout`、60 秒 `statement_timeout` 也适用于接续的 0132。保持十条同次提交。

## 运维步骤与停点

1. **只读盘点。** 在 `admin` 运行统一门禁，填入批准的目录、PG17 工具目录和未占用的演练库名。记录候选 SHA、源账本摘要、实际 SQL 与 Journal 哈希、当前连接、Worker/应用监听和 `default` 行摘要。留存引用总数、旧 FK 违例数及 0132 前置状态。历史归档和回执可用于环境复核。
2. **批准后停写并备份。** 确认应用、作业、批量导入等写入源暂停，复核活动连接和长事务，保持停写直到校验和执行决策。对批准目录运行 `db:migration-backup`，记录退出码、实际候选 SHA、开始/结束时间及终端 JSON。归档目录应包含 `database.dump`、`database.dump.sha256`、`migration-backup-manifest.json`。摘要和 `pg_dump` 使用同一导出事务快照。序列不受 MVCC 快照约束，因此仍需停写。 [pg_dump snapshot](https://www.postgresql.org/docs/17/app-pgdump.html#APP-PGDUMP-OPTION-SNAPSHOT) · [PostgreSQL sequence functions](https://www.postgresql.org/docs/17/functions-sequence.html)
3. **独立恢复。** 仅使用本窗口备份的 Manifest 和归档，选择一个全新的 `xiaok_migration_restore_*`。记录程序退出码、目标/角色、归档及 Manifest 摘要、`full_restore_passed=true`、账本/数据/RLS/权限/结构和清理结果。默认清理本次创建且 OID、owner 和运行标记仍匹配的库。保留失败回执。归档恢复使用一个事务。 [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)
4. **正式放行。** 在同一停写窗口，以步骤 2、3 的文件重新跑统一门禁。要求 `overall_readiness=passed`、归档为本窗口生成、当前源账本与回执一致、停写继续有效，并记录负责人签批。使用已批准的开发端点执行一次 `npm run db:migrate`。遇到锁超时或出口状态不明转入下面的故障处理。
5. **完成判定。** 保持停写，用 `npm run check:migration-preflight -- --enterprise-id 1454` 只读验证 `ledger.count=129`、`pending=[]`、历史哈希和 `integrated` 委托结构。核对账本前缀和实际 SHA 后缀、0131 NULL 为 0 且 `defaultRowDigest` 与模板指纹一致。执行下列 0132 结构及数据复核。负责人确认后恢复访问，Worker 与真实通知依单独审批。 [四端权限和回执验收](./xiaok-i7511-four-end-real-page-acceptance.md)

### 0132 提交后复核

- 从 `pg_class`、`pg_policies` 核对引用表、知识版本、分片、托管库与导入表的 `ENABLE`、`FORCE` 和租户策略。引用的会话/消息、会话/运行复合 FK 仍使用 `enterprise_id`。
- 从 `pg_constraint`、`pg_attribute` 和 `pg_trigger` 核对来源字段与三条来源 FK。两条 `assistant_citation_source_*` 复合 FK 已验证，分片删除只置空 `chunk_id`。核对来源 CHECK、插入绑定及托管映射防改触发器均已启用。
- 核对平台映射仍为零行，`has_table_privilege` 对 `sfp_app` 的 SELECT 为真，逐项检查 INSERT、UPDATE、DELETE、TRUNCATE 和 SELECT 授权选项为假。确认 `PUBLIC` 无表权限，应用角色无法切换为 owner。
- 对照停写时引用总数，确认引用没有丢失，`platform_knowledge_enterprise_id` 均为 NULL，`source_enterprise_id=enterprise_id`，原 `chunk_id` 空值数量相符。复验会话中历史引用的当前授权读回。启用公共库需另行审批。

命令示例中的 `$BackupDir`、`$PgBin`、`$RestoreTarget` 为本次已审批路径与库名，`$Manifest` 取自步骤 2 的真实结果，`$RestoreReceipt` 为同一受限目录下的全新文件名。先检查每一步退出码再继续。

~~~powershell
Set-Location admin
$env:NODE_ENV = 'development'
$env:XIAOK_MIGRATION_MIN_FREE_BYTES = '10737418240'
npm run xiaok:migration -- --backup-dir $BackupDir --pg-bin $PgBin --target-database $RestoreTarget
npm run db:migration-backup -- --mode development --output-dir $BackupDir --pg-bin $PgBin --label i7512-pre
npm.cmd --silent run db:migration-restore-verify -- --mode isolated --manifest $Manifest --target-database $RestoreTarget --pg-bin $PgBin |
    Out-File -LiteralPath $RestoreReceipt -Encoding utf8 -NoClobber
npm run xiaok:migration -- --backup-dir $BackupDir --pg-bin $PgBin --target-database $RestoreTarget --manifest $Manifest --restore-receipt $RestoreReceipt
~~~

## 回滚与未知结果

| 状态 | 处置与验收 |
| --- | --- |
| 备份、SHA、恢复或门禁失败 | 停在执行前。保留日志、归档和失败回执。由 DBA 查明缺项后选用新输出或新演练库重试。 |
| 事务报错并已回滚 | 保持停写。复核账本仍 119 条、摘要与迁移前一致、迁移目标结构未提交。序列号可能留下空洞。记录 SQLSTATE（如 0131 取锁超时 `55P03`），核对阻塞原因，再由负责人决定新窗口。 |
| 超时、断连或提交结果未知 | 保持停写和原归档。先从核验端点重新只读查询，按 119 条与旧结构、129 条与新结构的实测状态归类。若状态不一致，由 DBA 保留现场并排查。 |
| 已提交、验证失败或需回退 | 回滚责任人另行批准切换。保全现库和提交后的写入快照。使用同一已验证归档，在新批准的独立目标恢复，校验源前置账本、数据摘要、权限、RLS 和通知配置。按备份时间盘点并协调提交后的变动，确认应用访问与监控后再切换连接。旧库和经验证的备份继续留存。 |

填写回执时记录候选 SHA、源归档编号/时间/SHA、停写与审批人、目标端口及角色、排序差异处置、五项门禁状态、实际账本及配置摘要、恢复或执行退出码、切换决定和责任人。 [当前 DBA 环境与回执](./xiaok-i7512-dba-execution-report.md)
