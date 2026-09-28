import cron, { ScheduledTask } from "node-cron";
import { prisma } from "./prisma";
import { getSettings } from "./settings";
import { runFullSync, recomputeStatuses } from "./release-sync";

/**
 * Background scheduler. Runs inside the custom Next.js server process
 * (see server.ts). It:
 *   1. On boot, runs an immediate sync if the last sync is older than the
 *      configured interval (or never happened).
 *   2. Schedules an hourly tick that triggers a full sync when enough time
 *      has elapsed since the last one (honouring syncIntervalHours).
 *   3. Recomputes release statuses hourly (UPCOMING -> RECENT/MISSING).
 */

let task: ScheduledTask | null = null;
let running = false;

async function guardedFullSync(reason: string): Promise<void> {
  if (running) {
    console.log(`[scheduler] Sync already running, skipping (${reason}).`);
    return;
  }
  running = true;
  try {
    console.log(`[scheduler] Starting full sync (${reason})...`);
    const result = await runFullSync();
    console.log(
      `[scheduler] Full sync finished: ${result.message}` +
        (result.errors.length ? ` | errors: ${result.errors.length}` : "")
    );
  } catch (err) {
    console.error("[scheduler] Full sync crashed:", (err as Error).message);
  } finally {
    running = false;
  }
}

export async function triggerManualSync(reason = "manual"): Promise<void> {
  await guardedFullSync(reason);
}

async function tick(): Promise<void> {
  try {
    await recomputeStatuses();
  } catch (err) {
    console.error("[scheduler] recomputeStatuses failed:", (err as Error).message);
  }

  const settings = await getSettings();
  const last = settings.lastReleaseSync?.getTime() ?? 0;
  const intervalMs = settings.syncIntervalHours * 3600 * 1000;
  if (Date.now() - last >= intervalMs) {
    await guardedFullSync("scheduled interval elapsed");
  }
}

export async function startScheduler(): Promise<void> {
  if (task) {
    console.log("[scheduler] Already started.");
    return;
  }

  // Wait for the DB to be reachable before scheduling.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("[scheduler] Database not reachable yet:", (err as Error).message);
  }

  // One-time migration: bump lookbackDays from the old 60-day default to 180
  // so recently-added books are included in the RECENT window without needing
  // a manual Settings update.
  try {
    const row = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { lookbackDays: true } });
    if (row && row.lookbackDays < 90) {
      await prisma.appSettings.update({ where: { id: 1 }, data: { lookbackDays: 180 } });
      console.log("[scheduler] Migrated lookbackDays from", row.lookbackDays, "→ 180.");
    }
  } catch (err) {
    console.error("[scheduler] lookbackDays migration failed:", (err as Error).message);
  }

  // Run every hour, on the hour.
  task = cron.schedule("0 * * * *", () => {
    void tick();
  });
  console.log("[scheduler] Cron scheduled (hourly tick, honours syncIntervalHours).");

  // Kick off an initial sync shortly after boot if it is due.
  setTimeout(() => {
    void (async () => {
      try {
        const settings = await getSettings();
        const last = settings.lastReleaseSync?.getTime() ?? 0;
        const intervalMs = settings.syncIntervalHours * 3600 * 1000;
        if (Date.now() - last >= intervalMs) {
          await guardedFullSync("startup (sync overdue)");
        } else {
          // Force a sync anyway so the new BookOrbit RECENT scan runs immediately.
          await guardedFullSync("startup (refreshing RECENT from BookOrbit)");
        }
      } catch (err) {
        console.error("[scheduler] Startup sync check failed:", (err as Error).message);
      }
    })();
  }, 8000);
}

export function stopScheduler(): void {
  if (task) {
    task.stop();
    task = null;
    console.log("[scheduler] Stopped.");
  }
}
