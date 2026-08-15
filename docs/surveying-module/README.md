# 正式量房模块

本文是正式量房模块的当前运行说明；历史实验、逐次缺陷修复和截图记录由
Git 历史保留。

## 当前能力

- 唯一编辑入口：`miniprogram/packages/surveying/editor/surveying-editor.*`。
- 编辑器使用 version-4 `surveyGraph`，坐标、长度、墙厚、开口和层高均为毫米。
- 支持直墙、斜墙、连续墙链、共享墙、闭合空间、门窗、尺寸规划、撤销/重做、
  BLE 读数和正式保存。
- 空间填充、净面积、墙体实体和尺寸均从 graph 派生；不保存 legacy layout 副本。
- 后台查看器、DXF、3D 和 AI 使用同一 graph 的只读适配器。

## 数据与入口合同

`FloorPlan.layoutData` 只允许 `version: 4`、`measurementMode: 'surveying'` 和
`surveyGraph`。每个测量入口必须携带 `leadId` 和/或 `floorPlanId`。详见
[`formal-surveying.md`](./formal-surveying.md)。

关联线索处于 `new` 或 `measuring` 时可以删除正式户型；进入 `designing`、
`converted` 或 `closed` 后，户型是后续流程的必要依据，删除接口返回业务冲突。

## 几何不变量

- 一面物理墙只存一份；共享墙厚度不重复计入空间净边界。
- 空间面积使用派生内墙面，不使用拓扑节点包围面积。
- 尺寸是只读派生结果，不改变 graph 拓扑或持久化结构。
- 删除、重新吸附、墙体分割和重新闭合必须保留门窗位置、测量内缩和空间关联。
- Canvas 正式渲染与手势预览必须使用同一几何投影；平移、缩放不得改变 graph 结果。

## BLE 与测量审计

BLE 集成位于 `miniprogram/utils/bluetooth.js`。读数以毫米写入正式测量审计，
并保留来源、操作员和时间。首次云端保存前的读数在本地排队，获得正式
`floorPlanId` 后再提交；临时回调所有者关闭时恢复普通回调。

## 运维与核验

- 修改 graph、渲染、尺寸、BLE 或保存流程时，运行对应聚焦测试和正式小程序测试。
- 涉及原生 Canvas、BLE 或宿主安全区时，补充现有微信 DevTools 或真实设备核验。
- 生产清理脚本必须先 dry-run；只清理由正式合同明确允许删除的旧数据。
- 不得恢复 `pages/editor/editor`、`restoreFloorPlan` 或旧几何工具。

## 维护

只在能力、入口、数据合同、权限或限制变化时更新本文和英文合同；不要追加日期
流水、实验过程或重复测试报告。

English contract: [formal-surveying.md](./formal-surveying.md)
