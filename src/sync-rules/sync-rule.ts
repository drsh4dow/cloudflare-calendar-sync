import { Schema } from "effect";

/** How much of a Source Event a Copy reveals. */
export const Mode = Schema.Literals(["private", "transparent"]);

export type Mode = typeof Mode.Type;

/** The parts of a Sync Rule the Owner can edit after creating it. */
export const SyncRuleSettings = Schema.Struct({
  mode: Mode,
  /** The title of Private Mode Copies. Kept in Transparent Mode, so switching back restores it. */
  privateTitle: Schema.String.check(Schema.isTrimmed(), Schema.isNonEmpty()),
  includeAllDayEvents: Schema.Boolean,
});

export type SyncRuleSettings = typeof SyncRuleSettings.Type;

export const defaultSyncRuleSettings: SyncRuleSettings = {
  mode: "private",
  privateTitle: "Busy",
  includeAllDayEvents: false,
};

/** A Sync Rule before it has an id. Source and Target never change after creation. */
export const NewSyncRule = Schema.Struct({
  sourceCalendarAccountId: Schema.String,
  sourceCalendarId: Schema.String,
  targetCalendarAccountId: Schema.String,
  targetCalendarId: Schema.String,
  ...SyncRuleSettings.fields,
});

export type NewSyncRule = typeof NewSyncRule.Type;

export const SyncRule = Schema.Struct({ id: Schema.String, ...NewSyncRule.fields });

export type SyncRule = typeof SyncRule.Type;

/** The Sync Rule that copies the other way, with the same settings. */
export function reverseOf(rule: NewSyncRule): NewSyncRule {
  return {
    ...rule,
    sourceCalendarAccountId: rule.targetCalendarAccountId,
    sourceCalendarId: rule.targetCalendarId,
    targetCalendarAccountId: rule.sourceCalendarAccountId,
    targetCalendarId: rule.sourceCalendarId,
  };
}
