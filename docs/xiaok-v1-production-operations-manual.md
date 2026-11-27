# 家客来 V1.0 生产运维手册

2026-11-16（Asia/Shanghai）。适用分支 `codex/xiaok-integration`，发布候选提交见《V1.0 最终交付报告》。本手册只描述已实现并经过验证的操作；未配置或未批准的步骤明确标注。

## 1. 发布物与版本

| 项目 | 值 |
| --- | --- |
| 源码分支 | `codex/xiaok-integration` |
| 发布候选提交 | `a38633a6`（镜像构建源码 `2538727a`） |
| Admin 镜像 | `sfp-admin:i7524-rc2`（SHA-256 见交付报告） |
| 数据库迁移 | 129 条账本，末条 `0132_assistant_platform_knowledge_citations`（ID 135） |
| 小程序 | AppID `wxa7728432f59779d1`，生产预览编译 9.0 MB |

发布必须从干净检出构建；不得直接使用开发工作区的 `node_modules`、`.next` 或 `.env.local`。

## 2. 生产环境变量

统一门禁：`admin/scripts/production-env-check.mjs`。`deploy.sh` 在触碰 PostgreSQL 之前执行；任一必填项缺失、占位或弱值即失败退出，这是预期的失败关闭。

### 2.1 必需（生产必须显式设置）

| 变量 | 要求 |
| --- | --- |
| `JWT_SECRET` | ≥32 字符，非占位，生产缺失即失败 |
| `INTERNAL_SECRET` | ≥32 字符，独立随机 |
| `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` | ≥32 字符，独立随机 |
| `AI_PROVIDER_KEY_ENCRYPTION_SECRET` | ≥32 字符，必须不等于 `JWT_SECRET` |
| `CRON_SECRET` | ≥32 字符，preflight 与 tick 共用 |
| `DATABASE_URL` | 应用账号，不得使用 `_local_only` 口令 |
| `DATABASE_MIGRATION_URL` | 迁移账号，不得使用 `_local_only` 口令 |
| `AUTH_COOKIE_SECURE` | HTTPS 环境必须 `true` |
| `ALLOW_TENANT_ENTERPRISE_RESET` | 生产必须 `false` |
| `WX_APPID` / `WX_APPSECRET` | 生产小程序凭据 |
| `WECHAT_MINIPROGRAM_CODE_ENV` | `release` |
| `MINIPROGRAM_API_PUBLIC_ORIGIN` | 生产 HTTPS 域名 |
| `DEPLOY_SMOKE_USERNAME` / `DEPLOY_SMOKE_PASSWORD` | 最小权限专用账号，≥12 字符，不得与初始管理员同口令 |

### 2.2 AI 知识（启用前必需）

- 百炼托管 RAG：`ASSISTANT_KNOWLEDGE_PROVIDER=BAILIAN_RAG`、`ASSISTANT_BAILIAN_RAG_WORKSPACE_ID`、`ASSISTANT_BAILIAN_RAG_API_KEY`、`ASSISTANT_BAILIAN_RAG_CATEGORY_ID`（默认 `default`）、`ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL=text-embedding-v4`。
- 本地备用：`ASSISTANT_EMBEDDING_URL`、`ASSISTANT_EMBEDDING_API_KEY`；回环地址必须显式 `SFP_ALLOW_LOOPBACK_EMBEDDING=true`，且只在同容器 sidecar 且已验证时使用。
- 文本模型：平台 `llm_config` 或 `ASSISTANT_TEXT_MODEL` 指定。当前已批准默认是 `qwen3.7-flash`；DeepSeek Flash 只有在完成协议、工具、引用与费用验证后才可设 `ASSISTANT_RESPONSES_API=1`。
- 未配置知识时，AI 必须降级为 Facts-only 或明确 `insufficient_evidence`/`retrieval_unavailable`，不得编造来源。

### 2.3 Worker（启用前必需）

- `ASSISTANT_WORKER_ENDPOINT=http://admin:3005/api/internal/assistant/jobs/run`
- `CRON_SECRET`
- `ASSISTANT_WORKER_HEALTH_FILE=/shared/assistant-worker-health.json`（compose 已为 `admin` 与 `assistant-worker` 挂载同一 `assistant_health` 卷）
- 试点门禁由后台「平台管理中心 → 小K Worker 启停」页维护（表 `app.assistant_worker_settings`，版本化审计）。
  - 首次保存前，可由 `XIAOK_STAGE_REMINDER_*` / `XIAOK_WEEKLY_REPORT_*` 成对提供初始 pilot 配置作为种子值。
  - 保存过一次后以数据库最新版本为准；建议随后清空运行时 env 中的这六个变量，避免数据库不可读时回退到旧值。
  - 后台只允许配置 pilot（企业 + pilot ID + 试点项目范围），不提供企业全域开关。

未保存配置且 env 也未成对提供 pilot 时门禁关闭，Worker 保持常驻空转。试点范围不存在、未激活、为空或查询失败时，试点提醒和周报停止生成与投递。

### 2.4 自有密钥初始化与运行时文件

自有密钥（`JWT_SECRET`、`INTERNAL_SECRET`、`AI_PROVIDER_KEY_ENCRYPTION_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`、`CRON_SECRET`）由 Secret Bootstrap 生成，不手工拼接：

```bash
cd admin
npm run secrets:bootstrap                      # 本地 .env.local，幂等
npm run secrets:bootstrap -- --env-path .env.test
npm run secrets:check                          # 只检查
npm run secrets:bootstrap -- --production-plan --env-path /opt/sfp/.env.production
```

- 生产只生成仓库外的注入计划（默认 `~/.sfp-secrets/sfp-production-secrets.env`），不修改 `.env.production`。
- 计划中的 `<NAME>_PREVIOUS` 必须与新密钥一起注入；确认旧凭据可读后，才可清理。
- 计划只包含缺失或占位/无效的键；有效密钥不覆盖。
- 百炼、Embedding、微信、Smoke 账号不会自动生成，缺失时标记 `pending`。
- 运行时 env 模板：`deployment/production/runtime.env.template`；模板中的 `replace_with_...` 会被门禁拒绝，必须替换或由计划注入。
- 应用自有密钥计划：

```bash
node scripts/apply-secret-plan.mjs --plan ~/.sfp-secrets/sfp-production-secrets.env \
  --target /opt/sfp/.env.production --check
node scripts/apply-secret-plan.mjs --plan ~/.sfp-secrets/sfp-production-secrets.env \
  --target /opt/sfp/.env.production --apply --fix-permissions
```

  已有有效值不会被覆盖；只填充缺失或无效项，并写入 `<NAME>_PREVIOUS`。
- 生产数据库角色（无硬编码口令）：

```bash
psql -v ON_ERROR_STOP=1 -v app_password='...' -v migrator_password='...' \
  -v auditor_password='...' -v backup_password='...' \
  -v database='smart_floor_planner' \
  -f deployment/production/postgres-roles.sql
```

运行时 env 文件（`SFP_RUNTIME_ENV_FILE`，默认 `<deploy-root>/.env.production`）要求：

1. 不得被 Git 跟踪；
2. POSIX 权限 600（不得 group/world 可读）；
3. 若位于 `admin/` 构建上下文内，`.dockerignore` 必须包含 `.env*`；
4. `deploy.sh` 在触碰数据库前强制校验上述三项，任一不满足直接退出。

### 2.5 仍需人工审批

- 百炼北京 Workspace/Key 与 Embedding 服务（`ASSISTANT_BAILIAN_RAG_*`、`ASSISTANT_EMBEDDING_*`）。
- 生产数据库地址、账号与口令（`DATABASE_URL`、`DATABASE_MIGRATION_URL`、`POSTGRES_PASSWORD`）。
- 微信生产归属确认与真机验收（AppID、AppSecret、`https://smartfloor.zlyun168.com` 与 `release` 已配置）。
- 默认文本模型确认，以及 Worker 试点范围、启动窗口和外部通知授权。
- 初始管理员与 Smoke 口令轮换（当前两者同值，上线后移除初始管理员口令）。

## 3. 标准部署流程

1. 从发布提交干净检出，确认 `git status` 为空。
2. `cd admin && npm ci`；`npm run build`；确认 `.next/standalone` 生成。
3. 构建镜像：`docker build --build-arg SFP_RELEASE_VERSION=<版本> -t <镜像>:<版本> .`；用第 6 节命令抽查镜像内容。
4. 准备运行时 env 文件（不进入镜像；600、未跟踪、满足 2.4 要求）。可从 `deployment/production/runtime.env.template` 复制，再用 `apply-secret-plan` 注入自有密钥。`docker compose config` 会解析并输出 env_file 的值，必须重定向 stdout（例如 `>/dev/null`），不得打印到终端或日志。
5. 执行 `deploy.sh`：先运行生产环境门禁，再创建迁移前备份，迁移器无待执行项时不重复迁移。
6. 启动 `postgres`、`admin`、`lead-claim-worker`；等待健康检查与登录 smoke 通过。
7. 首次启用 AI 知识前完成第 5 节映射/上传/索引/引用冒烟。
8. `assistant-worker` 容器在维护窗口按第 4.2 节启动；业务启停由第 4.1 节的后台开关控制。

`deploy.sh` 不会启动 `assistant-worker`；该服务属于 compose `assistant` profile，默认不启动。

## 4. Worker 启停

### 4.1 后台启停（常规方式）

1. 以平台超级管理员登录后台：平台管理中心 → 小K Worker 启停（`/assistant-worker`）。
2. 填写试点企业 ID 与试点 ID，点击「加载企业与试点项目」，勾选试点项目范围并保存。
3. 打开「启用 Assistant Worker」并保存。保存会新增一条版本记录（含操作人与时间），Worker 在下一次心跳自动生效，无需重启容器。
4. 关闭开关后 Worker 常驻空转，健康检查显示 `idle`。
5. Worker 启用时，共享队列按任务所属企业处理已启用小K的业主主动咨询、重答及配置本地语音转写后的业主转写草稿。保存的企业和项目范围用于提醒、周报及原有试点后台任务。咨询领取、执行和结果保存沿用企业权限与租约校验。

权限与审计：仅 `super_admin` 可访问页面与 `/api/platform/assistant-worker`；每次保存都写入 `app.assistant_worker_settings` 新版本，历史版本保留。

### 4.2 容器启停（维护窗口）

启用过后台开关后，容器本身仍需按批准窗口运行：

- 启动：`docker compose --profile assistant up -d assistant-worker`
- 停止：`docker compose --profile assistant stop assistant-worker`

启动前建议确认 `GET /api/internal/assistant/jobs/preflight` 返回的 `deployment.source` 与 `safetyGate` 符合预期（`open` + `deliveryScope=pilot`，或明确 `worker_disabled`）。

### 4.3 状态检查

- 容器 healthcheck 通过；后台关闭时状态为 `idle`，其余关闭原因仍为 `blocked`。
- `/shared/assistant-worker-health.json` 含 PID、时间、`lastSuccessAt`、`safetyGate`。
- preflight 不可达、响应非法或缺少 `CRON_SECRET` 时进程以非零码退出；门禁关闭不会退出，也不会回退企业全量。

当前生产默认：尚未在后台保存开关，且 `.env.production` 未设置 `XIAOK_STAGE_REMINDER_*`/`XIAOK_WEEKLY_REPORT_*`，门禁关闭；外部通知 `subscriptionMessagesEnabled` 未开启（平台默认配置版本 2、8 个模板、无该键）。

## 5. 知识库运营

1. 在获批的北京 Workspace 创建企业索引与平台公共库；不得复用验收临时库。
2. 通过 `/assistant-knowledge` 完成文档上传、审核、索引、发布。
3. 核对 `assistant_managed_knowledge_libraries` 企业映射与 `assistant_platform_knowledge_library` 平台单条映射。
4. 服务端检索冒烟：企业证据优先、平台补充、跨企业/错阶段拒绝、引用可重开、撤权后 `source_unavailable`。
5. 引用必须来自当前接收人有权访问的真实来源；无有效引用时明确标记，不伪造。

## 6. 镜像验收命令

```bash
docker run --rm --entrypoint sh <image> -c '
  cd /app &&
  find . -name ".env*" -type f | wc -l &&
  find . -type f \( -name "*.pem" -o -name "*.key" \) | wc -l &&
  find . -type d -name uploads | wc -l &&
  ls -1 scripts'
```

预期：`.env*=0`、密钥文件 `=0`、uploads `=0`；`scripts/` 仅 8 个运行时脚本：
`assistant-worker.mjs`、`assistant-worker-health.mjs`、`assistant-worker-healthcheck.mjs`、`lead-claim-worker.mjs`、`lead-claim-worker-healthcheck.mjs`、`postgres-integration-migrations.mjs`、`postgres-migrate.mjs`、`production-env-check.mjs`。

## 7. 数据库备份

- 备份账号：`sfp_backup`（LOGIN、BYPASSRLS、非超级用户）。
- 停写核验：无其他客户端连接、无未结束事务、无应用监听、无 Worker、无活动租约。
- 命令（停写窗口内）：

```bash
XIAOK_MIGRATION_BACKUP_URL=... node scripts/xiaok-migration-backup.mjs \
  --mode development --output-dir <备份目录> --pg-bin <PG17 bin> --label <标签>
```

- 产出：`database.dump`、`database.dump.sha256`、`migration-backup-manifest.json`。
- 记录：字节数、归档 SHA-256、Manifest 摘要、`pg_restore --list` 条目数。
- 备份目录必须在本机受限 ACL 下：仅 SYSTEM、Administrators 和维护账号；禁止 Everyone/Authenticated Users。

## 8. 数据库恢复与回滚

等价恢复目标必须同时满足：
- Linux PostgreSQL 17.10（推荐 `pgvector/pgvector:0.8.2-pg17`，实测 `17.10 (Debian 17.10-1.pgdg12+1)`）；
- glibc 2.36（Debian 12）；
- `en_US.utf8`/`en_US.utf8`、libc provider、`datcollversion=2.36`；
- `vector 0.8.2` 与 `btree_gist 1.7`，扩展 owner 为 `sfp_migrator`；
- 角色 `sfp_restore`（LOGIN、CREATEDB、BYPASSRLS、非超级）和 `sfp_app`、`sfp_auditor`、`sfp_backup`、`sfp_migrator`；
- `postgres` 库带 `xiaok-i749-isolated-test` 标记，且不含源库。

恢复命令：

```bash
XIAOK_MIGRATION_RESTORE_URL=... PG_BIN=<PG17 bin> \
  node scripts/xiaok-migration-restore-verify.mjs \
  --manifest <manifest.json> --target-database xiaok_migration_restore_<时间> --mode isolated
```

验收必须全部为 `true`：`manifest_integrity`、`backup_sha256`、`restore_list`、`target_safety_verified`、`database_version_compatible`、`schema_restore_passed`、`data_restore_passed`、`ledger_verified`、`rls_verified`、`permissions_verified`、`full_restore_passed`。

不得使用 `C` 排序或 glibc 不匹配的实例冒充等价回滚目标；它只能做逻辑恢复演练。

## 9. 应用回滚

1. 记录当前镜像与上一可用镜像。
2. `deploy.sh rollback` 配合 `SFP_TARGET_IMAGE=<上一镜像>`；脚本不重复备份、不回滚数据库迁移。
3. 回滚后验证 `/api/health`、登录 smoke、项目/报告/知识只读、Worker 门禁关闭、无重复提醒/报告。
4. 数据库回滚只在应用回滚无法恢复时执行，并使用发布前获批的 129 账本备份，恢复到等价 Linux 目标并重新验证后再切换。

## 10. 监控与告警

- Admin：`/api/health`、登录 smoke。
- Worker：共享健康文件的新鲜度（fresh/stale/unknown）、`lastSuccessAt`、门禁状态、错误码。
- 任务：`assistant_jobs` 的 queued/running/failed/indeterminate 数量；`provider_started_at` 已设置但结果未知的任务标记 `indeterminate`，不得自动重放。
- 外部通知：`workflow_notification_logs` 与订阅消息开关；未批准时保持关闭。
- 备份：每次发布前备份成功、SHA 校验、恢复回执保留。

## 11. 故障处理

| 现象 | 处理 |
| --- | --- |
| 部署门禁失败 | 按输出补齐/替换密钥；不得绕过门禁直接 `next start` |
| Worker 显示 `idle` 或 `blocked` | 查看生效配置和门禁原因。`worker_disabled` 表示总开关已关闭；其他原因检查实际保存的试点配置 |
| preflight 401 | 检查 `CRON_SECRET` 是否一致 |
| preflight 503 | 检查数据库连通、租户事务、门禁查询；不得跳过 preflight 启动 |
| 知识检索 503 `bailian_knowledge_not_configured` | 补齐百炼 Workspace/Key 或显式切换到已批准的本地提供者 |
| 模型不可用 | 保持 Facts-only 降级；不得编造进度、天数或来源 |
| 备份目录被拒绝 | 修复 ACL，仅保留 SYSTEM/Administrators/维护账号 |
| 恢复校验失败 | 保留目标库和回执，按失败项排查；不得删除证据或跳过后重试 |

## 12. 禁止事项

- 不得在未批准时部署生产、启动生产 Worker、发送真实通知、读写企业 1454 生产业务数据。
- 不得把开发 WorkSpace、开发 Embedding 地址或合成测试账号当作生产配置。
- 不得把 `.env.local`、`.env.production`、测试脚本、验收脚本或临时凭据打入镜像。
- 不得用浏览器或 DevTools 截图冒充真机微信验收。
- 不得用 `C` 排序实例替代等价回滚验证。
