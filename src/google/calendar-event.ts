import type { DateTime } from "effect";

/**
 * When an event happens; the end is exclusive. Timed events have instants,
 * and all-day events have `yyyy-mm-dd` dates that belong to no time zone.
 */
export type EventTime =
  | { readonly kind: "timed"; readonly start: DateTime.Utc; readonly end: DateTime.Utc }
  | { readonly kind: "allDay"; readonly startDate: string; readonly endDate: string };

/** Who besides the Calendar's owner sees an event's details, as Google names the options. */
export const visibilities = ["default", "public", "private", "confidential"] as const;

export type Visibility = (typeof visibilities)[number];

/** What an event shows in its Calendar. */
export type EventDetails = {
  readonly title?: string;
  readonly description?: string;
  readonly location?: string;
  readonly time: EventTime;
  readonly visibility: Visibility;
  /** Whether the event blocks time, which Google calls `opaque` transparency. */
  readonly busy: boolean;
};

/** An event as its Calendar's listing returns it. */
export type CalendarEvent = {
  readonly id: string;
  /**
   * The Sync Rule that wrote the event as one of its Copies. Absent on Source
   * Events, the events the system didn't create.
   */
  readonly syncRuleId?: string;
  readonly details: EventDetails;
  readonly hasReminders: boolean;
  readonly hasAttendees: boolean;
};

/** A Copy as a Run writes it, which is always without reminders and attendees. */
export type Copy = {
  readonly id: string;
  readonly syncRuleId: string;
  readonly sourceEventId: string;
  readonly details: EventDetails;
};

/** The span in which Runs maintain Copies. */
export type SyncWindow = { readonly start: DateTime.Utc; readonly end: DateTime.Utc };
