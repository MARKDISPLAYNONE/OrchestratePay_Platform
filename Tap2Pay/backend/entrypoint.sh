#!/bin/sh
set -e

echo "[entrypoint] Running database migrations..."
node dist/db/migrate.js

echo "[entrypoint] Starting OrchestratePay backend..."
exec node dist/index.js
