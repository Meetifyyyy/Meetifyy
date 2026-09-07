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
 * Instagram is not a URL, and its whole story lives in `./instagram.js`.
 *
 * The short version, because it is the finding that shaped this file: Stories
 * renders no link preview at all — a link there is a sticker Instagram never
 * fetches `og:image` for — so handing Instagram a URL only ever offers Direct.
 * The card has to travel as an image FILE instead. `instagram.js` owns the
 * capability check, the three modes and the action; the primitives it uses
 * (`canShareFiles`, `shareFiles`, `copyToClipboard`, `shareNatively`) are all
 * below and are not Instagram-specific.
 */

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
     * Not a URL, and its label and hint are not fixed either: both depend on
     * what this device can do for this payload, so `./instagram.js` resolves
     * them and the component asks it. The label here is the fallback.
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

/**
 * Whether this browser can put FILES into the share sheet.
 *
 * Web Share API Level 2. Chrome on Android and Safari on iOS support it;
 * desktop browsers largely do not. This is the capability that decides whether
 * Instagram can be offered a Story at all, so it is checked with a real File
 * rather than by sniffing the user agent — a probe that is wrong is worse than
 * no probe, because the failure lands on the user as a share sheet that does
 * not contain the app they wanted.
 */
export function canShareFiles(type = 'image/jpeg') {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  if (typeof File === 'undefined') return false;

  try {
    // Probed with the type actually being shared. A probe that says `image/jpeg`
    // while the code goes on to share something else is asking the wrong
    // question, and the answer only looks right by luck.
    const probe = new File([new Blob([1])], `probe.${type.split('/')[1]}`, {
      type,
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * Downloads the rendered card and wraps it as a File the share sheet accepts.
 *
 * FETCHED AHEAD OF THE TAP, NOT DURING IT
 * `navigator.share` must be called while the browser still considers the page
 * to have transient activation from a user gesture. Safari in particular
 * refuses a share that comes after an awaited `fetch`. So callers prefetch this
 * when the dialog OPENS and hand the finished File to `share` synchronously
 * when the button is pressed — the fetch happens in the gap where the person is
 * still reading the dialog.
 *
 * Returns null for anything that goes wrong. A missing card falls back to
 * sharing the link, which is the behaviour that existed before.
 */
export async function fetchShareCard(url, fileName = 'card.jpg') {
  if (!url) return null;

  try {
    const response = await fetch(url, {
      // The card is public and the endpoint takes no session. Sending cookies
      // would force a credentialed CORS mode for no reason.
      credentials: 'omit',
      signal: AbortSignal.timeout(CARD_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const blob = await response.blob();
    if (!blob.size || !/^image\//i.test(blob.type)) return null;
    // A share sheet has to hold this in memory and hand it to another app.
    if (blob.size > MAX_CARD_BYTES) return null;

    return new File([blob], fileName, {
      type: blob.type,
      lastModified: Date.now(),
    });
  } catch {
    return null;
  }
}

/**
 * Hands files to the OS share sheet.
 *
 * Files ONLY — no `url`, no `text`. Some share targets refuse a payload that
 * mixes them, and Instagram is one of the ones that behaves least predictably:
 * given an image plus a URL it can fall back to treating the whole thing as a
 * message, which is the case this whole path exists to get away from. The link
 * travels via the clipboard instead, which is where a story link sticker needs
 * it anyway.
 */
export async function shareFiles(files) {
  if (!files?.length) return 'unsupported';
  if (typeof navigator?.share !== 'function') return 'unsupported';

  try {
    if (typeof navigator.canShare === 'function' && !navigator.canShare({ files })) {
      return 'unsupported';
    }
    await navigator.share({ files });
    return 'shared';
  } catch (error) {
    if (error?.name === 'AbortError') return 'dismissed';
    return 'unsupported';
  }
}

/** How long to wait for the card before giving up and sharing the link. */
const CARD_FETCH_TIMEOUT_MS = 8000;

/** Ceiling on a card handed to another application. Ours are well under it. */
const MAX_CARD_BYTES = 8 * 1024 * 1024;

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
