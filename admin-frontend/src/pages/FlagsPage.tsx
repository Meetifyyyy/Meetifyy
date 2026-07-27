import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Flag, Check, X } from 'lucide-react';

export const FlagsPage: React.FC = () => {
  const queryClient = useQueryClient();

  const { data: flags, isLoading } = useQuery({
    queryKey: ['adminFlags'],
    queryFn: () => apiRequest('/admin/flags'),
  });

  const toggleMutation = useMutation({
    mutationFn: (flag: any) =>
      apiRequest('/admin/flags', {
        method: 'POST',
        body: JSON.stringify(flag),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminFlags'] }),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Feature Flags</h2>
          <p className="page-subtitle">Toggle platform features and rollout percentages.</p>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        {isLoading ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
            Loading feature flags...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {flags?.map((flag: any) => (
              <div
                key={flag.id || flag.key}
                style={{
                  background: 'var(--color-bg-alt)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1rem 1.15rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <Flag size={16} color="var(--color-primary)" />
                    <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--color-text-main)' }}>{flag.key}</span>
                  </div>
                  {flag.description && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-light)', marginTop: '0.2rem' }}>
                      {flag.description}
                    </p>
                  )}
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-dim)', marginTop: '0.25rem' }}>
                    Rollout: {flag.rolloutPercentage}%
                  </div>
                </div>

                <div>
                  <button
                    onClick={() =>
                      toggleMutation.mutate({
                        key: flag.key,
                        enabled: !flag.enabled,
                        description: flag.description,
                        rolloutPercentage: flag.rolloutPercentage,
                      })
                    }
                    className={flag.enabled ? 'btn-primary' : 'btn-secondary'}
                    style={{
                      background: flag.enabled ? 'var(--color-success)' : 'var(--color-bg-soft)',
                      color: flag.enabled ? '#FFFFFF' : 'var(--color-text-muted)',
                      border: flag.enabled ? '1px solid var(--color-success)' : '1px solid var(--color-border)',
                    }}
                  >
                    {flag.enabled ? <Check size={14} /> : <X size={14} />}
                    <span>{flag.enabled ? 'ENABLED' : 'DISABLED'}</span>
                  </button>
                </div>
              </div>
            ))}

            {flags?.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
                No feature flags defined.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
