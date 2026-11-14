# 小K I7.4.5-F2 PG17 双项目主动提醒隔离验收

> 基线：`codex/xiaok-integration`，源码 SHA `26c4bec2`。
> 状态：`passed`、`failed`、`limited`、`not_run`。
> 复用 F1 的隔离 PostgreSQL 17 数据库，仅新增合成企业；未重新执行 127 条迁移，未连接生产库、未部署生产、未修改真实企业配置、未发送真实微信通知。

## 1. 隔离环境

| 项 | 值 |
| --- | --- |
| 实例 | PostgreSQL `17.10`（Debian 17.10-1.pgdg12+1） |
| 地址 | `127.0.0.1:55432`，数据库 `i745_f1_accept`（复用 F1） |
| 迁移 | 复用 F1 已应用的 127 条迁移，未重复迁移 |
| 业务账号 | `sfp_app`，`rolsuper=false` |
| RLS | `xiaok_pilot_project_scopes`、`construction_stage_reminders`、`construction_stage_reminder_pauses`、`construction_followup_bindings`、`assistant_conversations`、`assistant_messages` 均 `relrowsecurity=true`、`relforcerowsecurity=true` |
| 数据 | 新合成企业 `5`；F1 企业 `1` 保持只读核验 |
| 证据 | `tmp/xiaok-i745-f2/run-03/result.json`、`tmp/xiaok-i745-f2/evidence.json` |

复跑（在 `admin/`）：

```powershell
npx tsx scripts/xiaok-i745-f2-reminder-acceptance.ts --output=../tmp/xiaok-i745-f2/run-03
```

脚本只接受 `127.0.0.1:55432/i745_f1_accept` 且业务用户为 `sfp_app`。连接信息来自未提交的 `tmp/xiaok-i745-f2/connection.private.json`。

## 2. 合成数据

| 项 | 值 |
| --- | --- |
| 企业 | `5`，`I7.4.5-F2 提醒合成企业-<时间戳>` |
| 项目 101（试点内） | 实际 ID `8`，业主 `19`，记录 `8`、`9` |
| 项目 205（试点外） | 实际 ID `9`，业主 `20`，记录 `10` |
| 老板 / 项目经理 / 施工人员 | 管理员 `12` / `13` / `14` |
| 业主会话 | 项目 101：会话 `15`、绑定 `7`；项目 205：会话 `16`、绑定 `8` |
| 施工人员会话 | 会话 `17`、绑定 `9` |
| 事项 | 项目 101：项目经理 `61`、施工人员 `63`；项目 205：项目经理 `65` |
| Pilot ID | `f2-pilot` |
| 初始范围 | 版本 1，`active`，`[8]` |

Pilot Scope 版本轨迹：

| 版本 | 状态 | 项目 | 用途 |
| --- | --- | --- | --- |
| 1 | `active` | `[8]` | 主生成/投递验收 |
| 2 | `active` | `[8,9]` | 范围扩张，两个项目生成 pending |
| 3 | `active` | `[8]` | 范围收缩，仅 101 投递 |
| 4 | `inactive` | `[8]` | 停用故障 |
| 5 | `active` | `[8]` | 恢复及后续故障 |

## 3. 真实生成与投递（A–G）

使用真实 Worker 入口 `advanceConfiguredStageReminders()` / `deliverConfiguredStageReminders()`（pilot 配置），提醒、消息和 Outbox 均写入真实数据库。

| 检查 | 状态 | 真实依据 |
| --- | --- | --- |
| A. 项目 101 阶段事件生成提醒 | `passed` | 范围 v1，`created=6`（6 条 draft），6 条提醒均为项目 `8` |
| B. 项目 205 不生成试点提醒 | `passed` | 项目 `9` 提醒数 `0` |
| C. 项目 101 提醒写入站内会话 | `passed` | 4 条 delivered：业主会话 `15`、施工人员会话 `17` |
| D. 项目 205 无试点投递消息 | `passed` | 项目 `9` delivered `0`，会话 `16` 无试点提醒消息 |
| E. delivered 有真实 messageId/conversationId | `passed` | 业主 `rem_d84ce8b12d461f337a946e2c` → message `28`；`rem_414cf37731728629f680e66b` → message `30`；施工 `rem_90a47e9881e09fee5c05b0de` → message `29`；`rem_ca2a62ac022209c0708bf7b9` → message `31` |
| F. 重复 Worker tick | `passed` | 重复 tick 新增提醒行 `0`、投递 `0`，消息数保持 `4` |
| G. 其他项目原始记录不变 | `passed` | F1 企业 `1` 前后均为 2 个项目、2 条记录、0 条提醒 |

第一次真实投递中，项目经理提醒 2 条为 `failed/no_inbox`；这是现有合同：项目经理没有私人会话时以项目工作台待办呈现，不伪造站内消息。

## 4. 范围变更与历史提醒

| 步骤 | 状态 | 真实依据 |
| --- | --- | --- |
| 范围扩至 101+205 | `passed` | Scope 版本 2 `[8,9]`，`created=10` draft；项目 101 pending 6、项目 205 pending 4 |
| 范围收缩为仅 101 | `passed` | Scope 版本 3 `[8]` |
| 101 有效 pending 正常投递 | `passed` | 本次 `delivered=4`，累计 delivered 8 |
| 205 pending/failed 不投递 | `passed` | 项目 205 仍有 4 条 pending，delivered 仍为 0 |
| 205 历史提醒不删除 | `passed` | 项目 205 提醒行全部保留 |
| 已 delivered 历史不修改 | `passed` | 第一次的 4 条 delivered 消息 `28`–`31` 不变 |
| Outbox 不重复产生消息 | `passed` | 每条 delivered 只对应一个 `construction.stage_reminder.delivered.v1` 事件 |
| 使用最新 scopeVersion | `passed` | 投递返回 `scopeVersion=3` |

## 5. 故障与权限（1–8）

| 场景 | 状态 | 真实依据 |
| --- | --- | --- |
| 1. Pilot 不存在 | `passed` | `missing-f2`：生成 `created=0`、投递 `delivered=0`、`scopeStatus=not_found` |
| 2. Pilot inactive | `passed` | Scope 版本 4：生成 `created=0`、投递 `delivered=0`、`scopeStatus=inactive` |
| 3. 空项目范围 | `limited` | 数据库 `CHECK(cardinality(project_ids)>0)` 拒绝持久化空 active 范围；空范围零生成/零投递由 `reminder-service.test.ts` 覆盖，PG17 无法构造 |
| 4. Resolver 读取失败 | `passed` | 临时撤销 `sfp_app` 对范围表的 SELECT 后，生成/投递均 `scopeStatus=unavailable`、`created/delivered=0`，随后恢复授权 |
| 5. 收件人权限撤销 | `passed` | 业主 `customer_access=false` 后 2 条 owner pending → `cancelled/permission_revoked`，业主会话消息数保持 4 |
| 6. 目标会话不存在 | `passed` | 删除业主绑定 `7` 后，1 条 owner pending → `failed/no_inbox`，无消息 |
| 7. 恢复会话后重试 | `passed` | 重新绑定会话 `15` 后，该 reminder 重试为 `delivered`，写入真实 messageId |
| 8. enterprise 模式 | `passed` | 企业模式投递项目 205 剩余提醒：owner `rem_8104d7fce03ea3921e977a83` → message `40`（会话 `16`）；worker `rem_9c0ff27f990ee441d910b698` → message `41`（会话 `17`） |

## 6. 收据与快照

| 项 | 值 |
| --- | --- |
| 提醒总数 | 25 |
| delivered | 14 |
| 站内提醒消息 | 14 |
| delivered 类型 Outbox | 14 |
| 最新 Scope | 版本 5，`active`，`[8]` |
| F1 企业项目/记录/提醒 | 前后均为 2 / 2 / 0 |

Phase 1 的 Outbox 示例：`67` → `rem_d84ce8b12d461f337a946e2c`，`68` → `rem_90a47e9881e09fee5c05b0de`，`69` → `rem_414cf37731728629f680e66b`，`70` → `rem_ca2a62ac022209c0708bf7b9`。

## 7. 状态汇总

| 类别 | 状态 |
| --- | --- |
| PG17 环境、RLS、sfp_app 非超级用户 | `passed` |
| 双项目试点提醒生成 | `passed` |
| 业主/施工人员站内投递 | `passed` |
| 范围扩张/收缩与历史 pending | `passed` |
| 权限撤销、无会话、重试 | `passed` |
| Pilot 不存在/停用/Resolver 失败 | `passed` |
| enterprise 模式兼容 | `passed` |
| 空 active 范围 | `limited`（数据库约束拒绝） |
| 项目经理私人站内消息 | `not_run`（现有合同为工作台/no_inbox） |
| 真实微信通知、生产部署、多企业压测 | `not_run` |

## 8. 明确限制

- 复用 F1 数据库的同一张 RLS 表；F2 使用独立合成企业 `5`，未修改 F1 企业 `1`。
- 空 active 范围无法写入数据库（`cardinality>0`），因此 PG17 真实验收标记为 `limited`；空范围逻辑由现有单元测试覆盖。
- Resolver 故障通过临时撤销 `sfp_app` 对范围表的 SELECT 权限注入，并在 `finally` 中恢复。
- 项目经理没有私人会话，提醒按既有合同进入工作台待办并保持 `failed/no_inbox`，本轮未创建伪造的经理会话。
- 只验证一个合成企业、两个项目和一轮阶段变化；多企业并发、长期重复 tick 和真实微信订阅仍未执行。
