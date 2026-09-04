# `legacy-kernel.js` 渐进式治理计划

> 状态：执行中
>
> 当前阶段：Phase 4B — 墙体结构操作
>
> 最后检查：2026-09-04
>
> 适用范围：小程序正式量房墙图内核及其 Admin 只读运行镜像

## 1. 文档用途

本文是 `legacy-kernel.js` 跨多轮会话的执行计划和当前检查点。它用于指导内部重构，
不代表计划中的模块已经实现，也不替代当前代码、测试和正式量房合同。

开始任何一轮治理前，必须同时阅读：

- 仓库根目录 `AGENTS.md`；
- `docs/surveying-module/README.md`；
- `docs/surveying-module/formal-surveying.md`；
- 本文的“当前检查点”和目标阶段；
- 当前工作树中的相关实现和测试。

`docs/surveying-module/implementation_plan.md` 与
`docs/surveying-module/analysis_results.md` 属于历史规划或分析材料，不能用来证明当前能力。

## 2. 当前事实基线

截至本文建立时：

- 小程序公共入口是
  `miniprogram/packages/surveying/utils/surveyWallGraph.js`；
- 核心兼容实现是
  `miniprogram/packages/surveying/utils/survey/legacy-kernel.js`；
- `legacy-kernel.js` 约 7,240 行，包含约 245 个顶层函数和 64 个导出；
- 它同时承担 session 状态、预览、吸附、墙体写入、闭合、拓扑、门窗、复尺和部分读模型；
- `surveyWallGraph.js` 通过 façade 合并 kernel、事务 wrapper 和 read-model；
- Admin 运行时保留一份同步镜像：
  `admin/src/lib/survey-runtime/survey/legacy-kernel.js`；
- BLE 协议解析主要位于 `miniprogram/utils/bluetooth.js`，不属于本次 kernel 拆分主体；
- 建立本文前执行的测量相关定向测试共 477 项，全部通过。该数字只是初始快照，
  后续以实际测试发现数和结果为准。

当前判断不是“算法不可用”，而是核心写路径长期集中在兼容单体中，导致边界不清、
修改影响面难以判断、重复基础实现难以收口。

## 3. 治理目标

治理完成后应达到以下状态：

1. `surveyWallGraph.js` 是稳定的兼容 façade，不承载领域实现。
2. 墙图持久化写入只能经过明确的事务操作。
3. 几何、拓扑、测量语义、交互策略、session 和读模型有单向依赖边界。
4. 同一基础算法只有一个权威实现。
5. read-model 只读取 graph，不修改 graph，也不回写 legacy layout。
6. BLE、WeChat UI 和 Admin 展示层不进入领域内核。
7. Mini Program 与 Admin 使用同一权威源码或可验证的生成镜像。
8. 所有迁移均有旧行为对照、独立验收门槛和可回滚提交。

目标依赖方向：

```text
BLE / WeChat Editor / Admin adapter
                |
                v
       interaction / operations
                |
                v
      topology / measurement domain
                |
                v
       graph core / pure geometry
                |
                v
             read-model
```

禁止出现的反向依赖包括：

- 几何模块依赖 editor、BLE、`wx` 或 façade；
- topology 模块调用 UI Toast 或拼装用户文案；
- read-model 修改 graph；
- 新模块为了方便而依赖整个 `legacy-kernel.js`；
- façade 通过导出覆盖顺序隐式决定实际实现。

## 4. 全程不可变约束

除非用户另行明确批准合同变更，否则整个治理期间必须保持：

1. `FloorPlan.layoutData` 只包含 `version: 4`、
   `measurementMode: 'surveying'` 和 `surveyGraph`。
2. 墙图长度、坐标、墙厚、门窗和层高继续使用毫米。
3. BLE 原始响应、正式测量审计、首次云保存前的待发送记录行为不变。
4. 唯一正式编辑入口仍为
   `miniprogram/packages/surveying/editor/surveying-editor.*`。
5. 不恢复 legacy editor、legacy layout copy 或第二套 geometry source of truth。
6. 现有路由、API、角色、租户边界和权限语义不变。
7. 现有 64 个兼容导出在确认无调用并完成迁移前不得删除。
8. 内核治理不与 UI 改版、数据库迁移或新业务功能合并提交。
9. 不以“文件变短”作为完成标准；以依赖方向、单一职责和行为等价为标准。

## 5. 通用迁移方法

每迁移一个函数族或业务操作，都按以下顺序执行：

1. **刻画旧行为**：补齐成功、失败和边界场景测试。
2. **明确不变量**：列出允许修改和必须保持不变的 graph/session 字段。
3. **实现新边界**：新代码不反向依赖整个 kernel。
4. **差分执行**：把同一输入分别交给旧实现和新实现，不允许同时修改同一对象。
5. **语义比较**：比较持久化 graph、session、错误码和派生读模型。
6. **接管 façade**：只切换当前操作，不同时切换其他高风险操作。
7. **删除重复实现**：确认全仓无调用后，才移除旧函数及兼容分支。
8. **运行验收**：执行定向测试、模块测试、文档检查和 diff 检查。

语义比较不能只依靠原始 JSON 字符串。比较器应：

- 对不影响语义的集合进行稳定排序；
- 仅忽略明确列出的易变元数据，不能忽略领域字段；
- 持久化毫米值和拓扑关系原则上精确相等；
- 派生浮点几何使用显式、公认的误差范围；
- 单独验证输入对象未被意外修改；
- 单独验证节点、墙、开口、空间引用不存在悬空或重复。

## 6. 分阶段执行计划

### Phase 0：建立可复现基线

目标：在改实现前，把当前行为、依赖和性能变成可以重复检查的基线。

任务：

- [x] 记录 façade 的全部导出、导出来源及覆盖关系。
- [x] 搜索 Mini Program、Admin、测试和脚本中的全部调用方。
- [x] 绘制当前模块依赖图，区分生产可达、editor 直连、测试专用和疑似死代码。
- [x] 建立代表性 fixture：空图、单墙、连续墙、闭合矩形、L 形空间、共享墙、
      斜墙、带门窗墙、分裂墙、多空间、复尺墙。
- [x] 保存关键操作的输入、输出、session、错误码和 read-model 基线。
- [x] 记录大户型场景的执行时间和内存基线；性能阈值根据基线确定，不先拍脑袋设值。
- [x] 固化可重复运行的测试命令。

验收门槛：

- 当前旧实现通过全部基线测试；
- 每个高风险操作至少有一个成功场景和一个失败场景；
- 依赖图能够解释每个 façade 导出的实际来源；
- 本阶段不改变任何生产行为。

Phase 0 的机器快照、人工可读清单、性能阈值和重复执行命令见
[`legacy-kernel-phase0-baseline.md`](./legacy-kernel-phase0-baseline.md)。

建议提交：

```text
test: capture surveying kernel baseline
```

### Phase 1：建立合同与差分护栏

目标：使后续每次迁移都能自动回答“新旧行为是否一致”。

任务：

- [x] 保留并扩展 legacy CommonJS 导出合同测试。
- [x] 建立 graph 语义规范化与比较 helper。
- [x] 建立旧实现/新实现双跑 harness，仅用于测试。
- [x] 为 `validateSurveyDraft` 的 `quick` 和 `full` 模式补齐操作后校验。
- [x] 覆盖失败原子性：失败时 graph 和 session 不得留下半次操作。
- [x] 覆盖输入不可变性及重复调用的一致性。
- [x] 对 Mini Program 源码与 Admin 镜像增加一致性验证。

验收门槛：

- 差分 harness 能报告具体到节点、墙、开口、空间或 session 字段的差异；
- 测试不得通过大范围删除字段或放宽 validator 来掩盖差异；
- 原有测量测试和新增合同测试全部通过。

建议提交：

```text
test: add surveying kernel differential harness
```

完成证据与重复执行规则见
[`legacy-kernel-phase1-differential.md`](./legacy-kernel-phase1-differential.md)。

### Phase 2：收口纯基础能力

目标：先移除最低风险的重复实现，不触碰高层工作流。

推荐顺序：

1. `cloneDraft`、`getActiveFloor`、`touchDraft` 等 draft 基础操作；
2. session 字段定义、引用收集和状态常量；
3. `vector2` 基础运算；
4. segment 相交、投影和关系判断；
5. polygon 面积、方向和自交判断；
6. wall/opening 的纯规格化与长度计算；
7. 领域错误码和 UI 文案映射边界。

执行规则：

- [x] 每次只收口一个基础函数族。
- [x] kernel 先改为调用权威模块，再删除 kernel 内重复实现。
- [x] 纯函数模块不能读取或修改 editor/session 全局状态。
- [x] 领域层返回错误码和结构化详情；旧消息由兼容导出边界适配。
- [x] 不趁机调整吸附阈值、闭合规则或视觉反馈。

验收门槛：

- 基础能力只有一个生产实现；
- 新模块没有反向依赖 kernel；
- 所有差分、validator 和现有测试通过；
- 性能变化已记录且无未解释的显著回退。

建议按函数族分别提交：

```text
refactor: centralize survey draft helpers
refactor: centralize survey geometry primitives
refactor: separate survey domain errors
```

完成证据与当前权威模块映射见
[`legacy-kernel-phase2-foundations.md`](./legacy-kernel-phase2-foundations.md)。

### Phase 3：迁移只读模型

目标：让派生视图先脱离 kernel，降低后续写操作的影响面。

推荐顺序：

1. 墙中心线和墙实体几何；
2. wall faces；
3. space boundary；
4. space dimensions；
5. canvas/Admin/DXF 所需的其他只读适配结果。

任务：

- [x] read-model 直接依赖 graph、topology 和 pure geometry，而不是整个 kernel。
- [x] 为每个 read-model 添加“不修改输入 graph”测试。
- [x] 对代表性 fixture 比较新旧输出。
- [x] 检查小程序画布、Admin 2D 查看器、预览图、DXF、3D 和 AI 适配器的消费者。
- [x] 移除 façade 中依赖 `Object.assign` 覆盖顺序的隐式选择。

验收门槛：

- read-model 全部是只读的；
- 不写入 `FloorPlan.layoutData` 的派生副本；
- Mini Program 和 Admin 对同一 graph 产生一致的语义输出；
- 当前 UI、API 和权限没有变化。

建议提交：

```text
refactor: extract survey graph read models
```

完成证据、消费者映射、只读/差分护栏与性能对照见
[`legacy-kernel-phase3-read-models.md`](./legacy-kernel-phase3-read-models.md)。

### Phase 4：按业务操作迁移写路径

目标：将 graph 修改集中到明确的事务 operation 中。

所有写操作统一采用：

```text
校验前置条件
  -> 生成变更计划
  -> 在事务草稿上应用
  -> 校验 graph 不变量
  -> 同步 topology / spaces
  -> 返回 graph、session 和结构化结果
```

优先复用已有 `operations/transaction.js`、validator、face extractor 和 space sync，
不要平行建立第二套事务框架。

#### Phase 4A：门窗及低拓扑风险操作

- [x] `addOpeningToWall`
- [x] `updateOpening`
- [x] `deleteOpening`
- [x] opening 规格化、越界和墙体关系校验

完成证据、行为差分、失败原子性及依赖边界见
[`legacy-kernel-phase4a-opening-operations.md`](./legacy-kernel-phase4a-opening-operations.md)。

#### Phase 4B：墙体结构操作

- [ ] `splitWallAtNodes`
- [ ] `deleteWall`
- [ ] `deleteClosedSpace`
- [ ] 操作后的 opening 迁移、session 引用清理和 space 同步

#### Phase 4C：测量写入

- [ ] `remeasureSelectedWall`
- [ ] 实测长度、有效长度和闭合平差的持久化关系
- [ ] `commitPreviewLength` 中可独立的测量写入部分

#### Phase 4D：闭合与合并

- [ ] closure candidate 的纯计划生成
- [ ] bridge / merge / partition 计划
- [ ] `confirmClosure`
- [ ] 多空间、共享墙和闭合后分裂的完整校验

`confirmClosure` 是最后迁移的最高风险操作。它不得与新的吸附策略、UI 状态或数据合同
变更合并实施。

每个操作的接管门槛：

- 新旧实现在全部对应 fixture 上语义一致；
- 成功、失败、撤销/重做和重复调用均被覆盖；
- 失败操作保持原子性；
- façade 只切换这一个操作；
- 全仓确认无旧调用后才删除 kernel 中的旧实现。

建议一个操作或一个紧密函数族一个提交：

```text
refactor: migrate survey opening operations
refactor: migrate survey wall split transaction
refactor: migrate survey wall deletion transaction
refactor: migrate survey wall measurement transaction
refactor: migrate survey closure transaction
```

### Phase 5：分离交互策略和 session 状态机

目标：让 editor 负责设备/手势输入，让 interaction 层产生意图，让 operation 层修改 graph。

任务：

- [ ] 明确定义 session 状态、事件、允许转换及非法转换结果。
- [ ] 将 42 个散落 session 字段按 preview、selection、closure、measurement、viewport 分组。
- [ ] 收口 `snap-engine`，明确吸附候选的输入、优先级和输出。
- [ ] 分离 preview、wall snap、closure candidate 和 direction lock。
- [ ] `startPreview` 只编排明确的 interaction service，不再包含拓扑写入细节。
- [ ] `commitPreviewLength` 将交互确认与领域事务分开。
- [ ] editor 继续处理 `wx`、Toast、触控和 BLE 回调；领域模块不得引用这些能力。
- [ ] 保持现有提示、手势、吸附阈值和画布表现，除非用户单独批准行为变更。

验收门槛：

- 每个状态转换都有独立测试；
- 相同 graph、session 和输入事件产生确定结果；
- interaction 层不能直接持久化 graph；
- operation 层不依赖 WeChat 或 BLE。

建议提交：

```text
refactor: extract surveying interaction state machine
refactor: isolate surveying snap policy
```

### Phase 6：收缩兼容层并统一运行来源

目标：消除 kernel 作为实现中心的角色，同时保留必要的兼容入口。

任务：

- [ ] 为 64 个 legacy 导出标记“已迁移、兼容代理、仍待迁移、可删除”。
- [ ] 全仓搜索每个待删除导出，包括动态属性访问和测试引用。
- [x] 将 `surveyWallGraph.js` 改为显式导出，避免合并顺序覆盖实现（Phase 3 已完成）。
- [ ] 让 `legacy-kernel.js` 只保留尚未迁移的兼容代理。
- [ ] 评估 WeChat 构建和 Next.js 运行约束后，确定单一权威源码方案。
- [ ] 在共享 package 尚不稳妥时，保留“Mini Program 为权威源、Admin 为生成镜像”的方式，
      并用同步检查阻止漂移。
- [ ] 只有在构建和运行环境都验证后，才移除 Admin 镜像或同步脚本。
- [ ] 删除全部死代码、无生产消费者的过渡模块和重复测试 helper。

验收门槛：

- 生产调用不再依赖 kernel 内的领域实现；
- façade 每个导出的来源显式可查；
- Mini Program 与 Admin 不存在人工维护的两套逻辑；
- 原有合同、全量测试、构建和文档检查全部通过；
- 删除 kernel 前，必须有一次独立的仓库调用审计。

建议提交：

```text
refactor: make survey graph exports explicit
refactor: retire legacy survey kernel
```

### Phase 7：完成文档与长期防回退约束

目标：让新边界成为后续开发的默认道路，而不是短期整理结果。

任务：

- [ ] 在正式量房文档中记录最终模块边界、写入路径和不变量所有权。
- [ ] 更新受影响的中英文模块清单或合同文档。
- [ ] 增加架构测试，禁止 pure geometry/read-model 反向依赖 editor、BLE 或 legacy kernel。
- [ ] 增加重复导出、循环依赖、Mini/Admin 镜像漂移检查。
- [ ] 更新新功能接入说明：新增规则应放在哪一层、需要哪些测试。
- [ ] 确认本文所有阶段已完成，再将状态改为“已完成”。

验收门槛：

- 代码、测试和当前文档互相一致；
- 没有靠注释或计划文档替代实际实现；
- `git diff --check` 通过；
- 最终交付明确列出任何仍保留的兼容限制。

## 7. 推荐的多轮执行顺序

默认按以下会话/工作单元推进；一个单元过大时继续细分，不为了赶轮次合并职责：

| 轮次 | 工作单元 | 风险 |
| --- | --- | --- |
| 1 | Phase 0：依赖、消费者、fixture 和基线 | 低 |
| 2 | Phase 1：差分 harness 与合同护栏 | 低 |
| 3 | Phase 2：draft/session 基础能力 | 低 |
| 4 | Phase 2：纯几何与领域错误 | 低至中 |
| 5 | Phase 3：只读模型 | 中 |
| 6 | Phase 4A：门窗操作 | 中 |
| 7 | Phase 4B：墙体分裂 | 高 |
| 8 | Phase 4B：墙体/空间删除 | 高 |
| 9 | Phase 4C：复尺和测量写入 | 高 |
| 10 | Phase 4D：闭合计划 | 很高 |
| 11 | Phase 4D：闭合事务接管 | 很高 |
| 12 | Phase 5：吸附、预览与状态机 | 很高 |
| 13 | Phase 6：façade 和运行来源收口 | 中至高 |
| 14 | Phase 7：死代码、架构守卫和文档收口 | 中 |

轮次不是工期承诺。每轮是否完成，完全取决于该轮验收门槛，而不是是否提交了代码。

## 8. 测试与验证矩阵

每轮选择与改动相称的最窄测试，但高风险接管前必须逐级扩大：

| 层级 | 必须验证的内容 |
| --- | --- |
| 纯函数 | 单元、边界、退化输入、随机或性质测试 |
| operation | 新旧差分、原子性、validator、输入不可变 |
| graph | 节点/墙/开口/空间引用、闭合和共享墙不变量 |
| interaction | 状态转换、吸附优先级、预览与确认路径 |
| Mini Program | 相关 Node 测试及 `cd miniprogram && npm test` |
| Admin 镜像 | 同源/哈希检查及相关 Admin 测试或构建检查 |
| 文档 | 路径、API、状态标签、中英文一致性、`git diff --check` |

初始定向测试命令可作为 Phase 0 的起点，但应在基线阶段确认并固化：

```powershell
Set-Location miniprogram
node --test test/survey*.test.js test/surveying-editor*.test.js
```

正式接管高风险操作前，还应运行完整的 `miniprogram` 测试。若完整测试存在与本次无关的
既有失败，必须记录具体失败和基线证据，不能笼统写“测试已通过”。

## 9. 暂停与回滚条件

发生以下任一情况，应停止当前迁移，保留证据并回到当前阶段最近的独立提交：

- 新旧输出出现无法解释的 graph、session 或错误语义差异；
- `layoutData` 外壳或正式 v4 graph 合同发生非预期变化；
- validator 被迫放宽才能让新实现通过；
- 闭合、共享墙、门窗或复尺出现悬空引用或非原子修改；
- Mini Program 与 Admin 对同一输入产生不同结果；
- 为完成内部重构必须改变 UI、API、权限或数据库合同，但尚未得到用户批准；
- 测试只在删除断言、跳过场景或扩大误差范围后才能通过；
- 性能出现显著回退且原因未查明。

回滚针对当前小步提交，不使用破坏工作树的方式覆盖用户未提交内容。

## 10. 每轮会话的工作协议

### 开始时

1. 阅读本文当前检查点和目标阶段。
2. 检查 `git status`、近期相关提交和用户已有改动。
3. 确认本轮只处理一个明确函数族或业务操作。
4. 先读取该模块的当前实现、消费者、测试和正式量房合同。
5. 写出本轮保持不变的行为和验收命令，再开始编辑。

### 结束时

1. 检查完整 diff，确认没有夹带其他职责。
2. 运行对应测试、文档和 `git diff --check`。
3. 更新下方“当前检查点”，只保留最新状态和下一步，不粘贴完整测试日志。
4. 如果行为、路由、API、权限或数据合同变化，同步更新相应中英文文档。
5. 如果只是内部等价重构，明确记录“对外合同无变化”。
6. 使用英文 Conventional Commit subject，并保持一个提交只覆盖相关变化。

## 11. 当前检查点

### 当前阶段

Phase 4B — 墙体结构操作。

### 已完成

- [x] Phase 0/1 的导出、消费者、依赖、行为快照、差分 harness、失败原子性、重复执行、
      validator 和性能门槛保持有效；Phase 0 行为快照和性能阈值未重建或放宽。
- [x] Phase 2 完成 draft/session、纯几何、wall/opening 规格化与长度、领域错误和旧消息
      边界收口，并补齐四个冻结公式与 legacy 空楼层语义；详见 Phase 2 完成记录。
- [x] Phase 3 按墙体、空间边界、尺寸的函数族顺序迁移；四个 read-model 模块直接依赖
      graph 查询、闭合墙链和纯基础模块，可在 kernel 与写操作不可用时独立加载。
- [x] Phase 3 将 32 个只读/查询函数体移出 kernel。
      64 个 legacy 导出与 69 个 façade 导出保留，原 17 个同名提供者改为显式选择；
      审计不再靠覆盖顺序推断来源。
- [x] 为每个公开读模型及共享内部 helper 增加输入写入拦截、重复执行、冻结公式精确
      差分和双端验证；覆盖 11 类冻结图、48 组确定性变体及退化输入，另有依赖与导出守卫。
- [x] 核查小程序画布、Admin 2D、PNG、DXF、房间/3D 数据和 AI 消费者；场景与 graph
      语义不变，不生成可编辑派生副本或回写额外的 `layoutData` 字段。
- [x] Phase 3 是内部行为等价重构；路由、API、角色、权限、UI、吸附/闭合阈值、错误
      文案与 version-4 持久化合同无变化。完成证据见
      [Phase 3 只读模型迁移记录](./legacy-kernel-phase3-read-models.md)。
- [x] Phase 4A 已迁移 `addOpeningToWall`、`updateOpening`、`deleteOpening` 和宿主墙
      规格化/校验。三个 operation 使用只读 plan、事务草稿、既有 invariant validator 与
      结构化结果；门窗操作不改变 wall/node/Space 拓扑，因此无需额外 space 同步。
- [x] 迁移前 Phase 3 mutation 作为测试专用冻结参考；15 类输入分别与 Mini Program/Admin 的
      legacy proxy 和 transactional façade 差分，另覆盖计划只读、失败原子性、undo/redo、入户门唯一性、
      宿主墙关系、越界校验、依赖闭包和旧函数体移除。
- [x] 三个 mutation 函数体已从 kernel 删除；kernel 当前为 6,064 行 / 173 个顶层函数。
      64 个 legacy 导出与 69 个 façade 导出保持不变，opening façade 不再注入 kernel。
- [x] 当前结构为 32 个模块节点 / 91 条边；35 对运行镜像继续通过源码哈希审计
      （34 对精确副本及 1 对已批准 renderer 路径改写）。
- [x] `npm --prefix miniprogram run test:survey-kernel-phase4a` 通过 604 项量房定向测试、
      55 项 H5 测试和大图性能门槛；Admin 38 项消费者测试通过。完整小程序测试 1,095 项中
      1,081 项通过，14 项失败名称仍与 Phase 0 无关既有清单一致。
- [x] Phase 4A 是内部行为等价重构；路由、API、角色、权限、UI、错误文案、吸附/闭合策略
      与 version-4 持久化合同无变化。完成证据见
      [Phase 4A 门窗事务迁移记录](./legacy-kernel-phase4a-opening-operations.md)。

### 仍保留的边界

- [ ] Phase 4B–4D 的墙体结构、复尺/测量与闭合写操作仍待迁移；Phase 5 交互/session
      分离尚未开始。
- [ ] legacy kernel 仍保留尚未迁移的写操作和交互查询；兼容导出未删除或改变。
- [ ] Phase 6 运行来源收口及 Phase 7 最终治理仍待完成；显式 façade 已由 Phase 3 接管。

### 下一步唯一目标

执行 Phase 4B 的首个墙体结构事务：迁移 `splitWallAtNodes`。先冻结无切点、单切点、
多切点、共享墙、宿主 opening 安全迁移/冲突拒绝、session 引用和 Space 同步语义，再复用
既有事务与 full invariant validation 接管；不同时迁移 `deleteWall`、改变 UI、吸附/闭合
策略或正式 v4 数据合同。

## 12. 整体完成定义

只有同时满足以下条件，才能宣布本治理完成：

- [ ] `legacy-kernel.js` 不再承载生产领域逻辑，或已在调用审计后安全删除；
- [ ] façade 保留的每个兼容导出都有显式来源和测试；
- [ ] geometry、topology、measurement、interaction、operations、session、read-model 边界明确；
- [ ] graph 的所有写入经过事务和 invariant validation；
- [ ] read-model 不修改 graph；
- [ ] BLE/UI/Admin 不进入领域内核；
- [ ] Mini Program 与 Admin 共享一个权威实现来源；
- [ ] 基线、差分、模块和完整测试全部通过，或既有无关失败有可复现证据；
- [ ] 当前中英文文档与最终代码一致；
- [ ] 没有为了减少行数而留下循环依赖、代理套代理或新的“第二个 kernel”。
