/**
 * Where a Meetifyy link can be sent, and what each destination actually
 * supports.
 *
 * ONE SOURCE OF TRUTH, DELIBERATELY ENTITY-AGNOSTIC
 * Four share dialogs existed before this — post, profile, community, activity —
 * and each carried its own `${window.location.origin}/...` template and its own
 * unguarded `navigator.clipboard.writeText(...).then(...)`. They had already
 * drifted: the activity dialog copied `/activity/:id`, a path this application
 * has never routed (it is `/crew/:id`), so every activity link anyone copied
 * was dead. That is what duplication costs, and it is why everything below
 * takes a plain `{ url, title, text }` and knows nothing about posts.
 *
 * WHAT EACH PLATFORM REALLY SUPPORTS
 * Every entry here is the documented, supported flow for that platform, not a
 * URL that looks plausible. Where a platform does not support web sharing —
 * Instagram — this says so and does something useful instead, rather than
 * opening an endpoint that shows a login wall.
 */

/**
 * Instagram has no web share endpoint. None.
 *
 * There is no supported way to hand a URL to Instagram from a browser: it has
 * no `sharer` URL, its deep links open the app to a compose screen that cannot
 * be prefilled with a link, and the story-sharing API is for registered mobile
 * apps with a Facebook App ID. Anything that appears to work is a login wall
 * with a redirect on the other side.
 *
 * So the Instagram button does the honest thing. On a device with a native
 * share sheet it opens that — Instagram is in it, and the OS handles the
 * handoff properly. Everywhere else it copies the link and says to paste it,
 * which is what a person was going to have to do regardless.
 */
export const INSTAGRAM_GUIDANCE =
  'Link copied. Paste it into your Instagram story, bio or a DM.';

/**
 * What the Instagram button will do, which depends on the device.
 *
 * With a share sheet it hands the link to the OS and Instagram appears in the
 * list like every other installed app — that is the good path, and it is what
 * a phone gets. Without one there is nothing to hand it to, so the link is
 * copied. Saying "we copy it" on a phone that is about to open a share sheet
 * is simply untrue, and the button is surprising enough already.
 */
export const INSTAGRAM_HINT_SHEET =
  'Opens your phone’s share sheet, where you can pick Instagram.';

export const INSTAGRAM_HINT_COPY =
  'Instagram cannot be sent a link from the web. We copy it so you can paste it into your story, bio or a DM.';

/**
 * The share destinations, in the order they are shown.
 *
 * `id` is stable and used for analytics and tests; `label` is what a screen
 * reader announces. `build` returns the URL to open, or null for the targets
 * that are not a URL at all.
 *
 * The order is the order they are shown, and it is deliberate: Copy link leads
 * because it is the one destination that cannot fail and the fallback every
 * other target uses, Instagram follows because it resolves to the same action,
 * then the platforms that genuinely open a composer.
 */
export const SHARE_TARGETS = [
  {
    id: 'copy',
    label: 'Copy link',
    // First, and not a URL. Copying is the destination that always works —
    // every platform below can fail on a popup blocker, a missing app or an
    // in-app browser, and this is what they all fall back to. It is also what
    // somebody reaches for when the destination they want is not listed.
    build: () => null,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    /**
     * Not a URL — see INSTAGRAM_GUIDANCE. The hint is resolved by the component
     * because it depends on whether this device has a share sheet; see
     * INSTAGRAM_HINT_SHEET and INSTAGRAM_HINT_COPY.
     */
    needsHint: true,
    build: () => null,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    /**
     * `api.whatsapp.com/send` is the documented cross-platform entry point: it
     * opens the app where one is installed and WhatsApp Web where one is not.
     * `wa.me` behaves the same but is documented for contact links, and its
     * text parameter is less reliable on desktop.
     *
     * WhatsApp reads the URL out of the text and unfurls it, so the link goes
     * INSIDE `text` rather than in a separate parameter — there is no separate
     * parameter, and appending one produces a message with a stray query
     * string in it.
     */
    build: ({ url, text }) =>
      `https://api.whatsapp.com/send?text=${encodeURIComponent(joinTextAndUrl(text, url))}`,
  },
  {
    id: 'x',
    label: 'X',
    /**
     * The composer takes `text` and `url` separately and places the link at the
     * end itself. `text` is kept short: X counts a URL as 23 characters
     * whatever its length, so the budget is 280 minus 23 minus a space.
     */
    build: ({ url, text }) =>
      `https://x.com/intent/post?text=${encodeURIComponent(clamp(text, X_TEXT_LIMIT))}&url=${encodeURIComponent(url)}`,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    /**
     * `url` is the only parameter LinkedIn still honours. It retired `title`,
     * `summary` and `source` in 2021 and now builds the post entirely from the
     * page's own Open Graph tags — which is exactly why the server renders
     * them (see backend/src/share). Passing the retired parameters is not
     * harmful, but it is a promise this code cannot keep, so it does not.
     */
    build: ({ url }) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    /**
     * The submit flow takes the link and a title. Reddit's own limit is 300
     * characters and it rejects the submission rather than truncating, so the
     * title is clamped here.
     */
    build: ({ url, title }) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(clamp(title, REDDIT_TITLE_LIMIT))}`,
  },
];

/** X counts every URL as 23 characters, so the text gets what is left of 280. */
const X_TEXT_LIMIT = 280 - 23 - 1;

/** Reddit rejects a submission whose title is over 300 characters. */
const REDDIT_TITLE_LIMIT = 300;

/** The targets that open a web page, keyed by id. */
export const WEB_SHARE_TARGETS = new Set(['whatsapp', 'x', 'linkedin', 'reddit']);

/**
 * Truncates on a word boundary, because a share composer showing a word cut in
 * half reads as a bug in Meetifyy rather than as a platform limit.
 */
function clamp(value, limit) {
  const text = String(value ?? '').trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s.,;:!-]+$/u, '')}…`;
}

/** "text url", or just the url when there is nothing to say. */
function joinTextAndUrl(text, url) {
  const body = String(text ?? '').trim();
  return body ? `${body} ${url}` : url;
}

/**
 * Opens a share URL in a new tab.
 *
 * WHY AN ANCHOR AND NOT `window.open`
 * `window.open(url, '_blank', 'noopener')` returns **null on success**. That is
 * the specified behaviour — with `noopener` the caller is not supposed to get a
 * handle on the new window — and it is not a failure signal. Treating it as one
 * meant every platform button reported itself blocked, fell through to the copy
 * path, and then failed THAT too: the new tab had already taken focus, and the
 * Clipboard API refuses to write from an unfocused document. One button press,
 * two wrong outcomes, and a "Could not copy the link" message on a share that
 * had in fact worked.
 *
 * A synthetic anchor click carries the same `rel="noopener noreferrer"`
 * protection with no such ambiguity. It is also not what a popup blocker
 * targets: blockers exist to stop programmatic `window.open` calls that did not
 * come from a user gesture, and a link click inside a click handler is an
 * ordinary navigation.
 *
 * Returns false only when the DOM is genuinely unusable, which is the caller's
 * cue to fall back to copying.
 */
export function openShareWindow(url) {
  try {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    // Both, deliberately. `noopener` severs `window.opener` so a third-party
    // page cannot navigate this one; `noreferrer` keeps the URL somebody is
    // reading out of the destination's referer log.
    link.rel = 'noopener noreferrer';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies text to the clipboard, reporting success rather than assuming it.
 *
 * `navigator.clipboard` is undefined on any non-secure origin, which includes
 * the LAN addresses used to test on a real phone — exactly where copy-link
 * matters most — so the `execCommand` path is not legacy politeness, it is the
 * working path for a real case. Both are guarded because a permissions policy
 * can refuse either, and a share dialog that says "Copied!" when nothing was
 * copied is worse than one that admits it failed.
 */
export async function copyToClipboard(value) {
  const text = String(value ?? '');
  if (!text) return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through: a refused permission is not a reason to give up when
    // there is a second mechanism that does not need one.
  }

  try {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    // Off-screen but focusable. `display: none` cannot be selected, and a
    // visible element would flash.
    field.style.position = 'fixed';
    field.style.top = '-9999px';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}

/** Whether this browser can open a native share sheet for a payload. */
export function canNativeShare(payload) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  // `canShare` is not universally implemented; where it is, it is the only
  // reliable way to know a payload will be accepted rather than throw.
  if (typeof navigator.canShare === 'function' && payload) {
    try {
      return navigator.canShare(payload);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Opens the native share sheet.
 *
 * Returns 'shared', 'dismissed' or 'unsupported' rather than throwing, because
 * all three are ordinary outcomes and the caller's response differs: only
 * 'unsupported' should fall back to the copy-link interface.
 *
 * A user closing the sheet rejects the promise with an AbortError, which is not
 * a failure — treating it as one produced an error message every time somebody
 * changed their mind.
 */
export async function shareNatively(payload) {
  if (!payload?.url || !canNativeShare(payload)) return 'unsupported';

  try {
    await navigator.share(payload);
    return 'shared';
  } catch (error) {
    if (error?.name === 'AbortError') return 'dismissed';
    // Safari throws NotAllowedError when share() is called outside a user
    // gesture, and some in-app browsers advertise the API and then refuse.
    return 'unsupported';
  }
}
