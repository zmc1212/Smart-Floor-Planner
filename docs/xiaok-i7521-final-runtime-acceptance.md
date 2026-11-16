# 家客来 I7.5.21 四端与 Worker 最终验收收口

2026-11-16（Asia/Shanghai），分支 `codex/xiaok-integration`。本轮只做最终验收收口，不重新设计已通过验收的业务逻辑，不新增专业 Agent、装修阶段、提醒引擎或周报引擎。四端原生页面、Worker 运行时和恢复链路在独立 PG17 与 Stable DevTools 上完成；真机与真实微信授权因缺少设备标记为 `not_run`，页面上有历史实云证据的能力按复用口径报告，本轮不重复付费调用。

## 1. 基线、工作树和隔离

- 已执行 `git fetch origin`。本地分支、`origin/codex/xiaok-integration` 与远端 HEAD 均为 `1d1e88792a59ff1eb7bee54dfe23e5a99d5ebc2c`（I7.5.21 Worker 预检路由修复）。远端默认分支仍为 `main`。本轮未合并 `main`、未部署生产、未修改企业 1454、未执行数据库迁移、未启动生产常驻 Worker、未发送真实外部通知。
- `git worktree list` 显示主工作区及 8 个既有工作树（并行支持、百炼 Responses、I7.5.12 ACL、I7.5.18、Native Workflow、unified v96/v97、部署工作树）。主工作区起始有 28 个已跟踪修改和 2 个未跟踪文件（含 `miniprogram/utils/native-preview.js` 与协作 SKILL），全部原样保留，未纳入本轮提交。本轮提交只包含验收文档与模块清单。
- 后台固定源码取自 `git archive HEAD admin`（tree `54e4cc1aba85931f4587634b268c7e8f4f03a28c`）。独立 PostgreSQL 17.10 + pgvector 0.8.2，仅监听 `127.0.0.1:55476`，数据库 `xiaok_i7521_r14`、集群 `7708726790275319980`、排序 `C`；API 仅监听 `127.0.0.1:55621`。结构恢复自 I7.5.18 纯结构归档 SHA-256 `794ec03d9bf233d8f87843a438e83db67f202e13e3082a3ed1bc098e3ee18130`，仅导入 129 条迁移账本（末条 135），有序 JSONB 账本 SHA-256 `7a3a3f488f777978461fadba142313409d339b015351a61005e73fe765b50c4e`。
- 业务连接使用非超级、非 BYPASSRLS 的 `sfp_app`；驱动在创建连接前校验 loopback 高端口、库名、`xiaok-i7521-r14` 标记、PG17、账本和空白租户/安静队列，并持有单会话验收锁。合成企业 A/B 均非 1454；起始 `tenants=0`、活跃任务 `0`、公共映射 `0`。全程未读取或写入企业 1454。
- 后台源码绑定 2,414 个文件 SHA-256 `4418a40d7104c9387ded8b08b75ed22e96dc2f6566feeed322e12329f7e91b0d`，执行前后一致。小程序工作树绑定 1,237 个文件 SHA-256 `b75e4627c443a870bdc1899c687324ced64b5cfa41abad4287eb0998e190efd8`，执行前后一致。注意：小程序原生检查使用当前工作树（含其他 Agent 的未提交修改），后台使用固定提交的独立副本；两者边界不同，见第 7 节。

## 2. 四端 UI

V3.2 基线沿用现有已批准入口，不新增页面：业主 C01 与项目简报卡、老板「项目简报与问题清单」、设计师「工地协作与需求核对」、施工人员「云工地」及经理「我的待办」。逻辑视口 390×844，Stable SDK 3.17.2；12 张 PNG 均为 309×667 编码。所有截图、路由、页面数据和未读/已读状态见 `tmp/xiaok-i7521/r14/native.json`。

| 角色 | 状态 | 页面与实测 | 截图 |
| --- | --- | --- | --- |
| homeowner（业主） | `limited` | C01 重进读到 2 条消息和 3 条阶段提醒；点击阶段提醒打开周报范围，周报 8 个栏目可读，重开保留 `readAt`。引用重开仅复用 I7.5.20 的签名 HTTP 证据，本轮合成夹具无知识引用，原生引用弹层未执行。 | `customer-c01.png`、`customer-weekly.png` |
| owner（老板） | `passed` | 工地列表 → 项目简报，读试点项目、计划 V1 进度和「需介入 · 1 项」；进入问题清单读到 1 条事项；`book-back` 返回项目列表，`navigateBack` 返回简报；滚动 280px 后截图。老板周报 9 个栏目（含 overview/stages/colors/new_issues/rectifying/review/fixed/exceptions/next_week），重开保留已读回执。已修正清单本轮为空态，未构造已解决事项。 | `boss-brief.png`、`boss-brief-scroll.png`、`boss-weekly.png` |
| designer（设计师） | `limited` | 项目列表 → 项目详情读到 1 个房间、设计端角色、当前计划与提醒；点击「查看点位与图纸」进入工地交流（`mode=plan`）并截图；返回工地列表。周报 7 个栏目含 `requirements/reviews/opinions/issues/versions`，重开保留已读回执。独立点位图工作区与新旧版本差异对照仍是现有房间/对话投影，未新造。 | `designer-project.png`、`designer-point.png`、`designer-weekly.png` |
| worker（施工人员） | `passed` | 工地列表以 `my_role=worker` 返回试点项目；项目详情读现场记录原文（`I7521`）和实时提醒；打开「阶段分工与成员」底部弹层并关闭；滚动 320px 后截图。周报 6 个栏目 `tasks/records/handled/unfinished/materials/next_step`，重开保留已读回执。经理在工作台读到 3 条待办，点击第 1 条定位到项目 1。 | `worker-project.png`、`worker-sheet.png`、`worker-weekly.png`、`manager-workbench.png` |

公共检查：

- 安全区：`safeArea.bottom=810`、`statusBarHeight=47`；聊天输入区、报告详情和跟进面板使用 `env(safe-area-inset-bottom)`。这是模拟器系统信息与样式审计，不代表真机计算。
- 返回：老板从问题清单回项目列表、再回简报均成功；设计师从点位对话返回工地列表；施工人员弹层关闭成功。
- 滚动：老板简报和施工人员项目详情均执行 `pageScrollTo` 并留存滚动后截图。
- 弹窗/弹层：施工人员「阶段分工与成员」底部弹层实际打开、截图并关闭；老板问题清单为页面跳转，不是假弹窗。
- 消息重进与已读回执：业主 C01 重进读到原消息；四角色各自重开周报均读到持久化 `readAt`，重复确认不新增报告或消息。

## 3. 真机能力

| 能力 | 状态 | 边界 |
| --- | --- | --- |
| 登录与角色切换 | `not_run` | 无真实微信账号、手机与授权；DevTools 使用合成 JWT 与 `bootstrap`，不能替代真机登录。 |
| 相机、相册 | `not_run` | 未调用真实相机/相册，未上传真实照片。页面与上传合同沿用既有测试与 I7.5.10 的 `limited` 结论。 |
| 语音录制及上传 | `not_run` | 未获取麦克风权限，未产生真实语音文件。 |
| 网络断开与恢复 | `not_run` | 设备侧断网/恢复未执行；Worker 侧 API 不可达恢复见第 5 节。 |
| 重复提交 | `not_run` | 真机弱网重复提交未执行；HTTP 层幂等已由运行回执覆盖。 |
| 页面重新进入 | `not_run` | 真机杀进程/热启动重进未执行；DevTools 重进见第 2 节。 |

没有用浏览器截图或 DevTools 截图冒充真机证据。真机项在汇总表中保持 `not_run`。

## 4. Worker 运行时

| 检查 | 状态 | 实测证据 |
| --- | --- | --- |
| preflight 安全门禁 | `passed` | 未配置试点时启动 Worker 退出码 2，退出前 `lastRequestAt=null`，`lastErrorCode=safety_gate_closed`，数据库行未变；未带 `CRON_SECRET` 的 preflight 返回 401。配置试点后门禁 `open/pilot/i7521-dev/enterprise 1`，预检为 `READ ONLY` 且未改业务行。 |
| CRON_SECRET | `passed` | tick、preflight 均使用独立一次性 `CRON_SECRET`；401 与 200 路径均在真实 Next.js 服务上验证。 |
| 试点企业白名单 | `passed` | 试点范围 `active/scopeVersion=1/projectCount=1`；10 份报告仅来自试点企业 1；异租户企业 2 的 reply run 保持 `queued`、`attempts=0`；试点外项目不进入报告。 |
| 定时调度 | `passed` | 真实 Worker 进程按自身 tick 轮询，依次产生 C01 回答、10 份事实日/周报和 11 条阶段提醒；无需人工调用 tick。 |
| 任务租约与幂等 | `passed` | 所有自有 run 的 `attempts=1`；C01 同一 `Idempotency-Key` 两次返回同一 run `2`；重复 tick 的高水位（runs/reports/reminders）不变；设计师接管期间 2 份报告 `held`，恢复后补投且不重发已送达报告。 |
| 重复执行幂等 | `passed` | 最终 10 份报告、11 条提醒（8 条站内送达，3 条经理 `no_inbox`）与单次业务事实一致；重复领取和重复投递为 0。 |
| 进程重启 | `passed` | Worker PID `948` → `40328`；停机时 healthcheck 返回 `processStatus=stopped`、`healthy=false`、`worker_process_stopped`；重启后新 PID、新心跳、无重复回执。 |
| 心跳更新 | `passed` | 健康文件记录 `workerPid/lastRequestAt/lastSuccessAt/lastFailureAt/consecutiveFailures/lastHttpStatus/lastErrorCode/safetyGate`；重启与恢复后 `lastSuccessAt` 前进、`consecutiveFailures` 回到 0。 |
| 网络故障恢复 | `passed` | 停掉 Next.js 后同一 Worker 记录 `endpoint_unreachable`；恢复 API 后同一 PID `40328` 重新成功，`lastHttpStatus=200`，业务高水位不变。 |
| 异租户任务不受影响 | `passed` | 企业 2 的排队 run 在全程保持 `queued/attempts=0`；企业 2 无报告、无提醒、无模型调用。 |
| 外部调用与清理 | `passed` | `provider_attempts=0`；仅 3 次 Next 版本检查被 loopback 门禁拦截到 `registry.npmjs.org`，实际外部请求 0；`1454` 未包含。验收后 PG、Embedding/Next/Worker 进程均停止，应用角色密码失效，端口关闭，`cleanup.json` 全部为 true。 |

10 份报告为：老板日/周报、业主日/周报、设计师日/周报、施工人员（admin:2）日/周报、经理（admin:5）日/周报。设计师两份在人工接管期间为 `held`，恢复 AI 模式后补投；所有报告 `status=facts_ready`、`contentStatus=facts_only`、`facts_hash` 为 64 位十六进制。11 条提醒中业主 3 条、设计师 2 条、施工人员 3 条站内送达，经理 3 条因无私聊收件箱为 `no_inbox`；经理仍可在工作台读取这 3 条待办。

## 5. 真实 AI 回归

本轮没有新的实云费用授权，未发起新的百炼、DeepSeek 或 Embedding 付费调用。以下为复用已有回执的结论，不能替代本轮新账单。

| 能力 | 复用状态 | 证据 |
| --- | --- | --- |
| 百炼真实检索（水电/防水） | `passed`（历史） | I7.5.15 `payg-r01`：企业水路 `BAILIAN_RAG` 请求 `1e9c0f04-ad31-909c-936f-f05f83884478`，平台补充 `651b4817-6547-99a2-8ecb-6ff8e782839d`，防水 `8586e4f4-0e48-9be8-ad0c-1e47953cf4e0`；命中 PPT 第 17/18 页。 |
| DeepSeek 真实生成 | `passed`（历史） | I7.5.15 实云两次 HTTP 200，模型 `deepseek-v4.1-flash-1017`，`requestId` `d17bb005-f61e-91a9-ac0a-a0a71bc78ad7`（574/40 Token）与 `46e644ab-f240-98a1-b0d2-b90651b94044`（602/83 Token）。 |
| 来源引用 | `passed`（历史） | I7.5.15 引用逐字原文、PPT 页码、版本与来源校验；I7.5.20 在隔离库复核标题、来源、版本、摘录和原文哈希，撤权/退役后旧引用不可读。 |
| Facts-only | `passed`（复用） | I7.5.20 八种检索/文本故障组合；文本未配置、超时、503 后保存获权原文，正文状态 `facts_only`，无依据保存 `insufficient_evidence`。 |
| 本地备用 | `passed`（复用） | I7.5.20 百炼连接失败/429 后使用真实本机 Qwen3-Embedding-0.6B + pgvector 找回同一获权版本；凭据拒绝和索引不兼容闭合失败。 |
| 双引擎故障 | `passed`（复用） | I7.5.20 主检索连接失败、备用 Embedding 503 时任务失败并记录 `retrieval_unavailable`，模型调用和输出消息均为 0。 |

I7.5.15 的实云批次已结束，其授权账本、Workspace 和一次性凭据均不可续用；本轮 `real_bailian` 新增调用为 `not_run`，未核对新账单。若后续需要重新验证实云时延、额度或模型版本，必须另开独立合成企业和单独审批的费用额度。

## 6. 分类汇总

| 类别 | 状态 | 说明 |
| --- | --- | --- |
| `homeowner` | `limited` | C01、阶段提醒、周报和已读回执通过；原生引用重开未执行，仅复用 I7.5.20 HTTP 证据。 |
| `owner` | `passed` | 项目简报、需介入事项、问题清单、进度、返回、滚动和周报通过；已修正空态未构造。 |
| `designer` | `limited` | 项目、房间点位入口、意见栏目、周报和周报重开通过；独立点位工作区与差异对照未新造，点位对话返回后落到工地列表而非详情。 |
| `worker` | `passed` | 任务、施工记录、经理待办、周报、弹层、返回和滚动通过；相机/语音/弱网等真机能力 `not_run`。 |
| `mini_program_native` | `passed` | Stable 3.17.2、390×844、12 张截图、四端重进与已读回执通过；真机和真实微信授权 `not_run`。 |
| `real_bailian` | `passed`（复用） | 百炼检索、DeepSeek 生成、引用、Facts-only、本地备用、双引擎故障均引用 I7.5.15/I7.5.20 回执；本轮新增付费调用 `not_run`。 |
| `worker_runtime` | `passed` | 预检门禁、CRON_SECRET、试点白名单、调度、租约、幂等、重启、心跳、断连恢复和异租户隔离全部通过。 |
| `recovery` | `passed` | 进程重启、API 不可达恢复、人工接管补投、撤权重进均无重复回执；旧报告在撤权重进后保持 `source_unavailable`。 |

## 7. 失败、受限和未执行

| 状态 | 项目 | 边界 |
| --- | --- | --- |
| `failed`（基线，非本轮引入） | `pilot-worker-alignment.test.ts` 的 W/W2 | 两条断言仍匹配旧源码字符串（`knowledgeBatchChecks = await knowledgeBatches()` 等），当前源码已改为带 `taskScope` 和门禁分支；I7.5.19 已在 `25253665` 的重叠源码上复现同两条。其余 40 项定向后台测试通过。 |
| `failed`（基线） | 全量 Admin ESLint | 未在本轮重跑；I7.5.16/I7.5.18 基线为 8 个 `@typescript-eslint/no-require-imports` 错误，均在未修改的 `deployment/portfolio-kodo/{seed.cjs,signing.js}`。 |
| `limited` | 原生引用重开 | 合成夹具没有知识文档/引用；原生只验证了 C01、阶段提醒和周报。引用重开由 I7.5.20 的签名 HTTP 与隔离库覆盖。 |
| `limited` | 设计师点位与差异 | 无独立图纸工作区；入口进入 `mode=plan` 的工地交流，差异通过事项/对话投影。点位对话返回后页面落在工地列表（`backDetail=false`），路由正确但未恢复详情态。 |
| `limited` | 老板已修正清单与异常升级 | 本轮只构造 1 条待核实事项用于「需介入」；未构造已解决/已关闭事项和逾期计划，因此「已修正」为空态，异常升级规则仍引用 I7.5.19 证据。 |
| `limited` | 经理私聊通知 | 3 条经理提醒为 `no_inbox`，工作台可读但不代表私聊已送达；未新增通知渠道。 |
| `limited` | 小程序源码绑定 | 原生检查使用当前工作树（1,237 个文件，含其他 Agent 未提交修改），后台使用固定提交独立副本；工作树哈希前后一致，但不是精确提交级绑定。 |
| `not_run` | 真机与真实微信授权 | 无设备、无真实登录/相机/相册/语音/弱网；未用浏览器截图冒充。 |
| `not_run` | 实云新增调用与账单 | 无新费用授权，未调用百炼/DeepSeek/Embedding，未核对账单。 |
| `not_run` | 生产 Worker、外部通知、1454、迁移、合并/部署 | 全程未启动生产常驻 Worker，未发送真实外部通知，未读写 1454，未执行迁移，未合并 `main`，未部署。 |

## 8. 工程验证、证据和复跑

- 后台定向测试：`npx tsx --test` 覆盖 `assistant-worker-proxy`、`worker-safety-gate`、`worker-tick-alignment`、`stage-reminder-worker`、`pilot-worker-alignment`，42 项中 40 通过、2 项为上述基线失败。
- 小程序定向测试：14 个四端/跟进/提醒测试文件，116/116 通过。
- TypeScript：使用 `git show HEAD:admin/tsconfig.json` 的提交版配置副本执行 `npx tsc --noEmit --incremental false -p tsconfig.i7521.json`，退出 0；临时配置已删除，工作区原 `admin/tsconfig.json` 未改。
- ESLint：`src/proxy.ts`、`src/__tests__/assistant-worker-proxy.test.ts`、`worker-safety-gate.ts`、`stage-reminder-worker.ts`、`pilot-worker-alignment.ts`、`jobs/run/route.ts`、`jobs/preflight/route.ts` 定向 `--max-warnings 0` 退出 0。
- 本轮无产品源码修改；提交只包含本报告、四份模块清单和当前任务记录。之前的预检路由修复已在 `1d1e8879` 提交。
- 最终回执 `tmp/xiaok-i7521/r14/runtime.json` SHA-256 `d0087cad0ffe2dde1d1c4e5ff9d47a3fdb944709a655fa5fe90e378fe4db7fd0`；`native.json` `37ddc58d82d8db66d8e1387ccc00c05f0afbbf370dcbd01263595ad214ce048c`；`preflight.json` `0aa47a166060d0b0e6909cd3f0da045b50b08fc48758eec952341d2ca321166a`。`setup.json` 记录基线、账本、集群和源码摘要；`cleanup.json` 确认数据库、API、应用凭据和初始化密码均已收尾。较早的 `r05`（纯原生）及 `r06`–`r13` 失败或中间尝试原样保留，不被最终通过覆盖。
- 复跑：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File tmp/xiaok-i7521/run-isolated.ps1 -Run rNN`。需要本机 PG17.10 + pgvector 0.8.2、I7.5.18 纯结构归档、129 条账本、Stable DevTools 工程窗口在副屏且未最小化。脚本使用两台独立高端口和一次性凭据，不读取仓库 `.env`；驱动与 DevTools 窗口通过本机 loopback 交互，不启动生产 Worker。
- 验收后资源：独立 PostgreSQL 停止，API 监听关闭，Worker PID `948`/`40328` 已退出，初始化密码文件删除，`sfp_app` 已禁用登录并清空密码；合成库留在停机目录，未删除历史证据。

## 9. 结论

I7.5.21 的四端页面、Worker 运行时和恢复链路在独立合成环境通过；四端周报均能从各自入口重开并保留已读回执，老板简报能看到真实待介入事项，设计师点位入口和施工人员记录/弹层可操作。真机、真实微信授权、生产运行和本轮新增实云调用仍为 `not_run`；原生引用重开、设计师独立点位工作区、老板已修正清单和经理私聊通知为 `limited`。本结论是开发环境最终验收，不等同于生产上线或真机验收通过。
