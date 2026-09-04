# `legacy-kernel.js` Phase 6 兼容层与运行来源收口

> 状态：已完成（Implemented）
>
> 检查日期：2026-09-04
>
> 对外合同：无变化

本阶段将 `surveyWallGraph.js` 的 69 个 façade 导出改为逐属性显式绑定；
`legacy-kernel.js` 现在只是 64 个历史导出的兼容入口，不再承载领域函数体、事务编排或
隐式覆盖。生产 façade 不加载 kernel；仍需直接引用它的测试和历史入口继续得到原 CommonJS
导出与旧错误消息。64 个导出的分类为：已迁移 51 个、兼容代理 13 个、仍待迁移 0 个、可删除
0 个（公共名称仍受测试、镜像或历史入口覆盖，待后续合同变更再删除）。

`setThickness`、`setMeasurementSide`、`renameClosedSpace`、`repairCollinearDegree2Walls` 分别
归属 `operations/wall-properties.js`、`interaction/measurement-side.js`、
`operations/space-properties.js`、`operations/wall-repair.js`。计划均为只读值，应用于独立
草稿并复用既有 validator；非法输入仍原子拒绝。没有生产消费者的三个过渡模块
`geometry/intersection.js`、`topology/space-topology.js`、`topology/wall-split.js` 以及 H5
临时 kernel/合并调试脚本已删除。

五个仅 façade 导出（`measuredReadingMm`、`projectWallFaces`、`projectWorkingFace`、
`resolveBodyNormal`、`validateSurveyDraft`）单独记录为 facade-only，它们在 legacy-kernel 中
没有对应名称。

`miniprogram/packages/surveying/utils` 是唯一权威源码。`admin/scripts/sync-survey-dimension-plan.mjs`
同步 survey、façade、renderer 和规划器，并生成 `admin/src/lib/survey-runtime/source-manifest.json`。
manifest 记录每个目标文件的 SHA-256；`npm --prefix admin run check:survey-runtime` 在构建前拒绝
缺失、陈旧或漂移。Admin-only/Docker 环境只校验已提交镜像，不会从缺失的小程序目录静默回退。

`miniprogram/scripts/audit-survey-kernel.js` 覆盖动态属性访问、整体对象分发、显式 façade 绑定、
模块依赖和 Admin 镜像。Phase 6 专项 22 项通过；H5 55/55 通过；1,111 项量房/编辑器定向回归通过；完整小程序 1,614 项中 1,600 项通过，14 项为 Phase 0 既有失败，均未因本阶段变化。镜像检查与 `git diff --check` 通过。

本阶段没有 UI、路由、API、权限、BLE、数据库或正式 v4 graph 合同变化，也不需要设计源或
微信 DevTools 自动化。
