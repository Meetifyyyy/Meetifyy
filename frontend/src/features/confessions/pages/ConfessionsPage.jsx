import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useAuth } from '@shared/context/AuthContext';
import {
  useConfession,
  useConfessionProfile,
  useConfessionReactions,
  useConfessionsFeed,
  useConfessionsLive,
  useDeleteConfession,
} from '@shared/hooks/useConfessions';
import { SHARE_KIND } from '@shared/lib/share/content';
import { showToast } from '@shared/utils/toast';
import { ArrowLeft, EyeOff, Flag, Heart, ShieldCheck } from '@shared/components/icons';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import LazyReportModal from '@shared/components/modals/ReportModal/LazyReportModal';
import CampusAffiliationGate from '@features/campus/components/affiliation/CampusAffiliationGate';
import ConfessionsDeck from '../components/ConfessionsDeck';
import HandleSetup from '../components/HandleSetup';
import ConfessionCard from '../components/ConfessionCard';
import ConfessionComposer, { ComposerTrigger } from '../components/ConfessionComposer';
import HandleMark from '../components/HandleMark';
import sharedStyles from '@features/campus/components/skeletons/CampusShared.module.css';
import styles from '../components/Confessions.module.css';

const ShareSheet = lazy(() => import('@shared/components/share/ShareSheet'));

/**
 * Remembered per browser once the deck has been seen, so somebody who read it
 * but left before choosing a name goes straight to the name next time. The
 * thing that really marks onboarding as done is the server-side profile; this
 * only skips the slides.
 */
const DECK_SEEN_PREFIX = 'meetifyy:confessions:deck-seen';

/** Per account: a second account on the same device still gets the deck. */
const deckSeenKey = (userId) => `${DECK_SEEN_PREFIX}:${userId || 'anon'}`;

function readDeckSeen(userId) {
  try {
    return window.localStorage.getItem(deckSeenKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeDeckSeen(userId) {
  try {
    window.localStorage.setItem(deckSeenKey(userId), '1');
  } catch {
    // Private mode / storage blocked: the deck simply shows again next time.
  }
}

/** The ground rules in the desktop side panel. */
const RULES = [
  { icon: EyeOff, title: 'Keep it anonymous', text: 'No names, handles or details that point to a person, yours included.' },
  { icon: Heart, title: 'Be kind', text: 'Honest is fine; cruel isn’t.' },
  { icon: Flag, title: 'Report, don’t retaliate', text: 'Moderators review every reported confession.' },
];

export default function ConfessionsPage() {
  return (
    <main className={`centre centre-wide ${styles.page}`}>
      <CampusAffiliationGate>
        <ConfessionsFlow />
      </CampusAffiliationGate>
    </main>
  );
}

function ConfessionsFlow() {
  const { currentUser } = useAuth();
  const userId = currentUser?.id;
  const { profile, hint, confirmedNone, isError, refetch } = useConfessionProfile();
  const [step, setStep] = useState(() => (readDeckSeen(userId) ? 'handle' : 'deck'));

  const finishDeck = useCallback(() => {
    writeDeckSeen(userId);
    setStep('handle');
  }, [userId]);

  // The feed opens at once for anyone known to have a name: from the cache,
  // or from this device's last answer for the account (the name fills in when
  // the server's lands). The onboarding is shown only on the server's word,
  // given during this visit, that there is no name yet. Until then the page
  // shows its own frame with the feed's placeholders, never the deck: someone
  // who has finished it must not see it flash past on a new device, after
  // clearing storage, or after choosing a name somewhere else.
  if (profile || (profile === undefined && hint === true)) {
    return <ConfessionsHome handle={profile?.handle ?? null} />;
  }

  if (!confirmedNone) {
    if (isError) {
      return (
        <div className={styles.fullState}>
          <p className={styles.stateTitle}>Couldn’t open Confessions.</p>
          <button type="button" className={styles.stateButton} onClick={() => refetch()}>Try again</button>
        </div>
      );
    }
    return <ConfessionsShell />;
  }

  if (step === 'deck') return <ConfessionsDeck onDone={finishDeck} />;
  return (
    <HandleSetup
      onBack={() => setStep('deck')}
      onCreated={(created) => {
        if (!created) refetch();
      }}
    />
  );
}

/**
 * The Campus page header every Campus section uses (Events, Directory,
 * Communities): back to Campus, the section's name, and its own action on the
 * right, here the name you post as.
 */
function ConfessionsHeader({ handle, busy = false }) {
  const goBack = useSmartBack();
  return (
    <div className={`${sharedStyles.headerBanner} ${sharedStyles.compactHeader}`}>
      <header className={sharedStyles.header}>
        <div className={sharedStyles.headerLeftGroup}>
          <button
            type="button"
            className={sharedStyles.headerSquareBtn}
            onClick={() => goBack('/campus')}
            title="Back to Campus"
            aria-label="Back to Campus"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className={sharedStyles.collegeTitle} style={{ margin: 0 }}>Confessions</h1>
        </div>
        {!busy && (
          <div className={sharedStyles.headerActions}>
            <span
              className={styles.meChip}
              aria-busy={handle ? undefined : 'true'}
              aria-label={handle ? `Posting as @${handle}` : 'Loading your name'}
            >
              <HandleMark handle={handle} size={26} />
              {handle
                ? <span className={styles.meChipName} aria-hidden="true">@{handle}</span>
                : <span className={styles.meChipPending} aria-hidden="true" />}
            </span>
          </div>
        )}
      </header>
    </div>
  );
}

/** The page's frame while it is still finding out whether you have a name. */
function ConfessionsShell() {
  return (
    <div className={styles.home} aria-busy="true">
      <ConfessionsHeader busy />
      <div className={styles.layout}>
        <aside className={styles.aside} aria-hidden="true" />
        <section className={styles.feedCol} aria-label="Loading confessions">
          <div className={styles.list}>
            <CardSkeleton />
            <CardSkeleton short />
            <CardSkeleton />
          </div>
        </section>
      </div>
    </div>
  );
}

function ConfessionsHome({ handle }) {
  // `/campus/confessions/:id`: one confession opened from a link (a card
  // shared in a chat), shown first under the composer and marked, with the
  // feed below it.
  const { id: focusId } = useParams();
  const navigate = useNavigate();
  const feed = useConfessionsFeed();
  // Reaction totals live while the page is open; one catch-up request when
  // it is reopened, instead of downloading every loaded page again.
  useConfessionsLive();
  const react = useConfessionReactions();
  const remove = useDeleteConfession();

  const [composerOpen, setComposerOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);

  // Mounted inside the tap, so the composer can focus its field while the
  // gesture still counts and the keyboard comes up with it (see the composer).
  const openComposer = useCallback(() => flushSync(() => setComposerOpen(true)), []);
  const closeComposer = useCallback(() => setComposerOpen(false), []);

  // The hook orders the requests per confession (see useConfessionReactions);
  // this only says what went wrong. Offline was already said by the guard.
  const onReact = useCallback((id, next) => {
    react(id, next, {
      onError: (err) => {
        if (err?.name === 'OfflineError') return;
        showToast(
          err?.status === 404 ? 'That confession is no longer available.' : (err?.message || 'Couldn’t update that. Try again.'),
          'error',
        );
      },
    });
  }, [react]);
  const closeShare = useCallback(() => setShareTarget(null), []);

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      await remove.mutateAsync(target.id);
      showToast('Confession deleted', 'success');
      if (target.id === focusId) navigate('/campus/confessions', { replace: true });
    } catch (err) {
      if (err?.name !== 'OfflineError') showToast(err?.message || 'Couldn’t delete it. Try again.', 'error');
    }
  }, [deleteTarget, remove, focusId, navigate]);

  // Next page when the end of the list scrolls into view.
  const sentinelRef = useRef(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) fetchNextPage();
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className={styles.home}>
      <ConfessionsHeader handle={handle} />

      <div className={styles.layout}>
        <aside className={styles.aside} aria-label="About Confessions">
          <div className={styles.asideCard}>
            <div className={styles.identity}>
              <HandleMark handle={handle} size={44} />
              <div className={styles.identityText}>
                <span className={styles.identityLabel}>Posting as</span>
                <span className={styles.identityName}>{handle ? `@${handle}` : '\u00a0'}</span>
              </div>
            </div>
          </div>
          <section className={styles.asideCard} aria-labelledby="confession-rules">
            <div className={styles.rulesHead}>
              <span className={styles.rulesBadge} aria-hidden="true"><ShieldCheck size={18} /></span>
              <div>
                <h2 id="confession-rules" className={styles.asideHeading}>Ground rules</h2>
                <p className={styles.rulesLede}>Keep Confessions safe for everyone.</p>
              </div>
            </div>
            <ul className={styles.rules}>
              {RULES.map(({ icon: Icon, title, text }) => (
                <li key={title} className={styles.rule}>
                  <span className={styles.ruleIcon} aria-hidden="true"><Icon size={16} /></span>
                  <div>
                    <p className={styles.ruleTitle}>{title}</p>
                    <p className={styles.ruleText}>{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className={styles.feedCol} aria-label="Confessions">
          <ComposerTrigger handle={handle} onOpen={openComposer} />

          {/* A confession opened from a link (a card shared in a chat) goes
              straight under the composer, ahead of the feed, which keeps its
              own order without it: the page opens at the top as usual, with
              that confession first, instead of scrolling down to find it. */}
          {focusId && (
            <FocusedConfession
              id={focusId}
              onReact={onReact}
              onShare={setShareTarget}
              onReport={setReportTarget}
              onDelete={setDeleteTarget}
            />
          )}

          <FeedBody
            feed={feed}
            skipId={focusId}
            onReact={onReact}
            onShare={setShareTarget}
            onReport={setReportTarget}
            onDelete={setDeleteTarget}
            onCompose={openComposer}
          />

          <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
          {feed.isFetchingNextPage && <CardSkeleton />}
          {feed.hasNextPage && !feed.isFetchingNextPage && (
            <button type="button" className={styles.loadMore} onClick={() => fetchNextPage()}>
              Load more
            </button>
          )}
        </section>
      </div>

      <ConfessionComposer open={composerOpen} onClose={closeComposer} />

      <LazyReportModal
        isOpen={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        targetType="CONFESSION"
        targetId={reportTarget?.id}
        targetName={reportTarget ? `@${reportTarget.handle}` : undefined}
        targetPreview={reportTarget?.content?.slice(0, 160)}
        reportedFrom="confessions"
      />

      {shareTarget && (
        <Suspense fallback={null}>
          <ShareSheet isOpen onClose={closeShare} kind={SHARE_KIND.CONFESSION} entity={shareTarget} />
        </Suspense>
      )}

      <ConfirmModal
        visible={Boolean(deleteTarget)}
        title="Delete this confession?"
        description="It will be removed from the feed for everyone. This can’t be undone."
        confirmText="Delete"
        isDestructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

/**
 * The confession a link points at, above the feed. Asked of the server by id,
 * so a deleted, hidden, removed or other-campus one is simply unavailable:
 * the link reveals nothing about it.
 */
function FocusedConfession({ id, onReact, onShare, onReport, onDelete }) {
  const { confession, isLoading, isGone, refetch } = useConfession(id);

  if (isLoading) return <CardSkeleton />;
  if (confession) {
    return (
      <ConfessionCard
        confession={confession}
        highlight
        onReact={onReact}
        onShare={onShare}
        onReport={onReport}
        onDelete={onDelete}
      />
    );
  }
  return (
    <div className={styles.focusMissing} role="status">
      <p className={styles.focusMissingTitle}>
        {isGone ? 'This confession isn’t available' : 'This confession didn’t load'}
      </p>
      <p className={styles.stateText}>
        {isGone
          ? 'It may have been deleted or taken down, or it’s from another campus.'
          : 'Check your connection and try again.'}
      </p>
      {isGone ? (
        <Link to="/campus/confessions" replace className={styles.focusMissingLink}>See all confessions</Link>
      ) : (
        <button type="button" className={styles.focusMissingLink} onClick={() => refetch()}>Try again</button>
      )}
    </div>
  );
}

function FeedBody({ feed, skipId, onReact, onShare, onReport, onDelete, onCompose }) {
  // The confessions the page first drew. Anything new at the top after that
  // gets the entrance; see `.cardEnter`.
  const [firstIds, setFirstIds] = useState(null);
  const ready = feed.confessions.length > 0;
  useEffect(() => {
    if (ready && firstIds === null) setFirstIds(new Set(feed.confessions.map((c) => c.id)));
  }, [ready, firstIds, feed.confessions]);

  if (feed.isLoading) {
    return (
      <div className={styles.list} aria-busy="true" aria-label="Loading confessions">
        <CardSkeleton />
        <CardSkeleton short />
        <CardSkeleton />
      </div>
    );
  }

  if (feed.isError && feed.confessions.length === 0) {
    return (
      <div className={styles.emptyState} role="alert">
        <p className={styles.stateTitle}>The confessions didn’t load.</p>
        <p className={styles.stateText}>Check your connection and try again.</p>
        <button type="button" className={styles.stateButton} onClick={() => feed.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  if (feed.confessions.length === 0) {
    return (
      <div className={styles.emptyState}>
        <svg className={styles.emptyArt} viewBox="0 0 120 90" aria-hidden="true">
          <rect x="14" y="18" width="76" height="56" rx="12" className={styles.emptyBack} transform="rotate(-8 52 46)" />
          <rect x="30" y="14" width="76" height="56" rx="12" className={styles.emptyFront} transform="rotate(4 68 42)" />
          <rect x="42" y="32" width="40" height="6" rx="3" className={styles.emptyLine} transform="rotate(4 68 42)" />
          <rect x="42" y="46" width="28" height="6" rx="3" className={styles.emptyLine} transform="rotate(4 68 42)" />
        </svg>
        <p className={styles.stateTitle}>It’s quiet here. For now.</p>
        <p className={styles.stateText}>Nobody on your campus has confessed yet. Someone has to go first.</p>
        <button type="button" className={styles.stateButton} onClick={onCompose}>Write the first one</button>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {feed.confessions.map((c, i) => (c.id === skipId ? null : (
        <ConfessionCard
          key={c.id}
          confession={c}
          enter={i === 0 && firstIds !== null && !firstIds.has(c.id)}
          onReact={onReact}
          onShare={onShare}
          onReport={onReport}
          onDelete={onDelete}
        />
      )))}
    </div>
  );
}

function CardSkeleton({ short = false }) {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div className={styles.skHead}>
        <span className={styles.skMark} />
        <span className={styles.skBar} style={{ width: '38%' }} />
      </div>
      <span className={styles.skBar} style={{ width: '92%', height: 16 }} />
      <span className={styles.skBar} style={{ width: short ? '54%' : '84%', height: 16 }} />
      {!short && <span className={styles.skBar} style={{ width: '62%', height: 16 }} />}
    </div>
  );
}
