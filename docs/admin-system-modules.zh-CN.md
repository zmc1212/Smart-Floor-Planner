# 后台系统当前功能清单

本文只记录后台当前运行入口、合同、权限和限制。实现过程由 Git 提交保留，
不在清单中追加日期流水。

## 共用架构

- Next.js 16 App Router、React 19、Tailwind CSS 4、shadcn/ui/Radix。
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

| 模块 | 当前入口 | API/数据边界 | 权限/状态 | 当前限制 |
| --- | --- | --- | --- | --- |
| 登录与会话 | `/login`、`/register` | `/api/auth/*`；小程序 JWT 使用基础用户 `sub`、当前 `customer/staff/referrer` 上下文和 `contextVersion` | 公开入口与登录后路由；Implemented | 微信供应商配置依赖环境；旧身份字段在旧获客流程下线前并存 |
| 导航、角色与权限 | 共用侧栏、路由守卫 | `/api/permissions`、角色/菜单 Repository | `super_admin`、`admin`、企业角色；Implemented | 权限按租户和角色实时生效 |
| 平台与企业 | `/dashboard`、`/enterprises` | 企业、品牌、激活及平台 Repository | 平台角色；Implemented | 租户变更必须存在企业上下文 |
| 员工与账号 | `/staff`、`/departments`、`/users`；阶段 3 尚无双码界面 | 员工、部门、共享通知和管理员 Repository；双码接口；设计师/测量员的 `assignmentPaused` 与资料完整性决定新流程派单资格，入驻、创建、资料补全或恢复派单触发待处理线索重试 | 双码管理限 `super_admin`、`admin`、`enterprise_admin`；入驻令牌按类型隔离，员工只能属于一家企业；Implemented | 当前活动入驻码和待确认来源依赖至少 128-bit 的稳定生产密钥；生产双码界面仍在计划中 |
| 报备与协作 | `/promotions`、企业协作页 | 报备、推荐和共享通知 Repository | 企业和员工边界；Implemented | 企业微信投递为可选外部能力 |
| 套餐、订单与提成 | `/packages`、`/orders`、`/commissions`、`/lead-commissions` | 套餐、订单、既有提成及 `LeadCommissionRepository`；`GET/PUT /api/commission-rules`、可筛选的 `GET /api/lead-commissions`、`POST /api/lead-commissions/mark-paid`。工作台维护三条规则，并在报表逐条展示客户、推荐人关系、企业、设计师、测量员和当前有效预约 | `lead-commissions` 仅 `super_admin`、`admin`、`enterprise_admin` 可用；系统管理员即使使用旧的已存菜单快照也始终展示该受保护入口；规则修改和线下批量标记已支付均使用 RLS 与租户事务；Implemented/Limited | 旧获客提成路由已下线。支付不在本系统内完成 |
| 线索与转化 | `/leads`、`/leads/[id]` | 线索生命周期、户型、`ReferralLeadRepository`、`CustomerProjectRepository` 与 `LeadCommissionRepository`；新流程原子写入客户归属锁、推荐人成员、设计师/测量员派单与事件，关闭线索同步释放活动归属；推荐网络线索签单时原子快照三条角色提成，AI generation 只有通过发布事实才进入客户项目 | 客户授权或租户/责任人校验；负责设计师仅管理自己线索的已成功 generation，企业负责人可管理本企业；撤销签单仅企业管理员且已支付提成会阻止撤销；Implemented/Limited | 客户项目已展示受保护聚合中的真实服务事实、完成正式户型摘要及主动发布方案；方案图片保持仅客户本人读取并写为小程序本地临时文件。客户不具备 graph 编辑或量房编辑器入口；存在合同或派生记录时禁止清除 |
| 正式户型 | `/floorplans`、`/floorplans/[id]`、`/floorplans/kujiale` | `FloorPlanRepository`、量房适配器、DXF 导出 | 租户与户型权限；Implemented | 酷家乐供应商能力为 Limited |
| 测量与 BLE 设备 | `/measurements`、`/devices` | 测量、设备、绑定、审计 Repository | 平台/企业分配边界；Implemented | 仅支持协议文档定义的测距仪 |
| AI 工作室与生成 | AI 工作流、资产、供应商、价格、点数页面 | PostgreSQL AI Repository 与供应商适配器 | 平台及租户 AI 权限；Implemented/Limited | 供应商可用性和图片存储依赖外部服务 |
| 媒体存储 | `/media-storage`；`npm run db:backup`、`npm run db:restore-drill`、`npm run db:cleanup:dry-run` 和 `npm run db:cleanup:execute` | `media_assets`、供应商配置、存储适配器；备份输出 PostgreSQL 自定义 dump 与耗时，恢复演练只使用 `smart_floor_planner_restore_drill` 并在移除该演练库前校验当前 app schema；清理 dry-run 会在只读事务中启用现有的平台读取范围，再校验目标指纹并输出七牛候选清单；执行命令要求精确指纹、已审核清单 SHA-256、显式本地正式库开关及操作者身份，才会以单事务清理数据库并输出审计 | 平台管理员；Implemented/Limited | 非空七牛清单仍须在人工审核后异步删除；执行命令不调用七牛 |
| 小程序支撑 API | 诊断页及共用 API handler；匿名领取生产路由已接入小程序 | 身份/上下文、双码/推荐成员 API；`/api/miniprogram/codes/resolve` 签发 10 分钟待确认来源，`/api/miniprogram/referrer-memberships/[id]/promotion-code/image` 返回由微信生成的受保护 PNG，`/api/miniprogram/referrals/authorize-and-create-lead` 原子关联客户、锁归属、建线索和派单；第 5 阶段提供预约 API；第 6 阶段提供客户项目聚合、仅客户本人读取的已发布方案图片，以及设计师/企业负责人发布或撤回方案 API | 推广解析和服务码图片对客户匿名、对推荐人成员关系受保护；客户项目按 `customer_user_id` 校验，不信任客户端企业上下文；预约 API 按客户本人、负责设计师、已指派测量员或企业负责人隔离并使用租户事务；`/api/miniprogram/notification-template` 对已认证身份提供配置以便客户订阅授权；Implemented/Limited | 客户项目使用完成户型摘要和受保护已发布方案图片，不暴露可编辑 graph 或量房编辑器。预约创建、改期、取消在事务后尝试投递员工及已授权客户；微信小程序码生成、授权和通知依赖外部配置 |
| 通知、自动化与诊断 | 通知设置、提醒运行时、诊断 | 通知模板、调度器、运维记录 | 平台/企业角色；Implemented/Limited | 微信可能拒绝订阅通知投递 |

## 正式量房边界

权威合同见 [`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md)。
`FloorPlan.layoutData` 只包含 `version: 4`、`measurementMode: 'surveying'` 和
`surveyGraph`；测量是不可变审计，尺寸和房间摘要是派生读模型。

## 提成边界

测量员—设计师获客合同已下线，仅作为
[`measurer-designer-acquisition.zh-CN.md`](./measurer-designer-acquisition.zh-CN.md) 的留档保留。推荐网络线索的签单三方提成以本清单和开发计划为当前合同；独立后台工作台已按第 7 阶段批准设计源实现。

## 维护规则

路由、API、模型、权限、状态或限制变化时，只更新受影响行及中文镜像。每个模块
只保留一份当前描述，不记录修改顺序，也不粘贴测试全文。

English mirror: [admin-system-modules.md](./admin-system-modules.md)
