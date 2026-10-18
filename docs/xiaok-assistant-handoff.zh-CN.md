# 小客交接：获权需求与点位图原件进入专业问答

2026-10-18。继续现行路线图3.1的P3B/P4A及PPT23/38，补齐上一交接明确的原件投影缺口。**限定闭环Implemented，整体仍Limited**，不代表完整专业客服、全PPT或发布验收。当前分支`codex/xiaok-public-site-lifecycle`，基线`a44f4c74be9037241214f486cc40e778b449da04`；本轮功能提交`11d12f4188ef31cb371d62b6679aeb267b3f89a8`。最终交接提交、本地/上游/GitHub校验见`tmp/xiaok-material-projection/git-final.json`。

上一阶段`82baf515`/`a44f4c74`的同事项取消、恢复和原咨询状态回传继续有效；[原交接](https://github.com/zmc1212/Smart-Floor-Planner/blob/a44f4c74be9037241214f486cc40e778b449da04/docs/xiaok-assistant-handoff.zh-CN.md)及`tmp/xiaok-issue-continuation/`的原始成功/失败记录未改写。现行路线图/知识完善计划保留用户原工作区状态，没有混入本轮提交。

## 实际完成

- 原`query_materials`和`search_knowledge`绑定房屋路径复用`sharedMaterials`，投影同客户、同原咨询、同项目/施工房间的有效共享需求与点位图原件说明。`shared_need`/`shared_drawing`携带grant ID/版本、原消息/hash、原咨询、房间、图片ID/hash和客户参考身份。不同咨询即使同客户/房屋也不继承；多房屋/项目/重名房间仍先澄清，全房最多20个房间并明确剩余查询范围。
- 最新同类grant替换旧版，撤回最新不回退旧版；消息/图片hash、删除/用途、咨询用途/参与者、客户访问/归属、房间变更及保留期沿原服务重验。既有材料/业务快照守卫覆盖缓存、最终提交、重进、历史/派生回答及原有任务来源。原件继续走C01私有媒体和S04获权原件接口，没有新表、迁移、路由、菜单或授权系统。
- 每份材料提供独立sourceId/逐字原文，显式和知识绑定路径一致。v40把客户参考说明、企业规则、实际节点、建议与未知分开；尾注只列实际引用类型/房间，无节点/记录时不会把缺项查询标成已查阅实况。普通解释不创建正式处理。旧人数不能被推成旧桌型的提示约束已补齐。
- 当前配置模型未接收本轮点位图像素：原件媒体与说明确实进入授权投影，但只有说明进入文本解释，不能称看过图内细节、精确尺寸或正式核对。`imagePixels:false`描述这份投影未附像素，不关闭既有获权图像输入/观察协议；另一路图像证据须核对同一mediaId/hash。本轮未验证该图像路径。
- 保留原C01/C02/S04/U01结构、样式、素材、字体和导航。PPT23对应原件与同房间资料，38对应关键事项由团队核实；双语合同、四份当前模块记录和两个路由的双语唯一还原台账已同步。正式v4墙图仍只读，未更改其数据/量房/分佣合同，因此未改正式量房文档。

## 已执行检查

证据统一在`tmp/xiaok-material-projection/`，总表`acceptance-summary.json`、逐段复核`semantic-review.json`、原生`native.json`/`native-driver.json`/`native-visual-review.json`、数据/用量审计`development-audit.json`/`usage-summary.json`。

| 检查 | 实际结果与口径 |
| --- | --- |
| 原件核心 | 隔离服务17/17，加最终综合解释单元8/8；去重25项。早先合组日志是24项（17+旧7），保留原样，不伪造单条25/25日志 |
| 相关回归 | 完整命令75项：73通过、2项显式配置跳过、0失败；实际包含原件、同事项恢复、正式版本/落实关闭、三类管理者继承、并发及撤权恢复 |
| Mini专项 | 92/92，客户端单元，不是全小程序或原生业务验收 |
| 配置实模 | 最终6/6：有效原件、需求替换、撤图三组各两次；真实HTTP/开发数据库/原Worker/DeepSeek deepseek-flash；需要实际引用当前原件及企业依据，不只检查工具返回 |
| Stable原生 | 最终20/20，包含另外4次实模回答、真实输入/点击、图片上传、精确原件读取、来源片、持久重进、换版/撤回和成员撤权；临时网络/身份/存储恢复，SDK断开 |
| 工程检查 | 触及文件lint0错误/0警告，全量lint0错误/30既有警告；同源类型287→287，无新增诊断；隔离Webpack编译通过；完整构建仍在既有`AiDesignerLegacyPage`非法导出失败 |
| 文档/保留 | diff检查通过；两个路由每种语言均只有一行、唯一批准设计源不变；暂存前53项既有改动和原五项删除逐字节保留，小程序清单各只暂存一行本轮更新 |

隔离检查固定55432/xiaok_embedding_eval、非superuser/non-BYPASSRLS和原共享锁。中止的首次Node测试夹具3360/3361及其九个合成用户已在该锁下清理，见`isolated-cleanup.json`，未选择开发库或客户企业。

最终实模合成样本：enterprise2474/project92/lead2950/cid303/user3362，知识document176/version178，run400/401/403/405/406/407。最终原生样本：enterprise2476/project94/lead2952/cid307/user3370，知识document178/version180，客户run411–414。其他失败/早期样本2471–2475只作审计；六个开发测试企业均已关闭AI写入，测试员工账号禁用、合成用户context_version递增使本轮令牌失效，active_staff/active_runs/active_jobs均0，正式方案/落实/解决关闭事件均0。开发数据保留供溯源，不是已删除或真实工程数据。

所有业务内容和图片均为标记合成样本；240×180纯色PNG用于验证原件传输/hash/权限，不验证图纸内容理解。HTTP、模型、Embedding、Worker和开发数据库真实；隔离库模型适配器是确定性的，不能算实模。全轮含失败尝试21个真实run/38次供应商调用，供应商调用均技术成功但不等于语义全过；observed文本tokens264,818，查询Embedding输入tokens1,394，另有5个索引任务。费用未知/null，查询用量不包含所有索引用量，不推算费用或小样本P50/P95/产品正确率。

原生复用唯一副屏Stable2.02.2608080、automator0.13.0、base3.17.2，先新编译再核对实时数据/元素；每图前检查准确route/stack。逻辑390×844，PNG348×752。已查看实际原件消息、来源片、回答和撤回失效截图；输入15px对原30rpx约15.6px，发送43px对84rpx约43.68px，品牌右边214px在原生胶囊左边296px以内。长回答在消息区滚动，完整文字另核持久/原生数据，不把尾部截图当完整光学验收。

## 失败、限制及复跑

- 初轮6次实模虽通过来源/运行检查，run396/397/399把“双人办公”补成未确认的旧双人长桌。完整原输出`live.initial-unsupported-table.json`及`semantic-review.initial.json`保留，语义判定失败；修正提示后用相同原始夹具重跑最终六次，不更改样本掩盖问题。
- 首次Bun包装器不能运行Node测试，改为真实Node。首次Node包装器55秒中止、测试夹具字段/软删状态问题及开发脚本在环境加载前间接导入JWT造成401，记录在`initial-failures.json`和可用日志；中止包装器的原输出不完整，不作为整组通过证据。类型初轮新增3条诊断已修复，初始比较文件保留。
- 原生首轮沙箱看不到桌面窗口，未发生页面操作；沿已授权稳定流程在可访问桌面的环境重试。首次桌面原生因共用S04测试白名单未包含引用详情而超时，归档`native-first-citation-transport/`及对应根目录报告。测试器只放行本合成回答实际返回的citation ID，没有扩大产品权限；最终重跑20步通过。所有失败阶段及前批日志不计最终通过。
- 当前仍为单房间固定题的限定专业解释，不是开放题、图像阅读或工程规范级建议评审。部分回答偏长、重复可选转设计师或对查询缺项表达不够精确，后续继续收敛。与旧NeedMemory、未标记矛盾、多房间/跨阶段复杂更正的广泛语义覆盖未完成；不把结构引用校验当完整语义保证。
- 完整构建的确切失败见`build.log`，隔离编译见`compile-current.log`；没有改无关的AI Designer页面。Chrome、完整宿主/字体光学/高屏/键盘、真实微信登录、真机、BLE、全小程序打包/全量测试、干净克隆安装及生产仍保持未验或原历史失败状态，不能由本轮专项通过升级；不是要求用户手测的开发门槛。

在`admin`：`node scripts/assistant-shared-materials-acceptance.mjs`、`--regression`、`--mini`；实模`node --import tsx scripts/assistant-shared-materials-development.ts --development`，原生加`--native`；审计`node --import tsx scripts/assistant-shared-materials-audit.ts --development`；同源类型`node scripts/assistant-shared-materials-typecheck.mjs a44f4c74`。原生依赖既有本机Stable/CDP/窗口辅助脚本；复用已批准5432/smart_floor_planner、localhost:3006及现有Worker/provider，不迁移或更改SSH、凭证、角色/菜单或生产配置。首次调用本机工具时需保留真实Node与环境加载顺序。

功能提交只含本轮20项，双语Mini模块清单用HEAD内容加单段更新构造暂存，不夹带用户既有改动；范围与哈希见`staging-review.json`/`preservation-check.json`。本交接另作文档提交；只普通推送当前分支，不合并main、force push或部署。

下一步继续原P3B/P4A专业实况主线：复用原事项的图纸核对与正式版本来源，使回答区分“客户参考图”“团队核对关联”“精确正式版本”，并补需求/资料冲突及更正的来源解释；仍按现行PPT与既有组件自动验收。完整像素理解、后续阶段和外部条件据实际能力单独记录，不另起KB-5，不等待人工A10/截图/确认。
