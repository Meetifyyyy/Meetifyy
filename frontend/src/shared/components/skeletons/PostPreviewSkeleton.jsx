import Skeleton from './Skeleton';

export default function PostPreviewSkeleton() {
  return (
    <div 
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px',
        background: 'var(--color-bg-white)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 'var(--radius-lg)',
        width: '100%',
        maxWidth: '380px'
      }}
    >
      {/* Header/Author block */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Skeleton type="circle" width="28px" height="28px" />
        <Skeleton type="text" width="100px" height="12px" style={{ margin: 0 }} />
      </div>

      {/* Content lines */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Skeleton type="text" width="90%" height="10px" style={{ margin: 0 }} />
        <Skeleton type="text" width="75%" height="10px" style={{ margin: 0 }} />
      </div>

      {/* Meta row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
        <Skeleton type="text" width="60px" height="10px" style={{ margin: 0 }} />
        <Skeleton type="text" width="80px" height="10px" style={{ margin: 0 }} />
      </div>
    </div>
  );
}
