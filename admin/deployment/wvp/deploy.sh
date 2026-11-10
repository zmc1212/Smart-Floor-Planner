#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v python3 >/dev/null || {
  echo "Python 3 is required. Install your distribution's python3 package first." >&2
  exit 1
}
exec python3 deploy.py "$@"
