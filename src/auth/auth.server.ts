import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import type { WorkerEnv } from "../../alchemy.run";
import { admitOnlyOwner } from "./owner-admission";

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
      },
    },
    account: {
      // Access and refresh tokens only; better-auth stores ID tokens as is.
      encryptOAuthTokens: true,
      accountLinking: { enabled: false },
    },
    user: { validateUserInfo: admitOnlyOwner(env.OWNER_EMAIL) },
    // Every failed sign-in, including an expired OAuth state, returns to the
    // sign-in page with an `error` code.
    onAPIError: { errorURL: "/sign-in" },
    // Must stay last: it hands cookies set by server-side `auth.api` calls to
    // Start's response.
    plugins: [tanstackStartCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
