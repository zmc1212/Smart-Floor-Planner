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

涉及配置的列表操作必须进入真实页面路由。连通测试、余额查询、模型同步、停用和删除等即时操作保留在行操作菜单中，并继续使用共享操作反馈。删除需要二次确认；仅当后端确认不存在供应商尝试审计引用时才允许删除，否则返回 `409` 并要求供应商保持停用状态。这也是后续后台列表的标准批量危险操作模式：行选择、明确显示已选数量的操作入口、二次确认、一次有上限的批量请求、共享成功/失败反馈，以及将受保护或已不存在记录明确告知操作员的结果。

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
- `/workflow-logs` 已使用 `PageContainer`、Ant Design 汇总卡片和 `ProTable` 承载服务端分页的通知日志查看与状态筛选。平台 `admin`/`super_admin` 可通过同页四个固定语义字段维护 V2 小程序订阅消息模板；上门量房字段明确标注为仅配置/授权、尚未触发。企业负责人仍维持既有只读日志范围，表格加载、扫描和配置保存失败均使用共享操作反馈。
- `/staff` 已使用 `PageContainer`、`ProTable`、`ModalForm` 和 Ant Design `Tree` 承载服务端分页员工搜索、部门筛选以及员工和部门维护。既有租户范围内的 staff/department API 与 `enterprise_admin`/`admin`/`super_admin` 变更边界均未改变。
- `/admins` 已使用 `PageContainer`、`ProTable` 和 `ModalForm` 承载账号搜索、范围与角色筛选、新建、编辑、密码重置、状态变更和删除。既有 PostgreSQL `admin-users` API、`admins` 菜单权限路由守卫、十进制字符串 `_id` DTO 契约，以及渠道地推账号不绑定企业的规则均未改变；表单仅展示这些 API 接受的五种角色。
- `/users` 和 `/users/[openid]` 已使用 `PageContainer`、`ProTable` 与 `ProDescriptions` 承载小程序用户的分页审计、身份资料和正式户型查看。`/api/users` 为该服务端分页新增可选 `page`、`limit` 查询参数，同时保留既有 `data`、`count` 响应字段；PostgreSQL 用户/户型数据源、`users` 菜单权限路由守卫和只读后台流程均未改变。
- `/floorplans` 已使用 `PageContainer` 和 `ProTable` 承载正式户型的服务端分页搜索、状态筛选和查看器入口。几何摘要只读取正式 v4 `surveyGraph` 中已闭合空间、墙体和开口，不读取或写入旧布局字段；`GET /api/floorplans` 新增可选 `status` 筛选，既有租户范围、`floorplans` 权限、查看器和 DXF 行为均未改变。
- `/enterprise-orders` 已使用 `PageContainer`、`ProTable` 和 `ModalForm` 承载订单搜索、状态查看与流转、企业开通和订单创建。既有 PostgreSQL 订单、套餐、报备、提成和企业开通 API，以及 `enterprise_admin`/`admin`/`super_admin` 的订单写入边界与 `admin`/`super_admin` 的企业开通边界均未改变。
- `/packages` 已使用 `PageContainer`、`ProTable` 和 `ModalForm` 承载套餐搜索、状态查看、新建、编辑和删除。既有 PostgreSQL 套餐 API 与 `admin`/`super_admin` 平台边界均未改变；删除操作会在对应请求进行中锁定该行，表格加载失败使用共享操作反馈，窄屏下筛选行会纵向排列。
- `/commissions` 已使用 `PageContainer`、Ant Design 汇总卡片和 `ProTable` 承载状态查看、搜索与结算操作。既有 PostgreSQL 提成 API、`salesperson` 读取范围及 `admin`/`super_admin` 结算边界均未改变；表格加载失败使用共享操作反馈，结算操作继续按记录单独防重，窄屏下筛选行会纵向排列。
- 共享 `/` 工作台已使用 `PageContainer` 和 Ant Design 汇总/列表组件。其交互契约已审计：平台角色只查看已实现的用户、正式户型和企业总量；所有非平台角色只查看既有 PostgreSQL/RLS 按角色裁剪的工作台卡片和待办；只有 `enterprise_admin` 额外查看租户范围的资产总量。已移除占位运维健康度声明和无对应执行链路的 AI 生成入口，既有路由、API 与权限保持不变。
- 其余平台配置页面仍属于第三阶段，实施前需先完成相应交互契约审查。

## 重构选择与路由台账

本节是持续后台 UI 工作的执行记录，不是历史路线图。处理泛化的“继续重构”请求前，必须先读取本节及英文镜像中的最新路由记录。

- `Hold` 表示当前路由不得作为泛化重构的候选；只能在记录的重开条件满足时重新处理。
- `Queued` 表示其工作流和现状 UI 已审计，是明确的下一候选。
- `Unrecorded` 路由只有在与本台账及后台模块清单比较后才可作为候选。
- 每次完成 UI 变更都要替换该路由的最新记录，写明日期、范围、未改变的边界、验证、剩余 QA 与重开条件；同一路由不得追加重复历史行。

| 路由或界面 | 最新 UI 范围 | 状态 | 验证 / 剩余 QA | 仅在以下条件重开 |
| --- | --- | --- | --- | --- |
| `/workflow-logs` | 2026-08-12：把平台管理员专用的单模板输入替换为通用待办、客户指派、新增客户、上门量房四个固定语义字段；沿用既有配置面板和共享操作反馈，明确标注上门量房触发暂未启用，通知日志表、路由/API 入口和企业负责人只读范围保持不变。 | Hold | 定向 ESLint 与订阅模板配置/载荷测试已通过。认证后的 `http://localhost:3005` 当前仍由变更前 Docker 包提供，只显示旧单字段，不能作为本次证据；需在该服务重建后补桌面和窄屏视觉 QA。 | 订阅消息模板/API 合同变化、出现可复现表单缺陷，或用户明确指定 `/workflow-logs`。 |
| `/leads` | 2026-08-14：在用户明确指定该路由并批准方案后，沿用既有列表、筛选和详情抽屉，在阶段区新增单条“标记已签约”确认；签约日期必填，金额/备注可选，已签约详情显示操作审计，企业负责人可填写原因撤销。归档、获客协作、负责人绑定和行内操作结构保持不变，不提供批量签约。专用 API 限定企业负责人及负责设计师，签约不生成订单、不扣款，也不生成获客提成。 | Hold | 本地 Docker 迁移已应用；74 项 PostgreSQL/生命周期测试、签约与小程序详情定向测试、Admin 定向 ESLint、生产构建和容器构建均通过。认证后的企业负责人账号在 `http://localhost:3005/leads` 完成桌面与 `390x844` 详情/签约确认层 QA：日期、跳阶段提醒、可选金额/备注和业务边界均可见，窄屏弹窗完整落在视口内，控制台无警告/错误。为避免修改真实业务数据，未提交签约或撤销；其写入、权限、并发和恢复合同由测试覆盖。全量 ESLint 仍有 11 个既有、非本功能错误。 | 签约生命周期/API/权限合同变化、弹窗或抽屉出现可复现缺陷，或用户再次明确指定 `/leads`。 |
| `/staff` | 2026-08-11：为企业负责人和平台管理员新增“线索归档权限”抽屉，可设置设计师/测量员角色默认值和员工“继承 / 允许 / 禁止”覆盖，并显示最终权限、使用共享操作反馈；岗位变化会清理旧覆盖。既有部门、员工 CRUD、设计师二维码、租户范围和管理边界不变。 | Hold | 本地迁移已应用；57 项生命周期/PostgreSQL 测试、定向 ESLint 和生产构建通过。已在认证后的 `http://localhost:3005/staff` 完成桌面与 `390x844` 抽屉 QA，并将窄屏员工表修正为纵向行；QA 仅读取权限值，未执行权限修改。 | 权限策略或岗位合同变化、抽屉出现可复现缺陷，或用户明确指定 `/staff`。 |
| `/devices` | 2026-08-05：在既有设备列表和弹窗上方增加共享的当前筛选状态概览条。 | Hold | 定向 ESLint 已通过；认证桌面/移动截图 QA 仍待完成。 | 剩余截图 QA 发现缺陷、用户明确指定 `/devices`，或其设备工作流契约变化。 |
| `/measurements` | 2026-08-05：在既有 100 条审计列表上方增加 BLE、手动与关联户型数量的共享筛选概览条。 | Hold | 定向 ESLint 已通过；认证桌面/移动截图 QA 仍待完成。 | 剩余截图 QA 发现缺陷、用户明确指定 `/measurements`，或其审计工作流契约变化。 |
| `/ai-providers`、`/ai-models`、`/ai-presets`、`/ai-credit-prices` | 2026-08-13：在既有 manifest 驱动的供应商 Adapter 选择器中新增 API Nebula，保持统一表单布局、路由、平台 `super_admin`/`admin` 权限和无关目录工作流不变。切换 Adapter 时现会映射 manifest 默认 Base URL/能力，后端增加其专用异步图片任务协议与图片供应商安全回退行为，自由创作仅按完全相同的远程模型名回退；未新增页面结构或视觉样式。 | Hold | 88 项 AI 测试、65 项 PostgreSQL 生命周期测试、定向 ESLint、生产/容器构建和 `git diff --check` 通过。已在认证后的 Chrome 中通过 `http://localhost:3005/ai-providers/new` 确认选项、`https://apinebula.ai` Base URL 联动、中文 Adapter 说明、无框架错误层及无控制台警告/错误；未提交表单、未修改业务数据。真实密钥连通测试仍待完成。 | 供应商/目录工作流、权限、已确认设计变化，或可复现的认证后视觉缺陷。 |
| `/floorplans` | 2026-08-10：列表与只读查看器现使用统一的面向客户展示身份：关联小区为主标题，“客户 · 第 N 次量房”为次级文字，不再直接展示带日期的持久化正式量房名称。`GET /api/floorplans` 新增该只读 `display`，由稳定的 `lead_floor_plans.measurement_sequence` 派生；持久化名称、v4 几何、筛选、DXF、租户范围与 `floorplans` 权限均未改变。 | Hold | 定向 ESLint、展示助手测试、小程序文案测试和 `git diff --check` 已通过；应用迁移 `0018_floor_plan_display_sequence` 后仍需认证后台列表/详情视觉 QA。 | 出现可复现的展示身份缺陷、户型/关联数据合同变化，或用户明确指定 `/floorplans`。 |
| `/media-storage`、`/enterprises`、`/promotion-records`、`/enterprise-orders`、`/packages`、`/commissions`、`/roles`、`/users`、`/admins`、`/` | 2026-08-10：企业编辑器的 Logo 字段已改用共享单图 `ImageUploadField`，通过当前默认 Provider 的受管媒体上传接口，并提供本地校验、缩略图、放大预览、替换和移除。除新增受管 Logo 上传接口外，路由、API 角色和平台权限边界不变；其余列出的展示层迁移保持上文记录。 | Hold | 共享组件和企业编辑器的定向 ESLint 已通过；认证后的企业编辑器上传/预览 QA 仍待完成。 | 用户明确指定路由、存在可复现视觉缺陷，或其工作流契约变化。 |
| `/acquisition-commissions`、`/acquisition-commissions/settings` | 2026-08-10：将固定获客提成配置从员工管理移入获客提成域。记录页现与规则页分离；只有企业负责人可通过专用规则 API 读取和修改本企业固定金额。既有提成结算、租户边界和确认时金额快照均未改变。 | Hold | 定向 lint 与认证后的企业负责人视觉/交互 QA 待完成。 | 用户明确指定任一路由、存在可复现视觉缺陷，或提成规则/结算契约变化。 |
| `/inspirations` | 2026-08-10：将表单内本地的封面/效果图上传控件替换为共享 `ImageUploadField`；保持 500KB 的 Base64 表单值，同时增加单图卡片缩略图、放大预览、替换和移除。既有列表概览、路由、API、租户范围和权限均未改变。 | Hold | 共享组件和灵感方案页面的定向 ESLint 已通过；认证后的表单上传/预览 QA 仍待完成。 | 剩余 QA 发现缺陷、用户明确指定 `/inspirations`，或其工作流契约变化。 |
| `/ai-studio/scenarios` 及嵌入快速工具 | 2026-08-05：已审计客户方案、快速工具和 AI 助手入口契约；统一为全宽响应式工作区边距，并将视图切换改为具按压状态语义的分段控件。 | Hold | 定向 ESLint 和认证桌面/移动截图 QA 待完成。 | 剩余 QA 发现缺陷、用户明确指定 `/ai-studio/scenarios`，或其工作流契约变化。 |
| `/ai-studio/create` | 2026-08-14：保留已批准的 Roomi 风格执行态布局，将最新轮次的重新编辑、再次生成/重试和删除操作条从绝对定位的对话视口同级元素移入最新轮次卡片。操作条现在会随该轮滚动；按钮处理、重试/新建轮次语义、任务删除行为、路由/API、计费、`ai-scenarios` 权限和角色边界均未改变。 | Hold | 定向 ESLint 与 `git diff --check` 已通过。已在用户报告的 `http://192.168.10.111:3006/ai-studio/create` 通过认证 Chrome 验证四轮任务：操作条属于最新轮次 article 和滚动容器，容器从 `935` 滚到 `315` 时操作条随卡片移出视口，原有提示词编辑弹窗仍可打开；页面无框架错误覆盖层，控制台无 warning/error。既有多参考图和失败/部分失败重试视觉 QA 限制仍保留；验证未触发上传、生成、重试、删除或其他生产写操作。 | 任务轮次操作布局或失败/部分失败状态出现视觉缺陷、重试/计费语义再次变更，或用户明确指定 `/ai-studio/create`。 |
| 上述范围外的后台路由 | 尚无当前台账记录。 | Unrecorded | 提议改造前必须审计其真实工作流、当前页面、模块清单、权限与桌面/移动状态。 | 审计确认其为下一候选。 |

## 当前队列

不得因为页面只是简单表格就默认进入重构队列。下一次泛化的后台 UI 重构必须先审计 `Unrecorded` 路由，并给出有证据的简短候选列表；不得只为再次打磨视觉而重构四个 2026-08-05 的商家列表页。

## 第一阶段验收标准

- `/ai-providers/new`、`/ai-providers/[id]` 与 `/ai-models` 可直接访问，浏览器前进、后退可用。
- 供应商新增/编辑、密钥轮换、成本规则、连通测试、余额查询、模型同步、停用、单条/批量删除和模型目录保存保持已记录的 API 行为。
- 表格、表单、下拉、状态、分页和行操作使用统一视觉语言。
- 列表页与详情页的标题、说明、返回导航和页面级主操作统一使用 `PageContainer`。
- 既有 shadcn 页面保持可编译，不改变 API 或权限边界。
- 中英文后台模块清单同步记录新路由及状态。

## 明确不包含

- 不迁移小程序。
- 不重写无关的 API Handler 或 Mongoose 模型。
- 第一阶段未验收前，不一次性替换全部后台页面。
