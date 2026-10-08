import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

type SignedInOwner = { email: string };

/** The Owner behind the request's session, or null when nobody is signed in. */
export const getSignedInOwner = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<SignedInOwner | null> => {
    const session = await context.auth.api.getSession({ headers: getRequestHeaders() });

    if (session === null) {
      return null;
    }

    return { email: session.user.email };
  },
);
