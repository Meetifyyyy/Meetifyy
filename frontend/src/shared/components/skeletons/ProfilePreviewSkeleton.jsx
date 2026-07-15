import Skeleton from './Skeleton';

export default function ProfilePreviewSkeleton() {
  return (
    <div 
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--color-bg-white)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        width: '100%',
        maxWidth: '320px',
        paddingBottom: '20px',
        position: 'relative'
      }}
    >
      {/* Cover placeholder */}
      <Skeleton type="rect" width="100%" height="140px" style={{ borderRadius: 0, margin: 0 }} />

      {/* Avatar Container */}
      <div 
        style={{
          marginTop: '-44px',
          zIndex: 2,
          background: 'var(--color-bg-white)',
          borderRadius: '50%',
          padding: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Skeleton type="circle" width="80px" height="80px" style={{ margin: 0 }} />
      </div>

      {/* Details (Name & Username centered) */}
      <div 
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          marginTop: '12px',
          padding: '0 16px',
          width: '100%',
          gap: '8px'
        }}
      >
        <Skeleton type="text" width="60%" height="18px" style={{ margin: 0 }} />
        <Skeleton type="text" width="40%" height="12px" style={{ margin: 0 }} />
      </div>
    </div>
  );
}
