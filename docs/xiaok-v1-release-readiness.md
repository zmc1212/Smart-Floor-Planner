# 家客来小K 1.0 发布就绪度

> 基线：`codex/xiaok-integration`，源码 SHA `0593607da40a`。
> 结论：第一版达到试点候选；四端真实页面、提醒跳转、周报降级和项目经理工作台已在隔离环境验收。生产部署、真实微信订阅消息和真机仍未执行。

## 1. 发布范围

家客来 1.0 = 十阶段轻量 Agent + 主动装修提醒 + 阶段知识问答 + 四端角色化周报。

本轮不包含：CAD 解析、图纸 OCR、精确测量、自动工程验收、自动放行、完整托管 RAG、复杂多专业协同、摄像头监控、采购库存结算、复杂报价和微信订阅消息规模化推送。

## 2. 就绪结论

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 十阶段注册与配置 | `passed` | 一个运行时，十套知识包、提醒策略和周报模板 |
| 阶段知识问答 | `passed` | 确定性知识包；企业知识未接入时明确声明 |
| 业主 C01 阶段问答 | `passed` | 真实 Stable 页面原会话回答并连续追问；退出重进一致 |
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
| 真实小程序页面 | `passed` | I7.3 Stable 390×844 四端页面验收 |
| 生产 Webpack 构建 | `passed` | 隔离 `NEXT_DIST_DIR` 构建，不覆盖开发输出 |
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

真实微信订阅消息、真机/真实微信登录、真实相机或相册拍照、周报正文真实模型生成、问题真实约定期限、企业 KnowledgeRetriever 注入、生产部署和大规模并发均未在本轮验证。上述能力保持 `not_run` 或 `limited`，不得作为已交付能力宣传。Stable 四端旅程与提醒点击已在隔离环境通过；部分截图 RPC 超时按 `limited` 保留。

## 7. 第一批试点配置检查（I7.3）

按顺序逐项确认，全部满足后才允许试点：

| 检查 | 要求 | 当前状态 |
| --- | --- | --- |
| 企业 | 状态 active，Assistant 设置启用 | 隔离环境 `passed`；生产待配置 |
| 项目 | 真实项目、当前阶段、成员有效 | 隔离环境 3 个项目 `passed`；生产待配置 |
| 业主 | 手机号/微信身份可登录，C01 会话可用 | 隔离环境 `passed`；真实微信 `not_run` |
| 设计师 | 企业员工账号、项目成员、可见待核对事项 | 隔离环境 `passed` |
| 老板 | 企业负责人、跨项目工地访问 | 隔离环境 `passed` |
| 施工人员 | 员工账号、项目成员、工地交流权限 | 隔离环境 `passed` |
| 项目经理 | 项目 `manager` 成员；工作台待办可用 | 隔离环境 `passed` |
| 装修阶段 | 十阶段定义启用，当前阶段正确 | `passed` |
| 有效施工计划 | 已发布计划版本与节点日期 | `passed` |
| 周报计划 | 企业报告计划启用，四受众与项目范围 | `passed` |
| Assistant 设置 | 企业策略、配额、保留期 | `passed` |
| Worker | `/api/internal/assistant/jobs/run` 心跳 | 隔离环境运行；生产待启动 |
| 站内消息入口 | C01/私人跟进会话可写 | `passed` |
| 微信订阅消息 | 未配置时只承诺站内 | `not_run` |

运维与回滚：

- 迁移前先做生产数据库快照，再执行 `npm run db:migrate`（含 `0128`、`0129`）。
- 观测提醒状态分布、`delivery_attempts`、`last_error`、报告投递状态和 Worker tick 计数。
- 模型故障时保留 `facts_only`；提醒与周报事实继续生成。
- 回滚停用 Worker 和企业报告计划，保留提醒、报告、回执和历史版本，不回写旧数据。
- 真实生产部署仍需明确授权。

## 8. 证据

- [I7.3 试点验收](./xiaok-i73-pilot-acceptance.md)
- [I7.2 真实运行验收](./xiaok-i72-live-acceptance.md)
- `tmp/xiaok-i73-acceptance/latest.json`
- `tmp/xiaok-i73-ui/`（四端页面结果与截图）
- `admin/scripts/xiaok-i73-acceptance.ts`

## 9. 试点企业只读预检（I7.4.2）

> 基线：`codex/xiaok-integration`，`be361f66e5c9`。
> 范围：只读预检工具。本轮不初始化企业、不部署生产、不修改生产数据。

新增 `admin/src/lib/xiaok-v1/pilot-readiness.ts`、`admin/scripts/xiaok-pilot-readiness.ts` 和 `npm run check:pilot-readiness`。工具必须显式指定单个 `enterpriseId`，不会默认扫描全部企业；只读检查企业、项目、四端账号、十阶段、施工计划、C01、周报计划与受众、Worker 心跳、迁移 0128/0129、业务账号、提醒/周报 RLS 和站内消息入口。

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 企业/项目/当前阶段 | `passed` | 只读读取，企业不可见时明确报告 |
| 十阶段配置 | `passed` | 十个标准阶段、知识包、提醒策略完整性 |
| 有效施工计划 | `passed` | 复用 `readSchedule`，要求已发布、结构有效、覆盖当前阶段 |
| 四端账号与项目权限 | `passed` | 要求成员关系 + 施工访问；仅有账号不算通过 |
| 项目经理工作台 | `passed` | 复用 `canManageConstructionProject` 与施工访问判断 |
| 业主 C01 | `passed` | open/ai 的 `customer_consultation` 会话 |
| 周报计划与四角色受众 | `passed` | 计划启用为 blocker；受众/会话缺失为 warning |
| Worker 心跳 | `passed` | 复用 `readWorkerHeartbeat`，仅 fresh 通过 |
| 迁移 0128/0129 与 RLS | `passed` | 结构、回执字段、FORCE RLS 与租户策略 |
| 数据库业务账号 | `passed` | 非超级用户、无 `rolbypassrls` |
| 站内消息入口 | `passed` | C01、经理工作台、四角色跟进会话 |
| 只读与无副作用 | `passed` | 隔离库 20 张业务表检查前后一致 |
| 生产预检执行 | `not_run` | 本轮不执行生产初始化或预检 |
| 真实微信订阅消息 | `not_run` | 仍只承诺站内提醒 |

隔离测试：PG17 `127.0.0.1:55432/pilot_readiness_eval`、`sfp_app` 非超级用户；A–F 六类企业、跨企业隔离、无写入、重复执行稳定、权限不足明确报告，9/9 passed。`xiaok-v1` 既有单测 34 passed（预检测试在未配置隔离库时 9 skipped），`tsc --noEmit` 和定向 ESLint 通过。证据：`tmp/xiaok-i742-pilot-readiness/result-summary.json`、`test.log` 与三份 CLI 报告。

完整检查项、运行方式、输出结构和已知限制见 [试点企业只读预检](./xiaok-pilot-readiness-checker.md)。生产使用仍需数据库快照、非超级用户连接和明确授权；本工具不替代迁移与部署流程。
