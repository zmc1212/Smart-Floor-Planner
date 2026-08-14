#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
IMAGE_NAME="zmc1212/sfp-admin:latest"
compose=(env -u COMPOSE_FILE docker compose --env-file "$SCRIPT_DIR/.env.production" --project-directory "$SCRIPT_DIR" -f "$COMPOSE_FILE")

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Deployment Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/.env.production" ]; then
  echo "Production environment file not found: $SCRIPT_DIR/.env.production" >&2
  echo "Create it from .env.example and configure production secrets before deploying." >&2
  exit 1
fi

if [ ! -d "$SCRIPT_DIR/drizzle" ]; then
  echo "Drizzle migration directory not found: $SCRIPT_DIR/drizzle" >&2
  echo "Upload the complete release package; deploy.sh requires ./drizzle for migrations." >&2
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/docker/postgres/init/001-roles.sql" ]; then
  echo "PostgreSQL role initialization file not found: $SCRIPT_DIR/docker/postgres/init/001-roles.sql" >&2
  echo "Upload the complete release package; deploy.sh requires this file before migrations." >&2
  exit 1
fi

echo "Validating deployment Compose services..."
if ! compose_services="$("${compose[@]}" config --services)"; then
  echo "Docker Compose could not parse: $COMPOSE_FILE" >&2
  exit 1
fi

echo "$compose_services"
if ! grep -Fxq postgres <<<"$compose_services"; then
  echo "The deployment Compose file does not define the required postgres service: $COMPOSE_FILE" >&2
  exit 1
fi

cd "$SCRIPT_DIR"

if [ -f "sfp-admin.tar" ]; then
  if [ -f "SHA256SUMS" ]; then
    echo "Verifying sfp-admin.tar checksum..."
    tr -d '\r' < SHA256SUMS | grep -E '^[0-9a-fA-F]{64}  sfp-admin\.tar$' | sha256sum -c -
  fi
  echo "Loading the local sfp-admin.tar image..."
  docker load < sfp-admin.tar
else
  echo "Pulling the latest zmc1212/sfp-admin image..."
  "${compose[@]}" pull admin
fi

echo "Verifying the imported admin image..."
if ! docker run --rm --entrypoint sh "$IMAGE_NAME" -c 'test -f /app/scripts/postgres-migrate.mjs'; then
  echo "The loaded admin image is missing /app/scripts/postgres-migrate.mjs." >&2
  echo "Create a new release package and replace sfp-admin.tar before deploying." >&2
  exit 1
fi

echo "Starting PostgreSQL..."
"${compose[@]}" up -d postgres

echo "Waiting for PostgreSQL..."
until "${compose[@]}" exec -T postgres pg_isready -U sfp_owner -d smart_floor_planner >/dev/null; do
  sleep 2
done

echo "Ensuring PostgreSQL application roles exist..."
"${compose[@]}" exec -T postgres psql -v ON_ERROR_STOP=1 -U sfp_owner -d smart_floor_planner \
  < "$SCRIPT_DIR/docker/postgres/init/001-roles.sql"

echo "Applying PostgreSQL migrations..."
"${compose[@]}" --profile migration run --rm migrate

echo "Starting the admin service..."
"${compose[@]}" up -d admin

echo "Waiting for the admin health endpoint..."
until "${compose[@]}" exec -T admin node -e '
  fetch("http://127.0.0.1:3005/api/health")
    .then((response) => {
      if (!response.ok) process.exit(1);
    })
    .catch(() => process.exit(1));
' >/dev/null; do
  sleep 2
done

echo "Creating the initial administrator when needed..."
"${compose[@]}" exec -T admin node -e '
  fetch("http://127.0.0.1:3005/api/internal/seed", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_SECRET,
    },
  })
    .then(async (response) => {
      const body = await response.text();
      if (body) process.stdout.write(body);
      if (!response.ok) process.exit(1);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
'

echo "Deployment completed."
