# 家客来小K 1.0 发布就绪度

> 基线：`codex/xiaok-integration`，源码 SHA `ccbe5e45`。
> 结论：第一版真实业务可用性达到发布候选；生产部署、真实微信订阅消息和真实小程序点击仍未执行。

## 1. 发布范围

家客来 1.0 = 十阶段轻量 Agent + 主动装修提醒 + 阶段知识问答 + 四端角色化周报。

本轮不包含：CAD 解析、图纸 OCR、精确测量、自动工程验收、自动放行、完整托管 RAG、复杂多专业协同、摄像头监控、采购库存结算、复杂报价和微信订阅消息规模化推送。

## 2. 就绪结论

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 十阶段注册与配置 | `passed` | 一个运行时，十套知识包、提醒策略和周报模板 |
| 阶段知识问答 | `passed` | 确定性知识包；企业知识未接入时明确声明 |
| 业主 C01 阶段问答 | `passed`（服务层） | 原会话内回答；真实页面点击 `not_run` |
| 主动提醒 | `passed` | 真实 Worker tick、十阶段、角色目标、站内回执 |
| 提醒治理 | `passed` | 去重、暂停、恢复、取消、阶段重评、撤权、失败重试、安静时段 |
| 老板例外 | `passed` | 仅真实计划/期限例外，跨项目去重，不扩大审批权 |
| 四端周报 | `passed` | 同一 Construction 快照，四角色章节，版本与历史 |
| 周报正文模型整理 | `limited` | 隔离环境未配置模型；事实和角色章节可用 |
| 进度红黄绿 | `passed` | 统一计算服务；无计划为灰色待核实 |
| 基础水电与拍照语音 | `passed` | 既有代码和测试保留 |
| AI 故障降级 | `passed` | 阶段问答、提醒和周报事实不依赖模型 |
| 权限隔离 | `passed` | 企业、用户、项目、撤权后遮蔽 |
| 真实微信订阅消息 | `not_run` | 未配置模板/授权/回执，保持站内 |
| 生产 Webpack 构建 | `passed` | `npm run build` 成功，xiaok 路由进入清单 |
| 生产部署 | `not_run` | 本轮不部署生产 |

## 3. 发布前必须确认

1. 生产数据库先做快照，再执行 `npm run db:migrate`；本轮迁移包含 `0128` 和 `0129`。
2. 生产 `DATABASE_URL` 使用非超级用户；不得关闭 RLS 或使用表 owner 绕过。
3. Assistant Worker 必须运行，否则提醒和周报事实不会推进；检查 `/api/internal/assistant/jobs/run` 心跳。
4. 企业必须启用 Assistant 设置并配置报告计划；提醒不依赖报告计划，但周报依赖。
5. 微信订阅消息未配置时，只能显示站内提醒；不得把 `pending` 或 `limited` 写成已发送。
6. 模型未配置或故障时，阶段知识、提醒和周报事实仍可用；周报正文保留 `facts_only`。
7. 老板提醒只发送真实例外；不得把老板加入所有项目审批或验收。
8. 项目经理没有私人跟进会话时，提醒保持 `no_inbox`；上线前按企业配置创建会话或接受该限制。

## 4. 观测与回滚

- 观测：`construction_stage_reminders` 状态分布、`delivery_attempts`、`last_error`、`construction_report_deliveries.state`、Worker tick 返回的 `stageReminderChecks/stageReminderDeliveries`。
- 回滚：停用 Assistant Worker 和企业报告计划；保留提醒、报告、回执和历史版本，不回写旧数据。
- 数据库回滚使用快照恢复到独立库，核对新增业务和未知回执后再切换。
- 不回退已发布工作流版本、专业 Agent 注册或历史验收记录。

## 5. 证据

- [I7.2 真实运行验收](./xiaok-i72-live-acceptance.md)
- `tmp/xiaok-i72-acceptance/migration-result.json`
- `tmp/xiaok-i72-acceptance/final-result.json`
- `admin/scripts/xiaok-i72-migration-check.mjs`
- `admin/scripts/xiaok-i72-acceptance.ts`

## 6. 明确未验证

真实微信订阅消息、真实小程序页面点击、Stable 四端旅程、周报正文真实模型生成、问题真实约定期限、企业 KnowledgeRetriever 注入、生产部署和大规模并发均未在本轮验证。上述能力保持 `not_run` 或 `limited`，不得作为已交付能力宣传。
