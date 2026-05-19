import { Redis } from "@upstash/redis";
// ioredis v5 ships an odd default export shape under NodeNext + esModuleInterop.
// Both forms exist at runtime; cast the import to the constructor type explicitly.
import IORedisImport from "ioredis";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IORedis = IORedisImport as unknown as new (url: string, opts?: Record<string, unknown>) => any;
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export const redis = new Redis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

const DASHBOARD_CHANNEL = "dashboard:invalidate";
const DASHBOARD_KEY = "dashboard:data";
const SETTINGS_CHANNEL = "settings:invalidate";

export async function invalidateDashboard() {
  try {
    await redis.del(DASHBOARD_KEY);
    await pubClient.publish(DASHBOARD_CHANNEL, "invalidate");
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : err }, "dashboard cache invalidation skipped");
  }
}

// Broadcasts a settings-cache bust to every API instance. The local cache is
// cleared via the subscriber on each instance (including this one).
export async function publishSettingsInvalidation() {
  try {
    await pubClient.publish(SETTINGS_CHANNEL, "invalidate");
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : err },
      "settings pub/sub invalidation skipped (other instances may serve stale settings for up to TTL)",
    );
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
pubClient.on("error", (err: Error) => {
  logger.debug({ err: err.message }, "redis pub error (ignored)");
});
subClient.on("error", (err: Error) => {
  logger.debug({ err: err.message }, "redis sub error (ignored)");
});

export async function startDashboardSubscriber() {
  try {
    await subClient.connect();
    await pubClient.connect();
    await subClient.subscribe(DASHBOARD_CHANNEL, SETTINGS_CHANNEL);
    subClient.on("message", async (channel: string) => {
      if (channel === DASHBOARD_CHANNEL) {
        await redis.del(DASHBOARD_KEY);
      } else if (channel === SETTINGS_CHANNEL) {
        const { invalidateSettings } = await import("./settings.js");
        invalidateSettings();
      }
    });
    logger.info("Dashboard + settings pub/sub subscriber started");
  } catch (err) {
    logger.warn(
      { err },
      "Could not start Redis pub/sub (dashboard and settings caches will still work via TTL)",
    );
  }
}

export const dashboardKey = DASHBOARD_KEY;
