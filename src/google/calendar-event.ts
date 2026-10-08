import type { DateTime } from "effect";

/**
 * When an event happens; the end is exclusive. Timed events have instants,
 * and all-day events have `yyyy-mm-dd` dates that belong to no time zone.
 */
export type EventTime =
  | { readonly kind: "timed"; readonly start: DateTime.Utc; readonly end: DateTime.Utc }
  | { readonly kind: "allDay"; readonly startDate: string; readonly endDate: string };

/** When an event starts: an instant for timed events, a `yyyy-mm-dd` date for all-day ones. */
export type EventStart =
  | { readonly kind: "timed"; readonly start: DateTime.Utc }
  | { readonly kind: "allDay"; readonly startDate: string };

/** Who besides the Calendar's owner sees an event's details, as Google names the options. */
export const visibilities = ["default", "public", "private", "confidential"] as const;

export type Visibility = (typeof visibilities)[number];

/** What an event shows in its Calendar. */
export type EventDetails = {
  readonly title?: string;
  readonly description?: string;
  readonly location?: string;
  /** The link for joining the event's video conference, such as a Google Meet link. */
  readonly conferenceLink?: string;
  readonly time: EventTime;
  readonly visibility: Visibility;
  /** Whether the event blocks time, which Google calls `opaque` transparency. */
  readonly busy: boolean;
};

/** The kinds of event Google distinguishes, as it names them. */
export const eventTypes = [
  "default",
  "birthday",
  "focusTime",
  "fromGmail",
  "outOfOffice",
  "workingLocation",
] as const;

export type EventType = (typeof eventTypes)[number];

/** An attendee's answer to an invitation, as Google names the options. */
export const responseStatuses = ["needsAction", "declined", "tentative", "accepted"] as const;

export type ResponseStatus = (typeof responseStatuses)[number];

/** An event as its Calendar's listing returns it. */
export type CalendarEvent = {
  readonly id: string;
  /**
   * The meeting the event belongs to. Every invitee's event for one meeting
   * shares it, and so does every occurrence of a recurring meeting.
   */
  readonly iCalUID: string;
  /**
   * When an occurrence of a recurring event was scheduled by its series,
   * which stays the same when the occurrence moves. Absent on other events.
   */
  readonly originalStart?: EventStart;
  readonly eventType: EventType;
  /**
   * The Owner's answer in this Calendar, from the attendee entry that stands
   * for the Calendar. Absent when the event has no such entry, as on events
   * without attendees.
   */
  readonly ownerResponse?: ResponseStatus;
  /**
   * The Sync Rule that wrote the event as one of its Copies. Absent on Source
   * Events, the events the system didn't create.
   */
  readonly syncRuleId?: string;
  readonly details: EventDetails;
  readonly hasReminders: boolean;
  readonly hasAttendees: boolean;
};

/**
 * What a Copy shows. A Copy never has a conference of its own, so writing it
 * can't create one; Transparent Mode shows the link in the description.
 */
export type CopyDetails = Omit<EventDetails, "conferenceLink">;

/** A Copy as a Run writes it, which is always without reminders and attendees. */
export type Copy = {
  readonly id: string;
  readonly syncRuleId: string;
  readonly sourceEventId: string;
  readonly details: CopyDetails;
};

/** The span in which Runs maintain Copies. */
export type SyncWindow = { readonly start: DateTime.Utc; readonly end: DateTime.Utc };
