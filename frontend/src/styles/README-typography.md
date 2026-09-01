# Typography system

One shared, calm hierarchy. Don't hand-pick `font-size` / `font-weight` /
`letter-spacing` per component — compose a semantic class.

## Tokens (`variables.css`)

| Group | Tokens |
|---|---|
| Size | `--font-size-2xs` 11px · `--font-size-xs` 12px · `--font-size-sm` 13px · `--font-size-base` 14px · `--font-size-md` 15px · `--font-size-lg` 17px · `--font-size-xl` 20px · `--font-size-2xl` 24px · `--font-size-3xl` 32px |
| Weight | `--font-weight-regular` 400 · `--font-weight-medium` 500 · `--font-weight-semibold` 600 |
| Leading | `--leading-tight` 1.2 · `--leading-snug` 1.35 · `--leading-normal` 1.5 · `--leading-relaxed` 1.6 |
| Tracking | `--tracking-tight` -0.02em · `--tracking-normal` 0 |

No weight above 600. No positive letter-spacing token — labels don't get tracked out.

## Classes (`typography.css`)

| Class | Role | Size / weight |
|---|---|---|
| `type-page-title` | Route/page `<h1>` | 24px→32px @1024px / 600, tracking-tight |
| `type-section-title` | Section heading within a page | 20px / 600 |
| `type-card-title` | Title of a card / list item / modal | 17px / 600 |
| `type-label` | Form & field labels, small group labels | 13px / 500, **sentence case** |
| `type-body` | Paragraph / content text | 14px / 400, leading 1.6 |
| `type-secondary` | Supporting text next to a value | 13px / 400, muted |
| `type-caption` | Metadata, timestamps, helper text | 12px / 400, `--color-text-light` |
| `type-button` | Button text | 14px / 600 |
| `type-nav` | Nav item text | 14px / 500 |

Colour: `type-label` / `type-secondary` use `--color-text-muted`; `type-caption`
uses the lighter `--color-text-light`; the rest use `--color-text-main`. Override
colour after the compose when a component needs a different one (e.g. danger).

## Migration recipe

```css
/* before */
.sectionLabel {
  font-family: var(--font-family-display);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-text-muted);
  padding: 16px 20px 8px;
}

/* after */
.sectionLabel {
  composes: type-label from global;
  padding: 16px 20px 8px;
}
```

Keep layout props (padding, margin, flex, grid), keep a bespoke `font-size`
override if the component genuinely needs a different size than the token, keep a
different `color`. Delete everything the composed class now owns.

`from global` works because `typography.css` is a plain stylesheet imported in
`main.jsx` (after `global.css`) — same mechanism as `composes: ui-avatar from
global`.

## Keep as-is (do NOT migrate)

- Count / status badges & pills (unread counts, `VERIFIED`/`PENDING`, tag chips).
- Calendar date-tile month/weekday abbreviations (`JAN`, `MON`).
- Landing page marketing `.eyebrow` kickers + nav CTA button text.
- `features/instant-match/` — self-contained Changa One display system with its
  own `--im-display` / `--im-body` vars.
