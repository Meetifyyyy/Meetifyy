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
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem', height: 'calc(100vh - 120px)' }}>
      {/* Ticket List Column */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)', fontWeight: 700, fontSize: '1rem' }}>
          Support Tickets Queue
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {isLoading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading tickets...</div>
          ) : (
            data?.data?.map((ticket: any) => (
              <div
                key={ticket.id}
                onClick={() => setSelectedTicketId(ticket.id)}
                style={{
                  padding: '1rem',
                  borderBottom: '1px solid var(--border-color)',
                  cursor: 'pointer',
                  background: selectedTicketId === ticket.id ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span className="badge badge-info">{ticket.category}</span>
                  <span className={`badge badge-${ticket.status === 'RESOLVED' ? 'success' : 'warning'}`}>{ticket.status}</span>
                </div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>{ticket.subject}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>From: @{ticket.user?.username}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Ticket Thread Column */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {ticketDetail ? (
          <>
            {/* Header */}
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800 }}>{ticketDetail.subject}</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>User: @{ticketDetail.user?.username} ({ticketDetail.user?.email})</span>
              </div>
              <button
                onClick={() => statusMutation.mutate({ ticketId: ticketDetail.id, status: ticketDetail.status === 'RESOLVED' ? 'OPEN' : 'RESOLVED' })}
                className="btn-secondary"
              >
                <CheckCircle size={16} color="#34d399" />
                {ticketDetail.status === 'RESOLVED' ? 'Reopen Ticket' : 'Mark Resolved'}
              </button>
            </div>

            {/* Thread messages */}
            <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {ticketDetail.messages?.map((msg: any) => {
                const isAdmin = msg.senderId === null;
                return (
                  <div
                    key={msg.id}
                    style={{
                      alignSelf: isAdmin ? 'flex-end' : 'flex-start',
                      maxWidth: '75%',
                      background: msg.isInternal
                        ? 'rgba(245, 158, 11, 0.15)'
                        : isAdmin
                        ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                        : 'rgba(255, 255, 255, 0.05)',
                      border: msg.isInternal ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid var(--border-color)',
                      padding: '0.85rem 1rem',
                      borderRadius: 'var(--radius-md)',
                      color: '#fff',
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.7)', marginBottom: '0.3rem', display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                      <span>{msg.isInternal ? '🔒 Internal Admin Note' : isAdmin ? 'Super Admin Reply' : `@${ticketDetail.user?.username}`}</span>
                      <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                    </div>
                    <div style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{msg.body}</div>
                  </div>
                );
              })}
            </div>

            {/* Reply Composer */}
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                  Internal Note Only (Hidden from User)
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <textarea
                  rows={2}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder={isInternal ? 'Write internal note...' : 'Write reply to user...'}
                  style={{ flex: 1, padding: '0.65rem', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)', borderRadius: '6px', color: '#fff', fontSize: '0.875rem' }}
                />
                <button
                  onClick={() => replyMutation.mutate({ ticketId: ticketDetail.id, body: replyBody, isInternal })}
                  disabled={!replyBody.trim() || replyMutation.isPending}
                  className="btn-primary"
                  style={{ padding: '0 1.25rem' }}
                >
                  <Send size={16} /> Send
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-muted)' }}>
            Select a ticket from the queue to view thread.
          </div>
        )}
      </div>
    </div>
  );
};
