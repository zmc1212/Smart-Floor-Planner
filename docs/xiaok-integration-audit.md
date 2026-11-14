# 小K三线集成审查

## I6.16 防水 Agent V1.1 候选

Integration 起点 `60b5be9e371a`。I6.16.1 协议切片定向 135/135（0 skipped）。Run 14 的供应商检查点零调用复放确认，混进 `output_text` 的字面 `<think>` 触发整稿拒绝，独立 `reasoning` 帧只留通道标记。Chat Completions、带工具回执的终稿、异常帧、流式拆帧及可见无据量数回归通过。历史首稿维持原判。证据 `admin/tmp/i6.16/{protocol-replay,protocol-binding-before,protocol-binding-after}.json` 与 `admin/tmp/i6.16-protocol-tests.log`。

I6.16.2 两条固定 Native C01 咨询用百炼 `deepseek-v4.1-flash-1017`。Run 1、2 均实际保存正文且委托写入为 0。10 次已返回 Responses（含 2 次附带建议），10,649 输入 / 4,086 输出 tokens，结算金额未知。两份首稿均有无据量数。Run 1 删除 200 mm 段后保留解释。Run 2 的先前投递仍间接认可师傅所报高度，业务判 `failed`。原驱动对 0 条委托的错断言保留。针对该证据收窄无据回答兜底至有当前引文的独立段，实际首稿仅零调用复放，按新代码的实模业务范围仍 `limited`。详见 `admin/tmp/i6.16/{advice,numeric,fixed-quantity-binding-before,fixed-quantity-binding-after}.json`。

隔离 PG17 `xiaok_i616_validation` 使用企业 `5`、对照 `6`、业主 `3`、项目 `1`、卫生间 `1`。通过 WorkflowService 发布 `waterproof-specialist@2` 对应的 `waterproof-inspection-v1` revision `4`（`dc9c3fda69b5762b312293dd40d6e93e2316571f9284f3a751487a69608e54f0`），rev1–3 原定义和摘要全文相等。原活动版本仍为 @1。发布和模拟见 `workflow-publication.json`。

| 场景 | 状态 | 实际结果 |
| --- | --- | --- |
| 授权前的公开清单 | failed | Native Run `3` 未创建委托；四个 Responses 返回后仍断言 JGJ 298 当前状态，终稿拒绝 `standard_status_unverified`。 |
| 首个正式委托 | failed | Native Run `4` 保存登记 `7`，子 Run `5` 因公网读原文和企业托管读取前提失败而止于 `source_read_required`。原回执和失败均保留。 |
| 第二个正式委托及有据清单 | passed | 原 C01 `2` 的授权原话 `10`、Native Run `6`、登记回执 `11` 和子 Run `7`。托管检索明确 `retrieval_unavailable`；已复核住建部公告附件原件，按实际选中的 GB 55030-2022 第 27、28、31 页生成四项清单。目录超时保留现行性 `unknown`。Stable 重进读到相同清单 `13` 及三条可用引用。 |
| 清单等候、复核与返回原 C01 | passed | 正式 Run `specialist:eed84ff3-25ef-4cf9-a0f5-bd6c99bf4af0` 走有据分支，完成现场与复核两个等待。Worker 和经理使用同一业务服务写入记录 `1`、`2`、事项 `35`、复核 `50`（修订 2）、Outbox `51`。原会话回执 `30` 回复原消息 `10`。老板端读同一事项，Stable 业主重进核对回执、受保护原件和同一个 Run。 |
| 原会话、业主授权及租户 | passed | 对照企业、另一业主和另一 C01 无该 Run 或原件权限。撤销项目对客授权后 Stable 遮蔽结果且原件 404，恢复后读回同一结果。 |
| Stable 工人选图上传、真实材料及真机 | limited | Stable 的模拟图片先遇存储限额，再遇相册临时路径准备失败。隔离驱动用工人身份通过同一 Construction 服务提交合成图，之后在 Stable 经理发布、员工整改、经理复核及老板、业主读回。真机、真实现场照片、真实微信授权、BLE 为 `not_run`。 |

两次正式执行使用实际百炼 `deepseek-v4.1-flash-1017`，原咨询走 Responses，固定结构化专业子作业走 Chat Completions。实跑证据在 `admin/tmp/i6.16/` 下的 `checklist-consult.log`、`checklist-assistant-5.json`、`checklist_second.json`、`checklist-second-assistant-7.json`、`public-workflow-second-binding-{before,after}.json`、`c01-checklist-reentry.json` 和 `closed-loop.json`。Stable 各阶段保留前后摘要、原生请求和独立失败日志。原件来源见[住建部公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html)。

候选切片定向 Assistant、Specialist Registry、Workflow Validator/Compiler/Simulator、Construction 54/54（0 skipped），TypeScript、定向 ESLint 与计划校验通过。见 `checklist-targeted-final.log`、`checklist-tsc.log`、`checklist-lint.log`。

## I6.15 统一执行器与正式防水委托（Limited）

分支 `codex/xiaok-integration`，fetch 基线 `72777986d854`，业务切片 `2a84ef249fb881df84b020fe3775c6d91b48775d`。新建隔离 PG17 `xiaok_i615_validation`，企业 `4`、对照企业 `5`、业主 `1`、项目 `1`、卫生间 `1`、原 C01 `1`、取消对照 C01 `2`。保留历史事项 `8`、V1 Agent 与已发布的各版本，采用既有 JSON/事件存储，空库迁移已验证。

| 项目 | 状态 | 实际结果 |
| --- | --- | --- |
| A 普通防水咨询 | failed | Native Run `7` 未创建委托，首稿含无来源的 200 mm / 200–300 mm。Stable 的 Run `14` 首稿含 250 mm / 30–50 mm，唯一修复在输出文本的 `<think>` 段保留原量数，两稿均被拦截，未创建委托。第二批前后源码摘要不同，保留为失败证据。停止同类复采。 |
| B/C 明确授权与登记回执 | passed | Native Run `8` 成功；原消息 `10`、站内回执 `11`，正式 Run `specialist:d5f6bf06-21d5-4bb8-93dd-fe50673f8fc3`，首 Outbox `14`，绑定 rev3 `44f15a21…`。Stable 业主输入框补验 Run `15`、`17`，均以真实登记回执 `47`、`51` 结束。 |
| D 取消 | passed | 独立 Native Run `9` 成功登记，原会话取消将 `specialist:7073bcd3-6867-4f6f-b4b2-1b53e41a5be6` 置为 `cancelled`，Stable 重进仍显示回执 `15`。Stable 输入框另取消地漏收口委托，重进保留回执 `55`。取消后的委托为 `cancelled`，已经失败的专业工作流继续保存 `failed` 及原诊断。 |
| 正式 Workflow 等待与来源 | passed | 真实子 Agent Run `10` 成功，工作流进入补资料分支并在 `site_record` 等待，持久任务无执行租约。获权同房间记录发布后，由原 Worker 登记事项并进入经理复核等待。 |
| E/F/G/H 同一 Run 的四端验收 | passed | Stable 3.17.2 / 390×844 副屏实跑。工人提交待核对记录 `1` 及整改记录 `3`，重进读回合成原件。经理确认、转交，核对原件和历史版本并正式复核。事项 `35` 修订 `4`、复核 `55` 修订 `2`、证据事件 `52`、回传 Outbox `56`、原 C01 回执 `38`（回复原消息 `10`）。老板端读取同一已解决事项，补验以隔离企业的正式阶段配置将该项目登记为“防水”后再次读到同一 Run 和事项。业主重进读到原复核和原件。通过范围为同一合成项目的补资料路径。 |
| 当前授权与恢复 | passed | 另一业主不能打开原件或委托，对照企业看不到 Run，第二条 C01 无原咨询 Run。撤销项目对客授权后 Stable 原结果遮蔽、原件 404、任务列表为空；恢复后原回执和原件重新可读。 |
| C01 有据清单的本轮真实渲染 | limited | 专业子作业保存了检查内容，此 Run 按冻结 rev3 进入补资料。企业工艺检索不可用，公网原文未核实。有据清单分支本轮仅复用模拟及历史证据。 |
| 同一 C01 后续专业清单 | failed | 已登记套管封堵 Run `15` 的子作业 `16` 在模型派发前因旧回执重验误判失败。`f6ac48e2` 修正来源重验，原回执通过离线回放，撤权及另一业主仍被拒绝。新地漏收口 Run `17` 的子作业 `18` 已进入模型，首稿和唯一修复混入委托历史且结构校验未通过，最终 `invalid_model_answer`。登记事实和原失败均保留。 |
| 真实素材、真机、BLE、真实微信 | not_run | 本轮现场照片使用明确标记的合成图。 |

新增模型统一 `bailian / deepseek-flash / deepseek-v4.1-flash-1017`。共 21 次已知供应商返回，Responses 10 次，Chat Completions 11 次（固定结构化载体）。供应商回传 35,076 输入 / 6,058 输出 tokens，实际费用金额 `unknown`，未对账。首稿、工具、回执及请求 ID 见 `admin/tmp/i6.15/{advice,advice-repair,follow,follow2,startup-assistant-10,stable-follow-first-provider,stable-follow-provider,stable-specialist-provider,closed-loop}.json`。Stable 证据 `stable-*.json`、`four-role-readback.json`、`closed-loop.json`，保留前后摘要、角色收发记录、原件和截图。空输入、开关及编辑保存的自动化限制通过页面原处理函数操作，记录实际 API 写入。业务写入批若遇源码漂移保留原批，相关复核及重进已在固定快照只读核验；登记首批未采集完整工作树前后摘要。跟进补验首个驱动尝试与现有 Worker 同领任务而未取得租约，保留原日志，后续由现有 Worker 单独处理。

普通咨询零调用复放见 `advice-offline.json`。两个首稿的可见正文均含无据量数。Run `14` 修复将这些量数放进文本的前置 `<think>` 段，剩余正文通过原量数和承诺校验，但仍多答了前面的委托话题。用两种 Responses 帧分别复放，独立 `reasoning` 项会被解析器略过，`output_text` 中的标签按正文处理。第一批模型输入只有本轮用户消息，第二批另有四条会话历史，现有记录不足以确定其因果。离线结果不改变 A 的验收状态。

历史 Run `7` 的 `consultation` 配置在派发前即不匹配，`9`/`10` 为独立普通答复失败，`12` 在真实写入后产生无来源承诺，`13` 在写入后终稿工具格式无效。现有快照保留；新建 Run 的配置诊断和共享工具合同见[架构](xiaok-specialist-agent-architecture.md)。G 标准现行性继续复用 I6.14 已通过的原始证据。

工程定向 Assistant / Native Workflow / Construction 250/250，回执重验补丁影响范围 17/17，小程序 123/123；新库 PG17 双 Admin 进程、双 Worker、强制 RLS、失效租约、Outbox、回滚及两运行时共享工具验证 8/8；A02/A06/E06 定向 8/8，提交 `a7af6626`。新 LangGraph 测试使用受控模型帧，实际写入并核对公开路由诊断、Run、原始事项 Evidence 和取消后审计留存。原共享队列测试无范围地领取任务，隔离后使用既有企业/Run 过滤，生产领取规则保持原值；双 Worker 仍争用同一条真实任务。B511 复用已有周槽的失败批与历史书桌收纳分开保留。回执离线驱动第一次重放以与 Worker 相反的顺序获取设置及参与人锁，PG17 报 `40P01`。按业务路径先锁设置再重放通过，原诊断保留。

修正旧 I6.14 驱动的角色类型及作品图片的 Buffer 类型，模块行为和清单无变化。TypeScript、作品定向 23/23、ESLint（0 错误，旧驱动 3 个未使用变量警告）、锁文件 Next.js 16.4.6 的 `npm run build -- --webpack` 均通过。生产构建在独立源码副本用 `npm ci` 安装，预构建核对测量镜像 83 个文件、生成 115/115 静态页。最终产品源码 `f6ac48e2468feb07d897313127923f0efd89cd62`，回执补丁构建证据 `webpack-lockfile-history.log`，PG17 回归证据 `native-pg-final-history.log`。此前混用 Next CLI 和旧 SWC 的失败保存在 `webpack-pinned.log`。

## I6.14 防水 Agent 最终验收闭环（Limited）

分支 `codex/xiaok-integration`，起点 `4dd69461`。隔离 PG17 `sfp-xiaok-i67-test` / `xiaok_r6_model_i614`，模型统一为百炼 `bailian` / `deepseek-flash` / `deepseek-v4.1-flash-1017`。范围外的小程序作品图片/`api.js` 等改动未提交。已发布 `waterproof-specialist@1` 与 Workflow revision/digest 未修改。

### I6.14.1 G 标准现行性（released）

- 固定问题“GB 55030-2022 目前是否有效？它什么时候实施？适用于哪些工程？”在隔离库真实模型 Run 通过 8/8 检查：发布公告只支持发布与日期、实施日期来自实施公告、现行状态引用标准目录、适用范围引用正文、标准编号由正确来源支持、未把公告首段当作全部条文依据、不确定处明确说明。
- 实际模型 `deepseek-v4.1-flash-1017`，请求 `d6b67329-2682-977a-aadd-09a72adbec58`，用量 8558/658，Run `succeeded`，单次供应商尝试。证据 `admin/tmp/i6.14/g-standard-01/run.json`、`verification.json`。I6.13 Run `84`/`97` 的失败保留；代码/确定性回归提交 `4fa3b4b1`（`xiaok-i614-std-currency.ts`、`xiaok-i614-g-verify.mjs`、`knowledge-explanation.test.ts`，12/12 + 74/74）。

### I6.14.2 施工端 Stable 提交（released）

- 隔离企业 `1454`、项目 `2`、卫生间 `3`、事项 `8`；施工端 `390×844`、基础库 `3.17.2`、获权施工人员 `6`。Stable 依次完成：项目/事项可见 → 补充资料 → 合成测试图（480×360 JPEG，Hash `c3ce9aa5…`，上传人 `6`，房间 `卫生间`）→ 施工记录 `2` → 成功回执 → 退出重进仍见记录与原件。
- 证据 `admin/tmp/i6.14/scenario-02/worker-ui.json`、`worker-reentry.json`、截图 `01`–`06`。合成图明确标记 `NOT A REAL SITE PHOTO`；提交成功不自动标记验收合格。
- 未通过正式 Native Workflow 服务创建绑定 `waterproof-specialist` 的工作流 Run：本隔离库 `native_workflow_runs` 为 0，该子项 `not_run`。

### I6.14.3 业主持续跟进授权（limited）

- 普通防水问答在会话 `6` Run `8` 成功回答，未创建委托（会话 `6` 委托数 `0`）。
- 新隔离会话 `11` 中明确发送“帮我持续跟进卫生间防水管根处理”：创建 1 个 `rectification_review` 委托 `0bd0083c-…`（项目 `2`、房间 `3`、subject `防水管根处理`、requester `3`），回执“已登记，等待核对当前资料”与“等该事项的获权资料或回传依据”可见；退出重进一致。
- 发送“取消防水管根处理的跟进”后 `state=cancelled`、`next_wake_at=null`、取消事件 `59`（`sourceMessageId=56`），重进仍见“已取消”；`origin_message_id=53` 唯一，无重复任务。证据 `owner-delegation-ui.json`、`owner-delegation-db.json`、截图 `28`–`33`。
- **limited 原因：** 该轮终稿被 `invalid_model_answer` 拒绝，Stable 显示“这次回答没有完成”；另两次同类问题被 `unsupported_model_commitment` 拒绝（Run `9`/`10`/`12`）。
- **运行时根因：** 企业 `1454` 的 C01 默认走 `xiaok-native-executor-v1`，该执行器不提供 `start_delegation`；加入 `consultation` 绑定还会触发 `assistant_model_configuration_invalid`（Run `7`）。本轮在 LangGraph Agent 运行时完成授权验收（临时移除本地 `agentV2` 绑定，原文件备份 `admin/tmp/i6.14/runtime.private.backup.json`），未改生产默认值。

### I6.14.4 四端同一事项（limited）

- 同一事实：项目 `2`、房间 `3`（卫生间）、事项 `8`、施工记录 `2`、复核记录 `3`、lifecycle `28` revision `2`（`resolved`）。
- 施工端：Stable 提交照片与记录；项目经理：Stable 核对发布记录 `2`，正式复核 `resolved`（reviewer `7`，evidence `25`）；老板端（admin `4`）：Stable 读取项目、房间、记录与已解决事项；设计师端（admin `5`）：Stable 读取项目（设计协作），事项非设计相关，未被强制参与。
- **缺失：** 无 `native_workflow_runs`，无法固定同一 `workflowRunId`/Workflow Version；事项 `8` 未绑定 `customerId`/`conversationId`，业主端看不到该复核结果。四端整体 `limited`。
- 证据 `boss-views.json`、`designer-views.json`、`manager-review.json`、`manager-resolve.json`、截图 `34`–`36`。

### I6.14.5 PDF 引用（released；历史重放 not_run）

- 会话 `9` 的答案生成真实 PDF 引用 `w:11:4`：`建筑与市政工程防水通用规范.pdf`，PDF 第 31 页（共 40 页），原文为 5.6.1–5.6.3；Stable 点击后显示标题、页码、原文与读取时间，退出重进再次点击一致。证据 `citation-ui.json`、截图 `37`–`39`。
- I6.13 的会话 `70`/Run `99`/`w:99:1` 资产在本隔离库不存在，精确重放 `not_run`；Reader 超时与 410 撤回的 Stable UI 模拟本轮 `not_run`，服务端分类证据仍引用 I6.13。

### I6.14.6 回归

- `npm run test:assistant` 仍见历史失败 A09/A11/E03/E06/A06 与书桌收纳；并行执行另见 A02/A06 多条 `claimJob()` 返回空（`assert.ok(lease)`），属跨文件队列争用，串行复跑未完成，不能归因为本轮新增回归。
- 小程序 `2242/2245` 基线未重跑，保留两个范围外 `api.js`/作品图片 Hash 改动与一个测绘 Phase 0 失败，均不纳入本切片。
- TypeScript/定向 ESLint/生产构建本轮未在中断后完成，文档不宣称通过；V1.1 前需补跑。

### I6.14.7 真实工地照片（not_run）

- 无合法授权真实素材；继续保留合成图、DeepSeek Flash 图片输入、服务端观察解析、Hash 与撤权链路。未用合成图冒充真实工地，未据单张照片判定隐蔽工程合格。

### I6.14.8 V1.1 评估

- V1 Agent/Workflow 冻结不变；V1.1 建议新建 Agent Version 与 Workflow Revision：native executor 接入 `start_delegation`（或明确 C01 只走 LangGraph）、事项绑定业主会话以回传复核结果、隔离夹具创建绑定 specialist 的 Workflow Run、终稿守卫减少登记回执误拒。
- 交付状态按 [第一版交付冻结](xiaok-waterproof-agent-v1-release.md) 第 13 节如实区分 `released` / `limited` / `not_run`。

## I6.13 防水 Agent 最终验收与真实业务体验补齐（Limited）

起点为 fetch 后的 `origin/codex/xiaok-integration@4a89463face8`，Integration 工作树与该提交一致。本轮代码提交 `9156e9a0`（解释修复精确定位数字/状态缺口）。隔离 PG17 `sfp-xiaok-i67-test` / `xiaok_r6_model_i612`，百炼 `bailian` / `deepseek-flash` / `deepseek-v4.1-flash-1017`，真实调用记录 Run `83`–`99`，实际模型均为 `deepseek-v4.1-flash-1017`。范围外的小程序与 `portfolio/catalog.ts` 未提交修改保持原样，未纳入本切片。

### I6.13.1 B/G/H 真实模型失败根因

- **B passed。** Run `83`（会话 `59`）保存 509 字、2 条公开引用。根因不是管根机理本身，而是语义复核看不到服务端对 `advice` 段的“一般建议”展示标识，把无引用的通用机理解释判为无据。复核合同改为：`advice` 已由服务端标注为一般建议，只要不含具体数值、企业规定、现场事实或正式结论，无引用也可以是正确身份。保存稿明确分开规范原文、一般机理与项目缺项。
- **G limited。** 依次定位三个真实根因：① Run `84` 把 `GB 50345-2012` 写进只引用公告首段的段落，数字不在本段原文内，触发 `unsupported_model_commitment`；② 修复稿把“目前现行”写在仅引用发布公告的段落，触发 `standard_status_unverified`；③ Run `97` 的修复稿在 `uncertainty` 段使用“状态目录的现行记录”这一范围标签，被状态守卫误判为现行断言。已新增数字/状态精确修复诊断（段号、缺口、同轮 citation 候选），并让状态守卫把“现行状态/情况/结论/信息/记录”识别为话题标签而非断言。Run `97` 原失败保留；同一修复稿在 `tmp/i6.13` 的确定性复现中通过解析。受“每个实质修复最多两次真实模型试验”约束，未再消耗第三次调用，故 G 标 `limited`，不标 passed。
- **H passed。** 会话 `61` 五轮：`H1` 读厨房已发布记录（墙面找平完成、防水待施工），`H2` 更正为卫生间且未使用厨房 Evidence，`H3`/`H4` 以 GB 55030-2022 第 5.6.1、5.1.4、5.1.11 条区分标准条件与一般解释，`H5` 读主卧记录（墙面找平完成、等待下一道工序）。`H2` 的企业知识检索因托管 RAG 未配置返回 `retrieval_unavailable`（历史缺项），但回答未把厨房记录带入卫生间，也未编造进度。

### I6.13.2 公开 PDF 页引用

- **passed（生成 + Stable UI 点击/重进）。** 会话 `70` 的 Run `99` 生成真实 PDF 页引用 `w:99:1`：原件 `建筑与市政工程防水通用规范.pdf`，`sourceLocation` 为“PDF 第27页（共40页）5.1 一般规定”，原文为第 5.1.1、5.1.4 条；文档 SHA-256 `aabd71d70809673a4009fcdbcfc0c759f3a22b1c3566f8022dfea9a7a529dc80`，页文本 Hash `14d854a3…`。
- Stable DevTools 实际版本 `3.17.2`（非任务书写的 3.5.8，未改项目基础库）。业主 `10` 打开会话 `70`，点击 `.citation-chip` 后引用面板显示 `.pdf` 标题、PDF 第 27 页与原文；退出小程序再进入，再次点击同一引用，标题、页码、原文与 Hash 一致。截图与 `verification.json` 在 `admin/tmp/i6.13/stable-pdf/`。
- **passed（服务端 Reader 分类）。** `w:99:1` 在模拟 Reader 超时时返回 `available:false / source_unreadable`，不判为撤回；模拟 410 撤回时返回 `source_withdrawn`，后续读取被阻止。证据 `tmp/i6.13/pdf-reader.json`。Stable UI 内的 Reader 超时/撤回重试本轮未重跑，UI 部分标 `limited`。

### I6.13.3 施工端 Stable 重新提交

- **not_run（本轮 Stable 提交）。** 隔离项目 `10` 的卫生间事项 `190` 已是 `resolved`，没有可补资料的待处理事项；项目未发布施工进度计划，施工端页面 `quickRooms` 为空，无法在真实 UI 进入补充资料表单。I6.12 已通过的服务端/HTTP 提交链路保持 `passed`，但本轮未把它等同于 Stable UI 通过。未自动把照片提交标记为验收合格。

### I6.13.4 业主持续跟进授权 UI

- **not_run（本轮 Stable 再切换）。** I6.12 的服务端授权/取消与委托 `cancelled` 证据仍有效；本轮 Stable 会话 `70` 未重跑开启/取消授权的完整 UI 切换。普通问答未自动创建持续任务。

### I6.13.5 真实工地照片

- **not_run。** 仍未取得明确授权的真实卫生间施工照片；隔离库媒体仍为合成图。未用合成图冒充真实工地，也未据单张照片宣布防水合格。

### I6.13.6 四端业务事实

- I6.12 的四端同源读取（项目 `10`、事项 `190`、C01 `24`）证据保持 `passed`；本轮新增业主会话 `70` 的 PDF 引用读取、施工端项目 `10` 的真实页面读取。本轮未重新跑完整四端同一事项旅程，整体标 `limited`。

### I6.13.7 V1 冻结复核

- `waterproof-specialist@1` / `waterproof-inspection-v1` 未修改；[第一版交付冻结](xiaok-waterproof-agent-v1-release.md)按本轮实际结果更新：B/H、PDF 页引用 UI 提升，G 与施工端/业主 UI 保持 `limited` 或 `not_run`，未把 Limited 能力改成 Released。

### 模型用量与工程

- 新增 Run `83`–`99` 全部实际 `deepseek-v4.1-flash-1017`；B Run `83` 1 次调用、G Run `84` 2 次、H 会话 `61` 8 次、PDF Run `99` 2 次（含修复），其余为检索/评审调用。未记录 API Key 或图片访问凭证。
- 定向测试：知识解释/公开研究/综合守卫 65/65；Specialist 20/20；Construction 108/108；Native Workflow 477/504（27 skipped，0 fail）；Assistant 1063/1069，6 个失败仍为 A09/A11/E03/E06/A06 与既有书桌收纳基线；小程序 2242/2245，3 个失败中 2 个由范围外未提交的小程序 `api.js` 环境值与 portfolio JPEG/Hash 改动引起，1 个为既有测绘 Phase 0 基线。TypeScript、改动文件 ESLint 通过；生产 Turbopack 构建通过（仅既有动态文件系统访问警告）。历史 I6.12 的 Assistant 1061/1067 与小程序 2243/2244 基线保留，不把本轮环境差异计入产品回归。

## I6.12 真实工地验证、Stable 四端验收与防水 Agent 第一版冻结（Limited）

起点为 fetch 后的 `origin/codex/xiaok-integration@eb0fa3da0eba`，Integration 工作树与该提交一致。原 Public 工作树的 `source-manifest.json` 未提交修改保留原样。本轮代码提交 `b37e24f6`（照片观察服务端结构化）。隔离 PG17 `sfp-xiaok-i67-test` / `xiaok_r6_model_i612`，百炼 `bailian` / `deepseek-flash` / `deepseek-v4.1-flash-1017`，检索使用已批准回环 OpenSERP 0.8.17/Baidu，Reader 使用工作树 `scripts/assistant-public-reader.py`（crawl4ai 0.9.2 + pypdf 6.21.2）。

### I6.12.1 真实工地照片

- **not_run。** 隔离库全部媒体仍为 112×80/320 字节或 480×360/约 3.8 KB 的合成图；开发库 `smart_floor_planner` 的 `construction_site_media` 为 0 条。没有合法可用的真实工地照片，未用合成图冒充真实工地。
- 照片信封仍要求企业、项目、房间、上传人员、原始记录、原件 Hash、当前授权与发布版本；模型不得推断房间。真实照片验收等待有效授权素材。

### I6.12.2 DeepSeek Flash 图片结构化

- **passed（合成获权图）。** 保持 `final_response` `kind`/`text` 工具合同，不扩大 Schema。正文七节固定文本由 `parsePhotoObservationText` 解析；缺失或语义不符时保留原正文，Run 步骤 `agent_photo_analysis` 记 `failed`。未解析时执行一次独立文本归一化调用（`jsonOutput`，同一网关/模型，不重发图片），结果经 `parseSpecialistPhotoAnalysis` 严格校验。
- 真实回执：图片轮 `7137305c-4075-9e54-88ef-5af2c440c974`（2155/786，缓存 1536），归一化轮 `8692e3d3-5965-956f-b5d9-f3177bd25d4f`（682/723），均 `deepseek-v4.1-flash-1017`，Run `8`，`source=json_normalizer`。一次归一化超时为 `unknown`（Run 7），未重放。
- 百炼目录精确 ID 标注 `structured-outputs`/Text/Image；Chat Completions `response_format=json_schema` 实调通过（`chatcmpl-25c67c62-cc9a-9097-b394-1cac476a24e3`，281/139，图片 194）。未改生产默认值与第二套网关。

### I6.12.3 公开规范原件稳定性

- 已保存引用 `w:40:0` 服务端重开、会话重进后再次打开与 Hash `c57f9f01…` 稳定；HTML 快照不触发 Reader 重读。Reader 故障 `web_timeout` / `web_http_410` / `web_http_412` / `web_http_403` 均按原码返回，恢复后同一引用可用。以上为 HTTP/服务端读回，Stable UI 点击同一引用本轮未重跑，标 `limited`。
- 防水 PDF 原件 SHA-256 `aabd71d70809673a4009fcdbcfc0c759f3a22b1c3566f8022dfea9a7a529dc80`，与 I6.10 一致；本轮可核页 `[5,27,28,31]`，`36/37` 未进入本轮已核集合，标 `limited`。页文改写被拒绝为原文证据，重读同 Hash。
- 本轮未保存 PDF 页引用：标准原文引用终稿被 `unsupported_model_commitment` 拒绝，C01 打开 PDF 页的完整 UI 步骤 `not_run`。GB 55020-2021 仍只用第 12、24、25 页有限摘录。

### I6.12.4 固定专业问答

- 固定 A–L 在 `tmp/i6.12/dialogue-03/`。A、C、D、E、F、I、J、L 保存；B `ungrounded_response_scope`，G/H1/H2 `unsupported_model_commitment`，均保留首稿与唯一修复。K 为合成图 `limited`。
- 早批 `dialogue-01` 全部 `web_search_unconfigured`，`dialogue-02` 搜索可用后仍有 5 个失败；均保留，不重放 unknown。规范条件、专业解释、项目事实与正式业务结论由同一语义合同区分，未把条件说成已验收。

### I6.12.5 防水工作流三路径

- 路径 A：C01 `24`、Run `specialist:f2c85065-a031-4da4-98cc-8d203a8ddbeb`、revision `1`/digest `a34557…`、事项 `190`、经理复核、C01 结果；重复 tick、错房间、非经理复核均被拒。
- 路径 B：C01 `27`、revision `3`/digest `44f15a…`、`request_material` 后等待 `site_record`，缺企业条款与同房间记录。
- 路径 C：C01 `29`、事项 `233`、revision `3`、结果消息 `154`，同业主另一咨询无结果；取消 C01 `33` 后委托 `cancelled`。
- 旧 Run 绑定启动时 revision/digest，发布新版本不改变原定义；Worker 在等待时释放租约。

### I6.12.6 Stable 四端

- DevTools CLI，逻辑窗口 `390×844`，基础库 `3.5.8`。业主 C01 `24` 读到经理复核结果，退出重进仍见同一结果；施工端项目 `10` 读到管根事项；老板端读到复核；设计师端 `0` 个项目，未被强制参与。截图与 `verification.json` 在 `admin/tmp/i6.12/stable-04/`。
- 四端读取同一 Construction 事实；未在客户端维护独立正式状态。施工端在 Stable UI 重新提交照片/现场记录、业主再次切换持续跟进授权本轮未重跑，标 `limited`（提交与授权链路已由工作流 A/B/C 的服务与 HTTP 证据覆盖）。真机、BLE、真实微信登录 `not_run`。

### I6.12.7 冻结

- [第一版交付冻结](xiaok-waterproof-agent-v1-release.md)记录 Agent `waterproof-specialist@1`、输入输出 Schema、Knowledge Scope、Tool Permissions、`waterproof-inspection-v1` 节点版本、清单/Evidence/事项/复核/回传合同与复制方式。只有真实业务验收通过的能力标 `released`，其余 `limited`/`draft`/`not_run`。

### 模型用量与工程

- 隔离库 143 次供应商尝试，143 次实际 `deepseek-v4.1-flash-1017`；观察 363,328 输入 / 30,347 输出 tokens，1 次 `unknown`，金额未返回。未记录 API Key 或图片访问凭证。
- Construction 定向 108/108，Specialist 20/20，照片信封 20/20；Native Workflow 1 个既有路由测试失败（`period-report-status-route` 期望 403/`run_scope_unavailable`，实得 404/`run_not_found`）。Assistant `1061/1067`，6 个失败（A09/A11/E03/E06/A06 与既有书桌收纳）；A09/A11/E03/E06/A06 在带真实隔离数据的库上运行，和小程序全量 2,243/2,244 的既有测绘基线一并保留。TypeScript、改动文件 ESLint、生产 Webpack 构建通过。

## 2026-11-13 只读审查

| 引用 | Fetch 后提交 |
| --- | --- |
| Bailian `codex/xiaok-bailian-responses-api` | `113043445e0675bbc4e05d92fe4a338c8b6262fa` |
| Native `codex/xiaok-native-workflow` | `e3b9a2df6d012dfdda92d2bd3fb95bcb4a3b8c86` |
| Public `codex/xiaok-public-site-lifecycle` | `44ea5f4434213d6fd7b802cbfa6626602653d034` |
| `origin/main` | `f273b57171d6dab5c3b8beef1fe124e634d51864` |

三线共同祖先是 `c190fd3fe7339b4914f9f9f7ea5b4e963b56a745`。Bailian 与 Native 还共享 `11ac22ddcea422d3d69358b7a2fe221c13487dd7`。`main` 是三线的祖先，相对各线的独有提交均为 0，各线超前 469 / 466 / 460 个提交。以三线共同祖先创建 `codex/xiaok-integration`，按 I1 Bailian、I2 Native、I3 Public 合并并保留父提交。初查本地及远端均无同名分支。原 Public 工作树的 `admin/src/lib/survey-runtime/source-manifest.json` 有未提交修改，集成使用独立工作树。

### 文件与合同冲突

- 以两线对应共同祖先比较。Bailian/Native 交叉修改 21 个路径，Bailian/Public 24 个，Native/Public 38 个，三线同时修改 16 个。只读 `git merge-tree` 分别预报 14、8、26 个文本冲突。三线同时修改的代码包括 Assistant `synthesis.ts`、`worker.ts`、`conversation.ts`、`knowledge/sources.ts`，Construction `report-body-worker.ts`、`service.ts`、`site-chat.ts`、`site-queries.ts`、`site-results.ts`，以及小程序 `assistant/lib/chat.js` 与对应测试。另有四份模块清单与唯一计划。
- I1 以 `AgentModelGateway` / `ModelTurnInput` / `ModelTurnOutput` 承载双协议。配置默认走现有 Chat Completions。Responses 和原生工具依模型能力显式启用，名称冲突、用量和中断状态须有回归。Public 的原生执行器涉及对话运行、回调串行化及引用复核，合入时核对模型派发与恢复的真实调用点。
- I2 两线在 `delegation-state.ts`、`delegation-store.ts`、`delegation-worker.ts`、`delegation-chat.ts` 为新增/新增冲突。Bailian `delegation-sources.ts`、`delegation-knowledge.ts` 提供可撤回的材料与工艺证据。Native 持有房间任务、定时唤醒、租约、报告状态及工具持久化。Construction 的记录、事项、图纸与角色权限仍是业务事实。统一调度需兼容两种委托来源与原会话回执。
- I3 冲突集中在 Assistant 的请求上下文和 Worker、Construction 的设计需求/计划/事项/整改投影、小程序项目与会话。保留 Public 的已批准设计及公开来源失效合同，与 Native 的四端同源数据和 durable receipts 对齐。核查两份还原台账的当前路由行。
- Bailian、Native 在分叉后没有改动 `admin/package.json` 与 `admin/package-lock.json`。Public 成对升级 Next.js `16.2.3 → 16.4.6`、sharp `^0.34.5 → 0.35.5`，并变更 `tsconfig.json`。I3 统一使用 Public 锁文件和独立安装，构建与类型检查分别记录。

### PostgreSQL 迁移

共同 Journal 共 120 条（idx 0–119），尾项是 `0120_construction_camera_sd_identity_version`。此前已有 `0115 → 0114` 的历史依赖顺序，按 Journal 时间戳保留。

| idx | 时间戳 | Bailian | Native |
| --- | --- | --- | --- |
| 120 | 1795075200000 | `0121_assistant_rag_scope` | `0121_native_workflow_delegations` |
| 121 | 1795161600000 | `0122_assistant_managed_knowledge` | `0122_native_workflow_runtime` |
| 122 | 1795248000000 | `0123_assistant_long_term_delegation` | `0123_native_workflow_durable_tasks` |

- 依赖。共同 `0060` 的知识 chunks → 项目/企业作用域 → 托管库及文档导入。共同 Assistant 会话消息、Construction、Outbox → 长期记忆和委托。Native runtime stores 与 durable tasks 还依赖租户和 outbox delivery。两份委托 DDL 创建同名委托、事件表、索引、RLS 与投递触发器。Bailian 按 `owner_id/current_status/evidence`，Native 按 `requester_id/state/tasks`，历史数据要保留业务意图、原消息、审计以及未知副作用。
- 历史 `0060_assistant_knowledge.sql` 在 Bailian 被改成 pgvector 可选，另有无向量初始化通过记录。集成以共同已用 SQL 为正本，历史 Bailian 变体保留作核查。已安装 Drizzle 按账本最大 `created_at` 选择待执行迁移，直接拼接 Journal 会漏掉同时间戳条目。I2 要把历史分支文件及校验保留并采用严格在冲突尾部之后的兼容迁移，以实际 SQL 执行记录生成新账本条目。
- 经现有回环转发只读核对，开发主库有 119 条，隔离评估库有 118 条，两者最新为 `0119`，未见分支委托、Native runtime 或托管知识表。两库的 `0021`、`0051` 历史 hash 与当前仓库不同，保持原样。两库尚未迁移。
- 本机 Native 隔离实例实查到共同基线 120 条、应用原始 Native 委托 121 条，以及应用三个 Native SQL 的 123 条账本。另有保留失败/中间库在两个 runtime 时间戳写有不同 hash（`6c42ecee7bca…`、`b323e1d7b876…`），不可按时间戳判定已应用新版。Bailian R6 已停止实例的隔离副本实查原 123 条迁移、2 条委托和 27 条事件。保留原始 `tmp/r6` 证据与无向量初始化记录。
- 升级验证需覆盖全新 PG17/pgvector、已应用 Native 和已应用 Bailian 的隔离库，校验原账本不变、DDL/RLS/触发器、业务数据以及重跑。任何未知 schema 或账本差异先归因，再决定能否升级。生产和共有开发库的实际应用不在本次授权内。

### 验收记录

历史各分支报告只覆盖各自的快照。保留 Bailian `docs/evidence/bailian-responses-*.json` 及原本地 R4–R6 证据、Native [B5.10 部署审查](native-workflow-b510-deployment-review.zh-CN.md) 及 B5.11 记录、Public 四端与 Markdown 证据。历史模型失败、unknown、实际用量与环境限制继续在原记录查询。集成当前待验证范围包括双协议真实调用及原生工具、企业引用撤权、项目切换与重进、四端日周报和周槽、设计/整改/关闭、PostgreSQL 多实例与副作用幂等、Stable 原生端与完整构建。生产发布维持独立授权。

| 阶段 | 当前状态 | 核对依据 |
| --- | --- | --- |
| I1 Bailian | 已集成，验收 Limited | 提交 `67443d856fc9acfb361d05b8b1ecf9957c396a62`。127/127 定向单元、85/85 客户端，238 个目标文件 ESLint 零错误。PG17 从空库迁移 123 条，托管知识、长期记忆、委托五张表的强制 RLS 已核。实模 Chat Completions 与 Responses 基础请求通过，联网集成请求超时 unknown。 |
| I2 Native | 已集成，隔离服务验证通过，整体验收 Limited | 提交 `35e34127d532c4ed615a0473b4d35b798e8b5da5`。571/571 单元、7/7 Native 实库和 10/10 R6 合成业务。覆盖双 Admin/Worker、租约接管、四角色同周投递、回执重进、跨租户和故障回滚。 |
| I3 Public | 已合流，整体验收 Limited | 提交 `ad527d465425f79b08b5bdc9128dc3b153cf1556`，父提交为 I2 和 Public。本节后列出集成基线、历史复用和剩余限制。 |

I1 源码索引 `f256cebc1fd57531191a687e67e357e0689acb2f`。完整 `tsc` 的 290 条诊断与 Bailian R6 的 `type-final.log` 逐条一致，其中应用源码两处位于 `report-context.ts`、`period-report-status.ts`。首次 ESLint 命令因相对路径为空实际扫描全项目，保留其中一条基线错误的日志。改为定向路径后通过。首次空库迁移因 migrator 无权安装 vector 失败，由隔离库 owner 显式预置扩展后通过，共同 `0060` 保持原字节。原始测试日志在集成工作树 `tmp/i1-*.log`。

实模固定 `qwen3.7-flash`。本机独立库使用留存的北京百炼开发凭据，首个配置脚本缺历史 catalog 文件，在发请求前停止。复用现有凭据加载器和官方域名校验后配置成功。两次已知成功共 87 输入、453 输出 tokens，实际账单未返回。第三次 `PROVIDER_TIMEOUT` 用量未知且未重放，网页提取与代码解释器后续用例未执行。原请求及结果见工作树 `tmp/bailian-responses/`。托管知识仍缺 R6 专用工作空间配置。

### I2 迁移与运行验证

- 活动依赖图。旧分支路径只用于识别已应用的原始记录，所有升级收敛到同一活动尾部。

```mermaid
flowchart LR
    P["PG17 与预置 pgvector"] --> S["共同 0000–0120<br/>0060 知识与 Assistant、Construction、Outbox"]
    S --> K["0124 项目及企业知识、托管检索"]
    S --> B["已应用 Bailian 0121–0123"]
    S --> N["已应用 Native 0121–0123"]
    B --> K
    N --> K
    K --> R["0125 PostgreSQL runtime 与 Durable Task"]
    R --> D["0126 长期记忆与统一委托"]
```

- 以活动 Journal 的 `0124` 知识 → `0125` Native 存储及 Durable Tasks → `0126` 长期记忆与委托合流为唯一顺序。活动时间戳为 `1795334400000`、`1795420800000`、`1795507200000`。分叉 SQL 与原条目保存在 `admin/drizzle/legacy/`，保留原 tag、时间戳和字节。兼容迁移核对已知原 hash 与表/约束，发现两类原账本混用或未知分叉 hash 时拒绝。原 `0060` 在新库要求预置 pgvector，托管检索本身沿原可选配置。
- 隔离 PG17 全新库 123 条，Bailian、Native 原序列各从 123 到 126 条，相关 11 张表全部强制 RLS。对停止的 R6 原卷取只读副本，确认原 Bailian 三条 hash；实际升级两次，旧账本 123 行、2 条委托和 27 条事件的逐行摘要相同。完成和取消状态映射保持。Native 升级库以原 Native 三条迁移初始化后完成实库写入与双实例测试。历史不匹配的 runtime 变体保留在旧证据库，尚未核准升级。
- Native 使用同一租户锁、Outbox 投递、状态与身份边界。R6 的工艺读取和施工复核接入该消费者，原始副作用回执与重进沿 Construction 和 Assistant。详见[统一模块合同](xiaok-integration-contract.md)。
- 测试索引 `5224f11330621383e9af4249159a74b5434de2b8`。97 个目标文件 ESLint 零错误。首次类型检查发现新增 `safeText` 未导入，已修正；顺带处理两条继承的应用源码类型错误。全量类型与构建随 I3 锁文件一并复验。证据为集成工作树 `tmp/i2-*.log` 与 `admin/tmp/r6/integration-i2-service-01/`。R6 使用测试托管替身和隔离服务，真实模型调用 0，保留 I1 的超时结果。

### I3 业务合流

- Public 的公开版本、历史消息投影与原生执行器沿同一模型网关和权限边界，保留 Bailian 工具、检索与托管资源清理。来源变化触发读回重验，重进及增量读回使用原消息序号和稳定请求键。小程序沿用两份还原台账所列 C01 和工地设计，使用存量方案与关闭回执组件。Markdown 从助手正文生成渲染节点，原消息事实留在服务端。实际冲突清单在集成工作树 `tmp/i3-conflict-hunks.json`。
- 设计核对、精确版本方案、施工回传、整改、复核与关闭从同一 Construction 事件投影读取。房间委托优先绑定已确定的唯一现场事项，仍待确认的设计需求保留独立状态。委托查询重读原指令和当前有权访问的事项。项目更新事务写入同一版本的 Outbox，后置触发器沿同一键去重并保留系统更新能力，原迁移 SQL 与 Journal 未改。

### 集成验收范围

I3 最终运行代码在文档更新前的树为 `6f7a1f035b976d98448dd41ee7fc9bf4029b722e`。受测源码、驱动和配置文件的暂存清单摘要为 `26a6409c738cea305f4916f7539697dd10e170acbec03e7aa18e201955536df0`，最终构建及隔离服务在固定源码下执行。早期测试保留各自的快照和结果。

| 层 | 集成结果 | 本地证据 |
| --- | --- | --- |
| 单元与客户端 | I3 定向单元 235/235，涉及网关、Assistant、Construction 和委托。定向小程序 85/85。全量小程序 2243/2244，唯一失败为测量 Phase 0 facade 的冻结调用清单。原 Public 基线复现同一遗漏 `surveying-editor-autosave.test.js`。 | `tmp/i3-units.log`、`tmp/i3-mini-*.log` |
| 服务与隔离 PG17 | Public/Construction 44/44，覆盖公开与本人项目切换、多轮和历史、撤回、原请求失败恢复、批准方案、整改和关闭。B5.9/B5.10 9/9，包括真实照片与语音回传、四角色状态、两 Admin HTTP 实例、角色及跨租户拒绝、原回执和撤权。R6 11/11，覆盖 PPT 授权工艺及撤回、私有偏好、委托、同源施工原件、Outbox 重试和查询回执重投影。R6 使用模型与托管替身。 | `tmp/i3-services-verified.log`、`tmp/i3-b59-verified.log`、`admin/tmp/r6/integration-i3-verified/report.json` |
| 持久化与日周报 | Native runtime 7/7。双 Admin revision、双 Worker 租约接管、事务失败回滚及运行存储从文件切换至 PG 并回退通过。两进程争用同一周槽只生成四个持久报告任务。另一隔离库用一条现场记录生成四种角色的日报及周报事实，每周期五份（两个企业管理者）。原跟进详情和历史可读，同周期重复投递为 0。 | `tmp/i3-runtime-verified.log`、`tmp/i3-report-delivery.log` |
| Stable DevTools | 官方 Stable 与 `miniprogram-automator 0.13.0`，390×844、基础库 3.17.2，单控制器在独立集成项目次屏。原咨询的授权照片、实际发送委托状态、即时读回与重进通过。已同意图纸及关闭回执原件通过。同版本的单独咨询验证 Markdown 标题、列表、原始正文和重进，模型替身。未完成范围包括四端完整界面、公开直播和真机。 | `tmp/i3-stable/r6-native-verified/verification.json`、`tmp/i3-stable/native-markdown/verification.json` 及同目录截图 |
| 配置模型 | I1 真实 Chat Completions 和 Responses 基础调用各通过一次。Responses 联网超时 unknown，未重放。原生联网、提取、代码执行和真实托管 RAG 缺本轮成功证据。I2、I3 实库及 Stable 使用替身或确定性流程。 | `tmp/i1-live-*.log`、`tmp/bailian-responses/` |
| 构建与部署 | Next.js 16.4.6 Webpack 生产构建与独立 TypeScript 通过。153 文件 ESLint 0 错误、25 警告。本地 standalone 连接隔离 PG 并返回健康状态，未认证请求返回 401。生产环境尚未发布或验收。 | `tmp/i3-webpack-verified.log`、`tmp/i3-type-verified.log`、`tmp/i3-lint-verified.log`、`tmp/i3-standalone-verification.json` |

早期 Stable 保留了实库写入成功而回执被旧权限投影隐藏的记录。补齐真实读取后，撤销与恢复项目授权通过；此前同一项目更新触发器与应用发出重复键的原失败保留。带图纸和关闭回执的 Stable 批次中 Markdown Worker 前置状态失败，后用与 R6 一致的配置和独立合成咨询完成渲染及重进。重复使用同一个已领周槽的 Native fixture 曾被前置校验拒绝，旧库保留，新隔离库重新执行通过。

交付检查确认 I3 合并提交的 Admin 和 Mini Program 源码与最终受测源码一致，迁移文件与 I2 一致。原 Public 工作树的未提交修改保留。测试结束后释放 Stable 控制器和集成窗口，清除本轮隔离库中的临时百炼配置并停止两台集成测试容器。测试卷和原始证据保留。

上线前需在获准环境核对实际迁移账本、配置和备份恢复，补足联网与托管实调及目标设备验收。生产发布仍需独立授权。

## I4 数据库兼容性

起点为 `5881f89f8c7205c593b8755aaa4252f56d73c8ab`。Fetch 后三条原始分支各有 0 条 Integration 之外的提交。独立 Integration 工作树起点干净，原 Public 工作树的测量清单改动保留。

隔离库复现两个基线失败。同一原消息含不同操作键的两条 Bailian 委托时，`0126` 在全表来源唯一约束处返回 `23505`。未知新时间戳的真实 DDL 及其 hash 让旧迁移命令跳过集成并报告成功。普通 Bailian 原库升级缺两个水电查询索引。原始日志在 `tmp/i4-i5-20261113/i4-baseline*.log`。

`0127` 兼容原 Bailian 同源委托，补足索引和统一触发器。空库及 Native 原库继续执行原 `0126`。完整 Bailian 原库走 `0127` 的兼容升级，已执行 `0126` 的库直接前进。原 SQL、已执行账本及委托的身份、来源、原事件、投递和未知状态保留。迁移入口锁定并检查完整账本及委托表形态；历史 hash 的差异必须在隔离快照中核对后才能升级。实际测试使用 PG17.10 的专用环回容器和合成数据，`sfp_migrator` 执行 DDL，`sfp_app` 执行读写和跨租户拒绝。执行入口、限制和回退见[集成合同](xiaok-integration-contract.md#数据迁移与回退)。

在 `b612ea0692acc5fac62ca8487029196bec7809cb` 执行 `admin/scripts/__tests__/xiaok-integration-migrations.test.mjs`，6/6 通过。三条路径分别用全新 PG17、原 Native SQL、原 Bailian SQL 初始化。附加用例包含没有 vector 扩展的 Bailian 同源记录、已执行 `0126` 的库及未知 hash 拒绝。逐字段核对 Native 10 种和 Bailian 11 种旧状态、原事件和原投递状态。核对 11 张表的强制 RLS 与应用角色权限、10 个索引及 4 个触发器。Native 升级后的快照恢复到同容器独立库，127 条账本、13 条委托、11 条事件、13 条投递和 1 条持久任务摘要全部匹配，跨租户读回 0 条。证据见 `tmp/i4-i5-20261113/i4-final.log`、`i4-binding.txt` 和 `i4-restore.json`。

## I5 业主原咨询与持久执行

Agent 在原咨询读取当前获权项目、阶段和房间，通过 `start_delegation` 登记跟进。登记在原咨询去重，整条指令只触发单项登记时可以采用已保存的登记回执。Native 使用同一委托主记录、Outbox 消费者和 PostgreSQL Durable Task 租约。Construction 沿正式业务服务处理设计师核对、施工原件、事项版本与管理者复核。Conversation 保存结果及原件授权，C01 重进重新投影。

I5 验收以 `b612ea0692acc5fac62ca8487029196bec7809cb` 为基线，测试前后应用源码、测试、迁移和小程序的 3502 个文件内容摘要均为 `41235c05009a6fff358cc6fbeee51056fd9bd48cb987b9f605b153e10f45840d`。定向后台测试及构建的工作树差异指纹为 `7237c324b59abd8eab1311e87e8bd89a9e590810`，新增 `delegation-execution.ts` 的 SHA-256 为 `4cf03a8c890f4fdac6dbb178ff635bc3942fd3d3dae9e5d73732f11dbef595b`。服务、模拟器和模型固定用例使用同一专用 PG17.10 容器的隔离合成库。`*.binding` 及原始报告在 `tmp/i4-i5-20261113/`。

提交可按 Git 子树核对。`admin/src` 为 `0391f1e082252bc20112b32463b1fe356ca5031d`，`admin/scripts` 为 `85d0bd17cd52a731594fd356fde28dbe9a4750cf`，`admin/drizzle` 为 `397b0b05e3e3409d407bdf454ea95425e849593e`，`miniprogram` 为 `21dad1fdd62127d9f91ccf976159ea6e0da2c850`。

| 层 | 状态与本轮证据 |
| --- | --- |
| 定向单元、客户端 | 通过。Native 和 Assistant 109/109，Construction 13/13，小程序 Chat、跟进与 Markdown 84/84。 |
| PostgreSQL 与多进程 | B5.9/B5.10 10/10，两个独立 Admin HTTP 进程、两个 Worker、进程被终止、已过期租约拒绝及重复事件均通过。重领后的尝试为 `timed_out → succeeded`，同一事件链接及消息各写入一次。B5.11 在新隔离库 7/7，先前复用已领取的周槽导致的失败保留。B5.8 水电及事件重试 9/9，历史实模续轮用例未运行。 |
| Agent、Construction 与权限 | 通过。`xiaok_r6_acceptance_i5delivery` R6 14/14，签名会话和真实 PostgreSQL 写入。同键重发、独立咨询、原项目/房间/阶段、团队角色和跨企业权限、设计师和工人撤权、事项旧版本及原咨询回传通过。原咨询 2 收到消息 43，关联事项 46、方案 52 和现场记录 3。语言模型、托管检索和图片整理使用替身，施工结论由获权角色经正式服务写入。证据 `admin/tmp/r6/integration-i5-delivery/`。 |
| Stable C01 | 通过。Stable 2.02.2608080、基础库 3.17.2、逻辑 390×844。从 C01 输入原业主需求，消息 7 发起 run 4，同键重发沿用原请求。使用相同的 14 项服务断言执行至获权团队回传，退到首页重进后读取原咨询 2 的结果 43 和原图。证据 `admin/tmp/r6/integration-i5-native-c01/native-owner-journey.json`。独立批 `stable-delivery/verification.json` 的查看委托、退出重进及撤回后回执失效 5/5。两批截图均为 363×785。 |
| 配置模型 | 百炼 Responses `qwen3.7-flash` 首批第 1 条在选中正确工具和房间后因跨咨询复用与终稿形态失败（run 11，`invalid_model_answer`），第 2 条未执行。两次已接受调用共输入 11040、输出 6436 token，其中缓存输入 5120。修复后固定卫生间和厨房两条用例 2/2（run 12、13），各 1 次调用，共输入 10743、输出 1882 token。两批货币用量均未知，分别保留 `i5-configured-model.json`、`i5-configured-model-verified.json` 和对应日志、绑定。 |
| 质量 | TypeScript、受影响 ESLint 和生产 Webpack 构建通过。完整 `postgresql-integration.test.ts` 61/62，唯一失败是继承的索引检查。相同 SQL 在升级前后均得到同一组 151 个缺索引列，见 `i5-postgresql-final.log` 与 `pg-index-baseline.json`。 |

原 R6 失败和环境前置结果保留在 `tmp/i4-i5-20261113/i5-r6-*.log`。合成 unknown 留在 `indeterminate`、预约待对账和零新增委托，原请求重发仍沿原 run。Stable 的输入时机、失效页面引用、项目路径和测试驱动失败保留在同目录 `stable-*.log`。模拟器使用临时签名及传输覆盖连接隔离服务，运行后恢复覆盖和项目配置原字节。地图服务缺配置使隔离环境定位支线返回 503。真机、BLE、真实微信登录、真实托管和联网以及生产环境未执行。历史 I1 unknown 请求保持原记录。

## I6 真实模型与获权知识验收（Limited）

起点为 fetch 后的 `origin/codex/xiaok-integration@accc750093973a8c79f799a2bd9cdb8c6f9e4794`。集成工作树独立，原 Public 工作树未提交修改保留。隔离 PG17.10/pgvector 使用 `sfp_app` 和合成微云 1454。独立 OpenSERP 0.8.17/Baidu 及配置模型使用开发凭据。托管预检在请求前返回 `bailian_knowledge_not_configured`，缺专用工作空间和 API Key。

### I6.1 联网与引用

| 检查 | 结果与证据 |
| --- | --- |
| 百炼原生工具 | `qwen3.7-flash` 的 Responses 同请求观察到搜索及提取，另一次真实代码解释器返回 1728。历史 I1 `PROVIDER_TIMEOUT` 仍为 unknown，未重放。提取回执中两个段落的来源顺序与 URL 列表相反，现按段内来源绑定，歧义段计为未归属。百炼工具输出为摘要，C01 引用使用应用读页原文。 |
| 应用搜索、读页及保存 | 在 `current-first` 和 `current-repair` 实际搜索并读到住建部公告。run 2 以同一会话打开持久引用，已核实来源网址、标题、读取时间及公告原句。首次业务失败 `unsupported_model_commitment`；修复版虽然保存，仍把旧公告的条文当作今天有效。run 3 追问时模型请求未开放工具，`assistant_capability_forbidden`，未执行该工具。 |
| 防水规范 | `workmanship-first` run 4 真实搜索。候选页未能读取，模型首稿在无来源时给出具体水深、时间及工序，终稿守卫拒绝。后续管根问题未执行。本批没有把第二次搜索命中或任何摘要计为条款证据。 |
| 重开及变更 | C01 完整历史及点开引用用原 reader 检查正文版本、撤除和网络故障，在 I/O 前后验证会话及快照。隔离数据库 7/7，含改页、其他客户和跨租户、历史清理及失败反馈。快速 Responses/网页测试 67/67。 |

原始首稿、唯一修复批和实际请求回执保存在集成工作树 `tmp/i6-20261113/web/`、`tmp/bailian-responses/report-i6-native-tools.json` 及对应 `raw/`。旧公告与后续废止公告的差异由人工对照确认，事后对照没有补入原运行 Evidence。停止对首问重复取样。现行性仍需能读到正式状态或更新文件，历史公告的上线日期和当时条文只能支持历史陈述。[GB 55032-2022 公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2024/art_17339_767714.html) · [GB 55038-2025 公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2025/art_66adac27fa2144bb86f98fe4c297efd6.html)

独立诊断复用了本机既有公开原文服务。两份住建部公告可读。防水规范附件超过当前下载上限，给排水规范附件返回 28 页但没有可提取文字。探针使用已运行的开发 reader，其源码 hash 与 Integration 文件不同。诊断原样保存为 `tmp/i6-20261113/public-reader-official-probe.json`，没有输入模型或加入企业库。[防水规范发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html) · [给排水规范发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2021/art_17339_762458.html)

应用批次 15 次已完成供应商调用，共 52,273 输入、3,776 输出 tokens，其中缓存输入 8,832。原生提取请求 `5d30658a-debe-9aef-9fb2-a80be46d25b2` 计 7,285/2,264 tokens，含缓存输入 1,920，报告 1 次搜索和 1 次提取。代码解释器 `d71cca44-25f2-9291-843a-498d7f117206` 计 824/166 tokens，执行 1 次。实际结算金额未返回。

### I6.2 本地企业知识与持续委托

- `integration-i6-local-final` 使用真实本地 Embedding/pgvector、同一 KnowledgeRetriever 和 PostgreSQL Durable Task。业主召回 PPT 第 18 页第 3、5 行，保留项目、版本、片段 hash 和定位。业主、设计师、工人、老板的实库查询各报告 28 输入 tokens。对照项目不返回此资料；跨租户和撤销成员权限受原服务约束。对话模型与故障注入是替身。
- 正式版本替换后旧引用和旧委托核对结果失效。下一个项目事件走原 Dispatcher 重新检索新版本，撤回后重新核对为 `no_match`。工人原图不使事项自动完成。授权人员核对后，正式结论和获准原图回原咨询。原请求重发、租约接管与故障恢复沿同一业务键。
- 企业知识关闭在检索前拒绝。开启而托管缺配置时返回 `retrieval_unavailable`，保留 `bailian_knowledge_not_configured` 且无请求 ID。配置缺口与有权限但查无结果有各自状态。托管请求为 0，仍为 Limited。
- 原始回执在 `admin/tmp/r6/integration-i6-local-final/`，含 `retrieval-scopes.json`、`version-recovery.json`、`formal-result.json`、`durable-steps.json` 和注入 unknown。PPT 仅写明项目团队安排防水施工和后续检查。材料、管根做法、验收阈值和铺砖放行条件没有获准企业原文，不能由相似检索或模型补成企业条款。

### I6.3–I6.5 固定自然对话

以 C01 的签名 HTTP 请求、原 Worker 和北京配置模型执行。公开资料用应用工具，企业资料用真实 Embedding/pgvector。首次测试把 PPT 片段绑在合成项目。B 首轮的模型显式选 `scope=enterprise`，按约定排除了项目文档。修复批按原题将同一已核 PPT 内容作为企业通用资料发布到新隔离库，项目范围仍由 I6.2 的独立对照保留。当前工具说明明确了省略范围的语义。C 修复只开放原业务查询的施工域，并将指定房间限制到唯一在施工项目及向业主发布的原记录。两批请求绑定无源码漂移。

| 固定场景 | 首批 | 一次定向复验 |
| --- | --- | --- |
| A 管根、防水、铺砖 | run 2–4。前两轮未查依据且把施工做法说得过于确定。第三轮引用了确实支持团队安排检查的 PPT 原文，但未给出可核查的铺砖放行条件。 | 未执行。企业资料没有这些条件。公开防水原文测试见 I6.1。 |
| B 企业做法与国家通用要求 | run 5 查询范围为空，首稿及唯一修复仍补了无据高度和闭水时长，拒绝保存。第二问未执行。 | run 3 引用 PPT 第 18 页，保留具体参数缺项。run 4 仅检索企业来源，未完成公开标准原文核读，首稿及修复仍被拦截。 |
| C 真实水电和主卧进度 | run 6–7 返回固定现场引导，未使用已发布事实。 | run 5–6 读取项目实际水电节点与主卧待核对记录，排除厨房完工对照。两条首稿后的结构/来源修复均保留。房间记录撤回后旧派生答复不可用在隔离服务复核。 |
| D 插座设计协作 | run 8 使用现场团队引导；没有根据该咨询的正式图纸版本给出解释。run 9 按业主明确请求创建主卧插座委托，返回登记回执并等候获权协作。 | 未追加实模。真实 Construction 精确版本与原咨询回传单独通过。 |
| E 房间更正 | run 10 的无据工艺答复被拦，纠正问未执行。 | run 7 保存一般建议；run 8 的查询已转为卫生间，首稿仍重问且补无据高度，唯一修复仍补无据高度，终稿失败。该更正轮没有写长期记忆。 |
| 私有偏好 | run 11–12 保存本人沟通偏好，新咨询正确读回“先告诉我结论，再说细节”。 | 复用首批证据。 |

首批 18 次供应商调用，84,349 输入、16,168 输出、8,960 缓存输入 tokens，检索 Embedding 105 输入 tokens。修复批 19 次供应商调用，93,564 输入、12,974 输出、0 缓存输入 tokens，检索 Embedding 164 输入 tokens。实际结算金额不可得。源首稿、每轮唯一修复、请求 ID、工具输入和实测用量分别保存在 `admin/tmp/r6/integration-i6-live-configured/` 和 `admin/tmp/r6/integration-i6-live-repair/` 的 `turn-*.json`。早期配置试跑本地密钥不可解密，未发供应商请求。B 对比及 E 缺少支持工艺量数的适用原文，停止重复采样。模型能力和代表请求见[模型矩阵](bailian-responses-adapter.md#14-i6-模型能力矩阵)。

### I6.6 业务回传与工程检查

- 通过。最终隔离 R6 批 `integration-i6-project-status-final` 16/16，含真实 Embedding、房间记录过滤、撤回后历史隐藏、阶段记录与房间记录独立、四角色及原咨询正式回传。业务链使用替身模型。受影响 Assistant、Responses、RAG 与 Native 快速测试 219/219，小程序最终定向 341/341，Construction 设计核对、施工计划/整改及自然语言正式方案合计 21/21，网页实库 7/7。专业 RAG 实库 11/11，包含阶段适用条件、阶段变化、检索中途撤回。项目资料 10 通过、1 跳过。TypeScript、受影响 ESLint 与生产 Webpack 构建通过。
- 失败。较广 Assistant 批 1033/1034，失败的「书桌收纳」测试及其实现与基线相同。历史资料及专业检索夹具默认关闭知识，首次失败后显式开启测试企业开关并保留原日志。混合现场测试改用现行 RAG 工具，继续断言现场分流后不能再读档。正式方案夹具改用已有隔离端口参数，仍只准环回 `xiaok_embedding_eval`。夹具调整没有改运行时。证据 `tmp/i6-20261113/{materials-final,professional-knowledge-final,isolated-professional-construction}.log`。
- Stable C01。逻辑 390×844，截图 363×785。通过实际点击打开配置模型保存的 PPT 引用及独立联网批已保存的住建部历史公告引用，显示原句、网址和读取时间。另在同一获权咨询实际发送两条项目进度追问，并退出后读到同两条答复；此批 Worker 使用替身模型和真实 Construction 读取。原咨询 2 中的真实复核结果 43、授权原图和实际发送的委托状态回执 64 均在重进后可读。固定 A–E 的实模连续界面未执行。前序夹具、输入和轮询驱动失败保留。证据 `tmp/i6-20261113/{stable-citations-final,stable-delegation-final,stable-web-citation}/verification.json`。
- unknown。I1 供应商超时原回执保持待对账。R6 故障注入的未知状态单列，未重放原请求，也未当作真实供应商调用。
- 环境阻塞。百炼托管库缺专用配置。
- 未执行。真机、真实微信登录、BLE、额外资料试验模型及生产部署。

## I6.7 专业规范证据链（Limited）

### I6.7.1 附件读取与逐页覆盖

- 集成基线 `ab0a018e93ba37ac367ed8f8ee503d17dbef489d` 与抓取后远端一致。使用已有集成工作树。住建部防水附件 5,659,379 字节，三个 ETag 绑定分段，原件 SHA-256 `aabd71d70809673a4009fcdbcfc0c759f3a22b1c3566f8022dfea9a7a529dc80`。给排水附件 3,978,385 字节，SHA-256 `d84b943144c51db7bbc8029493a39fe6a98358e81f19d5480da9f2459cea0112`。新版 reader 对原件的 40 页及 28 页均识别为需要 OCR。目视核对发现 selectable 层只有重复的浏览水印，条文存在于扫描图。原件、页覆盖、失败和读页源码绑定保存在集成工作树 `tmp/i6.7/`。[防水发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html) · [给排水发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2021/art_17339_762458.html)
- 58/58 定向 TypeScript 单测及 3/3 Python 检查，覆盖原文范围、扫描状态、分段版本失败、DOCX 与本地 PDF 解析。首次测试发现旧样例期待空页进入 Evidence，保留原测试结果。空页保留在私有原件，引用目录只收可读文字。扫描条文的获权回读与固定场景验收继续进行。

### I6.7.2–I6.7.5 依据、原话和项目权限

- 防水附件按真实扫描页核对六页摘录。PDF 第 5、27、28、31、36、37 页覆盖工程范围、开工前基层核对、预埋、下一工序、管根与室内试验。由源站、路径、原件字节 SHA-256、页码和摘录哈希约束。发布公告支持发布日期与实施日期及指定旧条文废止；独立目录列该版为现行。C01 每次复验同一 PDF 时只下载一次再检查各页。未复核的扫描页及给排水附件的全部扫描页仍为 `pdf_ocr_required`。原件与对照在 `tmp/i6.7/{standard-readback,attachments-reader-receipt,ocr-diagnostic}.json`。[GB 55030-2022 发布公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html) · [同版状态目录](https://ebook.chinabuilding.com.cn/zbooklib/book/detail/show?SiteID=1&bookID=154718)
- 实库合成微云与对照租户验证本地 Embedding/pgvector、PPT 通用和项目受众、实时成员权限、版本替换、停用、撤回、历史失效、项目与房间隔离、委托幂等和团队原咨询回传。原知识资料只取 PPT 第 18 页获权工艺。R6 工程回归用替身对话模型，16/16，包括主卧实际记录及撤回后原答隐藏。补充专业检索和网页实库 18/18，Construction 15/15。初次 Construction 夹具缺设计师、工人角色菜单而返回 403，修正隔离夹具后通过。托管预检记录 `retrieval_unavailable` / `bailian_knowledge_not_configured`，请求 ID 为空，托管请求 0。证据 `admin/tmp/r6/integration-i67-{rooms-rag-native,hosted-result}/` 与 `tmp/i6.7/{isolated-services,construction-recheck}.log`。
- Stable 原 C01 在次屏的 390×844、基础库 3.17.2，打开保存的真实模型回答并点击第 31 页引用。引用弹层显示章节、逐字原句、读取时间与公开 URL，截图为 363×785。切断本次引用的 reader 得到现有不可读反馈，恢复后退出重进可开同一引用。前序模拟器的定位覆盖导致刷新清空弹层，独立驱动屏蔽隔离环境的定位请求后完成，覆盖已恢复。图中很长的网址沿既有样式显示，完整 URL 保留在接口。证据 `tmp/i6.7/stable-c01-verified/verification.json` 与同目录截图。小程序未改 UI 代码。真机、真实微信授权与 BLE 未验。

### I6.7.6 固定真实对话与停止点

每次新增实模请求都用北京百炼 `bailian`，逻辑名 `deepseek-flash`，供应商响应实际为 `deepseek-v4.1-flash-1017`。应用联网与供应商原生工具分别记账。成功的 API 回执也可能对应被应用拒绝的答复。固定提问和预期、首稿及唯一修复、实际工具、原始 Evidence、最终状态、请求 ID 和用量在 `admin/tmp/r6/integration-i67-*/{fixed-conversations,turn-*,report}.json`。协议能力及费用边界见[百炼 I6.7](bailian-responses-adapter.md#15-i67-起的实模开发与验收)。历史 Qwen 结果和 I1 unknown 保留，未重放。

| 场景 | 结果和依据 |
| --- | --- |
| A 管根、防水、铺砖 | 首批三问完成写入但依据不足。引入正式原文后首轮在模型前超限（0 请求）。压缩来源后，真实模型保存第 31 页管根引用，首轮重进断言受分段复核时限影响。合并读原件后实库及 Stable 重开通过。用原咨询继续后两问，均保存并重进。第二问虽读到基层验收和预埋原文，最终只返回现场确认引导，未通过。第三问的唯一修复引用第 28 页 5.1.12，回答防水层验收后才能进入铺砖，同时区分未取得的项目放行状态。原咨询的技术问答整体仍 Limited。证据 `integration-i67-a-continuation/`。 |
| B 企业与公开标准对比 | 首批把历史 JGJ 公告的已废止条文说成仍须执行。增加原件、状态和企业必读后，最近一轮已取得 PPT 和公开原文；首稿及唯一修复仍因无据量数被拒，未形成通过终稿。 |
| C 状态、日期及适用范围 | 发布公告、目录现行状态及 PDF 原文进入同轮。一次诊断批有源码漂移，仅保留原请求及失败。后续走同版三份来源，首稿和唯一修复仍带额外未请求的工序和参数，最终被拒。离线回放区分状态否定被误判与实际无据量数，后者仍拒绝。未通过旧房适用性的整答验收。 |
| D 厨房更正卫生间 | 厨房首问先后发生引用、请求超限和无据施工条件失败，最后一次首稿及修复仍失败。按停止规则保留失败，更正轮未执行。 |
| E 主卧项目实况 | 独立实模询问走原 `query_business`，只读主卧已发布记录并返回水管根部待核对，重进通过。厨房完工记录未进入答复，委托写入 0。D→E 同一会话尚未完成。 |
| F 企业参数缺项 | 实模引用 PPT，明确本次资料未写卫生间闭水时长和防水涂刷高度，未给企业数值，重进及零委托通过。 |
| 私有沟通偏好 | 首次拒绝缺 `topic` 的模型参数，没有保存。将原工具的独立偏好写入契约收紧为必填主题、类别和原话后，实模保存成功，新咨询读回先结论后细节。 |

后继判据是用保存稿分辨条款用途、分段出处与项目适用性。B、C、D 的同类试错停止；一般提示改写或重复采样不能充当新机制。A 的第二问需检查已有条文时，现场确认分流为何把公开工艺解释整段替换掉。企业资料边界、项目权限和业务回执仍由现有服务验证。

实模对话请求共 52 次，Responses 37 次、Chat Completions 15 次，338,307 输入、24,210 输出、126,976 缓存输入 tokens，均有请求 ID 与实际模型。含一次漂移批的 2 个请求与所有应用拒绝结果。单列的 6 次协议探测使用 21,903 输入、1,439 输出、11,520 缓存输入 tokens。两组实际结算金额均不可得。本轮实模无供应商 unknown。租约恢复中的未知结果是明确注入的工程回归，历史 I1 unknown 独立保留。

### I6.7.7 工程检查

- Assistant 较广离线检查 1,038/1,039，唯一失败仍是已记录的「书桌收纳」意图，保留 I6 的 1,033/1,034 历史记录。小程序 Assistant/Construction 341/341。原始日志在 `tmp/i6.7/{assistant-release,miniprogram-tests}.log`。
- 最终定向 Assistant 与协议 89/89、公开读取 32/32，二者有交集；Python reader 3/3。覆盖 PDF/DOCX、发现与网页读取、原文、引用、冲突与无据量数。计划检查、TypeScript、定向 ESLint 与生产 Webpack 构建通过，静态生成 115 页。源码绑定 `tmp/i6.7/release-source.json`，日志 `{focused-final,public-final,python-reader-direct,eslint-branch,webpack-final}.log`。实库、实模和模拟器结果以各自源码绑定为准。
- 隔离测试结束后清理临时百炼加密覆盖、停止测试数据库与新增读页/搜索进程。关闭本轮打开的次屏项目，原窗口和原小程序私有配置保留。测试卷与原始回执保留。

## I6.10 防水专业 Agent 可信度与现场资料（Limited）

从 `origin/codex/xiaok-integration` 的 `682bcbf1e81fb554cf008c542478029978fe7f31` 开始。主工作区其他分支和未提交的测绘文件保持原样。隔离环境为微云 1454、PG17/pgvector、受限应用角色及指定 Stable 项目。源码、配置、执行器、原始首稿、唯一修复及请求逐条保存在对应批次，回执按各自绑定使用。

- **专业对话。** `dialogue-01` 两轮 16 问保存 5 个答复，7 个承诺校验和 4 个企业检索错误。调整后 `dialogue-02` 两轮 18 问保存 10 个，4 个承诺、2 个作用域及 2 个 `source_read_required`。两轮同版现行性及翻修条文均保存。保存稿回放 120、128、132 的原公开规范段落通过，共 28 段，独立项目验收与无据量数测试仍拒绝。后续限定 `dialogue-read-01` 两轮 8 问保存 5 个，企业原文与主卧实际读取分别 2/2，国标原文 1/2，两个更正终稿仍被拒绝。国标原文已由公网分派，后一轮失败发生于终稿承诺校验。停止相同开工和更正场景的措辞补丁循环。工程状态可从原回执读取，部分清单分析正文仍误述未登记或无法跟进。
- **规范原件。** I6.9 Reader 日志在防水原件分段下载超时。I6.10 保存同一原件 SHA-256，首次获取在同一时限内验证各段 ETag、Range、长度和顺序。C01 已存原件先核验私有检查点，再对源站与原公告链接重新核验。真实打开 `w:124:1`，PDF 第 27 页和原引文一致。隔离错误注入验证超时、撤回、替换及拒绝的具体码，恢复真实 Reader 后同引用可重开。GB 55030-2022 沿用第 5、27、28、31、36、37 页。GB 55020-2021 的原件和同版目录实读通过，28 页完成 OCR，逐图核对第 12、24、25 页的有限摘录进入 Evidence，其余 25 页保留待核。证据 `tmp/i6.10/pdf-read-01.json`、`reader-baseline.json`、`plumbing-ocr-unreviewed.json` 与对应原图。[防水公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2022/art_17339_768499.html) · [给排水公告](https://www.mohurd.gov.cn/gongkai/zc/wjk/art/2021/art_17339_762458.html)
- **隔离实库分支。** `workflow-checklist-02` 的 C01 `56` 从公开依据保存清单、等待并释放租约，事项 `301` 经项目经理授权回传消息 `225`。初次 `workflow-checklist-01` 的依据结构失败保留。 `workflow-material-01` 的 C01 `67` 在托管检索未配置时记录不可用，仍保存公开依据回答，经补资料进入事项 `374` 并回传消息 `273`。两条均验证普通记录、错房间、重复事件、非经理及同业主其他咨询的边界，发布新版本后保持旧绑定。 `workflow-direct-01` 的分析 `139` 保留承诺失败，`workflow-direct-02` 的 C01 `77` 直接创建唯一事项 `448` 后验证取消与等待终止。 `workflow-direct-03` 的 C01 `93` 直达事项 `527`，经理复核版本 2、Outbox `542` 和唯一结果 `368` 均已核对。原验收脚本误按消息投影未暴露的 `purpose` 字段筛选，保留失败日志。按实际投递回执 ID 读回，同一咨询两次读取均可见，另一咨询无结果，原件授权可读。见 `workflow-direct-03/readback-03.json`。历史 v1/v5/v6/v8/v9 保留原证据。
- **图像与 Stable。** 北京目录精确命中实际 ID，Responses 与 Chat Completions 都读出合成探针。产品 `vision-01` 首稿错误混用字段，已留存。 `vision-02` runs `141–143` 依次读同房间获权施工图、用户上传图和后续追问。真实保存圆形/弧线观察，排除错房间与内部照片，撤回施工图后旧答复不可用且媒体返回 404。Stable 390×844 / SDK 3.17.2 实际发送状态查询、重进原 C01、读同一经理结果和原件、点击公开引用、查看照片观察与撤回。合成图像适用于验证可见特征及权限。实体工地材质和物理验收、真机、BLE、真实微信授权及生产仍未验。证据 `tmp/i6.10/stable-02/verification.json` 及截图。
- **工程检查。** 带登录态 Chromium 画布 13 节点、32 条线，依据节点类型化端口和草稿校验通过。真实运行查询 200，未登录 401。Native Workflow PostgreSQL 独立空库迁移后 7/7，Python Reader 4/4，定向 Agent、Specialist 与 Native Workflow 共 1,548 项，1,520 通过、27 项环境跳过，保留 1 项书桌收纳意图基线。Mini 2,243/2,244，保留测绘 Phase 0 基线。TypeScript、定向 ESLint、Webpack 115 页与计划自测通过。证据 `tmp/i6.10/{admin-canvas-01.json,postgres-01.log,reader-unit-02.log,admin-regression-02.log,miniprogram-01.log,lint-final.log,webpack-02.log}`。

| 有实际用量的批次 | Responses / Chat Completions | 输入 / 输出 / 缓存输入 tokens |
| --- | --- | --- |
| 双协议图像探针 | 1 / 1 | 476 / 237 / 0 |
| 清单初次及完成 | 2 / 1 | 5,181 / 1,088 / 768 |
| 补资料 | 1 / 1 | 4,179 / 1,182 / 768 |
| 直达事项初次、取消及完成 | 3 / 6 | 17,065 / 2,837 / 8,960 |
| 图像首稿及产品复验 | 1 / 3 | 5,984 / 1,501 / 512 |
| 两个对话全批 | 7 / 52 | 155,961 / 22,946 / 80,384 |
| 两条读取限定复验 | 2 / 13 | 28,567 / 3,923 / 12,800 |

真实调用仅使用 `bailian`、`deepseek-flash` / `deepseek-v4.1-flash-1017`。请求 ID、协议、实际模型及 token 见 `tmp/i6.10/{bailian-vision-wire,model-receipts-index-final}.json`，实际费用未知。历史未明调用保留原状态。验收后恢复隔离模型覆盖和图片设置，关闭本轮 Stable 窗口、Admin、Reader 与数据库进程，保留隔离数据与回执。[百炼能力与回执](bailian-responses-adapter.md#17-i610-北京百炼图像输入)

### 共用终稿校验收尾

- **保存稿复现。** 在 fetch 后的远端 `682bcbf1e81f` 与本地 `06b890beb3dc` 上核对原快照，固定 14 个历史 Run、28 份首稿和唯一修复。每份输入与已读来源的 hash 一致，零实模回放由 7/28 提升到 21/28。开工及清单恢复本轮资料缺项、带引文前提与清单核对项的作用域，房间更正恢复通用建议及「统一天数」中的非量数用法，国标追问恢复带原文标签的验收前提和已查标准版本编号。六个剩余稿件的验收条件缺引用或引用对象不符，`133` 唯一修复仍被误判为验收结论。最终提交收紧条件引导词、标题作用域和项目主语，防止把「应急通道验收合格」、进度清单或验收结果读成规范条件。该改动晚于实模与 Stable 批次；重放原 28 稿和本批有网页依据的终稿，结果一致。原回执保持原状态。见 `tmp/i6.10/closeout/{replay-before,replay-final-02,final-impact-02}.json`。
- **固定隔离实模。** 两轮各三段双轮对话，7/12 落盘且签名重进可用，普通咨询均无工作流委托。开工 1/2，清单 2/2（缺资料时为通用清单），房间更正 0/2，国标原文 0/2；企业安排及更正前咨询各 2/2。`174/177` 的公网搜索未配置，官方 Reader 超时，原文读取缺失。`183` 实读第 31 页 §5.6.1，模型仍将发布日期写在只引条文页的段落，首稿另无现行性依据。`179/185` 引对了第 28 页 §5.1.12，附带的验收条件复述仍被拒。只取有效引文段的副本可过，完整原答仍失败，后续从来源和谓词的结构绑定检查，已停止本组实模复采。见 `tmp/i6.10/closeout/{fixed-live,live-discriminator.json}`。
- **用量。** 北京目录命中 `deepseek-v4.1-flash-1017`（Text/Image）；逻辑名 `deepseek-flash`。同一网关共 27 次真实请求，Responses 13、Chat Completions 14，55,027 输入、11,660 输出、25,344 缓存输入 tokens。27 条均有请求 ID 和观察用量，本批 unknown 为 0，金额未返回。该批配置、测试和源码绑定无漂移。见 `tmp/i6.10/closeout/{bailian-catalog,model-receipts}.json`。[百炼模型说明](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/deepseek-v4-1-flash)
- **工程与 Stable。** 原定向 61/61，最终受影响的 44/44，TypeScript、改动文件 ESLint 通过；较广回归 1,522 通过、27 跳过、1 项既有书桌收纳意图失败。Stable 390×844 / SDK 3.17.2 实际重进 `181` 的清单、`179` 的更正与失败反馈，并点击 `178` 的 PDF 第 28 页引用，沿原流程查回同一经理结果。无客户端样式或接口变化。恢复隔离配置，关闭本轮 Stable 窗口、Reader 和测试数据库。截图与 HTTP 记录见 `tmp/i6.10/closeout/stable/verification.json`。

## I6.11 防水专业决策可信度与真实工地验证（Limited）

起点为 fetch 后的 `origin/codex/xiaok-integration@53e19acc92e6`，本地 Integration 工作树与该提交一致且干净。原 Public 工作树的 `source-manifest.json` 未提交修改保留原样。本轮按功能切片提交：`68db15d0`（四类语义合同）、`c8fa73af`（房间证据作用域与照片信封）、`6822570a`（清单绑定与生命周期测试）。源码、测试与证据绑定见 `admin/tmp/i6.11/`。

### I6.11.1 四类语义合同

- **根因。** 保存层按段使用该段引用校验验收谓词。I6.10 剩余 7 份失败稿都不是项目完成断言，而是 A/B 类信息：规范条件跨分句继续（「要看……并且基层验收合格」）、条件所引条款在同答案其他段（§5.1.4 与 §5.1.12 分段引用）、解释性表述（「看的是……这一结论」「关键节点是……」「……的基础上」）以及裸谓词与完成式混用（「防水层已经验收合格了」不能由裸条款支持）。
- **合同。** `formal-claim-scope.ts` 统一区分 A 标准规定、B 专业解释、C 项目事实、D 正式业务结论，并导出 `acceptanceSemanticContract` 供专业 Agent 提示词、终稿校验与保存层共用。同一段内逐条谓词判断；条件/解释须有本答案实际选中、同对象且同完成强度的标准原文；项目主语、已/目前/现场等完成式仍须 Construction 回执。未关闭承诺守卫，未新增防水专用正则，未修改历史预期。
- **回放。** `replay-final-02.json` 的 28 份保存稿、124 段：修改前 117/124 段通过，7 段被拒；修改后 124/124 段通过，且新增「你家基层已经验收合格」「项目已经正式验收通过」「验收结果：……」等负例仍被拒。证据 `admin/tmp/i6.11/replay-check.log`。回放只重放已保存段落与引用，不重放未保存首稿，不新增模型调用。

### I6.11.2 房间与项目隔离

- 六问固定序列：厨房进度 →「刚才说错了，是卫生间」→ 卫生间管根 → 后续防水 → 主卧进度 → 主卧/卫生间记录对比。路由在更正轮即更新为卫生间并沿用后续追问；主卧独立切换；双房间对比不压成单房间 specialist run，保留给 Construction 同源读取。测试 `consultation.test.ts`。
- 新增服务端 `currentRoom` 证据守卫：房间只来自 specialist binding，其他房间仍有效的记录也不能支撑本房间回答，修复反馈为 `misattributed_project_room`。测试覆盖跨房间记录仍授权时仍被拒。
- `constructionRead` 边界测试：指定房间只返回该房间记录；同名房间在其他项目不混用；项目内重名房间返回歧义；缺房间明确缺项；无权限或跨租户不返回项目事实。测试 `customer-room-scope.test.ts`。重进仍沿原 `synthesisContextAvailable` 与媒体权限复核，本轮未改。

### I6.11.3 真实施工照片

- 新增 `specialist-photo-analysis-v1` 信封：`visibleObservations`、`possibleIssues`、`notObservable`、`requiredEvidence`、`applicableStandards`、`confidence`、`needsHumanReview`。照片分析不得声明验收、放行或试验合格，不得给出精确施工量数；存在可能问题时必须人工复核并列出补充证据。解析严格失败关闭。
- Construction 原件、上传人员、项目/房间、原件 Hash、发布版本和撤权继续沿现有链路；不复制原图到公共知识库，日志不保存图片访问凭证。
- **真实工地验收 not_run。** 隔离库 `xiaok_r6_model_i69` 与 `xiaok_r6_acceptance_i67` 的项目均明确标记「合成」，现场媒体为 112×80 或 480×360、约 3.7KB 的合成图；没有可合法使用的真实工地照片。I6.10 的合成图能力证据保留，不转为本轮真实工地通过。
- **真实模型图像测试（合成获权图）passed。** 从隔离库读取卫生间记录原件（480×360 JPEG、3,843 字节、记录版本 3），经原 `conversation-images-v1` 和 Chat Completions 发送，实际模型 `deepseek-v4.1-flash-1017`，请求 `7e764e92-872f-9c09-a775-14d15de4efe1`，501 输入 / 155 输出 / 256 缓存输入 tokens。模型只描述可见的灰蓝色圆形和棕色弧线，未给验收或量数结论。证明的是合成图能力与权限链路，不替代真实工地。
- **结构化照片信封限制。** 给 `final_response` 增加 `observation` 字段后，DeepSeek Flash 的 Responses/Chat 请求出现 `Invalid Responses API frame` 或 HTTP 400；恢复原 `kind`/`text` 工具 schema 后图像调用恢复。因此本轮保留服务端信封校验器和测试，但不把模型产出的结构化信封计为通过；产品图像路径继续使用 text。首次失败请求 `456e60ca…`、`eec23e91…` 等保留在 `admin/tmp/i6.11/photo-live-0*.log`。

### I6.11.4 防水检查清单

- 每项绑定 `checkId`、`projectId`、`roomId`、`stage`、`agentId`、`agentVersion`、`workflowRunId`、`evidenceRefs`、`evidenceVersions`、`sourceType`、`applicability`、`currentProjectState`、`checkStatus`、`needsHumanReview` 和十类 `category`（基层、管根、阴阳角、预埋、企业工艺、材料与记录、防水层、试验验收、保护、下一道工序）。
- 状态区分企业标准明确、公开规范明确、项目记录支持、通用建议、资料缺失、不适用、待人工确认、已正式复核。模型分析只产生前七类；`reviewed` 仅保留给 Construction 正式复核回执。企业/公开依据要求当前 epoch、同版状态与实际来源；项目依据要求同项目、同房间、同版本和同 hash。含验收谓词的检查项进入 `pending_review`。
- 清单只由本回答选中的段落生成；历史清单随原 Run/版本保留；重复事项仍按原 Construction 键去重；结果沿原投递回 C01。本轮未重新生成已有报告或清单。

### I6.11.5 工作流生命周期

| 固定项 | 本轮状态 | 依据 |
| --- | --- | --- |
| 1 创建防水草稿 | passed | `createFromTemplate` |
| 2 配置 Agent Version | passed | 模板装配与版本测试 |
| 3 配置 Knowledge Scope | passed | `scope=authorized, topK=3` 断言 |
| 4 配置公开规范范围 | passed | `coverage=subject` 断言 |
| 5 校验输入输出端口 | passed | `validate.test.ts` 与模板端口断言 |
| 6 模拟有据路径 | passed | `waterproof-reviewed` |
| 7 模拟资料不足路径 | passed | `waterproof-missing-evidence` |
| 8 模拟整改路径 | passed | `issue` 分支与 `proposedOperations` |
| 9 发布 vNext | passed | 版本 revision/digest 递增 |
| 10 旧 Run 保持原版本 | passed | runner 绑定原 digest |
| 11 新 Run 使用新版本 | passed | 新发布版模拟与绑定 |
| 12 Agent 版本升级不影响运行中任务 | passed（离线） | runner 按启动时绑定恢复 |
| 13 运行期间企业知识版本替换 | limited | 沿用 I6.9/I6.10 实库证据，本轮未重跑 |
| 14 公开来源撤回 | limited | 沿用 I6.7/I6.10 证据 |
| 15 用户撤回图片授权 | limited | 沿用 I6.10 `vision-02` 证据 |
| 16 原始会话取消 | limited | 沿用 I6.9 v9 证据 |
| 17 Worker 中断和恢复 | limited | 沿用 I6.9/I6.10 实库证据 |
| 18 WAIT_EVENT 重复回调 | passed | runner 重放返回同一等待/完成记录 |
| 19 Outbox 重复投递 | limited | 沿用 I6.9 幂等证据 |
| 20 原会话退出重进 | limited | 沿用 I6.10 Stable 证据 |

离线项由 `specialist.test.ts`、`validate.test.ts`、`simulate.test.ts`、`store.test.ts` 与 Native Workflow 63/63 覆盖；实库项没有在本轮重新执行，没有被计为通过。

### I6.11.6–7 实模与 Stable

固定场景在开跑前登记为 A–L。表内「预期」只约束当前机制，不替代真实回答验收。

| 场景 | 预期事实 | 可用 Evidence | 禁止推断 | 事项 / 人工 |
| --- | --- | --- | --- | --- |
| A 防水施工前准备 | 基层、专项方案、埋设完成 | §5.1.1/5.1.4/5.1.11 | 现场已完成 | 清单，不建事项 |
| B 管根节点 | 管根、地漏与基层交接密封 | §5.6.1 | 具体材料尺寸 | 可建事项 |
| C 基层验收前提 | 验收合格后才能防水 | §5.1.4 | 已验收 | 需人工 |
| D 完成后后续工序 | 防水层验收后进入下一道 | §5.1.12 | 统一天数 | 需人工 |
| E 企业防水标准 | PPT 仅安排施工和后续检查 | 企业知识 | 企业量数 | 不建事项 |
| F 企业/公开对比 | 两类依据分列 | PPT + PDF | 混为企业条款 | 需人工 |
| G 标准现行性 | 公告实施日期 + 同版目录 | 公告、目录 | 发布日期替代条文 | 需人工 |
| H 厨房更正卫生间 | 当前房间为卫生间 | 当前房间记录 | 厨房记录 | 可建事项 |
| I 主卧实际进度 | 主卧已发布记录 | Construction | 计划当完成 | 可建事项 |
| J 企业资料缺项 | 明确缺项 | 检索回执 | 编造条款 | 需人工 |
| K 真实施工照片 | 可见现象与不可见项 | 获权照片 | 验收/精确量数 | 需人工 |
| L 防水检查清单 | 绑定来源与状态 | 本答案引用 | 已正式复核 | 需人工 |

隔离环境为本轮新建的 `xiaok_r6_model_i611`、`i611b`、`i611c`、`i611d`、`i611e`、`i611f`，均位于 `sfp-xiaok-i67-test` 容器，使用本地开发库中已加密的百炼配置（掩码 `sk-ws***mDW9`）和隔离 `JWT_SECRET`；未修改开发库或生产配置。每个场景使用全新空库并执行迁移 `0124–0127`。

| 场景 | 结果 | 真实回执 |
| --- | --- | --- |
| A 施工前准备/管根/后续工序 | passed，3/3 保存 | runs 3–5，请求 `32aaa235…`、`8b663028…` 等 |
| B 企业标准与公开对比 | passed，1/1 保存 | run 3，企业与一般建议分开 |
| C 标准现行性/旧房适用 | limited，1/1 保存 | 公网原文未读取，模型明确无法确认，未编造 |
| D 厨房更正卫生间 | passed，2/2 保存 | runs 3–4，更正轮按卫生间记录 |
| E 主卧实际进度 | passed，1/1 保存 | run 3，读取主卧待核对记录，排除厨房 |
| F 企业资料缺项 | passed，1/1 保存 | run 3，明确企业未写闭水时长和高度 |
| K 合成获权照片 | passed（合成图） | `7e764e92…`，只描述可见图形 |
| L 检查清单 | passed（真实保存稿） | 4 项：3 通用建议 + 1 资料缺失，1 项带来源，1 项需人工 |

- 基础 Responses 调用：`69818dc5-4ffd-9b5b-b5f7-b8ea651c5a24`，75 输入 / 213 输出，实际 `deepseek-v4.1-flash-1017`。
- 对话与照片合计 20 次供应商尝试、101,458 输入、4,140 输出、56,320 缓存输入 tokens；全部有请求 ID、实际模型和观察用量，unknown 0，结算金额未返回。
- 失败保留：首次对话未加载 `.env.local` 导致 `DATABASE_URL is required`；照片工具加入结构化字段后出现 `Invalid Responses API frame`/HTTP 400，恢复原 schema 后通过；场景 C 公网读取失败；均未重放或改写成通过。
- **I6.11.7 Stable still not_run。** 没有运行中的 Stable 控制器、隔离 Admin/Worker 和自动化窗口，未执行 390×844 四端旅程；I6.10 的 Stable 截图、清单重进和经理结果证据保持原状态，不转为本轮通过。

### 工程质量

- TypeScript 全量 `tsc --noEmit` 0 条诊断；改动文件 ESLint 0 错误；生产 Webpack 构建通过。
- Assistant 单元回归 1058/1059，唯一失败为既有「书桌收纳」`need-write-intent` 基线；本轮定向 89/89；Native Workflow 单元 63/63；照片信封 11/11。
- 未重跑：小程序 2243/2244、PostgreSQL 实库、托管 RAG、真机与物理设备。生产部署与模型默认值未改。

## I6.9 防水专业 Agent 闭环（Limited）

起点为 fetch 后的 `0892909ae1c4`，工作树已有的 X6 改动在开发期间进入远端 `deaf1429`。使用独立 Integration 工作树、微云 1454 的合成隔离库及受限 `sfp_app`。百炼实际目录返回 `deepseek-v4.1-flash-1017`，专业 Agent 逻辑名 `deepseek-flash`，凭据沿原加密配置和用量台账。目录回执 `tmp/i6.9/bailian-catalog.json`。

- **真实对话**。配置修正前的 run 114 失败，4 次 Chat Completions，9,955 输入、1,378 输出、5,376 缓存输入。修正 reader 与隔离检索配置后，两轮 16 个原问题中 10 个保存了答复。两次主卧进度、更正、缺资料和企业 PPT 清单均有已保存回执。115、117、118、125、126 为 `unsupported_model_commitment`，127 为 `standard_status_unverified`。例如 117 的两稿都把规范规定的基层验收前提写在现场咨询中，保存层仍拒绝该表述。保留原首稿、唯一修复、工具与失败码。33 次 Chat Completions，90,332 输入、20,774 输出、44,544 缓存输入，成本未知。见 `tmp/i6.9/dialogue-01/` 和 `dialogue-02/`，各批次以自己的源码绑定为准。
- **编辑与真实执行**。Chrome 从 X6 面板拖入 Agent，完成错误定位、类型化端口及配置验证、草稿保存、v5 发布和三路模拟，显示 v1 与 v5 的真实运行。v5 同时要求企业与公开依据，实际按项目范围、topK=1 和 14 天等待进入补资料。v5 Run 等待期间发布 v6，下一条 Run 绑定 v6；发布 v7 后原 v6 仍完成。两个实模闭环分别关联 C01/事项 `61/328` 与 `64/368`，复核版本均为 2。错房间、普通现场记录、重复回调以及非经理复核均已验证。两次等待无 Worker 租约，原咨询以外的会话无复核回执。v5 用量 3,714 输入、1,574 输出、256 缓存输入。v6 按 Responses 优先设置，4 次 Responses 和 1 次 Chat Completions，13,372 输入、2,507 输出、5,120 缓存输入。终稿仍沿适配器已验证的工具载体。v5 首稿仍混入无法持续跟进的说法，原已登记委托和正式回传单独保留。另以 v8 验证关闭配置，会话 `67` 的事项 `432` 在解决后保持等待，关闭才回传消息 `304`，复核版本 3。该轮 1 次 Responses 和 1 次 Chat Completions，3,716 输入、1,155 输出、768 缓存输入。v9 会话 `70` 在分析前已有合规现场记录，直接登记事项 `466` 并进入复核等待。原咨询取消后等待任务终止，回放只有一个正式事项。3 次 Responses，7,475 输入、1,444 输出、5,632 缓存输入。证据为 `browser-edit.log`、`browser-retest-03.log`、`browser-debug-09.log`、`workflow-01/` 至 `workflow-03/` 和 `direct-01/`。
- **权限与恢复**。隔离复核消息丢失后由原 Outbox `383` 重建消息 `274`，重复读取仍只有一条投影。房间变更、客户授权撤回、施工人员和经理撤权时停止返回原结果。平台调试用其他租户或非平台人员请求被拒。PostgreSQL 真实套件 7/7，包括双 Worker 抢占、租约到期、进程重启、未知结果与对账。知识版本及撤回由定向证据和 RAG 测试验证，当前活跃注册仍为 Agent v1。证据为 `recovery-02/`、`postgres-01.log` 和 `assistant-01.log`。
- **Stable**。精确 Integration 项目，SDK 3.17.2，逻辑窗口 390×844。原 C01 会话 `64` 退出重进读到 v6 同一 Run、事项 `368` 和消息 `270`。真实输入后点按发送查询，签名 API 返回 202 并读回状态。独立的同版自然对话 C01 `52` 打开企业 PPT 第 18 页第 3 行。原 C01 `54` 的公开 PDF 引用真实点击到达 API，因原件超时返回 `source_unreadable`。证据为 `stable-01/verification.json` 与 `stable-02/verification.json`，均保留原结果。
- **回归**。定向 Native Workflow 和 Specialist 481/481，Assistant、RAG、Responses 1,082/1,083，保留 `need-write-intent.test.ts` 普通询问预期失败。小程序 2,243/2,244，保留测绘 Phase 0 审计的基线差异。TypeScript、定向 ESLint、生产 Webpack 和计划检查通过。文本模型未读取照片像素。公开 PDF 重新可读与同版现行性、稳定的专业答复、有据清单分支的真实运行、Agent 新版本切换和物理设备仍需验证。有据清单由模拟和证据测试覆盖，注册测试覆盖候选及停用版本。

## I6.8 防水专业 Agent 与工作流（Limited）

从 `59bf257e` 的 Integration 工作树推进。通过既有 LangGraph、Evidence、Construction、Native Definition Store、PostgreSQL Runtime 与委托 Outbox 实现防水纵向流程。其余五个注册为 `draft`。画布沿原管理端草稿、模拟和发布，新增 X6 端口编辑和获权运行调试。未做生产发布。[节点及权限合同](xiaok-waterproof-workflow.md)。

| 验收 | 本轮结果 |
| --- | --- |
| A/B 防水咨询与追问 | 固定两轮中管根、前置基层核对、铺砖前验收均保存。管根引用实际第 31 页，基层与后工序读取第 27/28 页。原 A 在现场引导处提前结束，修复后普通解释不进入该分流。第 70、71、75、76 轮原稿被承诺守卫误拒；用保存稿复现并仅在同段已引规范明确支持时区分技术前提和实际完成。保留仍有条款顺序外推、回答偏长的原文。 |
| C 企业标准及国标对照 | 两轮均引用获权 PPT 第 18 页及实际 PDF。PPT 只说明团队安排施工与后续检查，无企业量数或放行条件。旧稿将正文元数据日期混入技术解释，现模型技术视图只带实际相关条文。 |
| I6.7 C 同版状态及翻修适用 | 公告实读证明实施日期，目录实读证明同版状态，PDF 第 5、31 页区分总则与室内装修改造。最后两次有一轮保存、一轮 `standard_status_unverified`，保留原稿及唯一修复。保存稿仍有概括过宽，整项 Limited。 |
| D 最新房间及项目实况 | 两轮厨房→卫生间更正和进度均保存。Construction 回执为唯一实际项目的「水电」节点，没有该房间已发布记录时明确缺项，不将计划写成完成。 |
| E/F/G 现场闭环 | 隔离库原咨询 `41`、事项 `200`、结果 `156`。Run `specialist:0bdb4820-5d53-4b31-82f3-9c961f3256e8` 在已发布 v1 等照片，发布 v2 后仍以 v1 推进。错误房间和重复投递不建第二事项，无项目人员与施工员无权确认。施工员另行回传记录 `5`，负责人实际复核并授权回传原件。签名 API 与 Stable C01 退出重进均读到同一 Run、v1、结果及授权原件；同业主另一咨询读不到结果。模型未读取照片像素，E 的可见现象识别未通过；分析消息 138 将清单作业误述为不能继续跟进，实际委托仍按事件运行。 |
| 管理端可视化 | Edge Playwright 实测 10 个节点和 20 条控制/数据线，拒绝 object 接入 boolean，拖回兼容端口并检查缺失输入校验。保存 r3、发布 v3，两个模拟分别完成和等待，真实运行按 v1 画布展示 Agent、用量、来源与恢复记录。未登录、无企业、员工、他企业分别得到 401/409/403/404，获权平台管理员读到真实运行。 |
| 工程验证 | 192 项定向 Agent/Native 检查通过，105 项 C01/工地客户端定向通过，PDF reader 3 项通过。完整小程序套件 2243/2244，剩余测绘 Phase 0 调用清单基线，未修改测绘。TypeScript、定向 ESLint 与生产 Webpack 构建通过。 |

对话最后固定批为 `admin/tmp/r6/integration-i68-dialogue-05`。双端源码指纹一致，17/18 轮落盘，25 次百炼响应，Responses 2 次、Chat Completions 23 次，53,545 输入、8,124 输出 tokens。现场闭环 `admin/tmp/r6/integration-i68-workflow-06`，登记和清单作业共 2 次，Responses 与 Chat Completions 各 1 次，3,511 输入、872 输出 tokens。两批实际价格未回传。所有实模实际 ID 均为 `deepseek-v4.1-flash-1017`。终稿保留既有已验证载体，工具轮满足已有 Responses 合同时优先使用。Stable 证据位于 `tmp/i6.8/stable-workflow-04/verification.json`，回到原咨询与下载原件通过，额外的原生状态发送未到达 API，批次保留失败状态。管理端证据位于 `tmp/i6.8` 的 `admin-playwright-ports.log`、`admin-playwright-live-final.log` 及 `admin-api-check.json`。目录响应、原稿、失败、未知和实际用量保留在各批次。真机、BLE、真实微信登录和生产均未验。
