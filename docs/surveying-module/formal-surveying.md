# 正式量房数据合同

`miniprogram/packages/surveying/editor/surveying-editor` 是唯一正式量房页面。

引导提示由主 `survey-canvas` 绘制：白底对话框及其浅绿箭头尾巴、居中的“小K提示”
标签、小K、目标光圈和从手势出发的绿色虚线贝塞尔箭头均不生成 WXML 覆盖节点。这样
引导可见时原生 Canvas 仍拥有拖动光标、平移和双指缩放的触摸事件；仅顶部“引导”保留
本机持久化开关。该展示层不写入 `FloorPlan.layoutData`、草稿或测量审计，也不改变 API
或角色权限。

引导正文按 Canvas 当前字体和气泡内宽测量换行，禁止中文文本越界；旧的 WXML 测量气泡不设
空白回退分支，缺少顶部测量值时不显示浮卡。

尾巴和卡片必须使用连续 Canvas 轮廓，禁止拼接横线；每个引导状态均由真实目标位置选择小K左右指向，最后一行正文下方必须保留底部内边距。

编辑器顶部仅显示关联线索的小区名称；`utils/surveyNavigation.js` 在入口已知时携带该名称，按 `floorPlanId` 直接进入时由 `GET /api/floorplans/[id]` 返回关联线索摘要。状态跟随式引导在本地默认开启，顶部固定的“引导”操作与对话框关闭按钮均可持久化关闭；重新开启时根据当前墙图和编辑状态继续，而非从固定步骤重播。每个有操作目标的引导均以完整白底浅绿边框的小K对话框呈现：标题行包含“小K提示”标签、绿色星芒图标（`images/mine-icons/tab-ai-active.png`）和关闭按钮，正文为可换行的一句行动提示；固定壳层和引导卡的比例、图标语义、字距及间距以 `design-references/all-pages-ip-v1/ChatGPT Image 2026年8月5日 15_44_17.png` 为高保真对照。本地透明左指、右指、下指小K（`packages/surveying/assets/surveying-guide-k-left-v3.png`、`-right-v3.png`、`-down-v3.png`）位于卡片侧下方，统一从 `design-references/surveying-editor-v3/sub2api-20260805-075309-1.png` 单张画板裁切。角色手势经绿色虚线、箭头和目标波纹连接到真实 Canvas 几何或控件，卡片尖角按目标上下位置切换，并避开安全区、工具栏、控制坞和当前墙体。引导覆盖拉首墙、确认方向/长度/测量边、续墙、闭合、下一空间光标吸附、构件编辑和完成提交；数字键盘、构件编辑器或测角面板开启时仍由面板自身说明接管。关闭引导不影响闭合、测量边、吸附、BLE 或提交反馈，且引导不写入 `FloorPlan.layoutData`、本地草稿或测量审计。

引导卡的像素几何按当前 Canvas 宽度相对 `390px` 基准缩放，并为卡片、小K和真实目标之间的连接留出固定视觉路径。不得显示产品未实现的编号阶段或分页教程。白底浅绿边框对话框使用清晰的箭头尾巴指向真实目标；小K选择朝向目标的姿态，绿色弧形虚线箭头从其朝向目标的手出发并在真实 Canvas/控件目标处结束。工具轨激活图标使用本地绿色 PNG，底部光标使用本地深色准星，避免依赖真机不一致的图片滤色。

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
