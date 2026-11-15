# I7.4.9.8 独立数据库恢复维护角色 sfp_restore 设计与 PG17 验证

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`dd351d1bd2b6`
> 日期：`2026-11-15`（Asia/Shanghai）
> 状态：`restore_role_designed = true`、`isolated_validation_passed = true`、`real_role_created = false`、`real_database_modified = false`

## 1. 结论

`sfp_restore` 可以在**非 SUPERUSER**前提下完整恢复业务对象的 owner、ACL、数据、FORCE RLS、Policy、schema、sequence、function、trigger 和 128 条账本，但必须满足两个前提：

1. **角色只存在于独立的一次性 PG17 恢复集群**，不在源库集群；
2. 角色是 `sfp_migrator` 成员，并具备 `CREATEDB` 与 `BYPASSRLS`。

不能在源库所在集群创建该角色：`sfp_migrator` 成员关系会继承源库 CONNECT/owner 权限，`sfp_restore` 将具备修改源库的能力，违反“不能修改源数据库”。

真实 `smart_floor_planner` 未创建 `sfp_restore`，未修改任何角色或数据。

## 2. 真实对象 owner 事实

只读查询真实库：

| 对象 | owner | rolsuper | rolbypassrls |
| --- | --- | --- | --- |
| `app` schema | `sfp_migrator` | false | false |
| 174 张业务表 | `sfp_migrator` | false | false |
| 146 个序列 | `sfp_migrator` | false | false |
| 33 个函数 | `sfp_migrator` | false | false |
| `btree_gist` / `plpgsql` 扩展 | `sfp_owner` | **true** | true |

结论：

- 业务对象 owner 全部是非超级用户 `sfp_migrator`，因此恢复角色只需加入 `sfp_migrator` 即可恢复业务 owner/ACL，**不需要 SUPERUSER**；
- 扩展 owner 是超级用户 `sfp_owner`。非超级用户无法修改其 owner/COMMENT；扩展属于基础设施，不是业务 owner/ACL。恢复集群应预创建扩展并指定非超级用户 owner，或接受扩展 owner/comment 不逐字恢复。

## 3. 角色设计

```sql
CREATE ROLE sfp_restore LOGIN
  NOSUPERUSER CREATEDB BYPASSRLS NOCREATEROLE NOREPLICATION;

GRANT sfp_migrator TO sfp_restore;
```

| 属性/权限 | 值 | 原因 |
| --- | --- | --- |
| LOGIN | true | 恢复维护连接 |
| NOSUPERUSER | true | 不接受超级用户；业务 owner 可非超级用户恢复 |
| CREATEDB | true | 当前恢复工具创建/删除一次性目标库 |
| BYPASSRLS | true | 跨 FORCE RLS 恢复与校验 |
| NOCREATEROLE | true | 目标集群角色预创建，不需要建角色 |
| NOREPLICATION | true | 与恢复无关 |
| `sfp_migrator` 成员 | true | `ALTER ... OWNER TO sfp_migrator` 与 ACL 恢复 |
| `sfp_owner` 成员 | **否** | 真实 `sfp_owner` 是 SUPERUSER，加入会间接获得超级用户 |
| 源库 CONNECT | **否** | 角色只存在于恢复集群 |
| 业务写权限 | **否** | 仅恢复目标库，不授予源库写 |
| 业务连接池/Worker | **禁止** | 维护角色不得进入应用环境 |

## 4. 关键权限分析

### 4.1 CREATEDB 是否必需

当前 `xiaok-migration-restore-verify.mjs` 会：

1. `CREATE DATABASE xiaok_migration_restore_*`；
2. 标记 disposable；
3. 恢复；
4. 验证；
5. `DROP DATABASE ... WITH (FORCE)`。

因此 `CREATEDB` 必需。去掉 `CREATEDB` 的 PG17 实验中，恢复在创建目标库阶段失败。

如未来改为“管理员预创建空目标库”，可由管理员创建后把 owner 交给 `sfp_restore`，`sfp_restore` 可不需要 `CREATEDB`；但当前工具不这样设计。

### 4.2 BYPASSRLS 是否必需

真实库有 153 张 FORCE RLS 表。`pg_restore` 在 `row_security=off` 下需要绕过 RLS；恢复后的校验也需要跨租户读取。

去掉 `BYPASSRLS` 的 PG17 实验中，恢复/校验失败。因此必需。

### 4.3 SET ROLE / owner 成员关系是否必需

必需。`pg_restore` 会执行：

```sql
ALTER SCHEMA app OWNER TO sfp_migrator;
ALTER TABLE ... OWNER TO sfp_migrator;
ALTER SEQUENCE ... OWNER TO sfp_migrator;
ALTER FUNCTION ... OWNER TO sfp_migrator;
GRANT ... TO sfp_app, sfp_auditor, sfp_backup, sfp_owner;
```

非超级用户必须与目标 owner 角色有成员关系，才能设置 owner 和恢复 ACL。`GRANT sfp_migrator TO sfp_restore` 是最小方案。

### 4.4 pg_restore --role 是否足够

不足。PG17 实验中，使用：

```text
pg_restore --role=sfp_migrator ...
```

对混合 owner 的 schema 执行失败。`--role` 只设置会话角色，不能替代对每个 owner 的成员关系；且单会话角色无法覆盖多个 owner。

当前恢复工具不使用 `--role`，而是以 `sfp_restore` 连接并依赖成员关系；这是正确方式。

### 4.5 如何恢复 owner 和 ACL

- 目标库由 `sfp_restore` 创建，owner 为 `sfp_restore`；
- `pg_restore` 创建 schema/table/sequence/function/trigger；
- 通过 `sfp_migrator` 成员关系执行 `ALTER ... OWNER TO sfp_migrator`；
- 作为 owner 的成员恢复 `GRANT/REVOKE` ACL；
- 保留 owner/ACL 需要 `pg_restore` 不加 `--no-owner`/`--no-privileges`。

### 4.6 schema/sequence/function/trigger

PG17 实验中均恢复：

- `app` schema owner/ACL；
- 174 张表及数据；
- 146 个序列及 owner/ACL；
- 33 个函数及 owner；
- 触发器、FORCE RLS、Policy；
- 128 条迁移账本；
- 默认 `notification_config` 和业务数据摘要。

### 4.7 如何避免覆盖真实数据库

恢复工具已具备：

- 目标名必须是 `xiaok_migration_restore_*`；
- 目标不得等于 manifest 源库；
- 目标不存在或必须是 disposable 标记库；
- 失败/完成后清理目标；
- `pg_restore --single-transaction --exit-on-error`；
- 不使用 `--no-owner`/`--no-privileges`。

本轮新增：

- `XIAOK_MIGRATION_RESTORE_URL` 用户为 `sfp_backup` 时直接拒绝（`backup_role_cannot_restore`）。

架构层再加一道：`sfp_restore` 只存在于独立恢复集群，源库不授予 CONNECT，因此即使目标名错误也无法连接源库。

## 5. PG17 验证结果

环境：

- 源集群：PG17.10，合成 1454/1455、完整 128 条迁移结构；
- 恢复集群：另一个全新 PG17.10 集群，角色齐全，`btree_gist` 由 `sfp_migrator` 预创建；
- `sfp_restore` 只创建在恢复集群；源集群无该角色。

| 场景 | 结果 |
| --- | --- |
| A. 创建临时恢复库 | 通过（`CREATEDB`） |
| B. 完整恢复 custom archive | 通过 |
| C. 恢复原对象 owner | 通过：schema/表/序列/函数 owner 为 `sfp_migrator`；混合 owner 需额外成员关系 |
| D. 恢复原 ACL | 通过：`sfp_auditor` 等自定义 ACL 保留 |
| E. 恢复全部业务数据 | 通过：128 条账本、default 配置、业务表摘要 |
| F. 恢复 FORCE RLS 与 Policy | 通过 |
| G. 原始数据摘要验证 | 通过：`full_restore_passed=true` |
| H. 删除临时恢复库 | 通过 |
| I. 不具备 SUPERUSER | 通过：rolsuper=false |
| J. 不具备 CREATEROLE | 通过：rolcreaterole=false、rolreplication=false |
| K. 不能修改源数据库 | 通过：角色只在恢复集群，源库连接失败 |
| L. 不被业务应用/Worker 使用 | 通过：无源库凭据、无源库会话；恢复角色只在维护集群 |

额外边界验证：

- 缺少 `CREATEDB`：恢复失败；
- 缺少 `BYPASSRLS`：恢复/校验失败；
- 混合非超级用户 owner（测试用 `sfp_owner`）：仅 `sfp_migrator` 成员不足，恢复失败；加入对应 owner 成员关系并通过 schema 权限后成功；
- `pg_restore --role=sfp_migrator` 对混合 owner 失败，不是成员关系的替代；
- 使用 `sfp_backup` 凭据执行恢复被拒绝（`backup_role_cannot_restore`）；
- 扩展 COMMENT 在未预创建/owner 不匹配时失败（`must be owner of extension btree_gist`）；恢复集群预创建 `btree_gist` 并指定 `sfp_migrator` owner 后通过。

测试结果：**5 passed / 0 skipped**；备份/恢复回归 **25 passed / 0 skipped**；TypeScript、定向 ESLint 通过。

## 6. 恢复工具审查与局部适配

`admin/scripts/xiaok-migration-restore-verify.mjs`：

- 目标名/同源/disposable/清理/失败回滚保持；
- 仍使用 owner/ACL 完整恢复，不使用 `--no-owner`/`--no-privileges`；
- 新增拒绝：`XIAOK_MIGRATION_RESTORE_URL` 用户为 `sfp_backup` → `backup_role_cannot_restore`；
- 备份角色和恢复角色凭据完全独立；
- 未重写恢复工具。

## 7. 不能实现的权限边界

- **不能**在非超级用户下恢复超级用户拥有的扩展 owner/comment（真实 `btree_gist`/`plpgsql` owner 为 `sfp_owner` 超级用户）；
- **不能**在源库同集群创建 `sfp_restore` 并同时保证“不能修改源库”：`sfp_migrator` 成员关系会继承源库 CONNECT/owner；
- **不能**用 `pg_restore --role` 替代多 owner 成员关系；
- 目标集群必须预创建全部角色（NOCREATEROLE）；否则 ACL/owner 引用失败。

扩展边界的安全方案：

- 在恢复集群预创建 `btree_gist`，owner 设为非超级用户（如 `sfp_migrator`）；
- 或接受扩展 owner/comment 不由恢复工具逐字恢复，仅恢复业务对象 owner/ACL；
- 不要把 `sfp_owner`（超级用户）加入 `sfp_restore`。

## 8. 真实环境所需审批

1. 批准建立独立的一次性 PG17 恢复集群（非源库集群）；
2. 批准在该集群创建 `sfp_restore`（LOGIN、NOSUPERUSER、CREATEDB、BYPASSRLS、NOCREATEROLE、NOREPLICATION）；
3. 批准 `GRANT sfp_migrator TO sfp_restore`；
4. 批准恢复集群预创建全部业务角色和 `btree_gist`（非超级用户 owner）；
5. 批准交互式 `\password sfp_restore`；
6. 批准 `XIAOK_MIGRATION_RESTORE_URL` 只指向恢复集群；
7. 明确不授予 `sfp_restore` 源库 CONNECT，不加入 `sfp_owner`，不加入业务/Worker 环境；
8. 如负责人坚持在源库同集群恢复，必须书面接受“恢复角色可修改源库”或改用受控超级用户，二者都不是最小权限方案。

真实 `sfp_restore` 和真实恢复集群尚未创建；本轮未对真实库执行任何写入。

## 9. 文件

- `admin/scripts/sql/xiaok-create-restore-role.sql`
- `admin/scripts/xiaok-migration-restore-verify.mjs`（局部拒绝检查）
- `admin/scripts/__tests__/xiaok-restore-role.test.mjs`
