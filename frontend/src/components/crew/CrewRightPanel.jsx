import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './CrewRightPanel.module.css';
import { useData } from '../../context/DataContext';

export default function CrewRightPanel({ onCreateActivity, onViewAll }) {
  const { crewActivities, currentUser } = useData();
  const navigate = useNavigate();

  const myActivities = useMemo(() => {
    if (!currentUser) return [];
    return crewActivities
      .filter(a => a.participants?.includes(currentUser.id))
      .sort((a, b) => new Date(a.dateLabel + ' 2024') - new Date(b.dateLabel + ' 2024'));
  }, [crewActivities, currentUser]);

  return (
    <aside className={styles.sidebar}>
      {/* Create Activity Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>Create an Activity</h3>
        <p className={styles.subtitle}>Post an activity or book people to do something together.</p>
        
        <ul className={styles.benefitsList}>
          <li>
            <div className={styles.iconWrapper}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>
            </div>
            <span>Choose activity type</span>
          </li>
          <li>
            <div className={styles.iconWrapper}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <span>Set date, time & place</span>
          </li>
          <li>
            <div className={styles.iconWrapper}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <span>Invite or open for others</span>
          </li>
          <li>
            <div className={styles.iconWrapper}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/>
                <circle cx="6" cy="12" r="3"/>
                <circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
            </div>
            <span>Share & connect!</span>
          </li>
        </ul>
        
        <button className={styles.createBtn} onClick={onCreateActivity}>
          Create Activity
        </button>
      </div>

      {/* My Upcoming Activities Card */}
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>My Upcoming Activities</h3>
        
        <div className={styles.activityList}>
          {myActivities.length === 0 ? (
            <p className={styles.emptyText}>No upcoming activities yet. Join one to get started!</p>
          ) : (
            myActivities.slice(0, 2).map(activity => (
              <div 
                key={activity.id} 
                className={styles.activityItem}
                onClick={() => {
                  const chatId = String(activity.id).startsWith('act_') ? activity.id : `act_${activity.id}`;
                  navigate(`/messages/${chatId}`);
                }}
                style={{ cursor: 'pointer' }}
              >
                <div className={styles.calendarBadge}>
                  <div className={styles.calMonth}>
                    {activity.date ? new Date(activity.date).toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : 'M'}
                  </div>
                  <div className={styles.calDay}>
                    {activity.date ? new Date(activity.date).getDate() : '-'}
                  </div>
                </div>
                <div className={styles.activityDetails}>
                  <h4>{activity.title}</h4>
                  <div className={styles.activityMeta}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <span>{activity.location || 'No location'}</span>
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
