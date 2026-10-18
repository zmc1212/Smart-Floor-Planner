# KB-4 批量回归：知识线实现与集成交接

状态：**Limited；知识专属批次准备、本人历史/进度、逐项原次恢复及已关联 run 取消已接入 Admin/API，自动批量执行仍待集成。** 当前增量的实际验证见下文，代码存在不等于整批验收通过。本文是知识专项线的可审查交接，不替代[二期合同](./xiaok-assistant-phase-2.zh-CN.md)、[后台清单](./admin-system-modules.zh-CN.md)或用户本地的企业知识计划。基线 `d023854313842ef447efb2973beb540d1511e125`；原业务分支不切换、不写产品代码。

## 实现边界

- `KnowledgeOperations.prepareBatch({cases:[{caseId,expectedVersion}]}, requestKey)` 在原知识管理者事务内，原子准备 1–50 道已保存问题的原评测记录。复用 `assistant_knowledge_evaluations`、原 `create_key/send_key` 及 `assistant_idempotency_records`；不创建聊天、run、job、额度预留或模型调用。原逐题 `start` 共用同一个评测插入函数。
- 问题次序、case 版本/修订、题目/预期/必需来源快照 hash、knowledge epoch、profile ID/配置 hash、policy version、所选企业及本人 admin 都保留在准备回执。必要来源仍按原逻辑要求当前有效 `customer_public` 已发布/索引就绪版本；禁止来源沿文档 ID 和 epoch。批量准备要求已有 profile，不创建另一个索引配置。
- 一道题版本错误、来源未就绪、越权或企业 2,000 次评测容量不足时，整笔准备回滚，包括已插入项目及操作回执。重复原键复用全部原 evaluation ID；不同载荷用相同键冲突。改题/换来源之后重放旧键仍返回旧回执，不能因此获得当前可执行性。
- `evaluation-batch.ts` 提供不可变 manifest、单次有界 `advance()`、逐项进度及 `requestCancel()`。每次推进先全量回读原评测；现有 queued/running、indeterminate 或待费用核对项目占用并发槽位，默认 2、最高 4；已有活跃数超限时不再启动。只调用原评测的 resume，不调用 start、run retry、供应商或 Worker。
- manifest/checkpoint 只含身份、hash 和状态；不保存答案、来源正文、诊断、核对备注或供应商异常正文。数据来源变更时收起旧 run/结构结果；结构通过仍是 `requires_review`。费用合计恒为 `null`，未知用量项目和待核对项目分别可见，不将未知成本记零。

这不是新的持久任务/租约权威。评测、run、job、原始操作键、来源、用量及 reservation 继续由现有服务维护；manifest 的无密钥 hash 只做完整性核对，不能当作授权证明。

## 必须由业务集成人接入的端口

`EvaluationBatchPort` 是自动协调器的明确依赖，当前没有生产适配器或自动执行路由。已授权的知识管理界面单独提供“保存批次—本人回读—手动执行原次”，不会调用协调器。任何调用方都不能用浏览器状态或模型输出实现以下自动执行保证。

| 端口 | 必须满足的合同 |
| --- | --- |
| `preflight(manifest)` | 从服务端重验当前所选企业、管理者身份/改密状态、本人评测所有权、case 修订/快照、epoch、profile ID/hash、policy version，以及执行配置修订。每次操作前和返回进度前调用；失败时清除旧进度视图，不泄露缓存内容。 |
| `observe(manifest,item)` | 实时读取原评测/run 的安全状态，不复用旧回答缓存。校验实际评测确实匹配 manifest 身份及 snapshot hash；不把仅能计算出的 hash 当授权。识别已提交 send、但 evaluation 尚无 run_id 的丢回执窗口；保留未知 attempt/费用 reservation。 |
| `resume(manifest,item)` | 同事务/既有服务边界再验权限和版本，只使用该评测服务端原 create/send 键；不得新建评测或换键重试 indeterminate。独立的前置检查不能替代原子写入守卫。 |
| `cancel(manifest,item,key)` | 使用原 `ConversationService.run(runId,'cancel',key)` 等既有取消能力，只处理已存在 run；不得为寻找 run ID 调用 resume/send。取消回执不等于模型费用核清。 |

执行配置的 `executionRevision` 必须由服务端使用白名单字段生成 SHA256，包括实际执行模式、供应商身份、model/revision、实际 prompt/version 和相关生成配置，逐次核对；不包含凭证。现有管理者回归走知识试问，**不是客户 C01 Agent**。不能把其 preview 配置印成 Agent prompt/model 版本，也不能把后台摘录输出算作实况语义回归。需要 Agent 路径时，版本固定及端口适配归业务集成人，本线未改共享运行时。

同一协调器实例拒绝重叠 advance；同一 manifest 的跨进程/多标签推进、持久取消意图及取消与尚未派发项之间的原子围栏仍需集成人用现有机制串行接入。在此之前不暴露自动批量派发，不宣称分布式并发或持久整批取消验收通过。独立管理 API/UI 仅准备快照、回读及显式逐项操作；准备回执内的 profile/policy hash 不是实际模型/prompt 固定承诺。不另建队列、schema、迁移或租约来绕过该依赖。

## 知识专属 Admin/API 合同

设计源为双语 Admin UI refactor 合同的 `/assistant-knowledge` 当前行、原 `KnowledgeOperationsPanel`、Ant Design/Admin Pro、720px Drawer 与共享操作反馈。该行允许问题/恢复工作流变化时重开；没有引入新视觉方向。新增批次选择、本人批次 Drawer 和 `?knowledgeBatch=<原键>` 重进入口，逐题结果仍复用原 Drawer，不在批次另存或回传答案。

| 接口 | 行为及权限 |
| --- | --- |
| `POST /api/assistant/knowledge/operations/batches` | body 仅 `cases:[{caseId,expectedVersion}]`，1–50 道；原 `Idempotency-Key` 原子保存本人原评测快照，不派发模型/任务。 |
| `GET .../batches?limit&beforeId` | 从原操作回执分页读取本人历史；数字游标精确传递，只返回批次原键、时间、题数与准备 epoch，以及服务器解析的 enterprise/admin scope。 |
| `GET .../batches/:batchId` | 从原评测/run/额度读取元数据进度，重验本人回执、不可变 snapshot hash、case 修订、epoch、当前 profile/hash/policy、有效来源及原私有会话参与关系。无问题正文、答案、诊断、引用正文、核对备注或 usage 明细，费用未知。 |
| `POST .../evaluations/:id/resume` | 复用既有接口与服务器原 create/send keys。已有 run 时只回读原 ID；不创建新重试 run，已取消或不确定的原次不会被此操作重跑。 |
| `POST .../evaluations/:id/cancel` | body 仅 `{}`；只取消已关联本人私有预览的 run，由 `ConversationService.run(...,'cancel',原键)` 再验身份并更新原 job/reservation。未关联 run 时 409，不派发以“发现”run，不保存待执行项取消围栏。来源失效不妨碍所有者停止已有调用，不返回旧来源内容；参与/管理权限撤销仍拒绝。 |

以上沿用 `withTenantRoute`、知识管理继承及本人私有边界：`enterprise_admin` 需当前显式菜单权限；`admin/super_admin` 在明确所选企业内继承，不要求成为员工或项目成员。客户端不提供 tenant/admin/run ID 权威，不能凭另一人的 ID 读取或取消。聊天用量独立授权不变。响应 `no-store`，字段严格限定，HTTP body 保持 24KB 上限。

客户端仅将待核对准备请求的版本、服务器 scope、原键和 case ID/expectedVersion 存入按 enterprise/admin 分隔的 `sessionStorage`。先保存再发送，丢失回执后刷新仍用同键同载荷核对，已知拒绝清除当前待核对项；不同选题不能覆盖未决请求。存储受限时同实例仍保留原键，持久重进以服务器本人历史为准。浏览器存储不是授权或任务真相源；资料/问题/配置变化或权限错误后清除旧进度，不缓存答案。

取消保留原共享语义：派发前释放预留，已提交边界后保留 `reconciling`，未知费用不填零。终态竞争可能返回原已完成状态，界面重新读取。不提供整批取消、持久暂停、自动并发/调度、未知调用重试或费用核清。

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

本线按交接不改共享双语合同/模块清单、Agent、队列、schema、迁移、引用权限或原生 UI。只修改知识专属运营服务/API、Admin 管理组件与页面入口、相邻 DTO/客户端恢复、回归及 runner；不修改共用 `components/assistant/client.ts`。原工作区对所改既有知识文件自基线无提交或未提交差异。新增接口及可见流程已超出旧清单的逐题描述，须由单一集成人合并时同步以下当前记录，本线不抢写共享文件。

集成人接入时，应替换双语后台清单中现有 KB-4 当前段落，并更新二期合同的同一个 KB-4 记录，概括：

> KB-4 继续 Limited。原问题集新增 1–50 题原子准备、服务器本人批次分页/元数据进度及批次链接重进；逐项恢复原 evaluation/create/send keys，已关联本人私有 run 可取消，沿用原 job/额度未知费用协议。沿用所选企业三类管理角色及 Ant Design/Admin Pro/720px Drawer/共享反馈，不新增 schema、队列或 Mini 布局。自动批量派发、执行模型/prompt 固定、跨进程取消围栏及客户 Agent/原生复验仍待集成，手动逐项管理不等于完整批量调度。

单一集成人应在双语后台清单 KB-4 当前段及二期合同 KB-4 同一记录写入上述范围与实际证据；后台 UI refactor 的 `/assistant-knowledge` 单行补“批次选择/本人进度、原键恢复、已关联 run 取消”，保留原路由/API/权限边界与当前浏览器证据，不附加历史行。小程序清单/恢复账本无本轮运行界面变化，不升级状态。本文不是新视觉方案、未执行验收的证明或生产授权。

具体集成依赖：① 服务端实际执行模式/provider/model revision/prompt/generation settings 固定及可验证 executionRevision；② 沿原机制串行化跨进程/多标签派发与持久取消意图；③ 真正 `EvaluationBatchPort` 适配器及取消/未知结果/并发端到端回归；④ 受影响的客户 C01/原生引用重进复验。当前知识管理子流程不依赖业务 Agent 改造，其余只提交接口提案，不越界修改共享 runtime。

## 验证与复跑

从本 worktree 的 `admin`：

```powershell
node scripts/assistant-knowledge-batch-acceptance.mjs
node scripts/assistant-knowledge-batch-acceptance.mjs --service --connection-file 'G:/workspace/向总/Smart-Floor-Planner/tmp/xiaok-vector/connection.private.json' --env-dir 'G:/workspace/向总/Smart-Floor-Planner/admin'
node scripts/assistant-knowledge-batch-typecheck.mjs d023854313842ef447efb2973beb540d1511e125
```

第一条只跑纯离线测试及既有结构/上下文/文件定位单元，不读数据库。第二条先成功持有 `lockAssistantAcceptance` 的整套共享锁，强制批准的 `55432/xiaok_embedding_eval`、非 superuser/non-BYPASSRLS 及空闲队列，才运行知识运营服务回归；不启动独立 Worker，沿原测试驱动既有工作函数。锁失败不重置夹具、不清队列。只使用 `synthetic-kb4-<UUID>` 企业/用户及测试专用问题，清理限定为本套 fixture IDs。读取既有环境及隔离连接文件，不复制/新增凭证。

### 当前 Admin/API 增量

截至当前检查，离线 **48/48 通过、0 失败/跳过/取消**（原 41 项加 7 项客户端原键恢复单元）；11 个相关代码/runner 文件 ESLint **0 错误、0 警告**；同一源码程序类型诊断 **287→287，新增 0**，不是全仓零类型错误。当前证据在 `tmp/knowledge-batch/admin-entry/{unit.log,unit-status.json,lint-status.json,type-comparison.json}`。

最终服务回归重新执行 **25/25 通过、0 失败/跳过/取消**：原 14 项运营加新增 11 项批次 HTTP/进度/原次取消，用时 **363.06 秒**，退出 0，runner 被测源码前后 hash 一致。初次锁忙时退出、0 项执行；首轮 24/24 通过后，最终复查以只读常量 VALUES 复现文本输出别名造成的跨位数排序错误，改为 `order by r.id` 原 bigint 列，并增加精确游标回归，未修改 schema。原 24 项结果保留在 `admin-entry/service*`，不当作新增 25 项或最终排序修复的证据。

最终以 `--lock-wait-ms 1800000` 等待正常释放，于 17:46 UTC 持锁执行，不接管锁或清理他人数据。锁后端 `472717`、角色 `sfp_app`、应用名 `knowledge_batch_final_cursor_20261018`，保持非 superuser/non-BYPASSRLS、批准目标及空闲队列前置检查，无独立 Worker。最终日志、源码 hash 和状态在 `admin-entry/final/{service.log,service-status.json,service-lock.json}`。

新增三类管理继承、另一个所有者/跨企业拒绝、严格输入/原子回滚、同键重进、真实 send 丢回执后的恢复、派发前取消释放预留、模拟“已提交边界”后保留 reconciling、私有参与撤销及来源有效期失效均通过。有效期在草稿阶段设定，等待数据库真实时钟到期，不修改已发布版本或禁用其不可变触发器。提交边界标记为明确合成场景，不冒充外部模型实际调用。

最终清理前完整审计：真实文档 Embedding **4 次/150 已知输入 token**，查询 Embedding **5 次/200 token**，合计 **9 次/350 token**，Embedding 输入未知次数 0；另有 4 次 chunk，输入用量 4 次未知，不混入 Embedding 数。费用 `null`；最终服务夹具清理前 `reconciling=6/released=2`，其中一笔 reconciling 来自明确合成的提交边界标记。首轮 24 项和最终 25 项两轮服务累计为 **18 次真实 Embedding/700 token**、8 次输入未知的 chunk，服务预留合计 `reconciling=12/released=4`；分轮统计独立保存，不把前次调用藏在重跑后。

文字模型为确定性模拟，不是配置实模或 C01 语义验收。最终服务企业 `3476–3479`、管理员 `6840–6852`，首轮服务及全部浏览器尝试也只按各自精确 fixture IDs 清理。收尾只读审计覆盖本增量累计 **15 个合成企业/40 名管理员**，全部 107 张带 enterprise_id 的 app 基础表均无本线记录，企业/管理员无遗留，本线锁均释放。证据：`admin-entry/{embedding-audit.json,embedding-summary.json,cleanup-audit.json,numeric-cursor-control.json}`。

用户已明确授权知识线使用 `localhost:3007`，原业务 `3006` 保持。最终浏览器流程在同一共享锁内，以既有 **Edge 155.0.4283.62 / Playwright**、正常合成账号登录和真实写入完成 **9 组检查**，退出 0、页面脚本错误 0、产品源码前后 hash 一致：准备提交真实成功后故意丢响应，刷新后同键/同载荷恢复；原 evaluation ID 不变；逐项原次执行及派发前取消；批次链接重进；读取精确原评测 ID 并等待原 Drawer 的恢复操作出现；另一授权管理员拒绝访问；真实改题后旧项目收起操作。最终 UI 企业 `3480`、管理员 `6853/6854`；无文字模型或 Embedding 调用，原预留为 released。只关闭本轮自建 Next 进程树（最终根 PID `217656`），未操作原服务或用户浏览器会话；数据、进程、锁均清理。

以现有 Admin 源在 **1440×1000** 核对：主问题表/选题入口、本人批次、取消及资料变化状态、原同题结果 Drawer；测得批次 Drawer 宽 **720px**，未另建视觉体系。`admin-entry/ui/{operations-list.png,prepared.png,cancelled.png,changed-case.png,original-evaluation.png,ui-status.json,browser-progress.json}` 为最终证据。凭据只在内存及进程管道中使用，不保存密码、token 或会话文件。窄屏和用户原 Chrome 会话未因此升级验收。

早期尝试完整保留于 `ui/attempt-1` 至 `attempt-6`：第 1 次 Windows 文本管道编码失败，显式 UTF-8 后修复；第 2/3 次证实 **Chrome 101 缺少 AbortSignal.timeout/any**，现有共享 `components/assistant/client.ts` 在发请求前报错，未修复、未注入 polyfill，也不计通过；第 4 次脚本改题漏带幂等键，被接口正确 422 拒绝，补键后恢复；第 5 次 9 组通过但原结果截图过早，第 6 次补强后页面 9 组通过但与排序修复时间重叠、源码 hash 不稳定，整体退出 1。最终另跑的稳定流程才计入上述当前结果。第 1 次默认进程清理失败后，仅本线 PID `91204` 及其子进程通过单次命令提权清理；无持久权限变更，后续自建进程均自动清理。

Chrome 101 的兼容问题归共享客户端单一维护者：如需支持该浏览器，应在原 `client.ts` 提供 AbortController 超时/外部取消回退并保留既有未决请求、幂等键和错误分类语义，再做跨浏览器回归。知识线没有复制请求体系或改共享文件。整体仍 **Limited**；自动派发/实际执行配置固定/持久取消围栏、客户 Agent/原生及生产发布均未因此完成。

### 已验证的前一稳定检查点 `14d3837b`

前一检查点执行相关离线检查：**41/41 通过、0 失败、0 跳过**，包括协调用例 27 项及既有单元 14 项；被测源码 hash 稳定。相关六文件 ESLint 零错误/警告。同一源码程序类型诊断与基线均为 **287 项，新增 0**，仍不是全项目类型零错误。日志和 JSON 位于 worktree 的 `tmp/knowledge-batch/fixture-fix/`。

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

前一稳定检查点的服务回归使用真实隔离 PostgreSQL/RLS 和既有真实 Embedding，文字生成模型为确定性模拟。离线端口权限/版本仍为模拟，不能替代数据库与客户语义验收。当时没有批次 API/UI；当前手动管理和浏览器结果以上文增量证据为准，不复用旧通过数。执行版本固定及跨进程取消围栏仍待集成；本增量未补配置实模文字回答、C01 Agent/原生语义、完整构建、Stable 原生、真机/BLE、生产容量/恢复或发布验收。整体保持 **Limited**，未合并或部署。

## 计划来源保全

原主工作区计划未编辑、暂存或提交。只复制清单指定的两份计划到本 worktree 忽略目录 `tmp/knowledge-batch/plans/`，复制前后 SHA256 均一致：中文 `498b36b66299fe188cd429d7823e1dc97075c19bf81da06fffe2a6bf2d50d968`；英文 `e4a4d65d063069a7eea38d2228c553ed0ddfff60cee775dbd538442bed457235`。路线图原文哈希 `432611441d0c6c257913472619c3dd6128a0a7d0ab5bd0e769016cdb0e9aae9d` 与交接清单一致。当前原仓库无 `.agents/skills`；已读根/后台指令、相关清单及 KB-4 合同。
