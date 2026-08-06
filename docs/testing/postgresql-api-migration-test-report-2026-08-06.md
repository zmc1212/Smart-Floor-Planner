# PostgreSQL 后台接口迁移自动化测试报告

## 0. 修复复测（2026-08-06 23:13，Asia/Shanghai）

本报告第 5 节记录的 6 个失败已完成修复。复测使用当前生产构建在隔离的
`http://localhost:3006` 临时进程执行，未重启或替换用户原有的
`http://localhost:3005` 进程；复测结束后临时进程已关闭。

- 复测运行标识：`codex-api-20260806151337-8e1gi`
- 原始结果：`output/postgresql-api-test-results-codex-api-20260806151337-8e1gi.json`
- 路由覆盖：125 个路由文件、179 个操作；删除危险遗留路由后比修复前减少
  1 个路由文件、2 个操作。
- 自动化结果：182 项通过、0 项失败、2 项安全排除。
- HTTP 500/502：0。唯一计入 `serverErrors` 的响应是已知且通过断言的
  `POST /api/internal/seed` 503（本地未配置 seed 凭据）。
- 数据清理：测试企业、管理员、用户及相关业务数据均已清理。

| 修复项 | 复测结果 |
| --- | --- |
| `POST /api/ai/conversations` | 200；显式 DTO 可安全序列化 bigint ID |
| `GET /api/ai/conversations/[id]` | 200；详情响应使用同一显式 DTO |
| `POST /api/admin/ai-providers/[id]/balance`，不存在 ID | 404 |
| `POST /api/admin/ai-providers/[id]/models`，不存在 ID | 404 |
| `POST /api/admin/ai-providers/[id]/test`，不存在 ID | 404 |
| `POST /api/admin/media-storage/[id]/test`，不存在 ID | 404 |
| `POST /api/ai/agent/actions`，缺少 `conversationId` | 400 |
| `/api/miniprogram/save-icons` | 路由已删除，不再出现在生产构建与路由扫描中 |

验证补充：针对性 ESLint 通过，`npm run test:postgresql` 通过 51/51，
`npm run build` 通过，`git diff --check` 通过。全量 `npm run lint` 仍被本次
修改范围外的 11 个既有错误阻断；本次涉及文件的定向 ESLint 无诊断。

以下第 1—9 节保留修复前运行 `codex-api-20260806100030-7mfdv` 的基线证据，
其中“不能判定完全迁移成功”和修复建议不再代表修复后的接口状态；外部 AI、
微信、酷家乐及地图成功路径仍需在具备隔离凭据的沙箱中另行验收。

- 测试日期：2026-08-06（Asia/Shanghai）
- 测试对象：`admin/` Next.js 后台及其共享 Mini Program API
- 测试地址：`http://localhost:3005`
- PostgreSQL 数据库：`smart_floor_planner`，应用角色 `sfp_app`
- 最终运行标识：`codex-api-20260806100030-7mfdv`
- 自动化脚本：`admin/scripts/postgresql-api-migration-test.mjs`
- 原始逐项结果：`output/postgresql-api-test-results-codex-api-20260806100030-7mfdv.json`

## 1. 结论

结论为：**PostgreSQL 主体迁移成功，但当前不能判定为“完全迁移成功”。**

健康检查、数据库迁移检查、49 项 PostgreSQL 仓储/RLS/约束测试，以及企业、套餐、管理员、部门、员工、设备、用户、线索、正式量房图、测量、案例、推广记录、订单、角色配置、推广配置和 AI 供应商配置等主要数据链路均已通过真实 HTTP 新增、查询、修改或删除验证。

阻止“完全成功”结论的主要问题是 `POST /api/ai/conversations`：记录能够写入 PostgreSQL，但响应直接序列化包含 `BigInt` 的仓储对象，返回 HTTP 500：`Do not know how to serialize a BigInt`。此外有 5 个接口在缺少参数或资源不存在时错误返回 500/502，而不是 400/404；这些接口已能到达路由和 PostgreSQL/服务层，但错误契约不合格。

## 2. 覆盖范围与统计

静态扫描发现：

- 126 个 `admin/src/app/api/**/route.ts` 文件。
- 181 个导出的 `GET`、`POST`、`PUT`、`PATCH`、`DELETE` 操作。
- 177/181 个操作被实际 HTTP 调用，操作覆盖率 97.8%。
- 4 个高副作用操作按安全策略隔离，未执行。

最终运行共记录 182 个自动化断言，其中包含同一路由的正向 CRUD、鉴权反向测试和参数边界测试：

| 类型 | 通过 | 失败 | 合计 |
| --- | ---: | ---: | ---: |
| 正向业务/CRUD 场景 | 71 | 1 | 72 |
| 鉴权反向检查 | 2 | 0 | 2 |
| 其余路由冒烟与参数边界 | 103 | 5 | 108 |
| **合计** | **176** | **6** | **182** |

断言通过率为 96.7%。HTTP 状态分布为：200×92、201×15、400×36、401×5、403×3、404×20、410×4、500×4、502×2、503×1。延迟中位数 7 ms，P95 140 ms，最大 267 ms；此延迟只代表本地测试环境。

## 3. 前置数据库验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `GET /api/health` | 通过 | HTTP 200，`databases.postgresql.status=ok` |
| `npm run db:check` | 通过 | 数据库、应用角色、`app` schema 权限和迁移检查点正常 |
| `npm run test:postgresql` | 通过 | 49/49，通过仓储 CRUD、RLS、租户隔离、事务回滚、索引和正式量房约束 |
| MongoDB 运行时残留扫描 | 通过 | `admin/src` 与 `admin/package.json` 中无 Mongoose/MongoDB 运行时 import 或依赖；仅剩历史兼容说明/注释中的 `ObjectId` 字样 |
| 测试数据清理 | 通过 | 测试企业、管理员和用户残留计数均为 0 |

## 4. 真实 CRUD 结果

以下结果均通过 HTTP 路由执行，不是直接调用仓储层。测试使用独立平台管理员、独立企业和租户管理员；数据统一带 `codex-api-*` 标识。

| 资源/流程 | 新增 | 查询 | 修改 | 删除 | 结果说明 |
| --- | --- | --- | --- | --- | --- |
| 登录与会话 | 登录 200 | `/api/auth/me` 200 | — | 登出 200 | 平台、租户、Mini Program 密码登录均通过；错误密码正确返回 401 |
| 企业 | 200 | 列表/详情 200 | PATCH 200 | 200 | 独立空企业及其管理员删除成功 |
| 套餐 | 201 | 200 | PUT 200 | 200 | 金额、佣金和状态可持久化 |
| 平台管理员 | 201 | 200 | PATCH 200 | 200 | 未登录访问由中间件返回 401 |
| 部门 | 201 | 200 | PUT 200 | 200 | 使用无员工的独立删除目标验证删除 |
| 员工 | 201 | 200 | PUT 200 | 200 | 销售员工及独立测量员工链路通过 |
| 设备 | 201 | 200 | PATCH 200 | 200 | 分配、维护状态与删除通过 |
| Mini Program 用户资料 | 201 | 200 | PUT 200 | 200 | `/api/users/me` 与 `/api/users/[openid]` 路径通过 |
| 线索 | 201 | 列表/详情 200 | PUT 200 | 200 | 状态和备注修改后可读回 |
| 正式量房图 | 201 | 列表/详情 200 | PUT 200 | 200 | 仅使用 version 4 `surveyGraph` 合同 |
| 测量记录 | 201 | 200 | 无接口 | 由量房图删除级联清理 | 数值、单位、类型和关联量房图写入成功 |
| 案例/灵感 | 201 | 200 | 无接口 | 200 | PostgreSQL `inspirations` 租户数据链路通过 |
| 推广记录 | 201 | 列表/详情 200 | PUT 200 | 无接口 | 推广人、企业、跟进信息链路通过 |
| 企业订单 | 201 | 200 | PUT 200 | 无接口 | 金额和备注更新成功 |
| 佣金 | — | 200 | 仅做边界冒烟 | 无接口 | 本次自定义订单未生成可定位的佣金更新目标 |
| 角色权限 | 初始化/读取 200 | 200 | 原值 PATCH 200 | 无接口 | 使用原值写回，未改变业务配置 |
| 推广平台配置 | — | 200 | 原值 PATCH 200 | 无接口 | 使用原值写回，未改变业务配置 |
| AI 供应商配置 | 201 | 200 | PATCH 200 | 禁用 200 | 使用禁用的假配置验证数据库 CRUD，未调用外部供应商 |
| AI 会话 | 写入后 500 | 列表 200 | — | 因创建响应失败未取得 ID | PostgreSQL 写入成功，但 BigInt 响应序列化失败 |

## 5. 失败项

### 5.1 阻断迁移完成判定

| 优先级 | 接口 | 实际结果 | 判断 |
| --- | --- | --- | --- |
| 高 | `POST /api/ai/conversations` | 500，`Do not know how to serialize a BigInt` | PostgreSQL 创建成功后直接展开仓储对象，`enterpriseId`、`adminId` 等 bigint 未转成字符串。客户端会看到失败，但数据库已产生记录，重试可能生成重复会话。应使用显式 DTO 并补充 HTTP 回归测试。 |

### 5.2 错误状态码/输入校验问题

| 优先级 | 接口 | 输入场景 | 实际结果 | 建议结果 |
| --- | --- | --- | ---: | ---: |
| 中 | `POST /api/admin/ai-providers/[id]/balance` | 不存在的 bigint ID | 500 | 404 |
| 中 | `POST /api/admin/ai-providers/[id]/models` | 不存在的 bigint ID | 502 | 404 |
| 中 | `POST /api/admin/ai-providers/[id]/test` | 不存在的 bigint ID | 500 | 404 |
| 中 | `POST /api/admin/media-storage/[id]/test` | 不存在的 bigint ID | 502 | 404 |
| 中 | `POST /api/ai/agent/actions` | 缺少 `conversationId` | 500 | 400 |

这些失败不说明 PostgreSQL 无法连接，但说明路由的异常映射仍不完整。监控会把客户端输入或资源不存在误报成服务端/上游故障。

## 6. 未执行与受限验证

以下 4 个操作未执行：

| 接口 | 原因 |
| --- | --- |
| `POST /api/admin/ai-reconciliation` | 会对平台范围 AI 账务执行对账，不属于隔离租户内的安全测试 |
| `POST /api/automation/reminders/run` | 会处理平台范围现有提醒和通知状态 |
| `GET /api/miniprogram/save-icons` | 源码会删除图标、删除旧 API 目录，并尝试删除自身路由目录 |
| `POST /api/miniprogram/save-icons` | 源码会通过硬编码 Windows 路径写入仓库图片文件 |

`/api/miniprogram/save-icons` 是高风险遗留开发工具，并包含已经乱码的绝对路径。它不应作为生产业务 API 保留，建议删除整个路由。

其他限制：

- `POST /api/internal/seed` 在当前本地环境返回 503 `Seed credentials are not configured`。路由可达，但无法验证带 `INTERNAL_SECRET` 的部署播种成功路径。
- AI 生成、供应商连接/余额/模型同步、微信、酷家乐、地图反查等外部系统没有使用真实生产凭据触发成功业务；本次只验证了本地鉴权、参数校验、配置读取和安全的 PostgreSQL 数据路径。
- 本报告不能替代针对真实上游沙箱的端到端验收，也不能证明生产数据库的数据量、性能和历史数据完整性。

## 7. 清理与仓库校验

- 正向删除接口已验证：企业、套餐、平台管理员、部门、员工、设备、用户资料、线索、正式量房图和案例均返回 200。
- 对无删除接口或因关联关系保留的数据，测试脚本按独立企业范围清理。
- 最终数据库审计：`codex-api-*` 企业 0、管理员 0、用户 0。
- `node --check admin/scripts/postgresql-api-migration-test.mjs` 通过。
- `git diff --check` 通过。
- 针对脚本的 ESLint 单文件检查在 30 秒内未完成并超时；未返回 lint 诊断，不能记录为通过。

## 8. 建议修复顺序

1. 修复 `/api/ai/conversations` 的 bigint DTO 序列化，并验证“写入成功但响应失败”的重复会话风险。
2. 统一供应商、媒体存储测试和 AI agent actions 的 400/404/500/502 错误映射。
3. 删除 `/api/miniprogram/save-icons` 遗留路由。
4. 在隔离的外部服务沙箱中补跑 AI、微信、酷家乐和地图成功路径。
5. 修复后重新运行 `node admin/scripts/postgresql-api-migration-test.mjs`，目标为 0 个 500/502、0 个未解释失败，再更新本报告。

## 9. 最终判定

- PostgreSQL 连接、迁移、RLS、租户隔离：**通过**。
- 主要后台业务 CRUD：**通过**。
- 全部路由可用性：**部分通过，存在 6 个失败断言**。
- 外部集成成功路径：**未完全验证**。
- 是否可宣布“完全迁移成功”：**否；修复第 5 节问题并完成外部沙箱复测后再判定**。
