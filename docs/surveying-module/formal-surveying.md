# 正式量房数据合同

`miniprogram/pages/surveying-editor/surveying-editor` 是唯一正式量房页面。

编辑器顶部仅显示关联线索的小区名称；`utils/surveyNavigation.js` 在入口已知时携带该名称，按 `floorPlanId` 直接进入时由 `GET /api/floorplans/[id]` 返回关联线索摘要。状态跟随式引导在本地默认开启，顶部固定的“引导”操作可持久化开关；重新开启时根据当前墙图和编辑状态继续，而非从固定步骤重播。引导依次覆盖拉首墙、确认方向/长度/测量边、续墙、闭合、下一空间光标吸附和构件编辑，并且只以真实 Canvas 几何和控件作为目标；首次拉墙可显示本地透明测距小 K（`images/surveying-guide-k.png`）。关闭引导不影响闭合、测量边、吸附、BLE 或提交反馈，且引导不写入 `FloorPlan.layoutData`、本地草稿或测量审计。

正式 `FloorPlan.layoutData` 必须使用：

```json
{
  "version": 4,
  "measurementMode": "surveying",
  "surveyGraph": { "kind": "survey-wall-graph", "floors": [] }
}
```

不再存储或读取 `rooms`、`homeOutline`、`partitions`、`surveyDraft`、`prototypeOnly` 或 `surveying_prototype`。报告、CAD、3D、后台和 AI 使用墙图读适配层，不创建旧布局副本。

酷家乐户型导入遵守同一合同：服务端把上游房间轮廓转换为毫米制的闭合节点、墙和空间链，并以顶层 `version: 4`、`measurementMode: "surveying"`、`surveyGraph.kind: "survey-wall-graph"` 持久化；上游请求不得占用数据库事务，户型写入与线索关联必须原子提交。由于当前上游响应不能可靠标识开口所属墙体，导入暂不生成门窗开口，也不得通过最近墙体等启发式规则猜测。

小程序户型列表的空间数只按 `surveyGraph.floors[].spaces` 中 `closed: true` 的空间统计；这只是只读展示，不改变正式墙图合同。

小程序 AI 设计可携带 `floorPlanId`、显式 `targetScope: whole_floor_plan | single_room`，仅单房间携带 `roomId`。后台只通过正式墙图读适配层派生上下文：完整户型消费全部闭合空间并把 1024px 墙体/门窗控制图保存为独立 `MediaAsset`，单房间只消费指定闭合空间的尺寸、层高和开口摘要；任何派生数据都不回写 `FloorPlan.layoutData`。生成记录可关联客户 `AiWorkflow`，现场照片、参考图和生成结果属于独立 `MediaAsset`/`AiGeneration` 数据；仅凭户型生成的图片是概念效果，不作为施工级还原。

首次保存正式户型前收到的有效 BLE 读数会暂存于当前量房会话；户型创建成功后，这些读数会带着正式 `floorPlanId` 写入测量审计。保存失败的读数保留至下一次成功保存后重试。

运行 `npm run cleanup:legacy-floorplans -- --execute` 会将已有墙图原型规范为正式草稿，并永久删除所有其他旧户型、其线索引用和测量日志。先不带 `--execute` 运行可查看清理数量。
