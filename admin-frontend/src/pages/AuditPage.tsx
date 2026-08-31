import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { FileText, ShieldAlert, Key } from '../components/icons';
import { Pagination } from '../components/Pagination';

export const AuditPage: React.FC = () => {
  const [tab, setTab] = useState<'AUDIT' | 'SECURITY' | 'LOGIN'>('AUDIT');
  // All three endpoints paginate at 20. Without a page control the audit trail
  // was only ever readable 20 rows deep — the oldest entries were unreachable.
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [tab]);

  const { data: auditLogs, isLoading: auditLoading } = useQuery({
    queryKey: ['adminAuditLogs', tab, page],
    queryFn: () => apiRequest(`/admin/audit/logs?page=${page}`),
    enabled: tab === 'AUDIT',
  });

  const { data: securityEvents, isLoading: securityLoading } = useQuery({
    queryKey: ['adminSecurityEvents', tab, page],
    queryFn: () => apiRequest(`/admin/audit/security-events?page=${page}`),
    enabled: tab === 'SECURITY',
  });

  const { data: loginAudits, isLoading: loginLoading } = useQuery({
    queryKey: ['adminLoginAudits', tab, page],
    queryFn: () => apiRequest(`/admin/audit/login-audits?page=${page}`),
    enabled: tab === 'LOGIN',
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Audit Logs</h2>
          <p className="page-subtitle">Security events, admin operations, and authentication history.</p>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => setTab('AUDIT')}
          className={tab === 'AUDIT' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
        >
          <FileText size={14} />
          <span>Audit Logs</span>
        </button>
        <button
          onClick={() => setTab('SECURITY')}
          className={tab === 'SECURITY' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
        >
          <ShieldAlert size={14} />
          <span>Security Events</span>
        </button>
        <button
          onClick={() => setTab('LOGIN')}
          className={tab === 'LOGIN' ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
        >
          <Key size={14} />
          <span>Sign-In History</span>
        </button>
      </div>

      {/* Tab 1: Audit Logs */}
      {tab === 'AUDIT' && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {auditLoading ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>Loading audit logs...</div>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Admin</th>
                    <th>Target</th>
                    <th>IP Address</th>
                    <th style={{ textAlign: 'right' }}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs?.data?.map((log: any) => (
                    <tr key={log.id}>
                      <td><span className="badge badge-info">{log.action}</span></td>
                      <td style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{log.admin?.name || log.adminId}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--color-text-light)' }}>{log.targetType}: {log.targetId}</td>
                      <td style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>{log.ip || '—'}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)', textAlign: 'right' }}>{new Date(log.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {auditLogs?.data?.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--color-text-dim)' }}>No audit logs recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <Pagination
            page={page}
            totalPages={auditLogs?.meta?.totalPages}
            total={auditLogs?.meta?.total}
            onChange={setPage}
            label="entries"
          />
        </div>
      )}

      {/* Tab 2: Security Events */}
      {tab === 'SECURITY' && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {securityLoading ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>Loading security events...</div>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>IP Address</th>
                    <th>Metadata</th>
                    <th style={{ textAlign: 'right' }}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {securityEvents?.data?.map((evt: any) => (
                    <tr key={evt.id}>
                      <td><span className="badge badge-danger">{evt.type}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{evt.ip || '—'}</td>
                      <td style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>{JSON.stringify(evt.metadata)}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)', textAlign: 'right' }}>{new Date(evt.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {securityEvents?.data?.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--color-text-dim)' }}>No security events recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <Pagination
            page={page}
            totalPages={securityEvents?.meta?.totalPages}
            total={securityEvents?.meta?.total}
            onChange={setPage}
            label="events"
          />
        </div>
      )}

      {/* Tab 3: Login Audits */}
      {tab === 'LOGIN' && (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {loginLoading ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>Loading sign-in history...</div>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Result</th>
                    <th>Device</th>
                    <th>IP Address</th>
                    <th style={{ textAlign: 'right' }}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {loginAudits?.data?.map((l: any) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{l.email}</td>
                      <td>
                        <span className={`badge badge-${l.success ? 'success' : 'danger'}`}>
                          {l.success ? 'SUCCESS' : l.failureReason || 'FAILED'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--color-text-light)' }}>{l.browser} on {l.os}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{l.ip}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)', textAlign: 'right' }}>{new Date(l.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {loginAudits?.data?.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--color-text-dim)' }}>No sign-in history recorded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <Pagination
            page={page}
            totalPages={loginAudits?.meta?.totalPages}
            total={loginAudits?.meta?.total}
            onChange={setPage}
            label="sign-ins"
          />
        </div>
      )}
    </div>
  );
};
