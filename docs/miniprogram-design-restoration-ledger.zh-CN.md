# 小程序设计还原台账

本文档是跨对话查询小程序视觉还原状态的唯一台账。修改任何可见的小程序界面前，必须先读取本文件。

## 记录规则

- 使用 `miniprogram/app.json` 中的标准运行路由作为唯一键，每条路由只保留一行当前记录。
- “最后设计稿”只记录一个当前已批准设计文件；新设计源直接替换旧条目，不保留历史行。
- 记录设计源映射和路由级视觉验收状态。HTML 原型和相似度评分在 HTML-first 门禁暂停期间仅作为可选的历史证据。
- 只有生产 WXML/WXSS/JS 或小程序包内素材实际完成修改后，才能把“小程序已还原”标记为“是”。
- 视觉还原变化时，同步更新本文件及英文镜像。

## 当前台账

| 小程序路由 | 最后设计稿 | 视觉验收状态 | 小程序已还原 | 更新时间 |
| --- | --- | --- | :---: | --- |
| `pages/index/index` | `design-references/all-pages-ip-v1/01-home-v2.png` | 已有还原；下次视觉变更时补充路由级证据 | 是 | 2026-08-06 |
| `pages/ai-design/ai-design` | `design-references/ai-design/ai-design-customer-project-switcher-v3/ai-design-customer-workbench-home-v2.png` | 项目抽屉保留获批构图，非成果项目卡改用明确的 PNG 项目档案引导封面，不再渲染原始墙图；仅“待完善量房”保留简化实时户型图。Hero 无成果时恢复获批的 `generated-hero-bleed-v2.png`，真实全屋成果仍优先进入轮播。静态素材/布局断言已通过；现有开发者工具窗口未开放自动化端点，带原生胶囊截图仍待补。 | 是 | 2026-08-12 |
| `packages/ai-workflow/create/ai-design-create` | `design-references/all-pages-ip-v3/14-ai-design-create-v3.png` | 已有还原；HTML 证据仅为可选历史记录 | 是 | 2026-08-11 |
| `packages/ai-workflow/result/ai-design-result` | `design-references/all-pages-ip-v3/15-ai-design-result-v3.png` | 已有还原；HTML 证据仅为可选历史记录 | 是 | 2026-08-11 |
| `packages/ai-workflow/history/ai-design-history` | `design-references/all-pages-ip-v3/16-ai-design-history-v3.png` | 已有还原；HTML 证据仅为可选历史记录 | 是 | 2026-08-11 |
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/runtime-live-dimension-reference-20260812.jpg` | 已有 Canvas 还原；闭合房间外边吸附仍保持新墙实体对齐，但光标、预览和十字线统一落在实际拖出的黑色工作线，避免平行线分离。定向源码/状态断言已通过；仍需按要求在微信开发者工具和真机验证。 | 是 | 2026-08-12 |
