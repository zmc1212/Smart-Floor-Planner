# 后台 UI 重构

## 目标

保留现有 Next.js App Router 和服务端业务 API，引入 Ant Design 与 Ant
Design ProComponents，形成统一的后台应用层。

第一阶段以 AI 供应商管理为样板。样板验收通过后，才按相同规范迁移其余后台页面。

## 目标技术栈

- Next.js App Router 继续承担路由和部署运行时。
- `antd` 提供基础控件和视觉 Token。
- `@ant-design/pro-components` 提供 `ProTable`、`ProForm`、
  `ProDescriptions`、`PageContainer` 及兼容 `ProLayout` 的页面模式。
- `@ant-design/nextjs-registry` 处理 App Router 下 CSS-in-JS 的服务端样式注入。
- 现有 API 路由、JWT/Cookie 鉴权、租户助手、SWR、Mongoose 模型和操作反馈仍是唯一事实来源。

## 路由约定

首个迁移模块使用真实 URL：

- `/ai-providers`：供应商列表、新增入口和即时运维操作。
- `/ai-providers/new`：新增供应商。
- `/ai-providers/[id]`：供应商查看和编辑。
- `/ai-models`：平台生图模型目录、默认模型、启用状态和参考图上限；复用 `ai-providers` 平台权限。

涉及配置的列表操作必须进入真实页面路由。连通测试、余额查询、模型同步和停用等即时操作保留在行操作菜单中，并继续使用共享操作反馈。

## 共享 UI 约定

- 使用稳定侧栏和填满右侧工作区的浅色后台壳层。管理页只保留共享响应式水平内边距（紧凑屏 `20px`、`sm` 起 `28px`），不得再引入居中的最大宽度页面框架。
- 路由元数据集中在 `admin/src/config/admin-routes.ts`，供导航、面包屑和页面标题复用。
- 已迁移管理页的页面级标题区统一使用 ProComponents `PageContainer`。页面标题、说明、返回导航和页面操作分别使用其 `title`、`content`、`onBack`、`extra` 属性；不得新建页面专用标题组件，也不得手写拼装该模式。
- `PageContainer` 只负责页面标题和内容边界，不会自动处理业务区块间距。共享后台壳层会在标题分割线下为内容容器提供 `24px` 顶部内边距；首个区块不得再额外添加顶部 margin。页面包含多个区块时，必须使用 `Flex vertical gap={24}` 包裹（或使用文档明确的 ProComponents `ProCard`/Ant Design `Space` 布局）。
- 新管理列表使用 `ProTable` 或共享表格封装，统一筛选、分页、状态标签和末列操作菜单。
- 新表单使用 `ProForm`，每页只保留一个主提交动作。
- 供应商表单由 `src/lib/ai/provider-adapter-manifest.ts` 驱动。统一页面优先渲染地址、凭证、能力、路由和成本等公共控件；仅当协议确有需要时，Adapter 才声明局部差异配置字段。后端使用同一份声明校验后再保存 `adapterConfig`。
- 供应商凭证继续保留旧版加密 `apiKey` 字段以兼容当前运行时，同时写入加密/掩码凭证映射。新 Adapter 如需额外凭证，必须同时声明、服务端加密保存并在 Adapter 中消费；只增加前端字段不视为完成对接。
- 详情使用 `ProDescriptions` 展示只读元数据，编辑配置按业务分区。
- `ProForm` 底部提交操作使用其 `submitter.render`，通过共享 `Flex` 操作行与最后一个内容区保持 `24px` 顶部间距。
- 同级布局统一使用 Ant Design `Flex` 或 `Space` 的显式间距：页面分区为 `24px`，配置分区内部为 `16px`；仅在内容关系确有需要且文档说明时使用其他值，不得通过堆叠子元素 margin 制造间距。
- 选项集合使用 `Select` 或 `ProFormSelect`。已知选项同时允许录入新值时使用 `Select mode="tags"`；不得再以 `Input + datalist` 或其他原生 HTML 控件模拟下拉选择。
- 所有可见变更继续调用 `components/ui/operation-feedback`。
- 迁移页面不新增原生 `select`、checkbox、radio、`datalist` 或 `alert()`。

## 迁移顺序

1. AI 供应商：列表、新增、详情编辑和独立的平台模型目录。
2. AI 预设与 AI 点数价格。
3. 媒体存储与平台配置页。
4. 企业、员工、订单和报备管理页。
5. 商家工作台和 AI 创作页，先单独审计其复杂交互协议。

每一步必须保持路由权限、租户边界、API、模型和已记录限制不变。页面只有通过 lint、build、桌面/移动视觉检查及浏览器验证，才视为迁移完成。

## 迁移进度

- AI 供应商、绘图模型目录、AI 预设和 AI 点数价格页面均已使用共享的 Ant Design ProComponents 页面模式。
- `/roles` 已使用 `PageContainer`、Ant Design 配置面板与受控 `Checkbox.Group` 承载默认角色菜单维护。既有 `/api/roles` 默认初始化和 PATCH 行为、平台 `admin`/`super_admin` 边界、角色菜单 key 契约以及已有账号的有效权限语义均未改变。
- `/media-storage` 已使用 `PageContainer`、Ant Design 配置面板、`ProTable` 和 `ModalForm`。既有存储 API、`media-storage` 权限边界、凭证加密、测试后才能激活及归档行为均未改变。
- `/enterprises` 已使用 `PageContainer` 和 `ProTable` 完成企业搜索、分页、状态审核和操作入口迁移。既有 API 及平台 `super_admin`/`admin` 边界保持不变。
- `/enterprises/[id]` 及共享企业编辑弹窗现使用 `PageContainer`、Ant Design 卡片、`ProDescriptions` 与 `ModalForm`/`ProForm` 承载企业概览、资料、AI/自动化入口和手动新增/编辑表单。企业 AI 和自动化子页也已使用同一 `PageContainer` tab 模式；既有 AI 点数 API 和企业 PATCH 请求体均未改变，策略、调整、流水/任务查看、通知与 SLA 控件改用 Ant Design `Checkbox.Group`、`Select`、`ProForm` 与 `ProTable`。Base64 Logo 大小限制、操作反馈及平台 `super_admin`/`admin` 边界均未改变。
- `/promotion-records` 已使用 `PageContainer`、`ProTable`、`ProForm` 与 `ProDescriptions` 承载报备列表、平台保护期规则、报备详情、跟进、指派、公海和认领审批交互。既有 PostgreSQL API、`salesperson` 自助认领边界，以及 `admin`/`super_admin` 配置和公海管理边界均未改变。
- `/workflow-logs` 已使用 `PageContainer`、Ant Design 汇总卡片和 `ProTable` 承载服务端分页的通知日志查看与状态筛选。既有 PostgreSQL 通知日志 API、企业负责人读取范围以及 `admin`/`super_admin` 执行提醒扫描边界均未改变；表格加载和扫描失败均使用共享操作反馈。
- `/staff` 已使用 `PageContainer`、`ProTable`、`ModalForm` 和 Ant Design `Tree` 承载服务端分页员工搜索、部门筛选以及员工和部门维护。既有租户范围内的 staff/department API 与 `enterprise_admin`/`admin`/`super_admin` 变更边界均未改变。
- `/admins` 已使用 `PageContainer`、`ProTable` 和 `ModalForm` 承载账号搜索、范围与角色筛选、新建、编辑、密码重置、状态变更和删除。既有 PostgreSQL `admin-users` API、`admins` 菜单权限路由守卫、十进制字符串 `_id` DTO 契约，以及渠道地推账号不绑定企业的规则均未改变；表单仅展示这些 API 接受的五种角色。
- `/users` 和 `/users/[openid]` 已使用 `PageContainer`、`ProTable` 与 `ProDescriptions` 承载小程序用户的分页审计、身份资料和正式户型查看。`/api/users` 为该服务端分页新增可选 `page`、`limit` 查询参数，同时保留既有 `data`、`count` 响应字段；PostgreSQL 用户/户型数据源、`users` 菜单权限路由守卫和只读后台流程均未改变。
- `/floorplans` 已使用 `PageContainer` 和 `ProTable` 承载正式户型的服务端分页搜索、状态筛选和查看器入口。几何摘要只读取正式 v4 `surveyGraph` 中已闭合空间、墙体和开口，不读取或写入旧布局字段；`GET /api/floorplans` 新增可选 `status` 筛选，既有租户范围、`floorplans` 权限、查看器和 DXF 行为均未改变。
- `/enterprise-orders` 已使用 `PageContainer`、`ProTable` 和 `ModalForm` 承载订单搜索、状态查看与流转、企业开通和订单创建。既有 PostgreSQL 订单、套餐、报备、提成和企业开通 API，以及 `enterprise_admin`/`admin`/`super_admin` 的订单写入边界与 `admin`/`super_admin` 的企业开通边界均未改变。
- `/packages` 已使用 `PageContainer`、`ProTable` 和 `ModalForm` 承载套餐搜索、状态查看、新建、编辑和删除。既有 PostgreSQL 套餐 API 与 `admin`/`super_admin` 平台边界均未改变；删除操作会在对应请求进行中锁定该行，表格加载失败使用共享操作反馈，窄屏下筛选行会纵向排列。
- `/commissions` 已使用 `PageContainer`、Ant Design 汇总卡片和 `ProTable` 承载状态查看、搜索与结算操作。既有 PostgreSQL 提成 API、`salesperson` 读取范围及 `admin`/`super_admin` 结算边界均未改变；表格加载失败使用共享操作反馈，结算操作继续按记录单独防重，窄屏下筛选行会纵向排列。
- 共享 `/` 工作台已使用 `PageContainer` 和 Ant Design 汇总/列表组件。其交互契约已审计：平台角色只查看已实现的用户、正式户型和企业总量；所有非平台角色只查看既有 PostgreSQL/RLS 按角色裁剪的工作台卡片和待办；只有 `enterprise_admin` 额外查看租户范围的资产总量。已移除占位运维健康度声明和无对应执行链路的 AI 生成入口，既有路由、API 与权限保持不变。
- 其余平台配置页面仍属于第三阶段，实施前需先完成相应交互契约审查。

## 第一阶段验收标准

- `/ai-providers/new`、`/ai-providers/[id]` 与 `/ai-models` 可直接访问，浏览器前进、后退可用。
- 供应商新增/编辑、密钥轮换、成本规则、连通测试、余额查询、模型同步、停用和模型目录保存保持原 API 行为。
- 表格、表单、下拉、状态、分页和行操作使用统一视觉语言。
- 列表页与详情页的标题、说明、返回导航和页面级主操作统一使用 `PageContainer`。
- 既有 shadcn 页面保持可编译，不改变 API 或权限边界。
- 中英文后台模块清单同步记录新路由及状态。

## 明确不包含

- 不迁移小程序。
- 不重写无关的 API Handler 或 Mongoose 模型。
- 第一阶段未验收前，不一次性替换全部后台页面。
