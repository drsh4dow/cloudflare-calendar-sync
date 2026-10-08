import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { APIError } from "better-auth/api";
import { Schema } from "effect";

import { deleteCopiesInOtherAccounts } from "@/runs/cleanup";
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
 * Removes a Calendar Account with its tokens and the Sync Rules that read or
 * write through it. First it deletes the Copies the account's Calendars
 * produced in other accounts, since removing the Sync Rules loses track of
 * them; Copies inside the account stay. When that cleanup fails, the account
 * stays connected and retrying continues it.
 *
 * better-auth removes the account only for a session signed in within the
 * last day. An older session gets `signInAgain` after the cleanup has run,
 * and the retry finds nothing left to clean up.
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

    await context.runEffect(deleteCopiesInOtherAccounts(data.calendarAccountId));

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
