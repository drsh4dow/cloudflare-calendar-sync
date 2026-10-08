import { DateTime, Effect, Layer } from "effect";

import { type AccessRole, type Calendar, isReadable, isWritable } from "./calendar";
import {
  CalendarAccountNeedsReconnect,
  CopyIdTaken,
  GoogleCalendar,
  GoogleCalendarUnavailable,
} from "./calendar-client";
import type { CalendarEvent, Copy, EventTime, SyncWindow } from "./calendar-event";

export type CalendarAccess = {
  readonly calendarAccountId: string;
  readonly calendarId: string;
  readonly accessRole: AccessRole;
};

export type FakeGoogleCalendar = {
  readonly layer: Layer.Layer<GoogleCalendar>;
  /** Adds or replaces an event, as the Owner would in Google Calendar. */
  putEvent(calendarId: string, event: CalendarEvent): void;
  /** Deletes an event, as the Owner would in Google Calendar. */
  deleteEvent(calendarId: string, eventId: string): void;
  /** Makes every later listing of the Calendar fail, as when one of its pages fails. */
  failReads(calendarId: string): void;
  /** Refuses every later request of the Calendar Account, as when the Owner revokes its grant. */
  revokeGrant(calendarAccountId: string): void;
  /** Accepts the Calendar Account's requests again, as after the Owner reconnects it. */
  reconnect(calendarAccountId: string): void;
  /** The Calendar's events that aren't deleted. */
  events(calendarId: string): ReadonlyArray<CalendarEvent>;
  /** The number of insert, update, and delete requests so far. */
  writes(): number;
};

type StoredEvent = { readonly event: CalendarEvent; readonly deleted: boolean };

/**
 * An in-memory Google Calendar for tests, behaving as the real one does where
 * Runs depend on it. A Calendar Account reads only Calendars it has a
 * readable role on and writes only ones it has a writable role on. A deleted
 * event keeps its id taken and drops out of listings. Each request yields
 * first, as a remote call would, so concurrent Runs interleave.
 */
export function makeFakeGoogleCalendar(access: ReadonlyArray<CalendarAccess>): FakeGoogleCalendar {
  const calendars = new Map<string, Map<string, StoredEvent>>();
  const failingReads = new Set<string>();
  const revokedGrants = new Set<string>();
  let writes = 0;

  function calendar(calendarId: string): Map<string, StoredEvent> {
    const existing = calendars.get(calendarId);

    if (existing !== undefined) {
      return existing;
    }

    const created = new Map<string, StoredEvent>();

    calendars.set(calendarId, created);

    return created;
  }

  function putEvent(calendarId: string, event: CalendarEvent): void {
    calendar(calendarId).set(event.id, { event, deleted: false });
  }

  function deleteEvent(calendarId: string, eventId: string): void {
    const stored = calendar(calendarId).get(eventId);

    if (stored !== undefined) {
      calendar(calendarId).set(eventId, { event: stored.event, deleted: true });
    }
  }

  function events(calendarId: string): ReadonlyArray<CalendarEvent> {
    const live: Array<CalendarEvent> = [];

    for (const stored of calendar(calendarId).values()) {
      if (!stored.deleted) {
        live.push(stored.event);
      }
    }

    return live;
  }

  function requireGrant(
    calendarAccountId: string,
  ): Effect.Effect<void, CalendarAccountNeedsReconnect> {
    if (revokedGrants.has(calendarAccountId)) {
      return Effect.fail(new CalendarAccountNeedsReconnect({ calendarAccountId, cause: 401 }));
    }

    return Effect.void;
  }

  const requireAccess = Effect.fnUntraced(function* (
    calendarAccountId: string,
    calendarId: string,
    allows: (calendar: Calendar) => boolean,
  ) {
    yield* requireGrant(calendarAccountId);

    const granted = access.find(
      (candidate) =>
        candidate.calendarAccountId === calendarAccountId && candidate.calendarId === calendarId,
    );

    if (
      granted === undefined ||
      !allows({ id: calendarId, name: calendarId, accessRole: granted.accessRole })
    ) {
      yield* new GoogleCalendarUnavailable({ calendarAccountId, cause: 403 });
    }
  });

  const startWrite = Effect.fnUntraced(function* (calendarAccountId: string, calendarId: string) {
    yield* Effect.yieldNow;
    yield* requireAccess(calendarAccountId, calendarId, isWritable);
    writes += 1;
  });

  const layer = Layer.succeed(
    GoogleCalendar,
    GoogleCalendar.of({
      listCalendars: Effect.fnUntraced(function* (calendarAccountId: string) {
        yield* Effect.yieldNow;
        yield* requireGrant(calendarAccountId);

        const calendarList: Array<Calendar> = [];

        for (const granted of access) {
          if (granted.calendarAccountId === calendarAccountId) {
            calendarList.push({
              id: granted.calendarId,
              name: granted.calendarId,
              accessRole: granted.accessRole,
            });
          }
        }

        return calendarList;
      }),
      listEvents: Effect.fnUntraced(function* (
        calendarAccountId: string,
        calendarId: string,
        window: SyncWindow,
      ) {
        yield* Effect.yieldNow;
        yield* requireAccess(calendarAccountId, calendarId, isReadable);

        if (failingReads.has(calendarId)) {
          return yield* new GoogleCalendarUnavailable({
            calendarAccountId,
            cause: "A page of the listing failed",
          });
        }

        return events(calendarId).filter((event) => overlaps(event.details.time, window));
      }),
      insertCopy: Effect.fnUntraced(function* (
        calendarAccountId: string,
        calendarId: string,
        copy: Copy,
      ) {
        yield* startWrite(calendarAccountId, calendarId);

        if (calendar(calendarId).has(copy.id)) {
          yield* new CopyIdTaken({ calendarId, copyId: copy.id });
        } else {
          putEvent(calendarId, listedCopy(copy));
        }
      }),
      updateCopy: Effect.fnUntraced(function* (
        calendarAccountId: string,
        calendarId: string,
        copy: Copy,
      ) {
        yield* startWrite(calendarAccountId, calendarId);

        if (calendar(calendarId).has(copy.id)) {
          putEvent(calendarId, listedCopy(copy));
        } else {
          yield* new GoogleCalendarUnavailable({ calendarAccountId, cause: 404 });
        }
      }),
      deleteCopy: Effect.fnUntraced(function* (
        calendarAccountId: string,
        calendarId: string,
        copyId: string,
      ) {
        yield* startWrite(calendarAccountId, calendarId);
        deleteEvent(calendarId, copyId);
      }),
    }),
  );

  return {
    layer,
    putEvent,
    deleteEvent,
    failReads: (calendarId) => {
      failingReads.add(calendarId);
    },
    revokeGrant: (calendarAccountId) => {
      revokedGrants.add(calendarAccountId);
    },
    reconnect: (calendarAccountId) => {
      revokedGrants.delete(calendarAccountId);
    },
    events,
    writes: () => writes,
  };
}

/**
 * The Copy as Google lists it after storing it. Google gives an event
 * inserted without an iCalUID one made from its id.
 */
function listedCopy(copy: Copy): CalendarEvent {
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

/** Whether the event overlaps the window, which is how Google's listing selects events. */
function overlaps(time: EventTime, window: SyncWindow): boolean {
  switch (time.kind) {
    case "timed":
      return (
        DateTime.isGreaterThan(time.end, window.start) &&
        DateTime.isLessThan(time.start, window.end)
      );
    case "allDay":
      return (
        time.endDate > DateTime.formatIsoDate(window.start) &&
        time.startDate < DateTime.formatIsoDate(window.end)
      );
    default: {
      const exhaustive: never = time;

      return exhaustive;
    }
  }
}
