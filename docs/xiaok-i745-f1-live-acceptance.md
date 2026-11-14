# 小K I7.4.5-F1 PG17 双项目周报隔离验收

> 基线：`codex/xiaok-integration`，源码 SHA `c3c544d9`。
> 状态：`passed`、`failed`、`limited`、`not_run`。
> 本轮只在独立 PostgreSQL 17 数据库执行真实验收，未连接生产库、未部署生产、未修改真实企业配置、未发送真实通知。

## 1. 隔离环境

| 项 | 值 |
| --- | --- |
| 实例 | 现有隔离评估实例，PostgreSQL `17.10`（Debian 17.10-1.pgdg12+1） |
| 地址 | `127.0.0.1:55432`（现有 SSH 隧道），数据库 `i745_f1_accept` |
| 迁移账号 | `vector_probe_owner`，仅用于建库、迁移和一次受控权限故障注入 |
| 业务账号 | `sfp_app`（非超级用户，`rolsuper=false`） |
| 扩展 | `vector 0.8.2` |
| 迁移 | 127 条，账本 `app.__drizzle_migrations` |
| RLS | `xiaok_pilot_project_scopes`、`construction_report_settings`、`construction_reports`、`construction_report_versions`、`construction_report_deliveries`、`assistant_messages` 均 `relrowsecurity=true`、`relforcerowsecurity=true` |
| 数据 | 全部为合成企业、账号、项目、记录、周报和投递 |
| 证据 | `tmp/xiaok-i745-f1/run-04/result.json`、`tmp/xiaok-i745-f1/evidence.json`、`tmp/xiaok-i745-f1/environment.json` |

复跑（在 `admin/`）：

```powershell
node ../tmp/i745-setup-remote.mjs
npx tsx scripts/xiaok-i745-f1-acceptance.ts --output=../tmp/xiaok-i745-f1/run-04
```

脚本只接受 `127.0.0.1:55432/i745_f1_accept` 且业务用户为 `sfp_app`；连接信息来自未提交的 `tmp/xiaok-i745-f1/connection.private.json`。

## 2. 合成数据

| 项 | 值 |
| --- | --- |
| 企业 | `1`，`I7.4.5-F1 合成验收企业-<时间戳>` |
| 项目 101（试点内） | 实际 ID `1`，业主 `1`，现场记录 `1` |
| 项目 205（试点外） | 实际 ID `2`，业主 `2`，现场记录 `2` |
| 老板 | 管理员 `1`，企业管理员，跨项目查看两个项目 |
| 项目经理 / 施工人员 | 管理员 `2` / `3` |
| 周报设置 | `project_ids=[]`、`audiences=["customer","boss"]`、每周一 20:00 |
| 初始 Pilot Scope | 版本 1，`active`，`[1]`（逻辑 101） |
| 验收时钟 | 周报周期 `2026-11-09` 至 `2026-11-16`，投递 tick `2026-11-16 20:00 +08` |

Pilot Scope 版本轨迹：

| 版本 | 状态 | 项目 | 用途 |
| --- | --- | --- | --- |
| 1 | `active` | `[1]` | 主生成/投递验收 |
| 2 | `active` | `[1,2]` | 企业非空 `project_ids=[2]` 交集验收 |
| 3 | `active` | `[1]` | 交集验收后恢复 |
| 4 | `active` | `[1,2]` | 历史待发送报告构造前的原范围 |
| 5 | `active` | `[1]` | 范围收缩后的最新范围 |
| 6 | `inactive` | `[1]` | 停用故障验收 |
| 7 | `active` | `[1]` | 恢复 |

## 3. 真实生成验收

使用真实 Worker 业务入口 `advanceConfiguredConstructionReports()`（pilot 配置）和既有 `processConstructionReport()`。报告均为真实 `construction_reports` / `construction_report_versions` 行。

| 检查 | 状态 | 真实依据 |
| --- | --- | --- |
| 项目 101 可生成周报 | `passed` | 业主报告 `1`、老板报告 `2`，均为 `weekly`、`facts_ready`、revision 1 |
| 项目 205 不生成试点周报 | `passed` | 上述两份报告 facts 的 `projects[*].id` 均为 `[1]` |
| 老板周报只包含 101 | `passed` | 报告 `2`，run `2`，facts_hash `cc28db7688c3…` |
| 业主周报只包含 101 | `passed` | 报告 `1`，run `1`，facts_hash `788d39996d90…` |
| 企业 `project_ids=[]` 仍受试点限制 | `passed` | 设置保持 `[]`，报告事实仅 `[1]` |
| 企业 `project_ids` 非空取交集 | `passed` | 设置临时改为 `[2]`、试点 `[1,2]` 后只生成项目 205 的业主/老板报告 `3`、`4`，facts 与 policy 均为 `[2]`；随后恢复 `[]` |
| 不修改原始 settings | `passed` | 验收前后 `construction_report_settings.project_ids` 均为 `[]` |
| 同一周期重复 tick | `passed` | 重复生成 `queued=0`，报告数量不变 |
| 范围外 stage event | `passed` | 项目 205 新增 `painting` 事件后生成 tick `queued=0`，报告数量不变 |
| policy snapshot | `passed` | 主验收报告 run 的 `policy_snapshot.scope.project_ids` 均为 `[1]` |

真实报告证据：

| reportId | audience | revision | runId | facts_hash | facts projectIds | policy projectIds |
| --- | --- | --- | --- | --- | --- | --- |
| `1` | customer | 1 | `1` | `788d39996d901788275312181f1202bb0c7923dedb605c728f84ea387813aed5` | `[1]` | `[1]` |
| `2` | boss | 1 | `2` | `cc28db7688c366966ae23938432907c48f515dc24454c7f071996cb74e7112c6` | `[1]` | `[1]` |
| `3` | customer | 1 | `3` | `eaca2a08514f60cae80f164b05ce9d8f9233ab32858871815310ee656f9a3bc4` | `[2]` | `[2]` |
| `4` | boss | 1 | `4` | `3877de0255d30392011a4ecc58624f68e9435e7b00efcf9b0b464bfc32052588` | `[2]` | `[2]` |

## 4. 真实投递验收

使用真实 Worker 业务入口 `deliverConfiguredConstructionReports()`（pilot 配置）和既有站内会话投递。

| 检查 | 状态 | 真实依据 |
| --- | --- | --- |
| 范围内报告正常投递 | `passed` | delivery event `5` → message `3`（业主会话 `3`）；event `7` → message `4`（老板会话 `4`） |
| 老板报告不含 205 | `passed` | 老板报告 `2` 的 facts 仅 `[1]`，delivery 已 `delivered` |
| 业主只收到 101 | `passed` | 业主绑定 `1` 只投递报告 `1`；项目 205 无业主投递 |
| messageId 与 delivery 一致 | `passed` | 两条 `delivered` 都有非空 `message_id` 与 `conversation_id` |
| 重复投递 tick | `passed` | 第二次 `delivered=0`，站内消息数不变 |

## 5. 历史待发送报告与范围变更

构造一条已排队、facts 同时包含 `[1,2]` 的老板周报 `5`（版本 facts_hash `f1-history-hash`，delivery event `14`），原范围为 `[1,2]`，随后将最新范围改为仅 `[1]`，再执行 pilot 投递。

| 检查 | 状态 | 真实依据 |
| --- | --- | --- |
| 待发送 delivery 被撤销 | `passed` | delivery event `14` → `revoked` |
| 不产生新站内消息 | `passed` | 该 event `message_id=null`；站内消息总数未增加 |
| report version 不变 | `passed` | report `5` revision 仍为 1，状态 `facts_ready` |
| facts_hash 不变 | `passed` | 仍为 `f1-history-hash` |
| 原 facts 不变 | `passed` | 仍包含 `[1,2]`，未被裁剪 |
| 已 delivered 历史不变 | `passed` | 报告 `1`、`2` 的 message `3`、`4` 与投递状态保持不变 |
| Outbox 历史不删除 | `passed` | 投递前后 Outbox 数量一致，历史事件仅追加 |
| 范围版本变化重新核验 | `passed` | 同一待发送报告在版本 5 `[1]` 下被撤销 |

## 6. 权限与故障

| 场景 | 状态 | 真实依据 |
| --- | --- | --- |
| A. Pilot 不存在 | `passed` | 报告 `9` 的 pending delivery 在 A/B/C 执行期间保持 `pending`；测试结束后清理为 `revoked`，`delivered=0` |
| B. Pilot inactive | `passed` | 范围版本 6 为 `inactive`，pending 保持 `pending`，`delivered=0` |
| C. Resolver 不可用 | `passed` | 临时 `REVOKE SELECT` 后返回 `scopeStatus=unavailable`、`delivered=0`；随后恢复授权 |
| D. facts 缺失 | `passed` | report `7` 版本为 `queued`、facts 为 null，delivery event `16` 被撤销 |
| E. 跨企业项目 | `passed` | 跨企业项目 `3` 无法写入本企业试点范围（触发器拒绝）；伪造 facts `[3]` 的报告 `8` delivery event `17` 被撤销 |
| F. 收件人权限撤销 | `passed` | 业主 `customer_access=false` 后，report `6` delivery event `15` 被撤销，无消息 |
| G. Worker 重复执行 | `passed` | 生成与投递重复 tick 均保持 0 新增；消息数不变 |
| H. enterprise 模式 | `passed` | 企业模式投递构造的 `[1,2]` 老板报告 `10` → event `19` → message `5`，未被试点范围限制 |

## 7. 数据库快照摘要

验收前为新库：`construction_reports=0`、`construction_report_versions=0`、`construction_report_deliveries=0`、`assistant_messages=0`、`domain_event_outbox=0`。

验收后（仅本合成企业 `1`）：

| 表 | 行数 |
| --- | --- |
| `construction_reports` | 10 |
| `construction_report_versions` | 10 |
| `construction_report_deliveries` | 10 |
| `assistant_messages` | 5 |
| `domain_event_outbox` | 19 |
| `construction_report_settings.project_ids` | `[]` |

未被删除的历史：报告 `1`/`2` 的已投递消息 `3`/`4`、报告 `3` 的历史快照、报告 `7` 的无 facts 版本、所有 Outbox 事件均保留。

## 8. 状态汇总

| 类别 | 状态 |
| --- | --- |
| PG17 环境、迁移、非超级用户、强制 RLS | `passed` |
| 双项目试点生成隔离 | `passed` |
| 业主/老板站内投递隔离 | `passed` |
| 范围收缩后历史 pending 撤销 | `passed` |
| 权限与故障 A–H | `passed` |
| 定向回归测试（4 个文件） | `passed`（52/52） |
| TypeScript / 定向 ESLint | `passed` |
| 真实微信/订阅通知 | `not_run` |
| 生产部署、真实企业配置 | `not_run` |
| 多企业、多周、长周期压测 | `limited`（本轮仅单企业、单周主链路） |
| Resolver 故障 | `limited`（通过临时表权限撤销注入，不是网络/进程级故障） |
| 故障场景 facts | `limited`（使用合成最小 facts 验证撤销；主链路使用真实 Worker facts） |
| enterprise 模式 | `limited`（验证投递兼容；未重跑企业模式生成） |

## 9. 明确限制

- 本轮使用现有隔离评估实例上的独立数据库，不是新建生产或共享业务库；未连接 `5432` 生产隧道。
- 主生成/投递链路使用真实 Worker、真实数据库行和真实站内消息；权限与故障场景使用构造的 pending/held 报告和最小 facts，以精确触发撤销分支。
- Resolver 故障通过临时撤销 `sfp_app` 对 `app.xiaok_pilot_project_scopes` 的 SELECT 权限注入，并在 `finally` 中恢复。
- 未执行真实微信订阅消息、生产 Worker、真实企业周报配置或生产部署。
- 只验证了一个合成企业、两个项目和一周周期；多企业并发、长周期和真实业务大 facts 仍需后续验收。
