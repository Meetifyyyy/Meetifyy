import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, Inbox, ShieldAlert } from '../components/icons';

import { TicketQueue } from './support/TicketQueue';
import { TicketDetail } from './support/TicketDetail';
import { HelpContentManager } from './support/HelpContentManager';

type Tab = 'tickets' | 'appeals' | 'help';

/**
 * Suspension appeals are support tickets in their own category, so they get
 * their own section here rather than a parallel inbox — the reply, assignment
 * and status workflow are identical, and a suspended user waiting on a decision
 * should not be buried in ordinary support volume.
 */
const APPEAL_CATEGORY = 'SUSPENSION_APPEAL';

/**
 * The Admin Dashboard's Support section.
 *
 * Two tabs on one route rather than two nav entries: support requests and the
 * help content that exists to prevent them are the same job, and the admin who
 * answers a question five times is the one who should turn it into an article.
 * Keeping both here also means the section keeps its single place in the
 * sidebar, its existing permissions and its existing audit classification.
 *
 * The selected ticket lives in the query string so the admin-notification email
 * can deep-link straight to it (`/support?ticket=<id>`), and so a reload or a
 * shared link lands back on the same ticket.
 */
export const SupportPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('tickets');

  const selectedTicketId = searchParams.get('ticket');

  // A deep link carrying ?ticket= is a link to a ticket, so it must open the
  // tickets tab even if the admin was last on the help tab.
  useEffect(() => {
    if (selectedTicketId) setTab('tickets');
  }, [selectedTicketId]);

  const selectTicket = (id: string | null) => {
    setSearchParams(
      (params) => {
        if (id) params.set('ticket', id);
        else params.delete('ticket');
        return params;
      },
      // Browsing the queue should not fill the back stack with one entry per
      // ticket the admin glanced at.
      { replace: true },
    );
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Support</h2>
          <p className="page-subtitle">
            Support requests from users, and the public Help &amp; Support content that answers them.
          </p>
        </div>
      </div>

      <div style={tabBar} role="tablist" aria-label="Support sections">
        <TabButton active={tab === 'tickets'} onClick={() => setTab('tickets')} icon={<Inbox size={14} />}>
          Tickets
        </TabButton>
        <TabButton active={tab === 'appeals'} onClick={() => setTab('appeals')} icon={<ShieldAlert size={14} />}>
          Suspension appeals
        </TabButton>
        <TabButton active={tab === 'help'} onClick={() => setTab('help')} icon={<BookOpen size={14} />}>
          Help content
        </TabButton>
      </div>

      {tab === 'tickets' || tab === 'appeals' ? (
        <div className="ticket-layout">
          <TicketQueue
            // Remounted when the section changes so the appeals queue starts
            // from its own filter state rather than inheriting the last search
            // the admin ran on the full queue.
            key={tab}
            selectedId={selectedTicketId}
            onSelect={selectTicket}
            lockedCategory={tab === 'appeals' ? APPEAL_CATEGORY : undefined}
          />

          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {selectedTicketId ? (
              // Keyed on the id so switching tickets remounts the detail pane.
              // Without it the reply composer would carry a half-written reply
              // from one ticket into another.
              <TicketDetail key={selectedTicketId} ticketId={selectedTicketId} />
            ) : (
              <div style={emptyDetail}>
                {tab === 'appeals' ? <ShieldAlert size={24} /> : <Inbox size={24} />}
                <span style={{ fontWeight: 600 }}>
                  {tab === 'appeals' ? 'Select an appeal' : 'Select a ticket'}
                </span>
                <span style={{ fontSize: '0.78rem' }}>
                  {tab === 'appeals'
                    ? 'Choose an appeal to read it, reply, or decide the outcome.'
                    : 'Choose a request from the queue to read it, reply, or change its status.'}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <HelpContentManager />
      )}
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ active, onClick, icon, children }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    style={{
      ...tabButton,
      color: active ? 'var(--color-primary)' : 'var(--color-text-light)',
      borderBottomColor: active ? 'var(--color-primary)' : 'transparent',
      fontWeight: active ? 700 : 600,
    }}
  >
    {icon}
    <span>{children}</span>
  </button>
);

// ── Styles ─────────────────────────────────────────────────────────────────

const tabBar: React.CSSProperties = {
  display: 'flex',
  gap: '0.25rem',
  marginBottom: '0.85rem',
  borderBottom: '1px solid var(--color-border)',
};

const tabButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.45rem 0.8rem',
  fontSize: '0.82rem',
  fontFamily: 'inherit',
  background: 'none',
  border: 'none',
  borderBottom: '2px solid transparent',
  cursor: 'pointer',
  marginBottom: '-1px',
};


const emptyDetail: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  textAlign: 'center',
  padding: '2rem',
  color: 'var(--color-text-dim)',
  fontSize: '0.85rem',
};
