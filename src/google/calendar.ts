/** The effective access roles a Calendar Account can have on a Calendar, as Google reports them. */
export const accessRoles = [
  "freeBusyReader",
  "reader",
  "writerWithoutPrivateAccess",
  "writer",
  "owner",
] as const;

export type AccessRole = (typeof accessRoles)[number];

export type Calendar = {
  readonly id: string;
  /** The Calendar Account's own name for the Calendar when it set one, otherwise the Calendar's title. */
  readonly name: string;
  readonly accessRole: AccessRole;
};

/** Whether the Calendar can be a Source Calendar. `freeBusyReader` sees busy times but no events. */
export function isReadable(calendar: Calendar): boolean {
  return calendar.accessRole !== "freeBusyReader";
}

/**
 * Whether the Calendar can be a Target Calendar. `writerWithoutPrivateAccess`
 * can't modify private events, so it couldn't maintain Private Mode Copies.
 */
export function isWritable(calendar: Calendar): boolean {
  return calendar.accessRole === "owner" || calendar.accessRole === "writer";
}
