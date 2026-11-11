import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageTransition } from '@shared/hooks/usePageTransition';
import { CENTRE_EFFECT } from '@shared/lib/navigation/centreTransition';
import BlurredCover from '@shared/components/ui/BlurredCover';
import CommunityAvatar from './CommunityAvatar';
import { memberLabel, tileColors } from './communityMeta';
import { coverSources, hasDrawnCover, noteCoverDrawn, noteCoverSourceError } from './coverSources';
import { toSummaryText } from '@shared/utils/communityText';
import styles from './CommunityRow.module.css';

/** How long a banner may take before the card is shown without it. */
const COVER_TIMEOUT_MS = 8000;

const ROLE_LABEL = { OWNER: 'Owner', MODERATOR: 'Moderator' };

/**
 * One community in a list, as a block of its own colour.
 *
 * A large icon on the left, with a hairline border; everything else to its right,
 * nothing under it: the name with the join control on its line, the member
 * count (and the viewer's role) right under the name, then the description (two
 * lines at most). The card has a fixed height, so every card is the same size.
 *
 * With a banner the card is the banner picture, blurred, under a dark wash
 * (white text); without one it is a plain card on the page's own surface. The
 * join pill is white either way (outlined on a plain card, so it shows on a
 * light page). (The community's colour shows only under a banner that is still
 * loading, and in the join pill's label.)
 *
 * The name is the link, stretched over the whole card, so the card is one
 * target without nesting the join button inside another interactive element.
 *
 * `showMembership={false}` (the Communities and Campus Communities pages)
 * drops what only restates membership - the role and the settled "Owner" /
 * "Joined" chip - so a joined community shows no action.
 *
 * `highlightOnHover` is for the Campus surfaces: no shadow.
 */
function CommunityRow({ community, from, showMembership = true, highlightOnHover = false }) {
  const { openFromLink } = usePageTransition({ effect: CENTRE_EFFECT });
  const role = showMembership ? ROLE_LABEL[community.userRole] : null;
  const description = community.description && community.description !== community.name
    ? community.description
    : null;
  const { ground, accent, deep } = tileColors(community.color);
  // A community with a banner uses it, blurred, as the card's background (under
  // a dark wash, so the white text reads). Such a card is not shown until that
  // picture has been fetched and drawn: until then it is a placeholder the same
  // size, so the card never appears plain and then changes. Nothing is fetched
  // until the card is near the screen, and what is fetched is the thumbnail
  // where there is one (see coverSources). The blur is BlurredCover's: one small
  // canvas, stretched, nothing recomputed while the list scrolls. A picture that
  // cannot be loaded (or takes more than COVER_TIMEOUT_MS) leaves a plain card.
  const sources = useMemo(() => coverSources(community), [community]);
  const coverKey = sources.join('|');
  const [coverState, setCoverState] = useState(() => (!coverKey ? 'none' : hasDrawnCover(coverKey) ? 'ready' : 'idle'));
  const [prevKey, setPrevKey] = useState(coverKey);
  if (prevKey !== coverKey) {
    setPrevKey(coverKey);
    setCoverState(!coverKey ? 'none' : hasDrawnCover(coverKey) ? 'ready' : 'idle');
  }
  const cardRef = useRef(null);

  // 'idle' -> 'loading' when the card is within a screen or so of the viewport.
  useEffect(() => {
    if (coverState !== 'idle') return undefined;
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver !== 'function') {
      setCoverState('loading');
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        setCoverState('loading');
      }
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [coverState]);

  useEffect(() => {
    if (coverState !== 'loading') return undefined;
    const timer = window.setTimeout(() => setCoverState('failed'), COVER_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [coverState]);

  const onCoverReady = useCallback(() => {
    noteCoverDrawn(coverKey);
    setCoverState('ready');
  }, [coverKey]);
  const onCoverFail = useCallback(() => setCoverState('failed'), []);

  const hasCover = coverState === 'idle' || coverState === 'loading' || coverState === 'ready';
  const pending = coverState === 'idle' || coverState === 'loading';
  return (
    <article
      ref={cardRef}
      data-pending={pending ? '' : undefined}
      aria-busy={pending || undefined}
      className={highlightOnHover ? `${styles.row} ${styles.highlight}` : styles.row}
      data-cover={hasCover ? '' : undefined}
      style={{ '--tile-ground': ground, '--tile-ink': hasCover ? '#ffffff' : 'var(--color-text-main)', '--tile-accent': accent, '--tile-deep': deep }}
    >
      {(coverState === 'loading' || coverState === 'ready') && (
        <BlurredCover
          sources={sources}
          className={styles.cover}
          bitmapWidth={200}
          blurPx={1.5}
          onReady={onCoverReady}
          onFail={onCoverFail}
          onSourceError={noteCoverSourceError}
        />
      )}

      <div className={styles.avatar}>
        <CommunityAvatar community={community} size={84} />
      </div>

      <div className={styles.content}>
        <div className={styles.titleRow}>
          <Link
            to={`/communities/${community.id}`}
            state={from ? { from } : undefined}
            className={styles.name}
            onClick={(e) => openFromLink(e, `/communities/${community.id}`, from ? { state: { from } } : undefined)}
          >
            {community.name}
          </Link>
        </div>
        <p className={styles.meta}>
          {memberLabel(community)}
          {role && <> · {role}</>}
        </p>
        <p className={styles.description}>{description ? toSummaryText(description) : ''}</p>
      </div>
    </article>
  );
}

export default memo(CommunityRow);
