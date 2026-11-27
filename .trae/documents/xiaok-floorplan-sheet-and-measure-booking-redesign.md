# 户型档案弹层重设计 + 聊天内预约量房卡计划

## 1. 目标与范围

本次解决三个问题：

1. **重新设计图1/图2的「查看户型档案」弹层**：现在是把接口返回的一整段纯文本塞进弹层，没有项目身份、没有户型图、房间/墙边/门窗混在一起，读完不知道重点。改为「户型图 + 分房间卡片」。
2. **去掉「打开完整服务档案」**：它跳到图3的老服务档案页（`packages/business/customer-project/customer-project`）。弹层里只保留「打开户型图」（全屏预览正式户型图），不再从聊天进入老页面。
3. **聊天里的「预约量房」不再转接设计师**：客户点「预约量房」后，当前走 `bookMeasure → openHandoff`，把会话转给设计师。改成聊天内预约卡：选日期/时段 → 填上门地址 → 提交确认；没有服务档案时按用户确认的方案**自动创建服务档案（lead）**再预约。

已确认的决策：

- 老预约量房工作流**先保留**，不做代码级下线；本次只修正聊天入口。
- 户型档案弹层采用「户型图 + 分房间卡片」，不并入 AI 设计图档案。
- 无服务档案的客户：用微信登录资料自动创建一条服务档案后预约。

流程上先出设计图，用户确认后再改代码（仓库 `AGENTS.md` 的 Mandatory Design Approval Gate 要求）。

---

## 2. 现状与问题

### 2.1 户型档案弹层

- 弹层在 [chat.wxml](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/assistant/chat/chat.wxml#L161) 的 `sheet === 'floorplan'` 分支：`contextDetail` 时只渲染 `source-title` + `source-quote`（`white-space: pre-wrap` 的一整段文本）。
- 文本由 [formal-floorplan-context.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/agent/formal-floorplan-context.ts#L8-L41) 的 `formalFloorplanText()` 生成，按「楼层 / 房间：图内墙边记录…」逐行拼接，所有房间共用一个字号层级。
- 弹层详情由 [floorplan-context.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/media/floorplan-context.ts#L61-L70) 的 `detail()` 返回，只有 `{ leadId, floorPlanId, layoutHash, name, text }`，没有结构化房间，也没有户型图地址。
- 客户端 [assistant-floorplan-context.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/utils/assistant-floorplan-context.js#L64-L78) 只校验 `text` 字段。
- 「打开完整服务档案」在 [chat-definition.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/assistant/chat/chat-definition.js#L450-L453) `openFullArchive()`，导航到老服务档案页。
- 正式户型图已有受保护预览接口 [preview/route.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/app/api/miniprogram/customer-projects/[leadId]/formal-floor-plan/preview/route.ts#L11-L44)，返回 PNG；小程序侧已有 [protectedImageCache.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/utils/protectedImageCache.js#L115-L126) 的 `fetchProtectedImage()`。

### 2.2 聊天量房卡

- 卡片在 [chat.wxml](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/assistant/chat/chat.wxml#L136-L149)，主按钮「预约量房」绑定 `bookMeasure()`。
- `bookMeasure()` 在 [chat-definition.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/assistant/chat/chat-definition.js#L666-L674)：关闭卡片后调用 `openHandoff()`，把会话转人工（设计师接待）。
- 现有预约能力已经存在：
  - 页面 [appointment-booking.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/enterprise/appointment-booking/appointment-booking.js#L112-L203)：读 `/appointments/availability`，提交 `POST /appointments`。
  - 接口 [availability/route.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/app/api/appointments/availability/route.ts#L42-L65) 与 [appointments/route.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/app/api/appointments/route.ts#L167-L226) 已支持客户本人（`context.mode === 'customer'`），但都必须带 `leadId`。
  - 创建预约要求 lead 已完成设计师派单： [appointment-repository.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/db/repositories/appointment-repository.ts#L410-L443) 会拒绝 `assignment_pending` 或无 `assignedTo` 的线索。
- 聊天会话本身不返回 `leadId`（[conversation.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/core/conversation.ts#L86-L95) 的 `conversationDto`），所以需要新的会话级接口来解析/创建服务档案。

---

## 3. 设计稿交付（先做，确认后再实施）

### 3.1 交付物

新建目录 `design-references/xiaok-floorplan-booking-redesign-v1/`，包含：

| 文件 | 内容 |
| --- | --- |
| `01-floorplan-list.png` | 户型档案列表弹层（390×844） |
| `02-floorplan-detail.png` | 户型档案详情弹层：户型图 + 分房间卡片 + 底部操作 |
| `03-measure-card.png` | 聊天内预约量房卡（未预约 / 已预约两态同屏或上下排列） |
| `04-measure-booking-sheet.png` | 预约弹层：日期、时段、地址、确认 |
| `README.md` | 目标、信息顺序、元素/字号台账、状态表、与现有设计源的关系 |
| `interaction-preview.html` | 可点击预览：列表 → 详情 → 打开户型图 → 量房卡 → 预约弹层 → 成功态 |

设计稿按 `390x844` 逻辑视口出图，包含微信原生胶囊安全区；样式沿用现有小K手账语言：暖白纸 `#FBF7ED`、深绿 `#0B513B`、薄荷 `#E7F4EC`、宋体标题 + 无衬线正文。字号遵守 [DESIGN.md](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/DESIGN.md#L59-L69) 的地板：页面标题 32rpx、卡片标题 28rpx、正文/操作 24rpx、辅助 22rpx。

设计方法：按 `draw-ui` 技能先构建 HTML/CSS 高保真稿，再在 390×844 下截图产出 PNG；不使用 AI 生图伪造界面，不切割组合稿。若需要新的独立插画，按用户规则用 `openai-api-image` 生成透明 PNG，单张 ≤300KB。

### 3.2 户型档案列表（01）

信息顺序：

1. 导航行：标题「户型档案」+ 关闭（44×44）。
2. 辅助说明：「仅使用你在当前企业有权查看的档案。查看不会更改选择，也不会发送消息。」
3. 档案卡（可多条）：
   - 左：户型图缩略图 120×120rpx（受保护预览，加载/失败态）；
   - 中：档案名（32rpx 宋体）+「6 个空间 · 正式户型」（22rpx）；
   - 右：已选用「已选用」布签 +「查看」44rpx 高操作。
4. 「不结合户型档案」作为列表底部的独立轻量行，带当前选中态。
5. 空态：「暂无可用的已完成正式户型」+ 说明。

### 3.3 户型档案详情（02）

信息顺序：

1. 导航行：标题「户型档案」+ 关闭。
2. 「返回档案列表」文字操作（仅列表进入时显示）。
3. 项目身份块：档案名（32rpx，最多两行）+ 元信息 chips：「正式 v4」「88㎡」「6 个空间」「更新于 11月18日」。
4. 户型图卡：整宽 4:3 纸面卡，户型图 `mode="widthFix"`；右上角「查看大图」chip；加载骨架、失败态「户型图暂不可读」+ 重试。
5. 房间卡片（最多 6 个，纵向）：
   - 标题行：房间名（28rpx）+ 楼层/层高 chip（如「一层 · 层高 2800」）；
   - 墙边行：`墙边` 标签 + 长度 chips（`4000`、`3000`…，单位毫米，最多 12 个）；
   - 门窗行：`门`/`窗` 标签 + 尺寸文案（宽/高/窗台高，缺失项不补 0）；
   - 该房间无记录时显示「本次图内未提供可读尺寸」。
6. 「其余房间未在本次展开」等截断提示（有则显示）。
7. 说明卡：图内记录 ≠ 净尺寸/柜体/点位，照片与墙边未建立对应，不证明现场复核与隐蔽工程。
8. 底部固定操作条：`打开户型图`（描边次按钮，44px 高）+ `使用此档案`（深绿主按钮）。

### 3.4 预约量房卡（03）

聊天内卡片保持现有纸面/胶带语言：

- 标题「预约上门量房」+ 关闭。
- 三行：
  - 上门测量 · 现场顾问带测距仪上门；
  - 自选时间 · 选你方便的时段；
  - 地址保密 · 仅用于本次上门。
- 主按钮「选择上门时间」；次按钮「暂不预约」。
- 已预约态：状态布签「已预约」+「11月20日 14:00 · 现场顾问待确认」+「查看预约」；不再显示「改约」，改约走预约详情页。

### 3.5 预约弹层（04）

- 导航行：「预约上门量房」+ 关闭。
- 服务档案行：项目名；多个项目时改为可选行。
- 联系方式行：脱敏手机号（只读）。
- 日期横滑：今日/明天/周X + M/D（按接口 `maxAdvanceDays`）。
- 时段网格：2 列，44px 高；选中深绿；空态「当天暂无可用时段，请选择其他日期」。
- 上门地址：输入框 +「地图选择」；选中地图后回填地址。
- 底部确认条：「确认预约 11月20日 14:00」，未选时段/地址时禁用；提交中显示 loading。
- 成功：弹层关闭，聊天卡切换为已预约态；失败按错误码给出原位提示（时不段被占、已有预约、暂无现场顾问等）。

### 3.6 设计确认门

设计稿完成后调用 `NotifyUser`，等待用户明确确认（“按此方案落地/开始开发”）。确认前不修改产品代码、接口、测试或模块文档。

---

## 4. 实施变更（设计确认后）

### 4.1 后端：户型档案结构化详情

**文件**：[formal-floorplan-context.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/agent/formal-floorplan-context.ts)、[floorplan-context.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/media/floorplan-context.ts)

1. 新增 `formalFloorplanRooms(name, value)`（同文件导出）：
   - 复用现有 `parseFormalSurveyLayout` / `adaptSurveyGraphToRooms` 的筛选口径；
   - 返回 `{ rooms: [{ id, name, floorName, ceilingHeightMm, walls: [{ id, lengthMm }], openings: [{ id, type, widthMm, heightMm, sillHeightMm }] }], totalRooms, truncated }`；
   - 上限与文本一致：房间 6、每房墙边 12、门窗 6；缺失值保持 `null`，不用 0 或渲染默认值补齐。
   - `formalFloorplanText()` 改为消费同一结构化结果再拼文本，避免两套口径漂移。
2. `FloorplanContextService.detail()` 返回值增加：
   - `rooms`（上面的结构）；
   - `totalRooms`、`truncated`；
   - `previewEndpoint: '/miniprogram/customer-projects/' + leadId + '/formal-floor-plan/preview'`；
   - `updatedAt`（有则返回，用于元信息）。
3. `read()` 的 `items` 也带 `previewEndpoint`，供列表缩略图使用；`validPlan` 仍只校验既有必需字段，不破坏兼容。

### 4.2 后端：会话级预约接口

新增 `admin/src/lib/assistant/booking/appointment.ts`，类 `AssistantMeasureBookingService`：

- `read()`：在会话 enterprise 范围内查询本人有效服务档案：
  `select id,name,community_name from app.leads where enterprise_id=? and customer_user_id=? and archived_at is null and status not in ('closed','converted') order by id desc limit 20`
  返回 `{ projects, leadId, appointment, maxAdvanceDays, durationMinutes, timezone, phoneMasked }`；
  已有有效预约时返回 `appointment`（`appointmentToDto`）。
- `availability(date, leadId?)`：解析 lead（0 条时返回空时段），复用 `AppointmentRepository.listAvailability`。
- `book({ leadId?, startAt, endAt, address, location? })`：
  1. 选定 lead：显式 `leadId` 必须是本人的有效档案；只有 1 条时自动使用；0 条时调用新增的 `ReferralLeadRepository.createCustomerBookingLead()` 自动建档案；多条且未指定时返回 `appointment_lead_required`。
  2. 在同一事务内调用 `AppointmentRepository.create({ enterpriseId, leadId, startAt, endAt, address, location, actorUserId, eventKey })`。
  3. 成功后复用 `notifyAppointmentStaff` + `notifyCustomerOfAppointment`，返回 `{ leadId, appointment }`。
  4. 使用 `idempotent(repo.tx, actor, 'appointment:' + conversationId, requestKey, body, ...)`，网络未知结果可按原键重试。

新增仓库方法 `admin/src/db/repositories/referral-lead-repository.ts` → `createCustomerBookingLead({ enterpriseId, customerUserId, actorUserId, name, phone })`：

- `normalizeCustomerPhone`；按企业+手机号查已有未关闭线索：
  - 同客户的线索直接复用；
  - 同手机号但 `customerUserId` 不同则返回 `lead_phone_conflict`，不合并；
  - 已归档则沿用现有归档错误。
- 新建时写入 `customerUserId`、`source: 'assistant_booking'`、`status: 'new'`、`assignmentStatus: 'assignment_pending'`、`attributionLockedAt`，并沿用 `findMeasurerCandidate` / `customerAttributionLocks` 规则。
- 预约必须可创建：调用 `AssignmentRacingRepository.autoAssignLead({ reason: 'assistant_booking' })` 立即派设计师（不论企业是否开启抢单）；若仍无设计师，抛出 `appointment_designer_unavailable`，客户端提示「暂无可用家装设计顾问，请稍后再试」。

路由：在 [http.ts](file:///g:/workspace/向总/Smart-Floor-Planner/admin/src/lib/assistant/application/http.ts#L49-L65) 增加：

- `GET /conversations/:id/measure-booking`
- `GET /conversations/:id/measure-booking/availability?date=YYYY-MM-DD&leadId=`
- `POST /conversations/:id/measure-booking`（body：`{ leadId?, startAt, endAt, address, location? }`）

权限与 `FloorplanContextService` 一致：`requireCapability(actor,'assistant.chat.self')`、`principal.kind === 'user'`、会话属于本人、未 `retentionRedacted`、企业范围取自会话。

### 4.3 前端：户型档案弹层

**文件**：[assistant-floorplan-context.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/utils/assistant-floorplan-context.js)、[chat.wxml](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/assistant/chat/chat.wxml)、[chat-definition.js](file:///g:/workspace/向总/Smart-Floor-Planner/miniprogram/packages/assistant/chat/chat-definition.js)、`notebook.less`（新增 `.floorplan-*` 样式）

1. `detail()` 校验并落地 `rooms/totalRooms/truncated/previewEndpoint/updatedAt`；`validDetail()` 只接受数组与安全数值。
2. `chat.wxml` 的 `sheet === 'floorplan'` 分支替换为新结构（列表/详情），删除 `source-quote` 纯文本区。
3. `chat-definition.js`：
   - 删除 `openFullArchive()` 与「打开完整服务档案」；
   - 新增 `previewFloorplan()`：`fetchProtectedImage(contextDetail.previewEndpoint, floorPlanCacheKey(leadId, { id: floorPlanId, updatedAt/layoutHash }))` 后 `wx.previewImage`；失败 toast「户型图暂时无法打开」；
   - 新增 `openMeasureBooking()` / `closeMeasureBooking()` / 日期/时段/地址选择与提交方法（见 4.4）；
   - 「使用此档案」沿用现有 `chooseFloorplan('detail')` 与 `contextBusy` 逻辑。
4. 列表缩略图复用 `fetchProtectedImage` + `readCachedProtectedImage`，按 `leadId` 缓存；加载失败显示占位纸面，不阻塞选择。
5. 样式全部走 `notebook.less` 的纸面变量与现有 44px 热区；字号不低于地板。

### 4.4 前端：聊天内预约量房

**新增** `miniprogram/packages/assistant/lib/measure-booking.js`：`MeasureBookingController`

- 构造参数：`client`（`AssistantClient`）、`identity`、`emit`；
- 状态：`measureBookingLoading/Error/Busy/Pending`、`measureProjects`、`measureLeadId`、`measureDates`、`measureDate`、`measureSlots`、`measureSlot`、`measureAddress`、`measureLocation`、`measureAppointment`、`measurePhoneMasked`；
- 方法：
  - `show(conversationId)`：GET `/conversations/:id/measure-booking`；有预约直接进入已预约态；无预约时准备最近 5 天日期；
  - `selectDate(date)`：GET `.../availability?date=&leadId=`；
  - `submit()`：`client.mutate('measure-booking:'+id, '/conversations/'+id+'/measure-booking', body)`，成功更新 `measureAppointment`，失败按 `errorCopy` 给出原位提示并保留已选时段/地址；
  - `reset()`/`dispose()`。
- 失败未知结果用同一个 `PendingOperations` 槽位重试，不重复建预约。

**chat-definition.js**：
- 初始化/刷新时创建 controller；`bookMeasure()` 改为打开 `sheet='measure'`（不再 `openHandoff`）；
- 卡片主按钮文案「选择上门时间」，已预约时显示「查看预约」→ `/packages/enterprise/appointment-detail/appointment-detail?mode=customer&leadId=…&appointmentId=…`；
- 关闭/切换会话时清理槽位与草稿；
- 保留 `request_designer`（AI 明确请求人工）原能力，但量房卡不再触发它。

**chat.wxml**：新增 `sheet === 'measure'` 弹层与卡片两态；「暂不预约」沿用 `dismissMeasure`。

**assistant-client.js**：补充错误文案：`appointment_lead_required`、`appointment_slot_unavailable`、`appointment_already_exists`、`appointment_no_measurer_available`、`appointment_designer_unavailable`、`appointment_phone_required`。

### 4.5 文档与台账

- `docs/miniprogram-system-modules.md` + `.zh-CN.md`：更新小K聊天户型档案弹层、预约量房卡、接口与状态；标注老服务档案页仍保留但聊天不再进入。
- `docs/miniprogram-design-restoration-ledger.md` + `.zh-CN.md`：`packages/assistant/chat/chat` 行替换为本次设计源（`design-references/xiaok-floorplan-booking-redesign-v1/README.md`），视觉核验状态写「待 390×844 原生胶囊截图」。
- `docs/admin-system-modules.md` + `.zh-CN.md`：登记 `measure-booking` 三条会话级接口、自动建档边界与权限。
- 若本次改动影响 `docs/xiaok-renovation-agent-development-plan.md` 第 2 节当前交付，只替换该节当前值，不追加历史；否则在交接说明写明「无计划影响」。

---

## 5. 假设与决策

| 项 | 决策 |
| --- | --- |
| 老服务档案页 | 保留页面与其它入口，仅移除聊天里的「打开完整服务档案」 |
| 老预约工作流 | 暂不下线路由/后端；只替换聊天入口的转人工行为 |
| AI 设计图档案 | 本次不并入弹层；仍走「我的 → 我的户型 → AI 设计」和已发布方案册 |
| 无服务档案 | 自动创建一条 `source='assistant_booking'` 的服务档案后预约；手机号取登录资料，缺失则提示先完善 |
| 多服务档案 | 预约弹层先让客户选项目；不猜默认项目 |
| 预约失败 | 事务回滚（含自动创建的档案），不留下半成品；按错误码原位提示 |
| 户型图 | 复用受保护预览接口，`wx.previewImage` 全屏；不做新图片生成 |
| 设计源 | 新设计稿替换聊天路由当前设计源；既有聊天稿的其它状态保留 |

---

## 6. 验证步骤

### 6.1 设计阶段

1. 打开 `interaction-preview.html` 逐屏检查 390×844、胶囊安全区、字号地板、纸面层级。
2. 对照图1/图2确认：不再出现整段纯文本；详情首屏能看到户型图与第一组房间卡；「打开完整服务档案」消失。
3. `NotifyUser` 等待确认。

### 6.2 代码阶段

1. `cd miniprogram && node --test test/assistant-floorplan-context.test.js test/assistant-measure-booking.test.js`
2. `cd miniprogram && npm test`（全量客户端静态/控制器测试，含字号地板检查）
3. `cd admin && npx tsx --test src/lib/assistant/__tests__/formal-floorplan-context.test.ts`，以及新增的 `measure-booking` 服务测试；`npm run lint`
4. 若改动涉及路由/权限边界，执行既有的 assistant 集成测试；自动建档需覆盖：同手机号复用、跨客户手机号冲突、已有预约、无可用时段、无可用设计师、幂等重试。
5. WeChat DevTools Stable 390×844：打开小K聊天 → 输入量房意图 → 卡片 → 选日期/时段/地址 → 提交 → 重进会话看到已预约；打开户型档案 → 列表 → 详情 → 打开户型图 → 使用此档案。截图含原生胶囊，路由与元素尺寸记入台账。
6. BLE 实体设备、真机与真实微信授权仍按仓库规则标注为未验证，不作为本次阻塞。

---

## 7. 不在本次范围

- 不删除 `packages/business/customer-project/customer-project`，不改它的预约区/服务小组/工地视频。
- 不改已发布方案册 `customer-ai-schemes` 的结构。
- 不新增 AI 设计图档案入口到户型弹层。
- 不改企业侧预约排期、派单、提成与通知规则。
- 不做生产发布或数据回填。
