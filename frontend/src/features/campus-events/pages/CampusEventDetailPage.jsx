import { useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, CalendarX } from 'lucide-react';
import { useSmartBack } from '@shared/hooks/useSmartBack';
import { getMediaUrl } from '@shared/api/apiClient';
import { useCampusEvent } from '@shared/hooks/useCampusEvents';
import Skeleton from '@shared/components/skeletons/Skeleton';
import { formatCombinedDateTime, isSingleDayEvent, isSafeRegistrationUrl } from '../utils/formatEvent';
import styles from './CampusEventDetailPage.module.css';

function deriveState(event) {
  if (!event) return { key: 'upcoming', label: 'Upcoming', cls: styles.pillUpcoming };
  if (event.status === 'DRAFT') return { key: 'draft', label: 'Draft', cls: styles.pillDraft };
  const now = Date.now();
  const start = new Date(event.startTime).getTime();
  const end = new Date(event.endTime).getTime();
  if (event.status === 'EXPIRED' || end < now) return { key: 'past', label: 'Ended', cls: styles.pillPast };
  if (start <= now && now <= end) return { key: 'live', label: 'Live now', cls: styles.pillLive };
  return { key: 'upcoming', label: 'Upcoming', cls: styles.pillUpcoming };
}

export default function CampusEventDetailPage() {
  const { id } = useParams();
  const goBack = useSmartBack();
  const { data: event, isLoading, isError } = useCampusEvent(id);

  const back = () => goBack('/campus');

  if (isLoading) {
    return (
      <main className={styles.page}>
        <div className={styles.topbar}>
          <button className={styles.backBtn} onClick={back} aria-label="Back"><ArrowLeft size={20} /></button>
        </div>
        <div className={styles.detailLayout}>
          <div className={styles.posterHero}>
            <Skeleton type="rect" width="100%" height="320px" style={{ borderRadius: '16px' }} />
          </div>
          <div className={styles.content}>
            <Skeleton type="rect" width="80px" height="24px" style={{ borderRadius: '999px' }} />
            <Skeleton type="text" width="70%" height="28px" style={{ borderRadius: '6px', margin: '0.5rem 0 0.25rem' }} />
            <Skeleton type="text" width="40%" height="16px" style={{ borderRadius: '6px', marginBottom: '1rem' }} />
            <Skeleton type="rect" width="100%" height="150px" style={{ borderRadius: '14px' }} />
          </div>
        </div>
      </main>
    );
  }

  if (isError || !event) {
    return (
      <main className={styles.page}>
        <div className={styles.topbar}>
          <button className={styles.backBtn} onClick={back}><ArrowLeft size={20} /></button>
        </div>
        <div className={styles.centerState}>
          <CalendarX size={40} />
          <h2 style={{ margin: 0 }}>Event not found</h2>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>This event may have been removed or is no longer available.</p>
          <button className={styles.backBtn} style={{ width: 'auto', padding: '0 1rem' }} onClick={back}>Back to campus</button>
        </div>
      </main>
    );
  }

  const state = deriveState(event);
  const posterSrc = event.posterUrl ? getMediaUrl(event.posterUrl) : '';
  const registrable = isSafeRegistrationUrl(event.registrationUrl) && state.key !== 'past';

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <button className={styles.backBtn} onClick={back} aria-label="Back"><ArrowLeft size={20} /></button>
      </div>

      <div className={styles.detailLayout}>
        <div className={styles.posterHero}>
          {posterSrc ? (
            <img src={posterSrc} alt={event.title} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          ) : (
            <div className={styles.posterHeroFallback}>{event.title}</div>
          )}
        </div>

        <div className={styles.content}>
          <span className={`${styles.statusPill} ${state.cls}`}>{state.label}</span>
          <h1 className={styles.title}>{event.title}</h1>
          <div className={styles.hostedBy}>Hosted by {event.hostedBy}</div>

          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <img src="/icons/tear-off_calendar_color.svg" width={22} height={22} alt="Date & Time" />
              <div>
                <div className={styles.metaLabel}>{isSingleDayEvent(event.startTime, event.endTime) ? 'Date & Time' : 'Dates & Time'}</div>
                <div className={styles.metaValue}>
                  {formatCombinedDateTime(event.startTime, event.endTime)}
                </div>
              </div>
            </div>
            {event.venue && (
              <div className={styles.metaItem}>
                <img src="/icons/classical_building_color.svg" width={22} height={22} alt="Venue" />
                <div>
                  <div className={styles.metaLabel}>Venue</div>
                  <div className={styles.metaValue}>{event.venue}</div>
                </div>
              </div>
            )}
            <div className={styles.metaItem}>
              <img src="/icons/busts_in_silhouette_color.svg" width={22} height={22} alt="Organizer" />
              <div>
                <div className={styles.metaLabel}>Organizer</div>
                <div className={styles.metaValue}>{event.hostedBy}</div>
              </div>
            </div>
          </div>

          {event.description && (
            <>
              <h3 className={styles.sectionLabel}>About this event</h3>
              <p className={styles.description}>{event.description}</p>
            </>
          )}
        </div>
      </div>

      {isSafeRegistrationUrl(event.registrationUrl) && (
        <div className={styles.registerBar}>
          {registrable ? (
            <a className={styles.registerBtn} href={event.registrationUrl} target="_blank" rel="noopener noreferrer">
              Register Now <ExternalLink size={18} />
            </a>
          ) : (
            <span className={`${styles.registerBtn} ${styles.disabled}`}>
              {state.key === 'past' ? 'This event has ended' : 'Registration not available'}
            </span>
          )}
        </div>
      )}
    </main>
  );
}
