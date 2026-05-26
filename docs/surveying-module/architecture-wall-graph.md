# 墙图数据架构

> 状态：`Planned`  
> 核心原则：现场实际测到的红线是几何真相，所有长度和位置以整数毫米保存。

## 为什么需要新模型

旧编辑器主要以房间多边形和全屋轮廓作为结果数据，并通过方向步骤追加顶点。知户型式流程需要保存每面墙的测量侧、墙厚、复尺状态、端点接续及楼层关系，因此新版使用墙图作为编辑源数据，再在正式接入阶段生成旧格式输出。

## 单位与坐标

| 约定 | 规则 |
| --- | --- |
| 原始长度 | `integer mm`，包括坐标、墙长、墙厚、闭合容差。 |
| 页面显示 | 默认显示毫米；后续设置可提供米制格式，但不改变存储。 |
| BLE 输入 | 若公共蓝牙模块返回米，进入墙图前执行 `Math.round(meters * 1000)`。 |
| 旧版转换 | 当前旧几何 `1m = 10 units`，适配时使用 `legacyUnits = millimeters / 100`。 |
| 角度 | 以有向起点到终点为基准，保存角度度数或由节点重新计算；计算使用浮点，落点坐标最终四舍五入到毫米。 |

## 根对象合同

以下结构为实施合同，字段名可以在编码阶段使用 TypeScript/JSDoc 明确，但语义不得改变：

```js
SurveyDraft = {
  schemaVersion: 1,
  kind: 'survey-wall-graph',
  status: 'prototype' | 'draft' | 'completed',
  activeFloorId: 'floor-1',
  floors: SurveyFloor[],
  settings: {
    defaultThicknessMm: 200,
    orientationDeg: 0
  },
  source: 'surveying-editor',
  updatedAt: 'ISO timestamp'
}

SurveyFloor = {
  id: 'floor-1',
  name: '1F',
  elevationMm: 0,
  nodes: WallNode[],
  walls: WallSegment[],
  spaces: SpaceBoundary[],
  session: CursorSession,
  viewport: { scale: 1, offsetX: 0, offsetY: 0 }
}
```

## 核心领域对象

### `WallNode`

```js
{
  id: 'node-id',
  xMm: 0,
  yMm: 0,
  createdAt: 'ISO timestamp'
}
```

- 节点描述红线基准的端点，而非墙中心点。
- 一个已确认墙段必须引用两个存在的节点。
- 第一原型仅允许单闭环按顺序追加节点；共享节点与跨空间拓扑在多空间阶段开放。

### `WallSegment`

```js
{
  id: 'wall-id',
  startNodeId: 'node-a',
  endNodeId: 'node-b',
  mode: 'straight' | 'diagonal',
  lengthMm: 2950,
  angleDeg: 90,
  thicknessMm: 200,
  measurementSide: 'left' | 'right',
  inputSource: 'manual' | 'ble',
  status: 'preview' | 'confirmed',
  measuredAt: 'ISO timestamp'
}
```

- 从 `startNode -> endNode` 看，`measurementSide` 决定墙实体相对红色测距基线生成在哪一侧。
- 红线本身不因墙厚或侧切换而改变长度；切换侧只改变墙实体偏移和推导出的空间内边界。
- `lengthMm` 必须等于节点距离的毫米舍入值；修改复尺值时应重算终点，并对后续闭环关系重新验证。
- `straight` 墙在第一原型中仅允许水平或垂直；`diagonal` 使用光标拖动形成的方向角。

### `SpaceBoundary`

```js
{
  id: 'space-id',
  name: '未命名空间',
  wallIds: ['wall-1', 'wall-2', 'wall-3'],
  closed: true,
  source: 'measured'
}
```

- `wallIds` 按连续绘制顺序构成闭环。
- 空间实际可用轮廓由每面墙的红线、`measurementSide` 和 `thicknessMm` 推导，不另存一套可漂移的编辑真相。
- 第一原型只创建一个 `SpaceBoundary`；墙共享和空间分割后续追加。

### `CursorSession`

```js
{
  state: 'idle' | 'cursorPlaced' | 'wallPreview' | 'awaitingLength' |
    'wallCommitted' | 'closing' | 'spaceClosed' |
    'wallSelected' | 'remeasureAwaitingInput',
  anchorNodeId: '',
  previewPoint: { xMm: 0, yMm: 0 },
  mode: 'straight',
  thicknessMm: 200,
  measurementSide: 'right',
  pendingWallId: '',
  selectedWallId: '',
  closeCandidateNodeId: ''
}
```

### `MeasurementInput`

```js
{
  source: 'manual' | 'ble',
  lengthMm: 2600,
  receivedAt: 'ISO timestamp',
  deviceId: ''
}
```

- 输入只能应用于 `pendingWallId` 或 `selectedWallId` 处于复尺等待状态的墙段。
- 未存在活动目标时到达的 BLE 读数仅提示用户，不创建墙、不更新任何墙。

## 墙面推导规则

1. 红线为 `startNode -> endNode` 的线段。
2. 计算该有向线段的单位法向量；`measurementSide` 决定使用左法向或右法向。
3. 墙实体另一条边由红线沿所选法向偏移 `thicknessMm` 得到。
4. 相邻墙的实体交点用于渲染连接和推导空间边界；红线端点仍保持原始测量值。
5. 切换墙侧或墙厚后，重算实体轮廓与空间面积，但不得篡改测量长度和输入来源。

## 闭合与容差

- 第一原型的闭合候选仅针对当前连续墙链的首节点。
- 光标或新墙终点进入闭合容差时显示闭合操作；默认容差为 `200 mm`，与旧全屋闭合容差一致。
- 用户确认闭合时，最终终点吸附到首节点；若最终墙长度来自明确测量值且误差超出容差，则不得自动闭合。
- 闭合后保留墙段测量来源和红线，不把结果压平成不可复尺的房间多边形。

## 兼容输出合同

正式数据接入阶段新增 `LegacyLayoutAdapter`：

| 输出对象 | 转换原则 |
| --- | --- |
| `homeOutline` | 从已闭合外边界推导并换算为旧内部单位。 |
| `partitions` | 多空间阶段从非外轮廓共享/内部墙导出。 |
| `rooms` | 从闭合空间内边界推导，保留现有下游兼容要求。 |
| 报告/CAD/3D | 先消费适配结果；后续可逐步直接消费墙图。 |

原型阶段不得调用该适配器写入正式 floor plan。

## Phase 2 落地接口记录

- `miniprogram/utils/surveyWallGraph.js` 已承载原型墙图内存模型，导出 `createSurveyDraft`、`placeCursor`、`startPreview`、`commitPreviewLength`、`confirmClosure`、`selectWall`、`startRemeasure`、`remeasureSelectedWall`、`setMeasurementSide`、`setThickness`、`resetCursor` 和 `updateViewport` 等页面消费接口。
- 当前实现仅维护单楼层、单连续墙链和单闭合空间；所有坐标、长度、墙厚和闭合容差均以整数毫米保存。
- 闭合空间仍停留在原型内存态，不调用 `surveyLegacyAdapter`，也不写入旧版 `rooms/homeOutline/partitions`。
