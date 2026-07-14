import Skeleton from '@shared/components/Skeleton';

export default function ConversationSkeleton() {
  return (
    <div style={{ display: 'flex', padding: '0.8rem 1.25rem', alignItems: 'center', gap: '0.8rem', borderBottom: '1px solid var(--color-border-light)' }}>
      <Skeleton type="circle" width="48px" height="48px" />
      <div style={{ flex: 1 }}>
        <Skeleton type="text" width="50%" height="1rem" style={{ marginBottom: '6px' }} />
        <Skeleton type="text" width="80%" height="0.8rem" />
      </div>
    </div>
  );
}
