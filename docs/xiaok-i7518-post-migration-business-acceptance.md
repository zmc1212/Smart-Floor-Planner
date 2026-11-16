# I7.5.18 十条正式迁移后的业务兼容与端到端验收

2026-11-16（Asia/Shanghai）。**定向业务兼容通过，完整端到端验收仍为 limited。** 正式迁移后的 129 条开发库账本与隔离副本完全一致。隔离副本的知识、引用、十阶段标准问法、阶段提醒、Construction、四角色事实周报及 Worker 状态读回均通过；后台浏览器完成合成项目和知识草稿重进。本轮没有实云百炼、小程序原生或生产验收；全量 ESLint 仍有基线错误。

## 基线及隔离

- 开始已执行 `git fetch origin`。`origin/codex/xiaok-integration`、本地分支和 GitHub 分支引用均为 `f0ca2b9150409883de6b03bfc8568a433dd09e7b`（远端默认分支为 `main`）。主工作区起始 30 项修改/未跟踪内容，其他工作树也有未提交内容；验收用该提交单独检出，未纳入任何既有改动。
- 已读 [I7.5.17 DBA 正式执行报告](xiaok-i7512-dba-execution-report.md#i7517-开发库正式执行)。在获批的 `127.0.0.1:5432/smart_floor_planner` 以 `sfp_backup`、`default_transaction_read_only=on` 核验。前后实测集群 `7696770731622109222`、PG 17.10、账本 129 条、末条 ID 135、167 张 FORCE RLS 表、正式平台映射 0 行。账本的 ID、时间戳与哈希前后逐项相同；十条正式迁移为 `0120` 及 `0124–0132`。源库排序为 `en_US.utf8`。
- 只读导出迁移后结构归档，TOC 无 `TABLE DATA` 和 `SEQUENCE SET`；只另外复制 129 条迁移元数据。没有复制用户、业务或历史引用，也没有再次执行迁移。独立集群 `7708663762221521736`，仅 `127.0.0.1:55459`，Windows PG 17.10、pgvector 0.8.2、排序 `C`。每个副本均为 189 张表（含账本）、167 张 FORCE RLS 表、222 条策略。使用标记库、合成角色及非超级、非 BYPASSRLS 的 `sfp_app` 执行业务。合成企业 A/B 与公共语料承载企业均非 1454；最终有效三库回查 1454 和活跃队列均为 0。排序差异保留，本轮不验证等价回滚切换。
- 结构归档 SHA-256：`794ec03d9bf233d8f87843a438e83db67f202e13e3082a3ed1bc098e3ee18130`。账本文件 SHA-256（含证据文件换行）：`b667a473d0bb0829da528d4e2c59e3176a7b4bbf346905910b3467efc5d391d2`。

## 证据层级

| 层级 | 状态 | 实际执行 |
| --- | --- | --- |
| 定向单元及客户端合同测试 | passed | 后台 181 项、小程序 JS 39 项，0 失败、0 跳过。 |
| 独立 PG17 合成业务 | passed（有下列限制） | 复用 I7.5.15 的 13 组知识服务场景，补验 4 组 0132 场景、16 组业务场景（均含各自前置项）。真实写库、领取、回读、撤权；百炼传输和两次答案选段使用测试替身。 |
| 本机 Qwen3 与 pgvector | passed | 实际启动锁定修订 `97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3` 的 GPU 服务、校验模型文件，实际写入并查询 1024 维向量。 |
| 真实百炼云 API | not_run | 本轮对百炼云 0 调用、0 新付费用量；本地适配器有 72 次模拟请求。I7.5.15 的 `payg-r01` 是独立的历史实云证据，不能替代这次。现有实云驱动要求单独有时限的 Workspace 与费用/操作授权，本轮未复用已结束的批次。[历史回执与驱动约束](xiaok-i7515-bailian-rag-integration.md#真实-api-和费用) |
| 真实后台 UI | passed（两条路径） | 内置浏览器登录合成企业 A；`/construction-projects` 打开并刷新重开项目 3，读到「当前实际节点：设计」和合成进度注记；`/assistant-knowledge` 保存「I7518 合成验收草稿 · 水路」，刷新后从版本 1 重开，正文与 PPT 摘录一致。`POST /api/assistant/knowledge/documents` 及详情读取成功；数据库为 `draft/pending`、无发布版本。 |
| 真实小程序 UI / 生产验证 | not_run | 正常工作区的受影响客户端文件有未提交修改，未把该 DevTools 窗口当作固定提交验收，未复制小程序项目。物理设备、微信授权、生产数据库和配置均未访问。 |

## 场景和回执

| 场景 | 结果与实测证据 |
| --- | --- |
| 企业知识映射、上传、索引 | 合成企业 A/B/公共语料为 1/2/3，同一模拟 Workspace 的三个不同索引；A 水路与防水共用 A 索引。走正式的文档上传、解析/审核、索引任务和发布服务。保留文件、索引文档、入库请求和任务回执；同请求重复创建及索引去重未产生新上传。 |
| 托管优先、备用与 A/B 隔离 | 托管协议命中 PPT 第 17 页水路/第 18 页防水，企业来源优先、公共来源补充；跨企业会话与定向检索双向拒绝，同企业非授权项目和错误阶段无命中。模拟传输失败、网关失败后用真实 `LOCAL_PGVECTOR` 找回同一获权版本；托管恢复后回到主路径。 |
| 0132 平台映射和发布 | 隔离库中的 `sfp_app` 对映射只有 SELECT；企业上下文 INSERT 被拒为 `42501`。企业管理员发布平台文档被拒；实际平台管理员通过正式服务发布，回读 `published_by`。正式开发映射前后仍为空。 |
| 0132 引用保存、重开和撤权 | 实际会话保存企业引用 1（企业 1、版本 ID 2、版本号 1、P18）和平台引用 2（来源企业 3、版本 ID 4、版本号 1、P17）。在原会话读到逐字摘录；替换企业防水版本和退役公共条目后，两个旧入口均为 `source_unavailable`，原引用行、摘录和源文件仍在。文档版本外键、分片外键分别实际拒绝不一致的关联，SQLSTATE 均为 `23503`；无租户及非归属租户可见 0 条。 |
| 失败和降级 | 双引擎故障返回 `retrieval_unavailable`，未进入选段模型。无依据返回 `insufficient_evidence`；备用 profile 缺失拒绝为 `local_index_incompatible`；托管凭据明确拒绝时不降级；请求中项目阶段变化返回 `context_changed`。换版、退役和 Worker 清理重放未重复写入；没有删除历史引用或 Evidence。 |
| 十阶段、专业问题和 Worker | 十个阶段真实会话均完成 `queued → running → succeeded`，重开读取 `construction.stage_knowledge`。重复提交复用 run ID，不同内容沿同键返回 `idempotency_conflict`；重复领取及异租户领取为空。水电回路、卫生间闭水分别进入电气/防水专业路由，P17/P18 企业资料取用已验，真实专业模型正文未验。 |
| Construction 项目事实 | 合成项目 6 落库为泥木阶段；读取计划版本 1、卫生间、已发布记录 1（贴砖完成、收口待核对）。试点外项目和异租户不进入报告；异租户查看项目和会话均被拒。原施工稿为合成夹具，经正式管理发布和读取。 |
| 阶段提醒 | 试点项目筛出 10 条，业主/设计师/施工人员站内送达 7 条，其中业主从原会话重开成功；经理 3 条明确为 `no_inbox`。重跑不改变提醒记录或所关联的消息 ID，重复投递为 0；返回的 `created` 仍为 10（计入候选而非实际新行），见下方限制。 |
| 四角色周报 | 5 个事实任务实际入队、领取、生成、投递；业主 1、老板 2、设计师 4、施工受众 3 与 5（含项目经理）。设计师人工接管时 `held`，恢复后单独补投。五份均重开原记录 1，读执可重复提交且重开保留；非本人报告拒绝。重复调度和投递为 0。正文状态均为 `facts_only`。 |

两条留存引用的哈希由实存分片和原件重新计算：企业 P18 分片 `59879dcf502a13a75482423d74f313f928a0debba6bd0b2b9ab5e06b9a585eff`、上传摘录 SHA-256 `9c7b8173628e60e34509eb02cef3fb74a80f153916d447805f086d26c4187977`；平台 P17 分片 `bdb8056c3e6164048a40cd079f511e9929944c295b5aa9596b5ea76c44b883af`、上传摘录 SHA-256 `b02d43399e4d596c03dbfcbc7272044cdaa2a39d38fcbcc3119366d9fef1fcd7`。页码来自已核验 PPT 来源字段；上传的是批准摘录，不是整份 PPT。


## 限制、失败和未执行项

| 状态 | 项目 | 实测边界 |
| --- | --- | --- |
| limited | 四角色周报、专业咨询 | 验收覆盖授权事实、站内投递、重开和原记录。未调用付费文本模型；报告 AI 正文、照片理解及专业 Agent 真实文本质量均未验。记录夹具只含文本。 |
| failed / limited | 设计阶段的自然问法变体 | `business-02` 原问「做设计这一阶段要提前核对哪些事项？」；`提前` 命中现有进度意图，隔离库无该路径的模型配置，run 2 失败为 `assistant_disabled`。十阶段定向场景使用另一个已有口径「当前设计阶段需要注意什么？」通过。首次问法保留，不计入通过，不据此判断配置模型后会如何回答。 |
| failed / limited | 阶段提醒的计数与经理收件箱 | `business-04` 发现重放 `created=10`；`business-06` 复核持久化回执完全相同，新增/重投 0，计数字段仍偏高。经理三条为 `no_inbox`；未验证经理成功收到该提醒。 |
| failed（原始驱动尝试） | 导出/断言与夹具 | 首次账本文本分行导致读取器解析失败，保留已完成的无数据归档，改用单行 JSONB 读取；`business-01` 从 DTO 误取内部 `purpose`；`citations-01` 把规范化分片指纹误当字节 SHA；`business-03` 无业务数据的副本缺 `construction_staff` 系统角色行；`business-05` 初始断言误以为只能有 4 份周报，实际发现项目经理同属施工周报受众。原始结果保留，后续调整仅在驱动/夹具。首轮类型检查的 DTO 类型错误也已随驱动修正。 |
| failed（基线） | 全量 Admin ESLint | 退出 1：8 个 `@typescript-eslint/no-require-imports` 错误均在未修改的 `deployment/portfolio-kodo/seed.cjs` 和 `signing.js`；另有 65 条警告。与 [I7.5.16 基线记录](xiaok-i7516-migration-final-review.md) 一致。 |
| not_run | 当前提交的实云、原生与正式运行 | 本轮未调用真实百炼、未核新账单；未运行小程序原生、真机、真实微信授权、生产、迁移后全量恢复或回滚切换，未启动常驻 Worker 或发送外部通知。本轮也未重新执行正式十条 SQL 或启用正式公共映射。 |

后台测试暂时在合成企业 A 的账号配给现有 `assistant-knowledge` 权限；初始无此权限时页面未进入。一次 Windows 命令行中文编码错误未执行该夹具写入，换成已校验的 ASCII 范围条件后写入一行。页面仅保存草稿，无发布或真实云操作。

## 复跑、验证和收尾

- 在独立 PG17 准备**迁移后结构副本**，由只读来源提取账本元数据并比较全部 129 行。`business` 需要一个空副本，`citations` 需要用隔离的 I7.5.15 mock 模式生成并撤权后的两个引用；该模式另需锁定修订的回环 Qwen3。使用新库、新回执路径；保留原回执。
- 在 `admin` 运行 `node --import tsx scripts/xiaok-i7515-bailian-rag-acceptance.ts <新标签>` 复用既有 mock 驱动（见 [I7.5.15 复跑说明](xiaok-i7515-bailian-rag-integration.md#复跑和限制)）。在同一固定源码运行 `node --import tsx scripts/xiaok-i7518-post-migration-acceptance.ts business` 或 `citations`。为新驱动提供 `XIAOK_I7518_DATABASE_URL`、绝对 `XIAOK_I7518_OUTPUT`、不含行末换行的有序 JSONB 账本 SHA-256 `XIAOK_I7518_LEDGER_SHA256`；仅需浏览器复验时设置合成账号口令 `XIAOK_I7518_UI_PASSWORD`。门禁校验本机独立高端口、库名、用途标记、非特权角色、账本、空/安静队列和零 1454，并持有单会话验收锁。
- 完整 `tsc --noEmit --incremental false` 及验收驱动和相关源码 `eslint --max-warnings 0` 退出 0；定向测试 220/220。未修改产品代码、API、角色合同或界面；模块清单只链接验收证据。
- 原始证据保存在本机 `tmp/xiaok-i7518/run-d40af07c/`（Git 不收录）。`source-before.json`、`source-after.json`、`source-ledger.json`、`isolated-setup.json`、`embedding-health.json`、`rag.json`、`citations-final.json`、`business-06.json`、`ui-browser.json`、`admin-ui-server.log` 和 `cleanup-final.json` 分别保留来源、回执和关闭状态。验收前后绑定一致：RAG `8feafd3a316a62ad03d1a177decf4278ec21ff902b91e00d011d0ee94a29b4dd`；0132 `ad9c5854db02d2198f2696ac87de934e7f6a158d12d05a1f0a78be0e3878a4e0`；业务 `6024a598845fed0865dd8097cd46966bf231cf1d71158efbdbd21c246875631a`。保留所有较早尝试独立日志，最终通过不覆盖它们。
- 模拟远端回执示例：A 水路 `file-0-1/request-9`、防水 `file-1-2/request-20`，B `request-28`、公共 `request-36`，新版本 `request-64`、旧防水清理 `request-68`，均不是实云请求 ID。原始结果文件 SHA-256：`rag.json` `d2e2ed2b32bc21e04a7539aa8624cab7ceed3bfeb33585045add0ec03fb03728`；`citations-final.json` `55c9c78742c56c302cb66b45dabf24586f29b51c3658340e8f308d81a5368d78`；`business-06.json` `259530402a6f851fd870d538dd570f4f43d8f2d329c8e35dff8671c47f259ebb`。
- 回读确认合成 PG、Qwen3 和两个临时后台监听均已停止，一次性凭据已移除，隔离数据库留在停机目录，引用与 Evidence 保留。Qwen 停止后的第一次端口检查尚未确认关闭，以本轮最终端口回读为准。未改主库企业 1454 或生产配置，无迁移重跑、真实通知、合并 `main` 或生产部署。按要求交付后停止。
