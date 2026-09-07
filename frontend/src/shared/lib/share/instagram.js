/**
 * Everything Instagram-specific, in one file.
 *
 * WHY THIS IS SEPARATE FROM shareTargets.js
 * Every other destination in this app is a URL template. Instagram is not a
 * URL at all — it is a capability question with three different answers and a
 * different action behind each — and that logic had grown across two files: the
 * hint strings and the file-sharing primitives in `shareTargets.js`, the
 * decision about which of them to use inside the React component. Adding the
 * Story/Instagram distinction to the UI meant that decision had to be readable
 * in one place, and testable without rendering anything.
 *
 * WHAT IS AND IS NOT POSSIBLE HERE, AND WHY
 * The experience people ask for — tap a button, Instagram's Story composer
 * opens with our card already placed on it — is what Threads and X do. Both are
 * native applications, and the mechanism they use is native-only:
 *
 *   iOS      `instagram-stories://share`, with the assets handed over as
 *            `UIPasteboard` items keyed `com.instagram.sharedSticker.*` and a
 *            registered Facebook App ID in `source_application`.
 *   Android  an `Intent` with action `com.instagram.share.ADD_TO_STORY`, a
 *            `content://` URI from a FileProvider, `FLAG_GRANT_READ_URI_
 *            PERMISSION`, and the same App ID as an intent extra.
 *
 * A web page can do none of it. It cannot write typed pasteboard items, it
 * cannot mint a `content://` URI, and it cannot grant another package read
 * permission on one. Triggering the scheme alone — which IS all a browser can
 * do — opens Instagram with an empty composer and drops the card on the floor,
 * so it is not implemented here: it would look like the feature working while
 * being strictly worse than what we do instead.
 *
 * This application is a browser-only PWA. There is no Capacitor, Cordova,
 * React Native or other native shell in the repository, and no Facebook App ID
 * in any configuration, so neither mechanism is reachable and no amount of
 * front-end work makes it reachable. The ceiling for a web app is the OS share
 * sheet carrying an image file — one tap further than native, and it lands the
 * user in the same composer.
 *
 * THE THREE MODES
 * `story`  Web Share Level 2 is available AND there is a rendered card. The
 *          card goes over as an `image/jpeg` File; Instagram advertises "Add
 *          to story" and "Add to post" for `image/*`, which is precisely the
 *          option a URL does not produce.
 * `link`   A share sheet exists but there is no card — a profile, community or
 *          activity. Instagram will only offer Direct for a link, and that is
 *          said plainly rather than dressed up as a Story.
 * `copy`   No share sheet at all, i.e. a desktop browser. The link is copied.
 */
import {
  canNativeShare,
  canShareFiles,
  copyToClipboard,
  shareFiles,
  shareNatively,
} from './shareTargets';

/**
 * The type of the file handed to a share sheet.
 *
 * Named once because two things must agree about it: the capability probe that
 * decides whether to offer a Story at all, and the endpoint that renders the
 * card. Probing for one type and sharing another is a question whose answer is
 * only right by accident — it was, for a while, when the probe asked about
 * JPEG and the renderer still produced PNG.
 */
const INSTAGRAM_CARD_MIME = 'image/jpeg';

/**
 * How long to wait for the clipboard before deciding the confirmation wording
 * without it. Short: the write either happened while the page still had focus
 * or it did not.
 */
const COPY_CONFIRM_MS = 1500;

/** Resolves to the promise's value, or `false` if it takes too long or fails. */
async function settledWithin(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const INSTAGRAM_MODE = {
  STORY: 'story',
  LINK: 'link',
  COPY: 'copy',
};

/**
 * What the Instagram button can actually do in THIS browser for THIS payload.
 *
 * Feature-detected, never sniffed. `canShareFiles` builds a real `File` of the
 * real type and asks `navigator.canShare` about it, which is the only question
 * whose answer is binding; a user-agent guess that is wrong lands on somebody
 * as a share sheet missing the app they wanted.
 *
 * The payload matters as much as the browser: a phone that can share files
 * still cannot send a Story for something that has no card, which is why this
 * takes both.
 */
export function resolveInstagramMode(payload) {
  if (payload?.cardImageUrl && canShareFiles(INSTAGRAM_CARD_MIME)) {
    return INSTAGRAM_MODE.STORY;
  }
  if (canNativeShare(payload)) return INSTAGRAM_MODE.LINK;
  return INSTAGRAM_MODE.COPY;
}

/**
 * The tile's label.
 *
 * "Instagram Story" only where a Story is genuinely on offer. Labelling every
 * tile "Instagram Story" and then opening a Direct message is the kind of
 * promise that makes people stop trusting the whole row.
 */
export function instagramLabel(mode) {
  return mode === INSTAGRAM_MODE.STORY ? 'Instagram Story' : 'Instagram';
}

/** The tooltip, which has to describe what this device will really do. */
export function instagramHint(mode) {
  switch (mode) {
    case INSTAGRAM_MODE.STORY:
      return 'Sends a ready-made story image, so Instagram offers Story and Post. The link is copied — Instagram only lets you add a link sticker by hand.';
    case INSTAGRAM_MODE.LINK:
      return 'Opens your share sheet. Instagram only accepts a link as a direct message — there is no story card for this yet.';
    default:
      return 'Instagram cannot be sent a link from the web. We copy it so you can paste it into your story, bio or a DM.';
  }
}

/** Shown after the card has been handed over and the link copied. */
export const INSTAGRAM_STORY_GUIDANCE =
  'Sent to Instagram. Link copied — add a link sticker and paste it.';

/** Shown when all that could be done was copy the link. */
export const INSTAGRAM_GUIDANCE =
  'Link copied. Paste it into your Instagram story, bio or a DM.';

/**
 * Performs the Instagram share.
 *
 * Returns what HAPPENED, not what was attempted: `story` only once
 * `navigator.share` has resolved, which is the OS confirming it accepted the
 * handoff. Nothing here reports a success it did not observe.
 *
 * `card` is passed in rather than fetched. The caller downloads it while the
 * dialog is merely open, because `navigator.share` has to be reached while the
 * page still holds transient activation from the tap — and, for the same
 * reason, the clipboard write below is ISSUED before the share and AWAITED
 * after it. Awaiting it first settles in a later task, Safari treats the
 * activation as spent, `share` throws, and the whole thing degrades to the
 * link — which is Instagram Direct and nothing else. That was the bug.
 */
export async function shareToInstagram({ mode, card, payload }) {
  const url = payload?.url;

  if (mode === INSTAGRAM_MODE.STORY && card) {
    // Issued here, while the document still has focus: the share sheet takes
    // it, and the Clipboard API refuses to write from an unfocused document. A
    // story showing the card still needs a link sticker, and this is where the
    // link for it comes from.
    const copying = copyToClipboard(url);
    const outcome = await shareFiles([card]);
    // Raced, not simply awaited. `clipboard.writeText` is not guaranteed to
    // settle once the document loses focus — and losing focus to the share
    // sheet is exactly what just happened — so awaiting it outright can hang
    // the button on "Preparing…" forever. Its only job is to choose between
    // two confirmation sentences, which is not worth blocking on.
    const copied = await settledWithin(copying, COPY_CONFIRM_MS);

    if (outcome === 'shared') return { outcome: 'story', copied };
    if (outcome === 'dismissed') return { outcome: 'dismissed', copied };
    // Advertised file sharing and then refused it. Fall through to the link,
    // which at least opens Instagram.
  }

  if (mode !== INSTAGRAM_MODE.COPY) {
    // The whole payload, not just the url: this sheet lists every app, and the
    // one-line title is what the ones without link previews show.
    const outcome = await shareNatively(payload);
    if (outcome === 'shared') return { outcome: 'link', copied: false };
    if (outcome === 'dismissed') return { outcome: 'dismissed', copied: false };
  }

  const copied = await copyToClipboard(url);
  return { outcome: copied ? 'copied' : 'failed', copied };
}
