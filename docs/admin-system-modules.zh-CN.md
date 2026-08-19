# 后台系统当前功能清单

本文只记录后台当前运行入口、合同、权限和限制。实现过程由 Git 提交保留，
不在清单中追加日期流水。

## 共用架构

- Next.js 16 App Router、React 19、Tailwind CSS 4、Ant Design 5 和 Ant Design Pro。
- 部署运行时使用 PostgreSQL 17、`drizzle-orm`/`pg`；租户读写通过 Repository、
  事务和 RLS 执行。
- 后台会话使用 cookie/JWT；平台和企业角色由路由守卫与菜单权限共同约束。
- 外部供应商和对象存储 I/O 在短数据库事务之外执行；API handler 通过 DTO 显式
  序列化 `bigint`。
- 正式户型为 v4 量房 wall graph。查看器、DXF、3D 和 AI 只消费读模型，不写旧布局字段。

## 状态定义

`Implemented` 表示存在真实页面/API/数据链路；`Limited` 表示受角色、供应商、
数据形状或运行条件限制；`Placeholder` 表示只有 UI 或 mock，尚无承诺的持久化/集成。

## 模块清单

预约服务地址补录属于预约服务事实：`POST /api/appointments/[id]/address` 由预约详情调用，已分配设计师或测量员可在已有预约上补充/修正地址；服务端使用预约版本和 `measurement_appointment_events` 的 `address_updated` 审计记录并发修改。`POST /api/appointments/[id]/complete` 还要求线索关联已完成的正式 v4 量房户型且至少存在一个闭合空间，否则返回 `appointment_survey_required`（409）。后台线索详情与小程序预约详情共用该入口。

| 模块 | 当前入口 | API/数据边界 | 权限/状态 | 当前限制 |
| --- | --- | --- | --- | --- |
| 登录与会话 | `/login`、`/register` | `/api/auth/*`；小程序 JWT 使用基础用户 `sub`、当前 `customer/staff/referrer` 上下文和 `contextVersion` | 公开入口与登录后路由；Implemented | 微信供应商配置依赖环境；旧身份字段在旧获客流程下线前并存 |
| 导航、角色与权限 | 共用侧栏、路由守卫 | `/api/permissions`、角色/菜单 Repository | `super_admin`、`admin`、企业角色；Implemented | 权限按租户和角色实时生效 |
| 平台与企业 | `/dashboard`、`/enterprises` | 企业、品牌、激活及平台 Repository | 平台角色；Implemented | 租户变更必须存在企业上下文 |
| 员工、账号与预约运营 | `/staff`、`/departments`、`/users`、`/referrer-network-operations`、`/join-codes`、`/referrers`、`/appointment-settings`、`/`（设计师/测量员首页工作台） | 员工、部门、共享通知、管理员与预约 Repository。商户侧栏「推荐网络」分组现包含 `/referrer-network-operations`、`/join-codes`、`/referrers` 与 `/appointment-settings`，全部复用 `referrer-network-operations` 权限。`/referrer-network-operations` 为就绪枢纽：数字摘要、可执行验收清单和最近 5 条双码审计预览；双码换新/停用/查看二维码与完整审计在 `/join-codes`。`/referrers` 列出推荐人姓名、手机号、加入时间、活动推广码和停用后续扫码，支持姓名/手机号搜索；后台不手工新建推荐人。预约设置页通过 `GET/PUT /api/appointment-settings` 读取和修改时区、每周开放时间、默认时长、时段步长、最远预约天数及客户改期截止；系统自动建立的默认记录会与管理员已确认策略明确区分。运营工作台经 `GET /api/enterprise/referrer-network-readiness` 读取双码审计、活动推荐人成员关系与已持久化的活动推广码数量、活动员工码数量、派单资格、已确认预约设置、提成规则及微信服务码配置；推广服务码就绪项不再仅根据成员关系推断码可用，并为每项验收项提供真实操作入口。`GET /api/enterprise/join-codes` 返回不含令牌的双码与审计事件；`GET /api/enterprise/referrer-memberships` 按租户列出成员并可按关键词/状态筛选；停用仍为 `POST /api/enterprise/referrer-memberships/[id]/disable`。后台首页按已认证 Cookie 角色渲染设计师/测量员工作台，`GET /api/workbench/staff` 在租户事务中只返回本人线索、预约、无预约待量房任务和量房交接；测量员正式 BLE 量房仍只从小程序正式编辑器完成。写入审计的图片接口生成私有、禁止缓存的入驻图片并保留微信返回的 PNG/JPEG 类型。企业入驻码和推荐推广码均使用 `getwxacodeunlimit` 与 `env_version: develop`，即使服务端以生产模式运行也保持开发版 | `referrer-network-operations`、`/join-codes`、`/referrers`、`/appointment-settings` 及对应 API 复用 `referrer-network-operations` 权限，员工首页与 `GET /api/workbench/staff` 限当前租户内活动的 `designer`/`measurer` 会话；企业负责人继续使用企业经营工作台；Implemented/Limited | 员工工作台只提供任务聚合和既有后台入口，不创建测试业务数据、不绕过小程序手机号授权，也不提供后台 BLE/H5 编辑器。外部微信凭据只诊断、不在本页配置。认证后台视觉核验待本次角色登录态补充 |
| 报备与协作 | `/promotions`、企业协作页 | 报备、推荐和共享通知 Repository | 企业和员工边界；Implemented | 企业微信投递为可选外部能力 |
| 套餐、订单与提成 | `/packages`、`/orders`、`/commissions`、`/lead-commissions` | 套餐、订单、既有提成及 `LeadCommissionRepository`；`GET/PUT /api/commission-rules`、可筛选的 `GET /api/lead-commissions`（含 `source=referrer_network|staff_activity`）、`POST /api/lead-commissions/mark-paid`。工作台维护三条规则，可按线索来源筛选，并在报表逐条展示客户、推荐人关系（活动线索为空）、企业、设计师、测量员和当前有效预约 | `lead-commissions` 仅 `super_admin`、`admin`、`enterprise_admin` 可用；系统管理员即使使用旧的已存菜单快照也始终展示该受保护入口；规则修改和线下批量标记已支付均使用 RLS 与租户事务；Implemented/Limited | 旧获客提成路由已下线。支付不在本系统内完成 |
| 线索与转化 | `/leads`、`/leads/[id]` | 线索生命周期、户型、`ReferralLeadRepository`、`CustomerProjectRepository` 与 `LeadCommissionRepository`；列表/详情 DTO 包含已分配测量员、派生 `serviceStage`/`nextAction`/`canRebook`、最近一条预约事实，以及由 `referrerMembershipId -> referrerEnterpriseMemberships -> referrerProfiles` 解析出的推广人（使用资料展示名/电话，不依赖无租户基础用户行）。`/api/appointments` 与 `/api/appointments/availability` 支持授权的后台 Cookie 设计师/企业负责人创建、读取可用时段和后台改期线索预约；`POST /api/appointments/[id]/cancel` 与 `/complete` 现已接受与小程序一致的后台 Cookie 角色边界，线索详情抽屉提供取消、完成、重新预约及改期/补地址操作，过期行完成规则与 Slice 2 一致。`GET/POST /api/leads/[id]/ai-publications` 与 `DELETE /api/leads/[id]/ai-publications/[generationId]` 接受后台 Cookie；详情抽屉列出可发布 generation 并支持负责设计师/企业负责人发布或撤回。后台预约审计通过 `admin_users.user_id` 映射到 `users.id`；`/leads/[id]` 通过查询参数打开共享线索详情抽屉 | 客户授权或租户/责任人校验；负责设计师仅管理自己线索的已成功 generation，并只能为本人线索创建、改期或取消预约；已派测量员可完成本人预约；企业负责人可管理本企业；撤销签单仅企业管理员且已支付提成会阻止撤销；Implemented/Limited | 客户项目已展示受保护聚合中的真实服务事实、完成正式户型摘要及主动发布方案；后台 ProTable 保留筛选/分页，并将每条线索渲染为响应式 ProCard，分组展示客户、派单、推广人、预约和操作；卡片与小程序共用服务端日期/时段选择合同，改期写入审计并通知相关人员；后台员工主键与用户审计主键已分离处理 |
| 正式户型 | `/floorplans`、`/floorplans/[id]`、`/floorplans/kujiale`；`GET /api/floorplans/[id]/export/dxf` | `FloorPlanRepository` 与只读量房适配器。正式查看器通过 `@tarikjabiri/dxf@2.8.9`（MIT）下载分图层、毫米单位、AutoCAD 2007+ DXF；共享墙、斜墙、门窗、尺寸、闭合空间标注及多楼层横向分区均从权威 v4 graph 映射，不复制布局。端点要求 `completed`、正式 v4 数据和至少一个闭合空间 | 原有租户、负责设计师或已派测量员权限；Implemented | 不存储 CAD 文件，不导出客户资料或项目图框；酷家乐供应商能力为 Limited |
| 测量与 BLE 设备 | `/measurements`、`/devices` | 测量、设备、绑定、审计 Repository | 平台/企业分配边界；Implemented | 仅支持协议文档定义的测距仪 |
| AI 工作室与生成 | AI 工作流、资产、供应商、价格、点数页面 | PostgreSQL AI Repository 与供应商适配器 | 平台及租户 AI 权限；Implemented/Limited | 供应商可用性和图片存储依赖外部服务 |
| 媒体存储 | `/media-storage`；`npm run db:backup`、`npm run db:restore-drill`、`npm run db:cleanup:dry-run` 和 `npm run db:cleanup:execute` | `media_assets`、供应商配置、存储适配器；备份输出 PostgreSQL 自定义 dump 与耗时，恢复演练只使用 `smart_floor_planner_restore_drill` 并在移除该演练库前校验当前 app schema；清理 dry-run 会在只读事务中启用现有的平台读取范围，再校验目标指纹并输出七牛候选清单；执行命令要求精确指纹、已审核清单 SHA-256、显式本地正式库开关及操作者身份，才会以单事务清理数据库并输出审计 | 平台管理员；Implemented/Limited | 非空七牛清单仍须在人工审核后异步删除；执行命令不调用七牛 |
| 小程序支撑 API | 诊断页及共用 API handler；匿名领取生产路由已接入小程序 | 身份/上下文、双码/推荐成员 API；`GET /api/miniprogram/bootstrap` 以签名 JWT 实时校验 `contextVersion` 与活动上下文，返回当前角色、有效角色组、企业/成员关系、落点、能力白名单和按角色范围统计的服务端徽标摘要（`status`/`message`/`counts`；查询失败为 `unavailable` 与「暂时无法读取」，不阻断身份 bootstrap、不以 0 占位），无效上下文返回 `identity_context_invalid`。`/api/miniprogram/codes/resolve` 会在手机号授权前返回入驻码类型和目标企业展示名称，或为推广码签发 10 分钟待确认来源，或为员工活动码签发 `kind: staff_activity` 待确认来源（活动落地可含企业名称）。已签名客户若已有未关闭且未归档线索的归属锁，resolve 返回 `existingAttribution` 与已有线索，不再签发待确认来源；授权也不再返回新领取设计师资料。归档或关闭线索会释放该锁，客户可再次领取。`GET /api/miniprogram/staff-activity-code` 与 `/image` 为设计师/测量员签发活动码。`/api/miniprogram/referrer-memberships/[id]/promotion-code/image` 返回由微信生成的受保护 PNG/JPEG，`/api/miniprogram/referrals/authorize-and-create-lead` 原子关联客户、锁归属、建线索和派单（活动线索锁定出示人为 `measurerId`；领取时若出示人暂停派单则先不写入测量员，重试派单会在出示人恢复后补派，不从池中另换测量员。）；第 5 阶段提供预约 API；第 6 阶段提供客户项目聚合、仅客户本人读取的已发布方案图片，以及设计师/企业负责人发布或撤回方案 API；第 13 阶段新增仅客户本人的 `GET /api/miniprogram/customer-projects` 索引，以及按签名成员关系读取的 `GET /api/miniprogram/referrer-progress`、`GET /api/miniprogram/referrer-earnings`；第 14 阶段新增面向当前签名设计师、测量员或企业负责人的 `GET /api/miniprogram/workbench` | 推广解析和服务码图片对客户匿名、对推荐人成员关系受保护；客户项目端点按 `customer_user_id` 校验，不信任客户端企业上下文；推荐人进度与收益同时校验 JWT 用户和当前活动成员关系再查询。工作台从签名上下文推导员工角色、企业和员工范围：设计师取得本人已派线索、过期未重约以及自己作为 `measurerId` 的无预约待量房任务，测量员取得本人已确认预约（过期离开已确认）、过期待处理和无预约待量房任务，企业负责人只取得待派失败、过期未重约、人员缺口和含过期的预约列表。客户项目索引返回共享派生 `serviceStage` 与单一下一步 `nextActionKind`（改期 / 重新预约 / 看项目 / 等待设计师）。设计师本人可通过 `GET/PATCH /api/miniprogram/staff/wechat-profile` 与 `POST /api/miniprogram/staff/wechat-qr` 维护微信号和个人二维码，测量员不强制二维码。户型创建/更新同时按 `assignedTo` 或 `measurerId` 授权。预约 API 按客户本人、负责设计师、已指派测量员或企业负责人隔离并使用租户事务；`/api/miniprogram/notification-template` 对已认证身份提供配置以便客户订阅授权；Implemented/Limited | 客户项目使用完成户型摘要和受保护已发布方案图片，不暴露可编辑 graph 或量房编辑器。推荐人聚合只暴露脱敏客户标识、服务事实和本人提成状态。工作台摘要只读，继续使用既有权威线索、预约和正式量房入口合同。预约创建、改期、取消在事务后尝试投递员工及已授权客户；微信小程序码生成、授权和通知依赖外部配置 |
| 通知、自动化与诊断 | 通知设置、提醒运行时、诊断 | 通知模板、调度器、运维记录 | 平台/企业角色；Implemented/Limited | 微信可能拒绝订阅通知投递 |

## 正式量房边界

权威合同见 [`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md)。
`FloorPlan.layoutData` 只包含 `version: 4`、`measurementMode: 'surveying'` 和
`surveyGraph`；测量是不可变审计，尺寸和房间摘要是派生读模型。户型查看器的墙体并集使用 `admin/src/lib/surveyWallSolidPlan.js`，与小程序同一套局部凸/凹求交规则。
DXF 同样只读：`admin/src/lib/dxf.ts` 将 graph 适配给 MIT 许可的写入器，草稿、非正式
v4 数据或无闭合空间的户型会在下载前被拒绝。

## 提成边界

测量员—设计师获客合同已下线，仅作为
[`measurer-designer-acquisition.zh-CN.md`](./measurer-designer-acquisition.zh-CN.md) 的留档保留。推荐网络线索的签单提成以本清单和开发计划为当前合同：`referrer_network` 快照三条应付，`staff_activity` 只快照设计师和测量员两条（同一受益人可兼任两行）。独立后台工作台已按第 7 阶段批准设计源实现，并可按线索来源筛选。

## 维护规则

路由、API、模型、权限、状态或限制变化时，只更新受影响行及中文镜像。每个模块
只保留一份当前描述，不记录修改顺序，也不粘贴测试全文。

English mirror: [admin-system-modules.md](./admin-system-modules.md)
