# 小K第二期：需求整理与人工交接

**当前P5正式版本、差异与客户决定：限定闭环Implemented，P5整体Limited。** 原S04有权人员明确发布图纸原件、精确版本、前版、差异及费用/工期影响；原授权咨询C05完整查看后作本版本决定。原键恢复、真人延后、换版/撤回、权限及v19来源化追问已接通；没有新表/迁移/页面/Less/插画/导航或生产变更。客户同意仍不等于现场落实、解决、关闭或验收。当前合同和最终验证见下文P5节；此前PPT23客户资料及同事项回传合同继续约束其各自范围。

本次聚焦复用Postgres事务、原键幂等及现有outbox/消息协议，不增编排器或框架checkpointer。已复核维护中的[LangGraph工作流](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭ToolMessage问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)，不以工具status代替业务回执。查询走确定性服务、不调用模型，原报告整理模型/提示版本不变。

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
| 管理者说“回传事项456：给业主看的明确回复” | 持久保存待回传事件；原授权咨询收到一次团队节选和非批准说明 | 必须有当前客户需求授权及处理回复；存在图纸时须已核对关联；不自动搬运内部回复/照片/私聊 |
| 真人接待/等待、来源或权限改变、版本冲突 | 真人期间同一事件延后；失效事件终止投递，已投递派生文案重新检查；冲突保留输入，刷新后须再次发送 | 只回原咨询，不选“最新”咨询；记录/事项/资料hash均校验，移除的负责人和发布者不能继续投递 |

GET聊天的 `versions` 新增按roomId的 `materials` hash。POST原body/键一起保存记录版本、事项修订和资料hash；客户端重进清掉受保护图片/写权限。回复、图纸核对、重新核对和回传均检查资料快照，源撤回到空集合也不能绕过版本检查。来源变更后“重新核对事项456：原因”保留同一ID、重新绑定当前原记录/资料，清掉旧图纸关联及处理结果，再显式核对/回复。

### 回传、生命周期与限制

`query_followups`同时读取本咨询已实际投递的获准团队回传，返回最小的事项ID/修订、等待核对状态、明确节选、原回执messageId和资料hash；不读取未发布内部事项、原共享聊天或其他咨询。即使原回执已超过模型30条历史窗口，工具路径仍把它加入既有construction source_refs，按同一来源继承/内存/提交守卫撤销派生回答。节点补充事项与团队回传用kind区分，不把回复变成批准。

`construction.site.issue.result.v1`保存同一issueId/revision、精确共享来源/资料hash、原咨询/客户及管理者明确节选。既有Worker轮询和原咨询重进共用消费者；事件/原咨询consumer键与消息eventId去重，同事务写入delivery和消息。human/handoff_requested时不消耗事件；恢复AI后只投递仍有效的版本。来源撤回/替换、事项修订、记录失效、参与者/客户访问撤销、负责人或发布管理者失效会阻止投递；失效事件记dead而不反复占据候选队列。原始审计材料保留；受控历史、S01投影及Agent读取沿现有来源可用性守卫停用旧派生结果。用户自行保存的字节不能承诺收回。

**PPT范围**：23覆盖有效需求节选+客户图纸原件+现场记录的同项目/房间关联、同事项设计师核对与回复、原咨询限定回传；22覆盖原报告到草稿，33覆盖同项目负责人接续，38覆盖来源失效/非批准边界。没有把本轮写成PPT23整页完成。企业正式出图/当前批准图纸域、方案具体版本差异、费用工期影响、正式解决/关闭/批准、完整S05资料卡、ASR、外部微信通知及通用自由语义仍未交付。查询原记录最多10条、事项投影最多50条；需求/图纸每房间各保留一个当前共享来源，独立选择器/完整列表尚未补足。

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
