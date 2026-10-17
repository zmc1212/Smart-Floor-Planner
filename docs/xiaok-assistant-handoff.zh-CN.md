# 小K助手阶段接力记录

本文件记录当前可接续状态；路线图仍是功能范围权威。每个新对话先读根AGENTS.md、最近的嵌套规则、双语模块清单、路线图3.7/3.8和本文件，再检查工作区及运行进程。

## 当前阶段：P4B公开工地客户端入口失效隔离

- 状态：限定代码修复已完成；完整原生业务验证未完成，结果不确定。P4B仍Limited。
- 仓库：`G:\workspace\向总\Smart-Floor-Planner`。实现开始时分支为`main`、HEAD为`f273b571`。收到后续自动Git保存授权后，在同一HEAD创建`codex/xiaok-public-site-lifecycle`；没有新建工作副本或部署。Git提交/远端核验以本批`p4b-git-save.json`为准。
- 开始时有481个已修改/未跟踪路径，包含大量已有小K/施工/账户/量房工作。全部保留；本批只改下面列出的文件，不能用git reset/clean覆盖。Git保存前工作区为483条状态（104条已跟踪改动、379条未跟踪），新增状态仅本交接文件和回归测试；原有文件内容均保留。Git保存会把本批直接依赖转为已跟踪，最终统计见本批校验JSON。
- 已有服务：localhost:3006 Next.js开发服务及assistant-worker持续运行，未重启/停止。无index.lock；仅发现当前工作树。未发现仓库内AGENTS.md之外的SKILL.md或任务锁。rg不可用，改用受限文件枚举；context-mode用于读码/测试日志。

## 修复和依据

有效详情请求发出后再进入无效版本时，show没有使旧epoch失效，旧响应可在同身份或切换身份后回填；无效入口还保留旧媒体，并允许刷新再次请求。现在每次show先失效旧请求、保存entryValid，无效入口清理媒体，load拒绝无效入口；有效入口重进正常恢复。

源文件原始SHA-256为`3ddc43311b68e6d4db44f080a2fbe4956a5b4faf7df0fc2dca0271400ac4ae00`，写入前核验一致以避免覆盖并行改动。新增3项行为回归，修复前3/3失败，修复后通过。没有引入新的Agent编排，不涉及上游框架迁移。

设计映射：沿用`design-references/xiaok-p4b-public-sites-v1/C03-01-public-list.png`、`C03-02-public-detail.png`及既有U01反馈。未改模板、样式、资产、角色、API、schema、路由或API地址；两条双语台账只更新验证状态。后台模块运行合同没有变化，未更新其功能合同或重跑Admin构建。

## 本批改动文件

1. `miniprogram/packages/construction/public-sites/public-sites-model.js`：3处生命周期修复。
2. `miniprogram/test/public-sites-lifecycle.test.js`：3项异步/身份/媒体/刷新/恢复回归。
3. `docs/miniprogram-system-modules.md`、`docs/miniprogram-system-modules.zh-CN.md`：当前行为及验证边界。
4. `docs/miniprogram-design-restoration-ledger.md`、`docs/miniprogram-design-restoration-ledger.zh-CN.md`：原两条C03路由状态，不换设计源。
5. `docs/xiaok-assistant-roadmap.md`、`docs/xiaok-assistant-roadmap.zh-CN.md`：3.8范围/验证/未覆盖项。
6. 本文件。`tmp/xiaok-vector/p4b-lifecycle-stage/`只放本批忽略的验证材料和可复用原生诊断脚本。

## 已执行验证

在`miniprogram`目录运行：

`node --test test/public-sites-lifecycle.test.js test/assistant-public-sites.test.js test/assistant-chat.test.js test/project-packaging.test.js`：48/48通过。

`node --test --test-concurrency=4 test/*.test.js`：1950/1950通过，0失败/跳过，97.2秒。首次45秒超时尝试没有汇总，不计为通过。日志为本批目录中的`p4b-focused-tests.log`、`p4b-full-mini-tests.log`。

文档收尾：`git diff --check`返回0（仅既有LF/CRLF提示）；本批9份文件逐一检查无空白错误，文件哈希、引用路径及双语3.8/两条设计源核对通过。校验JSON为`tmp/xiaok-vector/p4b-lifecycle-stage/p4b-stage-validation.json`。

真实localhost:3006 HTTP：测试企业2404的areas/sites/工地4版本4为200，已撤回工地6版本6为404/public_site_unavailable。数据库/业务规则未修改，不把这些读取算成新的写入验收。

原生工具：既有唯一项目在副屏，Stable2.02.2608080、SDK0.13.0、基础库3.17.2、390×844，实际autoPort为9422（不是旧9420，也不是IDE HTTP端口）。初次SDK握手超时后显式重编译，systemInfo/page.data/正向元素查询成功；原生请求实际读取2404列表和两张照片，均200。没有完成受影响原生路径的截图/输入/双Tab/重进/撤回业务验收，不宣称已通过。

## 原生验证阻塞的精确记录

- 动作/目标：在既有`packages/construction/public-sites/public-sites`及`public-site/public-site`执行实际输入、详情Tab、返回重进及失效重试。
- 现象：运行期间出现本脚本未发出的`packages/ai-workflow/result/ai-design-result`和`packages/business/appointment-detail/appointment-detail`路由；输入状态断言或等待失败，不能排除其他窗口交互/自动导航影响，未归因于产品缺陷。
- 状态：结果不确定，未被权限拒绝；无代码或写仓库权限阻塞。为避免争抢已停止原生窗口操作。
- 清理：仅针对2404公开请求的临时内存URL转向已恢复，读回`transportActive=false`；未改登录凭据/API文件/用户配置，未关闭或重新创建DevTools窗口。保留诊断JSON；不能用基础连接成功替代业务验收。
- 原生脚本`p4b-native-regression.cjs`按官方SDK0.13.0签名调用；已加路由异常保护，检测非本脚本路由时不强制抢回首页。脚本最后保护更新仅做语法检查，完整业务回归待下阶段。

## 下一阶段精确入口

先做一个有边界的“P4B已批准界面原生业务闭环验证/修复”小批次，不扩展P5新界面：

1. 检查是否另有开发/自动化控制相同DevTools；从9431项目CDP重新确认精确projectpath、autoPort和副屏位置，不能假定仍为9422，不关闭或新开副本。
2. 在窗口可稳定保持目标路由时，从本批目录运行`node p4b-native-regression.cjs`（可设置SFP_REPO、SFP_QA_OUTPUT），补齐C03列表/输入恢复/真实点卡/双Tab/返回重进/文字工地/撤回404/无效入口不发请求。若发现明确产品缺陷，先写行为回归再改；不再扩大长尾评测。
3. 后续仍在原C01/C05设计中验证业主看全具体版本→同意/拒绝/稍后/撤回与原键核对。代码入口：`miniprogram/packages/assistant/lib/public-sites.js`、`packages/assistant/chat/chat.*`、`admin/src/lib/construction/public-customer.ts`、`admin/scripts/construction-public-fixture.ts`。已有测试企业2404；ownerId3193/visitorId3194、访客咨询121；待业主场景project4/conversation125/site2/version2（必须重读当前revision）。虚构账号默认禁用，若需测试会话按现有fixture的受限内存签发方式，不保存或输出凭据，不操作真实客户。
4. 新阶段更新本文件和原双语清单/路线图。P5正式变更及P4C新设计仍按既有审批边界；语音ASR、真机/真实微信授权、生产发布均未交付或授权，不作为本次代码修复完成门槛。

## 自动Git保存边界

用户后续明确批准每个可验证小阶段commit并push开发分支，不自动合并或部署、不force push、不混入无关改动。本批选择`codex/xiaok-public-site-lifecycle`，origin为`https://github.com/zmc1212/Smart-Floor-Planner.git`；远端main已核验仍为f273b571，目标开发分支原先不存在。HEAD及工作区未配置GitHub Actions/其他常见CI部署文件，Git hooks为空且没有core.hooksPath；没有发现该新分支会触发已配置生产部署的依据。

控制器和其唯一新增媒体依赖原先均未跟踪；只提交控制器`public-sites-model.js`、直接依赖`miniprogram/utils/public-site-client.js`、新增回归测试与本交接文件，共4文件。媒体工具保持原内容，仅作为修复的必要依赖保存，没有把其他P4B前置实现一并加入。使用HEAD中未改动的api.js/session.js加这3份JS文件构造最小无Git测试目录，新增3/3回归通过，日志`p4b-commit-snapshot-tests.log`。1950/1950是完整现有工作区的回归结果，不能冒充该小提交包含全部P4B产品。

双语模块清单/还原台账、整个路线图、P4B页面/后台/迁移及其他先前改动继续保留原工作区，未混入这次窄提交；完整业务接力仍需使用本机现有工作区，不能仅凭该提交重建全部小K功能。下一阶段检查当前branch、index、git log与`p4b-git-save.json`，沿用此开发分支继续保存相关改动。
