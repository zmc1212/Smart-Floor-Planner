# Airy Minimalist v1 小程序页面设计稿生成清单

> 用途：记录基于《推荐人网络与预约量房闭环开发计划》的 Airy Minimalist 新设计稿生成顺序。
> 本文只管理设计参考，不代表页面已经开发或已经完成视觉还原。

## 1. 设计约束

- 设计基线：iPhone 13 Pro，`390x844`，必须包含微信右上角原生胶囊安全区。
- 视觉方向：暖白背景、家客绿、F1 小K角色体块 + F3 空间变形隐喻、大留白、原生控件。
- 设计参考统一放在 `design-references/miniprogram-airy-minimalist-v1/`，不得放入 `miniprogram/` 运行包。
- 每张页面稿只表达一个页面或一个明确状态；不要把整页截图切片为运行时 UI 素材。
- 设计稿完成后，再将最新文件写入中英文设计还原台账；本清单不替代台账。

### 品牌资产锁定

- 家客来正式 Logo 唯一生产资产：`miniprogram/images/home-ip-v1/brand-logo.png`
- 文件规格：`PNG`，`256x256`；生成页面设计稿时必须以该文件作为 Logo 参考或直接复用。
- 禁止用生成的“JK”字母方块、文字占位、其他历史 Logo 或重新绘制图形替代。
- 本条优先于设计稿中出现的任何占位 Logo；P01 已按此规则校正。

## 2. 已有 Airy Minimalist 新稿

| 编号 | 页面 | 运行路由 | 当前文件 | 备注 |
| --- | --- | --- | --- | --- |
| A01 | 客户服务首页 / 工作台 | `pages/index/index`（客户） | `01-customer-workbench.jpg` | 客户主场景 |
| A02 | 客户项目服务档案 | `packages/business/customer-project/customer-project` | `02-customer-project-archive.jpg` | 项目详情，不是项目索引 |
| A03 | 预约详情 | `packages/business/appointment-detail/appointment-detail` | `03-appointment-reschedule.jpg` | 与改期共用一张稿 |
| A04 | 预约改期 | `packages/business/appointment-reschedule/appointment-reschedule` | `03-appointment-reschedule.jpg` | 已确认预约后的改期状态 |
| A05 | 设计师工作台 | `pages/index/index`（设计师） | `04-designer-workbench.jpg` | 角色首页 |
| A06 | 测量员工作台 | `pages/index/index`（测量员） | `05-measurer-workbench.jpg` | 角色首页 |
| A07 | 推荐人工作台 | `packages/business/referrer-workbench/referrer-workbench` | `06-promoter-workbench.jpg` | 企业选择和服务码入口 |
| A08 | 测量员量房日程 | `packages/business/measurer-calendar/measurer-calendar` | `07-measurer-calendar.jpg` | 含不可用时间入口，但不含编辑器 |

## 3. 待生成：推荐网络与获客链路（最高优先级）

这些页面直接决定“出示服务码 → 客户领取服务 → 自动派单”的闭环。

| 勾选 | 编号 | 页面/状态 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [x] | P01 | 服务码展示模板（推荐人 / 员工共用） | `packages/business/promotion-service-code/promotion-service-code` | `09-promotion-service-code.jpg` |
| [x] | P02 | 扫码后确认领取服务 | `packages/business/free-design-service/free-design-service` | `10-free-design-confirm.jpg` |
| — | P03 | ~~手机号授权~~（已合并至 P02） | `packages/business/free-design-service/free-design-service` | 不再单独产出 |
| [x] | P04 | 授权成功、已分配设计师 | `packages/business/free-design-service/free-design-service` | `12-free-design-success.jpg` |
| [x] | P05 | 已领取但暂未分配设计师 | `packages/business/free-design-service/free-design-service` | `13-free-design-assignment-pending.jpg` |
| [x] | P06 | 客户已有未关闭服务归属 | `packages/business/free-design-service/free-design-service` | `14-free-design-existing-attribution.jpg` |
| — | P07 | 员工活动码展示（复用 P01 模板） | `packages/business/staff-activity-code/staff-activity-code` | 不再单独产出 |
| [x] | P08 | 员工/推荐人扫码入驻 | `packages/business/onboarding/onboarding` | `16-onboarding.jpg` |
| [x] | P09 | 入驻失效、停用、换码恢复 | `packages/business/onboarding/onboarding` | `17-onboarding-recovery.jpg` |

`onboarding-debug` 仅开发版使用，不建议单独投入高保真设计；如需调试稿，可命名为
`debug-onboarding-scanner.jpg`，并明确标注“开发版”。

> P02 已包含“确认领取 + 微信手机号授权”这一单一用户动作；点击授权后直接进入
> P04（已匹配）、P05（匹配中）或 P06（已有进行中服务）之一。P03 不应作为独立页面实施。

> P07 复用 P01 的服务码展示结构（顶部身份信息、服务码、权益说明和保存/分享操作）；
> 仅按员工活动码的真实数据替换标题、归属门店、有效状态与文案，不另起一套版式或交互。

## 4. 待生成：五角色信息架构与工作台

### 4.1 角色工作区

| 勾选 | 编号 | 页面 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [ ] | R01 | 企业负责人经营工作台 | `pages/index/index`（企业负责人） | `18-enterprise-operations-workbench.jpg` |
| [ ] | R02 | 企业负责人客户列表 | `pages/leads-management/leads-management`（企业负责人） | `19-enterprise-customer-list.jpg` |
| [ ] | R03 | 企业负责人预约列表 | `packages/business/enterprise-appointments/enterprise-appointments` | `20-enterprise-appointments.jpg` |
| [ ] | R04 | 客户项目索引 | `packages/business/customer-projects/customer-projects` | `21-customer-project-index.jpg` |
| [ ] | R05 | 推荐人服务进度 | `packages/business/referrer-progress/referrer-progress` | `22-referrer-progress.jpg` |
| [ ] | R06 | 推荐人收益 | `packages/business/referrer-earnings/referrer-earnings` | `23-referrer-earnings.jpg` |
| [ ] | R07 | 设计师客户列表 | `pages/leads-management/leads-management`（设计师） | `24-designer-customer-list.jpg` |
| [ ] | R08 | “我的”与当前身份 | `pages/mine/mine` | `25-account-mine.jpg` |

### 4.2 身份、资料与恢复

| 勾选 | 编号 | 页面/状态 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [ ] | R09 | 身份切换列表 | `packages/business/identity-switch/identity-switch` | `26-identity-switch.jpg` |
| [ ] | R10 | 登录失效/身份撤权恢复 | `packages/business/identity-recovery/identity-recovery` | `27-identity-recovery.jpg` |
| [ ] | R11 | 设计师资料编辑（微信号、二维码） | `packages/business/profile-edit/profile-edit` | `28-profile-edit.jpg` |
| [ ] | R12 | 设置与通知状态 | `packages/business/settings/settings` | `29-settings.jpg` |
| [ ] | R13 | 账号安全 | `packages/business/account-security/account-security` | `30-account-security.jpg` |

## 5. 待生成：预约、量房与交接

| 勾选 | 编号 | 页面 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [ ] | S01 | 线索详情与首次预约入口 | `packages/business/lead-detail/lead-detail` | `31-lead-detail.jpg` |
| [ ] | S02 | 首次预约：地址与可用时段 | `packages/business/appointment-booking/appointment-booking` | `32-appointment-booking.jpg` |
| [ ] | S03 | 测量员不可用时间编辑 | `packages/business/measurer-unavailability/measurer-unavailability` | `33-measurer-unavailability.jpg` |
| [ ] | S04 | 预约冲突/版本过期/无可用时段 | `appointment-detail` / `appointment-booking` | `34-appointment-conflict.jpg` |
| [ ] | S05 | 预约取消、完成、地址补录 | `packages/business/appointment-detail/appointment-detail` | `35-appointment-action-states.jpg` |
| [ ] | S06 | 正式量房编辑器 | `packages/surveying/editor/surveying-editor` | `36-surveying-editor.jpg` |

## 6. 待生成：AI 方案生产与交付

| 勾选 | 编号 | 页面 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [ ] | D01 | 设计工作台 / AI 入口 | `pages/ai-design/ai-design` | `37-ai-design-workbench.jpg` |
| [ ] | D02 | 创建方案 | `packages/ai-workflow/create/ai-design-create` | `38-ai-design-create.jpg` |
| [ ] | D03 | 方案说明 | `packages/ai-workflow/recipe-detail/recipe-detail` | `39-ai-recipe-detail.jpg` |
| [ ] | D04 | 选择项目与量房资格 | `packages/ai-workflow/recipe-project/recipe-project` | `40-ai-recipe-project.jpg` |
| [ ] | D05 | 生成前确认 | `packages/ai-workflow/recipe-confirm/recipe-confirm` | `41-ai-recipe-confirm.jpg` |
| [ ] | D06 | 生成中、失败、结果交付 | `packages/ai-workflow/result/ai-design-result` | `42-ai-design-result-states.jpg` |
| [ ] | D07 | 历史任务 | `packages/ai-workflow/history/ai-design-history` | `43-ai-design-history.jpg` |

## 7. 每个页面至少需要补的状态稿

角色外壳设计合同要求每个实际运行路由考虑以下状态；不要只生成一张“有数据首页”：

- 首次进入/稳定加载
- 有真实数据
- 空状态
- 请求失败/可重试
- 无权限或越权深链
- 登录失效
- 当前身份被撤权
- 身份切换失败
- 无其他可用身份

优先补状态的页面：`free-design-service`、`identity-recovery`、`enterprise-appointments`、
`customer-projects`、`referrer-progress`、`referrer-earnings`、`appointment-booking`、
`measurer-unavailability`。

## 8. 推荐生成顺序

1. **P0 获客闭环**：P01–P09。
2. **角色落点**：R01–R08，先补企业负责人，再补客户项目索引和推荐人进度/收益。
3. **身份恢复**：R09–R13。
4. **预约与量房**：S01–S06。
5. **AI 方案链路**：D01–D07。
6. **最后补异常/空/加载状态**，并用同一页面编号追加状态后缀，例如 `32-appointment-booking-empty.jpg`。

## 9. 现有旧设计源（不是 Airy 新稿）

以下页面已有旧批准设计或文字设计源，但当前不在 Airy Minimalist v1 目录中：

- 推荐服务码、客户领取、预约、线索详情、不可用时间：
  `design-references/referrer-network-appointment-v1/`
- 账号设置、身份体系：`design-references/account/`
- AI 方案：`design-references/ai-design/`、`design-references/all-pages-ip-v3/`
- 正式量房：`design-references/surveying/`
- 五角色外壳、恢复状态、安全区：`docs/miniprogram-role-shell-design-v1.zh-CN.md`

因此，“待生成”表示“尚未有 Airy Minimalist v1 新稿”，不表示该页面完全没有任何旧设计源。

## 10. 依据

- [推荐人网络与预约量房闭环开发计划（中文）](./referrer-network-appointment-development-plan.zh-CN.md)
- [小程序五角色信息架构与角色外壳设计源 v1（中文）](./miniprogram-role-shell-design-v1.zh-CN.md)
- [小程序设计还原台账（中文）](./miniprogram-design-restoration-ledger.zh-CN.md)
- [Airy Minimalist v1 设计归档](../design-references/miniprogram-airy-minimalist-v1/README.md)
