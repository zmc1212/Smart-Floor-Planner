# 正式量房数据合同

`miniprogram/pages/surveying-editor/surveying-editor` 是唯一正式量房页面。

正式 `FloorPlan.layoutData` 必须使用：

```json
{
  "version": 4,
  "measurementMode": "surveying",
  "surveyGraph": { "kind": "survey-wall-graph", "floors": [] }
}
```

不再存储或读取 `rooms`、`homeOutline`、`partitions`、`surveyDraft`、`prototypeOnly` 或 `surveying_prototype`。报告、CAD、3D、后台和 AI 使用墙图读适配层，不创建旧布局副本。

小程序 AI 设计可携带 `floorPlanId`/`roomId`，后台仅用 `adaptSurveyGraphToRooms` 派生尺寸、层高和开口摘要，并可把生成记录关联到客户 `AiWorkflow`。现场照片、参考图和生成结果属于独立 `MediaAsset`/`AiGeneration` 数据，不写入正式户型；仅凭户型生成的图片是概念效果，不作为施工级还原。

首次保存正式户型前收到的有效 BLE 读数会暂存于当前量房会话；户型创建成功后，这些读数会带着正式 `floorPlanId` 写入测量审计。保存失败的读数保留至下一次成功保存后重试。

运行 `npm run cleanup:legacy-floorplans -- --execute` 会将已有墙图原型规范为正式草稿，并永久删除所有其他旧户型、其线索引用和测量日志。先不带 `--execute` 运行可查看清理数量。
