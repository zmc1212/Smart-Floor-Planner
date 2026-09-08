# SpatialLM Engine: RTX 4080 Deployment

## Current status

`services/spatiallm-engine` provides a standalone FastAPI boundary. Mock mode
is tested locally. Real inference is implemented against the official
`manycore-research/SpatialLM` repository at pinned commit
`8913c44d84a450c53e9340b13317f8cf7144a738`, using SpatialLM 1.1 Qwen 0.5B,
Python 3.11, PyTorch 2.4.1, and CUDA 12.4.

Real mode has been verified on the local RTX 4080 under Ubuntu 24.04/WSL 2.
`/healthz` reported the Qwen 0.5B model on `cuda`, and the official
`scene0000_00.ply` test request returned HTTP 200 with 6 walls and 2 openings
in millimetres. One measured inference completed in 27.50 seconds while the
RTX 4080 reached 100% utilization and approximately 15.9 GB VRAM usage.

This service is not yet called by an Admin or Mini Program route. No inferred
layout is persisted to `FloorPlan.layoutData`; a future Node adapter must
validate and convert the response into the formal version-4 survey graph.

## Windows 11 and WSL 2

1. Enable `Microsoft-Windows-Subsystem-Linux` and `VirtualMachinePlatform`, then
   restart Windows when requested.
2. Install Ubuntu 24.04 with `wsl --install -d Ubuntu-24.04` and complete its
   first-run user setup.
3. Open Ubuntu, enter the checked-out service directory, and run:

```bash
cd /mnt/h/workspaces/Smart-Floor-Planner/services/spatiallm-engine
chmod +x bootstrap-wsl.sh
./bootstrap-wsl.sh
```

If the official Hugging Face endpoint is unavailable on the deployment
network, select an alternate endpoint for the download only:

```bash
HF_ENDPOINT=https://hf-mirror.com ./bootstrap-wsl.sh
```

The bootstrap is repeatable. It keeps the model environment under
`/opt/smart-floor-planner/spatiallm`, writes the runtime `.env` beside the
service, and registers the system-level `spatiallm-engine.service` under a
dedicated low-privilege `spatiallm` account. It does not install Python packages
into the Node.js application. FlashAttention is built for the compatible
`sm80` target with bounded parallelism to fit a 32 GB WSL environment. After
the model is cached, the service starts with `HF_HUB_OFFLINE=1` and does not
depend on the selected download endpoint at runtime.

WSL can stop an otherwise healthy systemd service after the last Windows-side
WSL session exits. Register the scoped login keepalive from PowerShell so the
Windows Node.js process can always reach `localhost:8002`:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\services\spatiallm-engine\register-wsl-keepalive.ps1
```

The script creates or updates the current user's `SpatialLM WSL Keepalive`
scheduled task. It keeps only `Ubuntu-24.04` active under the low-privilege
`spatiallm` Linux account; it does not change the global WSL idle timeout.

## Operations

Opening `http://localhost:8002/` in a browser returns service status and links
to the health check, interactive API documentation, and prediction endpoint.

```bash
sudo systemctl status spatiallm-engine.service
sudo journalctl -u spatiallm-engine.service -f
sudo systemctl restart spatiallm-engine.service
curl http://localhost:8002/healthz
curl -F "file=@/opt/smart-floor-planner/spatiallm/testdata/pcd/scene0000_00.ply" \
  http://localhost:8002/api/v1/predict3d
```

The health response must report `mode: real`, the configured model, and
`device: cuda`. A successful Mock response is not evidence of GPU inference.

## API contract

`POST /api/v1/predict3d` accepts one `.ply` multipart file in the `file` field.
The default upload limit is 512 MB. The service handles one GPU inference at a
time and returns `units: millimetres` with `layout.walls`, `layout.openings`,
and `layout.objects`. Input must be axis-aligned with Z as the up axis, matching
the upstream model contract.

## Limits and security

- SpatialLM output is probabilistic and is not a formal survey graph. Validate
  topology, units, wall/opening relationships, and tenant ownership in Node
  before persistence.
- The API currently has no authentication or TLS. Bind it only to a trusted
  private network or place it behind an authenticated reverse proxy.
- The upstream SpatialLM 1.1 weights use CC-BY-NC-4.0. Commercial deployment
  requires authorization from the model rights holder.
- GPU startup and first model download can take several minutes. Service
  readiness is represented only by `/healthz` returning `status: ok`.
