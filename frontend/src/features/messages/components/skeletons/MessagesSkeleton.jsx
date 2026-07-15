import Skeleton from '@shared/components/skeletons/Skeleton';
import ConversationSkeleton from './ConversationSkeleton';
import layoutStyles from '../layout/MessagesLayout.module.css';

/**
 * Mirrors MessagesRoute layout:
 * - Left sidebar: conversation list rows
 * - Right chat area: header + message bubbles + input bar
 * Matches the border/radius/flex structure of MessagesLayout exactly.
 */
export default function MessagesSkeleton() {
  return (
    <main className="centre centre-wide centre--messages animate-in">
      <div className={layoutStyles.page}>
        <div className={layoutStyles.messagesLayout}>
          {/* Sidebar */}
          <div style={{
            width: '320px',
            flexShrink: 0,
            borderRight: '1px solid var(--color-border-light)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Sidebar header */}
            <div style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--color-border-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <Skeleton type="text" width="100px" height="16px" style={{ marginBottom: 0 }} />
              <Skeleton type="circle" width="32px" height="32px" />
            </div>
            {/* Search bar */}
            <div style={{ padding: '0.75rem 1rem' }}>
              <Skeleton type="rect" width="100%" height="36px" style={{ borderRadius: '20px' }} />
            </div>
            {/* Conversation rows */}
            {[0, 1, 2, 3, 4, 5].map(i => (
              <ConversationSkeleton key={i} />
            ))}
          </div>

          {/* Chat area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* Chat header */}
            <div style={{
              padding: '1rem 1.25rem',
              borderBottom: '1px solid var(--color-border-light)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}>
              <Skeleton type="circle" width="40px" height="40px" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <Skeleton type="text" width="130px" height="14px" style={{ marginBottom: 0 }} />
                <Skeleton type="text" width="70px" height="10px" style={{ marginBottom: 0 }} />
              </div>
            </div>

            {/* Messages area */}
            <div style={{ flex: 1, padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'flex-end' }}>
              {/* Received bubbles */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <Skeleton type="circle" width="28px" height="28px" />
                <Skeleton type="rect" width="200px" height="40px" style={{ borderRadius: '12px 12px 12px 2px' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <Skeleton type="circle" width="28px" height="28px" />
                <Skeleton type="rect" width="140px" height="34px" style={{ borderRadius: '12px 12px 12px 2px' }} />
              </div>
              {/* Sent bubble */}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Skeleton type="rect" width="180px" height="40px" style={{ borderRadius: '12px 12px 2px 12px' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <Skeleton type="circle" width="28px" height="28px" />
                <Skeleton type="rect" width="260px" height="52px" style={{ borderRadius: '12px 12px 12px 2px' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Skeleton type="rect" width="120px" height="34px" style={{ borderRadius: '12px 12px 2px 12px' }} />
              </div>
            </div>

            {/* Input bar */}
            <div style={{
              padding: '0.75rem 1rem',
              borderTop: '1px solid var(--color-border-light)',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
            }}>
              <Skeleton type="rect" width="100%" height="40px" style={{ borderRadius: '20px' }} />
              <Skeleton type="circle" width="36px" height="36px" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
