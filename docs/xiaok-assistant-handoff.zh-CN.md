# 小客接力：供应商连接失败确定性

当前分支codex/xiaok-handoff-cancel，工作区G:\workspace\向总\Smart-Floor-Planner\tmp\worktrees\xiaok-provider-certainty，基线752020753774a1fc5ccae6f305c7dd26358437bb。当前取消闭环已完成：服务7/7+原生1组、原生10/10、离线259/259；接下来优先复现修复共享AssistantMutations账号/显式键缺陷，再正常集成知识0f4fbf3c及共享KB-2清单。整体Limited，无实模/生产启用。

**等待设计师时客户明确取消：整句明确文本的闭环已Implemented，整体Limited。** 原C01输入框发送“取消人工接待”或“不找设计师了”，沿原 `POST /api/miniprogram/assistant/conversations/:id/messages` 请求键及取消事务，保存原话与既有“本次接续已结束，小K恢复回复。”系统反馈、撤销接待参与者、推进上下文/版本并回到AI，不创建run或供应商调用。仅本人所属、仍open且 `handoff_requested/waiting` 的会话可改变；已进入人工接待、提问、引用、假设和拒绝取消仍是普通消息。租户、本人、来源、留存、接单竞争与幂等守卫保留。

验证：离线259/259；真实隔离PostgreSQL服务7/7组加Stable C01原生1组，390×844原生10/10检查点。取消已提交但HTTP回包丢失后，重进保留原操作，“确认发送结果”沿原键恢复同一回执，再次请求/取消可用。最终源码hash稳定；本夹具run/attempt/模型开始及剩余合成企业/用户/员工均0，共用锁已释放。类型287→287、新增0，定向lint通过。产品markup/样式/资产/导航/文案均未改；唯一批准C01源仍为 `design-references/xiaok-p4b-public-sites-v1/README.md`。功能截图 `tmp/xiaok-handoff-cancel/service-native-attempt-6/native-cancelled.png` 不代表完整宿主/高屏/真机/真实微信/BLE或通用语义通过。见[当前接待合同](./xiaok-assistant-phase-2.zh-CN.md#当前明确取消等待接待)。

**共享供应商连接错误：限定修复，整体Limited。** 已调用fetch后，无响应的普通连接/TypeError现归`unknown`，不再是`safe_fallback`，不能据此自动向第二供应商提交。错误码/文字/状态、配置超时及原明确HTTP响应/派发前策略保留。attempt/run/用量/预留及租户/角色/来源/租约/回执接口保持，不改表、队列、factory、API或UI。347762ff归档run4369/attempt1804仍为attempt failed/accepted=false、run indeterminate、预留reconciling及费用null；原queued发送确认和该布尔均不是供应商接收或未接收证明。不改历史行/费用/请求键，不重试4369/4242。当前230/230离线通过，含194业务/知识、32项既有供应商/账务和4组模拟传输测试（修复前1组失败）；受影响lint通过，同程序与05edc4d3对比类型287→287，新增0。无新DB/供应商/实模/Embedding/浏览器/原生调用；PostgreSQL收敛/retry守卫仅源码核验，未重跑。缺供应商结果/用量证据，原夹具也已清理，费用收敛和实模语义仍未验。准确只读证据及合同见[传输确定性](./xiaok-assistant-phase-2.zh-CN.md#当前共享供应商连接错误与结果确定性)、`tmp/xiaok-provider-certainty/`。

- 确切证据：原send:4327原键回执绑定21543/4369，queued仅本地准入；一次客户端text_model fetch为transport_unknown、无响应和输出，agent_model开始标记已提交。attempt1804仍failed/accepted=false/actual_cost={}，权威run4369仍indeterminate/provider_outcome_unknown，预留reconciling、tokens/cost为null。原夹具已清理，当前无行不表示费用已知。原档hash a97df5ae9b7f4b3aed68d04082b84577096faec418961e3991363d9d4dd456a5保持。
- 收敛结论：有本地开始/调用证据，无供应商接收、未接收或计量证据。accepted=false不能证明零派发/零费用，原queued回执也不是模型回执；应继续保留不确定。缺供应商结果/用量证据是剩余阻碍，不是权限拒绝。未重试4369/4242、换键、改attempt或费用；未复建已清理夹具。
- 实际修改只在共享HTTP连接异常的disposition由safe_fallback改unknown，代码/文字/状态保持。原Postgres attempt未知分支、Worker outcomeKnown围栏、run/额度/retry守卫复用不改，不添加新schema/API/队列/factory或接口字段。现有布尔也不能当作供应商证明。HTTP明确响应及派发前策略保持。
- 当前230/230离线（194业务/知识＋32原AI/供应商＋4模拟传输），失败/跳过/取消0；新增传输修复前3通过/1失败。两项受影响TS lint无错误警告；同程序对照05edc4d3仍287→287、新增0，不是完整类型通过。没有新DB、供应商HTTP、实模、Embedding、浏览器或原生调用，未占用共用锁/启动Worker。历史知识的实际调用和费用单列，不计成本轮新验证。
- 证据tmp/xiaok-provider-certainty/incident-evidence.json、offline.log、before.log、type-comparison.json、lint.log及[当前双语合同](./xiaok-assistant-phase-2.zh-CN.md#当前共享供应商连接错误与结果确定性)。供应商/费用缺证、实模语义、完整构建、原生/图内/真机/BLE/真实微信未验限制保持。原97项修改和5项删除保留；父任务继续协调知识线离线补全，当前没有新实模授权。

## 当前恢复边界：已纳入知识0030eb82

仅只读核验`0030eb8245c40f2fe18f5530da013eb75366a06f`，未自动合入知识后续分支或重跑其数据库。独立run4370的真实PostgreSQL/C01撤回1/1、证据断言5/5及107表/身份清理均属知识线证据；向量/回答注入模拟，真实模型/Embedding/provider fetch为0，当次锁已释放，不与本分支230单元累加。

原4369仍没有足够证据收敛：原send/key/hash已留存但create key缺失，当前行已清理；4242原create/send key及request hash也未在知识线归档中留存。缺项保持null，没有推测、补造或换键。两份恢复准备均为`archive_only_wait_shared_review`、`dispatchApproved=false`；“至多一次”仅未来上限，不是执行授权。仅有4369的send归档不能作为完整create/send证据调用`originalSubmission`，不得据此重建等价发送。

仍缺供应商结果/用量证据、完整可靠原身份/操作证据及有效授权恢复机制。连接分类修复610ec0d2只约束未来调用，不能证明旧请求未到达、解除indeterminate/reconciling或核销费用。证据`tmp/xiaok-provider-certainty/recovery-review.json`记录原准备文件hash/空缺字段。此补充仅文档证据影响，代码及四份模块清单当前行为不变；没有重复测试、DB/模型请求或恢复动作，原97项及5项删除保持。

## 上一稳定人数解释05edc4d3（v63证据）

本提交在独立分支codex/xiaok-need-interpretation、工作区G:\workspace\向总\Smart-Floor-Planner\tmp\worktrees\xiaok-need-interpretation继续，基线04a85946。既有路线图10.1第1/3场景的内部可靠性增量，整体Limited，不宣称完整阶段或发布验收。

- 合成离线6组修复前4失败：否定/暂定中的数字被当作确定人数，明确“人数未定”未能限定旧混合行。当前复用v62原话限定词规则；完整原话仍可用，occupancySpecified仅肯定人数为true，肯定转折引用不得借用被否定分支。明确未定人数限定旧desk/other人数部分，来源失效沿原无值标记，不恢复旧人数；位置、设备、其他房间、原文/修订链、明确更正和权限守卫不改。
- 当前194/194离线，失败/跳过/取消0；包含历史保存回答与预算回放，新增6组合成解释反例，不是新模型回答。5项TS lint无错误警告，同程序对照04a85946为287→287、新增0。初次lint的测试辅助函数useSource被Hook规则误认，已改名并完整重跑，原失败日志保留。提示审计元数据v63，静态提示/工具文字、sources-v11、48,000字节预算及运行轮数不变。
- 新构建诊断：Next16.2.3页面导出约束对admin/src/app/(admin)/(merchant)/ai-studio/designer/page.tsx:27复现静态TS2344，额外AiDesignerLegacyPage导出来自4487a09df。该旧函数无产品消费者、调用旧/api/ai；默认页仅重定向统一设计工作台，属于AI Studio而非小客。按父任务边界只诊断，不改该页、不执行新完整Next构建；这不是完整构建已通过。旧287类型诊断仍在。
- 本阶段新DB/模型/Embedding/浏览器/原生调用0，无夹具、Worker或验收锁竞争。factory/队列/schema/接口、知识专属文件及客户端UI不改。原97项脏修改、5项删除、d0238543及原分支保持。历史4242/4241未知费用不改；图内识读/真机/BLE/真实微信授权和v63实际模型/原生语义未验，既有4324条件式一人示例限制未宣称消除。
- 当前证据tmp/xiaok-need-interpretation/acceptance-summary.json、final-offline.log、type-comparison.json、original-preservation.json、build-export-diagnosis.{json,mjs}；精确规则/复跑见双语二期合同。知识先前7/7真实DB及04a85946的5组离线进程仅保留原范围，本阶段未重跑。

父任务已要求保存本安全节点后优先只读诊断知识稳定347762ff的run4369/attempt1804连接失败与indeterminate/reconciling路径；不得把accepted=false自动解释为未派发，不重试4369/4242、换键或人工改费用。知识线暂补离线验收，无新真实模型调用授权。

## 上一稳定业务/知识集成04a85946（v62证据）

业务修复提交 [4f4b10deff6b6c25a2ac5af456de4c4ba8f1e6e7](https://github.com/zmc1212/Smart-Floor-Planner/commit/4f4b10deff6b6c25a2ac5af456de4c4ba8f1e6e7)，分支 `codex/xiaok-need-source-context`，工作区 `G:\workspace\向总\Smart-Floor-Planner\tmp\worktrees\xiaok-need-source-context`，基线 a579e512。仅修复既有路线图10.1第1/3场景的内部可靠性，不宣称完整阶段或发布验收。

- 离线生产函数复现了否定/未定被截成肯定，以及客厅原话写进书房的缺陷：修复前4组中3失败。v62逐位置核对quote/value、明确房间及邻接限定词；同房间后续直接否定不能被旧命中绕过。完整否定/未定原话、明确更正及共同主语保留。既有版本/来源/幂等/整批原子写及“已保存”回执围栏不放宽，不增模型轮次。
- 重进在原消息/工地通知获权检查后过滤同类旧误提取，只改当前可用投影；原消息、存储记忆和supersedes审计链不改。独立桌位/设备仍可用，失效更正不复活旧混合人数。词法规则、常用房间及请求房间原文是有界支持，复杂隐含更正、其他复合字段、任意房间关系仍Limited。
- 最终离线178/178，失败/跳过/取消0；其中8项需求来源测试含真实读取函数加合成repository替身，不是DB/RLS验收。8项受影响TS文件lint无错误警告；相同程序类型287→287，新增0，不是完整类型通过。六份双语当前清单/二期合同已同步。
- 本轮模型/Embedding/数据库/浏览器/原生新调用均0，无夹具/服务/Worker，无锁竞争。v61原生21/21及4322/4323/4324仅保留原版本证据；4324条件式一人示例仍是措辞限制。图内识读/真机/BLE/真实微信授权未验，旧AiDesignerLegacyPage导出构建问题及287项类型基线仍在；历史未知attempt/费用未处理或清零。
- 证据 `tmp/xiaok-need-source-context/acceptance-summary.json`、`final-offline.log`、`type-comparison.json`、`original-preservation.json`；复跑命令见[二期合同](./xiaok-assistant-phase-2.zh-CN.md#当前p3bp4a客户更正与原事项接续)。原脏工作区97项、五项删除、分支和d0238543 HEAD保持。

当前修复先以功能4f4b10de及交接23a85096普通推送并核验远端/GitHub；随后按父任务明确授权正常合入知识稳定349cb8f2f04e059bc413417b2093c34f04513541，merge为f918f1c28b088f6e2acd4472c5d20c67da8ff59f，零归属重叠、无冲突。知识原API现已注入稳定factory，双语Admin清单/二期KB-4当前记录已按知识交接应用。集成后离线单元188/188（178＋知识工具10，失败/跳过/取消0），模拟store/共享端口双进程5/5另列，不冒充DB验收；临时进程已退出，网络守卫报告DB/fetch/socket阻断均0。集成同程序类型287→287，新增0；10项相关TS文件lint无错误警告。知识线继续负责有界实模语义验收，避免重复调用；历史4242不动。不合并main、不部署、不生产启用。

## 既有知识批次共享执行接缝（a579e512）

共享功能提交为 [`5f49fff44161f4baca3e3da922381e98bc9945f8`](https://github.com/zmc1212/Smart-Floor-Planner/commit/5f49fff44161f4baca3e3da922381e98bc9945f8)，分支 `codex/xiaok-execution-fence`，工作区 `G:\workspace\向总\Smart-Floor-Planner\tmp\worktrees\xiaok-execution-fence`。已按父任务授权正常合入知识稳定 `bb89e54c` 和准确适配合同 `95ff8f20`，集成基线为 `34d57f53`；两次合入均无文件归属冲突。本共享功能只含16项共享代码、测试/脚本及双语当前清单，没有修改知识专属文件。**此a579e512共享内部接缝已验证，整体仍Limited；知识349cb8f2已接回既有入口并完成下列真实双进程验收，仍不称生产自动批次完成或发布批准。**

## 知识线可直接接入的准确接口

```ts
import { createKnowledgeBatchSharedPort } from '@/lib/assistant/core/evaluation-execution';
const operations = new KnowledgeOperations(manager, createKnowledgeBatchSharedPort());
```

返回 `KnowledgeBatchSharedPort<PostgresTransaction>` 的准确五方法：`executionRevision`、`lookupReceipt`、`dispatch`、`observeRun`、`cancelRun`，参数/返回类型遵循 `knowledge/batch-execution-adapter.ts`，没有另一套批次端口。构造不读取配置或发I/O。知识侧 `operations.ts`、`batch-execution-adapter.ts`、`evaluation-batch.ts`及其专属测试保持95ff8f20原样；准备、推进、整批取消和关联回写继续由知识线维护。

- `ConversationService.inTransaction`复用传入租户事务，保留现有身份、参与者及settings锁；不嵌套ConversationService事务。全局模型配置仍沿已有私有平台解析器读取，实际选择对象在派发前核对；企业状态及副作用使用传入事务，没有新配置权威或凭据权限。
- `executionRevision`固定真正knowledge_preview的provider/config/adapter/model tag、公开endpoint身份、思考/超时/temperature/输出上限、实际system prompt hash、当前profile/epoch/policy及retrievalConfiguration，不含凭据。未提供的供应商model revision保持null，不承诺冻结供应商模型权重，也不印成C01 Agent版本。
- 仅使用原 `knowledge-batch-prepare`、`knowledge-batch-execution-prepare`、`knowledge-batch-execution-cancel` 权威；取消规范key为batchId，principal及manifestHash必须对应服务端actor/manifest。没有第二队列、租约、取消存储、schema或迁移。
- 私有run保存规范manifest/evaluation绑定、原create/send键及消息摘要。实际解析模型/请求先于attempt核对；原settings/有效租约事务重验规范取消、全批冻结case/evaluation/当前revision、来源epoch、profile/policy及原send回执，然后同事务提交开始标记和attempt，之后才进入HTTP。已撤来源/失权仍不能读写或稍后送达。
- `lookupReceipt`只读原create/send/run，已提交但缺关联可由知识store在同事务补关联；不通过resume/send探测未知run。过期不授权重复副作用，损坏或已提交却无run的回执抛错，不伪作安全缺失。`observeRun`只按明确用量/预留回执报告，不把未知费用算0。
- 已知run的取消不要求来源/供应商配置仍新鲜，仍重验当前身份/参与者并沿原键。已开始/未知attempt及reconciling金额保持待核对。Prepared项通用retry缺少知识domain守卫，因此不可用，沿既有run.retryable路径隐藏原Admin重试控件；普通非批次已知重试保持。

## 已执行检查与证据

证据根目录为本worktree的 `tmp/xiaok-execution-fence/`。

| 检查 | 已结束结果与边界 |
| --- | --- |
| 离线 | **158/158**，源码未变：v61事实/综合/记忆/Agent94、知识协调器/适配合同45、Admin请求14、新执行配置5；没有DB/模型/Embedding调用，不是新实模语义回答。 |
| 隔离PostgreSQL | **14/14**，源码未变，共用锁全程持有后释放。11项准确95合同共享服务检查包含三类管理者、事务回滚、原回执补关联、全未派发取消、跨企业/他人/失权拒绝、实际配置/案例revision变化在attempt前拒绝、取消先落库不建标记/attempt，以及已派发模拟504保留未知。另3项为原Agent派发/费用回归。全部供应商HTTP模拟，没有真实模型/Embedding调用。 |
| 工程 | 12项相关代码/测试/脚本ESLint零错误零警告；基线34d57f53同程序类型 **287→287，新增0**，不是全项目类型通过；diff检查通过。 |

准确路径：`offline-95-final/status.json`、`transactions-95-final/status.json`、`transactions-95-final/transaction-audit.json`、`type-comparison.json`、`lint-95-stable.log`、`acceptance-summary.json`。验收子进程已退出，没有启动服务或Worker循环，锁已释放。仅本套清楚标注的模拟夹具在审计后清理；没有重置其他企业、旧夹具或实际未知费用。

`before-95ff8f20/`与`transactions-first/`保留早期提案ABI及其12项/双进程原型证据，**不计作当前95双进程验收**。首轮准确95为10通过/1失败：他人batch已被拒绝，但在owner查询前返回manifest错误；现改为先取本人/租户回执、返回404，未放宽守卫。初期类型/夹具失败也保留，最终结果以上表为准。

## 知识线集成结果与后续责任

知识稳定349cb8f2的原入口接线和真实隔离PostgreSQL双独立进程已由知识线完成7/7组：唯一准入、advance/cancel及晚到拒绝、单项取消中断重进、原已认证resume的409 batch_cancelled、原回执恢复不增派发、真实准入配置漂移，以及真实provider-start在新attempt/标记/HTTP前拒绝。供应商HTTP/实模/Embedding均0。集成人只读复核其runner、driver、109项清理及factory精确hash，未重复连接DB或重跑付费调用。完整原证据及两次准备失败见[知识交接](./xiaok-knowledge-batch-integration.zh-CN.md#知识入口集成与真实双进程验收)及知识工作区tmp/knowledge-seam-integration/service-attempt-3/；7组不与本分支离线单元相加。

知识夹具4364/4365/4367清理前为cancelled、预留released；4366保留indeterminate/reconciling、settled token/cost为null，provider-start为明确合成，不是实际付费请求恢复/账单验收。两客户端先退出，109项表/身份残留全0后退出协调方，原共用互斥锁已释放。原授权、来源/版本/租约/取消围栏保持；未改知识专属文件或共享factory实现，只有正常合入其稳定分支。未开放生产自动批量入口或定时启用。

当前本分支复跑单元：原execution --agent-units加need-source-context/guidance/requirements及knowledge-batch-seam-acceptance，合计188去重单元；模拟工具用node scripts/assistant-knowledge-batch-seam-acceptance.mjs --offline --output-dir ../tmp/下的未用目录。类型用node scripts/assistant-execution-typecheck.mjs a579e51227294427826d49ac017e00f9c80691ad。真实DB模式仅由知识线协调，必须先取得原共用锁；不得因为换分支/重进而竞争Worker或重复调用。

知识线后续只在协调方确认的冻结业务基线上做有界真实模型语义场景，按原共享锁串行；集成当前v62事实边界时沿正常合入，不覆盖共享模块。历史4242、1760/4241和旧主库未知attempt/费用不回写、不盲重试、不清零。完整PPT、图内识读、真机/BLE/真实微信授权、生产批量启用和旧完整构建问题仍保留限制。

## 原业务证据、设计与限制

事实边界功能 [`e01a181`](https://github.com/zmc1212/Smart-Floor-Planner/commit/e01a18188a5548a59909f26d36d841568ca2ccef) 当时为 `xiaok-renovation-v61/current-turn-sources-v11`，当前需求工具元数据为v62，sources-v11不变。历史原生4323已闭环4115限定的当前私聊单人与精确正式双人版本18865差异、图纸关联记录范围及查询缺项边界；4324保留人数未知，但条件式一人澄清示例仍是措辞限制。原生21/21、三条实际回答为上一阶段证据，本阶段没有重跑。来源压缩保留四文档五规范K片段、完整条件和权限/版本，48,000字节/四轮及一次格式修复保持；知识新语义未因此宣称通过。

共享Chrome101修复 [`7f4f9809`](https://github.com/zmc1212/Smart-Floor-Planner/commit/7f4f980987eac57e7a5fd63efdcd82ffe4e798e6) 保持。原Chrome101 10/10、Edge155 9/9实际HTTP传输和30秒正文期限是历史证据，本阶段只重跑其14项确定性客户端检查，不冒充新浏览器验收。

本阶段对Mini模块文档**无新增影响**：没有Mini路由/API/权限、结构/样式/素材或Agent固定改动，C01唯一批准源及S04原PPT22/38、两份还原台账当前行保持。Mini92及原生证据不冒充本次重跑。原工作区97项快照零差异，原分支/HEAD d0238543、五项删除和用户计划保持；原3006与Stable窗口未动。

图内识读、真机/BLE、真实微信授权及完整宿主/高屏/键盘仍未验，开发非阻断，不转为人工A10/截图/手测门槛。完整构建未重跑，旧AiDesignerLegacyPage导出错误及287项基线类型诊断仍在。未自动合并main、部署、强推或新增凭据权限；静默、内部检查通过和本交接都不代表生产批准。
