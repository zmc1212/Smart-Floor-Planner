# Codex 项目指令（中文版）

本文档是 `AGENTS.md` 的中文伴随文件。每次修改项目指令、后台反馈规则或小程序编辑器量房功能清单时，必须在同一次任务中同步更新本文档，并保持章节名称、编号、文件路径和行为说明一致。

## Git 提交信息

当 Codex 被要求在本仓库创建 git commit 时，必须使用 Conventional Commit 风格的提交标题。

必需流程：

1. 使用以下前缀之一：`feat:`、`fix:`、`refactor:`、`docs:`、`chore:` 或 `test:`。
2. 前缀后写简洁的英文标题。
3. 使用祈使句或行动导向表达。
4. 标题只描述本次提交包含的改动，不要提及无关的脏工作区改动。
5. 如果已暂存改动包含多个互不相关的目的，先暂停并询问是否拆分提交，不要自行编造宽泛标题。

## 后台操作反馈

所有由管理员操作触发、用户可见的后台操作，都必须通过共享的操作反馈 UI 显示统一的成功或失败通知。

- 不要把原生 `alert()` 作为正常反馈机制。
- 危险操作可以保留原生确认弹窗，但用户确认后，操作结果仍必须显示成功或失败通知。
- 详情弹窗或确认后会关闭的流程，也必须在操作完成后显示结果通知。
- 静默轮询和自动后台同步任务不需要 toast 类通知，除非它们是用户明确触发的。

## Admin UI 组件库

`admin` 前端必须统一使用共享的 shadcn/ui 组件体系。

- 使用 Radix 作为共享 primitive 底层；不要再为后台 UI primitive 引入 Base UI。
- 可复用控件应优先沉淀到 `admin/src/components/ui/*`，再在业务页面中复用。
- 业务页面应优先使用共享的 `Button`、`Input`、`Textarea`、`Select`、`Table`、`Dialog`、`Sheet`、`AlertDialog`、`Badge`、`Card`、`Tabs`、`DropdownMenu`、`Separator` 和 `Skeleton` 组件。
- 不要把原生 `alert()` 作为后台常规反馈；用户可见的后台操作结果必须继续使用 `operation-feedback`。
- 不要在业务页面大面积使用硬编码颜色和任意圆角。优先使用 Tailwind/shadcn 语义 token，例如 `background`、`card`、`muted`、`border`、`primary` 和 `destructive`。
- 如果必须新增特殊视觉样式，先判断它是否应该沉淀为共享组件或 variant。

## 中文文档同步

维护 `AGENTS.zh-CN.md` 作为 `AGENTS.md` 的中文伴随文件。每次修改项目指令、后台反馈规则或小程序编辑器量房功能清单时，必须在同一次任务中更新 `AGENTS.zh-CN.md`，并保持章节名称、编号、文件路径和行为说明同步。

其他成对项目文档也按同样规则维护。尤其是修改 `docs/admin-system-modules.md` 时，必须在同一次任务中同步更新 `docs/admin-system-modules.zh-CN.md`。

## 小程序编辑器量房功能清单

修改 `miniprogram/pages/editor/editor.*` 下的量房体验时，先识别下面哪些已完成模块会受到影响，并明确告知用户。每次新增、移除或改变量房功能行为时，都要同步更新这份清单。

新版测绘原型说明：

- 新版测绘工作台从 `miniprogram/pages/surveying-editor/` 开始落地，并在 `docs/surveying-module/` 下维护文档。它是并行原型外壳，不替代 `miniprogram/pages/editor/`。
- 暴露原型的业务入口必须保持清晰双入口：`旧版测量` 继续进入 `miniprogram/pages/editor/editor`，`新版测绘体验` 进入 `miniprogram/pages/surveying-editor/surveying-editor`。
- 原型阶段的 `surveying-editor` 可以保存服务端草稿，但 payload 必须明确标记为原型数据（`measurementMode: 'surveying_prototype'`、`prototypeOnly: true`），并将原始墙图放在 `surveyDraft`。不得覆盖旧草稿、提交测量审计日志、进入 CAD/报告/3D 下游兼容流程，也不得把原型数据当作正式户型输出。
- 原型草稿可以关联到线索，并在后台线索和户型详情页只读展示，便于运营查看小程序墙图数据。该可见性不代表数据已经成为正式户型，prototype 记录必须继续禁用 CAD/报告/3D 操作。
- 仅新增或调整原型入口，本身不改变下方旧版已完成测量模块。若触及共享 BLE、正式保存、导出/报告、3D、测量日志或 `editor.*`，必须识别并更新受影响的已完成模块。

主要文件：

- 页面编排：`miniprogram/pages/editor/editor.js`、`editor.wxml`、`editor.json`、`editor.wxss`。
- 量房 UI 组件：`miniprogram/components/measure-modal`、`angle-measure`、`opening-measure`、`guided-banner`、`ble-connector`、`bottom-bar`。
- 画布和属性组件：`miniprogram/components/canvas`、`miniprogram/components/properties`。
- 几何和设备工具：`miniprogram/utils/openingGeometry.js`、`wholeHomeGeometry.js`、`bluetooth.js`、`util.js`、`exportService.js`。
- 测量日志后端：`admin/src/app/api/measurements/route.ts`、`admin/src/models/Measurement.ts`。

已完成测量模块：

1. 引导测量恢复/启动：`editor.onShow` 恢复旧版房间布局和 v2 全屋布局，包括 `measurementMode`、`homeOutline`、`partitions`、`guidedMode`、`currentGuidedRoomId`、`measurePoints`、`guidedEdgeIndex`、`pendingDirection`，并根据设备状态打开量房弹窗或 BLE 连接器。
2. BLE 连接流程：`ble-connector` 支持记忆设备自动连接和新设备搜索；`editor._bindBluetoothCallbacks` 恢复测量/连接/断开回调；`bottom-bar` 在已连接时提供重新连接入口。
3. 激光指令生命周期：测量使用 `ATK001#` 打开/触发设备，超时后回退发送 `ATD001#` 查询；实时读取前使用 `bluetooth.clearBuffer()`；`editor.onBluetoothMeasure` 会过滤短时间重复读数。
4. 层高测量：引导模式下 `guidedEdgeIndex === -1` 表示第一次读数是高度。房间模式保存到 `room.height3D`；全屋模式保存为全屋高度和 `homeOutline.height3D`；两者都会以 `height` 类型上报，然后进入墙体测量。
5. 直墙测量：`measure-modal` 会根据 `pendingDirection` 或上一方向自动推荐下一方向，并将手动方向选择（`E`、`S`、`W`、`N`）折叠到覆盖入口；边数足够后仍可进入斜角测量。`editor.onBluetoothMeasure` 将米转换为内部几何单位 `meters * 10`，追加到 `measurePoints`，更新房间多边形或 `homeOutline` 预览，设置 `canFinishPolygon`，上报 `length` 类型，并重新适配画布。
6. 异形/斜角墙测量：边数足够后，`measure-modal` 可启动 `angle-measure`。斜角流程临时接管 BLE 回调，测量墙 A、墙 B 和对角线，用 `util.calculateAngle` 计算角度，将计算出的边追加到当前房间或全屋外轮廓，并上报 `angle` 类型。
7. 轮廓闭合和重测：`guided-banner` 会显示推荐的下一测量步骤，并在 `canFinishPolygon` 为 true 时可完成测量轮廓。房间模式闭合房间多边形。全屋模式要求最终点在 `0.20m` 内闭合，自动吸附并保存 `homeOutline`，生成初始 `rooms`，切换到分区/编辑阶段。`onStartRemeasure` 会根据 `measurementMode` 重置当前房间或全屋骨架。
8. 画布测量可视化：`floor-canvas` 渲染测量多边形、全屋外轮廓、内墙分区线、当前/最新测量边、闪烁测量状态、虚线闭合预览、下一方向箭头、尺寸标签、面积标签、平移/缩放、房间拖拽、边命中测试和适配视图。
9. 手动房间、形状和分区支持：工具栏可以插入预设形状、手绘房间和全屋内墙分区线；`properties` 中房间宽高编辑使用同一内部单位约定（`meters * 10`）。
10. 门窗墙体选择：在 `DOOR` 或 `WINDOW` 模式下，画布通过 `openingGeometry.findNearestWall` 找到最近墙体；存在当前引导房间时会限制到该房间。全屋模式下，门窗放置目标是外轮廓闭合后生成的房间。画布通过 `openingwallselect` 发出墙体、点位、偏移和参考方向。
11. 门窗手动放置兜底：如果 BLE 未连接，`editor.addManualOpening` 会在点击的墙体点位放置默认宽度开口，标记 `source: 'manual'`，让用户先添加、后续再补测。
12. 门窗 BLE 精确测量：`opening-measure` 临时接管 BLE 回调，测量从所选墙体起点/终点到洞口起边的偏移，再测量洞口宽度；校验偏移 + 宽度不超过墙长，显示墙体预览，并把结果返回给 `editor.onOpeningMeasureConfirm`。
13. 门窗几何持久化：`openingGeometry.buildOpeningFromMeasurement` 保存开口 id、类型、本地 x/y、墙体快照、参考端、测量偏移、中心偏移、宽度、默认高度、来源、角度/旋转和时间戳。它同时支持矩形墙体和多边形墙体。
14. 门窗管理：`properties` 列出开口，支持触摸高亮、宽高编辑、删除，以及“补测”；补测会用原开口 id 重新打开 BLE 门窗测量流程。
15. 测量审计日志：`editor.reportMeasurement` 将 BLE 读数提交到 `/measurements`，包含户型、房间、设备、数值、单位、类型、方向、来源、元数据和时间戳。全屋读数会附加 `measurementMode`、`stage`、`homeOutlineId` 或 `partitionId` 等元数据。后端按租户保存 `length`、`height`、`angle`、`opening_offset`、`opening_width` 记录。
16. 草稿/云端持久化：`onSaveDraft` 和 `saveToCloudInternal('draft')` 保存旧版房间草稿和 v2 全屋草稿，包含 `version`、`measurementMode`、`rooms`、`homeOutline`、`partitions` 和草稿状态（`stage`、`measurePoints`、`guidedEdgeIndex`、`currentGuidedRoomId`、`pendingDirection`、`lastMeasuredDirection`、`activePartitionId`）；完成保存会同步完整测量布局。
17. 导出/报告集成：`exportService.generateDXF` 接受旧版房间数组和 v2 布局对象，将全屋外墙、内墙分区、房间墙体和开口导出到 CAD 图层；技术/报告流程消费已测房间、多边形、开口、`homeOutline` 和 `partitions`。
18. 3D 预览集成：`editor` 可以切换到 Three.js 预览，使用已测房间尺寸、多边形/门窗和 `height3D`；全屋模式可从 `homeOutline` 和 `partitions` 生成的房间回退预览。
19. 全屋骨架测量入口：`lead-detail` 优先提供“开始/继续全屋测量”，创建或升级户型图为 v2 `measurementMode: 'whole_home'`，并将房间卡片视为自动生成/可编辑结果，而不是主要测量入口。

维护说明：

- 内部几何约定是 `1 米 = 10 单位`；UI 输入和设备读数以米为单位，保存到房间/门窗几何前要乘以 10，显示标签时再除以 10。
- 全屋布局必须保留 `layoutData.rooms` 以兼容下游，并将全屋数据存到 `layoutData.homeOutline` 和 `layoutData.partitions`。
- `angle-measure` 和 `opening-measure` 在关闭或组件卸载时，必须恢复正常 BLE 测量回调。
- 不要绕过 `openingGeometry` 放置门窗；墙体投影、校验、序列化和角度处理都集中在这里。
- `editor.js` 目前存在 `onBluetoothDisconnect` 和 `onEdgeSelect` 的对象字面量重复方法名；JavaScript 会保留后面的定义。编辑这两个流程时，要合并并确认重复定义，不要假设两个都会执行。
- 量房行为改动后，必须更新本清单，并在回复用户时说明受影响的已完成模块。
