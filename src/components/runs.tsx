import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { runNow } from "@/runs/runs";

type RunState = "idle" | "running" | "finished" | "failed";

export function RunsSection() {
  const [state, setState] = useState<RunState>("idle");

  async function start() {
    setState("running");

    try {
      await runNow();
      setState("finished");
    } catch {
      setState("failed");
    }
  }

  return (
    <section aria-labelledby="runs-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="runs-heading" className="text-lg font-semibold">
          Runs
        </h2>
        <Button disabled={state === "running"} onClick={start}>
          Run now
        </Button>
      </div>
      <output className="text-sm text-muted-foreground">{statusText(state)}</output>
      {state === "failed" ? (
        <Alert variant="destructive">
          <AlertDescription>The Run failed. Try again in a moment.</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

function statusText(state: RunState): string {
  switch (state) {
    case "idle":
    case "failed":
      return "A Run starts every five minutes.";
    case "running":
      return "Running…";
    case "finished":
      return "The Run finished.";
    default: {
      const exhaustive: never = state;

      return exhaustive;
    }
  }
}
