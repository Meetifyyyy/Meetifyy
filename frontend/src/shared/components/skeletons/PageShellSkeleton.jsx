import React from 'react';
import Skeleton from './Skeleton';

export default function PageShellSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100vh', padding: '1.5rem', gap: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Skeleton type="circle" width="40px" height="40px" />
          <Skeleton type="text" width="160px" height="20px" style={{ margin: 0 }} />
        </div>
        <Skeleton type="rect" width="120px" height="36px" style={{ borderRadius: '18px' }} />
      </div>

      {/* Main layout skeleton */}
      <div style={{ display: 'flex', gap: '2rem', width: '100%', flex: 1 }}>
        {/* Left/Center main column */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '1.25rem' }}>
          <Skeleton type="rect" width="100%" height="140px" style={{ borderRadius: '16px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Skeleton type="rect" width="100%" height="200px" style={{ borderRadius: '16px' }} />
            <Skeleton type="rect" width="100%" height="200px" style={{ borderRadius: '16px' }} />
          </div>
        </div>

        {/* Right side block (hidden on narrow screens, shown on desktop) */}
        <div style={{ width: '320px', display: 'flex', flexDirection: 'column', gap: '1rem', flexShrink: 0 }}>
          <Skeleton type="rect" width="100%" height="280px" style={{ borderRadius: '16px' }} />
          <Skeleton type="rect" width="100%" height="180px" style={{ borderRadius: '16px' }} />
        </div>
      </div>
    </div>
  );
}
