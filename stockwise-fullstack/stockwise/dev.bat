@echo off
docker compose up -d stockwise-db stockwise-redis stockwise-pgbouncer
npx tsx watch server.ts
