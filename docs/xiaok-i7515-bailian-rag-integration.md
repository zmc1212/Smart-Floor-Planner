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

| 通道 | 状态 | 真实请求及费用 |
| --- | --- | --- |
| 北京 `BAILIAN_RAG` / `text-embedding-v4` | `not_run` | 进程环境和开发 `.env.local` 均无获批专用 Workspace 和 Key。真实 `requestId`、`documentId`、`indexId`、响应及 Token 未观测。云请求 0，支出 ¥0。 |
| 百炼 `deepseek-flash` / `deepseek-v4.1-flash-1017` | `not_run` | 复用现有百炼适配器的精确模型绑定和 Responses 能力登记。没有可与批准的 RAG 场景配对的真实试验。正式平台配置未写入，真实模型请求 0，支出 ¥0。 |
| 本地 Qwen3-Embedding-0.6B / PostgreSQL | `passed` | 本机 CUDA 固定 revision `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`，11 个模型文件按 I7.5.14 清单验签，向量 1024 维。此路径没有云调用费用。 |

后续如获批实测，按标准版目录价示例，A、B 和平台三个临时库按 1 小时估算约 ¥0.09。以向量输入 10,000 Token 为预算例，`text-embedding-v4` 约 ¥0.005。两次 DeepSeek 各按输入上限 4,000 Token、输出上限 256 Token 估算，北京忙时原价约 ¥0.0201。合计预算示例约 ¥0.116，额外排序、解析能力与实际计费时长按账单核对。获批资源、预算与清理范围决定实际执行规模。[知识库计费](https://help.aliyun.com/zh/model-studio/billing-for-knowledge-base) · [向量计价](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api) · [模型价格](https://help.aliyun.com/zh/model-studio/model-pricing) · [DeepSeek Responses 接口](https://help.aliyun.com/zh/model-studio/deepseek-api)

## 复跑和限制

在 `admin` 中通过 `XIAOK_I7515_DATABASE_URL` 和 `XIAOK_I7515_OWNER_URL` 指向同一份已迁移、带 `xiaok-i7515-` 注释的独立 PG17 副本，使用 `sfp_app` 和 `sfp_migrator`。通过 `ASSISTANT_EMBEDDING_URL` 与 `ASSISTANT_EMBEDDING_API_KEY` 接已验收的回环 Qwen3 服务。运行 `node --import tsx scripts/xiaok-i7515-bailian-rag-acceptance.ts <新标签>`。驱动仅启用进程内百炼 Mock，执行后可清理该一次性副本。

- 定向测试 78 项通过，完整 TypeScript、定向 ESLint、隔离快照 `npm run build -- --webpack` 均通过。Webpack 生成 117 个静态页面。既有数据库回归在当前交付和基线 `5b01295f` 上均为 9 通过、13 失败、4 跳过，失败及跳过的测试名称一致。知识库 9 项均通过。旧问答组要求显式启用企业知识，且部分用例依赖本次跳过的真实模型首答。原始日志在 `tmp/xiaok-i7515/`。
- 迁移账本从 128 到 129 条，知识分片、托管库、托管导入和引用表继续启用强制 RLS。9 个隔离库已清理，回读剩余 0。本轮 PG 和 Qwen 监听已停止，一次性凭据已移除，源归档摘要复核一致。见 `pg-cleanup.json` 和 `resources-cleanup.json`。
- `limited` 包括实云协议往返、真实模型回答质量、真实账单以及小程序原生界面验收。当前证据覆盖既有会话、任务和引用服务。
- `failed` 历史轮次保留在原始证据中。第一次归档恢复缺少隔离角色 `sfp_auditor`。初版迁移中 PG17 拒绝生成列搭配外键 `ON DELETE SET NULL`，改为落库时绑定来源归属后迁移成功。集成 `run-01` 至 `run-04` 分别保留启动格式、SQLSTATE 断言、模拟召回阈值、复用未结算会话的失败，后续隔离副本完成对应复验。
