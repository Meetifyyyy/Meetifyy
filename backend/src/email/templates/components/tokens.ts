/**
 * Design tokens for every transactional email.
 *
 * Email clients ignore CSS variables and most of modern CSS, so the tokens are
 * plain values that get inlined. Colours come from the brand wordmark (navy ink,
 * periwinkle-violet accent) rather than a generic UI palette.
 *
 * Emails are pinned to a light scheme (see BaseLayout): the only configured
 * logo asset is the dark-on-light wordmark, so an inverted client would leave it
 * unreadable.
 */
export const color = {
  page: '#EEEFF5',
  sheet: '#FFFFFF',
  inset: '#F6F6FA',
  ink: '#0A0F1D',
  body: '#3A3F52',
  muted: '#6C7188',
  faint: '#9A9EB2',
  hairline: '#E6E7EF',
  rule: '#0A0F1D',
  accent: '#5C47FA',
  accentSoft: '#8C8DFF',
  button: '#5C47FA',
  tint: '#F0EEFF',
  panel: '#0A0F1D',
  panelBorder: '#0A0F1D',
} as const;

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
