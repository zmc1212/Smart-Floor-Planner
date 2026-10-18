# 小客交接：P4A同事项取消、恢复与原咨询状态回传

2026-10-18，接续最新双语计划/KB-4交接，选择总路线图3.1已有P3B/P4A的真实缺口：现场事项取消后不能沿原ID恢复，取消或恢复后的等待状态不能明确回传客户。本批不是KB-5，不重做P5；**整体仍Limited，不代表完整专业客服、全PPT或发布就绪**。分支codex/xiaok-public-site-lifecycle，基点9210a012b08af38ec28f383e6c78196df958838f。功能提交`82baf5157acd877dbdf4c8aedb5287e3ac822680`；交接另提交，最终HEAD/上游/GitHub核验见tmp/xiaok-issue-continuation/git-final.json。只普通推送，不合并main、强推或部署。

前序KB-4功能`baf557f8569de4f2852f438e162966099bc93577`及交接`9210a012`保持有效；[历史交接](https://github.com/zmc1212/Smart-Floor-Planner/blob/9210a012b08af38ec28f383e6c78196df958838f/docs/xiaok-assistant-handoff.zh-CN.md)保留原检查、0087备份/迁移和恢复待验记录。本批不迁移、不重算先前69通过/10跳过为新结果，OCR/复杂格式/影子重建按真实材料需要接续。

## 本批交付

- 读根/admin指令、双语模块/二期合同、最新双语知识计划/路线图及PPT。相关目录与祖先没有.agents/skills或新的嵌套AGENTS。原PPT SHA256仍9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4。17/20/24/36提供持续事项与等待安排，23提供底盒/同房间/设计师上下文，38提供团队确认及非批准边界；合成办公规则不是PPT工程标准。
- 原S04输入“恢复事项123：原因”，仅对已取消事项沿同一issueId追加修订。原发起人或管理者，核对当前事项/记录/房间资料版本（空资料hash也校验），重绑当前原记录，清掉旧回复及图纸关联；有效负责人保留、撤权负责人不复活。正式方案/决定/落实/解决/关闭仍走P5，普通恢复不能绕过。
- 原GET版本快照补最多50事项的当前原记录版本，即使原记录已滑出消息分页；records上限150（页100＋事项来源50），不复制原文或依赖旧缓存。恢复仍在事务内重验，不自动批准新版本。
- 管理者“回传事项123：明确节选”可发送精确取消/待团队/未分配状态与负责人，也保留原已回复待核对路径的回复/图纸要求。只回原授权咨询，不复制内部原话/图片、开放内部会话或新增关注订阅。负责人移出后明确回传未分配会清旧分派/回复，不能靠再加入复活。
- 原outbox/progress/result、幂等事务、Worker/人类模式延后、来源/参与者/租户/版本守卫复用，无新表/迁移/路由。结果保存state/owner/waitingFor；旧无state与P5正式结果保留原hash/lastProgress形状，避免代码升级批量作废旧有效问答。真实来源/权限变化仍失效，成员审计阻止旧回传恢复。
- v39的query_followups只读实际已投递的状态，进入原construction source_refs和知识＋实际节点的同轮综合解释。客户普通聊天/模型建议不能取消/恢复/批准；无期限不编逾期，不把节点或恢复当已验收/可固定底盒。owner/admin/super_admin继承原所选企业管理边界，未改角色授权、配置或凭据。
- 复用S04原PPT22/38、PPT23资料屏及C01/C02/U01组件/状态；无Mini WXML/Less/素材/导航改动。双语当前模块、二期合同及两路由唯一还原台账已同步，计划和旧未验范围保留。

## 执行验证与证据

主证据目录：tmp/xiaok-issue-continuation/。acceptance-summary.json、semantic-review.json、development-audit.json、usage-summary.json、native.json、native-driver.json、native-visual-review.json。

| 检查 | 最终结果 |
| --- | --- |
| 隔离核心 | 12/12；同ID/并发原键/过期版本/分页/来源/撤权/三类管理者/旧格式兼容 |
| 受影响回归 | 63项按最终执行汇总61通过/2显式跳过/0失败；初轮58/3/2日志保留，受影响材料组12/12重跑后逐题替换结果 |
| Mini专项 | 92/92，不是全小程序套件 |
| 配置实模主线 | 4/4：run382/383取消、384/385恢复；同题各2次，真实HTTP/Worker/索引/DeepSeek deepseek-flash，不是确定性provider语义评分 |
| 最终Stable原生 | 17/17功能步骤，真实客户run392/393；首轮桌面17步及run388/389仅为补充，不累加核心题 |
| 类型/Lint/编译 | 变更路径lint0错误/0警告，全量lint0错误/30既有警告；同源类型287→287无新增诊断；隔离Webpack编译通过。完整构建仍被既有AiDesignerLegacyPage非法导出阻断 |

主线enterprise2467/project85/lead2943/cid290/user3334，owner5053/designer5054/worker5055，知识document170/version172，issue1121、客户回传revision5→7。最终原生enterprise2470/project88/lead2946/cid296/user3346、owner5062/designer5063/worker5064，document173/version175，issue1176、回传revision6→8。六条最终回答均逐条独立读原回答/引文/工具快照核对：已取消没有待执行安排；恢复等合成设计师核对；企业知识、实际水电节点与未知点位图/尺寸分开；未推定批准或创建额外正式事项。不是人类装修专业验收。

5个合成开发企业2466–2470（含失败尝试）均关闭开关、停用账号、提升用户context_version；审计active_staff/active_runs/active_jobs均0，正式方案/处理事件均0。13个实际run/21次供应商调用均成功：最终主线8次53,089 text tokens，最终原生4次26,436，首轮原生4次26,522，5次现场文字整理2,015。8次查询Embedding共607输入tokens（主线298、最终原生153、早期原生156）；不含全部索引工作。4次索引任务各1 attempt且成功。所有费用未知/null，不记零、不编小样本P50/P95或专业质量百分比。

原生沿唯一副屏Stable2.02.2608080、automator0.13.0/base3.17.2，新编译并核对项目路径/实时data/元素/输入/按钮/导航。逻辑390×844，PNG348×752；当前5张取消/恢复/撤回图已查看，路径区分site/customer，每图前查精确route/stack。输入15px对原30rpx约15.6px，发送43px对84rpx约43.68px，品牌右边214px在胶囊左边296px内，具体容差及实测见JSON。C01长文捕获显示尾段，开头状态由实际持久/原生数据另核对，不把局部截图当完整光学验收。最终transport.active=false，回原首页，SDK断开；真实微信登录、完整宿主/光学/高屏/键盘/BLE/真机保持未验证、非阻塞，不转交用户必做手测。

## 失败、限制及复跑

- 初轮隔离外层120秒超时及boss.write测试夹具误用，未计通过；确认相关进程结束后，只清理确切标记隔离企业3339/3340及user6310，见initial-cleanup.json。第二轮9/10因测试按不存在的purpose过滤历史失败，改为真实content文本投影后10/10；新增旧格式/分页反例后最终核心12/12。
- 初次实模2466把clientMessageId与Idempotency-Key配成两值，被422正确拒绝；修复测试装配，未放宽认证。初次原生2468沙箱枚举不到桌面窗口；已授权桌面只读核验唯一副屏后按原流程接入，不新开/关闭项目窗口。相关失败企业均关闭。
- 首轮桌面原生17/17功能通过，但S04/C01取消截图重名；旧证据归档native-first-desktop，误覆盖图不作S04视觉依据。最终使用不同路由文件名完整重跑17/17，并增加控件/胶囊边界断言。
- 原材料回归旧mock在每轮都要求历史包装文本，与既有current-turn-evidence-v1聚焦策略冲突，首项indeterminate及两个依赖用例连带失败；改为首轮原回传、后续实时工具回执/原来源ID断言，未改权限/来源或未知结果保护，受影响材料组最终12/12，合并同名题最终61通过/2显式跳过/0失败。初轮完整日志不覆盖。
- 临时CJS探针在Admin目录引入两项lint错误，已只移走该任务自建探针；临时日志保留。既有AiDesignerLegacyPage非法页面导出是完整构建阻断，未动无关代码。没有新完整恢复演练，旧pending保持。
- 仍是单一合成双人办公问题。单独共享需求/图纸尚未进入query_materials的有效原话/图纸投影，因此正文会保守提示缺项；两条回答有不必要的可选恢复/记录追问，回答仍长。construction来源尾注仍是节点/发布记录的域级合称，不当作“确有已发布记录”的证明，下一资料投影应一起细化。未声称全照片/正式图纸、完整跨天节点事项、S05/P6、全格式/OCR/影子重建、外部微信或生产完成。

在admin：node scripts/construction-issue-continuation-acceptance.mjs；--regression、--materials-regression、--mini；node --import tsx scripts/construction-issue-continuation-development.ts --development（原生加--native）；node --import tsx scripts/construction-issue-continuation-audit.ts --development；node scripts/construction-issue-continuation-typecheck.mjs 9210a012。隔离固定55432/xiaok_embedding_eval与共享锁，主线固定批准5432/smart_floor_planner、localhost:3006、现有Worker/provider；不迁移、不改SSH/隧道/端点/供应商或生产配置。基础manifest420路径及历史检查不升级为干净克隆/独立安装证明。

## 工作区、提交与下一步

本批只选择相关路径；具体暂存清单/保留核验见staging-review.json、preservation-check.json及baseline.json。初始55个脏路径中，除两份Mini模块清单本事项行外其余原哈希（含5删除状态）保持；两份共享清单只暂存本行，原用户正文/路线图/知识计划/无关代码与未跟踪内容不混入提交。没有全量add/reset/clean/stash或强推。

下一优先仍按总路线图3.1的P3B/P4A专业实况答疑：接入现有获权sharedMaterials的需求/点位图到query_materials，而不是新建知识/图纸真相源。当前agent/materials.ts仅读有效NeedMemory、正式v4主户型和向本人发布记录，并无条件把点位图列为缺项；本次真实回答已暴露这段缺口。沿明确同项目/房间/原咨询/同客户的有效grant ID/hash取原件/节选，客户提供图不得冒充正式批准版本；更新snapshot重验、撤回/替换/在途/重进与现有照片原件组件，再跑对应PPT23/38及同题知识＋实际资料至少2次。同步细化来源尾注，不重新做已交付P5，不自造KB-5。

若本批后无新增材料需求，原P3B节点需求事项跨阶段再绑定再接续；OCR/复杂格式/影子扩展按实际材料触发。用户持续授权有效，无需等待手工截图/A10/确认。新或冲突设计、真实客户导入/外发和生产仍守原授权边界。
