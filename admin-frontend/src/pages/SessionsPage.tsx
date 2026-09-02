import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Monitor, LogOut, Trash2 } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';

export const SessionsPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { logout } = useAuth();

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['adminSessions'],
    queryFn: () => apiRequest('/admin/auth/sessions'),
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) =>
      apiRequest(`/admin/auth/sessions/${sessionId}/revoke`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminSessions'] }),
  });

  const logoutAllMutation = useMutation({
    mutationFn: () => apiRequest('/admin/auth/logout-all', { method: 'POST' }),
    onSuccess: () => logout(),
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Active Sessions</h2>
          <p className="page-subtitle">Super admin sessions and connected devices.</p>
        </div>
        <button
          onClick={() => confirm({
            title: 'Revoke every active session?',
            description: 'All super admin sessions are ended immediately, on every device.',
            consequences: [
              'You will be signed out of this session too.',
              'Anyone currently working in the portal loses their session without warning.',
            ],
            severity: 'high',
            confirmLabel: 'Revoke all',
            onConfirm: () => logoutAllMutation.mutateAsync(),
          })}
          className="btn-danger"
        >
          <LogOut size={15} />
          <span>Revoke All Sessions</span>
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '1.25rem' }}>
        {isLoading ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
            Loading sessions...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {sessions?.map((session: any) => (
              <div
                key={session.id}
                style={{
                  background: 'var(--color-bg-alt)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '1rem 1.15rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '8px',
                      background: 'var(--color-primary-tint)',
                      border: '1px solid rgba(37, 99, 235, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Monitor size={18} color="var(--color-primary)" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-main)' }}>
                      {session.browser || 'Browser'} on {session.os || 'OS'} ({session.deviceName || 'Device'})
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-light)', marginTop: '0.15rem' }}>
                      IP: {session.ip} • Last Active: {new Date(session.lastActiveAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => confirm({
                    title: 'Revoke this session?',
                    description: 'That device is signed out of the admin portal immediately.',
                    severity: 'moderate',
                    confirmLabel: 'Revoke session',
                    onConfirm: () => revokeMutation.mutateAsync(session.id),
                  })}
                  className="btn-danger"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                >
                  <Trash2 size={13} />
                  <span>Revoke</span>
                </button>
              </div>
            ))}

            {sessions?.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
                No active sessions found.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
