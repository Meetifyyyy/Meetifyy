import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Inbox, ShieldAlert } from '../components/icons';
import { TicketQueue } from './support/TicketQueue';
import { TicketDetail } from './support/TicketDetail';
import { HelpContentManager } from './support/HelpContentManager';
import { supportApi } from './support/supportApi';
import './support/support.css';

type Tab = 'tickets' | 'appeals' | 'help';
const sections = [
  { id: 'tickets', label: 'Tickets', icon: Inbox },
  { id: 'appeals', label: 'Suspension appeals', icon: ShieldAlert },
  { id: 'help', label: 'Help content', icon: BookOpen },
] as const;

export const SupportPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('tickets');
  const selectedTicketId = searchParams.get('ticket');
  const stats = useQuery({ queryKey: ['adminSupportStats'], queryFn: supportApi.getStats, staleTime: 30_000 });

  const selectTicket = (id: string | null) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set('ticket', id);
      else next.delete('ticket');
      return next;
    }, { replace: true });
  };
  // Preserve incoming email deep links, including navigation from Help content.
  useEffect(() => { if (selectedTicketId) setTab((current) => current === 'help' ? 'tickets' : current); }, [selectedTicketId]);
  const switchSection = (next: Tab) => {
    if (next === tab) return;
    selectTicket(null);
    setTab(next);
  };

  return (
    <div className="admin-page support-page">
      <header className="page-header">
        <div><h2 className="page-title">Support</h2><p className="page-subtitle">Manage requests, review appeals, and keep your help centre up to date.</p></div>
      </header>
      <p className="support-summary-caption">Across all support queues</p>
      <dl className="support-summary" aria-label="Support totals across all queues" aria-busy={stats.isLoading}>
        {[
          { key: 'OPEN', label: 'New requests', tone: 'blue' },
          { key: 'IN_PROGRESS', label: 'In progress', tone: 'violet' },
          { key: 'WAITING_FOR_USER', label: 'Awaiting user', tone: 'peach' },
          { key: 'RESOLVED', label: 'Resolved', tone: 'green' },
        ].map(({ key, label, tone }) => <div key={key} className={`support-summary-card is-${tone}`}><dt>{label}</dt><dd>{stats.isLoading || stats.isError ? '—' : (stats.data?.byStatus?.[key] ?? 0).toLocaleString()}</dd></div>)}
      </dl>
      {stats.isError && <div className="support-stats-error" role="status">Support totals are unavailable. <button type="button" onClick={() => stats.refetch()}>Retry totals</button></div>}
      <div className="support-section-tabs" role="tablist" aria-label="Support sections" onKeyDown={(event) => {
        const index = sections.findIndex((section) => section.id === tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : event.key === 'ArrowRight' ? (index + 1) % sections.length : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : null;
        if (next === null) return;
        event.preventDefault(); switchSection(sections[next].id);
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>
        {sections.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" id={`support-tab-${id}`} aria-controls="support-panel" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => switchSection(id)}><Icon size={18} /><span>{label}</span></button>)}
      </div>
      <div id="support-panel" role="tabpanel" aria-labelledby={`support-tab-${tab}`}>
        {tab === 'help' ? <HelpContentManager /> : (
          <div className="support-workspace" data-selected={!!selectedTicketId}>
            <TicketQueue key={tab} selectedId={selectedTicketId} onSelect={selectTicket} lockedCategory={tab === 'appeals' ? 'SUSPENSION_APPEAL' : undefined} />
            <section className="support-detail-panel" aria-label="Ticket conversation">
              {selectedTicketId ? (
                // A draft must never carry over to a different recipient.
                <TicketDetail key={selectedTicketId} ticketId={selectedTicketId} onBack={() => selectTicket(null)} />
              ) : <div className="support-empty"><Inbox size={32} /><h3>{tab === 'appeals' ? 'Select an appeal' : 'Select a ticket'}</h3><p>Choose a request to read the conversation, assign it, or send a reply.</p></div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};
