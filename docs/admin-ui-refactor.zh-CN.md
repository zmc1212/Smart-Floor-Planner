# 后台 UI 当前约定

本文只记录当前后台 UI 规则和已批准重构方向的最新状态，不记录迁移流水。
早期重构过程由 Git 历史保留。

## 共用约定

- Next.js App Router 页面使用现有 shadcn/ui 和 Radix primitives。
- 保持路由、API、租户、角色和操作边界不变。
- 可复用控件放在 `admin/src/components/ui/*`。
- 所有可见后台变更使用共用成功/失败操作反馈 UI。
- 视觉检查使用 `http://localhost:3005`；认证流程使用用户现有 Chrome 会话。

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
| `/lead-commissions` — 商户三方提成工作台 | 批准设计源 `design-references/referrer-network-appointment-v1/phase-7-three-role-commission-admin-v1.png`（1487x1058 PNG，SHA-256 `DAA7ED1235C474F0C6A0D7FC625A5DD0BD9D97E54F580AB4CD530CE743AB2A1C`）：页头、推荐人/设计师/测量员独立规则卡、台账筛选、待支付选择、确认后的批量标记已支付和金额汇总 | 新路由与 `/acquisition-commissions` 保持独立；路由/API 权限 `lead-commissions` 限 `super_admin`、`admin`、`enterprise_admin`；租户/RLS 边界及既有规则、报表、付款 API 不变 | 聚焦 PostgreSQL 提成测试、ESLint 与 `npm run build` 通过。认证 Chrome 在 `http://localhost:3005/lead-commissions` 核验侧栏入口、三张生效规则卡、筛选项、空台账、禁用付款操作及金额汇总 | 仅在批准设计改变、观察到有数据台账的布局缺陷，或工作流/权限合同变化时重开 |

## 交接

可见行为变化时同步更新该路由的唯一当前记录和中英文文件。只有实现细节变化、
且不影响路由/API/权限/视觉时，在交接中说明即可，不新增台账记录。

English mirror: [admin-ui-refactor.md](./admin-ui-refactor.md)
