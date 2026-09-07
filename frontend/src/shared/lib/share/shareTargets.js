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
 * Instagram Stories does not render link previews. At all.
 *
 * This is the finding that matters, and it is a platform limitation rather
 * than anything wrong with our Open Graph tags. Instagram has three surfaces
 * and they behave differently:
 *
 *   - Direct messages DO unfurl a link into a card from `og:` tags.
 *   - Stories do NOT. A link in a story is a "link sticker": a small pill
 *     showing the domain, or whatever sticker text the author types. Instagram
 *     never fetches `og:image` for it, so there is no card to appear and no
 *     amount of correct metadata will produce one.
 *
 *     Nor can that sticker be attached from here. Sharing an image to a story
 *     creates the story with the image and nothing else; the sticker is added
 *     by the author, in Instagram, by hand. There is no parameter, no
 *     intent extra and no deep link that carries it — which is why the link is
 *     put on the clipboard for them to paste rather than promised to them.
 *   - Feed captions do not linkify at all.
 *
 * Sharing a URL to Instagram from the OS share sheet therefore only ever
 * offers "Direct" — which is exactly the symptom: no "Add to story", no "Add
 * to post". Instagram's share target advertises those options for `image/*`,
 * not for text.
 *
 * So the closest technically supported approach is not to send a link at all.
 * It is to send the CARD ITSELF as an image file, which Stories accepts as
 * story content — see `shareFiles`. The link is copied alongside it, because a
 * story that shows the card still needs a link sticker to be clickable.
 *
 * The story-sharing deep link (`instagram-stories://share` with a
 * `backgroundImage`) is not an alternative here: it requires a registered
 * Facebook App ID and a native iOS or Android application, and does nothing
 * from a web page.
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
  'Sends a ready-made story image, so Instagram offers Story and Post. The link is copied — Instagram only lets you add a link sticker by hand.';

export const INSTAGRAM_HINT_COPY =
  'Instagram cannot be sent a link from the web. We copy it so you can paste it into your story, bio or a DM.';

/** Shown once the card has been handed over and the link copied. */
export const INSTAGRAM_STORY_GUIDANCE =
  'Story sent. Link copied — add a link sticker and paste it.';

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
