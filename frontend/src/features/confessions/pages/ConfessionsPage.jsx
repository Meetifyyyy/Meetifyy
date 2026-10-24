import { useCallback, useEffect, useRef, useState } from 'react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { useCampusAffiliation } from '@shared/hooks/useCampusAffiliation';
import { useAuth } from '@shared/context/AuthContext';
import {
  useConfessionProfile,
  useConfessionsFeed,
  useDeleteConfession,
  useRelateConfession,
} from '@shared/hooks/useConfessions';
import { showToast } from '@shared/utils/toast';
import { ArrowLeft } from '@shared/components/icons';
import ConfirmModal from '@shared/components/modals/ConfirmModal';
import LazyReportModal from '@shared/components/modals/ReportModal/LazyReportModal';
import CampusAffiliationGate from '@features/campus/components/affiliation/CampusAffiliationGate';
import ConfessionsDeck from '../components/ConfessionsDeck';
import HandleSetup from '../components/HandleSetup';
import ConfessionCard from '../components/ConfessionCard';
import ConfessionComposer, { ComposerTrigger } from '../components/ConfessionComposer';
import HandleMark from '../components/HandleMark';
import styles from '../components/Confessions.module.css';

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
  const { profile, hint, isError, refetch } = useConfessionProfile();
  const [step, setStep] = useState(() => (readDeckSeen(userId) ? 'handle' : 'deck'));

  const finishDeck = useCallback(() => {
    writeDeckSeen(userId);
    setStep('handle');
  }, [userId]);

  // The first screen is drawn at once, never behind a spinner. Until the
  // server answers, the device's last answer for this account decides it (an
  // account with a name opens on the feed, its name filled in when it lands);
  // with no answer on the device, the onboarding it would most likely get. A
  // server answer that disagrees replaces it in place.
  const hasProfile = profile !== undefined ? Boolean(profile) : hint === true;

  if (profile === undefined && isError && hint !== false) {
    return (
      <div className={styles.fullState}>
        <p className={styles.stateTitle}>Couldn’t open Confessions.</p>
        <button type="button" className={styles.stateButton} onClick={() => refetch()}>Try again</button>
      </div>
    );
  }

  if (hasProfile) return <ConfessionsHome handle={profile?.handle ?? null} />;
  if (step === 'deck') return <ConfessionsDeck onDone={finishDeck} />;
  return (
    <HandleSetup
      // Creating needs the server's answer first: until it lands, an account
      // that already has a name (a new device) must not be offered another.
      ready={profile !== undefined}
      onBack={() => setStep('deck')}
      onCreated={(created) => {
        if (!created) refetch();
      }}
    />
  );
}

function ConfessionsHome({ handle }) {
  const goBack = useSmartBack();
  const { affiliation } = useCampusAffiliation();
  const collegeName = affiliation?.collegeName || affiliation?.college?.name || 'Your campus';
  const feed = useConfessionsFeed();
  const relate = useRelateConfession();
  const remove = useDeleteConfession();

  const [composerOpen, setComposerOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const openComposer = useCallback(() => setComposerOpen(true), []);
  const closeComposer = useCallback(() => setComposerOpen(false), []);

  // One relate request per confession at a time. A quick double tap would
  // otherwise send POST and DELETE together, and whichever answer arrived
  // last would decide what the button shows — not what the server did last.
  const relatingRef = useRef(new Set());
  const onRelate = useCallback((id, next) => {
    if (relatingRef.current.has(id)) return;
    relatingRef.current.add(id);
    relate.mutate({ id, relate: next }, {
      onError: (err) => {
        if (err?.name !== 'OfflineError') showToast(err?.message || 'Couldn’t update that. Try again.', 'error');
      },
      onSettled: () => relatingRef.current.delete(id),
    });
  }, [relate]);

  const confirmDelete = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    try {
      await remove.mutateAsync(target.id);
      showToast('Confession deleted', 'success');
    } catch (err) {
      if (err?.name !== 'OfflineError') showToast(err?.message || 'Couldn’t delete it. Try again.', 'error');
    }
  }, [deleteTarget, remove]);

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
      <header className={styles.topBar}>
        <button type="button" className={styles.iconBtn} onClick={() => goBack('/campus')} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <span className={styles.topTitle}>Confessions</span>
        <span className={styles.meChip} aria-busy={handle ? undefined : 'true'}>
          <HandleMark handle={handle} size={22} />
          {handle ? `@${handle}` : '\u00a0'}
        </span>
      </header>

      <div className={styles.layout}>
        <aside className={styles.aside}>
          <p className={styles.asideEyebrow}>{collegeName}</p>
          <h1 className={styles.asideTitle}>
            Confess<span className={styles.asideStop}>.</span>
          </h1>
          <p className={styles.asideLede}>
            What your campus is really thinking. No names, only voices.
          </p>
          <div className={styles.identity}>
            <HandleMark handle={handle} size={44} />
            <div>
              <span className={styles.identityLabel}>You are</span>
              <span className={styles.identityName}>{handle ? `@${handle}` : '\u00a0'}</span>
            </div>
          </div>
          <ol className={styles.guidelines}>
            <li><strong>Keep it anonymous.</strong> Yours and everyone else’s: no names, handles or details that point to a person.</li>
            <li><strong>Be kind.</strong> Honest is fine; cruel isn’t.</li>
            <li><strong>Report, don’t reply in anger.</strong> Reported confessions are reviewed by moderators.</li>
          </ol>
        </aside>

        <section className={styles.feedCol} aria-label="Confessions">
          <h1 className={styles.mobileTitle}>
            <span>Confess<span className={styles.asideStop}>.</span></span>
            <span className={styles.mobileCampus}>{collegeName}</span>
          </h1>

          <ComposerTrigger handle={handle} onOpen={openComposer} />

          <FeedBody
            feed={feed}
            onRelate={onRelate}
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
          {!feed.hasNextPage && feed.confessions.length > 8 && (
            <p className={styles.endNote}>You’ve reached the beginning.</p>
          )}
        </section>
      </div>

      <ConfessionComposer open={composerOpen} handle={handle} onClose={closeComposer} />

      <LazyReportModal
        isOpen={Boolean(reportTarget)}
        onClose={() => setReportTarget(null)}
        targetType="CONFESSION"
        targetId={reportTarget?.id}
        targetName={reportTarget ? `@${reportTarget.handle}` : undefined}
        targetPreview={reportTarget?.content?.slice(0, 160)}
        reportedFrom="confessions"
      />

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

function FeedBody({ feed, onRelate, onReport, onDelete, onCompose }) {
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
      {feed.confessions.map((c, i) => (
        <ConfessionCard
          key={c.id}
          confession={c}
          index={i}
          onRelate={onRelate}
          onReport={onReport}
          onDelete={onDelete}
        />
      ))}
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
