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
| `packages/business/settings/settings` | `design-references/account/settings-v1.png` | 获批的通知单行布局、间距、图标和层级保持不变；原有尾部状态现按四个 V2 模板统一显示“全部允许、部分允许、已拒绝、已关闭、未设置或配置暂不可用”，设置页与聚合授权静态测试已通过。仍需在现有微信开发者工具窗口重新编译、确认顶层路由，并补充带原生胶囊的 `390x844` 截图。 | 是 | 2026-08-12 |
| `pages/ai-design/ai-design` | `design-references/ai-design/ai-design-customer-project-switcher-v3/ai-design-customer-workbench-home-v2.png` | 项目抽屉保留获批构图，非成果项目卡改用明确的 PNG 项目档案引导封面，不再渲染原始墙图；仅“待完善量房”保留简化实时户型图。Hero 无成果时恢复获批的 `generated-hero-bleed-v2.png`，真实全屋成果仍优先进入轮播。静态素材/布局断言已通过；现有开发者工具窗口未开放自动化端点，带原生胶囊截图仍待补。 | 是 | 2026-08-12 |
| `packages/ai-workflow/create/ai-design-create` | `design-references/all-pages-ip-v3/14-ai-design-create-v3.png` | 已有还原；HTML 证据仅为可选历史记录 | 是 | 2026-08-11 |
| `packages/ai-workflow/result/ai-design-result` | `design-references/all-pages-ip-v3/15-ai-design-result-v3.png` | 已有还原；HTML 证据仅为可选历史记录 | 是 | 2026-08-11 |
| `packages/ai-workflow/history/ai-design-history` | `design-references/all-pages-ip-v3/16-ai-design-history-v3.png` | 已有还原；HTML 证据仅为可选历史记录 | 是 | 2026-08-11 |
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/bottom-dock-v1/sub2api-20260812-073043-1.png` | 底部光标控制坞以获批三态状态板为准：已放置时保留“重置光标”；重置后准星保留在控件位置作为拖拽起点，“光标拖动到墙体”移到独立辅助文案；拖动中起点淡化，既有 Canvas 准星继续随手指进入画布。同一获批左上角放大镜会同时覆盖底部控件放置光标与 Canvas 内从光标拖出墙体；画布平移、双指缩放和门窗移动不显示放大镜。墙体外边或外边顶点吸附后，静态光标保持在同一可见外边目标，墙图拓扑仍以中心线为准。删除恰好由两个闭合空间共同引用的唯一共用墙时，现有获批 Canvas 切换为一个合并后的填充、标签、永久尺寸和净面积；外墙面起测场景还会只清除被删共墙端点处失效的墙厚内缩，保留全部未选中外围墙及其门窗原位并恢复连续墙体，不再留下顶部/底部缺口。内边相邻闭合时，闭合墙合并保留共享墙实体并补画所选净边界，使上下墙可见端点继续落在房间1内边顶点；用户提供的 `2205 × 2901mm` 加 `2834 × 2901mm` 状态及删除上墙后下墙显示稳定性均已回归。布局、样式、图标和导航均不改变；正式渲染、共用墙合并、外墙面缺口、外墙删除和放大镜状态定向回归均通过。现有 DevTools 自动化端点不可用，仍需在既有窗口编译、核对路由，并补 iPhone 13 Pro `390x844` 真机证据。 | 是 | 2026-08-12 |
