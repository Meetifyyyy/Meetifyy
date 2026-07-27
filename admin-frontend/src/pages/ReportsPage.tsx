import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Eye, X } from 'lucide-react';

export const ReportsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [internalNotes, setInternalNotes] = useState('');
  const [resolution, setResolution] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['adminReports', statusFilter, priorityFilter],
    queryFn: () =>
      apiRequest(
        `/admin/reports?status=${statusFilter}&priority=${priorityFilter}`,
      ),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, resolution, internalNotes }: any) =>
      apiRequest(`/admin/reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, resolution, internalNotes }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminReports'] });
      setSelectedReport(null);
    },
  });

  const handleOpenDetail = async (reportId: string) => {
    try {
      const res = await apiRequest(`/admin/reports/${reportId}`);
      setSelectedReport(res);
      setInternalNotes(res.internalNotes || '');
      setResolution(res.resolution || '');
    } catch (e) {
      alert('Failed to load report detail');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Moderation Queue</h2>
          <p className="page-subtitle">Content reports and user enforcement actions.</p>
        </div>
      </div>

      {/* FILTERS */}
      <div className="glass-panel" style={{ padding: '0.85rem 1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-control"
          style={{ width: 'auto', minWidth: '150px' }}
        >
          <option value="">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="UNDER_REVIEW">Under Review</option>
          <option value="RESOLVED">Resolved</option>
          <option value="REJECTED">Rejected</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="input-control"
          style={{ width: 'auto', minWidth: '150px' }}
        >
          <option value="">All Priorities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </div>

      {/* TABLE */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
            Loading reports...
          </div>
        ) : (
          <div className="table-responsive">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Reason</th>
                  <th>Reporter</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.data?.map((r: any) => (
                  <tr key={r.id}>
                    <td>
                      <span className="badge badge-info">{r.targetType}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>{r.reason}</td>
                    <td style={{ fontSize: '0.82rem' }}>@{r.reporter?.username}</td>
                    <td>
                      <span className={`badge badge-${r.priority === 'CRITICAL' || r.priority === 'HIGH' ? 'danger' : 'warning'}`}>
                        {r.priority}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${r.status === 'RESOLVED' ? 'success' : r.status === 'PENDING' ? 'danger' : 'info'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button onClick={() => handleOpenDetail(r.id)} className="btn-secondary" style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}>
                        <Eye size={13} />
                        <span>Review</span>
                      </button>
                    </td>
                  </tr>
                ))}
                {data?.data?.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-text-dim)', padding: '2.5rem 1rem' }}>
                      No reports match your filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RESOLUTION MODAL */}
      {selectedReport && (
        <div className="modal-backdrop" onClick={() => setSelectedReport(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '1.5rem', maxWidth: '580px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                Review Report: {selectedReport.targetType}
              </h3>
              <button onClick={() => setSelectedReport(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-dim)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-light)', marginBottom: '0.85rem' }}>
              Reporter: @{selectedReport.reporter?.username} • Priority: {selectedReport.priority}
            </div>

            {selectedReport.description && (
              <div style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', marginBottom: '0.85rem' }}>
                <strong>Reasoning:</strong> {selectedReport.description}
              </div>
            )}

            {/* Target Content */}
            <div style={{ background: 'var(--color-primary-tint)', border: '1px solid rgba(37, 99, 235, 0.2)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', marginBottom: '1rem' }}>
              <strong>Reported Content Data:</strong>
              <pre style={{ marginTop: '0.35rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                {JSON.stringify(selectedReport.targetContent, null, 2)}
              </pre>
            </div>

            <div style={{ marginBottom: '0.85rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>Internal Admin Notes</label>
              <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} className="input-control" />
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>Resolution Action</label>
              <input type="text" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Action taken (e.g. Content removed)" className="input-control" />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setSelectedReport(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => updateMutation.mutate({ id: selectedReport.id, status: 'REJECTED', resolution, internalNotes })} className="btn-danger">
                Reject Report
              </button>
              <button onClick={() => updateMutation.mutate({ id: selectedReport.id, status: 'RESOLVED', resolution, internalNotes })} className="btn-primary">
                Resolve & Enforce
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
