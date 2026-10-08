import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";

import { CalendarAccountProblem, type RunStatus } from "./run-status";

/** How one Run ended for each Sync Rule it applied and each Calendar Account it used. */
export type RunReport = {
  readonly startedAt: DateTime.Utc;
  readonly syncRules: ReadonlyArray<{ readonly syncRuleId: string; readonly succeeded: boolean }>;
  readonly calendarAccounts: ReadonlyArray<{
    readonly calendarAccountId: string;
    readonly problem: CalendarAccountProblem | null;
  }>;
};

const SyncRuleStatusRow = Schema.Struct({
  syncRuleId: Schema.String,
  lastRunAt: Schema.DateFromString,
  lastRunSucceeded: Schema.BooleanFromBit,
  lastSucceededAt: Schema.NullOr(Schema.DateFromString),
});

const CalendarAccountStatusRow = Schema.Struct({
  calendarAccountId: Schema.String,
  lastRunAt: Schema.DateFromString,
  lastRunProblem: Schema.NullOr(CalendarAccountProblem),
});

type RunStatusError = SqlError.SqlError | Schema.SchemaError;

/** The Run status stored in D1. */
export class RunStatusStore extends Context.Service<
  RunStatusStore,
  {
    /**
     * Replaces the status of each Sync Rule and Calendar Account in the
     * report, keeping a Sync Rule's last success when the Run failed it.
     * Skips the ones deleted while the Run went on.
     */
    record(report: RunReport): Effect.Effect<void, RunStatusError>;
    readonly read: Effect.Effect<RunStatus, RunStatusError>;
  }
>()("calendar-sync/RunStatusStore") {
  static readonly layer = Layer.effect(
    RunStatusStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Selecting from the Sync Rule's own table writes nothing once the rule
      // is gone, where a plain insert would break the foreign key.
      const recordSyncRule = SqlSchema.void({
        Request: SyncRuleStatusRow,
        execute: (row) => sql`
          INSERT INTO "syncRuleStatus" ("syncRuleId", "lastRunAt", "lastRunSucceeded",
            "lastSucceededAt")
          SELECT "id", ${row.lastRunAt}, ${row.lastRunSucceeded}, ${row.lastSucceededAt}
          FROM "syncRule"
          WHERE "id" = ${row.syncRuleId}
          ON CONFLICT ("syncRuleId") DO UPDATE
          SET "lastRunAt" = excluded."lastRunAt",
            "lastRunSucceeded" = excluded."lastRunSucceeded",
            "lastSucceededAt" = coalesce(excluded."lastSucceededAt",
              "syncRuleStatus"."lastSucceededAt")
        `,
      });

      // As for Sync Rules, nothing is written once the account is disconnected.
      const recordCalendarAccount = SqlSchema.void({
        Request: CalendarAccountStatusRow,
        execute: (row) => sql`
          INSERT INTO "calendarAccountStatus" ("calendarAccountId", "lastRunAt", "lastRunProblem")
          SELECT "id", ${row.lastRunAt}, ${row.lastRunProblem}
          FROM "account"
          WHERE "id" = ${row.calendarAccountId}
          ON CONFLICT ("calendarAccountId") DO UPDATE
          SET "lastRunAt" = excluded."lastRunAt",
            "lastRunProblem" = excluded."lastRunProblem"
        `,
      });

      const record = Effect.fn("RunStatusStore.record")(function* (report: RunReport) {
        const lastRunAt = DateTime.toDateUtc(report.startedAt);

        for (const { syncRuleId, succeeded } of report.syncRules) {
          yield* recordSyncRule({
            syncRuleId,
            lastRunAt,
            lastRunSucceeded: succeeded,
            lastSucceededAt: succeeded ? lastRunAt : null,
          });
        }

        for (const { calendarAccountId, problem } of report.calendarAccounts) {
          yield* recordCalendarAccount({ calendarAccountId, lastRunAt, lastRunProblem: problem });
        }
      });

      const readSyncRules = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SyncRuleStatusRow,
        execute: () => sql`
          SELECT "syncRuleId", "lastRunAt", "lastRunSucceeded", "lastSucceededAt"
          FROM "syncRuleStatus"
        `,
      })(undefined);

      const readCalendarAccounts = SqlSchema.findAll({
        Request: Schema.Void,
        Result: CalendarAccountStatusRow,
        execute: () => sql`
          SELECT "calendarAccountId", "lastRunAt", "lastRunProblem"
          FROM "calendarAccountStatus"
        `,
      })(undefined);

      const read = Effect.all({ syncRules: readSyncRules, calendarAccounts: readCalendarAccounts });

      return RunStatusStore.of({ record, read });
    }),
  );
}
