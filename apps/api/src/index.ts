import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env.js";
import { closeBrowser } from "./lib/pdf.js";
import { logger } from "./lib/logger.js";
import { startDashboardSubscriber } from "./lib/redis.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { loginLimiter, readLimiter, writeLimiter } from "./middleware/rateLimit.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import guestRoutes from "./routes/guests.js";
import housekeepingRoutes from "./routes/housekeeping.js";
import invoiceRoutes from "./routes/invoices.js";
import messageRoutes from "./routes/messages.js";
import notificationRoutes from "./routes/notifications.js";
import otpRoutes from "./routes/otp.js";
import paymentRoutes from "./routes/payments.js";
import reportRoutes from "./routes/reports.js";
import reservationRoutes from "./routes/reservations.js";
import roomRoutes from "./routes/rooms.js";
import { settingsRouter, staffRouter } from "./routes/settings.js";

const app = express();

app.set("trust proxy", 1);
app.set("etag", false);
app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp({ logger }));

app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

const v1 = express.Router();

v1.use("/auth/login", loginLimiter);
v1.use("/auth", authRoutes);

v1.use((req, _res, next) => {
  if (["GET", "HEAD"].includes(req.method)) return readLimiter(req, _res, next);
  return writeLimiter(req, _res, next);
});

v1.use("/rooms", roomRoutes);
v1.use("/guests", guestRoutes);
v1.use("/reservations", reservationRoutes);
v1.use("/invoices", invoiceRoutes);
v1.use("/payments", paymentRoutes);
v1.use("/housekeeping", housekeepingRoutes);
v1.use("/dashboard", dashboardRoutes);
v1.use("/reports", reportRoutes);
v1.use("/settings", settingsRouter);
v1.use("/staff", staffRouter);
v1.use("/otp", otpRoutes);
v1.use("/notifications", notificationRoutes);
v1.use("/messages", messageRoutes);

app.use("/api/v1", v1);

app.use(notFound);
app.use(errorHandler);

startDashboardSubscriber().catch((err) =>
  logger.warn({ err }, "dashboard subscriber failed to start"),
);

const server = app.listen(env.PORT, () => {
  logger.info(`HotelDesk API listening on http://localhost:${env.PORT}`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    try {
      await closeBrowser();
    } catch (err) {
      logger.warn({ err }, "browser close failed");
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
