# 小K I7.2 真实运行与四端交付验收

> 基线：`codex/xiaok-integration`，源码 SHA `ccbe5e45`。
> 状态：`passed`、`failed`、`limited`、`not_run`、`unknown`。
> 本轮只在隔离 PostgreSQL 17 执行真实验收，未连接生产库、未部署生产、未发送真实微信订阅消息。

## 1. 隔离环境

| 项 | 值 |
| --- | --- |
| 容器 | `sfp-i72-accept`，`pgvector/pgvector:0.8.2-pg17` |
| 地址 | `127.0.0.1:55443`，数据库 `i72_accept` |
| 迁移账号 | `postgres`，仅用于本机隔离库迁移 |
| 业务账号 | `sfp_app`（非超级用户，强制 RLS 生效） |
| 企业标记 | `I7.2验收合成-<时间戳>` |
| 数据 | 全部为合成账号、项目、计划、记录、事项和报告 |
| 证据 | `tmp/xiaok-i72-acceptance/migration-result.json`、`final-result.json` |

迁移脚本强制检查主机、端口、库名和业务角色，不符合即拒绝执行。验收脚本要求 `XIAOK_I72_DATABASE_URL` 指向同一隔离目标，连接后再次核对 `current_user='sfp_app'` 和 `current_database()='i72_accept'`。

复跑命令（在 `admin/`）：

```text
npm run db:migrate                     # 设置 DATABASE_MIGRATION_URL 指向隔离库
node scripts/xiaok-i72-migration-check.mjs
npx tsx scripts/xiaok-i72-acceptance.ts
```

## 2. 迁移验收（I7.2.1）

| 编号 | 检查 | 状态 | 证据 |
| --- | --- | --- | --- |
| M1 | `0128` 创建提醒表与暂停表 | `passed` | 两张表存在 |
| M2 | 唯一约束 `(enterprise_id, dedupe_key)` | `passed` | `migration.unique_and_checks` |
| M3 | 收件箱索引与项目索引 | `passed` | `migration.indexes` |
| M4 | `ENABLE` + `FORCE ROW LEVEL SECURITY` | `passed` | 两表 `rls=true, forced=true` |
| M5 | 企业隔离策略 `tenant_scope` | `passed` | 两表各一条策略 |
| M6 | 用户/管理员/老板角色隔离 | `passed` | `target_principal_kind`、`target_role` 约束与业务查询 |
| M7 | 重复迁移安全 | `passed` | 账本 `126 → 126 → 126` |
| M8 | 迁移事务回滚 | `passed` | 回滚探针未留下账本行 |
| M9 | 迁移后历史 Construction 报告可读 | `passed` | `construction_reports` / `construction_report_versions` 可读 |
| M10 | `0129` 提醒回执字段 | `passed` | `conversation_id`、`message_id`、回执检查约束 |
| M11 | 不关闭 RLS | `passed` | 业务连接为非超级用户 `sfp_app` |

## 3. 十阶段主动提醒（I7.2.2）

真实 Worker tick 入口为 `advanceStageReminders` / `deliverStageReminders`，与 Assistant Worker 共用 `/api/internal/assistant/jobs/run` 的 tick。站内回执写入接收人现有会话消息，并记录 `message_id`。

| 场景 | 状态 | 真实依据 |
| --- | --- | --- |
| A–I 十个阶段进入 | `passed` | 项目 `I7.2 十阶段项目` 依次进入 `preparation` 到 `move_in`，每阶段生成 `stage_entered` |
| J 责任人有待处理事项 | `passed` | 项目经理被指派事项 |
| K 业主有待确认事项 | `passed` | 已发布记录关联的待确认事项 |
| L 设计师有待核对事项 | `passed` | 设计师被指派且来源有效的待核实事项 |
| M 施工人员有待补资料 | `passed` | 施工人员被指派且文本含补资料要求的事项 |
| N 有效计划节点临近到期 | `passed` | 已发布计划 `utilities_living` 临近结束 |
| O 现场记录长期未更新 | `passed` | 项目 `I7.2 记录停滞项目` 有 10 天前的真实发布记录 |
| P 事项超过真实约定期限 | `limited` | 现有 Construction 事项没有约定期限字段，引擎只在 `dueAt` 真实存在时触发，本轮不伪造期限 |
| 无有效计划 | `passed` | 十阶段项目没有计划，未生成精确到期或阶段结束提醒 |
| 阶段变化重评 | `passed` | 旧阶段提醒置为 `expired/stage_changed` |
| 去重 | `passed` | 重复 tick 数量不变；阶段重入使用新事件 ID，不复用旧提醒 |
| 暂停/恢复 | `passed` | 业主暂停后 `paused`，恢复后重新生成待发 |
| 取消 | `passed` | 收件人取消自己的待发提醒 |
| 权限撤销 | `passed` | 撤权后不再保留待发提醒 |
| 失败重试 | `passed` | 会话关闭时 `failed/no_inbox`，重新打开后重试为 `delivered` |
| 重复 Outbox | `passed` | 同一提醒只产生一条站内消息 |
| Quiet Hours | `passed` | 22:30 生成的提醒顺延到次日允许时段 |
| 站内回执 | `passed` | 所有 `delivered` 提醒都有 `conversation_id` 和 `message_id` |
| 老板例外 | `passed` | 老板只收到真实计划过期例外，普通待办不推送 |
| 经理角色 | `passed` | `manager` 保留独立目标，不合并为四端 UI 角色 |

老板收件人来自 `app.construction_actor_access(admin_id, enterprise_id)='owner'`，即与企业工地工作台相同的跨项目查看权限；老板身份不自动获得设计审批或验收权限。同一例外主题在 24 小时内跨项目去重。

## 4. 四端角色周报（I7.2.3）

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 真实 Worker 生成周报事实与版本 | `passed` | 6 份绑定报告，`facts_ready` |
| 四个角色均有周报 | `passed` | `boss`、`customer`、`designer`、`worker` |
| 老板跨项目 | `passed` | 老板事实含两个授权项目 |
| 业主只读自己项目 | `passed` | 业主事实仅一个项目 |
| 计划快照 | `passed` | `weekSchedule` 已写入事实 |
| 四角色章节 | `passed` | 同一事实快照投影四套章节 |
| 投递回执 | `passed` | 已投递周报均有站内 `message_id` |
| 幂等 | `passed` | 同一周期重复运行报告数量不变 |
| 重新进入 | `passed` | `FollowupService.detail` 读取同一 `reportId/revision/sourceSnapshotVersion` |
| 历史周报 | `passed` | `FollowupService.reports` 返回历史条目 |
| 版本化 | `passed` | 修订生成 revision 2，revision 1 仍可读 |
| 权限遮蔽 | `passed` | 设计师撤权后历史周报项目范围为空，报告不被改写 |
| 旧周报无 `weekSchedule` | `passed`（离线） | 保持灰色/待核实，不倒填当前计划 |

报告正文自然语言整理依赖模型。本轮隔离环境未配置模型，正文生成按 `limited` 保留，角色章节和事实快照不受影响；未用模型结果替代任何统计。

## 5. 业主 C01 阶段知识（I7.2.4）

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 在原 C01 会话内回答当前阶段问题 | `passed`（服务层） | `stageChatForConversation` 返回水电阶段回答 |
| 自动读取当前获权项目与阶段 | `passed` | 从 `construction_links`、customer binding、唯一获权项目依次解析 |
| 项目不明确不猜测 | `passed` | 多项目或无项目时回到模型/专业路由 |
| 阶段变化更新上下文 | `passed` | 每轮读取当前阶段 |
| 深入专业问题转交 | `passed`（离线） | `stage-router` 返回 specialist handoff 时不拦截 |
| 保留连续追问和原始消息 | `passed` | 回答写入原会话，使用原消息序号 |
| 企业 KnowledgeRetriever | `limited` | 本轮未注入企业检索，回答明确“本次未核实企业施工标准” |
| 真实小程序点击 | `not_run` | 未启动开发者工具/真机 |

## 6. 四端工作入口（I7.2.5）

| 端 | 状态 | 实现 |
| --- | --- | --- |
| 业主 | `passed`（代码/测试） | C01 默认连续对话；新增当前阶段提醒卡和“本周项目周报”入口 |
| 设计师 | `passed`（代码/测试） | 工作台新增小K主动提醒和“查看本周周报”；不强制业主式聊天 |
| 老板 | `passed`（代码/测试） | 跨项目提醒只含公司介入例外；周报入口复用专业跟进 |
| 施工 | `passed`（代码/测试） | 保留拍照、语音、当前任务；新增“本周周报”入口 |
| 真实 Stable 点击 | `not_run` | 未启动真机/开发者工具 |

## 7. 进度与状态统一（I7.2.7）

`progress-status.ts` 仍是唯一计算服务。本轮验收确认：无计划为灰色待核实；提前/正常/落后由已发布计划与真实记录决定；施工完成图标不替代计划颜色；不生成无工作量口径的百分比。四端报告与项目详情读取同一 Construction 快照。

## 8. 基础水电与记录能力（I7.2.6）

`SD-01`、`SD-02`、`SD-03`、`AC-01`、`AC-03`、`AC-04`、`AC-05`、`AC-06`、`AC-07`、`AC-08` 代码和测试保留。验收中施工人员通过现有 `SiteChatService` 提交记录，由项目经理发布；普通记录未增加逐条人工审核，设计师意见、正式图纸和工程验收权限未改变。CAD/OCR/自动验收未开发。

## 9. 未验证与外部能力

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实微信订阅消息 | `not_run` | 未配置模板、授权和可验证回执；保持站内提醒 |
| 真实小程序页面点击 | `not_run` | 未启动开发者工具/真机 |
| 周报正文模型生成 | `limited` | 隔离环境未配置模型；事实和角色章节已生成 |
| 问题超期提醒 | `limited` | 没有真实约定期限字段 |
| 企业知识检索 | `limited` | 未注入 KnowledgeRetriever |
| 生产部署 | `not_run` | 本轮不部署生产 |
| 真实模型测试 | `not_run` | 阶段知识为确定性回答，不需要模型；未重复采样 |

## 10. 代码与测试

| 检查 | 状态 |
| --- | --- |
| `npx tsx --test src/lib/xiaok-v1/__tests__/*.test.ts` | `passed`，34 项 |
| `npx tsc --noEmit` | `passed` |
| 定向 ESLint | `passed` |
| 小程序新增四端入口测试 | `passed`，3 项 |
| 小程序全量测试 | `passed`（保留历史失败）2,249/2,250；唯一失败为既有测绘 Phase 0 审计 |
| 生产 Webpack 构建 | `passed`，`/api/miniprogram/xiaok/stage-answer` 与 `/api/miniprogram/xiaok/reminders` 进入路由清单 |

## 11. 已知边界

1. 站内 `delivered` 只表示进入接收人会话，不代表已读、承诺或完成。
2. 项目经理没有独立 followup binding 时，提醒保留 `failed/no_inbox`，不借用其他角色会话。
3. 老板例外只覆盖真实计划过期和真实约定期限问题；普通待办不推送。
4. 阶段提醒不依赖模型；模型失败不丢失原始事实。
5. 未验证能力不得写成 `passed`。
