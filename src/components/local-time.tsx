import { useSyncExternalStore } from "react";

const localFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// `timeZoneName` can't be combined with the styles, so `LocalTime` appends
// the zone itself.
const utcFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/**
 * A time in the browser's locale and time zone. The server knows neither, so
 * it renders the time in UTC, and the browser replaces it after hydration.
 */
export function LocalTime({ value }: { value: Date }) {
  const text = useSyncExternalStore(
    subscribeToNothing,
    () => localFormat.format(value),
    () => `${utcFormat.format(value)} UTC`,
  );

  return <time dateTime={value.toISOString()}>{text}</time>;
}

/** The time zone doesn't change while the page is open, so there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => undefined;
}
