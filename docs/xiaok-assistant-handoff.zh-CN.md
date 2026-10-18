# 小K助手阶段接力记录

**PPT23获权资料、同事项结果回传及原咨询追问的限定阶段已完成；P5整体仍Limited。** 持续开发授权有效：完成可验收的小阶段后继续，不等待人工A10、截图或逐小步确认。只在开发分支定向提交/普通推送，不合并main、不部署、不强推、不整体暂存。本记录以最终实际日志为准，早期失败与中断不计通过。

## 本轮交付

1. 客户在原C01咨询明确共享某项目/房间的需求节选，或上传后紧接着共享本人点位图原件；保存精确资料ID、原话hash、原件mediaId/hash及原咨询受众。S01接待同意不能当作项目共享许可。多项目/同名房间须明确对象；正式户型source_ref不能改叫点位图。新的同类共享明确替换旧版，撤回不回退旧版。
2. S04按同项目/房间组合现场原记录、获准需求与图纸原件；有权设计师/管理者围绕同一稳定issueId核对图纸关联、回复、转交及重新核对。GET版本快照增加roomId→materials hash，旧记录/事项/资料版本不能继续提交；原键恢复不重复业务写入。owner/admin/super_admin继续在所选企业继承管理权，无须成为项目员工。
3. 只有管理者明确编写“回传事项编号：给业主的回复”才建立结果事件；不自动复制内部回复、照片或私聊。待投递事件只回原需求授权咨询，真人接待期间延后，恢复AI后重核来源/成员/客户/发布者后投递一次。撤回/替换/成员移除/版本变更使待投递及已投递的受控派生结果失效，失效事件终止而不阻塞后续候选。
4. Agent的query_followups现在能查到本咨询实际收到的团队回传，而非只查节点补问。模型上下文、工具路径（即使原回执已超过30条历史）、派生回答与记忆复用既有construction source_refs/快照/执行和提交守卫。当前prompt xiaok-renovation-v18；供应商、模型及LangGraph编排未更换。
5. C01/S04仍用既有文字、原件网格、反馈和输入；只切换数据、资料标签/错误文案与原件路径，不改样式、插画或导航。新增Mini/Admin共用的GET /api/{miniprogram/construction,construction}/projects/:id/chat/materials/:grantId/media/:mediaId；无新表/迁移/菜单。完整接口、字段、状态、权限、原件和设计映射见双语二期合同；双语模块清单与唯一还原台账已同步。

## 最终实际验证

| 检查 | 结果与边界 |
| --- | --- |
| 共享/获权资料组合 | 20/20通过（新增Agent追问前的组合）；既有共享10项均通过。当前最终获权/回传/Agent来源专项为12/12通过，包含实际查询工具回归、超出模型历史窗口后的原件来源继承及撤销。组合与专项有重叠，不相加为独立场景数 |
| 相关Agent/资料/节点事项 | 33项：24通过、9配置跳过、0失败；跳过的既有可选真实模型/图片/节点语义场景不计通过。本轮对应回传语义另由下述两次真实模型追问验收 |
| 既有现场施工组 | 17项：16通过、1配置跳过、0失败；跳过的是原可选真实provider+私图项，原报告文本链已由原生两次真实执行 |
| Mini定向 | 59/59，含获权原件URL/撤回缓存、资料hash冲突保留输入并显式重发，以及聊天/媒体/现场排序/打包；全小程序套件未重跑 |
| Stable原生最终链 | 21/21；唯一副屏Stable2.02.2608080、SDK0.13.0、库3.17.2、auto9420/CDP9431，新编译、实际输入/按钮/上传/原件读取/原键恢复、多角色、重进、真人延后、撤回和成员撤权。照片选择及本组合成结束接续确认使用SDK/测试适配，multipart、JWT鉴权、HTTP、服务写入、Worker及持久回读为真实链路；不等于真实微信授权/相册或真机确认验收 |
| 当前配置模型 | DeepSeek/deepseek-flash、langgraph-v1。最终run136/137为xiaok-site-record-v1的两次报告；run138/139为v18两次原咨询追问，均引用原团队回执message452（事项389修订8），返回仍待现场复核/非批准。撤回后原回传和两条派生回答均不可用。6次模型调用均有observed tokens，费用未知；不是通用语义/文风评分 |
| 工程 | ESLint0错误/30既有警告；全量tsc仍292条诊断，触及文件无诊断，与首轮剔除本轮已修正3条后的292条错误集合一致。隔离Webpack生产构建通过（27.4秒编译、111/111静态页、原有favicon追踪复制告警）；不替代独立全量tsc或部署验收 |
| 保留的未测项 | 全小程序套件、完整宿主/高屏/键盘/光学还原、真机微信授权/BLE、外部微信投递、生产环境。量房Phase0既有7通过/1失败保留，本轮未重跑或修复。均不转为用户必须手测或发布批准 |

本轮真实发现并修正：查询响应空值分支及3处类型错误；最小化窗口被旧窗口脚本过滤（只恢复已核实唯一项目原副屏位置，不重开项目）；合成结束接续的原生确认未处理；真实模型调用query_followups时因缺少团队结果投影而错误返回“没有节点事项”。最后一项是产品缺口，已补授权最小投影并在同两类真实问法复验通过，没有靠换测试问法掩盖。早期日志保留，不混入最终通过数。

## PPT覆盖与当前限制

| PPT | 已验证的限定场景 | 仍未完成 |
| --- | --- | --- |
| 22 | 原话→真实整理草稿、原记录/版本、共享重进 | ASR；本轮未重跑整套发布/外部通知原生链 |
| 23 | 有效客户需求节选+客户点位图原件+现场记录，设计师同事项关联核对/回复，管理者明确回原咨询，来源化追问/撤回 | 企业正式出图/批准图纸域、完整S05资料卡、具体方案差异/费用工期影响、客户正式决定 |
| 33 | 同项目来源、接手/转交、负责人/管理者边界及回传 | 跨项目经营待办/报修全链/完整经营简报 |
| 38 | 回复仍待核对、源变化停用、重核/明确取消/撤销派生回答 | 正式解决/关闭/批准、验收与外部投递 |

图纸只是客户主动提供的原件、员工核对关联，不是正式批准版本；文字中的V2不自动变成业务版本或施工许可。仍只支持合同列出的显式编号命令。查询原记录最多10条、共享事项投影最多50条，获权来源每房间每类一个当前版本；query_followups最多30条节点问题和30条本咨询已投递团队事项。完整分页/选择器、跨项目待办及自由组合解释未交付。不得将这些子场景写成整页PPT或正式业务完成。

## 命令、环境与证据

在admin目录：

`node scripts/construction-materials-acceptance.mjs`（共享+资料默认组合；当前增加来源追问后为22个唯一用例）

`node scripts/construction-materials-acceptance.mjs --materials-only`（当前来源/回传专项12项）

`node scripts/construction-materials-acceptance.mjs --agent-regression`（33项相关回归）

`node scripts/construction-acceptance.mjs --site-only`

`node --import tsx scripts/construction-materials-development-acceptance.ts --development`

隔离脚本固定检查批准的localhost55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS及共享advisory锁；DB组顺序跑，不并发抢隔离Worker。原生fixture固定批准的localhost5432/smart_floor_planner、本地3006及既有Worker。仍依赖工作区已验证SDK/CDP/window工具，不打开项目副本或第二个项目窗口。

最终合成数据：enterprise2414/project21/lead2879，staff4976/4977/4978及user3225/3226/3227/customer3228，原咨询156、原记录27/28、事项389；原团队回执452，真实追问454/456。最终active_staff=0、active_runs=0，context_version已提升撤销签名，临时图片/SDK确认/网络方法/会话与存储适配均恢复；回首页后断开SDK。其他本轮明确标记的合成企业2410–2413为先前尝试，身份也已停用，不是客户数据。

证据目录：tmp/xiaok-ppt23-batch/。native.json/native-driver.json及native-{granted-materials,sourced-reply,customer-result,customer-followup,material-revoked,cancelled}.png；materials-service.log与最终status、final-full-*（20项组合）、agent-regression.log/status、site-driver.log/status、mini-driver.log/status、lint/tsc-driver.log、tsc-comparison.json、build.log/status、workspace-start/preservation.json、stage-validation.json、git-final.json。native-first-pass/保存20/20旧限定主链；native-first-attempt/、native-second-attempt/、native-model-readmodel-failure/保存窗口/确认/工具投影失败证据。逻辑390×844、PNG348×752，路由/栈已核实并检查资料、原咨询结果及追问截图，未声明完整光学验收。凭据不写证据。

## 提交与工作区

- 分支codex/xiaok-public-site-lifecycle；起点和开工远端均为5f3550258cdb9a6952c6823ff2b8e40ed4f59f9e。
- 功能/合同提交：fe8e97373520c36e30d5d11ed5af4d6531775f1d（普通推送与远端核验见git-final.json）。最终交接提交为本文所在docs提交，最终完整SHA与远端一致性以git-final.json及git log -1为准。
- 只暂存本轮明确文件/片段。既有无关修改与删除保持，不整体git add、不重置/清理、不合并main、不强推、不部署。原本未跟踪的双语roadmap仅本地更新当前记录，不整体纳入提交；模块/二期/台账只暂存基线至本轮的差异。
- customer/site-http/site-watches/site-publications及Mini chat.js是本轮必要集成入口，新增追踪其既有相关基础和当前改动；其他未提交XiaoK/P4A依赖继续保留。因此本批不是可从干净checkout独立部署的完整包。起点462个已修改/未跟踪文件的hash、允许路径及原5个删除状态核对见workspace-preservation.json；未将其夸大为全部干净文件的逐文件hash。

## 下一批与升级条件

优先继续P5真正的业务版本闭环：先核对现有设计发布域和正式图纸来源，接企业明确发布/撤回的具体方案版本、差异及费用/工期影响，再承接有权客户的具体版本决定、要求修改及结果回传。客户上传图纸与员工关联核对不能代替该业务证据；正式解决/关闭必须有独立状态和来源合同。复用已批准C01/C05/S01/S04/U01主稿与共享状态；遇到真正新的或冲突的交互设计再按项目设计批准门禁，不以普通状态缺单张图片阻塞。

日常由GPT-6.1 Sol/max/fast继续。当前无未定位架构阻塞，资料与结果复用现有outbox、query_followups及来源守卫即可；只有实际证据表明跨会话授权/源撤销/租约或正式版本模型无法安全复用时，才向父任务提交复现、冲突和方案，请Astra/xhigh。重复批检可Luna/max；若交接效果不佳统一Sol，不为切模型缩小验收或提前结束。
