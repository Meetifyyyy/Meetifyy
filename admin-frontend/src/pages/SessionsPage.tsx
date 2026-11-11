import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { AlertTriangle, CheckCircle, Clock, LogOut, Monitor, RefreshCw, ShieldCheck, X } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../components/ConfirmProvider';
import { LoadingState } from '../components/LoadingState';
import './activity.css';

interface AdminSession { id: string; browser?: string | null; os?: string | null; deviceName?: string | null; ip?: string | null; createdAt?: string | null; lastActiveAt?: string | null }
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not recorded';

export const SessionsPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);
  const query = useQuery<AdminSession[]>({ queryKey: ['adminSessions'], queryFn: () => apiRequest('/admin/auth/sessions'), refetchOnWindowFocus: false });
  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/auth/sessions/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
    onSuccess: async () => { setNotice('Session revoked. That device has been signed out.'); await queryClient.invalidateQueries({ queryKey: ['adminSessions'] }); },
  });
  const revokeAll = useMutation({ mutationFn: () => apiRequest('/admin/auth/logout-all', { method: 'POST' }), onSuccess: () => logout() });
  const busy = revoke.isPending || revokeAll.isPending;
  const sessions = query.data ?? [];
  return (
    <div className="admin-page sessions-page">
      <header className="page-header"><div><h2 className="page-title">Active sessions</h2><p className="page-subtitle">Manage the devices signed into your admin account.</p></div><div className="sessions-header-actions"><button type="button" className="btn-secondary activity-refresh" aria-label="Refresh sessions" title="Refresh sessions" onClick={() => query.refetch()} disabled={busy || query.isFetching}><RefreshCw size={17} className={query.isFetching ? 'spin' : undefined} /></button><button type="button" className="btn-danger sessions-revoke-all" disabled={busy || query.isFetching || query.isError || !sessions.length} onClick={() => confirm({ title: 'Revoke all your sessions?', description: 'Your admin account is signed out on every device.', consequences: ['This includes the session you are using now.', 'You will need to sign in again to continue.'], severity: 'high', confirmLabel: 'Revoke all', onConfirm: () => revokeAll.mutateAsync() })}><LogOut size={17} /><span>Revoke all sessions</span></button></div></header>
      <section className="activity-overview tone-blue" aria-label="Your active sessions"><span className="activity-overview-icon"><ShieldCheck size={25} /></span><div><h3>Signed-in devices</h3><p>Review your sessions and revoke any you no longer use.</p></div><div className="activity-overview-count" aria-live="polite"><strong>{query.isLoading || query.isError ? '—' : sessions.length.toLocaleString()}</strong><span>active sessions</span></div></section>
      <div className="sessions-section-heading"><h3>Your sessions</h3><span><Clock size={14} />Most recently active first</span></div>
      {notice && <div className="sessions-notice" role="status"><CheckCircle size={18} /><span>{notice}</span><button type="button" aria-label="Dismiss session update" onClick={() => setNotice(null)}><X size={16} /></button></div>}
      {query.isLoading ? <LoadingState label="Loading sessions…" /> : query.isError ? <div className="activity-state" role="alert"><AlertTriangle size={30} /><h3>Sessions could not be loaded</h3><p>{(query.error as Error)?.message || 'Try loading your sessions again.'}</p><button type="button" className="btn-secondary" disabled={query.isFetching} onClick={() => query.refetch()}>Try again</button></div> : !sessions.length ? <div className="activity-state"><Monitor size={30} /><h3>No active sessions found</h3><p>Devices signed into your admin account will appear here.</p></div> : (
        <section className="sessions-panel" aria-label="Your active admin sessions" aria-busy={query.isFetching}><div className="sessions-grid">{sessions.map((session) => (
          <article key={session.id} className="session-card">
            <header className="session-device"><span className="session-device-icon" aria-hidden="true"><Monitor size={21} /></span><div className="session-device-copy"><h3>{session.deviceName || 'Browser session'}</h3><p>{session.browser || 'Unknown browser'}</p></div><span className="session-active-label"><span aria-hidden="true">•</span>Active</span></header>
            <div className="session-platform" data-redundant={!!session.os && !!session.deviceName && session.os.trim().toLowerCase() === session.deviceName.trim().toLowerCase()}>{session.os || 'Unknown operating system'}</div>
            <dl className="session-metadata"><div><dt>IP address</dt><dd><code>{session.ip || 'Not recorded'}</code></dd></div><div><dt>Signed in</dt><dd>{dateLabel(session.createdAt)}</dd></div><div><dt>Last active</dt><dd>{dateLabel(session.lastActiveAt)}</dd></div></dl>
            <footer className="session-footer"><button type="button" className="btn-danger session-revoke" disabled={busy || query.isFetching} aria-label={`Revoke session on ${session.deviceName || session.browser || 'this device'}`} onClick={() => { setNotice(null); confirm({ title: 'Revoke this session?', description: 'This device is signed out of your admin account immediately.', consequences: ['If this is your current session, you will need to sign in again.'], severity: 'moderate', confirmLabel: 'Revoke session', onConfirm: () => revoke.mutateAsync(session.id) }); }}><LogOut size={16} /><span>Revoke session</span></button></footer>
          </article>
        ))}</div></section>
      )}
    </div>
  );
};
