# I7.4.9.3 0131 通知配置结构对齐迁移验收

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`2a2001e095ca`
> 日期：`2026-11-15`（Asia/Shanghai）
> 状态：`migration_created = true`、`journal_updated = true`、`isolated_validation_passed = true`、`real_database_not_modified = true`、`real_migration_run = false`

## 1. 正式迁移

新增文件：`admin/drizzle/0131_platform_notification_config_not_null.sql`

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

约束核对：

- 只更新 `notification_config IS NULL` 的行；
- 不修改任何非 NULL 配置、`version`、`subscriptionMessagesEnabled`、模板或模板 ID；
- 不插入模板种子，不重跑 0021，不写 `__drizzle_migrations`；
- 不新增 CHECK 约束；
- 不含 `BEGIN/COMMIT`，由现有迁移器单事务执行。

## 2. Journal 记录

`admin/drizzle/meta/_journal.json` 仅追加一条记录，未修改此前任何记录：

```json
{
  "idx": 127,
  "version": "7",
  "when": 1796457600000,
  "tag": "0131_platform_notification_config_not_null",
  "breakpoints": true
}
```

校验结果：

- idx 连续：`0..127`；
- timestamp 唯一且严格递增；
- `1796457600000` 严格大于 0130 的 `1795852800000`；
- tag 与 SQL 文件名完全一致；
- 正式迁移器 `loadIntegrationMigrationInputs` 识别 128 条 active journal，`0131` 为最后一条；
- 0021/0051 继续由 `known-hashes.json` 精确白名单识别，未被修改。

## 3. PG17 隔离测试环境

- 可丢弃 PostgreSQL `17.10`，`127.0.0.1:55435`（非 `5432`/`55432`），集群 `postgres` 库注释 `xiaok-i749-isolated-test`。
- 合成源库通过正式迁移文件构建 127 条账本（`0000`–`0130`），0021/0051 使用批准的历史 SHA，0060 使用仓库自带 stock-PostgreSQL 变体。
- 构建完成后模拟 1454 漂移状态：`notification_config` 允许 NULL、无默认值、9 行（1 行 default + 8 行 NULL）。
- `default` 配置为 version 2、8 个合成模板、无 `subscriptionMessagesEnabled`/旧模板字段；模板 ID 格式合法但完全合成（`synth_<kind>_0001`）。
- 0131 由正式迁移器应用：主流程与回滚场景使用 `node scripts/postgres-migrate.mjs`，并发场景使用同一 `migratePostgresIntegration` 核心；测试没有手工写 0131 账本行。

测试文件：`admin/scripts/__tests__/xiaok-notification-config-alignment.test.ts`

结果：**6 passed / 0 failed / 0 skipped**。

## 4. 验收结果

| 场景 | 结果 |
| --- | --- |
| A. 8 行 NULL 全部变成 `{}` | 通过：回填 8 行，`null_rows=0` |
| B. 原 default 配置逐字节保持 | 通过：迁移前后 `notification_config::text`、SHA-256、模板 JSON 完全一致 |
| C. 8 个模板 ID 保持 | 通过：8 个合成模板 ID 全部保留，无重种 |
| D. NULL 行数量为 0 | 通过 |
| E. `is_nullable=NO` | 通过 |
| F. `column_default='{}'::jsonb` | 通过 |
| G. 只写 key 的新记录自动获得 `{}` | 通过 |
| H. 显式写入 NULL 返回 `23502` | 通过 |
| I. 迁移中途失败完整回滚 | 通过：并发持有 `ACCESS SHARE` 使 0131 的 `LOCK TABLE` 在 5 秒后超时；正式迁移器 exit 非 0；8 行 NULL、可空、无默认值、账本 127 条均保持不变 |
| J. 并发 NULL 写入无法绕过 | 通过：并发插入等待迁移锁 ≥500ms，提交后返回 `23502`；合法 `{}` 插入成功 |
| K. 重复执行不重新执行 0131 | 通过：第二次正式迁移器 exit 0，账本仍 128 条，数据不变 |
| L. 0021/0051 历史 SHA 不变 | 通过：两条记录迁移前后完全一致 |
| M. 其他历史账本不变 | 通过：迁移后前 127 条与迁移前逐条相同，仅追加 0131 |
| N. 最终 pending 为空 | 通过：`pendingMigrations` 返回空 |

非空内容保护：

- 迁移前非空记录 1 条（`default`）；迁移后原 key 仍是 1 条且文本/SHA-256/模板 JSON 完全一致。
- 新增非空记录恰好是原 8 个 NULL 标记行，内容全部为 `{}`。
- 未出现原非空 key 消失、内容变化或额外模板种子。

NULL 回填数量：**8**。

模板 ID 保留：**8/8**。

## 5. 事务与锁行为

- 0131 在外层迁移事务中执行；`SET LOCAL lock_timeout='5s'` 与 `statement_timeout='60s'` 仅作用于该事务。
- `LOCK TABLE app.platform_configs IN ACCESS EXCLUSIVE MODE` 关闭“回填后、SET NOT NULL 前”的并发写入竞态。
- 回填只触及 8 行；`SET NOT NULL` 验证 9 行。真实表约 120 kB，验证成本可忽略。
- 锁仅作用于 `platform_configs`，不阻塞其他业务表；持有时间从 0131 开始到迁移事务提交。
- 若存在长读/长事务，5 秒锁超时使 0131 快速失败并回滚，不会排队阻塞后续读请求。
- 失败回滚已验证：账本、列约束和 8 行 NULL 全部恢复原状。

## 6. 0021/0051 白名单兼容性

- 合成账本通过 127 条正式迁移构建，0021（timestamp `1786540800000`）和 0051（`1788184800000`）使用 `legacy/known-hashes.json` 中的完整历史 SHA。
- 正式迁移器接受 127 条账本并只计划 0131。
- 0131 应用后，两条历史记录的 hash、timestamp 和顺序完全不变。
- 没有重跑 0021，没有重新种子模板，没有修改 `known-hashes.json`。

## 7. 真实 1454 状态

**微云 1454 真实开发库尚未执行 0131。** 本轮未连接 `smart_floor_planner` 执行 DDL，未执行真实 `db:migrate`，未修改真实通知配置、模板、版本或开关，未发送微信通知，未启动真实 Worker，未部署生产。

真实库仍为：

- 119 条账本；
- `notification_config` 可空、无默认值；
- 8 行 NULL；
- 加入 0131 后正式待迁移项为 9 条：`0120`、`0124`–`0130`、`0131`。

## 8. 回归

| 项 | 结果 |
| --- | --- |
| 0131/notification_config 对齐测试 | 6 passed / 0 skipped |
| `subscription-notification.test.ts` + `wechat-notification-wiring.test.ts` | 18 passed |
| `xiaok-migration-preflight.test.ts` | 9 passed（pending 更新为 9 条） |
| `xiaok-integration-migrations.test.mjs` | 18 passed / 7 skipped（标准离线运行） |
| 迁移备份与恢复定向测试 | 20 passed（合成源账本随 journal 变为 128 条） |
| `npx tsc --noEmit` | 通过 |
| 定向 ESLint | 0 errors / 0 warnings |

跳过的 7 项是 `xiaok-integration-migrations.test.mjs` 中需要隔离 PostgreSQL 环境与迁移密码的数据库用例；标准离线运行按设计跳过。尝试在本机便携 PG17.10 上 live 运行时，`provision()` 因该实例没有 `vector` 扩展而无法建库（6 个 live 用例在准备阶段失败），这是测试环境缺少 pgvector，不是 0131 失败。0131 验收测试使用仓库自带的 stock-PostgreSQL `0060` 变体，不依赖 vector，6 项全部执行且 0 跳过。该集成测试的 0131 期望已更新，待具备 pgvector 的隔离环境时再复跑。

## 9. 下一轮建议

1. 先完成 I7.4.9.1 的真实迁移前备份与独立恢复验证。
2. 在批准窗口内确认写入静默，先应用 `0120`、`0124`–`0130`，验证账本 127 条与业务状态。
3. 再单独执行 0131（此时仅 0131 pending），保存迁移前后非空配置 key/摘要并逐条比对。
4. 迁移后验收：账本 127 → 128、`null_rows=0`、`is_nullable=NO`、`column_default='{}'::jsonb`、default 版本/模板不变、0021/0051 SHA 不变。
5. 验收通过后再恢复 Worker 与通知配置的读取/写入；本轮不发送任何微信通知。
