import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import {
  Plus,
  Search,
  X,
} from 'lucide-react';

export const CollegesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page] = useState(1);

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingCollege, setEditingCollege] = useState<any>(null);
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

  const collegesList = data?.data || [];

  // Summary Metrics
  const metrics = useMemo(() => {
    let totalDomains = 0;
    let totalStudents = 0;
    let approvedCount = 0;
    let disabledCount = 0;

    collegesList.forEach((c: any) => {
      totalDomains += c.domains?.length || 0;
      totalStudents += c._count?.users || 0;
      if (c.status === 'APPROVED') approvedCount++;
      if (c.status === 'DISABLED') disabledCount++;
    });

    return {
      total: data?.meta?.total || collegesList.length,
      domains: totalDomains,
      students: totalStudents,
      approved: approvedCount,
      disabled: disabledCount,
    };
  }, [collegesList, data?.meta?.total]);

  const createMutation = useMutation({
    mutationFn: (newCollege: any) =>
      apiRequest('/admin/colleges', {
        method: 'POST',
        body: JSON.stringify(newCollege),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminColleges'] });
      handleCloseModal();
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to create college');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      apiRequest(`/admin/colleges/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminColleges'] });
      handleCloseModal();
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to update college');
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

  const restoreMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/admin/colleges/${id}/restore`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminColleges'] }),
  });

  const handleOpenAdd = () => {
    setEditingCollege(null);
    setName('');
    setShortName('');
    setDomainsInput('');
    setCity('');
    setState('');
    setFormError(null);
    setShowAddModal(true);
  };

  const handleOpenEdit = (college: any) => {
    setEditingCollege(college);
    setName(college.name || '');
    setShortName(college.shortName || '');
    setDomainsInput(college.domains?.map((d: any) => d.domain).join(', ') || '');
    setCity(college.city || '');
    setState(college.state || '');
    setFormError(null);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingCollege(null);
    setName('');
    setShortName('');
    setDomainsInput('');
    setCity('');
    setState('');
    setFormError(null);
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
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

    const payload = {
      name,
      shortName,
      domains,
      city,
      state,
      country,
    };

    setIsSubmitting(true);
    try {
      if (editingCollege) {
        await updateMutation.mutateAsync({ id: editingCollege.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to save institution');
    } finally {
      setIsSubmitting(false);
    }
  };

  const parsedDomainsPreview = useMemo(() => {
    return domainsInput
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }, [domainsInput]);

  const isSaving = isSubmitting || createMutation.isPending || updateMutation.isPending;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'fadeIn 0.3s ease' }}>
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.2rem' }}>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px', color: '#fff' }}>
              Campus & Domain Directory
            </h2>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 9px', borderRadius: '20px', background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
              Live System
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Manage verified institutions, set up student email domain whitelist rules, and monitor active campus links.
          </p>
        </div>

        <button
          onClick={handleOpenAdd}
          className="btn-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.65rem 1.15rem',
            borderRadius: '10px',
            fontSize: '0.85rem',
            fontWeight: 700,
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <Plus size={17} /> Add Institution
        </button>
      </div>

      {/* METRIC STAT CARDS - 1 SINGLE COMPACT ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
        <div className="glass-panel" style={{ padding: '0.85rem 1.1rem', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Colleges</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginTop: '0.1rem' }}>{metrics.total}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1.1rem', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Assigned Domains</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginTop: '0.1rem' }}>{metrics.domains}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1.1rem', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Enrolled Students</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginTop: '0.1rem' }}>{metrics.students}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1.1rem', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: '12px' }}>
          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Approved Status</div>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fff', marginTop: '0.1rem' }}>{metrics.approved}</div>
        </div>
      </div>

      {/* SEARCH AND STATUS FILTER TOOLBAR */}
      <div className="glass-panel" style={{ padding: '0.9rem 1.1rem', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', background: 'rgba(30, 41, 59, 0.4)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
          <Search size={16} color="var(--text-dim)" style={{ position: 'absolute', left: '0.9rem', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search by college name, code, city, or domain..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '0.6rem 0.9rem 0.6rem 2.4rem',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '9px',
              color: '#fff',
              fontSize: '0.85rem',
              outline: 'none',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* STATUS PILL BUTTONS */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: '', label: 'All' },
            { id: 'APPROVED', label: 'Approved' },
            { id: 'PENDING', label: 'Pending' },
            { id: 'DISABLED', label: 'Disabled' },
            { id: 'DELETED', label: 'Soft Deleted' },
          ].map((item) => {
            const isActive = statusFilter === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setStatusFilter(item.id)}
                style={{
                  padding: '0.45rem 0.8rem',
                  borderRadius: '7px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: isActive ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                  background: isActive ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.25) 0%, rgba(79, 70, 229, 0.25) 100%)' : 'rgba(15, 23, 42, 0.4)',
                  color: isActive ? '#a5b4fc' : 'var(--text-muted)',
                  transition: 'all 0.15s ease',
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* COLLEGES TABLE */}
      <div className="glass-panel" style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(30, 41, 59, 0.3)' }}>
        {isLoading ? (
          <div style={{ padding: '3.5rem 2rem', textAlign: 'center', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '26px', height: '26px', border: '3px solid rgba(99, 102, 241, 0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span>Fetching institution directory...</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(15, 23, 42, 0.6)', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.6px', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'left' }}>Institution</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'left' }}>Verified Domains</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'left' }}>Location</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'center' }}>Students</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '0.9rem 1.1rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {collegesList.map((college: any) => {
                  const isDeleted = !!college.deletedAt;
                  return (
                    <tr
                      key={college.id}
                      style={{
                        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                        opacity: isDeleted ? 0.6 : 1,
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '0.9rem 1.1rem' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>{college.name}</div>
                          {college.shortName && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                              Code: {college.shortName}
                            </div>
                          )}
                        </div>
                      </td>

                      <td style={{ padding: '0.9rem 1.1rem' }}>
                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                          {college.domains?.map((d: any) => (
                            <span
                              key={d.id}
                              style={{
                                fontSize: '0.75rem',
                                fontFamily: 'monospace',
                                background: d.isPrimary ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255, 255, 255, 0.05)',
                                color: d.isPrimary ? '#a5b4fc' : '#cbd5e1',
                                padding: '3px 8px',
                                borderRadius: '5px',
                                border: d.isPrimary ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid rgba(255, 255, 255, 0.08)',
                              }}
                            >
                              {d.domain}
                            </span>
                          ))}
                          {(!college.domains || college.domains.length === 0) && (
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No domains</span>
                          )}
                        </div>
                      </td>

                      <td style={{ padding: '0.9rem 1.1rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        <span>{[college.city, college.state, college.country].filter(Boolean).join(', ') || 'Unspecified'}</span>
                      </td>

                      <td style={{ padding: '0.9rem 1.1rem', textAlign: 'center' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#fff', background: 'rgba(255, 255, 255, 0.04)', padding: '3px 9px', borderRadius: '7px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                          {college._count?.users || 0}
                        </span>
                      </td>

                      <td style={{ padding: '0.9rem 1.1rem', textAlign: 'center' }}>
                        {isDeleted ? (
                          <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                            DELETED
                          </span>
                        ) : college.status === 'APPROVED' ? (
                          <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                            APPROVED
                          </span>
                        ) : college.status === 'PENDING' ? (
                          <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                            PENDING
                          </span>
                        ) : (
                          <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.3)' }}>
                            DISABLED
                          </span>
                        )}
                      </td>

                      <td style={{ padding: '0.9rem 1.1rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                          {isDeleted ? (
                            <button
                              onClick={() => restoreMutation.mutate(college.id)}
                              disabled={restoreMutation.isPending}
                              style={{
                                padding: '0.35rem 0.75rem',
                                borderRadius: '7px',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                background: 'rgba(16, 185, 129, 0.15)',
                                color: '#34d399',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                cursor: 'pointer',
                              }}
                            >
                              Restore
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => handleOpenEdit(college)}
                                style={{
                                  padding: '0.35rem 0.75rem',
                                  borderRadius: '7px',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  background: 'rgba(99, 102, 241, 0.12)',
                                  color: '#818cf8',
                                  border: '1px solid rgba(99, 102, 241, 0.25)',
                                  cursor: 'pointer',
                                }}
                              >
                                Edit
                              </button>

                              {college.status !== 'APPROVED' && (
                                <button
                                  onClick={() => statusMutation.mutate({ id: college.id, status: 'APPROVED' })}
                                  disabled={statusMutation.isPending}
                                  style={{
                                    padding: '0.35rem 0.75rem',
                                    borderRadius: '7px',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    background: 'rgba(16, 185, 129, 0.12)',
                                    color: '#34d399',
                                    border: '1px solid rgba(16, 185, 129, 0.25)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Approve
                                </button>
                              )}
                              {college.status === 'APPROVED' && (
                                <button
                                  onClick={() => statusMutation.mutate({ id: college.id, status: 'DISABLED' })}
                                  disabled={statusMutation.isPending}
                                  style={{
                                    padding: '0.35rem 0.75rem',
                                    borderRadius: '7px',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    background: 'rgba(245, 158, 11, 0.12)',
                                    color: '#fbbf24',
                                    border: '1px solid rgba(245, 158, 11, 0.25)',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Disable
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (confirm(`Soft delete ${college.name}?`)) {
                                    deleteMutation.mutate(college.id);
                                  }
                                }}
                                disabled={deleteMutation.isPending}
                                style={{
                                  padding: '0.35rem 0.75rem',
                                  borderRadius: '7px',
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                  background: 'rgba(239, 68, 68, 0.12)',
                                  color: '#f87171',
                                  border: '1px solid rgba(239, 68, 68, 0.25)',
                                  cursor: 'pointer',
                                }}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {collegesList.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, color: '#fff' }}>No colleges found</span>
                        <span style={{ fontSize: '0.78rem' }}>Try adjusting your search query or status filter.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ADD / EDIT COLLEGE MODAL (PORTAL TO DOCUMENT BODY FOR PERFECT CENTERING) */}
      {showAddModal &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              background: 'rgba(15, 23, 42, 0.8)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 999999,
              padding: '1rem',
              boxSizing: 'border-box',
            }}
          >
            <div
              className="glass-panel"
              style={{
                width: '100%',
                maxWidth: '520px',
                padding: '1.75rem',
                borderRadius: '16px',
                background: '#1e293b',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.2rem' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  {editingCollege ? 'Edit Institution' : 'Add New Institution'}
                </h3>
                <button
                  onClick={handleCloseModal}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
                >
                  <X size={19} />
                </button>
              </div>

              {formError && (
                <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '0.65rem 0.9rem', borderRadius: '8px', fontSize: '0.82rem', marginBottom: '1.1rem' }}>
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    College Full Name <span style={{ color: '#f87171' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Stanford University"
                    style={{ width: '100%', padding: '0.65rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    Short Name / Code
                  </label>
                  <input
                    type="text"
                    value={shortName}
                    onChange={(e) => setShortName(e.target.value)}
                    placeholder="e.g. Stanford"
                    style={{ width: '100%', padding: '0.65rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                    Approved Student Email Domains (comma-separated) <span style={{ color: '#f87171' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={domainsInput}
                    onChange={(e) => setDomainsInput(e.target.value)}
                    placeholder="e.g. stanford.edu, mail.stanford.edu"
                    style={{ width: '100%', padding: '0.65rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                  />
                  {parsedDomainsPreview.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.45rem' }}>
                      {parsedDomainsPreview.map((domain, idx) => (
                        <span key={idx} style={{ fontSize: '0.7rem', background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', padding: '2px 7px', borderRadius: '4px', border: '1px solid rgba(99, 102, 241, 0.3)' }}>
                          {domain}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Stanford"
                      style={{ width: '100%', padding: '0.65rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>State</label>
                    <input
                      type="text"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="California"
                      style={{ width: '100%', padding: '0.65rem', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', color: '#fff', fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    style={{ padding: '0.6rem 1rem', borderRadius: '8px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    style={{
                      padding: '0.6rem 1.15rem',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      color: '#fff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    {isSaving ? 'Saving...' : editingCollege ? 'Update Institution' : 'Add Institution'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};
