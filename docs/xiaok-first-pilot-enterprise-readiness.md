# 小K 1.0 首家试点企业预检与整改清单

## 当前试点边界（I7.4.4）

微云 `1454` 的首批项目由有施工管理权限的企业管理员明确提交。保存后，按 `pilotId` 检查该范围的最新版本。未选中的 active 项目继续保留原状态，其阶段、施工计划、成员和 C01 缺项不再成为首批试点的项目阻断。迁移、强制 RLS、Worker、Assistant 等企业检查仍是必要条件。见[试点范围合同](xiaok-pilot-project-scope.md)。

本轮验证使用独立 PG17 `127.0.0.1:55448/pilot_readiness_eval` 及合成数据。微云的真实试点名单尚未提交，所以下列 I7.4.3 结果仍是历史企业盘点，不能据此判断某个首批项目范围已经就绪。

启用触达前需要核对两套现有规则。阶段提醒 Worker 会扫描具备触发条件的有效 active 项目，企业周报计划可能同时覆盖多个项目，且存量待发或挂起周报保存了原事实快照。预检会列出范围外命中情况和存量记录。此次配置和预检均不派发消息，现有规则继续执行。

| 隔离场景 | 实际结果 |
| --- | --- |
| A 单项目 | 仅检查选定项目，企业安全项通过。现有提醒与周报覆盖另一个 active 项目，结果为 `limited`。 |
| B 两项目 | 两个项目分别通过，加入存量测试提醒前为 `ready`。 |
| C 其他企业项目 ID | API 拒绝，数据库也拒绝直接写入。试算为 `blocked`，无外企项目明细。 |
| D 空范围、未指定范围或无对应试点 | 均为 `blocked`。模拟迁移缺失、FORCE RLS 缺失、Assistant 停用和 Worker 心跳缺失时，企业级失败全部保留。 |
| E 范围内缺阶段 | `blocked`，同时列出该项目的计划、施工人员和 C01 缺项。 |
| F 范围外缺阶段 | 并入范围外 active 清单，选中项目为 `ready`。 |
| G 范围外存量提醒与周报 | 报告查到 3 条未完成提醒及 1 条待发周报。连续两次输出一致，23 张表行数和内容摘要保持一致。 |
| H 同一企业多个试点 | 各自独立版本，过期版本提交返回 409，停用后仍保留版本历史。 |

目标回归 54 项通过，其中 20 项使用隔离 PG17。迁移兼容回归 7 项通过，验证 0129 基线只追加 0130，原项目、提醒和报告配置摘要一致。管理端配置入口覆盖企业负责人、平台管理员、超级管理员、强制改密及跨租户拒绝。独立本地 HTTP 验证了保存、重读、未登录拒绝和过期版本冲突。CLI 的 `limited` 和 `blocked` 分别返回退出码 0 和 2。TypeScript、定向 ESLint、本地 Next.js 构建通过。证据位于 `tmp/xiaok-i744-pilot-scope/`。

首次准备隔离库时，WSL 调用未把指定的迁移连接传入 Windows Node，命令读到了本地开发库。迁移在执行任何新迁移前因旧账本不匹配终止，事务已回滚。只读复核得到原 119 条账本，提醒表和试点范围表仍不存在。后续迁移及验收固定在独立 PG17。原始记录见同目录的 `migrations-baseline.log`、`development-ledger-readonly.log` 和 `migrations-final.log`。

## 历史企业盘点（I7.4.3）

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`8b4062461f16`
> 目标企业：**1454（微云）**
> 检查时间：`2026-11-14T16:02:55.155Z`（Asia/Shanghai `2026-11-15 00:02:55`）
> 预检结论：**Blocked**
> 原始 JSON：`tmp/xiaok-i743-first-pilot/readiness-1454.json`

## 1. 目标企业与执行环境

### 1.1 为什么是 1454

没有扫描全部企业，也没有自行挑选生产企业。1454 是仓库文档中唯一明确指定的试点企业：

- [微云企业的小K人工测试数据](./xiaok-manual-test-data.zh-CN.md)：**“已批准开发环境的当前企业 微云（1454）”**，并限定该夹具只允许微云 1454、客户 645 和已核实的开发库。
- [小K Agent 分层与 FastGPT 工具网关契约](./xiaok-fastgpt-agent-layering.zh-CN.md)：**“`site.public` 已在 1454 试点激活”**。

除上述文档外，本轮没有找到其他被明确指定为“首家试点”的企业 ID。

### 1.2 目标环境

| 项 | 值 |
| --- | --- |
| 数据库 | 开发库 `smart_floor_planner`（由 `admin/.env.local` 配置） |
| 业务账号 | `sfp_app` |
| 超级用户 | 否 |
| `rolbypassrls` | 否 |
| 连接方式 | 租户事务，`app.current_enterprise_id=1454` |
| 生产库 | **未连接** |
| 生产部署 | **未执行** |

本轮使用当前工作区可用的非超级用户业务账号完成只读检查，没有使用超级用户或关闭 RLS 绕过企业隔离。该环境是开发/试点环境，不是生产环境；生产结论仍需单独执行。

## 2. 预检结论

**Blocked。12 个 blocker、1 个 warning，暂不具备试点条件。**

| 检查项 | 状态 | 实际结果 |
| --- | --- | --- |
| 企业状态 | passed | `active` |
| Assistant 启用 | passed | `enabled=true`，保留期 90 天，每日 100 请求 |
| 有效项目 | passed | 10 个有效项目，其中 7 个 active |
| 十阶段配置 | passed | 十个标准阶段、知识包、提醒策略完整 |
| 项目当前装修阶段 | **failed** | 3 个 active 项目未设置阶段 |
| 有效施工计划 | **failed** | 7 个 active 应报告项目均未发布计划 |
| 业主账号 | passed | 4 个有项目权限的客户 |
| 老板跨项目权限 | passed | 2 个 `construction_actor_access=owner` |
| 项目经理 | passed | 3 个有效 manager 成员 |
| 项目经理工作台 | passed | 3 个经理工作台入口 |
| 设计师项目成员 | passed | 3 个有效 designer 成员 |
| 施工人员任务权限 | passed | 2 个有效 worker 成员 |
| 业主 C01 | warning | 9 个项目可用；项目 451 客户无开放会话 |
| 企业报告计划 | passed | 已启用，项目范围为空（全部项目） |
| 四角色周报受众 | passed | customer/worker/designer/boss 完整，4 类会话可用 |
| Assistant Worker 心跳 | passed | `fresh`，0 秒前成功 |
| 迁移 0128/0129 | **failed** | 数据库账本 119 条，0128/0129 均未应用 |
| 数据库业务账号 | passed | `sfp_app`，非超级用户、无 bypass RLS |
| 提醒/周报 RLS | **failed** | 两张提醒表不存在；周报/会话表 RLS 正常 |
| 站内消息入口 | passed | 五类入口均可用 |
| 提醒运行状态 | skipped | 提醒表不存在，由迁移检查阻断 |

## 3. 全部通过项

以下项目已通过，不需要整改：

1. **企业状态**：企业 1454 为 `active`。
2. **Assistant 设置**：已启用，策略版本 62，保留期 90 天，每日请求 100、Token 1,200,000、费用 100,000,000 micros。
3. **有效项目**：10 个未归档项目，7 个 active；项目事实可读取。
4. **十阶段配置**：十个标准施工阶段 key 完整；十套知识包和十套提醒策略均为 active。
5. **业主账号**：4 个客户与项目存在有效绑定，且 `customer_access=true`。
6. **老板跨项目权限**：2 个管理账号的 `construction_actor_access` 返回 `owner`。
7. **项目经理**：3 个 active `manager` 成员，均有施工访问权限。
8. **项目经理工作台**：3 个经理工作台入口可用。
9. **设计师项目成员**：3 个 active `designer` 成员，均有施工访问权限。
10. **施工人员任务权限**：2 个 active `worker` 成员，均有施工访问权限。
11. **企业报告计划**：`construction_report_settings.enabled=true`，周期与项目范围可读。
12. **四角色周报受众**：`customer/worker/designer/boss` 四类受众完整；4 类可用跟进会话均存在。
13. **Worker 心跳**：健康文件为 fresh（检查时 0 秒前成功）；Worker 为全局进程，不按企业拆分。
14. **数据库业务账号**：连接账号为 `sfp_app`，非超级用户且无 `rolbypassrls`。
15. **站内消息入口**：业主 16 个（C01 9 个 + 客户会话 7 个）、老板 2 个、经理 3 个、设计师 4 个、施工人员 4 个；24 个启用中的跟进绑定。
16. **周报/会话表 RLS**：报告设置、跟进绑定、报告、报告版本、报告投递、Assistant 会话与消息均启用并强制 RLS，存在租户策略。

## 4. Blocker 与具体整改办法

### 4.1 项目当前装修阶段（3 项）

| 项目 | 实际状态 | 失败原因 | 整改办法 | 复检标准 |
| --- | --- | --- | --- | --- |
| 234 `测试工地·全流程演练·1028` | `current_stage_key=null` | 项目未设置当前阶段 | 如企业管理员将该项目纳入试点，由项目经理在项目进度中设置阶段 | 项目详情显示有效阶段，`project.stage` 不再报错 |
| 451 `合成·字体校验工地 2026-11-09` | `current_stage_key=null` | 同上；该项目还没有设计师/施工人员成员和 C01 | 如企业管理员将该项目纳入试点，补齐阶段、成员和 C01 | 阶段有效，角色与 C01 检查通过 |
| 647 `【合成四端】mwd7tyrb 四端工地` | `current_stage_key=null` | 项目未设置当前阶段 | 由项目经理设置当前阶段；该项目的经理、设计师、施工人员成员已存在 | 阶段有效且计划覆盖当前阶段 |

> 不要通过数据库直接写 `current_stage_key` 来绕过项目进度和审计；使用现有项目进度动作。

### 4.2 有效施工计划（7 项）

以下 active 且未完工项目均没有已发布施工计划：

| 项目 | 实际状态 | 失败原因 | 整改办法 |
| --- | --- | --- | --- |
| 1 `小K工地对话测试（微云·1017）` | `plan.available=false` | 未发布计划 | 由项目经理发布包含真实房间和当前阶段节点的计划 |
| 234 `测试工地·全流程演练·1028` | `plan.available=false` | 未发布计划，且当前阶段为空 | 先设置阶段，再发布包含该阶段节点的计划 |
| 237 `合成手测甲工地·小K全流程` | `plan.available=false` | 未发布计划 | 由项目经理发布计划；当前阶段为安装 |
| 238 `合成手测乙工地·小K全流程` | `plan.available=false` | 未发布计划 | 由项目经理发布计划；当前阶段为泥木 |
| 239 `合成手测公开样板工地·小K全流程` | `plan.available=false` | 未发布计划 | 由项目经理发布计划；当前阶段为水电 |
| 451 `合成·字体校验工地 2026-11-09` | `plan.available=false` | 未发布计划，阶段/成员/C01 也不完整 | 如企业管理员将该项目纳入试点，补齐阶段、成员、C01 和计划 |
| 647 `【合成四端】mwd7tyrb 四端工地` | `plan.available=false` | 未发布计划，当前阶段为空 | 先设置阶段，再发布计划 |

计划验收标准：

- `construction_plans` 出现当前有效计划版本，`readSchedule.available=true`。
- 计划节点引用真实房间和当前阶段，`structurallyValid=true`。
- 当前阶段至少有一个计划节点，`currentStageScheduled=true`。
- 不得用空计划、伪造日期或没有房间的节点“通过”检查。

暂停项目 402、403、404 当前不要求计划；如果重新改为 active，将重新进入计划检查。

### 4.3 迁移 0128/0129（1 项）

| 实际状态 | 失败原因 | 整改办法 | 复检标准 |
| --- | --- | --- | --- |
| 迁移账本 119 条；0128、0129 的表/字段/约束均不存在 | 开发库尚未应用 I7.1/I7.2 提醒迁移 | 先做数据库快照；使用迁移账号执行 `npm run db:migrate`；不要用业务账号或超级用户直接补表 | 账本包含 0128、0129；`construction_stage_reminders`、`construction_stage_reminder_pauses` 及回执字段存在 |

迁移后必须同时确认：

- `construction_stage_reminders` 有 `conversation_id`、`message_id` 和回执约束。
- 两张提醒表均启用 `FORCE ROW LEVEL SECURITY`。
- 租户策略 `tenant_scope` 存在，业务账号仍非超级用户。

### 4.4 提醒/周报 RLS（1 项）

| 实际状态 | 失败原因 | 整改办法 | 复检标准 |
| --- | --- | --- | --- |
| 两张提醒表不存在；其余周报/会话表 RLS 正常 | 0128、0129 未应用，提醒表没有 RLS | 先完成迁移；迁移后核对 ENABLE/FORCE RLS 和 `tenant_scope` 策略；不得为业务账号关闭 RLS | `database.rls` 九张表全部 `exists=true,rls=true,forced=true,policies>0` |

## 5. Warning 与具体整改办法

| 项目 | 实际状态 | 原因 | 整改办法 |
| --- | --- | --- | --- |
| 451 `合成·字体校验工地 2026-11-09` | 客户 4126 无开放 C01 会话 | 客户可进入项目，但没有 `customer_consultation` open/ai 会话 | 如企业管理员将该项目纳入试点，走现有 C01 初始化流程 |

该 warning 不是 blocker，但在项目 451 保留为试点项目时必须处理。

## 6. 其他整改建议

1. **设计师 2855 处于强制改密状态**：检查器未将其计入有效设计师（`must_change_password`）。当前 `role.designer` 仍由其他 3 个账号通过；如果项目 1、234 属于试点，需要该账号完成改密或改派其他设计师。
2. **项目 1、234 没有施工人员成员**：当前企业级 `role.worker` 由其他项目通过；如果这两个项目属于试点，需要补 active `worker` 成员。
3. **项目 451 没有设计师和施工人员成员**：与 C01 缺失一起处理，或将该合成项目移出试点范围。
4. **试点范围**：企业管理员按实际业务明确提供项目 ID。项目名称仅用于展示，项目变更继续使用 Construction 的现有流程。
5. **不要用数据库直写代替业务流程**：阶段、计划、成员、C01 和报告范围都应通过现有项目/跟进/报告流程配置，保留审计和权限检查。

## 7. 验收核对

### 7.1 只读与无副作用

在真实企业 1454 上对以下 17 张表执行检查前后快照（行数 + 内容 MD5）：

`construction_projects`、`construction_members`、`construction_stage_settings`、`construction_report_settings`、`construction_followup_bindings`、`construction_stage_reminders`、`construction_stage_reminder_pauses`、`construction_reports`、`construction_report_versions`、`assistant_conversations`、`assistant_messages`、`assistant_participants`、`assistant_runs`、`assistant_jobs`、`domain_event_outbox`、`admin_users`、`leads`。

结果：**0 张表发生变化**。没有创建提醒、周报、报告版本、站内消息或 outbox 事件；没有发送任何通知。

### 7.2 重复执行稳定

连续执行两次预检，去除 `checkedAt` 和 Worker 心跳时间/年龄后，两次报告的以下内容完全一致：

- `readiness`：`blocked`
- 21 项检查状态
- 12 个 blocker
- 1 个 warning
- 项目、角色账号、拒绝账号、周报计划、迁移与 RLS 结果

仅有 `checkedAt`、`lastSuccessAt` 和心跳秒数不同，属于运行时间差异。

### 7.3 权限边界

- 只读取企业 1454，没有扫描其他企业。
- 使用租户事务和 `sfp_app`；`superuser=false`、`bypassRls=false`。
- 没有使用平台管理员事务、超级用户或关闭 RLS 的方式绕过权限。
- 客户是平台级身份，租户事务看不到客户 `app.users` 行；检查器按线索/项目绑定识别业主，不把“用户行不可见”误判为没有业主。

### 7.4 检查器诊断修正

本轮真实预检发现并修正了两处诊断问题：

1. 业主检测不再 `join app.users`。客户是平台级身份，企业租户 RLS 会隐藏客户行；现在按 `leads.customer_user_id + customer_access` 识别业主，C01 仍单独核验真实会话。
2. 提醒表不存在时，`reminder.state` 标记为 `skipped`，不再显示为 passed；迁移/RLS 检查继续作为 blocker。

隔离 PG17 回归仍为 9/9 passed，`tsc --noEmit` 与定向 ESLint 通过。

## 8. 生产环境尚未验证的条件

本轮**没有连接生产数据库**，以下条件均未验证：

1. 生产企业 ID 是否为 1454、企业名称与状态是否一致；本报告只证明开发/试点环境中的 1454。
2. 生产数据库是否已应用 0128、0129，迁移账本与 RLS 是否正常。
3. 生产业务账号是否为非超级用户、是否保持 FORCE RLS。
4. 生产 Worker 是否运行、健康文件路径是否与服务配置一致。
5. 生产企业 Assistant 设置、报告计划、四角色受众与跟进会话是否与开发环境一致。
6. 生产项目、阶段、施工计划、成员和 C01 的真实配置。
7. 真实微信订阅消息、真机、真实相机/相册等仍未验证。

因此，本报告的 `blocked` 结论只适用于当前开发/试点环境和该次检查时间，不能作为生产上线批准。

## 9. 复跑方式

```powershell
cd admin
npm run check:pilot-readiness -- --enterprise-id 1454 --pilot-id '<管理员保存的试点ID>'
```

- 退出码 `0`：ready/limited；`2`：blocked；`1`：执行错误。
- 修复后重新执行，直到 blocker 为 0；只剩 warning 时为 `limited`。
- 复跑必须继续使用非超级用户业务账号，不得用超级用户或关闭 RLS 绕过。
- 原 I7.4.3 企业盘点可加 `--enterprise-audit` 复查。单独保存每次输出，保留原始证据。

### 证据文件

- `tmp/xiaok-i743-first-pilot/readiness-1454.json`（原始 JSON）
- `tmp/xiaok-i743-first-pilot/readiness-1454-run1.json`、`readiness-1454-run2.json`（稳定性复跑）
- `tmp/xiaok-i743-first-pilot/summary.json`（摘要）
- `tmp/xiaok-i743-first-pilot/db-before.json`、`db-after.json`（只读快照）
