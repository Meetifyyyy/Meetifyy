/**
 * The Instant Match mark: a thunderbolt.
 *
 * One glyph for the feature, so the launcher, the sheet header, the match
 * card and the chat all carry the same symbol. Filled, with slightly rounded
 * joins so it holds up at 14px as well as at 24px. Decorative — the
 * surrounding label names it.
 */
export function MatchMark({ className = '', style }) {
  return (
    <svg
      className={`im-mark ${className}`}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.6 2.2 4.6 13.4a.6.6 0 0 0 .47.98h5.53l-1.25 7.2c-.1.6.66.93 1.04.45l9-11.2a.6.6 0 0 0-.47-.98h-5.53l1.25-7.2c.1-.6-.66-.93-1.04-.45Z" />
    </svg>
  );
}
