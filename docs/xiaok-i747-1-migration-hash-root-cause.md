# 小K I7.4.7.1 0021 / 0051 历史迁移哈希差异根因审查

> 仓库：`zmc1212/Smart-Floor-Planner`
> 分支：`codex/xiaok-integration`
> 基线：`3ebf81b2204f21754bcd4c32654aeb074ced7033`（与 `origin/codex/xiaok-integration` 一致）
> 审查时间：`2026-11-15`
> 结论：**两条账本哈希均属 `historical_content_change`（历史 SQL 内容确实不同），不是换行或编码差异；全库找不到与账本完全一致的原始文件，`exact_match` 不可达。**
> 本轮未修改任何迁移文件、journal、`validateLedger`、账本或业务数据，未执行 `npm run db:migrate`。

## 1. 结论摘要

| 迁移 | 账本 SHA-256（1454 实际值） | 当前文件 LF SHA-256 | 根因分类 | 结构是否与当前文件等价 |
| --- | --- | --- | --- | --- |
| `0021_platform_notification_config` | `9df6e11e…ad8ab5c` | `ad51f60f…3f29d80` | `historical_content_change`（有结构反证） | **否**：1454 缺 `SET DEFAULT` / `SET NOT NULL` |
| `0051_staff_referrer_network` | `a41ef104…824939e` | `e5afd41b…f8e7d94` | `historical_content_change`（结构等价，原文不可复原） | 是：13 条语句的目标结构全部在位 |

关键判断依据（详见后文）：

1. 迁移器的 `hashes()` 已同时接受 **原始字节 / LF / CRLF** 三种形式，因此"仅换行或编码差异"必然能通过校验；两条都被拒绝，说明**内容确实不同**。
2. 对本克隆 Git 对象库全量扫描 **21,434 个 blob（含 988 个不可达对象）**，**0 个**匹配账本哈希。
3. 迁移文件在全部历史中**只被新增过一次，从未被修改**；`meta` 快照只到 `0024`，`0025` 起为手工编写。
4. `0021` 存在**独立于哈希的结构反证**：当前文件会写入 `NOT NULL DEFAULT '{}'`，而 1454 实际列是**可空且无默认值**（见 §5.1）。
5. `0051` 全部目标对象与当前文件逐条吻合，且相关业务表**当前 0 行**，回填规则的历史差异在这套库上**没有可观测后果**（见 §5.2）。

## 2. 审查范围与方法

### 2.1 已阅读材料

- [docs/xiaok-i747-migration-rehearsal.md](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/docs/xiaok-i747-migration-rehearsal.md)
- [admin/scripts/postgres-migrate.mjs](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/scripts/postgres-migrate.mjs)
- [admin/scripts/postgres-integration-migrations.mjs](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/scripts/postgres-integration-migrations.mjs)
- [admin/drizzle/0021_platform_notification_config.sql](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/drizzle/0021_platform_notification_config.sql)
- [admin/drizzle/0051_staff_referrer_network.sql](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/drizzle/0051_staff_referrer_network.sql)

### 2.2 校验器行为确认

`postgres-integration-migrations.mjs` 的 `hashes()` 对同一份文件生成三个 SHA-256：

```js
function hashes(source) {
  const lf = source.replace(/\r\n/g, '\n');
  return new Set([source, lf, lf.replace(/\n/g, '\r\n')]
    .map(text => createHash('sha256').update(text).digest('hex')));
}
```

`drizzle-orm@0.45.2` 的 `readMigrationFiles()`（`admin/node_modules/drizzle-orm/migrator.js` 第 23 行）写入账本的哈希是：

```js
hash: crypto.createHash("sha256").update(query).digest("hex")  // query = 文件原始文本，无 trim、无归一化
```

即：**账本哈希 = 应用当时文件全文的 SHA-256**。`0021` 应用期（2026-08）与 `0051` 应用期（2026-09）的 `admin/package.json` 均声明 `drizzle-orm ^0.45.2`、`drizzle-kit ^0.31.10`，与当前版本一致，**不存在算法版本差异**。

### 2.3 证据产出

本地原始证据保存在 `tmp/i747-1/`（未提交）：

| 文件 | 内容 |
| --- | --- |
| `evidence-hash-variants.txt` | 21 种归一化变体 × 两条账本哈希比对结果 |
| `evidence-reconstruction.txt` | 重构候选（删减语句 / 替换模板 ID / 语句重排）× 比对结果 |
| `evidence-blob-scan.txt` | 全对象库流式扫描结果 |
| `db-readonly.json` | 1454 只读结构快照（身份、账本、列、约束、索引、策略、回填统计） |
| `db-differential.json` | `platform_configs` 全部 jsonb 列的约束对照 |
| `*.mjs` | 可复跑的审计脚本（无连接凭证，凭证从 `admin/.env.local` 读取） |

## 3. 两条迁移 SHA 对比

| 项目 | `0021_platform_notification_config.sql` | `0051_staff_referrer_network.sql` |
| --- | --- | --- |
| 账本 `hash`（id 28 / 58） | `9df6e11e9638ce3c44a907161391ba873736e3155fe875f6d530247c5ad8ab5c` | `a41ef104297b2d5f15bc7728c2d4f3805600fdb709235fa95c5e61d11824939e` |
| 当前原始字节（Windows CRLF 检出） | `01754fbfab1df46476efd9413dba92bfceae7b6ac9c22c497078215fd624fcd6` | `0e403f6db6fe298abc026f76b2031d7d1669f8da82e2530f62ae147e16518bf2` |
| 当前 LF 归一化 | `ad51f60fdbdcac9a672770877b64d13284de7de283f363405fad4cf773f29d80` | `e5afd41b641f5e954e82784cba9435223034381e6ce38645f62eff858f8e7d94` |
| 当前 LF→CRLF 归一化 | 同原始字节 `01754fbf…` | 同原始字节 `0e403f6d…` |
| Git blob | `13d63bbd2517f1b454eda6dabc833ca8639edc89`（2196 B，纯 LF） | `0491dc153dd15064a347a4be92f73e8c41f7419a`（3136 B，纯 LF） |
| 账本 `created_at` | `1786540800000` = `2026-08-12T13:20:00Z` | `1788184800000` = `2026-08-31T14:00:00Z` |
| journal `when` | `1786540800000`（一致） | `1788184800000`（一致） |

两条账本哈希与当前文件的三种接受形式**全部不同**。

## 4. Git 历史审查

### 4.1 提交列表（`git log --all --full-history`）

`0021_platform_notification_config.sql`：

| 提交 | 日期 | 说明 | 变更 |
| --- | --- | --- | --- |
| `e7c259ee77b6d846792c57b6a78d67bba0bf6cef` | 2026-08-12 21:21:29 +0800 | `Update floor planner modules and workflows` | 新增，51 行（该提交共 240 个文件） |

`0051_staff_referrer_network.sql`：

| 提交 | 日期 | 说明 | 变更 |
| --- | --- | --- | --- |
| `f7e712f2eecbea4baf11b67d495792409fab5755` | 2026-08-31 17:38:56 +0800 | `Refactor floor planning and renovation lead workflows` | 新增，78 行（该提交共 98 个文件） |

结论：**两条文件在全部可达历史中都只有"新增"这一次变更，此后从未被修改、删除或重命名**（`--diff-filter=D` 无记录）。

### 4.2 journal 条目来源

`git log -S … -- admin/drizzle/meta/_journal.json` 显示两条 journal 条目**与 .sql 同属一个提交**：

- `0021` 条目 → `e7c259ee`（journal `when` 21:20，提交 21:21，正常）
- `0051` 条目 → `f7e712f2`（journal `when` 22:00，提交 17:38，**journal 时间晚于提交约 4.4 小时**，属异常）

同一 journal 中大量相邻条目 `when` 差值恰为 `86400000`（整 24 小时），说明 **journal 是手工维护并按天排布的**，不是 `drizzle-kit generate` 的自然产物。

### 4.3 全历史内容搜索（关键证据）

不仅比对当前文件，而是遍历**整个对象库**：

```text
total objects=38216  blobs=21434  size-candidates(1500–6000B)=5110  ledger-matches=0
（第二轮流式无体积限制复扫）blobs scanned=21434  ledger matches=0
```

扫描覆盖：

- 全部引用可达对象（16 个远端分支 + 本地分支 + stash 引用）；
- `git fsck --unreachable` 报告的全部 988 个不可达 blob；
- 每个 blob 均按原始字节 / LF / CRLF 三种形式计算 SHA-256。

结果：**本克隆中不存在任何能产生这两条账本哈希的内容**，包括不可达对象与两个 stash。

### 4.4 文件系统副本比对

工作区内共找到 **42 份**同名文件（含 `admin/.next/standalone`、`admin/release`、`tmp/` 各历史快照）。全部 42 份的 LF 哈希完全一致：

- 40 份为 CRLF（Windows 检出）
- 2 份为纯 LF（`tmp/cloud-site-trial-r3-20261111/r3src`、`tmp/worktree-cutover-20261114-160733632/former-worktree-residue`）

**没有任何一份匹配账本哈希**，因此也不存在"某台机器的旧工作副本才是原文"的情形。

### 4.5 远端引用

`git ls-remote origin` 共 16 条引用，**全部是分支，无 `refs/tags`、无 `refs/pull`**。本克隆 reflog 最早可追溯到 `2026-10-09`，但可达提交历史自 `2026-03-23` 的 `Initial commit`（`495ff9b3`）起完整，共 **1017 个提交**，并非浅克隆。

> 限制：若远端历史上曾被 force-push 覆盖过且本克隆从未获取那些对象，则被覆盖的版本无法在此证明存在或不存在。这一点无法用本地证据排除。

## 5. 文件编码与换行检查

| 检查项 | `0021` | `0051` |
| --- | --- | --- |
| BOM | 无 | 无 |
| 工作区换行 | CRLF（`core.autocrlf` 检出） | CRLF |
| Git blob 换行 | 纯 LF | 纯 LF |
| 混合换行 | 无 | 无 |
| 末尾换行 | 有（`\n` 结尾） | 有 |
| 字节数（工作区 / blob） | 2247 / 2196 | 3214 / 3136 |
| 字符数（LF） | 2140 | 3126 |
| 行数 | 52 | 79 |
| `--> statement-breakpoint` | **0 处**（journal 却声明 `breakpoints: true`） | 13 处 |

**编码类假设已全部排除**：无 BOM、无混合换行、末尾换行存在，且校验器接受 CRLF/LF 两种形式。为彻底排除"哈希算法或归一化差异"，另测试了 21 种变体（`trim`、去末尾换行、去 BOM、行尾裁剪、折叠空行、去注释、语句拆分重组、单双引号替换、Tab 展开、追加 BOM 等），**全部不匹配**：

```text
=== 0021 === no normalization variant matches (0 / 21)
=== 0051 === no normalization variant matches (0 / 21)
```

## 6. 迁移内容差异分析

### 6.1 `0021_platform_notification_config`

#### 6.1.1 当前文件的语义

| # | 语句 | 预期结果 |
| --- | --- | --- |
| 1 | `ADD COLUMN IF NOT EXISTS notification_config jsonb` | 新增可空 jsonb 列 |
| 2 | `UPDATE … SET '{}' WHERE IS NULL` | 回填空值 |
| 3 | `ALTER COLUMN SET DEFAULT '{}'::jsonb` + `SET NOT NULL` | **列变为 NOT NULL 且带默认值** |
| 4 | `INSERT ('default','{}') ON CONFLICT DO NOTHING` | 初始化 default 行 |
| 5 | `UPDATE … version=2 + legacyTemplateId + 四类模板`，条件 `version < 2` | 写入 v2 配置与四类模板 |

四类模板 ID 与 [docs/miniprogram-subscription-notification-template-baseline.zh-CN.md](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/docs/miniprogram-subscription-notification-template-baseline.zh-CN.md)（2026-08-12 基线）逐字一致：

| 类型 | 当前 SQL 中的 `templateId` | 与文档基线 |
| --- | --- | --- |
| `workflow_todo` | `48Jvq7OjOKwRhsnh8fyvtsjxAamLOakaNtiKcO11rOc` | 一致 |
| `lead_assignment` | `wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA` | 一致 |
| `new_lead` | `EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc` | 一致 |
| `measurement_appointment` | `CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl` | 一致 |

#### 6.1.2 1454 实际结构（只读查询）

```text
notification_config | jsonb | is_nullable=YES | column_default=null
```

**这是决定性的结构反证**：如果应用时的文件包含第 3 条 `SET DEFAULT` + `SET NOT NULL`，该列现在必然是非空且带默认值。它现在是可空无默认，说明**应用时的 0021 不包含这条语句**，或该语句从未生效。

#### 6.1.3 对照实验（排除其他解释）

`platform_configs` 全部 jsonb 列的现状：

| 列 | 迁移 | 是否 NOT NULL | 默认值 |
| --- | --- | --- | --- |
| `media_storage` | 早期 | 是 | `'{}'::jsonb` |
| `promotion_config` | 早期 | 是 | `'{}'::jsonb` |
| **`notification_config`** | **0021** | **否** | **无** |
| `mini_program_code_config` | 0028 | 是 | `'{}'::jsonb` |
| `sms_config` | 0040 | 是 | `'{}'::jsonb` |
| `map_service_config` | 早期 | 是 | `'{}'::jsonb` |
| `ai_prompt_config` | 0052 | 否 | 无（该文件只 `ADD COLUMN`） |
| `enterprise_registration_code_template_config` | 早期 | 否 | 无 |
| `llm_config` | 早期 | 否 | 无 |

[0028_mini_program_code_config.sql](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/drizzle/0028_mini_program_code_config.sql) 与 0021 **写法完全相同**（`ADD COLUMN` → 回填 → `SET DEFAULT` + `SET NOT NULL`，同样无 breakpoint），其列在 1454 中**确实是 NOT NULL 带默认值**。

同一迁移器、同一写法、相邻编号，只有 0021 的结果不符合文件预期 → **不是环境或执行器问题，而是 0021 应用时的内容不同**。

#### 6.1.4 其他佐证与旁证

- `meta/0024_snapshot.json` 记录的目标 schema 为 `notNull: true`、`default: "'{}'::jsonb"`；即"期望状态"一直与当前 0021 文件一致，**是实际库没跟上**。
- 当前 TS 模型 [admin/src/db/schema.ts](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/db/schema.ts#L774) 声明 `notificationConfig: jsonObject<…>('notification_config')`（可空），`e7c259ee` 版本也相同 → **TS 模型、1454 实际库一致，只有迁移文件更严格**。这也是"文件被加强过、但历史库没重跑"的典型形态。
- 之后无任何迁移再触碰 `notification_config` 的约束（全库 grep 确认只有 0021 一处），排除"后续迁移改回去"。

#### 6.1.5 运行期数据漂移（独立问题，需另行处理）

`platform_configs` 中 `key='default'` 的实际内容：

| 项 | 实际值 | 说明 |
| --- | --- | --- |
| `version` | `2` | 已升级 |
| `legacyTemplateId` | 不存在 | 与 0021 写法不一致（0021 会写该键，无值时为 `null`） |
| `subscriptionMessagesEnabled` | 不存在 | 0021 不写该键；但 [platform-notification-config.ts:196](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/src/lib/platform-notification-config.ts#L196) 的 `storedConfig()` 一定会写该键 |
| 模板数量 | 9 类 | 0021 只写 4 类 |
| `miniprogramTemplateId` | 不存在 | 0021 不写该键 |

9 类模板的存在说明该行**后来被管理端保存（`savePlatformNotificationConfig`）覆盖过**，其模板 ID 来自代码里的 `DEFAULT_SUBSCRIPTION_TEMPLATES`，其中 3 个与 0021 和文档基线不同：

| 类型 | 1454 实际存储 | 0021 / 文档基线 | 差异 |
| --- | --- | --- | --- |
| `workflow_todo` | `48Jvq7OjOKwRhsnh8fyvtsjxAamLOakaNtiKcO11rOc` | 同左 | 一致 |
| `lead_assignment` | `wItuS0LdggzpMWdSOIr6FBSKeRbOKUzqXVCqJDmLpmA` | `wltuS0LdggzpMWdSOlr6FBSKeRbOKUzqXVCqJDmLpmA` | 3 处字符不同（`I`↔`l`） |
| `new_lead` | `EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjg4xest9GRc` | `EEvg03Lsp4V0ASHWhLOMiTmDI79Z_T3Sjq4xest9GRc` | 1 处（`g`↔`q`） |
| `measurement_appointment` | `CtcuQ_NWF4GOpHvstgviDPmYRISjyqTjnFAoeQR9-vI` | `CtcuQ_NWF4GOpHvstgviDPmYRlSjyqTjnFAoeQR9-vl` | 2 处（`I`↔`l`） |

> 这不是本次哈希问题的成因，但属于同一片区域的真实数据问题：1454 当前存储的 3 个模板 ID 与迁移文件、文档基线都不一致，疑似形近字符录入错误。受影响的是微信订阅消息的实际投递，建议单独立项核对，**不在本轮修改**。

### 6.2 `0051_staff_referrer_network`

#### 6.2.1 逐条对象对照

| 当前文件语句 | 1454 实际 | 判定 |
| --- | --- | --- |
| `ADD COLUMN inviter_staff_id bigint` + FK `ON DELETE RESTRICT` | `bigint`、可空、`FOREIGN KEY (inviter_staff_id) REFERENCES app.admin_users(id) ON DELETE RESTRICT` | 一致 |
| `ADD CONSTRAINT enterprise_join_codes_inviter_type_check` | `CHECK (((inviter_staff_id IS NULL) OR (code_type = 'referrer'::text)))` | 一致 |
| `DROP INDEX IF EXISTS enterprise_join_codes_active_type_uidx` | 该索引不存在 | 一致 |
| `CREATE UNIQUE INDEX enterprise_join_codes_active_enterprise_scope_uidx … WHERE status='active' AND inviter_staff_id IS NULL` | 存在，谓词逐字一致 | 一致 |
| `CREATE UNIQUE INDEX enterprise_join_codes_active_staff_scope_uidx … WHERE status='active' AND inviter_staff_id IS NOT NULL` | 存在，谓词逐字一致 | 一致 |
| `CREATE INDEX enterprise_join_codes_inviter_staff_created_idx (inviter_staff_id, created_at)` | 存在 | 一致 |
| `ADD COLUMN invited_by_staff_id bigint` + FK `ON DELETE SET NULL` | 存在（`bigint`、可空） | 一致 |
| `ADD COLUMN invited_by_name_snapshot text` | 存在（`text`、可空） | 一致 |
| `CREATE INDEX referrer_memberships_enterprise_inviter_status_idx (enterprise_id, invited_by_staff_id, status)` | 存在，列序一致 | 一致 |
| `CREATE POLICY staff_referrer_network_migrator_admin_users` | 不存在 | 一致（文件末尾已 DROP） |
| `CREATE POLICY staff_referrer_network_migrator_memberships` | 不存在 | 一致（文件末尾已 DROP） |
| `UPDATE … sole_enterprise_admin` 回填 | 见 6.2.2 | 无可观测差异 |

临时策略清理确认：`pg_policies` 中 `staff_referrer_network_migrator%` **0 条**，即迁移末端的两个 `DROP POLICY` 已执行完毕，没有残留宽权限策略。

#### 6.2.2 历史回填行为差异（重点）

当前文件的回填规则是"仅当企业**恰好只有 1 个** `enterprise_admin` 时，把该管理员写入 `invited_by_staff_id` 与姓名快照；多管理员企业保持未指派"。该规则与 [docs/referrer-network-appointment-development-plan.md:186](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/docs/referrer-network-appointment-development-plan.md#L186) 的设计契约完全一致（"backfilled to the owner only when the enterprise has exactly one `enterprise_admin`"）。

1454 实际数据：

```text
referrer_enterprise_memberships: total=0  with_staff=0  with_snapshot=0  unassigned=0
enterprises_with_exactly_one_enterprise_admin: 0
```

两项都为 0，意味着：

1. 迁移执行时该表没有任何行，**回填语句是空操作**；
2. 即使当时文件里的回填条件不同（例如按最早管理员、按任意管理员），在 0 行数据上**结果完全相同**；
3. 今天重跑也不会产生任何差异（仍无"恰好 1 个企业管理员"的企业）。

因此 0051 的历史回填差异在这套库上**没有数据后果**，这一点比"列和索引存在"更强：不是"看起来等价"，而是"被作用的数据集为空"。

> 注意：该结论只对当前 1454 数据成立。若将来在别的环境用当前文件重建基线，回填规则会真实生效。

#### 6.2.3 0051 的可观测差异边界

由于 13 条语句的效果全部在位，且回填无数据影响，剩余差异只能落在**不影响最终结构或已被删除的对象**上，例如：

- 注释块文字（文件第 37–39 行）；
- 语句书写格式、括号与换行；
- 临时策略的名称/角色/`USING` 表达式细节（最终都 DROP）；
- `DROP INDEX` 是否带 `IF EXISTS`；
- 回填 SQL 的具体写法（结果为空）。

这类差异无法从最终结构反推原文，因此 0051 的**原文不可复原**。

#### 6.2.4 0051 的非幂等性提醒

`0051` 中以下语句**没有**幂等保护：

- `ALTER TABLE … ADD CONSTRAINT enterprise_join_codes_inviter_type_check`（无 `IF NOT EXISTS`）
- `CREATE POLICY …`（PostgreSQL 不支持 `IF NOT EXISTS`）

因此 **0051 不能重复执行**，任何"删除账本行让它重跑"的方案都会直接失败。这也是修复方案必须避开的关键点。

## 7. 根因分类

| 迁移 | 分类 | 证据 | 候选提交 |
| --- | --- | --- | --- |
| `0021` | **`historical_content_change`** | ① 三种换行形式 + 21 种归一化变体均不匹配；② 全对象库 21,434 blob 0 匹配；③ **1454 列可空无默认，而当前文件会设 `NOT NULL DEFAULT '{}'`，同写法的 0028/0040 都已生效** | 引入提交 `e7c259ee`。差异版本**未出现在任何可达/不可达对象中** |
| `0051` | **`historical_content_change`**（结构等价、原文不可复原） | ① 同上不匹配；② 13 条语句的结构效果全部在位；③ 回填作用于 0 行 | 引入提交 `f7e712f2`。差异版本不可得 |

不是 `exact_match`：没有任何历史文件匹配账本哈希。
不是 `line_ending_only`：校验器本就接受 CRLF/LF，且 21 种变体全部落空。
不是 `unknown`：两条都**能证明内容确有变化**（0021 有结构反证；0051 有"三形式全拒绝"的排除法），只是原文无法取回。

**成因推断（按证据强弱排序）**：

1. **最强**：迁移文件在"已被应用"之后又被人工修改（补 `SET NOT NULL`、调整模板 ID、重排语句、加注释），而修改前的版本从未提交——所以 Git 里只留下修改后的唯一版本。0021 的可空列是这条推断的直接物证。
2. **次强**：journal 由人工按天维护（大量 `when` 恰好相差 24 小时、`0051` 的 journal 时间晚于提交 4.4 小时），迁移编号与时间不反映真实执行时刻，进一步说明这批迁移是手工编排而非生成器产物。
3. **可能**：远端历史曾被 force-push 覆盖，旧版本对象从未进入本克隆（本地证据无法证实或否证）。

## 8. 修复方案比较

> 前提共识：`validateLedger()` 必须先放行这两条历史记录，否则**任何**新迁移都无法执行（它在应用 DDL 前抛错，见 [postgres-integration-migrations.mjs:37](file:///G:/workspace/%E5%90%91%E6%80%BB/Smart-Floor-Planner/admin/scripts/postgres-integration-migrations.mjs#L37)，测试用例 `an actually applied unknown migration cannot hide earlier pending migrations` 已固化该行为）。因此任何"只加新迁移"的方案都不能单独解除阻断。

### 方案 A：恢复与账本 SHA 匹配的原始迁移文件

| 维度 | 评估 |
| --- | --- |
| 可行性 | **不可行**。21,434 个 blob（含不可达）+ 42 份文件副本均无匹配；连"删掉 `SET NOT NULL` 块"的重构候选（`dab931a8…`）也不等于账本哈希 |
| 数据风险 | 无（纯文件操作） |
| 重复执行风险 | 若恢复为弱化版本，新环境建出的 0021 结构会与当前文件承诺不一致 |
| 其他环境兼容 | 差：CI/预演库从不持有该哈希，恢复后只会让新环境得到更弱的 schema |
| 数据库备份 | 不需要 |
| 停 Worker | 不需要 |
| 回滚方式 | `git revert` |
| 对其他部署环境影响 | 会让"文件"与"1454 实际结构"永久分叉，且无法验证正确性 |

**结论：排除。** 无法获得字节级原文，强行"重构"也无法通过 SHA 校验。

### 方案 B：通过独立新迁移修复历史结构差异

| 维度 | 评估 |
| --- | --- |
| 可行性 | 可以写，但**单独使用不能解除阻断**（新迁移排在 0021 之后，校验先失败）。必须与 C 或 D 组合 |
| 能修什么 | 只能修 `0021` 的 `notification_config` 约束差异（`SET NOT NULL/DEFAULT` 对齐，或反向 `DROP NOT NULL` 对齐到 1454 现状） |
| 数据风险 | 中：`SET NOT NULL` 前必须先回填该列为 NULL 的行（1454 具体行数未统计）；`DROP NOT NULL` 无数据风险 |
| 重复执行风险 | 低，可写成幂等（先查 `information_schema`） |
| 其他环境兼容 | 需处理"新环境 0021 已 NOT NULL + 0131 再设一次"的幂等；也要考虑 0051 无对应结构差异 |
| 数据库备份 | 建议（涉及 1454 DDL） |
| 停 Worker | 不需要（表极小、约束轻量） |
| 回滚方式 | 迁移器无 down migration，只能靠备份 |
| 对其他部署环境影响 | 新增一条迁移记录，所有环境需同步 |

**结论：作为可选补充，不作为解除阻断手段。**

### 方案 C：经完整等价性审查与负责人审批后，受控重基线账本 SHA

| 维度 | 评估 |
| --- | --- |
| 操作 | 仅 `UPDATE app.__drizzle_migrations SET hash = <当前 LF 哈希> WHERE id IN (28,58)` |
| 是否解除阻断 | **是**，一步到位 |
| 数据风险 | 低但触及最敏感表：账本是迁移审计唯一依据；改错/改多会掩盖真实漂移 |
| 重复执行风险 | 极低：改完后账本仍标记为已应用，0021/0051 不会重跑（且 0051 本就非幂等，绝不可借机重跑） |
| 其他环境兼容性 | 中：每个长期存在的库都要各自核对并执行一次；新环境无需处理 |
| 数据库备份 | **必须**（账本写操作前做可验证快照） |
| 停 Worker | 建议（在迁移窗口内停，避免与 Worker 的迁移/告警交叉） |
| 回滚方式 | 依赖备份恢复；无 SQL 反向操作 |
| 对其他部署环境影响 | 若还有预演库/其他租户库持有旧哈希，需逐一处理，容易遗漏 |

**结论：可行，但把风险集中在对 1454 账本的一次写操作上。**

### 方案 D：提交式历史哈希白名单（不改数据库账本）

在仓库内新增一份**受控、精确、可审计**的历史哈希清单（例如 `admin/drizzle/legacy/known-hashes.json`，或 `postgres-integration-migrations.mjs` 内的常量表），内容形如：

```json
[
  {
    "id": 28,
    "tag": "0021_platform_notification_config",
    "when": 1786540800000,
    "legacyHashes": ["9df6e11e9638ce3c44a907161391ba873736e3155fe875f6d530247c5ad8ab5c"],
    "reason": "I7.4.7.1：历史应用版本与当前文件不一致，见 docs/xiaok-i747-1-migration-hash-root-cause.md",
    "approvedBy": "<负责人>",
    "approvedAt": "<日期>"
  },
  {
    "id": 58,
    "tag": "0051_staff_referrer_network",
    "when": 1788184800000,
    "legacyHashes": ["a41ef104297b2d5f15bc7728c2d4f3805600fdb709235fa95c5e61d11824939e"],
    "reason": "同上",
    "approvedBy": "<负责人>",
    "approvedAt": "<日期>"
  }
]
```

`validateLedger()` 仅在 `timestamp + tag + 完整 hash` 三项同时精确命中白名单时放行，**其余一律继续拒绝**（不引入通配、不按 tag 前缀放行、不放宽 `prefix` 连续性检查）。

| 维度 | 评估 |
| --- | --- |
| 是否解除阻断 | **是**，且对 1454、其他历史库、新环境**同时生效** |
| 数据风险 | **零数据库写入**（只改仓库） |
| 重复执行风险 | 极低：不删除、不重排账本，不触发重跑 |
| 其他环境兼容性 | 最好：白名单只影响"持有旧哈希的历史库"，新环境仍走当前 journal 校验 |
| 数据库备份 | **不需要**（本轮不动数据库） |
| 停 Worker | **不需要** |
| 回滚方式 | `git revert` 一条提交即可；数据库无副作用 |
| 对其他部署环境影响 | 无：其他环境账本不变，仅校验逻辑多接受 2 条精确历史值 |
| 代价 | 需要在代码里显式承认"账本与文件曾不一致"，并绑定审批信息；`validateLedger` 的维护者需接受这份清单长期存在 |

**结论：推荐。** 它等价于"受控重基线"，但把不可逆的数据库写操作换成了可 review、可 revert 的代码变更。

### 方案对比总表

| 维度 | A 恢复原文 | B 新增迁移 | C 重基线账本 | D 提交式白名单 |
| --- | --- | --- | --- | --- |
| 能否解除阻断 | 否（原文不可得） | 否（单独无效） | 是 | 是 |
| 是否改数据库 | 否 | 是（DDL） | **是（账本 UPDATE）** | 否 |
| 数据风险 | 无 | 中 | 中 | 无 |
| 重复执行风险 | 中（会改变新环境结构） | 低 | 极低 | 极低 |
| 其他环境兼容 | 差 | 中 | 中（需逐库处理） | 好 |
| 需要数据库备份 | 否 | 建议 | **必须** | 否 |
| 需要停 Worker | 否 | 否 | 建议 | 否 |
| 回滚方式 | git revert | 备份恢复 | 备份恢复 | git revert |
| 对其他部署环境影响 | 负面（永久分叉） | 新增迁移记录 | 逐库手工同步 | 无 |

## 9. 推荐方案

**主方案：D（提交式精确历史哈希白名单）+ 需负责人审批。**

理由：

1. 两条哈希的原文无法取回，A 不可行；
2. B 单独无法解除阻断，且 0051 无结构差异可修；
3. C 与 D 效果等价，但 C 要在 1454 账本上做一次不可逆写操作，需要备份 + 窗口 + 逐库同步，而 D 完全没有数据库副作用；
4. D 的放行范围可以做到"3 项精确匹配 + 2 条记录"，比在库里改两行更难出错、更易复核、更容易回滚；
5. D 对 1454、其他历史库、以及后续任何新环境都是同一套逻辑，不会出现"某台机器忘了改账本"的遗漏。

**实施顺序（待批准后执行，本轮不做）**：

1. 负责人书面确认 0021/0051 的等价性结论（本文 §6）与白名单内容；
2. 新增白名单文件 + 改造 `validateLedger()`（仅精确匹配，保留全部现有严格性检查）；
3. 补定向测试：① 两条历史哈希放行；② 仅差 1 位字符仍拒绝；③ 变更 `created_at` 仍拒绝；④ 白名单外的未知迁移仍拒绝；⑤ 新环境完整 journal 行为不变；
4. 在**新的可丢弃 PG17 预演库**上，用 1454 真实 119 条账本复跑 I7.4.7 全流程，确认 8 个 pending migration 成功、`sfp_app` 权限与 FORCE RLS 正常；
5. 备份 1454 后执行迁移窗口（这一步属于 I7.4.7 后续阶段，不在本方案内）。

**可选补充（非阻断，由负责人决定是否立项）**：

- **`notification_config` 结构与新环境对齐**：选择"1454 对齐文件"（新迁移补 `SET NOT NULL` + 回填 NULL 行）或"文件对齐 1454"（新迁移 `DROP NOT NULL`，或后续修订 0021 的下一个版本）。当前业务代码不依赖该约束，两者都安全；**建议保持现状并单独评估**，避免在试点上线窗口内叠加 DDL。
- **`default` 行的 3 个模板 ID 纠偏**：与迁移无关的运行期数据问题（§6.1.5），建议单独核对微信后台后修正。

## 10. 仍需负责人批准的事项

| # | 事项 | 需要谁 | 说明 |
| --- | --- | --- | --- |
| 1 | 接受"0021 应用版本 ≠ 当前文件"的结论 | 技术负责人 | 依据 §6.1.2 结构反证；不接受则无法继续任何方案 |
| 2 | 接受"0051 结构等价、回填零影响"的结论 | 技术负责人 | 依据 §6.2.1/6.2.2 |
| 3 | 批准方案 D（提交式白名单）并指定审批人署名 | 产品/技术负责人 | 白名单需落 `approvedBy` / `approvedAt` |
| 4 | 确认不复原 0021 的 `SET NOT NULL`（或明确要求补一条新迁移） | 技术负责人 | 影响新环境与 1454 的 schema 一致性 |
| 5 | 确认允许修改 `validateLedger()` | 技术负责人 | 本轮明确禁止；下一轮需单独授权 |
| 6 | 是否同步处理 `default` 行 3 个错误模板 ID | 业务负责人 | 影响微信订阅消息实际投递 |
| 7 | 1454 执行迁移的窗口、备份方式、是否停 Worker | 运维/负责人 | 属 I7.4.7 后续阶段 |

## 11. 本轮未做与限制

- 未修改 `0021`、`0051`、`journal`、`validateLedger`、`__drizzle_migrations`、`smart_floor_planner` 业务数据；
- 未执行 `npm run db:migrate`，未执行任何账本 UPDATE，未连接生产，未关闭 RLS，未使用超级用户；
- 数据库侧仅做**只读**查询：连接为 `sfp_app`（`rolsuper=false`、`rolbypassrls=false`），事务以 `begin read only` 开启并 `rollback` 结束；
- 无法证明远端历史是否曾被 force-push 覆盖（§4.5）；
- 无法统计 `notification_config` 当前 NULL 行数（若将来选择 `SET NOT NULL` 需要该统计）；
- 预演库（I7.4.7）由当前文件构建到 `0119`，因此其 `notification_config` 是 **NOT NULL**，而 1454 是可空——**预演库与 1454 在该列上本身就不一致**。这不影响 0120–0130 的执行（无迁移依赖该约束），但记录在此以免被误读为"预演库已完全复现 1454"。

## 12. 回归与提交

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 迁移器定向测试 | `node --test scripts/__tests__/xiaok-integration-migrations.test.mjs` | 7 项 `SKIP`（未提供 `XIAOK_I4_PG_URL` / 迁移密码，符合预期），0 fail |
| TypeScript | `npx tsc --noEmit` | 通过（exit 0） |
| 定向 ESLint | `npx eslint scripts/postgres-integration-migrations.mjs scripts/postgres-migrate.mjs` | 通过（exit 0） |
| 迁移器语法 | `node --check scripts/postgres-integration-migrations.mjs`、`node --check scripts/postgres-migrate.mjs` | 均通过（exit 0） |

> 说明：本轮只新增文档，不改动代码与迁移，故不引入新的类型或 lint 面。数据库类用例需要隔离 PG 与迁移密码，未提供环境变量时按设计跳过，未伪造通过。

提交：独立提交并推送 `origin/codex/xiaok-integration`，不合并 `main`，不部署生产。
工作区原有的未提交改动（`AGENTS.md`、`source-manifest.json`、`miniprogram/*`、`admin/tsconfig.json` 等）保持原样，未纳入本次提交。
