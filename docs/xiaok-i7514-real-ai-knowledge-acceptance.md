# 家客来 I7.5.14 真实知识服务与本地 Embedding 验收

2026-11-16（Asia/Shanghai），从 `codex/xiaok-integration` 的 `97eb5c39` 复核 [I7.5.13 遗留项](./xiaok-i7513-knowledge-batch-acceptance.md)。本轮业务验收使用独立 PG17 和合成租户，工艺文本取自仓库已核验的 PPT 摘录。

| 状态 | 结果 | 验收范围 |
| --- | --- | --- |
| `real_bailian_status` | `limited` | 已配置的百炼文本路由两次真实请求通过。托管 RAG 缺少获批的北京 Workspace 与专用 Key，上传、建库、查询和删除为 `not_run`。 |
| `embedding_status` | `passed` | 独立本机 GPU 服务生成 1024 维向量，正式索引写入 PG17，余弦查询、版本更新、退役、幂等及租户隔离通过。 |
| `retrieval_status` | `limited` | 本地两条问题的首位命中与来源回读通过。真实百炼检索及同题对照 `not_run`。 |
| `knowledge_qa_status` | `passed` | 水路及防水两条固定问题均真实调用文本模型，保存回答、回读引文和版本校验通过。无可用来源时返回 `insufficient_evidence`。 |
| `fallback_status` | `limited` | 本地检索连接失败、超时与恢复通过。文本模型不可用时，两条问答均进入 `model_unavailable`，facts-only 未交付。 |

## 百炼配置、费用与实际调用

- 开发生效环境只加载 `.env.local`。`ASSISTANT_BAILIAN_RAG_WORKSPACE_ID` 和 `ASSISTANT_BAILIAN_RAG_API_KEY` 均缺失，代码默认知识模式为 `bailian`，默认索引向量模型为 `text-embedding-v4`。`ASSISTANT_RESPONSES_API` 未配置，当前进程设置未启用 Responses 开关。RAG 接口要求北京业务空间对应的 endpoint 及具备该空间权限的 API Key。[百炼 RAG 鉴权](https://help.aliyun.com/zh/model-studio/rag-api-authentication)
- 原开发转发起初返回 `ECONNREFUSED`，SSH 在密钥交换阶段断开。提交前复核发现原转发已恢复。以 `sfp_app` 在 PG17.10 的 `READ ONLY` 事务只读平台 `platform_configs.llm_config` 的默认项，确认 override 启用、已保存文本凭据，实际配置为 `dashscope`、`qwen3.7-flash`、`https://dashscope.aliyuncs.com/compatible-mode/v1`。使用现有 OpenAI 兼容适配器实测 `POST /compatible-mode/v1/chat/completions`。配置探测与恢复前后证据分别在 `database-discovery.json` 和 `recovered-preflight.json`。 [I7.5.7 环境报告](./xiaok-i757-ai-worker-environment-preparation.md)
- 托管知识库标准版平台存储标价 `¥0.03/库/小时`，从建库成功起计算时长，向量化和可能的排序另按调用计费。北京 `text-embedding-v4` 的同步标价为 `¥0.0005/千输入 Token`。由于缺少可核实为获批测试用途的 Workspace 和专用凭据，托管请求、Token 与费用为 `0`。上传、建索引、查询、删除及对应的托管 requestId、文件/索引 ID、上游错误回执均为 `not_run`。[知识库计费](https://help.aliyun.com/zh/model-studio/billing-for-knowledge-base) · [向量模型计价](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)
- 文本请求前核对北京 `qwen3.7-flash` 小输入档原价 `¥0.2/百万输入 Token` 和 `¥0.8/百万输出 Token`。固定两条合成问题，各限一次请求，输出上限 `128` Token，关闭思考和工具，按输入档上限保守估算两次共低于 `¥0.014`。真实返回合计 `1,151` 输入、`22` 输出 Token，按无缓存原价估算 **¥0.0002478**。提供方响应无结算金额，实际账单未核对。[模型计价](https://help.aliyun.com/zh/model-studio/qwen3-7-flash)

## 本地隔离环境

- 原 `127.0.0.1:18089` Embedding 转发和 `127.0.0.1:55432` PG17 转发均未监听。使用从 I7.4.9.4 合成归档校验恢复的 `127.0.0.1:55436/xiaok_migration_restore_i7514_135f702a`，业务角色 `sfp_app`。仅在本轮空分片表的恢复副本中启用从官方 `v0.8.2` 编译的 pgvector，并建 `vector(1024)` 余弦 HNSW 测试索引。128 条迁移账本行数和摘要一致。归档及恢复检查见 [I7.4.9.4](./xiaok-i794-full-migration-restore-acceptance.md)。
- GPU 服务由仓库原 `server.py` 运行在本机回环 `8089`。依赖为 Python 3.12.10、PyTorch `2.7.1+cu128`、transformers `4.51.3` 和 sentence-transformers `3.4.1`，GPU 为 RTX 5070。模型为 `Qwen/Qwen3-Embedding-0.6B` revision `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3`，健康响应报告 `cuda`、`float16`、`1024` 维和归一化。11 个模型文件均按仓库清单校验，权重 SHA-256 为 `0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd`。[固定模型版本](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B/tree/97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3)
- 转发恢复后，原 `18089` 的授权健康检查返回 `200`，模型、revision、profile 和 `1024` 维均相符。原隔离库 `127.0.0.1:55432/i745_f1_accept` 核验为 PG17.10、pgvector `0.8.2`，其非超级 `sfp_app` 用于两个真实文本问答。两条来源通过原 Embedding 服务重新走正式索引和检索。

## 本地运行回执

`run-02` 于 10:56:27–10:56:29 执行业务检查。它通过实际 HTTP 调用本机 Embedding 服务，以正式知识服务、索引 Worker 函数、检索函数和问答执行函数读写合成数据。夹具企业为试点 `2`、对照 `1`。本地 HTTP 成功响应包括 `15` 次向量、`4` 次分块和 `1` 次健康检查，成功向量响应共观察到 `483` 输入 Token。失败或超时的请求无返回用量。对话 `ai_provider_attempts` 共 `0` 条。

| 场景 | 实际结果 |
| --- | --- |
| 文本向量 | 两条文本一次请求返回两条不同的 1024 维向量，两条 L2 范数均约为 `1.000000`，该请求 `70` 输入 Token。 |
| pgvector 和双向租户隔离 | 试点水路 `文档 2 / 版本 2 / 分片 2`、防水 `文档 3 / 版本 3 / 分片 3` 均由正式索引写入。独立 SQL 的 `EXPLAIN` 命中 `i7514_knowledge_chunks_hnsw`，水路余弦相似度 `0.6941`。两租户各自可读 `2` 和 `1` 个分片，跨租户分片数均为 `0`。跨租户文档服务读回及来源解析被拒绝。 |
| 水电施工阶段的水路问题 | “家里现在做水电施工，这一步水路主要做什么？”首位命中 PPT 第 17 页摘录，分片 `2`，相似度 `0.6941`。来源解析返回同一版本、文本与哈希。 |
| 防水问题 | “卫生间接下来做防水，施工和后续检查由谁安排？”首位命中 PPT 第 18 页摘录，分片 `3`，相似度 `0.8223`。来源解析复核对应引文和版本。两题各 `35` 输入 Token。 |
| 无可用资料 | 员工预览范围内无可用知识，run `1` 保存 `insufficient_evidence` 通知，输出消息 `3` 可读回。通知请用户补充问题或联系企业人员确认，未生成企业标准。 |
| 文本模型不可用 | 有真实检索来源时，水路和防水 run `2`、`3` 均保存 `failed / model_unavailable`，输出消息为空，真实文本请求为 `0`。facts-only 对这条知识问答路径实测未触发。 |
| 检索失败、超时和恢复 | 独立空闲回环端口实际拒绝连接，run `4` 持久化 `failed / retrieval_unavailable`，输出和用量均无已知结果。用真实本地服务施加 `1 ms` 客户端时限，客户端抛出 `TimeoutError`。恢复正常时限后，同题 HTTP `200` 并重新命中版本 `2`。 |
| 更新、退役和幂等 | 水路文档 `2` 新版 `4` 发布后命中新版，旧版退出当前检索。重复索引返回原 job，同一版本只写入一组分块和向量尝试。退役重复执行返回相同结果，两个版本均退出当前检索，试点旧引用解析失效，对照的独立水路版本仍可检索。 |

## 真实文本问答回执

`real-text-01` 于 11:05:41–11:06:46 在原隔离库执行，合成企业 `44`。文本凭据只在验收进程内用于既有兼容适配器，使用 `processAnswer` 的模型注入口保留正式检索、分派、用量及引文持久化路径。云端 requestId 单独记录于原始回执。每条试验均为首次请求，HTTP `200`、实际模型 `qwen3.7-flash`、终止原因为 `stop`。

| 工艺来源 | run / 评测 / 引用 | 真实 requestId | 输入 / 输出 Token | 保存并回读的引文 |
| --- | --- | --- | --- | --- |
| PPT 第 17 页水路 | `227 / 1 / 1` | `54fc9f9c-10bd-9d84-8185-c3450e865483` | `574 / 15` | 这个阶段主要在做家里的用水管路。 |
| PPT 第 18 页防水 | `228 / 2 / 2` | `3785b4c8-e5ab-94ae-a7e0-daf9dbec3381` | `577 / 7` | 施工和后续检查，由项目团队安排 |

两条回答均为 `grounded`，结构检查及出处、版本、原文核对通过。每题的本地查询为 `35` 输入 Token。服务保留 `semanticCorrectness=requires_review` 和未对账状态，固定两题的验收范围为已保存原文引用及读回。

## 证据和结束状态

- `run-01` 保留冷启动窗口内未就绪的 `not_run` 记录。`run-02` 扩大冷启动窗口后通过全部 9 项驱动断言，其中模型不可用检查记录的是实际失败终态。前后 708 个输入文件的绑定摘要相同，均为 `4ff1c6d0c27f1182ddec72ff53cbb5784645db609d4ed6457b42a994f4c52731`。
- 原始回执在 `tmp/xiaok-i7514/run-02/result.json` 和 `real-text-01/result.json`。后者的 651 个输入文件前后绑定摘要均为 `6ab7775dcd458561d656b421baf860593931a4187eb6b104cbf6ed44882f6509`。`config-presence.json`、`database-discovery.json`、`restore.json`、`pgvector-setup.json` 记录配置探测和隔离基线。离线契约测试 `focused-tests.log` 为 `14 passed / 0 failed / 0 skipped`。
- 本机两家合成企业、管理员和知识分片已清零，专用恢复副本按其唯一标记删除。原始归档哈希复核一致。原隔离库的合成企业 `44` 复核 32 张助手表残留为零。临时 Embedding 和 PG17 验收进程均已停止，`8089`、`55436` 已关闭，一次性服务凭据已清除。离线复验运行时保留在 `G:/xiaok-i7514-135f702a`，资源回执见 `tmp/xiaok-i7514/runtime-stop.json` 和 `database-cleanup.json`。
- 真实企业业务读写、正式平台配置写入、常驻 Worker 启动、真实通知和生产操作均为 `0`。本次提交范围为验收记录。
