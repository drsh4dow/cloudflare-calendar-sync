import { Schema } from "effect";

/**
 * Why a Run couldn't use a Calendar Account. These are the cases the
 * dashboard's Calendar listing reports for the same failures: Google refused
 * the account's grant, so only reconnecting helps, or Google failed in a way
 * a later Run may not meet.
 */
export const CalendarAccountProblem = Schema.Literals(["needsReconnect", "unavailable"]);

export type CalendarAccountProblem = typeof CalendarAccountProblem.Type;

/** How the last Run that applied a Sync Rule ended. */
export type SyncRuleStatus = {
  readonly syncRuleId: string;
  /** When that Run started. */
  readonly lastRunAt: Date;
  readonly lastRunSucceeded: boolean;
  /** When the last Run that applied the rule without a failure started, or null when none has. */
  readonly lastSucceededAt: Date | null;
};

/** How the last Run that used a Calendar Account ended for it. */
export type CalendarAccountStatus = {
  readonly calendarAccountId: string;
  /** When that Run started. */
  readonly lastRunAt: Date;
  /** Null when every request that Run made for the account succeeded. */
  readonly lastRunProblem: CalendarAccountProblem | null;
};

/** What the dashboard shows about Runs. */
export type RunStatus = {
  readonly syncRules: ReadonlyArray<SyncRuleStatus>;
  readonly calendarAccounts: ReadonlyArray<CalendarAccountStatus>;
};
