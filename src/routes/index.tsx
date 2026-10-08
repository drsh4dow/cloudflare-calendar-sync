import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { CalendarAccounts } from "@/components/calendar-accounts";
import { RunsSection } from "@/components/runs";
import { SyncRulesSection } from "@/components/sync-rules";
import { Button } from "@/components/ui/button";
import { listCalendarAccounts } from "@/auth/calendar-accounts";
import { authClient } from "@/auth/client";
import { getSignedInOwner } from "@/auth/session";
import { listSyncRules } from "@/sync-rules/sync-rules";

type DashboardSearch = { error?: "linkFailed" };

export const Route = createFileRoute("/")({
  // better-auth sends a failed account link back here with an `error` code.
  // Every code gets the same message, and the router rewrites the URL to match.
  validateSearch: (search): DashboardSearch => {
    if (search["error"] === undefined) {
      return {};
    }

    return { error: "linkFailed" };
  },
  beforeLoad: async () => {
    const owner = await getSignedInOwner();

    if (owner === null) {
      throw redirect({ to: "/sign-in" });
    }

    return { owner };
  },
  loader: async () => {
    const [accounts, rules] = await Promise.all([listCalendarAccounts(), listSyncRules()]);

    return { accounts, rules };
  },
  component: Dashboard,
});

function Dashboard() {
  const { owner } = Route.useRouteContext();
  const { accounts, rules } = Route.useLoaderData();
  const search = Route.useSearch();
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
      <main className="mx-auto flex max-w-4xl flex-col gap-10 p-6">
        <CalendarAccounts accounts={accounts} linkFailed={search.error === "linkFailed"} />
        <SyncRulesSection rules={rules} accounts={accounts} />
        <RunsSection />
      </main>
    </div>
  );
}
