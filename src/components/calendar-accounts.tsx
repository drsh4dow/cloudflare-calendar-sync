import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authClient } from "@/auth/client";
import {
  type CalendarListing,
  disconnectCalendarAccount,
  type ListedCalendarAccount,
} from "@/auth/calendar-accounts";
import { type Calendar, isReadable, isWritable } from "@/google/calendar";

type CalendarAccountsProps = {
  accounts: ReadonlyArray<ListedCalendarAccount>;
  /** Google sent the browser back from connecting or reconnecting with an error. */
  linkFailed: boolean;
};

export function CalendarAccounts({ accounts, linkFailed }: CalendarAccountsProps) {
  const [connecting, setConnecting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);

  async function connect() {
    setConnecting(true);
    setConnectFailed(false);

    if (await linkGoogleAccount(undefined)) {
      return;
    }

    setConnecting(false);
    setConnectFailed(true);
  }

  return (
    <section aria-labelledby="calendar-accounts-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="calendar-accounts-heading" className="text-lg font-semibold">
          Calendar Accounts
        </h2>
        <Button disabled={connecting} onClick={connect}>
          Connect Google account
        </Button>
      </div>
      {linkFailed || connectFailed ? (
        <Alert variant="destructive">
          <AlertTitle>Connecting didn't finish</AlertTitle>
          <AlertDescription>Google sign-in failed or was cancelled. Try again.</AlertDescription>
        </Alert>
      ) : null}
      <ul className="flex flex-col gap-4">
        {accounts.map((account) => (
          <CalendarAccountItem key={account.id} account={account} />
        ))}
      </ul>
    </section>
  );
}

type AccountProblem = "reconnectFailed" | "signInAgain" | "disconnectFailed";

function CalendarAccountItem({ account }: { account: ListedCalendarAccount }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<AccountProblem | null>(null);

  async function reconnect() {
    setPending(true);
    setProblem(null);

    // Google offers the account chooser with this account preselected.
    // Choosing it updates this Calendar Account; choosing another connects
    // that one as a new Calendar Account.
    if (await linkGoogleAccount(account.email)) {
      return;
    }

    setPending(false);
    setProblem("reconnectFailed");
  }

  async function disconnect() {
    setPending(true);
    setProblem(null);

    try {
      const outcome = await disconnectCalendarAccount({ data: { calendarAccountId: account.id } });

      if (outcome === "signInAgain") {
        setProblem("signInAgain");
      }

      await router.invalidate();
    } catch {
      setProblem("disconnectFailed");
    }

    setPending(false);
  }

  const needsReconnect = account.listing.kind === "needsReconnect";

  return (
    <li className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{account.email}</span>
          {account.isSignInAccount ? <Badge variant="secondary">Sign-in account</Badge> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant={needsReconnect ? "default" : "outline"}
            size="sm"
            disabled={pending}
            onClick={reconnect}
          >
            Reconnect
          </Button>
          {account.isSignInAccount ? null : (
            <DisconnectButton email={account.email} disabled={pending} onConfirm={disconnect} />
          )}
        </div>
      </div>
      {problem === null ? null : <AccountProblemAlert problem={problem} />}
      <CalendarList listing={account.listing} />
    </li>
  );
}

type DisconnectButtonProps = {
  email: string;
  disabled: boolean;
  onConfirm: () => void;
};

function DisconnectButton({ email, disabled, onConfirm }: DisconnectButtonProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          Disconnect
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Calendar Sync stops using this account and deletes its stored tokens. The account's
            calendars in Google stay as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Disconnect
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AccountProblemAlert({ problem }: { problem: AccountProblem }) {
  const messages: Record<AccountProblem, string> = {
    reconnectFailed: "Reconnecting couldn't start. Try again.",
    signInAgain:
      "Disconnecting needs a sign-in from the last 24 hours. Sign out, sign in again, and retry.",
    disconnectFailed: "Disconnecting failed. Try again.",
  };

  return (
    <div className="px-4 pt-3">
      <Alert variant="destructive">
        <AlertDescription>{messages[problem]}</AlertDescription>
      </Alert>
    </div>
  );
}

function CalendarList({ listing }: { listing: CalendarListing }) {
  switch (listing.kind) {
    case "listed":
      if (listing.calendars.length === 0) {
        return <p className="px-4 py-3 text-sm text-muted-foreground">No calendars.</p>;
      }

      return (
        <ul className="divide-y">
          {listing.calendars.map((calendar) => (
            <li key={calendar.id} className="flex items-center justify-between gap-4 px-4 py-2">
              <span className="min-w-0 truncate text-sm">{calendar.name}</span>
              <Badge variant="outline">{accessLabel(calendar)}</Badge>
            </li>
          ))}
        </ul>
      );
    case "needsReconnect":
      return (
        <ListingAlert
          title="Google no longer accepts this account's access"
          description="The grant expired, was revoked, or lacks calendar access. Reconnect to restore it."
        />
      );
    case "unavailable":
      return (
        <ListingAlert
          title="Couldn't load this account's calendars"
          description="Google Calendar didn't answer as expected. Reload the page to try again."
        />
      );
    default: {
      const exhaustive: never = listing;

      return exhaustive;
    }
  }
}

function ListingAlert({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-4">
      <Alert variant="destructive">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    </div>
  );
}

function accessLabel(calendar: Calendar): string {
  if (isWritable(calendar)) {
    return "Readable and writable";
  }

  if (isReadable(calendar)) {
    return "Readable";
  }

  return "Free/busy only";
}

/**
 * Sends the browser to Google to link an account to the Owner, and back to
 * the dashboard afterwards. Returns false when the request to start failed.
 */
async function linkGoogleAccount(loginHint: string | undefined): Promise<boolean> {
  const result = await authClient.linkSocial({
    provider: "google",
    callbackURL: "/",
    errorCallbackURL: "/",
    loginHint,
  });

  return result.error === null;
}
