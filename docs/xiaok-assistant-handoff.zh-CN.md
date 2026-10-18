# 小客交接：KB-3 实况综合检索限定闭环，接续 KB-4

2026-10-18，本批按用户最新双语企业知识计划完成KB-3限定实现与对应固定场景自动验收，**完整专业客服、P5和全PPT仍Limited，不是发布就绪或生产批准**。分支`codex/xiaok-public-site-lifecycle`；功能提交`034c26ba5d4d14d01dee77d8b7f8f3f72e46fb68`，交接单独提交，最终HEAD/上游/远端核验见`tmp/xiaok-kb3/git-final.json`。未合并main、强推或部署。上一轮KB-2功能`0c519236`、交接`a1b47404`保留；用户最新双语roadmap及企业知识计划仍保留在工作区、未纳入本批提交。

## 本批行为与依据

- 先核实AGENTS/管理员嵌套指令、原模块/合同、双语最新计划、依赖及原PPT。PPT SHA256 `9221a83057fb1b2aa691ecde6cf60a0aa2dfb0d352aad4b6eab2cb6f15209af4`；17/18实际节点及检查安排、19铺贴前沟通、23底盒/需求/图纸、38缺失/冲突交团队核实，6/15自然追问。书房摆放、水电/防水政策都是明确合成验收资料，**不是PPT原文中的工程标准**。QA04/XK03本批仅原话、文字记录及正式主v4墙图片段，不宣称识图或完整点位图匹配。
- 原共享`retrieveKnowledge`升级`professional-hybrid-v3`：硬授权/相关度之后、5片上限之前优先当前适用或未知条件、将明确不适用后移，首轮每文档最多2片再补齐。原1024维Embedding、每路30候选、RRF60、相似度0.3与最终5片保持；诊断增加selectionRank，未降低门槛、安装外部重排或另建索引/事实库。
- v37实模暴露模型词遗漏“书房”，必需来源相似度0.297而缺失；同夹具/真实Embedding探针保留原问题后0.378。v38将服务端本次原问题和模型检索词合成一次有界查询（600/1000 UTF-16长度，不拆Unicode字符），不增加Embedding调用，不把提问当项目事实/权限。原后台试问继续直接使用原问题、共享相同检索实现。
- `agent/bound-context.ts`复用原业务适配器，同轮持久刷新本咨询材料和实际施工节点。短追问仅查知识也能带入当前节点。`synthesis.bound_construction.v1`沿原run/短事务/租约/恢复；恢复先重验旧检查点，已供模型的来源变化即context_changed。阶段、需求、v4主户型、已发布记录、权限/版本/epoch在继续生成、提交、历史、引用及人工接续中继续重验。
- prompt`xiaok-renovation-v38`区分企业依据、本人事实、通用建议和未知；现场记录仅限房间/对象/版本当时范围，阶段不等于检查结果，缺记录不证明现实未检查/其他部位不能检查。正式费用、工期、验收、批准与人工边界不变，不自动建处理事项。
- 原逐字引文守卫保持，工具增加有界原文复制提示。原一次格式修复扩展到已知获权的普通知识/现场引用，并提供同源copyExactQuote；只允许final_response、原轮数/截止/用量，结果与修复次数持久化。未知来源、正式承诺、无文件数值错误、来源变化及未知调用不修复；不是自动改原文或放宽引用。
- 发布回归查到数据库比应用快约5.4秒；替换版本的effective_from就绪检查改为数据库now，与检索一致，真正未来替换仍拒绝。显式模拟应用钟落后的定向及整组回归通过，无迁移或已应用SQL改写。
- 维护中Dify检索节点、Haystack过滤测试、LangGraph工具/恢复测试的原始链接和采用决定在[双语二期合同](./xiaok-assistant-phase-2.zh-CN.md)。保留现有框架与服务，未新建凭据、扩大授权或向新外部服务传资料。

## 最终验收与证据

主证据`tmp/xiaok-kb3/acceptance-summary.json`、`semantic-review.json`、`native-driver.json`、`native.json`与对应日志。实模使用现有DeepSeek/deepseek-flash、既有Qwen Embedding、已批准开发库5432、真实localhost:3006 HTTP及既有Worker；工程测试的模型为确定性注入，两者分别登记。全部本批资料和项目是合成样例，不是客户业务资料。

| 执行检查 | 最终结果 |
| --- | --- |
| 配置实模固定主线 | 12/12；run 349,351,353,354,355,356,357,358,359,360,361,362。办公/追问/水电/防水/缺点位图各两轮，再对同一项目真实推进到防水后同题两轮；逐条独立阅读持久回答和来源，必要来源均真实引用，非只看脚本passed |
| Stable原生 | 10/10功能检查，真实模型run 350,352；同项目水电→防水同题、引用面板、历史重进、阶段失效、来源撤回；不是静态页面或模拟响应 |
| 单元 | 18/18；context-selection/synthesis/source-file兼容，unit.log |
| 隔离服务核心 | 21/21；真实隔离数据库/Embedding，确定性模型，含阶段刷新/在途变化/跨客户与租户/撤回/接管/一次修复；service.log |
| 修复定向 / 发布时钟定向 | 各1/1；repair.log、version.log，已包含在相关整组，不额外叠加总数 |
| 知识/文件/回答/平台回归 | 35通过/4显式跳过/0失败；regression.log。最初时钟失败单独保留，不混为通过 |
| 既有Agent/材料回归 | 18通过/8显式跳过/0失败；synthesis.log。跳过的实模不计通过，本批另跑真实配置 |
| Mini助手专项 | 73/73，mini.log；不是全量Mini测试 |
| Lint / 类型 | lint0错误/30既有警告；同范围source-only363→363，新增0/移除0，生成Next声明双方排除；不是全量tsc通过 |

最终v38主线24次模型调用、观测token 186469，查询Embedding 12次/输入token 852；原生4次模型调用、token 32226，Embedding 2次/输入token 135。本次最终0次受限引用修复；此前失败尝试另记。计量只涵盖审计的问答run，**不包括夹具现场草稿生成、入库索引和诊断探针**；费用未知为null，不编零费用/成功率/P50/P95。逐轮耗时见summary，不把原生input/tap的feedbackMs当首token延迟。

最终主线夹具企业2458/owner5042，原生企业2459/owner5043；项目/客户/文档版本及精确run映射见summary。两个脚本finally均关闭合成开关和账号、提升客户context_version，active_staff/active_runs均0；没有预约、正式处理/批准等处理副作用。原生内存会话/传输已恢复，transport.active=false，回原首页并断开。

原生沿用唯一既有Stable2.02.2608080窗口、automator0.13.0/base3.17.2，核对项目和副屏位置，不新开窗口。逻辑390×844/PNG348×752；4张当前capture已查看，native-visual-review.json登记。灰绿矩形是40×32合成JPEG `#b9c4b4`，不是真实照片/质量结论，本轮未向模型提供照片像素。C01设计源仍为`design-references/xiaok-p4b-public-sites-v1/README.md`继承的C01/C02/C05/U01；WXML/Less/字号/素材/导航未改，不宣称新一轮高保真还原。双语唯一chat台账保留单路由/单当前来源。

## 失败历史与明确限制

- v33引用嵌套、v34原话/引文改写被严格拒绝；v35虽12轮服务/来源断言通过，run323语义把书房底盒待核对扩大成基层/防水检查“无从谈起”，**语义验收未通过**，不列为最终成功。v36唯一修复后仍改写句号而失败，v37缺必需办公来源而失败。`live-v33-citation-failure.json`、`live-v34-missing-citation-failure.json`、`live-v35-semantic-boundary-failure.json`、`semantic-review-v35.json`、`live-v36-attempt-failure.json`、`live-v37-required-source-failure.json`、`query-anchor-probe.json`保留。v38按原固定核心复验，不靠降低门槛或把拒答算正向成功。
- 首次普通沙箱原生枚举0窗口，未交互；提权只读核实唯一副屏窗口后沿用已批准自动化完成。初始失败保留v34-sandbox-*；无新人工验收门槛。
- 回答仍有冗长、可选下一步提议；Codex对小样本逐条对照证据，不是人类验收或通用自动语义判定器。任意语义归因、跨语言召回、复杂PDF/OCR/XLSX/旧格式、完整点位/照片理解尚未验证或Limited，不新增为本批门槛。
- 全量构建既有AiDesignerLegacyPage非法命名导出/类型阻碍保持；本批未改路由/schema，未重跑全量构建。source-only对比不替代构建。认证后台Chrome视觉、全宿主窗口/光学/高屏/键盘、真机/真实微信/BLE、真实Worker进程重启与完整恢复演练仍未验证，开发非阻塞，不要求用户手工补验，不把旧pending写成通过。

## 复跑、依赖与工作区

在admin运行`node scripts/assistant-context-acceptance.mjs`，可选`--unit/--regression/--synthesis/--repair/--version/--mini/--lint`。隔离模式使用已有`tmp/xiaok-vector/connection.private.json`与套件锁，目标55432/xiaok_embedding_eval，非superuser/非BYPASSRLS。实模：`node --import tsx scripts/assistant-synthesis-development-acceptance.ts --development --context`；另加`--native`使用同一已验证Stable流程，必须从能读取真实桌面窗口的授权执行环境运行。连接配置/令牌不入Git，不重建凭据或替换用户窗口。

依赖只读核实PG17.10/vector0.8.2/1024维及23张相关表强制RLS，dependencies.json。foundation manifest409路径均存在、62项partial继续登记，原verification为历史记录；本批不宣称干净克隆/完整独立安装通过。0086 SQL SHA256 `659952be208cbc701c4a4ce1df14e10b1fae2cc182b4252f7d132f2e008c545f`未改，仅既有开发主库/隔离库应用。上轮备份`tmp/xiaok-kb2/development-before-0086.dump`为9,280,708字节，SHA256 `cceb87c22b0479696e05276e2d167099eb248c10844be472311ecd3e3f45ff72`；新的完整恢复演练未做。原文件4MB/企业100份100MB/PDF50页/128片/512token等限制保持。

仅选择性提交本批27路径（25完整文件，两份共享Mini清单仅KB-3段落），交接另一次提交。48个原已修改文件哈希未变，5项原删除保持；两份共享Mini清单的原pending diff正文完全保留（不声称其原文件完整字节重建hash匹配）。用户roadmap/知识计划、其他原修改和未跟踪项未覆盖/全量暂存；staging-review.json、baseline-*可核查。没有reset、clean、stash、全量add或强推。

## 下一接续

按用户最新双语企业知识专项计划继续**KB-4运营与规模扩展**：可复跑问题集、知识缺口/修订回归、用量/索引健康，按真实材料需求再扩扫描/复杂表格/旧格式及影子重建。先复核当前实现和K-05/06/10/11，不自造阶段，不把全格式/OCR或额外语言长尾测评设为已交付批次门槛。已有诊断覆盖说明里若仍有manual-only旧文案，先映射真实文件能力与原批准Admin设计再修正；每批继续原后台操作、C01真实写入/可见反馈/重进、权限/失败与自动化，避免后端单交付。

用户持续开发授权有效，无需等待手工截图、A10或确认。新/冲突设计与生产部署继续遵守既有明确授权边界；不改SSH/隧道/端点/凭据或扩大对外资料范围。接续先读取本文件、最新双语计划、模块合同和依赖，再用真实问题选择必要改动。
