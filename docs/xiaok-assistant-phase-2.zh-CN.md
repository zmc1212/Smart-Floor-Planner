# 小K第二期：需求整理与人工交接

**PPT23获权资料与同事项回传：限定闭环Implemented，P5整体Limited。** 客户在原C01咨询明确共享指定房间的需求节选，或紧接上传后明确共享点位图原件；S01接待同意不扩大为项目共享权。S04按项目/房间读取精确资料ID、原话hash与图纸原件，设计师/管理者在同一事项核对关联、回复，管理者明确编写的回传节选只投递原授权咨询。真人接待期间延后；资料替换/撤回、成员或客户撤权、记录/事项/资料版本变化约束读取、写入、回执和投递。沿用事务/outbox/Worker/原键幂等，无新表、迁移或供应商变更；团队回传接入原Agent施工来源链（prompt v18）；新增现有聊天API下的获权原件GET。既有C01/S04文字、原件网格和输入组件仅切换数据/资料标签，无样式、插画或导航更换。客户提供原件及员工关联核对不是正式出图、方案差异、已解决、批准或验收；显式命令及当前范围仍Limited。最终验收与命令见[二期合同](./xiaok-assistant-phase-2.zh-CN.md)，证据`tmp/xiaok-ppt23-batch/`；未生产发布。

本次聚焦复用Postgres事务、原键幂等及现有outbox/消息协议，不增编排器或框架checkpointer。已复核维护中的[LangGraph工作流](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭ToolMessage问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)，不以工具status代替业务回执。查询走确定性服务、不调用模型，原报告整理模型/提示版本不变。

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
