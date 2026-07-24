import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Plus, Search, CheckCircle, XCircle, Trash2 } from 'lucide-react';

export const CollegesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page] = useState(1);

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [domainsInput, setDomainsInput] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country] = useState('India');
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['adminColleges', search, statusFilter, page],
    queryFn: () =>
      apiRequest(
        `/admin/colleges?search=${encodeURIComponent(search)}&status=${statusFilter}&page=${page}`,
      ),
  });

  const createMutation = useMutation({
    mutationFn: (newCollege: any) =>
      apiRequest('/admin/colleges', {
        method: 'POST',
        body: JSON.stringify(newCollege),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminColleges'] });
      setShowAddModal(false);
      setName('');
      setShortName('');
      setDomainsInput('');
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to create college');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest(`/admin/colleges/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminColleges'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/admin/colleges/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminColleges'] }),
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const domains = domainsInput
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (domains.length === 0) {
      setFormError('At least one domain is required (e.g. gla.ac.in)');
      return;
    }

    createMutation.mutate({
      name,
      shortName,
      domains,
      city,
      state,
      country,
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>College & Domain Management</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Manage approved universities, assign multiple domains, and verify student signup eligibility.
          </p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn-primary">
          <Plus size={18} /> Add College
        </button>
      </div>

      {/* Filters Toolbar */}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={16} color="var(--text-dim)" style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search college name, short code, city or domain..."
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
          <option value="">All Statuses</option>
          <option value="APPROVED">APPROVED</option>
          <option value="PENDING">PENDING</option>
          <option value="DISABLED">DISABLED</option>
        </select>
      </div>

      {/* Colleges Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading colleges...</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>College Name</th>
                <th>Domains</th>
                <th>Location</th>
                <th>Students</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((college: any) => (
                <tr key={college.id}>
                  <td>
                    <div style={{ fontWeight: 700 }}>{college.name}</div>
                    {college.shortName && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{college.shortName}</div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {college.domains?.map((d: any) => (
                        <span
                          key={d.id}
                          style={{
                            fontSize: '0.72rem',
                            background: 'rgba(99, 102, 241, 0.12)',
                            color: '#818cf8',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid rgba(99, 102, 241, 0.25)',
                          }}
                        >
                          {d.domain}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {[college.city, college.state, college.country].filter(Boolean).join(', ') || 'N/A'}
                  </td>
                  <td style={{ fontWeight: 600 }}>{college._count?.users || 0}</td>
                  <td>
                    <span className={`badge badge-${college.status === 'APPROVED' ? 'success' : college.status === 'PENDING' ? 'warning' : 'danger'}`}>
                      {college.status}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {college.status !== 'APPROVED' && (
                        <button
                          onClick={() => statusMutation.mutate({ id: college.id, status: 'APPROVED' })}
                          className="btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                        >
                          <CheckCircle size={14} color="#10b981" /> Approve
                        </button>
                      )}
                      {college.status === 'APPROVED' && (
                        <button
                          onClick={() => statusMutation.mutate({ id: college.id, status: 'DISABLED' })}
                          className="btn-secondary"
                          style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                        >
                          <XCircle size={14} color="#f87171" /> Disable
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (confirm(`Soft delete ${college.name}?`)) {
                            deleteMutation.mutate(college.id);
                          }
                        }}
                        className="btn-secondary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      >
                        <Trash2 size={14} color="#f87171" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {data?.data?.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    No colleges found matching criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add College Modal */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', padding: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1rem' }}>Add New College</h3>
            {formError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', padding: '0.65rem 0.85rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                {formError}
              </div>
            )}
            <form onSubmit={handleCreateSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>College Full Name</label>
                <input type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. GLA University" style={{ width: '100%', padding: '0.65rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff' }} />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Short Name / Code</label>
                <input type="text" value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="e.g. GLA" style={{ width: '100%', padding: '0.65rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff' }} />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Approved Domains (comma-separated)</label>
                <input type="text" required value={domainsInput} onChange={(e) => setDomainsInput(e.target.value)} placeholder="gla.ac.in, student.gla.ac.in, mail.gla.ac.in" style={{ width: '100%', padding: '0.65rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>City</label>
                  <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Mathura" style={{ width: '100%', padding: '0.65rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>State</label>
                  <input type="text" value={state} onChange={(e) => setState(e.target.value)} placeholder="Uttar Pradesh" style={{ width: '100%', padding: '0.65rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createMutation.isPending} className="btn-primary">
                  {createMutation.isPending ? 'Saving...' : 'Create College'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
