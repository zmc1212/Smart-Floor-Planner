# 小程序设计还原台账

本文是当前路由与设计源的唯一查询表。每个运行路由只保留一行，每行只保留一份
最新批准设计源；设计源或生产状态变化时直接替换，不追加还原历史。

| 运行路由 | 最新设计源 | 当前视觉核验 | 已还原 |
| --- | --- | --- | :---: |
| `pages/index/index` | `docs/miniprogram-role-shell-design-v1.zh-CN.md` | 客户继续沿用已批准首页设计源；当前签名设计师、测量员和企业负责人改为呈现只读取服务端范围数据的角色工作台，并复用批准的独立小 K 资产 `miniprogram/images/page-ip-v3/mine.png`。冷启动时先使用本地已签名身份渲染 Tab 与页面，等待 bootstrap 刷新；角色工作台宿主补充满高合同，避免空白页。聚焦导航测试通过；各角色登录态 `390x844` 准确路由与包含原生胶囊的宿主整窗截图待补 | 否 |
| `pages/mine/mine` | `docs/miniprogram-role-shell-design-v1.zh-CN.md` | 客户和员工“我的”状态继续沿用已批准的账号/工作台壳层。运行时胶囊安全区导航独占顶部纵向空间，资料卡改为跟随导航正常流排布并保留间距；“我的”、编辑资料和设置不再与资料卡共用定位区域。聚焦布局回归测试覆盖几何和遮挡边界。登录态 `390x844` 原生胶囊宿主截图待补 | 否 |
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
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/cursor-guide-state-reference-20260812.jpg` | 「合」画在 Canvas 上并跟随平移/缩放。拖光标/拖墙时改画到按动画帧节流的叠加层，正式画布不再每帧 fillText，并卸掉原生 cover-view 热区以免卡住。120px 光标放大镜将吸附文案与坐标分行；右侧工具栏清空与其他工具同构且仅显示「清空」；聚焦测试覆盖这些控件状态，原生胶囊截图待补 | 是 |
| `packages/business/promotion-service-code/promotion-service-code` | `design-references/referrer-network-appointment-v1/selected-option-a.png` | 方案 A 左屏结构已实现，使用受保护微信小程序码、匿名文案和胶囊安全区；Antigravity 按批准设计与 F1/F3 参考生成的小 K 透明 PNG 已接入且未切割整张设计稿。真实微信开发者工具在 iPhone 12/13 Pro `390x844` 模拟器中确认顶层路由、元素边界，并完成包含原生胶囊的整窗加载态截图 | 是 |
| `packages/business/free-design-service/free-design-service` | `design-references/referrer-network-appointment-v1/selected-option-a.png` | 方案 A 中/右屏已实现，包含令牌解析、手机号授权、幂等领取、设计师资料交付和待派单兜底；服务、流程与隐私图标已从 Antigravity 生成画板独立提取为透明 PNG。真实微信开发者工具在 `390x844` 模拟器中确认授权态与成功态顶层路由和元素边界，主按钮为 346px 全内容宽，并完成包含原生胶囊的整窗截图 | 是 |
| `packages/business/onboarding/onboarding` | 用户确认直接按 `miniprogram/DESIGN.md`、`design-tokens.json`、`app.less` 和 `docs/design/jiakelai-brand-ip-guidelines.md` 扩展；入驻引导复用既有独立透明 `referral-service-v1/thumbs-up-xiao-k.png` | 员工/推荐人扫码落地页已实现胶囊安全自定义导航、真实码类型及目标企业解析并在既有欢迎区显示、员工岗位选择、手机号授权、入驻身份切换及换码/停用/失效后的真实恢复提示。合同测试已通过；微信开发者工具 `390x844` 顶层路由与宿主整窗截图待补 | 否 |
| `packages/business/onboarding-debug/onboarding-debug` | 仅开发版扩展入驻页已确认的 `miniprogram/DESIGN.md`、`design-tokens.json` 与 `app.less` 语言；不设单独的生产设计源 | 仅开发版可用。原生扫码器选择本地小程序码，仅接受入驻目标路径，随后进入正常的服务端校验、手机号授权和身份写入流程；非开发版锁定该路由 | 否 |
| `packages/business/referrer-workbench/referrer-workbench` | `design-references/referrer-network-appointment-v1/phase-5-referrer-workbench-v1.png`；用户明确授权第 13 阶段按现有小程序绿色规范扩展 | 活动企业选择会先交换签名成员关系上下文并刷新会话；受保护服务码、退出确认、历史归属提示与账号操作保持原设计。当前企业卡下新增原生“服务进度”和“我的收益”入口，只进入服务端当前签名成员关系的只读脱敏聚合，不改变推广主操作。已在微信开发者工具 iPhone 12/13 Pro `390x844` 核验工作台路由、企业卡、服务码动作、进度/收益入口和底部安全区；修复双入口按钮窄屏溢出 | 是 |
| `packages/business/referrer-progress/referrer-progress` | 用户明确授权第 13 阶段按 `miniprogram/DESIGN.md`、`design-tokens.json`、`app.less` 及现有绿色工作台语言直接开发 | 当前成员关系的企业名称、脱敏客户标识、服务阶段与更新时间；加载、重试与无数据状态均不暴露手机号、精确地址、户型 graph、内部预约原因或设计文件。已在微信开发者工具 `390x844` 核验加载态和胶囊安全区，空态/错误态保持同一布局合同 | 是 |
| `packages/business/referrer-earnings/referrer-earnings` | 用户明确授权第 13 阶段按 `miniprogram/DESIGN.md`、`design-tokens.json`、`app.less` 及现有绿色工作台语言直接开发 | 当前成员关系下仅展示本人的待支付/已支付汇总及单条金额、支付状态；加载、重试与无数据状态已实现。已在微信开发者工具 `390x844` 核验收益汇总、空态 CTA 和胶囊安全区 | 是 |
| `packages/business/customer-projects/customer-projects` | 用户明确授权第 13 阶段按 `miniprogram/DESIGN.md`、`design-tokens.json`、`app.less` 及现有绿色工作台语言直接开发 | 客户“项目”入口只列出当前 JWT 客户本人未归档项目的中立“免费设计服务”名称、阶段摘要和更新时间，并进入既有已批准的项目服务册。该索引是客户 Tab 目标，已挂载共享自定义 TabBar 并预留底部安全区；项目服务档案仍是无 TabBar 的深层路由。该客户页面有意不展示企业品牌。加载、重试与无数据状态已实现；合同测试覆盖隐私文案和 TabBar 合同。已在微信开发者工具 `390x844` 核验加载态、错误态容器和空态回访 CTA | 是 |
| `packages/business/customer-project/customer-project` | `design-references/referrer-network-appointment-v1/phase-6-customer-project-v1.png` | 已按批准的第 6 阶段服务册设计实现：展示仅客户本人读取的真实服务事实、正式户型摘要和主动发布方案，并使用“免费设计/免费量房”中立文案，不展示企业品牌。受保护方案图片先以认证字节写入小程序本地临时文件再预览；页面没有客户量房编辑或 graph 编辑入口。第 13 阶段索引只使用其既有入口，不改变页面结构；小程序合同测试覆盖数据绑定、本地图片边界和品牌隐私；真实微信开发者工具已在 iPhone 12/13 Pro `390x844` 确认精确顶层路由，并保存应用层截图及含原生胶囊的整窗截图 | 是 |
| `packages/business/appointment-detail/appointment-detail` | `design-references/referrer-network-appointment-v1/phase-5-designer-appointment-booking-v1.png` | 已按批准的预约体系扩展为服务调度单，复用准确的独立预约小 K 资产，展示真实状态/地址/时间及按岗位限制的改期、取消、完成动作；新鲜编译后已在 `390x844` 截图核验准确路由与缺少上下文时的可恢复应用层状态，登录态动作和原生宿主胶囊截图待补 | 是 |
| `packages/business/appointment-reschedule/appointment-reschedule` | `design-references/referrer-network-appointment-v1/phase-5-appointment-calendar-v1.png` | 客户与内部人员复用同一可用时段选择器；内部模式保留选填审计原因。主按钮禁用态现复用共享 `--action-disabled-bg` token，并保持白字可读。既有客户 CTA 的 `390x844` 核验仍有效，内部状态截图待刷新 | 是 |
| `packages/business/appointment-booking/appointment-booking` | `design-references/referrer-network-appointment-v1/phase-5-designer-appointment-booking-v1.png` | 负责设计师可录入地址、选择服务端返回的真实可用时段并创建首次预约；Antigravity 独立生成的预约协调小 K 透明 PNG 已打包为 `assets/appointment-booking-v1/schedule-guide.png`（126KB）；真实微信开发者工具 iPhone 12/13 Pro `390x844` 模拟器已确认 CSS 返回箭头、362px 通栏 CTA（14px 左右边距）、顶层路由和含原生胶囊的整窗截图 | 是 |
| `packages/business/measurer-calendar/measurer-calendar` | `design-references/referrer-network-appointment-v1/phase-5-appointment-calendar-v1.png` | 测量员日程卡现在可进入真实预约详情；既有加载态已在 `390x844` 核验，当前交互提示待刷新截图 | 是 |
| `packages/business/measurer-unavailability/measurer-unavailability` | `design-references/referrer-network-appointment-v1/phase-5-measurer-unavailability-editor-v1.png` | Antigravity 依据预约日历和 F1/F3 参考生成的不可用时间编辑器已按原生日期/时段选择、备注、保存与删除合同落地；真实微信开发者工具在 iPhone 12/13 Pro `390x844` 模拟器中确认顶层路由与含原生胶囊的全窗不可用时间编辑态 | 是 |

## 记录规则

- 使用 `miniprogram/app.json` 的标准路由作为唯一键。
- 记录设计映射和一条简短当前视觉核验结论。
- 截图、指标和测试日志放在本地证据目录，不放入 canonical 台账。
- 视觉还原变化时同步更新中英文台账。

English mirror: [miniprogram-design-restoration-ledger.md](./miniprogram-design-restoration-ledger.md)
