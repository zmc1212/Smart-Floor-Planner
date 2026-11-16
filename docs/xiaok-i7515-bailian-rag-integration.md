# I7.5.15 百炼托管 RAG 主服务接入

2026-11-16（Asia/Shanghai），在 `codex/xiaok-integration` 交付。开始时核对远端 HEAD `b7c0c0ba`，验收基线包含随后同步到当前分支的 `5b01295f`。沿用 [I7.5.13 批次与索引验收](./xiaok-i7513-knowledge-batch-acceptance.md) 和 [I7.5.14 本地向量与文本验收](./xiaok-i7514-real-ai-knowledge-acceptance.md)。I7.5.14 报告在仓库，所列的 `admin/scripts/xiaok-i7514-real-ai-knowledge-acceptance.ts` 在远端基线和当前工作区均未找到。本轮的可复跑入口是 `admin/scripts/xiaok-i7515-bailian-rag-acceptance.ts`。

## Provider 和授权

- `ASSISTANT_KNOWLEDGE_PROVIDER` 默认 `BAILIAN_RAG`。`LOCAL_PGVECTOR` 可显式使用本地索引。原有 `bailian`、`local` 配置值仍可读。现有显式关键词检索和隔离 FastGPT 预览沿原入口。
- `KnowledgeService` 和知识任务 Worker 负责申请上传租约、签名 OSS PUT、文件注册与解析、单文档建库或追加、索引状态和切片核验。北京地址取 `https://{workspaceId}.cn-beijing.maas.aliyuncs.com`，Bearer Key 取服务端 `ASSISTANT_BAILIAN_RAG_API_KEY`。任务幂等键绑定租户、版本、编辑号、内容哈希及索引 profile。确定回执落库后续跑，未知写入结果保留待核对。退役和版本替换先在应用内撤回，Worker 再按已绑定的索引、文档和文件 ID 删除远端副本。[RAG API 概览](https://help.aliyun.com/zh/model-studio/rag-api-overview) · [认证](https://help.aliyun.com/zh/model-studio/rag-api-authentication) · [删除文档](https://help.aliyun.com/zh/model-studio/rag-api-delete-document)
- `assistant_managed_knowledge_libraries` 保存 `enterpriseId → Workspace → indexId`，`assistant_managed_knowledge_imports` 保存每一审核版本的 `fileId`、`indexDocumentId`、`ingestionId`、过滤标签和回执。一个已配置的北京 Workspace 内，每家企业的索引独立。项目资料仍属于企业索引，服务端通过文档项目绑定、项目状态和会话角色额外收敛。
- 平台公共语料使用专用承载企业自己的索引。迁移 `0132` 加入 DBA 管理的单条 `assistant_platform_knowledge_library` 映射。平台管理员通过同一知识服务审核发布，租户应用角色只有映射读取权限。公共库提供已发布、有效的通用语料，检索结果标为 `knowledge.scope=platform`。本企业证据优先，公共库补充。员工知识预览读取选定企业的固定来源范围。
- `KnowledgeRetriever/Evidence` 按当前身份、企业、会话权限、项目、阶段、受众、有效期、版本和索引映射筛出版本。阶段条件由审核版本的 `professional.conditions` 提供，阶段取服务端项目记录。百炼回包对照 workspace、index、文档、切片和原文哈希后才进入候选。服务端在返回结果及重开引用时复核来源。文件导入可提供 `professional.origin.page` 记录复核过的原件页码。引用存档保留标题、来源、版本和逐字摘录，平台参考资料走现有公共来源识别。提取式问答只交付所选原文，缺可靠依据时返回 `insufficient_evidence`。
- 托管索引就绪时，由已配置的本机 Qwen3-Embedding-0.6B 为同一审核分片写入 pgvector 1024 维备用向量，并绑定固定 profile。连接失败、超时、上游限流或不可用时，要有完整兼容的获权索引才能自动切换。明确的凭据拒绝和映射冲突返回错误。正常未命中保持空证据。备用失败返回 `retrieval_unavailable`，成功结果记录实际 Provider。旧托管分片缺少备用向量时，可经现有新版本索引流程补齐。兼容回执与公共引用外键需要 `0132`。

## 隔离验收

`run-08` 在独立回环 PG17.10、pgvector 0.8.2、非超级 `sfp_app` 下 **13 项通过**。企业 A、B 和平台承载库均为合成数据。工艺来源为已核验的 PPT 第 17、18 页摘录。正式知识服务、施工服务、索引 Worker、检索及会话回读均实际读写隔离 PG。百炼 HTTP 为 Mock，文本答复由合成选择器返回，Qwen3 本机 Embedding 为真实 HTTP 和 CUDA 推理。

| 证据 | 验收结果 |
| --- | --- |
| Workspace 和映射 | 缺少 Key 时配置检查准确报错。Mock 北京 Workspace `llm-r4-mock` 读回 `request-1`。A 的两个资料共用 `index-0`。B 和平台分别映射 `index-1`、`index-2`。企业角色直接写公共库映射返回 PostgreSQL `42501`。 |
| 上传与索引 | 水路 Mock 文件/索引文档 `file-0-1`，索引切片回执 `request-9`。防水 Mock 文件/索引文档 `file-1-2`，导入任务 `import-0`，切片回执 `request-20`。重复创建和重复索引复用原记录。 |
| 水电检索 | “家里现在做水电施工，这一步水路主要做什么？”首位是 A 的第 17 页版本 `1`，原文“这个阶段主要在做家里的用水管路。”。企业与公共库 Mock 检索回执为 `request-37`、`request-38`，平台引用回读标为平台公共知识。 |
| 防水检索 | “卫生间接下来做防水，施工和后续检查由谁安排？”在防水项目命中版本 `2`，Mock 检索回执 `request-39`。真实保存并重开引文“施工和后续检查，由项目团队安排”，页码 `18`，版本号 `1`。 |
| 权限与版本 | A/B 双向会话、文档访问拒绝，伪造的跨索引回包被过滤。同企业其他项目和错阶段不能取得防水资料。检索时项目阶段变化返回 `context_changed`。新版发布后返回新分片，旧版和撤回的公共引文无法重开。重复清理没有新增 Mock 删除，旧防水清理回执为 `request-68`。 |
| 本地备用 | Mock 连接错误和 HTTP 503 分别触发实跑 `LOCAL_PGVECTOR`，命中同一水路和防水审核版本。两条查询各观测 35 输入 Token，首位余弦相似度为 0.6941 和 0.8020。显式本地模式、缺 Key 的兼容降级、服务恢复后优先百炼均通过。 |
| 失败与无数据 | Mock 403 禁止自动切换。删除备用 profile 标记时返回 `local_index_incompatible`。双引擎故障保存 `failed / retrieval_unavailable`，没有模型调用。空的获权预览保存 `insufficient_evidence`。 |

Mock 合计 72 次 HTTP 调用和 2 次合成文本选择。托管 Token 和费用字段保持未知。原始回执为 `tmp/xiaok-i7515/run-08/result.json`，执行前后 1,134 个输入文件的绑定摘要均为 `edd6d68a3d948373b3e7ed9f5cb6569e3adda333596925dbf999b28ba8aea572`。既有 C01 引用组件读取 `sourceLocation`，平台来源在该字段带上“平台公共知识”，并保留原件名、页码与原文。

## 真实 API 和费用

### 北京按量服务开通后的验收

2026-11-16，用户授权开通北京知识库按量服务，测试上限 ¥5.20。进入北京 RAG 控制台后，`xiaok-i7515-acceptance` 的临时标准库 `pf4i94yzok` 通过真实检索并返回一条水路切片，`requestId` 为 `247b4985-0be8-9d17-827f-a808ec768b5f`。控制台与试验接口共同确认服务可用。百炼当前流程在首次进入控制台时自动开通。[百炼快速开始](https://help.aliyun.com/zh/model-studio/rag/quickstart)

`payg-r01` 运行在远端 `4cf226c8` 的独立快照，使用独立 PG17.10、pgvector 0.8.2、`sfp_app` 和两家合成企业。测试库中的 1454 行数为 0。快照补丁保存在 `tmp/xiaok-i7515/payg/acceptance-r01.patch`，用于复用既有 DeepSeek 实测证据、禁止新增文本调用并读取远端删除结果。1,135 个输入文件前后摘要一致，`be2d7f5ec1fa0ebe07a4a8b3aeac14db59a2bcb68fb4c99885cb9fecc08bd63f`。12 项服务检查与 1 项资源清理通过，快照 TypeScript 与定向 ESLint 通过。

| 实云检查 | 结果 |
| --- | --- |
| 托管检索 | 企业 A 水路由 `BAILIAN_RAG` 召回 PPT 第 17 页的获权片段，企业证据排在平台补充之前。企业索引 `h0y6qx4jaf` 请求为 `1e9c0f04-ad31-909c-936f-f05f83884478`，平台库请求为 `651b4817-6547-99a2-8ecb-6ff8e782839d`。防水项目命中第 18 页，托管请求为 `8586e4f4-0e48-9be8-ad0c-1e47953cf4e0`。 |
| 全链路引用与隔离 | 从原会话读回防水项目原文“施工和后续检查，由项目团队安排”和平台公共知识“这个阶段主要在做家里的用水管路。”，页码与版本一致。企业 A/B 跨库、同企业非授权项目和不匹配的阶段均拒绝。模拟托管连接故障后，真实 pgvector 备用检索通过。模拟双引擎故障返回 `retrieval_unavailable`。 |
| 同库版本更新 | 防水新版在原索引 `h0y6qx4jaf` 增量导入，导入 ID `632978914633494fb96c3516f5cd541c`，新文档 `file_bc71f76c052e484983d65ea4f8814788_19723533`，切片回执 `0774af3a-58f4-9b20-8e9e-23bdb2688f25`。发布后该问题只返回新版，旧引用立即失效。 |
| 远程文档清理 | 旧防水文档 `file_8a93a524a2214a7aa109c7ac4aebc441_19723533` 的索引删除请求 `a33c2502-5137-967d-b5f1-527fb3df0661`，文件删除请求 `b2e6fcc0eb99430bb3230c1a3dc8f8fe` 回执为 `DELETED`。首次列表读回仍可见，最终列表请求 `756725ce-5805-9e0a-a788-1cb5fa3f90ba` 确认旧文档消失、新版保留。平台退役清理也通过，重复处理没有新的删除请求。 |

本轮主体记录 85 次真实 HTTP 请求，其中 13 次托管检索。开通探测另外使用 1 个标准库与 1 份短摘录。全部 4 个临时库和 6 个文件已清理，库列表为 0，最终请求为 `23711a6e-b130-993b-a70e-404df4343e3a`。向量模型的临时推理权限已恢复。资源包购买、真实企业写入和生产部署数均为 0。

本机验收数据库、快照工作树和临时凭据已移除，PG 与 Embedding 端口均已关闭。自动审查拦截递归删除，保留停止状态的运行目录。参见 `tmp/xiaok-i7515/payg/local-runtime-cleanup.json`。

全部临时库运行时长合计约 222.126 秒，按标准版 ¥0.03/小时估算规格费约 **¥0.00185**。用 4 个库各 1 小时、向量及排序合计 10 万 Token 作保守预算约 **¥0.17**。新增文本模型调用为 0。真实 RAG 回执未提供 Token 用量，实际应付金额待账单核对。原始回执、控制台证据和基础配置绑定保存在 `tmp/xiaok-i7515/payg/`。[知识库计费](https://help.aliyun.com/zh/model-studio/billing-for-knowledge-base)

### 开通前的验收与费用

2026-11-16 补验从远端 `002aab09` 开始。北京专用 Workspace `ws-qq0212tanwuu34yn` 及 Key 从 Git 忽略的 `admin/.env.local` 读取。预检知识库列表 HTTP 200，`requestId` 为 `6b2f2274-e220-986e-a04e-731131b84d18`。隔离库仅恢复结构与迁移账本，应用角色为 `sfp_app`，PG 17.10、pgvector 0.8.2，业务数据由验收驱动创建，企业 1454 行数为 0。

| 通道 | 状态 | 实测结果 |
| --- | --- | --- |
| 北京 `BAILIAN_RAG` / `text-embedding-v4` | `limited` | 水电和防水分别在企业 A、B 完成真实文件上传、解析、首份索引及切片核验。企业独立映射和双向授权否决通过。增量导入、托管检索被百炼拒绝。 |
| 百炼 `deepseek-flash` / `deepseek-v4.1-flash-1017` | `passed` | 两次北京 Responses API 都返回 HTTP 200、实际模型、使用量和有效引用选择。Worker 使用本地 pgvector 同源证据，两条问答持久化并由原用户重开。 |
| 本地 Qwen3-Embedding-0.6B / PostgreSQL | `passed` | 已审核文本写入 1024 维兼容备用向量。模拟托管连接失败后自动切换并返回同一版本。模拟双引擎故障后保存 `retrieval_unavailable`，模型调用 0。GPU 固定 revision `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`，11 个模型文件通过 I7.5.14 清单校验。 |

| 合成资料 | 百炼真实索引和文档 ID | 建库 / 切片 `requestId` |
| --- | --- | --- |
| 企业 A 水路 | `tilmw938ey` / `file_0e6e84c3f1774d6986eaae5f9fd40784_19723533` | `0edd37c8-0ee5-967e-805d-b0e631283abb` / `38905601-1647-962d-9205-a0ed1fa5feb4` |
| 企业 B 项目防水 | `spcb6lylvn` / `file_689fd68c1706404982272277d8b651a9_19723533` | `f69afe8f-f212-94f6-961d-e8314a674568` / `cbfd74d7-b648-9ef1-b5ff-22f6c2108576` |

真实 `create_v2` 成功回执使用 `pipelineId`。适配器兼容该字段和文档示例的 `id`。两者冲突时保留请求 ID 和未知写入结果。水电、防水切片均核对审批原文并生成兼容备用向量。重复导入提交复用本地记录，重复索引提交复用任务且未增加百炼文件。跨企业双方会话、文档、引用读回均拒绝。同企业其他防水项目在调用百炼前拒绝项目资料。防水文档退役后旧引用不可打开，重复退役命令复用结果。

| 真实问答及回读 | DeepSeek `requestId` | 输入 / 输出 Token | 忙时原价估算 |
| --- | --- | ---: | ---: |
| 水电“这一步水路主要做什么？”返回 PPT 第 17 页、版本 1，企业引用“这个阶段主要在做家里的用水管路。” | `d17bb005-f61e-91a9-ac0a-a0a71bc78ad7` | 574 / 40 | ¥0.001468 |
| 防水“施工和后续检查由谁安排？”返回 PPT 第 18 页、版本 1，项目引用“施工和后续检查，由项目团队安排” | `46e644ab-f240-98a1-b0d2-b90651b94044` | 602 / 83 | ¥0.001868 |

`failed` 原样保留。`live-01` 的授权预检解析了错误字段。`live-02` 的建库请求 `86eb63b9-94ba-9eff-b750-63dd265a24dc` 成功，旧适配器无法绑定回执，后来按该回执清理临时索引。修正后 `live-03` 防水增量导入 `b05845f6-4783-96b8-9207-3025fd15cf04` 与 `live-04` 水电托管检索 `8c5683f6-0562-9d9d-916f-f17d57ceef4d` 均返回 HTTP 400、`Index.BailianIndexServiceNotOpen`。`live-04` 原防水断言误期待企业范围，查询已保存会话核实实际为授权项目范围。清理权限读回曾被限流，后续对两个精确模型复核均已恢复原状态。

开通前的 `not_run` 项包括托管防水检索、平台补充的实云检索、同库版本替换和远程单文档退役清理，已由 `payg-r01` 补齐。离线 `replay-mock-01` 重跑 13 项通过，覆盖公共语料、阶段变化、版本替换、单文档清理和兼容故障降级。

实测前按 3 个标准库各 1 小时、向量及排序 10,000 Token、2 次 DeepSeek 各 4,000 输入及 512 输出 Token 估算约 **¥0.12**，以 ¥0.20 控制本轮规模。所有轮次共串行注册 5 个小文件、创建 4 个临时库，最多同时存在 2 个。库寿命合计约 120.081 秒，规格费按目录价估算约 ¥0.001001。DeepSeek 共 1,176 输入、123 输出 Token，忙时未扣缓存折扣约 ¥0.003336。RAG 真实回执未返回 Token，计费账单尚未核对。

临时索引和文件均已删除，最终列表为 0，`requestId` 为 `d94983e6-9550-90a5-bf78-4ea6e5fd90bb`。真实逐请求回执、原始失败与复核保存在 `tmp/xiaok-i7515/live/` 和 `tmp/xiaok-i7515/live-01/` 至 `live-04/`。`live-04/local-readback.json` 记录两条持久引用、双引擎故障和应用内退役。正式模型配置、真实企业及生产部署未执行写入。[知识库计费](https://help.aliyun.com/zh/model-studio/billing-for-knowledge-base) · [模型价格](https://help.aliyun.com/zh/model-studio/model-pricing) · [DeepSeek Responses 接口](https://help.aliyun.com/zh/model-studio/deepseek-api)

补验定向测试 62 项、TypeScript、定向 ESLint 和计划检查通过。`live-04` 与 `replay-mock-01` 各自绑定 1,135 个输入文件，执行前后摘要一致。同期同步的 `40ea2f7a` 仅更新另一份 DBA 报告。验收 PG 和 Qwen 端口已关闭，一次性明文凭据已移除，原归档摘要一致。自动审查拦截了本机临时目录的递归删除，保留停止状态的目录。详见 `tmp/xiaok-i7515/live/local-runtime-cleanup.json`。

## 复跑和限制

在 `admin` 中通过 `XIAOK_I7515_DATABASE_URL` 和 `XIAOK_I7515_OWNER_URL` 指向同一份已迁移、带 `xiaok-i7515-` 注释的独立 PG17 副本，使用 `sfp_app` 和 `sfp_migrator`。通过 `ASSISTANT_EMBEDDING_URL` 与 `ASSISTANT_EMBEDDING_API_KEY` 接已验收的回环 Qwen3 服务。运行 `node --import tsx scripts/xiaok-i7515-bailian-rag-acceptance.ts <新标签>` 执行 Mock。实云使用无业务数据的新副本，设置 `XIAOK_I7515_EXPECTED_WORKSPACE_ID` 校对本机文件中的专用空间 ID。追加 `--live-core` 跑两家合成企业首份资料和双阶段问答，或追加 `--live` 跑包含增量导入、公共库及版本替换的完整范围。

- 定向测试 78 项通过，完整 TypeScript、定向 ESLint、隔离快照 `npm run build -- --webpack` 均通过。Webpack 生成 117 个静态页面。既有数据库回归在当前交付和基线 `5b01295f` 上均为 9 通过、13 失败、4 跳过，失败及跳过的测试名称一致。知识库 9 项均通过。旧问答组要求显式启用企业知识，且部分用例依赖本次跳过的真实模型首答。原始日志在 `tmp/xiaok-i7515/`。
- 迁移账本从 128 到 129 条，知识分片、托管库、托管导入和引用表继续启用强制 RLS。9 个隔离库已清理，回读剩余 0。本轮 PG 和 Qwen 监听已停止，一次性凭据已移除，源归档摘要复核一致。见 `pg-cleanup.json` 和 `resources-cleanup.json`。
- 本轮补验覆盖真实建库协议、独立阶段问答、用量回执和引用读回。真实账单及小程序原生界面验收仍为 `limited`。
- `failed` 历史轮次保留在原始证据中。第一次归档恢复缺少隔离角色 `sfp_auditor`。初版迁移中 PG17 拒绝生成列搭配外键 `ON DELETE SET NULL`，改为落库时绑定来源归属后迁移成功。集成 `run-01` 至 `run-04` 分别保留启动格式、SQLSTATE 断言、模拟召回阈值、复用未结算会话的失败，后续隔离副本完成对应复验。
