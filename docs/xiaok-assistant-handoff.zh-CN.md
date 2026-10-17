# 小K助手阶段接力记录

本文件记录当前可接续状态；功能范围仍以双语路线图为准。每个新对话先读AGENTS.md、最近嵌套规则、相关模块清单、路线图3.7/3.8及本文件，再检查工作区、Git暂存区和运行进程。仓库.agents目录本批未发现文件；rg不可用，使用受限文件枚举和context-mode处理日志。

## 当前阶段：C03原生围观/恢复验证完成

- 本批为验证阶段，没有新的产品功能或生产发布。上一阶段ec9ae5ec88f8cbc2d4c6bc473d64b236fce4bb75的入口epoch/无效入口清媒体/禁刷新请求修复保持。未改运行JS、WXML、Less、图片、API、数据模型、权限或Agent，也没有数据库写入；Admin运行合同无变化，因此不虚增Admin模块功能状态。
- 最终原生11/11步骤通过，定向48/48和真实公开HTTP8/8通过。仅完成C03限定原生围观/恢复，P4B整体仍Limited；C05具体版本业主决定/认证写入、完整光学/高屏/键盘、真实微信授权、真机/BLE和生产发布未验证/未交付，不把本批当作这些项目通过。
- 用户在中途明确说“你继续 我把占用解除了”。重新核验现有同一项目后重编译、重跑全部11步成功；无需再向用户索取继续、自动化许可或手工验收。此前异常导航的根因没有定位为产品缺陷，早期失败与不确定诊断保留。

## 工作区与Git边界

- 仓库G:\workspace\向总\Smart-Floor-Planner，沿用codex/xiaok-public-site-lifecycle，不另建仓库/分支，不合并、不部署、不force push。
- 开始HEAD为ec9ae5ec88f8cbc2d4c6bc473d64b236fce4bb75，原479条改动/未跟踪路径已建立哈希快照workspace-before.json并全部保留。并行任务更新两份surveying文档及小程序清单，收尾时另有miniprogram/packages/surveying/editor/surveying-editor.js和miniprogram/test/surveying-editor-autosave.test.js出现改动，当前共481条；均未纳入本批暂存。本阶段未改任何运行源文件或API配置；不要把并行任务的改动归入本阶段。
- 本批保存只含四份双语模块/还原台账的独立验证备注及本交接，不整体暂存清单/台账里既有大量前置改动。完整路线图和两条C03当前台账行已在本机同步最终验证状态；它们的原P4B前置内容继续留工作区，不笼统提交。不能仅靠本批窄提交重建全部未提交P4B实现。
- 验证主体提交85463f376954f78c85e45d3ecf66ce31df8e4cad已普通push至origin/codex/xiaok-public-site-lifecycle，git ls-remote已核验远端SHA完全一致；远端main仍为f273b57171d6dab5c3b8beef1fe124e634d51864。中间记录188c75adb657d4f4d96ea9195e05682caa5dae31仅含四段部分验证备注。随后仅追加本交接的Git回执与并行改动边界；最新交接提交/远端核验见tmp/xiaok-vector/p4b-native-followup/p4b-git-save.json，交回时与git log -1复核。没有修改main或扩大提交范围。
- 用户已有明确逐阶段commit/push授权；当前沙箱.git只读，初次暂存被文件系统拒绝后使用自动审查的定向Git权限成功，不存在自动审批拒绝或待用户批准事项。暂存只通过已审查备注补丁和本交接文件进行；不提交密钥、媒体或无关业务改动。

## 本阶段实际验证

原生复用唯一副屏Stable2.02.2608080窗口，精确projectpath为本仓库miniprogram，自动化端口9424（不是旧9422或IDE HTTP端口），官方miniprogram-automator0.13.0、基础库3.17.2、逻辑390×844。用户解除占用后只读预检未见其他活跃自动化连接；未关闭、新开或重新配置窗口。最终运行2026-10-17T15:39:56.683Z至15:40:41.310Z，退出0。

| 检查 | 最终结果 |
| --- | --- |
| 唯一正确项目/副屏、新鲜编译、SDK/数据/正向元素、仅测试企业传输 | 4步通过，真实服务，不替换响应 |
| 列表/输入/清空/照片 | 通过，真实3项工地/3项片区选择；输入未发送，随后清空 |
| 真实点卡/详情双Tab | 工地4版本4；照片元素与服务时间轴均验证 |
| 原生返回 | 列表重新读取，3项仍可见，未残留详情 |
| 同一精确版本重进 | 工地4版本4及照片重新获取，详情读取从1增至2 |
| 文字工地 | 工地9版本9，0张照片、1条真实节选 |
| 已撤回版本及实际点重试 | 工地6版本6两次404，界面仍不可用、无旧详情 |
| 无效版本刷新 | 请求总数15→15，保持无效状态，不发请求 |

原生请求共13次200、2次404。仅将/api/public/construction/2404/临时内存转向localhost:3006；结束时恢复wx.request/downloadFile，读回transportActiveAfterCleanup=false并回pages/index/index。未改账号/登录凭据/API源文件/安全网络配置或合成业务数据。

在miniprogram运行node --test test/public-sites-lifecycle.test.js test/assistant-public-sites.test.js test/assistant-chat.test.js test/project-packaging.test.js：48/48通过，0失败/跳过，945.3902ms。上批全量1950/1950（97.2秒）保留为历史证据，本批无产品源码变化，未重跑全量、Admin lint/build、付费模型评测或类型检查；不能称本批重新通过。

独立localhost:3006匿名HTTP8/8通过：2404的areas、sites、工地4版本4、文字工地9版本9、JPEG4返回200；工地6版本6、工地4错误版本6和撤回媒体6返回404/public_site_unavailable。均no-store，公开DTO排除已检查的私人ID/原件链接/存储键，照片JPEG签名及34,175字节已核验。这是只读验证，不替代C05/S07服务写入和完整权限回归。

## 设计来源与证据

- 两路由唯一最新来源仍为design-references/xiaok-p4b-public-sites-v1/C03-01-public-list.png、C03-02-public-detail.png及该目录既有状态/元素表，未提出新设计、切片或更换资产。双语清单/路线图及每路由唯一台账行已同步。
- 最终证据目录tmp/xiaok-vector/p4b-native-followup/：p4b-native-regression.json/.log、p4b-focused-tests.log、p4b-public-http.json、p4b-stage-validation.json。复用命令node tmp/xiaok-vector/p4b-native-followup/p4b-native-regression.cjs；可用SFP_REPO/SFP_QA_OUTPUT指定仓库/输出。它依赖本机既有tmp中的SDK/CDP/window辅助脚本，不是可脱离现有工作区运行的已发布测试包。
- 已核对路由与渲染的截图：p4b-native-catalog.png、p4b-native-detail.png、p4b-native-withdrawn.png，以及各自-host.png。逻辑390×844，模拟器PNG348×752，宿主1700×960且包含真实胶囊；最终详情为服务记录Tab，撤回反馈保持原恢复界面。没有将截图比例、元素查询或普通无重叠当成完整像素/光学验收。
- 早期attempt1至5及before-user-release/、discarded-timeout-captures/只作诊断，不当作最终通过证据。脚本修正了短步骤超时、SDK页栈RPC等待、异步导航/渲染等待、屏外卡片点击和null路径读取断言；未据此改产品代码。最终结果以主JSON中passed=true且11步通过为准。

## 下一阶段精确入口（立即新建下一对话，无需等用户说继续）

做一个有边界的“C05具体版本业主决定与原键回执端到端验证/修复”小阶段，保留既有C01/C05同聊卡，不扩展P4C/P5新界面。读取admin/AGENTS.md、双语Admin/Mini清单及路线图3.7/3.8、现有设计README；如修改行为先写可复现回归，再作聚焦修改。

1. 入口代码miniprogram/packages/assistant/lib/public-sites.js、packages/assistant/chat/chat.*、admin/src/lib/construction/public-customer.ts、admin/scripts/construction-public-fixture.ts。验证看全具体版本后同意、拒绝、稍后不写同意、撤回及未知结果原action/version/revision/Idempotency-Key核对；验证重进与本人/跨身份/租户拒绝边界。
2. 只用已批准localhost:5432/smart_floor_planner开发库的合成企业2404。现有ownerId3193/visitorId3194，访客咨询121，待业主场景project4/conversation125/site2/version2；状态会变化，必须重读当前revision和fixture清单，不盲用旧期望。缺数据可按现有受限fixture流程新建清楚标注的测试场景；不得写真实客户或生产。虚构账号默认禁用，测试会话按已有受限内存签发流程，不保存/打印凭据，结束恢复禁用。
3. 原生QA仍使用稳定默认工作流，先重新发现精确项目/autoPort、确认副屏及无争用，再新鲜编译。用户本轮已解除占用，不要求新的自动化许可；若再次发现外部路由/控制，停止争抢并继续独立客户端/服务验证，准确记录未覆盖项，不转成用户必做手工清单。
4. 完成后更新本交接、双语模块/路线图；定向commit、测试通过后普通push开发分支、核验远端SHA，再交回父对话立即建立下一阶段。P4C/P5新设计、ASR、真实微信授权及生产发布仍遵守原授权边界。
