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
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>Feature Flags</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Instantly enable or disable platform capabilities (DMs, activities, registration) or adjust rollout percentages.
        </p>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading feature flags...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {flags?.map((flag: any) => (
              <div
                key={flag.id || flag.key}
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Flag size={18} color="var(--color-primary)" />
                    <span style={{ fontWeight: 700, fontSize: '1rem' }}>{flag.key}</span>
                  </div>
                  {flag.description && (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      {flag.description}
                    </p>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.35rem' }}>
                    Rollout: {flag.rolloutPercentage}%
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                      background: flag.enabled ? '#10b981' : 'rgba(239, 68, 68, 0.2)',
                      borderColor: flag.enabled ? '#10b981' : 'rgba(239, 68, 68, 0.4)',
                      color: '#fff',
                    }}
                  >
                    {flag.enabled ? <Check size={16} /> : <X size={16} />}
                    {flag.enabled ? 'ENABLED' : 'DISABLED'}
                  </button>
                </div>
              </div>
            ))}
            {flags?.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No feature flags defined yet.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
