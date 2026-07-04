#!/bin/sh
# Zero-downtime migration wrapper for StockWise
# Runs as an init container or pre-deploy hook

set -e

echo "[migrate] Running Prisma migrations..."
npx prisma migrate deploy

echo "[migrate] Verifying schema..."
npx prisma validate

echo "[migrate] Done."
