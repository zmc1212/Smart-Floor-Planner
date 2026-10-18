# 小客交接：KB-4 知识运营核心限定闭环

2026-10-18，接续用户最新双语计划完成KB-4运营核心；**整体仍Limited，不代表全格式/影子重建、完整专业客服、全PPT或发布就绪**。分支`codex/xiaok-public-site-lifecycle`，基点`f2651bd6781adae6ad6abe1622d497ba3b0f11c9`，功能提交`baf557f8569de4f2852f438e162966099bc93577`；交接另一次提交，最终HEAD/上游/GitHub核验见`tmp/xiaok-kb4/git-final.json`。普通推送，无合并main、强推或部署。

## 本批交付与依据

- 核对根/admin指令、双语模块/二期合同、最新双语知识计划、路线图、依赖及原PPT；本检出及祖先目录不存在`.agents/skills`。PPT SHA256仍`9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4`。5/6/15的自然提问，23/38的缺资料/冲突及团队核实作为本批服务依据；运营后台设计源仍为双语Admin UI合同和既有Ant Design/Admin Pro，不冒充PPT新增看板。办公规则均为合成验收资料，不是PPT工程标准。
- 原`/assistant-knowledge`新增「问题集与健康」：企业共享整理固定问法、应有据/应缺依据、各最多5份必需/禁止文档、缺口备注；维护修订及版本冲突。每企业100题/2,000次执行，列表有界游标，来源选项最多200份；一次操作执行一道题，未实现批量调度或证明更大容量。
- 每次回归固定问题修订、epoch、当前发布必需版本ID/hash，只用客户公开受众、无草稿，沿本人原预览/Worker/额度/计量。create/send持久键覆盖关页、并发、丢包及发送后崩溃；`dispatch_pending`表示执行回执待核对，不宣称尚未调用。恢复继续原run，不另建模型/任务权威。问题共享不开放他人私有预览；不自动复制私人咨询、项目事实或创建施工事项。
- 实际召回、入选、引用、禁止来源和生成错误分开。索引未就绪/诊断不完整不能当“预期缺资料”通过；结构通过也不代表专业语义正确。管理者明确备注可保留缺口/核对本版，状态写入校验版本。知识/问题变化收起旧回答、诊断与核对投影；知识变化后已核对缺口待复验。回读原outputMessageId，不依赖最新聊天分页；历史按数值ID排序，跨位数游标不丢精度。
- 健康展示真实解析/索引任务、过期租约、当前profile/epoch、30天attempt、已知输入token小计与未知次数；profile仅返回所需元数据，不带凭据。费用未知保持null。聊天用量沿原独立授权和UsageService，索引单列，不扩大平台管理者的用量/费用核对权限。诊断不再误写manual-only；支持正文/FAQ/DOCX/文字PDF，扫描OCR、复杂PDF表格、XLSX/旧格式、影子profile切换/回滚仍按实际材料接续。
- 真实C01审阅发现原正向资料尾注会在缺房屋档案时列“正式户型与现场资料”。现只按实际返回的原话/正式户型/发布记录类别组装尾注，空材料不追加正向尾注；缺项快照、引用、旧业务授权仍保留。不改Mini WXML/Less/插画/导航或prompt v38，复用批准C01/C02/C05/U01的数据状态。旧历史消息未批量改写。
- `0087_assistant_knowledge_operations.sql`新增两张强制RLS表、租户复合FK、管理者引用保护及不可变评测快照；企业清理已先删除两表。新API位于`/api/assistant/knowledge/operations`：cases列表/创建/详情/编辑、case evaluations历史/执行、evaluation详情/resume/review及health，响应no-store。原selected-enterprise三类管理者继承及实时身份/受众/参与者边界不变。

## 执行验收与计量

主证据：`tmp/xiaok-kb4/acceptance-summary.json`、`semantic-review.json`、`development-audit.json`、`native.json`、`native-driver.json`。工程服务用真实隔离数据库/Embedding及确定性注入模型；下表实模另走开发库、真实HTTP/Worker和既有`openai_compatible / deepseek-flash`，两者不混算。

| 检查 | 最终结果 |
| --- | --- |
| 隔离运营核心 | 10/10；包含租户/本人预览、三类管理者、禁用/改密、真实索引/发布、冲突、同键并发、原回执恢复、长聊天精确投影、撤回、未就绪索引反例及18/19位数值游标；service.log |
| 单元 | 14/14；含缺项/部分/完整材料来源尾注、召回/入选/引用/版本/缺资料预期分离，unit.log |
| 知识/文件/权限/用量/运维回归 | 39通过/2显式跳过/0失败，regression.log；不是将跳过算通过 |
| Agent/材料/综合回归 | 30通过/8显式跳过/0失败，synthesis.log；含跨客户/租户、阶段/图纸更新、在途撤回、接管与参与者移出 |
| Mini助手专项 | 73/73，mini.log；不是全小程序套件 |
| 配置实模管理端 | 同一保存问题修订前后各2次，共4/4原摘录预览；run371/372/377/378，case4，必需/禁止来源和版本回读通过；不冒充客户Agent语义验收 |
| 配置实模客户Agent | 修订前后各2轮，4/4；run374/375/379/380。逐条独立读持久回答及原引文，必要有效版本真实引用，建议/未知分开，无点位批准/实际尺寸推定 |
| Stable原生 | 10/10功能步骤、真实Agent run373/376；同题知识版本167→170、真实输入、原来源片、重进及撤回失效；native.json |
| Lint/类型/构建 | 全量lint0错误/30既有警告，最终触及文件定向lint0；同一source-only程序287→287，新增/移除0，双方排除生成Next声明。隔离Webpack编译/追踪通过；完整生产构建仍被既有AiDesignerLegacyPage非法页面导出阻断，不称构建通过 |

最终审计10个问答run有16次成功供应商调用：客户主线8次、实测43,746 text tokens；原生4次、21,534 tokens；预览4次text用量为unavailable/null，不能记零。10次查询Embedding共610输入tokens（客户276、原生138、预览196）；费用均未知/null。计量不含索引、诊断和早期失败尝试，不计算小样本P50/P95或专业质量百分比；elapsedMs含轮询，原生feedbackMs不是首token时延。

最终主线企业2464/owner5048/user3325，文档166、版本166→171、case4；原生企业2465/owner5049/user3326，文档167、版本167→170。包括早期失败在内的6个合成企业均已关闭开关/停用账号并提升用户context_version，active_staff/active_runs均0，全部construction表副作用计数0；精确夹具/用量/来源在JSON。未向真实客户导入资料或发送消息。

原生复用唯一既有副屏Stable2.02.2608080窗口、automator0.13.0/base3.17.2，先新编译，逻辑390×844、PNG348×752。四张当前capture均核对精确route/stack并已查看，见native-visual-review.json及native-{office,citation,followup,withdrawn}.png。原源、字号与组件保持，完整宿主/光学/高屏/键盘、真机/真实微信授权/BLE仍未验证；不是新高保真还原验收。内存账号/传输已恢复，transport.active=false，回原首页并断开。双语唯一chat台账已替换当前行。

## 早期失败、修复与明确限制

- context-mode进程使用Bun启动node:test失败，改用实际Node24.9.0后执行；initial-bun-failure日志保留，不计成功。
- 前两次实模夹具的Mini令牌字段/环境加载时序错误导致401；改为加载环境后动态导入并使用既有customer JWT契约，增加实模前身份守卫预检。两个失败企业均关闭，initial/second-token-fixture-failure保留；未放宽认证。
- live/native回读最初错误使用displayText，实际消息在content.blocks；测试及新运营面板一起改正。同时查到并修复缺项来源尾注，projection-footer-failure与原回答保留。当前六轮回答由Codex独立逐条对照，不是人类专业验收；夹具核对操作也明确标为模拟运营。
- 多轮隔离回归实际跨过ID位数后，history的id::text别名使排序按文本，取错旧执行；守卫返回source_changed，未泄露旧片段。改为限定原数值列排序，并补18/19位确定性游标反例。numeric-order-failure保留。无索引反例最初错期待候选not_ready trace，真实失败路径在生成状态报retrieval_unavailable；修正断言后确认不能核对通过，未将检索失败当预期缺口。
- 原fs.cpSync复制目录在沙箱报EIO，改为只向既有标记的忽略快照目录逐文件复制，不碰开发.next；初始日志保留。新类型检查脚本的require风格lint及测试夹具类型错误已修正，相关失败记录仍在tmp。完整构建错误属于既有AiDesignerLegacyPage，不以编译模式/source-only检查代替。
- 仍是单一合成办公问题/两知识版本，回答偏长且有可选追问；不证明代表性工程知识、OCR、复杂格式、项目实况的全部语义覆盖或生产容量。预览只跑客户公开发布范围、无草稿/项目绑定；无批量调度、自动语义判定或影子profile重建。
- 用户Chrome认证态运营Tab的操作/渲染未验：无可调用Chrome连接器，现有Chrome进程无调试端口；未重启或更换用户会话。此项及真机等为开发未验证项，不转交用户必做手测。新完整恢复演练也未执行，旧pending保持。

## 依赖、复跑与工作区

在admin：`node scripts/assistant-knowledge-operations-acceptance.mjs`，另有`--unit/--regression/--synthesis/--unready/--mini/--lint/--types/--build/--compile`。隔离模式固定既有55432/xiaok_embedding_eval、应用非superuser/非BYPASSRLS及套件互斥锁。实模`node --import tsx scripts/assistant-knowledge-operations-development.ts --development`，原生再加`--native`并沿已授权桌面执行环境。类型对照`node scripts/assistant-knowledge-operations-typecheck.mjs f2651bd6`。

迁移核验`node scripts/assistant-knowledge-operations-migration.mjs`；只有明确`--apply`才备份/迁移。0087两批准开发目标已应用、SHA256 `0da098b83bd65f9fd23ab54516ed25c5e13b9e3feaad0ab3823b0a46dc2ed77b`不变，PG17.10/vector0.8.2、25张相关表强制RLS。迁移前custom备份`tmp/xiaok-kb4/development-before-0087.dump`，11,382,721字节，SHA256 `ed966ecfd3571b7d9c9d21f7ece22c51f6a93deef24bcda01d091540e031a9a7`，签名/归档列表通过，完整恢复未做。原SSH、隧道、端点、供应商/凭据/权限和生产边界保持。foundation420路径均存在，62项partial及原verification历史性质保留，不宣称干净克隆/独立全量安装通过。

功能只选择31路径：27完整文件、4共享文档仅KB-4段落/当前路由行；交接另一次提交。原50项修改中，45项原哈希不变，四共享文档原无关正文保留；`miniprogram/utils/api.js`在运行期间较起始哈希变化，本轮未编辑/暂存或覆盖，保持当前内容。原5项删除、用户roadmap/知识计划、其他未跟踪内容均保留。检查见preservation-check.json、staging-review.json及baseline-*。没有全量add、reset、clean、stash或强推。

## 下一接续

用户持续推进授权有效，无需等待人工截图、A10或确认。下一轮先读本文件、最新双语知识计划/路线图及当前合同，依据实际材料/容量需要选择KB-4剩余格式/影子/规模工作；没有新增材料触发时，按总路线图3.1接P3B/P4A的跨天同事项、取消/恢复及既有P5接续缺口，复用已有实现，不自造KB-5、不重做已交付P5。新/冲突设计及生产部署仍需原明确授权；不新增供应商、凭据、外发范围或真实客户导入。
