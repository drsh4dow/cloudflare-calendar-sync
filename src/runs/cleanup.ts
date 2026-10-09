import { DateTime, Effect } from "effect";

import { GoogleCalendar } from "@/google/calendar-client";
import type { SyncRule } from "@/sync-rules/sync-rule";
import { SyncRules } from "@/sync-rules/sync-rules.server";
import { planCopies } from "./planner";
import { applyCopyOperations, type CalendarRef } from "./run";

/**
 * Deletes the Sync Rule's Copies that haven't ended, then the Sync Rule. A
 * Sync Rule that no longer exists counts as deleted, so a repeated request is
 * harmless.
 */
export const deleteSyncRuleWithCopies = Effect.fn("deleteSyncRuleWithCopies")(function* (
  syncRuleId: string,
) {
  const syncRules = yield* SyncRules;
  const rules = yield* syncRules.list;
  const rule = rules.find((candidate) => candidate.id === syncRuleId);

  if (rule !== undefined) {
    yield* deleteWithCopies(rule);
  }
});

/**
 * Deletes the Copies that the Calendar Account's Calendars produced in other
 * Calendar Accounts' Calendars, with the Sync Rules that produced them. It
 * uses only the other accounts' tokens, so it works when this account's grant
 * is gone. Copies inside the Calendar Account stay where they are.
 */
export const deleteCopiesInOtherAccounts = Effect.fn("deleteCopiesInOtherAccounts")(function* (
  calendarAccountId: string,
) {
  const syncRules = yield* SyncRules;
  const rules = yield* syncRules.list;

  const intoOtherAccounts = rules.filter(
    (rule) =>
      rule.sourceCalendarAccountId === calendarAccountId &&
      rule.targetCalendarAccountId !== calendarAccountId,
  );

  yield* Effect.forEach(intoOtherAccounts, deleteWithCopies, { discard: true });
});

/**
 * The Sync Rule is deleted only after all its Copies are. When one can't be
 * deleted, the Sync Rule stays and Runs keep maintaining its Copies, so
 * deleting again finishes the job instead of leaving Copies no Sync Rule
 * claims.
 */
const deleteWithCopies = Effect.fn("deleteWithCopies")(function* (rule: SyncRule) {
  const syncRules = yield* SyncRules;
  const google = yield* GoogleCalendar;
  const now = yield* DateTime.now;

  const target: CalendarRef = {
    calendarAccountId: rule.targetCalendarAccountId,
    calendarId: rule.targetCalendarId,
  };

  // The Owner may have moved a Copy beyond the Sync Window, so the listing
  // has no upper bound.
  const targetListing = yield* google.listCopies(
    target.calendarAccountId,
    target.calendarId,
    rule.id,
    now,
  );

  // Without Source Events, every Copy of the rule that hasn't ended is stale.
  const operations = planCopies({ rule, sourceEvents: [], target: targetListing, now });

  yield* applyCopyOperations(target, operations);
  yield* syncRules.delete(rule.id);
  yield* Effect.logInfo("Sync Rule deleted", { syncRuleId: rule.id, writes: operations.length });
});
