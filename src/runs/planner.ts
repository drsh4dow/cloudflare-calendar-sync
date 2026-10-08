import { DateTime, Equal, type Types } from "effect";
import { Hex } from "effect/encoding";

import type {
  CalendarEvent,
  Copy,
  CopyDetails,
  EventDetails,
  EventTime,
  SyncWindow,
} from "@/google/calendar-event";
import type { SyncRule } from "@/sync-rules/sync-rule";

/**
 * From the start of today to 60 days later, with days in UTC. Copies that
 * have ended are never touched, so the start only bounds what a Run reads.
 */
export function syncWindowAt(now: DateTime.Utc): SyncWindow {
  const start = DateTime.startOf(now, "day");

  return { start, end: DateTime.add(start, { days: 60 }) };
}

/** A write that brings one Copy in line with its Source Event. */
export type CopyOperation =
  | { readonly kind: "create"; readonly copy: Copy }
  | { readonly kind: "update"; readonly copy: Copy }
  | { readonly kind: "delete"; readonly copyId: string };

export type PlanInput = {
  readonly rule: SyncRule;
  /** Every event a complete read of the Source Calendar returned. */
  readonly sourceEvents: ReadonlyArray<CalendarEvent>;
  /** Every event a complete read of the Target Calendar returned. */
  readonly targetEvents: ReadonlyArray<CalendarEvent>;
  readonly now: DateTime.Utc;
};

/**
 * The writes that bring a Sync Rule's Copies in line with its Source Events.
 * Events without the rule's tag are never written, and Copies that have ended
 * are left as they are. A Copy whose Source Event the listing lacks is
 * deleted, so the listings must be complete.
 *
 * A Source Event isn't copied when the Target Calendar already holds the same
 * meeting and the Owner hasn't declined it there, so a meeting the Owner was
 * invited to on both addresses shows once. Two events are the same meeting
 * when their iCalUIDs and their occurrences' original starts both match. Every
 * occurrence of a series shares the iCalUID, so the start tells occurrences
 * apart. The original start is Google's `originalStartTime` when present,
 * otherwise the start, so an occurrence still matches after it moves.
 */
export function planCopies({
  rule,
  sourceEvents,
  targetEvents,
  now,
}: PlanInput): ReadonlyArray<CopyOperation> {
  const unclaimedCopies = new Map<string, CalendarEvent>();
  const meetingsInTarget = new Set<string>();

  for (const event of targetEvents) {
    if (event.syncRuleId === rule.id) {
      unclaimedCopies.set(event.id, event);
    }

    if (event.ownerResponse !== "declined") {
      meetingsInTarget.add(meetingOccurrence(event));
    }
  }

  const operations: Array<CopyOperation> = [];

  for (const event of sourceEvents) {
    if (!shouldCopy(rule, event) || meetingsInTarget.has(meetingOccurrence(event))) {
      continue;
    }

    const copy = copyOf(rule, event);
    const existing = unclaimedCopies.get(copy.id);

    unclaimedCopies.delete(copy.id);

    const operation = reconcile(copy, existing, now);

    if (operation !== undefined) {
      operations.push(operation);
    }
  }

  for (const stale of unclaimedCopies.values()) {
    if (!hasEnded(stale.details.time, now)) {
      operations.push({ kind: "delete", copyId: stale.id });
    }
  }

  return operations;
}

/**
 * Whether a Run copies the event. Only Source Events are copied, so Copies
 * never chain, and all-day ones only when the rule includes them. Events
 * marked free, events the Owner declined, and working-location events don't
 * block time.
 */
function shouldCopy(rule: SyncRule, event: CalendarEvent): boolean {
  if (event.syncRuleId !== undefined) {
    return false;
  }

  if (event.details.time.kind === "allDay" && !rule.includeAllDayEvents) {
    return false;
  }

  if (event.eventType === "workingLocation") {
    return false;
  }

  return event.details.busy && event.ownerResponse !== "declined";
}

/** The meeting occurrence the event stands for, equal across Calendars (see `planCopies`). */
function meetingOccurrence(event: CalendarEvent): string {
  const start = event.originalStart ?? event.details.time;

  switch (start.kind) {
    case "timed":
      return `${event.iCalUID} ${DateTime.formatIso(start.start)}`;
    case "allDay":
      return `${event.iCalUID} ${start.startDate}`;
    default: {
      const exhaustive: never = start;

      return exhaustive;
    }
  }
}

/** The write that makes the Target Calendar show the Copy, if any. */
function reconcile(
  copy: Copy,
  existing: CalendarEvent | undefined,
  now: DateTime.Utc,
): CopyOperation | undefined {
  if (existing === undefined) {
    if (hasEnded(copy.details.time, now)) {
      return undefined;
    }

    return { kind: "create", copy };
  }

  if (hasEnded(existing.details.time, now) || shows(existing, copy)) {
    return undefined;
  }

  return { kind: "update", copy };
}

/** Whether the listed event shows exactly what the Copy should, which a manual edit breaks. */
function shows(event: CalendarEvent, copy: Copy): boolean {
  return !event.hasReminders && !event.hasAttendees && Equal.equals(event.details, copy.details);
}

function copyOf(rule: SyncRule, event: CalendarEvent): Copy {
  return {
    id: copyId(rule.id, event.id),
    syncRuleId: rule.id,
    sourceEventId: event.id,
    details: copyDetails(rule, event.details),
  };
}

/** What the Copy of a Source Event shows under the rule's Mode. */
function copyDetails(rule: SyncRule, source: EventDetails): CopyDetails {
  switch (rule.mode) {
    case "private":
      return privateDetails(rule.privateTitle, source.time);
    case "transparent":
      return transparentDetails(source);
    default: {
      const exhaustive: never = rule.mode;

      return exhaustive;
    }
  }
}

function privateDetails(title: string, time: EventTime): CopyDetails {
  return { title, time, visibility: "private", busy: true };
}

/**
 * The Source Event's title, description, location, conference link, and time.
 * The Copy keeps the Source Event's visibility, so a private event stays
 * private.
 */
function transparentDetails(source: EventDetails): CopyDetails {
  const details: Types.Mutable<CopyDetails> = {
    time: source.time,
    visibility: source.visibility,
    busy: true,
  };

  if (source.title !== undefined) {
    details.title = source.title;
  }

  const description = withConferenceLink(source.description, source.conferenceLink);

  if (description !== undefined) {
    details.description = description;
  }

  if (source.location !== undefined) {
    details.location = source.location;
  }

  return details;
}

/**
 * The description with the conference link at its end, unless it already
 * shows the link. As text, the link lists back exactly as written, which
 * conference data Google fills in on its own wouldn't.
 */
function withConferenceLink(
  description: string | undefined,
  conferenceLink: string | undefined,
): string | undefined {
  if (conferenceLink === undefined) {
    return description;
  }

  if (description === undefined) {
    return conferenceLink;
  }

  if (description.includes(conferenceLink)) {
    return description;
  }

  return `${description}\n\n${conferenceLink}`;
}

/**
 * Whether the event is over. All-day dates are compared with today's date in
 * UTC, the time zone of the Sync Window.
 */
function hasEnded(time: EventTime, now: DateTime.Utc): boolean {
  switch (time.kind) {
    case "timed":
      return DateTime.isLessThanOrEqualTo(time.end, now);
    case "allDay":
      return time.endDate <= DateTime.formatIsoDate(now);
    default: {
      const exhaustive: never = time;

      return exhaustive;
    }
  }
}

/**
 * The Copy's Google event id (ADR 0002). Sync Rule ids are hex, and hex is a
 * subset of the alphabet Google allows in event ids (lowercase a to v and
 * digits), so the id is the Sync Rule id followed by the hex of the source
 * event id.
 */
function copyId(syncRuleId: string, sourceEventId: string): string {
  return syncRuleId + Hex.encode(sourceEventId);
}
