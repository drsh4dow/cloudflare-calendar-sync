import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/auth/client";
import { OWNER_ONLY } from "@/auth/owner-admission";
import { getSignedInOwner } from "@/auth/session";

type SignInProblem = typeof OWNER_ONLY | "failed";

type SignInSearch = { error?: SignInProblem };

export const Route = createFileRoute("/sign-in")({
  // better-auth sends a failed sign-in back here with an `error` code. Codes
  // other than OWNER_ONLY share one message, so they become "failed", and the
  // router rewrites the URL to match.
  validateSearch: (search): SignInSearch => {
    const errorCode = search["error"];

    if (errorCode === undefined) {
      return {};
    }

    if (errorCode === OWNER_ONLY) {
      return { error: OWNER_ONLY };
    }

    return { error: "failed" };
  },
  beforeLoad: async () => {
    if ((await getSignedInOwner()) !== null) {
      throw redirect({ to: "/" });
    }
  },
  component: SignIn,
});

function SignIn() {
  const search = Route.useSearch();
  const [pending, setPending] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const problem = requestFailed ? "failed" : search.error;

  async function signInWithGoogle() {
    setPending(true);
    setRequestFailed(false);

    // On success the client sends the browser to Google, which returns to
    // `callbackURL`, or to this page with an `error` code.
    const result = await authClient.signIn.social({ provider: "google", callbackURL: "/" });

    if (result.error) {
      setPending(false);
      setRequestFailed(true);
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <h1 className="text-2xl font-semibold">Calendar Sync</h1>
        {problem ? <ProblemAlert problem={problem} /> : null}
        <Button size="lg" disabled={pending} onClick={signInWithGoogle}>
          Sign in with Google
        </Button>
      </div>
    </main>
  );
}

function ProblemAlert({ problem }: { problem: SignInProblem }) {
  const messages: Record<SignInProblem, { title: string; description: string }> = {
    [OWNER_ONLY]: {
      title: "Only the Owner can sign in",
      description:
        "The Google account you chose isn't this instance's Owner. Choose the Owner's account to continue.",
    },
    failed: {
      title: "Sign-in didn't finish",
      description: "Google sign-in failed or was cancelled. Try again.",
    },
  };

  const message = messages[problem];

  return (
    <Alert variant="destructive">
      <AlertTitle>{message.title}</AlertTitle>
      <AlertDescription>{message.description}</AlertDescription>
    </Alert>
  );
}
