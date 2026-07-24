import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Monitor, LogOut, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const SessionsPage: React.FC = () => {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>Active Admin Sessions</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Monitor logged-in devices and revoke sessions across all browsers.
          </p>
        </div>
        <button
          onClick={() => {
            if (confirm('Revoke all active sessions and log out from all devices?')) {
              logoutAllMutation.mutate();
            }
          }}
          className="btn-secondary"
          style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)' }}
        >
          <LogOut size={16} /> Log Out From All Devices
        </button>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading active sessions...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {sessions?.map((session: any) => (
              <div
                key={session.id}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '10px',
                      background: 'rgba(99, 102, 241, 0.15)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Monitor size={20} color="#818cf8" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                      {session.browser || 'Browser'} on {session.os || 'OS'} ({session.deviceName || 'Desktop'})
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      IP: {session.ip} | Last Active: {new Date(session.lastActiveAt).toLocaleString()}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => revokeMutation.mutate(session.id)}
                  className="btn-secondary"
                  style={{ color: '#f87171', padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                >
                  <Trash2 size={14} /> Revoke Session
                </button>
              </div>
            ))}

            {sessions?.length === 0 && (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                No active sessions found.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
