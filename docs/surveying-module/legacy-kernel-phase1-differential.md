# `legacy-kernel.js` Phase 1 差分护栏

> 状态：已完成
>
> 完成日期：2026-09-03
>
> 适用范围：小程序正式量房墙图内核、façade 与 Admin 只读运行镜像

本文记录治理计划 Phase 1 已落地的测试合同。它为后续逐族迁移提供自动化
新旧差分能力，不改变生产内核、公共 façade、路由、API、权限、UI 或 version-4
`surveyGraph` 数据合同。

## 1. 测试资产

- `miniprogram/test/helpers/survey-kernel-semantics.js`：graph/value 语义规范化、
  逐字段比较、差异格式化及引用完整性检查。
- `miniprogram/test/helpers/survey-kernel-differential-harness.js`：可注入旧/新实现的
  双跑 harness。
- `miniprogram/test/survey-kernel-phase1-differential.test.js`：CommonJS、18 个高风险
  成功/失败/no-op 场景、Mini Program/Admin 镜像及诊断能力合同。
- `npm run test:survey-kernel-phase1`：Phase 0 快照、全部量房定向测试、H5 场景和
  大图性能门槛的统一验收入口。

这些文件都位于 `test/`，已由 `project.config.json` 排除，不进入小程序主包或分包。

## 2. 语义比较合同

持久化 graph 比较遵守以下规则：

- `nodes` 与 `openings` 作为无序实体集合稳定排序；`walls`、`spaces`、各空间
  `wallIds` 和楼层顺序继续保留，因为它们参与链顺序、空间边界或 session 索引语义。
- 运行期 floor/node/wall/opening/space ID 按实体语义映射；ID 本身不同不会产生误报，
  但所有拓扑和 session 引用仍会随映射比较。
- 仅把字段名明确为 `createdAt`、`updatedAt`、`measuredAt` 或 `timestamp` 且值为
  ISO 时间的元数据归一为 `<timestamp>`。
- graph/session 的整数毫米、浮点值、字段存在性、集合成员、顺序和错误语义精确比较；
  不对持久化 graph 使用数值误差。
- 仅派生 read-model 允许显式 `1e-6` 数值误差。
- 原始 legacy `commitPreviewLength` 与事务 façade 比较时，唯一忽略字段是内部接管标记
  `floors.*.session.fullValidationAfterClosedSplit`；事务 wrapper 消费并删除该标记后再执行
  `full` 校验。除此之外不删除 session 或领域字段。

比较结果以可定位路径报告差异，例如
`floors[floor-1].walls[wall-1-2].lengthMm`、
`floors[floor-1].openings[opening-1-1].widthMm` 或
`floors[floor-1].session.state`。诊断测试明确覆盖 node、wall、opening、space 与 session。

## 3. 双跑与原子性合同

每个 case 都从同一 JSON 深拷贝输入开始，分别执行旧实现和候选实现；两边又各自从
相同输入重复执行一次。harness 同时检查：

- 成功、结构化失败和显式 no-op 类型一致；
- 输出 graph 与 session 语义一致；
- 错误 `name`、`code`、`message`、`operationName` 与 validation 详情一致；
- 成功输出都通过 `validateSurveyDraft` 的 `quick` 和 `full`；待确认的房间内分隔仅使用
  已有 `allowPendingClosure` 例外；
- graph 中 node/wall/opening/space ID 不重复，墙端点、门窗宿主、空间墙链、墙面覆盖和
  session 引用不悬空；
- 输入 graph、操作参数、validator 输入和 read-model 输入不被修改；
- 同一实现重复执行产生相同 graph、session、错误、validation 和 read-model 语义。

失败场景没有可返回的半成品 graph，因此失败原子性以调用方持有的 graph 和参数逐字节
不变为准；测试另用故意修改输入后抛错的实现验证该护栏确实会失败。

## 4. 覆盖边界

Phase 1 冻结 legacy kernel 的 64 个 CommonJS 导出、公共 façade 的 69 个导出及 17 个
覆盖关系。Phase 0 的 18 个操作场景全部执行以下两组差分：

1. legacy core 与当前事务 façade；
2. Mini Program façade 与 Admin 运行镜像。

每组同时执行首次和重复运行。成功/no-op 输出均执行 `quick`、`full`、引用完整性和
read-model 对照；失败输出执行错误语义和输入原子性对照。Admin 仍另受 30 对源码镜像
哈希护栏约束，因此源码复制偏差和运行行为偏差都能被发现。

Phase 1 新增测试使当前审计多出一个测试专用 façade 消费者和一个测试专用 legacy
直连；生产调用方、27 节点 / 39 边内核依赖图的生产分类、façade 导出和 30 对镜像均未变。

## 5. 重复执行

在仓库根目录执行：

```powershell
cd miniprogram
npm run test:survey-kernel-phase1
```

该命令当前运行 530 项量房定向测试、55 项 H5 合同/场景测试，并重建
273 节点 / 512 墙 / 240 空间的大图性能检查。完整 `npm test` 本轮发现 1,021 项，
其中 1,007 项通过、14 项失败；失败项与 Phase 0 已记录的 Mini Program 页面、资源包和
引导合同既有失败一致，量房测试没有新增失败。进入高风险生产接管前仍须重跑全仓回归，
并对既有无关失败继续保留可复现证据。

## 6. 当前结论

Phase 1 只增加测试、fixture 审计快照、npm 命令和文档。没有修改任何生产内核或 Admin
运行镜像源码，也没有迁移 façade 导出。后续 Phase 2 每收口一个纯基础函数族，都必须把
旧实现和候选实现接入本 harness，在差分、validator、镜像、定向回归和性能门槛全部通过后
才能接管生产来源。
