import { describe, expect, test } from "vite-plus/test";

import { admitOnlyOwner } from "./owner-admission";

const googleSignIn = { method: "oauth", oauth: { providerId: "google" } } as const;

describe("Owner admission", () => {
  const admit = admitOnlyOwner("owner@example.com");

  test("the Owner's first Google sign-in may create their user", () => {
    const verdict = admit({
      user: { email: "owner@example.com", emailVerified: true },
      source: { ...googleSignIn, action: "create-user" },
    });

    expect(verdict).toBeUndefined();
  });

  test("another Google account is turned away before a user is created", () => {
    const verdict = admit({
      user: { email: "visitor@example.com", emailVerified: true },
      source: { ...googleSignIn, action: "create-user" },
    });

    expect(verdict?.error).toBe("owner_only");
  });

  test("OWNER_EMAIL is matched without regard to case or surrounding spaces", () => {
    const admitTypedOwner = admitOnlyOwner(" Owner@Example.com\n");

    const verdict = admitTypedOwner({
      user: { email: "owner@example.com", emailVerified: true },
      source: { ...googleSignIn, action: "sign-in" },
    });

    expect(verdict).toBeUndefined();
  });

  test("a Google account claiming the Owner's email without verifying it is turned away", () => {
    const verdict = admit({
      user: { email: "owner@example.com", emailVerified: false },
      source: { ...googleSignIn, action: "create-user" },
    });

    expect(verdict?.error).toBe("owner_only");
  });
});
