# 小程序设计还原台账

本文是当前路由与设计源的唯一查询表。每个运行路由只保留一行，每行只保留一份
最新批准设计源；设计源或生产状态变化时直接替换，不追加还原历史。

| 运行路由 | 最新设计源 | 当前视觉核验 | 已还原 |
| --- | --- | --- | :---: |
| `pages/index/index` | `design-references/all-pages-ip-v1/01-home-v2.png` | 已有还原；下次视觉变更时刷新路由证据 | 是 |
| `packages/business/lead-detail/lead-detail` | `design-references/referrer-network-appointment-v1/phase-5-lead-detail-appointment-entry-v1.png` | 已增加负责设计师在无有效预约时进入首次预约的入口；真实微信开发者工具 iPhone 12/13 Pro `390x844` 模拟器已确认加载态入口、顶层路由和含原生胶囊的整窗截图 | 是 |
| `packages/business/settings/settings` | `design-references/account/settings-v1.png` | 当前通知权限状态已实现；剩余原生胶囊截图核验 | 是 |
| `pages/ai-design/ai-design` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前方案发现、项目选择和真实任务状态已实现；剩余原生胶囊截图核验 | 是 |
| `packages/ai-workflow/create/ai-design-create` | `design-references/all-pages-ip-v3/14-ai-design-create-v3.png` | 已有还原 | 是 |
| `packages/ai-workflow/recipe-detail/recipe-detail` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前方案说明和输入合同已实现；原生截图待补 | 是 |
| `packages/ai-workflow/recipe-project/recipe-project` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前项目和正式量房资格状态已实现；原生截图待补 | 是 |
| `packages/ai-workflow/recipe-confirm/recipe-confirm` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前确认和来源选择状态已实现；原生截图待补 | 是 |
| `packages/ai-workflow/result/ai-design-result` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前生成、失败和交付状态已实现；原生截图待补 | 是 |
| `packages/ai-workflow/history/ai-design-history` | `design-references/ai-design/ai-recipe-discovery-home-v2/ai-recipe-discovery-home-v2.png` | 当前任务筛选和真实任务卡片已实现；原生截图待补 | 是 |
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/cursor-guide-state-reference-20260812.jpg` | Canvas 引导、光标状态及右侧工具栏经确认的清空重做操作由聚焦测试覆盖；原生胶囊截图待补 | 是 |
| `packages/business/promotion-service-code/promotion-service-code` | `design-references/referrer-network-appointment-v1/selected-option-a.png` | 方案 A 左屏结构已实现，使用受保护微信小程序码、匿名文案和胶囊安全区；Antigravity 按批准设计与 F1/F3 参考生成的小 K 透明 PNG 已接入且未切割整张设计稿。真实微信开发者工具在 iPhone 12/13 Pro `390x844` 模拟器中确认顶层路由、元素边界，并完成包含原生胶囊的整窗加载态截图 | 是 |
| `packages/business/free-design-service/free-design-service` | `design-references/referrer-network-appointment-v1/selected-option-a.png` | 方案 A 中/右屏已实现，包含令牌解析、手机号授权、幂等领取、设计师资料交付和待派单兜底；服务、流程与隐私图标已从 Antigravity 生成画板独立提取为透明 PNG。真实微信开发者工具在 `390x844` 模拟器中确认授权态与成功态顶层路由和元素边界，主按钮为 346px 全内容宽，并完成包含原生胶囊的整窗截图 | 是 |
| `packages/business/referrer-workbench/referrer-workbench` | `design-references/referrer-network-appointment-v1/phase-5-referrer-workbench-v1.png` | Antigravity 生成的推荐人内部工作台设计已按活动企业选择、受保护服务码入口、退出确认与历史归属提示落地；独立的服务码引导小 K 透明 PNG 打包为 `assets/referrer-workbench-v1/service-code-guide.png`（114KB）；真实微信开发者工具 iPhone 12/13 Pro `390x844` 模拟器已确认加载态、顶层路由和含原生胶囊的整窗截图 | 是 |
| `packages/business/customer-project/customer-project` | `design-references/referrer-network-appointment-v1/phase-5-appointment-calendar-v1.png` | 客户预约卡已实现；第 6 阶段仅将既有“服务信息”两行改为读取客户本人项目聚合返回的真实设计师/测量员，卡片结构、操作和胶囊安全区未变。原有真实微信开发者工具 iPhone 12/13 Pro `390x844` 模拟器加载态、顶层路由及含原生胶囊整窗截图仍对应此结构；本次数据绑定由 Mini Program 自动化测试覆盖 | 是 |
| `packages/business/appointment-reschedule/appointment-reschedule` | `design-references/referrer-network-appointment-v1/phase-5-appointment-calendar-v1.png` | 客户可用时段与改期 CTA 已实现；真实微信开发者工具 iPhone 12/13 Pro `390x844` 模拟器已确认 366px 通栏 CTA（12px 左右边距）、顶层路由和含原生胶囊的整窗截图 | 是 |
| `packages/business/appointment-booking/appointment-booking` | `design-references/referrer-network-appointment-v1/phase-5-designer-appointment-booking-v1.png` | 负责设计师可录入地址、选择服务端返回的真实可用时段并创建首次预约；Antigravity 独立生成的预约协调小 K 透明 PNG 已打包为 `assets/appointment-booking-v1/schedule-guide.png`（126KB）；真实微信开发者工具 iPhone 12/13 Pro `390x844` 模拟器已确认 CSS 返回箭头、362px 通栏 CTA（14px 左右边距）、顶层路由和含原生胶囊的整窗截图 | 是 |
| `packages/business/measurer-calendar/measurer-calendar` | `design-references/referrer-network-appointment-v1/phase-5-appointment-calendar-v1.png` | 测量员日程已实现；真实微信开发者工具 iPhone 12/13 Pro `390x844` 模拟器已确认加载态、顶层路由和含原生胶囊的整窗截图 | 是 |
| `packages/business/measurer-unavailability/measurer-unavailability` | `design-references/referrer-network-appointment-v1/phase-5-measurer-unavailability-editor-v1.png` | Antigravity 依据预约日历和 F1/F3 参考生成的不可用时间编辑器已按原生日期/时段选择、备注、保存与删除合同落地；真实微信开发者工具在 iPhone 12/13 Pro `390x844` 模拟器中确认顶层路由与含原生胶囊的全窗不可用时间编辑态 | 是 |

## 记录规则

- 使用 `miniprogram/app.json` 的标准路由作为唯一键。
- 记录设计映射和一条简短当前视觉核验结论。
- 截图、指标和测试日志放在本地证据目录，不放入 canonical 台账。
- 视觉还原变化时同步更新中英文台账。

English mirror: [miniprogram-design-restoration-ledger.md](./miniprogram-design-restoration-ledger.md)
