import React from 'react';
import Skeleton from '@shared/components/Skeleton';

export default function MessageRowSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.25rem', width: '100%' }}>
      {/* Left bubble (incoming) */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', maxWidth: '70%' }}>
        <Skeleton type="circle" width="32px" height="32px" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-bg-alt, #f1f5f9)', padding: '12px', borderRadius: '16px 16px 16px 4px' }}>
          <Skeleton type="text" width="140px" height="14px" style={{ margin: 0 }} />
          <Skeleton type="text" width="220px" height="14px" style={{ margin: 0 }} />
        </div>
      </div>

      {/* Right bubble (outgoing) */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', alignSelf: 'flex-end', maxWidth: '70%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-primary-light, #e0f2fe)', padding: '12px', borderRadius: '16px 16px 4px 16px', alignItems: 'flex-end' }}>
          <Skeleton type="text" width="180px" height="14px" style={{ margin: 0 }} />
          <Skeleton type="text" width="90px" height="14px" style={{ margin: 0 }} />
        </div>
      </div>

      {/* Left bubble (incoming) */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', maxWidth: '70%' }}>
        <Skeleton type="circle" width="32px" height="32px" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-bg-alt, #f1f5f9)', padding: '12px', borderRadius: '16px 16px 16px 4px' }}>
          <Skeleton type="text" width="260px" height="14px" style={{ margin: 0 }} />
        </div>
      </div>

      {/* Right bubble (outgoing) */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', alignSelf: 'flex-end', maxWidth: '70%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', background: 'var(--color-primary-light, #e0f2fe)', padding: '12px', borderRadius: '16px 16px 4px 16px', alignItems: 'flex-end' }}>
          <Skeleton type="text" width="150px" height="14px" style={{ margin: 0 }} />
        </div>
      </div>
    </div>
  );
}
