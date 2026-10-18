# 小客接力：客户更正、有效记忆与原事项接续

2026-10-18，分支`codex/xiaok-public-site-lifecycle`。功能提交`1a485e03`，从前次交接`9db99f40`继续；前次功能`19af1ea7`的团队核对、精确正式版本和客户决定继续复用。本轮已完成限定实现、自动检查及原生闭环，**整体仍为Limited，完整专业语义未通过，不代表整份PPT、生产或发布验收。** 交接随后单独提交，普通推送后以分支远端核对记录为准。

## 当前实际行为与边界

- 明确更正可以紧接专业问题。既有`record_need`兼容原参数，可附最多三条`additionalNeeds`，共四个独立房间/字段；核验全部当前原话、字段及重复项后同事务保存。稳定逐条操作键让恢复不重复记忆、自动草稿或原事项进展；返回实际`savedFacts`，后续检索优先使用本轮保存回执，假设与转述建议不写成客户事实。
- 当前字段带同字段supersedes及原话来源。针对存量desk/other把人数和位置混写的行，后续同房间明确use更正通过只读qualification限定人数，保留原话、桌型/位置、设备、其他房间和审计。当前更正来源不可用时只投影未知标记，不泄露其值、不重新认定旧人数；`query_followups`也复用有效记忆读取，不能从事项适配器绕回失效事实。单一devices复合值的任意增删、自由文本跨字段关系与长期记忆治理仍未完整实现。
- 企业专业知识与同轮实际节点、可用材料、客户当前需求和既有事项一同进入解释。来源按原事项分别提供真实状态、等待方/负责人；来源ID和实现键留在元数据。当前私聊更正、早先主动共享需求、团队关联核对、精确正式版本及其客户决定分别表达；私聊更正不自动共享、换版、同意或落实，不制造第二条事项。
- `xiaok-renovation-v51`与`current-turn-sources-v4`保留完整原文和权限/版本元数据，仅在模型视图共用完全相同来源的正文与别名，修复反馈按原顺序保留一次。检查点、来源重验、四轮、48,000 UTF-8文字字节及有限格式修复边界未放宽。否定句“同意不等于已经落实”不再误判为正向完成承诺；独立的正向越权完成句仍拒绝。
- 综合与普通自由回答在最终提交事务共用真实保存操作守卫。对已记录、已按更正记为/更新为等已知回执形式，须有本轮实际提交的need/preference操作；旧记忆、引文或被拒写入不能充当保存回执。它不保证任意措辞、所声称的每个字段/值或所有推断正确。最终规则离线复放八次v51已持久回答及其真实记忆8/8，并非额外实模或完整语义证明。

沿用原租户/RLS、客户/原咨询/项目房间、参与者、来源修订/撤回、三类管理者继承、outbox/Worker、用量及真人模式边界。无新schema/迁移、API路由/菜单、凭证、权限、Mini结构/样式/素材/文案/导航或正式v4写入。已同步后台/小程序清单双语、二期合同双语和两份还原台账；台账每路由仍只有一个最新批准源。

## 已执行检查与结果

证据根目录`tmp/xiaok-corrections-continuity/`，总览`acceptance-summary.json`。以下按实际运行区分，重复子集不累加：

| 检查 | 本轮结果与范围 |
| --- | --- |
| 最终冻结核心 | 69项：68通过、0失败、1跳过；隔离数据库服务写入、权限/来源/更正/恢复及39项单元，源文件运行期间未变 |
| 最终受影响Agent回归 | 19项：18通过、0失败、1跳过；与核心测试文件不重叠，源文件运行期间未变 |
| 两组去重合计 | 88项：86通过、0失败、2跳过；拒写后虚假回执3项及单元39项已含于核心，不能再次累加 |
| 既有Mini测试 | 92项：92通过、0失败、0跳过；本轮未改Mini运行代码，属于客户端确定性检查，不是实模 |
| v51服务端实模 | 明确合成企业2494，八次实际配置模型回答：基线、更正、接续、撤回后未知各两次；结构/来源检查通过，逐轮审读未全部通过 |
| Stable原生 | 22/22检查通过；合成企业2499，四次实际配置模型回答，原生真实输入/按钮、保存反馈、来源片、原件预览/精确同意、持久重进、来源撤回和成员403 |
| lint / 类型 | 本轮相关25文件零错误零警告；同一源码程序类型诊断287→287，无新增 |
| 完整构建 | 编译完成，随后被既有`AiDesignerLegacyPage`导出类型错误阻断；构建未通过，未改无关旧页来掩盖阻断 |

核心隔离使用批准55432/`xiaok_embedding_eval`、共享锁、非superuser/non-BYPASSRLS角色；开发/原生使用批准5432/`smart_floor_planner`、`http://localhost:3006`、原Worker及配置的DeepSeek。所有本轮企业/客户/项目/知识/照片/正式版本均为明确合成夹具；旧混合行通过生产记忆校验作显式准备，不计为模型自动动作。最终服务端与原生共12次选定实模回答，准备轮、工地草稿、早期失败和中间模型样本另计于审计，不能混为12次总调用。

C01继续使用`design-references/xiaok-p4b-public-sites-v1/README.md`，S04仍为原PPT22/38，PPT23提供材料语境；PPT15/23/37/38对应本轮专业问答与事项场景。Stable2.02.2608080、官方SDK0.13.0、基线库3.17.2，副屏先重新编译再校验SDK/页面；逐图检查精确route/stack，逻辑390×844、PNG348×752。本轮没有新增视觉还原声明。原生报告保留会话/临时传输恢复、原页面返回及断开证据，截图审读见`native-visual-review.json`。

在`admin`复跑：

`node scripts/assistant-continuity-acceptance.mjs`、`--agent-regression`、`--mini`；`--claims`与`--unit`仅用于对应子集。开发实模`node --import tsx scripts/assistant-continuity-development.ts --development`，Stable原生加`--native`，二者串行；审计`node --import tsx scripts/assistant-continuity-audit.ts --development`；同源类型`node scripts/assistant-continuity-typecheck.mjs 9db99f40`。沿用现有环境，不配置新凭证。

## 保留的失败、账务与工作区事实

- 原始夹具路由/字段装配及类型错误、假设保存反例最初未进入工具路由、早期实模的轮次/预算/编号/否定句拒绝均保留。修正后才记最终结果；`live.initial-*.json`、`claims.initial-tool-eligibility.log`、`service.initial-fixture-and-types.log`及类型对照可复核。否定句首次缺失独立stdout的索引文件明确为派生记录，不冒充恢复的原日志。
- 连接中断时旧核心仅跑出部分记录，没有最终退出结果，见`service.interrupted-connection.log`和`interrupted-execution.json`。只取消/清理精确匹配的自建隔离运行3911、两企业3429/3430及其夹具，重新冻结执行，不把中断或旧通过数算进最终。复用已批准SSH、两数据库/embedding转发、本地服务/Worker和唯一Stable实例，未修改远程容器、生产或凭证。
- 原生首轮窗口不存在，在SDK/客户端动作前失败；恢复唯一已安装Stable项目后，新增共享资料使旧事项快照失效，直接核对被拒。下一轮明确重新核对成功，但待处理状态没有新回复，未投影成客户核对结果而超时。之后精确核对/回传通过，预览及原图200，但脚本错误等待不存在的fullPreview属性；已改用上一阶段验证的full/planExpanded/原图路径条件。最终通过同一事项重新核对、新设计师回复、精确图纸核对、经理明确回传及完整预览完成；没有绕过版本或人工回复边界。四份失败报告/日志在`native-initial-*`保留，失败夹具已关闭AI、禁用合成员工且无活跃任务。
- 中间v50八次回答及`semantic-review.v50.json`保留，不作为最终完整语义验收。较早广泛回归85项：84通过、0失败、1跳过，期间有四个生产文件变化，只作中间证据；最终受影响Agent文件以上述冻结回归为准，不能把广泛回归说成最终整批已通过。
- 最终审计覆盖15个本轮合成企业，全部AI关闭、合成员工禁用、活跃run/job为0，落实/解决/关闭事件为0。run状态{"failed":4,"succeeded":50,"indeterminate":2}，attempt状态{"succeeded":104,"unknown":2}；历史unknown/indeterminate保留、不盲重试、不清零。费用仍为null/未知，reservation按实际状态保留，查询/文字用量不含全部索引工作，未声称生产成本或百分位已验证。明细`development-audit.json`。
- 初始97项脏/未跟踪范围中，扣除本轮唯一清单段落后95项原字节或删除状态保留；两份用户知识计划在执行中发生并行更新，已额外备份并保持其最新字节，未编辑、暂存、回滚或提交。原五项删除仍保留。两次工作区检查点、选择性暂存清单与`preservation-final.json`记录边界，不能声称97项全部仍与初始字节相同。

## 已知未解决项与下一步

本轮v51真实输出仍有具体缺陷，见`semantic-review.json`，不能隐藏为全部通过：501把当前查询缺少可量测依据说得像现场确实没有依据；505在已保存单人更正后仍说“我不替你改需求”；506又要求补充已保存的人数确认；503/505/508重复“最小待核实项”，507暴露“混合行”术语。508的“常用一人、偶尔两人”为条件建议，未断言当前人数，但仍应更清楚地限定假设。原生522仍出现“最小待核实项”，524仍出现“混合行”并把查询缺项推广为“人数、桌长和插座位置都还不能定”，见`native-visual-review.json`。

当前更正原话继续继承原消息及该run的工地来源依赖；共享图撤回后该链失效，当前use按未知投影、原更正记录保留。这不是客户明确撤回人数更正的决定，当前没有新增需求撤回入口；不能把保守来源过滤说成客户改变意向。

图内识读仍未验，本轮投影未发送图像像素；实物尺寸、真实微信授权、真机/BLE、完整宿主光学、高屏/键盘和Chrome未验，不转为要求用户截图或手工测试的开发门槛。完整构建的旧导出错误仍为明确限制，当前没有生产部署或发布批准。

下一步沿P3B/P4A处理已观察到的事实范围、更正与正式事实的措辞分离、重复追问和事项接续，按原PPT核心场景继续实模/原生回归，不另建事实库或版本系统。无需等待人工A10/截图/确认。知识计划是同一业务主线的支撑：KB-1～KB-4已有各自限定闭环，不能重做；可另支撑其余批量同题回归/进度/取消恢复，但先冻结任务载荷、source版本/撤回和usage口径，并用独立工作区。`worker`、`synthesis`、`bound-context`、`retrieval-sources`、队列/schema及双语合同/清单交由一个集成写入者；本轮只读分析该分工，未启动第二条代码线，也未修改用户知识计划/路线图。

## 稳定基线后的第二知识任务

用户决定为本轮稳定提交并普通推送后，由父任务启动第二对话；本轮没有自行创建第二条写入线。只读对照明细`tmp/xiaok-corrections-continuity/parallel-development-readonly.json`。

- 业务线：继续P3B/P4A上述已观察专业语义缺陷，拥有当前Agent提示词/综合解释、记忆/材料投影与原事项接续，按PPT15/23/37/38及C01保存/重进/失效场景验收。
- 知识线最优先未完成项：KB-4既有同题逐项回归之上的批量执行、逐项进度、受控并发、取消及原键恢复，保留修订失效和unknown用量。复用已有case/gap/start/resume/history/read/review/health；DOCX/文字PDF、专业元数据和混合检索已经有各自限定实现，不重做；OCR、复杂表格、旧格式、影子profile与大容量留在知识计划后续范围。
- 知识线允许主改`admin/src/lib/assistant/knowledge/operations.ts`、相邻新批量协调模块及对应测试、既有知识运营API/获批Ant Design运营页的该流程；复用原C01引用/重进验证受影响专业场景。不另建Agent、任务权威、客户事实库或自动施工事项。
- 禁止两线同时修改公共`agent/worker.ts`、`agent/synthesis.ts`、`agent/bound-context.ts`、检索来源重验、`infrastructure/job-queue`、schema/迁移/RLS/权限及双语合同/清单。建议父任务指定唯一集成人；当前业务线维护Agent整合，知识线提交确切公共变更需求，由集成人合入。迁移编号、DDL/RLS/授权、执行与回读验收统一归集成人，两个会话不各自建迁移或并行改共享库，不涉及生产。
- 先冻结batch/item及case修订/hash、知识profile/source epoch、Agent prompt/model版本、每项runID与幂等/恢复键、取消/租约/撤权/来源撤回语义、完成/失败/indeterminate状态，以及usage/reservation/未知费用口径。两线各用独立分支/工作区和明确合成前缀，集成后只重复受影响回归。
- 数据库验收统一复用`admin/scripts/assistant-acceptance-safety.mjs`的`lockAssistantAcceptance`：批准55432隔离库、非superuser/non-BYPASSRLS、空闲队列预检，整套进程持有`pg_try_advisory_lock(hashtext('assistant_isolated_acceptance'))`。另一套持锁时排队，不绕锁、不清理对方夹具；共享schema变更亦由集成人串行安排并确认无并行验收，清理只匹配各自fixture IDs/前缀。

两份知识计划仍是主工作区未提交用户文件，不在本轮提交中。新工作区先只读`G:/workspace/向总/Smart-Floor-Planner/docs/xiaok-enterprise-knowledge-plan.zh-CN.md`及英文镜像；主路线图只读`G:/workspace/向总/Smart-Floor-Planner/docs/xiaok-assistant-roadmap.zh-CN.md`。本轮已将计划原字节另存`tmp/xiaok-corrections-continuity/knowledge-plan-handoff/`，清单`manifest.json`绑定功能提交`1a485e03`、原路径和SHA256（中文`498b36b66299fe188cd429d7823e1dc97075c19bf81da06fffe2a6bf2d50d968`，英文`e4a4d65d063069a7eea38d2228c553ed0ddfff60cee775dbd538442bed457235`）。后续对话可直接读取清单中的绝对副本路径；父任务正式启动知识开发后，若目标工作区缺少计划，只复制这两个明确文件并核验hash，再按用户授权编辑，保留主工作区原文及其他脏改动。
