import { Redis } from "@upstash/redis";
import IORedis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const DASHBOARD_CHANNEL = "dashboard:invalidate";
const DASHBOARD_KEY = "dashboard:data";

export async function invalidateDashboard() {
  try {
    await redis.del(DASHBOARD_KEY);
    await pubClient.publish(DASHBOARD_CHANNEL, "invalidate");
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err }, "dashboard cache invalidation skipped");
  }
}

const ioOpts = {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null, // disable auto-reconnect; we handle failures via try/catch
  enableOfflineQueue: false,
} as const;

export const pubClient = new IORedis(env.UPSTASH_REDIS_URL, ioOpts);
export const subClient = new IORedis(env.UPSTASH_REDIS_URL, ioOpts);

// Attach error handlers so unhandled-error spam stops; we already log via wrappers.
pubClient.on("error", (err) => {
  logger.debug({ err: err.message }, "redis pub error (ignored)");
});
subClient.on("error", (err) => {
  logger.debug({ err: err.message }, "redis sub error (ignored)");
});

export async function startDashboardSubscriber() {
  try {
    await subClient.connect();
    await pubClient.connect();
    await subClient.subscribe(DASHBOARD_CHANNEL);
    subClient.on("message", async (channel) => {
      if (channel === DASHBOARD_CHANNEL) {
        await redis.del(DASHBOARD_KEY);
      }
    });
    logger.info("Dashboard pub/sub subscriber started");
  } catch (err) {
    logger.warn({ err }, "Could not start Redis pub/sub (dashboard cache will still work via TTL)");
  }
}

export const dashboardKey = DASHBOARD_KEY;
