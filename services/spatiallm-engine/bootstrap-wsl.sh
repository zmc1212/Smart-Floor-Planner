#!/usr/bin/env bash
set -euo pipefail

OFFICIAL_COMMIT="8913c44d84a450c53e9340b13317f8cf7144a738"
MODEL_ID="${SPATIALLM_MODEL_PATH:-manycore-research/SpatialLM1.1-Qwen-0.5B}"
INSTALL_ROOT="${SPATIALLM_INSTALL_ROOT:-/opt/smart-floor-planner/spatiallm}"
MINICONDA_DIR="$INSTALL_ROOT/miniconda3"
ENV_DIR="$INSTALL_ROOT/env"
SOURCE_DIR="$INSTALL_ROOT/source"
HF_HOME="$INSTALL_ROOT/huggingface"
HF_ENDPOINT="${HF_ENDPOINT:-https://huggingface.co}"
SERVICE_USER="spatiallm"
SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "$EUID" -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

apt-get update
apt-get install -y build-essential curl git libsparsehash-dev ninja-build
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$SERVICE_USER"
fi
mkdir -p "$INSTALL_ROOT"

if [[ ! -x "$MINICONDA_DIR/bin/conda" ]]; then
  installer="$INSTALL_ROOT/miniconda.sh"
  curl -fL \
    https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh \
    -o "$installer"
  bash "$installer" -b -p "$MINICONDA_DIR"
  rm -f "$installer"
fi

source "$MINICONDA_DIR/etc/profile.d/conda.sh"
if [[ ! -x "$ENV_DIR/bin/python" ]]; then
  conda create -y -p "$ENV_DIR" --override-channels -c conda-forge python=3.11
fi
conda activate "$ENV_DIR"
conda install -y -p "$ENV_DIR" --override-channels \
  -c nvidia/label/cuda-12.4.0 -c conda-forge cuda-toolkit sparsehash

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  git clone https://github.com/manycore-research/SpatialLM.git "$SOURCE_DIR"
fi
if ! git -C "$SOURCE_DIR" cat-file -e "$OFFICIAL_COMMIT^{commit}" 2>/dev/null; then
  git -C "$SOURCE_DIR" fetch --depth 1 origin "$OFFICIAL_COMMIT"
fi
git -C "$SOURCE_DIR" checkout --detach "$OFFICIAL_COMMIT"

python -m pip install --upgrade pip
python -m pip install poetry
(
  cd "$SOURCE_DIR"
  poetry config virtualenvs.create false --local
  poetry install
  python -m pip install psutil
  FLASH_ATTENTION_FORCE_BUILD=TRUE \
    FLASH_ATTN_CUDA_ARCHS="${FLASH_ATTN_CUDA_ARCHS:-80}" \
    MAX_JOBS="${MAX_JOBS:-4}" \
    poetry run poe install-sonata
)
python -m pip install -r "$SERVICE_DIR/requirements.txt"

mkdir -p "$HF_HOME"
chown -R "$SERVICE_USER:$SERVICE_USER" "$HF_HOME"
runuser -u "$SERVICE_USER" -- env HF_HOME="$HF_HOME" HF_ENDPOINT="$HF_ENDPOINT" \
  "$ENV_DIR/bin/hf" download "$MODEL_ID"
mkdir -p "$INSTALL_ROOT/testdata"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_ROOT/testdata"
runuser -u "$SERVICE_USER" -- env HF_HOME="$HF_HOME" HF_ENDPOINT="$HF_ENDPOINT" \
  "$ENV_DIR/bin/hf" download \
  manycore-research/SpatialLM-Testset pcd/scene0000_00.ply \
  --repo-type dataset --local-dir "$INSTALL_ROOT/testdata"

if [[ ! -f "$SERVICE_DIR/.env" ]]; then
  cp "$SERVICE_DIR/.env.example" "$SERVICE_DIR/.env"
fi

cat >"/etc/systemd/system/spatiallm-engine.service" <<EOF
[Unit]
Description=Smart Floor Planner SpatialLM engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SERVICE_DIR
EnvironmentFile=$SERVICE_DIR/.env
Environment=PYTHONPATH=$SOURCE_DIR
Environment=HF_HOME=$HF_HOME
ExecStart=$ENV_DIR/bin/python main.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl daemon-reload
systemctl enable --now spatiallm-engine.service

for _ in {1..120}; do
  if curl -fsS http://localhost:8002/healthz >/dev/null; then
    curl -fsS http://localhost:8002/healthz
    printf '\nSpatialLM engine is ready.\n'
    exit 0
  fi
  sleep 5
done

systemctl status spatiallm-engine.service --no-pager || true
journalctl -u spatiallm-engine.service -n 100 --no-pager || true
echo "SpatialLM did not become healthy within 10 minutes." >&2
exit 1
