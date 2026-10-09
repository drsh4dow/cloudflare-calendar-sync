# Deterministic Copy ids instead of a Run lock

A Copy's Google event `id` is derived from its Sync Rule id and source event
id, encoded in Google's allowed alphabet (lowercase a to v and digits). A Run
inserts each missing Copy under that id, and when the insert fails with 409
`duplicate`, it updates the event under that id with the full Copy instead.
Overlapping cron and manual Runs therefore write identical content to one
event id, and a Run that crashes halfway leaves nothing a later Run would
duplicate. This prevents duplicates as far as Google detects id collisions,
which its [`events.insert` reference][insert] says it can't guarantee at
creation time, so two inserts of one Copy at nearly the same moment might
both succeed. Two overlapping Runs on `prod` left one Copy per Source Event
(ticket #13). We chose this over a lease row in D1 because it needs no lock
lifecycle or expiry tuning.

## Consequences

Google allows event ids of 5 to 1024 characters. A Copy id is the
32-character Sync Rule id followed by two characters per character of the
source event id, so a Source Event whose id is longer than 496 characters
can't have a Copy. A Run skips such an event, writes the Sync Rule's other
Copies, and fails the Sync Rule, which the dashboard shows. A shorter
encoding for long ids would change existing Copy ids and so rewrite every
Copy, which isn't worth it for ids this rare.

Deleting a Copy doesn't free its id. Google keeps the event as `cancelled`,
and inserting the same id again fails with the same 409 `duplicate` as for a live
Copy. The listing a Run reads (`singleEvents=true`, default `showDeleted`)
omits the cancelled event, so the Run sees the Copy as missing, and the update
after the 409 restores it: `events.update` returns the event as `confirmed`,
with or without an explicit `status`, and the next listing includes it. The
update replaces the whole event, private extended properties included, so it
must carry the Copy's tags. An update without them leaves an untagged event
that the system no longer recognizes as its own. This was checked against the
real API on 2026-10-08 (ticket #6).

A Run working from an older listing can restore a Copy that an overlapping Run
just deleted. The next Run deletes it again.

A Run that loaded a Sync Rule before its deletion can write the rule's Copies
after the deletion's cleanup. D1 keeps the ids of deleted Sync Rules, and
later Runs delete the Copies tagged with one of them in the Calendars they
write. Copies tagged with a Sync Rule the instance never had, such as another
stage's in the same Calendars, stay.

[insert]: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
