# 家客来开发库 SSH 转发恢复报告

2026-11-16（Asia/Shanghai），`codex/xiaok-integration`，工作区基线 `97eb5c394da6a64d3bcaf78fc97ab694aca8b0bd`。

**原转发仍未恢复。** 最终检查时 `127.0.0.1:5432` 和 `127.0.0.1:55432` 均无监听。数据库只读核验状态为 `not_run`。

## 本机配置与进程

- 原启动入口 `SFP-Remote-Dev-Tunnel.lnk` 指向本工作区的 `admin/scripts/remote-dev/tunnel.ps1`，监管 PID `23396` 及其互斥锁存在。未发现相关计划任务。
- 实际启动参数和 `ssh -G` 均确认使用 `Administrator@192.168.10.54:22`、原身份文件和严格主机密钥校验。known_hosts 匹配 3 条记录，无生效的代理命令。原配置为本机 `127.0.0.1:5432` → 远端 `127.0.0.1:15432`，以及本机 `127.0.0.1:55432` → 远端 `127.0.0.1:15433`。
- 初检时，原监管器的 SSH 子进程已与远端 TCP 22 建连，两个本地转发端口尚无监听。复查时监管器仍在。客户端 `OpenSSH/Operational` 已启用，近 36 小时查询未返回事件。本轮保留了一次单独的客户端握手日志。

## 本轮故障证据

对原 SSH 目标执行一次无端口绑定的握手诊断，连接超时上限 8 秒。TCP 22 建立成功，客户端发出自己的 SSH 版本标识。约 4.94 秒后，连接在收到远端版本 banner 之前关闭，SSH 退出码 `255`。客户端记录为 `kex_exchange_identification: Connection closed by remote host`。

直接阻点是 SSH 版本标识交换阶段断连，尚未进入密钥交换和用户认证。上轮同阶段超时，这次记录到连接关闭。关连接的一方及其原因仍需远端侧证据。本轮诊断结束后保留原监管进程，未启动新转发，也未停止 SSH 进程。

## 远端管理员核查项

1. 在 `192.168.10.54` 上检查 `Get-Service sshd` 和 `Get-NetTCPConnection -State Listen -LocalPort 22`，核对监听地址、PID 及实际所属服务。
2. 从远端主机做一次本机 `22` 握手，并查看同期远端 `OpenSSH/Operational` 日志，优先核对预认证限流、子进程退出或其他在发送 banner 前关闭连接的事件。如果本机握手正常，核对本工作站发起的连接是否到达该 `sshd`。
3. SSH 握手恢复后，确认原转发的开发 PostgreSQL 后端仍通过远端回环 `15432` 提供服务，再核对原监管器绑定本机 `5432`。

## 数据库核验与交接

预期目标为 `127.0.0.1:5432/smart_floor_planner`、`sfp_app` 和 PostgreSQL 17.10。本地无经核验的原转发监听，数据库连接未发起。`current_database`、`current_user`、版本、当前账本、最后一条记录、待迁移项，以及 `sfp_backup` 的存在性和权限均记录为 `not_run`。

历史对照取自 I7.5.12.1 的 09:45:37 实库回执。账本 119 条，末条 ID `125`，`created_at=1794902400000`，待迁移 9 条，账本 SHA-256 为 `1d156566fb067a4581e38755c226f500f09c4cefe923d83875c3fb613d77b381`。当时 `sfp_backup` 不存在。本轮 JSON 将这些值保留在独立的历史字段。

本地证据位于 `tmp/xiaok-i7512-ssh-recovery/`。`02-ssh-handshake-and-listeners.json` 记录握手阶段和退出码，`03-final-local-ssh-state.json` 记录最终端口和监管状态，`read-only-database-verification.json` 记录数据库核验停点。

[批准的远端开发连接](./remote-development.zh-CN.md) · [前一轮 DBA 执行报告](./xiaok-i7512-dba-execution-report.md)
