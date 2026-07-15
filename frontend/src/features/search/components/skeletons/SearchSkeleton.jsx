import Skeleton from '@shared/components/skeletons/Skeleton';
import PostSkeleton from '@features/feed/components/skeletons/PostSkeleton';

/**
 * Mirrors SearchResultsRoute layout:
 * - PageHeader with search bar + category tabs
 * - Result rows (mix of user + post skeletons)
 */
export default function SearchSkeleton() {
  return (
    <main className="centre centre-wide animate-in">
      <div>
        {/* Header */}
        <div style={{
          background: 'var(--color-bg-white)',
          border: '1px solid var(--color-border-light)',
          borderRadius: 'var(--radius-lg)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          marginBottom: '0.75rem',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Skeleton type="text" width="80px" height="20px" style={{ marginBottom: 0 }} />
          </div>
          <Skeleton type="rect" width="100%" height="42px" style={{ borderRadius: '22px' }} />
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--color-border-light)', paddingBottom: '0.75rem' }}>
            {['All', 'People', 'Posts', 'Activities', 'Communities'].map(t => (
              <Skeleton key={t} type="rect" width="75px" height="30px" style={{ borderRadius: '4px' }} />
            ))}
          </div>
        </div>

        {/* People section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
          <Skeleton type="text" width="60px" height="13px" style={{ marginBottom: '0.25rem' }} />
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              background: 'var(--color-bg-white)',
              border: '1px solid var(--color-border-light)',
              borderRadius: 'var(--radius-md)',
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}>
              <Skeleton type="circle" width="44px" height="44px" />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <Skeleton type="text" width={i % 2 === 0 ? '130px' : '100px'} height="13px" style={{ marginBottom: 0 }} />
                <Skeleton type="text" width="80px" height="10px" style={{ marginBottom: 0 }} />
              </div>
              <Skeleton type="rect" width="70px" height="30px" style={{ borderRadius: '100px' }} />
            </div>
          ))}
        </div>

        {/* Posts section */}
        <Skeleton type="text" width="50px" height="13px" style={{ marginBottom: '0.5rem' }} />
        <PostSkeleton />
        <PostSkeleton />
      </div>
    </main>
  );
}
