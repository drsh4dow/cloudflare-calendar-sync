import { Context, Effect, Layer, type Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { accessRoles, type Calendar } from "./calendar";

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

const GoogleErrorBody = Schema.Struct({
  error: Schema.Struct({
    errors: Schema.Array(Schema.Struct({ reason: Schema.String })),
  }),
});

export class GoogleCalendar extends Context.Service<
  GoogleCalendar,
  {
    /** Every Calendar on the Calendar Account's calendar list, including hidden ones. */
    listCalendars(
      calendarAccountId: string,
    ): Effect.Effect<
      ReadonlyArray<Calendar>,
      CalendarAccountNeedsReconnect | GoogleCalendarUnavailable
    >;
  }
>()("calendar-sync/google/GoogleCalendar") {
  static readonly layer = Layer.effect(
    GoogleCalendar,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const accessTokens = yield* AccessTokens;

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

          const page = yield* http.execute(request).pipe(
            Effect.flatMap(
              HttpClientResponse.matchStatus({
                200: (response) => HttpClientResponse.schemaBodyJson(CalendarListPage)(response),
                401: (response) =>
                  Effect.fail(
                    new CalendarAccountNeedsReconnect({
                      calendarAccountId,
                      cause: response.status,
                    }),
                  ),
                403: (response) => rejectForbidden(calendarAccountId, response),
                orElse: (response) =>
                  Effect.fail(
                    new GoogleCalendarUnavailable({ calendarAccountId, cause: response.status }),
                  ),
              }),
            ),
            Effect.catchTag(["HttpClientError", "SchemaError"], (cause) =>
              Effect.fail(new GoogleCalendarUnavailable({ calendarAccountId, cause })),
            ),
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

      return GoogleCalendar.of({ listCalendars });
    }),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

/**
 * A 403 means reconnect when the grant lacks a Calendar scope, which happens
 * when the Owner unticks a scope on Google's consent screen. Other 403s are
 * rate limits and quotas.
 */
function rejectForbidden(
  calendarAccountId: string,
  response: HttpClientResponse.HttpClientResponse,
) {
  return HttpClientResponse.schemaBodyJson(GoogleErrorBody)(response).pipe(
    Effect.flatMap(
      (body): Effect.Effect<never, CalendarAccountNeedsReconnect | GoogleCalendarUnavailable> => {
        if (body.error.errors.some((error) => error.reason === "insufficientPermissions")) {
          return Effect.fail(new CalendarAccountNeedsReconnect({ calendarAccountId, cause: body }));
        }

        return Effect.fail(new GoogleCalendarUnavailable({ calendarAccountId, cause: body }));
      },
    ),
  );
}
