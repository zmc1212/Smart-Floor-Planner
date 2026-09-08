# SpatialLM Engine：RTX 4080 部署说明

## 当前状态

`services/spatiallm-engine` 提供独立 FastAPI 服务边界。Mock 模式已经完成本地
接口测试。真实推理按官方 `manycore-research/SpatialLM` 仓库的固定提交
`8913c44d84a450c53e9340b13317f8cf7144a738` 实现，使用 SpatialLM 1.1 Qwen
0.5B、Python 3.11、PyTorch 2.4.1 和 CUDA 12.4。

真实模式已在本机 RTX 4080 的 Ubuntu 24.04/WSL 2 环境完成验证。
`/healthz` 返回 Qwen 0.5B 模型与 `device: cuda`；使用官方
`scene0000_00.ply` 发起请求后，接口返回 HTTP 200，并输出以毫米为单位的
6 面墙和 2 个门窗。一次实测推理耗时 27.50 秒，RTX 4080 利用率达到 100%，
显存占用约 15.9 GB。

目前 Admin 与小程序路由尚未调用该服务，推理结果也不会写入
`FloorPlan.layoutData`。后续 Node Adapter 必须先校验结果，再转换为正式的
version-4 测绘墙图。

## Windows 11 与 WSL 2

1. 启用 `Microsoft-Windows-Subsystem-Linux` 和 `VirtualMachinePlatform`，按系统
   提示重启 Windows。
2. 执行 `wsl --install -d Ubuntu-24.04` 安装 Ubuntu 24.04，并完成首次用户设置。
3. 打开 Ubuntu，进入本项目的服务目录后执行：

```bash
cd /mnt/h/workspaces/Smart-Floor-Planner/services/spatiallm-engine
chmod +x bootstrap-wsl.sh
./bootstrap-wsl.sh
```

如果部署网络无法访问 Hugging Face 官方地址，可以只在下载阶段指定镜像：

```bash
HF_ENDPOINT=https://hf-mirror.com ./bootstrap-wsl.sh
```

脚本可重复执行。隔离环境和模型位于 `/opt/smart-floor-planner/spatiallm`，运行
配置写入服务目录的 `.env`，并以独立低权限 `spatiallm` 账号注册系统级
`spatiallm-engine.service`。它不会向 Node.js 主业务环境安装 Python 依赖。
FlashAttention 使用兼容的 `sm80` 目标编译，并限制并行度以适配 32 GB WSL
环境。模型进入缓存后，服务通过 `HF_HUB_OFFLINE=1` 离线启动，运行时不依赖
下载阶段选择的地址。

最后一个 Windows 侧 WSL 会话退出后，WSL 仍可能回收正在运行 systemd 服务的
发行版。请在 PowerShell 中注册项目专用的登录常驻任务，确保 Windows 上的
Node.js 可以随时访问 `localhost:8002`：

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\services\spatiallm-engine\register-wsl-keepalive.ps1
```

脚本会为当前 Windows 用户创建或更新 `SpatialLM WSL Keepalive` 计划任务，并以
低权限 Linux 用户 `spatiallm` 仅保持 `Ubuntu-24.04` 运行；它不会修改全局 WSL
空闲超时。

## 运维命令

浏览器打开 `http://localhost:8002/` 会返回服务状态，以及健康检查、交互式 API
文档和推理接口的入口。
日常使用时，双击 `services/spatiallm-engine/start-spatiallm.bat` 即可启动 WSL
常驻任务和模型服务；双击 `services/spatiallm-engine/stop-spatiallm.bat` 即可停止
两者。关闭脚本会终止专用的 `Ubuntu-24.04` 发行版，立即释放其系统内存和
SpatialLM 显存，因此也会结束该发行版中的其他进程；它不会关闭 Windows 上的
ComfyUI 等应用。

```bash
sudo systemctl status spatiallm-engine.service
sudo journalctl -u spatiallm-engine.service -f
sudo systemctl restart spatiallm-engine.service
curl http://localhost:8002/healthz
curl -F "file=@/opt/smart-floor-planner/spatiallm/testdata/pcd/scene0000_00.ply" \
  http://localhost:8002/api/v1/predict3d
```

健康检查必须返回 `mode: real`、配置的模型名称和 `device: cuda`。Mock 接口成功
不能作为 GPU 推理已经跑通的证据。

## API 合同

`POST /api/v1/predict3d` 接收 multipart `file` 字段中的一个 `.ply` 文件，默认
上传上限为 512 MB。GPU 推理单路串行执行，响应明确包含
`units: millimetres`、`layout.walls`、`layout.openings` 和 `layout.objects`。
输入点云必须完成轴对齐，并以 Z 轴为竖直方向，这与上游模型合同一致。

## 限制与安全边界

- SpatialLM 输出具有随机性，不是正式测绘墙图。Node 落库前必须校验拓扑、
  单位、墙与门窗关系以及租户归属。
- 当前 API 没有鉴权和 TLS，只能绑定可信内网，或放在带鉴权的反向代理之后。
- 官方 SpatialLM 1.1 权重采用 CC-BY-NC-4.0。商业生产使用前必须取得模型权利方
  的单独授权。
- 首次下载和模型加载可能耗时数分钟；只有 `/healthz` 返回 `status: ok` 才表示
  服务就绪。
