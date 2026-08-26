#!/usr/bin/env bash
# Place this script next to sfp-admin-release.zip (for example /datas/smartfloor).
# After each ZIP upload, run: chmod +x auto_deploy.sh && ./auto_deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP_FILE="$SCRIPT_DIR/sfp-admin-release.zip"
RELEASE_DIR="$SCRIPT_DIR/sfp-admin-release"
DEPLOY_SH="$RELEASE_DIR/deploy.sh"

# Info-ZIP unzip honors this even if a later unzip invocation forgets -o.
export UNZIP="-o"

cd "$SCRIPT_DIR"

if [[ ! -f "$ZIP_FILE" ]]; then
  echo "[ERROR] 未找到发布包: $ZIP_FILE" >&2
  echo "请先把 sfp-admin-release.zip 上传到本目录后再执行本脚本。" >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "[ERROR] 服务器未安装 unzip。" >&2
  echo "请先安装后再重试，例如: yum install -y unzip  或  apt-get install -y unzip" >&2
  exit 1
fi

zip_size="$(wc -c < "$ZIP_FILE" | tr -d ' ')"
echo "[1/3] 解压 sfp-admin-release.zip（自动覆盖已有文件，${zip_size} bytes）..."
# Info-ZIP returns 1 when extraction succeeded with warnings. Windows
# Compress-Archive writes backslash path separators, which triggers that
# warning and must not abort chmod / deploy.sh.
unzip_rc=0
unzip -o "$ZIP_FILE" || unzip_rc=$?
if (( unzip_rc > 1 )); then
  echo "[ERROR] 解压失败，unzip 退出码: ${unzip_rc}" >&2
  exit "$unzip_rc"
fi
if (( unzip_rc == 1 )); then
  echo "[INFO] unzip 警告已忽略（Windows ZIP 反斜杠路径），解压已完成，继续部署。"
fi

if [[ ! -f "$DEPLOY_SH" ]]; then
  echo "[ERROR] 解压后未找到 deploy.sh: $DEPLOY_SH" >&2
  echo "请确认 ZIP 是由 admin/release.bat 生成的 sfp-admin-release.zip。" >&2
  exit 1
fi

echo "[2/3] 赋予 deploy.sh 可执行权限..."
chmod +x "$DEPLOY_SH"

echo "[3/3] 开始执行 deploy.sh..."
cd "$RELEASE_DIR"
exec ./deploy.sh
