#!/bin/sh
# Integration test runner — starts Postgres + Redis via Docker, runs full test suite
# Usage: ./tests/integration/docker-test.sh
# Requires: Docker

set -e

echo "=== StockWise Integration Test Runner ==="

# Define cleanup function and trap it on exit
cleanup() {
  echo "[teardown] Stopping services..."
  docker compose down
}
trap cleanup EXIT

# Start test infrastructure
echo "[setup] Starting Postgres and Redis..."
docker compose -f docker-compose.yml up -d stockwise-db stockwise-redis 2>&1

echo "[setup] Waiting for services to be healthy..."
TIMEOUT=30
ELAPSED=0

until docker compose exec -T stockwise-db pg_isready -U postgres 2>/dev/null; do
  ELAPSED=$((ELAPSED + 1))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "[setup] Timeout waiting for Postgres"
    exit 1
  fi
  sleep 1
done

until docker compose exec -T stockwise-redis redis-cli ping 2>/dev/null | grep -q PONG; do
  ELAPSED=$((ELAPSED + 1))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "[setup] Timeout waiting for Redis"
    exit 1
  fi
  sleep 1
done

# Create test database if not exists
echo "[setup] Creating test database..."
docker compose exec -T stockwise-db psql -U postgres -c "SELECT 1 FROM pg_database WHERE datname = 'stockwise_test'" | grep -q 1 || \
docker compose exec -T stockwise-db psql -U postgres -c "CREATE DATABASE stockwise_test"

echo "[setup] Running Prisma migrations..."
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/stockwise_test?schema=public" npx prisma migrate deploy

echo "[test] Running test suite..."
npm run test:all
