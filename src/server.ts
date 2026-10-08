import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

import type { WorkerEnv } from "../alchemy.run";
import { createAuth, type Auth } from "./auth/auth.server";

// Augments the module the generated route tree registers the router on;
// augmenting `@tanstack/react-router` instead leaves the context untyped.
declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { auth: Auth } };
  }
}

const handleStartRequest = createStartHandler(defaultStreamHandler);

// An instance checks the D1 schema when it starts, so instances are kept per
// origin rather than built per request. Cloudflare routes only this Worker's
// own hostnames to it, so the map holds one entry per route (workers.dev, a
// custom domain, or the dev server).
const authByOrigin = new Map<string, Auth>();

function authFor(request: Request, env: WorkerEnv): Auth {
  const origin = new URL(request.url).origin;
  const existing = authByOrigin.get(origin);

  if (existing) {
    return existing;
  }

  const auth = createAuth(env, origin);
  authByOrigin.set(origin, auth);

  return auth;
}

export default {
  // Start's second parameter is its own request options, not the Worker env,
  // so the Worker's handler can't be passed through unwrapped.
  fetch(request, env) {
    return handleStartRequest(request, { context: { auth: authFor(request, env) } });
  },

  async scheduled(controller) {
    console.info("Scheduled event", { cron: controller.cron, time: controller.scheduledTime });
  },
} satisfies ExportedHandler<WorkerEnv>;
