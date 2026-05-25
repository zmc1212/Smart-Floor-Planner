# Codex 项目指令（中文版）

本文件是 `AGENTS.md` 的中文版同步文件。每次修改项目指令、后台操作反馈规则，或 `miniprogram/pages/editor/editor.*` 量房功能清单时，必须在同一次任务中同步更新本文件，并保持章节、编号、文件路径和行为说明一致。

## Git 提交信息

当 Codex 被要求在本仓库创建 git commit 时，必须使用 Conventional Commit 风格的提交标题。

必需流程：

1. 使用以下前缀之一：`feat:`、`fix:`、`refactor:`、`docs:`、`chore:` 或 `test:`。
2. 前缀后写简洁的英文标题。
3. 使用祈使句或行动导向的表达。
4. 标题只描述本次提交包含的改动，不要提及无关的脏工作区改动。
5. 如果已暂存改动包含多个互不相关的目的，先暂停并询问是否拆分提交，不要自行编造宽泛标题。

## 后台操作反馈

所有由管理员操作触发、用户可见的后台操作，都必须通过共享的操作反馈 UI 显示统一的成功或失败通知。

- 不要把原生 `alert()` 作为正常反馈机制。
- 危险操作可以保留原生确认弹窗，但用户确认后，操作结果仍必须显示成功或失败通知。
- 详情弹窗或确认后会关闭的流程，也必须在操作完成后显示结果通知。
- 静默轮询和自动后台同步任务不需要 toast 类通知，除非它们是用户明确触发的。

## 中文版同步约定

`AGENTS.zh-CN.md` 是 `AGENTS.md` 的中文版伴随文件。每次修改项目指令、后台反馈规则或小程序编辑器量房功能清单时，必须在同一次任务中更新 `AGENTS.zh-CN.md`，并保持章节名称、编号、文件路径和行为说明同步。

## 小程序编辑器量房功能清单

修改 `miniprogram/pages/editor/editor.*` 下的量房体验时，先识别下面哪些已完成模块会受到影响，并明确告诉用户。每次新增、移除或改变量房功能行为时，都要同步更新这份清单。

主要文件：

- 页面编排：`miniprogram/pages/editor/editor.js`、`editor.wxml`、`editor.json`、`editor.wxss`。
- 量房 UI 组件：`miniprogram/components/measure-modal`、`angle-measure`、`opening-measure`、`guided-banner`、`ble-connector`、`bottom-bar`。
- 画布和属性组件：`miniprogram/components/canvas`、`miniprogram/components/properties`。
- 几何和设备工具：`miniprogram/utils/openingGeometry.js`、`bluetooth.js`、`util.js`、`exportService.js`。
- 测量日志后端：`admin/src/app/api/measurements/route.ts`、`admin/src/models/Measurement.ts`。

已完成测量模块：

1. 引导量房恢复/启动：`editor.onShow` 恢复户型布局数据和草稿状态，跟踪 `guidedMode`、`currentGuidedRoomId`、`measurePoints`、`guidedEdgeIndex`、`pendingDirection`，并根据设备状态打开量房弹窗或 BLE 连接器。
2. BLE 连接流程：`ble-connector` 支持记忆设备自动连接和新设备搜索；`editor._bindBluetoothCallbacks` 恢复测量/连接/断开回调；`bottom-bar` 在已连接时提供重新连接入口。
3. 激光指令生命周期：测量使用 `ATK001#` 打开/触发设备，超时后回退发送 `ATD001#` 查询；实时读取前使用 `bluetooth.clearBuffer()`；`editor.onBluetoothMeasure` 会过滤短时间重复读数。
4. 层高测量：引导模式下 `guidedEdgeIndex === -1` 表示第一次读数是房间层高。结果保存到 `room.height3D`，以 `height` 类型上报，然后流程进入第一面墙方向。
5. 直墙测量：`measure-modal` 根据上一次方向提供 `E`、`S`、`W`、`N` 方向选择。`editor.onBluetoothMeasure` 将米转换为内部几何单位 `meters * 10`，追加到 `measurePoints`，更新房间多边形包围盒，设置 `canFinishPolygon`，上报 `length` 类型，并重新适配画布。
6. 异形/斜角墙测量：边数足够后，`measure-modal` 可启动 `angle-measure`。斜角流程临时接管 BLE 回调，测量墙 A、墙 B 和对角线，用 `util.calculateAngle` 计算角度，追加计算出的边，并上报 `angle` 类型。
7. 轮廓闭合和重测：`guided-banner` 在 `canFinishPolygon` 为 true 时可完成测量轮廓。`editor.onFinishPolygon` 归一化点位、闭合多边形、标记房间 `measured: true`、退出引导模式，并保持测量房间选中。`onStartRemeasure` 会重置当前引导房间，但不清空其他房间。
8. 画布测量可视化：`floor-canvas` 渲染测量多边形、当前/最新测量边、闪烁测量状态、虚线闭合预览、下一方向箭头、尺寸标注、面积标注、平移/缩放、房间拖拽、边命中测试和适配视图。
9. 手动房间和形状支持：工具栏可以插入预设形状和手绘房间；`properties` 中房间宽高编辑使用同一内部单位约定（`meters * 10`）。
10. 门窗墙体选择：在 `DOOR` 或 `WINDOW` 模式下，画布通过 `openingGeometry.findNearestWall` 找到最近墙体；存在当前引导房间时会限制到该房间，并通过 `openingwallselect` 发出墙体、点位、偏移和参考方向。
11. 门窗手动放置兜底：如果 BLE 未连接，`editor.addManualOpening` 会在点击的墙体点位放置默认宽度开口，标记 `source: 'manual'`，让用户先添加、后续再补测。
12. 门窗 BLE 精确测量：`opening-measure` 临时接管 BLE 回调，测量从所选墙体起点/终点到洞口起边的偏移，再测量洞口宽度；校验偏移 + 宽度不超过墙长，显示墙体预览，并把结果返回给 `editor.onOpeningMeasureConfirm`。
13. 门窗几何持久化：`openingGeometry.buildOpeningFromMeasurement` 保存开口 id、类型、本地 x/y、墙体快照、参考端、测量偏移、中心偏移、宽度、默认高度、来源、角度/旋转和时间戳。它同时支持矩形墙体和多边形墙体。
14. 门窗管理：`properties` 列出开口，支持触摸高亮、宽高编辑、删除，以及“补测”；补测会用原开口 id 重新打开 BLE 门窗测量流程。
15. 测量审计日志：`editor.reportMeasurement` 将 BLE 读数提交到 `/measurements`，包含户型、房间、设备、数值、单位、类型、方向、来源、元数据和时间戳。后端按租户保存 `length`、`height`、`angle`、`opening_offset`、`opening_width` 记录。
16. 草稿/云端持久化：`onSaveDraft` 和 `saveToCloudInternal('draft')` 保存房间和草稿状态（`measurePoints`、`guidedEdgeIndex`、`currentGuidedRoomId`、`pendingDirection`、`lastMeasuredDirection`）；完成保存会同步完整测量布局。
17. 导出/报告集成：`exportService.generateDXF` 将墙体和开口分别导出到独立图层；技术报告流程消费已测量房间、多边形和门窗数据。
18. 3D 预览集成：`editor` 可以切换到 Three.js 预览，使用已测量的房间尺寸、多边形/门窗和 `height3D`。

维护说明：

- 内部几何约定是 `1 米 = 10 单位`；UI 输入和设备读数以米为单位，保存到房间/门窗几何前要乘以 10，显示标签时再除以 10。
- `angle-measure` 和 `opening-measure` 在关闭或组件卸载时，必须恢复正常 BLE 测量回调。
- 不要绕过 `openingGeometry` 放置门窗；墙体投影、校验、序列化和角度处理都集中在这里。
- `editor.js` 目前存在 `onBluetoothDisconnect` 和 `onEdgeSelect` 的对象字面量重复方法名；JavaScript 会保留后面的定义。编辑这两个流程时，要合并并确认重复定义，不要假设两个都会执行。
- 量房行为改动后，必须更新本清单，并在回复用户时说明受影响的已完成模块。
