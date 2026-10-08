import { DateTime, Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type { CalendarEvent, EventTime } from "@/google/calendar-event";
import { type FakeGoogleCalendar, makeFakeGoogleCalendar } from "@/google/fake-google-calendar";
import type { SyncRule } from "@/sync-rules/sync-rule";
import { SyncRules } from "@/sync-rules/sync-rules.server";
import { run } from "./run";

const personal = "personal-account";

const work = "work-account";

const personalCalendar = "personal@example.com";

const workCalendar = "work@example.com";

const personalToWork: SyncRule = {
  id: "0123456789abcdef0123456789abcdef",
  sourceCalendarAccountId: personal,
  sourceCalendarId: personalCalendar,
  targetCalendarAccountId: work,
  targetCalendarId: workCalendar,
  mode: "private",
  privateTitle: "Busy",
  includeAllDayEvents: false,
};

function newGoogleCalendar(): FakeGoogleCalendar {
  return makeFakeGoogleCalendar([
    { calendarAccountId: personal, calendarId: personalCalendar, accessRole: "owner" },
    { calendarAccountId: work, calendarId: workCalendar, accessRole: "owner" },
  ]);
}

/** Sync Rules kept in memory, standing in for D1. */
function syncRulesLayer(rules: ReadonlyArray<SyncRule>) {
  return Layer.succeed(
    SyncRules,
    SyncRules.of({
      list: Effect.succeed(rules),
      create: () => Effect.die("Runs don't create Sync Rules"),
      update: () => Effect.die("Runs don't update Sync Rules"),
      delete: () => Effect.die("Runs don't delete Sync Rules"),
    }),
  );
}

function runAgainst(google: FakeGoogleCalendar, rules: ReadonlyArray<SyncRule>) {
  return run.pipe(Effect.provide(Layer.mergeAll(google.layer, syncRulesLayer(rules))));
}

/** An hour starting at the given hour tomorrow, in UTC. */
function tomorrowAt(hour: number): EventTime {
  const start = DateTime.makeUnsafe(Date.now()).pipe(
    DateTime.startOf("day"),
    DateTime.add({ days: 1, hours: hour }),
  );

  return { kind: "timed", start, end: DateTime.add(start, { hours: 1 }) };
}

function meeting(id: string, time: EventTime): CalendarEvent {
  return {
    id,
    iCalUID: `${id}@google.com`,
    eventType: "default",
    details: { title: "Design review", time, visibility: "default", busy: true },
    hasReminders: true,
    hasAttendees: true,
  };
}

describe("run", () => {
  test("writes a private Copy of each Source Event, and a second Run writes nothing", async () => {
    const google = newGoogleCalendar();

    google.putEvent(personalCalendar, meeting("meeting1", tomorrowAt(9)));
    google.putEvent(personalCalendar, meeting("meeting2", tomorrowAt(14)));
    await Effect.runPromise(runAgainst(google, [personalToWork]));

    expect(google.events(workCalendar)).toEqual([
      expect.objectContaining({
        syncRuleId: personalToWork.id,
        details: { title: "Busy", time: tomorrowAt(9), visibility: "private", busy: true },
      }),
      expect.objectContaining({
        syncRuleId: personalToWork.id,
        details: { title: "Busy", time: tomorrowAt(14), visibility: "private", busy: true },
      }),
    ]);

    const writesAfterFirstRun = google.writes();

    await Effect.runPromise(runAgainst(google, [personalToWork]));

    expect(google.writes()).toBe(writesAfterFirstRun);
  });

  test("overlapping Runs leave one Copy per Source Event", async () => {
    const google = newGoogleCalendar();

    google.putEvent(personalCalendar, meeting("meeting1", tomorrowAt(9)));
    google.putEvent(personalCalendar, meeting("meeting2", tomorrowAt(14)));

    await Effect.runPromise(
      Effect.all([runAgainst(google, [personalToWork]), runAgainst(google, [personalToWork])], {
        concurrency: "unbounded",
      }),
    );

    expect(google.events(workCalendar)).toHaveLength(2);
  });

  test("restores a Copy the Owner deleted", async () => {
    const google = newGoogleCalendar();

    google.putEvent(personalCalendar, meeting("meeting1", tomorrowAt(9)));
    await Effect.runPromise(runAgainst(google, [personalToWork]));

    const [copy] = google.events(workCalendar);

    google.deleteEvent(workCalendar, copy!.id);
    await Effect.runPromise(runAgainst(google, [personalToWork]));

    expect(google.events(workCalendar)).toEqual([copy]);
  });

  test("deletes no Copies when the Source Calendar's listing fails", async () => {
    const google = newGoogleCalendar();

    google.putEvent(personalCalendar, meeting("meeting1", tomorrowAt(9)));
    await Effect.runPromise(runAgainst(google, [personalToWork]));

    const copies = google.events(workCalendar);

    google.deleteEvent(personalCalendar, "meeting1");
    google.failReads(personalCalendar);
    await Effect.runPromiseExit(runAgainst(google, [personalToWork]));

    expect(google.events(workCalendar)).toEqual(copies);
  });
});
