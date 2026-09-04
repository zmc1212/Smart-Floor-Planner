# `legacy-kernel.js` Phase 4C 测量写入事务迁移记录

> 状态：已完成（Implemented）
>
> 完成日期：2026-09-04
>
> 对外合同：无变化

## 1. 权威模块与事务边界

Mini Program 的 `packages/surveying/utils/survey/` 仍是权威源；Admin 的
`src/lib/survey-runtime/survey/` 由既有同步方式保持镜像，不人工维护第二套算法。

| 模块 | 当前职责 |
| --- | --- |
| `operations/measurement.js` | `planRemeasureSelectedWall`、`applyRemeasurePlan`、开链/闭合正交复尺事务，以及测量审计写入 helper |
| `operations/wall-operations.js` | 保留墙体结构/闭合兼容事务；不再拥有复尺实现 |
| `core/graph-query.js` | 共享端点查询 `getSingleSharedEndpoint`，供复尺固定端点策略复用 |
| `domain/wall.js` | 毫米坐标长度、有效测量长度、内缩/延伸归一化及 raw/closure 审计关系 |
| `operations/transaction.js` | 克隆事务草稿、触时和 quick/full invariant 校验 |

`remeasureSelectedWall` 先在只读 plan 中验证选中状态、固定/移动端点、共享墙限制、开口
有效范围和闭合正交平差预算，再在事务草稿上应用节点移动和测量元数据，最后由既有
`full` validator 提交。闭合正交空间只沿被测墙坐标轴分摊残差；开链复尺沿原墙未取整方向
移动自由端。应用过程只解析 plan 中的标识和数值，不把 plan 对象或其图引用写回 graph。

`commitPreviewLength` 的拓扑、吸附和闭合决策仍由 kernel 编排；其中已有墙延长/缩短以及
新墙的原始读数、有效长度和闭合平差写入改为调用 `measurement.js` 的 helper。闭合确认尚未
迁移，未改变 preview/session 交互策略。

## 2. 冻结行为与限制

- 手工与 BLE 复尺使用同一个事务入口和 `full` 校验；失败时输入 draft、graph、Space、
  opening、session 和调用方历史均保持不变，不自动拆墙、节点化或移动门窗。
- 无共享端点的开链复尺保持原测量方向（包括斜墙的未取整方向），固定端点优先使用会话
  `fixedNodeId`，否则沿用唯一共享端点推断；移动端已连接其他墙时拒绝。
- 被单个闭合空间独占的正交墙允许平差；共享两个闭合空间、斜墙、分支、非二度闭环或
  平差后不足最小墙长时拒绝。平差只修改被测墙所在轴，另一轴的坐标长度和审计字段不被
  覆盖，因此连续横向/纵向复尺结果稳定。
- 每个受影响墙的开口范围在移动节点前按有效测量长度预检；无法容纳时返回
  `OPENING_REMEASURE_CONFLICT`，不调用开口归一化来掩盖冲突。成功复尺才按既有墙体规则
  归一化宿主开口方向。
- `measurementStartInsetMm`、`measurementStartExtensionMm`、`measurementEndInsetMm` 的
  毫米语义保持不变。持久化审计仍满足
  `lengthMm = rawMeasuredLengthMm + closureAdjustmentMm`；坐标取整产生的差异记录为
  `coordinate-rounding`，闭合正交平差记录为 `remeasure-balance`。
- 复尺完成后的 session 状态、selection、anchor/fixed 节点清理与旧实现一致；已闭合房间
  保持 `spaceClosed`，开链保持 `wallCommitted` 并将自由端作为下一次锚点。
- legacy kernel 删除复尺与其专用 plan/apply 函数体，只保留兼容错误适配代理。公共 64 个
  legacy 导出和 69 个 façade 导出保持不变；façade 显式绑定
  `transactionalMeasurements.remeasureSelectedWall`。

## 3. 验收与复现

```powershell
npm --prefix miniprogram run test:survey-kernel-phase4b
npm --prefix miniprogram run test:survey-kernel-phase4c
npm --prefix miniprogram test
npm --prefix admin run test:survey-read-models
git diff --check
```

Phase 4C 新增的 `test/survey-kernel-phase4c-measurement-operations.test.js` 覆盖：

- 独立模块及其依赖闭包不得加载 kernel、façade、editor、BLE 或 `wx`，并保持无循环依赖；
- 开链 plan 的输入不可变、冻结/重复 apply 一致及 raw/effective/closure 审计守恒；
- 闭合正交 plan 的单轴平差和另一轴保持；
- 开口冲突在事务前置校验阶段原子拒绝；
- `commitPreviewLength` 已有墙延长/缩短 helper 的内缩/延伸与 raw 读数语义。

既有量房、H5、Admin 消费者、full validator、镜像哈希和 Phase 0/1 差分护栏继续执行，
不重建行为快照、不放宽 validator、不改变 UI、路由、API、角色、权限、BLE 协议、吸附/闭合
策略或 version-4 `layoutData` 外壳。Mini Program 与 Admin 的新测量模块保持精确镜像。
`test:survey-kernel-phase4c` 已通过 703 / 703 项量房/编辑器测试、55 / 55 项 H5 测试及
大图性能门槛；Admin `test:survey-read-models` 已通过 31 / 31 项。
当前完整 `npm --prefix miniprogram test` 共发现 1,204 项，其中 1,190 项通过、14 项仍为
仓库既有的 account/API/设计/分包与平台工作台检查失败；Phase 4C 测量路径不在失败清单内。

## 4. 外部影响与下一阶段

这是内部行为等价重构。后台仍只读，没有新增写入口；小程序正式编辑入口仍为
`surveying-editor.*`。本阶段不需要微信 DevTools 或真机视觉验收，也不改变任何设计源。

Phase 4C 完成；下一阶段为 Phase 4D 的闭合 candidate/bridge/merge/partition 计划及
`confirmClosure` 事务迁移。Phase 5 交互/session 状态机、Phase 6 兼容层收缩和 Phase 7
架构守卫仍未完成。
