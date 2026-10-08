import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Schema } from "effect";

import {
  type ListedCalendarAccount,
  listCalendars,
  ownerCalendarAccounts,
} from "@/auth/calendar-accounts.server";
import { requireOwnerSession } from "@/auth/session.server";
import { type Calendar, isReadable, isWritable } from "@/google/calendar";
import { NewSyncRule, reverseOf, type SyncRule, SyncRuleSettings } from "./sync-rule";
import { SyncRules } from "./sync-rules.server";

/** Every Sync Rule, oldest first. */
export const listSyncRules = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<ReadonlyArray<SyncRule>> => {
    await requireOwnerSession(context.auth, getRequestHeaders());

    return context.runEffect(SyncRules.use((syncRules) => syncRules.list));
  },
);

const CreateSyncRuleInput = Schema.Struct({
  ...NewSyncRule.fields,
  alsoCreateReverse: Schema.Boolean,
});

/**
 * Creates a Sync Rule, and with `alsoCreateReverse` the rule from its Target
 * back to its Source. Rejects a Source the Calendar Account can't read, a
 * Target it can't write, and a Source that is the Target.
 */
export const createSyncRule = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(CreateSyncRuleInput))
  .handler(async ({ context, data }): Promise<void> => {
    const { alsoCreateReverse, ...rule } = data;
    const headers = getRequestHeaders();
    const accounts = await ownerCalendarAccounts(context.auth, headers);

    const involved = accounts.filter(
      (account) =>
        account.id === rule.sourceCalendarAccountId || account.id === rule.targetCalendarAccountId,
    );

    const listed = await listCalendars(context.auth, headers, involved);
    const source = findCalendar(listed, rule.sourceCalendarAccountId, rule.sourceCalendarId);
    const target = findCalendar(listed, rule.targetCalendarAccountId, rule.targetCalendarId);

    if (source === undefined || !isReadable(source)) {
      throw new Error("The Source Calendar's Calendar Account can't read it.");
    }

    if (target === undefined || !isWritable(target)) {
      throw new Error("The Target Calendar's Calendar Account can't write it.");
    }

    if (source.id === target.id) {
      throw new Error("The Source and Target Calendars must differ.");
    }

    const rules: Array<NewSyncRule> = [rule];

    if (alsoCreateReverse) {
      if (!isWritable(source)) {
        throw new Error("The reverse rule needs a Source Calendar its Calendar Account can write.");
      }

      rules.push(reverseOf(rule));
    }

    await context.runEffect(SyncRules.use((syncRules) => syncRules.create(rules)));
  });

/** Changes a Sync Rule's Mode, private title, and all-day toggle. */
export const updateSyncRule = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String, settings: SyncRuleSettings })),
  )
  .handler(async ({ context, data }): Promise<void> => {
    await requireOwnerSession(context.auth, getRequestHeaders());
    await context.runEffect(SyncRules.use((syncRules) => syncRules.update(data.id, data.settings)));
  });

export const deleteSyncRule = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ id: Schema.String })))
  .handler(async ({ context, data }): Promise<void> => {
    await requireOwnerSession(context.auth, getRequestHeaders());
    await context.runEffect(SyncRules.use((syncRules) => syncRules.delete(data.id)));
  });

/** The Calendar as its Calendar Account lists it, when the listing succeeded and has it. */
function findCalendar(
  accounts: ReadonlyArray<ListedCalendarAccount>,
  calendarAccountId: string,
  calendarId: string,
): Calendar | undefined {
  const account = accounts.find((candidate) => candidate.id === calendarAccountId);

  if (account?.listing.kind !== "listed") {
    return undefined;
  }

  return account.listing.calendars.find((calendar) => calendar.id === calendarId);
}
