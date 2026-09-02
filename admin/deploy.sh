#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

MODE="${1:-deploy}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
VERSION_FILE="$SCRIPT_DIR/VERSION"
IMAGE_FILE="$SCRIPT_DIR/IMAGE_NAME"
DEPLOY_ROOT="${SFP_DEPLOY_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ENV_FILE="${SFP_RUNTIME_ENV_FILE:-$DEPLOY_ROOT/.env.production}"
COMPOSE_PROJECT="${SFP_COMPOSE_PROJECT:-smart-floor-planner}"
BACKUP_DIR="${SFP_BACKUP_DIR:-$DEPLOY_ROOT/backups/postgresql}"
HEALTH_TIMEOUT_SECONDS="${SFP_HEALTH_TIMEOUT_SECONDS:-120}"
WORKER_TIMEOUT_SECONDS="${SFP_WORKER_TIMEOUT_SECONDS:-90}"

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

for command in docker sha256sum grep sed tr wc date; do
  command -v "$command" >/dev/null 2>&1 || fail "Required command is missing: $command"
done

[[ "$MODE" == "deploy" || "$MODE" == "rollback" ]] || fail "Unsupported mode: $MODE"
[[ -f "$COMPOSE_FILE" ]] || fail "Compose file not found: $COMPOSE_FILE"
[[ -f "$VERSION_FILE" ]] || fail "VERSION file not found: $VERSION_FILE"
[[ -f "$IMAGE_FILE" ]] || fail "IMAGE_NAME file not found: $IMAGE_FILE"
[[ -f "$ENV_FILE" ]] || fail "Server runtime environment file not found: $ENV_FILE"
[[ -d "$SCRIPT_DIR/drizzle" ]] || fail "Drizzle migration directory not found"
[[ -f "$SCRIPT_DIR/drizzle/meta/_journal.json" ]] || fail "Drizzle journal not found"
[[ -f "$SCRIPT_DIR/docker/postgres/init/001-roles.sql" ]] || fail "PostgreSQL role initialization file not found"
[[ -f "$SCRIPT_DIR/SHA256SUMS" ]] || fail "SHA256SUMS not found"
[[ -f "$SCRIPT_DIR/DRIZZLE_SHA256SUMS" ]] || fail "DRIZZLE_SHA256SUMS not found"
[[ -f "$SCRIPT_DIR/sfp-admin.tar" ]] || fail "Offline Docker image not found"

VERSION="$(tr -d '\r\n' < "$VERSION_FILE")"
PACKAGE_IMAGE_NAME="$(tr -d '\r\n' < "$IMAGE_FILE")"
[[ "$VERSION" =~ ^[0-9]{8}-[0-9]{3}$ ]] || fail "Invalid release version: $VERSION"
[[ "$PACKAGE_IMAGE_NAME" == "zmc1212/sfp-admin:$VERSION" ]] || fail "Image/version mismatch: $PACKAGE_IMAGE_NAME"
IMAGE_NAME="${SFP_TARGET_IMAGE:-$PACKAGE_IMAGE_NAME}"
if [[ "$IMAGE_NAME" != "$PACKAGE_IMAGE_NAME" && "$MODE" != "rollback" ]]; then
  fail 'SFP_TARGET_IMAGE is allowed only in rollback mode'
fi

export SFP_ADMIN_IMAGE="$IMAGE_NAME"
export SFP_RUNTIME_ENV_FILE="$ENV_FILE"
compose=(
  env -u COMPOSE_FILE docker compose
  --project-name "$COMPOSE_PROJECT"
  --env-file "$ENV_FILE"
  --project-directory "$SCRIPT_DIR"
  -f "$COMPOSE_FILE"
)

echo "[1/9] Verifying release checksums..."
(
  cd "$SCRIPT_DIR"
  sha256sum -c SHA256SUMS
  sha256sum -c DRIZZLE_SHA256SUMS
)

echo "[2/9] Validating Compose and migration inputs..."
compose_services="$("${compose[@]}" --profile migration config --services)"
for service in postgres migrate admin lead-claim-worker; do
  grep -Fxq "$service" <<<"$compose_services" || fail "Compose service is missing: $service"
done
"${compose[@]}" config >/dev/null
if ! find "$SCRIPT_DIR/drizzle" -maxdepth 1 -type f -name '*.sql' -print -quit | grep -q .; then
  fail "No SQL migration is present in the release"
fi

echo "[3/9] Loading and inspecting $IMAGE_NAME..."
if [[ "$IMAGE_NAME" == "$PACKAGE_IMAGE_NAME" ]]; then
  docker load < "$SCRIPT_DIR/sfp-admin.tar"
  docker image inspect "$IMAGE_NAME" >/dev/null
  image_label="$(docker image inspect "$IMAGE_NAME" --format '{{ index .Config.Labels "org.opencontainers.image.version" }}')"
  [[ "$image_label" == "$VERSION" ]] || fail "Loaded image label mismatch: expected $VERSION, got $image_label"
else
  docker image inspect "$IMAGE_NAME" >/dev/null || fail "Rollback image is not available locally: $IMAGE_NAME"
fi
docker run --rm --entrypoint sh "$IMAGE_NAME" -c 'test -f /app/scripts/postgres-migrate.mjs'

echo 'Validating production runtime safety settings before touching PostgreSQL...'
"${compose[@]}" run --rm --no-deps --entrypoint node admin -e '
  const errors = [];
  const requiredSecret = (name, length = 32) => {
    const value = process.env[name]?.trim() || "";
    if (value.length < length) errors.push(`${name} must contain at least ${length} characters`);
  };
  requiredSecret("JWT_SECRET");
  requiredSecret("INTERNAL_SECRET");
  requiredSecret("CRON_SECRET");
  requiredSecret("MEDIA_STORAGE_KEY_ENCRYPTION_SECRET");
  if (process.env.AUTH_COOKIE_SECURE !== "true") errors.push("AUTH_COOKIE_SECURE must be true");
  if (process.env.ALLOW_TENANT_ENTERPRISE_RESET === "true") errors.push("ALLOW_TENANT_ENTERPRISE_RESET must be false");
  if (!process.env.DEPLOY_SMOKE_USERNAME?.trim()) errors.push("DEPLOY_SMOKE_USERNAME is required");
  if (!process.env.DEPLOY_SMOKE_PASSWORD || process.env.DEPLOY_SMOKE_PASSWORD.length < 12) {
    errors.push("DEPLOY_SMOKE_PASSWORD must contain at least 12 characters");
  }
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("Production runtime safety settings passed");
'

previous_image=""
if docker container inspect smart-floor-planner-admin >/dev/null 2>&1; then
  previous_image="$(docker container inspect smart-floor-planner-admin --format '{{.Config.Image}}')"
fi

wait_for_postgres() {
  local elapsed=0
  until "${compose[@]}" exec -T postgres pg_isready -U sfp_owner -d smart_floor_planner >/dev/null 2>&1; do
    (( elapsed >= 60 )) && return 1
    sleep 2
    elapsed=$((elapsed + 2))
  done
}

wait_for_admin_health() {
  local elapsed=0
  until "${compose[@]}" exec -T admin node -e '
    fetch("http://127.0.0.1:3005/api/health")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.status !== "ok") process.exit(1);
      })
      .catch(() => process.exit(1));
  ' >/dev/null 2>&1; do
    (( elapsed >= HEALTH_TIMEOUT_SECONDS )) && return 1
    sleep 2
    elapsed=$((elapsed + 2))
  done
}

wait_for_worker_health() {
  local container_id status elapsed=0
  container_id="$("${compose[@]}" ps -q lead-claim-worker)"
  [[ -n "$container_id" ]] || return 1
  until [[ "$elapsed" -ge "$WORKER_TIMEOUT_SECONDS" ]]; do
    status="$(docker inspect "$container_id" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && return 0
    [[ "$status" == "exited" || "$status" == "dead" ]] && return 1
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

run_authenticated_smoke() {
  "${compose[@]}" exec -T admin node - <<'NODE'
const username = process.env.DEPLOY_SMOKE_USERNAME?.trim();
const password = process.env.DEPLOY_SMOKE_PASSWORD;
if (!username || !password) {
  console.error('DEPLOY_SMOKE_USERNAME and DEPLOY_SMOKE_PASSWORD are required');
  process.exit(1);
}

const base = 'http://127.0.0.1:3005';
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
const loginBody = await login.json().catch(() => ({}));
if (!login.ok || !loginBody.success) {
  console.error(`Authenticated login smoke failed: ${login.status}`);
  process.exit(1);
}
const rawCookie = login.headers.get('set-cookie') || '';
const cookie = rawCookie.split(';', 1)[0];
if (!cookie.startsWith('auth_token=')) {
  console.error('Authenticated login smoke did not receive auth_token');
  process.exit(1);
}

const paths = ['/api/auth/me', ...(process.env.DEPLOY_SMOKE_PATHS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)];
for (const path of [...new Set(paths)]) {
  if (!path.startsWith('/api/') || path.includes('..')) {
    console.error(`Unsafe DEPLOY_SMOKE_PATHS entry: ${path}`);
    process.exit(1);
  }
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  if (!response.ok) {
    console.error(`Authenticated smoke failed for ${path}: ${response.status}`);
    process.exit(1);
  }
}
await fetch(`${base}/api/auth/logout`, { headers: { cookie }, redirect: 'manual' });
console.log(JSON.stringify({ success: true, authenticatedPaths: [...new Set(paths)] }));
NODE
}

start_and_verify_application() {
  local target_image="$1"
  export SFP_ADMIN_IMAGE="$target_image"
  "${compose[@]}" up -d --force-recreate admin lead-claim-worker
  wait_for_admin_health || return 1
  wait_for_worker_health || return 1
  run_authenticated_smoke || return 1
}

echo "[4/9] Starting and checking PostgreSQL..."
"${compose[@]}" up -d postgres
wait_for_postgres || fail "PostgreSQL did not become ready within 60 seconds"

if [[ "$MODE" == "deploy" ]]; then
  echo "[5/9] Creating a verified pre-migration PostgreSQL backup..."
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  backup_timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
  backup_name="smart_floor_planner-${backup_timestamp}-pre-${VERSION}.dump"
  backup_path="$BACKUP_DIR/$backup_name"
  backup_partial="$BACKUP_DIR/.${backup_name}.partial"
  rm -f -- "$backup_partial"
  if ! "${compose[@]}" exec -T postgres pg_dump \
    -U sfp_owner \
    -d smart_floor_planner \
    --format=custom \
    --no-owner \
    --no-privileges > "$backup_partial"; then
    rm -f -- "$backup_partial"
    fail "PostgreSQL backup failed"
  fi
  backup_bytes="$(wc -c < "$backup_partial" | tr -d ' ')"
  [[ "$backup_bytes" -gt 0 ]] || fail "PostgreSQL backup is empty"
  if ! "${compose[@]}" exec -T postgres pg_restore --list < "$backup_partial" >/dev/null; then
    rm -f -- "$backup_partial"
    fail "PostgreSQL backup catalog validation failed"
  fi
  mv -- "$backup_partial" "$backup_path"
  (
    cd "$BACKUP_DIR"
    sha256sum "$backup_name" > "$backup_name.sha256"
  )
  echo "Backup: $backup_path ($backup_bytes bytes)"
  cat "$backup_path.sha256"

  echo "[6/9] Ensuring application roles exist..."
  "${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U sfp_owner -d smart_floor_planner \
    < "$SCRIPT_DIR/docker/postgres/init/001-roles.sql"

  echo "[7/9] Applying PostgreSQL migrations..."
  export SFP_ADMIN_IMAGE="$PACKAGE_IMAGE_NAME"
  "${compose[@]}" --profile migration run --rm migrate
else
  echo '[5/9] Rollback mode: database backup is not repeated.'
  echo '[6/9] Rollback mode: role initialization is skipped.'
  echo '[7/9] Rollback mode: database migrations are never reversed or rerun.'
fi

echo "[8/9] Starting application image $IMAGE_NAME..."
if ! start_and_verify_application "$IMAGE_NAME"; then
  echo "[ERROR] New application verification failed." >&2
  if [[ "$MODE" == "deploy" && -n "$previous_image" && "$previous_image" != "$IMAGE_NAME" ]]; then
    echo "[ROLLBACK] Restoring previous application image: $previous_image" >&2
    if start_and_verify_application "$previous_image"; then
      echo '[ROLLBACK] Previous application image is healthy. Database migrations were not reversed.' >&2
    else
      echo '[ROLLBACK] Previous application image also failed verification; manual recovery is required.' >&2
    fi
  else
    "${compose[@]}" stop admin lead-claim-worker >/dev/null 2>&1 || true
  fi
  exit 1
fi

echo '[9/9] Deployment verification completed.'
echo "Version: $VERSION"
echo "Image: $IMAGE_NAME"
echo "Compose project: $COMPOSE_PROJECT"
echo "Runtime environment: $ENV_FILE"
echo 'Health, worker health, authenticated login, and configured core API smoke checks passed.'
