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
| `packages/surveying/editor/surveying-editor` | `design-references/surveying/cursor-guide-state-reference-20260812.jpg` | 最新六态参考板规定辅助线语义：初始和首墙未确认时不显示蓝色虚线；继续拖墙时活动准星与预览墙跟手移动，蓝色十字留在上一确认点并只在提交后移动；自由拖放不生成橙线，墙面、顶点、轴向吸附和闭合路径只把真实受约束的轴或路径绘制为橙色虚线，且瞬态线在松手、取消、重置、撤销、重做或状态切换时清除。底部光标控制坞仍保留获批三态和独立辅助文案；画布平移、双指缩放和门窗移动不显示放大镜。左上角放大镜改为单一 Canvas 面板，不再叠加第二个原生背景容器。画布内拖动当前光标时，正式 Canvas 仍是唯一的光标/辅助线渲染者，瞬态层只提供同一获批放大镜；该放大镜跨正式画布重绘保持可见，并临时隐藏其后方竞争同一左上区域的实时测量气泡，镜心和 X/Y 标签始终采用正式预览/显示的最终吸附点，而非手指原始坐标。墙体外边或外边顶点吸附后，静态光标保持在同一可见外边目标，墙图拓扑仍以中心线为准。删除恰好由两个闭合空间共同引用的唯一共用墙时，现有获批 Canvas 继续切换为一个合并后的填充、标签、永久尺寸和净面积；外墙面起测场景只清除被删共墙端点处失效的墙厚内缩，保留全部未选中外围墙及其门窗原位并恢复连续墙体。内边相邻闭合仍保留共享墙实体并补画所选净边界。布局、光标标记、墙体、尺寸、工具栏、导航、API、角色、v4 墙图和测量审计均不改变；辅助线和既有正式渲染定向回归通过。既有开发者工具窗口已确认打开本仓库 `miniprogram`，日志记录了本轮渲染器/编辑器文件变更、app-service 重启和 `webview page ready`；但窗口未以 `autoPort` 启动，无法安全读取顶部页面栈，原生 iPhone 13 Pro `390x844` 状态截图仍待补验，本轮未启动重复窗口。 | 是 | 2026-08-12 |
