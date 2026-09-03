import { useParams } from 'react-router-dom';
import { ExternalLink } from '@shared/components/icons';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { getMediaUrl } from '@shared/api/apiClient';
import { useCampusEvent } from '@shared/hooks/useCampusEvents';
import Skeleton from '@shared/components/skeletons/Skeleton';
import NotFoundState from '@shared/components/ui/NotFoundState';
import {
  formatDetailDateDisplay,
  formatDetailTimeDisplay,
  isSafeRegistrationUrl,
} from '../utils/formatEvent';
import { Calendar3DIcon, Clock3DIcon, Venue3DIcon, Organizer3DIcon } from '../components/Event3DIcons';
import styles from './CampusEventDetailPage.module.css';

function deriveState(event) {
  if (!event) return { key: 'upcoming', label: 'Upcoming' };
  if (event.status === 'DRAFT') return { key: 'draft', label: 'Draft' };
  const now = Date.now();
  const start = new Date(event.startTime).getTime();
  const end = new Date(event.endTime).getTime();
  if (event.status === 'EXPIRED' || end < now) return { key: 'past', label: 'Ended' };
  if (start <= now && now <= end) return { key: 'live', label: 'Live now' };
  return { key: 'upcoming', label: 'Upcoming' };
}

export default function CampusEventDetailPage() {
  const { id } = useParams();
  const goBack = useSmartBack();
  const { data: event, isLoading, isError } = useCampusEvent(id);

  const back = () => goBack('/campus');

  if (isLoading) {
    return (
      <main className="centre centre-wide animate-in">
        <div className={styles.page}>
          <div className={styles.topbar}>
            <button className={styles.backBtn} onClick={back} aria-label="Back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          </div>
          <div className={styles.scrollBody}>
            <div className={styles.detailLayout}>
              <div className={styles.posterHero}>
                <Skeleton type="rect" width="100%" height="100%" style={{ aspectRatio: '3 / 4', minHeight: '300px', borderRadius: 'inherit' }} />
              </div>
              <div className={styles.content}>
                <Skeleton type="text" width="65%" height="36px" style={{ borderRadius: '6px' }} />
                <div className={styles.infoSection}>
                  <Skeleton type="rect" width="100%" height="64px" style={{ borderRadius: '14px' }} />
                  <Skeleton type="rect" width="100%" height="64px" style={{ borderRadius: '14px' }} />
                  <Skeleton type="rect" width="100%" height="64px" style={{ borderRadius: '14px' }} />
                  <Skeleton type="rect" width="100%" height="64px" style={{ borderRadius: '14px' }} />
                </div>
                <div className={styles.descriptionSection}>
                  <Skeleton type="text" width="28%" height="22px" style={{ borderRadius: '6px' }} />
                  <Skeleton type="text" width="100%" height="16px" style={{ borderRadius: '4px' }} />
                  <Skeleton type="text" width="85%" height="16px" style={{ borderRadius: '4px' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (isError || !event) {
    return (
      <main style={{ gridColumn: '2 / -1', width: '100%', maxWidth: 'none', margin: 0, padding: 0 }}>
        <NotFoundState
          type="event"
          onAction={() => goBack('/home')}
          coverPage={true}
        />
      </main>
    );
  }

  const state = deriveState(event);
  const posterSrc = event.posterUrl ? getMediaUrl(event.posterUrl) : '';
  const registrable = isSafeRegistrationUrl(event.registrationUrl) && state.key !== 'past';

  return (
    <main className="centre centre-wide animate-in">
      <div className={styles.page}>
        <div className={styles.topbar}>
          <button className={styles.backBtn} onClick={back} aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>

          {isSafeRegistrationUrl(event.registrationUrl) && (
            <div className={styles.topbarActions}>
              {registrable ? (
                <a className={styles.registerBtnTopbar} href={event.registrationUrl} target="_blank" rel="noopener noreferrer">
                  Register <ExternalLink size={16} />
                </a>
              ) : (
                <span className={`${styles.registerBtnTopbar} ${styles.disabled}`}>
                  {state.key === 'past' ? 'Ended' : 'Unavailable'}
                </span>
              )}
            </div>
          )}
        </div>

        <div className={styles.scrollBody}>
          <div className={styles.detailLayout}>
            <div className={styles.posterHero}>
              {posterSrc ? (
                <img src={posterSrc} alt={event.title} loading="eager" decoding="async" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div className={styles.posterHeroFallback}>{event.title}</div>
              )}
            </div>

            <div className={styles.content}>
              <h1 className={styles.title}>{event.title}</h1>

              <div className={styles.infoSection}>
                {/* Date */}
                <div className={styles.infoCard}>
                  <div className={styles.infoIconWrapper}>
                    <Calendar3DIcon size={28} />
                  </div>
                  <div className={styles.infoBody}>
                    <span className={styles.infoSubtitle}>Date</span>
                    <span className={styles.infoValueLarge}>{formatDetailDateDisplay(event.startTime, event.endTime)}</span>
                  </div>
                </div>

                {/* Time */}
                <div className={styles.infoCard}>
                  <div className={styles.infoIconWrapper}>
                    <Clock3DIcon size={28} />
                  </div>
                  <div className={styles.infoBody}>
                    <span className={styles.infoSubtitle}>Time</span>
                    <span className={styles.infoValueLarge}>{formatDetailTimeDisplay(event.startTime, event.endTime)}</span>
                  </div>
                </div>

                {/* Venue */}
                {event.venue && (
                  <div className={styles.infoCard}>
                    <div className={styles.infoIconWrapper}>
                      <Venue3DIcon size={28} />
                    </div>
                    <div className={styles.infoBody}>
                      <span className={styles.infoSubtitle}>Venue</span>
                      <span className={styles.infoValueLarge}>{event.venue}</span>
                    </div>
                  </div>
                )}

                {/* Organizer */}
                <div className={styles.infoCard}>
                  <div className={styles.infoIconWrapper}>
                    <Organizer3DIcon size={28} />
                  </div>
                  <div className={styles.infoBody}>
                    <span className={styles.infoSubtitle}>Organizer</span>
                    <span className={styles.infoValueLarge}>{event.hostedBy}</span>
                  </div>
                </div>
              </div>

              {event.description && (
                <div className={styles.descriptionSection}>
                  <h3 className={styles.sectionLabel}>About this event</h3>
                  <p className={styles.description}>{event.description}</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
