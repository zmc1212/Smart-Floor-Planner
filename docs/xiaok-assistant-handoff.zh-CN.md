# 小客交接：企业知识与工地资料综合问答

当前分支：`codex/xiaok-public-site-lifecycle`。本轮功能提交：`4082aabf0ef9eed6fd61d39d2809a8715b1df010`；前功能`b137901d`与交接`cc27bccc`保留。本文件另作交接提交，最终HEAD/普通推送/远端一致性由本轮最终回复及`tmp/xiaok-synthesis/git-final.json`记录。未合并main、未部署、未强推。限定综合问答已接通；完整专业客服、KB-1、P5与全PPT仍为 **Limited**。

## 本轮实际交付

按最新双语整合路线图3.1/4.1/4.4，选择PPT6/14/15的靠窗双人办公及连续追问、18/19的实际节点、23的原咨询/资料关联，以及38的缺失/矛盾先核实。原PPT：`docs/装修施工标准手册制度规范/家客来小K装修服务功能方案.pptx`，SHA256 `9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4`。不是完整PPT19材质偏好、全PPT38或全部专业场景验收。

沿现有LangGraph Agent、模型接入和C01实现`final_response(kind=synthesis)`：同轮已发布企业知识、本人原话、正式v4主户型、获权项目实际节点与已发布现场记录进入配置模型，生成解释/一般建议/待核实段，不再只能摘原文或展示displayText。知识引用可在原来源片查看；项目/图纸/原件ID、版本/hash及原咨询关联保存在真实查询快照和step1006。未新建B来源专门详情页；现场照片沿已有construction查询组件，正式墙图不冒充电气点位图。图片夹具不传模型像素，不声称看图。

prompt `xiaok-renovation-v24`与`current-turn-evidence-v1`在当前有界循环内保留标准工具消息对与同一真实原话，防止旧话题先答；不生成假用户消息或另建循环。显式未核实冲突要求首段待核实、保留双方，不自定企业主流；不是完整自动语义矛盾识别。绑定房屋的search_knowledge由服务端复用queryMaterials刷新同一房屋，step1400系列`synthesis.bound_materials.v1`记录真实主动查询，简短知识追问也有当前材料；多项目仍澄清，不扩大租户/本人/受众/成员/同意权限。缺项只指授权资料未提供，不证明现实不存在。未绑定/后台咨询不自动选房屋。

全部实际咨询来源（含冲突、未引用候选）在模型前后、继续/恢复、最终事务、历史、引用、原件与真人资料包重验。知识换版/到期/撤回/受众、项目快照和权限变化使派生结论失效；一般建议不能冒充企业承诺。无active profile诚实返回not_ready；供应商/网络未知结果仍失败或核对，不伪装成无资料。专业解释不自动建处理事项、批准、通知、解决或关闭。

入口/API/表/迁移/菜单及WXML/Less/字号/插画/导航未新增或改变；复用批准C01/C02/C05/U01及唯一chat设计源`design-references/xiaok-p4b-public-sites-v1/README.md`。双语Admin/Mini模块清单、二期合同及唯一chat台账行已同步，台账仍Limited。[当前合同与上游采用决定](./xiaok-assistant-phase-2.zh-CN.md#当前专业客服知识与工地资料综合解释限定范围整体limited)。

## 最终验证

| 检查 | 实际结果与边界 |
| --- | --- |
| 固定综合问答核心 | v24真实模型 **12/12**，6个组合各两次：办公2、追问2、水电2、防水2、冲突2、缺图2；run218–229。固定断言＋Codex逐条核对实际文本和来源，不是模型自评或真人工程认证 |
| 真实调用与用量 | 真实3006 HTTP、现有Worker、DeepSeek/deepseek-flash、embedding及批准5432开发库；企业/用户/知识/墙图/工地/记录/照片为明确合成数据。核心24次模型调用，observed input 120862/output 8139 tokens，费用未知null；完整回答23.202–48.442秒，中位33.950秒。现场草稿夹具及其他尝试另外计，不混入核心 |
| 最终原生 | v24 **9/9**，额外真实模型run232/233；实际输入、引用片、原咨询重进及撤回失效。同一副屏Stable2.02.2608080、automator0.13.0、SDK3.17.2，逻辑390×844/编码348×752。传输/身份/存储恢复；已目视检查气泡、引用片及撤回捕获，完整光学/宿主/高屏/键盘仍未验证 |
| 新服务与纯单元 | 隔离55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS及共享advisory锁，真实事务/索引/检索＋确定性模拟模型 **15/15**（10数据库＋5解析）；当前原话/更新后需求、阶段变化、换版/过期/撤回、跨客户/租户、同人另一房屋、接管、客户撤权后仅剩接待人员均覆盖。它不是实模能力验收。纯单元 **27/27**（含上述5解析） |
| 既有相关回归 | Mini **98/98**。已完成历史文件分组合计 **71通过/9配置跳过**；原80项组合触及外层720秒上限，不宣称组合命令成功。PPT38文件拆组完整 **14/14**；v24后Agent子组复跑 **12通过/7配置跳过**，不重复累加到71 |
| 静态/依赖 | lint **0错误/30既有警告**；最终类型检查仍失败、**292条**且完整诊断集合相同，触及文件无新增诊断。基础manifest376路径及62个partial清单项均存在。`git diff --check`通过 |

实际数据ID如下；两批最终夹具操作账号已禁用、用户context_version失效，active_staff=0、active_runs=0。保留带标记的数据供审计，不使用真实客户数据。

| 用途 | 企业 | 用户 | 档案 / 工地 | 正式墙图 | 原咨询 | 现场记录 | 节点 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 真实核心 | 2431 | 3281 | 2902 / 44 | 477 | 201 | 57 | utilities |
| 真实核心 | 2431 | 3282 | 2903 / 45 | 478 | 203 | 58 | waterproofing |
| 最终原生 | 2432 | 3283 | 2904 / 46 | 479 | 205 | 59 | utilities |
| 原生备用（未问答） | 2432 | 3284 | 2905 / 47 | 480 | 207 | 60 | waterproofing |

原生依赖既有稳定流程：`tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator`、`tmp/wechat-devtools-version-test/{cdp.cjs,window.ps1}`；不另开DevTools、不写登录凭据。embedding18089原缺失，已按双语远程开发合同用现有SSH身份恢复本地loopback隧道，未改远端服务、账号或权限。

## 可复跑与证据

从`admin`运行：

`node scripts/assistant-synthesis-acceptance.mjs`（服务/解析）；`--agent-regression`与`--resolution-regression`分组选取旧回归；`--regression`为完整相关组，长任务使用exec_command会话，不把ctx RPC超时当进程停止。

`node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development`执行固定实模核心；加`--native`沿稳定原生流程。复用现有配置/凭据，只有明确开发/隔离目标可建数。判据在`admin/scripts/assistant-synthesis-cases.ts`，不得为通过而改宽断言。

最终证据`tmp/xiaok-synthesis/`：`live.json`、`semantic-review.json`、`native-driver.json`、`native.json`、`native-semantic-review.json`、`native-{office,citation,followup,withdrawn}.png`、`service.log`、`agent-regression.log`、`resolution-regression.log`、`completed-regression-groups.json`、`unit-v24.log`、`mini.log`、`lint-v24.log`、`tsc-final-comparison.json`、`staging-audit.json`和最终Git核对。原消息、工具快照、模型输出、用量/耗时在报告内，费用未知保持null。

失败保留：v21 run175旧题先答；v22 run194/195冲突中偏向一方、196旧题先答；v23核心12通过但最终原生run215只查知识却沿用旧缺图说法，独立语义复核失败。分别在`v21-first-live/`、`v22-semantic-review/`、`live-v23-final/`、`native-v23-final/semantic-review.json`。v24服务端刷新后重新执行完整核心及原生，不把旧功能9/9冒充最终语义通过。首轮无索引错误、接待测试直接插入被同意触发器拒绝、native引用白名单测试器失败均单独保留`service-before-final-fixes/`、`native-first-attempt/`，没有放宽同意规则。原组合超时孤儿仅按精确合成前缀和IDs核实清理，`interrupted-cleanup.json`剩余/activeAfter均空；清理期间首次启动被advisory锁拒绝的日志亦保留。

## 未交付范围与下一步

历史AiDesignerLegacyPage非法页面导出构建阻塞、292类型诊断、独立Mini打包3失败及量房Phase0旧失败保持原状态，不算本轮成功或新回归。真机/真实微信授权/BLE、完整宿主胶囊/光学/高屏/键盘、真实Worker进程重启、完整后台试问/诊断、全文件/OCR/CAD/PDF、语音、外部渠道与生产未验证，不转人工手测门槛。自由专业建议的规范级准确性、逐段语义引用精准度（全来源保留不等于每段引文完全精准）、未标记语义冲突识别及长尾表达仍Limited，不以固定12轮替代全领域专业验收。

下一轮按本地最新双语`xiaok-enterprise-knowledge-plan`的 **KB-1** 继续：先专业条目/类型/适用工序、对象、条件例外、有效来源与审校，再最小检索诊断（K-01/04/06/07/08/09/11、QA-01/02/05/06/07/08）。沿既有后台维护/发布和原C01完成真实写入、试问、引用与重进；用本轮固定题验证修订后效果，区分被合法过滤/未召回/上下文不足/生成错误。KB-2全格式解析不是KB-1前置；保留同一Agent/硬授权，不另建项目事实库。先读当前代码与最新计划，不把本交接当所有PPT已实施。

原87项无关内容、5删除及父会话新增/更新的双语路线图、知识库计划均保留，未全量暂存/重置/清理。Mini清单双文仅暂存本轮前缀；原有脏内容留在工作区。交接前核对`baseline-status.txt`/`baseline-dirty.json`/`before-inventory-prefix/`，不覆盖父会话计划。基础manifest未改变；新源码/测试/脚本均随本轮功能提交，tmp与凭据不提交。
