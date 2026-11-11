import React from 'react';
import { AlertCircle, RefreshCw } from '../../components/icons';

export const AnalyticsError: React.FC<{ message: string; retry: () => void }> = ({ message, retry }) => (
  <div className="analytics-error-notice" role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{message}</span>
    <button className="btn-secondary" onClick={retry}><RefreshCw size={16} />Try again</button>
  </div>
);
