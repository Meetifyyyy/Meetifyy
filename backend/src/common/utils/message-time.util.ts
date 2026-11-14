/**
 * The clock time a chat message shows (`time`, e.g. "09:41"), which the apps
 * render under each message.
 *
 * One formatter, built once. `Date.toLocaleTimeString(locales, options)`
 * builds a new Intl formatter on every call: 48.6 µs against 3.3 µs for a
 * reused one, with identical output. It ran once per message on every chat
 * page, send and socket delivery, and was the app's own biggest CPU cost in
 * the 2026-11-14 load test.
 */
const MESSAGE_TIME = new Intl.DateTimeFormat([], {
  hour: '2-digit',
  minute: '2-digit',
});

export function messageTime(value: Date | string | number): string {
  const date = new Date(value);
  // `format` throws on an invalid date where toLocaleTimeString answered
  // "Invalid Date"; kept, so nothing that reaches this behaves differently.
  return Number.isNaN(date.getTime())
    ? 'Invalid Date'
    : MESSAGE_TIME.format(date);
}
