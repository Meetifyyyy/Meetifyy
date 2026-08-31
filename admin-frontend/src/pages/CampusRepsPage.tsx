import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, getMediaUrl } from '../api/apiClient';
import { Search, X, Megaphone, Loader2, Check } from '../components/icons';

const RepAvatar: React.FC<{ user: any }> = ({ user }) => {
  const [imgError, setImgError] = useState(false);

  const avatarUrl = getMediaUrl(user.avatar);
  const initial = (user.displayName || user.username || 'U').charAt(0).toUpperCase();
  const colors = ['#2563EB', '#7C3AED', '#10B981', '#F59E0B', '#EC4899'];
  const bgColor = colors[(initial.charCodeAt(0) || 0) % colors.length];

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={user.displayName || user.username}
        onError={() => setImgError(true)}
        style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--color-border)', flexShrink: 0 }}
      />
    );
  }

  return (
    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: bgColor, color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 }}>
      {initial}
    </div>
  );
};

/** Debounce a fast-changing value so we don't fire a request on every keystroke. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export const CampusRepsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  // Active campus representatives (all campuses).
  const { data: repsData, isLoading: repsLoading } = useQuery({
    queryKey: ['adminCampusReps'],
    queryFn: () => apiRequest('/admin/users/campus-reps'),
  });
  const reps = repsData?.data || [];

  // Colleges that already have a representative → used to enforce one-per-campus
  // in the UI (the backend enforces it authoritatively too).
  const repsByCollegeId = useMemo(() => {
    const map = new Map<string, any>();
    reps.forEach((r: any) => { if (r.college?.id) map.set(r.college.id, r); });
    return map;
  }, [reps]);

  const repsByCampus = useMemo(() => {
    const map = new Map<string, { name: string; reps: any[] }>();
    reps.forEach((r: any) => {
      const key = r.college?.id || 'none';
      const name = r.college?.name || 'No campus';
      if (!map.has(key)) map.set(key, { name, reps: [] });
      map.get(key)!.reps.push(r);
    });
    return Array.from(map.values());
  }, [reps]);

  // Fast, dedicated candidate search (returns isCampusRep + college; no heavy counts).
  const { data: searchData, isFetching: searchLoading } = useQuery({
    queryKey: ['adminRepCandidates', debouncedSearch],
    queryFn: () => apiRequest(`/admin/users/rep-candidates?search=${encodeURIComponent(debouncedSearch)}`),
    enabled: debouncedSearch.length > 0,
  });
  const searchResults = searchData?.data || [];

  const setRepMutation = useMutation({
    mutationFn: ({ id, isCampusRep }: { id: string; isCampusRep: boolean }) =>
      apiRequest(`/admin/users/${id}/campus-rep`, {
        method: 'POST',
        body: JSON.stringify({ isCampusRep }),
      }),
    onMutate: ({ id }) => { setMutatingId(id); setActionError(null); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminCampusReps'] });
      queryClient.invalidateQueries({ queryKey: ['adminRepCandidates'] });
    },
    onError: (err: any) => setActionError(err?.message || 'Failed to update Campus Representative role.'),
    onSettled: () => setMutatingId(null),
  });

  const assign = (id: string) => setRepMutation.mutate({ id, isCampusRep: true });
  const revoke = (id: string) => setRepMutation.mutate({ id, isCampusRep: false });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Campus Representatives</h2>
          <p className="page-subtitle">
            Assign or revoke the Campus Representative role. Each campus can have exactly one
            representative, who can publish official Campus Events.
          </p>
        </div>
      </div>

      {/* METRICS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Active Representatives</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{reps.length}</div>
        </div>
        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Campuses Covered</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{repsByCampus.filter(c => c.name !== 'No campus').length}</div>
        </div>
      </div>

      {actionError && (
        <div className="glass-panel" style={{ padding: '0.7rem 1rem', marginBottom: '1rem', border: '1px solid rgba(239,68,68,0.35)', color: 'var(--color-danger-hover)', fontSize: '0.85rem' }}>
          {actionError}
        </div>
      )}

      {/* ASSIGN — search users */}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-main)', margin: '0 0 0.75rem' }}>Assign a Representative</h3>
        <div style={{ position: 'relative', maxWidth: '420px' }}>
          <Search size={15} color="var(--color-text-dim)" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search name, @username, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-control"
            style={{ paddingLeft: '2.2rem' }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: '0.65rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {debouncedSearch.length > 0 && (
          <div className="table-responsive" style={{ marginTop: '0.85rem' }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>College</th>
                  <th style={{ textAlign: 'center' }}>Role</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {searchLoading && searchResults.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '1.5rem' }}>Searching…</td></tr>
                ) : searchResults.length === 0 ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '1.5rem' }}>No users match your search.</td></tr>
                ) : (
                  searchResults.map((u: any) => {
                    const collegeRep = u.college?.id ? repsByCollegeId.get(u.college.id) : null;
                    const collegeTaken = Boolean(collegeRep) && collegeRep.id !== u.id;
                    const isRowBusy = mutatingId === u.id;
                    return (
                      <tr key={u.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <RepAvatar user={u} />
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{u.displayName || u.username}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>@{u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{u.college?.name || '—'}</td>
                        <td style={{ textAlign: 'center' }}>
                          {u.isCampusRep
                            ? <span className="badge badge-success">Representative</span>
                            : collegeTaken
                              ? <span className="badge badge-warning">Campus has a rep</span>
                              : <span className="badge">User</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {u.isCampusRep ? (
                            <button
                              disabled={isRowBusy}
                              onClick={() => revoke(u.id)}
                              className="btn-secondary"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: 'var(--color-danger-hover)' }}
                            >
                              {isRowBusy ? <Loader2 size={13} className="spin" /> : 'Revoke'}
                            </button>
                          ) : (
                            <button
                              disabled={isRowBusy || !u.college?.id || collegeTaken}
                              title={
                                !u.college?.id ? 'User has no verified campus'
                                  : collegeTaken ? `${u.college?.name} already has a representative (@${collegeRep.username}). Revoke them first.`
                                  : undefined
                              }
                              onClick={() => assign(u.id)}
                              className="btn-primary"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', opacity: collegeTaken ? 0.5 : 1 }}
                            >
                              {isRowBusy ? <Loader2 size={13} className="spin" /> : 'Make Representative'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ACTIVE REPS PER CAMPUS */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Megaphone size={16} color="var(--color-primary)" />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-main)', margin: 0 }}>Active Representatives by Campus</h3>
        </div>

        {repsLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>Loading representatives…</div>
        ) : reps.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
            No Campus Representatives yet. Search above to assign one.
          </div>
        ) : (
          repsByCampus.map((campus) => (
            <div key={campus.name}>
              <div style={{ padding: '0.6rem 1rem', background: 'var(--color-bg-soft, rgba(0,0,0,0.02))', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <Check size={13} /> {campus.name} · {campus.reps.length}
              </div>
              <div className="table-responsive">
                <table className="admin-table">
                  <tbody>
                    {campus.reps.map((u: any) => {
                      const isRowBusy = mutatingId === u.id;
                      return (
                        <tr key={u.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                              <RepAvatar user={u} />
                              <div>
                                <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{u.displayName || u.username}</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>@{u.username}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{u.email}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              disabled={isRowBusy}
                              onClick={() => {
                                if (confirm(`Revoke Campus Representative from @${u.username}?`)) revoke(u.id);
                              }}
                              className="btn-secondary"
                              style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: 'var(--color-danger-hover)' }}
                            >
                              {isRowBusy ? <Loader2 size={13} className="spin" /> : 'Revoke'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
