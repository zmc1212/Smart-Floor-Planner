# 小客交接：KB-1专业条目、适用条件与检索诊断

当前分支：`codex/xiaok-public-site-lifecycle`。功能提交：`a0c205bc624d93c1cd977f08f99eea8666fdb8f9`，已普通推送；上一轮`4082aabf`/`62d06136`保留。本文件另作交接提交，最终HEAD和远端一致性见最终回复及`tmp/xiaok-kb1/git-final.json`。未合并main、未部署、未强推。KB-1限定条目/诊断闭环已交付；完整企业知识服务、专业客服、P5及全PPT仍为 **Limited**。

## 本轮实际交付

按最新双语整合路线图和知识库专项KB-1，沿原后台`/assistant-knowledge`、正文/FAQ与C01接通专业类型、主题/同义表达、适用条件、前置/例外、原出处版本/章节和内部审校留痕。审校操作者/时间由服务端生成，元数据随不可变版本/hash发布；私有审校备注不进Embedding文本/模型工具包/客户来源投影。旧无元数据条目的hash/索引兼容。复制、编辑、索引、发布与共享反馈沿现有工作流；未来生效稿不能提前切掉有效旧版。

0085在原`assistant_knowledge_versions`加可空professional、形状约束与发布后不可变触发器，无新业务表/角色/菜单。两开发库均已应用，SQL hash为`5392f4d42a4bd5fe3a92f7597e63a496fda27f2faf6c486e609d94d8ea17964e`；应用角色非superuser/non-BYPASSRLS、原表强制RLS通过。仅0085用.gitattributes固定LF，工作区/索引/已应用hash相同，不重写历史迁移。迁移前备份`tmp/xiaok-kb1/development-before-0085.dump`为8697974字节，PGDMP/目录校验通过，SHA256 `6430d039ead8f811af30c821761c64fc3235c6fe8f84ea55449ff58cd9c0ca5d`；完整0085恢复演练未验证。SSH/隧道/端点/凭据、现有模型和生产边界未改变。

同一`retrieveKnowledge`给Agent、保守试问与诊断提供硬授权后的实际候选、来源版本/hash及`applicable/unknown/not_applicable`结果。只自动核对绑定房屋唯一获权活动项目的实际阶段，复用施工服务的项目/节点resolver；房间、型号/材料、城市未自动核实，不从模型/提问造事实。明确不适用可解释原因，不能当项目执行依据；前置检查/例外仍须核实。登记的同一规则主题出现互斥口径且适用范围可能重叠时，先待核实、保留两份引用，不按上传时间/相似度择一；不是自由文本全自动矛盾检测。

新增`GET /api/assistant/preview/runs/:id/diagnostics`，原试问旁的诊断Drawer回读实际问题、profile/配置、候选各路名次/融合次序、检索入选与实际模型上下文/截取字符数、条件缺项/不适用、合法排除计数、执行状态和可用查询Embedding用量。费用未知保持null。只读本人知识试问，当前知识管理者三角色继承、选定企业、固定草稿、epoch/来源/profile/有效期/受众及身份实时重验；失效后不回传旧标题/正文。没有客户调试入口、任意模型过滤器、第二套任务/权限库或知识缺口运营队列。Admin保守摘录与C01生成式解释共享检索/授权，不把两者生成风格混为实模验收。

原LangGraph及`xiaok-renovation-v26`组合企业依据、本人原话、正式v4主户型、真实阶段与已发布记录；一般建议、事实与待核实分开。保持原项目/参与者/同意/原件/版本、用量、租约、未知外部调用与人工接管边界。专业说明不自动建施工事项、批准、通知、验收或关闭。公开规则不要求先建项目；有实际房屋时不混入其他房屋/客户。逐项当前合同、API/模型/权限及上游参考采用决定见[二期KB-1合同](./xiaok-assistant-phase-2.zh-CN.md)。

## PPT映射及真实数据口径

原PPT为`docs/装修施工标准手册制度规范/家客来小K装修服务功能方案.pptx`，SHA256 `9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4`。实际核对6/15的先回应与生活语言/追问，18的实际阶段及施工检查安排，19的铺贴前材料沟通，23的底盒/需求/图纸关联，38的缺失/不一致先核实。办公、铺砖前提、地暖材料及互斥规则题是本批合成派生题，不声称PPT原文规定这些专业做法，也不是完整PPT19审美沟通/全PPT验收。

模型、Embedding、localhost:3006 HTTP、现有Worker和批准开发库调用真实；企业、用户、专业条目、工地、v4墙图、记录与照片为明确合成夹具。照片为合成JPEG，当前问答没有图像像素，不声称看图或真实规范级工程认证。后台HTTP最终夹具企业2438/管理者5022，使用内存中临时签名身份，不写凭据；已停用测试管理者/企业助手。核心及原生账号已禁用、用户context_version失效，active_staff=0、active_runs=0；带标记数据保留审计。

| 用途 | 企业 | 用户 | 档案 / 工地 | 正式墙图 | 原咨询 | 现场记录 | 节点 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 最终实模核心 | 2436 | 3289 | 2910 / 52 | 485 | 219 | 65 | utilities |
| 最终实模核心 | 2436 | 3290 | 2911 / 53 | 486 | 221 | 66 | waterproofing |
| 最终原生 | 2437 | 3291 | 2912 / 54 | 487 | 223 | 67 | utilities |
| 原生备用（未问答） | 2437 | 3292 | 2913 / 55 | 488 | 225 | 68 | waterproofing |

条目/版本/查询/原话/精确sourceRef/hash/模型输出和用量均在`live.json`、`native-driver.json`与`admin-http.json`，不把模型推测或合成资料写成真实客户业务事实。

## 最终验证

| 检查 | 实际结果与边界 |
| --- | --- |
| 固定实模核心 | 最终v26 **14/14**：办公2、连续追问2、两个实际阶段各2、材料条件2、互斥规则2、缺点位图2；run 259、261、263、265、266、267、268、269、270、271、272、273、274、275。每题必要版本均实际召回并引用，冲突题双方均引用。确定性断言＋Codex核对实际正文/来源，不是模型自评或全领域准确率 |
| 真实调用与用量 | 核心28次模型调用，observed input 161722/output 9630 tokens；费用未知null。完整回答35.306–59.226秒。原生、后台、现场草稿与v25失败尝试另计，不混入核心；没有捏造P50/P95 |
| 最终原生 | v26 **9/9**，额外真实模型run 262/264；真实输入/引用片/重进/知识撤回使两条派生回答失效。Stable2.02.2608080、automator0.13.0、SDK3.17.2、副屏唯一窗口、重新编译、逻辑390×844/PNG348×752。已目视气泡/引用片/失效捕获；临时传输/身份/存储恢复 |
| 后台真实HTTP | **9/9**：专业条目保存/非法字段拒绝、真实索引发布/回读、配置模型试问、诊断实际候选与上下文、原出处、发布不可改、受众收紧后的旧诊断/引用/回答失效、普通员工403。管理者三角色/其他管理员/跨租户另由隔离服务回归覆盖；这不是Chrome视觉验收 |
| 新服务与纯单元 | 隔离55432/xiaok_embedding_eval、真实事务/Embedding/索引/检索＋确定性模型 **12/12**（8数据库＋4纯）；原键恢复/服务端审校、发布不可改、三管理角色、阶段匹配与变化失效、未来替换保护、预览隔离、外部I/O后撤回、活动阶段删除保护均覆盖。纯单元 **10/10**，包含上述4专业单元和5综合解析单元，不重复累加 |
| 相关回归 | 知识/试问/平台权限 **27通过/4配置跳过**；综合问答 **15/15**（10真实隔离数据库＋5解析）；Mini助手8文件 **73/73**；Admin客户端/基础合同 **9/9** |
| 静态与构建 | 最终全量lint **0错误/30既有警告**，最后局部字段/多行审校验证零错误。类型仍失败，当前**287条历史诊断、0新增**；基线292中5条.next/types生成路由诊断随构建缓存重生成消失，不是源问题修复。最终Webpack编译通过，build仍首先卡在既有`scripts/construction-public-c05-acceptance.ts:129`字符串/UUID类型问题。旧AiDesigner非法导出来源未修复，独立Mini打包3失败、量房Phase0旧失败未重验/未清除 |
| 文档/依赖/Git | 双语Admin/Mini清单、二期合同、Admin路由记录及唯一chat台账更新。376个基础manifest路径和61个partial＋1个额外partial入口存在；未声明干净克隆全通过。git diff --check及选择性暂存审计通过，43个相关文件提交；原82项非共享脏内容及4份文档的既有其他改动、5项删除和最新双语计划均保留 |

### 失败保留与精度限制

v25核心13/14，最后run254的否定句“不能据此认定位置已定或已验收”被正式操作守卫拦截，未外发。没有放宽守卫/断言；v26要求用“当前资料不能支持该结论/仍需核对验收资料”等表达，再完整执行14题和原生9步。v25原生9/9仅为旧版本证据，不冒充最终结果；见`tmp/xiaok-kb1/v25/`。

最终run272中“共同支持”用语归因偏宽：采光/眩光/通道解释主要来自办公条目，两条真正共有的是团队核实前置。双方互斥口径和来源仍保留、首段待核实且未择一，符合本批固定冲突判据；但逐段引文归因精度仍 **Limited**，已在`semantic-review.json`明确记录，不把固定14题通过表述为每段语义完全精准。完整条件抽取、未登记语义冲突、房间映射和自由专业规范准确性仍待增强，不追加全领域评测作为本批进度门槛。

首轮服务测试的Drizzle cause断言、测试器序列化BigInt错误、试图删除在用节点而被施工服务正确拒绝，以及context-mode宿主Bun误作Node测试器，均留存独立失败日志；修复测试器后使用D:/nodejs/node.exe及真实服务重跑通过，没有放宽来源/同意/节点保护。迁移前归档首次通过SSH stdin校验遇到EOF，已核实当时未执行迁移，改用SCP归档校验后才应用0085；证据保留。

## 复跑入口与剩余范围

从admin运行：

- `node scripts/assistant-professional-acceptance.mjs`；`--unit`、`--regression`、`--synthesis-regression`分组执行。隔离库共享advisory锁，不能并跑互抢夹具；模型为确定性注入，Embedding/数据库真实。
- `node --import tsx scripts/assistant-professional-admin-acceptance.ts --development`：后台真实HTTP/Worker/模型。
- `node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development --professional`：最终固定核心；加`--native`沿既有Stable流程。判据在`assistant-synthesis-cases.ts`/`assistant-professional-cases.ts`，不为通过而放宽断言。
- `node scripts/assistant-professional-migration-check.mjs`：两开发库hash/非BYPASS应用角色/强制RLS；不要重复执行tmp迁移脚本或改写已应用SQL。

主要证据`tmp/xiaok-kb1/`：`evidence-summary.json`、`semantic-review.json`、`native-semantic-review.json`、`live.json`、`native-driver.json`、`native.json`、`native-*.png`、`admin-http.json`、`service.log`、`unit.log`、`knowledge-regression.log`、`synthesis-regression.log`、`mini-all.log`、`client-contracts.log`、`lint-final.log`、`tsc-comparison.json`、`build-final.log`、`migration.json`、`staging-audit.json`及最终Git核对。tmp/凭据不提交。

认证态后台视觉目标`http://localhost:3006/assistant-knowledge`仍未验证：没有可调用Chrome连接器，现有正常Chrome无CDP端点；已完成进程/端口核对，未重启或替换用户浏览器。这是未验证项，不是自动审批拒绝；API/服务/原生独立工作已完成。完整宿主胶囊/光学/高屏/键盘、真机/真实微信授权/BLE、真实Worker进程重启、完整0085恢复、文件/OCR/CAD/PDF页表及生产未验证，不转成人工手测或截图门槛。

下一步按专项继续 **KB-2企业资料入库与结构引用**：沿原私有媒体/版本/索引Job做首批DOCX/可提取文字PDF的上传、核对、结构引用与C01回读，不先做全格式/OCR。已只读盘点现有混合开发目录141项：30 PDF、5 DOCX、14 XLSX、2 XLS及其他图片/PPT/产品材料；没有通用解析依赖，见`kb2-preflight.json`。这个盘点不是解析或整目录入库授权，下一批先固定合成文件、允许格式/资源界限/实际定位与失败恢复。逐段来源归因、真实材料条件和必要父上下文随KB-3定向增强，不另建项目事实库；保持同一模型接入和硬授权，不等待用户手动“继续”。
