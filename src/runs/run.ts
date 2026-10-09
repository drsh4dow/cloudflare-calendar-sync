import { Cache, DateTime, Effect, Schema } from "effect";

import {
  type CalendarAccountNeedsReconnect,
  GoogleCalendar,
  type GoogleCalendarUnavailable,
} from "@/google/calendar-client";
import type { SyncRule } from "@/sync-rules/sync-rule";
import { SyncRules } from "@/sync-rules/sync-rules.server";
import { type CopyOperation, planCopies, planOrphanDeletions, syncWindowAt } from "./planner";
import type { CalendarAccountProblem } from "./run-status";
import { type RunReport, RunStatusStore } from "./run-status.server";

/** A Calendar as one Calendar Account reaches it. */
export type CalendarRef = { readonly calendarAccountId: string; readonly calendarId: string };

/** How applying one Sync Rule ended. */
type SyncRuleOutcome =
  | { readonly kind: "succeeded" }
  /** A request of one of the rule's Calendar Accounts failed. */
  | {
      readonly kind: "calendarAccountFailed";
      readonly calendarAccountId: string;
      readonly problem: CalendarAccountProblem;
    }
  /** Anything else, such as a bug. */
  | { readonly kind: "defect" };

type AppliedSyncRule = { readonly rule: SyncRule; readonly outcome: SyncRuleOutcome };

/** A Run in which at least one Sync Rule failed. Each failure is logged and in the Run status. */
export class RunFailed extends Schema.TaggedError<RunFailed>()("RunFailed", {
  failedSyncRules: Schema.Number,
}) {
  // Cloudflare shows it with the failed cron invocation.
  override get message(): string {
    return `${this.failedSyncRules} Sync Rules failed`;
  }
}

/**
 * One Run: brings every Sync Rule's Copies in line with its Source Events
 * over the Sync Window, writing only the differences, and records the Run
 * status. The cron and "Run now" both run it. A failure stops only the Sync
 * Rule it happens in, and the Run fails at the end when any Sync Rule did.
 */
export const run = Effect.gen(function* () {
  const syncRules = yield* SyncRules;
  const google = yield* GoogleCalendar;
  const runStatus = yield* RunStatusStore;
  const now = yield* DateTime.now;
  const window = syncWindowAt(now);
  const rules = yield* syncRules.list;
  // A deleted Sync Rule never comes back, so reading the deleted ids before
  // the listings is safe: a later Run collects the Copies of a rule deleted
  // after this point.
  const deletedSyncRuleIds = new Set(yield* syncRules.deletedIds);

  // The first Sync Rule that writes a Calendar deletes its orphan Copies, so
  // each is deleted once.
  const orphanCollectors = new Map<string, string>();

  for (const rule of rules) {
    if (!orphanCollectors.has(rule.targetCalendarId)) {
      orphanCollectors.set(rule.targetCalendarId, rule.id);
    }
  }

  // Lists each Calendar once, however many Sync Rules read or write it. A
  // failed listing is kept too, so no Run lists a Calendar twice.
  const listings = yield* Cache.make({
    lookup: ({ calendarAccountId, calendarId }: CalendarRef) =>
      google.listEvents(calendarAccountId, calendarId, window),
    capacity: 2 * rules.length,
  });

  const syncRule = Effect.fn("syncRule")(function* (rule: SyncRule) {
    const target: CalendarRef = {
      calendarAccountId: rule.targetCalendarAccountId,
      calendarId: rule.targetCalendarId,
    };

    // A Sync Rule is planned only from complete listings of both Calendars,
    // so a failed read never looks like deleted Source Events.
    const source = yield* Cache.get(listings, {
      calendarAccountId: rule.sourceCalendarAccountId,
      calendarId: rule.sourceCalendarId,
    });

    const targetListing = yield* Cache.get(listings, target);

    const operations = planCopies({
      rule,
      sourceEvents: source.events,
      target: targetListing,
      now,
    });

    let orphanDeletions: ReadonlyArray<CopyOperation> = [];

    if (orphanCollectors.get(rule.targetCalendarId) === rule.id) {
      orphanDeletions = planOrphanDeletions(targetListing, deletedSyncRuleIds, now);
    }

    yield* applyCopyOperations(target, [...operations, ...orphanDeletions]);

    yield* Effect.logInfo("Sync Rule applied", {
      syncRuleId: rule.id,
      writes: operations.length,
      orphanCopiesDeleted: orphanDeletions.length,
    });
  });

  const applySyncRule = (rule: SyncRule) =>
    syncRule(rule).pipe(
      Effect.as<SyncRuleOutcome>({ kind: "succeeded" }),
      Effect.catchTags({
        CalendarAccountNeedsReconnect: (error) =>
          calendarAccountFailed(rule, error, "needsReconnect"),
        GoogleCalendarUnavailable: (error) => calendarAccountFailed(rule, error, "unavailable"),
      }),
      Effect.catchDefect((defect) =>
        Effect.logError("Sync Rule failed", { syncRuleId: rule.id, defect }).pipe(
          Effect.as<SyncRuleOutcome>({ kind: "defect" }),
        ),
      ),
      Effect.map((outcome): AppliedSyncRule => ({ rule, outcome })),
    );

  const applied = yield* Effect.forEach(rules, applySyncRule);

  yield* runStatus.record({
    startedAt: now,
    syncRules: applied.map(({ rule, outcome }) => ({
      syncRuleId: rule.id,
      succeeded: outcome.kind === "succeeded",
    })),
    calendarAccounts: calendarAccountOutcomes(applied),
  });

  const failedSyncRules = applied.filter(({ outcome }) => outcome.kind !== "succeeded").length;

  if (failedSyncRules > 0) {
    yield* new RunFailed({ failedSyncRules });
  }
});

/** Writes the planned operations to the Target Calendar, a few at a time. */
export function applyCopyOperations(
  target: CalendarRef,
  operations: ReadonlyArray<CopyOperation>,
): Effect.Effect<void, CalendarAccountNeedsReconnect | GoogleCalendarUnavailable, GoogleCalendar> {
  return Effect.forEach(operations, (operation) => applyCopyOperation(target, operation), {
    concurrency: 4,
    discard: true,
  });
}

/** Writes one planned operation to the Target Calendar. */
function applyCopyOperation(target: CalendarRef, operation: CopyOperation) {
  const { calendarAccountId, calendarId } = target;

  return GoogleCalendar.use((google) => {
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
  });
}

function calendarAccountFailed(
  rule: SyncRule,
  error: CalendarAccountNeedsReconnect | GoogleCalendarUnavailable,
  problem: CalendarAccountProblem,
): Effect.Effect<SyncRuleOutcome> {
  const { calendarAccountId } = error;

  return Effect.logError("Sync Rule failed", { syncRuleId: rule.id, error }).pipe(
    Effect.as<SyncRuleOutcome>({ kind: "calendarAccountFailed", calendarAccountId, problem }),
  );
}

/**
 * How the Run went for each Calendar Account it used. A request of the
 * account failed, or it served a Sync Rule that succeeded. When both
 * happened, the failure counts, and `needsReconnect` outranks
 * `unavailable` because only the Owner can fix it. An account whose Sync
 * Rules all failed for another reason may not have been used, so it is left
 * out.
 */
function calendarAccountOutcomes(
  applied: ReadonlyArray<AppliedSyncRule>,
): RunReport["calendarAccounts"] {
  const problems = new Map<string, CalendarAccountProblem | null>();

  for (const { outcome } of applied) {
    if (outcome.kind !== "calendarAccountFailed") {
      continue;
    }

    if (problems.get(outcome.calendarAccountId) !== "needsReconnect") {
      problems.set(outcome.calendarAccountId, outcome.problem);
    }
  }

  for (const { rule, outcome } of applied) {
    if (outcome.kind !== "succeeded") {
      continue;
    }

    const { sourceCalendarAccountId, targetCalendarAccountId } = rule;

    for (const calendarAccountId of [sourceCalendarAccountId, targetCalendarAccountId]) {
      if (!problems.has(calendarAccountId)) {
        problems.set(calendarAccountId, null);
      }
    }
  }

  return Array.from(problems, ([calendarAccountId, problem]) => ({ calendarAccountId, problem }));
}
