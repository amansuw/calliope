import { startCron } from "./cron";
import { requestLibraryScan } from "./library-index";

declare global {
  var __calliope_runtime_started__: boolean | undefined;
}

export function ensureRuntimeStarted() {
  if (globalThis.__calliope_runtime_started__) return;
  globalThis.__calliope_runtime_started__ = true;

  startCron();

  requestLibraryScan().catch((err) => {
    console.error("[runtime] Library scan failed:", err);
  });
}
