import { useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { LocalTime } from "@/components/local-time";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SyncRuleStatus } from "@/runs/run-status";
import { runNow } from "@/runs/runs";

type RunsSectionProps = {
  syncRuleStatuses: ReadonlyArray<SyncRuleStatus>;
};

export function RunsSection({ syncRuleStatuses }: RunsSectionProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start() {
    setRunning(true);
    setFailed(false);

    try {
      await runNow();
      await router.invalidate();
    } catch {
      setFailed(true);
    }

    setRunning(false);
  }

  return (
    <section aria-labelledby="runs-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="runs-heading" className="text-lg font-semibold">
          Runs
        </h2>
        <div className="flex items-center gap-4">
          <output className="text-sm text-muted-foreground">
            {running ? "Running…" : <LastRun syncRuleStatuses={syncRuleStatuses} />}
          </output>
          <Button disabled={running} onClick={start}>
            Run now
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">A Run starts every five minutes.</p>
      {failed ? (
        <Alert variant="destructive">
          <AlertDescription>The Run couldn't finish. Try again in a moment.</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

/**
 * The last Run and how it went, from the Sync Rules it applied. Each Run
 * applies every Sync Rule, so those are the rules whose last Run started
 * latest.
 */
function LastRun({ syncRuleStatuses }: RunsSectionProps) {
  if (syncRuleStatuses.length === 0) {
    return "No Run has applied a Sync Rule yet.";
  }

  const startedAt = Math.max(...syncRuleStatuses.map((status) => status.lastRunAt.getTime()));

  const applied = syncRuleStatuses.filter((status) => status.lastRunAt.getTime() === startedAt);

  const failed = applied.filter((status) => !status.lastRunSucceeded).length;

  return (
    <span className="flex items-center gap-2">
      <span>
        Last Run <LocalTime value={new Date(startedAt)} />
      </span>
      {failed === 0 ? (
        <Badge variant="secondary">Succeeded</Badge>
      ) : (
        <Badge variant="destructive">
          {failed} of {applied.length} Sync Rules failed
        </Badge>
      )}
    </span>
  );
}
