import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Activity, RefreshCw } from './icons';

interface ComponentHealth {
  status: 'UP' | 'DOWN';
  latencyMs?: number;
  detail?: string;
}

export const StatusWidget: React.FC = () => {
  const { data: status, isLoading, refetch, isRefetching } = useQuery<Record<string, ComponentHealth>>({
    queryKey: ['platformStatus'],
    queryFn: () => apiRequest('/admin/dashboard/platform-status'),
    refetchInterval: 30000,
  });

  return (
    <div className="glass-panel" style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Activity size={16} color="var(--color-primary)" />
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>System Health</h3>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isRefetching}
          className="btn-secondary"
          style={{ padding: '0.25rem 0.65rem', fontSize: '0.75rem' }}
        >
          <RefreshCw size={12} className={isRefetching ? 'spin' : ''} />
          <span>{isRefetching ? 'Checking' : 'Refresh'}</span>
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: 'var(--color-text-dim)', fontSize: '0.8rem' }}>Checking services...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem' }}>
          {status &&
            Object.entries(status).map(([service, info]) => {
              const isUp = info.status === 'UP';
              return (
                <div
                  key={service}
                  style={{
                    background: 'var(--color-bg-alt)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.6rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize', color: 'var(--color-text-main)' }}>
                      {service}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)' }}>
                      {info.latencyMs !== undefined ? `${info.latencyMs}ms` : (isUp ? 'Operational' : 'Offline')}
                    </div>
                  </div>
                  <span className={isUp ? 'badge badge-success' : 'badge badge-danger'} style={{ fontSize: '0.65rem' }}>
                    {isUp ? 'UP' : 'DOWN'}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};
