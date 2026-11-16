# 家客来 V1.0 最终交付报告（I7.5.24）

2026-11-16（Asia/Shanghai）。分支 `codex/xiaok-integration`。本报告覆盖 V1.0 发布候选的最终工程、数据库、AI 服务、四端、Worker、Docker、运维与回滚状态，并给出唯一发布结论。

## 结论

**`READY_WITH_CONDITIONS`**

代码级发布阻塞已全部关闭：干净检出 Admin 生产构建、TypeScript、小程序生产编译、Docker 镜像构建与内容审计、129 账本迁移后备份、等价 Linux PG17.10 独立恢复、Worker 隔离验收均通过。仍不能直接上线的原因只有生产配置、真实凭据、真机与独立审批，全部集中在本报告第 10 节的一张审批表，不再拆分任务。

## 1. 基线与工作树

- 已执行 `git fetch origin`。本地 HEAD、`origin/codex/xiaok-integration` 均为 `f1c9ec5c47ce43ba35521af31f987459ec8def0b`。
- 最近提交：`f1c9ec5c`（I7.5.23 验收文档）、`742ded56`、`4aeecb0b`、`8f78f941`、`deb21590`（安全加固）、`3e95131e`（发布打包加固）、`c39b5830`（I7.5.21 四端验收）。
- 主工作区在开始时存在其他 Agent 的 35 个已跟踪修改和 3 个未跟踪文件（`admin/tsconfig.i7523a.json`、`miniprogram/utils/native-preview.js`、`家客来微任务开发协调_SKILL.md`），本轮全部原样保留，未回退、未纳入提交。
- 本轮只新增/修改发布相关文件：`admin/Dockerfile`、`admin/.dockerignore`、本报告与另外两份交付文档。

## 2. 本轮完成的工作

| 任务组 | 内容 | 结果 |
| --- | --- | --- |
| A. DBA | 129 账本核对、停写核验、迁移后全量备份、独立等价恢复 | `passed` |
| B. 生产 AI 与密钥 | 只读审计生产配置、密钥、知识映射、门禁回归 | `passed`（配置本身未就绪） |
| C. 构建与 Docker | 干净检出构建、镜像构建、镜像内容审计、Compose/门禁 | `passed`（本轮修复一个打包阻塞） |
| D. 四端回归 | I7.5.21 证据复核、定向测试、真机缺口人工步骤 | `passed` / `limited` |

## 3. 最终状态矩阵

| 类别 | 状态 | 摘要 |
| --- | --- | --- |
| engineering | `passed` | 干净检出 `npm ci`、`npm run build`（117 页）、`tsc`、`check:survey-runtime` 全部退出 0；既有 ESLint/测试基线问题见 known issues |
| security | `passed`（代码级） | I7.5.23 无回归，定向测试 23/23；生产占位密钥被门禁拒绝，属预期 |
| database | `passed` | 129 账本备份 SHA/Manifest/TOC 完整；等价 Linux 恢复全部校验通过 |
| ai_services | `limited` | 代码与隔离证据通过；生产无 Bailian/Embedding/知识映射，未产生付费调用 |
| mini_program | `passed`（编译） | 干净检出生产预览编译通过（9.0 MB）；真机能力 `not_run` |
| worker | `passed`（隔离） | 门禁、preflight、试点、租约、幂等、重启、健康文件通过；生产未启动 |
| docker | `passed` | 镜像构建成功、内容审计无 env/密钥/uploads、scripts 仅 8 个运行时脚本 |
| operations | `limited` | 部署/备份/Worker 手册完成；生产密钥、AI 配置、启动窗口待审批 |
| rollback | `passed`（数据库）/`limited`（应用） | 数据库等价恢复已实测；应用镜像回滚脚本存在但未跑完整服务栈演练 |

## 4. 数据库：129 账本迁移后备份与等价恢复

### 4.1 源库身份与停写条件

只读连接 `127.0.0.1:5432/smart_floor_planner`（`sfp_backup`，BYPASSRLS、非超级用户），`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`：

| 项目 | 实测 |
| --- | --- |
| 版本 | PostgreSQL 17.10（Debian 17.10-1.pgdg12+1） |
| 编码/排序 | UTF8；`en_US.utf8`/`en_US.utf8`；libc provider；`datcollversion=2.36` |
| 账本 | 129 条，ID 1–135，末条哈希 `bb0cdebdd3e28b7fae20964f2973b5afafb1e9f4da904c366ead2f4c1e3e769e` |
| 结构 | 189 张 `app` 表，167 张 FORCE RLS，222 条策略，171 个复合外键 |
| 扩展 | `vector 0.8.2`、`btree_gist 1.7` |
| 其他连接 | 0 个其他客户端连接；0 个 `idle in transaction`；0 个 app 锁；0 个复制槽；0 个预备事务 |
| 应用/Worker | 3005/3006 无监听；无 `assistant-worker` 进程 |
| 任务队列 | 31 queued、2 running（租约均已过期）、86 indeterminate、404 failed（历史终态）、3,080 succeeded、39 cancelled |

结论：满足停写条件；未领取、未重试、未修改任何任务。

### 4.2 备份

| 项目 | 实测 |
| --- | --- |
| 工具 | `admin/scripts/xiaok-migration-backup.mjs`，`sfp_backup`，`pg_dump --format=custom --compress=6 --snapshot` |
| Backup ID | `xiaok-mig-20261116t130656339z-ded361a4` |
| 目录 | `C:\sfp-backups\i7524-20261116\xiaok-mig-20261116t130656339z-ded361a4` |
| 归档 | `database.dump`，110,311,205 字节 |
| 归档 SHA-256 | `a03b7e1be8cc48028aef7ba1bfdf6bda9c4a692b6dbfd0ff7986ee41700136ee` |
| Manifest 摘要 | `d8f720dccdab642494bf40505d7ccdceb197b8fec565581f1d3e5141807af70e` |
| Manifest 文件 SHA-256 | `0b4dd8524b426a15b38e5bc4ceaa0508d9505364513c73a2bca00adc786ecb1d` |
| 账本 | 129 条，末条 ID 135，账本摘要 `1700b801c7bfcae7f5e7f5c59058e84c840890cf7ac614bd937bfa33a1ba65c6` |
| `pg_restore --list` | 2,780 项，其中 189 项表数据；所有有数据的表均有 TABLE DATA 条目 |
| 耗时 | 51.2 秒 |
| 目录 ACL | 仅 SYSTEM、BUILTIN\Administrators、维护账号（继承已禁用） |

### 4.3 独立等价 Linux 恢复

目标：全新一次性 Linux 容器 `pgvector/pgvector:0.8.2-pg17`，与源库同一 Debian 构建：

| 等价项 | 源库 | 恢复目标 |
| --- | --- | --- |
| PostgreSQL | 17.10 (Debian 17.10-1.pgdg12+1) | 17.10 (Debian 17.10-1.pgdg12+1) |
| glibc | 2.36 | 2.36（Debian GLIBC 2.36-9+deb12u13） |
| 编码/排序 | UTF8 / en_US.utf8 | UTF8 / en_US.utf8 |
| 排序版本 | 2.36 | 2.36 |
| pgvector | 0.8.2 | 0.8.2 |
| btree_gist | 1.7 | 1.7 |

恢复由 `scripts/xiaok-migration-restore-verify.mjs --mode isolated` 执行，目标库验证后自动删除，回执 `status=passed`：

| 校验 | 结果 |
| --- | --- |
| manifest_format / manifest_integrity | true |
| backup_sha256 / restore_list | true |
| target_safety_verified / database_version_compatible | true |
| schema_restore_passed | true（189 表、2,412 列、1,328 约束、736 索引、42 函数、47 触发器） |
| data_restore_passed | true（188 张业务表、99,302 行，逐表摘要一致） |
| ledger_verified | true（129 条，末条 135，摘要与源库一致） |
| rls_verified | true（167 张 RLS，167 张 FORCE RLS，222 条策略） |
| permissions_verified | true（权限摘要 `b78e72d9…` 一致，ownerRole `sfp_migrator`） |
| full_restore_passed | true |

未使用 i798 的 `C` 排序实例冒充等价恢复；i798 仅保留为历史逻辑演练证据。证据：`tmp/xiaok-i7524/dba/restore-receipt.json`（SHA-256 `b09bddc5e1d4a380318dda07a81981a1993e2d686c31addd9b96c9e2a91875b6`）、`restore-target-facts.json`、`source-check.txt`、`backup-run.json`。

## 5. 生产 AI 服务

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| 平台文本模型 | `passed`（开发库） | `platform_configs.llm_config`：`dashscope` / `qwen3.7-flash`，enabled |
| Responses API | `passed`（关闭） | 仅 `ASSISTANT_RESPONSES_API=1` 开启；生产未启用 |
| 企业级 AI 设置 | `passed`（开发库） | 352 行，启用 25 行，178 行有 index profile |
| 知识数据 | `passed`（开发库） | 文档 456、版本 464、分片 2,909、引用 1,035（BYPASSRLS 视角） |
| 向量 | `limited` | `vector 0.8.2`，`vector(1024)`，178 个 `Qwen3-Embedding-0.6B` profile；无 ANN 索引，检索为顺序扫描 |
| 百炼托管 RAG 映射 | `not_run` | 企业映射 0、平台映射 0；生产无 Workspace/Key |
| 生产 Embedding | `not_run` | 生产无 `ASSISTANT_EMBEDDING_*`；开发地址为回环 `127.0.0.1:18089` |
| 文档上传/索引/发布 | `not_run` | 生产未配置、未上传；开发库数据不等于生产知识库 |
| 企业/项目隔离 | `passed`（复用） | 跨企业、错阶段、撤权后 `source_unavailable` 由 I7.5.15/I7.5.20 隔离证据覆盖 |
| Facts-only 降级 | `passed`（复用） | I7.5.20 八种检索/文本故障组合，获权原文降级保存，模型调用 0 |
| insufficient_evidence | `passed`（复用） | 无可靠依据时固定提示，不伪造来源 |
| 本轮真实付费调用 | `not_run` | 未调用任何模型/Embedding API |

说明：开发库企业 1454 存在配置与数据（设置 1、文档 79、分片 177、报告 576、投递 596、项目 217），均为开发数据，本轮只读、未写入、未作为生产证据。

## 6. 生产密钥与环境变量

复用 I7.5.23 的失败关闭实现，本轮只做只读核对与门禁执行：

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| JWT 安全 | `passed` | 生产缺失/默认/短/占位即失败；23 项安全定向测试全通过 |
| AI 凭据加密 | `passed` | 生产必须 `AI_PROVIDER_KEY_ENCRYPTION_SECRET`，不得与 JWT 共用 |
| 管理员密码 | `passed` | `randomBytes(18)` 一次性密码；固定 `123456` 全仓 0 处 |
| 统一生产门禁 | `passed`（拒绝当前配置） | 对当前 `.env.production` 退出 1：裸环境 10 项、compose 注入模拟 9 项 |
| 密钥长度/占位/独立性 | `failed`（配置） | `INTERNAL_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` 占位；缺 `AI_PROVIDER_KEY_ENCRYPTION_SECRET` |
| 数据库账号/口令 | `failed`（配置） | `.env.production` 的 `DATABASE_URL` 指向 `localhost`，沿用开发口令 |
| Docker Secrets | `limited` | compose 无 `secrets:`，密钥走 `env_file`；数据库口令有 `_local_only` 回退，依赖门禁兜底 |
| 环境隔离 | `passed` | `.env.local`/`.env.production` 均未跟踪；镜像内 `.env*=0` |
| 口令复用 | `failed`（配置） | `INITIAL_ADMIN_PASSWORD` 与 `DEPLOY_SMOKE_PASSWORD` 同值；上线后需移除初始管理员口令 |

## 7. Docker 与发布包

### 7.1 干净检出构建

从 `git archive HEAD admin` 的全新目录（无未提交改动、无 `.env`）构建：

| 步骤 | 结果 |
| --- | --- |
| `npm ci` | 退出 0，60.1 秒，1,324 包，npmmirror 源 |
| `npm run build` | 退出 0，119.3 秒，117 个静态页面，Next.js 16.4.6 |
| `tsc --noEmit` | 退出 0 |
| `check:survey-runtime` | 退出 0（83 文件一致） |
| standalone | 12,047 文件 / 350.76 MiB；`.env*=0`、密钥文件 0、uploads 0、`*.test.*` 0 |
| 体积差异 | 较 I7.5.23 基线 +589 文件 / +42.8 MiB，原因是锁文件安装的 Next 16.4.6（基线树为 16.2.3）与整项目追踪增长；页面数不变 |

### 7.2 镜像构建与内容审计

本轮首次在可用 Docker daemon 上真实构建，发现并修复一个发布阻塞：

- `.dockerignore` 排除 `scripts/**/*acceptance*`、`*live*`、`*fixture*` 后，`next build` 的 TypeScript 检查因 `assistant-acceptance-safety.mjs` 等模块缺失而失败。
- standalone 的整项目追踪仍会把 275 个 `scripts/` 文件带进镜像。
- 修复：`.dockerignore` 保留完整源码供构建；Dockerfile 在 builder 阶段删除 `.next/standalone/scripts`，并以显式 8 文件允许清单生成 `/app/scripts`。

镜像审计（`docker run` 内实测）：

| 检查 | 结果 |
| --- | --- |
| `.env*` 文件 | 0 |
| `*.pem` / `*.key` / `*.p12` / `*.pfx` | 0 |
| `keys` 目录 / `uploads` 目录 | 0 / 0 |
| `/app/scripts` | 仅 8 个运行时脚本，全部 `node --check` 通过 |
| `scripts/` 内 acceptance/live/fixture | 0 |
| `src` 内 acceptance/fixture 命名模块 | 7 个，均为真实运行时业务模块（与 I7.5.23 一致） |
| `sfp_app_local_only` / `fallback_secret_random_123` | 前者仅出现在 `production-env-check.mjs` 的禁止值清单（1 个文件）；后者出现在 `jwt-secret.ts` 的开发专用常量与编译 chunk（9 个文件），生产缺失/使用即失败关闭；均为代码常量，不是硬编码凭据或测试账号 |
| drizzle / deployment | 129 个 SQL / 5 项 |

镜像与归档：

| 项目 | 值 |
| --- | --- |
| 镜像 | `sfp-admin:i7524-final` |
| 镜像 ID | `sha256:b1aca5a9133f04206a7dc930011f77202c7276a1589c0eb2e6b403bd1ed87b0e` |
| 镜像大小 | 284,367,283 字节 |
| 基础镜像 | `node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5`（Node 24.22.3） |
| `docker save` 归档 | `sfp-admin-i7524-final.tar` |
| 归档大小 | 284,400,128 字节 |
| 归档 SHA-256 | `3a25d48a6f76cb0a13b92e75fcd4add89eeea4c73e499d367c122daee3ed5cc5` |
| Dockerfile SHA-256 | `4ca6b503044f1b14903abb1e76eeeea9aa550ff6dd8c7de0dbd84fb0f5f63e0c` |
| 构建时间 | 2026-11-16T13:55:25Z |

### 7.3 Compose 与部署门禁

- `docker compose --profile assistant --profile migration config --services` 返回 `postgres`、`admin`、`assistant-worker`、`lead-claim-worker`、`migrate`。
- `admin` 与 `assistant-worker` 均设置 `ASSISTANT_WORKER_HEALTH_FILE=/shared/assistant-worker-health.json`，并挂载同一 `assistant_health` 卷。
- `deploy.sh` 在数据库操作前运行 `node scripts/production-env-check.mjs`；未启动 `assistant-worker`。
- 当前 `.env.production` 会在门禁处失败退出，这是预期保护。

## 8. 四端最终回归

复用 I7.5.21 r14 证据（提交级源码在 `1d1e8879..HEAD` 对四端页面/业务逻辑零改动）：

| 角色 | 项目 | 状态 | 依据 |
| --- | --- | --- | --- |
| 业主 | C01 对话、阶段提醒、消息重进与已读 | `limited` | r14 `customer-c01.png`、`native.json`；引用原生弹层未执行 |
| 业主 | 周报 8 栏目、重开保留已读 | `passed` | r14 `customer-weekly.png` |
| 业主 | 知识问答/引用 | `limited` | I7.5.15/I7.5.20 隔离证据；正式库平台/企业映射为 0 |
| 老板 | 项目简报、进度、需介入、滚动 | `passed` | r14 `boss-brief*.png` |
| 老板 | 周报 9 栏目、已修正清单 | `limited` | 已修正为空态，未构造已解决事项 |
| 设计师 | 项目详情、点位入口、意见、周报 | `limited` | r14；点位返回落工地列表，无独立点位工作区（V1.1） |
| 施工人员 | 项目详情、记录原文、分工弹层、周报 | `passed` | r14 `worker-*.png` |
| 施工人员 | 相机/相册/语音 | `not_run` | 无真机权限；第 8.2 节给出人工步骤 |
| 经理 | 工作台待办与跳转 | `passed` | r14 `manager-workbench.png` |
| 四端 | 微信真实授权、断网恢复、杀进程重进 | `not_run` | 需真机；第 8.2 节给出人工步骤 |

### 8.1 本轮实跑回归

- 小程序定向四端测试 13 文件 **112/112 通过**。
- Admin 纯函数/契约测试 5 文件 **57/57 通过**（未连数据库）。
- 历史全量小程序测试 2,259 项：2,258 通过、1 失败（既有基线）。
- 本轮未修改任何四端页面或业务逻辑。

### 8.2 最短人工验收步骤

1. **微信授权**：真机扫码进入 `pages/index/index`，四角色各登录一次并刷新，保存四张首页截图与后端角色记录。
2. **C01 引用重开**：业主进入 `packages/assistant/chat/chat`，提一个命中企业知识的问题，点击引用打开/关闭两次，保存截图并确认滚动位置与输入不丢。
3. **相机/相册/语音**：施工人员进入试点项目 → 全部记录 → 拍照 1 张、相册 1 张、语音 3–5 秒；保存记录 ID、列表与预览返回截图。
4. **周报重开**：四角色各打开本周周报（业主 8、老板 9、设计师 7、施工 6 栏），返回再开，杀进程重进再开，确认栏目一致且已读不重置。
5. **断网恢复**：施工人员开飞行模式发送带照片记录，确认可恢复失败提示且无重复；联网重试只成功一次，保存幂等键记录。

## 9. Worker 最终准备

| 项目 | 状态 | 实测 |
| --- | --- | --- |
| `CRON_SECRET` | `passed` | 生产存在 ≥64 字符、非占位；preflight/tick 均校验 |
| preflight | `passed` | I7.5.21 r14 真实 HTTP 401/200 路径；门禁 `open`、范围 `pilot` |
| 试点企业范围 | `passed`（隔离） | 隔离库 `pilot/i7521-dev/企业1`，scopeVersion 1、projectCount 1 |
| 企业白名单 | `passed`（隔离） | 异租户任务保持 queued/attempts=0 |
| 生产默认门禁 | `passed`（关闭） | `.env.production` 无 `XIAOK_STAGE_REMINDER_*`/`XIAOK_WEEKLY_REPORT_*`；Worker 将以退出码 2 停止 |
| 共享健康文件 | `passed` | admin 与 assistant-worker 同卷 `/shared/assistant-worker-health.json` |
| 调度范围/租约/幂等/重启 | `passed`（隔离） | I7.5.21 隔离 PG17：PID 重启、无重复、重复 tick 高水位不变 |
| 外部通知 | `passed`（关闭） | 平台 `default` 通知配置版本 2、8 个模板，无 `subscriptionMessagesEnabled` 键（默认关闭） |
| 生产 Worker | `not_run` | 未启动、未发送真实通知 |
| 生产试点企业/项目 | `not_run` | 未猜测、未写入 |

## 10. 最终审批表（一次性）

以下事项需要真实凭据、外部账号、真机、付费资源或生产审批，任何人无法代劳：

| # | 事项 | 负责人 | 需要提供/确认 | 当前状态 |
| --- | --- | --- | --- | --- |
| 1 | 替换 `INTERNAL_SECRET` | 运维/安全 | ≥32 字符独立随机值 | 待办 |
| 2 | 替换 `MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` | 运维/安全 | ≥32 字符独立随机值 | 待办 |
| 3 | 新增 `AI_PROVIDER_KEY_ENCRYPTION_SECRET` | 运维/安全 | ≥32 字符，≠`JWT_SECRET` | 待办 |
| 4 | 生产 `DATABASE_URL` / `DATABASE_MIGRATION_URL` | 运维/DBA | 受控主机、账号、口令，禁止 `_local_only` | 待办 |
| 5 | `POSTGRES_PASSWORD` 与三个应用角色口令 | 运维/DBA | 显式设置并同步 `sfp_app`/`sfp_migrator`/`sfp_auditor` | 待办 |
| 6 | 百炼北京 Workspace/API Key/Category | 知识运营 | `ASSISTANT_BAILIAN_RAG_*` 生产值 | 待办 |
| 7 | 生产 Embedding 服务 | 运维/AI | `ASSISTANT_EMBEDDING_URL/API_KEY`（非回环，或批准的 sidecar） | 待办 |
| 8 | 默认文本模型确认 | 产品/技术 | Qwen3.7 Flash 继续，或完成 DeepSeek Flash 协议/费用验证 | 待办 |
| 9 | 知识库映射、文档上传、索引、发布、引用冒烟 | 知识运营 | 企业库与平台库各一套，批准文档清单 | 待办 |
| 10 | `INITIAL_ADMIN_PASSWORD` / `DEPLOY_SMOKE_PASSWORD` | 安全 | smoke 专用最小权限账号，不得与初始管理员同口令；上线后移除初始口令 | 待办 |
| 11 | 微信 AppID/AppSecret、业务域名、HTTPS origin | 小程序负责人 | 生产归属确认与重置 | 待办 |
| 12 | 真机四端验收 | 测试/产品 | 微信真机、四角色账号、试点/合成项目 | 待办 |
| 13 | Worker 试点企业/项目、启动窗口 | Worker 负责人 | 明确的 `XIAOK_*_ENTERPRISE_ID/PILOT_ID` 与时间窗 | 待办 |
| 14 | 外部通知授权 | 产品/合规 | 是否开启 `subscriptionMessagesEnabled` | 待办（默认关闭） |
| 15 | 生产部署与回滚演练 | 发布负责人 | 部署窗口、上一镜像、变更单 | 待办 |
| 16 | 可选第三方密钥（高德/酷家乐/Pollinations/Google/LongCat） | 产品 | 替换占位或明确不启用 | 待办 |

## 11. 范围冻结确认

本轮未新增装修阶段、专业 Agent、知识库架构、提醒系统、周报系统或自建 GPU 向量基础设施；未修改四端交互模式与业务权限边界；未合并 `main`、未部署生产、未启动生产 Worker、未发送真实通知、未写入企业 1454 生产业务数据。

CAD 深度解析、设计师独立点位工作区增强、经理私聊通知保持在 V1.1。

## 12. 最终回执

| 项目 | 值 |
| --- | --- |
| 源码提交 | 见推送后的最终提交 SHA |
| Admin 干净构建 | 退出 0，117 页，12,047 文件 / 350.76 MiB |
| 小程序生产编译 | 通过，9.0 MB（9,487,895 字节），预览二维码 `preview.png`（SHA-256 `42a305956c11dc81a0bc6f2b8f1fc940c3e47a9fc486014cf80664caafbd6492`） |
| 数据库备份 | `a03b7e1b…`（110,311,205 字节，Manifest `d8f720dc…`） |
| 等价恢复 | `full_restore_passed=true`，129 账本 / 99,302 行 / 167 FORCE RLS / 222 策略 |
| 镜像 | 见下方镜像回执 |
| 未执行 | 合并 `main`、生产部署、生产 Worker、真实通知、真实模型付费调用、企业 1454 生产写入 |

镜像回执：

- 镜像：`sfp-admin:i7524-final`
- 镜像 ID：`sha256:b1aca5a9133f04206a7dc930011f77202c7276a1589c0eb2e6b403bd1ed87b0e`
- 镜像大小：284,367,283 字节
- 归档 SHA-256：`3a25d48a6f76cb0a13b92e75fcd4add89eeea4c73e499d367c122daee3ed5cc5`

## 13. 证据索引

| 证据 | 路径 | SHA-256 |
| --- | --- | --- |
| 源库只读核验 | `tmp/xiaok-i7524/dba/source-check.txt` | `9f5d8d1de6ee50aad010bbca560074c37bd964405969611192c44a76c1e005e3` |
| 备份回执 | `tmp/xiaok-i7524/dba/backup-run.json` | `713987cab7f9137a1c737e3c070a29f3d9ea516199807ad974f589b20e3e83fc` |
| 恢复回执 | `tmp/xiaok-i7524/dba/restore-receipt.json` | `b09bddc5e1d4a380318dda07a81981a1993e2d686c31addd9b96c9e2a91875b6` |
| 恢复目标等价项 | `tmp/xiaok-i7524/dba/restore-target-facts.json` | `38a30993801d86d6dc956a66620330831bc93ce32bc24f6a38e9d266a3659fb9` |
| AI/密钥审计 | `tmp/xiaok-i7524/agent-b/summary.md` | `23689c5bd67ec4845b9e6bfaf2e53fce61ae9262885bd585f3a3f3dad0a932c6` |
| 四端复核 | `tmp/xiaok-i7524/agent-d/summary.md` | `22c37691a7301e5196b938522b40b9e79a7eee0987d8ab66a847e0e0b0e3259d` |
| 干净构建日志 | `C:\sfp-build-i7524\logs\admin-build.log` | `ee5f78629f9c0d34430a805c9e1353d154bc0c197b2b114a721681eb887c097f` |
| 镜像审计 | `C:\sfp-build-i7524\docker\image-audit-final.txt` | `2befc85f08b5ad488b052c722c2ebfbb66d674aeda024ca3281d982325ccead1` |
| 小程序编译日志 | `C:\sfp-build-i7524\mini\preview.log` | `a745b9358b323e6d0d0d6651873cbaceb923f2373cbc5f1d05db2e647793a515` |

历史验收证据（`tmp/xiaok-i7521`、`tmp/xiaok-i7522`、`tmp/xiaok-i7523`、`docs/xiaok-i75*.md`）全部保留，未覆盖、未删除。

## 14. 发布建议

在完成第 10 节第 1–13 项后，重新运行 `check:production-env`（必须退出 0）、`deploy.sh` 校验与登录 smoke，再按运维手册启动。真机项与知识运营项未完成前，对应能力必须保持 `limited`/`not_run` 并在发布说明中披露，不得以浏览器或 DevTools 截图替代。

当前结论维持 **`READY_WITH_CONDITIONS`**。
