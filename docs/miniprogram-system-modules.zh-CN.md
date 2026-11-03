# 小程序当前功能清单

<!-- xiaok-v1-02-proactive -->

<!-- v1-02-staff-private -->
**员工私人报告追问06/07：Limited；本人服务与限定原生状态已验。** 原`followups/:bindingId/conversation`解析签名工人/设计师/老板收件人（含所选企业admin/super_admin），沿原ConversationService、owner参与者/仓库守卫、精确报告选择和同一Agent。引用固定本人/项目/周期/版本，实时重验职责、受众及原记录。员工快照保存admin principal并兼容旧userId；当前项目条件进入原KnowledgeRetriever/Evidence/引用管线。只读有效已发布内部/对客知识，不借管理草稿预览；发言保持私人，S04保持共享。0108仅扩展原触发器的owner本人AI模式消息。本机命令`node scripts/construction-report-migrate.mjs --development --staff-questions --audit=<新路径>`，排除外来0102。

<!-- v1-02-conversation-list -->
**批准01私人会话列表：有界Implemented；V1-02整体Limited。** 源为01-conversation-list-v001.png、原手账README与已批准管理入口SVG，853×1844→390×844。仅history改699px高/y145纸页、39×5握柄、31px同Black标题、18px项目名、独立右侧未读/时间、15px送达状态与16px普通标题；管理热区108×44px/13px。送达文案只依原已投递且当前获权latestReport，时间仍为实际保存时间，不冒充送达时刻。普通行保留真实首问标题、创建日期和开放/结束状态，不造模型摘要，无效日期留空。有旧有效列表时刷新不再插入加载行推卡，初次加载/明确错误/同范围重读仍保留。其他sheet、API/schema/角色/模型编排不变，后台无功能变化。

普通图标沿已有独立MessageCircleMore矢量配色，conversation-outline.png为48×48/1283B透明图；房屋仍用requirement-home.png，纸页/加号/箭头/环扣是原生几何，无截图切片、新业务画作或生图调用。同授权Black仅补“话”到45码位/11884B，原44字轮廓/度量drift[]，见tmp/v1-02-conversation-list-visual/font.json及原README的27元素标尺。

证据tmp/v1-02-conversation-list-visual/verification.json：最终client-02为120/120含13包体，lint-02通过/drift[]。native-03的两前置、两列表目标（几何、真实503/重读、卡片可见已读与完整报告未阅、管理入口）通过，但最后驱动重进同时带leadId+conversationId，整批仍failed；保存的entryInput判别已复现互斥拒绝。native-04-reentry仅补正确单目标重进、关闭保草稿、新对话不改固定绑定，3/3通过，不拼成一次最终整旅程。native-01最小化窗口前置失败、native-02的333/334严格宽度断言及外部api.js批内漂移都保留；后者整批无效不混用。分别记录加载/光学产品修复1、宽度驱动1、入口驱动1、只读最小化位置守卫纠正1。

最终4页PNG已按Stable390×844/编码348×752实际审阅；同HWND947063424最小化，只读保存位置证实原副屏、检查前后焦点相同，无恢复/输入/窗口修改。完整宿主、根面板原生及真机/键盘未验。驱动只暂停后台轮询以稳定几何，显式读取/回执/写入仍走真实服务。四批cleanup true：310–313项目归档/对客关、363–366记录撤回、128–131绑定停止、1021/1024/1027/1030普通夹具归档、5410停用；计划false/version234/dispatch_epoch57、q0，原控制及providerMax4114/knowledgeMax3753/3753 unknown-input_tokens null不变。仅保存自然客户原话协议夹具，不当原生发送或模型答复证据；新模型/摄取/生图0。main2096462/assistant2092160，硬限2097152余690/4992B；assistant超未改1998848安全目标93312B，实际编译/上传字节未验。原额度/语义停测、未知费用、失败和删除拒绝保持，根入口补验现按下文失败/返回条件保留，不提前V1-03。
根入口验收保持**Limited/未验证**，不宣称产品通过，也不据此判定根UI有缺陷。证据tmp/v1-02-conversation-list-visual/root-verification.json。native-05-root先因计时器属于组件而非Page的驱动错误失败；纠正后native-06-root仍为sheet=""。只读root-capability判别显示CLI的#xiaok-chat >>> .notebook-history实际返回外层component/node7；组件内查询能找到(26,47)/44×44真实按钮及handler。native-07-root-touch通过已注册元素touchstart/end在真实中心(48,69)触摸，sheet仍空、未发普通历史读取。根入口驱动修复次数2，按规则停止下一次选择器/坐标变体。归属原生自动化/组件动作接入，需有正式组件内目标动作机制及判别证据才能重开；不加产品测试钩子、不回退Computer Use/9420/窗口焦点、不重摄取、不要求用户手测。三根失败PNG已审，三批failed/cleanup true/drift[]；root06/07复用05已编译且未变的Mini源。最终七批回读：310–316归档/对客关、363–369撤回、128–134停止、四普通夹具归档、5410停用，计划false/version240/dispatch_epoch60、q0，原控制/账册不变，新增模型/摄取/生图0。只读额度快照仍为42条reconciling/2004000 tokens，日限1200000。深链01原范围证据继续有效，无第三轮根入口重试或自动模型/额度恢复授权。

<!-- /v1-02-conversation-list -->

<!-- v1-02-owner-detail -->
**批准03业主完整日报事实详情：有界Implemented，V1-02整体Limited。** 源为03-report-detail-v001.png及同一手账README/共用03/04（853×1844→390×844）。仅ownerDaily且ready使用独立owner-report-detail WXML/Less；其余员工/周报/阶段/未就绪/失效仍为原详情分支，移除新分支后其WXML与HEAD81a7b58b逐字相同。标题31px同授权Black、动态项目名18px本机宋体、正文/布签16px、元信息/原记录13px。分区顶行右侧沿原获权原记录操作；待你确认保留publishedRecordItems、协调/期前原段，原arrangements及facts_only/缺项不变，不填设计工艺或“明日安排”。统计使用实际cutoff，历史称当日进展，保存时间不冒充模型生成；无API/schema/权限/模型编排或新素材/字体变化。后台列表轮询现在保留已有操作错误，主动同范围原记录重读仍清错；恢复规则沿批准的共用失败纸条。

证据tmp/v1-02-report-detail-visual/verification.json：Node client-02为120/120含13包体、lint-02通过；最终Less改动package-02为13/13，均drift[]。native-02为4/4（2前置+详情几何+真实原记录503可见/同按钮恢复/已阅/精确引用保存及重进）；native-04-footer为3/3，仅补最终几何：纸页(15,90)/375×754，握柄(175.5,101)/39×5；正文滚动区(38,246.75)/322×508.25，追问(29,765)/334×44、16px/底部809≤真实safeArea.bottom810，滚动时固定；页脚两行13px。最终两页和一张被动完整宿主实际审阅，真实胶囊可见；宿主输入法条局部遮住右上关闭区域，不能称无遮挡完整宿主通过。逻辑390×844/编码348×752/HWND947063424。

原native-01失败与数字换行实体显示原文保留；错误/页脚修复1已验。光学修复2保留：native-03-footer的CTA bottom814超安全区4px，离线官方Less4.1.3证实max(...)被折为29px，转义后保留CSS函数，native-04实测padding-bottom34px通过；普通布签自然32px的原驱动<32断言也单列纠正，未缩小16px字或44px动作。四批cleanup true/drift[]，新增CLI参数文件/模型/摄取/生图0，内存身份/storage/transport/hydration恢复并reLaunch根。306–309归档/对客关、359–362原记录撤回、124–127绑定停止、5410停用；计划false/version226/dispatch_epoch53、q0，原27/50/60–64控制不变，providerMax4114/knowledgeMax3753和3753 unknown/input_tokens null未变。原02/04/06/07/08证据按范围复用；native-02之后只改本03 Less，最终原生后仅README结果文档变化有单列影响核对。后台1446依赖无漂移，仍仅原三API+proxy/process-only/compile-only；全build/standalone未过不升级。

主包2096461/assistant2084249字节，硬2097152，余691/12903B；assistant仍超原1998848安全目标85401B，单PNG≤300KB不变，实际编译/上传字节未验。完整03自然报告/工艺依据、原生长空/跨日期前/非空安排、根面板与真机/键盘未验；42条reconciling预占、原停测/失败/未知费用/CLI删除拒绝及D2=2/04光学2保持，无付费回退或新增额度。下一仍同V1-02批准01会话列表有界校准，不提前V1-03。
<!-- /v1-02-owner-detail -->

<!-- v1-02-owner-daily -->
**批准02业主根日报组件：有界Implemented；V1-02整体仍Limited。** 当前源为02-follow-up-chat-v002.png及同一手账README/共用03/04规则，853×1844→390×844。已就绪的业主日报补批准的我家进展标题、悬挂布签、23px同授权Black标题、13px快照日期/阶段/实际截止与16px正文；历史日报不称今天。进展只取原completed前两条，独立“待你确认”区沿原获权publishedRecordItems的pending/coordination及期前原段，不再被两条highlights截掉；已发布空投影不回退内部草稿。空/失效/加载、阶段/周报、接待及共用03/04保持原批准范围。无API/schema/权限变化、不造安排/工艺或自动确认施工，facts_only提示保留；原完整报告和精确报告追问动作不变。

02独立叶枝→miniprogram/packages/assistant/assets/owner-daily-leaf.png，94×168 RGBA/16608B，SHA256 0cf1224d73640a9c1bb66f93bd1a5d8c7dc3d3b75e1d8a5800ea1b97a3501471。官方Images API gpt-image-2.5-flare/medium独立1次成功/1图，1753输入/439输出/2192总tokens，unknown0/金额未返回；首稿光晕及响应/提示词保留于follow-up-v1/assets/owner-daily-leaf-v001/manifest.json，仅清生成画作alpha并等比优化，深浅底和原生已审。未将UI截图切片/裁切/蒙版成产品素材。同Black只增“家”到44码位/11660B并集，原43字轮廓/度量无漂移，动态项目名仍本机宋体回退。

证据tmp/v1-02-owner-visual/verification.json。Node client02为118/118含13包体、lint01通过，批内drift[]；首个包装误用Bun，在Node测试前失败，原记录保留。native01为3/3（2前置+真实已发布根卡/完整报告/精确引用保存及重进）；其tag按钮查询为空，不作为热区尺寸证据。native02-footer为3/3，仅补选择器测量：两个142.5×46px热区、15px字/8px间隔。3张页面/1张无遮挡被动完整宿主已按Stable390×844/编码348×752/HWND947063424审看；两批cleanup true/drift[]，新参数文件0，身份/storage/transport/hydration恢复，无抢焦点/移窗/新窗。原绑定保留，后续仅README结果文字与其CRLF→LF规范化，产品hash未变，单列无行为影响核对。304/305项目归档/对客关、357/358原记录撤回、122/123绑定停止、保留5410停用，计划false/version218/dispatch_epoch49、q0；原27/50/60–64控制与providerMax4114/knowledgeMax3753未变。后台1446编译依赖一致，仅复用原三API+proxy/process-only/compile-only，不升级全build/standalone。当前源包main2095985/assistant2077849，硬限2097152、余1167/19303B，assistant仍超未变1998848安全目标79001B。实际编译/上传字节、完整02与阶段消息组合、原生长/空变体、根面板/真机/键盘及正常模型/自然报告未验；42条reconciling及原语义/摄取停测、原失败/未知费用/CLI删除拒绝保持，新模型/摄取0。
<!-- /v1-02-owner-daily -->

批准08-boss-weekly-digest-v003.png及同一手账README/共用03/04状态规则现对应老板周报有界根组件，853×1844→390×844，整体仍Limited。真实项目分组/历史快照阶段沿原项目、完整周报和追问动作，固定标题28px/26px、项目名18px、正文16px、右对齐项目动作13px，双底部热区153×48px且可滚动到达。企业名按批准顺序置于“仅自己可见”之前；普通企业管理者仍只读所选企业，原平台选择器不变。元数据显示真实上海起止日（排他结束前最后一刻所属日期）及实际截止，“本期工地进展”不把历史称本周；只显示真实工地数，不造待协调总数。末段“已确认的后续安排”按原项目显示已确认原文，仅完整汇总且为空才显示“暂无记录”，未汇总/截断保持未完整状态，不补下周时间、负责人或施工事实。接待、失效、加载继续沿批准共用状态；无API/schema/权限变化，facts_only提示保留。

插画映射为批准08安排区叶枝→miniprogram/packages/assistant/assets/boss-weekly-leaf.png，126×192 RGBA、23445B，SHA256 e750086e9f88f0271affda080ef8a4bacccf7f4f1ef8139483a7fc76e3e4ef5f。官方Images API gpt-image-2.5-flare/medium独立生成：首稿及一次光晕定点修正共2次成功、每次1图，2996输入/878输出/3874总tokens，unknown0，未返回金额。原图/提示词保留于follow-up-v1/assets/boss-weekly-leaf-v001/manifest.json；仅对生成的独立画作清理残余alpha光晕并等比优化，已看深浅底和原生效果。未从合成UI裁切、切片或蒙版取得产品像素。同一授权Black字体扩为43码位/11292B并集，原29字轮廓/度量无漂移，动态项目名仍沿本机宋体回退。

证据tmp/v1-02-boss-visual/verification.json。最终client02为117/117含13包体，lint02通过/drift[]。native01为3/3（2前置+周报组件：实际项目/完整报告动作、原选择回调取消、长名换行、真实完整空安排及叶片）；native02-metadata为3/3，仅补实际截止/企业范围元数据，不重放或混合首批动作。3张页面PNG、2张无遮挡被动完整宿主图已按Stable390×844/编码348×752/HWND947063424审看；两批cleanup true/drift[]，省略CLI可选args、新参数文件0，身份/storage/transport/hydration恢复并reLaunch根，无移窗/抢焦点/模型/摄取。四工地300–303归档/对客关、353–356原记录撤回、5447–5448员工停用、116/117/119/120绑定停止，计划false/version214/dispatch_epoch47、q0，原控制及providerMax4114/knowledgeMax3753不变。首个最终回读包装在仓库cwd无法解析tsx，未触库；改为admin cwd的read02通过，原日志保留。原1446后台限定compile依赖一致，不新跑后台build。当前源包main2095760/assistant2056883，硬限2097152、余1392/40269B；assistant超未变1998848安全目标58035B。实际编译/上传字节、完整闭合周/原生非空安排变体、完整06/07/08/根面板/真机/键盘及实体宿主picker仍未验。正常模型/自然报告沿42条reconciling、2004000 tokens/日限1200000停测，原失败、D2=2/04光学2、unknown费用及旧CLI删除拒绝保持。

设计仍沿批准06-worker-follow-up-v001.png、07-designer-follow-up-v002.png及原手账README/共用04规则，853×1844→390×844。当前工人/设计师根日报组件已补角色标题、悬挂布签、18px项目名、14px左对齐项目操作与两个46px底部按钮。静态28px/22px标题使用原有已授权Noto Serif SC Black的43码位/11,292字节并集（原29码位字形/度量未变），嵌入miniprogram/packages/assistant/chat/staff-followup.less；这是同字体补字，未选择新字体。动态项目名保留原本机宋体回退。仅卡片展示别名改变，完整详情的身份/周期及原事实不变；历史日报显示原日期，不把旧报告标成“今天”，facts_only提示仍可见。无API/schema/权限变化、新插画或截图切片；员工普通专题未开放，接待/媒体仍仅客户可用。

06/07限定视觉证据：tmp/v1-02-staff-visual/verification.json。最终client03为115/115含13包体，适配器lint02通过、drift[]；native03-components为4/4（2前置+工人/设计师根组件），cleanup true/drift[]，四张PNG已按Stable390×844/编码348×752审看。真实保存的双项目报告、原长项目名换行、44px项目操作、滚动后可达的46px双按钮和实际首项目按钮已验。native01旧嵌套Less编译输出、native02不支持的标签选择器失败原样保留；只用官方cleanCompileCache，未清storage。native02保存几何另定位布签仍占普通文档流，组件修复1次并复用批准的悬挂布签规则。原04光学失败仍2，不是第三次04 CSS采样。完整06/07/08还原、根面板、实际宿主picker手势、真机/键盘及无遮挡完整宿主仍未验；可选被动宿主图受遮挡，未移窗/抢焦点，无模型/摄取调用。六工地294–299归档/对客关闭、原记录347–352撤回、员工5441–5446停用、绑定104/105/106/108/109/110/112/113/114停止；计划false/version208/dispatch_epoch45、q0，原控制/账册未变。当前源包main2095261/assistant2021914，硬限2097152、assistant安全目标1998848；实际编译/上传字节未验。

06/07/08项目下钻现将所点projectId传入原报告详情投影；刷新及从持久追问重开保持该项目，项目缺失/撤权沿原失效状态，不回退其他工地。完整报告/历史入口恢复整份范围。服务端仍解析和重验原完整报告及来源，客户端过滤不授予权限、不新增API。员工原记录在未关联正式事项时显示待核对/协调原段；正式跟踪优先，客户publishedRecordItems投影仍为权威。native01六项导航检查通过，但审图发现空issues数组遮掉原段，原视觉失败保留；native02-pending只补该显示缺口（1业务+2前置），精确项目和整份报告均显示正确。两批cleanup true/drift[]、新增参数文件0、模型/摄取0；前批7张/后批2张PNG已审。原生action-sheet采用内存回调选择/取消，不当实体宿主picker手势通过。最终client02为114/114含13包体，两次驱动lint通过；后台运行时/原编译依赖无漂移，复用三API+proxy限定compile-only。证据tmp/v1-02-project-drilldown/verification.json。夹具290–293归档/对客关闭，343–346撤回，5437–5440停用，96/97/98/99/101/102绑定停止；计划false/version199/dispatch_epoch42、q0，原控制/账册未变。当前源包main2094524/assistant2008779，硬限2097152，assistant超1998848安全目标9931B；实际编译/上传字节未验。

证据`tmp/v1-02-staff-followup/verification.json`：migration01应用0108；client02为110/110含13包体，unit01为6/6，lint01及driver-lint02/03/04/05通过；types01保留82原错误/受影响0。service01为5/5（1夹具+4员工业务）、cleanup true/drift[]，覆盖五个签名身份、事实报告保存/精确选择及同键回读、当前项目/发布来源、额度回滚、他人/租户/接待/预览拒绝和成员/原记录撤回。合成assistant回复/run/citation仅协议夹具，无provider job/预占，不算语义回答。native01选择器及native02遮挡整批失败保留；只复用native02保存的工人移除/草稿/原键断言。native03-remainder原生5/5（2前置+额度保留输入、真实本机HTTP503同来源重试、设计师隔离/持久重进），产品/驱动绑定drift[]；外围服务批因首个员工清理事务连接超时仍failed。保留原超时、Windows URL包装失败和绑定未停断言；`cleanup-final.json`已回读两名新员工停用、三绑定停止、项目归档/原记录撤回、q0、被拒消息0及账册不变，未重放原生/模型来改判。驱动现对各独立自有资源各尝试清理一次并记录每个失败。compile01仅三个受影响生产API和proxy通过，沿原进程内覆盖/compile-only，配置变化0/drift[]；全build/standalone未过。原员工入口证据时源包main2094036/assistant2008675，硬限2097152，assistant超1998848安全目标9827B；实际编译/上传字节未验。

最终夹具复用未变286–288/5420–5434及新289/5435–5436：四项目归档/对客关闭、17员工停用、17员工+4客户绑定停止、原记录339–342撤回；计划false/version193/dispatch_epoch40、q0。providerMax4114/knowledgeMax3753、3753 unknown/input_tokens null和原D2=2/10对话unknown/CNY32.828897保留，新增模型/摄取0。42条reconciling预占2004000 tokens/日限1200000仍阻止正常问答/自然报告；不释放/重算预占、提额度、付费回退或重开停测批。native01的7个CLI参数文件按清单删除被自动审批以`blocked by policy`拒绝，删除0/拒绝1，不读正文、不重试/绕过；native02/03省略官方可选args并用一次性loopback内存身份，各新增参数文件0。只读清理/manifest元数据。原75文件及拒绝2保留；先前一次过宽rg涉及该旧目录，不能建立全局从未扫描的声明。无生产/远程/外部消息授权。

<!-- v1-02-report-context -->
<!-- v1-02-live-followups -->
<!-- v1-02-report-final -->
**报告最终回答合同：限定Implemented，自然回答仍Limited。** 配对报告query已要求有来源synthesis，生成/服务端/持久化拒绝business整段显示；12:00Z实际转为上海20:00，原事实不改。保存1929确定性拒绝，定向单元/runtime71/71（1882项绑定drift[]）、真实服务权限3/3、lint及types82继承/本次0通过。固定report-final-configured01在业主1930通过、1931失败后停止：事实及synthesis正确，但漏答本轮房间更正和周五下一步。员工/原生未执行，cleanup true/drift[]。新增4次qwen3.7-flash输入28112/输出312，实际金额unavailable。原读取域/正文修复2及所有首稿/费用保留。report-final-discriminator.json已证明当前原话完整进入编译，扁平synthesis缺逐问项回答合同。下一项复用SourceQuestionCoverage/分组synthesis绑定完整当前原句，沿原query/final调用及catalog；不重采本轮格式，不增规划模型/Agent/知识库或权限解析器。普通显示/共享工具、租户/收件人/撤回/一次修复及批准04/06 UI保持，无路由/schema/素材/摄取/生产变化。证据tmp/v1-02-live-followups/verification.json#reportFinalMechanism。

当前原话覆盖机制限定工程Implemented，正常回答仍Limited。完整当前原句（保留更正/条件，最多6组无损合并）复用SourceQuestionCoverage/原分组synthesis schema、原query/final调用/catalog，服务端严格投影后沿原synthesis守卫。89/89（1884绑定drift[]）、lint及types82继承/本次0过，保存1931离线拒绝且原来源不改。固定report-coverage-configured01在业主1932通过、1933失败后停止：首稿漏Q2，原唯一修复补齐结构却新增无引用日期，被原安全守卫拒绝，未交付答案；未分房间的原记录也不能推出客厅开关/插座具体结论。完整业主/员工/原生未验收，员工/原生未执行，cleanup true/drift[]。新增6次qwen3.7-flash输入40020/输出770，另有查询Embedding输入57，实际金额unavailable。两个最终格式策略已失败于同一业务期望，停止第三次同类补丁/采样，原读取域2/正文2/首稿/费用保留。保存1933已证明首稿与读工具并存、并非native Schema；仅修复是native/schema-valid。下一步只用原trace判别既有native-final收尾/分组数值约束与来源语义校验，在原预算内取得新机制证据后才决定准入；诊断本身不授权新模型/fallback、额外规划/审阅调用、摄取、UI/设计或生产。证据tmp/v1-02-live-followups/verification.json#reportCoverageMechanism及report-coverage-discriminator.json。

report-native-final-v1限定工程Implemented，真实业主/员工/原生闭环仍Limited。仅新获权私人报告追问绑定native收尾及逐Q原数值/引用约束；strict Schema、图像投影、原守卫和3+1调度保持4次/72000预算，企业配置及旧run不改。108/108、保存1933拒绝、lint、types82继承/本次0及preflight04=4/4通过。固定report-native-configured01保留业主1941首稿通过，随后1942indeterminate/4140unknown即停：原provider诊断finish_reason=length、输入5165/输出2048、content4667字符，无完整回答/修复或raw frame，不作语义/原生验收。员工/原生未执行，drift[]。五次已知调用输入33100/输出268，第六次诊断用量5165/2048另记、实际金额unavailable；原42预占/unknown不变，新1941/1942预占144000仍reconciling。cleanup保留false：业主选择清理由原unknown的conversation_busy拒绝，不改guard/账册；两工地归档对客关/version34、账号停用、员工选择null、q0及自有资源释放，归档后读取被拒。原unit01过时能力断言及三项驱动合同失败均保留，后续工程检查通过。证据tmp/v1-02-live-followups/verification.json#reportNativeMechanism及report-native-outcome-read01.json。后续失败帧留存限定工程Implemented：获权native final/answer阶段复用既有private checkpoint保存有界无效帧，120/120、lint、types82继承/本次0及drift[]通过；公开诊断、unknown/fallback/账册与旧4140不变，未新增实测失败帧/模型/Embedding/摄取调用。新run输出分配现限定工程Implemented：仅新报告追问policy绑定reportFinalOutputTokens4096，仅用于native最终/修复回合；规划及旧run仍2048，原16000单次估计/4调用/72000预占、图像与来源守卫不改。124/124、lint、types82继承/本次0及真实回滚准入4/4通过、drift[]，旧1942仍2048，实测驱动要求最终step留4096证据；见verification.json#reportNativeOutputAllocation及report-native-output-discriminator.json。2026-11-03用户最新明确不因token费用凭证停止开发；已沿原UsageService.reconcile将合成1942按21450 tokens及原预占1CNY作保守开发预算记账，reason明确实际费用仍unknown。原1942/4140状态与旧42预占不变，1942重试仍拒绝，随后已通过原服务清理其选择；不冒充实测费用或生产政策变更，证据development-budget-review01.json。固定输出批在业主1947即停：完整/schema-valid首稿与唯一修复被内联序号3误拒；外部camera/sd.ts及camera/service.ts漂移令整批无效，cleanup true。四次已知调用输入24624/输出637 tokens，金额unavailable。保存帧判别后，既有proseNumberView仅在数字分析视图以Unicode句界及原CommonMark AST识别连续1..N序号，原文/引用及实际数量、日期、承诺守卫不改。定向31/31、lint通过；稳定types02与原82项诊断逐条相同、本次0、drift[]，types01的camera/schema/tests/tsconfig漂移仍无效；解析器提交98a67ce8，无UI/API/schema或Knowledge来源改动。后续固定report-native-ordinals-configured01在首个业主1950/4147unknown即停：4096最终输出length/content8918，既有私有路径已实际保存step1902失败帧；首个605字符完整对象就缺Q2、引用类型错误，随后14次代码围栏重复。原local/wire Schema能接受合法形状并拒绝该前缀，未发现本地Schema矛盾；不截取或修成答案，旧1942 raw仍缺失。前两次已知输入14037/输出22与最后诊断5022/4096分开留存，实际费用unknown。原cleanup false及tsconfig漂移不追认；随后沿原UsageService.review2按23177观测/诊断tokens和原预占1CNY保守记开发预算，明确非供应商实测费用，再由原服务清空业主选择。1950/4147仍indeterminate/unknown，未调用retry；两工地归档对客关、账号停用、双方选择null、q0、自有资源释放。其余3服务/2原生未执行，V1-02保持Limited。强制终端承载现为限定工程Implemented，真实配置旅程仍Limited。新准入持久绑定reportFinalCarrier=forced-final-function-v1，仅在既有final-only阶段强制唯一final_response函数，复用同一分组Schema/catalog和原应用校验。旧1942/1950及缺该字段的旧快照保持JSON传输，均不重放。原私有帧保留真实调用，既有投影解包终端且不执行业务工具，观测如实记function_call/application，不冒充供应商JSON Schema。真实图像、企业开关、最终4096份额及3+1/4调用/72000预算不变。117/117、当前定向lint、真实回滚服务预检4/4通过，cleanup true/drift[]。两次全量types均与原82项逐条相同/修改相关0，但外部eslint/tsconfig漂移使01/02无效；捕获配置的定向types02核9个修改文件/7570程序依赖，诊断0/drift[]。定向types01的驱动原有Buffer/BinaryLike冲突保留失败；可擦除标注后JS逐字一致、定向lint通过。原固定report-final-function-configured01中业主1955首稿已保存/重读通过，随后1956以failed/native_schema_unverified停止：单一函数完整参数的Q2含无引用日期；另有把未注明房间的原记录推成客厅灯位/控制细节的语义失真。1956无修复或可交付回答，工人2及原生2未执行，cleanup true/drift[]。6次已知调用输入40907/输出526，实际金额unknown；无新provider unknown、Knowledge/Embedding/摄取/正文调用。原父链2/序号1及格式/读取/正文2保留为历史明细；最新计划6.1按同一报告追问业务目标合计至少4个工程包，剩余工程额度0，1955部分成功不重置。按计划6.1停止同目标新增工程/调用。原页候选只读核验见report-final-function-next-qualification01.json：原册/副本SHA及已核29/30派生关系吻合，但已发布FileLocator.page1正确定位各单页OCR副本，未证实独立的错文件/错页/下载失败；保存1925仍属于已停正文旅程，新增origin合同/消费/发布不能改名成独立业务。未准入原页工程，未改404/405或28草稿，未摄取/发布/重放旧正文及unknown。最终serial-final-read03.json核246/247归档对客关/version44/48、5406/5410停用、22/24stopped、双方选择null、q0、provider4153/knowledge3753，策略仍false/version296/epoch82，原账册保持。源码提交c7afbe7a；后续外部摄像头提交d2ccf01e未改变本批9个涉及源码hash。已读维护中的[Qwen Code终端实现](https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/tools/syntheticOutput.ts)、[对应测试](https://github.com/QwenLM/qwen-code/blob/main/packages/core/src/tools/syntheticOutput.test.ts)及[LangChain AgentNode](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain/src/agents/nodes/AgentNode.ts)，未执行上游测试。采用同Schema终端/应用校验模式，沿项目原LangGraph/投影及有界修复、租户/来源/账册生命周期，不照搬上游重试循环或另建Agent。证据verification.json#reportFinalFunctionCarrier及report-final-function-configured01/review-1956.json。不改旧run传输、原失败次数、图像/企业配置、批准04/06 UI及来源发布。证据verification.json#reportInlineOrdinalMechanism、#reportFinalCarrierCandidate及report-native-ordinals-frame-discriminator01.json；解析参考[mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown)与[Unicode句界](https://unicode.org/reports/tr29/#Sentence_Boundaries)。


**私人报告读取边界：限定Implemented，自然回答仍Limited。** 业主和员工construction_followup回复现在仅提供报告域query_followups({})及原search_knowledge；项目共享问答仍仅知识工具，显式另开的普通专题保留原服务。适配器复用boundReportContext、step740、现有持久agent_tool/BusinessSnapshot及citation catalog；新读和缓存读均重验所选收件人、报告版本、项目、原文hash及当前来源/成员权限。只消费冻结原事实，不读取生成正文，不授予需求写入、施工批准、其他咨询或额外项目访问。无路由/schema/UI/样式/素材/模型提供方或知识摄取变化。

证据tmp/v1-02-live-followups/verification.json。preflight06为3/3，包含两角色在回滚事务中的新读/缓存/收件人/撤权探针；final-kind单元14/14、runtime兼容25/25及定向lint通过。最终驱动类型修复仅擦除的夹具标注，项目82条继承错误保留。configured01–03仍failed、cleanup true/drift[]：1926被普通咨询读取守卫拒绝，1927被不可用工具守卫拒绝，1928取得部分有来源正文，1929虽服务run成功却将原始business快照当作房间更正/下一步问题的回答。读取域修复次数2，该补丁/模型循环已停止。共7次qwen3.7-flash调用，输入47134/输出239 tokens，实际金额unavailable而非0。旧额度阻塞只作历史证据：用户已确认每日无限制，本轮成功准入，未释放/重算旧预占；3753及旧unknown保留。首个业务失败后的工人正常问答及计划Stable输入/重进均未执行，不新增原生、渲染状态或还原通过声明；批准04/06结构/样式/素材及台账不变。

跟进回复已复用原citation chips、参考图materializer和来源sheet。GET `followups/:bindingId/conversation/citations/:citationId`在原ConversationService内先核同一会话，再走知识/网页原投影；不授予其他私人目的地或接待员工访问权。原run查询及POST `runs/:runId/cancel|retry`、journal、待发消息纸页和生成/停止/unknown控件已接入。移除报告保留可见且可编辑的草稿，新AI发送仍要求有效显式引用。关闭/隐藏或身份、权限失效会清来源；被include的WXML已在本地导入报告模板。员工私人入口/来源范围见上文；正常AI回答验收仍未完成。

**报告追问04仍Limited。** 批准04/06保留精确持久报告版本/项目/周期/截止/hash，并由step740消费获权原事实。每日无限制准入已验证，但自然更正/下一步回答及完整业主/员工/原生旅程未验收。读取域修复2与原正文修复2分别停测，不宣称V1-02完成或推进V1-03。

原生分批保留：native04只复用前2个业务通过项（含查看/移除保留草稿）；native05复用丢选择回执的原键恢复；native06为7/7，含2项前置及5项业务：显式普通专题/固定投递、原来源sheet与受控本地HTTP503/重试、合成run控件、真实人工暂停/结束、撤回。native12为3/3，含最终命名元素、4张组件图及1张被动完整宿主；旧失败批仍失败。各批绑定和清理保留、drift[]；合成回复/run/citation只算工程证据，不是模型正常回答。根面板04、真机/实体键盘和实际编译/上传字节仍未验。

光学修复次数2保留：native08/09预期头像x38/动作44px，实际仍x0/43px。停止源码补丁后按Mini运行时/编译缓存共同原因判别：只读compile_wxss的diagnostic10失败；diagnostic11仅清本项目编译缓存成功。同一产品源码的native12随后实测x38/44px，并核生成/停止/未知纸页。原纸页23px标题/16px说明、15px动作、14px布签、13px引用条保持；既有公共范围栏下，这个动态两行标题纸页实测(38,199.8)、327×184.38，原近似y181预标尺不冒充完整公共壳精确还原。无新字体/插画/截图切片。

兼容client14为106/106；最终仅布局变化client15为25/25，含13项包体，两批drift[]。原client09的105及offline05的41沿原范围保留。lint10通过；types10完整执行仍82原错误/受影响0（后续仅WXML/Less/类名变化）。生产compile01仅三个受影响API入口及proxy通过，源码/运行时/环境绑定drift[]；默认standalone/全量build未通过。源包main2093818/assistant2008628，硬限2097152不变；assistant仍比1998848安全目标高9780B。最终回读q0、报告计划false/version181/dispatch_epoch36；10个新合成项目均归档/对客关闭、绑定stopped/ai、原记录撤回，专题933归档、合成账号停用。provider/knowledge max仍4114/3753，新增调用0；3753 unknown/input_tokens null及原D2=2/费用不变。首次清理回读发现77个本04新CLI参数文件，已按核定路径用原生PowerShell一次清除；旧75个未动，其原两次自动拒绝保留，正文均未读。证据tmp/v1-02-report-followup/verification.json。

本04命名元素台账（native12；逻辑390×844/编码348×752；限定变化组件，原公共壳保持）：

| 元素 | 实测边界/字形 | 来源映射与限制 |
| --- | --- | --- |
| 报告纸页/悬挂布签 | (38,199.8)、327×184.38；布签(45.87,183.45)、144.25×43.68/14px | 批准04纸页；合成长标题自然两行；既有范围栏止于173.8，不宣称完整壳匹配y181 |
| 标题/原摘要 | (57,226.8)、289×64.38/23px；(57,296.17)、289×24/16px | 原Chat Serif900/正文400；相邻5px |
| 查看/显式专题 | x159.09/266.55、y331.17；各79.45×44/15px | 原双动作，间隔28px，实际热区44px |
| 引用/移除/图标 | (36,697)、330×44/13px；移除(322,697)、44×44；图标20×20 | 原灰绿条和x素材；移除保留可编辑草稿 |
| 输入/发送 | (26,765)、349×67；发送(327.5,776.5)、44×44 | 原输入区及真实宿主安全区；实体键盘仍未验 |
| 运行头像/纸页/动作 | 头像x38、41×41；纸页x87；说明16px/动作13px、热区44px | 原共用05/06/07/未知组件；最终4页/被动宿主已审；仅合成协议夹具 |

<!-- v1-02-human-takeover -->
**人工接待11：限定 Implemented；V1-02整体仍Limited。** 设计仍沿批准11-human-takeover-report-v001.png与原手账README/共用状态，853×1844→390×844。C01复用原ChatController、媒体适配及持久请求journal，支持客户私人跟进的等待补充、真实员工文字/图片、发送及结束的原键重进恢复、接待人失效反馈和明确请求/取消/结束。普通咨询草稿/目的地独立，拒绝只清本目的地待核对操作。跟进麦克风明确不可用，普通语音不变；没有新Agent、知识/权限/引用管线、新字体、生图或截图切片。

GET /api/miniprogram/assistant/followups/:bindingId/conversation及messages?beforeSeq=&limit=、handoff、media[/:mediaId]，POST messages/handoff/media及原媒体DELETE均委派原ConversationService/HandoffWorkflow/HandoffService/媒体服务。服务端解析本人收件绑定和同一会话，再重验原仓库、Mini身份/所选企业/项目及参与者；正文不能选择会话/主体/租户，员工提问沿上文本人收件路径，接待/媒体仍仅客户可用，普通conversation API未开放。原员工handoffs列表/接单/读取/回复/媒体仅沿有效客户跟进和原显式同意/授权；0107扩展原参与者/消息触发器，保留员工私人会话owner边界。接待包/消息排除报告定位符，接待不授予收件人报告权限。明确回到AI后，无有效04显式报告引用的AI发送及全部AI上传仍禁止；正常04回复仍受原额度/语义返回条件限制。

接待切换取消聊天执行，但保留排队/运行的construction.report.facts及其context revision。后台任务、保存结果和只读历史与AI插入分开；明确结束/取消记录数据库时钟endedAt，此前创建的报告投递静默为muted，包括之后才完成的任务，历史仍可读且不集中补刷。停止/删除/改绑/dispatch epoch、当前项目/来源及其他会话取消规则不变。读报告不会恢复AI或结束接待。

证据为tmp/v1-02-human-takeover/verification.json。HTTP05的9/9及清理沿原绑定范围复用：真实等待/接单/文字/回复/私图、同键恢复/冲突、后台与排队报告跨接待继续、静默积压及租户/身份/当前项目/员工拒绝；原失败与其后接待定位符过滤、客户端journal和样式影响分列。native10在同一副屏Stable2.02.2608080/base3.17.2/390×844完成7/7：真实等待补充/接单、发送丢回执原键重进、真人回复、AI暂停期间只读报告、接待人失效、结束丢回执恢复/旧staff拒绝；定位符过滤用真实已存报告核对。9张348×752页面和2张1700×960宿主已审看。native13只定向改后组件样式/失效变体4/4，2页/1完整宿主、直接/嵌套驱动绑定drift[]；被动宿主截图核同HWND947063424、位置/遮挡及前台前后一致，不抢焦点/输入、不新窗口。业务与视觉分批复用，不虚构最终源码全套一次通过。

启动根因已定位为followup-view.wxml:36的wx:else与wx:for同节点，IDE真实编译日志在App/Page注册前拒绝；加入不产生渲染节点的block修复分支，保持消息DOM。单独WXML摘要不是实际页面编译成功。native01–07、08异步接单断言、09前台截图拒绝、11旧导入Less、12深色渐变/CLI求值失败均保留原结果。最终入口失效更新后核到新Less，已实测/审看悬挂布签、浅色已保存标签、本11独立23px标题/16px说明/13–15px操作、长姓名两行自然重排及44px操作框。原C01壳/图标/Chat Serif保持，未升级完整公共壳字形光学；逐元素尺寸见现有设计README及小程序清单下表。

最终包体13/13、驱动lint0，绑定drift[]。Static01客户端79/79、源码lint0错误/25警告与类型原82/涉及0仅在列明五个变化文件（WXML/Less入口及驱动绑定）后复用未变JS/后台逻辑，不重放。末次包体首包装误用Bun、首lint包装10s超时原件保留。新全量webpack构建在自有worker约8.5GB驻留后中止，不计通过；compile04采用进程内入口/output覆盖及compile-only，实际完成小程序assistant、后台handoffs、内部Worker三个受影响生产API入口及proxy，加载的.env.local/.env.production、Node/Next及驱动/配置/源码绑定drift[]，仓库配置字节未改。默认standalone/全产品构建与原全量类型失败仍未通过，打印的全路由表不代表全部路由已编译。Compile02验证钩子错误、03较窄配置绑定单列。

助手源包1995992/1998848，余2856B安全量；实际打包/上传字节、根面板11、实体键盘/真机及完整跟进还原未验。最终回读队列0、计划false/version154/dispatch_epoch23，271/272归档/对客关闭，60/61 stopped/ai，5410/5419停用；原27/880/human及50/910/stopped/ai不变。身份/存储/传输/hydration已恢复，当前根路由pages/index/index，无自有controller/任务/构建/锁。providerMax4114/knowledgeMax3753及3753 unknown/input_tokens null保持，本11新增模型/摄取0次。V1-01 Limited/解释关闭、D2=2、10对话unknown及CNY32.828897/100、3753未知费用单列继承。完成11本地阶段提交后按唯一计划继续04；不授权生产启用、外部消息、付费fallback或远程部署。

当前11逐元素台账（逻辑390×844；源853×1844；native13）。保留的合成接待人长姓名自然两行重排，元素盒与可见字形分开核对；公共导航/范围行保留原权威，不升级完整聊天光学。

| 元素 | 最终原生边界 / 样式 |
| --- | --- |
| 顶部操作 / 范围 | (205,47)、81×44，右286，完整宿主胶囊已审看。范围标题(38,98)、330×30.8/22px，原范围底173.8。 |
| 接待纸页 / 悬挂布签 | 纸页(35,209.8)、330×158.38；布签光学框(44.61,194.42)、49.79×33.76/14px，不再占正文流。 |
| 接待标题 / 说明 / 结束 | 标题(53,238.8)、294×64.38，23px/32.2两行；说明(53,307.17)、160.73×48，16px/24；结束(225.73,311.17)、130.27×44，13px。 |
| 已保存报告纸页 / 标签 | (35,400.17)、330×187.39；标签(44.79,381.45)、113.42×40.44，浅色rgb(212,218,195)，已去旧深色渐变。原CSS布签几何，无图像切取。 |
| 报告标题 / 说明 / 操作 / caption | 标题(53,433.17)、294×29.89/23px；说明顶465.06，16px/24；线顶497.06，双按钮(53/205,506.06)、142×44，间距10px/字号15px；caption顶555.06，13px/19.5。 |
| 输入与控件 | 原壳(26,783)、349×49及输入(115,790)、211×35；图片热区(28,785.5)、44×44；发送(327.5,785.5)、44×44，以内容裁切保留原39px光学圆。 |
| 恢复与限制 | 等待/失效/发送及结束待核对沿同纸页/输入，真实报告详情只读。native10业务帧与13最终组件/完整宿主分列；根面板、实体控件/真机及完整公共壳光学仍未验。 |

<!-- v1-02-report-history -->
**简报记录05：V1-02内限定Implemented，整体仍Limited。** 原C01聊天/根面板纸页新增当前获权项目、上海月份及日报/周报筛选，沿原20条beforeId分页。月份归属按不可变报告周期起点的Asia/Shanghai计算，跨月周报不按投递月归档。GET /api/miniprogram/assistant/followups/:bindingId/reports接受projectId/month/kind/beforeId；原绑定context接受afterProjectId/projectId，返回每页20个获权工地、projectsNextCursor及独立重验的selectedProject，支持选中首屏以外的工地。全部沿FollowupService、原followupProjects/RLS与来源投影；非法/重复参数拒绝，正文不能选择租户/主体。项目筛选索引只保留该项目当前有效段且不返回已阅令牌；打开仍重验同一报告的完整收件人获权快照。没有新增报告中心、Agent、知识/权限或引用管线。

共用controller将历史与聊天卡片分开；读取失败保留筛选和旧有效列表，同范围重读，旧筛选响应不能覆盖新选择，撤权清除名称/内容。沿原跟进设置、鉴权详情和原记录入口；只有详情实际渲染及原journal准确已阅回执后更新阅读状态，筛选/列表不写已阅。同一session重进恢复选择，换身份/企业清缓存。事实仍facts_ready、知识not_generated；客户追问现须上文04显式引用及原发送守卫，正常语义未验。

证据：tmp/v1-02-report-history/verification.json。HTTP02索引/分页/月界有效范围保留，03补权限/已阅，05用原服务创建的21个标记合成项目250–270验证真实两页选项；04缺数据的驱动假设失败保留。Native04项目/筛选/几何有效范围及06余项5/5、最终07叠层3/3覆盖手动同范围传输503恢复、真实渲染已阅/重进与当前身份拒绝，产品/helper/官方CLI/窗口绑定drift[]。原夹具、状态码、运行时读取、选择器、轮询竞态及wrapper失败分别保留。未变逻辑复用Mini91/91、日历/月份11/11；最终包体13/13、当前定向lint0、源码lint0错误/25警告，类型原82/受影响0，均有影响/源码绑定。未重启完整build，原类型失败及compile-only边界保留。

设计继续沿批准05-report-history-v001.png及原README，853×1844→390×844。限定原生叠层实测纸页(0,145)/390×699，标题32px Black、内容宽331px、项目/类型44px操作区、行标题17px/元信息13px、普通行93.23px；字形、分隔、grip/关闭及完整宿主已选审。复用requirement-home.png/x.png；5820B/22字形标题/日期子集来自获批Noto Serif SC Black/OFL，放styles/assistant-report-history.less，原Chat Serif字节不变。无生图/设计图切片。助手源包1989938/1998848，真实编译/上传包、根面板05、实体picker/键盘/真机与全聊天光学未验。队列0、计划关闭/version122，248–270归档/对客关闭，测试账号停用，原生身份/存储/传输及自有资源恢复。providerMax4114/knowledgeMax3753及3753 unknown/input_tokens null不变，模型/摄取0次。11限定完成见上文，按唯一计划继续04；V1-01停测/费用与生产边界不变。

<!-- v1-02-enterprise-plan -->
**企业报告计划10：V1-02内限定Implemented，整体仍Limited。** enterprise_admin及明确所选企业的admin/super_admin从原C01历史进入批准10纸页，复用同一页面/组件、原生switch/时间/星期/checkbox、请求journal及管理守卫。GET/POST `/api/miniprogram/assistant/followups/plan`重验签名Mini身份、当前管理角色、密码、所选企业与RLS；请求正文不能指定租户/主体。GET仅给当前计划及获权工地选项，30条cursor分页。明确选择最多20工地，空筛选表示全部适用工地，仍保留原20个活动工地上限；紧凑表单保留原stageKeys筛选。

0106在原设置增加stage_enabled、weekly_day(1–7)、audiences、inactive_policy、dispatch_epoch，原字段及省略新字段的内部configure调用兼容。全部用Asia/Shanghai；修改周报发送星期不改变上一完整周一至周一的事实周期。角色/阶段/范围/时间仅影响后续任务，已排队范围保持原快照；停用总开关推进投递代际，重新开启后旧run、pending/held投递和自动补充不能成为新消息。必需日/周事实保存与个人接收偏好分开，发现/入队执行所选角色，成员/业主/来源权限独立保留。批准生命周期模式仅pause_inactive：paused/archived项目状态及原completion/move_in阶段键暂停新增调度/投递；自定义终态阶段需沿原项目状态处理，不猜阶段名称。历史阅读仍沿原权限。

草稿可前后台重进；关闭/换范围先确认放弃。409保留选择，显式重读核对后才可再保存；未知保持原键/正文并禁止另一操作，精确租户/版本/字段回执验证后才提示保存。撤权清除计划、选项与草稿。没有新Agent/来源/引用管线、生图或截图切片。Chat Serif原字节移到主包共享样式；同获批Noto Serif SC Black/OFL生成4464B标题子集放在共用计划样式，原README记录映射与逐元素校准。助手源包1983308/1998848；真实编译/上传包字节仍未验。

证据绑定组合脏checkout，不声称干净commit包含全部本机依赖。证据：`tmp/v1-02-enterprise-plan/verification.json`。HTTP01前7项通过（角色、真实CAS/同键/并发保存、可控日周调度、角色/阶段、生命周期及旧代际拒绝），最后保留停用账号实际401而驱动预期403及原清理失败；cleanup01与定向permission02分别完成，drift[]，cleanup02另恢复最初夹具的进度备注。Native02功能5/5，但旧未生效样式帧仍保留；最终native07为3/3，28px标题、16px行、纸页(16,88)/374×756、选择器、44px操作、长名省略及宿主，产品/直接驱动/adapter/官方CLI/exe/asar/窗口helper前后绑定drift[]。Native01选择器、03/04校准、05长名换行目视失败、06不支持的查询均不改判。Mini84/84、日历9/9；源码npm lint0错误/原27警告，定向与驱动lint0；类型原82/受影响0。未限定目录的lint误扫生成缓存，已停止并留原日志；原完整build类型失败与compile-only限制保留，不重启全构建。队列0、策略关闭、合成夹具/账号/原生身份与传输恢复；模型/摄取0次，无外部消息/生产变更。根面板10、物理picker/switch/键盘/真机及全聊天光学仍未验；facts_ready/knowledge not_generated仍仅事实，正常追问沿上文04保持Limited。批准05/09/10及11证据保留当前限定范围，当前交付为同V1-02的04。

<!-- v1-02-personal-settings -->
**个人跟进设置09：V1-02内限定Implemented，整体仍Limited。** 批准09纸页及01“管理跟进”补充沿同一C01定义/组件。`GET /api/miniprogram/assistant/followups/manage?beforeId=`每页最多30条当前仍获权的绑定最小元数据，包含停止、删除、保留期脱敏；不返回旧会话/报告正文、项目计数、未读或摘要。业主保留当前项目归属/开放检查，工人/设计师保留有效成员检查，所选企业owner/admin/super_admin沿提取后的原关系谓词，不另建权限系统；会话正文仍检查关闭、删除、参与者和脱敏状态。普通列表为空也能进入管理；自动发现不重开tombstone。

0105迁移在原绑定增加默认开启的三项提醒布尔值及`list_hidden`。`POST .../:bindingId/preferences`验证三个布尔值、expectedVersion和原幂等键。偏好仅改变本人阶段/日/周站内接收，调度与事实保存继续；投递落为`muted`，不插入消息或未读，历史仍沿原来源权限读取，详情实际展示可确认该报告已阅但不确认消息可见。重新开启只影响后续接收，不补刷旧静默记录。收起仅写`list_hidden`，不取消会话或改变上下文；真实新投递可重新显示。停止恢复同一目的地；删除关闭/撤销旧目的地，删除或脱敏后只有本人明确重开才把原绑定移到新代际，不复制旧上下文、报告、序号或未读，并保留原模式；旧任务、详情、更正和回执不能迁入新代际。

共用客户端保留前后台重进的未保存选择，切换/关闭/生命周期操作前确认放弃；409保留选择，显式重新读取核对后才可再保存。保存中/结果未知禁止竞争写入，同原持久键/正文恢复并验证准确回执后才显示成功；当前撤权清除设置名称和草稿。09复用原home/x素材与原生线条几何、switch/picker/modal，无须新插画或设计截图像素。证据在`tmp/v1-02-followup-settings/`，完整依赖绑定及原失败范围见下。这是个人接收/管理范围，不是AI报告/追问或完整V1-02验收。

当前限定证据：0105在原acceptance锁内沿canonical本地迁移成功。最终`http-06-bound-dependencies`为9/9，绑定2201路径、drift[]，覆盖六身份最小投影、CAS/同键保存、真实阶段/日/周队列与事实保存/静默投递、只影响后续接收、收起/停复、并发删除重开/旧任务拒绝、实际定向保留期脱敏、成员/业主关闭/强制RLS及清理。保留HTTP01入口token/数组清理、02当前阶段夹具、03旧任务错误码期望、04保留期基线守卫的原失败，cleanup-only及后续余项不改判原批。native03限定6/6，覆盖真实保存、成功回执丢失/重进/同键恢复、取消放弃选择、停止恢复、删除/实际脱敏/新代际。native01误点专业端返回；02保留SDK switch tap错误预期及旧sheet级联，03功能证据与最终光学校准分别保留。最终06逐元素采集沿同一副屏Stable2.02.2608080/base3.17.2/390×844，绑定产品/直接驱动/CLI/窗口；05/06使用相同32px Noto Serif SC Black标题、16px行文字、44px偏好label热区、64px管理行及44px保存操作，纸页(16,88)、374×756。新增四字WOFF2为2544字节，来自获批原字体并沿现有OFL许可，仅嵌入共用设置样式，原124字Chat Serif不变。switch变化使用官方trigger/change，物理手势/键盘/设备仍未验。03及最终帧共选审7张页面、2张宿主，过程帧保留。Mini71/71、身份/鉴权14/14、定向lint0；类型仍原82/受影响0，后续仅字排/label与采集驱动改变，影响检查复用未变服务/客户端行为，不重跑业务矩阵。助手源分包1998612/1998848，真实编译/上传包字节、根面板09原生及完整聊天光学仍未验。没有重启完整build，原类型失败及compile-only边界保留。队列0、策略关闭、合成账号停用，原生身份/存储/传输恢复、自有资源释放。providerMax4114/knowledgeMax3753及3753 unknown/input_tokens null不变，无模型/摄取、生产或外部消息。

<!-- v1-02-selected-enterprise -->
**小程序所选企业管理：V1-02内限定Implemented。** 原身份切换/刷新/bootstrap与`MiniProgramIdentityRepository.selectContext`现为admin/super_admin保留明确选择的有效企业，不建立雇佣或项目成员关系；普通员工明示其他企业会被拒绝。0104迁移替换原`construction_miniprogram_access`函数，所选企业管理继承仍经当前手机号/用户/会话版本/菜单/密码及租户检查，不另建权限解析器。批准follow-up-v1第08图的企业选择沿纸页面板、原生搜索和原platform-enterprises接口20条分页；原App hydration前先清旧报告/照片，之后只打开所选私人目的地。切企不再触发普通离开跟进的跳转；未选企业时提示选择，不误称人工接待。原户型控制器移到主包utils并保留子包包装入口，行为/路径合同不变；无新插画或截图切片。

证据为`tmp/v1-02-followup-management/verification.json`。HTTP-01的驱动bootstrap层级及无效企业状态清理失败保留；后续已补停用合成账号/控制企业，3917–3920的合成手机号保留为夹具，因首批前值未保存，不宣称精确恢复。HTTP-02为8/8、drift[]，覆盖三管理角色真实选企/刷新/读写、同键open、身份/改密、本人及租户拒绝和清理。native-01保留真实意外跳转失败；修复后native-02为5/5，但其两次搜索图同名覆盖且新Less当时未刷新，不作最终光学证据。native-03核验刷新后的样式；最终native-04同时绑定产品、直接/嵌套驱动、CLI适配器及窗口脚本，在同一副屏Stable2.02.2608080/base3.17.2/390×844限定4/4。3张348×752页面和2张1700×960宿主图已审看；搜索区实测(31,250.03)、331×45px，企业操作保留44px热区。入口样式失效更新后才刷新Less，原帧保留。这是组件验证，不代替完整报告/卡片逐字形校准、根面板、实体键盘/真机、真实编译包字节或阶段验收。最终Mini63/63、身份/鉴权14/14、定向lint0，类型仍原82/受影响0，绑定均drift[]；助手源分包1994826/1998848字节。未重启构建/模型/摄取批，providerMax4114/knowledgeMax3753及3753 unknown/input_tokens null保持。队列0、策略false/version62、合成248已归档、管理账号停用，原生身份/存储/传输恢复。个人接收偏好/恢复管理见上文；批准05筛选及09/10设置见上文，人工接待11见上文，报告追问仍未完成。

**V1-02私人主动报告：Limited，正文运行时已接通，真实模型验收待完成。**

<!-- v1-02-report-composition -->
**自然报告正文：运行时/协议已接通，V1-02整体仍Limited。** 原本地事实事务之后，`construction.report.compose`沿原`newRun`预算/账本准入；绑定report/版本、收件人/绑定、原会话代际、dispatch epoch、项目集合、周期/截止和事实hash，不读取普通聊天历史或旧模型日报。`report-body-worker.ts`复用`runRenovationAgent`、`executePostgresText`、KnowledgeRetriever/Evidence、原synthesis/引用目录及来源解析器。内部检索scope在I/O前后提供原租约/项目守卫，候选受众/发布谓词不变；终稿工具沿原共用投影，在来源敏感提交前保存供应商原包和用量。没有新增Agent、事实库、权限解析器或引用管线。

0109/0110已应用授权开发库与隔离评估库，报告表继续强制RLS。不可变事实仍为`queued/facts_ready`；同版本另存`body_run_id`、`body`、`body_generated_at`、`body_error_code`、`body_attempts`（至多3次已准入尝试）及knowledge状态`not_generated/queued/ready/failed`。正文按项目保存进展/待核对/工艺/安排，使用原synthesis格式。读取只投影获权展示行、依据类型及解析后的来源标题/定位，不下发私有Evidence/checkpoint；全部已读原件继续重验，撤回可使整段报告不可用。追问始终消费原事实，生成正文不成为新事实。正文完成清除该版本旧的报告已阅回执，并把新展示正文绑定进readToken；不追加普通回答或第二条投递消息。

原报告列表/详情HTTP增加`body`、`bodyGeneratedAt`、`generationState`、`generationError`、`generationLabel`、`generationRetryable`；原带版本/幂等的`.../reports/:reportId/retry`亦只在明确派发前失败后新建正文run，沿同一事实版本。文本派发或query embedding用量未知保留reconciling、拒绝重试，并阻止未知查询后继续发文本模型。拒绝/额度不足仍保留原事实和真实失败状态。活动聊天唯一索引排除两种定时报告purpose，普通交互仍唯一；人工接待沿原暂停插入/代际合同保留后台报告任务。

批准03详情及共用04/06/07/08保留原正文分区、来源标题及失败/重试组件。普通专题状态和目的地保持独立。

<!-- v1-02-report-source -->
**报告工艺依据与原文件导航：限定Implemented，V1-02整体Limited。** 批准03动作位于工艺标题右侧，复用原记录13px/44px动作及现有来源纸页；其他受众/周期沿共用详情提供同一动作。多个实际知识引用使用原生单选。GET `/api/miniprogram/assistant/followups/:bindingId/reports/:reportId/projects/:projectId/sources/:sourceId[/original]?revision=:revision`先验签名收件人/企业、私人目的地代际、报告版本、项目事实和实际引用目录，再走原synthesis context、Evidence及citation投影。裸chunkId/未引用chunk不能获权。当前发布、受众、索引profile、hash及有效期守卫保留；项目撤权清除打开的来源，关闭/隐藏/身份变化阻断迟到响应。不新增schema、Agent、权限解析器或引用管线，不改Admin界面。

来源纸页显示保存的引文、版本及原文件/页段定位；原件端点再验精确版本的asset/name/format/hash及下载字节。含排除块的发布只开放获准摘录，不能下载未脱敏整件。Mini沿认证下载、`wx.openDocument(showMenu:false)`并在使用后unlink临时文件；同范围轮询不会静默取消正在下载的原件，实际撤权仍会取消。控制逻辑放assistant分包，不增主包helper，不改样式/字体/素材或导航。两份已编辑聊天入口统一LF、精简失效注释，.gitattributes固定五个已改Mini运行文件的LF以守2MB硬限；1998848安全目标/300KB素材阈值保持，实际上传字节未验。

证据`tmp/v1-02-report-sources/verification.json`。单元45/45，最终来源/下载及包体19/19、定向lint通过；tsc仍原82项/本次0。初版client127/127和后续126/127的原21B包体失败分开保留；最终19覆盖下载竞态及13项包体。service01缺入口凭据、service02探测已发布文件不可变约束、remainder03通用notice选择器导致打开计数不符均仍failed，清理true/drift[]。service02实际来源/原件/hash及收件人/企业/目录拒绝仅按其已执行范围复用；退役/受众/hash回滚守卫已到达断言，末段不可变文件探测仍失败。排除块整件披露现为有单元证据的纯谓词，重构后另验真实获权文件HTTP。remainder04四项夹具/文件/项目门检查及Stable5/5通过（两前置、来源503/手动重试、认证下载/打开调用、私人重进/实时撤权），清理true/drift[]。最终5张精确route页面已审，逻辑390×844/编码348×752；工艺动作(264.14,509.75)/94.86×44px、13px。同最小化HWND947063424只读保存副屏位置/焦点核验不变。文件查看器单独用内存观察器替代，真实查看器/真机/完整宿主/根及生成正文语义未验。无CLI参数文件、模型/Embedding/摄取/生图调用；原额度、未知费用、停测和失败次数保留。这是清晰标记的持久协议正文结合真实已发布404/410第29页Evidence的来源导航，不是配置模型验收。
受影响三API及proxy的新Webpack compile-only检查通过（compile-01-routes），源码/驱动/配置drift[]且未改原配置；不升级完整build/standalone。最终319–322归档/对客关、372–375撤回、137–140停止、5410停用，策略false/version252/dispatch_epoch66、全队列0；404/405仍发布、其余28草稿、42条预占2004000及4114/3753未知账目不变。
<!-- /v1-02-report-source -->

<!-- v1-02-stage-reminder -->
**批准02阶段提醒与工艺依据直达：限定Implemented，V1-02整体仍Limited。** 源为原手账README及02-follow-up-chat-v002.png/共用03/04，853×1844→390×844。已就绪阶段卡使用报告冻结的stageKey及实际保存的standards，不再用进展/待核对摘要；保留纸张/布签、21px标题/16px正文，长原文自然增高，并直接提供原13px/44px工艺来源动作。没有工艺正文时沿真实生成标签/重试，不造示例施工、来源或本阶段建议；接待沿批准11。无新素材/字体/主包helper/API/schema/Agent/权限变化。

assistant控制器把直开绑定到当前binding、精确report/revision/project和当前实际引用目录，复用原来源API、原生单选、来源纸页与认证原件下载，不挂完整详情、不写整份报告已读。列表轮询重验直接来源；同范围不取消下载，版本/目录变化、关闭/隐藏/身份/绑定变化及项目撤权阻断晚到响应。来源错误保留到明确重试。三个相同详情正文提取为report-sections.wxml，业主嵌套include显式导入；原chat缩进精简及LF属性守原2MB硬限，无截图切片。

证据tmp/v1-02-stage-reminder/verification.json。最终Node client03为134/134（含13包体），语法/模板展开等价及外部api.js哈希通过、drift[]。定向ESLint仅chat-definition.js原有两个未使用catch占位符，本次新增0；后台依赖未变，不重跑后台构建/类型。service02五项已执行检查验证真实阶段变更→调度→Worker→一份私人投递、重复tick不重复，404/410目录/原件hash、错误收件人/版本/定位与项目撤权；整批仍failed。native02两前置及阶段直开503/重试、认证下载/不误写完整已读按原范围有效；native03滚动修复仍失败。native04注册节点判别证实复合选择器返回view，简单class才返回真实button；私人重进/实时撤权目标通过，但只验容器的日报断言不足以证明正文。截图检查发现并修复嵌套模板导入回归；native05实际业主待确认/协调/生成反馈/安排空态文字通过，通用详情断言因JSON转义真实换行及把非空协议段误期望为空而整批failed。保存的原生通用工艺正文和三个待核实段已离线复核，无新调用；不拼成一批全通过旅程。

最终源码包main2096882/assistant2096739，硬2097152，余270/413B；1998848安全目标、PNG≤300KB不变。Stable2.02.2608080/base3.17.2，同最小化副屏HWND947063424，390×844/编码348×752，最终页面已审。五工地323–327归档/对客关、记录376–380撤回、绑定141–145停止、5410停用；计划false/version266/epoch71、队列0，各服务批cleanup true/drift[]。provider4114/knowledge3753 unknown账目、42条2004000预占及28草稿不变。实际模型/Embedding/摄取/生图、CLI参数文件、根重试及焦点/窗口修改均0。协议正文结合真实Evidence仅证明来源导航；配置模型语义两首稿、真实查看器/真机/完整宿主/根及完整构建上传字节未验。批准02输入缺口已在下方当前输入合同收口；正常回答仍遵守原额度边界。
<!-- /v1-02-stage-reminder -->

<!-- v1-02-followup-compose -->
**批准02主动提问与私人草稿重进：限定Implemented，正常AI回答仍Limited。** 源仍为02-v002输入框及04精确引用状态。获权私人会话未选择报告前即可使用原textarea；显示/输入/打开来源均不选报告。用户首次明确发送时，沿原ReportQuestionController/journal绑定列表中最新获权、就绪且未muted的报告，多项目沿批准原生选择；精确引用可见并持久保存，后续新报告不覆盖已有引用。取消、身份/路由/引用版本变化、等待中改草稿、选择失败或结果未知均不自动发送；unknown沿原键/正文恢复，恢复后仍由用户再明确发送。没有就绪报告沿已批准空态文案反馈；原服务发送/租户/来源/额度/回执守卫不变。

assistant独有FollowupChat包装器按当前session及binding:conversation保存至多20条、7天未发草稿，仅实际获权会话读取成功后恢复；发送成功/fatal读取清当前草稿。不存报告正文、不写Agent记忆或pending操作journal；本地存储失败只保留当前内存草稿。其他身份不恢复，撤权页清可见私人状态，后续恢复前仍需服务授权。使用wx storage；原生自动化为保留真实账号而以内存替代该存储，真实磁盘/整进程退出、存储满/真机/键盘未验。无API/schema/权限/Agent/新画作/字体或普通会话流程变化。

证据tmp/v1-02-followup-compose/verification.json：最终client02为142/142含13包体，定向lint0/0；CSS代码/字体字节及原chat结构经注释/标签间格式精简后等价。chat-definition缩进改tab，除预期包装器import外解析AST一致。service-native01正常输入→真实200引用写入→真实429额度失败及原页保留文字通过，整批因完整路由重进丢草稿而failed；包装器修复其生命周期机制，修复1次。service-native02-draft三个真实准备检查及Stable4/4通过：两前置、实际自然输入/先选引用再发消息/原额度反馈/不误确认整报告、精确引用和草稿重进/实时项目撤权。原失败保留，不是模型答复语义通过；绑定实际actor/report/协议夹具，不新增语义试验。两次准入拒绝均实际模型/Embedding/摄取/生图0。

最终main2096882/assistant2096851，硬2097152，余270/301B；1998848安全目标/PNG≤300KB不变，真实上传字节未验。同最小化副屏Stable2.02.2608080/base3.17.2/HWND947063424，390×844/编码348×752，最终页已审；身份/storage/transport恢复，无CLI参数文件/根/焦点/窗口操作。328/329工地归档/对客关、381/382记录撤回、146/147绑定停止、5410停用，计划false/version272/epoch73、队列0，cleanup true/drift[]。原42条reconciling/2004000预占对daily1200000、provider4114/knowledge3753未知账目及旧失败/停测保持；下一正常回答/阶段工艺/自然报告验收仍依原额度/unknown返回条件，不第三次429试跑、不提前V1-03。根验收另需正式组件动作机制，修复次数仍2。
<!-- /v1-02-followup-compose -->

<!-- v1-02-live-reports -->
**真实配置模型报告正文仍Limited。** 用户于2026-11-02明确模型使用无限制；现有daily-limit开关已关闭，原预占、unknown及每次运行/上下文界限继续保留。不能再仅以历史42条/2004000预占视为当前全局准入阻塞。模型仍为qwen3.7-flash；精确能力表现登记已文档化JSON Object/Schema，复用原final-only strict response_format，业务工具回合及搜索/缓存/Partial/Batch独立闸门不变。报告Schema复用nativeFinalDefinition、每个项目原citation catalog及既有1200字/4引文上限；不解码字符串数组、不换提示词，不新增Agent/检索器/事实库、不改来源或放宽本地数值/承诺/租户/撤回守卫，无路由/角色或Mini结构/样式/素材变化。

证据tmp/v1-02-live-reports/verification.json。日限单元2/2、协议/来源守卫33/33及定向lint过；tsc保留82继承/本次0。事前固定五私人目的地/两工地/daily+weekly/每项两次首稿，最多20正文，首失败即停。configured01前置误拒其他老板既有会话，派发0；改为原binding59/消息完整hash不变证明。configured02报告272/run1919仅一次query embedding unknown/数量null，文本调用0；定位原18089转发缺失后沿已批准监管脚本恢复，鉴权health200、原profile/revision/1024维一致。DTO额外字段清理失败保留，cleanup02沿版本287不可变服务回执恢复原配置。configured03 run1921/attempt4115返回projects字符串而被拒；机制1后configured04 run1923/4116真实JSON/Schema均有效，但未引用声明被unsupported_model_commitment拒绝；机制2后configured05 run1925/4117结构有效，仍未通过同一正文语义期望。按两轮修复规则停止第三次正文补丁/模型批，每个停止批其余19项均未执行；不把原失败改判成功。

所有自有夹具已归档/撤回/停止/撤权，原账册及binding59不变，策略false/version296/epoch82、q0，最终实批drift[]；外部3006/Worker267212保留。按既有开发授权恢复的专用Embedding监管84052/SSH518972保持可用。三次已知文本调用输入7666/输出1873 tokens，另111已观测query tokens；1919查询用量及本次实际金额仍未知，不能计0。知识attempt3753、发布404/405版本410/411与其余28草稿未变，无摄取/生图。未新增原生、正常追问、完整正文语义、真机/根入口/真实viewer/上传验收，不提前V1-03或生产。下一独立授权项仍为原业主/员工选定报告的事实追问：消费冻结原事实，不依赖失败的模型正文。

<!-- v1-02-stage-note -->
**同阶段补备注保留原节点提醒与补问：限定Implemented，V1-02整体仍Limited。** report-worker.ts抽出的stage-events.ts共用最新阶段事件机制：先锁同企业原项目，再以新语句拒绝任何更新事件，离开后绕回同key也不能复活旧事件。普通C01提醒及历史回读额外以已有construction_audits的真实progress输入证明每次递增仅来自备注变化（按expectedVersion排序、JS同一trim规则忽略同备注重提），不放宽撤权/重授、暂停/恢复等非备注进度修订；缺少原审计证明时保守不可用。补问仍绑定原triggerEventId/settingsVersion/客户/房间/会话授权，稳定需求去重和原construction:user/need消费键不变。私人construction_followup不再消费普通C01提醒；其固定报告目的地仍沿原管线。只改备注不重写原事件、时间、文本或冻结事实；无路由/schema/Agent/API或Mini结构/样式/字体/素材变化。 新的跨节点人工stageReview另保存服务端projectVersion/progressNote锚点；need-issues.ts在现有阶段/配置/客户授权和原话hash/不可变核对事件校验后，才共用notesPreserveProgress证明备注增量。事项ID/修订/负责人不因备注变化，旧节点问题、记忆和派生答复仍不可用；缺这两个锚点的历史核对保持原严格revision校验，不补造历史快照。

C01完成证据见tmp/v1-02-c01-stage-note/verification.json及可重复admin/scripts/xiaok-v1-02-c01-stage-note-check.ts。最终service-native06绑定源码/驱动，7/7真实服务检查及4/4 Stable原生检查通过；同项目/原最小化副屏HWND947063424，390×844/编码348×752，四张原图已逐张核对原C01气泡/共用失败恢复组件（canonical tab-context-v1/README.md），未改变设计或还原台账。实际提醒与补问在补备注后可见，真实再写备注/重进不重投，真实HTTP消息503反馈及再进恢复同一消息；原生transport/session/storage在finally恢复，合成工地340/线索3150/会话1086/1087/绑定158及本轮合成用户3958均清理/撤权，队列/自有控制器/锁/构建归零。完整源码lint排除.next*生成目录后0错误/28既有警告，单元10/10，tsc82继承/本次0、drift[]。保留service01原event5185/revision1对project2漏投递，以及service02同合成用户3914既有轮询先投旧合成会话884/message11963的失败；独立标记客户后的service03及最终06通过，不修改旧会话或接管外来Worker。native04编译刷新观察器丢失/注入超时、native05传leadId+conversationId被既有entryInput拒绝两批failed不归算通过；分别以未变runtime复用及合同规定单conversationId修复。首次离线断言误期望kind/id、驱动13项类型标注、生成缓存lint超时/主动停止及只读诊断ESM包装失败均保留，不池化成首稿成功。模型/Embedding/摄取/生图0，KnowledgeRetriever/Evidence、404/405版本410/411、其余28草稿、42条2004000预占/3753 unknown及外部3006/Worker267212均未改。新包只覆盖上述机制；旧Mini142/包体13/私人输入与阶段卡证据按未变范围复用。真实模型回答、根入口、真机/完整宿主/真实viewer/上传限制保持未验。

人工核对备注续接完成证据见tmp/v1-02-reviewed-stage-note/verification.json及可重复xiaok-v1-02-reviewed-stage-note-check.cjs。service01-before真实S01核对后preparation/revision4→仅备注revision5，同事项从awaiting_review误变invalidated，原失败保留；机制修复1后service02原hash八项、service07历史保存回执分支及原话hash变化/历史锚点缺失/撤权重授共十项真实服务通过（明确合成既存run1，非模型能力验收）。共用审计证明重构后的c01-native08为7实服务+4 Stable原生通过，原消息/真实备注/重进/503恢复四张图已逐张核对，源码/驱动绑定drift[]、transport/session/storage恢复；未新增UI，旧S01交互证据只按不变范围复用。完整源码lint/单元10、后加脚本/测试的定向lint通过；tsc82继承/本次0。隔离旧兼容03的1过/2失败、诊断04放错同名用例和05的savedStatus failed/unsupported_model_commitment/memory=null均保留。根因为注入模型的旧record_need模拟输出遗漏当前need-source-input-v2 schema必需的additionalNeeds；只在原test output工厂默认[]，原用户话语/业务断言/生产Agent守卫全保留，新固定源码compat10三项全部通过（含原hash/历史回执/来源与授权拒绝）。service06错误contracts.ts导入失败1另存，改真实contracts/index.ts后07通过。测试工厂变化在native08结束后，未被原生runtime/驱动导入，记录影响而不重播全套。全部自有资源/队列归零，账务4114/3753、42条2004000预占/unknown、报告策略false/version287/epoch78不变；模型/Embedding/摄取/生图0。真实配置模型的正常问答/待核对语义、根入口/真机/完整宿主/真实viewer等仍未验，不提前关闭V1-02。

同key恢复补证见tmp/v1-02-same-key-recovery/verification.json及可重复xiaok-v1-02-isolated-stage-recovery-check.ts。只用既有55432/xiaok_embedding_eval内微云1454和标记合成资料、原验收锁/空队列，真实调度/事实Worker/私人投递三项通过：最终isolated02旧report16/event33475被拒；离开后返回同key的新event33477，显式tick预期1实1、report17 facts_ready且送达；重复tick0、后补备注保留冻结事实且仅一条投递。正文任务在provider派发前沿原cancelRuns取消；未改模型配置，隔离库provider2920/knowledge5418前后不变、原助手enabled=false恢复、本包项目1922/1923归档、绑定7/8停止/合成身份撤权、队列与自有资源0。该包只补隔离工程验收脚本/证据，产品运行时行为没有新增变化；不升级原生、模型语义或原主库same-key05。原主库270/271/event5178预期1实0仍failed，外来Worker归因仍是假设，未碰主库3006/Worker/42条预占与unknown。初次驱动DTO union读取有1项类型错误，仅加擦除的Row断言后整份transpile JS逐字相同，复用已绑定服务证据；定向lint过，tsc82继承/本次0，drift[]；后将锁/连接释放移至最外层finally，证据写盘/绑定读取抛错也释放，isolated02在该最终驱动上同范围3/3通过。

证据tmp/v1-02-stage-note/verification.json。service01真实复现event5108版本3、项目版本4仍utilities，预期queue1实际0，原failed/cleanup true/drift[]保留。机制修复1次后service02及native04四个服务检查通过：调度前备注仍投递1/重复0，Worker前备注仍保存冻结事实并私人投递，真实阶段更正拒绝旧报告且新事件恢复。unit16/16、定向lint通过，tsc原82/本worker0、drift[]。native04自定义驱动前后hash绑定，Stable3/3（两前置+批准02真实水电卡/私人重进）通过；同最小化副屏Stable2.02.2608080/base3.17.2/HWND947063424、390×844/编码348×752，两页已审。native03原观察保留，自定义驱动未单独绑定而不算验收通过。Mini4192dbf2、client142/包体13及未变权限/来源证据按范围复用，不重放。

附加同key离开再返回的case05仍failed：旧报告270已被拒绝，但恢复tick预期1实际0，回读发现新报告271/event5178已facts_ready。现场观察到本项目既有assistant-worker PID267212（2026-10-31T16:00:22Z启动），未停止；可能由其先处理仅为归因假设，不把该恢复结果计作绑定源码验收。两次只读诊断包装失败保留，原有效读取/失败不覆盖，不重开查询/测试循环。admin/scripts/xiaok-v1-02-stage-note-check.cjs保存三个已验核心用例及这一严格附加回归，末项须控制Worker调度；额外用例不抹掉备注修复证据，也不代表V1-02整旅程通过。

最终330–334工地归档/对客关、383–387记录撤回，绑定精确ID见final-state.json，5410停用，策略false/version287/epoch78、队列0，各批cleanup true/drift[]。原42条2004000预占对daily1200000、provider4114/knowledge3753 unknown、404/405发布及28草稿不变，实际模型/Embedding/摄取/生图0。无生产/远程/窗口/根或付费操作；这是实际事件/事实/卡片行为，不是生成工艺/自然答复语义通过。下一独立代码点为reminders.ts同类progress revision假设，须沿其原C01受众/事件消费幂等/私人隔离合同先复现再改；无新视觉源或还原状态升级。
<!-- /v1-02-stage-note -->

真实配置模型正文、固定两次首稿、带真实企业知识的报告语义、正常追问、完整生成正文原生验收、根入口及完整构建/上传字节仍未验；不推进V1-03或生产。

证据`tmp/v1-02-natural-reports/verification.json`。unit49/client126（含包体）/定向lint通过；当前类型82项诊断均在本次归属之外，归属文件0。service04原日周批failed保留：五份日报正文保存，周报被旧活动聊天索引拒绝；0110修复该机制，service05仅生成五份周报新版本并复用未变日报证据，验证精确重进/已阅/跨收件人拒绝、派发前失败/同键重试。其撤回遗漏reason失败及service06误断言facts_only的失败均保留；来源驱动修复2停止。service07只回读已撤回版本，验证真实不可用DTO（无新撤回），再验证文本unknown；service08独立验证query用量未知阻断、文本0调用。以上均为替身模型协议检查：保留各批合计12次注入回调，实际文本/Embedding/摄取/生图均0，不当自然语义或真实费用。开发库原42条reconciling/2004000 tokens、日限1200000、provider4114、knowledge3753 unknown/input_tokens null及CNY32.828897/100保持。

native01两前置和真实额度失败详情通过；同键重试原请求保留，但合并末步因误用普通conversationId入口404失败。native02-reentry仅补原lead/私人绑定入口重进（两前置+一目标），不拼成一批最终旅程。两批cleanup true/drift[]，三张最终状态页已审；Stable2.02.2608080/base3.17.2/390×844、编码348×752、同保存副屏/最小化HWND、官方CLI/内存身份/参数文件0。完整宿主/根入口/生成正文光学未通过。开发317/318归档/对客关、370/371撤回、135/136停止、5410停用，策略false/version244/epoch62、q0；原控制与账目不变。原完整build/standalone失败限制仍保留，本次原生HTTP实际服务了修改后的详情/retry，不宣称新的完整生产构建。



原catch-all现分派`/api/miniprogram/assistant/followups`：GET本人私人绑定列表/范围、`/:bindingId/reports?beforeId=`、`/:bindingId/reports/:reportId?revision=`，以及报告获权的`.../projects/:projectId/records/:recordId[/media/:mediaId]?revision=`。POST支持本人明确open、带版本archive/stop/delete/resume、携conversationId/throughSequence的消息可见确认、携revision/readToken的报告已阅及明确本地失败重试。全部沿FollowupService和原租户仓库、代际/脱敏、项目/原件及成员守卫；Mini身份与所选企业来自原鉴权或已验证的客户入口token，不信任body传入principal/企业/受众/delivery能力。工人只放行followups分支，不开放普通客户conversations/runs/citations，保留密码修改门。范围只返回当前获权项目/阶段与私人目的地元数据；原件须属于同一仍有效报告快照的精确记录/媒体定位。偏好字段及原关系谓词提取见上文，没有另建权限、Evidence或引用管线。

运行时接入位于共用C01页面/组件（`packages/assistant/chat/chat`及`pages/index/index`的小K面板）。代码加入私人跟进分组、按收件人裁剪的纸页卡片/详情、原记录/照片读取、详情实际渲染后的已阅、可见卡片序号确认，以及沿新分支的收起/停止/重开。普通咨询草稿、焦点和目的地独立，前台列表轮询不切会话。原工地项目简报入口沿批准卡片/专业角色变体进入`chat?followup=1`。用户已于2026-11-01明确批准follow-up-v1全部01–11、管理入口补充和共用状态规则并授权实施，无须再次确认。当前首轮纯事实接入已有真实HTTP/原生证据，尚非完整还原：客户04显式引用与人工接待11见上文，报告追问语义仍待完成；批准05筛选及09/10设置见上文。来源服务/代际边界不变，没有打包整屏设计像素或新增插画。

当前证据在`tmp/v1-02-followup-client/`。static-01原失败及static-02-package-sharing222/222保留。HTTP-01–06各夹具/合同失败保留；HTTP-07前7块通过后因驱动遗漏原普通咨询body.entryToken失败；HTTP-08沿同产品hash复用这7块、原报告/原件，仅准备+剩余4块5/5通过，不重生成或改判首稿。真实微云1454写入/重读覆盖四角色日周事实、human结果held后不重生成投递、原件照片、JWT/角色/版本/改密门、消息可见与报告已阅分离、同键恢复、收起停复/普通咨询隔离、成员移除再加入及来源撤回。该批全局Mini403保留为历史；当前所选企业聚焦修复见上文。native-01/02/03注册项/窗口/旧9420失败保留；native-04-cli用仓库既有官方注册wechatideNativeClient适配器，在唯一已核实副屏Stable2.02.2608080、base3.17.2、390×844下限定7/7通过：历史草稿、卡片详情/实际渲染已阅、认证原件照片、停止丢回执/同键恢复、工人设计师老板、重进/human只读与撤回清空。各完成HTTP/native批binding均drift[]。11张348×752页面PNG及一张1700×960宿主图已审看；另两宿主图已保存但图片查看工具阻塞后未审看。几何已保存，完整逐元素/字形校准、根面板跟进原生、实体键盘/设备和全部新增状态还原仍未验。新驱动定向lint0，类型仍原82/受影响0。compile-01在独立NEXT_DIST_DIR=.next-v1-02-followup-client退出0，绑定源码/配置drift[]，原tsconfig/next-env hash精确恢复、acceptance锁释放；仅compile-only，原完整构建类型失败保留。助手分包源文件仍1996029/1998848字节，真实上传/编译包字节未验。closed-fixtures.json记录队列0、策略false/version62、248/249归档/对客关闭、5410–5419停用、自有跟进停止、880恢复human及23个自有CLI临时参数文件已清。providerMax4114/knowledgeMax3753及3753 unknown/input_tokens null不变；无模型/摄取调用，不声明语义/完整阶段/生产完成。

原0103调度/队列/租约、上海日周截止、有界日终补记、来源/租户撤权及脱敏后明确重开合同继续有效。事实仍`facts_ready`、知识`not_generated`；业主公开记录节选为`published_records_only`，不导入原咨询回传/方案grant。V1-01仍Limited/关闭并保留原unknown/费用。见[当前合同](./xiaok-assistant-phase-2.zh-CN.md#当前v1-02确定性私人报告基础limited)。

<!-- xiaok-v1-local-knowledge -->
**V1-01企业知识对话：Limited。** 本地旅程默认使用微云/1454及用户指定的`装修施工标准手册制度规范/精艺.pdf`（30页扫描件；SHA-256 `efcdc6f1e01ec848d0908e99ddd08929a7f0f07b3942f5b539864361f4aa049b`）。原KnowledgeService文件/解析/复核/索引/发布链保留30份逐页OCR副本，文档376–405；对照原图校对的第29/30页工艺正文为customer_public文档404/405、版本410/411，索引55段，其余28页为OCR/表格待复核的staff_internal草稿。原图/完整PDF、印刷冲突及既有知识保留，示例报价不代表当前条款或现场达标。导入/鉴权原件字节回读见`tmp/v1-01-weiyun-jingyi/import.json`。这是本地预处理，不是在线OCR或放大上传限制。

S04现将普通工艺提问/改口沿同一Agent/KnowledgeRetriever/Evidence进入只读`site.question`任务，保留原记录/动作核对流程。既有`GET/POST /api/miniprogram/construction/projects/:projectId/chat[/messages]`持久保存问题/回执/重进；新增`GET .../chat/citations/:citationId`以no-store返回获权原文或失效状态。有效成员及`assistant.project.shared`仅可读当前已发布的customer_public/staff_internal来源，不可读管理草稿或业主私聊。owner/admin/super_admin仍在所选企业继承管理权限，不要求变成员工。派发/提交/回读重验服务端实际阶段/修订、知识epoch、来源生命周期及权限。无新表/迁移。新建非原生结构化收尾的原文问题复用已校验片段选择；旧快照和模型配置保留。

入口仍为C01和`packages/construction/chat/chat`。显式待验开关启用的新建知识问答按当前问项自然解释，沿原引用与持久hash绑定语义校验；逐字请求及历史任务保留摘录协议。校验共用原用量/派发/来源授权。本包收束结果见下。无客户端markup/样式/素材/导航变更。沿原S04 PPT22/38和C01共享来源sheet规则，在原回答/文字按钮/滚动sheet中提供出处、加载、重试、失效；轮询重验已打开出处，失败/隐藏/撤权清除原文，迟到结果不可恢复。无Less/素材/导航或新视觉方向；来源变体已作390×844原生状态检查，整体还原状态不升级。 四角色/跨企业/撤回及真实检索失败恢复服务检查通过。四端配置模型/原生业务验收仍待完成；run1596原文转述失败、后续派发前429及原原生窗口发现失败保留于`tmp/v1-01-weiyun-jingyi/`和双语二期契约，V1-01整体仍为Limited。

当前收束（2026-11-01）：逐问自然解释须经过原引用/数值/现场事实/回执守卫及持久同模型语义证明，待验开关仍关闭。官方qwen3.7-flash仅final实参的完整JSON多余右括号规范化私存原始帧，截断仍拒绝。点名《精艺》保留获权基层/管根段落且来源上限不变，不重新摄取或改权限。离线135/135、实服务8/8、Stable预检4/4通过，类型仍原82/受影响新增0。唯一最后两旅程各两试固定批在夹具索引job2125/chunk3753 unknown即停止，0新对话run/计划12个未执行、drift[]，资料撤回、策略/配额恢复。1603–1608原失败、10个对话unknown及保守账册CNY32.828897保留；3753用量/费用单列未知。V1-01仍Limited；按唯一计划推进独立V1-02调度/保存/获权私人投递，不再开诊断矩阵，不升级UI还原。证据tmp/v1-01-weiyun-jingyi/下closure-business-01与explanation-implementation/closure-offline.log。

Stable原生来源状态专项已完成：用户确认副屏，官方SDK新编译3.17.2/390×844，最终native04专项9项通过并显式复用native02/03子范围，选审14张核route的348×752帧、drift[]。仅来源弹层继续轮询的修复，使移除成员时清历史/原文、来源撤回时清已开原文，编辑/发布仍冻结；真实HTTP503/加载/重试及一次确定性原生查询写入/重进通过。负责人缺少联系信息仅补标记合成数据，不改权限。自有资源/原身份均恢复，Agent任务/模型调用/费用新增0。Mini28/28、后端52/52证据复用，类型原82/新增0。V1-01仍Limited：保存1602仍漏问项，剩余正常语义试验未通过；以native-final.json及二期当前契约为准，原生UI成功不等于业务验收。

<!-- xiaok-retained-manual-fixtures-20261030 -->
**小K可保留人工测试数据（2026-10-30）：开发准备Implemented，业务验收另行记录。** 按用户要求，在当前微云企业1454／客户645名下准备两套本人房屋及真实正式v4主户型、三个带“合成手测”标识的云工地、已核对发布的现场记录和一条未发布记录、一处已公开样板、两位设计师及四件已发布作品（gallery／notebook）、两份已索引就绪并发布的知识及一份草稿、六个可密码登录的测试员工，以及一笔已报价摄像服务测试订单。咨询804内公开授权12／版本39和咨询810内正式方案4003 V1仍待客户决定、未预览；804／805两屋咨询可从客户历史重进。未伪造Agent运行／答复或真实客户批准；公开样板的批准仅属于独立合成业主。

`admin/scripts/xiaok-manual-fixture.ts`仅允许已批准开发主库及上述确定企业／客户，保存原请求体、幂等键和manifest供重进，完成后不重置人工决定。密码仅在本机ACL受限且Git忽略的文件内；员工号码为未验证开发占位号。真实服务／权限／照片／索引／登录准备检查8/8；现有Stable新编译390×844，原客户会话浏览8/8，七张核route截图已审看，源码／配置drift[]、窗口和会话已恢复。重复命令后数据数量及两项待决定状态不变。本次未修改产品UI、页面／API、模型数据契约、权限策略或模型配置，未生产发布；数据就绪不等于配置模型、全流程人工、真机／BLE／真实微信或摄像直播验收。实际ID、员工登录、上传素材与重跑命令见[当前手测数据清单](./xiaok-manual-test-data.zh-CN.md)；范围证据及原准备／驱动失败保留于`tmp/xiaok-manual-fixture-20261030/`。

<!-- portfolio-development-recovery-20261030 -->
**开发环境设计师推荐恢复（2026-10-30）：本次报错范围Implemented。** 原企业1454／客户咨询802的推荐请求因开发主库缺少`app.portfolio_portraits`返回`503 assistant_unavailable`。先完成受ACL保护的59,164,410字节custom备份并核验`PGDMP`签名及archive目录，再仅向已批准的本机5432／远端15432开发主库补齐原有、源码未改的`0095_portfolio_enrichment`（SHA256 `a1183439b97cee7f697f49359ba32b15f053e437449185b9d1ead24ed2c42928`）。主库该迁移精确hash、六个作品集迁移、九张强制RLS表及头像同意列均已核验。原认证推荐请求在上述单独授权的数据准备前已恢复200、当时可推荐作品0项；Stable新编译390×844，通过真实历史入口重进原咨询802，原错误消失（原生3/3，一张核route／咨询ID的348×752截图审看，源码／配置drift[]）。未修改客户资料、作品、模型答复、UI、API或权限策略；模型调用0，未生产发布。只读请求观察器及原最小化副屏窗口已恢复。

Mini40/40与隔离作品集服务回归56/56分别保留为工程证据。评测库已有头像表，但迁移账本缺少0095精确hash，因此双库迁移检查仍在评测目标失败；它与本次开发接口恢复独立，未重写该账本，原失败保留。备份／诊断／迁移／账本／原生证据：`tmp/xiaok-portfolio-error-20261030/`；完整备份恢复演练、真机／真实微信登录、配置模型语义及生产仍未验。

<!-- xiaok-notebook-ui-current:start -->
**聊天内查看附近公开工地：Implemented（2026-10-30）。** `packages/assistant/chat/chat`与首页`pages/index/index`小K面板的附近／更多工地动作，在当前聊天卡片加载本企业公开工地；工地卡片与公开引用点击后，在当前聊天既有底部面板查看精确公开版本、照片和服务节选。“问小K”把该版本接到原咨询，保留咨询ID和未发送草稿，沿原公开上下文事件实写，重进仍可接续。浏览与详情不再跳到`packages/construction/public-sites/public-sites`或`packages/construction/public-site/public-site`；这两个路由继续作为独立匿名／分享入口。

片区沿本人会话`GET .../public-sites/recommendations`解析，显式浏览再调`GET /api/public/construction/:enterpriseId/sites`并按已有地区筛选。定位拒绝／不可用时展示获权服务片区并提示，不虚构距离或房屋所在地。精确版本详情／媒体沿原公开API；`POST .../public-sites/:siteId/context`保留原bearer本人、租户、实时来源和幂等守卫。加载／无结果／失败／重试沿批准手账提示；重复点击与过期身份／会话响应不生效，撤回清详情／卡片／缓存路径。无API／schema／权限、Less、字体或素材变更。设计映射为手账09／10及既有来源底部面板，按本次用户“同聊天完成”指令修正承载位置。Mini65/65；Stable native03为10/10，另有真实服务2组，505文件绑定drift[]，九张核路由390×844逻辑／348×752 PNG均审看；独立native04-sheet为6/6，另四张图核对详情可滚动、问小K动作在屏可见并实际点击成功。两批不合并计数，产品／配置hash相同。native01／02原位置检查／截屏失败保留；隔离夹具、内存身份／传输及原最小化副屏窗口均已清理恢复。证据`tmp/xiaok-public-chat-20261030/`；模型调用0，不代表真机／真实登录或生产验收。

## 当前手账聊天与显式户型范围（2026-10-30）

**获批UI范围内为Implemented；Agent整体仍Limited。** 客户根入口 `pages/index/index` 默认小K，另保留服务／我的两个逻辑Tab；原五个注册Tab及专业角色导航沿既有权限。异步 `chat-panel` 与旧 `packages/assistant/chat/chat` 共用聊天定义和控制器，切Tab保留会话、草稿和户型选择。`pages/mine/mine`仅变更客户导航，其账号主体及专业工作台仍沿既有设计源。

按用户2026-10-30指令，欢迎页旧房改造／装修风格／预算安排快捷选项现在点击即沿既有 `send()` 和 `POST /api/miniprogram/assistant/conversations/:id/messages` 发送问题；首页面板与旧聊天页共用同一处理。锁覆盖整个异步发送准备过程；加载、只读／未开放、执行中／结果未知及消息／操作／档案／语音待处理状态不覆盖草稿或另发消息。登录、档案校验、发送失败反馈与未知回执同键核对复用原控件；发送成功清空输入框并显示持久化消息，失败保留原恢复状态。手账设计源的结构、样式、素材、路由、API及权限保持不变。证据 `tmp/xiaok-quick-prompts-20261030/final-checks.json`：Mini 57/57；Stable native02确认首页真实点击、单条持久化写入、任务失败反馈与重进，定向native03为5/5，覆盖连接准备、旧聊天页快捷发送／同键恢复、旧房发送与其他客户拒绝。六张路由确认的390×844逻辑／348×752 PNG已审看。旧CDP连接失败和仅拦截HTTP200的测试注入失败分别保留；产品／配置绑定drift[]，自有测试数据／会话／传输已清理恢复。确定性发送检查新增模型调用0，不代表模型答复、真机或生产验收。

当前设计权威为[手账设计与逐元素台账](../design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/README.md)；活动目录 `design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/` 包含01–04主变体及05–11生成／停止／失败／人工等待、探索入口、公开工地与设计师结果补稿。纸页、装订、字排、照片装裱与控件用原生结构／Less实现；欢迎角色和叶片为两张独立生成的透明PNG，没有设计图切片。工地照片、阶段／区域、作者和作品参数沿原获权投影；查看工地留在当前聊天底部面板，作品及设计师主页仍走原路由。加载、无结果、定位拒绝、失败和撤回沿共用状态规则；未完成回答及人工接待不露探索入口，不虚构距离、认证、预约或完成状态。

`GET/POST /api/miniprogram/assistant/conversations/:id/floorplan-context` 实现默认**不结合档案**。GET只列本人当前正式v4主户型，或按精确版本只读详情；浏览不选择。POST必须带 `expectedVersion` 及显式 `selection`（leadId/floorPlanId/layoutHash）或null，复用原幂等账本，将 `floorplanContext` 存于 `entry_snapshot`，不新增表或迁移。选择按客户／企业／会话／版本隔离，不授予权限；忙碌／人工／关闭及费用未核对任务拒绝写入，回执丢失沿同键核对。重进及materials/business两条读路径重验实时所有权、主图关系和layout hash；失效选择清除并停止正式户型注入。用户原话和自行发送图片仍沿原来源规则。根入口仅从该客户已有线索／本人开放咨询中解析唯一企业；多企业时不自动选最新。

证据 `tmp/xiaok-chat-restoration-20261029/final-checks.json`：原生 `attempt-14-less-invalidation` 12项／16张应用截图＋宿主截图，最终定向 `attempt-16-bound-final` 5项／5张截图（重复范围保留）。Stable2.02.2608080／基础库3.17.2、390×844逻辑／348×752编码、单副屏窗口／控制器，真实隔离HTTP／数据库写入及认证媒体，清理和源码绑定均保留。早期Less缓存／卡片错排截图为失败视觉证据；最终校验真实卡片display／照片尺寸并审看宿主胶囊。Mini定向161/161、后端单元8/8、资料兼容7通过／1项实模跳过；Mini全量2053/2054，保留既有surveying Phase0审计不一致。源码lint为0错误／27项既有警告，受影响lint通过；类型仍56项既有诊断／受影响0。隔离webpack编译通过且配置恢复、drift[]；仅该验证进程关闭standalone复制，不声称干净产品构建。验收业务Agent／供应商调用均0；设计使用内置ImageGen，另计。物理设备、真实微信授权、实际软键盘几何和生产未验；D2原两次失败与唯一D7执行记录不变。
<!-- xiaok-notebook-ui-current:end -->

**D6核对后语音：Limited（2026-10-29）。** C01／S04已接显式配置的本地录音／真实转写、原输入框纠错、作者另行发送、认证原音回听、删除和持久重进；师傅语音＋本人照片已完成原核对／发布链。完整D6不关闭：客户需求实际保存，Agent随后自添无来源桌面尺寸，回答被正确拒绝；D2仍为两次失败修补，不重采客户回答、不弱化守卫。0099强制RLS语音资产表复用原权限、任务、用量及消息／记录写服务。已验隔离CPython3.12／faster-whisper1.2.1／CTranslate2 4.8.3 CPU及已有medium模型hash；默认关闭，无模型下载／付费ASR／fallback。现场动作解码仅剔除schema合法且逐项恰为空串的非当前动作字段，非空／畸形字段及原角色／来源守卫不放行。当前单元7、真实服务7、兼容37＋1项事先声明的实模跳过、Mini157通过；lint通过，tsc原54项逐字相同／受影响零新增。原生原失败单列；native06员工真实链与回听通过，native07验证客户纠错／错误状态及真实回听／删除，native09／10／11零新增推理补齐原音HTTP404、撤权清空和可滚动查看的原失败反馈。保留3次成功／5次失败本地ASR、5个未执行即取消的队列探针；Qwen6次／25583tokens，保守累计¥30.633887/100。本地文字／费用预留均0且已结算，原付费unknown保留。13张核route的390×844逻辑／348×752截图审看；沿C01／S04批准主设计、U01及宿主弹层，无Less／素材／还原等级升级。见[二期D6合同](./xiaok-assistant-phase-2.zh-CN.md#当前d6核对后本地语音limited)与tmp/d6-speech-20261029/final-checks.json。后继D7先确认订单／报价／安装验收设计源；硬件、支付、商业条件及生产未验。 完整隔离构建已编译，但standalone复制媒体耗尽磁盘且自动tsconfig漂移使原批无效；本轮副本可逆移至E盘，原配置按hash恢复，仅验收进程禁用standalone的compile03已exit0／drift[]，产品output配置未改；不称干净生产构建。

**D5指定PPT旅程：限定Implemented（2026-10-29）。** 原C01照片关注沿离线投递、取消及原咨询归属；换节点使过时补问／派生答复失效。S04 site.action v4在精确正式方案发布之外，增加自然转交、落实与管理者分步解决／关闭的持久预览；只有原作者另行确认才委托原领域写服务。实时重验唯一有效同事、精确当前已同意方案、同房间核对发布的完成记录及有效照片、来源／处理版本和角色。回传须一段明确带引号客户原文及明确原件策略，缺项／歧义不默认授权。原双工地简报进入精确事项协调并刷新实际状态。复用原chat／upload／operations／versions／brief API及事项／依据／lifecycle outbox，不增路由／表／迁移／知识管线；所选企业enterprise_admin/admin/super_admin继承管理且无须就业／成员。Agent formal-business-projection-v2 source_only在原唯一一次hash绑定恢复中，只选择已读取正式resultKey，由原business解码器重验展示服务快照；不接纳模型完成正文、不增工具／调用，普通／建议守卫保留。当前输入10、答复83、核心服务5、投影／撤回2、正式方案兼容8、节点连续性2及Mini64通过；原兼容29/35的六项速率阻断，另以3+3通过且不改判原批。原native1/2与可选v1 1/2分列，最终C01 2/2均实际经过受限快照恢复，6次／41988tokens；原两组员工／实写／丢回执／双工地链已过，既有自然方案／C05证据复用。28图审看、drift[]、资源配置准确恢复；tsc仍与旧54诊断逐字相同／涉及0。Mini结构样式素材导航及还原等级不改。累计保守¥30.505972/100，原失败／unknown保留，D2次数2不变。证据tmp/d5-lifecycle-20261029/final-checks.json及[当前正式处理合同](./xiaok-assistant-phase-2.zh-CN.md#当前p5ppt38现场落实与正式解决关闭)。后继D6语音，未生产发布或宣称全PPT验收。

**D4现场协作：唯一计划两条固定PPT旅程范围Implemented（2026-10-29）。** 原S04 `packages/construction/chat/chat`新增理解员工明确的人工图纸核对及管理者本人回传节选。一次计费site.action只生成持久预览，原作者另发“确认核对图纸／确认回传”才委托原事项写服务；重验唯一有效图纸、原咨询、完整原话、项目／材料／事项版本及选定企业管理权限。只回传管理者本条节选，不自动复制内部回复。复用原项目实际节点控件、核对发布、C01精确版本来源及认证私有图片；无API／路由／表／迁移或Mini结构样式素材导航变化。C01最终校验沿原LangChain及LangGraph恢复；仅新建、纯文字、本人房屋只读查询在原四次总调用内预留一次修正，不增quota；旧business包仍只展示服务端快照。最终108单元、5项答复服务、69项集成兼容、6项动作结果及Mini62通过；全量源代码lint及最后涉及文件lint通过，完整类型保留相同54项旧诊断／涉及0。原完整native0/2（24次）、相同来源零模型14/14、首轮修复C01 1/2（8次）及最终固定C01 2/2（5次）分别保留，源码影响核验后复用，不合并为首稿全过。37图审看、绑定drift[]、资源／配置恢复。保守累计¥29.324547/100，原失败／unknown预留保留。证据`tmp/d4-customer-return-20261028/final-checks.json`及[当前P4A合同](./xiaok-assistant-phase-2.zh-CN.md#当前p4a限定接续项目共享对话核对发布与原咨询关注)。D2专业图文、D5正式决定／落实和生产仍单独处理。

**D4同房间事项／资料组合查询：限定Implemented，完整D4仍Limited（2026-10-28）。** 原S04 `packages/construction/chat/chat`可同时询问房间事项在等谁处理并索取图纸／需求；GET/POST `/api/miniprogram/construction/projects/:id/chat[/messages]`及共用后台服务在同一回复中保留本房间事项、精确获权资料版本与认证原件，不再因事项分流漏掉资料或混入另一房间。缺房间、多房间、编号与房间冲突沿用原澄清文案；明确事项号仅绑定其真实房间，可独立于近期概览读取，异常号不进入bigint SQL。原`construction.chat.response.v1` JSONB保存`issueQueryScope`（事项／房间／名称／解析状态）；旧消息从原问题恢复范围。重进读取当前事项修订，资料仍按原hash独立重验；更名／撤回后旧资料文字及图片不可沿用。租户／有效成员／私人咨询、enterprise_admin/admin/super_admin继承、原键和来源守卫保持。查询不新增记录／任务／事项变更／发布或批准；无新路由／表／迁移、Agent／知识管线及Mini结构／样式／素材／导航。沿原PPT22/38（853×1844→390×844）的回复、原图、澄清及失效组件。最终service05 7/7、Stable native04 9项检查／5图审看、drift[]和清理通过。原兼容批51通过／6项限流失败／1项可选旧实模跳过保留；原6项以固定独立夹具3/3＋3/3补齐，未改变限流。Mini23/23、全量及最终定向lint通过；最终类型仍54项旧诊断／涉及0。新增模型及费用0，失败／漂移／夹具批不改判。合同、证据及复用见[当前P4A合同](./xiaok-assistant-phase-2.zh-CN.md#当前p4a限定接续项目共享对话核对发布与原咨询关注)、`tmp/d4-site-context-20261028/final-checks.json`。完整D4两旅程、真机／真实微信及生产仍未通过。

**D4关注接续：限定Implemented，完整D4仍Limited（2026-10-28）。** 既有C01 `packages/assistant/chat/chat`及`POST /api/miniprogram/assistant/conversations/:id/messages`按限定登记名接受“就书房吧”／具体项目澄清和“不用提醒了”取消，沿原回执、取消／重试及重进组件。明确换房间替换旧提示，待确认项目撤权不套用另一项目；人工接待可取消，仍禁止新订阅。发布通知现由Worker候选、前台同步及锁内重验共同把construction_watches.source_message_id关联到实际订阅客户和原咨询。后开的未订阅咨询不能抢收或提前消费；原咨询处于人工接待时暂缓，不改投其他AI聊天。只有在另一段咨询明确重新订阅，才迁移原关注。原企业／线索／项目／房间／受众／版本／撤回／媒体及按客户outbox去重保留，既有获权主动业务查询不变。无新路由／表／迁移、模型prompt、Agent／知识管线、小程序结构／样式／素材／导航或权限扩张。当前归属绑定版本：真实服务10/10、兼容25通过／0失败／1项可选旧实模跳过、Mini62/62、Stable native03五组客户端／服务检查及5张核路由和咨询ID图审通过，认证原照片渲染、drift[]与清理完成。定向lint通过，全仓类型仍54项旧诊断／本次文件0；全量lint漂移批单独保留。无模型调用，前序bf72463e澄清／取消证据独立保留。见[当前P4A合同](./xiaok-assistant-phase-2.zh-CN.md#当前p4a限定接续项目共享对话核对发布与原咨询关注)及`tmp/d4-watch-origin-20261028/final-checks.json`；完整D4／D2、真机／真实微信和生产仍未通过。

**C01定位辅助推荐——限定本地链路Implemented（2026-10-28）。** `packages/assistant/chat/chat`沿用批准源`design-references/xiaok-p4b-public-sites-v1/README.md`的C01组件、结构、样式和素材。“看看适合我的设计师”和公开工地浏览可请求`wx.getLocation(type:gcj02)`；普通进入/发送只使用已获定位授权。`app.json`声明`getLocation`及附近服务用途。`/api/miniprogram/assistant/conversations/:id/location`的GET/POST/DELETE限本人及当前企业会话。后端复用已配置高德Key逆地理编码，仅把核验城市/区县与获取时间存入`entry_snapshot.nearbyRegion`（有效30分钟，客户端最多复用5分钟）；经纬度不进入聊天、模型、设备存储或操作重试日志。明确房屋所在地优先；当前位置只是浏览上下文，不写成房屋事实。不知道风格/户型也能先看当地设计师。既有获权公开工地卡按同城/同区县筛选，不声称距离。拒绝/失败会清除旧地区，沿用现有提示提供重试或可选口述城市。没有新增布局、素材、持续定位、公开同意、项目成员、线索归属或生产发布；逆地理编码目前实现高德，其他供应商走同一降级。证据与当前限制见[二期定位合同](./xiaok-assistant-phase-2.zh-CN.md#c01定位辅助推荐)。

**C01真实企业文字恢复（2026-10-30）：限定Implemented。** 沿design-references/xiaok-chat-redesign-20261029-v1/tab-context-v1/README.md批准手账及共享失败重试状态，不改小程序结构/样式/素材/文案/导航。缺失Embedding转发已恢复；原咨询802同一客户原话恢复为1589，第二条同企业真实profile旅程1590、持久回读通过、drift[]。仅已知响应后的检索失败投影可重试，旧费用预留保持、新任务另占预算；未知/取消/缺用量仍阻断。用量10/10、聊天44/44、lint0；活跃IDE窗口未取得精确项目路径映射，未控制窗口，不宣称新增原生截图。见[排障合同](./xiaok-assistant-phase-2.zh-CN.md#当前聊天队列停滞恢复)。

**D3内容到真人及文案辅助（限定Implemented，2026-10-28；完整D3仍Limited）：** 既有D01/D02/C01/S01内容→本人咨询→真人接续证据继续保留；本次补齐后台`/case-publishing/[id]`的自然语言文案要求、持久生成、员工核对采用及原企业审核发布。GET/POST `/api/portfolio/works/:id/copy-drafts`和POST `adopt-copy`复用在职case-publishing/本人作品边界与选定企业的三管理角色继承。0097复用原model_tasks/items、强制RLS、供应商attempt和企业清理；仅本人任务可读，作品/作者/许可/hash/版本失效即隐藏并拒绝采用。只改草稿标题/介绍，来源、作者、图片性质、许可、发布/线索/归属/分佣不由模型修改；分享文字仍是员工核对的草稿。仅准确百炼qwen3.8-flash，缺配置如实拒绝；未知派发不自动重发；未结算派发（含完成/失败/取消）保守预留跨日保持，计入原企业配额，账单未知不算零。当前9项真实文案服务（含跨日未结算派发预留）及8项获客/接待兼容通过；固定4次实模原结果3/4，原失败和2206tokens全保留。两次确定性词面误判修复后，8守卫单元+4份完全相同wire原稿经真实持久/采用服务回放12/12，不追加模型也不重评原批。实际后台输入→生成→采用→重进→审核发布已核对；同一发布版经Stable原项目D01/D02读取、同咨询重进和下架清图3/3、4图已审看，绑定drift[]。原生01的JWT初始化及02的种子/入口咨询断言错误分开保留，均已恢复会话；03通过。设计沿02-admin-work-editor/Ant Design共用状态及原D01/D02唯一批准源，无Mini结构/样式/素材改动。原3006 Chrome会话已退出登录，使用单独登录合成账号的隔离3112服务验证，原3006/Worker不替换。0097仅按本次明确授权迁移loopback55432/xiaok_embedding_eval；测试身份、进程/传输/配置/锁已清理恢复。原¥100试验账册累计保守¥27.813317/100，实际账单未知；D2两次修复后的失败、真机/真实微信/BLE/完整宿主与高屏未验不升级。原真人范围提交b7f6cf4f；无推送、生产迁移或发布。合同/原失败/当前边界见双语二期D3文案节；证据`tmp/d3-copy-development-20261028/`、`tmp/d3-copy-service-20261028-{01,02,03,04,05,06}/`、`tmp/d3-copy-live-2026-10-28T01-43-30-634Z/`及`tmp/xiaok-d3-copy-contact-compat-20261028/`。

**D2当前合同（Limited，2026-10-28）：** C01沿用批准的图片/气泡/来源/恢复组件。显式准确百炼qwen3.8-flash与conversation-images-v1绑定当前/历史获权像素、原生最终投影、服务端图文预算及配额（有图请求25600，新run预留128000tokens/1777778微元）；无图请求/旧snapshot保持原限制。正式墙边/层高/门窗仅引用原图已存值，不由照片/渲染补测量，不替客户采用需求或写墙图；保留layoutHash和未变来源的旧依赖version。90单元、6项真实确定性服务、D1兼容5/5、lint及两次撤回重进隐藏6条答复通过；TSC仍逐项相同54个原诊断、本次0。配置模型05批6/11、5个原Schema/工具范围失败；原生新编译/上传2/3通过，追问9541失败，后续重进/截图未执行。两次机制修复后停止D2补丁/采样循环，只推进独立D3真人接续。全部尝试/未知预留保留，累计保守¥27.802287/100，实际账单未知。批准C01 P4B README、结构/样式/素材/路由/API/schema/角色和生产不变，未自动推广原开发企业。证据及精确失败范围见双语二期D2合同和tmp/xiaok-d2-context-20261027/d2-loop-stop.json。

**D1已验基线：** D1限定Implemented（2026-10-27）：C01正常咨询、需求更正与量房答疑共存，C02仅采用预算、保留瓷砖/地暖，实写草稿、丢响应按原键恢复、重进及他客拒绝已贯通。显式开发白名单/run配置复用native-sourced-final-v1、requirementClaims=requirement-claims-v1、reviewCompletion=review-completion-v1，准确百炼qwen3.8-flash、工具开/图片关；旧在途策略保留。主张ID绑定实际原话及草稿/待采用/失效状态；同一Agent显式声明剩余问题或纯真实回执，纯回执没有自由最终模型入口。既有负向守卫仅限制单个可写分句，不替代整轮理解；来源、回执、租户、版本与客户同意守卫保持。75单元、5/5当前确定性服务、未变读取器6/6边界、固定实模10/10回合（34请求/269672tokens）及Stable原生7/7（7请求/54279tokens）通过，绑定均无漂移；2个纯更正回合按真实回执重建。4张C01/C02核路由截图已目视复核，逻辑390×844/PNG348×752。最新webpack构建退出0、配置精确恢复；TSC仍54项原诊断、本次0。批准C01 P4B/C02 slide06及共享状态组件沿用，WXML/Less/素材/API路由/角色无变更；无新表、Agent、知识管线、设计或生产部署。全部原失败/未知预留保留，累计保守¥23.867267/¥100，实际账单未知。原配置/投影、临时会话/传输恢复，合成企业停用、身份撤权及资源释放完成。证据tmp/agent-contract/trial-composable-d1-2026-10-27T14-46-20-203Z.json、tmp/agent-contract/composable-native-d1-claims-completion-live-20261027-01/report.json及tmp/xiaok-d1-claims-20261027/delivery-evidence.json；唯一后继见开发计划第2节，D2当前状态见上方记录。

**P0已验基线（Implemented；D1收口见上文）。** 批准的C01 P4B、C02 slide06标记、样式、素材、路由、导航、回执和视觉层级保持。北京百炼Qwen3.8非思考实模现覆盖两组工具/结果往返、原生JSON Object/strict Schema、隐式/显式缓存计数、Partial前缀续写及持久重进。Partial内部CLI必须提供原始绑定实模证据，默认仍拒绝。带来源原生搜索仅传隐私校验后的公共查询，使用DashScope多模态SSE和原读页Evidence；文本端点400及随后系统DNS读页失败均保留。AliDNS及内部retry-search-read已完成真实原文恢复和持久重进，新增推理0，保留原attempt及不可变item；原Batch两项完成结果取回和重进均通过（合计观测176 token）；取消/旧搜索拒绝预留保留。最终恢复2/2无漂移、新增推理0。真实Batch提交/重进与取消已有证据，未知item继续按原累计¥100账册和最新明确授权全额预留。0096内部任务不新增Mini路由，保留C01原SearXNG/search_web/read_web配置。流/证据新单元15/15及真实隔离服务10/10通过；原98单元/65客户端、确定性Stable7/7保留原范围。D1仍须完成配置模型的Stable C01→Worker→C02实写/重进整链，不宣称新视觉或真机验收。证据见`tmp/xiaok-p0-live-20261027/`、唯一计划和双语二期合同。没有产品UI变更，还原台账保持。

**C01页面加载：聊天控制器已实现。** 同一页面实例切回`packages/assistant/chat/chat`时保留已有消息和未发送草稿，并行后台校验当前会话和消息；不再用首次加载态隐藏正文，也不再强制重读入口和历史列表。入口仅在同一签名会话内按原有有效期复用；过期、换身份和主动重新连接仍重新校验。有效期内返回空白欢迎页无需请求。历史记录在打开原有面板时加载，历史接口故障不再阻塞咨询。重叠的前台刷新/入口加载共用在途请求，后台读取不能覆盖正在发送的消息；权限拒绝会清空敏感内容，消息投影/来源撤回及原有生成任务、人工接待轮询继续以服务端为准。夹具请求记录显示：首次欢迎页由2次减为1次，已有会话返回由4次减为2次；这是请求数，不是生产耗时实测。6个受影响Mini测试文件共85项通过，其中新增8项生命周期、竞争与恢复回归。Stable/SDK0.13.0在390×844的合成请求验证5/5：当前控制器、实际输入草稿、真实切页返回并暂挂响应、正文/草稿保留、后续回复同步；无后端/模型调用，会话和请求替换已恢复。首轮源码识别断言检查了压缩后的参数名而失败，原驱动另存，不改判首轮通过。额外工具栏编译CLI因连接授权超时，未计通过；启动运行态和当前改动控制器已核对。通过官方`cli agent start`按准确项目路径及实际IDE9430恢复9420；2026-10-24遗留的CDP9431记录不作为活跃端点。证据在`tmp/xiaok-chat-loading-20261027/`，不宣称生产部署、真机或完整视觉验收。批准的C01 P4B设计来源及WXML/Less/素材/导航保持原样。参考[LibreChat按键隔离查询并保留列表数据](https://github.com/danny-avila/LibreChat/blob/main/client/src/data-provider/queries.ts)、[Dify当前会话重校验](https://github.com/langgenius/dify/blob/main/web/service/use-share.ts)、[Open WebUI按会话保存草稿](https://github.com/open-webui/open-webui/blob/main/src/lib/components/chat/Chat.svelte)，仅借鉴客户端加载策略，不引入其框架或改动Agent编排。

**D3联系恢复：客户端合同已修，完整交付仍Limited。** 原`packages/assistant/work/work`联系/重试动作复用批准的D-02 v2壳与P2C.2共用反馈、未知结果及重进状态。联系回执须绑定原咨询、包含已知接待状态、匹配的会话模式和请求ID，才清除待核对原键；结构错误或串会话回执保留原键/原body并显示既有错误/重试态。反馈现与HandoffWorkflow当前回执一致：等待不等于接通或预约，接入后接待人可能不可用，取消保留需求，结束不再虚报新提交。首次联系和原键重试确认后都返回原C01；隐藏或换身份后的迟到结果不导航。无WXML/Less/素材、路由、REST body、权限或模型变更。新增离线回归先复现4失败/3通过，修后7/7；受影响兼容合计39/39，15项源码/测试/配置绑定、drift[]。合成服务投影不能证明真实写入、租户校验或渲染/原生验收。D3固定8项真实隔离服务现已通过，前置schema由用户明确批准的一次性隔离owner初始化；原28P01仍保留，原实例sfp_migrator凭据未改。完整D3/模型/原生验收仍Limited；原服务pending.patch保留为不可变审阅证据，收口见tmp/d3-connection-repair-20261027/handoff.json。证据`tmp/d3-contact-client-recovery-20261027/`，原服务失败保留在`tmp/d3-portfolio-reception-20261027/`。D1/完整D2/D3仍Limited，未付费调用、推送或部署。

**本次收口前的D1历史实现记录：** 复用批准的C01 P4B与C02 slide06组件、路由和布局。明确供应商拒绝走既有失败反馈；未知结果保留原提示、原键与账务守卫，服务端同步落实该边界。提案已读取的客户原话现进入既有H出处/引用链，沿用租户/本人、hash、memory-version与撤回校验；C02仍只把所选字段写为草稿。准确项目的Stable CLI0.3.11、新编译、基础库3.17.2、390×844原生验证通过7/7：实际C01输入→Worker→提案→C02写入、丢响应原键恢复、重进及其他客户拒绝；保存4张核对路由的348×752截图并恢复session/transport。该批为确定性模型且先于引用连接修复，不证明实模语义。45项后台聚焦单元、56项客户端、4项拒绝/恢复服务、10回合确定性引用的真实服务通过。用户指定百炼qwen3.8-flash的修复前批次为30次实际请求、首稿4/10通过，6项数字/出处失败原样保留。此前402来自隔离库的DeepSeek官方选择，隔离原配置/投影已恢复。用户不追加模型调用，引用连接修复的实模/原生整链仍未验。无WXML/Less/素材/导航变化，不提升还原完成或发布状态。详见二期合同、唯一计划和`tmp/xiaok-d1-resume-20261027/`。

**独立D2 DOCX注释保全：内部Implemented，D1/D2仍Limited。** 新上传/替换采用`xiaok-file-v1:docx:yauzl3.4.0:saxes6.0.0:notes-v2:outline-v1`：普通脚注与尾注按独立ID保留完整原文，标题注释按真实级别（含跳级）随所属子章节传播并在同级新章节停止，表头注释随数据行保留。缺失/重复引用、复杂或超大注释明确失败。原件/已发布解析/hash不可变，不自动重解析/重索引或扩大预算。原`/assistant-knowledge`上传/审核/索引/发布及C01来源/撤回合同保持，无路由/表/角色/Agent/模型/结构/样式/素材/导航变更。`tmp/xiaok-d2-docx-notes-close/`绑定324项依赖：单元23/23、真实隔离服务3/3，含原键上传、重进、引用鉴权200/401/404/404、替换失败保留旧发布及来源/派生正文撤回。解析/数据库/鉴权真实，分词/向量/摘录答复明确注入确定性实现，网络守卫下供应商attempt为0。首次驱动失败保留在`tmp/xiaok-d2-docx-notes/`，不改判通过。定向lint通过；全仓类型仍为相同54项，本增量0项。批准C01来源片/C02设计未变，无新增渲染/原生或模型语义验收；详见当前KB-2合同和唯一计划记录。 当前段落大纲支持读取当前直接`w:pPr`：0–8为标题层级、9为正文，直接值优先于样式，旧`pPrChange`不能提供当前层级/样式。非法层级明确失败；未新增完整样式`basedOn`继承/编号。新上传/替换报告`notes-v2:outline-v1`；既有原件/已发布解析仍不可变，不自动重解析/重索引。新增6个大纲用例及受影响注释/来源兼容合计29/29单元；直接大纲真实隔离上传/审核/索引/发布/重进、来源鉴权200/401/404/404与失败替换/撤回3/3。证据`tmp/xiaok-d2-docx-outline-close/`，328项绑定无漂移、外部fetch/供应商attempt0；分词/向量/摘录答复明确注入。定向lint0、原54项类型诊断逐项不变；修复前0/5与首次夹具类型错误独立保留。未改UI/API/schema/模型，无原生或完整D2验收。

**当前交付（2026-10-27）：OS-CONTRACT-12 C01接待请求/取消有界Implemented；OS-CONTRACT-11原始仅回复模型语义及默认Agent/完整咨询Limited。** C01 `packages/assistant/chat/chat`沿批准P4B文字控件和确认/错误/未知状态。候选实际Worker只暂存未批准的设计师接待提案；客户点击原`POST /api/miniprogram/assistant/conversations/:id/handoff`写等待，contactConsent=false、电话为空。等待时小K暂停，C01既有取消按钮写取消并回AI；客户/租户/身份、来源/epoch、版本及原键恢复守住实写，C02 `packages/assistant/requirements/requirements`原草稿不变。当前源码纯SDK通过C01真实HTTP/等待/取消/重进/权限12/12和C01/C02失效需求提案6/6，未改小程序布局/样式/素材，也未新编译。机制修复后两条配置Worker首稿通过；此前误选`usage`与OS-CONTRACT-11虚称“已记录/已确认”的原首稿均保留失败。C02批准源仍为slide06，无新页面、角色、表、知识入库或默认迁移。累计1618792tokens/保守¥6.371297（账单未知），低于¥100；真机/真实微信/完整宿主光学/生产未验。见[当前契约](./xiaok-assistant-phase-2.zh-CN.md)。

**前次交付（2026-10-26）：OS-CONTRACT-10候选Worker/C01/C02需求审批Implemented；默认Agent/完整咨询仍Limited。** 本人customer_consultation候选会话由agentReviewCandidate + requirementReviewMode + requirementWorkflow=langgraph及run policy绑定，实际Worker调用LangChain类型提案工具并隐藏record_need/直写request_designer。提案重验lease、租户、来源/epoch及摘要版本；外层Agent图完成后再准备独立LangGraph审批图，仅客户POST /api/miniprogram/assistant/conversations/:id/requirements提交selectedFields/同意后写所选字段为草稿。C01 packages/assistant/chat/chat沿既有文字按钮进入C02 packages/assistant/requirements/requirements；台账批准的C01 README与C02 slide06设计源保持，无新素材、样式、路由、表、角色或知识入库。4次配置模型首稿和4次确定性实服通过；Stable SDK原生入口、仅选预算、实写、重进及他客拒绝通过，无桌面新编译声明。累计1378614tokens/保守¥5.170407，低于¥100；原OS08/09失败保留。真机、真实微信、完整光学校准、默认迁移及生产未验。见[当前契约](./xiaok-assistant-phase-2.zh-CN.md)。

**CONSULT-02当前执行（2026-10-24）：R1-A限定Implemented、R1-B已验证，R1-C原固定综合验收仍Limited，R2–R4未开始。** 复用恢复及未受影响证据；2369隔离保留59497tokens/285586micros，不重放，新未知立即停调。原100万tokens/¥5累计、每请求60k和scenarioTokenLimit保持；live-10后累计518485tokens/含预留¥0.869762、实付null。Agent把补丁引用容量/删除互斥编入可信baseHash的严格schema，原本地语义守卫不变。另修复同页远距引文合并超过600字符而丢失答复：原GET /api/miniprogram/assistant/citations/:id支持w:run:index:part，把过宽组合拆为实际已选原文段，仍≤600/段，旧有界w:run:index保持。保存/打开/追问共享投影，须已存消息包含该ID并重验原Evidence/页码/hash/会话/tenant/来源；伪造part或撤回不能访问。14单元、4真实服务、219依赖类型0/lint及原Stable/C01的9项实写/两片来源/追问/重进/他客拒绝/撤回通过，1442绑定无漂移、attempt0；两片重进与撤回PNG已审看。沿批准C01/C02/U01，WXML/样式/素材/文案/导航未改，无新表/端点/菜单/授权或知识入库变更。live-09/10失败保留；9294保存缺陷已修，9293的path/segment失配缺当次完整出站证据，停止盲采，替身不算模型语义。详见[二期当前记录](./xiaok-assistant-phase-2.zh-CN.md)。

**当前CONSULT-02接续（2026-10-23），Limited：** 明确一两句上限的最终校验限定实现，超限沿既有唯一修复；首轮模型输入/工具/schema、预算和权限保持，无服务端代答。`tmp/xiaok-paragraph-contract/review.json`分开记录技术4/4、首稿语义0/4、修复后语义1/4：1571/1573只说需要区分，1572摘抄准备动作，仅1574解释准备不等于永久收存。正常业务整批失败，不追加采样。复用68单元/lint和4确定性服务，181项类型依赖/0诊断、275项稳定原生绑定通过。固定4次免费GLM9保留8次尝试4042–4049/6605 observed tokens/null费用，14原生/2清理检查及4张已审看C01图，逻辑390×844/编码348×752。Stable2.02.2608080/SDK0.13.0/基础库3.17.2，副屏唯一原项目每轮新编译；持久/两次原生重进、幂等、有效客户租户拒绝、旧token401、零记忆/业务写入及transport/auth/controller/锁清理通过，两库jobs0/locks0。原段落2/书桌链路2/预算1、1430/3862/8673未知保持、不重放清账，前序覆盖/通道证据独立。当前无互联网搜索工具；用户关于装修智能体/联网的讨论为方案，非能力验收。KnowledgeRetriever/Evidence、路由/API/schema/角色/凭据/VLM/1454及批准C01源`design-references/xiaok-p4b-public-sites-v1/README.md`、结构/样式/素材/固定文案/导航/台账保持；非新还原、完整宿主光学/真机/真实微信/完整咨询或生产通过。

**CV-01/CV-03工地视频及CV-02云录像限定Implemented，CV-04恢复/容量保护及负责人只读运维已有有界证据，整体Limited。** 原`/construction-projects`分配/绑定/云台、负责人录像（默认关/3天、节点1..7）、私有H5回放及保留/代次/租约守卫沿用。admin/super_admin在所选企业继承负责人权限，无需入职/项目成员；经理绑定/抓拍/控制、成员观看。录像/探针共用已核验F盘，容量保护保留显式关闭、外部计划及直播/历史。负责人GET `video-capacity`、`video-activity`、`video-coverage`及新增`video-cleanup`在`/api/construction/.../projects/:projectId/bindings/:bindingId`复用租户/项目/有效启用绑定检查。“清理记录”复用批准Ant Modal/Table/Alert/Empty，按ID倒序20条加前瞻读取既有deleting/deleted/missing、源区间、精确字节、已记录完成时间和安全失败原因，不暴露上游ID/路径/原始错误、不推断重试次数、不检查物理文件、不提供变更；更早页失败保留行、重试追加、关闭中止、最新页重进。原容量/运行记录/每日覆盖合同沿用。清理9项隔离/57稳定绑定、HTTP11/54、UI10/57，最终49入口类型/定向lint通过；两条真实已清理记录、明确客户端专用空/25行UI和真实隔离服务分页/空态。1280×720/663×892正文/表格内滚及关闭按钮可见已验。不改schema、录像/策略写入、WVP/Worker、Mini/H5或插画。[视频计划](./cloud-construction-video-plan.zh-CN.md#18-只读录像清理明细implemented)记录源和证据；2026-10-25仓库门禁：全量lint 0错误/25警告、生产构建与Next类型检查通过；早期施工批次绑定只属原批次证据，本轮未重跑施工业务检查。真实74小时批次2026-10-23T07-33-15-912Z于5.8866小时/350观测因camera_service_auth_failed失败，5次小时私有206/匿名401不计24/72小时/自然到期通过。自清理将策略39关闭为40/off/stopped，独立确认ZLM=false及6段封口索引；46冻结文件/3镜像挂载不变、F盘健康。automation-4已停用，2026-11-03已实现只读白名单HTTP401的有界恢复（共享重新登录/最多重发一次、迟到旧401不清新token），控制/开流/抓拍/计划写入/删除及网络未知结果不自动重发；原失败批次保留，不计自然过期或24/72小时通过。14项适配器、49入口类型和定向lint通过，真实WVP的显式合成401注入后重新登录/读取恢复，无设备写入。42项服务/适配/存储/权限回归在本批专用隔离库通过，339项依赖绑定无漂移、仅清理本控制器新建且通过的数据库；旧固定隔离库原失败与超时证据独立保留。检查脚本默认每批新建专用unit数据库，显式旧库不清理。证据tmp/cloud-camera-continue-20261103/。多路/实机云台/微信/公网4G/生产未验，企业默认/客户授权/抓拍保留未实现，用户明确授权的新设备SD卡识别、非空录像查询和实际1920×1080/50帧回放均通过，历史/新近两批时间推进5.015/5.014秒且本会话已停，新近批另确认媒体消失；原设备卡识别失败与首次整日查询超时保留。计划已按原授权采用有线云录像/4G本地SD目标，SD软件接入正在按§1.9验收，公网4G/微信未验；见视频计划§2.1。先前鉴权恢复批次未改UI/策略；本次双模式增量见下文。 先前只读运维批次仅扩展Admin；本次SD增量见下文。

CV-02双模式本地软件集成：限定Implemented，整体Limited。原负责人“录像设置”保存recordingMode=cloud|sd，SD强制enabled=false并等待所属云录停止确认；沿批准Ant/H5摄像头、直播/回放、日期、片段与返回直播控件，无切片/新插画。0111新增策略模式/校准状态、3张强制RLS的SD窗口/短时索引/持久回放表及会话sd_playback_id，清理/解绑/模式切换保留STOP所有权。私有物理序列号映射复用厂家只读认证核对时间/连续SD状态，无可信时间拒绝；仅绑定/启用后连续校准窗口可读，采样断档>120秒或时差包络跳变另开窗口，绝对时差>60秒拒绝。固定WVP片段deviceId为父设备，外层仍严格核对设备/通道。H5 query可传bindingId/before，每次至多1小时、片段至多5分钟；2分钟索引开流前复查，source=sd走原私有FLV/HLS。先持久记录共享租约/STOP再调用上游并确认媒体消失；未知开流不重发，撤权/代次/到期继续校验，5秒回收与30秒采样分开。SD不改设备录制、不持续上传、不承诺三天删除、不读旧工地画面。受限custom备份/PGDMP/目录核验后隔离95→112迁移及3表RLS/hash通过，仅微云1454标记项目12/绑定9，未迁开发主库/生产。限定回归52/52（349稳定绑定）、真实服务5项（355稳定绑定、1920×1080/50帧/5.015秒、匿名/旧代次拒绝及媒体消失）、H5 390×844出画/日期空态恢复/重进不自动播放、Admin1280×720 SD→cloud/off/3天→SD真实保存读回均通过。Stable原生5/5无漂移，真实项目入口/重进和客户端403注入后真实服务重试通过，不代表微信真机播放。最终types-successor-01同一52入口0诊断、lint-successor-01通过，各353绑定无漂移。全量工作区lint 0错误/28警告/1740稳定绑定；webpack编译103秒成功，完整build仍被未改xiaok-manual-fixture.ts:43的state.keys unknown阻断，不称全量通过、不在本次修小K。Next自动加入的临时类型目录保留脏改动，不纳摄像头提交。H5/Admin观察回执没有独立完整前后hash，不补造。早期漂移批、首次原生导航失败、旧74小时/旧设备失败及整日SD查询超时继续保留。3条自有回放已停/媒体消失，自有3017/3018已停，共享资源保留。证据见视频计划§1/§1.9及tmp/cloud-camera-dual-20261103/。公网4G、微信真机、新24/72小时/自然到期及生产未验，automation-4继续暂停。 最新CV-04可靠性为限定完成、整体Limited：新74小时批次因数据库连接超时在5次观测后失败，finally清理也失败，已版本守卫孤儿清理并恢复SD。新增只读有界恢复不重放写入，独立监护接续已确认策略后的父控制器失联清理；物理前检拒绝录像/探针挂载不一致。11文件/3701440568字节复制/hash通过并保留原卷后恢复批准F挂载，WVP/探针容器及全部镜像不变。实际父进程异常退出清理、正常184.901秒云录/私有1080p解码（101帧/4.04秒）/停录/SD恢复通过，382绑定稳定；54入口类型/367绑定、单元4项及定向lint/366绑定通过，早先tsconfig漂移离线批次继续无效。无产品UI/API/角色变化。企业默认留存、业主视频授权、抓拍保留及完整24/72小时/自然到期仍未完成。当前证据/下一工作见视频计划§1及tmp/cloud-camera-reliability-20261103/。

**OPS-01双工地事实简报：限定Implemented，整体小K仍Limited。** 项目总览进入`packages/construction/brief/brief`，读取实际节点/最新有效发布记录/等待事项，点击项目进入原S04预填精确问题，明确发送、回复后刷新与重进。GET `/api/miniprogram/construction/brief`保留租户及管理边界（owner/admin/super_admin或项目经理）、20项目/50事项、no-store及原来源/方案守卫；作者署名不混同发布人，无房间总记录只用于简报。无新后台页/菜单/表/知识管线，普通成员不获管理权限；不读私聊、不推断逾期或生成经营建议。PPT20/25/26及原S04是设计源，复用独立小K素材无切片。2服务、101Mini复用、37兼容原版本、11原生、5视觉/前置、12包体与完整宿主/元素核对见[二期合同](./xiaok-assistant-phase-2.zh-CN.md)及`tmp/xiaok-ops-01/verification.json`；原失败和tsc292基线/涉及0保留，模型调用0。高屏/真机/真实微信/完整PPT和生产未验，下一CONSULT-02。

**当前v120：统一资料回答与目录修复投影；整体Limited。** 纯户型读取和已解析的材料读取向模型提供既有`synthesis`最终结构，用实际原文/引用目录回答本题；操作卡和房屋/房间未明确时仍保留business回执展示。去重后的模型视图保留材料`data.resolution`。目录首稿按完整结构识别，空引用数组也使用原有从0开始的正文路径修复，避免混入旧协议段号；删除相冲突的旧查询结果收尾指令。回答、引用和编辑仍由模型选择，四次调用/一次修复、来源/数值/承诺守卫、租户权限、持久回执/恢复及计费保持。KnowledgeRetriever/Evidence、解析/检索/发布、公开路由/schema/角色和Mini结构/样式/素材/固定文案/导航不变。C01沿`design-references/xiaok-p4b-public-sites-v1/README.md`和批准C01/C02/C05/U01组件，无还原台账完成状态变化。

**v120已执行证据。** 固定源码/测试/配置`80086579363dfe56468a0f3a645600701fee8633a0b66a3cd83edf34b6df74be`（2270项）下，390项Agent单元、1项定向真实服务、8项兼容服务、99项Mini及涉及lint通过；全量tsc仍292项基线错误/涉及0，与v118逐字节相同。两次串行Stable窗口中，原户型题与独立建议题各固定执行两次，均用既定Qwen/Qwen3.5-4B：1380/1382首稿依据获权合成元信息回答户型核实；1381/1383各唯一修复后失败（invalid_model_citation / unsupported_model_commitment）。修复已收到正确0基段落定位，仍未删除无依据照明数值，因此协议修复不是完整共同原因；没有新的机制证据不再做第三轮措辞/正则采样。CONSULT-01仍Limited，阻塞带入CONSULT-02，下一步只核对一次OPS-01实际依赖。10次accepted模型尝试对应10条observed token记录，另有2条query_embedding，费用全为null；无需求写入，记忆保持v6。源码/配置/驱动首尾稳定。七张390×844原生C01图（PNG348×752）已逐张查看，核查依据摘要、持久重进、失败反馈及实际解除主户型关联后的撤回；不冒充知识弹层或完整宿主光学验收。批准C01/C02/C05/U01源仍为`design-references/xiaok-p4b-public-sites-v1/README.md`；无小程序结构/样式/素材/固定文案/导航或还原台账变更。复用已发布合成PDF，未重做上传/索引或修改知识源码。transport/auth还原，测试AI/身份/员工停用撤权，队列/锁/controller为0。真机、真实微信及完整宿主仍未验。原红测、服务/模型失败、unknown和null费用分别保留。见`tmp/xiaok-final-protocol-v120/verification.json`、`semantic-review.json`、`live.json`及`postflight.json`；未生产发布。

**独立保留的v117证据。** 最终379/4/8/98项单元/定向服务/兼容/小程序及scoped lint通过，tsc仍292/涉及0且诊断一致。免费Qwen/Stable1369/1370选择实际PDF376/第2页，却追加未请求第1页及项目段；两次均被unsupported_model_commitment在最终修复前拦截。原生=false/语义=false，来源弹层/原生撤回未到达。4次调用/4条token费用null，无需求写入、记忆v6；2张失败反馈PNG已实看，自有资源清理完成。源码55fb104e38d89d76fbb0f4dc3d0f2302702e513b4df71735e070c5d6b69a0b2f。细节见[二期合同](./xiaok-assistant-phase-2.zh-CN.md)、`tmp/xiaok-answer-scope-v117/`。继续修原文上下文/反馈，再接剩余F-07，不声明全阶段完成。

**独立保留的v116证据。** 稳定源码2538066e5d25d413fb37ecad5d19c214391b4a9fcb894c8a5a2be16b99f0308d（2266项）下，Agent单元/定向隔离服务/知识兼容/小程序分别375/3/8/98及scoped lint通过。覆盖原1360/1362首稿的六类绕过、真实空读取、真实预算保存/回顾/来源撤回、普通只读重入及失败回执恢复。全量tsc仍exit2/292/涉及0，完整诊断与v115一致；较早测试/范围调整批次单独保留，不计入稳定批次。新免费Qwen/Stable1363/1366均先实际search_knowledge，再引用文档369/版本375/第2页；但两次均在advice新增无据关闭条件，1366还写入结算/签字确认，逐条语义验收失败。真实引用HTTP本人200/同企业他客404/跨企业404且原文为实际第2页；现有synthetic transport拒绝/citations/:id，两次原生来源弹层等待超时，仍未验证。1364/1367查询真实材料后，最终同段版本/金额缺对应引文；1365/1368对独立照明建议仍检索，生成无据色温/流明/Ra量数；四次均被unsupported_model_commitment拦截、无交付。六条原题均只执行一次，无需求写入、记忆保持v6、未触发最终修复，无本批原题漏执行。 原生=false，逐条语义=false；实际配置Qwen3.5-4B attempt共12次，实测token记录12条，其中费用null为12条，未知费用不按零处理。8张原始且路由核对的PNG已逐张实看，逻辑390x844/编码348x752。首个最终稿失败=["1363","1364","1365","1366","1367","1368"]，不与修复后通过合并。夹具/transport清理=true。证据：`tmp/xiaok-source-read-v116/`。既有v115预算原生恢复及原1359/1361安全宽度记录独立保留；1360/1362仍为原始失败，不重放或改判。

**后续已授权范围。** 先用实际1363/1366首稿继续一项有界Agent最终范围修复：advice标签或真实PDF引用不授权原文未支持的业务前提。复用现有工具/收尾schema及唯一修复/四轮预算，正文/引用仍由模型选择，保留数值与承诺拒绝。下一新原生窗口前，将已验证helper复制到新证据目录，只放行当前自有合成会话实际返回的citation ID，保留串行SDK/CDP/精确窗口/锁/finally纪律。随后按实际输入修复F-07引用组合与独立建议过度检索，不改解析器、不补造引用或服务器答案，也不通过降级general绕过数值校验。 来源表达覆盖、完整F-07长聊/压缩、全部PPT/专业能力/真机/BLE/真实微信/生产验收仍未完成。1132/3196及1184/3327仍未重放/新审计且费用未知，本批夹具不结清历史全局未知任务。不付费/换模型兜底、不push或部署。

**AG-02原C01需求容量接续：限定实现，整体Limited。** `packages/assistant/chat/chat`沿唯一批准`design-references/xiaok-p4b-public-sites-v1/README.md`及原C01/C02/C05/U01气泡、输入、来源、保存/失败/重试和持久重进。服务端`need-memory-archive-v1`把累计历史与最多300个当前room+field分开，跨旧累计300条仍可保存/更正；完整被替代原句/链和真实回执在同一原run step事务私有归档，不把归档当新当前事实或正式批准。有效参与者/触发原话、原键重放、批次回滚、当前来源撤回及归档阻断继续由共享服务决定；明确只回顾聊天且排除业务来源时收紧读取，不扩大写入/转人授权。Mini结构/样式/素材/固定文案/导航/几何/API/权限均未改，无新还原完成声明。实际检查、配置模型/保留失败、Stable SDK/CDP不可用及原生未验范围见[二期AG-02合同](./xiaok-assistant-phase-2.zh-CN.md)。多房屋/复杂字段、归档级语义检索、300个当前键满载模型容量、完整专业/PPT/宿主/高屏/键盘/真机/真实微信/BLE及生产仍Limited/未验。 同批`need-memory-sources-v1`复用step1009/`agent_need_context`及保存步骤，绑定模型用到的当前需求原消息完整hash；派发、恢复、提交和客户/员工投影重验，来源失效按原提示收起普通保存回复及派生文字。旧版无依赖清单的普通回复在当前来源失效时仅保留AI内部中性回合，不从旧文复活需求；不追补虚构的历史依赖。

**AG-01定向原C01接续：限定实现，整体Limited。** `packages/assistant/chat/chat`沿批准`design-references/xiaok-p4b-public-sites-v1/README.md`的气泡/输入/来源片/重试重进。既有`extractive-history-v2`保留严格企业/本人/咨询及双截止、相关前30条再补近期候选、60条/24,000字节输入与6个ID/5,000字节完整原话，不增加模型/Embedding调用。词面召回先保留最多2条匹配当前需求原话，再优先匹配的较早保留记忆原话，最后补聊天，仍4条/7000字节；原文/条件/否定/hash/版本、来源及当前更正围栏保持，历史不授予新操作。固定GLM9原66题2/2通过原生输入、持久重进及最初客厅来源撤回，见[二期AG-01合同](./xiaok-assistant-phase-2.zh-CN.md)与`tmp/xiaok-consult-02-glm9/coverage-review.json`。6张路由确认390×844逻辑图（编码348×752）已查看。Mini结构/样式/素材/固定文案/导航/API/权限与还原台账状态不变，非新还原。完整归档语义检索、复杂多房屋/复合字段、普通回复质量及整个AG-01/PPT/完整宿主/高屏/键盘/真机/真实微信/BLE和生产仍未完整验收；原checkpoint/用量/引用/保留期/真实回执保持。

**KB-4原C01知识修订同题回答：限定服务接入，整体Limited。** 原`packages/assistant/chat/chat`沿唯一批准`design-references/xiaok-p4b-public-sites-v1/README.md`的C01/C02/C05/U01入口、气泡、来源片和重进；Mini代码/样式/素材/导航/权限未改。后台0087问题/评测及0089私有批次/关联表复用原有效知识、试问/run/job/额度；每批1–20题、并发1–3、本人最近20批，所选企业三管理角色继承和本人试问私有边界不变，operations/batches/:id/cancel或resume沿原Worker/lease/预留，闭页继续、原键恢复/取消、未知费用reconciling。来源/问题/profile/config变化收起旧结果，不自动核对专业含义、复制私聊或创建施工事项。客户真实Agent独立验证：服务4次v67回答，原生串行10/10含两次实模、原题/同题修订276→278/来源展开/重进/撤回失效；四张390×844逻辑、348×752 PNG的C01截图已核route/stack并审看，[来源片](../tmp/xiaok-kb4-batches/native-citation.png)。数字显示另有原生9/9，两组不累加；测试会话/传输恢复、AI/员工停用、在途0。逐轮语义、Admin Chrome、源/包/命令、类型/完整构建限制见[二期合同](./xiaok-assistant-phase-2.zh-CN.md)及[还原台账](./miniprogram-design-restoration-ledger.zh-CN.md)。没有Mini批次管理页或新还原声明；完整专业客服、OCR/复杂格式、定时计划/生产规模/影子重建、完整宿主/真机/真实微信/BLE及生产仍Limited/未验证。

**KB-3原C01实况综合回答：限定实现，整体Limited。** `packages/assistant/chat/chat`保留已批准气泡、来源片、反馈/重试/重进、WXML/Less、字体/素材与导航。原真实服务在知识查询/短追问同轮补齐当前获权节点及材料快照，结合有效企业依据。`professional-hybrid-v5`在5片上限内将明确不适用阶段后移、优先覆盖不同文档，未知条件保留；诊断和C01共用授权/配置。prompt v38结合本人原话、正式v4主户型与向本人发布的现场记录解释条件，不把墙图当点位图、不从阶段认定检查完成。相关变更/撤回使派生历史和引用失效；取消/人工模式守卫不变。无新增小程序API、文件导入、权限或正式写入。PPT17/18/19/23/38及6/15精确映射、合成双阶段题、实模/原生证据及限制见[KB-3合同](./xiaok-assistant-phase-2.zh-CN.md)、[交接](./xiaok-assistant-handoff.zh-CN.md)。完整专业客服、图片质量结论、真机/真实微信/BLE及生产仍Limited/未验证。 当前原问题与模型检索词组成一次有界查询，保留明确对象，仅影响召回/排序，不把提问当项目事实或权限。 v5只使用数据库两路各前30条的实际排名，未入某一路不补排名或分数；原C01复用同一服务，小程序界面/API不变，不据此宣称完整专业语义通过。

**KB-2原件引用进入C01：限定实现，整体Limited。** 原`packages/assistant/chat/chat`沿同一Agent、HTTP与Worker读取已核对发布的DOCX/文字PDF/有界XLSX；唯一批准`design-references/xiaok-p4b-public-sites-v1/README.md`的C01/C02/U01气泡、来源与失效态保持，原26rpx `.sheet-helper`显示文件名和实际页/段落/表格或工作表/范围。decimal-v1/date-v1/time-v1引用原显示数字/单位、明确完整年月日及有界24小时时刻，原序列/格式/1900和1904仅作后台核对出处；纯时刻不隐藏整日、拒绝跨午夜/累计时长，不推断时区或项目安排，XLSX不伪造打印页或公式结果。v7模型投影保留完整原文/条件与可读定位，精确行/跨度代替重复摘录，歧义项保留；服务端沿完整原选择和持久身份校验当前版本/hash/受众/epoch及获权项目事实。精确获权time-v1时刻引用仅允许“24小时制”格式名，不放宽其他数值/期限/正式承诺。核对/索引/发布、客户公开/撤权及项目/私聊边界保持。时刻的实际服务/实模复跑、历史重进、受众失效、失败与工程限制见[二期KB-2合同](./xiaok-assistant-phase-2.zh-CN.md)，与既有日期/数字基线分开。原生窗口按用户选择暂停，历史原生证据不升级；六轮连续/更大上下文、完整专业语义、复杂格式/OCR、真机及生产仍Limited。无小程序标记、样式、资产、导航或API变更，未新增视觉还原。

PDF的`flow-paragraphs-v1`保守归组保留真实页码、完整条款和原提取顺序，沿现有文件来源接口消费，无小程序可见改动。用户指定《03 金螳螂家施工工艺手册2.0.pdf》整份9页/74片在开发企业2567以`staff_internal`保留，原后台摘录与客户受众隔离证据维持自身范围。 当前共用引用协议为`source-catalog-v1`，随`xiaok-renovation-v73`／`trusted-synthesis-v4`运行：模型仅选择本轮完整获权来源的`citationId`，服务端回填精确原文，短来源和长来源共用一种格式；长来源只附有界识别提示，完整正文、条件和定位保留。来源标题/文件名的明确版号与工程数值分开校验，金额、尺寸、计算、正式承诺、企业/参与者权限及撤回仍由原服务端守卫约束。公开DTO和持久引用仍为sourceId/quote，无迁移、公开API、角色或可见UI变化。v71仅1/6首稿、6/6修复后交付属于历史基线。当前实测范围、两个独立企业同一PDF、首稿/质量/隔离及失败保留见[二期合同](./xiaok-assistant-phase-2.zh-CN.md)；只用这一原件，已发布的合成主卫/厨房记录不算额外知识文档。测试副本结束撤回并停用测试身份，原内部文档293/版本297保持。原生窗口继续按用户选择暂停，整体Limited。 v73同源码双企业实模各5/6首稿（合计10/12），唯一修复后固定检查12/12、隔离与独立撤回9/9；独立语义8条限定可用、4条厨房回答需改，整体质量未全过。纯测75/75、隔离服务30/30、Mini契约73/73；完整报告保留首稿失败，不将修复率冒充首稿率。 冻结实模后另以新hash关闭“标题工程量误作版号”的通用守卫漏洞，完整纯测75/75及24份保存JSON离线回放通过，模型视图/原接受结果不变；不将旧30/73/44或实模重标为新运行，余下版号空格/引用覆盖/语义由Agent专项接续。

**KB-1专业条目与检索诊断：限定实现，整体Limited。** 原 `/assistant-knowledge` 正文/FAQ和C01继续使用同一知识服务、配置模型与LangGraph。0085在原知识版本增加不可变专业类型、主题、适用条件、前置/例外、来源版本/章节和服务端审校留痕，旧普通条目/hash兼容；后台原Drawer维护、索引、发布，未来稿不提前覆盖有效旧版。原混合检索在硬授权后提供匹配/缺失/明确不适用结果，当前只自动核对绑定房屋唯一获权活动项目的实际阶段，其他条件保持未知；登记的互斥口径冲突保留双方，不按上传时间择一。v26把企业依据、本人原话、正式v4主户型、当前节点和已发布现场记录共同用于自然解释，事实/建议/未知分开，普通说明不自动建事项或形成正式承诺。新 GET `/api/assistant/preview/runs/:id/diagnostics` 仅本人试问的当前管理者可读，回读实际候选/排名/上下文、配置、条件和合法排除计数；每次重验epoch、来源/profile/有效期/受众、草稿及实际阶段，变更后不外发旧诊断/派生结论。管理者三角色继承、租户/参与者/原件、原任务/用量/真人接管边界保持。小程序仍复用批准C01/C02/C05/U01气泡/来源片/失效态，不改WXML/Less/字号/插画/导航；后台沿原Ant Design/Admin Pro及共享反馈。限定PPT6/15/18/19/23/38映射、真实/模拟/合成证据及未测项查[二期KB-1合同](./xiaok-assistant-phase-2.zh-CN.md)和[交接](./xiaok-assistant-handoff.zh-CN.md)。文件入库/OCR/完整专业客服与P5仍Limited，构建/类型/独立打包阻碍不升级为发布通过。 查询侧现为有界 `renovation-terms-v1`：四组明确术语写法、既有签约意图和完整 C1/C2 代号空格规范化，每题最多8条规则/64个新增词；保留原问题，原词权重3、普通扩展1，原签约意图仍为3。原索引/profile/hash不变，不追加Embedding/LLM调用；同一实际trace保留命中规则/新增词/权重，材料、阶段及授权仍取原服务端事实。通用术语、自动条件与语义冲突仍未完成。

**当前P5/PPT38现场落实、正式解决关闭与原咨询回传：限定闭环Implemented，整体Limited。** 原S04以当前获同意的精确方案，关联同房间已核对发布、有完成内容且无待处理缺项的现场记录及照片原件；负责人/管理者明确记录落实，管理者分别正式解决、关闭并选择回传节选和是否开放这些原件。客户同意、普通回复、照片发布不自动推进正式状态，关闭不代表工程验收或付款。独立处理修订、原键恢复、真人延后/乱序去重、重新处理及换版/撤回/撤权守卫沿原事务/outbox/Worker，原件仅以JWT回传原授权咨询；移出或所需角色降权后再授权不复活原正式依据，member审计保留服务读取的previousRole/previousActive。prompt v20的query_followups只读实际结果并继承原施工来源链；方案决定来源按业务修订优先，晚到的原发布通知不改变当前决定的来源ID。不增表、迁移、页面、菜单、WXML、Less、插画或导航；复用批准S04/C01/C05/U01。当前接口、角色、状态、设计映射、复跑命令和验证边界见[二期当前合同](./xiaok-assistant-phase-2.zh-CN.md#当前p5ppt38现场落实与正式解决关闭)，证据tmp/xiaok-p5-resolution/。既有构建/类型/独立Mini打包限制保留，不声明完整P5、可发布或干净克隆全通过；未合并main或部署。本段当前限定范围优先于下文旧阶段“正式决定/落实关闭未交付”的描述，旧批次测试及未测记录仍按原范围保留。

**前批P5方案精确版本与决定：PPT19/23/38限定闭环Implemented，整体Limited。** 原S04 `packages/construction/chat/chat`上传一张本人出图原件，显式发布绑定事项/来源的不可变V版本、前版、差异及明确费用/工期变化；原记录/事项/资料/方案修订限制写入。原C01 `packages/assistant/chat/chat`复用批准C05/U01卡、节选/原件/动作/反馈与既有原生编辑确认，支持完整预览、同意、拒绝、稍后、要求修改；原件未加载不启用同意，普通“好/可以”不批准。不改Less、插画、导航或页面。GET `/api/miniprogram/assistant/conversations/:cid/plans/:versionId`、GET `…/media`及POST `…/{preview,approve,decline,request-changes,defer}`继续本人咨询/租户/参与者隔离、no-store和JWT原件保护。原操作日志精确回执支持丢包/重进，身份切换隔离；旧版不能复活批准。原Worker真人期间延后，只投递原需求授权咨询一次；来源/角色/模型派生回答动态重验。prompt v19通过`query_followups`查真实版本/影响/决定，效果图发布保持独立。自动算价、CAD/PDF、事项关闭/落实/验收、外部投递未交付。合同/状态/设计映射与最终验收见[二期](./xiaok-assistant-phase-2.zh-CN.md#当前p5正式方案精确版本差异与客户决定)、`tmp/xiaok-p5/`及唯一还原台账；未生产发布。

**D4自然语言资料共享：限定闭环Implemented，完整D4仍Limited。** C01先持久展示精确项目／房间、原文需求节选或紧邻本人点位图的私有预览；只有客户明确同意已展示的项目团队范围才写入原grant。指定个人、普通确认词、疑问、更正和收件限制不静默扩大授权。团队含有效设计师／经理／师傅／observer及获权enterprise_admin/admin/super_admin，当前不支持仅某个人可见。独立原文／确认hash、30分钟待确认期限、实时范围／版本重验、原键恢复及撤回后的派生读取／原件限制保留。撤回授权以完整客户原话为准，模型摘句不能省略疑问、否定或额外条件。定向撤回按本人原咨询实际项目／房间／资料类型或明确资料号解析，不能套用最近预览或模型选错的ID；带收件表达的旧命令进入同一私有预览，普通缺图校验保持。无新路由／表／迁移、Agent或知识管线；沿用C01／S04结构、样式、素材与导航。实际检查、原失败及证据复用见[二期合同](./xiaok-assistant-phase-2.zh-CN.md#当前d4自然语言资料共享)、`tmp/d4-natural-sharing-20261028/final-checks.json`。

**PPT23/P4A当前更正、获权来源与事项接续：限定Implemented，整体Limited。** 沿用C01/C02/C05/U01及S04/PPT22/38组件。prompt v67区分真实私聊更正、早先共享内容、精确正式决定及本次查询缺项；原`record_need`原子写入/回执、独立需求保留及人数来源不可用投影继续生效。在来源/引文/数值/正式承诺校验之后，有限表达检查按服务端原触发问题和当前来源元数据，识别已覆盖的重复确认、量测缺项范围扩大、把不可用人数当待决定、主动给单/双人条件选项或点位预留建议、把未分配当现实无人处理、从待核对推断不能施工及内部术语。本轮问题明确唯一房间时，后续省略房间的句子沿该对象检查，歧义不猜；用户明确要求假设/比较/重新补充时仍可讨论，不恢复失效值、不授权业务动作。私聊真实保存与正式版未变分别说明，不以“我不替你改需求”否认更正。修复前与最终提交使用同一问题范围、原引文及真实回执；仍限一次修复/四轮/48,000 UTF-8文字字节，修复禁用业务工具并重验来源/人工模式。本批无新增表、迁移、API、权限、菜单或Mini结构/样式/素材/导航。检查只覆盖已知表达形式，非通用语义裁判。当前实际检查、实模/原生证据、保留失败及限制见[二期合同](./xiaok-assistant-phase-2.zh-CN.md)、[交接](./xiaok-assistant-handoff.zh-CN.md)；未生产发布。 `current-turn-sources-v5`仅在明确问当前人数能否确认/哪些需求可沿用时，按已获权的当前来源标记，在既有系统消息追加固定回答范围；不把房间名、原话或值插入可信指令，不改原文、工具配对、持久快照或权限。实际使用以`agent_model.input_summary.responseScope`记录。原文只标尺寸待核对时，不能改说历史共享人数也待核对；仍限同一次修复和原预算。 v67最终证据：55/55单元、2/2隔离服务、92/92 Mini确定性及22/22 Stable原生检查（四条实际模型回答）；两条定向服务撤回回答及一次前置更正另作逐轮审读。15张原生截图已审看，精确合成夹具测试AI/员工及在途已停用，费用未知继续原对账口径；不代表AG-01压缩/召回或完整PPT验收。

原`query_materials`、`query_followups`和绑定房屋的`search_knowledge`复用获权适配器。知识查询现把`synthesis.bound_followups.v1`与材料/实际施工共同持久化，携带原issueId/revision、当前等待对象/负责人及精确来源版本；恢复、后续模型调用、提交、历史及人工接续继续重验。需求补充与已回传现场事项分别解释，负责人姓名不授予直接联系渠道。当前意向、旧共享参考、团队关联核对及精确正式决定不混用；已知靠窗意向直接沿用，可量测坐标/检查依据未查到只表示本轮未知，不推成现实没有。阶段电话缺失只限制该电话入口。sources-v4模型视图在原48,000 UTF-8文字字节预算内保留标准工具配对、完整原文/权限元数据，并以别名映射合并完全相同的重复来源；持久快照仍完整。原grant/原件/版本/撤回、强制RLS、企业/客户/原咨询/项目/房间、三类管理者继承、outbox/Worker/用量和真人围栏保持，无新表/迁移/API路由/菜单、Mini结构/样式/素材/导航或权限扩张。综合及普通自由回答在最终提交事务共用本轮真实记忆/偏好操作回执检查，旧事实和引文不能替代保存成功；检查覆盖已记录、已按更正记为/更新为等已知回执形式，不保证任意改写或自然语言逐字段语义。当前投影仍不发送图像像素。合同、实际成功/失败、合成与实模/原生证据及限制见[二期](./xiaok-assistant-phase-2.zh-CN.md#当前p3bp4a客户更正与原事项接续)、[交接](./xiaok-assistant-handoff.zh-CN.md)及`tmp/xiaok-corrections-continuity/`。完整客服/PPT、图内识读、Chrome/完整宿主光学/高屏/键盘/真机/真实微信/BLE及生产仍Limited/未验；前批证据单独保留。

**P2M.3资料关联与P3B持续接续基础：限定闭环Implemented，整体Limited。** 原`packages/assistant/chat/chat`使用`query_materials`组合明确本人房屋的原话、正式v4主户型及本人可见现场发布版本；多房屋/项目/重名房间先澄清，同名不冒充已核验映射；当前获权参考图、明确团队核对与精确正式来源见上方PPT23记录；同一房屋多项目或重名房间当前停在待员工核对，工具尚无项目/楼层选择器。`query_followups`读取原节点问题的稳定issueId/revision及等待状态；有效原话补充写`construction.need.progress.v1`，S01原授权设计师的明确核对推进同一事项，普通“收到”或回复不自动解决/批准。未分配如实显示；节点/房间/客户权限变化使旧事项、派生回答和模型记忆失效。沿用现有outbox、租约、幂等、来源和用量，不增表/迁移/API，不改WXML/Less/图片/导航或扩大私聊/项目权限；该批prompt v17，v18为其历史回传接续；当前prompt/来源合同见上方记录。PPT15/16/23/35/37已实际读取；历史基础检查为资料7/7、事项6/6加提交后租约恢复1/1、原生主链9/9加最终文字4/4、相关Agent12通过/7配置跳过、施工67项：64通过、3配置跳过、0失败、Mini定向63/63、Admin lint0错误/30警告。施工一次未完成记录保留，同一组文件已分组顺序跑完。量房Phase0既有基线仍7通过/1失败，小程序全量未重跑；tsc仍293条诊断，首尾错误集合一致且触及文件无诊断。该基础批次未执行生产构建、完整视觉/真机/真实微信/BLE验证；当前检查见上。完整PPT23共享资料卡及通用事件路由仍属后续；精确正式来源接入见上方当前记录，正式决定/落实关闭沿原P5合同，获权同事项回传见当前PPT23记录；共享现场事项接手/转交/回复/取消见本轮P4A记录，未生产发布。完整合同与最终检查见[二期当前记录](./xiaok-assistant-phase-2.zh-CN.md)。

C05回执与业主决定：**限定修复Implemented，P4B整体Limited。** 原C01/C05卡核对原动作/工地/不可变版本/revision+1/状态及完整预览；异常回执保留原请求/键。来源/访问撤销后的核对由既有U01清卡、展开状态及媒体路径。不改结构/样式/素材/导航，设计源仍为design-references/xiaok-p4b-public-sites-v1/README.md。最终原生12/12、真实HTTP7/7覆盖查看/稍后/同意/拒绝/重进/已提交回包丢失/审核/撤回/新版本/切身份，以及访问撤销后同键preview实际409；原访问、身份、传输和存储方法均恢复、测试操作账号禁用。定向63/63、施工67项64通过/3跳过及lint0错误/30既有警告通过；小程序全量1967项1966通过/1既有量房Phase0审计失败，保留不改。C05完整宿主胶囊/光学/高屏/键盘、真实微信/真机及生产验收仍未验证；用户要求本批后暂停。[交接](./xiaok-assistant-handoff.zh-CN.md)。

P4B C03原生后续复核（2026-10-17）：用户解除窗口占用后，390×844下11个环境/业务步骤全部通过，覆盖实际输入/清空、点卡、双Tab、返回、精确版本重进、文字工地、撤回404/重试及无效版本刷新不增加请求（15→15）。原生请求13次200、2次404；仅企业2404的内存网络转向已恢复并读回false，模拟器回到首页。定向48/48、真实localhost公开HTTP8/8通过，含no-store、已知私人字段排除、JPEG及撤回/错误版本404。本批仅验证，不改运行代码/API/数据/权限合同、不写数据库；C05认证决定、完整光学/高屏/键盘/真机及生产发布仍未验证，P4B整体Limited。上批1950/1950未重跑。证据和下一精确入口见[交接](./xiaok-assistant-handoff.zh-CN.md)。

**P4B公开工地限定闭环 Implemented，整体 Limited。** 用户“确认”批准C03/C05/S07后实施。C01原咨询新增真实片区推荐/浏览及具体版本决定卡；`packages/construction/public-sites/public-sites`、`packages/construction/public-site/public-site`匿名围观照片/服务节选并返回本人私聊。后台`/construction-projects`原Drawer第三个“公开材料”Tab提供来源选择/原文脱敏/照片不透明遮挡/完整预览/保存/送业主/审核公开/退回/下架真实写入。cookie所选企业`/api/construction/projects/:id/public-materials/*`、本人bearer`/api/miniprogram/assistant/conversations/:cid/public-sites/*`和匿名`/api/public/construction/:enterpriseId/*`共享版本与实时源权限；匿名不泄露私人ID/原图，独立媒体no-store。0084新增`construction_public_sites/versions/sources/media/audits`，施工20表强制RLS并覆盖企业清理。业主看全并明确同意这一版后，enterprise_admin/admin/super_admin再审核，平台管理无需入职/项目成员；管理者不代业主同意，也不获原私聊权限。新版本/撤回/来源失效收紧列表、详情、媒体、Agent和接续引用；step1003保存只读公开依赖，prompt v15。

完整入口/API/数据/角色/状态/设计/手测见[总计划3.7](./xiaok-assistant-roadmap.zh-CN.md#37-p4b-公开工地具体授权与审核限定闭环)。独立ImageGen PNG`miniprogram/packages/construction/assets/xiaok-public-sites.png`为420×282、36,161字节，未切片整页。9/9注入及9/9真实DeepSeek、客户端6/6、原聊天27/27、离线编译和隔离生产构建通过；C03原生围观/恢复已按3.8验证；完整光学/高屏/键盘、C05认证决定及后台剩余验收未验证、非阻塞。无距离、自动人物识别脱敏、直播/视频/外部推送，未生产发布。

**默认测试规则（用户于2026-10-17确认）：** 后续由Codex使用已验证的稳定版
`2.02.2608080`（`D:\微信开发工具\微信web开发者工具`）、官方
`miniprogram-automator@0.13.0`、基础库`3.17.2`及`390x844`逻辑视口执行小程序测试。
原安装替换后已通过13/13项基础自动化检查，覆盖页面数据、元素定位、真实点击与输入、
导航和截图；这不代表未测业务流程已验收。后续按此方式及`AGENTS.md`中的窗口、路由和
重新编译规则执行，无需再次逐项授权自动化，也不再要求用户人工手测或提供验收截图。
Codex自动捕获并核对受影响的原生页面；真机/BLE等无法覆盖的检查如实记为未验证，
不转成人工手测任务。此规则取代下文早期的自动化取消和人工QA要求，历史缺失证据仍为
未验证；产品行为与部署授权边界不变。

**会话恢复：Implemented。** 服务端读取身份时的数据库异常不再被误判为登录失效。
支持状态码的接口返回503，沿用客户端既有错误/重试路径并保留有效会话；旧登录或旧身份
迟到返回的401也不会清除当前会话，当前会话真实无效或已撤销时仍拒绝鉴权。
运行路径复用客户资料表单现有错误处理及`utils/api.js`请求层，
不改变WXML、Less、素材、路由入口或权限边界。

**原生回归修复：Implemented。** 客户资料保存时，小区/风格/城市的可空字段保留JSON
`null`，不再写成字符串`"null"`并出现在线索卡片既有风格标签中。AI结果链接缺少任务ID时
退出加载，复用既有设计Tab返回路径。员工灵感图库等待签名身份恢复，并在读取前检查既有
`staff.design`路由能力；客户/推广人误入时返回既有角色首页且保留登录态。
`GET /api/inspirations`支持签名设计师能力，并通过共用小程序事务限定本企业；
客户/推广人请求返回403，后台Cookie写入保持原契约。施工身份可读取既有数字企业ID的
公开品牌接口，线索/财务/量房/后台接口仍拒绝。设计源沿用角色壳线索卡片、结果页返回、
身份导航、既有灵感图库和施工品牌导航；上述行为修正保留WXML、Less与素材。
工地聊天另按PPT22/38及既有尺寸声明恢复紧凑按钮：返回`42rpx`、输入栏图标按钮`66rpx`、
发送`70rpx`。显式Mini按钮尺寸和局部选择器避免微信默认184px按钮宽度将品牌挤入胶囊、
将发送键挤出屏幕。不换素材/设计源，不改API、发布或权限边界。

正式户型恢复另阻止在云端墙图仍加载时持久化初始化空画布，避免加载中退出后产生较新的
空备份，并在重进时遮住已保存墙图。真实本地几何及载入后主动清空仍正常持久化；
图校验、v4序列化和API权限保持不变。

**P4A工地共享对话与发布/关注限定闭环Implemented，整体Limited。** 共用工地详情进入`packages/construction/chat/chat?projectId=…`；每工地一份成员共享对话，真实作者/原话/鉴权照片/整理草稿/版本均真实保存。`/api/miniprogram/construction/projects/:id/chat/*`覆盖消息、媒体、核对/发布/更正/撤回/重试、版本及原键回执核对。observer只读，作者只改本人，经理/负责人核对他人；向当前业主开放须获权管理者明确选择。admin/super_admin继承所选企业负责人权限，无须成为项目成员。0083新增6张施工表及project_collaboration权限适配，15表强制RLS，企业重置/删除覆盖。复用现有Worker/provider/配额/用量/未知调用恢复，模型只出草稿；原咨询查询、动态及图片重验精确发布版本，明确关注/取消有真实回执和去重outbox，页面关闭后仍由Worker写入站内咨询，人工模式不插话。更正/撤回/成员或客户撤权收紧旧资料。PPT22/38及C01/U01为设计源；独立ImageGen透明PNG为37,896字节，无整页切片。公开工地按3.7交付；ASR/视频/外部微信推送及正式批准未实现；原生390×844/高屏/键盘与人工验收待测、非阻塞，未生产发布。完整API/数据/状态/元素/验证/手测见[总计划3.5](./xiaok-assistant-roadmap.zh-CN.md#35-p4a-工地共享小k对话记录发布与关注限定闭环)及二期契约。 原S04“跟进记录123：明确处理要求”现将requestText、requestMessageId、requestHash存入同一opened/progress outbox payload，绑定本项目/作者的实际请求消息，并与未改写的现场报告来源分开。转交、回复、重进及显式重新核对保留请求；重复跟进记录不覆盖原要求或另建事项。原请求离开近期消息页后，现有文字响应仍可查询请求原话。请求原消息缺失/变化则事项来源失效、旧要求不再展示；无这些可选字段的历史事项保持原形。客户query_followups和投递仍只开放管理者选定节选，不复制内部请求/回复。原记录/事项/资料修订、有效成员/observer/owner-admin-super_admin、租户/同意/撤回及幂等围栏保持；无新路由/schema/表/迁移、角色授权、Agent/模型/提示词或KnowledgeRetriever/Evidence管线。  第二次原生随后发现真实客户端缺口：服务端已提供翻页原记录版本，SiteClient却只按可见卡片重建records，导致重新核对409。现sourceVersions为后续命令合并获权服务端records；待确认body/键/版本仍冻结，版本历史sheet独立。Mini先失败后通过回归覆盖此点。前9/25/98及第二次原生部分通过/五图保留0801bb82原源码；最终9/4/99仅重跑组合客户端受影响服务兼容及完整相关单元/Mini/lint/types，并用新第三次原生验收，不重评旧失败。 本批9施工单元/4隔离服务/99Mini、lint及11原生检查/7图通过，类型292/涉及0；详细绑定/限制见[二期合同](./xiaok-assistant-phase-2.zh-CN.md)及`tmp/xiaok-site-request-context/`，专业咨询原阻塞不变。

**D4施工记录打回补拍：Implemented。** S04沿原PPT22/38（853×1844→390×844）的记录卡、原因弹层、照片输入、反馈和版本片，不改导航、Less或素材。项目经理及当前所选企业的enterprise_admin/admin/super_admin可通过既有`/api/{miniprogram/}construction/projects/:id/chat/records/:recordId/request_changes`填写必填requirements（1–1000字符），将草稿/发布记录置为changes_requested并即时撤销业主发布。作者以`…/resubmit`提交expectedVersion、text、1–4张本人新上传且未使用的照片；同一原记录链的旧图hash拒绝。0098仅扩展原记录及版本动作，resubmission_of_id关联上次提交、original_record_id关联最初记录，唯一子提交保留每轮原话、照片和审计，普通消息不会代为消除补拍要求。补交沿原Worker生成草稿，显示待复审，作者不能向内部或业主自行发布，管理者可再打回或明确核对发布。项目对话回读持续带出尚未补交的待补拍及未审核补交，最近100条未完待办不因近期翻页隐藏；原记录与版本可看同链最近100个版本及原件，早期原话和照片仍可翻页查看。项目/租户/有效成员/observer、原键恢复、版本、配额和未知用量守卫保留；成员移除后读写/图片撤权。范围与实际证据见[二期当前补拍合同](./xiaok-assistant-phase-2.zh-CN.md#当前d4施工记录打回补拍)、`tmp/construction-retake-20261028/`。仅本项目内可见待办，不含微信外部推送、真机拍照真实性、ASR、正式节点/完工/验收或生产部署；D4其他资料接续与D2既有阻塞不改判。 最终限定验收：service-08 2/2，native-25原生7/7、三代原话/私有照片实际回看及撤权清理，drift[]、新增模型0次；复用两项实际Qwen草稿、schema5/5、Mini24/24和未变产品范围的生产构建证据。定向类型/lint通过；共享驱动显式隔离3112并通过官方CLI编译，无Computer Use。原失败/部分通过批次、费用与限制见二期当前合同。

**既有小K UI回查修正：代码Implemented，原生视觉待验收。** 用户要求检查并重做此前偏离源稿的UI；当前`packages/assistant/chat/chat`按C01/C02取消额外箭头/常驻实现说明，以品牌返回；选图直发保持，移除无入口的客户资料分类表。`packages/assistant/handoff/handoff?staff=1`按S01-01/02/B01恢复品牌/角色、接待标题/IP、队列头像/状态/实际数量/分栏空态；接手后同聊有作者/头像、独立消息滚动和胶囊输入，原话定位消息区、键盘不重复留底。接管前仍只元数据，不伪造姓名/肖像；图片按钮查已授权资料，未增加员工发图/ASR。`packages/construction/projects/projects`按PPT26 manager.png恢复品牌/角色/章节/卡内操作，保留真实节点/分工，不填示例图或开放未完成功能。路由/API/数据模型/租户/私聊/接管/项目成员/幂等及正式v4写入不变；工地共享对话单独归P4A，不复用业主私聊。场景PNG复用原独立生成文件，复制到`packages/construction/assets/xiaok-project-scene.png`（780×380、51,118字节），避免跨分包资源；无截图切片/新生成图。总计划3.6、二期及双语还原台账已同步；72项Mini回归、离线86WXML+2WXS/90样式/235JS/92JSON及24例辅助布局检查通过。原生390×844/高屏/胶囊/光学/键盘/实际操作待人工、非阻塞；未操作DevTools或部署。下方P3B“未改布局”等描述仅指其当时业务批次，当前UI以本段为准。

**P3B节点补问限定闭环Implemented，整体Limited。** 保留packages/assistant/chat/chat、packages/assistant/handoff/handoff?staff=1及经理实际更新节点的packages/construction/projects/projects。原房屋咨询最多收到一项可跳过、未知且未问的节点补问，可回复/发图、换话题或请求员工，持久重进不重问；默认不提问，跳过已知/暂缓需求，多房屋不猜关联。节点/配置/房间/客户范围变化使原问题及派生答复失效。批准来源为S01/B01已有核对编辑器、C01/C02/C05/U01气泡/输入/不可用/负责人/结束/恢复组件，无新页面或小程序配置页。原接续授权、租户/本人会话/项目可见性、有效员工/成员、媒体撤权与幂等边界保持，工地身份不自动读私聊。节点变化后，原补问、依赖记忆和派生AI回复仍不可用。客户当前请求绑定的接续授权有效时，S01已有POST `/api/miniprogram/assistant/handoffs/:id`的correct动作可明确把同一待核对事项接续到不同的当前阶段；outbox修订绑定原客户消息/事实hash、当前项目/房间/节点/进度/配置、核对人及不可变核对事件。历史进展必须凭既有成功需求写入回执，缺失或变化的证据拒绝接续。query_followups只返回待核对及有效负责人，旧值、问题和来源ID留空；新的有效客户补充可沿同事项推进，再次范围变化继续撤回。内部核对不代表正式批准或解决，员工仍须另行明确发送才把结果回到原咨询。 等待/接管不插话，不写预约/正式墙图或正式方案/费用/工期批准。固定源码/测试/配置33f08fb06d15910f76f4df6730825ebe847e0e7259e54b4150da81f93008d81f/2270项（含保留的原脏依赖）下，3跨阶段服务/8兼容/387Agent单元/99Mini及涉及lint通过；全量tsc292/涉及0与原基线逐字节相同。Stable2.02.2608080/SDK0.13.0/base3.17.2串行10项原生检查通过，九张S01/C01原图已逐张查看（390×844，PNG348×752）。真实核对/回传、丢回执原键恢复、重进、跨客户租户拒绝、再次换节点撤回及安全退出通过。只有1个明确标记合成前置run，实际provider attempt/usage均0，不作模型质量声明。原失败/中断/类型/夹具/原生脚本窗口在tmp/xiaok-need-stage-recheck/分开保留；最终见verification.json、semantic-review.json及native-attempt-3/。transport/auth恢复，测试AI/身份/员工停用撤权，队列/锁/controller归零。无新路由/schema/表/角色、Agent/模型/提示词或KnowledgeRetriever/Evidence管线，小程序结构/样式/素材/固定文案/导航及还原完成状态不变。专业咨询/v119/F-06/F-07仍Limited，真机/真实微信/完整宿主光学及生产仍未验。 来源/状态规则见[总计划3.4](./xiaok-assistant-roadmap.zh-CN.md#34-p3b-节点需求补问与原聊天核对限定闭环)及[二期合同](./xiaok-assistant-phase-2.zh-CN.md)。

**P3A施工入驻与三端共用云工地基础闭环Implemented，整体Limited。** 设计师、施工员工和老板从“我的→云工地”进入同一packages/construction/projects/projects页面，施工身份登录直接进入；保留设计师/老板原工作台。前两者只读有效关联工地，老板看本企业工地；经理可更新实际节点、分配普通成员/阶段，指定经理仅限负责人。ej_员工入驻新增construction_staff及姓名/工种，复用手机号授权、真实写入、单企业冲突/重复入驻、签名身份与跨页恢复；企业名册新增施工角色，不参与量房/设计派单、获客或分佣。GET /api/miniprogram/construction/projects、GET …/:id和POST …/:id/{member,contact,progress}返回真实列表/分工/节点/权限；空态待分配，加载/失败/重试复用U01，写操作按企业/员工持久保存原expectedVersion/Idempotency-Key，未知回执重进核对，隐藏/切身份拒绝迟到数据。contact保存员工关联和明确主要联系人，聊天原“联系管家”实时重验当前有效员工电话；停用、移出、撤销分工及旧来源均不能拨号，历史手填电话不兜底。微信手机号入口无需先到Web改密，密码入口及Web改密保护保留。模型不接收号码，不写施工/量房预约，不开放客户私聊、正式墙图或财务权限；0080–0082双库核验9表强制RLS/角色约束/迁移哈希通过。设计源、935×1683源图映射、390×844元素台账、17,723字节独立透明PNG映射、状态/限制及手测见[总计划3.3](./xiaok-assistant-roadmap.zh-CN.md#construction-staff-contract)、二期及双语还原台账；P4A现场记录/照片按3.5实施；P6简报、语音/视频及外部推送仍未实现。原生390×844/高屏/胶囊与真实拨号待人工验收、非开发阻塞；未控制DevTools或部署生产。 施工身份保留本人资料/头像/密码接口及既有本人/签名校验；原生下拉刷新、冲突后读取最新版本和按token校验写回执，避免过期资料或跨身份结果。追加真实数据库8/8、身份/凭据58/58、小程序聚焦82/82及离线模板/样式编译通过；小程序全量1920/1921，唯一既有失败为开发地址断言与当前配置不一致。

**P2C.1后台作品维护/审核Implemented，高德真实联调Limited；P2C.2限定客户闭环Implemented。** `/case-publishing`、`/case-publishing/[id]`沿用既有Ant Design/Admin Pro和`design-references/designer-portfolio-publishing-v1/`管理/编辑稿。独立`case-publishing`菜单允许在职设计师仅维护本企业本人作品，企业/平台管理员审核、退回、发布和下架，不授予整店知识或其他设计师资料权。效果/实拍分组、AI/样板间标记、排序/封面、许可、可选核验小区、本人作品集资料和审核版本经真实服务持久化；已发布内容修改生成新草稿，审核前旧公开版保持有效。`/api/portfolio/*`使用租户事务、当前角色/菜单重查、版本冲突与幂等。0071/0072新增8张强制RLS的`portfolio_*`表、租户/作者复合外键、公开版本/图片不可变约束、供应商计数/冷却及选填地图授权备注（0079移除原期限门槛）；企业重置/删除已包含新数据。小区查询仅服务端，经后台/map-settings维护各自独立的高德/天地图凭据、权益及测试结果，显式切换默认供应商，候选绑定供应商/配置版本。高德Implemented（真实宜昌连接返回10条候选）；天地图Limited（适配/模拟回归已实现，独立Key、权益及真实召回待测）。已保存Key并显式开启即可检索/绑定，授权备注选填且不拦截小区读取，开发高德已开启；0078区分供应商身份、日计数和冷却，短窗限流继续共享。小程序路由/UI及租户/来源撤权边界不变，相关50/50回归通过，原生/人工验收待测，无采购。会话绑定的`GET /api/miniprogram/assistant/conversations/:id/portfolio/{recommendations,designers/:authorId,works/:workId,works/:workId/assets/:assetId}`提供同小区+风格/同城+风格、最多3位去重设计师、精确当前版本私有JPEG及撤回校验；公开DTO不下发许可凭据和内部文件。客户P2C.2限定范围已Implemented：C01推荐卡/查看主页→`packages/assistant/designer/designer`→`packages/assistant/work/work`→返回同一咨询，沿用PPT2/3主页与已批准C01/共享状态。推荐无参时优先采用明确房屋城市，否则使用本人授权的有效定位；风格/户型可空，地区歧义不猜；显式API仍支持核验小区优先。原生详情按效果图/实拍分组，标明AI/样板间；明确喜欢/不合适经POST `works/:workId/preference`写入会话`portfolioPreferences`与用户消息，保留精确公开版本、原话来源及更正链，expectedVersion和Idempotency-Key保护重试。POST `works/:workId/contact`复用站内接续并另存handoff.source.portfolio的作品/版本/作者意向，已有负责人冲突409，不改线索/归属/分佣或取得电话授权。POST `works/:workId/share`签发7天`portfolioEntry`，接收者经entry-context建立/恢复本人咨询，不携带客户、原会话、手机号或私有图片；C01/设计室/详情均固定品牌PNG转发封面。图片支持鉴权base64传输；隐藏、撤权或切换身份清理临时文件，重进/预览/分享重查当前许可。主页生成独立透明PNG（1050×553、140,866字节），图标沿用Lucide；映射、元素台账和手测见二期及双语还原台账。原生390×844/高屏视觉与人工验收待测、非阻塞；未操作Chrome/DevTools、未部署生产。新作品尚未接入旧`recommend_references`工具，也未静默迁移旧参考案例。契约、验证和待执行手测见[二期](./xiaok-assistant-phase-2.zh-CN.md#p2c1后台发布与p2c2公开读取基础)。 D3公开作品联系兼容在本次有界真实服务路径内Implemented，完整D3仍Limited。原签名作品审核入口曾409 handoff_review_required；现将明确联系按钮接入既有HandoffWorkflow，服务端专有作品/版本/作者来源及公开版/负责人/等待接待人实时guard绑定幂等摘要。旧body/hash重放与普通审核consent/expectedVersion仍严格；无新增REST body、电话同意、客户建档/归属/分佣写入或Agent。2026-10-27 05:43UTC用户明确批准仅本次使用既有隔离owner vector_probe_owner，范围仅localhost:55432/xiaok_embedding_eval。已核实端点/库OID16389/角色，补齐缺失0095头像及已安装PostgresSaver的6步checkpoint迁移，头像强制租户RLS，应用仅获精确表/对应序列及schema USAGE权限。sfp_app仍非superuser/非BYPASSRLS，无app/review/数据库CREATE；未改密码、认证、全局角色、持久凭据或原5432库。固定8项真实隔离服务通过：签名/公司来源、同咨询联系与重进、无手机号作者接手回复、原客户归属不变、丢响应原checkpoint/原键恢复、取消不复活、暂停时来源/负责人撤销、旧版/普通审核守卫、401/404/租户拒绝及等待作者冲突。tmp/xiaok-d3-portfolio-contact-20261027-ready/绑定326文件、drift[]及schema/配置不变；本批合成AI设置已禁用、用户上下文已撤销、queued/running jobs已取消、所属checkpoint线程已删除，供应商attempt/外部fetch0。原409、42P01、28P01失败独立保留；原32及后39客户端检查保持原绑定。4个代码文件未变，复用既有定向lint0/原54类型诊断，不扩额外矩阵。真实的是handler/JWT/数据库/发布/图写入；未宣称监听HTTP服务、原生、模型/embedding语义或生产验收。见tmp/d3-connection-repair-20261027/handoff.json。

**P2C.3设计室增强、作品详情、3D回退与聊天推荐：限定开发/评测范围Implemented，整体Limited。** `packages/assistant/designer/designer`（D-01 v2）增加本人同意头像/姓名首字、职业行、户型/风格专长及3D角标。`packages/assistant/work/work`（D-02 v2）增加3D入口、空间筛选、效果/实拍分组及设计亮点/材料/配色；只向`packages/assistant/tour-view/tour-view`（D-03b）传`conversationId/workId/versionId/index`，由后者在鉴权作品读取成功后挂载真实URL的`web-view`；业务域名或网络不可用时提供复制链接/重试/返回，不宣称在线3D通过。C01（D-04）最多展示3位推荐设计师，含真实头像回退、封面、3D角标、理由及风格/户型/城市，最新助手消息已有卡时隐藏旧底部推荐块，读取时重验并剔除失效卡。3D图标为独立Lucide1.8.0 ISC PNG，无WebP、复合切片或打包第三方看房画面，助手分包保持2MB内。Stable DevTools2.02.2608080在390×844通过自然语言验证卡片→作品81/版本103→偏好/重进及3D回退；完整宿主光学/胶囊、真机、真实微信登录和真实第三方`web-view`仍未验，不部署生产。

**P2A.3授权参考：PPT4–6、14页范围Implemented；P2C：内容入口基础Limited。** 既有/assistant-knowledge支持reference_case草稿，维护出处/作者、授权凭据、标签和独立压缩JPEG，按既有权限及不可变版本索引/发布/撤回。小程序C01聊天最多推荐3例，在原引用面板读取授权图片/出处，持久化明确喜欢/不合适原话及更正链，撤回后引用和相关员工/AI衍生文本失效；浏览不等于选择或摘要收藏。新增POST /api/assistant/knowledge/documents/:id/share签发7天referenceEntry；唯一entry-context入口及原生转发保存内容/渠道来源，不携带私聊、不建线索、不改归属或分佣；失效内容回到普通咨询。当前Admin复制为公司来源，API可绑定经校验的既有活动/推广码。保留平台所选企业/显式企业负责人知识权限及S01当前接待人边界。开发主库/隔离库0070迁移哈希、列及强制RLS通过。当前运行xiaok-renovation-v10，下文v9段落是历史基线证据。原生视觉/手测待执行，未使用DevTools自动化或生产部署。后续后台先行作品实施及客户入口限制见上方P2C当前记录。测试、限制和手测见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。

**P2A.3之前的P2M v9基线：Limited。** 开发环境localhost:3006／远端开发数据库的企业1454使用DeepSeek官方deepseek-flash，langgraph-v1、图片/工具启用，xiaok-renovation-v9、policy_version=3。回读一致、在途0、Worker健康200/fresh。证据：结构160/160、合成图片语义16/16、扩展会话44/44段（114/114轮）、隔离Worker19/19、纯测试63/63通过。未明确房间的指代先澄清再写记忆；通用预算/图片证据边界问答避免无谓转入企业知识检索。素材为2位作者的5张公开CC0照片及3种确定性降质变体，具有代表性的装修质量及原生人工验收仍待验证。现有路由/API/角色、C01/C02/S01/U01界面及正式量房写入保持，无生产发布。本段优先于下文历史仅规则/不能识图描述；未选择新Agent的企业仍走旧执行器。方法、证据及限制见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。

当前五类提示为批准的固定话术；Admin主动引导开关继续生效，自定义开场/顺序/选项保留为兼容配置，暂不应用当前客户聊天。后台说明及保存反馈已同步，避免把兼容配置误报为已应用。

P2S 第一批 C01/C02/S01/U01 的聊天与接待主链路 **Implemented**，自动理解整体 **Limited**：以用户本次明确批准的 `design-references/xiaok-assistant-chat-first-batch1-v1/single-screen/` 11张主稿和共享状态规则实施。客户 `packages/assistant/chat/chat` 直接聊天、发图、按原话自动保存草稿；五类轻引导遇到话题跳转后暂停，不自动回到未答题；回顾在聊天中按需返回。主路径不再展示摘要确认、完成率或图片分类表单，旧摘要页面/API保留兼容。识别采用有界中文规则，明确房间分开保留，含糊代词/复杂冲突仍需设计师核实，不宣称通用语义理解或客户批准。

客户按钮或明确“请设计师接着聊”直接进入等待，不增加资料分享同意页；请求 API 为 `POST /api/miniprogram/assistant/conversations/:id/handoff`，普通请求只需 `{action:'request'}`。等待可补充文字/图片且不创建AI任务；接管后小K暂停；取消/结束恢复AI，员工退出回等待。正式报价/具体工期共用“请设计师接着聊”建议，普通时间用消息沟通，不创建预约。电话仍须单独明确同意；不自动建档或改变分佣。

员工入口仍为 `packages/assistant/handoff/handoff?staff=1`，旧客户接续链接返回原聊天。接管前仅返回分派元数据，不开放完整聊天/摘要/图片。成功抢接后通过同会话“对话 / 需求 / 资料”回复、追溯原话、保存内部修正、图片分类/房间/授权正式户型关联，以及核对后关联已有服务档案。员工/后台 `POST .../handoffs/:id` 增加 `correct/associate/link`，带 `expectedVersion` 和幂等键；每次重验租户、当前员工、请求成员及客户/员工共同可访问的档案。修正和图片关联保存于 `entry_snapshot.handoff.packet`，附时间/操作者/原话来源；自动摘要为独立draft版本，历史confirmed不覆盖。仅写咨询关联，不改正式v4图、档案归属或佣金。后台菜单/角色权限不扩展，Web沿用Ant Design结构并随接管状态隐藏未授权资料。

图片直发复用现有私有 `media` API，JPEG/PNG≤4MiB、规范到≤2400px、每会话累计20张；点击预览、长按删除，删除/来源撤回显示不可读占位。员工图片读取必须已接管且当前请求成员有效。未知写入保留原键/请求体，设备存储允许时跨页面重建恢复；切换身份或撤权隐藏私有内容。原生相册权限失败有反馈。原批ASR与AI读图未配置；当前D6显式本地语音见首段，未配置部署仍提示不可用，D2读图限制保留；无在线承诺或外部推送。 AI模式成功传图会在同一事务保存system收图提示，说明暂不能识图，可补充问题或找设计师；复用C01/U01既有状态，不改布局。原请求重试不重复提示、重进可见；失败不报成功，等待/人工模式不插话，不创建模型任务。首图/并发重试/重进/接续边界的真实数据库回归通过。

**独立D2正式来源校验：内部Implemented；D1/完整D2仍Limited。** 关联/私有读取与Agent像素恢复共用`media/formal-source.ts`及既有严格正式v4解析器。同企业未归档线索的已完成主户型必须仍归原客户；混入旧布局字段或图结构无效时，不能只凭`version`/`measurementMode`通过Worker。合法后续量房编辑仍保留不可变原图片及`layoutHash`。既有media路由、RLS、参与/同意、hash及删除边界不变；未改UI、schema、模型或正式墙图。`node scripts/assistant-formal-media-acceptance.mjs --evidence=xiaok-d2-formal-media-final`隔离真实服务/鉴权/渲染3/3，744项源码/配置绑定无漂移，网络/供应商attempt为0；定向lint0，原54项全仓类型错误逐项不变、增量0。原2/3失败与Bun驱动启动错误独立保留。这不算实模、embedding、原生或完整D2验收；见二期合同及唯一执行记录。

来源/元素标尺、共享状态、功能限制、最新自动验证和分阶段手测集中维护在[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。原生390×844、胶囊、键盘和长屏视觉验收待人工验证、非开发阻塞；未操作微信开发者工具、未部署生产。

历史标题 **Implemented**：会话列表按同租户、本人参与者权限读取首条用户提问作为标题，合并空白并最多显示80个Unicode字符，超长加省略号；后续追问/重试不改标题，已有会话无需迁移即可生效。空会话保留原兜底，保留期清理后的会话不再从消息生成标题。当前PPT第5页与既有历史列表布局不变，仅替换标题数据。用户提供的5张1080×2400截图覆盖初始页、键盘、回答、引用、历史；可见胶囊/输入区无重叠，用户另确认历史恢复通过。用户补充的历史列表截图已确认旧会话显示各自首问，标题修复截图验收通过；首页入口截图待补；设备型号、390×844基线与重新微信登录尚未确认。DevTools自动化已取消，截图均由用户手动提供。

小K一期开发收尾：小程序全量1876/1876及WCC80模板+2WXS、WCSC83样式、220JS/86JSON离线检查通过。DevTools自动化已取消；用户手工截图与历史恢复反馈见本页首段。真机重新微信登录、首页入口与新版标题仍待相应证据。范围限开发与隔离验收，详见 `docs/xiaok-assistant-phase-1.zh-CN.md` 11.5。

小K回答服务的60题企业知识快照实跑与修复已完成，正式A10仍 **Limited / 待业务审核**。修复了“能否确定最终总价”的多轮追问和冒充管理员索取系统提示时误返无关公开资料的问题；保持已有依据不足状态、租户/参与者/引用权限及PPT第5页设计源，不改小程序标记、样式、素材或导航。汇总38题grounded/22题insufficient_evidence，38条引用来源核对无不匹配；19题回归、最终3题及内部权限2项探针通过。原超时一题获准复测成功，原未知结果/费用审计仍保留。详情与审核包见 [一期11.3节](./xiaok-assistant-phase-1.zh-CN.md#113-当前60题实跑与修复证据)。本次在隔离企业调用真实服务/模型，不是微信登录或原生渲染验收；双语还原台账不变，用户手工截图仍待提供。

当前开发API为`http://124.70.90.30:9966/api`（`ACTIVE_API_ENVIRONMENT=local`），与远端开发记录中的现有开发配置一致，无跨环境回退。自动验收登录测试账号并切换对应身份；体验/正式发布前显式改回production。原生DevTools截图由Codex自动获取，无法覆盖的真机项目单独记为未验证。

开发联调 **Implemented**：用户指定微云企业1454、微信客户645、本人项目1818（关联enterprise_admin2853）。已验证custom格式备份后，将开发主库从0059迁移至0062并启用vector0.8.2；仅此企业开启小K，额度为每日100次/1,200,000预留tokens/100,000,000费用微单位、保留90天，仅关联管理员显式授予`assistant-knowledge`。生产配置与角色默认权限不变。已发布明确标注的联调测试资料，不代表企业业务政策。小程序实际页面/controller/request代码经HTTP连接Next.js及真实Worker/Embedding/文本模型：三轮问答（两轮有依据、一轮依据不足）、响应丢失幂等重试、引用、重进/切换历史和过期身份拒绝全部通过。开发会话98/99保留6条消息供手工查看；证据为`tmp/xiaok-vector/weiyun-live-mini.json`和`weiyun-verify.json`。联调用开发环境签发的客户/管理员JWT，仅在内存使用；微信登录、原生渲染、正式业务知识质量及生产切换仍待验收。该轮链路联调未改视觉；后续截图修正见下。

用户授权从`docs/装修施工标准手册制度规范/04 质量管理`整理并录入微云开发租户1454：7条业主问答已通过既有KnowledgeService创建、真实Embedding索引并发布，文档/版本ID均为2–8，受众`customer_public`、分类“质量管理·施工参考”。来源为《开工九件事》《金螳螂·家 五步放线法》《水电施工标准（工程总监、管家）》，标题保留文件与页码；内容为出处支持的交底/检查要点，未录入内部表单、具体施工数值或企业价格承诺。现有后台`/assistant-knowledge`可查看、修改草稿和撤回；这是一次受控资料整理，不新增PDF上传/OCR/批量导入功能。客户645、项目1818经真实页面/controller/HTTP/Worker/模型验证：水电开工、厨房用电、报价交底均为grounded并可打开来源，未知合同总价为insufficient_evidence；会话101–104的8条消息在重进/切换历史后保持一致。证据：`tmp/xiaok-vector/quality-import.json`、`quality-live-mini.json`、`quality-history.json`。只写入开发环境，其他租户、生产、权限和API合同不变。

对话页继续以PPT第5页为唯一主设计、第14页为暖白家居材质参考；已对照PPT内嵌image4/image14与提取源逐字节核验。品牌单行、原生胶囊左侧留10px，独立Logo去除展示留白后按可见轮廓定标；固定200rpx Hero直接衔接头像/消息，历史、新对话和结束放在输入栏上方，键盘展开时隐藏此辅助行。完整历史起点保留本地欢迎语（不写入消息表），建议问题采用第14页单面板分隔行。标题44rpx、正文/输入30rpx、头像容器72rpx、发送84rpx，原有原生按钮尺寸覆盖继续保留。新增独立ImageGen透明头像与柔焦家居背景，未切割PPT或制作整页贴图。发送/历史/引用、停止/重试/归档及身份/租户/幂等合同不变。原生胶囊、光学字号、键盘/长回答/历史/引用与高屏效果仍待用户手工截图验收；本轮未操作微信开发者工具，也不以编译通过替代视觉验收。

本轮验证：助手逻辑、包体及字号专项34/34通过；WCC80份WXML+2份WXS、WCSC83份Less/WXSS离线编译及220份JS/86份JSON/依赖检查通过。assistant源码包266,751字节，business为2,057,439字节，主包/business限制检查通过；新增透明PNG头像256×256/49,659字节、场景780×380/51,118字节，单图均小于300KB。证据`tmp/xiaok-vector/ppt-restoration-tests.log`、`ppt-restoration-compile.log`。本轮无后台/API或权限变更，原生视觉QA待手工截图。

小K客户页已在 `packages/assistant/chat/chat` 完成代码接入（**Implemented**）；一期整体仍为 **Limited**，原生手工验收、业务知识质量验收及生产切换待完成。用户已明确批准以PPT第5页还原、第14页参考场景风格并补齐一期状态。客户 `pages/index/index` 的小K气泡现在携当前服务的 `leadId` 打开咨询，旁边的文字服务引导入口保留；专业角色首页保留既有外壳，并新增上文P2B员工咨询接管入口。新建assistant独立分包，使用原生WXML/Less/JS与独立生成插画。路由守卫采用 `customer.service`，后端仍要求有效微信customer身份（手机号非必需）、企业解析及当前会话参与者授权。

页面接入 `/api/miniprogram/assistant` 的entry-context、会话创建/列表/详情/归档、历史/发送消息、run轮询/取消/重试和授权引用接口。覆盖欢迎/建议问题、历史及更早消息分页、排队/生成、停止/重试、依据不足、引用撤回、企业关闭/只读、已结束、额度/网络失败、登录失效及结果未知恢复。`latestRun`恢复服务端状态；未知写入结果沿用同一内存请求键和正文，未知费用run不可重试。切后台暂停轮询，身份变化/撤权隔离旧响应并清空敏感状态；正文与entryToken均不写客户端持久存储。entry-context改为不要求开关开启即可读配置，并返回 `canSend/maxMessageChars`，保证关闭企业仍可读授权历史；写入校验不放宽。此API契约不改变默认权限；当前开发schema/开关见上，生产未改。

设计与逐元素标尺见[一期第2节](./xiaok-assistant-phase-1.zh-CN.md#1b-3-当前后台接入与小程序设计来源)和唯一双语还原台账。素材映射：主角继续使用ImageGen独立生成的`generated/xiaok-consultation.png`→`miniprogram/packages/assistant/assets/xiaok-consultation.png`（480×440/117,813字节）；新增`generated/xiaok-chat-avatar.png`→同运行目录`xiaok-chat-avatar.png`（256×256/49,659字节）、`generated/xiaok-chat-room.png`→`xiaok-chat-room.png`（780×380/51,118字节）。三个生成源均在`design-references/xiaok-assistant-phase1-ppt-v1/`，均为优化透明PNG；头像可见alpha边界x27–236/y11–253，运行68rpx图像内显示完整角色。6个本地Lucide1.8.0 PNG及现有独立品牌Logo继续复用，许可见`docs/icon-sources/assistant/README.md`。 语音/传图、户型理解、自动需求总结与人工接管仍不属于本期。

小K运维监控与保留清理后端 **Implemented**，第一期整体仍 **Limited**。`GET /api/assistant/operations`仅本企业有效enterprise_admin且具显式`assistant-usage`可读，返回UTC窗口回答指标、当前队列/未知费用积压、可配置阈值告警，并如实区分心跳/provider健康未知。`npm run assistant:retention -- --enterprise-id <id> --admin-id <id>`默认预检；显式`--apply`需数据库`assistant-retention`权限及有效retention_days。每批100条，仅脱敏已过期且归档/关闭的会话正文，跳过在途、未知结果或未核对费用；ID、幂等、财务审计和知识源保留，清理后的引用不能恢复正文。没有新增UI、默认权限、生产定时任务或schema迁移。运维串行回归与独立完整恢复演练均已在隔离环境通过，当前证据及生产/A10/UI待办见[第一期第9节](./xiaok-assistant-phase-1.zh-CN.md#9-运维保留与兼容迁移)。

小K当前状态：`Limited`。详见[六期规划](./xiaok-assistant-roadmap.zh-CN.md)与[第一期实施契约](./xiaok-assistant-phase-1.zh-CN.md)的1A交付记录。已新增客户入口上下文、会话创建/列表/详情/归档、消息发送/历史、run查询/取消/重试（`/api/miniprogram/assistant/*`），以及受CRON_SECRET保护的内部Worker（`/api/internal/assistant/jobs/run`）。13张新表通过0058/0059迁移、强制RLS及复合外键实现租户隔离；只允许有效微信customer身份访问本人参与的会话，无手机号可用，staff/referrer/Admin/平台身份均无默认读取权。服务码只解析和审计，不新增留资/归属/分佣。消息/run/job/幂等/额度预留同事务，支持租约恢复、未知结果保留和取消后拒绝晚到提交；企业reset/purge已纳入新增数据。

1B知识后端 **Implemented**，第一期整体仍为 **Limited**：`/api/assistant/knowledge/documents`及`[id]`提供列表/创建/详情/元数据更新，`[id]/versions`复制草稿，`[id]/versions/[versionId]`编辑，`index`/`publish`执行索引/发布，`[id]/retire`撤回，`/api/assistant/knowledge/jobs/[jobId]`查询任务。写请求要求Idempotency-Key和对应expectedVersion/expectedEditVersion。仅本企业有效enterprise_admin且数据库menu_permissions显式含assistant-knowledge可访问；平台无例外，权限在索引执行前后复查。本批不新增菜单或默认授权。0060新增5张知识表（文档/版本/片段/profile/调用审计），强制RLS及复合FK；知识任务带租约/hash/edit_version保护，发布撤回提升epoch并写outbox；reset/purge已纳入。

1B知识回答、结构化引用/失效校验、无依据处理及本人预览后端 **Implemented**。同一ConversationService/JobQueue在授权检索后调用现有文本模型；每段回答必须引用本次证据及逐字摘录，最终提交复查权限、epoch、hash/profile和有效期。无候选/低相关或模型明确无依据时保存固定insufficient_evidence notice；检索故障、非法引用或畸形输出不会冒充有效回答。0061新增强制RLS引用表及消息/run answer_kind；引用与最终消息、终态同事务落库，reset/purge已包含引用。后续读取会隐藏已撤回/受限/过期/draft编辑失效来源及整条依赖回答，仍获授权的旧发布版本标记historical。

FAQ回答整理 **Implemented**，使用`extractive-selection-v3-faq`：问题标题仅作匹配上下文，不作为答案候选；不超过400字符的短答案保留完整条件。优先选择一条直接、完整的答案，仅补充尚未覆盖的必要信息，相同正文确定性去重。展示只去除FAQ的问答外壳，引用快照仍是连续原文；最终校验不允许新增解释或删掉答案的限制条件。已保存的旧消息不回写。开发环境企业1454/客户645/线索1818复测截图中的水电开工问题，返回一段正文和一个可用引用；conversation109/run80只有一条用户消息和一条助手消息，重新读取历史内容一致。证据：`tmp/xiaok-vector/faq-answer-live.json`；回归覆盖位于`answer-selection.test.ts`和`assistant-answers.test.ts`。路由、API、权限、小程序结构/样式/素材及已批准PPT设计不变。

新增`GET /api/miniprogram/assistant/citations/[citationId]`；后台`/api/assistant/preview/conversations`及详情/归档/messages、`/runs/[runId]`和cancel/retry、`/citations/[citationId]`复用会话服务。预览只允许本企业有assistant-knowledge权限的enterprise_admin访问本人会话；平台、其他管理员和客户无权读取。创建时固定audience和最多10个ready draftVersionIds及hash/editVersion，发送不可扩大范围，引用标记isDraft，使用同一企业额度。客户定位仅返回本人参与会话的路由ID，再进行租户授权。

1B usage汇总、用量统计及未知费用核对后端 **Implemented**：`GET /api/assistant/usage`按UTC日期返回文本/query Embedding用量、索引调用、provider状态、run用途/错误、费用和当前额度；默认30天、最多90天，结束日期不含，整数使用十进制字符串，未知保持null，已知小计与未知数量分列。`GET /api/assistant/usage/reconciliations`分页列待核对预留，`GET/POST /api/assistant/usage/reconciliations/:reservationId`读取安全审计详情/提交核对。当前企业在职enterprise_admin必须显式获数据库`assistant-usage`权限，提交另需`assistant-usage-reconcile`；不增加默认权限或菜单。提交要求Idempotency-Key、expectedVersion、tokens、costMicros、currency=CNY、evidenceReference和reason，已知token必须匹配；只接受终态且租约结束、dispatch已超过180秒的预留。0062新增强制RLS/复合外键核对审计、input/output token、确认额度和固定CNY预算币种；同一设置锁下幂等结算，跨日未决额度保留，核对不改变run终态、不重发、不扣客户费用，reset/purge包含审计。历史query用量不补造，本地Embedding硬件成本未计价；无法核实token或费用时保持reconciling。

1C后端修复及隔离合成验收 **Implemented**，整体第一期仍 **Limited**。最终采用硅基流动免费Qwen/Qwen3.5-4B非思考模式：可答题50/50（原基线38/50）、无依据10/10，零超时/非法引用；P95为5.194秒，真实三轮及回答16/16通过，完整入口passed=true。原R1按优先要求复验后仍出现超时，失败证据保留，未启用付费备用。模型只选授权证据编号，服务端生成并严格校验原文引用；一般政策与项目承诺分开，签约查询同义表达复用旧索引。本地assistant专用模型/非思考环境配置已保存，平台默认LLM及其他AI功能未改；明确402为已知失败但仍待费用核对，未知用量/费用不补零。基础30/30、知识9/9、usage8/8通过，测试数据/队列清理为0；完整证据与局限见第一期第2节。该隔离质量测试未修改业务数据或ComfyUI；当前开发启用见上，业务A10仍待签认。

开发主库迁移及微云联调情况见上。生产切换、正式业务知识质量和原生界面验收仍待完成，第一期整体仍为Limited。

## 2026-09-03 方案重新编辑参考图预览修正

`scheme-studio` 从时间线点击**重新编辑**时，草稿现在会保留
`batch.referenceAssets` 返回的签名预览 URL，同时继续使用持久化参考图
ID 与现场图角色分类。因此配置弹窗会直接显示带回的参考/效果图，不再显示
空白占位图。Studio 路由、API、租户范围、权限和生成载荷均未改变；已补充
Composer 聚焦测试覆盖预览 URL 恢复。

## 2026-09-03 方案定稿反馈修正

`packages/ai-workflow/scheme-studio/scheme-studio` 现将**设为定稿**收敛为整套 workflow 的方案级动作，不再在每个完成轮次重复展示。未发布方案显示前置提示，已发布方案显示方案级定稿动作/状态；无有效发布记录或重复点击已定稿时均有明确反馈。定稿写入 `leadLifecycleEvents`（`scheme_finalized` / `scheme_unfinalized`），撤回最后一张有效发布图时会清理定稿指针。定稿 API、租户范围、角色边界和生成流程保持兼容；定稿表示客户主推方案，不冻结后续出图。

## 2026-09-02 AI 设计入口视觉校准

V2 可读性修正保持批准布局：项目信息标签使用 `24rpx`，Hero 说明、配方元信息和项目抽屉字段名由 `20rpx` 提至 `22rpx`。字体下限测试及离线 Less/WXSS 编译通过；光学字号与换行仍需新的 `390x844` 人工截图确认。

`scheme-studio` 配置弹窗现在将**保存配置**固定在首屏可见的底部操作区，只有配置内容在溢出时滚动。

`pages/ai-design/ai-design` 继续使用
`design-references/ai-design/unified-entry-v2/01-design-tab-v2.png` 作为创作入口，真实项目/配方数据、API、权限和设计师六项导航保持不变。原生 WXML/Less 现按源图校准项目 Hero 为 `480rpx`，主/次操作比例为 `1.32fr/1fr`，客户头像为 `88rpx`，项目标题为 `34rpx`。应用层证据为 `output/playwright/ai-design-v2-fresh.png`；含原生胶囊的 `390x844` 运行态 QA 仍待用户手动补充截图。

## 2026-09-02 方案工作台时间线与新一轮入口校正

`packages/ai-workflow/scheme-studio/scheme-studio` 的收起态现将左侧整块作为**本轮配置入口**：
显示模板封面、**选择模板**、**设计整屋 · 参考图 1 张**摘要和**调整**右箭头；右侧为独立的
**生成**按钮。收起态输入框、费用条和展开编辑行已移除，点击左侧配置块打开既有的本轮配置弹窗，
展开态仍保留完整提示词编辑能力。生成 API、设计方式选择、租户范围与角色边界均未改变。
时间线竖轨和状态节点在标准与窄屏均共用同一圆心坐标。用户最新长屏真机图显示，创作中卡片
原圆角尾巴仍形成了环绕节点的过大钩形；现改为贴合卡边的双层描边短三角尾巴，并与节点保留
清晰间隔。完成轮仍待补充 `390x844` 真机图，创作中轮需在本次尾巴修正后重新提供运行截图。
固定 Composer 底部操作栏现使用浅绿色渐变、大圆角上沿和半透明白色内层编辑区，
与白色时间线页面形成清晰分层；展开态输入、工具栏、生成及键盘安全区行为保持不变。
展开模板编辑器中的既有折叠动作现标为 **收起**，不会关闭方案工作台。
底部生成按钮略微降低高度，并明确在工具栏内容区居中；展开态输入、工具栏结构、生成及键盘安全区行为保持不变。
生成提交后 Composer 会自动收起并隐藏遮罩；时间线轮次卡片展示当前批次的模板封面及全部已持久化参考图，并支持统一预览。

## 2026-09-02 AI 配方绑定页量房状态修正

`packages/ai-workflow/recipe-project/recipe-project` 现在以接口中是否存在至少
一条含闭合空间的已完成正式 v4 户型作为「可设计」依据；即使预约流程仍为
`survey_ready`，也不会再误显示「去量房」。`studio/leads` 接口会把历史数据中
仅挂在 `primaryFloorPlanRecord` 的当前户型作为兜底，与关联列表去重后返回；租户、
角色和路由边界保持不变。

## 2026-09-02 AI 配方项目页 V2 视觉还原

`packages/ai-workflow/recipe-project/recipe-project` 已在同一路由实现两份批准的
V2 构图：确认客户前使用 `02-project-picker-v2`，确认后使用
`03-recipe-bind-v2`。两种状态均提供避开微信胶囊区域的返回按钮；选择客户会先标记卡片并启用底部 CTA；既有量房跳转、方案
列表、新建方案和进入 `scheme-studio` 的 API、租户及角色合同保持不变。选择页直接复用
当前配方已有的独立预览图作为清晰原图（不叠加模糊、透明度、缩放或蒙层）和客户卡回退图，标题区域使用局部半透明浅色衬底保证文字对比度，不新增主包素材，也不打包
任何复合设计稿。两种状态均待负责人提供含原生微信胶囊的
`390×844` 运行截图完成视觉 QA。

本文只描述原生微信小程序当前运行入口、合同、权限和限制。日期还原记录和
测试全文由 Git 历史或本地证据保留。

## 2026-09-02 AI 设计入口动作与图标修正

批准的 `unified-entry-v2` 设计 Tab 现已区分两个最近项目动作：**开始新一轮** 为现有 `scheme-studio` 追加 `startNewRound=1`，进入后自动打开批准的轮次准备方式选择；**继续上次创作** 不带该标记，直接恢复当前方案工作台。路由、API、权限和租户边界不变。设计 Tab、客户项目选择和配方绑定页的导航、生成、继续、方案、新建、勾选、说明等动作改用已登记的 `miniprogram/images/ai-studio-icons-v3/` 透明 PNG 图标，不再使用 CSS 拼绘字形；Hero 操作图标固定为 `30rpx`，避免透明图形溢出按钮。所需 `390x844` 原生胶囊运行态视觉核验仍待用户提供截图。

## 2026-09-01 AI 设计统一入口还原

AI 设计界面已按批准的 `design-references/ai-design/unified-entry-v1/` 五屏方案还原：设计 Tab 从客户项目开始，项目选择使用胶囊安全区底部抽屉，配方绑定在同一页呈现客户与方案，方案工作台保留准备新一轮/设计方式选择和统一 Composer 层级。现有 Studio、配方、租户、权限与生成 API 均未改变；本次为原生 WXML/Less 与已打包资源还原，登录态 `390x844` 运行时视觉核验仍待用户手动截图。
原型实际引用的独立切图已打包到 `miniprogram/images/ai-design/unified-entry-v1/`：`cad-floorplan-archive.jpg` 对应正式户型/项目预览，`scheme-wood-cream-showcase.jpg` 对应进行中项目与方案效果，`recipe-modern-minimal.jpg` 和 `recipe-cream-interior.jpg` 对应配方卡与已选配方摘要。小 K 及整屋/单间设计板继续使用已批准的既有打包路径；运行时没有使用复合截图切片。
用户提供的五张长屏真机图（`67b515…`、`a57211…`、`74d638…`、`5161d6…`、`648d10…`）记录为未通过证据，而不是验收结果：截图暴露了旧配方详情页、独立客户选择页、额外配方瀑布流、三条最近项目，以及偏大的设计方式/工作台内容。当前主入口与历史复用均直接进入 `recipe-project`，`recipe-detail` 只做重定向兼容；绑定页在一页内完成配方、客户和方案归属；设计 Tab 固定呈现两条最近项目和两张配方起点；准备页与工作台几何尺寸按批准源重新校准。视觉 QA 仍需用户提供新一轮真机截图后才能关闭。

## 运行环境与共享上下文

- 原生微信小程序，使用自定义 TabBar、亮绿色设计 token，视觉基准为 iPhone 13 Pro
  `390x844`。
- 会话使用 `/api/auth/miniprogram` 和 bearer JWT；`GET /api/miniprogram/bootstrap` 会校验签名上下文并返回当前角色、有效角色组、企业/成员关系、落点、能力白名单，以及按当前角色 Tab 键分发的服务端徽标摘要（`status`/`message`/`counts`）。徽标查询失败不阻断身份 bootstrap，返回 `unavailable` 与「暂时无法读取」，不以本地 0 占位。手机号授权可创建普通客户账号；`wechat_phone` 优先消费微信动态 `code`，旧客户端仅返回 `encryptedData`/`iv` 时用点按钮前预取的 `loginCode`/`session_key` 解密；阶段 3 的推荐领取接口也可直接使用微信授权码（含该旧密文），在同一事务中关联账号、归属和线索；服务端获取微信手机号使用 `getStableAccessToken`。归档线索会释放归属锁，再次扫码可新建线索；
  token 选择数据库实时校验的 `customer`、`staff` 或 `referrer` 上下文，并由
  `contextVersion` 使旧 token 失效。专业员工、企业上下文、线索、户型、AI 任务、
  提成和报备记录都通过共享 API 解析。小程序启动/回到前台时会用保存的 token 调用
  `refresh` 重新读取当前上下文，随后由 bootstrap 确认服务端能力与落点；小程序员工工作台支持 `designer`、`measurer`、`salesperson`（渠道地推，落点为企业报备页）、`enterprise_admin` 与 `platform_admin`（由 `admin` / `super_admin` 映射）。平台渠道地推允许 `enterpriseId` 为空，bootstrap 能力为 `promotion.records` / `promotion.commissions` / `account`。平台管理员落点为 `packages/platform/devices/devices`（已从主包 `platform-device-workbench` 迁出）：扫描附近多台 `LDMStudio 4D` 只收集 MAC（不建立连接），勾选或一键全部分配经 `POST /api/miniprogram/devices`（可填可选 SN 码：单台共用字段或扫描行 `serialNumber`）；企业员工连接前仍须通过 `POST /api/devices/verify-binding`（仅校验企业归属），量房仍为单台连接。刷新任务按 token 版本隔离，旧冷启动任务失败不会清理随后手机号登录的新会话；当前上下文失效才会清理本地会话，推荐人上下文从首页或“我的”
  冷启动时恢复到推广工作台，避免静默落入普通客户界面。普通业务页遇到失效上下文仍清理会话并进入明确的身份恢复页；若当前或冷启动目标是公开的 `free-design-service`、员工/推荐人 `onboarding` 或企业开户二维码落地页，则只清理失效登录态而不改写扫码目标，继续匿名解析码并完成手机号授权，使直接扫码与微信分享卡片使用同一入口合同。小程序对用户展示的岗位名：`designer` 为家装设计顾问、`measurer` 为家装现场顾问；接口角色键不变。
- 平台设备录入扫描只接受本轮实时发现的 `LDMStudio 4D` MAC，不读取
  `getBluetoothDevices` 的历史缓存；搜索按钮在进行中变为可点击的「取消搜索」，不再使用遮罩
  loading。已登记的 MAC 返回 `409` 和「该设备已录入」，不重新分配给所选企业；聚焦自动化测试
  已通过，改动后的 `390x844` 平台管理员运行截图仍待人工复核。已登记设备列表有独立「查看范围」，
  默认「全部企业」（`GET /api/miniprogram/devices` 不带 `enterpriseId`），也可选一家企业用
  `?enterpriseId=` 过滤；上方「归属企业」只用于扫描分配，不联动列表范围。
- 主操作使用本地存储且有许可证记录的图标；原生右上角胶囊和安全区不得被内容覆盖。
- 源码包通过 `project.config.json` 的 `packOptions.ignore` 显式排除开发目录、临时预览脚本和本地设计 token 文件；未使用的历史切图已从源码树删除，不再留在 ignore 里占位。主包仅保留当前运行资源，并在微信 2MB 源码包上限下预留余量。墙图内核放在量房子包 `packages/surveying/utils/surveyWallGraph.js` 与 `packages/surveying/utils/survey/`，主包只保留不依赖内核的 `utils/surveyLayout.js`，供线索列表预览和业务读模型使用。Phase 2 已把 draft/session helper、vector/segment/polygon 几何、wall/opening 规格化与长度，以及结构化领域错误收口到单向依赖的基础模块；legacy 导出边界继续映射原错误消息和历史字段。Phase 1 差分 harness 与 Phase 2 基础测试共同冻结 legacy kernel 的 64 个导出、façade 的 69 个导出、graph/session/错误、`quick`/`full` 校验、重复执行、依赖方向及 35 对 Mini Program/Admin 镜像；测试源码不进入任何运行包，本次重构不改变路由、API、角色、权限、UI、吸附/闭合规则或 version-4 数据合同。量房子包内三张引导姿态 PNG（`packages/surveying/assets/surveying-guide-k-*-v3.png`）使用索引调色板透明压缩，使该分包在纳入内核后仍低于 2MB 源码上限。主包 `images/` 插画已原地调色板压缩。`packages/business` 与 `packages/enterprise` 分包分别遵守 2MB 源码上限：运行时插画使用调色板压缩 PNG，小 K 形象复用主包 `images/airy-v1`，不在分包重复打包。`packages/enterprise` 承载员工/企业经营页面，可打印二维码的公共与推广路由仍留在 `packages/business`。平台管理员审核与设备录入页放入独立普通分包 `packages/platform`（非 independent：需引用主包 `custom-tab-bar`、`utils/api.js`、`utils/bluetooth.js`），同样遵守 2MB 源码上限。角色引导页及其生成插画统一放入独立 `packages/guides` 分包，运行时插画使用调色板压缩透明 PNG，使该分包保持在独立 2MB 源码上限以内，并由聚焦体积测试约束；每张生成 PNG 不超过 300KB。
- `packOptions.ignore` 现显式排除 `tmp/` 测试日志。仅方案工作台使用的 Composer（含 model）迁至 `packages/ai-workflow/components/ai-scheme-composer/`，组件注册、model 和共享 `sheetMotion` 引用一起更新。仅 AI workflow 使用的作品集封面与两轮 setup 参考图从 `images/` 迁至 `packages/ai-workflow/assets/`；未被引用的 `services/analytics.js` 和 `utils/filter.js` 已删除。源码体积：主包1,957,726字节、源码体积：主包1,957,726字节、business 1,615,502字节、enterprise 455,883字节、assistant 1,828,840字节、surveying 1,901,944字节、guides 1,278,511字节、AI workflow 809,969字节、construction 247,233字节、platform 79,039字节。14个员工/企业经营页面（线索表单/详情/抢单池、企业员工/推广人及分支名册、预约、排期、提成、收益、不可用时段）连同4个素材目录已从 `packages/business/` 迁至 `packages/enterprise/`；可打印二维码路由（`free-design-service`、`onboarding`、`enterprise-register`）与公共/推广素材留在 `packages/business/`。分包之间允许页面跳转，但 require、组件和素材不跨包。共享的推广人工作台样式链（`customer-projects`、`referrer-progress`、`referrer-earnings`）已迁至主包 `styles/referrer-pages/`，由3个受影响的business页面及enterprise的 `staff-earnings`、`enterprise-commissions` 导入，分包之间不再读取彼此源码。2026-10-30 Stable 2.02.2608080预览（appid wxa7728432f59779d1）已成功编译并打包拆分后的项目：总计9,266,906字节，主包1,756,909、business 1,534,910、enterprise 420,351、assistant 1,910,073、surveying 1,326,933、guides 1,267,543、AI workflow 732,919、construction 257,259、platform 60,009字节，全部分包低于2MB上限，最小余量为assistant的187,079字节。DevTools 统计的分包体积大于分包自身文件之和：assistant 源码树为2,081,384字节时上报2111KB，约80KB的差值与其依赖的主包模块（48,203字节）加 `app.js`、`app.json`、`app.wxss`（当时32,109字节）一致；以预览上报为准。新编译后的17条路由模拟器冒烟（14个迁移路由与3个可打印二维码路由）全部到达目标，页面数据非空且渲染出可见元素。入驻v7独立素材 `xiao-k-promoter-hero-v7.png` 保持路径、620×688尺寸和透明构图，256色PNG由263,447压缩至109,953字节。路由、API和权限不变。账户透明调色板、当前引导/版本状态/设备查询断言与固定日历测试时钟已对齐现有运行代码。量房冻结参考仅补齐提交 `91773e8c` 已引入的 `wall.use` 默认值，快照123处差异全部为 `room-boundary` 字段；依赖清单只补录已有测量面测试调用方，几何、校验、差分检查及83份运行镜像保持不变。
- `Implemented`、`Limited`、`Placeholder` 只表示可执行运行时行为，不代表标签或 mock 响应。

Phase 2 复核已把剩余点到直线距离、测量面法向、预览实测长度及端点反算收口到基础模块，保留 legacy 空楼层访问语义，并以 Phase 1 冻结公式约束精确取整结果，逐一验证全部 32 个领域错误码的旧消息与字段映射；运行包、路由、API、权限和 v4 合同边界不变。

Phase 3 只读模型抽取已实现（Implemented）：墙体几何/墙面和空间边界/尺寸直接消费
`core/graph-query.js`、`topology/closed-boundary.js` 与纯基础模块，独立于 kernel 加载。
69 个 façade 导出显式指定来源，64 个 legacy 导出保持兼容；逐函数只读及冻结公式差分
详见 [Phase 3 完成记录](./surveying-module/legacy-kernel-phase3-read-models.md)。
Phase 4A 门窗事务继续由 `survey/operations/opening-operations.js` 独立实现，保持规格化、
宿主墙范围、入户门/selection、缺失删除 no-op 和旧错误语义。
Phase 4B 墙体结构事务已实现（Implemented）：`survey/operations/wall-split.js` 与
`wall-deletion.js` 使用只读 plan、不可变事务草稿，保持门窗迁移、审计分摊、共享墙实体侧、
session 清理和 Face/Space 同步。删除 façade 不再调用 kernel 实现；内部拆墙在落墙/闭合
事务中组合，全部切点完成后执行 full 校验。墙链恢复的既有只读查询位于
`topology/closure-queries.js`，没有接管闭合写入或改变吸附/闭合策略。Phase 4B 快照为
4,595 行 / 116 个顶层函数；Phase 4C 快照中 kernel 为 4,319 行 / 110 个顶层
函数，64 个 legacy 与 69 个 façade 导出保持兼容；40 模块 / 158 边审计验证 43 对镜像。
Phase 4B 的 697 项量房、55 项 H5、39 项 Admin 测试及大图性能门槛继续作为护栏，新增
Phase 4C 单元覆盖测量 plan、审计持久化与门窗冲突原子拒绝。闭合写入已由下述 Phase 4D 接管，交互分离已由 Phase 5 接管，详见 [Phase 4B 完成记录](./surveying-module/legacy-kernel-phase4b-wall-operations.md)。
Phase 4C 测量写入已实现（Implemented）：镜像 `survey/operations/measurement.js` 独立拥有
`remeasureSelectedWall` 的只读 plan/apply 与现有 full 不可变事务。开链复尺、单一闭合正交
空间复尺、固定端点、连续双轴平差及门窗范围均在移动节点前预检；原始读数、有效墙长和
闭合平差保持 `lengthMm = rawMeasuredLengthMm + closureAdjustmentMm`。`commitPreviewLength`
的已有墙长延长/缩短和新墙审计写入复用同一 helper，legacy kernel 仅保留兼容代理。闭合
确认已由下述 Phase 4D 接管，交互状态机已由 Phase 5 接管；本次不新增后台写入口，不改变路由、API、角色、
权限、UI、设计源或 version-4 数据合同。详见
[Phase 4C 完成记录](./surveying-module/legacy-kernel-phase4c-measurement-operations.md)。

Phase 4D 闭合与合并已实现（Implemented）：只读 `topology/closure-candidates.js`
和 `closure-plans.js` 向 `operations/closure.js` 提供计划；预览提交、共享墙拆分、门窗迁移、
合并及 Face/Space 同步组合在一次 full 事务中。计划不读时钟、不分配 ID、不保留 graph 引用，
失败保留输入与历史；完整 4,096 场景冻结差分继续生效。详见 [Phase 4D 完成记录](./surveying-module/legacy-kernel-phase4d-closure-operations.md)。

Phase 5 交互与 session 分离已实现（Implemented）。`session/state-machine.js`
定义 11 个正式状态、19 类事件、明确允许转换及原子拒绝的 `INVALID_SESSION_TRANSITION`；
历史 `openingSelected` 只兼容读取，不作为新状态输出。`session/field-groups.js` 将原 42 个
扁平字段分为 preview（10）、selection（3）、closure（18）、measurement（10）、viewport（1），
不改变可选字段缺席语义或存档格式。`interaction/` 只为预览、方向、内角、墙体吸附、确认和
视口产生隔离 session 或值/ID 意图；`snap/snap-engine.js` 明确预览/确认计算顺序，普通图查询
与 Canvas 缓存共用 `snap/candidate-policy.js`，graph 修改由 operation 应用。
`startPreview` 编排预览服务和可选创建光标意图；`commitPreviewLength` 分离输入确认与既有
quick/full 事务。闭合直接组合独立落墙操作，不回调 kernel，也不嵌套事务；editor 继续拥有设备、
手势、Toast 和 BLE 回调，吸附阈值不变。Phase 6 后 kernel 仅为 97 行、0 个顶层领域函数的兼容入口，76 个模块 / 400 条依赖边与 79 对生成镜像通过审计；64 个 legacy 和 69 个 façade 导出保留且来源显式。
新增 368 项测试，含逐转换验证、双端所有状态的冻结命令差分、完整 4,096 场景逐次
preview/commit/snap 比较、无时钟计划、重复/撤销/重做、失败原子性和冻结 Canvas 索引对照。
1,089 项量房/编辑器、55 项 H5、39 项 Admin 消费者和既有性能门槛通过；全量结果见
[Phase 5 完成记录](./surveying-module/legacy-kernel-phase5-interaction-state-machine.md)。UI、图片、路由、API、角色、租户权限、BLE 协议、测量审计队列及
正式 v4 合同均无变化，后台继续只读；无需新设计源或 DevTools 自动化。Phase 6 兼容层与运行来源收口已完成，详见 [Phase 6 完成记录](./surveying-module/legacy-kernel-phase6-compatibility.md)。
Phase 7 最终治理已实现：纯 geometry/read-model 依赖方向、全模块无环、façade/legacy 唯一显式
导出、生产路径隔离兼容 kernel，以及 79 文件 Mini/Admin manifest 镜像均成为长期可执行门槛。
新增 graph 写入必须复用现有 operations 事务、topology/Space 同步和 validator；宿主与 BLE 行为
继续留在 editor。本次不改变路由、API、角色、权限、UI、BLE 协议、设计源或 version-4 合同，
详见 [Phase 7 完成记录](./surveying-module/legacy-kernel-phase7-governance.zh-CN.md)。
测试源码不进入运行包；内部重构没有可见 UI 或设计源变化，不需要微信 DevTools 自动化，
不改变路由、API、角色、权限、错误文案或 version-4 数据合同。

### 运行时版本检查

`App.onLaunch` 只初始化一次官方微信 `wx.getUpdateManager`，并记录
`checking`、`downloading`、`ready`、`latest`、`failed` 状态。收到
`onUpdateReady` 后弹出重启提示，用户确认后调用 `applyUpdate`。 “我的”账号区新增
「检查当前版本」，读取本次生命周期的检查状态；微信没有开发者主动触发的
`check()` 方法，因此该按钮不能强制发起一次新的网络检查。`getUpdateManager` 已对
旧版微信和不支持的运行环境做兼容保护。本次不改变路由、API、权限或租户数据合同。

## 页面清单

### 导航测量画布旋转约束

按钮显示的绝对方位角（例如 `231°`）只用于读数与入户门相对方向计算，不能直接作为画布角度。导航按钮标签与实时角度读数均为 `28rpx`，相对方向经过 `0°/90°/180°/270°` 四档正交吸附，只有跨过 `20°` 触发阈值才沿最短角执行 `420ms` ease-out 缓动，并使用反向视觉符号使平面图与手机转动方向相反，画布不会停在斜角。
定位弹层的原生操作点击会在 `cover-view` 边界截断，Canvas 触摸入口在弹层显示或关闭动画期间也会忽略触摸，因此点击「确定定位」不会再选中弹层下方的墙向。
导航模式的传感器回调只负责画布旋转，不会自动锁定方向箭头；方向箭头始终由操作者手动点击选择。

### 当前三角色工作台与数据页合同

下列 V3 内容仅保留为此前单一路由构图的历史记录：
`design-references/enterprise-owner-activity-code-entry-v3/enterprise-owner-operations-home-v3.png`。
批准的 V3 结构为等宽获客双入口、规则三段经营路径、两段卡间短连线、两张效率卡和浅薄荷优先处理托盘。
第二阶段详情使用 `schemeFacts.publishedLeadCount` 提供的周期统计「已发布方案 N 份」，不再渲染对老板含义
不清的「闭合率」。V3 业务插画均通过 ImageGen 独立生成透明 PNG；其中未再使用的
`lead-inbox.png`、`staff-onboarding.png`、`scheme-delivery-rate.png`、`signing-rate.png`
已从运行时源码包删除。当前生产保留 `images/operations-dashboard/enterprise-guide.png`
（17,943 字节）和 `staff-load.png`，以及下文密度 V2 / 经营 KPI 切图，均小于 `300KB`。
复合设计稿禁止裁切为运行时资源。按设计源校准的
V3 负责人元素台账为：仅企业负责人 Hero 的顶部内容预留 `114rpx`，三枚状态胶囊以 `12rpx` 间距紧跟其后，
胶囊底部与绝对定位的 `190rpx` 小 K 图盒底部近似齐平；两张获客入口均为等宽白底卡，最小高度 `136rpx`，
活动码/入驻切图盒分别为 `64rpx` / `72rpx`（`360px` 及以下为 `60rpx` / `68rpx`），标题/说明字号为
`30rpx` / `24rpx`（窄屏为 `28rpx` / `22rpx`）。经营板横向内边距 `24rpx`，绿色原生标题 `26rpx`，
阶段卡高度 `168rpx`、内边距 `18rpx 18rpx 14rpx`，阶段间距/卡间连线 `44rpx`，效率卡间距
`20rpx`、内边距 `18rpx 20rpx`、图标盒 `72rpx`、最小高度 `146rpx`。
用户提供的高屏真机图暴露了重复叠加第二枚加号和三卡下方整条进度轨的问题；生产现改为单一打包图标和
两段卡间短连线。前后端错峰发布时，旧接口返回的「闭合率」会被真实的「方案同步中」兜底隐藏，
直到周期方案发布数到达。现有路由、API、权限和原生数据边界不变；更新后的运行态截图待用户复核。
最新白底入口截图确认旧入驻切图主体过白，现替换为内置 ImageGen 生成的独立源
`design-references/enterprise-owner-activity-code-entry-v3/staff-onboarding-white-card-v2.png`；该 V3 切图随后从运行时源码包删除，改由 `team-onboarding-v2.png` 承担入驻入口。人员负荷小 K 图盒调整为 `120rpx × 104rpx`，三张阶段卡
使用 `34rpx` 序号圆、`26rpx` 标题、`168rpx` 高度与 `14rpx` 下内边距，收紧无效的底部留白；两行说明仍按内容自然撑开。

设计顾问首页跳转修正：含 `leadId` 且 `serviceStage=design_published` 的卡片，优先进入既有员工已发布方案册 `packages/business/customer-ai-schemes/customer-ai-schemes?leadId=…&mode=staff`，不再执行旧的预约、重约或量房动作。整卡与冒泡的「查看方案」共用 `openItem`。独立量房/预约按钮、其他角色及专用任务视图继续使用原处理逻辑。状态数据、结构、样式、素材、API 与服务端权限不变。已实现（Implemented）；35 项聚焦导航/工作台测试全部通过，覆盖六种旧动作和角色/视图回归；运行时点击仍待手工复核。

任务卡片对齐修正已实现（Implemented），依据用户截图 `b54ff381e24ac67a48f89493b6401065.jpg` 及明确批准的排列方案：`components/role-workbench` 中设计顾问/现场顾问首页任务列表的状态标签共用全宽标题行并统一右侧边距，长客户名省略，标签不压缩、不换行；「查看方案」等兜底操作进入底部操作行并靠右。卡片内边距保留 `24rpx`，标题与标签间距为 `16rpx`，操作行保留 `14rpx` 上间距并在需要时换行。既有字号、素材、状态数据、点击处理、路由、API 和权限保持不变。验证：所选 28 项测试中 27 项通过，`git diff --check` 通过；唯一失败是未改动的 `pages/ai-design/ai-design.less` 中四个选择器触发既有 AI 设计页 20rpx 白名单检查，与本次卡片无关；运行时视觉 QA 仍待用户提供包含原生胶囊的 `390x844` 与高屏手工截图。

当前批准的设计源为 `design-references/role-workbench-unification-v1/pages-index-three-role-workbench-v2.png`
与 `design-references/role-workbench-unification-v1/pages-enterprise-operations-role-data-v1.png`。
`pages/index/index` 现为 `enterprise_admin`、`designer` 与 `measurer` 共用一套获批的专业工作台壳层。三种状态均保留胶囊安全身份栏，并使用固定 `252rpx` 的绿色 Hero；Hero 只显示角色标题、对应角色小 K 插画和三项既有服务端真实统计。其后统一为一张大主卡加右侧两张小卡的不对称获客中枢。负责人看到「获客与团队」及「分享活动码」「邀请入驻 · 员工 · 推荐人」「查看推广人 · 全店推广网络」；家装设计顾问和家装现场顾问看到「获客与推广」及「分享活动码」「邀请入驻 · 仅推荐人」「我的推广人 · 仅查看本人网络」。`GET /api/miniprogram/workbench` 为三个角色统一返回 `activityCode`、`joinCode` 和 `referrerRoster`。既有 `enterprise-join-codes` 与 `enterprise-referrers` 路由继续在服务端强制负责人 `scope=enterprise`、普通员工 `scope=own`，因此员工不能查看员工分支或全企业名册，只能停用本人邀请的推广人。负责人保留预约/提醒/洞察和异常区；设计顾问的客户/抢单/方案任务与现场顾问的蓝牙、日程、请假、正式量房任务排在共用中枢之后。工作台概览复用 `miniprogram/images/operations-dashboard/` 下既有独立透明 PNG 及既有设计顾问/现场顾问小 K，组合稿从未被切割。`pages/enterprise-operations/enterprise-operations` 继续作为唯一原生注册的数据路由：负责人仍看到「经营」，保留四项 KPI Hero、全店经营闭环、效率卡、负责人专属 `contractAmountSum` / `contractAmountTrend` 与 `enterprise.operations` 范围；设计顾问和现场顾问看到「数据」，复用同一周期/自定义区间控件，只渲染既有员工过滤查询返回的五项本人事实——新增线索、已完成量房、方案交付率、已签约、签单率。员工生产布局现按批准稿恢复 `290rpx` 薄荷 Hero、按源顺序排列的 `3+2` KPI 矩阵和一条图标化四阶段路径，不再使用旧的通用五卡加重复数值路径。路由专属透明 PNG 映射为 `images/operations-dashboard/{staff-data-designer-v1,staff-data-measurer-v1,scheme-delivery-kpi-v1,signing-rate-kpi-v1}.png`；每张均由独立业务素材生成或组合、完成调色板优化且小于 300KB。员工分支仍没有签约金额、金额趋势或全店文案。Bootstrap 与客户端路由守卫新增 `staff.data`；设计顾问 Tab 为「工作台 / 数据 / 客户 / 设计 / 收益 / 我的」，现场顾问为「工作台 / 数据 / 客户 / 收益 / 我的」，负责人保持「工作台 / 经营 / 客户 / 提成 / 我的」。原生 `tabBar.list` 仍为五个注册页面，自定义栏在 `390x844` 基线安全呈现设计顾问六项。认证态原生胶囊截图待用户手工复核。

2026-08-28 的工作台视觉校准不改变任何路由、API、权限或服务端数据契约，只恢复已批准入口卡的光学尺度与节奏：中枢标题 `34rpx`，主入口标题/说明/CTA 为 `36rpx`/`26rpx`/`28rpx`，次级入口为 `32rpx`/`24rpx`；活动码插画使用 `220rpx` 图盒（`<=360px` 时为 `184rpx`），停在标题和说明下方。预约行为 `80rpx`，原生展示真实 `payload.appointments.length`；`72rpx` 经营提醒行增加标题分隔线，并让两组真实指标均匀排布。洞察卡恢复为 `176rpx`，`40rpx` 圆形箭头独占底部操作带，人员负荷插画固定在右下 `120rpx × 96rpx` 图盒。优先事项 CTA 高度仍为 `52rpx`，圆角收至 `10rpx`。认证态 `390x844` 运行核验仍待用户手动截图。

### 小程序统计数值统一格式

所有紧凑 KPI、汇总卡、徽标、点数和数量显示统一复用原生模板 `miniprogram/utils/stat-format.wxs`：`stat.count` 保留小数值原样并将大数缩写为 `1.5千`、`5万`、`100万`；`stat.money` 始终把单位与数值连在一起，输出 `5万元`、`10万元`、`100万元`，再按量级切到 `亿元`/`万亿元`；`stat.percent` 去除无意义的小数零。该格式已覆盖工作台/经营、日程、推广和收益汇总、提成汇总、我的、服务/档案数量、线索交付数及 AI 配方/方案/历史/结果统计。提成台账行、线索签约详情、可编辑表单值和其他需要对账的明细金额刻意不接入，仍显示精确值。本次仅为 WXS 展示层调整，不改变路由、API、权限、数据契约、既有结构或批准素材；受影响页面的 `390x844` 原生胶囊运行态仍待用户手动截图作最终视觉确认。

预约记录保存手输服务详细地址，并可选保存微信地图 `gcj02` 位置（`locationName`、纬度、经度）。预约页保留楼栋/单元/门牌手输并接入原生 `wx.chooseLocation`；已分配家装设计顾问、家装现场顾问或企业负责人可用既有带版本审计的 `POST /api/appointments/[id]/address` 更新同一地点。该接口先解析小程序员工身份再回退 Admin JWT，家装现场顾问按 `staff._id === appointment.measurerId` 授权，而不是微信用户 id。创建或更新预约时，若线索 `communityName` 为空，同一事务会优先用地图 `locationName`、否则用手输上门地址回填（截断至 160 字；已有小区不覆盖）。预约详情仍保留员工对历史空小区的显式同步（`PUT /api/leads/[id]`）。已保存坐标的确认预约可由有权查看者使用原生 `wx.openLocation` 导航，家装现场顾问日程的“导航”快捷入口也复用该坐标。历史纯手输预约仍有效，但会明确提示未记录地图位置；推荐人不接收精确地址或坐标。

### 身份切换卡片展示

`packages/business/identity-switch/identity-switch` 将服务端返回的每个有效身份
上下文放入双列原生卡片。包括「家装设计顾问」「家装现场顾问」在内的岗位名称始终完整
可读；点卡仍只做本地选择，只有既有原生确认才会交换签名上下文 token，并明确标出当前
上下文。岗位工具图为独立生成的透明 PNG，位于
`packages/business/assets/identity-switch/role-cards/`；不将已批准的复合设计稿切片打进
运行包。本变化不改变路由，也不改变 `GET/POST /api/miniprogram/identity-contexts` 的权限契约。

| 界面 | 运行路由 | 当前合同 | 状态/限制 |
| --- | --- | --- | --- |
| 家装设计顾问抢单池 | `packages/enterprise/lead-claim-pool/lead-claim-pool`；`pages/index/index` 的家装设计顾问工作台态 | 已批准抢单池设计在胶囊安全区内新增独立池页，并在工作台增加待抢提醒/数量入口。`GET /api/lead-claim-pool` 返回服务端时间、截止时间、可抢状态、容量状态，以及领取前仅有的脱敏身份/片区、面积、风格、来源。页面用服务端时间校准倒计时并每 3 秒刷新；加载、空态、关闭、过期、容量满、并发失败和成功状态沿用批准构图。`POST /api/leads/[id]/claim` 携带客户端幂等键，成功后才进入完整线索详情。「开启抢单提醒」是用户主动触发、仅针对可选 `lead_claim_available` 模板的 `wx.requestSubscribeMessage`。推荐人、手工录入、家装现场顾问活动码和企业负责人活动码线索在开启时进池；家装设计顾问活动码仍直接归属 | Implemented/Limited；仅当前签名企业内活动且可派的家装设计顾问可抢。即使 worker 延迟，超过服务端截止也不能领取。可选微信模板须运营配置并由用户授权，站内记录始终为准。批准设计源：`design-references/lead-claim-racing-v1/designer-lead-claim-pool-v1.jpg` 及同批状态稿；登录态 `390x844` 原生胶囊截图待补 |
| 首页与量房入口 | `pages/index/index` | 客户「服务」首屏已按批准的“三项免费权益”阶段陪伴设计还原（`docs/superpowers/specs/2026-08-25-customer-service-home-three-free-design.zh-CN.md`）：胶囊安全的单一绿色主场景优先凸显「免费效果图 / 免费家装设计顾问 / 免费家装现场顾问」，完整小 K 只出现一次并手持三张语义权益牌；三张权益卡现使用按批准设计生成并打入主包的路由专属 `effect-room.jpg`、`design-advisor-3d.png` 与 `onsite-advisor-3d.png`，不再用通用效果图/灯泡/定位线性图标冒充设计插画；无媒体状态下阶段文案与四步进度同排，再进入操作按钮行；跨层原生服务票据继续消费服务端派生 `serviceStage`/`nextActionKind`、唯一一条客户可读 `appointmentSummary`、连线式四步进度、仅真实正式户型/已发布方案缩略图，以及现有主动作（预约/改期/重约/等待/服务档案），主动作与档案动作同时存在时并排显示。客户服务票据在本路由弱化「上门」：标题为「待预约量房 / 已预约量房 / 量房进行中」，说明为「可预约量房时间」，主动作为「预约量房」；员工工作台与预约页的上门用语不变。三张原生权益卡保持既有行为：效果图进入当前线索的交付方案册 `customer-ai-schemes`（空态扫码领取，尚未发布时进入同一方案册空态），设计顾问进入共享微信联系流程，现场顾问进入预约/改期/档案路径；空态/早期态不虚构媒体。保障条把「三项服务不收费」与按真实阶段派生的状态并列。身份栏保留服务码/邀请码扫码并去掉铃铛；`GET /api/miniprogram/customer-projects` 继续供给紧急度排序与 `N = length − 1` 多项目切换，`customer-projects` 仍只做深链重定向壳。路由、API、权限、媒体和阶段派生边界均不变。 已签名家装设计顾问和家装现场顾问均进入共用角色工作台；现场顾问的蓝牙连接、`measurer-calendar` 日程和请假入口现排在共用获客中枢之后，既有 `ble-connector` 仍可用；正式量房仍只从已指派任务卡进入（立即量房 / 继续量房 / 新增量房），不从 Hero 直进编辑器。家装现场顾问工作台按客户线索聚合：同一线索重约后，新的 `confirmed` 预约会替换此前的 `expired` 预约，不会在任务卡和计数中重复；没有有效重约时只保留最新一条过期待处理预约，量房日程仍保留完整预约历史。无户型的待量房任务卡仍显示「立即量房」和「预约上门」；活动码已锁定家装现场顾问但家装设计顾问仍待派时，任务卡徽标保留「待量房」、meta 显示「未预约上门」，不再与企业侧「待派单」并排造成歧义；草稿户型同一卡片改为「继续量房」（带入 `floorPlanId`）和「新增量房」，并隐藏预约上门。正式 v4 户型提交后仍留在工作台待上门队列（徽标「待确认完成」，阶段 `survey_ready`），直到预约详情「确认完成量房」把预约打成 `completed` 才退出队列与「待量房任务」计数；已提交正式户型的过点 `confirmed` 预约不会被过期任务改成 `expired`；已签约/已关闭线索的已确认与过期预约同样退出测量工作台（`shouldIncludeMeasurerWorkbenchAppointment`），量房日程仍保留完整预约历史。已确认预约若已挂户型且阶段为 survey_ready，工作台主按钮改为「确认完成量房」（进入预约详情），「继续量房 / 新增量房」降为次要；上门完成前仍可打开已保存墙图。企业负责人「经营」现以 `design-references/enterprise-owner-activity-code-entry-v3/enterprise-owner-operations-home-v3.png` 为当前设计源（自定义周期 sheet 仍沿用 `18c-enterprise-ops-dashboard-filter-sheet.jpg`）：身份栏不再放扫码/提醒，胶囊行居左 Logo +「家客来 · 家装设计顾问端」等端名，企业名叠在「家客来」下方并控制在胶囊高度内，登录用户姓名显示在绿色 Hero 标题上方、Hero 胶囊（待派单/待量房/待交付）、快捷入口（待处理线索/人员负荷）、可筛选经营大盘（chips：本周/本月默认/本年 + 自定义 bottom-sheet；负责人把同一套五项只读 KPI 重组为规则三列「新增线索 → 已完成量房 → 已签约」经营路径；第二阶段详情使用 `schemeFacts.publishedLeadCount` 的周期统计「已发布方案 N 份」及次级「方案交付率 / 签单率」效率卡；副标「全店 · …」，负责人可展示签约金额 detail；浅薄荷异常行动托盘的文字、数据、状态和点击区域仍为原生节点；V3 业务插画仅使用映射到 `images/operations-dashboard/enterprise-guide.png`、`lead-inbox.png`、`staff-load.png` 的 ImageGen 独立透明切图）、获客优先的 Hero 双入口：白色主卡「分享活动码」并显示「发给客户 · 扫码留资」（复用 packages/business/staff-activity-code/staff-activity-code 出示页及真实分享；负责人码按门店获客进入抢单/赛马，不把负责人绑成家装设计顾问或现场顾问），白色次卡「邀请入驻」并显示「员工 · 推荐人」（进入 packages/business/enterprise-join-codes/enterprise-join-codes，可生成/换新/停用；确认弹窗 confirmText 控制在微信 4 字以内，避免生成按钮静默无响应），获客双砖下方整行「已入驻推荐人」进入 packages/enterprise/enterprise-referrers/enterprise-referrers，与异常监控卡片（待派失败进线索详情、过期未重约进预约详情、人员缺口「查看详情」与「人员负荷」进入 `packages/enterprise/enterprise-staff/enterprise-staff`——仅企业负责人可读家装设计顾问/家装现场顾问名册，并通过 `GET/PATCH /api/miniprogram/enterprise-staff` 暂停/恢复派单；微信号/二维码仍由本人在「我的」补齐，空态 CTA 出示入驻码），数据均来自 `GET /api/miniprogram/workbench?period=`。家装设计顾问/家装现场顾问的周期五卡大盘已从首页移入角色化原生「数据」Tab，仍只读本人五项事实且不含签约金额。隔离工作台任务卡 CTA 图片（「立即量房」及同排电话/导航等）显式为 `28rpx`，避免落到微信 `<image>` 默认 320×240。家装设计顾问工作台概览下方不再展示静态「常用配方」条；快捷入口「风格配方」仍进入设计 Tab。Hero「待交付」统计方案设计中且尚无客户可见方案的未归档线索；发布方案或标记已签约后离开该数。经营大盘「已签约」仍按周期 `convertedAt` 计数。本地 `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` 开关会跳过最近户型加载并直接新建量房 | Implemented/Limited；未登录访问该首页根路由时停留在批准的客户「服务」空态/早期三项免费权益陪伴页，便于先浏览再自行去「我的」登录，不再立刻 `switchTab` 到登录入口；旧营销首页壳仍不是第二套未登录页。未登录会话复用客户「服务/我的」TabBar；手机号/头像/昵称授权仍只在登录页由用户主动发起。角色工作台读取服务端派生的 `GET /api/miniprogram/workbench` 与客户列表/详情的 `serviceStage`/`nextActionKind`，禁止再各写一套阶段文案。大盘签约事实仅为只读 KPI（`status=converted`，周期用 `convertedAt`），首页仍不做签约/改状态操作。冷启动期间，自定义 TabBar 与角色页面会先从本地已签名 `mode/staffRole` 上下文推导首屏。客户 TabBar 仅保留「服务/我的」。Tab 徽标来自 bootstrap 真实待办计数（客户待预约/待改期/待重约、家装设计顾问待跟进与过期、家装现场顾问工作台今日/任务合并到工作台 Tab、家装设计顾问/家装现场顾问待支付收益、负责人异常含过期未重约）；失败显示「暂时无法读取」，禁止本地填 0。新增角色态尚待登录态 `390x844` 原生胶囊核验。旧版营销首页壳不再调用 `wx.getLocation` 或 `POST /api/location/reverse`；已签名角色直接渲染 `role-workbench`，残留城市文案仅来自资料/小区派生。|
| 线索与客户 | `pages/leads-management/leads-management`、`packages/enterprise/lead-form/lead-form`、`packages/enterprise/lead-detail/lead-detail`、`packages/business/customer-ai-schemes/customer-ai-schemes` | 线索列表/详情、签约状态、正式户型摘要；员工客户列表可临时按 `referrerMembershipId` 筛选（来自员工分支页「查看推广客户」，顶部可清除；离开 Tab 再回自动清除）；列表卡把小区单独放在手机号下一行（最多两行截断），不再与户型缩略图挤在同一信息行；详情 Hero 的绿色文案区向右延伸，斜切边停在小K左侧，小区在最大 360rpx 文案区内提前换行并加浅字影，长白字不再落到右侧浅色背景；列表缩略图优先经 `fetchProtectedImage` 拉取正式 `previewUrl`（`GET /api/floorplans/[id]/preview`），其次酷家乐 `externalSource.previewUrl`，最后 CSS 墙线段。未归档线索详情 Hero 将「补充资料」绝对定位于卡片右上角并配已打包编辑图标（只读状态胶囊保持纯文字）；客户手机与员工电话行使用共享 `.sfp-icon-action` + 电话 PNG 可拨打（白底已抠透明，Hero 电话行与文案区左对齐，电话图标在号码后面，并保留「手机：」+ 号码）；Hero 与阶段轨之间展示已派家装设计顾问与家装现场顾问的姓名和电话（`GET /api/leads/[id]` 的 `assignedTo`/`measurerId` 员工摘要；未派显示待分配）。每张卡右侧在 `assignmentActions.canAssignDesigner` / `canAssignMeasurer` 为真时显示「分配」或「更换」（24rpx 品牌绿，不抢电话点击）；选人走 `GET /api/leads/[id]/assignable-staff?role=` 并提交 `POST /api/leads/[id]/assign-staff`，可补齐或覆盖；家装现场顾问看不到改派操作；企业负责人、负责家装设计顾问与已派家装现场顾问进入 `lead-form?mode=edit`（微信默认导航栏、原生返回）经 `PUT /api/leads/[id]` 更新称呼、手机、小区、面积和风格；小区名称同时支持原生 `wx.chooseLocation`（写入 POI 名，截断至 160）与手输，交互对齐预约页的选点+输入，坐标不写入线索；企业负责人仍从客户列表新增客户（`source=manual_entry`）；新建线索走与推荐网络相同的家装设计顾问/家装现场顾问池子自动派单；同一企业未关闭线索若手机号相同（含微信 `86` 区号写法）则复用并绑定该微信客户，扫码领取也会挂到已有手工线索而不是再生成一条「微信客户」。签约快照家装设计顾问和家装现场顾问两条提成。负责家装设计顾问在尚无有效预约时可进入首次预约，活动线索的已派家装现场顾问也可当场预约；客户本人也可从「服务」首屏和项目册进入同一服务端预约流程。自动派发的家装现场顾问与待确认的上门时间分开显示。家装设计顾问、家装现场顾问与企业负责人的「客户」Tab 共用同一 `leads-management` + `lead-list` 壳；列表范围仍按角色收窄（家装设计顾问 `promoted-or-assigned`、家装现场顾问 `measurer`/`measurerId` 与工作台待量房队列一致、企业负责人看租户内客户），仅企业负责人可新增客户；负责家装设计顾问可在本人客户线索详情开始、继续、新增或删除正式量房；已派家装现场顾问仍从本人工作台任务进入正式量房，企业负责人则可在本企业任一客户线索详情开始、继续、新增或删除正式量房。家装现场顾问今日待上门/待量房队列留在工作台概览，不再复用客户 Tab。`GET /api/leads/[id]` 现已统计有效 AI 发布记录并据此派生 `serviceStage`/`nextAction`，且 `publishedSchemes` 按 `firstPublishedAt` 排序、图片含 `stageKey`/`publishedAt`；线索详情将预约 CTA 并入「正式量房」卡（不再单独上门量房容器），预约钮与「开始量房」/「继续量房」同时出现时同一排等宽 84rpx 胶囊（间距 16rpx），仅一个按钮时仍满宽；已有量房同时显示「新增量房」与删除时，第二排也使用相同的等宽双列、84rpx 高度、16rpx 间距和胶囊圆角；`survey_ready` 时该预约按钮文案改为「确认完成量房」；`survey_completed` / `converted` / `closed` 后隐藏该预约按钮（仅发布方案不结束补测预约），但正式量房卡仍展示房源事实（小区、面积、已存预约地址、闭合房间名）以及企业负责人/已派家装设计顾问/已派家装现场顾问可看的鉴权测绘 PNG 预览（`wx.previewImage`；负责家装设计顾问、企业负责人和已派家装现场顾问另可使用其已授权编辑操作），下方嵌入「房屋现场图」（`GET/POST /api/miniprogram/leads/[id]/site-photos`，先选客厅/主卧/次卧/主卫/次卫再拍照或相册，每户 30 张），已发布方案摘要进入只读 `customer-ai-schemes`（`mode=staff`）；家装设计顾问与企业负责人在未归档、未签约/未关闭的线索详情即可看到「进入 AI 设计」（量房完成前空态说明「可用现场图开始出图」，`survey_completed` 或已有完成正式户型时为「量房完成，可开始出图」）；已完成正式户型仍绑定 `floorPlanId`，否则 `openAIDesignEntry` 仅带 `leadId` 进入无户型 `rough_sketch` 方案台；已发布方案与 AI 入口同时出现时「查看全部方案」与「进入 AI 设计」同一排等宽胶囊（间距 16rpx），仅一个按钮时仍满宽；`survey_ready` 仍保留户型预览；负责家装设计顾问、企业负责人和已派家装现场顾问可继续已保存量房；设计 Tab 仍是通用创作入口。家装设计顾问工作台使用同一发布计数显示「方案已发布」徽标，优先展示尚未交付的待量房客户，并排除已签约/已关闭线索跟进卡片（平台以已签约结束推进）。带 JWT 的员工会话无需 legacy OpenID 也可加载线索列表。家装设计顾问/家装现场顾问/企业负责人「客户」Tab 只在首次进入、返回 Tab、筛选和手动下拉时请求列表，不后台轮询。推荐网络线索经现有签约接口进入 `converted` 时，服务端按来源快照三条或两条提成；活动线索不生成推荐人行 | Implemented/Limited；签约、客户所有权、预约入口、手动派单与预览权限由服务端执行，角色 Tab 条目按能力白名单生成；比例规则要求合同金额，已支付三方提成会阻止企业负责人撤销签约 |
| 报备与员工任务 | `packages/business/promotion-records/promotion-records`、`packages/business/promotion-record-detail/promotion-record-detail` | 企业报备和员工通知；渠道地推 bootstrap 落点于此（我的报备/公海/新建），TabBar 为「报备/我的」（页面内嵌 custom-tab-bar，图标复用 tab-home/tab-mine）；员工侧线索类订阅点击进 `lead-detail`，客户预约/方案发布点击进 `customer-project` | Implemented/Limited；微信投递可能被外部拒绝 |
| 推荐人网络、预约与匿名领取 | `packages/business/onboarding/onboarding`、`packages/business/enterprise-register/enterprise-register`、`packages/business/onboarding-debug/onboarding-debug`、`packages/business/referrer-workbench/referrer-workbench`、`packages/guides/referrer-guide/referrer-guide`、`packages/business/referrer-progress/referrer-progress`、`packages/business/referrer-earnings/referrer-earnings`、`packages/enterprise/staff-earnings/staff-earnings`、`packages/enterprise/enterprise-commissions/enterprise-commissions`、`packages/business/promotion-service-code/promotion-service-code`、`packages/business/staff-activity-code/staff-activity-code`、`packages/business/enterprise-join-codes/enterprise-join-codes`、`packages/enterprise/enterprise-staff/enterprise-staff`、`packages/enterprise/enterprise-referrers/enterprise-referrers`、`packages/business/free-design-service/free-design-service`、`packages/business/customer-projects/customer-projects`、`packages/business/customer-project/customer-project`、`packages/business/customer-ai-schemes/customer-ai-schemes`、`packages/enterprise/appointment-detail/appointment-detail`、`packages/enterprise/appointment-reschedule/appointment-reschedule`、`packages/enterprise/appointment-booking/appointment-booking`、`packages/enterprise/measurer-calendar/measurer-calendar`、`packages/enterprise/enterprise-appointments/enterprise-appointments`、`packages/enterprise/measurer-unavailability/measurer-unavailability`、`packages/business/identity-recovery/identity-recovery` | 按类型隔离的入驻、推广码、客户领取、项目和预约深层路由保持既有合同。平台开户扫码落地 `enterprise-register`：`POST /api/miniprogram/codes/resolve` 识别 `er_` / 裸 32 位 scene 为 `kind: enterprise_registration`（仅平台展示名，不伪造企业名）；`getPhoneNumber` 后 `POST /api/miniprogram/enterprise-registration`（Bearer JWT）要求授权手机号与 `contactPerson.phone` 一致，并与 Web `POST /api/auth/register-enterprise` 共用 `createSelfServiceEnterpriseApplication`（`pending_approval` / `self_service`）。UI 复用入驻页品牌锁/极简透气体，无独立设计稿、无新 IP 插画，并补领取页返回箭头以免开户码栈根无法离开；已签名身份从最近使用再次进入时不再粘在开户页，会话分享仍可打开表单。员工/推荐人 `ej_` 入驻仍独立。`referrer.network` 能力在不新增视觉体系的前提下扩展既有入驻码和名册：负责人得到企业员工码及本人推荐人码两个 Tab，家装设计顾问、家装现场顾问和渠道地推只得到本人推荐人码；入驻成员仍统一归企业，同时保留首个邀请员工。普通员工只读本人邀请的推广人，负责人可在包含 0 人与「历史未归属」分支的员工网络和扁平全企业名册间切换；停用仍仅限负责人，且不提供改归属动作。企业负责人预约调度页（`enterprise-appointments`）是从工作台「查看预约安排」`navigateTo` 进入的无 TabBar 二级页，已按 R03 `20-enterprise-appointments.jpg` 还原为独立调度列表：胶囊安全返回与标题「预约调度中心」、所选周期真实预约计数、本周/本月/本年芯片加自定义周期（选中区间显示在「自定义」芯片后，不进顶栏副标题）、所选窗横滑日期条与 `confirmed`/`expired` 卡片；仅当关联线索仍可推进时，过期卡才显示「需协调改期」与「查看预约」；早于今日、仍需协调的过期或已过结束时间的开放线索预约仍会出现在今日列表；归档或找不到关联线索时按 `closed` 水合，避免假「客户量房」卡片点进可用时段后报「线索不存在或已关闭」；`serviceStage` 为 `converted`/`closed` 时改为只读「已签约」/「已关闭」角标，隐藏 CTA 且不可进入预约详情（平台以已签约作为线索结束）；不新增调度 API、不展示面积/户型/家装现场顾问手机等接口未返回字段。`GET /api/miniprogram/customer-projects` 仅返回当前 JWT 客户本人未归档项目（中立免费设计服务名称），并供给「服务」首屏排序与切换；客户服务档案同样不展示企业品牌，但保留本人可读的真实服务事实。已退役的 `customer-projects` 路由仅为深链重定向壳（排序后进档案或回落「服务」Tab），不再作为产品列表；真实深层页仍是无 TabBar 的服务档案。服务档案的首屏交付方案标题使用接口返回的方案名渲染为“已发布{方案名}方案”，图片「详情」与「查看全部方案」进入只读 `customer-ai-schemes`（`mode=customer`，零生成零编辑；按轮次 chips + 交付时间轴浏览 `publishedSchemes`，预览走 `wx.previewImage`），底部联系家装设计顾问按钮保持水平垂直居中。推荐人进度页现为「客户」Tab：胶囊安全「我的推荐客户」Hero、记录编号卡片、实底「撤回」与 10 分钟内「恢复」。推荐人进度/收益以当前签名成员关系做授权边界；收益台账跟随当前提成行的 `beneficiaryUserId` 与 `payableAmount`（待支付更换受益人后旧人不可见、新人可见），仅返回脱敏客户标识、服务事实和本人提成状态，绝不返回手机号、精确地址、户型 graph、内部预约原因或设计文件。推荐人工作台顶栏品牌锁使用生产 `/images/home-ip-v1/brand-logo.png`（房屋轮廓 + JK），不再用绿色 `JK` 文字方块。身份栏与员工/经营端对齐：胶囊行居左 Logo +「家客来 · 推广端」，登录用户名叠在「家客来」下方并收进同一胶囊高度（无姓名时隐藏，长名单行省略）。推荐人工作台选择企业会先交换签名成员关系上下文并刷新会话，因此服务码、进度和收益始终使用同一边界。手机号授权前，有效入驻码会解析码类型和企业展示名称；推荐人授权手机号后必须填写真实姓名，才会调用 `POST /api/miniprogram/onboarding/referrer`；已签名客户若已有未关闭归属，领取页返回已有服务档案而不是新领取成功。领取/登录对 `staff_phone_linked_to_other_user` 提示“该手机号已绑定其他微信账号…”，引导换本人手机号或联系管理员。推广服务码、员工活动码与客户领取页已按极简透气版 09–13 还原出示、确认、手机号授权、已分配家装设计顾问和待匹配态。设计 09「请扫码」牌、出示 CTA 与企业双码出示牌复用已打包的 `images/mine-icons/scan.png`（牌面家客绿、绿色主钮白色）。开发版 `onboarding-debug` 可选择本地小程序码进入同一真实流程。预约动作继续按家装设计顾问、家装现场顾问、企业负责人和客户边界执行；关联线索已签约、已关闭或已归档时，预约详情隐藏改期/取消/重约/量房等变更操作；内部改期原因改为选填，填写时保留在预约事件审计中；推荐人工作台保留「退出该企业」，不再放置切换身份或退出当前账号（改由「我的」承担）；身份失效会进入独立恢复页后重新登录 已批准的推广人三步引导以原生 WXML/Less 落在独立 `packages/guides` 分包，三张生成式透明 PNG 不进入主包；推荐人工作台加载后按本地已签名账号/角色/v1 仅自动打开一次，「我的」可重复查看，深链要求 `referrer.promotion`，跳过返回来源页，末页进入当前成员关系的服务码。个人用户不强制出现，在其独立设计批准前不发布客户占位引导。 | Implemented/Limited；平台企业开户页已 Implemented 并有聚焦合同测试。推荐人首次入驻、登录和带 JWT 的冷启动会进入推广工作台；已用真实登录态推荐人在 `390x844` 核验登录完成与冷启动，并保存包含原生胶囊的宿主截图。工作台现可进入当前企业的服务进度和本人收益，客户项目与预约 API 继续执行所有权、岗位权限和乐观锁；身份列表暂时不可用时不阻断推广工作台；切换身份入口仅在「我的」。客户可见项目页面统一采用“免费设计服务/免费设计与量房服务”中立文案，企业名称仅保留给内部/推荐人页面。客户扫码后的手机号授权页不展示装修公司名称（含员工活动码落地）；员工活动码出示页仍可显示企业名称。第 12 阶段已按 bootstrap 显示当前可执行的推荐人/家装现场顾问入口，并在失效时清除会话且不展示失效企业；企业预约调度页、开户页，以及变更后的个人入驻码/负责人推广网络/员工本人名册状态，其登录态 `390x844` 原生胶囊截图待用户手工提供；新增客户项目、推荐进度、收益页与客户 AI 方案册待真实登录态 `390x844` 核验，测量任务聚合、预约/方案发布登录态动作与完整角色生产 UI 仍待补，微信投递依赖外部配置 |
| 平台管理员审核与设备 | `packages/platform/enterprise-review/enterprise-review`、`packages/platform/enterprise-review-detail/enterprise-review-detail`、`packages/platform/devices/devices`、`packages/platform/registration-code/registration-code` | 自定义 Tab「设备 / 审核 / 我的」（分包页 `reLaunch`；审核与开户码出示不得写入原生 `tabBar.list`）。设备页沿用原 BLE 录入/列表合同（`GET/POST /api/miniprogram/devices`）。审核默认 `GET /api/miniprogram/platform/enterprises?status=pending_approval`；`q=` 在当前 chip 内按名称、信用代码、联系人电话搜索。详情含状态事件；`POST .../enterprises/[id]/status` 与 Web 共用 FSM、开通负责人和 `enterprise_join_result`。状态 chips：待审核 / 全部 / 已拒绝 / 已停用。通过走 `wx.showModal`；拒绝/停用半屏填 4–200 字原因；电话行 `wx.makePhoneCall`。审核顶栏「开户码」与「我的」「出示开户码」进入只读 `er_` 出示页（`GET /api/miniprogram/platform/enterprise-registration-code` 与 `/image?variant=poster`，与后台「查看不换新」共用 `revealActive` + 服务端海报合成；不换新/不停用）。全幅展示合成开户海报并支持长按保存；视觉沿用设备工作台胶囊顶栏，不新画小 K、不展示 AI/自动化密钥。`counts.review` 为待审核徽标。误入 `pages/index` 会 `reLaunch` 到设备落点 | Implemented/Limited；仅 Mini JWT `admin`/`super_admin`。换新、停用与码环境仍留 Web。登录态 `390x844` 原生胶囊截图待你提供 |
| 提成记录 | `packages/business/commission-records/commission-records` | 适用商业角色的订单提成；签单成功后的员工提成微信订阅复用 `workflow_todo`，点击进入本页 | Implemented；结算仍由后台业务控制 |
| 签约提成生命周期 | 共用 `POST /api/leads/[id]/convert` 与 `POST /api/leads/[id]/revert-conversion`；企业负责人提成台账 | 签约在租户事务内快照岗位提成。撤销签约把完整作废行快照保存在 `conversion_reverted` 生命周期事件元数据中；同一线索重新签约时按新合同金额、当前规则和当前受益人刷新原行，清除上一轮作废/调整运行态并恢复为 `payable`，不会继续停留在 `voided` | Implemented/Limited；仅企业负责人可撤销签约，任一提成已支付都会阻止撤销 |
| 灵感库 | `packages/business/inspiration/inspiration` | 租户范围内灵感浏览和详情 | Implemented/Limited；媒体供应商为外部服务 |
| AI 设计工作流 | `pages/ai-design/ai-design`、`packages/ai-workflow/*` | 设计 Tab 与 recipe-project 继续作为创作入口。`scheme-studio` 现按批准的三态 Composer 稿 `design-references/ai-design/unified-entry-v2/21-studio-composer-v4-three-states.png` 还原：折叠态左侧整块为**本轮配置入口**（模板封面、**选择模板**、**设计整屋 · 参考图 1 张**、**调整**右箭头），右侧为独立**生成**按钮；折叠态输入框、费用条和展开编辑行已移除，点击配置块进入本轮配置；展开态在提示词上方保留这三个快捷入口，已配置项以绿色背景呈现且切图、文字反白为白色。**模型**、比例、分辨率、张数、软装子类型和其他技术项统一收进「更多设置」。配置弹窗允许随时修改设计目标、模板和参考图；其中**提示词模板**整行可点击，模板卡片的名称或操作区均可选择，封面仍用于预览；选择设计整屋时，将绑定的正式户型图显示为锁定的**参考图1**，其后展示图库/用户上传参考图。配置内容在矮屏溢出时仍可滚动，但固定内容态不再显示右侧原生滚动条。移除原**输入依据**文案和首页独立的户型/模型/模板/设置控件。设计单间缺少现场图点击生成时直接打开该配置弹窗，用户可在其中补充现场图，不再停在无效提示。展开态字数计数器现在占用原生文本域下方的独立底栏，长提示词只在自身区域滚动，不会再覆盖 `当前字数/2000`。发送/重命名确认动作使用显式受约束的等宽原生按钮，避免 Android/微信 WebView 把主按钮绘制到面板外。模板提示词、`renderMode`、批次/API、租户/权限、配方、发布、重试和弹窗合同不变。运行态证据已登记到还原台账。 | Implemented/Limited；供应商、点数、资格、发布可见性和范围仍由服务端控制；无后台画布标注精修、无深色主题；三个批准 Composer 状态此前已在真实 `390×844` DevTools 运行态完成核验，本次交互、已配置状态与整卡点击修复后的运行态 QA 待用户手动截图确认。 |
| 我的与账号 | `pages/mine/mine`、`packages/business/login/login`、`packages/business/legal-webview/legal-webview`、`packages/business/profile-edit/profile-edit`、`packages/business/settings/settings`（兼容深链，内容已并入 Mine Tab）、`packages/business/identity-switch/identity-switch`、`packages/business/identity-recovery/identity-recovery`、`packages/business/account-security/account-security` | 账号安全、微信系统权限设置和当前版本检查（使用重新导出的绿色圆角线性 `images/mine-icons/{permission-management-v2,version-check-v2}.png`）及服务端身份上下文选择；登录页保留已批准的协议行并加大整行点击范围，勾选后才挂载微信 `getPhoneNumber`，避免原生按钮抢走勾选点击或未同意即授权。手机号授权优先使用微信动态 `code`；旧客户端只返回 `encryptedData`/`iv` 时，登录、入驻、开户和匿名领取仍可提交，这些页面会在点按钮前预取 `wx.login`，把该缓存 login code 与密文一并交给服务端用对应 `session_key` 解密，且不得在 `getPhoneNumber` 回调里再次 `wx.login`。《用户协议》《隐私政策》用 `catchtap` 打开 `legal-webview`，加载 `https://smartfloor.zlyun168.com/user-agreement.html` 与 `https://smartfloor.zlyun168.com/privacy-policy.html`（地址写在 `utils/legal-docs.js`）。《免责协议》仍保留在 `legal-docs.js` 与托管页，登录协议行暂不展示。`listContexts` 返回该微信用户全部 `status=active` 员工上下文（按 `staffId` 升序），不再只取第一行；`GET /api/miniprogram/bootstrap` 返回当前角色、有效角色组、企业/成员关系、落点、能力白名单和按角色范围统计的服务端徽标摘要；切换会交换签名 token，登录、入驻、领取、切换和冷启动均先刷新并校验 bootstrap，再通过统一身份导航进入已签发落点；`identity-navigation` 对未知身份和越权深链返回明确拒绝；失效的签名上下文跳转至恢复页，清除旧会话并要求重新登录 「我的」在账号任一有效身份（bootstrap.roles / identity-contexts）已登记已批准引导时显示原生「角色使用引导」账号行，不因当前切到个人用户而隐藏；现阶段覆盖推荐人、企业负责人、家装设计顾问和家装现场顾问。当前身份有引导则直接打开，否则回看已有身份的引导（多个时用原生 ActionSheet 选择）。仅有个人用户、且没有上述工作身份时仍不显示，也不放置未批准占位引导。 | Implemented/Limited；访客已使用批准的满屏版胶囊安全 JoveKore｜家客来入口：独立打包的绿色门厅场景、原生「个人用户 / 员工 / 推荐人」身份轨道与唯一可执行「立即登录」动作共同填满未登录「我的」；更高密度的构图不改变路由、API 或权限边界。未登录访客复用客户「服务/我的」TabBar，以便先浏览服务首页，登录仍由「我的」发起。只有 bootstrap 或本地已签名身份才按能力白名单生成导航：客户“服务/我的”，推荐人“推广/客户/收益/我的”，家装设计顾问“工作台/数据/客户/设计/收益/我的”，家装现场顾问“工作台/数据/客户/收益/我的”，渠道地推“报备/我的”（promotion-records + mine；不进家装设计顾问/家装现场顾问 role-workbench 壳），企业负责人“工作台/经营/客户/提成/我的”，平台管理员“设备/审核/我的”。平台管理员「我的」走角色壳员工资料卡加权限/账号行（含出示开户码），不再渲染旧版「我的空间档案」「我的户型」「开始量房」。渠道地推「我的」走 `GET /api/miniprogram/mine` 员工看板（新建报备/公海/我的提成），不按客户/推荐人受限壳处理；若落到 `pages/index` 则 `reLaunch` 到报备页。服务端下发的「我的」动作现按 `referrer.network` 生效：家装设计顾问、家装现场顾问和渠道地推显示「我的推广人 / 邀请并查看我的推广人」，企业负责人显示「推广网络 / 查看员工分支与全部推广人」，均进入既有 `enterprise-referrers` 深层路由。 重新导出的绿色圆角线性 `images/mine-icons/referrer-network-v2.png` 由所有获准范围的该「我的」入口共用。共享自定义 TabBar 为收益/提成使用成对的中性灰/品牌绿 `tab-earnings` 图标，为企业负责人「经营」使用已打包 `operations-dashboard/chart.png`；该经营页已写入原生 `tabBar.list`，点击走 `switchTab` 而不是静默失败；其余行为仍绘制服务端徽标计数，摘要不可用时显示「暂时无法读取」。“我的”Tab 已去掉「订阅任务通知」与登录/入驻/领取订阅弹窗；资料卡下方「权限」区仅保留微信权限管理（`wx.openSetting`），「账号」卡内为「编辑资料」（进入 `profile-edit`）、当前身份（复用推广工作台「切换身份」两行说明「在个人用户、员工和推荐人身份之间切换」）、账号与安全和退出当前账号；顶栏不再放置「编辑资料」芯片；推广工作台不再重复放置切换身份或退出当前账号；右上角齿轮入口已移除，`settings` 路由仅作深链兼容并 `switchTab` 回“我的”。推荐人/客户 JWT 状态会按签名上下文刷新 `/api/miniprogram/profile`，资料卡显示最新自设姓名及动态角色徽标；`profile-edit` 通过 `POST /api/miniprogram/profile/avatar` 保存昵称与可选头像（统一为 JPEG，签名投递 URL；`MINIPROGRAM_API_PUBLIC_ORIGIN` 的 `.example.com` 占位会回退到真实请求主机）。家装设计顾问还可在 `profile-edit` 自助补全微信号和个人二维码（家装现场顾问不强制二维码）：上传接受 PNG/JPEG（含空 MIME），不再解码或白名单校验，落库 PNG；上传控件为 `view`，选图前先 `hideKeyboard`，避免先填微信号再上传失败。资料页展示交齐/待补状态；家装设计顾问工作台在资料不齐时于 `primaryItems` 置顶 `action: profile` 待办并进入 `profile-edit`；每次进入工作台另查 `GET /miniprogram/staff/wechat-profile`，`assignmentEligible` 为 false（含只缺微信号或只缺二维码）即弹 `wx.showModal`「请先完善微信资料」引导「去完善」；切换统计周期刷新不会重复弹窗。聚焦布局与账号菜单回归测试已覆盖。撤权、停用或版本变化不展示失效企业数据，也不静默回落客户 |
| 推荐分享 | `packages/business/recommendation-share/*` | 只读推荐方案和项目摘要 | 受分享授权及可用资源限制 |

身份切换视觉说明：`packages/business/identity-switch/identity-switch` 现按已批准的双列卡片参考 `design-references/identity-switch-card-grid-v2/identity-switch-card-grid-v2.png` 落地，只使用原生布局：顶部为随本地选择身份更新的紧凑单个小 K 档案管理员预览，下方为双列身份卡与既有确认按钮。包括「家装设计顾问」「家装现场顾问」在内的所有岗位名均为原生文字完整呈现，不再使用横滑轨道或省略号。选中卡使用绿色描边与「当前使用」状态；`packages/business/assets/identity-switch/role-cards/` 内独立透明的岗位工具 PNG 分别识别 `customer`、`referrer`、`enterprise_admin`、`designer`、`measurer`、`salesperson`、`platform_admin`，不切片复用已批准的复合设计稿，也不在每张卡片重复小 K。当前身份的禁用 CTA 使用不透明薄荷绿底、绿色描边和深绿文字，避免与页面背景融合。点卡只在本地预览；仅在选中非当前身份后才露出既有原生确认与签名 token 切换。仅有一个有效身份时保留预览，但不制造无意义的切换动作。既有 `GET /api/miniprogram/identity-contexts` / `POST /api/miniprogram/identity-contexts/switch`、路由与权限边界均未改变。不支持的历史角色仍回退到客户向导图标，不会因此获得新能力。

### 线索详情推荐人标记

`packages/enterprise/lead-detail/lead-detail` 直接消费已按权限下发的
`GET /api/leads/[id]` `referrer.displayName`。线索存在推荐网络归属时，原生 Hero 右下角以既有
绿色「正式量房」标签样式贴紧右下角显示 **推荐人：姓名**；不改变列表范围、接口、角色边界或导航。没有推荐人的
线索不显示该标记。聚焦布局测试覆盖数据绑定与复用的视觉几何；`390x844` 原生胶囊宿主核验仍等待用户
手动截图。

## 列表分页

无界小程序列表共用 `miniprogram/utils/list-pagination.js`（`page`/`limit`，默认 20、上限 50），对应 GET 返回 `createPaginationMetadata`。`scroll-view` 列表绑定 `scrolltolower`；页面滚动的门户列表使用 `onReachBottom`（距离 120）。页脚文案为「正在加载...」/「已经到底了」，样式 `.sfp-list-footer`。筛选/搜索重置到第 1 页；汇总数字来自 COUNT，而不是当前页长度。

覆盖：`enterprise-staff`、`enterprise-referrers` 本人/扁平视图、`referrer-progress`、`referrer-earnings`、`staff-earnings`、`enterprise-commissions`（`status`）、`commission-records`（`status`）、`promotion-records`（`search`）、平台 `enterprises` / `devices`（仅已登记设备行）、线索详情 `assignable-staff`，以及配方选客户 `GET /api/miniprogram/ai/studio/leads`。不分页：负责人 `enterprise-referrers?view=network` 分支聚合、`customer-projects` 首页排序全集、工作台预览上限、身份上下文、日历/当日预约、蓝牙扫描会话、设备页企业选择器，以及已超时待办（`GET /api/workbench/todos`，内部仍截断 200 条）。

### 密码登录首次改密提醒

`packages/business/login/login` 与 `packages/business/account-security/account-security` 现实现当前密码登录合同。`/api/auth/miniprogram` 仅在待改密员工通过账号密码登录时返回 `requiresPasswordChange`，token 仍可携带该标记。登录页仍走常规 bootstrap 与角色落点，并用原生 `wx.showModal` 一次性提醒，用户可立即进入工作台和 TabBar。「去修改」会在落点后打开既有账号安全页，「稍后」留在角色落点。冷启动和 token 刷新不再拦截会话或重复弹窗。该标记不锁定小程序 API。`PUT /api/miniprogram/account/password` 仍清除 `admin_users.must_change_password`，既有页面随后清理本地会话并要求用新密码重新登录。微信授权与手机号快捷登录不触发该提醒。共用密码匹配返回 `invalid_credentials`，或在按密码筛选后明确返回 `ambiguous_identifier`。已登录会话不主动踢出，下次 token 刷新或密码登录时获取最新标记。状态：Implemented。设计源仍为 `design-references/miniprogram-airy-minimalist-v1/30-account-security.jpg`，布局未改，登录态 `390x844` 运行时确认待用户截图。

## 小程序码环境

企业入驻码（`ej_`）、平台企业开户码（`er_`）、推荐推广码和员工活动码由后台平台管理员统一选择 `develop`、`trial` 或 `release`：`develop`/`trial` 使用 `getwxacodeunlimit`，`release` 使用 `getwxacode`。该设置只影响后续新生成的小程序码图片，历史图片保持不变。开户码与商户 `ej_` 入驻码语义隔离，勿混用。

## 入驻服务端诊断（Implemented）

既有入驻页调用的 `POST /api/miniprogram/codes/resolve`、`POST /api/auth/miniprogram`、
`POST /api/miniprogram/onboarding/referrer`、`POST /api/miniprogram/onboarding/staff` 和
`GET /api/miniprogram/bootstrap` 已接入服务端日志。重新部署 Admin 后，每次调用输出
`[MiniProgramRequest]` 开始/结果与异常诊断，包含单次请求编号（响应头 `X-Request-Id`）、
阶段、耗时、HTTP 状态及业务错误码；不记录数据体、查询字符串、凭据、手机号和异常/SQL 原文，
保留诊断错误码及源码位置。`404 / code_not_found` 属于既有业务拒绝，不能直接视为路由缺失。
全部 HTTP 请求仍以 Nginx 访问日志为准，操作见[实时日志](./production-deployment.zh-CN.md#实时请求日志)。
请求/响应体、UI、设计源、客户端环境选择、导航、认证、租户边界和持久化均不变。
测试验证五个真实入口及诊断隐私/响应保持；线上扫码复现仍待运维证据。
上述请求诊断部分仅改服务端；下方服务码刷新同时改动小程序，发布时需要重新编译上传，
视觉布局与设计源未改，因此不需要新增视觉截图验收。

## 推广服务码与员工活动码刷新（Implemented）

`promotion-service-code` 与 `staff-activity-code` 每次 `onShow`（包括从其他页面返回）
都会重新读取码元数据和微信图片。图片请求带缓存随机值，共享加载器校验 PNG/JPEG 文件签名，
每次写入独立本地路径，删除被替换文件，并忽略页面隐藏/销毁后的迟到响应。
既有重试与资料补全状态继续使用；新响应完成前会清除分享路径，未新增按钮或视觉素材。

Repository 现在会校验活动推广码/员工活动码的 active 记录哈希是否与当前密钥、主体 ID 和版本
推导出的令牌一致。若旧记录由其他密钥生成，读取路径在持有锁的事务中换成可解析的新版本；
正常一致的记录继续复用，打开页面不会让有效码失效。该修复不改变扫码归因、身份、权限、路由或持久化
结构。需要部署新 Admin 镜像并重新编译小程序；已经分发的二维码图片无法远程修改。
## 平台企业开户 API

当前开户页的联系人手机号输入框支持手动填写，但提交前仍必须完成微信手机号授权并通过一致性校验；主按钮明确为「授权手机号并提交」，授权成功后自动提交，号码不一致时停留在表单并提示修改。该交互与本节 API 的 Bearer JWT 手机号一致性约束保持一致。

`POST /api/miniprogram/codes/resolve` 识别平台 `er_` 开户令牌（含裸 32 位 scene），返回 `{ kind: 'enterprise_registration', displayName: '家客来企业入驻', valid: true }`。`POST /api/miniprogram/enterprise-registration` 要求 Bearer JWT 授权手机号与 `contactPerson.phone` 完全一致，校验生效 `er_` 码后，通过与 Web `/api/auth/register-enterprise` 共用的 `createSelfServiceEnterpriseApplication` 创建 `pending_approval` / `self_service` 企业。平台审核与停用在后台 `/enterprises` 和小程序 `packages/platform/enterprise-review*`（`POST /api/admin/enterprises/[id]/status` 与 `POST /api/miniprogram/platform/enterprises/[id]/status` 均走共享 `applyEnterpriseStatusChange`：FSM、开通负责人、尽力发 `enterprise_join_result`）。平台管理员还可从 `packages/platform/registration-code/registration-code` 出示当前生效 `er_` 合成开户海报（`GET /api/miniprogram/platform/enterprise-registration-code/image?variant=poster`，查看不换新，长按保存）；非 `active` 企业不可作为小程序员工/推荐人工作台上下文。扫码落地页不再当成常驻首页：从微信最近使用/主入口/桌面冷启动（`1001`/`1023`/`1089`/`1090`/`1103`/`1104`）时，任何已签名身份都会离开落地页进入角色落点；真正扫码或会话分享卡片进入时任何已签名身份（含工作台）都留在表单以便申请。自定义顶栏复用领取页返回箭头（有上一页则 `navigateBack`，否则角色落点或「我的」），避免码把该页做成栈根后无法离开。同一套最近使用离开与返回箭头也覆盖 `ej_` 入驻页和 `rp_`/`sa_` 领取页。表单/成功/失败/恢复仍将「去登录」做成原生按钮，清掉开户时手机号授权留下的客户会话后 `reLaunch` 到账号登录（失败则落到「我的」访客入口）；审核通过后再次扫码若命中 `ACCOUNT_CONFLICT` 进入「该手机号已有账号」并去登录；授权手机号若已是工作台身份则进入已有账号态并用 `wx.showModal` 询问是否离开（同时钉住 `roleLandingRedirected`，避免会话水合抢走当前页）；确认后进入角色落点（落点失败则回退账号登录），取消则留在本页以便看清提示。进入场景以微信当前进入参数为准，热启动扫码不会被误判成最近使用再进。登录页 `mode=password` 不会再弹回开户表单。就绪表单未填齐企业全称、统一社会信用代码、联系人姓名时，主按钮保持 `--action-disabled-bg` 薄荷底但仍可点（不用微信原生 `#f7f7f7`，也不再把 `getPhoneNumber` 绑在未齐表单上以免点了没反应）：页上列出「还需填写：…」，点击后对应输入框标红并显示「请填写…」。三项填齐后一次点击完成微信 `getPhoneNumber` 授权并立即提交开户（不再二次点「提交」）。状态：API 与 `packages/business/enterprise-register/enterprise-register` 均为 Implemented；聚焦合同测试覆盖 scene/`er_` 还原、授权前解析、缺项字段提示、表单门禁一键授权并提交、手机号一致提交、登录/工作台退出、真正扫码时已登录工作台身份留在开户表单、最近使用再进入时已登录扫码落地页离开、栈根返回，以及审核通过后授权手机号先确认再离开。登录态 `390x844` 原生胶囊视觉核验待补。平台审核通过后，联系人手机号作为企业负责人登录账号，初始密码为 `123456`，并会把该手机号已有的小程序用户绑到新负责人账号。审核短信与小程序内进度查询仍不在范围。

## 正式量房

相邻房间闭合的已测内/外边对齐已修正（Implemented）：已确认墙即使与其他闭合房间的外边延长线共线，也保持闭合前的实体方向。内边与外边对齐必须保留差异；外边回接保留一个墙厚的连接段，不得把已测顶部墙翻向室内或吃掉净长度差。显式闭合与精确 Face 自动成房使用同一规则，未测推断连接段继续使用边界实体侧求解。新增 96 项回归覆盖 100/200/400 mm 墙厚、旋转/镜像、内/外边、直接闭合/提交后闭合、原房间与读数保持、正式保存/重载；这 96 项在旧闭合实现下全部失败。行为来源为用户确认的“右上角起步 → 向右 → 向下 → 向左”顺序及 `design-references/surveying/closure-face-alignment-20260907/{01-inner,02-outer,03-defect}.jpg`（图3是缺陷证据）。现有 UI/Canvas 样式、路由、API、权限、审计字段与 v4 外壳不变，不迁移已保存房间；`390x844`/长屏原生视觉核验等待用户手动截图。

本次核验：新增 96 项回归通过（旧闭合代码为 0/96），后台消费者 39 项、H5 55 项及 83 文件生成镜像检查通过。全量小程序通过 1,815/1,856；41 个失败测试名与修复前对照运行 1,719/1,760 逐项一致，包含工作区原有 `wall.use` 与冻结基线差异。日志在 `tmp/closure-face-alignment/`。生成后台镜像也包含工作区原有 validator/commit-preview 源改动，本次保留其行为。

相邻房间外墙对齐闭合已修正（Implemented）。松手确认原预览、继续拉墙或从预览直接点「合」时，保留可见端点，不再重新执行矩形吸附，把光标拉到内侧闭合引导线上。位于闭合房间墙角之外时，更近的可见外墙延长轴优先于相邻内侧矩形轴；端点已对齐回接边的外墙延长线时，提示和确认沿该外轴返回，再短桥接到拓扑角点，不延长最后一面已测墙，也不让回接墙与原共墙实体错台。显式手工/BLE 长度修正保留既有吸附规则，不把原本内边预览改吸到外边。行为依据为用户四图，保留在 `design-references/surveying/closure-outer-alignment-20260904/`，其中 `01-drag.jpg` 和 `03-expected-close.jpg` 为期望状态；生产墙体并集几何渲染 `tmp/survey-outer-alignment/closed-geometry.png` 已核对图 3 的连续墙角。25 项几何回归覆盖 100/200/400 mm 墙厚、旋转、镜像、预览直接闭合/先提交再闭合、已测墙长及原房间保持；编辑器回归覆盖松手、点「合」和撤销/重做。更新后的 `390x844` 与长屏真机画面仍待用户手动截图复核。现有布局、素材、路由、API、权限、测量审计及 v4 存储结构不变；不自动重塑已保存房间。

核验：完整 Phase 7 检查通过，含 1,145 项量房/编辑器测试、39 项后台消费者测试、55 项 H5 测试及构建、79 文件镜像/架构检查和性能门槛。全量小程序通过 1,634/1,648 项，剩余 14 项失败与 `surveying-module/legacy-kernel-phase0-baseline.md` 已记录清单逐项一致；`git diff --check`、中英文路由与证据检查通过。

`packages/surveying/editor/surveying-editor` 的手动顺/逆时针旋转，会按当前测绘
节点和活动预览点的旋转后投影边界重新居中；空白草稿仍保持屏幕中心世界点补偿。
该调整仅作用于视图，不改变 graph 几何、路由、API、权限或持久化 viewport 字段。
左侧两个操作分别使用独立生成的透明 PNG：
`packages/surveying/assets/icons/angle/{rotate-counterclockwise-v2,rotate-clockwise-v2}.png`，
以第一个按钮显式 `margin-bottom` 提供的 `24rpx` 纵向间距排列，不依赖 flex `gap`，箭头方向可清楚区分顺时针与逆时针。

云保存合同：自动保存、手动保存和提交完成统一进入串行队列；同一时间只允许一个请求在途，排队中的 `completed` 会升级并优先于 `draft`。首次创建请求携带持久化 `Idempotency-Key`，服务端唯一键 `floor_plans.create_idempotency_key` 让响应丢失后的重试返回原户型，不重复创建 floor plan。已有 `floorPlanId` 时客户端只发送一次 PUT；任何 PUT 失败都原样抛出，不清除 ID，也不降级为 POST。PUT 现在授权户型所有者或同企业关联线索的当前负责人，因此重新派单后的设计师/测量员可以完成另一岗位保存的户型。只有没有 ID 时才发送 POST。

户型写入继续保留正式 v4 外壳的 400 闸门。草稿与完成态均执行 `full` 校验；完成态还要求无待确认近闭合读数且至少有一个闭合 Space，且校验先于数据库写入和预览生成。无效数据返回 422，携带首个错误码/消息以及 `validation.mode/errors/stats`，服务端不修复客户端 graph。完整校验拒绝真交叉、未打断 T 接、不同节点 ID 的同坐标端点与共线正长度重叠；同时要求墙体按模式保存有效 `lengthMm` / `angleDeg`，三个测量内缩/延伸字段是非负整数且不得将有效实测长度压到零，`rawMeasuredLengthMm` / `closureAdjustmentMm` 以完整整数对出现且之和等于保存长度。没有原始仪器读数的零读数 `closure-merge` / `closure-bridge` 拓扑连接段仍合法。几何按整数毫米中心线和既有 epsilon 判定，不使用 350mm 吸附容差。手工和 BLE 复尺走相同的 full 不可变事务；独立闭合正交环只沿被测墙所在轴平差，后续垂直方向复尺不会覆盖前一次。开链与闭合复尺都会在移动节点前检查门窗容纳范围，无法容纳时以 `OPENING_REMEASURE_CONFLICT` 整笔拒绝，不自动拆墙或暗移门窗。

对无门窗、无共享节点、无分支的独立正交墙链，回到起点的残差按同轴墙实测长度权重分摊。既有 350mm 吸附容差不变；长、多拐角链只有在每墙均不超过“坐标长度 2%，且限于 25–150mm”的修正预算、总残差不超过 1000mm 时，才可使用额外累计误差。短环即使落在 350mm 内，只要需过度扭曲某一墙对，也会拒绝平差而不用微型桥接强行闭合。预览与确认共用同一方案，将直墙允许的 1mm 垂直轴偏差也纳入投影残差，保持每段方向和最小墙长，并在提供闭合前投影整条墙链；任何新的非相邻交叉、重叠或碰到外部墙都会拒绝该方案。确认后分别保存原始读数和派生闭合修正，后续端点内缩、共线合并和拆墙仍保持该追溯关系。

测量审计采用本地 write-ahead 队列：每次已接受的手工/BLE 编辑先持久化再上传，最初归属稳定的本地草稿作用域，获得 `floorPlanId` 后原子迁移并绑定每条记录。加载或保存时重试待发记录；超过 500 条只告警不截断，已绑定到其他户型的记录不会发送。门窗内嵌键盘连续编辑合并为一条最终手工审计，BLE 待确认墙提交后写入真实 `wallId`。17 字节 ATD 解析要求厂商定义的头/尾/CRC，保留原始帧、通知通道和接收时间，距离按大端无符号值、角度按大端有符号值解析；仅 350ms 内不同通道的相同完整帧去重，软件请求的迟到帧不会误当硬件按键读数。关闭编辑器会恢复进入前的整组 BLE 回调。上传同时发送正式顶层 `auditId` 和兼容的 `metadata.auditId`；正式量房要求非空且不超过 200 字符。PostgreSQL nullable `measurements.audit_id` 上的 `(floor_plan_id, audit_id)` 部分唯一索引是最终幂等保障：首次创建返回 201 / `deduplicated: false`，重复请求返回同一记录和 200 / `deduplicated: true`；既有 null 审计行不变。

这次稳定性加固保持所有原本正确的量房路径和界面不变：吸附/闭合容差、多房共享墙、Face 提取、墙体实体、Canvas、WXML/Less 和操作流程仍以当前效果为基线。除上述有边界的近闭合平差与复尺纠正外，定向纠正还覆盖四个内部隔墙缺陷：L 形分隔落到另一条边界时，复用外墙继续取源房间内侧，不再错误强制为 `offset`；确认首段小墙后再向对侧续拖时，预览会在首次命中的对侧边界截停，不再穿出房间；从两个闭合房间的共用墙向任一侧分隔时，拆墙前固化已经渲染的物理实体侧，避免拆分后 Space 顺序不同让其中一段反向错开一个墙厚；分隔线若会切入既有门窗，则在拆墙前拒绝，而不是把门窗归一到某一替换墙段。共用墙修复只改变受影响墙段的 `bodyNormalSide`；门窗冲突复用既有非布局 Toast，拒绝时中心线、测量面、门窗、Space、历史、路由/API/权限、WXML/Less 与持久化均不变。向外新建相邻房的既有效果不变。

当前可编辑末墙上的同轴反向回拖现优先于邻近起点/共享墙形成的闭合候选。目标仍位于该墙范围内且保留最小墙长时，只移动原墙终点，不再追加反向重复墙；回拖到上一转角时撤回整面末墙，并从该转角继续当前墙链，不创建零长或整段反向墙。已闭合、共享、分支、带门窗、非末墙或越过起点的编辑继续沿用原有校验。Canvas/WXML/Less、Toast 呈现、路由、API、权限与持久化 v4 结构均不变。

正式闭合确定性场景目录现包含 4,096 个组合，覆盖直角与斜墙轮廓、有效松手闭合容差、同墙相邻房、连续十字四房分隔、凹形房内最近边界分隔、外墙/分隔墙全部墙厚组合、手工/BLE 短段续量、紧邻拆墙点的安全门窗重映射、门窗冲突原子拒绝、正式保存恢复及自交闭合不可变拒绝，并组合旋转、镜像绕向、测量面、内外边吸附和直接/先提交再闭合动作。本次不改变 WXML/Less、路由、API、权限或持久化合同。

门窗拆墙合同：拆分宿主墙前，系统用门窗物理范围加上节点处一个当前/相交分隔墙厚的保护距离检查每个内部切点。切点接触或进入该范围时抛出 `OPENING_SPLIT_CONFLICT`，提示「分隔线压到门窗，请先调整门窗位置」；不可变事务不会留下半截墙、节点、Space、门窗或历史变更，直接松手、点「合」、手工输入和 BLE 输入均沿用既有 Toast 显示该提示。超过保护距离的安全门窗仍重映射到单个替换宿主墙段且世界坐标不漂移。当前仍不支持跨墙段开口，操作员需先移动或删除门窗后再重试分隔。

唯一量房编辑器是 `packages/surveying/editor/surveying-editor`，进入时
携带 `leadId` 和/或 `floorPlanId`。仅带 `leadId`、没有 `floorPlanId` 时先解析该线索的主户型，避免打开空白画布。`190rpx` 高的紧凑顶栏将 `132×88rpx`「导航测量」固定在左侧，避免原生 `cover-view` 裁切；其 `28rpx` 标签使用 `32rpx` 行盒，避免原生字形上沿被裁切。「引导 / 保存 / CAD / 完成」在剩余宽度内四等分，兄弟间距 `12rpx` 且不换行，确保 `390x844` 及更窄手机宽度下每个操作完整可见。权威合同见
[`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md)。

选中墙体是叠加在当前量房状态上的对象编辑操作，不是重置光标。若光标已经放置，墙体工具栏打开期间继续保留同一 `anchorNodeId`，并在原平面坐标显示准星；选墙不会移动、收回或重新创建光标。
`FloorPlan.layoutData` 只保存 v4 `surveyGraph`；已完成正式 v4 户型的 `POST/PUT /api/floorplans` 会把 `surveyCanvasRenderer` PNG 快照存到 `floor_plans.preview_asset_id`，不写入 `layoutData`。wall graph、Canvas、尺寸、BLE
读数、审计队列、撤销/重做和正式量房入口默认值都遵守同一合同：引导模式默认关闭（仍保留用户在顶栏显式设置的偏好），BLE 方向输入模式每次进入编辑器默认开启；不改变路由、API、权限或已持久化的户型数据。
导航测量的正交墙向切换采用与手动旋转不同的取景策略：每次 `420ms`
旋转把闭合户型、活动墙链、预览/闭合点和当前光标合成一个整体，在画布可用
区域内居中。整体在当前比例下能够容纳时保持原比例；只有容纳不下时才缩小到
刚好完整可见，避免只看到光标而失去户型空间关系。关闭导航仍回到既有的整图
居中、无旋转视图。WXML/Less、BLE 语义、graph 持久化、路由、API 与权限均不变。
导航测量开启时，点过方向箭头后再点击画布空白，只解除该次瞬态箭头锁并恢复
全部手动候选箭头；此路径不再把 `bleDirectionMode` 切成 `manual`，也不停止共享
朝向订阅，因此左上实时方位角和画布旋转继续跟随手机。非导航的独立自动选方向
仍保持原有“清空后切回手动”行为，避免传感器立即重新锁定箭头。
底部原生控件同样按 BLE 状态明确显示：已连接为「测距 · 已连接」，未连接为「测距 · 未连接」。
右侧工具栏经确认的清空重做操作和保存失败行为都必须遵守该合同。底部「测距」把蓝牙读数写到待确认墙预览或已选墙；测距仪硬件测距键主动上报的 ATD 帧走同一套写入路径，无需再点底部「测距」。尚未拉出墙时提示「请先拉出一条墙」，不再误报「请先打开数字修改」。顶栏返回是 88rpx cover-view，画在居中标题层之后，避免标题层抢走点击。顶部「保存」（`onSaveDraft`）云端成功后自动返回上一页；服务端失败则留在编辑器以便重试。页面 `onHide`/`onUnload` 会立即写入本地草稿并尽力静默保存到云端；再次进入时若本地草稿比云端更新则保留本地并回写云端。闭合、删墙和闭合墙上的拆分通过半边求面写入闭合空间，事务要求已保存空间与求面结果一致，否则拒绝该次编辑。`deleteWall`（以及复尺完成 / 取消选中）会清掉复尺会话的 `fixedNodeId`，避免已删除自由端仍挂着会话节点引用。门宽/窗宽及位置受扣除相邻墙实体后的可开洞区间限制（不少于 100 mm），不按墙长 60% 封顶。点选命中顺序为门窗 → 墙 → 闭合房间内域；选中闭合房间写入 `selectedSpaceId`，画布显示浅蓝选中填充与蓝色内描边，并仅对该房间显示内部净尺寸；选中态内边净尺寸（`room-clear`）会把共线且首尾相接的 `innerSegments` 合并成一条连续标注，不受邻房 T 接拆墙影响；右侧栏切换为「命名」（`renameClosedSpace`，快捷名 + 自定义）与「删除」（`deleteClosedSpace`，只删该房间独有墙，共用墙保留后重算面）。Graph 节点只存中心线；工作面和单侧实体是读模型。删除两个闭合房间的共用墙会打通该界面并合并成一个闭合房间；共用界面被拆成共线多段时，删除其中任一段都会去掉整条共线共用墙。打通后若共线内角点被折叠，净尺寸计划仍须按折叠后的内边界给出每一段端点。打通形成的 L 型凹角保持矩形墙体相接，不得按凸角斜接把剩余外墙错进房间。节点求交按局部凸/凹（凸角外斜接、凹角重叠矩形、对侧共线只补外侧台阶）；Admin `surveyWallSolidPlan.js` 使用同一生成规则。内边闭合打通后仍保持各墙原有实体侧：内转角伸进合并房间，对侧共线墙保持台阶外皮并只补外侧台阶转角、内边仍与共用节点对齐，内 L 两墙保持矩形重叠相接，不得斜接成梯形缺口。从两个闭合房间的共用墙中点向任一侧拉出分隔墙并落到对面边界时，原共用墙拆段前固化当前物理实体侧；同一 `topologySourceWallId` 的替换段继承同一 `bodyNormalSide`，不得由拆分后首先引用各墙段的 Space 重新翻面。左右操作镜像等价，未被分隔的原房间其渲染内边界、净面积和净尺寸保持不变。
封闭外墙中段的 T 型分支保持同一拓扑节点和实体墙。连续量墙后点闭合时，与最后一面已测墙共线的闭合延续段并入该墙，不另存拼接缝。从已闭合房间墙角量出两面新墙，若第二面墙落到相邻已有墙上并与起步公共边围成新面，则按共享边闭合，不要求再画第三面新墙；仅对齐到远处角点轴线、尚未落到旧墙上时，仍不作为推断闭合。已闭合草稿加载时也会把共线二度拼接折成一面墙。删除唯一闭合房间的一面墙后，剩余墙链恢复为开口链，缺边两端仍可确定闭合时给出「合」。点「合」、吸附闭合或共享边自动闭合后，编辑器立即进入与点「重置光标」相同的等待拖放状态，无需再点一次；画布默认光标与底部「重置光标」「光标拖动到墙体」共用图一绿色准星字形（`drawCursorGlyph` + `icons/cursor-reticle.png`）。底部「光标拖动到墙体」拖放把准星瞄准在指尖左上 24×40 CSS px，并夹紧到画布内；吸附、左上角放大镜和松手都以瞄准点为准，不以指腹中心为准。画布拉墙端点使用按下时的粘滞抓取偏移和右下偏命中（`surveyCursorAim`），不得套用 Dock 常量偏移，以免起拖凭空拉出一段墙。Dock 输入改为 16ms leading/trailing 最新触点队列，不再直接丢弃节流窗口内的 touchmove；每次稳定正式场景只建一次吸附索引，复用可见顶点、内外墙边与闭合房间延长轴。自由跟手帧跳过全图搜索并只擦准星；墙边/延长线锁定后沿同一目标连续滑动，顶点仍固定锁定，继续使用 16px 进入 / 26px 退出滞回。左上角放大镜改为 `132px` 方形纯画面，只保留放大裁切、虚线准线和中心小十字，不再显示吸附提示或 X/Y 坐标；当前 `L… / ∠…` 长度角度胶囊与放大镜同排并向画布中部避让。放大镜保持低频更新，稳定吸附帧不再全屏清空覆盖层。引导模式下此时立即显示小K「放置下一空间起点」提示，即使闭合房间尺寸标注占满画布也不会因避让失败而隐藏。等待拖放（`wallSnapPending` /「光标拖动到墙体」）时画布仍可平移与双指缩放，短按墙体或顶点才吸附放置；短按闭合房间内域则可直接 `selectSpace` 进入房间选中，未命中墙/顶点/房间时才提示选墙或顶点。把重置光标放到任一悬空顶点会接回这条开口链，而不是从该墙开始一个新房间；沿恢复后的最后一面墙往回拉会缩短该墙，而不是报与已测墙重叠。“内边/外边起步”只选择源墙边界的近侧/远侧起点及对应的首段起点内缩，不得再次解释为新分支墙相反的局部测量面。分支所有墙段统一使用 graph 侧工作面，并继承首段确定的实体侧；转向和源房间质心都不得重新翻面。从闭合边界拉出的第一面墙，点击测量位置会把红线换到墙体另一侧，墙体实体侧保持与源边界对齐；这是操作员显式改测量面，后续拖动不得覆盖该选择。触点按正交规则写入内部 graph，预览黑线、橙线、确认红线、实时尺寸端点和绿色光标必须重合在同一条连续工作路径上；直线模式吸附顶点、闭合点或外边墙面时最多改一根轴，不得把墙厚方向偏移覆盖到橙色预览端点。从已有 T/十字顶点沿房间内边起拖时，即使首帧仍处于相邻墙斜接或外边捕获带，准星与预览也保持原轴，不得瞬间跳开一个墙厚。拖墙放大镜中心只叠绿色小十字、不放大画布准星；相邻红线端点严格相等，拉出第二段时光标和红线不得横移一个墙厚。`measurementStartInsetMm`、`measurementStartExtensionMm` 和 `measurementEndInsetMm` 只记录真实边界或闭合修正，普通外边 T 转角不得自动生成一个墙厚的修正。预览、手工/BLE 确认、Canvas 和尺寸消费者统一按“拓扑长度 - 起点内缩 + 起点延伸 - 终点内缩”计算。闭合房间的内圈含墙厚刻度，L 形凹口就近标注；Canvas 闭合后默认不再画每房间净空（`room-clear`），只保留外圈总长以及门洞分段/墙厚刻度；选中闭合房间时才对该房间显示内部净尺寸，且共线相接的内边合并为一条标注。尺寸带避让画布上现存的未闭合墙以及已静止的长度预览；`wallPreview` 拖动过程中的预览不推动这些尺寸带。已闭合墙体实体端点始终落到拓扑节点，相邻房间升到三度角后不得截短已闭合墙实体以免外侧 T 角缺口。Canvas 门洞白色遮罩只切开宿主墙，并把与遮罩重叠的相邻墙实体补回，不得挖穿 T/L 接缝。以上 Canvas 派生投影不改变 graph 的中心线和闭合拓扑；T 链第二段及之后的转角只能补齐实体墙连接，不得回写前序墙段的测量内缩或缩短已确认读数。所有共享边闭合链在确认后都保持确认前的实体侧，包括“向外量墙、最后橙线吸附既有房间内边”的路径；不能将墙体翻到已对齐红线/橙线的另一侧或再叠加一个墙厚。已测新墙若对齐到相邻已闭合房间的可见外边，闭合后保持原工作面和实体方向，不得仅因共线就翻转墙厚。最后光标命中既有墙的可见外边时，必须保留该外边工作坐标，并以短桥接连接拓扑角点，不得暗中投影回中心线。直线闭合若超出一个墙厚，预览与确认仍保持单轴正交，`confirmClosure` 用短正交桥接（`closure-bridge`）接到拓扑角点，禁止把最后一面墙拽成斜线（否则共用墙实体内会出现斜缝）。墙角续接和共享内墙分区仍遵守原有边界闭合规则。闭合房间内部起步的分隔链在确认首段小墙后继续拖动时，也会在射线首次命中的对侧边界截停并闭合，不得穿墙或把端点写到房间外；向外新建相邻房的既有判定不变。聚焦光标回归已覆盖用户提供的 T 顶点向右首帧拖动，以及“一次拖到底/先确认小段再续拖”两组序列；路由、API、权限或持久化结构不变，真机截图按项目规则等待用户手动复核。

拖动继续拉长当前共线末墙时，若预览已经出现 `mergeClosing`「合」，且松手提交端点仍与可见预览一致，则墙长合并后继续保留该闭合操作，不再因活动墙段计数回落而消失。

成功的直接闭合、推断合并闭合、共享边闭合与分隔闭合会在清理孤立节点前清空 `lastWallSnap*` 光标吸附缓存，避免共线中间节点被合并回收后因旧会话引用触发 `MISSING_SESSION_NODE` 并回滚合法闭合。墙图、测量审计、路由、API、权限、WXML/Less 与持久化结构不变。
相邻共线墙段若在共享墙/外墙交界处选择了不同物理墙面，房间填充与净尺读模型会显式插入一段墙厚正交台阶，不再用斜线连接两个错层墙面端点。该修复不改变 graph、测量审计、路由、API、权限、WXML/Less 与持久化结构。
闭合墙体改为只按几何并集填充并描边一次；房间 `wallFaceOverrides` 边界不再叠加到已融合的墙体上，因此 T 接和墙厚台阶内不会出现多余接缝。选墙高亮、未闭合墙预览和持久化数据不变；渲染修订号升为 `wall-union-outline-v20`，用于刷新旧后台预览快照。

新画墙体朝向既有闭合空间拖动或输入时，射线相交（`findRayWallIntersection`）在遇到既有墙体时自动将预览与提交端点截停在首个相交边界上，禁止新墙穿透既有闭合空间内部；房间内部分隔（`isPotentialPartitionDrag`）保持由专用内部分隔闭合器处理。相邻房间末段墙输入长度超过到目标边界的距离时，系统通过射线相交自动夹紧端点并生成共享边闭合候选，进入 `closing` / `shared-wall` 态并自动确认闭合，禁止生成未节点化的 T 形连接报错（`UNSPLIT_WALL_T_JUNCTION`）。该修复不改变 graph 存储结构、测量审计、路由、API、权限、WXML/Less 与持久化契约。

直线模式下，顶点、闭合点和外边墙面吸附都只能改变一根坐标轴；外边墙面继续作为接触/闭合目标，但不得把墙厚方向偏移覆盖到橙色预览端点上。若外边目标与当前拓扑轴仍相差一个墙厚，确认闭合时使用短正交桥接，不允许直线模式出现斜向橙线。该行为回归未改 WXML/Less、路由、API、权限或持久化结构，真机截图按项目规则等待用户手动复核。

当前交互限制：`wallSnapPending` 状态下不接受直接点击墙体或顶点吸附；点击墙体仅用于选中墙体后放置门窗，光标只能通过底部控件拖动到画布后放置（准星瞄准指尖左上）。画布拉墙使用粘滞抓取，不套用该 Dock 偏移。画布仍支持平移与双指缩放；轻量手势帧会让当前绿色准星按同一 viewport 变换跟随户型坐标，并保持固定屏幕字形大小，缩放过程中不再消失。投影可叠加页面级、不持久化的仅视图 `rotationRad`。顶部操作行左侧常驻 `132×88rpx`「导航测量」（技术组件仍为 `survey-canvas-compass`），右侧「引导 / 保存 / CAD / 完成」保持固定 `20rpx` 间距并整体右对齐，不参与整行均分。原生 `24rpx` 标签配套独立生成的透明 PNG `packages/surveying/assets/icons/navigation-measure.png`（128×128、7,858 字节），界面不再显示 `N`。点击后先打开入户门方位定位：操作者站在室内，将手机顶部正对入户门并保持水平静置，同时要求蓝牙测距仪已连接；连续 9 个环形样本最大离散不超过 `6°` 后才能确认。定位保存真实绝对方位角，激活按钮实时显示诸如 `231°` 的实际读数，不把界面值改写为 `0°`。朝向读取使用 `surveyDeviceOrientation.sharedHeadingSensorHub`，优先 Compass、失败时回退 DeviceMotion；可用时由 `sharedDeviceMotionHub` 的 beta/gamma 校验手机水平。订阅在 `onHide`/`onUnload` 暂停，`onShow` 按仍开启的逻辑模式恢复。直线模式 BLE 快捷输入从第一面墙起常驻蓝色正交虚线，并绘制 3/4 个紧凑、单层的浅绿色半透明候选箭头，排除当前活动墙链的折返方向；选中一边后其余箭头全部消失，仅在已选方向虚线上保留一个很小的蓝色箭头。箭头 `28px` 扩展点击区与门窗/墙体命中重叠时，门窗/墙体优先，输入模式下仍可选墙并使用「复尺」；准星附近短按同样先选中其下对象，只有发生位移才进入正常拉墙。此时点击未命中箭头、门窗、墙体或房间的画布空白处，会解除瞬态方向锁并恢复多箭头候选态，不移动光标、不改变墙体；取得有效 BLE 距离后才落墙。自动模式先完成隐私授权，用“当前绝对方位角 − 入户门绝对方位角”换算房屋相对东南西北墙向，再经过环形中值和激活/切换滞回；每面墙提交后重新武装。墙向切换时画布沿最短角执行 `420ms` ease-out 缓动，不再瞬间跳转；再次点击激活按钮可重新定位或关闭导航测量。`bleLockedBearingDeg`、入户门标定和视图旋转仅为编辑器会话态，本地与云端 graph 序列化前都会剥离。尺寸标注用世界墙角加视图旋转的有效屏幕角判断文字朝向；房间卡片仍屏幕轴对齐；网格随平面图旋转。graph、正交吸附、BLE 协议语义、路由/API/权限边界与持久化 viewport 不变。

重新定位弹层中的「关闭导航测量」使用全宽 `100% × 72rpx` 次级操作，拥有稳定的原生点击区域和按下态，避免 `cover-view` 将其收缩成无样式的裸文字行。

手动顺/逆时针旋转会按当前测绘节点与活动预览点的旋转后投影边界重新居中；空白草稿保留原有屏幕中心世界点补偿。该行为不改变 graph 几何或持久化 viewport 契约。`closing` / `mergeClosing` 出现「合」闭合提示时，BLE 方向候选仍与闭合控件并存。

已闭合房间保存后退出再进入时，恢复流程会将遗留的 `spaceClosed` 会话归一化为 `wallSnapPending`，底部直接显示「光标拖动到墙体」以继续测量下一空间，不再要求额外点一次「重置光标」。此行为不改变路由、API、权限或 v4 `surveyGraph` 持久化结构。

顶部常驻 CAD 操作仅在云端户型为 `completed` 时启用；它调用
`GET /api/miniprogram/floorplans/[id]/export/dxf`，复用小程序户型访问控制以及与
后台相同的正式 v4/闭合空间校验。导出使用国内 CAD 图层和毫米 DIMSTYLE，墙体为并集后的内外皮 `LINE`（含门垛），平开门为打开 90° 的厚门扇、灰色虚线弧和 50mm 门垛的门块 `INSERT`，推拉门仍为双轨、窗为离开墙皮的四线，尺寸为旋转线性标注（内圈含墙厚刻度用 `标注线-内墙`、外圈总长用 `标注线`，`DIMTAD` 2 / `DIMGAP` 10，L 形凹口就近标注），闭合房间写四行 MTEXT（`\P` 换行），整图带青色通高右侧标题栏和黄色指北针，公司置于栏首，公司/家装设计顾问取自关联客户线索。文件按需生成后保存到小程序文件域并交给系统文档
处理；设备没有 DXF 处理器时提示转发到 CAD 设备，不保存导出文件。

## 共用 API 与工具

### 共享 Less 工具类

小程序使用 `miniprogram/project.config.json` 中配置的微信开发者工具
`less` 编译插件。页面和组件样式源文件统一使用 `.less`；`app.less` 全局引入
`styles/utilities.less`。新的 WXML 应直接复用布局、尺寸、文字、颜色、圆角、
按钮和状态工具类（例如 `flex-row flex-1 justify-between gap-8`），不要在页面或
组件中重复声明这些基础规则。页面特有的视觉规则仍保留在对应页面的 `.less` 中；
运行时仍由工具编译为标准 WXSS。

- 预约归属更新：客户服务首屏和项目册将自动派发的家装现场顾问与预约状态分开显示。家装现场顾问已匹配后，客户本人对尚无有效预约的自有线索可进入 `appointment-booking`，通过 `POST /api/appointments` 创建首次时段；负责家装设计顾问仍可代约。双方共用同一有效预约，后提交者收到 `appointment_already_exists`。服务端可用性、客户所有权和自动换人规则仍是权威，员工创建权限不变。

- 身份/上下文：`/api/auth/miniprogram`、`/api/miniprogram/bootstrap`、`/api/miniprogram/identity-contexts`、
  `/api/miniprogram/identity-contexts/switch` 及共用上下文解析器。手机号登录（`type: wechat_phone`）接受微信 `phoneCode`，或旧客户端 `encryptedData`/`iv`（用点按钮前 `loginCode` 的 `session_key` 解密）。身份列表每次从
  数据库读取；切换不能伪造非活动企业、员工身份或推荐人成员关系。`app.js` 的启动
  恢复会用 `/api/auth/miniprogram` 的 `refresh` 重新签发当前 token，并在 `customer/staff/referrer`
  三种上下文间使用统一落点；401/`contextVersion` 失效会清除本地会话且不会触发冷启动时的
  错误角色回退。
- 服务码出示：`promotion-service-code` 按用户指定与活动码出示页对齐元素尺度，采用同一内容固有高度的薄荷海报（导航 `36rpx`、标题/副标题 `64/30rpx`、二维码框/图 `478/450rpx`、小 K `260rpx`、权益 `92/26/22rpx`），仍不展示企业名，并复用 `code-presenter-v3` 扫码小 K 与权益切图；`staff-activity-code` 与
  `enterprise-join-codes` 使用已批准的 `design-references/enterprise-code-presenters-fullscreen-v1/`：
  两页均按台账中的内容固有高度与留白节奏还原，受保护二维码、新打包路由专属小 K/业务 PNG、真实辅助事实、安全说明和现有 CTA 保持一条连续路径。
  原 `open-type="share"`、领取页令牌目标、胶囊安全返回、匿名/企业名边界和错误恢复均不变；
  活动码按钮仍为「分享给客户」，生效入驻码仍以「一键分享」进入带当前 `ej_` 令牌的入驻页。`referrer.network` 能力下，企业负责人继续看到「员工入驻码 / 我的推广人入驻码」两个 Tab，家装设计顾问、家装现场顾问和渠道地推只看到「我的推广人入驻码」；个人码的生成、换新、停用、图片和分享均由服务端限定当前员工范围，员工码仍只允许负责人管理。页内文字链按范围显示「查看推广网络」或「查看我的推广人」，进入同一 `packages/enterprise/enterprise-referrers/enterprise-referrers`。`GET /api/miniprogram/enterprise-referrers` 强制普通员工为 `scope=own` 并分页返回本人邀请的成员；负责人为 `scope=enterprise`，可用 `view=network` 查看企业汇总、全部员工分支（含 0 名推广人的员工）与可选「历史未归属」，或在「全部推广人」按 `query`、`status`、`page`/`limit` 分页。具备 `referrer.network` 的员工可调用 `POST /api/miniprogram/enterprise-referrers/[id]/disable` 停用自己邀请的成员；负责人可管理全店。停用幂等、无重新启用、不改历史线索和提成。  已停用/已退出卡把电话图标贴在号码同一行；员工分支页每张卡均提供「查看推广客户」，负责人活动卡另保留「电话联系 / 停用后续扫码」。「查看推广客户」写入 `app.globalData.pendingLeadReferrerFilter` 后 `switchTab` 到 `pages/leads-management/leads-management`；小程序 `GET /api/leads` 接受 `referrerMembershipId`（校验当前企业 membership，并与员工可见范围 AND）。客户 Tab 顶部展示可清除筛选条；离开该 Tab 再回来且无新的 pending 时自动清除。
  推广网络现仅返回员工缩略汇总，不在一级页内展开员工推广人；点击真实员工分支进入 `packages/enterprise/enterprise-referrer-branch/enterprise-referrer-branch`，以负责人专属 `view=staff&staffId=…` 查询该员工的独立分页名册。服务端会校验该员工仍属于当前企业且角色可纳入推广网络，再应用 `query`、`status`、`page`/`limit`；「历史未归属」仅展示为不可进入的汇总项。全部推广人与本人名册的既有范围、筛选、停用与只读边界不变。
  **权限更新：**具备 `referrer.network` 的设计师、测量员和渠道地推可在「我的推广人」中查看自己邀请的推广客户、电话联系，并停用活动推广人的后续扫码；服务端按 `inviterStaffId` 强制隔离，负责人仍可管理全店。此权限更新替换本段前文关于“只有负责人可停用、普通员工名册只读”的旧边界说明。
- 员工工作台：`GET /api/miniprogram/workbench` 支持 `period=week|month|year|custom`，自定义另传上海日历
  `from`/`to`（`YYYY-MM-DD`，含首尾日）。`schedule=1` 按同一窗口过滤负责人 `appointments`（`timeRange` 重叠，上限 500 条 / 366 天）供预约调度页使用；默认工作台快照仍是未按周期截取的 20 条。
  调度页上自定义日期显示在「自定义」芯片后，不进顶栏副标题。
  自定义周期 sheet 的「取消/确定」贴在自定义 TabBar 之上，避免被 Tab 页裁切。
  三种专业角色的 `pages/index/index` 均为共用**工作台**，响应统一包含服务端驱动的 `activityCode`、`joinCode`、`referrerRoster`。员工入驻入口明确为「仅推荐人」，名册入口为「我的推广人 / 仅查看本人网络」，既有下游接口继续强制本人范围。
  `pages/enterprise-operations/enterprise-operations` 是同一个原生注册页面：负责人显示**经营**，在 `enterprise.operations` 下保留全店大盘、`contractAmountSum` 与 `contractAmountTrend`；家装设计顾问和家装现场顾问通过 `staff.data` 显示**数据**，只渲染五项个人事实，不出现金额或全店文案。负责人 Tab 为**工作台 / 经营 / 客户 / 提成 / 我的**，设计顾问为**工作台 / 数据 / 客户 / 设计 / 收益 / 我的**，现场顾问为**工作台 / 数据 / 客户 / 收益 / 我的**。原生 `tabBar.list` 仍只注册五个页面，三种角色都通过 `switchTab` 进入该路由。
  响应另含 `period`、`dashboard`、
  `signedCount`、`signingRate`（`converted` 按 `convertedAt` ÷ 同窗新增线索；分母为 0 时为 `null`/`—`）。
  Hero「待交付」统计方案设计中且尚无客户可见方案的未归档线索；发布方案或标记已签约后离开该数。经营端、家装设计顾问端和家装现场顾问端的三组 Hero「标签 + 数值」统一使用内容固有宽度的紧凑三排与独立数值徽标，统计组距标题及相邻行间距均为 `12rpx`。每条统计按自身标签与格式化后的数值自然定宽，不再共享统一最小宽度；数值增长后由共用 `stat.count` 自动转为千/万/亿紧凑单位，避免进入右侧小 K 安全区。设计顾问 Hero 改用完整的路由专属透明 `xiao-k-designer-workbench-v2.png`，「客户线索 / 方案交付」辅助文字固定两行并避让右侧插画边界。经营大盘「已签约」仍按周期 `convertedAt` 计数。
- 推荐人网络：企业入驻码 PNG/JPEG 打开专用入驻页；该页在手机号授权前只解析不透明令牌类型。入驻页与客户领取页复用领取页返回箭头，避免扫码/分享把该页做成栈根后无法离开；已签名身份从最近使用再进入时不再粘在落地页，真正扫码或会话卡片仍留在表单。推荐人授权手机号后必须填写真实姓名，才会调用 `POST /api/miniprogram/onboarding/referrer` 写入成员关系，接口不再回退为「推荐人」。个人推荐人入驻码在服务端携带当前邀请员工；新成员仍归企业所有，同时记录首个成功邀请员工及姓名快照。同一推荐人已在该企业活动时，再扫其他员工码仍幂等且不改归属；本切片无改归属接口。历史成员仅在企业恰好一名 `enterprise_admin` 时迁移到该负责人，否则进入明确的「历史未归属」分支。活动成员受平台 `referrerMembershipLimit`（`membership_limit_reached`）与可选企业保护 `referrerAdditionalEnterpriseLimit`（`referrer_protection_limit`）约束，已加入同一企业再扫码仍幂等成功；收紧上限不会退出存量成员。保护拒绝沿用入驻恢复态，文案写入 17 号恢复 Hero 副标题、不改布局：「该企业已限制推广人同时服务其他企业的数量，暂时无法加入。」全局上限文案仍为「当前微信的推荐人企业数量已达上限，请先退出不再服务的企业。」入驻成功态「进入工作台」通过 `getRoleLanding` 跳转，优先使用已刷新的 bootstrap/userInfo 身份（员工入驻缺少身份时回退到所选 `staffRole`）；无法解析落地路径时给出 toast，不再静默无响应。`POST /api/miniprogram/onboarding/staff` 自动创建家装设计顾问/家装现场顾问账号，初始密码为 `123456`（与新开户企业负责人同一常量；可用授权手机号登录小程序或后台）。企业入驻码和推荐推广码均通过 `getwxacodeunlimit` 指向 `develop`，即使服务端以生产模式运行也不回退到正式版；使用 32 位 `scene` 携带令牌摘要，入驻页恢复 `ej_`/`rp_` 前缀后再解析。恢复态「扫描新邀请」会解析微信小程序码的 `path`/`result`（含 `WX_CODE` 返回的 `.html` 后缀），在当前页写回 `ej_` 令牌并重新校验，而不是 `redirectTo` 同一路由（不会重新 `onLoad`）。`onShow` 仅在微信把当前页 `scene`/`token` 换成新值时才重应用，避免相机扫码被原始启动参数覆盖。推广展示页为当前推荐人成员关系加载受保护的微信小程序码。设计 09 自定义导航出示页（`promotion-service-code`、`staff-activity-code`、`enterprise-join-codes`）复用领取页胶囊安全返回：有上一页时 `navigateBack`，否则 `navigateToRoleLanding` 回角色首页，避免自定义顶栏栈根页无法离开。推广服务码和员工活动码出示页已有微信分享；企业双码出示页在生效码上补齐同一套 09「一键分享」，转发卡片打开入驻页并携带当前 `ej_` 令牌。客户领取页只解析、校验、审计不透明令牌并签发短时待确认来源，不创建线索，解析成功后直接进入手机号授权态（跳过历史确认领取屏）。该授权页不展示装修公司名称（含员工活动码落地）；员工活动码出示页仍可显示企业名称。企业负责人也可出示并分享同一套员工活动码出示页；负责人码按门店获客进入抢单/赛马（promoter 归因），不要求微信号或个人二维码。家装设计顾问出示活动码时，若缺少微信号或个人二维码，`GET /api/miniprogram/staff-activity-code` 返回 `designer_profile_incomplete`（403）；页面改为「去完善资料」进入 `profile-edit`，补齐后返回自动重试，错误态主卡随内容增高并重置原生 `button` 宽度，以免 OEM/一加 WebView 把「去完善资料」撑出白卡叠到「请扫码」牌。入驻就绪/恢复、企业开户、登录、推广工作台出示码、领取授权等原生 `button` CTA 用内层 view 包图标和文案，并/或重置宽度、内边距与 `nowrap`，避免 ColorOS/一加上末字换行或小芯片溢出。已有进行中服务按用户批准的 C 版还原为续办档案柜：专用档案柜小 K、真实阶段/更新时间、三段路径、三个原生档案签、唯一绿色档案 CTA、真实设计师背书与归属保留说明；页面从 `GET /miniprogram/customer-projects/[leadId]` 的 `data`（不是 API 外壳）读取已派家装设计顾问的 `wechatId`/`wechatQrUrl` 后才启用紧凑「查看微信」，解析接口 existing-attribution 的 lead 含 `createdAt` 供最近更新展示。员工/推荐人入驻 ready/recovery 走设计 16/17（门廊小 K 裁切）。客户使用 `Idempotency-Key` 授权后才原子创建活动归属、线索和派单；并发或重复扫码不能覆盖未关闭项目。已授权手机号的用户可入驻一家员工企业，或默认最多加入三家推荐人企业；退出会停用对应推广令牌并使旧 JWT 失效。`DELETE /api/miniprogram/referrer-memberships/[id]` 会为剩余可用身份重签 token：仍有其他生效推荐人企业则保留推广身份，否则回退员工、再回退客户。推广工作台据此刷新 bootstrap，若当前身份已不是推荐人，则进入该身份工作台，不再停在空的推广首页。
- 客户项目、推荐进度与方案发布：`GET /api/miniprogram/customer-projects` 只列出当前 `customer_user_id` 的未归档项目摘要，并供给「服务」首屏主卡排序与多项目切换；`customer-projects` 页面仅为重定向壳。服务档案嵌入「房屋现场图」（`GET/POST /api/miniprogram/leads/[id]/site-photos`，先选房间标签再拍照或相册；房间标签弹层打开时隐藏吸底原生按钮栏）。服务档案自定义导航在有上一页时 `navigateBack`，否则 `switchTab` 到「服务」首屏，避免分享、订阅通知和重定向壳落地后无法返回。`GET /api/miniprogram/customer-projects/[leadId]` 才返回项目身份信息（`heroTitle`、`navSubtitle`、`areaLabel`；服务档案绿色 Hero 写死为「您的家装顾问 / 现场顾问与设计方案全记录」，不渲染 `heroTitle`）、企业、家装设计顾问（含 `wechatId`、`phone` 与有值时的签名 `wechatQrUrl`，以及计算后的 `professionalProfile`）、家装现场顾问姓名与 `measurerPhone`（电话优先员工 `admin_users.phone`，否则回退绑定 `users.phone`）、当前有效预约（重约后未结束的 confirmed 档优先于过期旧行）、带 `previewEndpoint` 的完成 v4 户型摘要、`featuredScheme` 和 `publishedSchemes`（图集含同一 `directQiniuDisplayUrls` 开关下的 https `imageUrl` 与 `imageEndpoint` 兜底；命名对话方案图集，无 workflow 的小程序单图归入「其他效果图」；图集按首次对客户可见时间 `firstPublishedAt` 排序，后续合并更新不重排轮次；`publishedSchemes[].finalized` 标记定稿套，`featuredScheme` 优先定稿 workflow，否则仍取最近一次交付；服务档案首屏交付标题在定稿时显示「已定稿」；首屏效果图上叠加风格标签与「详情」芯片，标题在图下方）；服务档案「微信联系家装设计顾问」、服务首屏「免费家装设计顾问」、领取成功态家装设计顾问卡与已有服务「联系当前家装设计顾问」共用居中联系弹窗：优先展示家装设计顾问个人微信二维码（长按识别/预览加好友），并保留复制微信号与搜索添加提示；新派家装设计顾问的领取成功态只自动打开一次该共享弹窗，不再内联重复二维码；关闭后绿色主操作进入服务档案，描边次操作可再次查看家装设计顾问微信；小程序无法自动添加个人微信好友。服务档案人员卡在有号码时于姓名下方展示家装设计顾问/家装现场顾问手机号，点号码（或家装现场顾问卡片）走 `wx.makePhoneCall` 直拨；绿色 Hero 时间线第二步文案为「量房」，对应线索 `survey_completed` 阶段。已发布效果图与 `featuredScheme` 返回稳定 https `imageUrl`（媒体存储可签名时为对齐 deadline 的七牛私有下载 URL，否则为对齐过期的小程序签名 API URL）；服务首屏、服务档案、AI 方案册与线索详情有 `imageUrl` 时直接给 `<image src>`，不再走 `fetchProtectedImage`。`imageEndpoint` 仍保留为鉴权字节兜底（保存相册 / Admin）。正式户型预览仍走 `/miniprogram/customer-projects/[leadId]/formal-floor-plan/preview`（员工侧 `GET /api/floorplans/[id]/preview`），小程序追加一次 `/api` 基地址后按线索 + 户型 id/`updatedAt` 缓存在 `wx.env.USER_DATA_PATH`。服务档案 `onShow` 刷新 JSON 时保留已渲染图片，预览户型图或从子页返回后不再清空重下。**运维：** 须把当前媒体存储配置的七牛 CDN `domain` 加入小程序 request / downloadFile 合法域名（开发者工具本地可勾选不校验）。客户与员工均可经 `packages/business/customer-ai-schemes/customer-ai-schemes` 只读浏览多轮 `publishedSchemes`（客户走项目聚合，员工走 `GET /api/leads/[id]`）；页面不含生成、发布或编辑动作。服务档案「交付方案」整块（标题区与预览图，含视觉「详情」芯片）直接进入该只读册，不再弹出「详情 / 保存到相册」动作菜单。客户在服务档案与 AI 方案册底部的保存/分享打开 `components/scheme-share-poster`（品牌海报：方案图 + 方案名 + 家客来 Logo，无小程序码），保存到相册后经 `wx.showShareImageMenu` 分享图片；两页均隐藏胶囊转发，不再使用 `open-type="share"` / `onShareAppMessage`。他人从微信图片分享点「打开小程序」会落到同一 `customer-ai-schemes?leadId=`；非项目主人不再停在 `GET /api/miniprogram/customer-projects/[leadId]` 的 403，而是回退 `GET /api/miniprogram/published-scheme-folios/[leadId]`（任意已签名小程序身份，平台事务以便跨租户打开海报，只返回已发布方案与小区/方案名 Hero，不含电话、预约或户型）。分享访客复用 D08 只读方案册且无保存/分享钮，栈根返回走角色落点。`GET /api/miniprogram/referrer-progress` 和 `GET /api/miniprogram/referrer-earnings` 以 JWT 当前活动成员关系做授权；收益台账跟随当前提成行的 `beneficiaryUserId` 与 `payableAmount`，分别仅返回脱敏服务阶段/更新时间和本人提成记录。`GET /api/miniprogram/staff-earnings` 只对已签名家装设计顾问/家装现场顾问开放，列出当前企业下该用户对应角色的本人线索提成。 `GET /api/miniprogram/enterprise-commissions` 仅授权已签名企业负责人，返回当前租户未归档线索提成台账及与后台一致的待支付/已支付/已作废汇总；`POST /api/miniprogram/enterprise-commissions/mark-paid` 对待支付行执行与后台相同的线下打款确认，`paidBy` 记为当前员工 `_id`。负责家装设计顾问只能发布或撤回自己负责线索的已成功 generation，企业负责人可管理本企业；撤回不删除生成结果但立即取消客户可见性。后台工作台图集走 `POST /api/leads/[id]/ai-scheme-publications`：在同一 `workflowId` 内按“合并发布”把选中图片增量合并/更新进活跃发布记录，因此方案内的 `published-grid` 会随发送更新而增量变化；未勾选但已确认的图片保持客户可见，直到被单张撤回或删轮次/删方案显式下架；再次勾选已发布图片只更新标题、`sortOrder` 和 `updatedAt`，不改写 `publishedAt`。
- 手动派单：`POST /api/leads/[id]/assign-staff` 同时接受小程序 JWT 或后台 Cookie，不再仅限企业负责人。请求体 `{ designerId?, measurerId? }` 至少填一项。企业负责人与平台 `admin`/`super_admin` 可补齐或更换家装设计顾问和家装现场顾问；本线索已绑定家装设计顾问只能改家装现场顾问；家装现场顾问及其他角色 403。`assignLeadStaff` 经 `ReferralLeadRepository.assignStaff` 允许覆盖（同一人 400，不能解绑成空），写入 `leadAssignmentEvents`（`assignment_manual` / `assignment_manual_reassign` 及 pending 变体）；若存在已确认且尚未结束的预约，则同步改写 `designerId`/`measurerId` 并写 `measurementAppointmentEvents.staff_reassigned`（家装现场顾问时段冲突 409，可用性检查排除本条预约）。派单响应保留与 `GET /api/leads/[id]` 相同的 `assignedTo`/`measurerId` 员工摘要，不再把 `measurerId` 覆盖成字符串 ID（小程序卡片会把非对象当成待分配）。线索详情派单成功后静默重拉 GET，无需返回再进入也能显示新家装现场顾问/家装设计顾问。列表/详情 DTO 返回 `assignmentActions: { canAssignDesigner, canAssignMeasurer }`。线索详情改为 `GET /api/leads/[id]/assignable-staff?role=` 拉可派花名册（去掉当前已绑定的人，`page`/`limit` 分页），不再走仅负责人可用的 `GET /api/miniprogram/enterprise-staff`。电脑后台 `/leads` 卡片提供「分配/更换」；「重试派单」仍只走自动池。已签约线索仍可改运营归属，不改写提成快照。聚焦合同测试覆盖角色矩阵、覆盖写入、预约改写、小程序卡片与后台 notify。
- 线索详情与客户列表的测绘预览：已完成正式 v4 户型提供 `plan.previewUrl`（`GET /api/floorplans/[id]/preview`）；企业负责人、已派家装设计顾问与已派家装现场顾问经 `fetchProtectedImage` 拉取字节并用 `wx.previewImage` 看大图（不进 `surveying-editor`）。该预览 GET 按关联线索的已派家装设计顾问/家装现场顾问（或企业负责人）授权，不只看保存户型的 `floor_plans.staff_id`，且线索与员工须属于同一企业。`POST /api/measurements` 的不可变审计写入现对齐同一关联线索协作权限；未指派员工和跨企业关联继续拒绝，非员工身份仍限定户型创建人。列表缩略图优先该鉴权端点，其次酷家乐 `externalSource.previewUrl`，最后 CSS 墙线段。正式量房编辑器对已有户型使用包含 `floorPlanId` 的本地草稿 key，避免同一线索的历史量房记录互相恢复草稿。聚焦合同测试覆盖预览端点解析、受保护图加载与审计权限接线。
- 线索、户型、测量、设备、AI、提成、报备和通知使用对应的租户 API 族。家装设计顾问与企业负责人的 AI 方案工作台读取与出图走 Mini Program Studio 门面 `/api/miniprogram/ai/studio/*`（bootstrap、leads、workflows、创作任务/批次/重试、assets、提示词分类/模板——scheme-studio 为悬浮 AI 输入 dock：提示词下方不横滑底栏（户型/模型/模板/设置 + 生成；点工具先收键盘再弹层，选中或点遮罩取消后都恢复输入框聚焦）+「出图设置」半屏，模板 sheet 支持分类筛选、搜索与封面放大后再「使用此模板」（只回填提示词和推荐模型，不把封面克隆为参考图）。`recipe-confirm` / `scheme-studio` 的用户参考图来自先选房间标签的拍照/相册写入本户图库，或从本户现场图点选（直接用该 `assetId`，不再复制一份）——以及提示词优化（小程序客户端与 API 边界均允许 120 秒，以适配推理模型），效果图展示 URL（平台媒体存储开关 `directQiniuDisplayUrls`，默认开：对齐 deadline 的七牛私有下载；关：对齐过期的 Mini 签名 API；TTL 窗口内微信可缓存），以及签名户型预览 URL；scheme-studio 参考图槽锁定展示绑定户型**控制图**（整屋快照，或 `?roomId=` 房间裁切，与批次首张参考图一致，`GET .../floor-plan-preview` 会转发该 `roomId`））。每次点击「开始新一轮设计」会打开已批准的方式选择，而不是进入页面就强制选择：「设计整屋」提交 `renderMode=whole_floor_plan`，正式户型控制图负责结构、可选且已标记的现场图负责镜头；「设计单间」必须有现场图，有正式户型时可选具体闭合房间作为身份，未选择房间也可直接用现场图提交，提交 `renderMode=single_room_photo` 且不附户型控制图；其内「仅软装换搭」提交 `renderMode=soft_furnishing`，沿用同一现场图优先输入合同。Mini 批次 API 将 `renderMode` / `hasStyleReference` / `hasSitePhoto` 及精确的 `sitePhotoAssetIds` 传入 `preparePostgresCreationBatch`；首屏方案详情与创作配置并行加载，同客户方案 chip 在首屏可用后后台补齐；现场图优先模式保留房间身份，但不拼接户型约束提示词，从历史效果图继续得到的基准图也不能在后续编辑中冒充必填现场图。AI 设计空间作用域与后台共用。设计 Tab 仍是**创作入口**；`recipe-project` 对齐后台工作台选择（先客户、再方案对话——卡片封面优先已确认图的稳定展示 URL，否则最近成功出图，没有生成图才用占位图——户型配方再「应用到哪里」：默认 `whole_floor_plan`，或 `single_room` 且必须带 `roomId`；拍照配方把已派未关闭线索列为可设计、跳过应用到哪里并允许无 `sourceFloorPlanId`；客户步骤返回时（含量房返回）会静默重拉 `studio/leads`，预约确认完成量房（`survey_completed`）后户型配方进入「可设计」（`survey_ready` 仍为「待量房」））；`scheme-studio` 是方案档案与续聊（无户型时隐藏「户型」工具，可未量房即发给客户），模型选项与后台同一套可执行 GRS 生图目录（`GET /api/miniprogram/ai/studio/bootstrap` `models`：目录启用且至少一档积分价启用；预选优先 `provider.defaultRemoteModel`（供应商默认远程模型），匹配不到再 `isDefault` 再按 weight；映射只表示默认展示；`free_create` 提交目录 `remoteModel`），效果图直接绑定 JSON `imageUrl`（`<image>` / 预览 / 下载），户型缩略图仍走签名预览 API、可能仍会闪加载。闭合房间列表来自该方案已绑定正式 v4 量房墙图（`GET /api/miniprogram/ai/studio/workflows/[id]` 的 `sourceFloorPlan.rooms`）。服务端解析为 `resolveMiniAiFloorPlanTarget`；完整户型不得同时传 `roomId`，单房间必须是该户型上的闭合空间。配方/创建把该作用域写入 `input.roomData`（提示词上下文），本通道控制图仍附整屋量房画布 PNG。后台 `/ai-studio/scenarios` 与小程序 studio `POST .../batches` 共用 `preparePostgresCreationBatch`（整屋仍用该量房 canvas PNG；单房间优先 Mini SVG 裁切，失败则回退整屋快照，提示词/`roomData` 保持房间作用域）。小程序 `scheme-studio` 续聊经 Composer「应用到哪里」提交 `targetScope`/`roomId`（默认 `whole_floor_plan`，闭合房间为 `single_room`）；同一选择器仍在 `recipe-project` 与后台工作台。预约可用
  时段接口会返回企业时区、时长、步长和最远可预约天数；预约与改期页面以该服务端
  边界为准，不将本地生成的日期列表当作权威范围。当天列表会去掉已经开始的档；若
  该线索已有确认预约，可用时段和改期会排除这一条自身占用，因此可以改到与当前上门
  重叠的邻近档，其他线索仍会看到该家装现场顾问已被占用。客户预约接口只在确认请求的线索
  或预约归属该客户后才推导企业范围；客户 token 不携带或声明企业 ID。
- 家装现场顾问读取预约详情时按预约记录持久化的 `measurerId` 做授权，而不只依赖线索上的
  临时 `measurerId`；详情请求同时携带被点击的 `appointmentId` 做直接读取。自动换派
  家装现场顾问后，当前预约仍可正常打开，同时不会返回分派给其他家装现场顾问的预约。
- 已登录家装现场顾问调用 `GET /api/appointments` 读取日程时，服务端会合并其本人已派预约所
  属线索的真实 `customerName` 和 `customerPhone`，因此既有日程卡片和“电话联系”使用
  同一份已授权客户联系信息；客户、推荐人、家装设计顾问及后台预约载荷继续遵守原有联系信息
  边界。
- 量房编辑器在 `onShow` 从活动 BLE 会话同步可见连接状态；已有会话时点击连接入口不会再次启动搜索。App 静默重连通知也会调用编辑器的 `updateBleConnected` 钩子。
- 几何与 Canvas 源文件为 `miniprogram/packages/surveying/utils/surveyWallGraph.js`、
  `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js` 及量房尺寸/实体规划器；主包不再加载该内核。
- BLE 集成位于 `miniprogram/utils/bluetooth.js`；协议语义以仓库厂商文档为准。量房编辑器里，测距仪硬件测距键上报的 17 字节 ATD 帧与底部「测距」发送 `ATK001#` / `ATD001#` 后的回包走同一套当前预览墙/已选墙写入路径。企业员工连接前仍走 `POST /api/devices/verify-binding`（仅企业归属；MAC 比对会去掉分隔符）。iOS 首次广播常没有 GAP `name`，因此搜索使用 `allowDuplicatesKey: true`，并从 `localName`、Complete Local Name（`0x09`）或厂商 `advertisData` ASCII 识别 `LDMStudio`；`verify-binding` 还会用压缩后的广播 hex 匹配已录入 MAC，避免 iOS 的 UUID `deviceId` 无法授权。平台录入使用 `scanBLEForEnrollment`（多台扫描收集 MAC）与 `GET/POST /api/miniprogram/devices`（支持 `devices[]` 批量分配，并可写可选 SN 码；已登记列表默认「全部企业」，也可按 `enterpriseId` 过滤）。搜索会先注册 `onBluetoothDeviceFound` 再 `startBluetoothDevicesDiscovery`（`powerLevel: 'high'`），并轮询 `getBluetoothDevices`；日志打印附近全部 BLE 设备与目标命中；超时文案区分“附近无广播 / 有蓝牙但无 LDMStudio / 已发现但未授权”。若冷启动后 `createBLEConnection` 返回 `already connect` / errno `1509007`（系统层仍保持连接），会恢复会话（重新取服务/特征值并回调就绪），而不是清掉记忆设备判失败。家装现场顾问/家装设计顾问/企业负责人工作台与 `App` 在有记忆设备时会**静默自动重连**（`trySilentBluetoothReconnect` / `trySilentBleReconnect`），成功后首页直接显示「已连接」，无需再点。打开适配器会声明 `scope.bluetooth`，把 `already opened` 视为已就绪，并把华为/鸿蒙 `system permission denied` / 蓝牙已开仍返回 10001 归为「附近的设备」权限缺口，而不再一律 toast「请打开手机蓝牙」。iOS 13.x 不再等待 `wx.authorize(scope.bluetooth)`（它不会授予系统蓝牙，且可能无回调卡住）；真正拉起系统权限的是 `openBluetoothAdapter`，即使 iOS 把 `bluetoothEnabled` 报成 false 也会调用。适配器打开失败、搜索超时、搜索失败与安卓权限不足会回调连接失败（`false`），使 `ble-connector` 解除 loading 锁；搜索过程中关闭弹窗会调用 `cancelBLEDiscovery`，弹窗始终可关闭。

平台录入的实时扫描由 `scanBLEForEnrollment` / `cancelBLEEnrollmentScan` 管理；停止时会保留本轮
已发现的设备供勾选分配。这个例外不改变量房连接的 `getBluetoothDevices` 轮询与授权校验流程。

### AI 方案工作台 Composer 三态与配置弹窗

`scheme-studio` 现在使用批准的三态 Composer：折叠态显示方案摘要，展开态编辑提示词，配置弹窗随时重新打开。首页只暴露高频的**设计目标 / 提示词模板 / 参考图**入口；**模型**、比例、分辨率、张数、软装子类型等技术参数统一收进**更多设置**。配置弹窗可随时修改设计目标、提示词模板和参考图；选择设计整屋时，将绑定的正式户型图作为锁定的**参考图1**显示，其后展示户型图库或用户上传的参考图。配置内容在矮屏溢出时仍可滚动，但固定内容态不显示右侧原生滚动条。设计单间缺少现场图时，点击生成直接打开配置弹窗补图，不再停留在无效提示。Composer 展开时在时间线与面板之间显示全屏深色遮罩，点击遮罩会收起面板。每张已显示的成功效果图均可通过 `wx.previewImage` 放大并在同轮结果间切换；已显示的时间线参考图可在各轮参考图间切换，配置中的用户参考图则与存在的锁定户型参考图一起预览。点击时间线「重新编辑」恢复批次时，同时复用 `batch.referenceAssets` 的持久化预览 URL，已带回的参考/效果图会在配置页直接显示。原有 `renderMode`、模板提示词、草稿、路由、Studio 批次 API、权限和数据合同保持不变；三态已在精确 scheme-studio 路由的 `390×844` 微信开发工具运行态完成核验，本次滚动条、遮罩与图片预览修复后的运行态 QA 待用户手动截图确认，证据登记在还原台账。

### 共享家装设计顾问联系弹窗

家装设计顾问和家装现场顾问可在 `profile-edit` 通过 `GET/PATCH /api/miniprogram/staff/professional-profile` 维护未锁定的个人头衔、从业起始年份与头衔显示偏好；企业强制显示/隐藏时员工开关禁用并提示统一设置，资料锁定时全部职业字段不可修改。页面预览客户最终可见的头衔、经验和服务人数背书，真实人数只对员工本人可见。客户项目与领取结果只下发计算后的 `professionalProfile`，头衔按后台录入原文展示，不再把「设计师/测量员」改写成岗位展示名。服务档案 GET 分别按设计卡/测量卡岗位解析，同一人兼任两岗时各用该岗的企业默认头衔和经验文案。家装设计顾问联系弹窗在身份与原二维码舞台之间插入背书：头衔可见时与家装设计顾问姓名组成资历标题，经验与服务人数分别使用已许可的语义图标；隐藏头衔时收起该标题并把姓名恢复到关系条，确保身份不会丢失。V4 服务档案人员卡消费同一套计算后的 `professionalProfile`（可见时的 `title`，以及 `experienceLabel` / `serviceLabel`）；家装设计顾问卡角色为「家装设计顾问」，不再加「专属」。未给家装现场顾问增加二维码能力。

- `components/designer-contact-sheet` 已按用户批准的 `design-references/designer-contact-sheet/designer-contact-sheet-xiao-k-bubble-v8-candidate.png` 更新，并继续共用于 `pages/index/index`、`packages/business/free-design-service/free-design-service` 与 `packages/business/customer-project/customer-project`。
- 生产弹窗保留既有家装设计顾问联系数据和动作，视觉层级改为二维码优先：小 K 趴在绿色建筑空间 Hero 上，小 K 右侧增加原生文字暖白对话气泡「比小红书更方便贴心的 / 家装顾问」，气泡尾巴指回小 K；下方继续使用暖白且无遮挡的二维码舞台和醒目的「长按二维码 识别后添加」引导，同时保留微信号复制、重试、二维码预览、点击遮罩关闭及外置关闭按钮。组件挂载及每次打开时读取 `getMenuButtonBoundingClientRect().bottom`，让气泡与原生胶囊底边始终保留 `16rpx`，读取失败时按当前窗口和状态栏数据回退。存在可见自定义 TabBar 的页面会把弹窗停在 `--sfp-custom-tabbar-safe-height` 之上，保证关闭按钮完整可点；无 TabBar 的领取页和服务档案保持原底部留白。 有 TabBar 时，二维码方形区域现让出实际 Tab 栏高度（含底部安全区），外框最小为 `240rpx`，图片、加载态和错误态同步使用同一内部尺寸；无 TabBar 的 `442rpx/384rpx` 尺寸、字号、素材、复制/预览/重试操作、路由、API 和权限不变。回归依据为用户截图 `6b6de96429eb4eeaff47a92d82dbd55a.jpg`（无 TabBar 正常态）与 `e3500ab9021fffa3960c9e7ebff11da8.jpg`（服务 Tab 底部联系区域被裁切）。联系组件及服务首页/档案页的 28 项聚焦测试通过；扩大检查发现既有 AI 页面 20rpx 字号白名单与授权页旧文案断言两项失败，均不在本次修改范围。修复后的 `390x844` 与高屏运行态 QA 仍待用户手动截图。
- 独立生产素材映射为沿用的小 K 处理 -> `miniprogram/images/designer-contact/xiao-k-peeking.png`；沿用的金色徽章、指南针和客户爱心语义从 `docs/icon-sources/designer-contact/` 映射为 `miniprogram/images/designer-contact/` 下三枚优化 PNG。气泡、弹窗结构、数据驱动文字、背景和控件均为原生 WXML/Less。
- `packages/business/free-design-service/free-design-service` 现以唯一组合源 `docs/superpowers/specs/2026-08-25-free-design-service-contact-conversion-design.zh-CN.md` 为准：新领取并成功派家装设计顾问且存在任一可用联系方式时，本页面生命周期仍自动打开一次共享弹窗。关闭后由档案优先 Hero 承接唯一绿色「查看服务档案」和三条原生档案目录；设计师卡降为辅助层，只保留紧凑「查看微信」、真实匹配/同步状态，以及接口公开 `professionalProfile` 返回的头衔/经验/服务背书。已有服务归属态按批准的 C 版续办档案柜落地，唯一绿色「继续查看服务档案」承接原档案，设计师微信同样只在紧凑辅助条中出现。因客户可在平台内主动预约量房和查看方案，旧微信用途说明与双通栏联系按钮均已删除。页面仍不重复下载或渲染内联二维码；仅二维码与仅微信号均使用同一弹窗。路由、API、领取幂等、权限和角色边界不变。

## 视觉巡检记录

### 未登录「我的」入口

`pages/mine/mine` 的访客态继续以
`design-references/auth/miniprogram-guest-login-jovekore-v2-full.png` 和
`docs/miniprogram-role-shell-design-v1.zh-CN.md` 为唯一当前设计源。生产界面已移除
`<=360px` 对门厅场景、面板边距、标题和身份图标容器的叠加缩小，保持内容固有的
场景—面板连续阅读组；「立即登录」显式占满面板内容区，三枚身份 PNG 按可见 alpha
边界放大，底部信任说明使用已记录许可的 `images/mine-icons/shield-check.png`，不再绘制
CSS 竖胶囊。路由、`goToLogin`、身份、API 与权限边界未改变；未登录访客现复用客户「服务/我的」TabBar，访客入口落在 TabBar 安全高度之上。
聚焦布局、素材签名和窄屏防压缩测试通过；修订后的 `390x844` 与用户高屏原生胶囊截图
等待用户手动复核。

### 客户服务档案

`packages/business/customer-project/customer-project` 当前唯一设计源已更新为用户批准的
`design-references/customer-project-archive-redesign-v4/customer-project-archive-balanced-color-v4.png`。
生产路由继续复用既有仅业主可读聚合、预约权限、受保护正式 v4 户型预览、现场图采集、只读已发布方案册、
家装设计顾问联系弹窗、人员拨号与方案海报分享；本次只调整信息架构和客户文案：压缩后的小 K 进度 Hero 之后依次为
暖杏色预约区、薄荷绿/雾蓝服务小组卡和三行连续档案册。预约状态徽章与「预约量房」标题同行，说明「选择方便的时间，家装现场顾问会提前与你确认」单独占满一行并可换行，不再被徽章挤成省略号。绿色 Hero 主副标题现已写死为「您的家装顾问 /
现场顾问与设计方案全记录」，不再展示聚合接口里的线索或小区名。所有客户预约控件统一使用「预约量房」/「重新预约」，家装设计顾问卡角色为「家装设计顾问」（不加「专属」），已分配人员卡渲染服务端计算后的 `professionalProfile`（可见时的 `title`，以及 `experienceLabel` / `serviceLabel`），不再写死金牌/资深文案。用户提供的首张高屏运行截图确认结构已落地，同时暴露出
旧图标替代设计稿图标、人员卡留白偏大和档案行偏高。当前已用 `docs/icon-sources/customer-project-v4/` 下许可已记录的
同套圆角线性 SVG 生成 `miniprogram/packages/business/assets/customer-project-v4/` PNG，并完成日历、人物、尺子、文档、
图片、交付文件、电话与微信联系八类语义映射；服务卡、档案行和书脊后的正文起点也按批准稿收紧。生产字号、图标与间距
台账已同步到中英文还原台账，客户档案聚焦测试通过。路由、API、模型、租户范围、权限和角色边界均未改变；按项目手动
视觉核验规则，修订后的登录态 `390x844` 原生胶囊及高屏光学比例仍待用户运行截图复核。

匿名免费设计领取页（`packages/business/free-design-service/free-design-service`）
现以批准的
`design-references/free-design-service-phone-auth-three-benefits-v1/free-design-service-phone-auth-three-benefits-v1.png`
还原手机号授权态，同时保留既有领取合同和所有授权后状态。顶部生产品牌锁继续使用
`/images/home-ip-v1/brand-logo.png` + **家客来**。手机号授权首屏删除领取步骤条和全部上门、量房、
预约、地址、家装设计顾问匹配引导，以 **装修问题找 / 免费家装顾问 / 把装修问题弄清楚** 承接且只展示
**免费效果图 / 出到客户满意为止**、**免费家装设计顾问 / 解答你的装修问题**、
**免费家装现场顾问 / 解答现场问题**，随后仅保留手机号隐私边界、**允许微信授权手机号** 与
**暂不授权**。权益向导使用内置 imagegen 生成的独立透明资产
`packages/business/assets/referral-service-v1/xiao-k-three-benefits.png`
（`560x473` 索引色透明 PNG、`26715` 字节、保留 F1 阶梯房体和完整黑色手脚）。所有文字、权益行、
隐私说明和控件均为原生 WXML/Less，未切片页面设计稿。用户首次提供的 `1080x2400` 高屏截图暴露出
还原缺陷：嵌套 flex 扩张把插画舞台拉高，在小 K 与第一条权益之间制造了约 `500px` 物理空洞，同时
角色、权益卡和图标偏小。修正后的授权阅读组改为内容固有高度（无嵌套 flex-grow），使用固定插画舞台
和按设计稿比例放大的权益卡/图标，并分别使用效果图、顾问灯泡、现场定位语义图标；高屏剩余空间不再进入角色与权益列表之间，高度不超过 `760px` 时
恢复纵向滚动。用户第二张 `1080x2400` 截图确认内容流已修复，但继续暴露视觉比例偏差：权益标题、说明、
图标圆底/可见图形、隐私说明和 CTA 虽满足项目字号底线，仍比批准稿小一个层级。当前状态已按本路由专用
`48/36/28/32rpx` 主标题/权益标题/说明/CTA 比例重新校准，图标圆底为 `124rpx`、可见图形为
`78–88rpx`，不再把最低字号当还原目标。用户随后手动复核高屏效果，确认校准后的还原已基本完美，字号与图标比例通过运行态验收。
待匹配和已有服务归属行为、路由、API、身份、领取结果、权限与导航边界不变；推荐服务与透明资产聚焦测试防护内容流合同。

成功态现按同一组合路由合同改为档案优先：完成步骤使用等长「领取完成 / 授权完成 / 顾问已匹配」，档案主标题下以原生「服务进度 / 户型档案 / 设计方案」目录和唯一绿色 CTA 进入同一服务档案。批准合成稿中的抱档案夹小 K 映射为独立生成并打包的 `520x567` 索引色透明 `xiao-k-service-archive-guide.png`（`20672` 字节），不切片整页设计稿。辅助设计师卡读取领取 DTO 已有的公开 `professionalProfile`；缺失字段直接收起，不虚构头衔、年限或服务人数。用户提供的 `1080×2400` 高屏运行图确认整体档案层级和真实背书已落地，同时暴露微信原生按钮自动扩张，把「家装设计顾问」挤成「家…」。生产样式现将「查看微信」固定为 `148rpx` 辅助宽度（窄屏 `132rpx`），角色完整保留，服务人数背书固定独占下一行。聚焦档案优先、按钮宽度和 PNG 包检查通过；修订后的高屏及 `390x844` 原生胶囊运行图等待用户手动复核。

员工/推荐人入驻页
（`packages/business/onboarding/onboarding`）的推荐人就绪态现以用户提供的
`design-references/onboarding/referrer-enterprise-invitation-20260828-v7.png` 为唯一设计源：薄荷建筑
Hero、原生 **欢迎加入 / 推广团队** 文案、三项真实推广权益、动态企业邀请卡、三步流程、授权保障和主 CTA 均已还原，同时保持原有解析、手机号授权、真实姓名确认、角色和导航合同；推荐人就绪态「加入后即可获取专属推广码」仅作展示，不再跳转。独立生成的透明插画映射为
`packages/business/assets/onboarding-referrer-v7/{xiao-k-promoter-hero-v7,enterprise-building-v7}.png`，均小于
300KB；本次运行图修正的独立生成图标为
`packages/business/assets/onboarding-referrer-v7/{promotion-code,promotion-progress,promotion-commission,promotion-person-plus,promotion-cta-shield}-v7.png`
（均小于 `5KB`）。组合设计稿未被切割；邀请首句改为单行，三步序号与标题改为同一行对齐。员工就绪态和恢复态继续沿用原 16/17 号设计与行为。整窗 `390x844`
核验仍待手动补充。

新的获客、推荐人、客户服务、预约、不可用时段、服务码、线索详情和提成工作流样式，已按各自台账中的当前设计源复核。辅助文字与辅助状态芯片现不低于 `22rpx`；主要业务数值、正文和操作不低于 `24rpx`；仅 `lead-form` 的非文字装饰面积图标例外。`miniprogram/test/miniprogram-typography-floor.test.js` 提供聚焦静态防护；因当前没有可验证的小程序 automator endpoint，更新后的登录态 `390x844` 宿主截图仍待补。

预约详情在可改期时内嵌可用时段选择（共享 `utils/appointmentSlotPicker.js`）：5 日窗翻页、时段选择、员工选填原因，以及全宽半透明页底色吸底栏内的取消|确认改期（约 0.9∶1.3 flex + 20rpx 间距、统一 26rpx 居中；无取消权时确认全宽；动态「确认改期至…」；未选时段禁用（薄荷底 `--action-disabled-bg`，不用微信原生 `#f7f7f7`）；页面 `padding-bottom: 200rpx` 让出操作栏）。员工 `开始量房`/`确认完成量房`、`修改服务地址` ∥ `一键导航至量房地点`（等宽胶囊次要行 + 16rpx 间距，复用已打包尺规/编辑/定位 PNG）、「拍现场图」（先选房间标签再写入本户图库；房间标签弹层经 `root-portal` 提到页面根层，打开时隐藏吸底原生取消|确认栏，避免客厅/主卧等标签被挡住）与同步小区留在滚动次要区；可改期时吸底主 CTA 归改期。`serviceStage` 为 `survey_ready` 时关掉改期主 CTA，吸底主按钮改为「确认完成量房」，避免被改期栏挤到次要区。客户文案「量房已完成」只在 `survey_completed`；待确认时仍是上门进行中，不开放重约。`appointment-reschedule` 仅为兼容跳转壳（`redirectTo` 详情；缺省/`customer` → 客户态；`internal` → 员工态）。`POST /api/appointments/[id]/address` 与 `POST /api/appointments/[id]/internal-reschedule` 先按小程序 `staff._id` 授权，再回退 Admin JWT。家装现场顾问与企业负责人在关联线索尚未 `survey_ready`（已完成正式 v4 户型且至少一个闭合空间，或线索 DTO `serviceStage`）前，仅显示 `开始量房`/`继续量房`；达到该阶段后预约详情与家装现场顾问工作台主按钮才显示 `确认完成量房`。完成预约仍由服务端按同一规则强制校验，否则 `POST /api/appointments/[id]/complete` 返回 `appointment_survey_required`（409）。`GET /api/appointments` 以及线索/工作台预约 DTO 输出 ISO-8601 `timeRange`；客户服务档案、量房日程、预约详情及相关员工页通过 `utils/appointmentTimeRange.js` 解析 postgres 或 ISO 时段，并以固定 UTC+8 换算按上海日历日归入日程（不使用 `Intl`，部分微信 JS 引擎未提供该对象），因此次日已确认上门会出现在对应日期，而不是「时间待确认」。不可用时段列表卡片改为紧凑行内删除按钮；量房日程底部「不可预约时段」卡片的计时图标与标题同一行对齐。规格见 `docs/superpowers/specs/2026-08-21-appointment-detail-inline-reschedule-design.md`；登录态 `390x844` 刷新截图待补。

2026-08-20 推荐人工作台的企业选择已移除按第几个企业写死宽度的规则：每个企业胶囊会在既有横向滚动区域内按单行内容自然撑开，长企业名不会再覆盖后续企业或“加入企业”入口。工作台主标签和业务数值统一为 `24–28rpx`，说明文字为 `20–22rpx`。“加入企业”现调用原生二维码扫码，仅接受带 `token` 或 `scene` 的既有入驻页路径，再将扫码结果交给既有服务端校验的入驻流程；扫码失败、无效码和页面打开失败均保留明确反馈，主动取消则停留在工作台。接口、成员关系切换边界和角色权限不变。当前 DevTools 窗口没有可验证的 automator endpoint，登录态 `390x844` 宿主截图待补。

### 客户服务需求记录（已实现）

- 客户路由：`packages/business/service-needs/service-needs`；`packages/business/free-design-service/free-design-service` 的服务已建立态在主按钮下方展示弱入口「有其他服务需求？补充一下 ›」，并移除旧的「稍后再看」操作。
- 客户 API：`GET/PUT /api/miniprogram/customer-projects/[leadId]/service-needs` 校验当前签名客户拥有未归档线索，在租户隔离的 `app.lead_service_needs` 表（`admin/drizzle/0041_lead_service_needs.sql`）中保存 `old_house_consultation`、`materials_consultation`、`partial_space_advice` 白名单需求，不改变 `serviceStage`。
- 员工 API/UI：已派家装设计顾问、家装现场顾问和企业负责人可从 `lead-form?mode=edit` 通过 `GET/PATCH /api/leads/[id]/service-needs` 录入微信沟通结果；选择空项会清除记录。平台不提供站内聊天，也不宣称自动添加微信好友。

### 已有进行中服务视觉更新（implemented）

`free-design-service` 的 existing 状态已按用户批准的 C 版 `design-references/free-design-service-existing-redesign-v2/option-c-continuity-archive-drawer.png` 重构为续办档案柜。原生主票据展示「服务归属已保留」、脱敏免费设计服务标识、真实当前阶段/最近更新、三段服务路径和可点击「服务进度 / 户型档案 / 设计方案」档案签；三项与唯一绿色「继续查看服务档案」均进入原服务档案，不暗示各目录已完成。旧通栏「联系当前家装设计顾问」改为辅助设计师条内固定 `148rpx`（窄屏 `132rpx`）「查看微信」，并按项目聚合真实 `professionalProfile` 展示有值的头衔/经验/服务人数。阶段索引仍只由真实线索状态/服务阶段文案派生，并补正「现场顾问/上门」为量房安排。批准稿小 K 档案柜映射为内置 ImageGen 生成并优化的 `720×346`、`25733` 字节索引色透明 `xiao-k-continuity-archive-drawer.png`；文字、状态、目录和按钮均为原生节点。原有 `GET /api/miniprogram/customer-projects/[leadId]`、联系人权限、档案路由和领取幂等不变；聚焦合同、图片、字号和分包检查通过，更新后的高屏及 `390x844` 原生胶囊运行图待用户手动复核。

## 角色引导

角色引导统一放在 `packages/guides` 分包，避免插画膨胀主包。`enterprise_admin`、`designer`
与 `measurer` 在对应工作台首次进入时自动展示一次，之后可在「我的」重复查看各自已批准的三步引导。
三步内容使用原生非循环 `swiper`：可左右滑动回看上一页，点步骤点或步骤轨跳转，「下一步」仍可前进，
不自动播放。企业负责人最后一步进入既有活动码展示页，家装设计顾问最后一步进入 `staff-earnings` 收益页，家装现场顾问最后一步回到今日工作台任务；
`customer` 仍不强制出现：`packages/guides/customer-guide/customer-guide` 在宽屏由「服务」首页小K旁的气泡入口手动打开，`<=400px` 则改由 Hero 说明文案下方正常排版流内的「点击我带你看看」入口打开，不在首次进入、「我的」页或本地已读存储中自动触发。四张原生非循环 `swiper` 依次说明三个免费权益、表达装修需求、真实需求沟通/预约量房/方案沟通路径与既有服务档案；跳过或末页均回到既有「服务」Tab，不新增能力、API 或权限边界。能力映射分别为 `enterprise.operations`、
`staff.leads` 与 `staff.schedule`；各引导的生成插画为调色板压缩透明 PNG，均控制在分包素材 `300KB`
上限以内。五个自定义导航引导页均通过 `border-box` 顶栏上的 `navigationRight` 把原生胶囊区域算进标题行宽度，顶栏最小高度含状态栏内边距，避免「跳过」溢出到胶囊下面；标题强制单行且「跳过」按钮不允许被压缩，因此标题可使用胶囊左侧的可用空间而不会无故换行。重新生成的家装现场顾问三图映射为
`assets/measurer-v1/{measurement-bench,measurement-path,measurement-complete}.png`，尺寸依次为
900×960 / 960×640 / 867×960，体积为 100,280 / 64,543 / 82,506 字节；整个 `packages/guides`
分包为 1,278,511 字节，低于其 2MB 源码上限。家装设计顾问首次引导完成后才继续检查微信资料补全提示。登录态 `390x844`
原生胶囊视觉核验等待用户提供运行截图。

「我的」账号行现在对 `referrer`、`enterprise_admin`、`designer` 和 `measurer` 显示；当前身份通过
`roleGuide.js` 解析对应的引导路径。

### 个人推广人入驻邀请来源

仅当个人推广人入驻码的邀请员工仍为可用的合格员工且有非空展示姓名时，
`GET /api/miniprogram/codes/resolve` 才返回 `inviterDisplayName`。
`packages/business/onboarding/onboarding` 在既有企业邀请卡中显示「由企业员工{name}发起邀请」，
`enterprise-join-codes` 的微信转发标题显示「{name}邀请你加入{enterprise}推广团队」。企业公共码不展示个人姓名，也绝不回退展示系统生成的用户名；仅公开姓名，不公开手机号、微信号或头像，不新增权限，也不改变企业归属、首邀员工快照、租户范围或提成规则。

## 维护规则

### 经营趋势数据标注

企业负责人 `pages/enterprise-operations/enterprise-operations` 的 canvas 保留既有两条真实 `contractAmountTrend` 序列及角色/API 边界。为保证 `390x844` 下可读性，现为选中的非零数据点绘制紧凑金额标注（单位万元），包括图表顶端峰值；零值点不显示标注，两条序列均为零时仍使用既有空态。

### 角色入口收敛补充

兼容登录返回的 `role: user` 客户会话统一归一为 `customer`，避免冷启动时误落入旧户型壳；旧报备、提成、灵感等仍打包的深层路由也登记到能力表，不能再因“未登记即放行”绕过角色守卫。

客户、推广人以及家装设计顾问、家装现场顾问、企业负责人和平台管理员的“我的”页只保留账号、身份与安全能力，不再渲染旧员工户型列表、“新建量房”或“开始量房”。此外，`designer`、`measurer`、`enterprise_admin`、`platform_admin` 进入“我的”时不会显示统计卡、“我的工作台”“我的待办”以及“AI 设计空间”相关模块。推荐人 TabBar 现在直接提供“推广/客户/收益/我的”四个合同入口。家装设计顾问和家装现场顾问 TabBar 同样提供“收益”入口（`staff-earnings`），只读本人线索提成的待发放/已发放笔数与状态（不下发、不展示金额）。企业负责人 TabBar 提供“提成”入口（`enterprise-commissions`），展示本企业待支付/已支付/已作废金额汇总；客户完整付款批次中，待支付**状态**与可点击的「确认线下付款」**操作**明确分离，原生二次确认写「确认付款」，成功行写「已完成线下付款」。推荐人、家装设计顾问和家装现场顾问三种岗位的待支付行均提供次级「调整金额」操作，并复用 `LeadCommissionRepository.adjustPayable` 写入审计；小程序企业负责人仍不能改受益人，确认付款保持独立操作。客户打开线索详情时不显示正式量房编辑、新增或删除动作。负责家装设计顾问在本人客户线索详情拥有开始、继续、新增、删除量房操作。已派家装现场顾问从本人工作台任务进入唯一正式量房编辑器，企业负责人则在本企业每条线索详情拥有同样的开始、继续、新增、删除量房操作。企业负责人也可在每条未关闭、未归档线索上使用既有线索绑定 AI 设计入口；沿用当前方案工作台，不新增企业负责人「设计」Tab。线索列表的“新增客户”入口仅对企业负责人显示，提交后写入 `manual_entry` 并自动派家装设计顾问/家装现场顾问；预约创建、预约详情和改期深链按客户、家装设计顾问、家装现场顾问、企业负责人能力分别放行。共享 `openSurveyingEditor` 还会对已签名身份执行二次能力校验，防止其他页面或旧深链绕过角色导航。

### 企业提成金额调整与零金额快速记账

`PATCH /api/miniprogram/enterprise-commissions/[id]` 仅允许已签名 `enterprise_admin` 调整当前租户一笔 `payable` 记录的 `payableAmount`。推荐人、家装设计顾问和家装现场顾问三种岗位共用同一个入口和仓储审计；小程序不能改受益人，已支付或已作废记录保持不可调整。付款台账在三种岗位的付款确认旁统一提供次级「调整金额」操作，校验金额不小于 0 且最多两位小数；接口失败时保留弹层与用户输入，成功后重新加载企业汇总。

`POST /api/miniprogram/enterprise-commissions/record-zero-payment` 继续作为一笔当前 `payableAmount` 为 `0.00` 的 `payable` 提成的“调整并付款”快捷操作。它校验实际付款金额大于 0 且最多两位小数，以「小程序线下付款补录」写入既有金额调整审计，再在同一 Mini Program PostgreSQL 事务中将该笔标为 `paid`。对小程序调用者，`POST /api/miniprogram/enterprise-commissions/mark-paid` 会拒绝零金额行，因此含零金额行的批次不显示批量确认，非零行仍使用标准确认。付款操作会自行消费点击事件；零金额行打开固定在当前视口的快速记账弹层，弹层使用 `border-box` 外壳与可收缩的 flex 操作行，窄屏下两个原生按钮都保持在卡片内；记录 ID 缺失/过期或重复提交时给出可见反馈，不再静默无响应。

### 户型 AI 结构约束提示词（已实现/有限）

绑定正式户型的出图路径会在服务端最前面拼接后台可配置的结构约束提示词（Admin `GET/PATCH /api/platform/ai-prompt-config`）。量房图只负责几何结构并保持第一张控制图，现场图负责相机、透视、机位高度、视场和构图；除非用户或模板明确要求俯视，量房图本身的俯视/线稿表现不会套用到最终视角。无绑定户型的拍照配方保持原行为。

路由、API、权限、数据合同、状态、限制或视觉源变化时，只更新对应行和中文镜像。
还原台账每条路由只保留一行当前状态，不追加日期实现说明、已废弃设计源或重复测试全文。

English mirror: [miniprogram-system-modules.md](./miniprogram-system-modules.md)

### Mini Studio payload 性能（已实现）

`scheme-studio` 方案列表/详情路由读取 generation 与发布记录摘要，不再加载大段 `input`/`output` JSON；供应商 data URI 在持久化前替换，避免历史 generation payload 膨胀到 MB 级，图片继续通过签名媒体 URL 交付。页面对同一客户的兄弟方案查询缓存并去重 30 秒，任务轮询不再重复下载方案列表。

### 单间模式边界（已实现）

正式户型自动补绑（Implemented）：共享后台在下次 Studio 方案列表/详情读取时补齐未绑定的活动方案。优先选择未归档客户的合格正式主户型；没有主户型指针时只选择唯一合格的关联户型。草稿、无效墙图、无闭合空间及选择有歧义时保持未绑定。仅 NULL 字段可更新，保留原绑定、来源角色/图、时间戳、历史生成/批次、发布和当前设计模式。小程序详情先校验访问权再补绑。重新进入或刷新 `packages/ai-workflow/scheme-studio/scheme-studio` 后，已有批准的 Composer 可显示关联户型参考图并允许选择整屋。本次后台修复不要求发布新小程序，不新增路由、角色或视觉设计。来源：`design-references/ai-design/unified-entry-v2/21-studio-composer-v4-three-states.png`；资格、小程序序列化和本地数据库补绑测试通过，ESLint（0 错误，保留现有警告）及生产构建通过；后台部署后的人工运行截图核验待补。

`scheme-studio` 保留两种现场图优先的单间选项，但为每次 generation 冻结不同的服务端供应商提示词。**全空间设计**锁定现场图镜头、房间轮廓、墙柱、门窗与洞口，允许重新设计墙顶地硬装、固定柜体、灯光、家具和装饰；**仅软装换搭**进一步锁定墙顶地材料、固定柜体/内建构件、厨卫固定设施与建筑照明，只允许调整可移动家具、落地/台灯、窗帘、地毯、床品、挂画、绿植和摆件。模式边界优先于冲突的用户或模板要求。两种模式仍必须使用已标记现场图、不附户型控制图，并沿用现有 `image.free_create` 模型与点数合同。
### 推广人撤销线索（已实现）

`GET /api/miniprogram/referrer-progress` 返回不含个人信息的 `recordCode`、建档时间、终止类型、撤销资格、阻止原因和 10 分钟撤回截止时间。小程序「客户」Tab 把该操作写成实底「撤回」，10 分钟窗口内的反向操作为「恢复」。推广人可在当前企业成员关系下，携带 `Idempotency-Key` 调用 `POST /api/miniprogram/referrer-progress/withdraw` 或 `/withdraw/undo`。撤销记录保留为 `closed` 且 `terminationType=referrer_withdrawn` 的只读线索；员工工作台收到站内确认提醒，客户服务档案显示“服务已终止”并禁用所有服务 CTA。

### 推广人客户与收益空状态（Implemented）

`packages/business/referrer-progress/referrer-progress` 保留已批准客户档案设计（`design-references/referrer-customers-v1/referrer-customers-v1.png`）。空态说明为「客户扫描服务码并授权手机号后，推荐记录会显示在这里。」；「出示服务码」读取当前 bootstrap 签名身份的 `context.referrerMembershipId`，通过 `navigateTo` 直接打开现有 `promotion-service-code?membershipId=…`，保留客户页栈，返回后仍在客户 Tab。关系缺失或打开失败显示提示，不静默跳首页、不回退到其他企业。服务码生成及重试沿用原页面和成员关系 API。

`packages/business/referrer-earnings/referrer-earnings` 沿用现有 Phase-13 设计语言及本次用户批准的空态调整：保留笔数汇总，空态仅显示「暂时还没有收益记录」和「推荐客户完成签约后，符合条件的收益会显示在这里。」，无按钮、无按钮占位，卡片按内容自然收拢。路由、API、数据及角色权限边界不变。聚焦导航回归测试通过；修改后的 `390x844` 原生胶囊及高屏视觉 QA 等待用户手动截图，未自动操作微信开发者工具。

## 拓扑 P0 当前合同

**Implemented**：正式草稿本地保存、云端写入和恢复统一完整校验；普通提交自动节点化精确 T/X、同步 Face/Space，有序简单空间边界成为硬约束。嵌套闭环明确拒绝。近闭合读数作为 `session.pendingMeasuredClosure` 持久化，沿用现有“合”确认，恢复失败保留原稿与诊断。路由、权限、租户边界和正式 v4 外壳保持现有合同。

**Limited**：内洞和嵌套空间仍不支持。S4-B 全 arrangement 整数网格 Snap Rounding 已 Implemented，覆盖非整数交点、热像素共享节点、1mm 切段、门窗保护及有预算的原始读数分摊；量化后的重复物理墙仍拒绝。现有量房视觉来源及布局不变，待用户提供运行截图验证近闭合状态。详见 [P0 合同与验证](./surveying-module/topology-p0.zh-CN.md)。

## 拓扑 P1 当前合同

**Implemented**：持久化业务字段自动保存指纹（包含 `centerOffsetMm`）、局部有向房间侧向、净边界校验、复尺预算、同墙门窗占用、严格完成条件、结构化异常输入拒绝及稳定分割/合并身份。草稿与完成写入共用小程序/Admin 校验器。路由、API、角色、租户边界和 v4 外壳不变，非法写入仍返回 422 诊断。**Limited**：独立墙/半墙豁免、版本冲突和真机预算尚未实现。沿用现有量房界面，手工运行 QA 待用户截图。详见 [P1 合同与验证](./surveying-module/topology-p1.zh-CN.md)。

## S4-B Snap Rounding 合同

**Implemented**：普通提交在拆墙及 Face/Space 同步前，将全图 arrangement 经过单位热像素节点化。小程序/Admin 生成镜像保持 v4 外壳、路由、API 及权限边界；服务端验证提交图，不暗中修复。未修改可见 UI、插画、BLE 或设计来源。详见[当前算法、测量及验收合同](./surveying-module/snap-rounding.zh-CN.md)。

## 门窗交汇边界

**Implemented**: 门窗新增和编辑按扣除相邻墙实体后的宿主墙可开洞区间，同时限制宽度与位置；计算使用实际墙厚、实体侧和夹角，不使用固定比例或固定墙角留白。可用长度不足 100 mm 时以 OPENING_HOST_TOO_SHORT 原子拒绝；整数中心舍入不越过交汇边界。已保存门窗不在加载时批量迁移，重新编辑时应用新边界。路由、API、权限、v4 字段、Canvas 门窗符号和 WXML/Less 不变。行为依据为用户 2026-09-07 图1（f88b2f17ace1bb32c1ecc7826a9ad132.jpg），图2为缺陷证据。聚焦回归覆盖宽度/位置、不同墙厚、斜交、旋转/镜像、反向宿主、自由端及过短墙；运行视觉核验仍待用户手动截图。
