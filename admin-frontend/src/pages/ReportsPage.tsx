import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Eye } from 'lucide-react';

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
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px' }}>Universal Reports Queue</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
          Review content and user reports, inspect evidence, take enforcement actions, and document resolutions.
        </p>
      </div>

      {/* Filters */}
      <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem' }}>
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
          <option value="PENDING">PENDING</option>
          <option value="UNDER_REVIEW">UNDER_REVIEW</option>
          <option value="RESOLVED">RESOLVED</option>
          <option value="REJECTED">REJECTED</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
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
          <option value="">All Priorities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
      </div>

      {/* Reports Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading reports...</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Target Type</th>
                <th>Reason</th>
                <th>Reporter</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.data?.map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <span className="badge badge-info">{r.targetType}</span>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: '2px' }}>ID: {r.targetId.slice(0, 8)}...</div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{r.reason}</td>
                  <td>
                    <div style={{ fontSize: '0.85rem' }}>@{r.reporter?.username}</div>
                  </td>
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
                  <td>
                    <button onClick={() => handleOpenDetail(r.id)} className="btn-secondary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>
                      <Eye size={14} /> Review Report
                    </button>
                  </td>
                </tr>
              ))}
              {data?.data?.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                    No reports in queue.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Report Resolution Modal */}
      {selectedReport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '600px', padding: '2rem' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.5rem' }}>
              Report Review: {selectedReport.targetType} ({selectedReport.reason})
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Reporter: @{selectedReport.reporter?.username} | ID: {selectedReport.id}
            </p>

            {selectedReport.description && (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', padding: '0.85rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                <strong>Description:</strong> {selectedReport.description}
              </div>
            )}

            {/* Target Content Preview */}
            <div style={{ background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '0.85rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              <strong>Hydrated Target Content Preview:</strong>
              <pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.78rem', color: '#c7d2fe' }}>
                {JSON.stringify(selectedReport.targetContent, null, 2)}
              </pre>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Internal Admin Notes</label>
              <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} style={{ width: '100%', padding: '0.65rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }} />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Resolution Summary</label>
              <input type="text" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Action taken e.g. Content removed, user warned" style={{ width: '100%', padding: '0.65rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }} />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setSelectedReport(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => updateMutation.mutate({ id: selectedReport.id, status: 'REJECTED', resolution, internalNotes })} className="btn-secondary" style={{ color: '#f87171' }}>
                Reject Report
              </button>
              <button onClick={() => updateMutation.mutate({ id: selectedReport.id, status: 'RESOLVED', resolution, internalNotes })} className="btn-primary">
                Resolve Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
