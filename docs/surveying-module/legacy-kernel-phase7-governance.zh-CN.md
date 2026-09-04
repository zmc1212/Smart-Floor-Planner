# `legacy-kernel.js` Phase 7 最终治理与防回退约束

> 状态：已完成（Implemented）
>
> 检查日期：2026-09-04
>
> 对外合同：无变化

## 最终模块边界

`miniprogram/packages/surveying/utils` 是运行时唯一权威源码。公共
`surveyWallGraph.js` façade 的每个导出都逐项绑定一个明确所有者。97 行的
`survey/legacy-kernel.js` 仅保留 64 个历史名称的兼容入口，生产 façade 不可达该文件。
Admin 使用提交到仓库的生成镜像，并以 79 个文件及 SHA-256 manifest 对照小程序源码。

| 边界 | 职责 | 禁止依赖或行为 |
| --- | --- | --- |
| `core/` | graph/session 数据原语、ID 与 graph 查询 | editor、BLE、宿主 UI |
| `geometry/` | 不读取 graph 的向量、线段与多边形计算 | 其他内核层及宿主全局对象 |
| `domain/` | 墙、门窗、空间语义、校验输入与错误码 | 界面反馈或持久化 |
| `topology/` | 边界、Face、闭合计划及 Space 同步 | 宿主 UI 与数据库写入 |
| `read-model/` | 只读墙体、墙面、光标、边界和尺寸投影 | operations、interaction、snap、compat 或 legacy kernel |
| `session/` | 字段归属与合法状态转换 | graph 持久化 |
| `snap/`、`interaction/` | 确定性候选与只读用户意图 | graph 写入、时钟/ID 分配和宿主反馈 |
| `operations/` | 变更计划及唯一 graph 应用边界 | WeChat、BLE 或 Admin 依赖 |
| `compat/` | 历史查询/错误适配 | 新增领域行为 |
| editor / API adapter | 设备、手势、Toast、BLE 队列、鉴权与存储 | 重复实现 geometry 或 topology |

## 写入路径与不变量所有权

正式写入链路为：

```text
editor 或 BLE 事件
  -> surveyWallGraph façade
  -> interaction/snap 意图
  -> operation plan
  -> 隔离事务草稿
  -> topology/Space 同步
  -> quick 或 full 不变量校验
  -> version-4 layout 序列化
  -> 经鉴权的 API/数据库写入
```

纯几何层拥有数值关系；domain 拥有墙、门窗和空间语义；topology 拥有 Face 与闭合 Space
一致性；`session/state-machine.js` 拥有合法 session 转换；
`invariants/floor-plan-validator.js` 拥有最终 graph/session 引用校验；operations 拥有变更
原子性和测量审计等式；服务端 adapter 拥有严格 version-4 外壳、租户鉴权与持久化。
read-model 不修复、不修改也不持久化输入。

## 长期防回退守卫

`survey-kernel-phase7-governance.test.js` 与 `scripts/audit-survey-kernel.js` 中不可通过
重写快照绕过的规则会拒绝：

- geometry/read-model 反向依赖 operations、interaction、snap、compat、façade、legacy
  kernel、editor、BLE、`wx` 或浏览器全局对象；
- 正式 CommonJS 模块图中的任何循环依赖；
- 多个导出对象、隐式/spread 绑定、重复导出名或缺少显式来源的运行时导出；
- 任何生产模块依赖 `legacy-kernel.js`，或兼容入口重新出现领域函数体；
- Admin 镜像/manifest 缺失、陈旧、多余或内容漂移。

开发内核变更时运行 `npm --prefix miniprogram run check:survey-kernel-architecture`。
交付前运行 `npm --prefix miniprogram run test:survey-kernel-phase7`，它覆盖源码快照、架构
规则、全部量房/editor 测试、H5 测试与构建、Admin 镜像和性能门槛；同时按仓库规则运行
完整小程序测试与 `git diff --check`。

最终验收通过 Phase 7 专项 5 项、量房/editor 1,117 项、H5 55 项及其生产构建、Admin 量房
消费者 39 项、79 文件镜像检查和全部既有性能门槛。完整小程序 1,620 项中 1,606 项通过；
14 项失败名称与 Phase 0 清单逐项一致，均不属于量房范围。

## 新功能接入

纯公式放入 `geometry/` 或 `domain/`；拓扑查询/计划放入 `topology/`；只读投影放入
`read-model/`；用户意图与吸附策略放入 `interaction/` 或 `snap/`；所有 graph 写入都放入
`operations/` 并复用现有事务和 validator。WeChat/BLE 只留在 editor，服务端鉴权与持久化只留在
API adapter。新增 façade 能力必须有一个显式所有者和导出合同测试；Admin 消费者必须先改
小程序权威源，再生成并验证提交镜像。

测试随边界扩展：纯函数覆盖边界/退化输入与确定性；read-model 覆盖输入不可变和 Mini/Admin
等价；topology 与写操作覆盖冻结语义差分；写操作还需覆盖成功/失败原子性、validator、重复、
undo/redo 与审计守恒；interaction 覆盖状态转换和吸附优先级。对外合同变化仍须同步中英文
模块清单。

## 保留的兼容限制

64 个 legacy CommonJS 名称及其中 13 个历史错误/返回代理继续保留，直到另行批准的公共合同
变更证明可删除全部调用方。Admin 仍是在部署前生成并提交的只读运行镜像，不在部署时跨包
导入小程序文件；这不构成第二套实现来源。
