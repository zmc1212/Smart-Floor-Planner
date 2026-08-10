# 原 ZHouse APK 参考与量房算法修复专题

> 用途：本文件保存旧 APK 的可验证事实、可复现实验和当前小程序的对照结论。它是后续量房算法排障的参考索引，不是旧客户端源码，也不改变正式量房的数据契约。

> English mirror: [legacy-zhouse-apk-reference.md](./legacy-zhouse-apk-reference.md)

## 参考包与分析边界

- 参考文件：仓库根目录的 `com.zbj.zhouse_26.7.16.apk`（仅本地分析，已 Git 忽略）。
- 包名：`com.zbj.zhouse`；版本：`26.7.16`；`versionCode`: `440`。
- SHA-256：`F3FAB584E8849A071B2C1D7D57A8AAAC7E5891D53F56933FF0E5434292C29AB1`。
- 已执行的方式：静态读取 APK 的清单、资源、Unity 元数据和可读字符串；没有安装或运行 APK。
- 不应将 APK 内嵌的服务地址、密钥或第三方配置作为当前项目的生产配置。若仍由项目方控制，需单独审计并轮换凭据。

### 可恢复程度

该包的核心为 Unity IL2CPP，而非可直接反编译的原始 C#：

- 可以恢复：程序集、类型/方法/字段名、配置、资源、交互事件、调用关系和许多算法分支的 native 伪代码。
- 不能 1:1 恢复：原 C# 工程、注释、全部局部变量名、构建设置，以及服务端实现。
- Android 外壳另外经过加固：`MyWrapperProxyApplication` 加载实际的 `com.zbj.zhouse.ZHouseApplication`，真实 Dex 位于受保护资源中。只有在隔离环境中动态解壳，才能进一步恢复 Android 层业务代码。

因此，旧 APK 的正确定位是**行为基准和算法参考**，而不是把旧数据结构直接迁入当前系统。

## 已识别的量房/户型能力

### Unity 业务程序集

可见的核心程序集包括：

- `ZhiBenJia.ZHouse.Unity`
- `ZhiBenJia.ZHouse.Model`
- `ZhiBenJia.ZHouse.Model.Draw`
- `ZhiBenJia.ZHouse.Model.House3D`
- `ZhiBenJia.ZHouse.Model.Block`
- `ZhiBenJia.ZHouse.Algorithm`
- `ZhiBenJia.ZHouse.Data`
- `ZhiBenJia.ZHouse.Data.HouseJson`
- `ZhiBenJia.ZHouse.Mobile`

量房相关的可见类型和事件名包括 `House2DAlgorithm`、`HouseWall2D`、`HouseWallLine`、`HouseLinesV1`、`OutLinePoints`、`Rooms`、`DrawingCursor`、`DrawHouseLines`、`DimensionLines`、`DrawReferenceLines`、`AddWall`、`EditLine`、`DeleteHouseLine`、`DeleteRoom`、`AlignPoint`、`CanAlignLine`、`CreatePoly`、`CornerWindowToPoly`、`AddWindow`、`AddBlock`、`UndoEvent` 和 `RedoEvent`。

### 可验证的编辑行为

- 墙体可按内/外测量方向绘制、改长度、改墙厚、拖动、删除、延长和缩短。
- 墙体闭合后形成房间；直线、斜线、矩形补边、公共墙、连续绘制和闭合候选分别处理。
- 2D 与 3D 模式、漫游、尺寸线、辅助线和构件编辑共用同一户型语义。
- `assets/Template/Config.json` 保留了 96 个 2D 构件定义及默认尺寸，覆盖门洞、门窗、柱梁、烟道、楼梯、电气、给排水、隔断与消防设施。
- `assets/leica_commands.json` 保留了 Leica 测距仪的 BLE/Wi-Fi 指令名称、测距、连续测量、激光开关、设备信息和固件更新相关命令。

## 当前小程序的对照边界

当前正式量房的唯一入口是 `miniprogram/packages/surveying/editor/surveying-editor.*`。旧 APK 的行为只能用于验证和改进下列现有实现：

- `miniprogram/utils/surveyWallGraph.js`：正式 wall graph、编辑状态、闭合与共享墙。
- `miniprogram/packages/surveying/utils/surveyCanvasRenderer.js`：2D 画布和尺寸/辅助线渲染。
- `miniprogram/packages/surveying/utils/surveyDimensionPlan.js`：尺寸规划。
- `miniprogram/packages/surveying/utils/surveyWallSolidPlan.js`：墙体实体规划。
- `miniprogram/utils/bluetooth.js`：蓝牙测距连接与读数。

任何修复都必须保持正式契约：`FloorPlan.layoutData` 仅保存 `version: 4`、`measurementMode: 'surveying'` 和 `surveyGraph`；坐标、长度、墙厚、开口与层高均以毫米计。不得重新引入 `rooms`、`homeOutline`、`partitions` 或其他旧布局副本。

## 修复专题索引

| 编号 | 专题 | 状态 | 参考证据 |
| --- | --- | --- | --- |
| ALG-001 | 共享墙闭合、内外墙面与净面积 | 已实施，待真机视觉复核 | 当前小程序截图 1/2；旧 APK 截图 3；`survey-canvas-renderer`/墙图回归 |

后续专题按 `ALG-002`、`ALG-003` 递增，在本文件中新增条目，并保留：复现步骤、输入墙图、旧 APK 基准、当前结果、根因、修复范围、回归测试和验证结论。

## ALG-001：共享墙闭合、内外墙面与净面积

### 问题与对照

用户提供的当前小程序截图显示：先闭合房间 1，再从其下边继续闭合房间 2。房间 2 的右侧物理轮廓比房间 1 向右多出约一个墙厚，且当前面积显示为 `2233 × 3182 ≈ 7.1㎡` 的量级。

旧 APK 截图的基准行为是：

- 两个上下相邻空间共用中间的一面 `200mm` 墙体；该墙体不重复生成。
- 外轮廓宽度保持统一；示例同时展示约 `2230mm` 的外尺寸和约 `1830mm` 的内净宽。
- 中间共享墙厚度单独占据约 `200mm`；每个房间的净面积按自己的内墙面计算。

截图中的实际测量值并非完全相同，因此它们用于验证**几何关系**，不能逐字比较具体数值。

### 已证实的当前实现事实

1. `surveyWallGraph.js` 的 `snapCursorToWall()` 明确将墙图描述为中心线拓扑，并在外边命中时把锚点投影回源墙拓扑线。
2. 同文件的 `findClosedSpaceForWall()` 只返回第一间引用该 `wallId` 的闭合房间；`buildBaseWallSegment()` 使用该单一房间的质心决定墙体向哪一侧扩展。
3. `calculateSpaceAreaMm2()` 直接对 `buildSpaceBoundaryPoints()` 返回的拓扑节点计算鞋带面积；它没有构造该空间的内墙面多边形。

第 2、3 点足以解释共享墙场景中的单侧偏移风险，以及净面积错误地落在拓扑/测量轮廓上的风险。截图中的具体右侧外扩仍应以保存当时的 `surveyGraph` JSON 复核，不能仅凭截图断言唯一触发分支。

### 目标模型

```text
Wall（唯一物理墙）
  ├─ topology centerline：连通、切分、闭合使用
  ├─ 两个物理墙面：leftFace / rightFace
  └─ measurementStartInsetMm / measurementEndInsetMm：真实读数与拓扑端点的偏移

Space（闭合空间）
  └─ 按 wallIds 的有向链推导本空间位于每面墙的哪一侧
       ├─ 该空间的内墙面边界
       ├─ 净尺寸与净面积
       └─ 尺寸标注的内/外尺寸带
```

墙体应按唯一物理墙渲染或进行实体并集，不应因两个空间分别闭合而在共享边上重复向不同方向扩张。空间面积应使用由有向空间链和墙厚导出的内表面多边形；墙图节点不能直接作为净面积边界。

### 修复范围与验收

修复应局限于 version-4 wall graph 的几何推导与渲染读模型，保持 API、角色边界、BLE 审计和持久化顶层结构不变。

必须新增或更新的回归用例：

1. 墙厚 `200mm` 的上下相邻矩形房间，第二间从第一间边界开始测量并闭合。
2. 共享墙仅存在一次；两房外轮廓在公共边两侧连续且不出现一墙厚台阶。
3. 两房都能得到各自的内净面积；面积不得直接等于中心线/外轮廓的宽高乘积。
4. 尺寸规划能区分内尺寸、外尺寸和墙厚段，且不穿过墙体。
5. 从内边或外边吸附开始时，真实 BLE/手动读数仍通过 `measurementStartInsetMm` / `measurementEndInsetMm` 保持正确，不移动拓扑连通点。
6. 删除、重吸附、复尺、墙体切分和重新闭合后不遗留旧的共享墙或面积读模型。

### 实施与验证结论（2026-08-10）

- `surveyWallGraph.js` 新增按闭合空间有向墙链推导的墙面读模型。同一物理墙仍只保留一个 `wall`；每个空间根据自身质心选择该墙靠近本空间的物理墙面，相邻墙面以无限直线交点形成内表面多边形。被测长度完全由起止内缩消耗的墙厚连接段不会被误算为额外净边界。
- `calculateSpaceAreaMm2(draft, spaceId)`、房间填充和房间标签统一消费内表面多边形；标签不再以“最长横墙 × 最长竖墙”替代不规则空间面积。`buildSpaceDimensionPlan()` 同时给出本空间的内边界、外边界、内/外包络尺寸、净面积和逐墙厚度段，属于只读派生结果，不写回 `surveyGraph`。
- `surveyCanvasRenderer.js` 继续对 `floor.walls` 逐墙只生成一次实体，并通过墙体全局并集消除 L/T 接口、重叠边和共享边内部接缝。上下相邻的 `2230 × 3182mm` 回归中，共享墙引用次数为二但实体数为一；两房净面积均为 `7,095,860mm²`，第二房原始拓扑包络面积 `7,541,860mm²` 不再被当作净面积；两侧外墙面各保持同一连续坐标，不出现 `200mm` 台阶。
- `measurementStartInsetMm` / `measurementEndInsetMm` 的既有语义、拓扑节点、BLE/手动读数、删除、重吸附、复尺、墙体切分与重新闭合流程保持不变。针对渲染、墙图光标、尺寸规划和墙体实体并集的 `79/79` 个聚焦测试通过；微信开发者工具/真机视觉复核仍待执行。

### 后续取证方式

每次讨论这个专题时，优先提供：

1. 当前版本的复现步骤；
2. 闭合前后完整 `surveyGraph` JSON；
3. 墙厚、测量边、每次手输/BLE 读数和操作顺序；
4. 当前截图与旧 APK 对照截图；
5. 期望的房间外轮廓、内净尺寸和面积。

如需进一步参考旧实现，可在用户明确允许的隔离测试环境中，对旧 APK 做动态解壳和 IL2CPP 方法级分析；重点定位 `House2DAlgorithm` 的共享墙、闭合、房间边界和面积判定。该过程不应登录真实账号或复用生产凭据。

## 新专题模板

```md
## ALG-XXX：<专题名称>

### 现象

### 复现输入与步骤

### 旧 APK 基准

### 当前 wall graph / 渲染结果

### 根因（已证实 / 推测）

### 修复边界

### 回归测试

### 验证结论
```
