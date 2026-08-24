# 抢单到期派单 Worker 运维说明

## 发布与启动

1. 先执行 PostgreSQL 迁移 `0038_lead_claim_racing.sql`，再发布 Admin/API 和 worker。
2. 配置与 Admin 相同的数据库连接、`CRON_SECRET` 及应用基础地址。Docker Compose 服务名为 `lead-claim-worker`，启动命令为 `npm run worker:lead-claims`。
3. worker 每 2 秒调用一次内部扫描；健康状态下，目标是窗口到期后 5 秒内完成自动派单。

## 健康与诊断

- `GET /api/internal/lead-claim-windows/run` 携带 `x-cron-secret: <CRON_SECRET>`，返回最后一次扫描时间、成功/失败时间、处理数量和最近错误。
- `node scripts/lead-claim-worker-healthcheck.mjs` 在最近成功扫描超过 15 秒或接口不可用时非零退出；Compose 已用它作为 healthcheck。
- 业务日志前缀为 `[lead-claim-worker]`。扫描失败不会延长抢单截止；抢单 API 始终按数据库 `expiresAt` 拒绝超时请求并兜底解析。

## 并发与恢复

- 扫描使用 `FOR UPDATE SKIP LOCKED`，每个企业再取得事务 advisory lock；多实例不会重复派同一窗口，也不会并发破坏 70/30 分流计数。
- worker 可安全重启。未处理的 `open` 窗口保留在数据库，恢复后继续扫描；人工指派或已经领取的窗口会被跳过。
- 无可用设计师时窗口记录为 `auto_assigned` 的解析结果，线索进入 `assignment_pending/designer_unavailable` 并通知负责人。补齐员工资料、解除暂停或增加容量后，沿用线索现有重试派单入口。
- 连续失败先检查 Admin 健康、`CRON_SECRET` 一致性、数据库迁移版本和 RLS/连接配置；不要通过修改 `expiresAt` 或直接改分流计数来恢复。

英文镜像：[lead-claim-worker-operations.md](./lead-claim-worker-operations.md)
