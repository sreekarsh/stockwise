# Integration test runner for Windows — starts Postgres + Redis via Docker, runs tests
# Requires: Docker Desktop

Write-Host "=== StockWise Integration Test Runner (PowerShell) ===" -ForegroundColor Cyan

Write-Host "[setup] Starting Postgres and Redis..." -ForegroundColor Yellow
docker compose -f docker-compose.yml up -d stockwise-db stockwise-redis 2>&1

Write-Host "[setup] Waiting for Postgres..."
$timeout = 30
$elapsed = 0
do {
  $result = docker compose exec -T stockwise-db pg_isready -U postgres 2>&1
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
  $elapsed++
  if ($elapsed -ge $timeout) {
    Write-Host "[setup] Timeout waiting for Postgres" -ForegroundColor Red
    docker compose down
    exit 1
  }
} while ($true)

Write-Host "[setup] Waiting for Redis..."
do {
  $result = docker compose exec -T stockwise-redis redis-cli ping 2>&1
  if ($result -match "PONG") { break }
  Start-Sleep -Seconds 1
  $elapsed++
  if ($elapsed -ge $timeout) {
    Write-Host "[setup] Timeout waiting for Redis" -ForegroundColor Red
    docker compose down
    exit 1
  }
} while ($true)

Write-Host "[setup] Creating test database..." -ForegroundColor Yellow
docker compose exec -T stockwise-db psql -U postgres -c "CREATE DATABASE stockwise_test" 2>$null

Write-Host "[setup] Running Prisma migrations..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/stockwise_test?schema=public"
npx prisma migrate deploy
Remove-Item env:DATABASE_URL -ErrorAction SilentlyContinue

Write-Host "[test] Running test suite..." -ForegroundColor Green
npm run test:all
$EXIT_CODE = $LASTEXITCODE

Write-Host "[teardown] Stopping services..." -ForegroundColor Yellow
docker compose down

if ($EXIT_CODE -ne 0) { Write-Host "FAILED (exit $EXIT_CODE)" -ForegroundColor Red; exit $EXIT_CODE }
Write-Host "PASSED" -ForegroundColor Green
