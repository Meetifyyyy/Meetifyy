import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './CrewRightPanel.module.css';

import createActivityBackgroundCharacter from '@assets/images/createactivitybackgroundcharacter.webp';
import CalendarIcon from '@shared/components/ui/CalendarIcon';
import { useAuth } from '@shared/context/AuthContext';
import { useMyActivitiesQuery } from '@shared/hooks/useCrew';
import { mapActivity } from '@shared/utils/mapActivity';

import CreateActivityCard from '../cards/CreateActivityCard';


export default function CrewRightPanel({ onCreateActivity, onViewAll }) {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  // Reads the same ['activities','me'] entry the Crew page already loads, so the
  // sidebar costs no extra request.
  //
  // It used to read the global data hook's activity list, which (a) subscribed
  // this panel to conversations/users/communities, re-rendering it on unrelated
  // traffic, (b) triggered a second GET /api/activities for the public feed on a
  // page that no longer loads that scope, and (c) could only ever find the
  // user's activities that happened to be inside those 20 public rows — their
  // college-only and private ones never appeared here at all.
  const { myActivitiesData } = useMyActivitiesQuery();

  const myActivities = useMemo(() => {
    if (!currentUser) return [];
    const now = new Date();
    // Membership is already guaranteed by the endpoint; only the "still to
    // come" test is left to do here.
    return (myActivitiesData || [])
      .map(mapActivity)
      .filter(Boolean)
      .filter(a => {
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
  }, [myActivitiesData, currentUser]);

  return (
    <aside className={styles.sidebar}>
      {/* Create Activity Card. This is its only home now — the sidebar is
          hidden below 768px, where the header's + button carries the action. */}
      <CreateActivityCard onCreateActivity={onCreateActivity} />

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
