-- The ids of Sync Rules the dashboard deleted, including through a
-- disconnect's cleanup. A Run that loaded a Sync Rule before its deletion can
-- write Copies after the deletion's cleanup, and later Runs delete Copies
-- tagged with these ids. Copies tagged with a Sync Rule this instance never
-- had, such as another stage's in the same Calendars, stay. IF NOT EXISTS
-- keeps the file safe to run twice (spec Q43).
create table if not exists "deletedSyncRule" (
  "id" text not null primary key
);
