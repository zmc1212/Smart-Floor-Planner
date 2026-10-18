# 小客接力：团队核对与精确正式版本进入专业问答

2026-10-18。继续当前路线图3.1的P3B/P4A、PPT23/38，不新增阶段编号。**本轮限定来源与状态闭环Implemented，整体仍Limited**，未宣称完整专业客服、图纸理解或全PPT完成。分支`codex/xiaok-public-site-lifecycle`，基线`26a3664f384d478af10a0af1de2610581e849cf8`；功能提交`19af1ea7ad768317ac580a0a78b1dd6116630fb3`，最终交接提交及本地/上游/GitHub一致性见`tmp/xiaok-team-sources/git-final.json`。仅普通推送当前分支，不合并main或部署。

前批原件投影`11d12f41`/`26a3664f`及其`tmp/xiaok-material-projection/`成功、失败和未验项保持原记录。用户整理的双语路线图、知识完善计划、其他脏文件及原有五项组件删除均保留，未混入本轮提交。

## 当前实际行为

- 原`query_materials`及`search_knowledge`绑定房屋路径，继续复用本客户/原咨询/明确项目房间的有效共享需求、点位图、实际节点与企业知识。新增独立`team_review`、`formal_plan`来源；不新建权限、版本或知识系统，无新schema/API/菜单。
- 团队来源仅来自经理**明确回传到原咨询**且当前仍有效的图纸关联核对，绑定回传event/客户回执、事项/修订、need/drawing grant和materialVersion。内部回复、未发布现场记录与共享会话不泄漏给客户；核对关联不冒充图内尺寸、正式决定或现场落实。
- 正式来源复用`customerPlans/readPlan`，只读当前已送达本咨询的精确版本ID/hash、版号、修订、客户真实决定、原件hash、前版与差异/费用/工期原文。预览、待决定、稍后、未同意、要求修改、同意分别保留；新版不继承同意，撤回最新不回退旧版。所有既有源权限、换版、撤回和历史失效检查继续执行。
- v43实模回答能说明团队核对后还缺现场尺寸，按V1差异和真实同意解释；V2改为单人办公/取消台灯时保留与客户双人办公/台灯原话的冲突，请团队核实，不自行覆盖需求。普通解释不执行决定、落实、解决或关闭。
- 实际正式资料使旧重复DTO超过原48KB预算。`current-turn-sources-v2`只精简模型视图中的重复data/displayText及完全相同文本，保留全部来源原文、ID/版本/权限、冲突/缺项、知识条件/单位和标准tool_call配对；持久快照/检查点及提交/重进授权不变。原失败检查点52,092→39,819 UTF-8字节，原预算未提高。
- 正式编号缺同段引文时，仅复用原有唯一一次格式修复，提供同一已引用来源的精确ID/版号标题；不自动改答案，不增加轮数或放宽数值规则。未引用费用/尺寸、同号金额、未知来源和完成承诺仍拒绝。失败原回答不算有效输出。
- 本轮未识读图内像素，`imagePixels:false`；240×180纯色PNG只是原件/hash/权限传输合成样本，不是图纸理解证据。C01/S04未改WXML/Less/素材/文案/几何，批准设计与双语唯一路由台账已同步；不扩大视觉还原结论。

## 已执行检查与证据

证据根目录`tmp/xiaok-team-sources/`；汇总`acceptance-summary.json`，逐轮语义审读`semantic-review.json`，原生`native.json`/`native-driver.json`/`native-visual-review.json`，开发审计`development-audit.json`/`usage-summary.json`。测试数据均明确标记合成；真实HTTP、开发数据库、原Worker、DeepSeek deepseek-flash、Embedding与索引任务实际执行。隔离服务测试的模型适配器是确定性的，不当作实模。

| 范围 | 实际结果与口径 |
| --- | --- |
| 核心 | 最终整组25/25：隔离服务15＋综合解释单元10，含跨租户/客户/咨询/房间、内部未回传、换版/撤回、并发变更与接管围栏、模型视图预算及严格编号修复 |
| 相关回归 | 首整组92项为87通过/3失败/2显式跳过；旧模拟适配器读取已从模型视图删除的重复DTO，导致一项及两项级联失败。改为读完整synthesisSources，另验持久快照来源后，材料整文件12/12复跑通过；按原标题去重90通过/2跳过，不能伪称单次92项全通过。`related-summary.json`保留计算与原始日志 |
| Mini单元 | 92/92；仅专项目录单元，不代表全Mini业务验收 |
| 开发实模 | 六状态各两次，共12次有效回答；逐次核验真实引用需求/企业知识/节点、独立核对与正式版本/决定，换版冲突及不继承同意。原驱动末尾单页历史断言失败；独立真实GET分页复核全部36消息，12条派生回答均失效，无模型/业务重跑；`live.json`原失败不改写，见`live-history-recheck.json` |
| Stable原生 | 20/20；另含六次真实模型回答、两次报告草稿，实际输入/按钮/图片上传、原件/精确预览与同意、团队回传、V2冲突/撤回、参考撤回/持久重进与成员撤权。会话/网络/存储临时状态恢复、SDK断开 |
| 工程 | 全量lint0错误/30既有警告，最终驱动增量lint0错误；同源类型诊断287→287无新增（不是全仓类型通过）；隔离工作区Webpack仅编译成功。完整构建仍在既有`AiDesignerLegacyPage`非法导出处失败，未修改该页面 |
| 文档与保留 | 双语合同/四份模块清单与每语言两条唯一路由记录已对齐；Mini清单只暂存本轮两个段落。73个开工文件中71个字节未变，两个Mini清单撤销本轮段落后与备份一致；五项原有删除保留。未递归预哈希的原有未跟踪目录不冒称逐字节审计 |

最终开发实模：enterprise2482/project100/lead2958/cid319/user3394，知识document184/version186，run448/449/450/451/452/454/455/456/457/458/459/460。最终原生：enterprise2484/project102/lead2960/cid323/user3402，知识document186/version188，客户run463/464/465/466/467/468。

本轮共审计8个精确合成开发企业、54个run，状态{"succeeded":49,"indeterminate":2,"failed":3}；provider attempt审计117行，状态{"succeeded":115,"unknown":2}。**attempt行不等于已证实的外部调用**；本地预算拒绝后仍有unknown行，原状态不回写。费用未知/null，索引工作另列，不编造总费用、P50/P95或产品准确率。上述企业AI写入已关闭、合成员工禁用、用户context_version递增使旧令牌失效；active_staff/runs/jobs均0，落实/解决/关闭事件均0。合成来源保留审计，不删除真实业务数据。

额度预留状态为{"reconciling":53,"released":1}，未将reconciling冒充已结清或释放；关闭合成企业AI只停止新写，不代表历史财务已核清。原未知attempt与费用继续按既有核账流程保留，不重试旧run或清零。

隔离测试固定55432/xiaok_embedding_eval、non-superuser/non-BYPASSRLS并串行共用锁。首个被外部超时中止的合成夹具只在此隔离库按本轮精确前缀清理：enterprise3377/3378；用户6405/6406/6407/6408/6409/6410/6411/6412，详见`isolated-cleanup.json`。开发库合成审计数据未删除。

## 失败、限制与下一步

- 早期测试夹具措辞未路由到报告、行断言字段错误、外部包装超时均保留原日志；本地正式上下文超预算与编号引文拒绝分别见`live.initial-provider-unknown.json`、`live.initial-numeric-header.json`和诊断。预算错误发生在本地输入校验，不冒称已证实供应商故障；unknown费用继续未知。只修复了有证据的有限原因。
- 原生三次未通过尝试分别归档`native-first-upload-busy/`（未等上传完成）、`native-second-pre-header/`（正式编号同段引文被拒绝）、`native-third-queue-delay/`（与实模争用单Worker，测试超时清理后任务才启动）。最终串行20/20不改写这些失败。分页只读复核首次因验收脚本在环境加载前导入JWT模块而401，修正导入顺序后通过；未重启/配置凭证或放宽鉴权。
- 已审读实际原文及来源，当前目标的核对/正式版本/决定/冲突边界可见。回答仍偏长，个别句把查询缺项表述得接近现实未核对；run459将联系电话未配置延伸为等待后才能沟通，run466将“靠窗意向”与缺少可量测的现场位置混在一起表述，容易误解。不能把结构引用或来源/状态检查通过当作完整专业语义验收。更正与旧NeedMemory、复杂多房间/多阶段矛盾仍Limited。
- Stable2.02.2608080、automator0.13.0、base3.17.2；每图核对精确route/stack，逻辑390×844、PNG348×752。几何/功能截图不替代原PPT逐元素光学还原；preview截图位于会话末尾，完整预览仅由实际数据/下载/按钮/API验证，不能据该PNG声称完整卡片光学已验。Chrome、完整宿主/高屏/键盘、真机/真实微信授权/BLE、全Mini/全PPT、干净克隆安装与生产均未验；不转成用户必做手测或开发门槛。

复跑（cwd`admin`，真实Node，沿用已有环境顺序）：`node scripts/assistant-team-materials-acceptance.mjs`，相关`--regression`/`--materials`，Mini`--mini`；实模`node --import tsx scripts/assistant-team-materials-development.ts --development`，原生加`--native`且与实模**串行**；审计`node --import tsx scripts/assistant-team-materials-audit.ts --development`；同源比较`node scripts/assistant-team-materials-typecheck.mjs 26a3664f`。原生依赖既有Stable/CDP/副屏辅助脚本，不另开窗口。新增脚本使用既有批准开发/隔离库、localhost:3006、现有Worker/provider，不配置凭证或改角色/菜单权限。

下一步仍沿原P3B/P4A专业实况主线，处理客户更正与既有记忆、未解决事项及相互冲突来源的接续，让企业知识与实际节点形成更简洁准确的解释；复用现有正式版本和处理链，不另造版本系统。按对应PPT核心场景两次实模及原生入口继续验收；图内识读需有真实同原件像素证据后才可升级，知识文件理解按原计划顺序，不凭本轮来源投影宣称已实现。无需等待人工A10/截图/确认，部署仍需单独授权。
