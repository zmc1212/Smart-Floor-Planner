# 小程序当前功能清单

本文档记录 `miniprogram/` 原生微信小程序的当前实现。事实基线是当前
`app.json`、页面处理器、共享工具和实际调用的后台 API。

## 状态与运行环境

- `Implemented`（已实现）：页面及其真实数据/操作链路可用。
- `Limited`（有限支持）：依赖登录、企业角色、蓝牙硬件、供应商或特定正式墙图形态。
- `Placeholder`（占位/未开放）：只有 mock/本地行为、规划 toast 或没有真实服务端操作。
- 运行环境：原生微信小程序；`utils/api.js` 通过 JWT Bearer 请求；`threejs-miniprogram` 用于 3D 预览；可选蓝牙激光测距仪。
- 主 Tab：首页 `index`、客户线索 `leads-management`、灵感库 `inspiration`、我的 `mine`。登录、详情、工作流、AI、推荐和正式量房为次级页面。

## 身份与共享上下文

- `/pages/login/login`：通过 `/api/auth/miniprogram` 支持微信手机号快捷登录和账号密码登录，将 JWT/用户信息恢复到本地。
- `app.js`：恢复会话，解析二维码 `enterpriseId`/`staffId` 推荐参数，同步员工专业上下文、企业品牌，并对已记忆设备尝试静默 BLE 重连。
- `utils/api.js`：携带 Bearer token，按配置重试本地/LAN API，401 时清理会话并提示重新登录。
- 状态：登录与上下文恢复为 `Implemented`；具体路径仍依赖有效微信授权、账号、API 地址和企业/供应商配置。

## 页面清单

### 首页与量房入口

- 页面：`pages/index/index`。
- API：`/api/miniprogram/home`、`/api/floorplans`、户型 POST/PUT、`/api/leads/[id]`、`/api/location/reverse`、`/api/users/me`。
- 已实现：首页统计、定位/城市、最近云端户型、留资弹窗、BLE 连接状态、记忆设备自动连接、新建/继续正式量房、房间进入和 AI 入口。
- 占位：快速报价、帮助中心和部分快捷卡片只显示“即将上线/规划中”消息。

### 线索与客户记录

- 页面：`pages/lead-form/lead-form`、`pages/leads-management/leads-management`、`pages/lead-detail/lead-detail`。
- API：`/api/leads`、`/api/leads/[id]`、`/api/floorplans/[id]` DELETE。
- 已实现：客户称呼/手机号/小区/面积/风格采集、最近客户、列表/详情、正式户型关联、继续量房、新建独立量房，以及删除正式户型时清理本地续测指针。
- 有限支持：需要有效小程序会话；手机号和小区既有客户端校验也有服务端校验。

### 企业报备与员工任务

- 页面：`pages/promotion-records/promotion-records`、`pages/promotion-record-detail/promotion-record-detail`。
- API：`/api/promotion-records`、`/promotion-records/[id]`、`/promotion-records/pool`、员工角色列表、工作台 summary/todos 和更新接口。
- 已实现：新建企业报备、`my`/`measure`/`design`/`admin`/`overdue`/`pool` 角色视图、搜索筛选、公海认领/审批申请、冲突归属、跟进内容和截止时间、测量员/设计师/地推分配、业务阶段操作。
- 有限支持：可见操作由员工角色和服务端工作流状态决定。

### 提成记录

- 页面：`pages/commission-records/commission-records`。
- API：`/api/commission-records`。
- 已实现：待结算、已结算、已作废统计和记录列表，以及订单/结算说明。
- 有限支持：记录由企业订单工作流生成和结算，小程序只读，不是结算权威端。

### 灵感库

- 页面：`pages/inspiration/inspiration`。
- API：`/api/inspirations?page=...&style=...&roomType=...`。
- 已实现：分页、下拉刷新、风格/空间筛选、图片预览、分享海报外壳和免费设计留资入口。
- 有限支持：内容数量取决于后台已发布的灵感数据。

### AI 房间生成

- 页面：`pages/ai-gen/ai-gen`。
- API：`utils/renderingService.js` 调用 `/api/ai/render`、`/api/ai/advice`。
- 已实现：接收正式户型派生房间，选择风格和效果图/平面图模式，将尺寸/门窗/多边形提交后台，下载效果图，获取设计建议，预览图片，生成分享海报和复制提示词。
- 有限支持：依赖当前房间上下文、登录、可用企业 AI 服务和对应配置；留资另走 `lead-form`。

### 我的与工作台

- 页面：`pages/mine/mine`。
- API：`/api/miniprogram/mine`、`/api/floorplans`，并跳转线索、报备、提成、量房和 AI 页面。
- 已实现：资料/角色、工作台摘要、待办、户型列表、通知/账号入口、退出登录、新建量房和户型卡片 AI 入口。
- 有限支持：工作台内容和任务操作随专业角色变化；部分账号/通知卡片只是信息展示。

### 推荐方案分享页

- 页面：`pages/recommendations/index`。
- 有限支持：已注册页面可展示本地风格/进度，并定义微信 `onShareAppMessage` 分享内容。
- 占位：推荐方案为硬编码 mock；“PDF 下载”只是定时成功 toast，不生成真实 PDF；自定义分享 ActionSheet 没有后续操作；交互埋点仅本地日志。

## 正式量房

- 页面：`pages/surveying-editor/surveying-editor`；所有入口由 `utils/surveyNavigation.js` 传递 `leadId` 和/或 `floorPlanId`。
- 数据合同：`FloorPlan.layoutData` 只能是 `{ version: 4, measurementMode: 'surveying', surveyGraph }`，墙图单位为毫米。
- 已实现编辑行为：启动恢复、本地/云端草稿、直墙和斜墙预览/确认、BLE/手输墙长、复尺、共享墙闭合、提示性闭合候选、门窗、开口尺寸/开向、创建独立墙链的光标放置、撤销/重画、完成提交和测量审计队列/补写。
- 已实现测角：斜线方向阈值吸附、数字面板输入、操作员确认的手机姿态角度，以及三次 BLE 三角边长读数和余弦定理校验。关闭面板不改墙体几何，也不遗留姿态监听。
- 已实现绘制/编辑：覆盖全开口宽度的 CAD 风格门窗符号、未闭合内测边红线、闭合空间内外尺寸、门洞链式尺寸、构件规格、构件 BLE 测距、翻转/模型面板，以及选中门窗的 Three.js 预览。
- 有限支持：BLE 操作要求兼容且已连接设备；部分保留底部/对象工具会有意显示规划中或暂未开放。
- 边界：小程序当前没有真实报告导出，也不提供全户型 CAD/3D 导出；后台 `FloorPlanViewer` 通过适配层提供全户型 2D/3D 查看和 DXF 下载。不得保存旧布局镜像。
- 运维细节和清理流程：`docs/surveying-module/README.md`、`formal-surveying.md`。

## 共享组件与工具

- BLE：`components/ble-connector`、`components/ble-gate`、`utils/bluetooth.js`。
- 导航：`utils/surveyNavigation.js` 负责正式编辑器入口和本地续测指针清理。
- 墙图/渲染：`surveyWallGraph.js`、`surveyCanvasRenderer.js`、`surveyLayout.js`、`renderingService.js`。
- UI：导航栏、自定义 Tab、线索列表/弹窗、分享海报、房间库和量房指南针。

## 维护规则

修改小程序页面、组件、工具、API 流程或数据合同前，必须先阅读根目录指令、本清单以及对应的设计或正式量房文档。完成后必须在同一次修改中同步本文件和英文镜像，记录真实入口、API、角色/条件、数据合同、状态和限制。正式量房规则必须与 v4 墙图合同一致；不得把 mock 或规划控件写成在线功能。如果确实没有功能文档影响，必须在交接说明中明确写出。
