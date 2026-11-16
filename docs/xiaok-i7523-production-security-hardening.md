# 家客来 I7.5.23 V1.0 生产安全加固与发布阻塞清理

2026-11-16（Asia/Shanghai）。分支 `codex/xiaok-integration`，基线 `3e95131ed82c4bd19123eedad4635d0cc781b582`。本轮只修复 I7.5.22 发现的生产安全阻塞，不新增业务功能，不修改企业 1454 业务数据，不执行数据库迁移，不部署生产，不启动生产 Worker，不发送真实通知，不合并 `main`。

## 结论

**代码级安全阻塞已关闭，生产配置仍待审批值。** JWT、AI 凭据加密、管理员一次性密码、Docker 数据库凭据、统一生产环境门禁和 Worker 共享健康文件均已落地并通过定向测试；干净检出生产构建通过，standalone 产物不含 `.env`、密钥、上传或测试脚本。当前 `.env.production` 仍是占位/开发配置，统一门禁会拒绝部署，这是预期的失败关闭行为。

## 1. 基线与工作树

- 已执行 `git fetch origin`。本地和远端 `codex/xiaok-integration` 均从 `3e95131e` 开始；本轮提交为 `deb21590`、`8f78f941`、`4aeecb0b`、`742ded56`（提交前 HEAD 为 `3e95131e`）。
- `git worktree list` 仍为主工作区加 9 个既有工作树。主工作区其他 Agent 的 28 个已跟踪修改和 2 个未跟踪文件全部保留，未纳入本轮提交。
- 未修改 `admin/src/lib/survey-runtime/source-manifest.json`、`admin/tsconfig.json`、四端页面、业务 Agent、数据库迁移或 Worker 调度逻辑。

## 2. JWT 安全

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| 生产缺失 JWT_SECRET | `passed` | 新增 `admin/src/lib/jwt-secret.ts`：生产环境缺失时抛出 `JwtSecretUnavailableError`；中间件返回 503，验证路径失败关闭，签发路径拒绝。 |
| 删除生产默认密钥 | `passed` | 生产可达的 `fallback_secret_random_123` 已全部收敛到一个开发专用常量；生产使用该值、短于 32 字符或含占位词时拒绝。 |
| 本地测试配置 | `passed` | `NODE_ENV=development/test` 保留本地回退；生产代码路径不再各自复制默认密钥。 |
| 签名/验证/刷新/撤销路径 | `passed` | 已核对并改造 `auth.ts`、`session.ts`、`admin-session.ts`、`miniprogram-jwt.ts`、`proxy.ts`、`auth/login`、`auth/me`、`miniprogram-profile.ts`、`mini-ai-assets.ts`、`referrer-network-api.ts`；未发现独立的刷新端点，撤销仍由现有会话/状态检查负责。 |
| 现有登录合同 | `passed` | 24 项认证回归通过；JWT audience、Cookie 属性、`mustChangePassword` 强制改密和 construction 边界未变。 |

## 3. 数据加密

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| 生产必须显式提供 AI 密钥 | `passed` | `admin/src/lib/crypto.ts` 生产环境缺少 `AI_PROVIDER_KEY_ENCRYPTION_SECRET` 时 `encryptText` 抛 `CredentialEncryptionError`，`isCredentialEncryptionReady()` 返回 false。 |
| 禁止固定 DEFAULT_SECRET | `passed` | 生产不得使用 `smart-floor-planner-pollinations-secret` 作为新密钥；测试覆盖生产无法解密旧 DEFAULT 密文。 |
| 不与 JWT_SECRET 共用 | `passed` | 生产要求 AI 密钥独立于 JWT_SECRET；相等、过短或占位均拒绝。 |
| 旧密文兼容读取 | `passed` | 生产仍可按顺序用 `POLLINATIONS_KEY_ENCRYPTION_SECRET`、`JWT_SECRET` 读取旧密文；历史 LLM 凭据（当前用 JWT 加密）可继续读取。旧固定默认值仅开发可读。 |
| 安全轮换 | `limited` | 代码支持新密钥加密、旧 JWT 密文读取。轮换操作仍需运维在生产后台重新保存 LLM/Provider/地图/短信凭据，或按批准的脚本逐项重加密；本轮未连接真实配置执行写入。 |
| 错误信息 | `passed` | 解密失败只返回“凭据解密失败”，不包含密文、密钥或内部字段；测试断言错误文本不含新旧密钥。 |
| 调用面一致性 | `passed` | `platform-llm-config.ts`、`map-services/config.ts` 的加密就绪判断改用统一函数；LLM 设置页提示改为独立 AI 密钥。 |

## 4. 管理员密码

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| 清除固定 123456 | `passed` | `enterprise-admin-provision.ts` 删除 `ENTERPRISE_ADMIN_INITIAL_PASSWORD`/`STAFF_INITIAL_PASSWORD`，改为 `randomBytes(18)` 生成 24 字符一次性密码。 |
| 初始化一次性随机凭据 | `passed` | 企业创建、企业激活、员工创建、员工重置、小程序员工入驻均调用 `createInitialPasswordCredential()`。 |
| 首次登录强制改密 | `passed` | 新账号继续 `mustChangePassword: true`；现有登录/中间件强制改密合同未改。 |
| 明文不落库/日志/Git | `passed` | 数据库只保存 bcrypt 哈希；API 只在本次响应返回 `initialPassword`/`tempPassword`；UI 用一次性 Modal 显示，不写通知日志或 Git。 |
| 安全交付流程 | `passed` | 员工创建/重置在后台弹出一次性密码，提示仅显示一次、需安全转交；企业激活 API 返回 `tempPassword`，企业状态变更返回 `initialAdminPassword` 供调用方交付。 |
| 已有账号兼容 | `passed` | 历史迁移 `0044` 的旧 123456 哈希保留，测试验证旧账号仍可登录并强制改密；新代码不再生成该密码。 |

## 5. Docker Compose 数据库凭据

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| 移除生产可误用硬编码 | `passed` | `DATABASE_URL`、`DATABASE_MIGRATION_URL`、`POSTGRES_PASSWORD` 改为 `${VAR:-dev-default}`；注释明确 dev fallback，生产由 runtime env 覆盖。 |
| 受控连接 | `passed` | 统一生产门禁拒绝 `_local_only` 数据库口令；`deploy.sh` 在触碰 PostgreSQL 前运行门禁。 |
| 开发/测试/生产区分 | `passed` | 开发仍可用 Docker Compose 本地默认值；生产缺值或仍用本地默认值时部署失败；测试覆盖两种取值。 |
| 不破坏开发环境 | `passed` | `docker compose config` 退出 0，原有服务名、端口、profile 和依赖关系不变。 |
| 构建产物无 env/密钥 | `passed`（standalone） | 干净构建 standalone 11,458 文件/308 MB，`.env*=0`、`*.pem=0`、测试脚本=0、`uploads=0`；`postbuild` 与 Dockerfile runner 均删除 `.env*`。 |
| 实际 Docker 镜像 | `not_run` | 本机 Docker daemon 未运行；已静态核对 `.dockerignore`/Dockerfile 并用 clean standalone 和 `docker compose config` 验证。 |

## 6. 生产环境变量门禁

新增 `admin/scripts/production-env-check.mjs` 和 `npm run check:production-env`，`deploy.sh` 在数据库操作前执行：

- 必填并校验长度/占位/默认值：`JWT_SECRET`、`INTERNAL_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`、`AI_PROVIDER_KEY_ENCRYPTION_SECRET`、`CRON_SECRET`、`DEPLOY_SMOKE_PASSWORD`。
- `AI_PROVIDER_KEY_ENCRYPTION_SECRET` 必须独立于 `JWT_SECRET`。
- `DATABASE_URL`、`DATABASE_MIGRATION_URL` 不得使用本地 Compose 口令。
- `AUTH_COOKIE_SECURE=true`、`ALLOW_TENANT_ENTERPRISE_RESET!=true`。
- `ASSISTANT_BAILIAN_RAG_WORKSPACE_ID/API_KEY`、`ASSISTANT_EMBEDDING_URL/API_KEY` 必填；Embedding URL 必须是 HTTP(S)，回环地址需显式 `SFP_ALLOW_LOOPBACK_EMBEDDING=true`。
- `ASSISTANT_WORKER_HEALTH_FILE` 必须是绝对路径；`DEPLOY_SMOKE_USERNAME` 必填。

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| 门禁逻辑 | `passed` | 7 项脚本测试通过：完整配置通过；缺失、占位、默认、共享、弱密钥、本地数据库口令、回环 Embedding、相对健康路径、不安全开关均被拒绝。 |
| 当前 `.env.production` | `failed`（预期） | 门禁退出 1，报告 10 项：`INTERNAL_SECRET`/`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` 占位；缺 `AI_PROVIDER_KEY_ENCRYPTION_SECRET`；数据库 URL 使用本地口令/占位；缺 Bailian/Embedding；健康路径非绝对。证明门禁能阻止当前配置部署。 |
| 生产批准值 | `not_run` | 未生成或写入真实生产密钥/Bailian/Embedding 值；需运维审批后填入 runtime env，再重跑门禁。 |

## 7. Worker 共享健康文件

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| 同卷配置 | `passed` | `docker-compose.yml` 的 `admin` 与 `assistant-worker` 都设置 `ASSISTANT_WORKER_HEALTH_FILE=/shared/assistant-worker-health.json`，并挂载同一个 `assistant_health:/shared` 卷；`docker compose --profile assistant config` 已核对两处。 |
| API 可读心跳 | `passed` | 新增 operations 测试写入共享健康文件，`readWorkerHeartbeat` 返回 `fresh`/`stale`，文件缺失返回 `unknown`，不泄露路径或密钥。 |
| 健康/重启/故障恢复 | `passed`（复用+测试） | Worker 19 项诊断/健康/安全测试全通过；I7.5.21 r14 已验证 PID 重启、API 不可达后同进程恢复、无重复回执。 |
| 生产试点默认关闭 | `passed` | `.env.production` 未设置 `XIAOK_STAGE_REMINDER_*`/`XIAOK_WEEKLY_REPORT_*`；门禁关闭时 Worker 退出码 2。 |
| 生产 Worker | `not_run` | 未启动生产 Worker，未发送外部通知。 |

## 8. 测试与构建

| 检查 | 状态 | 实测 |
| --- | --- | --- |
| JWT 单元 | `passed` | 4/4：缺失、默认、短/占位、开发回退、Mini Program 签名失败关闭。 |
| 凭据加密单元 | `passed` | 5/5：缺密钥、共享/短/默认拒绝、新密文往返、旧 JWT 可读、旧 DEFAULT 生产不可读、错误不泄露密钥。 |
| 管理员/员工密码 | `passed` | 7/7：随机一次性密码、bcrypt 校验、旧迁移兼容、重置返回 tempPassword、API 合同。 |
| 认证回归 | `passed` | 24/24：Admin/Mini Program JWT、audience、中间件、密码登录失败不泄露。 |
| Worker 诊断/健康/安全 | `passed` | 19/19：preflight 门禁、错误分类、恢复、健康文件、无 CRON_SECRET、共享文件 API 读取。 |
| 生产环境门禁 | `passed` | 7/7 脚本测试。 |
| Drizzle/迁移/环境检查 | `passed` | `npm run test:xiaok-env-check` 20/20。 |
| 地图加密集成测试 | `not_run` | `map-services.test.ts` 需要 `DATABASE_URL` 并连接数据库；为避免写开发库未执行，凭据加密单测覆盖核心逻辑。 |
| TypeScript | `passed` | 提交版 tsconfig 副本执行 `tsc --noEmit --incremental false`，退出 0；临时配置已删除。 |
| 修改文件 ESLint | `passed` | 新增/修改的 TS、TSX、MJS 定向 `--max-warnings 0` 退出 0。 |
| 全量 Admin ESLint | `failed`（既有基线） | 8 个 error、65 个 warning 仍在未修改的 `deployment/portfolio-kodo/{seed.cjs,signing.js}`；未删除测试、未降门槛。 |
| 主工作区生产构建 | `passed` | `npx next build` 退出 0，117 页。 |
| 干净检出重建 | `passed` | `git archive HEAD admin` + 独立 `node_modules`，在临时目录 `npx next build` 退出 0；Turbopack 21.3s、TypeScript 58s、117 页。 |
| 干净产物安全 | `passed` | 11,458 文件/308 MB；`.env*=0`、`*.pem=0`、测试脚本=0、`uploads=0`、acceptance/live/fixture=0。 |
| Docker 镜像构建 | `not_run` | Docker daemon 不可用；Dockerfile/.dockerignore/compose 静态检查和 clean standalone 已通过。 |

## 9. 证据

- `tmp/xiaok-i7523-build.log` SHA-256 `c27574e298f25d4000cca88286e3adcd63a11e7db1d7ff0729b3144358bd99ca`
- `tmp/xiaok-i7523-clean-build3.log` SHA-256 `019e302e5d150f9db09c5b03765a3473f52df9afe1589f6c679987d7932172b3`
- `tmp/xiaok-i7523-clean2-release-security.log`、`tmp/xiaok-i7523-script-tests.log` SHA-256 `20db7c1c4b95b167da1f4bf275e548380b3ec62ef14e3dc12282a55401d621a5`
- `tmp/xiaok-i7523-tests.log` SHA-256 `393a8d20fa47d5e7838558f005c50e0a771f3f84560a7f208bac589b2561ed84`
- `tmp/xiaok-i7523-worker-tests2.log` SHA-256 `d3e68d7e4356303ea8edb4134fbcf5dc959163775b0849932cbbf5c4738ed989`
- `tmp/xiaok-i7523-auth-tests.log` SHA-256 `0de4b22df02dd3e007fdf4d6ecd458b6141543b36e656eea644e19ada453b6fe`
- `tmp/xiaok-i7523-envcheck-test.log` SHA-256 `aca585b4782eec36ad6491fa1aedd19d16eb307f3dceaad54c53606e792b722c`
- `tmp/xiaok-i7523-prod-env-check.log` SHA-256 `e60f94aba44e27b2313931c87b94fd7b74b4b326ffcbf80af5f07b850cb233ef`
- `tmp/xiaok-i7523-jwt-tests2.log`、`tmp/xiaok-i7523-crypto-tests.log` 保留最终单测回执。

## 10. 发布前仍需审批/执行

| 状态 | 项目 | 说明 |
| --- | --- | --- |
| `failed`（预期） | 当前 `.env.production` | 占位/开发值被门禁拒绝；必须替换 `INTERNAL_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`、补 `AI_PROVIDER_KEY_ENCRYPTION_SECRET`，并将数据库 URL/口令改为受控值。 |
| `not_run` | 生产 AI 配置 | `.env.production` 缺 Bailian Workspace/Key、Embedding URL/Key；正式库仍无知识映射/文档/分片。需批准后配置、上传/索引/发布并做引用冒烟。 |
| `not_run` | 凭据轮换 | 设置新 AI 密钥后，需在生产后台重新保存 LLM/Provider/地图/短信凭据，使新密文使用专用密钥；旧 JWT 密文可读但不应长期保留。 |
| `not_run` | Docker 镜像 | 需在可用 Docker daemon 上构建并抽查 `/app` 无 `.env`/keys/uploads/tests/fixture；本机仅完成 clean standalone 与静态配置验证。 |
| `not_run` | 生产 Worker/通知/1454/迁移/部署 | 未启动生产 Worker、未发送真实通知、未读写 1454、未执行迁移、未部署、未合并 `main`。 |
| `limited` | 全量 Admin ESLint | 8 个既有 error 位于未修改的 portfolio-kodo 脚本；需批准基线豁免或另开清理。 |

## 11. 结论

JWT 缺失/默认密钥、AI 凭据加密缺专用密钥、固定 123456、Docker 本地数据库口令误用、Worker 健康文件不共享、生产环境变量无统一门禁等代码级阻塞已修复并有定向测试与干净构建证据。**生产发布仍保持 `ready_with_conditions`**：必须先填入经审批的生产密钥、Bailian/Embedding 配置和共享健康路径，重跑 `check:production-env`，并在可用 Docker 环境构建/抽查镜像；在此之前不得部署。
