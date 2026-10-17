# 小K助手阶段接力记录

**持续开发已恢复。** 用户最新顺序是“按完善后的计划开始开发，先补Agent的资料关联基础，再接持续跟进，用对应PPT场景做自动化验收”，覆盖旧C05暂停和S07优先入口。本批完成后由父对话换新对话接力，不等用户逐节点确认。**下一新对话的Codex执行模型：`gpt-6-astra / max / fast`；当前轮没有切换执行模型，也没有更换产品供应商。**

## 本批交付与范围

P2M.3资料关联与P3B持续接续的限定闭环Implemented，整体Limited。保留原C01/C02/S01/U01入口和共享组件，没有WXML/Less/图片/导航、新API、表或迁移。没有做完整PPT23设计师资料卡/点位图、P4A共享事项、正式变更、事项转交/关闭、定时催办或外部推送；不合并、不部署。

1. `query_materials`按服务端本人会话和明确房屋组合原话、完成的正式v4主户型、向本人发布的现场版本。保留资源类型/ID/hash/版本、房间候选、原始消息/媒体ID、受众/依据/查询时间；多房屋/项目/重名房间先澄清，同名不是已核验映射，点位图保持缺项。同一房屋多项目或重名房间当前安全停在待员工核对；工具尚无项目/楼层选择器，未完成此类消歧后的查询链。不写正式墙图/进度草稿/批准。该工具只供客户自己的咨询，不能直接改为所有员工都可读私聊。
2. 原`construction.need.asked.v1`的事件ID成为稳定issueId。有效`record_need`补充及S01原授权设计师的明确sourceMessageId/field核对追加`construction.need.progress.v1`，推进同一修订链。查询分清待客户、未分配、原接续设计师核对和来源已失效。普通“收到”和一般人工回复不自动解决或批准；没有期限不编造逾期。没有另建Agent真相库。
3. 模型前后、缓存、checkpoint、提交、历史及派生回复重验来源。节点/配置/房间/客户范围变化使旧事项、模型记忆和其原话历史投影不可再沿用，底层原件/更正链保留审计。既有业务回答在后续模型上下文只保留重新查询提示，避免自己的新补充误继承旧快照。原租户RLS、身份/接续授权、人工暂停、用量与幂等保持。
4. PPT16/35/37的剩余设备问题只有企业明确配置后才问，承接已有设备；已不确定/稍后/明确没有其他设备不追问，同一项目/客户/字段/房间去重。原生里节点、补充、等待状态、S01核对/回复及回AI重进已贯通。

最新计划为双语`docs/xiaok-assistant-roadmap*`的3.10、4.11、4.12和第10节；当前合同为双语`docs/xiaok-assistant-phase-2*`开头。PPT实际路径`docs/装修施工标准手册制度规范/家客来小K装修服务功能方案.pptx`，SHA-256 `9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4`。本批实际读了相关页的XML文字及第23页图像，单屏853×1844，不靠标题猜场景。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| 最终v17资料专项 | 7/7；含DeepSeek deepseek-flash两次保存原话→资料查询核心路径 |
| v17事项专项 | 6/6；含同一事项补充→真实等待状态两次核心路径 |
| 提交后、checkpoint前租约恢复 | 1/1；同一操作重放不增记忆版本或事项修订 |
| 原生主链 | 9/9，真实发送、Worker写入、重进、节点、同一事项、S01核对/回复/恢复AI |
| 最终资料文字原生复核 | 4/4；在原路由重新生成并截取当前结果 |
| 相关Agent数据库回归 | 19项：12通过、7按原配置跳过、0失败 |
| 施工全量 | 67项：64通过、3配置跳过、0失败；同样文件分5组跑完，先前无结果退出保留为中断且两条遗留合成企业已清理 |
| 小程序定向 | 63/63 |
| 量房Phase0既有基线定向复核 | 8项：7通过、1失败，未改相关文件 |
| Admin全量ESLint | 0错误、30警告 |
| 独立全仓tsc | 失败：293条诊断，触及文件无诊断；本批首轮与最终诊断集合完全相同 |
| 文档、暂存、工作区保护检查 | 详见stage-validation.json；按本批路径逐项区分与暂存，保留既有工作区 |

量房失败仍为`test/survey-kernel-phase0-baseline.test.js:87`调用/依赖审计：`surveying-editor-autosave.test.js`既有`createSurveyDraft`依赖未录入expected-audit。基线测试与起始Git内容相同，autosave测试起止SHA-256一致。本批保留量房并行工作，没有改预期来做绿。小程序全量未重跑；上轮1966通过/1失败是历史结果，不能当本轮全量通过。

未重跑Admin生产构建，没有生产发布。完整宿主胶囊/光学/高屏/键盘、真实微信授权、真机/BLE及外部渠道仍未验证，非开发手测门槛。原生业务通过不代表完整视觉或发布批准。

四条v17两轮模型轨迹均完成各自**限定基础目标**；资料路径明确缺点位图，不能记成完整PPT23正常设计处理链通过；事项也没有业务关闭。逐轮工具/来源/结果和实际用量保留。Codex对照这四条轨迹未见无依据项目承诺或重复已知问题；每次保存后仍多问一个完成本轮任务不需要的细节，记为4次可选追问的体验改进，不是独立人工或广泛质量评测。两轮轨迹耗时24.6–38.5秒；另对6次原生真实run的创建→持久完成计时，P50=15.660秒/P95=23.178秒，首反馈未测，均非生产性能基准。费用未知，不按token猜费用。旧原始trace占位0不是实测评分，以`model-review.json`说明为准。

## 原生与合成数据

复用唯一副屏Stable2.02.2608080原项目窗口，projectpath精确为本仓库`miniprogram/`；autoPort9424、官方SDK0.13.0、基础库3.17.2、逻辑390×844。每次控制先新鲜编译；首次SDK冻结须显式再编译再重连，未重开/关闭用户窗口，未抢前台。截图前核对顶部路由`packages/assistant/chat/chat`，PNG348×752与逻辑尺寸分开记录；没有将模拟器图当完整宿主捕获。

只写批准的localhost:5432/smart_floor_planner中的新标注合成数据。企业2404只是已验证模板的只读配置来源，没有改其业务数据/设置。首次入口401的合成企业2405/用户3195没有发送业务消息，操作账号已禁用，测试会话已撤销。成功企业2406，prefix见`materials-native-driver.json`，客户3196、操作账号4953/4954、线索2871、正式户型464、项目13、咨询143；原事项245为revision1→2→3，仅2条progress事件。6次run117–122均成功、当前在途0、正式墙图hash不变；操作账号均disabled，客户contextVersion最终至少3，测试JWT失效。未来必须重读manifest和实际版本，不硬套这些修订值。

隔离回归仅localhost:55432/xiaok_embedding_eval，使用非superuser/非BYPASSRLS角色和既有闲置队列互斥锁，创建并清理标注合成企业/用户。模型测试只在隔离库临时复制已批准开发供应商配置并恢复，没有改开发/生产供应商设置。

原生传输仅内存转向固定localhost测试路径，并限制合成cid及其真实返回的runId；JWT、storage journal不落盘。两个成功原生控制均恢复原token、request/downloadFile和存储方法，读回transportActiveAfterCleanup=false并返回首页。首轮401因测试脚本在加载env前导入签名模块，已修复；临时文字复核脚本另遇包解析错误，修复后4/4通过。前者完整记录在`attempt1-entry401/`，后者摘要在`harness-issues.json`，未改认证或网络安全设置。

设计源保持`design-references/xiaok-p4b-public-sites-v1/README.md`及其继承的C01/C02/U01。没有视觉还原或新增设计资产，两份还原台账未改且chat仍唯一一行；本批是原组件的数据/文字变体。最终原生截图及验证来源记入当前模块/阶段文档，不另立设计权威。

## 可重复命令与证据

在admin执行`node scripts/assistant-materials-acceptance.mjs`、`node scripts/assistant-materials-acceptance.mjs --issues`。设置`XIAOK_MATERIALS_LIVE=1`后各跑2次对应核心模型路径；无该变量时模型用例按配置跳过。`XIAOK_MATERIALS_TEST_PATTERN='expired lease'`配合`--issues`只跑恢复用例。原有回归为`node scripts/assistant-p2m-test.mjs`和`node scripts/construction-acceptance.mjs`；lint用`node node_modules/eslint/bin/eslint.js`。

在miniprogram执行`node --test test/public-owner-receipts.test.js test/assistant-public-sites.test.js test/assistant-chat.test.js test/public-sites-lifecycle.test.js test/project-packaging.test.js`；既有失败可用`node --test test/survey-kernel-phase0-baseline.test.js`复现。没有把完整npm test记录成通过。

原生为admin中的`node --import tsx scripts/assistant-materials-development-acceptance.ts --development --native`。依赖当前本机`tmp/xiaok-vector/materials-followups-batch/materials-native.cjs`和既有SDK/CDP/window辅助文件，不是脱离本工作区可运行的已发布测试包。运行前仍须核实唯一项目/副屏/端口无其他控制者。数据验证脚本已结束，不因阅读本文自行操作窗口。

本批证据统一在`tmp/xiaok-vector/materials-followups-batch/`：workspace-before/pre-edit、各专项/回归/基线/lint/tsc日志与status、construction-full-interrupted.json、construction-grouped-status.json和construction-interrupted-cleanup.json、四份`*-model-trace-{0,1}.json`、`model-review.json`、`materials-native*.json`与路由核对PNG、`final-primary-readback.json`、`harness-issues.json`、`workspace-preservation.json`、`stage-validation.json`及`git-final.json`。测试fixture IDs与真实客户数据分离，日志不含会话或供应商凭据。

## Git与工作区边界

开始分支`codex/xiaok-public-site-lifecycle`，HEAD `0d4376db9616ca8d16ceda7dc827f2975004aca8`，476条既有改动，暂存为空，`.agents/skills`不存在、rg不可用。471个可读初始文件已保存hash，5条既有composer删除仍保持；除本批明确路径，未见其他初始文件hash改变。没有全部暂存。

- `a42acadd` — `feat: add sourced assistant material queries`。
- `89a538c5` — `feat: persist stage need follow-ups`。
- 最终证据/交接提交为本文所在的`docs:`提交，完整SHA及普通push/远端核验见`git-final.json`及`git log -1`。功能阶段已普通push并核验GitHub远端为`89a538c57f671f50b2fd6135b7adb235b00969ec`；本次交接提交的最后同步结果另见`git-final.json`，不以文件自述代替远端核验。
- main目标保持`f273b57171d6dab5c3b8beef1fe124e634d51864`；最终实际核验见Git记录。CI：工作流0条、check run0条、commit status0条；无运行记录，不记为CI通过（功能提交；最终交接提交的核验结果见`git-final.json`）。没有force push、合并或部署。

本批只提交必要源/回归/验证脚本、4份模块清单的当前窄备注、双语二期的本批当前合同及交接。Agent/施工前置文件原有未跟踪内容只纳入本批必需路径；二期旧历史、路线图及大量其他前置实现继续留在工作区，不能凭本批提交重建完整XiaoK/P4B部署包。普通`.git`写入受sandbox限制，按用户既有授权走了受控执行，自动审核通过，没有剩余授权阻塞。

## 下一精确入口

下一新对话使用`gpt-6-astra / max / fast`，先读AGENTS、当前双语阶段合同/模块清单、路线图3.10/4.11/4.12/第10节和本文，核对真实Git/进程/fixture状态。当前推进到**P4A共享工地对话的查询/处理意图区分及同一事项回传基础**，不要倒回S07优先顺序。

精确代码入口：`admin/src/lib/construction/site-chat.ts`的send默认创建现场记录，`site-worker.ts`仍为单步整理；应让“底盒待核对，帮我找对应图纸和需求”作为查询/处理进入原共享会话，不误建进度草稿。复用本批资料来源/版本及事项事件经验，但把读者限定为有效项目成员/原租户和实际项目房间，不把客户只读`query_materials`改成可越权读私聊的通用工具。原S01授权、共享受众最小投影、成员移出/撤回/版本变化、Worker恢复与去重继续作为硬边界。

对应PPT22/23/33/38及XK03/04/07/08，仅验本阶段已实现片段；点位图业务域不存在时保留具体缺项，不从正式墙图猜出点位或造假工具。团队负责人转交/回复、原事项结果回传和后续P5关闭/具体方案版本需分清；不凭一句“收到”完成事项。共享UI遵循原PPT22/38及已批准状态组件，不能改成通用表单/仪表盘；新视觉方向和生产仍有原批准边界。语音、外部微信渠道、硬件及完整P5/P6不因本批通过而升级状态。
