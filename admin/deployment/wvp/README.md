# Standalone WVP trial bundle

This is a fresh Linux amd64 deployment of five pinned images: WVP 2.7.4,
ZLMediaKit, MySQL 8.4, Redis 7.4 and the read-only storage probe.
It excludes the Smart Floor Planner app, Mini Program, authenticated camera
gateway/workers, PostgreSQL business data, vendor LAN onboarding, all existing
devices/media and runtime credentials. See [Chinese deployment guide](README.zh-CN.md).

Requirements: Linux x86_64, local rootful Docker Engine, Compose v2.24+, Python 3,
at least 4 GiB assigned to Docker and 10 GiB free for installation. Allocate
recording space separately from measured bitrates; this is not a multi-camera
capacity guarantee. Prefer a maintained Docker Engine 28+ for the actual server.

Verify the adjacent archive checksum before extracting. Inside the release:

~~~bash
sudo bash deploy.sh preflight --public-ip YOUR_PUBLIC_IPV4 --data-dir /datas/sfp-wvp-data
sudo bash deploy.sh install --public-ip YOUR_PUBLIC_IPV4 --data-dir /datas/sfp-wvp-data
sudo bash deploy.sh status
sudo bash deploy.sh verify
~~~

The installer validates all payload hashes, uses only the exact offline images,
creates fresh random credentials, refuses foreign/nonempty data directories and
occupied ports, and waits for healthy services plus authenticated read checks.
It never installs Docker, changes firewalls/Nginx, modifies an existing project,
copies development data, changes a camera, or enables recording.
Failures retain the owned state. Resume the same installation with install.
Another release cannot be installed over this data as an implicit upgrade.

Default public camera ports are SIP TCP/UDP 15060 and RTP TCP/UDP 30000–30099.
Restrict their sources at the cloud and host firewalls. HTTP management (18080),
media (8080), and the probe (18082) bind only to loopback; MySQL/Redis have no
published ports. First-install CLI overrides support a separate port range and
project. SIP/RTP advertised ports match their real listeners.
The pinned ZLM requires an RTP pool of at least 36 ports (36..500 supported by
the maintained installer); a 10-port pool passes basic health checks but fails
real playback. Release001 remains frozen; the deployed trial now uses
TCP15060/20000–20035; office/32 and manual4G trial sources follow the server contract. See the
[current server contract](../../../docs/production-deployment.md#standalone-wvp-trial-bundle).

From the operator's computer:

~~~bash
ssh -N -L 18080:127.0.0.1:18080 -L 8080:127.0.0.1:8080 USER@SERVER
~~~

Open http://127.0.0.1:18080. Username: admin. Read the random admin/SIP
passwords locally on the server from .state/installation.private.json; never
send that file or terminal output to chat, logs or support tickets. Keep media
tunnel ports identical at both ends if customized. Password changes made in WVP
must also be reflected in the private verifier configuration.

Camera parameters: the configured public IPv4/SIP port, server ID
34020000002000000001, domain 3402000000, random SIP password, and the camera's
own unique 20-digit device/channel IDs. Do not repoint a device participating in
the existing development soak test.
The approved camera stores only 31 SIP password characters. Its cloud enrollment
uses WVP's native per-device 24-character random password; global credentials
are unchanged. LTE was disabled for office acceptance; the user now reports4G live
playable. Independent route/reconnect/SD checks and current cloud-rule readback remain pending.

stop stops only this owned installation and preserves all data.
backup saves a transaction-consistent MySQL dump and private installer config;
it does **not** include recordings, JWK or snapshots and is not full disaster
recovery. Full migration requires quiescing writes, copying the complete
dedicated data and private state, and verifying restoration in an isolated
target. No destructive restore/uninstall command is included.

Infrastructure checks do not prove public NAT/firewall reachability, real camera
decoding/control, WeChat playback or production integration. WVP's 7-day node
setting does not implement Smart Floor Planner tenant retention/capacity rules.
Recording defaults off. Product HTTPS domains and the authenticated gateway
remain separate work. Actual server/onboarding checks are in the current server
contract; public bandwidth and multi-camera capacity remain unverified.

Image identities are in images.json. Sources:
[WVP](https://github.com/648540858/wvp-GB28181-pro),
[ZLMediaKit](https://github.com/ZLMediaKit/ZLMediaKit),
[Compose](https://docs.docker.com/reference/cli/docker/compose/up/),
[port publishing](https://docs.docker.com/engine/network/port-publishing/).

<!-- cloud-camera-cloud-mini-integration -->
**Private SD DeviceStatus clock (bounded Implemented).** sd-clock-probe.py is an optional read-only companion for the verified WVP2.7.4 log format. Protected JSON config provides wvpOrigin,username,password,a separate ≥32-character token,and allowlisted deviceId/channelId strings in devices. Run the existing verified Python image with source mounted /app/probe.py,config /app/config.json and /datas/sfp-wvp-data/wvp-logs:/wvp-logs:ro,CLOCK_CONFIG=/app/config.json,UID10001,read-only root/mounts,all capabilities dropped/no-new-privileges/no Docker socket,the existing WVP network and only loopback28083→18083. It calls the existing authenticated API, never a second SIP listener, and never mutates camera/card/recording/time settings. Only newly appended matching XML is accepted; ambiguity/staleness/malformed data/an epoch change during one sample fail closed. The returned identity is a stable binding identity with registerTimeStamp excluded, not a physical serial. [Upstream handler reference](https://github.com/648540858/wvp-GB28181-pro/blob/master/src/main/java/com/genersoft/iot/vmp/gb28181/transmit/event/request/impl/message/response/cmd/DeviceStatusResponseMessageHandler.java); deployed2.7.4 runtime evidence, not master, is version authority.

The application explicitly selects private CAMERA_SD_CLOCK_ORIGIN/CAMERA_SD_CLOCK_TOKEN; failure remains503 with no vendor/server-time fallback. The existing vendor serial/card checks remain for the other source. Mini lists a binding's historical trusted windows under the stable identity; pre-calibration footage is not authorized, re-registration does not reset the same binding's history, and the gateway rebases legacy windows once. The client accepts only absent or identityVersion=2; fresh identity/clock envelope is checked before cached starts. Current host sfp-wvp-sd-clock-20261106/unless-stopped uses /datas/sfp-wvp-sd-clock-20261106/; copy private config/inspect/source with normal SQL/site backups. No full restore/reboot claim. [Actual Mini SD, recovery and STOP evidence](../../../tmp/cloud-camera-mini-sd-20261106/assessment.json); original five services/package/site stay unchanged. Formal business/Mini release pending.
<!-- /cloud-camera-cloud-mini-integration -->

## Authorized public management entry

The current instance is available at [https://wvp.zlyun168.com](https://wvp.zlyun168.com).
Install [nginx-public.conf](nginx-public.conf) separately from frozen release001,
using the existing wildcard certificate and loopback28080/28081 upstreams.
It reuses the stock `wvp_token` cookie and native401 response through
`auth_request` for media and WS handshakes; public control/hooks/docs return404.
For pinned WVP2.7.4 with HTTP-only ZLM,the proxy maps generated HTTP/WS playback
URLs to HTTPS/WSS fields because native TLS fields are null. Native-node HTTPS
edits are overwritten on startup. Recheck this adapter on any upstream upgrade.
Current proof is normal DNS/TLS,login/reentry and actual1920×1080 Jessibuca WSS;
4G live is user-reported; reconnect/SD,WebRTC/RTSP/RTMP,Mini gateway publishing
and recording are separate scope. Preserve the operator LTE settings.
Access logs omit query arguments/cookies/tokens. Nginx master is gracefully
reloaded; existing sites/containers are preserved. See the
[server contract](../../../docs/production-deployment.md#standalone-wvp-trial-bundle)
and [public evidence](../../../tmp/wvp-bundle-20261105-01/public-management-verification.json).
