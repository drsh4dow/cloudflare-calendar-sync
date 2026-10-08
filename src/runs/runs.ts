import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { requireOwnerSession } from "@/auth/session.server";
import { run } from "./run";
import type { RunStatus } from "./run-status";
import { RunStatusStore } from "./run-status.server";

/**
 * Starts a Run now, the same Run the cron starts, and resolves when it ends.
 * A Run whose Sync Rules failed still resolves, since the Run status it
 * recorded shows the failures; only a Run that couldn't finish rejects.
 */
export const runNow = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<void> => {
    await requireOwnerSession(context.auth, getRequestHeaders());
    await context.runEffect(run.pipe(Effect.catchTag("RunFailed", () => Effect.void)));
  },
);

/** How the last Run went for each Sync Rule and Calendar Account. */
export const getRunStatus = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<RunStatus> => {
    await requireOwnerSession(context.auth, getRequestHeaders());

    return context.runEffect(RunStatusStore.use((store) => store.read));
  },
);
