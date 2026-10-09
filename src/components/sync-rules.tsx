import { useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import { type FormEvent, useId, useState } from "react";

import { LocalTime } from "@/components/local-time";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListedCalendarAccount } from "@/auth/calendar-accounts";
import { type Calendar, isReadable, isWritable } from "@/google/calendar";
import type { SyncRuleStatus } from "@/runs/run-status";
import {
  defaultSyncRuleSettings,
  Mode,
  type SyncRule,
  type SyncRuleSettings,
} from "@/sync-rules/sync-rule";
import { createSyncRule, deleteSyncRule, updateSyncRule } from "@/sync-rules/sync-rules";

type SyncRulesSectionProps = {
  rules: ReadonlyArray<SyncRule>;
  accounts: ReadonlyArray<ListedCalendarAccount>;
};

export function SyncRulesSection({
  rules,
  accounts,
  statuses,
}: SyncRulesSectionProps & { statuses: ReadonlyArray<SyncRuleStatus> }) {
  const statusByRule = new Map(statuses.map((status) => [status.syncRuleId, status]));

  return (
    <section aria-labelledby="sync-rules-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="sync-rules-heading" className="text-lg font-semibold">
          Sync Rules
        </h2>
        <CreateSyncRuleDialog rules={rules} accounts={accounts} />
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Sync Rules yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source Calendar</TableHead>
              <TableHead>Target Calendar</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>All-day events</TableHead>
              <TableHead>Last synced</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((rule) => (
              <SyncRuleTableRow
                key={rule.id}
                rule={rule}
                accounts={accounts}
                status={statusByRule.get(rule.id)}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** How the dashboard names a Calendar: its name and the Calendar Account that reaches it. */
type CalendarLabel = { name: string; email: string };

/**
 * The Calendar's label from the Calendar Accounts' listings. When its account's
 * listing failed, only the Calendar's id is known.
 */
function labelCalendar(
  accounts: ReadonlyArray<ListedCalendarAccount>,
  calendarAccountId: string,
  calendarId: string,
): CalendarLabel {
  const account = accounts.find((candidate) => candidate.id === calendarAccountId);

  if (account === undefined) {
    return { name: calendarId, email: calendarAccountId };
  }

  if (account.listing.kind !== "listed") {
    return { name: calendarId, email: account.email };
  }

  const calendar = account.listing.calendars.find((candidate) => candidate.id === calendarId);

  return { name: calendar?.name ?? calendarId, email: account.email };
}

function describeCalendar(label: CalendarLabel): string {
  return `${label.name} (${label.email})`;
}

type SyncRuleTableRowProps = {
  rule: SyncRule;
  accounts: ReadonlyArray<ListedCalendarAccount>;
  /** Absent until a Run applies the rule. */
  status: SyncRuleStatus | undefined;
};

function SyncRuleTableRow({ rule, accounts, status }: SyncRuleTableRowProps) {
  const source = labelCalendar(accounts, rule.sourceCalendarAccountId, rule.sourceCalendarId);
  const target = labelCalendar(accounts, rule.targetCalendarAccountId, rule.targetCalendarId);

  return (
    <TableRow>
      <TableCell>
        <CalendarName label={source} />
      </TableCell>
      <TableCell>
        <CalendarName label={target} />
      </TableCell>
      <TableCell>{modeLabel(rule)}</TableCell>
      <TableCell>{rule.includeAllDayEvents ? "Copied" : "Skipped"}</TableCell>
      <TableCell>
        <LastSynced status={status} />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <EditSyncRuleDialog rule={rule} source={source} target={target} />
          <DeleteSyncRuleButton rule={rule} source={source} target={target} />
        </div>
      </TableCell>
    </TableRow>
  );
}

function CalendarName({ label }: { label: CalendarLabel }) {
  return (
    <div className="flex flex-col">
      <span>{label.name}</span>
      <span className="text-xs text-muted-foreground">{label.email}</span>
    </div>
  );
}

/** When a Run last applied the Sync Rule without a failure, and whether the last Run failed it. */
function LastSynced({ status }: { status: SyncRuleStatus | undefined }) {
  if (status === undefined) {
    return <span className="text-muted-foreground">Waiting for the next Run</span>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {status.lastSucceededAt === null ? (
        <span>Never</span>
      ) : (
        <LocalTime value={status.lastSucceededAt} />
      )}
      {status.lastRunSucceeded ? null : <Badge variant="destructive">Last Run failed</Badge>}
    </div>
  );
}

function modeLabel(rule: SyncRule): string {
  if (rule.mode === "private") {
    return `Private, titled "${rule.privateTitle}"`;
  }

  return "Transparent";
}

type SyncRuleActionProps = {
  rule: SyncRule;
  source: CalendarLabel;
  target: CalendarLabel;
};

function DeleteSyncRuleButton({ rule, source, target }: SyncRuleActionProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function remove() {
    setPending(true);
    setFailed(false);

    try {
      await deleteSyncRule({ data: { id: rule.id } });
      await router.invalidate();
    } catch {
      setFailed(true);
    }

    setPending(false);
  }

  return (
    <>
      {failed ? (
        <span role="alert" className="self-center text-sm text-destructive">
          Deleting failed. Try again.
        </span>
      ) : null}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={pending}>
            Delete
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this Sync Rule?</AlertDialogTitle>
            <AlertDialogDescription>
              Calendar Sync stops copying events from {describeCalendar(source)} into{" "}
              {describeCalendar(target)} and deletes the Copies there that haven't ended.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function EditSyncRuleDialog({ rule, source, target }: SyncRuleActionProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Sync Rule</DialogTitle>
          <DialogDescription>
            From {describeCalendar(source)} to {describeCalendar(target)}. Source and Target can't
            change; to use other Calendars, create another Sync Rule.
          </DialogDescription>
        </DialogHeader>
        <EditSyncRuleForm rule={rule} onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditSyncRuleForm({ rule, onSaved }: { rule: SyncRule; onSaved: () => void }) {
  const router = useRouter();

  const [settings, setSettings] = useState<SyncRuleSettings>({
    mode: rule.mode,
    privateTitle: rule.privateTitle,
    includeAllDayEvents: rule.includeAllDayEvents,
  });

  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);

    try {
      await updateSyncRule({ data: { id: rule.id, settings: withTrimmedTitle(settings) } });
      await router.invalidate();
      onSaved();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <SyncRuleSettingsFields settings={settings} onChange={setSettings} />
      {failed ? <FormFailure message="Saving failed. Try again." /> : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || !hasPrivateTitle(settings)}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function CreateSyncRuleDialog({ rules, accounts }: SyncRulesSectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Create Sync Rule</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Sync Rule</DialogTitle>
          <DialogDescription>
            Each Run copies events from the Source Calendar into the Target Calendar.
          </DialogDescription>
        </DialogHeader>
        <CreateSyncRuleForm rules={rules} accounts={accounts} onCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

type CreateSyncRuleFormProps = SyncRulesSectionProps & { onCreated: () => void };

function CreateSyncRuleForm({ rules, accounts, onCreated }: CreateSyncRuleFormProps) {
  const router = useRouter();
  const id = useId();
  // Radix Select shows its placeholder for the empty value.
  const [sourceKey, setSourceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [settings, setSettings] = useState(defaultSyncRuleSettings);
  const [alsoCreateReverse, setAlsoCreateReverse] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const sourceGroups = calendarGroups(accounts, isReadable);
  const targetGroups = calendarGroups(accounts, isWritable);
  const source = findChoice(sourceGroups, sourceKey);
  const target = findChoice(targetGroups, targetKey);
  const problem = pairingProblem(rules, source, target);
  const reverseAllowed = source !== undefined && isWritable(source.calendar);

  const pairingProblemMessages: Record<PairingProblem, string> = {
    sameCalendar: "Source and Target must be different Calendars.",
    ruleExists: "A Sync Rule from this Source Calendar to this Target Calendar already exists.",
  };

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (source === undefined || target === undefined) {
      return;
    }

    setPending(true);
    setFailed(false);

    try {
      await createSyncRule({
        data: {
          sourceCalendarAccountId: source.calendarAccountId,
          sourceCalendarId: source.calendar.id,
          targetCalendarAccountId: target.calendarAccountId,
          targetCalendarId: target.calendar.id,
          ...withTrimmedTitle(settings),
          alsoCreateReverse: alsoCreateReverse && reverseAllowed,
        },
      });
      await router.invalidate();
      onCreated();
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  const ready =
    source !== undefined && target !== undefined && problem === null && hasPrivateTitle(settings);

  return (
    <form onSubmit={create} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-source`}>Source Calendar</Label>
        <CalendarSelect
          id={`${id}-source`}
          groups={sourceGroups}
          value={sourceKey}
          onValueChange={setSourceKey}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-target`}>Target Calendar</Label>
        <CalendarSelect
          id={`${id}-target`}
          groups={targetGroups}
          value={targetKey}
          onValueChange={setTargetKey}
        />
        <p className="text-sm text-muted-foreground">
          Only Calendars their account can write are listed.
        </p>
        {problem === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {pairingProblemMessages[problem]}
          </p>
        )}
      </div>
      <SyncRuleSettingsFields settings={settings} onChange={setSettings} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`${id}-reverse`}
            checked={alsoCreateReverse && reverseAllowed}
            disabled={!reverseAllowed}
            onCheckedChange={(checked) => setAlsoCreateReverse(checked === true)}
          />
          <Label htmlFor={`${id}-reverse`}>
            Also create the reverse Sync Rule, from Target to Source
          </Label>
        </div>
        {source !== undefined && !reverseAllowed ? (
          <p className="text-sm text-muted-foreground">
            The Source Calendar's account can't write it, so it can't be a Target.
          </p>
        ) : null}
      </div>
      {failed ? <FormFailure message="Creating the Sync Rule failed. Try again." /> : null}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || !ready}>
          Create
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A Calendar offered in a Calendar select, with the Calendar Account that reaches it. */
type CalendarChoice = {
  /** Identifies the choice among the select's values. */
  key: string;
  calendarAccountId: string;
  calendar: Calendar;
};

type CalendarGroup = { email: string; choices: ReadonlyArray<CalendarChoice> };

/** The Calendars that qualify, grouped by Calendar Account in connection order. */
function calendarGroups(
  accounts: ReadonlyArray<ListedCalendarAccount>,
  qualifies: (calendar: Calendar) => boolean,
): ReadonlyArray<CalendarGroup> {
  const groups: Array<CalendarGroup> = [];

  for (const account of accounts) {
    if (account.listing.kind !== "listed") {
      continue;
    }

    const choices = account.listing.calendars.flatMap((calendar) => {
      if (!qualifies(calendar)) {
        return [];
      }

      // The same Calendar can be reached from two accounts, so the key names both.
      return [
        { key: JSON.stringify([account.id, calendar.id]), calendarAccountId: account.id, calendar },
      ];
    });

    if (choices.length > 0) {
      groups.push({ email: account.email, choices });
    }
  }

  return groups;
}

function findChoice(groups: ReadonlyArray<CalendarGroup>, key: string): CalendarChoice | undefined {
  return groups.flatMap((group) => group.choices).find((choice) => choice.key === key);
}

type CalendarSelectProps = {
  id: string;
  groups: ReadonlyArray<CalendarGroup>;
  value: string;
  onValueChange: (value: string) => void;
};

function CalendarSelect({ id, groups, value, onValueChange }: CalendarSelectProps) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose a Calendar" />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) => (
          <SelectGroup key={group.email}>
            <SelectLabel>{group.email}</SelectLabel>
            {group.choices.map((choice) => (
              <SelectItem key={choice.key} value={choice.key}>
                {choice.calendar.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

type PairingProblem = "sameCalendar" | "ruleExists";

/**
 * Why the Calendars can't be paired, or null when they can or aren't both
 * chosen. Calendars compare by id, which is the same in every account.
 */
function pairingProblem(
  rules: ReadonlyArray<SyncRule>,
  source: CalendarChoice | undefined,
  target: CalendarChoice | undefined,
): PairingProblem | null {
  if (source === undefined || target === undefined) {
    return null;
  }

  if (source.calendar.id === target.calendar.id) {
    return "sameCalendar";
  }

  const exists = rules.some(
    (rule) =>
      rule.sourceCalendarId === source.calendar.id && rule.targetCalendarId === target.calendar.id,
  );

  if (exists) {
    return "ruleExists";
  }

  return null;
}

const isMode = Schema.is(Mode);

type SyncRuleSettingsFieldsProps = {
  settings: SyncRuleSettings;
  onChange: (settings: SyncRuleSettings) => void;
};

function SyncRuleSettingsFields({ settings, onChange }: SyncRuleSettingsFieldsProps) {
  const id = useId();
  const titleMissing = !hasPrivateTitle(settings);

  function changeMode(value: string) {
    if (isMode(value)) {
      onChange({ ...settings, mode: value });
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-mode`}>Mode</Label>
        <Select value={settings.mode} onValueChange={changeMode}>
          <SelectTrigger id={`${id}-mode`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">Private</SelectItem>
            <SelectItem value="transparent">Transparent</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{modeDescription(settings.mode)}</p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-title`}>Private Mode title</Label>
        <Input
          id={`${id}-title`}
          value={settings.privateTitle}
          disabled={settings.mode !== "private"}
          aria-invalid={titleMissing}
          aria-describedby={titleMissing ? `${id}-title-error` : undefined}
          onChange={(event) => onChange({ ...settings, privateTitle: event.target.value })}
        />
        {titleMissing ? (
          <p id={`${id}-title-error`} className="text-sm text-destructive">
            Enter a title.
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-all-day`}
          checked={settings.includeAllDayEvents}
          onCheckedChange={(checked) =>
            onChange({ ...settings, includeAllDayEvents: checked === true })
          }
        />
        <Label htmlFor={`${id}-all-day`}>Copy all-day events</Label>
      </div>
    </>
  );
}

function modeDescription(mode: Mode): string {
  if (mode === "private") {
    return "Copies show only busy time, under the title below.";
  }

  return "Copies show the event's title, time, location, description, and conference link, but never its attendees.";
}

/** The title Private Mode Copies get can't be blank, in either Mode, so switching back works. */
function hasPrivateTitle(settings: SyncRuleSettings): boolean {
  return settings.privateTitle.trim() !== "";
}

function withTrimmedTitle(settings: SyncRuleSettings): SyncRuleSettings {
  return { ...settings, privateTitle: settings.privateTitle.trim() };
}

function FormFailure({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
