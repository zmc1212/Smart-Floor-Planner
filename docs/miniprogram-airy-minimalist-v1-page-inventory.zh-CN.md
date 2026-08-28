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

### 生成与归档硬门槛（后续设计稿必须遵守）

下列规则是本清单中所有新稿的**前置条件**，优先级高于视觉参考、生成模型的默认补全和
“看起来更完整”的设计判断：

1. **先写页面合同，后生成图片。** 每个编号在生成前都必须有一份页面合同，至少记录：
   `route`、对应 `WXML/JS/API` 真源、一个且仅一个 `state`、锁定文案、可见数据、禁止数据、
   可执行动作、导航模式、Logo 位置和参考设计源。合同缺项时不得生成。
2. **一个文件只表达一个互斥运行状态。** 例如“有数据”“加载中”“空状态”“请求失败”必须
   以不同文件表达；不得在同一画面同时出现列表和“正在读取”、空状态和数据卡、无权限和可操作按钮。
3. **文字以运行时源为准。** 页面标题、说明、按钮、状态语、字段名和隐私提示必须逐项来自
   当前 `WXML/JS/API` 或已有批准设计源。动态值写为 `{{字段}}` 或明确的脱敏示例；不得为了
   画面完整而补写标题、服务承诺、日期规则、充值、签约、权限说明或业务阶段。
4. **导航必须逐路由核实。** 只有运行页面已挂载 `custom-tab-bar` 或当前角色导航明确包含该路由
   时，才绘制底部 TabBar；标签、顺序和选中态必须与当前身份一致。深层页默认无 TabBar，不能借用首页导航。
5. **数据与权限按最小可见范围绘制。** 不显示接口没有返回的字段，不把另一个角色的按钮移到当前页面。
   推荐人只可见脱敏客户标识、服务阶段/更新时间或本人收益；客户、设计师、测量员、企业负责人均按
   当前路由的服务端能力白名单处理。
6. **Logo 必须后置合成。** 生成提示只能要求为 Logo 留出空白位置；导出前必须将
   `miniprogram/images/home-ip-v1/brand-logo.png` 直接合成到该位置。生成模型画出的任何 Logo 即判不通过。
7. **禁止凭视觉推导新能力。** 不得新增“充值”“服务须知”“新增客户”“重新派单”“快捷筛选”、
   额外项目资料、虚构户型风格或未接通的操作。现有数据的视觉表达可调整，但不能改变含义或引入新状态机。
8. **先验收，后落定。** 生成后逐项复核文字、路由、状态、导航、权限、数据边界和正式 Logo；任一项
   不通过，该图只能保留为临时草稿，不能写入 `design-references/`、不能勾选本清单，也不能替换还原台账。

页面合同统一采用以下格式，并与生成提示一并提供给出图工具：

```text
编号：
route / 身份：
真源：WXML / JS / API / 已批准设计源
本文件状态：有数据 | 加载 | 空 | 失败 | 无权限 | 登录失效（只能选一项）
锁定文案：
允许数据：
禁止数据：
允许动作：
导航：无 | [角色 Tab 标签及选中项]
Logo：预留位置，导出时合成 brand-logo.png
```

### 导航与状态总表

生成前先按此表锁定导航；如 WXML、页面 JSON 或能力白名单与表格不一致，以当前代码为准并先更新合同，
不得猜测。

| 身份/页面族 | 允许的 TabBar | 深层页面规则 |
| --- | --- | --- |
| 客户 | `服务 / 我的` | `customer-project`、`customer-ai-schemes`、预约详情、首次预约和改期均无 TabBar；`customer-projects` 仅为旧深链重定向壳（不再作产品列表）；服务首屏直达档案，「免费效果图」进入交付方案册 `customer-ai-schemes`，列表 API 供给排序/切换；已发布方案册经服务首屏权益卡、线索详情与项目档案深链进入 |
| 推荐人 | `推广 / 进度 / 收益 / 我的` | `referrer-progress` 与 `referrer-earnings` 挂载当前推荐人 TabBar；不得显示客户/员工导航 |
| 设计师 | `工作台 / 客户 / 设计 / 收益 / 我的` | 资料、设置、账号安全、AI 工作流子页均为深层页，无 TabBar；`staff-earnings` 挂载当前设计师 TabBar |
| 测量员 | `工作台 / 客户 / 收益 / 我的` | 不可用时间、预约详情和正式量房编辑器均为深层页；“客户”Tab 用于查看已量房完成客户与统计入口；`staff-earnings` 挂载当前测量员 TabBar |
| 企业负责人 | `经营 / 客户 / 预约 / 提成 / 我的` | `enterprise-appointments` 是“预约”Tab；`enterprise-commissions` 是“提成”发放台账 Tab；线索详情、预约详情和资料页均无 TabBar |
| 身份恢复/切换 | 无 | 身份列表、恢复、资料编辑、设置、账号安全均不得套用任一角色的底部导航 |

## 2. 已有 Airy Minimalist 新稿

| 编号 | 页面 | 运行路由 | 当前文件 | 备注 |
| --- | --- | --- | --- | --- |
| A01 | 客户服务首页 / 工作台 | `pages/index/index`（客户） | `01-customer-workbench.jpg` | 客户主场景；早期阶段以 `docs/superpowers/specs/2026-08-21-customer-service-home-stage-companion-design.md` 为准（小 K 阶段陪伴），不强制空双缩略图 01 |
| A02 | 客户项目服务档案 | `packages/business/customer-project/customer-project` | `02-customer-project-archive.jpg` | 项目详情，不是项目索引 |
| A03 | 预约详情 | `packages/business/appointment-detail/appointment-detail` | `03-appointment-reschedule.jpg` + `docs/superpowers/specs/2026-08-21-appointment-detail-inline-reschedule-design.md` | 详情内嵌改期日历；员工次要动作分区 |
| A04 | 预约改期（兼容壳） | `packages/business/appointment-reschedule/appointment-reschedule` | 同上 | 深链 `redirectTo` 详情；无独立 UI |
| A05 | 设计师工作台 | `pages/index/index`（设计师） | `04b-designer-workbench-dashboard.jpg` | 含「我的」经营大盘五卡；旧基线 `04-designer-workbench.jpg` 仍可对照 |
| A06 | 测量员工作台 | `pages/index/index`（测量员） | `05b-measurer-workbench-dashboard.jpg` | 含「我的」经营大盘五卡；旧基线 `05-measurer-workbench.jpg` 仍可对照 |
| A07 | 推荐人工作台 | `packages/business/referrer-workbench/referrer-workbench` | `06b-promoter-workbench-signed-count.jpg` | Hero 增加已签约数量位；不上完整经营大盘 |
| A08 | 测量员量房日程 | `packages/business/measurer-calendar/measurer-calendar` | `07-measurer-calendar.jpg` | 含不可用时间入口，但不含编辑器 |

## 3. 待生成：推荐网络与获客链路（最高优先级）

这些页面直接决定“出示服务码 → 客户领取服务 → 自动派单”的闭环。

| 勾选 | 编号 | 页面/状态 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [x] | P01 | 服务码展示模板（推荐人 / 员工共用） | `packages/business/promotion-service-code/promotion-service-code` | `09-promotion-service-code.jpg` |
| [x] | P02 | 扫码后确认领取服务（历史对照稿；生产链路已跳过） | `packages/business/free-design-service/free-design-service` | `10-free-design-confirm.jpg` |
| [x] | P03 | 手机号授权（扫码落地态） | `packages/business/free-design-service/free-design-service` | `11-free-design-phone-auth.jpg` |
| [x] | P04 | 授权成功、已分配设计师 | `packages/business/free-design-service/free-design-service` | `12-free-design-success.jpg` |
| [x] | P05 | 已领取但暂未分配设计师 | `packages/business/free-design-service/free-design-service` | `13-free-design-assignment-pending.jpg` |
| [x] | P06 | 客户已有未关闭服务归属 | `packages/business/free-design-service/free-design-service` | `14-free-design-existing-attribution.jpg` |
| [x] | P07 | 员工活动码展示（复用 P01 模板） | `packages/business/staff-activity-code/staff-activity-code` | `09-promotion-service-code.jpg` |
| [x] | P08 | 员工/推荐人扫码入驻 | `packages/business/onboarding/onboarding` | `16-onboarding.jpg` |
| [x] | P09 | 入驻失效、停用、换码恢复 | `packages/business/onboarding/onboarding` | `17-onboarding-recovery.jpg` |

`onboarding-debug` 仅开发版使用，不建议单独投入高保真设计；如需调试稿，可命名为
`debug-onboarding-scanner.jpg`，并明确标注“开发版”。

> 生产扫码解析成功后直接进入同一路由的 P03 手机号授权态（跳过 P02 确认领取）；微信 `getPhoneNumber` 发生在 P03。
> P03 不展示装修公司名称（推荐推广码与员工活动码落地均不展示）。
> 授权完成后进入 P04（已匹配）、P05（匹配中）或 P06（已有进行中服务）之一。

> P07 复用 P01 的服务码展示结构（顶部品牌锁、服务码主卡、三项承诺和出示/分享操作）；
> 仅按员工活动码的真实数据替换企业名称，不另起一套版式或交互。

## 4. 待生成：五角色信息架构与工作台

### 4.1 角色工作区

| 勾选 | 编号 | 页面 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [x] | R01 | 企业负责人经营工作台 | `pages/index/index`（企业负责人） | `18b-enterprise-ops-dashboard-period.jpg`（自定义 sheet `18c`；旧基线 `18` 可对照） |
| [x] | R02 | 企业负责人客户列表 | `pages/leads-management/leads-management`（企业负责人） | `19-enterprise-customer-list.jpg` |
| [x] | R03 | 企业负责人预约列表 | `packages/business/enterprise-appointments/enterprise-appointments` | `20-enterprise-appointments.jpg` |
| [x] | — | 企业负责人提成发放 | `packages/business/enterprise-commissions/enterprise-commissions` | 无独立设计稿；复用 `referrer-earnings` 第 13 阶段语言，数据对齐后台 `/lead-commissions` 三张金额卡 |
| [x] | R04 | 客户项目索引（已退役为深链重定向壳） | `packages/business/customer-projects/customer-projects` | `21-customer-project-index.jpg`（产品列表 UI 已退役；首屏阶段陪伴承接排序/切换） |
| [x] | R05 | 推荐人服务进度 | `packages/business/referrer-progress/referrer-progress` | `22-referrer-progress.jpg` |
| [x] | R06 | 推荐人收益 | `packages/business/referrer-earnings/referrer-earnings` | `23-referrer-earnings.jpg` |
| [x] | R07 | 设计师客户列表 | `pages/leads-management/leads-management`（设计师） | `24-designer-customer-list.jpg` |
| [x] | R08 | “我的”与当前身份 | `pages/mine/mine` | `25-account-mine.jpg` |

### 4.2 身份、资料与恢复

| 勾选 | 编号 | 页面/状态 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [x] | R09 | 身份切换列表 | `packages/business/identity-switch/identity-switch` | `26-identity-switch.jpg` |
| [x] | R10 | 登录失效/身份撤权恢复 | `packages/business/identity-recovery/identity-recovery` | `27-identity-recovery.jpg` |
| [x] | R11 | 设计师资料编辑（微信号、二维码） | `packages/business/profile-edit/profile-edit` | `28-profile-edit.jpg` |
| [x] | R12 | 设置与通知状态 | `packages/business/settings/settings` | `29-settings.jpg` |
| [x] | R13 | 账号安全 | `packages/business/account-security/account-security` | `30-account-security.jpg` |

## 5. 待生成：预约、量房与交接

| 勾选 | 编号 | 页面 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [x] | S01 | 线索详情与首次预约入口 | `packages/business/lead-detail/lead-detail` | `31-lead-detail.jpg` |
| [x] | S02 | 首次预约：地址与可用时段 | `packages/business/appointment-booking/appointment-booking` | `32-appointment-booking.jpg` |
| [x] | S03 | 测量员不可用时间编辑 | `packages/business/measurer-unavailability/measurer-unavailability` | `33-measurer-unavailability.jpg` |
| [x] | S04 | 预约冲突/版本过期/无可用时段 | `appointment-detail` / `appointment-booking` | `34-appointment-conflict.jpg` |
| [x] | S05 | 预约取消、完成、地址补录 | `packages/business/appointment-detail/appointment-detail` | `35-appointment-action-states.jpg` |
| [x] | S06 | 正式量房编辑器 | `packages/surveying/editor/surveying-editor` | `36-surveying-editor.jpg` |

## 6. 待生成：AI 方案生产与交付

| 勾选 | 编号 | 页面 | 运行路由 | 建议文件名 |
| :---: | --- | --- | --- | --- |
| [x] | D01 | 设计工作台 / AI 入口 | `pages/ai-design/ai-design` | `37-ai-design-workbench.jpg` |
| [x] | D02 | 创建方案 | `packages/ai-workflow/create/ai-design-create` | `38-ai-design-create.jpg` |
| [x] | D03 | 方案说明 | `packages/ai-workflow/recipe-detail/recipe-detail` | `39-ai-recipe-detail.jpg` |
| [x] | D04 | 选择项目与量房资格 | `packages/ai-workflow/recipe-project/recipe-project` | `40-ai-recipe-project.jpg` |
| [x] | D05 | 生成前确认 | `packages/ai-workflow/recipe-confirm/recipe-confirm` | `41-ai-recipe-confirm.jpg` |
| [x] | D06 | 生成中、失败、结果交付 | `packages/ai-workflow/result/ai-design-result` | `42-ai-design-result-states.jpg` |
| [x] | D07 | 历史任务 | `packages/ai-workflow/history/ai-design-history` | `43-ai-design-history.jpg` |
| [x] | D08 | 客户 AI 方案册（纯展示时间轴） | `packages/business/customer-ai-schemes/customer-ai-schemes` | `44-customer-ai-scheme-timeline.jpg` |
| [x] | D09 | 设计师 AI 方案工作台 | `packages/ai-workflow/scheme-studio/scheme-studio` | `45-ai-scheme-studio.jpg`、`45b-ai-scheme-studio-templates.jpg` |

## 7. 剩余页面的锁定合同

以下内容是每次出图提示必须携带的最小页面合同；它不授权增加运行时功能。没有列出的字段、按钮、
状态或导航一律视为禁止项。

| 编号 | 锁定合同 |
| --- | --- |
| R01 | 企业负责人 `pages/index/index` 的**有数据异常台 + 可筛选经营大盘**。标题、副标题、三项摘要和异常条目直接使用 `GET /api/miniprogram/workbench` 的 `title`、`subtitle`、`summary`、`primaryItems`；只表达待派失败、过期未重约和人员缺口（人员缺口「查看详情」与「人员负荷」进入 `enterprise-staff` 只读名册+暂停/恢复派单；不做建账或改微信/二维码）。Hero 保留实心「出示入驻码」进入 `enterprise-join-codes` 出示并管理后台员工/推荐人双码（生成/换新/停用），并增加描边「出示活动码」进入 `staff-activity-code` 分享拉客。经营大盘为只读五卡 KPI（新增线索/已完成量房/方案交付率/已签约/签单率），支持周期 chips 与自定义 sheet；允许展示签约金额 detail。允许企业负责人 TabBar，不得绘制签约改状态等未接通动作（签约事实只作 KPI，首页不做改状态）。 |
| R02 | 企业负责人客户 Tab 的**有数据列表**。只使用当前线索列表真实字段和现有搜索/进入详情动作；“新增客户”仅企业负责人可见且只能出现一次。不得加入户型风格、项目面积、收费、分派或列表接口未返回的客户资料。 |
| R03 | 企业负责人“预约”Tab 的**有数据列表**。页面壳复用工作台真实 `title/subtitle`，列表区只显示接口返回的 `confirmed` 与 `expired` 预约项及现有进入预约详情动作；TabBar 为 `经营/客户/预约/我的`，选中“预约”。 |
| R04 | 客户项目索引**产品列表已退役**。运行时 `customer-projects` 仅为深链重定向壳（排序后进 `customer-project` 或回落「服务」Tab）。多项目切换与排序由服务首屏阶段陪伴承接；历史稿 `21-customer-project-index.jpg` 不再作为生产列表 UI 源。 |
| R05 | 推荐人服务进度的**有数据状态**。锁定标题“当前企业的服务事实”和隐私说明；单项只能有脱敏客户标识、`stage.label`、按代码格式化的“`M月D日更新`”。禁止相对时间、客户项目名、地址、面积、电话、内部原因，以及自行补出的三段或多段进度条。 |
| R06 | 推荐人收益的**有数据状态**。只显示当前成员关系的待支付/已支付汇总、脱敏客户标识、金额和支付状态；不得出现项目名、面积、成交日期、客户联系方式或收益以外的服务事实。TabBar 为 `推广/进度/收益/我的`，选中“收益”。 |
| R07 | 设计师客户 Tab 的**有数据列表**。只显示当前已授权客户及既有进入详情动作；不得显示“新增客户”、企业经营统计、他人客户或负责人操作。TabBar 为 `工作台/客户/设计/我的`，选中“客户”。 |
| R08 | `pages/mine/mine` 的**有数据身份态**。资料、账号与安全入口按当前身份显示；“切换身份”只在服务端返回多个可用身份时出现。不得套用其他角色 TabBar，必须使用当前身份的真实 Tab 标签。 |
| R09 | 身份切换的单一状态稿。只能在“正在读取可用身份”“身份列表”“读取失败”“单一身份提示”中选择一项；列表项只含当前接口的身份名称、企业/角色说明和当前/处理中状态。无 TabBar，不得把加载文案与身份列表同屏。 |
| R10 | 身份恢复的单一失效原因稿。主标题和说明直接取 `identity-recovery.js` 的 `RECOVERY_COPY`；固定卡片文案为“不会展示失效身份的数据 / 重新登录后，只会显示服务端确认仍有效的身份。”，唯一动作是“重新登录”。无 TabBar。 |
| R11 | 设计师资料编辑的**有数据状态**。可编辑的仅为头像、昵称、设计师微信号和个人微信二维码；所属企业、当前角色、绑定手机必须只读。无 TabBar，禁止增加名片、审核或其他资料能力。 |
| R12 | 设置的**有数据状态**。仅保留订阅任务通知、微信权限管理、当前身份、账号与安全、退出当前账号；当前身份说明来自运行时，不能用静态角色或“待跟进”等业务状态代替。无 TabBar。 |
| R13 | 账号安全的**有数据状态**。显示登录账号、账号角色、绑定手机；仅当 `canChangePassword` 为真才展示当前密码、新密码、确认新密码和“至少 6 位”提示，否则只展示微信手机号授权说明。无 TabBar。 |
| S01 | 线索详情的**首次预约可用状态**。只使用当前已授权角色可见的线索、正式户型摘要和首次预约入口；不得补出装修风格、收费、未授权量房工具或底部 TabBar。 |
| S02 | 首次预约的**可提交状态**。地址、可用日期/时段、时长、步长和最远可预约范围都来自服务端可用性接口；不得用本地虚构日期、测量员或预约结果替代。无 TabBar。 |
| S03 | 测量员不可用时间的**有数据编辑状态**。只表达当前不可用时段和既有新增/删除动作；不得出现企业负责人导航、预约结果或其他人员的日程。无 TabBar。 |
| S04 | 预约冲突的**单一错误状态**。每张图只表现版本过期、无可用时段或冲突中的一种，并使用实际错误恢复动作；不得和预约表单、成功结果或 TabBar 同屏。 |
| S05 | 预约详情的**单一动作状态**。取消、完成量房、地址补录/修改分别按真实角色和状态绘制；完成量房必须保留“正式 v4 户型且至少一个闭合空间”的服务端前提，不得把未完成量房画成可完成。无 TabBar。 |
| S06 | 正式量房编辑器的**已保存墙图编辑状态**。唯一来源是 `packages/surveying/editor/surveying-editor.*` 与 `design-references/surveying/`；仅使用现有工具、毫米墙图、门窗和保存状态。不得新增旧编辑器、房间填充、非正式数据格式或假设性 AI 操作。 |
| D01 | 设计师“设计”Tab 的**有数据入口状态**。仅呈现现有 AI 设计入口、当前已授权项目/客户范围和已有任务入口；企业负责人、测量员的替代态按当前代码处理，不能套用设计师 TabBar。设计师 TabBar 为 `工作台/客户/设计/我的`。 |
| D02 | 创建方案的**输入已就绪状态**。只呈现当前 WXML 已接通的输入来源、配方/空间选择和创建动作；禁止“充值”“服务须知”、虚构额度、未实现上传类型或未接通的审核步骤。无 TabBar。 |
| D03 | 配方说明的**有数据状态**。标题、封面、适用空间、步骤与配方数据均来自当前详情载荷；未选择项目时不得写入具体小区、面积、户型或客户资料。无 TabBar。 |
| D04 | 选择项目与量房资格的**有数据状态**。必须同时忠实表达当前支持的输入/量房资格分支；不得把“有正式户型”当成所有项目都满足，也不得给未完成量房的项目开放生成。无 TabBar。 |
| D05 | 生成前确认的**可提交状态**。仅汇总已选项目、空间、配方和当前实际消耗/确认信息；禁止添加付款、审批、签约或接口不存在的前置条件。无 TabBar。 |
| D06 | 生成中、失败、结果交付分别产出独立文件。结果页仅使用真实任务状态、生成结果、发布/撤回权限和既有动作；不得在一个文件混合转圈、失败提示和成功交付。无 TabBar。 |
| D07 | 历史任务的**有数据列表**。只展示当前用户/授权范围内的真实任务摘要、状态、时间和现有进入结果动作；不得将其他客户任务、消费明细或批量管理能力加入页面。无 TabBar。 |
| D08 | 客户 AI 方案册的**多轮已发布有数据主态**。只读：自定义导航「客户 AI 方案」、客户摘要 Hero、横向方案轮次 chips、当前轮主预览、当前轮交付时间轴、底部返回与（客户）保存/分享（生产实现为品牌海报存相册后分享图片，不转发小程序页）。方案轮次与图片来自已发布 `publishedSchemes`/`groupPublishedSchemes`（轮次按首次对客户可见时间固定，后续更新不重排）；点击预览走 `wx.previewImage`。禁止生成、发布/撤回、材质微调、导出方案包及任何 AI 工作台编辑入口。无 TabBar。单轮/空态/图片不可读为后续状态稿。 |
| D09 | 设计师 `scheme-studio`：方案 chips/项目卡/轮次时间线；底部悬浮 AI dock 默认收缩，聚焦展开（`45c`/`45d`）；滚动留白 + 渐变 scrim 避免挡住方案与白底粘连。模板 sheet：分类/搜索/先放大再使用。无 TabBar。 |

## 8. 每个页面至少需要补的状态稿

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

## 9. 推荐生成顺序

1. **P0 获客闭环**：P01–P09。
2. **角色落点**：R01–R08，先补企业负责人，再补客户项目索引和推荐人进度/收益。
3. **身份恢复**：R09–R13。
4. **预约与量房**：S01–S06。
5. **AI 方案链路**：D01–D09（D08 为客户侧只读方案册；D09 为设计师方案工作台）。
6. **最后补异常/空/加载状态**，并用同一页面编号追加状态后缀，例如 `32-appointment-booking-empty.jpg`。

## 10. 现有旧设计源（不是 Airy 新稿）

以下页面已有旧批准设计或文字设计源，但当前不在 Airy Minimalist v1 目录中：

- 推荐服务码、客户领取、预约、线索详情、不可用时间：
  `design-references/referrer-network-appointment-v1/`
- 账号设置、身份体系：`design-references/account/`
- AI 方案：`design-references/ai-design/`、`design-references/all-pages-ip-v3/`
- 正式量房：`design-references/surveying/`
- 五角色外壳、恢复状态、安全区：`docs/miniprogram-role-shell-design-v1.zh-CN.md`

因此，“待生成”表示“尚未有 Airy Minimalist v1 新稿”，不表示该页面完全没有任何旧设计源。

## 11. 依据

- [推荐人网络与预约量房闭环开发计划（中文）](./referrer-network-appointment-development-plan.zh-CN.md)
- [小程序五角色信息架构与角色外壳设计源 v1（中文）](./miniprogram-role-shell-design-v1.zh-CN.md)
- [小程序设计还原台账（中文）](./miniprogram-design-restoration-ledger.zh-CN.md)
- [Airy Minimalist v1 设计归档](../design-references/miniprogram-airy-minimalist-v1/README.md)
