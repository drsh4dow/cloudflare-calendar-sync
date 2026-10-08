import { D1Client } from "@effect/sql-d1";
import { Effect, Layer } from "effect";

import type { WorkerEnv } from "../alchemy.run";
import { SyncRules } from "./sync-rules/sync-rules.server";

/** The services every Effect program in the Worker can use. */
export type AppServices = SyncRules;

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
 */
export function effectRunner(env: WorkerEnv): RunEffect {
  const services = SyncRules.layer.pipe(Layer.provide(D1Client.layer({ db: env.DB })));

  return (program) => Effect.runPromise(program.pipe(Effect.provide(services)));
}
