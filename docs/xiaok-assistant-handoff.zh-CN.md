# 小客交接：KB-2 文件入库与结构引用限定闭环

当前分支 `codex/xiaok-public-site-lifecycle`。功能提交 `0c519236` 已普通推送 GitHub；本文件另作交接提交，最终 HEAD/上游/远端一致性见最终回复及 `tmp/xiaok-kb2/git-final.json`。未合并 main、未部署、未强推。KB-2 本批 DOCX/文字 PDF 入库、结构引用与 C01 闭环已交付；完整企业知识平台、专业客服、P5 和全 PPT 仍为 **Limited**。用户持续开发授权保持有效，下一轮从本节点继续，无需等待人工截图或“继续”。

## 本批实现及设计来源

原 /assistant-knowledge 接入私有不可变原件、文件 hash/版本、原持久任务 knowledge_parse、结构与警告核对、索引/发布/换版、原件下载、失败/重试/取消与重进。DOCX 保留章节/正文段落/表行列与合并跨度、表头/单位/相邻条件/脚注；不伪造 DOCX 页码。文字 PDF 使用本地 CMap/字体，保留实际页码；图片、扫描 OCR 和 PDF 表格结构没有实现。模型生成或手填正文不能覆盖原件；修订通过有出处的新文件。

沿用现有 PostgreSQL/pgvector、LangGraph、Job/租约、授权/受众、源版本/epoch/profile、用量和人工接管边界。admin、super_admin 选择企业后继承管理权，无需成为员工；普通员工/异租户无上传或原件读取权。默认内部文件、未核对草稿不进入客户检索。项目事实继续来自获权现有适配器，不复制到企业规则或第二套项目事实库。换版/收紧/撤回令旧引文及依赖回答失效。

C01 仍为同一个咨询及来源片，仅在原 .sheet-helper（26rpx/1.6）增加文件名及原段/表行列/PDF 页；原来源标题30rpx、引文28rpx/24rpx内距、样式/素材/导航未改。设计源仍为唯一 chat 台账中的 design-references/xiaok-p4b-public-sites-v1/README.md，继承 C01/C02/C05/U01。原生四张截图已看，定位正常换行，表头、单位、条件、注释保留；这不是全量视觉还原验收。双语 Admin/Mini 清单、二期合同、Admin 路由记录、唯一 chat 台账及基础 manifest 均已核对代码同步。

原 PPT：docs/装修施工标准手册制度规范/家客来小K装修服务功能方案.pptx，SHA256 9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4。本批映射6/15连续回应与追问、18实际节点和检查安排、19材料前提沟通、23资料关联及38缺失/不一致先核实。TEST-A/2 mm 是明确标记的合成引用定位值，不是 PPT 原文或真实施工标准；未将整个混合开发资料目录入库。

## 最终执行结果

以下均使用明确标识的合成企业、用户、项目和 DOCX/PDF，无真实客户原件；真实模型与确定性测试分开记录。

| 检查 | 最终结果与证据（tmp/xiaok-kb2/） |
| --- | --- |
| 解析/引用/有界修复单元 | **6/6**：DOCX 合并表头/脚注/Unicode、重复引文歧义、中英 PDF/CMap/无文字页、格式/ZIP/XML 损坏、明确否定与肯定守卫、一次修复及断点恢复；unit.log |
| 文件服务 | **8/8**：真实隔离数据库/Embedding＋确定性模型，覆盖上传原键/原件/重进、核对索引、表头条件定位、解析失败重试取消、失败换版保留旧发布、三管理角色/异租户/内部文件、真实本地解析中撤回晚到提交、历史来源撤回；service.log |
| 现有 Agent 运行时 | **8/8**：已知结果恢复、工具重放授权、未知外部调用不重发、轮数/传输守卫；agent-runtime.log |
| 知识/答案/专业/平台回归 | **35通过、4配置跳过、0失败**；regression.log |
| 综合回答回归 | **15/15**（10项真实隔离数据库、5项纯测）；synthesis.log |
| 小程序助手 | **73/73**（8个现有助手测试文件）；mini.log，未声称全 Mini 套件通过 |
| 当前真实配置模型/HTTP/Worker | **6/6**：合成 DOCX 材料/地暖例外、正式状态追问、中文文字 PDF 检查安排＋当前获权防水节点，各两轮；runs286–291。使用原配置 deepseek-flash，真实开发库与真实既有 Embedding；live.json、semantic-review-input.json、semantic-review.json。逐条检查原句及实际项目来源；其中 run286 经一次受限修复后通过，不是首次模型响应全对 |
| 原生 Stable 自动化 | **9/9**：唯一既有副屏 Stable2.02.2608080、automator0.13.0、基础库3.17.2，重新编译后核对 SDK/数据/元素；实际输入、表1第3行引文、持久重进、追问、撤回。逻辑390×844与PNG348×752分别记录；额外真实模型 runs292–293 均通过，无引用修复。native.json、native-driver.json、native-visual-review.json、native-{office,citation,followup,withdrawn}.png |
| Lint/类型/构建 | 全量 ESLint **0错误/30警告**。同范围 source-only 类型诊断 **363→363，新增0/减少0**，两侧均排除 Next 生成声明并保留其他用户文件；不能冒充全量 tsc 通过。最终隔离 Webpack 编译31.6s成功，后续类型检查仍被历史 AiDesignerLegacyPage 非法命名导出阻断；lint.log、type-comparison.json、build-final.log。默认 tsc 也有既有生成声明问题；未修复旧 Mini 打包/量房基线问题 |
| 文档/依赖/差异 | manifest394个基础路径、62个partial及原额外partial均存在，未宣称独立安装/干净克隆全通过。选择性提交48路径，6共享脏文件只纳入本批增量，git diff --cached --check通过，无无关暂存或删除 |

固定核心6次服务耗时分别36322/21461/20567/24866/26347/25137ms；run用量记录13次模型调用、77349 observed tokens及5次query embedding/195 tokens。原生另5次模型调用、28917 tokens及2次query embedding/67 tokens，服务耗时26275/37390ms。上述不含导入分块总量，cost_micros=null，没有成本或整体P50/P95结论。

核心开发夹具：企业2446、管理者5030、用户3300、项目63、咨询234、文件文档75/76；原生夹具企业2448、管理者5032、用户3302、项目65、咨询236、文档79/80。结束后均停用助手/管理账户、推进客户context_version，active_staff=0/active_runs=0；保留合成记录用于审计，不混入真实客户验收。原生传输/存储/API/应用会话钩子已恢复，token只在内存，返回原首页并断开自动化连接。

## 真实模型问题、修复及保留限制

当前 prompt xiaok-renovation-v32。短文件工具给出逐字有界 citationQuote，模型每段数字仍需由该段引文支持。仅规范化模型说明中的缺省 advice/uncertainty 空引用，以及“当前资料不支持‘已经验收’这个结论”这一窄否定句；原 quote 不改，肯定式或混入正式完成/价格承诺仍拒绝。

已核对现有 LangGraph1.5.0、维护中的 ToolNode/测试及 DeepSeek 标准 function calling，决定继续使用原图。只有已明确返回、当前授权文件的引文/数值支持错误可在原图内修复一次；原4轮总预算/截止时间/租约/用量不变，修复轮禁用业务工具、只能 final_response，仍作完整验证。validationRepairs随原checkpoint持久化，原模型与校验步骤可审计。未知调度、权限或来源变化、真正正式状态/价格承诺不重发/不修复。详见双语二期合同的引用与采用记录。

早期失败日志保留：上传驱动字段错误返回422；v27/v28分段数值引用不完整被拦；v29/v30否定句被完成词守卫拦；v31英文PDF在中文问题中未召回（run284必要PDF断言失败）；改用本批代表性中文文字PDF后，v31一次仍缺分段数字引文（run285），随后实现有界修复。未将这些失败计入最终通过。英文页解析单元通过不等于跨语言召回通过。run291“非客户自行组织”由原件“团队安排”推断而来，不能称为原文中的明确禁止。任意段落语义归因、工程级正确性及跨语召回仍有限。

初次原生命令在沙箱内看不到桌面窗口，未操作页面即失败；保留 native-sandbox-window-failure.json。获准读取桌面并确认唯一原窗口/副屏边界后，以同一项目和同一流程完整复跑通过；未新开 DevTools/替换窗口。认证态后台 Chrome 连接器不可调用，/assistant-knowledge视觉仍未验证，不转成用户必须截图或手测。

## 数据库及资源边界

0086_assistant_source_files 已应用到已批准开发主库和55432隔离库，两库迁移hash/字段/强制RLS及应用角色非superuser/非BYPASSRLS核对通过。SQL SHA256 659952be208cbc701c4a4ce1df14e10b1fae2cc182b4252f7d132f2e008c545f，**不得改写已应用SQL**。主库迁移前备份 tmp/xiaok-kb2/development-before-0086.dump，9,280,708字节、PGDMP/归档目录已验，SHA256 cceb87c22b0479696e05276e2d167099eb248c10844be472311ecd3e3f45ff72。初次保留字authorization导致SQL失败，已确认事务回滚/无新表/仍0085，改usage_rights后应用成功；原失败日志保留。完整0086恢复演练未做。

解析依赖固定 pdfjs-dist6.4.299/yauzl3.4.0/saxes6.0.0，Node≥22.13，Docker源文件改24；原共享canvas1.0.7保留，新可选canvas在PDF.js下隔离。新增依赖公共registry漏洞查询200/无条目，整个依赖树npm报告50项，未声称全树安全或已修复。未构建/部署生产镜像，也未向新外部解析/OCR服务发送文件。限制：文件4MB、企业100份/100MB、PDF50页、128片、DOCX64行/12列、正文16000字符/48000字节、每原片连同原上下文≤512token；192MB V8堆/20秒子进程不是整个OS进程RSS限额。复杂PDF/OCR/图片/XLSX/旧格式、完整恢复、真实Worker进程重启、宿主完整窗口/光学校准/高屏/键盘、真机/真实微信/BLE和生产验收仍未验证/非开发推进门槛。

## 复跑、工作区与下一轮

从admin：`node scripts/assistant-source-file-acceptance.mjs`；分组 `--unit`、`--regression`、`--synthesis`、`--mini`、`--lint`。原生/实模：`node --import tsx scripts/assistant-source-file-development.ts --development`，加`--native`走已验证Stable流程；迁移只读核对 `node scripts/assistant-source-file-migration-check.mjs`。`--types`保留全量未通过事实，同范围类型对比脚本与隔离构建helper在tmp内；构建不改dev .next，exit恢复tsconfig/next-env，本批后tsconfig无diff。不可因缺数据只测空页，不使用真实客户资料替代合成夹具。

实施前原86项无关逻辑工作区、5项删除与最新双语整合/企业知识计划保留。baseline-status.txt记录97个展开路径，baseline.diff存原已跟踪差异；49个非共享已跟踪差异逐份相等、原未跟踪路径均存在。共享admin/package.json、next.config和双语Mini清单/Admin重构文档仅提交本批增量；未全量add/reset/clean/stash。两份最新roadmap与企业知识计划未暂存。manifest只把next.config的parser追踪加入partial，不把用户其他配置纳入基础。

下一轮按最新[企业知识计划](./xiaok-enterprise-knowledge-plan.zh-CN.md)及其[英文镜像](./xiaok-enterprise-knowledge-plan.md)继续 **KB-3实况综合检索**：从已验证KB-1/2的问题/现有检索诊断出发，选择实际需要的父子上下文、术语、重排或有限补检，与当前获权节点/需求/图纸组合，验证同题不同阶段有据变化；不预先安装整套平台、不新建项目事实库，不把全格式/OCR或额外长尾语言评测设为前置。先核对当前源码、双语roadmap/整合计划、PPT与依赖清单，再做完整逻辑阶段/自动化/双语文档、选择性提交和普通推送。继续保留原租户/授权/来源撤回/用量/接管；新或冲突视觉遵守明确批准门槛，生产部署仍需既有授权。
