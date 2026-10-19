# 小K第二期：需求整理与人工交接

## 当前Admin原操作键边界

**共享Admin原操作键：限定修复已Implemented，整体Limited。** `AssistantMutations.write` 原样发送调用方显式键，与隐式内存重试缓存分离。已知成功/拒绝仅能清理仍属于本键的隐式缓存，迟到回执不能删除较新操作。知识调用方继续按企业/管理员隔离恢复记录，并核对原正文、回执账号范围与batchId；恢复必须提供原键。共享封装不为旧隐式调用自动识别账号切换。原服务端租户/角色/来源/幂等守卫、未知结果及费用仍为权威；无API/schema/权限或产品markup/样式/文案改动。

验证：新增6/6共享反例修复前失败；修复后新增共享/调用链9项、既有Admin14项与知识客户端7项共30/30通过。实际知识客户端覆盖A未知→B同体请求→沿B原键重进恢复，分别检查账号及租户变化；B已知成功后不派发多余恢复。所有fetch均为模拟，只证明请求头/恢复记录行为，不证明真实数据库重复写入或模型执行。类型287→287、新增0，定向lint通过；全量 `npm run lint` 退出0，保留30项既有warning。证据 `tmp/xiaok-mutation-identity/{before.log,after-caller.log,type-comparison.json,lint-final.log,lint-repository.log}`。Mini客户端/runtime及批准UI无影响。见[共享请求键合同](./xiaok-assistant-phase-2.zh-CN.md#当前admin原操作键边界)。

## 当前明确取消等待接待

**等待设计师时客户明确取消：整句明确文本的闭环已Implemented，整体Limited。** 原C01输入框发送“取消人工接待”或“不找设计师了”，沿原 `POST /api/miniprogram/assistant/conversations/:id/messages` 请求键及取消事务，保存原话与既有“本次接续已结束，小K恢复回复。”系统反馈、撤销接待参与者、推进上下文/版本并回到AI，不创建run或供应商调用。仅本人所属、仍open且 `handoff_requested/waiting` 的会话可改变；已进入人工接待、提问、引用、假设和拒绝取消仍是普通消息。租户、本人、来源、留存、接单竞争与幂等守卫保留。

验证：离线259/259；真实隔离PostgreSQL服务7/7组加Stable C01原生1组，390×844原生10/10检查点。取消已提交但HTTP回包丢失后，重进保留原操作，“确认发送结果”沿原键恢复同一回执，再次请求/取消可用。最终源码hash稳定；本夹具run/attempt/模型开始及剩余合成企业/用户/员工均0，共用锁已释放。类型287→287、新增0，定向lint通过。产品markup/样式/资产/导航/文案均未改；唯一批准C01源仍为 `design-references/xiaok-p4b-public-sites-v1/README.md`。功能截图 `tmp/xiaok-handoff-cancel/service-native-attempt-6/native-cancelled.png` 不代表完整宿主/高屏/真机/真实微信/BLE或通用语义通过。见[当前接待合同](./xiaok-assistant-phase-2.zh-CN.md#当前明确取消等待接待)。

实现复用既有客户接待写入器，不增加API或另一套状态。用户原话、取消事件/系统消息、接待参与者撤销、原run取消栅栏、上下文/版本和原发送回执在同一事务提交；等待状态复查失败会回滚刚追加的消息。与员工接单竞争只留下合法的已取消或人工接待状态，取消后的迟到接单拒绝。新请求之后重放旧取消键只返旧回执，不取消新请求；同键改正文冲突。识别仅为限定中文整句，不是通用意图理解；进行中的人工接待仍需原授权操作结束。

复跑：在admin执行 `node scripts/assistant-handoff-cancel-acceptance.mjs` 为2组纯意图检查；配置已批准本地连接文件/环境及指向既有Stable项目的 `XIAOK_AUTOMATION_ROOT` 后，执行 `node scripts/assistant-handoff-cancel-acceptance.mjs --service --native --wait-for-lock`，在夹具前获取共用锁，输出目录须为新的worktree tmp子目录。业务HTTP为真实响应，仅刻意丢弃一次已提交回包；不算实模证据。初次服务红测/清理、早期原生脚本错误及编译超时均留在 `tmp/xiaok-handoff-cancel/`，只有最终 `service-native-attempt-6` 作为通过交付。未恢复历史4369/4242或未知费用，未启动Worker、部署或生产启用。

<a id="当前共享供应商连接错误与结果确定性"></a>
## 当前共享供应商连接错误与结果确定性

**共享供应商连接错误：限定修复，整体Limited。** 已调用fetch后，无响应的普通连接/TypeError现归`unknown`，不再是`safe_fallback`，不能据此自动向第二供应商提交。错误码/文字/状态、配置超时及原明确HTTP响应/派发前策略保留。attempt/run/用量/预留及租户/角色/来源/租约/回执接口保持，不改表、队列、factory、API或UI。347762ff归档run4369/attempt1804仍为attempt failed/accepted=false、run indeterminate、预留reconciling及费用null；原queued发送确认和该布尔均不是供应商接收或未接收证明。不改历史行/费用/请求键，不重试4369/4242。当前230/230离线通过，含194业务/知识、32项既有供应商/账务和4组模拟传输测试（修复前1组失败）；受影响lint通过，同程序与05edc4d3对比类型287→287，新增0。无新DB/供应商/实模/Embedding/浏览器/原生调用；PostgreSQL收敛/retry守卫仅源码核验，未重跑。缺供应商结果/用量证据，原夹具也已清理，费用收敛和实模语义仍未验。准确只读证据及合同见[传输确定性](./xiaok-assistant-phase-2.zh-CN.md#当前共享供应商连接错误与结果确定性)、`tmp/xiaok-provider-certainty/`。

只读原归档：操作send:4327、原键f70b08ac-26af-4e9b-8101-36bc828261ba绑定conversation4327/message21543/run4369；queued是不可变的本地准入确认，不是当前run结果或供应商回执。一次text_model客户端fetch记录transport_unknown，响应0、无输出；turn0的agent_model开始标记仍running。attempt1804真实是failed/accepted=false/actual_cost={}，不能改写成unknown attempt；该状态来自HTTP层将普通连接错误归safe_fallback。原send、供应商body及attempt的hash属于不同层，不假定彼此相同。

冻结0fe63d5d相关HTTP/gateway/Worker/队列实现与诊断基线05edc4d3一致。Worker在开始事务后将outcomeKnown置false，failRun对已开始且结果未知保持indeterminate/reconciling；retry只允许failed/cancelled且无reconciling预留，accepted=false不能令原run可重试。accepted布尔是保守内部路由/审计标记，正反均不是供应商实际接收证明。未来HTTP分类改用原unknown路径，不重写1804、不结算4369；不新增对账通道、重试或模型循环。原HTTP401/429/503显式响应策略保持，也不据此声称费用0。

证据tmp/xiaok-provider-certainty/incident-evidence.json记录原归档hash及回执/状态；before.log保留传输反例3/4通过、1失败，offline.log最终230/230；type-comparison.json和lint.log为本次工程结果。知识工作区原tmp/knowledge-semantic-followup/live-1/live.json的SHA256为a97df5ae9b7f4b3aed68d04082b84577096faec418961e3991363d9d4dd456a5，只读未重执行或改动。本补丁DB/实模/Embedding调用0；此前知识一轮失败文本fetch和成功索引保留各自范围，不计成本轮调用。知识原夹具已清理，当前无行不表示账单已知；仍缺供应商结果/计量证据，不重发、不换键、不填零费用。

在admin/用node --import tsx --test src/lib/ai/__tests__/provider-transport.test.ts复跑模拟传输反例；原供应商/AI及194业务测试合为230项。本次未声明全仓类型干净、无关旧页面完整构建通过、实模语义或原生/真机验收。



### 当前恢复证据边界

知识稳定`0030eb8245c40f2fe18f5530da013eb75366a06f`仅只读核验，未合入或重跑。独立run4370真实PostgreSQL/C01撤回1组通过，向量/回答为确定性注入，5项证据断言通过；真实模型/Embedding/供应商fetch为0，107张企业表及身份清零、当次互斥锁释放。这些结果不证明4369的供应商结果，也不累加进本补丁230项离线检查。

| 归档run | 已留存证据 | 缺失恢复证据 | 当前授权 |
| --- | --- | --- | --- |
| 4369 | 原send key/hash、failed/accepted=false attempt、indeterminate run及reconciling预留 | `originalCreateKey: null`；当前夹具行已清理 | `archive_only_wait_shared_review`、`dispatchApproved: false` |
| 4242 | indeterminate run、unknown/accepted attempt及reconciling预留 | 原create/send key及request hash保持null；当前夹具行已清理 | `archive_only_wait_shared_review`、`dispatchApproved: false` |

“最多一次未来执行”是上限，不是授权。仅send归档不是可调用`originalSubmission`的完整create/send证据；不探测、不补造键、不建立等价替代发送。仍缺可靠原身份/操作证据、有效授权恢复机制及供应商结果/计量证据；新增撤回检查和仅未来生效的连接分类均不能解除这些阻碍。源证据为知识工作区`tmp/knowledge-revocation/recovery-preparation.json`、`stage-summary.json`和`service-1/`；共享核验为`tmp/xiaok-provider-certainty/recovery-review.json`。本补充只有文档/证据影响，模块清单当前运行行为、API、角色和UI均不变。

<!-- continuity:start -->
<a id="当前p3bp4a客户更正与原事项接续"></a>
## 当前P3B/P4A：客户更正与原事项接续

**限定实现，整体Limited。** 沿路线图3.1及PPT15/23/37/38，复用下文获权来源、精确正式版本与处理链。当前行为为v63；下文v43及更早执行记录只保留各自范围的历史证据。

v63保留v62的quote实际位置、限定词与房间校验，修正既有人数阅读辅助：被否定或暂定的人数不算已确定，完整可用原话仍为known并逐字保留；更正中的肯定分支用于原当前来源引用守卫，已知人数确认及出处围栏不放宽。明确“人数未定”也会限定旧desk/other混合行中的人数，来源不可用后沿原无值标记防止旧人数回流；原历史、桌型/位置、设备、其他房间及来源/权限检查保持。不新增事实库、schema、API、客户端状态/布局或队列。提示元数据为v63，静态提示/工具措辞、sources-v11、六段/每段四引用和48,000字节预算保持。当前194项去重离线通过（原188＋6组合成解释反例），5项受影响TS文件lint无错误警告；同程序与04a85946对比类型287→287，新增0。已保存回答/预算仅离线回放，无新实模/Embedding/DB/浏览器/原生调用，也未占用验收锁，不升级语义或原生验收。旧完整构建限制不属于本次小客修复。命令、有限措辞边界及旧页面准确诊断见[二期当前合同](./xiaok-assistant-phase-2.zh-CN.md#当前p3bp4a客户更正与原事项接续)、`tmp/xiaok-need-interpretation/`。

在`admin/`复跑下列命令：首条将`XIAOK_ACCEPTANCE_OUTPUT`设为本工作区证据目录；未改动的类型助手仍写`tmp/xiaok-execution-fence/`。新增6组解释反例是合成离线测试，既有数据替身及保存回答回放也仍为离线证据，不新增数据库夹具或付费调用。对应既有路线图10.1第1/3场景，仅为内部可靠性增量，不宣称完整阶段验收。

```text
node scripts/assistant-execution-acceptance.mjs --agent-units
node --import tsx --test src/lib/assistant/__tests__/need-source-context.test.ts src/lib/assistant/__tests__/guidance.test.ts src/lib/assistant/__tests__/requirements.test.ts src/lib/assistant/__tests__/knowledge-batch-seam-acceptance.test.ts src/lib/assistant/__tests__/need-interpretation.test.ts
node scripts/assistant-execution-typecheck.mjs 04a85946eb63ec8418ae75877d44cc2e0c3dd4a9
```



本次构建诊断（未改无关产品代码）：安装的Next16.2.3会拒绝`admin/src/app/(admin)/(merchant)/ai-studio/designer/page.tsx:27`额外具名导出`AiDesignerLegacyPage`。读取本机Next页面校验器的允许键，以实际模块做静态TypeScript校验，复现TS2344：该函数不能赋给never。导出来自4487a09df，无产品消费者；默认入口只重定向`/ai-studio/scenarios?view=assistant`，未使用旧函数调用`/api/ai/*`，不属于当前小客`/api/assistant`。按父任务范围仅诊断未修，该轮没有执行完整Next构建。准确诊断/脚本：`tmp/xiaok-need-interpretation/build-export-diagnosis.{json,mjs}`，不把旧构建/类型限制算通过。

- 明确更正后紧接专业提问仍可调用`record_need`，服务端绑定实际当前消息/房间，拒绝假设和转述建议。原参数兼容，新增可选`additionalNeeds`最多三条，合计四个独立房间/字段；先核验全部原话及重复字段，再同事务保存记忆、自动草稿及对应原事项进展。四条原话不必耗尽四个模型轮次，任一条不合法则全部不写。首条操作键保持，附加条目用`:need:n`；已提交批次恢复不重复事实、进展或供应商调用。单条/重进也返回`savedFacts`，高版本回执优先于开轮旧记忆，不形成正式批准。
- 存储的`NeedMemory`更正链仍是不可变原话记录。材料的need元数据携带字段/值/supersedes及客户表达身份。只读`qualifiedBy`限定兼容desk/other混写人数与位置的旧行，仅关联同咨询/房间、后续明确且当前有效的use更正，只限定人数；原话、桌型、靠窗、设备、其他房间均保留。仅使用当前获权原话，来源失效时关系不复活旧内容。更正来源不可用时保留无值interpretation屏蔽标识，不能回退旧人数；`NeedMemory.interpretations`及材料的`need.interpretation`为只读`{ factId, field: 'use', currentFactId }`，不可用时`currentFactId: null`，不由`applyNeedDelta`持久化。`query_followups`事项也经`availableNeedMemory`读取，不能从另一适配器带回失效值，不暴露不可用更正的值或来源ID。不是第二套记忆、正式变更或共享grant。其他复合字段增删、隐含更正和复杂多房屋/跨阶段冲突仍Limited。
  可用性继续沿用原消息及其run的工地来源依赖；本轮共享图撤回使同轮更正的既有依赖链失效，当前use按未知投影，原更正链仍保留。这不是客户明确撤回其人数更正的业务决定，未新增需求撤回入口。
- 绑定房屋的`search_knowledge`现复用`queryNeedIssues`，将`synthesis.bound_followups.v1`与原材料、实际施工快照一起持久化，保留原咨询、稳定issueId/revision、真实负责人/等待对象及来源版本。显式和绑定路径共用缓存/恢复、每次模型调用、提交、历史及接续包守卫。需求补充、团队明确回传的现场事项与正式决定分别溯源；普通解释不新建/分派事项，也不批准、落实、解决、关闭或共享。
- 事项模型来源按业务内容描述当前状态，正文不展示内部事项编号，ID/修订仍用于来源核对。当前用途、旧混合记忆、旧共享原话、团队图纸关联及精确正式决定不混用；旧版描述不覆盖后来客户更正，更正也不改该版决定或冒称送达内部负责人。靠窗意向已知则沿用，可量测坐标/检查记录缺失只说明本轮查询未知，不认定现实没有做。电话缺失不成为原聊天沟通前置；内部负责人姓名不证明客户已获直接拨号/私聊渠道。
- `current-turn-sources-v11`只改变模型视图：保留标准工具配对、结果键、完整原文和全部权限/版本元数据；显式与绑定查询中完全相同的来源共用一份完整正文，并保留来源ID/结果键别名映射，不合并不同版本、决定、受众或元数据。材料汇总只说明范围/缺项，不再复制全部原文。触发消息之后的修复反馈按原顺序只保留一次，压缩重复协议文案，不删引文修正数据、不增加修复轮次或放宽守卫。持久检查点/快照、来源重验及原48,000 UTF-8文字字节/四轮上限不变。上轮v51的被拒入参49,133→40,698文字字节属于历史投影证据；本轮v56/v9离线复放26条实际历史输入，39,716–46,297文字字节，全部通过原48,000上限。原未知attempt不重试、不回写；本地预检失败不冒称供应商故障。
- 对“同意这一版不等于现场已经落实”等紧邻否定谓语，仅等义转为“不能据此确认处理结果”；另一个分句的正面完成断言、无据数字、越权来源ID及非原文引述仍由原守卫拒绝。该窄范围处理修正已记录的误拦，不增加重试或授权正式动作。
- 带来源综合回答及普通自由回答现于最终提交事务共用真实保存回执守卫。出现“已记录/已按你的更正记为/更新为”等已覆盖的回执形式前，须有本轮实际记忆/偏好操作，旧事实与引文不能替代；假设性写入被拒后不能发布虚假保存回执。这是必要操作检查，不保证任意回执改写，也不证明每个自然语言字段/值或推断都已有语义支持。历史需求只说沿用原记录，已存私聊更正与未改正式版本分别表述；客户说明不说成图内观察，授权查询缺项不说成现实现场尚不能施工。

| 触发 | 沿用可见反馈/动作 | 恢复及边界 |
| --- | --- | --- |
| 明确更正后提问 / 多条独立原话 | 原C01气泡、真实保存回执后解释，不强制摘要/共享步骤 | 同字段链及原子批次；原话持久保留，失败不假报保存 |
| 存量混合书桌行与当前人数 / 旧共享或正式描述不同 | 同一批准回答/来源面板说明具体差异与保留意向 | 只读限定；supersedes仍精确同字段，不自动正式改版或外发 |
| 专业问题及未解决事项 | 企业依据与实际节点解释条件；相关原事项分别显示真实等待状态 | 同ID/版本重进，不编负责人、期限或结束状态 |
| 来源换版/撤回、成员/客户变化、人工接管 | 原失效/重试/真人态及受保护原件/卡片清理 | 原守卫重验，别名/缓存不能复活来源或插入迟到AI |

无新API路由、schema/迁移、角色/菜单、Mini WXML/Less/素材/导航或正式v4写入。C01/C02/C05/U01沿唯一批准台账，S04仍为原PPT22/38，853×1844映射390×844，PPT23提供资料语境。无整屏切片、新设计或新增视觉还原声明。原生证据逐张登记精确route/stack、副屏/重新编译、逻辑视口和PNG编码尺寸；真机/真实微信/BLE/完整宿主光学/高屏/键盘/Chrome按实际证据未验。

在本独立worktree的`admin`复跑：先设置`XIAOK_ACCEPTANCE_ENV_ROOT`指向原仓库`admin`、`XIAOK_ACCEPTANCE_CONNECTION_FILE`指向现有隔离连接私有文件、`XIAOK_ACCEPTANCE_OUTPUT`指向本任务证据目录；原生另设`XIAOK_NATIVE_PROJECT_ROOT`指向既有Stable项目。`node scripts/assistant-continuity-acceptance.mjs`执行隔离核心，`--unit`/`--claims`仅对应子集，`--agent-regression`为不重叠受影响Agent回归，`--mini`为客户端确定性检查；`node scripts/assistant-continuity-isolated.mjs`执行实模，加`--native`为Stable；`node --import tsx scripts/assistant-continuity-audit.ts --isolated`只审计本任务合成夹具；`node scripts/assistant-continuity-typecheck.mjs d0238543`做同源类型对照。当前实模/原生全过程持有共享锁，只连批准55432/xiaok_embedding_eval并启动本工作区localhost:3007服务/Worker；开发主库仅只读复用既有模板/模型配置。原3006服务/Worker不变，全部夹具明确合成。实际次数、逐轮语义审读、失败、用量与限制见[交接](./xiaok-assistant-handoff.zh-CN.md)及`tmp/xiaok-fact-boundaries/acceptance-summary.json`，不以结构或基本冒烟代替完整专业/PPT及发布验收。

- 本轮采用决策复核了[LangGraph原始状态与提示词分离](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)、[维护中的JS工具调用/消息关联测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭ToolMessage状态问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)。历史问题不等于当前供应商缺陷；[DeepSeek工具调用](https://api-docs.deepseek.com/guides/tool_calls/)沿用标准调用/结果关联，[官方JSON空内容限制](https://api-docs.deepseek.com/guides/json_mode/)不解释本轮事实措辞缺陷，也不构成盲目重试授权；本轮仅在既有有界循环内计算来源阅读投影，租户/撤回/任务/用量/真人接续仍以Postgres为权威。不新增框架、checkpointer、模型协议或供应商专属恢复补丁。
- 回答接续现仅从本轮获权原话派生模型阅读辅助`answerContext`：同房间当前用途、原话是否确实给出人数，以及不含失效值的未知用途标记。原来源ID、原文、权限/版本元数据保持；该辅助不是证据或保存回执。已有私聊更正直接沿用，不要求客户重复确认相同人数；未改正式版本的差异仍由团队核对。仅有“用于办公”等用途不代表人数已知，其他房间仍独立。
- 最终综合解析器及普通自由回答提交守卫拒绝已观察的内部标签、对有效已更正需求的拒改措辞、已覆盖的重复人数确认、未在当句限定查询范围的量测依据缺项断言，以及来源不可用后推荐默认人数。团队/现场原件明确记载的缺项仍可按该原文归属引用。这些是窄范围回归守卫，不是通用语义评判；不改写正文、不增加语义修复或供应商轮次；不回写或追溯重判既有保存回答，其历史投影仍按原来源可用性规则；原引用/数字/动作/真实保存/撤回守卫保留。失败或unknown尝试及未知费用继续按真实状态保留。
- 离线夹具保留上轮十二次实际v51服务/原生回答及其当时获权来源：八个已记录缺陷被拒，四次可接受旧回答保留。这是离线回放，不是十二次新模型调用或新原生证据。本轮自动化/实模/原生结果与集成要求统一见[交接](./xiaok-assistant-handoff.zh-CN.md)及`tmp/xiaok-fact-boundaries/`。隔离协调器在本工作区临时localhost:3007服务/Worker及既有Stable原生传输全过程持有原共享锁；原localhost:3006服务/Worker及开发主库保持。无需schema/队列/任务载荷迁移，不改知识专属模块；KB批量项应固定实际执行模式/供应商/模型/prompt及来源修订；既有知识试问不是C01 Agent，v56只适用于未来接入的客户Agent路径。保留原不匹配/取消/unknown用量语义，生产端口适配及跨进程取消围栏仍待另行集成。


- v9模型阅读辅助补充当前知识来源键及原有回复协议，不增加事实或授权。专业原因承接保留相关企业依据与真实引用；纯状态、规则无关/不适用或冲突仍守原边界。已存人数不要求继续说明，普通补充不说成送达团队；未问联系方式时不追加等待电话配置。新增三次v52保存回答4064/4066/4067的原始反例回放，当前相关单元73项通过。v52实模只完成五条选定回答，第五条检索到K940却未引用企业依据，同时仍有已知人数/电话措辞问题；后续与原生未执行。该轮保持源码不变，已停自建服务/Worker、关闭夹具、释放自有锁并保留账务；不是完整语义通过。本轮最终结果见交接，不累加中间检查。

- v53保留实际被拒回答4075：正常复述“沿用你此前明确的需求”被过宽请求匹配误拦，且原输出把查询缺少尺寸扩成现场点位尚不可执行。v54离线回放区分事实复述与要求客户补充的言语行为，并在当句限定查询缺项；继续核对按企业要求及团队实际待核对记录解释。该拒绝未发布客户回答，模型尝试及费用状态照实保留。

- v54实模在六条选定回答后停止：4083说明当前私聊更正，却没有引用对应use原话。v55对已覆盖的明确人数更正表述要求该当前原话，仅接受权限/版本相同的有效别名；普通自由回答最终提交同样检查，不能绕过来源。事项状态、正式版本或不相关节选不能代替，不增加语义修复或供应商重试。v54还保留了图纸进度表述过宽和插座精简建议；提示词现把图纸核对记录与整体进度分开，不从人数减少推定设备/插座应减少。六条原输出、失败及费用保留，撤回/原生未执行。

- v55实模在两条选定回答后停止：4095单段五条引用超过既有四条上限，客户回答未发布。v56明确原六段/每段四条上限，按事实主题分段并保留当前更正/正式版本/企业依据的必要原文，不承诺一次核对就能定准；原输出离线回放仍拒绝，不截引用、不新增修复轮次。v53/v54/v55失败与账务保留，后续未执行场景如实记录。

- 最终v57只修复解析/协议规范化，模型输入政策与current-turn-sources-v9沿用v56。过长重复引用只合并同一当前来源中已逐字有效且相邻/重叠的节选，不加入未引内容或数字支持；每条仍≤400字，规范化后每段仍≤4条。五个不同原件、坏/越权引用、额外元数据、未引间隔内容仍拒绝，不增加修复。紧邻否定“不等于现场点位已经落实”仍表示不能推定结果，独立正向落实断言继续拒绝。最终73单元含八条v56服务实模原回答及原生4109的精确回放，不冒充v57新增八次调用；v56原生15项通过后首条模型被拒，后续未执行。最终新原生/冻结证据见交接。

- 历史v57原生最终尝试为17项通过、1项失败、三条实际回答：4115虽保留当前更正/企业依据/正式版本及真实等待来源，却未明确说明私聊单人与正式双人的差异，图纸关联的开头仍可能读成整体进度。后续撤回/未知人数/成员403原生未执行；不是22/22或完整专业语义通过。按最新收尾范围保留反例、冻结源码，最终核心/受影响回归及独立知识线接口见交接。

- 历史v57冻结工程收尾：核心104项中103通过、1跳过，不重叠受影响Agent19项中18通过、1跳过；两组均正常退出且源码哈希未变，去重共123项、121通过、2项配置实模重复路径跳过。73项确定性单元与定点保存均属子集；Mini92/92为较早的未改客户端检查。相关lint零错误零警告，同源类型对照仍287→287、新增0，不是全量类型通过；上述原生17/1的语义验收失败独立保留，不能被工程检查覆盖。

<!-- admin-request-compatibility:start -->

共享Admin请求兼容已限定实现，v61 Agent/模型视图政策不变。每请求通过`AbortController`组合调用方取消与原30秒期限，覆盖JSON正文读取，结束后清理计时器/监听，不依赖`AbortSignal.timeout/any`。网络/正文不确定性、原生取消异常、已知错误分类和变更幂等语义保持。无API、权限、队列、schema、知识专属UI/服务、小程序结构/样式/素材或设计变更。

已执行：Node14/14；本机Chrome101.0.4951.54 10/10、Edge155.0.4283.62 9/9合成HTTP传输检查，含真实30秒正文期限。旧Chrome在HTTP前TypeError已按0请求复现；浏览器透明连接重试仍计入同一合成操作键，Chrome101原生AbortError对象身份差异如实记录而不改写。未注入信号polyfill/加速时钟，无DB/模型/Embedding调用，不充作已登录页面验收。相关lint通过，同程序类型287→287/新增0，自有服务与浏览器驱动均结束。证据为独立worktree的`tmp/xiaok-fact-boundaries/chrome101/`。本段仅为传输证据；当前共享执行端口见下段，知识线的双进程/生产接入仍待验证，整体仍**Limited**。

<!-- admin-request-compatibility:end -->

<!-- shared-execution-integration:start -->

**共享五方法及知识入口已集成，有界真实双进程已验证；KB-4整体仍Limited。** 知识稳定349cb8f2已正常合入当前业务分支，准确范围/证据以下文当前KB-4及知识接缝交接为准；本次集成不改共享factory。 基于正常集成4b5fb96d/bb89e54c/95ff8f20；知识专属operations.ts、batch-execution-adapter.ts、evaluation-batch.ts及专属测试保持。准确导入为`admin/src/lib/assistant/core/evaluation-execution.ts::createKnowledgeBatchSharedPort()`，返回KnowledgeBatchSharedPort<PostgresTransaction>供new KnowledgeOperations(manager,factory)使用；构造无配置读取或I/O。

| 端口/边界 | 已实现行为 |
| --- | --- |
| executionRevision | 原平台/部署文字解析提取到ai/workflow-text-runtime.ts，准备及实际派发共同使用。服务端摘要绑定实际knowledge_preview身份/model/生成/prompt、profile/epoch/policy及传入/当前retrievalConfiguration，不含凭据。未提供供应商model revision保持null，不承诺模型权重固定。 |
| lookupReceipt/事务复用 | ConversationService.inTransaction在传入事务中保留身份、参与者、settings检查；originalSubmission及获权operation receipts恢复原create/send/run，不写入、不通过resume/send探测。过期不授权重复副作用；损坏或已提交但无run的回执抛错，不伪作不存在。 |
| dispatch/provider-start | 仅用知识方准备/取消规范记录；私有run绑定精确case/evaluation快照、原键、消息摘要及取消fence。新run/job/预留沿原settings事务检查；真实解析模型配置先于attempt核对，有效租约/当前绑定/取消与开始标记及attempt同事务核对提交，无第二权威。 |
| observeRun/cancelRun | 只读获权原run及明确用量/预留记录，不把不可得用量/账务算0。已知取消不要求来源/供应商当前配置，但保留身份/参与者和原键。Prepared项的通用retry缺少domain守卫，保持不可用；普通非批次重试保留。 |

已执行：离线158/158（含知识适配器确定性测试，不是新语义回答）；隔离PostgreSQL 14/14（11项准确合同共享服务检查及原Agent派发/费用3项回归），供应商HTTP全部模拟，真实模型/Embedding调用0。同程序类型287→287、新增0，相关lint/diff见交接。早期原型12项/双进程竞争属于旧提案ABI，不计为当前95验收。知识线随后在349cb8f2完成入口注入和7组真实双进程验收；这些是独立证据，见当前KB-4段，不覆盖此前失败。完整构建及真机/原生/图内识读限制不变。

知识95持有整批持久取消意图及cancelledBeforeDispatch观测，覆盖全未派发批次；共享代码不重造。入口及有界真实双进程/配置漂移/丢失关联已由知识349cb8f2交付；知识线继续负责按共享锁串行的有界真实模型语义验收，避免重复调用。本项未启用生产批量路由/定时任务，未增加凭据或部署。早期语义/原生证据保持历史身份，未在此Admin共享接缝重跑。

采纳决策：保持原租户事务、settings/租约排序、原回执及账务核对。[LangGraph Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api)、其[Postgres pending-send测试](https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint-postgres/tests/test_sync.py)及[issue8702](https://github.com/langchain-ai/langgraph/issues/8702)区分检查点重放与应用副作用回执；[PostgreSQL行锁](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)支持原事务排序。本次不采用框架迁移、模型重试或第二队列。

<!-- shared-execution-integration:end -->

<!-- boundaries-v61:start -->

- 当前v61 / `current-turn-sources-v11`保留当前私聊用途与精确正式版的明确对照，图纸关联限定于这条实际回传记录，真实施工阶段另查当前节点。原4115/4102及4235仍为反例；原4241保留多余引用字段及历史indeterminate状态。不静默剥离引用字段，不增加语义修复或模型轮次。

- 仅在模型视图超限时，把可逐字定位的重复摘录正文改成完整K来源text的UTF-16起止索引`evidence.textRange`；全部选摘ID和全部已选规范片段仍保留。不同K身份不因文字及描述性元数据相同而合并。完整来源正文、条件、范围/版本元数据、结果键及来源别名保持；未知摘录元数据或无法定位的文字原样保留。可省去派生文案/阅读提示，持久工具结果、快照和授权不变。既有唯一一次格式修复只省去已验证的重复提示，严格来源/引文检查保持且不能调用业务工具。原48,000 UTF-8文字字节及四轮上限不变；确实无法容纳时按已知本地校验失败处理。

- 实际解析出的Agent请求在新attempt和供应商开始标记前校验；Worker按本次派发跟踪确定性，前轮成功不把后轮本地校验失败变成远端未知。已在运行/未知的缓存调用仍不可重派。本地`agent_input_limit`保留为失败码；前轮已观测用量、不可用费用及reconciling预留保持。历史未知attempt不重试、不核销、不填写零费用。

- 新增限定的最终归因守卫：对已登记的相反规则声称共有前提时，同一事实段必须逐方引用该前提原文；只有一方的两条引文仍不够，单方做法可以单独归因。这不是通用语义裁判。实际4245/4246被运行解析器与知识6b974e3d验收合同共同拒绝；补全来源的样例只证明校验规则，不算新实模答案。旧KB-1材料两答的业务边界审读结论仍保留，但其内部标签仍被当前用语守卫拒绝。

- 已执行证据：v60冻结核心115项中114通过、1项配置重复路径跳过；最终v61离线94/94、隔离模拟HTTP派发/费用检查3/3、相关18文件lint无错误警告、同程序类型287→287新增0。知识6b974e3d合同自检64/64，网络/数据库/模型调用均0。实际4242按当前策略回放为44,585字节，五个片段/四份文档完整；4241格式修复47,754字节。这些是离线/工程证据，新的原生及配置实模语义结果另记交接，不据此推定。知识专属v4检索/批次仍在独立分支，本checkout不冒称已集成或自动批量派发。

- 隔离业务验收使用localhost:3008及原共用advisory mutex，3007保留给知识线。可选等待仍使用同一把锁；目标/角色在等待前检查，schema/空闲队列在取锁后检查，全部先于夹具和Worker。定点原生模式各执行一次真实更正、接续和撤回后回答，明确不重复基线题。本变更不含Mini结构/样式/素材/导航、API/权限、schema/迁移或全局队列权威变更；新的Stable定点原生21/21通过，4322/4323/4324真实保存，来源/重进/撤回/成员403检查及源码哈希保持。4323闭环4115的限定人数对照/进度范围缺陷；4324保留人数未知，但末尾仍用条件式一人示例补问，为已记录的措辞限制。基线未重复。本轮只验证既有流程，不升级UI还原或生产批准。夹具3497有6条成功run、11条成功的run绑定chat attempt，6条预留仍reconciling，费用未知，索引工作不计入这个chat数量。自建进程已停、传输已恢复，原副屏窗口已无抢焦点地返回最初最小化状态。

<!-- boundaries-v61:end -->

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

在`admin`复跑：`node scripts/assistant-team-materials-acceptance.mjs`、`--regression`、`--mini`；实模`node --import tsx scripts/assistant-team-materials-development.ts --development`，原生加`--native`；同源类型`node scripts/assistant-team-materials-typecheck.mjs 26a3664f`。隔离库固定55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS及共享锁；实模固定已批准5432/smart_floor_planner、localhost:3006及现有Worker/provider。场景依次比较未核对、明确回传关联、正式待决定、精确同意、新版与原话冲突及撤回；普通解释不产生落实/解决/关闭事件。业务/图片均为标记合成夹具，HTTP/模型/数据库真实；未知费用为null。实际检查、失败、截图和限制统一见`tmp/xiaok-team-sources/`及[当前交接](./xiaok-assistant-handoff.zh-CN.md)。

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

**Limited — 知识共享执行端口已接线，有界事务验收通过。** 原知识运营 API 惰性注入 `core/evaluation-execution.ts::createKnowledgeBatchSharedPort()` 到 `KnowledgeOperations`。路由/动作/请求体、租户/角色、私有来源/引用权限、schema 和 UI 均无新增边界；未开放生产自动批量接口或启用。真实隔离 PostgreSQL 两进程7/7组通过，覆盖唯一准入、跨进程持久取消、单项取消中断重进、原已认证 resume（409 `batch_cancelled`）、原键恢复不增派发、真实配置 pin 及 provider-start 在新 attempt/标记/HTTP 前拒绝。实模/Embedding调用0，恢复 unknown 标记为合成，费用保留null。自有夹具精确清零、原互斥锁释放。付费实模语义和生产批量启用仍未验收，整体Limited。 这是知识稳定349cb8f2的既有证据，集成人只读核验原审计，不重跑数据库或付费调用；原7组不与离线单元相加。准确提交、四个run账务、109项清理及两次失败见[知识接缝交接](./xiaok-knowledge-batch-integration.zh-CN.md#知识入口集成与真实双进程验收)。

原`/assistant-knowledge`增加「问题集与健康」，沿用Ant Design/Admin Pro、720px Drawer、原来源诊断与共享操作反馈。范围来自最新双语企业知识计划的KB-4运营核心，对应K-06/10/11及K-05格式能力如实披露。PPT5/6/15提供自然提问/接续场景，23/38提供资料缺失、冲突和团队核实边界；PPT没有新增运营看板设计或工程标准，功能后台仍以双语Admin UI合同为批准设计源。C01/C02/C05/U01的构图、WXML/Less、素材和导航保持。

### 问题、来源版本与缺口回归

- `0087_assistant_knowledge_operations.sql`新增企业隔离、强制RLS的`assistant_knowledge_cases`和`assistant_knowledge_evaluations`，复用管理者引用保护，采用租户复合外键与不可变评测快照。企业重置/删除先清这两表，再清关联会话/run/知识。无新供应商、凭据、业务事实库、Worker类型、prompt或Agent循环。
- 管理者明确整理固定问法、应有据/应缺依据、各最多5份必需/禁止文档及共享缺口备注。问题与备注是企业共享运营资料，私人咨询不会自动复制入库。编辑推进问题修订并重新打开缺口。每企业最多100题、2,000次回归记录；列表有界游标，来源选择最多展示200份。这是限定首版，不是实测生产容量或批量调度器。
- 每次复跑固定问题修订、knowledge_epoch和必需来源当前发布版本ID/hash，只用`customer_public`、无草稿，连接操作者本人原`knowledge_preview`、`ConversationService`、任务、额度、取消和供应商计量。未发布/内部/过期/索引未就绪的必需资料不能开始客户范围回归。一次明确操作跑一道题；不能把后台摘录试问冒充绑定实际项目的客户Agent验收。
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

- 同一`retrieveKnowledge`路径注册配置升为`professional-hybrid-v3`。仍先按企业、受众、当前发布版本/hash/profile/有效期及来源权限硬过滤，原1024维Embedding、每路30候选、RRF k60、相关度0.3与最终最多5片不变。融合后先选择当前适用/条件未知依据，明确不适用条目后移；每份文档首轮最多2片，再补齐剩余名额。不适用来源有剩余名额才用于解释为何不能套用；未知条件不当作已满足或直接丢弃。适用性只取原服务端实际阶段，不接受模型/用户新过滤器，不按分数决定规则权威。
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

### 来源、验证与剩余范围

小程序仍为`packages/assistant/chat/chat`，设计源为唯一台账的`design-references/xiaok-p4b-public-sites-v1/README.md`所继承C01/C02/C05/U01；本批只改服务数据路径和自然回答，不改WXML/Less/字号/素材/导航。后台仍为原`/assistant-knowledge`与本人试问，原共享操作反馈和三类管理者继承权限不变，无新路由、权限、解析格式或数据库迁移。可见普通状态复用已批准组件，不另画一套状态或新建审批流程。

2026-10-18复核维护中的[Dify检索节点](https://github.com/langgenius/dify/blob/main/api/core/workflow/nodes/knowledge_retrieval/knowledge_retrieval_node.py)、[Haystack过滤测试](https://github.com/deepset-ai/haystack/blob/main/test/components/retrievers/test_filter_retriever.py)及[LangGraph工具/中断/恢复测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)。采用元数据适用判断与最终上下文选择分开、标准工具消息和恢复前重验；Haystack运行时过滤可覆盖默认条件的行为不能覆盖本项目硬授权。不安装/迁移其平台；当前配置DeepSeek协议/格式与已知引用修复限制仍以本项目实际回归为准，供应商示例或上游测试不当作本项目语义证据。

复跑：admin下`node scripts/assistant-context-acceptance.mjs`（隔离数据库/真实Embedding/确定性模型），可选`--unit/--regression/--synthesis/--mini/--lint`；`node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development --context`为现配置模型/真实HTTP/Worker，另加`--native`复用已授权Stable原生流程。固定必要来源、禁止推断、逐轮证据及执行结果见[交接](./xiaok-assistant-handoff.zh-CN.md)和`tmp/xiaok-kb3/`；实模与模拟、合成与真实资料分别记录。范围外复杂PDF/OCR、任意语义归因、真机/真实微信/BLE、认证后台视觉和生产仍未验证/非本批开发门槛，整体专业客服仍Limited。

## 当前 KB-2：企业文件入库与结构引用（限定格式，整体 Limited）

原 `/assistant-knowledge` 增加企业文件类型，C01仍为同一个咨询与来源片。范围为DOCX、可提取文字PDF；合成文件验证，不批量导入混合开发目录，不向新外部解析/OCR服务发送资料。KB-1专业条目/诊断继续复用；文件知识与当前获权工地事实在原LangGraph同轮汇合，不建立新的项目事实库或把私聊/项目附件复制成企业规则。

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

### 采用、复跑与边界

解析器固定 `pdfjs-dist6.4.299`（Apache-2.0）、`yauzl3.4.0`（MIT）、`saxes6.0.0`（ISC）；保留原共享canvas1.0.7，PDF.js所需新canvas隔离在其依赖下。Node≥22.13，Docker构建文件使用24，未构建/部署生产镜像。参考[PDF.js API测试](https://github.com/mozilla/pdf.js/blob/master/test/unit/api_spec.js)、[官方分层API](https://mozilla.github.io/pdf.js/getting_started/)、[2026脚本安全公告](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j)、[yauzl资源与惰性读取](https://github.com/thejoshwolfe/yauzl)、[saxes](https://github.com/lddubeau/saxes)及[RAGFlow解析集成测试](https://github.com/infiniflow/ragflow/blob/main/internal/deepdoc/parser/pdf/parser_pipeline_integration_test.go)。采用本地有界结构提取与分层测试；保持当前PostgreSQL/pgvector、硬授权、LangGraph及持久任务，无框架迁移或新资料外传。生产镜像兼容、全量恢复、PDF复杂排版/OCR、XLSX/旧格式、任意段落语义归因及完整专业客服仍Limited/未验证。

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

### 后台试问诊断与权限

- 新增 `GET /api/assistant/preview/runs/:id/diagnostics`，仅本人原知识试问、当前有权的企业管理者读取；客户/普通员工、其他管理员的试问和跨企业请求不可读。`enterprise_admin/admin/super_admin`继续在选定企业继承知识管理，不要求平台管理员入职/成为项目成员。接口 `no-store`；不增加客户调试入口或无权候选缓存。
- 原试问“本轮回答”旁的“检索诊断”Drawer展示实际检索问题、注册配置/profile、查询耗时/可用Embedding输入用量、当前受众/固定草稿、合法排除的汇总计数，以及授权候选的来源版本/hash、真实各路名次、融合顺序、入选/低相关/排序未入选、实际上下文是否使用及按预算截取的字符数、条件缺项/不适用原因、原片段。未发布/受众/有效期/索引计数可重叠；只有已授权候选有ID/正文。费用未知保持null，不填零；已知Agent查询Embedding用量写回原operation key，不重复计量。
- 诊断复用 `knowledge.search.v1` 的原 `assistant_run_steps.input_summary`；没有第二套运行/任务表。每次打开核对当前身份、本人会话、knowledge_epoch、固定草稿、候选精确hash/版本、有效期/profile及条件上下文；旧资料失效时整份旧trace不再返回正文/标题。普通查询未检索、索引未就绪、候选未召回/低排/条件缺失与模型执行失败分别可见；手工录入不冒充已解析文件，生成语义正确性明确不自动判断。Admin试问仍是原保守摘录生成，C01是已验收的生成式综合解释；两者共享检索与授权，不把试问生成风格当线上语义验收。

### 上游采用与本批验证

2026-10-18复核[Haystack过滤实现](https://raw.githubusercontent.com/deepset-ai/haystack/main/haystack/components/retrievers/filter_retriever.py)及[运行时过滤测试](https://raw.githubusercontent.com/deepset-ai/haystack/main/test/components/retrievers/test_filter_retriever.py)、[LangGraph JS工具消息测试](https://raw.githubusercontent.com/langchain-ai/langgraphjs/main/libs/langgraph-core/src/tests/prebuilt.test.ts)。采用检索/生成分离、可记录条件与测试方法；上游运行时filter可覆盖默认值的行为不能覆盖本项目硬授权。保留现有LangGraph/pgvector/Worker，没有安装或迁移另一框架。[DeepSeek JSON输出文档](https://api-docs.deepseek.com/guides/json_mode/)仍列出空内容/截断注意项；本批不放宽原解析、未知结果和用量合同，不把供应商问题泛化成框架规则。

本批实际执行结果、合成夹具ID、逐轮必要来源和语义核对、原生截图、静态检查及剩余阻碍见[当前交接](./xiaok-assistant-handoff.zh-CN.md)及 `tmp/xiaok-kb1/`。复跑：从admin执行 `node scripts/assistant-professional-acceptance.mjs`、`--unit`、`--regression`、`--synthesis-regression`；`node --import tsx scripts/assistant-professional-admin-acceptance.ts --development`；`node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development --professional`，加 `--native` 复用稳定原生流程。只允许批准开发/隔离库建明确合成数据，沿已有凭据/模型配置。

小程序仍只有 `packages/assistant/chat/chat`，复用批准C01/C02/C05/U01及唯一设计源 `design-references/xiaok-p4b-public-sites-v1/README.md` 的原气泡、引用片和不可用状态，WXML/Less/字号/插画/导航未改。后台视觉源为双语Admin UI合同及原 `/assistant-knowledge`；本环境没有可调用Chrome连接器，现有Chrome未开启CDP，认证态Chrome视觉仍未验证，不以HTTP/API代替视觉通过。原生业务截图不升级完整宿主/光学/高屏/键盘、真机/真实微信授权/BLE状态；不转人工验收门槛。

完整企业知识库仍 **Limited**：文件上传/结构解析与页表定位、全部专业长尾、自动条件抽取/语义冲突、知识缺口运营队列、重排/父子补检、影子profile切换及定时替换尚未交付。KB-2文件入库与KB-3增强按专项继续，不把全格式支持当KB-1前置。历史构建/类型/打包阻碍保持实际记录，未合并main、未部署或批准发布。



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
