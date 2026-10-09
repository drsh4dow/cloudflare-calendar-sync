import { DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import type { CalendarEvent, EventTime } from "@/google/calendar-event";
import { type FakeGoogleCalendar, makeFakeGoogleCalendar } from "@/google/fake-google-calendar";
import type { SyncRule } from "@/sync-rules/sync-rule";
import { SyncRules } from "@/sync-rules/sync-rules.server";
import { deleteCopiesInOtherAccounts, deleteSyncRuleWithCopies } from "./cleanup";
import { run, RunFailed } from "./run";
import { type RunReport, RunStatusStore } from "./run-status.server";

const personal = "personal-account";

const work = "work-account";

const personalCalendar = "personal@example.com";

const workCalendar = "work@example.com";

const freelance = "freelance-account";

const freelanceCalendar = "freelance@example.com";

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
    { calendarAccountId: freelance, calendarId: freelanceCalendar, accessRole: "owner" },
  ]);
}

type StoredSyncRules = {
  readonly layer: Layer.Layer<SyncRules>;
  /** The Sync Rules that weren't deleted. */
  rules(): ReadonlyArray<SyncRule>;
};

/** Sync Rules kept in memory, standing in for D1. */
function storeSyncRules(initial: ReadonlyArray<SyncRule>): StoredSyncRules {
  let rules = initial;
  const deletedIds: Array<string> = [];

  const layer = Layer.succeed(
    SyncRules,
    SyncRules.of({
      list: Effect.sync(() => rules),
      deletedIds: Effect.sync(() => deletedIds),
      create: () => Effect.die("Runs and cleanup don't create Sync Rules"),
      update: () => Effect.die("Runs and cleanup don't update Sync Rules"),
      delete: (id) =>
        Effect.sync(() => {
          if (rules.some((rule) => rule.id === id)) {
            deletedIds.push(id);
          }

          rules = rules.filter((rule) => rule.id !== id);
        }),
    }),
  );

  return { layer, rules: () => rules };
}

/** Run status that keeps each Run's report in `reports`, standing in for D1. */
function runStatusLayer(reports: Array<RunReport>) {
  return Layer.succeed(
    RunStatusStore,
    RunStatusStore.of({
      record: (report) =>
        Effect.sync(() => {
          reports.push(report);
        }),
      read: Effect.die("Runs don't read Run status"),
    }),
  );
}

function runAgainst(
  google: FakeGoogleCalendar,
  rules: ReadonlyArray<SyncRule>,
  reports: Array<RunReport> = [],
) {
  return run.pipe(
    Effect.provide(
      Layer.mergeAll(google.layer, storeSyncRules(rules).layer, runStatusLayer(reports)),
    ),
  );
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
  const freelanceToWork: SyncRule = {
    ...personalToWork,
    id: "fedcba9876543210fedcba9876543210",
    sourceCalendarAccountId: freelance,
    sourceCalendarId: freelanceCalendar,
  };

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

  test("turning all-day events off removes an all-day Copy whose day hasn't ended in the Target Calendar's time zone", async () => {
    const google = newGoogleCalendar();
    const withAllDay: SyncRule = { ...personalToWork, includeAllDayEvents: true };
    const october9: EventTime = { kind: "allDay", startDate: "2026-10-09", endDate: "2026-10-10" };

    google.setTimeZone(personalCalendar, "America/Santiago");
    google.setTimeZone(workCalendar, "America/Santiago");
    google.putEvent(personalCalendar, meeting("holiday", october9));

    const program = Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-10-09T15:00:00Z"));
      yield* run.pipe(Effect.provide(storeSyncRules([withAllDay]).layer));
      // 22:00 on October 9 in Santiago, already October 10 in UTC.
      yield* TestClock.setTime(Date.parse("2026-10-10T01:00:00Z"));
      yield* run.pipe(Effect.provide(storeSyncRules([personalToWork]).layer));
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(Layer.mergeAll(google.layer, runStatusLayer([]), TestClock.layer())),
      ),
    );

    expect(google.events(workCalendar)).toEqual([]);
  });

  test("deletes the Copies of a deleted Sync Rule that an overlapping Run wrote after its cleanup", async () => {
    const google = newGoogleCalendar();
    const syncRules = storeSyncRules([personalToWork, freelanceToWork]);
    const services = Layer.mergeAll(google.layer, syncRules.layer, runStatusLayer([]));
    const standup = meeting("standup", tomorrowAt(11));

    // Written by another instance, such as the dev stage, whose Sync Rules
    // this one never had.
    const anotherInstancesCopy: CalendarEvent = {
      ...meeting("another-instances-copy", tomorrowAt(13)),
      syncRuleId: "00000000000000000000000000000000",
    };

    google.putEvent(personalCalendar, meeting("dentist", tomorrowAt(9)));
    google.putEvent(freelanceCalendar, meeting("gig", tomorrowAt(15)));
    google.putEvent(workCalendar, standup);
    google.putEvent(workCalendar, anotherInstancesCopy);
    await Effect.runPromise(run.pipe(Effect.provide(services)));

    // The rule is gone, but its Copies remain, as when a Run that loaded it
    // earlier wrote them after the cleanup listed the Target Calendar.
    await Effect.runPromise(
      SyncRules.use((rules) => rules.delete(freelanceToWork.id)).pipe(Effect.provide(services)),
    );

    await Effect.runPromise(run.pipe(Effect.provide(services)));

    expect(google.events(workCalendar)).toEqual([
      standup,
      anotherInstancesCopy,
      expect.objectContaining({ syncRuleId: personalToWork.id }),
    ]);
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

  test("a revoked Calendar Account fails only the Sync Rules that use it, then the Run", async () => {
    const google = newGoogleCalendar();

    google.putEvent(freelanceCalendar, meeting("gig", tomorrowAt(9)));
    google.putEvent(personalCalendar, meeting("dentist", tomorrowAt(14)));
    google.revokeGrant(freelance);

    const failure = await Effect.runPromise(
      Effect.flip(runAgainst(google, [freelanceToWork, personalToWork])),
    );

    expect(google.events(workCalendar)).toEqual([
      expect.objectContaining({ syncRuleId: personalToWork.id }),
    ]);

    expect(failure).toEqual(new RunFailed({ failedSyncRules: 1 }));
  });

  test("a Source Event whose id is too long for a Copy id fails only its Sync Rule, which still writes its other Copies", async () => {
    const google = newGoogleCalendar();
    const reports: Array<RunReport> = [];

    // A Copy id is the 32-character Sync Rule id and two characters per
    // character of the source event id, and Google allows 1024 (ADR 0002).
    google.putEvent(personalCalendar, meeting("a".repeat(496), tomorrowAt(9)));
    google.putEvent(personalCalendar, meeting("b".repeat(497), tomorrowAt(11)));
    google.putEvent(freelanceCalendar, meeting("gig", tomorrowAt(14)));

    const failure = await Effect.runPromise(
      Effect.flip(runAgainst(google, [personalToWork, freelanceToWork], reports)),
    );

    expect(google.events(workCalendar)).toEqual([
      copyInWork(tomorrowAt(9)),
      expect.objectContaining({ syncRuleId: freelanceToWork.id }),
    ]);

    expect(failure).toEqual(new RunFailed({ failedSyncRules: 1 }));

    expect(reports[0]).toEqual({
      startedAt: expect.anything(),
      syncRules: [
        { syncRuleId: personalToWork.id, succeeded: false },
        { syncRuleId: freelanceToWork.id, succeeded: true },
      ],
      calendarAccounts: expect.arrayContaining([{ calendarAccountId: work, problem: null }]),
    });
  });

  test("records which Sync Rules failed and which Calendar Account needs reconnect", async () => {
    const google = newGoogleCalendar();
    const reports: Array<RunReport> = [];

    google.revokeGrant(freelance);
    await Effect.runPromiseExit(runAgainst(google, [freelanceToWork, personalToWork], reports));

    expect(reports).toEqual([
      {
        startedAt: expect.anything(),
        syncRules: [
          { syncRuleId: freelanceToWork.id, succeeded: false },
          { syncRuleId: personalToWork.id, succeeded: true },
        ],
        calendarAccounts: expect.arrayContaining([
          { calendarAccountId: freelance, problem: "needsReconnect" },
          { calendarAccountId: personal, problem: null },
          { calendarAccountId: work, problem: null },
        ]),
      },
    ]);

    expect(reports[0]?.calendarAccounts).toHaveLength(3);
  });

  test("the first Run after reconnecting clears the Calendar Account's problem", async () => {
    const google = newGoogleCalendar();
    const reports: Array<RunReport> = [];

    google.revokeGrant(freelance);
    await Effect.runPromiseExit(runAgainst(google, [freelanceToWork], reports));
    google.reconnect(freelance);
    await Effect.runPromise(runAgainst(google, [freelanceToWork], reports));

    expect(reports.at(-1)).toEqual({
      startedAt: expect.anything(),
      syncRules: [{ syncRuleId: freelanceToWork.id, succeeded: true }],
      calendarAccounts: expect.arrayContaining([
        { calendarAccountId: freelance, problem: null },
        { calendarAccountId: work, problem: null },
      ]),
    });
  });

  test("a failed listing records a problem that reconnecting doesn't fix", async () => {
    const google = newGoogleCalendar();
    const reports: Array<RunReport> = [];

    google.failReads(freelanceCalendar);
    await Effect.runPromiseExit(runAgainst(google, [freelanceToWork], reports));

    expect(reports[0]?.calendarAccounts).toEqual([
      { calendarAccountId: freelance, problem: "unavailable" },
    ]);
  });
});

/** A Private Mode Copy that `personalToWork` writes, as Google lists it. */
function copyInWork(time: EventTime) {
  return expect.objectContaining({
    syncRuleId: personalToWork.id,
    details: { title: "Busy", time, visibility: "private", busy: true },
  });
}

describe("deleting a Sync Rule", () => {
  test("deletes its Copies that haven't ended, and no other event", async () => {
    const google = newGoogleCalendar();
    const syncRules = storeSyncRules([personalToWork]);
    const standup = meeting("standup", tomorrowAt(11));

    const anotherRulesCopy: CalendarEvent = {
      ...meeting("another-rules-copy", tomorrowAt(13)),
      syncRuleId: "00000000000000000000000000000000",
    };

    google.putEvent(personalCalendar, meeting("breakfast", tomorrowAt(8)));
    google.putEvent(personalCalendar, meeting("lunch", tomorrowAt(12)));
    google.putEvent(workCalendar, standup);
    google.putEvent(workCalendar, anotherRulesCopy);

    const tenTomorrow = DateTime.makeUnsafe(Date.now()).pipe(
      DateTime.startOf("day"),
      DateTime.add({ days: 1, hours: 10 }),
    );

    const program = Effect.gen(function* () {
      yield* TestClock.setTime(Date.now());
      yield* run;
      // Breakfast has ended by ten tomorrow; lunch hasn't.
      yield* TestClock.setTime(DateTime.toEpochMillis(tenTomorrow));
      yield* deleteSyncRuleWithCopies(personalToWork.id);
    });

    const services = Layer.mergeAll(
      google.layer,
      syncRules.layer,
      runStatusLayer([]),
      TestClock.layer(),
    );

    await Effect.runPromise(program.pipe(Effect.provide(services)));

    expect(google.events(workCalendar)).toEqual([
      standup,
      anotherRulesCopy,
      copyInWork(tomorrowAt(8)),
    ]);
    expect(syncRules.rules()).toEqual([]);
  });

  test("deletes its Copies beyond the Sync Window", async () => {
    const google = newGoogleCalendar();
    const syncRules = storeSyncRules([personalToWork]);
    const services = Layer.mergeAll(google.layer, syncRules.layer, runStatusLayer([]));

    google.putEvent(personalCalendar, meeting("meeting1", tomorrowAt(9)));
    await Effect.runPromise(run.pipe(Effect.provide(services)));

    // The Owner moves the Copy 90 days ahead in Google Calendar.
    const [copy] = google.events(workCalendar);

    const start = DateTime.makeUnsafe(Date.now()).pipe(
      DateTime.startOf("day"),
      DateTime.add({ days: 90, hours: 9 }),
    );

    const ninetyDaysAhead: EventTime = {
      kind: "timed",
      start,
      end: DateTime.add(start, { hours: 1 }),
    };

    google.putEvent(workCalendar, {
      ...copy!,
      details: { ...copy!.details, time: ninetyDaysAhead },
    });

    await Effect.runPromise(
      deleteSyncRuleWithCopies(personalToWork.id).pipe(Effect.provide(services)),
    );

    expect(google.events(workCalendar)).toEqual([]);
  });

  test("keeps the Sync Rule when its Target Calendar can't be read, so deleting again can finish", async () => {
    const google = newGoogleCalendar();
    const syncRules = storeSyncRules([personalToWork]);
    const services = Layer.mergeAll(google.layer, syncRules.layer, runStatusLayer([]));

    google.putEvent(personalCalendar, meeting("meeting1", tomorrowAt(9)));
    await Effect.runPromise(run.pipe(Effect.provide(services)));
    google.failReads(workCalendar);

    await Effect.runPromiseExit(
      deleteSyncRuleWithCopies(personalToWork.id).pipe(Effect.provide(services)),
    );

    expect(syncRules.rules()).toEqual([personalToWork]);
    expect(google.events(workCalendar)).toEqual([copyInWork(tomorrowAt(9))]);
  });
});

describe("disconnecting a Calendar Account", () => {
  test("starts by deleting the Copies its Calendars produced in other accounts, leaving those inside it", async () => {
    const workToPersonal: SyncRule = {
      ...personalToWork,
      id: "abcdef0123456789abcdef0123456789",
      sourceCalendarAccountId: work,
      sourceCalendarId: workCalendar,
      targetCalendarAccountId: personal,
      targetCalendarId: personalCalendar,
    };

    const google = newGoogleCalendar();
    const syncRules = storeSyncRules([personalToWork, workToPersonal]);
    const services = Layer.mergeAll(google.layer, syncRules.layer, runStatusLayer([]));
    const dentist = meeting("dentist", tomorrowAt(9));
    const standup = meeting("standup", tomorrowAt(11));

    google.putEvent(personalCalendar, dentist);
    google.putEvent(workCalendar, standup);
    await Effect.runPromise(run.pipe(Effect.provide(services)));
    await Effect.runPromise(deleteCopiesInOtherAccounts(personal).pipe(Effect.provide(services)));

    expect(google.events(workCalendar)).toEqual([standup]);
    expect(google.events(personalCalendar)).toEqual([
      dentist,
      expect.objectContaining({ syncRuleId: workToPersonal.id }),
    ]);
    expect(syncRules.rules()).toEqual([workToPersonal]);
  });
});
