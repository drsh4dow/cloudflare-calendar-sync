import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import type { WorkerEnv } from "../alchemy.run";
import { createAuth, type Auth } from "./auth/auth.server";
import { effectRunner, type RunEffect } from "./effect-runner.server";
import { run } from "./runs/run";

// Augments the module the generated route tree registers the router on;
// augmenting `@tanstack/react-router` instead leaves the context untyped.
declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { auth: Auth; runEffect: RunEffect } };
  }
}

const handleStartRequest = createStartHandler(defaultStreamHandler);

export default {
  // Start's second parameter is its own request options, not the Worker env,
  // so the Worker's handler can't be passed through unwrapped.
  fetch(request, env) {
    // One better-auth instance per request. A shared instance memoizes
    // promises, such as its D1 schema check, whose I/O belongs to the request
    // that started them; when that request ends first, the promise never
    // settles and every later auth call in the isolate hangs.
    const auth = createAuth(env, new URL(request.url).origin);

    return handleStartRequest(request, { context: { auth, runEffect: effectRunner(env, auth) } });
  },

  async scheduled(_controller, env) {
    // A cron invocation has no request, so better-auth gets no origin. A Run
    // only refreshes tokens, which needs none; sign-in and linking do.
    const auth = createAuth(env, undefined);

    await effectRunner(env, auth)(run);
  },
} satisfies ExportedHandler<WorkerEnv>;
