import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './CrewRightPanel.module.css';
import { useData } from '@shared/context/DataContext';
import createActivityBackgroundCharacter from '@assets/images/createactivitybackgroundcharacter.png';
import CalendarIcon from '@shared/components/ui/CalendarIcon';



function getStartsInLabel(act, index = 0, nowTime = Date.now()) {
  if (act.startsInLabel && !act.date) return act.startsInLabel;
  try {
    if (act.date) {
      const targetDate = new Date(act.date);
      if (act.time) {
        const match = act.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const ampm = match[3].toUpperCase();
          if (ampm === 'PM' && h < 12) h += 12;
          if (ampm === 'AM' && h === 12) h = 0;
          targetDate.setHours(h, m, 0, 0);
        }
      }
      const diffMs = targetDate.getTime() - nowTime;
      if (diffMs > 0) {
        if (diffMs >= 24 * 60 * 60 * 1000) {
          const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
          const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
          return `Starts in ${days}d ${hours}hr`;
        } else if (diffMs >= 60 * 60 * 1000) {
          const hours = Math.floor(diffMs / (60 * 60 * 1000));
          const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
          return `Starts in ${hours}hr ${mins}m`;
        } else {
          const mins = Math.floor(diffMs / (60 * 1000));
          const secs = Math.floor((diffMs % (60 * 1000)) / 1000);
          const secsStr = String(secs).padStart(2, '0');
          return `Starts in ${mins}m ${secsStr}s`;
        }
      }
    }
  } catch (e) {
    // fallback
  }
  // mock fallback using nowTime to make it tick down slightly
  const defaultDiff = index === 0 ? 59 * 60 * 1000 + 4 * 1000 : 4 * 60 * 60 * 1000 + 18 * 60 * 1000;
  const targetMock = nowTime + defaultDiff - (nowTime % 3600000);
  const diffMs = targetMock - nowTime;
  if (diffMs > 0) {
    if (diffMs >= 24 * 60 * 60 * 1000) {
      const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
      const hours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      return `Starts in ${days}d ${hours}hr`;
    } else if (diffMs >= 60 * 60 * 1000) {
      const hours = Math.floor(diffMs / (60 * 60 * 1000));
      const mins = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
      return `Starts in ${hours}hr ${mins}m`;
    } else {
      const mins = Math.floor(diffMs / (60 * 1000));
      const secs = Math.floor((diffMs % (60 * 1000)) / 1000);
      const secsStr = String(secs).padStart(2, '0');
      return `Starts in ${mins}m ${secsStr}s`;
    }
  }
  return `Starts soon`;
}

export default function CrewRightPanel({ onCreateActivity, onViewAll }) {
  const { crewActivities, currentUser } = useData();
  const navigate = useNavigate();
  const [nowTime, setNowTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const myActivities = useMemo(() => {
    if (!currentUser) return [];
    return crewActivities
      .filter(a => a.participants?.includes(currentUser.id))
      .sort((a, b) => new Date(a.dateLabel + ' 2024') - new Date(b.dateLabel + ' 2024'));
  }, [crewActivities, currentUser]);

  return (
    <aside className={styles.sidebar}>
      {/* Create Activity Card */}
      <div className={styles.createCard}>
        {/* Background Slash */}
        <div className={styles.blackSlash}>
          <svg viewBox="0 0 200 300" width="100%" height="100%" preserveAspectRatio="none">
            <path d="M120 0 L200 0 L200 300 L60 300 Z" fill="#000000" />
          </svg>
        </div>

        {/* Character Illustration */}
        <img 
          src={createActivityBackgroundCharacter} 
          alt="Creator Character" 
          className={styles.characterImg} 
        />

        <div className={styles.createCardContent}>
          <div className={styles.createCardTitle}>
            CREATE<br />
            ACTIVITY<span className={styles.yellowDot}>.</span>
          </div>
          <p className={styles.createCardSubtitle}>Create your activity in minutes, invite your crew, and start the fun.</p>
        </div>

        {/* Bottom Pill Button */}
        <div className={styles.createCardBottom}>
          <button className={styles.createCardBtn} onClick={onCreateActivity} aria-label="Create Activity">
            <div className={styles.createCardBtnIcon}>
              <span className={styles.btnAsterisk}>*</span>
            </div>
            <span className={styles.createCardBtnText}>CREATE ACTIVITY</span>
            <span className={styles.createCardBtnArrow}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </span>
          </button>
        </div>
      </div>

      {/* My Upcoming Activities Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>My Upcoming Activities</h3>
        
        <div className={styles.activityList}>
          {myActivities.length === 0 ? (
            <p className={styles.emptyText}>No upcoming activities yet. Join one to get started!</p>
          ) : (
            myActivities.slice(0, 2).map((activity, i) => (
              <div 
                key={activity.id} 
                className={styles.eventItem}
                onClick={() => {
                  const chatId = String(activity.id).startsWith('act_') ? activity.id : `act_${activity.id}`;
                  navigate(`/messages/${chatId}`);
                }}
                style={{ cursor: 'pointer' }}
              >
                <CalendarIcon date={activity.date} dateLabel={activity.dateLabel} />
                <div className={styles.eventDetail}>
                  <div className={styles.eventName}>{activity.title}</div>
                  <div className={styles.eventSub}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activity.location || 'Location TBD'}
                    </span>
                    <span style={{ flexShrink: 0, color: 'var(--color-text-muted)', margin: '0 1px' }}>·</span>
                    <span style={{ flexShrink: 0 }}>{activity.participants?.length || 1} going</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        {myActivities.length > 2 && (
          <button className={styles.viewAllBtn} onClick={onViewAll}>View All</button>
        )}
      </div>
    </aside>
  );
}
