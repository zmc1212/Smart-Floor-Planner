# `legacy-kernel.js` Phase 2 基础能力收口记录

> 状态：已完成
>
> 完成日期：2026-09-04
>
> 对外合同：无变化

## 1. 完成范围

Phase 2 按治理计划的函数族顺序，把低风险基础能力收口到以下权威模块：

| 函数族 | 权威模块 | 兼容方式 |
| --- | --- | --- |
| draft 克隆、活动楼层、更新时间 | `core/draft.js` | kernel 与事务层共同调用；事务草稿标记也由该模块定义 |
| session 状态、字段、引用与补全 | `core/session.js` | kernel 与 validator 共同调用，状态值和序列化字段不变 |
| 向量基础运算 | `geometry/vector2.js` | kernel 使用模块函数别名，不保留重复函数体 |
| 线段相交、投影、重叠、点到直线距离与关系 | `geometry/segment.js` | kernel 只保留带业务阈值的薄策略适配；`geometry/intersection.js` 仅转发权威实现 |
| 多边形面积、方向、包含、质心与自交 | `geometry/polygon.js` | kernel 的空间计算直接调用该模块 |
| 墙体/门窗规格化、测量面法向、坐标/实测长度与按实测长度反算端点 | `domain/wall.js`、`domain/opening.js` | kernel 和 wall-face 读模型共享权威模块；预览修正先取整、存量墙读数保留小数的既有区别不变 |
| 领域错误与旧消息 | `domain/errors.js`、`domain/validation.js`、`compat/legacy-error-messages.js` | 内部使用稳定错误码和结构化详情；64 个 legacy 公共导出的边界仍恢复原错误消息与历史可枚举字段 |

这些基础模块不读取 editor、BLE、`wx` 或全局 session 状态，也不反向依赖
`legacy-kernel.js` 或公共 façade。吸附阈值、闭合规则、validator 强度、视觉反馈、
路由、API、角色、权限和 version-4 graph 均未调整。

## 2. 复核补齐范围

首次完成标记遗漏了四个纯函数：`perpendicularDistanceToLineMm`、
`normalForMeasurementSide`、`calculateMeasuredPreviewLength`、`pointFromLength`。
现已分别迁入 segment/wall 权威模块，kernel 只保留函数别名；门窗更新也统一调用
`normalizeOpeningDirection`，不再内联同一方向规格化公式。

复核还发现 draft 合并改变了旧 `getActiveFloor({ floors: [] })` 的结果。现由同一
core 查找实现显式区分访问策略：legacy/façade 空楼层返回 `undefined`、缺失楼层列表
仍抛 `TypeError`；原 core 安全访问继续返回 `null`，正常 graph 的活动楼层选择不变。

`test/fixtures/survey-kernel-phase2/foundation-reference.js` 冻结 Phase 1 提交
`28ec18b6` 的四个旧公式，不依赖生产 helper，也不进入运行包。新增测试用固定种子的
256 组坐标组合正常/退化线段、左右测量面、取整/负值修正和三个实测长度，执行
7,424 次精确结果比较；另覆盖空楼层边界及全部 32 个错误码的旧消息、可枚举字段和
非领域异常透传。本轮不接管 read-model 或高层写操作。

## 3. 兼容性结果

- `legacy-kernel.js` 从 7,239 行 / 245 个顶层函数收口为 6,801 行 / 208 个顶层函数；
  行数变化只是结构证据，不是验收标准。
- legacy kernel 的 64 个导出、公共 façade 的 69 个导出和 17 个覆盖关系保持不变。
- Phase 0 的 graph、session、错误消息、错误字段和 read-model 行为快照未重建且继续精确匹配。
- 结构审计按已审核的等价迁移更新为 30 个模块节点 / 58 条依赖边；
  `core/draft.js` 已从疑似未用转为生产可达，没有新增反向依赖。
- Mini Program 到 Admin 的运行镜像增至 33 对，全部存在且通过源码哈希审计；其中 32 对为
  精确副本，`surveyCanvasRenderer.js` 使用已批准的 Admin `require` 路径改写。
- `geometry/intersection.js`、`topology/space-topology.js` 和
  `topology/wall-split.js` 仍按审计标为疑似未用；本阶段不提前执行 Phase 7 死代码清理。

## 4. 验收证据

专项验收命令：

```powershell
Set-Location miniprogram
npm run test:survey-kernel-phase2
```

2026-09-04 验收结果：

- 544 / 544 项量房定向测试通过，其中 Phase 2 新增 14 项基础模块、边界输入、
  冻结公式差分、旧消息兼容和依赖方向测试；
- 55 / 55 项 H5 生产场景测试通过；
- 8 / 8 项 Admin survey canvas / runtime / snapshot 测试通过；
- 273 节点 / 512 墙 / 240 空间的大图性能门槛通过：
  单独执行时 `cloneDraft` p95 1.357 ms、`quickValidation` p95 0.754 ms、
  `fullValidation` p95 15.199 ms、`wallReadModels` p95 65.035 ms、
  `spaceReadModels` p95 41.575 ms，保留 clone heap 增量 3,727,912 bytes；
  与 Phase 0 相比各项仍处于原门槛内，无未解释的显著回退；
- 完整 `npm test` 发现 1,035 项，1,021 项通过、14 项失败；失败名称与
  [`legacy-kernel-phase0-baseline.md`](./legacy-kernel-phase0-baseline.md) 已记录的页面、
  资源包和引导合同失败完全一致，量房范围没有新增失败；
- `expected-audit.json` 只为已审核的模块、依赖和镜像结构变化重建；
  `expected-behavior.json` 与性能阈值未放宽或重建。

本阶段没有可见 UI 变化，不需要设计源变更或微信 DevTools 视觉核验。

## 5. 下一阶段

下一步进入 Phase 3，先迁移墙中心线和墙实体只读模型，并为迁移后的每个 read-model
补充输入 graph 不变与 Mini Program/Admin 输出一致性验证。Phase 3 不在本记录中视为已完成。
