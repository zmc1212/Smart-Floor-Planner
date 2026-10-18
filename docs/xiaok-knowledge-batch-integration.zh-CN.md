# 企业知识：多来源覆盖与批量回归集成交接

状态：**Limited；多文档检索覆盖及知识专属手动批次管理已有有界实现，自动批量派发与客户语义验收仍待集成。** 实际验证见下文，代码存在不等于整批验收通过。本文是知识专项线的可审查交接，不替代[二期合同](./xiaok-assistant-phase-2.zh-CN.md)、[后台清单](./admin-system-modules.zh-CN.md)或用户本地的企业知识计划。基线 `d023854313842ef447efb2973beb540d1511e125`；原业务分支不切换、不写产品代码。

## 离线语义反例与验收规则

`21e4fd39` 后核对既有测试：已有文档入选、逐字引用及业务信封预算样本，尚未约束共同前提在同一段取得双侧证据、四文档全部五个已用片段保留，以及目标模型轮次在派发标记前已知本地拒绝。本增量补实际缺失的离线断言，不修改任何既有测试或共享产品文件。

`admin/scripts/fixtures/assistant-knowledge-semantic-counterexamples.json` 固化合成 run `4245/4246` 已交付回答的前四段、原来源身份/版本/hash/正文/条件，以及 run `4242` 的五个已选规范片段、原始工具载荷和 **48,553 字节**账本。来源 SHA256 与原归档实模报告/复放一致，不含凭据、headers 或私有核对备注。预算测试按账本重建等字节数的不透明字符串，不复制系统提示词，并明确标注；历史失败独立于后续格式器修复测试，不会要求业务修复后仍保留缺陷。

`assistant-knowledge-semantic-rules.ts` 只是**离线验收判定规则**，不是 API、授权缓存、自动语义裁判、派发适配器或新事件 schema。由可信测试/审读者预先指定段落、双方不同原件及完整引文范围，模型/浏览器不能选择或削弱预期。结果始终保留更广含义的 `semanticCorrectness:requires_review`，原生产结构评估器不变。

| 约束 | 通过标准 | 必须拒绝的反例 |
| --- | --- | --- |
| 共同前提 | 在**同一 evidence 段**用双方不同 document/version/hash 的原文，支持完整指定前提。 | 另一段的引用、同侧重复引用、截短条件、旧身份/hash、空或单侧预期；两份真实失败段落均被拒绝。 |
| 四来源完整性 | 保留固定四文档的**全部五个已选规范片段**，正文、身份/hash、出处/条件/适用性/上下文完整；可移除重复摘录或 quote hints。 | 用重复段占第五槽而丢第四文档；保留四文档却丢已用重复段；截文后重算 hash；改元数据或混入额外来源。只读验证原格式器保持规范来源，不改输入。 |
| 超预算派发前拒绝 | 保持 **48,000 UTF-8 字节**，目标轮在新派发标记/HTTP 前拒绝 `agent_input_limit`，该轮 attempt 以已知 failed/unaccepted 结束；允许已创建审计行。 | 已标派发但零 HTTP 的原 unknown 状态、拒绝后新标记、真实派发、缺本地准备、目标 attempt 未知，或直接提高预算。 |
| 原费用边界 | 无前序计费 I/O 时释放/无预留；前轮已有真实 I/O 且费用未知时，本轮虽本地已知拒绝，仍保留 **reconciling**。 | 擦除前轮标记/费用未知，误释放前序计费预留；本地准备失败不授予重试权限。 |

能装入预算的正向样本只存在于测试内：移除重复 hints，但保留全部规范来源；删来源后即使能装入，覆盖仍失败。修正归因与派发观测均明确为模拟正向样本，**不宣称生产修复通过**。

```powershell
node scripts/assistant-knowledge-semantics-offline.mjs --output-dir ../tmp/knowledge-semantics/offline/release
node scripts/assistant-knowledge-batch-typecheck.mjs d023854313842ef447efb2973beb540d1511e125 ../tmp/knowledge-semantics/offline/verified
```

最终离线 **64/64**，其中**新增 32 项、原相关断言 32 项**，失败/跳过/取消均 0，被测源码 hash 稳定；4 个代码文件 ESLint 零错误/警告，同程序类型 **287 → 287，新增 0**，并非全项目零错误。runner 不读取环境/连接文件、不取数据库锁、不启动 Worker，7 个进程均有 fetch/TCP/TLS 守卫；**外部网络尝试 0，模型/Embedding/数据库调用均 0**，只允许既有临时目录中当前/父进程对应的精确编译器 IPC 管道。最初两次 62 项通过后包装层退出非零，原因是过宽守卫**每次**将 12 次 `tsx` 本地管道误记网络，全部已拦截，无外部请求；诊断调用栈确认来源，原结果保留。费用围栏和后续兼容性检查另存，仅 `release/` 为最终单元结果。

证据：`tmp/knowledge-semantics/offline/{fixture-provenance.json,verified/,release/}`。本轮未恢复 `4242`、未调用实模/Embedding、未写数据库或新增模型费用；模块运行行为无变化，复制计划继续独立保全。整体 **Limited**，共享综合解释/预算/派发前修复及后续集成验收仍由业务线独占；离线拒绝反例的测试通过不升级既有实模结果。本线等待该集成，不另开功能或付费复测。

## 配置实模 C01 语义验收

`2f44f460` 后核对隔离库，已有启用的 DeepSeek `deepseek-flash`、原凭据投影和已验证的合成 `langgraph-v1` 模板，因此本线可在不改共享业务代码、供应商配置或凭据的情况下执行限定验收。`assistant-knowledge-semantics-acceptance.mjs --live` 显式启用真实付费调用，沿用整套串行锁，只驱动本轮原执行器租约。锁忙或队列活跃仅等待正常释放，不重置夹具或启动竞争 Worker。

`assistant-knowledge-semantics-live.ts` 复用固定四来源题集，核对前提/批准边界及登记冲突，每题两轮；限定变体分别映射 PPT 6/14/15/23（QA02/04/06）与 PPT 6/23/38（QA06/07），不覆盖整份 PPT。每轮绑定合成客户/线索、真实保存的 v4 主户型及当前水电工地。用正常签发的合成 Mini token 调用原 C01 Request 处理函数，再由 `ConversationService` / `processAnswer` / 真实用户 Agent 执行，不注入文字模型或检索器。这是服务路由验收，不是监听服务、浏览器或 Stable 原生运行；未伪造图片像素、已发布现场记录或正式设计决定版本。

脚本分别记录必需来源上下文、生成回答/引用持久化及独立逐段语义审读；保留真实模型 checkpoint、原文引用及全新 C01 历史回读。fetch 透明观察只记安全 host/path/model/请求正文 hash/状态，不记录 headers 或凭据，不替换响应、不重试。清理前保留索引 attempt、全部供应商 attempt、真实用量、reservation 与事项事件；结果未知时停止后续核心调用。核对原全局配置指纹及相关源码前后 hash；这不是自动批量执行版本固定或分布式取消实现。

```powershell
node scripts/assistant-knowledge-semantics-acceptance.mjs --live --lock-wait-ms 1800000 --connection-file 'G:/workspace/向总/Smart-Floor-Planner/tmp/xiaok-vector/connection.private.json' --env-dir 'G:/workspace/向总/Smart-Floor-Planner/admin' --output-dir '../tmp/knowledge-semantics/live'
node scripts/assistant-knowledge-batch-typecheck.mjs d023854313842ef447efb2973beb540d1511e125 ../tmp/knowledge-semantics
```

四来源/工地运行结果是 **1 失败/indeterminate、3 未执行、语义通过 0**。run `4242` / conversation `4215` 的真实模型先调用 `search_knowledge`，随后真实检索完成，但没有持久最终回答。供应商 attempt `1761` 成功；`1762` 记为 unknown，未观察到第二次模型 HTTP 调用，脚本随即停止，未恢复/换键重试。全局配置与被测源码 hash 稳定。使用已保存 checkpoint 离线复放，明确复现 `agent_input_limit`：聚焦后文本 **48,553 字节**，超过 **48,000**（system 26,032、tool 22,159、两条 user 各 181）。复放模型/Embedding 请求均为零。原被测脚本副本及 hash 与 `live/{live.json,service.log,service-status.json,offline-replay.json,failure-summary.json,tested-sources/}` 一并保留。

业务线最小依赖：`admin/src/lib/assistant/agent/synthesis.ts::focusedSynthesisMessages` 在保留完整已用来源/出处/条件的同时满足原预算；`admin/src/lib/assistant/agent/worker.ts::callModel` 与共享网关 `admin/src/lib/ai/postgres-workflow-chat.ts` 的原 `beforeProviderCall` 顺序，需在标记供应商派发前校验实际请求。现有限制位于 `admin/src/lib/ai/providers/agent-chat.ts::agentChatBody`。本线均不修改、不提高预算、不把 unknown 当作免费或已核清。受阻动作是该四来源绑定工地场景的第二轮模型生成，本地失败且未观察到第二次 HTTP，并非审批拒绝。

失败尝试共 **1 次真实文字模型 HTTP**（输入 6,721 / 输出 49 tokens），**2 笔逻辑供应商 attempt**（1 成功、1 unknown）。真实 Embedding：**10 次文档 / 4,767 tokens**，另 **1 次查询 / 80**，合计 **11 / 4,847**，Embedding 输入未知 0 次。10 次分块输入计量未知；费用保持 `null`，清理前唯一 reservation 为 `reconciling`，事项事件 0。仅清理企业 `3486/3487`、管理员 `6866/6867`、用户 `6860`，随后 **107** 张企业表及精确身份均零遗留，锁释放。回答后的撤回/权限断言没有执行，不算通过。

独立接续选择计划中既有 **KB-1 材料条件与登记冲突的实模语义验收**：复用 `professionalCases.material`（PPT 6/19/38、QA02/06/07）及 `synthesisCases.conflict`（PPT 6/23/38、QA06/07）。`--knowledge-only` 使用另外的合成企业、每题两份短公开来源，明确没有绑定工地/主户型，每题两轮。这是另一个预先确定的验收范围，不恢复/重试 `4242`，不代表四来源/工地场景通过，也不替代 KB-3 集成。

```powershell
node scripts/assistant-knowledge-semantics-acceptance.mjs --live --knowledge-only --lock-wait-ms 1800000 --connection-file 'G:/workspace/向总/Smart-Floor-Planner/tmp/xiaok-vector/connection.private.json' --env-dir 'G:/workspace/向总/Smart-Floor-Planner/admin' --output-dir '../tmp/knowledge-semantics/kb1'
```

KB-1 服务运行完成 **4/4**，失败/未执行均 0，另有 **6/6** 守卫通过：跨企业客户历史拒绝、四次来源撤回后重进、撤销参与者读/发拒绝。已核对必需来源、材料/房间条件缺项、逐字引文、引用回读与回答持久化；8 次实际模型 HTTP / 供应商 attempt 全成功。脚本的退出 0 只代表这些服务检查，并显式等待语义审读。另行逐段对照持久回答与原文，结果为 **2 项限定语义通过、2 项待修正**，不是模型自评：

| 题目 / 轮次 / run | 服务 | 来源语义审读 |
| --- | --- | --- |
| 材料条件 / 1 / `4243` | 通过 | 限定通过：不直接套用，地暖/型号/基层/厂家前提保持未知，建议与查询缺项可区分，无虚构参数/批准/处理回执。 |
| 材料条件 / 2 / `4244` | 通过 | 同一固定要点限定通过。两轮均附较长通用缺项列表；合成共用前提含尺寸/点位资料，因此不能扩大成广泛工程正确性通过。 |
| 登记冲突 / 1 / `4245` | 通过 | 待修正：保留冲突及双方口径，但第 4 段把共同前提归于**两份**规则，两条引用却都只指向 `K1001`。 |
| 登记冲突 / 2 / `4246` | 通过 | 待修正：第 4 段相同归因缺陷；逐字引用有效、开头正确标记未知，仍不足以完整通过。 |

不同原件 `K1001` / `K1002` 实际均含同一前提，因此这是**逐段引用归因不完整**，不是虚假或相互矛盾的前提。反例：“两份规则共同的前提是现场尺寸、完整点位资料和团队核对都还要确认”只引 `K1001`；另一段曾引用 `K1002`，不能替代本段自身的来源支持。业务集成人负责最小共享修正：在 `agent/synthesis.ts` 的指令/修复或最终归因校验中，声称双方时引用双方，或把措辞限定在本段所引原件能支持的范围。本线不改知识协议/共享代码，不宣称完整专业语义通过。

KB-1 计量：**8 次文字模型 HTTP**，输入 **60,868 / 输出 2,624 tokens**；**6 次文档 Embedding / 861 tokens**，另 **4 次查询 / 270**，共 **10 / 1,131**，Embedding 输入未知 0 次。6 次真实分块输入计量未知；4 笔 reservation 因费用未知仍为 `reconciling`，事项事件 0。企业 `3488/3489`、管理员 `6868/6869`、用户 `6861–6864` 先审计后清理，107 张企业表和精确身份均零遗留；全局配置、被测源码稳定，进程退出、锁释放，未启动 3006/3007 服务。

合并本增量两次运行的计量：**9 次实际文字模型 HTTP**，已知小计输入 **67,589 / 输出 2,673 tokens**，**21 次 Embedding / 5,978 输入 tokens**，**16 次分块输入计量未知**。另有 1 笔逻辑 provider attempt 仍为 unknown、未观察到 HTTP，不算成额外实际请求，也不填零用量/费用；全部费用保持 `null`。静态检查：3 个新增/修改代码文件 ESLint 零错误/警告，同程序类型 **287 → 287，新增 0**。未新增离线单元通过数，不宣称全仓类型、完整构建、原生/浏览器或业务线代码验收通过。

证据：`tmp/knowledge-semantics/{preflight.json,stage-summary.json,lint-status.json,type-comparison.json}`，受阻场景位于 `live/`，独立运行及逐段审读位于 `kb1/{live.json,service.log,service-status.json,source-freeze.json,semantic-review.json}`。实际 prompt 为本知识工作区的 `xiaok-renovation-v51`、检索 `professional-hybrid-v4`，未包含业务线后续变更；源码 hash、精确回答/引文、首轮模型输出、失败 checkpoint、全部 attempt/usage 及清理均可分别审查。共享修正后由集成人在集成源码上复跑受影响的绑定场景及两轮冲突题，不把较窄材料结果或 4/4 结构通过借作整体验收。

本节点仅新增验收代码/证据，不改产品 UI、路由、API、schema 或权限行为，因此除下文 v4 集成提案之外无新增运行模块清单影响；整体保持 **Limited**。

## 独立多来源覆盖增量

稳定检查点 `b30e75d7` 后的下一节点对应计划 K-03/K-04 的具体缺口：最多五段时，v3 第一遍每份文档取两段，可能选入 A1/A2/B1/B2/C1，挤掉必需的 D，包括登记冲突的一方。新离线断言五项中三项在旧选择器失败。修复后先为每份可用文档保留一段，再按原排名补重复段；明确不适用的规则仍排在所有可用段之后，包括可用重复段，未知条件仍为未知。来源对象、原文及定位保持。超过五份可用文档、同一文档未入选的必要细节，以及原候选预算以外的资料仍有限制。

`professional-hybrid-v4` 如实记录 `maxPerDocumentFirstPass:1`；维度、每路 30、RRF k60、相关度下限 0.3、最终最多五段保持，不需要重建索引。授权、当前有效/发布/受众/profile 过滤、检索签名、Evidence/引用协议及适用性不变。新诊断记录 v4，不回写历史 v3。预览和 Agent 复用的知识入口会采用新选择，但这不证明任一路径的回答语义或后续提示预算保留了全部来源。

预先固定的两道合成题分别核对四来源的前提/批准边界，以及重复背景段之后的登记冲突资料，每题两轮真实分块、Embedding、隔离 PostgreSQL/RLS 检索。必需 document/version IDs 在查询前确定；内部、未发布及其他企业资料留在候选池之外，用户声称材料已知不能补齐服务端缺项。测试核对原文/hash/版本及真实分块偏移，并在真实查询 Embedding 期间下架来源，验证原 I/O 后守卫和引用解析。实际候选池的旧 v3 重放只作诊断证据，不作预期来源判定依据。未调用文字模型、配置实模 C01 Agent 或原生界面；这是来源覆盖检查，不是专业正确率评分。

本节点专属文件：`knowledge/context-selection.ts`、`knowledge/retrieval.ts`、知识专属测试、固定合成题集、专项验收/类型 runner 及本文双语交接；旧专业服务测试的诊断版本预期同步为 v4，该九项服务套件本增量未重跑。已核对与业务工作区的文件归属。未改 UI 结构/样式/素材/文案、路由/API/model/权限形状、共享 Agent/队列/schema/迁移或公共引用权限代码。既有 Admin 界面保持，因此不新增浏览器/原生视觉通过声明。

共享文档单点集成人需替换双语二期合同及后台清单中原 KB-3 检索段落：**Limited：professional-hybrid-v4，先覆盖每份可用文档一段，再在五段内补有用重复段；实际 K-03/04 来源覆盖证据与客户语义验收分别记录。** 本地计划的当前配置只在其另行维护的计划变更内同步；不得改写/提交复制计划、追加 UI 台账历史行，或为本后端变化升级原生还原状态。

在本 worktree 的 `admin` 下复跑：

```powershell
node scripts/assistant-knowledge-coverage-acceptance.mjs
node scripts/assistant-knowledge-coverage-acceptance.mjs --service --lock-wait-ms 1800000 --connection-file 'G:/workspace/向总/Smart-Floor-Planner/tmp/xiaok-vector/connection.private.json' --env-dir 'G:/workspace/向总/Smart-Floor-Planner/admin' --output-dir '../tmp/knowledge-coverage/live'
node scripts/assistant-knowledge-batch-typecheck.mjs d023854313842ef447efb2973beb540d1511e125 ../tmp/knowledge-coverage
```

服务 runner 沿用整套 advisory lock、批准的非 superuser/non-BYPASSRLS `55432/xiaok_embedding_eval`，要求队列空闲；锁占用仅等正常释放，不重置夹具、抢锁或启动竞争 Worker。直接查询 Embedding 在测试 gateway 内完整计量，清理前与持久文档索引 attempt 分开留存；不伪造聊天 run 或 usage 行，费用保持 `null`。

验证：离线 **15/15**，真实服务 **6/6**，各自失败/跳过/取消均为零，被测源码 hash 稳定；服务用时 **73.08 秒**。两题各两轮均保留四份固定必需资料。“前提/批准边界”题的实际候选池旧 v3 重放两轮均漏掉文档 `907`，v4 两轮均保留；冲突题的旧实际排名已保留双方，所以其两轮通过证明保持，不能当作新复现的真实冲突失败，单边冲突缺陷由另行离线压力样本复现。相关 ESLint 零错误/警告；同程序类型 **287 → 287，新增 0**，并非全项目零错误。不从小样本推导质量百分比或 P50/P95。

删除夹具前，`KB_COVERAGE_AUDIT` 将 **10 次文档 Embedding / 4,789 输入 tokens** 与持久成功 attempt 对齐，另记 **6 次直接查询 / 362 tokens**，共 **16 次 / 5,151**，全部成功、Embedding 输入未知 0 次。另有 10 次真实分块，其输入计量未知，不混入 Embedding 总数。文字模型调用 0，费用未知，不把模拟文字生成当作语义通过。仅清理前缀 `synthetic-kb-coverage-7120ce4f-9b57-4a20-90ee-76df7615e055` 下的企业 `3483/3484`、管理员 `6861/6862`、用户 `6854/6855`；随后核对 **107** 张含 `enterprise_id` 的 app 表与精确企业/管理员/用户均零遗留。服务进程退出并释放本线锁；本轮未启动 3006 或 3007 服务。

证据：`tmp/knowledge-coverage/{red-unit.log,red-unit-status.json,unit.log,unit-status.json,lint-status.json,type-comparison.json}` 及 `live/{service.log,service-status.json,coverage-summary.json,embedding-audit.json,cleanup-audit.json}`。`attempt-0-bun-runner.*` 保留合法 Node 执行前的一次运行器调用错误；`attempt-1-summary-parser.*` 保留 15 项通过但包装层摘要计数错误的运行，均不另算产品测试结果；修正后的包装层拒绝零项测试运行。整体 **Limited**，未合并/部署、未新增凭证或修改权限。

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

本线按交接不改共享双语合同/模块清单、Agent、队列、schema、迁移、引用权限或原生 UI。只修改知识专属检索/选择、运营服务/API、Admin 管理组件与页面入口、相邻 DTO/客户端恢复、回归及 runner；不修改共用 `components/assistant/client.ts`。原工作区对所改既有知识文件自基线无提交或未提交差异。新增接口及可见流程已超出旧清单的逐题描述，须由单一集成人合并时同步以下当前记录，本线不抢写共享文件。

集成人接入时，应替换双语后台清单中现有 KB-4 当前段落，并更新二期合同的同一个 KB-4 记录，概括：

> KB-4 继续 Limited。原问题集新增 1–50 题原子准备、服务器本人批次分页/元数据进度及批次链接重进；逐项恢复原 evaluation/create/send keys，已关联本人私有 run 可取消，沿用原 job/额度未知费用协议。沿用所选企业三类管理角色及 Ant Design/Admin Pro/720px Drawer/共享反馈，不新增 schema、队列或 Mini 布局。自动批量派发、执行模型/prompt 固定、跨进程取消围栏及客户 Agent/原生复验仍待集成，手动逐项管理不等于完整批量调度。

单一集成人应在双语后台清单 KB-4 当前段及二期合同 KB-4 同一记录写入上述范围与实际证据；后台 UI refactor 的 `/assistant-knowledge` 单行补“批次选择/本人进度、原键恢复、已关联 run 取消”，保留原路由/API/权限边界与当前浏览器证据，不附加历史行。小程序清单/恢复账本无本轮运行界面变化，不升级状态。本文不是新视觉方案、未执行验收的证明或生产授权。

具体集成依赖：① 服务端实际执行模式/provider/model revision/prompt/generation settings 固定及可验证 executionRevision；② 沿原机制串行化跨进程/多标签派发与持久取消意图；③ 真正 `EvaluationBatchPort` 适配器及取消/未知结果/并发端到端回归；④ 受影响的客户 C01/原生引用重进复验。当前知识管理子流程不依赖业务 Agent 改造，其余只提交接口提案，不越界修改共享 runtime。

用户已将以下共享修改交给业务集成人，表内模块路径位于 `admin/src/lib/assistant/`，共享客户端为 `admin/src/components/assistant/client.ts`；证据相对于本 worktree：

| 共享事项 | 文件/接口要求 | 证据及当前限制 |
| --- | --- | --- |
| 实际执行配置固定 | `knowledge/evaluation-batch.ts::EvaluationBatchPort`（`preflight/observe/resume/cancel`）及服务端 `executionRevision`，接入 `core/conversation.ts::newRun/send`、`infrastructure/model-gateway.ts::textGateway` 和 Agent worker 的 `ports.model/authorize`。含实际 preview/Agent 模式、供应商身份、model/revision、prompt/version、生成参数及 **retrievalConfiguration**，排除凭证；在原写入/派发边界固定并重验，独立前检不够，保留既有 Agent 配置守卫。 | `knowledge/operations.ts::prepareBatch` 只固定题目/来源/epoch/profile/policy；`__tests__/knowledge-evaluation-batch.test.ts` 是确定性端口模拟。尚无生产自动适配器或真实执行固定验收，是集成缺口，不是已复现的供应商故障。 |
| 跨进程取消围栏 | 在原 `core/conversation.ts::cancelRuns/run` 和任务排序边界（`infrastructure/job-queue.ts` 的 settings 锁）内串行化持久取消意图、未启动 `resume` 及 evaluation/run 关联；取消后不得为找 run 而发送，已提交未知结果保留原键/预留。本线不新建队列/schema 权威。 | `EvaluationBatchCoordinator.requestCancel` 是实例内状态；`KnowledgeOperations.cancel` 只处理已关联 run，未关联返回 409。`tmp/knowledge-batch/admin-entry/final/service.log` 和 `assistant-knowledge-batches.test.ts` 验证这些限定行为，包括模拟已提交标记的费用核对，未验证分布式取消。 |
| Chrome 101 请求兼容 | `components/assistant/client.ts::assistantRequest` 在 `b30e75d7` 行 38–39 于 fetch 前调用 `AbortSignal.timeout/any`。共享层增加 AbortController 回退及计时器/监听清理，保留调用者 abort、确定/不确定错误分类和 `AssistantMutations` 原键；验证超时、外部取消和失败恢复。 | Chrome 101.0.4951.54 在 HTTP 前复现 `AbortSignal.timeout is not a function`：`tmp/knowledge-batch/admin-entry/ui/attempt-3/{failure-aria.txt,failure-state.json,failure-page.png,browser-error.log}`；能力实测 `ui/browser-compatibility.json`。已通过 UI 使用 Edge 155，未注入 polyfill，不能代作 Chrome 通过。 |

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
