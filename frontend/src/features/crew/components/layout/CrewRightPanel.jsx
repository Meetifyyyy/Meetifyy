import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './CrewRightPanel.module.css';

import createActivityBackgroundCharacter from '@assets/images/createactivitybackgroundcharacter.webp';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { useData } from '@shared/hooks/useData';

import CreateActivityCard from '../cards/CreateActivityCard';

function getStartsInLabel(act, nowTime = Date.now()) {
  if (!act) return 'Starts soon';

  if (act.status === 'ENDED' || act.status === 'COMPLETED' || act.isEnded) {
    return 'Ended';
  }
  if (act.status === 'CANCELLED') {
    return 'Cancelled';
  }

  if (act.startsInLabel && !act.date && !act.startDate) return act.startsInLabel;

  try {
    const rawDate = act.startDate || act.date || act.createdAt;
    if (rawDate) {
      const targetDate = new Date(rawDate);
      if (isNaN(targetDate.getTime())) return 'Starts soon';

      if (act.time && typeof act.time === 'string') {
        const match = act.time.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const ampm = match[3] ? match[3].toUpperCase() : null;
          if (ampm === 'PM' && h < 12) h += 12;
          if (ampm === 'AM' && h === 12) h = 0;
          targetDate.setHours(h, m, 0, 0);
        }
      }

      const startTime = targetDate.getTime();

      let endTime = null;
      if (act.endDate) {
        const parsedEnd = new Date(act.endDate).getTime();
        if (!isNaN(parsedEnd)) endTime = parsedEnd;
      }

      if (!endTime) {
        let durationHours = 2;
        if (act.duration) {
          const match = String(act.duration).match(/(\d+)/);
          if (match) durationHours = parseInt(match[1], 10);
        }
        endTime = startTime + durationHours * 60 * 60 * 1000;
      }

      if (nowTime >= endTime) {
        return 'Ended';
      }

      const diffMs = startTime - nowTime;

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
      } else {
        return `Already started`;
      }
    }
  } catch (e) {
    // fallback
  }
  return `Starts soon`;
}

export default function CrewRightPanel({ onCreateActivity, onViewAll, showCreateCard = true }) {
  const { crewActivities = [], currentUser } = useData();
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
    const now = new Date();
    return crewActivities
      .filter(a => {
        if (!a.participants?.includes(currentUser.id)) return false;
        
        let hasEnded = a.status === 'ENDED' || a.status === 'CANCELLED' || a.status === 'CLOSED' || a.status === 'COMPLETED';
        const startRaw = a.startDate || a.date;
        const endRaw = a.endDate;
        
        if (!hasEnded) {
          if (endRaw) {
            const end = new Date(endRaw);
            if (!isNaN(end.getTime()) && now >= end) hasEnded = true;
          } else if (startRaw) {
            const start = new Date(startRaw);
            if (!isNaN(start.getTime())) {
              let durationHours = 1;
              if (a.duration) {
                const match = String(a.duration).match(/(\d+)/);
                if (match) durationHours = parseInt(match[1], 10);
              }
              const calculatedEnd = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
              if (now >= calculatedEnd) hasEnded = true;
            }
          }
        }
        
        return !hasEnded;
      })
      .sort((a, b) => new Date(a.startDate || a.createdAt) - new Date(b.startDate || b.createdAt));
  }, [crewActivities, currentUser]);

  return (
    <aside className={styles.sidebar}>
      {/* Create Activity Card */}
      {showCreateCard && (
        <CreateActivityCard onCreateActivity={onCreateActivity} />
      )}

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
                  const cleanId = String(activity.id).replace(/^(act_)+/, '');
                  navigate(`/crew/${cleanId}`, { state: { from: location.pathname } });
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
                    <span style={{ flexShrink: 0 }}>
                      {activity.participants?.length || 1} {activity.status === 'ENDED' || activity.status === 'CANCELLED' ? 'participated' : 'going'}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
