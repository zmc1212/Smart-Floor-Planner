# 小K助手阶段接力记录

**本轮收尾后暂停。** 用户最新要求是“目前对话完成后先暂停，等我通知再继续”。父对话不得自动新建下一阶段。下列入口只供用户明确继续之后使用。

## 当前交付：C05具体版本决定、原键回执及来源撤回闭环

限定修复Implemented，P4B整体仍Limited。沿用C01/C05同聊卡及U01，未改WXML、Less、图片、导航、API路径、模型/迁移或Agent架构；不扩大角色、租户或来源权限，不合并、不部署。

1. 客户端只接受匹配原动作/工地/不可变版本/预期revision+1/动作结果状态的回执；preview还须包含同版本/revision的完整材料。缺失或错配保留原path/action/body/Idempotency-Key，不假报成功。修复前新增14项回归均失败，修复后通过。
2. 服务端在返回preview/approve幂等记录之前重验当前材料来源及项目/客户访问。已复现旧记录能在来源撤回后返还旧材料和旧批准回执；现已阻止。来源失效时仍可核对拒绝/撤回，避免妨碍撤回。源失效回执通过既有U01清卡、展开状态与媒体路径。
3. 业主查看/稍后/同意/拒绝/撤回、实际服务写入、重进、原回包丢失后核对、审核发布、新版本不继承同意、本人/访客/其他线索及切身份后的迟到回执均有自动验证。来源撤销补测还核对恢复原身份后先核对原操作，再进入新版本；不以旧键执行新动作。

## 本批检查与限制

| 检查 | 实际结果 |
| --- | --- |
| 小程序定向：回执/公开/聊天/生命周期/包装 | 63/63通过 |
| 真实开发HTTP7步 | 7/7，最终服务修复后重新运行通过 |
| 最终C05原生 | 12/12，最终原生真实写入/重进/错误恢复通过 |
| 最终施工全量，包含来源撤回回执新回归 | 67项：64通过、3按原配置跳过、0失败；399.0秒 |
| 最终Admin全量ESLint | 0错误、30项既有警告 |
| 最终小程序全量 | 1967项：1966通过、1失败、0跳过；93.1秒 |
| 文档/路径/双语/唯一台账/暂存差异检查 | 已通过，见stage-validation.json；仅暂存10个相关路径 |

全量失败为既有test/survey-kernel-phase0-baseline.test.js:87调用审计：miniprogram/test/surveying-editor-autosave.test.js新增createSurveyDraft依赖未录入expected-audit.json。本批开始时两文件已经如此，前后SHA-256均一致；保留相关既有/并行量房改动，没有修改测试或伪造全量通过。此项仍是未解决的全仓检查失败。

未运行Admin生产构建、独立全仓tsc、付费真实模型评测或部署。本批未改路由/模型/构建契约；旧355处tsc诊断和历史模型结果不当作本批重新通过。完整宿主胶囊、光学、高屏、键盘、真实微信授权、真机/BLE和生产验收仍未验证、非开发手测门槛。

## 原生、测试数据与恢复

复用唯一副屏Stable2.02.2608080原项目窗口，精确projectpath为本仓库miniprogram，autoPort9424、官方SDK0.13.0、基础库3.17.2、逻辑390×844；每次控制均先新鲜编译。没有关闭/新开窗口或更改网络安全配置。模拟器PNG为348×752，截图前均核对顶部路由packages/assistant/chat/chat。宿主辅助捕获无法确认前台归属，未接受宿主图；后续跳过抢前台捕获，不把模拟器图当完整胶囊验收。

只使用已批准localhost:5432/smart_floor_planner的合成企业2404，核验prefix、虚构账号与业主/项目绑定，触及既有测试工地1/2/5（项目3/4/7，业主3193、访客3194、访客咨询121）。状态随运行变化，必须重读tmp/xiaok-vector/p4b-development-fixture.json及真实revision。原生传输仅在内存转向localhost测试路径，JWT和journal仅内存；结束恢复wx.request/downloadFile、存储方法与原身份，读回transportActiveAfterCleanup=false并返回首页。虚构操作账号最终禁用；来源补测临时收紧测试项目customer_access并恢复原true值，未扩大原权限范围。隔离55432/xiaok_embedding_eval的回归自行创建并清理标注合成数据，不写真实业务/生产。

repeatable commands：

- 在miniprogram：node --test test/public-owner-receipts.test.js test/assistant-public-sites.test.js test/assistant-chat.test.js test/public-sites-lifecycle.test.js test/project-packaging.test.js
- 在miniprogram：node --test --test-concurrency=4 test/*.test.js
- 在admin：node scripts/construction-acceptance.mjs；node node_modules/eslint/bin/eslint.js
- 在admin：node --import tsx scripts/construction-public-c05-acceptance.ts --development
- 原生加--native，依赖本机tmp/xiaok-vector/c05-batch/c05-native.cjs及既有SDK/CDP/window辅助文件，不是可脱离当前工作区的已发布测试包。先核验唯一项目/副屏/无占用；本批测试已结束，不要因本文自行操作窗口。

证据目录tmp/xiaok-vector/c05-batch/：receipts-before.log、receipts-focused.log、final-focused-mini.log、source-receipt-before.log、c05-http.json/.log、c05-native.json/.log及driver.json、final-checks-status.json、construction-final.log、construction-final-detail.log、mini-final.log、admin-lint-final.log、stage-validation.json。四个C05状态和来源失效的路由核对截图在同目录。attempt1-host-capture/保留宿主捕获失败，attempt2-business-passed/保留初次11步通过，attempt3-pending-order/保留测试未先核对旧操作而超时的诊断；均不覆盖最终结果。

设计源保持design-references/xiaok-p4b-public-sites-v1/README.md及其C05-01-owner-consent.png、继承的C01/C02/U01状态规则。双语清单、路线图3.9及两份还原台账的唯一chat路由行已同步；没有另立设计权威或声称完成光学校准。

## Git与工作区边界

开始HEAD为a8b95cd8eb8a74f8d1935ec8c07af8e44247f0a5，分支codex/xiaok-public-site-lifecycle，481条既有改动/未跟踪路径、暂存为空。.agents不存在、rg不可用。workspace-before.json与pre-edit/保留逐文件哈希/原文；非本批路径保持，特别是量房源/测试/基线。仅定向提交相关C05源、回归、开发验证脚本、交接和窄双语备注，不能全部提交工作区。

- 节点A：f2ac26ecd099280de0a050fc3d130ee71047b04c（fix: validate exact public consent receipts），已普通push并核验远端相同。
- 节点B：本交接所在的fix: revalidate consent receipts after source revocation提交；完整SHA及远端核验回执见tmp/xiaok-vector/c05-batch/git-final.json和git log -1。
- 最终远端核验：收尾执行普通push及GitHub API核验，结果写入tmp/xiaok-vector/c05-batch/git-final.json；无记录不得写成通过。
- main保持f273b57171d6dab5c3b8beef1fe124e634d51864。GitHub状态/检查/工作流API均核验，当前0条，不记CI通过。没有force push、合并或部署。

相关C05依赖原为未跟踪的前置P4B实现，本批只纳入必要文件。双语路线图/台账及模块清单的大量原P4B前置内容继续留工作区；本批Git提交只保存窄变更和当前交接，不能凭这两次提交重建全部P4B部署包。该事实不影响已在当前授权工作区执行的测试证据。

## 等用户通知后再接续的精确入口

用户明确继续后，优先做既有已批准S07“审核退回→准备新版本→业主原聊再次决定→再审核”的后台/小程序联动及普通作者/经理/企业管理三类边界，复用现有Drawer和C05，不扩展P5/P4C新界面。先读本文件、AGENTS/admin规则、双语模块清单、路线图3.7/3.9及既有设计README，检查Git/进程/实际fixture状态，再选择下一批。P5/P4C新设计、ASR、真实授权及生产发布仍须各自授权。当前不要自动开始。
