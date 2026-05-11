# 重构地推员角色：从企业员工升级为平台渠道角色（最终优化方案）

## 问题诊断

当前系统把"地推员 `salesperson`"设计为装修公司（Enterprise）的内部员工，通过"员工管理"创建，绑定到某个 `enterpriseId`。这完全搞反了业务关系：

| | 当前错误设计 | 正确业务模型 |
|---|---|---|
| **地推员归属** | 企业的员工 | **平台方的渠道人员** |
| **地推员职责** | 帮企业找房东客户（B2C） | **帮平台找装修公司客户（B2B）** |
| **创建入口** | 员工管理（商家侧） | **系统账号管理（平台侧）** |
| **数据隔离** | 受 enterpriseId 过滤 | **不绑定任何企业，跨企业可见自己报备** |

## 与行业标准的对标分析

参照市面主流 B2B 地推系统（如 Zoho CRM 渠道管理、销售易、纷享销客），当前系统已经**做对了几点**，但存在**关键缺失**：

### ✅ 已有的优秀设计（保留）
- 企业报备表单（PromotionEnterpriseRecord）整体结构合理
- 信用代码/企业名+电话 的查重去重机制
- 冲突检测与归属裁决流程（conflict_pending → manually_locked）
- SLA 时限 + 自动催办提醒（workflow-automation.ts）
- 提成自动核算（CommissionRecord + syncCommissionForOrder）
- 工作台待办汇总（buildTodoItemsForRecord）

### ❌ 关键缺失（本次新增）

| 行业标准功能 | 当前状态 | 优化方案 |
|---|---|---|
| **保护期机制** | ❌ 无 | 报备成功自动锁定 N 天，期间其他地推不可重复报备同一企业 |
| **公海池释放** | ❌ 无 | 保护期到期且无实质进展 → 自动释放到公海池，其他人可认领 |
| **保护期延长** | ❌ 无 | 提交跟进记录自动延长保护期 |
| **平台级提成配置** | ⚠️ 绑定在 Enterprise 上 | 提成金额应配置在平台级（每成交一单固定金额），而非绑定在被推销的企业上 |
| **地推员独立视图** | ❌ 无 | 地推员登录后应看到简洁的"我的报备"视图 + 公海池入口 |

## 用户审核建议

> [!IMPORTANT]
> **角色变更影响**：`salesperson` 将变为平台级角色，不再出现在"员工管理"中。已有数据中 `salesperson` 角色的 `enterpriseId` 将保留但不再作为数据隔离条件。

> [!WARNING]
> **设计师绑定废弃**：当前 `AdminUser.promoterIds`（将设计师绑定到地推员）在新模型下没有意义——设计师属于企业内部，地推员属于平台外勤。这个字段将被保留但不再在 UI 中使用。

## Open Questions

> [!IMPORTANT]
> 1. **保护期天数**：默认建议 30 天，是否需要可配置？
> 2. **提成金额**：是否改为平台统一配置（如每单固定 500 元），还是保留按企业差异化配置？
> 3. **公海池是否需要认领审批**：释放到公海池的企业，其他地推员是否可以直接认领，还是需要管理员批准？

---

## 拟议变更（按执行顺序）

### Phase 1：模型与数据层

#### [MODIFY] [AdminUser.ts](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/models/AdminUser.ts)

- **权限重新分配**：
  ```diff
  # salesperson 权限：仅保留平台级 B2B 模块
  - salesperson: ['dashboard', 'leads', 'promotion-records', 'enterprise-orders', 'commissions', 'measurements', 'ai-floorplan', 'ai-furnishing', 'ai-soft-furnishing', 'inspirations']
  + salesperson: ['dashboard', 'promotion-records', 'enterprise-orders', 'commissions']
  ```
- **ROLE_LABELS 更名**：`salesperson: '地推员'` → `salesperson: '渠道地推'`
- **多租户过滤器调整**：当 role === 'salesperson' 时，不按 `enterpriseId` 过滤，仅按 `promoterId` 自身 ID 过滤
- **移除 enterprise_admin 对 B2B 模块的权限**：
  ```diff
  # enterprise_admin 权限中移除地推相关
  - enterprise_admin: [..., 'promotion-records', 'enterprise-orders', 'commissions', ...]
  + enterprise_admin: ['dashboard', 'floorplans', 'leads', 'ai-floorplan', 'ai-furnishing', 'ai-soft-furnishing', 'inspirations', 'staff', 'devices', 'measurements']
  ```

#### [MODIFY] [PromotionEnterpriseRecord.ts](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/models/PromotionEnterpriseRecord.ts)

- **新增保护期字段**：
  ```typescript
  protectionExpiresAt?: Date;       // 保护期截止时间
  protectionExtendedCount: number;  // 已延长次数
  poolStatus: 'protected' | 'in_pool' | 'claimed';  // 公海池状态
  ```
- **enterpriseId 语义变更**：此字段改为"已入驻企业 ID"（成交后回填），报备阶段为空
- **多租户插件调整**：移除 `enterpriseId` 作为必须过滤条件，salesperson 仅按 `promoterId` 过滤

#### [MODIFY] [Lead.ts](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/models/Lead.ts)

- 移除 `salesperson: 'promoterId'` 的角色过滤配置（地推员不再操作房东线索）

---

### Phase 2：核心业务逻辑

#### [MODIFY] [promotion-workflow.ts](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/lib/promotion-workflow.ts)

- `buildPromotionAccessFilter`：salesperson 不再检查 `enterpriseId`，仅按 `promoterId` 过滤
- `buildPromotionDuplicateQuery`：移除 `enterpriseId` 条件（全平台范围去重）
- **新增** `claimFromPool(recordId, salespersonId)`：公海池认领逻辑
- **新增** `releaseToPool(recordId)`：手动/自动释放到公海池

#### [MODIFY] [workflow-automation.ts](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/lib/workflow-automation.ts)

- **新增平台级自动化配置**（与企业级分离）：
  ```typescript
  export const PLATFORM_AUTOMATION_CONFIG = {
    protectionPeriodDays: 30,          // 保护期天数
    protectionExtendDays: 15,          // 跟进后延长天数
    maxProtectionExtends: 3,           // 最大延长次数
    fixedCommissionPerOrder: 500,      // 平台固定提成（元）
  };
  ```
- `runWorkflowReminderScan`：新增保护期到期扫描 → 自动释放到公海池
- `buildTodoItemsForRecord`：salesperson 新增"保护期即将到期"的待办提醒

#### [MODIFY] [api/promotion-records/route.ts](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/app/api/promotion-records/route.ts)

- GET：salesperson 不再需要 `enterpriseId`，按 `promoterId` 过滤
- GET：新增 `?pool=true` 参数，返回公海池中可认领的记录
- POST：创建时自动计算 `protectionExpiresAt = now + 30天`，设 `poolStatus = 'protected'`
- POST：查重范围改为全平台（不限 enterpriseId）

#### [NEW] [api/promotion-records/pool/route.ts](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/app/api/promotion-records/pool/route.ts)

- GET：返回所有 `poolStatus === 'in_pool'` 的记录
- POST：`{ recordId, action: 'claim' }` 认领公海池记录

---

### Phase 3：页面与导航迁移

#### [MOVE] promotion-records: `(merchant)` → `(platform)`
#### [MOVE] enterprise-orders: `(merchant)` → `(platform)`
#### [MOVE] commissions: `(merchant)` → `(platform)`

将三个目录从 `src/app/(admin)/(merchant)/` 移动到 `src/app/(admin)/(platform)/`。

#### [MODIFY] [Sidebar.tsx](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/components/Sidebar.tsx)

```diff
# 从 merchant 组中移除
- { key: 'promotion-records', label: '企业报备', icon: Building2, href: '/promotion-records' },
- { key: 'enterprise-orders', label: '成交订单', icon: ClipboardList, href: '/enterprise-orders' },
- { key: 'commissions', label: '提成结算', icon: Coins, href: '/commissions' },

# 添加到 platform 组
+ 新增 "渠道地推" 分类：
+   { key: 'promotion-records', label: '企业报备', ... },
+   { key: 'enterprise-orders', label: '成交订单', ... },
+   { key: 'commissions', label: '提成结算', ... },

# 导航可见性规则调整：
# platform 组菜单对 super_admin / admin / salesperson 可见
```

#### [MODIFY] [admins/page.tsx](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/app/(admin)/(platform)/admins/page.tsx)

- 角色选择增加 `salesperson`（渠道地推）选项
- 选择 salesperson 时不要求关联企业

#### [MODIFY] [staff/page.tsx](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/app/(admin)/(merchant)/staff/page.tsx)

- 从角色下拉中移除 `salesperson`（地推员不再是企业员工）
- 移除设计师关联地推员的 UI 区块（`promoterIds` 选择器）

#### [MODIFY] [promotion-records/page.tsx](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/app/(admin)/(platform)/promotion-records/page.tsx)

- 新增"公海池"Tab 视图
- 保护期状态可视化（显示剩余天数、已延长次数）
- 公海池记录增加"认领"按钮

---

### Phase 4：提成配置迁移

#### [MODIFY] [Enterprise.ts](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/models/Enterprise.ts)

- `groundPromotionFixedCommission` 字段标记为 deprecated（保留但不再作为首选来源）

#### [MODIFY] [promotion-workflow.ts → syncCommissionForOrder](file:///g:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/lib/promotion-workflow.ts)

- 提成金额优先读取 `PLATFORM_AUTOMATION_CONFIG.fixedCommissionPerOrder`
- 如果企业级有覆盖值则使用企业值（向下兼容）

---

## 变更影响矩阵

| 模块 | 文件数 | 风险等级 | 说明 |
|---|---|---|---|
| Models | 3 | ⚠️ 中 | AdminUser, PromotionEnterpriseRecord, Lead 的 Schema 调整 |
| API Routes | 4 | ⚠️ 中 | promotion-records, enterprise-orders, commission-records, pool(新) |
| 业务逻辑 | 2 | ⚠️ 中 | promotion-workflow.ts, workflow-automation.ts |
| 页面迁移 | 3 | 🟢 低 | 目录移动 + 路由自动适配 |
| 导航 & UI | 3 | 🟢 低 | Sidebar, admins/page, staff/page |

## 验证计划

### 自动化验证
1. 在"系统权限中心"创建 salesperson 账号（不绑定任何企业）
2. 登录该账号，验证菜单只展示：概览 / 企业报备 / 成交订单 / 提成结算
3. 提交一条企业报备，验证 `protectionExpiresAt` 自动计算
4. 添加跟进记录，验证保护期是否延长
5. 手动将保护期设为过去时间，触发 reminder scan，验证自动释放到公海池
6. 以另一个 salesperson 登录，验证公海池可见且可认领

### 手动验证
- 以 enterprise_admin 登录"员工管理"，确认不再显示 salesperson 角色选项
- 确认 B2C 线索（leads）页面对 salesperson 不可见
- 验证提成金额使用平台配置而非企业配置
