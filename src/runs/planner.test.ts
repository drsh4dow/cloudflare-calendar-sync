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
    iCalUID: `${id}@google.com`,
    eventType: "default",
    details: {
      title: "Client call",
      description: "Agenda",
      location: "Office",
      conferenceLink: "https://meet.google.com/abc-defg-hij",
      time,
      visibility: "default",
      busy: true,
    },
    hasReminders: true,
    hasAttendees: true,
  };
}

/**
 * The Owner's accepted invitation to an occurrence of a recurring meeting
 * that its series scheduled at `scheduled`, and that takes place at `time`.
 */
function occurrence(id: string, scheduled: EventTime, time: EventTime = scheduled): CalendarEvent {
  return {
    ...sourceEvent(id, time),
    iCalUID: "series1@example.com",
    originalStart: scheduled,
    ownerResponse: "accepted",
  };
}

/** The Copy as the Target Calendar's listing returns it after a Run wrote it. */
function listed(copy: Copy): CalendarEvent {
  return {
    id: copy.id,
    iCalUID: `${copy.id}@google.com`,
    eventType: "default",

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
function copiesOf(
  sourceEvents: ReadonlyArray<CalendarEvent>,
  ruleThen: SyncRule = rule,
): Array<CalendarEvent> {
  const copies: Array<CalendarEvent> = [];
  const weekEarlier = DateTime.makeUnsafe("2026-10-02T12:00:00Z");

  for (const operation of planCopies({
    rule: ruleThen,
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

  test("shows the Source Event's title, description, location, and conference link in Transparent Mode", () => {
    const transparent: SyncRule = { ...rule, mode: "transparent" };

    const operations = planCopies({
      rule: transparent,
      sourceEvents: [sourceEvent("event1", tomorrowMorning)],
      targetEvents: [],
      now,
    });

    expect(operations).toEqual([
      {
        kind: "create",
        copy: expect.objectContaining({
          sourceEventId: "event1",
          details: {
            title: "Client call",
            description: "Agenda\n\nhttps://meet.google.com/abc-defg-hij",
            location: "Office",
            time: tomorrowMorning,
            visibility: "default",
            busy: true,
          },
        }),
      },
    ]);
  });

  test("shows the conference link once when the Source Event has no description or already shows it", () => {
    const transparent: SyncRule = { ...rule, mode: "transparent" };
    const link = "https://meet.google.com/abc-defg-hij";
    const call = sourceEvent("event1", tomorrowMorning);
    const { description: _, ...withoutDescription } = call.details;

    const operations = planCopies({
      rule: transparent,
      sourceEvents: [
        { ...call, id: "event1", details: withoutDescription },
        { ...call, id: "event2", details: { ...call.details, description: `Join at ${link}` } },
      ],
      targetEvents: [],
      now,
    });

    expect(operations).toEqual([
      {
        kind: "create",
        copy: expect.objectContaining({
          details: expect.objectContaining({ description: link }),
        }),
      },
      {
        kind: "create",
        copy: expect.objectContaining({
          details: expect.objectContaining({ description: `Join at ${link}` }),
        }),
      },
    ]);
  });

  test("keeps a private Source Event private in Transparent Mode", () => {
    const transparent: SyncRule = { ...rule, mode: "transparent" };
    const call = sourceEvent("event1", tomorrowMorning);

    const operations = planCopies({
      rule: transparent,
      sourceEvents: [{ ...call, details: { ...call.details, visibility: "private" } }],
      targetEvents: [],
      now,
    });

    expect(operations).toEqual([
      {
        kind: "create",
        copy: expect.objectContaining({
          details: expect.objectContaining({ title: "Client call", visibility: "private" }),
        }),
      },
    ]);
  });

  test("copies all-day Source Events as all-day Copies only when the rule includes them", () => {
    const tomorrow: EventTime = { kind: "allDay", startDate: "2026-10-10", endDate: "2026-10-11" };
    const sourceEvents = [sourceEvent("holiday1", tomorrow)];

    expect(planCopies({ rule, sourceEvents, targetEvents: [], now })).toEqual([]);

    expect(
      planCopies({
        rule: { ...rule, includeAllDayEvents: true },
        sourceEvents,
        targetEvents: [],
        now,
      }),
    ).toEqual([
      {
        kind: "create",
        copy: expect.objectContaining({
          sourceEventId: "holiday1",
          details: expect.objectContaining({ title: "Blocked (Freelance)", time: tomorrow }),
        }),
      },
    ]);
  });

  test("deletes all-day Copies when the rule stops including all-day events", () => {
    const tomorrow: EventTime = { kind: "allDay", startDate: "2026-10-10", endDate: "2026-10-11" };

    const sourceEvents = [
      sourceEvent("holiday1", tomorrow),
      sourceEvent("event1", tomorrowMorning),
    ];

    const copies = copiesOf(sourceEvents, { ...rule, includeAllDayEvents: true });
    const allDayCopy = copies.find((copy) => copy.details.time.kind === "allDay");

    expect(planCopies({ rule, sourceEvents, targetEvents: copies, now })).toEqual([
      { kind: "delete", copyId: allDayCopy!.id },
    ]);
  });

  test("rewrites Copies when the rule's Mode or private title changes", () => {
    const sourceEvents = [sourceEvent("event1", tomorrowMorning)];
    const transparent: SyncRule = { ...rule, mode: "transparent" };
    const retitled: SyncRule = { ...rule, privateTitle: "Busy" };

    const edits = [
      { before: rule, after: transparent },
      { before: transparent, after: rule },
      { before: rule, after: retitled },
    ];

    for (const { before, after } of edits) {
      const copies = copiesOf(sourceEvents, before);
      const [expected] = copiesOf(sourceEvents, after);

      expect(planCopies({ rule: after, sourceEvents, targetEvents: copies, now })).toEqual([
        {
          kind: "update",
          copy: expect.objectContaining({ id: expected!.id, details: expected!.details }),
        },
      ]);
    }
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

    const withConference = {
      ...copy!,
      details: { ...copy!.details, conferenceLink: "https://meet.google.com/xyz-abcd-efg" },
    };

    for (const changed of [edited, withReminder, withConference]) {
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

  test("skips an event the Owner declined", () => {
    const declined: CalendarEvent = {
      ...sourceEvent("event1", tomorrowMorning),
      ownerResponse: "declined",
    };

    expect(planCopies({ rule, sourceEvents: [declined], targetEvents: [], now })).toEqual([]);
  });

  test("copies tentative and unanswered invitations", () => {
    const tentative: CalendarEvent = {
      ...sourceEvent("event1", tomorrowMorning),
      ownerResponse: "tentative",
    };

    const unanswered: CalendarEvent = {
      ...sourceEvent("event2", tomorrowMorning),
      ownerResponse: "needsAction",
    };

    expect(
      planCopies({ rule, sourceEvents: [tentative, unanswered], targetEvents: [], now }),
    ).toEqual([
      { kind: "create", copy: expect.objectContaining({ sourceEventId: "event1" }) },
      { kind: "create", copy: expect.objectContaining({ sourceEventId: "event2" }) },
    ]);
  });

  test("skips an event marked free", () => {
    const source = sourceEvent("event1", tomorrowMorning);
    const free: CalendarEvent = { ...source, details: { ...source.details, busy: false } };

    expect(planCopies({ rule, sourceEvents: [free], targetEvents: [], now })).toEqual([]);
  });

  test("copies out-of-office and focus-time events as busy Copies", () => {
    const outOfOffice: CalendarEvent = {
      ...sourceEvent("event1", tomorrowMorning),
      eventType: "outOfOffice",
    };

    const focusTime: CalendarEvent = {
      ...sourceEvent("event2", tomorrowMorning),
      eventType: "focusTime",
    };

    const busyCopy = expect.objectContaining({ details: expect.objectContaining({ busy: true }) });

    expect(
      planCopies({ rule, sourceEvents: [outOfOffice, focusTime], targetEvents: [], now }),
    ).toEqual([
      { kind: "create", copy: busyCopy },
      { kind: "create", copy: busyCopy },
    ]);
  });

  test("skips working-location events", () => {
    const workingLocation: CalendarEvent = {
      ...sourceEvent("event1", tomorrowMorning),
      eventType: "workingLocation",
    };

    expect(planCopies({ rule, sourceEvents: [workingLocation], targetEvents: [], now })).toEqual(
      [],
    );
  });

  test("skips a meeting the Target Calendar already holds", () => {
    const sourceInvitation: CalendarEvent = {
      ...sourceEvent("sourceinvitation1", tomorrowMorning),
      iCalUID: "meeting1@example.com",
      ownerResponse: "accepted",
    };

    const targetInvitation: CalendarEvent = {
      ...sourceEvent("targetinvitation1", tomorrowMorning),
      iCalUID: "meeting1@example.com",
      ownerResponse: "needsAction",
    };

    expect(
      planCopies({
        rule,
        sourceEvents: [sourceInvitation],
        targetEvents: [targetInvitation],
        now,
      }),
    ).toEqual([]);
  });

  test("copies a meeting the Owner declined in the Target Calendar", () => {
    const sourceInvitation: CalendarEvent = {
      ...sourceEvent("sourceinvitation1", tomorrowMorning),
      iCalUID: "meeting1@example.com",
      ownerResponse: "accepted",
    };

    const declinedInTarget: CalendarEvent = {
      ...sourceEvent("targetinvitation1", tomorrowMorning),
      iCalUID: "meeting1@example.com",
      ownerResponse: "declined",
    };

    expect(
      planCopies({
        rule,
        sourceEvents: [sourceInvitation],
        targetEvents: [declinedInTarget],
        now,
      }),
    ).toEqual([
      { kind: "create", copy: expect.objectContaining({ sourceEventId: "sourceinvitation1" }) },
    ]);
  });

  test("deletes the Copy of an event the Owner declined after it was copied", () => {
    const invitation: CalendarEvent = {
      ...sourceEvent("event1", tomorrowMorning),
      ownerResponse: "needsAction",
    };

    const [copy] = copiesOf([invitation]);

    expect(
      planCopies({
        rule,
        sourceEvents: [{ ...invitation, ownerResponse: "declined" }],
        targetEvents: [copy!],
        now,
      }),
    ).toEqual([{ kind: "delete", copyId: copy!.id }]);
  });

  test("tells occurrences of a recurring meeting apart", () => {
    const operations = planCopies({
      rule,
      sourceEvents: [
        occurrence("source_20261010T090000Z", tomorrowMorning),
        occurrence(
          "source_20261011T090000Z",
          timed("2026-10-11T09:00:00Z", "2026-10-11T10:00:00Z"),
        ),
      ],
      targetEvents: [occurrence("target_20261010T090000Z", tomorrowMorning)],
      now,
    });

    expect(operations).toEqual([
      {
        kind: "create",
        copy: expect.objectContaining({ sourceEventId: "source_20261011T090000Z" }),
      },
    ]);
  });

  test("matches a moved occurrence by when its series scheduled it", () => {
    const moved = occurrence(
      "source_20261010T090000Z",
      tomorrowMorning,
      timed("2026-10-10T14:00:00Z", "2026-10-10T15:00:00Z"),
    );

    const notYetMoved = occurrence("target_20261010T090000Z", tomorrowMorning);

    expect(planCopies({ rule, sourceEvents: [moved], targetEvents: [notYetMoved], now })).toEqual(
      [],
    );
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
