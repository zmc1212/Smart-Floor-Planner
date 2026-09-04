# Admin 正式环境发布与回滚

本文是 `admin/release.bat`、`admin/auto_deploy.sh` 和 `admin/deploy.sh` 的正式运维合同。发布脚本只做应用发布、迁移前备份和应用版本回滚；它不会自动把生产数据库恢复到旧备份，也不会逆向执行迁移。

## 一次性服务器准备

建议固定目录为 `/datas/smartfloor`：

```text
/datas/smartfloor/
  .env.production
  auto_deploy.sh
  sfp-admin-release-YYYYMMDD-NNN.zip
  sfp-admin-release-YYYYMMDD-NNN.zip.sha256
  releases/
  deploy-state/
  backups/postgresql/
```

`.env.production` 只保存在服务器，不进入 ZIP、Git 或 Docker 镜像；执行 `chmod 600 /datas/smartfloor/.env.production`。正式环境至少确认：

- `AUTH_COOKIE_SECURE=true`；
- `ALLOW_TENANT_ENTERPRISE_RESET=false`；
- `JWT_SECRET`、`INTERNAL_SECRET`、`CRON_SECRET`、`MEDIA_STORAGE_KEY_ENCRYPTION_SECRET` 均至少 32 位强随机值；
- `INITIAL_ADMIN_PASSWORD` 至少 12 位，首次初始化后改密；
- 配置专用、低权限、活动状态的 `DEPLOY_SMOKE_USERNAME` 和 `DEPLOY_SMOKE_PASSWORD`；
- 可用 `DEPLOY_SMOKE_PATHS=/api/path-a,/api/path-b` 增加适合该账号权限的只读核心 GET 检查；`/api/auth/me` 始终检查。

脚本优先读取环境变量 `SFP_ENV_FILE` 指向的文件，其次读取部署根目录 `.env.production`。首次从旧部署升级时可临时回退使用 `sfp-admin-release/.env.production`，但应尽快迁出旧目录。

如果服务器上已有 `smart-floor-planner-postgres` 或 `smart-floor-planner-admin`，脚本会读取其 `com.docker.compose.project` 标签并继续使用同一 Compose project，从而继续挂载原 PostgreSQL volume。没有既有容器时默认 project 为 `smart-floor-planner`；特殊环境可明确设置 `SFP_COMPOSE_PROJECT`。不得随意修改这一值。

Compose 只把 PostgreSQL 映射到宿主机 `127.0.0.1:5432`；容器间走私有网络。云安全组和主机防火墙仍应明确拒绝公网 `5432`。

## 构建发布包

在 Windows 的 `admin` 目录执行：

```powershell
release.bat
```

脚本按顺序执行 ESLint、量房画布测试、AI 测试、PostgreSQL 合同测试、Next.js 生产构建、无缓存 Docker 构建，然后生成当天递增版本，如 `20260901-001`。也可显式指定：

```powershell
release.bat -Version 20260901-001
```

产物为：

```text
admin/release/sfp-admin-release-20260901-001.zip
admin/release/sfp-admin-release-20260901-001.zip.sha256
admin/release/auto_deploy.sh
```

ZIP 内含带相同 tag 与 OCI version label 的 Docker 镜像、Compose、迁移、构建信息以及两级 SHA-256 清单，不含生产环境文件。

## 一键发布

上传上述三个文件到固定部署根目录后执行：

```bash
chmod +x auto_deploy.sh
./auto_deploy.sh deploy
```

也可精确指定文件：

```bash
./auto_deploy.sh deploy sfp-admin-release-20260901-001.zip
```

脚本会取得独占发布锁，并依次完成：

1. 校验 ZIP 的外部 SHA-256；
2. 在部署根目录内的随机临时目录解压，校验版本、镜像、Compose、全部迁移和包内 SHA-256；
3. 把已校验版本移动到 `releases/<version>`，不覆盖其他版本；
4. 在接触 PostgreSQL 前校验 Cookie、危险清理开关、四项关键密钥和专用冒烟账号配置；
5. 启动并确认原 PostgreSQL 容器，保留现有 Compose project 和 volume；
6. 在 `backups/postgresql` 生成迁移前 custom dump，要求文件非空、`pg_restore --list` 可读，并生成独立 SHA-256；
7. 执行 PostgreSQL 角色准备和 Drizzle 迁移；
8. 用版本化镜像重建 Admin 与抢单 worker；
9. 在有限超时内检查 `/api/health`、worker health、真实账号登录、`/api/auth/me` 和配置的只读核心路径；
10. 成功后原子写入 `deploy-state/current-*`、`previous-*` 和部署时间。

Compose 预检会显式启用 `migration` profile，确保仅在该 profile 下可见的
`migrate` 服务也进入服务完整性检查。
迁移容器直接使用已校验发布镜像内置的 Drizzle 文件，不再依赖发布目录的
宿主机 bind mount，避免版本目录提升后挂载路径失效。

任何备份、迁移、启动或检查失败都会返回非零状态。若新应用已经切换但检查失败，脚本会尝试恢复发布前的应用镜像；数据库迁移不会逆转。未通过的版本不会成为 `current`。

## 实时请求日志

正式域名使用系统安装的 Nginx。该站点的访问日志用于查看所有到达它的 HTTP 请求，
包括静态资源、API 响应和上游失败。先确认实际 `server` / `location` 的日志配置：

```bash
sudo nginx -T 2>&1 | grep -E 'server_name|access_log|error_log'
```

如果该域名使用以下常见路径，可直接跟踪；否则替换为配置中的实际路径。
`-F` 会在日志轮转后继续跟踪新文件。

```bash
sudo tail -n 100 -F /var/log/nginx/access.log /var/log/nginx/error.log
```

另开一个 SSH 窗口发送不写业务数据的探测请求，再重新扫码：

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' https://smartfloor.zlyun168.com/api/health
```

Nginx 在请求处理结束时记录访问。如果看不到探测请求，核对对应域名与 location 是否有
`access_log off`、独立日志路径、条件记录或 `buffer` / `flush` 缓冲。需要记录全部请求时，
为该站点启用无条件 `access_log`，并移除相关 location 中覆盖它的 `off`。
例如不带缓冲的 `access_log /var/log/nginx/smartfloor.access.log combined;` 会逐条写入
已完成请求；如果站点原有格式含需要的耗时字段，继续使用该格式。
修改配置后先运行 `sudo nginx -t`，通过后用 `sudo systemctl reload nginx` 平滑重载，
再跟踪配置的文件。本仓库不远程修改 Nginx 配置。

应用内部输出单独查看：

```bash
docker logs --tail 200 --timestamps -f smart-floor-planner-admin
```

部署已接入诊断的新 Admin 后，`[MiniProgramRequest]` JSON 日志覆盖
`POST /api/miniprogram/codes/resolve`、`POST /api/auth/miniprogram`、
`POST /api/miniprogram/onboarding/referrer`、`POST /api/miniprogram/onboarding/staff` 和
`GET /api/miniprogram/bootstrap`。每次请求立即记录 `start`，完成时记录 `complete`，
包含状态码、业务结果、阶段、耗时及同一 `requestId`（同时通过 `X-Request-Id` 返回）。
捕获异常增加 `exception`；未捕获异常增加 `failed` 并保留原抛出行为。
日志保留错误类型、源码位置、嵌套 PostgreSQL/网络错误码和微信数字错误码，不记录异常原文、
SQL/参数、请求/响应体、查询字符串、手机号和凭据。角标/派单异常后仍可能记录成功结果，
因为既有业务流程允许对应子步骤降级。

查看日志本身不需要 DEBUG 开关或重启。新增应用日志需要部署新镜像，重启旧镜像不会补上日志。
部署替换容器后应重新执行 `docker logs`。这只是五个接口的诊断日志，全部 HTTP 访问以 Nginx
日志为准。

如需在发布小程序前先修复线上活动码/推广码，可在 Admin 容器内执行脚本。默认只读检查，
不会写库；`--apply` 才提交事务，`--rotate-all` 才会强制轮换所有 active 码。脚本只输出
类型、主体 ID 和版本，不输出令牌：

```bash
docker exec smart-floor-planner-admin node scripts/refresh-service-codes.mjs --kind all
docker exec smart-floor-planner-admin node scripts/refresh-service-codes.mjs --kind all --apply
```

脚本不要求随镜像发布。也可以只把单文件上传到服务器，再复制到现有容器执行；容器需要
能使用现有 `DATABASE_URL`、`REFERRER_TOKEN_SECRET`/`JWT_SECRET` 和 Node `pg` 依赖：

```bash
scp admin/scripts/refresh-service-codes.mjs user@server:/tmp/
docker cp /tmp/refresh-service-codes.mjs smart-floor-planner-admin:/tmp/refresh-service-codes.mjs
docker exec smart-floor-planner-admin node /tmp/refresh-service-codes.mjs --kind all
```

执行 `--apply` 的复制命令同样只替换最后一个参数。上传到 `/tmp` 的脚本不会把上传目录当作
`.env` 目录；容器运行时优先使用已注入的环境变量。若在仓库工作目录直接运行且已安装
`@next/env`，脚本也会读取该工作目录的 `.env` 文件。若在宿主机直接运行 Node，请使用 Node 20
的 `--env-file` 或显式导出环境变量，并确保宿主机已安装兼容版本的 `pg`。

可选参数为 `--kind staff|promotion|all` 和 `--enterprise-id ID`。不加 `--rotate-all` 时，
只轮换当前 `REFERRER_TOKEN_SECRET`（未设置则使用 `JWT_SECRET`）无法重建的 active 记录；
加上后会让旧码立即失效并生成下一版本。脚本执行期间按员工/成员关系加行锁，提交失败会
整体回滚。数据库刷新只更新令牌记录，不会改写已经下载或分发的二维码图片。

扫码返回 `404` 时应看响应体：JSON `code_not_found` 表示不透明令牌未匹配到数据库记录，
不是 Next.js 路由缺失。向 `/api/miniprogram/codes/resolve` 发送空对象 `{}` 应在任何数据库
写入之前返回 `400 / invalid_token`，可用于验证路由存在。随后确认二维码来自同一数据库。
查看已有码时，服务端用 `REFERRER_TOKEN_SECRET`（未设置则用 `JWT_SECRET`）、范围与版本
重建令牌；若改过密钥但已有记录仍保存旧令牌哈希，重新下载的图片也可能校验失败。
换码或改密钥前先确认该条件；换码会使已分发的旧码失效。仅凭 Nginx 的状态码不能确定是哪种原因。

## 状态与回滚

查看当前容器、版本和最近备份：

```bash
./auto_deploy.sh status
```

回滚到记录的上一应用版本：

```bash
./auto_deploy.sh rollback
```

回滚到指定保留版本：

```bash
./auto_deploy.sh rollback 20260901-001
```

回滚只切换 Admin/worker 镜像并重新执行健康、登录和核心路径检查；不会执行迁移，也不会恢复数据库。每个正式迁移必须至少向后兼容紧邻的上一应用版本。若某迁移无法满足这一要求，发布前必须设计独立的 expand/migrate/contract 多阶段方案，而不能依赖一键回滚。

## 备份与恢复边界

每次正式发布都会产生一份发布前备份，但它不能替代定时和异地备份。正式运营仍应配置每日全量备份、异地加密副本、保留周期、失败告警和每月恢复演练。

恢复生产数据库属于独立高风险操作：先停写、确认目标数据库和备份 SHA-256，在独立数据库完成恢复验证并取得审批后再执行。发布或应用回滚脚本永远不会自动覆盖生产数据库。

English mirror: [production-deployment.md](./production-deployment.md)
