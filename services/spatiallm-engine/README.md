# SpatialLM 3D Prediction Engine

Standalone FastAPI service for converting axis-aligned PLY point clouds into
structured walls, doors, windows, and objects. The API emits millimetres for
the Smart Floor Planner adapter while the upstream model works in metres.

## Modes

- `SPATIALLM_MODE=mock`: API integration without CUDA or model dependencies.
- `SPATIALLM_MODE=real`: preload SpatialLM 1.1 on CUDA and run real inference.

The default is `mock`, so production or GPU evaluation must explicitly set
`SPATIALLM_MODE=real`.

## API

- `GET /`: service readiness and links to the available endpoints.
- `GET /healthz`: process, mode, model, and device readiness.
- `POST /api/v1/predict3d`: multipart upload with a `file` field ending in
  `.ply`. Uploads are limited to 512 MB by default and GPU requests are
  serialized.

```bash
curl -F "file=@pointcloud.ply" http://localhost:8002/api/v1/predict3d
```

## RTX 4080 deployment

Use WSL 2 with Ubuntu. From this directory inside WSL:

```bash
chmod +x bootstrap-wsl.sh
./bootstrap-wsl.sh
```

When the official Hugging Face endpoint is not reachable from the deployment
network, run the same bootstrap with a download endpoint override:

```bash
HF_ENDPOINT=https://hf-mirror.com ./bootstrap-wsl.sh
```

The script installs an isolated Python 3.11/CUDA 12.4 environment, checks out
the pinned official SpatialLM source revision, installs the SpatialLM 1.1
Sonata dependencies, downloads the Qwen 0.5B model and official test PLY, and
starts the system-level `spatiallm-engine.service` under a dedicated
low-privilege account.

The bootstrap builds FlashAttention for the `sm80` target used compatibly by
the RTX 4080 and limits build parallelism for a 32 GB WSL host. The installed
service uses the completed Hugging Face cache in offline mode.

From Windows PowerShell, register the scoped login keepalive so WSL and the
systemd service remain reachable after interactive WSL terminals close:

```powershell
powershell -ExecutionPolicy Bypass -File .\register-wsl-keepalive.ps1
```

See [deployment operations](../../docs/spatiallm-4080-deployment.md).

## Development test

```bash
python -m pip install -r requirements-dev.txt
pytest -q
```

## License boundary

The upstream SpatialLM 1.1 model weights are CC-BY-NC-4.0. This deployment is
suitable for local technical evaluation, but commercial production use needs
separate authorization from the model rights holder.
