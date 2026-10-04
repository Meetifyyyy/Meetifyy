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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Link as LinkIcon,
  Linkedin,
  Reddit,
  Share as ShareIcon,
  Whatsapp,
  XPlatform,
} from '@shared/components/icons';
import {
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
  copy: LinkIcon,
  native: ShareIcon,
  share: ShareIcon,
};

/** How long a target's transient label stays before reverting. */
const FEEDBACK_MS = 2400;

/**
 * @param {object} props
 * @param {Array<{id: string, label: string, icon: Function, onSelect: Function}>} [props.leadingTargets]
 *   Extra tiles placed right after Copy link that are actions rather than links —
 *   the installed app's Instagram Story tile. They run their own handler and
 *   get no copy/share fallback.
 */
export default function ShareTargets({ payload, onShared, leadingTargets = [] }) {
  /**
   * The outcome of the last action, attached to the target it belongs to.
   *
   * One object rather than a flag per outcome, so the row cannot end up
   * claiming a copy both succeeded and failed; and keyed by target id so the
   * feedback appears ON the button that was pressed rather than as a line of
   * text somewhere below it.
   *
   * `announcement` is the fuller sentence, carried only to the screen-reader
   * region.
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

      // Website only (see ShareSheet): Instagram cannot be opened with a link
      // to share, so the link is copied for the user to paste there.
      if (target.id === 'instagram') {
        if (await copy('instagram', 'Link copied. Paste it in Instagram')) onShared?.('instagram');
        return;
      }

      if (target.id === 'native' || target.id === 'share') {
        const outcome = await shareNatively(payload);
        if (outcome === 'shared') {
          onShared?.('native');
          return;
        }
        if (outcome === 'unsupported') {
          if (await copy('native')) onShared?.('native');
          return;
        }
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
    [announce, copy, onShared, payload],
  );

  /**
   * The list of share destinations.
   *
   * When the native Web Share API is available, "Share via" is placed
   * beside "Copy link" within the same share-options row.
   */
  const targets = useMemo(() => {
    if (!nativeAvailable) return SHARE_TARGETS;
    const copyIndex = SHARE_TARGETS.findIndex((t) => t.id === 'copy');
    const nativeTarget = {
      id: 'native',
      label: 'Share via',
      build: () => null,
    };
    if (copyIndex === -1) {
      return [nativeTarget, ...SHARE_TARGETS];
    }
    const next = [...SHARE_TARGETS];
    next.splice(copyIndex + 1, 0, nativeTarget);
    return next;
  }, [nativeAvailable]);
  // Copy link always leads; any extra action tiles (the app's Story) follow
  // it, then the platforms.
  const rowTargets = useMemo(() => {
    const copy = targets.filter((t) => t.id === 'copy');
    const rest = targets.filter((t) => t.id !== 'copy');
    return [...copy, ...leadingTargets, ...rest];
  }, [leadingTargets, targets]);

  return (
    <div className={styles.root}>
      {/*
        A list, because that is what it is: a set of destinations rather than a
        paragraph of buttons. Screen readers announce the count, which tells
        somebody how many options they are about to move through.
      */}
      <ul className={styles.targets}>
        {rowTargets.map((target) => {
          const active = feedback?.targetId === target.id;
          const succeeded = active && feedback.tone === 'ok';
          // The check replaces the destination's own mark only while the
          // feedback is up, so the tile still reads as that destination.
          const Icon = succeeded ? Check : target.icon || ICONS[target.id];

          return (
            <li key={target.id}>
              <button
                type="button"
                className={styles.target}
                onClick={() => (target.onSelect ? target.onSelect() : handleTarget(target))}
                // The visible label is beneath the icon and is the accessible
                // name, so no aria-label is needed — and adding one would
                // override the visible text, which breaks voice control.
                data-target={target.id}
              >
                <span className={styles.iconWrap} aria-hidden="true">
                  <Icon size={26} />
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
        band of empty space waiting for it. This carries the fuller sentence and
        is always in the tree, because a live region created at the same moment its text changes
        is not announced at all.
      */}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {feedback?.announcement ?? ''}
      </p>
    </div>
  );
}
