/**
 * The row of external share destinations, used by every share dialog.
 *
 * WHY ONE COMPONENT
 * Four dialogs — post, profile, community, activity — each ended in a lone
 * "Copy Link" button with its own unguarded clipboard call and its own URL
 * template. They looked the same only by accident and had already drifted:
 * one of them copied a path this application does not route. Everything a
 * dialog needs to offer is here, and a dialog supplies only what it is sharing.
 *
 * It takes a finished `{ url, title, text }` payload rather than an entity, so
 * it stays useful for the next thing Meetifyy makes shareable without learning
 * about it. The payloads are built in `@shared/lib/share/sharePayload`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Instagram,
  Link as LinkIcon,
  Linkedin,
  Reddit,
  Share as ShareIcon,
  Whatsapp,
  XPlatform,
} from '@shared/components/icons';
import {
  INSTAGRAM_GUIDANCE,
  INSTAGRAM_HINT_COPY,
  INSTAGRAM_HINT_SHEET,
  INSTAGRAM_STORY_GUIDANCE,
  SHARE_TARGETS,
  canNativeShare,
  canShareFiles,
  copyToClipboard,
  fetchShareCard,
  openShareWindow,
  shareFiles,
  shareNatively,
} from '@shared/lib/share/shareTargets';
import styles from './ShareTargets.module.css';

const ICONS = {
  whatsapp: Whatsapp,
  x: XPlatform,
  linkedin: Linkedin,
  reddit: Reddit,
  instagram: Instagram,
  copy: LinkIcon,
};

/** How long a target's transient label stays before reverting. */
const FEEDBACK_MS = 2400;

/**
 * The type of the file handed to a share sheet.
 *
 * Named here because two things must agree about it: the capability probe that
 * decides whether to offer file sharing at all, and the endpoint that renders
 * the story. Probing for one type and sharing another is a question whose
 * answer is only right by accident.
 */
const CARD_MIME = 'image/jpeg';

export default function ShareTargets({ payload, onShared }) {
  /**
   * The outcome of the last action, attached to the target it belongs to.
   *
   * One object rather than a flag per outcome, so the row cannot end up
   * claiming a copy both succeeded and failed; and keyed by target id so the
   * feedback appears ON the button that was pressed rather than as a line of
   * text somewhere below it.
   *
   * `announcement` is the fuller sentence — the Instagram instruction does not
   * fit on a 78px tile — and is carried only to the screen-reader region.
   */
  const [feedback, setFeedback] = useState(null);
  const timerRef = useRef(null);

  // Resolved once per mount: `navigator.share` cannot appear or disappear
  // during the life of a dialog, and calling `canShare` on every render is work
  // for an answer that cannot change.
  const [nativeAvailable] = useState(() => canNativeShare(payload));
  const [fileShareAvailable] = useState(() => canShareFiles(CARD_MIME));

  /** Whether this dialog can hand over a card at all. */
  const cardAvailable = fileShareAvailable && Boolean(payload?.cardImageUrl);

  /**
   * The rendered card, fetched while the dialog is merely open.
   *
   * This is not an optimisation, it is the thing that makes the Instagram path
   * work at all. `navigator.share` has to be called while the page still holds
   * transient activation from the tap, and Safari refuses one that comes after
   * an awaited `fetch`. Downloading the card here — in the seconds somebody
   * spends looking at the dialog — means the tap itself does nothing but hand
   * over a File that is already in memory.
   *
   * The PROMISE is kept, not just the resolved File. A tap that lands before
   * the download finishes then awaits the request already in flight instead of
   * starting a second one — and, crucially, instead of silently giving up.
   *
   * Giving up was the bug. The first version stored only the resolved value and
   * fell through to sharing the link whenever it was still null, so anyone who
   * tapped promptly got the old behaviour — Instagram Direct, no Story — with
   * nothing on screen to say why.
   */
  const cardRef = useRef(null);

  /**
   * The same card once it has resolved, so the common path awaits NOTHING.
   *
   * `await` on an already-settled promise still defers to a microtask, and a
   * tap handler that reaches `navigator.share` a turn later is at the mercy of
   * how each browser accounts for transient activation. When the download has
   * finished — which it has, in every case but a tap within the first second —
   * this ref lets the handler call `share` synchronously, which no browser
   * argues with.
   */
  const cardFileRef = useRef(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    // Only where a File can actually be shared, and only for the things that
    // have a card. Everywhere else this would be a wasted download of an image
    // nothing can use.
    if (!cardAvailable) return undefined;

    const pending = fetchShareCard(payload.cardImageUrl, payload.cardFileName);
    cardRef.current = pending;
    cardFileRef.current = null;
    pending.then((file) => {
      // Guard against a payload that changed while this was in flight: the
      // dialog may now be sharing a different post.
      if (cardRef.current === pending) cardFileRef.current = file;
    });

    return () => {
      cardRef.current = null;
      cardFileRef.current = null;
    };
  }, [cardAvailable, payload?.cardImageUrl, payload?.cardFileName]);

  const announce = useCallback((targetId, tone, label, announcement) => {
    setFeedback({ targetId, tone, label, announcement: announcement ?? label });
    if (timerRef.current) clearTimeout(timerRef.current);
    // 'busy' is a state, not a result: it stands until whatever it is waiting
    // for replaces it, rather than timing out and leaving the button looking
    // idle while work is still going on.
    if (tone !== 'busy') {
      timerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
    }
  }, []);

  const copy = useCallback(
    async (targetId, announcement = 'Link copied') => {
      const ok = await copyToClipboard(payload?.url);
      // Never a success state for something that did not happen: a row that
      // says "Copied" over an empty clipboard sends someone away with nothing
      // to paste and no idea why.
      announce(
        targetId,
        ok ? 'ok' : 'error',
        ok ? 'Copied!' : 'Failed',
        ok ? announcement : 'Could not copy the link',
      );
      return ok;
    },
    [announce, payload?.url],
  );

  const handleTarget = useCallback(
    async (target) => {
      if (!payload?.url) {
        announce(target.id, 'error', 'Failed', 'This link is not available');
        return;
      }

      if (target.id === 'copy') {
        if (await copy('copy')) onShared?.('copy');
        return;
      }

      if (target.id === 'instagram') {
        // Instagram Stories renders no link preview — see shareTargets.js. A
        // URL handed to Instagram only ever opens a Direct message, which is
        // exactly the symptom this branch exists to fix. Sending the CARD as an
        // image is what makes Instagram offer Story and Post.
        //
        // Waited for rather than skipped. The card is normally downloaded
        // before anybody taps, but on a slow connection it is not, and falling
        // back to the link there produces precisely the broken behaviour with
        // no explanation. So the tap waits, and says that it is waiting.
        let card = cardFileRef.current;
        if (!card && cardRef.current) {
          announce('instagram', 'busy', 'Preparing…');
          card = await cardRef.current;
        }

        if (card) {
          // The copy is STARTED here and awaited afterwards, never before the
          // share.
          //
          // It has to start here because the Clipboard API refuses to write
          // from an unfocused document and the share sheet takes focus — a
          // story showing the card still needs a link sticker, and this is
          // where that link comes from. But awaiting it first was the bug:
          // `clipboard.writeText` settles in a later task, by which point
          // Safari has spent the tap's transient activation, so `share` threw
          // NotAllowedError, the handler fell through to sharing the URL, and
          // Instagram offered Direct and nothing else. Which is exactly the
          // symptom this whole branch exists to remove.
          const copying = copyToClipboard(payload.url);
          const outcome = await shareFiles([card]);
          const copied = await copying.catch(() => false);

          if (outcome === 'shared') {
            announce(
              'instagram',
              'ok',
              'Sent!',
              copied ? INSTAGRAM_STORY_GUIDANCE : 'Card sent to Instagram.',
            );
            onShared?.('instagram');
            return;
          }
          if (outcome === 'dismissed') return;
          // Fall through: this device advertised file sharing and then refused
          // it, so try the link.
        }

        const outcome = nativeAvailable ? await shareNatively(payload) : 'unsupported';
        if (outcome === 'shared') {
          onShared?.('instagram');
          return;
        }
        if (outcome === 'dismissed') return;
        if (await copy('instagram', INSTAGRAM_GUIDANCE)) onShared?.('instagram');
        return;
      }

      const url = target.build(payload);
      if (url && openShareWindow(url)) {
        onShared?.(target.id);
        return;
      }

      // The navigation could not be made at all. Rare — a click handler is not
      // what a popup blocker targets — but silently doing nothing is the worst
      // possible response, so the link is copied instead.
      if (await copy(target.id, 'Link copied instead')) onShared?.(target.id);
    },
    [announce, copy, nativeAvailable, onShared, payload],
  );

  const handleNative = useCallback(async () => {
    const outcome = await shareNatively(payload);
    if (outcome === 'shared') onShared?.('native');
    // 'dismissed' is somebody changing their mind, not a failure.
    else if (outcome === 'unsupported') await copy('copy');
  }, [copy, onShared, payload]);

  return (
    <div className={styles.root}>
      {nativeAvailable && (
        <button type="button" className={styles.native} onClick={handleNative}>
          <ShareIcon size={20} aria-hidden="true" />
          {/*
            "link", explicitly. This button hands over the URL, so Instagram
            shows Direct and nothing else — the Story option comes from the
            Instagram tile below, which hands over the card as a file. Two
            buttons that both said "Share" sent people to the wrong one.
          */}
          <span>Share link via…</span>
        </button>
      )}

      {/*
        A list, because that is what it is: a set of destinations rather than a
        paragraph of buttons. Screen readers announce the count, which tells
        somebody how many options they are about to move through.
      */}
      <ul className={styles.targets}>
        {SHARE_TARGETS.map((target) => {
          const active = feedback?.targetId === target.id;
          const succeeded = active && feedback.tone === 'ok';
          // The check replaces the destination's own mark only while the
          // feedback is up, so the tile still reads as that destination.
          const Icon = succeeded ? Check : ICONS[target.id];

          return (
            <li key={target.id}>
              <button
                type="button"
                className={styles.target}
                onClick={() => handleTarget(target)}
                // The visible label is beneath the icon and is the accessible
                // name, so no aria-label is needed — and adding one would
                // override the visible text, which breaks voice control.
                data-target={target.id}
                // Only Instagram carries one, and what it says depends on
                // what this dialog can actually do: the sheet hint promises a
                // ready-made story image, which only a POST has. A profile,
                // community or activity has no rendered card, so it gets the
                // copy hint even on a phone that could share files — promising
                // an image that does not exist is worse than promising none.
                title={
                  target.needsHint
                    ? cardAvailable
                      ? INSTAGRAM_HINT_SHEET
                      : INSTAGRAM_HINT_COPY
                    : undefined
                }
              >
                <span className={styles.iconWrap} aria-hidden="true">
                  <Icon size={22} />
                </span>
                <span className={styles.label}>
                  {active ? feedback.label : target.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        The same outcome, for somebody who cannot see the button change.

        Visually hidden rather than absent: a sighted user reads "Copied!" on
        the tile they just pressed, which is where they are already looking, and
        a second line of text below the row was both redundant and a permanent
        band of empty space waiting for it. This carries the fuller sentence —
        the Instagram instruction does not fit on a tile — and is always in the
        tree, because a live region created at the same moment its text changes
        is not announced at all.
      */}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {feedback?.announcement ?? ''}
      </p>
    </div>
  );
}
