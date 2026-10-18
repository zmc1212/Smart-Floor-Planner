# 小K第二期：需求整理与人工交接

**P4A共享查询与事项接续：限定闭环Implemented，整体Limited。** `packages/construction/chat/chat`及现有Mini/Admin工地聊天API在建进度记录/任务前区分查询、处理请求、普通确认和上报。同项目/房间查询保留原话/照片、精确来源ID/版本，并明确缺少点位图及获准共享需求；不开放私人咨询。显式编号聊天命令对原记录建立唯一稳定事项，支持接手、转交有效成员、回复、带原因取消及来源变化后重新核对；回复回到原记录，仍待人工核对。沿用outbox保存修订/来源指纹，无新增表/迁移/供应商。记录/事项版本、原键回执、实时租户/成员/管理权限及来源撤销约束所有动作和重进；负责人/admin/super_admin均可无项目成员身份管理。复用原PPT22/38文字回复/记录辅助组件，不改样式/素材/导航。本轮服务10/10、Mini53/53、既有现场16通过/1配置跳过、原生13/13，含2次真实DeepSeek整理及多角色真实HTTP写入；已检查逻辑390×844文字状态截图，完整光学/高屏/键盘QA仍未验证。查询最多10条记录，当前事项投影最多50条；这是显式命令限定支持，不宣称通用语义分流或完整任务列表。正式图纸/获准共享需求、主动事项结果投递、正式解决/批准、ASR和外部消息不在本次交付。证据及重复命令见[二期](./xiaok-assistant-phase-2.zh-CN.md)、`tmp/xiaok-followup-batch/`；未生产发布。

本次聚焦复用Postgres事务、原键幂等及现有outbox/消息协议，不增编排器或框架checkpointer。已复核维护中的[LangGraph工作流](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭ToolMessage问题1440](https://github.com/langchain-ai/langgraphjs/issues/1440)，不以工具status代替业务回执。查询走确定性服务、不调用模型，原报告整理模型/提示版本不变。

## 当前P4A共享事项来源与接续合同

来源必须为本项目有效draft/published记录及唯一明确的当前房间，并含待做/协调内容；每次读取重验原话、记录、房间、媒体hash及版本。`construction.site.issue.opened.v1`事件ID即稳定issueId，`construction.site.issue.progress.v1`追加修订；`construction.chat.response.v1`关联持久回复、原消息及原始照片。沿用事务/outbox/幂等协议，模型不能执行这些动作。换施工节点不复制事项；原记录更正、房间/媒体撤销及负责人移除改变当前投影。底层历史原话留审计，过期派生处理结果不继续当当前事实。

现有GET聊天返回`versions: {records:{id:version},issues:{id:revision}}`；POST消息将该快照和原操作键一起保存。开启/重新核对须携带所见原记录版本，其余写动作须携带所见事项修订。冲突保留输入并读取当前版本，不自动重发；丢回执沿原键/原body核对。没有新增路由/菜单；cookie/所选企业Admin适配器共用服务，不新增后台界面。

| 既有输入框命令/触发 | 可见反馈与恢复 | 权限/边界 |
| --- | --- | --- |
| 查明确项目房间资料；普通确认或含糊表达 | 原话+有来源回复/澄清持久保存，不建进度草稿或模型任务 | 当前项目有效读者；不推断/共享私人需求 |
| `跟进记录123：底盒待核对` | 每原记录一个事项，重复沿同一ID；待负责人 | 有效写成员+当前待处理来源版本；取消后不重复开启 |
| `接手事项456` / `转交事项456给姓名` | 当前有效负责人重进保留；重复指派同一人不增加修订 | 未分配可本人接手；当前负责人/经理可转给同项目唯一精确姓名的有效非observer成员；管理者可接管 |
| `回复事项456：处理原话` | 回复同时回到原记录旁，翻旧消息页也显示当前事项；仍待核对 | 当前负责人/经理；不等于正式解决/批准或向业主发布 |
| `取消事项456：原因` | 重进仍取消；原记录/关注/发布保留各自状态 | 发起人/经理；必须明确原因及当前修订 |
| 来源改变后`重新核对事项456：原因` | 同一事项更新来源指纹，再待处理/核对 | 当前负责人/经理+当前记录/事项版本；无效来源停止动作 |
| 成员/身份撤权、observer写入、错租户/项目 | 拒绝历史/媒体/写入/回执；原生重进清除受保护本地状态 | 每次重验共享授权；平台管理权不扩大私聊读取 |

PPT限定验收：22覆盖原话到真实草稿；23覆盖明确房间原记录、缺资料说明及设计师回复；33覆盖同项目来源/负责人交接；38覆盖人工确认边界与版本失效后的跟进。语音、有效点位图、获准共享客户需求、方案具体版本说明、业主事项结果回传及正式决定**不因这些测试通过而记完成**。当前只支持上述显式编号命令及近期50条事项投影，不宣称未经培训的自由表达接续。

在`admin/`重复执行：`node scripts/construction-chat-acceptance.mjs`（批准的隔离55432库、既有私有连接配置、串行advisory锁）；`node scripts/construction-acceptance.mjs --site-only`；`node --import tsx scripts/construction-chat-development-acceptance.ts --development`（批准的localhost5432开发库、本地3006/Worker、已验证Stable2.02.2608080/SDK0.13.0/CDP9431/auto9420及窗口辅助脚本）。原生仅注入限定合成身份签名和白名单本地HTTP通道，实际操作输入/按钮/重进；结束恢复会话/存储/网络方法，停用合成员工并撤销token。不操作外部消息或生产。可重复driver/harness已纳入本轮；既有本地SDK/窗口辅助工具仍是前提。

原生证据：`tmp/xiaok-followup-batch/native-driver.json`、`native-materials.png`、`native-reply-reentry.png`、`native-cancelled.png`；首轮成功证据另存`native-first-pass/`。本轮fixture企业2409/项目16，原记录及事件修订见JSON。模型`deepseek/deepseek-flash`、runtime`langgraph-v1`、prompt`xiaok-site-record-v1`；两次报告整理成功且有observed用量，查询/动作不产生模型run。这是当前模型报告回归，不是自由语义事项能力基准。截图校验实际路由/栈、逻辑390×844（编码348×752），普通文字/来源/负责人/等待/取消状态复用PPT既有组件并检查；无新素材，不宣称完整光学还原。最终lint0错误/30既有警告；全量tsc292条既有诊断（起点293，重启后1条.next生成诊断消失，不宣称修复既有源码错误）。量房Phase0既有1失败保留；小程序全量、生产构建、全宿主/高屏/键盘/光学、真机/真实微信/BLE未验证，不构成发布批准。

## 当前P2M.3/P3B：资料关联与持续接续基础（限定Implemented，整体Limited）

资料关联由本人会话/明确房屋组合原话、完成的正式v4主户型与本人可见现场发布版本，带精确来源类型/ID/hash/版本、房间候选、原始消息/媒体ID、受众、依据与查询时间。只读且不建进度草稿。多房屋/多个项目/重名房间先澄清，同名不升级为已核验关系；点位图及共享设计资料仍缺业务来源，不能从墙图虚构。同一房屋多项目或重名房间目前安全停止并待员工核对，工具尚未提供项目/楼层选择器，不宣称完整消歧。当前查询限本人原咨询，未增加设计师共享卡或跨私聊资料读取。C01/C02/U01普通文字气泡与已有发布记录为设计依据，原PPT15/23实际内容已读取；无新布局/素材/导航。

持续事项复用原`construction.need.asked.v1`事件ID作为稳定issueId，初始revision1；有效`record_need`补充与S01明确sourceMessageId/field的核对分别追加`construction.need.progress.v1`修订。聚合记录只保存原话/事实指针和hash、项目、进展类型；不复制整段私聊，不建第二套Agent知识库或新增表/迁移/API。当前状态为待客户补充、待核对（未分配/原接续设计师）和来源已失效。普通讨论、可以/收到、一般人工回复不新增或关闭事项，不写正式方案/费用/工期/验收批准。原咨询事项转交、正式业务关闭/取消、定时催办及主动结果事件回传仍未实现；共享现场事项按上方P4A当前合同；页面关闭后的原S01回复和事项进展可持久重进读取，不宣称外部推送。

PPT16/35/37的“已知设备后补其他设备”仅在企业明确配置剩余设备问题时启用，沿用已知原话作简短上下文；已不确定、稍后或明确没有其他设备不追问，同一项目/客户/字段/房间只问一次。实际节点及配置/房间/客户范围失效时，旧事项与派生回复、Agent记忆投影和模型历史均重验；原始材料与更正链保留审计。既有业务查询历史仅带重新查询提示，避免自己保存新补充时误继承旧快照；未知工具结果、重复原键和提交后checkpoint前租约恢复不产生第二次记忆/事项写入。原租户RLS、本人参与者、接续授权与实时员工身份、人工暂停、用量和保留期边界保持。

继续采用现有LangGraph JS1.5.0的有界标准工具循环；已复核[工作流/Agent](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[维护中的消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭1440问题](https://github.com/langchain-ai/langgraphjs/issues/1440)。Postgres继续负责租约、来源/版本、幂等及用量，不新增框架checkpointer/编排器或供应商协议补丁，不把tool状态当业务回执。当前prompt `xiaok-renovation-v17`；v16为资料基础提交时的模型证据，历史v15/v14保持各期含义。

本批检查：原生主链9/9（副屏唯一Stable2.02.2608080/SDK0.13.0/基础库3.17.2/逻辑390×844，PNG348×752），真实HTTP/Worker5次运行成功、同一事项245由revision1→2→3；S01核对/回复后仍待核对，非正式批准。最终资料文字原生4/4另增1次成功真实run，共6次。资料专项v17最终7/7，含两次当前配置模型核心路径（v16此前7/7保留为历史）；事项专项6/6含两次v17模型核心路径，之后新增提交后租约恢复1/1。相关Agent19项：12通过/7配置跳过/0失败；施工67项：64通过、3配置跳过、0失败，原全量相同文件分5组顺序覆盖。此前一次进程消失且无完成结果，按中断保留、不算通过；其两条明确标识合成企业已在隔离验收锁下清理。Mini定向63/63；量房Phase0基线8项：7通过/1既有依赖审计失败，相关测试与autosave源均保持原内容；小程序全量未重跑。Admin全量lint0错误/30警告；tsc仍293条诊断，触及路径无诊断、首尾错误集合相同，未记通过。生产构建未重跑；完整宿主胶囊/光学/高屏/键盘、真机/真实微信/BLE及生产验收未验证，均非开发手测门槛。

可重复命令（admin）：`node scripts/assistant-materials-acceptance.mjs`；`node scripts/assistant-materials-acceptance.mjs --issues`；设置`XIAOK_MATERIALS_LIVE=1`执行当前已配置模型核心场景，各2次；只读复制原开发供应商配置到隔离库并恢复，不修改开发/生产供应商设置。固定隔离localhost:55432/xiaok_embedding_eval及闲置队列互斥锁，创建/清理有前缀的合成数据。`node --import tsx scripts/assistant-materials-development-acceptance.ts --development --native`固定批准的localhost:5432/smart_floor_planner，新建清楚标注的合成企业/用户/房屋/项目，不改其他企业；结束禁用合成操作账号并递增客户contextVersion撤销测试会话。原生依赖当前本机`tmp/xiaok-vector/materials-followups-batch/materials-native.cjs`、既有SDK/CDP/副屏辅助文件，不是脱离本工作区可运行的已发布测试包。凭据与传输/存储journal仅内存，完成恢复原身份/方法并读回transportActiveAfterCleanup=false，返回首页。

证据：`tmp/xiaok-vector/materials-followups-batch/`保留模型逐轮工具/来源/结果/实际token、原生及真实HTTP/Worker回读、日志/状态/截图、中断尝试及分组重跑/清理。Codex直接对照4条v17轨迹的限定目标，未见无依据项目承诺或重复已知问题；这不是独立人工审核或广泛质量评分。4次保存确认均多问一个本轮限定任务不需要的可选细节，记为体验改进。两轮轨迹耗时24.6–38.5秒；6次原生run创建→持久完成P50=15.660秒/P95=23.178秒，未测首反馈、不作生产基准。费用未知；旧原始trace占位0不是实测质量率。首轮原生401与后续临时脚本依赖错误均记录为验证装配问题，未改认证/安全。设计源仍为`design-references/xiaok-p4b-public-sites-v1/README.md`及继承C01/C02/U01，最终当前文字截图为`materials-native-final-source-text.png`。本批仅验证原组件数据/文字变体，不是视觉还原；无新增素材/markup/样式/导航，两份唯一还原台账保持。
