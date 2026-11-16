# 家客来 V1.0 已知问题与发布门禁

2026-11-16（Asia/Shanghai）。本清单只记录实测状态，不修改历史报告，不用历史 SHA 回退。状态定义：`passed`、`failed`、`limited`、`not_run`。

## 1. 阻断发布的遗留项

无代码级阻断项。本轮发现并修复了一个镜像打包阻断：`.dockerignore` 排除 acceptance/live/fixture 脚本后，`next build` 对 `scripts/` 的类型检查因模块缺失失败。修复方式见第 5 节，修复后镜像构建通过。

生产上线仍受配置与审批阻断，见第 4 节。

## 2. 既有基线问题（本轮未修复）

| 状态 | 问题 | 影响 | 处理建议 |
| --- | --- | --- | --- |
| `failed`（基线） | Admin 全量 ESLint：8 errors / 65 warnings，全部在未修改的 `admin/deployment/portfolio-kodo/seed.cjs`、`signing.js` 的 `require()` | 全量 lint 门禁失败 | 发布批准基线豁免，或另开任务改为 ESM/加豁免 |
| `failed`（基线） | 小程序 `survey-kernel-phase0-baseline.test.js`：8 项中 1 项失败（源码治理统计基线漂移） | 全量小程序测试 2259 项中 1 失败 | 单独修复审计基线；与四端业务无关 |
| `failed`（基线） | `pilot-worker-alignment`：11 项中 2 项失败（`W.`、`W2.`），断言匹配旧源码字符串 | Worker 定向测试非全绿 | 更新断言到带 `taskScope`/门禁的当前实现 |

以上三项在本轮复核中均稳定复现，未被删除、未降低门槛。

## 3. 安全与配置缺陷

| 状态 | 问题 | 影响 | 处理建议 |
| --- | --- | --- | --- |
| `failed` | `.env.production` 的 `INTERNAL_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` 仍为占位值 | 生产门禁拒绝部署（预期失败关闭） | 运维替换为独立随机值 |
| `failed` | `.env.production` 缺 `AI_PROVIDER_KEY_ENCRYPTION_SECRET` | AI 凭据无法按生产密钥加解密 | 新增 ≥32 字符独立密钥 |
| `failed` | `INITIAL_ADMIN_PASSWORD` 与 `DEPLOY_SMOKE_PASSWORD` 同值，且初始管理员口令长期驻留生产 env | 口令复用与泄露面扩大 | 上线后移除初始管理员口令；smoke 使用最小权限账号并轮换 |
| `failed` | `.env.production` 的 `DATABASE_URL` 指向 `localhost` 并沿用开发口令 | compose 网络内指向容器自身，无法连接 | 改为受控生产数据库地址与口令 |
| `limited` | compose 无 Docker Secrets，所有密钥走 `env_file`；数据库口令仍有 `${VAR:-*_local_only}` 回退 | 依赖部署门禁兜底 | 生产改用 secrets 或受控 env 注入；不得绕过 `deploy.sh` 直接启动 |
| `limited` | `crypto.ts` 的媒体密钥只校验生产存在性，不拒绝占位值 | 绕过门禁直接启动时占位值会被接受 | 保持统一门禁为唯一入口；后续可加占位校验 |
| `limited` | 生产构建 standalone 仍包含 `src`（1,295 文件）与 source map | 源码暴露风险 | 内部镜像仓库限制访问；后续评估排除 |
| `limited` | `miniprogram/project.private.config.json` 被跟踪，含本地热重载配置 | 上传包可能包含本地私有配置 | 发布前确认开发者工具忽略；后续移除跟踪 |

## 4. 生产配置与审批（阻断上线，不阻断代码）

| 状态 | 项目 | 说明 |
| --- | --- | --- |
| `not_run` | 百炼生产 Workspace/Key | 生产 `.env.production` 无 `ASSISTANT_BAILIAN_RAG_*`；未使用开发 Workspace 冒充 |
| `not_run` | 企业/平台知识映射 | 开发库映射为 0；生产未配置、未上传、未索引、未发布 |
| `not_run` | 生产 Embedding | 无 `ASSISTANT_EMBEDDING_URL/API_KEY`；开发地址为 `127.0.0.1:18089`，不得直接用于生产 |
| `not_run` | 生产文本模型确认 | 平台默认 `qwen3.7-flash`；DeepSeek Flash 未做生产协议/费用验证 |
| `not_run` | 生产 Worker | 未启动、未配置试点、未发送真实通知；门禁默认关闭 |
| `not_run` | 真机与真实微信授权 | 无真实设备/账号；DevTools 与合成 JWT 不等同真机 |
| `not_run` | 生产数据库操作 | 未迁移、未写入企业 1454 生产业务数据、未部署生产 |
| `not_run` | 凭据轮换 | 设置新 AI 密钥后需在生产后台重新保存 LLM/Provider/地图/短信凭据 |
| `not_run` | 应用回滚演练 | 镜像回滚脚本存在，但本轮未在隔离环境启动完整服务栈做回滚演练 |

## 5. 本轮修复的发布阻塞

### 5.1 Docker 镜像包含完整 scripts 树

- 现象：`.dockerignore` 排除 `scripts/**/*acceptance*`、`*live*`、`*fixture*` 后，Docker 构建在 `next build` 阶段因 TypeScript 找不到 `assistant-acceptance-safety.mjs` 等模块失败；即使构建通过，standalone 追踪仍会把 275 个脚本复制进镜像。
- 修复：`.dockerignore` 不再排除这三类脚本（构建需要完整源码）；`Dockerfile` 在 builder 阶段删除 `.next/standalone/scripts`，并用显式 8 文件允许清单生成 `/app/scripts`。
- 验证：镜像内 `.env*=0`、密钥文件 `=0`、`uploads=0`；`scripts/` 仅 8 个运行时脚本；其余 `testish` 命中为 7 个 `src/lib` 运行时模块（acceptance/fixture 命名的真实业务代码），与 I7.5.23 一致。

## 6. 已知限制（非缺陷）

- Admin 全量构建的 standalone 相比 I7.5.23 基线增加 589 文件 / 42.8 MiB，原因是锁文件安装的 Next.js 16.4.6（基线树为 16.2.3）与整项目追踪增长；页面数仍为 117，无安全泄漏。
- 镜像内保留 `src` 与 source map；建议仅在受控镜像仓库分发。
- 开发库统计以 `sfp_backup`（BYPASSRLS）为准；使用 `sfp_app` 且无租户上下文时 FORCE RLS 会返回 0 行，历史报告中部分“0 行”是 RLS 视角，不代表真实为空。
- 备份目录 ACL 在受限继承后需为维护账号显式授权，否则 `fs.statfs` 返回 EPERM；本轮已按 SYSTEM/Administrators/Administrator 授权。

## 7. 发布门禁建议

发布前必须全部满足：
1. 统一生产环境门禁退出 0。
2. 129 账本备份 SHA/Manifest 与等价 Linux 恢复回执齐备。
3. 生产知识映射、文档、索引、引用冒烟通过，或书面接受知识能力 `limited`。
4. 真机四端验收完成，或书面接受对应项 `not_run`。
5. Worker 试点范围、启动窗口、外部通知开关单独审批。
6. 镜像 SHA 与部署清单归档，`deploy.sh` 校验通过。
