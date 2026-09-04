# `legacy-kernel.js` Phase 4A 门窗事务迁移记录

> 状态：已完成（Implemented）
>
> 完成日期：2026-09-04
>
> 对外合同：无变化

## 1. 权威模块与写入路径

Phase 4A 已将 `addOpeningToWall`、`updateOpening` 和 `deleteOpening` 的生产实现从
`legacy-kernel.js` 迁移到
`miniprogram/packages/surveying/utils/survey/operations/opening-operations.js`。
三个操作现在统一执行以下路径：

```text
克隆事务草稿
  -> 校验前置条件
  -> 生成只读变更计划
  -> 在事务草稿上应用
  -> quick graph invariant validation
  -> 返回新 draft
```

操作模块公开 `planAddOpening`、`planUpdateOpening`、`planDeleteOpening` 和
`applyOpeningPlan`，计划生成不修改输入，应用阶段返回含 `changed`、`kind`、
`wallId` / `openingId` 的结构化结果。公共 façade 仍通过既有
`operations/transaction.js` 执行不可变克隆与不变量校验。门窗增删改不改变 node、wall
或 Space 拓扑，因此本阶段没有新增空转的 topology/space 同步步骤。

规格化与校验继续复用 Phase 2 的权威模块：

- `domain/opening.js`：按当前宿主墙规格化宽度、中心偏移和开门方向；
- `domain/validation.js`：校验宽、高、窗台高、深度和中心偏移输入；
- `domain/errors.js`：产生稳定领域错误码与结构化详情；
- `compat/legacy-error-messages.js`：仅在 legacy 公共边界恢复历史错误消息；
- `invariants/floor-plan-validator.js`：事务提交前检查宿主墙引用和开口范围。

该依赖闭包不引用 `legacy-kernel.js`、`surveyWallGraph.js`、editor、BLE、`wx`、浏览器
全局或客户端模块，且无循环依赖。

## 2. 保持不变的行为

- 显式 wall ID 与 `session.selectedWallId` 回退规则不变；无可用宿主墙仍按历史消息拒绝。
- `window` 创建窗，其余 type 继续回退为 `door`；门窗默认尺寸、窗台高、深度、模型、
  材质、来源和时间字段不变。
- 新开口仍放在宿主墙中点；宽度可占满当前墙长，最小规格为 100 mm，不恢复 60% 比例上限。
- 更新继续校验宽、高、窗台高、深度和整数中心偏移，再按当前宿主墙夹紧宽度和偏移；
  非法门方向继续规格化为 `inside`。
- 窗继续忽略 `openDirection` 和 `entryDoor` 这两个门专属字段；模型和材质字段仍按字符串保存。
- 将某扇门设为入户门时，其他门的 `entryDoor` 会清除；显式设为 `false` 时保留历史的
  “清除全部入户门”语义。
- 添加、更新、删除后的 selection/session 状态与原实现一致；删除不存在的开口仍是成功 no-op。
- 发生变更时返回新 draft 并更新时间；删除 no-op 保留 legacy 与事务层各自原有的触时策略。
  失败操作不修改调用方 draft、history、Space、墙或开口。
- façade、legacy kernel 的 64 个兼容导出、façade 的 69 个公共导出及错误文案均未改变。

## 3. façade、kernel 与镜像边界

- `surveyWallGraph.js` 直接创建独立的 opening transaction，不再向它注入 kernel。
- `legacy-kernel.js` 仅为三个历史导出保留指向 `legacyOpeningOperations` 的兼容代理；三个
  mutation 函数体已删除。
- kernel 从 Phase 3 的 6,180 行 / 176 个顶层函数变为 6,064 行 / 173 个顶层函数。
- 当前依赖图为 32 个模块 / 91 条边；35 对 Mini Program/Admin 运行镜像继续通过审计
  （34 对精确副本及 renderer 的 1 对已批准 require 路径改写）。
- Mini Program 仍是权威源；既有同步脚本更新 Admin 的 opening operation、kernel 与 façade 镜像。
- Admin 仍只读消费 survey runtime。本阶段没有新增后台写入口，也没有改变现有 2D、PNG、
  DXF、3D 或 AI 消费路径。

## 4. 验收与复现

```powershell
npm --prefix miniprogram run test:survey-kernel-phase4a
npm --prefix admin run test:survey-read-models
npm --prefix miniprogram test
git diff --check
```

- 604 / 604 项量房定向测试通过，其中 Phase 4A 新增 38 项。
- 15 类冻结操作输入分别对比迁移前 mutation 与 Mini Program/Admin 的 legacy proxy、transactional façade，
  共覆盖显式/选中宿主、门/窗/未知类型、完整字段更新、五类无效数值、缺失开口以及删除 no-op。
- 计划只读、结构化结果、宿主墙规格化、唯一入户门、缺失宿主、越界开口、失败原子性、
  undo/redo 快照往返、依赖闭包及 kernel 函数体移除均有独立断言。
- 冻结参考位于 `miniprogram/test/fixtures/survey-kernel-phase4a/`，只供测试使用，不依赖生产
  opening operation 或 kernel，也不进入运行包。
- 55 / 55 项 H5 测试及 38 / 38 项 Admin 画布/消费者/DXF/AI 测试通过；35 对镜像一致。
- 完整小程序测试 1,095 项中 1,081 项通过；14 项失败名称与
  [Phase 0 已登记清单](./legacy-kernel-phase0-baseline.md#7-重复执行与更新规则) 完全一致，
  均为页面、资源包、环境选择和引导合同既有失败，量房范围没有新增失败。
- 大图性能门槛通过：`cloneDraft` p95 0.628 ms、`quickValidation` p95 0.887 ms、
  `fullValidation` p95 12.948 ms、wall read-model p95 67.172 ms、space read-model p95
  43.416 ms；保留 8 份 clone 的 heap 增量为 3,727,912 bytes。
- 只更新结构审计快照；Phase 0 冻结行为与性能阈值未重建或放宽。

## 5. 外部影响与下一步

Phase 4A 是内部行为等价重构。路由、API、角色、权限、租户边界、页面结构、样式、资源、
吸附/闭合策略、毫米单位、错误文案及 version-4 持久化合同均无变化。没有可见 UI 改动，
不涉及设计源或微信 DevTools 运行态核验。

下一阶段为 Phase 4B，唯一首要目标是迁移 `splitWallAtNodes`。墙体分裂将继续冻结开口迁移、
session 引用、Space 同步、失败原子性和共享墙语义；不会在同一步修改 UI、吸附/闭合策略
或正式 v4 数据合同。
