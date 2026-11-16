# 家客来 V1.0 自有密钥自动初始化（Secret Bootstrap）验收

2026-11-16（Asia/Shanghai）。分支 `codex/xiaok-integration`，基线 `933c2ae1`。本报告验收自有密钥的自动生成、配置、检查、历史密文兼容和生产注入方案，不重复开发 I7.5.23 已完成的 JWT、凭据加密、管理员密码与生产门禁模块。

## 结论

**`passed`。** 五项自有密钥可幂等生成或补齐；已有有效密钥不覆盖；加密类密钥轮换时自动保留 `<NAME>_PREVIOUS`，历史 AI/媒体密文仍可解密；生产只生成仓库外的受限注入计划，不修改 `.env.production`；百炼、Embedding 等第三方凭据缺失只标记 `pending`，不阻塞。

## 1. 实现

新增 [bootstrap-secrets.mjs](../admin/scripts/bootstrap-secrets.mjs) 与定向测试 [bootstrap-secrets.test.mjs](../admin/scripts/__tests__/bootstrap-secrets.test.mjs)。

### 1.1 自有密钥

| 变量 | 最小长度 | 加密历史 | 本地结果 |
| --- | ---: | --- | --- |
| `JWT_SECRET` | 32 | 是 | 占位值 → 轮换，保留 `JWT_SECRET_PREVIOUS` |
| `INTERNAL_SECRET` | 32 | 否 | 占位值 → 轮换 |
| `AI_PROVIDER_KEY_ENCRYPTION_SECRET` | 32 | 是 | 缺失 → 生成 |
| `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` | 32 | 是 | 占位值 → 轮换，保留 `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS` |
| `CRON_SECRET` | 32 | 否 | 原有 64 字符有效值 → 保留 |

生成算法：`randomBytes(48).toString('base64url')`，即 64 字符；五项互不相同。

### 1.2 幂等与安全规则

- 已有有效值（长度达标、非占位、非已知弱值）不覆盖。
- 占位值、短值、已知弱值：非加密密钥直接轮换；加密密钥轮换时把旧值写入 `<NAME>_PREVIOUS`。
- `<NAME>_PREVIOUS` 已存在时拒绝再次轮换（避免丢失更早的密文密钥），状态 `blocked`。
- 五个密钥出现重复值时，按 `CRON → INTERNAL → AI → MEDIA → JWT` 的优先级重新生成一个，JWT 保留为历史锚点。
- 写盘前检查 Git 忽略与跟踪状态：未忽略或已被跟踪直接拒绝。
- 原子写入（临时文件 + rename）；新文件权限 600（POSIX）或受限 ACL（Windows）。
- 重复执行不改变文件内容；生产计划重复执行复用已有计划，不生成新值。

### 1.3 历史密文兼容

[crypto.ts](../admin/src/lib/crypto.ts) 的只读兼容链新增：

- AI 凭据：`AI_PROVIDER_KEY_ENCRYPTION_SECRET` → `AI_PROVIDER_KEY_ENCRYPTION_SECRET_PREVIOUS` → `POLLINATIONS_KEY_ENCRYPTION_SECRET` → `JWT_SECRET_PREVIOUS` → `JWT_SECRET`（开发环境再加旧固定默认值）。
- 媒体凭据：`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` → `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS` → `AI_PROVIDER_KEY_ENCRYPTION_SECRET` → `AI_PROVIDER_KEY_ENCRYPTION_SECRET_PREVIOUS` → `JWT_SECRET_PREVIOUS` → `JWT_SECRET`（开发环境再加旧固定默认值）。

加密始终使用当前主密钥；只有解密按上述顺序尝试，失败信息不包含密文或密钥。

兼容性论证：轮换前的候选集合是轮换后候选集合的子集（旧 JWT、旧 MEDIA 均以 `_PREVIOUS` 保留，旧 AI 缺失、旧 POLLINATIONS 缺失），因此轮换前可解密的数据轮换后仍可解密。

## 2. 本地验收

执行：`cd admin && npm run secrets:bootstrap`，随后 `npm run secrets:bootstrap -- --fix-permissions`。

| 检查 | 结果 |
| --- | --- |
| 五项自有密钥 | 4 项生成/轮换、1 项保留；全部 64 字符 |
| 重复值 | 0 组 |
| `.env.local` Git 状态 | 未跟踪，命中 `admin/.gitignore:40:.env*` |
| `.env.local` 权限 | 修复前 53 条 ACL、含 broad write；修复后 3 条（SYSTEM、Administrators、当前用户），`broadWrite=false`、`broadRead=false` |
| `npm run secrets:check` | 退出 0，全部 `valid` |
| 重复执行 | `changed=false applied=false`，文件内容不变 |
| 第三方待配置 | `DEPLOY_SMOKE_USERNAME`、`DEPLOY_SMOKE_PASSWORD`（仅提示，不阻塞） |

### 2.1 真实开发库密文回读

在只读事务中读取开发库并用新密钥集解密，不输出明文：

| 类别 | 行数 | 解密成功 | 失败 |
| --- | ---: | ---: | --- |
| `ai_provider_configs.api_key_encrypted` | 3 | 3 | 0 |
| `media_storage_configs` | 6 | 1 | 5 |

5 条失败记录的密文长度为 12、点号数为 0，本身不是 `iv.tag.ciphertext` 格式（历史占位/脏数据），在轮换前同样无法解密；唯一的真实媒体密文（98 字符、2 个点号）解密成功。因此本轮轮换未造成历史数据回退。

## 3. 生产注入方案

执行：`npm run secrets:bootstrap -- --production-plan`。

| 项目 | 结果 |
| --- | --- |
| `.env.production` 是否修改 | 否；执行前后 SHA-256 均为 `4795f2ed538995d0cdbb07df5b04f9126af9587e5051f8222ee214fec17cd3c6` |
| 计划文件 | `C:\Users\Administrator\.sfp-secrets\sfp-production-secrets.env`（仓库外） |
| 计划内容 | `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET_PREVIOUS`、`INTERNAL_SECRET`、`AI_PROVIDER_KEY_ENCRYPTION_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` |
| 未写入计划 | `JWT_SECRET`、`CRON_SECRET`（现有值有效，保持不变） |
| 计划文件权限 | 仅 SYSTEM、Administrators、当前用户（3 条 ACL） |
| 重复执行 | `planReused=true`、`changed=false`，计划内容不变 |
| 第三方待配置 | `ASSISTANT_BAILIAN_RAG_WORKSPACE_ID`、`ASSISTANT_BAILIAN_RAG_API_KEY`、`ASSISTANT_EMBEDDING_URL`、`ASSISTANT_EMBEDDING_API_KEY` |

生产注入要求：把计划文件的键值合并进批准的运行时密钥库，禁止覆盖整个 env 文件；先部署 `*_PREVIOUS` 与新密钥，确认旧凭据仍可读后，再清理 `*_PREVIOUS`。生产门禁 `check:production-env` 仍会因百炼/Embedding 缺失而拒绝部署，这是预期行为。

## 4. 命令

```bash
cd admin
npm run secrets:bootstrap                     # 本地生成/补齐
npm run secrets:bootstrap -- --check          # 只检查，不写盘
npm run secrets:bootstrap -- --fix-permissions # 收紧 env 文件权限
npm run secrets:bootstrap -- --env-file .env.test
npm run secrets:bootstrap -- --production-plan
npm run secrets:bootstrap -- --production-plan --plan-output D:\secrets\sfp.env
npm run test:secrets
```

管理脚本入口同时写入 [package.json](../admin/package.json)。

## 5. 检查项

- 长度：全部 ≥32（实际 64）。
- 占位值：`replace`、`your_`、`example`、`change_me`、`placeholder` 均判定无效。
- 已知弱值：`123456`、`fallback_secret_random_123`、`smart-floor-planner-pollinations-secret`、`local-dev-credential-encryption-only`。
- 重复使用：五项两两比较，重复即重新生成一项。
- Git：`git check-ignore` 与 `git ls-files --error-unmatch` 双重检查。
- 权限：POSIX 检查 `mode & 0o077`；Windows 解析 `icacls`，区分 broad write 与只读继承，`--fix-permissions` 收紧为 SYSTEM、Administrators、当前用户。

## 6. 测试与静态检查

| 检查 | 结果 |
| --- | --- |
| `npm run test:secrets` | 15/15 通过 |
| `npx tsx --test src/lib/__tests__/credential-encryption.test.ts` | 8/8 通过（新增 JWT/AI/媒体轮换兼容 4 项） |
| `npx tsx --test src/lib/ai/__tests__/media-storage.test.ts` | 21/21 通过 |
| TypeScript | 干净检出 + 本轮 `crypto.ts`/测试副本执行 `tsc --noEmit` 退出 0 |
| ESLint | 四个改动文件 `--max-warnings 0` 退出 0 |
| 历史全量 ESLint 基线 | 未变化（仍为 `portfolio-kodo` 的 8 个既有 error，不在本轮范围） |

## 7. 边界

- 未写入 `.env.production`，未部署生产，未启动生产 Worker，未发送真实通知。
- 未生成百炼、微信、Embedding、Smoke 账号等第三方凭据。
- 未调用任何模型/Embedding API，未产生付费调用。
- 未修改企业 1454 业务数据；开发库仅做 `READ ONLY` 读取。
- 未重复开发 I7.5.23 的 JWT、AI 凭据加密、管理员随机密码、生产门禁模块；仅新增只读 `_PREVIOUS` 兼容链和媒体多密钥解密回退。
