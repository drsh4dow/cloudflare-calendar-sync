import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient, type SqlError, SqlSchema } from "effect/sql";

import { type NewSyncRule, type SyncRule, SyncRuleSettings } from "./sync-rule";

const SyncRuleSettingsRow = Schema.Struct({
  ...SyncRuleSettings.fields,
  includeAllDayEvents: Schema.BooleanFromBit,
});

const SyncRuleRow = Schema.Struct({
  id: Schema.String,
  sourceCalendarAccountId: Schema.String,
  sourceCalendarId: Schema.String,
  targetCalendarAccountId: Schema.String,
  targetCalendarId: Schema.String,
  ...SyncRuleSettingsRow.fields,
});

type SyncRulesError = SqlError.SqlError | Schema.SchemaError;

/** The Sync Rules stored in D1. */
export class SyncRules extends Context.Service<
  SyncRules,
  {
    /** Every Sync Rule, oldest first. */
    readonly list: Effect.Effect<ReadonlyArray<SyncRule>, SyncRulesError>;
    /**
     * Stores the Sync Rules in one statement, so either all of them exist
     * afterwards or none. A rule whose Source and Target Calendars already
     * have a Sync Rule is skipped, which keeps a repeated request harmless.
     */
    create(rules: ReadonlyArray<NewSyncRule>): Effect.Effect<void, SyncRulesError>;
    update(id: string, settings: SyncRuleSettings): Effect.Effect<void, SyncRulesError>;
    delete(id: string): Effect.Effect<void, SqlError.SqlError>;
  }
>()("calendar-sync/SyncRules") {
  static readonly layer = Layer.effect(
    SyncRules,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const list = SqlSchema.findAll({
        Request: Schema.Void,
        Result: SyncRuleRow,
        execute: () => sql`
          SELECT "id", "sourceCalendarAccountId", "sourceCalendarId", "targetCalendarAccountId",
            "targetCalendarId", "mode", "privateTitle", "includeAllDayEvents"
          FROM "syncRule"
          ORDER BY "createdAt", "id"
        `,
      })(undefined);

      const insert = SqlSchema.void({
        Request: Schema.Array(SyncRuleRow),
        execute: (rows) => sql`INSERT INTO "syncRule" ${sql.insert(rows)} ON CONFLICT DO NOTHING`,
      });

      const create = (rules: ReadonlyArray<NewSyncRule>) =>
        insert(rules.map((rule) => ({ id: newSyncRuleId(), ...rule })));

      const updateSettings = SqlSchema.void({
        Request: Schema.Struct({ id: Schema.String, settings: SyncRuleSettingsRow }),
        execute: ({ id, settings }) => sql`
          UPDATE "syncRule"
          SET "mode" = ${settings.mode},
            "privateTitle" = ${settings.privateTitle},
            "includeAllDayEvents" = ${settings.includeAllDayEvents},
            "updatedAt" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE "id" = ${id}
        `,
      });

      const update = (id: string, settings: SyncRuleSettings) => updateSettings({ id, settings });

      const remove = (id: string) =>
        sql`DELETE FROM "syncRule" WHERE "id" = ${id}`.pipe(Effect.asVoid);

      return SyncRules.of({ list, create, update, delete: remove });
    }),
  );
}

/**
 * 32 lowercase hex digits. Hex is a subset of the alphabet Google allows in
 * event ids (lowercase a to v and digits), so Copy ids can embed it as is
 * (ADR 0002).
 */
function newSyncRuleId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
