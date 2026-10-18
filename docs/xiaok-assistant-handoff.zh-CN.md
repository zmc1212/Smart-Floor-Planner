# 小客开发交接：PPT38现场落实与正式解决关闭

当前PPT38限定闭环Implemented，P5整体Limited；未生产发布。原S04/C01接通当前获同意方案→核对发布的现场记录/照片原件→明确落实→管理者分别解决、关闭→原授权咨询节选/所选原件→来源化追问及撤回。客户同意、普通回复、照片发布不自动关闭；关闭不代表验收或付款。

分支`codex/xiaok-public-site-lifecycle`，本轮起点`fe1ee601c150185def858cdb32df5178b3421ceb`。历史必要基础`148af95565defc72fe88c323779b65c171f94d27`、精确版本决定`d832c09bc8ed4840754972ea1ce4d7c0029fc71e`保留，精确范围仍见foundation-manifest。功能阶段提交：b137901d8a44508c9a388e7e8f4fbe9e47f4bb9f；普通推送后的最终HEAD/远端以`tmp/xiaok-p5-resolution/git-final.json`及git log为准；本交接另作docs提交。不合并main、不部署、不强推。

## 当前合同与边界

- 读根/admin指令、双语模块、路线图/二期、唯一还原台账及PPT38；仓库没有.agents/skills。PPT SHA与原提取审计一致，S04主源仍PPT22/38，C01/C05/U01共享组件保持。WXML/Less/插画/导航均未改，无新设计或图片切片。
- 新outbox evidence/lifecycle保存精确方案hash、来源/负责人与现场记录版本/hash/原件、逐次结论/正式操作者；源事项revision与处理revision分开。无新表/迁移。有效正式状态的普通回复/转交/取消/刷新先由管理者重新处理；原来源更正后可在同issueId重新核对、新版本决定、再落实/关闭，不被旧结论卡死。
- 实际移出/observer审计防止重新加入后复活旧方案批准或证据。管理者含所选企业owner/admin/super_admin，无须就业或成员身份；普通员工不能代客批准或正式解决关闭。
- 明确节选及回传原件是/否只授权原咨询；复用原JWT construction-records媒体GET和照片组件。独立合法记录发布仍守原授权。真人延后、过时结果dead、并发去重和原键回执重验来源；错误回执留原键，已知来源失效409保留输入供编辑。普通“关闭事项…？”仅查询。
- LangGraph/持久任务/租约/用量/接管保持，prompt v20只读实际team_result/formal_plan并继承原construction来源链，模型无解决/关闭/付款工具。开源链接与采用决定在双语二期。
- 方案来源按状态业务修订而非通知投递序号选择，迟到原发布不替换当前决定来源；同题工具链回归验证快照稳定及重新处理后的真实撤销，未放松来源校验。

## 最终验证

本轮最终实际验证：服务组合47/47（真实隔离库事务/业务服务，报告与模型输出采用确定性测试适配器）；组合内恢复用例2/2（已计入组合，不另加），覆盖有效正式状态不能被普通回复/取消/重新核对绕过、来源更正后同issueId重新核对→新版本决定→重新落实关闭。组合内降权恢复1项含设计者和项目经理，已计入组合；迟到通知来源专项1/1。Agent组合24通过/9配置跳过、0失败（协议/权限测试以模拟provider为主，不计真实模型质量验收）；Mini相关110/110，精确独立源码Mini逻辑98/98。Stable原生20/20，含真实上传、人工核对、精确决定、分步解决关闭、丢包回执、真人延后、原咨询JWT原件/hash、DeepSeek/deepseek-flash、langgraph-v1下两次v20追问、重新处理、撤回与成员失效；相册/原生确认注入合成结果，HTTP/Worker/模型/持久回读为真实链路，不计真机或真实微信授权。最终enterprise2424/project31/lead2889、原咨询176、事项592、方案609、现场记录44、run158–162，7次调用有observed tokens，费用未知。最终账户禁用、签名context_version提升，active_staff=0/active_runs=0；传输/SDK/存储与临时文件已恢复。

全量lint0错误/30既有警告；tsc292条且错误集合与前批一致、触及文件无诊断。精确独立源码Webpack compile模式通过，跳过类型/静态生成，不能当完整生产构建；普通构建仍被既有AiDesignerLegacyPage非法页面导出阻断。独立Mini打包12项9通过/3既有失败（business约2180KB、主包约2148KB及旧business登记断言），工作树打包通过依赖原未提交优化，不宣称干净克隆或可发布。完整Mini、完整宿主/光学/高屏/键盘、真机/真实微信/BLE、实际Worker进程重启、外部渠道和生产未重测；量房Phase0既有7通过/1失败保留。

早期SQL数组绑定导致原生发布503，已按相同查询/场景修复复验；SDK中途超时后在原窗口新编译重连；原件预览首轮断言过早，改为等待真实异步回调后复验。首批测试负例的空versions造成同步校验异常，已修正夹具并复跑。早期不完整/失败日志分别保留，不计入最终通过，也不通过换问法或换模型隐藏问题。首轮完整服务组合44通过/1失败未保留error_code，其直接原因仍未证实。第二轮45通过/1失败及同题专项0通过/1失败已精准定位：原发布通知晚于客户决定/回答投递，customerPlans按消息seq错误替换决定来源ID，使事实不变而快照hash变化。provenance-root-cause.json将该ID换回即可精确重算原hash；修复为状态业务修订优先，保留迟到投递、同一问题和全部撤销守卫。修复后专项及完整组合按上方实际结果记录。首轮、第二轮和定位失败分别保留在service-first-combination/、service-second-combination/、provenance-before-fix/；独立场景的咨询隔离只是夹具组织，不能当首轮失败的已证实原因。多项目大历史边界仍未验证。中断隔离夹具已按明确合成prefix与ID清理；原87项无关内容及5项删除状态保留，两份原脏模块文档仅暂存本轮增量。

原生最终同一数据：enterprise2424/project31/lead2889；staff5006/5007/5008、user3265/3266/3267、customer3268；原咨询176、事项592、方案609、现场记录44。先实际解决关闭，再重新处理并再次关闭，最终撤回现场证据后旧结果失效；不要把最后状态写成仍有效关闭。完整lifecycle/evidence ID及哈希见native.json。早期同prefix开发尝试的最终禁用/任务状态见fixtures-final.json；不是客户数据。

## 复跑与证据

admin目录顺序执行：

- `node scripts/construction-resolution-acceptance.mjs --regression`
- `node scripts/construction-resolution-acceptance.mjs --recovery`（两项已在服务组合执行，可单独重跑）
- `node scripts/construction-resolution-acceptance.mjs --revocation`（本轮纳入完整组合，可单独重跑）
- `node scripts/construction-resolution-acceptance.mjs --provenance`
- `node scripts/construction-resolution-acceptance.mjs --agent-regression`
- `node --import tsx scripts/construction-plans-development-acceptance.ts --development --resolution`

DB组只用55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS及共享advisory锁；原生只用已批准5432/smart_floor_planner、3006服务/既有Worker/唯一副屏Stable项目。当前测试夹具按项目与咨询独立，单个业务链仍用同一真实数据跨角色执行，避免无关场景历史累积。

证据在tmp/xiaok-p5-resolution/：stage-validation、service-regression（内含两项恢复及降权恢复）/provenance/agent-regression日志与状态、mini/snapshot-mini/snapshot-packaging、lint/tsc比较、独立源码manifest和两种构建结果、native/native-driver、原生execution-record/formally-closed/customer-closed-proof/closed-agent-followup/reclosed/evidence-withdrawn截图、workspace-preservation、interrupted-fixture-cleanup、fixtures-final及git-final。native-first-attempt/runtime-attempt/async-attempt和service-prior-attempt保存失败/不完整证据，不能叠加通过数。逻辑390×844、编码348×752；已核对目标路由/栈并看过结果、照片与失效截图，未声称完整视觉还原。

## 后续

用户最新要求已把下一重点改为“专业智能客服综合问答”，优先于P6多项目简报。先按本地最新整合版路线图1.1、3.1、4.1、4.4实施企业已发布知识＋模型理解解释＋获权实际工地事实的完整小阶段；不得退化成通用聊天入口或只展示一份displayText。用户最新委派已授权继续开发这一主线；路线图“本次只整理计划”说明计划编写轮次，不构成新的开发暂停。现有C01/来源组件可复用，新视觉方向与生产仍守原批准边界。新计划QA-01–08均未实施/未执行，本轮原生两次关闭追问只证明原业务投影及来源链，不计综合问答验收。

本轮只读核对已完成：原PPT SHA9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4；5/6要求先回应客户问题、带已有信息少重复问；14/15从户型和“靠窗、偶尔两人办公”等生活语言延续；18/19分别是防水安排、铺砖纹理喜好；22/23要求已核对记录原件及按项目/房间关联资料；38要求缺失或说法不一致先向负责人核实。已查看image6/image27，不能把计划中新写的洗碗机等问题说成PPT原文。下一阶段完整来源/行号/缺口与验收切片见tmp/xiaok-p5-resolution/next-priority-audit.json。

现实现核对：knowledge/answer.ts最终仍为摘录选择，agent/worker.ts业务最终仍用business.displayText；已有query_business(construction)、query_materials/query_followups和construction/need/media/reference来源守卫可复用，但尚不构成专业综合解释。新路径须记录全部实际使用的知识/业务/媒体来源及版本，模型前后/提交/历史重进复验；金额、工期、审批、验收、付款及动作成败保持真实业务权威。当前实际模型imageInput=false，未传像素不能声称看图。

下一小阶段按最新3.1先补P2M.1–.3专业客服：覆盖QA-01/02/05/06/07/08及对应PPT5/6/10–15片段，正常专业解释、连续追问/更正、缺失、冲突/更新、受众/撤权及问答与真实办理分流。知识和已具备的获权工具结果进入同轮解释，不能只返摘录/displayText。按4.4登记专业要点/允许建议/禁止推断，新增语义核心在配置模型/prompt上至少执行2次，分开记录真实检索/模型/HTTP/数据库与模拟provider/选图注入，保留时延和可核验用量，未知费用不填零。随后P3B/P4A的QA-03/04再补同题不同实际节点、记录/图纸/照片专业解释，不把后期业务变成第一阶段前置门槛。使用现有C01入口和Stable自动验收。不得凭空补写PPT具体内容、把一般解释一律建事项或转人工、让模型猜现场事实。当前未交付的完整S05/CAD/PDF/自动识图、自动算价排程、工程验收/支付、外部送达及P6简报仍保持原状态。

最新双语整合路线图（1.1/3.1/4.1/4.4及QA表等）由用户在本轮期间另行更新，已逐字保存并保留为未暂存改动，整合版没有追加本轮执行日志；功能提交中的路线图只取本阶段预先独立保存的PPT38增量，未混入新计划整理；原87项无关内容及5项删除也保留。下一轮应先检查这些未提交计划改动与交接，保持最新优先级，勿用Git恢复覆盖。日常Sol/max/fast；确有复杂协议/证据问题再向用户报告以便Astra/xhigh攻坚。
