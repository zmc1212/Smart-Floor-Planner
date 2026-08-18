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
| `/lead-commissions` — 商户三方提成工作台 | 批准设计源 `design-references/referrer-network-appointment-v1/phase-7-three-role-commission-admin-v1.png`（1487x1058 PNG，SHA-256 `DAA7ED1235C474F0C6A0D7FC625A5DD0BD9D97E54F580AB4CD530CE743AB2A1C`）：页头、推荐人/设计师/测量员独立规则卡、台账筛选、待支付选择、确认后的批量标记已支付和金额汇总 | 新路由与 `/acquisition-commissions` 保持独立；路由/API 权限 `lead-commissions` 限 `super_admin`、`admin`、`enterprise_admin`；租户/RLS 边界及既有规则、报表、付款 API 不变 | 聚焦 PostgreSQL 提成测试、ESLint 与 `npm run build` 通过。认证 Chrome 在 `http://localhost:3006/lead-commissions` 核验侧栏入口、三张生效规则卡、筛选项、空台账、禁用付款操作及金额汇总 | 仅在批准设计改变、观察到有数据台账的布局缺陷，或工作流/权限合同变化时重开 |
| `/referrer-network-operations` — 推荐网络运营与验收工作台 | 沿用既有 Ant Design/Admin Pro 方向：双码操作、派单资格表，以及每行都提供真实处理入口的状态验收清单；推广服务码就绪项将已持久化活动码数量与活动成员关系分开呈现。小程序服务码能力只呈现可用性，并链接当前企业的送达诊断，不将平台凭据误称为企业可配置项 | 路由与 `referrer-network-operations` 权限继续限当前租户的 `super_admin`、`admin`、`enterprise_admin`。预约默认值在管理员保存前保持“待处理”；工作台不创建测试数据，也不绕过客户授权 | 聚焦 PostgreSQL 测试与 `npm run build` 通过。认证 Chrome 已在 `http://localhost:3006/referrer-network-operations` 确认当前 `1/1` 推广码/成员关系数量、刷新交互、既有工作台层级，并且浏览器控制台无异常 | 仅在出现清单/双码工作流缺陷，或工作流/权限合同变化时重开 |
| `/appointment-settings` — 企业预约策略 | 沿用既有 Ant Design/Admin Pro 设置单方向：确认状态、时区、七天多时段开放时间和预约数值边界，只有一个主保存动作 | 复用 `GET/PUT /api/appointment-settings` 与 `referrer-network-operations` 权限，限已选租户的 `super_admin`、`admin`、`enterprise_admin`；保存会确认默认策略，不改变预约岗位 API | 聚焦 ESLint 与 `npm run build` 通过。认证 Chrome 已在 `http://localhost:3006` 确认确认状态、七天排期、增加时段交互、预约边界和可用保存动作 | 仅在策略合同变化或出现可复现表单缺陷时重开 |

## 交接

可见行为变化时同步更新该路由的唯一当前记录和中英文文件。只有实现细节变化、
且不影响路由/API/权限/视觉时，在交接中说明即可，不新增台账记录。

English mirror: [admin-ui-refactor.md](./admin-ui-refactor.md)
