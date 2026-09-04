# `legacy-kernel.js` Phase 3 只读模型迁移记录

> 状态：已完成（Implemented）
>
> 完成日期：2026-09-04
>
> 对外合同：无变化

## 1. 权威模块与迁移范围

本阶段在已完成的 Phase 2 工作树上，依次迁移墙体几何、空间边界和尺寸函数族。
每次迁移后均执行冻结公式差分，再清理 façade 代理并同步 Admin 镜像。

| 职责 | 权威源码（相对 `miniprogram/packages/surveying/utils/survey/`） | 合同 |
| --- | --- | --- |
| 节点、墙查询 | `core/graph-query.js` | 保留缺失引用返回值，不创建或修复 graph |
| 闭合墙链、所属空间、中心线边界和质心 | `topology/closed-boundary.js` | 按传入墙序遍历，保留反向起墙回退，不改为重新排序或自动修复 |
| 墙实体、吸附面、端点内缩/延伸与连接补面 | `read-model/wall-geometry.js` | 直接消费 graph、闭合链和纯几何，保留墙厚覆盖、凹角、斜角及测量修正规则 |
| 墙面、测量面与读数 | `read-model/wall-faces.js` | 原有纯实现继续为权威源；façade 直接绑定该模块，不再经 kernel 工厂 |
| 内皮、渲染边界、墙面选择和边界计划 | `read-model/space-boundary.js` | 保留共享墙面、`wallFaceOverrides`、墙厚台阶、零净长桥接与同源拆墙边界语义 |
| 空间尺寸与面积 | `read-model/space-dimensions.js` | 净/外尺寸、墙厚段、面积与活动楼层策略不变 |
| 连接点近似相等 | `geometry/vector2.js` 的 `pointsNearlyEqual` | 保留先取整毫米距离再比较 `<= 1` 的规则，不替换为原始浮点距离 |

四个 read-model 模块均可独立加载，不需要注入 kernel，也不依赖写操作、吸附策略、
editor、BLE 或 `wx`。共享内部查询同样只读。返回值中原先允许引用输入 node/wall 的
地方仍保留该行为；本阶段没有把“只读调用”改成“所有输出都深拷贝”。

## 2. façade 与兼容边界

- `surveyWallGraph.js` 的全部 69 个 CommonJS 导出逐项指定来源，不再通过
  `Object.assign` 或展开顺序选择实现。
- legacy kernel 的 64 个导出全部保留，其中 8 个公开 graph 读模型转发同一权威函数。
  9 个事务包装操作继续由原事务模块接管；没有接管 Phase 4 的写路径。
- 原有 17 个同名提供者关系保留在审计中，含义是显式选定的兼容覆盖，不再是运行时合并顺序。
  审计解析实际 `owner.property` 绑定，并检查重复键、隐式展开和实际导出来源。
- 32 个顶层函数体已从 kernel 移出，kernel 从 Phase 2 的 6,801 行 / 208 个顶层函数
  变为 6,180 行 / 176 个顶层函数；剩余函数体保持原样。
- 当前依赖图为 32 个模块 / 82 条边，35 对 Mini Program/Admin 镜像全部匹配：
  34 对精确源码副本及 renderer 的 1 对已批准 `require` 路径改写。
  Mini Program 仍为权威源，使用既有 `admin/scripts/sync-survey-dimension-plan.mjs` 同步。

## 3. 消费者核查

| 消费者 | 当前路径 | 本阶段结论 |
| --- | --- | --- |
| 小程序画布和编辑器读数 | `surveyCanvasRenderer.js`、`editor/surveying-editor.js` → `surveyWallGraph.js` | 继续消费同一 façade；图形、提示、手势和交互状态不变 |
| Admin 2D 查看器 | `admin/src/components/survey/SurveyCanvasHost.tsx` → `admin/src/lib/survey-canvas-runtime.ts` → renderer 镜像 | 11 类冻结图的完整 scene 与小程序一致；只读楼层和原 graph 均不变 |
| PNG 预览与整屋控制图 | `admin/src/lib/survey-floor-plan-snapshot.ts`、`floor-plan-preview.ts` | 渲染修订号不变；PNG 仍存 media/preview 字段，不写入 `layoutData` |
| DXF | `admin/src/lib/dxf.ts` → `surveyDimensionPlan.js`、`surveyWallSolidPlan.js` | 既有独立只读适配器未改动，不依赖 kernel；保留图层、尺寸、开口和完成态限制 |
| 房间/3D 数据、导航 | `admin/src/lib/survey-graph.ts` | 既有房间多边形、层高、开口与导航适配不依赖 kernel；验证重复读取与原 graph 不变，不增加 3D 产品能力 |
| AI 房间控制图和上下文 | `admin/src/lib/ai/mini-ai-floorplan.ts`、`workflow-floorplan.ts` | 整屋、单房间、房间归属及闭合要求不变，不回写派生布局 |
| 小程序主包预览 | `miniprogram/utils/surveyLayout.js` | 继续为不依赖 kernel 的 v4 外壳/活动楼层访问，不引入测绘子包依赖 |

没有改变路由、API、模型外壳、角色、租户权限、UI、吸附阈值、闭合策略、错误文案或
毫米单位。`FloorPlan.layoutData` 仍只含 `version: 4`、`measurementMode: 'surveying'`
和 `surveyGraph`。没有 UI/资源修改，不涉及设计源调整或微信 DevTools 视觉操作。

## 4. 验收与复现

```powershell
npm --prefix miniprogram run test:survey-kernel-phase3
npm --prefix admin run test:survey-read-models
npm --prefix miniprogram test
git diff --check
```

- 566 / 566 项量房定向测试通过，包含 Phase 3 新增的 22 项测试。
- 55 / 55 项 H5 测试、38 / 38 项 Admin 画布/消费者/DXF/AI 测试通过。
- 只读差分在生产改动前冻结 Phase 2 的 32 个函数及 wall-face 实现，位于
  `miniprogram/test/fixtures/survey-kernel-phase3/`；引用文件记录规范化源文件 SHA-256。
  它们只复用 Phase 2 基础模块，不依赖生产 read-model 或 kernel，也不进入运行包。
- 11 类 Phase 0 冻结图、48 组固定种子的旋转/墙厚/墙面/测量修正变体，以及缺失节点、
  零长度、内缩耗尽、无效墙链和空楼层场景，对独立读模型及 Mini/Admin façade 做精确差分。
  写入拦截代理能捕获非 strict CommonJS 中的静默赋值；每次调用均检查输入和重复结果。
- 架构测试覆盖读模型的传递依赖和循环，并在禁用 kernel/写操作的独立进程加载双端读模型。
- 完整小程序测试 1,057 项中 1,043 项通过；14 项失败名称与
  [Phase 0 已登记清单](./legacy-kernel-phase0-baseline.md#7-重复执行与更新规则) 完全一致，
  为页面、资源包、环境选择和引导合同既有失败，量房范围没有新增失败。
- 只重建审核过的 `expected-audit.json` 结构快照；Phase 0 的 `expected-behavior.json`
  与性能阈值均未重建或放宽。

同机大图（273 节点 / 512 墙 / 240 空间）前后 p95：

| 指标 | 迁移前 | 迁移后 | 原门槛 |
| --- | ---: | ---: | ---: |
| wall read-model | 71.473 ms | 66.596 ms | 327 ms |
| space read-model | 39.013 ms | 39.728 ms | 206 ms |
| `cloneDraft` | 1.480 ms | 1.027 ms | 27 ms |
| `quickValidation` | 0.538 ms | 0.781 ms | 27 ms |
| `fullValidation` | 13.033 ms | 14.076 ms | 62 ms |

保留 8 份 clone 的 heap 增量前后均为 3,727,912 bytes，低于原 20,501,184 bytes 门槛。
墙体/空间读模型没有未解释的显著性能回退。

## 5. 下一步

Phase 3 全部完成。下一阶段为 Phase 4A：按单操作事务迁移门窗写路径，先处理
`addOpeningToWall`，继续沿用冻结合同、错误边界和失败原子性验证。
交互只读查询（例如闭合提示、光标和吸附候选）仍随其 session/interaction 工作流留在
kernel，属于 Phase 5；本阶段不会为了只读名义提前迁移交互策略。
