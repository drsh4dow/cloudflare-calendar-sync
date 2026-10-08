import { Cache, DateTime, Effect } from "effect";

import { GoogleCalendar } from "@/google/calendar-client";
import type { SyncRule } from "@/sync-rules/sync-rule";
import { SyncRules } from "@/sync-rules/sync-rules.server";
import { type CopyOperation, planCopies, syncWindowAt } from "./planner";

/** A Calendar as one Calendar Account reaches it. */
type CalendarRef = { readonly calendarAccountId: string; readonly calendarId: string };

/**
 * One Run: brings every Sync Rule's Copies in line with its Source Events
 * over the Sync Window, writing only the differences. The cron and "Run now"
 * both run it.
 */
export const run = Effect.gen(function* () {
  const syncRules = yield* SyncRules;
  const google = yield* GoogleCalendar;
  const now = yield* DateTime.now;
  const window = syncWindowAt(now);
  const rules = yield* syncRules.list;

  // Lists each Calendar once, however many Sync Rules read or write it. A
  // failed listing is kept too, so no Run lists a Calendar twice.
  const listings = yield* Cache.make({
    lookup: ({ calendarAccountId, calendarId }: CalendarRef) =>
      google.listEvents(calendarAccountId, calendarId, window),
    capacity: 2 * rules.length,
  });

  const apply = (target: CalendarRef, operation: CopyOperation) => {
    const { calendarAccountId, calendarId } = target;

    switch (operation.kind) {
      case "create":
        // The id may be taken by this Copy after the Owner deleted it, or
        // after an overlapping Run inserted it. Either way, writing the whole
        // Copy under the id makes it current (ADR 0002).
        return google
          .insertCopy(calendarAccountId, calendarId, operation.copy)
          .pipe(
            Effect.catchTag("CopyIdTaken", () =>
              google.updateCopy(calendarAccountId, calendarId, operation.copy),
            ),
          );
      case "update":
        return google.updateCopy(calendarAccountId, calendarId, operation.copy);
      case "delete":
        return google.deleteCopy(calendarAccountId, calendarId, operation.copyId);
      default: {
        const exhaustive: never = operation;

        return exhaustive;
      }
    }
  };

  const syncRule = Effect.fn("syncRule")(function* (rule: SyncRule) {
    const target: CalendarRef = {
      calendarAccountId: rule.targetCalendarAccountId,
      calendarId: rule.targetCalendarId,
    };

    // A Sync Rule is planned only from complete listings of both Calendars,
    // so a failed read never looks like deleted Source Events.
    const sourceEvents = yield* Cache.get(listings, {
      calendarAccountId: rule.sourceCalendarAccountId,
      calendarId: rule.sourceCalendarId,
    });

    const targetEvents = yield* Cache.get(listings, target);
    const operations = planCopies({ rule, sourceEvents, targetEvents, now });

    yield* Effect.forEach(operations, (operation) => apply(target, operation), {
      concurrency: 4,
      discard: true,
    });

    yield* Effect.logInfo("Sync Rule applied", { syncRuleId: rule.id, writes: operations.length });
  });

  yield* Effect.forEach(rules, syncRule, { discard: true });
});
