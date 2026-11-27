# 工人端「工地」工作台重构与上报审核闭环计划

## 1. 目标与范围

把施工工人端（`construction_staff`）从“工地交流 + 小K”的协作式界面，改成更接近 SaaS 的工地作业界面：

1. 工人端首页只保留两个入口：**工地**、**我的**，不再出现小K页面。
2. 工作台先选工地，再在现场上报；上报在独立页面完成，不跳转工地交流页。
3. 上报支持照片墙（最多 9 张，类似朋友圈九宫格）、语音、文字，并人工多选本次涉及的施工阶段。
4. 上报后状态为**待审核**；施工经理、项目设计师或企业老板任一人审核通过后才算通过。
5. 工作台可查看自己的历史上报：默认今天，支持昨天、近7天和日历范围筛选。
6. 先基于现有设计稿出一版新设计图，用户确认后再开发。

本次只改工人端工作台、上报页、相关接口/数据和审核权限；管理后台网页不新增审核入口（用户已确认审核在小程序工作台完成）。

---

## 2. 当前实现分析

### 2.1 导航与身份

- [app.json](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/app.json) 注册了 `pages/index/index`、`pages/mine/mine` 等主包页面和 `packages/construction` 分包。
- [custom-tab-bar/index.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/custom-tab-bar/index.js) 目前对 `construction_staff`、`designer`、`enterprise_admin` 统一使用 `workbenchTabs()`：**小K / 工作台 / 我的**。
- [pages/index/index.wxml](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/pages/index/index.wxml#L9-L12) 对施工员工、设计师、老板渲染 `site-workbench` 或 `xiaok-chat`，由 `globalData.siteWorkbenchTab` 切换。
- [pages/index/index.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/pages/index/index.js#L137-L139) 保存 `siteWorkbenchTab`，当前默认 `/pages/index/index` 角色的 landing 也是这里。

### 2.2 工作台

- [packages/construction/workbench/workbench.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/construction/workbench/workbench.js) 是首页内的工地工作台组件，读取 `GET /api/miniprogram/construction/workbench?projectId=`。
- 工人视图当前包含：今日任务、现场上报（拍照 / 说一句）、最近提交回执、工地日报与周报。
- `capture()` 当前把拍照/说一句导航到 `/packages/construction/chat/chat?projectId=…`，通过 `eventChannel` 触发聊天页的上报面板；这正是用户要求去掉的跳转。
- 设计基线为 [site-role-workbenches-20261117](file:///g:/workspace/向总/Smart-Floor-Planner/design-references/site-role-workbenches-20261117/README.md) 的工人稿 `01-worker-v001.png`：暖白手账、深绿书脊、三项底栏、今日任务、现场上报、最近提交。

### 2.3 上报与审核

- 现有上报链路在 [site-chat.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/site-chat.ts#L217-L308) 的 `send()` / `saveSiteCapture()`：
  - 工人发送照片/语音/文字 → `app.construction_site_records` 状态 `organizing`；
  - 小K整理为 `draft`（等经理核对）；
  - 经理在工地交流页 `publish` → `published`，可 internal 或 customer；
  - 退回 → `changes_requested`，工人补拍 → 新记录 `resubmitting`。
- 当前 `publish` / `request_changes` 主要要求 `permission.manage`（项目经理或非协作企业的 owner）；设计师不能审核，owner 在协作企业中也缺少审核入口。
- 当前单条记录最多 4 张照片（[0083_construction_shared_chat.sql](file:///g:/workspace/向总/Smart-Floor-Planner/admin/drizzle/0083_construction_shared_chat.sql#L53-L58) 的 `position BETWEEN 0 AND 3`，以及 [site-capture.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/construction/chat/site-capture.js#L57-L60) 的 4 张限制）。
- 记录没有“本次上报施工阶段”的独立字段；项目只有一个 `current_stage_key`，无法表达多个阶段同时施工。

### 2.4 数据与接口

- 工作台接口：[admin/src/app/api/miniprogram/construction/workbench/route.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/app/api/miniprogram/construction/workbench/route.ts) 目前只接受 `projectId`。
- 工作台聚合：[admin/src/lib/construction/workbench.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/workbench.ts) 目前只返回最新回执（`receipt`），没有历史列表和日期筛选。
- 工地聊天/上报接口：[admin/src/lib/construction/site-http.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/site-http.ts) 提供 `messages`、`media`、`records/:id/:action`、`speech`、`operations`。
- 施工阶段配置：`app.construction_stage_settings.stages`，由 [stages-store.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/stages-store.ts) 读取；默认阶段在 [stages.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/stages.ts#L16-L20)。
- 现有“我的”页 [pages/mine/mine.wxml](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/pages/mine/mine.wxml) 已支持 `construction_staff`，本次不改内容，只改底栏。

---

## 3. 已确认的产品决策

| 决策 | 结果 |
| --- | --- |
| 工人端底栏 | 仅 **工地 / 我的**，不显示小K |
| 工作台范围 | 先选工地，再上报、看该工地内自己的历史上报 |
| 上报形态 | **独立上报页**，不是弹层，也不是工地交流页 |
| 照片 | 照片墙，最多 9 张，类似朋友圈九宫格 |
| 施工阶段 | 上报页从后台配置的施工阶段中**人工多选**，允许同时施工的多个阶段 |
| 上报状态 | 提交后显示 **待审核**；通过后显示 **审核通过**；退回显示 **需补充** |
| 审核人 | 施工经理、项目设计师、企业老板任一通过即可 |
| 审核入口 | 小程序各角色工作台（管理后台网页不新增） |
| 历史记录 | 仅当前所选工地、仅本人上报；默认今天；快捷项昨天/近7天；日历范围筛选 |
| 详情 | 工作台内上滑详情面板；退回后可进入原有补交链路 |

---

## 4. 阶段 A：新设计稿（设计-only，先确认）

### 4.1 交付目录

新增 `design-references/worker-site-saas-v1-20261118/`：

```
README.md
01-worker-site-today-v001.png       # 853x1844 设计稿
01-worker-site-today-v001-390.png   # 390x844 预览
02-worker-report-v001.png
02-worker-report-v001-390.png
03-worker-calendar-v001.png
03-worker-calendar-v001-390.png
04-worker-report-detail-v001.png
04-worker-report-detail-v001-390.png
image-checks.json
prompts/01-worker-site-today-v001.txt
prompts/02-worker-report-v001.txt
prompts/03-worker-calendar-v001.txt
prompts/04-worker-report-detail-v001.txt
api/01-worker-site-today-v001.png
api/01-worker-site-today-v001-response.json
api/02-worker-report-v001.png
api/02-worker-report-v001-response.json
api/03-worker-calendar-v001.png
api/03-worker-calendar-v001-response.json
api/04-worker-report-detail-v001.png
api/04-worker-report-detail-v001-response.json
```

### 4.2 画布与视觉基线

- 生成画布：`896x1936`；交付设计稿：`853x1844`；预览：`390x844`。
- 参考图 1：`design-references/site-role-workbenches-20261117/01-worker-v001.png`（已批准的工人工作台）。
- 参考图 2：`design-references/owner-cloud-site-home-20261117/01-my-site-v001.png`（暖白手账外壳、书脊、纸页、底栏）。
- 视觉语言：纸底 `#F7F3E9`、纸页 `#FBF7ED`、墨绿 `#073C30`、主操作 `#00513C`、次文字 `#526C60`；左侧约 17px 深绿布面书脊；正文左起 x34，右留 18px；页面主标题 21–22px 宋体粗体；卡片标题 17–19px；正文 15–16px；辅助 12–13px；主操作热区至少 44px。
- 必须包含微信右上胶囊安全区和底部手势区；底栏固定在 y744–806 附近。
- 不出现小K入口；工人工作台不使用小K插画。
- 不画设备外壳、设计说明、营销入口或聊天输入条。

### 4.3 四张主稿内容

#### 01 · 工人「我的工地」首屏

- 状态栏 09:41；页标题「我的工地」；无返回键。
- 项目区：`春和苑`（31px 宋体粗体）、`水电施工`（16px）、右侧「换工地」小胶囊。
- 可选今日任务行（存在任务时）：`今日任务 · 厨房布线` + `进行中`。
- 今日汇总条：`今日上报 3` / `待审核 2` / `审核通过 1`。
- 现场上报：两枚 54px 深绿按钮，左「拍照」相机线框图标，右「说一句」麦克风线框图标。
- 筛选行：`今天`（选中深绿）、`昨天`、`近7天`、`日历`（带日历图标）。
- 列表标题：`上报记录` + `11月18日 · 3条`。
- 三条样例记录：
  1. `客厅线管铺设` · 15:10 · `水电施工` · 3张照片 · 琥珀色「待审核」。
  2. `厨房开槽` · 11:24 · `泥木施工` · 2张照片 · 绿色「审核通过」+ `张经理`。
  3. `次卧灯位确认` · 09:18 · `水电施工` · 1段语音 · 砖红色「需补充」。
- 列表底部次级行：`工地日报与周报` + 右箭头。
- 固定底栏：`工地`（选中，房屋图标）/ `我的`（账户图标）；暖白底、深绿选中。
- 空状态变体写进 README 状态表：`今天还没有上报` + 主按钮「现场上报」。

#### 02 · 独立「现场上报」页

- 自定义导航：返回箭头 + 标题「现场上报」；右上胶囊安全区。
- 项目上下文：`春和苑 · 水电施工`。
- 施工阶段：标题「施工阶段（可多选）」；从后台配置拉取的阶段 chips，例如 `前期` `设计` `拆改` `水电` `泥木` `油漆` `安装` `软装` `完工` `入住`；样例选中 `水电`、`泥木`。辅助文案：`可多选，按本次上报实际涉及的施工阶段选择`。
- 现场照片：标题「现场照片」+ `最多9张`；3 列照片墙；样例 4 张现场照片 + 1 个虚线「+」添加格；每张右上角删除标记。
- 语音说明（选填）：麦克风按钮 `点击录音`、`最长60秒`；已录状态显示 `00:12 回听 / 删除`。
- 文字说明（选填）：多行输入框，占位 `补充说明，例如：客厅东墙线管已铺完，等待验收`。
- 底部固定主按钮：`提交审核`；辅助文案：`提交后进入待审核，由施工经理、设计师或老板审核通过`。
- 页面可滚动，底部提交按钮固定并可点。

#### 03 · 日历筛选面板

- 背景为压暗的「我的工地」首屏；底部上滑面板。
- 标题「选择日期」+ 右上「重置」。
- 快捷项：`今天` `昨天` `近7天` `本月`。
- 月份头：`2026年11月` + 左右切换；星期行 `一 二 三 四 五 六 日`。
- 日期网格：今天 18 日描边，已选范围 1–18 日浅绿；未来日期置灰不可选。
- 底部主按钮：`查看这段时间的记录`；辅助文案：`最多可查近3个月`。

#### 04 · 上报详情面板

- 工作台内上滑面板，标题「上报详情」+ 关闭。
- 状态头：绿色「审核通过」；`审核人 张经理 · 11月18日 15:42`。
- 记录标题：`客厅线管铺设`；提交时间 `11月18日 15:10`。
- 阶段 chips：`水电施工`。
- 照片墙：3 列、最多 9 张的只读网格。
- 语音行（有语音时）：`语音 00:12` + 回听按钮。
- 整理内容：`本次完成` / `尚未完成` / `待沟通` / `补充说明` 四行，空行不显示。
- 底部次级操作：`查看工地日报与周报`（若有）。
- README 记录“需补充”状态变体：状态头砖红色「需补充」，显示退回原因，底部按钮「按退回要求补充」进入原有补交链路。

### 4.4 状态规格（写在 README）

| 状态 | 触发 | 可见反馈 | 可执行动作 |
| --- | --- | --- | --- |
| 无工地 | 工人没有被分配工地 | 纸页提示「暂时没有分配的工地」 | 重试、切换身份 |
| 加载中 | 进入工作台 | 「正在读取工地…」 | 无 |
| 读取失败 | 网络/接口失败 | 原位错误 + 「重新读取」 | 重试 |
| 今日为空 | 当天没有上报 | 「今天还没有上报」 | 「现场上报」 |
| 上报上传中 | 提交后 | 本地保留草稿、按钮 loading、队列状态 | 等待、失败重试 |
| 待审核 | `organizing` / `draft` | 琥珀色「待审核」 | 查看详情 |
| 审核通过 | `published` | 绿色「审核通过」+ 审核人/时间 | 查看详情 |
| 需补充 | `changes_requested` | 砖红色「需补充」+ 原因摘要 | 查看详情、按退回要求补充 |
| 已撤回 | `withdrawn` | 灰色「已撤回」 | 查看详情 |
| 无阶段配置 | 企业未配置阶段 | 提示联系管理员，禁用提交 | 返回 |
| 权限撤销 | 工地不可访问 | 返回可访问工地列表并提示 | 重新选择工地 |

### 4.5 生成与检查流程

1. 使用 `openai-api-image` 技能（官方 OpenAI Images API），先运行 `--status` 检查凭据。
2. 每张稿单独生成：`--prompt-file` 对应提示词、`--reference` 两张参考图、`--output-dir design-references/worker-site-saas-v1-20261118/api`、`--name 01-worker-site-today-v001`、`--size 896x1936`、`--quality medium`。
3. 生成后人工查看：中文文案是否准确、胶囊/底栏是否完整、照片墙是否为 3 列、阶段 chips 是否可读、主操作是否在首屏。
4. 用 Python Pillow 等比缩放到 `853x1844` 和 `390x844`，不裁切、不拉伸；记录 SHA-256、尺寸、字节数、API 用量到 `image-checks.json`。
5. 不切片、不把合成稿直接当运行时图片；运行时照片使用授权原记录缩略图。

### 4.6 设计确认门禁

- 阶段 A 只产出设计稿、README、提示词和检查记录，不改产品代码、样式、接口、测试或运行时模块文档。
- 设计完成后通过 NotifyUser 提交四张稿；只有用户明确说「开始开发」「按此方案落地」等，才进入阶段 B。
- 用户要求调整时，在设计目录内出新版本（v002…），保留 v001 供对照，不提前写实现。

---

## 5. 阶段 B：开发实现（设计确认后）

### 5.1 数据库迁移

新增 `admin/drizzle/0138_construction_worker_reports.sql`：

- `app.construction_site_records` 增加：
  - `stage_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb`，保存本次上报选择的阶段快照 `[{ "key": "utilities", "name": "水电" }]`。
  - `CHECK (jsonb_typeof(stage_snapshot) = 'array')`。
- 把 `app.construction_site_attachments` 的 `position` 约束从 `0..3` 改为 `0..8`（最多 9 张）：
  - `ALTER TABLE app.construction_site_attachments DROP CONSTRAINT construction_site_attachments_position_check;`
  - 重新添加命名约束 `construction_site_attachments_position_check CHECK(position BETWEEN 0 AND 8)`。
- 新增索引：`construction_site_records_author_history (enterprise_id, project_id, author_id, id DESC)`。
- 更新 `admin/scripts/construction-migration-check.mjs`：把 `0138_construction_worker_reports` 加入迁移哈希检查，并验证 `stage_snapshot` 列与 `position` 约束存在。
- 本地开发/隔离测试库执行 `cd admin && npm run db:migrate`；不做生产部署。

### 5.2 后端：上报采集与阶段快照

- [site-chat.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/site-chat.ts#L217-L308)：
  - `send()` 的 `object(body, [...])` 增加 `stageKeys`。
  - `mediaIds` 上限从 4 改为 9。
  - `stageKeys` 必须是唯一字符串数组、最多 10 个；不合法返回 `invalid_construction` 422。
  - 把 `stageKeys` 透传给 `saveSiteCapture()`。
- [site-capture.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/site-capture.ts)：
  - 新增 `stageSelection(raw, stages)`：校验阶段 key 都属于当前企业 `readStageSettings` 返回的阶段，生成 `[{key,name}]` 快照。
  - 插入记录时写入 `stage_snapshot`。
  - 记录版本快照包含 `stages`。
  - 补交 `resubmit` 时复制父记录的 `stage_snapshot` 到新记录。
- [site-worker.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/site-worker.ts)：
  - 保持全部 9 张照片作为人工审核原件；送入小K整理的图片最多取前 4 张，避免模型图片输入过大。
  - `photoCount` 仍为真实总数，提示文案不声称模型看过全部照片。
- `site-chat.ts` 的 `recordVersion()` 快照加入 `stageSnapshot`。

### 5.3 后端：工人历史与今日汇总

新增 [workbench-reports.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/workbench-reports.ts)：

- `parseReportRange(from, to)`：
  - 校验 `YYYY-MM-DD`、`from <= to`、跨度不超过 92 天；
  - 缺省为上海时区今天；
  - 返回 `{ from, to }`。
- `workerReportHistory(tx, actor, projectId, range)`：
  - 只查 `author_id = actor.adminId`、`project_id = projectId`；
  - 按源消息时间 `(m.created_at at time zone 'Asia/Shanghai')::date between from and to` 过滤；
  - 返回最多 100 条，按时间倒序；
  - 字段：`recordId`、`clientMessageId`、`title`、`at`、`status`、`statusLabel`、`stages`、`photoCount`、`photoId`、`hasVoice`、`approvedByName`、`approvedAt`、`returnedByName`、`returnedAt`、`returnReason`；
  - 状态映射：`organizing/draft → pending/待审核`，`published → approved/审核通过`，`changes_requested → returned/需补充`，`withdrawn → withdrawn/已撤回`；
  - `title` 为空时按 `photoCount` / `hasVoice` 回退为「现场照片 · N张」或「语音上报」。
- `workerTodaySummary(tx, actor, projectId)`：始终按上海时区今天统计 `total/pending/approved/returned`。
- `latestPendingReport(tx, eid, projectIds?)`：给经理/设计师/老板工作台返回最近一条待审核记录（含项目名、作者、照片数、语音标记）。

修改 [workbench.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/workbench.ts)：

- `constructionWorkbench(actor, staffRole, selection, range)` 增加 `range` 参数。
- 工人视图返回：
  - `stages: [{ key, name }]`（来自 `readStageSettings`）；
  - `reports: { from, to, summary, items }`；
  - `todaySummary`。
- 项目经理/设计师视图增加 `review: latestPendingReport(...)`。
- 老板视图增加 `review: latestPendingReport(...)`，卡片带 `projectName`。
- 保留现有 `receipt` 兼容字段，但新 UI 不再使用它。

修改 [workbench/route.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/app/api/miniprogram/construction/workbench/route.ts)：

- 查询参数允许 `projectId`、`from`、`to`；
- `from/to` 必须与 `projectId` 同时出现，否则 422；
- 其他参数继续拒绝。

### 5.4 后端：审核权限

修改 [site-chat.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/construction/site-chat.ts)：

- 在 `scope()` 的 `permission` 中新增：
  - `reviewRecords`：`owner || manager || member.role === 'designer'`；
  - `canPublishCustomer`：`owner || manager`（设计师不能对客公开）；
  - `write` 对 owner 开放，保证老板可以进入审核。
- `mutate()`：
  - `publish` / `request_changes` 使用 `reviewRecords` 授权；
  - `edit` / `resubmit` / `withdraw` 仍保持作者或经理边界；
  - 设计师 `publish` 只允许 `audience='internal'`；经理/老板可选 `customer`；
  - `request_changes` 允许经理/设计师/老板，继续要求 1–1000 字退回原因。
- `read()` 返回的 `canPublish`、`canRequestChanges`、`canPublishCustomer` 按新权限计算。
- 记录发布后仍写 `approved_by` / `published_at`；工作台状态显示为「审核通过」。
- 不新增数据库状态；复用 `draft → published` 和 `changes_requested`。

### 5.5 小程序：导航与双 Tab

- [custom-tab-bar/index.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/custom-tab-bar/index.js)：
  - 新增 `workerTabs()`：`工地`（`staffView: 'workbench'`，`pagePath: '/pages/index/index'`）+ `我的`。
  - `construction_staff` 使用 `workerTabs()`；`designer`、`enterprise_admin` 继续使用 `workbenchTabs()`。
  - 图标复用 `custom-tab-bar/assets/notebook-home*.png`、`notebook-mine*.png`。
- [pages/index/index.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/pages/index/index.js)：
  - 当 `roleForIdentity` 为 `construction_staff` 时，强制 `siteWorkbenchTab = 'workbench'`，忽略上一次的 `xiaok`。
- [pages/index/index.wxml](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/pages/index/index.wxml)：
  - 新增 `construction_staff` 独立分支，只渲染 `<site-workbench role="construction_staff" />`，不渲染 `xiaok-chat`。
  - 设计师/老板分支保持现状。
- `pages/mine/mine` 不改内容。

### 5.6 小程序：工作台首页

修改 [workbench.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/construction/workbench/workbench.js) / [workbench.wxml](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/construction/workbench/workbench.wxml) / [workbench.less](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/construction/workbench/workbench.less)：

- 工人视图按设计稿重排：
  - 项目/阶段/换工地；
  - 可选今日任务行；
  - 今日汇总条；
  - 拍照 / 说一句；
  - 今天 / 昨天 / 近7天 / 日历；
  - 上报记录列表；
  - 工地日报与周报次级入口。
- 新增数据：
  - `reports`、`todaySummary`、`reportRange`（`key/from/to/label`）、`reportLoading`、`reportError`；
  - `calendar`（当前月、日期格、起止选择）、`showCalendar`；
  - `detail`（记录详情）、`detailMedia`、`showDetail`；
  - `stages`（上报页复用）。
- `load()` 带 `projectId/from/to` 请求工作台接口；切换工地/筛选时重新读取。
- `capture()` 改为导航到 `/packages/construction/report/report?projectId=…&mode=photo|voice`，不再进入聊天页、不再发 `workbenchCapture` 事件。
- `openRecord()` 打开详情面板：
  - 调 `GET /miniprogram/construction/projects/:id/chat?recordId=…&limit=1` 读取原记录；
  - 下载最多 9 张照片到临时路径，详情关闭时清理；
  - 语音通过 `GET …/chat/speech/:id` 下载后播放；
  - 显示状态、审核人/时间、退回原因、阶段快照、整理内容。
- 日历：
  - 原生 WXML 月历，无第三方组件；
  - 上/下月切换、起止日期选择、今天高亮、未来日期禁用；
  - 最大 92 天，超过时提示；
  - 快捷项：今天/昨天/近7天/本月。
- 经理/设计师/老板视图：
  - 经理「待核对发布」改为「待审核上报」，按钮「审核上报」；
  - 设计师新增 `review` 卡（复用 `manager-draft` 样式）；
  - 老板新增 `review` 行（复用 `boss-links` / `manager-draft` 样式）；
  - 点击统一进入 `packages/construction/chat/chat?projectId=…&recordId=…&mode=review`。

### 5.7 小程序：独立上报页

新增 `miniprogram/packages/construction/report/report.{js,json,less,wxml}`，并在 [app.json](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/app.json) 的 `packages/construction` 子包注册 `"report/report"`。

页面结构：

- 自定义导航 `返回 + 现场上报`，胶囊安全区。
- 项目上下文 `项目名 · 当前阶段`。
- 阶段多选 chips：从 `GET /miniprogram/construction/workbench?projectId=` 的 `stages` 获取；至少选 1 个。
- 照片墙：
  - 3 列，最多 9 张；
  - 添加格支持拍照/相册（`wx.chooseMedia`，`count = 9 - 当前数量`）；
  - 点击预览、右上删除。
- 语音：
  - `wx.getRecorderManager`，wav、16k、单声道、最长 60 秒；
  - 录制中显示计时和波形条；录完可回听、删除；
  - `mode=voice` 进入时尝试自动开始录音，失败则显示手动「开始录音」。
- 文字：最多 4000 字。
- 底部固定「提交审核」。
- 本地草稿：按 `身份 + 工地` 保存文字、照片临时路径、语音、阶段选择；提交成功后清理。

复用现有上报协议（不复制上传/幂等逻辑）：

- [site-capture.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/construction/chat/site-capture.js)：
  - `emptyDraft()` 增加 `stageKeys: []`；
  - `addFile` 照片上限从 4 改为 9；
  - 构造函数支持 `requireStages`（上报页为 true，聊天页为 false）；
  - `submit()` 校验阶段必选；
  - `flush()` 的 `body` 增加 `stageKeys`。
- [site-client.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/construction/chat/site-client.js)：
  - 导出已有的 `upload` 为 `uploadSiteMedia`，供上报页复用。
- 上报页构造一个轻量 `site` 适配器（`base/projectId/storage/request/uploadFile/load/state`），复用 `SiteCapture` 的本地草稿、队列、幂等 key 和失败重试；不挂载整个聊天页。
- `load()` 调用新的工作台上报列表接口刷新今日记录，映射 `clientMessageId` 供 `SiteCapture.accepted()` 清理队列。
- 提交成功后：`wx.showToast('已提交，等待审核')`，延迟返回工作台；工作台 `pageLifetimes.show()` 自动刷新今日列表。
- 上传未完成时不返回，页面显示「正在上传」和失败重试。

### 5.8 小程序：日历筛选与详情

- 日历与详情均在工作台组件内实现，不新增路由。
- 详情面板内容全部来自已授权接口；不展示工地交流的其他消息。
- 详情面板关闭时清理照片临时文件和音频实例。
- 记录列表项点击使用 `openRecord`，不导航到聊天页。

### 5.9 小程序：审核入口

- 经理/设计师/老板工作台各增加一条「待审核上报」入口，复用现有 `manager-draft` 纸页/行走廊样式。
- 点击进入现有工地交流的审核页（`mode=review`），保留现有发布范围、版本冲突、照片可用性和权限校验。
- 审核通过后：
  - `status='published'`；
  - 工人工作台列表状态变为「审核通过」，显示审核人和时间；
  - 对客公开仍仅经理/老板可选。
- 退回：
  - `status='changes_requested'`；
  - 工人详情显示退回原因和「按退回要求补充」；
  - 补充继续使用现有 `records/:id/resubmit` 聊天链路（本次不复制补交流程）。

### 5.10 文档与台账

- `docs/miniprogram-system-modules.md` + `.zh-CN.md`：
  - 更新「XiaoK construction workbenches」：工人双 Tab、独立上报页、9 张照片、阶段多选、历史筛选、状态映射、审核角色。
- `docs/admin-system-modules.md` + `.zh-CN.md`：
  - 更新施工记录/小程序工作台 API 的字段、权限和迁移说明。
- `docs/xiaok-assistant-phase-2.md` + `.zh-CN.md`：
  - 更新现场上报合同：`stageKeys`、`stage_snapshot`、9 张照片、AI 最多读取 4 张。
- `docs/miniprogram-design-restoration-ledger.md` + `.zh-CN.md`：
  - 替换 `pages/index/index` 行的最新设计源为 `design-references/worker-site-saas-v1-20261118/README.md`；
  - 新增 `packages/construction/report/report` 行；
  - 记录 390x844 native QA 状态和未验证项。
- 不新增平行设计文档；所有设计说明放在新设计目录 README。

---

## 6. 关键实现细节与约束

1. **照片数量**：前后端统一最多 9 张；补交流程仍保持 1–4 张（现有规则不变）。
2. **阶段快照**：保存 key + 名称快照，避免后台改阶段名后历史记录显示错乱；上报页提交前校验阶段 key 属于当前企业配置。
3. **状态复用**：不新增 `pending_review` / `approved` 状态，避免破坏现有发布、对客可见性和审计；只在工人 UI 映射为「待审核 / 审核通过」。
4. **审核权限**：设计师只能内部审核通过，不能对客公开；经理/老板可内部或对客公开。任何审核都保留 `approved_by` / `published_at` / 版本审计。
5. **历史范围**：只查当前工地 + 当前登录员工本人，服务端强制 `author_id`，不能靠前端过滤。
6. **日期时区**：所有“今天/昨天/近7天”按 `Asia/Shanghai` 计算，避免服务器 UTC 跨日。
7. **弱网**：上报页复用 `SiteCapture` 的本地草稿和幂等队列；提交结果未知时保留内容并允许同 key 核对。
8. **安全**：上报页进入时重新读取工作台接口，校验 `canCapture` 和工地权限；撤权后不展示旧工地数据。
9. **性能**：历史列表最多 100 条，不内嵌照片；详情按需下载最多 9 张照片和 1 段语音。
10. **设计稿**：所有运行时照片来自授权原记录；设计稿中的照片只是示意，不打包进小程序。

---

## 7. 测试与验收

### 7.1 设计阶段

- 四张 853x1844 / 390x844 图稿尺寸正确，中文文案与规格一致。
- 390x844 目视核对：胶囊安全区、底栏、照片墙 3 列、阶段 chips、主操作可见。
- `image-checks.json` 记录 SHA-256、尺寸、字节数、API 用量。
- 用户确认设计后才进入开发。

### 7.2 小程序测试

- 更新 `miniprogram/test/custom-tab-bar-session.test.js`：
  - `construction_staff` 只有 `工地/我的`，没有 `xiaok`；
  - `designer` / `enterprise_admin` 仍为三项。
- 更新 `miniprogram/test/site-role-workbench.test.js`：
  - 拍照/说一句导航到 `report/report`；
  - 切换工地、筛选、详情、旧缩略图清理；
  - 不再出现聊天 `workbenchCapture` 事件。
- 更新 `miniprogram/test/construction-site-capture.test.js`：
  - 9 张照片上限；
  - 阶段必选校验；
  - `stageKeys` 进入提交 body。
- 新增 `miniprogram/test/worker-report-page.test.js`（静态/模型测试）：
  - 阶段 chips 来源、至少选 1 个、提交 body、成功后返回。
- 运行 `cd miniprogram && npm test`。

### 7.3 后端测试

- 新增 `admin/src/lib/construction/__tests__/workbench-reports.test.ts`：
  - 日期解析、跨度限制、状态映射、标题回退。
- 扩展 `admin/src/db/__tests__/construction-site-chat.test.ts`：
  - 设计师可内部审核、不能对客公开；
  - 老板可审核（含协作企业）；
  - 工人不能审核；
  - 退回要求必填；
  - 历史只返回本人、当前工地、日期范围。
- 运行 `cd admin && npm run lint`。
- 运行聚焦测试：
  - `npx tsx --test src/lib/construction/__tests__/workbench-reports.test.ts`
  - `npx tsx --test src/db/__tests__/construction-site-chat.test.ts`（需要隔离 PostgreSQL `55432`；不可用时明确记录未验证）
- 运行 `cd admin && npm run check:construction`（本地数据库可用时）。

### 7.4 小程序运行态验收

使用 Stable `2.02.2608080`、基础库 `3.17.2`、逻辑视口 `390x844`，副屏窗口，按仓库既有 DevTools 规则执行：

1. 工人账号进入首页：只有「工地 / 我的」，无小K。
2. 工地工作台：切换工地、今日汇总、今天/昨天/近7天/日历筛选。
3. 现场上报：照片墙最多 9 张、阶段多选、语音、文字、提交。
4. 提交后列表出现「待审核」；详情显示原照片/语音/阶段。
5. 经理/设计师/老板账号：看到待审核入口，审核通过后工人状态变「审核通过」；退回后显示「需补充」和原因。
6. 撤权/换账号：旧工地数据清空，返回可访问列表。
7. 记录 390x844 截图、路由、请求和未验证项（真机、实际微信登录、BLE 等）。

---

## 8. 不在本次范围

- 管理后台网页新增审核页面或审核队列。
- 新增数据库状态 `pending_review` / `approved`；本次复用现有 `organizing/draft/published/changes_requested/withdrawn`。
- 重做设计师/老板完整工作台视觉；只增加待审核入口，复用现有卡片和聊天审核页。
- 在独立上报页内重做退回补交流程；补交继续走现有聊天记录补交。
- 生产部署、真机验收、微信审核相关改动。
- 小K Agent 的知识、模型或报告生成逻辑改动。

---

## 9. 假设与决策记录

- 工人端 = `construction_staff` 角色；仅该角色改为双 Tab，设计师和老板保持「小K / 工作台 / 我的」。
- 历史记录只显示当前所选工地、当前登录员工本人的上报。
- “审核通过”复用现有 `publish` 动作和 `published` 状态；对客公开与内部审核通过分开控制。
- 上报页阶段选择为必填（至少 1 个）；聊天页旧上报不强制阶段，保持兼容。
- 照片最多 9 张；AI 整理最多读取前 4 张，人工审核可看全部。
- 设计源以 `design-references/worker-site-saas-v1-20261118/` 为准；运行时照片不切片、不打包设计稿。
- 本次只做本地开发与测试，不做生产发布。
