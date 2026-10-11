/**
 * Design tokens for every transactional email.
 *
 * Email clients ignore CSS variables and most of modern CSS, so the tokens are
 * plain values that get inlined. Colours come from the brand wordmark (navy ink,
 * periwinkle-violet accent) rather than a generic UI palette.
 *
 * Emails have no background of their own: the page, the sheet and every panel
 * are transparent or a translucent tint, so the message sits on whatever the
 * reader's client paints (white, off-white, near-black). Because the surface is
 * not ours, text colours cannot be fixed either: the values below are the
 * light-surface defaults, and `themeCss` re-colours them for dark clients via
 * the `c-*` classes. Borders and tints are rgba so they read on both.
 */
export const color = {
  page: 'transparent',
  sheet: 'transparent',
  inset: 'rgba(128,128,150,0.12)',
  ink: '#0A0F1D',
  body: '#3A3F52',
  muted: '#6C7188',
  faint: '#9A9EB2',
  hairline: 'rgba(128,128,150,0.28)',
  rule: 'rgba(128,128,150,0.55)',
  accent: '#5C47FA',
  accentSoft: '#8C8DFF',
  button: '#5C47FA',
  tint: 'rgba(92,71,250,0.10)',
  tintBorder: 'rgba(92,71,250,0.35)',
} as const;

/**
 * Class names that carry the dark-mode override for each text colour. Put the
 * class next to the inline style: the inline value is the light default, the
 * class wins in dark clients through `!important`.
 */
export const cls = {
  ink: 'c-ink',
  body: 'c-body',
  muted: 'c-muted',
  faint: 'c-faint',
  accent: 'c-accent',
} as const;

/** Dark-surface counterparts, injected once by BaseLayout. */
export const themeCss = `
  @media (prefers-color-scheme: dark) {
    .c-ink { color: #F4F5FA !important; }
    .c-body { color: #C9CCDA !important; }
    .c-muted { color: #A3A7BC !important; }
    .c-faint { color: #8387A0 !important; }
    .c-accent { color: #A99CFF !important; }
    .co-warn-t { color: #FFC773 !important; }
    .co-warn-x { color: #EBD3AC !important; }
    .co-info-t { color: #B9B0FF !important; }
    .co-info-x { color: #CFCCEE !important; }
    .co-danger-t { color: #FF9CA6 !important; }
    .co-danger-x { color: #EBC4C8 !important; }
  }
`;

/**
 * Plain system fonts. Web fonts (Inter etc.) only render in Apple Mail and
 * Thunderbird; Gmail, Outlook.com and Yahoo strip them, so most readers would
 * see the fallback anyway.
 */
export const font = {
  sans: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Helvetica,Arial,sans-serif',
} as const;

export const type = {
  eyebrow: {
    fontFamily: font.sans,
    fontSize: '14px',
    lineHeight: '20px',
    fontWeight: 600,
    color: color.accent,
    margin: '0 0 14px',
  },
  headline: {
    fontFamily: font.sans,
    fontSize: '32px',
    lineHeight: '38px',
    fontWeight: 600,
    letterSpacing: '-0.025em',
    color: color.ink,
    margin: '0 0 16px',
  },
  lede: {
    fontFamily: font.sans,
    fontSize: '16px',
    lineHeight: '26px',
    color: color.body,
    margin: '0 0 28px',
  },
  body: {
    fontFamily: font.sans,
    fontSize: '15px',
    lineHeight: '24px',
    color: color.body,
    margin: '0 0 16px',
  },
  small: {
    fontFamily: font.sans,
    fontSize: '13px',
    lineHeight: '20px',
    color: color.muted,
    margin: '0 0 14px',
  },
  label: {
    fontFamily: font.sans,
    fontSize: '13px',
    lineHeight: '18px',
    fontWeight: 600,
    color: color.ink,
    margin: '0 0 6px',
  },
};
