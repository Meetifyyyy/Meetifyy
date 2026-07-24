import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { FileText, ShieldAlert, Key } from 'lucide-react';

export const AuditPage: React.FC = () => {
  const [tab, setTab] = useState<'AUDIT' | 'SECURITY' | 'LOGIN'>('AUDIT');

  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ['adminAuditLogs', tab],
    queryFn: () => apiRequest('/admin/audit/logs'),
    enabled: tab === 'AUDIT',
  });

  const { data: securityEvents, isLoading: securityLoading } = useQuery({
    queryKey: ['adminSecurityEvents', tab],
    queryFn: () => apiRequest('/admin/audit/security-events'),
    enabled: tab === 'SECURITY',
  });

  const { data: loginAudits, isLoading: loginLoading } = useQuery({
    queryKey: ['adminLoginAudits', tab],
    queryFn: () => apiRequest('/admin/audit/login-audits'),
    enabled: tab === 'LOGIN',
  });

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>Audit & Security Event Logs</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Complete audit history of Super Admin operations, security alerts, and login attempts.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          onClick={() => setTab('AUDIT')}
          className={tab === 'AUDIT' ? 'btn-primary' : 'btn-secondary'}
        >
          <FileText size={16} /> Admin Audit Logs
        </button>
        <button
          onClick={() => setTab('SECURITY')}
          className={tab === 'SECURITY' ? 'btn-primary' : 'btn-secondary'}
        >
          <ShieldAlert size={16} /> Security Events
        </button>
        <button
          onClick={() => setTab('LOGIN')}
          className={tab === 'LOGIN' ? 'btn-primary' : 'btn-secondary'}
        >
          <Key size={16} /> Login Audits
        </button>
      </div>

      {/* Tab 1: Audit Logs */}
      {tab === 'AUDIT' && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {auditLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading audit logs...</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Admin</th>
                  <th>Target</th>
                  <th>IP Address</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs?.data?.map((log: any) => (
                  <tr key={log.id}>
                    <td><span className="badge badge-info">{log.action}</span></td>
                    <td style={{ fontWeight: 600 }}>{log.admin?.name || log.adminId}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{log.targetType}: {log.targetId}</td>
                    <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{log.ip || 'N/A'}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{new Date(log.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {auditLogs?.data?.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No audit logs recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 2: Security Events */}
      {tab === 'SECURITY' && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {securityLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading security events...</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Event Type</th>
                  <th>IP Address</th>
                  <th>Metadata</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {securityEvents?.data?.map((evt: any) => (
                  <tr key={evt.id}>
                    <td><span className="badge badge-danger">{evt.type}</span></td>
                    <td style={{ fontFamily: 'monospace' }}>{evt.ip || 'N/A'}</td>
                    <td style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: '#c7d2fe' }}>{JSON.stringify(evt.metadata)}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{new Date(evt.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {securityEvents?.data?.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No security events recorded.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 3: Login Audits */}
      {tab === 'LOGIN' && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {loginLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading login audits...</div>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Result</th>
                  <th>Device / Browser</th>
                  <th>IP Address</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {loginAudits?.data?.map((l: any) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.email}</td>
                    <td>
                      <span className={`badge badge-${l.success ? 'success' : 'danger'}`}>
                        {l.success ? 'SUCCESS' : l.failureReason || 'FAILED'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{l.browser} on {l.os}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{l.ip}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {loginAudits?.data?.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No login audits recorded.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};
