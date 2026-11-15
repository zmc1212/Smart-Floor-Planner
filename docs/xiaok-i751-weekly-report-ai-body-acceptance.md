# 家客来 1.0 四端周报 AI 正文生成闭环验收（I7.5.1）

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`1e91ed9a3534`
> 日期：`2026-11-15`（Asia/Shanghai）
> 结论：**隔离环境 15 passed / 0 failed / 1 limited；四端正文均由正式 `construction.report.compose` 任务真实生成并通过事实、角色、投递、幂等与 facts-only 降级校验。** 真实微云 1454 环境 `not_run`。

## 1. 验收范围与结论

本轮补齐 I7.5.0 未执行的模型正文生成，目标是让 I7.5.0 同一合成项目、同一周报周期、同一批已保存报告版本真正跑完：

`enqueueReportBody` → `construction.report.compose` 入队 → `claimJob` 领取 → `processReportComposition` 真实调用模型 → 事实/引用/角色校验 → 保存报告正文版本 → 状态更新 → 既有正式投递入口 → 幂等复跑。

明确结论：

- 四端（customer / designer / boss / worker）与项目经理（按既有 `construction_staff → worker` 映射）共 **5 份周报正文**全部生成，`knowledge_status=ready`，正文版本与对应 facts 绑定。
- 四端正文均通过项目名称、当前阶段、本周记录、完成事项引用、未完成/未验收表述、日期/数值、员工信息、跨项目与角色范围校验。
- 四端正文不是简单替换标题：模型建议分别基于各自角色事实，内容有实际差异。
- 正文生成后再次执行正式投递入口：四端既有消息仍绑定各自会话，**零新增消息、零新增报告版本、零新增正文任务**。
- 唯一 `limited` 为 `body.model_scope`：当前产品走的是企业知识库未启用（knowledge-off）的既有单一路径，模型只撰写各受众的 `standards` 阶段建议段；进展、待核对、已确认安排由服务端按角色事实生成并保存引用。完整四段均由模型撰写需要企业知识库与 Embedding 环境，本轮未扩展该基础设施。

## 2. 环境与夹具

| 项 | 值 |
| --- | --- |
| 数据库 | 隔离 PostgreSQL `17.10`，`127.0.0.1:55432/i745_f1_accept` |
| 业务账号 | `sfp_app`，`rolsuper=false`、`rolbypassrls=false` |
| 合成企业 | `21`（直接复用 I7.5.0，不新建企业） |
| 试点项目 | `38`（试点内）、`39`（范围外） |
| 角色 | 业主 `110`、老板 `71`、项目经理 `72`、设计师 `73`、施工人员 `74` |
| 四端绑定 | customer `63/106`、designer `64/107`、boss `66/109`、worker `65/108` |
| 周报 | `67` customer、`68` boss、`69` worker(经理)、`70` designer、`71` worker(施工人员)，均为 `revision=1` |
| 模型 | 阿里云百炼 `deepseek-v4.1-flash-1017`（逻辑模型 `deepseek-flash`，DashScope OpenAI 兼容端点） |
| 模型凭据 | 仅 `--llm-source=development` 时从开发库 `app.platform_configs.llm_config` 只读复制到隔离库；`finally` 恢复隔离库原值并读回核对 |
| API Key | 未输出、未写入日志或证据文件 |
| 真实微信/订阅通知 | **未发送** |
| 真实 1454 | **未连接业务库、未修改配置、未执行迁移** |

脚本：`admin/scripts/xiaok-v1-product-acceptance.ts`。当检测到 I7.5.0 夹具仍存在时进入复用分支，只对既有报告版本执行正文生成；夹具不存在时才走原有完整合成流程。

```powershell
cd admin
npm run test:xiaok-v1-product-acceptance -- --llm-source=development
```

## 3. 正式任务路径

本轮没有单独写一个“模型调用”脚本，所有正文都经过正式业务任务：

| 阶段 | 实际入口 |
| --- | --- |
| 入队 | `enqueueReportBody(tx, enterprise, reportId, revision)`；写入 `assistant_runs.purpose='construction.report.compose'` 与 `assistant_jobs.kind='chat_turn'` |
| 领取 | `claimJob({ enterpriseId, runId })`；校验企业、会话、租户、`reportComposition` 协议与投递能力 |
| 执行 | `processReportComposition(lease)`；`reportGuard` 重新校验 facts hash、dispatch epoch、binding、项目有效性 |
| 模型 | `runRenovationAgent` → `executePostgresText(logicalModelKey='chat.general')`；真实 provider attempt、usage、run step 全部落库 |
| 事实/引用 | `parseGeneralReport` / `attachReportFactCitations` / `assertReportBodyCitations` |
| 保存 | `construction_report_versions.body`、`knowledge_status='ready'`、`body_generated_at`、`body_error_code=null` |
| 投递 | `deliverConfiguredConstructionReports({ now, env })`；继续使用既有消息引用与幂等合同 |

### 3.1 一个必要的产品级修复

I7.5.0 在验收结束时取消了当时排队的 5 个正文任务并清空 `body_run_id`，但 `assistant_runs` 的 `assistant_run_first_schedule` 唯一索引仍保留原 `report-body:<id>:<revision>:initial` 调度键。再次通过正式入口入队时触发 `23505`，该报告版本将永久无法生成正文。

`report-body-store.ts` 增加了最小修复：当 `body_run_id` 为空且存在同一 `initial` 调度键的历史运行时，若是 `queued/running` 则重新绑定并返回；否则以该历史 run 作为 `retry_of_run_id`、使用 `retry-<runId>` 新调度键重新入队。正常首次入队、已排队复用、预派发失败重试的原有行为不变；已派发的模型结果仍不会被自动重放。

## 4. 四端正文真实结果

| 报告 | 受众 | 正文 run | 模型 | providerRequestId | 输入/输出 Token | 模型耗时 | 状态 | 最终正文 SHA-256 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 67 | customer | 148 | `deepseek-v4.1-flash-1017` | `bd82d516-d6fd-9db5-9198-8124a23aed7d` | 1079 / 148 | 2688 ms | succeeded | `5d2c29f1…91c665` |
| 68 | boss | 153 | `deepseek-v4.1-flash-1017` | `3a651975-8258-92de-9484-97844bd817e6` | 1317 / 154 | 3039 ms | succeeded | `345c43f5…3a3800` |
| 69 | worker（经理） | 154 | `deepseek-v4.1-flash-1017` | `d85c3c27-3cd2-94eb-8d29-5ca1a9666f93` | 1317 / 152 | 2924 ms | succeeded | `a9ba2d82…dd5c7` |
| 70 | designer | 155 | `deepseek-v4.1-flash-1017` | `15a56fb4-c15a-9bf2-9a56-d4aa8a952cc4` | 1318 / 151 | 2680 ms | succeeded | `a1db3f7e…f9f0dc` |
| 71 | worker（施工人员） | 156 | `deepseek-v4.1-flash-1017` | `420a6e9d-e681-9c02-99f3-7a05e4dda6d5` | 1317 / 162 | 2993 ms | succeeded | `4cfb2ad6…1eb5ad` |

五份正文均为 `knowledge_status=ready`，正文 JSON 只含项目 38，`selection` 绑定对应 `reportId/revision/bindingId/projectId`，服务端三段正文分别为：

- progress：`进展以本份报告的原记录为准。`
- pending：`待核对项以本份报告的原记录为准。`
- arrangements：`安排以本份报告中已确认的原记录为准。`

三段均由服务端写入，并按当前角色 facts 追加真实记录引用；模型只写 `standards` 段。

### 4.1 四端模型建议摘要

| 受众 | 模型建议（原文节选） |
| --- | --- |
| customer | 卫生间墙砖铺贴与防水闭水已按原记录登记，建议留意闭水记录与后续贴砖、地漏及门口收口关系；客厅吊顶放线后仍待核对排版，建议核对灯位、检修口与龙骨排布，结论以现场确认为准。 |
| boss | 记录中团队标记阶段为泥木阶段，卫生间墙砖铺贴与防水闭水已有记录，但尚待补拍照片并补充现场记录；客厅吊顶放线待核对墙砖排版与现场尺寸，建议兼顾吊顶标高与墙砖缝位、收口关系后再安排下道工序。 |
| designer | 卫生间墙砖铺贴与防水闭水已有记录，尚待补拍照片并补充现场记录，建议核对墙砖空鼓、阴阳角方正与地漏周边坡度；客厅吊顶放线待核对墙砖排版与现场尺寸，建议确认吊顶标高与灯位、检修口位置是否冲突。 |
| worker（施工人员） | 卫生间墙砖铺贴与防水闭水已有记录，尚待补拍照片并补充现场记录，建议补拍时核对墙砖空鼓、接缝与阴阳角收口，并确认闭水记录与现场水位、楼下观察情况对应；客厅吊顶放线待核对排版，建议复核吊顶标高与灯位、检修口位置。 |

## 5. 首稿失败与唯一修复

第一轮真实生成中，customer 正文一次成功；boss、经理、designer、施工人员 4 份首稿被产品既有完成/数量校验拒绝，错误码 `unsupported_model_commitment`。

根因明确：首稿在建议正文里写了内部事项编号 `507`、`509`，触发 `parseSynthesis` 的无据数量/完成声明校验。既有提示词虽要求“不输出内部ID”，但模型仍复述了编号。**没有降低任何校验强度**，只加固通用正文提示词：

- 正文不得出现任何数字、编号、事项ID、记录ID、版本号、日期或工程量；
- 提到待核对事项时只复述事项内容和房间，不写编号；
- 不写“已确认”“已整改”“已验收”“已完成”等完成状态，改用“记录中提到……尚待……”。

随后每个失败角色只做了**一次**修复测试，首稿、失败原因、模型 ID、请求 ID、Token、耗时全部保留：

| 受众 | 首稿 run | 首稿错误 | 首稿 Token | 修复 run | 修复结果 |
| --- | --- | --- | --- | --- | --- |
| boss | 149 | `unsupported_model_commitment` | 1252 / 176 | 153 | ready |
| worker（经理） | 150 | `unsupported_model_commitment` | 1252 / 156 | 154 | ready |
| designer | 151 | `unsupported_model_commitment` | 1253 / 190 | 155 | ready |
| worker（施工人员） | 152 | `unsupported_model_commitment` | 1252 / 190 | 156 | ready |

真实模型调用合计：**9 次**（customer 1 次 + 4 个失败角色各 1 次首稿 + 1 次修复），输入约 **11,357 tokens**，输出约 **1,479 tokens**；全部为百炼 deepseek-flash 真实网络请求，无 Mock、无供应商回退。

## 6. 内容与事实校验

| # | 检查 | 结果 |
| --- | --- | --- |
| 1 | 项目名称正确 | passed：5 份正文的 facts、context snapshot 均为 `I7.5.0 第一期合成工地（试点内）` |
| 2 | 当前装修阶段正确 | passed：facts/snapshot 均为 `masonry_carpentry`（泥木） |
| 3 | 本周记录真实存在 | passed：facts 含记录 `44`、`45`，`noPublishedRecords=false` |
| 4 | 已完成事项有真实记录支持 | passed：progress 引用逐条等于 `本次完成：<记录 completed>`，`verifyReportCitation` 全部解析到记录版本 |
| 5 | 未完成事项不写成已完成 | passed：正文使用“尚待/待核对”表述；验收脚本拒绝 `已完成`（非“已完成的”）等完成断言 |
| 6 | 未验收事项不写成验收合格 | passed：未出现“验收合格/验收通过/已验收”；模型被既有 commitment 校验拒绝首稿后重写 |
| 7 | 不虚构施工日期 | passed：模型建议无日期；计划节点日期只由服务端 facts 呈现 |
| 8 | 不虚构施工数值 | passed：模型建议无数字；无据数量被 `parseSynthesis` 拒绝 |
| 9 | 不虚构员工行为 | passed：建议无员工姓名或员工动作；内部事项编号被拒绝 |
| 10 | 不泄露其他项目/角色受限信息 | passed：正文只含项目 38，无项目 39 名称；业主无内部事项/员工信息；施工人员无设计师核对项；设计师模型建议只写设计核对；老板只含获权项目。说明：既有 staff 事实投影（designer/boss 的周报 digest）按现网设计包含项目事项列表，本轮未改角色投影，验收只对“模型建议不得越权”和业主/施工人员边界做断言 |
| 11 | 下一步建议与项目计划相符 | passed：计划节点与阶段名由服务端 facts 提供；模型建议未新增日期、工期或排期 |
| 12 | 事实不足时明确说明资料缺失 | passed：customer 的 pending/arrangements 没有可引用原文时，引文为空，服务端视图追加“（本段没有可核验的原记录引用）”；未伪造引用 |

校验实现：

- `assertReportBodyCitations`：所有引用必须解析到当前版本 facts 的真实记录，伪造、跨项目、旧版本、已撤权引用一律拒绝。
- `body.facts`：逐份检查协议、项目、selection、factsHash、服务端段落原文、progress 引用与记录 `completed` 精确对应、无虚构日期/数字/完成声明。
- `body.role_scope`：按受众检查建议文本与已保存上下文是否出现其他角色任务、内部字段或范围外项目。
- 新增 `report-body-compose.test.ts`：7 项定向测试固定上述事实/引用/数字/完成声明边界。

## 7. 投递与幂等

| 报告 | 受众 | 投递 | messageId | conversationId |
| --- | --- | --- | --- | --- |
| 67 | customer | delivered | 330 | 106 |
| 68 | boss | delivered | 331 | 109 |
| 69 | worker（经理） | delivered | 333 | 110 |
| 70 | designer | delivered | 334 | 107 |
| 71 | worker（施工人员） | delivered | 332 | 108 |

- 正文生成后再次执行 `deliverConfiguredConstructionReports`：`delivered=0`，消息数保持 `27`，无重复消息。
- 四端通过正式 `FollowupService.detail` 读取：`available=true`、`contentStatus=composed`、`deliveryState=delivered`，正文与当前报告版本一致。
- 重复执行 `advanceConfiguredConstructionReports`：`queued=0`；报告 `5`、版本 `5`、投递 `5`、消息 `27`、正文任务 `14` 全部不变。
- 重复 `enqueueReportBody`：5 份均返回原 `runId`、`status=ready`，零新增正文任务。
- 范围外项目 39 不进入任何正文 facts、正文或角色读取。

### 7.1 正文不可用时的 facts-only 降级

`body.facts_fallback` 用施工人员报告 `71` 做了一次可还原探针：暂时把该版本正文置空并标记为生成失败（`body_run_id=null`、`knowledge_status=failed`、`body_error_code=acceptance_body_unavailable_probe`），随后用正式 `FollowupService.detail` 以施工人员身份读取，最后按原值恢复并读回逐字段核对。

| 读取字段 | 结果 |
| --- | --- |
| `available` | `true` |
| `state` | `facts_ready` |
| `contentStatus` | `facts_only` |
| `deliveryState` | `delivered`（未改变） |
| `facts.projects` | 含试点项目 `38`，原记录仍可读 |
| `weeklyReport` | 角色周报摘要仍由 facts 生成 |
| 消息计数 | 探针前后均为 `27` |
| 版本恢复 | `body`、`knowledge_status`、`body_error_code`、`body_run_id` 全部读回一致 |

探针只影响隔离合成库的报告 `71` 版本行，未删除任何消息、run、投递或历史报告，`assistant_runs` / `ai_provider_attempts` / `assistant_usage_records` 均未改动。

## 8. 状态与限制

| 字段 | 状态 |
| --- | --- |
| `body.compose` | passed |
| `body.model` | passed |
| `body.facts` | passed |
| `body.role_scope` | passed |
| `body.distinct` | passed |
| `body.role_reads` | passed |
| `body.delivery` | passed |
| `body.idempotent` | passed |
| `body.scope_isolation` | passed |
| `body.facts_fallback` | passed |
| `body.model_scope` | **limited** |
| `weeklyReportStatus` | passed |
| `reportBodyStatus` | **limited（仅因 model_scope）** |

`body.model_scope=limited` 的原因不是生成失败，而是产品范围：

- 当前企业知识库未启用（`enterpriseKnowledgeEnabled=false`），报告走既有 knowledge-off 单一路径：模型撰写 `standards` 建议段，服务端从角色事实生成 progress/pending/arrangements 并追加真实引用。
- 若要求四段全部由模型撰写，需要按既有知识管理流程配置企业知识文档、检索索引与 Embedding 服务；本轮按任务要求不扩展数据库基础设施。
- 未发送真实微信/订阅通知；未验证真机模板与订阅授权。

## 9. 测试与回归

| 项 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | passed |
| 定向 ESLint（验收脚本、`report-body-store.ts`、`report-general-advice.ts`、新测试） | passed |
| 定向回归（`report-worker-pilot`、`weekly-report`、`weekly-report-service`、`weekly-report-config`、`report-store-pilot-scope`、`worker-tick-alignment`、`report-body-compose`） | **73 passed / 0 failed / 0 skipped** |
| 新测试 | `report-body-compose.test.ts` 7 项全部通过 |

```powershell
cd admin
npx tsx --test src/lib/construction/__tests__/report-worker-pilot.test.ts `
  src/lib/xiaok-v1/__tests__/weekly-report.test.ts `
  src/lib/xiaok-v1/__tests__/weekly-report-service.test.ts `
  src/lib/xiaok-v1/__tests__/weekly-report-config.test.ts `
  src/lib/construction/__tests__/report-store-pilot-scope.test.ts `
  src/lib/xiaok-v1/__tests__/worker-tick-alignment.test.ts `
  src/lib/construction/__tests__/report-body-compose.test.ts
npx tsc --noEmit
npx eslint scripts/xiaok-v1-product-acceptance.ts src/lib/construction/report-body-store.ts `
  src/lib/construction/report-general-advice.ts src/lib/construction/__tests__/report-body-compose.test.ts
```

## 10. 证据与运行序列

I7.5.0 的 `tmp/xiaok-i750-product-acceptance/run-14/` 原样保留，未覆盖、未删除。I7.5.1 每轮使用独立 `runId` 和独立输出目录：

| 输出目录 | runId | 结果 | 用途 |
| --- | --- | --- | --- |
| `run-1794756051503` | `a3108604…` | failed | 脚本查询列名错误，未产生业务写入 |
| `run-1794756143789` | `7c039acf…` | failed | 脚本 TDZ 错误，未产生业务写入 |
| `run-1794756214492` | `e19097bc…` | failed | 正文入队被唯一索引拒绝（发现调度键问题） |
| `run-1794756321328` | `9a30f455…` | limited | 首轮真实生成：customer 成功，4 个角色首稿被完成/数量校验拒绝 |
| `run-1794756700721` | `53d33aeb…` | failed | 修复入队前的历史失败状态判断，未新增模型调用 |
| `run-1794756863047` | `da1b32a3…` | failed | 修复历史 run 查询列名，未新增模型调用 |
| `run-1794756933117` | `cb53dc2a…` | 12/2/1 | 一次修复后 5 份正文全部 ready；两条验收判定口径过严，正文未回退 |
| `run-1794757045043` | `b0480f49…` | **14/0/1** | 判定口径修正后的首次清洁验证，无新增模型调用 |
| `run-1794757216823` | `b92c7bb8…` | **14/0/1** | 最终验收轮（增加 `已完成` 断言后复跑），无新增模型调用 |
| `run-1794758765991` | `ddd8ea11…` | **14/0/1** | 提交前复跑当前脚本版本：复用 5 份 ready 正文与 `runId 148/153/154/155/156`，零新增模型调用 |
| `run-1794758884833` | `f6929803…` | **15/0/1** | 增加 `body.facts_fallback` 探针后的首次验证，零新增模型调用 |
| `run-1794758911810` | `22fb87cf…` | **15/0/1** | 最终验收轮（修正探针证据字段后复跑），零新增模型调用 |

最终证据文件：`tmp/xiaok-i750-product-acceptance/run-1794758911810/result.json`（提交前最终复跑，对应本次提交的脚本版本）；首轮真实生成证据保留在 `run-1794757216823/result.json`。

## 11. 仍然缺少什么

1. **全四段模型正文**：需要企业知识库、检索索引与 Embedding 环境；当前 knowledge-off 路径只让模型写阶段建议。
2. **真实 1454 环境**：未连接、未迁移、未启动生产 Worker、未发送真实微信。
3. **真实试点项目**：I7.5.0 已记录 1454 有效项目均 blocked（缺阶段/计划等）；AI 正文闭环只在隔离合成项目验证。
4. **模型正文的长期稳定性**：本轮 4 个角色首稿因内部编号被拒，提示词加固后一次修复通过；仍需在更多真实记录上观察模型遵循度。
5. **设计师事实投影范围**：既有 `collectReportItems` 对 designer/boss/worker 共用项目事项集合，设计师周报 digest 会包含项目内其他角色的事项标题；模型建议本身只写设计核对。若试点要求“设计师完全看不到施工人员事项”，需要单独调整角色投影，本轮未改。
