import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Search, ShieldOff, CheckCircle2, Trash2, MailCheck, Building } from 'lucide-react';

export const UsersPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['adminUsers', search, statusFilter, page],
    queryFn: () =>
      apiRequest(
        `/admin/users?search=${encodeURIComponent(search)}&accountStatus=${statusFilter}&page=${page}`,
      ),
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/suspend`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const unsuspendMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/unsuspend`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/restore`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const verifyEmailMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/verify-email`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  const resetCollegeMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/admin/users/${id}/reset-college`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }),
  });

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>User Management</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Inspect user accounts, manage suspensions, manually verify emails, and reset college assignments.
        </p>
      </div>

      {/* Filters Toolbar */}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={16} color="var(--text-dim)" style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search username, display name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '0.6rem 0.85rem 0.6rem 2.4rem',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              color: '#fff',
              fontSize: '0.875rem',
              outline: 'none',
            }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: '0.6rem 1rem',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            color: '#fff',
            fontSize: '0.875rem',
            outline: 'none',
          }}
        >
          <option value="">All Account Statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
          <option value="BANNED">BANNED</option>
        </select>
      </div>

      {/* User Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading users...</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>College</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((u: any) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          background: '#334155',
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                        }}
                      >
                        {u.avatar ? <img src={u.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600 }}>{u.displayName}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>@{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.85rem' }}>{u.email}</div>
                    {u.emailVerified ? (
                      <span style={{ fontSize: '0.7rem', color: '#34d399' }}>✓ Verified</span>
                    ) : (
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Unverified</span>
                    )}
                  </td>
                  <td>
                    {u.college ? (
                      <span style={{ fontSize: '0.8rem', color: '#818cf8', fontWeight: 500 }}>{u.college.name}</span>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>None</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge badge-${u.accountStatus === 'ACTIVE' ? 'success' : 'danger'}`}>
                      {u.accountStatus}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {u.accountStatus === 'ACTIVE' ? (
                        <button onClick={() => suspendMutation.mutate(u.id)} className="btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem' }} title="Suspend User">
                          <ShieldOff size={13} color="#f87171" /> Suspend
                        </button>
                      ) : (
                        <button onClick={() => unsuspendMutation.mutate(u.id)} className="btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem' }} title="Unsuspend User">
                          <CheckCircle2 size={13} color="#34d399" /> Unsuspend
                        </button>
                      )}

                      {!u.emailVerified && (
                        <button onClick={() => verifyEmailMutation.mutate(u.id)} className="btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem' }} title="Verify Email">
                          <MailCheck size={13} color="#34d399" /> Verify
                        </button>
                      )}

                      {u.collegeId && (
                        <button onClick={() => resetCollegeMutation.mutate(u.id)} className="btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem' }} title="Reset College Assignment">
                          <Building size={13} color="#f59e0b" /> Reset College
                        </button>
                      )}

                      {u.accountStatus === 'BANNED' ? (
                        <button onClick={() => restoreMutation.mutate(u.id)} className="btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem' }} title="Restore User">
                          <CheckCircle2 size={13} color="#34d399" /> Restore
                        </button>
                      ) : (
                        <button onClick={() => deleteMutation.mutate(u.id)} className="btn-secondary" style={{ padding: '0.3rem 0.5rem', fontSize: '0.72rem' }} title="Soft Delete">
                          <Trash2 size={13} color="#f87171" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {data?.data?.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    No users found matching query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
