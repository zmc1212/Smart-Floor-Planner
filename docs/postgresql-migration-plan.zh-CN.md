# PostgreSQL 当前运行架构

本文只记录当前数据库边界，不记录迁移过程流水。具体实施顺序和旧阶段
记录由 Git 历史保留。

## 当前决策

- 运行时数据库为 PostgreSQL 17，通过 `drizzle-orm` 和 `pg` 访问已迁移的
  业务域。
- 新业务记录使用 PostgreSQL identity（主要为 `bigint`）；为兼容既有接口，
  对外 DTO 在需要时继续提供字符串 `_id`。
- 租户读写通过 Repository 事务和 PostgreSQL RLS 执行；路由原有的登录、
  角色和权限边界不变。
- `FloorPlan.layoutData` 仍为 JSONB，只允许正式量房 v4 合同：`version`、
  `measurementMode: 'surveying'` 和 `surveyGraph`。
- 部署运行时为 PostgreSQL-only。历史 MongoDB 文档和容器不属于部署运行时；
  兼容分支仅限于明确记录的历史标识读取。

## 已迁移运行域

身份与企业上下文、员工与角色、线索、正式户型、测量、BLE 设备、套餐、订单、
提成、企业报备与通知工作流、媒体存储、AI 供应商/价格/点数、AI 生成工作流、
小程序 AI 任务，以及后台 AI Designer Agent 均使用 PostgreSQL Repository。
外部供应商和对象存储 I/O 在短数据库事务之外执行。

## 保留的外部数据

保留当前 RoomiAI 提示词版本及其模板关系、预览资源和当前七牛云媒体存储配置。
凭据继续在现有配置模型中加密保存。当前运行合同不包含历史业务文档导入。

## 运维边界

- 修改已迁移路由前运行 Repository/RLS 合同测试。
- API handler 必须显式序列化 `bigint`，不得直接返回 Repository 行对象。
- PostgreSQL 写入后不能切回已经过期的 MongoDB 副本；应使用已验证的
  PostgreSQL 备份/重建流程恢复。
- `npm run db:backup` 会创建 PostgreSQL 自定义 dump 并记录耗时。
  `npm run db:restore-drill` 只恢复到固定的
  `smart_floor_planner_restore_drill` 数据库，校验当前 app schema 的表/RLS/策略
  数量、记录恢复耗时，并在完成后移除该演练库。
- 数据删除、密钥重加密、对象存储清理和新的迁移切片都需要单独批准的运维流程。

## 当前核验原则

当前代码、迁移文件、Repository 测试和部署配置是完成状态的唯一依据。本文只
维护架构，不再维护按日期的测试报告和逐接口迁移记录。

English mirror: [postgresql-migration-plan.md](./postgresql-migration-plan.md)
