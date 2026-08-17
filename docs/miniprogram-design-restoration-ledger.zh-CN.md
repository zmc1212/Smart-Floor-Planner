# 小程序设计还原台账

本文是当前路由与设计源的唯一查询表。每个运行路由只保留一行，每行只保留一份
最新批准设计源；设计源或生产状态变化时直接替换，不追加还原历史。

| 运行路由 | 最新设计源 | 当前视觉核验 | 已还原 |
| --- | --- | --- | :---: |
| `pages/index/index` | `design-references/all-pages-ip-v1/01-home-v2.png` | 已有还原；下次视觉变更时刷新路由证据 | 是 |
| `packages/business/lead-detail/lead-detail` | `design-references/all-pages-ip-v3/08-lead-detail-v3.png` | 客户、获客、签约和正式量房状态已实现；剩余原生胶囊截图核验 | 是 |
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

## 记录规则

- 使用 `miniprogram/app.json` 的标准路由作为唯一键。
- 记录设计映射和一条简短当前视觉核验结论。
- 截图、指标和测试日志放在本地证据目录，不放入 canonical 台账。
- 视觉还原变化时同步更新中英文台账。

English mirror: [miniprogram-design-restoration-ledger.md](./miniprogram-design-restoration-ledger.md)
