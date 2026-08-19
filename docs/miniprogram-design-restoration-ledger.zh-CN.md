# 小程序设计还原台账

本文是当前路由与设计源的唯一查询表。每个运行路由只保留一行，每行只保留一份
最新批准设计源；设计源或生产状态变化时直接替换，不追加还原历史。

| 运行路由 | 最新设计源 | 当前视觉核验 | 已还原 |
| --- | --- | --- | :---: |
| `pages/index/index` | `design-references/miniprogram-airy-minimalist-v1/01-customer-workbench.jpg`, `04-designer-workbench.jpg`, `05-measurer-workbench.jpg` | 客户服务首页与多角色工作台已按极简透气版设计规范 1:1 高保真还原：顶部原生胶囊避让品牌导航栏、活力家客绿 Hero 卡片、真实项目状态与 CAD/3D 效果图双缩略、2 列 3D 工具入口卡、交付方案大卡及底部信任背书。已签名测量员现落到此工作台，日程管理仍从工作台内入口进入。全部 471 项单元测试通过 | 是 |
| `pages/mine/mine` | `docs/miniprogram-role-shell-design-v1.zh-CN.md` | 客户、推广人和员工“我的”状态继续沿用已批准的账号/工作台壳层。运行时胶囊安全区导航独占顶部纵向空间，资料卡改为跟随导航正常流排布并保留间距；推广人状态现在绑定当前签名上下文的自设姓名和动态角色徽标，不改变既有构图。“我的”、编辑资料和设置不再与资料卡共用定位区域。身份绑定回归测试已覆盖；登录态 `390x844` 原生胶囊宿主截图待补 | 否 |
| `pages/leads-management/leads-management` | `docs/miniprogram-role-shell-design-v1.zh-CN.md` | 既有批准的设计师/企业负责人客户入口保留；当前签名测量员只呈现角色工作台中的本人已确认任务。冷启动先按本地已签名身份选择路由，避免客户/设计师先看到老板旧壳。聚焦导航测试通过；登录态 `390x844` 原生胶囊宿主截图待补 | 否 |
| `packages/business/lead-detail/lead-detail` | `design-references/referrer-network-appointment-v1/phase-5-lead-detail-appointment-entry-v1.png` | 上门量房与正式量房已按批准设计连续叠放并共用卡片边距，既有成交入口改到量房栈下方；重排后的首次预约态 `390x844` 宿主截图待补 | 是 |
| `packages/business/settings/settings` | `design-references/account/settings-v1.png` | 当前通知状态和服务端当前身份入口已实现；原生截图待刷新 | 是 |
| `packages/business/identity-switch/identity-switch` | `design-references/account/settings-v1.png` | 已按批准的账户体系扩展实现，复用既有权限管家小 K 资产，展示真实身份上下文、当前态、确认、加载、失败与单身份状态；新鲜编译后已在 `390x844` 核验准确路由与中文登录失效状态，登录态列表截图待补 | 是 |
| `pages/ai-design/ai-design` | `docs/miniprogram-role-shell-design-v1.zh-CN.md` | 既有批准的设计师 AI 工作流保留；当前签名测量员和企业负责人只呈现已派正式量房入口或当前租户已确认预约。聚焦导航测试通过；登录态 `390x844` 原生胶囊宿主截图待补 | 否 |
| `packages/ai-workflow/create/ai-design-create` | `design-references/all-pages-ip-v3/14-ai-design-create-v3.png` | 已有还原 | 是 |
| `packages/ai-workflow/recipe-detail/recipe-detail` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前方案说明和输入合同已实现；原生截图待补 | 是 |
| `packages/ai-workflow/recipe-project/recipe-project` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前项目和正式量房资格状态已实现；原生截图待补 | 是 |
| `packages/ai-workflow/recipe-confirm/recipe-confirm` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前确认和来源选择状态已实现；原生截图待补 | 是 |
| `packages/ai-workflow/result/ai-design-result` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前生成、失败、交付及真实客户发布控制已实现；原生截图待刷新 | 是 |
| `packages/ai-workflow/history/ai-design-history` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前任务筛选和真实任务卡片已实现；原生截图待补 | 是 |
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/cursor-guide-state-reference-20260812.jpg`；用户确认在该既有顶部栏上扩展 | 「合」画在 Canvas 上并跟随平移/缩放。拖光标/拖墙时改画到按动画帧节流的叠加层，正式画布不再每帧 fillText，并卸掉原生 cover-view 热区以免卡住。120px 光标放大镜将吸附文案与坐标分行；右侧工具栏清空与其他工具同构且仅显示「清空」。常驻 CAD chip 沿用顶部紧凑控件语言，置于保存后，仅在已加载云端户型完成时可用，并保持原生胶囊右侧安全区；聚焦测试覆盖控件状态，新的 `390x844` 原生胶囊截图待补 | 是 |
| `packages/business/staff-activity-code/staff-activity-code` | `design-references/referrer-network-appointment-v1/selected-option-a.png` | 沿用批准左屏服务码视觉语言，供设计师/测量员出示活动码；含受保护微信码、胶囊安全标题，并允许展示企业名称。登录态 `390x844` 原生胶囊宿主截图待补 | 否 |
| `packages/business/free-design-service/free-design-service` | `design-references/referrer-network-appointment-v1/selected-option-a.png` | 方案 A 中/右屏已实现，包含令牌解析、手机号授权、幂等领取、设计师资料交付和待派单兜底；服务、流程与隐私图标已从 Antigravity 生成画板独立提取为透明 PNG。同一路由现亦领取 `kind: staff_activity` 令牌，活动轨可展示服务企业名称。若该微信客户已有未关闭归属，resolve/授权返回 `existingAttribution`，页面复用已批准的“服务档案已建立”布局和查看服务档案入口，不再展示新领取成功页，也不泄露新扫码企业。真实微信开发者工具在 `390x844` 模拟器中确认推荐人链路授权态与成功态顶层路由和元素边界，主按钮为 346px 全内容宽，并完成包含原生胶囊的整窗截图；活动品牌态与已有归属态待补 | 是 |
| `packages/business/onboarding/onboarding` | 用户确认直接按 `miniprogram/DESIGN.md`、`design-tokens.json`、`app.less` 和 `docs/design/jiakelai-brand-ip-guidelines.md` 扩展；入驻引导复用既有独立透明 `referral-service-v1/thumbs-up-xiao-k.png` | 员工/推荐人扫码落地页已实现胶囊安全自定义导航、真实码类型及目标企业解析并在既有欢迎区显示、员工岗位选择、手机号授权、推荐人登录后设置姓名弹层、入驻身份切换及换码/停用/失效后的真实恢复提示。合同测试已通过；微信开发者工具 `390x844` 顶层路由与宿主整窗截图待补 | 否 |
| `packages/business/onboarding-debug/onboarding-debug` | 仅开发版扩展入驻页已确认的 `miniprogram/DESIGN.md`、`design-tokens.json` 与 `app.less` 语言；不设单独的生产设计源 | 仅开发版可用。原生扫码器选择本地小程序码，仅接受入驻目标路径，随后进入正常的服务端校验、手机号授权和身份写入流程；非开发版锁定该路由 | 否 |
| `packages/business/referrer-workbench/referrer-workbench` | `design-references/miniprogram-airy-minimalist-v1/06-promoter-workbench.jpg` | 已按极简透气版推广端工作台设计 1:1 高保真还原：顶部端标识与身份胶囊条、带 3 联数据指标与小 K 专属引导形象的绿色 Hero 卡、2 列快捷导航卡（服务进度与我的收益，带 3D 拟真切图）、当前推广企业横向切换条及专属权益卡、最新推广记录脱敏里程碑列表以及多身份账号操作。全部 471 项单元测试通过 | 是 |
| `packages/business/referrer-progress/referrer-progress` | 用户明确授权第 13 阶段按 `miniprogram/DESIGN.md`、`design-tokens.json`、`app.less` 及现有绿色工作台语言直接开发 | 当前成员关系的企业名称、脱敏客户标识、服务阶段与更新时间；加载、重试与无数据状态均不暴露手机号、精确地址、户型 graph、内部预约原因或设计文件。已在微信开发者工具 `390x844` 核验加载态和胶囊安全区，空态/错误态保持同一布局合同 | 是 |
| `packages/business/referrer-earnings/referrer-earnings` | 用户明确授权第 13 阶段按 `miniprogram/DESIGN.md`、`design-tokens.json`、`app.less` 及现有绿色工作台语言直接开发 | 当前成员关系下仅展示本人的待支付/已支付汇总及单条金额、支付状态；加载、重试与无数据状态已实现。已在微信开发者工具 `390x844` 核验收益汇总、空态 CTA 和胶囊安全区 | 是 |
| `packages/business/customer-projects/customer-projects` | 用户明确授权第 13 阶段按 `miniprogram/DESIGN.md`、`design-tokens.json`、`app.less` 及现有绿色工作台语言直接开发 | 客户“项目”入口只列出当前 JWT 客户本人未归档项目的中立“免费设计服务”名称、阶段摘要和更新时间，并进入既有已批准的项目服务册。该索引是客户 Tab 目标，已挂载共享自定义 TabBar 并预留底部安全区；项目服务档案仍是无 TabBar 的深层路由。该客户页面有意不展示企业品牌。加载、重试与无数据状态已实现；合同测试覆盖隐私文案和 TabBar 合同。已在微信开发者工具 `390x844` 核验加载态、错误态容器和空态回访 CTA | 是 |
| `packages/business/customer-project/customer-project` | `design-references/miniprogram-airy-minimalist-v1/02-customer-project-archive.jpg` | 已按极简透气版客户服务档案设计 1:1 高保真还原：带副标题及微信分享按钮的顶部自定义导航、完整时间轴及交付小 K 形象的绿色 Hero 卡、2 列专属设计师/测量师傅卡片、带高清预览浮层入口的 CAD 户型档案区、3D 方案交付大卡及吸底操作栏（微信联系设计师/保存分享方案）。全部测试通过 | 是 |
| `packages/business/appointment-detail/appointment-detail` | `design-references/miniprogram-airy-minimalist-v1/03-appointment-reschedule.jpg` | 已按极简透气版预约详情设计 1:1 高保真还原：顶部导航、带已确认待上门标签及预约协调小 K 的绿色 Hero 卡、预约时间/地址/测量员信息卡、角色提示、服务保障背书及全生命周期操作按钮。全部测试通过 | 是 |
| `packages/business/appointment-reschedule/appointment-reschedule` | `design-references/miniprogram-airy-minimalist-v1/03-appointment-reschedule.jpg` | 已按极简透气版改期日历设计 1:1 高保真还原：横向 5 日期选择条（高亮选中）、时段选择胶囊（带选中绿色描边与角标）、员工端选填原因、吸底确认改期按钮。全部测试通过 | 是 |
| `packages/business/appointment-booking/appointment-booking` | `design-references/referrer-network-appointment-v1/phase-5-designer-appointment-booking-v1.png` | 负责设计师可录入地址、选择服务端返回的真实可用时段并创建首次预约；Antigravity 独立生成的预约协调小 K 透明 PNG 已打包为 `assets/appointment-booking-v1/schedule-guide.png`（126KB）；真实微信开发者工具 iPhone 12/13 Pro `390x844` 模拟器已确认 CSS 返回箭头、362px 通栏 CTA（14px 左右边距）、顶层路由和含原生胶囊的整窗截图 | 是 |
| `packages/business/measurer-calendar/measurer-calendar` | `design-references/miniprogram-airy-minimalist-v1/07-measurer-calendar.jpg` | 已按极简透气版测量员量房日程设计 1:1 高保真还原：带胶囊安全区与月份切换的顶部导航、带排班统计与 3D 测量搭档小 K 的绿色 Hero 卡、7 日横向周历选择条（带任务小圆点指示）、结构化量房预约卡（支持直达量房编辑器、电话/导航快捷操作）、不可用时段快捷维护卡。全部 471 项单元测试通过 | 是 |
| `packages/business/measurer-unavailability/measurer-unavailability` | `design-references/referrer-network-appointment-v1/phase-5-measurer-unavailability-editor-v1.png` | Antigravity 依据预约日历和 F1/F3 参考生成的不可用时间编辑器已按原生日期/时段选择、备注、保存与删除合同落地；真实微信开发者工具在 iPhone 12/13 Pro `390x844` 模拟器中确认顶层路由与含原生胶囊的全窗不可用时间编辑态 | 是 |

## 记录规则

- 使用 `miniprogram/app.json` 的标准路由作为唯一键。
- 记录设计映射和一条简短当前视觉核验结论。
- 截图、指标和测试日志放在本地证据目录，不放入 canonical 台账。
- 视觉还原变化时同步更新中英文台账。

English mirror: [miniprogram-design-restoration-ledger.md](./miniprogram-design-restoration-ledger.md)
