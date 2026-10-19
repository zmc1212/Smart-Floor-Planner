# 小程序当前功能清单

**等待设计师时客户明确取消：整句明确文本的闭环已Implemented，整体Limited。** 原C01输入框发送“取消人工接待”或“不找设计师了”，沿原 `POST /api/miniprogram/assistant/conversations/:id/messages` 请求键及取消事务，保存原话与既有“本次接续已结束，小K恢复回复。”系统反馈、撤销接待参与者、推进上下文/版本并回到AI，不创建run或供应商调用。仅本人所属、仍open且 `handoff_requested/waiting` 的会话可改变；已进入人工接待、提问、引用、假设和拒绝取消仍是普通消息。租户、本人、来源、留存、接单竞争与幂等守卫保留。

验证：离线259/259；真实隔离PostgreSQL服务7/7组加Stable C01原生1组，390×844原生10/10检查点。取消已提交但HTTP回包丢失后，重进保留原操作，“确认发送结果”沿原键恢复同一回执，再次请求/取消可用。最终源码hash稳定；本夹具run/attempt/模型开始及剩余合成企业/用户/员工均0，共用锁已释放。类型287→287、新增0，定向lint通过。产品markup/样式/资产/导航/文案均未改；唯一批准C01源仍为 `design-references/xiaok-p4b-public-sites-v1/README.md`。功能截图 `tmp/xiaok-handoff-cancel/service-native-attempt-6/native-cancelled.png` 不代表完整宿主/高屏/真机/真实微信/BLE或通用语义通过。见[当前接待合同](./xiaok-assistant-phase-2.zh-CN.md#当前明确取消等待接待)。

**共享供应商连接错误：限定修复，整体Limited。** 已调用fetch后，无响应的普通连接/TypeError现归`unknown`，不再是`safe_fallback`，不能据此自动向第二供应商提交。错误码/文字/状态、配置超时及原明确HTTP响应/派发前策略保留。attempt/run/用量/预留及租户/角色/来源/租约/回执接口保持，不改表、队列、factory、API或UI。347762ff归档run4369/attempt1804仍为attempt failed/accepted=false、run indeterminate、预留reconciling及费用null；原queued发送确认和该布尔均不是供应商接收或未接收证明。不改历史行/费用/请求键，不重试4369/4242。当前230/230离线通过，含194业务/知识、32项既有供应商/账务和4组模拟传输测试（修复前1组失败）；受影响lint通过，同程序与05edc4d3对比类型287→287，新增0。无新DB/供应商/实模/Embedding/浏览器/原生调用；PostgreSQL收敛/retry守卫仅源码核验，未重跑。缺供应商结果/用量证据，原夹具也已清理，费用收敛和实模语义仍未验。准确只读证据及合同见[传输确定性](./xiaok-assistant-phase-2.zh-CN.md#当前共享供应商连接错误与结果确定性)、`tmp/xiaok-provider-certainty/`。

**KB-4原C01知识修订同题回答：限定服务接入，整体Limited。** 原`packages/assistant/chat/chat`继续使用批准C01/C02/C05/U01入口、反馈、来源片及重进；不改小程序代码、样式、素材、导航或权限。后台整理问题及本人试问回归复用同一有效知识服务，客户真实Agent另外验证修订发布来源与未知事实边界；换版/撤回在重进时使旧回答和引用失效。私人咨询/项目资料不自动复制到企业问题集，管理端回归不冒充客户业务验收。合成资料、配置实模/原生限定检查、来源版本映射及当前限制见[KB-4合同](./xiaok-assistant-phase-2.zh-CN.md)、[交接](./xiaok-assistant-handoff.zh-CN.md)。完整专业客服、OCR/复杂格式、真机/真实微信/BLE及生产仍Limited/未验证。

**KB-3原C01实况综合回答：限定实现，整体Limited。** `packages/assistant/chat/chat`保留已批准气泡、来源片、反馈/重试/重进、WXML/Less、字体/素材与导航。原真实服务在知识查询/短追问同轮补齐当前获权节点及材料快照，结合有效企业依据。`professional-hybrid-v3`在5片上限内将明确不适用阶段后移、优先覆盖不同文档，未知条件保留；诊断和C01共用授权/配置。prompt v38结合本人原话、正式v4主户型与向本人发布的现场记录解释条件，不把墙图当点位图、不从阶段认定检查完成。相关变更/撤回使派生历史和引用失效；取消/人工模式守卫不变。无新增小程序API、文件导入、权限或正式写入。PPT17/18/19/23/38及6/15精确映射、合成双阶段题、实模/原生证据及限制见[KB-3合同](./xiaok-assistant-phase-2.zh-CN.md)、[交接](./xiaok-assistant-handoff.zh-CN.md)。完整专业客服、图片质量结论、真机/真实微信/BLE及生产仍Limited/未验证。 当前原问题与模型检索词组成一次有界查询，保留明确对象，仅影响召回/排序，不把提问当项目事实或权限。

**KB-2 C01文件原段引用：限定实现，整体Limited。** 原`packages/assistant/chat/chat`通过同一Agent/HTTP/Worker使用已核对发布的DOCX或文字PDF依据。原来源片仅增加一行26rpx辅助文字，显示文件名与真实DOCX章节/段落/表行列或PDF页；无新样式/资产/导航，原气泡、引文、错误/重试与重进保持。来源API提供不可变原件hash/block/解析器及Unicode实际引文范围/重复歧义，模型改写不是原文。客户公开受众、有效当前版本、租户/参与者/当前工地实况及撤回继续重验。上传/核对/索引/发布在原后台完成，不新增客户文件导入器或项目/私聊权限。PPT/设计映射、两轮固定语义题、原生证据、模拟器/Chrome/构建限制及真实/模拟/合成口径查[二期KB-2合同](./xiaok-assistant-phase-2.zh-CN.md)和[交接](./xiaok-assistant-handoff.zh-CN.md)；OCR/复杂文件、完整专业客服及生产仍Limited。

**KB-1专业条目与检索诊断：限定实现，整体Limited。** 原 `/assistant-knowledge` 正文/FAQ和C01继续使用同一知识服务、配置模型与LangGraph。0085在原知识版本增加不可变专业类型、主题、适用条件、前置/例外、来源版本/章节和服务端审校留痕，旧普通条目/hash兼容；后台原Drawer维护、索引、发布，未来稿不提前覆盖有效旧版。原混合检索在硬授权后提供匹配/缺失/明确不适用结果，当前只自动核对绑定房屋唯一获权活动项目的实际阶段，其他条件保持未知；登记的互斥口径冲突保留双方，不按上传时间择一。v26把企业依据、本人原话、正式v4主户型、当前节点和已发布现场记录共同用于自然解释，事实/建议/未知分开，普通说明不自动建事项或形成正式承诺。新 GET `/api/assistant/preview/runs/:id/diagnostics` 仅本人试问的当前管理者可读，回读实际候选/排名/上下文、配置、条件和合法排除计数；每次重验epoch、来源/profile/有效期/受众、草稿及实际阶段，变更后不外发旧诊断/派生结论。管理者三角色继承、租户/参与者/原件、原任务/用量/真人接管边界保持。小程序仍复用批准C01/C02/C05/U01气泡/来源片/失效态，不改WXML/Less/字号/插画/导航；后台沿原Ant Design/Admin Pro及共享反馈。限定PPT6/15/18/19/23/38映射、真实/模拟/合成证据及未测项查[二期KB-1合同](./xiaok-assistant-phase-2.zh-CN.md)和[交接](./xiaok-assistant-handoff.zh-CN.md)。文件入库/OCR/完整专业客服与P5仍Limited，构建/类型/独立打包阻碍不升级为发布通过。

**当前P5/PPT38现场落实、正式解决关闭与原咨询回传：限定闭环Implemented，整体Limited。** 原S04以当前获同意的精确方案，关联同房间已核对发布、有完成内容且无待处理缺项的现场记录及照片原件；负责人/管理者明确记录落实，管理者分别正式解决、关闭并选择回传节选和是否开放这些原件。客户同意、普通回复、照片发布不自动推进正式状态，关闭不代表工程验收或付款。独立处理修订、原键恢复、真人延后/乱序去重、重新处理及换版/撤回/撤权守卫沿原事务/outbox/Worker，原件仅以JWT回传原授权咨询；移出或所需角色降权后再授权不复活原正式依据，member审计保留服务读取的previousRole/previousActive。prompt v20的query_followups只读实际结果并继承原施工来源链；方案决定来源按业务修订优先，晚到的原发布通知不改变当前决定的来源ID。不增表、迁移、页面、菜单、WXML、Less、插画或导航；复用批准S04/C01/C05/U01。当前接口、角色、状态、设计映射、复跑命令和验证边界见[二期当前合同](./xiaok-assistant-phase-2.zh-CN.md#当前p5ppt38现场落实与正式解决关闭)，证据tmp/xiaok-p5-resolution/。既有构建/类型/独立Mini打包限制保留，不声明完整P5、可发布或干净克隆全通过；未合并main或部署。本段当前限定范围优先于下文旧阶段“正式决定/落实关闭未交付”的描述，旧批次测试及未测记录仍按原范围保留。

**前批P5方案精确版本与决定：PPT19/23/38限定闭环Implemented，整体Limited。** 原S04 `packages/construction/chat/chat`上传一张本人出图原件，显式发布绑定事项/来源的不可变V版本、前版、差异及明确费用/工期变化；原记录/事项/资料/方案修订限制写入。原C01 `packages/assistant/chat/chat`复用批准C05/U01卡、节选/原件/动作/反馈与既有原生编辑确认，支持完整预览、同意、拒绝、稍后、要求修改；原件未加载不启用同意，普通“好/可以”不批准。不改Less、插画、导航或页面。GET `/api/miniprogram/assistant/conversations/:cid/plans/:versionId`、GET `…/media`及POST `…/{preview,approve,decline,request-changes,defer}`继续本人咨询/租户/参与者隔离、no-store和JWT原件保护。原操作日志精确回执支持丢包/重进，身份切换隔离；旧版不能复活批准。原Worker真人期间延后，只投递原需求授权咨询一次；来源/角色/模型派生回答动态重验。prompt v19通过`query_followups`查真实版本/影响/决定，效果图发布保持独立。自动算价、CAD/PDF、事项关闭/落实/验收、外部投递未交付。合同/状态/设计映射与最终验收见[二期](./xiaok-assistant-phase-2.zh-CN.md#当前p5正式方案精确版本差异与客户决定)、`tmp/xiaok-p5/`及唯一还原台账；未生产发布。

**PPT23/P4A当前更正、获权来源与事项接续：限定Implemented，整体Limited。** C01保留原咨询及批准C01/C02/C05/U01组件，S04保留原PPT22/38。prompt v63支持明确更正后紧接提问，先保存再查依据，区分开轮记忆与更高版本的服务回执。既有`record_need`可选最多三条`additionalNeeds`，合计四个独立房间/字段；先核验全部原话/房间/字段，再同事务保存，返回当前`savedFacts`，按稳定逐条操作键恢复，不重复记忆或事项进展。假设、转述建议、房间不明不升为客户事实。`customer_need.need`给出当前字段/值和同字段supersedes链；只读`qualifiedBy`兼容desk/other混写人数与位置的存量记录，仅以同房间后续明确use更正限定人数，原话、桌型/位置、设备、其他房间与审计保留，不改变共享、正式版本或客户决定。单一devices复合字段内的复杂增删、任意跨阶段矛盾仍Limited。更正来源不可用时保留不含失效值的只读屏蔽标识，不回退旧混合人数；事项查询共用获权记忆投影，失效更正不能借另一适配器回流。

v63保留v62的quote实际位置、限定词与房间校验，修正既有人数阅读辅助：被否定或暂定的人数不算已确定，完整可用原话仍为known并逐字保留；更正中的肯定分支用于原当前来源引用守卫，已知人数确认及出处围栏不放宽。明确“人数未定”也会限定旧desk/other混合行中的人数，来源不可用后沿原无值标记防止旧人数回流；原历史、桌型/位置、设备、其他房间及来源/权限检查保持。不新增事实库、schema、API、客户端状态/布局或队列。提示元数据为v63，静态提示/工具措辞、sources-v11、六段/每段四引用和48,000字节预算保持。当前194项去重离线通过（原188＋6组合成解释反例），5项受影响TS文件lint无错误警告；同程序与04a85946对比类型287→287，新增0。已保存回答/预算仅离线回放，无新实模/Embedding/DB/浏览器/原生调用，也未占用验收锁，不升级语义或原生验收。旧完整构建限制不属于本次小客修复。命令、有限措辞边界及旧页面准确诊断见[二期当前合同](./xiaok-assistant-phase-2.zh-CN.md#当前p3bp4a客户更正与原事项接续)、`tmp/xiaok-need-interpretation/`。

原`query_materials`、`query_followups`和绑定房屋的`search_knowledge`复用获权适配器。知识查询现把`synthesis.bound_followups.v1`与材料/实际施工共同持久化，携带原issueId/revision、当前等待对象/负责人及精确来源版本；恢复、后续模型调用、提交、历史及人工接续继续重验。需求补充与已回传现场事项分别解释，负责人姓名不授予直接联系渠道。当前意向、旧共享参考、团队关联核对及精确正式决定不混用；已知靠窗意向直接沿用，可量测坐标/检查依据未查到只表示本轮未知，不推成现实没有。阶段电话缺失只限制该电话入口。sources-v9模型视图在原48,000 UTF-8文字字节预算内保留标准工具配对、完整原文/权限元数据，并以别名映射合并完全相同的重复来源；持久快照仍完整。原grant/原件/版本/撤回、强制RLS、企业/客户/原咨询/项目/房间、三类管理者继承、outbox/Worker/用量和真人围栏保持，无新表/迁移/API路由/菜单、Mini结构/样式/素材/导航或权限扩张。综合及普通自由回答在最终提交事务共用本轮真实记忆/偏好操作回执检查，旧事实和引文不能替代保存成功；检查覆盖已记录、已按更正记为/更新为等已知回执形式，不保证任意改写或自然语言逐字段语义。当前投影仍不发送图像像素。合同、实际成功/失败、合成与实模/原生证据及限制见[二期](./xiaok-assistant-phase-2.zh-CN.md#当前p3bp4a客户更正与原事项接续)、[交接](./xiaok-assistant-handoff.zh-CN.md)及`tmp/xiaok-fact-boundaries/`。完整客服/PPT、图内识读、Chrome/完整宿主光学/高屏/键盘/真机/真实微信/BLE及生产仍Limited/未验；前批证据单独保留。

模型阅读辅助`answerContext`只从本轮获权原话派生当前用途、是否明确人数及不含失效值的未知标记，不是事实库或保存回执。已覆盖的当前人数更正表述须引用自己的use原话，只接受同一有效原话的当前获权别名；事项状态、旧共享原话、正式版本或不相关节选不能代替。既有来源类型守卫与普通回答最终事务共同防止绕过。最终综合还拒绝已记录的内部术语、重复人数确认、有效更正后的拒改措辞、未就地限定的量测缺项及失效后默认人数；其他房间/未明确人数的必要问题、明确归属团队或现场原文的记载仍允许。

专业“那为什么”接续保留相关企业依据和实际项目/事项；图纸核对记录不推广成整体施工进度，本轮未取得尺寸不代表现场没有量测或不可施工。普通私聊补充不称作送达团队，电话缺失不成为原聊天/人工接续前置；不从人数减少推定设备/插座应减少。原六段/每段四条引用及一次有界引文/数字修复保持，不增加语义重试、不改写历史已存回答。这些是限定反例守卫，不是通用专业判断。

当前确定性单元73/63；二十七次v51–v56实际原回答夹具保留被拒缺陷和可接受旧回答。26条实际历史输入离线投影为39,716–46,297文字字节，原48,000上限不变。本轮实模/原生/冻结检查、失败与未知费用见[交接](./xiaok-assistant-handoff.zh-CN.md)及本worktree的`tmp/xiaok-fact-boundaries/`。原共享锁覆盖临时localhost:3007服务/Worker的批准55432隔离库全过程；原3006及开发主库保持。KB执行修订须固定实际模式/供应商/模型/prompt/来源版本，知识试问不是C01，不能冒标v57；批量生产端口及跨进程取消围栏留待独立集成。无知识专属模块、任务载荷、队列或schema变更。

最终v57只修复解析/协议规范化，模型输入政策与current-turn-sources-v9沿用v56。过长重复引用只合并同一当前来源中已逐字有效且相邻/重叠的节选，不加入未引内容或数字支持；每条仍≤400字，规范化后每段仍≤4条。五个不同原件、坏/越权引用、额外元数据、未引间隔内容仍拒绝，不增加修复。紧邻否定“不等于现场点位已经落实”仍表示不能推定结果，独立正向落实断言继续拒绝。最终73单元含八条v56服务实模原回答及原生4109的精确回放，不冒充v57新增八次调用；v56原生15项通过后首条模型被拒，后续未执行。最终新原生/冻结证据见交接。

当前完整专业语义验收仍未通过：v57原生17项通过、1项失败，接续4115未明确关联私聊单人与正式双人的差异，且仍把图纸核对记录说得像整体进度；后续原生撤回/未知人数/成员403未执行。服务v56八次实模及最终解析器离线重放均通过限定检查，不能替代未执行的原生步骤。具体证据与待办见交接。

冻结工程验证：核心104项及不重叠Agent19项，去重123项中121通过、2项配置实模重复路径跳过，零失败，两组源码清单均未变。73项单元已含其中，不重复累计。相关lint零错误零警告；类型基线287→287、新增0，仍非全量类型通过。Mini92/92为较早的未改客户端检查；这些检查不能替代仍失败的原生语义验收。

<!-- boundaries-v61:start -->

- 当前v61 / `current-turn-sources-v11`保留当前私聊用途与精确正式版的明确对照，图纸关联限定于这条实际回传记录，真实施工阶段另查当前节点。原4115/4102及4235仍为反例；原4241保留多余引用字段及历史indeterminate状态。不静默剥离引用字段，不增加语义修复或模型轮次。

- 仅在模型视图超限时，把可逐字定位的重复摘录正文改成完整K来源text的UTF-16起止索引`evidence.textRange`；全部选摘ID和全部已选规范片段仍保留。不同K身份不因文字及描述性元数据相同而合并。完整来源正文、条件、范围/版本元数据、结果键及来源别名保持；未知摘录元数据或无法定位的文字原样保留。可省去派生文案/阅读提示，持久工具结果、快照和授权不变。既有唯一一次格式修复只省去已验证的重复提示，严格来源/引文检查保持且不能调用业务工具。原48,000 UTF-8文字字节及四轮上限不变；确实无法容纳时按已知本地校验失败处理。

- 实际解析出的Agent请求在新attempt和供应商开始标记前校验；Worker按本次派发跟踪确定性，前轮成功不把后轮本地校验失败变成远端未知。已在运行/未知的缓存调用仍不可重派。本地`agent_input_limit`保留为失败码；前轮已观测用量、不可用费用及reconciling预留保持。历史未知attempt不重试、不核销、不填写零费用。

- 新增限定的最终归因守卫：对已登记的相反规则声称共有前提时，同一事实段必须逐方引用该前提原文；只有一方的两条引文仍不够，单方做法可以单独归因。这不是通用语义裁判。实际4245/4246被运行解析器与知识6b974e3d验收合同共同拒绝；补全来源的样例只证明校验规则，不算新实模答案。旧KB-1材料两答的业务边界审读结论仍保留，但其内部标签仍被当前用语守卫拒绝。

- 已执行证据：v60冻结核心115项中114通过、1项配置重复路径跳过；最终v61离线94/94、隔离模拟HTTP派发/费用检查3/3、相关18文件lint无错误警告、同程序类型287→287新增0。知识6b974e3d合同自检64/64，网络/数据库/模型调用均0。实际4242按当前策略回放为44,585字节，五个片段/四份文档完整；4241格式修复47,754字节。这些是离线/工程证据，新的原生及配置实模语义结果另记交接，不据此推定。知识专属v4检索/批次仍在独立分支，本checkout不冒称已集成或自动批量派发。

- 隔离业务验收使用localhost:3008及原共用advisory mutex，3007保留给知识线。可选等待仍使用同一把锁；目标/角色在等待前检查，schema/空闲队列在取锁后检查，全部先于夹具和Worker。定点原生模式各执行一次真实更正、接续和撤回后回答，明确不重复基线题。本变更不含Mini结构/样式/素材/导航、API/权限、schema/迁移或全局队列权威变更；新的Stable定点原生21/21通过，4322/4323/4324真实保存，来源/重进/撤回/成员403检查及源码哈希保持。4323闭环4115的限定人数对照/进度范围缺陷；4324保留人数未知，但末尾仍用条件式一人示例补问，为已记录的措辞限制。基线未重复。本轮只验证既有流程，不升级UI还原或生产批准。夹具3497有6条成功run、11条成功的run绑定chat attempt，6条预留仍reconciling，费用未知，索引工作不计入这个chat数量。自建进程已停、传输已恢复，原副屏窗口已无抢焦点地返回最初最小化状态。

<!-- boundaries-v61:end -->


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

**P4A工地共享对话与发布/关注限定闭环Implemented，整体Limited。** 共用工地详情进入`packages/construction/chat/chat?projectId=…`；每工地一份成员共享对话，真实作者/原话/鉴权照片/整理草稿/版本均真实保存。`/api/miniprogram/construction/projects/:id/chat/*`覆盖消息、媒体、核对/发布/更正/撤回/重试、版本及原键回执核对。observer只读，作者只改本人，经理/负责人核对他人；向当前业主开放须获权管理者明确选择。admin/super_admin继承所选企业负责人权限，无须成为项目成员。0083新增6张施工表及project_collaboration权限适配，15表强制RLS，企业重置/删除覆盖。复用现有Worker/provider/配额/用量/未知调用恢复，模型只出草稿；原咨询查询、动态及图片重验精确发布版本，明确关注/取消有真实回执和去重outbox，页面关闭后仍由Worker写入站内咨询，人工模式不插话。更正/撤回/成员或客户撤权收紧旧资料。PPT22/38及C01/U01为设计源；独立ImageGen透明PNG为37,896字节，无整页切片。公开工地按3.7交付；ASR/视频/外部微信推送及正式批准未实现；原生390×844/高屏/键盘与人工验收待测、非阻塞，未生产发布。完整API/数据/状态/元素/验证/手测见[总计划3.5](./xiaok-assistant-roadmap.zh-CN.md#35-p4a-工地共享小k对话记录发布与关注限定闭环)及二期契约。

**既有小K UI回查修正：代码Implemented，原生视觉待验收。** 用户要求检查并重做此前偏离源稿的UI；当前`packages/assistant/chat/chat`按C01/C02取消额外箭头/常驻实现说明，以品牌返回；选图直发保持，移除无入口的客户资料分类表。`packages/assistant/handoff/handoff?staff=1`按S01-01/02/B01恢复品牌/角色、接待标题/IP、队列头像/状态/实际数量/分栏空态；接手后同聊有作者/头像、独立消息滚动和胶囊输入，原话定位消息区、键盘不重复留底。接管前仍只元数据，不伪造姓名/肖像；图片按钮查已授权资料，未增加员工发图/ASR。`packages/construction/projects/projects`按PPT26 manager.png恢复品牌/角色/章节/卡内操作，保留真实节点/分工，不填示例图或开放未完成功能。路由/API/数据模型/租户/私聊/接管/项目成员/幂等及正式v4写入不变；工地共享对话单独归P4A，不复用业主私聊。场景PNG复用原独立生成文件，复制到`packages/construction/assets/xiaok-project-scene.png`（780×380、51,118字节），避免跨分包资源；无截图切片/新生成图。总计划3.6、二期及双语还原台账已同步；72项Mini回归、离线86WXML+2WXS/90样式/235JS/92JSON及24例辅助布局检查通过。原生390×844/高屏/胶囊/光学/键盘/实际操作待人工、非阻塞；未操作DevTools或部署。下方P3B“未改布局”等描述仅指其当时业务批次，当前UI以本段为准。

**P3B节点补问限定闭环Implemented，整体Limited。** 继续使用`packages/assistant/chat/chat`与`packages/assistant/handoff/handoff?staff=1`；经理从原`packages/construction/projects/projects`更新实际节点，业主在本人房屋咨询收到最多一条可跳过的文字补问，可直接回复/发图、换话题或请求设计师。原服务真实保存消息/图片、来源化需求及内部核对，重进不重问；已知/暂未确定/已问需求跳过，多房屋未明确时不猜项目。后台节点`followUps`默认不配置、与到场提醒独立，无小程序新增配置页。原C01/C02/S01/U01气泡/输入/核对/恢复状态和390×844胶囊、字号、素材保持；constructionFollowUp仅切换原WXML气泡/头像状态，布局/Less/图片不变，双语还原台账记录复用来源。既有租户、本人会话、项目可见性、接续/媒体撤权、幂等及房间边界保留；等待/真人期间不插话，结束后可恢复仍有效事件，节点/配置/房间/客户撤权使旧问题及派生回复失效。工地身份不自动授予私聊，普通回答不是正式方案/费用/工期批准，无预约/正式墙图写入。合同、状态、验证与非阻塞手测见[总计划3.4](./xiaok-assistant-roadmap.zh-CN.md#34-p3b-节点需求补问与原聊天核对限定闭环)及二期；新动态/记录发布/正式决策页面仍属后续，未操作DevTools或发布生产。

**P3A施工入驻与三端共用云工地基础闭环Implemented，整体Limited。** 设计师、施工员工和老板从“我的→云工地”进入同一packages/construction/projects/projects页面，施工身份登录直接进入；保留设计师/老板原工作台。前两者只读有效关联工地，老板看本企业工地；经理可更新实际节点、分配普通成员/阶段，指定经理仅限负责人。ej_员工入驻新增construction_staff及姓名/工种，复用手机号授权、真实写入、单企业冲突/重复入驻、签名身份与跨页恢复；企业名册新增施工角色，不参与量房/设计派单、获客或分佣。GET /api/miniprogram/construction/projects、GET …/:id和POST …/:id/{member,contact,progress}返回真实列表/分工/节点/权限；空态待分配，加载/失败/重试复用U01，写操作按企业/员工持久保存原expectedVersion/Idempotency-Key，未知回执重进核对，隐藏/切身份拒绝迟到数据。contact保存员工关联和明确主要联系人，聊天原“联系管家”实时重验当前有效员工电话；停用、移出、撤销分工及旧来源均不能拨号，历史手填电话不兜底。微信手机号入口无需先到Web改密，密码入口及Web改密保护保留。模型不接收号码，不写施工/量房预约，不开放客户私聊、正式墙图或财务权限；0080–0082双库核验9表强制RLS/角色约束/迁移哈希通过。设计源、935×1683源图映射、390×844元素台账、17,723字节独立透明PNG映射、状态/限制及手测见[总计划3.3](./xiaok-assistant-roadmap.zh-CN.md#construction-staff-contract)、二期及双语还原台账；P4A现场记录/照片按3.5实施；P6简报、语音/视频及外部推送仍未实现。原生390×844/高屏/胶囊与真实拨号待人工验收、非开发阻塞；未控制DevTools或部署生产。 施工身份保留本人资料/头像/密码接口及既有本人/签名校验；原生下拉刷新、冲突后读取最新版本和按token校验写回执，避免过期资料或跨身份结果。追加真实数据库8/8、身份/凭据58/58、小程序聚焦82/82及离线模板/样式编译通过；小程序全量1920/1921，唯一既有失败为开发地址断言与当前配置不一致。

**P2C.1后台作品维护/审核Implemented，高德真实联调Limited；P2C.2限定客户闭环Implemented。** `/case-publishing`、`/case-publishing/[id]`沿用既有Ant Design/Admin Pro和`design-references/designer-portfolio-publishing-v1/`管理/编辑稿。独立`case-publishing`菜单允许在职设计师仅维护本企业本人作品，企业/平台管理员审核、退回、发布和下架，不授予整店知识或其他设计师资料权。效果/实拍分组、AI/样板间标记、排序/封面、许可、可选核验小区、本人作品集资料和审核版本经真实服务持久化；已发布内容修改生成新草稿，审核前旧公开版保持有效。`/api/portfolio/*`使用租户事务、当前角色/菜单重查、版本冲突与幂等。0071/0072新增8张强制RLS的`portfolio_*`表、租户/作者复合外键、公开版本/图片不可变约束、供应商计数/冷却及选填地图授权备注（0079移除原期限门槛）；企业重置/删除已包含新数据。小区查询仅服务端，经后台/map-settings维护各自独立的高德/天地图凭据、权益及测试结果，显式切换默认供应商，候选绑定供应商/配置版本。高德Implemented（真实宜昌连接返回10条候选）；天地图Limited（适配/模拟回归已实现，独立Key、权益及真实召回待测）。已保存Key并显式开启即可检索/绑定，授权备注选填且不拦截小区读取，开发高德已开启；0078区分供应商身份、日计数和冷却，短窗限流继续共享。小程序路由/UI及租户/来源撤权边界不变，相关50/50回归通过，原生/人工验收待测，无采购。会话绑定的`GET /api/miniprogram/assistant/conversations/:id/portfolio/{recommendations,designers/:authorId,works/:workId,works/:workId/assets/:assetId}`提供同小区+风格/同城+风格、最多3位去重设计师、精确当前版本私有JPEG及撤回校验；公开DTO不下发许可凭据和内部文件。客户P2C.2限定范围已Implemented：C01推荐卡/查看主页→`packages/assistant/designer/designer`→`packages/assistant/work/work`→返回同一咨询，沿用PPT2/3主页与已批准C01/共享状态。推荐无参时仅采用当前明确城市/风格记忆，歧义不猜；显式API仍支持核验小区优先。原生详情按效果图/实拍分组，标明AI/样板间；明确喜欢/不合适经POST `works/:workId/preference`写入会话`portfolioPreferences`与用户消息，保留精确公开版本、原话来源及更正链，expectedVersion和Idempotency-Key保护重试。POST `works/:workId/contact`复用站内接续并另存handoff.source.portfolio的作品/版本/作者意向，已有负责人冲突409，不改线索/归属/分佣或取得电话授权。POST `works/:workId/share`签发7天`portfolioEntry`，接收者经entry-context建立/恢复本人咨询，不携带客户、原会话、手机号或私有图片；C01/设计室/详情均固定品牌PNG转发封面。图片支持鉴权base64传输；隐藏、撤权或切换身份清理临时文件，重进/预览/分享重查当前许可。主页生成独立透明PNG（1050×553、140,866字节），图标沿用Lucide；映射、元素台账和手测见二期及双语还原台账。原生390×844/高屏视觉与人工验收待测、非阻塞；未操作Chrome/DevTools、未部署生产。新作品尚未接入旧`recommend_references`工具，也未静默迁移旧参考案例。契约、验证和待执行手测见[二期](./xiaok-assistant-phase-2.zh-CN.md#p2c1后台发布与p2c2公开读取基础)。

**P2A.3授权参考：PPT4–6、14页范围Implemented；P2C：内容入口基础Limited。** 既有/assistant-knowledge支持reference_case草稿，维护出处/作者、授权凭据、标签和独立压缩JPEG，按既有权限及不可变版本索引/发布/撤回。小程序C01聊天最多推荐3例，在原引用面板读取授权图片/出处，持久化明确喜欢/不合适原话及更正链，撤回后引用和相关员工/AI衍生文本失效；浏览不等于选择或摘要收藏。新增POST /api/assistant/knowledge/documents/:id/share签发7天referenceEntry；唯一entry-context入口及原生转发保存内容/渠道来源，不携带私聊、不建线索、不改归属或分佣；失效内容回到普通咨询。当前Admin复制为公司来源，API可绑定经校验的既有活动/推广码。保留平台所选企业/显式企业负责人知识权限及S01当前接待人边界。开发主库/隔离库0070迁移哈希、列及强制RLS通过。当前运行xiaok-renovation-v10，下文v9段落是历史基线证据。原生视觉/手测待执行，未使用DevTools自动化或生产部署。后续后台先行作品实施及客户入口限制见上方P2C当前记录。测试、限制和手测见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。

**P2A.3之前的P2M v9基线：Limited。** 开发环境localhost:3006／远端开发数据库的企业1454使用DeepSeek官方deepseek-flash，langgraph-v1、图片/工具启用，xiaok-renovation-v9、policy_version=3。回读一致、在途0、Worker健康200/fresh。证据：结构160/160、合成图片语义16/16、扩展会话44/44段（114/114轮）、隔离Worker19/19、纯测试63/63通过。未明确房间的指代先澄清再写记忆；通用预算/图片证据边界问答避免无谓转入企业知识检索。素材为2位作者的5张公开CC0照片及3种确定性降质变体，具有代表性的装修质量及原生人工验收仍待验证。现有路由/API/角色、C01/C02/S01/U01界面及正式量房写入保持，无生产发布。本段优先于下文历史仅规则/不能识图描述；未选择新Agent的企业仍走旧执行器。方法、证据及限制见[二期契约](./xiaok-assistant-phase-2.zh-CN.md)。

当前五类提示为批准的固定话术；Admin主动引导开关继续生效，自定义开场/顺序/选项保留为兼容配置，暂不应用当前客户聊天。后台说明及保存反馈已同步，避免把兼容配置误报为已应用。

P2S 第一批 C01/C02/S01/U01 的聊天与接待主链路 **Implemented**，自动理解整体 **Limited**：以用户本次明确批准的 `design-references/xiaok-assistant-chat-first-batch1-v1/single-screen/` 11张主稿和共享状态规则实施。客户 `packages/assistant/chat/chat` 直接聊天、发图、按原话自动保存草稿；五类轻引导遇到话题跳转后暂停，不自动回到未答题；回顾在聊天中按需返回。主路径不再展示摘要确认、完成率或图片分类表单，旧摘要页面/API保留兼容。识别采用有界中文规则，明确房间分开保留，含糊代词/复杂冲突仍需设计师核实，不宣称通用语义理解或客户批准。

客户按钮或明确“请设计师接着聊”直接进入等待，不增加资料分享同意页；请求 API 为 `POST /api/miniprogram/assistant/conversations/:id/handoff`，普通请求只需 `{action:'request'}`。等待可补充文字/图片且不创建AI任务；接管后小K暂停；取消/结束恢复AI，员工退出回等待。正式报价/具体工期共用“请设计师接着聊”建议，普通时间用消息沟通，不创建预约。电话仍须单独明确同意；不自动建档或改变分佣。

员工入口仍为 `packages/assistant/handoff/handoff?staff=1`，旧客户接续链接返回原聊天。接管前仅返回分派元数据，不开放完整聊天/摘要/图片。成功抢接后通过同会话“对话 / 需求 / 资料”回复、追溯原话、保存内部修正、图片分类/房间/授权正式户型关联，以及核对后关联已有服务档案。员工/后台 `POST .../handoffs/:id` 增加 `correct/associate/link`，带 `expectedVersion` 和幂等键；每次重验租户、当前员工、请求成员及客户/员工共同可访问的档案。修正和图片关联保存于 `entry_snapshot.handoff.packet`，附时间/操作者/原话来源；自动摘要为独立draft版本，历史confirmed不覆盖。仅写咨询关联，不改正式v4图、档案归属或佣金。后台菜单/角色权限不扩展，Web沿用Ant Design结构并随接管状态隐藏未授权资料。

图片直发复用现有私有 `media` API，JPEG/PNG≤4MiB、规范到≤2400px、每会话累计20张；点击预览、长按删除，删除/来源撤回显示不可读占位。员工图片读取必须已接管且当前请求成员有效。未知写入保留原键/请求体，设备存储允许时跨页面重建恢复；切换身份或撤权隐藏私有内容。原生相册权限失败有反馈。ASR与AI读图未配置，语音入口明确提示不可用；无在线承诺或外部推送。 AI模式成功传图会在同一事务保存system收图提示，说明暂不能识图，可补充问题或找设计师；复用C01/U01既有状态，不改布局。原请求重试不重复提示、重进可见；失败不报成功，等待/人工模式不插话，不创建模型任务。首图/并发重试/重进/接续边界的真实数据库回归通过。

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
- 源码包通过 `project.config.json` 的 `packOptions.ignore` 显式排除开发目录、临时预览脚本和本地设计 token 文件；未使用的历史切图已从源码树删除，不再留在 ignore 里占位。主包仅保留当前运行资源，并在微信 2MB 源码包上限下预留余量。墙图内核放在量房子包 `packages/surveying/utils/surveyWallGraph.js` 与 `packages/surveying/utils/survey/`，主包只保留不依赖内核的 `utils/surveyLayout.js`，供线索列表预览和业务读模型使用。Phase 2 已把 draft/session helper、vector/segment/polygon 几何、wall/opening 规格化与长度，以及结构化领域错误收口到单向依赖的基础模块；legacy 导出边界继续映射原错误消息和历史字段。Phase 1 差分 harness 与 Phase 2 基础测试共同冻结 legacy kernel 的 64 个导出、façade 的 69 个导出、graph/session/错误、`quick`/`full` 校验、重复执行、依赖方向及 35 对 Mini Program/Admin 镜像；测试源码不进入任何运行包，本次重构不改变路由、API、角色、权限、UI、吸附/闭合规则或 version-4 数据合同。量房子包内三张引导姿态 PNG（`packages/surveying/assets/surveying-guide-k-*-v3.png`）使用索引调色板透明压缩，使该分包在纳入内核后仍低于 2MB 源码上限。主包 `images/` 插画已原地调色板压缩。`packages/business` 分包单独遵守 2MB 源码上限：运行时插画使用调色板压缩 PNG，小 K 形象复用主包 `images/airy-v1`，不再在 business 分包重复打包。平台管理员审核与设备录入页放入独立普通分包 `packages/platform`（非 independent：需引用主包 `custom-tab-bar`、`utils/api.js`、`utils/bluetooth.js`），同样遵守 2MB 源码上限。角色引导页及其生成插画统一放入独立 `packages/guides` 分包，运行时插画使用调色板压缩透明 PNG，使该分包保持在独立 2MB 源码上限以内，并由聚焦体积测试约束；每张生成 PNG 不超过 300KB。
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
| 家装设计顾问抢单池 | `packages/business/lead-claim-pool/lead-claim-pool`；`pages/index/index` 的家装设计顾问工作台态 | 已批准抢单池设计在胶囊安全区内新增独立池页，并在工作台增加待抢提醒/数量入口。`GET /api/lead-claim-pool` 返回服务端时间、截止时间、可抢状态、容量状态，以及领取前仅有的脱敏身份/片区、面积、风格、来源。页面用服务端时间校准倒计时并每 3 秒刷新；加载、空态、关闭、过期、容量满、并发失败和成功状态沿用批准构图。`POST /api/leads/[id]/claim` 携带客户端幂等键，成功后才进入完整线索详情。「开启抢单提醒」是用户主动触发、仅针对可选 `lead_claim_available` 模板的 `wx.requestSubscribeMessage`。推荐人、手工录入、家装现场顾问活动码和企业负责人活动码线索在开启时进池；家装设计顾问活动码仍直接归属 | Implemented/Limited；仅当前签名企业内活动且可派的家装设计顾问可抢。即使 worker 延迟，超过服务端截止也不能领取。可选微信模板须运营配置并由用户授权，站内记录始终为准。批准设计源：`design-references/lead-claim-racing-v1/designer-lead-claim-pool-v1.jpg` 及同批状态稿；登录态 `390x844` 原生胶囊截图待补 |
| 首页与量房入口 | `pages/index/index` | 客户「服务」首屏已按批准的“三项免费权益”阶段陪伴设计还原（`docs/superpowers/specs/2026-08-25-customer-service-home-three-free-design.zh-CN.md`）：胶囊安全的单一绿色主场景优先凸显「免费效果图 / 免费家装设计顾问 / 免费家装现场顾问」，完整小 K 只出现一次并手持三张语义权益牌；三张权益卡现使用按批准设计生成并打入主包的路由专属 `effect-room.jpg`、`design-advisor-3d.png` 与 `onsite-advisor-3d.png`，不再用通用效果图/灯泡/定位线性图标冒充设计插画；无媒体状态下阶段文案与四步进度同排，再进入操作按钮行；跨层原生服务票据继续消费服务端派生 `serviceStage`/`nextActionKind`、唯一一条客户可读 `appointmentSummary`、连线式四步进度、仅真实正式户型/已发布方案缩略图，以及现有主动作（预约/改期/重约/等待/服务档案），主动作与档案动作同时存在时并排显示。客户服务票据在本路由弱化「上门」：标题为「待预约量房 / 已预约量房 / 量房进行中」，说明为「可预约量房时间」，主动作为「预约量房」；员工工作台与预约页的上门用语不变。三张原生权益卡保持既有行为：效果图进入当前线索的交付方案册 `customer-ai-schemes`（空态扫码领取，尚未发布时进入同一方案册空态），设计顾问进入共享微信联系流程，现场顾问进入预约/改期/档案路径；空态/早期态不虚构媒体。保障条把「三项服务不收费」与按真实阶段派生的状态并列。身份栏保留服务码/邀请码扫码并去掉铃铛；`GET /api/miniprogram/customer-projects` 继续供给紧急度排序与 `N = length − 1` 多项目切换，`customer-projects` 仍只做深链重定向壳。路由、API、权限、媒体和阶段派生边界均不变。 已签名家装设计顾问和家装现场顾问均进入共用角色工作台；现场顾问的蓝牙连接、`measurer-calendar` 日程和请假入口现排在共用获客中枢之后，既有 `ble-connector` 仍可用；正式量房仍只从已指派任务卡进入（立即量房 / 继续量房 / 新增量房），不从 Hero 直进编辑器。家装现场顾问工作台按客户线索聚合：同一线索重约后，新的 `confirmed` 预约会替换此前的 `expired` 预约，不会在任务卡和计数中重复；没有有效重约时只保留最新一条过期待处理预约，量房日程仍保留完整预约历史。无户型的待量房任务卡仍显示「立即量房」和「预约上门」；活动码已锁定家装现场顾问但家装设计顾问仍待派时，任务卡徽标保留「待量房」、meta 显示「未预约上门」，不再与企业侧「待派单」并排造成歧义；草稿户型同一卡片改为「继续量房」（带入 `floorPlanId`）和「新增量房」，并隐藏预约上门。正式 v4 户型提交后仍留在工作台待上门队列（徽标「待确认完成」，阶段 `survey_ready`），直到预约详情「确认完成量房」把预约打成 `completed` 才退出队列与「待量房任务」计数；已提交正式户型的过点 `confirmed` 预约不会被过期任务改成 `expired`；已签约/已关闭线索的已确认与过期预约同样退出测量工作台（`shouldIncludeMeasurerWorkbenchAppointment`），量房日程仍保留完整预约历史。已确认预约若已挂户型且阶段为 survey_ready，工作台主按钮改为「确认完成量房」（进入预约详情），「继续量房 / 新增量房」降为次要；上门完成前仍可打开已保存墙图。企业负责人「经营」现以 `design-references/enterprise-owner-activity-code-entry-v3/enterprise-owner-operations-home-v3.png` 为当前设计源（自定义周期 sheet 仍沿用 `18c-enterprise-ops-dashboard-filter-sheet.jpg`）：身份栏不再放扫码/提醒，胶囊行居左 Logo +「家客来 · 家装设计顾问端」等端名，企业名叠在「家客来」下方并控制在胶囊高度内，登录用户姓名显示在绿色 Hero 标题上方、Hero 胶囊（待派单/待量房/待交付）、快捷入口（待处理线索/人员负荷）、可筛选经营大盘（chips：本周/本月默认/本年 + 自定义 bottom-sheet；负责人把同一套五项只读 KPI 重组为规则三列「新增线索 → 已完成量房 → 已签约」经营路径；第二阶段详情使用 `schemeFacts.publishedLeadCount` 的周期统计「已发布方案 N 份」及次级「方案交付率 / 签单率」效率卡；副标「全店 · …」，负责人可展示签约金额 detail；浅薄荷异常行动托盘的文字、数据、状态和点击区域仍为原生节点；V3 业务插画仅使用映射到 `images/operations-dashboard/enterprise-guide.png`、`lead-inbox.png`、`staff-load.png` 的 ImageGen 独立透明切图）、获客优先的 Hero 双入口：白色主卡「分享活动码」并显示「发给客户 · 扫码留资」（复用 packages/business/staff-activity-code/staff-activity-code 出示页及真实分享；负责人码按门店获客进入抢单/赛马，不把负责人绑成家装设计顾问或现场顾问），白色次卡「邀请入驻」并显示「员工 · 推荐人」（进入 packages/business/enterprise-join-codes/enterprise-join-codes，可生成/换新/停用；确认弹窗 confirmText 控制在微信 4 字以内，避免生成按钮静默无响应），获客双砖下方整行「已入驻推荐人」进入 packages/business/enterprise-referrers/enterprise-referrers，与异常监控卡片（待派失败进线索详情、过期未重约进预约详情、人员缺口「查看详情」与「人员负荷」进入 `packages/business/enterprise-staff/enterprise-staff`——仅企业负责人可读家装设计顾问/家装现场顾问名册，并通过 `GET/PATCH /api/miniprogram/enterprise-staff` 暂停/恢复派单；微信号/二维码仍由本人在「我的」补齐，空态 CTA 出示入驻码），数据均来自 `GET /api/miniprogram/workbench?period=`。家装设计顾问/家装现场顾问的周期五卡大盘已从首页移入角色化原生「数据」Tab，仍只读本人五项事实且不含签约金额。隔离工作台任务卡 CTA 图片（「立即量房」及同排电话/导航等）显式为 `28rpx`，避免落到微信 `<image>` 默认 320×240。家装设计顾问工作台概览下方不再展示静态「常用配方」条；快捷入口「风格配方」仍进入设计 Tab。Hero「待交付」统计方案设计中且尚无客户可见方案的未归档线索；发布方案或标记已签约后离开该数。经营大盘「已签约」仍按周期 `convertedAt` 计数。本地 `ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG` 开关会跳过最近户型加载并直接新建量房 | Implemented/Limited；未登录访问该首页根路由时停留在批准的客户「服务」空态/早期三项免费权益陪伴页，便于先浏览再自行去「我的」登录，不再立刻 `switchTab` 到登录入口；旧营销首页壳仍不是第二套未登录页。未登录会话复用客户「服务/我的」TabBar；手机号/头像/昵称授权仍只在登录页由用户主动发起。角色工作台读取服务端派生的 `GET /api/miniprogram/workbench` 与客户列表/详情的 `serviceStage`/`nextActionKind`，禁止再各写一套阶段文案。大盘签约事实仅为只读 KPI（`status=converted`，周期用 `convertedAt`），首页仍不做签约/改状态操作。冷启动期间，自定义 TabBar 与角色页面会先从本地已签名 `mode/staffRole` 上下文推导首屏。客户 TabBar 仅保留「服务/我的」。Tab 徽标来自 bootstrap 真实待办计数（客户待预约/待改期/待重约、家装设计顾问待跟进与过期、家装现场顾问工作台今日/任务合并到工作台 Tab、家装设计顾问/家装现场顾问待支付收益、负责人异常含过期未重约）；失败显示「暂时无法读取」，禁止本地填 0。新增角色态尚待登录态 `390x844` 原生胶囊核验。旧版营销首页壳不再调用 `wx.getLocation` 或 `POST /api/location/reverse`；已签名角色直接渲染 `role-workbench`，残留城市文案仅来自资料/小区派生。|
| 线索与客户 | `pages/leads-management/leads-management`、`packages/business/lead-form/lead-form`、`packages/business/lead-detail/lead-detail`、`packages/business/customer-ai-schemes/customer-ai-schemes` | 线索列表/详情、签约状态、正式户型摘要；员工客户列表可临时按 `referrerMembershipId` 筛选（来自员工分支页「查看推广客户」，顶部可清除；离开 Tab 再回自动清除）；列表卡把小区单独放在手机号下一行（最多两行截断），不再与户型缩略图挤在同一信息行；详情 Hero 的绿色文案区向右延伸，斜切边停在小K左侧，小区在最大 360rpx 文案区内提前换行并加浅字影，长白字不再落到右侧浅色背景；列表缩略图优先经 `fetchProtectedImage` 拉取正式 `previewUrl`（`GET /api/floorplans/[id]/preview`），其次酷家乐 `externalSource.previewUrl`，最后 CSS 墙线段。未归档线索详情 Hero 将「补充资料」绝对定位于卡片右上角并配已打包编辑图标（只读状态胶囊保持纯文字）；客户手机与员工电话行使用共享 `.sfp-icon-action` + 电话 PNG 可拨打（白底已抠透明，Hero 电话行与文案区左对齐，电话图标在号码后面，并保留「手机：」+ 号码）；Hero 与阶段轨之间展示已派家装设计顾问与家装现场顾问的姓名和电话（`GET /api/leads/[id]` 的 `assignedTo`/`measurerId` 员工摘要；未派显示待分配）。每张卡右侧在 `assignmentActions.canAssignDesigner` / `canAssignMeasurer` 为真时显示「分配」或「更换」（24rpx 品牌绿，不抢电话点击）；选人走 `GET /api/leads/[id]/assignable-staff?role=` 并提交 `POST /api/leads/[id]/assign-staff`，可补齐或覆盖；家装现场顾问看不到改派操作；企业负责人、负责家装设计顾问与已派家装现场顾问进入 `lead-form?mode=edit`（微信默认导航栏、原生返回）经 `PUT /api/leads/[id]` 更新称呼、手机、小区、面积和风格；小区名称同时支持原生 `wx.chooseLocation`（写入 POI 名，截断至 160）与手输，交互对齐预约页的选点+输入，坐标不写入线索；企业负责人仍从客户列表新增客户（`source=manual_entry`）；新建线索走与推荐网络相同的家装设计顾问/家装现场顾问池子自动派单；同一企业未关闭线索若手机号相同（含微信 `86` 区号写法）则复用并绑定该微信客户，扫码领取也会挂到已有手工线索而不是再生成一条「微信客户」。签约快照家装设计顾问和家装现场顾问两条提成。负责家装设计顾问在尚无有效预约时可进入首次预约，活动线索的已派家装现场顾问也可当场预约；客户本人也可从「服务」首屏和项目册进入同一服务端预约流程。自动派发的家装现场顾问与待确认的上门时间分开显示。家装设计顾问、家装现场顾问与企业负责人的「客户」Tab 共用同一 `leads-management` + `lead-list` 壳；列表范围仍按角色收窄（家装设计顾问 `promoted-or-assigned`、家装现场顾问 `measurer`/`measurerId` 与工作台待量房队列一致、企业负责人看租户内客户），仅企业负责人可新增客户；负责家装设计顾问可在本人客户线索详情开始、继续、新增或删除正式量房；已派家装现场顾问仍从本人工作台任务进入正式量房，企业负责人则可在本企业任一客户线索详情开始、继续、新增或删除正式量房。家装现场顾问今日待上门/待量房队列留在工作台概览，不再复用客户 Tab。`GET /api/leads/[id]` 现已统计有效 AI 发布记录并据此派生 `serviceStage`/`nextAction`，且 `publishedSchemes` 按 `firstPublishedAt` 排序、图片含 `stageKey`/`publishedAt`；线索详情将预约 CTA 并入「正式量房」卡（不再单独上门量房容器），预约钮与「开始量房」/「继续量房」同时出现时同一排等宽 84rpx 胶囊（间距 16rpx），仅一个按钮时仍满宽；已有量房同时显示「新增量房」与删除时，第二排也使用相同的等宽双列、84rpx 高度、16rpx 间距和胶囊圆角；`survey_ready` 时该预约按钮文案改为「确认完成量房」；`survey_completed` / `converted` / `closed` 后隐藏该预约按钮（仅发布方案不结束补测预约），但正式量房卡仍展示房源事实（小区、面积、已存预约地址、闭合房间名）以及企业负责人/已派家装设计顾问/已派家装现场顾问可看的鉴权测绘 PNG 预览（`wx.previewImage`；负责家装设计顾问、企业负责人和已派家装现场顾问另可使用其已授权编辑操作），下方嵌入「房屋现场图」（`GET/POST /api/miniprogram/leads/[id]/site-photos`，先选客厅/主卧/次卧/主卫/次卫再拍照或相册，每户 30 张），已发布方案摘要进入只读 `customer-ai-schemes`（`mode=staff`）；家装设计顾问与企业负责人在未归档、未签约/未关闭的线索详情即可看到「进入 AI 设计」（量房完成前空态说明「可用现场图开始出图」，`survey_completed` 或已有完成正式户型时为「量房完成，可开始出图」）；已完成正式户型仍绑定 `floorPlanId`，否则 `openAIDesignEntry` 仅带 `leadId` 进入无户型 `rough_sketch` 方案台；已发布方案与 AI 入口同时出现时「查看全部方案」与「进入 AI 设计」同一排等宽胶囊（间距 16rpx），仅一个按钮时仍满宽；`survey_ready` 仍保留户型预览；负责家装设计顾问、企业负责人和已派家装现场顾问可继续已保存量房；设计 Tab 仍是通用创作入口。家装设计顾问工作台使用同一发布计数显示「方案已发布」徽标，优先展示尚未交付的待量房客户，并排除已签约/已关闭线索跟进卡片（平台以已签约结束推进）。带 JWT 的员工会话无需 legacy OpenID 也可加载线索列表。家装设计顾问/家装现场顾问/企业负责人「客户」Tab 只在首次进入、返回 Tab、筛选和手动下拉时请求列表，不后台轮询。推荐网络线索经现有签约接口进入 `converted` 时，服务端按来源快照三条或两条提成；活动线索不生成推荐人行 | Implemented/Limited；签约、客户所有权、预约入口、手动派单与预览权限由服务端执行，角色 Tab 条目按能力白名单生成；比例规则要求合同金额，已支付三方提成会阻止企业负责人撤销签约 |
| 报备与员工任务 | `packages/business/promotion-records/promotion-records`、`packages/business/promotion-record-detail/promotion-record-detail` | 企业报备和员工通知；渠道地推 bootstrap 落点于此（我的报备/公海/新建），TabBar 为「报备/我的」（页面内嵌 custom-tab-bar，图标复用 tab-home/tab-mine）；员工侧线索类订阅点击进 `lead-detail`，客户预约/方案发布点击进 `customer-project` | Implemented/Limited；微信投递可能被外部拒绝 |
| 推荐人网络、预约与匿名领取 | `packages/business/onboarding/onboarding`、`packages/business/enterprise-register/enterprise-register`、`packages/business/onboarding-debug/onboarding-debug`、`packages/business/referrer-workbench/referrer-workbench`、`packages/guides/referrer-guide/referrer-guide`、`packages/business/referrer-progress/referrer-progress`、`packages/business/referrer-earnings/referrer-earnings`、`packages/business/staff-earnings/staff-earnings`、`packages/business/enterprise-commissions/enterprise-commissions`、`packages/business/promotion-service-code/promotion-service-code`、`packages/business/staff-activity-code/staff-activity-code`、`packages/business/enterprise-join-codes/enterprise-join-codes`、`packages/business/enterprise-staff/enterprise-staff`、`packages/business/enterprise-referrers/enterprise-referrers`、`packages/business/free-design-service/free-design-service`、`packages/business/customer-projects/customer-projects`、`packages/business/customer-project/customer-project`、`packages/business/customer-ai-schemes/customer-ai-schemes`、`packages/business/appointment-detail/appointment-detail`、`packages/business/appointment-reschedule/appointment-reschedule`、`packages/business/appointment-booking/appointment-booking`、`packages/business/measurer-calendar/measurer-calendar`、`packages/business/enterprise-appointments/enterprise-appointments`、`packages/business/measurer-unavailability/measurer-unavailability`、`packages/business/identity-recovery/identity-recovery` | 按类型隔离的入驻、推广码、客户领取、项目和预约深层路由保持既有合同。平台开户扫码落地 `enterprise-register`：`POST /api/miniprogram/codes/resolve` 识别 `er_` / 裸 32 位 scene 为 `kind: enterprise_registration`（仅平台展示名，不伪造企业名）；`getPhoneNumber` 后 `POST /api/miniprogram/enterprise-registration`（Bearer JWT）要求授权手机号与 `contactPerson.phone` 一致，并与 Web `POST /api/auth/register-enterprise` 共用 `createSelfServiceEnterpriseApplication`（`pending_approval` / `self_service`）。UI 复用入驻页品牌锁/极简透气体，无独立设计稿、无新 IP 插画，并补领取页返回箭头以免开户码栈根无法离开；已签名身份从最近使用再次进入时不再粘在开户页，会话分享仍可打开表单。员工/推荐人 `ej_` 入驻仍独立。`referrer.network` 能力在不新增视觉体系的前提下扩展既有入驻码和名册：负责人得到企业员工码及本人推荐人码两个 Tab，家装设计顾问、家装现场顾问和渠道地推只得到本人推荐人码；入驻成员仍统一归企业，同时保留首个邀请员工。普通员工只读本人邀请的推广人，负责人可在包含 0 人与「历史未归属」分支的员工网络和扁平全企业名册间切换；停用仍仅限负责人，且不提供改归属动作。企业负责人预约调度页（`enterprise-appointments`）是从工作台「查看预约安排」`navigateTo` 进入的无 TabBar 二级页，已按 R03 `20-enterprise-appointments.jpg` 还原为独立调度列表：胶囊安全返回与标题「预约调度中心」、所选周期真实预约计数、本周/本月/本年芯片加自定义周期（选中区间显示在「自定义」芯片后，不进顶栏副标题）、所选窗横滑日期条与 `confirmed`/`expired` 卡片；仅当关联线索仍可推进时，过期卡才显示「需协调改期」与「查看预约」；早于今日、仍需协调的过期或已过结束时间的开放线索预约仍会出现在今日列表；归档或找不到关联线索时按 `closed` 水合，避免假「客户量房」卡片点进可用时段后报「线索不存在或已关闭」；`serviceStage` 为 `converted`/`closed` 时改为只读「已签约」/「已关闭」角标，隐藏 CTA 且不可进入预约详情（平台以已签约作为线索结束）；不新增调度 API、不展示面积/户型/家装现场顾问手机等接口未返回字段。`GET /api/miniprogram/customer-projects` 仅返回当前 JWT 客户本人未归档项目（中立免费设计服务名称），并供给「服务」首屏排序与切换；客户服务档案同样不展示企业品牌，但保留本人可读的真实服务事实。已退役的 `customer-projects` 路由仅为深链重定向壳（排序后进档案或回落「服务」Tab），不再作为产品列表；真实深层页仍是无 TabBar 的服务档案。服务档案的首屏交付方案标题使用接口返回的方案名渲染为“已发布{方案名}方案”，图片「详情」与「查看全部方案」进入只读 `customer-ai-schemes`（`mode=customer`，零生成零编辑；按轮次 chips + 交付时间轴浏览 `publishedSchemes`，预览走 `wx.previewImage`），底部联系家装设计顾问按钮保持水平垂直居中。推荐人进度页现为「客户」Tab：胶囊安全「我的推荐客户」Hero、记录编号卡片、实底「撤回」与 10 分钟内「恢复」。推荐人进度/收益以当前签名成员关系做授权边界；收益台账跟随当前提成行的 `beneficiaryUserId` 与 `payableAmount`（待支付更换受益人后旧人不可见、新人可见），仅返回脱敏客户标识、服务事实和本人提成状态，绝不返回手机号、精确地址、户型 graph、内部预约原因或设计文件。推荐人工作台顶栏品牌锁使用生产 `/images/home-ip-v1/brand-logo.png`（房屋轮廓 + JK），不再用绿色 `JK` 文字方块。身份栏与员工/经营端对齐：胶囊行居左 Logo +「家客来 · 推广端」，登录用户名叠在「家客来」下方并收进同一胶囊高度（无姓名时隐藏，长名单行省略）。推荐人工作台选择企业会先交换签名成员关系上下文并刷新会话，因此服务码、进度和收益始终使用同一边界。手机号授权前，有效入驻码会解析码类型和企业展示名称；推荐人授权手机号后必须填写真实姓名，才会调用 `POST /api/miniprogram/onboarding/referrer`；已签名客户若已有未关闭归属，领取页返回已有服务档案而不是新领取成功。领取/登录对 `staff_phone_linked_to_other_user` 提示“该手机号已绑定其他微信账号…”，引导换本人手机号或联系管理员。推广服务码、员工活动码与客户领取页已按极简透气版 09–13 还原出示、确认、手机号授权、已分配家装设计顾问和待匹配态。设计 09「请扫码」牌、出示 CTA 与企业双码出示牌复用已打包的 `images/mine-icons/scan.png`（牌面家客绿、绿色主钮白色）。开发版 `onboarding-debug` 可选择本地小程序码进入同一真实流程。预约动作继续按家装设计顾问、家装现场顾问、企业负责人和客户边界执行；关联线索已签约、已关闭或已归档时，预约详情隐藏改期/取消/重约/量房等变更操作；内部改期原因改为选填，填写时保留在预约事件审计中；推荐人工作台保留「退出该企业」，不再放置切换身份或退出当前账号（改由「我的」承担）；身份失效会进入独立恢复页后重新登录 已批准的推广人三步引导以原生 WXML/Less 落在独立 `packages/guides` 分包，三张生成式透明 PNG 不进入主包；推荐人工作台加载后按本地已签名账号/角色/v1 仅自动打开一次，「我的」可重复查看，深链要求 `referrer.promotion`，跳过返回来源页，末页进入当前成员关系的服务码。个人用户不强制出现，在其独立设计批准前不发布客户占位引导。 | Implemented/Limited；平台企业开户页已 Implemented 并有聚焦合同测试。推荐人首次入驻、登录和带 JWT 的冷启动会进入推广工作台；已用真实登录态推荐人在 `390x844` 核验登录完成与冷启动，并保存包含原生胶囊的宿主截图。工作台现可进入当前企业的服务进度和本人收益，客户项目与预约 API 继续执行所有权、岗位权限和乐观锁；身份列表暂时不可用时不阻断推广工作台；切换身份入口仅在「我的」。客户可见项目页面统一采用“免费设计服务/免费设计与量房服务”中立文案，企业名称仅保留给内部/推荐人页面。客户扫码后的手机号授权页不展示装修公司名称（含员工活动码落地）；员工活动码出示页仍可显示企业名称。第 12 阶段已按 bootstrap 显示当前可执行的推荐人/家装现场顾问入口，并在失效时清除会话且不展示失效企业；企业预约调度页、开户页，以及变更后的个人入驻码/负责人推广网络/员工本人名册状态，其登录态 `390x844` 原生胶囊截图待用户手工提供；新增客户项目、推荐进度、收益页与客户 AI 方案册待真实登录态 `390x844` 核验，测量任务聚合、预约/方案发布登录态动作与完整角色生产 UI 仍待补，微信投递依赖外部配置 |
| 平台管理员审核与设备 | `packages/platform/enterprise-review/enterprise-review`、`packages/platform/enterprise-review-detail/enterprise-review-detail`、`packages/platform/devices/devices`、`packages/platform/registration-code/registration-code` | 自定义 Tab「设备 / 审核 / 我的」（分包页 `reLaunch`；审核与开户码出示不得写入原生 `tabBar.list`）。设备页沿用原 BLE 录入/列表合同（`GET/POST /api/miniprogram/devices`）。审核默认 `GET /api/miniprogram/platform/enterprises?status=pending_approval`；`q=` 在当前 chip 内按名称、信用代码、联系人电话搜索。详情含状态事件；`POST .../enterprises/[id]/status` 与 Web 共用 FSM、开通负责人和 `enterprise_join_result`。状态 chips：待审核 / 全部 / 已拒绝 / 已停用。通过走 `wx.showModal`；拒绝/停用半屏填 4–200 字原因；电话行 `wx.makePhoneCall`。审核顶栏「开户码」与「我的」「出示开户码」进入只读 `er_` 出示页（`GET /api/miniprogram/platform/enterprise-registration-code` 与 `/image?variant=poster`，与后台「查看不换新」共用 `revealActive` + 服务端海报合成；不换新/不停用）。全幅展示合成开户海报并支持长按保存；视觉沿用设备工作台胶囊顶栏，不新画小 K、不展示 AI/自动化密钥。`counts.review` 为待审核徽标。误入 `pages/index` 会 `reLaunch` 到设备落点 | Implemented/Limited；仅 Mini JWT `admin`/`super_admin`。换新、停用与码环境仍留 Web。登录态 `390x844` 原生胶囊截图待你提供 |
| 提成记录 | `packages/business/commission-records/commission-records` | 适用商业角色的订单提成；签单成功后的员工提成微信订阅复用 `workflow_todo`，点击进入本页 | Implemented；结算仍由后台业务控制 |
| 签约提成生命周期 | 共用 `POST /api/leads/[id]/convert` 与 `POST /api/leads/[id]/revert-conversion`；企业负责人提成台账 | 签约在租户事务内快照岗位提成。撤销签约把完整作废行快照保存在 `conversion_reverted` 生命周期事件元数据中；同一线索重新签约时按新合同金额、当前规则和当前受益人刷新原行，清除上一轮作废/调整运行态并恢复为 `payable`，不会继续停留在 `voided` | Implemented/Limited；仅企业负责人可撤销签约，任一提成已支付都会阻止撤销 |
| 灵感库 | `packages/business/inspiration/inspiration` | 租户范围内灵感浏览和详情 | Implemented/Limited；媒体供应商为外部服务 |
| AI 设计工作流 | `pages/ai-design/ai-design`、`packages/ai-workflow/*` | 设计 Tab 与 recipe-project 继续作为创作入口。`scheme-studio` 现按批准的三态 Composer 稿 `design-references/ai-design/unified-entry-v2/21-studio-composer-v4-three-states.png` 还原：折叠态左侧整块为**本轮配置入口**（模板封面、**选择模板**、**设计整屋 · 参考图 1 张**、**调整**右箭头），右侧为独立**生成**按钮；折叠态输入框、费用条和展开编辑行已移除，点击配置块进入本轮配置；展开态在提示词上方保留这三个快捷入口，已配置项以绿色背景呈现且切图、文字反白为白色。**模型**、比例、分辨率、张数、软装子类型和其他技术项统一收进「更多设置」。配置弹窗允许随时修改设计目标、模板和参考图；其中**提示词模板**整行可点击，模板卡片的名称或操作区均可选择，封面仍用于预览；选择设计整屋时，将绑定的正式户型图显示为锁定的**参考图1**，其后展示图库/用户上传参考图。配置内容在矮屏溢出时仍可滚动，但固定内容态不再显示右侧原生滚动条。移除原**输入依据**文案和首页独立的户型/模型/模板/设置控件。设计单间缺少现场图点击生成时直接打开该配置弹窗，用户可在其中补充现场图，不再停在无效提示。展开态字数计数器现在占用原生文本域下方的独立底栏，长提示词只在自身区域滚动，不会再覆盖 `当前字数/2000`。发送/重命名确认动作使用显式受约束的等宽原生按钮，避免 Android/微信 WebView 把主按钮绘制到面板外。模板提示词、`renderMode`、批次/API、租户/权限、配方、发布、重试和弹窗合同不变。运行态证据已登记到还原台账。 | Implemented/Limited；供应商、点数、资格、发布可见性和范围仍由服务端控制；无后台画布标注精修、无深色主题；三个批准 Composer 状态此前已在真实 `390×844` DevTools 运行态完成核验，本次交互、已配置状态与整卡点击修复后的运行态 QA 待用户手动截图确认。 |
| 我的与账号 | `pages/mine/mine`、`packages/business/login/login`、`packages/business/legal-webview/legal-webview`、`packages/business/profile-edit/profile-edit`、`packages/business/settings/settings`（兼容深链，内容已并入 Mine Tab）、`packages/business/identity-switch/identity-switch`、`packages/business/identity-recovery/identity-recovery`、`packages/business/account-security/account-security` | 账号安全、微信系统权限设置和当前版本检查（使用重新导出的绿色圆角线性 `images/mine-icons/{permission-management-v2,version-check-v2}.png`）及服务端身份上下文选择；登录页保留已批准的协议行并加大整行点击范围，勾选后才挂载微信 `getPhoneNumber`，避免原生按钮抢走勾选点击或未同意即授权。手机号授权优先使用微信动态 `code`；旧客户端只返回 `encryptedData`/`iv` 时，登录、入驻、开户和匿名领取仍可提交，这些页面会在点按钮前预取 `wx.login`，把该缓存 login code 与密文一并交给服务端用对应 `session_key` 解密，且不得在 `getPhoneNumber` 回调里再次 `wx.login`。《用户协议》《隐私政策》用 `catchtap` 打开 `legal-webview`，加载 `https://smartfloor.zlyun168.com/user-agreement.html` 与 `https://smartfloor.zlyun168.com/privacy-policy.html`（地址写在 `utils/legal-docs.js`）。《免责协议》仍保留在 `legal-docs.js` 与托管页，登录协议行暂不展示。`listContexts` 返回该微信用户全部 `status=active` 员工上下文（按 `staffId` 升序），不再只取第一行；`GET /api/miniprogram/bootstrap` 返回当前角色、有效角色组、企业/成员关系、落点、能力白名单和按角色范围统计的服务端徽标摘要；切换会交换签名 token，登录、入驻、领取、切换和冷启动均先刷新并校验 bootstrap，再通过统一身份导航进入已签发落点；`identity-navigation` 对未知身份和越权深链返回明确拒绝；失效的签名上下文跳转至恢复页，清除旧会话并要求重新登录 「我的」在账号任一有效身份（bootstrap.roles / identity-contexts）已登记已批准引导时显示原生「角色使用引导」账号行，不因当前切到个人用户而隐藏；现阶段覆盖推荐人、企业负责人、家装设计顾问和家装现场顾问。当前身份有引导则直接打开，否则回看已有身份的引导（多个时用原生 ActionSheet 选择）。仅有个人用户、且没有上述工作身份时仍不显示，也不放置未批准占位引导。 | Implemented/Limited；访客已使用批准的满屏版胶囊安全 JoveKore｜家客来入口：独立打包的绿色门厅场景、原生「个人用户 / 员工 / 推荐人」身份轨道与唯一可执行「立即登录」动作共同填满未登录「我的」；更高密度的构图不改变路由、API 或权限边界。未登录访客复用客户「服务/我的」TabBar，以便先浏览服务首页，登录仍由「我的」发起。只有 bootstrap 或本地已签名身份才按能力白名单生成导航：客户“服务/我的”，推荐人“推广/客户/收益/我的”，家装设计顾问“工作台/数据/客户/设计/收益/我的”，家装现场顾问“工作台/数据/客户/收益/我的”，渠道地推“报备/我的”（promotion-records + mine；不进家装设计顾问/家装现场顾问 role-workbench 壳），企业负责人“工作台/经营/客户/提成/我的”，平台管理员“设备/审核/我的”。平台管理员「我的」走角色壳员工资料卡加权限/账号行（含出示开户码），不再渲染旧版「我的空间档案」「我的户型」「开始量房」。渠道地推「我的」走 `GET /api/miniprogram/mine` 员工看板（新建报备/公海/我的提成），不按客户/推荐人受限壳处理；若落到 `pages/index` 则 `reLaunch` 到报备页。服务端下发的「我的」动作现按 `referrer.network` 生效：家装设计顾问、家装现场顾问和渠道地推显示「我的推广人 / 邀请并查看我的推广人」，企业负责人显示「推广网络 / 查看员工分支与全部推广人」，均进入既有 `enterprise-referrers` 深层路由。 重新导出的绿色圆角线性 `images/mine-icons/referrer-network-v2.png` 由所有获准范围的该「我的」入口共用。共享自定义 TabBar 为收益/提成使用成对的中性灰/品牌绿 `tab-earnings` 图标，为企业负责人「经营」使用已打包 `operations-dashboard/chart.png`；该经营页已写入原生 `tabBar.list`，点击走 `switchTab` 而不是静默失败；其余行为仍绘制服务端徽标计数，摘要不可用时显示「暂时无法读取」。“我的”Tab 已去掉「订阅任务通知」与登录/入驻/领取订阅弹窗；资料卡下方「权限」区仅保留微信权限管理（`wx.openSetting`），「账号」卡内为「编辑资料」（进入 `profile-edit`）、当前身份（复用推广工作台「切换身份」两行说明「在个人用户、员工和推荐人身份之间切换」）、账号与安全和退出当前账号；顶栏不再放置「编辑资料」芯片；推广工作台不再重复放置切换身份或退出当前账号；右上角齿轮入口已移除，`settings` 路由仅作深链兼容并 `switchTab` 回“我的”。推荐人/客户 JWT 状态会按签名上下文刷新 `/api/miniprogram/profile`，资料卡显示最新自设姓名及动态角色徽标；`profile-edit` 通过 `POST /api/miniprogram/profile/avatar` 保存昵称与可选头像（统一为 JPEG，签名投递 URL；`MINIPROGRAM_API_PUBLIC_ORIGIN` 的 `.example.com` 占位会回退到真实请求主机）。家装设计顾问还可在 `profile-edit` 自助补全微信号和个人二维码（家装现场顾问不强制二维码）：上传接受 PNG/JPEG（含空 MIME），不再解码或白名单校验，落库 PNG；上传控件为 `view`，选图前先 `hideKeyboard`，避免先填微信号再上传失败。资料页展示交齐/待补状态；家装设计顾问工作台在资料不齐时于 `primaryItems` 置顶 `action: profile` 待办并进入 `profile-edit`；每次进入工作台另查 `GET /miniprogram/staff/wechat-profile`，`assignmentEligible` 为 false（含只缺微信号或只缺二维码）即弹 `wx.showModal`「请先完善微信资料」引导「去完善」；切换统计周期刷新不会重复弹窗。聚焦布局与账号菜单回归测试已覆盖。撤权、停用或版本变化不展示失效企业数据，也不静默回落客户 |
| 推荐分享 | `packages/business/recommendation-share/*` | 只读推荐方案和项目摘要 | 受分享授权及可用资源限制 |

身份切换视觉说明：`packages/business/identity-switch/identity-switch` 现按已批准的双列卡片参考 `design-references/identity-switch-card-grid-v2/identity-switch-card-grid-v2.png` 落地，只使用原生布局：顶部为随本地选择身份更新的紧凑单个小 K 档案管理员预览，下方为双列身份卡与既有确认按钮。包括「家装设计顾问」「家装现场顾问」在内的所有岗位名均为原生文字完整呈现，不再使用横滑轨道或省略号。选中卡使用绿色描边与「当前使用」状态；`packages/business/assets/identity-switch/role-cards/` 内独立透明的岗位工具 PNG 分别识别 `customer`、`referrer`、`enterprise_admin`、`designer`、`measurer`、`salesperson`、`platform_admin`，不切片复用已批准的复合设计稿，也不在每张卡片重复小 K。当前身份的禁用 CTA 使用不透明薄荷绿底、绿色描边和深绿文字，避免与页面背景融合。点卡只在本地预览；仅在选中非当前身份后才露出既有原生确认与签名 token 切换。仅有一个有效身份时保留预览，但不制造无意义的切换动作。既有 `GET /api/miniprogram/identity-contexts` / `POST /api/miniprogram/identity-contexts/switch`、路由与权限边界均未改变。不支持的历史角色仍回退到客户向导图标，不会因此获得新能力。

### 线索详情推荐人标记

`packages/business/lead-detail/lead-detail` 直接消费已按权限下发的
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
  活动码按钮仍为「分享给客户」，生效入驻码仍以「一键分享」进入带当前 `ej_` 令牌的入驻页。`referrer.network` 能力下，企业负责人继续看到「员工入驻码 / 我的推广人入驻码」两个 Tab，家装设计顾问、家装现场顾问和渠道地推只看到「我的推广人入驻码」；个人码的生成、换新、停用、图片和分享均由服务端限定当前员工范围，员工码仍只允许负责人管理。页内文字链按范围显示「查看推广网络」或「查看我的推广人」，进入同一 `packages/business/enterprise-referrers/enterprise-referrers`。`GET /api/miniprogram/enterprise-referrers` 强制普通员工为 `scope=own` 并分页返回本人邀请的成员；负责人为 `scope=enterprise`，可用 `view=network` 查看企业汇总、全部员工分支（含 0 名推广人的员工）与可选「历史未归属」，或在「全部推广人」按 `query`、`status`、`page`/`limit` 分页。具备 `referrer.network` 的员工可调用 `POST /api/miniprogram/enterprise-referrers/[id]/disable` 停用自己邀请的成员；负责人可管理全店。停用幂等、无重新启用、不改历史线索和提成。  已停用/已退出卡把电话图标贴在号码同一行；员工分支页每张卡均提供「查看推广客户」，负责人活动卡另保留「电话联系 / 停用后续扫码」。「查看推广客户」写入 `app.globalData.pendingLeadReferrerFilter` 后 `switchTab` 到 `pages/leads-management/leads-management`；小程序 `GET /api/leads` 接受 `referrerMembershipId`（校验当前企业 membership，并与员工可见范围 AND）。客户 Tab 顶部展示可清除筛选条；离开该 Tab 再回来且无新的 pending 时自动清除。
  推广网络现仅返回员工缩略汇总，不在一级页内展开员工推广人；点击真实员工分支进入 `packages/business/enterprise-referrer-branch/enterprise-referrer-branch`，以负责人专属 `view=staff&staffId=…` 查询该员工的独立分页名册。服务端会校验该员工仍属于当前企业且角色可纳入推广网络，再应用 `query`、`status`、`page`/`limit`；「历史未归属」仅展示为不可进入的汇总项。全部推广人与本人名册的既有范围、筛选、停用与只读边界不变。
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
预约、地址、家装设计顾问匹配引导，以 **装修问题找微信家装顾问，免费问清楚** 承接且只展示
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
分包为 1,276,739 字节，低于其 2MB 源码上限。家装设计顾问首次引导完成后才继续检查微信资料补全提示。登录态 `390x844`
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
