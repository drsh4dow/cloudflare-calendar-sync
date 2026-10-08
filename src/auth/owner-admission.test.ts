import { describe, expect, test } from "vite-plus/test";

import { admitOnlyOwner } from "./owner-admission";

describe("Owner admission", () => {
  const admit = admitOnlyOwner("owner@example.com");
  const googleSignIn = { method: "oauth", oauth: { providerId: "google" } } as const;

  test("the Owner's first Google sign-in may create their user", () => {
    const verdict = admit({
      user: { email: "owner@example.com", emailVerified: true },
      source: { ...googleSignIn, action: "create-user" },
    });

    expect(verdict).toBeUndefined();
  });

  test("another Google account's first sign-in is turned away", () => {
    const verdict = admit({
      user: { email: "visitor@example.com", emailVerified: true },
      source: { ...googleSignIn, action: "create-user" },
    });

    expect(verdict?.error).toBe("owner_only");
  });

  test("the signed-in Owner may link a Google account with another email", () => {
    const verdict = admit({
      user: { email: "freelance@example.com", emailVerified: true },
      source: { ...googleSignIn, action: "link-account" },
    });

    expect(verdict).toBeUndefined();
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
