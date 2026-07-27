import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/apiClient';
import { Send, CheckCircle } from 'lucide-react';

export const SupportPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['adminSupportTickets'],
    queryFn: () => apiRequest('/admin/support'),
  });

  const { data: ticketDetail } = useQuery({
    queryKey: ['adminSupportTicketDetail', selectedTicketId],
    queryFn: () => (selectedTicketId ? apiRequest(`/admin/support/${selectedTicketId}`) : null),
    enabled: !!selectedTicketId,
  });

  const replyMutation = useMutation({
    mutationFn: ({ ticketId, body, isInternal }: any) =>
      apiRequest(`/admin/support/${ticketId}/reply`, {
        method: 'POST',
        body: JSON.stringify({ body, isInternal }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSupportTicketDetail', selectedTicketId] });
      setReplyBody('');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ ticketId, status }: any) =>
      apiRequest(`/admin/support/${ticketId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminSupportTickets'] });
      queryClient.invalidateQueries({ queryKey: ['adminSupportTicketDetail', selectedTicketId] });
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Support Tickets</h2>
          <p className="page-subtitle">User inquiries and support requests.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 320px) 1fr', gap: '1.25rem', height: 'calc(100vh - 180px)' }}>
        {/* Ticket List */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid var(--color-border)', fontWeight: 700, fontSize: '0.85rem', background: 'var(--color-bg-alt)' }}>
            Ticket Queue
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-dim)', fontSize: '0.8rem' }}>Loading...</div>
            ) : (
              data?.data?.map((ticket: any) => (
                <div
                  key={ticket.id}
                  onClick={() => setSelectedTicketId(ticket.id)}
                  style={{
                    padding: '0.85rem 1rem',
                    borderBottom: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    background: selectedTicketId === ticket.id ? 'var(--color-primary-tint)' : 'transparent',
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem', alignItems: 'center' }}>
                    <span className="badge badge-info">{ticket.category}</span>
                    <span className={`badge badge-${ticket.status === 'RESOLVED' ? 'success' : 'warning'}`}>{ticket.status}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.15rem', color: 'var(--color-text-main)' }}>{ticket.subject}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--color-text-light)' }}>@{ticket.user?.username}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Ticket Details & Thread */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {ticketDetail ? (
            <>
              {/* Header */}
              <div style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--color-bg-alt)' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{ticketDetail.subject}</h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-light)' }}>@{ticketDetail.user?.username} ({ticketDetail.user?.email})</span>
                </div>
                <button
                  onClick={() => statusMutation.mutate({ ticketId: ticketDetail.id, status: ticketDetail.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED' })}
                  className="btn-secondary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                >
                  <CheckCircle size={14} color="var(--color-success)" />
                  <span>{ticketDetail.status === 'RESOLVED' ? 'Reopen' : 'Resolve'}</span>
                </button>
              </div>

              {/* Messages Thread */}
              <div style={{ flex: 1, padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {ticketDetail.messages?.map((msg: any) => {
                  const isAdmin = msg.senderId === null;
                  return (
                    <div
                      key={msg.id}
                      style={{
                        alignSelf: isAdmin ? 'flex-end' : 'flex-start',
                        maxWidth: '80%',
                        background: msg.isInternal
                          ? 'var(--color-warning-tint)'
                          : isAdmin
                          ? 'var(--color-primary-tint)'
                          : 'var(--color-bg-soft)',
                        border: msg.isInternal
                          ? '1px solid rgba(245, 158, 11, 0.3)'
                          : isAdmin
                          ? '1px solid rgba(37, 99, 235, 0.2)'
                          : '1px solid var(--color-border)',
                        padding: '0.75rem 0.95rem',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-light)', marginBottom: '0.25rem', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                        <span>{msg.isInternal ? '🔒 Internal Note' : isAdmin ? 'Admin Reply' : `@${ticketDetail.user?.username}`}</span>
                        <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-main)', whiteSpace: 'pre-wrap' }}>{msg.body}</div>
                    </div>
                  );
                })}
              </div>

              {/* Reply Composer */}
              <div style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-alt)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                  <label style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                    Internal note only
                  </label>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <textarea
                    rows={2}
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={isInternal ? 'Write internal note...' : 'Write reply to user...'}
                    className="input-control"
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={() => replyMutation.mutate({ ticketId: ticketDetail.id, body: replyBody, isInternal })}
                    disabled={!replyBody.trim() || replyMutation.isPending}
                    className="btn-primary"
                  >
                    <Send size={14} />
                    <span>Send</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--color-text-dim)', fontSize: '0.85rem' }}>
              Select a ticket from the queue.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
