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
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/cursor-guide-state-reference-20260812.jpg` | Canvas 引导和光标状态由聚焦测试覆盖；原生胶囊截图待补 | 是 |

## 记录规则

- 使用 `miniprogram/app.json` 的标准路由作为唯一键。
- 记录设计映射和一条简短当前视觉核验结论。
- 截图、指标和测试日志放在本地证据目录，不放入 canonical 台账。
- 视觉还原变化时同步更新中英文台账。

English mirror: [miniprogram-design-restoration-ledger.md](./miniprogram-design-restoration-ledger.md)
