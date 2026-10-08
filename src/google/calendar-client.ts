import { Context, DateTime, Effect, Layer, type Redacted, Schema, type Types } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { accessRoles, type Calendar } from "./calendar";
import {
  type CalendarEvent,
  type Copy,
  type EventDetails,
  type EventStart,
  type EventTime,
  eventTypes,
  responseStatuses,
  type SyncWindow,
  visibilities,
} from "./calendar-event";

/** Google refuses the Calendar Account's grant; only running consent again restores it. */
export class CalendarAccountNeedsReconnect extends Schema.TaggedError<CalendarAccountNeedsReconnect>()(
  "CalendarAccountNeedsReconnect",
  { calendarAccountId: Schema.String, cause: Schema.Defect() },
) {}

/** A Google Calendar request failed in a way reconnecting doesn't fix, such as an outage. */
export class GoogleCalendarUnavailable extends Schema.TaggedError<GoogleCalendarUnavailable>()(
  "GoogleCalendarUnavailable",
  { calendarAccountId: Schema.String, cause: Schema.Defect() },
) {}

/**
 * The Calendar already holds an event with the Copy's id. Google keeps a
 * deleted event's id, so the event may be live or deleted (ADR 0002).
 */
export class CopyIdTaken extends Schema.TaggedError<CopyIdTaken>()("CopyIdTaken", {
  calendarId: Schema.String,
  copyId: Schema.String,
}) {}

/** OAuth access tokens for Calendar Accounts, by better-auth account id. */
export class AccessTokens extends Context.Service<
  AccessTokens,
  {
    forAccount(
      calendarAccountId: string,
    ): Effect.Effect<Redacted.Redacted, CalendarAccountNeedsReconnect>;
  }
>()("calendar-sync/google/AccessTokens") {}

const CalendarListPage = Schema.Struct({
  items: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        summary: Schema.String,
        summaryOverride: Schema.optionalKey(Schema.String),
        accessRole: Schema.Literals(accessRoles),
      }),
    ),
  ),
  nextPageToken: Schema.optionalKey(Schema.String),
});

// The private extended properties that mark an event as a Copy. Google drops
// keys longer than 44 characters.
const syncRuleIdTag = "calendarSyncRuleId";

const sourceEventIdTag = "calendarSyncSourceEventId";

/** A start or end: `dateTime` for timed events, `date` for all-day ones. */
const EventTimeBound = Schema.Struct({
  dateTime: Schema.optionalKey(Schema.DateTimeUtcFromString),
  date: Schema.optionalKey(Schema.String),
});

type EventTimeBound = typeof EventTimeBound.Type;

/** Deleted events carry little more than their id. */
const CancelledEvent = Schema.Struct({ id: Schema.String, status: Schema.Literal("cancelled") });

const LiveEvent = Schema.Struct({
  id: Schema.String,
  iCalUID: Schema.String,
  originalStartTime: Schema.optionalKey(EventTimeBound),
  eventType: Schema.Literals(eventTypes),
  status: Schema.optionalKey(Schema.Literals(["confirmed", "tentative"])),
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(Schema.String),
  start: EventTimeBound,
  end: EventTimeBound,
  visibility: Schema.optionalKey(Schema.Literals(visibilities)),
  transparency: Schema.optionalKey(Schema.Literals(["opaque", "transparent"])),
  reminders: Schema.optionalKey(
    Schema.Struct({
      useDefault: Schema.Boolean,
      overrides: Schema.optionalKey(Schema.Array(Schema.Struct({}))),
    }),
  ),
  attendees: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        // Marks the entry that stands for the Calendar being listed.
        self: Schema.optionalKey(Schema.Boolean),
        responseStatus: Schema.Literals(responseStatuses),
      }),
    ),
  ),
  extendedProperties: Schema.optionalKey(
    Schema.Struct({
      private: Schema.optionalKey(
        Schema.Struct({ [syncRuleIdTag]: Schema.optionalKey(Schema.String) }),
      ),
    }),
  ),
});

type LiveEvent = typeof LiveEvent.Type;

const EventsPage = Schema.Struct({
  items: Schema.optionalKey(Schema.Array(Schema.Union([CancelledEvent, LiveEvent]))),
  nextPageToken: Schema.optionalKey(Schema.String),
});

const GoogleErrorBody = Schema.Struct({
  error: Schema.Struct({
    errors: Schema.Array(Schema.Struct({ reason: Schema.String })),
  }),
});

type GoogleCalendarError = CalendarAccountNeedsReconnect | GoogleCalendarUnavailable;

export class GoogleCalendar extends Context.Service<
  GoogleCalendar,
  {
    /** Every Calendar on the Calendar Account's calendar list, including hidden ones. */
    listCalendars(
      calendarAccountId: string,
    ): Effect.Effect<ReadonlyArray<Calendar>, GoogleCalendarError>;
    /**
     * Every event that overlaps the window, with each occurrence of a
     * recurring event listed on its own. Succeeds only when Google returned
     * every page, so a missing event was really absent.
     */
    listEvents(
      calendarAccountId: string,
      calendarId: string,
      window: SyncWindow,
    ): Effect.Effect<ReadonlyArray<CalendarEvent>, GoogleCalendarError>;
    /** Writes a new event under the Copy's id, notifying nobody. */
    insertCopy(
      calendarAccountId: string,
      calendarId: string,
      copy: Copy,
    ): Effect.Effect<void, CopyIdTaken | GoogleCalendarError>;
    /**
     * Replaces the event under the Copy's id with the Copy, notifying nobody.
     * Restores the event when it was deleted.
     */
    updateCopy(
      calendarAccountId: string,
      calendarId: string,
      copy: Copy,
    ): Effect.Effect<void, GoogleCalendarError>;
    /** Deletes the Copy, notifying nobody. Succeeds when it is already gone. */
    deleteCopy(
      calendarAccountId: string,
      calendarId: string,
      copyId: string,
    ): Effect.Effect<void, GoogleCalendarError>;
  }
>()("calendar-sync/google/GoogleCalendar") {
  static readonly layer = Layer.effect(
    GoogleCalendar,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const accessTokens = yield* AccessTokens;

      /** Sends the request, failing when Google can't be reached. */
      const send = (calendarAccountId: string, request: HttpClientRequest.HttpClientRequest) =>
        http
          .execute(request)
          .pipe(
            Effect.mapError((cause) => new GoogleCalendarUnavailable({ calendarAccountId, cause })),
          );

      const listCalendars = Effect.fn("GoogleCalendar.listCalendars")(function* (
        calendarAccountId: string,
      ) {
        const accessToken = yield* accessTokens.forAccount(calendarAccountId);
        const calendars: Array<Calendar> = [];
        let pageToken: string | undefined;

        // Google may return a short or empty page before the last one, so only
        // a missing nextPageToken ends the list.
        do {
          const request = HttpClientRequest.get(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList",
          ).pipe(
            HttpClientRequest.bearerToken(accessToken),
            HttpClientRequest.acceptJson,
            HttpClientRequest.setUrlParams({ showHidden: true, maxResults: 250, pageToken }),
          );

          const response = yield* send(calendarAccountId, request);

          if (response.status !== 200) {
            return yield* rejectStatus(calendarAccountId, response);
          }

          const page = yield* HttpClientResponse.schemaBodyJson(CalendarListPage)(response).pipe(
            Effect.mapError((cause) => new GoogleCalendarUnavailable({ calendarAccountId, cause })),
          );

          for (const entry of page.items ?? []) {
            calendars.push({
              id: entry.id,
              name: entry.summaryOverride ?? entry.summary,
              accessRole: entry.accessRole,
            });
          }

          pageToken = page.nextPageToken;
        } while (pageToken !== undefined);

        return calendars;
      });

      const listEvents = Effect.fn("GoogleCalendar.listEvents")(function* (
        calendarAccountId: string,
        calendarId: string,
        window: SyncWindow,
      ) {
        const accessToken = yield* accessTokens.forAccount(calendarAccountId);
        const events: Array<CalendarEvent> = [];
        let pageToken: string | undefined;

        // As with Calendars, only a missing nextPageToken ends the list.
        do {
          const request = HttpClientRequest.get(eventsUrl(calendarId)).pipe(
            HttpClientRequest.bearerToken(accessToken),
            HttpClientRequest.acceptJson,
            HttpClientRequest.setUrlParams({
              singleEvents: true,
              timeMin: DateTime.formatIso(window.start),
              timeMax: DateTime.formatIso(window.end),
              maxResults: 2500,
              pageToken,
            }),
          );

          const response = yield* send(calendarAccountId, request);

          if (response.status !== 200) {
            return yield* rejectStatus(calendarAccountId, response);
          }

          const page = yield* HttpClientResponse.schemaBodyJson(EventsPage)(response).pipe(
            Effect.mapError((cause) => new GoogleCalendarUnavailable({ calendarAccountId, cause })),
          );

          for (const item of page.items ?? []) {
            if (item.status === "cancelled") {
              continue;
            }

            events.push(yield* calendarEventOf(calendarAccountId, item));
          }

          pageToken = page.nextPageToken;
        } while (pageToken !== undefined);

        return events;
      });

      const insertCopy = Effect.fn("GoogleCalendar.insertCopy")(function* (
        calendarAccountId: string,
        calendarId: string,
        copy: Copy,
      ) {
        const accessToken = yield* accessTokens.forAccount(calendarAccountId);

        const request = HttpClientRequest.post(eventsUrl(calendarId)).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.setUrlParams({ sendUpdates: "none" }),
          HttpClientRequest.bodyJsonUnsafe(eventBody(copy)),
        );

        const response = yield* send(calendarAccountId, request);

        // Google answers 409 `duplicate` when the id is taken.
        if (response.status === 409) {
          yield* new CopyIdTaken({ calendarId, copyId: copy.id });
        } else if (!isSuccess(response)) {
          yield* rejectStatus(calendarAccountId, response);
        }
      });

      const updateCopy = Effect.fn("GoogleCalendar.updateCopy")(function* (
        calendarAccountId: string,
        calendarId: string,
        copy: Copy,
      ) {
        const accessToken = yield* accessTokens.forAccount(calendarAccountId);

        const request = HttpClientRequest.put(eventUrl(calendarId, copy.id)).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.setUrlParams({ sendUpdates: "none" }),
          HttpClientRequest.bodyJsonUnsafe(eventBody(copy)),
        );

        const response = yield* send(calendarAccountId, request);

        if (!isSuccess(response)) {
          yield* rejectStatus(calendarAccountId, response);
        }
      });

      const deleteCopy = Effect.fn("GoogleCalendar.deleteCopy")(function* (
        calendarAccountId: string,
        calendarId: string,
        copyId: string,
      ) {
        const accessToken = yield* accessTokens.forAccount(calendarAccountId);

        const request = HttpClientRequest.delete(eventUrl(calendarId, copyId)).pipe(
          HttpClientRequest.bearerToken(accessToken),
          HttpClientRequest.setUrlParams({ sendUpdates: "none" }),
        );

        const response = yield* send(calendarAccountId, request);

        // Google answers 410 for an event that is already deleted, and 404 for
        // one it doesn't know.
        const alreadyGone = response.status === 404 || response.status === 410;

        if (!isSuccess(response) && !alreadyGone) {
          yield* rejectStatus(calendarAccountId, response);
        }
      });

      return GoogleCalendar.of({ listCalendars, listEvents, insertCopy, updateCopy, deleteCopy });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

function eventsUrl(calendarId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
}

function eventUrl(calendarId: string, eventId: string): string {
  return `${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`;
}

function isSuccess(response: HttpClientResponse.HttpClientResponse): boolean {
  return response.status >= 200 && response.status < 300;
}

/** The failure for a status the request doesn't expect. */
function rejectStatus(
  calendarAccountId: string,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, GoogleCalendarError> {
  if (response.status === 401) {
    return Effect.fail(new CalendarAccountNeedsReconnect({ calendarAccountId, cause: 401 }));
  }

  if (response.status === 403) {
    return rejectForbidden(calendarAccountId, response);
  }

  return Effect.fail(new GoogleCalendarUnavailable({ calendarAccountId, cause: response.status }));
}

/**
 * A 403 means reconnect when the grant lacks a Calendar scope, which happens
 * when the Owner unticks a scope on Google's consent screen. Other 403s are
 * rate limits and quotas.
 */
function rejectForbidden(
  calendarAccountId: string,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<never, GoogleCalendarError> {
  return HttpClientResponse.schemaBodyJson(GoogleErrorBody)(response).pipe(
    Effect.mapError((cause) => new GoogleCalendarUnavailable({ calendarAccountId, cause })),
    Effect.flatMap((body): Effect.Effect<never, GoogleCalendarError> => {
      if (body.error.errors.some((error) => error.reason === "insufficientPermissions")) {
        return Effect.fail(new CalendarAccountNeedsReconnect({ calendarAccountId, cause: body }));
      }

      return Effect.fail(new GoogleCalendarUnavailable({ calendarAccountId, cause: body }));
    }),
  );
}

function calendarEventOf(
  calendarAccountId: string,
  event: LiveEvent,
): Effect.Effect<CalendarEvent, GoogleCalendarUnavailable> {
  const time = eventTimeOf(event.start, event.end);

  if (time === undefined) {
    return Effect.fail(
      new GoogleCalendarUnavailable({
        calendarAccountId,
        cause: `Event ${event.id} mixes a timed and an all-day bound`,
      }),
    );
  }

  let originalStart: EventStart | undefined;

  if (event.originalStartTime !== undefined) {
    originalStart = eventStartOf(event.originalStartTime);

    if (originalStart === undefined) {
      return Effect.fail(
        new GoogleCalendarUnavailable({
          calendarAccountId,
          cause: `Event ${event.id} has an original start without a time or date`,
        }),
      );
    }
  }

  const details: Types.Mutable<EventDetails> = {
    time,
    visibility: event.visibility ?? "default",
    busy: event.transparency !== "transparent",
  };

  if (event.summary !== undefined) {
    details.title = event.summary;
  }

  if (event.description !== undefined) {
    details.description = event.description;
  }

  if (event.location !== undefined) {
    details.location = event.location;
  }

  const overrides = event.reminders?.overrides ?? [];
  const attendees = event.attendees ?? [];

  const calendarEvent: Types.Mutable<CalendarEvent> = {
    id: event.id,
    iCalUID: event.iCalUID,
    eventType: event.eventType,
    details,
    hasReminders: event.reminders?.useDefault === true || overrides.length > 0,
    hasAttendees: attendees.length > 0,
  };

  if (originalStart !== undefined) {
    calendarEvent.originalStart = originalStart;
  }

  const ownerResponse = attendees.find((attendee) => attendee.self === true)?.responseStatus;

  if (ownerResponse !== undefined) {
    calendarEvent.ownerResponse = ownerResponse;
  }

  const syncRuleId = event.extendedProperties?.private?.[syncRuleIdTag];

  if (syncRuleId !== undefined) {
    calendarEvent.syncRuleId = syncRuleId;
  }

  return Effect.succeed(calendarEvent);
}

function eventStartOf(bound: EventTimeBound): EventStart | undefined {
  if (bound.dateTime !== undefined) {
    return { kind: "timed", start: bound.dateTime };
  }

  if (bound.date !== undefined) {
    return { kind: "allDay", startDate: bound.date };
  }

  return undefined;
}

function eventTimeOf(start: EventTimeBound, end: EventTimeBound): EventTime | undefined {
  if (start.dateTime !== undefined && end.dateTime !== undefined) {
    return { kind: "timed", start: start.dateTime, end: end.dateTime };
  }

  if (start.date !== undefined && end.date !== undefined) {
    return { kind: "allDay", startDate: start.date, endDate: end.date };
  }

  return undefined;
}

/**
 * The whole event Google stores for a Copy. An update replaces every field,
 * so omitting reminders, attendees, or details clears them. It holds only
 * strings, booleans, and plain objects and arrays of them, so serializing it
 * can't fail.
 */
function eventBody(copy: Copy) {
  const { details } = copy;

  return {
    id: copy.id,
    summary: details.title,
    description: details.description,
    location: details.location,
    ...eventTimeBody(details.time),
    visibility: details.visibility,
    transparency: details.busy ? "opaque" : "transparent",
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: { [syncRuleIdTag]: copy.syncRuleId, [sourceEventIdTag]: copy.sourceEventId },
    },
  };
}

function eventTimeBody(time: EventTime) {
  switch (time.kind) {
    case "timed":
      return {
        start: { dateTime: DateTime.formatIso(time.start) },
        end: { dateTime: DateTime.formatIso(time.end) },
      };
    case "allDay":
      return { start: { date: time.startDate }, end: { date: time.endDate } };
    default: {
      const exhaustive: never = time;

      return exhaustive;
    }
  }
}
