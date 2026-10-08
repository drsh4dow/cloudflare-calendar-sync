import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { requireOwnerSession } from "@/auth/session.server";
import { run } from "./run";

/** Starts a Run now, the same Run the cron starts, and resolves when it ends. */
export const runNow = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<void> => {
    await requireOwnerSession(context.auth, getRequestHeaders());
    await context.runEffect(run);
  },
);
