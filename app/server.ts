import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";

/**
 * Custom Next.js server for ShelfAlert.
 *
 * Responsibilities beyond serving the app:
 *   1. Bootstrap the initial admin user + default settings (idempotent).
 *   2. Start the background cron scheduler that syncs releases.
 *
 * Run with `tsx server.ts` (see package.json / Dockerfile).
 */

const dev = process.env.NODE_ENV !== "production";
// Bind to all interfaces by default. Note: we deliberately do NOT use $HOSTNAME
// (Docker sets it to the container id, which is not a reliable bind address).
const hostname = process.env.SERVER_HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function bootstrap(): Promise<void> {
  // Imported lazily so Next's module resolution / env is ready first.
  try {
    const { ensureBootstrap } = await import("./src/lib/auth");
    await ensureBootstrap();
  } catch (err) {
    console.error("[server] Bootstrap failed:", (err as Error).message);
  }

  try {
    const { startScheduler } = await import("./src/lib/scheduler");
    await startScheduler();
  } catch (err) {
    console.error("[server] Scheduler failed to start:", (err as Error).message);
  }
}

app
  .prepare()
  .then(async () => {
    createServer((req, res) => {
      try {
        const parsedUrl = parse(req.url || "/", true);
        void handle(req, res, parsedUrl);
      } catch (err) {
        console.error("[server] Error handling request:", err);
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }).listen(port, hostname, () => {
      console.log(`> ShelfAlert ready on http://${hostname}:${port} (dev=${dev})`);
    });

    // Kick off bootstrap + scheduler after the server is listening.
    await bootstrap();
  })
  .catch((err) => {
    console.error("[server] Failed to start Next.js:", err);
    process.exit(1);
  });

function shutdown(signal: string): void {
  console.log(`[server] Received ${signal}, shutting down...`);
  void import("./src/lib/scheduler")
    .then(({ stopScheduler }) => stopScheduler())
    .finally(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
