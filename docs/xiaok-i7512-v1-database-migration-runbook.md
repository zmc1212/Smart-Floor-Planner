# 家客来 I7.5.12 第一版数据库迁移执行单

状态 **待审批，未执行**。范围为 `codex/xiaok-integration` 的开发库 `127.0.0.1:5432/smart_floor_planner`（已核验的开发 SSH 转发）和另行批准的独立 PG17 恢复集群。基线为 I7.5.12 开工时的 `2f1729b56120319c70c6edf1856a201c7dbb6f6a`，执行时填写实际候选提交和维护窗口。生产发布与 Worker/通知恢复各有独立审批。

## 审批和凭据

| 事项 | 责任与放行条件 |
| --- | --- |
| 源库全量导出 | DBA 批准该开发库的迁移级导出，创建 `sfp_backup`。仅此角色拥有快照导出所需的 `LOGIN`、`BYPASSRLS`、`CONNECT`、`app` 的 `USAGE`、表和序列 `SELECT`。要求 `NOSUPERUSER`、无业务写权限、无 owner/migrator 成员关系。通过受控进程环境注入 `XIAOK_MIGRATION_BACKUP_URL`。 |
| 归档保管 | 指定本机仓库外的专用目录及授权操作者，核对 ACL 和磁盘容量。可用字节至少满足源库逻辑大小、工具最低空间和本次运维阈值三者中的最大值。记录受限目录、保留期限和责任人。 |
| 独立恢复 | DBA 批准独立 PG17 实例、真实归档的数据访问和新演练库的创建/清理范围。维护库为 `postgres`，标记 `xiaok-i749-isolated-test`。实例使用单独的回环高端口并且目录中没有 `smart_floor_planner`。`sfp_restore` 仅存在于此集群，具备 `LOGIN CREATEDB BYPASSRLS NOSUPERUSER NOCREATEROLE NOREPLICATION`。预置归档涉及的业务角色及 owner 成员关系（包括 `sfp_migrator` 的 `INHERIT`、`SET`），并准备兼容的编码、排序规则和扩展（源库历史记录为 `btree_gist 1.7`、`vector 0.8.2`、内置 `plpgsql`）。扩展安装、归属和注释权限由 DBA 在该隔离环境预置并随恢复实测。注入 `XIAOK_MIGRATION_RESTORE_URL`，登录为 `sfp_restore`，URL 的数据库为 `postgres`。 |
| 正式执行 | 负责人确认开发库端点、候选 SHA、变更窗口、停写责任人和回滚责任人。由 `sfp_migrator` 使用 `DATABASE_MIGRATION_URL` 一次执行。运维在执行前确认该进程解析到同一开发目标。 |

维护凭据从安全渠道注入当前进程。执行单、Git、命令历史和回执只记录变量名及检查结果。操作使用专用账号，保留原业务租户权限。

## 迁移前后结构差异

以下为当前开发账本下的预期差异。I7.4.9.4 在隔离合成数据上验证过相同的 9 个 SQL 哈希，实际开发库后的检查留待签批执行。文件 SHA-256 与 journal 明细由 `xiaok:migration` 输出。[历史完整演练](./xiaok-i794-full-migration-restore-acceptance.md)

| 顺序 | 迁移 | 迁移前与依赖 | 提交后应见 |
| --- | --- | --- | --- |
| 1 | 0120 | `construction_camera_sd_windows` 已存在，身份版本列和约束均尚未加入 | 新增 `identity_version smallint NOT NULL DEFAULT 0` 和取值 `0/1` 的 CHECK |
| 2 | 0124 | 文档、资产、版本、分块和尝试表存在。核对旧 CHECK、项目/版本等复合唯一键、现有格式和来源形状 | 文档增加 `scope/project_id`、项目复合 FK、索引及防改触发器。扩展资产格式、版本来源和尝试类型 CHECK，新增 `provider_request_id`，分块 `embedding` 允许 NULL。新增 `assistant_managed_knowledge_libraries`、`assistant_managed_knowledge_imports` 和导入索引及 FORCE RLS |
| 3 | 0125 | `enterprises` 与 `domain_event_deliveries` 存在，事件投递所需列齐备 | 新增 `native_workflow_runs`、`native_workflow_schedule_runs`、`native_workflow_report_batches`、`native_workflow_schedule_controls`、`native_workflow_schedule_ledgers`、`native_workflow_durable_tasks`，均带 FORCE RLS。新增运行时索引和事件投递部分索引 |
| 4 | 0126 | 当前账本委托结构为 `absent`，检查项目、消息、outbox 复合 FK 键，函数/触发器名无冲突 | 新增 `assistant_long_term_memories`、`native_workflow_delegations`、`native_workflow_delegation_events`，含原生/审阅投影、索引和 FORCE RLS。outbox、项目、计划三表获得委托触发器 |
| 5 | 0127 | 接续 0126 的委托结构 | 替换四个委托函数和三个触发器，移除旧通用 origin 唯一约束，新增 `native_delegation_electrical_origin` 部分唯一索引 |
| 6 | 0128 | `enterprises`、项目复合键和租户策略所用函数已存在 | 新增 `construction_stage_reminders`、`construction_stage_reminder_pauses`，含去重、收件箱/项目索引、租户策略和 FORCE RLS |
| 7 | 0129 | 接续 0128，已有会话和消息的租户复合键 | 提醒表新增 `conversation_id`、`message_id`、两个复合 FK，已投递行必须有消息回执 |
| 8 | 0130 | 项目和线索的企业归属及归档字段已存在 | 新增 `xiaok_pilot_project_scopes`、租户策略、FORCE RLS、校验函数与 `xiaok_pilot_projects_available` 触发器。应用角色在表上拥有 SELECT、INSERT |
| 9 | 0131 | `platform_configs.notification_config` 为可空 jsonb、无默认值，当前 8 行 NULL，已有一条非空 `default` 行，记录其摘要 | 8 行 NULL 回填为 `{}`，列为 `NOT NULL DEFAULT '{}'::jsonb`。复验 `default` 行全文摘要及模板指纹一致 |

预期账本 **119 → 128**。前 119 行三元组 `(id, hash, created_at)` 原样保留，0021/0051 的批准历史哈希逐项核对。新增 9 行的顺序、时间戳和文件 SHA 应匹配 journal 与实际候选提交。复核 14 张新增业务表的 FORCE RLS 和权限。锁贯穿整个事务。0131 使用 `ACCESS EXCLUSIVE` 和 5 秒 `lock_timeout`，本批次不拆分。

## 运维步骤与停点

1. **只读盘点。** 在 `admin` 运行统一门禁，填入批准的目录、PG17 工具目录和未占用的演练库名。记录候选 SHA、源账本摘要、每项状态、客户端版本、源库大小、当前连接、Worker/应用监听与 `default` 行摘要。首次检查会显示归档和演练回执待提供。
2. **批准后停写并备份。** 确认应用、作业、批量导入等写入源暂停，复核活动连接和长事务，保持停写直到校验和执行决策。对批准目录运行 `db:migration-backup`，记录退出码、实际候选 SHA、开始/结束时间及终端 JSON。归档目录应包含 `database.dump`、`database.dump.sha256`、`migration-backup-manifest.json`。摘要和 `pg_dump` 使用同一导出事务快照。序列不受 MVCC 快照约束，因此仍需停写。 [pg_dump snapshot](https://www.postgresql.org/docs/17/app-pgdump.html#APP-PGDUMP-OPTION-SNAPSHOT) · [PostgreSQL sequence functions](https://www.postgresql.org/docs/17/functions-sequence.html)
3. **独立恢复。** 仅使用这次备份目录中的 Manifest 和归档，选择一个全新的 `xiaok_migration_restore_*`。校验记录需包含程序退出码、目标/角色、归档及 Manifest SHA、`full_restore_passed=true`、账本/数据/RLS/权限/结构逐项通过和清理结果。使用独立证据文件名，保留失败回执。默认清理本次创建且 OID、owner 和运行标记仍匹配的库。若使用 `--keep-target`，由 DBA 按审批保留和处置，下一次用新库名。恢复使用一个事务。[pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)
4. **正式放行。** 在同一停写窗口，以步骤 2、3 的文件重新跑统一门禁。要求 `overall_readiness=passed`、归档为本窗口生成、当前源账本与回执一致、停写继续有效，并记录负责人签批。使用已批准的开发端点执行一次 `npm run db:migrate`。遇到锁超时或出口状态不明转入下面的故障处理。
5. **完成判定。** 保持停写，执行 `npm run check:migration-preflight -- --enterprise-id 1454`，预期 `ledger.count=128`、`pending=[]`、历史哈希精确、委托结构为 `integrated`。只读比对账本前三列的前缀及新增后缀，按上表复核列、约束、索引、触发器和 FORCE RLS。核对 NULL 为 0 且 `defaultRowDigest` 及模板指纹原样。保存迁移命令回执、迁移后只读证据，由负责人确认再恢复访问。Worker 与真实通知依照单独审批处理。迁移完成后的四端权限和回执验收引用 [I7.5.11](./xiaok-i7511-four-end-real-page-acceptance.md)。

命令示例中的 `$BackupDir`、`$PgBin`、`$RestoreTarget` 为本次已审批路径与库名，`$Manifest` 取自步骤 2 的真实结果，`$RestoreReceipt` 为同一受限目录下的全新文件名。先检查每一步退出码再继续。

~~~powershell
Set-Location admin
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
| 超时、断连或提交结果未知 | 保持停写和原归档。先从已核验端点重新只读查询，按 119 条及旧结构、128 条及新结构的实测状态归类。若状态不一致，由 DBA 保留现场并排查。 |
| 已提交、验证失败或需回退 | 回滚责任人另行批准切换。保全现库和提交后的写入快照。使用同一已验证归档，在新批准的独立目标恢复，校验源前置账本、数据摘要、权限、RLS 和通知配置。按备份时间盘点并协调提交后的变动，确认应用访问与监控后再切换连接。旧库和经验证的备份继续留存。 |

填写回执时记录候选 SHA、源归档编号/时间/SHA、停写与审批人、目标端口及角色、五项门禁状态、实际账本及配置摘要、恢复或执行退出码、切换决定和责任人。当前只读结果见 [数据库环境准备](./xiaok-i756-database-environment-preparation.md#i7512-当前只读复核)。
