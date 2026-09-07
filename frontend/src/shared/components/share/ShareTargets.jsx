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
  SHARE_TARGETS,
  canNativeShare,
  copyToClipboard,
  openShareWindow,
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

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const announce = useCallback((targetId, tone, label, announcement) => {
    setFeedback({ targetId, tone, label, announcement: announcement ?? label });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
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
        // Instagram has no web share endpoint — see shareTargets.js. On a
        // device with a share sheet the OS hands off properly; everywhere else
        // the honest answer is the copied link and an instruction.
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
          <span>Share via…</span>
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
                // Only Instagram carries one, and what it says depends on the
                // device: a phone gets the share sheet, a desktop gets a copy,
                // and describing the wrong one is worse than describing none.
                title={
                  target.needsHint
                    ? nativeAvailable
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
