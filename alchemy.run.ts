import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export const App = Cloudflare.Website.Vite(
  "App",
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;

    const db = yield* Cloudflare.D1.Database("DB", {
      name: `calendar-sync-${stage}`,
      migrations: "./migrations",
    });

    return {
      name: `calendar-sync-${stage}`,
      main: "./src/server.ts",
      compatibility: { date: "2026-09-18", flags: ["nodejs_compat"] },
      crons: ["*/5 * * * *"],
      env: {
        DB: db,
        OWNER_EMAIL: Config.Redacted("OWNER_EMAIL"),
        GOOGLE_CLIENT_ID: Config.Redacted("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET: Config.Redacted("GOOGLE_CLIENT_SECRET"),
        BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
      },
    };
  }),
);

export type WorkerEnv = Cloudflare.InferEnv<typeof App>;

export default Alchemy.Stack(
  "calendar-sync",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const app = yield* App;

    return { url: app.url };
  }),
);
