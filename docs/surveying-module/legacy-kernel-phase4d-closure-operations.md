# `legacy-kernel.js` Phase 4D 闭合事务迁移记录

> 状态：已完成（Implemented）
>
> 完成日期：2026-09-04
>
> 对外合同：无变化

## 1. 权威模块与事务边界

Mini Program 的 `packages/surveying/utils/survey/` 仍是唯一权威源，Admin 的
`src/lib/survey-runtime/survey/` 由既有同步脚本生成镜像，不维护另一套闭合算法。

| 模块 | 当前职责 |
| --- | --- |
| `topology/closure-candidates.js` | 纯 preview/committed candidate 计划，保留原候选优先级及起点闭合判定 |
| `topology/closure-plans.js` | 纯 preview/direct/no-op、bridge、merge、partition 和正交平差意图；只携带值与 ID |
| `topology/wall-alignment.js` | 闭合边界实体侧、测量侧和端部内缩的原有只读查询 |
| `operations/closure-candidate.js` | 复制候选 patch 到工作 session，不保留计划对象引用 |
| `operations/closure.js` | 闭合 plan/apply、兼容错误代理和独立 `confirmClosure` full 事务 |
| `operations/wall-mutation-helpers.js` | 共享节点构造、共线合并、门窗/审计迁移和墙体指标同步 |
| `operations/transaction.js` | 唯一外层事务克隆、触时及 full invariant 校验，语义不变 |

计划生成不修改 graph/session、不读取时钟、不分配运行 ID、不保存整图回放快照，
也不把调用方的节点、墙或空间对象挂到计划中。缺失 session 字段只在隔离值副本上规格化。
候选计划与候选应用分属 topology 和 operations。

闭合存在先后依赖：预览需先落墙，merge 需先补连接段，之后才能决定最终共享墙切点。
因此一次事务内按阶段规划并应用，不能先在原图上预造全部后续结果。所有阶段使用同一
事务工作草稿；创建节点/墙的 ID 与时间仅发生在 apply。共享墙切点、门窗迁移、共线合并、
实体侧和 Face/Space 同步完成后，外层统一执行 full validator；不嵌套另一个事务，
不在中间半成品上提前提交。

façade 显式绑定 `transactionalClosures.confirmClosure`，不再经过
`wall-operations.js` 或 kernel 的旧闭合函数体。kernel 保留错误兼容代理。
预览确认通过显式注入的 `commitPreviewLength` 回调复用现有落墙编排；闭合模块不导入
kernel 或 façade，已提交墙链闭合无需回调。该交互编排仍属于 Phase 5，不宣称已迁移。

## 2. 保持不变的行为

- 预览/落墙候选的起点、外侧面、共享墙、反向续墙、merge 与 partition 优先级、容差及
  最小墙数不变；不新增吸附策略或 UI 状态。
- 直墙保持正交：允许既有端点 snap、短正交桥接和预算内正交平差，不把偏轴目标直接
  写成斜直墙。斜墙维持原有闭合语义。
- merge 保持连接段的测量侧/实体侧、端部内缩、首段共线延长和审计分摊；
  partition 保持源空间、两个边界切点及闭合空间数量增长检查。
- 共享墙闭合保留原房间 ID/名称、面积与边界方向；多个空间、内/外测量面、不同墙厚、
  凹房间与连续分隔线继续使用同一拓扑与 Face 同步合同。
- 两切点门窗安全迁移、开口净距冲突拒绝、未打断交叉和后置 invariant 失败保持原子性；
  错误码、中文文案及详情不变。失败后整个输入、session 和调用方撤销历史保持不变。
- raw/effective/closure 毫米审计关系、门窗世界坐标、session 清理、重复确认/no-op 及
  snapshot undo/redo 与冻结旧实现一致。允许原有零读数拓扑连接段，不制造仪器读数。

## 3. 冻结差分与架构证据

`test/fixtures/survey-kernel-phase4d/closure-reference.js` 冻结自 Phase 4C 提交
`085c698bf728` 的 kernel。只调整相对依赖路径和行末空白；闭合、候选与迁移 helper 的
函数逻辑冻结。已有 Phase 4A–4C 基础设施仍复用生产模块。测试不依赖运行时 Git，
也不使用新闭合模块作为旧实现替身。

新增 `test/survey-kernel-phase4d-closure-operations.test.js` 的 18 项测试覆盖：

- 复用完整 4,096 个正式场景矩阵，在 `confirmClosure` 边界同时执行冻结旧函数和新事务，
  对比整图、session、成功或错误与输入不变性；保留原矩阵几何、Canvas 和存档断言。
- H5 场景目录在每次 preview/commit 上额外执行冻结候选差分，避免只比较最终闭合结果。
- 冻结 plan、禁止读时钟、重复规划、同 plan 双 apply、错误楼层、candidate patch 无引用泄漏。
- preview/direct/merge/partition/no-op 在 Mini/Admin façade 与 legacy 代理上进行独立
  差分，比较 full/quick validator、引用完整性及读模型；覆盖重复输入、对结果再次调用、
  撤销与重做。
- 门窗冲突与后置 full 校验失败不改变调用方草稿及历史。
- 静态依赖闭包无循环、kernel/façade/editor/BLE/客户端能力反向依赖；
  动态阻断这些模块加载时，两端闭合模块仍可独立加载并执行。

行为比较只归一化运行 ID 和时间戳，持久化毫米数值精确比较，派生读模型沿用既有容差；
未更新 `expected-behavior.json` 或 `performance-baseline.json`，未放宽 validator。
仅刷新反映新模块、消费者和显式来源的 `expected-audit.json`。

当前 kernel 从 4,319 行 / 110 个顶层函数降至 3,193 行 / 80 个顶层函数。
45 模块 / 202 边、48 对镜像（47 对精确源码 + 1 对 renderer require 路径改写）通过审计；
64 个 legacy 与 69 个 façade 导出均保持不变。冻结参考和测试已由项目打包排除规则隔离，
不进入小程序运行包。

## 4. 验收结果

```powershell
npm --prefix miniprogram run test:survey-kernel-phase4d
npm --prefix miniprogram test
npm --prefix admin run test:survey-read-models
node admin/scripts/sync-survey-dimension-plan.mjs
git diff --check
```

- Phase 4D 组合验收：721 / 721 量房/编辑器测试、55 / 55 H5 测试全部通过。
- Admin 消费者：39 / 39 通过（8 项 Canvas/PNG + 31 项 DXF/房间/3D/AI/读模型）。
- 大图：273 节点 / 512 墙 / 240 空间；clone、quick、full、墙读模型、空间读模型中位数
  分别为 0.796 / 0.379 / 13.267 / 70.399 / 40.283 ms，保留克隆堆增量 3,727,928 bytes；
  所有既有性能门槛通过。
- 全量小程序：当前工作区 1,224 项，1,210 通过，14 失败。失败名称逐项与
  [Phase 0 已知失败清单](./legacy-kernel-phase0-baseline.md)
  一致，属于 account/API/设计/分包/平台工作台，不在本批闭合变更路径中。
  未修改这些测试断言或对应 UI 来消除失败。
- 中英文正式量房合同和两端模块清单已同步；差异检查确认对外合同无变化。
  没有新增路由、API、角色、租户权限、UI、设计源、BLE 协议或正式 v4 数据字段；
  Admin 消费者仍只读，不创建新的后台写入口。

## 5. 下一阶段

Phase 4D 完成。Phase 5 仍需分离 session 状态机、preview/snap 交互和
`commitPreviewLength` 编排；Phase 6 兼容层/运行来源收口和 Phase 7 最终治理未完成。
本次无可见 UI 改动，不需要设计源变更或微信 DevTools 自动化验收。
