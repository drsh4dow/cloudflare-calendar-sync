import { redirect } from "@tanstack/react-router";

import type { Auth } from "./auth.server";

/**
 * The Owner's session behind the request. Without one, redirects to sign-in.
 * Every server function that reads or changes the Owner's data calls this,
 * since the dashboard's redirect doesn't guard direct calls.
 */
export async function requireOwnerSession(auth: Auth, headers: Headers) {
  const session = await auth.api.getSession({ headers });

  if (session === null) {
    throw redirect({ to: "/sign-in" });
  }

  return session;
}
