# 家客来 V1.0 最终交付评审与发布准备

2026-11-16（Asia/Shanghai）。分支 `codex/xiaok-integration`，评审基线 `c39b5830ec33f25ad4a63359479e1a748923c3a8`。本报告只做发布前评审、工程检查和发布/回滚准备，不合并 `main`、不部署生产、不启动生产 Worker、不发送真实通知、不再次执行数据库迁移、不修改真实企业 1454 的业务数据。

## 结论

**`ready_with_conditions`**。V1.0 代码可以通过 Admin 生产构建、TypeScript、Admin 定向运行验收和小程序 DevTools 编译；数据库结构、账本、RLS 和 0132 平台引用表通过只读核对；Worker 在隔离 PG17 的门禁、调度、幂等、重启和恢复已通过。发布前必须先完成以下条件，否则不得进入生产：

1. 替换 `.env.production` 中仍为占位值的 `INTERNAL_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`，并轮换 `INITIAL_ADMIN_PASSWORD`、`DEPLOY_SMOKE_PASSWORD`；本次已给 `deploy.sh` 增加占位值拒绝。
2. 对当前 129 条账本的正式开发库重新做一次全量备份，并在与生产等价的 Linux PG17.10、`en_US.utf8`、glibc 2.36、pgvector 0.8.2 目标上完成独立恢复；现有恢复回执只覆盖迁移前的 119 条账本，且 i798 的 `C` 排序不能作为等价回滚目标。
3. 生产 `.env.production` 补齐 Bailian Workspace/Key、Embedding 服务和知识提供者配置，完成企业知识库与平台公共知识映射、批准文档的上传/索引/发布；正式开发库当前映射、文档、分片、引用均为 0。
4. 产品确认默认文本模型。当前平台 `llm_config` 为 `qwen3.7-flash`，不是 DeepSeek Flash；DeepSeek 只在 I7.5.15 的隔离/实云验收中出现。
5. 生产 Worker 试点范围、`CRON_SECRET`、共享健康文件、外部通知权限和启动窗口由单独审批；未配置试点时 Worker 必须保持退出码 2。
6. 真机与真实微信授权、生产数据库、真实通知和生产 Worker 仍为 `not_run`；发布审批需明确接受 `limited` 或另行安排真机验收。

## 1. 基线与工作树

- 已执行 `git fetch origin`。本地、`origin/codex/xiaok-integration` 和远端 HEAD 均为 `c39b5830`。历史包含 I7.5.17（`f0ca2b91` + `5a312a30`）、I7.5.18（`25253665`）、I7.5.19（`a5e64cbf`）、I7.5.20（`d17d9d8d`）、I7.5.21（`1d1e8879` + `c39b5830`）。
- `git worktree list` 显示主工作区和 9 个既有工作树（parallel-support-*、百炼 Responses、I7.5.12 ACL、I7.5.18、Native Workflow、unified v96/v97、部署工作树）。主工作区起始 28 个已跟踪修改和 2 个未跟踪文件，全部保留，未回退、未纳入本轮提交。
- 本轮修改了 4 个发布基础设施文件：`admin/next.config.ts`、`admin/Dockerfile`、`admin/.dockerignore`、`admin/deploy.sh`；其余为本报告和任务记录。未修改四端页面、AI 业务逻辑、数据库迁移或 Worker 调度逻辑。
- 重要边界：Admin 构建和小程序编译使用**当前工作树**，其中包含其他 Agent 的未提交修改；发布镜像必须在提交后从干净检出重新构建。小程序 HEAD 归档的 496 个 JS 文件已单独做 `node --check`，0 语法错误。

## 2. 工程检查

| 检查 | 状态 | 实测 |
| --- | --- | --- |
| Admin 完整生产构建 | `passed` | `npx next build` 退出 0；Turbopack 编译 15.3s、完整 TypeScript 25.9s、117 个静态页面，`.next/standalone` 生成成功。为避免覆盖其他 Agent 未提交的 `source-manifest.json`，未执行会写入该文件的 `prebuild`；`npm run check:survey-runtime` 单独通过（83 个文件一致）。 |
| TypeScript 完整检查 | `passed` | 使用 `git show HEAD:admin/tsconfig.json` 的提交版配置副本执行 `npx tsc --noEmit --incremental false -p tsconfig.i7522.json`，退出 0；临时配置已删除，工作区原文件未改。 |
| Admin 全量 ESLint | `failed`（历史基线） | `npm run lint`：73 个问题，**8 个 error、65 个 warning**。8 个 error 全部是未修改的 `admin/deployment/portfolio-kodo/seed.cjs` 与 `signing.js` 中的 `@typescript-eslint/no-require-imports`；与 I7.5.16/I7.5.18 基线一致。未删除测试、未降低门槛。 |
| 微信小程序完整构建 | `passed`（DevTools） | Stable 3.17.2 重新编译成功，`pages/index/index` 数据键 31，逻辑视口 390×844；截图 `tmp/xiaok-i7522/mini-compile/mini-compile.png`。 |
| 小程序全部测试 | `failed`（历史基线） | `npm test`：2,259 项，2,258 通过、1 失败、0 跳过。唯一失败为 `survey-kernel-phase0-baseline.test.js` 的 Phase 0 审计，差异出现在既有测试 `surveying-editor-autosave.test.js` 的只读依赖清单，与本轮无关；与 I7.5.10/I7.5.21 基线一致。 |
| 依赖锁文件 | `passed` | `admin/package-lock.json` lockfileVersion 3、1,325 个 package、0 个 `file:`/`link:`/git 依赖；`npm ci --dry-run --ignore-scripts` 退出 0。小程序 lockfileVersion 3、仅根 package（无第三方依赖）。 |
| 环境变量文件 | `limited` | `.env.example`、`.env.local`、`.env.production` 均存在；`.env.local` 与 `.env.production` 被 `.gitignore` 忽略，未被 Git 跟踪。`.env.production` 仍含 9 个占位键（见第 7 节），不能直接部署。 |
| 生产构建包含开发测试配置 | `limited`（已修复主要项） | 修复前 `.next/standalone` 5.2 GB：含 `uploads` 4.87 GB、`keys/private_key.pem`、`.env.production`、2 个 `.test.mjs`、源码和 maps。修复后 11,454 个文件 / 308.1 MB：`uploads=0`、`keys=0`、测试脚本=0、acceptance/live/fixture 脚本=0；仍包含 `src` 1,321 个文件、1,405 个 source map 和本地 `.env.production`。Dockerfile 在 runner 阶段删除 `.env*`，`.dockerignore` 排除 `keys`、`.pem`、测试/验收脚本、`uploads`、`.env*`。 |
| 源码残留 Mock Provider/测试账号/临时密钥 | `limited` | 未发现硬编码 API Key、Bearer、私钥；未在 `admin/src` 发现 `i7521`/`i7519`/fixture 测试账号。Kujiale 的 `KUJIALE_USE_MOCK` 默认 false（`admin/src/lib/kujiale.ts:83`），未在 `.env.local`/`.env.production` 启用。仍存在生产可达的兜底密钥和弱初始密码，见第 7 节。 |

证据：`tmp/xiaok-i7522/admin-build-3.log`（SHA-256 `f3c319d2c67d9ef01f121b630c0c108ec13dadc384ca7b0f418ad687956c80fb`）、`admin-eslint-full.log`（`ce5f395e5a01b92b13aa5d97a085d1e7b5833be29defc11a2dd0122259ca1c5c`）、`miniprogram-test.log`（`3511c9fb7f93f5e2a5619578da6c389b433923c77490ca4d90dbaed29c1d5546`）、`mini-compile/mini-compile.json`（`cfdb89649a693e3bd73171898dc11912cca0e017d18ebad18591742503ef601e`）、`npm-ci-dry-run.log`、`survey-runtime-check.log`。

## 3. 四端产品验收

四端页面与业务逻辑本轮未改；验收复用 I7.5.21 的 Stable 390×844 回执（`tmp/xiaok-i7521/r14/native.json`），补充本报告对正式开发库/生产配置的核对。V3.2 UI 基线保持不变，未新增 Tabbar、页面或入口。

| 角色 | 项目 | 状态 | 依据与边界 |
| --- | --- | --- | --- |
| 业主 | 微信身份 | `not_run` | 无真实微信账号/授权；Stable 使用合成 JWT 与 bootstrap。 |
| 业主 | C01 对话 | `passed` | C01 重进读到 2 条消息、3 条阶段提醒，原会话可重开。 |
| 业主 | 百炼知识问答 | `limited` | I7.5.15 有实云检索/DeepSeek 回执；正式开发库无企业/平台知识映射，本轮未新增付费调用。 |
| 业主 | Facts-only | `passed` | 复用 I7.5.20 八种检索/文本故障组合，获权原文降级保存。 |
| 业主 | 阶段进度 | `passed` | 项目详情/阶段进度由正式服务返回；C01 与工地页一致。 |
| 业主 | 提醒 | `passed` | 3 条业主阶段提醒站内送达；经理 3 条为 `no_inbox`，工作台可读。 |
| 业主 | 周报 | `passed` | 周报 8 个栏目、原记录、重开与已读回执通过。 |
| 业主 | 引用 | `limited` | I7.5.20 签名 HTTP 引用、逐字摘录、撤权通过；原生引用弹层未执行，正式库 `assistant_message_citations=0`。 |
| 老板 | 项目简报 | `passed` | 简报读到试点项目、计划 V1、需介入 1 项。 |
| 老板 | 项目进度 | `passed` | 进度可用，未排期不推断逾期。 |
| 老板 | 异常问题 | `limited` | 有 1 条待核实事项；未构造逾期计划/已解决事项。 |
| 老板 | 需介入清单 | `passed` | 「需介入 · 1 项」与问题清单 1 条可进入。 |
| 老板 | 整改情况 | `limited` | I7.5.19 有整改/复核 HTTP 证据；本轮无整改中夹具，原生未重跑。 |
| 老板 | 周报 | `passed` | 9 个栏目、重开与已读回执通过。 |
| 设计师 | 项目资料 | `passed` | 项目详情、房间、计划、提醒可读。 |
| 设计师 | 房间点位入口 | `passed` | 「查看点位与图纸」进入 `mode=plan` 工地交流；独立点位工作区未新造。 |
| 设计师 | 设计交底 | `limited` | 阶段知识入口存在；本轮未单独重跑交底问答。 |
| 设计师 | 意见与差异 | `limited` | 周报含 `opinions`；本轮无设计差异事项，差异对照仍是事项/对话投影。 |
| 设计师 | 周报 | `passed` | 7 个栏目、重开与已读回执通过。 |
| 施工人员 | 当前任务 | `passed` | 以 `my_role=worker` 返回试点项目。 |
| 施工人员 | 施工记录 | `passed` | 项目详情读到 `I7521` 记录原文。 |
| 施工人员 | 照片与语音 | `not_run` | 真实相机/相册/语音权限未执行；上传状态机与测试保留。 |
| 施工人员 | 经理待办 | `passed` | 经理工作台 3 条待办，可定位到项目 1。 |
| 施工人员 | 整改反馈 | `limited` | I7.5.10/I7.5.19 有要求补拍/补交路径；本轮未做原生整改反馈。 |
| 施工人员 | 周报 | `passed` | 6 个栏目、重开与已读回执通过。 |

## 4. 数据库

只读连接 `127.0.0.1:5432/smart_floor_planner`，`sfp_app`，`BEGIN READ ONLY`；未执行迁移、未写入 1454。

| 检查 | 状态 | 实测 |
| --- | --- | --- |
| PostgreSQL 17.10 | `passed` | `PostgreSQL 17.10 (Debian 17.10-1.pgdg12+1)`，数据库 `smart_floor_planner`。 |
| 迁移账本 | `passed` | 129 条，末条 ID 135；120、124–135 均存在。 |
| 十条 V1 迁移 | `passed` | 0120 与 0124–0132 均已在账本；0132 平台引用表存在。 |
| 0132 平台公共知识引用 | `passed` | `assistant_platform_knowledge_library`、`assistant_message_citations` 存在；平台映射 0 行、引用 0 行；`sfp_app` 仅 SELECT，无 INSERT/UPDATE/DELETE。 |
| FORCE RLS | `passed` | 189 张 `app` 表，167 张 RLS 且 167 张 FORCE RLS，222 条策略。 |
| 企业复合外键 | `passed` | 171 个多列外键；样例含 `ai_provider_attempts`、`assistant_jobs`、`assistant_context_bindings` 的 `enterprise_id` 复合键。 |
| 数据权限 | `passed` | `sfp_app` 非超级、非 BYPASSRLS；`sfp_migrator` 非超级、非 BYPASSRLS；`sfp_backup` 非超级、BYPASSRLS（备份专用）。 |
| 企业 1454 | `passed`（只读） | 企业存在（微云/active），但 `construction_projects=0`、`conversations=0`、`stage_reminders=0`、`reports=0`；无 AI 设置、无报告设置、无 pilot scope。未写入。 |
| 备份归档 | `passed`（迁移前） | `C:\sfp-backups\i7512-20261116\xiaok-mig-20261116t064954589z-df1a3c3d\database.dump`，110,204,825 字节，SHA-256 `35bf54a585bd85a10395f6e23eddd733595a4b9afb80c9b71cd0956d243b0cfc`；Manifest 摘要 `f183a7cfcbb4441e1370e45b840e4b1903abeb9e3974c251f971d2a597f62cf5`。 |
| 独立恢复证据 | `passed`（迁移前） | 回执 `status=passed`、`full_restore_passed=true`：173 张数据表、99,302 行、119 条账本、153 张 FORCE RLS、208 条策略；目标为独立 i798 PG17.10，`C` 排序。 |
| 当前 129 账本的备份/恢复 | `not_run` | 现有归档和回执只覆盖迁移前 119 条账本；迁移后没有新的全量备份/独立恢复。发布前必须补做。 |
| 排序规则差异 | `passed`（记录） | 源库 `en_US.utf8`/`en_US.utf8`；i798 演练库 `C`。`a/A` 次序和 `lower('É')` 实测不同；i798 不能作为等价生产回滚目标。 |

只读回执：`tmp/xiaok-i7522/db-readonly.json`、`db-readonly-2.json`、`db-readonly-3.json`、`db-readonly-4.json`。

## 5. AI 服务

| 检查 | 状态 | 实测与边界 |
| --- | --- | --- |
| 百炼北京 Workspace | `limited` | `.env.local` 有 Workspace/Key（`ws-qq0…`）；`.env.production` 没有 `ASSISTANT_BAILIAN_RAG_*`。不得把开发 Workspace 当生产 Workspace。 |
| 百炼托管 RAG | `limited` | 代码、隔离验收、I7.5.15 实云回执存在；正式开发库企业映射 0、平台映射 0、文档/分片 0。 |
| DeepSeek Flash | `limited` | 支持 `deepseek-v4.1-flash-1017`/`deepseek-v4.1-flash`；I7.5.15 有两次实云调用。当前平台默认 `qwen3.7-flash`，`ASSISTANT_RESPONSES_API` 未启用。 |
| 企业知识库映射 | `not_run` | `assistant_managed_knowledge_libraries=0`。 |
| 平台公共知识映射 | `not_run` | `assistant_platform_knowledge_library=0`；0132 表/权限已就绪。 |
| 文档上传与索引 | `not_run` | 正式开发库 `assistant_knowledge_documents/versions/chunks` 均为 0；I7.5.15/I7.5.20 隔离回执通过。 |
| 来源引用 | `passed`（复用） | I7.5.15 实云引用与 I7.5.20 撤权重开通过；正式库引用 0 行。 |
| 本地 pgvector 备用 | `limited` | I7.5.20 本机 Qwen3 真实通过；生产 `.env.production` 无 Embedding URL/Key，`.env.local` 指向 `127.0.0.1:18089`，不能直接用于生产。 |
| Facts-only | `passed`（复用） | I7.5.20 文本未配置、超时、503 后保存获权原文。 |
| insufficient_evidence | `passed`（复用） | 无可靠依据时固定提示，不伪造来源。 |
| retrieval_unavailable | `passed`（复用） | 双引擎故障保留主/备故障，模型调用 0。 |
| 真实配置与测试配置分开 | `limited` | `.env.local` 是开发配置（localhost 搜索/Embedding、合成测试库），`.env.production` 缺 AI 配置；本轮未把任何合成配置写入生产。 |

## 6. Worker 发布准备

| 检查 | 状态 | 实测与边界 |
| --- | --- | --- |
| CRON_SECRET | `passed` | `.env.production` 存在 64 字符值；preflight/tick 均校验。 |
| preflight | `passed` | `1d1e8879` 修复 Next 代理拦截；I7.5.21 r14 真实 HTTP 401/200 路径通过。 |
| 试点企业范围 | `passed`（隔离） | 隔离库 `pilot/i7521-dev/企业1` 通过；生产 `.env.production` 无 `XIAOK_STAGE_REMINDER_*`/`XIAOK_WEEKLY_REPORT_*`，默认门禁关闭。 |
| 企业白名单 | `passed`（隔离） | 异租户 run 保持 `queued/attempts=0`；生产未配置白名单。 |
| 提醒调度 | `passed`（隔离） | 11 条提醒中 8 条站内送达、3 条经理 `no_inbox`；无重复。生产未启动。 |
| 周报调度 | `passed`（隔离） | 10 份事实日/周报，含设计师接管后补投两份；生产未启动。 |
| 知识索引/清理 | `limited` | 代码与 I7.5.18/I7.5.20 隔离场景通过；正式库无知识数据，生产未跑。 |
| 心跳 | `passed`（隔离） | 健康文件记录 PID/时间/错误码/门禁；生产默认健康文件在容器 `/tmp`，API 未共享，需设置共享卷 `ASSISTANT_WORKER_HEALTH_FILE`。 |
| 重启恢复 | `passed`（隔离） | PID 948→40328，新心跳、无重复。 |
| 幂等 | `passed`（隔离） | 同键同 run；重复 tick 高水位不变。 |
| 外部通知权限 | `not_run` | 通知配置 default version 2、8 个模板，`subscriptionMessagesEnabled` 未开启；未发送真实通知。 |

## 7. 安全与发布基础设施

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 生产构建泄漏 | `limited`（已修复主要项） | 修复前 standalone 含 4.87 GB `uploads`、`keys/private_key.pem`、`.env.production`、测试脚本；修复后上述均为 0；Docker runner 额外 `rm -f .env*`。残余 `src`/source maps 属源码暴露风险，建议后续排除或在内部镜像仓库限制访问。 |
| `.env.production` | `failed`（需人工处理） | 未跟踪；含 `INTERNAL_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` 占位值（虽长度达标），以及 `AMAP_KEY`、`DATABASE_MIGRATION_URL`、`GOOGLE_AI_API_KEY`、`KUJIALE_*`、`LONGCAT_API_KEY`、`POLLINATIONS_API_KEY` 占位值。`deploy.sh` 已新增占位值拒绝；替换前部署会失败，这是预期保护。 |
| JWT 兜底 | `failed`（需审批/加固） | `admin/src/lib/auth.ts:31`、`miniprogram-jwt.ts:3`、`session.ts:38` 等多处使用 `JWT_SECRET || 'fallback_secret_random_123'`；`deploy.sh` 已强制 JWT_SECRET 长度，但直接 `next start` 仍可绕过。生产必须确保 JWT_SECRET 注入，建议后续改为生产环境缺失即失败。 |
| 弱初始密码 | `failed`（需产品决策） | `admin/src/lib/enterprise-admin-provision.ts:7` 为 `'123456'`；员工创建/重置也提示 123456，并要求下次改密。V1.0 发布前应评估改为一次性随机密码。 |
| 加密密钥兜底 | `failed`（需加固） | `admin/src/lib/crypto.ts:3` 的 `DEFAULT_SECRET='smart-floor-planner-pollinations-secret'`，且可回退 JWT_SECRET；建议生产显式设置 `AI_PROVIDER_KEY_ENCRYPTION_SECRET`，不与 JWT 共用。 |
| Docker Compose 数据库口令 | `failed`（需审批/加固） | `admin/docker-compose.yml:20,34,90` 硬编码 `sfp_app_local_only`/`sfp_migrator_local_only`/`sfp_owner_local_only`；生产必须改用 secrets 或受控 `DATABASE_URL`，不能用本地默认值。 |
| 生产构建环境 | `limited` | 本地构建加载了 `.env.local` 和 `.env.production`；Docker 构建上下文排除 `.env*`。发布构建应在干净环境使用显式生产环境变量，避免开发者配置进入构建。 |
| 小程序私有配置 | `limited` | `miniprogram/project.private.config.json` 被跟踪且含本地项目名/热重载；上传包不应包含本地私有配置，发布前确认开发者工具忽略。 |

本轮安全修复：`next.config.ts` 扩展 `outputFileTracingExcludes`（uploads/keys/env/logs/tsbuildinfo/docs/docker/release/测试脚本），`Dockerfile` runner 删除 `.env*`，`.dockerignore` 排除 keys/pem/测试/验收/live/fixture 脚本，`deploy.sh` 拒绝占位密钥。`bash -n admin/deploy.sh` 退出 0；占位值逻辑用样例验证只拒绝 `INTERNAL_SECRET`/`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` 两个占位值。

## 8. 发布与回滚手册

### 8.1 V1.0 环境变量清单

必需（生产必须显式设置，禁止占位值）：
`DATABASE_URL`、`DATABASE_MIGRATION_URL`、`JWT_SECRET`（≥32）、`INTERNAL_SECRET`（≥32）、`CRON_SECRET`（≥32）、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET`（≥32）、`AUTH_COOKIE_SECURE=true`、`ALLOW_TENANT_ENTERPRISE_RESET=false`、`WX_APPID`、`WX_APPSECRET`、`WECHAT_MINIPROGRAM_CODE_ENV=release`、`MINIPROGRAM_API_PUBLIC_ORIGIN=https://…`、`DEPLOY_SMOKE_USERNAME`、`DEPLOY_SMOKE_PASSWORD`（≥12）。

AI 知识（启用前必需）：
`ASSISTANT_KNOWLEDGE_PROVIDER=BAILIAN_RAG`、`ASSISTANT_BAILIAN_RAG_WORKSPACE_ID`、`ASSISTANT_BAILIAN_RAG_API_KEY`、`ASSISTANT_BAILIAN_RAG_CATEGORY_ID`、`ASSISTANT_BAILIAN_RAG_EMBEDDING_MODEL=text-embedding-v4`；本地备用需 `ASSISTANT_EMBEDDING_URL`、`ASSISTANT_EMBEDDING_API_KEY`、兼容的 pgvector 索引 profile。文本模型在平台 `llm_config` 或 `ASSISTANT_TEXT_MODEL` 指定；选 DeepSeek 时先验证再设 `ASSISTANT_RESPONSES_API=1`。

Worker（启用前必需）：
`ASSISTANT_WORKER_ENDPOINT=http://admin:3005/api/internal/assistant/jobs/run`、`CRON_SECRET`、共享 `ASSISTANT_WORKER_HEALTH_FILE`；试点门禁必须成对一致：
`XIAOK_STAGE_REMINDER_MODE=pilot`、`XIAOK_STAGE_REMINDER_ENTERPRISE_ID`、`XIAOK_STAGE_REMINDER_PILOT_ID`、`XIAOK_WEEKLY_REPORT_MODE=pilot`、`XIAOK_WEEKLY_REPORT_ENTERPRISE_ID`、`XIAOK_WEEKLY_REPORT_PILOT_ID`。任一缺失/不一致时 Worker 必须退出码 2。

可选：地图 `AMAP_KEY`、作品集第三方 `KUJIALE_*`、图片/多模态 `POLLINATIONS_API_KEY`/`GOOGLE_AI_API_KEY`/`LONGCAT_API_KEY`、相机 `CAMERA_*`、公开直播 `PUBLIC_LIVE_*`、ASR `ASSISTANT_ASR_*`；未配置时对应能力应保持不可用，不得用占位值。

### 8.2 数据库备份与恢复手册

发布前（当前 129 账本）：
1. 停写窗口内确认应用/Worker/活动租约均为 0；用 `sfp_backup`（BYPASSRLS，非超级）执行 `pg_dump -U sfp_backup -d smart_floor_planner --format=custom --no-owner --no-privileges`。
2. 校验 `pg_restore --list`、字节数、SHA-256 和 Manifest；归档目录 ACL 仅授权维护账号。
3. 在与生产等价的 Linux PG17.10、`en_US.utf8`、glibc 2.36、pgvector 0.8.2 的独立目标恢复；验证 129 条账本/末条 135、173 张数据表及行数、167 张 FORCE RLS、222 条策略、复合外键和权限摘要。
4. 不得只用 i798 的 `C` 排序库作等价回滚结论；它只能作为逻辑恢复演练。

现有证据：迁移前归档 SHA-256 `35bf54a5…`、Manifest `f183a7cf…`、恢复回执 `full_restore_passed=true`（119 账本、173 表、99,302 行）。当前 129 账本的备份/恢复为 `not_run`。

### 8.3 百炼服务配置手册

1. 在获批的北京 Workspace 创建/确认企业索引与平台公共库；生产不得复用验收临时库或 `xiaok-i7515-acceptance` 名称。
2. 通过 `/assistant-knowledge` 走正式文档上传、审核、索引、发布；确认 `assistant_managed_knowledge_libraries` 的企业映射和 `assistant_platform_knowledge_library` 的单条平台映射。
3. 运行服务端检索冒烟：企业证据优先、平台补充、跨企业/错阶段拒绝；引用可重开；撤权/退役后旧引用 `source_unavailable`。
4. 配置本地备用 Embedding（Qwen3-Embedding-0.6B，1024 维，固定 revision/文件哈希）和 pgvector 索引 profile；不得把 127.0.0.1 开发地址直接用于生产，除非同容器 sidecar 并已验证。
5. 文本模型：默认 `qwen3.7-flash`；如切 DeepSeek Flash，先验证模型可用性、Responses API、工具/引用行为和费用额度，再改平台配置；保留 Facts-only、`insufficient_evidence`、`retrieval_unavailable` 回归。

### 8.4 Worker 启停手册

启动前：
1. 确认 `CRON_SECRET`、preflight 路由、试点范围、共享健康文件；执行 `GET /api/internal/assistant/jobs/preflight`，门禁必须 `open`，范围必须 `pilot`。
2. 单独审批启动窗口；确认无生产批量提醒/周报/外部通知授权时不得启动。

启动/停止：
`docker compose --profile assistant up -d assistant-worker`；`docker compose --profile migration` 只用于迁移，不用于 Worker；停止用 `docker compose --profile assistant stop assistant-worker`。启动后检查 healthcheck、PID、`lastSuccessAt`、`safetyGate`；门禁关闭或 preflight 不可达必须以非零码退出，不得回退企业全量。

### 8.5 部署步骤

1. 从发布提交干净检出，`npm ci`，使用显式生产环境变量构建 Admin；生成 release zip/镜像并校验 `SHA256SUMS`、`DRIZZLE_SHA256SUMS`。
2. 运行 `deploy.sh` 的校验：镜像版本、Compose、迁移文件、JWT/INTERNAL/CRON/MEDIA 密钥、`AUTH_COOKIE_SECURE=true`、`ALLOW_TENANT_ENTERPRISE_RESET=false`、smoke 账号。
3. `deploy.sh` 自动创建 pre-migration 备份（当前生产若已是 129 账本，迁移器应无待执行项；不得重复执行迁移）。
4. 启动 postgres、migrate（首次/待迁移时）、admin、lead-claim-worker；健康检查/登录 smoke 通过后，再按审批启动 assistant-worker。
5. 生产首次 AI 知识启用前完成映射/上传/索引/引用冒烟；未完成时保持知识能力 `limited`/关闭。

### 8.6 回滚步骤

1. 应用回滚：`deploy.sh rollback` 配合 `SFP_TARGET_IMAGE=<上一镜像>`；脚本不重复备份、不回滚数据库迁移，回滚后验证 health/登录 smoke。
2. 数据库回滚：只能使用发布前获批的 **129 账本** 全量备份，恢复到与生产等价的新 Linux PG17.10/`en_US.utf8` 目标；验证账本、数据、RLS、权限和文本行为后再切换。不得使用 i798 `C` 库直接替换生产。
3. 回滚后检查：`/api/health`、登录、项目/报告/知识只读、Worker 门禁关闭、无重复提醒/报告；保留原备份和回执。

## 9. 已知问题与审批清单

### 9.1 已知问题

| 状态 | 问题 | 影响/处理 |
| --- | --- | --- |
| `failed`（基线） | Admin 全量 ESLint 8 error/65 warning | 全在 `deployment/portfolio-kodo/{seed.cjs,signing.js}` 的 `require()`；本轮未修、未降门槛。发布需批准基线豁免或另开清理。 |
| `failed`（基线） | 小程序 `survey-kernel-phase0-baseline` 1 项 | 既有测试只读依赖清单差异；与本轮四端/发布无关。发布需记录基线或修复审计。 |
| `failed`（基线） | `pilot-worker-alignment` W/W2 | 旧源码字符串断言与当前带 `taskScope`/门禁的源码不一致；I7.5.19 已在固定源码复现。 |
| `limited` | 正式库无知识映射/文档/分片/引用 | 生产知识问答在配置前只能 Facts-only/不足依据；需运营上传/索引/发布。 |
| `limited` | 生产 `.env.production` 缺 AI/Embedding 配置 | 不能直接启用百炼/本地备用；需批准的生产配置。 |
| `limited` | 当前 129 账本无迁移后备份/独立恢复 | 发布前必须补做；现有回执为 119 账本且 i798 C 排序。 |
| `limited` | 本地 standalone 仍含 `.env.production`/src/maps | Docker runner 已删除 env；不得直接部署本地 standalone。 |
| `limited` | 真机/真实微信/真实通知未验 | 需设备、账号与授权，或书面接受 limited。 |

### 9.2 生产发布审批清单

- [ ] 产品确认 V1.0 范围、默认文本模型（Qwen3.7 / DeepSeek Flash）与知识能力上线策略。
- [ ] 运维确认生产 PostgreSQL 目标（Linux PG17.10、`en_US.utf8`、glibc 2.36、pgvector 0.8.2）和 129 账本备份/恢复窗口。
- [ ] 安全确认 `.env.production` 占位密钥全部替换、`INITIAL_ADMIN_PASSWORD`/`DEPLOY_SMOKE_PASSWORD` 轮换、`AI_PROVIDER_KEY_ENCRYPTION_SECRET` 独立设置、Docker Compose 不再使用本地数据库口令。
- [ ] 知识运营确认百炼生产 Workspace/Key、企业/平台映射、批准文档上传/索引/发布、费用额度。
- [ ] Worker 负责人确认试点企业/项目、`CRON_SECRET`、共享健康文件、启动窗口、外部通知权限（默认关闭）。
- [ ] 小程序负责人确认 AppID、业务域名、HTTPS origin、`WECHAT_MINIPROGRAM_CODE_ENV=release`、真机验收或 limited 豁免。
- [ ] 发布负责人确认干净检出构建、`deploy.sh` 校验、备份/恢复回执、镜像 SHA、部署/回滚演练。
- [ ] 合规确认不将 `.env.local`、测试账号、合成企业、验收脚本、临时密钥打入生产。

## 10. 本轮改动与验证

- `admin/next.config.ts`：扩展 `outputFileTracingExcludes`，排除 uploads/keys/env/logs/tsbuildinfo/docs/docker/release/test/acceptance/live/fixture；保留 deployment/drizzle/scripts 运行时依赖。
- `admin/Dockerfile`：runner 阶段删除 `.env*`，运行时配置只来自 compose env_file/挂载 secret。
- `admin/.dockerignore`：排除 keys、`*.pem`、测试/验收/live/fixture 脚本、docker-compose/Dockerfile/tmp-*。
- `admin/deploy.sh`：必需密钥增加占位值拒绝；`bash -n` 通过；样例验证占位值被拒绝。
- 构建/检查：`npx next build` 退出 0（117 页、TS 25.9s）；提交版 tsconfig 下 `tsc` 退出 0；`next.config.ts` 定向 ESLint 退出 0；Admin 全量 ESLint 8 error/65 warning 基线；小程序 `npm test` 2,258/2,259；DevTools 编译通过；`npm ci --dry-run` 退出 0；`check:survey-runtime` 83 文件一致；HEAD 小程序 496 个 JS 语法检查 0 失败。
- 数据库：只读 129 账本/135/167 FORCE RLS/222 策略/171 复合外键/0132 表/1454 零业务行；未执行迁移或写入。
- 未执行：生产 Worker、真实通知、真机/真实微信、生产部署、合并 `main`、当前 129 账本的新备份/恢复、实云新调用。

## 11. 最终状态

| 类别 | 状态 | 摘要 |
| --- | --- | --- |
| engineering | `limited` | 构建/TS/DevTools 通过；全量 ESLint 8 error、1 个小程序基线测试失败。 |
| database | `limited` | 结构/账本/RLS/0132/权限通过；129 账本迁移后备份/恢复 not_run，排序差异未消除。 |
| ai_services | `limited` | 代码和历史实云回执通过；正式库无映射/知识数据，生产 AI 配置缺失，默认非 DeepSeek。 |
| mini_program | `limited` | DevTools 编译和四端页面通过；真机/微信授权/相机语音 not_run，1 个基线测试失败。 |
| worker | `passed`（隔离） | 门禁、CRON、试点、调度、租约、幂等、重启、心跳、恢复通过；生产未启动。 |
| security | `limited` | 主要构建泄漏已修复；占位密钥、JWT 兜底、弱初始密码、Compose 本地口令需处理。 |
| operations | `limited` | 发布/备份/Worker 手册已整理；需生产授权、监控共享卷和审批执行。 |
| rollback | `limited` | 应用镜像回滚有脚本；数据库 129 账本等价回滚未演练，i798 C 不可直接替代。 |

**发布建议：** 先完成第 1 节 1–5 项条件并在干净检出上重建/复验，再批准 V1.0 生产发布。未完成前保持 `ready_with_conditions`，不得把本报告当作生产部署或真机验收通过。
