import React from 'react';
import { useInstantMatch } from '../../context/InstantMatchContext';

export default function QueueMetrics() {
  const { queueStats, formData } = useInstantMatch();
  const count = queueStats?.count || 0;
  const activityLabel = formData?.activity || 'this activity';

  if (count <= 1) {
    return (
      <div className="searching-stats-box">
        <div className="searching-stat-row">
          <span>You're first in line</span>
        </div>
        <div className="searching-stat-divider" />
        <div className="searching-wait-row">
          We'll notify you the moment someone joins.
        </div>
      </div>
    );
  }

  return (
    <div className="searching-stats-box">
      <div className="searching-stat-row">
        <svg 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span>
          {count} students searching for {activityLabel} right now
        </span>
      </div>
      <div className="searching-stat-divider" />
      <div className="searching-wait-row">
        Average wait: ~{Math.ceil((queueStats.avgWaitSecs || 120) / 60)} minutes
      </div>
    </div>
  );
}
