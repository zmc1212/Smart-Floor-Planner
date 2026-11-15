# 家客来 I7.5.11 四端真实页面与交互验收

> 分支：`codex/xiaok-integration`<br>
> 基线：`97f3a4c0`（已与 `origin/codex/xiaok-integration` 同步）<br>
> 产品基线：《家客来_小K_功能清单与四端UI基线_V3.docx》V3.2<br>
> 上轮报告：[I7.5.10 四端 UI 联调验收](./xiaok-i7510-four-end-ui-acceptance.md)<br>
> 状态口径：`passed` / `limited` / `failed` / `not_run`

## 1. 验收方式与边界

| 方式 | 本轮是否执行 | 说明 |
| --- | --- | --- |
| 微信 DevTools 真实页面自动化 | `not_run` | DevTools CLI 服务端口关闭；9420 端口可连接但不是 automator 协议（握手超时）。按要求未修改 IDE 安全设置 |
| DevTools / 真机截图 | `not_run` | 无可用自动化端口，未生成任何伪造截图 |
| 页面行为测试（Node 宿主，真实页面定义与处理器） | `passed` | 执行真实 `Page` 定义、按钮处理器、页面重进、错误与回执分支；API/`wx` 使用合成桩 |
| 交互控制器测试 | `passed` | 施工拍照/相册/语音、断网、上传失败、回执丢失、重新提交等状态机 |
| 真实 HTTP API + 数据库 | `passed` | 合成企业、合成账号、真实密码登录、真实 API 与数据库读写 |
| 全量自动化回归 | `passed`（保留既有失败） | 小程序 2259 项，2258 通过；唯一失败为既有测绘 Phase 0 基线审计 |

运行边界：

- 仅使用共享开发库中的合成企业（`I7.5.11业主会话-*`、`I7.5.10四端*`），结束后全部删除，复查无残留。
- 未读写企业 1454，未执行数据库迁移，未发送真实通知，未部署生产，未合并 main。
- 本轮直接运行 `npx next dev`，**未启动 assistant-worker**；未领取或处理任何真实任务。
- 其他 Agent 的未提交修改（含未跟踪文件）全部原样保留。

## 2. 四端页面验收矩阵

### 2.1 业主端

| 能力 | 页面 / 路由 | 真实数据与绑定 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 连续对话 | `packages/assistant/chat/chat` | `/api/miniprogram/assistant/entry-context`、`/conversations/:id`、`/messages` | `passed` | 合成客户令牌进入入口、读取同一会话 `2942`、重新进入仍为 `2942`、非本项目业主 `401` |
| 项目进度 | `owner-daily-card`、followup 详情 | `report.projects[].progress`、`CustomerProjectProgress.read` | `passed` | 服务层返回 `access=owner` 与真实计划快照；页面绑定存在 |
| 现场照片 | `followup-view` 原记录层、`construction-receipts` | `followupOriginal.media`、媒体读回 | `limited` | 绑定完整；真实相册/相机未执行 |
| 需求确认 | `plan-decision-card` | `planCards`、`planDecision`、方案版本回执 | `passed` | 页面处理器与方案回执契约测试通过 |
| 阶段提醒 | `owner-stage-brief` | `GET /api/miniprogram/xiaok/reminders` | `limited` | 页面加载、刷新、点击进入周报的行为测试通过；开发库缺 0128/0129，未做真实提醒读取 |
| 周报 | `owner-daily-card`、`owner-report-detail` | followup 报告、版本、快照 | `limited` | 页面重进与错误分支测试通过；未做真实周报生成 |

### 2.2 设计师端

| 能力 | 页面 / 路由 | 真实数据与绑定 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 需求关联 | `packages/construction/projects` 详情 `需求与设计` 组 | `issueGroups.designReviews`、`sourceKind=need` | `passed` | HTTP 以 `myRole=designer` 返回真实房间、方案和事项分组 |
| 点位图 | 详情新增「点位图与差异」卡片 → 工地交流 `mode=plan&roomId=` | `detail.rooms`、方案/材料查询 | `limited` | 本轮新增按房间入口；打开后由对话查询当前房间图纸、需求和方案，不是完整 CAD/点位编辑器 |
| 差异核对 | 详情新增差异分组计数与首个设计差异事项入口 | `issueSections`、`designerFocusIssue` | `limited` | 有真实差异来源与入口；没有新旧版本并排对照视图 |
| 意见提交 | `packages/construction/chat/chat` | `POST .../chat/messages`、幂等键、回执 | `limited` | 控制器测试覆盖回执、重复提交与重进；开发库缺 0126/0127，未执行真实发送 |
| 整改复核 | 事项聚焦、`request_changes`、`beginResubmit` | 事项状态、记录版本、补拍要求 | `limited` | 控制器测试覆盖补拍与复审；没有独立复核工作台 |

新增文件与入口：

- `miniprogram/packages/construction/projects/projects-model.js`：`designerFocusIssue`、`designerDesignCount`。
- `miniprogram/packages/construction/projects/projects.js`：`openRoomPlan`。
- `miniprogram/packages/construction/projects/projects.wxml`：设计师「点位图与差异」卡片。
- `miniprogram/packages/construction/projects/projects.less`：卡片与房间行样式。

### 2.3 老板端

| 能力 | 页面 / 路由 | 真实数据与绑定 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 主动简报 | `packages/construction/brief/brief` + 工作台入口 | `GET /api/miniprogram/construction/brief` | `passed` | HTTP 返回真实项目、计划状态与事项；工作台入口测试通过 |
| 项目进度 | 简报进度区 | `progress.overall`、`counts`、`version` | `passed` | 未排期显示灰色待核实，不推断逾期 |
| 需介入事项 | 简报 `需介入 · N 项` | `issues[].label`、`waitingFor` | `passed` | 简报事件消费与页面行为测试通过 |
| 问题总清单 | 项目详情事项分组 | `issueGroups`、`issueSections` | `passed` | 「查看问题与已修正清单」跳转项目详情 |
| 已修正清单 | 简报计数 + 详情 `fixed` 组 | `status in (resolved, closed)` | `passed` | 未把已排除/已取消混算为已修正 |

### 2.4 施工人员端

| 能力 | 页面 / 路由 | 真实数据与绑定 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| 当前任务 | `packages/construction/projects/projects` | `GET /api/miniprogram/construction/projects` | `passed` | HTTP 以 `myRole=worker` 返回本人项目 |
| 拍照 | `packages/construction/chat/chat` → `photo()` | `wx.chooseMedia`、`camera/album`、`capture.addFile` | `limited` | 页面测试验证相机/相册参数、4 张上限、加入持久草稿；真实相机未执行 |
| 语音 | `voice()`、`speechController.microphone/playLocal` | 录音文件、播放、随记录上传 | `limited` | 页面与控制器测试验证录音/播放/上传状态；真实麦克风未执行 |
| 施工记录 | 工地交流记录卡、项目详情预览 | `chat` 读回、记录版本、照片 | `passed` | 控制器与页面测试覆盖记录、媒体、版本与重进 |
| 提交回执 | `site-capture.flush` | `status=received`、`requestKey`、`recordId`、`messageId`、`mediaIds` | `passed` | 回执校验、回执丢失核对、上传失败重试、断网续传均通过 |
| 整改反馈 | 事项聚焦、`要求补拍` / `按要求补拍` | `canResubmit`、`review_requirements` | `limited` | 补拍/复审状态机测试通过；没有独立整改反馈表单 |

## 3. 真实交互检查

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| 主要按钮执行对应操作 | `passed` | 8 个四端页面的事件处理器均有定义，缺失 0；页面测试实际调用 `openRoomPlan`、`openProjects`、`openProjectIssues`、`photo`、`voice`、`send`、`retryCapture` 等 |
| 页面重新进入数据刷新 | `passed` | 业主提醒二次加载、简报 `onShow` 重载、项目页重进、聊天空格 `onShow` 重新查询 |
| 成功与失败提示 | `passed` | 回执成功清队列、回执丢失显示待核对、失败保留本地原件、权限拒绝显示明确错误 |
| 重复提交幂等 | `passed` | 项目创建同一 Key 返回同一 ID；阶段写入两次返回同一版本；拍照/语音使用同一 `Idempotency-Key` 与上传 Key |
| 不同角色页面与数据权限 | `passed` | 老板/设计师/施工 API 各自可见；跨企业列表为空；施工改阶段、设计改成员均 `403`；非本项目业主 `401` |
| 消息重进原业务页面 | `passed` | 提醒 `issueId → mode=review`、`roomId → mode=plan&roomId=`；已关闭事项给出明确提示 |
| 四端共享同一项目事实 | `passed` | 服务层 16/16、HTTP 14/14，同一项目、房间、阶段和事项来源 |
| 移动端键盘、安全区、滚动、弹窗 | `limited` | 代码保留 `env(safe-area-inset-bottom)`、键盘高度与弹层状态；本轮无真实宿主可验证遮挡 |
| 390×844 画布 | `limited` | 设计基线与测试断言存在；未生成真实 DevTools 截图 |
| 断网、上传失败、重新提交 | `passed` | 离线原件先落盘、回执丢失核对、上传失败复用同一上传 Key、重新联网只提交一次 |
| 静态截图冒充交互 | 未使用 | 本轮没有用截图证明交互通过 |

## 4. 重点补齐结果

1. **业主端真实身份和会话**：新增 HTTP 验收脚本，使用合成客户令牌调用真实 `entry-context`、会话详情、消息列表和重进读取；8/8 通过，非本项目业主 401。
2. **设计师点位图与差异对照入口**：项目详情新增「点位图与差异」卡片，按房间打开现有图纸/需求/方案查询，并提供设计差异事项入口；用真实 `rooms`、`plans`、`issueGroups` 数据断言。
3. **施工端相机、相册、语音状态机**：页面测试验证 `sourceType=['camera','album']`、4 张上限、语音录音/播放、提交/重试；控制器测试继续覆盖断网、上传失败、回执丢失与重新提交。
4. **断网、上传失败、重新提交**：`construction-site-capture.test.js` 12 项全部通过，覆盖离线持久化、同 Key 重传、回执核对与权限撤销清理。
5. **消息重新进入原业务页面**：新增页面测试覆盖提醒深链到事项复核、房间计划，以及已关闭事项的明确提示。
6. **四端共享同一项目事实**：服务层与 HTTP 验收使用同一合成项目，老板/设计师/施工/业主读取同一阶段、房间与事项。

## 5. 状态汇总

### 5.1 passed

- 业主真实客户令牌、C01 会话读取、消息列表、重进同一会话。
- 老板主动简报、项目进度、需介入事项、问题总清单、已修正清单的页面绑定与 API。
- 设计师需求关联、点位/差异入口数据源。
- 施工人员当前任务、施工记录、提交回执状态机。
- 角色权限、跨企业隔离、操作幂等、写入后状态刷新。
- 全量小程序测试 2259 项中 2258 通过；定向四端 184/184。

### 5.2 limited

- 业主现场照片、阶段提醒、周报：页面与行为测试通过，真实提醒/周报读取受开发库缺 0128–0131 限制。
- 设计师点位图与差异：已有按房间入口和差异事项入口，但没有完整点位图编辑器和并排版本对照。
- 设计师意见提交、整改复核：控制器与页面测试通过，未做真实发送/复核工作台。
- 施工拍照、语音、整改反馈：页面与状态机测试通过，真实相机/麦克风/补交未执行。
- 移动端键盘、安全区、滚动、弹窗与 390×844 视觉：无真实 DevTools/真机截图。

### 5.3 failed

- 本轮验收范围内无新增失败。
- 保留既有失败：小程序 `survey-kernel-phase0-baseline.test.js` 测绘 Phase 0 基线审计，与本轮四端页面无关。

### 5.4 not_run

| 项 | 原因 |
| --- | --- |
| DevTools 真实页面自动化 | CLI 服务端口关闭；9420 非 automator 协议；按要求未修改 IDE 安全设置 |
| DevTools / 真机截图 | 无可用自动化端口，未伪造截图；截图清单见 `tmp/xiaok-i7511-evidence/manifest.json` |
| 真机微信登录、相机、相册、语音 | 需真实设备与微信授权 |
| 真实微信通知 | 未配置模板与授权 |
| 隔离数据库验收 | 本轮禁止数据库迁移，且无可用隔离 PG |
| 生产部署 / 合并 main | 本轮禁止 |

## 6. 证据文件

| 文件 | 内容 |
| --- | --- |
| `tmp/xiaok-i7511-evidence/owner-conversation.txt` | 业主身份、入口、会话、消息、重进、跨业主 8 项 |
| `tmp/xiaok-i7511-evidence/service-database.txt` | 四端服务层/数据库角色隔离 16 项 |
| `tmp/xiaok-i7511-evidence/http-api.txt` | 真实登录、项目/简报读取、403、幂等、刷新 14 项 |
| `tmp/xiaok-i7511-evidence/miniprogram-tests.log` | 小程序全量 2259 项结果 |
| `tmp/xiaok-i7511-evidence/manifest.json` | 页面、角色、390×844、步骤与截图状态 |

## 7. 结论

本轮补齐了业主真实身份/会话、设计师点位图与差异入口、施工拍照语音页面处理器、断网/失败/重提、消息重进业务对象和四端共享事实的可执行验收。

真实 DevTools 页面与截图、真机相机/麦克风仍未执行，原因是 DevTools 自动化端口未开启且按约束未修改 IDE 安全设置。**本轮不能表述为“四端真机验收通过”**；已通过的是页面行为、交互控制器、真实 HTTP API 与数据库角色隔离三层验收。
