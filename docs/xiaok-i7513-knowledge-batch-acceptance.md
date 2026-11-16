# 家客来 I7.5.13 知识批次与索引 Worker 端到端验收

2026-11-16（Asia/Shanghai），`codex/xiaok-integration` 从已 fetch 的远端提交 `4f1ad799abbcac2bab6a27ea3a022cab999d875a` 开始。隔离 PG17 的 `run-04` 共 **14 项通过、0 项失败**，补验了历史 I7.5.9 中有效知识批次缺席的 `limited` 项。历史报告仍按原始执行结果记录。见 [I7.5.9 验收](./xiaok-i759-worker-side-effect-audit.md)。

## 隔离环境与执行入口

- 原 I7.5.9 隔离库 `127.0.0.1:55432/i745_f1_accept` 最初只读探测确认 PG 17.10、pgvector 0.8.2。正式运行前转发中断，后续 SSH 在密钥交换阶段被远端关闭，两个连接尝试均记录为 `not_run`。
- 复用 I7.4.9.4 本机 PG17 集群及已验证的纯合成归档，通过既有恢复验证器在 `127.0.0.1:55436/xiaok_migration_restore_i7513_36aa73c7` 恢复本轮专用数据库。归档 SHA-256 `afb216d2f5d54a740190ecdba486efc86b2f64a83b923e1aca29886ec20e6ae4`，128 条账本、结构、数据、RLS 和 ACL 校验通过。使用 `sfp_app` 执行业务验收，`rolsuper=false`、`rolbypassrls=false`，24 张相关表均启用并强制 RLS。见 [归档来源](./xiaok-i794-full-migration-restore-acceptance.md)。
- `KnowledgeService` 完成入队、托管索引、发布及退役，`KnowledgeOperations.save()` 和 `batches().create()` 创建正式评测题、来源快照、批次及条目。两家企业都用已发布来源和各自的有效索引配置。验收直接调用 `assistantWorkerPreflight()`、`advanceKnowledgeBatches()`、`claimJob()`、`claimKnowledgeJob()`、`processKnowledgeJob()` 和 `processManagedKnowledgeCleanup()`。
- 验收进程使用正式托管适配器，HTTP 只由进程内合成传输响应。文本评测使用原 Worker 的模型注入口。两家 `ai_provider_attempts` 均为 `0`，合成托管请求 `54` 次、合成文本响应 `1` 次，对外请求 `0`。全程新增迁移 `0`、真实 Worker 启动 `0`、真实通知 `0`，业务写入限于本轮生成的企业。

## 真实运行记录

运行 `a9dd27d7-3193-4000-bcd0-8d554f9e6cab`，10:19:35–10:19:37。以下 ID 均属于本轮专用库，清理后以回执为准。

| 证据 | 试点企业 | 对照企业 |
| --- | --- | --- |
| 企业 / 管理员 | `4` / `4` | `3` / `3` |
| 已发布来源文档 / 版本 | `10` / `10` | `9` / `9` |
| 有效批次 / 评测 | `4` / `5, 6` | `3` / `4` |
| 待索引任务 / 托管清理任务 | `12` / `8` | `11` / `7` |

| 检查 | 结果与持久化证据 |
| --- | --- |
| 候选和 dry-run | 两个批次均为 `active`，待分派条目具有完整评测和发布来源快照。试点和对照分别运行 preflight 时，各计入自己的 `1` 个批次及 `1` 个待索引任务。重复预检一致。未配置时 `13` 项全部 `wouldRun=false`。两家各 `24` 张表的行数及整行摘要前后相同。 |
| 批次推进及幂等 | 相同幂等键返回同一 `batchId`。两次并发推进试点批次只创建 `1` 个 run、会话及额度预留，第二条保持 `pending`。试点任务 `13` 领取 run `1` 并完成结构及引用校验。任务 `14` 的显式合成失败保留为 `failed`，后续领取返回空，批次推进返回 `0`。 |
| 索引范围、过期重领和幂等 | 对照任务 `11` 先入队。试点两路并发领取仅取得任务 `12` 的一个租约；过期后重领更换 token，旧 token 无提供方调用。索引最终 `ready`、分片 `1`、内容哈希一致且有托管定位，只有一组上传/导入回执。重复执行无新尝试。 |
| 索引失败与未知结果 | 任务 `15` 经三次未派发租约过期后进入 `failed / retry_exhausted`。任务 `16` 派发标记后租约过期，进入 `indeterminate / provider_outcome_unknown`，上传尝试为 `unknown`，迟到响应没有覆盖终态。后续扫描均无重领。 |
| 托管清理范围及幂等 | 两家共享同一合成工作空间、各有独立索引。试点执行只处理任务 `8`，`cleanup_attempts=1`、`removed_at` 已写入，清理回执 `i7513-41`。第二次调用返回 `false`，数据库与合成删除次数保持一致。 |
| 对照有效性与双向隔离 | 整段试点执行里，对照企业 `24` 张表的摘要相同。切到对照自身范围后，批次 `3` 生成 queued run `3`，任务 `11` 索引成功、任务 `7` 清理成功（回执 `i7513-54`），试点摘要相同。对照 run `3` 用于验证派发和入队，保留该状态至夹具清理。 |
| RLS 和服务层 | 两家从各自租户事务查询对方的 `24` 张相关表均为零，更新对方已存在的任务影响 `0` 行。两边尝试将本方真实分片改挂对方，PG 均以 `42501` 拒绝。批次读回双向返回 `assistant_resource_not_found`。 |
| 清理 | 两轮真实写入均执行本轮夹具清理。`run-04` 两家各复核 `32` 张助手表、企业、管理员及供应商尝试残留为 `0`。进程内替身的未撤回绑定按本轮工作空间清除。最后核对恢复副本的唯一标记，删除本轮副本并关闭本轮启动的 PG17 进程，原始归档 SHA-256 复核一致。 |

## 检查及失败记录

- 定向测试 **46 passed / 0 failed / 0 skipped**，覆盖 Worker 门禁和编排、队列预览、评测结构、Embedding 和托管适配器。完整 Admin TypeScript `tsc --noEmit --incremental false` exit 0。定向 ESLint 校验验收脚本及五个重点入口，0 error / 0 warning。
- `run-01`、`run-02` 保留 `ECONNREFUSED` 和 `not_run` 原始回执。`run-03` 保留 `failed` 原始回执，正式候选和 dry-run 已通过，跨租户写探针先命中管理员归属触发器 `assistant_job_manager_reference`，未触及 RLS 的 `WITH CHECK`。`run-04` 换用无该触发器的知识分片复核 `42501`。这里的报告数字仅来自 `run-04`。
- 原始记录在 `tmp/xiaok-i7513/run-01/` 至 `run-04/`，恢复与资源清理见同目录下的 `i794-restore.json`、`restored-target-cleanup.json` 和 `isolated-server-stop.json`。`run-04` 前后 692 个文件的运行依赖清单摘要均为 `d31a163c5be1a618852f4cc1a89c0801a6baf50f3adac47ea2620fc81b54fff4`，验收脚本 SHA-256 为 `fe3c3a11f298814d5068c35698693b5c76967bad06b763423e5b4b05f7a2bb52`。

## 剩余 limited 和 not_run

- **Limited** 包括真实百炼工作空间的写入、检索与远端删除，以及真实文本语义或费用对账。合成文本只通过结构与引用校验，语义状态仍为 `requires_review`，回执保留 `awaitingReconciliation=true`。
- **Not run** 包括本地 Embedding/pgvector 索引分支、真实常驻 Worker 和真实企业环境。端到端证据来自独立 PG17 托管知识路径和正式 Worker 函数。Worker 编排及 HTTP 门禁另有定向测试。

## 复跑

在 `admin` 用 Node.js 24 和已安装的依赖运行。输出目录须使用新名称。默认连接文件为 `tmp/xiaok-i745-f2/connection.private.json`，目标固定为原 I7.5.9 隔离库。备用方式使用已通过恢复验证的本轮独立副本名 `xiaok_migration_restore_i7513_<八位十六进制>`，并加 `--restore-db=<副本名>`。脚本核验集群和副本标记，环境不满足时记录 `not_run`。

```powershell
npx tsx scripts/xiaok-i7513-knowledge-batch-acceptance.ts --output=../tmp/xiaok-i7513/run-<新编号>
```

提交范围为验收脚本与本记录。运行时接口、角色权限和数据合同沿用 Admin 模块清单的既有描述。
