import React, { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Plus, Search, X, Check, Clock, Trash2 } from '../components/icons';
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
        <button onClick={handleOpenAdd} className="btn-primary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.74rem' }}>
          <Plus size={14} />
          <span>Add College</span>
        </button>
      </div>

      {/* METRICS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 120px), 1fr))', gap: '0.4rem', marginBottom: '0.75rem' }}>
        <div className="glass-panel" style={{ padding: '0.45rem 0.65rem' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Total Colleges</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.05rem' }}>{metrics.total}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.45rem 0.65rem' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Domains</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.05rem' }}>{metrics.domains}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.45rem 0.65rem' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Enrolled Students</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-text-main)', marginTop: '0.05rem' }}>{metrics.students}</div>
        </div>

        <div className="glass-panel" style={{ padding: '0.45rem 0.65rem' }}>
          <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-light)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Student Requests</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: pendingRequestsCount > 0 ? 'var(--color-warning)' : 'var(--color-text-main)', marginTop: '0.05rem' }}>
            {pendingRequestsCount} Pending
          </div>
        </div>
      </div>

      {/* TABS */}
      <div
        className="admin-tab-bar"
        style={{ marginBottom: '0.85rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.4rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}
      >
        <button
          onClick={() => setActiveTab('colleges')}
          className={activeTab === 'colleges' ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: '0.74rem', padding: '0.3rem 0.65rem', flexShrink: 0 }}
        >
          Approved Colleges Directory
        </button>
        <button
          onClick={() => setActiveTab('requests')}
          className={activeTab === 'requests' ? 'btn-primary' : 'btn-secondary'}
          style={{ fontSize: '0.74rem', padding: '0.3rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}
        >
          Student Campus Requests
          {pendingRequestsCount > 0 && (
            <span style={{ background: 'var(--color-warning)', color: '#fff', fontSize: '0.64rem', fontWeight: 700, padding: '1px 5px', borderRadius: '10px' }}>
              {pendingRequestsCount}
            </span>
          )}
        </button>
      </div>

      {activeTab === 'colleges' ? (
        <>
          {/* SEARCH AND FILTERS */}
          <div className="glass-panel admin-filter-bar" style={{ padding: '0.55rem 0.75rem', marginBottom: '0.85rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
              <Search size={14} color="var(--color-text-dim)" style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Search college, code, city, domain..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-control"
                style={{ paddingLeft: '2rem', fontSize: '0.78rem' }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{ position: 'absolute', right: '0.6rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-dim)', cursor: 'pointer' }}
                >
                  <X size={13} />
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
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
                    style={{ padding: '0.25rem 0.55rem', fontSize: '0.72rem' }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* COLLEGES TABLE */}
          <div className="glass-panel" style={{ overflow: 'hidden', padding: 0 }}>
            {isLoading ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.8rem' }}>
                Loading colleges...
              </div>
            ) : (
              <div className="table-responsive">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ whiteSpace: 'nowrap' }}>College Name</th>
                      <th style={{ whiteSpace: 'nowrap' }}>Domains</th>
                      <th className="hide-mobile" style={{ whiteSpace: 'nowrap' }}>Location</th>
                      <th className="hide-mobile" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Students</th>
                      <th style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Status</th>
                      <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collegesList.map((college: any) => {
                      const isDeleted = !!college.deletedAt;
                      const locStr = [college.city, college.state].filter(Boolean).join(', ');
                      return (
                        <tr key={college.id} style={{ opacity: isDeleted ? 0.6 : 1 }}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: '0.74rem', lineHeight: 1.25 }}>{college.name}</div>
                            <div style={{ fontSize: '0.64rem', color: 'var(--color-text-light)', display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.08rem' }}>
                              {college.shortName && <span>Code: {college.shortName}</span>}
                              {locStr && <span className="show-mobile-inline">• {locStr}</span>}
                              <span className="show-mobile-inline">• {college._count?.users || 0} students</span>
                            </div>
                          </td>

                          <td>
                            <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
                                      fontSize: '0.64rem',
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
                                      padding: '1px 4px',
                                      borderRadius: '3px',
                                      border: isDisabled
                                        ? '1px dashed rgba(239, 68, 68, 0.4)'
                                        : '1px solid var(--color-border)',
                                      cursor: 'pointer',
                                      textDecoration: isDisabled ? 'line-through' : 'none',
                                      whiteSpace: 'nowrap',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '2px',
                                      lineHeight: 1.25,
                                    }}
                                  >
                                    <span>{d.domain}</span>
                                    {isDisabled ? <span style={{ fontSize: '0.58rem' }}>(off)</span> : d.isPrimary ? <span style={{ fontSize: '0.58rem' }}>★</span> : null}
                                  </button>
                                );
                              })}
                            </div>
                          </td>

                          <td className="hide-mobile" style={{ color: 'var(--color-text-light)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                            {locStr || '—'}
                          </td>

                          <td className="hide-mobile" style={{ textAlign: 'center', fontWeight: 600, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                            {college._count?.users || 0}
                          </td>

                          <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {isDeleted ? (
                              <span className="badge badge-danger" style={{ fontSize: '0.58rem', padding: '1px 5px' }}>Deleted</span>
                            ) : college.status === 'APPROVED' ? (
                              <span className="badge badge-success" style={{ fontSize: '0.58rem', padding: '1px 5px' }}>Approved</span>
                            ) : college.status === 'PENDING' ? (
                              <span className="badge badge-warning" style={{ fontSize: '0.58rem', padding: '1px 5px' }}>Pending</span>
                            ) : (
                              <span className="badge badge-neutral" style={{ fontSize: '0.58rem', padding: '1px 5px' }}>Disabled</span>
                            )}
                          </td>

                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'inline-flex', gap: '0.22rem', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'nowrap' }}>
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
                                  style={{ padding: '0.18rem 0.42rem', fontSize: '0.68rem', minHeight: '24px' }}
                                >
                                  Restore
                                </button>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleOpenEdit(college)}
                                    className="btn-secondary"
                                    style={{ padding: '0.18rem 0.42rem', fontSize: '0.68rem', minHeight: '24px' }}
                                    title="Edit college"
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
                                      style={{ padding: '0.18rem 0.42rem', fontSize: '0.68rem', color: 'var(--color-success)', minHeight: '24px' }}
                                      title="Approve college"
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
                                      style={{ padding: '0.18rem 0.42rem', fontSize: '0.68rem', color: 'var(--color-warning)', minHeight: '24px' }}
                                      title="Disable college"
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
                                    style={{ padding: '0.18rem 0.35rem', fontSize: '0.68rem', minHeight: '24px', display: 'inline-flex', alignItems: 'center', gap: '2px' }}
                                    title={`Delete ${college.name}`}
                                  >
                                    <Trash2 size={12} />
                                    <span className="hide-mobile">Delete</span>
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
        <div className="glass-panel" style={{ overflow: 'hidden', padding: 0 }}>
          {isLoadingRequests ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.8rem' }}>
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
                    <th className="hide-mobile">Personal Email</th>
                    <th className="hide-mobile">Date</th>
                    <th style={{ textAlign: 'center' }}>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requestsList.map((req: any) => (
                    <tr key={req.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: '0.76rem' }}>{req.name}</div>
                        <div className="show-mobile" style={{ fontSize: '0.66rem', color: 'var(--color-text-dim)', marginTop: '0.08rem' }}>
                          {new Date(req.createdAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: '0.76rem' }}>{req.collegeName}</div>
                      </td>
                      <td>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{req.collegeEmail}</div>
                        {req.personalEmail && (
                          <div className="show-mobile" style={{ fontSize: '0.66rem', color: 'var(--color-text-light)' }}>
                            {req.personalEmail}
                          </div>
                        )}
                      </td>
                      <td className="hide-mobile" style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>
                        {req.personalEmail || '—'}
                      </td>
                      <td className="hide-mobile" style={{ fontSize: '0.7rem', color: 'var(--color-text-dim)' }}>
                        {new Date(req.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {req.status === 'ADDED' ? (
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Check size={11} /> Whitelisted
                          </span>
                        ) : req.status === 'REJECTED' ? (
                          <span className="badge badge-danger">Rejected</span>
                        ) : (
                          <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Clock size={11} /> Pending
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {req.status !== 'ADDED' && (
                            <button
                              type="button"
                              onClick={() => handleApproveRequest(req)}
                              className="btn-primary"
                              style={{ padding: '0.22rem 0.5rem', fontSize: '0.7rem', minHeight: '26px' }}
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
                              style={{ padding: '0.22rem 0.5rem', fontSize: '0.7rem', color: 'var(--color-danger)', minHeight: '26px' }}
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

                <div className="modal-actions" style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
