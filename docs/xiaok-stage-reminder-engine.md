# 小K 阶段主动提醒引擎（I7.1）

## 1. 触发来源

| 类型 | 触发条件 | 真实依据 |
| --- | --- | --- |
| `stage_entered` | 项目进入当前阶段 | Construction 阶段事件 |
| `plan_node_due_soon` | 有效计划节点临近结束 | 已发布计划版本 + 节点日期 |
| `plan_node_overdue` | 计划结束日已过且无完成证据 | 已发布计划版本 + 现场记录 |
| `assignee_todo` | 责任人有待处理事项 | 正式业务事项 |
| `owner_confirmation` | 业主有待确认事项 | 正式需求/方案状态 |
| `designer_review` | 设计师有待核对事项 | 正式设计事项 |
| `worker_missing_material` | 施工人员待补资料 | 正式资料缺口 |
| `data_stale` | 已有记录且长时间未更新 | 最近真实发布记录 |
| `issue_overdue` | 问题超过已约定期限 | 问题的真实期限字段 |
| `stage_ending` | 有效计划节点即将结束 | 已发布计划版本 |

普通问答不会产生提醒。没有有效计划时不生成精确到期或阶段结束提醒；没有施工记录时只表示未知，不判定停滞；没有真实期限时不生成问题超期提醒。

## 2. 提醒合同

每条提醒包含：

- `reminderId`（由去重键确定性生成）
- `enterpriseId`、`projectId`、`stageId`、`constructionStageKey`
- `targetRole`、`targetUserId`
- `relatedTaskId`、`relatedIssueId`
- `triggerType`、`triggerEvidence`
- `scheduledAt`、`deliveredAt`
- `status`：`pending`、`delivered`、`failed`、`paused`、`cancelled`、`acknowledged`、`expired`
- `dedupeKey`、`actionUrl`、`title`、`body`
- `conversationId`、`messageId`（站内回执，`0129` 迁移）

文案由服务端事实和固定模板生成。提醒正文明确说明：提醒不代表对方已读、已承诺或已完成。

只有站内消息成功写入接收人现有会话后才标记 `delivered`；没有会话时保留 `failed/no_inbox`，不借用其他角色会话。

## 3. 去重与重评

去重键：

```text
enterpriseId:projectId:triggerType:stageId:targetRole:targetUserId:subject
```

- 阶段进入按真实阶段事件去重。
- 计划节点按节点键 + 计划结束日去重。
- 待办/确认/问题按业务对象 ID 去重。
- 资料未更新按阶段 + 周边界去重。
- 同一 tick 重复执行不会重复生成。

重评规则：

- 项目暂停/归档：待发提醒取消。
- 阶段变化：旧阶段提醒过期，新阶段重新评估。
- 任务取消或事项关闭：对应提醒取消。
- 权限撤销：不再向失权人员生成；已存在待发提醒取消。
- 已送达历史保留，不回滚为未读。

## 4. 暂停与恢复

- 用户暂停按 `enterpriseId:projectId:triggerType` 前缀匹配，匹配的待发提醒进入 `paused`。
- 恢复后下一 tick 按当前事实重新生成；不重放暂停期间的历史提醒。
- 发送失败保留 `failed` 和原始回执，可在条件仍成立时重试；条件消失后取消。

## 5. 老板例外（I7.2）

老板收件人来自 `app.construction_actor_access(admin_id, enterprise_id)='owner'`，与企业工地工作台相同的跨项目查看权限。老板只接收两类真实例外：

1. 计划结束日超过 `bossEscalationDays`（默认 3 天）且没有完成证据。
2. 事项超过真实约定期限 `bossEscalationDays`。

普通阶段进入、角色待办、记录更新提醒不推送给老板。同一例外主题在 24 小时内跨项目去重。老板身份不自动获得设计审批、工程验收或项目成员权限。

## 6. 发送

第一版优先站内提醒和待办。微信订阅消息仅在以下条件同时满足时标记已发送：

1. 企业/平台已配置对应模板。
2. 用户已授权。
3. 发送结果有可验证回执。

模型失败不影响提醒记录：提醒由确定性事实计算生成，模型只可参与自然语言表达。

## 7. 安静时段

策略包含上海时间安静时段（默认 21:00–08:00）。落在安静时段的提醒顺延到下一个允许小时，不丢弃、不提前。

## 8. 失败、重试与暂停

- 发送失败保留 `failed` 和 `last_error`，`delivery_attempts` 最多 10 次；条件仍成立时下一 tick 重试。
- 暂停同时覆盖 `pending` 和 `failed`；恢复后按当前事实重新生成，不重放暂停期间历史提醒。
- 收件人可按 `reminderId` 取消自己的待发提醒。
- 重复 Outbox 使用确定性事件键；同一提醒只追加一条站内消息。
- 阶段重入使用真实阶段事件 ID 去重，不复用旧阶段已过期提醒。

## 9. 测试

`admin/src/lib/xiaok-v1/__tests__/reminder-engine.test.ts` 覆盖：阶段进入、阶段重入、无计划不生成精确提醒、无记录不判定停滞、角色化待办、老板例外、无期限不升级老板、去重、阶段变化过期、权限撤销、暂停、失败保留、安静时段顺延。

`admin/scripts/xiaok-i72-acceptance.ts` 在隔离 PostgreSQL 17 中验证真实 Worker tick、十阶段、站内回执、暂停/恢复/取消、撤权、失败重试、重复 Outbox 和老板例外。

## 10. 四端跳转与工作台收件（I7.3）

- `actionUrl` 为 `/packages/construction/projects/projects?project=<id>&item=<id>`；计划节点额外携带真实 `roomId`。
- `GET /api/miniprogram/xiaok/reminders` 返回 `relatedIssueId`、`relatedTaskId`、`roomId`、`channel`、`history`，并按当天成员/业主身份重新过滤；撤权用户不再获得历史提醒正文。
- `channel`：`conversation` 表示已有站内消息回执；`workbench` 表示项目经理通过现有工地工作台收件；`failed` 表示其他发送失败。`delivered` 明确保持未读，不显示为已读。
- 当前待办只含 `pending/delivered/failed/paused`；`cancelled/expired` 进入历史并标记“已取消/已过期”。
- 业主端提醒卡使用 C01 签发 entry 读取提醒；点击提醒进入对应项目的私人周报。项目经理没有私人会话时，提醒保留 `failed/no_inbox` 事实，但页面展示为“工作台待办”，不借用老板或施工人员会话。
- `construction_staff` 的路由白名单包含 `xiaok/reminders` 与 `xiaok/stage-answer`，与工地工作台权限一致。
