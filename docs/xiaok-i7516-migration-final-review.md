# 家客来 I7.5.16 百炼 RAG 迁移最终审查

2026-11-16（Asia/Shanghai）。**I7.5.16 审查通过，0132 纳入第一版十条迁移。** 开工从 `git fetch origin` 后的 `origin/codex/xiaok-integration` 取得基线 `dc39b4832421906ae877f8b877da547a405dd98e`。核对主工作区与九个已挂载的其他工作树，均无未提交迁移。以下为当时的审查快照。 [I7.5.17 开发库执行回执](./xiaok-i7512-dba-execution-report.md#i7517-开发库正式执行) · [正式迁移执行单](./xiaok-i7512-v1-database-migration-runbook.md)

## 迁移文件与 Journal

活动 Journal `admin/drizzle/meta/_journal.json` 为 PostgreSQL v7，共 129 项，Git 源文件 SHA-256 为 `bdb796add1c0faf5deeca7dfdf323022ff70d04c4c3097112e3df145605dd754`。当前 Windows 检出 SHA-256 为 `110c97e78f90bf26426479d9bbb8fe7cd849973f69af8e7a59a14a37d18206f5`，转为 LF 后与 Git 一致。Drizzle 以实际执行检出字节计算账本哈希，正式执行前保留该次门禁输出。以下路径均相对于 `admin/drizzle/`。

| Journal idx | `when` | SQL 文件 | Git 源文件 SHA-256 | 本次 Windows 检出 SHA-256 |
| ---: | ---: | --- | --- | --- |
| 119 | 1794988800000 | `0120_construction_camera_sd_identity_version.sql` | `77e94a3477f5483ddcf25f3818beb1e4d638462967d53f848cc6f2af7640eb98` | `4bf4f4f9a0ce596a9377a04091dc7ca520ff910500c6e163bd75110292e005f2` |
| 120 | 1795334400000 | `0124_assistant_knowledge_integration.sql` | `a95eaa90da3f1d5f1e0a0f55ce2c8d11c23ab5fc44854934977b9b383cb514cc` | `e17d50b8b85aa77277dce9a5d9043ea3d51a641e2647c3bb2046dc86d6e77788` |
| 121 | 1795420800000 | `0125_native_workflow_runtime_integration.sql` | `11c92f942dd52c3727b161dd9403fefc8a5c819794b2088dfcfc5b773917c642` | `6cc59fb40d57dc5a7829bbae9a9bc6e179017855044682a9955642768e7b84f7` |
| 122 | 1795507200000 | `0126_native_workflow_delegation_integration.sql` | `9a040096bc184293bb8dc2f654fbab43f8c76553cc70d862e805e826de6591fe` | `08cdb5a0a16f965a4857af2e938f42ccff74c3aa854e312713d423fc2c37989c` |
| 123 | 1795593600000 | `0127_native_workflow_delegation_compatibility.sql` | `096b8b85b537dbaebc38bc34a4a58d860aaba6e93fea7b8027b7b2f9152a50f0` | `83350941abebc88e19dd63eaccafa1e6d1a5008a7e04c68770f5e28ccd5ae09c` |
| 124 | 1795680000000 | `0128_xiaok_v1_stage_reminders.sql` | `2176a1199a2212b5b620e270ff8249d3aedc889dc3760d9e81cab9674862b49c` | 同 Git |
| 125 | 1795766400000 | `0129_xiaok_v1_stage_reminder_receipts.sql` | `966e93d18077b77773a5fb215ba3863f7fbbadddc51807176d09e44aa6263618` | 同 Git |
| 126 | 1795852800000 | `0130_xiaok_pilot_project_scopes.sql` | `49ede82f820ccd9c66b3911419c8784f1e43c6396c21ea7f40ea36b9a21501ee` | 同 Git |
| 127 | 1796457600000 | `0131_platform_notification_config_not_null.sql` | `a7fd555fa43a149ddffc74067e6263cbf91446cf67d581706491756a86386291` | 同 Git |
| 128 | 1796544000000 | `0132_assistant_platform_knowledge_citations.sql` | `bb0cdebdd3e28b7fae20964f2973b5afafb1e9f4da904c366ead2f4c1e3e769e` | 同 Git |

源库实测 **119 条**，末条 ID `125` / `0119_platform_portfolio_templates` / `1794902400000`。摘要 `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381`，0021、0051 的历史许可哈希精确匹配，时间戳无重复，活动前缀完整，旧分叉为 `null`，委托结构为 `absent`。十条迁移依赖均通过源库只读检查。提交预期 **129 条**、`pending=[]`、委托结构 `integrated`。新增的 15 张表中，14 张启用 FORCE RLS，平台映射为全局只读配置。每条迁移的依赖、结构差异及提交后检查见 [执行单的结构差异](./xiaok-i7512-v1-database-migration-runbook.md#迁移前后结构差异)。

## 0132 结构、权限与生命周期

| 检查项 | 迁移前 | 预计提交后 |
| --- | --- | --- |
| 平台映射 | 无该表 | `assistant_platform_knowledge_library` 最多一行，`singleton` 主键仅允许 `true`，`enterprise_id` 唯一且引用企业主键。SQL 只建结构，初始零行。平台映射由 DBA 管理。 |
| 引用来源归属 | 用引用所在的 `enterprise_id` 查版本和分片 | 新增可空 `platform_knowledge_enterprise_id`，以 FK 指向单例语料企业。新增 `source_enterprise_id bigint NOT NULL`，CHECK 和插入触发器将其绑定为 `COALESCE(platform_knowledge_enterprise_id, enterprise_id)`。 |
| 来源与会话 FK | 两条来源 FK 绑定本企业，分别指向版本、分片 | 版本 FK 使用 `(source_enterprise_id, document_id, document_version_id)`，分片 FK 使用 `(source_enterprise_id, document_version_id, chunk_id)`，均依赖有效复合唯一键。会话/消息与会话/运行 FK 继续使用引用所在企业键。 |
| FORCE RLS 与平台授权 | 引用、版本、分片均启用并强制 RLS。引用有 `assistant_message_citations_tenant` | `USING` 和 `WITH CHECK` 继续以会话企业或既有平台上下文判定，独立于来源归属。引用表在原子回填中短暂 `NO FORCE` 供 owner 更新全表，`ENABLE` 始终有效，提交前恢复 `FORCE`。`sfp_app` 与 PUBLIC 的原映射授权被撤销，再单独向 `sfp_app` 授 SELECT。 |
| 托管索引与发布 | 0124 创建托管租户映射。平台映射及专属管理员检查尚未建立 | 平台承载库通过现有服务发布，由活跃的 `admin/super_admin` 管理且账号无需改密。托管库触发器固定企业、Workspace、profile、索引名及已绑定的 index ID，允许首次补齐空 index ID。 |

- **权限核对。** 实测源库引用表、版本、分片均属 `sfp_migrator` 并保持 FORCE RLS，迁移角色具备建立来源 FK 的 REFERENCES 权限。非超级、非 BYPASSRLS 的 `sfp_app` 无继承或切换其他角色的能力，默认 ACL 中的直接写权限由 0132 的显式 REVOKE 清掉。现有隔离验收中该账号写平台映射收到 `42501`。平台发布检查是 invoker 函数，由已认证服务传入管理员 ID，复用事务内的平台上下文，源库已核对 `admin_users` 的查询及 `FOR SHARE` 所需权限。表和 FK 保证归属完整性，应用校验会话授权、语料受众、当前版本、原文哈希、阶段和有效性。 [迁移 SQL](../admin/drizzle/0132_assistant_platform_knowledge_citations.sql) · [I7.5.15 隔离及实云证据](./xiaok-i7515-bailian-rag-integration.md)
- **历史回填。** 源库有 1,035 条引用，`chunk_id` 空值为 0，预检中 `enterprise_id` 空值、旧 FK 违例、复合键缺失和对象冲突均为 0。0132 将历史引用的 `source_enterprise_id` 回填为原 `enterprise_id`，平台列保持 NULL。原引用标识、会话归属和快照可继续按授权回读，按停写快照复核总数和原空值数量。
- **退役、替换与删除。** 公共证据只取当前映射的活跃企业、已发布的当前版本和 `customer_public` 的企业级资料，排除案例和企业规则。平台源退役、换版、失效或失去授权后回读返回 `source_unavailable`，消息投影隐去引用相关旧内容。托管企业版本替换时撤销旧导入，清理随后执行。旧的本地企业历史引用仍按既有历史模式、授权及索引有效性判定。物理删除分片只把 `chunk_id` 置空，已有引用约束阻止直接删被引用的版本或映射。需要更换承载企业时，先处置历史引用和留存义务。 [回读与投影](../admin/src/lib/assistant/knowledge/sources.ts) · [PostgreSQL 17 行级安全](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- **当前运行依赖。** 普通知识管理也会查平台映射。允许公共补充的会话检索与引用重开绑定该映射，保存企业知识引用时同一 INSERT 明确写入 `platform_knowledge_enterprise_id`，即使传入 NULL。正式应用与 Worker 使用这些路径前需完成迁移。映射为空时按现有规则继续提供企业知识。 [平台映射](../admin/src/lib/assistant/knowledge/platform-library.ts) · [引用写入](../admin/src/lib/assistant/knowledge/save-citation.ts) · [检索](../admin/src/lib/assistant/knowledge/retrieval.ts)
- **事务与锁。** 运行器在同一事务和 advisory lock 内执行十条迁移和账本插入。0132 首次 ALTER 引用表持有 `ACCESS EXCLUSIVE`，覆盖回填和 FORCE 恢复，二者随同事务提交或回滚。0131 的本地锁和语句超时继续约束 0132。保留整个事务及失败回执。 [迁移运行器](../admin/scripts/postgres-integration-migrations.mjs) · [PG17 ALTER TABLE](https://www.postgresql.org/docs/17/sql-altertable.html)

## 恢复兼容性与最新环境

| 检查 | 只读实测 |
| --- | --- |
| 源库与 `sfp_backup` | 核验 SSH 转发、PG17.10、源系统标识 `7696770731622109222` 和 pgvector 0.8.2。专用账号已建，角色与登录均通过，无业务写权限，`sfp_restore` 不在源集群。 |
| 备份目录 | `C:\sfp-backups\i7512-20261116` 仅授权本机 Administrator、Administrators、SYSTEM，禁用继承。归档子目录沿用受限 ACL。可用空间 24,923,222,016 字节，多于 10 GiB。 |
| i798 ACL、实例与 `sfp_restore` | `C:\i798\data` 继承受保护的 `C:\i798` ACL，仅上述三方。回环 55437 已运行，PG17.10，系统标识 `7708385522403597728`，独立标记有效。角色已建，具 `CREATEDB/BYPASSRLS` 及 migrator INHERIT/SET，维护连接通过。历史演练库已释放。 |
| pgvector 安装条件 | i798 专用运行目录的 3 个扩展文件哈希与已构建件一致。`template1` 已有 `vector 0.8.2`、`btree_gist 1.7`，均为 `sfp_migrator` 所有，向量算子实测通过。新库继承模板，`sfp_restore` 可使用 owner 权限恢复对象及注释。未预装的环境需要 DBA 预置，vector 控制文件声明 `superuser=true, trusted=false`。 [PG17 扩展安装](https://www.postgresql.org/docs/17/sql-createextension.html) |
| 维护凭据 | `XIAOK_MIGRATION_BACKUP_URL` 和 `XIAOK_MIGRATION_RESTORE_URL` 的两份 DPAPI 文件 ACL 受限，解密、端点绑定及只读登录通过。当前已检查的本地应用/Worker 环境没有维护角色绑定。 |
| 真实备份及恢复 | 只读复验 12:44 归档和 `full_restore_passed=true` 回执。归档 SHA-256 为 `9cb3fe83b3ddc02bbccbd49272d77772f60e7af19275da3338be9f98676e3cc2`，账本 119 条，PG17 目录表 2,612 项。原物理文件、退出码与失败尝试见 DBA 执行报告。 |
| 排序规则 | 源库为 UTF8、`en_US.utf8`（2.36），i798 模板为 UTF8、`C`。实测源库 `a` 排在 `A` 前，i798 顺序相反。历史逻辑恢复已核验数据、结构和权限。等价回滚目标由 DBA 确认。 |

`xiaok:migration` 已改为核对 129 项 Journal、完整 Journal LF 摘要和十条 SQL 的实际哈希。源库预检补充 0132 的 FORCE RLS、引用租户策略、旧 FK、复合键与回填条件。恢复工具合入 `aclitems-c-sort-v1`，历史 Manifest 保持原算法。Windows 只读 ACL 检查改用系统目录 ACL API，以解决子进程自动加载 `Get-Acl` 失败。14:37 统一门禁退出码 `0`，`backup_readiness`、`restore_readiness`、`migration_readiness`、`environment_readiness` 和 `overall_readiness` 均为 `passed`，探针输入前后无漂移。

历史实证覆盖 119 条源库归档的全量逻辑恢复。I7.5.15 覆盖隔离库 128 → 129 和合成语料引用生命周期。当前源库 119 → 129 的正式执行和迁移后 129 条归档恢复均为 `not_run`。

## 执行前签批

1. DBA 与负责人确认本次候选提交及 SQL、Journal 哈希，锁定停写窗口、归档保管、执行和回滚责任。
2. 签批该窗口的真实备份和独立恢复、演练库的创建与清理。明确 i798 的逻辑恢复用途及排序差异的处置，核对实际回滚目标。用本窗口新鲜归档与成功回执再跑统一门禁。
3. 负责人签批正式开发库迁移。保留停写并按执行单完成结构、账本、权限和历史引用读回，由负责人放行访问。平台承载企业配置、Worker、真实通知和生产上线依各自审批。

本轮定向测试 47 通过，需要建隔离库的 18 项跳过。TypeScript、定向 ESLint 和计划检查通过。全量 ESLint 退出 1，`admin/deployment/portfolio-kodo` 下的 `seed.cjs`、`signing.js` 在远端基线可复现同样 8 个 `no-require-imports` 错误。

本轮操作限于只读盘点、审查与工具验证。真实备份、数据库创建、恢复、迁移、扩展安装、ACL 或权限变更、企业 1454 写入、Worker 启动及真实通知均为 `not_run`。只读回执位于 `tmp/xiaok-i7516/read-only-20261116T062850975Z/`。
