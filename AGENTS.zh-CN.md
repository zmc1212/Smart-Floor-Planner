# Smart Floor Planner 项目指令

本仓库包含 Smart Floor Planner 产品：一个基于 Next.js/Mongoose 的管理后台，
以及面向装修获客、正式量房和 AI 辅助设计的微信小程序。

## 事实来源

- 当前代码、路由处理器、数据模型和测试是最高优先级事实来源。
- `docs/admin-system-modules.zh-CN.md` 记录当前后台功能。
- `docs/miniprogram-system-modules.zh-CN.md` 记录当前小程序功能。
- `docs/surveying-module/README.md` 与 `formal-surveying.md` 记录正式量房合同及清理运维流程。
- `PRODUCT_ROADMAP.md`、`docs/**/implementation_plan.md` 和旧设计说明属于历史/规划材料，不能证明功能已经实现。
- 功能状态统一使用 `Implemented`（已实现）、`Limited`（有限支持）、`Placeholder`（占位/未开放）。按钮文案、mock 响应或 toast 不等于后端能力已实现。

修改模块前先阅读对应清单；路由、API、权限或用户流程变化时，必须同步更新中英文配套文档。

## 强制开发文档门禁

以下流程适用于每一个新功能、缺陷修复、重构以及 UI/API 修改：

1. 修改前先阅读本文件、最近的目录级指令文件和受影响模块清单。量房相关工作还必须阅读正式量房说明和数据合同。
2. 开发过程中把模块清单视为功能变更的一部分。只要行为发生变化，就同步更新功能状态、页面/路由入口、API、模型/数据合同、权限或角色边界以及已知限制；英文和中文配套文件必须在同一次修改中更新。
3. 宣布完成前检查代码与文档 diff，确认文档反映当前实现。如果确实没有文档影响，必须在交接说明中明确写出，不能静默跳过检查。

这是完成条件，不是可选的后续工作。文档清单是后续 AI 会话使用的持久项目记忆；代码注释、临时提示词或 roadmap 都不能替代当前模块清单。

## 仓库结构

- `admin/`：Next.js 16 App Router、React 19、Tailwind 4、shadcn/ui + Radix、Mongoose 和 MongoDB API；本地开发端口为 `3005`。
- `miniprogram/`：原生微信小程序。`utils/bluetooth.js` 负责蓝牙测距，`utils/surveyWallGraph.js` 与 `utils/surveyCanvasRenderer.js` 负责墙图和画布，Three.js 用于门窗构件预览。
- `docs/`：当前模块清单和专项技术合同。
- `admin/src/models/`：支持租户隔离的业务模型。
- `admin/src/app/api/`：服务端路由；`admin/src/lib/` 包含认证、租户、工作流、AI、企微和墙图适配器。

## 跨端架构

- 后台使用 Cookie/JWT 会话、角色和菜单权限。
- 小程序通过 `/api/auth/miniprogram` 登录并携带 Bearer JWT；同一组 API 负责员工身份、企业推荐、品牌、线索、户型、测量、提成和企业报备。
- 存在企业上下文时，业务数据必须按企业隔离。使用共享租户工具和模型插件，不得另写一套租户过滤逻辑。
- 正式户型唯一数据源是 v4 量房墙图。后台查看器、DXF、3D、AI 等消费者通过适配层派生读模型，不得把旧布局副本写回 `FloorPlan.layoutData`。

## 强制工程规则

### Git

创建提交时使用 Conventional Commit 英文主题：`feat:`、`fix:`、`refactor:`、`docs:`、`chore:` 或 `test:`。主题简洁、动作导向，只描述相关暂存修改；不相关目标必须拆分。

### 后台 UI 与反馈

- 使用 shadcn/ui 和 Radix primitive。可复用控件放在 `admin/src/components/ui/*`；业务页面优先使用共享组件和语义化 Tailwind token。
- 管理员显式触发且用户可见的变更，成功和失败都必须使用共享操作反馈 UI；不得用原生 `alert()` 作为常规反馈。
- 危险操作可以使用原生确认框，但操作结果仍必须通知用户。
- 涉及租户的路由必须使用 `withTenantRoute`、`withTenantContext` 或对应共享解析器，并校验接口角色边界。

### 小程序设计与入口

- 新 UI 遵循 `miniprogram/DESIGN.md`、`design-tokens.json` 和 `app.wxss` token，保持明亮绿色、平静的家装设计风格。
- AI 生成的设计参考图统一放在仓库根目录 `design-references/`。该目录已加入 Git 忽略规则，且不得放入 `miniprogram/`，避免参考资源增大小程序包体积。
- 唯一正式量房页面是 `miniprogram/pages/surveying-editor/surveying-editor.*`。
- 所有量房入口都带 `leadId` 和/或 `floorPlanId` 进入该页面。不得恢复 `pages/editor/editor`、`restoreFloorPlan` 或双入口。
- 正式 `FloorPlan.layoutData` 只允许 `version: 4`、`measurementMode: 'surveying'` 和 `surveyGraph`。禁止持久化 `rooms`、`homeOutline`、`partitions`、`surveyDraft`、`prototypeOnly` 或 `surveying_prototype`。
- 墙图单位为毫米。有效 BLE 读数必须写入正式测量审计；首次云端保存前的读数要等正式 `floorPlanId` 创建后再补写。临时接管 BLE 回调的流程关闭时必须恢复常规回调。
- 不得重新引入已删除的旧编辑器组件和旧几何工具。

## 验证

文档修改至少运行 `git diff --check`，并核对引用路径、路由名称、状态标签和中英文语义一致性。代码修改还要运行对应窄范围测试，例如 `cd miniprogram && npm test` 或后台 lint/build。
