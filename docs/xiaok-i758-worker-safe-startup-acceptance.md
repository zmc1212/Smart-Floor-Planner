# 家客来 I7.5.8 Worker 安全启动与试点范围保护验收

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 开发基线：`b405ea6e0365f9c777d5b0de953838bee084e718`（与 `origin/codex/xiaok-integration` 一致）
> 验收时间：2026-11-16（Asia/Shanghai）
> 性质：代码与隔离 PG17 验收。**未启动真实 Worker、未处理开发库现有 31 条 queued / 2 条 running / 404 条 failed、未连接或修改真实企业 1454、未执行数据库迁移、未发送真实通知、未修改生产配置、未合并 main、未部署生产。**

---

## 1. 目标与边界

本轮只解决一个问题：**防止 Assistant Worker 在未配置明确试点范围时，意外执行企业全量提醒、周报和真实通知。** 不新增业务子系统，不改变提醒/周报规则，不改变四端交互、业务权限或 RLS。

保留的并行改动：开始时工作区有 33 个已跟踪修改和 3 个未跟踪文件（`AGENTS.md`、`source-manifest.json`、`miniprogram/*`、`tsconfig.json` 等），全部原样保留，未清理、未覆盖、未提交。本轮只提交下列与本任务相关的文件。

---

## 2. 修改文件

| 文件 | 变更 |
| --- | --- |
| `admin/src/lib/xiaok-v1/worker-safety-gate.ts` | 新增纯函数 `evaluateWorkerSafetyGate()`：未配置试点或使用企业模式时关闭四项业务 Worker；只有两边一致指向同一试点才开放。 |
| `admin/src/lib/assistant/infrastructure/job-preview.ts` | 新增只读队列 dry-run：`queued / expired running / failed / indeterminate` 计数、可安全领取分类、逐任务原因；使用 `READ ONLY` 事务。 |
| `admin/src/lib/assistant/infrastructure/worker-preflight.ts` | 新增启动预检聚合：安全门禁、脱敏模式摘要、试点范围状态、全局队列预览。 |
| `admin/src/app/api/internal/assistant/jobs/preflight/route.ts` | 新增 `GET /api/internal/assistant/jobs/preflight`，复用 `CRON_SECRET` 鉴权，只读，失败返回 503。 |
| `admin/src/lib/assistant/infrastructure/jobs-tick.ts` | 四项业务 Worker 改为仅由安全门禁开启；tick 响应新增 `workerSafetyGate`，跳过时返回 `reason=worker_safety_gate`、`gateReason`、`errorCode`。 |
| `admin/src/db/transaction.ts` | 为租户/平台事务增加可选 `readOnly`，dry-run 由 PostgreSQL 强制只读。 |
| `admin/scripts/assistant-worker.mjs` | 启动前调用 preflight；门禁关闭退出码 2，预检不可用/无效退出码 1；健康文件记录 `safetyGate`。 |
| `admin/scripts/assistant-worker-health.mjs` | 解析并保留 `safetyGate`，新增 `preflight_unavailable / safety_gate_closed / safety_gate_invalid` 错误码，支持派生 preflight 端点。 |
| `admin/scripts/assistant-worker-healthcheck.mjs` | 门禁关闭时报告 `blocked / safety_gate_closed`，输出门禁摘要。 |
| `admin/src/lib/xiaok-v1/__tests__/worker-safety-gate.test.ts` | 新增门禁单元测试（6 项）。 |
| `admin/src/lib/assistant/__tests__/job-preview.test.ts` | 新增队列分类单元测试（7 项）。 |
| `admin/scripts/__tests__/assistant-worker-safety.test.mjs` | 新增 Worker 进程启动/退出码测试（4 项）。 |
| `admin/src/lib/xiaok-v1/__tests__/worker-tick-alignment.test.ts` | 更新 F4 tick 预期为安全门禁语义，新增企业确认路径。 |
| `admin/src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts` | 源码断言同步为 `workerSafetyGate.status === 'open'`。 |
| `admin/src/db/__tests__/assistant.test.ts` | Worker 脚本测试的本地 mock 增加 open preflight（不连接数据库的门禁检查）。 |
| `admin/scripts/xiaok-i758-worker-safety-acceptance.ts` | 新增隔离 PG17 端到端验收脚本。 |

---

## 3. 安全门禁契约

### 3.1 启动门禁

`evaluateWorkerSafetyGate(env)` 只做纯配置判断，不读数据库、不发通知、不回退：

| 提醒/周报模式 | 结果 |
| --- | --- |
| 两边 `pilot`，企业与试点相同 | `open / pilot_scope_configured` |
| 未配置模式，或只配置企业 ID | `closed / pilot_scope_missing` |
| 任意 `enterprise`（含指定一个企业） | `closed / enterprise_scope_not_allowed` |
| 模式不一致、企业不一致、试点不一致、非法值 | `closed / pilot_worker_alignment`，携带原错误码 |

关键规则：

- **未配置试点范围不再默认等于企业全量**。原 F4 组合 A/B（两边 enterprise、未确认）现在四项均为 0；组合 C（两边同一 pilot）保持运行。
- **企业全量在 I7.5.8 中保持关闭**。只有显式 `pilot` 模式可以运行四项业务 Worker；不提供用环境变量重新打开企业全量的旁路。
- **门禁只是第一层**。pilot 模式仍由 `resolvePilotScope()` 每次 tick 读取最新保存范围；`not_found / inactive / empty / unavailable` 均零生成、零投递，不回退企业。
- 认证、租户事务、RLS、项目成员/业主权限、报告引用与投递幂等检查均未修改。

### 3.2 Worker 进程启动

`admin/scripts/assistant-worker.mjs` 在进入 tick 循环前调用 `GET /api/internal/assistant/jobs/preflight`：

| 预检结果 | 行为 |
| --- | --- |
| `safetyGate.status=open` | 记录门禁摘要，进入原有 tick 循环 |
| `safetyGate.status=closed` | 写入 `safetyGate` 与 `lastErrorCode=safety_gate_closed`，**退出码 2，不发送任何 tick** |
| 预检 401/5xx/网络失败 | `preflight_unavailable`，退出码 1 |
| 预检 200 但缺少合法门禁 | `safety_gate_invalid`，退出码 1 |

健康文件新增 `safetyGate`（状态、原因、投递范围、模式、企业、试点，不含密钥）。`assistant-worker-healthcheck.mjs` 在门禁关闭时返回非零并输出 `tickStatus=blocked`、`reason=safety_gate_closed`。

---

## 4. 只读 dry-run 队列预览

`GET /api/internal/assistant/jobs/preflight` 返回：

- `safetyGate`：启动门禁。
- `alignment`：提醒/周报模式、企业、试点与错误码（无凭据）。
- `pilotScope`：pilot 模式下的最新范围状态、版本、项目数；表缺失或读取失败为 `unavailable`。
- `queue`：**全局** Assistant Job 队列预览（与 Worker 实际领取范围一致，避免只显示试点企业而隐藏其他 queued 工作）。

队列预览字段与分类：

| 字段/分类 | 含义 |
| --- | --- |
| `counts.queued / queuedReady` | 全部 queued / 已到期可领取 |
| `counts.running / runningExpired` | 全部 running / 租约已过期 |
| `counts.failed / indeterminate` | 终态失败 / 未知结果 |
| `counts.expiredWithoutProvider` | 过期且从未派发供应商，可安全重领 |
| `counts.expiredWithKnownAgentOutcome` | 过期但每个 agent 步骤结果已落库，可安全重领 |
| `counts.expiredUnknownProvider` | `provider_started_at` 已设置且结果未知，保持 indeterminate，不重领 |
| `counts.expiredLocalSpeech` | 本地转写丢失，现有路径标记 failed，不重放 |
| `reclaimable.total` | 上述三类可安全领取任务之和；**只识别，不处理** |
| `terminal.failed / terminal.indeterminate` | 终态，不自动重试 |
| `items[]` | 最多 200 条，含 enterprise/job/kind/status/attempts/时间戳/分类/原因；超出时 `truncated=true` |

预览在 `BEGIN ... READ ONLY` 事务中执行；即使代码误写，数据库也会拒绝。`failed`、`indeterminate` 与未知 provider 结果不会被预览改变。

---

## 5. 验证结果

### 5.1 定向单元/脚本测试

| 命令 | 结果 |
| --- | --- |
| `npx tsx --test src/lib/xiaok-v1/__tests__/worker-safety-gate.test.ts` | 5 passed / 0 failed |
| `npx tsx --test src/lib/assistant/__tests__/job-preview.test.ts` | 8 passed / 0 failed |
| `npx tsx --test src/lib/xiaok-v1/__tests__/worker-tick-alignment.test.ts` | 15 passed / 0 failed（含 F4 C–H 回归） |
| `npx tsx --test src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts` | 10 passed / 0 failed |
| `npx tsx --test src/lib/xiaok-v1/__tests__/pilot-scope-resolver.test.ts src/lib/xiaok-v1/__tests__/reminder-service.test.ts src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts src/lib/construction/__tests__/report-worker-pilot.test.ts` | 64 passed / 0 failed（含 inactive、empty、not_found、unavailable、范围外投递不重试） |
| `node --test scripts/__tests__/assistant-worker-safety.test.mjs` | 4 passed / 0 failed |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint（本轮全部改动文件） | 0 error / 0 warning |

### 5.2 隔离 PostgreSQL 17 端到端验收

命令：

```powershell
cd admin
npx tsx scripts/xiaok-i758-worker-safety-acceptance.ts --output=../tmp/xiaok-i758/run-06
```

环境：`127.0.0.1:55432/i745_f1_accept`，`sfp_app`，`rolsuper=false`；所有相关表 `relrowsecurity=true`、`relforcerowsecurity=true`。脚本只接受该隔离库，未连接开发库或生产库。

结果：**20 passed / 0 failed**（`tmp/xiaok-i758/run-06/result.json`）。历史失败轮次 `run-01`、`run-02` 与中间版本 `run-03`–`run-05` 均原样保留。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `env.pg17_rls` | passed | PG17.10、`sfp_app` 非超级用户、6 张相关表强制 RLS |
| `dryrun.no_state_change` | passed | 预览前后 jobs/runs/messages/steps/reservations 均为 3/3/3/0/3，job 哈希 `259a243a…` 完全一致 |
| `dryrun.duplicate_preview` | passed | 重复预览计数完全一致 |
| `dryrun.queued_classified` | passed | 3 条 queued 夹具均识别为 `queued_ready`，未领取 |
| `gate.unconfigured_closed` | passed | `closed / pilot_scope_missing / worker_pilot_scope_missing` |
| `gate.mismatch_closed` | passed | `closed / pilot_worker_alignment / pilot_worker_mode_mismatch` |
| `gate.pilot_open` | passed | 企业与试点一致时 `open / pilot_scope_configured` |
| `gate.pilot_scope_required` | passed | 门禁开放但未保存范围时 `pilotScope=not_found` |
| `startup.duplicate_idempotent` | passed | 两个并发 preflight 返回同一门禁与同一队列，不领取任务 |
| `lease.single_holder` | passed | 同一 run 两个实例并发领取，只有 1 个 lease（run `214`） |
| `lease.heartbeat_fenced` | passed | 心跳延长自身租约；伪造 token 心跳被 `context_changed` 拒绝 |
| `idempotency.provider_start_once` | passed | 同一租约重复 `markProviderStarted` 被拒绝 |
| `recovery.provider_unknown_indeterminate` | passed | 过期租约 + provider 已开始 + 无 agent 结果 → `indeterminate / provider_outcome_unknown`，不再领取 |
| `recovery.indeterminate_not_retried` | passed | 后续 claim 始终为 null |
| `terminal.failed_not_retried` | passed | `failed` 终态，后续 claim 为 null |
| `recovery.expired_safe_reclaim` | passed | provider 未开始的过期租约被重新领取且 token 更换 |
| `dryrun.final_counts` | passed | queued=0、running=0、failed=1、indeterminate=1、可领取=0 |
| `tick.enterprise_blocked` | passed | 显式 enterprise 没有试点 → 门禁 `enterprise_scope_not_allowed`，四项业务 Worker 调用数 0/0/0/0 |
| `scope.missing_pilot_zero` | passed | 未保存试点范围时真实提醒生成/投递均 `scopeStatus=not_found`、created/delivered=0、扫描项目=0 |
| `fixture.cleanup` | passed | 合成企业 `31`、用户 `167` 及助手数据已删除 |

验收运行的合成企业为 `31`，三个 run 为 `214/215/216`；未触碰隔离库其他企业，也未触碰开发库队列。

---

## 6. 安全门禁清单

- 未配置试点范围：Worker 进程退出码 2，服务端 tick 四项业务 Worker 也同时跳过。
- 配置不一致/非法：门禁关闭，原错误码保留，不回退 enterprise。
- 仅有明确试点范围：门禁开放，但每次 tick 仍读取最新保存范围；范围缺失/停用/为空/读取失败均零生成、零投递。
- 企业全量：I7.5.8 中始终关闭；只有显式 pilot 模式可以运行四项业务 Worker。
- dry-run：只读事务 + 只读接口，不领取、不标记、不重试、不发通知。
- `provider_started_at` 已设置但结果未知：预览标记 indeterminate，领取路径标记 indeterminate，不重放。
- `failed`：终态，预览与领取路径均不自动恢复。
- 现有认证、租户事务、RLS、项目权限、提醒收件人权限、报告引用/投递幂等检查未降低。

---

## 7. 剩余限制

1. **聊天/知识任务仍使用全局队列**。本轮只对提醒、周报及站内投递四项业务 Worker 加门禁；`processAssistantJob`、知识索引等既有全局行为未改变。门禁关闭时整个 Worker 不启动；门禁开放时这些任务仍按原逻辑全局领取。报告与提醒的生成/投递始终受试点范围约束。
2. **企业全量模式已关闭**。已有部署若仍希望企业全量提醒/周报，需要后续单独授权和实现，不在本轮范围；上线后四项业务 Worker 只在显式 pilot 模式下运行。
3. **开发库缺少 0130 迁移**。开发库当前 9 条待迁移，`xiaok_pilot_project_scopes` 不存在；pilot 模式下 preflight 会报告 `pilotScope=unavailable`，提醒/周报 Worker 返回 `pilot_scope_unavailable` 并零处理。需按已授权迁移流程应用 0128–0130 后，pilot 模式才能产生真实业务结果。
4. **未启动真实 Worker、未处理真实队列**。开发库现有 31 条 queued、2 条 running、404 条 failed 原样保留；本轮验收只在隔离库创建并清理合成任务。
5. **未验证真实企业 1454**。未连接、未修改、未生成提醒或周报，也未发送站内/微信通知。
6. **多实例验证为同进程并发与隔离库租约验证**，未在真实部署中同时启动两个 Worker 进程；`claimJob` 的行锁/SKIP LOCKED、心跳 fencing 与幂等路径已按真实 SQL 验证。
7. **暂停/退出试点的 inactive、empty 分支来自既有定向测试**（`reminder-service.test.ts`、`report-worker-pilot.test.ts`、`pilot-scope-resolver.test.ts`），本轮未改写隔离库既有 F4 试点范围版本，因此端到端脚本只新增验证了“未保存范围 → not_found → 零业务”。

---

## 8. 复跑命令

```powershell
cd admin
npx tsx --test src/lib/xiaok-v1/__tests__/worker-safety-gate.test.ts `
  src/lib/assistant/__tests__/job-preview.test.ts `
  src/lib/xiaok-v1/__tests__/worker-tick-alignment.test.ts `
  src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts
node --test scripts/__tests__/assistant-worker-safety.test.mjs
npx tsx --test src/lib/xiaok-v1/__tests__/pilot-scope-resolver.test.ts `
  src/lib/xiaok-v1/__tests__/reminder-service.test.ts `
  src/lib/xiaok-v1/__tests__/stage-reminder-worker.test.ts `
  src/lib/construction/__tests__/report-worker-pilot.test.ts
npx tsc --noEmit
npx eslint <本轮改动文件>
npx tsx scripts/xiaok-i758-worker-safety-acceptance.ts --output=../tmp/xiaok-i758/run-<新编号>
```

preflight 手工查看（需 `CRON_SECRET`）：

```powershell
curl.exe -H "x-cron-secret: <secret>" http://localhost:3006/api/internal/assistant/jobs/preflight
```
