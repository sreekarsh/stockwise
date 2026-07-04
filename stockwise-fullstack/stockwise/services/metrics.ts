import promClient from "prom-client";
import prisma from "./db.js";
import { redisClient } from "./redis.js";

const register = new promClient.Registry();

promClient.collectDefaultMetrics({
  register,
  prefix: "stockwise_",
});

const httpRequestDuration = new promClient.Histogram({
  name: "stockwise_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
register.registerMetric(httpRequestDuration);

const dbPoolSize = new promClient.Gauge({
  name: "stockwise_db_pool_size",
  help: "Current Prisma connection pool size",
});
register.registerMetric(dbPoolSize);

const redisConnected = new promClient.Gauge({
  name: "stockwise_redis_connected",
  help: "1 if Redis is connected, 0 otherwise",
});
register.registerMetric(redisConnected);

const eventLoopLag = new promClient.Gauge({
  name: "stockwise_event_loop_lag_ms",
  help: "Event loop lag in milliseconds",
});
register.registerMetric(eventLoopLag);

const activeConnections = new promClient.Gauge({
  name: "stockwise_active_connections",
  help: "Number of active HTTP connections",
});
register.registerMetric(activeConnections);

const botTradesTotal = new promClient.Counter({
  name: "stockwise_bot_trades_total",
  help: "Total number of bot trades executed",
  labelNames: ["type", "symbol"],
});
register.registerMetric(botTradesTotal);

const botErrorsTotal = new promClient.Counter({
  name: "stockwise_bot_errors_total",
  help: "Total number of bot evaluation errors",
  labelNames: ["error_type"],
});
register.registerMetric(botErrorsTotal);

const botLoopIterations = new promClient.Counter({
  name: "stockwise_bot_loop_iterations_total",
  help: "Total number of bot loop iterations",
});
register.registerMetric(botLoopIterations);

const botLoopOverlaps = new promClient.Counter({
  name: "stockwise_bot_loop_overlaps_total",
  help: "Total number of skipped bot loop cycles due to overlap",
});
register.registerMetric(botLoopOverlaps);

function startEventLoopMonitor() {
  let last = process.hrtime.bigint();
  setInterval(() => {
    const now = process.hrtime.bigint();
    const lag = Number(now - last) / 1e6;
    eventLoopLag.set(lag);
    last = now;
  }, 1000).unref();
}

async function collectDbMetrics() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbPoolSize.set(1);
  } catch {
    dbPoolSize.set(0);
  }
}

async function collectRedisMetrics() {
  redisConnected.set(redisClient?.isReady ? 1 : 0);
}

function trackRequest(method: string, route: string, statusCode: number, durationMs: number) {
  httpRequestDuration
    .labels(method, route, String(statusCode))
    .observe(durationMs / 1000);
}

function trackConnection(delta: 1 | -1) {
  activeConnections.inc(delta);
}

async function getMetrics() {
  await Promise.all([collectDbMetrics(), collectRedisMetrics()]);
  return register.metrics();
}

function trackBotTrade(type: string, symbol: string) {
  botTradesTotal.labels(type, symbol).inc();
}

function trackBotError(errorType: string) {
  botErrorsTotal.labels(errorType).inc();
}

function trackBotLoop() {
  botLoopIterations.inc();
}

function trackBotOverlap() {
  botLoopOverlaps.inc();
}

export {
  register,
  startEventLoopMonitor,
  trackRequest,
  trackConnection,
  trackBotTrade,
  trackBotError,
  trackBotLoop,
  trackBotOverlap,
  getMetrics,
};
