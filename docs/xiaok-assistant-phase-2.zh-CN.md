# 小K第二期：需求整理与人工交接

## 当前P2M.3/P3B：资料关联与持续接续基础（限定Implemented，整体Limited）

资料关联由本人会话/明确房屋组合原话、完成的正式v4主户型与本人可见现场发布版本，带精确来源类型/ID/hash/版本、房间候选、原始消息/媒体ID、受众、依据与查询时间。只读且不建进度草稿。多房屋/多个项目/重名房间先澄清，同名不升级为已核验关系；点位图及共享设计资料仍缺业务来源，不能从墙图虚构。当前查询限本人原咨询，未增加设计师共享卡或跨私聊资料读取。C01/C02/U01普通文字气泡与已有发布记录为设计依据，原PPT15/23实际内容已读取；无新布局/素材/导航。

持续事项复用原`construction.need.asked.v1`事件ID作为稳定issueId，初始revision1；有效`record_need`补充与S01明确sourceMessageId/field的核对分别追加`construction.need.progress.v1`修订。聚合记录只保存原话/事实指针和hash、项目、进展类型；不复制整段私聊，不建第二套Agent知识库或新增表/迁移/API。当前状态为待客户补充、待核对（未分配/原接续设计师）和来源已失效。普通讨论、可以/收到、一般人工回复不新增或关闭事项，不写正式方案/费用/工期/验收批准。负责人转交、业务关闭/取消、定时催办、共享会话事项和主动结果事件回传尚未实现，仍归P4A/P5；页面关闭后的原S01回复和事项进展可持久重进读取，不宣称外部推送。

PPT16/35/37的“已知设备后补其他设备”仅在企业明确配置剩余设备问题时启用，沿用已知原话作简短上下文；已不确定、稍后或明确没有其他设备不追问，同一项目/客户/字段/房间只问一次。实际节点及配置/房间/客户范围失效时，旧事项与派生回复、Agent记忆投影和模型历史均重验；原始材料与更正链保留审计。既有业务查询历史仅带重新查询提示，避免自己保存新补充时误继承旧快照；未知工具结果、重复原键和提交后checkpoint前租约恢复不产生第二次记忆/事项写入。原租户RLS、本人参与者、接续授权与实时员工身份、人工暂停、用量和保留期边界保持。

继续采用现有LangGraph JS1.5.0的有界标准工具循环；已复核[工作流/Agent](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)、[维护中的消息/工具测试](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/tests/prebuilt.test.ts)及[已关闭1440问题](https://github.com/langchain-ai/langgraphjs/issues/1440)。Postgres继续负责租约、来源/版本、幂等及用量，不新增框架checkpointer/编排器或供应商协议补丁，不把tool状态当业务回执。当前prompt `xiaok-renovation-v17`；v16为资料基础提交时的模型证据，历史v15/v14保持各期含义。

本批检查：原生主链9/9（副屏唯一Stable2.02.2608080/SDK0.13.0/基础库3.17.2/逻辑390×844，PNG348×752），真实HTTP/Worker5次运行成功、同一事项245由revision1→2→3；S01核对/回复后仍待核对，非正式批准。资料专项v17最终7/7，含两次当前配置模型核心路径（v16此前7/7保留为历史）；事项专项6/6含两次v17模型核心路径，另加提交后租约恢复1/1。Mini定向63/63，Admin全量lint0错误/30警告。全仓tsc293条诊断、触及路径无诊断，仍是失败检查；生产构建未重跑。最终文字原生4/4已通过；施工/Agent相关回归在执行。旧小程序全量1966通过/1既有量房审计失败未被修复或改记通过。完整宿主胶囊/光学/高屏/键盘、真机/真实微信/BLE及生产验收未验证，均非开发手测门槛。

可重复命令（admin）：`node scripts/assistant-materials-acceptance.mjs`；`node scripts/assistant-materials-acceptance.mjs --issues`；设置`XIAOK_MATERIALS_LIVE=1`执行当前已配置模型核心场景，各2次；只读复制原开发供应商配置到隔离库并恢复，不修改开发/生产供应商设置。固定隔离localhost:55432/xiaok_embedding_eval及闲置队列互斥锁，创建/清理有前缀的合成数据。`node --import tsx scripts/assistant-materials-development-acceptance.ts --development --native`固定批准的localhost:5432/smart_floor_planner，新建清楚标注的合成企业/用户/房屋/项目，不改其他企业；结束禁用合成操作账号并递增客户contextVersion撤销测试会话。原生依赖当前本机`tmp/xiaok-vector/materials-followups-batch/materials-native.cjs`、既有SDK/CDP/副屏辅助文件，不是脱离本工作区可运行的已发布测试包。凭据与传输/存储journal仅内存，完成恢复原身份/方法并读回transportActiveAfterCleanup=false，返回首页。

证据：`tmp/xiaok-vector/materials-followups-batch/`中的模型逐轮工具/来源/结果/实际token用量与耗时、原生及真实HTTP/Worker回读、相关日志/状态和截图。费用未知不推算；任务结果与工程边界分别断言，文风、无依据回答率、重复追问率等未独立评分，不将未评分占位当零。首轮原生入口401与后续临时脚本依赖错误保留记录：均为验证脚本装配问题，未改认证或安全设置。
