# WVP 独立试部署包

适用于 **Linux x86_64 + Docker Engine + Docker Compose v2.24 或更新版本 + Python 3**。
本包提供固定版本 WVP 2.7.4、ZLMediaKit、MySQL 8.4、Redis 7.4 和只读容量探针，
用于新装一个独立摄像头接入环境。镜像在远端开发电脑导出，安装无需从镜像仓库下载。

不包含智慧工地 Admin、小程序、摄像头鉴权网关/Worker、业务 PostgreSQL、
已有账号/设备/录像、厂家局域网自动扫描与 SDK 配置服务。
部署包不会自动切换已有摄像头；本次获准设备实际接入状态见正式服务器合同。
SD 卡的公网 SDK 可达性尚未验证。

<!-- cloud-camera-cloud-mini-integration -->
**私有SD国标时间校验（限定Implemented）。** sd-clock-probe.py为已核验WVP2.7.4日志格式的可选只读组件。受限JSON配置包含wvpOrigin、username、password、独立≥32字符token及devices中的设备/通道白名单。复用已核验Python镜像，将源码只读挂载为/app/probe.py、配置/app/config.json、原/datas/sfp-wvp-data/wvp-logs为/wvp-logs:ro，CLOCK_CONFIG=/app/config.json；UID10001、只读根/挂载、drop全部cap/no-new-privileges、无Docker socket，沿原WVP网络且仅回环28083→18083。调用原认证API，不另建SIP监听，不写摄像头/录制/卡/时间配置。只接受新追加匹配XML，多份/陈旧/畸形/单次采样期间代次改变均拒绝；输出绑定稳定身份（不含registerTimeStamp），不冒称物理序列号。参考[上游处理](https://github.com/648540858/wvp-GB28181-pro/blob/master/src/main/java/com/genersoft/iot/vmp/gb28181/transmit/event/request/impl/message/response/cmd/DeviceStatusResponseMessageHandler.java)；部署2.7.4现场实证为版本依据，master仅供参考。

应用用私有CAMERA_SD_CLOCK_ORIGIN/CAMERA_SD_CLOCK_TOKEN显式启用，失败保持503，不回退厂家/服务器时间；另一来源原厂家序列号/卡校验保留。Mini按绑定列出稳定身份下的历史可信窗口；首次校验前不获得授权，重新注册不重置同绑定历史，旧窗口由网关一次性归并；客户端仅接受缺省或identityVersion=2，缓存开播前再核身份/时差包络。当前sfp-wvp-sd-clock-20261106/unless-stopped目录/datas/sfp-wvp-sd-clock-20261106/，私有配置/inspect/源码随原SQL/站点备份，不作完整恢复或重启证明。[真实Mini SD、恢复及STOP实证](../../../tmp/cloud-camera-mini-sd-20261106/assessment.json)已验；原五服务/包/站点保持，正式业务/小程序发布待完成。
<!-- /cloud-camera-cloud-mini-integration -->

## 1. 先查看正式服务器配置

~~~bash
cat /etc/os-release
uname -m
nproc
free -h
df -hT -x tmpfs -x devtmpfs -x overlay
docker version
docker compose version
python3 --version
sudo ss -lntup
~~~

公网带宽上限与按带宽/流量计费方式在云控制台查看。
安装预检要求 Docker 可用内存至少 4 GiB、数据盘剩余至少 10 GiB；
这是单路试部署的安装预算，不是多路容量承诺，也不包含长期录像容量。
每路平均码率 1 Mbps 连续录像约 10.8 GB/天，按实际码率、路数、天数另留余量。
正式服务器应使用受维护的 Docker Engine；建议 28 或更新版本。

## 2. 上传并验证安装包

在有安装包的电脑上传到服务器（替换文件名、账号、IP）：

~~~bash
scp sfp-wvp-20261105-001-linux-amd64.tar.gz sfp-wvp-20261105-001-linux-amd64.tar.gz.sha256 用户名@服务器IP:/datas/
~~~

服务器执行：

~~~bash
cd /datas
sha256sum -c sfp-wvp-20261105-001-linux-amd64.tar.gz.sha256
tar -xzf sfp-wvp-20261105-001-linux-amd64.tar.gz
cd sfp-wvp-20261105-001-linux-amd64
sudo bash deploy.sh preflight --public-ip 服务器公网IPv4 --data-dir /datas/sfp-wvp-data
sudo bash deploy.sh install --public-ip 服务器公网IPv4 --data-dir /datas/sfp-wvp-data
~~~

将中文占位文字替换成实际值。预检是只读检查；install 才导入镜像、生成随机凭据、
创建数据目录和启动本包的五个服务。安装不会安装/升级 Docker、修改防火墙/Nginx，
也不会停止其他项目。不要使用已有业务数据目录。

首次安装可追加 --project sfp-wvp-trial、--sip-port 15060、
--http-port 18080、--media-port 8080、--storage-port 18082、
--rtp-min 30000 --rtp-max 30099；SIP/RTP 的监听与公告端口保持一致。
固定 ZLM 的 RTP 端口池至少需要36个端口，维护源码仅接受36..500；10端口虽可通过
基础健康检查，实际点播会失败。001归档保持冻结；当前云端使用TCP15060/20000–20035，
办公/32及手工4G试接来源见[实际服务器合同](../../../docs/production-deployment.zh-CN.md#独立-wvp-试部署包)。
已安装后的重入使用保存配置，不通过更换参数改写现有实例。
不支持在旧目录原地升级另一版本；升级须另行评估数据迁移和恢复。

安装过程只导入 images.json 固定的五个镜像，不拉取 latest；
SHA256SUMS 覆盖镜像归档、脚本和配置。失败保留现场和数据，不自动删除或重新初始化。
确认原因后，在原目录执行 sudo bash deploy.sh install 可继续同一次安装。

## 3. 打开 WVP 管理页面

HTTP 管理/媒体/探针仅绑定服务器 127.0.0.1。先在自己的电脑保持 SSH 隧道：

~~~bash
ssh -N -L 18080:127.0.0.1:18080 -L 8080:127.0.0.1:8080 用户名@服务器IP
~~~

浏览器打开 http://127.0.0.1:18080。账号是 admin，密码在服务器的
.state/installation.private.json。可在服务器本地只显示所需字段：

~~~bash
sudo python3 -c 'import json; p=json.load(open(".state/installation.private.json")); print("admin:", p["credentials"]["WVP_ADMIN_PASSWORD"]); print("SIP:", p["credentials"]["SIP_PASSWORD"])'
~~~

此命令会在你自己的终端显示两项密码，不要把输出发到聊天、截图或工单。
.state/ 和数据目录包含私密数据，不要重新打进安装包。
若更改了服务端媒体端口，隧道两端都使用同一个媒体端口；WVP HTTP 的本地端口可独立调整。
通过 WVP 修改管理员密码后，安装凭据和自动 verify 不会自行更新，需同步维护私有配置。

## 4. 接入一台获准测试摄像头

在云安全组与主机防火墙允许摄像头访问：

| 用途 | 默认端口 | 可见范围 |
| --- | --- | --- |
| SSH 管理 | 原服务器 SSH 端口 | 仅管理来源 |
| GB28181 SIP | 15060 TCP/UDP | 按摄像头来源放行 |
| GB28181 RTP | 30000–30099 TCP/UDP | 按摄像头来源放行 |
| WVP 管理 | 18080 TCP | 仅回环，SSH 隧道 |
| 媒体 HTTP | 8080 TCP | 仅回环，SSH 隧道 |
| 容量探针 | 18082 TCP | 仅回环 |
| MySQL / Redis | 无宿主机发布 | Docker 私有网络 |

不要为方便接入而开放 MySQL、Redis、原始媒体 HTTP 或管理控制 API。
配置过其他端口时，以 .state/installation.private.json 为准。

摄像头 GB28181 参数：

- SIP 服务器 IP：安装时的公网 IPv4。
- SIP 服务器端口：默认 15060。
- SIP 服务器 ID：34020000002000000001。
- SIP 域：3402000000。
- SIP 密码：上一步生成的 SIP 密码。
- 设备与通道 ID：沿设备自身合法且唯一的 20 位编号，不复制开发设备身份。

本次获准摄像头实际只能保存31位SIP密码，云端采用WVP原生单设备24位随机密码，
全局凭据保持。初次办公试接曾关闭4G；用户现反馈自带4G直播可播，保留其设置，
独立路由/重连/SD及当前云规则回读尚未完成。

先确认设备在线、真实直播出画、关闭再打开，然后按设备能力测试回放/抓拍/云台。
HTTP 成功不等于物理云台运动/停止。当前 74 小时测试仍在用原摄像头时，
使用另一台获准测试设备，或待原批次结束并确认清理后再安排切换。

默认不自动启录。WVP 节点的 7 天参数仅为该节点配置，本包未提供智慧工地
租户/三天留存/容量停录等业务合同；不能以本包安装成功代替这些业务验收。
不要在没有核定磁盘与保留策略前启用长期录像。
管理测试走 SSH；小程序正式播放所需的 HTTPS 业务域名和业务鉴权网关需后续接入。

## 5. 状态、停止回退与备份

~~~bash
sudo bash deploy.sh status
sudo bash deploy.sh verify
sudo bash deploy.sh backup
sudo bash deploy.sh stop
~~~

verify 只检查服务、登录、媒体节点、匿名拒绝及容量接口，不发起摄像头控制/录制。
stop 仅停止本安装的五个服务，数据和配置保留；恢复使用 install。
首装试部署的回退是停止本独立实例并保留数据，不影响现有 Admin。
安装归属不符时脚本拒绝操作，不以通用容器名删除任何资源。

backup 保存事务一致的 MySQL SQL 及安装配置到权限受限的 .state/backup-*；
**不含录像、JWK、抓图及其他目录，不是完整灾备**。完整迁移/恢复前需停写，
另备份整个专属数据目录和 .state/，在隔离目标完成恢复验证；本包没有覆盖恢复命令。
不要直接删除数据目录或使用 docker compose down -v。

## 6. 已知验证边界

远端独立安装验证与实际正式服务器验收分开。实际服务器系统/资源/带宽、
安全组/NAT、公网摄像头、微信播放、物理云台、多路容量须有各自证据。
安装包当前仅用于独立试部署，不代表全部云工地功能已生产验收。

镜像来源与固定 ID 见 images.json；脚本不携带开发环境运行时凭据或数据。

## 7. 已授权公网管理入口

当前实例地址为 [https://wvp.zlyun168.com](https://wvp.zlyun168.com)。
[nginx-public.conf](nginx-public.conf)独立于冻结001归档，复用现有泛域名证书和
回环28080/28081上游；媒体请求/WS握手通过auth_request复用原wvp_token及原生401，
公网控制/Hook/文档返回404。固定WVP2.7.4配HTTP ZLM时，原生TLS地址为空，代理将
生成的HTTP/WS播放地址归一到HTTPS/WSS字段；节点TLS手改值重启会重置，升级须重核适配。
正常DNS/TLS、登录/重进及1920×1080 Jessibuca WSS出画已验；WebRTC/RTSP/RTMP、
4G直播仅为用户反馈，重连/SD、小程序业务网关发布与录像另计，保留用户LTE设置。访问日志不记录查询参数/Cookie/Token，Nginx平滑
重载且保留其他站点/容器。凭据仍仅存服务器私有安装配置，账号admin。
详见[服务器合同](../../../docs/production-deployment.zh-CN.md#独立-wvp-试部署包)和
[域名实证](../../../tmp/wvp-bundle-20261105-01/public-management-verification.json)。
上游参考：[WVP](https://github.com/648540858/wvp-GB28181-pro)、
[ZLMediaKit](https://github.com/ZLMediaKit/ZLMediaKit)、
[Docker Compose](https://docs.docker.com/reference/cli/docker/compose/up/)、
[端口发布](https://docs.docker.com/engine/network/port-publishing/)。
