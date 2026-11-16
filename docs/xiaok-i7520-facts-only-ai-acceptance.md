# I7.5.20 小 K 正式知识问答降级验收

基线为 `origin/codex/xiaok-integration` 的 I7.5.19 提交 `a5e64cbf534413b9ccf15f8bd4dc041814047b95`。验收从 C01 会话发送、领取任务、保存消息和引用，到重开会话读取引用。百炼 RAG 与文本模型通过故障注入覆盖协议及分支，本地 Qwen3 Embedding 和 pgvector 实际执行。

| 字段 | 状态 | 已验证范围 |
| --- | --- | --- |
| `retrieval_status` | `limited` | 隔离库覆盖八种组合。真实百炼 RAG 调用为 `not_run`。 |
| `facts_only_status` | `passed` | 文本模型未配置、超时和 HTTP 503 后使用本次获权原文，依据不足保存 `insufficient_evidence`。覆盖正式摘录路径及两种后台 Agent 执行路径。 |
| `real_model_status` | `not_run` | 本轮缺少独立合成企业的实云费用审批。真实百炼 RAG、文本恢复和账单核验均未运行。 |
| `citation_status` | `passed` | 标题、PPT 来源和页码、发布版本、逐字摘录、原文及版本内容哈希均可核对。重开时按当前权限及阶段取证。 |
| `fallback_status` | `passed` | 连接失败和 429 自动使用实际本地检索。凭据拒绝或索引不兼容时闭合失败，两端不可用保留各自故障回执。 |
| `idempotency_status` | `passed` | 同请求键返回同一任务，单一消息及引用事务，账本和调用次数保持一致。新请求可以恢复模型回答。 |

## 检索及模型故障

| 组合 | 隔离结果 |
| --- | --- |
| 百炼 RAG 正常，文本正常 | `passed`。协议替身选择授权摘录，原会话保存普通带引用答复。 |
| 百炼 RAG 正常，文本失败 | `passed`。文本未配置、超时和 503 分别保留原因。获权短摘录保存为 `facts_only`。 |
| 百炼 RAG 连接失败，本地正常 | `passed`。保留 `transport_error`，实际 Qwen Embedding 查询后从 pgvector 取得获权防水原文。 |
| 百炼 RAG 限流，本地正常 | `passed`。保留 429 的 `Throttling.RateQuota`，实际本地检索成功，随后文本 503 时仍可引用。 |
| 百炼凭据被拒绝 | `passed`。`AccessDenied` 使任务报告 `retrieval_unavailable`，本地 Embedding 次数为零。 |
| 本地备用索引不兼容 | `passed`。主服务 503 后，缺少匹配本地索引标记的发布版本触发 `local_index_incompatible`，未发出向量调用。 |
| 两个引擎同时失败 | `passed`。主服务连接失败，备用 Embedding 503，任务失败并记录主故障及备用 `retrieval_unavailable`，模型调用与输出消息均为零。 |
| 两个引擎正常，缺少相关资料 | `passed`。主服务空结果直接保存 `insufficient_evidence`。单独切到真实本地模式，新风滤芯问题命中弱相关水路候选。正常文本协议替身与文本 503 降级均返回 `insufficient_evidence`，引用为空。 |

## 水电和防水业务

- 普通业主从签名 C01 入口询问家中用水管路。PPT 第17页获权原文随模型未配置的降级回答保存，重开可取。
- 企业问法走正式知识路径。卫生间防水和后续检查由谁安排，以 PPT 第18页的项目对客资料为依据。平台公共资料有独立标注，只有平台资料时企业问法得到 `insufficient_evidence`。
- PPT 第17/18页的来源权威为 `reference`。验收覆盖用途和施工安排。施工参数、材料标准、验收数值与工程结论由实际审核来源和现场核实决定。完整短摘录按原文展示，信息缺项提示人工核对。
- 撤下第18页后，同一对话中的原引用与答复原文不可读，追问重新检索。项目访问权限被关闭或阶段在模型调用中变更时，提交拒绝复用旧证据，保留文本超时及 `context_changed` 回执。转到涂饰阶段后，原咨询追问防水安排得到 `insufficient_evidence`。其他合成租户无法打开项目引用。
- 超时的模型调用保持 `unknown`，额度保持 `reconciling`。成功的降级消息让同一会话能用新请求进入正常模型路径。重复提交同键、重复领取及恢复后的新请求均核对原运行、调用和用量记录。已失败的任务在恢复后仍不能再次领取。
- 按当前提问核对正文相关性，每答最多三段完整短摘录，每段最多400字符。旧会话文本、仅标题相关或冲突规则不能作为降级依据。FastGPT 外部执行路径和长文降级覆盖为 `not_run`。

## 工程验证与边界

- 隔离 PostgreSQL 17.10、pgvector 0.8.2 使用 I7.5.18 归档纯结构和 129 条迁移账本恢复。测试使用三个合成企业、应用角色 `sfp_app`，并验证普通应用角色无平台语料映射写权限。专用所有者连接仅在隔离库登记合成平台语料。
- 实际索引和检索使用 Qwen/Qwen3-Embedding-0.6B、1024 维和已核验的 11 个模型文件。校验本地原始 PPT 文件 SHA-256 `9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4` 后，沿知识服务审核、索引和发布水电/防水摘录。
- 定向 Admin 97/97，小程序原 C01 消息处理与 Markdown 74/74。完整 Admin TypeScript 使用提交版 `tsconfig.json` 的临时副本，修改文件 ESLint 15/15。小程序使用 I7.5.19 的已提交源码，原生 Stable 和真机为 `not_run`。
- 企业 1454、正式平台模型配置、数据库迁移、常驻生产 Worker、真实通知、`main` 合并和生产部署均为 `not_run`。隔离库及 Embedding 进程在验收后关闭。

## 证据和复现

- 驱动位于 `admin/scripts/xiaok-i7520-facts-only-acceptance.ts`。在空的、带 I7.5.20 标记的已恢复 PG17 库和独占本机 Embedding 上，从 `admin` 执行 `node --import tsx scripts/xiaok-i7520-facts-only-acceptance.ts`。驱动要求同一 loopback 库的 `XIAOK_I7520_DATABASE_URL`、`XIAOK_I7520_OWNER_URL`、账本 SHA-256、独占绝对输出路径及合成 JWT。托管 API 与文本 HTTP 由进程内替身处理。
- 最终 `tmp/xiaok-i7520/r09/business.json` 为 19/19 `passed`。源码、夹具和环境绑定在执行前后均为 `13b8c354b09d79612d9645a6a72b073ad8e8cfb1263c3452b1e33b12d214b52c`。回执 SHA-256 为 `51526a81c61247848697a7458b3b7bee9b7353e87c16aed1ab54664cd8b27c8e`。49 次托管协议操作、16 次文本协议调用和 8 次本地 Embedding 入口命中包含故障注入，实际外网调用为零。`cleanup.json` 确认两个本机端口均已关闭。
- 早期 `failed` 批次保存在 `tmp/xiaok-i7520/`。`r01` 的文本测试根路径重复了版本前缀，`r02` 的未知费用断言应核验空 JSON 对象。`r03` 复现已交付降级后新请求阻塞，随后依据持久化的回答回执修复。`r04` 已验证该修复，独立检索场景随后遇到既有的普通回答用量核对门槛。`r05` 的双故障断言调整为备用服务实际错误码。`r06` 保留真实本地的弱相关候选，后续改由最终回答验证是否有依据。`r08` 记录旧执行器夹具误用工具名，复验根据请求实际提供的能力调用。
