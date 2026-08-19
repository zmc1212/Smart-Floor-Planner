# 后台 UI 当前约定

本文只记录当前后台 UI 规则和已批准重构方向的最新状态，不记录迁移流水。
早期重构过程由 Git 历史保留。

## 共用约定

- Next.js App Router 页面使用既有 Ant Design 5 和 Ant Design Pro 系统，包含共享的 `AdminAntdProvider` token 配置。
- 在适合工作流时使用 `PageContainer`、`ProTable`、Ant Design 表单/反馈 primitive 及既有后台业务组件；新的后台工作不得引入平行 UI 系统。
- 保持路由、API、租户、角色和操作边界不变。
- 可复用后台控件放在 `admin/src/components/admin/*` 或既有业务组件目录。
- 所有可见后台变更使用共用成功/失败操作反馈 UI。
- 视觉检查使用 `http://localhost:3006`；认证流程使用用户现有 Chrome 会话。

## 路由记录格式

每条路由最多保留一条当前记录：

| 字段 | 必填内容 |
| --- | --- |
| 路由 | 当前 pathname 和页面归属 |
| 视觉范围 | 当前修改或还原的界面范围 |
| 边界 | 未改变的 API、权限、租户和导航合同 |
| 核验 | 最近一次聚焦测试、构建或视觉证据 |
| 未决项 | 当前仍存在的风险或下次重开触发条件 |

路由再次变化时直接替换旧记录。不要追加日期进度、已废弃设计源或重复测试
全文。

## 当前队列

通用重构请求只能选择未记录或明确排队的路由。标记为 `Hold` 的路由只有在
用户点名、存在可复现缺陷、工作流合同变化或获得新的设计方向批准时才能重开。

## 当前路由记录

| 路由 | 视觉范围 | 边界 | 核验 | 未决项 |
| --- | --- | --- | --- | --- |
| `/lead-commissions` — 商户三方提成工作台 | 批准设计源 `design-references/referrer-network-appointment-v1/phase-7-three-role-commission-admin-v1.png`（1487x1058 PNG，SHA-256 `DAA7ED1235C474F0C6A0D7FC625A5DD0BD9D97E54F580AB4CD530CE743AB2A1C`）：页头、推荐人/设计师/测量员独立规则卡、台账筛选（含线索来源 `referrer_network` / `staff_activity`）、待支付选择、确认后的批量标记已支付和金额汇总 | 新路由与 `/acquisition-commissions` 保持独立；路由/API 权限 `lead-commissions` 限 `super_admin`、`admin`、`enterprise_admin`；租户/RLS 边界及既有规则、报表、付款 API 不变 | 聚焦 PostgreSQL 提成测试、ESLint 与 `npm run build` 通过。认证 Chrome 在 `http://localhost:3006/lead-commissions` 核验侧栏入口、三张生效规则卡、筛选项、空台账、禁用付款操作及金额汇总 | 仅在批准设计改变、观察到有数据台账的布局缺陷，或工作流/权限合同变化时重开 |
| `/referrer-network-operations` — 推荐网络运营与验收工作台 | 沿用既有 Ant Design/Admin Pro 方向：就绪数字、每行都提供真实处理入口的状态验收清单，以及最近 5 条双码审计预览。双码作业、推荐人名册、派单资格全表和完整审计不再放在本页。推广服务码就绪项将已持久化活动码数量与活动成员关系分开呈现，并跳转到 `/referrers`。小程序服务码能力只呈现可用性，并链接当前企业的送达诊断，不将平台凭据误称为企业可配置项 | 路由与 `referrer-network-operations` 权限继续限当前租户的 `super_admin`、`admin`、`enterprise_admin`。并列页 `/join-codes`、`/referrers`、`/appointment-settings` 复用该权限。预约默认值在管理员保存前保持“待处理”；工作台不创建测试数据，也不绕过客户授权 | 聚焦 PostgreSQL 测试与归因合同测试通过。拆分后的登录态视觉核验待补 | 仅在出现清单工作流缺陷，或工作流/权限合同变化时重开 |
| `/join-codes` — 企业员工/推荐人入驻码 | 沿用既有 Ant Design/Admin Pro 方向：两张双码卡片提供换新/停用/查看/下载二维码，并展示完整双码审计。令牌不出现在后台页或列表 DTO；二维码仍为 90 秒私有 Blob | 复用 `GET /api/enterprise/join-codes`（双码 + 审计）及既有换新/停用/图片接口，权限为 `referrer-network-operations`。不在本页创建员工或推荐人记录 | 归因合同测试通过。认证 Chrome 核验待补 | 仅在双码合同变化或出现可复现二维码/审计缺陷时重开 |
| `/referrers` — 企业推荐人名册 | 沿用既有 Ant Design/Admin Pro ProTable：姓名、手机号、加入时间、活动推广码、成员状态、姓名/手机号搜索和停用后续扫码。无后台新建表单 | 复用 `GET /api/enterprise/referrer-memberships` 与 `POST /api/enterprise/referrer-memberships/[id]/disable`，权限为 `referrer-network-operations`。停用不改写历史线索和提成 | 聚焦 PostgreSQL 名册测试通过。认证 Chrome 核验待补 | 仅在成员合同变化或出现可复现名册缺陷时重开 |
| `/appointment-settings` — 企业预约策略 | 沿用既有 Ant Design/Admin Pro 设置单方向：确认状态、时区、七天多时段开放时间和预约数值边界，只有一个主保存动作 | 复用 `GET/PUT /api/appointment-settings` 与 `referrer-network-operations` 权限，限已选租户的 `super_admin`、`admin`、`enterprise_admin`；商户侧栏现将该路由放在「推荐网络」分组。保存会确认默认策略，不改变预约岗位 API | 聚焦 ESLint 与 `npm run build` 通过。认证 Chrome 已在 `http://localhost:3006` 确认确认状态、七天排期、增加时段交互、预约边界和可用保存动作 | 仅在策略合同变化或出现可复现表单缺陷时重开 |
| `/` — 设计师/测量员员工工作台 | 沿用现有 Ant Design/Admin Pro 首页方向：角色统计、本人客户/量房任务列表（含无预约活动线索待量房，并标注立即量房/可预约）、预约摘要、既有线索/户型/AI 入口；测量员显示正式 BLE 量房仍在小程序的边界提示 | 首页通过后台 Cookie 会话角色渲染；`GET /api/workbench/staff` 使用租户事务并只返回当前设计师或测量员的数据；不改变 `/leads`、`/measurements`、`/floorplans`、AI 页面和小程序正式量房权限 | 已完成 API/组件接线、`git diff --check`；后台 `lint`/全量 `tsc` 仍受仓库既有错误阻断，角色登录态视觉核验待补 | 仅在角色工作流、数据范围或正式量房入口合同变化时重开；本阶段不迁移 H5/BLE 编辑器 |
| `/leads` 与 `/leads/[id]` — 线索操作与预约交接 | 既有 Ant Design ProTable 保留筛选、分页、加载态和批量选择，通过 `tableViewRender` 将每条线索渲染为响应式 ProCard，分组呈现客户、派单、推广人、预约和操作；`/leads/[id]` 通过路由交接进入共享抽屉，保持单一详情面；创建/改预约弹窗沿用小程序的“日期分段 + 可用时段分段”模式，通过 Ant Design 控件承载，并使用服务端可用时段结果和共享 token；全局 Modal footer 增加统一内容分隔 | 线索列表/详情 DTO 暴露已分配测量员、最近一条有效预约，以及 `referrer_network` 线索的真实推广人；后台 Cookie 设计师和企业负责人可通过 `/api/appointments/availability` 读取本租户可用时段，设计师仅限本人线索，并通过 `/api/appointments` 创建、通过 `/api/appointments/[id]/internal-reschedule` 改期；租户及既有归档/签约权限不变 | `git diff --check`、聚焦 ESLint 与 Impeccable detector 通过。此前认证 Chrome 已确认有数据卡片及桌面/390px 移动端无横向溢出；本次分段选择器热更新后的视觉复核因 Chrome 调试连接失效暂未完成，未提交任何预约变更；共享 Modal footer 规则已覆盖文本域计数与操作按钮间距 | 仅在出现有数据卡片布局缺陷、响应式裁切或预约/推广人权限与工作流合同变化时重开 |

## 交接

本次 `/leads` 预约交接补充了预约详情中的“补充地址/修改地址”操作；仍沿用既有 Ant Design 抽屉、共享操作反馈、租户和岗位权限，设计师与测量员通过同一预约地址 API 完成后续补录。

可见行为变化时同步更新该路由的唯一当前记录和中英文文件。只有实现细节变化、
且不影响路由/API/权限/视觉时，在交接中说明即可，不新增台账记录。

English mirror: [admin-ui-refactor.md](./admin-ui-refactor.md)
