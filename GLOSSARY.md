# Calendar Sync

A self-hosted service that keeps one owner's calendars aware of each other by
writing Copies of events from one calendar into another.

## Calendars

**Owner**:
The single person who runs an instance and whose calendars it syncs.
_Avoid_: User, tenant, customer

**Calendar Account**:
An authorized login at a calendar provider, owned by the Owner, that grants
access to one or more Calendars.
_Avoid_: Connection, integration, provider account

**Calendar**:
One calendar inside a Calendar Account.
_Avoid_: Feed, source, sink

## Syncing

**Sync Rule**:
A directed pairing of a Source Calendar and a Target Calendar with a Mode.
Bidirectional syncing is two Sync Rules.
_Avoid_: Sync, link, mirror, group

**Source Calendar**:
The Calendar a Sync Rule reads Source Events from.

**Target Calendar**:
The Calendar a Sync Rule writes Copies into.
_Avoid_: Sink, destination

**Source Event**:
An event the system did not create. Only Source Events are ever copied.
_Avoid_: Original, origin event

**Copy**:
An event the system created in a Target Calendar to represent one occurrence
of a Source Event. A Copy is never a Source Event, so Copies never chain.
_Avoid_: Mirror, clone, blocker, shadow event

**Mode**:
How much of a Source Event a Copy reveals: Private or Transparent.

**Private Mode**:
The Copy shows only busy time under a title set on the Sync Rule.
_Avoid_: Busy mode, opaque

**Transparent Mode**:
The Copy shows the Source Event's details, excluding attendees.
_Avoid_: Full mode, public

**Sync Window**:
The span of time, from the start of today forward, in which Copies are
maintained. Copies that have ended are never touched again.

**Run**:
One pass that brings every Sync Rule's Copies in line with its Source Events.
_Avoid_: Job, sync (as a noun)
