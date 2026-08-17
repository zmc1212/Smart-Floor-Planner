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
| 员工与账号 | `/staff`、`/departments`、`/users`；阶段 2 尚无双码界面 | 员工、部门、绑定、管理员 Repository；`/api/enterprise/join-codes`、换码/停用接口及 `/api/miniprogram/onboarding/staff` | 双码管理限 `super_admin`、`admin`、`enterprise_admin`；入驻令牌按类型隔离，员工只能属于一家企业；Implemented | 当前活动入驻码依赖至少 128-bit 的稳定生产 `REFERRER_TOKEN_SECRET` 或 `JWT_SECRET`；生产双码界面仍在计划中 |
| 报备与协作 | `/promotions`、企业协作页 | 报备、推荐、通知、获客 Repository | 企业和员工边界；Implemented | 企业微信投递为可选外部能力 |
| 套餐、订单与提成 | `/packages`、`/orders`、`/commissions` | 套餐、订单、提成 Repository | 平台/企业边界；Implemented | 支付结算不在本系统内完成 |
| 线索与转化 | `/leads`、`/leads/[id]` | 线索、获客、生命周期、户型 Repository | 租户与责任人校验；Implemented | 存在合同或派生记录时禁止清除 |
| 正式户型 | `/floorplans`、`/floorplans/[id]`、`/floorplans/kujiale` | `FloorPlanRepository`、量房适配器、DXF 导出 | 租户与户型权限；Implemented | 酷家乐供应商能力为 Limited |
| 测量与 BLE 设备 | `/measurements`、`/devices` | 测量、设备、绑定、审计 Repository | 平台/企业分配边界；Implemented | 仅支持协议文档定义的测距仪 |
| AI 工作室与生成 | AI 工作流、资产、供应商、价格、点数页面 | PostgreSQL AI Repository 与供应商适配器 | 平台及租户 AI 权限；Implemented/Limited | 供应商可用性和图片存储依赖外部服务 |
| 媒体存储 | `/media-storage` | `media_assets`、供应商配置、存储适配器 | 平台管理员；Implemented | 对象存储清理由独立运维执行 |
| 小程序支撑 API | 诊断页及共用 API handler；阶段 2 未新增小程序页面 | 身份/上下文 API；`/api/miniprogram/codes/resolve`、`/api/miniprogram/onboarding/{staff,referrer}`、`/api/miniprogram/referrer-memberships/*`；线索、户型、AI、通知 | 已授权手机号的用户；身份关系实时校验；推荐人默认最多三个活动企业关系，退出后提升 `contextVersion`；Implemented/Limited | 令牌解析尚不创建客户归属、线索或派单；这些能力与生产界面留待后续阶段 |
| 通知、自动化与诊断 | 通知设置、提醒运行时、诊断 | 通知模板、调度器、运维记录 | 平台/企业角色；Implemented/Limited | 微信可能拒绝订阅通知投递 |

## 正式量房边界

权威合同见 [`surveying-module/formal-surveying.md`](./surveying-module/formal-surveying.md)。
`FloorPlan.layoutData` 只包含 `version: 4`、`measurementMode: 'surveying'` 和
`surveyGraph`；测量是不可变审计，尺寸和房间摘要是派生读模型。

## 获客与提成边界

当前测量员—设计师合同见 [`measurer-designer-acquisition.zh-CN.md`](./measurer-designer-acquisition.zh-CN.md)，
包含绑定、获客确认、通知、提成、幂等和角色边界。独立工作台方案不是运行时合同。

## 维护规则

路由、API、模型、权限、状态或限制变化时，只更新受影响行及中文镜像。每个模块
只保留一份当前描述，不记录修改顺序，也不粘贴测试全文。

English mirror: [admin-system-modules.md](./admin-system-modules.md)
