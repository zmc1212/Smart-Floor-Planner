#!/usr/bin/env bash

set -euo pipefail

compose=(docker compose)

if [ -f "sfp-admin.tar" ]; then
  echo "Loading the local sfp-admin.tar image..."
  docker load < sfp-admin.tar
else
  echo "Pulling the latest zmc1212/sfp-admin image..."
  "${compose[@]}" pull admin
fi

echo "Starting PostgreSQL..."
"${compose[@]}" up -d postgres

echo "Waiting for PostgreSQL..."
until "${compose[@]}" exec -T postgres pg_isready -U sfp_owner -d smart_floor_planner >/dev/null; do
  sleep 2
done

echo "Applying PostgreSQL migrations..."
"${compose[@]}" --profile migration run --rm migrate

echo "Starting the admin service..."
"${compose[@]}" up -d admin

echo "Waiting for the admin health endpoint..."
until "${compose[@]}" exec -T admin curl -fsS http://127.0.0.1:3005/api/health >/dev/null; do
  sleep 2
done

echo "Creating the initial administrator when needed..."
"${compose[@]}" exec -T admin sh -c \
  'curl -fsS -X POST -H "Content-Type: application/json" -H "x-internal-secret: $INTERNAL_SECRET" http://127.0.0.1:3005/api/internal/seed'

echo "Deployment completed."
