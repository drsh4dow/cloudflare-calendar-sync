import { D1Client } from "@effect/sql-d1";
import { Effect, Layer } from "effect";

import type { WorkerEnv } from "../alchemy.run";
import type { Auth } from "./auth/auth.server";
import { accessTokensForOwner } from "./auth/calendar-accounts.server";
import { GoogleCalendar } from "./google/calendar-client";
import { RunStatusStore } from "./runs/run-status.server";
import { SyncRules } from "./sync-rules/sync-rules.server";

/** The services every Effect program in the Worker can use. */
export type AppServices = SyncRules | RunStatusStore | GoogleCalendar;

/** Runs an Effect program, resolving with its result or rejecting with its failure. */
export type RunEffect = <A, E>(program: Effect.Effect<A, E, AppServices>) => Promise<A>;

/**
 * The one way Worker code runs Effect programs with the app's services.
 * Start server functions get it through the request context; another entry
 * point, such as the scheduled handler, builds one from its own bindings.
 *
 * Each program gets fresh services built from the invocation's bindings and
 * released when the program ends. A runtime shared across a request would
 * need disposing once all its work is done, and Start's streamed responses
 * leave no point where that is known.
 *
 * Google Calendar gets the Owner's tokens without a session, so a Run works
 * the same from the cron and from a request. Server functions that call it
 * must check the Owner's session first.
 */
export function effectRunner(env: WorkerEnv, auth: Auth): RunEffect {
  const services = Layer.mergeAll(
    Layer.mergeAll(SyncRules.layer, RunStatusStore.layer).pipe(
      Layer.provide(D1Client.layer({ db: env.DB })),
    ),
    GoogleCalendar.layer.pipe(Layer.provide(accessTokensForOwner(auth, env.OWNER_EMAIL))),
  );

  return (program) => Effect.runPromise(program.pipe(Effect.provide(services)));
}
