# `legacy-kernel.js` Phase 6 兼容层与运行来源收口

> 状态：已完成（Implemented）
>
> 检查日期：2026-09-04
>
> 对外合同：无变化

## 完成范围

Phase 6 将 `surveyWallGraph.js` 的 69 个 façade 导出改为逐属性显式绑定。`legacy-kernel.js`
现为 64 个历史导出的兼容入口文件，不再包含领域函数体、事务编排或隐式覆盖逻辑。生产
façade 不加载该文件；仍需直接引用的测试/历史脚本可继续获得原 CommonJS 导出和旧错误
消息边界。兼容导出分类如下：

| 分类 | 数量 | 说明 |
| --- | ---: | --- |
| 已迁移 | 51 | 64 个 legacy 名称直接绑定 core、geometry、read-model、interaction 或 operations 权威实现 |
| 兼容代理 | 13 | 旧调用需要 legacy error adaptation 或未包装操作的历史返回边界 |
| 仍待迁移 | 0 | 生产调用审计无 kernel 实现依赖 |
| 可删除 | 0 | 64 个公共名称仍由测试、镜像或历史入口覆盖，保留到下一次合同变更 |

`setThickness`、`setMeasurementSide`、`renameClosedSpace`、`repairCollinearDegree2Walls` 已
分别迁入 `operations/wall-properties.js`、`interaction/measurement-side.js`、
`operations/space-properties.js`、`operations/wall-repair.js`。所有计划为只读值，应用在
独立草稿上完成；属性写入使用既有事务 validator，非法输入保持原子拒绝。`geometry/intersection.js`、
`topology/space-topology.js`、`topology/wall-split.js` 没有生产消费者，已从 Mini Program 和
Admin 镜像删除；H5 临时 kernel/合并调试脚本也已删除。

The five façade-only read/validation exports (`measuredReadingMm`, `projectWallFaces`,
`projectWorkingFace`, `resolveBodyNormal`, `validateSurveyDraft`) are tracked separately and
have no legacy-kernel counterpart.

## 运行来源

`miniprogram/packages/surveying/utils` 是唯一权威源码。`admin/scripts/sync-survey-dimension-plan.mjs`
同步 `survey/`、`surveyWallGraph.js`、`surveyCanvasRenderer.js` 及规划器，并生成
`admin/src/lib/survey-runtime/source-manifest.json`。manifest 记录每个目标文件的 SHA-256；
`npm --prefix admin run check:survey-runtime` 在构建前可拒绝缺失文件、陈旧文件和内容漂移。
Admin-only/Docker 环境不再尝试从缺失的小程序目录静默回退，而是校验已提交的镜像清单。

## 审计与验证

- `miniprogram/scripts/audit-survey-kernel.js` 同时审计动态属性访问、整体对象分发、显式
  façade 绑定、模块依赖和 Admin 镜像；Phase 6 基线快照已更新。
- Phase 6 专项测试 22 项通过，覆盖 4 个迁移函数族、四端 Mini/Admin/legacy 差分、重复/撤销/重做、
  计划不可变、失败原子性、kernel 物理不可用时 façade 运行及动态调用识别。
- H5 测试 55/55 通过；1,111 项量房/编辑器定向回归通过；完整小程序 1,614 项中 1,600 项通过，14 项为 Phase 0 既有失败。
  本次未修改这些页面。
- `npm --prefix admin run check:survey-runtime`、`npm --prefix surveying-h5 test`、
  `git diff --check` 通过。完整小程序结果为 1,600/1,614 通过，14 项既有失败保持不变。

本阶段无 UI、路由、API、权限、BLE、数据库或正式 v4 graph 合同变化；无需设计源变更或
微信 DevTools 自动化。
