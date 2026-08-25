import { EmptyState } from '@shared/components/ui/StateViews';
import InvitationItem from './InvitationItem';

export default function InvitationList({
  invitations,
  readInvitations,
  onAccept,
  onDecline,
  onNavigateHost,
  onViewActivity,
  busyInvitationId = null,
  pageStyles
}) {
  if (invitations.length === 0) {
    return (
      <EmptyState
        title="No invitations yet"
        message="Invitations you receive will stay here, along with what happened to them."
        icon={
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1rem', opacity: 0.5 }}>
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        }
      />
    );
  }

  return (
    <div className={pageStyles.groupItems}>
      {invitations.map(inv => (
        <InvitationItem
          key={inv.id}
          inv={inv}
          isRead={readInvitations.includes(inv.id)}
          onAccept={onAccept}
          onDecline={onDecline}
          isBusy={busyInvitationId === inv.id}
          onNavigateHost={onNavigateHost}
          onViewActivity={onViewActivity}
        />
      ))}
    </div>
  );
}
