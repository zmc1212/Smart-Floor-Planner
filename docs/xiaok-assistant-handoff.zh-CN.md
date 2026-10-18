# 小客接力：知识批次共享执行接缝

共享功能提交为 [`5f49fff44161f4baca3e3da922381e98bc9945f8`](https://github.com/zmc1212/Smart-Floor-Planner/commit/5f49fff44161f4baca3e3da922381e98bc9945f8)，分支 `codex/xiaok-execution-fence`，工作区 `G:\workspace\向总\Smart-Floor-Planner\tmp\worktrees\xiaok-execution-fence`。已按父任务授权正常合入知识稳定 `bb89e54c` 和准确适配合同 `95ff8f20`，集成基线为 `34d57f53`；两次合入均无文件归属冲突。本共享功能只含16项共享代码、测试/脚本及双语当前清单，没有修改知识专属文件。**共享内部接缝已验证，整体仍Limited；知识线接回真实双进程/入口验收前，不称生产自动批次完成或发布批准。**

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

## 交给知识线的下一步

知识线将稳定factory注入其内部知识入口，接回准确适配合同的真实PostgreSQL双独立进程advance/cancel、准备后来源/真实配置变更、刻意丢失关联、原键恢复及未核清用量验收；继续使用同一隔离验收锁，不启动竞争Worker。知识95已有 `cancelledBeforeDispatch`，未派发项不伪造runId。其双语知识交接中“待共享factory”的基线记录由知识线在接回验收后更新；当前共享状态以双语模块清单/二期合同本段为准。当前没有注入生产批量路由或定时调度。

复跑使用 `node scripts/assistant-execution-acceptance.mjs --agent-units`；隔离服务为 `--transactions --wait-for-lock`，读取显式 `XIAOK_ACCEPTANCE_ENV_ROOT`、`XIAOK_ACCEPTANCE_CONNECTION_FILE`，输出由 `XIAOK_ACCEPTANCE_OUTPUT`指定。类型对照为 `node scripts/assistant-execution-typecheck.mjs 34d57f53cbdb0db152df637901eda26abdc469c1`。脚本只接受批准loopback:55432/xiaok_embedding_eval，不拿锁不创建夹具。

没有新付费或原生语义场景。历史4242继续indeterminate，1760/4241及旧主库未知调用/费用不回写、不盲重试、不清零。新知识两题的实际语义仍由知识线与父任务按稳定范围继续，不能以单元或模拟504通过代替。

## 原业务证据、设计与限制

事实边界功能 [`e01a181`](https://github.com/zmc1212/Smart-Floor-Planner/commit/e01a18188a5548a59909f26d36d841568ca2ccef) 保持 `xiaok-renovation-v61/current-turn-sources-v11`。历史原生4323已闭环4115限定的当前私聊单人与精确正式双人版本18865差异、图纸关联记录范围及查询缺项边界；4324保留人数未知，但条件式一人澄清示例仍是措辞限制。原生21/21、三条实际回答为上一阶段证据，本阶段没有重跑。来源压缩保留四文档五规范K片段、完整条件和权限/版本，48,000字节/四轮及一次格式修复保持；知识新语义未因此宣称通过。

共享Chrome101修复 [`7f4f9809`](https://github.com/zmc1212/Smart-Floor-Planner/commit/7f4f980987eac57e7a5fd63efdcd82ffe4e798e6) 保持。原Chrome101 10/10、Edge155 9/9实际HTTP传输和30秒正文期限是历史证据，本阶段只重跑其14项确定性客户端检查，不冒充新浏览器验收。

本阶段对Mini模块文档**无新增影响**：没有Mini路由/API/权限、结构/样式/素材或Agent固定改动，C01唯一批准源及S04原PPT22/38、两份还原台账当前行保持。Mini92及原生证据不冒充本次重跑。原工作区97项快照零差异，原分支/HEAD d0238543、五项删除和用户计划保持；原3006与Stable窗口未动。

图内识读、真机/BLE、真实微信授权及完整宿主/高屏/键盘仍未验，开发非阻断，不转为人工A10/截图/手测门槛。完整构建未重跑，旧AiDesignerLegacyPage导出错误及287项基线类型诊断仍在。未自动合并main、部署、强推或新增凭据权限；静默、内部检查通过和本交接都不代表生产批准。
