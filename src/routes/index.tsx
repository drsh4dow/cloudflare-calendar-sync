import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/auth/client";
import { getSignedInOwner } from "@/auth/session";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const owner = await getSignedInOwner();

    if (owner === null) {
      throw redirect({ to: "/sign-in" });
    }

    return { owner };
  },
  component: Dashboard,
});

function Dashboard() {
  const { owner } = Route.useRouteContext();
  const navigate = useNavigate();
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function signOut() {
    const result = await authClient.signOut();

    if (result.error) {
      setSignOutFailed(true);

      return;
    }

    await navigate({ to: "/sign-in" });
  }

  return (
    <div className="min-h-svh">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-3">
        <span className="shrink-0 font-semibold">Calendar Sync</span>
        <div className="flex min-w-0 items-center gap-3">
          {signOutFailed ? (
            <span role="alert" className="text-sm text-destructive">
              Sign-out failed. Try again.
            </span>
          ) : null}
          <span className="truncate text-sm text-muted-foreground">{owner.email}</span>
          <Button variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl p-6" />
    </div>
  );
}
