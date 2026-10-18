# KB-4 批量回归：知识线实现与集成交接

状态：**Limited，内部能力已实现，尚未接入 API/UI。** 本文是知识专项线的可审查集成提案，不替代[二期合同](./xiaok-assistant-phase-2.zh-CN.md)、[后台清单](./admin-system-modules.zh-CN.md)或用户本地的企业知识计划。基线 `d023854313842ef447efb2973beb540d1511e125`；原业务分支不切换、不写产品代码。

## 实现边界

- `KnowledgeOperations.prepareBatch({cases:[{caseId,expectedVersion}]}, requestKey)` 在原知识管理者事务内，原子准备 1–50 道已保存问题的原评测记录。复用 `assistant_knowledge_evaluations`、原 `create_key/send_key` 及 `assistant_idempotency_records`；不创建聊天、run、job、额度预留或模型调用。原逐题 `start` 共用同一个评测插入函数。
- 问题次序、case 版本/修订、题目/预期/必需来源快照 hash、knowledge epoch、profile ID/配置 hash、policy version、所选企业及本人 admin 都保留在准备回执。必要来源仍按原逻辑要求当前有效 `customer_public` 已发布/索引就绪版本；禁止来源沿文档 ID 和 epoch。批量准备要求已有 profile，不创建另一个索引配置。
- 一道题版本错误、来源未就绪、越权或企业 2,000 次评测容量不足时，整笔准备回滚，包括已插入项目及操作回执。重复原键复用全部原 evaluation ID；不同载荷用相同键冲突。改题/换来源之后重放旧键仍返回旧回执，不能因此获得当前可执行性。
- `evaluation-batch.ts` 提供不可变 manifest、单次有界 `advance()`、逐项进度及 `requestCancel()`。每次推进先全量回读原评测；现有 queued/running、indeterminate 或待费用核对项目占用并发槽位，默认 2、最高 4；已有活跃数超限时不再启动。只调用原评测的 resume，不调用 start、run retry、供应商或 Worker。
- manifest/checkpoint 只含身份、hash 和状态；不保存答案、来源正文、诊断、核对备注或供应商异常正文。数据来源变更时收起旧 run/结构结果；结构通过仍是 `requires_review`。费用合计恒为 `null`，未知用量项目和待核对项目分别可见，不将未知成本记零。

这不是新的持久任务/租约权威。评测、run、job、原始操作键、来源、用量及 reservation 继续由现有服务维护；manifest 的无密钥 hash 只做完整性核对，不能当作授权证明。

## 必须由业务集成人接入的端口

`EvaluationBatchPort` 是明确依赖，当前没有生产适配器或路由。任何调用方都不能用浏览器状态或模型输出实现这些保证。

| 端口 | 必须满足的合同 |
| --- | --- |
| `preflight(manifest)` | 从服务端重验当前所选企业、管理者身份/改密状态、本人评测所有权、case 修订/快照、epoch、profile ID/hash、policy version，以及执行配置修订。每次操作前和返回进度前调用；失败时清除旧进度视图，不泄露缓存内容。 |
| `observe(manifest,item)` | 实时读取原评测/run 的安全状态，不复用旧回答缓存。校验实际评测确实匹配 manifest 身份及 snapshot hash；不把仅能计算出的 hash 当授权。识别已提交 send、但 evaluation 尚无 run_id 的丢回执窗口；保留未知 attempt/费用 reservation。 |
| `resume(manifest,item)` | 同事务/既有服务边界再验权限和版本，只使用该评测服务端原 create/send 键；不得新建评测或换键重试 indeterminate。独立的前置检查不能替代原子写入守卫。 |
| `cancel(manifest,item,key)` | 使用原 `ConversationService.run(runId,'cancel',key)` 等既有取消能力，只处理已存在 run；不得为寻找 run ID 调用 resume/send。取消回执不等于模型费用核清。 |

执行配置的 `executionRevision` 必须由服务端使用白名单字段生成 SHA256，包括实际执行模式、供应商身份、model/revision、实际 prompt/version 和相关生成配置，逐次核对；不包含凭证。现有管理者回归走知识试问，**不是客户 C01 Agent**。不能把其 preview 配置印成 Agent prompt/model 版本，也不能把后台摘录输出算作实况语义回归。需要 Agent 路径时，版本固定及端口适配归业务集成人，本线未改共享运行时。

同一协调器实例拒绝重叠 advance；同一 manifest 的跨进程/多标签推进、持久取消意图及取消与尚未派发项之间的原子围栏仍需集成人用现有机制串行接入。未接入前不能公开批量 API/UI 或声称分布式并发/持久取消已经通过；不另建队列、schema、迁移或租约来绕过该依赖。

## 状态与恢复

| 触发 | 当前实现/反馈数据 | 恢复及限制 |
| --- | --- | --- |
| 准备成功/同键重进 | 原始有序 evaluation ID 和冻结快照 | 重读原准备回执；不自动派发。 |
| 正常推进 | 逐项 dispatch_pending/queued/running/终态及结构状态 | 新协调器使用相同序列化 manifest，全量读服务端再决定剩余槽位。 |
| 本实例取消 | 立即停止新 resume；对晚到的已知活跃 run 请求取消 | 未派发题保持待派发，不能伪称服务端已取消。新实例显式继续仍用原评测 ID；持久取消意图需集成。 |
| 丢 resume/cancel 回执 | 立即回读并标记 action unconfirmed，不暴露原错误正文 | 后续轮询确认原 run；不盲换键、不重试未知模型调用。无法安全回读则整次推进失败。 |
| indeterminate/待核对费用 | 保留状态、费用 null、占用并发槽位 | 沿原 usage/reconciliation 权限处理；批量层不核销、不清零。 |
| 问题/来源/profile/配置变化或撤权 | 端口拒绝推进，或来源失效状态无旧内容 | 当前版本另行明确准备；旧回执只用于审计，不作为执行授权。 |
| 结构通过/正常结束 | 分别提供结构计数和执行终态 | 专业含义仍须现有明确核对；执行结束不表示账务或产品验收通过。 |

## 共享文档与界面集成边界

本线按交接不改共享双语合同/模块清单、Agent、队列、schema、迁移、引用权限或原生 UI。当前路由/API/菜单/权限及可见流程未改变；现有清单“逐题运营已交付、批量执行待接续”仍准确。本文双语记录新增内部数据/执行合同；不是一个已交付用户阶段。

集成人接入时，应替换双语后台清单中现有 KB-4 当前段落，并更新二期合同的同一个 KB-4 记录，概括：

> 内部批量准备已原子保存原评测身份，限定协调层复用原试问/run/幂等与费用协议；逐项进度、局部并发及取消/恢复端口已有离线验证。批量 API/UI、跨进程围栏、实际配置固定及客户 Agent/原生复验仍待接入，整体 Limited。

真正接入后再按事实替换待接入项，补现有 Ant Design/Admin Pro/共享反馈流程、服务写入/重进/权限/异常验证，以及受影响 C01 引用/重进回归。不得把本文作为新的视觉方案或自动升级当前清单状态。

## 验证与复跑

从本 worktree 的 `admin`：

```powershell
node scripts/assistant-knowledge-batch-acceptance.mjs
node scripts/assistant-knowledge-batch-acceptance.mjs --service --connection-file 'G:/workspace/向总/Smart-Floor-Planner/tmp/xiaok-vector/connection.private.json' --env-dir 'G:/workspace/向总/Smart-Floor-Planner/admin'
node scripts/assistant-knowledge-batch-typecheck.mjs d023854313842ef447efb2973beb540d1511e125
```

第一条只跑纯离线测试及既有结构/上下文/文件定位单元，不读数据库。第二条先成功持有 `lockAssistantAcceptance` 的整套共享锁，强制批准的 `55432/xiaok_embedding_eval`、非 superuser/non-BYPASSRLS 及空闲队列，才运行知识运营服务回归；不启动独立 Worker，沿原测试驱动既有工作函数。锁失败不重置夹具、不清队列。只使用 `synthetic-kb4-<UUID>` 企业/用户及测试专用问题，清理限定为本套 fixture IDs。读取既有环境及隔离连接文件，不复制/新增凭证。

本轮重新执行相关离线检查：**41/41 通过、0 失败、0 跳过**，包括协调用例 27 项及既有单元 14 项；被测源码 hash 稳定。相关六文件 ESLint 零错误/警告。同一源码程序类型诊断与基线均为 **287 项，新增 0**，仍不是全项目类型零错误。日志和 JSON 位于 worktree 的 `tmp/knowledge-batch/fixture-fix/`。

已先核对文件归属：`admin/src/db/__tests__/assistant-knowledge-operations.test.ts` 是知识运营专属回归，第 14 项由本线 `782eb8ac` 新增；业务原工作区自 `d0238543` 起对该文件没有提交或未提交差异，交接的共享单一维护清单未把该知识测试列为共享 Agent/权限文件。本轮仅将夹具 `menu_permissions` 改为显式 `ARRAY['assistant-knowledge']::text[]` / `ARRAY[]::text[]`，保留所有权限断言。同文件补清理前的完整计量，`finally` 仍保证按本线 fixture IDs 清理；产品实现、API/UI、共享 runtime/队列/schema/权限均未改。

最终服务回归为**修复后新执行的 14 项，14 通过、0 失败、0 跳过、0 取消**，退出 0，用时约 **175.34 秒**，包括第 14 项中 `enterprise_admin/admin/super_admin` 的原有全部断言。服务 runner 的源码 before/after hash 一致，另对 9 个测试/计量相关源文件校验未见变更。整套通过原 `lockAssistantAcceptance` 的批准目标、非 superuser/non-BYPASSRLS 及空闲队列检查；本线持锁后端 `460828`、角色 `sfp_app`、应用名 `knowledge_batch_fixture_fix_20261018T1544Z`。

清理钩子在删除本线夹具前输出一次完整 `KB4_SERVICE_AUDIT`，覆盖两企业全部索引 attempt、查询 Embedding usage 及 reservation，补齐了上轮仅观察运行中部分计数的限制。既有 gateway 每个有效 embed 调用只发一次 `/v1/embeddings` HTTP 请求，无自动重试或 fallback；本轮成功 attempt / observed usage 对应以下真实应用侧请求：

| 范围 | 真实请求数 | 已知输入 token | 输入用量未知次数 |
| --- | --- | --- | --- |
| 文档 Embedding（succeeded embed） | 3 | 121 | 0 |
| 查询 Embedding（observed query_embedding） | 4 | 164 | 0 |
| 本轮合计 | **7** | **285** | **0** |

另有 3 次成功 chunk 尝试、其输入用量 3 次未知，不计入上述 Embedding 请求数。费用仍为 `costMicros:null`；清理前 4 笔 reservation 为 `reconciling`、1 笔为 `released`，没有把未知费用填零或登记为已核清。仅按原测试程序删除本线合成夹具，审计先独立留存。

本轮夹具为企业 `3445/3446`、8 名管理员 `6773–6780`，前缀 `synthetic-kb4-6d269aca-cda0-41e6-8330-fecd854baf0a`。15:48:50 UTC 只读核验企业、同前缀/精确 ID 管理员及 13 类助手表记录全部零遗留，本线活跃 job 为 0，共享活跃队列为空；进程 `378580/267468/345656` 均已退出，本线锁 `460828` 已释放。未启动独立 Worker、替换原开发 Worker、清理其他任务或删除/抢占其锁。

原代码 `782eb8ac` 的独立运行仍是 **13 通过、1 失败**：第 14 项在原行 184 的合成管理员 INSERT 生成 `($4)::text[]`，`$4` 为裸字符串 `assistant-knowledge`，未到权限断言；只读对照复现 `22P02 / malformed array literal`。该失败未改写成通过，完整原日志/状态及根因仍在 `service-followup/` 和 `fixture-fix/previous/`。最初锁占用、0 项执行的尝试仍在 `service-attempt.log`、`lock-observation.json`，不混入最终 14 项计数。

当前证据：`fixture-fix/{ownership.json,preparation.json,unit.log,unit-status.json,lint-status.json,type-comparison.json,service-final.log,service-final-status.json,embedding-audit.json,embedding-summary.json,cleanup-audit.json,owned-processes.json,process-cleanup.json,final-source-check.json}`。归档包装层曾因未规范化的 `admin/../` 路径报错，已从完整主日志/JSON恢复，见 `artifact-recovery.json`；不是额外失败或通过的测试用例。

服务回归使用真实隔离 PostgreSQL/RLS 和既有真实 Embedding，文字生成模型为确定性模拟。离线端口的权限/版本场景仍为模拟，不能替代数据库与客户语义验收。未运行配置实模文字回答、C01 Agent/原生语义、完整构建、Chrome、Stable 原生、真机/BLE、生产容量/恢复或发布验收。批量 API/UI、执行版本固定及跨进程取消围栏仍待集成人接入，整体保持 **Limited**；未自动合并或部署。

## 计划来源保全

原主工作区计划未编辑、暂存或提交。只复制清单指定的两份计划到本 worktree 忽略目录 `tmp/knowledge-batch/plans/`，复制前后 SHA256 均一致：中文 `498b36b66299fe188cd429d7823e1dc97075c19bf81da06fffe2a6bf2d50d968`；英文 `e4a4d65d063069a7eea38d2228c553ed0ddfff60cee775dbd538442bed457235`。路线图原文哈希 `432611441d0c6c257913472619c3dd6128a0a7d0ab5bd0e769016cdb0e9aae9d` 与交接清单一致。当前原仓库无 `.agents/skills`；已读根/后台指令、相关清单及 KB-4 合同。
