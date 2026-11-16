# 家客来远端 SSH 服务诊断报告

2026-11-16（Asia/Shanghai）。目标 `192.168.10.54:22`，项目登记主机 `User-2026PKPRRP`。

**SSH 已恢复。** 用户确认故障时主机处于关机状态。远端记录显示，主机在 10:53:33 启动，`sshd` 于 10:53:44 随系统启动。开机后，项目原有 SSH 连接通过严格主机密钥校验，`hostname` 返回预期主机名，退出码 `0`。

## 恢复核验

| 项目 | 已核验的结果 |
| --- | --- |
| 服务与监听 | `sshd` 为 `Running`，启动方式 `Auto`，PID `5696`，文件版本 `9.5.0.1`。`0.0.0.0:22` 和 `[::]:22` 均由该 PID 监听。 |
| 连接已到达目标 | 远端会话记录显示 `192.168.10.111` → `192.168.10.54:22`。远端 OpenSSH 日志有来源匹配的成功认证记录。 |
| 有效连接限制 | `sshd -T` 退出码 `0`。`MaxStartups=10:30:100`，`LoginGraceTime=120` 秒，`PerSourceMaxStartups=none`，`MaxAuthTries=6`，`MaxSessions=10`。现行日志配置为 `SyslogFacility AUTH`、`LogLevel INFO`。 |
| 远端回环 | 在 `User-2026PKPRRP` 本机对 `127.0.0.1:22` 完成 TCP 建连和 SSH 版本标识交换，收到 `SSH-2.0-OpenSSH_for_Windows_9.5` 和服务端 `SSH_MSG_KEXINIT`（类型 `20`）。探测在密钥交换起始阶段结束。 |
| 项目转发 | 原监管进程自动恢复本机 `127.0.0.1:5432` 和 `127.0.0.1:55432`，均由指向登记主机的 SSH 进程监听。 |

回环测试的客户端子进程曾挂起。已确认并回收本轮探测进程，最终以有读取超时的回环套接字验证服务端响应。 [SSH 传输协议 RFC 4253](https://www.rfc-editor.org/rfc/rfc4253)

## 故障期间的证据

- 约 10:33，本机 SSH 在收到远端版本前断开，客户端退出码 `255`。默认路由走 Mihomo TUN，本机曾观测到 TUN 侧 `Established` 而以太网出站 `SynSent`。
- 10:48:51，绑定以太网直连目标 `22` 等待 6500 ms 后仍未建连，目标 ARP 邻居未解析。开机后，本机 ARP 邻居恢复为 `Reachable`。
- 远端 System 日志在本次启动时记录 Kernel-General `12`、Kernel-Power `41` 和 EventLog `6008`。此前 SSH 断连及直连探测对应的两个时间窗，`OpenSSH/Operational` 均未返回事件。开机后 10:54:10 有一条来自本机地址的预认证断开（记录 `17953`，对端关闭）。采集范围内未发现连接限流、登录宽限期超时或 `sshd` 应用崩溃记录。

主机关机与故障期的局域网不可达一致。开机后，外部认证、远端回环和原有转发均通过核验。本轮为只读检查。

故障期原始证据在 `tmp/xiaok-remote-sshd-diagnostic/`，开机后的远端回执、回环回执及本机转发状态在其 `post-power-on/` 子目录。 [原 SSH 转发恢复报告](./xiaok-i7512-ssh-forward-recovery-report.md) · [批准的远端开发入口](./remote-development.zh-CN.md)
