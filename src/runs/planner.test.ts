import { DateTime } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type { CalendarEvent, Copy, EventTime } from "@/google/calendar-event";
import type { SyncRule } from "@/sync-rules/sync-rule";
import { planCopies } from "./planner";

const now = DateTime.makeUnsafe("2026-10-09T12:00:00Z");

const rule: SyncRule = {
  id: "0123456789abcdef0123456789abcdef",
  sourceCalendarAccountId: "source-account",
  sourceCalendarId: "source@example.com",
  targetCalendarAccountId: "target-account",
  targetCalendarId: "target@example.com",
  mode: "private",
  privateTitle: "Blocked (Freelance)",
  includeAllDayEvents: false,
};

function timed(start: string, end: string): EventTime {
  return { kind: "timed", start: DateTime.makeUnsafe(start), end: DateTime.makeUnsafe(end) };
}

const tomorrowMorning = timed("2026-10-10T09:00:00Z", "2026-10-10T10:00:00Z");

function sourceEvent(id: string, time: EventTime): CalendarEvent {
  return {
    id,
    details: {
      title: "Client call",
      description: "Agenda",
      location: "Office",
      time,
      visibility: "default",
      busy: true,
    },
    hasReminders: true,
    hasAttendees: true,
  };
}

/** The Copy as the Target Calendar's listing returns it after a Run wrote it. */
function listed(copy: Copy): CalendarEvent {
  return {
    id: copy.id,
    syncRuleId: copy.syncRuleId,
    details: copy.details,
    hasReminders: false,
    hasAttendees: false,
  };
}

/**
 * The Copies a Run a week earlier wrote for the Source Events, as the Target
 * Calendar lists them.
 */
function copiesOf(sourceEvents: ReadonlyArray<CalendarEvent>): Array<CalendarEvent> {
  const copies: Array<CalendarEvent> = [];
  const weekEarlier = DateTime.makeUnsafe("2026-10-02T12:00:00Z");

  for (const operation of planCopies({
    rule,
    sourceEvents,
    targetEvents: [],
    now: weekEarlier,
  })) {
    if (operation.kind === "create") {
      copies.push(listed(operation.copy));
    }
  }

  return copies;
}

describe("planCopies", () => {
  test("copies a timed Source Event as a private busy Copy titled by the rule", () => {
    const operations = planCopies({
      rule,
      sourceEvents: [sourceEvent("event1", tomorrowMorning)],
      targetEvents: [],
      now,
    });

    expect(operations).toEqual([
      {
        kind: "create",
        copy: {
          id: expect.stringMatching(/^[a-v0-9]{5,1024}$/),
          syncRuleId: rule.id,
          sourceEventId: "event1",
          details: {
            title: "Blocked (Freelance)",
            time: tomorrowMorning,
            visibility: "private",
            busy: true,
          },
        },
      },
    ]);
  });

  test("gives each occurrence of a recurring event its own Copy", () => {
    const googleIdAlphabet = /^[a-v0-9]{5,1024}$/;

    const operations = planCopies({
      rule,
      sourceEvents: [
        sourceEvent("series1_20261010T090000Z", tomorrowMorning),
        sourceEvent(
          "series1_20261011T090000Z",
          timed("2026-10-11T09:00:00Z", "2026-10-11T10:00:00Z"),
        ),
      ],
      targetEvents: [],
      now,
    });

    expect(operations).toEqual([
      {
        kind: "create",
        copy: expect.objectContaining({
          id: expect.stringMatching(googleIdAlphabet),
          sourceEventId: "series1_20261010T090000Z",
        }),
      },
      {
        kind: "create",
        copy: expect.objectContaining({
          id: expect.stringMatching(googleIdAlphabet),
          sourceEventId: "series1_20261011T090000Z",
        }),
      },
    ]);

    const ids = operations.map((operation) =>
      operation.kind === "delete" ? operation.copyId : operation.copy.id,
    );

    expect(new Set(ids).size).toBe(2);
  });

  test("writes nothing when the Copies match their Source Events", () => {
    const sourceEvents = [sourceEvent("event1", tomorrowMorning)];

    expect(planCopies({ rule, sourceEvents, targetEvents: copiesOf(sourceEvents), now })).toEqual(
      [],
    );
  });

  test("moves a Copy when its Source Event moves", () => {
    const [copy] = copiesOf([sourceEvent("event1", tomorrowMorning)]);
    const moved = timed("2026-10-10T14:00:00Z", "2026-10-10T15:30:00Z");

    const operations = planCopies({
      rule,
      sourceEvents: [sourceEvent("event1", moved)],
      targetEvents: [copy!],
      now,
    });

    expect(operations).toEqual([
      {
        kind: "update",
        copy: expect.objectContaining({
          id: copy!.id,
          details: expect.objectContaining({ title: "Blocked (Freelance)", time: moved }),
        }),
      },
    ]);
  });

  test("rewrites a Copy the Owner edited", () => {
    const sourceEvents = [sourceEvent("event1", tomorrowMorning)];
    const [copy] = copiesOf(sourceEvents);
    const edited = { ...copy!, details: { ...copy!.details, title: "Lunch" } };
    const withReminder = { ...copy!, hasReminders: true };

    for (const changed of [edited, withReminder]) {
      expect(planCopies({ rule, sourceEvents, targetEvents: [changed], now })).toEqual([
        { kind: "update", copy: expect.objectContaining({ id: copy!.id, details: copy!.details }) },
      ]);
    }
  });

  test("deletes a Copy whose Source Event is gone", () => {
    const [copy] = copiesOf([sourceEvent("event1", tomorrowMorning)]);

    expect(planCopies({ rule, sourceEvents: [], targetEvents: [copy!], now })).toEqual([
      { kind: "delete", copyId: copy!.id },
    ]);
  });

  test("never touches events the system didn't create", () => {
    const ownEvent = sourceEvent("own1", tomorrowMorning);

    expect(planCopies({ rule, sourceEvents: [], targetEvents: [ownEvent], now })).toEqual([]);
  });

  test("leaves other Sync Rules' Copies alone", () => {
    const otherRuleCopy: CalendarEvent = {
      ...sourceEvent("other1", tomorrowMorning),
      syncRuleId: "fedcba9876543210fedcba9876543210",
    };

    expect(planCopies({ rule, sourceEvents: [], targetEvents: [otherRuleCopy], now })).toEqual([]);
  });

  test("never copies a Copy, so rules can't loop or chain", () => {
    const reverseRuleCopy: CalendarEvent = {
      ...sourceEvent("copy1", tomorrowMorning),
      syncRuleId: "fedcba9876543210fedcba9876543210",
    };

    const ownCopy = { ...sourceEvent("copy2", tomorrowMorning), syncRuleId: rule.id };

    expect(
      planCopies({ rule, sourceEvents: [reverseRuleCopy, ownCopy], targetEvents: [], now }),
    ).toEqual([]);
  });

  test("never touches a Copy that has ended", () => {
    const thisMorning = timed("2026-10-09T09:00:00Z", "2026-10-09T10:00:00Z");
    const [endedCopy] = copiesOf([sourceEvent("event1", thisMorning)]);
    const [movedSourceCopy] = copiesOf([sourceEvent("event2", thisMorning)]);

    const operations = planCopies({
      rule,
      sourceEvents: [
        sourceEvent("event2", timed("2026-10-09T08:00:00Z", "2026-10-09T09:00:00Z")),
        sourceEvent("event3", thisMorning),
      ],
      targetEvents: [endedCopy!, movedSourceCopy!],
      now,
    });

    expect(operations).toEqual([]);
  });

  test("updates a running Copy whose Source Event moved into the past", () => {
    const thisAfternoon = timed("2026-10-09T11:00:00Z", "2026-10-09T13:00:00Z");
    const [copy] = copiesOf([sourceEvent("event1", thisAfternoon)]);
    const thisMorning = timed("2026-10-09T09:00:00Z", "2026-10-09T10:00:00Z");

    expect(
      planCopies({
        rule,
        sourceEvents: [sourceEvent("event1", thisMorning)],
        targetEvents: [copy!],
        now,
      }),
    ).toEqual([
      {
        kind: "update",
        copy: expect.objectContaining({ details: expect.objectContaining({ time: thisMorning }) }),
      },
    ]);
  });
});
