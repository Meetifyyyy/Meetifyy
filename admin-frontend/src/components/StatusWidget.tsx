import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Activity, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';

interface ComponentHealth {
  status: 'UP' | 'DOWN';
  latencyMs?: number;
  detail?: string;
}

export const StatusWidget: React.FC = () => {
  const { data: status, isLoading, refetch, isRefetching } = useQuery<Record<string, ComponentHealth>>({
    queryKey: ['platformStatus'],
    queryFn: () => apiRequest('/admin/dashboard/platform-status'),
    refetchInterval: 30000, // Refresh every 30s
  });

  return (
    <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Activity size={18} color="var(--color-primary)" />
          <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Infrastructure Health</h3>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="btn-secondary"
          style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
        >
          <RefreshCw size={12} className={isRefetching ? 'spin' : ''} />
          {isRefetching ? 'Checking...' : 'Refresh'}
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Checking platform health...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
          {status &&
            Object.entries(status).map(([service, info]) => {
              const isUp = info.status === 'UP';
              return (
                <div
                  key={service}
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.75rem 0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'capitalize' }}>
                      {service}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                      {info.detail || (isUp ? 'Operational' : 'Unavailable')}
                      {info.latencyMs !== undefined && ` (${info.latencyMs}ms)`}
                    </div>
                  </div>
                  {isUp ? (
                    <CheckCircle2 size={16} color="#10b981" />
                  ) : (
                    <XCircle size={16} color="#ef4444" />
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};
