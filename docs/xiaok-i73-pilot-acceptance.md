# 小K I7.3 四端真实体验与试点验收

> 基线：`codex/xiaok-integration`，源码 SHA `0593607da40a`。
> 状态：`passed`、`failed`、`limited`、`not_run`、`unknown`。
> 本轮不新增后台子系统、不新增专业 Agent、不增加装修阶段、不重建提醒/周报/Construction/Native Workflow、不开发 CAD/OCR/自动验收、不部署生产。

## 1. 隔离环境

| 项 | 值 |
| --- | --- |
| 数据库 | 同一隔离 PG17 容器 `sfp-i72-accept` 内新建 `i73_accept`，`127.0.0.1:55443` |
| 业务账号 | `sfp_app`（非超级用户，强制 RLS） |
| 迁移 | `npm run db:migrate`（`DATABASE_MIGRATION_URL` 指向 `i73_accept`），账本与 `0128`/`0129` 正常 |
| 应用服务 | 独立 `NEXT_DIST_DIR=.next-i73`，`http://127.0.0.1:3016`，Assistant Worker 同端口 |
| 小程序 | Stable DevTools `2.02.2608080`，基础库 `3.17.2`，逻辑视口 `390×844`，appId `wxa7728432f59779d1`，automator `ws://127.0.0.1:9421` |
| 企业 | `I7.3试点验收合成-<时间戳>`（本轮 `7`） |
| 账号 | 业主甲 `37`、业主乙 `38`、老板 `25`、项目经理 `26`、设计师 `27`、施工人员 `28` |
| 项目 | A `19`（水电）、B `20`（泥木）、C `21`（阶段变更/历史提醒） |
| C01 | `62` |
| 周报 | `97`–`102`（客户/老板/施工/设计，含修订版本） |
| 证据 | `tmp/xiaok-i73-acceptance/result-*.json`、`latest.json`；页面证据 `tmp/xiaok-i73-ui/result-*.json`、`owner-chat-result.json` 与 PNG |

小程序验收期间临时将 `miniprogram/utils/api.js` 的本地 API 指向 `127.0.0.1:3016`，验收后已恢复原值；未提交该临时改动。

## 2. 服务层验收（全部 passed）

脚本：`admin/scripts/xiaok-i73-acceptance.ts`，21 项检查全部 `passed`。

| 编号 | 检查 | 状态 | 证据 |
| --- | --- | --- | --- |
| R1 | 项目经理无私人会话时以现有工作台待办作为接收渠道 | `passed` | manager 提醒 `failed/no_inbox` 且 `channel=workbench` |
| R2 | 项目经理未借用老板或施工人员会话 | `passed` | manager 无 assistant conversation |
| R3 | 计划节点提醒返回真实房间定位信息 | `passed` | `relatedTaskId`、`roomId`、`actionUrl&roomId=` |
| R4 | 事项提醒返回真实 `issueId` 供页面定位 | `passed` | `relatedIssueId` = 事项 ID |
| R5 | 站内已送达不显示为已读 | `passed` | delivered 有 `deliveredAt`，无 read 字段 |
| R6 | 权限撤销后历史提醒内容不再返回 | `passed` | 设计师撤权后项目 A 提醒为 0 |
| R7 | 阶段变化后旧提醒进入历史并标记已过期 | `passed` | 项目 C 历史含 `expired/stage_changed` |
| R8 | 四端各自生成周报 | `passed` | customer/boss/designer/worker |
| R9 | 四端周报章节不同 | `passed` | 业主 8 节、设计师 7 节、老板 9 节、施工 6 节 |
| R10 | 业主周报不泄露内部问题与整改备注 | `passed` | 对客 issues 仅来自已发布记录待处理/待沟通 |
| R11 | 未配置模型时按确定性事实模板展示 | `passed` | `contentStatus=facts_only`，角色章节完整 |
| R12 | 保留 `sourceSnapshotVersion` 与报告版本 | `passed` | 快照等于 `facts_hash`，版本等于 revision |
| R13 | 业主周报只含自己的项目 | `passed` | 仅项目 A |
| R14 | 老板周报覆盖多个授权项目 | `passed` | A+B |
| R15 | 四端读取同一项目阶段事实 | `passed` | 同快照投影 |
| R16 | 历史周报可重新进入查看 | `passed` | `FollowupService.reports` |
| R17 | 修订生成新版本且旧版本保留 | `passed` | revision 1/2 均可读 |
| R18 | 项目经理完成正式复核并得到回执 | `passed` | 事项版本递增并进入 resolved/closed |
| R19 | 业主在原 C01 会话内得到当前阶段回答 | `passed` | 水电阶段确定性回答 |
| R20 | 业主与设计师均收到真实阶段事实提醒 | `passed` | 业主 delivered、设计师有真实提醒 |
| R21 | 未配置模型时阶段问答、提醒和周报事实仍可用 | `passed` | 无模型仍生成全部事实 |

提醒十类触发：阶段更新、节点临近、节点过期、责任人待办、业主待确认、设计师待核对、施工人员待补资料、记录待更新、阶段即将结束均有真实数据覆盖；问题超期仍为 `limited`（现有事项没有真实约定期限字段，不伪造期限）。

## 3. 四端真实 Stable 页面验收

所有页面均在 `390×844`、真实项目窗口、真实隔离 API 上执行；截图编码尺寸单独记录。

### A. 业主端（passed）

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 默认入口为原始 C01 连续对话 | `passed` | 路由 `packages/assistant/chat/chat`，会话 `62` |
| 原始消息保留 | `passed` | 重进读取同一会话与已有消息 |
| 阶段提醒可见 | `passed` | 3 条真实提醒（阶段已更新、待确认等） |
| 点击提醒进入对应项目 | `passed` | 打开项目 A 的私人简报与周报卡片 |
| 业主周报章节 | `passed` | progress/stage/completed/in_progress/confirmations/issues/next_week/records |
| 阶段知识回答 | `passed` | 原会话内“水电”回答并声明不替代企业标准/验收 |
| 连续追问 | `passed` | 同一会话追加回答，消息数 2→5→6 |
| 退出重进一致 | `passed` | 同一会话、同一消息与周报版本 |
| 多项目不擅自选错 | `passed` | 提醒指向项目 A 时才打开对应简报；项目 C 无绑定时给出明确提示 |
| 截图 | `limited` | 业主周报/重进截图成功；两处截图 RPC 超时，不影响页面数据断言 |

### B. 设计师端（passed）

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 真实账号密码登录 | `passed` | 登录页密码模式 |
| 只看到本人参与项目 | `passed` | 项目 A/B/C，无无关项目 |
| 工作台主动提醒 | `passed` | “我的待办”展示真实提醒 |
| 点击提醒进入正确项目 | `passed` | 项目详情 |
| 提醒跳转 | `passed` | 打开关联事项/房间或原页明确反馈 |
| 本周设计周报 | `passed` | audience=designer |
| 历史/重进 | `passed`（服务层） | `FollowupService.reports/detail` |

### C. 老板端（passed / limited）

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 跨项目列表 | `passed` | 授权范围内项目 A/B/C |
| 公司介入例外 | `passed` | 工作台例外提醒（计划过期） |
| 公司项目主动简报 | `passed` | 真实简报页可打开；工作台入口点击在自动化中落到私人简报页，已单独标记 limited |
| 跨项目周报 | `passed` | `bossWeekly` 卡片与项目总览、例外章节 |
| 周报快照/版本 | `passed` | 快照与 revision 显示 |
| 历史周报 | `passed`（服务层） | 历史列表可读 |
| 老板不因身份获得设计审批/验收 | `passed`（合同） | 老板仅跨项目读与例外，不进入设计/验收审批 |

老板周报与章节断言来自 21:27 的一轮真实页面执行，截图保留为 `boss-weekly.png`、`boss-weekly-detail.png`；该轮 `result-boss.json` 被后续失败重试覆盖。重跑只在 `result-boss.json` 保留 `boss.cross_project`、`boss.workbench_exception`、`boss.active_brief` 为 `passed`，工作台简报入口点击为 `limited`（自动化未跳转，直接打开真实简报页复核），并在“boss weekly list”处因 DevTools automator 响应超时中止。老板周报的干净结果 JSON 因此按历史证据保留，不改写为当前轮 `passed`。

### D. 施工人员端（passed / limited）

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 真实登录与项目范围 | `passed` | 只看到本人参与项目 |
| 当前阶段提醒 | `passed` | 项目详情真实提醒 |
| 拍照/语音入口 | `passed`（入口） | `.capture-action.add-photo` / `.voice` 存在 |
| 文字现场记录 | `passed` | 通过“打字”入口提交，进入项目事实并保留消息 |
| 系统关联项目和房间 | `passed` | 记录带项目与房间 |
| 真实相机/相册 | `limited` | 开发者工具不能验证真实拍照 |
| 重进记录仍在 | `passed` | 同一项目会话可读回 |

### E. 项目经理端（passed）

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 明确工作入口 | `passed` | 工地工作台“我的待办” |
| 本人负责项目待办 | `passed` | 工作台待办条目 |
| 工作台收件渠道 | `passed` | 项目详情状态“工作台待办”，不再显示发送失败 |
| 事项清单 | `passed` | 待整改、整改中、已修正 |
| 打开事项复核 | `passed` | 进入工地交流事项页 |
| 正式复核回执 | `passed`（服务层） | revision 递增，resolved/closed |
| 不新建聊天会话 | `passed` | manager 无 assistant conversation |

## 4. 提醒点击与跳转（I7.3.2）

- `actionUrl` 统一为 `/packages/construction/projects/projects?project=<id>&item=<id>&roomId=<id>`；计划节点带真实 `roomId`，事项带 `relatedIssueId`。
- 列表返回 `channel`：`conversation`（站内消息回执）、`workbench`（经理工作台）、`failed`；`delivered` 明确“已送达 · 未读”。
- 当前待办与历史分开：`cancelled/expired` 只进入历史并标记“已取消/已过期”。
- 项目页 `onLoad` 解析 `project/item/roomId/issueId/focus`：事项 → 工地交流复核模式；房间 → 计划模式；整体提醒 → 定位并提示。
- 目标不存在或已关闭时明确提示“提醒对应事项已完成或已关闭”，不创建新业务事项。
- 权限撤销后，服务端按当天成员/业主身份重新过滤，历史提醒内容不再返回。

## 5. 周报阅读与无模型降级（I7.3.3）

- 模型可用时保留自然语言正文；不可用时使用确定性事实模板，两种情况下统计来自同一 `facts` 快照。
- 四端章节：业主 8 节、设计师 7 节、老板 9 节、施工 6 节；同一项目阶段、计划颜色和问题状态来自同一快照。
- 业主章节只使用已发布对客记录；内部问题、整改备注、复核意见不进入业主周报。
- 未记录显示“未记录不等于未施工”；不生成完成百分比、提前/落后天数、下周计划或验收结论。
- 保留 `sourceRefs`、`sourceSnapshotVersion`、`reportVersion`；历史报告绑定原生成版本，修订生成新版本。
- 小程序详情显示“来源快照 … · 报告版本 …”和“本份周报按项目事实模板生成”，列表卡片增加角色章节预览。

## 6. 阶段问答与企业知识评估（I7.3.5）

- 当前阶段问答仍由本地十阶段知识包确定性回答，明确“本次未核实企业施工标准”。
- 本轮只评估 `KnowledgeRetriever` 复用条件：企业知识需要有效来源、受众与版本授权，当前隔离企业未配置，未注入。
- 未新增托管 RAG、未修改生产企业配置、未把本地 pgvector 冒充托管 RAG。
- 结论：企业知识接入需要独立配置/凭据与发布流程，列为后续能力；不阻塞第一版阶段问答。

## 7. AI 故障与消息稳定性（I7.3.6）

| 场景 | 状态 | 说明 |
| --- | --- | --- |
| 模型服务不可用 | `passed` | 未配置模型仍生成阶段回答、提醒和周报事实 |
| 模型响应超时 | `limited` | 本轮未注入真实模型超时；事实链路不依赖模型 |
| 周报模型整理失败 | `passed`（合同） | `facts_only` 模板可读 |
| 提醒 Worker 暂时失败 | `passed`（历史 I7.2） | 失败保留 `last_error`，条件仍成立可重试 |
| 通知会话暂时关闭 | `passed`（历史 I7.2） | `failed/no_inbox` 后重试送达 |
| 数据库事务回滚 | `passed`（迁移/事务检查） | 迁移探针回滚不留账本 |
| Outbox 重复投递 | `passed` | 同一提醒只追加一条站内消息 |
| 用户重复点击 | `passed` | 导航去重、提醒取消幂等 |
| 项目阶段变化 | `passed` | 旧提醒 `expired/stage_changed` |
| 用户权限撤销 | `passed` | 列表与历史均遮蔽 |

## 8. 工程回归

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| `npx tsx --test src/lib/xiaok-v1/__tests__/*.test.ts` | `passed` | 34/34 |
| 小程序定向测试（projects/reminder/followups/history/工地聊天/简报/客户项目/订阅） | `passed` | 10 个文件 152/152，`TEST_EXIT=0` |
| `npx tsc --noEmit` | `passed` | 无错误 |
| 定向 ESLint（xiaok reminders/engine/route-access） | `passed` | 无错误/警告 |
| 生产 Webpack 构建 | `passed` | `npx next build --webpack`，`NEXT_DIST_DIR=.next-i73-build`，`EXIT=0`，Build ID `TyWDMZmwqf0L9WssBPGL-`，不覆盖现有开发输出；日志 `tmp/i73-build-webpack3.log` |
| 小程序全量 | `limited` | 全量运行在既有 `test/survey-kernel-invariants.test.js` 退出处挂起（两次复现，与本次改动无关）；历史基线 2,249/2,250，唯一失败为既有测绘 Phase 0 审计 |

历史失败保留：Assistant 既有失败、测绘 Phase 0、防水 V1.1 `limited`、水电图纸 OCR `limited`、企业 RAG `limited`、真实微信 `not_run`。

## 9. 未验证与阻塞

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实微信订阅消息 | `not_run` | 未配置模板、授权和可验证回执；仅站内 |
| 真机/真实微信登录 | `not_run` | DevTools 模拟器不能替代 |
| 真实相机/相册拍照 | `limited` | 自动化无法选择真实照片 |
| 问题超期提醒 | `limited` | 事项没有真实约定期限字段 |
| 企业 KnowledgeRetriever | `limited` | 本轮只评估，未注入 |
| 生产部署 | `not_run` | 本轮不部署生产 |
| 部分截图 | `limited` | DevTools 截图 RPC 超时；页面数据断言有效 |

## 10. 第一版试点结论

**具备第一批试点条件（有边界）。** 四端可以在隔离环境完成真实登录、查看提醒、打开项目、查看/重进周报、提交施工现场记录、经理处理待办与复核。上线前必须完成：

1. 生产数据库快照与迁移；业务连接使用非超级用户并保持 RLS。
2. Assistant Worker 心跳与提醒/周报投递监控。
3. 企业 Assistant 设置、报告计划、四端试点账号与项目初始化。
4. 微信订阅消息未配置前只承诺站内提醒。
5. 生产部署仍需明确授权，本结论不等于已发布。

## 11. I7.4.1 老板端主动简报入口与周报导航修复

> 基线：`codex/xiaok-integration`，`dc946a4c5d37`；本节省略的四端结论仍以第 10 节为准。
> 本轮修复源码：`13b59e7360a92fb5658f1b8bbbd98d178561abfb`（`fix(xiaok): route boss brief entry to the company project brief`）。
> 本轮只修复老板端主动简报入口与周报导航，并完成老板端真实页面验收；不新增后台子系统、不新增专业 Agent、不增加装修阶段、不重建提醒/周报/Construction/Native Workflow、不开发 CAD/OCR/自动验收、不部署生产、不合并 main。

### 11.1 环境与账号

| 项 | 值 |
| --- | --- |
| 数据库 | 同一隔离 PG17 容器 `sfp-i72-accept` 内 `i73_accept`，`127.0.0.1:55443`，业务账号 `sfp_app` |
| 应用服务 | 独立 `NEXT_DIST_DIR=.next-i73`，`http://127.0.0.1:3016`，Assistant Worker 同端口 |
| 小程序 | Stable DevTools `2.02.2608080`，基础库 `3.17.2`，逻辑视口 `390×844`，automator `ws://127.0.0.1:9421` |
| 企业 | `I7.3试点验收合成-1794661611999`（`7`） |
| 老板 | 真实隔离账号 `i73_1794661611999_1`，管理员 `25`，`enterprise_admin`（owner） |
| 项目 | A `19`、B `20`、C `21` |
| 周报 | `99`，`weekly`，revision `1`，projects `19,20`，来源快照 `4636ee546352…` |
| 证据 | `tmp/xiaok-i741-ui/result-boss.json`、`boss-*.png` |

验收期间临时将 `miniprogram/utils/api.js` 本地 API 指向 `127.0.0.1:3016`，验收后已恢复原值，未提交该临时改动。工作区其他未提交改动（如 `native-preview`）保持原样，未纳入本轮提交。

### 11.2 修复

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 老板点击“项目简报 ↗”进入私人跟进会话而非公司项目简报 | `managementBrief` 同时要求协作开关和 owner/manager，老板（owner）在协作开关关闭时被回退到 `chat?followup=1` | `managementBrief` 对 owner 直接成立，老板打开 `/packages/construction/brief/brief`；非 owner 与协作开关行为不变 |
| 首页主动周报入口缺少稳定真实点击锚点 | `role-workbench` 为自定义组件，自动化只能在页面级选择器外定位 | 首页宿主增加 `id="role-workbench"`，通过组件宿主内的真实按钮完成点击，不改变视觉与业务行为 |

未增加老板的设计审批、工程验收或 Construction 写权限；未修改周报 facts/body 合同、`construction_reports` / `construction_report_versions` 数据合同或投递规则。

### 11.3 老板端真实页面验收

全部在同一 Stable DevTools、`390×844`、真实隔离 API、真实老板账号上完成；入口与按钮均通过真实点击触发。

| 检查 | 状态 | 证据 |
| --- | --- | --- |
| 老板跨项目列表 | `passed` | 项目 `21,20,19`，`owner=true` |
| 工作台主动简报入口存在 | `passed` | 项目页 `.brief-link` |
| 点击主动简报入口 | `passed` | 真实跳转 `packages/construction/brief/brief`，公司项目简报 3 个项目，`asOf=11月14日 23:16` |
| 不错误跳转业主私人简报 | `passed` | 落点为公司项目简报，不进入客户 `audience=customer` 绑定 |
| 首页主动周报入口真实点击 | `passed` | 组件宿主内“查看本周周报 ↗”真实点击，进入 `audience=boss` 的“企业工地简报” |
| 老板跨项目周报 | `passed` | 3 条简报记录；企业周报 `99` revision `1`，项目 `19,20`，快照 `4636ee546352`，`facts_only` |
| 无权项目不显示 | `passed` | 简报范围仅 `19,20,21`；无其他企业或范围外项目 ID |
| 点击周报进入详情 | `passed` | 周报 `99` revision `1`，快照一致；章节 `overview,stages,colors,new_issues,rectifying,review,fixed,exceptions,next_week` |
| 历史周报 | `passed` | 简报记录 3 条，含周报 `99` revision `1`；从历史打开同一版本与快照 |
| 退出重进一致 | `passed` | 重进后仍为周报 `99` revision `1`，快照 `4636ee546352` |
| 不增加设计审批/工程验收 | `passed`（合同） | 老板页面数据无“设计审批/工程验收”入口；权限未改 |
| 截图 | `passed` | `boss-projects.png`、`boss-brief.png`、`boss-weekly.png`、`boss-weekly-detail.png`、`boss-weekly-history.png`、`boss-weekly-history-detail.png`、`boss-weekly-reentry.png`、`boss-weekly-card-projects.png`、`boss-weekly-sections.png` |

DevTools 异常记录：首轮进入聊天页时模拟器空白，Wxml 面板显示 `body is="wx://not-found"`，页面节点不可读；完整重编译（Ctrl+B）后同一源码正常渲染，聊天页数据与周报均恢复。该现象判定为 DevTools 编译状态问题，不是页面脚本异常；空白截图与重编译后的页面证据均保留在 `tmp/xiaok-i741-ui/`，未据此直接宣布通过。

### 11.4 工程回归

| 检查 | 状态 | 结果 |
| --- | --- | --- |
| 定向小程序测试 | `passed` | `construction-projects`、`xiaok-i72-four-end-entries`、`assistant-followups`、`assistant-followup-chat/compose/enterprise/settings`、`assistant-report-context/history/plan/sources`，11 个文件 102/102 |
| `npx tsc --noEmit` | `passed` | 无错误 |

### 11.5 未验证与边界

| 项 | 状态 | 原因 |
| --- | --- | --- |
| 真实微信订阅消息 | `not_run` | 未配置模板、授权和可验证回执；仅站内 |
| 真机/真实微信登录 | `not_run` | DevTools 模拟器不能替代 |
| 生产部署 | `not_run` | 本轮不部署生产 |
| 其他三端页面 | `not_run` | 本轮固定只验收老板端；不修改业主、设计师、施工人员、项目经理页面 |

本轮结论：老板端主动简报入口已进入公司项目简报，老板可真实查看跨项目周报、详情、历史并在重进后保持版本与来源快照一致；未扩大老板权限，未修改周报与 Construction 数据合同。
