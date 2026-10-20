# 小K第二期：需求整理与人工交接

## Agent与知识库的开发边界

**当前分工合同；代码物理解耦尚未完成。** 用户已授权本对话统一负责两个专项的持续实施、共享接口、集成和验收；Agent与知识划分保留为领域边界，不再分配给两个并行聊天。按用户确认的方向保留同一产品、仓库、主线、数据库与既有权限/任务基础。现有`KnowledgeRetriever`、`Evidence`、`conversationKnowledgeRetriever`及知识来源重验是接口基础，不另起一套Agent、知识事实库或任务系统。按实际依赖完成业务批次后继续，不新增逐批确认；设计与生产部署仍守原授权。

| 责任面 | 唯一开发归属 | 接入边界 |
| --- | --- | --- |
| 意图、对话/需求记忆、工具循环、模型协议/预算、回复、接管和恢复 | Agent领域，由本对话实施 | `admin/src/lib/assistant/agent/*`及对应客服链路；知识任务发现此类问题时保留固定问题、原始Evidence与结果，按Agent领域修复 |
| 上传、解析、分块、索引、排序/检索、知识版本/发布/epoch/受众、原件及页/段/表格定位 | 知识领域，由本对话实施 | `knowledge/*`中的纯知识服务、文件/专业合同、知识schema/路由及后台知识UI；Agent通过既有接口消费，不在生成层修补解析/检索算法或知识发布数据 |
| 多来源综合、实时项目/客户原话的组合、模型可见目录、citationId选择及最终引用/数字/承诺校验 | Agent专项 | H/B/K引用在Agent侧统一；知识侧提供完整获权原文、精确身份/版本/hash、定位、适用性与缺项，不生成客户最终答复或改Agent prompt来补检索缺陷 |
| 知识运营问题集、检索诊断与证据回归 | 知识专项 | 可保存并展示现有Agent联调结果，按失败归属转交；不在知识批次里直接改模型上下文、记忆或回复校验 |
| 接口、鉴权、任务/用量/保留期基础 | 沿既有共享合同，由接口集成负责人一次接入 | 保留租户/参与者、来源撤回、原键/租约和未知费用权威；一方所需字段变化先登记，再由明确负责人改公共合同与适配，不由双方同时编辑公共文件 |
| 端到端兼容 | Agent侧维护薄集成入口，知识侧提供稳定证据夹具及Provider检查 | 各自先验本域；接口/语义/权限变化再联测受影响路径。用户阶段仍须真实小程序/HTTP/Worker/重进与权限证据，分层通过不升级整阶段 |

调用方向是`Agent → 知识工具适配器 → KnowledgeRetriever → Evidence → Agent综合回复`。请求身份/企业/会话范围、epoch、条件及预算由服务器约束，知识侧继续在服务端校验，不能信任模型传入身份或把未查到当作没有发生。完整原文/条件/否定不因降低模型输入而被篡改。知识返回没有可用证据、存在冲突或来源失效时明确返回对应状态；Agent决定本轮解释、最小澄清或既有失败反馈，不自行补造企业规则。

当前遗留交叉包括`knowledge/sources.ts`同时处理知识、消息/媒体及工地来源，`knowledge/applicability-context.ts`读取项目阶段，`knowledge/batches.ts`直接读取Agent版本，以及历史/摘记复用知识侧词法工具。后续按实际触达逐步提取纯知识Provider与Agent/业务适配，保留原导出兼容并验证租户/来源/重进；过渡期混合来源/项目适配由Agent负责人写入，知识批次由知识负责人写入，通过固定元数据接口读取Agent版本。通用纯函数收敛为稳定共享接口，Agent历史定位与知识术语扩展分别归域；语义变化也须声明兼容范围。当前记录不宣称已经消除全部跨模块import，不以全量搬移作为本期PPT推进前置。

失败归属：原文解析/条件/版本/召回不对归知识库；正确Evidence已返回却未用、答错、引错、丢上下文、错误操作或反复调用工具归Agent；来源撤回则知识侧撤销证据、Agent侧停止派生使用并验证兼容。两域使用独立夹具/输出，隔离库仍沿既有互斥锁与空闲队列；不增加接口服务部署或生产授权。

## 当前v89：会话绑定身份的只读工具上下文

**AG-05/09内部技术子阶段Implemented，整体Limited。** 新运行的`conversation-read-v1`从获权咨询`entry_snapshot`取得房屋身份。绑定咨询向模型提供的`query_materials`仅要求`room`、`query_business`仅要求`domain`；模型携带的任何`leadId`（数字、字符串、空串或本人ID）均按额外字段拒绝，不丢弃或转换后执行。服务端在原工具适配器内注入绑定字符串ID，再走原严格应用解析器与租户/本人/参与者/来源校验；未绑定咨询继续使用原严格`leadId`合同，房间歧义和多项目规则保持。

模型派发记录和原应用checkpoint的`input_summary.readContext`保存协议及绑定；模型派发后、预检/工具、来源校验、检查点与交付沿原`scoped`重复核对当前绑定。已派发但尚无checkpoint的恢复从原`agent_model`标记恢复相同格式；旧运行没有标记时保留原模型参数/缓存响应，不把旧数字ID自动转型。绑定变化或未知标记按`context_changed`停止；原同run读取复用、一次参数纠正、四轮、唯一最终修复和16000预算不变。知识`KnowledgeRetriever`/`Evidence`、原文/条件/版本/epoch/受众/撤回及公开API、schema、角色和批准UI保持。

采用决定：对照[LangChain ToolRuntime注入测试](https://github.com/langchain-ai/langchain/blob/master/libs/langchain_v1/tests/unit_tests/agents/test_injected_runtime_create_agent.py)和[OpenAI Agents本地上下文](https://openai.github.io/openai-agents-js/guides/context/)的运行身份注入/模型参数分离方式，在现有应用ports与Postgres恢复基础内实施。现有[无效工具参数序列化问题11490](https://github.com/langchain-ai/langchainjs/pull/11490)主要涉及流式适配；本次应用侧绑定不是某供应商的自动转型或重试补丁，不迁移框架，不另建权限、记忆、知识或判官链路。v87/v88原数字ID实模失败及历史unknown证据保持。

最终证据在`tmp/xiaok-bound-read-v89/manifest.json`：235单元/12定向隔离服务/73 Mini及涉及文件/全仓lint通过，类型本批0/全仓292；172项源码/测试、94项供应商/环境及711项Mini文件无漂移。早期完整窗口57通过/1失败/7跳过遇到配置层源码漂移，且新增组合测试误将项目来源计入公开知识引用列表；原结果在attempt-1保留排除。用例改为分别验证原综合来源合同内的K/B逐字依据和公开知识引用，新旧恢复、绑定漂移、真实需求/业务/知识组合、租户及撤回均在最终12项通过。attempt-2的235单元有两项配置文件漂移，attempt-3早于最终用例hash，也独立排除；不合并这些窗口的统计。新GLM企业3883/咨询5982/run6212仅一次真实请求，attempt1807为failed/accepted=false/HTTP_429，应用run/job仍按原合同保留indeterminate，未读取资料、未产首稿/交付，第二题未执行；不重放、不改旧费用结论，不是专业语义失败率或模型比较。隔离运行配置与两份供应商投影精确恢复。原自动清理错误使用inactive账号状态导致事务回滚，该错误仍保留在live.json；独立cleanup-restoration.json绑定原报告hash并按实际active/disabled CHECK禁用唯一合成管理员，确认AI关闭、资料retired、active0/unknown1、原job不变，不新增模型调用。原16项attempt、四份员工发布及2567内部原件均未变，v85/v87/v88报告不刷新。无新原生/完整构建/全仓类型/生产通过，批准C01及Mini结构/样式/素材/固定文案/API/导航保持。

本窗口内用户明确把后续测试模型改为后台当前的智谱官方`zhipu / glm-4.7-flash`。自然实模启动前只读核对主开发配置，再将该配置临时投影到隔离库；测试子进程显式覆盖旧Qwen测试模型值，并移除只适用原供应商的关闭思考覆盖，使用当前供应商默认设置，保留16000/2048及原调用预算。不改主开发凭据、企业能力记录或部署配置；实际remote_model、首稿、调用用量和恢复凭证分别落盘，旧Qwen报告不重评、不混作模型比较。配置层另一任务的源码变化使此前完整回归窗口失效；保留原结果后在稳定集成上重跑受影响的兼容/租户/撤回检查。

## 历史v88：可信字段诊断

**AG-05/09内部技术子阶段Implemented，整体Limited。** v87受控模型收到整份schema后仍重复数字ID，v88沿原read-input恢复增加只来自已注册工具schema的issues：可信字段path、错误类型、expected及received类型，不复述参数值或未知字段名；应用解析器仍唯一判定有效性，超出schema的业务拒绝只给application_contract，不猜ID/房间。`read-input-v2`显式说明JSON字符串需双引号，旧v1 checkpoint错误身份兼容。仍一次参数纠正/原四轮/唯一最终修复/16000预算，不转换ID、不新增来源或工具，既有租户/来源撤回与KnowledgeRetriever/Evidence保持。新配置窗口先保存受限ACL下的原始加密配置及投影，再精确恢复，避免沿保存接口重加密漂移；原v87报告及模型失败保持。

稳定源码232/232单元、8/8定向隔离服务、73/73 Mini及全仓lint通过；类型本批0/全仓292，79项source/test和92项provider/环境文件无漂移。新增字段诊断反例先在旧实现失败；参数错误值/恶意字段名不进入反馈，缺字段/类型/枚举/长度和JSON错误均有固定验证。真实知识创建/发布/检索、参数纠正后单次读取、原文引用/重进/撤回、修复撤权和跨客户/租户拒绝通过。只计本次8服务，不继承v87的55服务数。首次服务准备中18089隧道不监听，索引7892保守unknown导致8条hook失败、业务断言未执行；原记录保留attempt-1，现有测试清理其专属夹具，原任务未重放。按既有Embedding脚本恢复转发后使用新夹具通过，无端点/SSH配置更改。

新独立隔离企业3874/咨询5893先固定Provider真实保存厨房保留冰箱，再以明确注入的数字ID故障开启run6116；当前Qwen3.5-4B只有一次真实调用6069输入/42输出，仍返回数字6722，被第二次错误终止。受控纠正/读取/交付0，active/unknown0，不算自然首稿或专业问答验收。原始加密配置快照受限ACL，运行配置与两份供应商投影精确恢复。原v87 live.json hash不变，v85的16项attempt/原job、四份员工发布及2567原件保持，1073 unknown不重试、不推定已核费用。证据tmp/xiaok-input-diagnostics-v88/manifest.json与live.json；本批稳定窗口已结束。公开API/schema/角色/KnowledgeRetriever/Evidence与C01/C02/C05/U01/S04批准UI不变，无新原生/真机/build/生产或全仓类型通过。下一项先核对由服务端注入会话已绑定身份、减少模型重复生成ID，不能自动转型错误ID或放宽租户/项目验证；话题选择、显式修复编辑及完整条件仍待接续。

## 历史v87：执行前的只读参数恢复

**AG-05/09内部技术子阶段Implemented，整体Limited。** v85 run1072的数字leadId反例继续保留。新增`read-input-v1`仅在query_materials、query_business和recall_history执行前复用现有严格解析器；JSON/字段/ID/房间/历史长度错误返回带原工具schema的配对tool错误，不自动转型、补ID或执行查询，不新增成功读回执。一个run最多接收一次此类错误反馈，`argumentFailures`沿原私有checkpoint持久化，恢复不重置；仍用原四轮模型预算和原一次最终格式修复，最后一轮只收尾。写操作、执行后的任何错误、越权/撤权/未知供应商结果不进入该恢复。

非法查询不再被视为已取得来源，可沿原general组件最小澄清；同轮已有真实来源时仍收窄最终kind，不能借参数错误绕过来源校验。服务端原有参数、租户、本人项目、来源版本/撤回、原键/租约/用量检查继续执行。Agent消费知识Evidence的接口、解析/检索/发布、公开API/schema和批准UI均未改；无新增视觉设计，沿原C01/C02聊天与状态组件，本批不新增原生/真机/生产通过。

参考并采用[LangChain工具错误反馈](https://docs.langchain.com/oss/javascript/langchain/tools#error-handling)、[结构校验错误](https://docs.langchain.com/oss/javascript/langchain/structured-output#schema-validation-error)与[LangGraph工具/消息测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)中的配对错误消息及有界继续模式，未安装/迁移框架或运行上游套件。当前直接使用已固定LangGraph StateGraph和应用PostgreSQL恢复；因此复用应用解析器的纯执行前端口，不照搬会捕获执行后异常、重试副作用的宽泛中间件。此能力是供应商无关的输入校验；Qwen4B的可信system投影仍仅限既有已验证型号，1073未知结果不重放。配置实模执行与失败范围如下，不由上游示例推定通过。

稳定源码通过231/231单元、55/55隔离服务（另7可选实模未启用）、73/73 Mini及全仓lint；类型本批0/全仓292。79项source/test与92项provider/环境文件hash一致。服务真实创建/发布/检索知识并保存引用，参数纠正后只读一次、重进可见、撤回失效；连续错参不执行，纠正为其他客户/租户ID仍拒绝。纯离线预检识别1072原调用，原报告hash/评分不改。此验收窗口已结束。

独立配置实模使用隔离企业3869/咨询5879：固定Provider先真实保存一条“厨房保留冰箱”需求，随后新run6104由明确标记的数字ID故障checkpoint起步，不算模型自然首稿。当前硅基流动Qwen3.5-4B仅一次真实调用，输入6017/输出42，收到反馈仍重复数字leadId，被第二次错误终止；查询/交付0，active/unknown均0，模型纠正未通过。旧1073不重放，旧16项attempt/原job状态、四份员工发布和2567内部原件前后相同。配置脚本最初重新保存导致临时profile/密文hash漂移，原失败报告保留；在原互斥锁内用既有隔离备份候选重建且完整哈希精确匹配后，仅恢复LLM配置，不回滚整库。中途5432/55432隧道中断，按既有remote-dev/tunnel.ps1恢复，端点/SSH配置未改；无新模型请求。原始报告、恢复证明、锁等待失败与manifest独立保存在tmp/xiaok-tool-input-v87/。下一批具体字段诊断、话题/修复编辑及完整条件仍待接续，历史业务评分不升级；原生/真机/完整build/全仓类型/生产仍未通过或未验。

## 历史v86：引用文件名与工程量分离

**AG-08内部技术子阶段Implemented，整体Limited。**

原v85诊断把获权文件`03 金螳螂家施工工艺手册2.0.pdf`中的03/2.0列为无据数字：旧版号别名替换将扩展名当量数后缀，数字前缀也不属于别名。v86仅在工程量分析视图中识别本段已引用知识的可信title/file.name内、成对引号包围且逐字一致的`.pdf/.docx/.xlsx`完整文件名，支持书名号、中文/ASCII引号及字面标点，不规范化/剪裁原文。文件名外的数值/单位、未引用来源、项目名称、未知/部分/改写文件名、版本小数拆分及正式完成声明继续走原校验；不改变引用目录、存储正文、来源重验、工具协议或模型预算。

真实反例先在旧实现中断言失败，记录见`tmp/xiaok-filename-v86/red.log`。稳定源码最终221/221单元、4/4定向隔离服务、73/73 Mini与全仓lint通过，类型本批0/全仓292；77项source/test、92项provider/环境文件hash一致。原服务用例真实创建/索引/发布、按完整文件名首稿交付并保留原正文/逐字引用，重进可读，资料撤回后引用/旧回答不可用；跨客户/租户及修复撤回路径也通过。公开API/schema/角色与批准的C01/C02/C05/U01/S04 UI不变，不新增视觉/原生通过。

以v85原始报告hash绑定的三份未改首稿/完整历史来源做纯离线校验：1067/1070不再因文件名被拒，1071仍因真实无据数字失败。这里只验证解析器，不重新评分或交付已退役来源；两份防水首稿漏事先联系楼下等语义缺项仍存在，原v85交付0/5、完整条件0/3、余3题/9项未执行不改。本批新实模聊天调用0，未重放1073；只读重审确认16项provider attempt与原job ID/状态一致、unknown1保留，四份员工发布数据及原2567内部资料不变，两企业AI关闭/资料retired且无活动run/job。未切模型/配置，不核清未知费用。证据`tmp/xiaok-filename-v86/manifest.json`；后续先处理实际话题/工具参数与修复编辑、完整条件覆盖，再以新原键/新夹具运行实模，旧unknown保留，原生/宿主/高屏/键盘/真机/微信/BLE/build/全仓类型/生产仍未验或未通过。

## 历史v85：模型投影末尾的绑定修复任务

**AG-05/08/09内部技术子阶段Implemented，整体Limited。** `xiaok-renovation-v85` / `bound-repair-tail-v1`仅修改hash绑定的目录引用修复在模型视图中的末尾提醒。被拒绝的首稿、完整反馈、客户原问题、获权来源原文/目录及工具配对保持；固定应用任务明确要求纠正文稿，不再重复原问题。提醒不插入用户/工具值、不授新权限、不创建客户消息或run；普通回答、不可信控制副本及旧式修复保留原末尾。编辑解析器、全部校验、四次调用/一次修复及16000/48000预算不变。实际Worker步骤仅在应用时记录`current-turn-sources-v8`与修复投影版本。

对八份未修改v84 checkpoint的离线投影确认：Qwen3.5适配将可信控制移到首部后，八次旧修复仍以原问题收尾；新投影保持绑定任务最后、完整反馈仍在。这是可复现的输入问题，不证明它导致所有业务失败。沿用[维护中的LangChain结构化输出指南](https://docs.langchain.com/oss/javascript/langchain/structured-output)中将具体验证反馈作为下一次模型任务的原则；本次定点修改保留现有权限、持久任务、未知费用及引用边界，不迁移框架或新增循环。

技术收口：217/217单元、4/4定向隔离服务、73/73 Mini及全仓lint通过，类型本批0/全仓292，最终80项source/test hash一致。定向服务首轮3/4，一个旧有界编辑用例单独运行时缺少前序用例配置的施工阶段；现已通过原服务创建本用例的标记阶段夹具，首次失败独立保留，稳定源码重新通过全部受影响检查。

窗口`2026-10-20T05:49:19.880Z–05:57:25.931Z`使用新企业2624(A)/2623(B)，各74原段/10向量批、两份员工编辑/发布观察，四个现场job取消且现场provider调用0。实际执行A1067/1071/1073、B1070/1072，计划8题中仅5题执行，交付/自动首稿0/5；三份可审读synthesis首稿完整条件覆盖0/3。三次修复均实际应用bound-repair-tail-v1/current-turn-sources-v8，却仍复制原文并重复add已有引用。两份防水首稿保留主要量数及检查/漏水处理，但漏事先联系楼下；厨房首稿将未量测屏蔽说成不完整、比较/数字建议未选本段引用，并写入无据记录199/版本3。文件名中的03/2.0误判已纯函数复现，不冒充工程量错误，下一批定点修复。完整原文、逐题审读与原修复见`review-view.json`/`semantic-review.json`。

1072未产首稿：模型先在厨房问题查防水检索词，再用数字leadId调用query_materials，被原字符串ID合同拒绝为invalid_message，不转型ID；1073第三次模型调用HTTP_503，attempt为failed/accepted=false，运行仍以provider_outcome_unknown/indeterminate保留，未重放、不推定无费用。16次模型attempt中15次已知成功、1次503；请求预算峰值15271/16000，无输入超限。已知输入109581/输出2576，查询embedding483输入token，费用及一个unknown job未核清。父级9项实模租户/独立撤回断言全部未执行，不能拿清理当通过。两企业AI关闭、资料retired，活动员工/run/job/客户可读资料为0；四份员工数据及原2567内部原件保持。最终80项source/test、92项provider/环境与运行配置hash一致。证据`tmp/xiaok-repair-tail-v85/manifest.json`；阶段源码与四计划索引按原规则本地提交，不push/部署。

公开API、schema、权限、`KnowledgeRetriever`/`Evidence`与批准的C01/C02/C05/U01/S04 UI保持。本批不新增原生/真机/真实微信/BLE/build/全仓类型或生产通过，v84/v82原始尝试和评分各自独立。

## 历史v84：来源查询后的最终kind与问答隔离夹具

**AG-05/08/09内部技术子阶段Implemented，整体Limited。** `xiaok-renovation-v84` / `source-final-kind-v1`将来源查询后的模型最终响应枚举与原服务端合同对齐：保留synthesis/business/knowledge/references；普通聊天、历史、记忆和图片仍保留general/vision/unavailable。当前引用目录ID、旧结果展示形式、完整原文、来源重验、四次调用/一次修复预算及全部服务端校验保持。沿既有[LangChain结构化输出参考](https://docs.langchain.com/oss/javascript/langchain/structured-output)对当前运行器作有界约束，不把schema当供应商遵循或语义保证。公开API、数据库schema、权限和批准UI保持。

仅开发验收使用`--manual-site-fixtures`选项，合成员工通过原服务明确编辑/发布标记观察，复用已有生成中编辑取消路径，不接受/转型供应商草稿，不将现场生成计为通过；实际attempt/取消/未知用量保留。默认模型草稿验收不变，报告/恢复模式不可混用。真实客户HTTP/Worker运行必须实际记录本prompt/read/final协议，不能只看磁盘hash。新唯一`xiaok-final-kind-v84-live`窗口沿两企业、原两场景各两次，独立保存首稿/末稿审读、九项租户/撤回断言及精确清理；共享锁/非越权角色/空闲队列和原模型/配置边界保持。证据归`tmp/xiaok-final-kind-v84/manifest.json`，下列实际结果不继承v83/v82评分。

v84收口：214/214单元、3/3定向隔离服务、73/73 Mini及全仓lint通过，类型本批0/全仓292；最终80项source/test及92项provider/环境文件hash一致。`2026-10-20T05:04:43.223Z–05:14:26.745Z`受控窗口使用新企业2621/2622，各74原段/10向量批和两份员工明确发布的合成记录。四个现场生成job经原编辑路径取消，实际现场provider调用0，不能计S04生成通过。A运行1058/1060/1062/1064，B运行1055/1059/1061/1063：八份首稿均为synthesis且实际记录v84/read/final协议；初次校验均unsupported_model_commitment，八次唯一修复均invalid_model_citation，交付/自动首稿/本对话原文语义首稿与末稿均0/8。26次模型响应全部已知成功，无输入超限、供应商未知或新增未知job，请求预算峰值15616/16000；观察到204018输入/6417输出token，查询embedding825输入token，费用未核清。引用目录成员均为本轮可用ID，但多段漏48小时条件、将未量测屏蔽判不符、计算无据日程或缺少本段实际/条款引用。八份修复都重复add原有ID，七份未实质改变正文/新引用，一份把段0改成安排结论，不能把结构或引用存在当专业正确。原文/引用及逐题审读分别见`review-view.json`/`semantic-review.json`，原始报告不改。

父级只完成双企业/同原件/同源码1项准备核对，随后因没有可交付citation在`assert.ok(citation)`停止，计划其余8项实模跨企引用/独立撤回未执行；不能拿清理或确定性检查替代。独立审计确认两企业AI关闭、资料retired，活动员工/run/job/未知job/客户可读资料均0；四份员工发布数据未被取消的生成任务覆盖，原2567内部资料不变。当前4B运行配置hash及完整环境文件保持，没有切换模型或重放旧未知任务。Stable原生、宿主/高屏/键盘、真机/真实微信/BLE/build及全仓类型保持未验/未通过，不要求用户手测或截图。整体业务Limited，源码提交和两计划索引按既有规则本地保存，不push/部署；下一批先复现修复任务投影与原问题的末尾重复，保留完整原文、目录和唯一修复预算。

## 历史v83：同一获权运行内复用成功只读查询

**AG-05/09内部技术子阶段Implemented，整体Limited。** `xiaok-renovation-v83` / `same-run-read-v1`只识别现有应用明确列出的只读工具。查询成功后，私有checkpoint绑定工具名称、规范JSON参数hash及完整结果消息位置；相同调用收到指向原结果的`already_queried`工具回执，原文、条件、定位、引用和消息配对完整保留。不同参数或工具仍可查询。明确只读列表之外的操作正常执行，成功后清空已有读回执。不跨run缓存，不新增证据来源。

复用前后、模型派发和最终投递仍逐次授权；原知识版本/epoch/受众及项目/历史来源检查可撤销复用。恢复时回执须匹配实际工具请求及配对结果；无回执的旧checkpoint保持可读，只在之后新成功查询时建立回执。失败/结果未知不标记完成。原4次模型调用/1次修复/16,000估算输入/48,000文字字节不变；模型诊断记录读协议，embedding/服务用量只按实际执行记录。参考[LangChain工具调用次数约束](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in#tool-call-limit)及[LangGraph工具消息/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)，保留已装StateGraph与应用持久化，不另建运行器；上游[DeepSeek问题10883](https://github.com/langchain-ai/langchainjs/issues/10883)是独立供应商问题，不作为本缺陷的证明。

KnowledgeRetriever/Evidence、解析/检索/发布及既有C01/C02/C05/U01/S04批准UI、公开API、角色和schema保持。固定验收覆盖同批/跨轮重复、不同查询、写入、恢复、撤权、损坏回执、旧checkpoint及原修复/未知结果边界；隔离服务须真实知识写入、单次检索、回复/引用持久重进和正式退役撤回。配置实模沿原两场景、每个合成项目各两次，首稿/末稿与未改原件证据分别保留。证据归`tmp/xiaok-read-dedupe-v83/manifest.json`。本批只收口内部确定性检查；新实模与原生未执行，下一最终协议组合窗口单独留证，不新增业务评分、真机或生产通过。

最终收口：211/211单元、3/3定向隔离服务、73/73 Mini及全仓lint通过，类型本批0/全仓292；最终源码/测试与92项供应商适配/环境文件hash无漂移。真实知识创建/索引/发布、单次检索、完整引用/重进、正式退役和复用前撤权均已执行；三条旧超限原记录只离线回放，请求预算估算17,877–17,881降至15,860–15,864，原原件/报告/评分不变。`attempt-1/`保留旧预算测试漏用既有可信投影的210/211失败；`attempt-2/`保留51服务通过/1条新增断言错误/7跳过，错误把撤回引用应返回available=false写成抛错。按原接口合同校正后新稳定窗口3服务通过，不混算旧组。复现见本目录`final-checks.mjs`；已提交固定入口为`node scripts/assistant-memory-acceptance.mjs --unit --source-integrity --evidence=<new-prefix>`及带隔离锁的`--source-integrity --wait-for-lock`。没有新开发库实模夹具或配置实模业务问答、没有切换模型或修改旧未知job；原8B评分与原生限制独立保持。下一批接续最终输出kind及引用，并统一跑组合后的稳定版本。

## 历史v82：有界原段校验与严格现场草稿

**内部技术子阶段Implemented，整体Limited。** 由当前唯一集成人共同修改知识原段校验和Agent现场草稿序列化。`fileChunks`最多并发校验4个独立原段，结束后恢复原顺序、Unicode偏移、完整正文/条件及文件定位；首个失败停止新增派发，等待已在途校验结束后返回失败。每次原回调仍重验当前企业/job/版本并持久记录attempt；原80秒chunk/110秒embedding派发时限、租约、profile及未知调用不重放保持。未增加OCR、分块策略、第二检索器或发布能力。

`xiaok-site-record-v2`复用既有明确指定`final_response`的输出传输，5个文本字段必填，`roomId`是当前获权项目的可选string枚举。没有明确房间时省略字段，序列化明确解码为既有null状态，不转型数字、不猜名称/外企ID；无房间的项目schema不暴露该属性。只解码一次同名输出调用，仍交给原严格`parseSiteDraft`，额外字段、未知/多个调用和截断均拒绝。持久checkpoint保留原provider响应，兼容历史纯JSON checkpoint，恢复不重发provider。这里只序列化，不执行业务工具、自动核对/发布或重试。已知安全拒绝标记终态失败，真实未知受理继续隔离；不为清零而改写历史1039/1040未知job。原作者/经理/成员、租户、来源和用量围栏保持。

咨询prompt升级`xiaok-renovation-v82`，综合policy/catalog/transport/repair沿`trusted-synthesis-v10` / `source-catalog-v1` / `final-tool-choice-v1` / `synthesis-edit-v1`及全部原预算。沿用[LangChain结构化输出合同](https://docs.langchain.com/oss/javascript/langchain/structured-output)和[Qwen模型工具输出合同](https://huggingface.co/Qwen/Qwen3.5-4B)，不新增运行器，不把provider schema当授权或语义证明。未改Mini/Admin结构、样式、素材、固定文案、导航、路由、公开API、角色或schema。既有C01/C02/C05/U01、PPT22/38 S04及真实写入/核对/失败/重试/重进仍是客户端基线，不新增原生或部署通过声明。

`tmp/xiaok-setup-v82/`首个准备批次的两份74段原件均索引成功，但新增末尾system指令引发硅基流动HTTP400/20015，咨询题0/8。独立合成探针保留精确拒绝，[Qwen官方模板](https://huggingface.co/Qwen/Qwen3.5-4B/blob/main/chat_template.jinja)确认system只能在开头。`qwen35-leading-system-v1`仅在已验证供应商/型号发送层合并可信system，不改运行器checkpoint/修复相邻关系、完整原文、其他角色或工具配对，不把user/tool内容升格。合并后仍验完整文本预算，其他模型/供应商保持原路径；这是provider/template兼容，不替换编排。nullable与纯string schema均保留数字ID失败，也有一次纯string成功；schema不能保证模型/provider始终遵循。[维护中的vLLM解析器测试](https://github.com/vllm-project/vllm/blob/main/tests/tool_parsers/test_qwen3coder_tool_parser.py)覆盖此类类型转换。硅基流动实际服务版本/解析器未知，不能断言它采用了某个上游bug。

v82收口于`tmp/xiaok-setup-v82/manifest.json`：198/198单元、23隔离服务通过/1实模照片跳过、73/73 Mini/全仓lint通过，类型本批0/全仓292，源码/测试/provider首尾及收口hash一致。中途类型收窄修改造成漂移的服务批次保留并排除，只计final-*。2615/2616各74原段/10向量批成功但现场HTTP400失败，AI关闭/资料retired，历史2条保守未知job保留，provider实际failed/accepted=false。最终2617/2618导入超时，无文档/模型调用，咨询0/8、新实模隔离0项，活动/未知/客户可读计数全0。原2567未变，窗口2026-10-20T03:19:41.306Z结束释放，businessBatchPassed=false。窗口后核对队列/近期调用为空及进程身份，以原命令/配置恢复本地3006，鉴权401/56ms，未操作生产进程。

用户要求的免费8B实际为Qwen/Qwen3-8B，不是Qwen3.5-8B。[官方目录](https://www.siliconflow.cn/pricing)列3-8B免费/仅文本/支持工具，无3.5-8B，3.5-9B收费。tmp/xiaok-free-model-comparison/独立保留Xing默认思考90s未知、4B数字roomId拒绝及8B草稿/工具往返探针成功。原单次lookup断言比既有最多4调用合同更窄，失败manifest保持；只接续明确已返回的lookup，未重放provider。探针未改配置或证明质量排行；后续明确8B业务窗口与原4B精确恢复记录如下。

技术复现：在admin运行`node ../tmp/xiaok-setup-v82/check.mjs <mode> --final`，mode分别取unit、service、mini、lint-full或types；service沿既有隔离锁/角色/空闲守卫。相应测试源码已提交，包括`src/lib/__tests__/construction-site-contract.test.ts`及Agent运行器/文件测试；实模沿带守卫驱动、唯一新夹具及原文/模型边界。

## v82接续：Qwen3-8B业务验证

**独立验证、源码未改；业务未过，整体Limited。** 用户授权的硅基流动Qwen/Qwen3-8B临时文本模型试验以a88ed26d实现为基础，同时绑定实际工作树/provider/测试hash，不宣称全仓洁净重建；旧4B准备失败和探针独立保留。受控窗口2026-10-20T03:34:51.509Z–03:50:13.551Z持有共享隔离验收/开发锁，核验非super/非BYPASS角色及初始空闲队列。新2619/2620各用同一原件完成74完整段/10向量批索引；4份原生final_response现场草稿均为获权string房间ID、每份恰1次成功provider调用，再经合成企业主明确编辑/核对/发布。原响应/版本保留，不自动发布或转型ID。

计划内8次客户请求均执行，固定/首稿通过0/8，未交付答案：1044/1048为invalid_model_answer；1047/1051为invalid_model_citation；1046/1049/1052为agent_input_limit；1050为indeterminate/provider_outcome_unknown。原4次调用/1次修复/16,000估算输入/48,000文字字节/6段/每段4引用保持。相同只读查询重复累积输入；两条kind=general防水原稿保留48h/20mm/24h/楼下检查/漏水停止等条款，但混用项目与手册而没有必需目录引用，也未明确带出记录中完工/保养未核实的限制。semantic-review.json直接核对原文/原稿；其他6次没有有效最终正文。0/8是集成通过数，不是通用智力排行或所有原句均错，未做独立人工认证或同条件完整4B业务对照。

B的未知调用使其在parent隔离屏障前停止，计划9项实模跨企/引用/独立撤回断言实际执行0项，保持未验。provider attempt2953在91,165ms后记PROVIDER_TIMEOUT；原run1050/job1454保留未知，不重试或清零。两合成企业关闭AI/退役唯一文档/停用员工/撤销测试用户context；活动员工/run/job/客户可读资料全0，2620新增1条未知job保留。原2567和历史2615/2616未知job未动。实际用量保留，未知token/费用未核销；含排队耗时不冒充provider时延或P50/P95。

tmp/xiaok-qwen8-v82/manifest.json绑定首尾稳定源码/测试/provider及原始输出；窗口释放后model-trial-restored.json/restore-proof.json验证平台原Qwen/Qwen3.5-4B配置及完整环境文件hash精确恢复、凭据/视觉保持、后续源码无漂移，重载后鉴权401。上文同hash的198单元/23隔离服务/73 Mini/lint技术检查沿用；本次未改源码/UI/API/角色/schema/知识边界，未新增原生/真机/微信/BLE/build/全仓类型/生产通过。下一Agent AG-05/08/09增量处理重复读工具/输入增长与最终协议/引用，本结果未建立新的KB解析/召回缺陷。

## v81历史AG-08：唯一修复中的显式来源编辑

**v81内部技术子阶段，整体专业客服仍Limited。** 当前`xiaok-renovation-v81`沿既有`trusted-synthesis-v10` / `source-catalog-v1` / `final-tool-choice-v1`加入`synthesis-edit-v1`。仅在本轮结构有效的目录式综合首稿已被原校验拒绝、且进入原唯一修复时，服务端控制消息与前一份完整首稿的hash绑定。模型按原段落下标显式修改text/basis、增删citationId、删除段落或追加必要段落；没有指明修改的正文和引用保持原值，不整体替换引用数组，不自动拼接候选。目录之外、换版/歧义ID、错误baseHash、重复段落编辑、越界、额外字段和首轮伪造修复均拒绝。

完整重建结果仍通过原来源、数值、机理身份、状态、正式承诺和范围校验，以及6段/每段4引用/24,000字节限制。原4次调用、1次修复、16,000估算输入及48,000文字字节预算保持。保留原供应商回复和原checkpoint中的编辑响应，重启只重做确定性重建并重验当前来源，不重发模型或业务写入；最终综合上下文保存完整规范回答，历史与撤回沿原路径。旧逐字quote修复兼容；已明确提供编辑协议的目录首稿不能用整答重写绕过。项目来源继续保存在综合上下文及既有来源说明中，知识来源沿原引用卡，不改变C01可见结构。

本批未改变KnowledgeRetriever/Evidence、知识解析/分块/检索/发布、版本/hash/epoch/受众、公开API、schema、菜单、角色或小程序WXML/Less/图片/导航。C01/C02/C05/U01沿唯一批准的`design-references/xiaok-p4b-public-sites-v1/README.md`与既有气泡/来源/错误重试/重进，不新增视觉还原或原生验收。本对话仍为两计划唯一集成写入者。复核[LangGraph消息/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[Agents SDK输出检查测试](https://github.com/openai/openai-agents-js/blob/main/packages/agents-core/test/guardrail.test.ts)，保留现有StateGraph、持久任务、租户/撤回/用量/人工围栏；没有引入第二Agent或模型判官。上游[DeepSeek工具元数据问题10883](https://github.com/langchain-ai/langchainjs/issues/10883)不作为本批已复现缺陷。

用户于2026-10-20先手动保存硅基流动R1，再明确授权切回历史`Qwen/Qwen3.5-4B`并做能力探针。R1-0528-Qwen3-8B两次合成诊断均HTTP400，其中完整保留的供应商错误为`20037: Function call is not supported for this model.`；这是该模型的具体能力限制。Qwen的必需工具、工具往返/最终工具及合成红色图片3项探针通过；原硅基流动凭据保留，平台模型、本机助手覆盖和已批准开发企业1454同步，policy_version=4。企业图片/工具开关保持，其他旧夹具不批量改配置；探针不等于专业语义、原生或生产验收。新实模只能创建新前缀及独立合成企业，不复用已retired的2611/2612；测试驱动按当前显式模型建夹具，切模型后拒绝续接旧模型的夹具/报告。

技术和新实模收口证据写入`tmp/xiaok-bounded-edits-v81/manifest.json`；执行命令仍沿`assistant-memory-acceptance.mjs --unit --source-integrity`、`--source-integrity --source-repair-only --wait-for-lock`及带共享锁/空闲队列/非越权角色守卫的本批`live.mjs`。既有真实手册、两企业/两场景各两次的固定标准保留；新模型不与v80合并评分。初次隔离回归7/8的唯一失败是测试误把知识引用卡数当作知识加项目全部依据数；按原合同修正断言并保留`attempt-1/`，不改UI或历史通过数。当前源码的最终结果与未覆盖项以本节收口记录及manifest为准；完整专业客服、1034归因/1035电话范围、run913普通指代及PPT整体仍未因此宣告完成。阶段完成后按两计划新增Git规则自动提交并回填提交号，不push或部署。

v81收口：最终138/138单元、8/8隔离服务、50/50知识定向单元、73/73 Mini及涉及文件/全仓lint通过，类型本批0/全仓292；source/test运行内与收口均无漂移。原5份首稿离线回放中3份需要修复的请求估算15,667–15,748/16,000，未裁原文或改旧评分。硅基流动3能力探针通过后，企业2613/2614新窗口于2026-10-20T02:35:17.677Z结束并释放；0/8咨询题执行、0项新实模隔离断言执行。A原件仅完成20/74次原段校验即`index_deadline_exceeded`；B原件索引成功，现场草稿run1038将有效房间ID输出为JSON数字256，原严格string/null合同以`invalid_construction`拒绝。该次草稿用量实际407输入/113输出token，费用未核清；不能当咨询答题评分。两企业均AI关闭、原件retired，员工/活动run/job/未知job/客户可读资料均0，源企业2567未变。manifest的`businessBatchPassed=false`保持；下一内部子阶段采用有界并发原段校验与严格模型输出合同，不强制转型、抬高时限/预算、追加模型修复或绕过真实服务。新失败不得用旧首稿或探针补算通过。

## v80历史AG-08：状态问句、机理身份与明确比较

**限定校验Implemented，整体专业客服仍Limited。** 本对话单独负责两计划的共享写入、接口、集成和验收；当前模型可见规则为`xiaok-renovation-v80` / `trusted-synthesis-v10`，引用及传输仍是`source-catalog-v1` / `final-tool-choice-v1`。知识库继续通过原`KnowledgeRetriever`/`Evidence`返回完整获权原文，不修改解析、检索、发布、版本/epoch或受众合同，也不把本批计为KB-1～4新增交付。

v80沿下方保留的v79失败继续：保养适用性等疑问形式的字段本身也可能缺资料，对象中的“是否”不再掩盖实际记录缺项断言；补正确节点后，试验/保养/检查记录缺项仍须选实际记录。有明确共享来源类型时，不因文字像现场记录而改成现场观察。这些仍是有限字段/来源检查，不是通用语义蕴含。`selectedCitationContext`只保留错误段原选项，合并数字/来源修复也一样；精确匹配应用自有可信规则后压缩重复表达，不改原文、检查点、身份/版本/条件、工具schema或服务端权威。16000输入/4轮/一次修复/6段保持。

v80实模窗口已结束且未完成，证据`tmp/xiaok-source-scope-v80/manifest.json`：企业2611/2612计划8题尝试7题，交付4题，1032修复后丢记录依据被拒绝，1036/1037因`provider_payment_required`停止，a组第二轮厨房题未执行。自动首稿2/7、固定4/7与本对话审读分开：5份实际首稿仅1可用，4份交付仅2可用；1034把现场100mm/同槽主张只交给条款引用，1035保留引用但电话等待范围不清。`businessBatchPassed=false`，9项新实模隔离/独立撤回断言均未执行。只读清理核验AI关闭、资料retired，员工/活动run/job/未知job/客户可读资料均0。未记录新输入超限，估算峰值15946/16000余量仍窄，不是大上下文认证；原窗口source/test无漂移并已释放。未付款、切供应商或自动重试。

窗口结束后发现定向验收仍要求6题，新增共享`assistant-manual-cases.mjs`场景注册，统一默认6题/定向4题的选择与不同场景/轮次完成判定，拒绝缺题/重复/失败，首稿严格模式独立。当前128单元/6隔离服务/73 Mini及涉及文件/全仓lint通过，类型本批0/全仓292；窗口后证据独立绑定于`tmp/xiaok-source-scope-v80-harness/manifest.json`，20个Agent运行文件与已结束窗口一致。原脚本字节保存在`tmp/xiaok-source-scope-v80/harness-at-window/`，原实模报告/manifest/语义不改，不宣称脚本改后新实模通过。供应商恢复后用新前缀/夹具，保留1032/1034/1035原文并补新实模隔离，不复用retired企业2611/2612或合并分数。后续可评估原一次修复中的模型显式增删引用/改正文操作，结构上保留未改依据，不能由服务端自动拼接候选；新协议本身不授予额外判官/修复或权限。

`tmp/xiaok-source-scope-v80/budget-replay.json`绑定2份未变v79报告：1019/1025现拒绝；1021/1022/1024保留完整原文，估算输入从16291/16035/16124降为15420/15133/15349，无供应商/数据库调用或历史重判。原实模窗口125单元/73 Mini及涉及文件/全仓lint通过，类型本批0/全仓292。定向服务、新配置模型首末稿/语义、hash及清理见`tmp/xiaok-source-scope-v80/manifest.json`。新可选`--case-set=repair`保留原蓄水追问和厨房布线题，各独立企业各跑两次，计划8条新客户题，不当作新的12题/全场景分数；默认全量场景不变，恢复报告不能混用场景集。v79失败和原报告独立保留，不以新源码刷新。

v79接续v78保存的引用选择失败：长来源的引用候选新增原完整text内精确UTF16 `[start,end)`范围，原文、目录ID及持久quote不变。原唯一修复提供各段原选项的`selectedCitationContext`，增加状态/条款引用时保留仍支撑保留主张的引用，不自动合并候选、改写quote或接受未知ID。显式节点断言同时按实际返回的字段值检查，不依赖具体连接动词；非数值记录主张及有界施工记录缺项须选记录摘录，不能用需求/图纸缺项或节点摘录替代。定性手册比较也须有本段实际条款。这些仍是有限检查，不是通用语义蕴含或专业认证。写作规则只在影响本题时说明节点/电话，不为展示查询而附加清单；输入/轮次/一次修复/6段和来源重验边界保持。

采用决定仍是沿现有Agent路径执行最终回复检查，参考[Agents SDK检查边界](https://openai.github.io/openai-agents-js/guides/guardrails/)及其[测试](https://github.com/openai/openai-agents-js/blob/main/packages/agents-core/test/guardrail.test.ts)；已维护的[Parlant回复路径](https://github.com/emcie-co/parlant/blob/develop/src/parlant/core/engines/alpha/engine.py)只作对照，不引入新运行时。DeepSeek[问题10883](https://github.com/langchain-ai/langchainjs/issues/10883)涉及thinking/tool往返元数据，本批不宣称复现或修复；租户权限、持久任务、用量/未知费用和人工接续继续由本项目服务端控制。

v79已收口于`tmp/xiaok-citation-selection-v79/manifest.json`：122单元、6隔离服务、73 Mini及涉及文件/全仓lint通过，类型本批0/全仓292。企业2609/2610的run1014/1016–1026共9/12服务及固定检查通过、自动首稿4/12；本对话原文/引用审读首稿4/12、末稿7/12，非独立人工复核，`businessBatchPassed=false`。1019仍用需求/图纸缺项解释试验/保养记录缺项，1025补实际节点后丢失本段记录缺项依据；1021/1022在修复调用前触及原输入上限，1024在首份综合稿前超限，不评分未见的修复或升级词检查。9项隔离/独立撤回通过，员工/活动run/job/未知job/客户可读资料均0，资料retired，source/test运行内及收口无漂移，稳定窗口已结束。120份离线原稿绑定10份未变原报告，不计新模型输出；中断服务尝试不计通过，释放锁后已精确删除其企业3819/3820及7名合成用户。v78及更早报告保持原状。下一批补记录缺项归因并移除可信规则/诊断重复开销，不提高预算、删原文或增加修复；普通回复run913/B918仍独立接续。

`parseAgentReply`仅在内部办理断言投影中排除紧邻“是否”的具体状态谓词；原回答不改写，不整句删除。“楼下是否已联系，本次资料没有记录”可正常返回，同句或相邻句的真实已办理断言仍拦截，包含“联系完成”等无“已”字的完成表达。general/vision/unavailable及synthesis各basis共用此边界，不能借标签或修复绕过真实操作回执。

`synthesis-review.ts`在原有限复核中补充非数值现场观察的来源检查、已观察机理词的evidence/advice身份，以及明确同单位量数与上下限的直接比较。知识条款不能证明现场；无关项目记录、需求意向、历史原话和正式方案不能替代对应现场观察。资料对照说明不算现场断言。条款没有解释的干扰/检修/返工等通用机理另放advice，不能由真实引文变成原文事实；未量测不能判为不足、不符或达标。比较只核对明确对象、同一单位和含等号/严格边界，不换算、推算、输出差值或判断整项工程合格；歧义、同义机理、房间对应和一般专业语义仍需实模复核，不是通用语义判官。

v76在保存的run954–962上继续补回归：有界汉字量数也必须有本段原文，不能把原小时换成“两天/一天”；原文确实写汉字量数仍可引用，不做数值转换。明确现场与手册的高低比较须引用实际要求，标题或只引项目记录不够；总括不符不能带入明确未量测项。复用原量数/上下限提取作同单位精确小数对照，仅在原一次修复中给出原值、原边界、来源ID和未知项，不输出差值、推算值或工程合格结论。多项含糊/不同对象不充当通用判断。修复还给最多4个已有原文引用候选，优先实际项目资料，候选数值相同不证明主张；补对来源后保留正确数值，不简单删掉。机理合并为一个advice段，整答最多6段；未增加工具、检索、修复或模型轮次。

本批问题与数值缺证沿原唯一一次修复一起反馈具体正文路径。原quote/目录/ID、提交时来源重验、企业/客户/项目/撤回、用量/未知费用、租约及人工围栏保持；现有final工具已经带当前引用ID枚举，未知ID仍拒绝，不作模糊修正。先以原保存文本和危险相邻断言复现失败，再修复；不改原始报告或把离线回放说成新模型回答。

v77沿run967–978继续限定修正：有明确一般原理语境、条件因果、advice身份且同组分句没有现场主语时，“延伸不足会削弱效果”不算当前未量测现场不足；同句/相邻现场断言和确定无效结论仍核对来源。未量测不能推出“没形成有效屏蔽”，包括主语在前一分句的原失败。“两遍涂层/涂刷两遍”须有本段涂刷原文，普通“再说/核对两遍”不受影响；汉字量数可选原已有对应条款，候选不自动证明。已观察的“代价”因果也保留advice身份。修复只携带涉及比较/未知项的诊断，全局去重相同原值/边界/未知项并保留所有错误路径，不删除原文、历史或工具配对，不提高输入预算。最终写作规则强调本题必要段落、实际条款及通用风险身份，不添加业务固定答案。

v78接续983–994的明确失败：非数值“记录只写了/只写到抽测高度”等说明也核对本段实际项目观察；显式当前节点和阶段电话状态须选包含同字段、同状态的原摘录，同一sourceId下的记录合集不代替它。提问、条件假设及普通阶段说明仍可用，不能用相邻否定或免责声明消除实际断言。原单次修复最多提供2个本轮已有状态引用候选，候选不是自动证明，未知ID不改写；未量测项也不能混进“全部不一致”。`assistant-acceptance-report.mjs`只对同一`.next`文件的瞬时EPERM/EACCES/EBUSY重命名最多尝试5次，累计等待最多150ms；持续失败保留旧完整报告和待提交文件，不重放业务/供应商、不补改991的原判定。报告工具和两实模驱动纳入source/test hash。

v78已收口于`tmp/xiaok-source-roles-v78/manifest.json`：最终117/117单元、6/6定向隔离服务、73/73 Mini、涉及文件及全仓lint通过；类型本批0/全仓292，未跑完整构建。最终单元/服务在`tmp/xiaok-source-roles-v78-final/`；96份首/末稿回放绑定8份未变原报告，不能计为新模型回答。企业2607/2608、run999–1010共11/12服务及固定检查通过、自动首稿4/12；本对话逐条原文/引用审读首稿3/12、最终6/12，非独立人工复核，`businessBatchPassed=false`。9项隔离/独立撤回通过，员工/活动run/job/未知job/客户可读资料均0，资料retired，源/测试运行内及收口无漂移；本批稳定窗口已结束。未记录报告重命名失败、输入超限或第二次修复，原v77 run991的EPERM判定仍保留不改。

当前未完成项有具体原文：1000补入实际状态摘录时丢失1600/1100mm观察引用，原唯一修复后被拒绝；1010补状态引用后丢失同段“整改/验收未完成”的非数值记录依据；1001/1008“节点只显示处于/只表示处在防水阶段”仍引用记录合集，当前有限句式检查漏检；1006重复的定性“与手册数值有差距”段只引现场；1007用需求/图纸缺项摘录解释施工时间/试验记录缺项。999/1002/1003/1004/1005/1009通过本批最终语义范围。下一批先处理修复时保留同段其他主张的引用、实际字段和引用的关系、定性比较与缺项来源，再补原run913普通general回复的历史指代及B918电话入口范围。正确原文已返回，职责仍归Agent，不把有限词句校验当成完整语义认证或转交知识解析；不增加修复预算或自动拼接候选引用。

无schema、迁移、公开API、权限或视觉变化。C01/C02/C05/U01及原来源操作、失败/重试和持久重进继续对应批准`design-references/xiaok-p4b-public-sites-v1/README.md`；Mini结构、样式、素材、固定文案、导航、几何及Admin界面未改。历史v77最终110/110单元、6/6定向服务、73/73 Mini、涉及文件及全仓lint通过，类型本批0/全仓292；较v74多的5项来自`.next`生成路由，不宣称全量类型/构建通过。证据在`tmp/xiaok-risk-v77/manifest.json`及`tmp/xiaok-risk-v77-final/`。无新Stable原生/宿主/真机/微信/BLE证据，非开发阻塞，不要求人工截图或手测。

v77企业2606/2605、run983–994共12条服务成功，固定检查11/12、首稿5/12；run991因Windows `EPERM`报告重命名失败，原固定/首稿判定不完整，不补改通过数、不重发模型。独立语义首稿2/12、最终3/12，整批`businessBatchPassed=false`。984/987/988通过本批语义范围，其余仍有只引知识说明现场记录、当前节点/电话选错摘录，以及994把未量测项概括为“与手册不一致”的问题。9项隔离/独立撤回通过，员工/活动run/job/未知job/客户可读资料均0、资料retired，源/测试运行内及收口无漂移；稳定窗口已结束。下一批由同一Agent负责人接续这些确定失败，完整原文和实际状态已返回的引用选择问题不转嫁知识解析服务。

v76已独立收口于`tmp/xiaok-repair-v76/manifest.json`：最终103单元/6定向隔离服务/73 Mini/lint通过，类型本批0/全仓292。企业2603/2604、run967–978共9条服务成功/固定场景通过、2条首稿通过；独立原文/来源审读仅4条最终通过，业务未过。失败包括附带涂刷条款引错段、成本机理混入evidence、未量测屏蔽被判无效、一般风险建议误拦，以及重复修复诊断触发输入上限。9项隔离/独立撤回通过，源/测试无漂移，员工/活动run/job/未知job/客户可读资料均0、资料retired；保留失败、未知费用和`businessBatchPassed=false`，不改记v77验收。

v75固定基线在`tmp/xiaok-grounding-v75/manifest.json`收口：94单元/6定向隔离服务/73 Mini与lint通过，原48/24小时被写成汉字天数、修复超过6段、比较来源不足、总括误判、正确现场数值被删除及未知引用仍使业务未通过。双企业2602/2601、run951–962中9条服务成功，8条通过固定场景检查、3条首稿通过；分开审读仅4条最终回复通过。9项隔离/独立撤回通过，源/测试无漂移，测试员工/活动run/job/未知job/客户可读资料均0，测试资料retired。原失败和`businessBatchPassed=false`保持，不转计v76通过。

当前离线回放在`tmp/xiaok-risk-v77/replay.json`，绑定6份未变原报告和72份首/末稿JSON：run943状态问句保留，run971/977通用风险建议不再误拦，run967涂刷条款缺证、run970成本机理身份及run972未量测无效断言拒绝；不代表新增模型回答。v76的48份回放、v75原文回放及v74两份JSON保持。完整16项服务是v75最后收窄前的历史检查，不转记当前源码。沿[LlamaIndex引用实现](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/query_engine/citation_query_engine.py)及其[测试](https://github.com/run-llama/llama_index/blob/main/llama-index-core/tests/query_engine/test_citation_query_engine.py)的来源映射，复核供应商工具协议问题，复用现有ID枚举和唯一修复，不迁移框架或新增模型判官。历史run913原话指代、B918电话入口范围仍是独立AG-08待补项。

复跑在admin目录使用`node scripts/assistant-memory-acceptance.mjs --source-integrity --unit --evidence=<新的唯一前缀>`，服务另用`--source-integrity --source-repair-only --wait-for-lock --evidence=<新的唯一前缀>`。配置模型使用`node --import tsx scripts/assistant-citation-protocol-development.ts --development --evidence=<新的唯一前缀> --allow-bounded-repair`，不得复用完成/retired夹具或覆盖报告。规则投影变化已升级版本，新模型结果不能由历史回放替代。

## v74历史AG-08/KB接口：版号排版与现场量数的来源身份

以下是接续前已结束的v74固定批次及原始失败，不作为v75源码验收。原停止点见[交接入口](./xiaok-assistant-handoff.zh-CN.md#新对话接续入口与停止点)，当前实施与新证据见上节。

**限定校验Implemented，整体专业客服仍Limited。** `citation-catalog.ts`只在内部工程数值校验投影中，将已引用知识的可信名称与版号之间的横向空白视为排版差异；普通空格、制表符及Unicode横向空格可匹配，不跨行、不拆版号数字、不匹配未获权版次。带工程量纲的标题不获版号豁免。原始标题、正文、quote、citationId、目录及`source-catalog-v1`保持不变。

`synthesis-review.ts`对明确“现场记录/实测/这条记录”等量数或对照表达核对本段引用的实际`project`原文。手册碰巧含相同数字不能证明现场；需求意向和正式方案不能充当现场实测。量纲只作同单位文字归一，不换算、不推算。显式假设、提问、转述与本次无法确认的缺项说明保留原边界。这是有限表达的来源身份检查，不是通用语义判官，也不保证房间、因果或所有同义句均正确。

原一次修复同时反馈数字缺证和现场来源错误：可补选本轮已经获权返回且支持主张的来源，保留其原文支持的正确现场数值；删数字后仍保留“现场低于要求”等比较也必须有现场来源。没有依据则撤去该现场断言，明确本次无法确认。引用校验、提交时来源重验、企业/客户/项目/受众、撤回、用量、租约与人工围栏保持；不增加检索、业务动作、修复次数或模型轮次。知识解析、检索及发布服务继续返回完整`Evidence`，不为生成问题另建事实库或Agent。

无schema、迁移、公开API、权限或视觉变化。C01/C02/C05/U01及既有来源操作、失败/重试、重进状态沿批准`design-references/xiaok-p4b-public-sites-v1/README.md`；Mini结构、样式、素材、固定文案、导航和Admin界面未改。最终固定源码65/65单元、4/4定向隔离服务、73/73 Mini通过，运行内和收口哈希一致；本批类型0诊断/全仓287项，涉及9文件lint通过，完整生产构建未跑。15/15服务是合并修复反馈前的历史证据，不能升级为最终全回归。

真实HTTP/Worker/DeepSeek最终组为企业2599/2600、用户3609/3610、项目165/166、run934–945：每家只发布同一份9页工艺手册测试副本和两条明确合成的真实服务现场记录，原企业内部资料未改。12条交付11条，首稿结构8条；9项本人可见/跨企业拒绝/分别撤回与重进检查均通过，最后测试员工、活动run/job、未知job及客户可读资料均为0，资料副本保留retired。`tmp/xiaok-source-integrity/manifest.json`绑定源码、测试、原始回答及独立`semantic-review.json`。整组业务/专业语义未通过：run938在一次修复内补上正确现场来源，但多条风险机理仍混入evidence；run939把200mm误说成满足300mm下限，并把未量测屏蔽判作不符；run943的“楼下是否已联系、本次没有记录”被既有已办理防护误拦。不得据引用/词命中改称语义通过。

合并反馈前实模11/12交付、7/12首稿与唯一修复后的失败单独保留；两组导入HTTP超时发生在客户模型题执行前，清理后0资料/活动任务，不算通过。12组历史模型视图/24份JSON离线回放保留目录、schema和模型视图hash，接受结果变化只证明校验改变，不是新增模型成功率。Stable原生、真机/微信/BLE仍无新证据，非开发阻塞，不要求用户手测；未提交/推送/生产部署。该验收窗口已结束，下一批继续已观察到的状态问句误拦、机理身份及错误比较，历史指代/电话入口范围仍待核实。

复跑：admin目录`node scripts/assistant-memory-acceptance.mjs --source-integrity --unit`、`--source-integrity --source-repair-only --wait-for-lock`；实模`node --import tsx scripts/assistant-citation-protocol-development.ts --development --evidence=xiaok-source-integrity-merged-recovered --allow-bounded-repair`。实模保留首稿与最终交付分别计数，`validationFailureCount`与唯一`repairAttempts`分别记录；不因修复后成功改写首稿率。参考[LlamaIndex引用引擎](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/query_engine/citation_query_engine.py)的来源映射及[测试](https://github.com/run-llama/llama_index/blob/main/llama-index-core/tests/query_engine/test_citation_query_engine.py)，沿当前目录/引用协议校验，不迁移框架或放宽本项目权限。

上述实模命令记录已执行组；后续实际复跑必须改用新的唯一`--evidence`前缀，不覆盖原报告或重新激活已retired测试资料。校验原证据/收口哈希用根目录`node tmp/xiaok-source-integrity/finalize.mjs`，不派发新模型调用。

## 当前AG-01/05/06：空历史查询与有界收尾

**v74限定恢复闭环Implemented，整体专业客服仍Limited。** 原LangGraph/Worker在历史查询返回0条后，只在当前run关闭`recall_history`；非空结果仍可在原预算内细化查询。即使`hasMore=true`也不在空结果后换词重查，未命中不解释为客户没说过。`exhaustedTools`作为可选字段保存在原v1私有checkpoint，恢复/同批重复调用保留工具配对，不再次执行关闭的工具。下一用户轮次重新按权限选工具，不锁住咨询。

原四轮模型上限不变，最后一轮仅收尾；无可用工具时立即追加固定系统收尾指令，仍由原`final_response`、引用/范围/回执校验和最终授权事务提交。传输`final-tool-choice-v1`仅在必选且仅剩`final_response`时具名选择该函数；其他工具策略不变。实际派发在`agent_model.input_summary`记录`transportProtocol`、`activeToolNames`及`finalOnly`，不记录额外私聊或凭据。未知/已关闭工具不能执行，未知供应商结果不重发，原用量、租约、人工接管和来源撤回边界保持。无schema、迁移、公开API、权限或客户端视觉变化；C01沿原批准`design-references/xiaok-p4b-public-sites-v1/README.md`及C01/C02/C05/U01组件。

最终固定源码为49/49单元、4/4隔离恢复、73/73 Mini确定性通过，运行内及交付时哈希一致。此前20/20历史服务与24通过/8可选实模跳过的共享回归无执行期漂移，但其后增加了收尾/传输措施，只保留为历史组件证据。ESLint全仓前置0错误/30既有警告，最终涉及文件lint通过；类型本批0诊断、全仓287项，非全量类型通过。无路由/schema变化，完整生产构建未重跑。

真实HTTP/Worker/DeepSeek最终企业2592、用户3602、咨询503的run910–913四条均成功：两次原子更正到version302/304，保留厨房冰箱且不保存假设；撤回当前原话后依赖回复重进失效；两次只读回答保持人数/位置未知，无新写入/转人。run912空查一次；run913先读到上一轮问题，再空查，空结果之后均不再查询，最后实际仅允许`final_response`。结束时AI关闭、活动job为0。用量、原文、哈希、耗时与费用未知见`tmp/xiaok-bounded-recovery/manifest.json`及`semantic-review.json`。结构通过不算专业语义通过：一般安装建议缺少机型依据，run913把上一轮问题称作本轮提问，仍归AG-08。两个真实协议失败及一次断言范围错误的报告独立保留，不与最终四条累加。Stable窗口/CDP9431/SDK9420不可用，原生预检在造数前停止，无新原生截图或生产批准。

复跑：admin目录`node scripts/assistant-memory-acceptance.mjs --bounded-recovery --unit`、`--bounded-recovery --recovery-only --wait-for-lock`；实模`node scripts/assistant-history-development.mjs --development --bounded-recovery`，原生另加`--native`。沿原隔离目标/非特权角色/互斥锁/空闲队列及开发夹具保护。对照[LangGraph工具/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)、[DeepSeek工具选择合同](https://api-docs.deepseek.com/api/create-chat-completion/)及既有问题10883，采用应用层有界收尾与具名最终工具，不迁移框架或把供应商选择当授权。当前配置关闭thinking，其他模式/模型不据此宣称兼容。验收窗口已结束，继续下一授权批次。

## v73历史AG-04/05：先更正、再提问的同轮接续

**限定实现，整体Limited。** `xiaok-renovation-v73`复用C01/C02/C05/U01、原`record_need`四项原子批次、真实回执、LangGraph循环和引用目录。对以“更正/纠正”明确开头、随后用“另外/此外/顺便/再问/还有个问题”分开的独立问题，前部更正仍可保存；后部的假设、疑问不进入需求。仅在完整quote属于前部明确陈述且room也在该范围内时使用该边界；更正本身的条件、转述、疑问、回指前述更正的附带条件，以及全消息“不记录”仍拒绝。普通无明确独立边界的复合句不据此放宽。人数/位置分别保存，其他房间/设备保持；一个字段无效整批回滚，重试沿原操作键回读回执，不重新写入。

同轮综合解释从本run已成功`agent_need_write`的真实回执及原`source_refs`读取完整触发原话，严格绑定企业、本人、咨询、run/trigger和原内容hash。该原话沿既有`HistorySnapshot`/H来源和`source-catalog-v1`进入模型及服务端目录，标题为“本轮已记录需求的客户原话”；完整原话中的后续假设仍是问题，不是savedFacts或正式批准。没有把当前原话伪装成`recall_history`旧消息，也未放宽该工具严格早于触发消息的截止边界。恢复、提交、重进和撤回沿原hash、memoryVersion、参与者/租约/人工围栏；未提交、其他客户/咨询/run或失效原话不能成为来源。无新schema、迁移、公开API、权限、队列、框架或额外模型判官；一次修复、轮次、预算、用量和未知调用规则不变。

设计映射仍是`packages/assistant/chat/chat`唯一批准`design-references/xiaok-p4b-public-sites-v1/README.md`及既有气泡、来源片、失败/重试和重进状态；Mini结构、样式、素材、固定文案、导航及几何未改。本轮新增的原话引用沿既有来源操作，不新增视觉设计。Stable进程/9431 CDP及9420 SDK当前不可用，原生预检在夹具创建前停止，无新截图或桌面窗口；不升级历史原生证据或生产批准。

固定验收：两次真实多字段更正后继续讨论厨房加洗碗机的一般进排水问题；分别核对真实两字段回执、当前人数/位置、厨房冰箱保留、假设未保存、重进和撤回后两次只读回答。一般建议不得冒称现场情况、企业规则或正式批准。隔离服务另验整批回滚/重试、原键回放、来源及客户/咨询/企业隔离。复跑：`node scripts/assistant-memory-acceptance.mjs --mixed --unit`、`--mixed --capacity-only --wait-for-lock`、`--mixed --regression --wait-for-lock`；实模`node scripts/assistant-history-development.mjs --development --mixed`，原生另加`--native`。证据独立存`tmp/xiaok-mixed-correction/`，最终检查以未漂移的status/manifest及逐轮原文审读为准，不累加失败/重叠组。

开源复核沿[LangGraph记忆与作用域](https://docs.langchain.com/oss/javascript/langgraph/add-memory)、[上游工具/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[DeepSeek问题10883](https://github.com/langchain-ai/langchainjs/issues/10883)：采用同一有界循环、成功工具结果及应用持久化/授权权威，不迁移框架或新增事实库。供应商thinking问题仅作协议参考，本轮非thinking配置独立实测。完整复合字段、多房屋/无标记歧义及整个QA-05/08、专业客服/PPT仍未完整交付。

本批固定基线检查：44/44单元、10/10隔离服务与73/73 Mini确定性通过，单元/服务绑定全部20个Agent文件，运行内及该批结束核对无漂移。后续校验器修改不能继承这些组为新源码验收。既有Agent/事项/保留期回归断言为24通过/0失败/8可选实模未启用，但运行中`citation-catalog.ts`变化，整组作废待重跑，不能计作当前源码通过。ESLint0错误/30既有警告；排除生成Next声明的全量类型程序287项，本批触及文件0诊断，不记全量类型通过；无路由/schema变更，本轮完整生产构建未运行。

实模整组**未通过**：固定v73、20个Agent文件及驱动hash的真实HTTP/DeepSeek在合成企业2588/用户3598/咨询497执行run888/891，两次各一条真实原子回执保存use+desk（version302/304），厨房冰箱保持，洗碗机假设未保存，原话H引用交付且均无格式修复。撤回最新原话8045后，派生回复8050重进失效；后续run894连续四次`recall_history`返回0条/hasMore=true，模型换词重复查询导致`agent_iteration_limit`，没有最终客户回复。第二条撤回回答未执行。该故障属于Agent工具预算/恢复，不能把来源失效正确等同完整错误恢复通过。原文审读还发现run888把排水口高低直接推成需另装提升泵的通用工程结论，不能据此判专业质量通过；[制造商说明5.2节](https://media3.bosch-home.com/Documents/9001831461_A.pdf)使用机型相关的高位回路/空气间隙与允许管路高度，不支持该一概判断。此项留作Agent专业语义问题，不加洗碗机专用规则，完整QA/PPT仍Limited。

本次10条观察到的模型用量合计输入58,760/输出1,300 token，费用null；两次成功完整回读为103.6/66.3秒，失败55.9秒，不是首字时延或生产SLA。`manifest.json`绑定各status/报告与源码，`semantic-review.json`保留逐条结论，`development-audit.json`只读核对四个本批合成企业2585–2588均AI关闭、活动员工/run/job为0、正式事件0；六条未知费用预留保持reconciling，不填零或释放。Stable SDK/CDP仍不可用，无新原生夹具/截图/桌面操作。真实微信、宿主/高屏/键盘/真机/BLE及生产保持未验。当前用户要求的领域划分只调整计划/开发归属，未把上述未完成Agent检查改记为知识库任务或验收通过。

保留`live-attempt-1/-2/-3.json`：分别记录“考虑什么”漏开更正工具、已保存后的空引用格式失败、缺失import导致工具回滚；均不计最终实模。首次隔离包装器外层超时后，已核实原子测试子进程退出，并在共享锁/目标/角色保护内精确清理自己的合成企业3775/3776（`interrupted-cleanup.json`）；没有清理其他任务。较早9项漂移批次及未覆盖全部Agent文件的10项预检另存，不与最终10项累加。当前未完成项是Agent撤回后空召回的可恢复收尾、一般建议/主张的语义支持及当前源码的既有回归重跑；整体仍Limited。

知识侧交接的Agent待修复项还包括：比较知识与现场时，每个主张分别具备知识/业务来源，不能因另一来源含相同数字就证明现场事实；可信文档版号和名称之间的排版空格不能误报未支持数字。通用负例`engineeringClaimText('厚度3.2可直接施工。', [title='厚度3.2 mm参数表'])`将工程量误作可信标题版号而豁免，已由原协议集成负责人完成两文件临时收尾并交回Agent，详见本合同引用协议的“通用守卫收尾”及`tmp/xiaok-citation-protocol/metadata-guard-after.json`；其余项继续由Agent复现、修复及通用回归。只改服务端校验且模型协议不变时，可绑定新源码hash逐条重放保存的首稿/最终JSON，同时保留原实模hash；改模型可见字段或prompt则另建实模批次，不重写历史验收。这不恢复两个聊天同时写Agent，也不扩成手册专用规则或数字全局放行。

## 当前AG-02：需求投影与不可变更正归档

**限定实现，整体Limited。** `need-memory-archive-v1`复用现有LangGraph执行器、C01/C02/C05/U01、原HTTP/Worker和`record_need`。旧累计300条上限改为最多300个当前room+field；已有键在满载时仍可更正，新增第301个当前键继续沿既有失败反馈，不淘汰独立需求。每次原子批次最多四项；累计投影超过300条时，仅把完整superseded记录（含原quote、来源ID、时间及supersedes链）移入既有`assistant_run_steps`的`agent_need_write`私有checkpoint，当前投影与归档在同一事务提交，语义版本不因压缩额外增加。

`memory-store.ts`沿共享`AssistantRepository.conversation`锁定有效参与者，绑定企业、本人、本咨询、当前run及触发原消息；不从会话虚构owner字段。原工具序号1200+turn×10+index保存输入/来源hash、版本、归档计数和真实回执。原键恢复先核对持久回执，不重写需求、归档或事项补充；输入/来源变化拒绝。任一后续字段无效则整个批次与归档回滚。归档不进入模型、公开API或客户投影，历史仍通过原`recall_history`回读获权原消息。原保留期清空private checkpoint及摘要、企业清理删除原run/step，无新表/迁移/事实库/队列。

当前更正来源失效时，按原room+field同时阻断内存及归档中的旧消息ID。近期上下文、`recall_history`、抽取式摘记和持久历史引用均使用同一阻断；不能因归档复活旧值。其他房间/字段继续保留。AG-04另收紧明确“只回顾聊天原话、不查图纸/进度/业务资料”的当轮只读工具，避免无关业务读取；本人当前显式保存及找真人仍沿原权限，不因历史措辞新增操作授权。普通混合业务问题保持原工具集合。

已观察到的“旧书桌位置与当前有效更正不同，却要求客户重新选哪版”接入原`ungrounded_response_scope`一次修复；仅在明确聊天原话范围、当前有效desk更正仍获权及已覆盖的重复确认措辞下触发。来源缺失或正式版本/费用/工期/批准的问题不套用这一检查；修复禁用业务工具、重验来源并沿原预算/四轮上限，不新增模型裁判或无限循环。这是已知表达形式的有限检查，不是通用语义判定。

同批`need-memory-sources-v1`补普通派生回复的来源链：step1009/`agent_need_context`保存当轮模型已用当前需求原消息的ID/完整hash，原`agent_need_write`另绑定本次实际保存的原消息。派发、工具、checkpoint恢复、提交和客户/员工历史投影均沿原授权重验；普通保存回复复制的其他当前需求也不能绕过撤回。只校验原来源，不以旧memoryVersion阻止本轮合法更正。旧无依赖清单的普通回复在当前来源失效时仅给模型中性回合；旧无清单的provider/checkpoint若已有缓存则拒绝恢复，不假造过去依赖。新元数据不进入公开API或模型，原保留期/清理覆盖。现有气泡沿批准来源失效提示收起派生文字，Mini代码、固定文案及视觉几何不变。

入口和设计仍为`packages/assistant/chat/chat`及唯一批准`design-references/xiaok-p4b-public-sites-v1/README.md`。Mini结构、样式、素材、固定文案、导航、几何及Admin界面/API/角色未改；保存回执、失败/重试及持久重进沿现有组件。没有新增还原完成或生产发布声明。

开源复核：2026-10-19阅读[LangGraph记忆/namespace](https://docs.langchain.com/oss/javascript/langgraph/add-memory)、[上游工具状态与恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[DeepSeek reasoning_content问题#10883](https://github.com/langchain-ai/langchainjs/issues/10883)。采用“有界当轮状态与持久历史分层、每次工具恢复仍需应用权限/幂等”的原则；保留现有LangGraph和PostgreSQL权威，不另装store/checkpointer或更换供应商。该问题不等于本项目复现；本批配置模型实际工具往返独立留证。

当前固定v71及新来源保护下，单元41/41、需求隔离服务7/7、历史/摘要14/14；既有Agent/事项/保留期回归24通过/0失败/8项可选实模未启用。各批运行内及最终核对源码hash均未变，覆盖旧累计300条、650次纯更正/归档、独立需求、真实回执/批次回滚、跨客户/企业、归档/普通派生回复撤回与旧文本过滤、调用中撤回、摘要失败/恢复、人工与租约围栏及保留期清空新来源清单。Mini既有聊天/需求/媒体38/38、全量ESLint0错误/30既有警告；全量类型292项，本批触及文件（含media-context）0项，完整生产构建未重跑。独立批次分列，不累加旧组或定向重叠组，最终status/hash/日志、语义审读及夹具审计由`tmp/xiaok-memory-capacity/manifest.json`绑定。

真实HTTP/配置DeepSeek最终为固定`xiaok-renovation-v71`及`need-memory-sources-v1`的8/8，12个Agent源码hash全程未变。企业2577/用户3587/咨询476从300条原话开始，run833/834两次真实更正书桌，835/836新增设备与采光；回读version304、四个当前字段、五条投影及299条完整归档，共304个唯一ID，厨房冰箱保留。837/838两次区分历史靠窗与当前靠内墙，不重新要求选版本；撤回原消息6070后，两条对比回答6077/6079及三条普通保存回复6071/6073/6075均在重进时失效。839/840两次回答位置未知，明确新提问中的旧说法不是确认；持久模型checkpoint的旧assistant文本也不再含失效位置，未重写需求或发起人工接续。逐条原话审读见`semantic-review.json`；对比中仍有多余一般提示/标签，不宣称完整QA-05、专业客服或PPT验收。跨客户/企业负例来自隔离服务，本组没有新增跨客户HTTP探针。21次实际模型用量含2次摘要，输入122,420/输出2,129 token，费用均未知；完整回读14.1–46.9秒，估算输入峰值12,892，非首字或生产SLA。

Stable进程为0，9431/9420 SDK/CDP预检不可用，在原生夹具创建前停止，无新截图/桌面操作；历史v68/v67原生结果保持原范围。只读`development-audit.json`核对本批八组合成企业2570–2577均AI关闭、活动员工/run/job为0，角色non-super/non-BYPASS；52条未知费用预留保持reconciling，不填零或自动释放。功能、原生和生产证据分别记录，未验原生不变成人工手测要求。

保留失败及旧组：首轮错误假设会话含user_id，合法写入被拒，已改共享参与者授权；较宽历史比较曾触及原输入预算且未发布回答。先前撤回断言误把新提问中的旧位置引述当成当前值复活，已改为未知/禁止肯定当前值并另审原文。保留期包装器按既有OPERATIONS开关、独立目标及同一隔离库/锁修复，不放宽数据库或角色保护。`live-attempt-1`至`-6`包含失败、源码hash变化或v70→v71漂移，不能算最终实模；`-7`的回答虽未恢复旧值，审查发现旧普通保存回复仍把失效位置带入checkpoint，不能替代新增来源链验收。现已补原消息hash、普通派生回复投影及旧文本过滤，并重新执行固定源码场景。旧19项服务、定向7项和旧回归另存基线，不与本次独立批次累加。

复跑：在`admin`执行`node scripts/assistant-memory-acceptance.mjs --unit`；需求服务用`--capacity-only --wait-for-lock`，历史/摘要用`--history-only --wait-for-lock`，既有Agent/事项/保留期用`--regression --wait-for-lock`；完整相关服务可省略两个only参数。`--targeted`是重叠定向组，不能再加到通过总数。沿共享锁、空闲队列、55432/`xiaok_embedding_eval`、non-super/non-BYPASS保护。配置模型与真实HTTP为`node scripts/assistant-history-development.mjs --development --memory-capacity`；加`--native`沿原Stable SDK/CDP、精确路由/副屏/编译及可恢复合成transport，端点不可用时在夹具创建前停止，无桌面键鼠回退。

边界：仅解除累计更正耗尽容量，不承诺无限独立需求、跨房屋身份、复杂复合字段、归档级语义检索或300个当前键的模型容量。自由过程摘要和完整AG-01/02/PPT仍未交付；多余一般建议与完整专业解释质量另验。原生/完整宿主/高屏/键盘/真机/真实微信/BLE按实际证据保持未验，不变成人工测试门槛。

## 当前AG-01：可重建的客户原话语义摘记

**限定实现，整体Limited。** v69在原C01/C02/C05/U01及现有HTTP/Worker、v68完整回合预算和`recall_history`上建立`extractive-history-v1`抽取式语义摘要；当前v72 / `extractive-history-v2`的定向候选扩展见下。仅在工具已开启、当前可用工具不含`record_need`、`request_designer`或`record_reference_preference`的只读轮次启用；显式更正/保存、转人工及工具关闭沿原路径，不让历史摘要干扰当前写入。

先按原预算确定完整近期回合，再从较早的本咨询客户文字中读取最多60条候选，完整原句合计不超过24,000字节；图片、员工及模型生成文字不进入该摘要。配置模型只通过内部`select_history`选择最多6个已存在ID，服务端回填合计不超过5,000字节的完整原句，不接纳模型生成的摘要正文、截句、重复/伪造ID或额外属性。相关条件、否定、假设及问句随整句保留；问句不因此被认定尚未解决。范围不足用`hasMore`/`oversized`标记，当前有效需求与实时业务来源继续各自权威，摘记不是新保存、找人、正式批准或现场事实。

每个新run从当前获权原文重建，不反复压缩旧摘要。原`assistant_run_steps`的1008/`agent_summary_context`保存原范围、会话修订、scopeHash、进入摘要请求的全部候选原ID/hash/当前记忆修订、选中原句及覆盖诊断；1006综合解释、1007词面召回保持独立。摘要模型调用用1080/`purpose=summary`，沿原provider attempt、用量、租约和人工围栏，缓存请求hash必须一致；未知调用不重发。恢复、后续调用、提交、客户/员工历史展示重验全部候选依赖，来源变化收起派生文字。摘要提交后、图checkpoint前的重入复用已保存摘记；未完成的供应商回执仍按原未知结果合同处理。

摘要解析/供应商/预算失败只降级到原完整近期回合及`recall_history`，保存失败标记避免重启重发；权限、来源或模式变化仍阻止投递。每次摘要及回答请求都经过原16,000/14,500/13,000估算预算、48,000字节和工具配对守卫，原文及持久工具/图checkpoint不裁剪。现有保留期对所有run step统一清空private checkpoint/来源和摘要输入，企业清理不增例外。没有新schema、迁移、公开API、角色/菜单、事实库、队列或checkpointer。

采用依据：核对[LangChain摘要实现](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/middleware/summarization.ts)、[阈值/摘要调用标识/工具配对测试](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/middleware/tests/summarization.test.ts)及[LangGraph记忆](https://docs.langchain.com/oss/javascript/langgraph/add-memory)，借鉴分开标识摘要调用、完整近期交互和工具配对；继续使用已安装LangGraph1.5.0和项目provider-neutral合同，把摘要纳入现有来源撤回、任务、用量及人工围栏，不另装上层Agent中间件或框架持久化。DeepSeek[10883](https://github.com/langchain-ai/langchainjs/issues/10883)仍仅为thinking工具往返问题参考，本批配置的非thinking路径另做真实回归，不声称复现或普遍修复该问题。

入口与设计：`packages/assistant/chat/chat`仍沿唯一批准`design-references/xiaok-p4b-public-sites-v1/README.md`及现有气泡、来源片、失败/重进反馈，Mini结构、样式、素材、固定文案、导航及几何不变。本批未做UI还原；Stable DevTools进程及9431/9420端点当前不可用，SDK/CDP预检在创建原生夹具前停止，没有桌面操作、重开窗口或新截图，旧v68原生证据不升级为v69。

复跑：`node scripts/assistant-summary-acceptance.mjs --unit`；隔离服务使用同命令加`--wait-for-lock`，既有Agent回归加`--regression --wait-for-lock`；共享锁、空闲队列、55432/`xiaok_embedding_eval`及non-super/non-BYPASS角色保护不变。开发HTTP/配置模型为`node scripts/assistant-history-development.mjs --development --summary`；加`--native`仅走原Stable SDK/CDP。原始日志、运行源码hash、逐轮回答与清理记录在`tmp/xiaok-summary-v69/`。本批仍不覆盖自由改写的过程摘要、归档规模语义召回、员工/图片摘要、多房屋消歧或300条需求容量扩展；不声明完整AG-01/PPT或生产发布验收。

### 定向早期原话候选（extractive-history-v2）

当前沿用`xiaok-renovation-v72`，以`extractive-history-v2`扩展AG-01/02的有限接续：当前问题的前600个Unicode字符最多提取12个词面定位词，只查原企业/本人/本咨询、严格早于近期保留边界和触发消息的原话。数据库分别取最多61条近期及61条相关候选；相关前30条优先，再以近期原话及剩余相关项补齐，逐项重验权限与当前需求来源，去重后仍最多60条/24,000字节，按原顺序交给同一次`select_history`。仅搜索可读块正文/文字回退，不把JSON字段名当命中；没有词面命中仍保留近期候选。模型仍只选最多6个已有ID，服务端完整回填≤5,000字节，不截断条件/否定/假设。原1008步骤及scopeHash增加查询hash、相关候选数及旧60条窗口外候选数；原失败降级、未知调用不重发、来源撤回、接管、保留期及预算继续权威。没有新Embedding/模型调用、公开API、schema、迁移、角色、权限、事实库或队列。原C01入口/批准组件接真实服务，Mini视觉未改。

本批只验QA-05/06/07与XK-01/07/08的片段：超过60条较早客户消息后完整回顾原约束；排除其他咨询、未来消息、生成文字及被无效当前更正阻断的旧原话；重进不重发、撤回收起派生答复。配置模型沿原HTTP/Worker，以135条合成历史执行两次早期回顾、一次真实更正、两次当前回顾和撤回重进。复跑：`node scripts/assistant-summary-acceptance.mjs --directed --unit`；隔离服务`--directed --wait-for-lock`，新增场景另加`--directed-only`；实模`node scripts/assistant-history-development.mjs --development --directed`，原生预检另加`--native`。证据归`tmp/xiaok-history-directed/`；初次外层超时及精确清理单独保留，不计验收。最终执行结果以本节后续核对及当前状态文件为准。词面候选＋语义选择不等于完整归档语义检索：没有定位词的指代/同义表达、复杂多房屋/复合字段及整个AG-01/02/PPT仍未完整验收。

首轮配置模型验收的run851暴露当前需求原话被重复问题挤出`recall_history`四条结果，随后模型的事实段缺引用，服务端以`invalid_model_answer`拒绝且未投递。`live-attempt-1.json`保留该失败，不能算通过。修复沿原召回权限/词面条件，从有效当前需求的原messageId中最多取2条匹配原话优先，再补原25条词面候选；最终仍4条/7,000字节，不扩大受众或把记忆当正式事实。当前原话仍须早于触发消息，当前来源撤回继续阻断旧值；新增30条重复问题挤占的隔离回归同时检查原话完整和截止边界。没有新增空引用放行或自动批准。

第二次实模run856已正确引用当前原话，但“属于已保存的客户表达”被本轮保存回执守卫拒绝，失败保留在`live-attempt-2.json`。当前仅当综合解释先通过来源/数字/正式承诺校验，且本轮已有当前有效需求原话时，在最终投递前提前执行原回执守卫；缺本轮回执的历史保存措辞沿既有唯一一次格式修复改成“当前工作记录中的表达”，保留原引用，关闭业务工具，不重新保存或增加循环。最终回执校验保持，修复后仍声称保存成功则失败、不投递。新增隔离用例验证一次修复成功与重复假回执被拒绝，需求版本/工具执行次数保持。

采用复核：再次阅读[LangGraph记忆](https://docs.langchain.com/oss/javascript/langgraph/add-memory)、[工具往返/错误/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)和[DeepSeek问题10883](https://github.com/langchain-ai/langchainjs/issues/10883)。仅借鉴按范围检索相关记忆及完整消息协议，保留安装的LangGraph1.5.0和本项目数据库任务/来源/用量权威，不安装Store/checkpointer或新增Agent循环；词面候选是本项目的有界适配。DeepSeek thinking协议问题不等于本批非thinking路径已复现或修复，仍按配置模型实测。

v72共享引用目录接续中，实模run860因同一原话同时出现在摘记与召回中，被目录当作歧义拒绝；`live-attempt-4-catalog.json`保留失败。`currentSynthesisContext`现在仅按完整来源包指纹合并完全相同的来源，版本/hash/受众/其他元数据不同仍独立且不能取得无歧义引用。两份原获权快照及撤回依赖继续保存、重验；摘记的模型视图显式提供与工具一致的`citationOptions`，不让模型猜编号。未放宽目录解析、旧逐字引用兼容、正式承诺、真实保存回执或来源撤回边界。新增摘记＋召回共用目录且双依赖仍在的服务回归。

最终限定检查：`tmp/xiaok-history-directed/`的当前单元20/20、隔离定向5/5、小程序确定性73/73、真实HTTP/配置DeepSeek5/5；各组独立列出，不累加早先16/17项全组、漂移批次或重叠定向组。最终实模企业2582/用户3592/咨询483、135条前置合成历史、run861–865，固定v72 / extractive-history-v2；早期原话6661和真实更正6800进入同一咨询。更正一次批次保存两个字段，memory version2；撤回早期原话后，四个派生输出6797/6799/6803/6805在重进均不可用，原消息数保持20。run865沿原一次回执措辞修复成功，无重复保存。直接原文审读见`semantic-review.json`，仍保留位置/设备概括过宽及多余一般标签的质量观察，不据此升级完整QA-05或专业客服验收。

15次实测模型调用共输入78,364/输出1,815 token，费用null；完整回读33.2–68.0秒，不是首字时延或生产SLA。运行内关注源码hash未变；最终校验由当前status及manifest绑定，`live-attempt-1/-2/-3-drift/-4-catalog.json`分别保留空引用、历史保存措辞、v71→v72漂移和目录歧义，均不算最终通过。测试旧式目录编号曾硬编码，已改为选择实际提供的编号，不放宽解析。只读`development-audit.json`核对本批五个合成企业2578–2582均AI关闭、活动run/job为0；未知费用不填零、不作生产造数。全量lint0错误/31警告；类型程序288项、本批触及文件0项，不记全量类型通过；完整生产构建未运行。Stable SDK/CDP仍不可用，原生预检在造夹具前停止，无新原生截图/窗口/桌面操作；完整宿主/高屏/键盘/真机/微信/BLE仍未验证、非开发阻塞，不要求用户手测。双语模块与C01唯一还原台账同步；Mini视觉和生产批准保持原边界。

### v69历史执行证据

| 执行组 | 实际结果与边界 |
| --- | --- |
| 单元 / Mini确定性 | 20/20及59/59通过，分组不累加。覆盖整句/否定保留、伪造/重复ID与错误字段拒绝、空选择/超限、请求预算及工具配对；Mini使用既有聊天/媒体/需求/方案/公开授权/人工组件测试，未执行原生还原 |
| 隔离服务 | 最终14/14，源码hash在运行内未变；覆盖两次真实阈值压缩、完整早期条件、原文数量不变、失败降级、已提交摘要在图checkpoint前恢复、来源变更阻止提交/隐藏历史/按原文重建、咨询/企业越界、真实更正唯一写入及tools=false跳过。共享锁排队后正常执行，没有抢锁或清他人夹具 |
| 既有Agent回归 | 12通过/0失败/7项可选实模未启用；源码hash在运行内未变。覆盖记忆/重进、真实回执、未知调用、租约恢复、人工接管围栏、图片撤回及受控业务原结果，未启用项不算通过，不与14项相加 |
| 配置模型 / 真实HTTP | 最终5/5，企业2566/客户3578/咨询448/早期原话3451，45条合成前置消息，run743–747。两次早期回顾、一次实际保存、两次更正后回顾、持久重进/原话撤回通过。四次摘要请求三次成功，run747返回错误参数`messageId`而非`messageIds`，被严格拒绝后用原话召回完成；不记为摘要成功。HTTP覆盖本人链路，跨咨询/企业隔离由服务测试覆盖，没有新增跨客户HTTP探针 |
| 源码 / 语义 / 用量 | 最终九个Agent源码hash与回读一致，逐轮原文审读见`semantic-review.json`，当前更正和早期条件/否定均保留，无新批准/正式处理效果；部分答复仍多补一般流程建议，run744有多余“待核实”标签。14次模型调用实测输入95,893/输出1,674 token，费用均未知/null；完整回读18.4–44.5秒，仅五条样本，不是首字/生产SLA |
| 夹具 / 原生 / 工程检查 | 只读`development-audit.json`核验本批三个本人合成企业2562/2564/2566：AI关闭、活动员工/run/job均0；15条预留保持reconciling，不清零未知费用。Stable SDK/CDP预检不可用，无原生夹具/截图/桌面重开。全量lint0错误/30既有警告；全量类型292项，触及文件0诊断；无路由/schema变更，本批未重跑完整生产构建，旧全量构建限制不升级 |

保留失败：首次测试启动误用了Bun，在执行测试前失败；随后统一使用Node。首次隔离启动器55秒超时，其精确合成企业3679/3680在确认无测试进程后、共享锁内按代码/身份核对清理，见`first-interrupted-*`。恢复夹具最初按裁剪前输入构造provider缓存，12/13后改为验证真正已持久化摘要的恢复，失败日志保留；最终14项包括工具关闭边界。包装器改为等待stdout/stderr关闭并要求非空测试计数，避免截尾日志误算通过。首组实模运行期间共享`synthesis.ts`改变，保留`live-mixed-source-attempt-1.json`但不计最新源码验收；工具关闭守卫前的成功组另存`live-before-tools-guard.json`，也不冒充最终源码组。当前检查以最终status/manifest及`live.json`为准，不能把重叠组或旧失败合计成额外通过数。

## v68历史证据：完整回合预算与本咨询原话召回

**限定实现，整体Limited。** prompt `xiaok-renovation-v68`复用原C01/C02/C05/U01聊天及API。Worker仍取最近30条消息，去掉窗口开头的不完整交互，在同轮来源去重后对每次实际模型请求计算预算。`complete-turns-utf8-third-v1`按消息/工具序列化UTF-8字节除以三估算，另计每图1,536、输出2,048及下次工具结果768；应用输入预算/触发/目标分别16,000/14,500/13,000。这是估算，不冒充供应商tokenizer或窗口。仅移除较早完整交互，最近三个客户回合、当前问题、系统规则、图片及当前工具/修复链保持完整，调用/结果成对。必要输入或单个工具结果超过硬预算时，在供应商调用前走既有可恢复`agent_input_limit`反馈；不裁剪/删除聊天原文、持久工具结果或checkpoint。`agent_model.input_summary.budget`保存策略、前后估算和省略原消息ID。

`recall_history({query})`仅向已获权的本咨询客户开放只读原话查询。企业、客户、咨询及触发消息之前的序号上限由服务端绑定，参数不能选择身份或扩大范围。中文词面字面匹配最多25条候选，在7,000编码字节内返回最多四条完整原话，必要时标记`hasMore`/`oversized`。只读本人原文字，不读取生成回答、内部/项目员工消息、图片或已失效当前需求来源；更正来源不可用时，同时排除该房间/字段的更早原话，不能复活被替代值。原消息ID/hash及记忆修订保存在既有run step引用中；读取、恢复、模型调用、最终提交及客户/员工历史投影均重验依赖。当前有效更正优先；历史请求、假设和比较不产生新写入、转人或正式决定授权。此前生成的回顾在新轮仅保留问题指代并要求重读，避免旧记忆修订阻碍本轮合法保存。

不新增schema、迁移、公开端点、租户授权、事实库或任务队列；`agent_history_context`使用step1007，与综合解释1006分开，沿现有保留期和企业删除流程移除/脱敏私有数据。查询来源后误用普通文本提交时，复用原四轮内单次无业务工具的格式修复，最终来源/引用校验仍执行；修复不重试未知供应商调用或业务写入。

历史原话在原综合回答合同内使用明确`H<messageId>`、`kind=history`来源，只证明当时原话，不能证明企业规则、当前项目状态或正式同意。来源集仅由本轮已持久保存/获权的`recall_history`结果重建，并在恢复/提交/重进时复验；把原消息数字ID猜成综合引用ID仍拒绝，不放宽引用校验。答复沿现有来源文字/反馈组件展示，不新增历史来源界面。

采用依据：已阅读维护中的[LangGraph记忆文档](https://docs.langchain.com/oss/javascript/langgraph/add-memory)及[上游消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)。在既有供应商中立消息合同和PostgreSQL恢复链内采用完整交互与工具配对，不安装第二checkpointer、模型摘要服务或迁移框架。[DeepSeek问题10883](https://github.com/langchain-ai/langchainjs/issues/10883)涉及reasoning-content工具循环，仅作供应商兼容回归参考，不写成本项目已复现或通用规律；实际配置的非思考DeepSeek路径另验。

复跑（`admin`目录）：`node scripts/assistant-history-acceptance.mjs --unit`；去掉`--unit`运行隔离服务真实写入，`--regression`回归既有Agent，`--image`仅跑单图重叠子集；`node scripts/assistant-history-development.mjs --development [--native]`运行批准开发库的真实HTTP/Worker/配置模型/C01。证据归`tmp/xiaok-history-v68/`，环境包装器先加载Next配置再导入JWT，开发写入严格限制loopback5432/`smart_floor_planner`。预登记要点包括早期不拆墙/夜间不使用音箱、位置比较不等于同意、实际电脑使用更正、不重复副作用、持久重进及来源撤回。

| 执行组 | 实际结果与范围 |
| --- | --- |
| 单元与Mini确定性 | 45/45、73/73通过；预算覆盖工具schema/单图、两次实际阈值跨越、完整工具配对、H引用及否定谓词反例，分别计数，不替代实模/原生 |
| 隔离服务与Agent回归 | 最终6/6真实写入/恢复/来源变更/越界/更正/唯一修复通过；既有Agent12通过、0失败、7项显式实模用例未启用。单图子集1/1通过，与12项重叠不累加；共享锁、空闲队列及non-super/non-BYPASS角色检查保留 |
| 配置模型服务 | 最终5/5，run707–711，合成企业2557/咨询438/早期原话3158，45条前置消息；两次早期回顾、一次实际保存、两次当前更正回顾及撤回后重进，来源hash未变 |
| Stable原生SDK | 最终8/8，含run712–714三条实际模型回答，合成企业2558/咨询439/原话3257；真实输入/保存/反馈/重进/撤回，原会话及transport恢复。四张C01截图逐张审看，精确route/stack、逻辑390×844、PNG348×752；品牌右214小于胶囊左296，输入/发送底799 |
| lint / 类型 / 构建 | 全量lint零错误/30既有警告，最终八个相关文件零错误/警告；全量类型292项诊断，本批相关文件无诊断，不声称全量类型通过。完整构建未重跑，既有`AiDesignerLegacyPage`导出阻断保留 |

源码范围：上述5条实模服务/8项原生、既有Agent回归对应v68/`current-turn-sources-v6`，运行内hash未变，且在当时的`development-audit.json`回读核验。此后共享工作区的`worker.ts`/`synthesis.ts`增加v7知识摘录投影；保留该独立改动。`checks-v7.json`补验记录单元45/45、Mini73/73、类型292及lint零错误，但运行期间综合解释源码再次变化，不能视为稳定最新版本验收；v7隔离复跑又被活动队列保护在测试前拦下（`service-v7.stderr.log`），未抢锁/清理他人任务。原6/6记录保留于`service-mixed-v6-v7-status.json`/原日志，不能升级为v7复跑通过。最新源码差异及本人夹具状态见`development-audit-latest.json`；v6实模/原生不升级为最新共享版本验收，未来仍只走SDK/CDP，不通过桌面输入补验。

上述8个run/18次供应商attempt逐条原文审读见`semantic-review.json`；输入147,899/输出3,076 token有实际计量，另两条query_embedding计量不可用，费用保持null。服务完整回读26–34秒、原生29–33秒，原生已保存run首反馈1.64–1.67秒，仅为五条服务/三条原生样本，不是流式首字或生产SLA。`development-audit.json`对报告内精确11个本人合成企业复核AI关闭、活动员工/运行/任务及施工记录/正式事件0；包括旧失败的总29个run/66次attempt与上述8个run分开，29条预留沿原reconciling保留，不把未知费用清零。

原生最终流程使用用户禁止computer-use之前取得的新编译证据，后续只走SDK；用户现已明确禁止computer-use。脚本已删除桌面焦点/键鼠编译回退及外部编译证明参数，未来仅走已核对绝对项目/Stable/9420的CDP9431编译和SDK3.17.2；CDP不可用时保留未验证，不聚焦、重开或打断用户窗口。四张截图及原生层胶囊已审看，但完整宿主光学、高屏/键盘、真机/BLE/真实微信授权/C01 Chrome无新增验证，不转成人工门槛。Mini设计源及几何未改，不新增光学还原完成声明。

准备/JWT、格式、历史引用ID及“而不是已批准的方案”否定误拦截的失败各自保留；仅对该明确否定子句做窄化规范化，正向/双重否定与其他正式承诺守卫保留。单图预留从1,024校准为768后，单图及既有Agent回归通过。`before-final-freeze/`混入源码变更的流程、业务执行前的原生焦点准备失败均不计最终验收。尾轮隔离复跑首次接库因转发未运行失败，恢复原批准隧道后最终6/6通过；未抢锁或清理他人数据。旧中断本人隔离夹具3635/3636精确清理记录保留于`interrupted-fixture-cleanup.json`。

语义/可重建摘要、归档规模语义召回、更广话题/房屋消歧、同轮先召回再写入组合、300条需求记忆容量及完整AG-01/02验收仍未交付或未验收；完整回合裁剪不等于语义压缩。run710/714仍多补一般建议；声学效果/骨传导等专业推荐未作工程验收，不能把本批约束回顾通过当完整专业问答质量通过。Mini结构/样式/素材/导航未改，路由设计源仍是`design-references/xiaok-p4b-public-sites-v1/README.md`，不新增还原完成或生产批准声明。

<!-- continuity:start -->
<a id="当前p3bp4a客户更正与原事项接续"></a>
## 当前P3B/P4A：客户更正与原事项接续

**限定实现，整体Limited。** 沿路线图3.1及PPT15/23/37/38，复用下文获权来源、精确正式版本与处理链。当前行为为v67；v51–v66及下文更早执行记录只保留各自范围的历史证据。

- 明确更正后紧接专业提问仍可调用`record_need`，服务端绑定实际当前消息/房间，拒绝假设和转述建议。原参数兼容，新增可选`additionalNeeds`最多三条，合计四个独立房间/字段；先核验全部原话及重复字段，再同事务保存记忆、自动草稿及对应原事项进展。四条原话不必耗尽四个模型轮次，任一条不合法则全部不写。首条操作键保持，附加条目用`:need:n`；已提交批次恢复不重复事实、进展或供应商调用。单条/重进也返回`savedFacts`，高版本回执优先于开轮旧记忆，不形成正式批准。
- 存储的`NeedMemory`更正链仍是不可变原话记录。材料的need元数据携带字段/值/supersedes及客户表达身份。只读`qualifiedBy`限定兼容desk/other混写人数与位置的旧行，仅关联同咨询/房间、后续明确且当前有效的use更正，只限定人数；原话、桌型、靠窗、设备、其他房间均保留。仅使用当前获权原话，来源失效时关系不复活旧内容。更正来源不可用时保留无值interpretation屏蔽标识，不能回退旧人数；`NeedMemory.interpretations`及材料的`need.interpretation`为只读`{ factId, field: 'use', currentFactId }`，不可用时`currentFactId: null`，不由`applyNeedDelta`持久化。`query_followups`事项也经`availableNeedMemory`读取，不能从另一适配器带回失效值，不暴露不可用更正的值或来源ID。不是第二套记忆、正式变更或共享grant。其他复合字段增删、隐含更正和复杂多房屋/跨阶段冲突仍Limited。
  可用性继续沿用原消息及其run的工地来源依赖；本轮共享图撤回使同轮更正的既有依赖链失效，当前use按未知投影，原更正链仍保留。这不是客户明确撤回其人数更正的业务决定，未新增需求撤回入口。
- 绑定房屋的`search_knowledge`现复用`queryNeedIssues`，将`synthesis.bound_followups.v1`与原材料、实际施工快照一起持久化，保留原咨询、稳定issueId/revision、真实负责人/等待对象及来源版本。显式和绑定路径共用缓存/恢复、每次模型调用、提交、历史及接续包守卫。需求补充、团队明确回传的现场事项与正式决定分别溯源；普通解释不新建/分派事项，也不批准、落实、解决、关闭或共享。
- 事项模型来源按业务内容描述当前状态，正文不展示内部事项编号，ID/修订仍用于来源核对。当前用途、旧混合记忆、旧共享原话、团队图纸关联及精确正式决定不混用；旧版描述不覆盖后来客户更正，更正也不改该版决定或冒称送达内部负责人。靠窗意向已知则沿用，可量测坐标/检查记录缺失只说明本轮查询未知，不认定现实没有做。电话缺失不成为原聊天沟通前置；内部负责人姓名不证明客户已获直接拨号/私聊渠道。
- `current-turn-sources-v4`只改变模型视图：保留标准工具配对、结果键、完整原文和全部权限/版本元数据；显式与绑定查询中完全相同的来源共用一份完整正文，并保留来源ID/结果键别名映射，不合并不同版本、决定、受众或元数据。材料汇总只说明范围/缺项，不再复制全部原文。触发消息之后的修复反馈按原顺序只保留一次，压缩重复协议文案，不删引文修正数据、不增加修复轮次或放宽守卫。持久检查点/快照、来源重验及原48,000 UTF-8文字字节/四轮上限不变。被拒入参离线复放49,133→40,698文字字节，原未知attempt不重试、不回写；本地预检失败不冒称供应商故障。
- 对“同意这一版不等于现场/现场点位已经落实”及“不把这一版当作已落实”等已覆盖的紧邻否定谓语，仅等义转为仍需核对处理结果；独立正向完成句和双重否定仍拒绝，无据数字、越权来源ID及非原文引述仍由原守卫处理。不增加重试或授权正式动作。
- 带来源综合回答及普通自由回答现于最终提交事务共用真实保存回执守卫。出现“已记录/已按你的更正记为/更新为”等已覆盖的回执形式前，须有本轮实际记忆/偏好操作，旧事实与引文不能替代；假设性写入被拒后不能发布虚假保存回执。这是必要操作检查，不保证任意回执改写，也不证明每个自然语言字段/值或推断都已有语义支持。历史需求只说沿用原记录，已存私聊更正与未改正式版本分别表述；客户说明不说成图内观察，授权查询缺项不说成现实现场尚不能施工。仅将“无需/不用/不必再次确认已保存的…”这类相邻否定指代排除出新保存回执识别；原正文与来源校验不变，同段独立“我已保存”仍要求本轮实际操作。

- v62在原来源、引用、数值、正式承诺和冲突校验之后增加`reviewSynthesisResponse`，只识别实模已复现的限定形式：未限定到本次查询的可量测/现场尺寸缺项、已知当前人数却让客户重复说明或否认更正、内部检查/存储术语。按句检查范围，后一句免责声明不覆盖前一句；请团队核实/请设计师复核属于团队工作，不作客户重复追问；明确团队记录、条件假设、不同房间和多人房间歧义不混成同一已知需求。仅正文进入检查，不改写原引文、事实或持久记忆。已去除旧提示词中固定断言缺现场尺寸的句子；反馈只包含命中问题的具体改法。失败码`ungrounded_response_scope`沿既有唯一一次验证修复，修复时不开放业务工具，仍在原四轮/48KB预算、每步验权和来源重验内；再次失败或无剩余额度则拒绝回答。原未知调用不重试，未授权来源及正向正式承诺不能借措辞问题进入修复。`agent_validation.input_summary.scope`按实际错误记录`authorized_response_scope`或原`authorized_citation_only`。这不是通用语义裁判；未覆盖措辞、无必要建议和专业推理仍须逐轮实模审读。 修复位置以零起点JSON路径明确给出（`segments[0].text`为第一段）；不能用相邻段落补充声明代替修复原错误。 重复确认检查须有明确请求语气，正式版本/历史需求转述不作客户请求；紧邻否定完成语句与独立正向断言、双重否定分别处理。

- v64在同一回答校验中补齐已观察的范围错误：`reopened_unavailable_need`区分人数来源不可用与客户尚未决定，`unsolicited_unknown_plan`阻止据该未知主动建议点位预留，`unsupported_work_absence`不将未分配推成现实无人处理/没有待办，`unscoped_work_readiness`不将等待核对扩大为不能施工。仅以当前有效`customer_need`的无值interpretation和原followup状态判定，不恢复失效值。服务端原触发问题作为可选校验上下文，同时用于修复前和最终提交事务；问题明确唯一房间时，后续省略房间的句子沿该对象检查，来源含其他房间不导致漏检，歧义仍不猜。用户明确要求假设/比较/预留或重新说明人数时，可沿既有组件讨论；这不授予查询、保存、正式操作或恢复来源的权限。条件解释及逐字引用的获权现场原文保持可用。所有新问题仍走原`ungrounded_response_scope`唯一一次修复与原四轮/48KB预算，第二次失败不发布；没有新的循环、模型裁判或自动施工安排。该范围对应AG-04/05/07/08的本批子项，未实现AG-01长历史压缩/召回。

- v65保留原拒绝规则，给已保存的私聊更正与未改正式版本提供明确表述：不以“我不替你改需求”否认客户更正；修复时说“私聊更正不自动修改团队这一版”。这只修改提示及原一次修复的具体指引，不改原引文、真实保存校验、来源/权限或正式动作边界。v64实模拒绝及尝试用量保留，不改写为成功。

- v66补已复现的条件式重开：来源不可用时，“人数定下来之前”“你希望按哪种使用方式来定”“方便时把几个人用说一句”，以及主动以“如果两人/按一人主用预留”拟定点位的已覆盖形式，分别进入原`reopened_unavailable_need`/`unsolicited_unknown_plan`检查。条件句或“一般建议”标签不替代本轮明确请求；有来源的历史说明/普通条件解释及用户主动要求比较的分支保留。修复指引删除自行拟定人数的建议段，保留有效知识和独立需求；原引文、来源、一次修复及四轮预算不变。v65八次服务结构通过中两次撤回回答仍有该语义问题，保留原文，不计作撤回语义通过。

- v67复用原模型视图投影为`current-turn-sources-v5`，保留v4的完整原文/元数据、别名和工具配对。只在服务端原问题明确问人数可确认性/可沿用需求、对象唯一且当前来源标记不可用、又未明确要求比较/重述时，在既有系统消息末尾附固定范围指引；不插入房间名、原话或值，避免将不可信资料提升成系统指令。提示只区分本次可用性、既有独立意向与历史共享身份，不建记忆/事实/任务；原消息与持久检查点不改写。`agent_model.input_summary.responseScope=unavailable_occupancy_evidence`登记实际启用。另以`misattributed_shared_need`检查已复现的“原文只写尺寸待核对，却声称人数和尺寸都标待核对”；仅对本段引用的该类共享原件判断，原文确实同时标人数待核对时不拦。人数“核对后才能定”的已覆盖重开句与其明确否定分开。所有来源/引用/数值/正式承诺守卫先执行，仍共用唯一一次修复、四轮与48KB。

  采用依据另复核[Parlant情境化guidelines](https://www.parlant.io/docs/concepts/customization/guidelines/)、[LangGraph工具/消息测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[DeepSeek回放元数据问题10883](https://github.com/langchain-ai/langchainjs/issues/10883)。只借鉴按本轮情境装配规则，沿现有LangGraph/投影和供应商适配；不引入第二引擎、额外模型裁判、重试或迁移，不把供应商问题泛化成本项目已复现。配置模型及原生仍须实际验证。v66保留的两次撤回回答仍有再定口径或历史原文范围误述，不计作完整语义通过。

| 触发 | 沿用可见反馈/动作 | 恢复及边界 |
| --- | --- | --- |
| 明确更正后提问 / 多条独立原话 | 原C01气泡、真实保存回执后解释，不强制摘要/共享步骤 | 同字段链及原子批次；原话持久保留，失败不假报保存 |
| 存量混合书桌行与当前人数 / 旧共享或正式描述不同 | 同一批准回答/来源面板说明具体差异与保留意向 | 只读限定；supersedes仍精确同字段，不自动正式改版或外发 |
| 专业问题及未解决事项 | 企业依据与实际节点解释条件；相关原事项分别显示真实等待状态 | 同ID/版本重进，不编负责人、期限或结束状态 |
| 已复现的范围扩大/重复追问/内部措辞 | 原生成中状态内修复一次，成功后才出现回答；失败沿U01反馈/重试 | 原话保留；共享原有修复预算，修复不再保存需求、不调业务工具，接管/撤权阻止迟到回答 |
| 人数来源不可用 / 等分配 / 等现场核对 | 原气泡只区分本次未知、仍有效意向及真实待办；按本轮明确问题决定是否讨论假设或重新补充 | 不把未知当客户重做决定，不主动预留点位；不将系统未分配或待核对扩成现实无人处理/不能施工 |
| 来源换版/撤回、成员/客户变化、人工接管 | 原失效/重试/真人态及受保护原件/卡片清理 | 原守卫重验，别名/缓存不能复活来源或插入迟到AI |

无新API路由、schema/迁移、角色/菜单、Mini WXML/Less/素材/导航或正式v4写入。C01/C02/C05/U01沿唯一批准台账，S04仍为原PPT22/38，853×1844映射390×844，PPT23提供资料语境。无整屏切片、新设计或新增视觉还原声明。原生证据逐张登记精确route/stack、副屏/重新编译、逻辑视口和PNG编码尺寸。编译仅选择绝对项目路径匹配的唯一CDP目标并校验同一连接ID，保留其他项目窗口且不操作它们；真机/真实微信/BLE/完整宿主光学/高屏/键盘/Chrome按实际证据未验。

v67当前证据：55/55单元、2/2隔离服务、92/92 Mini确定性；22/22 Stable原生检查，含四条逐轮审读的配置模型回答及15张逐张审看截图。定向服务另有两条撤回回答及一次前置更正，均达到本批登记的有限标准。原生记录源码hash与最终文件一致；三组精确合成夹具测试AI关闭，活动员工/运行/任务及落实/关闭事件均0。费用仍为null，12条预留保留既有reconciling对账口径。首轮目标选择及类型失败明确保留；不代表完整PPT、AG-01或发布验收。

在`admin`复跑，以下命令均附`--evidence=xiaok-response-scope-v67`保留本批独立证据（复跑可换另一个`xiaok-`前缀目录）：`node scripts/assistant-continuity-acceptance.mjs`（隔离核心）、`--unit`、`--scope`、`--response`（仅QA02/05修复及重进）、`--claims`（拒写后虚假回执反例）、`--regression`、`--agent-regression`（受影响Agent来源回归）、`--mini`；实模`node --import tsx scripts/assistant-continuity-development.ts --development`，Stable原生加`--native`；审计`node --import tsx scripts/assistant-continuity-audit.ts --development`；同源类型`node scripts/assistant-continuity-typecheck.mjs d0238543`。隔离用55432/xiaok_embedding_eval、共享锁及非superuser/non-BYPASSRLS角色；开发/原生用批准5432/smart_floor_planner、localhost:3006、原Worker及配置DeepSeek，二者串行。全部夹具明确合成；存量混合行的显式准备复用生产记忆校验，不计作AI或客户业务动作。实际次数、被拒原输出、装配/类型失败、逐轮语义审读、来源/用量及限制统一见[交接](./xiaok-assistant-handoff.zh-CN.md)与`tmp/xiaok-response-scope-v67/acceptance-summary.json`；结构或基本原生冒烟通过不等于完整专业/PPT或发布验收。 `--scope`只执行本批QA02/05及旧混合需求撤回后的修复/假设讨论/无副作用两项隔离服务验收。首反馈分记HTTP接收确认或原生已保存run状态，完整耗时含服务回读；不作为流式首字或生产SLA。 实模`--withdrawal`只执行一次前置更正及两次撤回后核心问答，前置回答单列、不冒充其他场景；默认完整服务流及原生`--native`流程不变，两者不能同时使用。

实施前复核[LangGraph记忆/工具消息配对](https://docs.langchain.com/oss/javascript/langgraph/add-memory)、[维护中的工具/检查点测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)、[已关闭ToolMessage status问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)。v62另对照[Parlant回答校验与缺项/重复表达处理](https://github.com/emcie-co/parlant/blob/develop/src/parlant/core/engines/alpha/message_generator.py)及[DeepSeek工具协议](https://api-docs.deepseek.com/guides/tool_calls)：采用先验来源/回答检查和有限修正的做法，不照搬第二套生成循环，不把工具响应状态当业务成功。沿已安装LangGraph及本项目唯一修复额度，PostgreSQL继续掌握租户/撤回/持久任务/用量/真人权威；不安装依赖、迁移框架或另建记忆库，不把已观察DeepSeek措辞泛化成所有供应商结论，配置模型端到端验证仍须实际执行。
<!-- continuity:end -->


<a id="当前p3bp4a获权需求与点位图原件投影"></a>

## 当前P3B/P4A：团队核对与精确正式版本进入专业问答

**限定实现，整体Limited。** 按现行路线图3.1/知识完善计划继续PPT23/38。原C01 `query_materials`及`search_knowledge`绑定房屋上下文，在本客户/本咨询/明确项目房间中组合有效原话、共享参考、团队明确回传的图纸核对关联和已送达的精确正式方案。复用原事项、发布/决定和来源重验服务，不新建知识副本、授权系统、表、迁移、路由或客户端页面。

- `MaterialSource`增加`shared_need`/`shared_drawing`，保存精确grant ID/版本、原消息/hash、原咨询、项目/施工房间、图片ID/hash、`customer_reference`身份及`imagePixels:false`。同客户/房屋的其他咨询仍排除；同名不建立正式v4房间映射。多房屋/项目/重名房间仍澄清；全房最多20个房间，超出明确要求指定房间。
- 原服务继续决定最新同类grant、撤回/替换、消息/图片hash、图片删除/用途、房间更名、客户归属/访问、咨询用途/参与者及保留期。最新撤回不回退旧版。原材料/业务快照守卫覆盖工具缓存、模型提交、历史/派生回答及原有任务来源检查，旧snapshot或摘要不能复活来源。
- `team_review`只从`customerMaterialReviews`读取已送达原咨询、当前仍有效的管理者明确回传。复用`validResult`、当前事项修订、原共享需求/点位图、materialVersion、成员审计与实时权限；保存独立回传event ID/版本、客户回执messageId、issueId/revision、needGrantId/drawingGrantId与资料hash。内部核对/回复本身不开放给客户，只投影回传节选及关联核对身份，不复制内部原话、共享对话或未发布现场记录。
- `formal_plan`复用`customerPlans`/`readPlan`，只读发给本客户原咨询且已经送达的当前精确正式版本。独立sourceId绑定版本ID/hash、方案号、状态修订、真实客户决定、前版ID、原件ID/hash、事项修订及资料hash；保留该版差异、费用/工期变化和原文。待决定、稍后、不同意、要求修改、同意分别保留，新版不继承旧同意，撤回最新不恢复旧版。原件继续走既有受保护方案API。
- 原件继续使用C01私有媒体和S04获权原件API；正式图原件沿已有版本卡。当前材料投影不发送图片像素：`imagePixels:false`不关闭已有图像协议，也不证明读过图内位置/尺寸。团队关联核对、正式版决定、实际落实/解决/关闭分别溯源；实际落实与正式结束仍经`query_followups`读取明确回传，方案同意或一般解释不执行这些动作。
- `businessSynthesisSources`对参考、`team_review`、`formal_plan`分别给逐项sourceId/原文/身份，显式与知识绑定路径一致。prompt `xiaok-renovation-v43`要求在专业解释中引用实际使用的独立核对/正式版本来源；需求与方案不一致时保留双方，不把正式差异改成客户需求或默许其生效。费用/工期只解释该版已写明的变化，不承诺总价、实际延期或完成日；事实、企业依据、一般建议和未知分开。无新来源/业务变化时保持旧材料依赖hash，避免仅因代码升级整批隐藏旧历史。
- 真实联调发现重复工具正文使模型输入超过原48KB预算。`focusedSynthesisMessages`的`current-turn-sources-v2`仅精简模型视图：完整来源正文/ID/版本/权限元数据、冲突/缺项、知识条件/定位和标准tool_call配对保留；删除已由来源文本覆盖的重复data/displayText、相同的material.text及整段相同quote提示。持久快照/检查点、引用校验和提交/重进授权不变，不提高预算或重放未知调用。原失败入参复放由52,092降为39,819 UTF-8文字字节，并通过原输入校验；原DB保守未知状态不改写，不把本地预检失败当已证实供应商故障。
- 逐段数值引用仍严格校验。若某段已经引用当前正式版本，仅漏在同段引用真实方案编号/版号的标题，复用原有唯一一次格式修复，提供同一来源的逐字标题或完整短原文；不自动修改回答、不增加模型轮数或放宽数值规则。此例外只涵盖精确ID/版号，未引用的费用/现场尺寸、未知来源和正式完成宣称仍拒绝。已拒绝的原输出保留为失败，不当作有效客户回答。

PPT23资料原件与PPT38关键事项由团队核实映射原C01/C02/S04/U01。设计仍以唯一还原台账、C01 `design-references/xiaok-p4b-public-sites-v1/README.md`及S04原PPT22/38为准；WXML/Less、素材、字号、导航和胶囊布局未改。Stable原生自动化核对唯一副屏窗口、新编译、真实输入/点击、上传/来源片、持久重进及撤回，逻辑/编码尺寸分记；不据模拟器推断Chrome、真机/真实微信/BLE通过。

在`admin`复跑，以下命令均附`--evidence=xiaok-response-scope-v57`保留本批独立证据（复跑可换另一个`xiaok-`前缀目录）：`node scripts/assistant-team-materials-acceptance.mjs`、`--regression`、`--mini`；实模`node --import tsx scripts/assistant-team-materials-development.ts --development`，原生加`--native`；同源类型`node scripts/assistant-team-materials-typecheck.mjs 26a3664f`。隔离库固定55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS及共享锁；实模固定已批准5432/smart_floor_planner、localhost:3006及现有Worker/provider。场景依次比较未核对、明确回传关联、正式待决定、精确同意、新版与原话冲突及撤回；普通解释不产生落实/解决/关闭事件。业务/图片均为标记合成夹具，HTTP/模型/数据库真实；未知费用为null。实际检查、失败、截图和限制统一见`tmp/xiaok-team-sources/`及[当前交接](./xiaok-assistant-handoff.zh-CN.md)。

本轮已执行：隔离服务15/15＋综合解释单元10/10，最终整组25项通过；Mini单元92/92；开发实模六种状态各两次，共12/12次回答；Stable原生20/20，另含六次真实回答。实模驱动末尾单页历史断言失败，单独以真实GET分页复核全部36条消息，确认12条回答均失效；没有重跑模型/业务写入。相关回归首组87通过/3失败/2显式跳过；确定性适配器改读精简后的模型视图，并另验完整持久来源后，材料整文件12/12复跑通过；按原测试标题去重为90通过/2跳过，不伪称单次92项全通过。全量lint0错误/30既有警告；同源类型诊断287→287无新增；Webpack仅编译通过，完整构建仍被既有AiDesignerLegacyPage非法导出阻断。原本地输入预算、编号引文及测试驱动失败均保留为失败，详见交接及原始日志。

上一轮原件投影17项隔离服务、8项综合单元、Mini92项、六次实模及原生20步的历史证据仍在`tmp/xiaok-material-projection/`，不改写或计作本轮检查。图内识读、复杂多房间/多阶段矛盾、完整客服/PPT、Chrome、完整宿主光学/高屏/键盘、真机/真实微信/BLE及生产边界按实际证据分别记录，不以有限通过升级状态。

复用原LangGraph工具消息/有界循环与业务快照，无框架迁移。实施前复核[ToolNode](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/prebuilt/tool_node.ts)、[上游测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)、[已关闭status问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)及[OpenAI兼容序列化11490](https://github.com/langchain-ai/langchainjs/pull/11490)。只补业务来源投影，工具成功不替代授权/专业结论；既有DeepSeek适配不泛化为框架规则。

## 当前P4A：同事项取消、恢复与原咨询状态回传

接续总路线图3.1和KB-4交接的现有P3B/P4A优先项，补共享现场事项的取消后续；不另建阶段号。限定实现，整体仍`Limited`。PPT17/20/24/36对应原事项有下文及真实等待安排，23对应同房间底盒/需求/设计师上下文，38对应团队确认及非批准边界；合成企业做法不是PPT施工标准。原PPT哈希`9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4`，单屏853×1844映射390×844。只复用S04原输入/文字回执、C01/C02/U01消息与失效状态，未改Mini WXML/Less/素材/导航或批准源。

### 命令、修订与来源

| 触发 | 真实反馈、可执行动作与重进 | 权限及恢复边界 |
| --- | --- | --- |
| `取消事项123：原因` | 同一issueId追加cancelled修订；旧处理回复及图纸核对不再沿用，原命令保留原因/操作者/关联回执 | 原发起人或当前项目管理者；取消不关闭正式业务、不取消其他照片关注 |
| `恢复事项123：原因` | 仅对已取消事项追加同一ID修订，重绑当前原记录版本/hash/房间和资料hash；恢复awaiting_owner，保留仍有效负责人，否则未分配 | 沿原取消权限；必须带当前事项、记录及房间资料快照，即使资料集合已空也核对hash。清空旧回复/图纸关联；原正式方案、决定、落实/关闭不能借此复活 |
| 管理者`回传事项123：明确节选` | 支持已取消、待处理/未分配及原已回复待核对；保存本次精确状态/负责人/等待对象与节选，原咨询站内收到一次回执 | 当前有效客户需求共享和同项目/房间来源；原已回复状态仍要求回复、必要的图纸核对。仅管理者选择披露，不自动搬运内部原话/照片或开放共享聊天 |
| 失效、冲突、未知回包及真人模式 | 冲突拒绝并保留原输入，未知回包核对同body/key；真人模式延后同事件，恢复AI时淘汰旧修订，不重复投递 | 来源、客户/参与者、负责人及发布者实时验权；成员移出/降权后的再加入不复活旧回传，须新核对/明确回传 |

仍走原`POST /api/{miniprogram/construction,construction}/projects/:id/chat/messages`与原GET聊天/versions；不新增API、表、迁移或后台菜单。`construction.site.issue.progress.v1`延续原ID/revision/原命令correlation_id，新增action=resume；GET的IssueView额外返回当前sourceAvailable，不作为客户端授权。`construction.site.issue.result.v1`新普通回传保存state、ownerId、ownerName、waitingFor；旧无state事件仍按原awaiting_review投影。旧普通回传与原正式结果保留既有sourceVersion/lastProgress形状，代码升级不批量作废旧有效问答；真实来源/业务/权限变化仍失效。取消回传waitingFor=none，待处理按真实有效负责人为team或unassigned；负责人失效后的明确未分配回传会清掉旧分派/回复，不能靠再加入复活。正式resolved/closed继续原P5协议。回传以精确事项修订、资料hash和来源为准，状态再变使先前回执/派生解释失效，必须另行明确回传新版本。恢复和回传均沿原幂等事务、租户RLS与Worker/outbox，不自动扩大订阅或对外通知。

`query_followups`只读原咨询实际收到的有效状态与节选，加入既有construction source_refs/恢复/提交/历史/记忆守卫；与当轮有效企业知识及本人项目实际节点一起进入synthesis。prompt`xiaok-renovation-v39`明确已取消没有待执行安排、恢复仍需重新核对；模型没有取消/恢复/批准/解决/关闭写工具。没有期限不推断逾期，阶段推进不复活旧工作；普通聊天或知识建议不能冒充状态改变。owner/admin/super_admin继承所选企业管理权限，不要求成为项目员工；普通负责人、原发起人、observer、不同咨询/企业边界保持。

GET版本快照为当前最多50项现场事项补足原记录的当前版本元数据，即使原记录已滑出当前聊天分页；不复制旧原文或依赖页面缓存。records最多150个键（当前页最多100条＋事项来源最多50条），issues等原有上限保持；写入仍在事务内重查实际版本/资料，不能把“有版本元数据”当作正式核对或批准。

### 验证、采用与剩余范围

复跑（admin）：`node scripts/construction-issue-continuation-acceptance.mjs`，`--regression`、受影响单组`--materials-regression`与`--mini`；实模`node --import tsx scripts/construction-issue-continuation-development.ts --development`，原生加`--native`；同源类型对照`node scripts/construction-issue-continuation-typecheck.mjs 9210a012`。隔离套件固定55432/xiaok_embedding_eval及共享锁；实模/原生固定已批准5432/smart_floor_planner、localhost:3006、现有DeepSeek/deepseek-flash与Worker，只创建标记合成数据并在结束停用账号/提升context_version/关闭开关。命令不授权真实客户导入、供应商/凭据变更、生产或全PPT完成。

| 检查 | 本批最终证据与边界 |
| --- | --- |
| 隔离真实服务 | 12/12：同ID恢复、原键并发/回包恢复、当前资料/记录版本（含分页与空集合）、撤权再加入、真人模式、三类管理者、租户/参与者及旧结果兼容 |
| 相关回归 | 63项按最终执行结果汇总：61通过、2显式跳过、0失败。初轮58通过/3失败/2跳过日志保留；修复旧mock与既有聚焦策略冲突后，受影响材料组12/12，逐题替换结果，未将跳过算通过 |
| Mini专项 | 92/92；只指本次assistant/construction-chat相关套件 |
| 配置实模 | 4/4，同题取消/恢复各2次（run382–385）；真实DeepSeek deepseek-flash、HTTP/Worker/知识索引。另有最终原生真实run392/393，逐条读原回答/工具来源独立核对，不是人类施工验收 |
| 最终Stable原生 | 17/17；逻辑390×844/编码348×752，原输入/按钮、两端重进、来源撤回及权限拒绝。当前五张分路由截图和控件/胶囊边界已核对；长文尾段捕获不等于完整光学验收 |
| 工程 | 变更路径lint零错误/警告；全量lint零错误/30既有警告。同源类型287→287、无新增诊断；隔离Webpack编译通过。完整构建仍被既有AiDesignerLegacyPage非法页面导出阻断，未宣称通过 |
| 夹具及用量 | 5个标记开发企业全部关闭、active_staff/runs/jobs=0、正式事件0。13个实际run/21次成功供应商调用共108,062 text tokens；8次查询Embedding607输入tokens；费用未知/null，索引工作另计，未编P50/P95 |

证据：`tmp/xiaok-issue-continuation/acceptance-summary.json`、`regression-final.json`及保留的初轮/重跑日志、`semantic-review.json`、`development-audit.json`、`usage-summary.json`、`native.json`、`native-driver.json`、`native-visual-review.json`。只读开发审计复跑：`node --import tsx scripts/construction-issue-continuation-audit.ts --development`。初轮夹具/幂等键错误、原生截图重名及测试mock失败的处理见当前交接，不用失败样本填通过数。

范围仍有限：显式命令和管理者本次回传，不自动公开后续私有处理；单独共享需求/点位图尚未进入query_materials的有效原话/图纸投影，不把共享节选自动写成已确认事实；正式墙图、图纸/照片主链按原授权合同。原咨询节点需求事项的跨阶段再绑定、更多自然表达、完整S05/P6及外部微信通知仍接续。持久化重建/阶段变化测试不冒充实际跨日运行或新的完整恢复演练。Chrome认证态、完整宿主/光学/高屏/键盘、真机/真实微信/BLE等未获得新证据者保持未验证、非开发人手门槛。全量构建既有AiDesignerLegacyPage非法导出未因本批消失。

本批复核[LangGraph持久执行](https://docs.langchain.com/oss/javascript/langgraph/durable-execution)、[维护中的工具/消息测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[历史已关闭1440问题](https://github.com/langchain-ai/langgraphjs/issues/1440)：采用幂等副作用、原键核对和标准工具/结果协议；Postgres继续负责权限、不可变事件、来源、租约与用量，工具status不代替业务成功。不迁移框架/checkpointer，不添加供应商专属补丁；历史问题不是当前版本存在缺陷的证据。实际配置模型与确定性工程测试分别登记。

## 当前 KB-4：知识运营核心（限定闭环，整体 Limited）

原`/assistant-knowledge`增加「问题集与健康」，沿用Ant Design/Admin Pro、720px Drawer、原来源诊断与共享操作反馈。范围来自最新双语企业知识计划的KB-4运营核心，对应K-06/10/11及K-05格式能力如实披露。PPT5/6/15提供自然提问/接续场景，23/38提供资料缺失、冲突和团队核实边界；PPT没有新增运营看板设计或工程标准，功能后台仍以双语Admin UI合同为批准设计源。C01/C02/C05/U01的构图、WXML/Less、素材和导航保持。

### 有界批量回归、恢复与取消

- `0089_assistant_knowledge_batches`新增两张强制RLS的本人私有批次/关联表，只分组既有evaluation；每批1–20题、并发上限1–3（默认1）、本人列表最近20批，仍占原企业2,000条回归记录上限。创建原键重放不增批次/题目；全部题目、修订、必需来源版本/hash、知识epoch、profile配置hash及模型标识/端点hash在同事务固定，任一题不就绪或版本冲突则整批不创建。配置无凭据。预览协议和登记的Agent提示词版本分记；批次执行仍是原保守摘录试问，不冒充客户Agent语义验收。
- 原Cron保护的Worker每次循环检查至多一批；复用原试问、run/job、额度预留、lease与provider attempt，不另建模型任务队列。批次/企业设置行锁仅覆盖本地数据库派发；`ConversationService`可在已有租户事务内复用原身份/会话/发送校验，单题非批次的原多事务恢复边界保持。每题savepoint保证本地失败不留下半条消息/预留；失败暂停后用原evaluation/create/send键恢复。模型调用只在原任务提交后发生，页面关闭不影响后续执行；状态从原run投影，批次结束不代表逐题通过或专业核对通过。
- 原`/api/assistant/knowledge/operations/`增加GET/POST `batches`、GET `batches/:id`、POST `batches/:id/cancel|resume`；写命令使用原幂等与版本校验，不接受任意租户/来源过滤器。企业负责人、admin、super_admin沿所选企业管理继承，批次及试问始终仅创建者可读。来源/问题修订、profile/执行配置变化收起批次和关联回归结果并停止后续派发；运行中来源、受众与权限仍由原Worker/投影守卫重验。实际provider/model调用审计与固定标识再核对，不宣称固定了供应商内部权重。
- 取消复用原`cancelRuns`：尚未派发的题不创建run，排队/运行中的原任务被取消，晚到提交仍受原lease限制。未调用预留释放，已开始调用的预留继续reconciling，未知费用不记零或自动重试。完成题保留当前获权记录；不会自动核对专业含义、关闭缺口、建立施工事项或改写企业规则。
- 设计源为双语Admin UI合同、既有Ant Design/Admin Pro的问题表、共享反馈及720px Drawer；原表增加选择和批次入口，逐项结果仍打开原同题回归与来源诊断。C01/C02/C05/U01不新增标记、样式、素材或导航，沿唯一台账原源及原服务投影。后台四屏V1草案仍待审，不作为本批实现源。
- 当前隔离服务19/19通过：9项批次新增检查及10项原运营回归，真实数据库/Embedding与确定性摘录模型分记；包括原键/并发、闭页后的Worker推进、局部失败回滚、取消/未知预留、三管理角色、撤权、修订/config失效、不可变来源及跨位数ID的最近历史排序。随后定向K-06补测1/1通过，停用profile后隐藏旧结果、阻止新建和派发，恢复原配置后清理；与原19项重叠，不累加为20项。供应商开始后的未知预留检查是明确注入状态，不冒充真实未知账单。初次8项因SQL数组空值/列表插值失败，已修正并保留`service-attempt-1*`，不计通过。0089已应用开发主库与批准隔离库，hash/两表强制RLS/non-BYPASS通过；主库16,427,580字节与隔离8,318,824字节备份通过PGDMP/目录核验，ACL限制到当前用户/SYSTEM/Administrators。首次备份目录读取提前结束的SSH EOF发生在DDL之前，原失败保留；改为先完整接收归档再核对。完整0089恢复及生产兼容仍未验证，未生产部署。
- 本批复核[LangGraph Functional API](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/functional-api.mdx)和[维护中的重放测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/time_travel.test.ts)，采用原键副作用、确定的快照与恢复边界；批次只是本地持久分组，Postgres/原任务仍负责租户、来源撤销、租约和用量。不迁移框架或checkpointer，不添加供应商专属补丁；阅读这些实现/测试不等于运行其上游测试套件。
- 配置DeepSeek/真实HTTP/原Worker：企业2536、负责人5219、客户3539，批次1–4共8次保守摘录试问通过，修订前后各两轮；总耗时75,600/41,531/180,356/252,048ms包含真实排队与回读，不作容量或P50/P95基准。客户Agent另跑4次，run655/657引用原版本267，664/665引用修订270，均为v67；18,826/82,115/19,805/20,850ms。逐句审读区分一般屏幕/家具通道建议与实际点位批准，没有把无现场记录说成检查通过。撤回后本人回归、缺口核对和客户历史均失效；最后在途run/活动测试员工均0。每次模型/Embedding实际调用及未知费用保留原attempt/usage，不把8条最终摘录当全部调用数。证据`tmp/xiaok-kb4-batches/live.json`。
- 认证Chrome沿用户现有super_admin会话、所选合成企业2540，无测试企业员工身份；批次5两题并发2，闭页刷新后两条原run671/672完成并可打开原evaluation/诊断/私有试问。批次6并发1，原run674取消、第二题未创建run，未调用预留释放；完成题的reconciling不抹成已核清。修改问题修订后旧批次只显示失效反馈，后续调度可取消。XLSX文档272/版本275核对12.50%/2.35 mm及原值/格式代码、工作表/范围和发布只读。截图[批次重进](../tmp/xiaok-kb4-batches/chrome-batch-reentry.jpg)、[数字原结构](../tmp/xiaok-kb4-batches/chrome-number-formats.jpg)、[原次结果](../tmp/xiaok-kb4-batches/chrome-original-evaluation.jpg)、[取消](../tmp/xiaok-kb4-batches/chrome-batch-cancelled.jpg)、[修订失效](../tmp/xiaok-kb4-batches/chrome-batch-stale.jpg)已审看；详情`chrome-verification.json`/`chrome-fixture.json`。恢复原「所有企业」选择，测试AI/员工停用、在途0。浏览器文件选择本轮未测，原件由真实HTTP导入/核对/索引/发布，不改变既有扩展权限。
- 原C01 Stable串行10/10通过、两条真实v67回答：合成企业2541/负责人5230/客户3553/咨询425/文档273，run676引用276、677引用修订278，耗时27,499/27,972ms（实际队列及回读），输入到发送返回547/553ms不作流式首字或SLA。SDK0.13.0、Stable2.02.2608080、基础库3.17.2；逻辑390×844、PNG348×752。原题/同题修订、来源展开、持久重进及撤回失效通过，原图/来源片/修订回答/失效四张截图均核对route/stack并直接审看；[来源片](../tmp/xiaok-kb4-batches/native-citation.png)。来源版本、逐句审读和范围见`native.json`/`native-driver.json`/`native-visual-review.json`/`semantic-review.json`。恢复原会话/传输，测试AI/员工停用、在途0。没有Mini批次管理页或新UI，不新增完整宿主光学/高屏/键盘/真机/真实微信/BLE或生产验收。
- 工程检查：文件单元22/22、文件服务17/17、原知识/权限回归38通过/4历史可选实模跳过、小程序确定性73/73；全量lint零错误/30既有警告。当前全量类型292条诊断，精确受影响文件过滤为0，不声称全量类型通过。隔离Webpack编译通过；完整构建仍由既有AiDesignerLegacyPage额外导出类型阻断，不改无关页面。
- 复跑：`node scripts/assistant-knowledge-operations-acceptance.mjs --batches --wait-for-lock`；`--profile --wait-for-lock`只跑K-06定向补测，同入口还支持`--unit|--regression|--mini|--lint|--types|--build|--compile`，可用`--evidence=xiaok-…`保留独立失败。迁移核验`node scripts/assistant-knowledge-operations-migration.mjs --batches`；实模/HTTP/原Worker `node --import tsx scripts/assistant-knowledge-operations-development.ts --development --batches`。原C01客户接续单独用`--development --native --evidence=xiaok-kb4-batches`，不重复后台批次，不冒充Mini批次界面；原生帮助器只选当前项目绝对路径/Stable/9420的唯一CDP目标并校验连接ID，等其他控制器释放再全新编译，不操作其他项目。合成Chrome夹具加`--batches --fixture`，验后同参数`--close-fixture`停用并审计原批次/run/预留。执行证据集中于`tmp/xiaok-kb4-batches/`。

### 问题、来源版本与缺口回归

- `0087_assistant_knowledge_operations.sql`新增企业隔离、强制RLS的`assistant_knowledge_cases`和`assistant_knowledge_evaluations`，复用管理者引用保护，采用租户复合外键与不可变评测快照。企业重置/删除先清这两表，再清关联会话/run/知识。无新供应商、凭据、业务事实库、Worker类型、prompt或Agent循环。
- 管理者明确整理固定问法、应有据/应缺依据、各最多5份必需/禁止文档及共享缺口备注。问题与备注是企业共享运营资料，私人咨询不会自动复制入库。编辑推进问题修订并重新打开缺口。每企业最多100题、2,000次回归记录；列表有界游标，来源选择最多展示200份。有界批量见上节，不宣称实测生产容量或定时计划。
- 每次复跑固定问题修订、knowledge_epoch和必需来源当前发布版本ID/hash，只用`customer_public`、无草稿，连接操作者本人原`knowledge_preview`、`ConversationService`、任务、额度、取消和供应商计量。未发布/内部/过期/索引未就绪的必需资料不能开始客户范围回归。单题操作与批次均沿该逐题协议；不能把后台摘录试问冒充绑定实际项目的客户Agent验收。
- 服务端持久create/send键覆盖关页、丢包和已提交发送后的崩溃；恢复继续原试问/run，不新建并行模型调用。版本冲突保留输入，未知HTTP回执复用`AssistantMutations`原键。企业问题集共享不开放他人试问，回归历史只列本人执行链接。
- 结果分开登记获权召回、最终入选、真实引用、禁止候选/引用、生成执行和必须另行核对的专业含义。缺资料预期单独计，不计正向回答覆盖；索引未就绪或诊断不完整不能算预期缺口通过，未写回执行链接只表示回执待核对。结构通过不能证明语义支持。管理者可保留缺口，确认核对需当前结构证据及明确备注，写入校验版本。发布/撤回/受众/有效期/profile/epoch及问题修订变化使旧回答、诊断、核对投影失效，知识变化后已核对缺口变为`needs_recheck`。回读证据和登记核对前再次检查精确候选/来源。

### 接口、健康与权限

回归重进按原outputMessageId投影回答，不依赖最新一页聊天记录。首次实模审阅还发现既有C01来源尾注缺陷：本人房屋资料为空时仍可能追加正向的户型/现场资料类别。现保留原缺项快照与不确定性证据，仅在缺资料时以`summaryTitle:null`省略该正向尾注；资料不全时只列实际返回的原话/正式户型/发布记录类别，批准回答组件保持，无新视觉模板或prompt版本。

| 触发 | 可见反馈/动作 | 恢复与边界 |
| --- | --- | --- |
| 保存/编辑或版本冲突 | 共享成功/失败反馈，冲突保留输入 | 重读后修改，复查租户管理者权限 |
| 排队/运行或关页 | 原run状态、本人历史 | 重进轮询原run，未完成dispatch复用原键恢复 |
| 必需资料未就绪或额度满 | 原明确错误，不假报成功 | 修订/索引/发布或等待额度，适用时恢复同一次评测 |
| 结构失败或专业缺口 | 召回/入选/引用/禁止项分开显示，保留缺口 | 改来源、复跑并明确核对 |
| 问题/来源变化 | 收起旧回答/诊断/核对，缺口待复验 | 当前版重新执行，不回退旧引文 |
| C01缺少实际房屋材料 | 原不确定性回答/合法引用，无正向户型/记录尾注 | 原聊天继续，缺项查询不提供实际尺寸/批准 |

接口均在`/api/assistant/knowledge/operations`下：`GET/POST cases`、`GET/PATCH cases/:caseId`、`GET/POST cases/:caseId/evaluations`、`GET evaluations/:evaluationId`、`POST evaluations/:evaluationId/resume`、`POST evaluations/:evaluationId/review`及`GET health`。新增效果/核对写入要求原操作键及严格字段校验；resume仅恢复本人既有执行。响应no-store。所选企业`admin/super_admin`继承知识管理，本企业当前显式授权`enterprise_admin`保留原边界；停用/待改密、跨企业和他人私有回归均拒绝。

健康读取真实发布索引就绪/不一致、当前profile/epoch、解析/索引队列状态/过期租约及30天attempt次数、已知输入token小计和未知次数，不是外部服务实时探测。索引费用保持`null`；企业聊天用量仍走原独立`assistant-usage`接口/授权，索引单列，未决预留不冒充实测。界面不增加平台管理者的用量或费用核对权限。原诊断改为如实披露正文/FAQ/DOCX/文字PDF能力，扫描OCR和复杂PDF表格尚不支持。扫描/复杂表格/旧格式、影子profile重建/切换/回滚和更大容量按实际材料继续，不阻塞前批限定场景。

### 采用与复跑

本批查阅维护中的[Haystack评测文档](https://docs.haystack.deepset.ai/docs/evaluation)、[文档召回测试](https://github.com/deepset-ai/haystack/blob/main/test/components/evaluators/test_document_recall.py)及[Dify检索测试](https://github.com/langgenius/dify/blob/main/api/tests/unit_tests/core/workflow/nodes/knowledge_retrieval/test_knowledge_retrieval_node.py)，采用检索/生成分层评测和预先声明必要来源的做法，保留本项目硬授权及撤回重验。未安装/替换框架、包或服务，不用模型自评分关闭知识缺口。

在admin执行`node scripts/assistant-knowledge-operations-acceptance.mjs`运行隔离服务核心；`--unit/--regression/--synthesis/--unready/--mini/--lint/--types/--build/--compile`对应各检查。`--compile`仅验证Webpack编译/追踪，不代表完整类型或静态生成通过。构建复制源码/配置到忽略目录`tmp/xiaok-kb4-build`，不覆盖运行中`.next`。`node scripts/assistant-knowledge-operations-typecheck.mjs f2651bd6`与KB-4前基点对比同一源码程序，保留无关工作区文件，双方排除生成Next声明。迁移核验`node scripts/assistant-knowledge-operations-migration.mjs`；只有明确`--apply`才备份并迁移两个既有批准开发目标，已应用SQL不改写。

实模`node --import tsx scripts/assistant-knowledge-operations-development.ts --development`，可加`--native`沿原Stable自动化。明确标记的合成企业/用户/知识，真实HTTP/Worker/Embedding及既有配置模型；后台试问与客户Agent解释分别登记，夹具中的核对写入是模拟运营操作，不是人类专业批准。当前结果、逐轮实测耗时、早期失败/修复及未验证项见[交接](./xiaok-assistant-handoff.zh-CN.md)和`tmp/xiaok-kb4/`。完整专业客服、全PPT和生产发布仍Limited。

## 当前 KB-3：实况综合检索（限定闭环，整体 Limited）

本批按最新企业知识计划的KB-3，复用已交付KB-1/2，不新定义阶段。场景对应原PPT17/18的实际节点与检查安排、19的铺贴前材料沟通、23的底盒/需求/图纸关联、38的缺失/冲突先由团队核实，以及6/15的连续追问。水电/防水铺砖前提与书房摆放题是清楚标记的合成验收资料，不是PPT原文中的工程标准；本批不代表完整PPT19审美沟通、识图或P5完成。

### 检索、实际事实与恢复

- 同一`retrieveKnowledge`路径注册配置升为`professional-hybrid-v5`。仍先按企业、受众、当前发布版本/hash/profile/有效期及来源权限硬过滤，原1024维Embedding、每路30候选、RRF k60、相关度0.3与最终最多5片不变。融合后先选择当前适用/条件未知依据，明确不适用条目后移；每份文档首轮最多2片，再补齐剩余名额。不适用来源有剩余名额才用于解释为何不能套用；未知条件不当作已满足或直接丢弃。适用性只取原服务端实际阶段，不接受模型/用户新过滤器，不按分数决定规则权威。
- v37实跑暴露模型检索词遗漏“书房”，必需的办公依据在原0.3门槛下相似度0.297而未进入上下文，故该正向题未通过。相同合成夹具/真实Embedding探针保留当前原问题后为0.378并入选，未降低门槛。v38的Agent将服务端当前客户原问题（最多600 UTF-16长度、不拆Unicode字符）与模型检索词合为最多1000长度的一次查询；不增加Embedding次数，不取代原硬授权或把提问当实际条件。原后台试问已直接使用原问题，继续共享同一检索实现/配置；诊断记录实际查询，长输入预算和边界有单元覆盖。
- 诊断继续保留原融合顺序、条件/缺项及最终入选，另记`selectionRank`区分融合与上下文调序，原本人试问Drawer可查看同一配置及结果。候选、授权和来源精确校验不变。原文件块仍包含本批已验证的表头/单位/脚注与真实定位，无需为本批额外父子索引或改写原片；未接外部重排、BM25、术语库服务或无限补检，不宣称解决全部检索长尾。
- 绑定房屋的Agent知识检索现在同轮刷新两份有权业务快照：原`queryMaterials`的本人原话/正式v4主户型/已发布记录，以及原`queryBusiness(construction)`的实际节点/项目版本/公开给本人的记录。即使模型只搜索知识或问“那现在呢”，实际节点仍进入同轮综合解释。未绑定房屋不自动选项目；多项目保留分开/澄清，不拼接他人的资料，不创建新事实库或将项目资料入通用知识。
- 原`assistant_run_steps`增加`synthesis.bound_construction.v1`检查点，沿用原材料检查点、run/租约/短事务/权限和使用量，无迁移、第二套任务或新模型调用。恢复优先读取原检查点并重验；已给模型的旧快照发生变化即`context_changed`，不静默换证据后提交。当前项目关联继续复用`construction_links`，幂等不重复。
- 配置模型实跑出现引用元素嵌套段落、把“直对”改成“正对”或删掉客户原话标点的失败，均由原严格校验拒绝，失败日志单独保留。工具额外提供最多8个、每个4–400字符的逐字`citationQuotes`复制提示，完整原文与条件仍保留；不改写原件或自动替模型修引文。原一次格式修复扩展到当前获权的普通知识/现场引用，仍在原LangGraph总轮数/截止时间/用量内，只能final_response，原结果与validationRepairs持久留存。未知来源ID、真实正式承诺、无文件数值支持错误、撤权/来源变化及未知调用不进入修复；文件数值修复仍按KB-2已有窄边界。最后必须再过同一严格校验，不能把有修复的成功称为首次模型全对。
- 版本回归查到数据库时钟比应用主机快约5.4秒，原替换发布用应用`Date.now()`，与检索/有效期的数据库`now()`不一致，刚复制的有效版本可能被误判未来。替换就绪谓词统一使用数据库`effective_from<=now()`；仍拒绝真正未来替换、不提前隐藏当前有效版本，首次未来发布原语义保持。回归显式模拟应用钟落后，已应用迁移不改写。
- 逐条语义复核发现v35一轮将书房底盒待核对扩大为基层/防水检查“无从谈起”，尽管结构、来源存在与服务断言通过，仍将该轮语义验收记为未通过。v36明确记录的房间/对象/版本范围、旧记录与当前全面实况的区别；缺检查记录仅表示本轮依据不足，不推断现实中未检查或其他部位无法检查。按原固定核心重跑，不用引用存在或模型自评替代语义核对，实际最终结果见交接。
- v36实跑另出现一次在唯一格式修复后仍删除原话句号的终止失败，未放宽逐字标准。v37的同一修复反馈提供具体错误引文及同一获权来源的`copyExactQuote`；字符相近度只用于选择精确复制提示，不参与引文接受、原文改写或新来源检索。提示仍为原文数据，最多4项纠正、原一次修复及全部最终校验保持。
- prompt `xiaok-renovation-v38`说明两份已查询快照可直接使用，按本轮阶段解释影响，不继承历史节点或重复查询同一节点。正式批准/费用/工期/验收仍受原验证守卫；一般说明不建事项、不安排施工、不承诺检查结果。所有实际供给模型的知识和业务快照在模型继续、提交、历史重进和人工接续中重验；阶段/记录/图纸/需求/权限/来源变化使相应派生回答失效。

| 状态/触发 | 原C01反馈与动作 | 恢复与权限 |
| --- | --- | --- |
| 当前资料齐备、专业提问/追问 | 原气泡组合解释并可点知识引用；事实/建议/未知分开 | 实际HTTP/Worker写入原会话；重进回读当前授权投影 |
| 缺点位图、检查记录或对象歧义 | 原气泡给有据部分与最小缺项；必要时澄清 | 正式墙图不替代点位图，文字记录不冒充看过照片 |
| 阶段变化/来源收紧或撤回 | 原来源不可用/回答失效状态，重新提问取得当前依据 | 不复用旧结论；候选、源片、快照及历史均重验 |
| 工具/模型失败、取消或人工接管 | 原错误/重试/模式反馈 | 沿原幂等键、未知结果和租约；不自动重试未知外部调用，不迟到AI回复 |

### 两路实际排名融合与诊断

- 当前配置为`professional-hybrid-v5`、`fusion=actual_branch_ranks_v1`。原实现合并候选后再次给整个并集排两路名次，使未进向量前30条的词法候选获得虚构向量分，或给未进词法前30条的向量候选补词法分。现在数据库在每路有界查询内保存`row_number`，按原ID合并去重；只有实际入路的1～30名贡献`1/(60+rank)`，另一排名为`null`。融合、诊断与本地纯检索包装器共用同一规则；诊断不再从并集反推排名。 既有v4历史trace不回填新排名，继续保留原配置标识；需要当前排序时由本人原试问重跑。
- 租户/受众/当前发布/版本hash/profile/有效期/撤回仍先于排名；每路30、总候选最多60、相似度0.3、上下文最多5片、阶段适用性和文档覆盖均保持。原1024维索引、Embedding原问题、查询词形权重、用量和持久任务不变，不新增供应商、模型调用、迁移、API或界面。C01仍复用批准C01/C02/C05/U01与原`packages/assistant/chat/chat`，后台仍为原知识管理/本人诊断。
- 2026-10-19对照[Haystack DocumentJoiner](https://raw.githubusercontent.com/deepset-ai/haystack/main/haystack/components/joiners/document_joiner.py)及[原分支列表融合测试](https://raw.githubusercontent.com/deepset-ai/haystack/main/test/components/joiners/test_document_joiner.py)，采用按实际输入分支累计RRF及去重的做法；保留本项目的硬授权、原排名常数和撤回合同，没有安装或迁移其框架。上游测试不代替本项目SQL和模型验收。
- 复跑：`node scripts/assistant-professional-acceptance.mjs --fusion`为隔离服务；加`--unit`执行相关纯合同，`--regression`执行原知识/回答/平台权限回归。`node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development --terminology --fusion`执行原C01真实HTTP/Worker/配置模型，加`--native`复用Stable原项目/副屏/新编译及真实输入点击。证据目录为`tmp/xiaok-kb3-fusion/`；60片夹具通过真实入库/索引Worker/发布/SQL，但分块与向量为明确注入的确定性测试，不冒充真实Embedding质量。配置模型与原生另行记录。 并行验收时可加`--wait-lock`，在同一数据库session advisory锁上排队（最多15分钟）；默认仍快速拒绝占用，目标库、非superuser/非BYPASSRLS、迁移及空闲队列校验不变。
- 本次还保留了材料问答偏题的复现：`tmp/xiaok-kb3-relevance/baseline/live.json`，合成企业2509、run553，服务端v54被`unsupported_model_commitment`拒绝；模型草稿仍混入点位/阶段资料。本轮只修正排名及诊断一致性，没有修改并行路线图任务的Agent prompt/回答校验，不把该失败或后续术语链结构通过计为专业语义通过。
- 最终纯测试37/37；隔离套件15/15（11项真实服务、4项纯专业合同，与37项中的4项重复，不累加）。60片专用查询夹具为隔离企业3555、文档1005/版本1127；已验证两路各30条且互不重叠、缺失分支为null、融合去重、最终上下文同时保留两路。索引Worker/发布/真实SQL与三管理者继承、跨企业/内部受众排除、实际阶段、诊断重进、换版/未来稿和Embedding期间撤回均通过；60片的分块/向量为显式注入，其他既有检索用例使用真实Qwen。清理后企业/文档/片段/任务计数均0。首轮14/15因通用“瓷砖胶”命中同套件已有资料而失败，现改成专用随机锚点并保留全部原断言；`service-attempt-1.log`及对应status保留失败，最终为`service.log`、`service-status.json`。
- 配置实模原HTTP两轮run557/559（企业2511、负责人5170、服务端prompt v55），原生两轮run569/570（企业2516、负责人5179、服务端v56）均通过本批融合/来源/未知材料断言，四轮都记录v5实际排名；两组来源撤回均使原回答失效，活动管理者/run为0，无施工处理副作用。这不表示完整材料解释或全部语义通过：服务轮仍有与材料题无关的点位/节点文字。Stable原生9/9，SDK0.13.0/基础库3.17.2，路由每次核对为`packages/assistant/chat/chat`，逻辑390×844、PNG348×752；真实输入、发送、引用展开、导航重进和撤回重进已执行。原气泡/来源片截图与既有批准组件对应，未作新的视觉还原。首两次窗口准备失败分别保留`native-attempt-1.json`/summary、`native-attempt-2.json`/driver；核实原窗口最小化及副屏正常边界后无激活恢复，并显式传入已核实安装目录，最终新编译后完成检查，再恢复原最小化状态。未重启或另开项目窗口，临时会话传输已恢复。
- 全量ESLint为0错误/30条既有警告，最终修改文件零错误零警告；当前同一源码程序排除生成Next声明后仍有287条全库类型诊断，受影响文件0条，不宣称全库类型或生产构建通过。`unit.log`、`lint.log`、`typecheck.json`、`live.json`、`native.json`及`native-driver.json`保留各类证据。双语计划/模块/合同、相关本地链接和`git diff --check`通过；完整宿主光学/高屏/键盘、认证Chrome、真机/真实微信/BLE、OCR与生产兼容/完整恢复仍未验证。没有生产部署。

### 来源、验证与剩余范围

小程序仍为`packages/assistant/chat/chat`，设计源为唯一台账的`design-references/xiaok-p4b-public-sites-v1/README.md`所继承C01/C02/C05/U01；本批只改服务数据路径和自然回答，不改WXML/Less/字号/素材/导航。后台仍为原`/assistant-knowledge`与本人试问，原共享操作反馈和三类管理者继承权限不变，无新路由、权限、解析格式或数据库迁移。可见普通状态复用已批准组件，不另画一套状态或新建审批流程。

2026-10-18复核维护中的[Dify检索节点](https://github.com/langgenius/dify/blob/main/api/core/workflow/nodes/knowledge_retrieval/knowledge_retrieval_node.py)、[Haystack过滤测试](https://github.com/deepset-ai/haystack/blob/main/test/components/retrievers/test_filter_retriever.py)及[LangGraph工具/中断/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)。采用元数据适用判断与最终上下文选择分开、标准工具消息和恢复前重验；Haystack运行时过滤可覆盖默认条件的行为不能覆盖本项目硬授权。不安装/迁移其平台；当前配置DeepSeek协议/格式与已知引用修复限制仍以本项目实际回归为准，供应商示例或上游测试不当作本项目语义证据。

复跑：admin下`node scripts/assistant-context-acceptance.mjs`（隔离数据库/真实Embedding/确定性模型），可选`--unit/--regression/--synthesis/--mini/--lint`；`node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development --context`为现配置模型/真实HTTP/Worker，另加`--native`复用已授权Stable原生流程。固定必要来源、禁止推断、逐轮证据及执行结果见[交接](./xiaok-assistant-handoff.zh-CN.md)和`tmp/xiaok-kb3/`；实模与模拟、合成与真实资料分别记录。范围外复杂PDF/OCR、任意语义归因、真机/真实微信/BLE、认证后台视觉和生产仍未验证/非本批开发门槛，整体专业客服仍Limited。

## 当前 KB-2：企业文件入库与结构引用（限定格式，整体 Limited）

原 `/assistant-knowledge` 增加企业文件类型，C01仍为同一个咨询与来源片。范围为DOCX、可提取文字PDF及下述有界文字/普通数值XLSX；原合成文件回归与下述用户指定原件验证并存，不批量导入混合开发目录，不向新外部解析/OCR服务发送资料。KB-1专业条目/诊断继续复用；文件知识与当前获权工地事实在原LangGraph同轮汇合，不建立新的项目事实库或把私聊/项目附件复制成企业规则。

### PDF连续正文与用户指定原件

既有微云开发企业1454的7条真实FAQ来自《开工九件事》《金螳螂·家 五步放线法》《水电施工标准（工程总监、管家）》，是按文件/页码整理的问答，并非整份PDF导入；此前KB-2材料表、防水PDF、数字/日期/时刻XLSX由`admin/scripts/assistant-file-fixtures.ts`生成，仅用于有标记的合成回归。两者与本轮指定原件分开保留。

用户指定`docs/装修施工标准手册制度规范/04 质量管理/00 管理文件/03 金螳螂家施工工艺手册2.0.pdf`，393,654字节、9页，SHA256为`fdbdaad5b5253c7b58c65e70c7fd49c584e7762323de03bf945bc72b78d73010`。纸面题名为“施工工艺标准2.0”，带“内部资料 严禁外传”；PDF创建元数据为2016年，不据此宣称现行国家标准或测试企业已采纳。只将该完整原件作为独立开发测试企业的`staff_internal`参考，不改成客户公开，不批量处理同目录或未下载完成文件。

原PDF解析按每个排版行计块，使该9页原件触发`knowledge_file_block_limit`。现`xiaok-file-v1:pdf:pdfjs6.4.299:flow-paragraphs-v1`仅依原TextItem的横排坐标/字号/行距保守归组相邻正文，在编号条款、标题/几何断点处分段，邻近完整短条款可在300字符内合包；不截断长条款、不跨页、不改字词/数值。仍保留PDF流的提取顺序及阅读顺序/表格/图片警告，不宣称多栏、复杂表格或图文理解。4MB/50页/128片/16,000字符/48,000字节/单片512-token及子进程资源限制不变，超预算仍明确失败，历史解析/hash不回写。原件得到74片，各页8/9/10/8/6/9/10/9/5；逐页去空白比对PDF.js原始文字流与最终片段，9/9一致。已渲染检查第3/6页；第3页强弱电、第6页防水高度和蓄水条件均完整保留。

`cd admin; node --import tsx scripts/assistant-real-manual-development.ts --development`固定核验loopback5432/smart_floor_planner及原件hash，沿真实HTTP/Worker/现配置模型与Embedding。企业2567/跨企业2568、管理者5241/5242，文档293/版本297、解析任务1098/索引1099；内部核对、索引与发布留痕只是测试，不替代企业专业审定。两轮各三道原文问题（防水高度、连续追问蓄水试验、独立问强弱电），run748/749/751及752/753/755为6/6 grounded，逐项核对300/1800/1200mm、保养48小时/水深20mm/蓄水24小时/楼下检查与渗漏处理、强弱电300/150mm及不得同槽共盒；定位分别为真实PDF第6/3页。两次“我家已验收合格可铺砖吗”及一次客户受众问内部条款均为insufficient_evidence、无引文。原键导入复用、下载byte/hash相等、未核对禁止索引、跨企业404、历史重进、撤回引用失效、原版本重新内部发布及已发布正文不可改写均通过。保留已发布原件供平台管理员在所选测试企业继续内部试问；测试管理者均停用、活动run为0。逐轮正文、来源、实际/未知用量及恢复状态在`tmp/xiaok-real-manual/live.json`；token/费用不可用不补零。

以上是后台既有保守摘录试问，**不是客户C01 Agent的自然综合解释验收**；不为内部手册扩大客户受众、改造试问为新Agent或声称整部手册专业语义已验收。原Ant Design/Admin Pro及720px Drawer/试问组件未改；认证Chrome超管核对企业2567原件出处/74片/已发布状态并新建本人内部试问，证据见[原件出处](../tmp/xiaok-real-manual/chrome-original-provenance.png)和[后台摘录问答](../tmp/xiaok-real-manual/chrome-manual-preview.png)。原件仍由真实HTTP导入，浏览器文件选择未验；重开本人试问及来源可读。后台原来源Drawer当前只显示标题/版本/摘录，文件名/实际页码已由引用API核对，不将API字段冒充浏览器可见定位。无API、Schema、角色、小程序标记/样式/素材/导航变化，原生窗口按用户选择继续暂停，旧原生证据不升级。

本增量复跑`node scripts/assistant-source-file-acceptance.mjs --unit --projection --evidence=xiaok-real-manual`为57/57（包含原55项，新增多页正文归组逐字/条件/Unicode页码及超长条款不截断两项）；`--xlsx --wait-for-lock`文件服务21/21通过（真实隔离数据库/Embedding，文本模型显式注入确定性实现，与上方配置实模分开），`--mini`73/73。四个受影响源码文件定向ESLint为0错误/0警告；`--types`仍292条仓库诊断，本增量受影响文件0条，脚本初次类型错误已修复。未改路由/Schema，未新跑完整构建，既有完整类型/构建阻断不记通过；无生产发布。

### 单一手册自然回答：v71历史基线

按用户明确要求，本轮知识语料只使用同一份《03 金螳螂家施工工艺手册2.0.pdf》，不混入微云企业1454的7条来源整理FAQ、联调文字或其他合成规则。企业2567保留原内部文档293/版本297、相同SHA256及74片；74是单份原件的片段数，不是74份资料。客户自然Agent沿现有`customer_public`权限读取，因此只在合成开发企业2569临时发布这一原件的测试副本294/版本298，结束或失败都撤回副本、停用测试设置/负责人并使测试用户上下文过期；原内部版受众不改变，不向真实客户或生产发布。脚本同时断言当前测试企业只有1份知识文档，模型实际咨询的全部knowledge来源都属于版本298和上述原件hash；相似段落不等于冲突，但不同文件的自由文本口径不由当前系统通用裁决，本轮不把多文档冲突算作已验收。

`node --import tsx scripts/assistant-real-manual-synthesis-development.ts --development`固定开发loopback5432/smart_floor_planner、来源路径/hash，使用原Mini HTTP/Worker/LangGraph和配置的deepseek-flash/Embedding；`--resume`只复用已验证的合成企业/同一文档/已核对记录，要求上次结束且活动run为0，不重放未知调用，先保存上一轮`attempt-*.json`。企业2569/负责人5243/合成业主3579/线索3018/工地160，主卫记录148和厨房149经原施工服务创建、模型整理、负责人按合成原材料明确核对并向该测试业主发布。它们是施工记录，不是额外知识文档或真实工地事实：主卫抽测1500/1000mm、未做蓄水且时间/结果待核实；厨房平行间距100mm、同槽共盒、交叉包裹长度待量测。每轮新咨询连续问防水高度、蓄水/铺砖追问、厨房强弱电，共两轮；不是同一咨询连续六轮或生产容量验证。要求自然解释同时使用实际获权项目来源和唯一PDF，不用后台摘录替代，保留逐轮正文、来源、校验、用量和失败。

真实首试run761在完整来源进入后触发原16,000估算token预算；未提高预算或裁掉原段/条件。当前prompt v71采用`trusted-synthesis-v3`，沿用v70的可信规则投影：仅在模型视图中把完整匹配的应用system综合规则换成集中表达，保留所有来源与当前提问、原工具配对、其他system规则/工作记忆、正式状态/数值/引文校验及原持久checkpoint。应用规则后若带问题数据，只识别原固定前缀加唯一字符串字段currentQuestion的JSON封装，并原字节保留后缀；不改写user/tool/assistant、未知规则或畸形/扩展封装。原指令和被查询原文仍完整持久化。初始摘要候选预检与真实answer派发均按相同投影视图核算，summary/vision调用本身不改，原阈值/输出/图片/工具余量、四轮/一次修复、租约/未知调用/费用及撤权均保留；每次真实派发记录policyProjection和实际预算。run761原数据离线复核从估算18,533降至约15,063，非容量或供应商计费token基准。 run793在第二轮厨房题的引文修复时仍被预算拦截，原5/6结果单独保留；v2只在原完整sourceId/text仍唯一可见时，把重复copyExactQuote换为copyExactSourceText指针，错误引文仍完整存在于前条拒绝回答。相同提示去重，未知/歧义来源或不同文案不替换；原完整诊断留在checkpoint。仅同轮已有可信综合合同已投影时，修复控制改用无重复规则的短表达，其他情况保留完整规则。该失败检查点离线复核为15,957估算tokens，距离16,000上限仍窄，不代表更大上下文可用。

v71另增显式完整来源选择：只有服务端工厂标记`fullTextCitable=true`、非history且完整text为4–400个UTF-16字符的同轮knowledge/project来源，模型才可提交`{sourceId,quoteFromSource:true}`；与`quote`严格二选一，来源ID必须唯一。服务端将这个明确选择归一为同一来源完整原文，持久回复/公开DTO仍为`{sourceId,quote}`；原字符串引文仍逐字校验，不自动纠正错字、空格或来源。未知、歧义、未标记、超长、history及额外字段均不接受。已知长来源误用完整选择时，原唯一一次格式修复只给同源逐字引文提示，不接受非法原提交、不替换未知来源，也不重跑业务工具。恢复、提交、重进与撤回仍使用原版本/hash/受众/来源链；不占用需求来源的step1009。`synthesis-source-selection.test.ts`覆盖明确选择/旧引文、伪造/歧义/超界、互斥格式、无据算术/版号/正式状态及已知长来源单次修复。

run772/777等实际失败暴露标题“2.0”、无引文建议段重写数值和自行计算差值的来源校验问题。现只改原一次修复反馈：`numericGaps`列每段缺少引文支持的数字，`numericTextPaths`定位确切正文路径并列现有引文数字；明确删除无据数字主张，可定性比较高低，不把文件标题当正文引文、不伪造计算依据，也不以汉字数值绕过。没有新增计算工具或放宽数值、金额、期限、正式状态校验；已有formal_plan编号原文修复范围保持。未实现通用带证明算术/单位换算。run776的回答已自然解释时间与漏水条件，但未主动写出深度，未计该组完整通过；后续蓄水问题明确问保养、水深、时长、楼下检查及漏水处置，保留原完整预期。造数首次“隐蔽检查记录”触发原S04查询路由，以及脚本在加载环境前导入JWT导致的身份失败，均单独保留；修复测试入口和明确进展表述后复用同一份原件，不修改S04分类器或业务权限，不把失败算通过。

采用边界复核[LangChain消息及短期上下文规则](https://docs.langchain.com/oss/javascript/langchain/short-term-memory)、[LangChain结构化工具输出](https://docs.langchain.com/oss/javascript/langchain/structured-output)和[LangGraph工具/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)（2026-10-19）：保留配对消息、真实完整来源及本项目PostgreSQL任务/权限/持久恢复，只精简应用自有规则的模型表示；显式来源选择沿本项目已有sourceId选择协议并保留服务端解析，不假定供应商严格执行schema；不迁移框架、增加checkpointer、重试层或provider特例，未运行上游整套测试。

当前配置实模最终组为`xiaok-renovation-v71`／`trusted-synthesis-v3`，并实际记录`need-memory-sources-v1`的step1009；19个Agent源码hash在整组和收尾全程一致。复用同一企业2569、同一文档294/版本298、同两条核对记录，以`--recheck`仅重跑已完成成功夹具；它与`--resume`互斥，后者仍只复用结束的失败组，均要求活动run为0且无未知在途调用，先留存原attempt，不新导入资料。咨询477/478的run841–846共6/6通过本题固定检查：防水抽测1500/1000mm对照1800/1200mm；蓄水前保养48小时、深度至少20mm、至少24小时、楼下检查及渗漏停止处理；厨房平行100mm对照至少300mm、同槽共盒禁止、交叉两侧150mm及未量测条件。每题同时引用获权项目记录和唯一PDF，实际重进可读，撤回后6条派生回答均失效，未创建施工处理事项。收尾活动员工/run/对客知识均为0，知识文档仍1份，原企业2567内部文档293/版本297不变。旧企业1454仍保留7条三份来源整理FAQ及1条合成联调文字，未删除、未切换，本轮不混入。

本组5/6使用原唯一一次修复后交付，另1次首稿通过；17次模型调用观测输入133,449／输出9,148 tokens，6次查询Embedding共683 tokens，费用未知，18处显式完整来源选择。完整回读22.5–38.4秒，非首字延迟或生产SLA；估算输入峰值15,843/16,000，余量仍窄。旧run819–824及更早失败组按各自源码范围保留，不拼接为稳定成功率。独立逐句审读仍为Limited：回答偏长，厨房部分一般干扰/检修机理被放入evidence段，原条文不能直接证明这些因果；个别概括过强，未配置电话的措辞仍可能读成联系前置条件。固定数值/来源/权限检查6/6不等于这些专业语义已通过，不声称整份手册、多文档冲突、同咨询六轮、原生或生产验收。逐轮正文/来源/用量/hash见`tmp/xiaok-real-manual-synthesis/live.json`，独立审读见同目录`semantic-review.json`。

当前工程复核：`node scripts/assistant-source-file-acceptance.mjs --unit --projection --evidence=xiaok-real-manual-synthesis`67/67（原57项、四项投影信任/原文完整性/幂等/修复引用去重、一项数值反馈及五项显式来源选择检查）；`--synthesis --wait-for-lock --evidence=xiaok-real-manual-synthesis`29/29（14项真实隔离数据库/Embedding服务、15项与单元重叠的纯综合检查；文本模型显式注入，不与配置模型混算），`--mini`73/73。此前28/29的失败是旧测试硬要求copyExactQuote，而可信投影已用copyExactSourceText指向仍完整可见的同源原文；现断言两种允许表示、精确原文、原单次修复及不重放业务工具，本轮全组通过，不把旧失败删去。10个受影响源码/测试/脚本定向ESLint0错误/0警告；只读`tsc --noEmit --incremental false`仍292条仓库诊断，本增量文件0条，不声称全量通过。无路由/Schema/权限或Mini可见结构/样式/素材/导航变化，原批准C01来源片与失效态继续消费同一回复格式。原生窗口仍按用户选择暂停，旧截图不冒充本轮证据；未新跑完整构建，旧阻断/生产边界保持。

### 共用引用目录与类型化数值校验

当前使用`xiaok-renovation-v73`／`trusted-synthesis-v4`及`source-catalog-v1`。`citation-catalog.ts`从同轮获权完整来源建立确定性的原文范围；模型的每个引用只有`{citationId}`，`final_response`按当前目录提供enum，服务端只在当前获权目录中解析、装配原sourceId/逐字quote，随后重验原租户、参与者、来源版本/hash/epoch、实际业务版本和生命周期。显示标题与解析后的标题不参与引文身份；原文、来源ID、类型或范围变化使编号改变。未知、外企业、过期、歧义、混合格式均拒绝，编号不是授权凭证。公开回复/数据库引用不变，没有迁移、额外模型、框架/checkpointer、队列或重试层。

短原文完整引用，长来源按原行/完整句建立目录，不再让模型判断400字符阈值或复制换行空格；没有原八条提示截断。完整text始终保留一次，目录hint仅为最多24个Unicode字符加省略号的识别提示，不能作证据。超长完整子句及无法保留表头/条件的超长表行不裁成可引片段，保守保留原文且不提供该条编号。文档名称中的明确小数版号仅在本段所引知识的可信标题/文件名支持时作为元数据；裸数字、带尺寸/金额/时间单位的数字和未引用版号仍走原工程数值守卫。一般风险/机理放advice，事实段仅陈述原文支持的要求、观察及直接对照；未新增计算工具或语义事实证明。旧sourceId/quote及明确完整来源提交仅保留兼容解析，不再向新模型公布；唯一一次修复继续关闭业务工具，保留未知调用不重发及正式回执边界。

2026-10-19核对[LlamaIndex CitationQueryEngine源码](https://github.com/run-llama/llama_index/blob/main/llama-index-core/llama_index/core/query_engine/citation_query_engine.py)及[编号/原节点元数据测试](https://github.com/run-llama/llama_index/blob/main/llama-index-core/tests/query_engine/test_citation_query_engine.py)，采用细粒度编号来源与保留原文来源关系；不是安装整套Python检索平台。结合[LangChain结构化输出](https://docs.langchain.com/oss/javascript/langchain/structured-output)及[LangGraph工具/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)，继续用已有LangGraph及项目PostgreSQL任务/用量/撤回/人工接续。schema约束帮助生成，服务端校验仍权威。[DeepSeek严格工具模式](https://api-docs.deepseek.com/guides/tool_calls/)目前为Beta并要求每层object全部字段required及additionalProperties=false；现有多kind工具未直接切换strict/Beta端点，不把供应商未保证的严格执行当作通过条件。没有针对指定手册名称、页码、数值或企业ID的运行时例外。

复跑入口：`node scripts/assistant-source-file-acceptance.mjs --unit --projection --evidence=xiaok-citation-protocol`；隔离服务加`--synthesis --wait-for-lock`，Mini契约加`--mini`。双企业配置实模用`node --import tsx scripts/assistant-citation-protocol-development.ts --development`，只接受loopback5432/smart_floor_planner、同一PDF hash及独立合成身份/项目；A/B各两个独立三轮咨询，原稿、唯一修复、交付和独立语义审读分开记录。先验证本人接口可用再双向拒绝外企业的会话/引文/知识原件；先撤回A检查B继续可读，再撤回B。隔离工程测试保留55432独立目标、共享锁、空闲队列及非超级/非BYPASS角色校验。证据在`tmp/xiaok-citation-protocol/`及`-a/`、`-b/`，失败和源码漂移批次均留存，不拼接成功率。C01/C02/C05/U01原批准气泡、来源片及失效态消费同一公开回复，未做可见界面修改；原生窗口继续按用户要求暂停。

本轮稳定实模范围：A企业2584／文档295版本299／工地161，B企业2583／文档296版本300／工地162；两边均仅同一9页/74片PDF及各自合成现场记录。A观察为淋浴1500、台盆1000、厨房平行100mm；B为1600、1100、200mm，手册原文相同。A咨询495/499的run886/889/892/895/897/899、B咨询496/498的run885/887/890/893/896/898各为两个独立三轮咨询，不是同咨询连续六轮。20个Agent文件在两企业、逐题和收尾hash完全相同。

首稿分别5/6，合计10/12（83.3%）；唯一一次模型修复后固定检查交付12/12。run886在对照/建议段重提现场数值却漏选对应现场引用；run885另出现可信文件版号前加空格的排版误拦截，且后段也漏现场引用。两次均保留首稿及修复，不是人工改资料，也不能计成首稿通过。未放宽成“整篇出现过的数字即可借用”；原文复制/长短引用模式错误已由统一编号避免，但逐段引用覆盖及名称版号排版仍有Agent缺口。`evaluation.json`仍为passed=false，不能用修复后12/12改写原验收结果。

独立逐段审读全部12条：8条限定可用、4条厨房回答需修改，专业语义整体未通过。run892/899/890/898将原引文没有的电磁干扰、信号、检修或散热机理放在evidence；run890把“未量测”先断成“范围不足”，run898有“唯一能补救干扰”的无据绝对化判断。run899现场100mm的对照段只引另一暗盒100mm规则，数字词面相同不证明该现场主张有正确出处。非厨房回答也保留一般受潮机理、旁支工序及冗长的注意项，不作完整工程认证。自然解释已超出摘录，但结构通过不等于专业质量通过；原稿、最终分段、原引文与逐例意见绑定在`tmp/xiaok-citation-protocol/semantic-review.json`。

隔离9/9：独立身份/项目/原件版本及同一hash校验；本人接口200后，双向会话、引文和知识文档各3次跨企业请求均404；先撤回A，A六答失效而B六答继续可读，再撤回B六答失效。两企业各知识文档仍1份；收尾活动测试员工、run、job、未知job、对客知识均0。原企业2567内部文档293/版本297及旧企业1454来源独立保留，不混入本轮。不会将这组有限探测宣称为所有企业/所有攻击方式的隔离证明。

v73冻结基线工程复核：目录/原文/元数据/数值/预算纯单元75/75；隔离服务30/30（15项真实数据库/Embedding服务及15项重叠纯综合检查，文本模型显式注入）；Mini回复/引用/重进契约73/73；相关记忆/回执纯测44/44，互有重叠不累加。11个相关源码/测试/脚本定向ESLint0错误/0警告；全量类型仍292条既有诊断，本增量及本轮共享Agent文件0条，不称全量通过。更新后的验收包装器记录全部Agent与本批测试/脚本的前后hash，源码漂移使外层失败；以上最终组changedDuringRun为空。独立质量与实模证据另记，不与注入模型/单元混算。原生窗口按用户要求继续暂停，未重跑完整构建或生产发布。

开发中断记录仍保留：首次准备阶段在发现目录身份依赖显示标题后停止新请求，未进入自然问答；同一原索引仅对确定assistant_disabled终态恢复，未重发未知调用或增加文档。后续源码漂移准备组、目录过细触发原预算及混入共享修复的11次问答另存attempt，不能拼接为稳定成功率。此前29/30的缺导入组、旧目录身份失败及过期断言日志保留；没有提高16,000预算或裁掉原文条件。当前目录打包相邻完整行/句、保留80-bit指纹的base64url表示并去重可信规则，以减少纯表示开销。后续按领域交接：Agent路线图负责引用覆盖、名称排版、主张支持/未知保持与表达质量；知识计划负责Evidence/原件/解析检索和版本受众，不通过加手册特例或导入更多资料掩盖Agent缺口。合同变更仍需联合回归。

冻结实模之后的通用守卫收尾单独记账：只读负例证明标题“厚度3.2 mm参数表”可能将正文“厚度3.2可直接施工”误当文档名而免除数值支持。经两任务明确临时交接，仅修改`citation-catalog.ts`及对应测试：可信标签中的数字若后接工程量形态，不作版号；保留PDF/DOCX/XLSX扩展名、正常指南版号和原裸数/单位拒绝。未改模型规则、工具schema、目录/ID或知识服务。最窄8/8、完整纯测75/75及两文件ESLint通过；新hash全量类型仍292条、两文件0条，未将原30/73/44或实模自动重标为新源码运行。

`tmp/xiaok-citation-protocol/v73-a.live.json`／`v73-b.live.json`冻结原始实模报告；`node --import tsx ../tmp/xiaok-citation-protocol/replay-metadata-guard.ts --after`在Admin目录离线重放12首稿和12最终JSON、比较12组模型视图。前后视图hash、10/12首稿接受及12/12最终接受、规范化输出hash完全相同，仅危险负例从错误放行变为拒绝；不重调模型、不写数据库或恢复已撤回访问，不能算一批新的配置实模。前后结果、独立语义及源码/日志hash绑定在`tmp/xiaok-citation-protocol/manifest.json`，守卫工程日志另在`tmp/xiaok-citation-metadata-guard/`。版号排版空格、逐段双来源覆盖和四条语义问题仍归Agent后续，本轮不冒称全部首稿/专业质量通过。

### 数据、解析、核对与发布

- `0086_assistant_source_files`增加一张强制RLS的私有原件表 `assistant_knowledge_assets`，同企业/文档复合外键、SHA256、真实格式、使用许可、实际上传者和不可变bytea。原版本增加 `source_asset_id/source_file` 与发布后不可变约束；解析结构、核对人/时间/排除片段随版本hash保存。原普通条目hash兼容。开发主库及隔离库已应用；迁移/备份证据和恢复边界见本轮交接。
- 解析使用原 `assistant_jobs` 的 `knowledge_parse`，共用管理身份、企业设置锁、并发上限、attempt、租约/取消/原键恢复与原Worker调度。原件先落库，页面关闭后可重进读取任务与结构；相同原键及同草稿相同hash复用结果，不把再次上传变成重复任务。解析失败保留原件，不自动索引/发布；本地已知失败/取消可显式重试，最多3次。旧租约、替换、撤回、操作者撤权均阻止晚到提交。外部Embedding/分块的未知结果协议不变。
- 本地子进程解析：stdin只含获权原件，无任意URL/文件路径或继承凭据，192MB V8堆/20秒/有界输出。文件≤4MB、企业≤100份/100MB、PDF≤50页、结构≤128片、DOCX表≤64行/12列；ZIP检查路径/重复名/加密/嵌入对象、压缩率、解压总量24MB、单项8MB及选取XML的CRC，XML禁止DTD/外部实体并限制深度/节点。没有安装或运行Dify/RAGFlow整平台。
- DOCX保留标题层级、正文段落、表格行/列/合并跨度、原表头、相邻注/例外与脚注。段落编号为正文段落次序；无固定渲染，**不生成页码**。图片、页眉页脚、修订/外链按实际警告核对，不抓外链；嵌套表/复杂容器明确失败。PDF保留实际页码及提取文字顺序，使用本地CMap/字体数据；不运行viewer/脚本/附件。无文字页明确需OCR；PDF表格结构、图示与扫描OCR未实现，不能把可提取文字当作结构理解。
- 后台沿原720px Drawer、Ant Design/Admin Pro与共享反馈，展示原件hash/下载、任务、结构/合并信息/警告、将进入检索的文字、核对与替换入口。文件默认内部受众；需明确核对范围后才允许索引，就绪后仍须有权发布。排除片段只减少独立检索片，原章节/表头/脚注仍可能作为同文件上下文保留。原文修订须上传有出处的新文件，不允许把模型改写或手填正文覆盖原件。第一批未提供任意解析文字改写器。
- 正文仍≤16,000字符/48,000字节。一个原段/表行连同必要原上下文必须能放进≤512-token片；超过时明确失败，不截掉前提/例外。每片保留同版本原表头/章节/脚注、blockId、真实页或表行列、原件hash/解析器、Unicode code point范围；引用回读另返回实际quote范围，重复原句保留歧义计数，不伪造唯一定位。未做通用复杂表/OCR/全格式、自由父子扩展或重排。

### 路由、权限与来源

- 新 `POST /api/assistant/knowledge/documents/import`：title/category/audience/fileName/fileBase64/authorization。原版本路径新增 `POST .../file`、`.../parse`、`.../cancel-parse`、`.../review`，均要求Idempotency-Key与适用expectedEditVersion；review只接受警告确认与排除blockIds，操作者/时间由服务生成。`GET .../original`下载受控二进制附件、no-store/nosniff，无裸存储URL；detail回读parse_job/source_file，原job入口包含解析任务。原index/publish/newVersion/metadata/retire复用。
- 当前管理者三角色仍继承原知识管理授权：选定企业的admin/super_admin无需成为企业员工；enterprise_admin仍需显式知识权限。原件每次读取重验当前企业/文档/版本/身份，撤回后拒绝下载。客户端不能传projectId、任意tenant、原件URL或内部草稿范围扩大权限。此接口管理企业资料；获权项目原件仍由原业务适配器守护，不通过知识分类倒推项目/私聊读取权。
- 普通客户只检索已核对、已索引、有效发布的customer_public版本；草稿/内部与本人管理试问边界不变。file元数据随实际工具证据到原模型，包含原件与结构定位，不包含私有许可备注/上传凭据。历史、引用、模型提交及工地上下文继续重验epoch、有效版本/hash/profile/受众/参与者；换版/收紧/撤回令派生解释失效。
- prompt `xiaok-renovation-v32`补充文件原段/表头/单位/脚注、合成示例身份、每段数字须由该段quote支持等规则；不放宽原正式状态、引用、用量、未知调用与人工接管守卫。模型解释/翻译/推断永不成为原文依据，普通说明不创建事项、施工安排或验收决定。
- 配置模型实跑暴露两种表面格式：advice/uncertainty省略空引用数组，以及“当前资料不支持‘已经验收’这个结论”这类明确否定句。只对模型解释做窄规范化：非依据段落缺省空数组，后者改为“当前证据不能支持该结论”。原文quote不改、依据段仍必须有有效引用、肯定式完成状态与同句夹带的完成宣称仍被原守卫拒绝；原模型checkpoint与规范化回答均留存。短文件工具另给完整有界citationQuote，帮助同段保留数值/单位/条件，未自动扩写模型引用。正式状态追问必须刷新获权工地依据；不强制给一个没有文件规则宣称的纯状态判断附无关知识引用。
- 文件引文/分段数值支持错误可在原LangGraph内做**一次**格式修复，沿原4轮总预算/截止时间/用量/租约。只有结果已明确返回且当前获权文件存在时进入；真正的正式完成/价格承诺、权限/来源变化和未知外部调用不修复/不重发。修复轮仅提供final_response，禁止业务工具；仍用原来源和完整验证，失败即终止。validationRepairs随原checkpoint持久化，原模型结果/校验反馈/修复用量可审计，无新会话、用户消息、任务或框架checkpointer。不得把有修复的服务闭环说成单次模型全对。
- 小程序设计映射：唯一chat台账源 `design-references/xiaok-p4b-public-sites-v1/README.md`继承C01/C02/U01。仅在原来源片版本说明之后复用 `.sheet-helper`（26rpx/1.6行高/原8–22rpx间距）显示文件名/真实定位，原来源标题30rpx、quote28rpx及其24rpx内距不变；无新页面/样式/图标/插画/导航。PPT6/15支持连续问答，18/19支持阶段/材料解释，23/38支持对应资料与缺失先核实；合成表数值并非PPT规定或真实工程标准。

### XLSX有界扩展

当前时刻扩展（`time-v1`，优先于下文旧批次“时间未支持”的记录）：复用原无凭据解析子进程、资料核对/索引/发布和C01来源片，不增加依赖、迁移、API、角色或小程序可见组件。支持内置20/21及明确的`h:mm`/`hh:mm`整分钟、`h:mm:ss`/`hh:mm:ss`，或原完整年月日格式后以一个空格接时刻。时刻序列最多17位有效数字，保留原始十进制值/格式；秒按十进制半入舍入，分钟格式只接受舍入后的整分钟。纯时刻限`0≤serial<1`，不能隐去整日；跨午夜舍入、累计`[h]`、AM/PM、小数秒、区域短日期/格式和伪时区后缀明确失败。日期时刻继续按1900/1904日历转换，拒绝虚构1900-02-29；原date-v1纯日期仍拒绝隐藏小数时刻，不推断时区、排期、到场或检查结果。

解析器当前为`xiaok-file-v2:xlsx:yauzl3.4.0:saxes6.0.0:decimal-v1:date-v1:time-v1`。`numberFormat={raw,id,code,dateSystem?}`沿用，dateSystem仅用于有日期部分的值，纯时刻不补日期系统或日期。原720px Drawer只更新既有说明/警告文案并复用原值/格式行，布局、Ant Design/Admin Pro、共享反馈、已发布只读和四屏V1待审边界保持；旧解析/hash不改写。表头、例外、Unicode范围、租户/受众/版本/epoch、幂等、租约、撤权和用量保持，复杂结构/OCR仍未交付。

实模首试run722正确引用日期时刻，但“24小时制”中的24被原数值校验误拒。现仅在同段已验证的time-v1 XLSX原时刻引文存在时，将这个格式名称从数值集合检查中区分；不改输出原文/引文，不许可额外24小时时限、工程数值或正式承诺，其他来源/无引用不能使用该例外。沿原完整来源和提交/历史撤权校验，无新循环、调用或预算。纯测试覆盖无文件/旧解析/不同格式/无时刻引文、无引用建议、额外数值/期限和验收承诺的拒绝。

2026-10-19复核[Microsoft数字格式](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.numberingformat)、[SheetJS时刻实现](https://github.com/SheetJS/ssf/blob/master/ssf.md)与[日期夹具](https://github.com/SheetJS/ssf/blob/master/test/date.json)，只采用显式格式、分钟/秒含义及有限日期边界，不引入SSF或计算引擎。另核对[LangChain结构输出](https://docs.langchain.com/oss/javascript/langchain/structured-output)、[LangGraph结构/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[DeepSeek JSON边界](https://api-docs.deepseek.com/guides/json_mode)：结构有效不替代本项目的引用/数值/权限复验。未运行上游整套测试，不泛化为供应商补丁或迁移Agent框架。

当前时刻验证：`node scripts/assistant-source-file-acceptance.mjs --time-formats --unit --projection`为55/55（含原50项；不叠加为独立覆盖），`--mini`为73/73。全量ESLint0错误/30条既有警告，最终9个受影响文件另跑ESLint0错误/0警告；`--types`仍292条仓库诊断，受影响文件0条。无路由/Schema变化，未新跑完整构建，历史完整构建阻断不升级为通过。隔离文件服务最终21/21通过（含原DOCX/PDF、两日期系统的真实时刻写入/发布/条件引用/历史撤权和失败保留）；同一命令加`--wait-for-lock`，结果保存在`tmp/xiaok-kb2-time-formats/service-status.json`；首轮20/21的失败为测试把同片两句误当单一摘录，已修正为选择时间与同片例外并核对持久连续引文，原日志保留为`service-attempt-1.log`，不能把旧失败算通过。

配置实模/真实HTTP/原Worker：`node --import tsx scripts/assistant-source-file-development.ts --development --time-formats --fresh-rounds --evidence=xiaok-kb2-time-rounds`。完整两表/七片XLSX加原PDF；企业2565/负责人5240/客户3577/线索3017/工地159，咨询446/447各执行一轮三题。v69/v7，run737–742两轮6/6通过，12次有实际用量的文本模型调用、无校验修复，耗时18,692/17,887/17,004及13,710/14,964/28,725ms（含队列，非容量基准）。逐轮对照日期2026-10-19 09:30:00、纯时刻13:30:00、合成范围/地暖例外及当前防水事实；不推断时区/实际安排或验收。两咨询持久重进/受众收紧使派生回答失效、已发布原文禁止改写、无施工处理副作用通过；活动管理者/运行最终0。峰值估算15,992/硬预算16,000，18条用量费用仍未知，不填零。正文仍有多余电话/缺项及建议，完整专业语义未验收。证据`tmp/xiaok-kb2-time-rounds/live.json`。

以上是两个独立三轮咨询，不是同一咨询连续六轮验收。原同咨询复跑run728–730通过，第二轮run731触发`agent_input_limit`，证据独立保留在`tmp/xiaok-kb2-time-formats-final/live.json`；run722误拒也保留在`tmp/xiaok-kb2-time-formats/live.json`。没有提高硬预算、截断条件或把这些失败混入最终6/6，更长上下文仍Limited。认证Chrome原超级管理员对合成企业2561/文档287/版本291核对[时刻/原序列/1904系统](../tmp/xiaok-kb2-time-formats/chrome-time-provenance.png)，刷新重开仍可读；原件由真实HTTP导入，浏览器文件选择未验。临时标签及选择已恢复；原生窗口继续遵守用户明确暂停，旧原生结果不升级。真机/真实微信、完整宿主/高屏/键盘、生产兼容/恢复及部署均未获新验证，整体Limited、未生产发布。

日期与显示边界参照[Microsoft日期系统](https://support.microsoft.com/en-us/excel/date-systems-in-excel)及[SpreadsheetML数字格式/区域差异](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/17d11129-219b-4e2c-88db-45844d21e528)（2026-10-19核对）；只采用明确日期系统和显式格式，不安装整套表格计算或Agent框架。

明确年月日增量（`date-v1`）：原无凭据解析子进程、上传/核对/索引/发布、原件下载与C01引用链路复用，无新依赖、迁移、API或角色。自定义格式仅接受`yyyy`加完整月日（`m/mm`、`d/dd`，相同`-`、`/`或`.`分隔），或明确双引号的`yyyy"年"m"月"d"日"`（月/日允许补零）；按工作簿`workbookPr.date1904`的0/1/false/true确定1900/1904系统，缺省1900。十进制整日运算后以UTC生成日历文字，不依赖主机时区。1900范围1–2958465且拒绝虚构序列60；1904范围0–2957003。时间/小数日期、两位年份/缺年月日、内置区域短日期、无效系统标记/重复属性节点和范围外序列失败，原件/失败任务保留，不把底层序列或公式缓存当显示日期。 仅对数字序列按显式格式转换，General数值不推断日期，ISO日期单元格`t=d`仍未接入。

日期首版解析器为`xiaok-file-v2:xlsx:yauzl3.4.0:saxes6.0.0:decimal-v1:date-v1`；格式化日期的`FileBlock.cells[].numberFormat`保留`raw/id/code/dateSystem`，其中dateSystem仅为日期增加的可选字段，旧数字/历史版本兼容。原720px Drawer的说明、警告和元数据行展示显示值、原序列及系统，核对后仍须索引和明确发布；原表头/单位/例外、工作表/范围、Unicode引用及重进撤权保持。日期只是源资料文字，不确认真实排期、到场或检查。Mini继续采用C01唯一批准来源片和失效态，无WXML/Less/资产/导航变更。

实模暴露现有请求预算下文件复制提示重复计入上下文的问题。`current-turn-sources-v7`只扩展已有模型投影，保留每份完整`text`、sourceId和可读定位；重复引文提示及assetId/sourceHash/parser/blockId保留在原持久结果和服务端复验。XLSX标准定位文字已明确工作表/范围/行号时，不再重复发送相同坐标、连续列、相同章节/文件名及可由文件名和标准行定位确定的格式/行类型；自定义或不重复的定位字段保留。旧摘录编号可通过`selectionLines`引用原文中的精确位置（行号从1开始，句内为`[行号,UTF16起点,终点)`）；歧义/重复跨度、FAQ问题、额外字段、重复编号或不匹配来源均保留原摘录，只在数据确实更小时采用。服务端仍从完整原始摘录列表解析选择，绝不以模型偏移执行写入。投影前指纹包含完整身份和不可变文件chunk ID，不合并不同hash/版本/片；不截来源/条件、不扩大预算、不修改工具配对或checkpoint、不增加重试循环，提交/历史/撤权复验保持。沿[LangChain完整消息与工具配对规则](https://docs.langchain.com/oss/javascript/langchain/short-term-memory)及[LangGraph工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)的既有聚焦投影增量修复，无框架迁移；更大上下文与修复余量仍Limited。

当前完整工作簿验证用原开发脚本加`--date-formats --multiblock --evidence=xiaok-kb3-multiblock`：两张表/七个解析片及原PDF，企业2560/负责人5237/客户3572/线索3014/工地156/咨询441。run716–721将三道指定题各跑两轮，6/6通过；v68配v7投影、十二次有实测用量的文本模型调用、无校验修复，耗时29,781/31,852/32,509及26,960/25,504/27,179ms（含队列，非容量基准）。原显示日期、合成身份/地暖条件、真实防水上下文、引用/历史重进、受众撤权、已发布原文禁止改写及无处理副作用通过；最终活动员工/运行0。应用估算峰值15,971、硬预算仍16,000，余量很窄，不等于任意更大上下文或修复验收。独立逐轮正文复核保留多余节点/电话/建议及个别缺项措辞未逐句限定范围的问题，完整专业语义未验收；实际用量和未知费用保留。证据在`tmp/xiaok-kb3-multiblock/live.json`及`semantic-review.json`。原run678和本批首次run715的预算失败独立保留；一次隔离测试中断只留下已识别合成夹具，独占锁在下次派发前拒绝了非空队列，确认进程/目标后仅用既有清理服务移除该两企业/两用户，不把中断算通过。

聚焦合同复跑：`node scripts/assistant-source-file-acceptance.mjs --unit --projection --evidence=xiaok-kb3-multiblock`（50/50）。已执行的原`--synthesis`综合/权限回归27/27，其中12项隔离服务及15项已包含在50项内的综合纯测试；新增`--synthesis --projection`单项另跑1/1，覆盖旧摘录选择的持久写入、引用/历史重进及撤回，使用真实隔离库/Embedding与显式注入确定性模型。默认综合套件现也包含新增项，重叠总数不相加为独立覆盖。下段日期基线保留自身精简夹具和结果，不能代替完整工作簿证据；原Admin/C01组件及来源路由保持，原生窗口仍按用户明确选择暂停操作。

当前工程检查：全量ESLint 0错误/30条既有警告；全量TypeScript仍有292条仓库诊断，本增量受影响文件0条，新增测试的联合类型断言已修正并复核。隔离当前工作区快照Webpack编译83秒成功，完整构建随后停在既有`ai-studio/designer/page`的`AiDesignerLegacyPage`额外导出类型错误；未跳过检查，原开发`.next`/配置保留。日志及status在`tmp/xiaok-kb3-multiblock/`，编译成功不等于完整类型/构建或发布验收通过。

日期复跑：`node scripts/assistant-source-file-acceptance.mjs --date-formats`，加`--unit|--regression|--mini|--lint|--types`或`--evidence=xiaok-…`；真实HTTP/Worker/配置模型用`node --import tsx scripts/assistant-source-file-development.ts --development --date-formats`。日期纯合同27/27（与聚焦48/48重叠）、文件服务19/19、原知识/权限回归38通过/4历史可选实模跳过、Mini确定性73/73通过。服务夹具覆盖两日期系统、真实核对发布/检索、原件/历史引用/受众失效及无效日期保留失败；聚焦48项含原synthesis/预算协议回归。实模采用独立精简两行1904合成表和原PDF，企业2550/负责人5235/客户3562/工地154/咨询431；run684/685/686和688/689/690两轮6/6通过，v68、各两次实际模型调用且无校验修复，耗时18,826/20,550/24,105及51,660/33,502/27,851ms（含队列，非容量基准）。逐轮核对原显示年月日、合成范围/地暖例外、获权防水节点及无检查记录不证明验收；一般建议和少量多余电话/资料说明仍存在，完整专业客服未验收。受众收紧使原引用和派生回答失效，已发布原文不可改写，无施工处理副作用；夹具最终活动管理者/运行0。原usage/attempt保留实际调用及未知费用，不填零。证据`tmp/xiaok-kb2-date-formats/live.json`；此前隧道中断和多片/精简表预算失败均独立保留，不混入最终6次通过，也不把精简表通过扩大为任意多片可用。

Chrome原超级管理员在合成企业2546、原720px Drawer核对已发布资料、显示值2026-10-19/2026年10月20日、原序列44852/44853、1904系统及A3:D3，刷新重进仍可读取，截图为[日期出处](../tmp/xiaok-kb2-date-formats/chrome-date-provenance.jpg)。本轮原件仍由真实HTTP导入，浏览器文件选择未验证。Stable启动自动恢复旧项目窗口后形成两个同项目窗口；按AGENTS要求询问后，用户明确选择“暂不操作窗口，先完成其他开发验证”，因此日期原生验证暂停，未关闭/重启/继续控制窗口，不升级历史数字原生9/9。真机/真实微信/BLE、完整宿主/高屏/键盘仍未验证，非生产发布。

最终工程检查：ESLint 0错误/30条既有警告；全量TypeScript仍有292条诊断，本轮受影响文件0条，不能作为完整类型通过。独立当前工作区快照的Webpack编译91秒成功，完整构建随后被既有`ai-studio/designer/page`额外导出`AiDesignerLegacyPage`的类型错误阻断；未修改无关页面或跳过检查，原开发`.next`/配置保留。证据为`tmp/xiaok-kb2-date-formats/{unit,service,regression,mini,lint,types,build}.log`及对应status，完整构建不是发布验收。设计源仍为原双语Admin合同与C01台账；未新增视觉方向或小程序还原。

既有数字显示（`decimal-v1`，日期范围以本节date-v1为准）：复用原件→解析/核对→索引→发布→C01原片，不增加格式迁移、供应商或依赖。支持内置0/1/2/3/4/9/10及有界自定义固定小数（最多6位）、千位分隔、百分比、最多12位整数补零和双引号/反斜线明确的前后缀/单位；文本`@`仅用于文本。格式化数值最多15位有效数字，指数范围±308；时间/区域短日期、科学计数显示、分数、缩放逗号、颜色/条件/多段/区域/隐藏格式、非零负数舍入到0及有歧义的继承明确失败。单元格、启用的行样式、列样式及清楚的基础样式按原优先级读取，不猜未支持显示。

数字显示首版解析器标记为`xiaok-file-v2:xlsx:yauzl3.4.0:saxes6.0.0:decimal-v1`，其历史验证如下。十进制整数运算保留原显示精度与百分比缩放；例如原`0.125`/`0.00%`进入引用为`12.50%`，原`2.345`/`0.00" mm"`为`2.35 mm`。`FileBlock.cells[].numberFormat={raw,id,code}`仅作原结构核对出处，模型证据和Unicode引用仍沿显示文字、原表头/单位/注/例外；不把底层值混入回答片段，也不改写历史已发布解析/hash。后台沿原说明、警告、元数据行和共享反馈展示范围及出处，未新增Mini可见组件。

本批命令：`node scripts/assistant-source-file-acceptance.mjs --number-formats`，可加`--unit|--regression|--mini|--lint|--types`及`--evidence=xiaok-…`；实模为`node --import tsx scripts/assistant-source-file-development.ts --development --number-formats`，原生加`--native`。当前纯合同22/22、文件服务17/17、知识/权限回归38通过/4历史可选实模跳过、配置实模两轮6/6、Stable原生9/9（2次真实模型回答）通过。实模企业2531/客户3525/工地144/咨询399，原生企业2533/客户3530/工地146/咨询402；运行时v64，8次最终回答不等于全部供应商调用数。实模run620/621/622与624/626/627耗时42,804/31,406/33,496及55,187/32,389/32,040ms；原生632/633为111,147/23,833ms，包含实际队列等待，不当性能基准。逐句核对显示值、地暖例外、合成身份和无检查记录不代表验收；部分回复仍追加无关点位图/电话说明，完整专业客服仍Limited。每次调用/修复/未知用量以实际步骤与usage记录为准，不填未知费用。SDK0.13.0/Stable2.02.2608080/基础库3.17.2、逻辑390×844、PNG348×752分记；精确C01路由、真实输入/发送/来源展开、持久重进与撤回重进完成，[数字原片](../tmp/xiaok-kb2-number-formats/native-citation.png)可见显示值和原工作表/范围，原会话/传输已恢复。当前Chrome原值/格式核对、类型及隔离编译/完整构建限制统一见上述KB-4本批记录，不把原生9项扩大成全格式/完整宿主/真机或生产验收。

- `0088_assistant_spreadsheet_sources`只扩充原件及版本JSON的格式CHECK，不增加表、角色、API、任务或发布通道；原RLS、原件/发布版本不可变、幂等、租约与撤回边界复用。`source_file.format`增加`xlsx`，原`FileBlock/FileLocator`增加可选`sheet/range`，单元格增加原`ref/rowSpan`。DOCX/PDF旧定位不改；XLSX按真实工作表/行/范围定位，不冒充Excel命名表或生成打印页码。
- 在原192MB/20秒无凭据子进程中复用固定yauzl/saxes、ZIP/XML/CRC及总文字预算，无新依赖或资料外传。Next standalone tracing显式保留原解析器及新增`assistant-xlsx-parser.mjs`，Docker仍复制原scripts目录；这不等于生产镜像兼容验收。最多8张表、每张A1:L64、全文件128片。支持共享字符串、富文本/行内字符串、General及下述有界格式数值与布尔值；保留稀疏坐标、合并跨度和续行的原锚点。完整宽度合并标题作为原章节，首个非标题行及其纵向合并续行作为待核对表头；注/说明/备注/例外/前提行作为同一工作表必要上下文，不能跨表拼接条件。排除独立注块不会移除其他行所需原注；条件连同原行超512 tokens时明确失败。
- 范围限常规UTF-8 OOXML包。公式（含共享公式/缓存结果）、时间/区域短日期、条件/多段/区域数字格式及有歧义的样式继承、隐藏表/行/列及零高度/宽度、批注、连接/透视/结构化表、未支持的SpreadsheetML编码转义文字与复杂结构明确失败，保留原件和任务供核对/替换，不执行公式或丢弃后假称成功；明确完整年月日仅限上述date-v1。共享字符串/样式必须与工作簿关系一致，不能把游离XML当原表来源；XML属性按命名空间读取，未知前缀的同名属性不能覆盖单元格坐标、工作表关系或Word属性。图示/外链/筛选/字体颜色与打印布局按警告核对，不抓外链；旧XLS/XLSM不支持。
- 后台设计源仍为双语Admin UI合同、原720px Drawer/Ant Design/Admin Pro、文件核对组件及共享反馈；只在原选择器、说明、结构定位和失败反馈中增加XLSX范围，不新设计页面。C01使用原来源片`.sheet-helper`显示文件名和工作表/单元格范围；未修改小程序标记、样式、资产、导航、Agent prompt或检索配置。
- 采用Microsoft官方[SpreadsheetML结构与关系](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/structure-of-a-spreadsheetml-document)、[共享字符串](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table)、[数字格式](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.numberingformat)及[公式/缓存值合同](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-formulas)，2026-10-19核对。只借鉴原始包、坐标、数字格式和缓存非实时的事实，不迁移Agent/知识框架；范围外复杂Excel显示值/公式求值仍未实现。
- 复跑：`node scripts/assistant-source-file-acceptance.mjs --xlsx`（共享锁、批准55432隔离库、真实Embedding、确定性模型，含原DOCX/PDF与XLSX服务）；`--unit`、`--regression`、`--mini`、`--lint`，需排队可加`--wait-for-lock`。迁移/RLS核验`node scripts/assistant-source-file-migration-check.mjs --xlsx`。实模/HTTP/Worker为`node --import tsx scripts/assistant-source-file-development.ts --development --xlsx`，加`--native`沿Stable原项目/副屏/新编译/真实输入点击。明确合成双工作表数值/单位/地暖例外和原PDF/防水事实，原问题及连续追问不变；证据单独放`tmp/xiaok-kb2-xlsx/`，执行与未覆盖状态以下述当前记录为准。
- 当前检查：纯合同16/16（原6项＋XLSX10项），最终隔离文件服务16/16（DOCX/PDF8＋XLSX8），原知识/回答/专业检索/平台权限回归38通过、4项历史可选实模跳过，小程序73/73。使用共享锁与非superuser/non-BYPASSRLS角色，不与其他隔离验收并行改库。0088两库迁移/hash/格式CHECK/强制RLS通过，迁移前主库15,205,315字节和隔离库8,188,026字节custom备份通过PGDMP/目录核验，ACL仅当前用户/SYSTEM/Administrators；完整0088恢复和生产兼容仍未验证。全量ESLint0错误/30条既有警告；本批相关文件0错误/0警告。同源类型对照287→287，无新增/本批诊断；隔离Webpack构建66秒编译成功，完整构建仍被原`AiDesignerLegacyPage`额外导出的类型错误阻断。
- 最终配置实模为v62：企业2530/负责人5207/客户3524/工地143/咨询398，XLSX版本258、PDF259，原件hash`0bb58d30…`。run614/615/616和617/618/619两轮分别29,419/32,738/32,293和32,328/31,334/37,606ms，6/6本批断言通过；逐条对照原表和防水实际节点，正确解释2＋mm、地暖例外、示例身份及无检查结果不能确认验收。每轮为两次实际模型调用＋一次query_embedding记录，无验证修复；embedding token及所有费用仍有未知，不填零。部分回复仍夹带无关点位图/电话缺项，完整专业客服仍Limited。初版精简包`e05aff0f…`补齐OPC ContentTypes后原表内容不变；先前v61的6轮597/598/600/602/603/604保存在`live-initial-v61.json`，没有冒充最终v62验证。最终6轮＋原生2轮为当前8轮，连同初版共14轮最终回答，不能把回答轮数当全部模型/索引供应商调用数；也不是全量Excel兼容验收。
- Stable原生9/9：企业2529/负责人5206/客户3523/工地142/咨询397，XLSX版本256、PDF257，服务端v62；run612/613分别39,954/31,458ms、2/2本批断言通过且无验证修复。SDK0.13.0/基础库3.17.2、逻辑390×844，截图348×752；每次核对顶层`packages/assistant/chat/chat`，真实输入/发送/原引用展开、持久重进和撤回重进均完成，原`.sheet-helper`及段落内2/mm/例外在[native-citation.png](../tmp/xiaok-kb2-xlsx/native-citation.png)可见，无Mini标记/样式/还原源变更。前三次准备失败分别为跳转前过早断言旧路由、其他SDK连接占用及等待该连接超时，保留`native-attempt-{1,2,3}*.json`；改为等待目标路由、保留拍摄前精确断言，并等原控制器自行断开后新编译复跑，没有抢占或重开项目。所有本批实模夹具最终活动管理者/运行均0，无施工处理副作用，临时传输/会话恢复。
- Chrome合成企业2523/负责人5196、文档249/版本251，原720px Drawer显示真实7片/工作表/行列/合并与限制，保存核对、真实索引、内部发布、只读与刷新重进已验证。原件经真实createFile服务导入；浏览器文件选择触发后setFiles被扩展file URL权限拒绝，上传这一步未通过，未改扩展权限。浏览器高层鼠标调用未触发状态切换，后续用同一标签已确认DOM控件的CDP正常点击/键盘事件完成，不宣称物理鼠标验收。截图：[发布](../tmp/xiaok-kb2-xlsx/chrome-published.jpg)、[原文行列](../tmp/xiaok-kb2-xlsx/chrome-source-row.jpg)，`chrome-fixture.json`保存真实服务回读，账号验后停用。核对为合成运营操作，非人类专业批准；真实账号、完整宿主/高屏/键盘、真机/真实微信/BLE及全格式仍未验证，整体Limited、未生产部署。

### 采用、复跑与边界

解析器固定 `pdfjs-dist6.4.299`（Apache-2.0）、`yauzl3.4.0`（MIT）、`saxes6.0.0`（ISC）；保留原共享canvas1.0.7，PDF.js所需新canvas隔离在其依赖下。Node≥22.13，Docker构建文件使用24，未构建/部署生产镜像。参考[PDF.js API测试](https://github.com/mozilla/pdf.js/blob/master/test/unit/api_spec.js)、[官方分层API](https://mozilla.github.io/pdf.js/getting_started/)、[2026脚本安全公告](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j)、[yauzl资源与惰性读取](https://github.com/thejoshwolfe/yauzl)、[saxes](https://github.com/lddubeau/saxes)及[RAGFlow解析集成测试](https://github.com/infiniflow/ragflow/blob/main/internal/deepdoc/parser/pdf/parser_pipeline_integration_test.go)。采用本地有界结构提取与分层测试；保持当前PostgreSQL/pgvector、硬授权、LangGraph及持久任务，无框架迁移或新资料外传。生产镜像兼容、全量恢复、PDF复杂排版/OCR、XLSX时间/区域短日期/公式、复杂数字格式、隐藏和复杂结构、旧格式、任意段落语义归因及完整专业客服仍Limited/未验证。

另核对已安装LangGraph1.5.0及维护中的[ToolNode](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/prebuilt/tool_node.ts)/[对应测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)，并查[DeepSeek函数调用协议](https://api-docs.deepseek.com/guides/function_calling)。继续使用标准工具消息和原数据库恢复边界，不另造重试Agent或把所有错误交给框架重放。上述两项规范化是本配置实跑观察后的本地格式适配，不宣称是上游框架规则，也不把供应商文档例子当本项目语义质量证据。

从admin复跑：`node scripts/assistant-source-file-acceptance.mjs`（真实隔离数据库/Embedding，确定性模型）；`--unit`、`--regression`、`--synthesis`、`--mini`、`--lint`、`--types`。实模/真实HTTP/Worker：`node --import tsx scripts/assistant-source-file-development.ts --development`，加 `--native` 使用既有Stable流程。固定核心为合成DOCX材料行/单位/地暖例外、连续追问、中文文字PDF检查安排（另有英文页解析单元）与当前获权防水节点，每题两轮；不是规范级工程认证。实际结果、失败尝试、语义核对、原生/构建未测项与Git状态写入交接及 `tmp/xiaok-kb2/`，不将测试工具/模拟模型混为实模通过。

## 当前 KB-1：专业条目、适用条件与检索诊断（限定闭环，整体 Limited）

本批沿企业知识库专项 KB-1，使用原正文/FAQ、后台 `/assistant-knowledge` 和原 C01 聊天。没有新聊天入口或文件导入。PPT6/15的生活语言与连续追问、18的实际阶段/施工检查安排、19的铺贴前材料沟通、23的底盒/需求/图纸关联和38的缺失/不一致先核实，是本批场景来源；具体办公、铺砖前提、地暖材料与互斥规则题为标记合成验收题，不声称PPT原文包含这些专业规定，也不等于完整PPT19审美沟通或全PPT验收。

### 数据、写入与界面

- `0085_assistant_professional_knowledge`在既有 `assistant_knowledge_versions` 增加可空 `professional` JSONB、粗粒度形状约束和发布后不可变触发器；无新业务表/权限/菜单。原无专业元数据的版本/hash/索引继续有效。Drizzle Schema、journal和迁移核验脚本同步；`.gitattributes`仅固定0085为LF，保证Windows检出后仍保留已应用SQL的hash，不重写历史迁移。开发主库与55432隔离库已应用；迁移前备份/归档目录通过，完整0085恢复演练仍未验证，不据此升级生产状态。
- 原文档 create/edit API新增 `professional`：专业类型、主题/同义表达、最多8个 `stage/room/material/city` 的 `in/not_in` 条件、前置要求、例外、出处名称/版本/实际章节、依据性质，以及可选的互斥规则主题/明确口径。服务端拒绝未知字段、空值、重复条件和超限数据；不把分类当权限。依据性质仅区分企业规则、厂家资料与参考解释，不按性质/上传时间自动裁定优先级。
- 审校备注留在内部版本数据；实际保存操作者与时间由服务端生成，不接受客户端冒认。复制新草稿保留原审校出处，编辑时记录本次实际保存者；这是维护留痕，不是工程认证。专业元数据纳入不可变内容hash；公开条件、前置/例外和出处进入实际分块正文，内部审校备注不进入Embedding文本、客户回答或公开来源投影。引用继续使用Unicode code point定位，不伪造PDF页码或文件解析结果。
- 原720px知识Drawer以现有Ant Design表单/折叠区域维护专业字段，仍走保存→索引→就绪→发布、共享成功/失败反馈及输入保留。正文/FAQ与专业说明合计仍受16,000字符/48,000字节上限约束；专业JSON另有限额。发布版本只读，新稿或索引失败不影响有效旧版；未来生效稿不能提前替换现行发布指针。未来首次发布仍按有效期不参与当前检索，不提供定时切换服务。

### 专业检索、条件与失效

- `retrieveKnowledge`成为原Agent、保守摘录包装器和后台诊断的同一检索路径：既有1024维Qwen profile、先硬授权、每路最多30候选、RRF k=60、相关度下限0.3、最多5条。未接BM25、额外重排、父子分块、OCR或新向量库。专业主题随正文索引；没有新增客户端/模型任意过滤器，不能覆盖租户、受众、发布、profile、有效期或来源撤回。
- 专业证据附来源版本/hash、类型、条件和服务端适用结果：`applicable`仅表示登记的结构条件匹配，前置检查/例外仍待业务核实；`unknown`明确缺少哪些条件；`not_applicable`保留不匹配原因，用于解释不能套用。缺项不硬筛掉一般知识，也不表示现实不存在。原摘录执行器排除明确不适用条目；生成式Agent可解释其不适用原因，不得据此下当前项目施工指令。
- 当前只自动核对绑定房屋、唯一获权活动项目的实际阶段，复用 `customerProjects/currentStage/readStageSettings`。未绑定/后台试问不自动选项目；房间、材料/型号、城市本批保留未知，不从提问/模型或同名房间猜事实。项目阶段/访问变化重新核对证据上下文；原业务快照继续核对正式户型、发布记录、成员/同意及版本。内部的实际阶段删除保护仍由施工服务负责，知识模块不绕过。
- 同一已登记规则主题出现不同明确口径、且适用范围可能重叠时，服务端标记冲突并要求综合回答首段待核实，保留双方来源，不择较新上传/高分条目当企业口径。明确不适用的口径不制造同一现场的冲突。这个合同只识别登记的互斥口径和既有明确冲突标记，不声称完成自由文本语义矛盾检测。
- prompt `xiaok-renovation-v26`在原LangGraph循环里解释条件、前置/例外、一般建议与实际事实，保留工具消息、当前原话与原咨询。专业说明不会自动建施工事项、批准、通知、验收或关闭。所有实际提供给模型的专业依据及项目快照仍在最终提交/继续/历史/引用/接续包重验；换版、到期、受众/撤回、实际阶段或参与权限变化使相关派生解释失效。新增字段不放宽原用量、租约、未知调用及人工接管协议。

### 有界专业词形与完整代号检索

- 统一检索保留查询侧 `renovation-terms-v1`。四组词形限于瓷砖胶/粘结剂/黏结剂/粘合剂、闭水/蓄水试验或测试、等电位联结/连接和刮/批腻子；它们只提供检索表达，不裁定工程等效或实际适用。背胶、填缝材料、水压试验、材料等级/数值不因此互换。原签约意图继续兼容。
- 只对完整符合语法的显式C1/C2及T/E/S1/S2代号规范空格和全角写法；先读取整个ASCII代号再校验，未知后缀、厂家型号、连字符或数值不会截成较低等级。原问题仍原样做一次Embedding，原词权重3、普通扩展1、既有签约意图3；最多8条有效规则/64个新增词。SQL候选和内存融合共用权重，不更改分块、1024维profile、原索引或内容hash，不新增模型调用、外部服务、任务表或迁移。
- 原 `knowledge.search.v1` trace增加扩展版本、实际命中表达、增补词和权重；本人后台试问诊断继续逐次重验企业、会话、epoch、版本/hash/profile、受众、有效期及实际条件。C01沿原聊天/来源片/错误恢复/历史重进，型号出现在提问中仍不能证明现场材料或项目适用；没有新增UI、API、菜单、权限、正式施工写入或发布操作。
- 2026-10-19核对[Haystack QueryExpander实现](https://raw.githubusercontent.com/deepset-ai/haystack/main/haystack/components/query/query_expander.py)及[对应测试](https://raw.githubusercontent.com/deepset-ai/haystack/main/test/components/query/test_query_expander.py)，采用保留原问题、数量上限、去重和失败回到原查询的测试思路；本项目缺口可由可审计本地词形表解决，未引入其LLM扩写、Python依赖或额外模型调用。供应商JSON空内容/截断仍遵守既有恢复合同，不扩大为框架结论。
- 可复跑：后台原链路 `node --import tsx scripts/assistant-professional-admin-acceptance.ts --development`；C01限定术语链 `node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development --terminology`，加 `--native` 复用Stable原项目/副屏/新编译、真实输入点击和路由核对。服务回归仍走 `node scripts/assistant-professional-acceptance.mjs` 的隔离库互斥，不抢占其他验收。合成夹具/原生证据位于 `tmp/xiaok-kb1/` 和 `tmp/xiaok-kb1-terminology/`；不导入真实客户资料，不将自动化冒烟视为完整业务或生产验收。
- 本轮增量检查：相关纯测试45/45；真实后台HTTP 17/17，覆盖直接词形/完整代号检索、资料索引发布、真实模型与来源重进、`enterprise_admin/admin/super_admin`继承、其他管理者试问与跨选定企业来源拒绝、受众撤回和普通员工拒绝。后台合成企业2507/对照2508、负责人5163、临时平台管理者5164/5165及实际请求/诊断见 `tmp/xiaok-kb1/admin-http.json`；临时管理者均在结束时禁用。
- 隔离专业套件14/14（10项真实隔离服务、4项纯合同）通过：真实Qwen索引/检索、SQL与内存权重排序、三角色继承、跨企业/内部资料排除、换版/未来稿、实际阶段、重进诊断和Embedding期间撤回均已执行。摘录模型在该套件中为确定性注入，不能冒充真实模型语义验收；真实模型另见上述HTTP及原生记录。前两次因其他施工接续验收占用而按互斥退出，释放后正常完成；日志及状态为 `tmp/xiaok-kb1/service.log`、`service-status.json`。全量ESLint为0错误/30条既有警告，最终修改文件为0错误/0警告；保留其他工作区改动、仅在内存还原本批文件的类型对照为364→364，新增0、受影响文件诊断0，不声称全库类型检查或生产构建通过。双语计划/模块/合同及本地链接、`git diff --check`同步核对。
- Stable原生9/9、真实模型2轮（run542/544）通过：企业2505、负责人5159，两个词形引用同一原版本220，内部同词资料未进入候选；真实输入/发送、引用点击、导航重进及来源撤回使两轮回答不可用均已执行。路由均核对为 `packages/assistant/chat/chat`，SDK0.13.0/基础库3.17.2、逻辑390×844；编码截图348×752，证据 `tmp/xiaok-kb1-terminology/native-{office,citation,followup,withdrawn}.png`。会话传输覆盖已恢复，测试企业禁用，活动管理者/运行均0，无施工处理副作用。首次CDP鼠标编译超时改为同一已核实按钮的DOM点击；第二次断言误要求对模型已提供的规范词重复增补，已改为核对原问题/完整代号并补后台直接查询。失败尝试另存 `native-attempt-1.json`、`native-attempt-2.json`，不覆写为业务通过。
- 本轮只核对词形/完整代号、原版本召回/引用、材料条件未知及无自动处理；回答仍出现与材料题相关度较低的办公/点位资料和扩大阶段判断的表述，保留为KB-1/KB-3专业语义与上下文相关性的后续评测项，不计为完整专业客服或阶段推理通过。C01界面/状态源仍是既有批准组件；没有进行新的视觉还原。认证后台视觉、完整宿主光学/高屏/键盘、真机/真实微信/BLE、OCR及生产兼容/完整恢复仍保持未验证/未实现边界。

### 后台试问诊断与权限

- 新增 `GET /api/assistant/preview/runs/:id/diagnostics`，仅本人原知识试问、当前有权的企业管理者读取；客户/普通员工、其他管理员的试问和跨企业请求不可读。`enterprise_admin/admin/super_admin`继续在选定企业继承知识管理，不要求平台管理员入职/成为项目成员。接口 `no-store`；不增加客户调试入口或无权候选缓存。
- 原试问“本轮回答”旁的“检索诊断”Drawer展示实际检索问题、注册配置/profile、查询耗时/可用Embedding输入用量、当前受众/固定草稿、合法排除的汇总计数，以及授权候选的来源版本/hash、真实各路名次、融合顺序、入选/低相关/排序未入选、实际上下文是否使用及按预算截取的字符数、条件缺项/不适用原因、原片段。未发布/受众/有效期/索引计数可重叠；只有已授权候选有ID/正文。费用未知保持null，不填零；已知Agent查询Embedding用量写回原operation key，不重复计量。
- 诊断复用 `knowledge.search.v1` 的原 `assistant_run_steps.input_summary`；没有第二套运行/任务表。每次打开核对当前身份、本人会话、knowledge_epoch、固定草稿、候选精确hash/版本、有效期/profile及条件上下文；旧资料失效时整份旧trace不再返回正文/标题。普通查询未检索、索引未就绪、候选未召回/低排/条件缺失与模型执行失败分别可见；手工录入不冒充已解析文件，生成语义正确性明确不自动判断。Admin试问仍是原保守摘录生成，C01是已验收的生成式综合解释；两者共享检索与授权，不把试问生成风格当线上语义验收。

### 上游采用与本批验证

2026-10-18复核[Haystack过滤实现](https://raw.githubusercontent.com/deepset-ai/haystack/main/haystack/components/retrievers/filter_retriever.py)及[运行时过滤测试](https://raw.githubusercontent.com/deepset-ai/haystack/main/test/components/retrievers/test_filter_retriever.py)、[LangGraph JS工具消息测试](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/langgraph-core/src/tests/prebuilt.test.ts)。采用检索/生成分离、可记录条件与测试方法；上游运行时filter可覆盖默认值的行为不能覆盖本项目硬授权。保留现有LangGraph/pgvector/Worker，没有安装或迁移另一框架。[DeepSeek JSON输出文档](https://api-docs.deepseek.com/guides/json_mode/)仍列出空内容/截断注意项；本批不放宽原解析、未知结果和用量合同，不把供应商问题泛化成框架规则。

本批实际执行结果、合成夹具ID、逐轮必要来源和语义核对、原生截图、静态检查及剩余阻碍见[当前交接](./xiaok-assistant-handoff.zh-CN.md)及 `tmp/xiaok-kb1/`。复跑：从admin执行 `node scripts/assistant-professional-acceptance.mjs`、`--unit`、`--regression`、`--synthesis-regression`；`node --import tsx scripts/assistant-professional-admin-acceptance.ts --development`；`node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development --professional`，加 `--native` 复用稳定原生流程。只允许批准开发/隔离库建明确合成数据，沿已有凭据/模型配置。

小程序仍只有 `packages/assistant/chat/chat`，复用批准C01/C02/C05/U01及唯一设计源 `design-references/xiaok-p4b-public-sites-v1/README.md` 的原气泡、引用片和不可用状态，WXML/Less/字号/插画/导航未改。后台视觉源为双语Admin UI合同及原 `/assistant-knowledge`；本环境没有可调用Chrome连接器，现有Chrome未开启CDP，认证态Chrome视觉仍未验证，不以HTTP/API代替视觉通过。原生业务截图不升级完整宿主/光学/高屏/键盘、真机/真实微信授权/BLE状态；不转人工验收门槛。

完整企业知识库仍 **Limited**：DOCX/文字PDF入库、实况检索和运营核心已有上文的限定实现；本轮补充有界词形与完整代号检索。XLSX/旧格式、OCR/复杂PDF结构、广泛专业长尾、自动条件抽取/自由文本冲突、通用父子补检/重排、批量运营及影子profile/定时替换仍未完成。按专项计划接续，不把全格式支持当专业问答前置。历史构建/类型/打包阻碍保留实际状态，未合并main、未部署或批准发布。



## 当前专业客服：知识与工地资料综合解释（限定范围，整体Limited）

当前主线按最新整合路线图3.1/4.1/4.4推进。PPT6/14/15的先答问题、生活需求和连续追问，结合PPT18/19实际节点、PPT23资料关联及PPT38缺失/说法不一致先核实，复用C01/C02/S01/U01。专业问答已接入原Agent，而不是新建聊天入口；旧知识摘录及业务快照模式继续兼容。完整专业客服、全PPT及P5仍为Limited，未生产发布。

### 行为、API与来源合同

- 原`packages/assistant/chat/chat`及`/api/miniprogram/assistant/conversations/:cid/*`、`runs/:id`保留，后台仍用既有知识发布/试问/接续接口，无新增路由、菜单、表或迁移。可选择LangGraph的企业沿原配置模型、开关、配额、用量、租约、上下文版本和人工接管执行；未选择Agent的企业仍用旧执行器。
- prompt `xiaok-renovation-v24`让自然专业问题主动`search_knowledge`，同轮向配置模型提供已发布知识完整片段和`query_materials/query_business/query_followups`获权结果。以`final_response(kind=synthesis)`逐段输出有据解释、一般建议、待核实内容；不再要求解释文字等于摘录。每段有据解释必须引用本轮sourceId和逐字支持原文；一般建议/待核实由服务端加标识。结构、引用/数字和正式承诺守卫与固定语义验收分开，引用存在本身不证明推理正确。
- step1006 `agent_synthesis_context`在原`assistant_run_steps`保存全部实际咨询的知识候选（包括冲突、未引用候选）、业务查询/项目快照、hash/版本、精确引用段及触发原话关联。材料快照保留原咨询、本人档案、项目/房间、原始message/media、正式v4主户型和已向本人发布的记录引用；同名不等于已核实映射，正式墙图不等于电气点位图，未传入像素不声称看图。
- 原知识citation表和C01来源片展示当前有效知识版本及支持原文；同一chunk的多段引用保存覆盖全部引文的连续原文。项目依据沿原快照/原消息/已发布记录及现有照片组件，不生成任意URL、图纸、尺寸或现场事实。普通专业解释不创建处理事项、批准、预约或通知；具体正式状态仍可用权威业务卡，模型不能据知识规则宣告现场已满足、已批准、已解决关闭、验收或付款。
- 模型前后、工具继续、最终事务及恢复均重验实际取回的来源。综合结论和知识引用在换版、撤回、过期、受众变化、项目/资料快照变化或撤权后失效；原消息、引用访问、重进及真人资料包走同一守卫。后续仅带此前客户问题用于指代，重新查询企业/项目事实，旧生成结论不当作新事实。不存在知识索引时，服务端先核对active_index_profile_id确实缺失并返回`knowledgeStatus=not_ready`，允许标明身份的一般建议及缺项；网络/供应商未知结果仍沿既有失败/核对路径，不伪装成无资料。
- 来源文字及工具结果仍是不可信数据，不能改变租户、本人/成员、发布、接待同意或角色权限。企业负责人/admin/super_admin管理继承、工程原件授权、source revocation、业务版本、用量与保留期保持；保留期清理同样清除新增step的source_refs/private_checkpoint。

生成上下文采用`current-turn-evidence-v1`：历史先用于选择工具，取数后保留当前轮标准工具消息对和同一真实原话，去除旧话题干扰，不生成新用户消息或第二套循环。资料显式声明适用范围未核实时，`unresolvedConflict`要求首段待核实，并拒绝伪称企业主流/倾向；这不是完整自动语义矛盾识别。当前房屋绑定从服务端会话读取，不由模型自行切换到另一套本人房屋。已有房屋绑定的客户咨询，search_knowledge同时经原材料resolver重查同一房屋，即使简短追问只选了知识工具。step1400系列synthesis.bound_materials.v1如实记录服务端主动查询，不伪造模型工具调用；Bbound来源加入相同重验和保留期规则。多项目仍先澄清，授权资料缺项不证明现实不存在；未绑定/后台咨询不自动选择房屋。

### 共用状态规则与设计映射

| 触发 | 可见反馈及操作 | 恢复/重进与权限 |
| --- | --- | --- |
| 普通专业问题 | 原气泡解释及既有知识来源chip；可继续追问、改话题或找设计师 | 真实原话/回答持久保存；不自动建事项或扩大授权 |
| 资料缺少/冲突 | 仍答有据部分；标明一般建议及一个最小待核实项，冲突保留双方 | 有效版本/条件优先，未知现场条件不补猜；重新查询 |
| 无知识索引 | 标明一般建议及企业依据缺口 | 不声称已检索到企业规则；真实外部失败继续显示原错误/恢复态 |
| 换版、撤回、过期或撤权 | 原U01来源不可用反馈；相关生成结论/原件不再提供 | 重进及后续上下文重验；失效旧结论不复活 |
| 真人接管/未知调用结果 | 原等待/接管/错误反馈，AI不插话，不假报办理 | 沿原run/job/回执核对，观察到的用量保留 |

设计源映射：唯一chat台账仍指向`design-references/xiaok-p4b-public-sites-v1/README.md`及继承C01/C02/U01；本轮只向已有文字气泡、来源chip/片、照片及失效态提供数据，不改WXML/Less/字号/插画/导航，无新图片或切片。动态长回答沿原消息区滚动，原生功能证据不升级完整光学/宿主/高屏/键盘还原状态。

### 本轮验证与可复跑入口

固定判据预先登记于`admin/scripts/assistant-synthesis-cases.ts`，核对专业要点、正确项目、实际来源、允许一般建议及禁止推断；保留逐轮工具/模型输出、结果、时延和可核验用量，费用未知记null。源码/工程和真实语义证据按下列入口分开：

- `cd admin; node scripts/assistant-synthesis-acceptance.mjs`：55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS、共享advisory锁；真实事务/索引/检索，确定性模型适配器。它不算真实模型能力验收。
- `node scripts/assistant-synthesis-acceptance.mjs --regression`：已有Agent/资料/事项及PPT23/38处理链相关回归，配置跳过保持跳过。
- `node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development`：仅已批准5432/smart_floor_planner、真实3006 HTTP/既有Worker/embedding及配置DeepSeek/deepseek-flash；清楚标记的合成企业、用户、工地、知识/墙图/记录，每个固定核心场景重复两次。
- 同命令加`--native`：唯一副屏Stable2.02.2608080、官方automator0.13.0、SDK3.17.2/390×844；实际输入/点击、回答、引用、持久重进及撤回，恢复内存网络/身份/存储。不是微信真登录或真机验收。

最终v24：真实模型核心**12/12**（6个固定组合各两次，run218–229）；Stable原生**9/9**，包含额外两轮真实模型、引用片、持久重进及撤回。数据为合成夹具，HTTP、配置模型、embedding、Worker与开发数据库真实。核心24次模型调用，observed input120862/output8139 tokens，费用未知为null。新增隔离数据库/解析**15/15**、纯单元**27/27**、Mini相关**98/98**。既有相关回归按已完成文件分组合计**71通过/9配置跳过**，原组合命令超时，不能说整组命令通过；最终Agent子组复跑12通过/7跳过。lint 0错误/30既有警告；类型检查仍失败，292条诊断与原集合完全相同。早期v21/v22语义失败、v23原生旧缺项误述、首轮服务/测试器失败均保留，不标最终通过。数据ID、实际文本及边界见本轮交接与tmp/xiaok-synthesis报告。历史构建阻塞、独立Mini打包3失败、真机/真实微信/BLE与完整发布保持原状态；完整KB-1/文件解析、未标记矛盾识别、自由建议的工程规范级评审及完整视觉/宿主/高屏/键盘核验仍Limited或未验证。

### 上游对照与采用决定

核对维护中的[LangGraph ToolNode](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/prebuilt/tool_node.ts)、[消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)、[已关闭status问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)，以及[OpenAI兼容工具序列化问题11490](https://github.com/langchain-ai/langchainjs/pull/11490)。借鉴[Dify将检索结果作为模型上下文](https://docs.dify.ai/en/cloud/use-dify/nodes/knowledge-retrieval)，在已有有界循环内加入来源化生成，保留数据库的权限/业务回执/任务权威，不迁移框架或另建恢复系统。11490讨论流式无效工具参数与消息序列化不一致，当前非流式适配不据此更改；继续验证实际配置模型的工具协议/解析。DeepSeek已有关闭thinking/强制final_response为供应商适配，不推广成通用规则，也不把工具status当正式办理成功。

**当前P5/PPT38现场落实、正式解决关闭与原咨询回传：限定闭环Implemented，整体Limited。** 原S04以当前获同意的精确方案，关联同房间已核对发布、有完成内容且无待处理缺项的现场记录及照片原件；负责人/管理者明确记录落实，管理者分别正式解决、关闭并选择回传节选和是否开放这些原件。客户同意、普通回复、照片发布不自动推进正式状态，关闭不代表工程验收或付款。独立处理修订、原键恢复、真人延后/乱序去重、重新处理及换版/撤回/撤权守卫沿原事务/outbox/Worker，原件仅以JWT回传原授权咨询；移出或所需角色降权后再授权不复活原正式依据，member审计保留服务读取的previousRole/previousActive。prompt v20的query_followups只读实际结果并继承原施工来源链；方案决定来源按业务修订优先，晚到的原发布通知不改变当前决定的来源ID。不增表、迁移、页面、菜单、WXML、Less、插画或导航；复用批准S04/C01/C05/U01。当前接口、角色、状态、设计映射、复跑命令和验证边界见[二期当前合同](./xiaok-assistant-phase-2.zh-CN.md#当前p5ppt38现场落实与正式解决关闭)，证据tmp/xiaok-p5-resolution/。既有构建/类型/独立Mini打包限制保留，不声明完整P5、可发布或干净克隆全通过；未合并main或部署。本段当前限定范围优先于下文旧阶段“正式决定/落实关闭未交付”的描述，旧批次测试及未测记录仍按原范围保留。

**前批P5正式版本、差异与客户决定：限定闭环Implemented，P5整体Limited。** 原S04有权人员明确发布图纸原件、精确版本、前版、差异及费用/工期影响；原授权咨询C05完整查看后作本版本决定。原键恢复、真人延后、换版/撤回、权限及v19来源化追问已接通；没有新表/迁移/页面/Less/插画/导航或生产变更。客户同意仍不等于现场落实、解决、关闭或验收。当前合同和最终验证见下文P5节；此前PPT23客户资料及同事项回传合同继续约束其各自范围。

本次聚焦复用Postgres事务、原键幂等及现有outbox/消息协议，不增编排器或框架checkpointer。已复核维护中的[LangGraph工作流](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭ToolMessage问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)，不以工具status代替业务回执。查询走确定性服务、不调用模型，原报告整理模型/提示版本不变。

## 当前P5/PPT38：现场落实与正式解决关闭

本节约束本轮限定实现，优先于下方旧批次“现场落实/正式关闭未交付”的限制。当前限定闭环Implemented；P5整体仍Limited，最终执行证据见本节。PPT38要求“先整理，再由人核对”“由负责人决定，再告知客户”，沿用PPT22/38的S04、C01/C05与U01共享组件，不新增S05页面或视觉方向。

原事项来源修订与独立处理修订分别管理。原来源失效并重新核对后，新事项修订可继续原有负责人处理路径；旧关闭仅留审计，不能永久覆盖新的待办状态。新outbox类型`construction.site.issue.evidence.v1`保存精确方案ID/hash及客户决定、事项/负责人、现场记录ID/版本/hash、作者/核对人、原件ID/hash和本次落实结论；`construction.site.issue.lifecycle.v1`保存implemented/resolved/closed/reopened及逐次操作者/结论。沿既有RLS与企业清理，不建表或迁移。正式方案仍按原来源修订验证，不因正式解决/关闭自动失效，也不因同意自动落实。

| 原S04输入/状态 | 可见反馈与持久恢复 | 权限、来源及下一步 |
| --- | --- | --- |
| 附图上报完成进展，原核对弹层发布内部记录 | 保留真实原话、原件和记录版本；模型整理不等于事实已正式确认 | 原作者/经理按既有记录权限核对；不自动开放私聊或内部资料 |
| “落实事项123方案456记录789：落实结论” | 同一事项显示implemented及处理修订、方案/现场记录/原件依据，仍待管理核对 | 当前负责人或管理者；方案须当前有效且approved。现场记录须同房间、已发布、有完成内容、无pending/coordination缺项、有未删除原件，不能使用原待处理记录或草稿 |
| 逐行“解决事项123 / 结论：… / 回传：… / 回传原件：是或否” | 独立resolved，显示已正式解决、尚未关闭；明确节选进入原咨询outbox | 仅项目经理或所选企业owner/admin/super_admin；管理者无须成为员工/成员。必须已有当前有效落实证据，不能代客户批准 |
| 同格式“关闭事项123” | 独立closed，关闭请求丢包保留原body/key；先核对真实回执，不重写版本 | 仅管理者，必须先resolved；结论/负责人与原件仍需有效。关闭不等于验收通过、付款、结算或整项目完工 |
| “重新处理事项123：原因” | 同issueId新处理修订，旧结果、原件回传与派生回答不再沿用；重新提交落实、解决、关闭 | 仅管理者。原来源已变化时先沿原“重新核对事项”更新；普通回复/转交/取消/重新核对均不能绕过有效implemented/resolved/closed，先由管理者明确重新处理 |
| 换版/拒绝/撤回、记录更正/撤回、原件删除、成员/客户撤权 | 旧正式结论变为invalidated，旧原件与来源化回答不可读；原审计保留 | 不回退旧批准。正式方案及证据检查成员移出/observer及所需角色降级审计，恢复角色也需新版本/批准或新证据。member审计增加服务读取的previousRole/previousActive，不能由请求伪造；设计者降为worker、项目经理降为非manager后恢复均不复活旧授权；普通照片/回复不能修复正式状态 |

S04继续使用原Mini/Admin chat/messages/upload/operations接口；GET versions新增`resolutions[issueId]`，POST仍以既有versions及Idempotency-Key提交，精确校验原记录/事项/资料/方案/处理修订。操作回执在重放及查询时重验处理结果来源，旧成功不能复活失效事实。当前项目投影的处理修订上限100，事项/方案50，原咨询结果30；完整分页与更自然的命令理解仍待补。

解决/关闭复用`construction.site.issue.result.v1`，以独立aggregate_type防止与旧回复修订碰撞，绑定精确lifecycle/evidence/plan与原需求授权咨询。只回传管理者明确写的节选，不泄露内部结论、完整记录或成员ID；“回传原件：是”单独授予这次证据照片集合，默认不能推断分享权。原Worker真人期间延后，恢复AI后只投递仍有效的当前结果；旧/乱序结果记dead，重复Worker不重复送。客户端重进或关闭页面不丢业务状态；无站外微信送达承诺。

原GET `/api/miniprogram/assistant/conversations/:cid/construction-records/:recordId/media/:mediaId?version=N`复用JWT、本人咨询/参与者与no-store边界，额外接受已实际投递给该原咨询且明确开放原件的有效正式结果；不要求把内部记录整体发布给客户，不开放同客户其他咨询。独立合法记录发布授权仍按其原合同管理。客户消息复用既有原件照片网格，失效时清除缓存；没有新markup、样式或素材。query_followups的team_result显示实际resolved/closed、精确依据和未验收付款边界，并沿既有工具checkpoint/construction source guards撤销。模型无落实、解决、关闭、验收或付款写工具。

设计映射：S04原文字回复/输入/核对弹层/照片网格承载新业务内容；C01原结果气泡与site-record-photos承载明确节选及所选原件。PPT单屏853×1844按宽映射390×844；两路由唯一台账保留同一批准源，原生证据不宣称完整光学/宿主还原。

来源稳定性：`customerPlans`按当前版本的状态事件修订优先选来源消息，不按投递seq覆盖客户决定。原发布通知晚于决定或Agent回答送达时，事实未变则快照hash及回答可读性保持；真正换版/决定变更/重新处理/撤权仍撤销旧回答。同题回归保留迟到投递条件，未通过提前冲刷队列或放松来源校验消除失败。已用`provenance-root-cause.json`重算，唯一差异是formal_plan.sourceMessageId；修复前失败、修复后专项及完整组合分别留证。

复跑：admin目录`node scripts/construction-resolution-acceptance.mjs`、`--regression`、`--revocation`、`--provenance`、`--agent-regression`；原生`node --import tsx scripts/construction-plans-development-acceptance.ts --development --resolution`。隔离库限定55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS和既有互斥锁；原生仅5432/smart_floor_planner合成企业与唯一副屏Stable项目。最终实际通过/失败/未测、数据ID、模型/用量、打包/构建和提交见本轮交接及tmp/xiaok-p5-resolution/，尚未完成项不计通过。

本轮最终实际验证：服务组合47/47（真实隔离库事务/业务服务，报告与模型输出采用确定性测试适配器）；组合内恢复用例2/2（已计入组合，不另加），覆盖有效正式状态不能被普通回复/取消/重新核对绕过、来源更正后同issueId重新核对→新版本决定→重新落实关闭。组合内降权恢复1项含设计者和项目经理，已计入组合；迟到通知来源专项1/1。Agent组合24通过/9配置跳过、0失败（协议/权限测试以模拟provider为主，不计真实模型质量验收）；Mini相关110/110，精确独立源码Mini逻辑98/98。Stable原生20/20，含真实上传、人工核对、精确决定、分步解决关闭、丢包回执、真人延后、原咨询JWT原件/hash、DeepSeek/deepseek-flash、langgraph-v1下两次v20追问、重新处理、撤回与成员失效；相册/原生确认注入合成结果，HTTP/Worker/模型/持久回读为真实链路，不计真机或真实微信授权。最终enterprise2424/project31/lead2889、原咨询176、事项592、方案609、现场记录44、run158–162，7次调用有observed tokens，费用未知。最终账户禁用、签名context_version提升，active_staff=0/active_runs=0；传输/SDK/存储与临时文件已恢复。

全量lint0错误/30既有警告；tsc292条且错误集合与前批一致、触及文件无诊断。精确独立源码Webpack compile模式通过，跳过类型/静态生成，不能当完整生产构建；普通构建仍被既有AiDesignerLegacyPage非法页面导出阻断。独立Mini打包12项9通过/3既有失败（business约2180KB、主包约2148KB及旧business登记断言），工作树打包通过依赖原未提交优化，不宣称干净克隆或可发布。完整Mini、完整宿主/光学/高屏/键盘、真机/真实微信/BLE、实际Worker进程重启、外部渠道和生产未重测；量房Phase0既有7通过/1失败保留。

早期SQL数组绑定导致原生发布503，已按相同查询/场景修复复验；SDK中途超时后在原窗口新编译重连；原件预览首轮断言过早，改为等待真实异步回调后复验。首批测试负例的空versions造成同步校验异常，已修正夹具并复跑。早期不完整/失败日志分别保留，不计入最终通过，也不通过换问法或换模型隐藏问题。首轮完整服务组合44通过/1失败未保留error_code，其直接原因仍未证实。第二轮45通过/1失败及同题专项0通过/1失败已精准定位：原发布通知晚于客户决定/回答投递，customerPlans按消息seq错误替换决定来源ID，使事实不变而快照hash变化。provenance-root-cause.json将该ID换回即可精确重算原hash；修复为状态业务修订优先，保留迟到投递、同一问题和全部撤销守卫。修复后专项及完整组合按上方实际结果记录。首轮、第二轮和定位失败分别保留在service-first-combination/、service-second-combination/、provenance-before-fix/；独立场景的咨询隔离只是夹具组织，不能当首轮失败的已证实原因。多项目大历史边界仍未验证。中断隔离夹具已按明确合成prefix与ID清理；原87项无关内容及5项删除状态保留，两份原脏模块文档仅暂存本轮增量。

消息/记忆协议17/17通过。已有自由生成承诺守卫覆盖无来源的“已落实/已解决/已关闭/已验收”；明确缺记录或否定表达仍可正常回复，正式事实只由已验证business投影显示。

已复核维护中的[LangGraph持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[工具/消息测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭ToolMessage状态问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)。保留既有LangGraph、数据库持久任务/租约、用量与真人边界；只扩展确定性业务投影，不迁移框架，不用模型/工具status/checkpoint替代正式业务回执。这是项目边界选择，不声称新的供应商缺陷。

完整S05、CAD/PDF或自动识图差异、自动算价排程、工程验收/支付结算、外部通知、P6多项目简报与生产上线仍未由本轮实现。

## 当前P5：正式方案精确版本、差异与客户决定

本节为PPT19/23/38的当前限定合同，优先于下文旧批次“正式版本/决定未交付”的历史限制；P5整体仍Limited。现有 `ai_generation_publications` 是效果方案展示，不具有本事项的工程图纸、变更影响或客户决定合同。本批不将其、客户点位图或量房v4冒充正式变更；在原S04由有权设计师/管理者明确发布本次上传的图纸原件，形成一份独立不可变业务版本。

版本使用既有outbox的 `construction.plan.published.v1`（事项聚合、递增V号、事件ID为精确版本ID），绑定原事项/修订、同项目/房间、获准需求/资料hash、发布人、原件ID/hash、前一版本ID、明确差异、费用变化分及工期变化天。费用/工期必须明确填写，零变化填0；不由模型估算。`construction.plan.status.v1`独立保存预览、稍后、拒绝、要求修改、同意和撤回的修订及原因。没有新表/迁移/新页面；现有企业清理覆盖这些事件。新版永不继承旧版预览或决定；撤回不会回退旧版。客户同意、现场落实、事项解决和验收是不同事实，当前事项仍awaiting_review。

| 入口/触发 | 可见反馈和持久恢复 | 权限及版本边界 |
| --- | --- | --- |
| S04原输入附一张本人本次上传图纸，逐行发送“发布方案事项123 / 标题：… / 差异：… / 费用变化：+500.00元 / 工期变化：+2天” | 同聊返回精确方案ID/V号、差异及影响；原件仍用既有图片网格，GET的versions增加plans修订 | 当前负责人中的设计师或管理者；须有当前获准需求、有效事项/原记录/资料hash；存在客户图纸时先核对关联。工人/observer、旧快照、无原件或未知影响不能发布。管理者含所选企业owner/admin/super_admin，无须就业/项目成员身份 |
| C01原咨询收到C05方案卡 | 显示版本、房间、差异、费用/工期变化；“查看完整图纸与差异”展开本版本原件，原件加载后才启用明确同意 | 只投递原共享需求的本人咨询；不转到“最新咨询”，不开放内部会话/员工身份ID |
| 同意/不同意/稍后/希望调整 | 决定绑定路径中的精确版本ID和expectedRevision；稍后持久化且仍可继续决定；要求修改使用既有原生编辑确认组件，须有说明；拒绝/修改不锁住聊天 | 服务端预览是同意前提，普通“好/可以”、发图和浏览不批准。拒绝或要求修改后由团队发新版本，不能对已处理版本另作相反决定 |
| 提交后回包丢失、重进或身份变化 | 原path/body/Idempotency-Key保存在既有会话操作日志中；重建客户端先核对同次决定；错ID/修订/状态/完整资料的回执不能清掉原键 | 原键重放前重验当前来源/受众；撤回/换版/撤权后不能用旧成功回执复活批准。迟到响应和缓存按身份隔离 |
| 真人接待、换版、撤回或来源变化 | 原Worker/重进消费者持久处理；真人期间延后，恢复AI后投递一次；无效候选记dead，不阻塞后续版本。受控历史、原件、模型回复和记忆重验同一来源 | 客户或发布/负责人访问失效、事项修订、资料替换/撤回使原版本不可继续使用；原审计保留，不承诺收回用户已保存的字节 |
| S04查询资料、C01追问版本/差异/决定 | S04原回复读取当前有效正式方案；`query_followups`组合本咨询实际收到的精确版本/影响/客户决定，沿construction来源链进入回复与撤销守卫 | prompt `xiaok-renovation-v19`；模型只读真实决定，没有批准/算价/改期/关闭工具；效果方案查询不能替代正式版本 |

既有Mini bearer适配器增加 `GET /api/miniprogram/assistant/conversations/:cid/plans/:versionId`、`GET …/media` 和 `POST …/{preview,approve,decline,request-changes,defer}`，POST只接收expectedRevision与可选reason。S04继续使用原Mini/Admin聊天消息/上传API，客户路径保留本人会话/企业/参与者权限；响应no-store，原件每次JWT授权。不新增管理员代客同意入口。当前标题80字、单行差异1200字、修改/撤回说明500字；费用变化绝对值上限100万元，工期变化绝对值上限365天。每事项一个当前版本，S04最多50个事项版本投影，原咨询查询最多30份实际收到的方案；完整分页仍待补足。

设计源仍为唯一台账中的C01/C05/U01和PPT22/23/38。C05复用现有card/quote/photo/primary/options/notice组件、同一导航/输入/字体/Less/插画；只新增本业务的内容及动作变体。两列次动作仍为拒绝/稍后，修改说明复用原生编辑确认；没有新画布、素材或截图切片。完整图纸在原消息区滚动，不缩小文字。本批覆盖“明确版本→看到差异和影响→必要决定→同事项可查/来源撤销”，不是自动识图差异、CAD/PDF、自动算价排程、完整S05、签约付款、现场落实/解决/关闭、验收或外部微信送达。

重复命令：`node scripts/construction-plans-acceptance.mjs`；`--regression`顺序覆盖资料/共享/节点交界；`node --import tsx scripts/construction-plans-development-acceptance.ts --development`复用已核实唯一Stable项目。测试只使用批准隔离库及明确标记的开发合成企业。最终实际结果、模型轮次、原生截图、独立源码构建边界和提交见交接及 `tmp/xiaok-p5/`；早期设施/测试失败保留，不计入通过。

本轮验证：正式版本服务11/11；相邻组合40项39通过/1配置跳过（与专项重叠），相关Agent33项24通过/9配置跳过；Mini定向109/109。Stable最终21/21，含原件像素/hash不同的V1/V2、真实上传与JWT原件读取、稍后/要求修改/批准、原键丢包恢复、换版/撤回、双向重进、真人延后及两次真实v19追问；6次模型调用均有observed tokens，费用未知。相册选择与确认/输入模态由SDK传入合成结果，HTTP/业务写入/Worker/持久回读是真实链路，不计真实微信授权或真机通过。原生数据enterprise2420/project27/lead2885、原咨询168、方案504→509、run147–150；最终active_staff=0、active_runs=0，签名context_version已提升，临时文件/SDK/传输/存储适配恢复。

全量lint零错误/30既有警告；tsc仍292条，触及文件无诊断，排除隔离目录的绝对导入路径和诊断省略显示差异后错误集合一致。独立源码Webpack `--experimental-build-mode compile`通过，只跳过类型/静态生成的编译模式，不能称完整生产构建通过。普通独立构建仍被原有AiDesignerLegacyPage等非法页面导出阻断；Mini完整干净快照仍有旧business/主包体积和旧业务登记断言限制。仅补打包测试中小客分包预算及assistant/construction入口两个片段，独立快照小客预算1/1通过；旧AI组件搬移、素材压缩、其余打包/本机修改不整体纳入。精确记录见基础manifest与`tmp/xiaok-p5/`。全小程序套件、完整宿主/光学/高屏/键盘、真机/真实微信/BLE和外部投递未重测；量房既有失败保留，不作为用户必测或生产批准。

首轮真实模型虽答出了正确方案，却暴露正式方案未加入既有construction来源继承的问题；已扩展原查询守卫中的来源kind，并用实际工具回归、换版失效及相同两类真实问法复验。早期沙盒桌面不可见、模型来源缺口和一次并发隔离锁拒绝的日志保留；锁拒绝时没有执行测试或写数据，不将它们计为通过。没有依靠更换问题或框架掩盖失败。

本次复核已有[LangGraph工作流](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[工具协议测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)和[ToolMessage status问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)：正式副作用使用确定性授权事务和真实回执；只扩展已有只读业务投影及来源链，不迁移框架，不用工具status或模型话术作批准凭据。

## 当前历史基础依赖审计

基点 `b9f7bc4f5f4d7352445e5c68387441b9083843e3` 的已提交功能仍引用工作树中的未提交代码。本次按实际导入、Next路由、原生分包入口、Worker、迁移序列和权限合同核对；精确文件/片段名单见 `xiaok-assistant-foundation-manifest.json`。仅纳入小客核心及其工地、作品来源、角色/会话保护、清理和自动化基础，没有整体暂存工作树。`.agents/skills` 在本检出不存在，使用根目录及admin指令和已确认设计。

隔离源码快照从该HEAD归档，只覆盖名单中的文件/片段，不借用工作树src。测试用依赖目录和隔离库连接是本机设施，不作为可独立安装证明。快照发现的缺失 `scripts/xiaok-embedding/recall-fixture.ts` 已纳入依赖。密钥扫描命中的三份测试只有明确的合成凭据；环境、SSH、私有连接和本机DevTools配置均未纳入。

独立打包仍有历史边界：HEAD中的business素材和主包组件使体积断言失败，打包测试也缺少后来新增分包登记；现工作树有旧素材压缩、AI组件搬移/删除及对应测试修改，本次不为消除脏状态将其整体带入。量房、AI设计、推荐网络其他界面、本机配置及图表缓存保持排除。不得宣称本批提交已是干净克隆完整可运行/可发布包；验收日志与剩余诊断在 `tmp/xiaok-p5/`，最终检查在交接记录更新。

## 当前PPT23获权资料与同事项回传合同

### 数据来源与授权

S01的客户接续同意只给原接待人读取本咨询，不允许其将整段私聊或私图开放给项目。项目资料来自客户在原咨询明确发出的共享命令：需求只共享本次原话节选；点位图只绑定该命令之前紧邻的本人上传消息。多项目/同名房间需精确说明“项目名·房间名”；无图、隔着另一条客户消息、跨咨询/他人媒体、已删媒体或带正式户型source_ref的快照均拒绝。没有合法来源仍明确缺项，不把v4墙图当点位图。

复用outbox的 `construction.material.shared.v1` 保存客户、原咨询、项目/roomId、房间名、原messageId、原话hash、mediaId/mediaHash及明确共享依据。事件ID为资料ID；每房间每类取最新一次共享，新的同类内容明确替换旧版，撤回不回退到更老版本。`construction.material.revoked.v1` 撤销具体资料。不是新建企业知识库或复制整段私人咨询；成员和管理者仍无私人咨询读取权。原件每次从同一assistant_media读取，不在工地媒体库另复制一份。S01结束不取消客户另行给出的项目资料共享；客户撤回资料、原咨询/参与者失效或项目客户范围失效时即停止使用。

### 既有入口、操作与状态

原客户路由 `packages/assistant/chat/chat`、员工路由 `packages/construction/chat/chat?projectId=…` 和既有消息/接续API保持。新增 Mini/Admin 适配器共用的 `GET /api/{miniprogram/construction,construction}/projects/:id/chat/materials/:grantId/media/:mediaId`，只返回当前项目当前有效共享图纸的原字节；继承有效成员/observer只读和所选企业owner/admin/super_admin管理边界，不授予私人图库权限。无新增页面、菜单或数据库迁移。

| 原输入/触发 | 可见反馈与恢复 | 权限/业务边界 |
| --- | --- | --- |
| 客户说“共享书房需求：靠窗书桌，偶尔双人办公” | 原咨询保存明确节选、资料ID、受众、替换/撤回方式；重进可查 | 当前本人获准项目中唯一房间；仅本次节选，不自动共享已有私聊 |
| 通过原发图按钮上传，再紧接说“共享书房点位图：V2书桌点位，须核对现场尺寸” | 保存精确原件与说明；S04资料查询显示来源ID/hash及原件，可查看原字节 | 客户提供的原件仍待员工核对，不把说明里的V2当正式设计版本或批准 |
| 客户说“撤回共享资料123” | 原咨询有持久回执；原件、查询、依赖回复与待投递结果失效 | 本人原咨询的具体共享事件；不恢复旧版，不撤销订单/记录本身 |
| S04查房间资料、跟进记录、接手/转交/回复/带原因取消 | 同一原记录的稳定issueId和原outbox修订；历史翻页、重进、原键回执保留 | 继续原作者/当前负责人/管理者边界；普通确认或问题不执行动作 |
| “核对事项456图纸123” | 同一事项绑定当前资料hash；显示员工已核对关联和现场复核边界 | 当前负责人中的设计师，或有管理权者；worker/observer不能核对，旧资料不能使用 |
| “回复事项456：处理原话” | 回到原记录，仍awaiting_review | 当前负责人/管理者；不自动扩大客户受众、不标已解决/批准 |
| 管理者说“回传事项456：给业主看的明确回复” | 持久保存待回传事件；原授权咨询收到一次团队节选和非批准说明 | 必须有当前客户需求授权；已回复待核对仍须处理回复及必要图纸核对，取消/待处理/未分配按上方P4A当前合同回传真实状态；不搬运内部回复/照片/私聊 |
| 真人接待/等待、来源或权限改变、版本冲突 | 真人期间同一事件延后；失效事件终止投递，已投递派生文案重新检查；冲突保留输入，刷新后须再次发送 | 只回原咨询，不选“最新”咨询；记录/事项/资料hash均校验，移除的负责人和发布者不能继续投递 |

GET聊天的 `versions` 新增按roomId的 `materials` hash。POST原body/键一起保存记录版本、事项修订和资料hash；客户端重进清掉受保护图片/写权限。回复、图纸核对、重新核对和回传均检查资料快照，源撤回到空集合也不能绕过版本检查。来源变更后“重新核对事项456：原因”保留同一ID、重新绑定当前原记录/资料，清掉旧图纸关联及处理结果，再显式核对/回复。

### 回传、生命周期与限制

`query_followups`同时读取本咨询已实际投递的获准团队回传，返回最小的事项ID/修订、真实等待或取消/恢复后的状态及负责人、明确节选、原回执messageId和资料hash（扩展见上方P4A合同）；不读取未发布内部事项、原共享聊天或其他咨询。即使原回执已超过模型30条历史窗口，工具路径仍把它加入既有construction source_refs，按同一来源继承/内存/提交守卫撤销派生回答。节点补充事项与团队回传用kind区分，不把回复变成批准。

`construction.site.issue.result.v1`保存同一issueId/revision、精确共享来源/资料hash、原咨询/客户及管理者明确节选。既有Worker轮询和原咨询重进共用消费者；事件/原咨询consumer键与消息eventId去重，同事务写入delivery和消息。human/handoff_requested时不消耗事件；恢复AI后只投递仍有效的版本。来源撤回/替换、事项修订、记录失效、参与者/客户访问撤销、负责人或发布管理者失效会阻止投递；失效事件记dead而不反复占据候选队列。原始审计材料保留；受控历史、S01投影及Agent读取沿现有来源可用性守卫停用旧派生结果。用户自行保存的字节不能承诺收回。

**PPT范围**：23覆盖有效需求节选+客户图纸原件+现场记录的同项目/房间关联、同事项设计师核对与回复、原咨询限定回传；22覆盖原报告到草稿，33覆盖同项目负责人接续，38覆盖来源失效/非批准边界。没有把本轮写成PPT23整页完成。企业统一出图/当前批准图纸资料域、完整S05资料卡、ASR、外部微信通知及通用自由语义仍有未交付范围；正式方案版本/差异/费用工期/客户决定与落实/解决/关闭以当前P5合同的限定实现为准，不沿用旧批次的未实现判断。查询原记录最多10条、事项投影最多50条；需求/图纸每房间各保留一个当前共享来源，独立选择器/完整列表尚未补足。

**验证**：共享/资料组合20/20（与后续专项重叠），最终获权资料/回传/Agent来源专项12/12，相关Agent/资料/节点回归24通过/9配置跳过；既有现场16通过/1配置跳过；Mini59/59；Stable原生最终21/21（其中两次真实v18追问、原回传及两条派生回答撤销已验证），早先20/20限定主链单独保留，不累加场景数。lint0错误/30既有警告；全量tsc仍292条，与剔除本轮已修正3条后的起点错误集合一致，触及文件无诊断。隔离Webpack构建通过（27.4秒编译、111/111静态页；原有favicon追踪复制告警），不替代独立全量tsc或部署验收。完整宿主/高屏/键盘/光学、全小程序套件、真机微信授权/BLE未验证；既有量房1失败保留、本轮未重跑。

重复命令（admin目录）：`node scripts/construction-materials-acceptance.mjs`；`node scripts/construction-acceptance.mjs --site-only`；`node --import tsx scripts/construction-materials-development-acceptance.ts --development`。隔离服务只允许localhost:55432/xiaok_embedding_eval且持共享advisory锁；原生fixture只允许批准的localhost:5432/smart_floor_planner、真实本地3006、标记合成数据与既有Worker，签名/存储/临时图片最终恢复或撤销。支持文件沿用既有Stable窗口/CDP/SDK工具，不打开另一个项目。

**设计映射**：S04仍以PPT22/38和同deck的PPT23资料关联原屏为范围依据；C01沿唯一还原台账的主稿与共享状态。PPT23原屏853×1844→390×844已读取，不实现未批准的另一套资料页；原件使用既有照片网格，资料查询标签改为“资料原件”，文字/反馈/输入沿原组件。无样式、导航、新素材或页面切片。原生按实际路由/栈、逻辑390×844及编码PNG尺寸记录；完整光学还原仍未声称通过。唯一设计源及当前状态同步双语还原台账。

本轮复核已有[LangGraph工作流](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[上游工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭issue1440](https://github.com/langchain-ai/langgraphjs/issues/1440)。采用确定性授权/事务/来源守卫与已有消费者，不迁移框架，不以工具status或模型文案替代业务成功。团队回传上下文更新为prompt v18，沿用原construction source_refs继承、内存投影及执行/提交守卫；两次当前配置真实追问核对来源和非批准边界，撤回后两条派生回答均失效；原报告路径两次真实模型回归另记。



## 当前P2M.3/P3B：资料关联与持续接续基础（限定Implemented，整体Limited）

资料关联由本人会话/明确房屋组合原话、完成的正式v4主户型与本人可见现场发布版本，带精确来源类型/ID/hash/版本、房间候选、原始消息/媒体ID、受众、依据与查询时间。只读且不建进度草稿。多房屋/多个项目/重名房间先澄清，同名不升级为已核验关系；点位图及共享设计资料仍缺业务来源，不能从墙图虚构。同一房屋多项目或重名房间目前安全停止并待员工核对，工具尚未提供项目/楼层选择器，不宣称完整消歧。当前查询限本人原咨询，未增加设计师共享卡或跨私聊资料读取。C01/C02/U01普通文字气泡与已有发布记录为设计依据，原PPT15/23实际内容已读取；无新布局/素材/导航。

持续事项复用原`construction.need.asked.v1`事件ID作为稳定issueId，初始revision1；有效`record_need`补充与S01明确sourceMessageId/field的核对分别追加`construction.need.progress.v1`修订。聚合记录只保存原话/事实指针和hash、项目、进展类型；不复制整段私聊，不建第二套Agent知识库或新增表/迁移/API。当前状态为待客户补充、待核对（未分配/原接续设计师）和来源已失效。普通讨论、可以/收到、一般人工回复不新增或关闭事项，不写正式方案/费用/工期/验收批准。原咨询事项转交、正式业务关闭/取消、定时催办及主动结果事件回传仍未实现；共享现场事项按上方P4A当前合同；页面关闭后的原S01回复和事项进展可持久重进读取，不宣称外部推送。

PPT16/35/37的“已知设备后补其他设备”仅在企业明确配置剩余设备问题时启用，沿用已知原话作简短上下文；已不确定、稍后或明确没有其他设备不追问，同一项目/客户/字段/房间只问一次。实际节点及配置/房间/客户范围失效时，旧事项与派生回复、Agent记忆投影和模型历史均重验；原始材料与更正链保留审计。既有业务查询历史仅带重新查询提示，避免自己保存新补充时误继承旧快照；未知工具结果、重复原键和提交后checkpoint前租约恢复不产生第二次记忆/事项写入。原租户RLS、本人参与者、接续授权与实时员工身份、人工暂停、用量和保留期边界保持。

继续采用现有LangGraph JS1.5.0的有界标准工具循环；已复核[工作流/Agent](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[维护中的消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭1440问题](https://github.com/langchain-ai/langgraphjs/issues/1440)。Postgres继续负责租约、来源/版本、幂等及用量，不新增框架checkpointer/编排器或供应商协议补丁，不把tool状态当业务回执。当前prompt `xiaok-renovation-v17`；v16为资料基础提交时的模型证据，历史v15/v14保持各期含义。

本批检查：原生主链9/9（副屏唯一Stable2.02.2608080/SDK0.13.0/基础库3.17.2/逻辑390×844，PNG348×752），真实HTTP/Worker5次运行成功、同一事项245由revision1→2→3；S01核对/回复后仍待核对，非正式批准。最终资料文字原生4/4另增1次成功真实run，共6次。资料专项v17最终7/7，含两次当前配置模型核心路径（v16此前7/7保留为历史）；事项专项6/6含两次v17模型核心路径，之后新增提交后租约恢复1/1。相关Agent19项：12通过/7配置跳过/0失败；施工67项：64通过、3配置跳过、0失败，原全量相同文件分5组顺序覆盖。此前一次进程消失且无完成结果，按中断保留、不算通过；其两条明确标识合成企业已在隔离验收锁下清理。Mini定向63/63；量房Phase0基线8项：7通过/1既有依赖审计失败，相关测试与autosave源均保持原内容；小程序全量未重跑。Admin全量lint0错误/30警告；tsc仍293条诊断，触及路径无诊断、首尾错误集合相同，未记通过。生产构建未重跑；完整宿主胶囊/光学/高屏/键盘、真机/真实微信/BLE及生产验收未验证，均非开发手测门槛。

可重复命令（admin）：`node scripts/assistant-materials-acceptance.mjs`；`node scripts/assistant-materials-acceptance.mjs --issues`；设置`XIAOK_MATERIALS_LIVE=1`执行当前已配置模型核心场景，各2次；只读复制原开发供应商配置到隔离库并恢复，不修改开发/生产供应商设置。固定隔离localhost:55432/xiaok_embedding_eval及闲置队列互斥锁，创建/清理有前缀的合成数据。`node --import tsx scripts/assistant-materials-development-acceptance.ts --development --native`固定批准的localhost:5432/smart_floor_planner，新建清楚标注的合成企业/用户/房屋/项目，不改其他企业；结束禁用合成操作账号并递增客户contextVersion撤销测试会话。原生依赖当前本机`tmp/xiaok-vector/materials-followups-batch/materials-native.cjs`、既有SDK/CDP/副屏辅助文件，不是脱离本工作区可运行的已发布测试包。凭据与传输/存储journal仅内存，完成恢复原身份/方法并读回transportActiveAfterCleanup=false，返回首页。

证据：`tmp/xiaok-vector/materials-followups-batch/`保留模型逐轮工具/来源/结果/实际token、原生及真实HTTP/Worker回读、日志/状态/截图、中断尝试及分组重跑/清理。Codex直接对照4条v17轨迹的限定目标，未见无依据项目承诺或重复已知问题；这不是独立人工审核或广泛质量评分。4次保存确认均多问一个本轮限定任务不需要的可选细节，记为体验改进。两轮轨迹耗时24.6–38.5秒；6次原生run创建→持久完成P50=15.660秒/P95=23.178秒，未测首反馈、不作生产基准。费用未知；旧原始trace占位0不是实测质量率。首轮原生401与后续临时脚本依赖错误均记录为验证装配问题，未改认证/安全。设计源仍为`design-references/xiaok-p4b-public-sites-v1/README.md`及继承C01/C02/U01，最终当前文字截图为`materials-native-final-source-text.png`。本批仅验证原组件数据/文字变体，不是视觉还原；无新增素材/markup/样式/导航，两份唯一还原台账保持。

## 当前P4B：公开副本、精确同意与企业审核

限定闭环Implemented，整体Limited；[总计划3.7](./xiaok-assistant-roadmap.zh-CN.md#37-p4b-公开工地具体授权与审核限定闭环)维护运行入口/API/5张新增强制RLS表/角色/状态/设计资产/验证/手测。C03/C05/S07经用户“确认”批准后实施，C01私聊和P4A内部工地仍隔离。三种管理角色审核不代替业主看全并同意精确版本；私人来源仍需原接待权限。新版本/来源失效收紧公开媒体、派生回答、历史与交接。本P4B交付使用prompt `xiaok-renovation-v15`，v14/v13为更早历史批次，当前版本见上方资料关联记录。原生/认证后台手测待测、非阻塞，未生产发布。

扩展前核对[LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)、[官方检查点合同/测试入口](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint/src/base.ts)、[持久化指南](https://docs.langchain.com/oss/javascript/langgraph/persistence)与[Redis has_writes问题1996](https://github.com/langchain-ai/langgraphjs/issues/1996)。保留现有消息/工具/有界恢复；授权审核仍用Postgres业务命令/outbox，不迁移框架、不用模型中断代替同意、不添加公开写工具。Redis案例是特定存储适配问题，本项目未采用该适配，也未加通用provider补丁。step1003 `agent_public_context`保存精确公开内容hash，恢复/工具/提交/投影重验；只读原文视为不可信来源，未输入照片就不声称视觉理解。注入与当前配置DeepSeek真实端到端回归分别9/9通过，不以示例代替质量评测。

## 当前P4A限定接续：项目共享对话、核对发布与原咨询关注

实施/API/数据/权限/状态/设计映射及手测以[总计划3.5](./xiaok-assistant-roadmap.zh-CN.md#35-p4a-工地共享小k对话记录发布与关注限定闭环)为准；限定闭环Implemented、整体Limited。共享project_collaboration经数据库适配复用消息/运行/Worker/配额/用量，由应用装配层选择单步现场整理处理器；客户/员工接管及知识预览检查保持。客户Agent提示词xiaok-renovation-v14，现场整理xiaok-site-record-v1；来源撤回覆盖通知、业务查询和派生回答。

选型依据核对[LangGraph原始状态/人工核对建议](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)、[维护中的消息/工具测试](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[历史已关闭ToolMessage状态问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)。本批无需工具循环，不新增框架/checkpointer或Agent，不以ToolMessage.status推断业务成功；Postgres的权限、原材料/版本、租约、幂等及账务为权威。没有新增供应商专属协议补丁，真实配置模型回归与注入模型测试分开记录。下文P3B/P3A/v13及更早记录是各阶段历史基线。

## 当前P3B限定接续：节点补问、原聊天补充与设计师核对

本批Implemented范围及API/数据/角色/状态/设计映射/手测统一见[总计划3.4](./xiaok-assistant-roadmap.zh-CN.md#34-p3b-节点需求补问与原聊天核对限定闭环)，整体仍Limited。复用C01/C02/S01/U01和原接待授权；普通回答/图片/内部核对不变成正式方案、费用或工期批准。无新增小程序界面/资源/路由、数据库表或迁移；默认节点不配置补问，不会自行替企业设置问题。P4A发布/关注改由3.5维护，P5正式变更未实现。

Agent采用记录：已核对维护中的[LangGraph状态/上下文指南](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)、[消息/工具及恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)和[已修复的ToolMessage状态问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)。据此本项目沿用现有有界LangGraph及标准消息序列，只把已重验的节点问题投影为历史对话数据，不新增编排器、框架checkpointer或供应商特例。PostgreSQL仍负责租户/来源撤回、任务租约、工具幂等、用量及人工模式；`agent_construction_context`保存问题消息依赖，恢复/工具/提交和后续读取均重验。prompt版本`xiaok-renovation-v13`隔离旧缓存；真实配置模型由施工隔离专项覆盖，不能以工具status字段替代业务写入结果。

当前P3A施工员工入驻、阶段员工关联及三端共用云工地基础闭环Implemented，整体Limited，权威合同见[总计划3.3](./xiaok-assistant-roadmap.zh-CN.md#construction-staff-contract)。设计师、施工员工、老板共用packages/construction/projects/projects，角色/工地授权区分数据与操作；施工扫码角色不参与设计/量房派单、获客或分佣。复用原PPT与当前已还原组件，姓名/工种/手机号归员工资料，阶段只存有效成员关联；旧手填电话保留证据但不拨号兜底。原PPT18/21“联系管家”仍只电话协调到场，不写意向/预约。保留xiaok-renovation-v12、LangGraph有限工具循环、SQL权限/来源撤权/用量/outbox，不修改模型或供应商协议。P4A记录发布按3.5实施；语音与P6简报仍未实现；本人资料/头像/密码沿用原接口校验；共用工地支持原生下拉刷新、版本冲突后重读及旧token写回执丢弃。原生视觉/真实拨号待人工验收、非阻塞。下文v10/v9为各批次历史边界。

P3A工具扩展已核对[LangGraph持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)、上游[ToolNode错误/调用关联测试](https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/tests/test_tool_node.py)及[JS历史status问题#1440（已关闭）](https://github.com/langchain-ai/langgraphjs/issues/1440)。Python测试仅参考协议行为，不据此假定JS API；历史问题不是本项目当前版本仍存在该缺陷的证据。本轮继续复用既有LangGraph有限循环、Postgres run/job/step/outbox、服务端权限/版本/幂等和用量，不增加第二套checkpoint或依赖ToolMessage.status判定业务成功。模型只能选工具，业务执行结果和完成文字由真实服务决定；一般模型“已记录”检查仍保留，已核验业务结果走专用来源校验。没有迁移框架或新增SDK。

## P2C.1后台发布与P2C.2公开读取基础

**P2C.1后台维护/审核Implemented，高德真实联调Limited；P2C.2限定客户闭环Implemented，原生人工/视觉验收待测、非阻塞。** 后台作品维护/审核保持；客户C01推荐→PPT设计室→作品详情→原咨询已接通，并包括明确偏好、站内联系和安全分享。首版仍无小程序作品发布页；既有P2A.3工具、v10提示词、归属和分佣合同保持。

- 页面：`/case-publishing`（作品分类/筛选、所选作品发布检查；作品集和小区核验Tab）、`/case-publishing/[id]`（资料、图片分组、许可及审核预览）。设计映射：`design-references/designer-portfolio-publishing-v1/01-admin-case-management.png`→列表/侧栏审核，`02-admin-work-editor.png`→编辑/预览；使用PageContainer/ProTable、共用绿色令牌、20px兄弟区块间距、响应式主/侧栏和96×72列表封面，不打包或切片复合设计图。普通加载/空态/失败/重试沿用共用Admin组件。因扩展连接未恢复，登录态Chrome渲染QA待测，没有宣称视觉通过。
- 独立`case-publishing`角色菜单，默认平台/企业管理员与设计师。后端每次重查在职状态、实际角色、角色菜单配置、首次改密状态及所选/所属企业；设计师仅本人原创/合作作品和本人作品集，管理员可选本企业真实设计师或维护不绑定设计师的企业授权参考。真实姓名、头衔和锁定规则沿用员工资料，作品集仅保存自述、服务城市/区县、风格和本人精选顺序，不虚构认证、客户数或评价。
- API：GET/POST `/api/portfolio/works`；GET/PATCH `works/:id`；POST `works/:id/{assets,draft,submit,publish,return,withdraw}`；私有GET `works/:id/assets/:assetId`；GET `authors`；GET/PUT `profiles/:authorId`；GET `communities`、GET `communities/search`、POST `communities/bind`；GET/POST `communities/requests`、POST `communities/requests/:id/review`。写操作使用Idempotency-Key及作品/资料expectedVersion，丢失响应保留原操作键，重放前重查当前权限。版本草稿→提交→退回/发布；发布正文和图片不可原地改写，新草稿审核通过前不替换旧公开版。提交自动校验图片/许可并准备确定性检索文本，无手动Embedding/索引按钮，也不宣称图像语义检索。
- ≤4MB的JPEG/PNG经像素上限解码、方向校正、去元数据，压缩为最长边≤1200px且≤300KB的JPEG。每作品最多20张有序图片，保存效果/实拍、AI效果图/样板间实拍、封面和说明；内部许可声明须覆盖整组图片及公开范围，可设到期时间，拒绝AI实拍或样板间效果图混标。每作品最多保留60张不可变上传素材，移除的草稿图片仍供历史版本使用；本批没有逐图物理清理界面。
- 8张租户表：`portfolio_works`、`portfolio_versions`、`portfolio_assets`、`portfolio_profiles`、`portfolio_communities`、`portfolio_community_requests`、`portfolio_audits`、`portfolio_provider_usage`。复合外键限制企业/作者/版本/图片归属；发布及图片触发器阻断原地改写，乐观版本与幂等事务锁防止旧提交和重复写。企业重置/删除先统计并清理这些数据再删员工/企业；不改派或自动导入旧知识库参考。
- 高德固定HTTPS `restapi.amap.com/v3/place/text|detail`，严格城市/住宅类别及5s超时；真实v3缺adcode时仅精确匹配本地名录的结构化cityname（直辖市可在cityname为空时精确匹配pname），已有区划码矛盾/非法、跨城、城市身份缺失仍拒绝，不从请求或地址文本猜城市；拒绝道路/出入口、缺ID、跨城或混合分期候选。先城市、至少2字、500ms防抖，客户端取消/代次校验忽略旧响应；5分钟候选签名绑定供应商/员工/企业/城市/POI/快照指纹，明确点选后补查详情再绑定稳定内部ID，浏览器不接收Web服务Key/签名Key。不抓全国库、不跨请求缓存候选、不接户型图库、不按名称迁移旧预约地址。 修复后真实已保存Key的宜昌诊断返回10条合格候选，未留存原始POI。字段/查询依据：https://lbs.amap.com/api/webservice/guide/api/search/ 。
- 城市/区县名称选择使用本地`@vant/area-data`2.2.0（MIT，[来源](https://github.com/youzan/vant/tree/main/packages/vant-area-data)、[许可](https://github.com/youzan/vant/blob/main/LICENSE)），行政区选择不调用供应商；直辖市编码统一适配高德，普通编辑界面不要求填写区划码。此包只提供行政区名称，不是小区/户型数据库。
- 地图服务统一在`/map-settings`配置，仅在职平台`admin/super_admin`可用；通过`GET/PATCH /api/platform/map-config`及`POST …/{import,test}`读写。默认检索供应商与正在维护的供应商分开，保存/测试可传`providerKey`，凭据加密、授权记录、版本及测试结果各自独立；脱敏`providerConfigs`支持重进，不回传密钥。保存即生效，已关闭/清除配置不静默回退环境变量，兼容显式导入旧高德Key及0076旧JSON。高德Implemented；天地图Limited：服务端适配与模拟回归已实现，真实Key、权益和运营城市召回未验证。适配依据[官方检索V2](https://lbs.tianditu.gov.cn/server/search2.html)、[POI分类](https://download.tianditu.gov.cn/download/xzqh/Type.csv)及[行政区码](https://download.tianditu.gov.cn/download/xzqh/AdminCode.csv)：固定HTTPS端点、行政区queryType12、小区类别120201、稳定hotPointID，严格结构化城市/类型校验。官方已文档化服务没有按ID详情，绑定使用已签名原名/城市复查，前10条必须含原ID；缺失、信息变化、跨供应商或配置版本过期均拒绝，同名不替代原ID，不自动切换供应商。按用户批准规则，已保存Key并显式开启即可检索/绑定，授权确认/依据/期限仅选填项目备注，不是供应商参数；未勾选、空白或过期均不阻断业务。可独立测试已保存Key；测试只存安全状态/耗时、不存POI，失败计次，额度跨供应商共享3次/分和30次/上海日。业务dailyLimit默认1000（1–10000），是应用保护值而非供应商配额；日计数及失败冷却按供应商隔离，应用3次/秒、企业30次/分、员工10次/分、页面8次/分继续共享。候选签名含供应商/配置版本，小区按租户/供应商/外部ID区分，不跨供应商合并。开发主库/隔离库0076/0078/0079核验通过，相关50/50回归、全量ESLint及涉及文件类型检查通过；Webpack编译成功，全量构建被既有AiDesignerLegacyPage导出错误阻断（全仓291项既有类型诊断）。本地3006已重启，页面/API鉴权200、匿名API401和Key无明文回传通过；原高德Key、默认供应商及授权备注保留，开发搜索已开启。人工/原生视觉验收及天地图真实查询待测，无采购或生产发布。 0079删除绑定必须有到期日的约束：缺日期存NULL，已有备注/日期保留，缺失或过期记录不隐藏小区草稿或公开同小区推荐；省略rights保留备注，作品/图片发布许可及租户/来源撤权规则继续保留。
- P2C.2读取API位于`/api/miniprogram/assistant/conversations/:id/portfolio/`：GET `recommendations?cityCode&style&communityId?`、`designers/:authorId`、`works/:workId?versionId?`、`works/:workId/assets/:assetId?versionId`。每读重查客户身份、本人会话、有效企业/作者、当前公开版本及许可；只推荐当前服务范围内原创设计师作品，同核验小区+风格优先、同城+风格回退，最多3位去重设计师，读取候选窗口上限500作品。图片绑定精确当前版本，下架、员工停用、许可到期或新公开版替代后旧读失效。公开DTO仅含批准的身份/风格/面积/室厅/图片元数据，不下发许可凭据或内部路径；第三方参考不算本人业绩，同小区不推断同户型。读取不建立线索、不改归属/分佣、不建预约或写偏好。
- 地图配置手测（待测、非阻塞）：授权勾选/依据/有效期留空，用已保存Key开启搜索、保存并重进，搜索/绑定宜昌小区后重开草稿/名录；过期备注不得隐藏小区或阻断公开同小区匹配，作品发布许可与跨租户拒绝仍有效。缺Key不能启用，关闭立即停止新供应商查询。独立维护/测试天地图，备好独立Key后显式切默认并切回核对原高德配置；设计源沿用既有Ant Design/Admin Pro设置页与双语后台UI约定。
- 尚待：真实高德权益/运营城市召回联调、P2C.1后台人工/视觉验收、P2C.2原生390×844/高屏人工验收。均如实记录，人工验收不阻塞本期代码交付；不控制Chrome/DevTools、不部署生产、不采购或扩展广泛模型评测。

P2C.1基线验证（保留原证据）：20/20作品/供应商/公开权限/企业清理测试、66/66助手纯测、47/47小程序聊天/参考/图片/接续/需求测试通过。`npm run test:portfolio`使用带互斥锁的55432隔离评测库，日志`tmp/xiaok-vector/portfolio-acceptance.log`，覆盖契约/供应商模拟、真实服务/HTTP持久化和权限、公开来源撤回、企业重置/删除。`npm run check:portfolio`核对开发主库及隔离库0071/0072 SQL哈希、8张强制RLS表及保护列。定向ESLint通过，涉及代码无TypeScript诊断；全仓保留291项既有诊断。Webpack编译成功，全量构建被既有`AiDesignerLegacyPage`导出类型错误阻断（`tmp/xiaok-vector/portfolio-build.log`）。主库/隔离库已迁移，迁移前主库备份`tmp/xiaok-vector/phase2-pre-migration-2026-10-16T16-36-04-388Z.dump`为6,389,460字节，PGDMP/归档目录校验通过；新0072恢复演练未执行。

### P2C.2 客户推荐、设计室与作品详情（限定范围Implemented）

当前工程验证：作品/供应商/真实数据库/HTTP/权限及企业清理25/25，小程序聊天/作品/图片/接续/需求/分包/字号72/72，助手纯测试66/66通过。离线检查230个JS、84个WXML模板、88个Less；wcc/wcsc均成功，不控制DevTools。Admin全量lint通过（0错误、28项既有警告），本次文件定向lint通过；本次文件无TypeScript诊断，全仓仍有既有诊断。`npm run build -- --webpack`编译成功，但全量构建仍被既有`ai-studio/designer/page.tsx`的`AiDesignerLegacyPage`导出类型错误阻断，见`tmp/xiaok-vector/p2c2-build.log`。作品回归日志为`tmp/xiaok-vector/portfolio-acceptance.log`。没有新迁移或数据库架构改动；原生人工/视觉验收未执行。

- 运行路由：C01 `packages/assistant/chat/chat` → `packages/assistant/designer/designer?conversationId&authorId&sourceWorkId?` → `packages/assistant/work/work?conversationId&workId&versionId`。返回优先回退同一原聊天栈；深链重进按本人conversationId恢复。顶部“找设计师”继续使用原接续，不新增一级找设计师页或小程序发布页。
- 推荐无参读取当前会话中明确且唯一的城市/风格记忆；否定、疑问、多城市/多风格不猜，提示在聊天继续说明。显式API仍接受cityCode/style/经核验communityId，按同小区+风格、同城+风格最多3位去重；没有核验ID不按小区名字猜匹配。当前推荐是有界确定性读取，不改变Agent工具、提示词v10或模型配置。
- 详情GET返回当前偏好及`preferenceVersion`；图片GET可用`format=base64`通过既有Bearer客户端读取。按效果图/实拍分组，明确AI生成/样板间标记。客户端临时JPEG绑定作品/精确版本/图片；隐藏页面、撤权或切换身份即清理，重进、预览和分享再查当前服务权限与许可，拒绝迟到响应。
- POST `works/:workId/preference`：`{versionId,sentiment:like|dislike,expectedVersion}`及Idempotency-Key。只在明确点击时写会话`entry_snapshot.portfolioPreferences`和`purpose=portfolio.preference`的客户选择消息，记录作者/作品/公开版/sourceMessageId/operationId/时间/supersedes，保留更正链；按钮对应文本是明确操作表达，不冒充用户额外口述或正式批准。浏览不写偏好、不改正式摘要/方案。活动Agent任务期间拒绝写入；网络结果不确定或回执缺失关键字段时保留原键和请求体，重进显示“核对操作结果”。
- POST `works/:workId/contact`：`{versionId}`及Idempotency-Key。重查作者可接待、精确公开版和已有负责人；复用HandoffService提交本次站内文字/图片接续，反馈在原咨询可见。原渠道来源保持，另存`handoff.source.portfolio={workId,versionId,authorId}`，作品作者与接待人分开记录，来源参与幂等指纹。已有负责人冲突返回409/portfolio_owner_conflict，保留原服务人并提示在原咨询协调。没有电话授权、建线索、改归属/分佣或具体预约日期承诺。
- POST `works/:workId/share`：`{versionId}`返回7天签名`portfolioEntry`及设计室路径。令牌仅含企业/作者/作品/公开版和签名时效；不含发送者、客户、原conversationId、手机号、私有图片或渠道收益人。C01和设计室/详情转发都固定使用独立品牌PNG封面，不使用聊天或偏好状态画面。接收者经entry-context和现有create建立本人咨询；本机重进缓存按登录会话+分享令牌隔离。每次进入/创建及后续读写均校验当前来源，下架、员工停用/强制改密、许可到期或版本替代即失效。分享本身不建立归属或分佣。现有活动码/推广码链路保持。
- 设计源：C01保留还原台账的C01-01及共享状态；主页唯一源`design-references/designer-portfolio-publishing-v1/ppt-sources/slide02-01.png`（PPT2/3/附40/42，853×1844→390×844）；详情为此案例卡的效果图/实拍分组变体及本节状态规则，不引入新主页方向。姓名、自述、城市、作品均来自真实公开服务数据；没有公开肖像时用姓名首字，不伪造人物照、认证、评价或业绩。
- 素材映射：内置imagegen以完整PPT主页为参考重新生成独立小K+空间材料书，优化后`design-references/designer-portfolio-publishing-v1/generated-assets/designer-studio-book.png` → `miniprogram/packages/assistant/assets/designer-studio-book.png`，1050×553、透明PNG、140,866字节。没有切片或复合UI像素。Lucide Share→`studio-share.png`（96×96、779字节），House/Armchair/JapaneseYen复用requirement-home/style/budget；许可见`docs/icon-sources/assistant/README.md`。新资产均低于300KB，无WebP。

390×844元素台账（源按宽归一；下列为实现目标，原生光学/胶囊验收仍待人工）：

| 元素 | 源映射与当前尺寸/间距 |
| --- | --- |
| 画布/原生导航 | 853×1844映射390×844；状态栏/胶囊实测动态预留右侧，导航至少44px，内容左右40rpx；详情相同 |
| 品牌/返回 | 品牌40rpx，副标22rpx；Logo可见裁框72×84rpx、独立原图96×96rpx；返回容器48×84rpx、字形34rpx |
| 真实身份/分享 | 姓名32rpx、自述24rpx、城市22rpx；身份头像114rpx、组间18rpx；分享字24rpx、图标30rpx，触区至少84rpx |
| 主标题/说明/主视觉 | 主标题52rpx/1.3，说明28rpx/1.5、间距10rpx；独立画作宽随容器、高354rpx，不随剩余视口拉伸 |
| 主/次CTA | 字28rpx，触区至少84rpx；上下CTA间14rpx，说明22rpx；动态内容可滚动，不压缩字体 |
| 精选案例/详情 | 标题28–30rpx、案例正文24rpx、业务值24rpx、辅助22rpx；卡内24rpx、图文间20rpx；封面47%×204rpx，只有图内三级标记20rpx |
| 话题/页尾 | 话题标题28rpx、按钮24rpx、图标42rpx；间距12rpx，必要时换行；页尾22rpx、头像68rpx，底部32rpx+safe-area |
| C01推荐变体 | 原头像气泡及消息阅读顺序保持；左侧88rpx对齐气泡，推荐卡内20rpx/间18rpx，封面156×170rpx；姓名28rpx、按钮/作品24rpx、理由22rpx |

| 触发 | 反馈/操作 | 恢复与权限 |
| --- | --- | --- |
| 读取/无匹配/信息不足 | 原共享加载、范围内暂无/在聊天补充；重新读取或继续原咨询 | 不造案例，不强制小区表单 |
| 图片失败/来源失效 | 重试图片；失效清空作品、缓存和分享 | 返回本人原咨询；每读重查 |
| 偏好/联系响应不明 | 保留原请求，核对同一次结果 | 禁止改正文后重复提交；幂等重进 |
| 已有负责人冲突 | 原负责人保持，回原咨询协调 | 不自动改派/建档/取得电话授权 |
| 身份切换/未登录 | 清除旧内容，去登录/返回首页 | 不沿用另一账号会话或临时图 |

聚焦手测（待执行、非阻塞）：① 在企业内已审核发布真实作品并维护服务城市/风格；客户C01说“房子在杭州，喜欢原木风”，等回复后打开推荐主页。② 看真实身份/精选作品，进详情核对效果图、AI标记及实拍分组；喜欢后退出重进，再改为不太适合，原咨询可见对应原话。③ 从主页/详情回原聊天确认会话和已有文字保留；申请联系后在同一聊天见等待反馈，员工按原S01接管；已有负责人冲突不换人。④ 转发设计室给另一个客户账号，只看到公开作品和自己的咨询；下架、停用或替换公开版后重进/预览/原分享不可继续读取旧内容。⑤ 断网重试/切身份/后台前台，核对原键恢复、无旧账号内容残留；人工检查390×844及高屏胶囊、字形大小和纵向间距。P2C.1既有手测也保持待执行。未操作Chrome或DevTools，未部署生产。

手测待执行、非开发阻塞：(1) 新菜单未出现时重新登录，在`http://localhost:3006/case-publishing`新建设计师作品，上传分组/封面、填许可，保存重进后提交。(2) 管理员退回→设计师修改再提交→管理员发布；创建新草稿核对旧公开版保留，替换后下架。(3) 其他设计师/企业不能读写，员工停用后失去访问。(4) 未配高德时输入至少2字核对明确回退，申请小区核验或不绑定发布；有独立确认权益后再验真实城市/分期及超限/失败。(5) 检查桌面/窄屏的列表、编辑、作品集、小区Tab及审核反馈。这些步骤不作为已执行人工验收。

## 授权参考与内容入口（当前 P2A.3 / P2C）

**P2A.3：PPT4–6、14页范围 Implemented；原生手测待测、非阻塞。P2C：Limited。** 本次明确授权的接续先完成参考方向闭环，再推进可复用的内容到聊天基础。当前提示词为`xiaok-renovation-v10`；下文v9证据保留为前置P2M基线，不把旧评测冒充v10基准，也不重开广泛评测。未生产部署，未实施新的小程序发布页面。

- 员工在既有`/assistant-knowledge`编辑器维护`source_type=reference_case`。沿用平台所选企业/显式授权企业负责人权限、租户事务、幂等、草稿/索引/人工发布/撤回、有效期及来源epoch。`0070_assistant_reference_cases`增加不可变版本级`reference_case`：出处/作者、授权凭据、1–12个方向标签及独立图片，全部纳入版本哈希。维护人须核实权利，填写凭据只是声明，不是系统自动法律审查。JPEG/PNG去除元数据、压缩为最长边≤1200px且≤300KB的JPEG，保存在受控引用中，不使用公开上传地址或打包小程序资源。沿用编辑器预览图片；案例草稿不虚设企业政策试问能力。
- `recommend_references`从最新200个可用发布案例按标题/标签匹配，最多返回3例；不推断图片相似度、不联网找图。企业政策检索排除案例。服务端展示精确案例原文及固定“不是你家的正式施工方案”说明；无匹配如实答复。客户在既有C01聊天提问，打开现有引用/U01底部面板看图片、出处与授权。复用420rpx照片组件，不新增布局、样式、插画或切割设计图。引用图片仅写临时本地文件，关面板/切后台/身份丢失即清理。
- `record_reference_preference`只记录本轮明确、指向清楚的喜欢/不合适，保存客户原话/消息、案例/版本和不可变更正`supersedes`链至`entry_snapshot.referencePreferences`。打开、浏览、分享均不等于偏好、摘要收藏、方案选择或业务批准。多案例指代不明先问第几个，撤回案例不接收偏好；独立风格/预算事实仍走既有需求记忆。撤回/过期/可见范围变更使引用及相关AI衍生文本失效，也覆盖授权员工接续包/对话。保留私图撤权、正式图、审计计量、租约和人工接管边界。
- P2C基础：新增`POST /api/assistant/knowledge/documents/:id/share`，接收`expectedVersion`及可选既有`entryCode`，必须Idempotency-Key。签发7天`referenceEntry`，绑定企业/文档/当前版本/哈希，不含客户、会话或私图。可绑定经校验的员工活动码/推广码来源；当前Admin复制动作生成公司来源。C01原生转发只转发内容入口。entry-context把它作为唯一入口依据，重查发布/渠道，持久化案例/渠道至会话及人工接续，并用既有欢迎文本说明上下文。过期/撤回后回到签名企业的普通咨询；签名无效则拒绝。来源只是审计/话题上下文，不改归属负责人、推荐/分佣、不建线索、不批准项目。档案仍使用既有S01受控候选关联/去重路径。
- P2C已增加上方记录的独立后台发布及会话绑定公开读取基础；客户聊天按钮/PPT主页/联系/分享仍未实现。[总计划3.1](./xiaok-assistant-roadmap.zh-CN.md#31-p2c-当前范围与小区检索)仍为范围与次序依据，后台维护不增加小程序发布页；原生/人工及登录态Chrome视觉验收待测，无生产或供应商采购。

工程证据：隔离参考套件5/5通过，含官方DeepSeek“推荐→明确喜欢→无匹配”；真实小程序controller/引用HTTP、员工来源撤回及重进复验2/2；P2C入口/过期/来源/接续2/2。日志`tmp/xiaok-vector/p2a3-live-test.log`、`p2a3-source-guard-test.log`、`p2c-entry-test.log`，最终合并复跑`p2a3-p2c-final-test.log`为7/7通过，新增真实同企业/跨企业/已停用活动码在`p2c-channel-test.log`的P2C复验3/3通过。Assistant纯测66/66、小程序参考/聊天/图片/接续/需求47/47通过；“只看参考不写需求/自动摘要”的修正以`p2a3-browsing-test.log`复验2/2（含真实模型），定向ESLint零错误/警告，涉及文件无TypeScript诊断，全仓保留291项既有诊断。离线WCC82WXML+2WXS/WCSC85Less、226JS/88JSON通过。Webpack编译通过，全量构建被既有`AiDesignerLegacyPage`导出类型错误阻断；默认Turbopack遇Windows junction错误。全仓TypeScript保留既有诊断，不宣称全量构建通过。未启用DevTools自动化，未增加长尾图片/语言评测。

开发主库及隔离评测库均已应用0070，`assistant-p2m-migration-check.mjs`校验SQL哈希/列/强制RLS通过。迁移前主库备份`tmp/xiaok-vector/phase2-pre-migration-2026-10-16T14-46-57-548Z.dump`，6,387,541字节，PGDMP/目录校验通过。恢复脚本预期更新为0058–0070/reference_case，新0070恢复演练待执行。连接/供应商/生产边界不变；开发配置仍保留原v9启用证据标记，运行代码为v10。

手测待执行，未记录为通过：(1) Admin录入已授权独立案例，索引/发布；从小程序首页小K说“看看原木参考案例”，打开来源图片。(2) 说“第一个喜欢”，重进，再说“第一个不合适”；仅浏览不得记选择，也不强制打开摘要。(3) 问无匹配方向，后台撤回后重进/打开旧引用，核对员工接续也不可读撤回内容。(4) 复制已发布咨询路径，在开发小程序进入并原生转发，接收人只见来源上下文、不带私聊；撤回/过期可回到咨询。(5) 390×844/高屏原生胶囊、来源面板及键盘由用户手测。

隔离参考/内容套件复现：从`admin`设置`ASSISTANT_P2M_DEEPSEEK_PROBE=1`、`ASSISTANT_P2M_LIVE=1`，运行`node scripts/assistant-p2m-test.mjs assistant-references.test.ts`；沿用55432隔离数据库/验收锁，真实模型测试后恢复评测供应商。省略两个环境变量则只跑注入模型边界测试。当前另覆盖真实跨企业活动码及停用渠道回退，不使用客户数据。未重跑旧v9结构/图片/长尾基准。设计参考清理dry-run/apply均为0个可回收文件，保留已有工作。

架构参考：沿用LangGraph1.5工具循环和SQL发布权威，参考[LangChain既有知识库工具检索](https://docs.langchain.com/oss/javascript/deepagents/retrieval)；参考[LangGraph工具节点测试](https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/tests/test_tool_node.py)的调用ID/错误/注入权限不变量（Python参考，不充当JavaScript/供应商兼容证明），核对[DeepSeek reasoning_content问题10883](https://github.com/langchain-ai/langchainjs/issues/10883)及既有Agent传输/运行测试。保持配置中的非思考/工具适配，不新增供应商补丁或迁移框架。真实模型场景验证当前部署工具往返，不泛化为模型质量结论。

前期阶段验收口径（用户2026-10-16明确）：只以当前阶段对应的PPT场景及相关工程检查作为进入下一阶段的依据；通过后继续下一已授权阶段。额外长尾图片、复杂措辞、广泛质量基准及其他产品对比留作后续改进，不再持续扩大为推进门槛。权限、租户隔离及数据正确性检查保留；未做的手测仍记待测，不冒充通过。当前P2A.3授权参考案例/方向（PPT4–6、14页）通过范围内检查，已继续P2C内容入口基础；新界面审批边界保持，语音按原计划独立推进。此口径不把整份PPT标成已实现，新界面设计和生产发布边界保持。

最终来源边界：即使此前多案例回复已不可用，当前偏好案例标题也须经同一历史证据谓词校验并绑定检查点。偏好/更正/撤回复验1/1通过，日志`tmp/xiaok-vector/p2a3-preference-final-test.log`；该次真实模型场景为跳过，不额外冒充真实模型通过次数。

## 当前 P2M Agent 实施边界（2026-10-16）

完整隔离Worker回归19/19通过（12项确定性边界、7项真实模型场景）：在admin设置ASSISTANT_P2M_DEEPSEEK_PROBE=1、ASSISTANT_P2M_LIVE=1、ASSISTANT_P2M_EXTENDED=1后运行node scripts/assistant-p2m-test.mjs。新增真实模型场景验证“那间房”不修改数据库，明确次卧后只改次卧；图片上传/追问/删除及纠错重进也通过。过滤运行保留时间戳报告，不替代完整启用证据。63项纯测试、定向ESLint通过；全仓TypeScript仍有291项既有诊断，本轮文件无诊断，不宣称全仓构建通过。原生手测待用户执行、非阻塞：先记录书房双人桌及次卧单人桌，说“那间房改成三人书桌”，应先澄清；明确次卧后重进，核对书房未变。上传模糊图追问精确尺寸应说明无法确认，删除重进核对衍生回复不可用。

扩展评测：admin/scripts/assistant-p2m-scenario-evaluate.ts含22种固定场景，各跑两次，44/44段、114/114轮通过（识图20段、纠错16段、对话8段）。逐轮检查工具、当前room+field事实、不可变更正链、假设讨论不写入及只靠记忆重进。新增旧浴室、模糊/像素化/遮挡、多图清晰度顺序、含糊代词、描述性指代、否定错误房间及改回需求。修复真实缺陷：未明确的房间被先存成空room事实再追问。共享生产校验现拒绝写入，反馈未保存/先澄清；用户明确要求先确认房间也不能提前保存，全屋预算仍可正常记录。通用预算/照片证据边界问答避免误走企业知识库。复杂指代采用澄清策略，不宣称自动别名解析。此前确认问句和误拦截修复继续有回归。无UI/API/schema/权限或正式量房写入变更。

方法参考：[agentevals轨迹匹配](https://github.com/langchain-ai/agentevals/blob/main/js/src/trajectory/match.ts)、[LangChain多轮模拟](https://docs.langchain.com/langsmith/multi-turn-simulation)、[LangGraph记忆指南](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/agents/memory.md)。实际采用固定输入、逐轮事实/工具断言、线程上下文与持久记忆分离、独立持久化集成测试，不以网页/Codex文风一致或同一模型自评作为通过标准。场景器使用生产LangGraph/上下文/记忆校验，服务工具为内存夹具，真实数据库由隔离Worker覆盖。知识结果按生产投影解析，不把丢弃的模型自由文本当作客户回答；API按最大seq取最后回复。原失败报告保留，本轮同义词断言过窄、知识投影偏差属于测试器误报，与产品缺陷分开记录。

素材：在admin运行node scripts/assistant-p2m-photo-fixtures.mjs下载5张Wikimedia Commons CC0照片：Tomwsulcer的拆改/工作间/完工厨房/窗框，以及Alf van Beem的旧浴室。来源/作者/许可/固定SHA-256见脚本及忽略目录tmp/xiaok-vector/renovation-photos中的manifest；浴室规范化为最长边1600的JPEG。另生成模糊、8×6像素化放大、遮挡3种确定性变体，均目视核对及记录哈希。不使用客户照片、不进入小程序资产。设置ASSISTANT_P2M_DEEPSEEK_PROBE=1后运行npx tsx scripts/assistant-p2m-scenario-evaluate.ts；可选ASSISTANT_P2M_SCENARIO_FILTER记录于报告，不能冒充全量。通过证据：tmp/xiaok-vector/p2m-scenarios-xiaok-renovation-v9-2026-10-16T14-20-01-360Z.json；v8的14-12-59-843Z及14-15-38-534Z失败报告保留。报告含输入/回复/工具/用量/记忆/源码哈希；报告后仅补运行器类型声明及移除无效重复resize，模糊JPEG哈希验证完全一致，生产代码及案例哈希未变。5图2作者仍非代表性、穷尽降质/恶意图片或独立人工质量验收。

开源对照：[LangGraph节点/状态指南](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)支持分步骤处理和按节点组织上下文；[OpenAI Agents输出护栏示例](https://github.com/openai/openai-agents-js/blob/main/examples/docs/guardrails/guardrails-output.ts)把输出校验与工具执行分离。本轮保留已安装的LangGraph引擎及PostgreSQL权限/恢复权威，不整体重写产品。DeepSeek两次调用的感知路径是经过本地测试的供应商适配，不宣称上述项目规定了此做法。业务仍采用现有确定性校验，未复制或启用示例中的模型护栏。后续Agent开发先核对相关上游实现、测试和已知问题，再决定是否自建，已写入AGENTS.md。

DeepSeek官方`deepseek-flash`现为用户授权的开发模型：后台LLM设置及Git忽略的admin/.env.local中ASSISTANT_TEXT_MODEL均已更新；ASSISTANT_TEXT_DISABLE_THINKING=1通过DeepSeek的thinking.type=disabled生效，SiliconFlow仍使用enable_thinking=false。已核验身份并重启localhost:3006专属Next.js服务，鉴权内部Worker GET为200/fresh，常规任务轮询恢复。凭据、图片生成供应商、数据库端点及生产环境未改。最初3次探测只覆盖auto工具选择；整组评测暴露思考模式与required工具不兼容，修复后3次探测通过，耗时1,123/750/801ms，input/output合计490/56 tokens。官方协议：https://api-docs.deepseek.com/api/create-chat-completion/ 。

**P2M当前状态：Limited。** 开发环境localhost:3006／远端开发数据库的企业1454使用DeepSeek官方deepseek-flash，langgraph-v1、图片/工具启用，xiaok-renovation-v9、policy_version=3。回读一致、在途0、Worker健康200/fresh。证据：结构160/160、合成图片语义16/16、扩展会话44/44段（114/114轮）、隔离Worker19/19、纯测试63/63通过。未明确房间的指代先澄清再写记忆；通用预算/图片证据边界问答避免无谓转入企业知识检索。素材为2位作者的5张公开CC0照片及3种确定性降质变体，具有代表性的装修质量及原生人工验收仍待验证。现有路由/API/角色、C01/C02/S01/U01界面及正式量房写入保持，无生产发布。本段优先于下文历史仅规则/不能识图描述；未选择新Agent的企业仍走旧执行器。方法、证据及限制见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。

本轮执行admin/scripts/assistant-p2m-dev.ts --enable-agent，启用前强制当前模型/提示版本匹配、160项结构全通过、16项语义识图全通过、完整隔离Worker报告通过且无过滤、无在途任务。--read只读，--disable恢复旧执行器。模型回滚元数据为tmp/xiaok-vector/p2m-model-before-deepseek.json，不含凭据。

P2M.0–P2M.3保持 **Limited**：开发企业1454已从现有小程序入口启用新Agent/图片理解；其他企业默认仍为extractive-v1、需要显式选择。本节优先于下文历史P2S/提案，不代表完整装修质量验收或生产上线。

- **P2M.0**：产品锁定 `@langchain/langgraph@1.5.0`（MIT）；`@openai/agents-core@0.20.0`（MIT）只在忽略目录的比较 POC。两候选各10个确定性场景通过，使用模拟模型，不能作为装修质量评测。选择 LangGraph 仅管理有限循环；PostgreSQL 保持任务、租约、配额、权限、checkpoint 和恢复权威，无框架全局会话或追踪导出。
- **P2M.1**：双方最近30条、来源化需求记忆、通用讨论与按需知识工具。事实按 room+field 独立保存，当前消息原话/值必须逐字对应，保留 supersedes 链及 sourceMessageId；工作草稿复用员工核对路径，不改正式批准。含糊房间迁移、复杂矛盾仍 Limited；不宣称任意语义纠错。
- **P2M.2**：启用 imageInput 的企业，原图片上传事务同时建立唯一 AI 任务；原聊天轮询、错误状态、历史重进继续使用，未改 WXML/Less/资产。最多4张私图，服务端重新授权后内联，禁止模型/客户端 URL 抓取。图片引用与上传消息显式绑定；删除取消在途任务，历史衍生回答隐藏，checkpoint 不保留图片字节。视觉只能给观察/待核实推断，不写正式 v4 墙图。DeepSeek以仅含图片及来源ID的短上下文独立观察，再把不可信观察交给业务推理，不作为需求/批准。感知调用单独持久化、计量和前后验权；恢复不重复发送已保存响应，感知中删除图片阻止后续调用和回复。合成多图顺序及形状通过，未发送真实客户照片，真实装修质量待验证。
- **P2M.3**：白名单 `record_need/query_business/search_knowledge/request_designer`。只查本人同企业活动线索的预约、已发布方案、已完成主正式户型；复用既有仓储及正式图只读适配器，不新建预约/方案/施工业务。业务结果由服务端渲染并重验版本；历史业务结果不带入后续模型，追问须重查。知识继续严格摘录/引用授权。人工接续调用既有服务并校验当前明确请求与 conversationVersion；成功立即停止 AI。
- 每轮前后重验租户/身份/模式/修订/来源，最多1次独立感知+4轮业务模型、每轮4工具、单调用90秒、任务年龄5分钟。应用文本预算48,000 UTF-8 bytes（初始上下文26,000）、输出2,048 tokens、每图4MiB；这是应用上限，不是供应商性能承诺。已保存响应可恢复，运行中未知调用不重发；检索未知结果也保留。用量按轮记录，缺失用量/成本是 null/unavailable，不能以0代替。
- 增量迁移 `0069_assistant_agent.sql` 增加 settings.agent_config 和 run_steps.private_checkpoint，沿用强制RLS；保留期同时清理记忆和checkpoint。开发主库/隔离库均通过迁移哈希、字段及强制RLS核验。主库迁移前备份 `tmp/xiaok-vector/phase2-pre-migration-2026-10-16T11-59-26-864Z.dump`（6,387,371 bytes，PGDMP及归档列表通过）；0069全恢复演练未运行。无生产变更。
- 配置按企业显式选择 `{runtime:"langgraph-v1",model:"Qwen/Qwen3.5-4B",providerKey:"siliconflow",imageInput:true,tools:true,probeVersion:"p2m0-synthetic-v1"}`；供应商/模型改变即拒绝原探测配置，不自动回退。该示例只用于隔离合成测试，不构成客户图片外发授权。现有 API、角色与 C01/C02/S01/U01 主稿和共享反馈保持；语音 P2M.4 仍 Placeholder。
- 已验证：纯测试63/63，完整隔离Worker19/19（12项确定性、7项真实模型），定向ESLint通过。首图、感知期间撤权、分调用用量及checkpoint无图片字节均覆盖，隔离库配置结束后恢复。全仓TypeScript仍有既有错误。
- **最终DeepSeek合成基线**：xiaok-renovation-v9固定80例×2，160/160通过，含140个真实模型合成任务和20个恢复夹具；六组全通过，保留样本24/24。业务服务为夹具，humanQualityAcceptance仍pending，实际费用未核验。tmp/xiaok-vector/p2m-evaluation-xiaok-renovation-v9-deepseek-flash.json为结构证据；同目录p2m-vision-xiaok-renovation-v9-deepseek-flash.json记录8种合成图片×2的16/16语义通过，p2m-live-xiaok-renovation-v9-deepseek-flash.json为完整Worker证据。历史失败及v8修复前159/160独立保留。否定引用状态和价格规则跨句匹配已修复，后续真实承诺/双重否定仍有拒绝回归。
- **未完成**：代表性装修质量、穷尽多图/模糊/恶意图片文字、任意复杂指代/纠错、独立人工评分、原生手测及0069全恢复演练。当前小样本覆盖不是全面验收。开发启用不等于生产发布；语音仍Placeholder，无ASR采购或DevTools自动化。

开发手测（仅在已授权测试企业启用后）：从原聊天入口问一般布局并换题；依次说书房采光、双人桌及次卧用途，再更正一项并重进；上传合成图片、追问、删除并重进核对衍生消息不可用；查询本人预约/方案/正式户型及他人标识；明确找设计师后确认真实等待、员工接管和旧AI不再回复。普通状态沿用批准共享规则，原生390×844/长屏仍人工待测、非阻塞。

兼容回归：既有问答/需求数据库25项通过，4项旧知识真实模型用例未启用；保留期1项单独通过并断言private_checkpoint=null。首次保留期调用缺专用环境变量而未执行，已在受锁保护的已验证隔离库测试器中补齐并重跑，不把首次失败隐藏为通过。检查命令：`node admin/scripts/assistant-p2m-test.mjs`（默认仅隔离合成数据库），真实Worker另设`ASSISTANT_P2M_LIVE=1`；80案例评测在admin目录设置`ASSISTANT_P2M_SYNTHETIC_PROBE=1`后执行`npx tsx scripts/assistant-p2m-evaluate.ts`。新旧基线均保留，费用未知不按免费计零。


英文镜像：[xiaok-assistant-phase-2.md](./xiaok-assistant-phase-2.md)。

## 当前UI回查与设计来源

用户要求回查并重做偏离源稿的已有UI；结果、工程证据和手测见[总计划3.6](./xiaok-assistant-roadmap.zh-CN.md#36-既有计划与ui回查修正)。chat沿用C01/C02校正版，handoff沿用S01-01/02/B01及共享状态，projects沿用原PPT26 manager.png的已实现子集。恢复品牌/身份、队列/作者头像、消息滚动和轻薄输入，移除客户常驻实现说明与孤立资料表；不把工地协作放进业主私人咨询。P4A另按每工地一份成员共享对话实施，不能由P3A/B完成推断已交付。

原一期PPT5和旧P2A/P2B摘要/同意页是历史基线与兼容API证据，不能覆盖当前C01/C02/S01主稿。客户不先确认摘要、分类图片或填接续同意页；电话等真实后果仍按现行合同单独授权。旧“不能识图/仅规则/本轮还原”描述只代表当时批次，当前Agent状态以上方P3B/P2M为准。

## P2S第一批交付基线 — 2026-10-16

智能核心以[总计划P2M与当前P3B](./xiaok-assistant-roadmap.zh-CN.md)和上方当前合同为准。以下保留P2S当时交互范围，不能把已交付能力重新标为规划，也不能把未交付功能视为已接入。

用户已明确授权按校正版实施 **C01/C02/S01/U01**。客户聊天、私有图片直发、聊天内直接接续、等待补充、员工核对及持久化操作恢复为 **Implemented**。自动理解仍是有边界的中文规则提取，标记 **Limited**；P2S整体 **Limited**。ASR、AI识图、参考推荐及后续批次不在本次交付中。原生视觉/业务手测待执行、非阻塞；未部署生产。

### 当前路由、数据和权限合同

当前五类提示使用批准的固定话术；Admin启用开关生效，自定义开场/顺序/选项仅保留兼容存储，暂不驱动当前聊天。配置页已明确该限制，旧确认API继续保留。

- 客户入口仍为 `packages/assistant/chat/chat`，历史/新对话为次级操作。旧客户交接URL重定向同一聊天。员工从 `packages/assistant/handoff/handoff?staff=1` 进入待接待/我的接待，以及对话/需求/资料局部页签。
- 文字和图片不要求先确认摘要、选分类/房间、提供电话或建立线索。五类引导可跳出；提问、换话题或表达不确定后暂停采访，直到明确恢复，不自动拉回未答题。可选短回顾使用普通消息。支持的明确更正更新带原话来源的工作草稿，不成为正式业务批准。
- 客户发送时自动从最近最多200条客户消息保存摘要草稿，每字段最多1,000字；提取未变化不重复建草稿。保留既有确认记录及仅客户本人可用的旧requirements GET/POST合同，自动草稿不覆盖已确认字段。显式命名的多房间分别保留于room字段；后来的同房间分句替换该房间工作描述。隐式跨房间指代、通用语义冲突消解仍Limited。
- 既有客户 `POST /api/miniprogram/assistant/conversations/:id/handoff` 直接接受 `{action:'request'}`；明确自然语言找人请求进入相同等待状态，无额外资料分享同意表。电话联系仍是兼容API中的独立可选授权字段，本批不主动索取电话。正式报价/具体项目工期及沟通卡住的规则共用“请设计师接着聊”，不编造报价、预约或响应时限。
- 等待中可补文字/图片和更新草稿，不创建AI任务。原子接管后在同一对话进入human；退出接待返回waiting，取消/结束恢复AI并撤销服务访问。转接状态写入持久化system消息，区别于AI/真人回复。接待人被停用时显示暂不可用，不虚报已结束。
- 员工接管前的队列/详情只给分派状态、标识和接收人，不给packet、原文或私有图片。每次读写重验当前有效接管、租户、角色和身份。小程序保留设计师/企业管理员入口；Web另需原enterprise-admin/menu权限，不增加企业全部客户访问权。
- 既有员工POST `/api/miniprogram/assistant/handoffs/:id` 及Admin等价端点增加 `correct`、`associate`、`link`，携带 `expectedVersion` 和 Idempotency-Key。修正把字段/内容/客户原话消息/操作者/时间/备注写入 `entry_snapshot.handoff.packet.corrections`；图片分类、房间及授权线索/户型/房间标识写入 `packet.mediaAnnotations`。客户投影剔除内部标注，不视为客户确认。
- 候选限定为本对话客户的有效线索，并符合当前员工原有企业管理员或assigned/promoter范围。仅已完成主正式version-4户型通过只读适配器提供房间。关联只改handoff.leadId，不建档/合并、不改分配/推广佣金、不编辑墙图或写回旧layout。候选展示标识以区分同名档案。
- 图片继续使用鉴权私有JPEG/PNG（每张4MB、每对话20张）；删除/源撤回/当前权限重验后显示不可用占位。员工分类不改图片字节。麦克风/人像PNG沿用Lucide/ISC，不暗示ASR或识图已可用。 AI模式成功传图会在同一事务保存system收图提示，说明暂不能识图，可补充问题或找设计师；复用C01/U01既有状态，不改布局。原请求重试不重复提示、重进可见；失败不报成功，等待/人工模式不插话，不创建模型任务。首图/并发重试/重进/接续边界的真实数据库回归通过。
- 未知写入结果在存储可用时以当前会话绑定的本地journal保留原key/body，重试/重进核对同一次操作；存储失败退回内存，不能保证进程重启恢复。身份失效隐藏内容；普通网络故障保留可恢复输入。员工核对及原话跳转目前覆盖最近100条消息，更早来源保留摘录、不做虚假跳转。

### 已批准设计与元素台账

来源目录：`design-references/xiaok-assistant-chat-first-batch1-v1/single-screen/`。11张校准主稿/关键变体为C01-01/02/03、C02-02/03、S01-01/02/03、S01-B01/02/03 PNG；U01沿用设计README中的共享状态规则。单屏853×1844按宽度映射390×844，替换chat/handoff的旧PPT路由基准；旧requirements页保留自己的PPT源。

| 元素/路由 | 来源校准的实现边界 | 验证 |
| --- | --- | --- |
| 聊天画布/导航 | 动态胶囊右侧避让≥96px，读取状态栏/胶囊top；品牌本身返回，不加额外箭头；消息独立滚动；移除常驻实现说明，临近字数上限才显示计数 | 当前24例辅助几何/离线编译；完整宿主胶囊截图待测 |
| 聊天阅读组 | Hero48rpx、正文32rpx、辅助/工具28rpx；头像72rpx、间距16rpx、外侧36rpx；阅读组内不使用增长留白 | 已同宽查看来源；光学/运行时验收待测 |
| 输入/图片 | 图片/麦克风独立图标48rpx、触区72×84rpx；私图宽420rpx；行内发送/失败/未知反馈 | 控制器及上传恢复测试；键盘/长屏待测 |
| 员工队列/工作区 | 品牌40rpx/角色24rpx、页标题36rpx、Hero42rpx/212rpx固有高、正文32rpx、辅助22–26rpx；队列头像112rpx、真实分栏数/空态；字段标签128rpx。接手后头像72rpx/间距16rpx、局部消息滚动、输入30rpx/发送84rpx；原话定位消息区，键盘去掉重复底部安全区 | S01主稿/变体；72项回归/离线编译，原生光学及键盘QA待测 |
| 插画 | 同一隐喻复用独立生成的 `xiaok-consultation.png`、`xiaok-chat-avatar.png`、`xiaok-chat-room.png`、`staff-handoff.png` | 来源见 `docs/icon-sources/assistant/README.md`；无截图切片；打包PNG≤300KB |

### 状态覆盖与手测

| 触发 | 可见反馈/动作 | 恢复及边界 |
| --- | --- | --- |
| 文字/图片发送、结果未知 | 行内发送/重试/核对 | 原操作key，不重复提交 |
| 换题/更正/回顾 | 回答当前话题，工作草稿/可选文本回顾 | 不强制摘要页，不视为业务批准 |
| 请求/等待/接管 | 真实状态通知、继续补充、取消/结束 | 持久化同一对话；等待/人工不跑AI |
| 员工修正/关联冲突 | 成功/错误反馈，版本冲突刷新 | 仅当前接待人；重进读持久化内部记录 |
| 来源撤回/身份撤销 | 不可用占位或清除受保护内容 | 每次服务端重验，不以本地缓存替代权限 |

自动验证：11项真实隔离数据库需求/接续测试通过，包含鉴权HTTP/控制器重进、并发抢接、等待补充、内部修正幂等、跨范围关联拒绝、保留清理和正式墙图不变。另有Admin助手纯测试45/45、小程序助手43/43、ESLint、82WXML/85Less离线编译及diff核对通过。小程序全量一轮1898/1899，唯一失败为未修改的API环境选择测试（当前远程地址与预期本机地址不同），不记为全量通过。本批文件的TypeScript检查无错误，仓库全局检查仍有既有错误。webpack代码编译成功，但Admin完整构建被既有 `/api/leads` 的 `leadDtoForMini` 路由导出类型检查阻断；默认Turbopack另遇Windows junction错误，均不记为完整构建通过。

人工待测：(1)零信息开聊、换话题、更正预算/两个命名房间、请求短回顾；(2)直发图片，在结果未知时退出重进并核对只有一条；(3)直接找设计师、等待补充、员工工作台接管、双方回复和重进；(4)引用原话修正、分类并关联有权户型、退出/结束后确认撤权和AI恢复；(5)390×844及长屏的原生胶囊、文字/图标尺度和键盘。未使用DevTools自动化。

## 旧P2A/P2B基线（客户入口规则已被替代）

下文保留此前实现、迁移证据及兼容API。其摘要/同意/资料表入口要求和接管前packet可见性由上面的当前P2S合同替代，不代表当前客户主路径。

## 兼容基线：旧P2A.1摘要与房间API（非当前主流程）

已批准 PPT 第5/6/15页要求的是咨询，不是必填问卷。工具栏始终保留摘要入口，记录三项答案后另显提前整理入口；未确定/空值仍待补充。原话常态可见，作为参考，与可编辑及已确认值分开。

默认 schemaVersion3 为原八题加 room/space/usage/frequency/devices 五题。housing/household/style/budget/timeline 为必备字段键但允许空值，五个房间字段可选。已有房间/空间语境时优先补齐该组缺口。设备多选后确认才发送，只有单选点击即发送，仍支持自由输入。当前支持一组房间需求，不支持多个房间的独立版本。

后台 `/assistant-knowledge` → 需求引导话术沿用 `GET/PUT /api/assistant/guidance`：文案/顺序、single/multiple/text 回答类型、0–6个不重复选项（每项1–30字）及快捷跳过配置。关闭快捷跳过不禁止自由输入“不确定”。已有配置须显式切换新模板；新对话保存快照，历史 schema1/2 会话不重解释。

摘要确认值按 source_seq 边界反馈引导重放；之后明确更正重新进入待确认。新草稿保留确认值，原话仍独立。确认取消在途旧 AI 并推进 context_revision。提取仍为有限关键词/规则，不代表任意语义理解，冲突或含糊原话须客户核对。

原生 `packages/assistant/requirements/requirements?conversationId=…` 仍为 customer.service 下客户本人页面。`GET/POST /api/miniprogram/assistant/conversations/:id/requirements` 使用 Idempotency-Key；draft 生成原话草稿，confirm 要求 draftId/expectedVersion/fields/consent。新客户消息或新草稿使旧草稿失效。最多200条客户消息、每字段1000字；空会话不能生成摘要。未确认修改仅本地保留，离开有提示。人工/已结束/企业关闭时只读；身份失效清空正文。保留期清理原话和确认内容，幂等重放不能恢复。

## 兼容基线：旧P2B独立授权页（非当前入口）

客户聊天及摘要提供“找设计师”，空聊天可先建会话，不必答题或留手机号。接续页说明接收人（企业团队或可用指定人员）、分享的摘要/近期文字及后续消息。资料同意为必要条件，电话联系和关联本人已有活动线索各自单独可选；会话内沟通无需电话。

申请持久化真实等待状态并取消 AI，不显示虚假在线。客户可等待、取消/结束回 AI，或进入既有预约适配器：有本人活动线索打开客户预约，无线索说明后进入已有留资页，不自动建线索、不另建派单或佣金流程。

设计师/企业管理员的小程序工作台进入 `packages/assistant/handoff/handoff?staff=1`。接单前仅可读客户授权资料包；原子接单授予当前请求的 handoff_staff 成员权，并将同一会话切为 human，多人竞争只有一人成功。双方发送持久化文字，不创建 AI 任务。员工明确退出撤权并回到等待；客户取消或任一方结束撤权并明确恢复 AI。停用/解绑/身份变更或成员撤权后不可继续访问；重进恢复真实状态。

后台 `/assistant-knowledge` → “真人接续”提供队列、授权资料、接管、回复、退出与结束，使用共享操作反馈。Web 要求 enterprise_admin 及既有 assistant-knowledge 菜单授权；Mini 允许已绑定的有效 designer/enterprise_admin。知识管理员或平台管理员不会因此获得客户会话权。服务端重验租户、角色、身份版本及成员授权；未知写入复用原键和正文核对，不发第二次操作。

### 接口、存储与限制

- 客户 GET/POST `/api/miniprogram/assistant/conversations/:id/handoff`：request/cancel/end。
- 员工 GET `/api/miniprogram/assistant/handoffs`，GET/POST `…/handoffs/:id`：claim/reply/release/end。
- 后台 GET `/api/assistant/handoffs`，GET/POST `…/handoffs/:id`，复用相同服务及更窄的 Web 授权。
- 状态/同意/接收人/接待负责人/来源/可选 lead 和资料包存于既有 conversations.entry_snapshot，成员沿用 participants。幂等只存标识；会话保留期清理 entry_snapshot 时一并移除资料包及电话。事件保留动作/同意/标识，不记录电话或原文。
- `0066_assistant_handoff_guard.sql` 更新既有成员/消息触发器为请求级接待授权，保留预览规则与强制 RLS。开发主库和隔离评估库已应用并核验哈希/触发器，生产未操作。已验证迁移前备份：`tmp/xiaok-vector/phase2-pre-migration-2026-10-15T16-55-06-791Z.dump`。
- 文字资料包最多近期200条（超出有提示），员工接管后视图最多近期100条；P2A.2另增下述单独授权私有图片。尚无员工历史翻页、在线状态、外部推送或自动升级接待；活动页每3秒轮询。接单不修改推荐来源、线索负责人、预约派单或佣金；自愿关联线索只是关联，不写正式项目需求。

## 兼容基线：P2A.2私有图片与正式快照API

**整体 Limited；图片与正式户型快照 Implemented。语音仍 Placeholder：**用户确认暂时没有 ASR 服务，未启用付费服务。图片不发送给视觉模型，不代表小K已经能理解图片。

客户入口：聊天输入框图片按钮→既有资料弹层→上传 JPEG/PNG、选择参考图/户型图及可选房间名称→查看/删除→历史重进。每张不超过4 MiB，解码不超过2400万像素，去元数据、铺白并规范为2400px内JPEG；保存的是可查看的规范化副本，不承诺逐字节保留原文件。每会话累计最多20张，删除记录也计数。未知结果沿用相同图片/正文/幂等键重试；上传写持久化提示，不创建AI任务。会话归档或企业停用后，客户仍可删除自己的资料。

“选择已有正式户型”只列本人、同企业、未归档线索的已完成主正式v4户型，可选整屋或已闭合房间。服务端核验归属、房间和 layoutHash，生成私有不可变快照并记录来源标识/版本；后续量房修改不悄悄替换快照。读取时重验来源线索及主户型仍归原客户。不会写 FloorPlan 图、线索负责人或佣金。

- 客户 GET/POST `/api/miniprogram/assistant/conversations/:id/media`；GET/DELETE `…/media/:mediaId`；GET/POST `…/media/floorplans`。写入要求 Idempotency-Key；删除按资源幂等。
- 员工 GET `/api/miniprogram/assistant/handoffs/:id/media[/…mediaId]`；后台 GET `/api/assistant/handoffs/:id/media[/…mediaId]`。每次读取重验既有租户、角色、身份和当前请求/成员授权；后台仍要求 enterprise_admin 加菜单权。
- 新接续同意明确包含本次及后续上传的图片资料，记为 `mediaConsent: true`；没有此标记的旧请求不授予图片。员工小程序和后台授权资料卡按需读取私有预览；取消/结束/撤权后失去服务端访问。
- `0067_assistant_media.sql`、`0068_assistant_media_source.sql` 新增强制RLS的 `app.assistant_media`，私有 bytea 正文及不可变 source_ref，无公开媒体URL。删除/保留期清理字节、房间标签和来源，保留墓碑防止复活。此限量存储不是通用大媒体库。
- 设计：draw-ui 对应批准PPT5输入框图片入口、PPT14正式户型入口，沿用已还原弹层/卡片和插画。新增Lucide图片图标48rpx、触区72×84rpx；资料标签32rpx、上传/选择操作28rpx且最小84rpx，操作间距16rpx。资源 `miniprogram/packages/assistant/assets/image.png`，PNG96×96/1,089 bytes，许可见 `docs/icon-sources/assistant/README.md`。无截图切片或新增业务插画。
- 验证：Mini专项53项及离线编译（82WXML/85Less/225JS/88JSON）通过；图片和正式户型数据库测试覆盖真实HTTP写入、RLS、同意、撤权、删除/保留期、同键重试、旧版本/他人房间和原图数据不变。定向lint和隔离Next构建通过。原生视觉及后台登录态运行验收待手测、非阻塞；无DevTools自动化、无生产部署。

兼容API回归仍核对正式快照、旧许可、跨范围拒绝及删除/保留期，不再以客户先填房间、选户型或签分享页验收当前入口。当前手测使用下方步骤，员工接管后才在资料页做分类/关联。

## 旧路由视觉核对（不覆盖当前C01/C02/S01主稿）

本节只记录当时旧摘要/独立接续页的尺寸修复，不能作为当前chat/handoff的布局、同意步骤或字号依据。现行元素表在上方；旧requirements兼容路由仍保留PPT6来源。

小K视觉修正（PPT5/6原设计）：按用户反馈使用 draw-ui 测量与校准流程，853px宽设计图映射到390px逻辑视口；区分字形、图标容器与透明插画可见主体。聊天正文32rpx、工具28rpx/38rpx图标；摘要标题52rpx、字段32rpx、72/54rpx图标容器/图片、44rpx编辑图标；接续标题54rpx、章节36rpx、正文32rpx、说明28rpx；两页CTA34rpx/最小104rpx。摘要插画288×276rpx，接续插画362rpx高。保留真实摘要预览、独立同意及既有读写流程；本轮仅尺寸/间距样式，无后台/API/模型/权限变更。49项相关Mini测试、82WXML/85Less离线编译通过。真实WXML/Less的本地诊断夹具360/390/430宽度9例无横向溢出，390下摘要/接续值宽157/182px；仅浏览器辅助证据，非微信验收。用户已指出旧光学尺度不合格；当前原生字形/胶囊/键盘/长屏QA仍待手测、非阻塞。测量锚点、取舍及素材映射见二期契约。

本轮四张截图显示品牌和横向字段挤压已消除，但schemaVersion3空键错误展开了房间组；现五类基础字段常显，可选房间字段仅在有原话、确认值或编辑值时展示，摘要与接续共用此规则，原数据不删、不改提取或权限。截图中的“使用方式：需要办公”保留，其余空房间项不再占行。49项相关Mini测试与原生离线编译通过；截图未含原生状态栏/胶囊，不能关闭安全区验收。

| 元素 | PPT归一/实施目标 | 验证边界 |
| --- | --- | --- |
| 品牌/返回 | 40rpx单行品牌；返回56×84rpx；胶囊左侧 | 390下右界284px，预留106px；原生未重拍 |
| 聊天工具 | 28rpx字/38rpx图标/84rpx触区；正文32rpx，标题48rpx | 三宽度四项同排，顶部找设计师右界在胶囊预留区左侧；键盘收起行为保留 |
| 摘要行 | 标题52rpx；字段32rpx；72rpx内容+上下各18rpx=108rpx；72/54rpx图标容器/图片，编辑44rpx | PPT行距约97rpx，本轮为更大字形及动态内容增至108rpx；390下值宽157px，编辑触区84rpx，不挤压正文 |
| 原话/CTA | 原话标签28rpx/正文30rpx；CTA34rpx、104rpx最小高、100%宽 | 动态原话自然滚动；摘要插画288×276rpx，alpha>32主体约183×227rpx；原生光学验收待测 |
| 接续 | 标题54/章节36/字段32/说明28rpx；插画高362rpx、宽为内容+32rpx；字段图标52rpx、纵向内距18rpx；电话输入至少96rpx | 390下字段值宽182px；授权前只读摘要，空态明示；原生勾选/键盘待测 |

辅助证据：`tmp/xiaok-vector/ui-layout-probe.cjs`、`tmp/xiaok-vector/ui-layout-results.txt`、`tmp/xiaok-vector/ui-{chat,requirements,handoff}-{360,390,430}.png`，仅浏览器诊断夹具截图。

## 既有独立素材与历史来源

权威PPT保持原文件。PPT5/6及旧客户/员工接续图是当时来源，现行chat/handoff采用上方已批准C01/C02/S01校正版，不恢复旧独立接续页。requirements兼容路由仍用`design-references/xiaok-assistant-phase1-ppt-v1/sources/slide06-needs.png`；房间/设备为phase2 sources内slide15参考。独立素材可复用，素材来源不等于旧页面布局重新生效。

使用内置 ImageGen 独立生成透明插画，优化后打包，无截图切片：

| 业务隐喻 | 独立来源 | 生产路径 | 已核验格式/大小 |
| --- | --- | --- | --- |
| 客户：小K交接房间需求册 | `design-references/xiaok-assistant-phase2/generated/customer-handoff.png` | `miniprogram/packages/assistant/assets/customer-handoff.png` | 透明 PNG，780×390，73,659 bytes |
| 员工：小K、记录板与薄荷绿房屋 | `design-references/xiaok-assistant-phase2/generated/staff-handoff.png` | `miniprogram/packages/assistant/assets/staff-handoff.png` | 透明 PNG，780×520，57,878 bytes |

本轮尺寸以当前元素表为准，复用独立需求插画（480×459/40,817 bytes）及既有接续PNG，无新增图片、无截图切片。draw-ui测量清单和标注位于 `tmp/xiaok-vector/draw-ui-{summary,handoff}-regions.json` 及对应 `draw-ui-*-measurement/`。人工锚点中摘要标题字形高49px、字段29px、编辑图标31px；接续标题57px、字段26px、插画主体760×319px，均按390/853归一。选区为人工视觉测量，不是自动识别。实施字号考虑实际字体差异及用户要求放大；插画为既有独立生成资产，轮廓比例与PPT存在差异。摘要alpha边界305×378/480×459、接续727×302/780×390，用可见主体校准而非只看图片框。保留30/32rpx页面边距、24rpx卡片内距及原生胶囊空间；动态内容自然滚动，不按剩余屏高拉伸。未使用DevTools自动化，原生390×844/键盘/长屏手测仍待完成。

## 验证与手测步骤

后端最终回归77/77通过，含图片/户型及既有问答/摘要/接续/保留期；Mini专项53/53，82WXML/85Less/225JS/88JSON离线检查通过。定向lint及隔离Next构建通过。证据：`tmp/xiaok-vector/phase2-tests.{json,log}`、`media-mini-tests.txt`、`platform-build.log`。360/390/430浏览器诊断12例无横向溢出，非微信验收。全量Mini仍有既有开发URL断言差异；原始全项目tsc有既有生成页面/测试类型错误，未声称全项目tsc通过。原生/后台登录态/真机手测待执行，无生产部署。

1. **客户聊天**：零资料直接聊，补充/更正预算和命名房间、换话题、请求短回顾，不跳摘要确认。选图即发，不填分类/房间表；历史重进、删除/撤回显示真实状态。
2. **直接接续**：按钮或明确请求真人后，原聊进入等待，无额外同意页；可补文字/图片，小K不抢答。取消按真实状态恢复，电话单独授权，不强制预约/留资。
3. **员工S01**：切待接待/我的接待核对数量/空态；选择元数据不读私聊，成功接管再同聊回复。检查局部滚动/键盘/原话跳转、需求修正及资料分类/关联、重进；两人抢接只成功一位。
4. **边界/工地**：结束、停用、撤权或换身份后不能读旧资料；未知写入核对原请求。工地列表只显已分配/本企业项目，查看/保存节点与分工后重进。390×844/高屏原生胶囊和字形待手测，未执行不算通过。

## 后续路线范围

C01/C02/S01/U01第一批设计已明确批准并实施。客户不看/不确认摘要、不标图片分类也能继续服务；原话、自动理解、员工核实与正式批准分开。等待期可补充信息但AI不抢答，拒绝电话仍可站内接续；施工到场协商不强迫进入量房流程。复杂专业操作按真实身份/项目权限分给设计师、经理及运营，不授予全企业私聊读取。保留已确认记录、历史入口、媒体撤权和幂等，新增自动处理不能覆盖正式批准。

P2A.2仍Limited：图片/正式户型快照Implemented，录音/转写/回放Placeholder，ASR独立接入不阻塞文字/图片。P2A.3授权参考、P2C.1后台作品与P2C.2原PPT设计室/作品/原咨询限定闭环Implemented；高德实际权益/联调和后续内容扩展使P2C整体Limited，小程序发布不在首版。P3A提供可配置实际节点、站内到场提醒及实时员工电话，P3B的3.4限定补问/原聊天补充/设计师核对已实施；需求/方案正式关联、专用事项/正式决策及P4–P6仍有未实现范围。完整设计清单与后续验收由总计划维护，不另建并行路线。新设计、生产发布和供应商采购保持独立授权边界；待测人工验收不阻塞下一已授权开发阶段。
