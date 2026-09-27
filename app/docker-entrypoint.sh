#!/bin/sh
set -e

echo "[entrypoint] Applying database schema (prisma db push)..."
# Retry a few times in case the database is still starting up.
n=0
until [ "$n" -ge 5 ]; do
  if npx prisma db push --skip-generate --accept-data-loss; then
    echo "[entrypoint] Schema applied."
    break
  fi
  n=$((n + 1))
  echo "[entrypoint] Database not ready yet (attempt $n/5), retrying in 5s..."
  sleep 5
done

if [ "$n" -ge 5 ]; then
  echo "[entrypoint] WARNING: could not apply schema after 5 attempts; starting anyway."
fi

echo "[entrypoint] Starting ShelfAlert server..."
exec npx tsx server.ts
