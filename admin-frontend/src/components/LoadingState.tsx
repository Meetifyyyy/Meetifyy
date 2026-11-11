import React from 'react';
import './LoadingState.css';

export const LoadingState: React.FC<{ label: string; compact?: boolean }> = ({ label, compact = false }) => (
  <div className={`admin-loading-state${compact ? ' is-compact' : ''}`} role="status" aria-live="polite">
    <span className="analytics-loading-spinner spin" aria-hidden="true" />
    <span>{label}</span>
  </div>
);
