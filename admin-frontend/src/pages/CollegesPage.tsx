import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Plus, Search, X, Check, Clock } from '../components/icons';
import { useDebounced } from '../hooks/useDebounced';
import { Pagination } from '../components/Pagination';
import { useConfirm } from '../components/ConfirmProvider';

export const CollegesPage: React.FC = () => {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'colleges' | 'requests'>('colleges');
  const [search, setSearch] = useState('');
  // Keyed into the query below, so this is what keeps typing from issuing one
  // request per character.
  const debouncedSearch = useDebounced(search.trim(), 300);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter]);

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
  // Set when the Add-College modal was opened to fulfil a student campus
  // request. The request is only marked ADDED once the college actually exists.
  const [fulfillingRequestId, setFulfillingRequestId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['adminColleges', debouncedSearch, statusFilter, page],
    queryFn: () =>
      apiRequest(
        `/admin/colleges?search=${encodeURIComponent(debouncedSearch)}&status=${statusFilter}&page=${page}`,
      ),
  });

  const { data: requestsData, isLoading: isLoadingRequests } = useQuery({
    queryKey: ['adminCollegeRequests'],
    queryFn: () => apiRequest('/admin/colleges/requests/list'),
  });

  const collegesList = data?.data || [];
  const requestsList = requestsData?.data || [];
  // From the server's own count for status=PENDING. Filtering `requestsList`
  // only ever saw the first page of requests, so the tab badge stopped being
  // accurate as soon as there were more than a page of them.
  const { data: pendingRequestsData } = useQuery({
    queryKey: ['adminCollegeRequests', 'PENDING'],
    queryFn: () => apiRequest('/admin/colleges/requests/list?status=PENDING'),
  });
  const pendingRequestsCount = pendingRequestsData?.meta?.total ?? 0;

  /**
   * Directory-wide figures from `meta.counts`. Summing the rendered page made
   * these describe 20 colleges while the cards labelled them as totals.
   */
  const metrics = useMemo(() => {
    const counts = data?.meta?.counts;
    return {
      total: data?.meta?.total ?? collegesList.length,
      domains: counts?.domains ?? 0,
      students: counts?.students ?? 0,
      approved: counts?.approved ?? 0,
    };
  }, [collegesList.length, data?.meta]);

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

  const domainStatusMutation = useMutation({
    mutationFn: ({ collegeId, domainId, status }: { collegeId: string; domainId: string; status: string }) =>
      apiRequest(`/admin/colleges/${collegeId}/domains/${domainId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminColleges'] }),
  });

  const requestStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest(`/admin/colleges/requests/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminCollegeRequests'] }),
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
    setFulfillingRequestId(null);
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
    setFulfillingRequestId(null);
    setName(college.name || '');
    setShortName(college.shortName || '');
    setDomainsInput(college.domains?.map((d: any) => d.domain).join(', ') || '');
    setCity(college.city || '');
    setState(college.state || '');
    setFormError(null);
    setShowAddModal(true);
  };

  /**
   * Approving a student request prefills the Add-College form from it.
   *
   * The request used to be marked ADDED here, before the admin had filled the
   * form in — so cancelling the modal, or a failed create, left the student's
   * request closed with no college behind it and no way to find it again. It is
   * now marked only after the college has actually been created.
   */
  const handleApproveRequest = (req: any) => {
    const domain = req.collegeEmail?.split('@')[1] || '';
    setEditingCollege(null);
    setName(req.collegeName || '');
    setShortName('');
    setDomainsInput(domain);
    setCity('');
    setState('');
    setFormError(null);
    setFulfillingRequestId(req.id);
    setShowAddModal(true);
  };

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingCollege(null);
    setFulfillingRequestId(null);
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
        // The college now exists, so the student request it came from can be
        // closed out. A failure above short-circuits to catch and leaves the
        // request PENDING for another attempt.
        if (fulfillingRequestId) {
          await requestStatusMutation.mutateAsync({ id: fulfillingRequestId, status: 'ADDED' });
        }
      }
    } catch (err: any) {
      setFormError(err.message || 'Failed to save institution');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isSaving = isSubmitting || createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Colleges & Domains</h2>
          <p className="page-subtitle">Verified campus directory and email whitelist.</p>
        </div>
        <button onClick={handleOpenAdd} className="btn-primary">
          <Plus size={15} />
          <span>Add College</span>
        </button>
      </div>

      {/* METRICS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Total Colleges</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.total}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Domains</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.domains}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Enrolled Students</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.15rem' }}>{metrics.students}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.85rem 1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase' }}>Student Requests</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: pendingRequestsCount > 0 ? 'var(--color-warning)' : 'var(--color-text-main)', marginTop: '0.15rem' }}>
            {pendingRequestsCount} Pending
          </div>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('colleges')}
          className={activeTab === 'colleges' ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: '0.82rem', padding: '0.4rem 1rem' }}
        >
          Approved Colleges Directory
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={activeTab === 'requests' ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: '0.82rem', padding: '0.4rem 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          Student Campus Requests
          {pendingRequestsCount > 0 && (
            <span style={{ background: 'var(--color-warning)', color: '#fff', fontSize: '0.68rem', fontWeight: 700, padding: '1px 6px', borderRadius: '10px' }}>
              {pendingRequestsCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'colleges' ? (
        <>
          {/* SEARCH AND FILTERS */}
          <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
              <Search size={15} color="var(--color-text-dim)" style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Search college, code, city, domain..."
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

            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {[
                { id: '', label: 'All' },
                { id: 'APPROVED', label: 'Approved' },
                { id: 'PENDING', label: 'Pending' },
                { id: 'DISABLED', label: 'Disabled' },
              ].map((item) => {
                const isActive = statusFilter === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setStatusFilter(item.id)}
                    className={isActive ? 'btn-primary' : 'btn-secondary'}
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* COLLEGES TABLE */}
          <div className="glass-panel" style={{ overflow: 'hidden' }}>
            {isLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
                Loading colleges...
              </div>
            ) : (
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>College Name</th>
                      <th>Domains</th>
                      <th>Location</th>
                      <th style={{ textAlign: 'center' }}>Students</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collegesList.map((college: any) => {
                      const isDeleted = !!college.deletedAt;
                      return (
                        <tr key={college.id} style={{ opacity: isDeleted ? 0.6 : 1 }}>
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{college.name}</div>
                            {college.shortName && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
                                Code: {college.shortName}
                              </div>
                            )}
                          </td>

                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                              {college.domains?.map((d: any) => {
                                const isDisabled = d.status === 'DISABLED';
                                return (
                                  <button
                                    key={d.id}
                                    type="button"
                                    title={isDisabled ? 'Click to Enable domain' : 'Click to Disable domain'}
                                    onClick={() =>
                                      confirm({
                                        title: isDisabled
                                          ? `Enable ${d.domain}?`
                                          : `Disable ${d.domain}?`,
                                        description: isDisabled
                                          ? 'Addresses on this domain can verify a student account again.'
                                          : 'Addresses on this domain can no longer verify a student account.',
                                        severity: isDisabled ? 'moderate' : 'high',
                                        confirmLabel: isDisabled ? 'Enable domain' : 'Disable domain',
                                        onConfirm: () => domainStatusMutation.mutateAsync({
                                          collegeId: college.id,
                                          domainId: d.id,
                                          status: isDisabled ? 'ACTIVE' : 'DISABLED',
                                        }),
                                      })
                                    }
                                    style={{
                                      fontSize: '0.72rem',
                                      fontFamily: 'monospace',
                                      background: isDisabled
                                        ? 'rgba(239, 68, 68, 0.1)'
                                        : d.isPrimary
                                        ? 'var(--color-primary-tint)'
                                        : 'var(--color-bg-soft)',
                                      color: isDisabled
                                        ? 'var(--color-danger)'
                                        : d.isPrimary
                                        ? 'var(--color-primary)'
                                        : 'var(--color-text-muted)',
                                      padding: '2px 6px',
                                      borderRadius: '4px',
                                      border: isDisabled
                                        ? '1px dashed rgba(239, 68, 68, 0.4)'
                                        : '1px solid var(--color-border)',
                                      cursor: 'pointer',
                                      textDecoration: isDisabled ? 'line-through' : 'none',
                                    }}
                                  >
                                    {d.domain} {isDisabled ? '(Disabled)' : d.isPrimary ? '★' : ''}
                                  </button>
                                );
                              })}
                            </div>
                          </td>

                          <td style={{ color: 'var(--color-text-light)', fontSize: '0.82rem' }}>
                            {[college.city, college.state].filter(Boolean).join(', ') || '—'}
                          </td>

                          <td style={{ textAlign: 'center', fontWeight: 600 }}>
                            {college._count?.users || 0}
                          </td>

                          <td style={{ textAlign: 'center' }}>
                            {isDeleted ? (
                              <span className="badge badge-danger">Deleted</span>
                            ) : college.status === 'APPROVED' ? (
                              <span className="badge badge-success">Approved</span>
                            ) : college.status === 'PENDING' ? (
                              <span className="badge badge-warning">Pending</span>
                            ) : (
                              <span className="badge badge-neutral">Disabled</span>
                            )}
                          </td>

                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                              {isDeleted ? (
                                <button
                                  onClick={() => confirm({
                                    title: `Restore ${college.name}?`,
                                    description: 'The college becomes available again.',
                                    severity: 'moderate',
                                    confirmLabel: 'Restore',
                                    onConfirm: () => restoreMutation.mutateAsync(college.id),
                                  })}
                                  className="btn-secondary"
                                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                                >
                                  Restore
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleOpenEdit(college)}
                                    className="btn-secondary"
                                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                                  >
                                    Edit
                                  </button>

                                  {college.status !== 'APPROVED' && (
                                    <button
                                      onClick={() => confirm({
                                        title: `Approve ${college.name}?`,
                                        description: 'Students can join this college and use its campus spaces.',
                                        severity: 'moderate',
                                        confirmLabel: 'Approve',
                                        onConfirm: () => statusMutation.mutateAsync({ id: college.id, status: 'APPROVED' }),
                                      })}
                                      className="btn-secondary"
                                      style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', color: 'var(--color-success)' }}
                                    >
                                      Approve
                                    </button>
                                  )}
                                  {college.status === 'APPROVED' && (
                                    <button
                                      onClick={() => confirm({
                                        title: `Disable ${college.name}?`,
                                        description: 'The college is hidden and stops accepting new students.',
                                        consequences: [
                                          'Existing students keep their accounts but lose campus spaces.',
                                          'It can be re-enabled at any time.',
                                        ],
                                        severity: 'high',
                                        confirmLabel: 'Disable',
                                        onConfirm: () => statusMutation.mutateAsync({ id: college.id, status: 'DISABLED' }),
                                      })}
                                      className="btn-secondary"
                                      style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', color: 'var(--color-warning)' }}
                                    >
                                      Disable
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      confirm({
                                        title: `Delete ${college.name}?`,
                                        description: 'The college is removed from Meetifyy.',
                                        consequences: [
                                          'Students on this college lose their campus spaces.',
                                          'Its email domains stop verifying new accounts.',
                                        ],
                                        severity: 'critical',
                                        confirmLabel: 'Delete college',
                                        onConfirm: () => deleteMutation.mutateAsync(college.id),
                                      });
                                    }}
                                    className="btn-danger"
                                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
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
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '2.5rem 1rem' }}>
                          No colleges match your filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <Pagination
              page={page}
              totalPages={data?.meta?.totalPages}
              total={data?.meta?.total}
              onChange={setPage}
              label="colleges"
              busy={isLoading}
            />
          </div>
        </>
      ) : (
        /* REQUESTS TABLE */
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          {isLoadingRequests ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
              Loading student requests...
            </div>
          ) : (
            <div className="table-responsive">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Requested College</th>
                    <th>College Email</th>
                    <th>Personal Email</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'center' }}>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requestsList.map((req: any) => (
                    <tr key={req.id}>
                      <td style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>{req.name}</td>
                      <td style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{req.collegeName}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{req.collegeEmail}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--color-text-light)' }}>{req.personalEmail || '—'}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--color-text-dim)' }}>
                        {new Date(req.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {req.status === 'ADDED' ? (
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Check size={12} /> Whitelisted
                          </span>
                        ) : req.status === 'REJECTED' ? (
                          <span className="badge badge-danger">Rejected</span>
                        ) : (
                          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Clock size={12} /> Pending
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                          {req.status !== 'ADDED' && (
                            <button
                              type="button"
                              onClick={() => handleApproveRequest(req)}
                              className="btn-primary"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                            >
                              Approve & Whitelist
                            </button>
                          )}
                          {req.status === 'PENDING' && (
                            <button
                              type="button"
                              onClick={() => confirm({
                                title: 'Reject this college request?',
                                description: 'The request is declined and the college is not added.',
                                severity: 'moderate',
                                confirmLabel: 'Reject request',
                                onConfirm: () => requestStatusMutation.mutateAsync({ id: req.id, status: 'REJECTED' }),
                              })}
                              className="btn-secondary"
                              style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', color: 'var(--color-danger)' }}
                            >
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}

                  {requestsList.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '2.5rem 1rem' }}>
                        No campus requests received yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ADD / EDIT MODAL */}
      {showAddModal &&
        createPortal(
          <div className="modal-backdrop" onClick={handleCloseModal}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  {editingCollege ? 'Edit College' : 'Add College'}
                </h3>
                <button onClick={handleCloseModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-dim)' }}>
                  <X size={18} />
                </button>
              </div>

              {formError && (
                <div style={{ background: 'var(--color-danger-tint)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--color-danger-hover)', padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                  {formError}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '0.85rem' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
                    College Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. GLA University"
                    className="input-control"
                  />
                </div>

                <div style={{ marginBottom: '0.85rem' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
                    Short Code / Abbreviation
                  </label>
                  <input
                    type="text"
                    value={shortName}
                    onChange={(e) => setShortName(e.target.value)}
                    placeholder="e.g. GLA"
                    className="input-control"
                  />
                </div>

                <div style={{ marginBottom: '0.85rem' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>
                    Email Domains (comma-separated)
                  </label>
                  <input
                    type="text"
                    required
                    value={domainsInput}
                    onChange={(e) => setDomainsInput(e.target.value)}
                    placeholder="gla.ac.in, mail.gla.ac.in"
                    className="input-control"
                  />
                </div>

                <div className="grid-split" style={{ gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Mathura"
                      className="input-control"
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>State</label>
                    <input
                      type="text"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="Uttar Pradesh"
                      className="input-control"
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={handleCloseModal} className="btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSaving} className="btn-primary">
                    {isSaving ? 'Saving...' : editingCollege ? 'Save Changes' : 'Create College'}
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
