import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { APIError } from "better-auth/api";
import { Schema } from "effect";

import {
  type ListedCalendarAccount,
  listCalendars,
  ownerCalendarAccounts,
} from "./calendar-accounts.server";

export type { CalendarListing, ListedCalendarAccount } from "./calendar-accounts.server";

/** The Owner's Calendar Accounts in the order they were connected, each with its Calendars. */
export const listCalendarAccounts = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<ReadonlyArray<ListedCalendarAccount>> => {
    const headers = getRequestHeaders();
    const accounts = await ownerCalendarAccounts(context.auth, headers);

    return listCalendars(context.auth, headers, accounts);
  },
);

export type DisconnectOutcome = "disconnected" | "signInAgain";

/**
 * Removes a Calendar Account with its tokens. better-auth accepts this only
 * from a session signed in within the last day; an older one gets
 * `signInAgain`.
 */
export const disconnectCalendarAccount = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ calendarAccountId: Schema.String })))
  .handler(async ({ context, data }): Promise<DisconnectOutcome> => {
    const headers = getRequestHeaders();
    const accounts = await ownerCalendarAccounts(context.auth, headers);
    const signInAccount = accounts.find((account) => account.isSignInAccount);

    if (signInAccount?.id === data.calendarAccountId) {
      throw new Error("The Owner's sign-in account can't be disconnected.");
    }

    try {
      await context.auth.api.unlinkAccount({
        body: { accountId: data.calendarAccountId },
        headers,
      });
    } catch (error) {
      if (error instanceof APIError && error.body?.code === "SESSION_NOT_FRESH") {
        return "signInAgain";
      }

      throw error;
    }

    return "disconnected";
  });
