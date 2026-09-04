# `legacy-kernel.js` Phase 5 交互与 session 状态机迁移记录

> 状态：已完成（Implemented）
>
> 检查日期：2026-09-04
>
> 对外合同：无变化

## 1. 当前模块边界

Mini Program 的 `packages/surveying/utils/survey/` 仍为权威源码，Admin 通过既有
`sync-survey-dimension-plan.mjs` 生成镜像。没有新的后台编辑入口或数据库写入能力。

| 模块 | 职责 |
| --- | --- |
| `session/state-machine.js` | 11 个正式状态、19 类事件、允许转换和结构化非法转换结果 |
| `session/field-groups.js`、`core/session.js` | 42 个字段的职责分组和只读分组视图；继续保存原扁平 session |
| `interaction/preview.js` | 只读预览计划；缺失光标时返回创建光标意图，不创建节点 |
| `interaction/direction-lock.js`、`angle-preview.js` | 方向锁、解除方向锁、正交 bearing 和斜墙内角输入计划 |
| `interaction/session-actions.js`、`viewport.js` | 模式、选择、取消、待输入、复尺选点及视口值计划 |
| `interaction/wall-snap.js`、`closure-projection.js` | 墙体吸附意图、共享/外侧面/分隔闭合投影及射线边界截断 |
| `interaction/measurement-preview.js`、`commit-preview.js` | 预览测量端部修正及落墙确认计划，保留原始/有效长度关系 |
| `snap/snap-engine.js`、`preview-alignment.js`、`wall-targets.js` | 吸附入口、预览/确认优先级、顶点/墙面/轴对齐候选 |
| `snap/candidate-policy.js` | 普通墙图查询与 Canvas 缓存索引共用内外角、墙面和锁定升级优先级 |
| `operations/preview.js`、`cursor.js`、`session-actions.js`、`viewport.js` | 在隔离草稿上应用交互意图；节点创建/移动和墙链恢复留在操作层 |
| `operations/commit-preview.js` | 消费值/ID 计划，组合落墙、延长、缩短、回撤、共享墙拆分和候选同步 |
| `operations/wall-operations.js`、`interaction-operations.js` | 显式公共分发、既有事务和旧错误文案兼容边界 |
| `read-model/cursor.js`、`core/incoming-wall.js`、`topology/wall-edit-queries.js` | 光标/闭合引导只读模型、来墙方向与延长/反向编辑资格查询 |

`startPreview` 只调用预览服务并由操作层应用创建光标意图，不再包含吸附算法或墙拓扑
细节。交互计划不修改输入，不读时钟、不分配运行 ID；落墙/墙体吸附计划只持有值与 ID，
不携带 graph、墙或节点对象引用。session 计划持有独立副本，保留原有缺省字段与可选字段
缺席语义，既不保存新的嵌套状态结构，也不保存事件历史。

`commitPreviewLength` 保持原错误优先级：先校验长度，再按需物化方向预览，再生成确认
计划并提交。公共 façade 由 `createWallOperations()` 复用原事务框架：通常 `quick`，
闭合共享墙拆分提升至 `full`，待完成分隔继续使用原 `allowPendingClosure` 规则。
`confirmClosure` 注入独立 `operations/commit-preview.js` 的组合步骤，整个闭合仍只有
一个外层 full 事务；闭合预览不再回调 kernel，未新增嵌套事务或第二套 validator。

## 2. 状态与字段合同

正式状态保持 `idle`、`cursorPlaced`、`wallPreview`、`awaitingLength`、`wallCommitted`、
`closing`、`mergeClosing`、`spaceClosed`、`wallSelected`、`wallSnapPending` 和
`remeasureAwaitingInput`。选择是原工作流上的对象编辑覆盖层，因此多数命令可从任意
已知状态进入，但仍先满足原有 graph/选择对象/测量模式资格检查。

| 事件 | 起始状态 | 允许目标 |
| --- | --- | --- |
| `PREVIEW_STARTED` | 任意正式状态 | `wallPreview` |
| `LENGTH_HELD`、`ANGLE_PREVIEW_UPDATED` | `wallPreview` | `awaitingLength` |
| `DIRECTION_LOCKED` | 任意正式状态 | `awaitingLength` |
| `DIRECTION_CLEARED` | `awaitingLength` | `idle` / `cursorPlaced` / `wallCommitted` |
| `DIAGONAL_REOPENED` | `wallCommitted` | `awaitingLength` |
| `OBJECT_SELECTED` | 任意正式状态 | `wallSelected` |
| `WALL_SNAP_STARTED` | 任意正式状态 | `wallSnapPending` |
| `CURSOR_PLACED` | 任意正式状态 | `cursorPlaced` / `wallCommitted` |
| `CURSOR_RESET` | 任意正式状态 | `cursorPlaced` / `wallCommitted` / `spaceClosed` |
| `PENDING_CANCELLED` | 任意正式状态 | `idle` / `cursorPlaced` / `wallCommitted` / `spaceClosed` |
| `REMEASURE_STARTED` | 任意正式状态 | `remeasureAwaitingInput` |
| `WALL_COMMITTED` | `wallPreview` / `awaitingLength` | `wallCommitted` / `closing` / `mergeClosing` |
| `CLOSURE_CANDIDATE_RESOLVED`、`OPEN_CHAIN_RESUMED` | 任意正式状态 | `wallCommitted` / `closing` / `mergeClosing` |
| `CLOSURE_COMPLETED` | 任意正式状态 | `spaceClosed` |
| `CLOSURE_JOINED` | 任意正式状态 | `closing` |
| `WALL_DELETED` | 任意正式状态 | `idle` / `cursorPlaced` / `wallCommitted` / `spaceClosed` / `wallSelected` |
| `REMEASURE_COMPLETED` | 任意正式状态 | `wallCommitted` / `spaceClosed` |

非法状态/事件/目标组合返回 `ok: false` 与 `INVALID_SESSION_TRANSITION`，包含
`from/event/to` 详情；应用函数拒绝且不修改输入。原本由命令前置条件决定的 no-op 和
中文错误保持不变。例如无预览的 `holdPreviewForInput` 仍为 no-op，方向模式/角度不合法
仍返回原错误。历史组件键盘快照的 `openingSelected` 仅在转换入口按 `wallSelected`
兼容读取，不新增正式状态，也不作为新结果输出。

42 个 session 字段是原 38 个默认字段加 4 个可选字段，各字段恰有一个组：

- `preview`：10 个，含状态、光标、预览点/长度/角度、模式、pending wall 和方向锁。
- `selection`：3 个，选中墙、开口、空间。
- `closure`：18 个，候选、活动墙链/共享墙、分隔来源、上次墙体吸附、闭合节点及拆分校验交接标记。
- `measurement`：10 个，墙厚、测量侧/实体侧、端部内缩/延伸、外侧面目标墙和固定节点。
- `viewport`：1 个，即 `alignmentSnapGuide`；实际视口继续是 `floor.viewport`。

`readSessionGroups` 提供隔离副本；原有 session 属性名和保存方式不变。
页面旋转、设备方向、触摸锁与 BLE 回调继续由 editor 管理，`rotationRad` 仍不写入
`floor.viewport`。领域层没有 `wx`、Toast、触控处理、BLE 调用或云端保存能力。

## 3. 吸附策略与不变量

- 预览按正交约束、前一斜墙方向、第三墙矩形、重启链矩形、顶点轴对齐、直接起点闭合
  的原顺序计算；矩形引导存在时跳过轴对齐。最终引导优先级为直接起点、重启矩形、
  第三墙矩形、顶点轴、前一斜墙方向。
- 确认读数后重新应用矩形/闭合对齐，外侧 T 链有效测量长度和反向缩墙仍有原保护优先级；
  最近射线边界截断、共享墙投影、外侧面和分隔候选不改容差与判定顺序。
- 普通查询和 Canvas 缓存索引共用内角一墙厚保护半径、外角 40% 终端带、外侧投影
  竞争规则以及顶点 > 墙 > 轴对齐的锁定升级顺序；索引只缓存几何，不另定优先级。
- `resolveSnap` 的屏幕像素 acquire/release、scale 换算和旧锁保持规则未调整。
- 输入 graph/session、测量审计、门窗位置、Space 同步、失败原子性、重复调用和
  snapshot undo/redo 保持冻结行为；未更新行为/性能快照，未放宽 validator。

## 4. 验收证据

冻结参考 `test/fixtures/survey-kernel-phase5/{interaction-reference,cursor-index-reference}.js`
来自 Phase 4D 提交 `8fff5dd7`，只调整依赖路径；新交互代码不充当旧实现替身。

`test/survey-kernel-phase5-interaction.test.js` 包含每个允许状态转换的独立测试，并穷举
禁止组合；20 类公共命令在 11 类图和所有正式状态下比较两端 façade/legacy 代理，覆盖
成功、no-op、错误、重复输入、结果再执行和撤销/重做。完整 4,096 场景矩阵对每次
preview/commit/wall snap 执行冻结差分，保留原几何、Canvas、门窗与 full 校验断言。
独立确认计划还覆盖延长、缩短、整段回撤、shared/outer/partition、禁止读时钟、无输入
别名和同 plan 双应用；后置 invariant 失败保留输入与历史。吸附同时比较冻结缓存索引，
覆盖 acquire/release 精确边界和不同 scale。

```powershell
npm --prefix miniprogram run test:survey-kernel-phase5
npm --prefix miniprogram test
npm --prefix admin run test:survey-read-models
node admin/scripts/sync-survey-dimension-plan.mjs
git diff --check
```

- 新增 Phase 5 测试 368 项；组合验收 1,089 / 1,089 量房/编辑器测试、55 / 55 H5
  测试通过。Admin 消费者 39 / 39 通过（8 项 Canvas/PNG + 31 项 DXF/房间/3D/AI）。
- 全量小程序 1,592 项，1,578 通过、14 失败；失败名称逐项与
  [Phase 0 既有失败清单](./legacy-kernel-phase0-baseline.md) 相同，没有新增失败。
  未修改这些 account/API/设计/分包/平台工作台测试或对应 UI 来消除既有失败。
- 大图仍为 273 节点 / 512 墙 / 240 空间；clone、quick、full、墙读模型、空间读模型
  中位数分别为 0.641 / 0.341 / 12.120 / 71.467 / 38.917 ms，保留克隆堆增量
  3,727,960 bytes；所有既有性能门槛通过，未修改阈值。
- kernel 从 3,193 行 / 80 个顶层函数降为 277 行 / 7 个顶层函数。74 模块 / 377 条边、
  77 对镜像（76 对精确源码 + 1 对 renderer 路径改写）通过审计；64/69 个公共导出不变。
  原 17 个多来源导出增加到 42 个，因为已迁移入口与 legacy 代理并存；每个胜出来源
  均显式绑定，不依赖覆盖顺序。
- 架构护栏要求 interaction/session/snap 依赖闭包无 kernel、operations、运行 ID、UI
  或 BLE；动态阻断 kernel 与客户端模块后，两端仍能独立创建光标、锁方向并事务落墙。
  仅更新导出来源/依赖/消费者审计快照；冻结行为和性能快照、validator 均未修改。
- 中英文正式量房合同及两端模块清单已同步；引用路径、中英文状态/数据与完整 diff
  已核对，`git diff --check` 通过。

## 5. 保留限制与下一阶段

对外合同无变化：UI、文案、手势、吸附阈值、画布、唯一量房路由、API、角色、租户权限、
BLE 协议、测量审计队列和正式 v4 数据外壳均不改变；无需新的设计源或微信 DevTools
自动化。本次没有修改 editor 的设备/触控回调、WXML、样式、Canvas renderer 或图片。

Phase 6 继续处理 legacy 导出分类、兼容层剩余修复/命名/墙厚/测量侧入口、旧死函数及
运行来源审计；Phase 7 继续最终文档和长期治理。保留 Admin 生成镜像与所有 64 个 legacy、
69 个 façade 导出，不宣称整体治理已完成。
