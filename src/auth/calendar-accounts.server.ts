import { redirect } from "@tanstack/react-router";
import { Effect, Layer, Redacted, Schema } from "effect";

import type { Calendar } from "@/google/calendar";
import {
  AccessTokens,
  CalendarAccountNeedsReconnect,
  GoogleCalendar,
} from "@/google/calendar-client";
import type { Auth } from "./auth.server";

export type CalendarAccount = {
  /** better-auth's account row id. */
  readonly id: string;
  readonly email: string;
  /** The Owner signs in with this account, so it can't be disconnected. */
  readonly isSignInAccount: boolean;
};

/** The outcome of listing a Calendar Account's Calendars. */
export type CalendarListing =
  | { readonly kind: "listed"; readonly calendars: ReadonlyArray<Calendar> }
  | { readonly kind: "needsReconnect" }
  | { readonly kind: "unavailable" };

export type ListedCalendarAccount = CalendarAccount & { readonly listing: CalendarListing };

/**
 * The Calendar Accounts of the Owner behind the request's session, in the
 * order they were connected. Without a session, redirects to sign-in.
 */
export async function ownerCalendarAccounts(
  auth: Auth,
  headers: Headers,
): Promise<ReadonlyArray<CalendarAccount>> {
  const session = await auth.api.getSession({ headers });

  if (session === null) {
    throw redirect({ to: "/sign-in" });
  }

  const { internalAdapter } = await auth.$context;
  const accounts = await internalAdapter.findAccounts(session.user.id);

  accounts.sort((first, second) => first.createdAt.getTime() - second.createdAt.getTime());

  return accounts.map((account) => {
    const email = emailFromIdToken(account.idToken);

    return { id: account.id, email, isSignInAccount: email === session.user.email };
  });
}

/** Lists every Calendar Account's Calendars with the session's access tokens. */
export function listCalendars(
  auth: Auth,
  headers: Headers,
  accounts: ReadonlyArray<CalendarAccount>,
): Promise<ReadonlyArray<ListedCalendarAccount>> {
  const google = GoogleCalendar.layer.pipe(Layer.provide(accessTokensForSession(auth, headers)));
  const listed = Effect.forEach(accounts, listAccountCalendars, { concurrency: "unbounded" });

  return Effect.runPromise(listed.pipe(Effect.provide(google)));
}

const IdTokenClaims = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(Schema.Struct({ email: Schema.String }))),
);

const decodeIdTokenClaims = Schema.decodeUnknownSync(IdTokenClaims);

/**
 * The Google email of a Calendar Account, read from the ID token better-auth
 * keeps on the account row. better-auth stores one whenever an account is
 * created or linked again, since it always requests the `openid` scope, and
 * replaces it on token refresh. Reading it needs no call to Google, so the
 * email stays known when the account's tokens stop working. The token came
 * from Google's token endpoint, never from a client, so its signature isn't
 * checked again.
 */
function emailFromIdToken(idToken: string | null | undefined): string {
  const payload = idToken?.split(".")[1];

  return decodeIdTokenClaims(payload).email;
}

/**
 * better-auth reports every failed token refresh as FAILED_TO_GET_ACCESS_TOKEN,
 * whether Google revoked the grant or the refresh request failed, so each
 * failure is offered the one recovery the Owner has: reconnecting.
 */
function accessTokensForSession(auth: Auth, headers: Headers) {
  return Layer.succeed(
    AccessTokens,
    AccessTokens.of({
      forAccount: (calendarAccountId) =>
        Effect.tryPromise({
          try: () => auth.api.getAccessToken({ body: { accountId: calendarAccountId }, headers }),
          catch: (cause) => new CalendarAccountNeedsReconnect({ calendarAccountId, cause }),
        }).pipe(Effect.map((tokens) => Redacted.make(tokens.accessToken))),
    }),
  );
}

const listAccountCalendars = Effect.fn("listAccountCalendars")(function* (
  account: CalendarAccount,
) {
  const google = yield* GoogleCalendar;

  const listing = yield* google.listCalendars(account.id).pipe(
    Effect.map((calendars): CalendarListing => ({ kind: "listed", calendars })),
    Effect.catchTags({
      CalendarAccountNeedsReconnect: (error) =>
        Effect.logWarning("Calendar Account needs reconnect", error).pipe(
          Effect.as<CalendarListing>({ kind: "needsReconnect" }),
        ),
      GoogleCalendarUnavailable: (error) =>
        Effect.logError("Listing Calendars failed", error).pipe(
          Effect.as<CalendarListing>({ kind: "unavailable" }),
        ),
    }),
  );

  return { ...account, listing };
});
