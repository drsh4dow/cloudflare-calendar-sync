-- Run status (spec Data, Q13): how the last Run ended for each Sync Rule and
-- each Calendar Account. Each Run overwrites its rows. IF NOT EXISTS keeps
-- the file safe to run twice (spec Q43).
--
-- Times are ISO 8601 strings of the Run's start. A status row goes away with
-- its Sync Rule or Calendar Account.
create table if not exists "syncRuleStatus" (
  "syncRuleId" text not null primary key references "syncRule" ("id") on delete cascade,
  "lastRunAt" date not null,
  "lastRunSucceeded" integer not null check ("lastRunSucceeded" in (0, 1)),
  -- Null until a Run applies the rule without a failure.
  "lastSucceededAt" date
);

create table if not exists "calendarAccountStatus" (
  "calendarAccountId" text not null primary key references "account" ("id") on delete cascade,
  "lastRunAt" date not null,
  -- Null when every request of the last Run that used the account succeeded.
  "lastRunProblem" text check ("lastRunProblem" in ('needsReconnect', 'unavailable'))
);
