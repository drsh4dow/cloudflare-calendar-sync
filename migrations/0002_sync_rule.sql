-- Sync Rules (spec Data). IF NOT EXISTS keeps the file safe to run twice
-- (spec Q43).
--
-- A Calendar is identified by its Google calendar id, which is the same in
-- every Calendar Account that can see it. So a Sync Rule's Source and Target
-- must be different Calendars even when two accounts reach the same one, and
-- one Source and Target pair has at most one Sync Rule, whose Copies it alone
-- maintains.
--
-- Disconnecting a Calendar Account deletes the account row and with it the
-- Sync Rules that read or write through it.
create table if not exists "syncRule" (
  "id" text not null primary key,
  "sourceCalendarAccountId" text not null references "account" ("id") on delete cascade,
  "sourceCalendarId" text not null,
  "targetCalendarAccountId" text not null references "account" ("id") on delete cascade,
  "targetCalendarId" text not null,
  "mode" text not null check ("mode" in ('private', 'transparent')),
  "privateTitle" text not null,
  "includeAllDayEvents" integer not null check ("includeAllDayEvents" in (0, 1)),
  "createdAt" date not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  "updatedAt" date not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ("sourceCalendarId" <> "targetCalendarId"),
  unique ("sourceCalendarId", "targetCalendarId")
);
