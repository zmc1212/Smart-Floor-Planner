# I7.4.9.2 notification_config 结构漂移修复方案与隔离验证

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`56839a6a55cf`
> 日期：`2026-11-15`（Asia/Shanghai）
> 状态（I7.4.9.3 更新）：`migration_created = true`、`journal_updated = true`、`isolated_validation_passed = true`、`real_database_not_modified = true`、`real_migration_run = false`
>
> I7.4.9.2 完成设计与隔离验证；I7.4.9.3 已正式创建 `admin/drizzle/0131_platform_notification_config_not_null.sql` 并更新 journal。本文件保留设计依据与锁分析，正式迁移器验收结果见 I7.4.9.3 0131 验收（Git `d28c6ccb:docs/xiaok-i749-3-0131-migration-acceptance.md`）。

## 1. 范围

I7.4.9.2 完成了规范 B 的依据复核、追加迁移 `0131_platform_notification_config_not_null` 的设计、真实库只读核查和独立 PG17 验证。I7.4.9.3 经负责人批准后创建了正式 SQL 文件与 journal 记录，并把隔离测试改为由正式迁移器应用 0131。

真实库只进行了只读事务查询，输出仅保留结构、行数、键名前缀和模板 ID 指纹，未输出完整配置。两轮均未对微云 1454 真实数据库执行 DDL、`db:migrate`、模板配置修改、微信通知或生产部署。

## 2. 规范 B 的代码依据

### 2.1 Drizzle 字段

`admin/src/db/schema.ts` 的通用 JSON 对象助手：

```ts
const jsonObject = <T extends Record<string, unknown>>(name: string) =>
  jsonb(name).$type<T>().notNull().default(sql`'{}'::jsonb`);
```

`platformConfigs.notificationConfig` 直接使用该助手（`schema.ts:774`），因此模型要求：

- `NOT NULL`；
- 默认值 `'{}'::jsonb`。

真实库当前为 `jsonb`、可空、无默认值，属于结构漂移，不是模型允许的状态。

### 2.2 读取路径

`admin/src/lib/platform-notification-config.ts`：

- `normalizePlatformNotificationConfig(input?: PlatformNotificationConfigInput | null)` 对 `undefined`、`null`、`{}` 均使用可选链和默认模板补齐，返回完整 V2 DTO。
- `getPlatformNotificationConfig()` 通过 `PlatformConfigRepository.findByKey('default')` 读取，并把 `undefined`/NULL 值交给 normalizer。
- 小程序模板读取 `getMiniProgramSubscriptionTemplates()`、`getMiniProgramSubscriptionTemplate()` 和旧兼容 `getMiniProgramNotificationTemplateId()` 都经过同一 normalizer。

因此运行时没有“NULL 表示禁用/未初始化”的分支；NULL 与 `{}` 的读取结果一致。

### 2.3 写入路径

- `savePlatformNotificationConfig()` 总是把 `storedConfig(next)` 完整写回：`version: 2`、`subscriptionMessagesEnabled`、可选 `legacyTemplateId`、九个语义模板。不会写入部分配置。
- `PlatformConfigRepository.ensureForUpdate(key)` 只 `insert({ key })`，其余 JSON 列依赖数据库默认值。
- `ai-provider-config-repository.ts` 的 `markEnvironmentInitialized()` 也以 `{ key: 'ai-provider-environment:*' }` 插入标记行，依赖默认值。
- 其他配置服务（短信、地图、媒体、LLM、促销、小程序码等）对 `default` 行做单字段 upsert 时，若该行不存在且数据库无默认值，同样会生成 `notification_config = NULL`。

这正是 8 行 NULL 的来源：它们不是通知配置，而是只写 key 的标记行；结构漂移使这些行的 `notification_config` 没有得到应有的 `{}`。

### 2.4 业务契约

`docs/miniprogram-subscription-notification-template-baseline.zh-CN.md` 明确：

- `platform_configs.notification_config` 使用 `version: 2`；
- 八个必填模板、可选第九语义槽 `lead_claim_available`；
- `subscriptionMessagesEnabled` 缺省为 `false`；
- 旧 `miniprogramTemplateId` 只保留一个发布周期的读取/PATCH 兼容。

没有“NULL 具有独立业务语义”的约定。

### 2.5 为什么用 0131 而不是重跑 0021

当前 `0021_platform_notification_config.sql` 已包含回填、`SET DEFAULT` 和 `SET NOT NULL` 语句，但真实库的历史 0021 哈希在批准白名单中，其实际执行结果只留下了可空、无默认值的列。正式迁移器把 0021 识别为已应用，不会重跑；也不应通过重跑历史迁移来修复结构，因为：

- 历史迁移重跑不在迁移器合同内；
- 0021 还包含模板种子逻辑，重跑会扩大变更面；
- 真实 `default` 配置已是 V2，模板 ID 与当前代码一致，不需要任何种子或内容升级。

因此新增一条只做结构对齐的 `0131`，不回填模板、不重跑 0021。

### 2.6 结论

规范 B 成立：`NOT NULL DEFAULT '{}'::jsonb` 与模型、读取路径、写入路径和业务文档一致。8 行 NULL 可以安全映射为 `{}`，不需要修改任何非空配置，也不需要重新种入模板。

## 3. 真实库只读核查

只读事务连接获批开发目标 `127.0.0.1:5432/smart_floor_planner`，账号 `sfp_app`，设置 `default_transaction_read_only=on`、`statement_timeout=15s`、`lock_timeout=2s`，结束于 `ROLLBACK`。

| 项 | 结果 |
| --- | --- |
| 列类型 | `jsonb` |
| 可空 | `YES` |
| 默认值 | 无 |
| 总行数 | 9 |
| NULL 行 | 8 |
| 非空行 | 1（`key='default'`） |
| 表 owner | `sfp_migrator` |
| `sfp_migrator` 可视为 owner | `true` |
| `sfp_migrator` SELECT/UPDATE | `true` / `true` |
| RLS / FORCE RLS | `false` / `false` |
| Policy / 非内部触发器 | 0 / 0 |
| 表总大小 | 约 120 kB |

`platform_configs` 没有 RLS、Policy 或 `updated_at` 触发器，因此 `0131` 的 `UPDATE` 不会因租户策略漏行，也不会顺带改写 `updated_at`。

8 行 NULL 的键名前缀：

- 3 行 `ai-provider-environment:*`（LLM provider 环境初始化标记）；
- 5 行 `phase2-*`（阶段性测试/环境标记）。

这些行不承载通知配置，也没有任何读取路径按这些 key 读取 `notification_config`。

唯一非空 `default` 配置：

| 项 | 值 |
| --- | --- |
| `version` | `2` |
| 模板数量 | 8 |
| 模板类型 | `workflow_todo`、`lead_assignment`、`new_lead`、`measurement_appointment`、`design_published`、`enterprise_join_result`、`signing_commission`、`lead_converted` |
| `subscriptionMessagesEnabled` 字段 | 不存在（运行时缺省 `false`） |
| `legacyTemplateId` / `miniprogramTemplateId` | 不存在 |
| 非空配置聚合摘要 | `c886431b0a798107c17a4392e5744208c389f01c02e929f045a0b6e3e4205439` |

模板 ID 指纹（SHA-256 前 12 位）与当前 `DEFAULT_SUBSCRIPTION_TEMPLATES` 逐一比对：

| 模板类型 | 真实配置指纹 | 当前代码默认指纹 | 一致 |
| --- | --- | --- | --- |
| `workflow_todo` | `f69746265857` | `f69746265857` | 是 |
| `lead_assignment` | `e9180ff7fb37` | `e9180ff7fb37` | 是 |
| `new_lead` | `cae3683a65ea` | `cae3683a65ea` | 是 |
| `measurement_appointment` | `99f48d91511e` | `99f48d91511e` | 是 |
| `design_published` | `c74a7ec2bbfe` | `c74a7ec2bbfe` | 是 |
| `enterprise_join_result` | `5c8bf375d406` | `5c8bf375d406` | 是 |
| `signing_commission` | `14bb31ab667c` | `14bb31ab667c` | 是 |
| `lead_converted` | `ce3bf55e1c3c` | `ce3bf55e1c3c` | 是 |

结论：真实 `default` 配置的 8 个模板 ID 全部等于当前代码默认值，内容已经符合 V2 契约，只需修复列约束，不应改写任何内容。

## 4. 8 行 NULL 的实际影响

1. **不是通知业务数据丢失。** 8 行都是 provider/phase2 标记行，通知读取只使用 `key='default'`。
2. **新建标记行会继续产生 NULL。** 由于缺少数据库默认值，任何只写 key 的插入都会得到 NULL；0131 后自动得到 `{}`。
3. **读取没有 NULL 特殊语义。** normalizer 把 NULL、`undefined`、`{}` 统一补齐为完整 V2 DTO；不存在“NULL 表示关闭”的分支。
4. **没有历史通知模板依赖这些行。** 历史通知记录不读取 `platform_configs` 的标记行；模板读取只取 `default`。
5. **全部可安全映射为 `{}`。** `{}` 是该 JSON 列在模型中的通用默认值，normalizer 对 `{}` 不抛错、不降低校验；保存路径仍会执行模板 ID 格式与唯一性校验。

应用代码没有对空对象的特殊拒绝逻辑；相反，空对象会触发默认模板补齐。这一点在隔离测试中以当前 normalizer 直接验证。

## 5. 追加迁移 0131 设计

### 5.1 迁移标识

- tag：`0131_platform_notification_config_not_null`
- 文件：`admin/drizzle/0131_platform_notification_config_not_null.sql`（I7.4.9.3 已创建）
- journal：idx `127`、version `7`、when `1796457600000`、`breakpoints: true`（I7.4.9.3 已追加）

### 5.2 正式 SQL（已创建）

I7.4.9.3 已把以下内容写入 `admin/drizzle/0131_platform_notification_config_not_null.sql`；journal 追加 idx `127`、when `1796457600000`。迁移器已在外层事务中执行，因此文件不写 `BEGIN/COMMIT`。

```sql
-- I7.4.9.3 aligns platform_configs.notification_config with the Drizzle model:
-- NOT NULL DEFAULT '{}'::jsonb. Only NULL rows are backfilled; existing non-null
-- configuration, templates, version and subscription switch are never rewritten.
-- The migration runner owns the transaction; this file must not manage one.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '60s';
--> statement-breakpoint
LOCK TABLE app.platform_configs IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
UPDATE app.platform_configs
SET notification_config = '{}'::jsonb
WHERE notification_config IS NULL;
--> statement-breakpoint
ALTER TABLE app.platform_configs
  ALTER COLUMN notification_config SET DEFAULT '{}'::jsonb,
  ALTER COLUMN notification_config SET NOT NULL;
```

设计约束：

- 不包含 `INSERT INTO app.platform_configs`；
- 不包含 `jsonb_build_object` 或默认模板种子；
- 不包含 `0021_platform_notification_config` 的任何语句；
- 不修改 `version`、`templates`、`subscriptionMessagesEnabled`、`legacyTemplateId` 或 `miniprogramTemplateId`；
- 不使用 `COALESCE`/normalizer 覆盖非空内容。

### 5.3 迁移前后摘要

迁移前保存以下查询结果（CSV/JSON 均可）：

```sql
SELECT key, md5(notification_config::text) AS digest
FROM app.platform_configs
WHERE notification_config IS NOT NULL
ORDER BY key;

SELECT count(*) FILTER (WHERE notification_config IS NULL) AS null_rows,
       count(*) FILTER (WHERE notification_config IS NOT NULL) AS non_null_rows
FROM app.platform_configs;
```

迁移后重复同一查询，验收标准：

1. 原非空键集合完全不变，每个键的 `digest` 完全相同；
2. `null_rows = 0`；
3. 新增的 8 个键为 `{}`（`md5('{}')` 一致）；
4. `default` 行的模板 JSON、模板 ID 和版本不变；
5. 列 `is_nullable = NO`，`column_default = '{}'::jsonb`。

### 5.4 锁与事务影响

| 操作 | 锁 | 影响 |
| --- | --- | --- |
| `LOCK TABLE ... ACCESS EXCLUSIVE` | ACCESS EXCLUSIVE | 阻塞 `platform_configs` 的 SELECT/INSERT/UPDATE/DELETE，直到事务提交或回滚 |
| `UPDATE ... WHERE notification_config IS NULL` | RowExclusive（在已持有的强锁下） | 只改 8 行 |
| `SET DEFAULT` / `SET NOT NULL` | ACCESS EXCLUSIVE | `SET NOT NULL` 扫描 9 行验证；表约 120 kB，耗时极短 |

关键点：

- 锁只作用于 `platform_configs`，不阻塞其他业务表。
- `0131` 是当前最后一个 pending migration；迁移器在同一事务中按 journal 顺序执行，`0131` 的强锁从它开始执行时持有到提交，只覆盖 `0131` 本身与账本插入/提交，不会覆盖前面 8 条迁移的执行时间。
- 如果未来在 `0131` 之后追加迁移并同批执行，强锁会延长到后续迁移结束。届时必须重新评估，或把 `0131` 单独执行。
- `lock_timeout = 5s` 保证在已有长读/长事务时快速失败，而不是排在一个长锁队列后面阻塞新的读请求。
- 迁移窗口必须停止写入；建议同时暂停通知配置读取（管理端页面、订阅发送路径）以缩短等待。
- `LOCK TABLE` 需要表 owner 或 superuser。本轮只读核查确认真实表 owner 为 `sfp_migrator`，`pg_has_role('sfp_migrator', relowner, 'USAGE') = true`，迁移账号具备条件。
- `SET LOCAL` 依赖迁移器的事务。当前 `migratePostgresIntegration` 使用单事务；若未来改为逐语句自动提交，必须重新设计锁与回填的原子性。

### 5.5 失败回滚

- 任何语句失败（包括锁超时、NOT NULL 验证失败）都会使外层迁移事务 `ROLLBACK`：
  - 8 行 NULL 不改变；
  - `DEFAULT`/`NOT NULL` 不改变；
  - 账本不增加 `0131` 行；
  - 同批的其他 pending migration 也一起回滚。
- 进程在事务中崩溃时，PostgreSQL 断开连接后自动回滚。
- 如果迁移已提交但迁移后验收失败，恢复路径是 I7.4.9.1 的迁移前备份与独立恢复验证；不设计自动 down migration，避免引入新的数据改写风险。
- 建议实施时优先采用两阶段：
  1. 先应用现有 `0120`、`0124`–`0130`，验证账本 127 条与业务状态；
  2. 再合并/部署 `0131`，第二次运行迁移器，只应用 `0131`。
  这样 `0131` 的锁窗口和失败回滚范围最小；若负责人选择一次性应用全部 9 条，必须接受任一 `0131` 失败会回滚整批迁移。

### 5.6 幂等与并发

- 重复执行：第二次 `UPDATE` 影响 0 行；`SET DEFAULT` 重复设置同值；`SET NOT NULL` 在已经 NOT NULL 时为无操作。测试 H 已验证。
- 并发写入：显式 `ACCESS EXCLUSIVE` 锁阻止“回填后、SET NOT NULL 前”插入 NULL 的竞态。测试 F 已验证并发 NULL 插入阻塞，提交后返回 `23502`；合法 `{}` 插入成功。
- 若不使用显式 `LOCK TABLE`，仅靠 `SET NOT NULL` 会因竞态在验证阶段失败并回滚；显式锁把冲突变成可控的短暂等待/快速失败。

## 6. 独立 PG17 验证

I7.4.9.3 已把测试改为：先用正式迁移文件构建 127 条基线（`0000`–`0130`），再模拟真实 NULL 漂移，最后由正式迁移器应用 0131。完整 A–N 结果见 I7.4.9.3 0131 验收（Git `d28c6ccb:docs/xiaok-i749-3-0131-migration-acceptance.md`）。

环境：本机可丢弃 PostgreSQL `17.10`，`127.0.0.1:55435`（非 `5432`/`55432`），`postgres` 库注释 `xiaok-i749-isolated-test`。每个场景创建独立数据库，模拟 1454 的字段状态：

- `app.platform_configs.notification_config jsonb`、允许 NULL、无默认值；
- 9 行：1 行 `default`（version 2、8 个合成模板、无开关/旧字段），8 行 NULL（`ai-provider-environment:*` 与 `phase2-*` 前缀）；
- 合成模板 ID 均为格式合法但非真实的 `synth_<kind>_0001`；
- 127 条合成账本，0021/0051 使用批准的历史 SHA。

测试文件：[`scripts/__tests__/xiaok-notification-config-alignment.test.ts`](../admin/scripts/__tests__/xiaok-notification-config-alignment.test.ts)。正式迁移器结果：**6 passed / 0 failed / 0 skipped**，覆盖 A–N。

| 场景 | 结果 |
| --- | --- |
| A. 8 行 NULL 转空对象 | 通过：`UPDATE` 影响 8 行，NULL 行 0 |
| B. default 配置逐字节不变 | 通过：`notification_config::text`、SHA-256 与模板 JSON 前后一致 |
| C. 模板 ID 不变 | 通过：8 个合成模板 ID 全部保留，无重种 |
| D. NULL 行数量为 0 | 通过 |
| E. `is_nullable=NO` | 通过 |
| F. `column_default='{}'::jsonb` | 通过 |
| G. 新插入自动获得默认值 | 通过：仅插入 key 得到 `{}` |
| H. 显式插入 NULL 被拒绝 | 通过：`23502` |
| I. 迁移中途失败回滚 | 通过：锁超时使正式迁移器失败，8 行 NULL、可空、无默认值、账本均恢复 |
| J. 并发 NULL 写入不能绕过 | 通过：并发插入等待迁移锁 ≥500ms，提交后 `23502`；合法 `{}` 插入成功 |
| K. 重复执行迁移器 | 通过：第二次不再执行 0131，账本仍 128 条，数据不变 |
| L. 0021/0051 历史 SHA 不变 | 通过 |
| M. 其他历史账本不变 | 通过：前 127 条逐条一致，仅追加 0131 |
| N. 最终 pending 为空 | 通过 |
| 旧版字段/8 模板读取 | 通过：8 个 ID 全保留，旧 `miniprogramTemplateId` 由 `workflow_todo` 派生 |
| 新版空对象读取 | 通过：`{}`、NULL、`undefined` 均归一化为 V2 九模板，开关 `false` |

## 7. 兼容性分析

### 7.1 通知模板管理 API

`GET/PATCH /api/platform/notification-config` 行为不变：

- GET 返回 normalizer 后的完整 DTO；
- PATCH 仍只允许 `admin`/`super_admin`，保存时写完整 V2 配置；
- 空对象读取会补齐默认值；保存仍执行模板 ID 格式、唯一性和必填模板校验，未降低校验。

### 7.2 管理端配置页面

`workflow-logs` 页面通过 GET 获取完整 DTO，开关 PATCH 只提交 `subscriptionMessagesEnabled`。空对象不会造成页面空表单；normalizer 已补齐九个语义槽。

### 7.3 小程序订阅消息发送

`sendSubscriptionMessage` 仍先读取配置并检查 `subscriptionMessagesEnabled`；缺省/空对象为 `false`，直接返回 `skipped`，不调用微信。本轮未发送任何微信通知。

### 7.4 小程序模板读取

`GET /api/miniprogram/notification-template` 返回 normalizer 后的模板列表；空对象会得到默认模板，旧 `miniprogramTemplateId` 仍从 `workflow_todo` 派生，旧版小程序兼容字段不丢失。

### 7.5 历史通知与默认初始化

- 历史通知记录不依赖 `notification_config` 的存储形状；模板读取使用当前配置。
- 0131 不重新执行 0021，不重新种入默认模板。
- 真实 `default` 配置的 8 个模板 ID 已与当前代码默认值一致，迁移后内容不变。
- 新增的 8 行 `{}` 只属于标记行；未来若某标记行被通知保存路径读取，normalizer 会补默认模板，不会报错。

### 7.6 配置版本升级

normalizer 始终返回 `version: 2`；保存始终写 `version: 2`。0131 不改变版本字段，不触发内容升级。

### 7.7 其他环境

- 迁移仅使用标准 PostgreSQL 17 DDL/DML，不依赖扩展；
- 依赖迁移器的单事务执行和 `sfp_migrator` 对 `platform_configs` 的 owner 权限；
- 真实库表约 120 kB、9 行，`SET NOT NULL` 验证成本可忽略；
- 若其他环境存在远超 9 行的 `platform_configs`，需重新评估 `SET NOT NULL` 扫描和锁窗口，但语义不变。

## 8. 批准状态与执行条件

**负责人已批准规范 B；I7.4.9.3 已创建正式 0131 与 journal，并完成正式迁移器的 A–N 隔离验证。** 依据：

- Drizzle 模型、读取路径、写入路径和业务基线均要求 `NOT NULL DEFAULT '{}'::jsonb`；
- 8 行 NULL 是 provider/phase2 标记行，不是通知业务配置，映射为 `{}` 安全；
- 唯一非空 `default` 配置已经符合 V2，8 个模板指纹与当前代码默认值全部一致，无需改写；
- 0131 只回填 NULL，不重种、不归一化非空内容；
- 正式迁移器的 A–N 场景全部通过，包括并发、锁超时回滚和重复执行。

真实执行条件：

1. 先完成 I7.4.9.1 的迁移前备份与独立恢复验证；
2. 在批准的维护窗口执行，确认写入静默，最好暂停通知配置读取；
3. 优先采用“先 0120–0130、再 0131”的两阶段执行；若一次性执行，接受整批事务回滚；
4. 执行前保存非空配置键/摘要，执行后逐键比对，必须完全一致；
5. 迁移后验收 `null_rows=0`、`is_nullable=NO`、`column_default='{}'::jsonb`、`default` 行模板和版本不变；
6. 若任一非空配置需要改变才能满足目标，停止并报告，不得自动归一化覆盖。

## 9. 未解决问题与限制

- I7.4.9.3 已创建正式 0131 并完成隔离验收；真实库仍为 119 条账本、8 行 NULL、可空列和无默认值，尚未执行 0131。
- 0131 不添加 `CHECK (jsonb_typeof(notification_config)='object')`。数据库层仍允许标量/数组 JSON；当前数据全部为 object，normalizer 也能容忍非 object 输入。增加类型约束超出规范 B 范围，需单独评估。
- 0131 不补写 `subscriptionMessagesEnabled`、`legacyTemplateId` 或第九模板；这些由运行时 normalizer 处理，写入时统一写完整 V2 配置。
- 两阶段实施依赖操作纪律；若一次性应用全部 9 条迁移，`0131` 失败会回滚整批。
- 真实备份、真实恢复回执、维护窗口和 Worker `stale` 仍未完成，迁移整体仍为 `blocked`。

## 10. 回归结果

| 项 | 结果 |
| --- | --- |
| notification_config 对齐定向测试（正式迁移器） | 6 passed / 0 skipped |
| `subscription-notification.test.ts` + `wechat-notification-wiring.test.ts` | 18 passed |
| `xiaok-migration-preflight.test.ts` | 9 passed |
| 迁移备份与恢复验证测试 | 20 passed |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint（新增测试） | 0 errors / 0 warnings |

I7.4.9.3 已创建正式 `admin/drizzle/0131_platform_notification_config_not_null.sql` 并更新 `meta/_journal.json`；未修改 `0021_platform_notification_config.sql`、`admin/src/db/schema.ts`、`known-hashes.json` 或任何真实企业/模板配置；未执行真实 `db:migrate`；未发送微信通知；未部署生产。
