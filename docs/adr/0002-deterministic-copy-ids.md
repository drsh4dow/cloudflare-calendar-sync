# Deterministic Copy ids instead of a Run lock

A Copy's Google event `id` is derived from its Sync Rule id and source event
id, encoded in Google's allowed alphabet (lowercase a to v and digits). When a
cron Run and a manual Run overlap, the second insert of the same Copy fails with
409 and is ignored, and concurrent updates write identical content, so
duplicates are impossible even when a Run crashes halfway. We chose this over a
lease row in D1 because it needs no lock lifecycle or expiry tuning.

## Consequences

Google may keep a deleted event as `cancelled` under the same id, so restoring
a Copy can require updating the cancelled event rather than inserting. This is
unverified and is checked against the real API early in the build; if it
misbehaves, a D1 Run lease is added.
