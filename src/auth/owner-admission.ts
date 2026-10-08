import type { User, ValidateUserInfoResult, ValidateUserInfoSource } from "better-auth";

/** The `error` query parameter better-auth adds when it turns away a non-Owner. */
export const OWNER_ONLY = "owner_only";

type IncomingIdentity = {
  user: Partial<User>;
  source: ValidateUserInfoSource;
};

/**
 * better-auth's `user.validateUserInfo` gate. Signing in, including the first
 * sign-in that creates the user, admits only the Owner's verified email.
 */
export function admitOnlyOwner(ownerEmail: string) {
  const owner = normalizeOwnerEmail(ownerEmail);

  return function admit(identity: IncomingIdentity): ValidateUserInfoResult | undefined {
    if (identity.source.action === "link-account") {
      // A Calendar Account may use any Google identity (spec Q25). Linking
      // stays closed through `account.accountLinking` until #5 opens it.
      // An explicit link starts only from the Owner's session; better-auth
      // reports implicit links with this action too, so implicit linking
      // must stay disabled.
      return undefined;
    }

    if (identity.user.email === owner && identity.user.emailVerified === true) {
      return undefined;
    }

    return { error: OWNER_ONLY, errorDescription: "This instance only admits its Owner." };
  };
}

/**
 * OWNER_EMAIL as better-auth stores and compares emails: lowercased. The
 * variable is typed by a person, so surrounding spaces are dropped too.
 */
export function normalizeOwnerEmail(ownerEmail: string): string {
  return ownerEmail.trim().toLowerCase();
}
