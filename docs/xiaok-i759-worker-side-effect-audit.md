# 家客来 I7.5.9 全局 Worker 通知与任务副作用安全审查

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`aad83204fff25515a6919af35e293e4b3f76b7c4`（I7.5.8 提交，与远端一致）
> 验收时间：2026-11-16（Asia/Shanghai）
> 性质：代码审查 + 隔离 PG17 定向验收。**未启动真实 Worker、未处理开发库现有业务队列、未发送真实用户通知、未重试或删除历史任务、未修改真实企业 1454、未执行数据库迁移、未修改生产环境、未降低 RLS/权限。**

---

## 1. 目标与结论

目标：完成整个 Assistant Worker 的副作用盘点，确保 Pilot 模式不会意外处理范围外企业的通知、知识任务或其他业务任务。

结论：

- I7.5.9 把 Worker 的全部**有副作用任务**统一纳入 `workerTaskScope()`：门禁关闭时一律不运行；门禁开放（当前仅显式 Pilot）时一律限定到该试点企业。
- 通知出口（施工进展、问题结果、方案发布、公开材料确认、阶段提醒、周报、原生工作流提醒）都增加了企业范围过滤，并保留原有租户事务、RLS、收件人权限和幂等检查。
- dry-run 现在同时显示全局队列、试点企业队列和逐任务范围/数量/潜在副作用，全部在 PostgreSQL `READ ONLY` 事务中执行。
- 隔离 PG17 验收：**13 passed / 1 limited / 0 failed**（`tmp/xiaok-i759/run-06/result.json`）。limited 为知识批次有效候选未伪造，范围过滤由源码与单测覆盖。

---

## 2. Worker 任务入口与副作用清单

`runAssistantJobsTick()` 是唯一编排入口，按以下顺序执行任务。`scope` 列是 I7.5.9 之后的实际范围。

| # | 任务入口 | 代码 | 业务副作用 | 外部调用 | I7.5.9 范围 |
| --- | --- | --- | --- | --- | --- |
| 1 | Native Workflow 周期调度 | `native-workflow/live/period-report-schedule-runtime.ts` | 写周期报告运行、问题台账、站内提醒 | 可能模型调用 | 门禁 open + 白名单必须只含试点企业；否则跳过 |
| 2 | 知识评测批次 | `assistant/knowledge/batch-worker.ts` | 推进批次、创建评测 run/job、写知识评测数据 | 可能模型/Embedding | 门禁 open + `b.enterprise_id=pilot` |
| 3 | 周报生成 | `construction/report-worker.ts` | 生成报告版本、facts、投递回执 | 无（正文由 Assistant Job 生成） | 门禁 open + 试点最新范围 |
| 4 | 阶段提醒生成 | `xiaok-v1/stage-reminder-worker.ts` | 写提醒、取消/过期范围外提醒 | 无 | 门禁 open + 试点最新范围 |
| 5 | Assistant Job | `assistant/infrastructure/job-queue.ts` | 对话回答、站点记录/动作、报告正文、语音等；写消息、run、usage、quota | 可能模型/语音 | 门禁 open + `claimJob({enterpriseId})`；知识/清理/指标回退同企业 |
| 6 | Native Workflow 委派 | `native-workflow/live/delegation-worker.ts` | 写委派事件、站内业主提醒 | 无 | 门禁 open + 白名单必须只含试点企业 |
| 7 | Native Workflow 持久工具 | `native-workflow/live/durable-tool-worker.ts` | 写持久任务、站内业主提醒 | 无 | 门禁 open + 白名单必须只含试点企业 |
| 8 | 周报投递 | `construction/report-worker.ts` | 写站内消息、投递回执 | 无 | 门禁 open + 试点最新范围 |
| 9 | 施工进展公开通知 | `construction/site-publications.ts` | 写 C01 站内消息、`domain_event_deliveries` | 无 | 门禁 open + `r.enterprise_id=pilot` |
| 10 | 问题处理结果通知 | `construction/site-results.ts`（由 9 调用） | 写站内消息、投递回执 | 无 | 门禁 open + `e.enterprise_id=pilot` |
| 11 | 方案发布通知 | `construction/site-plans.ts`（由 9 调用） | 写站内消息、投递回执 | 无 | 门禁 open + `e.enterprise_id=pilot` |
| 12 | 公开材料确认通知 | `construction/public-projections.ts` | 写业主站内消息、投递回执 | 无 | 门禁 open + `enterpriseId=pilot` |
| 13 | 阶段提醒投递 | `xiaok-v1/stage-reminder-worker.ts` | 写站内消息、回执、暂停/撤销 | 无 | 门禁 open + 试点最新范围 |
| 14 | Portfolio 文案生成 | `portfolio/copy-service.ts` | 写模型任务/attempt、作品文案 | 模型调用 | 门禁 open + `enterprise_id=pilot` |
| 15 | Assistant 指标回执 | `assistant/infrastructure/job-queue.ts` | 标记内部 metrics/visibility delivery | 无 | 门禁 open + `enterprise_id=pilot` |

### 2.1 任务分类

| 类别 | 任务 | 是否允许全局运行 |
| --- | --- | --- |
| 平台内部只读/无副作用 | dry-run 预览、健康检查 | 允许；只读事务 |
| 平台内部回执 | Assistant metrics/visibility | I7.5.9 起按企业范围运行；不向用户发消息 |
| 企业业务任务 | Assistant Job、提醒、周报、施工通知、公开材料、Portfolio、知识批次 | **不允许全局运行**；Pilot 模式只限试点企业 |
| 显式配置的 A 线任务 | Native Workflow 周期调度/委派/持久工具 | 保留原显式开关；Pilot 模式下白名单必须只含试点企业 |

### 2.2 通知出口

| 出口 | 收件人 | 范围校验 | 原有权限/幂等 |
| --- | --- | --- | --- |
| 施工进展公开通知 | 业主 C01 | `enterpriseId` 过滤 + 租户事务 + 发布/关注/参与者检查 | Outbox consumer key 唯一 |
| 问题结果通知 | 业主 C01 | `enterpriseId` 过滤 + run/facts/来源权限 | `construction:result:<cid>` 唯一 |
| 方案发布通知 | 业主 C01 | `enterpriseId` 过滤 + 发布版本/客户/会话检查 | `construction:plan:<cid>` 唯一 |
| 公开材料确认通知 | 业主 C01 | `enterpriseId` 过滤 + 身份版本 + 材料状态 | `public-consent:user:<uid>` 唯一 |
| 阶段提醒投递 | 业主/设计师/施工/老板/经理 | 试点项目范围 + 收件人权限复核 | 提醒状态/Outbox 回执 |
| 周报投递 | 四端 + 经理 | 试点项目范围 + facts 快照整体校验 | 报告/投递唯一键 |
| Native Workflow 提醒 | 业主/员工会话 | 白名单只含试点企业 + 委派/项目权限 | 任务/事件/回执唯一 |

---

## 3. 修改文件

| 文件 | 变更 |
| --- | --- |
| `admin/src/lib/assistant/infrastructure/worker-scope.ts` | 新增 `workerTaskScope()` 与 `nativeWorkflowScope()` 纯函数：门禁关闭无范围；Pilot 只允许该企业；Native Workflow 白名单必须只含试点企业。 |
| `admin/src/lib/assistant/infrastructure/jobs-tick.ts` | 所有有副作用任务改为 `businessTasksEnabled` + `taskScope`；门禁关闭时不再调用 Assistant Job、知识批次、站内通知、公开确认、Portfolio、Native Workflow；响应新增 `workerExecution` 与 `nativeWorkflowScopes`。 |
| `admin/src/lib/assistant/infrastructure/worker-side-effects.ts` | 新增 dry-run 副作用预览：13 类任务的范围、候选数量、生产批量上限、潜在副作用和 Native Workflow 白名单状态；可选表缺失返回 `null`，不伪装为 0。 |
| `admin/src/lib/assistant/infrastructure/worker-preflight.ts` | preflight 新增 `scopedQueue`（试点企业队列）与 `sideEffects`（逐任务副作用）；保留全局 `queue` 用于观察范围外积压。 |
| `admin/src/lib/assistant/infrastructure/job-preview.ts` | 补充 `lease_missing` 分类：running 但无租约的任务不视为可安全领取。 |
| `admin/src/lib/assistant/infrastructure/job-queue.ts` | `processAssistantJob(..., scope)` 统一限定候选、领取、知识回退、清理和指标回执；`deliverMetrics(enterpriseId?)` 按企业过滤。 |
| `admin/src/lib/assistant/knowledge/batch-worker.ts` | `advanceKnowledgeBatches(scope)` 只选择试点企业的 active 批次。 |
| `admin/src/lib/assistant/knowledge/index-worker.ts` | `processKnowledgeJob(scope)` 把企业范围传给 `claimKnowledgeJob`。 |
| `admin/src/lib/assistant/knowledge/managed-cleanup.ts` | `processManagedKnowledgeCleanup(provider, scope)` 只清理试点企业的托管导入。 |
| `admin/src/lib/construction/site-publications.ts` | `deliverSiteNotifications({enterpriseId})` 过滤候选，并把范围传给 `deliverSiteResults` / `deliverPlans`。 |
| `admin/src/lib/construction/site-results.ts` | `deliverSiteResults({enterpriseId})` 过滤结果通知候选。 |
| `admin/src/lib/construction/site-plans.ts` | `deliverPlans({enterpriseId})` 过滤方案通知候选。 |
| `admin/src/lib/portfolio/copy-service.ts` | `processPortfolioCopy({enterpriseId})` 只选择试点企业的 prepared/过期 running 任务。 |
| `admin/src/lib/xiaok-v1/__tests__/worker-tick-alignment.test.ts` | 重写为 I7.5.9 语义：门禁关闭全任务零调用；Pilot 全任务带企业范围；Native Workflow 白名单校验。 |
| `admin/src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts` | 源码断言同步为 `businessTasksEnabled` / `taskScope`。 |
| `admin/src/lib/assistant/__tests__/worker-scope.test.ts` | 新增范围纯函数测试。 |
| `admin/scripts/xiaok-i759-worker-side-effect-acceptance.ts` | 新增隔离 PG17 双企业验收脚本。 |

未修改：数据库迁移、RLS 策略、企业 1454、生产环境变量、真实 Worker、历史任务。其他 Agent 的 33 个已跟踪修改和 3 个未跟踪文件原样保留，未提交。

---

## 4. dry-run 契约

`GET /api/internal/assistant/jobs/preflight`（`CRON_SECRET` 保护）现在返回：

| 字段 | 含义 |
| --- | --- |
| `safetyGate` | 启动门禁；当前只有显式 Pilot 为 `open` |
| `alignment` | 提醒/周报模式、企业、试点、错误码（无凭据） |
| `pilotScope` | 最新保存范围状态、版本、项目数 |
| `queue` | **全局** Assistant Job 队列预览（用于观察范围外积压） |
| `scopedQueue` | **试点企业**队列预览（Worker 实际可领取范围） |
| `sideEffects.tasks[]` | 13 类任务：`task`、`label`、`scope`、`wouldRun`、`pending`、`productionLimit`、`sideEffects`、`reason`、`detail` |
| `sideEffects.nativeWorkflow` | schedule / delegations / durableTools 的白名单状态与原因 |

副作用标签：

- `in_app_notification`：写站内消息给真实用户。
- `model_call`：可能产生模型/Embedding/语音调用与费用。
- `business_write`：写业务表、run、消息、回执或状态。
- `knowledge_write`：写知识评测/索引数据。
- `internal_receipt`：只标记内部指标回执，不向用户发消息。

所有 dry-run 查询使用 `BEGIN ... READ ONLY`；候选数量是预检估算，不是投递或执行回执。缺失的可选表返回 `pending:null`，不伪装为 0。

---

## 5. 验证结果

### 5.1 定向单元/脚本测试

| 命令 | 结果 |
| --- | --- |
| `npx tsx --test src/lib/xiaok-v1/__tests__/worker-safety-gate.test.ts src/lib/xiaok-v1/__tests__/worker-tick-alignment.test.ts src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts src/lib/assistant/__tests__/job-preview.test.ts src/lib/assistant/__tests__/worker-scope.test.ts` | 43 passed / 0 failed |
| `npx tsx --test src/lib/xiaok-v1/__tests__/pilot-scope-resolver.test.ts src/lib/xiaok-v1/__tests__/reminder-service.test.ts src/lib/construction/__tests__/report-worker-pilot.test.ts` | 54 passed / 0 failed |
| `node --test scripts/__tests__/assistant-worker-safety.test.mjs` | 4 passed / 0 failed |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint（本轮改动文件） | 0 error / 0 warning |

覆盖：门禁关闭时 Assistant Job、知识批次、站内通知、公开确认、Portfolio、Native Workflow 全部零调用；Pilot 模式下全部入口收到 `{enterpriseId}`；Native Workflow 白名单包含其他企业时跳过；`failed`/`indeterminate` 不重试；`provider_started_at` 未知结果保持 indeterminate。

### 5.2 隔离 PostgreSQL 17 验收

命令：

```powershell
cd admin
npx tsx scripts/xiaok-i759-worker-side-effect-acceptance.ts --output=../tmp/xiaok-i759/run-06
```

环境：`127.0.0.1:55432/i745_f1_accept`，`sfp_app`，`rolsuper=false`；8 张相关表 `relrowsecurity=true`、`relforcerowsecurity=true`。脚本只接受该隔离库，未连接开发库或生产库。

结果：**13 passed / 1 limited / 0 failed**。历史失败轮次 `run-01`–`run-05` 原样保留。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `env.pg17_rls` | passed | PG17.10、`sfp_app` 非超级用户、8 张相关表强制 RLS |
| `dryrun.no_state_change` | passed | preflight/dry-run 前后两家企业 jobs/runs/messages/outbox/deliveries/records/public_sites/model_tasks/batches 计数与 job/task 哈希完全一致 |
| `dryrun.scope_preview` | passed | 全局队列含试点 `42` 与范围外 `43`；`scopedQueue` 只含 `42`，queued=1 |
| `dryrun.side_effect_counts` | passed | assistant_jobs=1、site_publications=1、public_consents=1、portfolio_copy=0（范围外任务不计入）、knowledge_batches=0 |
| `scope.assistant_jobs` | passed | scoped `processAssistantJob` 只领取企业 `42`；范围外 run `226` 仍 queued，全部计数与哈希不变 |
| `scope.site_notifications` | passed | 试点范围投递 1 条；范围外消息/回执/哈希不变 |
| `scope.site_fixture_valid` | passed | 显式指向范围外企业时投递 1 条，证明夹具本身有效 |
| `scope.public_consents` | passed | 试点范围投递 1 条；范围外消息/回执/哈希不变 |
| `scope.public_consent_fixture_valid` | passed | 显式指向范围外企业时投递 1 条 |
| `scope.portfolio_copy` | passed | scoped 调用返回 false；范围外 prepared 任务保持原状，只在自身范围预览中计数 |
| `scope.knowledge_batches` | **limited** | 入口接受企业范围并返回 0；未伪造有效批次候选，范围过滤由源码与单测覆盖 |
| `gate.closed_all_tasks_stopped` | passed | 门禁关闭时 13 类任务全部 `wouldRun=false`，scope=none |
| `gate.closed_tick_zero_calls` | passed | 直接调用 tick 时 knowledge/assistant/site/consents/copy/schedule 计数全为 0 |
| `fixture.cleanup` | passed | 两家合成企业 `42`/`43`、用户、管理员及全部业务行已删除 |

验收只向隔离库合成用户写入站内测试消息，未发送真实微信/订阅通知，未触碰企业 1454 或开发库队列。

---

## 6. 安全边界清单

- 门禁关闭：所有有副作用任务不运行；dry-run 显示 `wouldRun=false`。
- Pilot 模式：Assistant Job 领取、知识批次、知识索引/清理、站内通知、公开确认、Portfolio、指标回执全部限定试点企业。
- Native Workflow：保留原显式开关；Pilot 模式下白名单必须只含试点企业，包含其他企业时跳过并返回 `pilot_scope_override`。
- 通知出口：企业范围过滤 + 原有租户事务 + RLS + 收件人/来源/发布/关注/身份版本检查 + Outbox 唯一键。
- dry-run：`READ ONLY` 事务，不领取、不标记、不重试、不发消息；候选数量不是回执。
- 未降低任何现有业务权限、RLS、幂等或租户隔离检查。

---

## 7. 未解决问题与剩余风险

1. **知识批次端到端范围候选未伪造**。验收只验证入口接受企业范围并返回 0；有效 `assistant_knowledge_batches` 候选需要 case/evaluation/index profile 等完整夹具，本轮未创建。范围过滤 SQL 已加 `b.enterprise_id=pilot`，并由源码/单测覆盖。风险等级：低；建议在后续知识批次真实验收中复用正式批次创建流程补测。
2. **Pilot 模式现在会停止范围外企业的 Assistant 对话/知识/Portfolio 任务**。这是 I7.5.9 的有意行为变更：Worker 不再全局领取聊天任务，只处理试点企业。范围外任务保持 queued，待切换配置或单独 Worker 处理。
3. **Native Workflow 需要按试点重新配置白名单**。若原白名单包含其他企业，Pilot 模式下会整体跳过并记录 `pilot_scope_override`，不会自动缩小到试点企业。运营需显式设置只含试点企业的 `NATIVE_WORKFLOW_*_ENTERPRISE_IDS`。
4. **开发库缺少 0128–0130 等迁移**。开发库的真实试点范围/提醒/报告表仍不完整；本轮验收只在隔离库完成。生产/真实 1454 未连接、未迁移、未发送通知。
5. **未启动真实 Worker、未处理真实队列**。开发库现有 queued/running/failed 原样保留。
6. **阶段提醒/周报的 dry-run 数量显示为 null**。它们的项目级范围由专用 Worker 在执行时解析；dry-run 只标记 `wouldRun` 与副作用，不复制其扫描逻辑，避免预检与真实执行漂移。
7. **`deliverMetrics` 只限定企业**。它是内部回执，不向用户发消息；但仍会写 `domain_event_deliveries`，因此已纳入企业范围。

---

## 8. 复跑命令

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/worker-safety-gate.test.ts `
  src/lib/xiaok-v1/__tests__/worker-tick-alignment.test.ts `
  src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts `
  src/lib/assistant/__tests__/job-preview.test.ts `
  src/lib/assistant/__tests__/worker-scope.test.ts
npx tsx --test src/lib/xiaok-v1/__tests__/pilot-scope-resolver.test.ts `
  src/lib/xiaok-v1/__tests__/reminder-service.test.ts `
  src/lib/construction/__tests__/report-worker-pilot.test.ts
node --test scripts/__tests__/assistant-worker-safety.test.mjs
npx tsc --noEmit
npx eslint <本轮改动文件>
npx tsx scripts/xiaok-i759-worker-side-effect-acceptance.ts --output=../tmp/xiaok-i759/run-<新编号>
```
