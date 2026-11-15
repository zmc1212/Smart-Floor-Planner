# 家客来 I7.5.10 四端真实业务 UI 联调与验收

> 分支：`codex/xiaok-integration`<br>
> 基线：`a9ad8055`（已与 `origin/codex/xiaok-integration` 同步）<br>
> 产品基线：《家客来_小K_功能清单与四端UI基线_V3.docx》V3.2（2026-10-10）<br>
> 状态口径：`passed` / `limited` / `failed` / `not_run`
> 本轮不重做已验收的业务逻辑，不新增专业 Agent、不增加装修阶段、不重建提醒/周报/Construction/Native Workflow。

## 1. 执行边界与环境

| 项 | 实际执行 |
| --- | --- |
| 数据库 | 共享开发库 `smart_floor_planner`（`127.0.0.1:5432`，SSH 隧道，业务账号 `sfp_app`） |
| 数据隔离 | 每轮仅创建名称前缀为 `I7.5.10四端联调-` / `I7.5.10四端HTTP-` 的合成企业，结束后删除本轮创建的行 |
| 企业 1454 | 未读取、未写入、未修改任何配置或业务数据 |
| 数据库迁移 | 未执行。开发库停在 0125，缺 0126–0131（提醒、试点范围、委派等表） |
| Worker | 未主动启动。`npm run dev` 的开发脚本会自动拉起 assistant-worker，但其安全预检未通过（`preflight_unavailable` / `unauthorized`）并持续退出；复核近 90 分钟 `assistant_jobs` 变动为 `0`，未领取或处理任何任务 |
| 真实通知 | 未发送 |
| 生产部署 / 合并 main | 未执行 |
| 并行 Agent 改动 | 22 个已跟踪文件与 2 个未跟踪文件原样保留，未纳入本轮提交 |

## 2. 四端页面、路由、API 与数据绑定盘点

### 2.1 业主端

| V3 能力 | 页面 / 路由 | 正式 API | 数据绑定 | 结论 |
| --- | --- | --- | --- | --- |
| 项目进度 | `packages/assistant/chat/chat` → `owner-daily-card` | `/api/miniprogram/assistant/...` followups / report detail | `report.projects[].progress`、`pending` | `passed`；服务层 `CustomerProjectProgress.read` 返回 `access=owner` 与真实计划快照 |
| 连续对话 | `packages/assistant/chat/chat`（C01 默认入口） | ChatController 会话、消息、entry token | `messages`、`conversation`、`followupChat` | `passed`；重进读取同一会话，非新首页 |
| 现场照片 | `followup-view` 原记录层、`construction-receipts` | followups 原记录 / 站点媒体读回 | `followupOriginal.media`、`siteRecordPaths` | `limited`；绑定与权限回读完整，真实相册/相机未执行 |
| 需求确认 | `chat.wxml` → `plan-decision-card` | 方案决定动作（同意/不同意/稍后/要求调整） | `planCards`、`planDecision`、`planPaths` | `passed`；旧版本不能批准新内容的服务端契约未改动 |
| 阶段提醒 | `chat.wxml` → `owner-stage-brief` | `GET /api/miniprogram/xiaok/reminders` | `ownerStageReminders`、`ownerWeeklyBindingId` | `limited`；页面与 API 路径存在，开发库缺 0128/0129，未做真实读取 |
| 周报 | `owner-daily-card`、`owner-report-detail` | followups 报告与版本 | `weeklyReport.sections`、`sourceSnapshotLabel`、`revision` | `limited`；页面与事实模板完整，开发库缺提醒/试点迁移，未做真实生成 |

### 2.2 设计师端

| V3 能力 | 页面 / 路由 | 正式 API | 数据绑定 | 结论 |
| --- | --- | --- | --- | --- |
| 需求关联 | `packages/construction/projects` 详情 `issueSections`（`需求与设计` 组） | `/api/miniprogram/construction/projects/:id` | `issueGroups.designReviews`、`sourceKind=need` | `passed`；HTTP 详情以 `myRole=designer` 返回真实项目、房间与事项 |
| 点位图 | 工地交流中的图纸/材料查询 | `/api/miniprogram/construction/projects/:id/chat` | 查询响应与共享材料投影 | `limited`；没有独立的点位图工作区，只能通过对话查询当前图纸/方案 |
| 差异核对 | 事项分组 + 对话查询 | 同上 | `issueSections`、`pendingIssues`、`approvedPlans` | `limited`；有真实差异来源，但没有专用新旧版本对照视图 |
| 意见提交 | `packages/construction/chat/chat` | `POST .../chat/messages` | `client_message_id`、`Idempotency-Key`、引用与回执 | `limited`；提交路径与幂等键完整，开发库缺 0126/0127 委派表，未执行真实发送 |
| 整改复核 | 事项聚焦、记录 `request_changes` / `beginResubmit` | 事项读回、记录版本 | `issues`、`canRequestChanges`、`canResubmit` | `limited`；有真实状态与回执，没有独立的复核工作台 |

### 2.3 老板端

| V3 能力 | 页面 / 路由 | 正式 API | 数据绑定 | 结论 |
| --- | --- | --- | --- | --- |
| 主动简报 | `packages/construction/brief/brief`；本轮新增工作台入口 | `GET /api/miniprogram/construction/brief` | `items[].summary`、`progress`、`latestRecord`、`issues` | `passed`；HTTP 简报返回真实项目、计划状态与事项 |
| 项目进度 | 简报进度条 + 项目详情 | 同上 | `progress.overall`、`counts`、`version` | `passed`；未排期显示灰色待核实，不推断逾期 |
| 需介入事项 | 简报新增 `需介入 · N 项` | 同上 | `issues[].label`、`waitingFor`（本轮新增消费） | `passed`；单元测试断言待整改/整改中与已修正计数 |
| 问题总清单 | `packages/construction/projects` 详情事项分组 | `/api/miniprogram/construction/projects/:id` | `issueGroups`、`issueSections` | `passed`；简报可跳转项目详情，分组包含待核实/待整改/整改中/已整改待复核 |
| 已修正清单 | 简报 `已修正 · N 项` + 项目详情 `fixed` 组 | 同上 | `issues[].status in (resolved, closed)` | `passed`；未把已排除/已取消混算为已修正 |

### 2.4 施工人员端

| V3 能力 | 页面 / 路由 | 正式 API | 数据绑定 | 结论 |
| --- | --- | --- | --- | --- |
| 当前任务 | `packages/construction/projects/projects` | `GET /api/miniprogram/construction/projects` | `items[]`、`my_role`、`stageName`、`workLabel` | `passed`；HTTP 以 `myRole=worker` 返回本人参与项目 |
| 拍照语音 | `packages/construction/chat/chat` + `site-capture.js` | `POST .../chat/media`、`POST .../chat/messages` | `capturePhotos`、`captureVoice`、上传回执 | `limited`；状态机、幂等键与失败保留完整，真实相机/语音未执行 |
| 施工记录 | 工地交流记录卡、项目详情预览 | `GET .../chat`、`.../chat/media/:id` | `record`、`media`、`versions` | `passed`；记录、版本与照片路径均由服务端回执生成 |
| 提交回执 | `site-capture.flush` | `status=received`、`requestKey`、`recordId`、`messageId`、`mediaIds` | 回执校验后才清空本地队列 | `limited`；单元测试覆盖回执与断网重试，未做真实网络弱网 |
| 整改反馈 | 事项聚焦、`要求补拍` / `按要求补拍` | 事项读回、记录 `request_changes` / `resubmit` | `canRequestChanges`、`canResubmit`、`review_requirements` | `limited`；有真实补交流程，没有独立的整改反馈表单 |

## 3. 本轮断点与修复

| 断点 | 修复前表现 | 修复 | 文件 |
| --- | --- | --- | --- |
| 老板无法从工作台进入主动简报 | 只能经「我的 → 云工地 → 项目简报」三级深链 | 工作台新增「项目简报与问题清单」入口 | `miniprogram/components/role-workbench/role-workbench.wxml`、`.js`、`.less` |
| 设计师无法从工作台进入工地协作 | 只能经「我的 → 云工地」 | 工作台新增「工地协作与需求核对」入口 | 同上 |
| 简报未展示 API 已返回的事项 | 只显示一行 `summary`，看不到需介入/已修正 | 消费 `issues`，新增需介入前 3 项、已修正计数与清单入口 | `miniprogram/packages/construction/brief/brief.js`、`.wxml`、`.less` |
| 「查看项目明细」按钮无效 | 仅执行 `navigateBack`，没有打开项目明细 | 改为 `openProjects`，进入项目列表 | `brief.wxml`、`brief.js` |
| 方案缺少房间时点击无反应 | `openPlan` 的 `scope` 为空，直接 return | 有方案 ID 即进入工地交流 `mode=plan`；无房间时由对话查询本项目图纸/方案 | `miniprogram/packages/construction/projects/projects.js`、`packages/construction/chat/chat.js` |
| 既有测试误报 | `role-workbench` 已带 `id`，旧正则仍要求标签后紧跟 `wx:elif` | 修正为允许 `id` 属性 | `miniprogram/test/phase-13-customer-referrer-portal.test.js` |

新增回归断言：

- `miniprogram/test/construction-brief.test.js`：简报待介入/已修正计数、项目明细与清单跳转。
- `miniprogram/test/construction-projects.test.js`：无房间方案仍打开 plan 模式；失效方案不打开。
- `miniprogram/test/xiaok-i72-four-end-entries.test.js`：老板/设计师工地入口与简报事项区块。

## 4. 测试与证据

### 4.1 自动化测试

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| 小程序定向四端测试（construction/followup/report/role 等 12 个文件） | `passed` | 178/178 |
| 小程序全量 `npm test` | `passed`（有新范围外既有失败） | 2253 项，2252 通过；唯一失败为既有测绘 Phase 0 基线审计，与本轮 UI 无关 |
| Admin construction 纯函数与契约测试 | `passed` | `npx tsx --test src/lib/construction/__tests__/*.test.ts` 148/148 |
| Admin TypeScript | `passed` | `npx tsc --noEmit` 无错误 |
| 四端页面事件处理器静态审计 | `passed` | 8 个页面共 268 个 `bind/catch` 处理器，缺失 0 |

### 4.2 隔离企业数据库验收（共享开发库，合成企业）

脚本：`admin/scripts/xiaok-i7510-service-acceptance.ts`。仅创建、读取、删除前缀为 `I7.5.10四端联调-` 的合成企业。16/16 通过：

| 编号 | 检查 | 状态 |
| --- | --- | --- |
| 1 | 同一 Idempotency-Key 重复创建项目不新建 | `passed` |
| 2 | 企业负责人可见本项目 | `passed` |
| 3 | 项目经理可见本项目 | `passed` |
| 4 | 设计师可见本人参与项目 | `passed` |
| 5 | 施工人员可见本人参与项目 | `passed` |
| 6 | 其他企业负责人看不到本项目 | `passed` |
| 7 | 设计师可读取需求、点位/方案与现场事实 | `passed` |
| 8 | 施工人员可读取当前任务与现场记录 | `passed` |
| 9 | 设计师不能修改工地成员（`construction_forbidden`） | `passed` |
| 10 | 施工人员不能修改施工阶段（`construction_forbidden`） | `passed` |
| 11 | 老板简报读取真实项目事实 | `passed` |
| 12 | 设计师简报不进入管理层跨项目范围 | `passed` |
| 13 | 业主可读取本人项目进度 | `passed` |
| 14 | 非本项目业主不能读取进度 | `passed` |
| 15 | 仅使用共享开发库合成企业，未读写 1454 | `passed` |
| 16 | 仅删除本轮合成数据 | `passed` |

### 4.3 真实 HTTP API 验收

脚本：`admin/scripts/xiaok-i7510-http-acceptance.ts`，本地 Next.js 服务 `127.0.0.1:3006`，真实密码登录取得小程序令牌。14/14 通过：

| 编号 | 检查 | 证据 |
| --- | --- | --- |
| 1 | 老板、设计师、施工人员真实密码登录 | 三角色均返回 `success=true` 与 staff token |
| 2 | 老板 API 读取本项目列表 | `200`，包含本轮项目 |
| 3 | 设计师 API 读取本人项目列表 | `200`，包含本轮项目 |
| 4 | 施工人员 API 读取本人项目列表 | `200`，包含本轮项目 |
| 5 | 其他企业 API 列表为空 | `200`，`items=[]` |
| 6 | 设计师详情读取 | `200`，`myRole=designer` |
| 7 | 施工人员详情读取 | `200`，`myRole=worker` |
| 8 | 老板主动简报 | `200`，包含项目、计划状态与事项 |
| 9 | 施工人员修改阶段被拒绝 | `403 construction_forbidden` |
| 10 | 设计师修改成员被拒绝 | `403 construction_forbidden` |
| 11 | 阶段写入回执与重复提交幂等 | 两次均 `200`，同一 `id`、同一 `version=4` |
| 12 | 写入后重新读取状态刷新 | `current_stage_key=utilities` |
| 13 | 仅使用合成企业 | 未读写 1454 |
| 14 | 合成数据清理 | 两轮合成企业均已删除，复查无残留 |

## 5. 状态汇总

### 5.1 已通过（passed）

- 四端共用同一项目事实：同一项目在老板/设计师/施工 HTTP 读取中返回同一 `projectId`、阶段和事项来源。
- 服务端角色权限：越权写入返回 `403`，跨企业列表为空，不依赖前端隐藏按钮。
- 老板主动简报、项目进度、需介入事项、问题总清单、已修正清单。
- 设计师需求关联（项目详情 `需求与设计` 组）。
- 施工人员当前任务、施工记录。
- 业主连续对话、项目进度、需求确认。
- 操作幂等：项目创建与阶段写入同一 Idempotency-Key 不重复生效。
- 四端页面事件处理器完整性。

### 5.2 受限（limited）

- 业主现场照片、阶段提醒、周报：页面与 API 绑定完整，但开发库缺 0128–0131，未做真实提醒/周报读取。
- 设计师点位图、差异核对、意见提交、整改复核：有真实事项/方案/对话路径，但没有独立工作区或独立复核表单。
- 施工人员拍照语音、提交回执、整改反馈：代码与单元测试覆盖，真实相机/语音、弱网与真实补交未执行。
- 消息重进与历史记录：页面 `onShow` 重载与报告历史逻辑存在，未做真实页面重进。
- 移动端 390×844：新增入口沿用现有样式与安全区，未做真实宿主截图验收。
- AI 不可用时人工可用：仓库内已有 `facts_only` 与确定性模板测试，本轮未重新执行真实模型故障注入。

### 5.3 失败（failed）

- 本轮执行范围内无新增失败。
- 保留既有失败：小程序 `survey-kernel-phase0-baseline.test.js` 的测绘 Phase 0 基线审计（与本轮四端 UI 无关）。

### 5.4 未执行（not_run）

| 项 | 原因 |
| --- | --- |
| 隔离数据库验收 | 无可用隔离 PG17：Docker daemon 不可用，`sfp_migrator` 无 CREATEDB；本轮禁止执行数据库迁移，不能新建并迁移隔离库 |
| 真实页面 / DevTools 自动化 | WeChat DevTools CLI 服务端口关闭，需人工在 IDE 安全设置开启；且开发库缺 0126–0131，提醒/周报/委派链路无法在本地完整运行 |
| 真机验收 | 需真实微信登录、相机、相册、语音与网络环境，本轮不具备 |
| 真实微信订阅消息 | 未配置模板与授权，未发送 |
| 生产部署 / 合并 main | 本轮禁止 |

## 6. 未覆盖与风险

1. 0126–0131 未应用是本地真实页面验收的主要阻塞；在补齐隔离库迁移前，不应把提醒、周报、委派链路的 `limited` 提升为 `passed`。
2. 设计师点位图与差异对照仍以事项/对话投影呈现，V3 的独立图纸工作区属于后续 UI 补齐项，本轮未新造。
3. 施工端整改反馈仍复用“要求补拍/按要求补拍”和事项对话，没有独立整改表单；不把补拍回执当作复核通过。
4. 本轮运行 `npm run dev` 时开发脚本自动拉起 assistant-worker；安全预检未通过并持续退出，未领取任务（近 90 分钟 `assistant_jobs` 变动 0）。后续验收应使用不自动启动 Worker 的启动方式，或在启动前显式关闭该子进程。
5. 并行 Agent 的未提交改动保持原样，本轮提交只包含上述 UI 修复、测试和本报告。

## 7. 结论

四端共用的项目事实、角色权限、操作回执与幂等已在真实开发库的合成企业上通过 HTTP 与数据库验证；本轮修复了老板/设计师缺少工地入口、简报不消费事项、项目明细按钮无效、无房间方案点击无响应四个主要 UI 断点。

由于隔离数据库和迁移被禁止、开发库缺少 0126–0131 且 DevTools 服务端口关闭，**真实页面与真机验收仍未执行**。本轮结论是“四端业务 UI 联调完成到 API/数据库与组件绑定层”，不等同于四端真机验收通过。
