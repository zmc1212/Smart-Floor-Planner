# I7.4.8 Assistant Worker 心跳诊断

## 现场结论

2026-11-15 上海时间 07:12–07:15 在 Windows 开发工作站只读检查。取证基线为 `codex/xiaok-integration` 的 `b0020dad4a21`。

微云 1454 的两次 I7.4.6 预检读到了临时 `3016` 开发运行留下的同一份全局心跳。最后成功为上海时间 `2026-11-15 00:58:41.164`，与该运行日志最后一次 Worker POST 200 相差不到一秒。预检的心跳年龄分别为 `12963`、`13127` 秒。现场复查时对应服务和 Worker 都已不在运行，常规 `3006` 开发服务也无监听。因此这份文件在最后一次成功后没有更新，成为 `stale`。现有日志没有退出事件，临时运行结束的具体触发原因是 `limited`。

| 检查项 | 现场证据 |
| --- | --- |
| Worker 进程与管理方式 | `Win32_Process` 未发现匹配的 Worker 或项目 Next.js。Windows 服务和任务计划未发现匹配项。历史的 `tmp/i741-server.log` 记录 `node scripts/dev.mjs --webpack -H 127.0.0.1 -p 3016`，该启动器同时监管 Next.js 和 `node scripts/assistant-worker.mjs`。 |
| 实际监听与可访问性 | `Get-NetTCPConnection` 在 `3006` 和 `3016` 无监听。对 `localhost:3006`、`127.0.0.1:3006` 和 `127.0.0.1:3016` 的 `GET /api/internal/assistant/jobs/run` 均为 `ECONNREFUSED`。本机另有 Vite 监听 `3000`。 |
| 本地配置解析 | 当前环境和 Next.js 加载的 env 文件均无 `ASSISTANT_WORKER_ENDPOINT` 覆盖。独立 Worker 默认解析为 `http://localhost:3006/api/internal/assistant/jobs/run`。常规 `npm run dev` 的 Worker 由启动器传入 `http://127.0.0.1:3006/api/internal/assistant/jobs/run`。历史 `3016` 日志证明当时 POST 已到达该端口。 |
| 凭据与心跳路径 | 本地 `admin/.env.local` 加载后 `CRON_SECRET` 已配置。未设置 `ASSISTANT_WORKER_HEALTH_FILE`，解析为 `G:/AppData/Local/Temp/assistant-worker-health.json`。文件存在，只有旧字段 `lastSuccessAt`。07:12:28 读取时距上次成功 `22426` 秒，文件修改时间为 `00:58:41.166`。 |
| 最近一次成功与失败 | `tmp/i741-server.log` 最后一条是 Worker POST 200，日志修改时间为 `00:58:40.279`。同一日志在 Next.js Ready 前记录了三次通用 Worker 失败，旧日志没有时间戳、状态码或底层错误。最近一次历史请求失败的具体原因是 `limited`，本轮最近的只读探测则明确是连接被拒。 |
| HTTP 和数据库 | 本轮 GET 在 TCP 阶段失败，没有 HTTP 响应。该历史运行日志没有记录这条路由的 401、422 或 503。当前连接失败发生在路由和数据库之前。`DATABASE_URL` 配置存在，数据库连通性、已停止进程的服务端鉴权和真实任务执行均为 `limited`。 |
| Docker 与远端 | Docker CLI 无法连接本机 Docker Desktop Linux engine，容器状态为 `limited`。WSL 未列出运行中的发行版。仓库 Compose 的 `assistant` profile 配置独立 Worker 服务，指向 `http://admin:3005/api/internal/assistant/jobs/run`。远端及生产实例状态为 `limited`。 |

原始现场证据保存在本机 `tmp/i741-server.log`、`tmp/xiaok-i746/readiness-1454-audit-run1.json` 和 `tmp/xiaok-i746/readiness-1454-audit-run2.json`。07:31 复查时进程与监听结果一致，心跳年龄 `23547` 秒。新版 Healthcheck 直接读取该文件，返回退出码 `1`、`heartbeat_stale`，PID 和历史请求状态显示未知。

## 服务恢复条件

现有开发启动器会按实际 Next.js 端口设置 Worker endpoint。常规 `3006` 开发环境无需改配置。使用临时端口时，沿用受管启动器或为独立 Worker 显式设置对应 endpoint，并用独立心跳路径区分临时环境。需要恢复消费时，在获批环境启动 Next.js 与受管 Worker，随后核实近期请求成功。当前本机两者都停止，恢复状态尚未验证。

## 脚本诊断

在 `admin` 运行 `node scripts/assistant-worker-healthcheck.mjs` 可只读查看 JSON 诊断。Worker 和 Healthcheck 用同一套环境加载和文件路径。Worker 原子写入 `lastRequestAt`、`lastSuccessAt`、`lastFailureAt`（毫秒时间戳）、`consecutiveFailures`、`lastHttpStatus`、`lastErrorCode` 和 `workerPid`。请求开始时更新 `lastRequestAt`，HTTP 状态和错误码反映最近一次完成的请求结果。成功清零连续失败次数并保留上一失败时间。请求超时仍为 180 秒，下次轮询仍在本次完成后等待 2 秒。失败业务任务继续由已有队列租约恢复。

| 失败原因 | 判定 |
| --- | --- |
| `missing_secret` | Worker 启动时缺少 `CRON_SECRET`，退出并记录诊断 |
| `endpoint_unreachable` | 发起请求失败或等待 HTTP 响应超时 |
| `unauthorized` / `invalid_request` / `worker_unavailable` | HTTP 401 / 422 / 503 |
| `job_execution_failed` | 响应未确认 `success: true`，或返回其他失败 HTTP 状态 |
| `health_file_unavailable` | 文件缺失、不可读或无效时由 Healthcheck 报告，写入失败时由 Worker 日志报告 |
| `no_successful_tick` / `heartbeat_stale` | 没有成功心跳，或最后成功已超过 210 秒 |
| `worker_process_stopped` | 成功心跳仍在有效期内，但文件记录的本机 PID 已退出 |

健康退出码为 `0`，失败为 `1`。即使旧成功心跳仍在有效期，最近一次请求失败也会使 Healthcheck 返回失败。本机 PID 检查只反映同一宿主或容器 PID 命名空间内的状态，且不能识别 PID 重用。旧文件只有 `lastSuccessAt` 时仍按时间判断。企业预检和 API 继续读取该兼容字段。HTTP 200 且 `success: true` 确认本次轮询收到成功回执，内部单项任务结果仍取决于现有任务状态。路由把未隔离的异常统一返回为 503，单凭该状态无法定位数据库或具体任务。健康文件和诊断输出只使用白名单字段及错误码。

## 验证

- Worker 定向测试 9 项，Healthcheck 定向测试 6 项，覆盖 A–L。使用回环临时 HTTP 服务、合成凭据和独立临时文件。
- 既有开发启动器 5 项，Worker 路由、Pilot 对齐、提醒、周报和运维逻辑 65 项。路由验证覆盖 401、422 和注入失败后的 503，周报覆盖重复调度与投递去重。
- TypeScript、定向 ESLint 和 `git diff --check` 通过。现场探测限于进程、端口、日志、心跳文件和无鉴权 GET。依赖数据库写入的 Worker 集成用例本轮未运行，真实队列消费及通知投递为零。
