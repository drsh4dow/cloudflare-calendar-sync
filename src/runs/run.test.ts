import { DateTime, Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type { CalendarEvent, EventTime } from "@/google/calendar-event";
import { type FakeGoogleCalendar, makeFakeGoogleCalendar } from "@/google/fake-google-calendar";
import type { SyncRule } from "@/sync-rules/sync-rule";
import { SyncRules } from "@/sync-rules/sync-rules.server";
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

const freelanceToWork: SyncRule = {
  ...personalToWork,
  id: "fedcba9876543210fedcba9876543210",
  sourceCalendarAccountId: freelance,
  sourceCalendarId: freelanceCalendar,
};

function newGoogleCalendar(): FakeGoogleCalendar {
  return makeFakeGoogleCalendar([
    { calendarAccountId: personal, calendarId: personalCalendar, accessRole: "owner" },
    { calendarAccountId: work, calendarId: workCalendar, accessRole: "owner" },
    { calendarAccountId: freelance, calendarId: freelanceCalendar, accessRole: "owner" },
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
    Effect.provide(Layer.mergeAll(google.layer, syncRulesLayer(rules), runStatusLayer(reports))),
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
