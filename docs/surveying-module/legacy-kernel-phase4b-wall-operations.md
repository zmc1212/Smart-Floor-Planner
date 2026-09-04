# `legacy-kernel.js` Phase 4B 墙体结构事务迁移记录

> 状态：已完成（Implemented）
>
> 完成日期：2026-09-04
>
> 对外合同：无变化

## 1. 权威模块与事务边界

Mini Program 的 `packages/surveying/utils/survey/` 仍是权威源；Admin 的
`src/lib/survey-runtime/survey/` 由既有同步脚本生成，不人工维护第二套算法。

| 模块 | 当前职责 |
| --- | --- |
| `operations/wall-split.js` | `planWallSplit`、`applyWallSplitPlan`、可组合的 `splitWallAtNodes`，以及独立完整事务 `splitWall` |
| `operations/wall-deletion.js` | `planDeleteWall` / `planDeleteClosedSpace`、对应 apply、legacy 兼容入口和 `createWallDeletionOperations` |
| `operations/wall-mutation-helpers.js` | 既有墙长/审计刷新、端点内缩与门窗补偿、方向反转、孤立节点回收、Face 同步 |
| `operations/open-chain.js` | 删除后恢复开口链、悬空端续接与既有闭合建议 session 恢复 |
| `topology/wall-path.js`、`topology/closure-queries.js` | 原有路径查询及恢复墙链所需的只读闭合计划查询，不执行闭合写入 |
| `core/graph-query.js`、`core/runtime-id.js` | 共享只读查询，以及原 kernel 的 ID 序列/时间来源 |

两个删除操作先在只读计划中确定目标、独有墙或共线共享墙集合及墙链保留条件，再应用到
既有 `operations/transaction.js` 克隆的事务草稿。操作通过既有
`syncClosedSpacesFromFaces` / `extractFaces` 同步 Space、恢复 session、回收节点，最后
由 `full` invariant validator 决定是否提交。apply 返回 `kind`、`changed` 和受影响 ID；
公共入口仍返回新 draft，未增加公开 façade 导出或改变返回合同。

`splitWallAtNodes` 原本就是 kernel 内部的可组合步骤，不是 64/69 个公共导出之一。
现在它在只读 plan 中生成独立墙段，应用时迁移门窗与空间墙引用。`commitPreviewLength`
和 `confirmClosure` 直接调用同一实现；组合操作在所有切点及连接墙完成后才同步 Face 和
执行完整校验，不能在尚未完成的多切点闭合中插入嵌套事务或提前求面。原有
`fullValidationAfterClosedSplit` 交接规则保持不变。独立 `splitWall` 使用同一事务框架，
完成 Space 同步和 `full` 校验，仅用于该内部操作边界，不增加 editor 入口。

删除后恢复墙链原本依赖闭合建议。为避免新操作反向依赖 kernel，本阶段只将这些既有
查询及其纯依赖移至 `topology/closure-queries.js`；没有接管 `confirmClosure`、改变候选
优先级或闭合阈值，也不代表 Phase 4D/5 已完成。整个新操作依赖闭包无 kernel、façade、
editor、BLE、`wx` 或浏览器依赖，没有循环依赖。

## 2. 冻结行为与限制

- 无切点、未知切点、端点切点仍保留旧的墙段规格化行为；不存在的墙仍为 no-op。
  切点排序、重复 ID 去重、首段复用原墙 ID、反向 Space 遍历和墙面 override 继承不变。
- 共享墙在实际拆分前固定原有物理实体侧，各替换段的 `bodyNormalSide` 和
  `topologySourceWallId` 一致；未编辑房间的边界、面积和净尺寸不变。
- 门窗物理范围加一个当前/相交分隔墙厚仍为禁止切割区；接触也拒绝，沿用
  `OPENING_SPLIT_CONFLICT` 和原错误消息/字段。安全门窗保留世界位置，并按原测量起点
  内缩/延伸补偿后迁移到单个新宿主，不支持跨段门窗。
- 原始读数与闭合平差按分段有效长度分配，末段接收取整尾差，合计严格守恒；不完整或
  非有限审计对仍按旧规则清除，不捏造仪器读数。
- 删除共享墙仍删除整条连续共线共享界面并合并房间；独有外墙删除恢复开口链。
  删除空间只移除该房间独有墙，保留邻房共享墙；全共享闭环只清 selection，保留几何。
- 删除宿主墙连带移除其门窗；保留墙的端点内缩、开口位置修复与原有顺序一致。
  selection、复尺 fixed node、预览和光标吸附引用清理、尾墙续画、房间重建及孤立节点
  回收保持原语义。未选择或不存在对象的 no-op 仍保留原 session 规格化/触时行为。
- 重复运行同一输入结果确定。对已经拆短的原墙再次传入旧的多切点不承诺幂等：切点若已
  越过当前宿主，仍由完整校验原子拒绝，不能为了重复调用而放宽 validator。
- legacy kernel 保留删除操作兼容代理，所有内部拆墙调用已转向权威模块；旧实现函数体
  及共用 helper 不重复留在 kernel。64 个 legacy 与 69 个 façade 导出保持不变。

## 3. 验收与复现

```powershell
npm --prefix miniprogram run test:survey-kernel-phase4b
npm --prefix admin run test:survey-read-models
npm --prefix miniprogram test
git diff --check
```

- 新增 93 项 Phase 4B 测试通过：27 类拆墙输入及 59 类删除输入，分别对比迁移前冻结实现
  与 Mini Program/Admin 的独立步骤、legacy 入口和完整事务。冻结旧函数及其本地 helper
  闭包位于 `miniprogram/test/fixtures/survey-kernel-phase4b/wall-operation-reference.js`，
  不引用新墙体操作，也不进入运行包。
- 覆盖 11 类代表图、单/多切点、斜墙、共享墙、共线共享界面、门窗保护边界、测量修正、
  全共享房间、失败原子性、只读/可重放 plan、结构化结果、undo/redo 快照往返、重复输入
  与对结果再操作；同时比较 graph/session/错误、quick/full、引用完整性和派生读模型。
- 697 / 697 项量房定向测试与 55 / 55 项 H5 测试通过，包含原 4,096 组闭合场景目录。
- Admin 消费者测试 39 / 39 通过（8 项运行时测试及 31 项适配器测试），覆盖 2D、PNG、
  DXF、房间/3D 与 AI 消费路径，不改变后台只读边界。
- 完整小程序测试 1,198 项中 1,184 项通过；14 项失败名称与
  [Phase 0 已登记清单](./legacy-kernel-phase0-baseline.md#7-重复执行与更新规则) 完全一致。
  没有新增量房失败，也没有修改或跳过无关测试。
- kernel 当前为 4,595 行 / 116 个顶层函数；依赖图为 39 个模块 / 141 条边。
  42 对运行镜像通过源码审计（41 对精确副本，renderer 为 1 对批准路径改写）。
- 大图性能门槛通过：clone p95 1.092 ms、quick 0.676 ms、full 14.293 ms、wall read-model
  72.556 ms、space read-model 40.733 ms；8 份保留 clone 的 heap 增量 3,727,912 bytes。
  本轮迁移前同机 p95 分别为 1.477 / 0.790 / 20.370 / 76.367 / 46.202 ms；无显著回退。
- 只更新结构审计及镜像数量断言；Phase 0 行为快照、性能阈值及 validator 未重建或放宽。

## 4. 外部影响与下一阶段

这是内部行为等价重构。路由、API、角色、租户权限、UI、素材、错误文案、吸附/闭合策略、
毫米单位及 version-4 持久化合同均无变化。不修改 Canvas/WXML/Less，没有视觉设计源
变更或新增运行态视觉验收需求，未操作微信 DevTools。

Phase 4B 完成；下一阶段为 Phase 4C 的 `remeasureSelectedWall` 与测量写入迁移。
Phase 4D 闭合写入、Phase 5 session/交互分离及 Phase 6/7 最终治理仍未完成。
