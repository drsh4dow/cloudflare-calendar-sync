# Deterministic Copy ids instead of a Run lock

A Copy's Google event `id` is derived from its Sync Rule id and source event
id, encoded in Google's allowed alphabet (lowercase a to v and digits). A Run
inserts each missing Copy under that id, and when the insert fails with 409
`duplicate`, it updates the event under that id with the full Copy instead.
Overlapping cron and manual Runs therefore write identical content to one
event, and duplicates are impossible even when a Run crashes halfway. We chose
this over a lease row in D1 because it needs no lock lifecycle or expiry
tuning.

## Consequences

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
