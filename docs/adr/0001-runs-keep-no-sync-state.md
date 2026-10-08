# Runs keep no sync state

Each Run lists every involved Calendar over the whole Sync Window with
`singleEvents=true`, computes the Copies each Sync Rule should produce, and
writes only the differences. Copies are identified by private extended
properties on the events themselves (Sync Rule id and source event id), so D1
holds configuration, credentials, and Run status but no record of which Copies
exist. A Run decides whether a Copy needs an update by comparing the Copy as
listed with the Copy it should be, not by a stored content hash: a hash tag
stays the same when the Owner edits a Copy by hand, so it couldn't detect the
edit the next Run must overwrite. We chose this over Google's `syncToken` incremental sync
because a sync token cannot be combined with `timeMin`/`timeMax`, so a rolling
window would need its own rebaselining, a local event store, and 410 recovery.
With four calendars a full read costs a handful of list requests per Run, far
below the 600 requests per minute per user quota.

## Consequences

A Run may delete a Sync Rule's Copies only after the Source Calendar listing
returned every page without error. A partial or failed read must never look
like the Source Events were deleted.
