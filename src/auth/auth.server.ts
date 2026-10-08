import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import type { WorkerEnv } from "../../alchemy.run";
import { admitOnlyOwner, normalizeOwnerEmail } from "./owner-admission";

/**
 * better-auth for one origin this Worker serves. The origin sets the Google
 * redirect URI and whether cookies are Secure.
 */
export function createAuth(env: WorkerEnv, origin: string) {
  return betterAuth({
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        // The sign-in account is also the first Calendar Account (spec Q25).
        scope: [
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        ],
        accessType: "offline",
        // Forced consent makes Google return a refresh token on every grant;
        // the account chooser lets the Owner pick among signed-in accounts.
        prompt: "select_account consent",
        // better-auth stores ID tokens unencrypted. Turning off sign-in with a
        // client-submitted ID token means a leaked one can't be replayed to
        // sign in; it then holds only identity the user table already stores.
        disableIdTokenSignIn: true,
      },
    },
    account: {
      // Covers access and refresh tokens, not ID tokens.
      encryptOAuthTokens: true,
      accountLinking: {
        // The signed-in Owner links Calendar Accounts with any Google email
        // (spec Q25). Implicit linking would attach another Google identity
        // with the Owner's email at sign-in, and the Owner gate admits every
        // link.
        enabled: true,
        allowDifferentEmails: true,
        disableImplicitLinking: true,
      },
    },
    // Disconnecting goes through `disconnectCalendarAccount`, which refuses
    // the Owner's sign-in account. Server-side `auth.api` calls still reach
    // the endpoint.
    disabledPaths: ["/unlink-account"],
    user: { validateUserInfo: admitOnlyOwner(env.OWNER_EMAIL) },
    hooks: { before: discardHalfCreatedOwner(env.OWNER_EMAIL) },
    // Every failed sign-in, including an expired OAuth state, returns to the
    // sign-in page with an `error` code.
    onAPIError: { errorURL: "/sign-in" },
    // Alchemy's migrations own the schema. With an instance per request, the
    // runtime check would introspect D1 on every request.
    advanced: { database: { validateSchema: false } },
    // Must stay last: it hands cookies set by server-side `auth.api` calls to
    // Start's response.
    plugins: [tanstackStartCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Lets the Owner retry a first sign-in that failed partway.
 *
 * On D1, better-auth creates the Owner's user and their Google account as two
 * separate writes, because D1 has no interactive transactions. If the second
 * write fails, the user exists without an account, and with implicit linking
 * disabled every later sign-in fails with `account_not_linked`. Before each
 * OAuth callback, this deletes the Owner's user when it has no accounts, so
 * the callback creates both again. Such a user never got a session, and a
 * finished Owner can't reach zero accounts: `disconnectCalendarAccount`
 * refuses the sign-in account, and better-auth refuses to unlink a user's
 * last account while `accountLinking.allowUnlinkingAll` is unset.
 */
function discardHalfCreatedOwner(ownerEmail: string) {
  const owner = normalizeOwnerEmail(ownerEmail);

  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/callback/:id") {
      return;
    }

    const { internalAdapter } = ctx.context;
    const existing = await internalAdapter.findUserByEmail(owner, { includeAccounts: true });

    if (existing === null || existing.accounts.length > 0) {
      return;
    }

    await internalAdapter.deleteUser(existing.user.id);
  });
}
